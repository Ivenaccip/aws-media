"""M18 — copiadora de estilos (worker Lambda, <15 min):

  1. Apify trae la ficha del post (IG: `apify/instagram-scraper` oficial;
     TikTok: `clockworks/tiktok-scraper` con descarga) y de ahí la URL del MP4;
  2. el video (un reel: corto) baja a /tmp, ffmpeg saca frames repartidos y
     cuenta los cortes de escena — la capa determinística (paleta por
     cuantización, aspecto, duración, cadencia) sale gratis;
  3. gpt-5-mini con visión describe lo que los números no ven: tipografía y
     posición de captions, iluminación, estética, tono, encuadre;
  4. el perfil (JSON) queda por usuario en S3: usuarios/<user>/estilos/<id>.json
     — la tarjeta de la UI y, después, los prompts de crear imágenes/contenido.

Regla del plan: copiar ESTILO, nunca clonar contenido — el perfil no guarda el
video ni el texto del post, solo la descripción estética. Fallo nuestro =
créditos de vuelta y el error en el doc.
"""
from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
import subprocess
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

log = logging.getLogger("estilo_analizar")

N_FRAMES = 8            # suficientes para paleta y visión; más = tokens de más
MAX_BYTES = 300 * 1024**2   # un reel jamás pesa esto: corta descargas absurdas
UMBRAL_CORTE = 0.4      # scene-detect de ffmpeg: cambio de plano franco


def _ahora() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _precio_usd(plataforma: str) -> float:
    """Costo real del vendor desde pricing.json §apify — jamás hardcodeado."""
    raiz = Path(__file__).resolve().parent.parent
    try:
        p = json.loads((raiz / "tools" / "pricing.json").read_text(encoding="utf-8"))["apify"]
        if plataforma == "instagram":
            return float(p["instagram_scraper"]["usd_por_resultado"])
        return float(p["tiktok_scraper"]["usd_por_video"])
    except (FileNotFoundError, KeyError, ValueError):
        return 0.005   # espejo de pricing.json §apify (2026-09-08)


def _ficha(url: str, plataforma: str) -> dict:
    """El item del actor: url del MP4 + autor/caption para la tarjeta."""
    from pipeline import apify
    from pipeline.config import settings

    if plataforma == "instagram":
        item = apify.correr(settings.apify_ig,
                            {"directUrls": [url], "resultsType": "posts",
                             "resultsLimit": 1}, timeout_s=180)[0]
        video = item.get("videoUrl")
        autor = str(item.get("ownerUsername") or "")
        caption = str(item.get("caption") or "")
    else:
        item = apify.correr(settings.apify_tiktok,
                            {"postURLs": [url], "resultsPerPage": 1,
                             "shouldDownloadVideos": True}, timeout_s=180)[0]
        video = ((item.get("mediaUrls") or [None])[0]
                 or (item.get("videoMeta") or {}).get("downloadAddr"))
        autor = str((item.get("authorMeta") or {}).get("name") or "")
        caption = str(item.get("text") or "")
    if not video:
        from pipeline.apify import ApifyError
        raise ApifyError("el post no trae video descargable "
                         f"(¿es privado o una foto?): {str(item)[:200]}")
    return {"video_url": video, "autor": autor, "caption": caption[:150]}


def _descargar(video_url: str, destino: Path) -> int:
    import requests
    total = 0
    with requests.get(video_url, stream=True, timeout=120) as r:
        r.raise_for_status()
        with destino.open("wb") as f:
            for trozo in r.iter_content(1024 * 512):
                total += len(trozo)
                if total > MAX_BYTES:
                    raise RuntimeError("el video pesa más de lo que un reel debería")
                f.write(trozo)
    return total


def _sondear(video: Path) -> dict:
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=width,height:format=duration",
         "-of", "json", str(video)], capture_output=True, text=True, timeout=60)
    j = json.loads(r.stdout or "{}")
    st = (j.get("streams") or [{}])[0]
    return {"duracion_s": round(float((j.get("format") or {}).get("duration") or 0), 1),
            "ancho": int(st.get("width") or 0), "alto": int(st.get("height") or 0)}


def _frames(video: Path, carpeta: Path, duracion_s: float) -> list[Path]:
    """N_FRAMES repartidos parejo (centro de cada tramo), escalados a 512 px."""
    salidas = []
    for i in range(N_FRAMES):
        t = max(0.0, duracion_s * (i + 0.5) / N_FRAMES)
        f = carpeta / f"frame-{i}.jpg"
        subprocess.run(
            ["ffmpeg", "-v", "error", "-ss", f"{t:.2f}", "-i", str(video),
             "-frames:v", "1", "-vf", "scale=512:-2", "-y", str(f)],
            capture_output=True, timeout=60)
        if f.exists() and f.stat().st_size:
            salidas.append(f)
    if not salidas:
        raise RuntimeError("ffmpeg no pudo extraer frames del video")
    return salidas


def _cortes(video: Path, carpeta: Path) -> int:
    """Cuántos cambios de plano francos tiene el reel (cadencia de edición)."""
    marcas = carpeta / "cortes.txt"
    subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(video), "-an",
         "-vf", f"select='gt(scene,{UMBRAL_CORTE})',metadata=print:file={marcas}",
         "-f", "null", "-"], capture_output=True, timeout=180)
    try:
        return sum(1 for ln in marcas.read_text(encoding="utf-8").splitlines()
                   if "pts_time" in ln)
    except FileNotFoundError:
        return 0


def _paleta(frames: list[Path], colores: int = 6) -> list[dict]:
    """Los colores dominantes por cuantización (mediancut de Pillow — sin
    sklearn en la imagen): [{hex, pct}] ordenados por presencia."""
    from PIL import Image

    tira = Image.new("RGB", (64 * len(frames), 64))
    for i, f in enumerate(frames):
        with Image.open(f) as im:
            tira.paste(im.convert("RGB").resize((64, 64)), (64 * i, 0))
    q = tira.quantize(colors=colores, method=Image.MEDIANCUT)
    pal = q.getpalette()
    conteo = sorted(q.getcolors() or [], reverse=True)
    total = sum(n for n, _ in conteo) or 1
    return [{"hex": "#%02x%02x%02x" % tuple(pal[3 * idx:3 * idx + 3]),
             "pct": round(100 * n / total)} for n, idx in conteo[:colores]]


def _data_uri(f: Path) -> str:
    return "data:image/jpeg;base64," + base64.b64encode(f.read_bytes()).decode()


async def _perfil_llm(frames: list[Path]) -> dict:
    """gpt-5-mini con visión: lo que la capa determinística no ve."""
    from pipeline.config import load_prompt, settings
    from pipeline.llm import client
    from pipeline.utils import parse_llm_json

    contenido = [{"type": "text",
                  "text": f"{len(frames)} frames en orden cronológico de un video corto vertical."}]
    contenido += [{"type": "image_url",
                   "image_url": {"url": _data_uri(f), "detail": "low"}} for f in frames]
    resp = await client().chat.completions.create(
        model=settings.openai_model,
        name="estilo_perfil",
        messages=[{"role": "system", "content": load_prompt("estilo_perfil_system")},
                  {"role": "user", "content": contenido}])
    return parse_llm_json(resp.choices[0].message.content or "")


def analizar(user_id: str, estilo_id: str, url: str, plataforma: str) -> None:
    t0 = time.monotonic()
    os.environ["DEFAULT_USER_ID"] = user_id
    from pipeline import apify, costes_infra, creditos, db, media_sync

    key_doc = f"usuarios/{user_id}/estilos/{estilo_id}.json"
    doc = json.loads(media_sync.leer_texto(key_doc) or "{}")
    try:
        ficha = _ficha(url, plataforma)
        with tempfile.TemporaryDirectory() as tmp:
            carpeta = Path(tmp)
            video = carpeta / "video.mp4"
            octetos = _descargar(ficha["video_url"], video)
            info = _sondear(video)
            frames = _frames(video, carpeta, info["duracion_s"])
            cortes = _cortes(video, carpeta)
            paleta = _paleta(frames)
            perfil = asyncio.run(_perfil_llm(frames))
        dur = info["duracion_s"] or 1
        doc.update(
            estado="listo", listo=_ahora(),
            fuente={"plataforma": plataforma, "url": url,
                    "autor": ficha["autor"], "caption": ficha["caption"]},
            metrica={"duracion_s": info["duracion_s"], "ancho": info["ancho"],
                     "alto": info["alto"], "cortes": cortes,
                     "cortes_por_min": round(60 * cortes / dur, 1)},
            paleta=paleta, perfil=perfil)
        media_sync.escribir_texto(key_doc, json.dumps(doc, ensure_ascii=False, indent=1))
        log.info("%s: perfil de estilo listo (%.1f MB, %d cortes)",
                 estilo_id, octetos / 1e6, cortes)

        usd = _precio_usd(plataforma)   # costo real del vendor a la tabla costes
        if db.backend() == "postgres" and usd > 0:
            try:
                db.ejecutar(
                    """INSERT INTO costes (user_id, proyecto_id, concepto, proveedor, costo_usd)
                       VALUES (:u, :p, 'estilo-analizar', 'apify', :usd)""",
                    {"u": user_id, "p": estilo_id, "usd": usd})
            except Exception as err:  # noqa: BLE001 — el costo no tumba el análisis
                log.warning("%s: no se pudo registrar el costo Apify: %s", estilo_id, err)
    except Exception as err:  # noqa: BLE001 — estado y devolución quedan registrados
        # el mensaje de un HTTPError trae la URL: tachado en log y en doc
        apify.registrar_fallo(log, err, "%s: análisis de estilo falló", estilo_id)
        doc.update(estado="error", error=apify.describir_error(err))
        media_sync.escribir_texto(key_doc, json.dumps(doc, ensure_ascii=False, indent=1))
        n = int(doc.get("creditos") or 0)
        if n and creditos.activo():   # fallo nuestro = créditos de vuelta
            creditos.devolver(n, f"estilo-analizar:{estilo_id}", user_id)
            log.info("%s: %d créditos devueltos", estilo_id, n)
    finally:
        costes_infra.registrar(user_id, estilo_id, "infra-estilo",
                               costes_infra.costo_lambda(time.monotonic() - t0))
