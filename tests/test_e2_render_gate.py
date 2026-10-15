"""E2 — la compuerta `v:0 == a:0` del render en la nube (CONTRATO E2 §5.5).

CLAUDE.md: «QA no es opcional … gate `ffprobe` v:0 == a:0 en el master». El render
local la corre; el de la nube (`worker/render_task.py`) no la corría, y con una unión
de varios clips —donde un audio que no cuadra se SUMA clip tras clip— un preview
descuadrado se subía como listo. Ahora, si video y audio difieren más de
`DRIFT_TOL_S` (0,15 s, la de make_subs.py e insert_broll.py), el render queda en
`error` y NO se sube. No cobra, así que no hay devolución que probar aquí.

`subprocess` se finge (ni ffmpeg ni S3 ni Postgres); dos pruebas al final miden
archivos reales con ffprobe."""
import json
import re
import shutil
import subprocess
from pathlib import Path
from types import SimpleNamespace

import pytest

from pipeline import costes_infra, db, media_sync, storage
from worker import render_task

RAIZ = Path(__file__).resolve().parent.parent


@pytest.fixture
def nube(monkeypatch, tmp_path):
    """render_task.main entero con dobles. `escenario` decide qué miden ffprobe y render_cuts."""
    destino = tmp_path / "videos" / "ed-1"
    (destino / "output").mkdir(parents=True)
    (destino / "output" / "preview-tight.mp4").write_bytes(b"\x00")
    (destino / "work" / "render" / "tight-preview").mkdir(parents=True)
    (destino / "work" / "render" / "tight-preview" / "segments.json").write_text("{}")
    (destino / "work" / "edited-transcript.json").write_text("{}")
    esc = SimpleNamespace(video=10.0, audio=10.0, render_rc=0, ffprobe_rc=0, streams=None,
                          comandos=[], subidos=[], render=None)

    def corre(cmd, **kw):
        nombre = Path(str(cmd[0])).name
        esc.comandos.append(nombre if nombre == "ffprobe" else Path(str(cmd[1])).name)
        if nombre == "ffprobe":
            if esc.ffprobe_rc:
                raise subprocess.CalledProcessError(esc.ffprobe_rc, cmd)
            streams = esc.streams if esc.streams is not None else [
                {"codec_type": "video", "duration": f"{esc.video:.6f}"},
                {"codec_type": "audio", "duration": f"{esc.audio:.6f}"}]
            return SimpleNamespace(returncode=0, stdout=json.dumps({"streams": streams}), stderr="")
        if cmd[1].endswith("render_cuts.py"):
            return SimpleNamespace(returncode=esc.render_rc, stdout="listo", stderr="boom" if esc.render_rc else "")
        return SimpleNamespace(returncode=0, stdout="", stderr="")      # edited_transcript.py

    monkeypatch.setenv("DEFAULT_USER_ID", "u1")
    monkeypatch.setattr(render_task, "subprocess", SimpleNamespace(run=corre))
    monkeypatch.setattr(storage, "ruta_proyecto", lambda n: destino)
    monkeypatch.setattr(media_sync, "bajar_prefijo", lambda pre, dest: 1)
    monkeypatch.setattr(media_sync, "subir_archivo", lambda local, key: esc.subidos.append(key))
    monkeypatch.setattr(db, "cortes_ultima", lambda u, n: None)
    monkeypatch.setattr(db, "fijar_render_editor",
                        lambda u, n, r: setattr(esc, "render", json.loads(r)))
    monkeypatch.setattr(costes_infra, "registrar", lambda *a, **k: None)
    return esc


def test_si_video_y_audio_cuadran_el_render_queda_listo_y_se_sube(nube):
    nube.audio = 10.10                       # 100 ms: dentro de la tolerancia
    assert render_task.main("u1", "ed-1", "tight") == 0
    assert nube.render["estado"] == "listo"
    assert "videos/ed-1/output/preview-tight.mp4" in nube.subidos
    assert "ffprobe" in nube.comandos


def test_si_no_cuadran_el_render_queda_en_error_y_no_se_sube(nube):
    nube.audio = 9.5                         # medio segundo corto: la unión se descuadró
    assert render_task.main("u1", "ed-1", "tight") == 1
    assert nube.render["estado"] == "error"
    assert "no cuadran" in nube.render["log"] and "key" not in nube.render
    # NADA se sube como listo: ni el preview ni su segments.json
    assert nube.subidos == []
    # ni se deriva el edited-transcript de un corte que no vale
    assert "edited_transcript.py" not in nube.comandos


def test_un_audio_de_mas_tambien_descuadra(nube):
    nube.audio = 10.4
    assert render_task.main("u1", "ed-1", "tight") == 1 and nube.render["estado"] == "error"


@pytest.mark.parametrize("streams", [
    [{"codec_type": "video", "duration": "10.0"}],                 # sin pista de audio
    [{"codec_type": "audio", "duration": "10.0"}],                 # sin video
    [{"codec_type": "video", "duration": "N/A"}, {"codec_type": "audio", "duration": "10.0"}],
    [],
])
def test_un_preview_incompleto_o_ilegible_tampoco_pasa(nube, streams):
    nube.streams = streams
    assert render_task.main("u1", "ed-1", "tight") == 1
    assert nube.render["estado"] == "error" and nube.subidos == []


def test_si_ffprobe_truena_el_preview_no_pasa(nube):
    nube.ffprobe_rc = 1
    assert render_task.main("u1", "ed-1", "tight") == 1
    assert nube.render["estado"] == "error" and nube.subidos == []


def test_si_el_render_mismo_falla_sigue_siendo_como_antes(nube):
    """El camino viejo: render_cuts devuelve 1 → error con la cola del log, y ni siquiera se mide."""
    nube.render_rc = 1
    assert render_task.main("u1", "ed-1", "tight") == 1
    assert nube.render["estado"] == "error" and "boom" in nube.render["log"]
    assert "ffprobe" not in nube.comandos and nube.subidos == []


def test_la_tolerancia_es_la_misma_del_resto_del_repo():
    """Una sola vara: la de make_subs.py e insert_broll.py."""
    for herramienta in ("make_subs.py", "insert_broll.py"):
        texto = (RAIZ / "tools" / herramienta).read_text(encoding="utf-8")
        valor = re.search(r"^DRIFT_TOL_S\s*=\s*([0-9.]+)", texto, re.MULTILINE)
        assert valor and float(valor.group(1)) == render_task.DRIFT_TOL_S, herramienta


# ---------------------------------------------------------------------------
# archivos reales (ffprobe de verdad)

pytestmark_real = pytest.mark.skipif(
    shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None, reason="sin ffmpeg")


def _mp4(destino: Path, video_s: float, audio_s: float) -> Path:
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error",
                    "-f", "lavfi", "-i", f"testsrc=size=160x90:rate=25:duration={video_s}",
                    "-f", "lavfi", "-i", f"sine=frequency=440:sample_rate=48000:duration={audio_s}",
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", str(destino)], check=True)
    return destino


@pytestmark_real
def test_ffprobe_real_deja_pasar_un_archivo_que_cuadra(tmp_path):
    ok, detalle = render_task._cuadran_av(_mp4(tmp_path / "ok.mp4", 2.0, 2.0))
    assert ok and detalle == ""


@pytestmark_real
def test_ffprobe_real_atrapa_un_archivo_descuadrado(tmp_path):
    ok, detalle = render_task._cuadran_av(_mp4(tmp_path / "mal.mp4", 2.0, 1.5))
    assert not ok and "video 2.000 s contra audio 1.5" in detalle
