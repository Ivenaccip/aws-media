"""M17 — importar un video de YouTube al proyecto (worker Lambda, <15 min):

  1. corre el actor de descarga de Apify (thenetaji/youtube-video-downloader:
     720p máx, MP4) y espera su dataset;
  2. streamea el archivo del KV store de Apify DIRECTO a S3 como subida del
     proyecto (videos/<nombre>/subidas/… — nunca toca el disco de la Lambda);
  3. registra la subida en doc.subidas y marca doc.importar.estado = "listo";
     a partir de ahí el flujo M8 (analizar → render) aplica sin cambios.

El costo real de Apify (por video + por MB, pricing.json §apify) se registra
en la tabla costes con proveedor 'apify'. Un fallo nuestro devuelve los
créditos del importe y deja el error en doc.importar.
"""
from __future__ import annotations

import json
import logging
import os
import time
from datetime import datetime, timezone
from pathlib import Path

log = logging.getLogger("shorts_importar")

CALIDAD = "720"          # suficiente para recortes 9:16; 1080 duplica los MB


def _ahora() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _precios() -> tuple[float, float, float]:
    """(usd_por_video, usd_por_mb, usd_transcript) de pricing.json — jamás
    hardcodeados."""
    raiz = Path(__file__).resolve().parent.parent
    try:
        p = json.loads((raiz / "tools" / "pricing.json").read_text(encoding="utf-8"))["apify"]
        d = p["youtube_video_downloader"]
        return (float(d["usd_por_video"]), float(d["usd_por_mb"]),
                float(p["youtube_transcript"]["usd_por_video"]))
    except (FileNotFoundError, KeyError, ValueError):
        return 0.01, 0.002, 0.01   # espejo de pricing.json §apify (2026-09-08)


def _ts_a_segundos(ts: str) -> float:
    """'M:SS' o 'H:MM:SS' → segundos."""
    partes = [int(p) for p in str(ts).split(":")]
    s = 0
    for p in partes:
        s = s * 60 + p
    return float(s)


def _canonico_youtube(nombre: str, url: str, fuente_key: str, dur_total: float) -> bool:
    """Mejor esfuerzo: el transcript que YouTube ya tiene (actor topaz, precio
    fijo en pricing.json §apify) se convierte al canónico — así «Analizar» no
    re-transcribe y la transcripción le sale en 0 créditos al usuario. Las
    palabras se reparten proporcionalmente dentro de cada segmento (los
    timestamps de YouTube son por segmento, a segundo redondo): suficiente
    para proponer momentos; el snap a palabra/silencio afina antes de cortar.
    Si no hay transcript (video sin captions), False — AssemblyAI de siempre."""
    from pipeline import apify, media_sync
    from pipeline.config import settings
    from tools.normalizers import common

    try:
        item = apify.correr(settings.apify_yt_transcript,
                            {"startUrls": [url], "timestamps": True},
                            timeout_s=120)[0]
        segmentos = item.get("transcript") or []
        palabras = []
        for i, seg in enumerate(segmentos):
            texto = str(seg.get("text") or "").strip()
            if not texto:
                continue
            ini = _ts_a_segundos(seg.get("timestamp") or 0)
            fin = (_ts_a_segundos(segmentos[i + 1]["timestamp"])
                   if i + 1 < len(segmentos) else (dur_total or ini + 4))
            fin = max(fin, ini + 0.2)
            trozos = texto.split()
            paso = (fin - ini) / len(trozos)
            for k, t in enumerate(trozos):
                palabras.append({"text": t, "start": round(ini + k * paso, 3),
                                 "end": round(ini + (k + 1) * paso, 3)})
        if not palabras:
            return False
        stem = Path(fuente_key).stem
        doc = common.build_canonical(stem, dur_total or palabras[-1]["end"], "es",
                                     "youtube", "captions", palabras,
                                     source_path=fuente_key)
        media_sync.escribir_texto(
            f"videos/{nombre}/work/transcripts/{stem}.canonical.json",
            json.dumps(doc, ensure_ascii=False, indent=1))
        log.info("%s: transcript de YouTube guardado (%d palabras)", nombre, len(palabras))
        return True
    except Exception as err:  # noqa: BLE001 — sin transcript no se cae el importe
        log.warning("%s: sin transcript de YouTube (%s) — Analizar transcribirá", nombre, err)
        return False


def importar(user_id: str, nombre: str, url: str) -> None:
    t0 = time.monotonic()
    os.environ["DEFAULT_USER_ID"] = user_id
    from pipeline import apify, costes_infra, creditos, db
    from pipeline.config import settings

    doc = db.cargar_proyecto_editor(user_id, nombre) or {}
    st = doc.get("importar") or {}
    try:
        items = apify.correr(settings.apify_yt_descarga,
                             {"urls": [{"url": url}], "region": "US",
                              "saveMedia": True, "quality": CALIDAD,
                              "format": "mp4"}, timeout_s=780)
        item = items[0]
        archivo = item.get("savedFile") or {}
        if not archivo.get("url"):
            raise apify.ApifyError(
                f"la descarga no produjo archivo: {str(item.get('error') or item)[:200]}")

        key = f"videos/{nombre}/subidas/{nombre}.mp4"
        octetos = apify.descargar_a_s3(archivo["url"], os.environ["MEDIA_BUCKET"], key)

        # la subida se registra como las de e1 (doc.subidas) — el proyecto es
        # nuevo y este worker es el único escritor: guardar el doc completo va
        doc = db.cargar_proyecto_editor(user_id, nombre) or {}
        doc["subidas"] = [s for s in doc.get("subidas", []) if s.get("key") != key] + [
            {"key": key, "bytes": octetos, "cuando": _ahora()}]
        db.guardar_proyecto_editor(user_id, nombre, json.dumps(doc, ensure_ascii=False))

        dur = float(item.get("durationSeconds") or 0)
        con_tx = _canonico_youtube(nombre, url, key, dur)
        st.update(estado="listo", key=key, bytes=octetos, transcript=con_tx,
                  titulo=str(item.get("title") or "")[:120],
                  duracion_s=dur, listo=_ahora())
        db.fijar_campo_editor(user_id, nombre, "importar",
                              json.dumps(st, ensure_ascii=False))
        log.info("%s: importado %s (%.1f MB)", nombre, key, octetos / 1e6)

        # costo real del vendor (descarga por video + por MB; transcript fijo)
        por_video, por_mb, por_tx = _precios()
        mb = float(archivo.get("billedMb") or 0) or octetos / 1e6
        usd = round(por_video + mb * por_mb + (por_tx if con_tx else 0), 4)
        if db.backend() == "postgres" and usd > 0:
            try:
                db.ejecutar(
                    """INSERT INTO costes (user_id, proyecto_id, concepto, proveedor, costo_usd)
                       VALUES (:u, :p, 'importar-yt', 'apify', :usd)""",
                    {"u": user_id, "p": nombre, "usd": usd})
            except Exception as err:  # noqa: BLE001 — el costo no tumba el importe
                log.warning("%s: no se pudo registrar el costo Apify: %s", nombre, err)
    except Exception as err:  # noqa: BLE001 — estado y devolución van a Postgres
        log.exception("%s: importar de YouTube falló", nombre)
        st.update(estado="error", error=f"{type(err).__name__}: {str(err)[:300]}")
        db.fijar_campo_editor(user_id, nombre, "importar",
                              json.dumps(st, ensure_ascii=False))
        n = int(st.get("creditos") or 0)
        if n and creditos.activo():   # fallo nuestro = créditos de vuelta
            creditos.devolver(n, f"shorts-importar:{nombre}", user_id)
            log.info("%s: %d créditos devueltos", nombre, n)
    finally:
        costes_infra.registrar(user_id, nombre, "infra-importar",
                               costes_infra.costo_lambda(time.monotonic() - t0))
