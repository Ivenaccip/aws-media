"""Configuración desde variables de entorno (.env)."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

from pipeline.storage import work_root

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
    # F4.3: WORK_DIR explícito manda; si no, MEDIA_ROOT/work (default = ./work del repo)
    work_dir: Path = field(default_factory=work_root)
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
    fal_nano: str = "fal-ai/nano-banana"            # texto → imagen (M1 sin referencia)
    fal_nano_edit: str = "fal-ai/nano-banana/edit"  # imagen + referencia (g2, editor de imágenes)

    # M17 — actores Apify (formato usuario~nombre, como pide su API REST)
    apify_yt_info: str = "thenetaji~youtube-video-details-scraper"   # cotizar: título+duración
    apify_yt_descarga: str = "thenetaji~youtube-video-downloader"    # bajar el MP4 (por MB)

    # Backend de regeneración g1/g2 y M1: fal (default desde 2026-09-03 — los
    # créditos del Studio de Google se agotaron) | google (Gemini API)
    gen_backend: str = os.getenv("GEN_BACKEND", "fal")
    blotato_api_key: str = os.getenv("BLOTATO_API_KEY", "")
    gemini_api_key: str = os.getenv("GEMINI_API_KEY", "")
    gemini_image_model: str = os.getenv("GEMINI_IMAGE_MODEL", "gemini-2.5-flash-image")
    gemini_veo_model: str = os.getenv("GEMINI_VEO_MODEL", "veo-3.1-lite-generate-preview")
    veo_resolution: str = os.getenv("VEO_RESOLUTION", "720p")


settings = Settings()


class PromptTexto(str):
    """M10: un str normal que además recuerda de qué prompt de Langfuse salió.
    Sobrevive al .format() de los call sites, así llm.chat_json puede enlazar
    la generation a la versión del prompt sin cambiar ninguna firma."""
    objeto = None   # TextPromptClient de Langfuse, o None (texto local)

    def format(self, *args, **kwargs):  # noqa: A003 — mismo contrato que str
        s = PromptTexto(str.format(self, *args, **kwargs))
        s.objeto = self.objeto
        return s


def _prompt_langfuse(name: str, local: str):
    """El prompt `production` desde Langfuse (caché con TTL del SDK), o None.
    Solo con LANGFUSE_PROMPTS=1 (lo cablea la infra; dev local y tests siguen
    leyendo los .md del repo) — y JAMÁS tumba al caller."""
    if os.getenv("LANGFUSE_PROMPTS", "") not in ("1", "true", "yes"):
        return None
    if not os.getenv("LANGFUSE_PUBLIC_KEY"):
        return None
    try:
        from langfuse import get_client
        obj = get_client().get_prompt(name, label="production", type="text",
                                      fallback=local, max_retries=1,
                                      fetch_timeout_seconds=3)
        # fallback usado = Langfuse no respondió o el prompt no existe allá:
        # manda el .md local y no se enlaza una versión que no se sirvió
        return None if getattr(obj, "is_fallback", False) else obj
    except Exception:  # noqa: BLE001 — el pipeline jamás se cae por un prompt
        return None


def load_prompt(name: str) -> str:
    """Texto del prompt: Langfuse (label `production`) primero, con fallback al
    .md del repo. El templating sigue siendo el .format() local de Python — los
    placeholders {var} no cambian aunque el texto viva en Langfuse."""
    local = (PROMPTS_DIR / f"{name}.md").read_text(encoding="utf-8")
    obj = _prompt_langfuse(name, local)
    texto = PromptTexto(obj.prompt if obj else local)
    texto.objeto = obj
    return texto
