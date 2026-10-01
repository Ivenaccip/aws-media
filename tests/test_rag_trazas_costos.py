"""RAG·23/24 — las etapas de la traza de /automatiza y lo que cuesta una corrida.

Una corrida real de punta a punta (entender → embeber → buscar → armar →
revisar) con Claude, OpenAI, S3 Vectors y Langfuse de mentira: se revisa qué
observaciones salen, que ninguna lleve el texto del visitante sin enmascarar,
y que el uso guardado alcance para calcular el costo cuando haya precios."""
import contextlib
import json
import sys
import types as pytypes

import pytest

from pipeline import claude_rag, costos_rag, db, embeddings, publico, puente, trazas_rag
from worker import publico as worker

B = "n8n-nodes-base."
PETICION = "Cada lunes revisa el precio en una API y mándale un correo a ana@correo.mx"


def flujo_bueno():
    return {"name": "Precio", "nodes": [
        {"id": "1", "name": "Cada lunes", "type": B + "scheduleTrigger", "typeVersion": 1.2,
         "position": [0, 0], "parameters": {}},
        {"id": "2", "name": "Precio", "type": B + "httpRequest", "typeVersion": 4.2,
         "position": [220, 0], "parameters": {"url": "https://api.ejemplo.com"}}],
        "connections": {"Cada lunes": {"main": [[{"node": "Precio", "type": "main", "index": 0}]]}}}


def flujo_malo():
    f = flujo_bueno()
    f["connections"]["Cada lunes"]["main"][0][0]["node"] = "Fantasma"
    return f


class _Claude:
    def __init__(self, *respuestas):
        self.respuestas = list(respuestas)
        self.beta = pytypes.SimpleNamespace(messages=self)

    def create(self, **kw):
        texto = json.dumps(self.respuestas.pop(0))
        return pytypes.SimpleNamespace(
            stop_reason="end_turn", model="claude-opus-5-5",
            content=[pytypes.SimpleNamespace(type="text", text=texto)],
            usage=pytypes.SimpleNamespace(input_tokens=1000, output_tokens=500,
                                          cache_creation_input_tokens=0,
                                          cache_read_input_tokens=800))


class _OpenAI:
    def __init__(self):
        self.embeddings = self

    def create(self, **kw):
        datos = [pytypes.SimpleNamespace(index=i, embedding=[1.0] + [0.0] * 1023)
                 for i in range(len(kw["input"]))]
        return pytypes.SimpleNamespace(data=datos,
                                       usage=pytypes.SimpleNamespace(prompt_tokens=17))


class _S3V:
    def query_vectors(self, **kw):
        return {"vectors": [{"key": f"nodo/k{i}", "distance": 0.1 * i,
                             "metadata": {"titulo": f"T{i}", "texto": "doc"}} for i in range(3)]}


@pytest.fixture
def langfuse(monkeypatch):
    """Langfuse de mentira que anota cada observación: tipo, nombre, input,
    kwargs y sus update()."""
    monkeypatch.setenv("LANGFUSE_PUBLIC_KEY", "pk")
    monkeypatch.setenv("LANGFUSE_SECRET_KEY", "sk")
    obs = []

    @contextlib.contextmanager
    def observar(*, as_type, name, input=None, **kw):
        o = {"tipo": as_type, "nombre": name, "input": input, "kw": kw, "updates": []}
        obs.append(o)
        yield pytypes.SimpleNamespace(update=lambda **u: o["updates"].append(u))

    @contextlib.contextmanager
    def propagar(**kw):
        yield

    cli = pytypes.SimpleNamespace(start_as_current_observation=observar, flush=lambda: None)
    monkeypatch.setitem(sys.modules, "langfuse", pytypes.SimpleNamespace(
        get_client=lambda: cli, propagate_attributes=propagar))
    return obs


@pytest.fixture
def corrida(monkeypatch):
    """El worker con el armado REAL; todo lo de afuera, de mentira."""
    estado = {"cerradas": [], "anotado": []}
    monkeypatch.setattr(publico, "ARMADO_DE_MENTIRA", False)
    monkeypatch.setattr(publico, "encendido", lambda: True)
    monkeypatch.setattr(db, "automatiza_tomar", lambda i: True)
    monkeypatch.setattr(db, "automatiza_paso", lambda i, p: True)
    monkeypatch.setattr(db, "automatiza_texto", lambda i: PETICION)
    monkeypatch.setattr(db, "automatiza_busqueda", lambda i, **kw: None)
    monkeypatch.setattr(db, "automatiza_cerrar",
                        lambda i, e, **kw: estado["cerradas"].append((e, kw)) or True)
    monkeypatch.setattr(db, "automatiza_anotar", lambda i, **kw: estado["anotado"].append(kw))
    monkeypatch.delenv("RAG_CAMINO", raising=False)          # directo: reusa el vector
    monkeypatch.setenv("EMBEDDINGS", "openai")
    monkeypatch.setenv("VECTORES_BUCKET", "b")
    monkeypatch.setenv("VECTORES_INDICE", "i")
    monkeypatch.setattr(embeddings, "cliente_openai", lambda: _OpenAI())
    from pipeline import vectores
    monkeypatch.setattr(vectores, "cliente", lambda: _S3V())
    monkeypatch.setattr(costos_rag, "precios", lambda: {})
    return estado


def _con_claude(monkeypatch, *respuestas):
    monkeypatch.setattr(claude_rag, "cliente", lambda: _Claude(*respuestas))


# ---------------------------------------------------------------------------
# RAG·23 — las etapas

def test_corrida_con_todas_sus_etapas(corrida, langfuse, monkeypatch):
    _con_claude(monkeypatch, {"cubre": True, "flujo": flujo_bueno(), "resumen": "r"})
    assert worker.procesar(7) == "listo"
    nombres = [(o["tipo"], o["nombre"]) for o in langfuse]
    assert nombres == [("span", "automatiza"), ("span", "entender"),
                       ("embedding", "embeber_consulta"), ("retriever", "buscar"),
                       ("generation", "armar1"), ("guardrail", "revisar1")]
    por = {o["nombre"]: o for o in langfuse}
    # entender: la consulta va, pero enmascarada
    [u] = por["entender"]["updates"]
    assert "ana@correo.mx" not in json.dumps(u) and "[correo]" in u["output"]["consulta"]
    # embeber: modelo y tokens
    assert por["embeber_consulta"]["kw"]["model"] == "text-embedding-3-small"
    assert por["embeber_consulta"]["updates"][0]["usage_details"] == {"input": 17}
    # buscar: qué trozos y a qué distancia (reusó el vector de «entender»)
    assert por["buscar"]["input"] == {"camino": "directo", "reusa_vector": True}
    assert [f["clave"] for f in por["buscar"]["updates"][0]["output"]] == \
        ["nodo/k0", "nodo/k1", "nodo/k2"]
    # armar: modelo, effort y tokens, y NINGÚN texto (ni input ni output)
    g = por["armar1"]
    assert g["input"] is None and g["kw"]["model"] == "claude-opus-5-5"
    assert g["kw"]["model_parameters"]["effort"] == "medium"
    [u] = g["updates"]
    assert u["usage_details"]["input"] == 1000 and u["usage_details"]["output"] == 500
    assert "output" not in u and "cost_details" not in u        # sin precio: sin costo
    # revisar: lo que dijo el validador
    assert por["revisar1"]["updates"][0]["output"]["ok"] is True


def test_con_precio_la_generation_lleva_su_costo(corrida, langfuse, monkeypatch):
    monkeypatch.setattr(costos_rag, "precios", lambda: {
        "claude-opus-5-5": {"entrada": 2.0, "salida": 10.0, "cache_escrita": 0.0,
                            "cache_leida": 0.0},
        "text-embedding-3-small": {"entrada": 1.0}})
    _con_claude(monkeypatch, {"cubre": True, "flujo": flujo_bueno(), "resumen": "r"})
    worker.procesar(7)
    [u] = [o for o in langfuse if o["nombre"] == "armar1"][0]["updates"]
    assert u["cost_details"] == {"total": 0.007}             # 1000×2 + 500×10, por millón


def test_reintento_y_no_salio_quedan_en_la_traza(corrida, langfuse, monkeypatch):
    _con_claude(monkeypatch, {"cubre": True, "flujo": flujo_malo()},
                {"cubre": True, "flujo": flujo_malo()})
    assert worker.procesar(7) == "no_salio"
    nombres = [o["nombre"] for o in langfuse]
    assert nombres[-4:] == ["armar1", "revisar1", "armar2", "revisar2"]
    assert [o for o in langfuse if o["nombre"] == "revisar2"][0]["updates"][0]["output"]["ok"] \
        is False


def test_fuera_de_una_corrida_las_etapas_no_mandan_nada(langfuse, monkeypatch):
    """La ingesta y el eval corren con las claves de PLATAFORMA del .env:
    embeber fuera de una corrida no puede terminar trazado."""
    monkeypatch.setenv("EMBEDDINGS", "openai")
    with trazas_rag.etapa("buscar", tipo="retriever", entrada={"x": 1}) as o:
        o.update(output=1)
    embeddings.embeber(["hola"], "consulta", cli=_OpenAI())
    assert langfuse == []


def test_la_etapa_anota_el_error_y_lo_deja_salir(langfuse):
    with pytest.raises(ZeroDivisionError):
        with trazas_rag.corrida(1):
            with trazas_rag.etapa("buscar"):
                1 / 0
    buscar = [o for o in langfuse if o["nombre"] == "buscar"][0]
    assert buscar["updates"][0]["level"] == "ERROR"
    assert "ZeroDivisionError" in buscar["updates"][0]["status_message"]


def test_si_langfuse_falla_al_abrir_la_etapa_la_corrida_sigue(langfuse, monkeypatch):
    with trazas_rag.corrida(1):
        cli = trazas_rag._EN_CORRIDA.get()

        def truena(**kw):
            raise ConnectionError("sin red")
        monkeypatch.setattr(cli, "start_as_current_observation", truena)
        with trazas_rag.etapa("buscar") as o:
            o.update(output=1)
            hecho = True
    assert hecho
    assert trazas_rag._EN_CORRIDA.get() is None              # al cerrar, se suelta


# ---------------------------------------------------------------------------
# RAG·24 — el uso que se guarda y el costo

def test_el_uso_guardado_trae_embeddings_y_consultas(corrida, monkeypatch):
    _con_claude(monkeypatch, {"cubre": True, "flujo": flujo_bueno(), "resumen": "r"})
    worker.procesar(7)
    [(_, kw)] = corrida["cerradas"]
    uso = kw["resultado"]["uso"]
    assert uso["consultas_vector"] == 1
    emb = [ll for ll in uso["llamadas"] if ll.get("tipo") == "embedding"]
    assert emb == [{"etapa": "embeber_consulta", "modelo": "text-embedding-3-small",
                    "tipo": "embedding", "entrada": 17, "salida": 0, "cache_escrita": 0,
                    "cache_leida": 0}]
    assert [ll["etapa"] for ll in uso["llamadas"]] == ["embeber_consulta", "armar1"]
    assert uso["total"]["entrada"] == 1017


def test_no_salio_tambien_guarda_lo_que_gasto(corrida, monkeypatch):
    _con_claude(monkeypatch, {"cubre": True, "flujo": flujo_malo()},
                {"cubre": True, "flujo": flujo_malo()})
    assert worker.procesar(7) == "no_salio"
    [(e, kw)] = corrida["cerradas"]
    assert e == "no_salio" and set(kw["resultado"]) == {"uso"}     # nada descargable
    assert [ll["etapa"] for ll in kw["resultado"]["uso"]["llamadas"]] == \
        ["embeber_consulta", "armar1", "armar2"]


def test_costo_con_embeddings_y_consultas(monkeypatch):
    monkeypatch.setattr(costos_rag, "_rag", lambda: {
        "modelos": {"m": {"entrada": 2.0, "salida": 10.0, "cache_escrita": 0.0,
                          "cache_leida": 0.0},
                    "e": {"entrada": 0.5}},
        "s3vectors": {"consultas_por_millon": 4.0}})
    uso = claude_rag.Uso()
    uso.llamadas.append({"etapa": "armar1", "modelo": "m", "entrada": 1_000_000,
                         "salida": 0, "cache_escrita": 0, "cache_leida": 0})
    uso.sumar_embedding("embeber_consulta", "e", 2_000_000)
    uso.consultas = 500_000
    assert costos_rag.costo_usd(uso) == 2.0 + 1.0 + 2.0
    # el mismo cálculo desde lo guardado en la corrida
    assert costos_rag.costo_de_resultado(json.loads(json.dumps(uso.como_dict()))) == 5.0


def test_sin_precio_de_consultas_o_sin_tokens_no_hay_costo(monkeypatch):
    monkeypatch.setattr(costos_rag, "_rag", lambda: {"modelos": {"e": {"entrada": 0.5}}})
    uso = claude_rag.Uso()
    uso.sumar_embedding("embeber_consulta", "e", 10)
    assert costos_rag.costo_usd(uso) is not None
    uso.consultas = 1
    assert costos_rag.costo_usd(uso) is None           # falta el precio de S3 Vectors
    uso = claude_rag.Uso()
    uso.sumar_embedding("embeber_consulta", "e", None)  # Gemini no dice sus tokens
    assert costos_rag.costo_usd(uso) is None
    assert uso.total()["entrada"] == 0
    assert costos_rag.costo_de_resultado(None) is None


def test_embeber_anota_sus_tokens(monkeypatch):
    monkeypatch.setenv("EMBEDDINGS", "openai")
    uso = claude_rag.Uso()
    embeddings.embeber(["a", "b"], "documento", cli=_OpenAI(), uso=uso)
    assert uso.llamadas[0]["entrada"] == 17 and uso.llamadas[0]["etapa"] == "embeber_documento"
    embeddings.embeber(["a"], "documento", cli=_OpenAI())      # sin uso: no anota nada
    assert len(uso.llamadas) == 1


# ---------------------------------------------------------------------------
# tools/automatiza.py corridas

def _fila(id_, estado, seg, uso):
    return {"id": id_, "estado": estado, "modelo": "claude-opus-5-5", "intentos": "1",
            "uso": json.dumps(uso) if uso is not None else None, "seg": str(seg),
            "creado": "10-01 04:44"}


def _uso():
    u = claude_rag.Uso()
    u.llamadas.append({"etapa": "armar1", "modelo": "m", "entrada": 1000, "salida": 500,
                       "cache_escrita": 0, "cache_leida": 0})
    u.sumar_embedding("embeber_consulta", "e", 17)
    u.consultas = 1
    return u.como_dict()


def test_resumen_de_corridas_sin_precios(monkeypatch):
    from tools import automatiza
    monkeypatch.setattr(costos_rag, "_rag", lambda: {})
    lineas = automatiza.resumen_corridas([_fila(1, "listo", 45.7, _uso()),
                                          _fila(2, "no_salio", 3.0, None)])
    texto = "\n".join(lineas)
    assert "1000/500" in lineas[1] and "   17" in lineas[1]
    assert texto.count("sin precio confirmado") == 3          # dos corridas y el total
    assert "armado promedio de las listas: 46 s" in texto
    assert "centavo" not in texto


def test_resumen_de_corridas_con_precios(monkeypatch):
    from tools import automatiza
    monkeypatch.setattr(costos_rag, "_rag", lambda: {
        "modelos": {"m": {"entrada": 2.0, "salida": 10.0, "cache_escrita": 0.0,
                          "cache_leida": 0.0}, "e": {"entrada": 1.0}},
        "s3vectors": {"consultas_por_millon": 1.0}})
    lineas = automatiza.resumen_corridas([_fila(1, "listo", 40, _uso())] * 3)
    assert lineas[1].endswith("$0.01 dólares")
    assert lineas[-2] == "Costo total: $0.02 dólares"
    assert automatiza.resumen_corridas([])[-2] == "Costo total: $0.00 dólares"


def test_corridas_recientes_no_lee_texto_ni_flujo(monkeypatch):
    vistos = []
    monkeypatch.setattr(db, "ejecutar", lambda sql, p=None: vistos.append((sql, p)) or [])
    db.automatiza_corridas_recientes(7)
    sql, p = vistos[0]
    assert p == {"d": 7} and "rechazada" in sql
    assert "texto" not in sql and "'flujo'" not in sql and "ip_hash" not in sql


def test_todo_make_interval_lleva_cast_a_int():
    """El Data API manda los int de Python como bigint y make_interval solo
    existe con int4 («function make_interval(days => bigint) does not
    exist»). Ya se rompió tres veces: este guardián revisa TODO pipeline/."""
    import re
    from pathlib import Path
    raiz = Path(__file__).resolve().parent.parent / "pipeline"
    malos = []
    for f in raiz.rglob("*.py"):
        for n, linea in enumerate(f.read_text(encoding="utf-8").splitlines(), 1):
            for m in re.finditer(r"make_interval\(\s*\w+\s*=>\s*(:\w+)(::int)?", linea):
                if not m.group(2):
                    malos.append(f"{f.name}:{n}")
    assert malos == [], f"make_interval sin ::int en {malos}"
