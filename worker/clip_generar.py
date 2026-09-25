"""M25 · A/F — el clip de 8 segundos (worker Lambda, un par de minutos):

  1. las imágenes que subió el usuario (0 a 3) bajan de S3 y suben a fal;
  2. el LLM traduce su petición en español a un prompt de Veo en inglés;
  3. con dos o tres imágenes, Grok las junta en una sola (esa es el cuadro
     inicial); con una se anima directo; con ninguna es text-to-video;
  4. Veo entrega el video CON audio, que es lo que se cobró;
  5. el video se guarda en S3 bajo el usuario y el doc queda listo:
     usuarios/<user>/clips/<id>.json

La regla que gobierna este worker: **no relanza nunca.** Un reintento de la
cola generaría un segundo video —otros $0.40 dólares— que nadie pidió y que el
usuario no vería. Por eso todo error se atrapa aquí: el doc queda en `error`,
los créditos vuelven completos y la Lambda termina bien para que SQS borre el
mensaje.

La devolución es de TODO. A diferencia de la competencia, aquí no hay partes:
o hay video o no hay nada que entregar.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

log = logging.getLogger("clip_generar")


def _ahora() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


async def _correr(doc: dict, tmp: Path) -> dict:
    """Las imágenes a fal y el clip a Veo. Todo lo async en una sola corrida."""
    from pipeline import clip, fal, media_sync

    urls: list[str] = []
    for i, key in enumerate((doc.get("imagenes") or [])[:clip.MAX_IMAGENES]):
        destino = tmp / f"img_{i}{Path(key).suffix.lower() or '.jpg'}"
        if not media_sync.bajar_archivo(key, destino):
            raise clip.ClipError("No se pudo leer una de las imágenes que subiste")
        urls.append(await fal.subir_archivo(destino))

    res = await clip.generar(doc.get("texto", ""), urls,
                             doc.get("formato") or "horizontal")

    # El enlace que devuelve fal caduca: la copia que se queda es la nuestra.
    local = tmp / "clip.mp4"
    await fal.descargar(res["video_url"], local)
    res["bytes"] = local.stat().st_size
    res["_local"] = local
    return res


def generar(user_id: str, clip_id: str) -> None:
    t0 = time.monotonic()
    os.environ["DEFAULT_USER_ID"] = user_id
    from pipeline import clip, costes_infra, creditos, db, media_sync

    key_doc = f"usuarios/{user_id}/clips/{clip_id}.json"
    doc = json.loads(media_sync.leer_texto(key_doc) or "{}")
    n = int(doc.get("creditos") or 0)

    try:
        with tempfile.TemporaryDirectory() as td:
            res = asyncio.run(_correr(doc, Path(td)))
            key_video = f"usuarios/{user_id}/clips/{clip_id}.mp4"
            media_sync.subir_archivo(res.pop("_local"), key_video)

        doc.update(estado="listo", listo=_ahora(), key=key_video,
                   prompt=res["prompt"], prompt_composicion=res["prompt_composicion"],
                   recorte=res["recorte"], origen_inicial=res["origen_inicial"],
                   segundos=res["segundos"], bytes=res["bytes"])
        media_sync.escribir_texto(key_doc, json.dumps(doc, ensure_ascii=False, indent=1))
        log.info("%s: clip listo (%d imagen(es), %s)", clip_id,
                 len(doc.get("imagenes") or []), res["origen_inicial"])

        if db.backend() == "postgres":
            usd = clip.costo_usd(len(doc.get("imagenes") or []))
            try:
                db.ejecutar(
                    """INSERT INTO costes (user_id, proyecto_id, concepto, proveedor, costo_usd)
                       VALUES (:u, :p, 'clip', 'fal', :usd)""",
                    {"u": user_id, "p": clip_id, "usd": usd})
            except Exception as err:  # noqa: BLE001 — el costo no tumba el clip
                log.warning("%s: no se pudo registrar el costo de fal: %s", clip_id, err)
    except Exception as err:  # noqa: BLE001 — se atrapa TODO: relanzar cobraría otro video
        motivo = str(err)[:300] if isinstance(err, clip.ClipError) else \
            "El video no se pudo generar. No se te cobró."
        log.exception("%s: el clip falló", clip_id)
        doc.update(estado="error", error=motivo, listo=_ahora())
        try:
            media_sync.escribir_texto(key_doc, json.dumps(doc, ensure_ascii=False, indent=1))
        except Exception:  # noqa: BLE001 — la devolución importa más que el doc
            log.exception("%s: tampoco se pudo escribir el error", clip_id)
        if n and creditos.activo():   # fallo nuestro = créditos de vuelta, completos
            creditos.devolver(n, f"clip:{clip_id}", user_id)
            log.info("%s: %d créditos devueltos", clip_id, n)
    finally:
        costes_infra.registrar(user_id, clip_id, "infra-clip",
                               costes_infra.costo_lambda(time.monotonic() - t0))
