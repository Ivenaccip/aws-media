"""M14 — Editar en la web (corrida de sugerencias) + balanceador de formato.
Sin red ni Postgres: LLM y jobs se fingen con monkeypatch."""
import json

import pytest
from fastapi.testclient import TestClient

from pipeline import creditos, db, research, writer
from pipeline.config import load_prompt
from worker.editar_task import construir_cuts


@pytest.fixture
def cliente():
    from server.app import app
    return TestClient(app)


# ---------------------------------------------------------------------------
# tarifa

def test_costo_editar_sugerencias():
    assert creditos.costo_editar_sugerencias(60, True) == creditos.EDITAR_SUGERENCIAS_CR
    # 11 min sin transcript = 3 bloques de 5 min empezados
    assert creditos.costo_editar_sugerencias(660, False) == \
        creditos.EDITAR_SUGERENCIAS_CR + 3 * creditos.SHORTS_TRANSCRIPCION_CR_5MIN


# ---------------------------------------------------------------------------
# construir_cuts: keeps = complemento (el material jamás se pierde)

def _salida(cortes=(), fluff=(), flags=()):
    return {"cortes": list(cortes), "fluff": list(fluff), "flags": list(flags)}


def test_cuts_complemento_y_categorias():
    c = construir_cuts("video-x", "0233", "subidas/a.mp4", 100.0, _salida(
        cortes=[{"s": 10, "e": 20, "cat": "retake", "text": "t", "note": "n"},
                {"s": 18, "e": 30, "cat": "filler"},          # solapa → se fusiona
                {"s": 50, "e": 55, "cat": "inventada"}],       # cat inválida → fuera
        fluff=[{"s": 60, "e": 70, "text": "f", "crit": "restated-idea"},
               {"s": 80, "e": 81, "crit": "otra"}],            # crit inválido → fuera
        flags=[{"at": "00:30", "issue": "duda", "default": "keep both"}, {"at": "x"}]))
    clip = c["clips"][0]
    assert [(k["s"], k["e"]) for k in clip["keeps"]] == [(0.0, 10.0), (30.0, 100.0)]
    assert len(clip["cuts"]) == 2 and {x["cat"] for x in clip["cuts"]} == {"retake", "filler"}
    assert clip["fluff_suggestions"] == [
        {"s": 60.0, "e": 70.0, "text": "f", "crit": "restated-idea", "status": "suggested"}]
    assert len(c["flags"]) == 1 and c["flags"][0]["status"] == "pending"
    assert c["clip_order"] == ["0233"] and "styles" in c


def test_cuts_todo_cortado_conserva_completo():
    c = construir_cuts("v", "a", "subidas/a.mp4", 50.0, _salida(
        cortes=[{"s": 0, "e": 50, "cat": "dead_air"}]))
    assert c["clips"][0]["keeps"] == [{"s": 0.0, "e": 50.0, "text": ""}]


# ---------------------------------------------------------------------------
# /api/editar

def test_editar_503_en_local(cliente):
    assert cliente.get("/api/editar/video-1").status_code == 503


def _nube(monkeypatch, doc):
    from server import editar_api
    monkeypatch.setattr(db, "backend", lambda: "postgres")
    monkeypatch.setattr("server.shorts_api._proyecto", lambda n: doc)
    monkeypatch.setattr(editar_api, "_proyecto", lambda n: doc)
    monkeypatch.setattr(editar_api, "_duracion_s", lambda k: 360.0)
    monkeypatch.setattr(editar_api, "_con_transcript", lambda n: False)
    monkeypatch.setenv("ASSEMBLYAI_API_KEY", "x")


def test_editar_costo_y_sugerir(cliente, monkeypatch):
    doc = {"subidas": [{"key": "videos/v/subidas/a.mp4"}]}
    _nube(monkeypatch, doc)
    c = cliente.get("/api/editar/video-1/costo").json()
    assert c["creditos"] == creditos.costo_editar_sugerencias(360, False)
    assert c["backend_listo"] is True

    guardado, lanzado = {}, []
    monkeypatch.setattr(db, "fijar_campo_editor",
                        lambda u, n, campo, v: guardado.update({campo: json.loads(v)}))
    monkeypatch.setattr(db, "usuario_actual", lambda: "u1")
    from pipeline import jobs
    monkeypatch.setattr(jobs, "lanzar_editar", lambda u, n: lanzado.append((u, n)))
    r = cliente.post("/api/editar/video-1/sugerir")
    assert r.status_code == 200 and r.json()["lanzado"] is True
    assert lanzado == [("u1", "video-1")]
    assert guardado["editar"]["estado"] == "corriendo"

    # con la corrida en curso, el segundo intento es 409
    doc["editar"] = guardado["editar"]
    assert cliente.post("/api/editar/video-1/sugerir").status_code == 409


def test_editar_sugerir_devuelve_si_no_lanza(cliente, monkeypatch):
    _nube(monkeypatch, {"subidas": [{"key": "videos/v/subidas/a.mp4"}]})
    movs = []
    monkeypatch.setattr(db, "fijar_campo_editor", lambda *a: None)
    monkeypatch.setattr(db, "usuario_actual", lambda: "u1")
    monkeypatch.setattr(creditos, "activo", lambda: True)
    monkeypatch.setattr(creditos, "cobrar", lambda n, ref, u=None: movs.append(("cobro", n)))
    monkeypatch.setattr(creditos, "devolver", lambda n, ref, u=None: movs.append(("devolucion", n)))
    from pipeline import jobs
    def truena(u, n):
        raise RuntimeError("sin SFN")
    monkeypatch.setattr(jobs, "lanzar_editar", truena)
    assert cliente.post("/api/editar/video-1/sugerir").status_code == 502
    assert movs[0][0] == "cobro" and movs[1][0] == "devolucion" and movs[0][1] == movs[1][1]


# ---------------------------------------------------------------------------
# balanceador de formato

@pytest.mark.asyncio
async def test_clasificar_devuelve_formato(monkeypatch):
    async def fake(name, system, user):
        return {"tipo": "idea", "formato": "lista", "motivo": "pide 3 curiosidades"}
    monkeypatch.setattr(research, "chat_json", fake)
    assert await research.clasificar("3 curiosidades de los flamencos") == ("idea", "lista")


@pytest.mark.asyncio
async def test_clasificar_formato_invalido_cae_a_cuento(monkeypatch):
    async def fake(name, system, user):
        return {"tipo": "historia", "formato": "haiku"}
    monkeypatch.setattr(research, "chat_json", fake)
    assert await research.clasificar("x" * 700) == ("historia", "cuento")


def test_prompts_formatean_con_reglas_de_formato():
    """Los system del guionista y narrador llevan {formato_reglas}: si el
    placeholder se rompe, esto truena antes que producción."""
    pres = writer.presupuesto(30)
    for formato, reglas in writer.FORMATO_REGLAS.items():
        s = load_prompt("guionista_system").format(**pres, formato_reglas=reglas)
        assert reglas.splitlines()[0] in s
    n = load_prompt("narrador_system").format(duracion_s=30, palabras_max=57,
                                              formato_reglas=writer.FORMATO_REGLAS["lista"])
    assert "LISTA" in n


@pytest.mark.asyncio
async def test_guionista_recibe_reglas_del_formato(monkeypatch):
    visto = {}
    async def fake(name, system, user):
        visto["system"] = str(system)
        return {"titulo": "t", "escenas": [{"narracion": "una escena de prueba"}]}
    monkeypatch.setattr(writer, "chat_json", fake)
    await writer.escribir_guion("m", "idea", "Animado", 30, None, "lista")
    assert "el usuario pidió una enumeración" in visto["system"]
