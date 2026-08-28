"""Transiciones del proyecto que disparan trabajo (se rellenan en las fases 2-4)."""
from __future__ import annotations

import asyncio
import logging
import os
import sys
from pathlib import Path

from langfuse import get_client, observe, propagate_attributes

from . import character, editor, ffmpeg, research, voices, writer
from .casting import hacer_casting
from .director import dirigir
from .models import Biblioteca, Casting, Entidad
from .project import Proyecto
from .run import producir_desde_escenas
from .styles import resolver_estilo

log = logging.getLogger("flow")


async def preparar(p: Proyecto) -> None:
    """Fase 2-3: clasificar brief -> research -> guion; personaje -> 2 opciones. Termina en `revision`."""
    p.estado, p.etapa = "preparando", "inicio"
    p.guardar()
    try:
        with propagate_attributes(session_id=p.id, tags=["video-pipeline", "preparar"], trace_name="preparar"):
            await _preparar(p)
        p.estado, p.etapa = "revision", None
    except Exception as err:  # noqa: BLE001
        log.exception("preparar %s falló", p.id)
        p.estado, p.error = "error", f"{type(err).__name__}: {str(err)[:400]}"
    finally:
        p.guardar()
        get_client().flush()


def _etapa(p: Proyecto, etapa: str) -> None:
    p.etapa = etapa
    p.guardar()
    log.info("%s → %s", p.id, etapa)


@observe(name="preparar", capture_output=False)
async def _preparar(p: Proyecto) -> None:
    estilo = resolver_estilo(p.estilo, p.estilo_custom)
    get_client().update_current_span(input={"brief": p.brief, "estilo": estilo.id, "duracion_s": p.duracion_s})

    _etapa(p, "clasificar")
    desc = None
    # F3.3: el modo explícito de la UI manda; "auto" conserva el clasificador
    forzado = {"investigacion": "idea", "idea": "historia"}.get(p.modo)
    tipo, desc = await asyncio.gather(
        asyncio.sleep(0, result=forzado) if forzado else research.clasificar(p.brief),
        character.describir_referencia(Path(p.referencias[0].path)) if p.referencias else asyncio.sleep(0),
    )
    p.tipo_brief = tipo
    if desc:
        p.personaje.nombre, p.personaje.descripcion = desc.nombre, desc.descripcion

    async def guion() -> None:
        material = p.brief
        if tipo == "idea":
            _etapa(p, "research")
            d = await research.investigar(p.brief)
            p.dossier, p.fuentes, material = d.texto, d.fuentes, d.texto
        _etapa(p, "guion")
        p.guion = await writer.escribir_guion(
            material, tipo, estilo.nombre, p.duracion_s,
            f"{desc.nombre} — {desc.descripcion}" if desc else None,
        )
        p.guion_original = list(p.guion)
        _etapa(p, "editor")
        p.guion = await editor.editar_continuidad(p.guion, p.duracion_s)
        _etapa(p, "voz")
        rank = await voices.recomendar_voces(p.texto_guion(), estilo.nombre)
        p.voces = [v.model_dump() for v in rank]
        p.voz = p.voz or rank[0].id

    async def personaje() -> None:
        if desc:
            per = await character.preparar_personaje(p, estilo, desc)
            p.personaje = per
            p.guardar()

    await asyncio.gather(guion(), personaje())
    _etapa(p, "personaje")
    get_client().update_current_span(output={
        "tipo": tipo, "escenas": len(p.guion), "fuentes": len(p.fuentes), "opciones": len(p.personaje.opciones),
    })


async def producir(p: Proyecto) -> None:
    """Fase 4: guion aprobado + personaje elegido -> película."""
    p.estado, p.etapa = "produciendo", "inicio"
    p.guardar()
    try:
        with propagate_attributes(session_id=p.id, tags=["video-pipeline", "producir"], trace_name="pelicula"):
            await _producir(p)
        _etapa(p, "puente")
        await _puente_editor(p)
        p.estado, p.etapa = "listo", None
    except Exception as err:  # noqa: BLE001
        log.exception("producir %s falló", p.id)
        p.estado, p.error = "error", f"{type(err).__name__}: {str(err)[:400]}"
    finally:
        p.guardar()
        get_client().flush()


async def _puente_editor(p: Proyecto) -> None:
    """F1.3: al terminar la producción, la película se vuelve proyecto editable
    (videos/gen-<id>) vía el normalizador generated_to_canonical. NO fatal: si el
    puente falla, la película ya está lista y el error queda en progreso."""
    raiz = Path(__file__).resolve().parent.parent
    script = raiz / "tools" / "normalizers" / "generated_to_canonical.py"
    if not script.is_file() or os.getenv("PUENTE_EDITOR", "1") in ("0", "false", "no"):
        return
    nombre = f"gen-{p.id[:8]}"
    try:
        proc = await asyncio.create_subprocess_exec(
            sys.executable, str(script), str(p.workdir), nombre,
            "--model", os.getenv("PUENTE_MODEL", "small"),
            cwd=str(raiz), stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
        out, _ = await proc.communicate()
        if proc.returncode == 0:
            p.progreso["editor"] = nombre
            log.info("%s: puente al editor listo → videos/%s", p.id, nombre)
        else:
            p.progreso["editor_error"] = out.decode(errors="replace")[-400:]
            log.warning("%s: puente al editor falló:\n%s", p.id, out.decode(errors="replace")[-1000:])
    except Exception as err:  # noqa: BLE001
        p.progreso["editor_error"] = f"{type(err).__name__}: {str(err)[:200]}"
        log.warning("%s: puente al editor no disponible: %s", p.id, err)


def guion_numerado(p: Proyecto) -> str:
    return "\n".join(f"{e.id}. {e.narracion}" for e in p.guion)


def casting_con_personaje(ctx: Casting, p: Proyecto) -> Casting:
    """El protagonista SIEMPRE es el personaje elegido en la UI, lo haya reconocido o no el casting."""
    per = p.personaje
    prota = Entidad(nombre=per.nombre, tipo="personaje", importancia="principal", existe=True, inline=False,
                    descriptor=per.descripcion, url=per.url_elegida)
    if ctx.protagonista == per.nombre and not ctx.faltantes:
        return ctx
    # El LLM nombró distinto al protagonista (o lo marcó faltante): sustituimos esa entidad por la nuestra
    otros = [c for c in ctx.casting if c.nombre not in (ctx.protagonista, per.nombre)]
    log.warning("%s: casting devolvió protagonista %r/faltantes=%s → forzado a %r", p.id, ctx.protagonista, ctx.faltantes, per.nombre)
    return Casting(protagonista=per.nombre, casting=[prota, *otros], faltantes=[], motivos=[], mundo=ctx.mundo)


@observe(name="pelicula", capture_output=False)
async def _producir(p: Proyecto) -> None:
    ffmpeg.comprobar_ffmpeg()
    estilo = resolver_estilo(p.estilo, p.estilo_custom)
    historia = guion_numerado(p)
    get_client().update_current_span(input={"guion": historia, "estilo": estilo.id, "personaje": p.personaje.nombre})

    def progreso(etapa: str, datos: dict) -> None:
        if datos.get("escena_lista"):
            p.progreso["escenas_listas"] = p.progreso.get("escenas_listas", 0) + 1
        else:
            p.progreso.update(datos)
        _etapa(p, etapa)

    _etapa(p, "casting")
    bib = Biblioteca(entidades=[{"nombre": p.personaje.nombre, "tipo": "personaje",
                                 "descriptor": p.personaje.descripcion, "url": p.personaje.url_elegida}], estilo_url=None)
    ctx = casting_con_personaje(await hacer_casting(historia, bib), p)

    _etapa(p, "director")
    escenas = [e.model_copy(update={"voz": p.voz}) for e in await dirigir(historia, ctx)]
    if len(escenas) != len(p.guion):
        log.warning("%s: el director devolvió %d escenas para %d del guion", p.id, len(escenas), len(p.guion))

    r = await producir_desde_escenas(escenas, ctx, p.personaje.url_elegida, p.workdir, subir=True,
                                     estilo=estilo, progreso=progreso, duracion_objetivo_s=p.duracion_s)
    p.resultado = {
        "mensaje": r.mensaje, "link": r.link, "drive_id": r.drive_id, "duracion": r.duracion_pelicula,
        "escenas": [{"id": e.id, "qc": e.qc, "video_origen": e.video_origen, "duracion": e.duracion_final} for e in r.escenas],
    }
    get_client().update_current_span(output={"duracion": r.duracion_pelicula, "link": r.link})
