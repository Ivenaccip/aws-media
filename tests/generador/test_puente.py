"""Puente generador → editor (tools/normalizers/generated_to_canonical.py).
Lógica pura: orden de concat, ensamblado de timestamps, cuts keep-all y
edited-transcript. Sin red, sin whisper, sin ffmpeg (inyectados)."""
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(REPO / "tools" / "normalizers"))
sys.path.insert(0, str(REPO / "tools"))

import generated_to_canonical as g  # noqa: E402
from common import validate_canonical  # noqa: E402


def test_orden_escenas_lista_txt(tmp_path):
    (tmp_path / "lista.txt").write_text(
        "file 'final_1.mp4'\nfile 'final_5a.mp4'\nfile 'final_5b.mp4'\nfile 'final_10.mp4'\n",
        encoding="utf-8")
    assert g.orden_escenas(tmp_path) == ["1", "5a", "5b", "10"]


def test_orden_escenas_fallback_natural(tmp_path):
    for n in ("final_10.mp4", "final_2.mp4", "final_5b.mp4", "final_5a.mp4", "final_1.mp4"):
        (tmp_path / n).touch()
    assert g.orden_escenas(tmp_path) == ["1", "2", "5a", "5b", "10"]


def test_ensamblar_palabras_offsets_e_itsoffset():
    escenas = [
        ("1", 5.0, [{"text": "hola", "start": 0.0, "end": 0.4, "confidence": 0.99},
                    {"text": "mundo", "start": 0.5, "end": 0.9}]),
        ("2", 6.0, [{"text": "sigue", "start": 0.1, "end": 0.6}]),
    ]
    words = g.ensamblar_palabras(escenas)
    # escena 1: corridas por el itsoffset del mux
    assert words[0]["start"] == pytest.approx(0.3) and words[0]["end"] == pytest.approx(0.7)
    assert words[0]["confidence"] == 0.99 and "confidence" not in words[1]
    # escena 2: offset = duración real del clip 1 (5.0) + itsoffset
    assert words[2]["start"] == pytest.approx(5.4) and words[2]["end"] == pytest.approx(5.9)


def test_ensamblar_palabras_recorta_al_clip():
    escenas = [("1", 2.0, [{"text": "larga", "start": 1.5, "end": 2.5}]),
               ("2", 3.0, [{"text": "ok", "start": 0.0, "end": 0.3}])]
    words = g.ensamblar_palabras(escenas)
    assert words[0]["end"] == 2.0            # nunca invade el clip siguiente
    assert words[1]["start"] == pytest.approx(2.3)


def test_ensamblar_descarta_texto_vacio():
    escenas = [("1", 4.0, [{"text": "  ", "start": 0.0, "end": 0.2},
                           {"text": "real", "start": 0.3, "end": 0.6}])]
    assert [w["text"] for w in g.ensamblar_palabras(escenas)] == ["real"]


def test_convertir_produce_canonico_valido(tmp_path, monkeypatch):
    (tmp_path / "lista.txt").write_text("file 'final_1.mp4'\nfile 'final_2.mp4'\n", encoding="utf-8")
    for n in ("final_1.mp4", "final_2.mp4", "audio_1.mp3", "audio_2.mp3"):
        (tmp_path / n).touch()
    monkeypatch.setattr(g, "duracion_video", lambda p: 5.0)
    fake = {"audio_1.mp3": [{"text": "una", "start": 0.0, "end": 0.3},
                            {"text": "escena.", "start": 0.4, "end": 0.8}],
            "audio_2.mp3": [{"text": "Y", "start": 0.0, "end": 0.2},
                            {"text": "otra.", "start": 0.3, "end": 0.7}]}
    doc = g.convertir(tmp_path, "gen-test", lambda a: fake[a.name])
    validate_canonical(doc)
    assert doc["source"] == {"id": "pelicula", "duration": 10.0, "path": "pelicula.mp4"}
    assert len(doc["words"]) == 4 and len(doc["segments"]) == 2   # el punto cierra segmento
    assert doc["words"][2]["start"] == pytest.approx(5.3)


def test_convertir_falta_audio(tmp_path, monkeypatch):
    (tmp_path / "final_1.mp4").touch()
    monkeypatch.setattr(g, "duracion_video", lambda p: 5.0)
    with pytest.raises(SystemExit):
        g.convertir(tmp_path, "x", lambda a: [])


def test_cuts_keep_all_formato():
    cuts = g.cuts_keep_all("gen-test", 82.92)
    clip = cuts["clips"][0]
    assert cuts["clip_order"] == ["pelicula"] and clip["file"] == "pelicula.mp4"
    assert clip["keeps"][0] == {"s": 0.0, "e": 82.92, "text": "película generada — sin cortes"}
    for style in cuts["styles"].values():   # claves que cutlib/render_cuts exigen
        assert {"internal_gap", "min_tail", "max_tail", "head",
                "soft_gap", "soft_max_tail", "soft_margin"} <= set(style)


def test_edited_transcript_en_ms():
    out = g.edited_transcript_ms([{"text": "hola", "start": 0.3, "end": 0.712}])
    assert out == {"words": [{"text": "hola", "start": 300, "end": 712}]}
