"""b3 — publicar (PLAN-FUSION.md F3.2): fn1 descarga local · fn2 Blotato API.

fn2 exige BLOTATO_API_KEY en .env; sin ella la UI muestra fn1 y el paso a paso
para conectar. Gate duro: nada se publica ni agenda sin confirmar:true, y la
respuesta del agendado queda registrada en work/publicaciones.json.
"""
from __future__ import annotations

import logging
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from pipeline import blotato
from pipeline.config import load_prompt
from pipeline.llm import chat_json
from pipeline.storage import escribir_json, leer_json

log = logging.getLogger("publicar_api")
ROOT = Path(__file__).resolve().parent.parent
router = APIRouter(prefix="/editor")


class TitulosIn(BaseModel):
    plataformas: list[str] = []


class AgendarIn(BaseModel):
    confirmar: bool = False
    cuenta_id: str
    plataforma: str
    texto: str
    archivo: str                      # clave de descargables()
    cuando: str | None = None         # ISO 8601 con zona; None = publicar ya


def _proyecto(name: str) -> Path:
    if not name.replace("-", "").replace("_", "").isalnum():
        raise HTTPException(422, f"nombre inválido: {name}")
    p = ROOT / "videos" / name
    if not p.is_dir():
        raise HTTPException(404, f"proyecto {name} no existe")
    return p


def descargables(p: Path) -> dict[str, Path]:
    """Qué se puede descargar/publicar de un proyecto, por clave estable."""
    out: dict[str, Path] = {}
    if (p / "pelicula.mp4").is_file():
        out["pelicula"] = p / "pelicula.mp4"
    for f in sorted((p / "output").glob("*.mp4")) if (p / "output").is_dir() else []:
        out[f.stem] = f
    if (p / "work" / "subs" / "subs.srt").is_file():
        out["srt"] = p / "work" / "subs" / "subs.srt"
    return out


@router.get("/{name}/api/publicar/estado")
def estado(name: str):
    p = _proyecto(name)
    archivos = [{"clave": k, "nombre": v.name, "mb": round(v.stat().st_size / 1e6, 1)}
                for k, v in descargables(p).items()]
    cuentas, error = [], None
    if blotato.disponible():
        try:
            cuentas = blotato.cuentas()
        except Exception as err:  # noqa: BLE001
            error = f"Blotato no respondió: {str(err)[:200]}"
    return {"descargables": archivos, "blotato": blotato.disponible(),
            "cuentas": cuentas, "error": error,
            "publicadas": leer_json(p / "work" / "publicaciones.json", default=[])}


@router.get("/{name}/descarga/{clave}")
def descargar(name: str, clave: str):
    p = _proyecto(name)
    f = descargables(p).get(clave)
    if not f:
        raise HTTPException(404, f"no hay descargable {clave!r}")
    return FileResponse(f, filename=f"{name}-{f.name}",
                        media_type="video/mp4" if f.suffix == ".mp4" else "text/plain")


@router.post("/{name}/api/publicar/titulos")
async def titulos(name: str, body: TitulosIn):
    """3 títulos sugeridos desde el transcript (gpt-5-mini, ~$0.001)."""
    p = _proyecto(name)
    et = leer_json(p / "work" / "edited-transcript.json", default=None)
    if not et or not et.get("words"):
        raise HTTPException(409, "sin edited-transcript.json — corre el corte o el puente primero")
    texto = " ".join(w["text"] for w in et["words"])[:2500]
    r = await chat_json("titulos_publicar", load_prompt("titulos_system"),
                        f"Plataformas: {', '.join(body.plataformas) or 'generales'}\n\nGuion:\n{texto}")
    lista = [t for t in (r.get("titulos") or []) if isinstance(t, str) and t.strip()][:3]
    if not lista:
        raise HTTPException(502, "el modelo no devolvió títulos")
    return {"titulos": lista}


@router.post("/{name}/api/publicar/agendar")
def agendar(name: str, body: AgendarIn):
    """fn2: sube el video a Blotato (presigned) y crea/agenda el post.
    def (threadpool): la subida del mp4 tarda. Gate confirmar obligatorio."""
    p = _proyecto(name)
    if body.confirmar is not True:
        raise HTTPException(428, "Falta confirmar:true — el gate de publicación es obligatorio")
    if not blotato.disponible():
        raise HTTPException(409, "Falta BLOTATO_API_KEY en el .env")
    archivo = descargables(p).get(body.archivo)
    if not archivo or archivo.suffix != ".mp4":
        raise HTTPException(422, f"archivo no publicable: {body.archivo!r}")
    if not body.texto.strip():
        raise HTTPException(422, "texto vacío")
    try:
        url = blotato.subir_video(archivo)
        r = blotato.publicar(body.cuenta_id, body.plataforma, body.texto.strip(), [url],
                             scheduled_time=body.cuando)
    except Exception as err:  # noqa: BLE001
        log.exception("agendar %s falló", name)
        raise HTTPException(502, f"Blotato falló: {str(err)[:300]}")
    registro = leer_json(p / "work" / "publicaciones.json", default=[])
    registro.append({"plataforma": body.plataforma, "cuenta": body.cuenta_id,
                     "texto": body.texto.strip()[:200], "cuando": body.cuando,
                     "archivo": archivo.name, "respuesta": r})
    escribir_json(p / "work" / "publicaciones.json", registro)
    return {"agendado": True, "respuesta": r}
