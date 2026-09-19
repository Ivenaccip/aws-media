"""M23 · D — MIX: publicidad automática, una imagen al día.

El flujo de la pantalla, en el orden en que lo pidió el dueño (18-sep):
sube una imagen → dice el motivo → marca las fechas en el calendario → elige
hora → elige la cuenta de Blotato → ve UN ejemplo, el del primer día → enciende.

Dos cosas que este archivo defiende y conviene no perder de vista:

**El ejemplo es gratis y no se regenera.** Si enciende, ese mismo ejemplo ES la
publicación del día 1 (`mix_corridas` lo guarda en estado 'ejemplo'). Nadie
paga por mirar, y nadie paga dos veces por la misma imagen.

**La campaña se cobra entera al encender.** Es lo que eligió el dueño, así que
el número que enseña la pantalla y el que se cobra salen del mismo sitio
(`mix.resumen_costo`): no pueden separarse. Lo que no sale se devuelve por día.

Las imágenes viven donde ya viven las demás —`imagenes/<user>/<nombre>`— para
reutilizar el endpoint que las sirve, que ya comprueba de quién son.
"""
from __future__ import annotations

import logging
import uuid
from datetime import date
from pathlib import Path

import httpx
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from pipeline import blotato, claves_usuario, creditos, db, jobs, media_fal
from pipeline import media_sync, mix
from pipeline.config import settings

router = APIRouter(prefix="/api/mix", tags=["mix"])
log = logging.getLogger("mix_api")

SIN_CLAVE = ("Conecta tu cuenta de Blotato para que MIX pueda publicar por ti. "
             "Es la cuenta donde van a salir las publicaciones.")
YA_ENCENDIDA = ("Ya tienes una campaña encendida. Apágala antes de crear otra: "
                "por ahora solo puede haber una.")
SIN_BORRADOR = "No hay ninguna campaña a medias. Empieza por subir una imagen."
SIN_EJEMPLO = ("Primero mira el ejemplo del primer día. Así ves qué va a salir "
               "antes de que te cobremos.")
RED_FUERA = ("Por ahora MIX publica en Instagram, LinkedIn, Threads, X y "
             "Bluesky. Elige una cuenta de esas.")
IMAGEN_MALA = ("Esa imagen no se pudo leer. Sube una foto de tu producto o de "
               "tu negocio, en JPG o PNG.")
TIPOS = ("image/jpeg", "image/png", "image/webp")
MAX_BYTES = 12 * 1024 * 1024


def _exige_postgres() -> None:
    """MIX vive entero en dos tablas: sin Postgres no hay nada que leer ni
    dónde escribir. En dev local el estado va en JSON (STATE_BACKEND=json), así
    que sin esto el primer clic saldría como un error de boto3 en la pantalla,
    que no le dice nada a nadie. Mismo trato que el dashboard de admin."""
    if db.backend() != "postgres":
        raise HTTPException(503, "MIX guarda las campañas en Postgres — "
                                 "solo funciona en el servicio en la nube.")


def _usuario() -> str:
    user = db.usuario_actual()
    if not claves_usuario.id_valido(user):
        raise HTTPException(400, "No pudimos identificar tu cuenta. Vuelve a iniciar sesión.")
    return user


def _clave(user: str) -> str:
    clave = blotato.clave_de(user)
    if not clave:
        raise HTTPException(409, SIN_CLAVE)
    return clave


def _fallo_blotato(err: Exception, clave: str, contexto: str) -> HTTPException:
    mensaje, reconectar = blotato.explicar_fallo(err, clave, contexto=contexto)
    return HTTPException(409 if reconectar else 502, mensaje)


def _dir() -> Path:
    return Path(settings.work_dir) / "_imagenes"


def _guardar(destino: Path, nombre: str) -> None:
    """Misma regla que el resto de imágenes: en la nube vive en S3 bajo el
    usuario y el archivo local se borra, porque /tmp lo comparten todos los
    usuarios que atiende el mismo contenedor caliente."""
    if jobs.backend() == "aws":
        media_sync.subir_archivo(destino, mix.clave_imagen(db.usuario_actual(), nombre))
        destino.unlink(missing_ok=True)


def _traer(nombre: str) -> Path:
    """La imagen base en disco, lista para mandarla a Grok como referencia."""
    local = _dir() / nombre
    if local.exists():
        return local
    local.parent.mkdir(parents=True, exist_ok=True)
    if jobs.backend() == "aws" and media_sync.bajar_archivo(
            mix.clave_imagen(db.usuario_actual(), nombre), local):
        return local
    raise HTTPException(409, "Perdimos la imagen de la campaña. Vuelve a subirla.")


def _url(nombre: str) -> str:
    return f"/api/imagenes/{nombre}/archivo"


def _fecha(valor: str, campo: str) -> date:
    try:
        return date.fromisoformat((valor or "").strip())
    except ValueError:
        raise HTTPException(400, f"La fecha de {campo} no se entiende.") from None


def _devolucion(user: str, campana: dict) -> int:
    """Lo que se devolvería si la apagara AHORA: los días que no salieron,
    topado en lo que de verdad se cobró.

    Vive en `pipeline/mix.py` y no en la pantalla a propósito. Es la única
    cuenta del flujo que la pantalla necesita ANTES de llamar a un endpoint —el
    botón de apagar tiene que decir cuánto se devuelve antes de que lo pulsen—
    y si se calcula en los dos sitios, el día que cambie la tarifa uno de los
    dos miente. Desde que el reloj devuelve cada día fallido en el acto, la
    cuenta además tiene que restar lo ya devuelto: si no, ese día se devolvería
    dos veces."""
    liquidados = db.mix_dias_liquidados(user, campana["id"])
    return mix.devolucion_pendiente(campana, liquidados,
                                    creditos.MIX_POR_PUBLICACION_CR)


def _campana_vista(c: dict) -> dict:
    """Lo que la pantalla necesita saber de una campaña. Sin la clave de nadie."""
    return {k: c.get(k) for k in (
        "id", "motivo", "tono", "canal_id", "canal_red", "canal_nombre", "hora",
        "zona", "empieza", "termina", "estado", "nota", "creditos_cobrados",
        "creditos_devueltos")} | {"imagen": _url(c["imagen_key"]) if c.get("imagen_key") else None}


# ---------------------------------------------------------------------------

@router.get("")
def estado():
    """Todo lo que la pantalla necesita para pintarse de una sola vez."""
    _exige_postgres()
    user = _usuario()
    campana = db.mix_campana(user)
    corridas = db.mix_corridas(user, campana["id"]) if campana else []
    # cuando el reloj cierra una campaña vencida deja de ser «viva» y esta
    # pantalla volvería al formulario en blanco, como si nunca hubiera
    # existido. La última sirve para decirle cómo acabó la que pagó.
    ultima = db.mix_ultima(user) if not campana else None
    if ultima:
        ultima = dict(ultima) | {
            "salieron": db.mix_dias_liquidados(user, ultima["id"])}
    return {
        "campana": _campana_vista(campana) if campana else None,
        "ultima": ultima,
        "corridas": [dict(c) | {"imagen": _url(c["media_key"]) if c.get("media_key") else None}
                     for c in corridas],
        "saldo": creditos.saldo(user) if creditos.activo() else None,
        "tarifa": creditos.MIX_POR_PUBLICACION_CR,
        "tonos": list(mix.TONOS),
        "atajos": mix.ATAJOS,
        "max_dias": mix.MAX_DIAS,
        "tiene_blotato": bool(blotato.clave_de(user)),
        "devolucion": (_devolucion(user, campana)
                       if campana and campana["estado"] in ("activa", "pausada")
                       else 0),
    }


@router.get("/cuentas")
def cuentas():
    """Las cuentas conectadas donde MIX PUEDE publicar.

    Se filtra aquí, y no en la pantalla, porque dejar elegir una cuenta de
    Facebook no sería un detalle estético: la campaña se cobra ENTERA por
    adelantado y Blotato la rechazaría los treinta días por falta de la página
    —o del tablero, o de la privacidad— que MIX no pregunta. Las que quedan
    fuera se devuelven por su nombre para poder decir por qué no están."""
    _exige_postgres()
    user = _usuario()
    clave = _clave(user)
    try:
        todas = blotato.cuentas(clave)
    except (httpx.HTTPError, blotato.ClaveInvalida) as e:
        raise _fallo_blotato(e, clave, "leer tus cuentas") from e
    fuera = sorted({(blotato.REDES.get(c.get("platform")) or {}).get("nombre")
                    or str(c.get("platform") or "")
                    for c in todas if not mix.red_valida(c.get("platform"))})
    return {"cuentas": [c for c in todas if mix.red_valida(c.get("platform"))],
            "fuera": [f for f in fuera if f]}


@router.post("/borrador")
async def guardar_borrador(
        motivo: str = Form(""),
        tono: str = Form("vender"),
        canal_id: str = Form(""),
        canal_red: str = Form(""),
        canal_nombre: str = Form(""),
        hora: str = Form("09:00"),
        zona: str = Form("America/Guayaquil"),
        empieza: str = Form(""),
        termina: str = Form(""),
        imagen: UploadFile | None = File(None)):
    """Guarda la campaña a medias y devuelve lo que va a costar.

    Se puede llamar varias veces mientras el usuario cambia cosas: siempre hay
    UN borrador, nunca dos. La imagen solo hace falta la primera vez."""
    _exige_postgres()
    user = _usuario()
    viva = db.mix_campana(user)
    if viva and viva["estado"] != "borrador":
        raise HTTPException(409, YA_ENCENDIDA)

    if not (motivo or "").strip():
        raise HTTPException(400, "Cuéntanos para qué es la campaña.")
    d_empieza, d_termina = _fecha(empieza, "inicio"), _fecha(termina, "fin")
    try:
        dias = mix.validar_rango(d_empieza, d_termina, hoy=mix.hoy_en(zona))
    except ValueError as e:
        raise HTTPException(400, str(e)) from None
    if not blotato.id_valido(canal_id):
        raise HTTPException(400, "Elige en qué cuenta quieres que salga.")
    if not mix.red_valida(canal_red):
        raise HTTPException(400, RED_FUERA)

    imagen_key = viva.get("imagen_key") if viva else None
    if imagen is not None:
        if imagen.content_type not in TIPOS:
            raise HTTPException(400, IMAGEN_MALA)
        crudo = await imagen.read()
        if not crudo or len(crudo) > MAX_BYTES:
            raise HTTPException(400, IMAGEN_MALA)
        imagen_key = f"mix-{uuid.uuid4().hex[:12]}-base.jpg"
        destino = _dir() / imagen_key
        destino.parent.mkdir(parents=True, exist_ok=True)
        destino.write_bytes(crudo)
        _guardar(destino, imagen_key)
    if not imagen_key:
        raise HTTPException(400, "Sube una imagen de tu producto o tu negocio.")

    id_ = db.mix_guardar_borrador(
        user, f"mix-{uuid.uuid4().hex[:12]}", motivo=motivo.strip()[:2000],
        tono=mix.tono_valido(tono), imagen_key=imagen_key, canal_id=canal_id,
        canal_red=canal_red or "", canal_nombre=canal_nombre or "", hora=hora,
        zona=zona or "America/Guayaquil", empieza=d_empieza.isoformat(),
        termina=d_termina.isoformat())
    saldo = creditos.saldo(user) if creditos.activo() else 0
    return {"id": id_, "costo": mix.resumen_costo(
        dias, creditos.MIX_POR_PUBLICACION_CR, saldo)}


@router.post("/ejemplo")
async def ejemplo():
    """La publicación del primer día, para verla ANTES de pagar.

    No cobra (decisión del dueño). Si enciende, esta misma imagen es la del día
    1: se guarda en la corrida de ese día en estado 'ejemplo' y el reloj la
    reclama en vez de generar otra."""
    _exige_postgres()
    user = _usuario()
    campana = db.mix_campana(user)
    if not campana:
        raise HTTPException(409, SIN_BORRADOR)
    if campana["estado"] != "borrador":
        raise HTTPException(409, YA_ENCENDIDA)

    dias = mix.dias_de_campana(campana)
    base = _traer(campana["imagen_key"])
    plan = await mix.tema_y_texto(campana, 1, len(dias))

    nombre = f"mix-{campana['id']}-{dias[0].isoformat()}.jpg"
    destino = _dir() / nombre
    destino.parent.mkdir(parents=True, exist_ok=True)
    try:
        await media_fal.imagen_fal(
            mix.prompt_imagen(plan["tema"]), destino, referencia=base,
            meta={"mix": campana["id"], "dia": dias[0].isoformat()},
            aspecto="1:1")
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001 — el modelo falló, no el usuario
        log.warning("el ejemplo de MIX no salió: %s", e)
        raise HTTPException(502, "No pudimos preparar el ejemplo. Inténtalo otra vez.") from e
    _guardar(destino, nombre)
    # Entre el gate de arriba y esta línea pasaron el LLM y Grok: hasta dos
    # minutos en los que el usuario pudo pulsar «Encender» y el reloj pudo
    # publicar el día 1 de verdad. Guardar el ejemplo encima sería devolver esa
    # fila a 'ejemplo' y dejar que el reloj la publicara por segunda vez. La
    # base ya no lo permite (el upsert está condicionado), pero se comprueba
    # aquí también para poder DECIRLO en vez de fallar en silencio.
    if (db.mix_campana(user) or {}).get("estado") != "borrador":
        raise HTTPException(409, "Encendiste la campaña mientras preparábamos "
                                 "el ejemplo. Ábrela para ver cómo va.")
    db.mix_guardar_ejemplo(user, campana["id"], dias[0].isoformat(),
                           tema=plan["tema"], texto=plan["texto"], media_key=nombre)
    return {"dia": dias[0].isoformat(), "texto": plan["texto"], "imagen": _url(nombre)}


class EncenderIn(BaseModel):
    id: str = Field("", max_length=64)


@router.post("/encender")
def encender(body: EncenderIn):
    """Cobra la campaña completa y la deja publicando."""
    _exige_postgres()
    user = _usuario()
    campana = db.mix_campana(user)
    if not campana or campana["estado"] != "borrador":
        raise HTTPException(409, SIN_BORRADOR if not campana else YA_ENCENDIDA)
    if body.id and body.id != campana["id"]:
        raise HTTPException(409, "Esa campaña ya cambió. Vuelve a abrir la pantalla.")
    if not db.mix_corridas(user, campana["id"]):
        raise HTTPException(409, SIN_EJEMPLO)

    dias = len(mix.dias_de_campana(campana))
    costo = creditos.costo_mix(dias)
    if creditos.activo():
        try:
            creditos.cobrar(costo, f"mix:{campana['id']}", user)
        except creditos.SinSaldo as e:
            raise HTTPException(402, str(e)) from None
    if not db.mix_encender(user, campana["id"], costo):
        # perdió la carrera contra otro clic: el que ganó ya cobró, así que
        # esto devuelve LO NUESTRO, no lo suyo
        if creditos.activo():
            creditos.devolver(costo, f"mix:{campana['id']}:doble", user)
        raise HTTPException(409, "Esa campaña ya se encendió.")
    return {"ok": True, "id": campana["id"], "dias": dias, "creditos": costo,
            "saldo": creditos.saldo(user) if creditos.activo() else None}


class ApagarIn(BaseModel):
    confirmar: bool = False


@router.post("/apagar")
def apagar(body: ApagarIn):
    """Apaga la campaña y devuelve los días que no salieron.

    Se paga por adelantado, así que apagar el día 4 de 14 devuelve 10 días. El
    derecho a devolver se gana con el UPDATE condicionado de mix_apagar: si
    alguien ya la apagó, aquí no se devuelve nada."""
    _exige_postgres()
    user = _usuario()
    campana = db.mix_campana(user)
    if not campana or campana["estado"] == "borrador":
        raise HTTPException(409, "No tienes ninguna campaña encendida.")
    if not body.confirmar:
        raise HTTPException(400, "Falta confirmar: apagar la campaña cancela lo que falta.")

    ganado = db.mix_apagar(user, campana["id"])
    if not ganado:
        raise HTTPException(409, "Esa campaña ya estaba apagada.")
    # La cuenta se hace DESPUÉS de ganar el claim y con los números que el
    # claim devolvió, no con los que se leyeron al entrar. En ese hueco —tres
    # viajes al Data API— cabe justo lo que más duele: que el reloj cierre un
    # día que acaba de fallar y devuelva sus créditos. Con la lectura vieja,
    # `creditos_devueltos` seguiría siendo 0 y ese día se devolvería otra vez.
    # Es la misma forma que usa el reloj al cerrar una campaña vencida.
    liquidados = db.mix_dias_liquidados(user, campana["id"])
    devolver = mix.devolucion_pendiente({**campana, **ganado}, liquidados,
                                        creditos.MIX_POR_PUBLICACION_CR)
    if devolver and creditos.activo():
        creditos.devolver(devolver, f"mix:{campana['id']}:apagada", user)
        db.mix_anotar_devolucion(user, campana["id"], devolver)
    return {"ok": True, "salieron": liquidados, "devueltos": devolver,
            "saldo": creditos.saldo(user) if creditos.activo() else None}


class ReanudarIn(BaseModel):
    id: str = Field("", max_length=64)


@router.post("/reanudar")
def reanudar(body: ReanudarIn):
    """Vuelve a encender una campaña que MIX pausó solo.

    Sin esto, pausar sería una trampa: MIX para la campaña porque la cuenta de
    Blotato se desconectó, el usuario la reconecta… y no vuelve a publicar
    nunca. Se comprueba que la clave esté de vuelta antes de reanudar, para no
    dejarle pulsar un botón que solo lo devolvería al mismo sitio mañana."""
    _exige_postgres()
    user = _usuario()
    campana = db.mix_campana(user)
    if not campana or campana["estado"] != "pausada":
        raise HTTPException(409, "No tienes ninguna campaña en pausa.")
    if body.id and body.id != campana["id"]:
        raise HTTPException(409, "Esa campaña ya cambió. Vuelve a abrir la pantalla.")
    _clave(user)
    if not db.mix_reanudar(user, campana["id"]):
        raise HTTPException(409, "Esa campaña ya cambió. Vuelve a abrir la pantalla.")
    return {"ok": True, "id": campana["id"]}
