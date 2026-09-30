"""RAG·20 — el puente de idioma: qué texto se usa para buscar en la documentación.

El visitante escribe en español; la documentación de n8n y todos los nombres
de nodo están en inglés. Hay dos caminos y los dos quedan listos, porque la
decisión se toma MIDIENDO con el conjunto de prueba (RAG·26), no a ojo:

    directo    se busca con la petición tal cual. Con gemini-embedding-001,
               español→inglés no pierde contra inglés→inglés en MLQA (80.5 y
               76.0 contra 75.3), así que es el punto de partida. Cero llamadas.
    reescrita  un modelo reescribe la petición a inglés técnico con los
               nombres de nodo de permitidos.json (RAG·18) y se busca con eso.
               Lo que se espera ganar es VOCABULARIO («avísame cuando llegue un
               correo» → Gmail Trigger), no idioma. Una llamada al modelo.

Qué modelo reescribe es la casilla «Qué modelo razona» de RAG·0: todavía sin
decidir. Por eso el modelo entra como una función (`reescribir(system, user)
→ dict`) y este módulo no importa ningún SDK. Si el camino es «reescrita» pero
no hay modelo, o el modelo falla o contesta basura, se busca por el camino
directo y queda anotado: buscar peor es mejor que no entregar.

El camino se elige con RAG_CAMINO (directo por defecto).

RAG·20 también deja, para el caché de RAG·32, el vector de la PETICIÓN
ORIGINAL (siempre del texto del visitante, con task_type de consulta: así las
corridas se comparan entre sí aunque cambie el camino) y la versión del
catálogo con que se armó (`version_catalogo()`).
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Callable

from pipeline import n8n_catalogo

CAMINOS = ("directo", "reescrita")
MAX_PALABRAS = 60          # lo que pide el prompt; el tope duro es de caracteres
MAX_CARACTERES = 600
PROMPT = "automatiza_reescribir_system"

Reescritor = Callable[[str, str], dict]


@dataclass(frozen=True)
class Consulta:
    """Con qué se busca en el índice y por qué camino se llegó ahí."""
    texto: str
    camino: str                                     # directo · reescrita
    nodos: list[str] = field(default_factory=list)  # sugeridos, ya filtrados
    respaldo: str | None = None                     # por qué se cayó a directo


def camino_configurado() -> str:
    c = os.getenv("RAG_CAMINO", "directo")
    return c if c in CAMINOS else "directo"


def version_catalogo() -> str:
    """«n8n 2.41.4 · prototipo»: si cambia, lo guardado en caché ya no vale."""
    cat = n8n_catalogo.catalogo()["procedencia"]["n8n"]
    return f"n8n {cat} · {n8n_catalogo.etapa()}"


def prompt_sistema() -> str:
    from pipeline.config import load_prompt
    lista = "\n".join(f"{t} — {n['nombre']}" for t, n in n8n_catalogo.permitidos().items())
    return load_prompt(PROMPT).format(nodos=lista)


def _limpia(respuesta) -> tuple[str, list[str]]:
    """Valida lo que contestó el modelo. Los nodos que no están permitidos se
    tiran (no se le cree al modelo); una consulta vacía o enorme es basura."""
    if not isinstance(respuesta, dict):
        raise ValueError("la respuesta no es un objeto")
    texto = respuesta.get("consulta")
    if not isinstance(texto, str) or not texto.strip():
        raise ValueError("sin consulta")
    texto = " ".join(texto.split())
    if len(texto) > MAX_CARACTERES:
        raise ValueError("consulta demasiado larga")
    crudos = respuesta.get("nodos") or []
    if not isinstance(crudos, list):
        raise ValueError("nodos no es una lista")
    permitidos = n8n_catalogo.permitidos()
    nodos: list[str] = []
    for n in crudos:
        if isinstance(n, str) and n in permitidos and n not in nodos:
            nodos.append(n)
    return texto, nodos


def preparar(peticion: str, camino: str | None = None, *,
             reescribir: Reescritor | None = None) -> Consulta:
    """La consulta con la que se va a buscar."""
    camino = camino or camino_configurado()
    if camino not in CAMINOS:
        raise ValueError(f"camino desconocido: {camino}")
    peticion = " ".join(peticion.split())
    if not peticion:
        raise ValueError("petición vacía")
    if camino == "directo":
        return Consulta(peticion, "directo")
    if reescribir is None:
        return Consulta(peticion, "directo", respaldo="sin_modelo")
    try:
        texto, nodos = _limpia(reescribir(prompt_sistema(), peticion))
    except Exception as e:  # noqa: BLE001 — cualquier fallo del modelo cae a directo
        return Consulta(peticion, "directo", respaldo=f"{type(e).__name__}: {e}"[:200])
    return Consulta(texto, "reescrita", nodos)


def modelo_vector() -> str:
    from pipeline import vectores
    return f"{vectores.modelo()}/{vectores.DIMENSION}"


def entender(corrida_id: int, peticion: str, *,
             embeber: Callable[[list[str], str], list[list[float]]] | None,
             reescribir: Reescritor | None = None,
             camino: str | None = None) -> tuple[Consulta, list[float] | None]:
    """El paso «entender» del worker: prepara la consulta, embebe la petición
    original y lo anota en la corrida. Si embeber falla, la corrida no puede
    buscar y el error sube (el worker la cierra como no_salio). Si lo que
    falla es ANOTAR, se loguea y se sigue: es dato para el caché, no para
    entregar."""
    import logging

    from pipeline import db
    consulta = preparar(peticion, camino, reescribir=reescribir)
    vector = embeber([peticion], "consulta")[0] if embeber else None
    try:
        db.automatiza_busqueda(
            corrida_id, vector=vector, modelo=modelo_vector() if vector else None,
            catalogo=version_catalogo(), camino=consulta.camino,
            detalle={"consulta": consulta.texto, "nodos": consulta.nodos,
                     "respaldo": consulta.respaldo})
    except Exception:  # noqa: BLE001 — anotar no tumba la corrida
        logging.getLogger(__name__).exception(
            "corrida %s: no se pudo anotar la búsqueda (¿falta db_migrate?)", corrida_id)
    return consulta, vector
