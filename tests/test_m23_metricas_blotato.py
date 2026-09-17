"""M23 C4 · Métricas — el cliente de Blotato (paso 1 de 3).

Lo que este archivo defiende:
  * que `since`/`until` viajen SIEMPRE: sin ellos Blotato asume los últimos 7
    días y los 7 siguientes, y la pantalla enseñaría una ventana que nadie
    eligió;
  * que /v2/analytics se lea con `_items` y no con `_pagina`: no manda ni
    `cursor` ni `count`, y _pagina devolvería (items, None, None) en silencio;
  * que `truncado` se levante cuando la respuesta viene llena, porque una
    publicación con números que no entró en el tope NO es una publicación sin
    números;
  * que los contadores (que llegan en texto) salgan como int, y que lo que no
    se pueda convertir salga como None y JAMÁS como 0;
  * que el historial se ordene por fecha, sin repetidas, y que una BAJADA de un
    contador se conserve tal cual: las redes corrigen sus conteos y recortar
    esa bajada sería enseñar algo que la red no dijo;
  * que las dos formas de Blotato para lo mismo (`text`/`content`,
    `postTime`/`createdAt`, `state.postUrl`/`postUrl`) tengan cada una su
    lectura: usar la de la otra ruta devuelve silencio, no un error;
  * que el contexto «metricas» exista y que sus textos no manden a esperar
    «antes de publicar» en una pantalla donde no se publica nada.

Sin red: el httpx simulado de C3 se reusa tal cual.
"""
import httpx
import pytest

from pipeline import blotato

from test_m23_agenda_blotato import HTTPFalso   # el doble de C3, sin copiarlo

CLAVE = "blt_clave-de-metricas=="
DESDE = "2026-08-18T00:00:00+00:00"
HASTA = "2026-09-17T00:00:00+00:00"

# los nueve contadores que Instagram devolvió de verdad el 2026-09-17, tal como
# llegan: todos en texto
METRICAS = {"commentsCount": "2", "interactionsSum": "14", "likesCount": "9",
            "reachCount": "193", "savesCount": "0", "sharesCount": "1",
            "viewTimeMsSum": "2055192", "viewsCount": "306", "watchTimeMsAvg": "10074"}


@pytest.fixture
def http(monkeypatch):
    falso = HTTPFalso()
    monkeypatch.setattr(blotato.httpx, "get", falso.get)
    return falso


def _fallo(codigo: int, cuerpo: dict | None = None) -> httpx.HTTPStatusError:
    """Un fallo cuyo texto lleva la clave: si el mensaje al usuario la repite,
    la aserción lo ve."""
    req = httpx.Request("GET", f"{blotato.BASE}/analytics")
    resp = httpx.Response(codigo, json=cuerpo or {}, request=req)
    return httpx.HTTPStatusError(f"boom {CLAVE}", request=req, response=resp)


# ---------------------------------------------------------------------------
# GET /v2/posts — qué hay

def test_publicadas_manda_siempre_la_ventana_y_los_dos_estados(http):
    blotato.publicadas(CLAVE, desde=DESDE, hasta=HASTA)
    ll = http.llamadas[0]
    assert ll.url == f"{blotato.BASE}/posts"
    assert ll.params["since"] == DESDE and ll.params["until"] == HASTA
    assert ll.params["status"] == ["published", "failed"]
    assert ll.params["limit"] == 20


def test_publicadas_no_pide_lo_programado(http):
    """Lo que todavía no ha salido es la Agenda. Si se colara aquí, la misma
    publicación se vería en dos pantallas contando cosas distintas."""
    blotato.publicadas(CLAVE, desde=DESDE, hasta=HASTA)
    assert "scheduled" not in http.llamadas[0].params["status"]


def test_publicadas_devuelve_el_cursor_y_ningun_total(http):
    """Esta ruta no manda `count`: inventarle un total sería mentir sobre
    cuántas publicaciones tiene el usuario."""
    http.respuestas["GET"] = (200, {"items": [{"id": "1"}], "cursor": "c2"})
    pagina = blotato.publicadas(CLAVE, desde=DESDE, hasta=HASTA)
    assert pagina["cursor"] == "c2" and pagina["total"] is None


def test_publicadas_rechaza_un_cursor_absurdo_sin_tocar_la_red(http):
    with pytest.raises(ValueError):
        blotato.publicadas(CLAVE, desde=DESDE, hasta=HASTA, cursor="x" * 513)
    assert http.llamadas == []


# ---------------------------------------------------------------------------
# GET /v2/analytics — cuánto rinde

def test_analiticas_manda_la_ventana_el_orden_y_el_tope(http):
    blotato.analiticas(CLAVE, desde=DESDE, hasta=HASTA)
    ll = http.llamadas[0]
    assert ll.url == f"{blotato.BASE}/analytics"
    assert ll.params == {"since": DESDE, "until": HASTA, "limit": 100,
                         "sortBy": "views_count"}


def test_analiticas_no_deja_pedir_mas_de_cien(http):
    """El tope de la ruta es 100 y el de `programados` era 50: copiar aquel
    min(50, …) dejaría fuera la mitad de los números de la ventana."""
    blotato.analiticas(CLAVE, desde=DESDE, hasta=HASTA, limite=999)
    assert http.llamadas[0].params["limit"] == 100
    blotato.analiticas(CLAVE, desde=DESDE, hasta=HASTA, limite=0)
    assert http.llamadas[1].params["limit"] == 1


def test_analiticas_rechaza_un_orden_que_no_existe(http):
    with pytest.raises(ValueError):
        blotato.analiticas(CLAVE, desde=DESDE, hasta=HASTA, orden="magia")
    assert http.llamadas == []


def test_analiticas_avisa_cuando_la_respuesta_viene_llena(http):
    """`truncado` es lo que impide decir «sin números» de una publicación que
    sí los tiene y solo se quedó fuera del tope."""
    http.respuestas["GET"] = (200, {"items": [{"id": str(i)} for i in range(3)]})
    assert blotato.analiticas(CLAVE, desde=DESDE, hasta=HASTA, limite=3)["truncado"] is True
    assert blotato.analiticas(CLAVE, desde=DESDE, hasta=HASTA, limite=4)["truncado"] is False


def test_analiticas_ignora_un_cursor_que_esta_ruta_no_tiene(http):
    """`_items` y no `_pagina`: si algún día Blotato añadiera un cursor aquí,
    lo que NO puede pasar es que la lista se lea a medias sin que nadie se
    entere."""
    http.respuestas["GET"] = (200, {"items": [{"id": "1"}], "cursor": "c9", "count": "40"})
    datos = blotato.analiticas(CLAVE, desde=DESDE, hasta=HASTA)
    assert datos["items"] == [{"id": "1"}] and "cursor" not in datos


# ---------------------------------------------------------------------------
# GET /v2/posts/{id}/analytics — los números de una

def test_analitica_de_valida_el_id_antes_de_gastar_una_llamada(http):
    for malo in ("", "../otro", "a b", "x" * 129):
        with pytest.raises(ValueError):
            blotato.analitica_de(CLAVE, malo)
    assert http.llamadas == []


def test_analitica_de_pide_la_ruta_de_la_publicacion(http):
    http.respuestas["GET"] = (200, {"publishedPostId": "6098886", "metrics": METRICAS})
    blotato.analitica_de(CLAVE, "6098886")
    assert http.llamadas[0].url == f"{blotato.BASE}/posts/6098886/analytics"


# ---------------------------------------------------------------------------
# los números: de texto a int, y el hueco que no es un cero

def test_los_contadores_llegan_en_texto_y_salen_en_entero():
    assert blotato.numeros_de(METRICAS) == {"vistas": 306, "me_gusta": 9,
                                            "comentarios": 2, "compartidos": 1}


def test_lo_que_no_se_puede_convertir_es_none_y_nunca_cero():
    """«No lo informa» y «cero» son cosas distintas: un 0 inventado le diría al
    usuario que su publicación no gustó a nadie."""
    n = blotato.numeros_de({"viewsCount": "ochenta", "likesCount": None,
                            "commentsCount": True, "sharesCount": "0"})
    assert n == {"vistas": None, "me_gusta": None, "comentarios": None, "compartidos": 0}


def test_numeros_de_devuelve_siempre_las_cuatro_claves():
    assert set(blotato.numeros_de({})) == {"vistas", "me_gusta", "comentarios", "compartidos"}
    assert set(blotato.numeros_de(None)) == {"vistas", "me_gusta", "comentarios", "compartidos"}


def test_el_detalle_traduce_lo_conocido_y_respeta_lo_que_no():
    """La lista de contadores de Blotato crece. Una clave nueva se enseña con
    su nombre tal cual: inventarle una traducción sería adivinar, y un
    KeyError tumbaría una pantalla de solo mirar."""
    filas = {f["clave"]: f for f in blotato.detalle_de({**METRICAS, "nuevoCount": "5"})}
    assert filas["viewsCount"]["etiqueta"] == "Vistas"
    assert filas["viewTimeMsSum"]["tipo"] == "ms"
    assert filas["nuevoCount"]["etiqueta"] == "nuevoCount" and filas["nuevoCount"]["valor"] == 5


def test_el_detalle_distingue_un_ratio_de_un_contador():
    filas = {f["clave"]: f for f in blotato.detalle_de({"pinterestSaveRate": 0.125,
                                                        "clicksCount": "4"})}
    assert filas["pinterestSaveRate"]["tipo"] == "ratio"
    assert filas["pinterestSaveRate"]["valor"] == 0.125
    assert filas["clicksCount"]["tipo"] == "entero"


def test_el_detalle_deja_fuera_lo_ilegible_en_vez_de_enseñar_un_cero():
    assert blotato.detalle_de({"viewsCount": "no sé"}) == []


# ---------------------------------------------------------------------------
# el historial

def _snap(cuando, vistas):
    return {"fetchedAt": cuando, "metrics": {"viewsCount": str(vistas)}}


def test_el_historial_se_ordena_de_lo_viejo_a_lo_nuevo():
    filas = blotato.historial_de([_snap("2026-08-20T05:26:23Z", 306),
                                  _snap("2026-08-14T01:44:01Z", 264)])
    assert [f["numeros"]["vistas"] for f in filas] == [264, 306]


def test_el_historial_no_repite_una_medicion():
    filas = blotato.historial_de([_snap("2026-08-20T05:26:23Z", 306),
                                  _snap("2026-08-20T05:26:23Z", 306)])
    assert len(filas) == 1


def test_una_medicion_sin_fecha_legible_se_tira():
    """Sin fecha no se puede ordenar, y dejarla al final la haría pasar por la
    más reciente."""
    filas = blotato.historial_de([_snap("2026-08-14T01:44:01Z", 264),
                                  _snap("ayer por la tarde", 999), {"metrics": {}}, "no"])
    assert [f["numeros"]["vistas"] for f in filas] == [264]


def test_una_bajada_se_conserva_tal_cual():
    """Las redes corrigen sus conteos hacia abajo. Recortar la bajada sería
    enseñar un número que la red no dio."""
    filas = blotato.historial_de([_snap("2026-08-14T01:44:01Z", 300),
                                  _snap("2026-08-20T05:26:23Z", 280)])
    assert [f["numeros"]["vistas"] for f in filas] == [300, 280]


def test_el_numero_grande_es_el_de_la_medicion_mas_nueva():
    """Si el historial trae una medición posterior a la que Blotato marca como
    última, manda la del historial."""
    med = blotato._medicion({"viewsCount": "100"}, "2026-08-14T01:44:01Z",
                            [_snap("2026-08-20T05:26:23Z", 306)])
    assert med["numeros"]["vistas"] == 306
    assert med["medido"].startswith("2026-08-20")


def test_sin_medicion_ninguna_los_numeros_son_none():
    """200 con `metrics` nulo es la respuesta normal de una publicación recién
    salida: Blotato mide por tandas, no al instante."""
    med = blotato._medicion(None, None, [])
    assert med["numeros"] is None and med["detalle"] == [] and med["historial"] == []


def test_medicion_post_saca_el_fallo_de_la_red_recortado():
    largo = "x" * 400
    med = blotato.medicion_post({"metrics": None, "lastFetchedAt": None,
                                 "history": [], "lastError": f"  {largo}  "})
    assert med["fallo_red"] == "x" * blotato.TEXTO_MAX
    assert blotato.medicion_post({"lastError": None})["fallo_red"] == ""


def test_las_dos_rutas_usan_nombres_distintos_para_lo_mismo():
    """`latestMetrics`/`metricsHistory` en la lista, `metrics`/`history` en el
    detalle. Leer una con la otra devuelve silencio, no un error: por eso son
    dos funciones."""
    item = {"latestMetrics": {"fetchedAt": "2026-08-20T05:26:23Z", "metrics": METRICAS},
            "metricsHistory": [_snap("2026-08-20T05:26:23Z", 306)]}
    assert blotato.medicion_lista(item)["numeros"]["vistas"] == 306
    assert blotato.medicion_post(item)["numeros"] is None


# ---------------------------------------------------------------------------
# las vistas

ITEM_POST = {"id": "6098886", "platform": "instagram", "text": "hola",
             "mediaUrls": ["https://cdn/x.mp4"], "postTime": "2026-08-13T02:43:34Z",
             "state": {"type": "published", "postUrl": "https://www.instagram.com/reel/x/"}}


def test_vista_publicada_lee_el_estado_de_state_y_no_de_status():
    """En /v2/posts el estado vive en `state.type` y el enlace en
    `state.postUrl`; en /v2/posts/{id} son `status` y `publicUrl` en la raíz.
    Copiar estado_post() aquí deja la pantalla muda."""
    v = blotato.vista_publicada(ITEM_POST)
    assert v["estado"] == "publicado" and v["red"] == "Instagram"
    assert v["enlace"] == "https://www.instagram.com/reel/x/" and v["medios"] == 1


def test_vista_publicada_de_una_fallida_trae_el_motivo_y_ningun_enlace():
    v = blotato.vista_publicada({**ITEM_POST, "state": {
        "type": "failed", "errorMessage": "  la red   dijo que no  "}})
    assert v["estado"] == "fallido" and v["enlace"] == ""
    assert v["error_red"] == "la red dijo que no"


def test_una_red_desconocida_no_tumba_la_pantalla():
    """La lista de redes de Blotato es más larga que nuestras nueve: REDES[p]
    daría un KeyError → 500 en una pantalla de solo mirar."""
    v = blotato.vista_publicada({**ITEM_POST, "platform": "mastodon"})
    assert v["red"] == "mastodon"


def test_un_enlace_que_no_sea_https_no_se_enseña():
    v = blotato.vista_publicada({**ITEM_POST, "state": {
        "type": "published", "postUrl": "javascript:alert(1)"}})
    assert v["enlace"] == ""


def test_el_texto_se_recorta_y_dice_que_se_recorto():
    """`cortado` existe para que la pantalla ponga «…» solo cuando falta texto:
    con >= 200 se lo pondría a un texto de 200 justos, que está entero."""
    justo = blotato.vista_publicada({**ITEM_POST, "text": "a" * blotato.TEXTO_MAX})
    largo = blotato.vista_publicada({**ITEM_POST, "text": "a" * (blotato.TEXTO_MAX + 1)})
    assert justo["cortado"] is False and largo["cortado"] is True
    assert len(largo["texto"]) == blotato.TEXTO_MAX


def test_vista_analitica_usa_los_otros_nombres_y_no_inventa_estado():
    v = blotato.vista_analitica({"id": "1", "platform": "twitter", "content": "hola",
                                 "createdAt": "2026-08-13T02:43:34Z",
                                 "postUrl": "https://x.com/a/1",
                                 "mediaUrls": ["https://cdn/x.mp4", 7]})
    assert v["texto"] == "hola" and v["cuando"] == "2026-08-13T02:43:34Z"
    assert v["estado"] == "publicado" and v["red"] == "X" and v["medios"] == 1


def test_ninguna_vista_saca_las_urls_de_los_adjuntos():
    """La pantalla es pública y no tiene por qué pedirle assets al CDN de
    Blotato: viaja el CONTEO, como en la Agenda."""
    for v in (blotato.vista_publicada(ITEM_POST),
              blotato.vista_analitica({"mediaUrls": ["https://cdn/x.mp4"]})):
        assert "mediaUrls" not in v and "https://cdn/x.mp4" not in str(v)


# ---------------------------------------------------------------------------
# los textos del usuario

def test_metricas_es_un_contexto_de_verdad():
    assert blotato.CONTEXTOS == ("publicacion", "agenda", "reprogramar",
                                 "cancelar", "metricas")


def test_un_404_en_metricas_no_manda_a_revisar_la_cuenta():
    """Aquí un 404 no es una avería: es la respuesta. Blotato no guardó números
    de esa publicación."""
    texto, reconectar = blotato.explicar_fallo(_fallo(404), CLAVE, contexto="metricas")
    assert "no hay números" in texto and "sigue en tu lista" in texto
    assert reconectar is False


def test_un_429_en_metricas_no_habla_de_publicar():
    """En esta pantalla no se publica nada: «espera antes de publicar otra vez»
    desconcierta a quien solo estaba mirando."""
    texto, _ = blotato.explicar_fallo(_fallo(429), CLAVE, contexto="metricas")
    assert "publicar" not in texto and "volver a consultar" in texto


def test_un_422_en_metricas_habla_de_la_consulta_y_no_de_la_publicacion():
    texto, _ = blotato.explicar_fallo(
        _fallo(422, {"message": "since: must be a date"}), CLAVE, contexto="metricas")
    assert "consulta de los números" in texto and "since: must be a date" in texto


def test_una_clave_rechazada_manda_a_reconectar_tambien_aqui():
    for codigo in (401, 403):
        texto, reconectar = blotato.explicar_fallo(_fallo(codigo), CLAVE, contexto="metricas")
        assert reconectar is True and "conéctala de nuevo" in texto


def test_ningun_texto_de_metricas_repite_la_clave():
    for codigo in (401, 403, 404, 422, 429, 500):
        texto, _ = blotato.explicar_fallo(_fallo(codigo), CLAVE, contexto="metricas")
        assert CLAVE not in texto
