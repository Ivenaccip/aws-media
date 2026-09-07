"""M13 — guardrail del brief: /api/moderar y pipeline.moderacion. Sin red:
el LLM se finge con monkeypatch."""
import pytest
from fastapi.testclient import TestClient

from pipeline import moderacion


@pytest.fixture
def cliente():
    from server.app import app
    return TestClient(app)


def _finge_llm(monkeypatch, respuesta):
    async def fake(name, system, user):
        return respuesta
    monkeypatch.setattr(moderacion, "chat_json", fake)


@pytest.mark.asyncio
async def test_revisar_permite(monkeypatch):
    _finge_llm(monkeypatch, {"permitido": True, "motivo": ""})
    v = await moderacion.revisar("un zorro busca un faro")
    assert v.permitido and v.motivo == ""


@pytest.mark.asyncio
async def test_revisar_bloquea_con_motivo(monkeypatch):
    _finge_llm(monkeypatch, {"permitido": False, "motivo": "pide gore explícito"})
    v = await moderacion.revisar("algo con sangre por todos lados")
    assert not v.permitido
    assert v.motivo == "pide gore explícito"


@pytest.mark.asyncio
async def test_revisar_vacio_pasa_sin_llm(monkeypatch):
    async def revienta(*a):
        raise AssertionError("no debió llamar al LLM")
    monkeypatch.setattr(moderacion, "chat_json", revienta)
    assert (await moderacion.revisar("   ")).permitido


@pytest.mark.asyncio
async def test_revisar_falla_abierto(monkeypatch):
    async def caido(*a):
        raise RuntimeError("LLM caído")
    monkeypatch.setattr(moderacion, "chat_json", caido)
    assert (await moderacion.revisar("cualquier cosa")).permitido


def test_endpoint_moderar(cliente, monkeypatch):
    _finge_llm(monkeypatch, {"permitido": False, "motivo": "contenido sexual"})
    d = cliente.post("/api/moderar", json={"texto": "x"}).json()
    assert d["permitido"] is False
    assert d["motivo"] == "contenido sexual"
    assert "violencia" in d["mensaje"]
