"""C5 — monedero de créditos: tarifa, gate duro y devoluciones (sin AWS real)."""
import asyncio
import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from pipeline import creditos, db


# ---------------------------------------------------------------------------
# backend apagado por default: dev local intacto

def test_backend_default_off(monkeypatch):
    monkeypatch.delenv("CREDITOS_BACKEND", raising=False)
    assert creditos.backend() == "off"
    assert not creditos.activo()


# ---------------------------------------------------------------------------
# tarifa: tools/tarifas.json es la fuente y cuadra con docs/ECONOMIA.md

def test_tarifas_json_es_la_fuente():
    datos = json.loads((Path(__file__).resolve().parent.parent / "tools"
                        / "tarifas.json").read_text(encoding="utf-8"))
    assert datos["video"]["preparar"] == creditos.costo_preparar() == 10
    assert datos["video"]["por_segundo"] == creditos.VIDEO_CR_POR_SEGUNDO == 3
    assert "verified_on" in datos


def test_costo_producir_por_duracion_objetivo():
    assert creditos.costo_producir(30) == 90          # película de 30 s
    assert creditos.costo_producir(60) == 180
    assert creditos.costo_producir(30.5) == 92        # la estimación, hacia arriba


def test_pelicula_de_30s_cuesta_100_creditos():
    # la promesa de la spec: preparar (10) + producir 30 s (90) = 100 = cortesía mensual
    assert creditos.costo_preparar() + creditos.costo_producir(30) == 100


# ---------------------------------------------------------------------------
# repos db: cobrar es un UPDATE condicionado (atómico) + movimiento en el mayor

def test_cobrar_creditos_atomico(monkeypatch):
    llamadas = []

    def falso_ejecutar(sql, params=None):
        llamadas.append((sql, params))
        return [{"saldo": 90}] if sql.strip().startswith("UPDATE") else []
    monkeypatch.setattr(db, "ejecutar", falso_ejecutar)
    assert db.cobrar_creditos("piloto", 10, "preparar:abc") == 90
    sql_update, params = llamadas[0]
    assert "saldo >= :n" in sql_update and "RETURNING saldo" in sql_update
    assert params == {"u": "piloto", "n": 10}
    sql_mov, params_mov = llamadas[1]
    assert "monedero_movimientos" in sql_mov and params_mov["n"] == -10


def test_cobrar_sin_saldo_no_registra_movimiento(monkeypatch):
    llamadas = []
    monkeypatch.setattr(db, "ejecutar",
                        lambda sql, params=None: llamadas.append(sql) or [])
    assert db.cobrar_creditos("piloto", 10) is None
    assert len(llamadas) == 1   # solo el UPDATE fallido; el mayor queda intacto


def test_abonar_asegura_usuario_y_registra(monkeypatch):
    llamadas = []

    def falso_ejecutar(sql, params=None):
        llamadas.append(sql)
        return [{"saldo": 100}] if "RETURNING" in sql else []
    monkeypatch.setattr(db, "ejecutar", falso_ejecutar)
    assert db.abonar_creditos("piloto", 100, "cortesia") == 100
    assert "ON CONFLICT (id) DO NOTHING" in llamadas[0]
    assert "monedero_movimientos" in llamadas[2]


# ---------------------------------------------------------------------------
# creditos.cobrar levanta SinSaldo con costo y saldo legibles

def test_cobrar_levanta_sin_saldo(monkeypatch):
    monkeypatch.setattr(db, "cobrar_creditos", lambda u, n, r=None: None)
    monkeypatch.setattr(db, "saldo_creditos", lambda u: 4)
    with pytest.raises(creditos.SinSaldo) as exc:
        creditos.cobrar(10, "preparar:abc")
    assert exc.value.costo == 10 and exc.value.saldo == 4
    assert "10 créditos" in str(exc.value) and "saldo es 4" in str(exc.value)


def test_devolver_abona_como_devolucion(monkeypatch):
    capturado = {}
    monkeypatch.setattr(db, "abonar_creditos",
                        lambda u, n, t, r=None: capturado.update(u=u, n=n, t=t, r=r) or 100)
    creditos.devolver(90, "producir:abc", "piloto")
    assert capturado == {"u": "piloto", "n": 90, "t": "devolucion", "r": "producir:abc"}


# ---------------------------------------------------------------------------
# gate 402 en el API: sin saldo no se lanza nada (y no se encola nada)

def _proyecto_en_revision(tmp_path):
    from pipeline import project
    return project.Proyecto(
        id="abc123", creado="2026-09-01T10:00:00", brief="un brief",
        estado="revision", duracion_s=30,
        guion=[project.EscenaGuion(id="1", narracion="hola")],
        personaje=project.Personaje(
            opciones=[project.OpcionPersonaje(url="u", path="p")], elegida=0),
    )


def test_producir_402_sin_saldo(tmp_path, monkeypatch):
    from fastapi import HTTPException
    from server import app as srv
    monkeypatch.setenv("CREDITOS_BACKEND", "postgres")
    monkeypatch.setattr(srv, "cargar_proyecto",
                        lambda i: _proyecto_en_revision(tmp_path))
    monkeypatch.setattr(db, "cobrar_creditos", lambda u, n, r=None: None)
    monkeypatch.setattr(db, "saldo_creditos", lambda u: 0)
    monkeypatch.setattr(srv.jobs, "lanzar_produccion",
                        lambda *a: pytest.fail("sin saldo NO se lanza producción"))
    with pytest.raises(HTTPException) as exc:
        asyncio.run(srv.producir("abc123"))
    assert exc.value.status_code == 402


def test_producir_cobra_90_por_30s_y_lanza(tmp_path, monkeypatch):
    from pipeline import project
    from server import app as srv
    monkeypatch.setenv("CREDITOS_BACKEND", "postgres")
    monkeypatch.setenv("JOBS_BACKEND", "aws")
    monkeypatch.setattr(project, "settings", SimpleNamespace(work_dir=tmp_path))
    p = _proyecto_en_revision(tmp_path)
    monkeypatch.setattr(srv, "cargar_proyecto", lambda i: p)
    monkeypatch.setattr(db, "guardar_proyecto", lambda *a: None)
    cobros, lanzadas = [], []
    monkeypatch.setattr(db, "cobrar_creditos",
                        lambda u, n, r=None: cobros.append((u, n, r)) or 10)
    monkeypatch.setattr(srv.jobs, "lanzar_produccion",
                        lambda u, i: lanzadas.append(i) or "arn:exec")
    asyncio.run(srv.producir("abc123"))
    assert cobros == [("piloto", 90, "producir:abc123")]
    assert lanzadas == ["abc123"] and p.estado == "produciendo"


def test_producir_devuelve_si_lanzar_truena(tmp_path, monkeypatch):
    from pipeline import project
    from server import app as srv
    monkeypatch.setenv("CREDITOS_BACKEND", "postgres")
    monkeypatch.setenv("JOBS_BACKEND", "aws")
    monkeypatch.setattr(project, "settings", SimpleNamespace(work_dir=tmp_path))
    monkeypatch.setattr(srv, "cargar_proyecto",
                        lambda i: _proyecto_en_revision(tmp_path))
    monkeypatch.setattr(db, "guardar_proyecto", lambda *a: None)
    monkeypatch.setattr(db, "cobrar_creditos", lambda u, n, r=None: 10)
    devueltos = []
    monkeypatch.setattr(db, "abonar_creditos",
                        lambda u, n, t, r=None: devueltos.append((n, t)) or 100)
    monkeypatch.setattr(srv.jobs, "lanzar_produccion",
                        lambda *a: (_ for _ in ()).throw(RuntimeError("sfn caída")))
    with pytest.raises(RuntimeError):
        asyncio.run(srv.producir("abc123"))
    assert devueltos == [(90, "devolucion")]


def test_producir_sin_backend_no_toca_monedero(tmp_path, monkeypatch):
    from pipeline import project
    from server import app as srv
    monkeypatch.delenv("CREDITOS_BACKEND", raising=False)
    monkeypatch.setenv("JOBS_BACKEND", "aws")
    monkeypatch.setattr(project, "settings", SimpleNamespace(work_dir=tmp_path))
    monkeypatch.setattr(srv, "cargar_proyecto",
                        lambda i: _proyecto_en_revision(tmp_path))
    monkeypatch.setattr(db, "guardar_proyecto", lambda *a: None)
    monkeypatch.setattr(db, "cobrar_creditos",
                        lambda *a, **k: pytest.fail("backend off no cobra"))
    monkeypatch.setattr(srv.jobs, "lanzar_produccion", lambda u, i: "arn:exec")
    asyncio.run(srv.producir("abc123"))


# ---------------------------------------------------------------------------
# claves por-usuario: lista blanca y prefijo (D4)

def test_claves_usuario_lista_blanca():
    from tools.ssm_env import CLAVES_USUARIO, PREFIJO_USUARIOS
    assert CLAVES_USUARIO == ["BLOTATO_API_KEY"]
    assert PREFIJO_USUARIOS.startswith("/media-ivenaccip/")   # "aws*" reservado


def test_cargar_env_usuario_sin_prefijo_es_noop(monkeypatch):
    from worker import env_ssm
    monkeypatch.delenv("SSM_USUARIOS_PREFIX", raising=False)
    assert env_ssm.cargar_env_usuario("piloto") == 0
