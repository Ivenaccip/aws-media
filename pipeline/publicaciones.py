"""M23 C2 — el registro de cada publicación que se manda a Blotato.

Una publicación es un JSON:
  nube   S3 usuarios/<user>/publicaciones/<proyecto>/<id>.json
         (el usuario va en la ruta: el prefijo videos/<nombre>/ no lleva dueño)
  local  <proyecto>/work/publicaciones/<id>.json

Publicar es público e irreversible, y la cola de trabajos entrega AL MENOS una
vez y reintenta. Por eso:
  pendiente → subiendo   el worker la reclama con una escritura condicional
                         (If-Match): si otro ya la tomó, no hace nada
  subiendo               mientras sube, el worker renueva `actualizado` (latido)
  subiendo → creando     se marca justo ANTES de pedirle el post a Blotato
  creando → enviado | programado | error | incierto
  enviado → publicado | fallido      lo que diga GET /v2/posts/{id}

Un `subiendo` sin latido se muestra como error (todavía no se había creado
nada: se puede reintentar, y el worker ya no publica una subida vencida); un
`creando` viejo, como incierto (Blotato pudo haberlo recibido: hay que revisar
su calendario antes de reintentar). Un `pendiente` que lleva más de
VENCE_PENDIENTE_S en la fila ya no se publica.

Dos envíos iguales (mismo video, cuenta y red) no pueden ir a la vez: el
segundo choca con el candado del primero (una escritura If-None-Match), no con
una lectura que puede llegar tarde.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import secrets
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

from . import blotato, claves_usuario, db, media_sync
from .storage import ruta_proyecto, videos_root

log = logging.getLogger("publicaciones")

EN_CURSO = ("pendiente", "subiendo", "creando", "enviado")
TRABAJANDO = ("pendiente", "subiendo", "creando")     # ocupan el worker
# nunca se encolaron (otra igual iba en camino, o el candado falló): no se muestran
OCULTOS = ("duplicado", "descartado")
VENCE_PENDIENTE_S = 30 * 60
VENCE_TRABAJO_S = 20 * 60            # > timeout del worker (15 min); el latido es cada 60 s
SIN_RESPUESTA_S = 6 * 3600           # tras esto se pregunta a Blotato mucho menos
CONSULTA_CADA_S = 10
CONSULTA_LENTA_S = 10 * 60
MAX_LISTA = 20
_ID = re.compile(r"[0-9a-f]{12}")
_LOCK = threading.Lock()


class Conflicto(Exception):
    """Otro escribió el registro entre nuestra lectura y nuestra escritura."""


class EnCurso(Exception):
    """Ya se está enviando esa misma publicación."""


def ahora() -> float:
    return time.time()


def nuevo_id() -> str:
    return secrets.token_hex(6)


def _nube() -> bool:
    return db.backend() == "postgres"


def _validar(user_id: str, proyecto: str, pub_id: str | None = None) -> None:
    if not claves_usuario.id_valido(user_id):
        raise ValueError("usuario inválido")
    ruta_proyecto(proyecto)                       # lanza ValueError si no sirve
    if pub_id is not None and not _ID.fullmatch(pub_id):
        raise ValueError("publicación inválida")


def _ubicacion(user_id: str, proyecto: str, nombre: str,
               carpeta: str = "publicaciones") -> str | Path:
    if _nube():
        return f"usuarios/{user_id}/{carpeta}/{proyecto}/{nombre}.json"
    return ruta_proyecto(proyecto) / "work" / carpeta / f"{nombre}.json"


def _etag_local(crudo: bytes) -> str:
    return hashlib.sha256(crudo).hexdigest()


# --- almacén -----------------------------------------------------------------

def _leer_en(ubic: str | Path) -> tuple[dict | None, str | None]:
    if isinstance(ubic, str):
        s3 = media_sync._s3()
        try:
            r = s3.get_object(Bucket=media_sync._bucket(), Key=ubic)
        except s3.exceptions.NoSuchKey:
            return None, None
        return json.loads(r["Body"].read()), r["ETag"]
    try:
        # bajo el mismo candado que la escritura: en Windows, reemplazar un
        # archivo que otro tiene abierto falla
        with _LOCK:
            crudo = ubic.read_bytes()
    except FileNotFoundError:
        return None, None
    return json.loads(crudo), _etag_local(crudo)


def _reemplazar(tmp: Path, ruta: Path) -> None:
    for intento in range(10):
        try:
            tmp.replace(ruta)
            return
        except PermissionError:      # Windows: un antivirus o un lector externo
            if intento == 9:
                tmp.unlink(missing_ok=True)
                raise
            time.sleep(0.02)


def _escribir_en(ubic: str | Path, datos: dict, etag: str | None = None,
                 nuevo: bool = False) -> str:
    """Escribe y devuelve la etiqueta nueva. Con `etag` solo escribe si nadie
    cambió el objeto; con `nuevo` solo si no existe. Si no, Conflicto."""
    crudo = json.dumps(datos, ensure_ascii=False).encode("utf-8")
    if isinstance(ubic, str):
        s3 = media_sync._s3()
        extra = {"IfNoneMatch": "*"} if nuevo else {"IfMatch": etag} if etag else {}
        try:
            r = s3.put_object(Bucket=media_sync._bucket(), Key=ubic, Body=crudo,
                              ContentType="application/json", **extra)
        except s3.exceptions.ClientError as err:
            codigo = err.response.get("Error", {}).get("Code", "")
            if codigo in ("PreconditionFailed", "ConditionalRequestConflict"):
                raise Conflicto(ubic) from None
            raise
        return r["ETag"]
    with _LOCK:
        try:
            actual = ubic.read_bytes()
        except FileNotFoundError:
            actual = None
        if (nuevo and actual is not None) or (
                etag and (actual is None or _etag_local(actual) != etag)):
            raise Conflicto(str(ubic))
        ubic.parent.mkdir(parents=True, exist_ok=True)
        tmp = ubic.with_suffix(f".{os.getpid()}.{threading.get_ident()}.tmp")
        tmp.write_bytes(crudo)
        _reemplazar(tmp, ubic)
    return _etag_local(crudo)


def _leer(user_id: str, proyecto: str, pub_id: str) -> tuple[dict | None, str | None]:
    return _leer_en(_ubicacion(user_id, proyecto, pub_id))


def _escribir(user_id: str, proyecto: str, reg: dict, etag: str | None = None,
              nuevo: bool = False) -> str:
    return _escribir_en(_ubicacion(user_id, proyecto, reg["id"]), reg, etag, nuevo)


def _ubic_candado(user_id: str, proyecto: str, candado: str) -> str | Path:
    nombre = hashlib.sha256(candado.encode("utf-8")).hexdigest()
    return _ubicacion(user_id, proyecto, nombre, carpeta="publicaciones-candados")


def ocupado(user_id: str, proyecto: str, candado: str) -> bool:
    """Lectura rápida (sin garantía) de si otra igual va en camino: evita
    escribir un registro para cada doble clic que igual va a chocar."""
    actual, _ = _leer_en(_ubic_candado(user_id, proyecto, candado))
    otro_id = str((actual or {}).get("id") or "")
    if not _ID.fullmatch(otro_id):
        return False
    otro, _ = _leer(user_id, proyecto, otro_id)
    return otro is not None and vista(otro)["en_curso"]


def _tomar_candado(user_id: str, proyecto: str, candado: str, pub_id: str) -> None:
    """EnCurso si otra publicación con el mismo candado sigue en camino."""
    ubic = _ubic_candado(user_id, proyecto, candado)
    try:
        _escribir_en(ubic, {"id": pub_id}, nuevo=True)
        return
    except Conflicto:
        pass
    actual, etag = _leer_en(ubic)
    otro_id = str((actual or {}).get("id") or "")
    if otro_id == pub_id:
        return          # un reintento de botocore: el candado ya es nuestro
    if _ID.fullmatch(otro_id):
        otro, _ = _leer(user_id, proyecto, otro_id)
        if otro is not None and vista(otro)["en_curso"]:
            raise EnCurso(otro_id)
    try:
        _escribir_en(ubic, {"id": pub_id}, etag=etag, nuevo=actual is None)
    except Conflicto:
        raise EnCurso("") from None            # otro lo tomó en este instante


def crear(user_id: str, proyecto: str, datos: dict, candado: str | None = None) -> dict:
    """Guarda la publicación en `pendiente`. Con `candado`, EnCurso si otra
    igual sigue en camino (la nueva queda oculta, `duplicado`)."""
    _validar(user_id, proyecto)
    if candado and ocupado(user_id, proyecto, candado):
        raise EnCurso("")
    t = ahora()
    reg = {**datos, "id": nuevo_id(), "proyecto": proyecto, "estado": "pendiente",
           "creado": t, "actualizado": t}
    try:
        _escribir(user_id, proyecto, reg, nuevo=True)
    except Exception:
        # un reintento interno de botocore puede recibir 412 aunque el primer
        # intento sí se escribió: el id es aleatorio, así que si está igual es nuestro
        try:
            actual, _ = _leer(user_id, proyecto, reg["id"])
        except Exception:  # noqa: BLE001
            actual = None
        if actual != reg:
            raise
    if candado:
        try:
            _tomar_candado(user_id, proyecto, candado, reg["id"])
        except Exception as err:
            # no se va a encolar: que no quede «pendiente» para siempre, ni
            # contando para el tope, ni dueña del candado
            reg["estado"] = "duplicado" if isinstance(err, EnCurso) else "descartado"
            try:
                _escribir(user_id, proyecto, reg)
            except Exception as err2:  # noqa: BLE001
                log.error("ocultar %s: %s", reg["id"], type(err2).__name__)
            raise
    return reg


def leer(user_id: str, proyecto: str, pub_id: str) -> tuple[dict | None, str | None]:
    _validar(user_id, proyecto, pub_id)
    return _leer(user_id, proyecto, pub_id)


def guardar(user_id: str, proyecto: str, reg: dict, etag: str | None = None) -> str:
    """Actualiza `reg` (con `etag`, solo si nadie lo cambió)."""
    _validar(user_id, proyecto, reg["id"])
    reg["actualizado"] = ahora()
    return _escribir(user_id, proyecto, reg, etag=etag)


def reclamar(user_id: str, proyecto: str, pub_id: str) -> tuple[dict, str] | None:
    """pendiente → subiendo, atómico. None si ya la tomó otro (o no existe, o
    se venció en la fila: entonces queda en error y no se publica)."""
    reg, etag = leer(user_id, proyecto, pub_id)
    if reg is None or reg.get("estado") != "pendiente":
        return None
    vencida = ahora() - float(reg.get("creado") or 0) > VENCE_PENDIENTE_S
    if vencida:
        reg.update(estado="error", error="Esperó demasiado en la fila y no se publicó. "
                                          "Intenta de nuevo.")
    else:
        reg["estado"] = "subiendo"
    try:
        etag = guardar(user_id, proyecto, reg, etag)
    except Conflicto:
        return None
    return None if vencida else (reg, etag)


def _ids_recientes(claves: list[tuple[str, float]], desde: float | None = None) -> list[str]:
    ids = []
    for k, t in sorted(claves, key=lambda c: c[1], reverse=True):
        nombre = k.rsplit("/", 1)[-1]
        if nombre.endswith(".json") and _ID.fullmatch(nombre[:-5]) and (desde is None or t >= desde):
            ids.append(nombre[:-5])
    return ids


def listar(user_id: str, proyecto: str) -> list[tuple[dict, str]]:
    """[(registro, etag)] de las MAX_LISTA más nuevas."""
    _validar(user_id, proyecto)
    if _nube():
        claves = media_sync.listar_prefijo_con_fecha(
            f"usuarios/{user_id}/publicaciones/{proyecto}/")
        # las modificadas más recientemente primero; se ordena por creación abajo
        ids = _ids_recientes(claves)[:MAX_LISTA * 2]
    else:
        carpeta = ruta_proyecto(proyecto) / "work" / "publicaciones"
        ids = [f.stem for f in carpeta.glob("*.json")] if carpeta.is_dir() else []
        ids = [i for i in ids if _ID.fullmatch(i)]
    filas = []
    for pub_id in ids:
        reg, etag = _leer(user_id, proyecto, pub_id)
        if reg is not None and reg.get("estado") not in OCULTOS:
            filas.append((reg, etag))
    filas.sort(key=lambda f: float(f[0].get("creado") or 0), reverse=True)
    return filas[:MAX_LISTA]


def en_camino(user_id: str) -> int:
    """Cuántas publicaciones de este usuario (en todos sus proyectos) están en
    la fila o subiéndose: cada una ocupa uno de los pocos workers."""
    if not claves_usuario.id_valido(user_id):
        raise ValueError("usuario inválido")
    desde = ahora() - VENCE_PENDIENTE_S - 120
    rutas: list[str | Path] = []
    if _nube():
        claves = media_sync.listar_prefijo_con_fecha(f"usuarios/{user_id}/publicaciones/")
        rutas = [k for k, t in claves if t >= desde and k.endswith(".json")
                 and _ID.fullmatch(k.rsplit("/", 1)[-1][:-5])]
    else:
        raiz = videos_root()
        if raiz.is_dir():
            rutas = [f for f in raiz.glob("*/work/publicaciones/*.json")
                     if _ID.fullmatch(f.stem) and f.stat().st_mtime >= desde]
    t = ahora()
    n = 0
    for ubic in rutas:
        reg, _ = _leer_en(ubic)
        if reg and reg.get("estado") in TRABAJANDO and vista(reg, t)["en_curso"]:
            n += 1
    return n


# --- lo que sabe Blotato -------------------------------------------------------

def _fecha(iso: str | None) -> float | None:
    try:
        return datetime.fromisoformat(str(iso).replace("Z", "+00:00")).timestamp()
    except (TypeError, ValueError):
        return None


def _desde(reg: dict) -> float:
    """Desde cuándo corre la espera de Blotato: la creación o la hora programada."""
    return max(float(reg.get("creado") or 0), _fecha(reg.get("cuando")) or 0)


def aplicar_estado(reg: dict, st: dict) -> bool:
    """Pasa al registro lo que respondió GET /v2/posts/{id}. True si cambió."""
    antes = (reg.get("estado"), reg.get("url"), reg.get("error"), reg.get("cuando"))
    status = st.get("status")
    if status == "published":
        url = st.get("publicUrl")
        reg.update(estado="publicado",
                   url=url if isinstance(url, str) and url.startswith("https://") else None)
    elif status == "failed":
        motivo = st.get("errorMessage")
        motivo = " ".join(motivo.split())[:200] if isinstance(motivo, str) else ""
        reg.update(estado="fallido",
                   error="Blotato no pudo publicarla" + (f": {motivo.rstrip('.')}." if motivo else ".")
                   + " Puedes intentarlo de nuevo.")
    elif status == "scheduled":
        reg["estado"] = "programado"
        if isinstance(st.get("scheduledTime"), str) and _fecha(st["scheduledTime"]):
            reg["cuando"] = st["scheduledTime"]
    elif status == "in-progress" and reg.get("estado") != "programado":
        # una programada que Blotato está subiendo sigue siendo «programado»:
        # su espera se cuenta desde la hora programada
        reg["estado"] = "enviado"
    return antes != (reg.get("estado"), reg.get("url"), reg.get("error"), reg.get("cuando"))


def por_consultar(reg: dict, t: float) -> bool:
    """¿Toca preguntarle a Blotato por esta? Nunca se deja de preguntar por una
    que tiene id de post; pasadas SIN_RESPUESTA_S, solo cada CONSULTA_LENTA_S."""
    if not blotato.id_valido(reg.get("post_id")):
        return False
    estado = reg.get("estado")
    if estado == "programado":
        cuando = _fecha(reg.get("cuando"))
        if cuando is None or t < cuando + 60:
            return False
    elif estado != "enviado":
        return False
    espera = CONSULTA_CADA_S if t - _desde(reg) < SIN_RESPUESTA_S else CONSULTA_LENTA_S
    return t - float(reg.get("consultado") or 0) >= espera


def refrescar(user_id: str, proyecto: str, clave: str, filas: list[tuple[dict, str]],
              max_consultas: int = 3, presupuesto_s: float = 8.0) -> None:
    """Pregunta a Blotato por las que siguen en camino (pocas y rápido: esto
    corre dentro de una petición de la pantalla)."""
    t0 = time.monotonic()
    hechas = 0
    for reg, etag in filas:
        if hechas >= max_consultas or time.monotonic() - t0 > presupuesto_s:
            break
        if not por_consultar(reg, ahora()):
            continue
        hechas += 1
        try:
            st = blotato.estado_post(clave, reg["post_id"])
        except Exception as err:  # noqa: BLE001 — la lista se muestra igual
            codigo = getattr(getattr(err, "response", None), "status_code", "")
            log.warning("estado de %s en Blotato: %s %s", reg["id"], type(err).__name__, codigo)
            if codigo == 404:
                reg["estado"] = "incierto"
            st = None
        if st is not None:
            aplicar_estado(reg, st)
        # también tras un fallo: una fila que siempre falla no se come el cupo
        reg["consultado"] = ahora()
        try:
            guardar(user_id, proyecto, reg, etag)
        except Conflicto:
            pass                      # el worker escribió primero
        except Exception as err:  # noqa: BLE001
            log.warning("guardar el estado de %s: %s", reg["id"], type(err).__name__)


# --- lo que ve la pantalla ------------------------------------------------------

MENSAJES = {
    "pendiente": "En la fila para enviarse…",
    "subiendo": "Subiendo el video a Blotato…",
    "creando": "Creando la publicación en Blotato…",
    "enviado": "Blotato la está publicando…",
    "incierto": ("No sabemos si llegó a Blotato. Revisa tu calendario de Blotato "
                 "antes de intentarlo de nuevo."),
}


def vista(reg: dict, t: float | None = None) -> dict:
    """Lo que se le enseña al usuario: sin su id, sin la key de S3, con los
    estados viejos ya resueltos."""
    t = ahora() if t is None else t
    estado = reg.get("estado")
    mensaje = reg.get("error")
    edad = t - float(reg.get("actualizado") or reg.get("creado") or 0)
    if estado == "pendiente" and t - float(reg.get("creado") or 0) > VENCE_PENDIENTE_S + 60:
        estado, mensaje = "error", "Esperó demasiado en la fila y no se publicó. Intenta de nuevo."
    elif estado == "subiendo" and edad > VENCE_TRABAJO_S:
        estado, mensaje = "error", "La subida se interrumpió y no se publicó nada. Intenta de nuevo."
    elif estado == "creando" and edad > VENCE_TRABAJO_S:
        estado = "incierto"
    elif estado == "enviado" and not blotato.id_valido(reg.get("post_id")):
        estado = "incierto"
    if estado in MENSAJES:
        mensaje = MENSAJES[estado]
    if estado in TRABAJANDO:
        en_curso = True
    elif estado == "enviado":
        en_curso = t - _desde(reg) < SIN_RESPUESTA_S
        if not en_curso:
            mensaje = ("Blotato todavía no confirma si se publicó. "
                       "Revisa tu calendario de Blotato.")
    elif estado == "programado":
        cuando = _fecha(reg.get("cuando"))
        # ya pasó la hora: la pantalla sigue preguntando hasta saber cómo le fue
        en_curso = cuando is not None and cuando + 60 < t < cuando + SIN_RESPUESTA_S
    else:
        en_curso = False
    return {"id": reg.get("id"), "plataforma": reg.get("plataforma"),
            "cuenta_nombre": reg.get("cuenta_nombre") or "",
            "archivo": reg.get("archivo"), "titulo": reg.get("titulo") or None,
            "texto": str(reg.get("texto") or "")[:200],
            "cuando": reg.get("cuando"), "estado": estado, "en_curso": en_curso,
            # hay algo que preguntarle a Blotato aunque no esté en curso
            "revisar": por_consultar(reg, t),
            "creado": int(float(reg.get("creado") or 0)),
            "url": reg.get("url") if estado == "publicado" else None,
            "mensaje": mensaje if estado not in ("programado", "publicado") else None}
