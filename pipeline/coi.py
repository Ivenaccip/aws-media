"""COI (Contexto · Objetivo · Instrucciones) — la lógica PURA, sin red ni base.

Una persona escribe una vez, el modelo responde una vez con tres bloques. Este
módulo es todo lo que no necesita I/O: separar la respuesta en sus bloques,
adivinar el idioma, calcular lo que costó con la tarifa de `tools/pricing.json`
y leer la configuración. La orquestación (candado, moderación, modelo) vive en
`server/coi_api.py`; el SQL, en `pipeline/db.py` (`coi_*`).

Lo que NO hace, a propósito: guardar ni loguear el texto de la persona ni el de
la respuesta. Aquí no hay ningún `log` que reciba texto.
"""
from __future__ import annotations

import os
import re

# ---------------------------------------------------------------------------
# constantes del contrato (un solo lugar; la web lee `tope` del API, no de aquí)

TOPE_DIARIO = 3              # respuestas terminadas por persona y día (hora de México)
MAX_TEXTO = 2000             # caracteres de lo que escribe la persona
CADUCA_CANDADO_S = 60        # la «una en curso» caduca sola por si la Lambda muere
PLAZO_MODELO_S = 24          # la Lambda corta a 29 s y la puerta a 30 s
PLAZO_MODERACION_S = 8       # tope propio de la moderación (una llamada corta)
PRESUPUESTO_S = 27           # moderación + modelo caben aquí; lo que sobre le toca al modelo
MIN_MODELO_S = 4             # con menos que esto no vale la pena llamar al modelo
MAX_SALIDA_TOKENS = 4000     # un COI de siete partes cabe de sobra

RAZONAMIENTO_DEFECTO = "minimal"
SIN_RAZONAMIENTO = ("", "ninguno", "no", "off", "none")


def modelo() -> str:
    """`COI_MODELO`, o el modelo de siempre del producto."""
    from pipeline.config import settings
    return (os.getenv("COI_MODELO") or "").strip() or settings.openai_model


def razonamiento() -> str | None:
    """`COI_RAZONAMIENTO` (por defecto «minimal», lo más bajo que acepta el
    modelo). «ninguno» o vacío = no se manda el parámetro."""
    v = os.getenv("COI_RAZONAMIENTO")
    v = RAZONAMIENTO_DEFECTO if v is None else v.strip().lower()
    return None if v in SIN_RAZONAMIENTO else v


def instrucciones() -> str:
    """Las instrucciones del dueño (`prompts/coi_system.md`, o su versión en
    Langfuse con `LANGFUSE_PROMPTS=1`). Viven SOLO en el servidor: ninguna
    respuesta del API las devuelve."""
    from pipeline.config import load_prompt
    return str(load_prompt("coi_system"))


# ---------------------------------------------------------------------------
# separar la respuesta en sus tres bloques

_NOMBRE = {"contexto": "contexto", "context": "contexto",
           "objetivo": "objetivo", "objective": "objetivo",
           "instrucciones": "instrucciones", "instructions": "instrucciones"}
ORDEN = ("contexto", "objetivo", "instrucciones")

# «#CONTEXTO», «# Contexto», «**#CONTEXTO**», «#**CONTEXTO**», «## OBJECTIVE:»,
# «**#INSTRUCCIONES:**», «#CONTEXTO: Eres…» (lo que sigue a «:» es ya el cuerpo).
# Tras el nombre solo cabe cerrar negritas, «:» o el fin de la línea: «# Contexto
# histórico» NO es un encabezado.
_ENCABEZADO = re.compile(
    r"^\s*[*_]{0,3}\s*#{1,4}\s*[*_]{0,3}\s*(contexto|context|objetivo|objective|instrucciones|instructions)"
    r"\s*[*_]{0,3}\s*(?::\s*[*_]{0,3}\s*(?P<resto>.*))?$",
    re.IGNORECASE)
_REGLA = re.compile(r"^\s*([-*_])(\s*\1){2,}\s*$")      # ---, ***, ___
_CERCA = re.compile(r"^\s*```")


def _recortar_lineas(lineas: list[str]) -> str:
    """Quita líneas vacías y reglas horizontales de los extremos, y la cerca de
    código que cierra una cerca que nadie abrió dentro del bloque."""
    lineas = list(lineas)
    while lineas and (not lineas[-1].strip() or _REGLA.match(lineas[-1])):
        lineas.pop()
    while lineas and (not lineas[0].strip() or _REGLA.match(lineas[0])):
        lineas.pop(0)
    if lineas and _CERCA.match(lineas[-1]) and sum(bool(_CERCA.match(x)) for x in lineas) % 2 == 1:
        lineas.pop()
        while lineas and not lineas[-1].strip():
            lineas.pop()
    return "\n".join(lineas).strip()


def separar_bloques(texto: str) -> dict:
    """Lo que el API devuelve en `coi`: {contexto, objetivo, instrucciones,
    completo, estructura_ok}. Cada bloque va SIN su encabezado. `completo` es lo
    que respondió el modelo, entero y sin tocar. Si faltan encabezados, vienen
    desordenados o algún bloque queda vacío: `estructura_ok=False` y los tres
    bloques en `None` (la web muestra `completo` en una sola tarjeta)."""
    completo = texto if isinstance(texto, str) else ""
    malo = {"contexto": None, "objetivo": None, "instrucciones": None,
            "completo": completo, "estructura_ok": False}
    lineas = completo.replace("\r\n", "\n").replace("\r", "\n").split("\n")

    # la respuesta entera envuelta en una cerca de código: se desenvuelve
    vivas = [i for i, x in enumerate(lineas) if x.strip()]
    if len(vivas) >= 2 and _CERCA.match(lineas[vivas[0]]) and lineas[vivas[-1]].strip() == "```":
        del lineas[vivas[-1]]
        del lineas[vivas[0]]

    # primera aparición de cada encabezado, EN ORDEN (los repetidos después son cuerpo)
    marcas: list[tuple[str, int, str]] = []   # (bloque, línea, resto de la línea del encabezado)
    quiero = 0
    for i, linea in enumerate(lineas):
        if quiero >= len(ORDEN):
            break
        m = _ENCABEZADO.match(linea)
        if m and _NOMBRE[m.group(1).lower()] == ORDEN[quiero]:
            marcas.append((ORDEN[quiero], i, (m.group("resto") or "").strip()))
            quiero += 1
    if quiero < len(ORDEN):
        return malo

    cuerpos: dict[str, str] = {}
    for k, (nombre, i, resto) in enumerate(marcas):
        fin = marcas[k + 1][1] if k + 1 < len(marcas) else len(lineas)
        cuerpo = _recortar_lineas(([resto] if resto else []) + lineas[i + 1:fin])
        if not cuerpo:
            return malo
        cuerpos[nombre] = cuerpo
    return {**cuerpos, "completo": completo, "estructura_ok": True}


# ---------------------------------------------------------------------------
# idioma (heurística barata y solo informativa)

_PALABRAS_ES = frozenset("""
el la los las un una unos unas del al de que y en con para por como mi mis tu tus su sus
quiero necesito quisiera hacer crear sobre es son lo se más muy pero si este esta estos estas
qué cómo puedes puede ayuda dame escribe genera redacta haz hay también donde cuando
tengo tiene hacia desde entre sin cada todo todos nuestro nuestra mis tengo
""".split())
_PALABRAS_EN = frozenset("""
the and to of an is are for with on in my your i want need write create make about that this
it you please how what can be at from by or do have help give should would could will
""".split())
_ACENTOS = frozenset("áéíóúñ¿¡ü")
_PALABRA = re.compile(r"[a-záéíóúüñ]+")


def idioma(texto: str) -> str:
    """«es» si el texto parece español, si no «en». Cuenta palabras funcionales
    de cada idioma y da peso a los signos propios del español (ñ, acentos, ¿, ¡).
    Sin ninguna señal (o empate) se queda en «es»: es el idioma de quien usa el
    producto. Solo informa; el modelo decide el idioma de su respuesta con sus
    instrucciones."""
    bajo = (texto or "").lower()
    es = sum(1 for p in _PALABRA.findall(bajo) if p in _PALABRAS_ES)
    en = sum(1 for p in _PALABRA.findall(bajo) if p in _PALABRAS_EN)
    es += 2 * sum(1 for c in bajo if c in _ACENTOS)
    return "en" if en > es else "es"


# ---------------------------------------------------------------------------
# costo (dólares) con la tarifa de tools/pricing.json — nunca un número inventado

def _numero(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def costo_usd(uso: dict | None) -> float | None:
    """Dólares de una respuesta a partir de `uso` ({modelo, entrada, salida,
    cache_leida}), con la fila del modelo en `pricing.json` §rag.modelos
    (dólares por millón de tokens). Los tokens en caché se cobran con su precio y
    no con el de entrada. Devuelve None si falta la fila, un precio o un conteo:
    jamás se inventa el costo de un modelo que no está en la tarifa."""
    from pipeline import costos_rag
    uso = uso or {}
    p = costos_rag.precios().get(uso.get("modelo"))
    entrada, salida = uso.get("entrada"), uso.get("salida")
    if not p or not _numero(p.get("entrada")) or not _numero(p.get("salida")):
        return None
    if not isinstance(entrada, int) or not isinstance(salida, int):
        return None
    en_cache = uso.get("cache_leida") or 0
    if en_cache and not _numero(p.get("cache_leida")):
        return None
    en_cache = min(int(en_cache), entrada)
    total = ((entrada - en_cache) * p["entrada"] + en_cache * (p.get("cache_leida") or 0)
             + salida * p["salida"]) / 1_000_000
    return round(total, 6)


def motivo_corto(motivo: str | None, limite: int = 240) -> str:
    """El motivo de la moderación en una línea y con tope: viene de un modelo,
    así que no se confía en su largo."""
    t = " ".join(str(motivo or "").split())
    return t if len(t) <= limite else t[:limite].rstrip() + "…"
