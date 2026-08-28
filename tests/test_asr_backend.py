"""A2: la selección de backend ASR de los tools que transcriben solos
(puente y agregar_video) respeta .video-stack/config.json."""

import json
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "tools" / "normalizers"))

import asr_backend
import generated_to_canonical as g
from common import validate_canonical


def _con_config(tmp_path, monkeypatch, cfg: dict | None):
    """Apunta asr_backend a una raíz temporal con (o sin) config."""
    monkeypatch.setattr(asr_backend, "REPO", tmp_path)
    if cfg is not None:
        d = tmp_path / ".video-stack"
        d.mkdir()
        (d / "config.json").write_text(json.dumps(cfg), encoding="utf-8")


def test_sin_config_es_local(tmp_path, monkeypatch):
    _con_config(tmp_path, monkeypatch, None)
    fn, backend, modelo = asr_backend.crear_transcriptor("small", "auto")
    assert backend == "faster-whisper" and modelo == "small"
    assert callable(fn)  # carga perezosa: crear el transcriptor no carga whisper


def test_config_local_es_local(tmp_path, monkeypatch):
    _con_config(tmp_path, monkeypatch, {"asr": "local", "model": "medium"})
    _fn, backend, modelo = asr_backend.crear_transcriptor("small", "auto")
    # el caller decide modelo/device en la ruta local (mismo contrato de siempre)
    assert backend == "faster-whisper" and modelo == "small"


def test_config_assemblyai(tmp_path, monkeypatch):
    _con_config(tmp_path, monkeypatch, {"asr": "assemblyai", "model": "universal-3-5-pro"})
    monkeypatch.setenv("ASSEMBLYAI_API_KEY", "clave-de-prueba")
    _fn, backend, modelo = asr_backend.crear_transcriptor("small", "auto")
    assert backend == "assemblyai" and modelo == "universal-3-5-pro"


def test_config_assemblyai_sin_key_falla(tmp_path, monkeypatch):
    _con_config(tmp_path, monkeypatch, {"asr": "assemblyai"})
    monkeypatch.delenv("ASSEMBLYAI_API_KEY", raising=False)
    with pytest.raises(SystemExit):
        asr_backend.crear_transcriptor("small", "auto")


def test_convertir_propaga_backend(tmp_path, monkeypatch):
    """El canónico del puente registra la procedencia real (enum del esquema)."""
    (tmp_path / "lista.txt").write_text("file 'final_1.mp4'\n", encoding="utf-8")
    for n in ("final_1.mp4", "audio_1.mp3"):
        (tmp_path / n).touch()
    monkeypatch.setattr(g, "duracion_video", lambda p: 5.0)
    palabras = [{"text": "hola", "start": 0.0, "end": 0.4, "confidence": 0.99}]
    doc = g.convertir(tmp_path, "gen-test", lambda a: palabras,
                      backend="assemblyai", model="universal-3-5-pro")
    validate_canonical(doc)
    assert doc["asr"] == {"backend": "assemblyai", "model": "universal-3-5-pro"}
