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
# mientras sube, el registro se renueva: la pantalla solo da por muerta una
# subida sin latido (publicaciones.VENCE_TRABAJO_S)
LATIDO_S = 60
# antes de crear el post, lo que puede faltar para que la pantalla la dé por muerta
MARGEN_S = 120
REINTENTOS_RECLAMO = (0.5, 2.0)


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


class _Latido:
    """Renueva el registro cada LATIDO_S mientras httpx consume los trozos. Si
    alguien más tocó el registro, Conflicto corta la subida."""

    def __init__(self, user_id: str, proyecto: str, reg: dict, etag: str):
        self.user_id, self.proyecto, self.reg, self.etag = user_id, proyecto, reg, etag
        self.t = time.monotonic()

    def envolver(self, partes: Iterable[bytes]) -> Iterable[bytes]:
        for trozo in partes:
            if time.monotonic() - self.t >= LATIDO_S:
                self.t = time.monotonic()
                previo = self.reg.get("actualizado")
                try:
                    self.etag = publicaciones.guardar(self.user_id, self.proyecto,
                                                      self.reg, self.etag)
                except publicaciones.Conflicto:
                    raise
                except Exception as err:  # noqa: BLE001 — sin latido, el plazo decide
                    # el plazo tiene que medir desde el último latido GUARDADO,
                    # que es lo que ve la pantalla
                    self.reg["actualizado"] = previo
                    log.warning("latido de %s: %s", self.reg.get("id"), type(err).__name__)
            yield trozo


def _reclamar(user_id: str, proyecto: str, pub_id: str, relanzar: bool):
    for espera in (*REINTENTOS_RECLAMO, None):
        try:
            return publicaciones.reclamar(user_id, proyecto, pub_id)
        except ValueError as err:           # datos inválidos: reintentar no sirve
            log.error("publicar %s/%s: %s", proyecto, pub_id, err)
            return None
        except Exception as err:  # noqa: BLE001
            if espera is None:
                log.error("publicar %s/%s: no se pudo reclamar: %s", proyecto, pub_id,
                          type(err).__name__)
                if relanzar:
                    # nada se reclamó: el reintento de la cola es seguro (If-Match)
                    raise
                return None
            time.sleep(espera)
    return None


def ejecutar(user_id: str, proyecto: str, pub_id: str,
             video_de: Callable[[dict], Video], relanzar_reclamo: bool = False) -> None:
    """El trabajo completo. Después de reclamar nunca lanza: relanzar sería
    otro intento, y otro intento, un post doble."""
    reclamo = _reclamar(user_id, proyecto, pub_id, relanzar_reclamo)
    if reclamo is None:
        log.info("publicar %s/%s: ya la tomó otro intento o se venció", proyecto, pub_id)
        return
    try:
        _ejecutar(user_id, proyecto, *reclamo, video_de)
    except Exception as err:  # noqa: BLE001
        log.error("publicar %s/%s: fallo inesperado %s", proyecto, pub_id, type(err).__name__)


def _cuenta_conectada(clave: str, reg: dict) -> None:
    reales = blotato.cuentas(clave, timeout=blotato.TIMEOUT_CORTO)
    if not any(str(c.get("id")) == str(reg.get("cuenta_id"))
               and c.get("platform") == reg.get("plataforma") for c in reales):
        raise ValueError("Esa cuenta ya no está conectada en tu Blotato. "
                         "Vuelve a abrir Publicar y elige otra.")


def _ejecutar(user_id: str, proyecto: str, reg: dict, etag: str,
              video_de: Callable[[dict], Video]) -> None:
    pub_id = reg["id"]
    plataforma = reg["plataforma"]
    clave = None
    tam = 0

    # 1) todo lo que puede fallar ANTES de crear el post: no se publicó nada
    try:
        cuando = publicaciones._fecha(reg.get("cuando"))
        if reg.get("cuando") and (cuando is None or cuando < publicaciones.ahora() + 30):
            raise ValueError("La hora programada pasó mientras esperaba en la fila. "
                             "Elige otra hora e intenta de nuevo.")
        clave = blotato.clave_de(user_id)
        if not clave:
            raise ValueError("Conecta tu cuenta de Blotato primero: es el «+» junto "
                             "a Blotato, en el menú del inicio.")
        target = blotato.target_de(plataforma, reg.get("opciones") or {})
        blotato.revisar_texto(plataforma, reg["texto"])
        _cuenta_conectada(clave, reg)
        video = video_de(reg)
        tam = video.tam
        revisar_video(plataforma, video)
        latido = _Latido(user_id, proyecto, reg, etag)
        with video.abrir() as partes:
            media = blotato.subir_stream(clave, _nombre_subida(proyecto, video.nombre),
                                         latido.envolver(partes), video.tam)
        etag = latido.etag
    except publicaciones.Conflicto:
        log.error("publicar %s/%s: otro tocó el registro durante la subida; no se publica",
                  proyecto, pub_id)
        return
    except blotato.SubidaRechazada as err:
        log.error("publicar %s/%s: Blotato rechazó la subida (%s)", proyecto, pub_id, err.codigo)
        mensaje = blotato.explicar_fallo(err, clave)[0]
        # solo lo que puede deberse al tamaño: un 5xx pasajero no es el plan
        if tam > blotato.MAX_BYTES_STARTER and err.codigo in (0, 400, 403, 413):
            mensaje = (f"Blotato no aceptó el archivo ({tam / 1e6:.0f} MB). Con el plan "
                       f"Starter el límite es {blotato.MAX_BYTES_STARTER // 1_000_000} MB; "
                       f"con Creator o Agency, {blotato.MAX_BYTES // 1_000_000} MB. Usa un "
                       "archivo más liviano o cambia de plan. Si tu plan permite ese "
                       "tamaño, intenta de nuevo.")
        _guardar(user_id, proyecto, reg, estado="error", error=mensaje)
        return
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

    # 2) si la pantalla ya pudo darla por muerta, no se publica: lo que dice
    # («no se publicó nada») tiene que ser verdad
    if (publicaciones.ahora() - float(reg.get("actualizado") or 0)
            > publicaciones.VENCE_TRABAJO_S - MARGEN_S):
        log.error("publicar %s/%s: la subida pasó el plazo; no se publica", proyecto, pub_id)
        _guardar(user_id, proyecto, reg, estado="error",
                 error="La subida tardó demasiado y no se publicó nada. Intenta de nuevo.")
        return

    # 3) «creando» con condición: si alguien tocó el registro, no se publica
    reg["estado"] = "creando"
    try:
        publicaciones.guardar(user_id, proyecto, reg, etag)
    except publicaciones.Conflicto:
        log.error("publicar %s/%s: el registro cambió; no se publica", proyecto, pub_id)
        return
    except Exception as err:  # noqa: BLE001 — aún no se pidió el post: error seguro
        log.error("publicar %s/%s: no se pudo marcar creando (%s); no se publica",
                  proyecto, pub_id, type(err).__name__)
        _guardar(user_id, proyecto, reg, estado="error",
                 error="No pudimos publicarla. Intenta de nuevo.")
        return

    # 4) el punto sin retorno
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

    # 5) «publicar ahora»: un rato para saber cómo le fue (si no, lo pregunta
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
        ejecutar(user_id, proyecto, pub_id, video_de, relanzar_reclamo=True)
    finally:
        costes_infra.registrar(user_id, proyecto, "infra-publicar",
                               costes_infra.costo_lambda(time.monotonic() - t0))
