"""M4 — recarga con Stripe: webhook de abono + links de los packs.

Jamás manejamos tarjetas: el usuario paga en un Payment Link de Stripe (uno por
pack, creados por el dueño en el dashboard) y Stripe nos avisa por webhook. El
`client_reference_id` del link viaja con el user_id (lo incrusta /api/creditos
al armar el link), y el abono es idempotente por el libro mayor
(db.abonar_compra + índice único de compras): Stripe reintenta webhooks.

Encendido por envs (viven en SSM /media-ivenaccip/env, las sube el dueño con
tools/ssm_env.py — nunca viajan por chat):
  STRIPE_WEBHOOK_SECRET  whsec_… del endpoint de webhook (SecureString)
  STRIPE_LINK_100/500/1200  URLs de los Payment Links (buy.stripe.com/…)
Sin ellas —dev local— el webhook responde 503 y los packs no llevan link
(la UI cae al modo concierge de siempre).

La firma se verifica a mano (HMAC-SHA256 de "t.payload" contra los v1 del
header Stripe-Signature) para no fijar la librería de Stripe entera por un
solo endpoint.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import time

from fastapi import APIRouter, HTTPException, Request

from pipeline import creditos, db

log = logging.getLogger("pagos")
router = APIRouter()

TOLERANCIA_S = 300          # ventana anti-replay del timestamp de la firma


def activo() -> bool:
    return bool(os.getenv("STRIPE_WEBHOOK_SECRET"))


# ---------------------------------------------------------------------------
# links de los packs (los consume GET /api/creditos)

def links_packs(user_id: str) -> dict[int, str]:
    """Payment Link por pack con el user_id incrustado: Stripe lo devuelve tal
    cual en client_reference_id y el webhook sabe a quién abonar."""
    links: dict[int, str] = {}
    for pack in creditos.PACKS:
        url = os.getenv(f"STRIPE_LINK_{pack['creditos']}", "")
        if url:
            links[pack["creditos"]] = f"{url}?client_reference_id={user_id}"
    return links


# ---------------------------------------------------------------------------
# verificación de la firma del webhook

def _firma_valida(payload: bytes, encabezado: str, secreto: str,
                  ahora: float | None = None) -> bool:
    """Stripe-Signature: `t=<unix>,v1=<hmac>[,v1=…]` — la firma esperada es
    HMAC-SHA256(secreto, f"{t}.{payload}"). v1 puede venir repetida (rotación
    de secretos); basta con que UNA coincida y el timestamp esté fresco."""
    t, v1s = None, []
    for parte in encabezado.split(","):
        clave, _, valor = parte.strip().partition("=")
        if clave == "t":
            t = valor
        elif clave == "v1":
            v1s.append(valor)
    if not t or not v1s or not t.isdigit():
        return False
    if abs((ahora or time.time()) - int(t)) > TOLERANCIA_S:
        return False
    esperada = hmac.new(secreto.encode(), f"{t}.".encode() + payload,
                        hashlib.sha256).hexdigest()
    return any(hmac.compare_digest(esperada, v) for v in v1s)


def _pack_por_monto(centavos: int) -> dict | None:
    for pack in creditos.PACKS:
        if round(pack["usd"] * 100) == centavos:
            return pack
    return None


@router.post("/api/pagos/stripe")
async def webhook_stripe(request: Request):
    """Ruta PÚBLICA (Stripe no trae JWT — está en RUTAS_PUBLICAS de auth.py).

    Devuelve 200 en todo caso "ignorado con motivo" para que Stripe no
    reintente eternamente algo que nunca va a proceder; 400 solo con firma
    inválida (señal de configuración rota, ahí SÍ queremos el reintento)."""
    secreto = os.getenv("STRIPE_WEBHOOK_SECRET", "")
    if not secreto:
        raise HTTPException(503, "Pagos no configurados")
    payload = await request.body()
    if not _firma_valida(payload, request.headers.get("stripe-signature", ""), secreto):
        raise HTTPException(400, "Firma inválida")

    evento = json.loads(payload)
    if evento.get("type") != "checkout.session.completed":
        return {"ok": True, "motivo": f"evento ignorado: {evento.get('type')}"}

    sesion = evento.get("data", {}).get("object", {})
    if sesion.get("payment_status") != "paid":
        return {"ok": True, "motivo": "sesión sin pago confirmado"}

    user_id = sesion.get("client_reference_id")
    if not user_id:
        # pago sin usuario (link compartido a mano): se abona en concierge
        log.error("pago sin client_reference_id — abonar a mano con "
                  "tools/creditos.py (sesión %s, %s centavos)",
                  sesion.get("id"), sesion.get("amount_total"))
        return {"ok": True, "motivo": "sin client_reference_id — abono manual"}

    pack = _pack_por_monto(int(sesion.get("amount_total") or 0))
    if not pack:
        log.error("monto %s no corresponde a ningún pack de tarifas.json — "
                  "abonar a mano (sesión %s, usuario %s)",
                  sesion.get("amount_total"), sesion.get("id"), user_id)
        return {"ok": True, "motivo": "monto sin pack — abono manual"}

    referencia = f"stripe:{sesion.get('id')}"
    saldo = db.abonar_compra(user_id, pack["creditos"], referencia)
    if saldo is None:
        return {"ok": True, "motivo": "ya abonado (reintento de Stripe)"}
    log.info("compra abonada: %s créditos a %s (%s)", pack["creditos"], user_id, referencia)
    return {"ok": True, "creditos": pack["creditos"], "saldo": saldo}
