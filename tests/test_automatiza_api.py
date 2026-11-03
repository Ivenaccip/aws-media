"""Asistente de Automatizaciones, Fase A — `server/automatiza_api.py`: el contrato HTTP de
GET /api/automatiza/config, POST /api/automatiza/armar y GET /api/automatiza/armar/{id}.

El reloj se inyecta (`reloj.t`) y toda frontera de gasto tiene un espía (`espias`): cada prueba de este
archivo termina comprobando que NADIE llamó a la base, la cola, un modelo, la moderación ni los créditos.
Sin red.
"""
import http.client
import importlib
import json
import logging
import re
import socket
import urllib.request

import pytest
from fastapi.testclient import TestClient

from pipeline import (armado, asistente, claude_rag, creditos, db, embeddings, jobs, llm, moderacion,
                      vectores)
from pipeline import publico as freno
from server import auth, automatiza_api
from test_automatiza_idioma import voseo

T0 = 1_760_000_000.0
TEXTO = "Quiero que cuando llegue un correo de un cliente, una IA le conteste"
SECRETO = "ZORRO-VIOLETA-731"            # una palabra que ningún log ni respuesta debe repetir
RUTAS = ("/api/automatiza/config", "/api/automatiza/armar", "/api/automatiza/armar/p1.x")

# toda frontera por donde saldría dinero, texto de la gente, una escritura o una conexión: (módulo, nombre)
FRONTERAS = [
    (db, "ejecutar"), (db, "_cliente"),
    (jobs, "encolar_publico"), (jobs, "_sqs"), (jobs, "_sfn"),
    (moderacion, "revisar"),
    (creditos, "cobrar"), (creditos, "devolver_unica"),
    (claude_rag, "pedir_json"), (claude_rag, "cliente"),
    (armado, "armar"), (armado, "generar"),
    (embeddings, "embeber"), (embeddings, "cliente"), (embeddings, "cliente_openai"),
    (embeddings, "cliente_bedrock"),
    (vectores, "consultar"), (vectores, "cliente"),
    (llm, "client"), (llm, "client_publico"), (llm, "client_sin_trazas"), (llm, "chat_texto"),
    (llm, "chat_json"),
    # la red y los proveedores que el repo sí usa (H seg-1: antes no había espía para ninguno de estos).
    # No se espían `subprocess.Popen` ni `httpx.Client.send`: los usa el propio arnés de pruebas.
    (socket.socket, "connect"), (socket.socket, "connect_ex"), (socket, "create_connection"),
    (urllib.request, "urlopen"), (urllib.request.OpenerDirector, "open"),
    (http.client.HTTPConnection, "connect"), (http.client.HTTPSConnection, "connect"),
]
# módulos que el repo instala (requirements.txt): cada uno con las puertas por donde habla
_DE_TERCEROS = [("requests.sessions", "Session", ("request", "send")),
                ("fal_client", None, ("subscribe", "run", "submit", "upload", "upload_file")),
                ("claude_agent_sdk", None, ("query",)), ("claude_agent_sdk", "ClaudeSDKClient", ("connect",)),
                ("boto3", None, ("client", "resource"))]
for _mod, _clase, _nombres in _DE_TERCEROS:
    try:
        _m = importlib.import_module(_mod)
    except ImportError:                       # no instalado: no hay nada que espiar
        continue
    FRONTERAS += [(getattr(_m, _clase) if _clase else _m, n) for n in _nombres]


def etiqueta(modulo, nombre) -> str:
    return f"{modulo.__name__}.{nombre}"


class Espias:
    """Cada frontera de `FRONTERAS` anota que la llamaron y revienta: ni un recorrido completo del
    Asistente en prueba debe tocarlas."""

    def __init__(self, monkeypatch):
        self.llamadas: list[str] = []
        for modulo, nombre in FRONTERAS:
            # raising=True: si se renombra, cae
            monkeypatch.setattr(modulo, nombre, self._espia(etiqueta(modulo, nombre)))

    def _espia(self, etiqueta):
        def espia(*a, **kw):
            self.llamadas.append(etiqueta)
            raise AssertionError(f"el Asistente en prueba llamó a {etiqueta}")
        return espia


class Reloj:
    def __init__(self):
        self.t = T0

    def avanzar(self, seg):
        self.t += seg


@pytest.fixture(autouse=True)
def _entorno(monkeypatch):
    """El entorno de la máquina no manda: ni Cognito, ni el armado real, ni el modo real."""
    for v in ("COGNITO_POOL_ID", "COGNITO_CLIENT_ID", "ARMADO_REAL", "AUTOMATIZA_ASISTENTE_REAL",
              "CREDITOS_BACKEND", "STATE_BACKEND"):
        monkeypatch.delenv(v, raising=False)
    monkeypatch.setenv("DEFAULT_USER_ID", "u1")


@pytest.fixture
def espias(monkeypatch):
    return Espias(monkeypatch)


@pytest.fixture(autouse=True)
def _sin_gasto(espias):
    yield
    assert espias.llamadas == [], f"se tocó una frontera de gasto: {espias.llamadas}"


@pytest.fixture
def reloj(monkeypatch):
    r = Reloj()
    monkeypatch.setattr(asistente, "reloj", lambda: r.t)
    return r


@pytest.fixture
def cliente(reloj):
    from server.app import app
    return TestClient(app)


def pedir(cliente, texto=TEXTO):
    return cliente.post("/api/automatiza/armar", json={"texto": texto})


def detalle(r):
    d = r.json()["detail"]
    assert isinstance(d, dict), f"el detail debe ser un objeto, no {type(d).__name__}"
    assert {"codigo", "texto"} <= set(d)
    return d


def sin_cache(r):
    assert r.headers["cache-control"] == "no-store"


# ---------------------------------------------------------------------------
# GET /config

def test_config_en_prueba(cliente):
    r = cliente.get("/api/automatiza/config")
    assert r.status_code == 200
    assert r.json() == {"activo": True, "modo": "prueba", "gratis": True, "costo_creditos": 0,
                        "largo_minimo": 20, "largo_maximo": 1500, "cupo": None}
    sin_cache(r)


def test_config_trae_los_limites_del_pedido_de_publico_y_no_los_del_mockup(cliente, monkeypatch):
    """D15: la pantalla toma 20-1500 de la API (hoy), no los 600 del mockup; y los toma de
    `pipeline/publico.py`, así que si el dueño pone su número, el Asistente lo sigue."""
    c = cliente.get("/api/automatiza/config").json()
    assert (c["largo_minimo"], c["largo_maximo"]) == (freno.LARGO_MINIMO, freno.LARGO_MAXIMO) == (20, 1500)
    monkeypatch.setattr(freno, "LARGO_MAXIMO", 800)
    assert cliente.get("/api/automatiza/config").json()["largo_maximo"] == 800


def test_con_armado_real_solo_como_en_dev_el_asistente_sigue_en_prueba(cliente, monkeypatch):
    """`ARMADO_REAL=1` ya está encendido en DEV para el worker público. Con solo eso, el Asistente NO
    pasa a real: sigue en prueba y no gasta."""
    monkeypatch.setenv("ARMADO_REAL", "1")
    assert cliente.get("/api/automatiza/config").json()["modo"] == "prueba"
    r = pedir(cliente)
    assert r.status_code == 202 and r.json()["modo"] == "prueba"


def test_con_el_interruptor_del_asistente_solo_sigue_en_prueba(cliente, monkeypatch):
    monkeypatch.setenv("AUTOMATIZA_ASISTENTE_REAL", "1")
    assert cliente.get("/api/automatiza/config").json()["modo"] == "prueba"
    assert pedir(cliente).status_code == 202


@pytest.mark.parametrize("extra", [
    {},
    {"CREDITOS_BACKEND": "postgres", "STATE_BACKEND": "postgres"},      # aun con todo lo demás en regla
])
def test_modo_real_mal_configurado_o_sin_implementar_no_degrada_a_prueba(cliente, monkeypatch, extra):
    """El real todavía no existe. Pedirlo NO muestra un ejemplo enlatado como si fuera el flujo de la
    persona: la config lo dice apagado y las otras dos rutas contestan 503."""
    id_ = pedir(cliente).json()["id"]
    cliente.get("/api/automatiza/armar/" + id_).raise_for_status()
    monkeypatch.setenv("ARMADO_REAL", "1")
    monkeypatch.setenv("AUTOMATIZA_ASISTENTE_REAL", "1")
    for k, v in extra.items():
        monkeypatch.setenv(k, v)
    c = cliente.get("/api/automatiza/config")
    assert c.status_code == 200
    assert c.json() == {"activo": False, "modo": "no_disponible", "gratis": False, "costo_creditos": None,
                        "largo_minimo": 20, "largo_maximo": 1500, "cupo": None,
                        "texto": "El Asistente no está disponible por ahora. Inténtalo en unos minutos."}
    for r in (pedir(cliente), cliente.post("/api/automatiza/armar", json={}),
              cliente.get("/api/automatiza/armar/" + id_)):
        assert r.status_code == 503 and detalle(r)["codigo"] == "no_disponible"
        sin_cache(r)


def test_las_muestras_rotas_son_503_sin_detalles(cliente, monkeypatch, caplog):
    id_ = pedir(cliente).json()["id"]

    def rotas():
        raise asistente.MuestrasInvalidas("el archivo está roto en /home/secreto/archivo.json")
    monkeypatch.setattr(asistente, "muestras", rotas)
    caplog.set_level(logging.DEBUG)
    for r in (pedir(cliente), cliente.get("/api/automatiza/armar/" + id_)):
        assert r.status_code == 503 and detalle(r)["codigo"] == "no_disponible"
        assert "secreto" not in r.text and "roto" not in r.text
        sin_cache(r)
    assert "automatiza: las muestras de prueba están rotas" in caplog.text


# ---------------------------------------------------------------------------
# POST /armar

def test_armar_responde_202_con_el_contrato(cliente):
    r = pedir(cliente)
    assert r.status_code == 202
    cuerpo = r.json()
    assert set(cuerpo) == {"id", "estado", "modo", "paso", "costo_creditos"}
    assert (cuerpo["estado"], cuerpo["modo"], cuerpo["paso"], cuerpo["costo_creditos"]) == (
        "armando", "prueba", "entender", 0)
    assert cuerpo["id"].startswith("p1.") and len(cuerpo["id"]) <= 120
    sin_cache(r)


def test_armar_recorta_el_texto_y_no_lo_devuelve(cliente):
    r = pedir(cliente, f"   {SECRETO} {TEXTO}  \n")
    assert r.status_code == 202 and SECRETO not in r.text


@pytest.mark.parametrize("cuerpo,codigo,status", [
    ({}, "vacio", 422),
    ({"texto": None}, "vacio", 422),
    ({"texto": ""}, "vacio", 422),
    ({"texto": "   \n\t "}, "vacio", 422),
    ({"texto": 123}, "cuerpo", 422),
    ({"texto": True}, "cuerpo", 422),
    ({"texto": ["quiero", "responder", "correos"]}, "cuerpo", 422),
    ({"texto": {"a": 1}}, "cuerpo", 422),
    ({"texto": "hola"}, "corto", 422),
    ({"texto": "a" * 19}, "corto", 422),
    ({"texto": "a" * 1501}, "largo", 422),
    ({"texto": "pedido con un nulo \u0000 en medio, largo suficiente"}, "texto_invalido", 422),
    ({"otra": "cosa"}, "vacio", 422),
    ([], "cuerpo", 422),
    ([TEXTO], "cuerpo", 422),
    (None, "cuerpo", 422),
    (42, "cuerpo", 422),
    (TEXTO, "cuerpo", 422),
])
def test_los_pedidos_mal_hechos_dan_un_error_con_codigo_y_texto(cliente, cuerpo, codigo, status):
    r = cliente.post("/api/automatiza/armar", json=cuerpo)
    assert r.status_code == status, r.text
    d = detalle(r)
    assert d["codigo"] == codigo and d["texto"]
    sin_cache(r)


def test_corto_y_largo_dicen_los_limites(cliente):
    corto = detalle(pedir(cliente, "hola"))
    assert corto == {"codigo": "corto", "texto": "Cuéntanos un poco más: al menos 20 caracteres.",
                     "minimo": 20}
    largo = detalle(pedir(cliente, "a" * 1501))
    assert largo == {"codigo": "largo", "texto": "Es demasiado largo: máximo 1500 caracteres.",
                     "maximo": 1500}


def test_el_texto_justo_en_los_limites_pasa(cliente):
    assert pedir(cliente, "a" * 20).status_code == 202
    assert pedir(cliente, "ñ" * 1500).status_code == 202


@pytest.mark.parametrize("crudo", [b"", b"{", b"no es json", b"\xff\xfe\x00", b"{\"texto\": }", b"\x00"])
def test_un_cuerpo_que_no_es_json_es_cuerpo_y_no_filtra_nada(cliente, crudo):
    r = cliente.post("/api/automatiza/armar", content=crudo, headers={"content-type": "application/json"})
    assert r.status_code == 422 and detalle(r)["codigo"] == "cuerpo"
    assert isinstance(r.json()["detail"], dict)                 # nunca la lista técnica de FastAPI


def test_un_sustituto_suelto_es_texto_invalido(cliente):
    crudo = b'{"texto": "pedido con un sustituto \\ud800 suelto y texto de sobra"}'
    r = cliente.post("/api/automatiza/armar", content=crudo, headers={"content-type": "application/json"})
    assert r.status_code == 422 and detalle(r)["codigo"] == "texto_invalido"


def test_un_cuerpo_de_mas_de_64_kib_se_corta_sin_leer_el_resto(cliente):
    enorme = json.dumps({"texto": "a" * (64 * 1024 + 10)}).encode()
    r = cliente.post("/api/automatiza/armar", content=enorme, headers={"content-type": "application/json"})
    assert r.status_code == 422 and detalle(r) == {
        "codigo": "largo", "texto": "Es demasiado largo: máximo 1500 caracteres.", "maximo": 1500}


def test_un_cuerpo_por_trozos_se_cuenta_por_lo_que_llega_y_no_por_lo_que_dice_el_encabezado(cliente):
    def trozos(n):
        for _ in range(n):
            yield b"a" * 8192
    r = cliente.post("/api/automatiza/armar", content=trozos(9), headers={"content-type": "application/json"})
    assert r.status_code == 422 and detalle(r)["codigo"] == "largo"
    # y uno chico, partido en trozos, se lee entero
    parte = json.dumps({"texto": TEXTO}).encode()
    ok = cliente.post("/api/automatiza/armar", content=iter([parte[:10], parte[10:]]),
                      headers={"content-type": "application/json"})
    assert ok.status_code == 202


def test_el_servicio_apagado_gana_a_un_cuerpo_malo(cliente, monkeypatch):
    monkeypatch.setenv("ARMADO_REAL", "1")
    monkeypatch.setenv("AUTOMATIZA_ASISTENTE_REAL", "1")
    r = cliente.post("/api/automatiza/armar", content=b"{", headers={"content-type": "application/json"})
    assert r.status_code == 503 and detalle(r)["codigo"] == "no_disponible"


# ---------------------------------------------------------------------------
# GET /armar/{id}: el reloj

def estado(cliente, id_):
    r = cliente.get("/api/automatiza/armar/" + id_)
    assert r.status_code == 200, r.text
    sin_cache(r)
    return r.json()


def test_el_estado_avanza_con_el_reloj_y_termina_listo(cliente, reloj):
    id_ = pedir(cliente).json()["id"]
    vistos = []
    for _ in range(4):
        v = estado(cliente, id_)
        vistos.append((v["estado"], v["paso"]))
        reloj.avanzar(1.2)
    assert vistos == [("armando", "entender"), ("armando", "buscar"), ("armando", "armar"),
                      ("armando", "revisar")]
    v = estado(cliente, id_)
    assert (v["estado"], v["listo"], v["lleva_seg"], v["modo"]) == ("listo", True, 4, "prueba")
    reloj.avanzar(1800)
    assert estado(cliente, id_) == v                       # sigue ahí, igual, media hora después


def test_el_listo_trae_el_flujo_de_n8n_y_el_grafo_del_constructor(cliente, reloj):
    from pipeline import validador
    id_ = pedir(cliente).json()["id"]
    reloj.avanzar(6)
    v = estado(cliente, id_)
    assert list(v) == ["id", "estado", "listo", "modo", "lleva_seg", "nombre", "resumen", "nodos",
                       "pendientes", "advertencias", "flujo", "grafo"]
    assert v["nombre"] == v["flujo"]["name"] == "Responder correos de clientes"
    assert validador.validar(v["flujo"]).ok
    assert v["grafo"]["nombreFlujo"] == v["nombre"] and v["grafo"]["nodes"] and v["grafo"]["edges"]
    assert v["pendientes"] == ["Conecta tu cuenta de Gmail en n8n y elige el destinatario.",
                               "Conecta tu cuenta de OpenAI en n8n.",
                               "Conecta tu cuenta de Google Sheets en n8n y elige el documento y la hoja."]
    assert v["nodos"][1] == {"tipo": "@n8n/n8n-nodes-langchain.agent", "nombre": "AI Agent",
                             "etiqueta": "Agente de IA", "nombre_en_flujo": "Atención por correo"}


@pytest.mark.parametrize("pedido,nombre", [
    ("Un chat en mi sitio donde una IA responda las preguntas de mis clientes", "Asistente de preguntas frecuentes"),
    ("Todas las mañanas quiero un resumen de lo importante en mi bandeja", "Resumen diario"),
])
def test_cada_pedido_trae_su_muestra_con_grafo(cliente, reloj, pedido, nombre):
    id_ = pedir(cliente, pedido).json()["id"]
    reloj.avanzar(6)
    v = estado(cliente, id_)
    assert v["nombre"] == nombre and v["grafo"]["nombreFlujo"] == nombre


def test_un_pedido_fuera_de_cobertura_termina_en_sin_cobertura_sin_flujo(cliente, reloj):
    id_ = pedir(cliente, "Cada que entre un lead nuevo en HubSpot avísame por Slack").json()["id"]
    assert estado(cliente, id_)["estado"] == "armando"
    reloj.avanzar(6)
    v = estado(cliente, id_)
    assert v["estado"] == "sin_cobertura" and v["listo"] is False
    assert list(v) == ["id", "estado", "listo", "modo", "lleva_seg", "mensaje", "faltan"]
    assert v["mensaje"] == "Todavía no sabemos armar esto con n8n."
    assert isinstance(v["faltan"], list) and 1 <= len(v["faltan"]) <= 10
    assert all(isinstance(x, str) and len(x) <= 200 for x in v["faltan"])


def test_las_llaves_de_cada_estado_son_exactamente_la_lista_blanca(cliente, reloj):
    prohibidas = {"uso", "modelo", "fuentes", "intentos", "costo_usd", "ip_hash", "texto"}
    pedidos = [TEXTO, "un resumen de lo importante cada día", "un chat de preguntas frecuentes",
               "algo con HubSpot por favor, gracias"]
    for pedido in pedidos:
        reloj.t = T0
        creado = pedir(cliente, pedido).json()
        assert set(creado) == {"id", "estado", "modo", "paso", "costo_creditos"}
        for despues in (0, 1.2, 2.4, 3.6, 4.8, 6, 60):
            reloj.t = T0 + despues
            v = estado(cliente, creado["id"])
            permitidas = set(asistente.LLAVES_BASE) | set(asistente.LLAVES_POR_ESTADO[v["estado"]])
            assert set(v) <= permitidas and set(asistente.LLAVES_BASE) <= set(v), (pedido, despues, set(v))
            assert not prohibidas & set(v)
            assert v["id"] == creado["id"] and v["modo"] == "prueba"


def test_el_costo_en_prueba_es_cero_y_no_hay_saldo(cliente, reloj):
    creado = pedir(cliente).json()
    assert creado["costo_creditos"] == 0 and "saldo" not in creado
    reloj.avanzar(6)
    assert "costo_creditos" not in estado(cliente, creado["id"])


# ---------------------------------------------------------------------------
# ids: 404 siempre, nunca 403

def no_encontrada(r):
    assert r.status_code == 404, r.text
    assert detalle(r)["codigo"] == "no_encontrada"
    sin_cache(r)


@pytest.mark.parametrize("id_", [
    "nada", "p1.", "p1.x", "p1.eyJ", "AbCdEfGhIjKlMnOp", "p1." + "A" * 500, "p1.%C3%B1",
    "p1.eyJtIjoiY29ycmVvcyIsInQiOjEsInUiOiJ4In0",
])
def test_un_id_mal_formado_es_404_sin_tocar_nada(cliente, id_):
    no_encontrada(cliente.get("/api/automatiza/armar/" + id_))


@pytest.mark.parametrize("id_", ["p1.a%2Fb", "p1./x", "..", "%2e%2e"])
def test_un_id_con_barras_ni_siquiera_casa_con_la_ruta(cliente, id_):
    """Con una barra (o un rodeo con puntos) el camino ya no es el de `/armar/{id}`: 404 de todos modos."""
    assert cliente.get("/api/automatiza/armar/" + id_).status_code in (404, 405)


def test_el_id_de_otra_persona_es_404(cliente, monkeypatch):
    monkeypatch.setenv("DEFAULT_USER_ID", "ana")
    de_ana = pedir(cliente).json()["id"]
    assert cliente.get("/api/automatiza/armar/" + de_ana).status_code == 200
    monkeypatch.setenv("DEFAULT_USER_ID", "beto")
    no_encontrada(cliente.get("/api/automatiza/armar/" + de_ana))
    monkeypatch.setenv("DEFAULT_USER_ID", "ana")
    assert cliente.get("/api/automatiza/armar/" + de_ana).status_code == 200


def test_un_id_caduca_a_la_hora_y_uno_del_futuro_no_existe(cliente, reloj):
    id_ = pedir(cliente).json()["id"]
    reloj.t = T0 + 3600
    assert cliente.get("/api/automatiza/armar/" + id_).status_code == 200
    reloj.t = T0 + 3601
    no_encontrada(cliente.get("/api/automatiza/armar/" + id_))
    reloj.t = T0 - 120                                   # un reloj muy atrasado: el id «viene del futuro»
    no_encontrada(cliente.get("/api/automatiza/armar/" + id_))
    reloj.t = T0 - 30                                    # dentro de la holgura de un minuto
    assert estado(cliente, id_)["paso"] == "entender"


def test_los_ids_no_se_pueden_listar_ni_adivinar(cliente):
    """Solo existen las tres rutas del contrato, y GET /armar sin id no es ninguna de ellas."""
    r = cliente.get("/api/automatiza/armar")
    assert r.status_code in (404, 405)
    assert cliente.get("/api/automatiza/").status_code in (404, 405)


# ---------------------------------------------------------------------------
# privacidad: el texto de la persona no queda en ninguna parte

def test_el_texto_no_aparece_en_respuestas_cabeceras_ni_logs(cliente, reloj, caplog):
    caplog.set_level(logging.DEBUG)
    texto = f"{SECRETO} quiero responder los correos de mis clientes con una IA"
    creado = pedir(cliente, texto)
    visto = [creado]
    for despues in (0, 3, 6):
        reloj.t = T0 + despues
        visto.append(cliente.get("/api/automatiza/armar/" + creado.json()["id"]))
    visto.append(pedir(cliente, SECRETO + " a"))                      # y un error de «corto»
    visto.append(cliente.get("/api/automatiza/config"))
    for r in visto:
        assert SECRETO not in r.text and SECRETO not in str(dict(r.headers)), r.request.url
    assert SECRETO not in caplog.text
    for rec in caplog.records:
        assert SECRETO not in rec.getMessage() and SECRETO not in repr(rec.args), rec.name


def test_el_log_del_pedido_lleva_solo_la_muestra_y_el_largo(cliente, caplog):
    caplog.set_level(logging.INFO, logger="automatiza_api")
    texto = f"{SECRETO} quiero responder correos"
    pedir(cliente, texto)
    lineas = [r.getMessage() for r in caplog.records if r.name == "automatiza_api"]
    assert lineas == [f"automatiza: armar · modo=prueba · muestra=correos · chars={len(texto)}"]


def test_ninguna_respuesta_deja_llaves_ni_secretos(cliente, reloj, monkeypatch):
    """Ni una clave de proveedor del entorno ni nada que case con `validador.SECRETOS` sale en el JSON."""
    from pipeline import validador
    centinelas = {"CLAUDE_API_KEY": "centinela-claude-111", "OPENAI_API_KEY": "centinela-openai-222",
                  "GEMINI_API_KEY": "centinela-gemini-333", "AUTOMATIZA_SAL_IP": "centinela-sal-444",
                  "SSM_OPENAI_PUBLICO": "centinela-ssm-555"}
    for k, v in centinelas.items():
        monkeypatch.setenv(k, v)
    cuerpos = []
    for pedido in (TEXTO, "un chat de preguntas frecuentes", "un resumen de lo importante",
                   "algo con HubSpot que quiero automatizar"):
        reloj.t = T0
        creado = pedir(cliente, pedido)
        cuerpos.append(creado)
        for despues in (0, 6):
            reloj.t = T0 + despues
            cuerpos.append(cliente.get("/api/automatiza/armar/" + creado.json()["id"]))
    cuerpos.append(cliente.get("/api/automatiza/config"))
    for r in cuerpos:
        crudo = r.text + str(dict(r.headers))
        assert not [v for v in centinelas.values() if v in crudo]
        assert not [p.pattern for p in validador.SECRETOS if p.search(crudo)]


# ---------------------------------------------------------------------------
# los textos

def test_el_catalogo_de_errores_esta_completo_y_en_espanol_latam():
    for codigo, (status, texto) in automatiza_api.ERRORES.items():
        assert isinstance(status, int) and 400 <= status < 600, codigo
        e = automatiza_api.falla(codigo, minimo=20, maximo=1500)
        assert e.status_code == status and e.detail["codigo"] == codigo
        assert e.detail["texto"] and "{" not in e.detail["texto"] and e.detail["texto"].endswith(".")
        assert voseo(e.detail["texto"]) == [], (codigo, e.detail["texto"])
        assert e.headers == {"Cache-Control": "no-store"}
    # los de la Fase B existen para que la pantalla ya los conozca
    assert {"moderacion", "en_curso", "agotado", "sin_saldo", "no_nube"} <= set(automatiza_api.ERRORES)


def test_las_copias_de_corto_y_largo_son_las_de_la_pagina_publica():
    from server import publico_api
    assert automatiza_api.falla("corto", minimo=freno.LARGO_MINIMO).detail["texto"] == \
        publico_api.MENSAJES[freno.CORTO]
    assert automatiza_api.falla("largo", maximo=freno.LARGO_MAXIMO).detail["texto"] == \
        publico_api.MENSAJES[freno.LARGO]


# ---------------------------------------------------------------------------
# la sesión

def test_las_tres_rutas_estan_protegidas_por_el_prefijo_de_auth():
    """Fuera de /api/publico/: caen en `PREFIJOS_PROTEGIDOS` y no están en las excepciones públicas. Si
    alguien angosta ese prefijo o agrega una excepción, esto cae."""
    assert "/api/" in auth.PREFIJOS_PROTEGIDOS
    for ruta in RUTAS:
        assert ruta.startswith(auth.PREFIJOS_PROTEGIDOS), ruta
        assert ruta not in auth.RUTAS_PUBLICAS and not auth.es_publica(ruta), ruta
    assert not any(p.startswith("/api/automatiza") for p in auth.RUTAS_PUBLICAS)
    assert not any(p.startswith("/api/automatiza") for p in auth.PREFIJOS_PUBLICOS)


@pytest.fixture
def con_cognito(monkeypatch, reloj):
    monkeypatch.setenv("COGNITO_POOL_ID", "us-east-1_TESTPOOL")
    monkeypatch.setenv("COGNITO_CLIENT_ID", "clienteweb123")

    def verificar(token):
        if token.startswith("OK-"):
            return {"sub": "sub-" + token[3:]}
        raise ValueError("token inválido")
    monkeypatch.setattr(auth, "verificar", verificar)
    from server.app import app
    return TestClient(app)


def con(token):
    return {"Authorization": f"Bearer {token}"}


def test_sin_token_las_tres_rutas_dan_401(con_cognito):
    for metodo, ruta in (("GET", "/api/automatiza/config"), ("POST", "/api/automatiza/armar"),
                         ("GET", "/api/automatiza/armar/p1.x")):
        r = con_cognito.request(metodo, ruta, json={"texto": TEXTO} if metodo == "POST" else None)
        assert r.status_code == 401, (metodo, ruta)


def test_con_un_token_malo_o_vencido_tambien_401(con_cognito):
    for ruta in ("/api/automatiza/config", "/api/automatiza/armar/p1.x"):
        assert con_cognito.get(ruta, headers=con("MALO")).status_code == 401
    assert con_cognito.post("/api/automatiza/armar", json={"texto": TEXTO},
                            headers=con("MALO")).status_code == 401


def test_con_sesion_el_id_queda_atado_al_sub_del_token(con_cognito, reloj):
    assert con_cognito.get("/api/automatiza/config", headers=con("OK-ana")).status_code == 200
    r = con_cognito.post("/api/automatiza/armar", json={"texto": TEXTO}, headers=con("OK-ana"))
    assert r.status_code == 202
    id_ = r.json()["id"]
    assert con_cognito.get("/api/automatiza/armar/" + id_, headers=con("OK-ana")).status_code == 200
    ajeno = con_cognito.get("/api/automatiza/armar/" + id_, headers=con("OK-beto"))
    assert ajeno.status_code == 404 and detalle(ajeno)["codigo"] == "no_encontrada"       # 404, no 403
    # la cookie `token` también abre la puerta (así lo hace la web), con el mismo dueño
    con_cognito.cookies.set("token", "OK-ana")
    try:
        assert con_cognito.get("/api/automatiza/armar/" + id_).status_code == 200
    finally:
        con_cognito.cookies.clear()


# ---------------------------------------------------------------------------
# revisión del backend · hallazgos arreglados (cada prueba nació fallando; ver el resumen del arreglo)

def _id_con(**carga):
    from test_automatiza_asistente import forjar
    return forjar(**carga)


@pytest.mark.parametrize("carga", [
    {"u": "\ud800"}, {"u": "\udfff"}, {"u": "ab\ud800cdef01234"}, {"m": "\ud800"}, {"m": "correos\udc00"},
], ids=["u-sust-alto", "u-sust-bajo", "u-sust-en-medio", "m-sust", "m-sust-al-final"])
def test_un_id_con_un_sustituto_suelto_es_404_y_no_500(cliente, carga):
    """H seg-2 / contrato-4: `u.encode("utf-8")` reventaba con UnicodeEncodeError y la API daba 500 de texto
    plano y sin `no-store`. Un id forjado es siempre 404 JSON, sin distinguir el motivo."""
    no_encontrada(cliente.get("/api/automatiza/armar/" + _id_con(**carga)))


def test_cualquier_fallo_inesperado_al_leer_un_id_es_503_sin_detalles_y_sin_cache(cliente, monkeypatch, caplog):
    """La red de seguridad: lo que ningún caso previó no sale como un 500 de texto plano, sin `no-store`, ni
    deja en el log el mensaje de la excepción (podría traer texto de la persona)."""
    id_ = pedir(cliente).json()["id"]

    def revienta(*a, **kw):
        raise RuntimeError(f"{SECRETO} /home/secreto/archivo")
    monkeypatch.setattr(asistente, "leer_id", revienta)
    monkeypatch.setattr(asistente, "iniciar", revienta)
    caplog.set_level(logging.DEBUG)
    for r in (cliente.get("/api/automatiza/armar/" + id_), pedir(cliente)):
        assert r.status_code == 503 and detalle(r)["codigo"] == "no_disponible", r.text
        assert SECRETO not in r.text and "secreto" not in r.text
        sin_cache(r)
    assert "RuntimeError" in caplog.text
    assert SECRETO not in caplog.text and "secreto" not in caplog.text


def test_la_config_de_un_modo_mal_configurado_dice_no_disponible_y_trae_su_texto(cliente, monkeypatch):
    """H seg-3 / contrato-9: antes decía `modo: "real"` y no traía texto para el estado apagado."""
    monkeypatch.setenv("ARMADO_REAL", "1")
    monkeypatch.setenv("AUTOMATIZA_ASISTENTE_REAL", "1")
    c = cliente.get("/api/automatiza/config").json()
    assert c["activo"] is False and c["modo"] == "no_disponible" and c["gratis"] is False
    assert c["costo_creditos"] is None and c["cupo"] is None
    assert c["texto"] == automatiza_api.ERRORES["no_disponible"][1]


def test_la_config_en_prueba_no_trae_texto(cliente):
    assert "texto" not in cliente.get("/api/automatiza/config").json()


def _correr_leer_json(content_length: bytes, cuerpo: bytes = b'{"texto":"x"}'):
    import asyncio
    from starlette.requests import Request
    entregado = {"v": False}

    async def receive():
        if not entregado["v"]:
            entregado["v"] = True
            return {"type": "http.request", "body": cuerpo, "more_body": False}
        return {"type": "http.disconnect"}
    scope = {"type": "http", "method": "POST", "path": "/api/automatiza/armar", "query_string": b"",
             "headers": [(b"content-length", content_length)]}
    return asyncio.run(automatiza_api._leer_json(Request(scope, receive)))


@pytest.mark.parametrize("cabecera", [b"\xb2", b"9" * 5000, b"\xb2" * 3, b"9" * 5000 + b"\xb2", b"0" * 5000, b" ",
                                      b"-1", b"1e3", b"1.5"],
                         ids=["superindice", "5000-digitos", "superindices", "digitos-y-superindice",
                              "5000-ceros", "espacio", "negativo", "exponente", "decimal"])
def test_un_content_length_raro_no_revienta_leer_json(cabecera):
    """H seg-4: `str.isdigit()` es verdadero para «²» y para 5000 dígitos, y `int()` fallaba con ValueError.
    Con uvicorn no llega (contesta 400 antes), pero detrás de otra puerta sí podría."""
    try:
        cuerpo = _correr_leer_json(cabecera)
    except Exception as err:               # lo que se acepta: el error del contrato, nunca un ValueError
        assert getattr(err, "status_code", None) == 422, repr(err)
        assert err.detail["codigo"] in ("largo", "cuerpo"), err.detail
    else:
        assert cuerpo == {"texto": "x"}


def test_un_content_length_gigante_es_largo_sin_convertirlo_a_entero():
    with pytest.raises(Exception) as e:
        _correr_leer_json(b"9" * 5000)
    assert e.value.status_code == 422 and e.value.detail["codigo"] == "largo"
    with pytest.raises(Exception) as e:
        _correr_leer_json(str(64 * 1024 + 1).encode())
    assert e.value.detail["codigo"] == "largo"
    assert _correr_leer_json(str(64 * 1024).encode()) == {"texto": "x"}      # justo en el tope: pasa
    assert _correr_leer_json(b"0000000013") == {"texto": "x"}                # ceros a la izquierda


@pytest.mark.parametrize("crudo", [b"[" * 30000, b'{"texto": ' + b"9" * 5000 + b"}", b'{"a":' * 10000],
                         ids=["anidado", "entero-de-5000-digitos", "objetos-anidados"])
def test_un_json_muy_anidado_o_con_un_entero_gigante_es_cuerpo_y_no_500(cliente, crudo):
    """H contrato-5: `except Exception` en `_leer_json` es lo que lo vuelve 422 (RecursionError no es
    ValueError). Si alguien lo angosta, esta prueba cae."""
    r = cliente.post("/api/automatiza/armar", content=crudo, headers={"content-type": "application/json"})
    assert r.status_code == 422 and detalle(r)["codigo"] == "cuerpo", r.status_code
    sin_cache(r)


def test_toda_respuesta_de_los_manejadores_lleva_no_store_y_la_de_enrutado_no_lo_promete(cliente, reloj):
    """H contrato-10: el docstring decía «todo responde no-store, errores incluidos». Lo cierto: las
    respuestas de los tres manejadores (éxitos y errores); el 404/405 del ENRUTADO y el 401 de la sesión los
    pone otra capa y el docstring lo dice."""
    id_ = pedir(cliente).json()["id"]
    reloj.avanzar(6)
    propias = [cliente.get("/api/automatiza/config"), pedir(cliente), pedir(cliente, "hola"),
               pedir(cliente, "a" * 2000), cliente.post("/api/automatiza/armar", json=[]),
               cliente.get("/api/automatiza/armar/" + id_), cliente.get("/api/automatiza/armar/p1.x"),
               cliente.get("/api/automatiza/armar/" + _id_con(u="\ud800"))]
    for r in propias:
        sin_cache(r)
    ajenas = [cliente.get("/api/automatiza/armar/p1.x/"), cliente.delete("/api/automatiza/armar"),
              cliente.post("/api/automatiza/config")]
    assert [r.status_code for r in ajenas] == [404, 405, 405]
    doc = automatiza_api.__doc__
    assert "errores incluidos" not in doc, "el docstring promete más de lo que el módulo cumple"
    assert "enrutado" in doc and "no-store" in doc
