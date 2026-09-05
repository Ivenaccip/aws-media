"""M4 — recarga con Stripe: verificación de la firma del webhook, mapeo de
monto→pack, abono idempotente por referencia y los Payment Links por usuario.
Sin red: la firma HMAC es real (el mismo cálculo que hace Stripe), la base va
con monkeypatch."""
import hashlib
import hmac
import json
import time

import pytest
from fastapi.testclient import TestClient

from pipeline import creditos, db
from server import pagos_api

SECRETO = "whsec_prueba"


def _firmar(payload: bytes, secreto: str = SECRETO, t: int | None = None) -> str:
    t = t if t is not None else int(time.time())
    v1 = hmac.new(secreto.encode(), f"{t}.".encode() + payload, hashlib.sha256).hexdigest()
    return f"t={t},v1={v1}"


def _evento(tipo: str = "checkout.session.completed", **sesion) -> bytes:
    base = {"id": "cs_prueba_1", "amount_total": 199, "payment_status": "paid",
            "client_reference_id": "sub-abc"}
    base.update(sesion)
    return json.dumps({"type": tipo, "data": {"object": base}}).encode()


@pytest.fixture
def cliente(monkeypatch):
    monkeypatch.setenv("STRIPE_WEBHOOK_SECRET", SECRETO)
    from server.app import app
    return TestClient(app)


@pytest.fixture
def abonos(monkeypatch):
    hechos = []
    monkeypatch.setattr(db, "abonar_compra",
                        lambda u, n, r: hechos.append((u, n, r)) or 100 + n)
    return hechos


# ---------------------------------------------------------------------------
# firma

def test_firma_valida_abona(cliente, abonos):
    payload = _evento()
    r = cliente.post("/api/pagos/stripe", content=payload,
                     headers={"stripe-signature": _firmar(payload)})
    assert r.status_code == 200 and r.json()["creditos"] == 100
    assert abonos == [("sub-abc", 100, "stripe:cs_prueba_1")]


def test_pago_en_mxn_abona_por_el_monto_origen_usd(cliente, abonos):
    """Los Payment Links con precios adaptativos dejan pagar en MXN:
    amount_total llega en pesos y el USD real viaja en currency_conversion."""
    payload = _evento(amount_total=3495, currency="mxn",
                      currency_conversion={"amount_total": 199, "fx_rate": "17.5628",
                                           "source_currency": "usd"})
    r = cliente.post("/api/pagos/stripe", content=payload,
                     headers={"stripe-signature": _firmar(payload)})
    assert r.status_code == 200 and r.json()["creditos"] == 100
    assert abonos == [("sub-abc", 100, "stripe:cs_prueba_1")]


def test_divisa_desconocida_sin_conversion_es_abono_manual(cliente, abonos):
    payload = _evento(amount_total=199, currency="eur")
    r = cliente.post("/api/pagos/stripe", content=payload,
                     headers={"stripe-signature": _firmar(payload)})
    assert r.status_code == 200 and "abono manual" in r.json()["motivo"]
    assert abonos == []


def test_firma_invalida_400(cliente, abonos):
    payload = _evento()
    r = cliente.post("/api/pagos/stripe", content=payload,
                     headers={"stripe-signature": _firmar(payload, "whsec_otro")})
    assert r.status_code == 400 and not abonos


def test_firma_vieja_400(cliente, abonos):
    payload = _evento()
    r = cliente.post("/api/pagos/stripe", content=payload,
                     headers={"stripe-signature": _firmar(payload, t=int(time.time()) - 3600)})
    assert r.status_code == 400 and not abonos


def test_sin_header_400(cliente, abonos):
    r = cliente.post("/api/pagos/stripe", content=_evento())
    assert r.status_code == 400 and not abonos


def test_v1_rotadas_una_valida_pasa(cliente, abonos):
    payload = _evento()
    t = int(time.time())
    buena = _firmar(payload, t=t).split("v1=")[1]
    r = cliente.post("/api/pagos/stripe", content=payload,
                     headers={"stripe-signature": f"t={t},v1={'0' * 64},v1={buena}"})
    assert r.status_code == 200 and abonos


def test_sin_secreto_503(monkeypatch):
    monkeypatch.delenv("STRIPE_WEBHOOK_SECRET", raising=False)
    from server.app import app
    r = TestClient(app).post("/api/pagos/stripe", content=b"{}")
    assert r.status_code == 503
    assert not pagos_api.activo()


# ---------------------------------------------------------------------------
# casos ignorados con motivo (200 para que Stripe no reintente por gusto)

@pytest.mark.parametrize("payload,motivo", [
    (_evento(tipo="payment_intent.succeeded"), "evento ignorado"),
    (_evento(payment_status="unpaid"), "sin pago confirmado"),
    (_evento(client_reference_id=None), "sin client_reference_id"),
    (_evento(amount_total=123), "monto sin pack"),
])
def test_ignorados_no_abonan(cliente, abonos, payload, motivo):
    r = cliente.post("/api/pagos/stripe", content=payload,
                     headers={"stripe-signature": _firmar(payload)})
    assert r.status_code == 200 and motivo in r.json()["motivo"] and not abonos


def test_reintento_de_stripe_no_doble_abona(cliente, monkeypatch):
    monkeypatch.setattr(db, "abonar_compra", lambda u, n, r: None)  # ya en el libro
    payload = _evento()
    r = cliente.post("/api/pagos/stripe", content=payload,
                     headers={"stripe-signature": _firmar(payload)})
    assert r.status_code == 200 and "ya abonado" in r.json()["motivo"]


def test_todos_los_packs_mapean(cliente, abonos):
    for pack in creditos.PACKS:
        payload = _evento(id=f"cs_{pack['creditos']}",
                          amount_total=round(pack["usd"] * 100))
        r = cliente.post("/api/pagos/stripe", content=payload,
                         headers={"stripe-signature": _firmar(payload)})
        assert r.status_code == 200 and r.json()["creditos"] == pack["creditos"]
    assert [a[1] for a in abonos] == [p["creditos"] for p in creditos.PACKS]


# ---------------------------------------------------------------------------
# db.abonar_compra: idempotencia por el libro mayor

def test_abonar_compra_inserta_y_luego_suma(monkeypatch):
    sqls = []
    respuestas = iter([[], [{"id": 1}], [{"saldo": 170}]])  # usuarios, movimiento, saldo
    monkeypatch.setattr(db, "ejecutar", lambda s, p=None: sqls.append(s) or next(respuestas))
    assert db.abonar_compra("sub-abc", 100, "stripe:cs_x") == 170
    assert "ON CONFLICT (referencia) WHERE tipo = 'compra'" in sqls[1]
    assert "monedero" in sqls[2]


def test_abonar_compra_duplicado_no_toca_saldo(monkeypatch):
    sqls = []
    respuestas = iter([[], []])          # usuarios, movimiento en conflicto
    monkeypatch.setattr(db, "ejecutar", lambda s, p=None: sqls.append(s) or next(respuestas))
    assert db.abonar_compra("sub-abc", 100, "stripe:cs_x") is None
    assert len(sqls) == 2                # jamás llegó al UPDATE del saldo


# ---------------------------------------------------------------------------
# links de packs por usuario

def test_links_packs_incrusta_usuario(monkeypatch):
    monkeypatch.setenv("STRIPE_LINK_100", "https://buy.stripe.com/aaa")
    monkeypatch.setenv("STRIPE_LINK_500", "https://buy.stripe.com/bbb")
    monkeypatch.delenv("STRIPE_LINK_1200", raising=False)
    links = pagos_api.links_packs("sub-abc")
    assert links[100] == "https://buy.stripe.com/aaa?client_reference_id=sub-abc"
    assert links[500].endswith("sub-abc") and 1200 not in links


def test_api_creditos_lleva_links(monkeypatch):
    monkeypatch.setenv("CREDITOS_BACKEND", "postgres")
    monkeypatch.setenv("STRIPE_LINK_100", "https://buy.stripe.com/aaa")
    monkeypatch.delenv("STRIPE_LINK_500", raising=False)
    monkeypatch.delenv("STRIPE_LINK_1200", raising=False)
    monkeypatch.setattr(db, "saldo_creditos", lambda u: 42)
    monkeypatch.setattr(db, "movimientos_creditos", lambda u, n=20: [])
    from server.app import app
    d = TestClient(app).get("/api/creditos").json()
    por_creditos = {p["creditos"]: p for p in d["packs"]}
    assert por_creditos[100]["link"].endswith("client_reference_id=piloto")
    assert "link" not in por_creditos[500]      # sin env → sin link (concierge)


def test_webhook_es_publico_con_login_activo(monkeypatch):
    monkeypatch.setenv("COGNITO_POOL_ID", "us-east-1_TESTPOOL")
    monkeypatch.setenv("COGNITO_CLIENT_ID", "clienteweb123")
    monkeypatch.setenv("STRIPE_WEBHOOK_SECRET", SECRETO)
    from server.app import app
    r = TestClient(app).post("/api/pagos/stripe", content=b"{}")
    assert r.status_code == 400              # llegó al gate de firma, no al 401 del JWT
