"""M23 C4 · Métricas — el router /api/metricas (paso 2 de 3).

Lo que no puede pasar, y por eso se fija aquí:
  * que una carga cueste más de DOS llamadas a Blotato (el cupo del usuario son
    60 por minuto y el modal de Publicar ya gasta hasta 3 por carga), ni más
    tiempo del que la Lambda aguanta;
  * que la pantalla diga «sin números» de una publicación que SÍ los tiene: si
    la respuesta de /v2/analytics vino recortada o no vino, lo honesto es «no
    lo sabemos» y ofrecer preguntar;
  * que un fallo de Blotato tumbe la pantalla o la deje en blanco: las dos
    llamadas fallan por separado y la respuesta lo dice por separado;
  * que una publicación programada se cuele en la pantalla de lo que ya salió;
  * que un tramo de fechas imposible, un cursor huérfano o un id inventado
    gasten una llamada del cupo del usuario;
  * que el 404 de «esta no tiene números» se enseñe como una avería;
  * que los tres estados de la clave se mezclen (sin clave 409, almacén caído
    503, clave rechazada → 409 con su propio mensaje).

Sin red: httpx se sustituye por un doble que responde según la RUTA, porque
esta pantalla habla con dos rutas distintas en la misma petición.
"""
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import httpx
import pytest
from fastapi.testclient import TestClient

from pipeline import blotato, claves_usuario
from server import metricas_api

USER = "u-metricas"
CLAVE = "blt_clave-de-metricas=="

METRICAS = {"commentsCount": "2", "likesCount": "9", "sharesCount": "1",
            "viewsCount": "306", "reachCount": "193"}


def _z(t: datetime) -> str:
    """Como las manda el servidor: UTC en Z. Un «+00:00» sin escapar llega
    al servidor como un espacio y la ventana se vuelve ilegible."""
    return t.isoformat(timespec="seconds").replace("+00:00", "Z")


def _post(pid="6098886", plataforma="instagram", tipo="published", **extra):
    estado = {"type": tipo}
    if tipo == "published":
        estado["postUrl"] = f"https://www.instagram.com/reel/{pid}/"
    if tipo == "failed":
        estado["errorMessage"] = "la red la rechazó"
    return {"id": pid, "platform": plataforma, "text": "hola", "mediaUrls": [],
            "postTime": "2026-09-12T00:50:49Z", "state": estado, **extra}


def _analitica(pid="6098886", vistas="306"):
    return {"id": pid, "platform": "instagram", "content": "hola",
            "createdAt": "2026-09-12T00:50:49Z", "postUrl": "https://x/1",
            "mediaUrls": [],
            "latestMetrics": {"fetchedAt": "2026-09-13T01:41:40Z",
                              "metrics": {**METRICAS, "viewsCount": vistas}},
            "metricsHistory": [{"fetchedAt": "2026-09-13T01:41:40Z",
                                "metrics": {**METRICAS, "viewsCount": vistas}}]}


class HTTPPorRuta:
    """httpx simulado que responde según la ruta: /posts, /analytics y
    /posts/{id}/analytics son tres respuestas distintas en la misma petición.

    Las firmas son keyword-only a propósito: una llamada posicional revienta
    aquí en vez de colarse hasta la API real."""

    def __init__(self):
        self.llamadas: list[SimpleNamespace] = []
        self.posts = {"items": [], "cursor": None}
        self.analytics = {"items": []}
        self.una = {"publishedPostId": "6098886", "platform": "instagram",
                    "lastFetchedAt": None, "lastError": None, "metrics": None,
                    "history": []}
        self.errores: dict[str, Exception] = {}

    def _que_es(self, url: str) -> str:
        if url.endswith("/analytics") and "/posts/" in url:
            return "una"
        if url.endswith("/analytics"):
            return "analytics"
        return "posts"

    def get(self, url, *, params=None, headers=None, timeout=None):
        cual = self._que_es(str(url))
        self.llamadas.append(SimpleNamespace(cual=cual, url=str(url), params=params,
                                             timeout=timeout))
        if self.errores.get(cual):
            raise self.errores[cual]
        req = httpx.Request("GET", url)
        return httpx.Response(200, json=getattr(self, cual), request=req)

    @property
    def rutas(self) -> list[str]:
        return [ll.cual for ll in self.llamadas]


def _error(codigo: int, cuerpo: dict | None = None) -> httpx.HTTPStatusError:
    """Un fallo cuyo texto lleva la clave: si el mensaje al usuario la repite,
    la aserción lo ve."""
    req = httpx.Request("GET", f"{blotato.BASE}/posts")
    resp = httpx.Response(codigo, json=cuerpo or {}, request=req)
    return httpx.HTTPStatusError(f"boom {CLAVE}", request=req, response=resp)


@pytest.fixture
def http(monkeypatch):
    falso = HTTPPorRuta()
    monkeypatch.setattr(blotato.httpx, "get", falso.get)
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


# ---------------------------------------------------------------------------
# el presupuesto: llamadas y segundos

def test_las_dos_llamadas_caben_en_la_lambda():
    """Los timeouts de httpx son POR FASE: el tope de verdad lo pone el reloj
    de la Lambda, y aquí van dos llamadas, no una."""
    assert metricas_api.TOPE_S > blotato.TIMEOUT_CORTO.read
    assert 2 * metricas_api.TOPE_S <= metricas_api.LAMBDA_S - 10
    assert metricas_api.PRESUPUESTO_S <= metricas_api.LAMBDA_S - 10
    assert metricas_api.MINIMO_SEGUNDA_S > 0


def test_el_router_se_registra_antes_del_mount_de_static(conectado, http):
    """Después del mount de '/', StaticFiles se queda con /api/metricas y
    contesta su 404 en HTML: la pantalla vería «Unexpected token <»."""
    from server import app as modulo
    fuente = (modulo.ROOT / "server" / "app.py").read_text(encoding="utf-8")
    assert fuente.index("include_router(metricas_router)") < fuente.index('app.mount("/"')
    assert {r.path for r in metricas_api.router.routes} == {
        "/api/metricas", "/api/metricas/{post_id}/numeros"}
    for r in (conectado.get("/api/metricas"),
              conectado.get("/api/metricas/6098886/numeros")):
        assert r.headers["content-type"].startswith("application/json")
        assert r.status_code != 405


def test_una_carga_cuesta_exactamente_dos_llamadas(conectado, http):
    http.posts = {"items": [_post()], "cursor": None}
    http.analytics = {"items": [_analitica()]}
    assert conectado.get("/api/metricas").status_code == 200
    assert http.rutas == ["posts", "analytics"]


def test_la_lista_va_primero(conectado, http):
    """Sin /v2/posts no hay lista, ni cursor, ni fallidas. Si el presupuesto se
    agota, la pantalla degrada a «tus publicaciones, sin números» y no a una
    pantalla en blanco."""
    conectado.get("/api/metricas")
    assert http.rutas[0] == "posts"


def test_con_la_clave_rechazada_no_se_gasta_la_segunda_llamada(conectado, http):
    http.errores["posts"] = _error(401)
    j = conectado.get("/api/metricas").json()
    assert http.rutas == ["posts"]
    assert j["reconectar"] is True and j["hay_lista"] is False


def test_con_el_cupo_agotado_tampoco(conectado, http):
    """Un 429 significa «para»: la segunda llamada solo serviría para gastar
    otra del cupo y repetir el mismo error."""
    http.errores["posts"] = _error(429)
    conectado.get("/api/metricas")
    assert http.rutas == ["posts"]


# ---------------------------------------------------------------------------
# la ventana

def test_sin_parametros_la_ventana_son_los_ultimos_treinta_dias(conectado, http):
    j = conectado.get("/api/metricas").json()
    desde, hasta = blotato.momento(j["desde"]), blotato.momento(j["hasta"])
    assert (hasta - desde) == timedelta(days=metricas_api.VENTANA_D)
    assert abs((datetime.now(timezone.utc) - hasta).total_seconds()) < 60
    # y viaja a las DOS rutas: sin since/until Blotato asume 7 días
    for ll in http.llamadas:
        assert ll.params["since"] == j["desde"] and ll.params["until"] == j["hasta"]


def test_ver_mas_hacia_atras_encadena_el_tramo_anterior(conectado, http):
    primero = conectado.get("/api/metricas").json()
    segundo = conectado.get(f"/api/metricas?desde={primero['desde']}").json()
    # el nuevo tramo TERMINA donde empezaba el anterior: ni hueco ni solape
    assert segundo["hasta"] == primero["desde"]
    assert blotato.momento(segundo["hasta"]) - blotato.momento(segundo["desde"]) \
        == timedelta(days=metricas_api.VENTANA_D)


def test_seguir_un_cursor_no_mueve_el_tramo(conectado, http):
    """Pedirle a Blotato otra ventana con el cursor de la anterior devuelve
    cualquier cosa: el cursor y su tramo viajan juntos."""
    primero = conectado.get("/api/metricas").json()
    j = conectado.get(f"/api/metricas?desde={primero['desde']}"
                      f"&hasta={primero['hasta']}&cursor=c2").json()
    assert (j["desde"], j["hasta"]) == (primero["desde"], primero["hasta"])
    assert http.llamadas[-2].params["cursor"] == "c2"


def test_un_cursor_sin_su_tramo_no_gasta_llamada(conectado, http):
    r = conectado.get("/api/metricas?cursor=c2")
    assert r.status_code == 422 and http.llamadas == []


def test_un_cursor_absurdo_no_gasta_llamada(conectado, http):
    r = conectado.get("/api/metricas?desde=2026-09-01T00:00:00Z"
                      "&hasta=2026-09-10T00:00:00Z&cursor=" + "x" * 513)
    assert r.status_code == 422 and http.llamadas == []


def test_una_fecha_ilegible_no_gasta_llamada(conectado, http):
    r = conectado.get("/api/metricas?desde=el%20mes%20pasado")
    assert r.status_code == 422 and http.llamadas == []


def test_no_se_puede_retroceder_mas_de_un_ano(conectado, http):
    viejo = _z(datetime.now(timezone.utc) - timedelta(days=400))
    r = conectado.get(f"/api/metricas?desde={viejo}")
    assert r.status_code == 422 and "un año" in r.json()["detail"]
    assert http.llamadas == []


def test_el_ultimo_tramo_se_avisa_para_que_ver_mas_se_apague(conectado, http):
    hoy = conectado.get("/api/metricas").json()
    assert hoy["ultimo_tramo"] is False
    # el último tramo que cabe entero dentro del año: el siguiente ya no, y por
    # eso la pantalla tiene que apagar «Ver más» ANTES de pedirlo
    casi = _z(datetime.now(timezone.utc) - timedelta(days=334))
    j = conectado.get(f"/api/metricas?desde={casi}").json()
    assert j["ultimo_tramo"] is True


# ---------------------------------------------------------------------------
# los cinco «sin números», que son cinco cosas distintas

def _una(conectado, posts, analytics=None, truncado=False):
    return conectado.get("/api/metricas").json()


def test_lo_medido_trae_sus_numeros(conectado, http):
    http.posts = {"items": [_post()], "cursor": None}
    http.analytics = {"items": [_analitica()]}
    it = conectado.get("/api/metricas").json()["items"][0]
    assert it["medicion"] == "medido" and it["numeros"]["vistas"] == 306
    assert it["puede_pedir"] is False and it["historial"]


def test_una_fallida_nunca_va_a_tener_numeros(conectado, http):
    http.posts = {"items": [_post(tipo="failed")], "cursor": None}
    it = conectado.get("/api/metricas").json()["items"][0]
    assert it["estado"] == "fallido" and it["medicion"] == "no_aplica"
    assert it["puede_pedir"] is False and it["error_red"] == "la red la rechazó"


def test_linkedin_lo_dice_sin_gastar_una_llamada_al_vacio(conectado, http):
    """Blotato todavía no recoge números de LinkedIn: ofrecer «Ver números» ahí
    es prometer algo que no va a llegar."""
    http.posts = {"items": [_post(plataforma="linkedin")], "cursor": None}
    it = conectado.get("/api/metricas").json()["items"][0]
    assert it["medicion"] == "no_disponible" and it["puede_pedir"] is False
    assert "LinkedIn" in it["motivo"]


def test_si_blotato_respondio_por_todo_el_tramo_la_ausencia_si_informa(conectado, http):
    http.posts = {"items": [_post()], "cursor": None}
    http.analytics = {"items": []}
    it = conectado.get("/api/metricas").json()["items"][0]
    assert it["medicion"] == "no_medido" and it["puede_pedir"] is False


def test_si_la_respuesta_vino_recortada_no_se_afirma_nada(conectado, http):
    """Con la lista de números llena, que una publicación no esté en ella NO
    significa que no tenga números: significa que no miramos."""
    http.posts = {"items": [_post()], "cursor": None}
    http.analytics = {"items": [_analitica(pid=str(i)) for i in range(100)]}
    j = conectado.get("/api/metricas").json()
    assert j["truncado"] is True
    assert j["items"][0]["medicion"] == "sin_consultar"
    assert j["items"][0]["puede_pedir"] is True


def test_si_los_numeros_no_llegaron_tampoco_se_afirma_nada(conectado, http):
    http.posts = {"items": [_post()], "cursor": None}
    http.errores["analytics"] = _error(500)
    j = conectado.get("/api/metricas").json()
    assert j["hay_numeros"] is False
    assert j["items"][0]["medicion"] == "sin_consultar"


def test_sin_un_id_que_blotato_acepte_no_se_ofrece_preguntar(conectado, http):
    """Un botón que garantiza un 422 es un botón roto."""
    http.posts = {"items": [_post(pid="no vale")], "cursor": None}
    http.errores["analytics"] = _error(500)
    it = conectado.get("/api/metricas").json()["items"][0]
    assert it["puede_pedir"] is False


# ---------------------------------------------------------------------------
# lo que no entra, y los fallos parciales

def test_lo_programado_no_entra_en_esta_pantalla(conectado, http):
    """Eso es la Agenda. Si se colara, la misma publicación se vería en dos
    pantallas contando cosas distintas."""
    http.posts = {"items": [_post(), {"id": "9", "platform": "tiktok",
                                      "state": {"type": "scheduled"}}], "cursor": None}
    j = conectado.get("/api/metricas").json()
    assert [it["id"] for it in j["items"]] == ["6098886"]


def test_las_dos_bien(conectado, http):
    http.posts = {"items": [_post()], "cursor": "c2"}
    http.analytics = {"items": [_analitica()]}
    j = conectado.get("/api/metricas").json()
    assert (j["hay_lista"], j["hay_numeros"], j["error"]) == (True, True, None)
    assert j["cursor"] == "c2" and len(j["mejores"]) == 1


def test_la_lista_bien_y_los_numeros_no(conectado, http):
    http.posts = {"items": [_post()], "cursor": None}
    http.errores["analytics"] = _error(500)
    j = conectado.get("/api/metricas").json()
    assert j["hay_lista"] is True and j["hay_numeros"] is False
    assert j["items"] and j["mejores"] == [] and j["error"]


def test_los_numeros_bien_y_la_lista_no(conectado, http):
    """La lista NO se rellena con lo de analytics: no trae las fallidas, ni el
    orden por fecha, ni cursor. Pintarla sería decir «no falló ninguna»."""
    http.errores["posts"] = _error(500)
    http.analytics = {"items": [_analitica()]}
    j = conectado.get("/api/metricas").json()
    assert j["hay_lista"] is False and j["items"] == []
    assert j["hay_numeros"] is True and len(j["mejores"]) == 1


def test_las_dos_mal_no_devuelven_un_502(conectado, http):
    """Una lista en blanco con su motivo se puede refrescar; un 502 no."""
    http.errores["posts"] = _error(500)
    http.errores["analytics"] = _error(500)
    r = conectado.get("/api/metricas")
    assert r.status_code == 200
    j = r.json()
    assert j["items"] == [] and j["mejores"] == [] and j["error"]
    assert CLAVE not in j["error"]


def test_las_mejores_vienen_de_la_misma_respuesta_y_con_tope(conectado, http):
    """Cambiar a «las más vistas» no gasta ninguna llamada: es la misma
    respuesta sin reordenar."""
    http.analytics = {"items": [_analitica(pid=str(i), vistas=str(50 - i))
                                for i in range(30)]}
    j = conectado.get("/api/metricas").json()
    assert len(j["mejores"]) == metricas_api.MEJORES
    assert [it["id"] for it in j["mejores"]] == [str(i) for i in range(metricas_api.MEJORES)]
    assert http.rutas == ["posts", "analytics"]


# ---------------------------------------------------------------------------
# los números de UNA publicación

def test_pedir_los_numeros_cuesta_una_llamada(conectado, http):
    http.una = {"publishedPostId": "6098886", "platform": "instagram",
                "lastFetchedAt": "2026-09-13T01:41:40Z", "lastError": None,
                "metrics": METRICAS, "history": []}
    j = conectado.get("/api/metricas/6098886/numeros").json()
    assert http.rutas == ["una"]
    assert j["medicion"] == "medido" and j["numeros"]["vistas"] == 306
    assert j["detalle"] and j["motivo"] == ""


def test_una_publicacion_recien_salida_dice_que_aun_no(conectado, http):
    """200 con metrics:null es la respuesta normal: Blotato mide por tandas,
    desde un par de horas después de publicar."""
    j = conectado.get("/api/metricas/6098886/numeros").json()
    assert j["medicion"] == "aun_no" and j["numeros"] is None
    assert "vuelve más tarde" in j["motivo"]


def test_un_404_no_es_una_averia(conectado, http):
    """Significa «de esta no guardó nada». Si saliera como 404 de HTTP, la
    pantalla lo pintaría en rojo."""
    http.errores["una"] = _error(404)
    r = conectado.get("/api/metricas/6098886/numeros")
    assert r.status_code == 200
    j = r.json()
    assert j["medicion"] == "no_medido" and "no hay números" in j["motivo"]


def test_un_fallo_de_la_red_se_cuenta_como_lo_que_es(conectado, http):
    http.una = {**http.una, "lastError": "instagram devolvió 400"}
    j = conectado.get("/api/metricas/6098886/numeros").json()
    assert j["medicion"] == "fallo_red" and "instagram devolvió 400" in j["motivo"]


def test_un_id_inventado_no_gasta_llamada(conectado, http):
    for malo in ("../otro", "x" * 200):
        r = conectado.get(f"/api/metricas/{malo}/numeros")
        assert r.status_code in (404, 422)
    assert http.llamadas == []


def test_el_cupo_agotado_sale_como_cupo_agotado(conectado, http):
    """Es lo único que el usuario puede repetir a voluntad en esta pantalla, y
    por eso es lo único que puede toparse con el límite de Blotato: envolverlo
    en un 502 le diría «error» a algo que solo necesita un momento."""
    http.errores["una"] = _error(429)
    r = conectado.get("/api/metricas/6098886/numeros")
    assert r.status_code == 429 and "esperar" in r.json()["detail"]


def test_la_clave_rechazada_sale_como_reconectar(conectado, http):
    http.errores["una"] = _error(403)
    r = conectado.get("/api/metricas/6098886/numeros")
    assert r.status_code == 409 and "conéctala de nuevo" in r.json()["detail"]


# ---------------------------------------------------------------------------
# los tres estados de la clave

def test_sin_clave_se_manda_a_conectarla_sin_tocar_la_red(cliente, http):
    for url in ("/api/metricas", "/api/metricas/6098886/numeros"):
        r = cliente.get(url)
        assert r.status_code == 409 and "Conecta tu cuenta" in r.json()["detail"]
    assert http.llamadas == []


def test_con_el_almacen_caido_no_se_confunde_con_no_tener_clave(cliente, http, monkeypatch):
    def caido(*a, **kw):
        raise claves_usuario.ErrorAlmacen("boom")
    monkeypatch.setattr(blotato, "clave_de", caido)
    r = cliente.get("/api/metricas")
    assert r.status_code == 503
    assert http.llamadas == []
