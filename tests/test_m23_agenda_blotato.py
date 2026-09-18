"""M23 C3 · Agenda — el cliente de Blotato para /v2/schedules (paso 1 de 3).

Lo que no puede pasar, y por eso se fija aquí:
  * que el PATCH lleve un `draft`: no hace merge, así que un draft parcial
    BORRA mediaUrls y target y deja programada una publicación sin video;
  * que el cursor o el count de la página se pierdan (40 programados, 20 a la
    vista y ni un «Ver más»);
  * que un 204 sin cuerpo se lea como respuesta inválida;
  * que un `account` nulo o una red que no está en REDES tumben una pantalla
    de solo mirar;
  * que los mensajes nuevos digan «espera antes de publicar otra vez» donde no
    se publica nada, o filtren la clave o el texto de la excepción.
Sin red: httpx va simulado con las tres firmas reales (get con params=, patch
con json=, delete sin cuerpo).
"""
import inspect
import re
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest

from pipeline import blotato

RAIZ = Path(__file__).resolve().parent.parent
CLAVE = "blt_clave-de-agenda=="
SCH = "sch_abc-123"
CUANDO = "2026-09-20T15:04:00+00:00"

ITEM = {
    "id": SCH,
    "scheduledAt": "2026-09-20T15:04:00.000Z",
    "account": {"id": "11", "name": "Ana", "username": "ana.tt",
                "profileImageUrl": "https://cdn.blotato.com/ana.jpg"},
    "draft": {"content": {"platform": "tiktok", "text": "Hola mundo",
                          "mediaUrls": ["https://media.blotato.com/v.mp4"]}},
}


# ---------------------------------------------------------------------------
# dobles

def _respuesta(metodo: str, url: str, codigo: int, cuerpo) -> httpx.Response:
    req = httpx.Request(metodo, url)
    if cuerpo is None:                       # 204: Blotato no manda cuerpo
        return httpx.Response(codigo, request=req)
    if isinstance(cuerpo, (bytes, str)):     # una página de mantenimiento
        return httpx.Response(codigo, content=cuerpo, request=req)
    return httpx.Response(codigo, json=cuerpo, request=req)


class HTTPFalso:
    """httpx simulado con las firmas que usa la Agenda, no con una fija.

    Las firmas son keyword-only a propósito: si el cliente llamara a get()
    posicional o le pasara `json=` a delete(), el doble revienta con TypeError
    en vez de dejar pasar una llamada que la API real rechazaría."""

    def __init__(self):
        self.llamadas: list[SimpleNamespace] = []
        self.respuestas = {"GET": (200, {"items": []}),
                           "PATCH": (204, None), "DELETE": (204, None)}
        self.errores: dict[str, Exception] = {}

    def _responder(self, metodo, url, **kw):
        self.llamadas.append(SimpleNamespace(metodo=metodo, url=url, **kw))
        if self.errores.get(metodo):
            raise self.errores[metodo]
        codigo, cuerpo = self.respuestas[metodo]
        return _respuesta(metodo, url, codigo, cuerpo)

    def get(self, url, *, params=None, headers=None, timeout=None):
        return self._responder("GET", url, params=params, headers=headers,
                               json=None, timeout=timeout)

    def patch(self, url, *, headers=None, json=None, timeout=None):
        return self._responder("PATCH", url, params=None, headers=headers,
                               json=json, timeout=timeout)

    def delete(self, url, *, headers=None, timeout=None):
        return self._responder("DELETE", url, params=None, headers=headers,
                               json=None, timeout=timeout)

    @property
    def metodos(self) -> list[str]:
        return [ll.metodo for ll in self.llamadas]


@pytest.fixture
def http(monkeypatch):
    falso = HTTPFalso()
    for verbo in ("get", "patch", "delete"):
        monkeypatch.setattr(blotato.httpx, verbo, getattr(falso, verbo))
    return falso


def _fallo(codigo: int, cuerpo: dict | None = None) -> httpx.HTTPStatusError:
    """Un error de Blotato cuyo texto lleva la clave: si el mensaje al usuario
    la repite, se ve."""
    req = httpx.Request("PATCH", f"{blotato.BASE}/schedules/{SCH}")
    resp = _respuesta("PATCH", str(req.url), codigo, cuerpo)
    return httpx.HTTPStatusError(f"boom {CLAVE}", request=req, response=resp)


# ---------------------------------------------------------------------------
# listar: GET /v2/schedules

def test_programados_manda_la_clave_y_pide_una_sola_pagina(http):
    http.respuestas["GET"] = (200, {"items": [ITEM], "cursor": "c2", "count": "12"})
    pagina = blotato.programados(CLAVE)
    llamada = http.llamadas[0]
    assert http.metodos == ["GET"]
    assert llamada.url == f"{blotato.BASE}/schedules"
    assert llamada.headers == {"blotato-api-key": CLAVE}
    assert llamada.params == {"limit": 20}          # sin cursor si no se pidió
    assert pagina["items"] == [ITEM] and pagina["cursor"] == "c2"
    # count llega como STRING: la pantalla necesita un int para el plural
    assert pagina["total"] == 12 and isinstance(pagina["total"], int)


def test_el_cursor_viaja_solo_cuando_se_pide(http):
    blotato.programados(CLAVE, cursor="c2", limite=5)
    assert http.llamadas[-1].params == {"limit": 5, "cursor": "c2"}


@pytest.mark.parametrize("pedido, esperado", [(0, 1), (-3, 1), (1, 1), (20, 20),
                                              (50, 50), (999, 50)])
def test_el_limite_se_acota_a_lo_que_cabe_en_una_pagina(http, pedido, esperado):
    blotato.programados(CLAVE, limite=pedido)
    assert http.llamadas[-1].params["limit"] == esperado


@pytest.mark.parametrize("datos, cursor, total", [
    ({"items": []}, None, None),
    ({"items": [], "cursor": "", "count": ""}, None, None),
    ({"items": [], "cursor": 7, "count": "doce"}, None, None),
    ({"items": [], "cursor": None, "count": None}, None, None),
    ({"items": [], "cursor": "c9", "count": 12}, "c9", 12),
    ({"items": [], "count": "0"}, None, 0),
])
def test_la_pagina_aguanta_lo_que_blotato_manda_en_cursor_y_count(http, datos, cursor, total):
    http.respuestas["GET"] = (200, datos)
    pagina = blotato.programados(CLAVE)
    assert pagina["cursor"] == cursor and pagina["total"] == total


def test_los_items_que_no_son_objetos_se_tiran(http):
    http.respuestas["GET"] = (200, {"items": [ITEM, "basura", None, 7]})
    assert blotato.programados(CLAVE)["items"] == [ITEM]


@pytest.mark.parametrize("cuerpo", [{"items": "x"}, "<html>", "[1, 2]"])
def test_una_respuesta_rara_al_listar_es_un_error_de_http(http, cuerpo):
    http.respuestas["GET"] = (200, cuerpo)
    with pytest.raises(httpx.HTTPError):
        blotato.programados(CLAVE)


@pytest.mark.parametrize("malo", ["", 7, "x" * 513, b"c2"])
def test_un_cursor_invalido_no_sale_a_la_red(http, malo):
    with pytest.raises(ValueError):
        blotato.programados(CLAVE, cursor=malo)
    assert http.llamadas == []


@pytest.mark.parametrize("codigo", [401, 404, 422, 429, 500])
def test_listar_propaga_el_error_de_blotato_sin_inventarse_una_pagina(http, codigo):
    http.respuestas["GET"] = (codigo, {"message": "no"})
    with pytest.raises(httpx.HTTPStatusError):
        blotato.programados(CLAVE)


# ---------------------------------------------------------------------------
# un schedule suelto: GET /v2/schedules/{id}

def test_programado_desenvuelve_la_respuesta(http):
    http.respuestas["GET"] = (200, {"schedule": ITEM})
    assert blotato.programado(CLAVE, SCH) == ITEM
    assert http.llamadas[0].url == f"{blotato.BASE}/schedules/{SCH}"
    assert http.llamadas[0].headers == {"blotato-api-key": CLAVE}


@pytest.mark.parametrize("cuerpo", [{}, {"schedule": None}, {"schedule": []},
                                    {"schedule": "sch_1"}, ITEM])
def test_sin_la_llave_schedule_hay_error_y_no_un_dict_vacio_en_silencio(http, cuerpo):
    # copiar estado_post() tal cual (la respuesta de /posts/{id} es plana)
    # devolvería {} sin quejarse, y la Agenda cancelaría a ciegas
    http.respuestas["GET"] = (200, cuerpo)
    with pytest.raises(blotato.RespuestaInvalida):
        blotato.programado(CLAVE, SCH)


# ---------------------------------------------------------------------------
# reprogramar: PATCH /v2/schedules/{id}

def test_el_patch_manda_exactamente_la_hora_y_jamas_un_draft(http):
    blotato.reprogramar(CLAVE, SCH, cuando=CUANDO)
    llamada = http.llamadas[0]
    assert http.metodos == ["PATCH"]
    assert llamada.url == f"{blotato.BASE}/schedules/{SCH}"
    assert llamada.headers == {"blotato-api-key": CLAVE}
    # el PATCH no hace merge: un draft parcial borraría el video y el target,
    # y el usuario no se enteraría hasta que la publicación saliera vacía
    assert llamada.json == {"patch": {"scheduledTime": CUANDO}}
    assert list(llamada.json) == ["patch"] and "draft" not in llamada.json["patch"]


def test_un_patch_sin_nada_que_cambiar_no_gasta_red(http):
    with pytest.raises(ValueError):
        blotato.reprogramar(CLAVE, SCH)
    with pytest.raises(ValueError):
        blotato.reprogramar(CLAVE, SCH, cuando="", draft={})
    assert http.llamadas == []


def test_el_draft_existe_en_el_cliente_pero_va_dentro_del_patch(http):
    # ningún endpoint lo usa; si algún día se usa, tiene que ir COMPLETO
    blotato.reprogramar(CLAVE, SCH, cuando=CUANDO, draft={"content": {"text": "x"}})
    assert http.llamadas[0].json == {"patch": {"scheduledTime": CUANDO,
                                               "draft": {"content": {"text": "x"}}}}


# ---------------------------------------------------------------------------
# cancelar: DELETE /v2/schedules/{id}

def test_cancelar_borra_una_sola_vez_y_sin_cuerpo(http):
    assert blotato.cancelar(CLAVE, SCH) is None
    assert http.metodos == ["DELETE"]
    assert http.llamadas[0].url == f"{blotato.BASE}/schedules/{SCH}"
    assert http.llamadas[0].json is None
    assert http.llamadas[0].headers == {"blotato-api-key": CLAVE}


def test_el_204_sin_cuerpo_no_es_una_respuesta_invalida(http):
    assert blotato.reprogramar(CLAVE, SCH, cuando=CUANDO) is None
    assert blotato.cancelar(CLAVE, SCH) is None
    # por qué importa: leer ese mismo 204 con _json() sí revienta
    vacia = httpx.Response(204, request=httpx.Request("DELETE", f"{blotato.BASE}/schedules/x"))
    with pytest.raises(blotato.RespuestaInvalida):
        blotato._json(vacia)


@pytest.mark.parametrize("codigo", [404, 422, 429, 500])
def test_los_fallos_del_patch_y_del_delete_se_propagan(http, codigo):
    http.respuestas["PATCH"] = http.respuestas["DELETE"] = (codigo, {"message": "no"})
    with pytest.raises(httpx.HTTPStatusError):
        blotato.reprogramar(CLAVE, SCH, cuando=CUANDO)
    with pytest.raises(httpx.HTTPStatusError):
        blotato.cancelar(CLAVE, SCH)


# ---------------------------------------------------------------------------
# lo que nunca sale a la red

@pytest.mark.parametrize("malo", ["", "../../x", "sch/../otro", "a b", "x" * 200, None])
def test_un_id_invalido_no_sale_a_la_red(http, malo):
    for llamar in (lambda: blotato.programado(CLAVE, malo),
                   lambda: blotato.reprogramar(CLAVE, malo, cuando=CUANDO),
                   lambda: blotato.cancelar(CLAVE, malo)):
        with pytest.raises(ValueError):
            llamar()
    assert http.llamadas == []


@pytest.mark.parametrize("clave", [None, "", "clave con espacio", "clavé", "x" * 513])
def test_sin_una_clave_de_verdad_no_se_habla_con_blotato(http, clave):
    for llamar in (lambda: blotato.programados(clave),
                   lambda: blotato.programado(clave, SCH),
                   lambda: blotato.reprogramar(clave, SCH, cuando=CUANDO),
                   lambda: blotato.cancelar(clave, SCH)):
        with pytest.raises(blotato.ClaveInvalida):
            llamar()
    assert http.llamadas == []


def test_las_cuatro_llamadas_usan_el_timeout_de_pantalla(http):
    # TIMEOUT_CORTO son 8 s POR FASE y la Lambda de la API corta a los 29 s
    blotato.programados(CLAVE)
    http.respuestas["GET"] = (200, {"schedule": ITEM})
    blotato.programado(CLAVE, SCH)
    blotato.reprogramar(CLAVE, SCH, cuando=CUANDO)
    blotato.cancelar(CLAVE, SCH)
    assert http.metodos == ["GET", "GET", "PATCH", "DELETE"]
    assert [ll.timeout for ll in http.llamadas] == [blotato.TIMEOUT_CORTO] * 4


# ---------------------------------------------------------------------------
# normalizar lo que enseña la pantalla

def test_media_de_saca_la_url_del_video():
    assert blotato.media_de(ITEM) == "https://media.blotato.com/v.mp4"
    assert blotato.media_de(blotato.vista_programado(ITEM)) == ""   # la vista no la lleva


@pytest.mark.parametrize("sch", [
    None, {}, {"draft": None}, {"draft": "x"}, {"draft": {"content": None}},
    {"draft": {"content": {}}},
    {"draft": {"content": {"mediaUrls": []}}},
    {"draft": {"content": {"mediaUrls": "https://x/v.mp4"}}},
    {"draft": {"content": {"mediaUrls": [None, "https://x/v.mp4"]}}},
    {"draft": {"content": {"mediaUrls": ["http://x/v.mp4"]}}},
])
def test_media_de_devuelve_vacio_cuando_no_hay_una_url_de_verdad(sch):
    assert blotato.media_de(sch) == ""


def test_vista_programado_normaliza_y_no_entrega_ninguna_url():
    vista = blotato.vista_programado(ITEM)
    assert vista == {"id": SCH, "cuando": "2026-09-20T15:04:00.000Z",
                     "plataforma": "tiktok", "red": "TikTok", "cuenta_nombre": "Ana",
                     "destino": "", "texto": "Hola mundo", "cortado": False,
                     "medios": 1}
    # la pantalla es pública: ni la foto de perfil ni el video del CDN viajan
    assert not [v for v in vista.values() if isinstance(v, str) and "http" in v]


def test_vista_programado_aguanta_account_nulo_y_una_red_que_no_es_nuestra():
    # account es NULLABLE y la lista de redes de Blotato es más larga que las 9
    # de REDES: aquí es donde la pantalla se caía con TypeError o KeyError
    item = {"id": "sch_2", "scheduledAt": "2026-10-01T00:00:00.000Z", "account": None,
            "draft": {"content": {"platform": "mastodon", "text": None, "mediaUrls": None}}}
    vista = blotato.vista_programado(item)
    assert vista["cuenta_nombre"] == "" and vista["red"] == "mastodon"
    assert vista["plataforma"] == "mastodon" and vista["texto"] == "" and vista["medios"] == 0


@pytest.mark.parametrize("cuenta, nombre", [
    ({"name": "Ana"}, "Ana"), ({"name": "", "username": "ana.tt"}, "ana.tt"),
    ({"username": "ana.tt"}, "ana.tt"), ({}, ""), ("ana", ""), (None, "")])
def test_el_nombre_de_la_cuenta_cae_al_username_y_si_no_queda_vacio(cuenta, nombre):
    assert blotato.vista_programado({**ITEM, "account": cuenta})["cuenta_nombre"] == nombre


def test_vista_programado_recorta_el_texto_y_cuenta_los_adjuntos():
    item = {**ITEM, "draft": {"content": {"platform": "youtube", "text": "a" * 500,
                                          "mediaUrls": ["https://x/1.mp4", None, 7,
                                                        "https://x/2.mp4"]}}}
    vista = blotato.vista_programado(item)
    assert vista["texto"] == "a" * 200 and vista["medios"] == 2
    assert vista["red"] == "YouTube"


@pytest.mark.parametrize("largo, cortado", [(0, False), (199, False), (200, False),
                                            (201, True), (500, True)])
def test_cortado_dice_si_el_texto_se_recorto_de_verdad(largo, cortado):
    """Con >= 200 la pantalla le ponía «…» a un texto de exactamente 200
    caracteres, que está entero: unos puntos suspensivos que mienten."""
    vista = blotato.vista_programado(
        {**ITEM, "draft": {"content": {"platform": "tiktok", "text": "a" * largo}}})
    assert vista["cortado"] is cortado
    assert vista["texto"] == "a" * min(largo, 200)


def test_un_hilo_no_suma_adjuntos_al_conteo_del_post_principal():
    """`medios` es lo que trae el post principal. El hilo (additionalPosts) trae
    los suyos y la Agenda no los enseña: sirve para reconocer y cancelar una
    publicación, no para revisarla entera."""
    item = {**ITEM, "draft": {"content": {"platform": "twitter", "text": "hilo",
                                          "mediaUrls": ["https://x/1.jpg"]},
                              "additionalPosts": [
                                  {"content": {"mediaUrls": ["https://x/2.jpg",
                                                             "https://x/3.jpg"]}}]}}
    assert blotato.vista_programado(item)["medios"] == 1


@pytest.mark.parametrize("item", [None, {}, [], "sch_1", {"draft": []}, {"account": []}])
def test_vista_programado_nunca_revienta_con_un_item_raro(item):
    vista = blotato.vista_programado(item)
    assert set(vista) == {"id", "cuando", "plataforma", "red", "cuenta_nombre",
                          "destino", "texto", "cortado", "medios"}
    assert vista["medios"] == 0 and vista["red"] == ""
    assert vista["destino"] == "" and vista["cortado"] is False


# ---------------------------------------------------------------------------
# el destino: a QUÉ página o tablero va

def _con(account=None, target=None) -> dict:
    return {**ITEM, "account": account,
            "draft": {"content": ITEM["draft"]["content"], "target": target}}


@pytest.mark.parametrize("item, destino", [
    # el nombre gana: es lo único que el usuario reconoce
    (_con(account={"subaccountName": "Mi Negocio", "subaccountId": 1110000001}),
     "Mi Negocio"),
    # un id opaco sale ya etiquetado: resolverlo costaría una llamada por fila
    (_con(account={"subaccountId": 1110000001}), "Página 1110000001"),
    (_con(account={"subId": "1110000002"}), "Página 1110000002"),
    (_con(target={"pageId": 1110000003}), "Página 1110000003"),
    (_con(target={"boardId": 987}), "Tablero 987"),
    # el orden del contrato: account antes que target
    (_con(account={"subaccountId": "11"}, target={"pageId": "22"}), "Página 11"),
    (_con(account={"subaccountName": "Ana"}, target={"boardId": "22"}), "Ana"),
])
def test_el_destino_sale_de_donde_dice_el_contrato_y_ya_etiquetado(item, destino):
    assert blotato.vista_programado(item)["destino"] == destino
    assert blotato.destino_de(item) == destino


@pytest.mark.parametrize("item", [
    ITEM,                                             # no hay destino que enseñar
    _con(account=None, target=None),                  # account es NULLABLE
    _con(account="ana", target="pagina"),             # ni dict ni nada
    _con(account={"subaccountName": ""}),
    _con(account={"subaccountName": None, "subaccountId": None}),
    _con(account={"subaccountId": True}),             # bool es int: «Página True»
    _con(target={"pageId": []}),
    {"draft": {"target": {"boardId": 0}}},            # 0 no es un tablero
])
def test_un_destino_que_no_existe_o_es_basura_queda_vacio(item):
    assert blotato.vista_programado(item)["destino"] == ""


def test_dos_paginas_de_la_misma_cuenta_ya_no_se_ven_iguales():
    """El hallazgo: dos publicaciones de la MISMA cuenta a DOS páginas de
    Facebook salían idénticas en la lista y en el «¿seguro?» de cancelar."""
    cuenta = {"id": "11", "name": "Mi Marca"}
    una = _con(account={**cuenta, "subaccountId": 1110000001})
    otra = _con(account={**cuenta, "subaccountId": 1110000002})
    assert blotato.vista_programado(una) != blotato.vista_programado(otra)
    assert blotato.vista_programado(una)["cuenta_nombre"] == "Mi Marca"


def test_el_destino_no_se_desborda_ni_trae_saltos_de_linea():
    item = _con(account={"subaccountName": " Mi\n  Negocio " + "x" * 200})
    destino = blotato.vista_programado(item)["destino"]
    assert destino.startswith("Mi Negocio x") and len(destino) == blotato.DESTINO_MAX


# ---------------------------------------------------------------------------
# identidad_de: con qué se corrobora NUESTRO registro antes de escribirlo

def test_identidad_de_saca_la_plataforma_y_la_cuenta_del_schedule():
    sch = {"draft": {"accountId": 98432, "content": {"platform": "TikTok"}}}
    assert blotato.identidad_de(sch) == ("tiktok", "98432")
    assert blotato.identidad_de({"draft": {"content": {"platform": "tiktok"}}}) == \
        ("tiktok", "")


@pytest.mark.parametrize("sch", [
    None, {}, "sch_1", {"draft": None}, {"draft": {"content": None}},
    {"draft": {"accountId": None, "content": {"platform": None}}},
    {"draft": {"accountId": True, "content": {"platform": 7}}},
])
def test_identidad_de_no_revienta_y_lo_que_no_hay_queda_vacio(sch):
    """Lo que Blotato NO manda no puede contradecir a nuestro registro: sale ""
    y quien corrobora lo trata como «no sé»."""
    assert blotato.identidad_de(sch) == ("", "")


# ---------------------------------------------------------------------------
# los mensajes: explicar_fallo(contexto=…)

@pytest.mark.parametrize("contexto, trozo", [
    ("agenda", "Esa publicación programada ya no está en Blotato"),
    ("reprogramar", "No pudimos cambiar la hora"),
    ("cancelar", "ya no estaba programada en Blotato"),
])
def test_un_404_de_la_agenda_no_dice_revisa_tu_cuenta(contexto, trozo):
    # GET /schedules solo devuelve futuros: un 404 significa «ya salió o ya no
    # existe», no que el usuario tenga que tocar nada de su cuenta
    mensaje, reconectar = blotato.explicar_fallo(_fallo(404), CLAVE, contexto=contexto)
    assert trozo in mensaje and reconectar is False
    assert CLAVE not in mensaje and "boom" not in mensaje
    # y no manda a «Actualizar la lista»: la pantalla ya recargó sola con el 404
    assert mensaje.endswith("La lista ya está al día.")
    assert "Actualiza la lista" not in mensaje


def test_el_404_de_publicar_sigue_igual():
    assert blotato.explicar_fallo(_fallo(404)) == (
        "Blotato no encontró lo que pedimos. Revisa tu cuenta de Blotato.", False)


def test_el_429_habla_de_consultar_en_la_agenda_y_de_publicar_al_publicar():
    agenda, reconectar = blotato.explicar_fallo(_fallo(429), contexto="agenda")
    assert agenda == "Blotato pide esperar un momento antes de volver a consultar."
    assert reconectar is False and "publicar otra vez" not in agenda
    for contexto in ("reprogramar", "cancelar"):
        mensaje, _ = blotato.explicar_fallo(_fallo(429), contexto=contexto)
        assert mensaje == "Blotato pide esperar un momento antes de intentarlo otra vez."
        assert "publicar" not in mensaje
    assert blotato.explicar_fallo(_fallo(429))[0] == (
        "Blotato pide esperar antes de publicar otra vez.")


def test_el_429_conserva_el_detalle_de_blotato_sin_la_clave():
    mensaje, _ = blotato.explicar_fallo(_fallo(429, {"message": f"60 por minuto {CLAVE}"}),
                                        CLAVE, contexto="agenda")
    assert mensaje == ("Blotato pide esperar un momento antes de volver a consultar: "
                       "60 por minuto ***")


def test_un_422_al_reprogramar_habla_de_la_hora_y_no_de_la_publicacion():
    mensaje, reconectar = blotato.explicar_fallo(_fallo(422), contexto="reprogramar")
    assert mensaje == ("Blotato no aceptó la hora nueva. Elige una fecha futura e "
                       "intenta de nuevo.") and reconectar is False
    con_detalle, _ = blotato.explicar_fallo(_fallo(422, {"message": "scheduledTime: past"}),
                                            CLAVE, contexto="reprogramar")
    assert con_detalle == "Blotato no aceptó la hora nueva: scheduledTime: past"
    # publicar no cambia
    assert blotato.explicar_fallo(_fallo(422))[0].startswith("Blotato no aceptó la publicación")
    assert blotato.explicar_fallo(_fallo(422), contexto="agenda")[0].startswith(
        "Blotato no aceptó la publicación")


@pytest.mark.parametrize("contexto", blotato.CONTEXTOS)
@pytest.mark.parametrize("codigo", [401, 403])
def test_una_clave_rechazada_pide_reconectar_en_todos_los_contextos(codigo, contexto):
    mensaje, reconectar = blotato.explicar_fallo(_fallo(codigo), CLAVE, contexto=contexto)
    assert reconectar is True and "conéctala de nuevo" in mensaje.lower()


@pytest.mark.parametrize("contexto", blotato.CONTEXTOS)
@pytest.mark.parametrize("codigo", [401, 403, 404, 422, 429, 500])
def test_ningun_mensaje_nuevo_repite_la_clave_ni_la_excepcion(codigo, contexto):
    mensaje, _ = blotato.explicar_fallo(_fallo(codigo, {"message": f"detalle {CLAVE}"}),
                                        CLAVE, contexto=contexto)
    assert CLAVE not in mensaje and "boom" not in mensaje and "http" not in mensaje


def test_un_contexto_desconocido_cae_en_los_textos_de_publicar():
    # nadie debería pasarlo, pero un typo no puede dejar sin mensaje al usuario
    for codigo in (404, 422, 429):
        raro = blotato.explicar_fallo(_fallo(codigo), contexto="inventado")
        assert raro == blotato.explicar_fallo(_fallo(codigo))


def test_contexto_es_keyword_only_y_su_default_es_el_de_publicar():
    p = inspect.signature(blotato.explicar_fallo).parameters["contexto"]
    assert p.kind is inspect.Parameter.KEYWORD_ONLY and p.default == "publicacion"
    # C4 añadió «metricas» AL FINAL: los de C3 no se mueven de sitio
    assert blotato.CONTEXTOS == ("publicacion", "agenda", "reprogramar", "cancelar",
                                 "metricas")


def test_los_llamadores_de_c2_siguen_pasando_todo_posicional():
    """El kwarg nuevo es keyword-only: lo que rompería a C2 es un TERCER
    posicional, no el default. Se comprueba sobre el código, no de memoria."""
    llamadas = []
    for rel in ("server/blotato_api.py", "server/publicar_api.py", "worker/publicar_task.py"):
        texto = (RAIZ / rel).read_text(encoding="utf-8")
        llamadas += re.findall(r"explicar_fallo\(([^)]*)\)", texto)
    assert len(llamadas) >= 7, "faltan llamadores: ¿se movió alguno de sitio?"
    for args in llamadas:
        posicionales = [a for a in args.split(",") if "=" not in a]
        assert len(posicionales) <= 2, args
    # y las dos formas en que llaman hoy siguen dando lo de siempre
    assert blotato.explicar_fallo(_fallo(500)) == blotato.explicar_fallo(_fallo(500), CLAVE)
