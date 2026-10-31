"""Fase 2 — «¿No puedes entrar?»: la página /acceso y POST /api/acceso/nueva-clave.

Lo que se protege aquí, en orden de cuánto duele:

  * que por esta ruta anónima NUNCA se cree una cuenta ni se abone un crédito;
  * que no sirva para averiguar quién tiene cuenta (mismo cuerpo, mismo tiempo);
  * que no se coma el cupo de correo de la cuenta ni le mande dos claves seguidas
    a la misma persona (la segunda invalida la primera);
  * que la IP y el correo no lleguen al log;
  * que la excepción de auth sea esa ruta y ninguna otra.

La base es un doble en memoria (como en tests/test_invitaciones.py); el SQL nuevo
se corrió además contra un Postgres de verdad durante la entrega.
"""
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient

from pipeline import db
from pipeline import invitaciones as inv
from server import acceso, auth

RAIZ = Path(__file__).resolve().parent.parent
UTC = timezone.utc
AHORA = datetime(2026, 10, 30, 12, 0, tzinfo=UTC)
POOL = "us-east-1_prueba"
RUTA = "/api/acceso/nueva-clave"
LISTO = {"estado": "listo", "mensaje": acceso.MENSAJE_LISTO}
CUERPO_LISTO = ("Si tu cuenta aún no se activa, te enviamos una contraseña nueva: revisa tu correo "
                "y spam en unos minutos. Si ya habías entrado antes, usa «¿Olvidaste tu "
                "contraseña?» en la pantalla de entrar.")


def _error(codigo):
    e = Exception(f"falló con {codigo} para alguien@x.com")
    e.response = {"Error": {"Code": codigo}}
    return e


def _cuenta(estado="FORCE_CHANGE_PASSWORD", habilitada=True, modificada_hace=timedelta(days=10)):
    return {"Username": "uuid", "UserStatus": estado, "Enabled": habilitada,
            "UserAttributes": [{"Name": "email", "Value": "a@x.com"}, {"Name": "sub", "Value": "uuid"}],
            "UserCreateDate": AHORA - timedelta(days=30),
            "UserLastModifiedDate": AHORA - modificada_hace}


class Mundo:
    """La base y Cognito de mentira; `resend` son los correos que salieron de verdad."""

    def __init__(self):
        self.interruptor = {"modo": "activo", "tope": 40}
        self.envios = []
        self.miembros = {}
        self.solicitudes = {}
        self.cuentas = {}
        self.resend = []
        self.error_resend = None
        self.error_get = None
        self.base_caida = set()

    def fila(self, correo, paso=0, origen="bot", resultado="enviado", hace=timedelta(days=5)):
        self.envios.append({"id": len(self.envios) + 1, "correo": correo, "paso": paso,
                            "origen": origen, "resultado": resultado,
                            "creado": (AHORA - hace).isoformat()})

    def _quiza_caer(self, nombre):
        if nombre in self.base_caida:
            raise _error("BadRequestException")

    def contar(self, ip_hash, corte, tope):
        self._quiza_caer("contar")
        n = self.solicitudes.get(ip_hash, 0)
        if n < tope:
            self.solicitudes[ip_hash] = n + 1
        return n

    def leer_interruptor(self):
        self._quiza_caer("interruptor")
        return self.interruptor

    def gastado(self, corte):
        self._quiza_caer("gastado")
        return sum(1 for e in self.envios if e["resultado"] in inv.VIVOS
                   and inv.fecha(e["creado"]) >= inv.fecha(corte))

    def envios_de(self, correo):
        self._quiza_caer("envios_de")
        return [dict(e) for e in self.envios if e["correo"] == correo and e["resultado"] in inv.VIVOS]

    def estado(self, correo):
        self._quiza_caer("estado")
        return self.miembros.get(correo)

    def reclamar(self, correo, paso, *, corte, tope, desde):
        self._quiza_caer("reclamar")
        if self.gastado(corte) >= tope or any(inv.fecha(e["creado"]) >= inv.fecha(desde)
                                              for e in self.envios_de(correo)):
            return None
        self.envios.append({"id": len(self.envios) + 1, "correo": correo, "paso": paso,
                            "origen": "pagina", "resultado": "enviando",
                            "creado": AHORA.isoformat()})
        return len(self.envios)

    def marcar(self, id_, resultado, detalle=None):
        self._quiza_caer("marcar")
        self.envios[id_ - 1]["resultado"] = resultado

    # Cognito
    def admin_get_user(self, UserPoolId, Username):
        if self.error_get:
            raise self.error_get
        if Username not in self.cuentas:
            raise _error("UserNotFoundException")
        return self.cuentas[Username]

    def admin_create_user(self, **kw):
        assert kw.get("MessageAction") == "RESEND", "esta ruta jamás crea una cuenta"
        assert kw["UserPoolId"] == POOL
        if self.error_resend:
            raise self.error_resend
        self.resend.append(kw["Username"])
        return {}


@pytest.fixture
def mundo(monkeypatch):
    from tools import usuarios
    m = Mundo()
    monkeypatch.setenv("COGNITO_POOL_ID", POOL)
    monkeypatch.setenv("COGNITO_CLIENT_ID", "cliente")
    monkeypatch.setenv("AUTOMATIZA_SAL_IP", "sal-de-prueba")
    monkeypatch.setattr(acceso, "DURACION_MINIMA_S", 0)
    monkeypatch.setattr(db, "invitaciones_contar_solicitud", m.contar)
    monkeypatch.setattr(db, "invitaciones_interruptor", m.leer_interruptor)
    monkeypatch.setattr(db, "invitaciones_gastado_desde", m.gastado)
    monkeypatch.setattr(db, "invitaciones_envios_de", m.envios_de)
    monkeypatch.setattr(db, "invitaciones_estado_miembro", m.estado)
    monkeypatch.setattr(db, "invitaciones_reclamar_pagina", m.reclamar)
    monkeypatch.setattr(db, "invitaciones_marcar", m.marcar)
    monkeypatch.setattr(usuarios, "_cognito", lambda pool=None: m)
    # lo que nunca, por ninguna rama, se puede tocar desde aquí
    monkeypatch.setattr(usuarios, "alta", lambda *a, **k: pytest.fail("la página llamó a alta()"))
    monkeypatch.setattr(db, "abonar_creditos", lambda *a, **k: pytest.fail("la página abonó créditos"))
    real = acceso.datetime

    class Reloj(real):
        @classmethod
        def now(cls, tz=None):
            return AHORA
    monkeypatch.setattr(acceso, "datetime", Reloj)
    return m


@pytest.fixture
def cliente(mundo):
    from server.app import app
    return TestClient(app)


def pedir(cliente, correo="a@x.com", **kw):
    return cliente.post(RUTA, json={"correo": correo}, **kw)


# ---------------------------------------------------------------------------
# el caso bueno, y que solo ahí sale un correo

def test_cuenta_que_nunca_entro_recibe_su_clave(cliente, mundo):
    mundo.cuentas["a@x.com"] = _cuenta()
    mundo.fila("a@x.com", paso=2, origen="historial", hace=timedelta(days=9))
    r = pedir(cliente, "  A@X.com ")
    assert r.status_code == 200 and r.content == JSONResponse(LISTO).body
    assert r.json()["mensaje"] == CUERPO_LISTO, "el texto lo fijó el dueño"
    assert r.headers["cache-control"] == "no-store"
    assert mundo.resend == ["a@x.com"]
    fila = mundo.envios[-1]
    assert (fila["origen"], fila["paso"], fila["resultado"]) == ("pagina", 2, "enviado")


def test_se_anota_antes_de_llamar_a_cognito(cliente, mundo, monkeypatch):
    mundo.cuentas["a@x.com"] = _cuenta()
    vistas = []
    original = mundo.admin_create_user

    def resend(**kw):
        vistas.append([e["resultado"] for e in mundo.envios])
        return original(**kw)
    mundo.admin_create_user = resend
    pedir(cliente)
    assert vistas == [["enviando"]]


def _prepara(mundo, caso):
    if caso == "inexistente":
        return
    if caso == "confirmada":
        mundo.cuentas["a@x.com"] = _cuenta("CONFIRMED")
    elif caso == "deshabilitada":
        mundo.cuentas["a@x.com"] = _cuenta(habilitada=False)
    elif caso == "excluida":
        mundo.cuentas["a@x.com"] = _cuenta()
        mundo.miembros["a@x.com"] = "excluido"
    elif caso == "envio_reciente":
        mundo.cuentas["a@x.com"] = _cuenta()
        mundo.fila("a@x.com", paso=1, origen="manual", hace=timedelta(hours=23))
    elif caso == "enviando_reciente":
        mundo.cuentas["a@x.com"] = _cuenta()
        mundo.fila("a@x.com", paso=1, resultado="enviando", hace=timedelta(hours=1))
    elif caso == "tocada_reciente":
        mundo.cuentas["a@x.com"] = _cuenta(modificada_hace=timedelta(hours=23))
    else:
        raise AssertionError(caso)


@pytest.mark.parametrize("caso", ["inexistente", "confirmada", "deshabilitada", "excluida",
                                  "envio_reciente", "enviando_reciente", "tocada_reciente"])
def test_misma_respuesta_exacta_y_ningun_correo(cliente, mundo, caso):
    _prepara(mundo, caso)
    antes = list(mundo.envios)
    r = pedir(cliente)
    assert (r.status_code, r.content) == (200, JSONResponse(LISTO).body)
    assert mundo.resend == [], "solo el caso bueno manda"
    assert mundo.envios == antes, "y no deja fila que cuente en el cupo"


def test_quien_no_aparece_en_el_export_no_se_bloquea(cliente, mundo):
    """Varias cuentas legítimas no salen en el export con su correo."""
    mundo.cuentas["a@x.com"] = _cuenta()
    assert mundo.miembros == {}
    assert pedir(cliente).json() == LISTO
    assert mundo.resend == ["a@x.com"]


@pytest.mark.parametrize("estado", ["ok", "revisar"])
def test_solo_excluido_bloquea_por_el_export(cliente, mundo, estado):
    mundo.cuentas["a@x.com"] = _cuenta()
    mundo.miembros["a@x.com"] = estado
    pedir(cliente)
    assert mundo.resend == ["a@x.com"]


def test_un_envio_de_hace_mas_de_un_dia_no_frena(cliente, mundo):
    mundo.cuentas["a@x.com"] = _cuenta()
    mundo.fila("a@x.com", paso=1, hace=timedelta(hours=25))
    mundo.fila("a@x.com", paso=2, resultado="fallo:X", hace=timedelta(hours=1))
    mundo.fila("a@x.com", paso=2, resultado="ensayo", hace=timedelta(hours=1))
    pedir(cliente)
    assert mundo.resend == ["a@x.com"]
    assert mundo.envios[-1]["paso"] == 1, "ni el fallo ni el ensayo suben el paso"


def test_si_otra_solicitud_gano_en_lo_que_se_decidia_no_se_manda(cliente, mundo, monkeypatch):
    mundo.cuentas["a@x.com"] = _cuenta()
    monkeypatch.setattr(db, "invitaciones_reclamar_pagina", lambda *a, **k: None)
    assert pedir(cliente).json() == LISTO
    assert mundo.resend == []


# ---------------------------------------------------------------------------
# correo inválido

@pytest.mark.parametrize("cuerpo,tipo", [
    (b'{"correo": "no-es-correo"}', "application/json"),
    (b'{"correo": ""}', "application/json"),
    (b'{"correo": 5}', "application/json"),
    (b'{"otro": "a@x.com"}', "application/json"),
    (b'["a@x.com"]', "application/json"),
    (b"esto no es json", "application/json"),
    (b'{"correo": "a@x.com"}', "text/plain"),       # un formulario de otro sitio
    # el navegador lo trata como text/plain: sin preflight, aunque traiga el texto
    (b'{"correo": "a@x.com"}', "text/plain; x=application/json"),
    (b'{"correo": "a@x.com"}', "text/plain, application/json"),
    (b'{"correo": "a@x.com"}', "application/jsonp"),
    (b"[" * 1500, "application/json"),              # RecursionError, no ValueError
    (b"correo=a@x.com", "application/x-www-form-urlencoded"),
    (b'{"correo": "' + b"a" * 300 + b'@x.com"}', "application/json"),
    (b'{"correo": "' + b"a" * 3000 + b'@x.com"}', "application/json"),
])
def test_correo_invalido_es_400_y_no_toca_nada(cliente, mundo, cuerpo, tipo):
    r = cliente.post(RUTA, content=cuerpo, headers={"Content-Type": tipo})
    assert r.status_code == 400
    assert r.json() == {"estado": "correo_invalido", "mensaje": acceso.MENSAJE_CORREO}
    assert mundo.solicitudes == {} and mundo.resend == []


@pytest.mark.parametrize("tipo", ["application/json", "Application/JSON",
                                  "application/json; charset=utf-8"])
def test_el_json_de_verdad_si_pasa(cliente, mundo, tipo):
    r = cliente.post(RUTA, content=b'{"correo": "a@x.com"}', headers={"Content-Type": tipo})
    assert r.status_code == 200 and r.json() == LISTO


# ---------------------------------------------------------------------------
# límite por IP

def test_seis_solicitudes_de_una_ip_y_la_sexta_se_frena(cliente, mundo):
    for i in range(acceso.TOPE_POR_IP):
        assert pedir(cliente, f"p{i}@x.com").status_code == 200
    r = pedir(cliente, "p9@x.com")
    assert r.status_code == 429
    assert r.json() == {"estado": "limite", "mensaje": "Ya hiciste varios intentos hoy. Inténtalo mañana."}


def test_el_limite_va_antes_que_todo_lo_demas(cliente, mundo):
    mundo.cuentas["a@x.com"] = _cuenta()
    mundo.solicitudes = {k: 5 for k in [_hash_de_testclient()]}
    assert pedir(cliente).status_code == 429
    assert mundo.resend == []


def _hash_de_testclient():
    from pipeline import publico
    return publico.hash_ip("testclient")


def test_lo_guardado_es_un_hash_y_no_la_ip(cliente, mundo):
    pedir(cliente)
    (guardado,) = mundo.solicitudes
    assert "testclient" not in guardado and re.fullmatch(r"[0-9a-f]{32}", guardado)


def test_sin_sal_cierra_y_no_manda(cliente, mundo, monkeypatch):
    """Sin sal no se puede contar por visitante, y eso cierra (igual que /automatiza)."""
    monkeypatch.delenv("AUTOMATIZA_SAL_IP")
    mundo.cuentas["a@x.com"] = _cuenta()
    r = pedir(cliente)
    assert r.status_code == 503 and r.json()["mensaje"] == "Ahorita no se pudo. Inténtalo más tarde."
    assert mundo.resend == []


class _Peticion:
    def __init__(self, directa, cabecera=None):
        self.client = type("C", (), {"host": directa})()
        self.headers = {"cf-connecting-ip": cabecera} if cabecera else {}


@pytest.mark.parametrize("directa,cabecera,esperada", [
    # detrás de Cloudflare (prod): API Gateway ve el borde; cuenta la del visitante
    ("172.70.1.1", "187.190.5.5", "187.190.5.5"),
    ("2606:4700::1", "2001:db8::5", "2001:db8::5"),
    # directo al execute-api con la cabecera inventada: no vale
    ("187.190.5.5", "1.1.1.1", "187.190.5.5"),
    # del borde pero con basura: mejor el borde que confiar en la basura
    ("172.70.1.1", "no-es-ip", "172.70.1.1"),
    ("172.70.1.1", None, "172.70.1.1"),
])
def test_de_donde_sale_la_ip(directa, cabecera, esperada):
    assert acceso.ip_del_visitante(_Peticion(directa, cabecera)) == esperada


# ---------------------------------------------------------------------------
# el cupo

SIN_CUPO = {"estado": "sin_cupo",
            "mensaje": "Hoy ya se enviaron todos los correos disponibles. Inténtalo mañana."}


def test_sin_cupo_lo_dice_y_no_mira_la_cuenta(cliente, mundo):
    mundo.interruptor["tope"] = 2
    mundo.fila("x@x.com", hace=timedelta(hours=1), origen="manual")
    mundo.fila("y@x.com", hace=timedelta(hours=2), origen="pagina", resultado="enviando")
    mundo.error_get = AssertionError("con el cupo agotado no se mira la cuenta")
    r = pedir(cliente)
    assert (r.status_code, r.json()) == (200, SIN_CUPO)
    assert mundo.resend == []


def test_lo_de_antes_del_corte_ya_no_cuenta(cliente, mundo):
    """Las 12:00 UTC: lo de las 08:59 es del día anterior de Cognito."""
    mundo.interruptor["tope"] = 1
    mundo.fila("x@x.com", hace=timedelta(hours=3, minutes=1))
    mundo.cuentas["a@x.com"] = _cuenta()
    assert pedir(cliente).json() == LISTO
    assert mundo.resend == ["a@x.com"]


def test_tope_cero_apaga_la_pagina(cliente, mundo):
    mundo.interruptor["tope"] = 0
    mundo.cuentas["a@x.com"] = _cuenta()
    assert pedir(cliente).json() == SIN_CUPO
    assert mundo.resend == []


@pytest.mark.parametrize("modo", ["apagado", "ensayo"])
def test_el_modo_del_bot_no_apaga_la_pagina(cliente, mundo, modo):
    mundo.interruptor["modo"] = modo
    mundo.cuentas["a@x.com"] = _cuenta()
    assert pedir(cliente).json() == LISTO
    assert mundo.resend == ["a@x.com"]


def test_sin_filas_en_el_interruptor_vale_el_tope_de_defecto(cliente, mundo):
    mundo.interruptor = None
    mundo.cuentas["a@x.com"] = _cuenta()
    for i in range(inv.TOPE_DEFECTO):
        mundo.fila(f"p{i}@x.com", hace=timedelta(hours=1))
    assert pedir(cliente).json() == SIN_CUPO
    mundo.envios.pop()
    assert pedir(cliente).json() == LISTO


def test_la_pagina_si_llega_hasta_el_tope(cliente, mundo):
    """La reserva frena al bot, no a la página: con 39 de 40 todavía sale uno."""
    mundo.cuentas["a@x.com"] = _cuenta()
    for i in range(39):
        mundo.fila(f"p{i}@x.com", hace=timedelta(hours=1))
    assert pedir(cliente).json() == LISTO
    assert mundo.resend == ["a@x.com"]


# ---------------------------------------------------------------------------
# cuando algo falla

NO_SE_PUDO = {"estado": "no_se_pudo", "mensaje": "Ahorita no se pudo. Inténtalo más tarde."}


@pytest.mark.parametrize("donde", ["contar", "interruptor", "gastado", "envios_de", "estado"])
@pytest.mark.parametrize("con_cuenta", [True, False])
def test_base_caida_es_503_con_cuenta_o_sin_ella(cliente, mundo, donde, con_cuenta):
    """Todo lo que se lee de la base va ANTES de Cognito: si no, una base caída
    a medias contestaría distinto a quien tiene cuenta."""
    if con_cuenta:
        mundo.cuentas["a@x.com"] = _cuenta()
    mundo.base_caida.add(donde)
    r = pedir(cliente)
    assert (r.status_code, r.json()) == (503, NO_SE_PUDO)
    assert mundo.resend == []


def test_si_no_se_pudo_anotar_no_se_manda(cliente, mundo):
    mundo.cuentas["a@x.com"] = _cuenta()
    mundo.base_caida.add("reclamar")
    assert pedir(cliente).json() == LISTO
    assert mundo.resend == []


def test_si_no_se_pudo_marcar_la_fila_queda_viva(cliente, mundo):
    """El correo pudo salir: 'enviando' cuenta como mandado, que es lo prudente."""
    mundo.cuentas["a@x.com"] = _cuenta()
    mundo.base_caida.add("marcar")
    assert pedir(cliente).json() == LISTO
    assert mundo.resend == ["a@x.com"] and mundo.envios[-1]["resultado"] == "enviando"


@pytest.mark.parametrize("codigo", ["LimitExceededException", "TooManyRequestsException"])
def test_el_tope_de_cognito_se_anota_y_responde_igual(cliente, mundo, codigo):
    from tools import usuarios
    assert codigo in usuarios.CODIGOS_DE_TOPE
    mundo.cuentas["a@x.com"] = _cuenta()
    mundo.error_resend = _error(codigo)
    assert pedir(cliente).json() == LISTO
    assert mundo.envios[-1]["resultado"] == f"fallo:{codigo}"
    # un fallo no cuenta: mañana (o en un rato) esa persona puede volver a pedir
    assert mundo.gastado((AHORA - timedelta(hours=3)).isoformat()) == 0


def test_otro_error_de_cognito_al_leer_responde_igual_y_no_manda(cliente, mundo):
    mundo.cuentas["a@x.com"] = _cuenta()
    mundo.error_get = _error("InternalErrorException")
    assert pedir(cliente).json() == LISTO
    assert mundo.resend == []


# ---------------------------------------------------------------------------
# el tiempo y el log

def test_la_respuesta_listo_tarda_lo_minimo(cliente, mundo, monkeypatch):
    esperas = []

    async def dormir(s):
        esperas.append(s)
    monkeypatch.setattr(acceso, "_dormir", dormir)
    monkeypatch.setattr(acceso, "DURACION_MINIMA_S", 2.0)
    pedir(cliente)                                  # sin cuenta
    mundo.cuentas["b@x.com"] = _cuenta()
    pedir(cliente, "b@x.com")                       # con correo
    assert len(esperas) == 2 and all(0 < s <= 2.0 for s in esperas)


def test_el_400_y_el_429_no_esperan(cliente, mundo, monkeypatch):
    async def dormir(s):
        pytest.fail("aquí no hay nada que igualar")
    monkeypatch.setattr(acceso, "_dormir", dormir)
    monkeypatch.setattr(acceso, "DURACION_MINIMA_S", 2.0)
    assert pedir(cliente, "nada").status_code == 400
    mundo.solicitudes = {_hash_de_testclient(): 5}
    assert pedir(cliente).status_code == 429


@pytest.mark.parametrize("caso", ["manda", "sin_cuenta", "tope_cognito", "base_caida"])
def test_ni_el_correo_ni_la_ip_llegan_al_log(cliente, mundo, caplog, capsys, caso):
    if caso != "sin_cuenta":
        mundo.cuentas["secreto@x.com"] = _cuenta()
    if caso == "tope_cognito":
        mundo.error_resend = _error("LimitExceededException")
    if caso == "base_caida":
        mundo.base_caida.add("envios_de")
    caplog.set_level("DEBUG", logger="acceso")
    pedir(cliente, "secreto@x.com")
    salida = caplog.text + "".join(capsys.readouterr())
    assert "secreto" not in salida and "testclient" not in salida
    if caso != "base_caida":
        assert acceso._huella("secreto@x.com") in caplog.text, "la huella sí, para poder seguirla"


# ---------------------------------------------------------------------------
# con el bot: la fila no avanza la serie, y el bot la respeta

def test_la_fila_de_la_pagina_no_avanza_la_serie(cliente, mundo):
    mundo.cuentas["a@x.com"] = _cuenta()
    mundo.fila("a@x.com", paso=1, origen="historial", hace=timedelta(days=9))
    pedir(cliente)
    fila = mundo.envios[-1]
    assert fila["paso"] == 1
    pasos = inv.pasos_por_correo(mundo.envios)
    assert pasos["a@x.com"] == (1, AHORA), "mismo paso; el último contacto es hoy"


def _el_bot_a_los(dias, envios):
    ahora = AHORA + timedelta(days=dias)
    miembro = inv.Miembro(correo="a@x.com", nombre="A", plan="anual", categoria="anual")
    u = {"correo": "a@x.com", "estado": "FORCE_CHANGE_PASSWORD", "habilitado": True,
         "creado": AHORA - timedelta(days=9), "modificado": AHORA}
    return [(e.correo, e.paso) for e in inv.candidatos([miembro], [u], envios, ahora)]


def test_el_bot_le_manda_el_recordatorio_que_le_tocaba_y_a_su_tiempo(cliente, mundo):
    """Tenía R1. Pide clave hoy: el bot NO le manda nada hasta 4 días después (es
    su último correo), y lo que le manda entonces es R2, no R3."""
    mundo.cuentas["a@x.com"] = _cuenta()
    mundo.fila("a@x.com", paso=1, origen="historial", hace=timedelta(days=9))
    pedir(cliente)
    assert _el_bot_a_los(3, mundo.envios) == []
    assert _el_bot_a_los(4, mundo.envios) == [("a@x.com", 2)]


def test_quien_no_tenia_pasos_se_anota_en_cero(cliente, mundo):
    mundo.cuentas["a@x.com"] = _cuenta()
    pedir(cliente)
    assert mundo.envios[-1]["paso"] == 0
    assert _el_bot_a_los(3, mundo.envios) == [("a@x.com", 1)]


def test_la_fila_de_la_pagina_cuenta_en_lo_gastado_del_bot(cliente, mundo):
    mundo.cuentas["a@x.com"] = _cuenta()
    pedir(cliente)
    assert inv.gastado_hoy(mundo.envios, [], AHORA) == 1


def test_una_fila_atorada_de_la_pagina_no_sale_como_atorado_del_bot():
    """El aviso de atorados pide revisar la cortesía; aquí nunca hubo cortesía."""
    atorada = {"correo": "a@x.com", "paso": 0, "origen": "pagina", "resultado": "enviando",
               "creado": (AHORA - timedelta(days=1)).isoformat()}
    assert inv.atorados([atorada], AHORA) == []
    assert inv.gastado_hoy([{**atorada, "creado": AHORA.isoformat()}], [], AHORA) == 1


def test_la_sentencia_de_la_pagina_no_choca_con_el_indice_del_bot(monkeypatch):
    vistas = []
    monkeypatch.setattr(db, "ejecutar", lambda sql, p=None: vistas.append((sql, p)) or [{"id": 3}])
    assert db.invitaciones_reclamar_pagina(" A@x.com", 2, corte="c", tope=40, desde="d") == 3
    sql, p = vistas[0]
    assert "'pagina'" in sql and "ON CONFLICT DO NOTHING" in sql
    assert p == {"c": "a@x.com", "p": 2, "corte": "c", "t": 40, "desde": "d"}
    indice = next(s for s in db.ESQUEMA if "invitaciones_envios_bot_paso" in s)
    assert "origen = 'bot'" in indice, "el índice único solo mira las filas del bot"
    suyo = next(s for s in db.ESQUEMA if "invitaciones_envios_pagina_dia" in s)
    assert "UNIQUE" in suyo and "origen = 'pagina'" in suyo and "('enviando', 'enviado')" in suyo
    assert "AS date" in suyo, "por día: una fila vieja no le impide volver a pedir"


def test_el_esquema_acepta_el_origen_nuevo_y_guarda_solo_el_hash():
    texto = "\n".join(db.ESQUEMA)
    assert "CHECK (origen IN ('bot', 'manual', 'historial', 'pagina'))" in texto
    assert "CHECK (origen IN ('bot', 'manual', 'historial'))" not in texto
    # si la tabla ya existía con el CHECK viejo, el migrate lo reemplaza
    assert "DROP CONSTRAINT IF EXISTS invitaciones_envios_origen_check" in texto
    tabla = next(s for s in db.ESQUEMA if "CREATE TABLE IF NOT EXISTS invitaciones_solicitudes" in s)
    assert "ip_hash" in tabla and not re.search(r"\bip\b|correo", tabla)


def test_el_motivo_lee_tambien_lo_que_devuelve_admin_get_user():
    u = inv.usuario_de_cognito(_cuenta())
    assert u["correo"] == "a@x.com" and u["estado"] == "FORCE_CHANGE_PASSWORD" and u["habilitado"]
    assert inv.motivo_para_no_mandar(u, [], None, AHORA) is None


# ---------------------------------------------------------------------------
# la excepción de auth es esa ruta y ninguna otra

@pytest.fixture
def nube(mundo, monkeypatch):
    monkeypatch.setattr(auth, "verificar", lambda t: (_ for _ in ()).throw(ValueError(t)))
    from server.app import app
    return TestClient(app)


def test_la_ruta_no_pide_sesion(nube, mundo):
    assert auth.activo()
    assert pedir(nube).status_code == 200


@pytest.mark.parametrize("ruta", ["/api/acceso/otra", "/api/acceso/", "/api/acceso",
                                  "/api/acceso/nueva-clave/", "/api/acceso/nueva-clave/x",
                                  "/api/acceso/nueva-clavex"])
def test_lo_demas_bajo_api_sigue_pidiendo_sesion(nube, ruta):
    assert nube.post(ruta, json={"correo": "a@x.com"}, follow_redirects=False).status_code == 401


def test_la_excepcion_es_exacta():
    assert "/api/acceso/nueva-clave" in auth.RUTAS_PUBLICAS
    assert not any(p.startswith("/api/acceso") for p in auth.PREFIJOS_PUBLICOS)
    assert not auth.es_publica("/api/acceso/nueva-clave")


def test_un_token_ajeno_no_le_pone_identidad(nube, mundo):
    """La ruta corre dentro del candado: nada de aquí puede caer en un usuario."""
    vistos = []
    original = mundo.leer_interruptor

    def leer():
        vistos.append(db.en_camino_publico())
        return original()
    db_leer = db.invitaciones_interruptor
    db.invitaciones_interruptor = leer
    try:
        pedir(nube, headers={"Authorization": "Bearer lo-que-sea"})
    finally:
        db.invitaciones_interruptor = db_leer
    assert vistos == [True]


# ---------------------------------------------------------------------------
# la página

@pytest.mark.parametrize("metodo", ["get", "head"])
def test_la_pagina_sirve_con_su_csp_sin_sesion(nube, metodo):
    r = getattr(nube, metodo)("/acceso", follow_redirects=False)
    assert r.status_code == 200
    csp = r.headers["content-security-policy"]
    assert "script-src 'self'" in csp and "style-src 'self'" in csp
    assert "'unsafe-inline'" not in csp
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["cache-control"] == "no-cache"


def test_noindex_fuera_del_dominio(nube):
    assert nube.get("/acceso").headers["x-robots-tag"] == "noindex, nofollow"
    r = nube.get("/acceso", headers={"host": "irremplazables.xyz"})
    assert "x-robots-tag" not in r.headers


def test_la_pagina_no_lleva_nada_en_linea():
    html = re.sub(r"<!--.*?-->", "", (RAIZ / "static" / "acceso.html").read_text(encoding="utf-8"),
                  flags=re.S)
    assert not re.search(r"<script(?![^>]*\bsrc=)[^>]*>", html, re.I), "<script> en línea"
    assert not re.search(r"<style\b", html, re.I), "<style>"
    assert not re.search(r"\sstyle\s*=", html, re.I), "atributo style="
    assert not re.search(r"\son[a-z]+\s*=", html, re.I), "manejador on…= en línea"


def test_los_textos_del_dueno():
    html = (RAIZ / "static" / "acceso.html").read_text(encoding="utf-8")
    assert "<h1>¿No puedes entrar?</h1>" in html
    assert "Enviarme una contraseña nueva" in html
    assert '<a href="/entrar">' in html
    assert 'type="email"' in html and "required" in html


def test_sus_archivos_salen_tambien_donde_no_hay_automatiza(nube, monkeypatch):
    """/automatiza es 404 en producción y su CSS también: la página no puede
    colgarse de él, o en prod saldría sin estilos."""
    html = (RAIZ / "static" / "acceso.html").read_text(encoding="utf-8")
    assert "automatiza" not in html
    from pipeline import publico
    monkeypatch.setattr(publico, "publicado", lambda: False)
    assert nube.get("/acceso").status_code == 200
    for archivo in ("/acceso.css", "/acceso.js", "/carta.css"):
        assert nube.get(archivo).status_code == 200, archivo


def test_la_plantilla_cruda_no_sale_sin_su_csp(nube):
    r = nube.get("/acceso.html", follow_redirects=False)
    assert r.status_code == 302 and r.headers["location"] == "/acceso"


def test_el_js_trata_la_rafaga_de_api_gateway():
    """El 429 de API Gateway dice {"message": ...}, sin `mensaje`: sin el respaldo
    la página enseñaría «undefined»."""
    js = (RAIZ / "static" / "acceso.js").read_text(encoding="utf-8")
    assert "/api/acceso/nueva-clave" in js and "application/json" in js
    assert "datos.mensaje) || NO_SE_PUDO" in js
    assert "textContent" in js and "innerHTML" not in js


def test_entrar_lleva_a_la_pagina():
    html = (RAIZ / "static" / "entrar.html").read_text(encoding="utf-8")
    assert '<a href="/acceso">¿No puedes entrar? Pide una contraseña nueva</a>' in html


def test_acceso_no_puede_llamar_a_alta():
    """Una ruta anónima que crea cuentas y abona créditos sería lo peor de este
    cambio: ni siquiera se menciona. El resto lo prueban los dobles de arriba."""
    fuente = (RAIZ / "server" / "acceso.py").read_text(encoding="utf-8")
    sin_docstring = fuente.split('"""', 2)[2]
    assert "usuarios.alta" not in sin_docstring and "abonar" not in sin_docstring
    assert "usuarios.reenviar_provisional(pool, correo)" in sin_docstring
