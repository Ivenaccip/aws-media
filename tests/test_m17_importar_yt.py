"""M17 — importar un video de YouTube por liga (Ruta A): cotizar antes de
cobrar, cobro + encolado con devolución en fallo, y el worker que baja el MP4
a S3 y lo registra como subida. Sin red: Apify/SQS/Postgres mockeados.

OJO: nada de importar pipeline/server a nivel de módulo — pipeline.config
carga el .env real en la COLECCIÓN (este archivo se ordena antes que
test_m1/m2/m4) y contaminaría el entorno de esos tests."""
import json
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

URL = "https://www.youtube.com/watch?v=jNQXAC9IVRw"


# ---------------------------------------------------------------------------
# tarifa y extracción del id

def test_costo_importar_por_minuto_empezado():
    from pipeline import creditos
    assert creditos.costo_shorts_importar(30) == creditos.SHORTS_IMPORTAR_CR_MIN
    assert creditos.costo_shorts_importar(61) == creditos.SHORTS_IMPORTAR_CR_MIN * 2
    assert creditos.costo_shorts_importar(20 * 60) == creditos.SHORTS_IMPORTAR_CR_MIN * 20


def test_video_id_formatos():
    from server import shorts_api
    assert shorts_api._video_id(URL) == "jNQXAC9IVRw"
    assert shorts_api._video_id("https://youtu.be/jNQXAC9IVRw?t=3") == "jNQXAC9IVRw"
    assert shorts_api._video_id("https://www.youtube.com/shorts/jNQXAC9IVRw") == "jNQXAC9IVRw"
    with pytest.raises(Exception):
        shorts_api._video_id("https://vimeo.com/123")


# ---------------------------------------------------------------------------
# endpoints

@pytest.fixture
def cliente(monkeypatch):
    monkeypatch.delenv("COGNITO_POOL_ID", raising=False)
    monkeypatch.setenv("STATE_BACKEND", "postgres")
    from server.app import app
    return TestClient(app)


def _mock_info(monkeypatch, dur=19.0):
    from pipeline import apify
    monkeypatch.setattr(apify, "correr",
                        lambda actor, entrada, timeout_s=60: [
                            {"title": "Me at the zoo", "lengthSeconds": dur}])


def test_cotizar_devuelve_titulo_minutos_y_creditos(cliente, monkeypatch):
    from pipeline import creditos
    _mock_info(monkeypatch, dur=130.0)
    r = cliente.post("/api/shorts/importar/cotizar", json={"url": URL})
    assert r.status_code == 200
    d = r.json()
    assert d["titulo"] == "Me at the zoo" and d["nombre"] == "yt-jNQXAC9IVRw"
    assert d["creditos"] == creditos.SHORTS_IMPORTAR_CR_MIN * 3   # 130 s = 3 min empezados


def test_cotizar_rechaza_mas_de_90_min(cliente, monkeypatch):
    _mock_info(monkeypatch, dur=91 * 60)
    r = cliente.post("/api/shorts/importar/cotizar", json={"url": URL})
    assert r.status_code == 413


def test_importar_cobra_guarda_y_encola(cliente, monkeypatch):
    from pipeline import creditos, db, jobs
    _mock_info(monkeypatch)
    monkeypatch.setattr(db, "cargar_proyecto_editor", lambda u, n: None)
    guardado, encolado, movimientos = {}, [], []
    monkeypatch.setattr(db, "guardar_proyecto_editor",
                        lambda u, n, s: guardado.update({n: json.loads(s)}))
    monkeypatch.setattr(jobs, "encolar_shorts_importar",
                        lambda u, n, url: encolado.append((n, url)))
    monkeypatch.setattr(creditos, "activo", lambda: True)
    monkeypatch.setattr(creditos, "cobrar",
                        lambda n, ref, user=None: movimientos.append(("cobro", n, ref)))
    r = cliente.post("/api/shorts/importar", json={"url": URL})
    assert r.status_code == 200 and r.json()["nombre"] == "yt-jNQXAC9IVRw"
    assert encolado == [("yt-jNQXAC9IVRw", URL)]
    assert movimientos == [("cobro", creditos.SHORTS_IMPORTAR_CR_MIN,
                            "shorts-importar:yt-jNQXAC9IVRw")]
    assert guardado["yt-jNQXAC9IVRw"]["importar"]["estado"] == "descargando"


def test_importar_devuelve_si_no_encola(cliente, monkeypatch):
    from pipeline import creditos, db, jobs
    _mock_info(monkeypatch)
    monkeypatch.setattr(db, "cargar_proyecto_editor", lambda u, n: None)
    monkeypatch.setattr(db, "guardar_proyecto_editor", lambda u, n, s: None)
    monkeypatch.setattr(db, "fijar_campo_editor", lambda u, n, c, v: None)
    movimientos = []
    monkeypatch.setattr(creditos, "activo", lambda: True)
    monkeypatch.setattr(creditos, "cobrar",
                        lambda n, ref, user=None: movimientos.append(("cobro", n, ref)))
    monkeypatch.setattr(creditos, "devolver",
                        lambda n, ref, user=None: movimientos.append(("devolucion", n, ref)))

    def truena(u, n, url):
        raise RuntimeError("SQS caída")
    monkeypatch.setattr(jobs, "encolar_shorts_importar", truena)
    r = cliente.post("/api/shorts/importar", json={"url": URL})
    assert r.status_code == 502
    assert [m[0] for m in movimientos] == ["cobro", "devolucion"]


def test_importar_402_sin_saldo(cliente, monkeypatch):
    from pipeline import creditos, db
    _mock_info(monkeypatch)
    monkeypatch.setattr(db, "cargar_proyecto_editor", lambda u, n: None)
    monkeypatch.setattr(creditos, "activo", lambda: True)

    def sin_saldo(n, ref, user=None):
        raise creditos.SinSaldo(n, 0)
    monkeypatch.setattr(creditos, "cobrar", sin_saldo)
    r = cliente.post("/api/shorts/importar", json={"url": URL})
    assert r.status_code == 402


def test_importar_409_si_ya_descarga(cliente, monkeypatch):
    from datetime import datetime, timezone

    from pipeline import db
    monkeypatch.setattr(db, "cargar_proyecto_editor", lambda u, n: {
        "importar": {"estado": "descargando",
                     "inicio": datetime.now(timezone.utc).isoformat(timespec="seconds")}})
    r = cliente.post("/api/shorts/importar", json={"url": URL})
    assert r.status_code == 409


# ---------------------------------------------------------------------------
# worker

def test_worker_importa_a_s3_y_registra_subida(monkeypatch):
    monkeypatch.setenv("MEDIA_BUCKET", "bucket-x")
    monkeypatch.setenv("STATE_BACKEND", "postgres")
    # importar() escribe DEFAULT_USER_ID directo en os.environ (patrón del
    # worker): registrarla en monkeypatch para que no se fugue a otros tests
    monkeypatch.setenv("DEFAULT_USER_ID", "u1")
    from pipeline import apify, costes_infra, db
    from worker import shorts_importar

    docs = {"yt-abc": {"subidas": [], "importar": {"estado": "descargando", "creditos": 4}}}
    campos = {}
    monkeypatch.setattr(db, "cargar_proyecto_editor", lambda u, n: docs.get(n))
    monkeypatch.setattr(db, "guardar_proyecto_editor",
                        lambda u, n, s: docs.update({n: json.loads(s)}))
    monkeypatch.setattr(db, "fijar_campo_editor",
                        lambda u, n, c, v: campos.update({c: json.loads(v)}))
    filas = []
    monkeypatch.setattr(db, "ejecutar", lambda sql, p=None: filas.append(p) or [])
    monkeypatch.setattr(db, "backend", lambda: "postgres")
    monkeypatch.setattr(costes_infra, "registrar", lambda *a: None)
    def correr(actor, entrada, timeout_s=780):
        if "downloader" in actor:
            return [{"title": "Me at the zoo", "durationSeconds": 19,
                     "savedFile": {"url": "https://api.apify.com/kv/x.mp4", "billedMb": 1}}]
        # actor de transcript: los captions que YouTube ya tiene
        return [{"transcript": [{"text": "hola a todos", "timestamp": "0:01"},
                                {"text": "y adiós", "timestamp": "0:10"}]}]
    monkeypatch.setattr(apify, "correr", correr)
    subido, escritos = {}, {}
    monkeypatch.setattr(apify, "descargar_a_s3",
                        lambda url, bucket, key: subido.update(url=url, bucket=bucket, key=key) or 629172)
    from pipeline import media_sync
    monkeypatch.setattr(media_sync, "escribir_texto",
                        lambda key, texto: escritos.update({key: json.loads(texto)}))

    shorts_importar.importar("u1", "yt-abc", URL)

    assert subido["bucket"] == "bucket-x" and subido["key"] == "videos/yt-abc/subidas/yt-abc.mp4"
    assert docs["yt-abc"]["subidas"][0]["key"] == "videos/yt-abc/subidas/yt-abc.mp4"
    assert campos["importar"]["estado"] == "listo" and campos["importar"]["transcript"] is True
    # el canónico quedó en S3: Analizar no re-transcribe (transcripción 0 cr)
    canon = escritos["videos/yt-abc/work/transcripts/yt-abc.canonical.json"]
    assert canon["asr"]["backend"] == "youtube" and len(canon["words"]) == 5
    assert canon["words"][0]["start"] == 1.0 and canon["words"][-1]["end"] == 19.0
    # costo real: descarga (0.01 + 1 MB × 0.002) + transcript (0.01)
    assert filas and filas[0]["usd"] == round(0.01 + 1 * 0.002 + 0.01, 4)


def test_worker_sin_captions_no_marca_transcript(monkeypatch):
    """Video sin captions: el importe NO se cae y Analizar transcribirá."""
    monkeypatch.setenv("MEDIA_BUCKET", "bucket-x")
    monkeypatch.setenv("STATE_BACKEND", "postgres")
    monkeypatch.setenv("DEFAULT_USER_ID", "u1")
    from pipeline import apify, costes_infra, db
    from worker import shorts_importar

    docs = {"yt-abc": {"subidas": [], "importar": {"estado": "descargando", "creditos": 4}}}
    campos = {}
    monkeypatch.setattr(db, "cargar_proyecto_editor", lambda u, n: docs.get(n))
    monkeypatch.setattr(db, "guardar_proyecto_editor",
                        lambda u, n, s: docs.update({n: json.loads(s)}))
    monkeypatch.setattr(db, "fijar_campo_editor",
                        lambda u, n, c, v: campos.update({c: json.loads(v)}))
    filas = []
    monkeypatch.setattr(db, "ejecutar", lambda sql, p=None: filas.append(p) or [])
    monkeypatch.setattr(db, "backend", lambda: "postgres")
    monkeypatch.setattr(costes_infra, "registrar", lambda *a: None)

    def correr(actor, entrada, timeout_s=780):
        if "downloader" in actor:
            return [{"title": "x", "durationSeconds": 19,
                     "savedFile": {"url": "https://api.apify.com/kv/x.mp4", "billedMb": 1}}]
        raise apify.ApifyError("sin resultados")
    monkeypatch.setattr(apify, "correr", correr)
    monkeypatch.setattr(apify, "descargar_a_s3", lambda url, bucket, key: 629172)

    shorts_importar.importar("u1", "yt-abc", URL)

    assert campos["importar"]["estado"] == "listo"
    assert campos["importar"]["transcript"] is False
    assert filas[0]["usd"] == round(0.01 + 1 * 0.002, 4)   # sin el fijo del transcript


def test_worker_error_devuelve_creditos(monkeypatch):
    monkeypatch.setenv("MEDIA_BUCKET", "bucket-x")
    monkeypatch.setenv("DEFAULT_USER_ID", "u1")
    from pipeline import apify, costes_infra, creditos, db
    from worker import shorts_importar

    monkeypatch.setattr(db, "cargar_proyecto_editor", lambda u, n: {
        "importar": {"estado": "descargando", "creditos": 4}})
    campos = {}
    monkeypatch.setattr(db, "fijar_campo_editor",
                        lambda u, n, c, v: campos.update({c: json.loads(v)}))
    monkeypatch.setattr(costes_infra, "registrar", lambda *a: None)
    movimientos = []
    monkeypatch.setattr(creditos, "activo", lambda: True)
    monkeypatch.setattr(creditos, "devolver",
                        lambda n, ref, user=None: movimientos.append((n, ref)))

    def truena(actor, entrada, timeout_s=780):
        raise apify.ApifyError("run FAILED")
    monkeypatch.setattr(apify, "correr", truena)

    shorts_importar.importar("u1", "yt-abc", URL)

    assert campos["importar"]["estado"] == "error"
    assert movimientos == [(4, "shorts-importar:yt-abc")]
