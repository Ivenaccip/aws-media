"""M23 C3 — la Agenda: lo que Blotato todavía no ha publicado.

    GET  /api/agenda              una página de lo programado (?cursor=…)
    POST /api/agenda/reprogramar  {id, cuando}: le cambia SOLO la hora
    POST /api/agenda/cancelar     {id, confirmar:true}: Blotato ya no la publica

La fuente de verdad es Blotato, no nosotros: cada item de GET /schedules trae
su propio id sch_…, y ese mismo id viaja al PATCH y al DELETE. Por eso la
Agenda es GLOBAL (no cuelga de /editor/{name}: no hay proyecto que validar) y
por eso reprogramar y cancelar funcionan aunque no haya un registro nuestro.

Lo que se escribe de nuestro lado es siempre DESPUÉS y best-effort, para que el
modal de Publicar no siga prometiendo algo que ya no va a pasar: 'cancelado' al
cancelar, y la hora nueva al reprogramar (si no, enseña la vieja durante horas y
al pasarla llega a decir «Enviando…»). Si eso falla, la operación vale igual:
en Blotato ya se hizo.

Reglas que este módulo no puede romper:
  * el PATCH manda ÚNICAMENTE scheduledTime. El PATCH de Blotato no hace merge:
    un `draft` parcial borra mediaUrls y target y deja programada una
    publicación sin video. Por eso ningún endpoint de aquí acepta `draft`.
  * cancelar exige confirmar:true ANTES de todo (no se deshace), y el GET del
    schedule va ANTES del DELETE: después ya no hay de dónde sacar la mediaUrl.
    Reprogramar hace lo mismo antes del PATCH, y por lo mismo.
  * lo que se escribe de nuestro lado se corrobora contra el schedule que
    acabamos de leer (plataforma y cuenta): el índice es sha256(media_url) y
    creérselo a ciegas puede marcar el registro equivocado.
  * los tres estados de la clave son distintos y nunca se mezclan: sin clave
    409 («conéctala»), almacén caído 503, clave rechazada por Blotato →
    reconectar (409 con su propio mensaje al reprogramar y al cancelar; al
    listar, 200 con la lista vacía y reconectar:true). Los dos 409 se
    distinguen por el MENSAJE, no por el código: los dos se arreglan
    conectando la cuenta, y la pantalla ofrece el enlace en los dos.
  * un fallo de Blotato al listar NO tumba la pantalla: 200 con la lista vacía
    y el motivo, porque una Agenda en blanco con un aviso se puede refrescar y
    un 502 no.
"""
from __future__ import annotations

import logging

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from pipeline import blotato, claves_usuario, publicaciones
from pipeline.db import usuario_actual
from server.publicar_api import _clave_o_error, _con_tope, _cuando

log = logging.getLogger("agenda_api")
router = APIRouter(prefix="/api/agenda")

PAGINA = 20            # una página por petición: encadenarlas no cabe en la Lambda
CURSOR_MAX = 512
# los timeouts de httpx son POR FASE (8 s cada una) y la Lambda de la API corta
# a los 29 s: el tope de verdad es este. Reprogramar y cancelar gastan DOS
# llamadas (el GET del schedule y el PATCH/DELETE), así que el peor caso son
# 2 × TOPE_S y todavía sobran más de 10 s para lo nuestro.
TOPE_S = 9.0
LAMBDA_S = 29.0        # lo que la Lambda de la API aguanta antes de cortar

ID_MALO = "Esa publicación programada no es válida. Actualiza la lista."
CURSOR_MALO = "No pudimos seguir la lista. Vuelve a abrir la Agenda."
FALTA_HORA = "Elige la fecha y hora nueva."
FALTA_CONFIRMAR = ("Falta confirmar:true — cancelar una publicación programada "
                   "no se puede deshacer")


# los topes son holgados a propósito: solo frenan un cuerpo absurdo. Un id de
# 200 caracteres o una fecha ilegible tienen que llegar a nuestras validaciones,
# que contestan en español; el 422 de Pydantic trae una lista en inglés que la
# pantalla no sabe enseñar.
class ReprogramarIn(BaseModel):
    id: str = Field("", max_length=256)
    cuando: str | None = Field(None, max_length=128)   # ISO 8601 con zona


class CancelarIn(BaseModel):
    id: str = Field("", max_length=256)
    confirmar: bool = False


def _usuario() -> str:
    user = usuario_actual()
    if not claves_usuario.id_valido(user):
        raise HTTPException(400, "No pudimos identificar tu cuenta. Vuelve a iniciar sesión.")
    return user


def _fallo(err: Exception, clave: str, contexto: str) -> HTTPException:
    """El fallo de Blotato ya traducido. Tres códigos, y cada uno es una
    pantalla distinta:

      404 — eso ya salió o ya no existe: no es un error nuestro ni del usuario,
            y la pantalla lo usa para repintar la lista;
      409 — hay que reconectar la clave (Blotato la rechazó). Es el ÚNICO
            código con el que la pantalla ofrece el enlace para conectar: con
            un 502 el usuario leería «conéctala de nuevo» sin dónde hacerlo. El
            mensaje lo redacta explicar_fallo, igual que los demás;
      502 — cualquier otro fallo de Blotato."""
    mensaje, reconectar = blotato.explicar_fallo(err, clave, contexto=contexto)
    if isinstance(err, httpx.HTTPStatusError) and err.response.status_code == 404:
        return HTTPException(404, mensaje)
    if reconectar:
        return HTTPException(409, mensaje)
    return HTTPException(502, mensaje)


def _leer_schedule(clave: str, sch_id: str, contexto: str) -> dict:
    """El schedule tal como Blotato lo tiene AHORA, leído ANTES de tocarlo.

    Va primero en cancelar y en reprogramar por la misma razón: es lo único que
    empareja la publicación con NUESTRO registro (la mediaUrl), y después del
    DELETE ya no existe. Un 404 aborta la operación entera —no hay nada que
    borrar ni que reprogramar, y hacerlo a ciegas sería peor—; cualquier otro
    fallo solo nos deja sin con qué actualizar nuestro registro, así que la
    operación sigue con {}."""
    try:
        return _con_tope(lambda: blotato.programado(clave, sch_id,
                                                    timeout=blotato.TIMEOUT_CORTO), TOPE_S)
    except Exception as err:  # noqa: BLE001
        if isinstance(err, httpx.HTTPStatusError) and err.response.status_code == 404:
            raise HTTPException(404, blotato.explicar_fallo(err, clave,
                                                            contexto=contexto)[0])
        log.warning("leer la publicación programada antes de %s: %s",
                    contexto, type(err).__name__)
        return {}


def _es_el_mismo(sch: dict, reg: dict) -> bool:
    """¿El schedule que acabamos de leer y NUESTRO registro son la misma
    publicación?

    El índice es sha256(media_url) y hasta aquí se creía a ciegas: si el enlace
    quedó apuntando a otra publicación (o dos compartieran URL), marcaríamos la
    equivocada. Lo que Blotato NO manda no contradice nada: muchos schedules
    llegan sin accountId, y exigirlo dejaría sin actualizar registros
    perfectamente buenos."""
    plataforma, cuenta = blotato.identidad_de(sch)
    mia = str(reg.get("plataforma") or "").strip().lower()
    mi_cuenta = str(reg.get("cuenta_id") or "").strip()
    return not ((plataforma and mia and plataforma != mia)
                or (cuenta and mi_cuenta and cuenta != mi_cuenta))


def _escribir_nuestro(user: str, sch: dict, **cambios) -> bool:
    """Aplica `cambios` a NUESTRO registro de este schedule (None borra la
    clave). Best-effort: devuelve False y no levanta nada si algo falla — en
    Blotato el cambio YA se hizo, y un 500 aquí haría que el usuario lo
    reintentara.

    Solo se toca un registro cuyo vista()['estado'] sea 'programado', jamás
    reg['estado']: los estados degradados no se persisten (en disco sigue
    diciendo 'creando' lo que la pantalla enseña como 'incierto'), y guardar()
    pisa reg['actualizado'] SIEMPRE, así que escribir uno en TRABAJANDO le
    regalaría 20 minutos de vida al worker que aún podría publicarlo."""
    try:
        media = blotato.media_de(sch)
        if not media:
            return False
        par = publicaciones.enlace(user, media)
        if not par:
            # publicación anterior a C3 (nunca se guardó su publicUrl) o
            # cancelada desde blotato.com: no hay nada que reconstruir
            return False
        proyecto, pub_id = par
        reg, etag = publicaciones.leer(user, proyecto, pub_id)
        if reg is None or publicaciones.vista(reg)["estado"] != "programado":
            return False
        if not _es_el_mismo(sch, reg):
            log.warning("el registro enlazado no es de este schedule: no se toca")
            return False
        for clave, valor in cambios.items():
            if valor is None:
                reg.pop(clave, None)
            else:
                reg[clave] = valor
        try:
            publicaciones.guardar(user, proyecto, reg, etag)
        except publicaciones.Conflicto:
            return False   # alguien más lo escribió: lo suyo es más nuevo
        return True
    except Exception as err:  # noqa: BLE001 — en Blotato ya se hizo
        log.warning("actualizar nuestra publicación: %s", type(err).__name__)
        return False


@router.get("")
def listar(cursor: str | None = None):
    """Una página de lo programado. CERO lecturas de S3 y exactamente una
    llamada a Blotato: el modal de Publicar ya gasta hasta 3 GET /posts por
    carga contra el mismo límite de 60/min."""
    user = _usuario()
    if cursor is not None and not 1 <= len(cursor) <= CURSOR_MAX:
        raise HTTPException(422, CURSOR_MALO)
    clave = _clave_o_error(user)
    try:
        pagina = _con_tope(lambda: blotato.programados(clave, limite=PAGINA, cursor=cursor,
                                                       timeout=blotato.TIMEOUT_CORTO), TOPE_S)
    except Exception as err:  # noqa: BLE001 — TimeoutError incluido: «no respondió»
        # la pantalla se pinta igual: vacía, con el motivo y con «Actualizar»
        log.warning("listar la agenda: %s", type(err).__name__)
        error, reconectar = blotato.explicar_fallo(err, clave, contexto="agenda")
        return {"items": [], "cursor": None, "total": None,
                "error": error, "reconectar": reconectar}
    return {"items": [blotato.vista_programado(i) for i in pagina["items"]],
            "cursor": pagina["cursor"], "total": pagina["total"],
            "error": None, "reconectar": False}


@router.post("/reprogramar")
def reprogramar(body: ReprogramarIn):
    """Le cambia la hora a una publicación programada. Nada más: ni el texto,
    ni el video, ni la cuenta (ver el aviso del PATCH en el docstring)."""
    user = _usuario()
    if not blotato.id_valido(body.id):
        raise HTTPException(422, ID_MALO)
    # la fecha se valida ANTES de tocar la red: una hora imposible no gasta una
    # de las 60 llamadas por minuto del usuario
    cuando = _cuando(body.cuando, sugerencia="")
    if cuando is None:
        raise HTTPException(422, FALTA_HORA)
    clave = _clave_o_error(user)
    # el GET va ANTES del PATCH, igual que en cancelar y por lo mismo: la
    # mediaUrl es lo único que empareja esto con nuestro registro
    sch = _leer_schedule(clave, body.id, "reprogramar")
    try:
        _con_tope(lambda: blotato.reprogramar(clave, body.id, cuando=cuando,
                                              timeout=blotato.TIMEOUT_CORTO), TOPE_S)
    except Exception as err:  # noqa: BLE001
        log.warning("reprogramar en Blotato: %s", type(err).__name__)
        raise _fallo(err, clave, "reprogramar")
    # y DESPUÉS, best-effort, la hora nueva en nuestro registro: sin esto el
    # modal de Publicar enseña la hora vieja durante horas y, al pasar esa hora,
    # llega a decir «Enviando…» de algo que no sale hasta mañana. Va después del
    # PATCH a propósito: guardarla antes la haría «saltar» hacia atrás si el
    # PATCH falla.
    return {"id": body.id, "cuando": cuando,
            "nuestra": _escribir_nuestro(user, sch, cuando=cuando)}


@router.post("/cancelar")
def cancelar(body: CancelarIn):
    """Blotato deja de tener esa publicación. No se deshace."""
    # el gate va PRIMERO, antes incluso de mirar la clave: sin confirmar:true no
    # se toca nada de nadie
    if body.confirmar is not True:
        raise HTTPException(428, FALTA_CONFIRMAR)
    user = _usuario()
    if not blotato.id_valido(body.id):
        raise HTTPException(422, ID_MALO)
    clave = _clave_o_error(user)
    # el GET va ANTES del DELETE: después el schedule ya no existe y la mediaUrl
    # es lo único que empareja esto con nuestro registro
    sch = _leer_schedule(clave, body.id, "cancelar")
    try:
        _con_tope(lambda: blotato.cancelar(clave, body.id,
                                           timeout=blotato.TIMEOUT_CORTO), TOPE_S)
    except Exception as err:  # noqa: BLE001
        log.warning("cancelar en Blotato: %s", type(err).__name__)
        raise _fallo(err, clave, "cancelar")
    return {"id": body.id, "cancelado": True,
            "nuestra": _escribir_nuestro(user, sch, estado="cancelado", error=None)}
