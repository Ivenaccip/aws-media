"""M23 C2 — el registro de cada publicación que se manda a Blotato.

Una publicación es un JSON:
  nube   S3 usuarios/<user>/publicaciones/<proyecto>/<id>.json
         (el usuario va en la ruta: el prefijo videos/<nombre>/ no lleva dueño)
  local  <proyecto>/work/publicaciones/<id>.json

Publicar es público e irreversible, y la cola de trabajos entrega AL MENOS una
vez y reintenta. Por eso:
  pendiente → subiendo   el worker la reclama con una escritura condicional
                         (If-Match): si otro ya la tomó, no hace nada
  subiendo → creando     se marca justo ANTES de pedirle el post a Blotato
  creando → enviado | programado | error | incierto
  enviado → publicado | fallido      lo que diga GET /v2/posts/{id}

Un `subiendo` viejo se muestra como error (todavía no se había creado nada:
se puede reintentar); un `creando` viejo, como incierto (Blotato pudo haberlo
recibido: hay que revisar su calendario antes de reintentar). Un `pendiente`
que lleva más de VENCE_PENDIENTE_S en la fila ya no se publica: así la
pantalla puede decir «no se envió» sin que la cola lo publique después.
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
from .storage import ruta_proyecto

log = logging.getLogger("publicaciones")

EN_CURSO = ("pendiente", "subiendo", "creando", "enviado")
VENCE_PENDIENTE_S = 30 * 60
VENCE_TRABAJO_S = 20 * 60            # > timeout del worker (15 min)
SIN_RESPUESTA_S = 6 * 3600           # tras esto se deja de preguntar a Blotato
CONSULTA_CADA_S = 10
MAX_LISTA = 20
_ID = re.compile(r"[0-9a-f]{12}")
_LOCK = threading.Lock()


class Conflicto(Exception):
    """Otro escribió la publicación entre nuestra lectura y nuestra escritura."""


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


def _prefijo(user_id: str, proyecto: str) -> str:
    return f"usuarios/{user_id}/publicaciones/{proyecto}/"


def _dir_local(proyecto: str) -> Path:
    return ruta_proyecto(proyecto) / "work" / "publicaciones"


def _etag_local(crudo: bytes) -> str:
    return hashlib.sha256(crudo).hexdigest()


# --- almacén -----------------------------------------------------------------

def _leer(user_id: str, proyecto: str, pub_id: str) -> tuple[dict | None, str | None]:
    if _nube():
        s3 = media_sync._s3()
        try:
            r = s3.get_object(Bucket=media_sync._bucket(),
                              Key=f"{_prefijo(user_id, proyecto)}{pub_id}.json")
        except s3.exceptions.NoSuchKey:
            return None, None
        return json.loads(r["Body"].read()), r["ETag"]
    ruta = _dir_local(proyecto) / f"{pub_id}.json"
    try:
        crudo = ruta.read_bytes()
    except FileNotFoundError:
        return None, None
    return json.loads(crudo), _etag_local(crudo)


def _escribir(user_id: str, proyecto: str, reg: dict, etag: str | None = None,
              nuevo: bool = False) -> str:
    """Escribe y devuelve la etiqueta nueva. Con `etag` solo escribe si nadie
    cambió el registro; con `nuevo` solo si no existe. Si no, Conflicto."""
    crudo = json.dumps(reg, ensure_ascii=False).encode("utf-8")
    if _nube():
        s3 = media_sync._s3()
        extra = {"IfNoneMatch": "*"} if nuevo else {"IfMatch": etag} if etag else {}
        try:
            r = s3.put_object(Bucket=media_sync._bucket(),
                              Key=f"{_prefijo(user_id, proyecto)}{reg['id']}.json",
                              Body=crudo, ContentType="application/json", **extra)
        except s3.exceptions.ClientError as err:
            codigo = err.response.get("Error", {}).get("Code", "")
            if codigo in ("PreconditionFailed", "ConditionalRequestConflict"):
                raise Conflicto(reg["id"]) from None
            raise
        return r["ETag"]
    carpeta = _dir_local(proyecto)
    ruta = carpeta / f"{reg['id']}.json"
    with _LOCK:
        try:
            actual = ruta.read_bytes()
        except FileNotFoundError:
            actual = None
        if (nuevo and actual is not None) or (
                etag and (actual is None or _etag_local(actual) != etag)):
            raise Conflicto(reg["id"])
        carpeta.mkdir(parents=True, exist_ok=True)
        tmp = ruta.with_suffix(f".{os.getpid()}.{threading.get_ident()}.tmp")
        tmp.write_bytes(crudo)
        tmp.replace(ruta)
    return _etag_local(crudo)


def crear(user_id: str, proyecto: str, datos: dict) -> dict:
    _validar(user_id, proyecto)
    t = ahora()
    reg = {**datos, "id": nuevo_id(), "proyecto": proyecto, "estado": "pendiente",
           "creado": t, "actualizado": t}
    _escribir(user_id, proyecto, reg, nuevo=True)
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


def listar(user_id: str, proyecto: str) -> list[tuple[dict, str]]:
    """[(registro, etag)] de las MAX_LISTA más nuevas."""
    _validar(user_id, proyecto)
    if _nube():
        claves = media_sync.listar_prefijo_con_fecha(_prefijo(user_id, proyecto))
        # las modificadas más recientemente primero; se ordena por creación abajo
        ids = [k.rsplit("/", 1)[-1][:-len(".json")]
               for k, _ in sorted(claves, key=lambda c: c[1], reverse=True)
               if k.endswith(".json")]
        ids = [i for i in ids if _ID.fullmatch(i)][:MAX_LISTA * 2]
    else:
        carpeta = _dir_local(proyecto)
        ids = [f.stem for f in carpeta.glob("*.json")] if carpeta.is_dir() else []
        ids = [i for i in ids if _ID.fullmatch(i)]
    filas = []
    for pub_id in ids:
        reg, etag = _leer(user_id, proyecto, pub_id)
        if reg is not None:
            filas.append((reg, etag))
    filas.sort(key=lambda f: float(f[0].get("creado") or 0), reverse=True)
    return filas[:MAX_LISTA]


# --- lo que sabe Blotato -------------------------------------------------------

def _fecha(iso: str | None) -> float | None:
    try:
        return datetime.fromisoformat(str(iso).replace("Z", "+00:00")).timestamp()
    except (TypeError, ValueError):
        return None


def aplicar_estado(reg: dict, st: dict) -> bool:
    """Pasa al registro lo que respondió GET /v2/posts/{id}. True si cambió."""
    antes = (reg.get("estado"), reg.get("url"), reg.get("error"))
    status = st.get("status")
    if status == "published":
        url = st.get("publicUrl")
        reg.update(estado="publicado",
                   url=url if isinstance(url, str) and url.startswith("https://") else None)
    elif status == "failed":
        motivo = st.get("errorMessage")
        motivo = " ".join(motivo.split())[:200] if isinstance(motivo, str) else ""
        reg.update(estado="fallido",
                   error="Blotato no pudo publicarla" + (f": {motivo}" if motivo else "."))
    elif status == "scheduled":
        reg["estado"] = "programado"
        if isinstance(st.get("scheduledTime"), str) and _fecha(st["scheduledTime"]):
            reg["cuando"] = st["scheduledTime"]
    elif status == "in-progress":
        reg["estado"] = "enviado"
    return antes != (reg.get("estado"), reg.get("url"), reg.get("error"))


def por_consultar(reg: dict, t: float) -> bool:
    if not blotato.id_valido(reg.get("post_id")):
        return False
    if t - float(reg.get("consultado") or 0) < CONSULTA_CADA_S:
        return False
    if reg.get("estado") == "enviado":
        return t - float(reg.get("creado") or 0) < SIN_RESPUESTA_S
    if reg.get("estado") == "programado":
        cuando = _fecha(reg.get("cuando"))
        return cuando is not None and cuando + 60 < t < cuando + SIN_RESPUESTA_S
    return False


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
            continue
        aplicar_estado(reg, st)
        reg["consultado"] = ahora()
        try:
            guardar(user_id, proyecto, reg, etag)
        except Conflicto:
            pass                      # el worker escribió lo mismo primero
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
    elif estado == "enviado" and t - float(reg.get("creado") or 0) > SIN_RESPUESTA_S:
        estado = "incierto"
    if estado in MENSAJES:
        mensaje = MENSAJES[estado]
    en_curso = estado in EN_CURSO
    if estado == "programado":
        cuando = _fecha(reg.get("cuando"))
        # ya pasó la hora: la pantalla sigue preguntando hasta saber cómo le fue
        en_curso = cuando is not None and cuando + 60 < t < cuando + SIN_RESPUESTA_S
    return {"id": reg.get("id"), "plataforma": reg.get("plataforma"),
            "cuenta_nombre": reg.get("cuenta_nombre") or "",
            "archivo": reg.get("archivo"), "titulo": reg.get("titulo") or None,
            "texto": str(reg.get("texto") or "")[:200],
            "cuando": reg.get("cuando"), "estado": estado, "en_curso": en_curso,
            "creado": int(float(reg.get("creado") or 0)),
            "url": reg.get("url") if estado == "publicado" else None,
            "mensaje": mensaje if estado not in ("programado", "publicado") else None}


def hora_utc(t: float) -> str:
    return datetime.fromtimestamp(t, timezone.utc).isoformat(timespec="seconds")
