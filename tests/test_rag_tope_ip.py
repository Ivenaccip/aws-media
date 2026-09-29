"""RAG·6 — tope por IP hasheada, sin guardar nunca la IP en claro.

El hash es HMAC con la sal de SSM; sin sal o sin IP se cierra. La cabecera de
Cloudflare solo se cree si el entorno lo dice (si no, cualquiera la falsifica
contra el execute-api). IPv6 cuenta por su /64."""
import pytest
from fastapi.testclient import TestClient

from pipeline import db, publico


@pytest.fixture(autouse=True)
def sal(monkeypatch):
    monkeypatch.setenv(publico.VAR_SAL, "sal-de-prueba")
    monkeypatch.delenv(publico.VAR_CLOUDFLARE, raising=False)


def _base(monkeypatch, *, tope_ip=None, de_ip=0):
    monkeypatch.setattr(db, "automatiza_interruptor", lambda: {
        "encendido": True, "tope_corridas": 1000, "tope_usd": None,
        "tope_por_ip": tope_ip, "nota": None, "creado": "x"})
    monkeypatch.setattr(db, "automatiza_consumo_hoy", lambda: {"corridas": 0, "usd": 0.0})
    vistos = []
    monkeypatch.setattr(db, "automatiza_corridas_de_ip_hoy",
                        lambda h: vistos.append(h) or de_ip)
    return vistos


# ---------------------------------------------------------------------------
# el hash

def test_hash_estable_y_sin_la_ip_dentro():
    h = publico.hash_ip("201.141.10.7")
    assert h == publico.hash_ip("201.141.10.7") and len(h) == 32
    assert "201" not in h and h != publico.hash_ip("201.141.10.8")


def test_hash_depende_de_la_sal(monkeypatch):
    a = publico.hash_ip("201.141.10.7")
    monkeypatch.setenv(publico.VAR_SAL, "otra-sal")
    assert publico.hash_ip("201.141.10.7") != a     # sin la sal no se puede recalcular


@pytest.mark.parametrize("ip", [None, ""])
def test_sin_ip_no_hay_hash(ip):
    assert publico.hash_ip(ip) is None


def test_sin_sal_no_hay_hash(monkeypatch):
    monkeypatch.delenv(publico.VAR_SAL)
    assert publico.hash_ip("201.141.10.7") is None


def test_ipv6_cuenta_por_su_64():
    a = publico.hash_ip("2806:2f0:9021:1::1")
    assert a == publico.hash_ip("2806:2f0:9021:1:ffff:abcd:1234:5")    # misma casa
    assert a != publico.hash_ip("2806:2f0:9021:2::1")                  # otra /64


# ---------------------------------------------------------------------------
# de dónde sale la IP

class _Req:
    def __init__(self, host, headers=None):
        self.client = type("C", (), {"host": host})() if host else None
        self.headers = headers or {}


def test_ip_por_defecto_la_de_api_gateway():
    r = _Req("54.1.2.3", {"cf-connecting-ip": "9.9.9.9"})
    assert publico.ip_del_request(r) == "54.1.2.3"   # la cabecera NO se cree sin Cloudflare


def test_ip_de_cloudflare_solo_si_el_entorno_lo_dice(monkeypatch):
    monkeypatch.setenv(publico.VAR_CLOUDFLARE, "1")
    assert publico.ip_del_request(_Req("172.64.0.1", {"cf-connecting-ip": "9.9.9.9"})) == "9.9.9.9"
    assert publico.ip_del_request(_Req("172.64.0.1")) == "172.64.0.1"


def test_sin_cliente_no_hay_ip():
    assert publico.ip_del_request(_Req(None)) is None


# ---------------------------------------------------------------------------
# el tope

def test_sin_hash_se_cierra(monkeypatch):
    _base(monkeypatch)
    assert publico.permiso(None) == publico.APAGADO


@pytest.mark.parametrize("de_ip,esperado", [(9, None), (10, "tope_ip"), (50, "tope_ip")])
def test_tope_por_ip_provisional(monkeypatch, de_ip, esperado):
    assert publico.TOPE_IP_PROVISIONAL == 10
    vistos = _base(monkeypatch, de_ip=de_ip)
    assert publico.permiso("abc") == esperado
    assert vistos == ["abc"]


def test_tope_por_ip_del_dueno(monkeypatch):
    _base(monkeypatch, tope_ip=3, de_ip=3)
    assert publico.permiso("abc") == publico.TOPE_IP
    _base(monkeypatch, tope_ip=3, de_ip=2)
    assert publico.permiso("abc") is None


def test_el_global_se_revisa_antes_que_el_de_ip(monkeypatch):
    _base(monkeypatch, de_ip=99)
    monkeypatch.setattr(db, "automatiza_consumo_hoy", lambda: {"corridas": 1000, "usd": 0.0})
    assert publico.permiso("abc") == publico.TOPE


def test_la_herramienta_puede_mirar_sin_ip(monkeypatch):
    vistos = _base(monkeypatch)
    assert publico.permiso(por_ip=False) is None and vistos == []


def test_contar_por_ip_es_del_dia_de_mexico_sin_rechazadas(monkeypatch):
    llamadas = []
    monkeypatch.setattr(db, "ejecutar",
                        lambda q, p=None: llamadas.append((" ".join(q.split()), p)) or [{"n": 4}])
    assert db.automatiza_corridas_de_ip_hoy("abc") == 4
    q, p = llamadas[0]
    assert "ip_hash = :h" in q and "estado <> 'rechazada'" in q
    assert "America/Mexico_City" in q and p == {"h": "abc"}


def test_ajustar_guarda_y_hereda_el_tope_por_ip(monkeypatch):
    llamadas, fila = [], {"v": None}

    def falso(q, p=None):
        q = " ".join(q.split())
        llamadas.append((q, p or {}))
        return [fila["v"]] if (q.startswith("SELECT encendido") and fila["v"]) else []
    monkeypatch.setattr(db, "ejecutar", falso)
    db.automatiza_ajustar(tope_por_ip=7)
    assert next(p for q, p in llamadas if q.startswith("INSERT"))["i"] == 7
    fila["v"] = {"encendido": True, "tope_corridas": 5, "tope_usd": None,
                 "tope_por_ip": 7, "nota": None, "creado": "x"}
    llamadas.clear()
    db.automatiza_ajustar(encendido=False)
    assert next(p for q, p in llamadas if q.startswith("INSERT"))["i"] == 7


# ---------------------------------------------------------------------------
# la IP en claro no llega a ningún lado

def test_estado_publico_pasa_el_hash_nunca_la_ip(monkeypatch):
    recibido = []
    monkeypatch.setattr(publico, "permiso", lambda h=None, **k: recibido.append(h) or None)
    from server.app import app
    r = TestClient(app).get("/api/publico/estado")
    assert r.json() == {"disponible": True}
    assert recibido == [publico.hash_ip("testclient")]


def test_la_sal_esta_en_la_lista_blanca_de_ssm():
    import importlib.util
    from pathlib import Path
    spec = importlib.util.spec_from_file_location(
        "ssm_env", Path(__file__).resolve().parent.parent / "tools" / "ssm_env.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    assert publico.VAR_SAL in mod.CLAVES
    assert publico.VAR_SAL not in mod.SOLO_PROD         # dev también la necesita


def test_la_sal_no_esta_en_el_codigo():
    import re
    from pathlib import Path
    raiz = Path(__file__).resolve().parent.parent
    for f in list(raiz.glob("pipeline/*.py")) + list(raiz.glob("server/*.py")) + list(raiz.glob("infra/**/*.py")):
        texto = f.read_text(encoding="utf-8")
        assert not re.search(r"AUTOMATIZA_SAL_IP\s*=\s*['\"]\w", texto), f
