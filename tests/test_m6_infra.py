"""M6.1 — línea estimada de infra AWS por corrida: tarifas desde pricing.json,
el cálculo Fargate/Lambda, el registro en la tabla costes (que jamás tumba una
corrida) y que los dos ejecutores la escriben. Sin red ni AWS."""
import asyncio
import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from pipeline import costes_infra, creditos, db, flow, media_sync
import pipeline.project as project_mod

REPO = Path(__file__).resolve().parent.parent


# ---------------------------------------------------------------------------
# tarifas y cálculo

def test_tarifas_salen_de_pricing_json():
    aws = json.loads((REPO / "tools" / "pricing.json").read_text(encoding="utf-8"))["aws_infra"]
    assert costes_infra.FARGATE_USD_VCPU_HORA == aws["fargate"]["usd_por_vcpu_hora"]
    assert costes_infra.FARGATE_USD_GB_HORA == aws["fargate"]["usd_por_gb_hora"]
    assert costes_infra.LAMBDA_USD_GB_SEGUNDO == aws["lambda"]["usd_por_gb_segundo"]


def test_costo_fargate_produccion_medida():
    # la producción E2E real de C4: 407 s en 4 vCPU / 8 GB ≈ $0.02 dólares
    esperado = round((4 * costes_infra.FARGATE_USD_VCPU_HORA
                      + 8 * costes_infra.FARGATE_USD_GB_HORA) * 407 / 3600, 4)
    assert costes_infra.costo_fargate(407) == esperado == 0.0223


def test_costo_lambda_preparar_medido(monkeypatch):
    monkeypatch.delenv("AWS_LAMBDA_FUNCTION_MEMORY_SIZE", raising=False)
    # preparar real de C4: ~137 s en el worker de 3008 MB ≈ $0.007 dólares
    assert costes_infra.costo_lambda(137) == 0.0067
    monkeypatch.setenv("AWS_LAMBDA_FUNCTION_MEMORY_SIZE", "1024")
    assert costes_infra.costo_lambda(100) == round(100 * costes_infra.LAMBDA_USD_GB_SEGUNDO, 4)


# ---------------------------------------------------------------------------
# registrar: solo postgres, nunca propaga, filas con proveedor aws

def test_registrar_inserta_en_costes(monkeypatch):
    monkeypatch.setenv("STATE_BACKEND", "postgres")
    capturado = {}
    monkeypatch.setattr(db, "ejecutar",
                        lambda s, p=None: capturado.update(sql=s, params=p) or [])
    costes_infra.registrar("sub-abc", "p1", "infra-producir", 0.0223)
    assert "'aws'" in capturado["sql"] and "INSERT INTO costes" in capturado["sql"]
    assert capturado["params"] == {"u": "sub-abc", "p": "p1",
                                   "c": "infra-producir", "usd": 0.0223}


def test_registrar_dev_local_y_costo_cero_no_tocan_db(monkeypatch):
    toco = lambda s, p=None: pytest.fail("no debía tocar la base")
    monkeypatch.delenv("STATE_BACKEND", raising=False)
    monkeypatch.setattr(db, "ejecutar", toco)
    costes_infra.registrar("u", "p", "infra-producir", 0.02)   # backend json
    monkeypatch.setenv("STATE_BACKEND", "postgres")
    costes_infra.registrar("u", "p", "infra-producir", 0.0)    # sin costo


def test_registrar_jamas_propaga(monkeypatch):
    monkeypatch.setenv("STATE_BACKEND", "postgres")
    def truena(s, p=None):
        raise RuntimeError("Aurora dormida")
    monkeypatch.setattr(db, "ejecutar", truena)
    costes_infra.registrar("u", "p", "infra-producir", 0.02)   # no levanta


# ---------------------------------------------------------------------------
# los ejecutores escriben la línea

@pytest.fixture
def pipeline_falso(monkeypatch, tmp_path):
    async def nada(p):
        return None
    monkeypatch.setattr(flow, "producir", nada)
    monkeypatch.setattr(flow, "preparar", nada)
    monkeypatch.setattr(media_sync, "bajar_prefijo", lambda pref, d: 0)
    monkeypatch.setattr(media_sync, "subir_dir", lambda d, pref: 0)
    monkeypatch.setattr(creditos, "activo", lambda: False)
    p = SimpleNamespace(estado="listo", workdir=tmp_path, progreso={},
                        duracion_s=30, error=None)
    monkeypatch.setattr(project_mod, "cargar_proyecto", lambda id_: p)
    lineas = []
    monkeypatch.setattr(costes_infra, "registrar",
                        lambda u, i, c, usd: lineas.append((u, i, c, usd)))
    return lineas


def test_producir_task_registra_fargate(pipeline_falso):
    from worker import producir_task
    assert producir_task.main("sub-abc", "p1") == 0
    (u, i, c, usd), = pipeline_falso
    assert (u, i, c) == ("sub-abc", "p1", "infra-producir") and usd >= 0


def test_lambda_worker_registra_preparar(pipeline_falso):
    from worker import lambda_worker
    lambda_worker._preparar("sub-abc", "p1")
    (u, i, c, usd), = pipeline_falso
    assert (u, i, c) == ("sub-abc", "p1", "infra-preparar") and usd >= 0
