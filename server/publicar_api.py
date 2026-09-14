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
from pipeline.storage import escribir_json, leer_json, ruta_proyecto

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
    try:
        p = ruta_proyecto(name)
    except ValueError as err:
        raise HTTPException(422, str(err))
    if not p.is_dir():
        raise HTTPException(404, f"proyecto {name} no existe")
    return p


def _nube() -> bool:
    from server.editor import _nube as n
    return n()


def descargables_nube(name: str) -> dict[str, tuple[str, int]]:
    """Lo mismo que `descargables`, contra S3: clave estable → (key, bytes).

    En el servicio el proyecto NO está en el disco de la Lambda, así que la
    versión de abajo devolvía 404 «proyecto no existe» y el modal de Publicar
    no enseñaba nada: la película estaba hecha y no había forma de bajarla.
    Es la mitad grande de lo que los testers llamaron «no hay botón de
    descargar» (M22 · D).

    Las claves espejan las locales, incluido que `output/` NO se recorre hacia
    dentro: los shorts tienen su propia página y su propio botón.
    """
    from pipeline import media_sync
    pre = f"videos/{name}/"
    out: dict[str, tuple[str, int]] = {}
    for key, tam in media_sync.listar_prefijo_con_bytes(pre):
        rel = key[len(pre):]
        if rel == "pelicula.mp4":
            out["pelicula"] = (key, tam)
        elif rel == "pelicula-subtitulado.mp4":
            out["subtitulado"] = (key, tam)
        elif rel.startswith("output/") and rel.endswith(".mp4") and rel.count("/") == 1:
            out[rel[len("output/"):-len(".mp4")]] = (key, tam)
        elif rel == "work/subs/subs.srt":
            out["srt"] = (key, tam)
    return out


def descargables(p: Path) -> dict[str, Path]:
    """Qué se puede descargar/publicar de un proyecto, por clave estable."""
    out: dict[str, Path] = {}
    if (p / "pelicula.mp4").is_file():
        out["pelicula"] = p / "pelicula.mp4"
    if (p / "pelicula-subtitulado.mp4").is_file():   # make_subs escribe junto al base
        out["subtitulado"] = p / "pelicula-subtitulado.mp4"
    for f in sorted((p / "output").glob("*.mp4")) if (p / "output").is_dir() else []:
        out[f.stem] = f
    if (p / "work" / "subs" / "subs.srt").is_file():
        out["srt"] = p / "work" / "subs" / "subs.srt"
    return out


@router.get("/{name}/api/publicar/estado")
def estado(name: str):
    if _nube():
        from server.editor import _proyecto_nube
        _proyecto_nube(name)        # valida que el proyecto sea de este usuario
        archivos = [{"clave": k, "nombre": key.rsplit("/", 1)[-1],
                     "mb": round(tam / 1e6, 1)}
                    for k, (key, tam) in descargables_nube(name).items()]
    else:
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
    if _nube():
        from fastapi.responses import RedirectResponse

        from server.editor import _proyecto_nube
        from server.media_api import url_firmada_descarga
        _proyecto_nube(name)
        par = descargables_nube(name).get(clave)
        if not par:
            raise HTTPException(404, f"no hay descargable {clave!r}")
        key = par[0]
        return RedirectResponse(
            url_firmada_descarga(key, f"{name}-{key.rsplit('/', 1)[-1]}"))
    p = _proyecto(name)
    f = descargables(p).get(clave)
    if not f:
        raise HTTPException(404, f"no hay descargable {clave!r}")
    return FileResponse(f, filename=f"{name}-{f.name}",
                        media_type="video/mp4" if f.suffix == ".mp4" else "text/plain")


def _solo_local(que: str) -> None:
    """Estas dos mitades de b3 leen el disco del proyecto, que en el servicio no
    existe: daban «proyecto no existe», un 404 que no explica nada. Antes ni se
    llegaba a verlas porque el modal entero moría al pedir su estado; ahora que
    la descarga funciona (M22 · D), el aviso tiene que decir la verdad."""
    if _nube():
        raise HTTPException(503, f"{que} todavía no está disponible en el "
                                 "servicio — por ahora descarga el video y "
                                 "súbelo desde tu cuenta")


@router.post("/{name}/api/publicar/titulos")
async def titulos(name: str, body: TitulosIn):
    """3 títulos sugeridos desde el transcript (gpt-5-mini, ~$0.001)."""
    _solo_local("Sugerir títulos")
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
    _solo_local("Agendar en tus redes")
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
