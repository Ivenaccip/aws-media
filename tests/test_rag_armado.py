"""RAG·21/24 y el modelo del servidor (Claude Opus 5.5): buscar, generar,
revisar con un reintento, sin_cobertura, costo por corrida. Sin red: Claude y
S3 Vectors son objetos que responden lo que el test les dicta."""
import json
import types as pytypes

import pytest

from pipeline import armado, claude_rag, costos_rag, db, publico, puente, validador, vectores
from worker import publico as worker

B, L = "n8n-nodes-base.", "@n8n/n8n-nodes-langchain."
PETICION = "Cada lunes revisa el precio en una API y si bajó mándame un correo"


def flujo_bueno():
    return {"name": "Precio", "nodes": [
        {"id": "1", "name": "Cada lunes", "type": B + "scheduleTrigger", "typeVersion": 1.2,
         "position": [0, 0], "parameters": {}},
        {"id": "2", "name": "Precio", "type": B + "httpRequest", "typeVersion": 4.2,
         "position": [220, 0], "parameters": {"url": "https://api.ejemplo.com"}},
        {"id": "3", "name": "Correo", "type": B + "gmail", "typeVersion": 2.1,
         "position": [440, 0], "parameters": {},
         "credentials": {"gmailOAuth2": {"name": "Gmail"}}}],
        "connections": {"Cada lunes": {"main": [[{"node": "Precio", "type": "main", "index": 0}]]},
                        "Precio": {"main": [[{"node": "Correo", "type": "main", "index": 0}]]}}}


def flujo_malo():
    f = flujo_bueno()
    f["connections"]["Precio"]["main"][0][0]["node"] = "Fantasma"
    return f


class _Claude:
    """cli.beta.messages.create de mentira: devuelve las respuestas en orden."""

    def __init__(self, *respuestas, stop="end_turn", modelo="claude-opus-5-5"):
        self.respuestas, self.stop, self.modelo, self.pedidos = list(respuestas), stop, modelo, []
        self.beta = pytypes.SimpleNamespace(messages=self)

    def create(self, **kw):
        self.pedidos.append(kw)
        r = self.respuestas.pop(0)
        texto = r if isinstance(r, str) else json.dumps(r)
        return pytypes.SimpleNamespace(
            stop_reason=self.stop, model=self.modelo,
            content=[pytypes.SimpleNamespace(type="thinking", thinking=""),
                     pytypes.SimpleNamespace(type="text", text=texto)],
            usage=pytypes.SimpleNamespace(input_tokens=1000, output_tokens=500,
                                          cache_creation_input_tokens=0,
                                          cache_read_input_tokens=800))


# ---------------------------------------------------------------------------
# claude_rag

def test_modelo_por_defecto_opus_55(monkeypatch):
    monkeypatch.delenv("RAG_MODELO", raising=False)
    assert claude_rag.modelo() == "claude-opus-5-5"
    assert claude_rag.CANDIDATOS == ("claude-opus-5-5", "claude-sonnet-5-5")
    monkeypatch.setenv("RAG_MODELO", "claude-sonnet-5-5")
    assert claude_rag.modelo() == "claude-sonnet-5-5"


def test_clave_publica(monkeypatch):
    monkeypatch.setenv("CLAUDE_API_KEY", "plataforma")
    monkeypatch.setenv("CLAUDE_API_KEY_PUBLICO", "publica")
    assert claude_rag.clave() == "publica"
    monkeypatch.delenv("CLAUDE_API_KEY_PUBLICO")
    monkeypatch.delenv("CLAUDE_API_KEY")
    with pytest.raises(claude_rag.SinClave):
        claude_rag.clave()


@pytest.mark.parametrize("texto", [
    '{"a": 1}', 'Aquí va:\n```json\n{"a": 1}\n```', 'antes {"a": 1} después'])
def test_extraer_json(texto):
    assert claude_rag.extraer_json(texto) == {"a": 1}


@pytest.mark.parametrize("texto", ["", "nada", "[1, 2]", "{roto"])
def test_extraer_json_invalido(texto):
    with pytest.raises(claude_rag.RespuestaInvalida):
        claude_rag.extraer_json(texto)


def test_pedir_json_lo_que_se_manda(caplog):
    cli = _Claude({"ok": True})
    uso = claude_rag.Uso()
    with caplog.at_level("INFO", logger="pipeline.claude_rag"):
        r = claude_rag.pedir_json("S", [{"role": "user", "content": "u"}], etapa="x",
                                  effort="low", max_tokens=100, uso=uso, cli=cli)
    assert r == {"ok": True}
    kw = cli.pedidos[0]
    assert kw["model"] == "claude-opus-5-5"
    assert kw["output_config"] == {"effort": "low"}        # explícito: Opus 5.5 trae medium
    assert kw["fallbacks"] == "default" and kw["betas"] == [claude_rag.FALLBACK_BETA]
    assert kw["system"][0]["cache_control"] == {"type": "ephemeral"}
    assert "thinking" not in kw and "tool_choice" not in kw and "temperature" not in kw
    seg = uso.llamadas[0].pop("seg")
    assert isinstance(seg, float) and seg >= 0
    assert uso.llamadas == [{"etapa": "x", "modelo": "claude-opus-5-5", "entrada": 1000,
                             "salida": 500, "cache_escrita": 0, "cache_leida": 800}]
    # una línea por llamada en CloudWatch: etapa, modelo, effort, segundos y tokens
    linea = caplog.messages[-1]
    assert linea.startswith("claude x: claude-opus-5-5 effort=low ")
    assert "entrada 1000 · salida 500 · end_turn" in linea


def test_refusal_y_max_tokens():
    with pytest.raises(claude_rag.Declinado):
        claude_rag.pedir_json("S", [], etapa="x", effort="low", max_tokens=1,
                              cli=_Claude({"ok": 1}, stop="refusal"))
    with pytest.raises(claude_rag.RespuestaInvalida, match="max_tokens"):
        claude_rag.pedir_json("S", [], etapa="x", effort="low", max_tokens=1,
                              cli=_Claude({"ok": 1}, stop="max_tokens"))


def test_reescritor_con_puente():
    cli = _Claude({"consulta": "Schedule Trigger HTTP Request Gmail", "nodos": [B + "gmail"]})
    uso = claude_rag.Uso()
    c = puente.preparar(PETICION, "reescrita", reescribir=claude_rag.reescritor(uso, cli))
    assert c.camino == "reescrita" and c.nodos == [B + "gmail"]
    assert cli.pedidos[0]["output_config"] == {"effort": "low"}
    assert uso.llamadas[0]["etapa"] == "reescribir"


# ---------------------------------------------------------------------------
# armado

def _res(n=3):
    return [vectores.Resultado(f"k{i}", 0.1 * i, {"titulo": f"T{i}", "url": f"u{i}",
                                                  "texto": f"doc {i}"}) for i in range(n)]


def test_prompt_de_armado():
    s = armado.prompt_sistema()
    assert f"{B}googleSheets · " in s and "googleSheetsTool" in s
    assert "gpt-5.4-mini" in s and L + "lmChatOpenAi" in s
    assert B + "hubspot" not in s
    assert '{"cubre": true' in s                     # las llaves sobreviven al .format


def test_buscar_reusa_el_vector_directo(monkeypatch):
    pedidos = []
    monkeypatch.setattr(vectores, "consultar", lambda v, k, s3v=None: pedidos.append(v) or _res())
    def no(*a):
        raise AssertionError("no debió embeber")
    armado.buscar(puente.Consulta("x", "directo"), [0.5], embeber=no)
    assert pedidos == [[0.5]]
    armado.buscar(puente.Consulta("english", "reescrita"), [0.5],
                  embeber=lambda t, k: [[0.9]] if (t, k) == (["english"], "consulta") else None)
    assert pedidos[-1] == [0.9]


def test_contexto_con_tope(monkeypatch):
    monkeypatch.setattr(armado, "MAX_CONTEXTO", 60)
    c = armado.contexto(_res(5))
    assert "### T0" in c and "### T4" not in c


def test_generar_listo_a_la_primera():
    cli = _Claude({"cubre": True, "faltan": [], "resumen": "Revisa y avisa", "flujo": flujo_bueno()})
    uso = claude_rag.Uso()
    a = armado.generar(PETICION, _res(), uso=uso, cli=cli)
    assert (a.estado, a.intentos, a.modelo) == ("listo", 1, "claude-opus-5-5")
    assert a.nodos == [B + "scheduleTrigger", B + "httpRequest", B + "gmail"]
    assert [f["clave"] for f in a.fuentes] == ["k0", "k1", "k2"]
    assert a.fuentes[1]["distancia"] == 0.1
    msg = cli.pedidos[0]["messages"][0]["content"]
    assert PETICION in msg and "doc 2" in msg
    assert cli.pedidos[0]["output_config"] == {"effort": armado.EFFORT}


def test_generar_reintenta_una_vez_con_los_errores():
    cli = _Claude({"cubre": True, "flujo": flujo_malo(), "resumen": ""},
                  {"cubre": True, "flujo": flujo_bueno(), "resumen": "ok"})
    a = armado.generar(PETICION, _res(), uso=claude_rag.Uso(), cli=cli)
    assert a.estado == "listo" and a.intentos == 2
    segundo = cli.pedidos[1]["messages"]
    assert [m["role"] for m in segundo] == ["user", "assistant", "user"]
    assert "Fantasma" in segundo[2]["content"]


def test_generar_no_sale_tras_dos_intentos():
    cli = _Claude({"cubre": True, "flujo": flujo_malo()}, {"cubre": True, "flujo": flujo_malo()})
    with pytest.raises(armado.NoSalio, match="validador"):
        armado.generar(PETICION, _res(), uso=claude_rag.Uso(), cli=cli)
    assert len(cli.pedidos) == 2                       # nunca un tercero


def test_generar_sin_cobertura():
    cli = _Claude({"cubre": False, "faltan": ["HubSpot"], "flujo": None})
    a = armado.generar(PETICION, _res(), uso=claude_rag.Uso(), cli=cli)
    assert (a.estado, a.faltan, a.flujo) == ("sin_cobertura", ["HubSpot"], None)


@pytest.mark.parametrize("r", [{"flujo": {}}, {"cubre": "sí"}, {"cubre": True, "flujo": None}])
def test_generar_forma_invalida(r):
    with pytest.raises(claude_rag.RespuestaInvalida):
        armado.generar(PETICION, _res(), uso=claude_rag.Uso(), cli=_Claude(r))


def test_resultado_guardado():
    uso = claude_rag.Uso()
    a = armado.generar(PETICION, _res(), uso=uso,
                       cli=_Claude({"cubre": True, "flujo": flujo_bueno(), "resumen": "r"}))
    r = a.como_resultado(uso)
    assert r["flujo"] == flujo_bueno() and r["modelo"] == "claude-opus-5-5"
    assert r["uso"]["total"]["entrada"] == 1000
    assert validador.validar(r["flujo"]).ok


# ---------------------------------------------------------------------------
# RAG·24 costo: solo con precios en pricing.json

def test_sin_precio_no_hay_costo(monkeypatch):
    monkeypatch.setattr(costos_rag, "precios", lambda: {})
    uso = claude_rag.Uso()
    uso.llamadas.append({"etapa": "x", "modelo": "claude-opus-5-5", "entrada": 1,
                         "salida": 1, "cache_escrita": 0, "cache_leida": 0})
    assert costos_rag.costo_usd(uso) is None
    assert costos_rag.costo_usd(claude_rag.Uso()) == 0.0


def test_costo_con_precios(monkeypatch):
    monkeypatch.setattr(costos_rag, "precios", lambda: {"m": {
        "entrada": 2.0, "salida": 10.0, "cache_escrita": 2.5, "cache_leida": 0.2}})
    uso = claude_rag.Uso()
    uso.llamadas.append({"etapa": "x", "modelo": "m", "entrada": 1_000_000,
                         "salida": 100_000, "cache_escrita": 0, "cache_leida": 1_000_000})
    assert costos_rag.costo_usd(uso) == 3.2
    monkeypatch.setattr(costos_rag, "precios", lambda: {"m": {"entrada": 2.0}})
    assert costos_rag.costo_usd(uso) is None           # precio incompleto = sin precio


def test_pricing_json_hoy_no_tiene_precios_de_rag():
    # si esto falla es que el dueño ya agregó la sección: ajusta el reporte
    costos_rag._rag.cache_clear()
    assert costos_rag.precios() == {}


# ---------------------------------------------------------------------------
# el worker con el armado real (sin gastar: todo de mentira)

@pytest.fixture
def real(monkeypatch):
    estado = {"cerradas": [], "anotado": []}
    monkeypatch.setattr(publico, "ARMADO_DE_MENTIRA", False)
    monkeypatch.setattr(publico, "encendido", lambda: True)
    monkeypatch.setattr(db, "automatiza_tomar", lambda i: True)
    monkeypatch.setattr(db, "automatiza_paso", lambda i, p: True)
    monkeypatch.setattr(db, "automatiza_cerrar",
                        lambda i, e, **kw: estado["cerradas"].append((e, kw)) or True)
    monkeypatch.setattr(db, "automatiza_anotar", lambda i, **kw: estado["anotado"].append(kw))
    monkeypatch.setattr(worker, "_entender",
                        lambda i, uso=None: (PETICION, puente.Consulta(PETICION, "directo"), [0.1]))
    monkeypatch.setattr(costos_rag, "precios", lambda: {})
    return estado


def _armado(monkeypatch, a=None, error=None):
    def falso(texto, consulta, vector, **kw):
        if error:
            raise error
        kw["uso"].llamadas.append({"etapa": "armar1", "modelo": "claude-opus-5-5", "entrada": 1,
                                   "salida": 1, "cache_escrita": 0, "cache_leida": 0})
        return a
    monkeypatch.setattr(armado, "armar", falso)


def test_worker_real_listo(real, monkeypatch):
    _armado(monkeypatch, armado.Armado("listo", flujo_bueno(), "r", ["t"], modelo="claude-opus-5-5"))
    assert worker.procesar(7) == "listo"
    [(e, kw)] = real["cerradas"]
    assert e == "listo" and kw["resultado"]["flujo"] == flujo_bueno()
    assert "estado" not in kw["resultado"] and kw["nodos"] == ["t"]
    assert real["anotado"] == [{"modelo": "claude-opus-5-5", "validador_ok": True}]


def test_worker_real_sin_cobertura(real, monkeypatch):
    _armado(monkeypatch, armado.Armado("sin_cobertura", None, "", [], faltan=["HubSpot"]))
    assert worker.procesar(7) == "sin_cobertura"
    [(e, kw)] = real["cerradas"]
    assert e == "sin_cobertura" and kw["motivo"] == "faltan: HubSpot"


def test_worker_real_no_salio_por_validador(real, monkeypatch):
    _armado(monkeypatch, error=armado.NoSalio("validador: x"))
    assert worker.procesar(7) == "no_salio"
    assert real["anotado"][0]["validador_ok"] is False
    assert "validador" in real["anotado"][0]["validador_motivo"]


def test_worker_real_sin_clave_no_sale(real, monkeypatch):
    _armado(monkeypatch, error=claude_rag.SinClave("falta"))
    assert worker.procesar(7) == "no_salio"
    assert real["cerradas"][0][1]["motivo"].startswith("SinClave")


def test_el_armado_de_mentira_es_el_default():
    # sin ARMADO_REAL=1 (lo pone el CDK solo donde `armado_real`) no se gasta
    import importlib
    import os
    assert os.getenv("ARMADO_REAL") is None
    assert importlib.reload(publico).ARMADO_DE_MENTIRA is True


def test_armado_real_solo_en_dev_y_con_modelo_explicito():
    """1-oct: el dueño enciende el armado real en dev (tope 20 al día). El
    modelo va fijado, provisional hasta el eval de 50 corridas."""
    from infra import entornos
    from pipeline import claude_rag
    assert entornos.DEV.armado_real is True
    assert entornos.DEV.rag_modelo in claude_rag.CANDIDATOS
    assert entornos.PROD.armado_real is False and entornos.PROD.rag_modelo is None
