"""M12 — hub, slots de proyectos activos y archivado. Sin red ni Postgres:
el backend se finge con monkeypatch y los proyectos locales viven en tmp_path."""
import json
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from pipeline import db, project
from pipeline.project import Proyecto


def _p(id_, estado="revision", archivado=False):
    return Proyecto(id=id_, creado="2026-09-05T00:00:00", brief=f"brief {id_}",
                    estado=estado, archivado=archivado)


@pytest.fixture
def cliente():
    from server.app import app
    return TestClient(app)


@pytest.fixture
def srv():
    from server import app as srv
    return srv


# ---------------------------------------------------------------------------
# /api/slots y el candado en crear

def test_slots_dev_local_ilimitado(cliente, srv, monkeypatch):
    """El candado vive solo en la nube: dev local (json) = ilimitado."""
    monkeypatch.setattr(srv, "listar_proyectos",
                        lambda: [_p("a"), _p("b", archivado=True)])
    d = cliente.get("/api/slots").json()
    assert d == {"slots": None, "activos": 1}


def test_slots_nube_reporta_tope(cliente, srv, monkeypatch):
    monkeypatch.setattr(db, "backend", lambda: "postgres")
    monkeypatch.setattr(db, "slots_usuario", lambda u: 6)
    monkeypatch.setattr(srv, "listar_proyectos", lambda: [_p("a")])
    assert cliente.get("/api/slots").json() == {"slots": 6, "activos": 1}


def test_crear_sin_slots_libres_409(cliente, srv, monkeypatch):
    monkeypatch.setattr(db, "backend", lambda: "postgres")
    monkeypatch.setattr(db, "slots_usuario", lambda u: 2)
    monkeypatch.setattr(srv, "listar_proyectos", lambda: [_p("a"), _p("b")])
    r = cliente.post("/api/proyectos", data={"brief": "una idea"})
    assert r.status_code == 409
    d = r.json()["detail"]
    assert d["slots"] == 2 and "Archiva" in d["aviso"]


def test_archivados_no_cuentan_para_el_gate(cliente, srv, monkeypatch):
    """Con 1 slot y 1 proyecto ARCHIVADO, crear pasa el gate (el 418 centinela
    prueba que llegó hasta nuevo_proyecto)."""
    monkeypatch.setattr(db, "backend", lambda: "postgres")
    monkeypatch.setattr(db, "slots_usuario", lambda u: 1)
    monkeypatch.setattr(srv, "listar_proyectos", lambda: [_p("a", archivado=True)])
    def _boom(*a, **k):
        raise HTTPException(418, "gate superado")
    monkeypatch.setattr(srv, "nuevo_proyecto", _boom)
    r = cliente.post("/api/proyectos", data={"brief": "una idea"})
    assert r.status_code == 418


def test_slots_ilimitado_no_gatea(cliente, srv, monkeypatch):
    monkeypatch.setattr(db, "backend", lambda: "postgres")
    monkeypatch.setattr(db, "slots_usuario", lambda u: None)   # plan anual
    monkeypatch.setattr(srv, "listar_proyectos", lambda: [_p(str(i)) for i in range(10)])
    def _boom(*a, **k):
        raise HTTPException(418, "gate superado")
    monkeypatch.setattr(srv, "nuevo_proyecto", _boom)
    assert cliente.post("/api/proyectos", data={"brief": "x"}).status_code == 418


# ---------------------------------------------------------------------------
# archivar / desarchivar (backend json local: el flujo entero contra tmp_path)

def test_archivar_persiste_y_listado_lo_marca(cliente, monkeypatch, tmp_path):
    monkeypatch.setattr(project, "settings", SimpleNamespace(work_dir=tmp_path))
    _p("m12a").guardar()
    r = cliente.post("/api/proyectos/m12a/archivar")
    assert r.status_code == 200 and r.json()["archivado"] is True
    en_disco = json.loads((tmp_path / "m12a" / "proyecto.json").read_text(encoding="utf-8"))
    assert en_disco["archivado"] is True
    fila = cliente.get("/api/proyectos").json()[0]
    assert fila["id"] == "m12a" and fila["archivado"] is True


def test_archivar_con_tarea_en_curso_409(cliente, monkeypatch, tmp_path):
    monkeypatch.setattr(project, "settings", SimpleNamespace(work_dir=tmp_path))
    _p("m12b", estado="produciendo").guardar()
    r = cliente.post("/api/proyectos/m12b/archivar")
    assert r.status_code == 409 and "en curso" in r.json()["detail"]


def test_desarchivar_restaura(cliente, monkeypatch, tmp_path):
    monkeypatch.setattr(project, "settings", SimpleNamespace(work_dir=tmp_path))
    _p("m12c", archivado=True).guardar()
    r = cliente.post("/api/proyectos/m12c/desarchivar")
    assert r.status_code == 200 and r.json()["archivado"] is False


def test_desarchivar_sin_slot_libre_409(cliente, srv, monkeypatch):
    monkeypatch.setattr(db, "backend", lambda: "postgres")
    monkeypatch.setattr(db, "slots_usuario", lambda u: 1)
    monkeypatch.setattr(srv, "listar_proyectos", lambda: [_p("activo")])
    monkeypatch.setattr(srv, "_proyecto", lambda id_: _p(id_, archivado=True))
    r = cliente.post("/api/proyectos/frio/desarchivar")
    assert r.status_code == 409 and "slots libres" in r.json()["detail"]


# ---------------------------------------------------------------------------
# db: columna y helpers de slots

def test_esquema_lleva_columna_slots():
    assert any("ADD COLUMN IF NOT EXISTS slots" in s for s in db.ESQUEMA)


def test_slots_usuario_lee_y_defaultea(monkeypatch):
    monkeypatch.setattr(db, "ejecutar", lambda s, p=None: [{"slots": 9}])
    assert db.slots_usuario("u1") == 9
    monkeypatch.setattr(db, "ejecutar", lambda s, p=None: [{"slots": None}])
    assert db.slots_usuario("u1") is None          # anual = ilimitado
    monkeypatch.setattr(db, "ejecutar", lambda s, p=None: [])
    assert db.slots_usuario("nuevo") == 6          # sin fila aún = default


def test_fijar_slots_acepta_none(monkeypatch):
    llamadas = []
    monkeypatch.setattr(db, "ejecutar", lambda s, p=None: llamadas.append((s, p)) or [])
    db.fijar_slots("u1", None)
    assert "UPDATE usuarios SET slots" in llamadas[1][0]
    assert llamadas[1][1]["s"] is None


# ---------------------------------------------------------------------------
# «Información extra» del personaje (mock del formulario, 2026-09-07)

def test_personaje_extra_viaja_al_proyecto(cliente, srv, monkeypatch, tmp_path):
    monkeypatch.setattr(project, "settings", SimpleNamespace(work_dir=tmp_path))
    monkeypatch.setattr(srv, "_lanzar", lambda p, coro: coro.close())
    r = cliente.post("/api/proyectos", data={
        "brief": "una idea", "personaje_extra": "  lleva sombrero  "})
    assert r.status_code == 200
    assert r.json()["personaje_extra"] == "lleva sombrero"


def test_con_extra_anexa_a_la_descripcion():
    from pipeline import flow
    p = _p("x1"); p.personaje_extra = "lleva sombrero"
    d = SimpleNamespace(descripcion="un pato")
    assert flow._con_extra(p, d).descripcion == "un pato. lleva sombrero"
    assert flow._con_extra(p, None) is None                    # sin referencia
    d2 = SimpleNamespace(descripcion="")
    assert flow._con_extra(p, d2).descripcion == "lleva sombrero"
    d3 = SimpleNamespace(descripcion="un pato")
    assert flow._con_extra(_p("x2"), d3).descripcion == "un pato"   # sin extra


def test_retry_db_despertando(monkeypatch):
    """DatabaseUnavailableException (mensaje vacío) también se reintenta."""
    import time as _t
    intentos = []

    class _Falla(Exception):
        pass

    _Falla.__name__ = "DatabaseUnavailableException"

    class _Cli:
        def execute_statement(self, **kw):
            intentos.append(1)
            if len(intentos) < 3:
                raise _Falla("")
            return {"formattedRecords": "[]"}

    monkeypatch.setattr(db, "_cliente", lambda: _Cli())
    monkeypatch.setattr(db, "_cfg", lambda: {"resourceArn": "x", "secretArn": "y", "database": "z"})
    monkeypatch.setattr(_t, "sleep", lambda s: None)
    assert db.ejecutar("SELECT 1") == []
    assert len(intentos) == 3


def test_listado_trae_miniatura(cliente, monkeypatch, tmp_path):
    """La card del hub muestra la opción de personaje ELEGIDA (o la primera)."""
    from pipeline.project import OpcionPersonaje
    monkeypatch.setattr(project, "settings", SimpleNamespace(work_dir=tmp_path))
    p = _p("m12m")
    p.personaje.opciones = [
        OpcionPersonaje(url="u", path=r"videos\x\personaje\opcion_0.jpg"),
        OpcionPersonaje(url="u", path="videos/x/personaje/opcion_1.jpg")]
    p.personaje.elegida = 1
    p.guardar()
    fila = cliente.get("/api/proyectos").json()[0]
    assert fila["miniatura"] == "personaje/opcion_1.jpg"
    p.personaje.elegida = None
    p.guardar()
    assert cliente.get("/api/proyectos").json()[0]["miniatura"] == "personaje/opcion_0.jpg"


# ---------------------------------------------------------------------------
# Refinando detalles (2026-09-07): portada, reabrir y crear imágenes

def test_miniatura_de_pelicula_lista_es_la_portada(cliente, monkeypatch, tmp_path):
    monkeypatch.setattr(project, "settings", SimpleNamespace(work_dir=tmp_path))
    _p("m12p", estado="listo").guardar()
    assert cliente.get("/api/proyectos").json()[0]["miniatura"] == "portada.jpg"


def test_reabrir_vuelve_a_revision(cliente, monkeypatch, tmp_path):
    monkeypatch.setattr(project, "settings", SimpleNamespace(work_dir=tmp_path))
    _p("m12r", estado="listo").guardar()
    r = cliente.post("/api/proyectos/m12r/reabrir")
    assert r.status_code == 200 and r.json()["estado"] == "revision"
    # ya en revisión, reabrir de nuevo no aplica
    assert cliente.post("/api/proyectos/m12r/reabrir").status_code == 409


def test_crear_imagen_genera_y_sirve(cliente, srv, monkeypatch, tmp_path):
    from pipeline import media_fal

    async def fake_nano(prompt, destino, **kw):
        assert "un dragón" in prompt and "No text" in prompt
        destino.write_bytes(b"jpg-falso")
        return "https://fal/x.jpg"

    monkeypatch.setattr(media_fal, "imagen_nano", fake_nano)
    monkeypatch.setattr(srv, "_dir_imagenes", lambda: tmp_path / "_imagenes")
    r = cliente.post("/api/imagenes", json={"prompt": "un dragón", "estilo": "cinematic"})
    assert r.status_code == 200
    url = r.json()["url"]
    assert url.startswith("/api/imagenes/")
    r2 = cliente.get(url)
    assert r2.status_code == 200 and r2.content == b"jpg-falso"


def test_crear_imagen_valida_y_devuelve_en_fallo(cliente, srv, monkeypatch, tmp_path):
    from pipeline import creditos, media_fal
    assert cliente.post("/api/imagenes", json={"prompt": "  "}).status_code == 422

    async def nano_roto(prompt, destino, **kw):
        raise RuntimeError("fal caído")

    movimientos = []
    monkeypatch.setattr(media_fal, "imagen_nano", nano_roto)
    monkeypatch.setattr(srv, "_dir_imagenes", lambda: tmp_path / "_imagenes")
    monkeypatch.setattr(creditos, "activo", lambda: True)
    monkeypatch.setattr(creditos, "costo_imagen", lambda: 2)
    monkeypatch.setattr(creditos, "cobrar", lambda c, ref: movimientos.append(("cobro", c, ref)))
    monkeypatch.setattr(creditos, "devolver", lambda c, ref: movimientos.append(("devolucion", c, ref)))
    r = cliente.post("/api/imagenes", json={"prompt": "un dragón"})
    assert r.status_code == 502
    assert movimientos == [("cobro", 2, "imagen:estudio"), ("devolucion", 2, "imagen:estudio")]
