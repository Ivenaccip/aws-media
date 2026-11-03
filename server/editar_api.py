"""M14 — Editar en la web: la corrida de sugerencias de corte con botones.

El flujo local de /clean-cut, en el servicio: el usuario sube su metraje (C3),
pide la corrida (transcripción si falta + LLM que propone el corte + proxy del
editor, todo en Fargate — worker/editar_task.py) y audita las sugerencias en el
editor visual de siempre (/editor/{nombre}/): acepta, rechaza, renderiza.

E1: POST /{nombre}/sugerir acepta un cuerpo OPCIONAL `{"instruccion": str}`
(la caja «Edición» del inicio); se valida antes de cobrar y se guarda en
doc.editar.instruccion para que el worker se la pase al LLM.

Reglas duras que se respetan: preview de costo ANTES de cobrar (créditos de
tarifas.json §editar), cobrar antes de lanzar, devolver en fallo nuestro.
Solo nube: en dev local el camino sigue siendo /clean-cut desde Claude Code.
"""
from __future__ import annotations

import json
import os
import re
import unicodedata
from datetime import datetime, timedelta, timezone
from typing import Annotated, Any

from fastapi import APIRouter, Body, HTTPException

from pipeline import creditos, db, jobs
from server.shorts_api import (_con_transcript, _duracion_s, _fuente, _proyecto,
                              fuera_de_rango, gate_duracion)

router = APIRouter(prefix="/api/editar")

# Los límites son los de shorts (mismo worker, mismo vendor de transcripción):
# viven en shorts_api para que no puedan separarse por descuido. Lo propio de
# aquí es POR QUÉ un metraje corto no sirve — no hay relleno que quitar.
CORTO_EDITAR = "un video tan corto no tiene relleno que recortar"

# E1 — lo que la persona le cuenta a la IA («quítale las muletillas…»). Es
# entrada NO confiable: acaba dentro de un mensaje del LLM, así que se limpia y
# se acota aquí, ANTES de cobrar, y el worker la vuelve a acotar (defensa en
# profundidad: el doc de Postgres también se puede tocar). El mismo tope que
# los textos libres de clip (pipeline/clip.py MAX_TEXTO).
MAX_INSTRUCCION = 2000
# Tope de lo que se acepta SIN limpiar, para no recorrer carácter por carácter un
# cuerpo de megas: un texto honesto no trae tres de cada cuatro caracteres
# invisibles o de control, así que pasado este largo se rechaza de una vez (422).
_MAX_INSTRUCCION_CRUDA = MAX_INSTRUCCION * 4


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


def limpiar_instruccion(texto: str) -> str:
    """El texto sin caracteres de control y sin espacios en los extremos.

    Salen los de control (Cc), los de formato invisibles (Cf: ancho cero,
    marcas bidi, las «etiquetas» U+E00xx con que se esconde texto) y los
    sustitutos sueltos (Cs: `"\\ud800"` es JSON válido pero revienta al
    guardarlo, y eso pasaría DESPUÉS de cobrar). Se conservan los saltos de
    línea, que en un textarea son legítimos; tabuladores y saltos de página se
    vuelven espacio y U+2028/U+2029 se vuelven salto de línea.
    """
    salida: list[str] = []
    for c in texto.replace("\r\n", "\n").replace("\r", "\n"):
        if c == "\n":
            salida.append(c)
        elif c in "\t\x0b\x0c":
            salida.append(" ")
        else:
            cat = unicodedata.category(c)
            if cat in ("Zl", "Zp"):
                salida.append("\n")
            elif cat not in ("Cc", "Cf", "Cs"):
                salida.append(c)
    return "".join(salida).strip()


def instruccion_de(cuerpo: Any) -> str:
    """La instrucción opcional del POST /sugerir ya validada, o '' si no hay.

    Sin cuerpo (static/e1.html y /estudio/subir/ llaman así) o con la
    instrucción vacía o en blanco → '' y la corrida es la de siempre. Un cuerpo
    que no es un objeto, una instrucción que no es texto o una de más de
    MAX_INSTRUCCION caracteres → 422, con el motivo como texto plano (la web
    muestra `detail` tal cual cuando es un string). Se llama ANTES de tocar el
    monedero: ningún 422 de aquí necesita devolver nada.
    """
    if cuerpo is None:
        return ""
    if not isinstance(cuerpo, dict):
        raise HTTPException(422, "El cuerpo debe ser un objeto JSON, "
                                 "por ejemplo {\"instruccion\": \"…\"}")
    valor = cuerpo.get("instruccion")
    if valor is None:
        return ""
    if not isinstance(valor, str):
        raise HTTPException(422, "La instrucción debe ser texto")
    if len(valor) > _MAX_INSTRUCCION_CRUDA:
        raise HTTPException(422, f"La instrucción es demasiado larga: "
                                 f"máximo {MAX_INSTRUCCION} caracteres")
    texto = limpiar_instruccion(valor)
    if len(texto) > MAX_INSTRUCCION:
        raise HTTPException(422, f"La instrucción es demasiado larga: máximo "
                                 f"{MAX_INSTRUCCION} caracteres (llevas {len(texto)})")
    return texto


# Lo que una copia de E2 guarda en `doc.editar` para el worker y la idempotencia, y que la web nunca lee:
# `fuentes` (las keys de S3 de los originales, sus `wav_key`/`canonico_key`) y `pedido` (la clave de
# idempotencia). Salen del sondeo de la caja (cada 5 s) y de la lista de «Mis creaciones».
_SOLO_DEL_SERVIDOR = ("fuentes", "pedido")

_INFRA = re.compile(r"arn:aws[A-Za-z-]*:[^\s,;'\")\]]*|\b\d{12}\b")


def tachar_infra(texto) -> str:
    """El texto sin ARN de AWS ni números de cuenta: un `ClientError` de boto3 suele traer el rol y la
    máquina de estados. No es un secreto, pero tampoco hay por qué enseñárselo a quien usa la caja."""
    return _INFRA.sub("[…]", str(texto))


def editar_publico(editar):
    """El `doc.editar` que sale al navegador. Una copia de E2 (`copia: true`) pierde lo que solo
    necesita el servidor (`fuentes`, `pedido`) y su `error` crudo —el `Tipo: texto` de la excepción del
    worker— sale sin ARN ni números de cuenta. El doc guardado no cambia: `reintentar` y el worker lo
    necesitan. Lo que no es una copia (E1) conserva el contrato de siempre."""
    if not isinstance(editar, dict) or editar.get("copia") is not True:
        return editar
    publico = {k: v for k, v in editar.items() if k not in _SOLO_DEL_SERVIDOR}
    if isinstance(publico.get("error"), str):
        publico["error"] = tachar_infra(publico["error"])
    return publico


@router.get("/{nombre}")
def estado(nombre: str):
    """Poll barato de la UI: solo lo que ya está en Postgres."""
    _nube()
    doc = _proyecto(nombre)
    return {"editar": editar_publico(doc.get("editar")), "fuente": _fuente(doc, nombre),
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
def sugerir(nombre: str, cuerpo: Annotated[Any, Body()] = None):
    """Cobra y lanza la corrida. El cuerpo es OPCIONAL: `{"instruccion": str}`
    le dice a la IA qué quiere la persona (E1, caja «Edición» del inicio); sin
    cuerpo todo es como antes. Los gates (instrucción, duración) van antes de
    cobrar; la referencia del cobro y de la devolución sigue siendo
    `editar-sugerir:<nombre>` (la exige el barredor)."""
    _nube()
    instruccion = instruccion_de(cuerpo)
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
    if instruccion:   # sin ella el doc queda idéntico al de antes de E1
        nuevo["instruccion"] = instruccion
    db.fijar_campo_editor(user, nombre, "editar", json.dumps(nuevo, ensure_ascii=False))
    try:
        jobs.lanzar_editar(user, nombre)
    except Exception as err:  # noqa: BLE001 — cobrado y sin job = lo peor: revertir
        if creditos.activo():
            creditos.devolver(n, f"editar-sugerir:{nombre}", user)
            # la bandeja ("Te devolvimos ✦ N") lo lee de aquí; sin monedero no se habla de créditos
            nuevo["devueltos"] = n
        nuevo.update(estado="error", error=f"no se pudo lanzar: {err}"[:300])
        db.fijar_campo_editor(user, nombre, "editar", json.dumps(nuevo, ensure_ascii=False))
        raise HTTPException(502, f"No se pudo lanzar la corrida: {str(err)[:200]}")
    return {"lanzado": True, "creditos": n}
