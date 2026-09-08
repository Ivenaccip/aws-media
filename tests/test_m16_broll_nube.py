"""M16.3 — b-roll IA y regeneración de la pista 2 en la nube: propuestas con
transcript de S3 (cobra créditos), candidatos de imagen en la Lambda, Veo y
activación como job en Fargate (doc.overlay_job) con devolución en fallo.
Sin red: S3/Postgres/SFN/fal van mockeados."""
import json

import pytest
from fastapi.testclient import TestClient

from pipeline import creditos, db, jobs, media_sync
from server import broll_api, overlays_api


OVERLAYS = {"version": 1, "estilo_prompt": "flat", "pista_unica": True,
            "overlays": [{"id": "1", "t_in": 0.0, "t_out": 7.0,
                          "narracion": "uno", "version_activa": 1,
                          "versiones": [{"n": 1, "video": "overlays/1/v1.mp4",
                                         "imagen_base": None}]}]}
ET = {"words": [{"text": "hola.", "start": 0, "end": 500}]}


@pytest.fixture
def nube(monkeypatch, tmp_path):
    monkeypatch.delenv("COGNITO_POOL_ID", raising=False)
    monkeypatch.setenv("STATE_BACKEND", "postgres")
    monkeypatch.setenv("CDN_BASE", "https://cdn.example.com")
    monkeypatch.setenv("MEDIA_ROOT", str(tmp_path))
    docs = {"gen-abc": {"flags": {"cuts": True}}}
    monkeypatch.setattr(db, "cargar_proyecto_editor", lambda u, n: docs.get(n))
    from server.app import app
    cliente = TestClient(app)
    cliente.docs = docs
    return cliente


@pytest.fixture
def monedero(monkeypatch):
    mov = {"cobrado": 0, "devuelto": 0}
    monkeypatch.setattr(creditos, "activo", lambda: True)
    monkeypatch.setattr(creditos, "cobrar",
                        lambda n, ref, u=None: mov.update(cobrado=mov["cobrado"] + n))
    monkeypatch.setattr(creditos, "devolver",
                        lambda n, ref, u=None: mov.update(devuelto=mov["devuelto"] + n))
    return mov


def _s3(monkeypatch, extra=None):
    objetos = {"videos/gen-abc/work/overlays.json": json.dumps(OVERLAYS),
               "videos/gen-abc/work/edited-transcript.json": json.dumps(ET),
               "videos/gen-abc/work/editor/manifest.json": json.dumps({"total": 30.0}),
               **(extra or {})}
    escritos = {}
    monkeypatch.setattr(media_sync, "leer_texto", lambda key: objetos.get(key))
    monkeypatch.setattr(media_sync, "escribir_texto",
                        lambda key, texto, tipo="application/json": escritos.update({key: texto}))
    return escritos


# ---------------------------------------------------------------------------
# tarifas M16.3

def test_tarifas_regeneracion():
    assert creditos.costo_broll_sugerencias() == 2
    assert creditos.costo_regen_imagenes(2) == 4
    assert creditos.costo_regen_video(8) == 24    # por_segundo (3) × Veo 8 s


# ---------------------------------------------------------------------------
# b-roll sugerir — S3 + cobro, devolución si el LLM falla

def test_broll_sugerir_nube_cobra_y_guarda(nube, monkeypatch, monedero):
    escritos = _s3(monkeypatch)

    async def llm(*a, **k):
        return {"propuestas": [{"t": 10.0, "dur_s": 5, "familia": "grafico",
                                "titulo": "mapa", "prompt_imagen": "mapa peru"}]}
    monkeypatch.setattr(broll_api, "chat_json", llm)
    r = nube.post("/editor/gen-abc/api/broll/sugerir")
    assert r.status_code == 200
    j = r.json()
    assert j["creditos"] == 2 and monedero["cobrado"] == 2
    assert j["propuestas"][0]["titulo"] == "mapa"
    guardado = json.loads(escritos["videos/gen-abc/work/overlays.json"])
    assert guardado["propuestas"][0]["t"] == 10.0
    # no pisó los overlays existentes
    assert guardado["overlays"][0]["id"] == "1"


def test_broll_sugerir_nube_devuelve_si_llm_falla(nube, monkeypatch, monedero):
    _s3(monkeypatch)

    async def truena(*a, **k):
        raise RuntimeError("LLM caído")
    monkeypatch.setattr(broll_api, "chat_json", truena)
    with pytest.raises(RuntimeError):
        nube.post("/editor/gen-abc/api/broll/sugerir")
    assert monedero["cobrado"] == 2 and monedero["devuelto"] == 2


def test_broll_sugerir_nube_409_sin_transcript(nube, monkeypatch, monedero):
    _s3(monkeypatch, {"videos/gen-abc/work/edited-transcript.json": None})
    monkeypatch.setattr(media_sync, "leer_texto",
                        lambda key: json.dumps(OVERLAYS) if key.endswith("overlays.json") else None)
    r = nube.post("/editor/gen-abc/api/broll/sugerir")
    assert r.status_code == 409 and monedero["cobrado"] == 0


# ---------------------------------------------------------------------------
# precios — en nube incluye la tarifa en créditos

def test_precios_nube_incluye_creditos(nube, monkeypatch):
    _s3(monkeypatch)
    j = nube.get("/editor/gen-abc/api/overlays/1/precios").json()
    assert j["veo_segundos"] == 8                 # clip de 7 s → Veo de 8
    assert j["creditos"] == {"imagen": 4, "video": 24}


def test_overlays_nube_trae_tarifa_broll(nube, monkeypatch):
    _s3(monkeypatch)
    assert nube.get("/editor/gen-abc/api/overlays").json()["tarifa_broll"] == 2


# ---------------------------------------------------------------------------
# imagen — candidatos en la Lambda: cobra, baja referencia, sube, registra gasto

def test_imagen_nube_genera_y_sube(nube, monkeypatch, monedero):
    escritos = _s3(monkeypatch)
    subidos = []
    monkeypatch.setattr(media_sync, "bajar_archivo",
                        lambda key, destino: destino.write_bytes(b"clip") or True)
    monkeypatch.setattr(media_sync, "subir_archivo",
                        lambda local, key: subidos.append(key))
    monkeypatch.setattr(overlays_api.subprocess, "run",
                        lambda cmd, **k: [c for c in cmd if str(c).endswith("ref_frame.jpg")]
                        and __import__("pathlib").Path(cmd[-1]).write_bytes(b"jpg"))

    async def nano(prompt, destino, referencia=None, meta=None):
        destino.write_bytes(b"img")
        return "url"
    monkeypatch.setattr(overlays_api.media_fal, "imagen_nano", nano)
    r = nube.post("/editor/gen-abc/api/overlays/1/imagen",
                  json={"confirmar": True, "prompt": "un mapa"})
    assert r.status_code == 200
    j = r.json()
    assert monedero["cobrado"] == 4 and j["creditos"] == 4
    assert len(j["candidatos"]) == 2
    assert all(k.startswith("videos/gen-abc/work/overlays/1/candidatos/") for k in subidos)
    gastos = json.loads(escritos["videos/gen-abc/work/overlays.json"])["gastos"]
    assert gastos[0]["tipo"] == "imagenes"


def test_imagen_nube_devuelve_si_vendor_falla(nube, monkeypatch, monedero):
    _s3(monkeypatch)
    monkeypatch.setattr(media_sync, "bajar_archivo",
                        lambda key, destino: destino.write_bytes(b"clip") or True)
    monkeypatch.setattr(overlays_api.subprocess, "run",
                        lambda cmd, **k: __import__("pathlib").Path(cmd[-1]).write_bytes(b"jpg"))

    async def truena(*a, **k):
        raise RuntimeError("fal caído")
    monkeypatch.setattr(overlays_api.media_fal, "imagen_nano", truena)
    r = nube.post("/editor/gen-abc/api/overlays/1/imagen",
                  json={"confirmar": True, "prompt": "x"})
    assert r.status_code == 502
    assert monedero["cobrado"] == 4 and monedero["devuelto"] == 4


def test_imagen_nube_428_sin_confirmar(nube, monkeypatch, monedero):
    _s3(monkeypatch)
    r = nube.post("/editor/gen-abc/api/overlays/1/imagen",
                  json={"prompt": "x"})
    assert r.status_code == 428 and monedero["cobrado"] == 0


# ---------------------------------------------------------------------------
# video — job en Fargate: cobra, fija overlay_job y lanza; fallo devuelve

def test_video_nube_cobra_y_lanza_job(nube, monkeypatch, monedero):
    _s3(monkeypatch)
    fijado, lanzado = {}, {}
    monkeypatch.setattr(db, "fijar_overlay_job_editor",
                        lambda u, n, s: fijado.update(json.loads(s)))
    monkeypatch.setattr(jobs, "lanzar_overlay", lambda u, n: lanzado.update(n=n) or "arn")
    r = nube.post("/editor/gen-abc/api/overlays/1/video",
                  json={"confirmar": True, "imagen": "overlays/1/candidatos/a.jpg"})
    assert r.status_code == 200 and r.json() == {"started": True, "creditos": 24}
    assert monedero["cobrado"] == 24
    assert fijado["accion"] == "generar" and fijado["estado"] == "corriendo"
    assert fijado["imagen"] == "overlays/1/candidatos/a.jpg" and lanzado == {"n": "gen-abc"}


def test_video_nube_409_devuelve_si_ya_corre(nube, monkeypatch, monedero):
    from datetime import datetime, timezone
    _s3(monkeypatch)
    nube.docs["gen-abc"]["overlay_job"] = {
        "estado": "corriendo",
        "inicio": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    r = nube.post("/editor/gen-abc/api/overlays/1/video",
                  json={"confirmar": True, "imagen": "overlays/1/candidatos/a.jpg"})
    assert r.status_code == 409
    assert monedero["cobrado"] == 24 and monedero["devuelto"] == 24
    del nube.docs["gen-abc"]["overlay_job"]


def test_video_nube_502_devuelve_si_no_lanza(nube, monkeypatch, monedero):
    _s3(monkeypatch)
    estados = []
    monkeypatch.setattr(db, "fijar_overlay_job_editor",
                        lambda u, n, s: estados.append(json.loads(s)["estado"]))

    def truena(u, n):
        raise RuntimeError("sin SFN")
    monkeypatch.setattr(jobs, "lanzar_overlay", truena)
    r = nube.post("/editor/gen-abc/api/overlays/1/video",
                  json={"confirmar": True, "imagen": "overlays/1/candidatos/a.jpg"})
    assert r.status_code == 502
    assert monedero["devuelto"] == 24 and estados == ["corriendo", "error"]


# ---------------------------------------------------------------------------
# activar — job de 0 créditos; versión inexistente = 404

def test_activar_nube_lanza_job_gratis(nube, monkeypatch, monedero):
    _s3(monkeypatch)
    fijado = {}
    monkeypatch.setattr(db, "fijar_overlay_job_editor",
                        lambda u, n, s: fijado.update(json.loads(s)))
    monkeypatch.setattr(jobs, "lanzar_overlay", lambda u, n: "arn")
    r = nube.post("/editor/gen-abc/api/overlays/1/activar", json={"n": 1})
    assert r.status_code == 200 and r.json()["creditos"] == 0
    assert fijado["accion"] == "activar" and fijado["n"] == 1
    assert monedero["cobrado"] == 0


def test_activar_nube_404_version_inexistente(nube, monkeypatch):
    _s3(monkeypatch)
    assert nube.post("/editor/gen-abc/api/overlays/1/activar",
                     json={"n": 9}).status_code == 404


def test_overlay_job_poll(nube, monkeypatch):
    nube.docs["gen-abc"]["overlay_job"] = {"estado": "listo", "version": 2, "overlay": "1"}
    j = nube.get("/editor/gen-abc/api/overlays/job").json()
    assert j == {"running": False, "ok": True, "log": "", "version": 2, "overlay": "1"}
    del nube.docs["gen-abc"]["overlay_job"]


# ---------------------------------------------------------------------------
# jobs.lanzar_overlay — misma SM, comando de overlay_task

def test_lanzar_overlay_arma_el_comando(monkeypatch):
    monkeypatch.setenv("PRODUCIR_SM_ARN", "arn:sm")
    visto = {}

    class Sfn:
        def start_execution(self, **kw):
            visto.update(kw)
            return {"executionArn": "arn:exec"}
    monkeypatch.setattr(jobs, "_sfn", lambda: Sfn())
    assert jobs.lanzar_overlay("u1", "gen-abc") == "arn:exec"
    assert json.loads(visto["input"])["command"] == \
        ["python", "-m", "worker.overlay_task", "u1", "gen-abc"]


# ---------------------------------------------------------------------------
# worker/overlay_task — activar ok y error que devuelve créditos

@pytest.fixture
def tarea(monkeypatch, tmp_path):
    monkeypatch.setenv("MEDIA_ROOT", str(tmp_path))
    monkeypatch.setenv("STATE_BACKEND", "postgres")
    monkeypatch.setenv("DEFAULT_USER_ID", "u1")   # main() lo asigna directo
    from pipeline import costes_infra, overlays
    from worker import overlay_task
    registro = {"job": None, "infra": None, "devuelto": 0}
    monkeypatch.setattr(media_sync, "bajar_prefijo", lambda pre, d: 0)
    monkeypatch.setattr(media_sync, "subir_dir", lambda d, pre: 3)
    monkeypatch.setattr(db, "fijar_overlay_job_editor",
                        lambda u, n, s: registro.update(job=json.loads(s)))
    monkeypatch.setattr(costes_infra, "registrar",
                        lambda u, p, c, usd: registro.update(infra=(c, usd)))
    monkeypatch.setattr(creditos, "activo", lambda: True)
    monkeypatch.setattr(creditos, "devolver",
                        lambda n, ref, u=None: registro.update(devuelto=registro["devuelto"] + n))
    monkeypatch.setattr(overlays, "rearmar_pelicula", lambda p: 14.0)
    proj = tmp_path / "videos" / "gen-abc" / "work"
    proj.mkdir(parents=True)
    (proj / "overlays.json").write_text(json.dumps(OVERLAYS), encoding="utf-8")
    return overlay_task, registro


def test_overlay_task_activar_ok(tarea, monkeypatch):
    overlay_task, registro = tarea
    monkeypatch.setattr(db, "cargar_proyecto_editor", lambda u, n: {
        "overlay_job": {"estado": "corriendo", "accion": "activar", "overlay": "1", "n": 1}})
    assert overlay_task.main("u1", "gen-abc") == 0
    assert registro["job"]["estado"] == "listo"
    assert registro["job"]["duracion_pelicula"] == 14.0
    assert registro["infra"][0] == "infra-overlay"


def test_overlay_task_error_devuelve_creditos(tarea, monkeypatch):
    overlay_task, registro = tarea
    monkeypatch.setattr(db, "cargar_proyecto_editor", lambda u, n: {
        "overlay_job": {"estado": "corriendo", "accion": "generar", "overlay": "1",
                        "imagen": "no-existe.jpg", "creditos": 24}})
    assert overlay_task.main("u1", "gen-abc") == 1
    assert registro["job"]["estado"] == "error"
    assert registro["devuelto"] == 24
    assert registro["infra"][0] == "infra-overlay"   # la infra se gastó igual
