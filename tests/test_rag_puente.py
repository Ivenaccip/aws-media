"""RAG·20 — el puente de idioma, los embeddings y lo que se anota en la corrida.

Sin red y sin gastar: el modelo que reescribe es una función de mentira y el
cliente de Gemini un objeto que responde lo que se le pide."""
import json
import types as pytypes

import pytest

from pipeline import db, embeddings, n8n_catalogo, publico, puente, vectores
from worker import publico as worker

B, L = "n8n-nodes-base.", "@n8n/n8n-nodes-langchain."
PETICION = "Cuando me llegue un correo con factura, guárdala en Drive y avísame por Telegram"


# ---------------------------------------------------------------------------
# preparar(): los dos caminos

def test_por_defecto_directo(monkeypatch):
    monkeypatch.delenv("RAG_CAMINO", raising=False)
    c = puente.preparar(PETICION)
    assert (c.texto, c.camino, c.nodos, c.respaldo) == (PETICION, "directo", [], None)


def test_camino_desde_el_entorno(monkeypatch):
    monkeypatch.setenv("RAG_CAMINO", "reescrita")
    assert puente.camino_configurado() == "reescrita"
    monkeypatch.setenv("RAG_CAMINO", "inventado")
    assert puente.camino_configurado() == "directo"
    with pytest.raises(ValueError):
        puente.preparar(PETICION, "inventado")


def test_directo_no_llama_al_modelo():
    def no(*a):
        raise AssertionError("no debió llamarse")
    assert puente.preparar("  hola   mundo  ", "directo", reescribir=no).texto == "hola mundo"


def test_reescrita(monkeypatch):
    vistos = []

    def modelo(system, user):
        vistos.append((system, user))
        return {"consulta": "  Gmail Trigger   save attachment to Google Drive, Telegram  ",
                "nodos": [B + "gmailTrigger", B + "googleDrive", B + "telegram",
                          B + "hubspot", "inventado", B + "gmailTrigger", 7]}
    c = puente.preparar(PETICION, "reescrita", reescribir=modelo)
    assert c.camino == "reescrita" and c.respaldo is None
    assert c.texto == "Gmail Trigger save attachment to Google Drive, Telegram"
    # solo lo permitido, sin repetir y en orden: al modelo no se le cree
    assert c.nodos == [B + "gmailTrigger", B + "googleDrive", B + "telegram"]
    system, user = vistos[0]
    assert user == PETICION
    assert f"{B}googleSheets — Google Sheets" in system     # la lista de RAG·18
    assert B + "hubspot" not in system                      # lo no permitido no se ofrece
    assert '{"consulta"' in system                          # las llaves sobrevivieron al .format


@pytest.mark.parametrize("respuesta", [
    None, "texto", {}, {"consulta": ""}, {"consulta": "   "}, {"consulta": 3},
    {"consulta": "x" * (puente.MAX_CARACTERES + 1)}, {"consulta": "ok", "nodos": "gmail"},
])
def test_basura_del_modelo_cae_a_directo(respuesta):
    c = puente.preparar(PETICION, "reescrita", reescribir=lambda s, u: respuesta)
    assert c.camino == "directo" and c.texto == PETICION and c.respaldo


def test_si_el_modelo_truena_cae_a_directo():
    def truena(s, u):
        raise TimeoutError("se tardó")
    c = puente.preparar(PETICION, "reescrita", reescribir=truena)
    assert c.camino == "directo" and c.respaldo.startswith("TimeoutError")


def test_sin_modelo_decidido_cae_a_directo():
    # RAG·0 todavía no decide qué modelo razona
    c = puente.preparar(PETICION, "reescrita")
    assert (c.camino, c.respaldo) == ("directo", "sin_modelo")


def test_peticion_vacia():
    with pytest.raises(ValueError):
        puente.preparar("   ")


def test_version_del_catalogo():
    v = puente.version_catalogo()
    assert v == f"n8n {n8n_catalogo.catalogo()['procedencia']['n8n']} · prototipo"


# ---------------------------------------------------------------------------
# embeddings: gemini-embedding-001 con lo decidido el 29-sep

class _Gemini:
    def __init__(self, dim=vectores.DIMENSION, faltan=0):
        self.pedidos, self.dim, self.faltan = [], dim, faltan
        self.models = self

    def embed_content(self, *, model, contents, config):
        self.pedidos.append((model, list(contents), config))
        n = len(contents) - self.faltan
        return pytypes.SimpleNamespace(embeddings=[
            pytypes.SimpleNamespace(values=[3.0, 4.0] + [0.0] * (self.dim - 2)) for _ in range(n)])


def test_embeber_consulta():
    g = _Gemini()
    [v] = embeddings.embeber(["hola"], "consulta", cli=g)
    model, contents, config = g.pedidos[0]
    assert model == "gemini-embedding-001" and contents == ["hola"]
    assert config.task_type == "RETRIEVAL_QUERY"
    assert config.output_dimensionality == 1024
    assert config.auto_truncate is False           # un trozo largo truena, no se corta
    assert v[:2] == [0.6, 0.8]                      # renormalizado


def test_embeber_documentos_en_lotes():
    g = _Gemini()
    vs = embeddings.embeber([f"t{i}" for i in range(embeddings.LOTE + 1)], "documento", cli=g)
    assert len(vs) == embeddings.LOTE + 1
    assert [len(p[1]) for p in g.pedidos] == [embeddings.LOTE, 1]
    assert g.pedidos[0][2].task_type == "RETRIEVAL_DOCUMENT"


@pytest.mark.parametrize("malo", [
    dict(textos=["x"], tarea="otra"), dict(textos=[""], tarea="consulta"),
    dict(textos=["  "], tarea="documento")])
def test_embeber_rechaza_antes_de_llamar(malo):
    with pytest.raises(ValueError):
        embeddings.embeber(malo["textos"], malo["tarea"], cli=object())


def test_embeber_cuida_la_dimension_y_la_cuenta():
    with pytest.raises(vectores.VectorInvalido):
        embeddings.embeber(["x"], "consulta", cli=_Gemini(dim=3072))
    with pytest.raises(RuntimeError, match="otro número"):
        embeddings.embeber(["x", "y"], "consulta", cli=_Gemini(faltan=1))


def test_la_clave_publica_manda(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "plataforma")
    monkeypatch.setenv("GEMINI_API_KEY_PUBLICO", "publica")
    assert embeddings.clave() == "publica"
    monkeypatch.delenv("GEMINI_API_KEY_PUBLICO")
    assert embeddings.clave() == "plataforma"      # en el worker, la de /publico/
    monkeypatch.delenv("GEMINI_API_KEY")
    with pytest.raises(embeddings.SinClave):
        embeddings.clave()


# ---------------------------------------------------------------------------
# entender(): lo que queda en la corrida

@pytest.fixture
def anotado(monkeypatch):
    hechas = []
    monkeypatch.setattr(db, "automatiza_busqueda", lambda i, **kw: hechas.append((i, kw)))
    return hechas


def test_entender_anota_vector_de_la_peticion_original(anotado):
    pedidos = []

    def embeber(textos, tarea):
        pedidos.append((textos, tarea))
        return [[0.1] * 4]

    def modelo(s, u):
        return {"consulta": "Gmail Trigger to Google Drive", "nodos": [B + "gmailTrigger"]}
    consulta, vector = puente.entender(9, PETICION, embeber=embeber,
                                       reescribir=modelo, camino="reescrita")
    # el vector es de lo que ESCRIBIÓ el visitante, no de la reescritura
    assert pedidos == [([PETICION], "consulta")] and vector == [0.1] * 4
    [(i, kw)] = anotado
    assert i == 9 and kw["camino"] == "reescrita" and kw["vector"] == vector
    assert kw["modelo"] == "gemini-embedding-001/1024"
    assert kw["catalogo"] == puente.version_catalogo()
    assert kw["detalle"] == {"consulta": "Gmail Trigger to Google Drive",
                             "nodos": [B + "gmailTrigger"], "respaldo": None}
    assert consulta.texto == "Gmail Trigger to Google Drive"


def test_entender_sin_embeber_anota_sin_vector(anotado):
    _, vector = puente.entender(9, PETICION, embeber=None, camino="directo")
    assert vector is None and anotado[0][1]["vector"] is None and anotado[0][1]["modelo"] is None


def test_si_anotar_falla_la_corrida_sigue(monkeypatch, caplog):
    def truena(i, **kw):
        raise RuntimeError("column peticion_vector does not exist")
    monkeypatch.setattr(db, "automatiza_busqueda", truena)
    consulta, _ = puente.entender(9, PETICION, embeber=lambda t, k: [[1.0]], camino="directo")
    assert consulta.camino == "directo" and "db_migrate" in caplog.text


def test_si_embeber_falla_sube(anotado):
    def truena(t, k):
        raise ConnectionError("sin red")
    with pytest.raises(ConnectionError):
        puente.entender(9, PETICION, embeber=truena, camino="directo")
    assert anotado == []


# ---------------------------------------------------------------------------
# el worker: con el armado de mentira NO se llama a Gemini

@pytest.fixture
def base(monkeypatch):
    estado = {"cerradas": [], "entender": 0}
    monkeypatch.setattr(db, "automatiza_tomar", lambda i: True)
    monkeypatch.setattr(db, "automatiza_cerrar",
                        lambda i, e, **kw: estado["cerradas"].append((e, kw)) or True)
    monkeypatch.setattr(db, "automatiza_paso", lambda i, p: True)
    monkeypatch.setattr(publico, "encendido", lambda: True)
    monkeypatch.setattr(worker, "PAUSA_DE_MENTIRA_SEG", 0)

    def entender(i, uso=None):
        estado["entender"] += 1
        return "texto", puente.Consulta("q", "directo"), [0.1]
    monkeypatch.setattr(worker, "_entender", entender)
    monkeypatch.setattr(worker, "_cuentas", lambda *a, **k: None)
    return estado


def test_con_el_armado_de_mentira_no_entiende(base, monkeypatch):
    monkeypatch.setattr(publico, "ARMADO_DE_MENTIRA", True)
    assert worker.procesar(7) == "listo" and base["entender"] == 0


def test_con_el_armado_real_entiende_y_pasa_la_consulta(base, monkeypatch):
    monkeypatch.setattr(publico, "ARMADO_DE_MENTIRA", False)
    recibida = []
    monkeypatch.setattr(worker, "armar", lambda c: recibida.append(c) or {"flujo": {}, "nodos": []})
    assert worker.procesar(7) == "listo" and base["entender"] == 1
    assert recibida[0]["consulta"].texto == "q" and recibida[0]["vector"] == [0.1]


def test_si_entender_falla_la_corrida_no_sale(base, monkeypatch):
    monkeypatch.setattr(publico, "ARMADO_DE_MENTIRA", False)

    def truena(i, uso=None):
        raise ConnectionError("Gemini no contesta")
    monkeypatch.setattr(worker, "_entender", truena)
    assert worker.procesar(7) == "no_salio"
    assert "ConnectionError" in base["cerradas"][0][1]["motivo"]


def test__entender_usa_el_texto_de_la_corrida(monkeypatch):
    monkeypatch.setattr(db, "automatiza_texto", lambda i: PETICION)
    monkeypatch.delenv("RAG_CAMINO", raising=False)
    vistos = []
    monkeypatch.setattr(puente, "entender",
                        lambda i, t, **kw: vistos.append((i, t, kw)) or ("c", "v"))
    assert worker._entender(5) == (PETICION, "c", "v")
    assert vistos[0][:2] == (5, PETICION)
    assert vistos[0][2]["embeber"] is embeddings.embeber
    assert vistos[0][2]["reescribir"] is None          # directo: Claude ni se llama


def test__entender_reescrita_usa_claude(monkeypatch):
    monkeypatch.setattr(db, "automatiza_texto", lambda i: PETICION)
    monkeypatch.setenv("RAG_CAMINO", "reescrita")
    vistos = []
    monkeypatch.setattr(puente, "entender", lambda i, t, **kw: vistos.append(kw) or ("c", "v"))
    worker._entender(5)
    assert callable(vistos[0]["reescribir"])
    monkeypatch.setattr(db, "automatiza_texto", lambda i: None)
    with pytest.raises(ValueError):
        worker._entender(5)


# ---------------------------------------------------------------------------
# la base: columnas nuevas y el SQL

def test_columnas_nuevas_en_el_esquema():
    todo = " ".join(" ".join(s.split()) for s in db.ESQUEMA)
    for col in ("peticion_vector real[]", "peticion_modelo text", "catalogo_version text",
                "busqueda_camino text", "busqueda jsonb"):
        assert f"ALTER TABLE automatiza_corridas ADD COLUMN IF NOT EXISTS {col}" in todo


def test_automatiza_busqueda_sql(monkeypatch):
    llamadas = []
    monkeypatch.setattr(db, "ejecutar", lambda q, p=None: llamadas.append((" ".join(q.split()), p)) or [])
    db.automatiza_busqueda(3, vector=[0.5, 0.25], modelo="m", catalogo="c",
                           camino="directo", detalle={"consulta": "x"})
    q, p = llamadas[0]
    assert "jsonb_array_elements_text(:v::jsonb)" in q and "WHERE id = :i" in q
    assert p == {"i": 3, "v": [0.5, 0.25], "m": "m", "c": "c", "k": "directo",
                 "d": {"consulta": "x"}}


def test_embeber_espera_el_limite_por_minuto(monkeypatch):
    esperas = []
    monkeypatch.setattr(embeddings.time, "sleep", esperas.append)
    g = _Gemini()
    real = g.embed_content
    fallos = [RuntimeError("429 RESOURCE_EXHAUSTED"), RuntimeError("429 RESOURCE_EXHAUSTED")]

    def a_veces(**kw):
        if fallos:
            raise fallos.pop(0)
        return real(**kw)
    g.embed_content = a_veces
    assert len(embeddings.embeber(["x"], "documento", cli=g)) == 1
    assert esperas == list(embeddings.ESPERAS_429[:2])


def test_embeber_no_reintenta_otros_errores(monkeypatch):
    monkeypatch.setattr(embeddings.time, "sleep", lambda s: None)
    g = _Gemini()

    def truena(**kw):
        raise RuntimeError("400 INVALID_ARGUMENT: input too long")
    g.embed_content = truena
    with pytest.raises(RuntimeError, match="400"):
        embeddings.embeber(["x"], "documento", cli=g)


def test_embeber_se_rinde_tras_las_esperas(monkeypatch):
    esperas = []
    monkeypatch.setattr(embeddings.time, "sleep", esperas.append)
    g = _Gemini()

    def siempre(**kw):
        raise RuntimeError("429")
    g.embed_content = siempre
    with pytest.raises(RuntimeError):
        embeddings.embeber(["x"], "documento", cli=g)
    assert esperas == list(embeddings.ESPERAS_429)


# respaldo temporal: Titan V2 por Bedrock (30-sep)

class _Cuerpo:
    def __init__(self, datos):
        self._d = datos

    def read(self):
        return json.dumps(self._d).encode()


class _Bedrock:
    def __init__(self, dim=1024, truenas=0):
        self.pedidos, self.dim, self.truenas = [], dim, truenas

    def invoke_model(self, **kw):
        if self.truenas:
            self.truenas -= 1
            raise RuntimeError("ThrottlingException: Too many requests")
        self.pedidos.append(kw)
        return {"body": _Cuerpo({"embeddingsByType": {"float": [0.5] * self.dim}})}


def test_titan_una_llamada_por_texto(monkeypatch):
    monkeypatch.setenv("EMBEDDINGS", "titan")
    b = _Bedrock()
    vs = embeddings.embeber(["hola", "adiós"], "consulta", cli=b)
    assert len(vs) == 2 and abs(sum(x * x for x in vs[0]) - 1) < 1e-9
    assert [p["modelId"] for p in b.pedidos] == ["amazon.titan-embed-text-v2:0"] * 2
    cuerpo = json.loads(b.pedidos[0]["body"])
    assert cuerpo == {"inputText": "hola", "dimensions": 1024, "normalize": True,
                      "embeddingTypes": ["float"]}


def test_titan_no_pide_clave(monkeypatch):
    monkeypatch.setenv("EMBEDDINGS", "titan")
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GEMINI_API_KEY_PUBLICO", raising=False)
    assert len(embeddings.embeber(["x"], "documento", cli=_Bedrock())) == 1


def test_titan_reintenta_solo_el_limite(monkeypatch):
    monkeypatch.setenv("EMBEDDINGS", "titan")
    esperas = []
    monkeypatch.setattr(embeddings.time, "sleep", esperas.append)
    assert len(embeddings.embeber(["x"], "documento", cli=_Bedrock(truenas=2))) == 1
    assert esperas == list(embeddings.ESPERAS_429[:2])
    with pytest.raises(vectores.VectorInvalido):
        embeddings.embeber(["x"], "documento", cli=_Bedrock(dim=256))


def test_titan_anota_su_modelo_en_la_corrida(monkeypatch):
    monkeypatch.setenv("EMBEDDINGS", "titan")
    assert puente.modelo_vector() == "amazon.titan-embed-text-v2:0/1024"
