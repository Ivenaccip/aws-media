"""P0 antes del 23-sep: el nombre de un proyecto del editor es único entre
cuentas, porque en S3 vive en videos/<nombre>/ SIN el usuario. Antes, dos
cuentas con «video-1» (o que importaban el mismo video de YouTube) leían y
pisaban los mismos archivos.

Las funciones de pipeline/db.py corren de verdad contra un SQLite en disco.
Cada sentencia abre su propia conexión, igual que cada llamada al Data API es
su propia transacción, y las tablas salen de db.ESQUEMA. Así se prueba el SQL
de la reserva, no un mock que siempre dice que sí. Sin red: S3, SQS y Apify
van mockeados.
"""
import asyncio
import json
import re
import sqlite3
import threading
from contextlib import contextmanager
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from pipeline import db

URL = "https://www.youtube.com/watch?v=jNQXAC9IVRw"
VID = "jNQXAC9IVRw"
TABLAS = ("usuarios", "proyectos_editor", "nombres_editor")


def _a_sqlite(sql: str) -> str:
    """Lo único del SQL de db.py que SQLite no entiende: los casts, now() y
    el jsonb_set con que los workers actualizan un campo del doc."""
    sql = re.sub(r"::(jsonb|text|timestamptz)\b", "", sql).replace("now()", "CURRENT_TIMESTAMP")
    return re.sub(r"jsonb_set\((\w+), '\{(\w+)\}', (:\w+)\)", r"json_set(\1, '$.\2', json(\3))", sql)


@pytest.fixture
def base(monkeypatch, tmp_path):
    ruta = tmp_path / "aurora.sqlite"

    def ejecutar(sql, params=None):
        con = sqlite3.connect(ruta, timeout=30, isolation_level=None)   # autocommit
        con.row_factory = sqlite3.Row
        try:
            return [dict(f) for f in con.execute(_a_sqlite(sql), params or {}).fetchall()]
        finally:
            con.close()

    ejecutar("PRAGMA journal_mode=WAL")
    creadas = []
    for sentencia in db.ESQUEMA:
        m = re.search(r"CREATE TABLE IF NOT EXISTS (\w+) \(", sentencia)
        if m and m.group(1) in TABLAS:
            ejecutar(sentencia)
            creadas.append(m.group(1))
    assert sorted(creadas) == sorted(TABLAS)   # la tabla de reservas está en el esquema
    monkeypatch.setattr(db, "ejecutar", ejecutar)
    return ejecutar


@contextmanager
def como(usuario: str):
    """La identidad por request, igual que la fija el middleware de Cognito."""
    marca = db.fijar_usuario(usuario)
    try:
        yield
    finally:
        db._usuario_request.reset(marca)


def _proyecto_viejo(base, usuario: str, nombre: str, doc: dict) -> None:
    """Un proyecto creado antes de que existiera nombres_editor (sin reserva)."""
    base("INSERT INTO proyectos_editor (user_id, nombre, doc) VALUES (:u, :n, :d)",
         {"u": usuario, "n": nombre, "d": json.dumps(doc)})


# ---------------------------------------------------------------------------
# la reserva en pipeline/db.py

def test_el_primero_se_queda_el_nombre(base):
    assert db.reservar_nombre_editor("ana", "video-1") is True
    assert db.reservar_nombre_editor("beto", "video-1") is False
    assert db.reservar_nombre_editor("ana", "video-1") is True     # sigue siendo suyo
    assert db.nombre_editor_ajeno("beto", "video-1") is True
    assert db.nombre_editor_ajeno("ana", "video-1") is False
    assert base("SELECT nombre, user_id FROM nombres_editor") == [
        {"nombre": "video-1", "user_id": "ana"}]


def test_guardar_no_escribe_sobre_el_nombre_de_otro(base):
    db.guardar_proyecto_editor("ana", "video-1", json.dumps({"subidas": [{"key": "a"}]}))
    with pytest.raises(db.NombreAjeno) as e:
        db.guardar_proyecto_editor("beto", "video-1", json.dumps({"subidas": [{"key": "b"}]}))
    assert "otra cuenta" in str(e.value) and "video-1" in str(e.value)
    assert db.cargar_proyecto_editor("ana", "video-1") == {"subidas": [{"key": "a"}]}
    assert db.cargar_proyecto_editor("beto", "video-1") is None
    assert db.listar_proyectos_editor("beto") == []


def test_los_proyectos_de_antes_siguen_siendo_de_quien_los_creo(base):
    """Sin backfill: la fila vieja en proyectos_editor basta para cerrarle el
    nombre a las demás cuentas, y su dueño lo reserva al volver a usarlo."""
    _proyecto_viejo(base, "ana", "video-1", {"subidas": []})
    assert db.reservar_nombre_editor("beto", "video-1") is False
    assert base("SELECT * FROM nombres_editor") == []
    assert db.reservar_nombre_editor("ana", "video-1") is True
    assert base("SELECT user_id FROM nombres_editor WHERE nombre = 'video-1'") == [
        {"user_id": "ana"}]


def test_un_nombre_ya_repetido_no_se_le_da_a_nadie(base):
    """Si en producción ya hubiera dos cuentas con el mismo nombre, ninguna
    puede seguir subiendo ahí: comparten prefijo y lo decide el dueño."""
    _proyecto_viejo(base, "ana", "demo", {})
    _proyecto_viejo(base, "beto", "demo", {})
    assert db.reservar_nombre_editor("ana", "demo") is False
    assert db.reservar_nombre_editor("beto", "demo") is False


def test_carrera_una_sola_cuenta_gana(base):
    """Ocho cuentas piden «video-1» a la vez: el PRIMARY KEY deja pasar a una."""
    n = 8
    barrera = threading.Barrier(n)
    resultados, errores = {}, []

    def intenta(usuario):
        try:
            barrera.wait()
            resultados[usuario] = db.reservar_nombre_editor(usuario, "video-1")
        except Exception as err:  # noqa: BLE001 — que el assert lo cuente
            errores.append(err)

    hilos = [threading.Thread(target=intenta, args=(f"u{i}",)) for i in range(n)]
    for h in hilos:
        h.start()
    for h in hilos:
        h.join()
    assert errores == []
    ganadores = [u for u, ok in resultados.items() if ok]
    assert len(resultados) == n and len(ganadores) == 1
    assert base("SELECT user_id FROM nombres_editor WHERE nombre = 'video-1'") == [
        {"user_id": ganadores[0]}]


def test_nombre_derivado_es_estable_y_distinto_por_cuenta(base):
    a = db.reservar_nombre_derivado("ana", "yt-X", con_base=False)
    b = db.reservar_nombre_derivado("beto", "yt-X", con_base=False)
    assert re.fullmatch(r"yt-X-[0-9a-f]{4}", a) and re.fullmatch(r"yt-X-[0-9a-f]{4}", b)
    assert a != b
    assert db.reservar_nombre_derivado("ana", "yt-X", con_base=False) == a   # reintento
    # solo calcular no aparta nada
    c = db.reservar_nombre_derivado("carla", "yt-X", con_base=False, reservar=False)
    assert base("SELECT user_id FROM nombres_editor WHERE nombre = :n", {"n": c}) == []


def test_nombre_derivado_salta_el_sufijo_de_otra_cuenta(base, monkeypatch):
    """Dos cuentas cuyo primer sufijo coincide (1 entre 65 536)."""
    monkeypatch.setattr(db, "sufijo_estable",
                        lambda u, base_, i: "aaaa" if i == 0 else f"{u[0]}{i:03d}")
    assert db.reservar_nombre_derivado("ana", "yt-X", con_base=False) == "yt-X-aaaa"
    assert db.reservar_nombre_derivado("beto", "yt-X", con_base=False) == "yt-X-b001"
    assert db.reservar_nombre_derivado("beto", "yt-X", con_base=False) == "yt-X-b001"


def test_nombre_derivado_se_rinde_sin_candidatos(base, monkeypatch):
    monkeypatch.setattr(db, "sufijo_estable", lambda u, base_, i: "aaaa")
    assert db.reservar_nombre_derivado("ana", "yt-X", con_base=False) == "yt-X-aaaa"
    assert db.reservar_nombre_derivado("beto", "yt-X", con_base=False, intentos=3) is None


# ---------------------------------------------------------------------------
# subidas (server/media_api.py)

@pytest.fixture
def s3(monkeypatch):
    from server import media_api
    monkeypatch.setenv("MEDIA_BUCKET", "bucket-test")
    monkeypatch.setenv("CDN_BASE", "https://cdn.test")
    registro = SimpleNamespace(firmados=[], consultados=[])

    class S3:
        def generate_presigned_url(self, op, Params, ExpiresIn):
            registro.firmados.append(Params["Key"])
            return "https://s3/firmada"

        def head_object(self, Bucket, Key):
            registro.consultados.append(Key)
            return {"ContentLength": 10}
    monkeypatch.setattr(media_api, "_s3", lambda: S3())
    return registro


def test_dos_cuentas_con_el_mismo_nombre(base, s3):
    from server import media_api
    from server.media_api import ConfirmarIn, PresignIn
    key = "videos/video-1/subidas/a.mp4"
    with como("ana"):
        media_api.presign(PresignIn(proyecto="video-1", archivo="a.mp4"))
        media_api.confirmar(ConfirmarIn(proyecto="video-1", key=key))

    with como("beto"):
        with pytest.raises(HTTPException) as e:
            media_api.presign(PresignIn(proyecto="video-1", archivo="a.mp4"))
        assert e.value.status_code == 409
        assert "otra cuenta" in e.value.detail and "Elige otro nombre" in e.value.detail
        with pytest.raises(HTTPException) as e:
            media_api.confirmar(ConfirmarIn(proyecto="video-1", key=key))
        assert e.value.status_code == 409
        assert media_api.subidas("video-1") == {"subidas": []}
        with pytest.raises(HTTPException) as e:
            media_api._mio(key)                      # ni descargarlo
        assert e.value.status_code == 404
        media_api.presign(PresignIn(proyecto="video-1-beto", archivo="a.mp4"))

    assert s3.firmados == [key, "videos/video-1-beto/subidas/a.mp4"]
    assert s3.consultados == [key]                   # el confirmar de beto ni llegó a S3
    assert db.cargar_proyecto_editor("ana", "video-1")["subidas"][0]["key"] == key
    assert db.cargar_proyecto_editor("beto", "video-1") is None


def test_presign_sobre_un_proyecto_ajeno(base, s3):
    """El proyecto de ana es de antes de la reserva: beto no obtiene URL."""
    from server import media_api
    from server.media_api import PresignIn
    _proyecto_viejo(base, "ana", "entrevista", {"subidas": [
        {"key": "videos/entrevista/subidas/toma.mp4"}]})
    with como("beto"), pytest.raises(HTTPException) as e:
        media_api.presign(PresignIn(proyecto="entrevista", archivo="toma.mp4"))
    assert e.value.status_code == 409
    assert s3.firmados == []                         # nunca se firmó el PUT
    with como("ana"):
        r = media_api.presign(PresignIn(proyecto="entrevista", archivo="toma2.mp4"))
    assert r["key"] == "videos/entrevista/subidas/toma2.mp4"


def test_presign_reserva_antes_de_subir(base, s3):
    """ana pidió la subida y todavía no confirma: beto ya no puede firmar un
    PUT a la misma key mientras ana sube."""
    from server import media_api
    from server.media_api import PresignIn
    with como("ana"):
        media_api.presign(PresignIn(proyecto="video-1", archivo="a.mp4"))
    with como("beto"), pytest.raises(HTTPException) as e:
        media_api.presign(PresignIn(proyecto="video-1", archivo="a.mp4"))
    assert e.value.status_code == 409
    assert s3.firmados == ["videos/video-1/subidas/a.mp4"]
    # reservar no crea un proyecto vacío en la lista de ana
    assert db.listar_proyectos_editor("ana") == []


def test_el_409_llega_a_la_pantalla(base, s3, monkeypatch):
    monkeypatch.delenv("COGNITO_POOL_ID", raising=False)
    monkeypatch.setenv("DEFAULT_USER_ID", "beto")
    db.reservar_nombre_editor("ana", "video-1")
    from server.app import app
    r = TestClient(app).post("/api/media/presign",
                             json={"proyecto": "video-1", "archivo": "a.mp4"})
    assert r.status_code == 409 and "otra cuenta" in r.json()["detail"]


def test_guardar_ajeno_sale_como_409_y_no_como_500():
    """La red de seguridad de server/app.py para cualquier otro camino."""
    from server import app as app_mod
    r = asyncio.run(app_mod._nombre_ajeno(None, db.NombreAjeno("video-1")))
    assert r.status_code == 409 and "video-1" in json.loads(r.body)["detail"]


# ---------------------------------------------------------------------------
# importar de YouTube (server/shorts_api.py + worker/shorts_importar.py)

@pytest.fixture
def nube(base, monkeypatch):
    monkeypatch.delenv("COGNITO_POOL_ID", raising=False)
    monkeypatch.setenv("STATE_BACKEND", "postgres")
    monkeypatch.setenv("MEDIA_BUCKET", "bucket-x")
    from pipeline import apify, creditos, jobs
    monkeypatch.setattr(apify, "correr", lambda actor, entrada, timeout_s=60: [
        {"title": "Me at the zoo", "lengthSeconds": 130.0}])
    monkeypatch.setattr(creditos, "activo", lambda: True)
    cobros, encolados = [], []
    monkeypatch.setattr(creditos, "cobrar",
                        lambda n, ref, user=None: cobros.append((user, ref)))
    monkeypatch.setattr(jobs, "encolar_shorts_importar",
                        lambda u, n, url: encolados.append((u, n)))
    from server.app import app
    cliente = TestClient(app)

    def pedir(usuario, ruta, **kw):
        monkeypatch.setenv("DEFAULT_USER_ID", usuario)
        return cliente.post(ruta, **kw) if "json" in kw else cliente.get(ruta)
    return SimpleNamespace(pedir=pedir, cobros=cobros, encolados=encolados)


def _worker(monkeypatch, usuario, nombre):
    """Corre el worker real de importar con Apify y S3 mockeados."""
    from pipeline import apify, costes_infra, media_sync
    from worker import shorts_importar
    subidos = []

    def correr(actor, entrada, timeout_s=780):
        if "videoIds" in entrada:                   # la cotización, como en `nube`
            return [{"title": "Me at the zoo", "lengthSeconds": 130.0}]
        if "downloader" in actor:
            return [{"title": "Me at the zoo", "durationSeconds": 130,
                     "savedFile": {"url": "https://api.apify.com/kv/x.mp4", "billedMb": 1}}]
        raise apify.ApifyError("sin captions")
    monkeypatch.setattr(apify, "correr", correr)
    monkeypatch.setattr(apify, "descargar_a_s3",
                        lambda url, bucket, key: subidos.append(key) or 1000)
    monkeypatch.setattr(media_sync, "escribir_texto", lambda key, texto: None)
    monkeypatch.setattr(costes_infra, "registrar", lambda *a: None)
    monkeypatch.setenv("DEFAULT_USER_ID", usuario)
    shorts_importar.importar(usuario, nombre, URL)
    return subidos


def test_mismo_video_de_youtube_dos_cuentas(nube, monkeypatch):
    ra = nube.pedir("ana", "/api/shorts/importar", json={"url": URL})
    rb = nube.pedir("beto", "/api/shorts/importar", json={"url": URL})
    assert ra.status_code == 200 and rb.status_code == 200
    na, nb = ra.json()["nombre"], rb.json()["nombre"]
    assert re.fullmatch(rf"yt-{VID}-[0-9a-f]{{4}}", na)
    assert re.fullmatch(rf"yt-{VID}-[0-9a-f]{{4}}", nb)
    assert na != nb
    assert nube.encolados == [("ana", na), ("beto", nb)]
    assert nube.cobros == [("ana", f"shorts-importar:{na}"), ("beto", f"shorts-importar:{nb}")]

    # cada worker escribe en su propio prefijo de S3
    assert _worker(monkeypatch, "ana", na) == [f"videos/{na}/subidas/{na}.mp4"]
    assert _worker(monkeypatch, "beto", nb) == [f"videos/{nb}/subidas/{nb}.mp4"]
    assert db.cargar_proyecto_editor("ana", na)["importar"]["estado"] == "listo"
    assert db.cargar_proyecto_editor("beto", nb)["importar"]["estado"] == "listo"

    # ninguno ve el proyecto del otro
    assert nube.pedir("beto", f"/api/shorts/{na}").status_code == 404
    assert nube.pedir("ana", f"/api/shorts/{nb}").status_code == 404
    assert [p["nombre"] for p in db.listar_proyectos_editor("ana")] == [na]


def test_importar_el_mismo_video_dos_veces(nube, monkeypatch):
    """La misma cuenta vuelve a caer en SU proyecto: no paga dos veces ni abre
    otro, y la cotización le da el nombre al que la página redirige en el 409."""
    cot = nube.pedir("ana", "/api/shorts/importar/cotizar", json={"url": URL})
    assert cot.status_code == 200
    nombre = cot.json()["nombre"]
    assert nube.pedir("ana", "/api/shorts/importar", json={"url": URL}).json()["nombre"] == nombre

    r = nube.pedir("ana", "/api/shorts/importar", json={"url": URL})
    assert r.status_code == 409 and "ya se está importando" in r.json()["detail"]

    _worker(monkeypatch, "ana", nombre)
    r = nube.pedir("ana", "/api/shorts/importar", json={"url": URL})
    assert r.status_code == 409 and f"«{nombre}»" in r.json()["detail"]
    assert nube.pedir("ana", "/api/shorts/importar/cotizar",
                      json={"url": URL}).json()["nombre"] == nombre
    assert len(nube.cobros) == 1 and len(nube.encolados) == 1


def test_cotizar_no_aparta_el_nombre(nube):
    nube.pedir("ana", "/api/shorts/importar/cotizar", json={"url": URL})
    assert db.listar_proyectos_editor("ana") == []
    assert db.ejecutar("SELECT * FROM nombres_editor") == []


def test_importado_de_antes_se_sigue_usando(nube, base):
    """ana importó el video cuando el nombre era yt-<id> a secas."""
    _proyecto_viejo(base, "ana", f"yt-{VID}", {"subidas": [], "importar": {"estado": "listo"}})
    r = nube.pedir("ana", "/api/shorts/importar", json={"url": URL})
    assert r.status_code == 409 and f"«yt-{VID}»" in r.json()["detail"]
    assert nube.pedir("ana", "/api/shorts/importar/cotizar",
                      json={"url": URL}).json()["nombre"] == f"yt-{VID}"
    # beto importa el mismo video en su propio proyecto, no en el de ana
    rb = nube.pedir("beto", "/api/shorts/importar", json={"url": URL})
    assert rb.status_code == 200 and rb.json()["nombre"] != f"yt-{VID}"


# ---------------------------------------------------------------------------
# puente del generador (pipeline/flow.py)

def test_puente_reserva_gen_y_esquiva_el_de_otra_cuenta(base, monkeypatch):
    from pipeline import flow
    monkeypatch.setattr(db, "backend", lambda: "postgres")
    p = SimpleNamespace(id="abcd1234")
    with como("ana"):
        assert flow._nombre_puente(p) == "gen-abcd1234"
    with como("beto"):
        nb = flow._nombre_puente(p)
        assert re.fullmatch(r"gen-abcd1234-[0-9a-f]{4}", nb)
        assert flow._nombre_puente(p) == nb          # rehacer la producción: el mismo
    with pytest.raises(db.NombreAjeno):              # lo que haría producir_task
        db.guardar_proyecto_editor("beto", "gen-abcd1234", "{}")
    db.guardar_proyecto_editor("beto", nb, "{}")


def test_puente_local_no_toca_la_base(monkeypatch):
    from pipeline import flow
    monkeypatch.setattr(db, "backend", lambda: "json")

    def prohibido(*a, **k):
        raise AssertionError("en local no hay Aurora")
    monkeypatch.setattr(db, "ejecutar", prohibido)
    assert flow._nombre_puente(SimpleNamespace(id="abcd1234")) == "gen-abcd1234"
