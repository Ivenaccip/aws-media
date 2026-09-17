"""M23 C2 — sube la película a Blotato y crea el post (trabajo SQS `publicar`).

Lo encola POST /editor/{nombre}/api/publicar/agendar después de dejar la
publicación en `pendiente` (pipeline/publicaciones.py). Este trabajo NUNCA
relanza: la cola reintentaría y el post saldría dos veces. Todo fallo queda
escrito en la publicación, que es lo que lee la pantalla.

En local corre lo mismo (`ejecutar`) en segundo plano dentro del servidor, con
el archivo del disco en vez del de S3.
"""
from __future__ import annotations

import json
import logging
import subprocess
import time
from collections.abc import Callable, Iterable
from contextlib import AbstractContextManager, contextmanager
from dataclasses import dataclass

import httpx

from pipeline import blotato, claves_usuario, publicaciones

log = logging.getLogger("publicar")

# «publicar ahora»: cuánto se espera a que Blotato diga cómo le fue
ESPERA_RESULTADO_S = 45
ESPERA_ENTRE_S = 5


@dataclass
class Video:
    nombre: str
    tam: int
    abrir: Callable[[], AbstractContextManager[Iterable[bytes]]]
    sondeo: str | None        # ruta o URL que ffprobe puede leer


def video_s3(key: str) -> Video:
    from pipeline import media_sync
    s3, bucket = media_sync._s3(), media_sync._bucket()
    tam = int(s3.head_object(Bucket=bucket, Key=key)["ContentLength"])

    @contextmanager
    def abrir():
        cuerpo = s3.get_object(Bucket=bucket, Key=key)["Body"]
        try:
            yield cuerpo.iter_chunks(blotato.TROZO)
        finally:
            cuerpo.close()

    url = s3.generate_presigned_url("get_object", Params={"Bucket": bucket, "Key": key},
                                    ExpiresIn=600)
    return Video(key.rsplit("/", 1)[-1], tam, abrir, url)


def video_local(ruta) -> Video:
    @contextmanager
    def abrir():
        with ruta.open("rb") as f:
            yield blotato.trozos(f)

    return Video(ruta.name, ruta.stat().st_size, abrir, str(ruta))


def sondear(fuente: str | None) -> dict | None:
    """{ancho, alto, segundos} con ffprobe, o None si no se pudo (no bloquea)."""
    if not fuente:
        return None
    try:
        r = subprocess.run(
            ["ffprobe", "-v", "error", "-select_streams", "v:0",
             "-show_entries", "stream=width,height:stream_side_data=rotation"
             ":stream_tags=rotate:format=duration", "-of", "json", fuente],
            capture_output=True, timeout=30, check=True)
        datos = json.loads(r.stdout)
        s = datos["streams"][0]
        ancho, alto = int(s["width"]), int(s["height"])
        giro = 0
        for lado in s.get("side_data_list") or []:
            giro = int(float(lado.get("rotation") or 0)) or giro
        giro = giro or int(float((s.get("tags") or {}).get("rotate") or 0))
        if abs(giro) % 180 == 90:
            ancho, alto = alto, ancho
        return {"ancho": ancho, "alto": alto,
                "segundos": float(datos.get("format", {}).get("duration") or 0)}
    except Exception as err:  # noqa: BLE001 — sin sondeo se publica igual
        # sin el texto: la URL firmada iría al log
        log.warning("ffprobe no pudo leer el video: %s", type(err).__name__)
        return None


def _mmss(s: float) -> str:
    s = int(round(s))
    return f"{s // 60}:{s % 60:02d} min" if s >= 60 else f"{s} s"


def revisar_video(plataforma: str, video: Video) -> None:
    """ValueError (mensaje para el usuario) si esta red no va a aceptar el video."""
    red = blotato.REDES[plataforma]
    mb = video.tam / 1e6
    if video.tam > blotato.MAX_BYTES:
        raise ValueError(f"El video pesa {mb:.0f} MB y Blotato acepta hasta "
                         f"{blotato.MAX_BYTES // 1_000_000} MB.")
    if red["mb"] and mb > red["mb"]:
        raise ValueError(f"{red['nombre']} acepta videos de hasta {red['mb']} MB "
                         f"y este pesa {mb:.0f} MB.")
    if not (red["vertical"] or red["seg"]):
        return
    info = sondear(video.sondeo)
    if info is None:
        return
    if red["vertical"] and info["alto"] <= info["ancho"]:
        raise ValueError(f"{red['nombre']} solo acepta video vertical (9:16) y esta "
                         "película es horizontal. Publícala en otra red o usa una "
                         "versión vertical.")
    if red["seg"] and info["segundos"] > red["seg"] + 0.5:
        raise ValueError(f"{red['nombre']} acepta videos de hasta {_mmss(red['seg'])} "
                         f"y este dura {_mmss(info['segundos'])}.")


def _guardar(user_id: str, proyecto: str, reg: dict, **cambios) -> None:
    """Escritura sin condición que no puede tumbar el trabajo."""
    reg.update(cambios)
    for intento in range(2):
        try:
            publicaciones.guardar(user_id, proyecto, reg)
            return
        except Exception as err:  # noqa: BLE001
            log.error("guardar la publicación %s (intento %d): %s",
                      reg.get("id"), intento + 1, type(err).__name__)
            time.sleep(1)


def ejecutar(user_id: str, proyecto: str, pub_id: str,
             video_de: Callable[[dict], Video]) -> None:
    """El trabajo completo. Nunca lanza."""
    try:
        _ejecutar(user_id, proyecto, pub_id, video_de)
    except Exception as err:  # noqa: BLE001 — relanzar = otro intento = post doble
        log.error("publicar %s/%s: fallo inesperado %s", proyecto, pub_id, type(err).__name__)


def _ejecutar(user_id: str, proyecto: str, pub_id: str,
              video_de: Callable[[dict], Video]) -> None:
    reclamo = publicaciones.reclamar(user_id, proyecto, pub_id)
    if reclamo is None:
        log.info("publicar %s/%s: ya la tomó otro intento o se venció", proyecto, pub_id)
        return
    reg, etag = reclamo
    plataforma = reg["plataforma"]
    clave = None

    # 1) todo lo que puede fallar ANTES de crear el post: no se publicó nada
    try:
        clave = blotato.clave_de(user_id)
        if not clave:
            raise ValueError("Conecta tu cuenta de Blotato primero: es el «+» junto "
                             "a Blotato, en el menú del inicio.")
        target = blotato.target_de(plataforma, reg.get("opciones") or {})
        video = video_de(reg)
        revisar_video(plataforma, video)
        with video.abrir() as partes:
            media = blotato.subir_stream(clave, _nombre_subida(proyecto, video.nombre),
                                         partes, video.tam)
    except ValueError as err:
        _guardar(user_id, proyecto, reg, estado="error", error=str(err))
        return
    except claves_usuario.ErrorAlmacen:
        _guardar(user_id, proyecto, reg, estado="error",
                 error="No pudimos leer tu conexión con Blotato. Intenta de nuevo.")
        return
    except Exception as err:  # noqa: BLE001
        codigo = getattr(getattr(err, "response", None), "status_code", "")
        log.error("publicar %s/%s: subir falló: %s %s", proyecto, pub_id,
                  type(err).__name__, codigo)
        mensaje = (blotato.explicar_fallo(err, clave)[0]
                   if isinstance(err, (httpx.HTTPError, blotato.ClaveInvalida))
                   else "No pudimos subir el video a Blotato. Intenta de nuevo.")
        _guardar(user_id, proyecto, reg, estado="error", error=mensaje)
        return

    # 2) «creando» con condición: si alguien tocó el registro, no se publica
    reg["estado"] = "creando"
    try:
        publicaciones.guardar(user_id, proyecto, reg, etag)
    except Exception as err:  # noqa: BLE001 — incluye Conflicto
        log.error("publicar %s/%s: no se pudo marcar creando (%s); no se publica",
                  proyecto, pub_id, type(err).__name__)
        return

    # 3) el punto sin retorno
    try:
        r = blotato.publicar(clave, reg["cuenta_id"], plataforma, reg["texto"], [media],
                             scheduled_time=reg.get("cuando"), target=target)
    except httpx.HTTPStatusError as err:
        codigo = err.response.status_code
        log.error("publicar %s/%s: Blotato respondió %s", proyecto, pub_id, codigo)
        if 400 <= codigo < 500 and codigo != 408:
            # rechazado: Blotato no creó nada, se puede reintentar
            _guardar(user_id, proyecto, reg, estado="error",
                     error=blotato.explicar_fallo(err, clave)[0])
        else:
            _guardar(user_id, proyecto, reg, estado="incierto")
        return
    except Exception as err:  # noqa: BLE001 — timeout o red: pudo haberlo creado
        log.error("publicar %s/%s: sin respuesta de Blotato: %s", proyecto, pub_id,
                  type(err).__name__)
        _guardar(user_id, proyecto, reg, estado="incierto")
        return

    post_id = r.get("postSubmissionId")
    if not blotato.id_valido(post_id if isinstance(post_id, str) else None):
        log.error("publicar %s/%s: Blotato respondió sin postSubmissionId", proyecto, pub_id)
        _guardar(user_id, proyecto, reg, estado="incierto")
        return
    cambios = {"post_id": post_id,
               "estado": "programado" if reg.get("cuando") else "enviado"}
    if reg.get("cuando") and isinstance(r.get("scheduledTime"), str):
        cambios["cuando"] = r["scheduledTime"]
    _guardar(user_id, proyecto, reg, **cambios)
    log.info("publicar %s/%s: %s en %s", proyecto, pub_id, reg["estado"], plataforma)

    # 4) «publicar ahora»: un rato para saber cómo le fue (si no, lo pregunta
    # la pantalla después)
    if reg.get("cuando"):
        return
    fin = time.monotonic() + ESPERA_RESULTADO_S
    while time.monotonic() < fin:
        time.sleep(ESPERA_ENTRE_S)
        try:
            st = blotato.estado_post(clave, post_id)
        except Exception as err:  # noqa: BLE001
            log.warning("estado de %s: %s", pub_id, type(err).__name__)
            continue
        reg["consultado"] = publicaciones.ahora()
        if publicaciones.aplicar_estado(reg, st):
            _guardar(user_id, proyecto, reg)
        if reg["estado"] in ("publicado", "fallido"):
            return


def _nombre_subida(proyecto: str, nombre: str) -> str:
    # Bluesky exige que la URL termine en .mp4; el nombre ya lo trae
    return f"{proyecto}-{nombre}"


def publicar(user_id: str, proyecto: str, pub_id: str) -> None:
    """Punto de entrada del worker SQS (nube: el video está en S3)."""
    from pipeline import costes_infra

    t0 = time.monotonic()

    def video_de(reg: dict) -> Video:
        key = str(reg.get("archivo_key") or "")
        # la key la escribió la API, pero se comprueba igual
        if (not key.startswith(f"videos/{proyecto}/") or ".." in key
                or not key.endswith(".mp4")):
            raise ValueError("No encontramos el video de esta publicación.")
        return video_s3(key)

    try:
        ejecutar(user_id, proyecto, pub_id, video_de)
    finally:
        costes_infra.registrar(user_id, proyecto, "infra-publicar",
                               costes_infra.costo_lambda(time.monotonic() - t0))
