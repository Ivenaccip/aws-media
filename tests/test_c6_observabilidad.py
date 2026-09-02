"""C6 — user_id en las trazas (base de facturación) y agregación de costes."""
import asyncio
import importlib
import sys
from contextlib import contextmanager
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from tools.costes import resumen  # noqa: E402


def test_resumen_agrega_por_usuario_y_proyecto():
    trazas = [
        {"userId": "piloto", "sessionId": "abc", "totalCost": 0.08},
        {"userId": "piloto", "sessionId": "abc", "totalCost": 1.23},
        {"userId": "piloto", "sessionId": "otro", "totalCost": 0.10},
        {"userId": "ana", "sessionId": "xyz", "totalCost": 0.50},
    ]
    agg = resumen(trazas)
    assert agg["piloto"]["abc"] == 1.31
    assert agg["piloto"]["otro"] == 0.10
    assert agg["ana"] == {"xyz": 0.50}


def test_resumen_ignora_sin_costo_y_marca_trazas_viejas():
    trazas = [
        {"userId": None, "sessionId": "viejo", "totalCost": 0.30},  # pre-C6
        {"userId": "piloto", "sessionId": "abc", "totalCost": 0},
        {"userId": "piloto", "sessionId": "abc"},                   # sin totalCost
    ]
    agg = resumen(trazas)
    assert agg == {"?": {"viejo": 0.30}}


def _preparar_con_captura(monkeypatch):
    """Corre flow.preparar con todo stubbeado; devuelve los kwargs de la traza."""
    import pipeline.flow as flow
    importlib.reload(flow)
    capturado = {}

    @contextmanager
    def fake_propagate(**kwargs):
        capturado.update(kwargs)
        yield

    async def fake_preparar(p):
        pass

    monkeypatch.setattr(flow, "propagate_attributes", fake_propagate)
    monkeypatch.setattr(flow, "_preparar", fake_preparar)
    monkeypatch.setattr(flow, "get_client",
                        lambda: SimpleNamespace(flush=lambda: None))
    p = SimpleNamespace(id="t1", estado="", etapa=None, error=None,
                        guardar=lambda: None)
    asyncio.run(flow.preparar(p))
    return capturado


def test_preparar_propaga_user_id_default(monkeypatch):
    monkeypatch.delenv("DEFAULT_USER_ID", raising=False)
    kwargs = _preparar_con_captura(monkeypatch)
    assert kwargs["user_id"] == "piloto"
    assert kwargs["session_id"] == "t1"


def test_preparar_propaga_user_id_del_entorno(monkeypatch):
    monkeypatch.setenv("DEFAULT_USER_ID", "ana")
    kwargs = _preparar_con_captura(monkeypatch)
    assert kwargs["user_id"] == "ana"
