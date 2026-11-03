"""Asistente de Automatizaciones, Fase A: el modo «prueba» (GASTO 0).

La persona escribe qué quiere automatizar y el Asistente le devuelve un flujo de n8n. Mientras el
dueño no encienda el armado real (RAG + Opus: cuesta dinero y guarda texto de la gente, así que exige su
«sí» con el costo a la vista), lo que se devuelve es una MUESTRA enlatada
(`media/library/n8n/muestras_prueba.json`), elegida por palabras clave del pedido. Todo viaja con
`modo: "prueba"` para que la pantalla lo diga.

Este módulo es lógica pura. Lo que NO hace, a propósito y por construcción (lo fija
`tests/test_automatiza_guardianes.py`):

  - no importa —ni arriba ni dentro de una función— ningún SDK de proveedor (`anthropic`, `openai`,
    `google`, `boto3`, `langfuse`) ni los módulos que gastan o encolan (`pipeline.claude_rag`, `armado`,
    `embeddings`, `vectores`, `jobs`, `moderacion`, `creditos`, `llm`);
  - no lee ni escribe la base, no usa cola, no sale a la red;
  - no guarda ni registra el texto de la persona. De él solo se conserva, en el log, el largo y la clave
    de la muestra que salió.

**El estado de una corrida de prueba se deriva del reloj.** No hay fila en ninguna parte: el `id` es
opaco y autocontenido, `p1.<base64url(json)>` con tres llaves,

    u  los 12 primeros hex de sha256(sub): de quién es
    t  el instante de inicio, en milisegundos de época
    m  la clave de la muestra que salió

Sin firma ni secreto: lo único que logra quien fabrique uno a mano es ver una muestra enlatada de su
propio usuario. La validación es estricta (prefijo, alfabeto, largo ≤ 120, JSON canónico con exactamente
esas tres llaves, `u` igual al de quien pregunta, `-60 s ≤ ahora − t ≤ 3600 s` y `m` existente) y todo lo
demás es «no encontrada», nunca 403. La forma `p1.…` lleva un punto, que no existe en los ids reales
(`[A-Za-z0-9_-]{16}`): nunca se confunden. Con cuatro pasos de 1.2 s la espera dura 4.8 s y luego la corrida
queda «listo» (o «sin_cobertura») hasta que el id caduca, a la hora. Los 4.8 s caben antes del primer sondeo de
la web (a los 5 s: `ESCALERA` de `web/src/nucleo/sondeo.ts`, y lo fija una prueba): con 6 s el primer sondeo solo
veía «revisar» y el resultado, que estaba listo a los 6 s, no aparecía hasta los 10.

El reloj se inyecta (`ahora=` en segundos de época, como `time.time()`) para que las pruebas no esperen.

**Qué modo corre** (`modo()`, tabla del informe 05 §2.3): la única rama que se activa sola es «prueba».
El real exige cinco cosas a la vez y lo mal configurado NO degrada en silencio a prueba (mostraría un
ejemplo enlatado como si fuera el flujo de la persona): da «no_disponible». En esta fase el modo real no
existe todavía: `config()` lo reporta apagado (`activo: false`, y `modo: "no_disponible"` si estaba mal
configurado) y el API contesta 503.
"""
from __future__ import annotations

import base64
import binascii
import copy
import hashlib
import hmac
import json
import math
import os
import re
import time
import unicodedata
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any, Mapping

from pipeline import n8n_catalogo, validador
from pipeline import publico as freno      # solo las constantes de largo del pedido: una sola fuente

RAIZ = Path(__file__).resolve().parent.parent
RUTA_MUESTRAS = RAIZ / "media" / "library" / "n8n" / "muestras_prueba.json"

# ---------------------------------------------------------------------------
# los modos

PRUEBA = "prueba"
REAL = "real"
NO_DISPONIBLE = "no_disponible"
VAR_ASISTENTE_REAL = "AUTOMATIZA_ASISTENTE_REAL"       # ausente = prueba (default invertido)
MODOS = (PRUEBA, REAL, NO_DISPONIBLE)


def modo(entorno: Mapping[str, str] | None = None, *, interruptor_ok: bool = False,
         cobro_por_uso: int | None = None) -> str:
    """`"prueba"`, `"real"` o `"no_disponible"`. Función pura sobre el entorno (por defecto `os.environ`).

    | ARMADO_REAL | AUTOMATIZA_ASISTENTE_REAL | interruptor | cobro_por_uso | CREDITOS+STATE | resultado
    | ausente     | cualquiera                | cualquiera  | cualquiera    | cualquiera      | prueba
    | 1           | ausente                   | —           | —             | —               | prueba
    | 1           | 1                         | no          | —             | —               | no_disponible
    | 1           | 1                         | sí          | falta         | —               | no_disponible
    | 1           | 1                         | sí          | ok            | no postgres     | no_disponible
    | 1           | 1                         | sí          | ok            | postgres+postgres | real

    `interruptor_ok` = la fila del asistente en la base está encendida CON topes; `cobro_por_uso` = los
    créditos que cuesta una corrida (tools/tarifas.json §rag.cobro_por_uso, que no existe hoy). En la
    Fase A nadie los lee —no hay base—, así que valen su default y el real es inalcanzable.

    «1» de DEV: `ARMADO_REAL=1` ya está encendido en dev para el worker público; con solo eso, el
    Asistente sigue en prueba. Solo el valor exacto «1» cuenta, en las dos variables."""
    env = os.environ if entorno is None else entorno
    if env.get("ARMADO_REAL") != "1" or env.get(VAR_ASISTENTE_REAL) != "1":
        return PRUEBA
    cobra = (isinstance(cobro_por_uso, int) and not isinstance(cobro_por_uso, bool)
             and cobro_por_uso > 0)
    if (interruptor_ok is True and cobra and env.get("CREDITOS_BACKEND") == "postgres"
            and env.get("STATE_BACKEND") == "postgres"):
        return REAL
    return NO_DISPONIBLE


def sirve(modo_: str) -> bool:
    """¿Este modo se puede servir hoy? Solo la prueba: el real es la Fase B."""
    return modo_ == PRUEBA


def limites() -> tuple[int, int]:
    """`(mínimo, máximo)` de caracteres del pedido: los de `pipeline/publico.py` (provisionales hasta que
    el dueño ponga su número). Se leen en cada uso: hay una sola fuente."""
    return freno.LARGO_MINIMO, freno.LARGO_MAXIMO


def config(modo_: str) -> dict:
    """El cuerpo de `GET /api/automatiza/config`. Los límites del pedido salen de `pipeline/publico.py`,
    no del cliente. `activo: false` = la pantalla no ofrece escribir (y decide por `activo` antes que por
    `modo`). `modo` es uno de `MODOS`: `"no_disponible"` ya no se hace pasar por `"real"` (una pantalla que
    decidiera por `modo === "real"` mostraría un estado que no existe). En prueba es gratis y no hay cupo.
    El texto para el estado apagado lo pone el API (`server/automatiza_api.py`, que tiene el catálogo)."""
    prueba = modo_ == PRUEBA
    minimo, maximo = limites()
    return {"activo": sirve(modo_), "modo": modo_ if modo_ in MODOS else NO_DISPONIBLE, "gratis": prueba,
            "costo_creditos": 0 if prueba else None, "largo_minimo": minimo, "largo_maximo": maximo,
            "cupo": None}


# ---------------------------------------------------------------------------
# errores

class ErrorAsistente(Exception):
    """Un pedido o un id que no se puede atender. `codigo` es el del catálogo de `server/automatiza_api.py`
    y `extras` viaja en el `detail` (p. ej. `minimo`, `maximo`)."""

    def __init__(self, codigo: str, **extras: Any):
        super().__init__(codigo)
        self.codigo = codigo
        self.extras = extras


class MuestrasInvalidas(RuntimeError):
    """El archivo de muestras está roto. Falla cerrado: sin muestras buenas, el Asistente no atiende."""


# ---------------------------------------------------------------------------
# el texto del pedido

# U+0000 y los sustitutos sueltos (U+D800 a U+DFFF): no son texto y revientan más adelante (la base al
# guardar, el SDK al codificar). Se rechazan al entrar, con su propio mensaje.
_INVALIDO = re.compile("[\x00\ud800-\udfff]")


def revisar_texto(texto: str) -> str:
    """El pedido ya recortado, o el `ErrorAsistente` que toca: `vacio`, `texto_invalido`, `corto`
    (`minimo`) o `largo` (`maximo`). Los límites son los de `pipeline/publico.py`."""
    texto = texto.strip()
    if not texto:
        raise ErrorAsistente("vacio")
    if _INVALIDO.search(texto):
        raise ErrorAsistente("texto_invalido")
    minimo, maximo = limites()
    if len(texto) < minimo:
        raise ErrorAsistente("corto", minimo=minimo)
    if len(texto) > maximo:
        raise ErrorAsistente("largo", maximo=maximo)
    return texto


_MARCAS = re.compile(r"[\u0300-\u036f]")      # las marcas combinantes que deja NFD (acentos, tildes)


def norm(texto: str) -> str:
    """Minúsculas, sin acentos y sin espacios en las orillas (el `norm` del mockup)."""
    return _MARCAS.sub("", unicodedata.normalize("NFD", str(texto or "").lower())).strip()


# ---------------------------------------------------------------------------
# las muestras

# Lo que dicen las copias del público para estos dos finales (server/publico_api.py:MENSAJES); la prueba
# `test_los_mensajes_son_los_del_publico` las mantiene iguales.
MENSAJES = {
    "no_salio": ("Esta vez no pudimos armar un flujo que importe bien en n8n. "
                 "Preferimos no darte uno roto."),
    "sin_cobertura": "Todavía no sabemos armar esto con n8n.",
}
ESTADOS_MUESTRA = ("listo", "sin_cobertura")
_ID_MUESTRA = re.compile(r"[a-z][a-z_]{0,23}")
MAX_FALTAN = 10              # armado.py: faltan[:10]
MAX_FALTAN_CHARS = 200       # armado.py: str(x)[:200]
MAX_NOMBRE_PENDIENTE = 100


@dataclass(frozen=True)
class Muestra:
    id: str
    estado: str                          # listo · sin_cobertura
    claves: tuple[str, ...]              # ya normalizadas
    por_omision: bool
    resumen: str
    flujo: dict | None
    grafo: dict | None                   # {nombreFlujo, nodes, edges} del Constructor; opcional
    faltan: tuple[str, ...]
    nodos: tuple[dict, ...]              # [{tipo, nombre, etiqueta, nombre_en_flujo}] en el orden del flujo
    pendientes: tuple[str, ...]
    advertencias: tuple[str, ...]        # las del validador


def nombre_de_nodo(tipo: str) -> str:
    """El nombre legible de un tipo de nodo (`permitidos.json`; si no, el catálogo; si no, el final del
    tipo), con « (herramienta)» para las variantes `…Tool`. Es el nombre de n8n, en inglés: para la persona
    está `etiqueta_de_nodo`."""
    raiz, herramienta = n8n_catalogo.base(tipo)
    nombre = ""
    if raiz is not None:
        nombre = (n8n_catalogo.permitidos().get(raiz, {}).get("nombre")
                  or n8n_catalogo.catalogo()["nodos"].get(raiz, {}).get("nombre") or "")
    nombre = nombre or tipo.rsplit(".", 1)[-1]
    return nombre + (" (herramienta)" if herramienta else "")


# Las apps que el Constructor ofrece, por el tipo de su nodo de n8n: (cómo se llama para la persona, qué tiene
# que elegir al abrirla en n8n). Los mismos textos que `datos/pendientes.ts` del Constructor (PEND del mockup);
# `tests/test_automatiza_asistente.py` los mantiene idénticos. La credencial se conecta; lo demás, no se
# puede saber desde aquí.
APPS_DE_N8N: dict[str, tuple[str, str]] = {
    "n8n-nodes-base.gmail": ("Gmail", "el destinatario"),
    "n8n-nodes-base.googleSheets": ("Google Sheets", "el documento y la hoja"),
    "n8n-nodes-base.slack": ("Slack", "el canal"),
    "n8n-nodes-base.telegram": ("Telegram", "el Chat ID"),
    "n8n-nodes-base.notion": ("Notion", "la página y el título"),
    "n8n-nodes-base.airtable": ("Airtable", "la base, la tabla y el registro"),
    "n8n-nodes-base.whatsApp": ("WhatsApp", "el número que envía y el que recibe"),
    "n8n-nodes-base.googleDrive": ("Google Drive", "la carpeta y el archivo"),
    "n8n-nodes-base.googleDocs": ("Google Docs", "la carpeta y el título"),
    "n8n-nodes-base.emailSend": ("Correo (SMTP)", "el remitente y el destinatario"),
}

# El resto de los nodos permitidos (`permitidos.json`), en español para el chip de la pantalla. Un nodo que se
# permita y no esté aquí saldría con su nombre en inglés: `test_todo_nodo_permitido_tiene_su_etiqueta_en_espanol`
# lo impide.
ETIQUETAS: dict[str, str] = {
    "n8n-nodes-base.manualTrigger": "Se inicia a mano",
    "n8n-nodes-base.scheduleTrigger": "Se inicia con un horario",
    "n8n-nodes-base.webhook": "Llega una llamada web (webhook)",
    "@n8n/n8n-nodes-langchain.chatTrigger": "Llega un mensaje en el chat",
    "n8n-nodes-base.formTrigger": "Alguien llena un formulario",
    "n8n-nodes-base.telegramTrigger": "Llega un mensaje en Telegram",
    "n8n-nodes-base.gmailTrigger": "Llega un correo (Gmail)",
    "n8n-nodes-base.if": "Condición (si se cumple o no)",
    "n8n-nodes-base.switch": "Elige un camino según el caso",
    "n8n-nodes-base.merge": "Junta caminos",
    "n8n-nodes-base.wait": "Espera un tiempo",
    "n8n-nodes-base.splitInBatches": "Procesa por tandas",
    "n8n-nodes-base.noOp": "No hace nada (deja pasar)",
    "n8n-nodes-base.set": "Edita campos",
    "n8n-nodes-base.splitOut": "Separa una lista en elementos",
    "n8n-nodes-base.aggregate": "Junta elementos en una lista",
    "n8n-nodes-base.filter": "Filtra elementos",
    "n8n-nodes-base.html": "Trabaja con HTML",
    "n8n-nodes-base.limit": "Limita cuántos elementos pasan",
    "n8n-nodes-base.httpRequest": "Llamada web (HTTP)",
    "n8n-nodes-base.code": "Código",
    "n8n-nodes-base.respondToWebhook": "Responde a la llamada web",
    "n8n-nodes-base.extractFromFile": "Lee el texto de un archivo",
    "n8n-nodes-base.convertToFile": "Convierte datos en un archivo",
    "@n8n/n8n-nodes-langchain.agent": "Agente de IA",
    "@n8n/n8n-nodes-langchain.lmChatOpenAi": "Modelo de IA (OpenAI)",
    "@n8n/n8n-nodes-langchain.lmChatGoogleGemini": "Modelo de IA (Gemini)",
    "@n8n/n8n-nodes-langchain.lmChatOpenRouter": "Modelo de IA (OpenRouter)",
    "@n8n/n8n-nodes-langchain.lmChatAnthropic": "Modelo de IA (Anthropic)",
    "@n8n/n8n-nodes-langchain.outputParserStructured": "Ordena la respuesta de la IA",
    "@n8n/n8n-nodes-langchain.memoryBufferWindow": "Memoria de la conversación",
    "@n8n/n8n-nodes-langchain.openAi": "OpenAI (texto, imagen y audio)",
    "@n8n/n8n-nodes-langchain.chainLlm": "Cadena de IA básica",
    "@n8n/n8n-nodes-langchain.embeddingsOpenAi": "Convierte texto en vectores (OpenAI)",
    "@n8n/n8n-nodes-langchain.documentDefaultDataLoader": "Carga documentos",
    "@n8n/n8n-nodes-langchain.textSplitterRecursiveCharacterTextSplitter": "Parte el texto en trozos",
    "@n8n/n8n-nodes-langchain.vectorStoreInMemory": "Almacén de vectores en memoria",
}
SUFIJO_AGENTE = " (lo consulta el agente)"
SUFIJO_PASO = " (paso)"
MAX_NOMBRE_NODO = 100


def etiqueta_de_nodo(tipo: str) -> str:
    """El chip de un nodo para la persona, en español: «Llega un correo (Gmail)», «Agente de IA», «Gmail
    (paso)», «Google Sheets (lo consulta el agente)». Las apps dicen si son un paso o si las consulta el
    agente (la variante `…Tool`). Un tipo que no se conoce sale con el final de su tipo, como `nombre_de_nodo`."""
    raiz, herramienta = n8n_catalogo.base(tipo)
    if raiz in APPS_DE_N8N:
        return APPS_DE_N8N[raiz][0] + (SUFIJO_AGENTE if herramienta else SUFIJO_PASO)
    etiqueta = ETIQUETAS.get(raiz) if raiz is not None else None
    if etiqueta is None:
        return tipo.rsplit(".", 1)[-1]
    return etiqueta + (SUFIJO_AGENTE if herramienta else "")


def pendientes_de(flujo: dict) -> list[str]:
    """Una línea por cada cuenta que el flujo referencia, sin repetir y en el orden de los nodos: «Conecta tu
    cuenta de X en n8n.» y, si el nodo es una app que pide elegir algo al abrirla (`APPS_DE_N8N`), «…y elige el
    destinatario.» (el mismo aviso que da el Constructor). Si dos nodos comparten cuenta, sus «elige» se
    juntan en la misma línea. Se deriva del propio flujo, no de una tabla aparte."""
    cuentas: dict[str, list[str]] = {}
    for nodo in flujo.get("nodes") or []:
        raiz, _ = n8n_catalogo.base(str(nodo.get("type") or ""))
        elegir = APPS_DE_N8N.get(raiz or "", ("", ""))[1]
        for llave, cred in (nodo.get("credentials") or {}).items():
            nombre = " ".join(str((cred or {}).get("name") or llave).split())[:MAX_NOMBRE_PENDIENTE]
            que = cuentas.setdefault(nombre, [])
            if elegir and elegir not in que:
                que.append(elegir)
    return [f"Conecta tu cuenta de {nombre} en n8n" + (f" y elige {' y '.join(que)}" if que else "") + "."
            for nombre, que in cuentas.items()]


# El mismo aviso que da el Constructor para un chat público (`exportar.ts`); lo fija una prueba contra
# `golden/flujos.json`.
ADVERTENCIA_CHAT_PUBLICO = ("El chat quedará público: cualquiera con el enlace podrá escribirle "
                            "(y gastar tu llave de IA).")


def advertencias_de(flujo: dict, del_validador: list[str] | tuple[str, ...]) -> list[str]:
    """Lo que la persona debe saber del flujo: las advertencias del validador y, si algún nodo queda abierto al
    público (`parameters.public` es `True`: el chat de preguntas), que cualquiera con el enlace podrá escribirle
    y gastar su llave de IA. Sale del propio flujo, así que vale igual en el modo real."""
    avisos = list(del_validador)
    for nodo in flujo.get("nodes") or []:
        parametros = nodo.get("parameters") if isinstance(nodo, dict) else None
        if isinstance(parametros, dict) and parametros.get("public") is True:
            avisos.append(ADVERTENCIA_CHAT_PUBLICO)
            break
    return avisos


def sin_clave(texto: str) -> bool:
    """¿El texto está limpio de lo que parece una clave? (`validador.SECRETOS`)"""
    return not any(p.search(texto) for p in validador.SECRETOS)


# ---------------------------------------------------------------------------
# el grafo del Constructor: las mismas reglas que `invariantesDelGrafo` (web/.../modelo/grafo.ts)

TOPE_DISPARADORES = 1
TOPE_AGENTES = 4
TOPE_APPS = 8
LIENZO_MAX = 2400            # x e y de un cuadro, de 0 a 2400 (X_MAX / Y_MAX del Constructor)
_TIPOS_DE_CUADRO = ("trigger", "agent", "app")
_TIPOS_DE_CONEXION = ("seq", "tool")


def _texto(valor: object) -> bool:
    return isinstance(valor, str) and valor != ""


def _hay_ciclo(ids: list[str], sale: dict[str, list[str]]) -> bool:
    """¿Hay un círculo en este grafo dirigido? Recorrido en profundidad con pila propia (sin recursión)."""
    color: dict[str, int] = {}                       # 1 = en la pila, 2 = terminado
    for inicio in ids:
        if inicio in color:
            continue
        color[inicio] = 1
        pila: list[list] = [[inicio, 0]]
        while pila:
            tope = pila[-1]
            vecinos = sale.get(tope[0], [])
            if tope[1] >= len(vecinos):
                color[tope[0]] = 2
                pila.pop()
                continue
            w = vecinos[tope[1]]
            tope[1] += 1
            if color.get(w) == 1:
                return True
            if w not in color:
                color[w] = 1
                pila.append([w, 0])
    return False


def _adyacencia(pares: list[tuple[str, str]]) -> dict[str, list[str]]:
    sale: dict[str, list[str]] = {}
    for de, a in pares:
        sale.setdefault(de, []).append(a)
    return sale


def invariantes_del_grafo(grafo: object) -> list[str]:
    """Todo lo que viola los invariantes de un `grafo` `{nodes, edges, …}` del Constructor, como
    `"<código>: <detalle>"` (los códigos son los de `CODIGOS_VIOLACION` de `grafo.ts`). Lista vacía = válido.
    Acepta CUALQUIER cosa: lo que no es una lista o un cuadro bien formado se reporta, no truena.

    Los invariantes: ids únicos de cuadros y de conexiones; ninguna conexión huérfana, a sí misma, de tipo raro
    o repetida; nada llega a un disparador; una conexión `tool` sale siempre de un agente; un cuadro tiene a
    lo sumo UN padre `tool`; un ayudante (agente con padre) no recibe `seq`; una herramienta (app con padre) no
    toca ningún `seq`; sin círculos (solo `seq`, solo `tool`, ni mezclados); a lo sumo 1 disparador, 4 agentes
    y 8 apps; cada cuadro con `x` e `y` finitos y entre 0 y 2400. No revisa los campos de cada cuadro (nombres,
    `ia`, `tipo`…): de eso se encarga el exportador, y el flujo de n8n se valida aparte."""
    problemas: list[str] = []

    def add(codigo: str, detalle: str) -> None:
        problemas.append(f"{codigo}: {detalle}")

    g = grafo if isinstance(grafo, dict) else {}
    nodes, edges = g.get("nodes"), g.get("edges")
    if not isinstance(nodes, list):
        add("nodos-no-es-lista", type(nodes).__name__)
    if not isinstance(edges, list):
        add("aristas-no-es-lista", type(edges).__name__)

    # ---- forma: lo que no se puede leer como cuadro o conexión se reporta y se deja fuera de lo demás
    nodos: list[dict] = []
    for i, n in enumerate(nodes if isinstance(nodes, list) else []):
        if not isinstance(n, dict):
            add("nodo-malformado", f"#{i} no es un objeto")
        elif not _texto(n.get("id")):
            add("nodo-malformado", f"#{i} no tiene id")
        elif n.get("kind") not in _TIPOS_DE_CUADRO:
            add("nodo-malformado", f"{n['id']}: su tipo de cuadro no existe")
        else:
            nodos.append(n)
    aristas: list[dict] = []
    for i, e in enumerate(edges if isinstance(edges, list) else []):
        if not isinstance(e, dict):
            add("arista-malformada", f"#{i} no es un objeto")
        elif not (_texto(e.get("id")) and _texto(e.get("de")) and _texto(e.get("a"))):
            add("arista-malformada", f"#{i} no tiene id, origen o destino")
        else:
            aristas.append(e)

    # ---- ids únicos
    por_id: dict[str, dict] = {}
    for n in nodos:
        if n["id"] in por_id:
            add("ids-nodos-duplicados", n["id"])
        por_id[n["id"]] = n
    ids_e: set[str] = set()
    for e in aristas:
        if e["id"] in ids_e:
            add("ids-aristas-duplicados", e["id"])
        ids_e.add(e["id"])

    # ---- conexiones, una por una
    vistas: set[str] = set()
    padres: dict[str, list[str]] = {}                # destino -> orígenes de las `tool` que le llegan
    seq_toca: set[str] = set()
    seq_entra: set[str] = set()
    pasos: list[tuple[str, str]] = []
    herramientas: list[tuple[str, str]] = []
    for e in aristas:
        origen, destino = por_id.get(e["de"]), por_id.get(e["a"])
        if origen is None or destino is None:
            add("arista-huerfana", f"{e['id']}: {e['de']} → {e['a']}")
            continue
        if e["de"] == e["a"]:
            add("arista-a-si-mismo", e["id"])
        tipo = e.get("tipo")
        if tipo not in _TIPOS_DE_CONEXION:
            add("arista-tipo-invalido", f"{e['id']}: {tipo!s}")
            continue
        clave = f"{tipo}|{e['de']}|{e['a']}"
        if clave in vistas:
            add("arista-duplicada", clave)
        vistas.add(clave)
        if destino["kind"] == "trigger":
            add("llega-al-disparador", f"{e['id']} {tipo}")
        if tipo == "tool":
            padres.setdefault(e["a"], []).append(e["de"])
            herramientas.append((e["de"], e["a"]))
            if origen["kind"] != "agent":
                add("herramienta-de-no-agente", f"{e['id']}: el padre {e['de']} es {origen['kind']}")
        else:
            seq_toca.update((e["de"], e["a"]))
            seq_entra.add(e["a"])
            pasos.append((e["de"], e["a"]))
    for id_, quienes in padres.items():
        if len(quienes) > 1:
            add("herramienta-con-varios-padres", id_)
        if por_id[id_]["kind"] == "agent":
            if id_ in seq_entra:
                add("ayudante-con-paso-entrante", f"{id_} conversa con otra IA y además le llega un paso")
        elif id_ in seq_toca:
            add("herramienta-y-paso", f"{id_} es herramienta y además toca una conexión de pasos")

    # ---- sin círculos
    ids = [n["id"] for n in nodos]
    if _hay_ciclo(ids, _adyacencia(pasos)):
        add("ciclo-de-pasos", "hay un círculo de pasos")
    if _hay_ciclo(ids, _adyacencia(herramientas)):
        add("ciclo-de-herramientas", "hay un círculo de herramientas")
    if _hay_ciclo(ids, _adyacencia(pasos + herramientas)):
        add("ciclo-mixto", "hay un círculo entre pasos y herramientas")

    # ---- topes (0 disparadores es válido)
    def cuantos(kind: str) -> int:
        return sum(1 for n in nodos if n["kind"] == kind)
    if cuantos("trigger") > TOPE_DISPARADORES:
        add("varios-disparadores", f"{cuantos('trigger')} disparadores")
    if cuantos("agent") > TOPE_AGENTES:
        add("tope-agentes", f"{cuantos('agent')} agentes (hasta {TOPE_AGENTES})")
    if cuantos("app") > TOPE_APPS:
        add("tope-apps", f"{cuantos('app')} apps (hasta {TOPE_APPS})")

    # ---- dónde está cada cuadro
    def numero(v: object) -> bool:
        return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)
    for n in nodos:
        x, y = n.get("x"), n.get("y")
        if not (numero(x) and numero(y)):
            add("caja-no-finita", f"{n['id']} {x!s},{y!s}")
        elif not (0 <= x <= LIENZO_MAX and 0 <= y <= LIENZO_MAX):
            add("caja-fuera-del-lienzo", f"{n['id']} {x},{y}")
    return problemas


def _muestra(m: dict) -> Muestra:
    try:
        id_, estado = m["id"], m["estado"]
        if not isinstance(id_, str) or not _ID_MUESTRA.fullmatch(id_):
            raise MuestrasInvalidas(f"id de muestra inválido: {id_!r}")
        if estado not in ESTADOS_MUESTRA:
            raise MuestrasInvalidas(f"{id_}: estado desconocido {estado!r}")
        claves = tuple(norm(c) for c in m.get("claves") or [])
        if any(not c for c in claves):
            raise MuestrasInvalidas(f"{id_}: tiene una clave vacía (casaría con todo)")
        por_omision = m.get("por_omision") is True
        if estado == "sin_cobertura":
            faltan = tuple(str(x)[:MAX_FALTAN_CHARS] for x in m.get("faltan") or [])[:MAX_FALTAN]
            if not faltan or m.get("flujo") is not None:
                raise MuestrasInvalidas(f"{id_}: una sin_cobertura lleva `faltan` y no lleva flujo")
            if por_omision:
                raise MuestrasInvalidas(f"{id_}: la muestra por omisión tiene que ser un flujo")
            return Muestra(id_, estado, claves, False, "", None, None, faltan, (), (), ())
        flujo, resumen = m.get("flujo"), m.get("resumen")
        if not isinstance(flujo, dict) or not isinstance(resumen, str) or not resumen.strip():
            raise MuestrasInvalidas(f"{id_}: un «listo» lleva flujo y resumen")
        # lo mismo que pasa el generador real antes de entregar: si no valida, no sale
        r = validador.validar(flujo)
        if not r.ok:
            raise MuestrasInvalidas(f"{id_}: el flujo no pasa el validador: {'; '.join(r.errores)[:300]}")
        grafo = m.get("grafo")
        if grafo is not None:
            _revisar_grafo(id_, grafo, flujo)
        nodos = tuple({"tipo": n["type"], "nombre": nombre_de_nodo(n["type"]),
                       "etiqueta": etiqueta_de_nodo(n["type"]),
                       "nombre_en_flujo": str(n["name"])[:MAX_NOMBRE_NODO]} for n in flujo["nodes"])
        return Muestra(id_, estado, claves, por_omision, resumen.strip(), flujo, grafo, (), nodos,
                       tuple(pendientes_de(flujo)), tuple(advertencias_de(flujo, r.advertencias)))
    except MuestrasInvalidas:
        raise
    except (KeyError, TypeError, AttributeError) as err:
        raise MuestrasInvalidas(f"muestra mal formada ({type(err).__name__})") from None


def _revisar_grafo(id_: str, grafo: object, flujo: dict) -> None:
    """El `grafo` de una muestra «listo» tiene que ser un flujo del Constructor válido, del mismo flujo y sin
    nada que parezca una clave. Falla cerrado: antes solo se pedían las llaves `nodes`, `edges` y `nombreFlujo`
    y los invariantes dependían de una prueba que se omite donde no hay node."""
    if not (isinstance(grafo, dict) and {"nodes", "edges", "nombreFlujo"} <= set(grafo)):
        raise MuestrasInvalidas(f"{id_}: el grafo lleva nodes, edges y nombreFlujo")
    if grafo["nombreFlujo"] != flujo.get("name"):
        raise MuestrasInvalidas(f"{id_}: el grafo y el flujo no se llaman igual")
    problemas = invariantes_del_grafo(grafo)
    if problemas:
        raise MuestrasInvalidas(f"{id_}: el grafo no cumple los invariantes del Constructor: "
                                f"{'; '.join(problemas)[:300]}")
    if not sin_clave(json.dumps(grafo, ensure_ascii=False)):
        raise MuestrasInvalidas(f"{id_}: el grafo lleva algo que parece una clave")


def cargar_muestras(ruta: Path | str = RUTA_MUESTRAS) -> tuple[Muestra, ...]:
    """Lee, valida y ordena las muestras de un archivo. Falla CERRADO: cualquier problema es
    `MuestrasInvalidas`, nunca una muestra a medias."""
    try:
        doc = json.loads(Path(ruta).read_text(encoding="utf-8"))
        crudas = doc["muestras"]
        if not isinstance(crudas, list) or not crudas:
            raise MuestrasInvalidas("no hay muestras")
    except MuestrasInvalidas:
        raise
    except (OSError, ValueError, KeyError, TypeError) as err:
        raise MuestrasInvalidas(f"no se pudo leer {Path(ruta).name} ({type(err).__name__})") from None
    muestras = tuple(_muestra(m) for m in crudas)
    ids = [m.id for m in muestras]
    if len(set(ids)) != len(ids):
        raise MuestrasInvalidas("hay ids de muestra repetidos")
    if sum(m.por_omision for m in muestras) != 1:
        raise MuestrasInvalidas("tiene que haber exactamente una muestra por omisión")
    return muestras


@lru_cache(maxsize=1)
def muestras() -> tuple[Muestra, ...]:
    """Las muestras del repo, leídas una vez por proceso."""
    return cargar_muestras()


def elegir(texto: str, lista: tuple[Muestra, ...] | None = None) -> Muestra:
    """La primera muestra cuya lista de `claves` tenga una subcadena del pedido (sin acentos ni
    mayúsculas); si ninguna, la que lleva `por_omision`."""
    lista = muestras() if lista is None else lista
    t = norm(texto)
    for m in lista:
        if any(c in t for c in m.claves):
            return m
    return next(m for m in lista if m.por_omision)


# ---------------------------------------------------------------------------
# el reloj y el id

PASOS = ("entender", "buscar", "armar", "revisar")     # == db.PASOS_AUTOMATIZA (lo fija una prueba)
PAUSA_PRUEBA_SEG = 1.2                                  # 4 pasos = 4.8 s: caben antes del primer sondeo web (5 s)
PAUSA_MS = 1200
DURACION_MS = PAUSA_MS * len(PASOS)
VIGENCIA_ID_SEG = 3600
HOLGURA_RELOJ_SEG = 60
PREFIJO_ID = "p1."
ID_MAX = 120
_ALFABETO_B64 = re.compile(r"[A-Za-z0-9_-]+")
_HASH_USUARIO = re.compile(r"[0-9a-f]{12}")               # lo que devuelve `hash_usuario`
_LLAVES_ID = {"u", "t", "m"}


def reloj() -> float:
    """Segundos de época. Las pruebas reemplazan esta función."""
    return time.time()


def _ms(ahora: float) -> int:
    return int(round(ahora * 1000))


def _b64(crudo: bytes) -> str:
    return base64.urlsafe_b64encode(crudo).rstrip(b"=").decode("ascii")


def _canonico(carga: dict) -> str:
    return _b64(json.dumps(carga, separators=(",", ":"), sort_keys=True).encode("ascii"))


def hash_usuario(usuario: str) -> str:
    # surrogatepass: un `sub` con un sustituto suelto no debe reventar (nunca debería llegar, pero es gratis)
    return hashlib.sha256(str(usuario).encode("utf-8", "surrogatepass")).hexdigest()[:12]


def crear_id(usuario: str, muestra_id: str, ahora: float) -> str:
    return PREFIJO_ID + _canonico({"u": hash_usuario(usuario), "t": _ms(ahora), "m": muestra_id})


def leer_id(id_: object, usuario: str, ahora: float,
            lista: tuple[Muestra, ...] | None = None) -> tuple[Muestra, int]:
    """`(muestra, t_ms)` de un id propio y vigente. Cualquier otra cosa —mal formado, de otra persona,
    futuro, caducado, de una muestra que no existe— es `ErrorAsistente("no_encontrada")`, sin distinguir
    el motivo."""
    no = ErrorAsistente("no_encontrada")
    if not (isinstance(id_, str) and id_.startswith(PREFIJO_ID) and len(id_) <= ID_MAX):
        raise no
    cuerpo = id_[len(PREFIJO_ID):]
    if not _ALFABETO_B64.fullmatch(cuerpo):
        raise no
    try:
        carga = json.loads(base64.urlsafe_b64decode(cuerpo + "=" * (-len(cuerpo) % 4)).decode("ascii"))
    except (binascii.Error, ValueError):          # base64 roto, no ASCII o JSON roto
        raise no from None
    if not (isinstance(carga, dict) and set(carga) == _LLAVES_ID):
        raise no
    u, t, m = carga["u"], carga["t"], carga["m"]
    if not (isinstance(u, str) and isinstance(m, str) and isinstance(t, int) and not isinstance(t, bool)):
        raise no
    if _canonico(carga) != cuerpo:                # una sola forma de escribir cada id
        raise no
    # `u` y `m` son ASCII por construcción: un sustituto suelto (`"\\ud800"` escrito como escape en el JSON, que
    # pasa la verificación canónica) ya no llega al compare_digest, que reventaba con UnicodeEncodeError (500)
    if not (_HASH_USUARIO.fullmatch(u) and _ID_MUESTRA.fullmatch(m)):
        raise no
    if not hmac.compare_digest(u, hash_usuario(usuario)):
        raise no
    antes = _ms(ahora) - t
    if not -HOLGURA_RELOJ_SEG * 1000 <= antes <= VIGENCIA_ID_SEG * 1000:
        raise no
    lista = muestras() if lista is None else lista
    muestra = next((x for x in lista if x.id == m), None)
    if muestra is None:
        raise no
    return muestra, t


# ---------------------------------------------------------------------------
# lo que ve la persona

# Las únicas llaves que puede tener cada respuesta de `GET /api/automatiza/armar/{id}`: nunca se
# serializa una fila ni un resultado crudo. `uso`, `modelo`, `fuentes`, `intentos`, `costo_usd`, el texto
# del pedido y la IP no viajan jamás. En el modo real, `listo` suma además `costo_creditos`.
LLAVES_BASE = ("id", "estado", "listo", "modo", "lleva_seg")
LLAVES_POR_ESTADO: dict[str, tuple[str, ...]] = {
    "en_fila": ("lugar",),
    "armando": ("paso",),
    "listo": ("nombre", "resumen", "nodos", "pendientes", "advertencias", "flujo", "grafo"),
    "sin_cobertura": ("mensaje", "faltan"),
    "no_salio": ("mensaje",),
    "rechazada": ("mensaje",),
}


def vista(muestra: Muestra, id_: str, transcurrido_ms: int) -> dict:
    """El cuerpo de `GET /api/automatiza/armar/{id}` para una muestra a `transcurrido_ms` de haber
    empezado. Antes de los 4.8 s es «armando» con su paso; después, el final de la muestra.

    `resumen`, `faltan` y `advertencias` (texto libre del modelo en el modo real) pasan por
    `validador.SECRETOS` antes de salir: si alguno parece una clave, ese campo se omite. `grafo` solo
    viaja si la muestra lo trae (las tres del mockup)."""
    ms = max(0, int(transcurrido_ms))
    armando = ms < DURACION_MS
    estado = "armando" if armando else muestra.estado
    cuerpo: dict[str, Any] = {"id": id_, "estado": estado, "listo": estado == "listo", "modo": PRUEBA,
                              "lleva_seg": min(ms, DURACION_MS) // 1000}
    if armando:
        cuerpo["paso"] = PASOS[ms // PAUSA_MS]
        return cuerpo
    if muestra.estado == "sin_cobertura":
        cuerpo["mensaje"] = MENSAJES["sin_cobertura"]
        if all(sin_clave(x) for x in muestra.faltan):
            cuerpo["faltan"] = list(muestra.faltan)
        return cuerpo
    cuerpo["nombre"] = muestra.flujo["name"]                  # type: ignore[index]
    if sin_clave(muestra.resumen):
        cuerpo["resumen"] = muestra.resumen
    cuerpo["nodos"] = [dict(n) for n in muestra.nodos]
    cuerpo["pendientes"] = list(muestra.pendientes)
    if all(sin_clave(x) for x in muestra.advertencias):
        cuerpo["advertencias"] = list(muestra.advertencias)
    cuerpo["flujo"] = copy.deepcopy(muestra.flujo)
    if muestra.grafo is not None:
        cuerpo["grafo"] = copy.deepcopy(muestra.grafo)
    return cuerpo


@dataclass(frozen=True)
class Inicio:
    id: str
    muestra: str          # la clave de la muestra (lo único del pedido que se registra, con `chars`)
    chars: int
    cuerpo: dict          # el cuerpo del 202


def iniciar(texto: str, usuario: str, ahora: float | None = None) -> Inicio:
    """Atiende un pedido: valida el texto, elige la muestra y arma el id. No guarda nada: el texto se
    descarta aquí mismo."""
    texto = revisar_texto(texto)
    ahora = reloj() if ahora is None else ahora
    muestra = elegir(texto)
    id_ = crear_id(usuario, muestra.id, ahora)
    return Inicio(id_, muestra.id, len(texto),
                  {"id": id_, "estado": "armando", "modo": PRUEBA, "paso": PASOS[0],
                   "costo_creditos": 0})


def consultar(id_: object, usuario: str, ahora: float | None = None) -> dict:
    """El cuerpo de `GET /api/automatiza/armar/{id}`, derivado del reloj. `ErrorAsistente("no_encontrada")`
    si el id no es propio y vigente."""
    ahora = reloj() if ahora is None else ahora
    muestra, t = leer_id(id_, usuario, ahora)
    return vista(muestra, id_, _ms(ahora) - t)               # type: ignore[arg-type]

