"""RAG·22 — el validador del flujo de n8n, en capas y fallando CERRADO.

Lo que revisa es que el `.json` esté BIEN FORMADO y se pueda importar, no que
el flujo haga lo que pidieron: un flujo perfecto que no sirve pasa las tres
capas (para eso están el reporte y la comunidad, RAG·25/27).

    1. Forma (JSON Schema): las llaves que n8n espera, con sus tipos.
    2. Coherencia, que el esquema no puede expresar: n8n conecta los nodos
       POR NOMBRE, así que toda conexión tiene que llevar a un nodo que
       existe; nombres únicos; exactamente un disparador; y cada `type` y
       `typeVersion` revisados contra el catálogo de RAG·18 (existe, no está
       oculto, está permitido, la versión es válida). Las conexiones de IA
       (ai_languageModel, ai_tool…) tienen que salir de un nodo que produce
       ese tipo y llegar a uno que lo recibe.
    3. Credenciales: siempre referencias VACÍAS (tipo → {"name"}; el `id`, si
       viene, vacío). Y ningún texto del flujo puede parecer un secreto: el
       flujo que se entrega no lleva claves dentro, ni del visitante ni
       nuestras.

Fallar cerrado quiere decir: si el propio validador truena, el flujo NO pasa.

Los errores van en español y cortos: RAG·21 se los devuelve al modelo en su
único reintento. Las advertencias (un nodo suelto, sin conexiones) no tumban
el flujo.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from pipeline import n8n_catalogo

TIPOS_CONEXION = ("main", "ai_languageModel", "ai_tool", "ai_memory", "ai_outputParser",
                  "ai_embedding", "ai_document", "ai_textSplitter", "ai_vectorStore",
                  "ai_retriever", "ai_reranker")
MAX_NODOS = 60              # un flujo del prototipo no necesita más
MAX_ERRORES = 20            # para el reintento basta con los primeros

ESQUEMA = {
    "type": "object",
    "required": ["name", "nodes", "connections"],
    "additionalProperties": False,
    "properties": {
        "name": {"type": "string", "minLength": 1, "maxLength": 200},
        "nodes": {
            "type": "array", "minItems": 1, "maxItems": MAX_NODOS,
            "items": {
                "type": "object",
                "required": ["name", "type", "typeVersion", "position", "parameters"],
                "additionalProperties": False,
                "properties": {
                    "id": {"type": "string"},
                    "name": {"type": "string", "minLength": 1, "maxLength": 128},
                    "type": {"type": "string", "minLength": 3},
                    "typeVersion": {"type": "number"},
                    "position": {"type": "array", "items": {"type": "number"},
                                 "minItems": 2, "maxItems": 2},
                    "parameters": {"type": "object"},
                    "credentials": {
                        "type": "object",
                        "additionalProperties": {
                            "type": "object", "required": ["name"],
                            "additionalProperties": False,
                            "properties": {"id": {"type": "string", "maxLength": 0},
                                           "name": {"type": "string", "maxLength": 128}}}},
                    "disabled": {"type": "boolean"},
                    "notes": {"type": "string"},
                    "webhookId": {"type": "string"},
                },
            },
        },
        "connections": {
            "type": "object",
            "additionalProperties": {
                "type": "object",
                "propertyNames": {"enum": list(TIPOS_CONEXION)},
                "additionalProperties": {
                    "type": "array",
                    "items": {"type": ["array", "null"], "items": {
                        "type": "object", "required": ["node", "type", "index"],
                        "additionalProperties": False,
                        "properties": {"node": {"type": "string"},
                                       "type": {"enum": list(TIPOS_CONEXION)},
                                       "index": {"type": "integer", "minimum": 0}}}},
                },
            },
        },
        "settings": {"type": "object"},
        "meta": {"type": "object"},
        "pinData": {"type": "object", "maxProperties": 0},
        "tags": {"type": "array"},
    },
}

# Lo que parece una clave. Si un modelo la copia de la petición o se la
# inventa, el flujo no sale: es mejor un «no salió» que entregar un secreto.
SECRETOS = [re.compile(p) for p in (
    r"sk-[A-Za-z0-9_-]{20,}",                   # OpenAI, Anthropic, OpenRouter
    r"AIza[0-9A-Za-z_-]{35}",                   # Google
    r"xox[baprs]-[0-9A-Za-z-]{10,}",            # Slack
    r"gh[pousr]_[A-Za-z0-9]{30,}",              # GitHub
    r"\b\d{8,10}:[A-Za-z0-9_-]{35}\b",          # bot de Telegram
    r"(?i)bearer\s+[A-Za-z0-9._~+/-]{20,}",
    r"-----BEGIN [A-Z ]*PRIVATE KEY-----",
    r"\bAKIA[0-9A-Z]{16}\b",                    # AWS
)]


@dataclass
class Resultado:
    ok: bool
    errores: list[str] = field(default_factory=list)
    advertencias: list[str] = field(default_factory=list)


def _textos(valor, ruta=""):
    """Todos los textos del flujo, con dónde están."""
    if isinstance(valor, str):
        yield ruta, valor
    elif isinstance(valor, dict):
        for k, v in valor.items():
            yield from _textos(k, ruta)
            yield from _textos(v, f"{ruta}.{k}" if ruta else str(k))
    elif isinstance(valor, list):
        for i, v in enumerate(valor):
            yield from _textos(v, f"{ruta}[{i}]")


def _forma(flujo) -> list[str]:
    import jsonschema
    val = jsonschema.Draft202012Validator(ESQUEMA)
    errores = []
    for e in sorted(val.iter_errors(flujo), key=lambda e: list(e.absolute_path)):
        donde = "/".join(str(p) for p in e.absolute_path) or "(raíz)"
        errores.append(f"forma: {donde}: {e.message[:160]}")
    return errores


def _puertos(tipo: str, cuales: str):
    """Los tipos de entrada o salida del nodo, o None si n8n los calcula."""
    raiz, herramienta = n8n_catalogo.base(tipo)
    if raiz is None:
        return None
    if herramienta:
        return ["ai_tool"] if cuales == "salidas" else []
    p = n8n_catalogo.catalogo()["nodos"][raiz][cuales]
    return None if isinstance(p, str) else p


def _coherencia(flujo: dict) -> tuple[list[str], list[str]]:
    errores, avisos = [], []
    nodos = flujo["nodes"]
    por_nombre: dict[str, dict] = {}
    for n in nodos:
        if n["name"] in por_nombre:
            errores.append(f"nombre repetido: «{n['name']}» (n8n conecta por nombre)")
        por_nombre[n["name"]] = n
    ids = [n["id"] for n in nodos if n.get("id")]
    if len(ids) != len(set(ids)):
        errores.append("hay ids de nodo repetidos")

    cat = n8n_catalogo.catalogo()["nodos"]
    disparadores = []
    for n in nodos:
        v = n8n_catalogo.revisar(n["type"], n["typeVersion"])
        if not v.ok:
            errores.append(f"nodo «{n['name']}»: {v.mensaje}")
            continue
        raiz, herramienta = n8n_catalogo.base(n["type"])
        info = cat[raiz]
        if info["disparador"] and not herramienta and not n.get("disabled"):
            disparadores.append(n["name"])
        faltan = [p for p in info["obligatorios"] if p not in n["parameters"]]
        if faltan and not herramienta:
            errores.append(f"nodo «{n['name']}»: faltan parámetros obligatorios: {', '.join(faltan)}")
        permitidas = {c["nombre"] for c in info["credenciales"]}
        for cred in (n.get("credentials") or {}):
            if cred not in permitidas:
                errores.append(f"nodo «{n['name']}»: la credencial «{cred}» no es de este nodo")
    if len(disparadores) != 1:
        errores.append(f"tiene que haber exactamente un disparador y hay {len(disparadores)}"
                       + (f": {', '.join(disparadores)}" if disparadores else ""))

    conectados = set()
    for origen, salidas in flujo["connections"].items():
        if origen not in por_nombre:
            errores.append(f"conexión desde «{origen}», que no es ningún nodo")
            continue
        produce = _puertos(por_nombre[origen]["type"], "salidas")
        for tipo, ramas in salidas.items():
            if produce is not None and tipo not in produce:
                errores.append(f"«{origen}» no tiene salida de tipo {tipo}")
            for rama in ramas:
                for destino in rama or []:
                    if destino["type"] != tipo:
                        errores.append(f"conexión {origen} → {destino['node']}: "
                                       f"el tipo {destino['type']} no es {tipo}")
                    if destino["node"] not in por_nombre:
                        errores.append(f"conexión de «{origen}» a «{destino['node']}», "
                                       "que no es ningún nodo")
                        continue
                    recibe = _puertos(por_nombre[destino["node"]]["type"], "entradas")
                    if recibe is not None and tipo not in recibe:
                        errores.append(f"«{destino['node']}» no recibe conexiones de tipo {tipo}")
                    conectados.update((origen, destino["node"]))
    if len(nodos) > 1:
        for n in nodos:
            if n["name"] not in conectados:
                avisos.append(f"el nodo «{n['name']}» no está conectado a nada")
    return errores, avisos


def _secretos(flujo: dict) -> list[str]:
    errores = []
    for ruta, texto in _textos(flujo):
        if any(p.search(texto) for p in SECRETOS):
            errores.append(f"secreto: {ruta or '(llave)'} parece una clave; el flujo no lleva claves")
    return errores


def validar(flujo) -> Resultado:
    """¿Se puede entregar este flujo? Falla cerrado: cualquier excepción del
    validador es un «no»."""
    try:
        errores = _forma(flujo)
        if errores:                   # sin la forma, las demás capas no se pueden leer
            return Resultado(False, errores[:MAX_ERRORES])
        errores, avisos = _coherencia(flujo)
        errores += _secretos(flujo)
        return Resultado(not errores, errores[:MAX_ERRORES], avisos)
    except Exception as e:  # noqa: BLE001 — fallar cerrado
        return Resultado(False, [f"el validador falló: {type(e).__name__}: {e}"[:300]])


def para_el_modelo(r: Resultado) -> str:
    """Los errores como texto para el único reintento de RAG·21."""
    return "\n".join(f"- {e}" for e in r.errores)
