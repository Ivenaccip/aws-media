"""M23 C — cada usuario conecta SU cuenta de Blotato.

Lo que no puede pasar, y por eso se fija aquí:
  * que en el servicio se publique con una clave que no es la del usuario
    (la del .env, la de otro usuario, la del usuario anterior de un worker);
  * que la clave salga en una respuesta o en un log;
  * que se guarde una clave que Blotato rechaza;
  * que la API pueda escribir otra cosa que la BLOTATO_API_KEY de un usuario.
Sin red y sin AWS: SSM y Blotato van simulados.
"""
import json
import logging
import sys
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest
from fastapi.testclient import TestClient

from pipeline import blotato, claves_usuario, db

RAIZ = Path(__file__).resolve().parent.parent
PREFIJO = "/media-ivenaccip/usuarios"
_RAIZ_LOCAL_REAL = claves_usuario._raiz_local   # el conftest la redirige en cada test
CLAVE = "blt_clave-secreta_123=="


# ---------------------------------------------------------------------------
# dobles

class _NoExiste(Exception):
    pass


class SSMFalso:
    """Lo mínimo de boto3.client('ssm') que usa claves_usuario."""

    def __init__(self):
        self.params: dict[str, str] = {}
        self.llamadas: list[tuple] = []
        self.falla: Exception | None = None
        self.exceptions = SimpleNamespace(ParameterNotFound=_NoExiste)

    def _quizas_falla(self):
        if self.falla:
            raise self.falla

    def get_parameter(self, Name, WithDecryption):
        self.llamadas.append(("get", Name, WithDecryption))
        self._quizas_falla()
        if Name not in self.params:
            raise _NoExiste(Name)
        return {"Parameter": {"Name": Name, "Value": self.params[Name]}}

    def put_parameter(self, Name, Value, Type, Overwrite):
        self.llamadas.append(("put", Name, Type, Overwrite))
        self._quizas_falla()
        self.params[Name] = Value

    def delete_parameter(self, Name):
        self.llamadas.append(("delete", Name))
        self._quizas_falla()
        if Name not in self.params:
            raise _NoExiste(Name)
        del self.params[Name]


@pytest.fixture
def ssm(monkeypatch):
    falso = SSMFalso()
    monkeypatch.setenv("SSM_USUARIOS_PREFIX", PREFIJO)
    monkeypatch.setattr(claves_usuario, "_ssm", lambda: falso)
    return falso


def _respuesta(codigo: int, cuerpo=None) -> httpx.Response:
    return httpx.Response(codigo, json=cuerpo if cuerpo is not None else {},
                          request=httpx.Request("GET", f"{blotato.BASE}/users/me/accounts"))


REDES = [{"id": "11", "platform": "tiktok", "fullname": "Ana", "username": "ana.tt",
          "token": "no-debe-salir", "extra": {"x": 1}},
         {"id": "12", "platform": "youtube", "fullname": "Canal de Ana", "username": ""}]


@pytest.fixture
def blotato_http(monkeypatch):
    """httpx simulado: guarda las cabeceras y responde lo que se le diga.

    C3 añadió el cursor (get con `params=`) y los dos verbos de la Agenda. Sin
    taparlos aquí, una prueba que llame a reprogramar()/cancelar() saldría a la
    red de verdad — y con la firma vieja get(url, headers, timeout) el doble
    reventaba con un TypeError que se lee como cualquier otra cosa."""
    estado = SimpleNamespace(codigo=200, cuerpo={"items": REDES}, cabeceras=[], error=None,
                             params=[], verbos=[])

    def get(url, headers, timeout, params=None):
        estado.params.append(params)
        return _responder("GET", url, headers)

    def patch(url, headers, timeout, json=None):
        return _responder("PATCH", url, headers)

    def delete(url, headers, timeout):
        return _responder("DELETE", url, headers)

    def _responder(verbo, url, headers):
        estado.verbos.append(verbo)
        estado.cabeceras.append(dict(headers))
        if estado.error:
            raise estado.error
        if estado.cuerpo is None:   # una página de error en vez de JSON
            return httpx.Response(estado.codigo, content=b"<html>",
                                  request=httpx.Request(verbo, url))
        if verbo != "GET":          # PATCH y DELETE contestan 204 SIN cuerpo
            return httpx.Response(204, request=httpx.Request(verbo, url))
        return _respuesta(estado.codigo, estado.cuerpo)

    monkeypatch.setattr(blotato.httpx, "get", get)
    monkeypatch.setattr(blotato.httpx, "patch", patch)
    monkeypatch.setattr(blotato.httpx, "delete", delete)
    return estado


# ---------------------------------------------------------------------------
# el almacén: local

def test_local_guarda_lee_y_borra_por_usuario():
    assert claves_usuario.leer("u1", "BLOTATO_API_KEY") is None
    claves_usuario.guardar("u1", "BLOTATO_API_KEY", CLAVE)
    assert claves_usuario.leer("u1", "BLOTATO_API_KEY") == CLAVE
    assert claves_usuario.leer("u2", "BLOTATO_API_KEY") is None
    claves_usuario.borrar("u1", "BLOTATO_API_KEY")
    assert claves_usuario.leer("u1", "BLOTATO_API_KEY") is None
    claves_usuario.borrar("u1", "BLOTATO_API_KEY")   # otra vez: no pasa nada


def test_local_vive_bajo_la_carpeta_de_trabajo(monkeypatch, tmp_path):
    monkeypatch.setenv("WORK_DIR", str(tmp_path / "trabajo"))
    assert _RAIZ_LOCAL_REAL() == tmp_path / "trabajo" / "_claves"


def test_la_carpeta_de_trabajo_por_defecto_no_se_comitea():
    # sin WORK_DIR la carpeta cae en <repo>/work/, y ahí quedaría la clave
    reglas = (RAIZ / ".gitignore").read_text(encoding="utf-8").splitlines()
    assert "work/" in [r.strip() for r in reglas]


def test_el_conftest_manda_las_claves_a_tmp(tmp_path):
    claves_usuario.guardar("u1", "BLOTATO_API_KEY", CLAVE)
    assert (tmp_path / "_claves" / "u1" / "BLOTATO_API_KEY").read_text(encoding="utf-8") == CLAVE


@pytest.mark.parametrize("user", ["", "..", "../otro", "a/b", "a\\b", "x" * 65, "sub con espacio"])
def test_el_usuario_no_puede_escapar_de_su_ruta(user):
    assert not claves_usuario.id_valido(user)
    with pytest.raises(ValueError):
        claves_usuario.guardar(user, "BLOTATO_API_KEY", CLAVE)
    with pytest.raises(ValueError):
        claves_usuario.leer(user, "BLOTATO_API_KEY")


def test_un_sub_de_cognito_es_valido():
    assert claves_usuario.id_valido("0c1d2e3f-4a5b-6c7d-8e9f-a0b1c2d3e4f5")
    assert claves_usuario.id_valido("piloto")


@pytest.mark.parametrize("nombre", ["CLAUDE_API_KEY", "FAL_KEY", "OPENAI_API_KEY", "blotato_api_key"])
def test_solo_la_clave_de_blotato_se_escribe(nombre):
    with pytest.raises(ValueError):
        claves_usuario.guardar("u1", nombre, "x")


def test_no_guarda_una_clave_vacia():
    with pytest.raises(ValueError):
        claves_usuario.guardar("u1", "BLOTATO_API_KEY", "")


# ---------------------------------------------------------------------------
# el almacén: SSM

def test_nube_guarda_como_securestring_bajo_el_usuario(ssm):
    claves_usuario.guardar("u1", "BLOTATO_API_KEY", CLAVE)
    assert ssm.llamadas == [("put", f"{PREFIJO}/u1/BLOTATO_API_KEY", "SecureString", True)]
    assert claves_usuario.leer("u1", "BLOTATO_API_KEY") == CLAVE
    assert ssm.llamadas[-1] == ("get", f"{PREFIJO}/u1/BLOTATO_API_KEY", True)


def test_nube_tolera_la_barra_final_del_prefijo(ssm, monkeypatch):
    monkeypatch.setenv("SSM_USUARIOS_PREFIX", PREFIJO + "/")
    claves_usuario.guardar("u1", "BLOTATO_API_KEY", CLAVE)
    assert f"{PREFIJO}/u1/BLOTATO_API_KEY" in ssm.params


def test_nube_sin_parametro_es_no_conectado(ssm):
    assert claves_usuario.leer("u1", "BLOTATO_API_KEY") is None
    claves_usuario.borrar("u1", "BLOTATO_API_KEY")   # borrar lo que no hay: sin error


def test_nube_no_escribe_en_disco(ssm, tmp_path):
    claves_usuario.guardar("u1", "BLOTATO_API_KEY", CLAVE)
    assert not (tmp_path / "_claves").exists()


@pytest.mark.parametrize("operacion", [
    lambda: claves_usuario.leer("u1", "BLOTATO_API_KEY"),
    lambda: claves_usuario.guardar("u1", "BLOTATO_API_KEY", CLAVE),
    lambda: claves_usuario.borrar("u1", "BLOTATO_API_KEY"),
])
def test_un_fallo_de_ssm_no_se_confunde_con_no_conectado(ssm, operacion):
    ssm.falla = RuntimeError(f"AccessDenied al escribir {CLAVE}")
    with pytest.raises(claves_usuario.ErrorAlmacen) as e:
        operacion()
    assert CLAVE not in str(e.value) and e.value.__cause__ is None


def test_el_error_de_aws_se_resume_en_su_codigo(ssm):
    class ClientError(Exception):
        response = {"Error": {"Code": "AccessDeniedException", "Message": f"no {CLAVE}"}}
    ssm.falla = ClientError("mensaje largo")
    with pytest.raises(claves_usuario.ErrorAlmacen) as e:
        claves_usuario.guardar("u1", "BLOTATO_API_KEY", CLAVE)
    assert str(e.value) == "AccessDeniedException"


# ---------------------------------------------------------------------------
# de dónde sale la clave

def test_en_la_nube_jamas_cae_a_la_clave_del_entorno(ssm, monkeypatch):
    monkeypatch.setenv("BLOTATO_API_KEY", "la-de-la-plataforma")
    assert blotato.clave_y_origen("u1") == (None, None)
    assert blotato.clave_de("u1") is None


def test_en_la_nube_cada_usuario_usa_la_suya(ssm):
    claves_usuario.guardar("u1", "BLOTATO_API_KEY", "de-u1")
    assert blotato.clave_y_origen("u1") == ("de-u1", "propia")
    assert blotato.clave_de("u2") is None


def test_en_local_cae_al_env_del_dueno(monkeypatch):
    monkeypatch.setenv("BLOTATO_API_KEY", "del-env")
    assert blotato.clave_y_origen("piloto") == ("del-env", "env")
    claves_usuario.guardar("piloto", "BLOTATO_API_KEY", "conectada")
    assert blotato.clave_y_origen("piloto") == ("conectada", "propia")


def test_en_local_sin_nada_no_hay_clave():
    assert blotato.clave_y_origen("piloto") == (None, None)


@pytest.mark.parametrize("variable", ["AWS_LAMBDA_FUNCTION_NAME", "ECS_CONTAINER_METADATA_URI_V4",
                                      "COGNITO_POOL_ID"])
def test_la_reserva_del_env_se_apaga_en_aws_aunque_falte_el_prefijo(monkeypatch, variable):
    monkeypatch.setenv("BLOTATO_API_KEY", "la-de-la-plataforma")
    monkeypatch.setenv(variable, "x")
    assert blotato.clave_y_origen("u1") == (None, None)


def test_la_configuracion_ya_no_trae_una_clave_global():
    from pipeline.config import settings
    assert not hasattr(settings, "blotato_api_key")
    assert "BLOTATO_API_KEY" not in (RAIZ / "pipeline" / "config.py").read_text(encoding="utf-8")


# ---------------------------------------------------------------------------
# el cliente

def test_cada_llamada_lleva_la_clave_que_recibe(blotato_http):
    assert blotato.cuentas("k-1") == REDES
    assert blotato_http.cabeceras == [{"blotato-api-key": "k-1"}]


@pytest.mark.parametrize("llamada", [
    lambda: blotato.cuentas(""),
    lambda: blotato.subir_video("", Path("x.mp4")),
    lambda: blotato.publicar(None, "1", "tiktok", "hola", []),
    lambda: blotato.programados(""),                          # C3: la Agenda
    lambda: blotato.programado("", "sch_1"),
    lambda: blotato.reprogramar("", "sch_1", cuando="2026-10-01T10:00:00+00:00"),
    lambda: blotato.cancelar("", "sch_1"),
])
def test_sin_clave_no_sale_nada(blotato_http, llamada):
    with pytest.raises(blotato.ClaveInvalida):
        llamada()
    assert blotato_http.cabeceras == []


@pytest.mark.parametrize("clave", ["“blt_clave”", "clave…", "cañón", "a\x00b", "a\tb", "x" * 513])
def test_una_clave_con_forma_rara_no_sale(blotato_http, clave):
    assert not blotato.forma_valida(clave)
    with pytest.raises(blotato.ClaveInvalida) as e:
        blotato.cuentas(clave)
    assert clave not in str(e.value)
    assert blotato_http.cabeceras == []


def test_una_clave_normal_tiene_forma_valida():
    assert blotato.forma_valida(CLAVE)
    assert blotato.forma_valida("a" * 512)


@pytest.mark.parametrize("cuerpo", [None, [], {"items": "x"}, "texto"])
def test_una_respuesta_rara_es_un_error_de_http(blotato_http, cuerpo):
    blotato_http.cuerpo = cuerpo
    with pytest.raises(httpx.HTTPError):
        blotato.cuentas(CLAVE)


def test_explicar_fallo_nunca_repite_la_excepcion():
    req = httpx.Request("GET", f"{blotato.BASE}/users/me/accounts")
    for codigo, reconectar in [(401, True), (403, True), (500, False), (429, False)]:
        err = httpx.HTTPStatusError(f"boom {CLAVE}", request=req,
                                    response=httpx.Response(codigo, request=req))
        mensaje, pide = blotato.explicar_fallo(err)
        assert pide is reconectar and CLAVE not in mensaje and "http" not in mensaje
    mensaje, pide = blotato.explicar_fallo(httpx.ConnectError(f"sin red {CLAVE}"))
    assert pide is False and "no respondió" in mensaje and CLAVE not in mensaje


def test_validar_devuelve_las_redes(blotato_http):
    assert blotato.validar(CLAVE) == REDES


@pytest.mark.parametrize("codigo, texto", [(401, "no reconoce"), (403, "prueba gratis")])
def test_validar_explica_el_rechazo(blotato_http, codigo, texto):
    blotato_http.codigo = codigo
    with pytest.raises(blotato.ClaveInvalida) as e:
        blotato.validar(CLAVE)
    assert texto in str(e.value) and CLAVE not in str(e.value)


def test_validar_no_culpa_a_la_clave_si_blotato_se_cae(blotato_http):
    blotato_http.codigo = 500
    with pytest.raises(httpx.HTTPStatusError):
        blotato.validar(CLAVE)


# ---------------------------------------------------------------------------
# la API

@pytest.fixture
def cliente(monkeypatch):
    from server.app import app
    monkeypatch.setenv("DEFAULT_USER_ID", "u1")
    return TestClient(app, raise_server_exceptions=False)


def test_estado_sin_conectar_trae_el_precio_de_pricing_json(cliente):
    pricing = json.loads((RAIZ / "tools" / "pricing.json").read_text(encoding="utf-8"))
    plan = pricing["blotato_suscripcion"]["plan_minimo"]
    d = cliente.get("/api/blotato").json()
    assert d == {"conectado": False, "origen": None, "cuentas": [], "error": None,
                 "reconectar": False, "agendar": True,
                 "plan": {"nombre": plan["nombre"], "usd_por_mes": plan["usd_por_mes"]}}


def test_en_el_servicio_agendar_ya_corre(cliente, monkeypatch):
    # M23 C2: programar funciona también en el servicio (worker SQS)
    monkeypatch.setattr(db, "backend", lambda: "postgres")
    assert cliente.get("/api/blotato?redes=0").json()["agendar"] is True


def test_conectar_prueba_guarda_y_no_devuelve_la_clave(cliente, blotato_http):
    r = cliente.post("/api/blotato", json={"clave": f"  {CLAVE}\n"})
    assert r.status_code == 200
    assert CLAVE not in r.text
    d = r.json()
    assert d["conectado"] is True and d["origen"] == "propia" and d["error"] is None
    # solo los cuatro campos que la pantalla enseña
    assert d["cuentas"] == [
        {"id": "11", "platform": "tiktok", "fullname": "Ana", "username": "ana.tt"},
        {"id": "12", "platform": "youtube", "fullname": "Canal de Ana", "username": ""}]
    assert blotato_http.cabeceras == [{"blotato-api-key": CLAVE}]   # sin espacios
    assert claves_usuario.leer("u1", "BLOTATO_API_KEY") == CLAVE


def test_la_clave_se_guarda_con_el_usuario_del_token_no_del_cuerpo(cliente, blotato_http, monkeypatch):
    r = cliente.post("/api/blotato", json={"clave": CLAVE, "user_id": "u2", "usuario": "u2"})
    assert r.status_code == 200
    assert claves_usuario.leer("u1", "BLOTATO_API_KEY") == CLAVE
    assert claves_usuario.leer("u2", "BLOTATO_API_KEY") is None
    monkeypatch.setenv("DEFAULT_USER_ID", "u2")
    assert cliente.get("/api/blotato?redes=0").json()["conectado"] is False


def test_con_login_manda_el_sub_del_token(cliente, blotato_http, monkeypatch):
    marca = db.fijar_usuario("sub-del-token")
    try:
        from server import blotato_api
        blotato_api.conectar(blotato_api.ConectarIn(clave=CLAVE))
    finally:
        db._usuario_request.reset(marca)
    assert claves_usuario.leer("sub-del-token", "BLOTATO_API_KEY") == CLAVE
    assert claves_usuario.leer("u1", "BLOTATO_API_KEY") is None


@pytest.mark.parametrize("clave", ["", "   ", "con espacio", "x" * 513, "“blt”", "clave…",
                                   "cañón", "a\x00b"])
def test_conectar_rechaza_sin_preguntar_a_blotato(cliente, blotato_http, clave):
    r = cliente.post("/api/blotato", json={"clave": clave})
    assert r.status_code == 422 and "Settings → API" in r.json()["detail"]
    assert blotato_http.cabeceras == []
    assert claves_usuario.leer("u1", "BLOTATO_API_KEY") is None


@pytest.mark.parametrize("codigo", [401, 403])
def test_una_clave_rechazada_no_se_guarda(cliente, blotato_http, codigo):
    blotato_http.codigo = codigo
    r = cliente.post("/api/blotato", json={"clave": CLAVE})
    assert r.status_code == 422 and CLAVE not in r.text
    assert claves_usuario.leer("u1", "BLOTATO_API_KEY") is None


@pytest.mark.parametrize("fallo", ["http500", "red", "json", "lista", "timeout"])
def test_si_blotato_no_responde_no_se_guarda_ni_se_registra(cliente, blotato_http, caplog, fallo):
    if fallo == "http500":
        blotato_http.codigo = 500
    elif fallo == "red":
        blotato_http.error = httpx.ConnectError(f"sin red con {CLAVE}")
    elif fallo == "timeout":
        blotato_http.error = httpx.ReadTimeout("tardó")
    elif fallo == "lista":
        blotato_http.cuerpo = ["no", "es", "un", "objeto"]
    else:
        blotato_http.cuerpo = None
    with caplog.at_level(logging.DEBUG):
        r = cliente.post("/api/blotato", json={"clave": CLAVE})
    assert r.status_code == 502 and "no se guardó" in r.json()["detail"]
    assert claves_usuario.leer("u1", "BLOTATO_API_KEY") is None
    assert CLAVE not in caplog.text and CLAVE not in r.text


def test_si_no_se_puede_guardar_lo_dice(cliente, blotato_http, monkeypatch, caplog):
    def falla(*a):
        raise claves_usuario.ErrorAlmacen("AccessDeniedException")
    monkeypatch.setattr(claves_usuario, "guardar", falla)
    with caplog.at_level(logging.DEBUG):
        r = cliente.post("/api/blotato", json={"clave": CLAVE})
    assert r.status_code == 503 and "no pudimos guardarla" in r.json()["detail"]
    assert CLAVE not in caplog.text


def test_estado_ligero_no_le_pregunta_a_blotato(cliente, blotato_http):
    claves_usuario.guardar("u1", "BLOTATO_API_KEY", CLAVE)
    d = cliente.get("/api/blotato?redes=0").json()
    assert d["conectado"] is True and d["cuentas"] == []
    assert blotato_http.cabeceras == []


def test_estado_completo_lista_las_redes(cliente, blotato_http):
    claves_usuario.guardar("u1", "BLOTATO_API_KEY", CLAVE)
    r = cliente.get("/api/blotato")
    assert [c["platform"] for c in r.json()["cuentas"]] == ["tiktok", "youtube"]
    assert CLAVE not in r.text and "no-debe-salir" not in r.text


@pytest.mark.parametrize("codigo, texto, reconectar", [
    (401, "ya no acepta", True), (403, "ya no acepta", True), (500, "error (500)", False)])
def test_estado_con_blotato_quejandose_sigue_conectado(cliente, blotato_http, codigo, texto,
                                                       reconectar):
    claves_usuario.guardar("u1", "BLOTATO_API_KEY", CLAVE)
    blotato_http.codigo = codigo
    d = cliente.get("/api/blotato").json()
    assert d["conectado"] is True and texto in d["error"] and d["cuentas"] == []
    assert d["reconectar"] is reconectar


@pytest.mark.parametrize("rara", ["html", "red"])
def test_estado_con_blotato_raro_no_es_500(cliente, blotato_http, rara):
    claves_usuario.guardar("u1", "BLOTATO_API_KEY", CLAVE)
    if rara == "html":
        blotato_http.cuerpo = None
    else:
        blotato_http.error = httpx.ConnectTimeout("tardó")
    r = cliente.get("/api/blotato")
    assert r.status_code == 200
    assert r.json()["conectado"] is True and "no respondió" in r.json()["error"]


def test_el_estado_le_da_poco_tiempo_a_blotato(cliente, monkeypatch):
    claves_usuario.guardar("u1", "BLOTATO_API_KEY", CLAVE)
    visto = []
    monkeypatch.setattr(blotato.httpx, "get",
                        lambda url, headers, timeout: visto.append(timeout) or _respuesta(200, {"items": []}))
    cliente.get("/api/blotato")
    assert visto == [blotato.TIMEOUT_CORTO]
    assert blotato.TIMEOUT_CORTO.read < 29 and blotato.TIMEOUT_CORTO.connect < 29


def test_una_clave_guardada_con_forma_rara_pide_reconectar(cliente, blotato_http):
    claves_usuario.guardar("u1", "BLOTATO_API_KEY", "cañón")
    d = cliente.get("/api/blotato").json()
    assert d["conectado"] is True and d["reconectar"] is True and "cañón" not in d["error"]
    assert blotato_http.cabeceras == []


def test_estado_con_ssm_caido_es_503_no_desconectado(cliente, ssm):
    ssm.falla = RuntimeError("Throttling")
    r = cliente.get("/api/blotato")
    assert r.status_code == 503


def test_desconectar_borra_y_responde_el_estado(cliente):
    claves_usuario.guardar("u1", "BLOTATO_API_KEY", CLAVE)
    r = cliente.delete("/api/blotato")
    assert r.status_code == 200 and r.json()["conectado"] is False
    assert claves_usuario.leer("u1", "BLOTATO_API_KEY") is None


def test_desconectar_en_local_vuelve_a_la_del_env(cliente, monkeypatch, blotato_http):
    monkeypatch.setenv("BLOTATO_API_KEY", "del-env")
    claves_usuario.guardar("u1", "BLOTATO_API_KEY", CLAVE)
    d = cliente.delete("/api/blotato?redes=0").json()
    assert d["conectado"] is True and d["origen"] == "env"
    assert blotato_http.cabeceras == []


def test_desconectar_en_local_no_depende_de_blotato(cliente, monkeypatch, blotato_http):
    monkeypatch.setenv("BLOTATO_API_KEY", "del-env")
    claves_usuario.guardar("u1", "BLOTATO_API_KEY", CLAVE)
    blotato_http.cuerpo = None
    r = cliente.delete("/api/blotato")
    assert r.status_code == 200 and r.json()["origen"] == "env"
    assert claves_usuario.leer("u1", "BLOTATO_API_KEY") is None


def test_desconectar_en_la_nube_no_relee(cliente, ssm):
    claves_usuario.guardar("u1", "BLOTATO_API_KEY", CLAVE)
    ssm.llamadas.clear()
    d = cliente.delete("/api/blotato").json()
    assert d["conectado"] is False and d["origen"] is None
    assert ssm.llamadas == [("delete", f"{PREFIJO}/u1/BLOTATO_API_KEY")]


def test_desconectar_solo_toca_al_usuario(cliente):
    claves_usuario.guardar("u1", "BLOTATO_API_KEY", "de-u1")
    claves_usuario.guardar("u2", "BLOTATO_API_KEY", "de-u2")
    cliente.delete("/api/blotato")
    assert claves_usuario.leer("u2", "BLOTATO_API_KEY") == "de-u2"


def test_un_usuario_raro_es_400(cliente, monkeypatch, blotato_http):
    monkeypatch.setenv("DEFAULT_USER_ID", "../otro")
    assert cliente.get("/api/blotato").status_code == 400
    assert cliente.post("/api/blotato", json={"clave": CLAVE}).status_code == 400
    assert cliente.delete("/api/blotato").status_code == 400
    assert blotato_http.cabeceras == []


def test_la_ruta_exige_login_en_el_servicio():
    from server import auth
    assert "/api/blotato".startswith(auth.PREFIJOS_PROTEGIDOS)
    assert "/api/blotato" not in auth.RUTAS_PUBLICAS


# ---------------------------------------------------------------------------
# publicar usa la clave del usuario

def test_publicar_cuentas_usa_la_clave_del_usuario(monkeypatch, blotato_http, tmp_path):
    from server import publicar_api
    (tmp_path / "v1").mkdir()
    monkeypatch.setenv("DEFAULT_USER_ID", "u1")
    monkeypatch.setattr(publicar_api, "_proyecto", lambda name: tmp_path / name)
    monkeypatch.setattr(publicar_api, "_nube", lambda: False)
    assert publicar_api.estado("v1")["blotato"] is False
    r = publicar_api.cuentas("v1")
    assert r["conectado"] is False and r["cuentas"] == [] and blotato_http.cabeceras == []
    claves_usuario.guardar("u1", "BLOTATO_API_KEY", CLAVE)
    r = publicar_api.estado("v1")
    assert r["blotato"] is True and r["agendar"] is True and "cuentas" not in r
    assert blotato_http.cabeceras == []          # el estado no le pregunta a Blotato
    r = publicar_api.cuentas("v1")
    assert r["conectado"] is True and len(r["cuentas"]) == 2
    assert blotato_http.cabeceras == [{"blotato-api-key": CLAVE}]


def test_publicar_estado_en_nube_no_le_pregunta_a_blotato(monkeypatch, blotato_http, ssm):
    """Un Blotato colgado tumbaría el modal entero, con el botón de descargar
    incluido: las redes se piden aparte (/cuentas)."""
    from server import editor, publicar_api
    monkeypatch.setenv("DEFAULT_USER_ID", "u1")
    monkeypatch.setattr(publicar_api, "_nube", lambda: True)
    monkeypatch.setattr(editor, "_proyecto_nube", lambda name: {})
    monkeypatch.setattr(publicar_api, "descargables_nube", lambda name: {})
    monkeypatch.setattr(publicar_api.publicaciones, "listar", lambda u, n: [])
    claves_usuario.guardar("u1", "BLOTATO_API_KEY", CLAVE)
    r = publicar_api.estado("v1")
    assert r["blotato"] is True and r["agendar"] is True and r["error"] is None
    assert blotato_http.cabeceras == []


@pytest.mark.parametrize("codigo, reconectar", [(401, True), (403, True), (502, False)])
def test_publicar_cuentas_explica_y_pide_reconectar(monkeypatch, blotato_http, tmp_path,
                                                    codigo, reconectar):
    from server import publicar_api
    (tmp_path / "v1").mkdir()
    monkeypatch.setenv("DEFAULT_USER_ID", "u1")
    monkeypatch.setattr(publicar_api, "_proyecto", lambda name: tmp_path / name)
    monkeypatch.setattr(publicar_api, "_nube", lambda: False)
    claves_usuario.guardar("u1", "BLOTATO_API_KEY", CLAVE)
    blotato_http.codigo = codigo
    r = publicar_api.cuentas("v1")
    assert r["conectado"] is True and r["reconectar"] is reconectar and r["cuentas"] == []
    assert "backend.blotato.com" not in r["error"] and "Client error" not in r["error"]


def test_publicar_estado_con_usuario_raro_no_revienta(monkeypatch, tmp_path):
    from server import publicar_api
    (tmp_path / "v1").mkdir()
    monkeypatch.setenv("DEFAULT_USER_ID", "correo@raro.com")
    monkeypatch.setattr(publicar_api, "_proyecto", lambda name: tmp_path / name)
    monkeypatch.setattr(publicar_api, "_nube", lambda: False)
    r = publicar_api.estado("v1")
    assert r["blotato"] is False and r["error"]


def test_publicar_estado_con_almacen_caido_no_revienta(monkeypatch, tmp_path):
    from server import publicar_api
    (tmp_path / "v1").mkdir()
    monkeypatch.setattr(publicar_api, "_proyecto", lambda name: tmp_path / name)
    monkeypatch.setattr(publicar_api, "_nube", lambda: False)

    def caido(user):
        raise claves_usuario.ErrorAlmacen("x")
    monkeypatch.setattr(publicar_api.blotato, "clave_y_origen", caido)
    r = publicar_api.estado("v1")
    assert r["blotato"] is False and "No pudimos leer" in r["error"]


def _proyecto_con_pelicula(tmp_path) -> Path:
    p = tmp_path / "v1"
    p.mkdir()
    (p / "pelicula.mp4").write_bytes(b"mp4")
    return p


def _agendar_local(publicar_api, **cambios):
    from fastapi import BackgroundTasks
    tareas = BackgroundTasks()
    cuerpo = {"confirmar": True, "cuenta_id": "11", "plataforma": "tiktok", "texto": "hola",
              "archivo": "pelicula", "privacidad": "SELF_ONLY", **cambios}
    r = publicar_api.agendar("v1", publicar_api.AgendarIn(**cuerpo), tareas)
    for t in tareas.tasks:                 # lo que FastAPI corre tras responder
        t.func(*t.args, **t.kwargs)
    return r


def test_agendar_sin_conectar_dice_donde_conectar(monkeypatch, tmp_path):
    from fastapi import HTTPException
    from server import publicar_api
    p = _proyecto_con_pelicula(tmp_path)
    monkeypatch.setattr(publicar_api, "_proyecto", lambda name: p)
    monkeypatch.setattr(publicar_api, "_nube", lambda: False)
    with pytest.raises(HTTPException) as e:
        _agendar_local(publicar_api)
    assert e.value.status_code == 409 and "Blotato" in e.value.detail


@pytest.fixture
def local_v1(monkeypatch, tmp_path):
    from pipeline import storage
    from server import publicar_api
    monkeypatch.setattr(storage, "videos_root", lambda: tmp_path)
    p = _proyecto_con_pelicula(tmp_path)
    monkeypatch.setenv("DEFAULT_USER_ID", "u1")
    monkeypatch.setattr(publicar_api, "_nube", lambda: False)
    monkeypatch.setattr(db, "backend", lambda: "json")
    claves_usuario.guardar("u1", "BLOTATO_API_KEY", CLAVE)
    monkeypatch.setattr(publicar_api.blotato, "cuentas",
                        lambda clave, timeout=None: [{"id": "11", "platform": "tiktok"}])
    from worker import publicar_task
    monkeypatch.setattr(publicar_task, "ESPERA_RESULTADO_S", 0)
    return publicar_api


def test_agendar_sube_y_publica_con_la_clave_del_usuario(local_v1, monkeypatch):
    publicar_api = local_v1
    usadas = []
    monkeypatch.setattr(publicar_api.blotato, "subir_stream",
                        lambda clave, nombre, partes, tam:
                        usadas.append(("subir", clave, b"".join(partes))) or "https://cdn/v.mp4")
    monkeypatch.setattr(publicar_api.blotato, "publicar",
                        lambda clave, *a, **k: usadas.append(("publicar", clave))
                        or {"postSubmissionId": "p1"})
    r = _agendar_local(publicar_api)
    assert r["publicacion"]["estado"] == "pendiente"
    assert usadas == [("subir", CLAVE, b"mp4"), ("publicar", CLAVE)]
    [pub] = publicar_api.estado("v1")["publicaciones"]
    assert pub["estado"] == "enviado"


def test_agendar_fallido_no_repite_la_excepcion(local_v1, monkeypatch, caplog):
    publicar_api = local_v1

    def revienta(clave, nombre, partes, tam):
        raise RuntimeError(f"cabecera ilegal {clave}")
    monkeypatch.setattr(publicar_api.blotato, "subir_stream", revienta)
    with caplog.at_level(logging.DEBUG):
        _agendar_local(publicar_api)
    [pub] = publicar_api.estado("v1")["publicaciones"]
    assert pub["estado"] == "error"
    assert CLAVE not in pub["mensaje"] and CLAVE not in caplog.text


# ---------------------------------------------------------------------------
# el worker no hereda las claves del usuario anterior

class _Paginador:
    def __init__(self, por_ruta):
        self.por_ruta = por_ruta

    def paginate(self, Path, Recursive, WithDecryption):
        yield {"Parameters": [{"Name": Path + k, "Value": v}
                              for k, v in self.por_ruta.get(Path, {}).items()]}


@pytest.fixture
def env_worker(monkeypatch):
    from worker import env_ssm
    por_ruta = {
        f"{PREFIJO}/ana/": {"BLOTATO_API_KEY": "blotato-de-ana", "CLAUDE_API_KEY": "claude-de-ana"},
        f"{PREFIJO}/beto/": {},
        f"{PREFIJO}/caro/": {"CLAUDE_API_KEY": "claude-de-caro"},
    }
    cliente = SimpleNamespace(get_paginator=lambda nombre: _Paginador(por_ruta))
    monkeypatch.setitem(sys.modules, "boto3", SimpleNamespace(client=lambda servicio: cliente))
    monkeypatch.setattr(env_ssm, "_BASE", {})
    monkeypatch.setenv("SSM_USUARIOS_PREFIX", PREFIJO)
    monkeypatch.setenv("CLAUDE_API_KEY", "claude-de-la-plataforma")
    monkeypatch.delenv("BLOTATO_API_KEY", raising=False)
    return env_ssm


def test_el_siguiente_usuario_no_hereda_claves(env_worker):
    import os
    assert env_worker.cargar_env_usuario("ana") == 2
    assert os.environ["BLOTATO_API_KEY"] == "blotato-de-ana"
    assert os.environ["CLAUDE_API_KEY"] == "claude-de-ana"

    assert env_worker.cargar_env_usuario("beto") == 0
    assert "BLOTATO_API_KEY" not in os.environ
    assert os.environ["CLAUDE_API_KEY"] == "claude-de-la-plataforma"

    env_worker.cargar_env_usuario("caro")
    assert "BLOTATO_API_KEY" not in os.environ
    assert os.environ["CLAUDE_API_KEY"] == "claude-de-caro"

    env_worker.cargar_env_usuario("ana")
    env_worker.cargar_env_usuario("beto")
    assert os.environ["CLAUDE_API_KEY"] == "claude-de-la-plataforma"


def test_los_otros_trabajos_del_worker_arrancan_sin_las_claves_del_anterior(env_worker, monkeypatch):
    import os
    from worker import lambda_worker
    vistos = []

    def smoke():
        vistos.append((os.environ.get("BLOTATO_API_KEY"), os.environ.get("CLAUDE_API_KEY")))
        env_worker.cargar_env_usuario("ana")   # como un trabajo que sí carga las de su usuario
    monkeypatch.setattr(lambda_worker, "_smoke", smoke)
    monkeypatch.setattr(lambda_worker, "_sync_costes", lambda dias: None)
    env_worker.cargar_env_usuario("ana")
    msg = {"body": json.dumps({"tipo": "smoke"})}
    lambda_worker.handler({"Records": [msg, msg]}, None)   # dos mensajes en un lote
    assert vistos == [(None, "claude-de-la-plataforma")] * 2
    lambda_worker.handler({"tipo": "sync_costes"}, None)
    assert "BLOTATO_API_KEY" not in os.environ


def test_sin_prefijo_o_sin_usuario_tambien_limpia(env_worker, monkeypatch):
    import os
    env_worker.cargar_env_usuario("ana")
    assert env_worker.cargar_env_usuario("") == 0
    assert "BLOTATO_API_KEY" not in os.environ
    env_worker.cargar_env_usuario("ana")
    monkeypatch.setenv("SSM_USUARIOS_PREFIX", "")
    assert env_worker.cargar_env_usuario("ana") == 0
    assert os.environ["CLAUDE_API_KEY"] == "claude-de-la-plataforma"


# ---------------------------------------------------------------------------
# la infra: la API solo puede escribir la clave de Blotato de un usuario

def _politicas_api() -> list[dict]:
    pytest.importorskip("aws_cdk", reason="aws_cdk vive en infra/requirements.txt, no en la imagen")
    import aws_cdk as cdk
    if str(RAIZ / "infra") not in sys.path:
        sys.path.insert(0, str(RAIZ / "infra"))
    from stacks.api import ApiStack
    from stacks.db import DbStack
    from stacks.jobs import JobsStack
    from stacks.media import MediaStack
    env = cdk.Environment(account="191241816158", region="us-east-1")
    app = cdk.App()
    base = DbStack(app, "aws-media-db", env=env)
    media = MediaStack(app, "aws-media-media", env=env)
    jobs = JobsStack(app, "aws-media-jobs", env=env, cluster_db=base.cluster,
                     media_bucket=media.bucket,
                     cdn_domain=media.cdn.distribution_domain_name, image_ref="latest")
    ApiStack(app, "aws-media-api", env=env, cluster=base.cluster, media_bucket=media.bucket,
             cdn_domain=media.cdn.distribution_domain_name, jobs_queue=jobs.queue,
             producir_sm=jobs.state_machine, image_ref="latest")
    recursos = app.synth().get_stack_by_name("aws-media-api").template["Resources"]
    return [st for r in recursos.values() if r["Type"] == "AWS::IAM::Policy"
            for st in r["Properties"]["PolicyDocument"]["Statement"]]


def test_la_api_solo_escribe_la_clave_de_blotato():
    escrituras = []
    for st in _politicas_api():
        acciones = st["Action"] if isinstance(st["Action"], list) else [st["Action"]]
        if any(a.startswith("ssm:") and not a.startswith("ssm:Get") for a in acciones):
            escrituras.append(st)
    assert len(escrituras) == 1, escrituras
    st = escrituras[0]
    assert st["Effect"] == "Allow"
    assert sorted(st["Action"]) == ["ssm:DeleteParameter", "ssm:PutParameter"]
    assert st["Resource"] == ("arn:aws:ssm:us-east-1:191241816158:parameter"
                              "/media-ivenaccip/usuarios/*/BLOTATO_API_KEY")


# ---------------------------------------------------------------------------
# el precio que enseña el modal (sale de pricing.json, no del HTML)
#
# Las pantallas (static/index.html y el editor) se fijan en
# test_m23_blotato_clave_ui.py: así, retirar un HTML viejo no tumba estos tests.

def test_pricing_json_trae_el_plan_de_blotato():
    d = json.loads((RAIZ / "tools" / "pricing.json").read_text(encoding="utf-8"))
    b = d["blotato_suscripcion"]
    assert b["plan_minimo"]["nombre"] == "Starter"
    assert isinstance(b["plan_minimo"]["usd_por_mes"], (int, float))
    assert b["verified_on"] and "blotato.com" in b["source"]
