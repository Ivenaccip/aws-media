"""Guionista: historia o dossier → guion narrado en español, por escenas, con presupuesto de duración."""
from __future__ import annotations

from langfuse import get_client, observe

from .config import load_prompt
from .llm import chat_json
from .project import EscenaGuion

# A3: palabras por segundo DE PELÍCULA (no de habla). Medido en gen-tesla
# (2026-08-27): la voz lee 1.98 pal/s, pero los slots de video (4/6/8 s)
# rellenan ~20% sobre el audio → 1.63 pal/s relativo a la película final.
# 1.7 = ese valor + margen (escenas más cortas rellenan menos). El gate
# post-TTS (pipeline/duracion.py) es quien garantiza el objetivo.
PALABRAS_POR_S = 1.7
S_POR_ESCENA_MIN = 5.0
S_POR_ESCENA_MAX = 8.0
MAX_PALABRAS_ESCENA = 16

# M11 — narración primero: la película dura EXACTAMENTE lo que dura la voz
# (pista única), así que el presupuesto usa la tasa de habla pura medida en
# gen-tesla (1.98 pal/s) sin el relleno de los slots de video.
PALABRAS_POR_S_HABLA = 1.9


# Balanceador de formato (2026-09-07): el clasificador elige el molde y estas
# reglas entran al system del guionista/narrador vía {formato_reglas}. Antes
# TODO brief salía como cuento con protagonista inventado — «3 curiosidades de
# los flamencos» terminaba siendo la historia de un polluelo.
FORMATO_REGLAS = {
    "cuento": (
        "- Un único protagonista claro que conduce la historia. Si el material es "
        "histórico o documental, elige un protagonista concreto (una persona, un "
        "objeto, una criatura) y cuenta los hechos a través de él, sin inventar datos.\n"
        "- Arco completo: apertura → desarrollo → giro o clímax → cierre. Cierra con "
        "una imagen, no con una moraleja explícita."),
    "lista": (
        "- El video es una LISTA: el usuario pidió una enumeración — entrega EXACTAMENTE "
        "los puntos pedidos (si pidió 3 curiosidades, son 3), en orden de impacto creciente.\n"
        "- La narración anuncia cada punto con naturalidad («Primera curiosidad:», «La "
        "segunda te va a sorprender:») para que el espectador siempre sepa dónde va.\n"
        "- NO inventes un protagonista de ficción: el sujeto real del tema (el animal, el "
        "lugar, el objeto) es el centro visual de todos los puntos.\n"
        "- Abre con el gancho y cierra rematando el mejor punto — sin moraleja."),
    "explicador": (
        "- Explica el concepto como cadena causal (qué pasa → por qué → qué provoca), del "
        "misterio a la revelación.\n"
        "- NO inventes un protagonista de ficción: el fenómeno u objeto real es el hilo "
        "visual; puedes seguir un ejemplar/caso concreto para aterrizarlo, sin inventar datos.\n"
        "- Cierra con la imagen que resume la explicación, no con una moraleja."),
}


def presupuesto(duracion_s: int) -> dict:
    return {
        "duracion_s": duracion_s,
        "palabras_max": int(duracion_s * PALABRAS_POR_S),
        "escenas_min": max(2, round(duracion_s / S_POR_ESCENA_MAX)),
        "escenas_max": max(3, round(duracion_s / S_POR_ESCENA_MIN)),
    }


def normalizar_guion(r: dict, duracion_s: int) -> list[EscenaGuion]:
    escenas = r.get("escenas")
    if not isinstance(escenas, list) or not escenas:
        raise ValueError("El guionista no devolvió escenas")
    out: list[EscenaGuion] = []
    for e in escenas:
        txt = str((e.get("narracion") if isinstance(e, dict) else e) or "").strip()
        if txt:
            out.append(EscenaGuion(id=str(len(out) + 1), narracion=txt))
    if not out:
        raise ValueError("El guionista devolvió escenas vacías")
    return out


def estimar_segundos(escenas: list[EscenaGuion]) -> float:
    return round(sum(len(e.narracion.split()) for e in escenas) / PALABRAS_POR_S, 1)


@observe(name="narrador")
async def escribir_narracion(material: str, tipo: str, estilo: str, duracion_s: int,
                             personaje: str | None, formato: str = "cuento") -> str:
    """M11: UNA narración corrida (gancho inicial + cadena causal), sin la
    camisa de fuerza de 8-16 palabras por escena. El texto ES la película:
    la imagen se corta sobre la voz después."""
    palabras_max = int(duracion_s * PALABRAS_POR_S_HABLA)
    user = load_prompt("narrador_user").format(
        material=material, tipo=tipo, estilo=estilo,
        personaje=f"PROTAGONISTA (ya diseñado, úsalo como tal): {personaje}" if personaje else "",
        duracion_s=duracion_s, palabras_max=palabras_max,
    )
    r = await chat_json("narrador", load_prompt("narrador_system").format(
        duracion_s=duracion_s, palabras_max=palabras_max,
        formato_reglas=FORMATO_REGLAS.get(formato, FORMATO_REGLAS["cuento"])), user)
    texto = " ".join(str(r.get("narracion") or "").split())
    if len(texto.split()) < 10:
        raise ValueError("El narrador no devolvió una narración utilizable")
    get_client().update_current_span(output={
        "titulo": r.get("titulo"), "palabras": len(texto.split()),
        "segundos_estimados": round(len(texto.split()) / PALABRAS_POR_S_HABLA, 1),
    })
    return texto


@observe(name="guionista")
async def escribir_guion(material: str, tipo: str, estilo: str, duracion_s: int,
                         personaje: str | None, formato: str = "cuento") -> list[EscenaGuion]:
    pres = presupuesto(duracion_s)
    pres["formato_reglas"] = FORMATO_REGLAS.get(formato, FORMATO_REGLAS["cuento"])
    user = load_prompt("guionista_user").format(
        material=material, tipo=tipo, estilo=estilo,
        personaje=f"PROTAGONISTA (ya diseñado, úsalo como tal): {personaje}" if personaje else "",
        **pres,
    )
    r = await chat_json("guionista", load_prompt("guionista_system").format(**pres), user)
    guion = normalizar_guion(r, duracion_s)
    get_client().update_current_span(output={
        "titulo": r.get("titulo"), "escenas": len(guion), "segundos_estimados": estimar_segundos(guion),
    })
    return guion
