"""Guía de clases · S1 — el admin «Clases», SIN GASTO.

El dueño crea las clases, sube el video de cada una DIRECTO a S3, lo confirma, mide su duración, lo ve
y archiva o restaura clases. Nada de lo de aquí llama a un proveedor de pago (ni AssemblyAI, ni Gemini,
ni OpenAI): procesar, el costo, el trabajo, el texto, publicar y las palabras clave llegan en S4.

    GET    /api/admin/clases?archivadas=0|1   las clases + los límites (la web no copia ninguno)
    POST   /api/admin/clases                  crear (idempotente por `clave`; número único entre vivas)
    PATCH  /api/admin/clases/{id}             editar número, título, resumen, fecha o liga
    POST   /api/admin/clases/{id}/subida      URL de subida (PUT a S3); borrador → subiendo
    POST   /api/admin/clases/{id}/confirmar   HEAD a S3; subiendo → subido
    POST   /api/admin/clases/{id}/medir       ffprobe sobre una URL firmada (8 s) → duración
    POST   /api/admin/clases/{id}/cancelar    subiendo → borrador
    GET    /api/admin/clases/{id}/video       vista previa del dueño: URL firmada de 2 h
    DELETE /api/admin/clases/{id}             ARCHIVA (borrado suave); no toca S3
    POST   /api/admin/clases/{id}/restaurar   deshace el archivado

Reglas que no se negocian:

  - **Solo el grupo `admin`, por el ROUTER.** `_exigir_admin` es una dependencia del router: una ruta
    nueva no puede olvidarla. `tests/test_clases_admin.py` recorre `app.routes` y exige 403 a un
    no-admin y 401 sin token en TODO lo que cuelgue de `/api/admin/clases`.
  - **Nada que venga del navegador es una clave de S3, un precio ni una duración.** El id y la clave
    (`clases/<id>/video.<ext>`) los fabrica el servidor; la extensión y el tipo salen de una lista
    cerrada; la duración la mide ffprobe. Los cuerpos llevan `extra="forbid"`: una `key` de más es 422.
  - **Los videos de `clases/` no los sirve el CDN, nunca.** La subida y la vista previa van con URLs
    firmadas de S3 (`media_sync.url_subida` / `url_firmada`, no `url_media`).
  - **NADA se borra en S3.** El rol de la Lambda no tiene `s3:DeleteObject` a propósito (las versiones
    no se borran); archivar solo escribe `archivada_en`. Un test revienta si algo llama `delete_*`.
  - **Los cambios de estado son comparar-y-cambiar en UNA sentencia** (`db.clases_*`): de dos subidas
    a la vez gana una. El que pierde recibe `estado_no_permite` (409).
  - **Ni URLs firmadas, ni ARNs, ni texto de nadie en logs ni en errores.** El log lleva el id de la
    clase y la transición; los errores, el catálogo de abajo (el `error` de la clase, un texto fijo).

Todos los errores son `HTTPException(status, {"codigo", "texto"})`, con el `texto` listo para mostrarse.
Las rutas de segmento fijo (en S4: `/costo`, `/palabras-clave`) se declaran ANTES de las de `/{id}`.
"""
from __future__ import annotations

import logging
import os
from typing import Any, Callable, Literal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, StrictInt, StrictStr

from pipeline import clases, db, media_sync
from server import auth, edicion_api

log = logging.getLogger("clases_admin")

_SIN_CACHE = {"Cache-Control": "no-store"}      # las respuestas con una URL firmada no se guardan

# ---------------------------------------------------------------------------
# el catálogo de errores: {codigo: (estado HTTP, texto para la persona)}

ERRORES: dict[str, tuple[int, str]] = {
    "no_admin": (403, "Solo para administradores"),
    "no_nube": (503, "Las clases viven en el servicio en AWS, no en tu computadora."),
    "no_disponible": (503, "Las clases no están disponibles ahora. Inténtalo en unos minutos."),
    "sin_s3": (503, "Las subidas a S3 no están disponibles en esta instalación."),
    "no_existe": (404, "Esa clase no existe."),
    "titulo_invalido": (422, f"Escribe un título de 1 a {clases.TITULO_MAX} caracteres."),
    "numero_invalido": (422, f"El número de la clase va de {clases.NUMERO_MIN} a {clases.NUMERO_MAX}."),
    "numero_repetido": (409, "Ya hay otra clase con ese número. Elige otro o archiva la otra."),
    "resumen_largo": (422, f"El «para qué sirve» pasa de {clases.RESUMEN_MAX} caracteres. Acórtalo un poco."),
    "fecha_invalida": (422, "La fecha tiene que ser real y venir como año-mes-día, por ejemplo 2026-03-12."),
    "liga_invalida": (422, "La liga tiene que empezar con https:// y apuntar a un sitio público, "
                           f"de {clases.LIGA_MAX} caracteres o menos, sin usuario ni contraseña."),
    "clave_invalida": (422, "No entendimos lo que mandaste. Recarga la página e inténtalo de nuevo."),
    "nombre_invalido": (422, "Ese nombre de archivo no sirve. Elige el archivo desde tu computadora."),
    "extension_no_soportada": (422, "Ese tipo de archivo no se puede subir. Usa un video "
                                    + ", ".join(clases.EXTENSIONES) + "."),
    "tipo_no_soportado": (422, "Ese tipo de video no se puede subir. Usa un video "
                               + ", ".join(clases.EXTENSIONES) + "."),
    "tamano_invalido": (422, "El tamaño del video no sirve: tiene que pesar entre 1 byte y 5 GB."),
    "video_vacio": (422, "El archivo que llegó a S3 está vacío. Cancela y vuelve a subir el video."),
    "estado_no_permite": (409, "Eso no se puede hacer con la clase tal como está ahora."),
    "origen_liga": (409, "Esta clase es una liga: no lleva video que subir."),
    "archivo_no_esta": (404, "El video no llegó a S3. Cancela y vuelve a subirlo; si se cortó la "
                             "conexión, el PUT no terminó."),
    "s3_fallo": (502, "No pudimos hablar con S3 ahora. Inténtalo de nuevo en unos minutos."),
    "medir_fallo": (502, "No pudimos leer la duración del video. Inténtalo otra vez; si sigue, "
                         "revisa que el archivo sea un video que abra."),
}

# lo que se guarda en `clases.error` cuando medir falla: un texto fijo, jamás el mensaje de una excepción
_ERROR_MEDIR = "No pudimos leer la duración del video."


def falla(codigo: str, texto: str | None = None, **extras: Any) -> HTTPException:
    status, base = ERRORES[codigo]
    return HTTPException(status, {"codigo": codigo, "texto": texto or base, **extras})


def _exigir_admin() -> None:
    """La dependencia DEL ROUTER. 403 si el token no trae el grupo `admin` (el middleware ya validó el
    token: sin él ni llega aquí); 503 si el estado no vive en Postgres (dev local con json)."""
    if not auth.es_admin():
        raise falla("no_admin")
    if db.backend() != "postgres":
        raise falla("no_nube")


router = APIRouter(prefix="/api/admin/clases", tags=["clases-admin"],
                   dependencies=[Depends(_exigir_admin)])


# ---------------------------------------------------------------------------
# piezas comunes

class _Cuerpo(BaseModel):
    """Todo cuerpo rechaza campos que no conoce: una `key` o un precio de más es un 422."""
    model_config = ConfigDict(extra="forbid")


def _bd(fn: Callable, *args, **kwargs):
    """Una llamada a la base. Si falla por algo que no es un conflicto que el llamador espera (la
    tabla no existe porque falta `tools/db_migrate.py`, Aurora no responde) sale un 503 limpio, sin el
    mensaje de la excepción (trae rutas y nombres de infraestructura). El despertar de Aurora y los
    conflictos de número e id tienen su propio manejo."""
    try:
        return fn(*args, **kwargs)
    except (db.DespertandoError, db.ClaseNumeroRepetido, db.ClaseIdRepetido):
        raise
    except Exception as err:  # noqa: BLE001 — el mensaje no sale; solo la clase del error
        log.warning("clases: la base falló (%s)", type(err).__name__)
        raise falla("no_disponible") from None


def _validar(fn: Callable, *args):
    try:
        return fn(*args)
    except clases.ValorInvalido as err:
        raise falla(err.codigo) from None


def _id(clase_id: str) -> str:
    """El id de la ruta. Uno con otro formato no existe: ni se consulta."""
    if not clases.es_id(clase_id):
        raise falla("no_existe")
    return clase_id


def _viva(id_: str) -> dict:
    """La clase, o 404 si no existe o está archivada (lo único que se puede hacer con una archivada
    es verla, restaurarla o volver a archivarla)."""
    fila = _bd(db.clases_obtener, id_)
    if fila is None or fila["archivada_en"]:
        raise falla("no_existe")
    return fila


def _estado_no_permite(fila: dict) -> HTTPException:
    return falla("estado_no_permite", estado=fila["estado"])


def _tras_cas_fallido(id_: str) -> HTTPException:
    """El comparar-y-cambiar no devolvió fila. ¿Por qué? Se vuelve a leer SOLO para escoger el error:
    quien decidió fue la base."""
    fila = _bd(db.clases_obtener, id_)
    if fila is None or fila["archivada_en"]:
        return falla("no_existe")
    return _estado_no_permite(fila)


def _bucket() -> None:
    if not os.getenv("MEDIA_BUCKET"):
        raise falla("sin_s3")


def _publica(f: dict) -> dict:
    """La clase como la ve la web. NO lleva `video_key` (la clave de S3 es del servidor)."""
    indice = None
    if f["indice_version"]:
        indice = {"version": f["indice_version"], "modelo": f["indice_modelo"],
                  "trozos": f["trozos_n"], "en": f["indexada_en"]}
    return {
        "id": f["id"], "numero": f["numero"], "titulo": f["titulo"], "resumen": f["resumen"],
        "grabada_en": f["grabada_en"], "origen": f["origen"],
        "nombre_original": f["nombre_original"], "liga": f["liga"], "bytes": f["bytes"],
        "duracion_s": f["duracion_s"], "estado": f["estado"], "paso": None, "error": f["error"],
        "publicada": f["publicada"], "indice": indice, "creado": f["creado"],
        "actualizado": f["actualizado"], "archivada_en": f["archivada_en"],
    }


def _clase(f: dict) -> dict:
    return {"clase": _publica(f)}


# ---------------------------------------------------------------------------
# lista y alta (rutas de la raíz: sin parámetros, van primero)

@router.get("")
def listar(archivadas: bool = False):
    filas = _bd(db.clases_listar, archivadas)
    return {"clases": [_publica(f) for f in filas], "limites": clases.limites()}


class CrearIn(_Cuerpo):
    clave: StrictStr
    numero: StrictInt
    titulo: StrictStr
    resumen: StrictStr | None = None
    grabada_en: StrictStr | None = None
    origen: Literal["archivo", "liga"]
    liga: StrictStr | None = None


@router.post("", status_code=201)
def crear(body: CrearIn):
    clave = _validar(clases.validar_clave, body.clave)
    titulo = _validar(clases.validar_titulo, body.titulo)
    numero = _validar(clases.validar_numero, body.numero)
    resumen = _validar(clases.validar_resumen, body.resumen)
    grabada_en = _validar(clases.validar_fecha, body.grabada_en)
    if body.origen == "liga":
        if body.liga is None:
            raise falla("liga_invalida")
        liga = _validar(clases.validar_liga, body.liga)
    else:
        if body.liga is not None:
            raise falla("liga_invalida", "Una clase con archivo no lleva liga.")
        liga = None
    for _ in range(3):
        try:
            fila, creada = _bd(db.clases_crear, id_=clases.id_nuevo(), clave=clave, numero=numero,
                               titulo=titulo, resumen=resumen, grabada_en=grabada_en,
                               origen=body.origen, liga=liga, creado_por=db.usuario_actual())
        except db.ClaseNumeroRepetido:
            raise falla("numero_repetido") from None
        except db.ClaseIdRepetido:
            continue
        log.info("clase %s: %s", fila["id"], "creada" if creada else "ya existía (misma clave)")
        return _clase(fila)
    raise falla("no_disponible")


class EditarIn(_Cuerpo):
    numero: StrictInt | None = None
    titulo: StrictStr | None = None
    resumen: StrictStr | None = None
    grabada_en: StrictStr | None = None
    liga: StrictStr | None = None


@router.patch("/{clase_id}")
def editar(clase_id: str, body: EditarIn):
    id_ = _id(clase_id)
    cambios: dict[str, Any] = {}
    enviados = body.model_fields_set
    if "numero" in enviados:
        cambios["numero"] = _validar(clases.validar_numero, body.numero)
    if "titulo" in enviados:
        cambios["titulo"] = _validar(clases.validar_titulo, body.titulo)
    if "resumen" in enviados:
        cambios["resumen"] = _validar(clases.validar_resumen, body.resumen)
    if "grabada_en" in enviados:
        cambios["grabada_en"] = _validar(clases.validar_fecha, body.grabada_en)
    if "liga" in enviados:
        cambios["liga"] = _validar(clases.validar_liga, body.liga)
    actual = _viva(id_)
    if "liga" in cambios and actual["origen"] != "liga":
        raise falla("liga_invalida", "Una clase con archivo no lleva liga.")
    if not cambios:
        return _clase(actual)
    try:
        fila = _bd(db.clases_editar, id_, cambios)
    except db.ClaseNumeroRepetido:
        raise falla("numero_repetido") from None
    if fila is None:
        # la base no cambió nada: la archivaron en el medio, o ese número ya es de otra clase viva
        otra = _bd(db.clases_obtener, id_)
        if otra is None or otra["archivada_en"]:
            raise falla("no_existe")
        raise falla("numero_repetido")
    log.info("clase %s: editada", id_)
    return _clase(fila)


# ---------------------------------------------------------------------------
# subir el video: subida → (el navegador hace el PUT a S3) → confirmar → medir

class SubidaIn(_Cuerpo):
    archivo: StrictStr
    content_type: StrictStr
    bytes: StrictInt


@router.post("/{clase_id}/subida")
def subida(clase_id: str, body: SubidaIn):
    """Da la URL del PUT. La clave de S3 la decide el servidor: `clases/<id>/video.<ext>` con la
    extensión de una lista cerrada; el nombre del archivo solo se guarda para mostrarlo."""
    id_ = _id(clase_id)
    ext, nombre = _validar(clases.validar_archivo, body.archivo)
    tipo = _validar(clases.validar_content_type, body.content_type)
    _validar(clases.validar_tamano_declarado, body.bytes)
    _bucket()
    key = clases.clave_video(id_, ext)
    if _bd(db.clases_a_subiendo, id_, key, nombre, body.bytes) is None:
        fila = _bd(db.clases_obtener, id_)
        if fila is None or fila["archivada_en"]:
            raise falla("no_existe")
        if fila["origen"] != "archivo":
            raise falla("origen_liga")
        raise _estado_no_permite(fila)
    try:
        url = media_sync.url_subida(key, tipo, clases.PRESIGN_S)
    except Exception as err:  # noqa: BLE001 — sin el mensaje: puede traer la firma
        log.warning("clase %s: no se pudo firmar la subida (%s)", id_, type(err).__name__)
        url = None
    if not url:
        _bd(db.clases_cancelar, id_)          # la clase no se queda en `subiendo` sin URL
        raise falla("s3_fallo")
    log.info("clase %s: borrador → subiendo", id_)
    return JSONResponse({"url": url, "content_type": tipo, "expira_s": clases.PRESIGN_S},
                        headers=_SIN_CACHE)


class ConfirmarIn(_Cuerpo):
    nombre: StrictStr | None = None


def _cabecera(key: str) -> dict:
    """El HEAD del video en S3: 404 si no está, 502 si S3 no contestó."""
    try:
        cab = media_sync.cabecera(key)
    except Exception as err:  # noqa: BLE001 — red, credenciales: no es «no está»
        log.warning("cabecera %s: S3 falló (%s)", key, type(err).__name__)
        raise falla("s3_fallo") from None
    if cab is None:
        raise falla("archivo_no_esta")
    return cab


@router.post("/{clase_id}/confirmar")
def confirmar(clase_id: str, body: ConfirmarIn | None = None):
    """subiendo → subido, tras mirar el objeto en S3 (HEAD): que exista, que no esté vacío, que sea
    de un tipo de la lista y que pese lo mismo que se declaró al pedir la subida. No mide, no procesa
    y no llama a ningún proveedor. Confirmar una clase ya `subido` devuelve la clase (doble clic)."""
    id_ = _id(clase_id)
    _bucket()
    fila = _viva(id_)
    if fila["origen"] != "archivo":
        raise falla("origen_liga")
    if fila["estado"] == clases.SUBIDO:
        return _clase(fila)
    if fila["estado"] != clases.SUBIENDO or not fila["video_key"] or fila["bytes"] is None:
        raise _estado_no_permite(fila)
    cab = _cabecera(fila["video_key"])
    if cab["bytes"] <= 0:
        raise falla("video_vacio")
    if clases.tipo_de_cabecera(cab["content_type"]) not in clases.CONTENT_TYPES:
        raise falla("tipo_no_soportado")
    if cab["bytes"] > clases.MAX_BYTES or cab["bytes"] != fila["bytes"]:
        raise falla("tamano_invalido", "El video que llegó a S3 no pesa lo que dijiste al subirlo. "
                                       "Cancela y vuelve a subirlo.")
    nombre = clases.nombre_para_mostrar(body.nombre) if body else None
    nueva = _bd(db.clases_confirmar, id_, fila["video_key"], fila["bytes"], cab["bytes"], nombre)
    if nueva is None:
        otra = _viva(id_)                    # otra pestaña llegó antes: si ya quedó `subido`, es lo mismo
        if otra["estado"] == clases.SUBIDO and otra["video_key"] == fila["video_key"]:
            return _clase(otra)
        raise _estado_no_permite(otra)
    log.info("clase %s: subiendo → subido", id_)
    return _clase(nueva)


def _medir(key: str) -> dict | None:
    """ffprobe sobre una URL firmada de S3 (8 s, un reintento): el `_medir` de la edición, que ya
    redacta la firma antes de loguear. Devuelve `{"duracion_s", …}` o None."""
    return edicion_api._medir(key)


@router.post("/{clase_id}/medir")
def medir(clase_id: str):
    id_ = _id(clase_id)
    _bucket()
    fila = _viva(id_)
    if fila["origen"] != "archivo":
        raise falla("origen_liga")
    if fila["estado"] != clases.SUBIDO or not fila["video_key"]:
        raise _estado_no_permite(fila)
    med = _medir(fila["video_key"])
    if not med or not med.get("duracion_s"):
        _bd(db.clases_medida_fallo, id_, fila["video_key"], _ERROR_MEDIR)
        log.warning("clase %s: no se pudo medir", id_)
        raise falla("medir_fallo")
    nueva = _bd(db.clases_medida, id_, fila["video_key"], float(med["duracion_s"]))
    if nueva is None:
        raise _tras_cas_fallido(id_)
    log.info("clase %s: medida (%.1f s)", id_, nueva["duracion_s"])
    return _clase(nueva)


@router.post("/{clase_id}/cancelar")
def cancelar(clase_id: str):
    id_ = _id(clase_id)
    nueva = _bd(db.clases_cancelar, id_)
    if nueva is None:
        raise _tras_cas_fallido(id_)
    log.info("clase %s: subiendo → borrador", id_)
    return _clase(nueva)


# ---------------------------------------------------------------------------
# ver, archivar, restaurar

@router.get("/{clase_id}/video")
def video(clase_id: str):
    """La vista previa del dueño: una URL FIRMADA de S3 de 2 horas (`url_firmada`, no `url_media`: así
    el CDN nunca puede quedar en medio aunque alguien agregara `clases/` a su lista por error). Sirve
    también para una clase archivada: el dueño puede mirarla antes de restaurarla."""
    id_ = _id(clase_id)
    fila = _bd(db.clases_obtener, id_)
    if fila is None:
        raise falla("no_existe")
    if (fila["origen"] != "archivo" or not fila["video_key"]
            or fila["estado"] not in clases.ESTADOS_CON_VIDEO):
        raise falla("no_existe", "Esta clase todavía no tiene un video para ver.")
    _bucket()
    url = media_sync.url_firmada(fila["video_key"], clases.VISTA_S)
    if not url:
        raise falla("s3_fallo")
    return JSONResponse({"url": url, "expira_s": clases.VISTA_S}, headers=_SIN_CACHE)


@router.delete("/{clase_id}")
def archivar(clase_id: str):
    """Borrado SUAVE: solo escribe `archivada_en`. No toca S3 (el rol no puede borrar) ni cambia el
    estado. Archivar una ya archivada también responde ok."""
    id_ = _id(clase_id)
    if not _bd(db.clases_archivar, id_):
        raise falla("no_existe")
    log.info("clase %s: archivada", id_)
    return {"ok": True}


@router.post("/{clase_id}/restaurar")
def restaurar(clase_id: str):
    id_ = _id(clase_id)
    try:
        nueva = _bd(db.clases_restaurar, id_)
    except db.ClaseNumeroRepetido:
        raise falla("numero_repetido") from None
    if nueva is not None:
        log.info("clase %s: restaurada", id_)
        return _clase(nueva)
    fila = _bd(db.clases_obtener, id_)
    if fila is None:
        raise falla("no_existe")
    if fila["archivada_en"] is None:
        return _clase(fila)                  # ya estaba viva: restaurar es idempotente
    raise falla("numero_repetido", "Otra clase viva ya tiene ese número. Cámbiale el número a "
                                   "la otra o archívala, y vuelve a restaurar esta.")
