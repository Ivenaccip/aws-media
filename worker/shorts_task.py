"""M8 — render de shorts en Fargate (la lanza la state machine):

    python -m worker.shorts_task <user_id> <nombre>

Los segmentos aprobados, estilo, plataforma y tipo salen de
proyectos_editor.doc.shorts.render (los dejó el API al cobrar). Pipeline —el
mismo del skill /shorts, sin las partes interactivas:

  snap_boundaries → extract con STREAM COPY (regla dura) → compute_reframe →
  Remotion (render.mjs, Chromium del sistema) → export.sh (la ÚNICA pasada de
  loudnorm) → validate.sh → S3 videos/<n>/output/shorts/

Sale con 1 si algo falló; el motivo queda en doc.shorts.render.log y los
créditos del render se devuelven.
"""
from __future__ import annotations

import json
import logging
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from worker.env_ssm import cargar_env_ssm

cargar_env_ssm()

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("shorts_task")

ROOT = Path(__file__).resolve().parent.parent


def _ahora() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _correr(cmd: list[str], **kw) -> str:
    """Ejecuta y devuelve stdout+stderr; RuntimeError con la cola si falla."""
    r = subprocess.run(cmd, capture_output=True, text=True, cwd=str(ROOT), **kw)
    salida = (r.stdout or "") + (r.stderr or "")
    if r.returncode != 0:
        raise RuntimeError(f"{Path(cmd[0]).name} {cmd[1] if len(cmd) > 1 else ''}: {salida[-500:]}")
    return salida


def _canonico_local(destino: Path) -> Path:
    canonicos = sorted((destino / "work" / "transcripts").glob("*.canonical.json"))
    if not canonicos:
        raise RuntimeError("sin transcript canónico — corre el análisis primero")
    return canonicos[0]


def _pipeline(user_id: str, nombre: str, destino: Path, st: dict) -> list[dict]:
    import os
    from pipeline import media_sync
    from tools.normalizers.canonical_to_s1_dual import convert

    render = st["render"]
    fuente = destino / Path(st["fuente"]).relative_to(f"videos/{nombre}")
    if not fuente.is_file():
        raise RuntimeError(f"el metraje {st['fuente']} no bajó de S3")
    tmp = destino / "work" / "shorts"          # SHORTS_TMP de siempre
    (tmp / "clips").mkdir(parents=True, exist_ok=True)

    # transcript dual (captions Remotion + segments para el snap). v1 sin la
    # limpieza LLM de muletillas del skill — queda anotada como deuda M8-1.
    canonico = json.loads(_canonico_local(destino).read_text(encoding="utf-8"))
    dual = convert(canonico)
    (tmp / "transcript.json").write_text(json.dumps(dual, ensure_ascii=False), encoding="utf-8")

    tipo = render.get("tipo") or "auto"
    if tipo == "auto":
        _correr(["python", str(ROOT / "tools" / "shorts" / "detect_content.py"),
                 str(fuente), "--output", str(tmp / "content_type.json")])
        tipo = json.loads((tmp / "content_type.json").read_text(encoding="utf-8"))["content_type"]

    aprobados = {"segments": render["segmentos"], "style": render["estilo"],
                 "platform": render["plataforma"], "content_type": tipo}
    (tmp / "approved_segments.json").write_text(
        json.dumps(aprobados, ensure_ascii=False), encoding="utf-8")

    _correr(["python", str(ROOT / "tools" / "shorts" / "snap_boundaries.py"),
             "--segments", str(tmp / "approved_segments.json"),
             "--transcript", str(tmp / "transcript.json"),
             "--input-video", str(fuente),
             "--output", str(tmp / "snapped_segments.json")])
    snapped = json.loads((tmp / "snapped_segments.json").read_text(encoding="utf-8"))

    for seg in snapped["segments"]:              # extract: stream copy OBLIGATORIO
        clip = tmp / "clips" / f"clip_{int(seg['id']):02d}.mp4"
        _correr(["ffmpeg", "-y", "-loglevel", "error",
                 "-ss", f"{seg['start']:.3f}", "-to", f"{seg['end']:.3f}",
                 "-i", str(fuente), "-c", "copy", str(clip)])

    _correr(["python", str(ROOT / "tools" / "shorts" / "compute_reframe.py"),
             "--clips-dir", str(tmp / "clips"), "--content-type", tipo,
             "--output", str(tmp / "reframe.json")])

    log.info("%s: renderizando %d shorts con Remotion (%s)…",
             nombre, len(snapped["segments"]), render["estilo"])
    _correr(["node", str(ROOT / "remotion" / "render.mjs"),
             "--segments", str(tmp / "snapped_segments.json"),
             "--reframe", str(tmp / "reframe.json"),
             "--captions", str(tmp / "transcript.json"),
             "--style", render["estilo"], "--clips-dir", str(tmp / "clips"),
             "--output-dir", str(tmp / "render")], timeout=3600)

    salida_dir = destino / "output" / "shorts"
    _correr(["bash", str(ROOT / "tools" / "shorts" / "export.sh"),
             "--input-dir", str(tmp / "render"),
             "--platform", render["plataforma"],
             "--output-dir", str(salida_dir)])
    _correr(["bash", str(ROOT / "tools" / "shorts" / "validate.sh"),
             "--output-dir", str(salida_dir)])

    cdn = os.getenv("CDN_BASE", "").rstrip("/")
    salidas = []
    for f in sorted(salida_dir.glob("*.mp4")):
        key = f"videos/{nombre}/output/shorts/{f.name}"
        media_sync.subir_archivo(f, key)
        salidas.append({"archivo": f.name, "bytes": f.stat().st_size,
                        "url": f"{cdn}/{key}" if cdn else None})
    if not salidas:
        raise RuntimeError("el export no produjo ningún MP4")
    return salidas


def main(user_id: str, nombre: str) -> int:
    import os
    t0 = time.monotonic()
    os.environ["DEFAULT_USER_ID"] = user_id
    from pipeline import costes_infra, creditos, db, media_sync
    from pipeline.storage import ruta_proyecto

    doc = db.cargar_proyecto_editor(user_id, nombre) or {}
    st = doc.get("shorts") or {}
    render = st.get("render") or {}
    if not render.get("segmentos"):
        log.error("%s: sin segmentos aprobados en doc.shorts.render", nombre)
        return 1

    destino = ruta_proyecto(nombre)
    log.info("%s: %d artefactos bajados de S3", nombre,
             media_sync.bajar_prefijo(f"videos/{nombre}/", destino))
    try:
        salidas = _pipeline(user_id, nombre, destino, st)
        render.update(estado="listo", fin=_ahora(), salidas=salidas)
        ok = True
        log.info("%s: %d shorts exportados", nombre, len(salidas))
    except Exception as err:  # noqa: BLE001 — el motivo viaja por Postgres
        log.exception("%s: render de shorts falló", nombre)
        render.update(estado="error", fin=_ahora(), log=str(err)[:500])
        ok = False
    st["render"] = render
    db.fijar_campo_editor(user_id, nombre, "shorts", json.dumps(st, ensure_ascii=False))
    # M6.1: la infra se gastó igual haya salido bien o mal
    costes_infra.registrar(user_id, nombre, "infra-shorts",
                           costes_infra.costo_fargate(time.monotonic() - t0))
    if not ok:
        n = int(render.get("creditos") or 0)
        if n and creditos.activo():   # fallo nuestro = créditos de vuelta
            creditos.devolver(n, f"shorts-render:{nombre}", user_id)
            log.info("%s: %d créditos devueltos", nombre, n)
    return 0 if ok else 1


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("uso: python -m worker.shorts_task <user_id> <nombre>")
    sys.exit(main(sys.argv[1], sys.argv[2]))
