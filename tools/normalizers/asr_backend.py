"""Selección de backend ASR para los tools que transcriben por su cuenta
(puente generated_to_canonical y agregar_video) — plan AWS, paso A2.

El contrato es el mismo de tools/transcribe.py: `.video-stack/config.json`
(escrito por tools/setup.py) decide `asr: local | assemblyai`. Sin config, la
ruta es local con los argumentos del caller — el comportamiento de siempre.

Estos flujos corren desatendidos (jobs del server, puente post-producción), así
que en la ruta nube NO hay prompt interactivo: se IMPRIME el preview de costo
(precios SOLO de tools/pricing.json) y se procede — la transcripción de una
película de ~90 s cuesta menos de $0.01 dólares.

Contrato del transcriptor devuelto: fn(audio: Path) -> list[dict] con palabras
en segundos-float {text, start, end, confidence?} — listas para build_canonical.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent.parent
API_BASE = "https://api.assemblyai.com/v2"
SPEECH_MODELS = ["universal-3-5-pro", "universal-2"]


def cargar_config() -> dict | None:
    cfg = REPO / ".video-stack" / "config.json"
    if not cfg.is_file():
        return None
    return json.loads(cfg.read_text(encoding="utf-8"))


def crear_transcriptor(model: str, device: str) -> tuple:
    """→ (transcribe_fn, backend, modelo). El config manda; sin config = local."""
    cfg = cargar_config()
    if cfg and cfg.get("asr") == "assemblyai":
        modelo_cfg = cfg.get("model") or SPEECH_MODELS[0]
        return _transcriptor_assemblyai(), "assemblyai", modelo_cfg
    return _transcriptor_local(model, device), "faster-whisper", model


# ------------------------------------------------------------------ local

def _transcriptor_local(model_size: str, device: str):
    """faster-whisper en proceso, carga perezosa, con el fallback CUDA→CPU que
    ya usaban el puente y agregar_video (esta máquina no tiene DLLs cublas)."""
    estado = {"model": None, "device": device}

    def _cargar():
        from faster_whisper import WhisperModel
        print(f"cargando faster-whisper {model_size} ({estado['device']})…", flush=True)
        return WhisperModel(model_size, device=estado["device"])

    def _palabras(model, audio: Path) -> list[dict]:
        segments, _info = model.transcribe(str(audio), language="es", word_timestamps=True)
        out = []
        for seg in segments:
            for w in seg.words or []:
                item = {"text": w.word.strip(), "start": round(w.start, 3), "end": round(w.end, 3)}
                if w.probability is not None:
                    item["confidence"] = round(w.probability, 4)
                out.append(item)
        return out

    def fn(audio: Path) -> list[dict]:
        if estado["model"] is None:
            estado["model"] = _cargar()
        try:
            return _palabras(estado["model"], audio)
        except RuntimeError as err:
            if estado["device"] != "auto" or not any(s in str(err) for s in ("cublas", "cudnn", "CUDA")):
                raise
            print(f"CUDA no disponible ({str(err)[:80]}) — reintentando en CPU", flush=True)
            from faster_whisper import WhisperModel
            estado["device"] = "cpu"
            estado["model"] = WhisperModel(model_size, device="cpu", compute_type="int8")
            return _palabras(estado["model"], audio)

    return fn


# ------------------------------------------------------------------ nube

def _api_key() -> str:
    v = os.getenv("ASSEMBLYAI_API_KEY")
    if v:
        return v
    env = REPO / ".env"
    if env.is_file():
        for line in env.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line.startswith("ASSEMBLYAI_API_KEY="):
                v = line.split("=", 1)[1].strip().strip('"').strip("'")
                if v:
                    return v
    sys.exit("config pide asr=assemblyai pero ASSEMBLYAI_API_KEY no está en .env — "
             "corre tools/setup.py o agrega la key")


def duracion_audio_s(path: Path) -> float:
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
        capture_output=True, text=True, check=True)
    return float(r.stdout.strip())


def preview_costo(path: Path) -> tuple[float, float]:
    """→ (costo_usd, duracion_s). Precios SOLO de tools/pricing.json."""
    pricing = json.loads((REPO / "tools" / "pricing.json").read_text(encoding="utf-8"))
    rate = pricing["assemblyai"]["models"]["universal-3-5-pro"]["usd_per_hour"]
    dur = duracion_audio_s(path)
    costo = dur / 3600 * rate
    print(f"  nube AssemblyAI: {path.name} dura {dur:.0f} s ≈ ${costo:.4f} dólares "
          f"(${rate:.2f}/hora, facturación por segundo)", flush=True)
    return costo, dur


def _langfuse():
    """Cliente Langfuse si hay claves en el entorno o el .env (mismas trazas que
    el resto del editor); sin claves o sin paquete → None y todo sigue igual."""
    try:
        from dotenv import load_dotenv
        load_dotenv(REPO / ".env")
    except ImportError:
        pass
    if not os.getenv("LANGFUSE_PUBLIC_KEY"):
        return None
    try:
        from langfuse import get_client
        return get_client()
    except Exception:  # noqa: BLE001 — trazar nunca debe tumbar la transcripción
        return None


def _transcriptor_assemblyai():
    import requests
    headers = {"authorization": _api_key()}

    def _llamar(audio: Path) -> tuple[list[dict], str]:
        with open(audio, "rb") as f:
            up = requests.post(f"{API_BASE}/upload", headers=headers, data=f, timeout=300)
        up.raise_for_status()
        payload = {"audio_url": up.json()["upload_url"], "speech_models": SPEECH_MODELS,
                   "language_code": "es", "punctuate": True, "format_text": True}
        r = requests.post(f"{API_BASE}/transcript", headers=headers, json=payload, timeout=60)
        r.raise_for_status()
        tid = r.json()["id"]
        while True:
            time.sleep(3)
            r = requests.get(f"{API_BASE}/transcript/{tid}", headers=headers, timeout=60)
            r.raise_for_status()
            data = r.json()
            if data["status"] == "completed":
                break
            if data["status"] == "error":
                raise RuntimeError(f"AssemblyAI: {data.get('error')}")
        out = []
        for w in data.get("words") or []:
            item = {"text": w["text"].strip(), "start": round(w["start"] / 1000, 3),
                    "end": round(w["end"] / 1000, 3)}
            if w.get("confidence") is not None:
                item["confidence"] = round(w["confidence"], 4)
            out.append(item)
        modelo = data.get("speech_model_used") or data.get("speech_model") or SPEECH_MODELS[0]
        return out, modelo

    def fn(audio: Path) -> list[dict]:
        costo, dur = preview_costo(audio)
        lf = _langfuse()
        if lf is None:
            return _llamar(audio)[0]
        with lf.start_as_current_observation(
            name="assemblyai_transcript", as_type="generation", model=SPEECH_MODELS[0],
            input={"audio": audio.name, "duracion_s": round(dur, 1)},
            metadata={"backend": "assemblyai"},
        ) as span:
            try:
                out, modelo = _llamar(audio)
            except Exception as e:  # noqa: BLE001
                span.update(level="ERROR", status_message=str(e)[:500])
                lf.flush()
                raise
            span.update(output={"palabras": len(out), "modelo": modelo},
                        usage_details={"audio_s": int(dur)},
                        cost_details={"total": round(costo, 6)})
        lf.flush()   # proceso corto (CLI): sin flush la traza se pierde
        return out

    return fn
