"""E2 — «+» de Edición con Mis creaciones: varios videos, unión y copia editable.

Hasta E1 la pestaña Edición subía UN video de la computadora a un proyecto del
editor y `POST /api/editar/<p>/sugerir` lo editaba ahí mismo. E2 agrega cuatro
rutas nuevas (por eso viven en `/api/edicion/`, no en `/api/editar/`: ahí
`GET /{nombre}` se tragaría `elegibles` y `cotizar`):

  GET  /api/edicion/elegibles            lo que la hoja «Agregar videos» puede mostrar
  POST /api/edicion/cotizar              precio de varios videos ANTES de cobrar
  POST /api/edicion/iniciar              copia, cobro y lanzamiento
  POST /api/edicion/{nombre}/reintentar  misma copia, cobra otra vez

Reglas que no se negocian (contrato E2, §1):

  - **El servidor decide todo.** Un video se nombra con una `ref`
    (`proyecto:<nombre>` o `clip:<id>`) y el servidor averigua su archivo, su
    duración, su formato y su peso. Jamás se acepta una `key` de S3, un precio,
    una duración ni un número de créditos que venga del navegador (R12, R2).
  - **Todo lo validable se valida ANTES de cobrar.** Dinero: cobrar dos veces,
    cobrar y no devolver, cobrar sin lanzar, cobrar lo que no se cotizó. Cada
    camino de fallo devuelve los créditos.
  - **El orden de `iniciar` es el contrato**: reservar nombre → resolver (con un
    HEAD a S3 por video) → ocupado (saldar lo que se debía, soltar las caducadas) →
    sitio en Fargate → reservar → candado (INSERT de la copia) → releer «¿entró otra
    pestaña?» → cobrar → anotar el cobro → lanzar. El candado va ANTES del cobro; el
    cobro, antes del lanzamiento.
  - **Después de cobrar todo se devuelve** (R16), con la referencia de siempre
    (`editar-sugerir:<copia>`) y una sola vez por cobro. Si el monedero no responde, la
    deuda queda anotada en el doc (`devolucion_pendiente` + `devolucion_api`) y se salda en
    la siguiente llamada de la persona.
  - **El original NUNCA se escribe.** La copia es un proyecto nuevo
    (`ed-<8 hex del pedido>`); el worker copia de servidor a servidor.
  - **Repetir el mismo pedido no cobra dos veces** (R20): el `pedido` fija el
    nombre de la copia, y la segunda llamada devuelve la primera.

Solo nube: en dev local el camino sigue siendo /clean-cut desde Claude Code.
"""
from __future__ import annotations

import contextvars
import json
import logging
import math
import os
import posixpath
import re
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor, wait
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Annotated, Any

from fastapi import APIRouter, Body, HTTPException

from pipeline import creditos, db, jobs, media_sync
from pipeline.project import listar_proyectos
from pipeline.storage import ruta_proyecto
from server import clip_api, editar_api, shorts_api

router = APIRouter(prefix="/api/edicion", tags=["edicion"])
log = logging.getLogger("edicion_api")

# ---------------------------------------------------------------------------
# constantes (UN solo lugar: la web las lee de `elegibles.limites` y un
# guardián, tests/test_e2_limites.py, compara las que usa de respaldo)

MAX_VIDEOS = 12
MAX_S = shorts_api.MAX_DURACION_S            # 90 min en total
MIN_SOLO_S = shorts_api.MIN_DURACION_S       # un video solo: al menos 1 min
MAX_BYTES_TOTAL = 15 * 1024**3               # el disco efímero de Fargate es de 20 GiB
MEDIR_TIMEOUT_S = 8                          # un ffprobe
MEDIR_PLAZO_S = 18                           # todas las mediciones juntas (la Lambda corta a 29 s)
MEDIR_HILOS = 8
CADUCA_H = 2                                 # una corrida «corriendo» de más de esto ya no cuenta
CADUCA_SIN_COBRAR_MIN = 5                    # ...y de más de esto si aún no se anotó el cobro
ESPERA_ABONO = (0.4, 1.2)                    # segundos entre los 3 intentos de devolver (la Lambda corta a 29 s)

TIPOS = ("pelicula", "cuento", "clip", "edicion")
PASOS = ("entender", "editar", "vista")

# ---------------------------------------------------------------------------
# el catálogo de textos (§3.8): una sola tabla; la web los muestra TAL CUAL

_MIN_TOPE = MAX_S // 60
_GB_TOPE = MAX_BYTES_TOTAL // 1024**3

ERRORES: dict[str, tuple[int, str]] = {
    "sin_videos": (422, "Agrega al menos un video para editar."),
    "demasiados": (422, f"Puedes unir hasta {MAX_VIDEOS} videos a la vez."),
    "repetido": (422, "«{titulo}» está repetido: agrégalo una sola vez."),
    "no_encontrado": (404, "No encontramos uno de los videos entre los tuyos. "
                           "Recarga la lista e inténtalo de nuevo."),
    "es_copia": (422, "«{titulo}» ya es una edición: ábrela en su editor para seguir con ella."),
    "sin_metraje": (422, "«{titulo}» no tiene un video para editar."),
    "no_se_pudo_medir": (502, "No pudimos leer «{titulo}». Quítalo e inténtalo de nuevo."),
    "larga": (413, f"«{{titulo}}» dura {{n}} min y el máximo es {_MIN_TOPE} min."),
    "formatos_distintos": (422, "Los videos horizontales y los verticales no se mezclan. "
                                "Quita los {quitar} o edítalos aparte."),
    "total_largo": (413, f"Entre todos suman {{n}} min · el máximo es {_MIN_TOPE} min."),
    "muy_pesado": (413, f"Entre todos pesan {{n}} GB · el máximo es {_GB_TOPE} GB."),
    "corto_solo": (422, "Un video de menos de 1 min no se puede editar solo. "
                        "Agrega otro para unirlos, o sube uno de 1 a 90 min."),
    "sin_transcripcion": (503, "Todavía no podemos transcribir videos nuevos en esta instalación. "
                               "Prueba con videos que ya hiciste con IA."),
    "ocupado": (409, "Ya hay un trabajo en curso. Cuando termine puedes empezar otro."),
    "instruccion_vacia": (422, "Cuéntale a la IA qué quieres hacer con tus videos."),
    "sin_pedido": (422, "Falta la clave del pedido. Recarga la página e inténtalo de nuevo."),
    "ya_fallo": (409, "Esta edición ya falló y se te devolvió lo cobrado. "
                      "Pulsa Iniciar otra vez para empezar de nuevo."),
    "sin_capacidad": (503, "Ahorita hay mucha gente produciendo y no se te cobró. "
                           "Vuelve a intentarlo en unos minutos."),
    "no_se_pudo_lanzar": (502, "No se pudo lanzar la edición: {detalle}. Se te devolvió lo cobrado."),
    "reintento_no_aplica": (409, "Esta edición no está esperando un reintento."),
    "reintento_en_curso": (409, "Esta edición ya se está reintentando."),
    "no_nube": (503, "El flujo web de edición corre en el servicio — "
                     "en local usa /clean-cut desde Claude Code"),
    # Ajustes 2 · el abono no se pudo hacer ahora: los créditos se están devolviendo, no «se devolvieron»
    "no_se_pudo_lanzar_pendiente": (502, "No se pudo lanzar la edición: {detalle}. "
                                         "Estamos devolviendo lo cobrado."),
    "sin_capacidad_pendiente": (503, "Ahorita hay mucha gente produciendo. Estamos devolviendo lo cobrado; "
                                     "vuelve a intentarlo en unos minutos."),
    "devolucion_en_curso": (409, "Todavía estamos devolviendo los créditos de esta edición. "
                                 "Inténtalo en unos minutos."),
    # los que el contrato no lista pero las rutas necesitan
    "ref_mal": (422, "No entendimos uno de los videos. Recarga la lista e inténtalo de nuevo."),
    "sin_nombre": (503, "No pudimos preparar tu copia ahora. Inténtalo otra vez."),
    "no_es_copia": (404, "No encontramos esa edición entre las tuyas."),
}

# lo que queda escrito en `editar.error` cuando se suelta una corrida que murió
_ERROR_CADUCADA = ("La edición se detuvo antes de terminar y se te devolvió lo cobrado. "
                   "Vuelve a intentarlo.")
_ERROR_NO_EMPEZO = "La edición no llegó a empezar y no se te cobró. Vuelve a intentarlo."


def _texto(codigo: str, **kw: Any) -> str:
    return ERRORES[codigo][1].format(**kw) if kw else ERRORES[codigo][1]


def status_de(codigo: str) -> int:
    """El HTTP de cada código (§3.7): 422 reglas, 404 no es tuyo, 413 demasiado
    grande, 502 no se pudo leer, 503 sin transcripción, 409 ocupado."""
    return ERRORES[codigo][0]


def _falla(codigo: str, **kw: Any) -> HTTPException:
    return HTTPException(status_de(codigo), _texto(codigo, **kw))


def _nube() -> None:
    if db.backend() != "postgres":
        raise _falla("no_nube")


# ---------------------------------------------------------------------------
# referencias, textos y fechas

_REF_CLIP = re.compile(r"^clip:clip-[0-9]{8}-[0-9]{6}-[0-9a-f]{6}$")
_PEDIDO = re.compile(r"^[0-9a-f]{32}$")
MAX_NOMBRE = 255          # un proyecto vive en `videos/<nombre>/subidas/<archivo>` y una key de S3 pasa de 1024 bytes


def _nombre_proyecto_valido(nombre: Any) -> bool:
    """La MISMA regla que el resto del producto (`storage.ruta_proyecto`, `media_api._validar_nombre`,
    /estudio/subir/): letras y cifras de cualquier alfabeto, `-` y `_`. Antes la `ref` pedía
    `[A-Za-z0-9_-]{1,64}`, así que la hoja ofrecía «presentación-final» y `cotizar` lo rechazaba."""
    return (isinstance(nombre, str) and 0 < len(nombre) <= MAX_NOMBRE
            and nombre.replace("-", "").replace("_", "").isalnum())


def _refs_de(cuerpo: Any) -> list[str]:
    """Las `ref` del cuerpo, ya validadas con su regex, ANTES de tocar nada.
    Una lista vacía NO es un error de formato: eso es el bloqueo `sin_videos`."""
    if not isinstance(cuerpo, dict):
        raise _falla("ref_mal")
    refs = cuerpo.get("videos")
    if refs is None:
        return []
    if not isinstance(refs, list):
        raise _falla("ref_mal")
    for ref in refs:
        if not (isinstance(ref, str) and (
                (ref.startswith("proyecto:") and _nombre_proyecto_valido(ref[len("proyecto:"):]))
                or _REF_CLIP.match(ref))):
            raise _falla("ref_mal")
    return list(refs)


def _recortar(texto: str, n: int) -> str:
    """El texto en una sola línea y, si pasa de `n`, cortado en una palabra con «…»."""
    t = " ".join(str(texto or "").split())
    if len(t) <= n:
        return t
    corte = t[:n]
    if t[n] != " " and " " in corte:
        corte = corte.rsplit(" ", 1)[0]
    return corte.rstrip(" ,.;:¿¡") + "…"


def _titulo_de_copia(titulos: list[str]) -> str:
    """1 → ese título; N → «{primero} + {N-1} más»; en todo caso de 80 caracteres
    como mucho. Si no cabe se acorta el PRIMERO, no el «+ N más»: es lo que dice
    cuántos videos se unieron."""
    if not titulos:
        return ""
    if len(titulos) == 1:
        return _recortar(titulos[0], 80)
    resto = f" + {len(titulos) - 1} más"
    return _recortar(titulos[0], 80 - len(resto)) + resto


def _ahora() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _fecha(valor: Any) -> datetime | None:
    """Un instante con zona (UTC si no la trae) o None si no se entiende."""
    if not isinstance(valor, str) or not valor:
        return None
    try:
        d = datetime.fromisoformat(valor)
    except ValueError:
        return None
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def _min_de(seg: float, piso: int = 0) -> int:
    """`round(seg / 60)` (§3.8), sin dejar que un texto de «te pasaste» diga
    una cifra que no se pasa: 5401 s redondea a 90 y «dura 90 min y el máximo
    es 90 min» no se entiende. `piso` es el mínimo que se puede decir."""
    return max(round(seg / 60), piso)


# ---------------------------------------------------------------------------
# medir: ffprobe sobre la URL, con la rotación del teléfono aplicada

def _medir(key: str, *, timeout: float = MEDIR_TIMEOUT_S) -> dict | None:
    """`{"duracion_s", "ancho", "alto", "audio"}` del archivo de `key`, o None.

    UN `ffprobe` sobre la URL firmada (lee el moov, no baja el archivo). El
    ancho y el alto salen **con la rotación aplicada**: un 1280×720 con
    `rotation: 90` (video grabado de lado) se ve vertical, 720×1280, y así lo
    pinta ffmpeg al recodificar. None si no se pudo (sin URL, sin video, sin
    duración, plazo vencido): quien llama decide qué hacer.

    La URL es SIEMPRE una firmada de S3 (`url_firmada`), no la del CDN: un clip de IA
    vive en `usuarios/…`, que `url_media` sirve por el CDN, y en dev ffprobe no
    lograba leerlo por ahí («No pudimos leer «Quiero que este león…»»). Con la firmada
    un clip se mide igual que una subida. Cada fallo deja su razón en el log (sin la
    firma): antes se perdía en silencio y no había por dónde empezar a buscar."""
    url = media_sync.url_firmada(key)
    if not url:
        log.warning("medir %s: no hay bucket con que firmar la URL", key)
        return None
    try:
        for intento in (1, 2):
            r = subprocess.run(
                ["ffprobe", "-v", "error", "-show_entries",
                 "stream=codec_type,width,height:stream_side_data=rotation:format=duration",
                 "-of", "json", "-i", url],
                capture_output=True, text=True, encoding="utf-8", errors="replace",
                timeout=timeout)
            if r.returncode == 0:
                break
            # un fallo de red de un solo golpe se arregla con un segundo intento; el mensaje de
            # ffprobe trae la URL y su firma, así que se corta lo que sigue al «?»
            log.warning("medir %s: ffprobe salió con %s (intento %d de 2): %s", key, r.returncode,
                        intento, re.sub(r"\?\S*", "?…", (r.stderr or "").strip())[:300])
        else:
            return None
        datos = json.loads(r.stdout or "{}")
        streams = datos.get("streams") or []
        video = next((s for s in streams if s.get("codec_type") == "video"), None)
        if video is None:
            log.warning("medir %s: el archivo no trae pista de video", key)
            return None
        ancho, alto = int(video.get("width") or 0), int(video.get("height") or 0)
        rotacion = 0
        for lado in video.get("side_data_list") or []:
            if isinstance(lado, dict) and "rotation" in lado:
                rotacion = int(round(float(lado["rotation"])))
        if abs(rotacion) % 180 == 90:
            ancho, alto = alto, ancho
        dur = float((datos.get("format") or {}).get("duration"))
        if ancho <= 0 or alto <= 0 or not math.isfinite(dur) or dur <= 0:
            log.warning("medir %s: medidas que no valen (%sx%s, %s s)", key, ancho, alto, dur)
            return None
        return {"duracion_s": round(dur, 3), "ancho": ancho, "alto": alto,
                "audio": any(s.get("codec_type") == "audio" for s in streams)}
    except subprocess.TimeoutExpired:
        log.warning("medir %s: ffprobe pasó de %s s", key, timeout)
        return None
    except (OSError, ValueError, TypeError) as err:
        log.warning("medir %s: no se pudo leer (%s: %s)", key, type(err).__name__, err)
        return None


def _formato_de(ancho: int | None, alto: int | None) -> str | None:
    """Un cuadrado cuenta como horizontal (se une con lo horizontal)."""
    if not ancho or not alto:
        return None
    return "vertical" if alto > ancho else "horizontal"


# ---------------------------------------------------------------------------
# identificar: de una `ref` al video, con dueño comprobado

@dataclass
class Origen:
    """Un video pedido, ya identificado y que es de esta persona. Todavía sin medir."""
    ref: str
    tipo: str                      # pelicula | cuento | clip | edicion
    titulo: str
    nombre: str | None             # el proyecto del editor (None en un clip)
    doc: dict
    key: str | None                # el archivo de video, o None si no tiene (sin_metraje)
    bytes: int | None
    es_copia: bool = False
    fecha: datetime | None = None
    # lo que se llena al medir
    medicion: dict | None = None
    medido_ahora: bool = False     # True si la medición salió de ffprobe y no de la caché
    canonico_key: str | None = None
    wav_key: str | None = None
    con_transcript: bool = False
    inspeccionado: bool = False


def _subida_de(doc: dict, nombre: str) -> tuple[str | None, int | None]:
    """(key, bytes) del metraje del proyecto: el mismo que usa `shorts_api._fuente`."""
    key = shorts_api._fuente(doc, nombre)
    if key is None or not key.startswith(f"videos/{nombre}/"):
        return None, None      # una key fuera de su propio proyecto no se usa jamás
    pesos = [s.get("bytes") for s in doc.get("subidas", [])
             if isinstance(s, dict) and s.get("key") == key]
    peso = pesos[-1] if pesos else None
    return key, (int(peso) if isinstance(peso, (int, float)) and not isinstance(peso, bool)
                 and peso > 0 else None)


def _generador_de(doc: dict) -> str | None:
    """El id de la película que dio origen a este proyecto `gen-*` (lo escribe
    `worker/producir_task.py`), o None si no es uno."""
    origen = doc.get("origen")
    gen = origen.get("generador") if isinstance(origen, dict) else None
    return str(gen) if gen else None


def _es_gen(doc: dict) -> bool:
    """¿Es el proyecto del editor de una película? Esos salen como película o
    cuento, nunca como «edición»."""
    return bool(_generador_de(doc)) or (
        bool((doc.get("flags") or {}).get("generado")) and not isinstance(doc.get("copia"), dict))


def _peliculas_por_id() -> dict[str, Any]:
    """Las películas de la persona por id, para ponerle título y tipo a su proyecto `gen-*`."""
    try:
        return {p.id: p for p in listar_proyectos()}
    except Exception:  # noqa: BLE001 — sin la lista el título cae al nombre; no rompe nada
        log.exception("no se pudieron listar las películas")
        return {}


def _tipo_y_titulo_proyecto(doc: dict, nombre: str, key: str | None, peliculas: dict) -> tuple[str, str]:
    copia = doc.get("copia")
    if isinstance(copia, dict):
        return "edicion", _recortar(doc.get("titulo") or nombre, 80)
    if _es_gen(doc):
        generador = _generador_de(doc)
        p = peliculas.get(generador) if generador else None
        if p is not None:
            return ("cuento" if p.modo == "investigacion" else "pelicula"), _recortar(p.brief, 80)
        return "pelicula", _recortar(doc.get("titulo") or nombre, 80)
    importar = doc.get("importar")
    titulo = importar.get("titulo") if isinstance(importar, dict) else None
    if not titulo and key:
        titulo = _nombre_de_la_subida(doc, key)
    return "edicion", _recortar(titulo or nombre, 80)


def _nombre_de_la_subida(doc: dict, key: str) -> str:
    """Cómo se llamaba el archivo para la persona. `/api/media/presign` sanea el nombre
    («Mi Entrevista (1).mp4» → «Mi_Entrevista_1.mp4») y la key solo guarda el saneado; `confirmar` deja
    el original en `nombre_original`. Sin él (subidas anteriores) se devuelven los espacios que el
    saneado volvió «_»: «Mi_Entrevista_1» → «Mi Entrevista 1»."""
    for sub in reversed(doc.get("subidas") or []):
        if isinstance(sub, dict) and sub.get("key") == key:
            original = sub.get("nombre_original")
            if isinstance(original, str) and original.strip():
                return posixpath.splitext(original.strip())[0]
            break
    return re.sub(r"_+", " ", posixpath.splitext(posixpath.basename(key))[0]).strip()


def _identificar(user: str, refs: list[str]) -> list[Origen]:
    """De cada `ref` al video, comprobando que es de `user`. 404 (`no_encontrado`)
    si no es suyo o no existe: no distingue «ajeno» de «inexistente» a propósito.
    Sin medir nada. Una `ref` repetida se busca una sola vez."""
    vistos: dict[str, Origen] = {}
    peliculas: dict | None = None
    salida = []
    for ref in refs:
        if ref in vistos:
            salida.append(vistos[ref])
            continue
        if ref.startswith("clip:"):
            clip_id = ref[len("clip:"):]
            doc = clip_api._leer(clip_api._key_doc(user, clip_id))
            if not isinstance(doc, dict):
                raise _falla("no_encontrado")
            key = doc.get("key")
            # un clip es suyo si su doc vive bajo su prefijo; el video también
            propio = isinstance(key, str) and key.startswith(clip_api._prefijo(user)) and ".." not in key
            listo = doc.get("estado") == "listo" and propio
            peso = doc.get("bytes")
            o = Origen(ref=ref, tipo="clip", titulo=_corto_clip(doc.get("texto")), nombre=None,
                       doc=doc, key=key if listo else None,
                       bytes=int(peso) if isinstance(peso, (int, float)) and not isinstance(peso, bool)
                       and peso > 0 else None,
                       fecha=_fecha(doc.get("listo")) or _fecha(doc.get("inicio")))
        else:
            nombre = ref[len("proyecto:"):]
            doc = db.cargar_proyecto_editor(user, nombre)
            if not isinstance(doc, dict):
                raise _falla("no_encontrado")
            if peliculas is None and _es_gen(doc):
                peliculas = _peliculas_por_id()
            key, peso = _subida_de(doc, nombre)
            tipo, titulo = _tipo_y_titulo_proyecto(doc, nombre, key, peliculas or {})
            o = Origen(ref=ref, tipo=tipo, titulo=titulo, nombre=nombre, doc=doc,
                       key=key, bytes=peso, es_copia=isinstance(doc.get("copia"), dict))
        vistos[ref] = o
        salida.append(o)
    return salida


def _corto_clip(texto: Any) -> str:
    """El título de un clip: lo que se pidió, en una línea, 48 caracteres."""
    return " ".join(str(texto or "").split())[:48].strip() or "Clip"


# ---------------------------------------------------------------------------
# inspeccionar: medición (con caché), transcript y audio de cada video

def _meta_valida(o: Origen) -> dict | None:
    """La caché de `doc.meta` (§4.4), solo si sigue siendo de ESTE archivo: la
    misma `key` y los mismos bytes. Una subida reemplazada cambia de peso y la
    medición vieja deja de valer. Sin bytes conocidos no hay forma de saberlo."""
    meta = o.doc.get("meta")
    if (o.tipo == "clip" or not isinstance(meta, dict) or not o.bytes
            or meta.get("key") != o.key or meta.get("bytes") != o.bytes):
        return None
    try:
        dur, ancho, alto = float(meta["duracion_s"]), int(meta["ancho"]), int(meta["alto"])
    except (KeyError, TypeError, ValueError):
        return None
    if dur <= 0 or ancho <= 0 or alto <= 0 or not math.isfinite(dur):
        return None
    return {"duracion_s": round(dur, 3), "ancho": ancho, "alto": alto,
            "audio": bool(meta.get("audio", True))}


def _transcript_de(o: Origen, dur_medida: float) -> tuple[str | None, bool]:
    """(canonico_key, con_transcript) de un proyecto (§3.7).

    El canónico es `videos/<n>/work/transcripts/<stem>.canonical.json`, con
    `<stem>` el nombre del archivo fuente sin extensión. Con `flags.canonico` no
    hace falta listar S3; si no, UN `listar_prefijo`. Se DESCARTA uno cuya
    `source.duration` difiera de la medición en más de max(1 s, 2 %): es de otro
    archivo con el mismo nombre, y si se aceptara cobraríamos ✦ 2 por una
    transcripción que no corresponde a este video."""
    if o.nombre is None or o.key is None:
        return None, False
    stem = posixpath.splitext(posixpath.basename(o.key))[0]
    ck = f"videos/{o.nombre}/work/transcripts/{stem}.canonical.json"
    if not (o.doc.get("flags") or {}).get("canonico"):
        if ck not in media_sync.listar_prefijo(f"videos/{o.nombre}/work/transcripts/"):
            return None, False
    try:
        canonico = json.loads(media_sync.leer_texto(ck) or "")
        dur = float(canonico["source"]["duration"])
    except (ValueError, KeyError, TypeError):
        return None, False
    if abs(dur - dur_medida) > max(1.0, 0.02 * dur_medida):
        return None, False
    return ck, True


def _inspeccionar(o: Origen, claves: bool, transcript: bool, verificar: bool = False) -> dict:
    """Mide un video (con la caché de `doc.meta`) y, si es un proyecto, busca su
    transcript y (si `claves`) su audio ya extraído. Corre en un hilo del pool y
    NO toca `o` ni la base: devuelve el resultado y el hilo principal lo aplica
    solo si llegó a tiempo.

    `verificar` (solo `iniciar`, que es el que cobra): la caché vale mientras `key` y `bytes` coincidan
    con la subida del DOC, y un PUT presignado a la misma key sin pasar por `/confirmar` cambia el
    objeto de S3 sin cambiar el doc. Un HEAD (barato) compara el peso REAL: si no coincide —o el
    objeto ya no está— la medición vieja no vale, se mide de nuevo, y se cobra lo que de verdad hay."""
    med = _meta_valida(o)
    peso_real = None
    if verificar:
        peso_real = media_sync.tamano(o.key)
        if med is not None and peso_real != o.bytes:
            med = None
    nueva = med is None
    if nueva:
        med = _medir(o.key)
    r = {"medicion": med, "medido_ahora": nueva and med is not None, "peso_real": peso_real,
         "canonico_key": None, "con_transcript": False, "wav_key": None}
    if med is not None and o.nombre is not None:
        if transcript:
            r["canonico_key"], r["con_transcript"] = _transcript_de(o, med["duracion_s"])
        if claves and o.key:
            stem = posixpath.splitext(posixpath.basename(o.key))[0]
            wav = f"videos/{o.nombre}/work/audio/{stem}.wav"
            if wav in media_sync.listar_prefijo(f"videos/{o.nombre}/work/audio/"):
                r["wav_key"] = wav
    return r


def _inspeccionar_todos(user: str, origenes: list[Origen], *, claves: bool = False,
                        transcript: bool = True, verificar: bool = False) -> None:
    """Inspecciona en paralelo, con un plazo TOTAL (`MEDIR_PLAZO_S`): lo que no
    llegue a tiempo queda sin medición y se trata como «no se pudo leer». Las
    mediciones nuevas de proyectos se guardan en `doc.meta` (el hilo principal
    escribe; los hilos no tocan la base). `transcript=False` es la lista de la
    hoja, que no necesita saber si hay transcript (eso solo pesa en el precio)."""
    pendientes = [o for o in origenes if o.key and not o.inspeccionado]
    if not pendientes:
        return
    pool = ThreadPoolExecutor(max_workers=MEDIR_HILOS)
    try:
        futuros = [pool.submit(contextvars.copy_context().run, _inspeccionar, o, claves, transcript, verificar)
                   for o in pendientes]
        wait(futuros, timeout=MEDIR_PLAZO_S)
    finally:
        pool.shutdown(wait=False, cancel_futures=True)
    for o, f in zip(pendientes, futuros):
        o.inspeccionado = True
        if not f.done():
            log.warning("inspeccionar %s: se acabó el plazo", o.ref)
            continue
        if f.cancelled() or f.exception() is not None:
            log.warning("inspeccionar %s falló: %r", o.ref, f.exception() if not f.cancelled() else "cancelado")
            continue
        r = f.result()
        if r["peso_real"]:
            o.bytes = int(r["peso_real"])         # lo que hay en S3 manda para el tope de peso y para la caché
        o.medicion, o.medido_ahora = r["medicion"], r["medido_ahora"]
        o.canonico_key, o.con_transcript, o.wav_key = r["canonico_key"], r["con_transcript"], r["wav_key"]
        if o.medido_ahora and o.medicion and o.nombre and o.bytes:
            _guardar_meta(user, o)


def _guardar_meta(user: str, o: Origen) -> None:
    """La caché de la medición. Si no se puede guardar, no pasa nada: la próxima
    vez se vuelve a medir."""
    m = o.medicion or {}
    meta = {"key": o.key, "bytes": o.bytes, "duracion_s": m.get("duracion_s"),
            "ancho": m.get("ancho"), "alto": m.get("alto"), "audio": m.get("audio"),
            "formato": _formato_de(m.get("ancho"), m.get("alto")), "medido": _ahora()}
    try:
        db.fijar_meta_editor(user, o.nombre, json.dumps(meta))
    except Exception:  # noqa: BLE001
        log.warning("no se pudo guardar doc.meta de %s", o.nombre, exc_info=True)


# ---------------------------------------------------------------------------
# resolver: de las `ref` a las fuentes del worker y, si toca, el bloqueo

@dataclass
class Resolucion:
    fuentes: list[dict]
    bloqueo: dict | None                      # {codigo, texto, status} o None
    titulo: str = ""
    n_videos: int = 0
    duracion_total_s: float | None = None
    bytes_total: int | None = None
    formato: str | None = None
    origenes: list[Origen] = field(default_factory=list)


def _bloqueo(codigo: str, **kw: Any) -> dict:
    return {"codigo": codigo, "texto": _texto(codigo, **kw), "status": status_de(codigo)}


def _fuente_de(i: int, o: Origen) -> dict:
    """La forma de §4.2: lo que el worker lee. Con `transcribir` ya decidido."""
    m = o.medicion or {}
    return {
        "orden": i + 1, "clip_id": f"c{i + 1:02d}", "ref": o.ref, "tipo": o.tipo,
        "titulo": o.titulo, "origen_key": o.key,
        "ext": posixpath.splitext(o.key)[1].lower() if o.key else None,
        "canonico_key": o.canonico_key, "wav_key": o.wav_key,
        "bytes": int(o.bytes or 0),
        "duracion_s": m.get("duracion_s"), "ancho": m.get("ancho"), "alto": m.get("alto"),
        "audio": m.get("audio"), "con_transcript": o.con_transcript,
        # un video SIN pista de audio no se transcribe (el worker no llama a la ASR sin sonido): cobrarlo
        # como transcripción era pagar un servicio que nunca ocurre. Lo desconocido (None) cuenta como
        # que sí trae audio, igual que la caché.
        "transcribir": (bool(o.medicion) and not o.con_transcript and o.tipo != "clip"
                        and m.get("audio") is not False),
    }


def _resolver(user: str, refs: list[str], *, claves: bool = False, verificar: bool = False) -> Resolucion:
    """De las `ref` al plan de la edición. Los bloqueos salen en el orden de
    prioridad de §3.3; el primero que aplique se queda. `claves=True` (iniciar)
    también busca el audio ya extraído de cada proyecto; `verificar=True` (iniciar)
    comprueba con un HEAD que el objeto de S3 sigue siendo el que se midió.

    Dos tiempos: primero se identifica (dueño → 404, título) y se revisan
    `repetido`, `es_copia` y `sin_metraje` SIN medir nada; solo si pasan se
    mide (con caché y plazo) y se revisan el resto."""
    n = len(refs)
    if n == 0:
        return Resolucion([], _bloqueo("sin_videos"))
    if n > MAX_VIDEOS:
        return Resolucion([], _bloqueo("demasiados"), n_videos=n)
    origenes = _identificar(user, refs)
    titulo = _titulo_de_copia([o.titulo for o in origenes])

    def parcial(bloqueo: dict) -> Resolucion:
        fuentes = [_fuente_de(i, o) for i, o in enumerate(origenes)]
        return Resolucion(fuentes, bloqueo, titulo, n, origenes=origenes,
                          bytes_total=sum(o.bytes or 0 for o in origenes))

    vistas: set[str] = set()
    for o in origenes:
        if o.ref in vistas:
            return parcial(_bloqueo("repetido", titulo=o.titulo))
        vistas.add(o.ref)
    for o in origenes:
        if o.es_copia:
            return parcial(_bloqueo("es_copia", titulo=o.titulo))
    for o in origenes:
        if o.key is None:
            return parcial(_bloqueo("sin_metraje", titulo=o.titulo))

    _inspeccionar_todos(user, origenes, claves=claves, verificar=verificar)
    fuentes = [_fuente_de(i, o) for i, o in enumerate(origenes)]
    medidos = [o for o in origenes if o.medicion]
    total = round(sum(o.medicion["duracion_s"] for o in medidos), 3) if medidos else None
    peso = sum(o.bytes or 0 for o in origenes)
    base = _formato_de(medidos[0].medicion["ancho"], medidos[0].medicion["alto"]) if medidos else None
    res = Resolucion(fuentes, None, titulo, n, total, peso, base, origenes)

    for o in origenes:
        if o.medicion is None:
            res.bloqueo = _bloqueo("no_se_pudo_medir", titulo=o.titulo)
            return res
    for o in origenes:
        if o.medicion["duracion_s"] > MAX_S:
            res.bloqueo = _bloqueo("larga", titulo=o.titulo,
                                   n=_min_de(o.medicion["duracion_s"], _MIN_TOPE + 1))
            return res
    formatos = {_formato_de(o.medicion["ancho"], o.medicion["alto"]) for o in origenes}
    if len(formatos) > 1:
        # la orientación del primero manda; lo que sobra es lo otro
        res.bloqueo = _bloqueo("formatos_distintos",
                               quitar="verticales" if base == "horizontal" else "horizontales")
        return res
    if total > MAX_S:
        res.bloqueo = _bloqueo("total_largo", n=_min_de(total, _MIN_TOPE + 1))
        return res
    if peso > MAX_BYTES_TOTAL:
        gb = math.ceil(peso / 1024**3 * 10) / 10      # hacia arriba: «15.1 GB» y no «15 GB · máx. 15 GB»
        res.bloqueo = _bloqueo("muy_pesado", n=f"{gb:.1f}".removesuffix(".0"))
        return res
    if n == 1 and origenes[0].medicion["duracion_s"] < MIN_SOLO_S:
        res.bloqueo = _bloqueo("corto_solo")
        return res
    if any(f["transcribir"] for f in fuentes) and not os.getenv("ASSEMBLYAI_API_KEY"):
        res.bloqueo = _bloqueo("sin_transcripcion")
        return res
    return res


def _precio(fuentes: list[dict]) -> tuple[int, dict]:
    """(créditos, desglose). El único camino al precio: `creditos.costo_editar`
    con la duración MEDIDA por el servidor de lo que se va a transcribir."""
    n = creditos.costo_editar([f["duracion_s"] for f in fuentes if f["transcribir"]])
    return n, {"edicion": creditos.EDITAR_SUGERENCIAS_CR,
               "transcripcion": n - creditos.EDITAR_SUGERENCIAS_CR}


# ---------------------------------------------------------------------------
# candado y caducidad

def _caducada(editar: dict) -> bool:
    """Una corrida «corriendo» deja de contar pasadas `CADUCA_H` horas o, si aún
    no se anotó el cobro, `CADUCA_SIN_COBRAR_MIN` minutos. Sin `inicio`
    legible = caducada."""
    inicio = _fecha(editar.get("inicio"))
    if inicio is None:
        return True
    limite_s = (CADUCA_SIN_COBRAR_MIN * 60 if editar.get("cobrado") is False
                else CADUCA_H * 3600)
    return (datetime.now(timezone.utc) - inicio).total_seconds() > limite_s


def _ref_dinero(nombre: str) -> str:
    return f"editar-sugerir:{nombre}"


# las marcas de «se debe una devolución»: `devolucion_pendiente` (cuánto) la escriben el worker y el
# barredor (para que el barredor la cierre) y el API; `devolucion_api` solo el API, y significa «yo no pude
# abonar y la siguiente llamada de la persona lo reintenta» (el barredor no la ve: no hay ejecución)
_MARCAS_DEUDA = ("devolucion_pendiente", "devolucion_api")


def _neto_cobrado(user: str, nombre: str) -> int:
    """Créditos que la persona tiene cobrados y sin devolver por esta copia,
    según el libro mayor (los cargos son negativos y las devoluciones positivas)."""
    ref = _ref_dinero(nombre)
    neto = sum(int(m.get("creditos") or 0) for m in db.movimientos_creditos(user, 200)
               if m.get("referencia") == ref)
    return max(0, -neto)


def _abonar(user: str, nombre: str, n: int, *, intentos: int = len(ESPERA_ABONO) + 1) -> bool:
    """Devuelve `n` créditos de ESTE cobro, con la referencia de siempre (`editar-sugerir:<copia>`).
    Hasta `intentos` veces ante CUALQUIER fallo del monedero: `devolver_cargo` es una sola sentencia que
    solo abona si lo último del libro para esa referencia es un cargo, así que repetir un abono que sí
    entró (su respuesta se perdió) no abona dos veces, y la devolución de un cobro posterior (un
    «Reintentar») no queda bloqueada por la del primero. Un `None` es «ya estaba devuelto»: también es
    éxito. False si no se pudo."""
    for i in range(intentos):
        try:
            creditos.devolver_cargo(n, _ref_dinero(nombre), user)
            return True
        except Exception:  # noqa: BLE001 — el monedero puede fallar de mil formas
            log.exception("copia %s: no se pudieron devolver %d créditos (intento %d de %d)",
                          nombre, n, i + 1, intentos)
            if i < intentos - 1 and i < len(ESPERA_ABONO):
                time.sleep(ESPERA_ABONO[i])
    return False


def _cerrar(user: str, nombre: str, cierre: dict, *, condicionado: bool = True) -> None:
    """Escribe el cierre de una corrida que YA se reclamó. Condicionado (`cerrar_editor_si_error`): solo
    si la copia sigue en `error` y con el mismo `inicio`. `reclamar_fallo_editor` la deja visible y
    reintentable ANTES de que se devuelva, y devolver puede tardar: si la persona pulsó Reintentar en
    medio, esa copia ya es otra corrida y un cierre incondicional la pisaba con `error` + `devueltos`
    (el segundo cobro se quedaba sin devolver). Nunca levanta: el dinero ya se movió."""
    try:
        valor = json.dumps(cierre, ensure_ascii=False)
        if not condicionado:
            db.fijar_campo_editor(user, nombre, "editar", valor)
        elif not db.cerrar_editor_si_error(user, nombre, cierre.get("inicio"), valor):
            log.warning("copia %s: otra pieza la tomó mientras se devolvía; no se pisa", nombre)
    except Exception:  # noqa: BLE001 — la caducidad y el barrido la arreglan solos
        log.exception("copia %s: movido el dinero, pero no se pudo anotar", nombre)


def _saldar(user: str, nombre: str, editar: dict) -> bool:
    """Intenta de nuevo UNA devolución que el API dejó debiendo (`devolucion_api`). Un solo intento y sin
    esperas: quien llega a Iniciar o abre la app no paga las esperas de un monedero caído. True si salió."""
    n = editar.get("devolucion_pendiente")
    if not (isinstance(n, int) and not isinstance(n, bool) and n > 0):
        n = 0
    if n and not _abonar(user, nombre, n, intentos=1):
        return False
    cierre = {k: v for k, v in editar.items() if k not in _MARCAS_DEUDA}
    if n:
        cierre["devueltos"] = n
    _cerrar(user, nombre, cierre)
    return True


def _saldar_pendientes(user: str, filas: list[dict] | None = None) -> set[str]:
    """Salda las devoluciones que el API dejó debiendo a esta persona. `filas` son `{nombre, editar}`
    (si no vienen, se leen). Los nombres de las que quedaron saldadas."""
    if not creditos.activo():
        return set()
    try:
        filas = db.devoluciones_pendientes(user) if filas is None else filas
    except Exception:  # noqa: BLE001 — es una ayuda: nunca tumba al que llama
        log.exception("no se pudieron leer las devoluciones pendientes")
        return set()
    hechas = set()
    for f in filas:
        try:
            if _saldar(user, f["nombre"], f["editar"]):
                hechas.add(f["nombre"])
        except Exception:  # noqa: BLE001
            log.exception("copia %s: no se pudo saldar la devolución pendiente", f.get("nombre"))
    return hechas


def _soltar(user: str, nombre: str, editar: dict) -> None:
    """Cierra una copia que se quedó «corriendo» sin que nadie la cierre y
    devuelve lo que corresponda. **Solo gana UNA llamada**: `reclamar_fallo_editor`
    es un UPDATE condicionado a `corriendo`, así que el worker, el barredor y
    esto nunca devuelven dos veces.

    Con el cobro anotado (`cobrado` verdadero) se devuelve `editar.creditos`.
    Sin anotar NO se asume que no se cobró: la Lambda pudo morir entre `cobrar`
    y la nota. El libro mayor lo dice (`_neto_cobrado`): si hay un cargo sin su
    devolución se devuelve esa diferencia, y si no, solo se suelta.

    Si el abono falla, el reclamo ya está puesto y nadie más devolvería: la deuda queda ANOTADA en
    el doc (`devolucion_pendiente` + `devolucion_api`) y la siguiente llamada de la persona la salda."""
    trabajo = db.reclamar_fallo_editor(user, nombre, "editar", _ERROR_NO_EMPEZO)
    if trabajo is None:
        return          # otro ya la cerró (y devolvió)
    tenia_marca = any(k in trabajo for k in _MARCAS_DEUDA)      # la que dejó el worker para el barredor
    for k in _MARCAS_DEUDA:
        trabajo.pop(k, None)
    n = 0
    if creditos.activo():
        n = (int(trabajo.get("creditos") or 0) if editar.get("cobrado") is True
             else _neto_cobrado(user, nombre))
    if n > 0:
        # con dinero de por medio la bandeja tiene que poder contarlo
        trabajo.update(cobrado=True, error=_ERROR_CADUCADA)
        if _abonar(user, nombre, n):
            trabajo["devueltos"] = n
            log.warning("copia %s soltada: %d créditos devueltos", nombre, n)
        else:
            trabajo.update(devolucion_pendiente=n, devolucion_api=True)
            log.error("copia %s soltada, pero NO se pudieron devolver %d créditos: quedan pendientes", nombre, n)
    elif not tenia_marca:
        return
    _cerrar(user, nombre, trabajo)


def _liberar_caducadas(user: str, corriendo: list[dict]) -> list[dict]:
    """De las corridas «corriendo» (`db.ediciones_corriendo`), suelta las copias
    caducadas (devolviendo lo cobrado) y devuelve las que siguen VIVAS. Las
    corridas viejas sin `copia` (E1) solo se descartan: no son nuestras."""
    vivas = []
    for fila in corriendo:
        editar = fila.get("editar") or {}
        if not _caducada(editar):
            vivas.append(fila)
        elif editar.get("copia") is True:
            _soltar(user, fila["nombre"], editar)
    return vivas


def liberar_huerfanas(user: str, filas: list[dict]) -> set[str]:
    """Lo que `GET /api/edicion/proyectos` hace al abrir la app (D-15): sin esto el reembolso de una
    copia huérfana solo llegaba cuando la persona volvía a pulsar Iniciar o Reintentar, y quien no
    vuelve en semanas seguía sin sus créditos. `filas` son las de `db.listar_proyectos_editor` (no
    se hace otra consulta). Suelta las copias caducadas (devolviendo) y salda las devoluciones
    que el API dejó debiendo. Devuelve los nombres cuyo doc cambió, para que quien llama los relea."""
    corriendo = [{"nombre": f["nombre"], "editar": f["doc"]["editar"]} for f in filas
                 if isinstance(f["doc"].get("editar"), dict) and f["doc"]["editar"].get("estado") == "corriendo"]
    pendientes = [{"nombre": f["nombre"], "editar": f["doc"]["editar"]} for f in filas
                  if isinstance(f["doc"].get("editar"), dict) and f["doc"]["editar"].get("devolucion_api") is True]
    saldadas = _saldar_pendientes(user, pendientes) if pendientes else set()
    vivas = {x["nombre"] for x in _liberar_caducadas(user, corriendo)}
    return saldadas | ({x["nombre"] for x in corriendo} - vivas)


def _otra_corriendo(user: str, nombre: str) -> bool:
    """¿Hay OTRA corrida viva (no caducada) de esta persona, además de la copia `nombre`?"""
    return any(f["nombre"] != nombre and not _caducada(f.get("editar") or {})
               for f in db.ediciones_corriendo(user))


def _vivas_sin_tocar(user: str) -> list[dict]:
    """Lo mismo pero sin soltar nada: lo usa `cotizar`, que no tiene efectos."""
    return [f for f in db.ediciones_corriendo(user) if not _caducada(f.get("editar") or {})]


# ---------------------------------------------------------------------------
# GET /elegibles

def copia_de_doc(doc: dict) -> list[dict]:
    """`[{ref, titulo}]` de los originales de una copia, en el orden elegido;
    `[]` si el proyecto no es una copia."""
    copia = doc.get("copia")
    if not isinstance(copia, dict):
        return []
    return [{"ref": d.get("ref"), "titulo": d.get("titulo")}
            for d in copia.get("de") or [] if isinstance(d, dict)]


def _en_curso(doc: dict) -> bool:
    """Ese proyecto es el que una corrida VIEJA (E1) está editando ahora mismo."""
    editar = doc.get("editar")
    return (isinstance(editar, dict) and editar.get("estado") == "corriendo"
            and editar.get("copia") is not True and not _caducada(editar))


def _iso(d: datetime | None) -> str | None:
    return d.astimezone(timezone.utc).isoformat(timespec="seconds") if d else None


def _elegible(o: Origen, **extra: Any) -> dict:
    """La forma de §3.2. Los valores medidos llegan con `extra`."""
    m = o.medicion
    base = {
        "ref": o.ref, "tipo": o.tipo, "titulo": o.titulo,
        "duracion_s": m["duracion_s"] if m else None,
        "formato": _formato_de(m["ancho"], m["alto"]) if m else None,
        "fecha": _iso(o.fecha), "miniatura": None, "video": None,
        "con_transcript": bool((o.doc.get("flags") or {}).get("canonico")) if o.tipo != "clip" else False,
        "audio": m["audio"] if m else None,
        "bytes": o.bytes if m else None,
        "es_copia": o.es_copia, "copia_de": copia_de_doc(o.doc), "motivo": None,
    }
    base.update(extra)
    return base


@router.get("/elegibles")
def elegibles():
    """Lo que la hoja «Agregar videos» puede mostrar: películas, cuentos, clips y
    ediciones de la persona, con su duración y formato REALES. Solo lectura
    (salvo cachear mediciones). Nunca más de ~20 s: la medición tiene plazo y lo
    que no llega sale como `midiendo`; la próxima lectura ya lo trae."""
    _nube()
    user = db.usuario_actual()
    origenes: list[Origen] = []
    extras: dict[str, dict] = {}

    try:
        filas = db.listar_proyectos_editor(user)
    except Exception:  # noqa: BLE001 — el resto de las fuentes sigue
        log.exception("elegibles: no se pudieron leer los proyectos del editor")
        filas = []
    filas = [f for f in filas if _nombre_proyecto_valido(f["nombre"])]       # lo que `cotizar` no aceptaría no se ofrece
    por_nombre = {f["nombre"]: f for f in filas}
    por_generador = {}
    for f in filas:
        gen = _generador_de(f["doc"])
        if gen:
            por_generador[gen] = f
    usados: set[str] = set()

    def proyecto(f: dict, tipo: str, titulo: str) -> Origen:
        doc = f["doc"]
        key, peso = _subida_de(doc, f["nombre"])
        o = Origen(ref=f"proyecto:{f['nombre']}", tipo=tipo, titulo=titulo, nombre=f["nombre"],
                   doc=doc, key=key, bytes=peso, es_copia=isinstance(doc.get("copia"), dict),
                   fecha=_fecha(f.get("creado")))
        usados.add(f["nombre"])
        return o

    # películas y cuentos: la película lista que tenga su proyecto del editor
    try:
        peliculas = listar_proyectos()
    except Exception:  # noqa: BLE001
        log.exception("elegibles: no se pudieron leer las películas")
        peliculas = []
    for p in peliculas:
        if p.estado != "listo" or p.archivado:
            continue
        f = por_nombre.get(str((p.progreso or {}).get("editor") or "")) or por_generador.get(p.id)
        if f is None or isinstance(f["doc"].get("copia"), dict):
            continue          # sin proyecto del editor no se lista (D-09)
        o = proyecto(f, "cuento" if p.modo == "investigacion" else "pelicula", _recortar(p.brief, 80))
        origenes.append(o)
        extras[o.ref] = {"miniatura": f"/api/proyectos/{p.id}/archivo/portada.jpg"}

    # ediciones: subidas de la computadora y traídos de YouTube; las copias, apagadas
    for f in filas:
        doc = f["doc"]
        if f["nombre"] in usados:
            continue
        if _es_gen(doc):
            continue          # un gen-* ya sale como película o cuento
        if (doc.get("editar") or {}).get("no_lanzada") is True:
            continue          # una copia que falló al lanzar nunca corrió: no es una edición que ofrecer
        key, _ = _subida_de(doc, f["nombre"])
        tipo, titulo = _tipo_y_titulo_proyecto(doc, f["nombre"], key, {})
        if isinstance(doc.get("copia"), dict):
            origenes.append(proyecto(f, "edicion", titulo))
        elif key is not None:
            origenes.append(proyecto(f, tipo, titulo))

    # clips de IA ya listos
    try:
        for clip_id, doc in clip_api._mios(user):
            key = doc.get("key")
            if doc.get("estado") != "listo" or not isinstance(key, str) or not key:
                continue
            peso = doc.get("bytes")
            seg = doc.get("segundos")
            o = Origen(ref=f"clip:{clip_id}", tipo="clip", titulo=_corto_clip(doc.get("texto")),
                       nombre=None, doc=doc, key=key,
                       bytes=int(peso) if isinstance(peso, (int, float)) and not isinstance(peso, bool)
                       and peso > 0 else None,
                       fecha=_fecha(doc.get("listo")) or _fecha(doc.get("inicio")))
            # la cifra de la lista es la nominal (4, 6 u 8); la autoridad es `cotizar`
            o.medicion = {"duracion_s": float(seg) if isinstance(seg, (int, float)) and seg > 0 else 8.0,
                          "ancho": 0, "alto": 0, "audio": doc.get("audio", True)}
            o.inspeccionado = True
            origenes.append(o)
            extras[o.ref] = {"video": f"/api/clip/{clip_id}/video",
                             "formato": doc.get("formato") if doc.get("formato") in ("horizontal", "vertical")
                             else "horizontal"}
    except Exception:  # noqa: BLE001
        log.exception("elegibles: no se pudieron leer los clips")

    origenes.sort(key=lambda o: (o.fecha is None, -(o.fecha.timestamp() if o.fecha else 0)))

    # lo que se puede medir: lo más nuevo primero, con el plazo total
    por_medir = [o for o in origenes
                 if o.tipo != "clip" and o.key and not o.es_copia]
    _inspeccionar_todos(user, por_medir, transcript=False)

    videos = []
    for o in origenes:
        extra = dict(extras.get(o.ref, {}))
        if o.tipo != "clip":
            motivo = None
            if o.es_copia:
                motivo = "es_copia"
            elif _en_curso(o.doc):
                motivo = "en_curso"
            elif o.key is None:
                motivo = "sin_metraje"
            elif o.medicion is None:
                motivo = "midiendo"
            extra["motivo"] = motivo
        videos.append(_elegible(o, **extra))
    return {"videos": videos,
            "limites": {"max_s": MAX_S, "min_solo_s": MIN_SOLO_S, "max_videos": MAX_VIDEOS,
                        "max_bytes": MAX_BYTES_TOTAL}}


# ---------------------------------------------------------------------------
# POST /cotizar

def _video_cotizado(f: dict) -> dict:
    return {"ref": f["ref"], "tipo": f["tipo"], "titulo": f["titulo"],
            "duracion_s": f["duracion_s"], "formato": _formato_de(f["ancho"], f["alto"]),
            "ancho": f["ancho"], "alto": f["alto"], "audio": f["audio"],
            "bytes": f["bytes"] or None, "con_transcript": f["con_transcript"],
            "se_transcribe": f["transcribir"]}


@router.post("/cotizar")
def cotizar(cuerpo: Annotated[Any, Body()] = None):
    """El precio ANTES de cobrar. Siempre 200 si el pedido está bien formado: las
    reglas de contenido viajan en `bloqueo`. Sin efectos (salvo cachear
    mediciones) e idempotente. El cuerpo solo trae las `ref`: cualquier otra
    clave (créditos, precio, key…) se ignora."""
    _nube()
    user = db.usuario_actual()
    res = _resolver(user, _refs_de(cuerpo))
    if res.bloqueo:
        n, desglose = None, None
    else:
        n, desglose = _precio(res.fuentes)
    return {
        "titulo": res.titulo, "n_videos": res.n_videos,
        "duracion_total_s": res.duracion_total_s,
        "bytes_total": res.bytes_total,
        "formato": res.formato,
        "creditos": n, "desglose": desglose,
        "ocupado": bool(_vivas_sin_tocar(user)),
        "bloqueo": ({"codigo": res.bloqueo["codigo"], "texto": res.bloqueo["texto"]}
                    if res.bloqueo else None),
        "videos": [_video_cotizado(f) for f in res.fuentes],
    }


# ---------------------------------------------------------------------------
# POST /iniciar

def _pedido_de(cuerpo: Any) -> tuple[str, str, list[str]]:
    """(pedido, instrucción, refs) ya validados: nada se reserva ni se cobra
    antes de que esto pase."""
    if not isinstance(cuerpo, dict):
        raise HTTPException(422, "El cuerpo debe ser un objeto JSON")
    pedido = cuerpo.get("pedido")
    if not isinstance(pedido, str) or not _PEDIDO.match(pedido):
        raise _falla("sin_pedido")
    instruccion = editar_api.instruccion_de({"instruccion": cuerpo.get("instruccion")})
    if not instruccion:
        raise _falla("instruccion_vacia")
    refs = _refs_de(cuerpo)
    if not refs:
        raise _falla("sin_videos")
    if len(refs) > MAX_VIDEOS:
        raise _falla("demasiados")
    return pedido, instruccion, refs


def _ya_hecho(doc: dict, nombre: str, pedido: str) -> dict:
    """Responde por una copia que YA existe con este nombre. Si es de este mismo
    `pedido`, es la misma petición otra vez (red caída, doble clic, dos
    pestañas): se devuelve la primera, sin cobrar ni lanzar. Si es de otro
    `pedido` (el prefijo de 8 hex coincidió con otra copia: 1 en 4 mil
    millones), no es nuestra: se dice «ocupado» y se vuelve a intentar con un
    pedido nuevo, que la web renueva con cualquier respuesta del servidor."""
    st = doc.get("editar") if isinstance(doc.get("editar"), dict) else {}
    if st.get("pedido") != pedido or doc.get("copia") is None:
        raise _falla("ocupado")
    if st.get("estado") in ("corriendo", "listo"):
        return {"lanzado": True, "nombre": nombre, "titulo": doc.get("titulo") or "",
                "creditos": int(st.get("creditos") or 0), "n_videos": int(st.get("n_videos") or 0),
                "repetido": True}
    if st.get("devolucion_api") is True:
        raise _falla("devolucion_en_curso")          # «se te devolvió» todavía no es verdad
    raise _falla("ya_fallo")


def _devolver_por_fallo(user: str, nombre: str, editar: dict, n: int, mensaje: str, *,
                        no_lanzada: bool = False) -> bool:
    """Se cobró y no se pudo lanzar: el dinero vuelve y el doc lo cuenta. True si los créditos volvieron
    (o si otra pieza ya los había devuelto); False si el abono no se pudo hacer y quedó anotado como deuda.

    Reclama primero (`reclamar_fallo_editor`): si el worker ya arrancó y cerró
    la corrida por su cuenta, él devolvió y aquí NO se devuelve otra vez. Si el
    reclamo mismo falla (la base se cae) se devuelve igual: cobrar sin entregar
    es lo peor, y el abono es idempotente por cobro (`devolver_cargo`), así que si la caducidad
    suelta después esa copia y vuelve a devolver, la segunda vez no abona.

    `no_lanzada` marca la copia para que ni la bandeja ni «Mis creaciones» la enseñen: nada llegó
    a correr y no hay nada que reintentar de ella (la persona vuelve a pulsar Iniciar)."""
    reclamado = True
    try:
        trabajo = db.reclamar_fallo_editor(user, nombre, "editar", mensaje[:300])
    except Exception:  # noqa: BLE001
        log.exception("copia %s: no se pudo reclamar el fallo; se devuelve de todos modos", nombre)
        trabajo, reclamado = dict(editar), False
    if trabajo is None:
        return True
    cierre = {**editar, **trabajo, "estado": "error", "error": mensaje[:300]}
    for k in _MARCAS_DEUDA:
        cierre.pop(k, None)
    if no_lanzada:
        cierre["no_lanzada"] = True
    devuelto = True
    if creditos.activo() and n > 0:
        devuelto = _abonar(user, nombre, n)
        if devuelto:
            cierre["devueltos"] = n          # la bandeja lo lee; sin monedero no se habla de créditos
        else:
            cierre.update(devolucion_pendiente=n, devolucion_api=True)
            log.error("copia %s: NO se pudieron devolver %d créditos; quedan pendientes", nombre, n)
    _cerrar(user, nombre, cierre, condicionado=reclamado)
    return devuelto


def _soltar_si_dudoso(user: str, nombre: str, editar: dict) -> None:
    """`cobrar` falló con algo que NO es falta de saldo: puede que el cargo sí
    haya entrado. Se suelta la copia y el libro mayor decide si hay algo que
    devolver. Nunca levanta: quien llama ya va a propagar el error original."""
    try:
        _soltar(user, nombre, {**editar, "cobrado": False})
    except Exception:  # noqa: BLE001
        log.exception("copia %s: no se pudo soltar tras un cobro dudoso", nombre)


def _cobrar_y_lanzar(user: str, nombre: str, editar: dict, n: int, *,
                     al_faltar_saldo, no_lanzada: bool = False) -> dict:
    """La secuencia que mueve dinero, igual para `iniciar` y `reintentar`:
    cobrar → anotar el cobro → lanzar. `al_faltar_saldo` deshace el candado (la
    copia sin cobrar se borra, o la que reintenta vuelve a `error`) y el 402 sale
    con el texto de siempre. Devuelve el `editar` ya con `cobrado: true`."""
    if creditos.activo():
        try:
            creditos.cobrar(n, _ref_dinero(nombre), user)
        except creditos.SinSaldo as e:
            al_faltar_saldo()
            raise HTTPException(402, str(e)) from None
        except Exception:
            _soltar_si_dudoso(user, nombre, editar)
            raise
    editar = {**editar, "cobrado": True}
    try:
        db.fijar_campo_editor(user, nombre, "editar", json.dumps(editar, ensure_ascii=False))
        jobs.lanzar_editar(user, nombre)
    except jobs.SinCapacidad as err:
        if _devolver_por_fallo(user, nombre, editar, n, str(err), no_lanzada=no_lanzada):
            raise
        raise jobs.SinCapacidad(_texto("sin_capacidad_pendiente")) from None
    except Exception as err:  # noqa: BLE001 — cobrado y sin job = lo peor: revertir
        # el texto de la excepción de boto3 suele traer el ARN del rol y de la máquina de estados: se
        # tacha antes de recortar (para que un corte no deje medio ARN a la vista) y antes de guardarse
        crudo = editar_api.tachar_infra(err)
        devuelto = _devolver_por_fallo(user, nombre, editar, n, f"no se pudo lanzar: {crudo}",
                                       no_lanzada=no_lanzada)
        detalle = crudo[:200]
        if not creditos.activo():
            texto = _texto("no_se_pudo_lanzar", detalle=detalle).removesuffix(" Se te devolvió lo cobrado.")
        else:
            texto = _texto("no_se_pudo_lanzar" if devuelto else "no_se_pudo_lanzar_pendiente", detalle=detalle)
        raise HTTPException(status_de("no_se_pudo_lanzar"), texto) from None
    return editar


@router.post("/iniciar")
def iniciar(cuerpo: Annotated[Any, Body()] = None):
    """Hace la copia, cobra y lanza. Ver la cabecera del módulo para el orden."""
    _nube()
    user = db.usuario_actual()
    pedido, instruccion, refs = _pedido_de(cuerpo)

    # 3 · nombre determinista: el mismo pedido da siempre la misma copia
    base = "ed-" + pedido[:8]
    nombre = db.reservar_nombre_derivado(user, base, reservar=False)
    if nombre is None:
        raise _falla("sin_nombre")

    # 4 · idempotencia
    previa = db.cargar_proyecto_editor(user, nombre)
    if previa is not None:
        if (previa.get("editar") or {}).get("devolucion_api") is True:
            _saldar_pendientes(user)          # si ya se pudo devolver, el texto de «ya falló» es verdad
            previa = db.cargar_proyecto_editor(user, nombre) or previa
        return _ya_hecho(previa, nombre, pedido)

    # 5 · resolver y validar TODO antes de mover dinero
    res = _resolver(user, refs, claves=True, verificar=True)
    if res.bloqueo:
        raise HTTPException(res.bloqueo["status"], res.bloqueo["texto"])

    # 6 · ocupado (por lectura; el índice parcial lo garantiza de verdad)
    corriendo = db.ediciones_corriendo(user)
    if any(f["nombre"] == nombre for f in corriendo):
        # no es OTRA corrida: es la copia de este mismo pedido, que una llamada gemela
        # (doble clic, dos pestañas) tomó entre mi lectura del paso 4 y esta. Se
        # responde como en el paso 4, sin cobrar ni lanzar.
        gemela = db.cargar_proyecto_editor(user, nombre)
        if gemela is not None:
            return _ya_hecho(gemela, nombre, pedido)
    _saldar_pendientes(user)          # lo que el API quedó debiendo antes: primero eso
    if _liberar_caducadas(user, corriendo):
        raise _falla("ocupado")
    # sitio en Fargate ANTES de mover dinero: si no, cada saturación era cobrar, devolver y dejar una copia fantasma
    if not jobs.hay_sitio():
        raise _falla("sin_capacidad")

    # 7 · el precio lo calcula el servidor, con lo que ÉL midió
    n, desglose = _precio(res.fuentes)

    # 8 · reservar el nombre (ahora sí; es estable)
    nombre = db.reservar_nombre_derivado(user, base)
    if nombre is None:
        raise _falla("sin_nombre")

    # 9 · tomar el candado: el INSERT de la copia ANTES de cobrar
    ahora = _ahora()
    editar = {
        "copia": True, "pedido": pedido, "estado": "corriendo", "paso": "entender",
        "cobrado": False, "creditos": n, "desglose": desglose, "inicio": ahora, "fin": None,
        "instruccion": instruccion, "n_videos": res.n_videos, "formato": res.formato,
        "duracion_entrada_s": res.duracion_total_s, "fuentes": res.fuentes,
    }
    doc = {
        "titulo": res.titulo,
        "copia": {"version": 1, "creada": ahora,
                  "de": [{"orden": f["orden"], "ref": f["ref"], "tipo": f["tipo"],
                          "titulo": f["titulo"], "clip_id": f["clip_id"]} for f in res.fuentes]},
        "subidas": [],        # VACÍO a propósito: ver §4.3 (K-08)
        "editar": editar,
    }
    if not db.crear_copia_editor(user, nombre, json.dumps(doc, ensure_ascii=False)):
        # o ya existía ese nombre (otra llamada con el mismo pedido ganó), o el
        # índice vio otra copia corriendo de esta persona. Releer decide.
        otra = db.cargar_proyecto_editor(user, nombre)
        if otra is not None:
            return _ya_hecho(otra, nombre, pedido)
        raise _falla("ocupado")

    # 9b · insertar y LUEGO mirar: sin el índice parcial (la base aún no corrió db_migrate) dos
    # pestañas podían leer «nada corriendo» en el paso 6, insertar las dos, cobrar las dos y
    # lanzar las dos. Cada una mira DESPUÉS de su propio INSERT, así que la que mira más tarde ve
    # a la otra y se retira sin haber cobrado (en el peor caso se retiran las dos y se reintenta).
    # Con el índice esta lectura nunca encuentra nada.
    if _otra_corriendo(user, nombre):
        db.borrar_copia_sin_cobrar(user, nombre)
        raise _falla("ocupado")

    # 10-12 · cobrar → anotar → lanzar
    _cobrar_y_lanzar(user, nombre, editar, n, no_lanzada=True,
                     al_faltar_saldo=lambda: db.borrar_copia_sin_cobrar(user, nombre))
    return {"lanzado": True, "nombre": nombre, "titulo": res.titulo, "creditos": n,
            "n_videos": res.n_videos, "repetido": False}


# ---------------------------------------------------------------------------
# POST /{nombre}/reintentar

# lo que una corrida nueva NO hereda de la anterior
_RESULTADO = ("cortes", "fluff", "flags", "resultado", "no_aplicado", "error", "devueltos", "fin",
              "devolucion_pendiente", "devolucion_api", "no_lanzada")


@router.post("/{nombre}/reintentar")
def reintentar(nombre: str):
    """La misma copia, otra vez. Cobra OTRA VEZ lo que costó la primera
    (`editar.creditos`: «Reintentar vuelve a cobrar ✦ N» dice la verdad) y sin
    resolver de nuevo las fuentes: usa las que quedaron escritas. Solo una
    llamada gana el claim (UPDATE condicionado a `error`), así que un doble clic
    no cobra dos veces."""
    _nube()
    user = db.usuario_actual()
    try:
        ruta_proyecto(nombre)
    except ValueError:
        raise _falla("no_es_copia") from None
    doc = db.cargar_proyecto_editor(user, nombre)
    if not isinstance(doc, dict) or not isinstance(doc.get("copia"), dict):
        raise _falla("no_es_copia")
    st = doc.get("editar") if isinstance(doc.get("editar"), dict) else {}
    if st.get("estado") == "corriendo" and (st.get("reintentos") or 0) > 0:
        raise _falla("reintento_en_curso")
    if st.get("estado") != "error" or not isinstance(st.get("fuentes"), list) or not st["fuentes"]:
        raise _falla("reintento_no_aplica")

    # Reintentar cobra otra vez y limpia las marcas de la corrida anterior: si esta copia quedó DEBIENDO
    # una devolución, primero se salda (o no se reintenta) o la deuda se perdería con la marca.
    if st.get("devolucion_api") is True:
        _saldar_pendientes(user)
        doc = db.cargar_proyecto_editor(user, nombre) or {}
        st = doc.get("editar") if isinstance(doc.get("editar"), dict) else {}
        if st.get("devolucion_api") is True:
            raise _falla("devolucion_en_curso")
        if st.get("estado") != "error":
            raise _falla("reintento_no_aplica")

    if _liberar_caducadas(user, db.ediciones_corriendo(user)):
        raise _falla("ocupado")
    if not jobs.hay_sitio():
        raise _falla("sin_capacidad")

    n = st.get("creditos")
    if not (isinstance(n, int) and not isinstance(n, bool) and n > 0):
        n = _precio([f for f in st["fuentes"] if isinstance(f, dict)])[0]
    nuevo = {k: v for k, v in st.items() if k not in _RESULTADO}
    nuevo.update(estado="corriendo", paso="entender", cobrado=False, creditos=n, inicio=_ahora(),
                 fin=None, reintentos=int(st.get("reintentos") or 0) + 1)

    if not db.reclamar_reintento_editor(user, nombre, json.dumps(nuevo, ensure_ascii=False)):
        # perdió el claim: o ya la reclamó otra llamada (doble clic) o el índice
        # vio otra copia corriendo de esta persona
        actual = (db.cargar_proyecto_editor(user, nombre) or {}).get("editar") or {}
        raise _falla("reintento_en_curso" if actual.get("estado") == "corriendo" else "ocupado")

    def deshacer() -> None:
        db.fijar_campo_editor(user, nombre, "editar", json.dumps(st, ensure_ascii=False))

    # insertar y luego mirar (como `iniciar`, 9b): sin el índice, dos reintentos de copias distintas
    # podían reclamar a la vez; la que mira después de su propio claim ve a la otra y se echa atrás
    if _otra_corriendo(user, nombre):
        deshacer()
        raise _falla("ocupado")

    _cobrar_y_lanzar(user, nombre, nuevo, n, al_faltar_saldo=deshacer)
    return {"lanzado": True, "nombre": nombre, "creditos": n}
