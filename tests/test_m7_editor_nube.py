"""M7 — editor de cortes en la nube: cuts.json versionado en Postgres con
control de concurrencia (409), media por CDN, render como job en Fargate vía
la state machine existente, y el chat que dice la verdad (vive en Claude Code
local). Sin red: S3/Postgres/SFN van mockeados."""
import json

import pytest
from fastapi.testclient import TestClient

from pipeline import db, jobs, media_sync
from server import editor


@pytest.fixture
def nube(monkeypatch, tmp_path):
    """Server en modo nube: backend postgres, CDN configurada, sin Cognito
    (dev local = un solo usuario) y el proyecto gen-abc registrado."""
    monkeypatch.delenv("COGNITO_POOL_ID", raising=False)
    monkeypatch.setenv("STATE_BACKEND", "postgres")
    monkeypatch.setenv("CDN_BASE", "https://cdn.example.com")
    monkeypatch.setenv("MEDIA_ROOT", str(tmp_path))
    docs = {"gen-abc": {"flags": {"cuts": True}}}
    monkeypatch.setattr(db, "cargar_proyecto_editor",
                        lambda u, n: docs.get(n))
    from server.app import app
    cliente = TestClient(app)
    cliente.docs = docs
    return cliente


CUTS = {"clips": [{"id": "c1", "file": "pelicula.mp4", "keeps": [], "cuts": []}],
        "clip_order": ["c1"], "styles": {"tight": {}}}
MANIFEST = {"parts": [{"id": "c1", "offset": 0.0, "duration": 10.0}], "total": 10.0}
CANONICO = {"schema_version": "1.0", "words": [{"text": "hola"}], "segments": []}


def _s3_falso(monkeypatch, objetos):
    monkeypatch.setattr(media_sync, "leer_texto",
                        lambda key: objetos.get(key))


# ---------------------------------------------------------------------------
# /api/data — siembra la v1 desde S3 y devuelve la versión

def test_data_siembra_v1_desde_s3(nube, monkeypatch):
    _s3_falso(monkeypatch, {
        "videos/gen-abc/work/analysis/cuts.json": json.dumps(CUTS),
        "videos/gen-abc/work/editor/manifest.json": json.dumps(MANIFEST),
        "videos/gen-abc/work/transcripts/c1.canonical.json": json.dumps(CANONICO),
    })
    guardados = {}
    def guardar(u, p, base, doc):
        guardados["v"] = (base, json.loads(doc))
        return base + 1
    monkeypatch.setattr(db, "guardar_cortes", guardar)
    monkeypatch.setattr(db, "cortes_ultima",
                        lambda u, p: {"version": 1, "doc": CUTS} if guardados else None)
    j = nube.get("/editor/gen-abc/api/data").json()
    assert guardados["v"][0] == 0                      # sembró v1 sobre base 0
    assert j["version"] == 1 and j["cuts"] == CUTS
    assert j["manifest"]["total"] == 10.0
    assert j["words"]["c1"] == [{"text": "hola"}]


def test_data_404_si_el_proyecto_no_es_del_usuario(nube):
    assert nube.get("/editor/gen-otro/api/data").status_code == 404


def test_data_404_sin_cuts_en_s3(nube, monkeypatch):
    _s3_falso(monkeypatch, {})
    monkeypatch.setattr(db, "cortes_ultima", lambda u, p: None)
    r = nube.get("/editor/gen-abc/api/data")
    assert r.status_code == 404 and "cuts.json" in r.json()["detail"]


# ---------------------------------------------------------------------------
# save — versión base obligatoria; base vieja = 409

def test_save_guarda_sobre_la_base_y_devuelve_version(nube, monkeypatch):
    visto = {}
    def guardar(u, p, base, doc):
        visto.update(base=base, doc=json.loads(doc))
        return base + 1
    monkeypatch.setattr(db, "guardar_cortes", guardar)
    r = nube.post("/editor/gen-abc/api/save",
                  json={"cuts": CUTS, "base": 3, "changes": ["x"]})
    assert r.status_code == 200 and r.json()["version"] == 4
    assert visto["base"] == 3 and visto["doc"] == CUTS


def test_save_409_si_otra_pestana_guardo(nube, monkeypatch):
    monkeypatch.setattr(db, "guardar_cortes", lambda u, p, base, doc: None)
    r = nube.post("/editor/gen-abc/api/save", json={"cuts": CUTS, "base": 1})
    assert r.status_code == 409 and "recarga" in r.json()["detail"]


# ---------------------------------------------------------------------------
# media — 302 al CDN (CloudFront sirve el Range del proxy)

def test_media_redirige_al_cdn(nube):
    r = nube.get("/editor/gen-abc/media/proxy.mp4", follow_redirects=False)
    assert r.status_code == 307 or r.status_code == 302
    assert r.headers["location"] == \
        "https://cdn.example.com/videos/gen-abc/work/editor/proxy.mp4"


# ---------------------------------------------------------------------------
# render — job por la state machine; candado por doc con caducidad

def test_render_lanza_el_job_y_fija_corriendo(nube, monkeypatch):
    monkeypatch.setattr(db, "cortes_ultima", lambda u, p: {"version": 1, "doc": CUTS})
    fijado, lanzado = {}, {}
    monkeypatch.setattr(db, "fijar_render_editor",
                        lambda u, n, r: fijado.update(json.loads(r)))
    monkeypatch.setattr(jobs, "lanzar_render",
                        lambda u, n, e: lanzado.update(n=n, e=e) or "arn")
    r = nube.post("/editor/gen-abc/api/render", json={"style": "tight"})
    assert r.status_code == 200 and r.json()["started"]
    assert fijado["estado"] == "corriendo" and fijado["estilo"] == "tight"
    assert lanzado == {"n": "gen-abc", "e": "tight"}


def test_render_400_estilo_desconocido(nube, monkeypatch):
    monkeypatch.setattr(db, "cortes_ultima", lambda u, p: {"version": 1, "doc": CUTS})
    r = nube.post("/editor/gen-abc/api/render", json={"style": "no-existe"})
    assert r.status_code == 400


def test_render_409_si_ya_corre(nube, monkeypatch):
    from datetime import datetime, timezone
    nube.docs["gen-abc"]["render"] = {
        "estado": "corriendo",
        "inicio": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    r = nube.post("/editor/gen-abc/api/render", json={"style": "tight"})
    assert r.status_code == 409
    del nube.docs["gen-abc"]["render"]


def test_render_corriendo_caducado_se_relanza(nube, monkeypatch):
    nube.docs["gen-abc"]["render"] = {"estado": "corriendo",
                                      "inicio": "2026-01-01T00:00:00+00:00"}
    monkeypatch.setattr(db, "cortes_ultima", lambda u, p: {"version": 1, "doc": CUTS})
    monkeypatch.setattr(db, "fijar_render_editor", lambda u, n, r: None)
    monkeypatch.setattr(jobs, "lanzar_render", lambda u, n, e: "arn")
    assert nube.post("/editor/gen-abc/api/render",
                     json={"style": "tight"}).status_code == 200
    del nube.docs["gen-abc"]["render"]


def test_render_status_desde_el_doc(nube):
    """Un render anterior a M22 no trae `key`: el status la devuelve en None y
    el front, que solo pinta el botón de descargar si viene, no se rompe."""
    nube.docs["gen-abc"]["render"] = {
        "estado": "listo", "url": "https://cdn.example.com/x.mp4", "log": ""}
    s = nube.get("/editor/gen-abc/api/render/status").json()
    assert s == {"running": False, "log": "", "ok": True,
                 "url": "https://cdn.example.com/x.mp4", "key": None}
    del nube.docs["gen-abc"]["render"]


def test_render_status_lleva_la_key_para_descargar(nube):
    """Los nuevos sí: es lo que el botón de descargar le pasa a /api/media."""
    nube.docs["gen-abc"]["render"] = {
        "estado": "listo", "log": "", "url": "https://cdn.example.com/x.mp4",
        "key": "videos/gen-abc/output/preview-tight.mp4"}
    s = nube.get("/editor/gen-abc/api/render/status").json()
    assert s["key"] == "videos/gen-abc/output/preview-tight.mp4"
    del nube.docs["gen-abc"]["render"]


def test_render_502_si_no_se_pudo_lanzar(nube, monkeypatch):
    monkeypatch.setattr(db, "cortes_ultima", lambda u, p: {"version": 1, "doc": CUTS})
    estados = []
    monkeypatch.setattr(db, "fijar_render_editor",
                        lambda u, n, r: estados.append(json.loads(r)["estado"]))
    def truena(u, n, e):
        raise RuntimeError("sin SFN")
    monkeypatch.setattr(jobs, "lanzar_render", truena)
    assert nube.post("/editor/gen-abc/api/render",
                     json={"style": "tight"}).status_code == 502
    assert estados == ["corriendo", "error"]   # no queda trabado en corriendo


# ---------------------------------------------------------------------------
# chat — desde M16.4 el chat en nube SÍ está disponible (consejero con la API
# de Claude); el detalle vive en test_m16_chat_nube.py

def test_chat_en_nube_disponible(nube):
    st = nube.get("/editor/gen-abc/api/chat/poll").json()
    assert st["available"] is True and st["error"] is None


# ---------------------------------------------------------------------------
# jobs.lanzar_render — misma SM, comando de render_task

def test_lanzar_render_arma_el_comando(monkeypatch):
    monkeypatch.setenv("PRODUCIR_SM_ARN", "arn:sm")
    visto = {}
    class Sfn:
        def start_execution(self, **kw):
            visto.update(kw)
            return {"executionArn": "arn:exec"}
    monkeypatch.setattr(jobs, "_sfn", lambda: Sfn())
    assert jobs.lanzar_render("u1", "gen-abc", "tight") == "arn:exec"
    entrada = json.loads(visto["input"])
    assert entrada["command"] == \
        ["python", "-m", "worker.render_task", "u1", "gen-abc", "tight"]


# ---------------------------------------------------------------------------
# worker/render_task — baja, pisa cuts con la última versión, sube y reporta

@pytest.fixture
def tarea(monkeypatch, tmp_path):
    monkeypatch.setenv("MEDIA_ROOT", str(tmp_path))
    monkeypatch.setenv("STATE_BACKEND", "postgres")
    monkeypatch.setenv("CDN_BASE", "https://cdn.example.com")
    from worker import render_task
    from pipeline import costes_infra
    registro = {"subidos": [], "render": None, "infra": None}
    monkeypatch.setattr(media_sync, "bajar_prefijo", lambda pre, d: 0)
    monkeypatch.setattr(media_sync, "subir_archivo",
                        lambda local, key: registro["subidos"].append(key))
    monkeypatch.setattr(db, "cortes_ultima",
                        lambda u, p: {"version": 5, "doc": CUTS})
    monkeypatch.setattr(db, "fijar_render_editor",
                        lambda u, n, r: registro.update(render=json.loads(r)))
    monkeypatch.setattr(costes_infra, "registrar",
                        lambda u, p, c, usd: registro.update(infra=(c, usd)))
    return render_task, registro, tmp_path


def test_render_task_ok_sube_y_fija_listo(tarea, monkeypatch):
    render_task, registro, tmp_path = tarea
    import subprocess
    class Ok:
        returncode, stdout, stderr = 0, "wrote preview\n", ""
    monkeypatch.setattr(subprocess, "run", lambda *a, **k: Ok())
    assert render_task.main("u1", "gen-abc", "tight") == 0
    # la última versión de Postgres pisó el cuts.json bajado de S3
    cuts = tmp_path / "videos" / "gen-abc" / "work" / "analysis" / "cuts.json"
    assert json.loads(cuts.read_text(encoding="utf-8")) == CUTS
    assert "videos/gen-abc/output/preview-tight.mp4" in registro["subidos"]
    assert registro["render"]["estado"] == "listo"
    assert registro["render"]["url"] == \
        "https://cdn.example.com/videos/gen-abc/output/preview-tight.mp4"
    # el subprocess mockeado tarda ~0 s → el costo redondea a 0; lo que importa
    # es que la línea de infra se registró con el concepto correcto
    assert registro["infra"][0] == "infra-render" and registro["infra"][1] >= 0


def test_render_task_fallo_fija_error_y_sale_1(tarea, monkeypatch):
    render_task, registro, _ = tarea
    import subprocess
    class Mal:
        returncode, stdout, stderr = 1, "", "ffmpeg: boom"
    monkeypatch.setattr(subprocess, "run", lambda *a, **k: Mal())
    assert render_task.main("u1", "gen-abc", "tight") == 1
    assert registro["render"]["estado"] == "error"
    assert "boom" in registro["render"]["log"]
    assert registro["infra"][0] == "infra-render"   # la infra se gastó igual


# ---------------------------------------------------------------------------
# db.guardar_cortes — contrato SQL del candado de concurrencia

def test_guardar_cortes_devuelve_version_o_none(monkeypatch):
    monkeypatch.setattr(db, "ejecutar", lambda sql, p=None: [{"version": p["v"]}])
    assert db.guardar_cortes("u", "p", 3, "{}") == 4
    monkeypatch.setattr(db, "ejecutar", lambda sql, p=None: [])
    assert db.guardar_cortes("u", "p", 3, "{}") is None


# ---------------------------------------------------------------------------
# e1 — con cuts.json en S3 el editor ya abre

def test_listado_editor_listo_con_flags_cuts(monkeypatch):
    monkeypatch.delenv("COGNITO_POOL_ID", raising=False)
    monkeypatch.setenv("STATE_BACKEND", "postgres")
    monkeypatch.setattr(db, "listar_proyectos_editor", lambda u: [
        {"nombre": "gen-abc", "doc": {"flags": {"cuts": True, "generado": True}}},
        {"nombre": "gen-sin", "doc": {"flags": {"cuts": False}}},
    ])
    from server.app import app
    filas = {p["nombre"]: p for p in TestClient(app).get("/api/edicion/proyectos").json()}
    assert filas["gen-abc"]["editor_listo"] is True
    assert filas["gen-sin"]["editor_listo"] is False
