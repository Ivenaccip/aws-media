"""QC de visión sobre la imagen de inicio (antes de Veo): orientación y dirección del personaje."""
from __future__ import annotations

from typing import Literal

from langfuse import get_client, observe
from pydantic import BaseModel

from .config import load_prompt, settings
from .llm import client
from .models import Scene
from .utils import parse_llm_json

Veredicto = Literal["ok", "corregido", "fallido", "omitido"]


class QC(BaseModel):
    ok: bool
    personaje_mira_hacia: str = "unclear"
    objetivo_en_pantalla: str = "n/a"
    motivo: str = ""
    correccion: str = ""


def interpretar_qc(r: dict) -> QC:
    """Tolerante: si el modelo no decide, se aprueba (no bloquear por QC dudoso)."""
    ok = r.get("ok")
    if not isinstance(ok, bool):
        ok = True
    correccion = str(r.get("correccion") or "").strip()
    if not ok and not correccion:  # sin instrucción no podemos corregir nada
        ok = True
    return QC(
        ok=ok,
        personaje_mira_hacia=str(r.get("personaje_mira_hacia") or "unclear"),
        objetivo_en_pantalla=str(r.get("objetivo_en_pantalla") or "n/a"),
        motivo=str(r.get("motivo") or ""),
        correccion="" if ok else correccion,
    )


def prompt_con_correccion(prompt_imagen: str, correccion: str) -> str:
    return f"{prompt_imagen} IMPORTANT STAGING: {correccion}"


@observe(name="qc_imagen")
async def qc_imagen(e: Scene, image_url: str, intento: int) -> QC:
    user = load_prompt("qc_imagen_user").format(
        narracion=e.narracion, prompt_visual=e.prompt_visual, prompt_movimiento=e.prompt_movimiento
    )
    resp = await client().chat.completions.create(
        model=settings.qc_model,
        name="qc_imagen",
        messages=[
            {"role": "system", "content": load_prompt("qc_imagen_system")},
            {"role": "user", "content": [
                {"type": "text", "text": user},
                {"type": "image_url", "image_url": {"url": image_url, "detail": "high"}},
            ]},
        ],
    )
    try:
        qc = interpretar_qc(parse_llm_json(resp.choices[0].message.content or ""))
    except ValueError:
        qc = QC(ok=True, motivo="respuesta del QC no parseable; se aprueba")
    lf = get_client()
    lf.update_current_span(
        output=qc.model_dump(),
        metadata={"escena": e.id, "intento": intento},
        level="DEFAULT" if qc.ok else "WARNING",
        status_message=None if qc.ok else qc.motivo[:200],
    )
    lf.score_current_span(name="qc_orientacion", value=1 if qc.ok else 0, comment=qc.motivo[:300])
    return qc
