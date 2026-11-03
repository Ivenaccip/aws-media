"""Paridad TypeScript <-> Python del Constructor de automatizaciones (M4b, informe 06 §4-§5).

El Constructor (navegador) exporta un `.json` para n8n y trae su propio catálogo, una tabla escrita a mano en
`web/src/pantallas/constructor/modelo/catalogo.ts`. La verdad sobre lo que n8n ofrece y lo que el repo permite vive
en `media/library/n8n/catalog.json` y `permitidos.json`, y el que decide si un flujo se puede entregar es
`pipeline/validador.py`. Esta prueba es la única defensa contra la deriva entre esas dos mitades.

Las mitades se hablan por JSON, nunca por código:

    golden/catalogo-usado.json   lo que el catálogo de TypeScript usa de n8n (type, typeVersion, credencial,
                                 modelo) y los ocho patrones de claves. Lo escribe y lo vigila vitest
                                 (catalogo.paridad.test.ts): si alguien toca la tabla de TypeScript sin
                                 regenerarlo, falla allá.
    golden/flujos.json           los 40 casos del exportador (34 archivos de n8n y 6 rechazos). Lo escribe y lo
                                 vigila vitest (exportar.golden.test.ts).

Este archivo SOLO lee esos dos JSON (Python nunca parsea TypeScript) y verifica:

    1. cada type / typeVersion / credencial del Constructor existe en catalog.json, no está oculto, es la versión por
       defecto y está en permitidos.json (salvo AI Agent Tool, decisión D4 del plan, documentada abajo);
    2. cada flujo del golden pasa pipeline/validador.py con los permitidos de hoy; los que usan agentTool se
       verifican en dos variantes: rechazo esperado hoy, y válidos con agentTool permitido en una copia EN MEMORIA
       de permitidos (el archivo real no se toca);
    3. los patrones de claves de secretos.ts equivalen a validador.SECRETOS (compara fuentes y, además,
       el veredicto sobre una lista de sondas), con las divergencias entre motores declaradas una por una. TypeScript
       va por delante de Python en dos cosas (límite de palabra en `sk-` y `gh[pousr]_`, y ocho formatos de clave
       nuevos): está declarado en `PYTHON_ATRASADO`, y la prueba falla cuando Python se pone al día, para borrar la
       excepción;
    4. las mutaciones del catálogo hacen fallar la prueba. Cada mutación se aplica a una copia en memoria y las
       pruebas del final demuestran QUÉ capa la nota;
    5. vitest NO lee nada de fuera de web/ (la etapa `web` del Dockerfile solo copia web/): lo que necesita saber de
       media/library/n8n lo lee de golden/n8n-referencia.json, que escribe ESTA prueba y que esta prueba vigila contra
       los archivos reales; y un guardián revisa que ningún archivo de vitest del modelo salga de web/.

Para regenerar el JSON (a propósito, nunca en silencio):
    cd web && ACTUALIZAR_DORADO=1 npx vitest run src/pantallas/constructor/modelo/catalogo.paridad.test.ts
y, si cambió catalog.json o permitidos.json, desde la raíz (después de lo anterior):
    ACTUALIZAR_DORADO=1 ./venv/bin/python -m pytest tests/test_constructor_paridad.py -p no:cacheprovider -k referencia
Para correr esta prueba (desde la raíz del repo):
    ./venv/bin/python -m pytest tests/test_constructor_paridad.py -p no:cacheprovider
"""
from __future__ import annotations

import copy
import hashlib
import json
import os
import re
import sys
from pathlib import Path

import pytest

from pipeline import n8n_catalogo as nc
from pipeline import validador

RAIZ = Path(__file__).resolve().parent.parent
GOLDEN = RAIZ / "web" / "src" / "pantallas" / "constructor" / "modelo" / "golden"
RUTA_TABLA = GOLDEN / "catalogo-usado.json"
RUTA_FLUJOS = GOLDEN / "flujos.json"
RUTA_REFERENCIA = GOLDEN / "n8n-referencia.json"
MODELO = GOLDEN.parent

B, L = "n8n-nodes-base.", "@n8n/n8n-nodes-langchain."
AGENT_TOOL = L + "agentTool"

# DECISIÓN DEL DUEÑO (plan D4, informe 06 §3): ¿AI Agent Tool entra a permitidos.json? Hoy NO. El Constructor lo
# exporta («dos IA que conversan»), así que el validador rechaza esos 5 flujos y SOLO por eso. Si el dueño lo
# permite, `test_agent_tool_esta_como_se_decidio` falla a propósito: pon esto en True, quita la excepción de
# catalogo.test.ts («el_ayudante_agent_tool_aun_no_esta_permitido…») y sigue el cambio completo de §3.2 del informe
# (entrada en permitidos.json, conteos de test_rag_catalogo_n8n.py, casos en test_rag_validador.py).
AGENT_TOOL_PERMITIDO = False

# Versiones FIJAS a propósito (los parámetros que manda el Constructor dependen de la versión). Si el catálogo se
# regeneró y n8n subió la versión por defecto de un nodo: revisa sus parámetros y sube la fija en datos/, o anótalo
# aquí con el motivo (tipo -> por qué se queda en la vieja). Vacío hoy.
DERIVA_ACEPTADA: dict[str, str] = {}

# Disparadores permitidos que el Constructor NO ofrece, y por qué. Si se permite uno nuevo, esta prueba falla
# hasta que alguien decida si se ofrece (fila nueva en datos/disparadoresN8n.ts) o se anota aquí.
DISPARADORES_NO_OFRECIDOS = {
    B + "manualTrigger": "arranca a mano desde el editor de n8n: no tiene sentido en un flujo que se importa",
    B + "formTrigger": "pide armar los campos del formulario, algo que el lienzo no sabe describir todavía",
}

# Lo único que el validador dice sobre los flujos del Constructor aun cuando son válidos.
AVISOS_DEL_VALIDADOR = ("no está conectado a nada",)

# Divergencias conocidas entre el motor de expresiones de JavaScript (secretos.ts) y el de Python (validador.py):
# sonda -> lo que dice PYTHON (los índices de SECRETOS que la reconocen). TypeScript dice lo que quedó en el JSON.
#   · `\d` y `\b` son Unicode en Python (str) y ASCII en JavaScript.
#   · Dígitos árabes en el token de Telegram: Python lo reconoce, JavaScript no (Python es más estricto: el
#     validador podría rechazar un archivo que el Constructor dejó pasar).
#   · AKIA… pegada a una letra acentuada: JavaScript lo reconoce (la «ñ» no es de palabra), Python no
#     (Python es más laxo: el validador no vería una clave de AWS pegada a una «ñ»).
# Cuál es la salida (p. ej. `re.ASCII` en esos dos patrones, cuidando que bearer conserve su `\s` Unicode) es del
# dueño de pipeline/validador.py. Si alguna deja de divergir, esta prueba lo dice para borrarla de aquí.
DIVERGENCIAS_DE_SECRETOS = {
    "telegram_con_digitos_arabes": [4],
    "aws_junto_a_una_letra_acentuada": [],
    "aws_seguida_de_una_letra_acentuada": [],
    # TypeScript va por delante de Python (ver PYTHON_ATRASADO): el límite de palabra delante de `sk-` y `gh[pousr]_`.
    # Python, sin él, toma por clave una palabra normal que lleva «sk-» dentro («task-…», «risk-…») y rechazaría un
    # archivo que el Constructor deja bajar. Se borran de aquí cuando Python se ponga al día.
    "sk_dentro_de_una_palabra_task": [0],
    "sk_dentro_de_una_palabra_risk": [0],
    "sk_dentro_de_una_url_de_notion": [0],
    "github_pegada_a_una_letra": [3],
}

# TypeScript va por delante de Python en las claves (hallazgos Q2 y H-04 de la revisión del motor). Quien manda sobre
# pipeline/validador.py es el dueño de ese archivo: mientras no lo actualice, estas son TODAS las diferencias, y la prueba
# `test_la_excepcion_de_python_atrasado_se_borra_cuando_python_se_pone_al_dia` falla el día que Python las adopte.
# Para ponerse al día, validador.SECRETOS debe quedar con estas 16 fuentes, en este orden, y con `(?i)` solo en bearer.
PYTHON_ATRASADO = True
# índice -> la fuente de TypeScript, donde difiere de la de Python (el límite de palabra)
REFORMAS_TS = {
    0: r"\bsk-[A-Za-z0-9_-]{20,}",
    3: r"\bgh[pousr]_[A-Za-z0-9]{30,}",
}
# los patrones que Python no tiene (índices 8 a 15): Notion ×2, Airtable, WhatsApp/Meta, Slack de aplicación,
# GitHub de grano fino, Stripe, SendGrid
EXTRAS_TS = (
    r"\bntn_[A-Za-z0-9]{30,}",
    r"\bsecret_[A-Za-z0-9]{40,}",
    r"\bpat[A-Za-z0-9]{14}\.[0-9a-f]{64}",
    r"\bEAA[A-Za-z0-9]{40,}",
    r"\bxapp-\d-[A-Za-z0-9-]{20,}",
    r"\bgithub_pat_[A-Za-z0-9_]{50,}",
    r"\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}",
    r"\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}",
)


def _leer(ruta: Path) -> dict:
    if not ruta.is_file():
        raise FileNotFoundError(
            f"falta {ruta.relative_to(RAIZ)}: lo escribe vitest (cd web && ACTUALIZAR_DORADO=1 npx vitest run "
            f"src/pantallas/constructor/modelo/)")
    return json.loads(ruta.read_text(encoding="utf-8"))


TABLA = _leer(RUTA_TABLA)
FLUJOS = _leer(RUTA_FLUJOS)
CASOS: dict[str, dict] = FLUJOS["casos"]
CON_ARCHIVO = [n for n, c in CASOS.items() if c["flujo"] is not None]


def _vacio(problemas: list[str]) -> None:
    """Falla con TODOS los problemas, uno por línea (el diff de pytest recorta las listas largas)."""
    assert not problemas, "\n" + "\n".join(f"  - {p}" for p in problemas)


def _usa(flujo: dict, tipo: str) -> list[dict]:
    return [n for n in flujo["nodes"] if n["type"] == tipo]


def _caso_con(tipo: str) -> tuple[str, dict]:
    """El primer flujo del golden que lleva un nodo de ese `type`."""
    for nombre in CON_ARCHIVO:
        if _usa(CASOS[nombre]["flujo"], tipo):
            return nombre, CASOS[nombre]["flujo"]
    raise AssertionError(f"ningún flujo del golden usa {tipo}")


@pytest.fixture(scope="module", autouse=True)
def _no_toca_el_repo():
    """Ninguna mutación llega a un archivo: todo ocurre en copias en memoria. Si algo escribiera en los datos de
    n8n o en el golden, esta prueba lo dice al terminar el módulo."""
    reales = (nc.RUTA_CATALOGO, nc.RUTA_PERMITIDOS, RUTA_TABLA, RUTA_FLUJOS)
    antes = {p: hashlib.sha256(p.read_bytes()).hexdigest() for p in reales}
    yield
    despues = {p: hashlib.sha256(p.read_bytes()).hexdigest() for p in reales}
    cambiados = [str(p.relative_to(RAIZ)) for p in reales if antes[p] != despues[p]]
    assert not cambiados, f"las pruebas de paridad tocaron archivos reales: {cambiados}"


# ---------------------------------------------------------------------------------------------------------------
# Lo que la tabla del Constructor usa de n8n (cada fila es un nodo que el archivo exportado puede llevar)
# ---------------------------------------------------------------------------------------------------------------

def _filas(tabla: dict):
    """(que, tipo, typeVersion, credencial | None, ¿es la variante de herramienta?). 22 base + 11 variantes Tool."""
    for a in tabla["apps"]:
        yield f"app {a['nombre']}", a["tipo"], a["typeVersion"], a["credencial"], False
        yield f"app {a['nombre']} como herramienta", a["tipoHerramienta"], a["typeVersion"], a["credencial"], True
    for i in tabla["ias"]:
        yield f"ia {i['id']}", i["tipo"], i["typeVersion"], i["credencial"], False
    for d in tabla["disparadores"]:
        yield f"disparador {d['nombreBase']}", d["tipo"], d["typeVersion"], d["credencial"], False
    yield "agente", tabla["agente"]["tipo"], tabla["agente"]["typeVersion"], None, False
    yield "ayudante (agentTool)", tabla["ayudante"]["tipo"], tabla["ayudante"]["typeVersion"], None, False
    o = tabla["otraApp"]
    yield "otra app (HTTP Request)", o["tipo"], o["typeVersion"], None, False
    yield "otra app como herramienta", o["tipoHerramienta"], o["typeVersion"], None, True


def _existencia(tabla: dict) -> list[str]:
    """Cada fila existe en catalog.json, no está oculta, tiene esa versión, la credencial es del nodo y, si es
    herramienta, el nodo base sirve como herramienta."""
    cat = nc.catalogo()
    problemas = []
    for que, tipo, version, cred, herramienta in _filas(tabla):
        raiz, _ = nc.base(tipo)
        if raiz is None:
            # una variante Tool existe mientras exista su nodo base y siga sirviendo como herramienta
            base_existe = herramienta and nc.base(tipo.removesuffix("Tool"))[0] is not None
            motivo = "ya no se ofrece como herramienta" if base_existe else "no existe"
            problemas.append(f"{que}: {tipo} {motivo} en n8n {cat['procedencia']['n8n']}")
            continue
        nodo = cat["nodos"][raiz]
        if nodo["oculto"]:
            problemas.append(f"{que}: n8n ya no ofrece {nodo['nombre']} (oculto)")
        if version not in nodo["versiones"]:
            problemas.append(f"{que}: {nodo['nombre']} no tiene la versión {version} (válidas: {nodo['versiones']})")
        if cred is not None:
            if cred["clave"] not in {c["nombre"] for c in nodo["credenciales"]}:
                problemas.append(f"{que}: {cred['clave']} ya no es una credencial de {nodo['nombre']}")
            if cred["clave"] not in cat["credenciales"]:
                problemas.append(f"{que}: {cred['clave']} no está en el diccionario de credenciales del catálogo")
    return problemas


def _permisos(tabla: dict) -> list[str]:
    """Cada fila está en permitidos.json (la variante Tool, por su nodo base). AI Agent Tool es la excepción
    documentada mientras `AGENT_TOOL_PERMITIDO` sea False."""
    permitidos = nc.permitidos()
    problemas = []
    for que, tipo, _version, _cred, _herramienta in _filas(tabla):
        raiz, _ = nc.base(tipo)
        if raiz is None or raiz in permitidos:
            continue
        if raiz == AGENT_TOOL and not AGENT_TOOL_PERMITIDO:
            continue
        problemas.append(f"{que}: {raiz} dejó de estar en permitidos.json")
    return problemas


def _version_por_defecto(tabla: dict) -> list[str]:
    nodos = nc.catalogo()["nodos"]
    problemas = []
    for que, tipo, version, _cred, _herramienta in _filas(tabla):
        raiz, _ = nc.base(tipo)
        if raiz is None:
            continue
        por_defecto = nodos[raiz]["version_por_defecto"]
        if version != por_defecto and raiz not in DERIVA_ACEPTADA:
            problemas.append(f"{que}: el Constructor fija {version} y n8n ya va en {por_defecto}")
        if version == por_defecto and raiz in DERIVA_ACEPTADA:
            problemas.append(f"{que}: ya no hay deriva en {raiz}: quítalo de DERIVA_ACEPTADA")
    return problemas


def _menu(tabla: dict) -> list[str]:
    """El menú del Constructor cubre EXACTAMENTE las apps y los modelos de chat permitidos, y los disparadores
    permitidos que no ofrece están documentados."""
    permitidos = nc.permitidos()
    problemas = []
    en_el_menu = {a["tipo"] for a in tabla["apps"]}
    permitidas = {t for t, n in permitidos.items() if n["funcion"] == "apps"}
    for t in sorted(permitidas - en_el_menu):
        problemas.append(f"{t} es una app permitida y falta en el menú de apps del Constructor")
    for t in sorted(en_el_menu - permitidas):
        problemas.append(f"{t} está en el menú de apps del Constructor y no es una app permitida")

    ofrecidas = {i["tipo"] for i in tabla["ias"]}
    permitidas_ia = {t for t in permitidos if t.startswith(L + "lmChat")}
    for t in sorted(permitidas_ia - ofrecidas):
        problemas.append(f"{t} es un modelo de chat permitido y falta entre las IA del Constructor")
    for t in sorted(ofrecidas - permitidas_ia):
        problemas.append(f"{t} está entre las IA del Constructor y no es un modelo de chat permitido")

    ofrecidos = {d["tipo"] for d in tabla["disparadores"]}
    permitidos_disp = {t for t, n in permitidos.items() if n["funcion"] == "disparador"}
    sin_ofrecer = permitidos_disp - ofrecidos
    for t in sorted(sin_ofrecer - set(DISPARADORES_NO_OFRECIDOS)):
        problemas.append(f"{t} es un disparador permitido que el Constructor no ofrece ni documenta: "
                         "decide si se ofrece o anótalo en DISPARADORES_NO_OFRECIDOS")
    for t in sorted(set(DISPARADORES_NO_OFRECIDOS) - sin_ofrecer):
        problemas.append(f"{t} ya no es un disparador permitido sin ofrecer: quítalo de DISPARADORES_NO_OFRECIDOS")
    return problemas


def _modelo(tabla: dict) -> list[str]:
    """El único modelo que el Constructor fija es el que sugiere el repo (permitidos.json -> llm); ninguna otra IA
    inventa uno (el mockup traía `claude-haiku-5-5`, que no tiene fuente)."""
    llm = nc.llm()
    problemas = []
    for i in tabla["ias"]:
        if i["modelo"] is None:
            if i["tipo"] == llm["nodo"]:
                problemas.append(f"la IA {i['id']} es la que sugiere permitidos.json y no fija modelo")
            continue
        if i["tipo"] != llm["nodo"]:
            problemas.append(f"la IA {i['id']} fija el modelo «{i['modelo']}», que no sale de permitidos.json")
        elif i["modelo"] != llm["modelo"]:
            problemas.append(f"la IA {i['id']} fija «{i['modelo']}» y permitidos.json sugiere «{llm['modelo']}»")
    openai = [i for i in tabla["ias"] if i["id"] == "openai"]
    if not openai or openai[0]["tipo"] != llm["nodo"]:
        problemas.append(f"el nodo que sugiere permitidos.json ({llm['nodo']}) no es el de OpenAI del Constructor")
    return problemas


def _agent_tool(_tabla: dict) -> list[str]:
    en_permitidos = AGENT_TOOL in nc.permitidos()
    if en_permitidos and not AGENT_TOOL_PERMITIDO:
        return ["AI Agent Tool ya está en permitidos.json: pon AGENT_TOOL_PERMITIDO = True en esta prueba y quita la "
                "excepción D4 de catalogo.test.ts (informe 06 §3.2)"]
    if not en_permitidos and AGENT_TOOL_PERMITIDO:
        return ["AGENT_TOOL_PERMITIDO es True y AI Agent Tool ya no está en permitidos.json"]
    return []


def problemas_de_catalogo(tabla: dict) -> list[str]:
    """TODO lo que está mal entre la tabla del Constructor y el catálogo de n8n / los permitidos del repo."""
    return (_existencia(tabla) + _permisos(tabla) + _version_por_defecto(tabla) + _menu(tabla)
            + _modelo(tabla) + _agent_tool(tabla))


# ---------------------------------------------------------------------------------------------------------------
# Los flujos del golden contra el validador, y contra la tabla
# ---------------------------------------------------------------------------------------------------------------

def problemas_de_flujo(nombre: str, flujo: dict) -> list[str]:
    """Lo que el validador debe decir HOY de un flujo del golden: válido, salvo los que llevan agentTool, que se
    rechazan por eso y por nada más."""
    r = validador.validar(flujo)
    usa = _usa(flujo, AGENT_TOOL)
    if usa and not AGENT_TOOL_PERMITIDO:
        nombre_nodo = nc.catalogo()["nodos"].get(AGENT_TOOL, {}).get("nombre", AGENT_TOOL)
        esperado = sorted(f"nodo «{n['name']}»: Este nodo aún no lo soportamos: {nombre_nodo}." for n in usa)
        if r.ok or sorted(r.errores) != esperado:
            return [f"{nombre}: se esperaba SOLO el rechazo por agentTool {esperado} y el validador dijo "
                    f"ok={r.ok} {r.errores}"]
    elif not r.ok:
        return [f"{nombre}: el validador lo rechaza: {r.errores}"]
    desconocidos = [a for a in r.advertencias if not any(c in a for c in AVISOS_DEL_VALIDADOR)]
    return [f"{nombre}: avisos del validador que no conocemos: {desconocidos}"] if desconocidos else []


def problemas_del_indice(flujos: dict) -> list[str]:
    casos = flujos["casos"]
    con_agent_tool = [n for n, c in casos.items() if c["flujo"] and _usa(c["flujo"], AGENT_TOOL)]
    sin_archivo = [n for n, c in casos.items() if c["flujo"] is None]
    problemas = []
    if flujos["usanAgentTool"] != con_agent_tool:
        problemas.append(f"usanAgentTool dice {flujos['usanAgentTool']} y los flujos con agentTool son {con_agent_tool}")
    if flujos["rechazados"] != sin_archivo:
        problemas.append(f"rechazados dice {flujos['rechazados']} y los casos sin archivo son {sin_archivo}")
    for n, c in casos.items():
        if (c["flujo"] is None) != bool(c["errores"]):
            problemas.append(f"{n}: un caso tiene archivo si y solo si no tiene errores")
        if c["usaAgentTool"] != (n in con_agent_tool):
            problemas.append(f"{n}: usaAgentTool no corresponde a sus nodos")
    return problemas


def problemas_de_cobertura(tabla: dict, casos: dict) -> list[str]:
    """Todo nodo que sale en un archivo exportado está declarado en la tabla (con su versión y SU credencial) y toda
    fila de la tabla sale en algún archivo (si no, el validador nunca la ha visto)."""
    esperados = {(tipo, version): cred for _que, tipo, version, cred, _h in _filas(tabla)}
    vistos = set()
    problemas = []
    for nombre, c in casos.items():
        if c["flujo"] is None:
            continue
        for n in c["flujo"]["nodes"]:
            clave = (n["type"], n["typeVersion"])
            if clave not in esperados:
                problemas.append(f"{nombre}: «{n['name']}» exporta {clave[0]} {clave[1]}, que la tabla no declara")
                continue
            vistos.add(clave)
            esperada = esperados[clave]
            tiene = n.get("credentials") or {}
            if esperada is None:
                if tiene:
                    problemas.append(f"{nombre}: «{n['name']}» lleva credenciales {sorted(tiene)} y la tabla no pide ninguna")
            elif sorted(tiene) != [esperada["clave"]]:
                problemas.append(f"{nombre}: «{n['name']}» lleva {sorted(tiene)} y la tabla pide {esperada['clave']}")
            else:
                ref = tiene[esperada["clave"]]
                if ref.get("name") != esperada["nombre"] or ref.get("id", "") != "":
                    problemas.append(f"{nombre}: la credencial de «{n['name']}» debe ser una referencia vacía "
                                     f"con el nombre «{esperada['nombre']}», y es {ref}")
    for tipo, version in sorted(set(esperados) - vistos):
        problemas.append(f"la tabla declara {tipo} {version} y ningún flujo del golden lo exporta")
    return problemas


# ---------------------------------------------------------------------------------------------------------------
# Claves: los ocho patrones de secretos.ts contra validador.SECRETOS
# ---------------------------------------------------------------------------------------------------------------

def _fuente_de_python(patron) -> tuple[str, bool]:
    fuente = patron.pattern
    ignora = bool(patron.flags & re.IGNORECASE)
    if fuente.startswith("(?i)"):
        fuente = fuente[len("(?i)"):]
    return fuente, ignora


def _texto_de(partes: list) -> str:
    return "".join(texto * veces for texto, veces in partes)


def _coincide_en_python(texto: str) -> list[int]:
    return [i for i, p in enumerate(validador.SECRETOS) if p.search(texto)]


# Las ocho fuentes que validador.SECRETOS tenía el día de la revisión (sin límite de palabra en `sk-` ni en `gh`).
PYTHON_DE_AYER: list[tuple[str, bool]] = [
    (r"sk-[A-Za-z0-9_-]{20,}", False),
    (r"AIza[0-9A-Za-z_-]{35}", False),
    (r"xox[baprs]-[0-9A-Za-z-]{10,}", False),
    (r"gh[pousr]_[A-Za-z0-9]{30,}", False),
    (r"\b\d{8,10}:[A-Za-z0-9_-]{35}\b", False),
    (r"bearer\s+[A-Za-z0-9._~+/-]{20,}", True),
    (r"-----BEGIN [A-Z ]*PRIVATE KEY-----", False),
    (r"\bAKIA[0-9A-Z]{16}\b", False),
]


def _fuentes_de_python() -> list[tuple[str, bool]]:
    return [_fuente_de_python(p) for p in validador.SECRETOS]


def _lo_que_dice_typescript() -> list[tuple[str, bool]]:
    """Los 16 patrones de secretos.ts: los ocho de Python con las reformas declaradas, y los extras."""
    return [(REFORMAS_TS.get(i, fuente), ignora) for i, (fuente, ignora) in enumerate(PYTHON_DE_AYER)] + [
        (extra, False) for extra in EXTRAS_TS]


def _patrones_esperados_en_ts() -> list[tuple[str, bool]]:
    """Lo que debe decir secretos.ts: si Python ya está al día, exactamente lo de Python (mismo orden, misma bandera
    `i`); mientras vaya atrasado, sus diferencias declaradas (`REFORMAS_TS` en el sitio y `EXTRAS_TS` al final)."""
    return _lo_que_dice_typescript() if PYTHON_ATRASADO else _fuentes_de_python()


def _estado_de_python_en_secretos() -> list[str]:
    """Coherencia de `PYTHON_ATRASADO` con lo que Python dice de verdad. Atrasado: validador.SECRETOS sigue siendo
    EXACTAMENTE lo de ayer. Al día: es EXACTAMENTE lo que dice TypeScript."""
    python = _fuentes_de_python()
    if PYTHON_ATRASADO:
        if python == PYTHON_DE_AYER:
            return []
        if python == _lo_que_dice_typescript():
            return ["validador.SECRETOS ya tiene los 16 patrones de secretos.ts: pon PYTHON_ATRASADO = False y borra "
                    "REFORMAS_TS, EXTRAS_TS, PYTHON_DE_AYER y las sondas de DIVERGENCIAS_DE_SECRETOS que dependían de eso"]
        return ["validador.SECRETOS cambió y no es ni lo de ayer ni lo que dice secretos.ts: revisa REFORMAS_TS y "
                "EXTRAS_TS contra pipeline/validador.py"]
    return [] if python == _lo_que_dice_typescript() else ["PYTHON_ATRASADO es False y validador.SECRETOS no es lo de secretos.ts"]


def _patrones_de_secretos(tabla: dict) -> list[str]:
    """Las fuentes de las expresiones, en el mismo orden y con la misma bandera `i`."""
    ts = tabla["secretos"]["patrones"]
    esperados = _patrones_esperados_en_ts()
    problemas = []
    if len(ts) != len(esperados):
        problemas.append(f"secretos.ts tiene {len(ts)} patrones y se esperaban {len(esperados)} "
                         f"({len(validador.SECRETOS)} de validador.SECRETOS"
                         f"{' más las diferencias declaradas de TypeScript' if PYTHON_ATRASADO else ''})")
    for i, (patron_ts, (fuente_esperada, ignora_esperada)) in enumerate(zip(ts, esperados)):
        # en un literal de JavaScript la barra puede ir escapada (`\/`); en Python no hace falta
        fuente_ts = patron_ts["fuente"].replace("\\/", "/")
        if fuente_ts != fuente_esperada:
            problemas.append(f"patrón {i}: secretos.ts «{fuente_ts}» y se esperaba «{fuente_esperada}»")
        if patron_ts["ignoraMayusculas"] != ignora_esperada:
            problemas.append(f"patrón {i}: secretos.ts ignora mayúsculas={patron_ts['ignoraMayusculas']} "
                             f"y se esperaba {ignora_esperada}")
    return problemas


def _sondas_de_secretos(tabla: dict) -> list[str]:
    """El veredicto de Python sobre las sondas. Una sonda en DIVERGENCIAS_DE_SECRETOS debe divergir EXACTAMENTE
    como se declara; las demás, coincidir con TypeScript. Python solo tiene los patrones que tiene: de lo que
    TypeScript dice se mira lo que cae en esos índices (los patrones de más son de `EXTRAS_TS`)."""
    problemas = []
    ids = {s["id"] for s in tabla["secretos"]["sondas"]}
    for sonda_id in sorted(set(DIVERGENCIAS_DE_SECRETOS) - ids):
        problemas.append(f"DIVERGENCIAS_DE_SECRETOS nombra la sonda «{sonda_id}», que ya no existe en el JSON")
    for s in tabla["secretos"]["sondas"]:
        python = _coincide_en_python(_texto_de(s["partes"]))
        ts = [i for i in s["coincide"] if i < len(validador.SECRETOS)]
        if s["id"] in DIVERGENCIAS_DE_SECRETOS:
            if ts == python:
                problemas.append(f"sonda «{s['id']}»: ya no diverge (los dos dicen {python}); "
                                 "bórrala de DIVERGENCIAS_DE_SECRETOS")
            elif python != DIVERGENCIAS_DE_SECRETOS[s["id"]]:
                problemas.append(f"sonda «{s['id']}»: Python dice {python} y se declaró "
                                 f"{DIVERGENCIAS_DE_SECRETOS[s['id']]}")
        elif ts != python:
            problemas.append(f"sonda «{s['id']}»: TypeScript dice {s['coincide']} y Python {python}")
    return problemas


def _familias_solo_de_typescript(tabla: dict) -> list[str]:
    """Cada formato nuevo (índices 8 a 15) lo reconoce su patrón y solo ese; y mientras Python vaya atrasado, Python no
    los conoce (si alguno ya lo conoce, hay que ponerse al día del todo)."""
    sondas = {s["id"]: s for s in tabla["secretos"]["sondas"]}
    problemas = []
    for i, sonda_id in enumerate(FAMILIAS_SOLO_TS, start=len(FAMILIAS_DE_CLAVES)):
        sonda = sondas.get(sonda_id)
        if sonda is None:
            problemas.append(f"el JSON ya no trae la sonda «{sonda_id}»")
            continue
        if sonda["coincide"] != [i]:
            problemas.append(f"sonda «{sonda_id}»: TypeScript dice {sonda['coincide']} y se esperaba [{i}]")
        python = _coincide_en_python(_texto_de(sonda["partes"]))
        if PYTHON_ATRASADO and python:
            problemas.append(f"sonda «{sonda_id}»: Python ya la reconoce ({python}): quita PYTHON_ATRASADO")
    return problemas


def problemas_de_secretos(tabla: dict) -> list[str]:
    return _patrones_de_secretos(tabla) + _sondas_de_secretos(tabla)


# ---------------------------------------------------------------------------------------------------------------
# 1. La tabla contra catalog.json y permitidos.json
# ---------------------------------------------------------------------------------------------------------------

def test_la_tabla_trae_todo_lo_que_el_constructor_exporta():
    assert len(TABLA["apps"]) == 10
    assert [i["id"] for i in TABLA["ias"]] == ["openai", "anthropic", "gemini", "openrouter"]
    assert len(TABLA["disparadores"]) == 5
    assert len(list(_filas(TABLA))) == 33          # 22 filas base + 11 variantes de herramienta


def test_cada_fila_existe_en_el_catalogo_de_n8n_con_su_version_y_su_credencial():
    _vacio(_existencia(TABLA))


def test_cada_fila_esta_en_permitidos_json_salvo_agent_tool():
    _vacio(_permisos(TABLA))


def test_la_tabla_sigue_la_version_por_defecto_de_n8n():
    _vacio(_version_por_defecto(TABLA))


def test_el_menu_del_constructor_cubre_las_apps_y_las_ia_permitidas():
    _vacio(_menu(TABLA))


def test_el_modelo_de_openai_es_el_que_sugiere_permitidos_json_y_ninguna_otra_ia_inventa_uno():
    _vacio(_modelo(TABLA))
    openai = next(i for i in TABLA["ias"] if i["id"] == "openai")
    assert (openai["tipo"], openai["modelo"]) == (nc.llm()["nodo"], nc.llm()["modelo"])
    assert [i["modelo"] for i in TABLA["ias"] if i["id"] != "openai"] == [None, None, None]


def test_agent_tool_esta_como_se_decidio():
    """Semáforo: si falla, alguien tocó permitidos.json. El cambio completo está en el informe 06 §3.2."""
    _vacio(_agent_tool(TABLA))
    assert (AGENT_TOOL in nc.permitidos()) is AGENT_TOOL_PERMITIDO
    assert nc.catalogo()["nodos"][AGENT_TOOL]["oculto"] is False      # existe y n8n lo ofrece: solo falta permitirlo


def test_la_tabla_en_conjunto_no_tiene_problemas_con_el_repo_de_hoy():
    _vacio(problemas_de_catalogo(TABLA))


# ---------------------------------------------------------------------------------------------------------------
# 2. Los flujos del golden contra el validador de Python
# ---------------------------------------------------------------------------------------------------------------

@pytest.fixture
def con_agent_tool_permitido(monkeypatch):
    """Una copia EN MEMORIA de los permitidos con AI Agent Tool. permitidos.json no se toca (el guardián del módulo
    lo comprueba al terminar)."""
    copia = copy.deepcopy(nc.permitidos())
    copia[AGENT_TOOL] = {"tipo": AGENT_TOOL, "nombre": "AI Agent Tool", "nivel": 2, "funcion": "ia",
                         "nota": "copia en memoria de tests/test_constructor_paridad.py"}
    monkeypatch.setattr(nc, "permitidos", lambda: copia)


def test_el_golden_tiene_los_40_casos_y_su_indice_es_coherente():
    assert len(CASOS) == 40
    assert len(CON_ARCHIVO) == 34
    assert FLUJOS["usanAgentTool"] == ["dos_IA_conversan", "conversan_y_luego_un_paso", "conversan_en_cadena",
                                       "una_IA_con_dos_que_conversan", "dos_parejas_en_secuencia"]
    assert len(FLUJOS["rechazados"]) == 6
    _vacio(problemas_del_indice(FLUJOS))


@pytest.mark.parametrize("nombre", CON_ARCHIVO)
def test_el_flujo_pasa_el_validador_con_los_permitidos_de_hoy(nombre):
    _vacio(problemas_de_flujo(nombre, CASOS[nombre]["flujo"]))


@pytest.mark.parametrize("nombre", FLUJOS["usanAgentTool"])
def test_los_flujos_con_agent_tool_se_rechazan_hoy_solo_por_eso(nombre):
    r = validador.validar(CASOS[nombre]["flujo"])
    assert not r.ok
    assert r.errores, "se esperaba el rechazo por agentTool"
    assert all(e.endswith("Este nodo aún no lo soportamos: AI Agent Tool.") for e in r.errores), r.errores


@pytest.mark.parametrize("nombre", CON_ARCHIVO)
def test_el_flujo_es_valido_con_agent_tool_permitido_en_una_copia_en_memoria(nombre, con_agent_tool_permitido):
    assert AGENT_TOOL in nc.permitidos()
    r = validador.validar(CASOS[nombre]["flujo"])
    assert r.ok and r.errores == [], r.errores
    assert all(any(c in a for c in AVISOS_DEL_VALIDADOR) for a in r.advertencias), r.advertencias


def test_la_variante_con_agent_tool_vive_solo_en_memoria():
    assert AGENT_TOOL not in nc.permitidos()         # el monkeypatch de la variante ya se deshizo
    assert AGENT_TOOL not in {n["tipo"] for n in json.loads(nc.RUTA_PERMITIDOS.read_text(encoding="utf-8"))["nodos"]}


def test_todo_nodo_exportado_esta_en_la_tabla_y_toda_fila_de_la_tabla_se_exporta():
    _vacio(problemas_de_cobertura(TABLA, CASOS))


# ---------------------------------------------------------------------------------------------------------------
# 3. Claves
# ---------------------------------------------------------------------------------------------------------------

# Las ocho familias, en el orden de SECRETOS, con el id de su sonda en el JSON (las define catalogo.paridad.test.ts)
FAMILIAS_DE_CLAVES = ("openai_anthropic_openrouter", "google", "slack", "github", "bot_de_telegram", "bearer",
                      "llave_privada", "aws")
# Los ocho formatos que solo conoce TypeScript (índices 8 a 15), con el id de su sonda
FAMILIAS_SOLO_TS = ("notion", "notion_viejo", "airtable", "whatsapp_meta", "slack_aplicacion", "github_grano_fino",
                    "stripe", "sendgrid")
SONDAS = {s["id"]: s for s in TABLA["secretos"]["sondas"]}


def test_los_patrones_de_secretos_ts_son_los_de_validador_secretos_mas_las_diferencias_declaradas():
    assert len(TABLA["secretos"]["patrones"]) == len(_patrones_esperados_en_ts())
    assert len(validador.SECRETOS) == 8 or not PYTHON_ATRASADO
    _vacio(_patrones_de_secretos(TABLA))


def test_la_excepcion_de_python_atrasado_se_borra_cuando_python_se_pone_al_dia():
    _vacio(_estado_de_python_en_secretos())


def test_las_sondas_dan_el_mismo_veredicto_en_python_salvo_las_divergencias_documentadas():
    _vacio(_sondas_de_secretos(TABLA))
    # las divergencias son las que se conocen y ninguna más (se mira lo que Python puede decir: sus propios índices)
    diverge = {i for i, s in SONDAS.items()
               if [j for j in s["coincide"] if j < len(validador.SECRETOS)] != _coincide_en_python(_texto_de(s["partes"]))}
    assert diverge == set(DIVERGENCIAS_DE_SECRETOS)


def test_los_ocho_formatos_nuevos_de_typescript_tienen_su_sonda_y_python_aun_no_los_conoce():
    _vacio(_familias_solo_de_typescript(TABLA))
    assert len(TABLA["secretos"]["patrones"]) == len(FAMILIAS_DE_CLAVES) + len(FAMILIAS_SOLO_TS)


def test_hay_una_sonda_por_cada_familia_y_cada_una_la_reconoce_su_patron():
    for i, sonda_id in enumerate(FAMILIAS_DE_CLAVES):
        assert sonda_id in SONDAS, f"el JSON ya no trae la sonda «{sonda_id}»"
        assert SONDAS[sonda_id]["coincide"] == [i], sonda_id
        assert _coincide_en_python(_texto_de(SONDAS[sonda_id]["partes"])) == [i], sonda_id


@pytest.mark.parametrize("sonda_id", FAMILIAS_DE_CLAVES)
def test_el_validador_rechaza_un_flujo_con_una_clave_de_cada_familia(sonda_id):
    flujo = copy.deepcopy(CASOS["ejemplo"]["flujo"])
    agente = _usa(flujo, L + "agent")[0]
    agente["parameters"].setdefault("options", {})["systemMessage"] = "usa " + _texto_de(SONDAS[sonda_id]["partes"])
    r = validador.validar(flujo)
    assert not r.ok and any("parece una clave" in e for e in r.errores), r.errores


# ---------------------------------------------------------------------------------------------------------------
# 4. Las mutaciones se notan (todo sobre copias en memoria; el guardián del módulo vigila que nada se escriba)
# ---------------------------------------------------------------------------------------------------------------

@pytest.fixture
def mutar(monkeypatch):
    """mutar(f): aplica `f(catalogo, permitidos, llm)` a COPIAS profundas y hace que pipeline.n8n_catalogo (y por lo
    tanto el validador) las lean en lugar del archivo. Todo se deshace al terminar la prueba."""
    def aplicar(mutador):
        cat = copy.deepcopy(nc.catalogo())
        permitidos = copy.deepcopy(nc.permitidos())
        llm = copy.deepcopy(nc.llm())
        mutador(cat, permitidos, llm)
        monkeypatch.setattr(nc, "catalogo", lambda: cat)
        monkeypatch.setattr(nc, "permitidos", lambda: permitidos)
        monkeypatch.setattr(nc, "llm", lambda: llm)
    return aplicar


def _sin_google_sheets_permitido(_cat, permitidos, _llm):
    del permitidos[B + "googleSheets"]


def _gmail_pierde_la_2_2(cat, _permitidos, _llm):
    gmail = cat["nodos"][B + "gmail"]
    gmail["versiones"].remove(2.2)
    gmail["version_por_defecto"] = 2.1


def _se_renombra_la_credencial_de_gmail(cat, _permitidos, _llm):
    for c in cat["nodos"][B + "gmail"]["credenciales"]:
        if c["nombre"] == "gmailOAuth2":
            c["nombre"] = "gmailOAuth2Renombrada"


def _slack_pasa_a_oculto(cat, _permitidos, _llm):
    cat["nodos"][B + "slack"]["oculto"] = True


def _n8n_sube_la_version_por_defecto_de_gmail(cat, _permitidos, _llm):
    gmail = cat["nodos"][B + "gmail"]
    gmail["versiones"].append(2.3)
    gmail["version_por_defecto"] = 2.3


def _se_permite_una_app_nueva(_cat, permitidos, _llm):
    permitidos[B + "hubspot"] = {"tipo": B + "hubspot", "nombre": "HubSpot", "nivel": 2, "funcion": "apps"}


def _se_permite_un_disparador_nuevo(_cat, permitidos, _llm):
    permitidos[B + "errorTrigger"] = {"tipo": B + "errorTrigger", "nombre": "Error Trigger", "nivel": 2,
                                      "funcion": "disparador"}


def _google_sheets_gana_un_obligatorio(cat, _permitidos, _llm):
    cat["nodos"][B + "googleSheets"]["obligatorios"].append("documentId")


def _desaparece_telegram_trigger(cat, _permitidos, _llm):
    del cat["nodos"][B + "telegramTrigger"]


def _el_repo_cambia_el_modelo_sugerido(_cat, _permitidos, llm):
    llm["modelo"] = "gpt-9-mini"


def _gmail_deja_de_servir_como_herramienta(cat, _permitidos, _llm):
    cat["nodos"][B + "gmail"]["como_herramienta"] = False


# id, mutación, (qué dice la TABLA | None = la tabla no lo ve), (tipo de nodo, qué dice el VALIDADOR | None = el
# validador no lo ve y los 34 flujos siguen pasando)
MUTACIONES = [
    pytest.param(_sin_google_sheets_permitido, "Google Sheets: " + B + "googleSheets dejó de estar en permitidos.json",
                 (B + "googleSheets", "Este nodo aún no lo soportamos: Google Sheets."), id="google_sheets_sale_de_permitidos"),
    pytest.param(_gmail_pierde_la_2_2, "Gmail no tiene la versión 2.2",
                 (B + "gmail", "Gmail no tiene la versión 2.2"), id="gmail_pierde_la_version_2_2"),
    pytest.param(_se_renombra_la_credencial_de_gmail, "gmailOAuth2 ya no es una credencial de Gmail",
                 (B + "gmail", "la credencial «gmailOAuth2» no es de este nodo"), id="se_renombra_la_credencial_de_gmail"),
    pytest.param(_slack_pasa_a_oculto, "n8n ya no ofrece Slack (oculto)",
                 (B + "slack", "El nodo Slack ya no se ofrece en n8n"), id="slack_pasa_a_oculto"),
    pytest.param(_desaparece_telegram_trigger, "no existe en n8n",
                 (B + "telegramTrigger", "no existe en n8n"), id="desaparece_un_disparador_del_catalogo"),
    pytest.param(_gmail_deja_de_servir_como_herramienta, "ya no se ofrece como herramienta",
                 (B + "gmailTool", "no existe en n8n"), id="gmail_deja_de_servir_como_herramienta"),
    # solo la tabla lo ve: los 34 flujos siguen siendo válidos
    pytest.param(_n8n_sube_la_version_por_defecto_de_gmail, "el Constructor fija 2.2 y n8n ya va en 2.3", None,
                 id="n8n_sube_la_version_por_defecto_de_gmail"),
    pytest.param(_se_permite_una_app_nueva, "falta en el menú de apps del Constructor", None, id="se_permite_una_app_nueva"),
    pytest.param(_se_permite_un_disparador_nuevo, "no ofrece ni documenta", None, id="se_permite_un_disparador_nuevo"),
    pytest.param(_el_repo_cambia_el_modelo_sugerido, "permitidos.json sugiere «gpt-9-mini»", None,
                 id="el_repo_cambia_el_modelo_sugerido"),
    # solo el validador lo ve: la tabla no lleva parámetros
    pytest.param(_google_sheets_gana_un_obligatorio, None,
                 (B + "googleSheets", "faltan parámetros obligatorios: documentId"),
                 id="google_sheets_gana_un_obligatorio"),
]


@pytest.mark.parametrize("mutacion, en_la_tabla, en_el_validador", MUTACIONES)
def test_una_mutacion_del_catalogo_se_nota_en_la_capa_que_le_toca(mutar, mutacion, en_la_tabla, en_el_validador):
    assert problemas_de_catalogo(TABLA) == []            # línea base limpia
    mutar(mutacion)

    problemas = problemas_de_catalogo(TABLA)
    if en_la_tabla is None:
        assert problemas == [], "esta mutación la nota el validador, no la tabla"
    else:
        assert any(en_la_tabla in p for p in problemas), problemas

    if en_el_validador is None:
        # el validador no la ve: todos los flujos siguen pasando (por eso hace falta la prueba de la tabla)
        assert [p for n in CON_ARCHIVO for p in problemas_de_flujo(n, CASOS[n]["flujo"])] == []
    else:
        tipo, esperado = en_el_validador
        _, flujo = _caso_con(tipo)                # el primer flujo del golden que lleva un nodo de ese type
        errores = validador.validar(flujo).errores
        assert any(esperado in e for e in errores), errores


def test_permitir_agent_tool_sin_cambiar_el_semaforo_hace_fallar_la_prueba(mutar):
    assert problemas_de_catalogo(TABLA) == []

    def _entra_agent_tool(_cat, permitidos, _llm):
        permitidos[AGENT_TOOL] = {"tipo": AGENT_TOOL, "nombre": "AI Agent Tool", "nivel": 2, "funcion": "ia"}
    mutar(_entra_agent_tool)

    assert any("AGENT_TOOL_PERMITIDO" in p for p in _agent_tool(TABLA))
    # y los 5 flujos que se esperaba ver rechazados ahora son válidos: la prueba de flujos también lo nota
    for nombre in FLUJOS["usanAgentTool"]:
        assert problemas_de_flujo(nombre, CASOS[nombre]["flujo"]), nombre
    # el resto de los flujos no se entera
    assert [p for n in CON_ARCHIVO if n not in FLUJOS["usanAgentTool"]
            for p in problemas_de_flujo(n, CASOS[n]["flujo"])] == []


def _tabla_mutada(mutador) -> dict:
    tabla = copy.deepcopy(TABLA)
    mutador(tabla)
    return tabla


MUTACIONES_DE_LA_TABLA = [
    pytest.param(lambda t: t["apps"][0].update(typeVersion=2.3), "Gmail no tiene la versión 2.3",
                 id="la_tabla_sube_gmail_a_una_version_que_n8n_no_tiene"),
    pytest.param(lambda t: t["ias"][1]["credencial"].update(clave="anthropicApiNueva"),
                 "anthropicApiNueva ya no es una credencial", id="la_tabla_cambia_una_credencial"),
    pytest.param(lambda t: t["ias"][1].update(modelo="claude-haiku-5-5"), "no sale de permitidos.json",
                 id="la_tabla_inventa_un_modelo_para_claude"),
    pytest.param(lambda t: t["ias"][0].update(modelo="gpt-9-mini"), "permitidos.json sugiere «gpt-5.4-mini»",
                 id="la_tabla_cambia_el_modelo_de_openai"),
    pytest.param(lambda t: t["apps"].pop(3), "falta en el menú de apps del Constructor", id="la_tabla_borra_una_app"),
    pytest.param(lambda t: t["ias"].pop(), "falta entre las IA del Constructor", id="la_tabla_borra_una_ia"),
    pytest.param(lambda t: t["disparadores"][1].update(tipo=L + "chatTriggerNuevo"), "no existe en n8n",
                 id="la_tabla_inventa_un_tipo_de_nodo"),
    pytest.param(lambda t: t["agente"].update(typeVersion=3.0), "el Constructor fija 3.0 y n8n ya va en 3.1",
                 id="la_tabla_se_queda_en_una_version_vieja_del_agente"),
]


@pytest.mark.parametrize("mutador, esperado", MUTACIONES_DE_LA_TABLA)
def test_una_fila_de_la_tabla_tocada_se_nota(mutador, esperado):
    problemas = problemas_de_catalogo(_tabla_mutada(mutador))
    assert any(esperado in p for p in problemas), problemas


def test_un_exportador_que_emite_otra_version_u_otra_credencial_se_nota():
    assert problemas_de_cobertura(TABLA, CASOS) == []
    nombre_gmail, _ = _caso_con(B + "gmail")
    nombre_slack, _ = _caso_con(B + "slack")

    def nodo(casos: dict, caso: str, tipo: str) -> dict:
        return _usa(casos[caso]["flujo"], tipo)[0]

    casos = copy.deepcopy(CASOS)                      # el exportador sube Gmail a una versión que la tabla no tiene
    nodo(casos, nombre_gmail, B + "gmail")["typeVersion"] = 2.1
    assert any("que la tabla no declara" in p for p in problemas_de_cobertura(TABLA, casos))

    casos = copy.deepcopy(CASOS)                      # emite otra credencial para Slack
    nodo(casos, nombre_slack, B + "slack")["credentials"] = {"slackOAuth2Api": {"id": "", "name": "Slack"}}
    assert any("la tabla pide slackApi" in p for p in problemas_de_cobertura(TABLA, casos))

    casos = copy.deepcopy(CASOS)                      # o una referencia que ya no está vacía
    nodo(casos, nombre_slack, B + "slack")["credentials"]["slackApi"]["id"] = "123"
    assert any("referencia vacía" in p for p in problemas_de_cobertura(TABLA, casos))

    casos = copy.deepcopy(CASOS)                      # o una credencial donde la tabla no pide ninguna
    nodo(casos, nombre_gmail, L + "agent")["credentials"] = {"openAiApi": {"id": "", "name": "OpenAI"}}
    assert any("la tabla no pide ninguna" in p for p in problemas_de_cobertura(TABLA, casos))

    # y una fila de la tabla que ningún flujo exporta (nadie la ha pasado por el validador)
    sin_whatsapp = {n: c for n, c in CASOS.items() if not (c["flujo"] and _usa(c["flujo"], B + "whatsApp"))}
    assert any("whatsApp" in p and "ningún flujo del golden" in p for p in problemas_de_cobertura(TABLA, sin_whatsapp))


MUTACIONES_DE_SECRETOS = [
    pytest.param(lambda t: t["secretos"]["patrones"][0].update(fuente="sk-[A-Za-z0-9_-]{21,}"), "patrón 0",
                 id="un_patron_cambia_de_largo"),
    pytest.param(lambda t: t["secretos"]["patrones"][5].update(ignoraMayusculas=False), "ignora mayúsculas",
                 id="bearer_pierde_la_bandera_i"),
    pytest.param(lambda t: t["secretos"]["patrones"].pop(), "tiene 15 patrones", id="falta_un_patron"),
    pytest.param(lambda t: t["secretos"]["patrones"][8].update(fuente="ntn_[A-Za-z0-9]{30,}"), "patrón 8",
                 id="un_formato_nuevo_pierde_el_limite_de_palabra"),
    pytest.param(lambda t: t["secretos"]["patrones"][0].update(fuente="sk-[A-Za-z0-9_-]{20,}"), "patrón 0",
                 id="typescript_pierde_el_limite_de_palabra_de_sk"),
    pytest.param(lambda t: t["secretos"]["patrones"].reverse(), "patrón 0", id="los_patrones_cambian_de_orden"),
    pytest.param(lambda t: t["secretos"]["sondas"][0].update(coincide=[]), "TypeScript dice []",
                 id="typescript_deja_de_reconocer_una_familia"),
]


@pytest.mark.parametrize("mutador, esperado", MUTACIONES_DE_SECRETOS)
def test_un_cambio_en_los_patrones_de_claves_se_nota(mutador, esperado):
    assert problemas_de_secretos(TABLA) == []
    problemas = problemas_de_secretos(_tabla_mutada(mutador))
    assert any(esperado in p for p in problemas), problemas


MUTACIONES_DE_FAMILIAS_NUEVAS = [
    pytest.param(lambda t: next(s for s in t["secretos"]["sondas"] if s["id"] == "stripe").update(coincide=[]),
                 "sonda «stripe»: TypeScript dice []", id="typescript_deja_de_reconocer_stripe"),
    pytest.param(lambda t: next(s for s in t["secretos"]["sondas"] if s["id"] == "notion").update(coincide=[0, 8]),
                 "sonda «notion»: TypeScript dice [0, 8]", id="otro_patron_se_mete_con_un_formato_nuevo"),
    pytest.param(lambda t: t["secretos"]["sondas"].remove(next(s for s in t["secretos"]["sondas"] if s["id"] == "sendgrid")),
                 "ya no trae la sonda «sendgrid»", id="falta_la_sonda_de_un_formato_nuevo"),
]


@pytest.mark.parametrize("mutador, esperado", MUTACIONES_DE_FAMILIAS_NUEVAS)
def test_un_cambio_en_un_formato_nuevo_de_typescript_se_nota(mutador, esperado):
    assert _familias_solo_de_typescript(TABLA) == []
    problemas = _familias_solo_de_typescript(_tabla_mutada(mutador))
    assert any(esperado in p for p in problemas), problemas


def test_si_python_se_pone_al_dia_la_prueba_lo_dice(monkeypatch):
    # validador.SECRETOS adopta los 16 patrones: hay que borrar la excepción
    al_dia = [re.compile(("(?i)" if ign else "") + fuente) for fuente, ign in _lo_que_dice_typescript()]
    monkeypatch.setattr(validador, "SECRETOS", al_dia)
    assert any("ya tiene los 16 patrones" in p for p in _estado_de_python_en_secretos())
    # o cambia otra cosa distinta de lo declarado
    monkeypatch.setattr(validador, "SECRETOS", al_dia[:8])
    assert any("revisa REFORMAS_TS" in p for p in _estado_de_python_en_secretos())
    # y con la excepción ya borrada, Python debe ser exactamente lo de TypeScript
    monkeypatch.setattr(sys.modules[__name__], "PYTHON_ATRASADO", False)
    monkeypatch.setattr(validador, "SECRETOS", al_dia)
    assert _estado_de_python_en_secretos() == []
    assert _patrones_esperados_en_ts() == _lo_que_dice_typescript()


def test_una_divergencia_declarada_que_cambia_o_desaparece_se_nota(monkeypatch):
    # si alguien arregla validador.py (p. ej. `re.ASCII` en el patrón de Telegram), TypeScript y Python vuelven a
    # coincidir y la excepción debe borrarse de DIVERGENCIAS_DE_SECRETOS
    ahora_coinciden = _tabla_mutada(lambda t: next(
        s for s in t["secretos"]["sondas"] if s["id"] == "telegram_con_digitos_arabes").update(coincide=[4]))
    assert any("ya no diverge" in p for p in problemas_de_secretos(ahora_coinciden))
    # o si Python empieza a decir otra cosa que lo declarado
    monkeypatch.setitem(DIVERGENCIAS_DE_SECRETOS, "telegram_con_digitos_arabes", [])
    assert any("se declaró" in p for p in problemas_de_secretos(TABLA))


# ---------------------------------------------------------------------------------------------------------------
# 5. Lo que vitest sabe de fuera de web/: golden/n8n-referencia.json y el guardián de que no lee nada más
# ---------------------------------------------------------------------------------------------------------------
# La etapa `web` del Dockerfile corre vitest con SOLO web/ (más tools/tarifas.json y static/monedero.js): si una prueba
# del modelo leyera media/library/n8n o pipeline/, el build de la imagen fallaría sin que nada se notara en local. Lo
# que catalogo.test.ts compara contra el catálogo de n8n y los permitidos lo lee de este JSON, que se escribe aquí y se
# vigila aquí contra los archivos reales.

def _referencia_para_vitest(catalogo: dict, permitidos: dict, tabla: dict) -> dict:
    """El recorte de catalog.json y permitidos.json que catalogo.test.ts necesita: los nodos que la tabla del
    Constructor usa (con la forma que ya tenían en catalog.json), las credenciales que nombran, el modelo que sugiere
    el repo y la lista de nodos permitidos con su función."""
    tipos = ({a["tipo"] for a in tabla["apps"]} | {i["tipo"] for i in tabla["ias"]}
             | {d["tipo"] for d in tabla["disparadores"]}
             | {tabla["agente"]["tipo"], tabla["ayudante"]["tipo"], tabla["otraApp"]["tipo"]})
    nodos = {}
    for tipo in sorted(tipos):
        n = catalogo["nodos"].get(tipo)
        if n is None:
            continue                       # un tipo que n8n ya no tiene: catalogo.test.ts dice «no está en catalog.json»
        nodos[tipo] = {k: n[k] for k in ("nombre", "versiones", "version_por_defecto", "disparador",
                                         "como_herramienta", "oculto")}
        nodos[tipo]["credenciales"] = [{"nombre": c["nombre"]} for c in n["credenciales"]]
    nombres = sorted({c["nombre"] for n in nodos.values() for c in n["credenciales"]})
    return {
        "formato": 1,
        "generadoPor": "tests/test_constructor_paridad.py (ACTUALIZAR_DORADO=1 ... -k referencia). No se edita a mano.",
        "n8n": catalogo["procedencia"]["n8n"],
        "catalogo": {
            "nodos": nodos,
            "credenciales": {c: catalogo["credenciales"][c] for c in nombres if c in catalogo["credenciales"]},
        },
        "permitidos": {
            "llm": {k: permitidos["llm"][k] for k in ("proveedor", "nodo", "modelo")},
            "nodos": [{"tipo": n["tipo"], "funcion": n["funcion"]} for n in permitidos["nodos"]],
        },
    }


def _texto_de_la_referencia(catalogo: dict, permitidos: dict, tabla: dict) -> str:
    return json.dumps(_referencia_para_vitest(catalogo, permitidos, tabla), indent=2, ensure_ascii=False) + "\n"


def _archivos_reales() -> tuple[dict, dict]:
    # se leen los archivos, no `nc.catalogo()`: esta prueba también corre mientras otra monkeypatchea el catálogo
    return (json.loads(nc.RUTA_CATALOGO.read_text(encoding="utf-8")),
            json.loads(nc.RUTA_PERMITIDOS.read_text(encoding="utf-8")))


def test_la_referencia_n8n_que_lee_vitest_esta_al_dia():
    esperado = _texto_de_la_referencia(*_archivos_reales(), TABLA)
    if os.environ.get("ACTUALIZAR_DORADO") == "1":
        RUTA_REFERENCIA.write_text(esperado, encoding="utf-8")
        return
    assert RUTA_REFERENCIA.is_file(), (
        f"falta {RUTA_REFERENCIA.relative_to(RAIZ)}: ACTUALIZAR_DORADO=1 ./venv/bin/python -m pytest "
        "tests/test_constructor_paridad.py -p no:cacheprovider -k referencia")
    assert RUTA_REFERENCIA.read_text(encoding="utf-8") == esperado, (
        f"{RUTA_REFERENCIA.relative_to(RAIZ)} ya no es lo que dicen catalog.json y permitidos.json. Si el cambio es a "
        "propósito: ACTUALIZAR_DORADO=1 ./venv/bin/python -m pytest tests/test_constructor_paridad.py "
        "-p no:cacheprovider -k referencia, revisa el diff y corre vitest del modelo")


def test_un_cambio_en_el_catalogo_o_en_los_permitidos_cambia_la_referencia():
    catalogo, permitidos = _archivos_reales()
    base = _texto_de_la_referencia(catalogo, permitidos, TABLA)
    assert _texto_de_la_referencia(copy.deepcopy(catalogo), copy.deepcopy(permitidos), TABLA) == base

    def con(mutar_cat=None, mutar_per=None, tabla=TABLA) -> str:
        c, p = copy.deepcopy(catalogo), copy.deepcopy(permitidos)
        if mutar_cat:
            mutar_cat(c)
        if mutar_per:
            mutar_per(p)
        return _texto_de_la_referencia(c, p, tabla)

    def gmail_sube(c):
        c["nodos"][B + "gmail"]["version_por_defecto"] = 9.9

    def gmail_oculto(c):
        c["nodos"][B + "gmail"]["oculto"] = True

    def credencial_renombrada(c):
        c["nodos"][B + "gmail"]["credenciales"][0]["nombre"] = "otra"

    def sin_sheets(p):
        p["nodos"] = [n for n in p["nodos"] if n["tipo"] != B + "googleSheets"]

    def otro_modelo(p):
        p["llm"]["modelo"] = "gpt-9-mini"

    def agent_tool_permitido(p):
        p["nodos"].append({"tipo": AGENT_TOOL, "nombre": "AI Agent Tool", "nivel": 2, "funcion": "ia"})

    for mutar_cat in (gmail_sube, gmail_oculto, credencial_renombrada):
        assert con(mutar_cat=mutar_cat) != base, mutar_cat.__name__
    for mutar_per in (sin_sheets, otro_modelo, agent_tool_permitido):
        assert con(mutar_per=mutar_per) != base, mutar_per.__name__
    # lo que el Constructor no usa de n8n no entra al recorte: tocar otro nodo no cambia nada
    assert con(mutar_cat=lambda c: c["nodos"][B + "wait"].update(version_por_defecto=9.9)) == base
    # el recorte es pequeño y no trae nada que parezca una clave
    assert len(base) < 40_000
    assert not any(p.search(base) for p in validador.SECRETOS)


# Lo que el Dockerfile le da a vitest: web/ y nada más (tools/tarifas.json y static/monedero.js son de otras pantallas).
# En un archivo que lee del disco, esto es salirse: cinco `..` seguidos (la raíz del repo desde modelo/) o un directorio
# de la raíz del repo escrito como parte de una ruta.
SALE_DE_WEB = re.compile(r"(?:\.\.[/\\]){4}\.\.|['\"`/](?:media|pipeline|tools|static|server|docs|tests|videos)[/'\"`]")
LEE_DEL_DISCO = re.compile(r"""node:fs|from\s+['"]fs['"]|require\(['"]fs['"]\)|node:child_process|process\.cwd\(\)""")


def _sin_comentarios(texto: str) -> str:
    texto = re.sub(r"/\*.*?\*/", "", texto, flags=re.DOTALL)
    return re.sub(r"(?m)(?<![:'\"`])//[^\n]*$", "", texto)


def salidas_de_web(texto: str) -> list[str]:
    """Las rutas con las que un archivo de vitest se sale de web/ (vacío si no lee del disco o no se sale)."""
    codigo = _sin_comentarios(texto)
    if not LEE_DEL_DISCO.search(codigo):
        return []
    return [m.group(0) for m in SALE_DE_WEB.finditer(codigo)]


def test_ningun_archivo_de_vitest_del_modelo_lee_nada_de_fuera_de_web():
    problemas = []
    revisados = 0
    for ruta in sorted(MODELO.rglob("*.ts")):
        revisados += 1
        for salida in salidas_de_web(ruta.read_text(encoding="utf-8")):
            problemas.append(f"{ruta.relative_to(RAIZ)}: sale de web/ con «{salida}»")
    assert revisados > 30, "el guardián no está viendo los archivos del modelo"
    _vacio(problemas)


def test_el_guardian_de_salidas_de_web_detecta_lo_que_busca_y_no_confunde_comentarios():
    leer = "import { readFileSync } from 'node:fs';\n"
    assert salidas_de_web(leer + "const RAIZ = resolve(dirname(f), '../../../../..');") != []
    assert salidas_de_web(leer + "readFileSync(resolve(RAIZ, 'media/library/n8n/catalog.json'))") != []
    assert salidas_de_web(leer + "readFileSync(resolve(RAIZ, 'pipeline', 'validador.py'))") != []
    assert salidas_de_web(leer + "const a = '../../x'; // media/library/n8n") == []
    assert salidas_de_web(leer + "/* lee media/library/n8n y pipeline/ */ readFileSync(resolve(DIR, 'golden', 'x.json'))") == []
    # un archivo que no lee del disco puede nombrar cualquier carpeta
    assert salidas_de_web("const t = 'los archivos de media/ y de tools/ no viajan';") == []
