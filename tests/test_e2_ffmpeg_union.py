"""E2 — unir clips con ffmpeg REAL y metraje sintético (`-f lavfi`).

Lo que defiende (CONTRATO E2 §5.4 y §7.1): las dos herramientas que la unión de
videos usa, `tools/make_proxy.py` (el proxy del editor) y `tools/render_cuts.py`
(el preview que dispara la persona), aguantan lo que de verdad llega a una
unión de «Mis creaciones» y subidas:

  * un clip SIN pista de audio junto a otro con audio (los clips de IA de 8 s);
  * fps y frecuencias de muestreo distintas (24 fps/44,1 kHz mono + 30 fps/48 kHz);
  * 16:9 junto a 4:3, dos verticales, y un teléfono con `rotation: 90`.

Antes del arreglo `make_proxy.py` reventaba con exit 234 (`-map 0:1`), dejaba el
proxy con video 8,77 s y audio 7,67 s, y agrandaba los verticales a 1280×2276;
`render_cuts.py` reventaba sin audio y dejaba un 4:3 con `non monotonically
increasing dts`. El master local NO cambia: el modo `final` de `render_cuts.py`
sigue sin filtro de video y con su encoder de siempre (flujo de video-stack).

Sin red, sin dinero. Se salta solo si la máquina no tiene ffmpeg; en CI corre
dentro del contenedor, que sí lo trae."""
import importlib
import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parent.parent
TOOLS = RAIZ / "tools"
DRIFT_TOL_S = 0.15     # la de make_subs.py / insert_broll.py: lo que el repo tolera entre v:0 y a:0

pytestmark = pytest.mark.skipif(
    shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None,
    reason="ffmpeg/ffprobe no están instalados")


# ---------------------------------------------------------------------------
# metraje sintético (receta de CONTRATO E2 §7.1)

def _ffmpeg(*args) -> None:
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *map(str, args)], check=True)


def _clip(dest: Path, *, size: str, rate: int, dur: float, tono: tuple[int, int, int] | None,
          patron: str = "testsrc") -> None:
    """Un MP4 H.264 de prueba. `tono` = (frecuencia, tasa de muestreo, canales) o
    None para un clip SIN pista de audio."""
    entradas = ["-f", "lavfi", "-i", f"{patron}=size={size}:rate={rate}:duration={dur}"]
    audio: list = []
    if tono:
        hz, sr, canales = tono
        entradas += ["-f", "lavfi", "-i", f"sine=frequency={hz}:sample_rate={sr}:duration={dur}"]
        audio = ["-ac", canales, "-c:a", "aac"]
    _ffmpeg(*entradas, *audio, "-c:v", "libx264", "-pix_fmt", "yuv420p", dest)


def _gira(path: Path) -> bool:
    """¿El archivo se ve girado 90° (display matrix)? Lo mismo que mira el código de producción."""
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream_side_data=rotation",
                        "-of", "json", str(path)], capture_output=True, text=True, encoding="utf-8")
    try:
        lado = [d for s in json.loads(r.stdout).get("streams", []) for d in s.get("side_data_list", [])]
    except ValueError:
        return False
    return any(abs(int(d.get("rotation", 0))) % 180 == 90 for d in lado)


def _con_rotacion(src: Path, dst: Path) -> Path | None:
    """`src` SIN recodificar y con rotación de 90° (se ve vertical), o None si este ffmpeg no sabe
    marcarla. `-display_rotation` es de ffmpeg 6; la imagen del CI (Debian bookworm) trae la 5.1,
    que lo hace con el tag `rotate`."""
    for args in (["-display_rotation", "90", "-i", str(src), "-c", "copy"],
                 ["-i", str(src), "-c", "copy", "-metadata:s:v:0", "rotate=90"]):
        r = subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *args, str(dst)], capture_output=True)
        if r.returncode == 0 and _gira(dst):
            return dst
    return None


@pytest.fixture(scope="module")
def metraje(tmp_path_factory) -> dict[str, Path]:
    d = tmp_path_factory.mktemp("metraje")
    c = {n: d / f"{n}.mp4" for n in
         ("a", "a2", "estereo", "b43", "sin_audio", "v1", "v2", "a_rot")}
    _clip(c["a"], size="320x180", rate=24, dur=1.5, tono=(440, 44100, 1))          # 16:9, 24 fps, mono 44,1 kHz
    _clip(c["a2"], size="320x180", rate=24, dur=1.2, tono=(330, 44100, 1))         # idéntico formato al anterior
    _clip(c["estereo"], size="320x180", rate=30, dur=1.2, tono=(660, 48000, 2))    # 16:9, 30 fps, estéreo 48 kHz
    _clip(c["b43"], size="240x180", rate=30, dur=1.2, tono=(660, 48000, 2), patron="testsrc2")   # 4:3
    _clip(c["sin_audio"], size="320x180", rate=25, dur=1.0, tono=None)             # SIN pista de audio
    _clip(c["v1"], size="180x320", rate=25, dur=1.0, tono=(500, 44100, 1))         # vertical
    _clip(c["v2"], size="180x320", rate=30, dur=1.0, tono=(700, 48000, 2))         # vertical, otro fps
    c["a_rot"] = _con_rotacion(c["a"], c["a_rot"])                                 # 320x180 con rotation 90 → vertical (o None)
    # el audio dura 150 ms MENOS que el video (los clips de IA suelen quedar así)
    c["audio_corto"] = d / "audio_corto.mp4"
    _ffmpeg("-f", "lavfi", "-i", "testsrc=size=320x180:rate=24:duration=2",
            "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=1.85",
            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", c["audio_corto"])
    return c


def _sonda(path: Path) -> dict:
    """Lo que `ffprobe` dice del archivo: tamaño y cadencia del video, y la
    duración de CADA flujo (la que decide si el audio y el video cuadran)."""
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries",
         "stream=index,codec_type,width,height,r_frame_rate,duration,sample_rate,channels:format=duration",
         "-of", "json", str(path)], capture_output=True, text=True, encoding="utf-8", check=True)
    j = json.loads(r.stdout)
    v = next((s for s in j["streams"] if s["codec_type"] == "video"), None)
    a = next((s for s in j["streams"] if s["codec_type"] == "audio"), None)
    return {
        "w": v["width"], "h": v["height"], "fps": v["r_frame_rate"],
        "dur_v": float(v["duration"]), "dur_a": float(a["duration"]) if a else None,
        "sr": int(a["sample_rate"]) if a else None, "canales": a["channels"] if a else None,
        "formato": float(j["format"]["duration"]),
    }


def _sin_avisos(path: Path) -> None:
    """Decodificar de punta a punta no escribe una sola línea en stderr
    (`non monotonically increasing dts`, `Invalid`… aparecerían aquí)."""
    r = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-f", "null", "-"],
                       capture_output=True, text=True, encoding="utf-8")
    assert r.returncode == 0 and r.stderr.strip() == "", r.stderr


# ---------------------------------------------------------------------------
# un proyecto de la unión en disco (lo que arma worker/editar_copia.py)

def _duracion(path: Path) -> float:
    return _sonda(path)["formato"]


def _proyecto(raiz: Path, clips: list[tuple[str, Path]]) -> Path:
    """`raiz` con clips/<id>.mp4, work/analysis/cuts.json (keeps COMPLETOS),
    work/audio/<id>.wav (16 kHz mono; silencio si el clip no trae audio) y
    work/transcripts/<id>.json sin palabras."""
    from tools.normalizers.generated_to_canonical import STYLES_DEFAULT
    (raiz / "clips").mkdir(parents=True)
    (raiz / "work" / "analysis").mkdir(parents=True)
    (raiz / "work" / "audio").mkdir(parents=True)
    (raiz / "work" / "transcripts").mkdir(parents=True)
    entradas = []
    for cid, origen in clips:
        destino = raiz / "clips" / f"{cid}.mp4"
        shutil.copy(origen, destino)
        dur = round(_duracion(destino), 3)
        wav = raiz / "work" / "audio" / f"{cid}.wav"
        if _sonda(destino)["dur_a"] is None:
            _ffmpeg("-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono", "-t", dur, wav)
        else:
            _ffmpeg("-i", destino, "-vn", "-ac", 1, "-ar", 16000, wav)
        (raiz / "work" / "transcripts" / f"{cid}.json").write_text('{"words": []}', encoding="utf-8")
        entradas.append({"id": cid, "file": f"clips/{cid}.mp4", "duration": dur,
                         "keeps": [{"s": 0.0, "e": dur, "text": ""}], "cuts": [],
                         "fluff_suggestions": []})
    (raiz / "work" / "analysis" / "cuts.json").write_text(json.dumps({
        "project": raiz.name, "clip_order": [c for c, _ in clips], "clips": entradas,
        "styles": STYLES_DEFAULT, "flags": []}), encoding="utf-8")
    return raiz


def _correr(script: str, *args) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, str(TOOLS / script), *map(str, args)],
                          capture_output=True, text=True, encoding="utf-8", cwd=str(RAIZ))


# Cada caso: (clips en orden, tamaño esperado de la salida). La orientación del
# PRIMER clip manda (el servidor ya rechazó mezclar horizontales con verticales).
CASOS = {
    "mismo_formato":        (["a", "a2"], (1280, 720)),
    "clip_sin_audio":       (["a", "sin_audio"], (1280, 720)),
    "sin_audio_primero":    (["sin_audio", "a"], (1280, 720)),
    "fps_y_audio_distintos": (["a", "estereo"], (1280, 720)),
    "16_9_con_4_3":         (["a", "b43"], (1280, 720)),
    "mezcla_de_todo":       (["a", "sin_audio", "b43", "estereo"], (1280, 720)),
    "dos_verticales":       (["v1", "v2"], (720, 1280)),
    "telefono_rotado":      (["a_rot", "v1"], (720, 1280)),
}


def _armar(tmp_path, metraje, caso):
    nombres, esperado = CASOS[caso]
    if any(metraje[n] is None for n in nombres):
        pytest.skip("este ffmpeg no sabe marcar la rotación de un video")
    proyecto = _proyecto(tmp_path / "copia", [(f"c{i + 1:02d}", metraje[n])
                                              for i, n in enumerate(nombres)])
    return proyecto, esperado


# ---------------------------------------------------------------------------
# tools/make_proxy.py

@pytest.mark.parametrize("caso", list(CASOS))
def test_el_proxy_de_la_union_cuadra(tmp_path, metraje, caso):
    proyecto, (w, h) = _armar(tmp_path, metraje, caso)
    r = _correr("make_proxy.py", proyecto)
    assert r.returncode == 0, r.stderr[-800:]

    proxy = proyecto / "work" / "editor" / "proxy.mp4"
    s = _sonda(proxy)
    assert (s["w"], s["h"]) == (w, h)
    # y TODAS las partes: `concat -c copy` no se queja si una parte salió de otro tamaño
    partes = sorted((proyecto / "work" / "editor").glob("part-*.mp4"))
    assert len(partes) == len(CASOS[caso][0])
    assert {(_sonda(x)["w"], _sonda(x)["h"]) for x in partes} == {(w, h)}
    assert s["dur_a"] is not None                   # SIEMPRE hay pista de audio (a:0)
    # video y audio parejos: antes del arreglo, v 8,77 s contra a 7,67 s
    assert abs(s["dur_v"] - s["dur_a"]) <= DRIFT_TOL_S, s
    # y el manifiesto (los offsets del editor) cuenta lo mismo que el video
    manifiesto = json.loads((proyecto / "work" / "editor" / "manifest.json").read_text())
    assert abs(manifiesto["total"] - s["dur_v"]) <= 0.05, (manifiesto["total"], s["dur_v"])
    assert [p["id"] for p in manifiesto["parts"]] == [f"c{i + 1:02d}" for i in range(len(CASOS[caso][0]))]
    assert (proyecto / "work" / "editor" / "waveform.png").is_file()
    _sin_avisos(proxy)
    assert s["fps"] == "30/1"                       # todas las partes a la misma cadencia
    assert (s["sr"], s["canales"]) == (48000, 2)    # y el mismo audio: AAC 48 kHz estéreo


def test_el_proxy_de_un_solo_clip_sigue_funcionando(tmp_path, metraje):
    """Lo de siempre (flujo local y E1 con un video): un clip con audio."""
    proyecto = _proyecto(tmp_path / "copia", [("c01", metraje["a"])])
    assert _correr("make_proxy.py", proyecto).returncode == 0
    s = _sonda(proyecto / "work" / "editor" / "proxy.mp4")
    assert (s["w"], s["h"]) == (1280, 720) and s["dur_a"] is not None
    assert abs(s["dur_v"] - 1.5) <= 0.1


# ---------------------------------------------------------------------------
# tools/render_cuts.py --mode preview

@pytest.mark.parametrize("caso", list(CASOS))
def test_el_preview_de_la_union_cuadra(tmp_path, metraje, caso):
    proyecto, (w, h) = _armar(tmp_path, metraje, caso)
    r = _correr("render_cuts.py", proyecto, "--style", "tight", "--mode", "preview")
    assert r.returncode == 0, r.stderr[-800:]

    salida = proyecto / "output" / "preview-tight.mp4"
    s = _sonda(salida)
    assert (s["w"], s["h"]) == (w, h)
    segs = sorted((proyecto / "work" / "render" / "tight-preview").glob("seg_*.mp4"))
    assert segs and {(_sonda(x)["w"], _sonda(x)["h"]) for x in segs} == {(w, h)}
    assert s["dur_a"] is not None
    assert abs(s["dur_v"] - s["dur_a"]) <= DRIFT_TOL_S, s    # la compuerta v:0 == a:0 del repo
    _sin_avisos(salida)                             # antes: «non monotonically increasing dts» con el 4:3
    segmentos = json.loads((proyecto / "work" / "render" / "tight-preview" / "segments.json").read_text())
    assert [x["clip"] for x in segmentos["segments"]] == [f"c{i + 1:02d}" for i in range(len(CASOS[caso][0]))]
    assert s["fps"] == "30/1"                       # antes: 120/1 (VFR) con 24 y 30 fps juntos


# ---------------------------------------------------------------------------
# la deriva que se SUMA: un audio más corto que su video, clip tras clip

def test_un_audio_mas_corto_que_su_video_no_acumula_deriva(tmp_path, metraje):
    """Cuatro clips con 150 ms de audio de menos: sin rellenar, cada uno acorta el
    audio del master y la unión se descuadra 0,58 s (la compuerta tolera 0,15)."""
    proyecto = _proyecto(tmp_path / "copia", [(f"c{i + 1:02d}", metraje["audio_corto"]) for i in range(4)])
    assert _correr("render_cuts.py", proyecto, "--style", "tight", "--mode", "preview").returncode == 0
    s = _sonda(proyecto / "output" / "preview-tight.mp4")
    assert abs(s["dur_v"] - 8.0) <= 0.1
    assert abs(s["dur_v"] - s["dur_a"]) <= DRIFT_TOL_S, s
    assert _correr("make_proxy.py", proyecto).returncode == 0
    p = _sonda(proyecto / "work" / "editor" / "proxy.mp4")
    assert abs(p["dur_v"] - p["dur_a"]) <= DRIFT_TOL_S, p
    # y no se recortó video para igualar al audio corto (`-shortest` sin relleno lo hacía)
    assert abs(p["dur_v"] - 8.0) <= 0.1, p


def test_un_clip_sin_audio_aporta_silencio_de_su_duracion_exacta(tmp_path, metraje):
    """Entre dos clips con audio, el que no trae pista no mueve el audio de los demás:
    el master dura lo mismo en video que en audio y el silencio ocupa su lugar."""
    proyecto = _proyecto(tmp_path / "copia", [("c01", metraje["a"]), ("c02", metraje["sin_audio"]),
                                              ("c03", metraje["a2"])])
    assert _correr("render_cuts.py", proyecto, "--style", "tight", "--mode", "preview").returncode == 0
    segmentos = json.loads((proyecto / "work" / "render" / "tight-preview" / "segments.json").read_text())["segments"]
    esperado = sum(x["dur"] for x in segmentos)
    s = _sonda(proyecto / "output" / "preview-tight.mp4")
    assert abs(s["dur_a"] - esperado) <= 0.05 and abs(s["dur_v"] - esperado) <= 0.05, (esperado, s)


# ---------------------------------------------------------------------------
# el master local NO cambia

def _importar_render_cuts():
    sys.path.insert(0, str(TOOLS))
    try:
        sys.modules.pop("render_cuts", None)
        return importlib.import_module("render_cuts")
    finally:
        sys.path.remove(str(TOOLS))


def test_el_modo_final_no_lleva_filtro_de_video():
    rc = _importar_render_cuts()
    assert rc.VF["final"] == []
    assert rc.AUDIO_BITRATE == {"preview": "160k", "final": "256k"}


def _tiene_encoder(nombre: str) -> bool:
    if shutil.which("ffmpeg") is None:
        return False
    salida = subprocess.run(["ffmpeg", "-hide_banner", "-encoders"],
                            capture_output=True, text=True, encoding="utf-8").stdout
    return any(nombre in linea for linea in salida.splitlines())


@pytest.mark.skipif(not _tiene_encoder("libx265"), reason="este ffmpeg no trae libx265")
def test_el_master_final_conserva_el_tamano_de_la_fuente(tmp_path, metraje):
    """El flujo local de video-stack (4K, HEVC 10-bit, sin escalar): `final` no pasa
    por el normalizador de la unión. Si alguien le pusiera el `scale+pad` de
    `preview`, un 320×180 saldría 1280×720."""
    proyecto = _proyecto(tmp_path / "copia", [("c01", metraje["a"]), ("c02", metraje["a2"])])
    r = _correr("render_cuts.py", proyecto, "--style", "tight", "--mode", "final")
    assert r.returncode == 0, r.stderr[-800:]
    salida = proyecto / "output" / "master-tight.mp4"
    s = _sonda(salida)
    assert (s["w"], s["h"]) == (320, 180)
    assert abs(s["dur_v"] - s["dur_a"]) <= DRIFT_TOL_S
    codec = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
         "stream=codec_name,pix_fmt", "-of", "csv=p=0", str(salida)],
        capture_output=True, text=True, encoding="utf-8", check=True).stdout.strip()
    assert codec == "hevc,yuv420p10le"


# ---------------------------------------------------------------------------
# tools/edited_transcript.py con un clip sin transcript

def _canonico(cid: str, dur: float, palabras: list[tuple[str, float, float]]) -> dict:
    from tools.normalizers import common
    words = [{"text": t, "start": s, "end": e} for t, s, e in palabras]
    return common.build_canonical(cid, dur, "es", "assemblyai", "universal-2", words,
                                  source_path=f"clips/{cid}.mp4")


def _unido_para_transcript(raiz: Path, *, sin_transcript: bool, marca: bool = True) -> Path:
    """Dos clips ya renderizados: c01 con palabras y c02 sin canónico."""
    (raiz / "work" / "analysis").mkdir(parents=True)
    (raiz / "work" / "transcripts").mkdir(parents=True)
    seg = raiz / "work" / "render" / "tight-preview"
    seg.mkdir(parents=True)
    c1 = {"id": "c01", "file": "clips/c01.mp4", "duration": 2.0,
          "keeps": [{"s": 0.0, "e": 2.0, "text": ""}], "cuts": [], "fluff_suggestions": []}
    c2 = {"id": "c02", "file": "clips/c02.mp4", "duration": 3.0,
          "keeps": [{"s": 0.0, "e": 3.0, "text": ""}], "cuts": [], "fluff_suggestions": []}
    if sin_transcript and marca:
        c2["sin_transcript"] = True
    (raiz / "work" / "analysis" / "cuts.json").write_text(json.dumps(
        {"project": "x", "clip_order": ["c01", "c02"], "clips": [c1, c2], "styles": {}, "flags": []}))
    (raiz / "work" / "transcripts" / "c01.canonical.json").write_text(json.dumps(
        _canonico("c01", 2.0, [("hola", 0.2, 0.5), ("mundo", 0.6, 1.0)])), encoding="utf-8")
    (seg / "segments.json").write_text(json.dumps({"style": "tight", "mode": "preview", "segments": [
        {"clip": "c01", "s": 0.0, "e": 2.0, "dur": 2.0},
        {"clip": "c02", "s": 0.0, "e": 3.0, "dur": 3.0}]}))
    return raiz


def test_un_clip_sin_transcript_aporta_cero_palabras(tmp_path):
    proyecto = _unido_para_transcript(tmp_path / "u", sin_transcript=True)
    r = _correr("edited_transcript.py", proyecto, "--style", "tight", "--mode", "preview")
    assert r.returncode == 0, r.stdout + r.stderr
    salida = json.loads((proyecto / "work" / "edited-transcript.json").read_text(encoding="utf-8"))
    assert [w["text"] for w in salida["words"]] == ["hola", "mundo"]
    assert salida["source"]["total_ms"] == 5000          # el clip sin palabras SÍ cuenta en el tiempo


def test_el_sin_transcript_va_despues_de_los_clips_con_palabras(tmp_path):
    """Las palabras de un clip posterior se corren por la duración REAL del que
    no trae palabras (el offset no se pierde)."""
    proyecto = _unido_para_transcript(tmp_path / "u", sin_transcript=True)
    cuts = json.loads((proyecto / "work" / "analysis" / "cuts.json").read_text())
    cuts["clip_order"] = ["c02", "c01"]
    (proyecto / "work" / "analysis" / "cuts.json").write_text(json.dumps(cuts))
    segs = proyecto / "work" / "render" / "tight-preview" / "segments.json"
    meta = json.loads(segs.read_text())
    meta["segments"].reverse()
    segs.write_text(json.dumps(meta))
    assert _correr("edited_transcript.py", proyecto, "--style", "tight", "--mode", "preview").returncode == 0
    palabras = json.loads((proyecto / "work" / "edited-transcript.json").read_text())["words"]
    assert palabras[0] == {"text": "hola", "start": 3200, "end": 3500}


def test_sin_canonico_y_sin_la_marca_sigue_siendo_error(tmp_path):
    """La tolerancia es SOLO para un clip marcado `sin_transcript`: un canónico que
    falta por accidente sigue deteniendo la herramienta (docs/SCHEMA.md)."""
    proyecto = _unido_para_transcript(tmp_path / "u", sin_transcript=True, marca=False)
    r = _correr("edited_transcript.py", proyecto, "--style", "tight", "--mode", "preview")
    assert r.returncode != 0
    assert "el canónico es obligatorio" in (r.stdout + r.stderr)
    assert not (proyecto / "work" / "edited-transcript.json").exists()


def test_sin_cuts_json_el_canonico_sigue_siendo_obligatorio(tmp_path):
    """Un proyecto viejo sin `cuts.json` junto al render: no se inventa nada."""
    proyecto = _unido_para_transcript(tmp_path / "u", sin_transcript=True)
    (proyecto / "work" / "analysis" / "cuts.json").unlink()
    r = _correr("edited_transcript.py", proyecto, "--style", "tight", "--mode", "preview")
    assert r.returncode != 0 and "el canónico es obligatorio" in (r.stdout + r.stderr)


def test_si_ningun_clip_trae_transcript_lo_dice_con_claridad(tmp_path):
    """Una unión solo de clips de IA no tiene palabras: la herramienta lo dice en vez
    del genérico «0 palabras mapeadas» (que sugiere un render de otro corte)."""
    proyecto = _unido_para_transcript(tmp_path / "u", sin_transcript=True)
    cuts = json.loads((proyecto / "work" / "analysis" / "cuts.json").read_text())
    for c in cuts["clips"]:
        c["sin_transcript"] = True
    (proyecto / "work" / "analysis" / "cuts.json").write_text(json.dumps(cuts))
    r = _correr("edited_transcript.py", proyecto, "--style", "tight", "--mode", "preview")
    assert r.returncode != 0 and "ningún clip de este corte trae transcript" in (r.stdout + r.stderr)
