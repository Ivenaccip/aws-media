"""Tests de los normalizadores contra fixtures reales pequeñas.

Correr desde la raíz del repo:  python -m pytest tests/ -q
Todos los canónicos producidos se validan contra schema/transcript.schema.json.
"""

import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "tools" / "normalizers"))

import assemblyai_to_canonical as aai
import canonical_to_s1_dual as dual
import fasterwhisper_to_canonical as fw
from common import validate_canonical, SCHEMA_VERSION

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture
def aai_doc():
    import json
    raw = json.loads((FIXTURES / "assemblyai_sample.json").read_text(encoding="utf-8"))
    return aai.convert(raw, source_id="0233", source_path="DJI_0233.MP4")


@pytest.fixture
def fw_doc():
    import json
    raw = json.loads((FIXTURES / "fasterwhisper_sample.json").read_text(encoding="utf-8"))
    return fw.convert(raw, source_id="raw", source_path="input.mp4")


class TestAssemblyAIToCanonical:
    def test_valida_contra_schema(self, aai_doc):
        validate_canonical(aai_doc)

    def test_ms_a_segundos_float(self, aai_doc):
        # 120 ms -> 0.12 s; 5480 ms -> 5.48 s
        assert aai_doc["words"][0]["start"] == 0.12
        assert aai_doc["words"][-1]["end"] == 5.48

    def test_metadatos(self, aai_doc):
        assert aai_doc["schema_version"] == SCHEMA_VERSION
        assert aai_doc["asr"]["backend"] == "assemblyai"
        assert aai_doc["asr"]["model"] == "universal-3-5-pro"
        assert aai_doc["language"] == "es"
        assert aai_doc["source"] == {"id": "0233", "duration": 6.0, "path": "DJI_0233.MP4"}

    def test_confidence_preservada(self, aai_doc):
        assert aai_doc["words"][0]["confidence"] == 0.99

    def test_segmentos_por_puntuacion_y_gap(self, aai_doc):
        # "…deploy." (puntuación) | "…parece," + gap 0.92s | "en serio."
        assert [(s["first_word"], s["last_word"]) for s in aai_doc["segments"]] == \
            [(0, 5), (6, 12), (13, 14)]
        assert aai_doc["segments"][2]["text"] == "en serio."


class TestFasterWhisperToCanonical:
    def test_valida_contra_schema(self, fw_doc):
        validate_canonical(fw_doc)

    def test_palabras_aplanadas_en_orden(self, fw_doc):
        assert len(fw_doc["words"]) == 14
        starts = [w["start"] for w in fw_doc["words"]]
        assert starts == sorted(starts)
        assert fw_doc["words"][1]["text"] == "hook"  # sin espacio inicial

    def test_metadatos(self, fw_doc):
        assert fw_doc["asr"] == {"backend": "faster-whisper", "model": "medium"}
        assert fw_doc["source"]["duration"] == 7.2

    def test_segmentos(self, fw_doc):
        # "…gap." cierra por puntuación (y hay gap ~1s); "…final." cierra al final
        assert [(s["first_word"], s["last_word"]) for s in fw_doc["segments"]] == \
            [(0, 7), (8, 13)]


class TestCanonicalToS1Dual:
    def test_roundtrip_estructura(self, fw_doc):
        out = dual.convert(fw_doc)
        assert set(out) == {"language", "duration", "word_count", "model", "segments", "captions"}
        assert out["word_count"] == 14
        assert len(out["captions"]) == 14

    def test_segmentos_estilo_whisperx(self, fw_doc):
        seg = dual.convert(fw_doc)["segments"][0]
        assert seg["start"] == 0.1 and seg["end"] == 2.94
        assert seg["words"][0] == {"word": "Este", "start": 0.1, "end": 0.38}

    def test_captions_remotion_ms_y_espacios(self, fw_doc):
        caps = dual.convert(fw_doc)["captions"]
        assert caps[0] == {"text": "Este", "startMs": 100, "endMs": 380}
        # palabra no inicial de segmento lleva espacio antepuesto (convención S1)
        assert caps[1]["text"] == " hook"
        # primera palabra del segundo segmento, sin espacio
        assert caps[8]["text"] == "Y"

    def test_rechaza_version_desconocida(self, fw_doc):
        fw_doc["schema_version"] = "9.9"
        from common import require_version
        with pytest.raises(SystemExit):
            require_version(fw_doc)

    def test_desde_assemblyai_tambien(self, aai_doc):
        # el dual no debe saber de qué backend vino
        out = dual.convert(aai_doc)
        assert out["captions"][0]["startMs"] == 120
        assert out["segments"][0]["text"].startswith("Hoy vamos")
