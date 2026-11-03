"""Asistente de Automatizaciones, Fase A — los guardianes de «GASTO 0». Cada uno CAE si se quita su arreglo
(y los que son de código tienen su prueba de que caen):

  1. AST: `pipeline/asistente.py` y `server/automatiza_api.py` solo importan lo que está en una LISTA BLANCA
     (módulos, y de cada uno lo que pueden tocar), en cualquier nivel; no hay `open`, `exec`, `getattr` ni
     métodos de escritura. (Antes era una lista negra de seis SDK y se le escapaban httpx, requests,
     urllib, socket, subprocess, fal_client y claude_agent_sdk.) La lista negra sigue, como segunda red.
  2. En un intérprete limpio, importarlos no carga ningún SDK ni módulo de gasto.
  3. El recorrido completo funciona con los SDK «desinstalados» (`sys.modules[n] = None`).
  4. Cero E/S: toda frontera de gasto o de red tiene un espía que revienta, y un recorrido completo no la
     toca. Además un gancho de auditoría (`sys.addaudithook`) anota, durante un recorrido completo, todo
     socket, toda escritura a disco y todo subproceso: no hay ninguno. Y el gancho se prueba a sí mismo
     con mutaciones (una llamada de red «de cortesía», un archivo con el texto de la persona…).
  5. La matriz de `modo()`: la única rama que se activa sola es «prueba»; el real mal configurado no la
     degrada en silencio.
  6. Las rutas: solo las tres del contrato, todas del módulo, ninguna pública, ninguna con identidad
     inventada en el camino público.
  7. Ningún entorno de la infra enciende el modo real.

El lado de la sesión (401 sin token, 404 entre personas) y el de las llaves (ninguna respuesta lleva un
secreto ni el texto de la persona) están en `test_automatiza_api.py`.
"""
import ast
import asyncio
import contextlib
import itertools
import os
import subprocess
import sys
from pathlib import Path

import pytest

from pipeline import asistente, db, jobs
from server import auth, automatiza_api
from test_automatiza_api import (FRONTERAS, T0, etiqueta, TEXTO, _entorno, _id_con, _sin_gasto,  # noqa: F401
                                 cliente, espias, pedir, reloj)

RAIZ = Path(__file__).resolve().parent.parent
MODULOS = [RAIZ / "pipeline" / "asistente.py", RAIZ / "server" / "automatiza_api.py"]

# La lista negra (segunda red): los SDK y clientes de proveedor que el repo usa o podría usar...
SDKS = {"anthropic", "openai", "google", "boto3", "botocore", "langfuse",
        "httpx", "requests", "urllib3", "aiohttp", "fal_client", "claude_agent_sdk", "stripe", "assemblyai"}
# ...y la red y los procesos de la biblioteca estándar (que otros módulos sí cargan: por eso no entran en
# la prueba del intérprete limpio, solo en la de lo que el código fuente importa)
RED_Y_PROCESOS = {"urllib", "http", "socket", "ssl", "subprocess", "smtplib", "ftplib", "sqlite3"}
DE_GASTO = {"claude_rag", "armado", "embeddings", "vectores", "jobs", "moderacion", "creditos", "llm"}

# La lista BLANCA (la red de verdad): módulo -> lo que se puede tocar de él (None = todo; no tiene efectos).
# Lo que se agrega aquí se agrega a propósito, con su prueba. `db`: solo para saber QUIÉN pregunta;
# `publico`: solo las constantes de largo del pedido.
LISTA_BLANCA = {
    "pipeline/asistente.py": {
        "__future__": None, "base64": None, "binascii": None, "copy": None, "dataclasses": None,
        "functools": None, "hashlib": None, "hmac": None, "json": None, "math": None, "re": None,
        "typing": None, "unicodedata": None, "pathlib": {"Path"}, "os": {"environ"}, "time": {"time"},
        "pipeline.n8n_catalogo": {"base", "permitidos", "catalogo"},
        "pipeline.validador": {"validar", "SECRETOS"},
        "pipeline.publico": {"LARGO_MINIMO", "LARGO_MAXIMO"},
    },
    "server/automatiza_api.py": {
        "__future__": None, "json": None, "typing": None, "logging": {"getLogger"},
        "fastapi": {"APIRouter", "HTTPException", "Request"}, "fastapi.responses": {"JSONResponse"},
        "pipeline.asistente": {"sirve", "modo", "config", "limites", "iniciar", "consultar", "reloj",
                               "ErrorAsistente", "MuestrasInvalidas"},
        "pipeline.db": {"usuario_actual"},
    },
}
# lo único que cada módulo puede traer de `pipeline/` (derivado de la lista blanca)
PERMITIDOS = {k: {m.split(".")[1] for m in v if m.startswith("pipeline.")} for k, v in LISTA_BLANCA.items()}
# nada de abrir archivos, ejecutar texto ni rodear la lista con reflexión
BUILTINS_VETADOS = {"open", "exec", "eval", "compile", "__import__", "getattr", "setattr", "delattr",
                    "globals", "locals", "vars", "input", "breakpoint"}
METODOS_VETADOS = {"write_text", "write_bytes", "open", "touch", "mkdir", "unlink", "rmdir", "rename",
                   "symlink_to", "hardlink_to", "chmod", "popen", "system", "exec", "spawn"}


# ---------------------------------------------------------------------------
# 1 · AST

def importados(fuente: str) -> list[str]:
    """Todo lo que el código importa, en cualquier nivel (dentro de funciones, de `try`, de `if`), con su
    nombre completo: `from pipeline import jobs` es `pipeline.jobs`. Cuenta también `importlib.import_module`
    y `__import__`; si el nombre no es una cadena literal, lo anota como «<dinámico>» (no se puede probar)."""
    nombres: list[str] = []
    for n in ast.walk(ast.parse(fuente)):
        if isinstance(n, ast.Import):
            nombres += [a.name for a in n.names]
        elif isinstance(n, ast.ImportFrom):
            base = "." * n.level + (n.module or "")
            nombres.append(base)
            nombres += [f"{base}.{a.name}" if base and not base.endswith(".") else base + a.name
                        for a in n.names]
        elif isinstance(n, ast.Call):
            f = n.func
            nombre = f.attr if isinstance(f, ast.Attribute) else getattr(f, "id", "")
            if nombre in ("import_module", "__import__"):
                arg = n.args[0] if n.args else None
                nombres.append(arg.value if isinstance(arg, ast.Constant) and isinstance(arg.value, str)
                               else "<dinámico>")
    return nombres


def prohibidos(fuente: str) -> list[str]:
    malos = []
    for nombre in importados(fuente):
        if nombre == "<dinámico>" or nombre.startswith("."):          # relativos: no se pueden probar
            malos.append(nombre)
            continue
        partes = nombre.split(".")
        if (partes[0] in SDKS | RED_Y_PROCESOS
                or (partes[0] == "pipeline" and len(partes) > 1 and partes[1] in DE_GASTO)):
            malos.append(nombre)
    return malos


def fuera_de_lista(fuente: str, clave: str) -> list[str]:
    """Todo lo que `fuente` importa o usa y NO está en `LISTA_BLANCA[clave]`. Vacía = limpio.

    Mira (1) cada import, en cualquier nivel: el módulo tiene que estar en la lista, y si es
    `from m import n`, `n` tiene que ser un módulo de la lista o un nombre permitido de `m`; (2) cada uso de
    un módulo importado que la lista restringe (`os.environ` sí, `os.system` no, `db.automatiza_crear` no);
    (3) los built-ins que abren archivos, ejecutan texto o rodean la lista (`open`, `exec`, `getattr`…); y
    (4) los métodos de escritura (`.write_text`, `.open`, `.unlink`…) y de proceso, con cualquier dueño."""
    lista = LISTA_BLANCA[clave]
    arbol = ast.parse(fuente)
    malos: list[str] = []
    restringidos: dict[str, tuple[str, set[str]]] = {}          # nombre local -> (módulo, atributos)

    def registrar(local: str, modulo: str) -> None:
        permitido = lista[modulo]
        if permitido is not None:
            restringidos[local] = (modulo, permitido)

    for n in ast.walk(arbol):
        if isinstance(n, ast.Import):
            for a in n.names:
                if a.name not in lista or ("." in a.name and a.asname is None):
                    malos.append(f"import {a.name}")
                else:
                    registrar(a.asname or a.name, a.name)
        elif isinstance(n, ast.ImportFrom):
            if n.level or not n.module:
                malos.append("import relativo")
                continue
            for a in n.names:
                completo = f"{n.module}.{a.name}"
                if a.name == "*":
                    malos.append(f"from {n.module} import *")
                elif completo in lista:                            # un módulo de la lista
                    registrar(a.asname or a.name, completo)
                elif n.module in lista:                            # un nombre dentro de un módulo de la lista
                    permitido = lista[n.module]
                    if permitido is not None and a.name not in permitido:
                        malos.append(f"from {n.module} import {a.name}")
                else:
                    malos.append(f"from {n.module} import {a.name}")
        elif isinstance(n, ast.Call):
            f = n.func
            if isinstance(f, ast.Name) and f.id in BUILTINS_VETADOS:
                malos.append(f"{f.id}(…)")
            elif isinstance(f, ast.Attribute) and f.attr in METODOS_VETADOS:
                malos.append(f".{f.attr}(…)")
            elif isinstance(f, ast.Attribute) and f.attr in ("import_module",):
                malos.append(f".{f.attr}(…)")
    como_dueno = {id(a.value) for a in ast.walk(arbol) if isinstance(a, ast.Attribute)}
    for n in ast.walk(arbol):
        if isinstance(n, ast.Attribute) and isinstance(n.value, ast.Name) and n.value.id in restringidos:
            modulo, permitido = restringidos[n.value.id]
            if n.attr not in permitido:
                malos.append(f"{modulo}.{n.attr}")
        elif isinstance(n, ast.Name) and n.id in restringidos and id(n) not in como_dueno:
            malos.append(f"{restringidos[n.id][0]} usado sin nombrar qué (alias suelto)")
    return malos


def de_pipeline(fuente: str) -> set[str]:
    return {n.split(".")[1] for n in importados(fuente) if n.startswith("pipeline.") and n.count(".") >= 1}


CAEN = [
    "import anthropic", "import openai.types", "from google import genai",
    "from google.genai import types", "import boto3", "from botocore.exceptions import ClientError",
    "import langfuse", "from langfuse import observe",
    "from pipeline import claude_rag", "from pipeline import (db, jobs)", "from pipeline.armado import armar",
    "import pipeline.embeddings", "from pipeline import llm as ll",
    "def f():\n    from pipeline import vectores", "def f():\n    import anthropic",
    "try:\n    import boto3\nexcept ImportError:\n    pass",
    "if True:\n    from pipeline.moderacion import revisar", "class A:\n    def f(self):\n        import openai",
    "import importlib\nimportlib.import_module('anthropic')", "__import__('pipeline.creditos')",
    "import importlib\nimportlib.import_module(nombre)", "from . import jobs", "from .jobs import encolar",
]
PASAN = [
    "import json\nfrom pipeline import db, asistente", "from pipeline.n8n_catalogo import permitidos",
    "def f():\n    from pipeline import validador", "import openai_falso", "from google_falso import x",
    "# import anthropic\nx = 'import boto3'", "from pipeline import publico as freno",
    "from pipeline import (n8n_catalogo, validador)",
]


@pytest.mark.parametrize("fuente", CAEN)
def test_el_guardian_de_imports_cae_con_cada_forma_de_importar(fuente):
    assert prohibidos(fuente), fuente


@pytest.mark.parametrize("fuente", PASAN)
def test_el_guardian_de_imports_no_da_falsas_alarmas(fuente):
    assert prohibidos(fuente) == [], fuente


# los clientes de red y de proceso que la lista negra ORIGINAL (seis SDK) no nombraba
ESCAPABAN = [
    "import httpx", "import requests", "import urllib.request", "import socket", "import subprocess",
    "import fal_client", "import stripe", "import assemblyai", "import claude_agent_sdk",
]


@pytest.mark.parametrize("fuente", ESCAPABAN)
def test_la_lista_blanca_ve_los_clientes_de_red_que_la_lista_negra_original_no_nombraba(fuente):
    """H seg-1: el repo usa httpx (9 veces), urllib.request (8), requests (8), fal_client (2), http.client y
    claude_agent_sdk; la lista negra original (anthropic, openai, google, boto3, botocore, langfuse) no
    decía nada de ellos. La lista blanca no necesita saber su nombre."""
    assert importados(fuente)[0].split(".")[0] not in {"anthropic", "openai", "google", "boto3", "botocore",
                                                      "langfuse"}
    assert fuera_de_lista(fuente, "pipeline/asistente.py"), fuente
    assert fuera_de_lista(fuente, "server/automatiza_api.py"), fuente


CAEN_DE_LA_LISTA_BLANCA = ESCAPABAN + [
    "exec('x = 1')", "eval('1')", "open('/tmp/x', 'w')", "getattr(os, 'system')", "compile('1', 'a', 'eval')",
    "__import__('socket')", "import importlib\nimportlib.import_module('socket')", "from . import jobs",
    "from pipeline import db\ndb.automatiza_crear(t)", "from pipeline import db\nx = db",
    "from pipeline import db as base\nbase.ejecutar('select 1')",
    "from pipeline import publico as f\nf.admitir(x)", "from pipeline.publico import admitir",
    "from pipeline import jobs", "from pipeline import claude_rag", "from pipeline import creditos",
    "import os\nos.system('ls')", "import os\nos.popen('ls')", "import os as o\no.getenv('X')",
    "from os import system", "import os\nx = os\nx.system('ls')", "import time\ntime.sleep(1)",
    "from pathlib import Path\nPath('a').write_text('t')", "from pathlib import Path\nPath('a').open('w')",
    "from pathlib import Path\nPath('a').unlink()", "import logging\nlogging.FileHandler('x')",
    "import logging\nlogging.basicConfig(filename='x')", "import json\nfrom threading import Thread",
    "from fastapi import FastAPI", "from fastapi.responses import FileResponse", "import fastapi.testclient",
    "from pipeline import validador\nvalidador.otra_cosa()", "from pipeline import n8n_catalogo\nn8n_catalogo.RAIZ",
    "def f():\n    import requests", "try:\n    import boto3\nexcept ImportError:\n    pass",
    "if True:\n    from pipeline import jobs", "from json import *",
]
SIGUE_PASANDO = [
    "import json\nfrom pipeline import validador\nvalidador.validar({})", "import os\nx = os.environ.get('A')",
    "import time\nx = time.time()", "from pathlib import Path\nPath('a').read_text()",
    "from pipeline import publico as freno\nx = freno.LARGO_MINIMO", "from typing import Any, Mapping",
    "from __future__ import annotations", "from pipeline import n8n_catalogo\nn8n_catalogo.base('x')",
    "import hmac, hashlib, base64, binascii, copy, re, unicodedata", "'open exec getattr'.split()",
    "x = {'open': 1}\nx['open']", "from dataclasses import dataclass\nfrom functools import lru_cache",
]


@pytest.mark.parametrize("fuente", CAEN_DE_LA_LISTA_BLANCA)
def test_la_lista_blanca_cae_con_cada_forma_de_salirse_de_ella(fuente):
    assert fuera_de_lista(fuente, "pipeline/asistente.py"), fuente


@pytest.mark.parametrize("fuente", SIGUE_PASANDO)
def test_la_lista_blanca_no_da_falsas_alarmas(fuente):
    assert fuera_de_lista(fuente, "pipeline/asistente.py") == [], fuente


@pytest.mark.parametrize("fuente", [
    "from pipeline import db\ndb.usuario_actual()", "from pipeline import asistente\nasistente.iniciar(1, 2)",
    "import logging\nlog = logging.getLogger('x')\nlog.info('a')",
    "from fastapi import APIRouter, HTTPException, Request\nfrom fastapi.responses import JSONResponse",
])
def test_la_lista_blanca_deja_pasar_lo_que_el_api_si_usa(fuente):
    assert fuera_de_lista(fuente, "server/automatiza_api.py") == [], fuente


@pytest.mark.parametrize("ruta", MODULOS, ids=lambda r: r.name)
def test_ni_el_asistente_ni_su_api_se_salen_de_la_lista_blanca(ruta):
    """El módulo REAL contra la lista blanca: solo lo permitido, y solo los atributos permitidos."""
    fuente = ruta.read_text(encoding="utf-8")
    assert importados(fuente), "el guardián no vio ningún import: algo está mal con la lectura"
    assert fuera_de_lista(fuente, ruta.relative_to(RAIZ).as_posix()) == []


def test_cada_modulo_de_la_lista_blanca_se_usa_de_verdad():
    """Una lista blanca que permite más de lo que se usa es un permiso olvidado."""
    for ruta in MODULOS:
        clave = ruta.relative_to(RAIZ).as_posix()
        usados = set(importados(ruta.read_text(encoding="utf-8")))
        usados |= {u.rsplit(".", 1)[0] for u in usados}
        for modulo in LISTA_BLANCA[clave]:
            assert modulo in usados or modulo == "__future__", f"{clave}: «{modulo}» está en la lista y no se usa"


@pytest.mark.parametrize("ruta", MODULOS, ids=lambda r: r.name)
def test_ni_el_asistente_ni_su_api_importan_proveedores_ni_modulos_de_gasto(ruta):
    fuente = ruta.read_text(encoding="utf-8")
    assert importados(fuente), "el guardián no vio ningún import: algo está mal con la lectura"
    assert prohibidos(fuente) == []


@pytest.mark.parametrize("ruta", MODULOS, ids=lambda r: r.name)
def test_lo_que_pueden_importar_de_pipeline_es_una_lista_cerrada(ruta):
    clave = ruta.relative_to(RAIZ).as_posix()
    fuente = ruta.read_text(encoding="utf-8")
    sobran = de_pipeline(fuente) - PERMITIDOS[clave]
    assert not sobran, f"{clave} importa de pipeline/ algo que no está en la lista cerrada: {sobran}"


def test_la_logica_del_asistente_no_toca_la_base_ni_en_el_codigo():
    """`pipeline/asistente.py` no importa `db` (lo hace solo el API, para saber quién pregunta)."""
    assert "db" not in de_pipeline(MODULOS[0].read_text(encoding="utf-8"))
    assert "db" in de_pipeline(MODULOS[1].read_text(encoding="utf-8"))


# ---------------------------------------------------------------------------
# 2 · un intérprete limpio

def test_importarlos_en_un_interprete_limpio_no_carga_ningun_sdk_ni_modulo_de_gasto():
    codigo = (
        "import sys\n"
        f"sys.path.insert(0, {str(RAIZ)!r})\n"
        "import pipeline.asistente, server.automatiza_api\n"
        f"sdk, gasto = {sorted(SDKS)!r}, {sorted(DE_GASTO)!r}\n"
        "malos = sorted(m for m in sys.modules if m.split('.')[0] in sdk or\n"
        "               (m.startswith('pipeline.') and m.split('.')[1] in gasto))\n"
        "print('MALOS=' + repr(malos))\n")
    r = subprocess.run([sys.executable, "-I", "-c", codigo], capture_output=True, text=True,
                       encoding="utf-8", timeout=180, cwd=str(RAIZ))
    assert r.returncode == 0, r.stderr[-1500:]
    assert "MALOS=[]" in r.stdout, r.stdout[-1500:]


# ---------------------------------------------------------------------------
# 3 · sin ningún SDK instalado

def test_el_recorrido_completo_funciona_con_los_sdk_desinstalados(cliente, reloj, monkeypatch):
    # el cliente de pruebas y la app se arman ANTES de esconder los SDK: lo que se prueba es la petición
    for nombre in ("anthropic", "openai", "google", "google.genai", "google.generativeai", "boto3",
                   "botocore", "langfuse", "langfuse.openai"):
        monkeypatch.setitem(sys.modules, nombre, None)
    with pytest.raises(ImportError):                       # el testigo: de verdad están escondidos
        __import__("anthropic")
    with pytest.raises(ImportError):
        __import__("boto3")
    assert cliente.get("/api/automatiza/config").status_code == 200
    for pedido in (TEXTO, "un chat de preguntas frecuentes", "un resumen de lo importante cada día",
                   "algo con HubSpot por favor, gracias"):
        reloj.t = T0
        creado = pedir(cliente, pedido)
        assert creado.status_code == 202, creado.text
        for despues in (0, 2, 6):
            reloj.t = T0 + despues
            assert cliente.get("/api/automatiza/armar/" + creado.json()["id"]).status_code == 200
    assert pedir(cliente, "hola").status_code == 422
    assert cliente.get("/api/automatiza/armar/p1.x").status_code == 404


# ---------------------------------------------------------------------------
# 4 · cero E/S

def test_los_espias_son_de_verdad(espias):
    """Si los espías no funcionaran, todo lo de abajo pasaría sin probar nada. Se llama a CADA frontera."""
    for modulo, nombre in FRONTERAS:
        with pytest.raises(AssertionError):
            getattr(modulo, nombre)()
    assert espias.llamadas == [etiqueta(m, n) for m, n in FRONTERAS]
    assert "pipeline.jobs.encolar_publico" in espias.llamadas and "pipeline.db.ejecutar" in espias.llamadas
    espias.llamadas.clear()                                 # lo que aquí se provocó a propósito


def test_las_fronteras_cubren_la_red_y_los_proveedores_que_el_repo_usa():
    """H seg-1: los espías cubrían 23 funciones; no había ninguno para `requests`, `urllib`, `fal_client`,
    `claude_agent_sdk` ni `socket`. (`subprocess` y `httpx.Client.send` no se espían: los usa el propio
    arnés de pruebas; los cubre el gancho de auditoría de abajo y el bloqueo de transporte de
    `tests/conftest.py`.)"""
    puestas = {etiqueta(m, n) for m, n in FRONTERAS}
    for requerida in ("socket.connect", "socket.connect_ex", "socket.create_connection",
                      "urllib.request.urlopen", "OpenerDirector.open", "HTTPConnection.connect",
                      "Session.request", "Session.send", "fal_client.subscribe", "fal_client.run",
                      "fal_client.submit", "claude_agent_sdk.query", "ClaudeSDKClient.connect",
                      "boto3.client", "boto3.resource"):
        assert requerida in puestas, requerida
    assert len(FRONTERAS) >= 35


def recorrido_completo(cliente, reloj):
    """Todo lo que la web hace con el Asistente, incluidos los errores y los ids raros."""
    cliente.get("/api/automatiza/config")
    ids = []
    for pedido in (TEXTO, "un chat de preguntas frecuentes", "un resumen de lo importante cada día",
                   "algo con HubSpot por favor, gracias"):
        reloj.t = T0
        ids.append(pedir(cliente, pedido).json()["id"])
        for despues in (0, 1.2, 2.4, 3.6, 4.8, 6, 3600):
            reloj.t = T0 + despues
            cliente.get("/api/automatiza/armar/" + ids[-1])
    for roto in ({}, {"texto": 1}, {"texto": "x"}, {"texto": "a" * 2000}, [], None):
        cliente.post("/api/automatiza/armar", json=roto)
    cliente.post("/api/automatiza/armar", content=b"{", headers={"content-type": "application/json"})
    for malo in ("nada", "p1.", ids[0] + "x", _id_con(u="\ud800")):
        cliente.get("/api/automatiza/armar/" + malo)
    return ids


def test_un_recorrido_completo_en_prueba_no_toca_ninguna_frontera(cliente, reloj, espias):
    """Config, los cuatro finales posibles, los errores de pedido y los 404, sin una sola llamada a la
    base, la cola, la moderación, los créditos, un modelo ni la red."""
    recorrido_completo(cliente, reloj)
    assert espias.llamadas == []


# ---- el gancho de auditoría: nada de sockets, de escrituras ni de procesos mientras se atiende

EVENTOS_DE_RED = {"socket.connect", "socket.getaddrinfo", "socket.gethostbyname", "socket.gethostbyaddr",
                  "socket.sendto", "socket.sendmsg", "socket.bind", "socket.getnameinfo"}
EVENTOS_DE_PROCESO = {"subprocess.Popen", "os.system", "os.exec", "os.posix_spawn", "os.spawn", "os.fork",
                      "os.forkpty"}
EVENTOS_DE_ESCRITURA = {"os.remove", "os.rename", "os.mkdir", "os.rmdir", "os.truncate", "shutil.copyfile",
                        "shutil.move", "shutil.rmtree", "sqlite3.connect"}
_VIGILANCIA = {"abierta": False, "eventos": []}


def _escribe(modo, flags) -> bool:
    if isinstance(modo, str):
        return any(c in modo for c in "wax+")
    if isinstance(flags, int):
        return bool(flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_APPEND | os.O_TRUNC))
    return False


def _gancho(evento, args):
    if not _VIGILANCIA["abierta"]:
        return
    if evento in EVENTOS_DE_RED | EVENTOS_DE_PROCESO | EVENTOS_DE_ESCRITURA:
        _VIGILANCIA["eventos"].append((evento, repr(args)[:100]))
    elif evento == "open" and len(args) >= 3 and _escribe(args[1], args[2]):
        _VIGILANCIA["eventos"].append(("open-escritura", repr(args[:2])[:100]))


_GANCHO_PUESTO = []


@contextlib.contextmanager
def vigilar():
    """Anota, mientras dura, todo lo que sale a la red, escribe a disco o lanza un proceso (en cualquier
    hilo). `sys.addaudithook` no se puede quitar: el gancho se pone una vez y solo anota con la ventana
    abierta."""
    if not _GANCHO_PUESTO:
        sys.addaudithook(_gancho)
        _GANCHO_PUESTO.append(True)
    _VIGILANCIA["eventos"] = []
    _VIGILANCIA["abierta"] = True
    try:
        yield _VIGILANCIA["eventos"]
    finally:
        _VIGILANCIA["abierta"] = False


def test_un_recorrido_completo_no_abre_sockets_ni_escribe_archivos_ni_lanza_procesos(cliente, reloj, espias,
                                                                                    monkeypatch):
    monkeypatch.setattr(sys, "dont_write_bytecode", True)
    recorrido_completo(cliente, reloj)                      # calienta: las importaciones perezosas no cuentan
    with vigilar() as eventos:
        recorrido_completo(cliente, reloj)
    assert eventos == [], eventos
    assert espias.llamadas == []


def _mutacion_de_red():
    sys.audit("socket.connect", None, ("203.0.113.9", 80))           # sintético: no sale nada de la máquina


def _mutacion_de_dns():
    sys.audit("socket.getaddrinfo", "telemetria.invalid", 443, 0, 1, 0)


def _mutacion_de_proceso():
    sys.audit("subprocess.Popen", "/bin/true", ["true"], None, None)


def _mutacion_de_os_system():
    sys.audit("os.system", "true")


def _mutacion_de_escritura(ruta):
    def hacer():
        with open(ruta, "a", encoding="utf-8") as f:          # el texto de la persona, a un archivo
            f.write("texto de la persona\n")
    return hacer


def _mutacion_de_borrado(ruta):
    def hacer():
        ruta.write_text("x")
        os.remove(ruta)
    return hacer


@pytest.mark.parametrize("cual", ["red", "dns", "proceso", "os.system", "escritura", "borrado"])
def test_el_gancho_de_auditoria_cae_si_el_modo_prueba_sale_a_la_red_escribe_o_lanza_un_proceso(
        cliente, reloj, espias, monkeypatch, tmp_path, cual):
    """Las mutaciones del hallazgo (antes: 164 conexiones a un servidor de loopback y «274 passed»)."""
    mutaciones = {"red": _mutacion_de_red, "dns": _mutacion_de_dns, "proceso": _mutacion_de_proceso,
                  "os.system": _mutacion_de_os_system, "escritura": _mutacion_de_escritura(tmp_path / "t.txt"),
                  "borrado": _mutacion_de_borrado(tmp_path / "b.txt")}
    original = asistente.iniciar
    hecha = mutaciones[cual]

    def mutada(texto, usuario, ahora=None):
        hecha()
        return original(texto, usuario, ahora)
    monkeypatch.setattr(asistente, "iniciar", mutada)
    monkeypatch.setattr(sys, "dont_write_bytecode", True)
    recorrido_completo(cliente, reloj)
    with vigilar() as eventos:
        recorrido_completo(cliente, reloj)
    assert eventos, f"el gancho no vio la mutación «{cual}»"


def test_una_conexion_real_tambien_la_ve_el_gancho(tmp_path):
    """Un `connect` de verdad, a un socket de Unix que no existe (no hay red de por medio). Se llama al
    `connect` del tipo base, que el espía de `socket.socket.connect` no toca."""
    import _socket
    s = _socket.socket(_socket.AF_UNIX, _socket.SOCK_STREAM)
    try:
        with vigilar() as eventos:
            with pytest.raises(OSError):
                _socket.socket.connect(s, str(tmp_path / "no_hay.sock"))
    finally:
        s.close()
    assert [e for e, _ in eventos] == ["socket.connect"]


def test_las_rutas_que_necesitan_identidad_revientan_en_el_camino_publico():
    """Si alguien las colgara de /api/publico/, el candado de identidad las pararía: nunca atienden a un
    anónimo como si fuera el piloto."""
    with db.camino_publico():
        with pytest.raises(db.IdentidadEnCaminoPublico):
            automatiza_api.consultar("p1.x")
        with pytest.raises(db.IdentidadEnCaminoPublico):
            asyncio.run(automatiza_api.armar(None))


# ---------------------------------------------------------------------------
# 5 · la matriz de modo()

REAL_OK = {"ARMADO_REAL": "1", "AUTOMATIZA_ASISTENTE_REAL": "1", "CREDITOS_BACKEND": "postgres",
           "STATE_BACKEND": "postgres"}


@pytest.mark.parametrize("env,interruptor,cobro,esperado", [
    # ARMADO_REAL ausente (el armado de mentira): prueba, pase lo que pase con lo demás
    ({}, False, None, "prueba"),
    ({"AUTOMATIZA_ASISTENTE_REAL": "1"}, True, 30, "prueba"),
    ({**REAL_OK, "ARMADO_REAL": "0"}, True, 30, "prueba"),
    # ARMADO_REAL=1 solo = DEV hoy: prueba
    ({"ARMADO_REAL": "1"}, False, None, "prueba"),
    ({"ARMADO_REAL": "1", "CREDITOS_BACKEND": "postgres", "STATE_BACKEND": "postgres"}, True, 30, "prueba"),
    # los dos interruptores, pero algo falta: 503, no prueba
    ({"ARMADO_REAL": "1", "AUTOMATIZA_ASISTENTE_REAL": "1"}, False, None, "no_disponible"),
    (REAL_OK, False, 30, "no_disponible"),                                     # sin fila o apagada o sin topes
    (REAL_OK, True, None, "no_disponible"),                                    # falta cobro_por_uso
    (REAL_OK, True, 0, "no_disponible"),
    (REAL_OK, True, -3, "no_disponible"),
    (REAL_OK, True, True, "no_disponible"),                                    # un booleano no es un precio
    (REAL_OK, True, "30", "no_disponible"),
    (REAL_OK, True, 12.5, "no_disponible"),
    ({**REAL_OK, "CREDITOS_BACKEND": "off"}, True, 30, "no_disponible"),       # real NUNCA sin monedero
    ({**REAL_OK, "CREDITOS_BACKEND": "json"}, True, 30, "no_disponible"),
    ({**{k: v for k, v in REAL_OK.items() if k != "CREDITOS_BACKEND"}}, True, 30, "no_disponible"),
    ({**REAL_OK, "STATE_BACKEND": "json"}, True, 30, "no_disponible"),
    ({**{k: v for k, v in REAL_OK.items() if k != "STATE_BACKEND"}}, True, 30, "no_disponible"),
    # lo único que da real: las cinco cosas a la vez
    (REAL_OK, True, 30, "real"),
    (REAL_OK, True, 1, "real"),
    # solo el valor exacto «1» enciende
    ({**REAL_OK, "AUTOMATIZA_ASISTENTE_REAL": "true"}, True, 30, "prueba"),
    ({**REAL_OK, "AUTOMATIZA_ASISTENTE_REAL": " 1"}, True, 30, "prueba"),
    ({**REAL_OK, "AUTOMATIZA_ASISTENTE_REAL": "01"}, True, 30, "prueba"),
    ({**REAL_OK, "ARMADO_REAL": "true"}, True, 30, "prueba"),
    ({**REAL_OK, "AUTOMATIZA_ASISTENTE_REAL": ""}, True, 30, "prueba"),
])
def test_la_matriz_de_modo(env, interruptor, cobro, esperado):
    assert asistente.modo(env, interruptor_ok=interruptor, cobro_por_uso=cobro) == esperado


def test_modo_de_todas_las_combinaciones_contra_la_tabla():
    """Un oráculo escrito de la tabla del informe 05 §2.3, no de la función."""
    for armado, asist, interr, cobro, cred, estado in itertools.product(
            (None, "1", "0", "true"), (None, "1", "true", "0"), (False, True), (None, 0, 30),
            (None, "off", "json", "postgres"), (None, "json", "postgres")):
        env = {k: v for k, v in {"ARMADO_REAL": armado, "AUTOMATIZA_ASISTENTE_REAL": asist,
                                 "CREDITOS_BACKEND": cred, "STATE_BACKEND": estado}.items() if v is not None}
        if armado != "1" or asist != "1":
            esperado = "prueba"
        elif interr and cobro == 30 and cred == "postgres" and estado == "postgres":
            esperado = "real"
        else:
            esperado = "no_disponible"
        assert asistente.modo(env, interruptor_ok=interr, cobro_por_uso=cobro) == esperado, (env, interr, cobro)


def test_modo_lee_el_entorno_del_proceso_cuando_no_se_le_da_uno(monkeypatch):
    for k in REAL_OK:
        monkeypatch.delenv(k, raising=False)
    assert asistente.modo() == "prueba"
    monkeypatch.setenv("ARMADO_REAL", "1")
    assert asistente.modo() == "prueba"                               # DEV hoy
    monkeypatch.setenv("AUTOMATIZA_ASISTENTE_REAL", "1")
    assert asistente.modo() == "no_disponible"                        # y nadie le da base ni cobro en la Fase A
    for k, v in REAL_OK.items():
        monkeypatch.setenv(k, v)
    assert asistente.modo() == "no_disponible"                        # sin interruptor ni cobro, nunca real


def test_solo_la_prueba_se_sirve_hoy():
    assert asistente.sirve("prueba")
    assert not asistente.sirve("real") and not asistente.sirve("no_disponible") and not asistente.sirve("")


# ---------------------------------------------------------------------------
# 6 · las rutas

ESPERADAS = {("GET", "/api/automatiza/config"), ("POST", "/api/automatiza/armar"),
             ("GET", "/api/automatiza/armar/{id_}")}


def test_el_inventario_de_rutas_es_exactamente_el_del_contrato():
    from server.app import app
    paths = app.openapi()["paths"]
    reales = {(m.upper(), p) for p, ops in paths.items() if p.startswith("/api/automatiza")
              for m in ops if m in ("get", "post", "put", "patch", "delete")}
    assert reales == ESPERADAS, "una ruta nueva bajo /api/automatiza entra aquí a propósito, no por descuido"


def test_todo_bajo_api_automatiza_es_de_este_modulo_y_nada_de_el_cuelga_de_api_publico():
    from server.app import app
    assert {r.path for r in automatiza_api.router.routes} == {p for _, p in ESPERADAS}
    for ruta in automatiza_api.router.routes:
        assert ruta.path.startswith("/api/automatiza/"), ruta.path
        assert ruta.endpoint.__module__ == "server.automatiza_api"
        assert not auth.es_publica(ruta.path if ruta.path.endswith("/") else ruta.path + "/")
    # y ninguna ruta del prefijo público es de este módulo
    for ruta in app.routes:
        camino = getattr(ruta, "path", "")
        if auth.es_publica(camino if camino.endswith("/") else camino + "/"):
            assert getattr(getattr(ruta, "endpoint", None), "__module__", "") != "server.automatiza_api"


def test_el_router_se_monta_antes_del_montaje_de_static():
    """Si no, `/api/automatiza/*` caería en StaticFiles y contestaría su 404 en HTML."""
    fuente = (RAIZ / "server" / "app.py").read_text(encoding="utf-8")
    assert "include_router(automatiza_router)" in fuente
    assert fuente.index("include_router(automatiza_router)") < fuente.index('app.mount("/"')


def test_las_rutas_contestan_json_y_no_el_html_de_static(cliente):
    for ruta in ("/api/automatiza/config", "/api/automatiza/armar/p1.x"):
        r = cliente.get(ruta)
        assert r.headers["content-type"].startswith("application/json"), ruta


# ---------------------------------------------------------------------------
# 7 · la infra

def test_ningun_entorno_de_la_infra_enciende_el_modo_real():
    """La variable que enciende el modo real solo la pone el dueño, a propósito, con el costo a la vista:
    no aparece en infra/, ni en el Dockerfile, ni en los ejemplos de entorno, ni en las herramientas de
    SSM. (Cuando exista `Entorno.asistente_real`, esta prueba se cambia por la de DEV y PROD en False.)"""
    donde = [RAIZ / "infra", RAIZ / "worker", RAIZ / "Dockerfile", RAIZ / ".env.example",
             RAIZ / "tools" / "ssm_env.py", RAIZ / ".github"]
    revisados, encontrados = 0, []
    for base in donde:
        archivos = [base] if base.is_file() else [p for p in base.rglob("*") if p.is_file()] if base.exists() else []
        for p in archivos:
            if "__pycache__" in p.parts or p.suffix in {".pyc", ".png", ".jpg", ".zip"}:
                continue
            revisados += 1
            if asistente.VAR_ASISTENTE_REAL in p.read_text(encoding="utf-8", errors="ignore"):
                encontrados.append(p.relative_to(RAIZ).as_posix())
    assert revisados > 10, "el guardián no revisó nada: ¿cambió la estructura del repo?"
    assert encontrados == [], f"{asistente.VAR_ASISTENTE_REAL} aparece en {encontrados}"
    assert asistente.VAR_ASISTENTE_REAL == "AUTOMATIZA_ASISTENTE_REAL"
