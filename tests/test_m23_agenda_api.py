"""M23 C3 · Agenda — el router /api/agenda (paso 3 de 3).

Lo que no puede pasar, y por eso se fija aquí:
  * que cancelar borre algo sin confirmar:true, o que borre antes de leer (la
    mediaUrl solo existe mientras el schedule existe);
  * que el PATCH lleve un `draft`: no hace merge y dejaría la publicación sin
    video, y el usuario no se entera hasta que sale;
  * que una fecha imposible o un id inventado gasten una de las 60 llamadas por
    minuto que Blotato le da al usuario;
  * que los tres estados de la clave se mezclen (sin clave 409, almacén caído
    503, clave rechazada → error + reconectar);
  * que un Blotato caído tumbe la pantalla entera en vez de dejarla vacía con
    su aviso;
  * que cancelar pise un registro que el worker todavía está trabajando.

Los dobles se reusan tal cual: el httpx simulado de las pruebas del cliente y
el S3 falso de C2. Tener dos copias dejaría dos verdades. pytest ya pone
tests/ en sys.path, así que el import es directo, y los cuatro fixtures autouse
de conftest garantizan que nada de esto sale a la red ni toca la cuenta real.
"""
import threading
import time
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from fastapi.testclient import TestClient

from pipeline import blotato, claves_usuario, publicaciones
from server import agenda_api, publicar_api

from test_m23_agenda_blotato import HTTPFalso, ITEM, SCH   # dobles del cliente
from test_m23_publicar_nube import (  # noqa: F401 — fixtures de C2, reusadas
    USER as USER_S3, en_s3, s3)

USER = "u1"
CLAVE = "blt_clave-de-agenda=="
MEDIA = ITEM["draft"]["content"]["mediaUrls"][0]


# ---------------------------------------------------------------------------
# arnés

@pytest.fixture
def http(monkeypatch):
    """httpx con las firmas reales de /v2/schedules (get con params=, patch con
    json=, delete sin cuerpo) y respuestas 204 vacías."""
    falso = HTTPFalso()
    for verbo in ("get", "patch", "delete"):
        monkeypatch.setattr(blotato.httpx, verbo, getattr(falso, verbo))
    return falso


@pytest.fixture
def cliente(monkeypatch):
    """Sin clave de Blotato todavía: es el estado de quien no la ha conectado."""
    monkeypatch.setenv("DEFAULT_USER_ID", USER)
    from server.app import app
    return TestClient(app, raise_server_exceptions=False)


@pytest.fixture
def conectado(cliente):
    claves_usuario.guardar(USER, blotato.NOMBRE, CLAVE)
    return cliente


@pytest.fixture
def con_registro(monkeypatch, en_s3):
    """El usuario de C2 con su S3 falso: para lo que además escribe nuestro
    registro. Va aparte porque el registro vive en la rama de la nube."""
    monkeypatch.setenv("DEFAULT_USER_ID", USER_S3)
    claves_usuario.guardar(USER_S3, blotato.NOMBRE, CLAVE)
    from server.app import app
    cliente = TestClient(app, raise_server_exceptions=False)
    cliente.s3 = en_s3
    return cliente


def _error(codigo: int, cuerpo: dict | None = None) -> httpx.HTTPStatusError:
    """Un fallo de Blotato cuyo texto lleva la clave: si el mensaje al usuario
    la repite, se ve en la aserción."""
    req = httpx.Request("GET", f"{blotato.BASE}/schedules")
    resp = httpx.Response(codigo, json=cuerpo or {}, request=req)
    return httpx.HTTPStatusError(f"boom {CLAVE}", request=req, response=resp)


def _futuro(**delta) -> str:
    return (datetime.now(timezone.utc) + timedelta(**delta)).isoformat()


def _mensaje(codigo: int, contexto: str) -> str:
    """El texto que la pantalla verá, sacado de donde vive de verdad: la Agenda
    no inventa mensajes."""
    return blotato.explicar_fallo(_error(codigo), CLAVE, contexto=contexto)[0]


# ---------------------------------------------------------------------------
# la clave: tres estados distintos que nunca se mezclan

def test_sin_clave_la_agenda_pide_conectar_y_no_llama_a_blotato(cliente, http):
    r = cliente.get("/api/agenda")
    assert r.status_code == 409
    assert "Conecta tu cuenta de Blotato primero" in r.json()["detail"]
    assert http.llamadas == []


def test_si_el_almacen_se_cae_no_es_lo_mismo_que_no_estar_conectado(conectado, http,
                                                                    monkeypatch):
    def caido(user):
        raise claves_usuario.ErrorAlmacen("SSM no responde")

    monkeypatch.setattr(blotato, "clave_de", caido)
    r = conectado.get("/api/agenda")
    assert r.status_code == 503 and r.json()["detail"] == publicar_api.ERROR_ALMACEN
    assert http.llamadas == []


@pytest.mark.parametrize("codigo", [401, 403])
def test_una_clave_rechazada_no_tumba_la_pantalla_pero_pide_reconectar(conectado, http,
                                                                       codigo):
    http.errores["GET"] = _error(codigo)
    r = conectado.get("/api/agenda")
    d = r.json()
    assert r.status_code == 200 and d["items"] == [] and d["reconectar"] is True
    assert "conéctala de nuevo" in d["error"] and CLAVE not in d["error"]


@pytest.mark.parametrize("codigo", [401, 403])
@pytest.mark.parametrize("ruta, cuerpo", [("reprogramar", {}), ("cancelar", {"confirmar": True})])
def test_una_clave_revocada_ofrece_reconectar_tambien_al_reprogramar_y_cancelar(
        conectado, http, codigo, ruta, cuerpo):
    """El 409 es lo ÚNICO con lo que la pantalla ofrece el enlace para conectar.
    Con un 502 el usuario leía «conéctala de nuevo» sin dónde hacerlo."""
    http.respuestas["GET"] = (200, {"schedule": ITEM})
    http.errores["PATCH"] = http.errores["DELETE"] = _error(codigo)
    r = conectado.post(f"/api/agenda/{ruta}",
                       json={"id": SCH, "cuando": _futuro(days=1), **cuerpo})
    assert r.status_code == 409
    assert r.json()["detail"] == _mensaje(codigo, ruta)
    assert "conéctala de nuevo" in r.json()["detail"] and CLAVE not in r.json()["detail"]


def test_el_409_de_sin_clave_y_el_de_clave_rechazada_se_distinguen_por_el_mensaje(cliente,
                                                                                   http):
    """Los dos son 409 —los dos se arreglan conectando la cuenta— y lo que los
    distingue es el texto, no el código: uno dice dónde conectarla por primera
    vez y el otro que Blotato dejó de aceptar la que ya había."""
    sin_clave = cliente.post("/api/agenda/cancelar", json={"id": SCH, "confirmar": True})
    assert sin_clave.status_code == 409 and http.llamadas == []   # ni una llamada
    claves_usuario.guardar(USER, blotato.NOMBRE, CLAVE)
    http.respuestas["GET"] = (200, {"schedule": ITEM})
    http.errores["DELETE"] = _error(401)
    rechazada = cliente.post("/api/agenda/cancelar", json={"id": SCH, "confirmar": True})
    assert rechazada.status_code == 409
    assert "Conecta tu cuenta de Blotato primero" in sin_clave.json()["detail"]
    assert rechazada.json()["detail"] == _mensaje(401, "cancelar")
    assert sin_clave.json()["detail"] != rechazada.json()["detail"]


@pytest.mark.parametrize("ruta, cuerpo", [
    ("/api/agenda/reprogramar", {"id": SCH, "cuando": None}),
    ("/api/agenda/cancelar", {"id": SCH, "confirmar": True}),
])
def test_los_tres_endpoints_exigen_una_cuenta_identificable(cliente, http, monkeypatch,
                                                            ruta, cuerpo):
    monkeypatch.setenv("DEFAULT_USER_ID", "../otro")
    assert cliente.get("/api/agenda").status_code == 400
    assert cliente.post(ruta, json=cuerpo).status_code == 400
    assert http.llamadas == []


def test_la_agenda_exige_login_en_el_servicio():
    from server import auth
    assert "/api/agenda".startswith(auth.PREFIJOS_PROTEGIDOS)
    assert "/api/agenda" not in auth.RUTAS_PUBLICAS


# ---------------------------------------------------------------------------
# GET /api/agenda

def test_listar_pide_una_pagina_con_la_clave_del_usuario(conectado, http):
    http.respuestas["GET"] = (200, {"items": [ITEM], "cursor": "c2", "count": "12"})
    d = conectado.get("/api/agenda").json()
    [llamada] = http.llamadas
    assert llamada.url == f"{blotato.BASE}/schedules"
    assert llamada.headers == {"blotato-api-key": CLAVE}
    assert llamada.params == {"limit": 20}          # sin cursor: es la primera página
    assert d["cursor"] == "c2" and d["error"] is None and d["reconectar"] is False
    # count llega como STRING y la pantalla necesita un número para el plural
    assert d["total"] == 12 and isinstance(d["total"], int)


def test_el_cursor_va_y_vuelve_para_que_ver_mas_funcione(conectado, http):
    http.respuestas["GET"] = (200, {"items": [], "cursor": None})
    d = conectado.get("/api/agenda", params={"cursor": "c2"}).json()
    assert http.llamadas[0].params == {"limit": 20, "cursor": "c2"}
    assert d["cursor"] is None and d["total"] is None


def test_los_items_salen_normalizados_y_sin_una_sola_url_de_blotato(conectado, http):
    largo = dict(ITEM, draft={"content": dict(ITEM["draft"]["content"], text="x" * 500)})
    http.respuestas["GET"] = (200, {"items": [largo]})
    [item] = conectado.get("/api/agenda").json()["items"]
    assert set(item) == {"id", "cuando", "plataforma", "red", "cuenta_nombre",
                         "destino", "texto", "cortado", "medios"}
    assert item["id"] == SCH and item["red"] == "TikTok" and item["cuenta_nombre"] == "Ana"
    assert item["texto"] == "x" * 200 and item["cortado"] is True and item["medios"] == 1
    assert "blotato.com" not in repr(item)     # ni la del video ni la del avatar


def test_la_lista_dice_a_que_pagina_va_cada_publicacion(conectado, http):
    """Dos publicaciones de la MISMA cuenta a DOS páginas de Facebook salían
    idénticas: el usuario podía cancelar la equivocada, y eso no se deshace."""
    cuenta = {"id": "11", "name": "Mi Marca"}
    pagina = {**ITEM, "account": {**cuenta, "subaccountName": "Tienda"}}
    otra = {**ITEM, "account": {**cuenta, "subaccountId": 1110000001}}
    http.respuestas["GET"] = (200, {"items": [pagina, otra]})
    uno, dos = conectado.get("/api/agenda").json()["items"]
    # y el id opaco llega ya etiquetado: resolverlo costaría una llamada por fila
    assert (uno["destino"], dos["destino"]) == ("Tienda", "Página 1110000001")
    assert len(http.llamadas) == 1


def test_una_cuenta_nula_o_una_red_que_no_es_nuestra_no_tumban_la_pantalla(conectado, http):
    raro = {"id": "sch_2", "scheduledAt": "2026-09-21T10:00:00Z", "account": None,
            "draft": {"content": {"platform": "mastodon", "text": "hola"}}}
    http.respuestas["GET"] = (200, {"items": [raro]})
    r = conectado.get("/api/agenda")
    [item] = r.json()["items"]
    assert r.status_code == 200
    assert item["cuenta_nombre"] == "" and item["red"] == "mastodon" and item["medios"] == 0


def test_si_blotato_se_cae_la_agenda_se_pinta_vacia_con_el_motivo(conectado, http):
    http.errores["GET"] = _error(500)
    r = conectado.get("/api/agenda")
    d = r.json()
    # un 502 aquí dejaría al usuario sin pantalla que refrescar
    assert r.status_code == 200
    assert d == {"items": [], "cursor": None, "total": None,
                 "error": _mensaje(500, "agenda"), "reconectar": False}


def test_el_429_de_la_agenda_no_habla_de_publicar(conectado, http):
    http.errores["GET"] = _error(429)
    error = conectado.get("/api/agenda").json()["error"]
    assert error == _mensaje(429, "agenda")
    assert "volver a consultar" in error and "publicar otra vez" not in error


def test_si_blotato_tarda_demasiado_es_un_no_respondio(conectado, http, monkeypatch):
    """Con el _con_tope DE VERDAD y un Blotato que no contesta: la pantalla se
    pinta vacía con «no respondió» en vez de colgarse hasta que la Lambda corte.

    (Sustituir _con_tope por un lambda que lanza TimeoutError reemplazaría justo
    la pieza que se quiere probar.)"""
    monkeypatch.setattr(agenda_api, "TOPE_S", 0.2)
    lenta, sigue = blotato.httpx.get, threading.Event()
    monkeypatch.setattr(blotato.httpx, "get",
                        lambda *a, **k: (sigue.wait(10), lenta(*a, **k))[1])
    try:
        t0 = time.monotonic()
        d = conectado.get("/api/agenda").json()
        tardo = time.monotonic() - t0
    finally:
        sigue.set()               # que el hilo del tope no se quede esperando
    assert tardo < 5, "no cortó: esperó a Blotato"
    assert d["items"] == []
    assert d["error"] == "Blotato no respondió. Intenta de nuevo en un momento."
    assert d["error"] == blotato.explicar_fallo(TimeoutError(), CLAVE, contexto="agenda")[0]


def test_los_tres_endpoints_pasan_por_el_tope(conectado, http, monkeypatch):
    """Sin _con_tope, los 8 s POR FASE de httpx pueden sumar más que los 29 s de
    la Lambda y la pantalla recibe un 502 mudo en vez de un aviso."""
    real, topes = publicar_api._con_tope, []

    def espia(fn, segundos):
        topes.append(segundos)
        return real(fn, segundos)

    monkeypatch.setattr(agenda_api, "_con_tope", espia)
    http.respuestas["GET"] = (200, {"items": [ITEM], "schedule": ITEM})
    assert conectado.get("/api/agenda").status_code == 200
    assert topes == [agenda_api.TOPE_S], "listar no pasó por el tope"
    r = conectado.post("/api/agenda/reprogramar", json={"id": SCH, "cuando": _futuro(days=1)})
    assert r.status_code == 200 and http.metodos == ["GET", "GET", "PATCH"]
    assert conectado.post("/api/agenda/cancelar",
                          json={"id": SCH, "confirmar": True}).status_code == 200
    # 1 al listar + 2 al reprogramar (GET y PATCH) + 2 al cancelar (GET y DELETE)
    assert topes == [agenda_api.TOPE_S] * 5
    assert http.metodos == ["GET", "GET", "PATCH", "GET", "DELETE"]


def test_el_peor_caso_de_dos_llamadas_cabe_en_la_lambda():
    """Reprogramar y cancelar gastan DOS llamadas: el GET del schedule y el
    PATCH/DELETE. Si el par no cabe en los 29 s, la pantalla recibe un 502 mudo
    justo cuando el usuario cancela algo."""
    assert agenda_api.LAMBDA_S == 29.0
    assert 2 * agenda_api.TOPE_S <= agenda_api.LAMBDA_S - 10   # margen de sobra
    # y el tope deja pasar una fase completa de TIMEOUT_CORTO (8 s)
    assert agenda_api.TOPE_S > blotato.TIMEOUT_CORTO.read


@pytest.mark.parametrize("cursor", ["", "x" * 513])
def test_un_cursor_invalido_se_contesta_en_espanol_y_sin_salir_a_la_red(conectado, http,
                                                                        cursor):
    r = conectado.get("/api/agenda", params={"cursor": cursor})
    assert r.status_code == 422 and r.json()["detail"] == agenda_api.CURSOR_MALO
    assert http.llamadas == []


# ---------------------------------------------------------------------------
# POST /api/agenda/reprogramar

def test_reprogramar_manda_la_hora_y_jamas_un_draft(conectado, http):
    http.respuestas["GET"] = (200, {"schedule": ITEM})
    cuando = _futuro(days=2)
    r = conectado.post("/api/agenda/reprogramar", json={"id": SCH, "cuando": cuando})
    # el GET va antes, como en cancelar: la mediaUrl es lo único que empareja
    # esto con nuestro registro
    assert http.metodos == ["GET", "PATCH"]
    llamada = http.llamadas[1]
    assert r.status_code == 200
    assert llamada.url == f"{blotato.BASE}/schedules/{SCH}"
    # un draft parcial BORRA mediaUrls y target: la publicación saldría sin video
    assert llamada.json == {"patch": {"scheduledTime": r.json()["cuando"]}}
    assert "draft" not in llamada.json["patch"]
    assert r.json()["id"] == SCH


def test_la_hora_que_viaja_es_la_normalizada_en_utc(conectado, http):
    # el usuario manda su zona; Blotato recibe UTC al segundo
    cuando = (datetime.now(timezone.utc) + timedelta(days=3)).astimezone(
        timezone(timedelta(hours=-6))).isoformat()
    d = conectado.post("/api/agenda/reprogramar", json={"id": SCH, "cuando": cuando}).json()
    esperado = publicar_api._cuando(cuando, sugerencia="")
    assert d["cuando"] == esperado and esperado.endswith("+00:00")
    assert http.llamadas[-1].json["patch"]["scheduledTime"] == esperado


def test_el_204_sin_cuerpo_no_se_lee_como_respuesta_invalida(conectado, http):
    http.respuestas["PATCH"] = (204, None)        # Blotato no manda cuerpo
    r = conectado.post("/api/agenda/reprogramar", json={"id": SCH, "cuando": _futuro(days=1)})
    assert r.status_code == 200


@pytest.mark.parametrize("cuando, trozo", [
    (None, "Elige la fecha y hora nueva."),
    ("", "Elige la fecha y hora nueva."),
    ("mañana por la tarde", "No entendimos la fecha"),
    ("2026-09-20T15:04:00", "No entendimos la fecha"),          # sin zona horaria
    ("2020-01-01T00:00:00+00:00", "Esa hora ya pasó"),
])
def test_una_fecha_que_no_sirve_no_gasta_una_llamada_a_blotato(conectado, http,
                                                               cuando, trozo):
    r = conectado.post("/api/agenda/reprogramar", json={"id": SCH, "cuando": cuando})
    assert r.status_code == 422 and trozo in r.json()["detail"]
    assert http.llamadas == []


def test_blotato_solo_programa_nueve_meses_adelante(conectado, http):
    r = conectado.post("/api/agenda/reprogramar",
                       json={"id": SCH, "cuando": _futuro(days=300)})
    assert r.status_code == 422 and "9 meses" in r.json()["detail"]
    assert http.llamadas == []


def test_en_la_agenda_no_se_ofrece_publicar_ahora_porque_ese_boton_no_existe(conectado, http):
    pasada = "2020-01-01T00:00:00+00:00"
    detalle = conectado.post("/api/agenda/reprogramar",
                             json={"id": SCH, "cuando": pasada}).json()["detail"]
    assert "Publicar ahora" not in detalle
    assert detalle == "Esa hora ya pasó o falta menos de un minuto. Elige una más adelante."
    # y en Publicar, donde el botón sí existe, el texto sigue igual que en C2
    with pytest.raises(Exception) as e:
        publicar_api._cuando(pasada)
    assert "o usa «Publicar ahora»." in e.value.detail


def test_un_422_de_blotato_al_reprogramar_habla_de_la_hora(conectado, http):
    queja = {"message": "scheduledTime must be in the future"}
    http.errores["PATCH"] = _error(422, queja)
    r = conectado.post("/api/agenda/reprogramar", json={"id": SCH, "cuando": _futuro(days=1)})
    detalle = r.json()["detail"]
    assert r.status_code == 502
    assert detalle == blotato.explicar_fallo(_error(422, queja), CLAVE,
                                             contexto="reprogramar")[0]
    # habla de la hora, no de «la publicación»: es lo único que se cambió
    assert "la hora nueva" in detalle and queja["message"] in detalle
    assert CLAVE not in detalle


def test_reprogramar_algo_que_ya_no_esta_programado_es_un_404_no_un_502(conectado, http):
    http.respuestas["GET"] = (200, {"schedule": ITEM})
    http.errores["PATCH"] = _error(404)
    r = conectado.post("/api/agenda/reprogramar", json={"id": SCH, "cuando": _futuro(days=1)})
    assert r.status_code == 404
    assert r.json()["detail"] == _mensaje(404, "reprogramar")
    assert "ya no está programada" in r.json()["detail"]


def test_un_404_al_leer_no_reprograma_nada(conectado, http):
    """Igual que en cancelar: si ya no está, no hay hora que cambiarle y el
    PATCH a ciegas solo gastaría una llamada para volver con el mismo 404."""
    http.errores["GET"] = _error(404)
    r = conectado.post("/api/agenda/reprogramar", json={"id": SCH, "cuando": _futuro(days=1)})
    assert r.status_code == 404 and http.metodos == ["GET"]
    assert r.json()["detail"] == _mensaje(404, "reprogramar")


def test_si_no_pudimos_leerla_se_reprograma_igual_y_solo_se_pierde_nuestra_hora(con_registro,
                                                                                http):
    http.errores["GET"] = _error(500)
    reg = _programada()
    r = con_registro.post("/api/agenda/reprogramar",
                          json={"id": SCH, "cuando": _futuro(days=1)})
    assert r.status_code == 200 and http.metodos == ["GET", "PATCH"]
    assert r.json()["nuestra"] is False
    guardado, _ = publicaciones.leer(USER_S3, "gen-abc", reg["id"])
    assert guardado["cuando"] == reg["cuando"]


def test_reprogramar_deja_nuestra_hora_al_dia_para_que_publicar_no_mienta(con_registro, http):
    """Sin esto el modal de Publicar enseña la hora vieja durante horas y, al
    pasarla, llega a decir «Enviando…» de algo que no sale hasta mañana."""
    http.respuestas["GET"] = (200, {"schedule": ITEM})
    reg = _programada(cuando=_futuro(minutes=2))
    d = con_registro.post("/api/agenda/reprogramar",
                          json={"id": SCH, "cuando": _futuro(days=1)}).json()
    assert http.metodos == ["GET", "PATCH"] and d["nuestra"] is True
    guardado, _ = publicaciones.leer(USER_S3, "gen-abc", reg["id"])
    assert guardado["cuando"] == d["cuando"] != reg["cuando"]
    vista = publicaciones.vista(guardado)
    assert vista["estado"] == "programado" and vista["cuando"] == d["cuando"]


def test_la_hora_nueva_se_guarda_despues_del_patch_y_nunca_si_falla(con_registro, http):
    """Guardarla antes la haría «saltar» hacia atrás al refrescar si el PATCH
    no llega a pasar."""
    http.respuestas["GET"] = (200, {"schedule": ITEM})
    http.errores["PATCH"] = _error(500)
    reg = _programada()
    r = con_registro.post("/api/agenda/reprogramar",
                          json={"id": SCH, "cuando": _futuro(days=1)})
    assert r.status_code == 502
    guardado, _ = publicaciones.leer(USER_S3, "gen-abc", reg["id"])
    assert guardado["cuando"] == reg["cuando"]


@pytest.mark.parametrize("estado", [*publicaciones.TRABAJANDO, "publicado", "error"])
def test_reprogramar_tampoco_toca_un_registro_que_no_esta_programado(con_registro, http,
                                                                     estado):
    http.respuestas["GET"] = (200, {"schedule": ITEM})
    reg = _programada(estado)
    antes = publicaciones.leer(USER_S3, "gen-abc", reg["id"])[0]["actualizado"]
    d = con_registro.post("/api/agenda/reprogramar",
                          json={"id": SCH, "cuando": _futuro(days=1)}).json()
    guardado, _ = publicaciones.leer(USER_S3, "gen-abc", reg["id"])
    assert d["nuestra"] is False
    assert guardado["cuando"] == reg["cuando"] and guardado["actualizado"] == antes


# ---------------------------------------------------------------------------
# POST /api/agenda/cancelar — el gate

@pytest.mark.parametrize("cuerpo", [{"id": SCH}, {"id": SCH, "confirmar": False}])
def test_cancelar_sin_confirmar_no_toca_nada_de_nadie(conectado, http, cuerpo):
    r = conectado.post("/api/agenda/cancelar", json=cuerpo)
    assert r.status_code == 428 and "confirmar:true" in r.json()["detail"]
    assert http.llamadas == []


def test_el_gate_va_antes_incluso_de_mirar_la_clave(cliente, http):
    # sin clave configurada: el 428 manda, no el 409
    r = cliente.post("/api/agenda/cancelar", json={"id": SCH})
    assert r.status_code == 428 and http.llamadas == []


# ---------------------------------------------------------------------------
# POST /api/agenda/cancelar — el orden de las llamadas

def test_cancelar_lee_antes_de_borrar_y_borra_una_sola_vez(conectado, http):
    http.respuestas["GET"] = (200, {"schedule": ITEM})
    r = conectado.post("/api/agenda/cancelar", json={"id": SCH, "confirmar": True})
    # el GET va primero: después del DELETE ya no hay de dónde sacar la mediaUrl
    assert http.metodos == ["GET", "DELETE"]
    assert http.llamadas[0].url == f"{blotato.BASE}/schedules/{SCH}"
    assert http.llamadas[1].url == f"{blotato.BASE}/schedules/{SCH}"
    assert r.json() == {"id": SCH, "cancelado": True, "nuestra": False}


def test_un_404_al_leer_no_borra_nada(conectado, http):
    http.errores["GET"] = _error(404)
    r = conectado.post("/api/agenda/cancelar", json={"id": SCH, "confirmar": True})
    assert r.status_code == 404 and http.metodos == ["GET"]
    assert r.json()["detail"] == _mensaje(404, "cancelar")
    assert "ya no estaba programada" in r.json()["detail"]


def test_si_no_pudimos_leerla_se_cancela_igual_y_solo_se_pierde_el_enlace(conectado, http):
    http.errores["GET"] = _error(500)
    r = conectado.post("/api/agenda/cancelar", json={"id": SCH, "confirmar": True})
    assert r.status_code == 200 and http.metodos == ["GET", "DELETE"]
    assert r.json()["nuestra"] is False


def test_si_el_delete_falla_la_cancelacion_no_se_da_por_hecha(conectado, http):
    http.respuestas["GET"] = (200, {"schedule": ITEM})
    http.errores["DELETE"] = _error(500)
    r = conectado.post("/api/agenda/cancelar", json={"id": SCH, "confirmar": True})
    assert r.status_code == 502 and r.json()["detail"] == _mensaje(500, "cancelar")


def test_cancelar_algo_que_ya_no_esta_es_un_404_con_su_propio_mensaje(conectado, http):
    http.respuestas["GET"] = (200, {"schedule": ITEM})
    http.errores["DELETE"] = _error(404)
    r = conectado.post("/api/agenda/cancelar", json={"id": SCH, "confirmar": True})
    assert r.status_code == 404 and r.json()["detail"] == _mensaje(404, "cancelar")


# ---------------------------------------------------------------------------
# POST /api/agenda/cancelar — lo que además escribe de nuestro lado

def _programada(estado: str = "programado", **extra) -> dict:
    reg = publicaciones.crear(USER_S3, "gen-abc", {
        "plataforma": "tiktok", "cuenta_id": "98432", "texto": "Hola",
        "archivo": "pelicula", "post_id": "post-1", "media_url": MEDIA,
        "cuando": _futuro(days=1), **extra})
    reg["estado"] = estado
    publicaciones.guardar(USER_S3, "gen-abc", reg)
    publicaciones.enlazar(USER_S3, "gen-abc", reg["id"], MEDIA)
    return reg


def test_cancelar_deja_nuestro_registro_en_cancelado(con_registro, http):
    http.respuestas["GET"] = (200, {"schedule": ITEM})
    reg = _programada()
    d = con_registro.post("/api/agenda/cancelar",
                          json={"id": SCH, "confirmar": True}).json()
    assert d["nuestra"] is True
    guardado, _ = publicaciones.leer(USER_S3, "gen-abc", reg["id"])
    assert guardado["estado"] == "cancelado"
    vista = publicaciones.vista(guardado)
    # la fila se sigue viendo en Publicar, ya no está en curso y el candado quedó
    # libre: cancelé para volver a programarlo
    assert vista["mensaje"] == publicaciones.MENSAJES["cancelado"]
    assert vista["en_curso"] is False and vista["revisar"] is False


def test_una_publicacion_sin_enlace_se_cancela_igual_pero_no_es_nuestra(con_registro, http):
    """Las anteriores a C3 nunca guardaron su publicUrl y no se puede
    reconstruir; igual que si el usuario cancela dentro de blotato.com."""
    http.respuestas["GET"] = (200, {"schedule": ITEM})
    d = con_registro.post("/api/agenda/cancelar",
                          json={"id": SCH, "confirmar": True}).json()
    assert d == {"id": SCH, "cancelado": True, "nuestra": False}


def test_un_schedule_sin_video_no_manda_a_buscar_ningun_enlace(con_registro, http,
                                                               monkeypatch):
    http.respuestas["GET"] = (200, {"schedule": {"id": SCH, "draft": {"content": {}}}})
    monkeypatch.setattr(publicaciones, "enlace",
                        lambda *a: pytest.fail("no hay media_url que buscar"))
    d = con_registro.post("/api/agenda/cancelar",
                          json={"id": SCH, "confirmar": True}).json()
    assert d["cancelado"] is True and d["nuestra"] is False


@pytest.mark.parametrize("estado", publicaciones.TRABAJANDO)
def test_una_publicacion_que_el_worker_esta_trabajando_no_se_toca(con_registro, http,
                                                                  estado):
    """guardar() pisa reg['actualizado'] SIEMPRE, y vista() mide 'subiendo' y
    'creando' contra ese campo: escribirla le regalaría 20 minutos de vida al
    worker, que podría publicar algo que el usuario ya canceló."""
    http.respuestas["GET"] = (200, {"schedule": ITEM})
    reg = _programada(estado)
    antes = publicaciones.leer(USER_S3, "gen-abc", reg["id"])[0]["actualizado"]
    d = con_registro.post("/api/agenda/cancelar",
                          json={"id": SCH, "confirmar": True}).json()
    guardado, _ = publicaciones.leer(USER_S3, "gen-abc", reg["id"])
    assert d["nuestra"] is False
    assert guardado["estado"] == estado and guardado["actualizado"] == antes


def test_un_estado_degradado_no_se_marca_como_cancelado(con_registro, http, monkeypatch):
    """En disco sigue diciendo 'creando' lo que la pantalla enseña como
    'incierto': por eso se mira vista(reg)['estado'], nunca reg['estado']."""
    http.respuestas["GET"] = (200, {"schedule": ITEM})
    reg = _programada("creando")
    viejo = reg["actualizado"] + publicaciones.VENCE_TRABAJO_S + 60
    monkeypatch.setattr(publicaciones, "ahora", lambda: viejo)
    guardado, _ = publicaciones.leer(USER_S3, "gen-abc", reg["id"])
    assert publicaciones.vista(guardado)["estado"] == "incierto"
    d = con_registro.post("/api/agenda/cancelar",
                          json={"id": SCH, "confirmar": True}).json()
    assert d["nuestra"] is False
    assert publicaciones.leer(USER_S3, "gen-abc", reg["id"])[0]["estado"] == "creando"


def _sch(**draft) -> dict:
    """El schedule que devuelve Blotato, con el draft retocado."""
    return {**ITEM, "draft": {**ITEM["draft"], **draft}}


CONTENIDO = ITEM["draft"]["content"]


@pytest.mark.parametrize("draft, por_que", [
    ({"content": {**CONTENIDO, "platform": "youtube"}}, "otra red"),
    ({"accountId": "otra-cuenta"}, "otra cuenta"),
    ({"accountId": 11, "content": {**CONTENIDO, "platform": "youtube"}}, "ni una ni otra"),
])
@pytest.mark.parametrize("ruta, cuerpo", [("reprogramar", {}), ("cancelar", {"confirmar": True})])
def test_un_registro_que_no_es_de_este_schedule_no_se_toca(con_registro, http, draft,
                                                           por_que, ruta, cuerpo):
    """El índice es sha256(media_url) y se creía a ciegas: si el enlace apunta a
    otra publicación, marcábamos la equivocada — y cancelar no se deshace. Se
    corrobora contra el schedule que acabamos de leer."""
    http.respuestas["GET"] = (200, {"schedule": _sch(**draft)})
    reg = _programada()
    d = con_registro.post(f"/api/agenda/{ruta}",
                          json={"id": SCH, "cuando": _futuro(days=1), **cuerpo}).json()
    assert d["nuestra"] is False, por_que
    guardado, _ = publicaciones.leer(USER_S3, "gen-abc", reg["id"])
    assert guardado["estado"] == "programado" and guardado["cuando"] == reg["cuando"]


def test_la_cuenta_coincide_aunque_blotato_mande_el_id_como_numero(con_registro, http):
    http.respuestas["GET"] = (200, {"schedule": _sch(accountId=98432)})   # nuestro: "98432"
    reg = _programada()
    d = con_registro.post("/api/agenda/cancelar",
                          json={"id": SCH, "confirmar": True}).json()
    assert d["nuestra"] is True
    assert publicaciones.leer(USER_S3, "gen-abc", reg["id"])[0]["estado"] == "cancelado"


def test_lo_que_blotato_no_manda_no_contradice_a_nuestro_registro(con_registro, http):
    """Muchos schedules llegan sin accountId: exigirlo dejaría sin actualizar
    registros perfectamente buenos."""
    assert "accountId" not in ITEM["draft"]
    http.respuestas["GET"] = (200, {"schedule": _sch(content={"platform": None,
                                                              "mediaUrls": [MEDIA]})})
    _programada()
    d = con_registro.post("/api/agenda/cancelar",
                          json={"id": SCH, "confirmar": True}).json()
    assert d["nuestra"] is True


def test_si_el_registro_no_se_puede_escribir_la_cancelacion_vale_igual(con_registro, http,
                                                                       monkeypatch):
    http.respuestas["GET"] = (200, {"schedule": ITEM})
    _programada()

    def revienta(*a, **k):
        raise RuntimeError("S3 caído")

    monkeypatch.setattr(publicaciones, "guardar", revienta)
    r = con_registro.post("/api/agenda/cancelar", json={"id": SCH, "confirmar": True})
    # en Blotato ya se canceló: un 500 aquí haría que el usuario lo reintentara
    assert r.status_code == 200 and r.json()["nuestra"] is False
    assert http.metodos == ["GET", "DELETE"]


def test_dos_cancelaciones_de_lo_mismo_no_se_pisan(con_registro, http):
    http.respuestas["GET"] = (200, {"schedule": ITEM})
    reg = _programada()
    primera = con_registro.post("/api/agenda/cancelar",
                                json={"id": SCH, "confirmar": True}).json()
    segunda = con_registro.post("/api/agenda/cancelar",
                                json={"id": SCH, "confirmar": True}).json()
    assert (primera["nuestra"], segunda["nuestra"]) == (True, False)
    assert publicaciones.leer(USER_S3, "gen-abc", reg["id"])[0]["estado"] == "cancelado"


# ---------------------------------------------------------------------------
# ids: nada que no sea un sch_… llega a la red

@pytest.mark.parametrize("malo", ["", "../../users", "sch abc", "sch/../otro", "x" * 200])
@pytest.mark.parametrize("ruta, extra", [("reprogramar", {"cuando": None}),
                                         ("cancelar", {"confirmar": True})])
def test_un_id_inventado_se_rechaza_sin_salir_a_la_red(conectado, http, malo, ruta, extra):
    cuerpo = {"id": malo, **extra}
    if ruta == "reprogramar":
        cuerpo["cuando"] = _futuro(days=1)
    r = conectado.post(f"/api/agenda/{ruta}", json=cuerpo)
    assert r.status_code == 422 and r.json()["detail"] == agenda_api.ID_MALO
    assert http.llamadas == []


def test_el_id_se_valida_antes_que_la_clave_pero_despues_del_gate(cliente, http):
    """Orden: gate → id → clave. Un id malo se contesta igual sin conectar
    nada; el 428 sigue ganándole a todo."""
    assert cliente.post("/api/agenda/cancelar",
                        json={"id": "../x", "confirmar": True}).status_code == 422
    assert cliente.post("/api/agenda/cancelar", json={"id": "../x"}).status_code == 428
    assert http.llamadas == []


# ---------------------------------------------------------------------------
# el contrato con el resto del repo

def test_la_agenda_se_registra_antes_del_mount_de_static(cliente):
    """Después del mount de '/', StaticFiles se queda con /api/agenda y
    contesta su 404 en HTML: la pantalla vería «Unexpected token <»."""
    from server import app as modulo
    fuente = (modulo.ROOT / "server" / "app.py").read_text(encoding="utf-8")
    assert fuente.index("include_router(agenda_router)") < fuente.index('app.mount("/"')
    assert {r.path for r in agenda_api.router.routes} == {
        "/api/agenda", "/api/agenda/reprogramar", "/api/agenda/cancelar"}
    for r in (cliente.get("/api/agenda"),
              cliente.post("/api/agenda/reprogramar", json={"id": SCH}),
              cliente.post("/api/agenda/cancelar", json={"id": SCH})):
        assert r.headers["content-type"].startswith("application/json")
        assert r.status_code != 405      # la ruta existe y con su método


def test_los_llamadores_de_cuando_en_publicar_no_cambian():
    """`sugerencia` es keyword-only: los de C2 pasan un solo posicional y su
    texto queda byte-idéntico."""
    import inspect
    firma = inspect.signature(publicar_api._cuando)
    assert firma.parameters["sugerencia"].kind is inspect.Parameter.KEYWORD_ONLY
    assert firma.parameters["sugerencia"].default == " o usa «Publicar ahora»"


def test_el_router_no_expone_draft_por_ningun_lado():
    """El PATCH no hace merge: aceptar un draft desde la API pública dejaría
    publicaciones programadas sin video."""
    fuente = (agenda_api.__file__ and open(agenda_api.__file__, encoding="utf-8").read())
    cuerpo = fuente.split("class ReprogramarIn")[1]
    assert "draft=" not in cuerpo and "'draft'" not in cuerpo and '"draft"' not in cuerpo
    assert set(agenda_api.ReprogramarIn.model_fields) == {"id", "cuando"}
    assert set(agenda_api.CancelarIn.model_fields) == {"id", "confirmar"}


def test_una_pagina_de_la_agenda_cuesta_una_llamada_y_cero_lecturas_de_s3(con_registro,
                                                                          http):
    """El modal de Publicar ya gasta hasta 3 GET /posts por carga contra el
    mismo límite de 60/min, y la Lambda corta a los 29 s: la Agenda no puede
    sumar poll, ni una segunda página, ni un barrido de nuestros registros."""
    _programada()
    http.respuestas["GET"] = (200, {"items": [ITEM] * 20, "cursor": "c2"})
    con_registro.s3.puts.clear()                 # lo de arriba es el montaje
    lecturas: list[str] = []
    original = con_registro.s3.get_object
    con_registro.s3.get_object = lambda **kw: (lecturas.append(kw["Key"]), original(**kw))[1]
    d = con_registro.get("/api/agenda").json()
    assert len(http.llamadas) == 1 and len(d["items"]) == 20 and d["cursor"] == "c2"
    assert lecturas == [] and con_registro.s3.puts == []
