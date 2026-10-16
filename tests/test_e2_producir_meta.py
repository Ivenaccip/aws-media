"""E2 — `doc.meta`: la medición de la película que deja `worker/producir_task.py`
(CONTRATO E2 §4.4, opcional).

«Elegir de Mis creaciones» necesita la duración, el formato y si trae audio de cada
película. Medirlos con `ffprobe` sobre una URL cuesta 1–8 s por video y la Lambda corta
a 29 s; la tarea de producción ya tiene la película en disco, así que la mide gratis y la
deja en el doc. Lo que defiende este archivo: la medición es la correcta, solo vale con la
misma `key`/`bytes` de la subida, y NUNCA tumba una producción.

ffprobe real con un clip sintético; todo lo demás, doble. Sin red, sin dinero."""
import json
import shutil
import subprocess
from pathlib import Path
from types import SimpleNamespace

import pytest

from worker import producir_task

pytestmark = pytest.mark.skipif(
    shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None, reason="sin ffmpeg")


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


def _mp4(destino: Path, size: str = "320x180", dur: float = 2.0, audio: bool = True,
         rotar: bool = False) -> Path:
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", f"testsrc=size={size}:rate=24:duration={dur}"]
    if audio:
        cmd += ["-f", "lavfi", "-i", f"sine=frequency=440:sample_rate=48000:duration={dur}", "-c:a", "aac"]
    subprocess.run([*cmd, "-c:v", "libx264", "-pix_fmt", "yuv420p", str(destino)], check=True)
    if rotar:
        girado = _con_rotacion(destino, destino.with_name("girado.mp4"))
        if girado is None:
            pytest.skip("este ffmpeg no sabe marcar la rotación de un video")
        return girado
    return destino


def test_la_medicion_es_la_de_ffprobe(tmp_path):
    peli = _mp4(tmp_path / "pelicula.mp4")
    meta = producir_task._meta_pelicula(peli, "videos/gen-aaa/pelicula.mp4")
    assert meta["key"] == "videos/gen-aaa/pelicula.mp4" and meta["bytes"] == peli.stat().st_size
    assert meta["duracion_s"] == pytest.approx(2.0, abs=0.1)
    assert (meta["ancho"], meta["alto"], meta["audio"]) == (320, 180, True)
    assert meta["medido"].endswith("+00:00")


def test_una_pelicula_vertical_o_girada_queda_vertical(tmp_path):
    vert = producir_task._meta_pelicula(_mp4(tmp_path / "v.mp4", size="180x320"), "k")
    assert (vert["ancho"], vert["alto"]) == (180, 320)
    girada = producir_task._meta_pelicula(_mp4(tmp_path / "h.mp4", rotar=True), "k")
    assert (girada["ancho"], girada["alto"]) == (180, 320)       # con la rotación aplicada, como el API


def test_sin_pista_de_audio_lo_dice(tmp_path):
    assert producir_task._meta_pelicula(_mp4(tmp_path / "m.mp4", audio=False), "k")["audio"] is False


@pytest.mark.parametrize("roto", ["basura", "vacio", "no_hay"])
def test_un_archivo_que_no_se_puede_medir_da_none_y_no_levanta(tmp_path, roto):
    f = tmp_path / "pelicula.mp4"
    if roto == "basura":
        f.write_bytes(b"esto no es un video")
    elif roto == "vacio":
        f.write_bytes(b"")
    assert producir_task._meta_pelicula(f, "k") is None


def test_si_no_hay_ffprobe_no_levanta(tmp_path, monkeypatch):
    peli = _mp4(tmp_path / "p.mp4")               # se arma ANTES: el doble pisa subprocess.run de todos

    def sin_ffprobe(*a, **k):
        raise FileNotFoundError("ffprobe")
    monkeypatch.setattr(producir_task.subprocess, "run", sin_ffprobe)
    assert producir_task._meta_pelicula(peli, "k") is None


# ---------------------------------------------------------------------------
# el cableado de main(): el doc del puente lleva `meta`, y producir sigue funcionando sin ella

def _produccion(monkeypatch, tmp_path, peli_bytes: bytes | None):
    """producir_task.main con el pipeline entero espiado; devuelve (doc guardado, código de salida)."""
    from pipeline import costes_infra, creditos, db, flow, media_sync
    from pipeline import project as project_mod
    monkeypatch.setenv("DEFAULT_USER_ID", "u1")
    monkeypatch.setenv("MEDIA_ROOT", str(tmp_path))
    editor = tmp_path / "videos" / "gen-aaa"
    editor.mkdir(parents=True)
    if peli_bytes is not None:
        (editor / "pelicula.mp4").write_bytes(peli_bytes)
    p = SimpleNamespace(estado="listo", workdir=tmp_path / "w", progreso={"editor": "gen-aaa"},
                        duracion_s=30, error=None)

    async def producir(proy, fase="todo"):
        return None
    guardado = {}
    monkeypatch.setattr(flow, "producir", producir)
    monkeypatch.setattr(media_sync, "bajar_prefijo", lambda pref, d: 0)
    monkeypatch.setattr(media_sync, "subir_dir", lambda d, pref: 0)
    monkeypatch.setattr(project_mod, "cargar_proyecto", lambda id_: p)
    monkeypatch.setattr(costes_infra, "registrar", lambda *a: None)
    monkeypatch.setattr(costes_infra, "costo_fargate", lambda s: 0.0)
    monkeypatch.setattr(creditos, "activo", lambda: False)
    monkeypatch.setattr(db, "guardar_proyecto_editor",
                        lambda u, n, doc: guardado.update(usuario=u, nombre=n, doc=json.loads(doc)))
    return guardado, producir_task.main("u1", "abc123")


def test_el_doc_del_puente_lleva_la_medicion_atada_a_la_subida(monkeypatch, tmp_path):
    peli = _mp4(tmp_path / "origen.mp4")
    guardado, rc = _produccion(monkeypatch, tmp_path, peli.read_bytes())
    assert rc == 0 and guardado["nombre"] == "gen-aaa"
    doc = guardado["doc"]
    meta, subida = doc["meta"], doc["subidas"][0]
    # la caché del API solo vale con la MISMA key y los MISMOS bytes que la subida
    assert (meta["key"], meta["bytes"]) == (subida["key"], subida["bytes"]) == ("videos/gen-aaa/pelicula.mp4", len(peli.read_bytes()))
    assert meta["duracion_s"] == pytest.approx(2.0, abs=0.1) and (meta["ancho"], meta["alto"]) == (320, 180)
    # el resto del doc es el de siempre
    assert doc["origen"] == {"generador": "abc123", "user_id": "u1"} and doc["flags"]["generado"] is True


def test_si_la_medicion_falla_la_produccion_termina_igual_y_sin_meta(monkeypatch, tmp_path):
    guardado, rc = _produccion(monkeypatch, tmp_path, b"no es un video")
    assert rc == 0                                   # producir NO se cae por una medición opcional
    assert "meta" not in guardado["doc"] and guardado["doc"]["subidas"][0]["archivo"] == "pelicula.mp4"


def test_sin_pelicula_no_hay_subida_ni_meta(monkeypatch, tmp_path):
    guardado, rc = _produccion(monkeypatch, tmp_path, None)
    assert rc == 0 and guardado["doc"]["subidas"] == [] and "meta" not in guardado["doc"]
