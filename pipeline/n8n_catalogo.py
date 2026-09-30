"""RAG·18 — qué nodos de n8n existen y cuáles puede usar /automatiza.

Dos archivos de datos, los dos comiteados y leídos como diccionario (el mismo
molde de los catálogos de SFX y música):

- `media/library/n8n/catalog.json` — lo que EXISTE en la versión de n8n de su
  cabecera. Lo genera `tools/n8n_catalogo.py`; no se edita a mano.
- `media/library/n8n/permitidos.json` — lo que el generador puede USAR. Se
  escribe a mano: crecer hacia el 80% de los casos es agregar nodos aquí (y su
  documentación al índice vectorial, RAG·19; y su guía, RAG·33).

Por eso hay dos «no» distintos, y el visitante ve el correcto:
    no_existe      el modelo inventó el nodo (o la versión de n8n no lo tiene)
    oculto         existe, pero n8n ya no lo ofrece (obsoleto o interno)
    no_soportado   el nodo es real, pero todavía no lo soportamos

`revisar()` es lo que usa el validador de RAG·22. No toca red ni AWS.
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import NamedTuple

RAIZ = Path(__file__).resolve().parent.parent
CARPETA = RAIZ / "media" / "library" / "n8n"
RUTA_CATALOGO = CARPETA / "catalog.json"
RUTA_PERMITIDOS = CARPETA / "permitidos.json"

SUFIJO_HERRAMIENTA = "Tool"


class Veredicto(NamedTuple):
    codigo: str          # ok · no_existe · oculto · no_soportado · version_invalida
    mensaje: str

    @property
    def ok(self) -> bool:
        return self.codigo == "ok"


@lru_cache(maxsize=1)
def catalogo() -> dict:
    return json.loads(RUTA_CATALOGO.read_text(encoding="utf-8"))


@lru_cache(maxsize=1)
def _permitidos_json() -> dict:
    return json.loads(RUTA_PERMITIDOS.read_text(encoding="utf-8"))


def permitidos() -> dict[str, dict]:
    """{tipo: entrada de permitidos.json}."""
    return {n["tipo"]: n for n in _permitidos_json()["nodos"]}


def etapa() -> str:
    """«prototipo» mientras sean los niveles 1 y 2; cambia al crecer."""
    return _permitidos_json().get("etapa", "?")


def llm() -> dict:
    """El proveedor y modelo que se sugiere cuando el visitante no pide otro."""
    return _permitidos_json()["llm"]


def base(tipo: str) -> tuple[str | None, bool]:
    """(tipo en el catálogo, ¿es su variante de herramienta?). n8n crea
    `<tipo>Tool` al vuelo para los nodos `como_herramienta`: no vienen en el
    catálogo como nodo propio."""
    nodos = catalogo()["nodos"]
    if tipo in nodos:
        return tipo, False
    if tipo.endswith(SUFIJO_HERRAMIENTA):
        raiz = tipo[: -len(SUFIJO_HERRAMIENTA)]
        if nodos.get(raiz, {}).get("como_herramienta"):
            return raiz, True
    return None, False


def revisar(tipo: str, version: float | int | None = None) -> Veredicto:
    """¿Puede ir este nodo (con esta `typeVersion`) en un flujo de /automatiza?
    Una variante de herramienta está permitida si su nodo base lo está."""
    cat = catalogo()
    raiz, _ = base(tipo)
    if raiz is None:
        return Veredicto("no_existe",
                         f"El nodo {tipo} no existe en n8n {cat['procedencia']['n8n']}.")
    nodo = cat["nodos"][raiz]
    if nodo["oculto"]:
        return Veredicto("oculto", f"El nodo {nodo['nombre']} ya no se ofrece en n8n "
                                   "(obsoleto o interno).")
    if raiz not in permitidos():
        return Veredicto("no_soportado", f"Este nodo aún no lo soportamos: {nodo['nombre']}.")
    if version is not None and version not in nodo["versiones"]:
        return Veredicto("version_invalida",
                         f"{nodo['nombre']} no tiene la versión {version} "
                         f"(válidas: {', '.join(map(str, nodo['versiones']))}).")
    return Veredicto("ok", "")


def revisar_permitidos() -> list[str]:
    """Lo que está mal en permitidos.json contra el catálogo de hoy. Vacío =
    todo bien. Lo corre `tools/n8n_catalogo.py` tras cada regeneración: un
    nodo permitido que n8n renombra o retira aparece aquí, no en producción."""
    nodos = catalogo()["nodos"]
    problemas, vistos = [], set()
    for n in _permitidos_json()["nodos"]:
        t = n["tipo"]
        if t in vistos:
            problemas.append(f"{t} está repetido")
        vistos.add(t)
        if t not in nodos:
            problemas.append(f"{t} no existe en el catálogo")
        elif nodos[t]["oculto"]:
            problemas.append(f"{t} ya no se ofrece en n8n (oculto)")
    nodo_llm = llm()["nodo"]
    if nodo_llm not in vistos:
        problemas.append(f"el nodo del modelo sugerido ({nodo_llm}) no está permitido")
    return problemas
