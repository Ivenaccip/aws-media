"""El token de Apify viaja en la cabecera Authorization y jamás aparece en
una URL, en doc.error, en los logs ni en lo que devuelve la API. Visto
2026-09-13: un perfil de estilo guardó «401 Client Error: Unauthorized for
url: …/runs?token=…» porque el token iba en la query y requests mete la URL
completa en el mensaje del HTTPError. Sin red: requests mockeado.

OJO: nada de importar pipeline/server a nivel de módulo — pipeline.config
carga el .env real en la COLECCIÓN y contaminaría el entorno de otros tests.
"""
import json
import logging
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
import requests
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# falso a propósito, y sin el largo de uno real para no disparar escáneres
TOKEN = "apify_api_PRUEBAnoEsReal0123"
URL_YT = "https://www.youtube.com/watch?v=jNQXAC9IVRw"
URL_IG = "https://www.instagram.com/reel/Cabc123XYZ_/"
RAZONES = {200: "OK", 201: "Created", 401: "Unauthorized", 403: "Forbidden"}


def _respuesta(status: int, url: str, cuerpo) -> requests.Response:
    """Un Response de verdad: raise_for_status() arma el mensaje como en
    producción, URL incluida."""
    r = requests.Response()
    r.status_code, r.reason, r.url = status, RAZONES.get(status, ""), url
    r._content = json.dumps(cuerpo).encode()
    r._content_consumed = True   # sin esto, cerrar el Response (with) truena
    r.headers["Content-Type"] = "application/json"
    return r


@pytest.fixture
def red(monkeypatch):
    """requests.post/get falsos. Cada respuesta en cola es (status, cuerpo) o
    (status, cuerpo, url): la URL por defecto es la que requests armaría con
    los params de la llamada; forzarla reproduce el cliente viejo."""
    monkeypatch.setenv("APIFY_TOKEN", TOKEN)
    from pipeline import apify
    monkeypatch.setattr(apify.time, "sleep", lambda s: None)
    llamadas, cola = [], []

    def falso(metodo):
        def pedir(url, params=None, headers=None, json=None, **kw):
            llamadas.append({"metodo": metodo, "url": url, "params": params or {},
                             "headers": headers or {}, "json": json, "kw": kw})
            status, cuerpo, *forzada = cola.pop(0)
            final = forzada[0] if forzada else \
                requests.Request(metodo, url, params=params).prepare().url
            return _respuesta(status, final, cuerpo)
        return pedir

    monkeypatch.setattr(requests, "post", falso("POST"))
    monkeypatch.setattr(requests, "get", falso("GET"))
    return SimpleNamespace(llamadas=llamadas, cola=cola)


def _runs_con_token(actor: str) -> str:
    """La URL tal cual la mandaba el cliente viejo (la del incidente)."""
    return f"https://api.apify.com/v2/acts/{actor}/runs?token={TOKEN}"


def _sin_token_en_logs(caplog) -> None:
    assert TOKEN not in caplog.text
    assert all(TOKEN not in r.getMessage() for r in caplog.records)
    # sin exc_info: un formatter imprimiría el mensaje crudo del error
    assert all(r.exc_info is None for r in caplog.records)


# ---------------------------------------------------------------------------
# el cliente

def test_correr_manda_el_token_solo_en_la_cabecera(red):
    from pipeline import apify
    red.cola += [(201, {"data": {"id": "run1", "status": "READY"}}),
                 (200, {"data": {"id": "run1", "status": "SUCCEEDED",
                                 "defaultDatasetId": "ds1"}}),
                 (200, [{"title": "x"}])]

    assert apify.correr("autor~actor", {"urls": ["u"]}) == [{"title": "x"}]

    assert [(ll["metodo"], ll["url"].rsplit("/v2", 1)[-1]) for ll in red.llamadas] == [
        ("POST", "/acts/autor~actor/runs"),
        ("GET", "/actor-runs/run1"),
        ("GET", "/datasets/ds1/items")]
    for ll in red.llamadas:
        assert ll["headers"] == {"Authorization": f"Bearer {TOKEN}"}
        assert "token" not in ll["url"].lower()
        assert not any("token" in str(k).lower() for k in ll["params"])
        resto = {k: v for k, v in ll.items() if k != "headers"}
        assert TOKEN not in repr(resto)   # ni URL, ni params, ni cuerpo
    assert red.llamadas[2]["params"] == {"clean": "true"}   # items limpios, como antes


def test_un_401_de_apify_ya_no_trae_el_token(red):
    from pipeline import apify
    red.cola.append((401, {"error": {"type": "token-not-valid"}}))
    with pytest.raises(requests.HTTPError) as exc:
        apify.correr("autor~actor", {})
    assert "401 Client Error" in str(exc.value)
    assert TOKEN not in str(exc.value)


def test_descargar_a_s3_no_manda_el_token(red):
    """La URL del KV store la escribe el actor: no se le agrega el token."""
    from pipeline import apify
    red.cola.append((403, {}))
    with pytest.raises(requests.HTTPError):
        apify.descargar_a_s3("https://api.apify.com/v2/key-value-stores/kv1/records/v.mp4",
                             "bucket-x", "videos/x.mp4")
    assert TOKEN not in repr(red.llamadas)


# ---------------------------------------------------------------------------
# el tachado

@pytest.mark.parametrize("sucio, secreto", [
    (f"401 Client Error: Unauthorized for url: {_runs_con_token('a~b')}", TOKEN),
    (f"https://api.apify.com/v2/datasets/d/items?clean=true&token={TOKEN}&format=json", TOKEN),
    ("…/runs?access_token=OtroSinPrefijo42", "OtroSinPrefijo42"),
    (f"{{'Authorization': 'Bearer {TOKEN}'}}", TOKEN),
    ("{'Authorization': 'Bearer OtroSinPrefijo42'}", "OtroSinPrefijo42"),
    (f"la clave es {TOKEN}.", TOKEN),
    (f"APIFY_API_{TOKEN[10:]}", TOKEN[10:]),
])
def test_tachar_quita_el_token(monkeypatch, sucio, secreto):
    monkeypatch.delenv("APIFY_TOKEN", raising=False)   # los patrones solos bastan
    from pipeline import apify
    limpio = apify.tachar(sucio)
    assert secreto not in limpio and apify.TACHADO in limpio


def test_tachar_cubre_tokens_sin_prefijo_y_respeta_lo_demas(monkeypatch):
    from pipeline import apify
    viejo = "SinPrefijoViejo987654"   # los tokens viejos de Apify no traen apify_api_
    monkeypatch.setenv("APIFY_TOKEN", viejo)
    assert viejo not in apify.tachar(f"se coló {viejo} en un repr")
    assert apify.tachar("?clean=true&token=otroValor&format=json") == \
        "?clean=true&token=[tachado]&format=json"
    assert apify.tachar("run abc terminó en FAILED") == "run abc terminó en FAILED"


def test_describir_error_tacha_antes_de_recortar(monkeypatch):
    """Recortar primero dejaría medio token sin prefijo, que ya no se
    reconoce: aquí el corte de 300 cae dentro del token."""
    from pipeline import apify
    viejo = "SinPrefijoViejo987654"
    monkeypatch.setenv("APIFY_TOKEN", viejo)
    texto = apify.describir_error(RuntimeError("y" * 280 + " " + viejo))
    assert len(texto) == 300 and texto.startswith("RuntimeError: ")
    assert viejo[:5] not in texto


# ---------------------------------------------------------------------------
# los workers: lo guardado y lo registrado sale tachado

def test_importar_yt_guarda_y_registra_el_error_tachado(red, monkeypatch, caplog):
    monkeypatch.setenv("MEDIA_BUCKET", "bucket-x")
    monkeypatch.setenv("DEFAULT_USER_ID", "u1")
    from pipeline import costes_infra, creditos, db
    from pipeline.config import settings
    from worker import shorts_importar

    monkeypatch.setattr(db, "cargar_proyecto_editor", lambda u, n: {
        "importar": {"estado": "descargando", "creditos": 4}})
    campos, movimientos = {}, []
    monkeypatch.setattr(db, "fijar_campo_editor",
                        lambda u, n, c, v: campos.update({c: json.loads(v)}))
    monkeypatch.setattr(costes_infra, "registrar", lambda *a: None)
    monkeypatch.setattr(creditos, "activo", lambda: True)
    monkeypatch.setattr(creditos, "devolver",
                        lambda n, ref, user=None: movimientos.append((n, ref)))
    red.cola.append((401, {}, _runs_con_token(settings.apify_yt_descarga)))
    caplog.set_level(logging.INFO)

    shorts_importar.importar("u1", "yt-abc", URL_YT)

    error = campos["importar"]["error"]
    assert campos["importar"]["estado"] == "error"
    assert TOKEN not in error
    assert error.startswith("HTTPError: 401 Client Error") and "token=[tachado]" in error
    assert movimientos == [(4, "shorts-importar:yt-abc")]
    _sin_token_en_logs(caplog)
    assert "importar de YouTube falló — HTTPError HTTP 401" in caplog.text


def test_importar_yt_tacha_el_token_de_la_url_del_actor(red, monkeypatch, caplog):
    """Si un actor devolviera la liga del archivo con ?token=…, el 403 de la
    descarga tampoco lo deja pasar."""
    monkeypatch.setenv("MEDIA_BUCKET", "bucket-x")
    monkeypatch.setenv("DEFAULT_USER_ID", "u1")
    from pipeline import costes_infra, creditos, db
    from worker import shorts_importar

    monkeypatch.setattr(db, "cargar_proyecto_editor", lambda u, n: {
        "importar": {"estado": "descargando", "creditos": 4}})
    campos = {}
    monkeypatch.setattr(db, "fijar_campo_editor",
                        lambda u, n, c, v: campos.update({c: json.loads(v)}))
    monkeypatch.setattr(costes_infra, "registrar", lambda *a: None)
    monkeypatch.setattr(creditos, "activo", lambda: False)
    kv = f"https://api.apify.com/v2/key-value-stores/kv1/records/v.mp4?token={TOKEN}"
    red.cola += [(201, {"data": {"id": "r1", "status": "SUCCEEDED",
                                 "defaultDatasetId": "ds1"}}),
                 (200, [{"savedFile": {"url": kv, "billedMb": 1}}]),
                 (403, {})]
    caplog.set_level(logging.INFO)

    shorts_importar.importar("u1", "yt-abc", URL_YT)

    error = campos["importar"]["error"]
    assert "403 Client Error" in error and TOKEN not in error
    _sin_token_en_logs(caplog)
    assert "HTTPError HTTP 403" in caplog.text


def test_transcript_fallido_no_registra_el_token(red, monkeypatch, caplog):
    from pipeline.config import settings
    from worker import shorts_importar
    red.cola.append((401, {}, _runs_con_token(settings.apify_yt_transcript)))
    caplog.set_level(logging.INFO)
    assert shorts_importar._canonico_youtube("yt-abc", URL_YT, "k.mp4", 19) is False
    _sin_token_en_logs(caplog)
    assert "sin transcript de YouTube (HTTPError HTTP 401" in caplog.text


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


def test_estilo_guarda_y_registra_el_error_tachado(red, s3, monkeypatch, caplog):
    """El caso exacto del 2026-09-13."""
    monkeypatch.setenv("DEFAULT_USER_ID", "u1")
    from pipeline import costes_infra, creditos
    from pipeline.config import settings
    from worker import estilo_analizar

    monkeypatch.setattr(costes_infra, "registrar", lambda *a, **k: None)
    movimientos = []
    monkeypatch.setattr(creditos, "activo", lambda: True)
    monkeypatch.setattr(creditos, "devolver",
                        lambda n, ref, user=None: movimientos.append((n, ref)))
    key = "usuarios/u1/estilos/ig-X.json"
    s3[key] = json.dumps({"estado": "analizando", "creditos": 3})
    red.cola.append((401, {}, _runs_con_token(settings.apify_ig)))
    caplog.set_level(logging.INFO)

    estilo_analizar.analizar("u1", "ig-X", URL_IG, "instagram")

    assert TOKEN not in s3[key]
    doc = json.loads(s3[key])
    assert doc["estado"] == "error"
    assert doc["error"].startswith("HTTPError: 401 Client Error: Unauthorized for url:")
    assert "token=[tachado]" in doc["error"]
    assert movimientos == [(3, "estilo-analizar:ig-X")]
    _sin_token_en_logs(caplog)
    assert "análisis de estilo falló — HTTPError HTTP 401" in caplog.text


# ---------------------------------------------------------------------------
# la API: ni la cotización ni los errores guardados antes muestran el token

@pytest.fixture
def cliente(monkeypatch):
    monkeypatch.delenv("COGNITO_POOL_ID", raising=False)
    monkeypatch.setenv("STATE_BACKEND", "postgres")
    monkeypatch.setenv("MEDIA_BUCKET", "bucket-de-prueba")
    monkeypatch.setenv("DEFAULT_USER_ID", "u1")
    monkeypatch.setenv("APIFY_TOKEN", TOKEN)   # nunca el del .env
    from server.app import app
    return TestClient(app)


def test_cotizar_con_apify_caido_es_502_sin_token(cliente, red, caplog):
    from pipeline.config import settings
    red.cola.append((401, {}, _runs_con_token(settings.apify_yt_info)))
    caplog.set_level(logging.INFO)
    r = cliente.post("/api/shorts/importar/cotizar", json={"url": URL_YT})
    assert r.status_code == 502   # antes: 500 con la URL en la traza
    assert TOKEN not in r.text and "token=[tachado]" in r.json()["detail"]
    _sin_token_en_logs(caplog)


def _error_viejo(token: str) -> str:
    """Como quedó guardado antes de este cambio (con otro token, ya muerto)."""
    return ("HTTPError: 401 Client Error: Unauthorized for url: "
            f"https://api.apify.com/v2/acts/apify~instagram-scraper/runs?token={token}")


def test_estilos_no_muestra_tokens_guardados_antes(cliente, s3):
    viejo = "apify_api_VIEJOnoEsReal456"
    s3["usuarios/u1/estilos/ig-V.json"] = json.dumps({
        "estado": "error", "error": _error_viejo(viejo),
        "inicio": "2026-09-13T10:00:00+00:00"})
    r = cliente.get("/api/estilo")
    assert r.status_code == 200
    assert viejo not in r.text
    assert "token=[tachado]" in r.json()["estilos"][0]["error"]


def test_shorts_no_muestra_tokens_guardados_antes(cliente, monkeypatch):
    from pipeline import db
    viejo = "SinPrefijoMuerto123"
    monkeypatch.setattr(db, "cargar_proyecto_editor", lambda u, n: {
        "importar": {"estado": "error", "error": _error_viejo(viejo)},
        "shorts": {"estado": "error", "error": _error_viejo(viejo)}})
    r = cliente.get("/api/shorts/yt-abc")
    assert r.status_code == 200
    assert viejo not in r.text
    d = r.json()
    assert "token=[tachado]" in d["importar"]["error"]
    assert "token=[tachado]" in d["shorts"]["error"]
