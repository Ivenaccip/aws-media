"""M14 — Editar en la web: la corrida de sugerencias de corte con botones.

El flujo local de /clean-cut, en el servicio: el usuario sube su metraje (C3),
pide la corrida (transcripción si falta + LLM que propone el corte + proxy del
editor, todo en Fargate — worker/editar_task.py) y audita las sugerencias en el
editor visual de siempre (/editor/{nombre}/): acepta, rechaza, renderiza.

Reglas duras que se respetan: preview de costo ANTES de cobrar (créditos de
tarifas.json §editar), cobrar antes de lanzar, devolver en fallo nuestro.
Solo nube: en dev local el camino sigue siendo /clean-cut desde Claude Code.
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException

from pipeline import creditos, db, jobs
from server.shorts_api import (_con_transcript, _duracion_s, _fuente, _proyecto,
                              fuera_de_rango, gate_duracion)

router = APIRouter(prefix="/api/editar")

# Los límites son los de shorts (mismo worker, mismo vendor de transcripción):
# viven en shorts_api para que no puedan separarse por descuido. Lo propio de
# aquí es POR QUÉ un metraje corto no sirve — no hay relleno que quitar.
CORTO_EDITAR = "un video tan corto no tiene relleno que recortar"


def _nube() -> None:
    if db.backend() != "postgres":
        raise HTTPException(503, "El flujo web de edición corre en el servicio — "
                                 "en local usa /clean-cut desde Claude Code")


def _caducado(estado: dict, horas: float) -> bool:
    try:
        inicio = datetime.fromisoformat(estado["inicio"])
    except (KeyError, TypeError, ValueError):
        return True
    return datetime.now(timezone.utc) - inicio > timedelta(hours=horas)


def _ahora() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


@router.get("/{nombre}")
def estado(nombre: str):
    """Poll barato de la UI: solo lo que ya está en Postgres."""
    _nube()
    doc = _proyecto(nombre)
    return {"editar": doc.get("editar"), "fuente": _fuente(doc, nombre),
            "editor_listo": bool(doc.get("flags", {}).get("cuts"))}


@router.get("/{nombre}/costo")
def costo(nombre: str):
    """Preview de costo ANTES del botón (regla dura: nube sin preview = bug)."""
    _nube()
    doc = _proyecto(nombre)
    key = _fuente(doc, nombre)
    if key is None:
        raise HTTPException(404, "Este proyecto no tiene metraje: sube un video primero")
    dur = _duracion_s(key)
    con_tx = _con_transcript(nombre)
    falta_key = not con_tx and not os.getenv("ASSEMBLYAI_API_KEY")
    fuera = fuera_de_rango(dur, CORTO_EDITAR)
    return {
        "fuente": key, "duracion_s": round(dur, 1), "con_transcript": con_tx,
        "creditos": creditos.costo_editar_sugerencias(dur, con_tx),
        "backend_listo": not falta_key and fuera is None,
        "aviso": fuera or (None if not falta_key else
            "Falta configurar la transcripción en nube (ASSEMBLYAI_API_KEY) — "
            "este metraje no trae transcript propio"),
    }


@router.post("/{nombre}/sugerir")
def sugerir(nombre: str):
    _nube()
    user = db.usuario_actual()
    doc = _proyecto(nombre)
    st = doc.get("editar") or {}
    if st.get("estado") == "corriendo" and not _caducado(st, 2):
        raise HTTPException(409, "La corrida ya está en curso — espera a que termine")
    key = _fuente(doc, nombre)
    if key is None:
        raise HTTPException(404, "Este proyecto no tiene metraje: sube un video primero")
    dur = _duracion_s(key)
    gate_duracion(dur, CORTO_EDITAR)
    con_tx = _con_transcript(nombre)
    if not con_tx and not os.getenv("ASSEMBLYAI_API_KEY"):
        raise HTTPException(503, "Transcripción en nube no configurada (ASSEMBLYAI_API_KEY)")
    n = creditos.costo_editar_sugerencias(dur, con_tx)
    if creditos.activo():
        try:
            creditos.cobrar(n, f"editar-sugerir:{nombre}", user)
        except creditos.SinSaldo as e:
            raise HTTPException(402, str(e))
    nuevo = {"estado": "corriendo", "fuente": key, "duracion_s": round(dur, 1),
             "creditos": n, "inicio": _ahora()}
    db.fijar_campo_editor(user, nombre, "editar", json.dumps(nuevo, ensure_ascii=False))
    try:
        jobs.lanzar_editar(user, nombre)
    except Exception as err:  # noqa: BLE001 — cobrado y sin job = lo peor: revertir
        if creditos.activo():
            creditos.devolver(n, f"editar-sugerir:{nombre}", user)
        nuevo.update(estado="error", error=f"no se pudo lanzar: {err}"[:300])
        db.fijar_campo_editor(user, nombre, "editar", json.dumps(nuevo, ensure_ascii=False))
        raise HTTPException(502, f"No se pudo lanzar la corrida: {str(err)[:200]}")
    return {"lanzado": True, "creditos": n}
