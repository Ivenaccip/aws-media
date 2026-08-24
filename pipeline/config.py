"""Configuración desde variables de entorno (.env)."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

ROOT = Path(__file__).resolve().parent.parent
PROMPTS_DIR = ROOT / "prompts"


def _env(name: str, default: str | None = None) -> str:
    v = os.getenv(name, default)
    if v is None:
        raise RuntimeError(f"Falta la variable de entorno {name}")
    return v


@dataclass(frozen=True)
class Settings:
    openai_model: str = os.getenv("OPENAI_MODEL", "gpt-5-mini")
    ffmpeg_bin: str = os.getenv("FFMPEG_BIN", "ffmpeg")
    work_dir: Path = Path(os.getenv("WORK_DIR", "./work"))
    fal_concurrency: int = int(os.getenv("FAL_CONCURRENCY", "4"))
    grok_timeout_s: int = int(os.getenv("GROK_TIMEOUT_S", "300"))
    veo_timeout_s: int = int(os.getenv("VEO_TIMEOUT_S", "720"))
    veo_max_attempts: int = int(os.getenv("VEO_MAX_ATTEMPTS", "2"))
    qc_enabled: bool = os.getenv("QC_ENABLED", "1") not in ("0", "false", "no")
    qc_model: str = os.getenv("QC_MODEL", "gpt-5")  # mini confunde izquierda/derecha
    qc_max_retries: int = int(os.getenv("QC_MAX_RETRIES", "1"))
    sheet_id: str = os.getenv("SHEET_ID", "")
    sheet_range: str = os.getenv("SHEET_RANGE", "Hoja 1")
    drive_folder_id: str = os.getenv("DRIVE_FOLDER_ID", "")
    google_sa_file: str = os.getenv("GOOGLE_SERVICE_ACCOUNT_FILE", "")

    # Endpoints fal (mismos que en n8n v9)
    fal_tts: str = "fal-ai/elevenlabs/tts/eleven-v3"
    fal_grok: str = "xai/grok-imagine-image/edit"
    fal_veo: str = "fal-ai/veo3.1/lite/image-to-video"

    # Backend de regeneración g1/g2 (PLAN-FUSION.md F2.3): google (Gemini API) | fal
    gen_backend: str = os.getenv("GEN_BACKEND", "google")
    gemini_api_key: str = os.getenv("GEMINI_API_KEY", "")
    gemini_image_model: str = os.getenv("GEMINI_IMAGE_MODEL", "gemini-2.5-flash-image")
    gemini_veo_model: str = os.getenv("GEMINI_VEO_MODEL", "veo-3.1-lite-generate-preview")
    veo_resolution: str = os.getenv("VEO_RESOLUTION", "720p")


settings = Settings()


def load_prompt(name: str) -> str:
    return (PROMPTS_DIR / f"{name}.md").read_text(encoding="utf-8")
