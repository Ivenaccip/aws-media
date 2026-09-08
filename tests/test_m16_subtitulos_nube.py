"""M16.1 — subtítulos del editor en la nube: la muestra (1 frame) corre en la
Lambda bajando lo mínimo de S3; el quemado va a Fargate por la state machine
con estado en proyectos_editor.doc.subtitulos. Sin red: S3/Postgres/SFN/ffmpeg
van mockeados."""
import json

import pytest
from fastapi.testclient import TestClient

from pipeline import db, jobs, media_sync
from server import overlays_api


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


SRT = "1\n00:00:01,000 --> 00:00:02,500\nhola mundo\n\n2\n00:00:03,000 --> 00:00:04,000\nadiós\n"


# ---------------------------------------------------------------------------
# muestra — baja lo mínimo, corre make_subs --frame y sube el resultado

def test_muestra_nube_baja_corre_y_sube(nube, monkeypatch):
    bajados, subidos = [], []

    def bajar(key, destino):
        bajados.append(key)
        destino.parent.mkdir(parents=True, exist_ok=True)
        destino.write_bytes(b"x")
        return True

    monkeypatch.setattr(media_sync, "bajar_archivo", bajar)
    monkeypatch.setattr(media_sync, "subir_archivo",
                        lambda local, key: subidos.append(key))

    def run_falso(cmd, **kw):
        base_dir = None
        for c in cmd:
            if c.endswith("gen-abc"):
                base_dir = c
        from pathlib import Path
        subs = Path(base_dir) / "work" / "subs"
        subs.mkdir(parents=True, exist_ok=True)
        (subs / "muestra-10.0s.png").write_bytes(b"png")
        (subs / "subs.srt").write_text(SRT, encoding="utf-8")

        class Ok:
            returncode, stdout, stderr = 0, "frame de muestra\n", ""
        return Ok()

    monkeypatch.setattr(overlays_api.subprocess, "run", run_falso)
    r = nube.post("/editor/gen-abc/api/subtitulos/muestra", json={"frame": 10.0})
    assert r.status_code == 200 and r.json()["muestra"] == "subs/muestra-10.0s.png"
    assert "videos/gen-abc/pelicula.mp4" in bajados
    assert "videos/gen-abc/work/edited-transcript.json" in bajados
    assert "videos/gen-abc/work/subs/muestra-10.0s.png" in subidos
    assert "videos/gen-abc/work/subs/subs.srt" in subidos


def test_muestra_nube_404_sin_artefactos(nube, monkeypatch):
    monkeypatch.setattr(media_sync, "bajar_archivo", lambda key, destino: False)
    r = nube.post("/editor/gen-abc/api/subtitulos/muestra", json={"frame": 10.0})
    assert r.status_code == 404 and "puente" in r.json()["detail"]


# ---------------------------------------------------------------------------
# archivo — en nube redirige al CDN (la UI pide la muestra por aquí)

def test_archivo_nube_redirige_al_cdn(nube):
    r = nube.get("/editor/gen-abc/archivo/subs/muestra-10.0s.png",
                 follow_redirects=False)
    assert r.status_code in (302, 307)
    assert r.headers["location"] == \
        "https://cdn.example.com/videos/gen-abc/work/subs/muestra-10.0s.png"


def test_archivo_nube_404_extension_rara(nube):
    assert nube.get("/editor/gen-abc/archivo/subs/x.sh",
                    follow_redirects=False).status_code == 404


# ---------------------------------------------------------------------------
# quemar — job por la state machine; candado por doc con caducidad

def test_quemar_lanza_el_job_y_fija_corriendo(nube, monkeypatch):
    fijado, lanzado = {}, {}
    monkeypatch.setattr(db, "fijar_subtitulos_editor",
                        lambda u, n, s: fijado.update(json.loads(s)))
    monkeypatch.setattr(jobs, "lanzar_subtitulos",
                        lambda u, n: lanzado.update(n=n) or "arn")
    r = nube.post("/editor/gen-abc/api/subtitulos/quemar")
    assert r.status_code == 200 and r.json()["started"]
    assert fijado["estado"] == "corriendo" and lanzado == {"n": "gen-abc"}


def test_quemar_409_si_ya_corre(nube):
    from datetime import datetime, timezone
    nube.docs["gen-abc"]["subtitulos"] = {
        "estado": "corriendo",
        "inicio": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    assert nube.post("/editor/gen-abc/api/subtitulos/quemar").status_code == 409
    del nube.docs["gen-abc"]["subtitulos"]


def test_quemar_502_si_no_se_pudo_lanzar(nube, monkeypatch):
    estados = []
    monkeypatch.setattr(db, "fijar_subtitulos_editor",
                        lambda u, n, s: estados.append(json.loads(s)["estado"]))

    def truena(u, n):
        raise RuntimeError("sin SFN")
    monkeypatch.setattr(jobs, "lanzar_subtitulos", truena)
    assert nube.post("/editor/gen-abc/api/subtitulos/quemar").status_code == 502
    assert estados == ["corriendo", "error"]   # no queda trabado en corriendo


# ---------------------------------------------------------------------------
# estado — desde el doc, con los segmentos del .srt de S3

def test_estado_nube_listo_con_segmentos(nube, monkeypatch):
    nube.docs["gen-abc"]["subtitulos"] = {
        "estado": "listo",
        "url": "https://cdn.example.com/videos/gen-abc/pelicula-subtitulado.mp4"}
    monkeypatch.setattr(media_sync, "leer_texto",
                        lambda key: SRT if key.endswith("subs.srt") else None)
    s = nube.get("/editor/gen-abc/api/subtitulos/estado").json()
    assert s["running"] is False and s["ok"] is True
    assert s["url"].endswith("pelicula-subtitulado.mp4")
    assert [seg["text"] for seg in s["segmentos"]] == ["hola mundo", "adiós"]
    assert s["segmentos"][0] == {"start": 1.0, "end": 2.5, "text": "hola mundo"}
    del nube.docs["gen-abc"]["subtitulos"]


def test_estado_nube_sin_nada(nube, monkeypatch):
    monkeypatch.setattr(media_sync, "leer_texto", lambda key: None)
    s = nube.get("/editor/gen-abc/api/subtitulos/estado").json()
    assert s == {"running": False, "log": "", "ok": None, "url": None,
                 "segmentos": []}


# ---------------------------------------------------------------------------
# jobs.lanzar_subtitulos — misma SM, comando de subtitulos_task

def test_lanzar_subtitulos_arma_el_comando(monkeypatch):
    monkeypatch.setenv("PRODUCIR_SM_ARN", "arn:sm")
    visto = {}

    class Sfn:
        def start_execution(self, **kw):
            visto.update(kw)
            return {"executionArn": "arn:exec"}
    monkeypatch.setattr(jobs, "_sfn", lambda: Sfn())
    assert jobs.lanzar_subtitulos("u1", "gen-abc") == "arn:exec"
    entrada = json.loads(visto["input"])
    assert entrada["command"] == \
        ["python", "-m", "worker.subtitulos_task", "u1", "gen-abc"]


# ---------------------------------------------------------------------------
# worker/subtitulos_task — baja, quema, sube y reporta

@pytest.fixture
def tarea(monkeypatch, tmp_path):
    monkeypatch.setenv("MEDIA_ROOT", str(tmp_path))
    monkeypatch.setenv("STATE_BACKEND", "postgres")
    monkeypatch.setenv("CDN_BASE", "https://cdn.example.com")
    # main() asigna os.environ["DEFAULT_USER_ID"] directo — registrado aquí para
    # que monkeypatch lo revierta y no contamine a los tests que corren después
    monkeypatch.setenv("DEFAULT_USER_ID", "u1")
    from pipeline import costes_infra
    from worker import subtitulos_task
    registro = {"subidos": [], "estado": None, "infra": None}
    monkeypatch.setattr(media_sync, "bajar_prefijo", lambda pre, d: 0)
    monkeypatch.setattr(media_sync, "subir_archivo",
                        lambda local, key: registro["subidos"].append(key))
    monkeypatch.setattr(db, "fijar_subtitulos_editor",
                        lambda u, n, s: registro.update(estado=json.loads(s)))
    monkeypatch.setattr(costes_infra, "registrar",
                        lambda u, p, c, usd: registro.update(infra=(c, usd)))
    return subtitulos_task, registro, tmp_path


def test_subtitulos_task_ok_sube_y_fija_listo(tarea, monkeypatch):
    subtitulos_task, registro, tmp_path = tarea
    import subprocess

    def run_falso(cmd, **kw):
        subs = tmp_path / "videos" / "gen-abc" / "work" / "subs"
        subs.mkdir(parents=True, exist_ok=True)
        (subs / "subs.srt").write_text(SRT, encoding="utf-8")
        (subs / "subs.ass").write_text("[Script Info]", encoding="utf-8")

        class Ok:
            returncode, stdout, stderr = 0, "wrote pelicula-subtitulado.mp4\n", ""
        return Ok()

    monkeypatch.setattr(subprocess, "run", run_falso)
    assert subtitulos_task.main("u1", "gen-abc") == 0
    assert "videos/gen-abc/pelicula-subtitulado.mp4" in registro["subidos"]
    assert "videos/gen-abc/work/subs/subs.srt" in registro["subidos"]
    assert registro["estado"]["estado"] == "listo"
    assert registro["estado"]["url"] == \
        "https://cdn.example.com/videos/gen-abc/pelicula-subtitulado.mp4"
    assert registro["infra"][0] == "infra-subtitulos" and registro["infra"][1] >= 0


def test_subtitulos_task_fallo_fija_error_y_sale_1(tarea, monkeypatch):
    subtitulos_task, registro, _ = tarea
    import subprocess

    class Mal:
        returncode, stdout, stderr = 1, "", "no existe edited-transcript"
    monkeypatch.setattr(subprocess, "run", lambda *a, **k: Mal())
    assert subtitulos_task.main("u1", "gen-abc") == 1
    assert registro["estado"]["estado"] == "error"
    assert "edited-transcript" in registro["estado"]["log"]
    assert registro["infra"][0] == "infra-subtitulos"   # la infra se gastó igual
