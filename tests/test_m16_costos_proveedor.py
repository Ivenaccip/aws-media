"""M16 — desglose de la IA por vendor (OpenAI / fal / Claude) en el panel:
el sync reparte cada traza por el modelo de sus observations y el resumen del
admin agrega costo_ia_prov. Sin red: Langfuse/Postgres mockeados."""
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from pipeline import db  # noqa: E402
from tools import costes  # noqa: E402


# ---------------------------------------------------------------------------
# proveedor_de_modelo — el mapa modelo → vendor

def test_proveedor_de_modelo():
    assert costes.proveedor_de_modelo("gpt-5-mini") == "openai"
    assert costes.proveedor_de_modelo("claude-opus-5") == "claude"
    assert costes.proveedor_de_modelo("veo3.1-lite") == "fal"
    assert costes.proveedor_de_modelo("nano-banana-edit") == "fal"
    assert costes.proveedor_de_modelo("elevenlabs-tts-v3") == "fal"
    assert costes.proveedor_de_modelo(None) is None
    assert costes.proveedor_de_modelo("") is None


# ---------------------------------------------------------------------------
# costos_por_proveedor — una traza mixta se reparte por vendor

def test_costos_por_proveedor_reparte(monkeypatch):
    monkeypatch.setenv("LANGFUSE_PUBLIC_KEY", "pk")
    monkeypatch.setenv("LANGFUSE_SECRET_KEY", "sk")

    class R:
        status_code = 200

        def raise_for_status(self):
            pass

        def json(self):
            return {"observations": [
                {"model": "gpt-5-mini", "calculatedTotalCost": 0.011},
                {"model": "veo3.1-lite", "calculatedTotalCost": 0.4},
                {"model": "nano-banana", "calculatedTotalCost": 0.039},
                {"model": "claude-opus-5", "calculatedTotalCost": 0.0099},
                {"model": None, "calculatedTotalCost": None},   # span sin modelo
            ]}
    import requests
    monkeypatch.setattr(requests, "get", lambda *a, **k: R())
    assert costes.costos_por_proveedor("t1") == \
        {"openai": 0.011, "fal": 0.439, "claude": 0.0099}


def test_costos_por_proveedor_reintenta_429(monkeypatch):
    """Rate limit de Langfuse (visto 2026-09-08: 76/103 trazas al fallback):
    el 429 se reintenta con espera en vez de degradar el desglose."""
    monkeypatch.setenv("LANGFUSE_PUBLIC_KEY", "pk")
    monkeypatch.setenv("LANGFUSE_SECRET_KEY", "sk")
    import time

    import requests

    llamadas = []
    esperas = []

    class R:
        def __init__(self, status):
            self.status_code = status

        def raise_for_status(self):
            pass

        def json(self):
            return {"observations": [
                {"model": "claude-opus-5", "calculatedTotalCost": 0.0099}]}

    def get(*a, **k):
        llamadas.append(1)
        return R(429 if len(llamadas) < 3 else 200)

    monkeypatch.setattr(requests, "get", get)
    monkeypatch.setattr(time, "sleep", lambda s: esperas.append(s))
    assert costes.costos_por_proveedor("t1") == {"claude": 0.0099}
    assert len(llamadas) == 3 and esperas == [5, 10]


def test_costos_por_proveedor_sin_detalle_vacio(monkeypatch):
    monkeypatch.setenv("LANGFUSE_PUBLIC_KEY", "pk")
    monkeypatch.setenv("LANGFUSE_SECRET_KEY", "sk")
    import requests

    def truena(*a, **k):
        raise RuntimeError("timeout")
    monkeypatch.setattr(requests, "get", truena)
    assert costes.costos_por_proveedor("t1") == {}


# ---------------------------------------------------------------------------
# sincronizar — una fila por vendor; sin desglose cae a 'langfuse'

def _sync(monkeypatch, partes):
    filas = []

    def ejecutar(sql, p=None):
        if sql.startswith("SELECT traza"):
            return []
        filas.append(p)
        return []
    monkeypatch.setattr(db, "ejecutar", ejecutar)
    monkeypatch.setattr(costes, "costos_por_proveedor", lambda tid: partes)
    n = costes.sincronizar(trazas=[{
        "id": "t1", "totalCost": 0.45, "userId": "u1",
        "sessionId": "gen-abc", "name": "pelicula"}])
    return n, filas


def test_sincronizar_desglosa_por_vendor(monkeypatch):
    n, filas = _sync(monkeypatch, {"openai": 0.011, "fal": 0.439})
    assert n == 1 and len(filas) == 2
    assert {(f["prov"], f["usd"]) for f in filas} == {("openai", 0.011), ("fal", 0.439)}
    assert all(f["t"] == "t1" and f["c"] == "pelicula" for f in filas)


def test_sincronizar_sin_desglose_fila_unica(monkeypatch):
    n, filas = _sync(monkeypatch, {})
    assert n == 1 and len(filas) == 1
    assert filas[0]["prov"] == "langfuse" and filas[0]["usd"] == 0.45


# ---------------------------------------------------------------------------
# resumen del admin — costo_ia_prov por usuario y en totales

@pytest.fixture
def cliente(monkeypatch):
    monkeypatch.delenv("COGNITO_POOL_ID", raising=False)
    monkeypatch.delenv("MEDIA_BUCKET", raising=False)
    monkeypatch.setenv("STATE_BACKEND", "postgres")
    from server.app import app
    return TestClient(app)


def test_resumen_desglosa_ia_por_vendor(cliente, monkeypatch):
    def ejecutar(sql, p=None):
        if "FROM monedero_movimientos" in sql:
            return []
        if "FROM monedero" in sql:
            return []
        if "FROM proyectos_gen" in sql:
            return []
        if "FROM costes" in sql:
            return [
                {"user_id": "a", "concepto": "pelicula", "proveedor": "openai", "usd": 0.011},
                {"user_id": "a", "concepto": "pelicula", "proveedor": "fal", "usd": 0.439},
                {"user_id": "a", "concepto": "chat_editor", "proveedor": "claude", "usd": 0.0099},
                {"user_id": "a", "concepto": "vieja", "proveedor": "langfuse", "usd": 0.5},
                {"user_id": "a", "concepto": "infra-render", "proveedor": "aws", "usd": 0.02},
            ]
        if "FROM usuarios" in sql:
            return []
        raise AssertionError(f"query inesperada: {sql}")
    monkeypatch.setattr(db, "ejecutar", ejecutar)
    d = cliente.get("/api/admin/resumen").json()
    u = d["usuarios"][0]
    assert u["costo_ia_prov"] == {"openai": 0.011, "fal": 0.439,
                                  "claude": 0.0099, "otros": 0.5}
    assert u["costo_aws_usd"] == 0.02
    # la IA total sigue cuadrando: vendors + lo viejo sin desglose
    assert u["costo_ia_usd"] == round(0.011 + 0.439 + 0.0099 + 0.5, 4)
    assert d["totales"]["costo_ia_prov"]["claude"] == 0.0099
