"""Pista 2 (pipeline/overlays.py): modelo, versionado y libro de gastos.
Sin ffmpeg ni red — solo la lógica de estado sobre tmp_path."""
import json
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(REPO))

from pipeline import overlays  # noqa: E402
from pipeline.pricing import estimar_regeneracion  # noqa: E402


def _produccion(tmp_path):
    work = tmp_path / "work_gen"
    work.mkdir()
    for oid in ("1", "2"):
        (work / f"final_{oid}.mp4").write_bytes(b"v")
        (work / f"audio_{oid}.mp3").write_bytes(b"a")
    (work / "estado.json").write_text(json.dumps({"escenas": [
        {"id": "1", "narracion": "uno", "prompt_imagen": "bear at cave", "estilo_prompt": "flat cartoon",
         "prompt_movimiento": "dolly in", "veo_negativo": "humans"},
        {"id": "2", "narracion": "dos", "prompt_imagen": "bear sleeping"},
    ]}), encoding="utf-8")
    (work / "proyecto.json").write_text(json.dumps({"guion": [
        {"id": "1", "narracion": "uno"}, {"id": "2", "narracion": "dos"}]}), encoding="utf-8")
    proj = tmp_path / "videos" / "gen-x"
    (proj / "work").mkdir(parents=True)
    return work, proj


def test_crear_desde_produccion(tmp_path):
    work, proj = _produccion(tmp_path)
    data = overlays.crear_desde_produccion(proj, work, ["1", "2"], {"1": 5.0, "2": 6.5})
    assert data["estilo_prompt"] == "flat cartoon"
    o1, o2 = data["overlays"]
    assert (o1["t_in"], o1["t_out"], o2["t_in"], o2["t_out"]) == (0.0, 5.0, 5.0, 11.5)
    assert o1["prompt_imagen"] == "bear at cave" and o1["veo_negativo"] == "humans"
    assert (proj / "work" / "overlays" / "2" / "v1.mp4").is_file()
    assert (proj / "work" / "overlays" / "2" / "audio.mp3").is_file()
    assert overlays.costo_total(data) == 0.0   # la producción original no suma al libro


def test_versionado_y_gastos(tmp_path):
    work, proj = _produccion(tmp_path)
    overlays.crear_desde_produccion(proj, work, ["1"], {"1": 5.0})
    nuevo = proj / "nuevo.mp4"
    nuevo.write_bytes(b"v2")
    imagen = proj / "img.jpg"
    imagen.write_bytes(b"i")
    v = overlays.agregar_version(proj, "1", nuevo, imagen, 0.3)
    overlays.registrar_gasto(proj, "video", "1", 0.3)
    data = overlays.cargar(proj)
    ov = overlays.obtener(data, "1")
    assert v["n"] == 2 and ov["version_activa"] == 2
    assert ov["versiones"][1]["imagen_base"] == "overlays/1/v2.jpg"
    assert (proj / "work" / "overlays" / "1" / "v2.mp4").is_file()
    assert overlays.costo_total(data) == 0.3
    # volver a la versión original (el undo que cuesta $0)
    overlays.activar_version(proj, "1", 1)
    assert overlays.obtener(overlays.cargar(proj), "1")["version_activa"] == 1
    with pytest.raises(KeyError):
        overlays.activar_version(proj, "1", 9)


def test_duracion_y_version_activa():
    ov = {"id": "1", "t_in": 2.0, "t_out": 8.5, "version_activa": 2,
          "versiones": [{"n": 1, "video": "a"}, {"n": 2, "video": "b"}]}
    assert overlays.duracion_clip(ov) == 6.5
    assert overlays.version_activa(ov)["video"] == "b"


def test_estimar_regeneracion_google():
    est = estimar_regeneracion(6.5, n_imagenes=2, backend="google")
    assert est["veo_segundos"] == 8                      # 6.5s → clip Veo de 8s
    assert est["imagen"] == pytest.approx(0.078)         # 2 × $0.039 nano banana
    assert est["video"] == pytest.approx(0.40)           # 8 × $0.05 veo lite 720p
    assert est["total"] == pytest.approx(0.478)
    corto = estimar_regeneracion(3.2, n_imagenes=1, backend="google")
    assert corto["veo_segundos"] == 4 and corto["total"] == pytest.approx(0.239)
