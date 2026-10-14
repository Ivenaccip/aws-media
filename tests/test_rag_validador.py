"""RAG·22 — el validador del flujo de n8n: tres capas y fallando cerrado."""
import copy

import pytest

from pipeline import n8n_catalogo, validador
from worker import publico as worker

B, L = "n8n-nodes-base.", "@n8n/n8n-nodes-langchain."


def _n(nombre, tipo, version=None, **extra):
    raiz, _ = n8n_catalogo.base(tipo)
    v = version if version is not None else n8n_catalogo.catalogo()["nodos"][raiz]["version_por_defecto"]
    return {"id": nombre, "name": nombre, "type": tipo, "typeVersion": v,
            "position": [0, 0], "parameters": extra.pop("parameters", {}), **extra}


def _c(destino, tipo="main"):
    return {"node": destino, "type": tipo, "index": 0}


def agente():
    """Chat Trigger → AI Agent, con modelo, memoria y Google Sheets como herramienta."""
    return {
        "name": "Agente con hoja",
        "nodes": [
            _n("Chat", L + "chatTrigger"),
            _n("Agente", L + "agent"),
            _n("Modelo", L + "lmChatOpenAi",
               credentials={"openAiApi": {"id": "", "name": "OpenAI"}}),
            _n("Memoria", L + "memoryBufferWindow"),
            _n("Hoja", B + "googleSheetsTool",
               credentials={"googleSheetsOAuth2Api": {"name": "Google"}}),
        ],
        "connections": {
            "Chat": {"main": [[_c("Agente")]]},
            "Modelo": {"ai_languageModel": [[_c("Agente", "ai_languageModel")]]},
            "Memoria": {"ai_memory": [[_c("Agente", "ai_memory")]]},
            "Hoja": {"ai_tool": [[_c("Agente", "ai_tool")]]},
        },
        "settings": {},
    }


def clasico():
    """Schedule → HTTP Request → If → Gmail / nada."""
    return {
        "name": "Revisar precio",
        "nodes": [
            _n("Cada hora", B + "scheduleTrigger"),
            _n("Pedir precio", B + "httpRequest", parameters={"url": "https://api.ejemplo.com/p"}),
            _n("¿Bajó?", B + "if"),
            _n("Avisar", B + "gmail", credentials={"gmailOAuth2": {"name": "Gmail"}}),
        ],
        "connections": {
            "Cada hora": {"main": [[_c("Pedir precio")]]},
            "Pedir precio": {"main": [[_c("¿Bajó?")]]},
            "¿Bajó?": {"main": [[_c("Avisar")], []]},
        },
    }


@pytest.mark.parametrize("flujo", [agente, clasico])
def test_flujos_buenos_pasan(flujo):
    r = validador.validar(flujo())
    assert r.ok, r.errores
    assert r.advertencias == []


def test_el_flujo_de_mentira_del_worker_pasa():
    assert validador.validar(copy.deepcopy(worker.FLUJO_DE_MENTIRA)).ok


# ---------------------------------------------------------------------------
# capa 1: forma

@pytest.mark.parametrize("romper, pedazo", [
    (lambda f: f.pop("nodes"), "nodes"),
    (lambda f: f.update(nodes=[]), "nodes"),
    (lambda f: f["nodes"][0].pop("position"), "position"),
    (lambda f: f["nodes"][0].update(position=[0]), "position"),
    (lambda f: f["nodes"][0].update(typeVersion="4"), "typeVersion"),
    (lambda f: f["nodes"][0].update(extra=1), "extra"),
    (lambda f: f.update(pinData={"Cada hora": [{"json": {}}]}), "pinData"),
    (lambda f: f["connections"]["Cada hora"].update(inventado=[]), "inventado"),
    (lambda f: f.update(staticData={}), "staticData"),
])
def test_forma(romper, pedazo):
    f = clasico()
    romper(f)
    r = validador.validar(f)
    assert not r.ok and any(e.startswith("forma:") for e in r.errores)
    assert pedazo in " ".join(r.errores)


def test_no_es_un_objeto():
    for basura in (None, [], "flujo", 3):
        assert not validador.validar(basura).ok


# ---------------------------------------------------------------------------
# capa 2: coherencia

def _errores(f):
    r = validador.validar(f)
    assert not r.ok
    return " | ".join(r.errores)


def test_conexion_a_un_nodo_que_no_existe():
    f = clasico()
    f["connections"]["Pedir precio"]["main"][0][0]["node"] = "Fantasma"
    assert "«Fantasma», que no es ningún nodo" in _errores(f)
    f = clasico()
    f["connections"]["Fantasma"] = {"main": [[_c("Avisar")]]}
    assert "desde «Fantasma»" in _errores(f)


def test_nombres_repetidos():
    f = clasico()
    f["nodes"][3]["name"] = "¿Bajó?"
    assert "nombre repetido" in _errores(f)


@pytest.mark.parametrize("cuantos", [0, 2])
def test_exactamente_un_disparador(cuantos):
    f = clasico()
    if cuantos == 0:
        f["nodes"][0] = _n("Cada hora", B + "noOp")
    else:
        f["nodes"].append(_n("Otro", B + "webhook"))
        f["connections"]["Otro"] = {"main": [[_c("Pedir precio")]]}
    assert f"exactamente un disparador y hay {cuantos}" in _errores(f)


def test_un_disparador_apagado_no_cuenta():
    f = clasico()
    f["nodes"].append(_n("Otro", B + "webhook", disabled=True))
    assert validador.validar(f).ok


@pytest.mark.parametrize("tipo, version, dice", [
    (B + "nodoInventado", 1, "no existe"),
    (B + "hubspot", None, "aún no lo soportamos"),
    (B + "executeWorkflow", None, "aún no lo soportamos"),
    (L + "toolHttpRequest", None, "ya no se ofrece"),
    (B + "gmail", 99, "no tiene la versión 99"),
])
def test_catalogo(tipo, version, dice):
    f = clasico()
    nuevo = {**f["nodes"][3], "type": tipo, "typeVersion": version or 1}
    if version is None:
        raiz, _ = n8n_catalogo.base(tipo)
        nuevo["typeVersion"] = n8n_catalogo.catalogo()["nodos"][raiz]["version_por_defecto"]
    nuevo.pop("credentials")
    f["nodes"][3] = nuevo
    assert dice in _errores(f)


def test_obligatorio_que_falta():
    f = clasico()
    f["nodes"][1]["parameters"] = {}
    assert "faltan parámetros obligatorios: url" in _errores(f)


def test_conexiones_de_ia_con_su_tipo():
    f = agente()
    # la memoria no produce ai_languageModel
    f["connections"]["Memoria"] = {"ai_languageModel": [[_c("Agente", "ai_languageModel")]]}
    assert "«Memoria» no tiene salida de tipo ai_languageModel" in _errores(f)
    f = agente()
    # el Chat Model no recibe nada: no se le puede conectar una herramienta
    f["connections"]["Hoja"] = {"ai_tool": [[_c("Modelo", "ai_tool")]]}
    assert "«Modelo» no recibe conexiones de tipo ai_tool" in _errores(f)
    f = agente()
    f["connections"]["Chat"]["main"][0][0]["type"] = "ai_tool"
    assert "no es main" in _errores(f)


def test_un_nodo_suelto_es_advertencia_no_error():
    f = clasico()
    f["nodes"].append(_n("Suelto", B + "noOp"))
    r = validador.validar(f)
    assert r.ok and r.advertencias == ["el nodo «Suelto» no está conectado a nada"]


# ---------------------------------------------------------------------------
# capa 3: credenciales y secretos

def test_credencial_con_id_no_pasa():
    f = clasico()
    f["nodes"][3]["credentials"]["gmailOAuth2"]["id"] = "42"
    assert "forma:" in _errores(f)


def test_credencial_con_valores_no_pasa():
    f = clasico()
    f["nodes"][3]["credentials"]["gmailOAuth2"]["clientSecret"] = "x"
    assert "forma:" in _errores(f)


def test_credencial_de_otro_nodo():
    f = clasico()
    f["nodes"][3]["credentials"] = {"slackApi": {"name": "Slack"}}
    assert "la credencial «slackApi» no es de este nodo" in _errores(f)


@pytest.mark.parametrize("secreto", [
    "sk-proj-" + "a" * 40, "AIza" + "b" * 35, "xoxb-1234567890-abc",
    "ghp_" + "c" * 36, "123456789:" + "D" * 35, "Bearer " + "e" * 30,
    "-----BEGIN RSA PRIVATE KEY-----", "AKIA" + "F" * 16,
])
def test_ningun_secreto_dentro(secreto):
    f = clasico()
    f["nodes"][1]["parameters"]["headerParameters"] = {"parameters": [
        {"name": "Authorization", "value": f"algo {secreto} algo"}]}
    assert "parece una clave" in _errores(f)


def test_un_texto_normal_no_es_secreto():
    f = clasico()
    f["nodes"][1]["parameters"]["jsonBody"] = "={{ $json.task_sk-id }} Bearer token"
    assert validador.validar(f).ok


# ---------------------------------------------------------------------------
# falla cerrado y habla con el modelo

def test_si_el_validador_truena_no_pasa(monkeypatch):
    def truena(*a, **k):
        raise KeyError("x")
    monkeypatch.setattr(validador, "_coherencia", truena)
    r = validador.validar(clasico())
    assert not r.ok and "el validador falló: KeyError" in r.errores[0]


def test_errores_para_el_reintento():
    f = clasico()
    f["nodes"][3]["name"] = "¿Bajó?"
    texto = validador.para_el_modelo(validador.validar(f))
    assert texto.startswith("- ") and "nombre repetido" in texto


def test_tope_de_errores():
    f = clasico()
    for i in range(40):
        f["connections"][f"F{i}"] = {"main": [[_c("Avisar")]]}
    assert len(validador.validar(f).errores) == validador.MAX_ERRORES
