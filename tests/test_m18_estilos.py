"""M18 — copiadora de estilos: detección de ligas, cobro + encolado con
devolución en fallo, y el worker que arma el perfil. Sin red: Apify/SQS/S3/
Postgres/LLM mockeados.

OJO: nada de importar pipeline/server a nivel de módulo — pipeline.config
carga el .env real en la COLECCIÓN y contaminaría el entorno de otros tests."""
import json
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

URL_IG = "https://www.instagram.com/reel/Cabc123XYZ_/"
URL_TT = "https://www.tiktok.com/@alguien/video/7301234567890123456"


# ---------------------------------------------------------------------------
# tarifa y detección de la liga

def test_tarifa_fija_espejo_de_tarifas_json():
    from pipeline import creditos
    tarifas = json.loads((Path(__file__).resolve().parent.parent / "tools"
                          / "tarifas.json").read_text(encoding="utf-8"))
    assert creditos.costo_estilo_analizar() == tarifas["estilos"]["analizar"]


def test_detectar_plataformas():
    from server import estilos_api
    assert estilos_api._detectar(URL_IG) == ("instagram", "ig-Cabc123XYZ_")
    assert estilos_api._detectar("https://instagram.com/p/Cabc123XYZ_/?hl=es") \
        == ("instagram", "ig-Cabc123XYZ_")
    assert estilos_api._detectar(URL_TT) == ("tiktok", "tt-7301234567890123456")
    assert estilos_api._detectar("https://vm.tiktok.com/ZMabc12/") == ("tiktok", "tt-ZMabc12")
    with pytest.raises(Exception):
        estilos_api._detectar("https://youtube.com/watch?v=jNQXAC9IVRw")


# ---------------------------------------------------------------------------
# endpoints

@pytest.fixture
def cliente(monkeypatch):
    monkeypatch.delenv("COGNITO_POOL_ID", raising=False)
    monkeypatch.setenv("STATE_BACKEND", "postgres")
    monkeypatch.setenv("MEDIA_BUCKET", "bucket-de-prueba")
    from server.app import app
    return TestClient(app)


@pytest.fixture
def s3(monkeypatch):
    """media_sync en memoria: {key: texto}."""
    from pipeline import media_sync
    docs = {}
    monkeypatch.setattr(media_sync, "leer_texto", docs.get)
    monkeypatch.setattr(media_sync, "escribir_texto",
                        lambda key, texto, tipo="application/json": docs.__setitem__(key, texto))
    monkeypatch.setattr(media_sync, "listar_prefijo",
                        lambda pref: sorted(k for k in docs if k.startswith(pref)))
    return docs


def test_analizar_cobra_guarda_y_encola(cliente, s3, monkeypatch):
    from pipeline import creditos, jobs
    encolado, movimientos = [], []
    monkeypatch.setattr(jobs, "encolar_estilo_analizar",
                        lambda u, i, url, plat: encolado.append((i, url, plat)))
    monkeypatch.setattr(creditos, "activo", lambda: True)
    monkeypatch.setattr(creditos, "cobrar",
                        lambda n, ref, user=None: movimientos.append(("cobro", n, ref)))
    r = cliente.post("/api/estilo/analizar", json={"url": URL_IG})
    assert r.status_code == 200 and r.json()["id"] == "ig-Cabc123XYZ_"
    assert encolado == [("ig-Cabc123XYZ_", URL_IG, "instagram")]
    assert movimientos == [("cobro", creditos.ESTILO_ANALIZAR_CR,
                            "estilo-analizar:ig-Cabc123XYZ_")]
    doc = json.loads(list(s3.values())[0])
    assert doc["estado"] == "analizando" and doc["plataforma"] == "instagram"


def test_analizar_devuelve_si_no_encola(cliente, s3, monkeypatch):
    from pipeline import creditos, jobs
    movimientos = []
    monkeypatch.setattr(creditos, "activo", lambda: True)
    monkeypatch.setattr(creditos, "cobrar",
                        lambda n, ref, user=None: movimientos.append(("cobro", n, ref)))
    monkeypatch.setattr(creditos, "devolver",
                        lambda n, ref, user=None: movimientos.append(("devolucion", n, ref)))

    def truena(u, i, url, plat):
        raise RuntimeError("SQS caída")
    monkeypatch.setattr(jobs, "encolar_estilo_analizar", truena)
    r = cliente.post("/api/estilo/analizar", json={"url": URL_TT})
    assert r.status_code == 502
    assert [m[0] for m in movimientos] == ["cobro", "devolucion"]
    assert json.loads(list(s3.values())[0])["estado"] == "error"


def test_analizar_402_sin_saldo(cliente, s3, monkeypatch):
    from pipeline import creditos
    monkeypatch.setattr(creditos, "activo", lambda: True)

    def sin_saldo(n, ref, user=None):
        raise creditos.SinSaldo(n, 0)
    monkeypatch.setattr(creditos, "cobrar", sin_saldo)
    r = cliente.post("/api/estilo/analizar", json={"url": URL_IG})
    assert r.status_code == 402 and s3 == {}


def test_analizar_409_si_ya_corre_o_ya_esta(cliente, s3, monkeypatch):
    from datetime import datetime, timezone
    inicio = datetime.now(timezone.utc).isoformat(timespec="seconds")
    s3["usuarios/u1/estilos/ig-Cabc123XYZ_.json"] = json.dumps(
        {"estado": "analizando", "inicio": inicio})
    monkeypatch.setenv("DEFAULT_USER_ID", "u1")
    assert cliente.post("/api/estilo/analizar", json={"url": URL_IG}).status_code == 409
    s3["usuarios/u1/estilos/ig-Cabc123XYZ_.json"] = json.dumps({"estado": "listo"})
    assert cliente.post("/api/estilo/analizar", json={"url": URL_IG}).status_code == 409


def test_listar_devuelve_tarjetas_y_tarifa(cliente, s3, monkeypatch):
    from pipeline import creditos
    monkeypatch.setenv("DEFAULT_USER_ID", "u1")
    s3["usuarios/u1/estilos/tt-1.json"] = json.dumps({"estado": "listo", "inicio": "2026-09-08T10:00:00+00:00"})
    s3["usuarios/u1/estilos/ig-2.json"] = json.dumps({"estado": "analizando", "inicio": "2026-09-08T11:00:00+00:00"})
    r = cliente.get("/api/estilo")
    assert r.status_code == 200
    d = r.json()
    assert d["creditos"] == creditos.costo_estilo_analizar()
    assert [e["id"] for e in d["estilos"]] == ["ig-2", "tt-1"]   # más reciente primero


# ---------------------------------------------------------------------------
# worker (orquestación: helpers mockeados — ffmpeg/PIL/LLM no corren aquí)

@pytest.fixture
def worker_env(monkeypatch, s3):
    monkeypatch.setenv("DEFAULT_USER_ID", "u1")
    monkeypatch.setenv("STATE_BACKEND", "postgres")
    from worker import estilo_analizar as w
    monkeypatch.setattr(w, "_ficha", lambda url, plat: {
        "video_url": "https://cdn/x.mp4", "autor": "alguien", "caption": "hola"})
    monkeypatch.setattr(w, "_descargar", lambda url, destino: 8_000_000)
    monkeypatch.setattr(w, "_sondear", lambda v: {"duracion_s": 30.0, "ancho": 1080, "alto": 1920})
    monkeypatch.setattr(w, "_frames", lambda v, c, d: [Path("f0.jpg")])
    monkeypatch.setattr(w, "_cortes", lambda v, c: 12)
    monkeypatch.setattr(w, "_paleta", lambda fs: [{"hex": "#112233", "pct": 40}])

    async def perfil(fs):
        return {"tono": "enérgico", "prompt_estilo": "warm neon look"}
    monkeypatch.setattr(w, "_perfil_llm", perfil)
    return w


def test_worker_arma_el_perfil_y_registra_costo(worker_env, s3, monkeypatch):
    from pipeline import costes_infra, db
    filas = []
    monkeypatch.setattr(db, "backend", lambda: "postgres")
    monkeypatch.setattr(db, "ejecutar", lambda sql, params=None: filas.append(params))
    monkeypatch.setattr(costes_infra, "registrar", lambda *a, **k: None)
    key = "usuarios/u1/estilos/ig-X.json"
    s3[key] = json.dumps({"estado": "analizando", "creditos": 3})
    worker_env.analizar("u1", "ig-X", URL_IG, "instagram")
    doc = json.loads(s3[key])
    assert doc["estado"] == "listo"
    assert doc["metrica"]["cortes_por_min"] == 24.0     # 12 cortes en 30 s
    assert doc["perfil"]["prompt_estilo"] == "warm neon look"
    assert doc["paleta"][0]["hex"] == "#112233"
    assert filas and filas[0]["usd"] == pytest.approx(0.0027)


def test_worker_fallo_devuelve_creditos(worker_env, s3, monkeypatch):
    from pipeline import costes_infra, creditos
    monkeypatch.setattr(costes_infra, "registrar", lambda *a, **k: None)
    movimientos = []
    monkeypatch.setattr(creditos, "activo", lambda: True)
    monkeypatch.setattr(creditos, "devolver",
                        lambda n, ref, user=None: movimientos.append((n, ref)))

    def truena(url, plat):
        raise RuntimeError("actor caído")
    monkeypatch.setattr(worker_env, "_ficha", truena)
    key = "usuarios/u1/estilos/tt-Y.json"
    s3[key] = json.dumps({"estado": "analizando", "creditos": 3})
    worker_env.analizar("u1", "tt-Y", URL_TT, "tiktok")
    doc = json.loads(s3[key])
    assert doc["estado"] == "error" and "actor caído" in doc["error"]
    assert movimientos == [(3, "estilo-analizar:tt-Y")]
