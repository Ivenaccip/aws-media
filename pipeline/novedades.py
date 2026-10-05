"""RAG·35 — la lista de novedades de /automatiza: el enlace de baja y el envío.

Quién entra a la lista lo decide pipeline/db.py (automatiza_lista_novedades):
solo quien marcó la casilla aparte y no se ha dado de baja. Aquí vive lo que
va en cada correo:

  · el ENLACE DE BAJA. Lleva el id del contacto y una firma HMAC con
    AUTOMATIZA_SAL_BAJA (SSM /<entorno>/env, la sube tools/ssm_env.py). Sin la
    firma, cualquiera podría dar de baja a otra persona cambiando el número.
    El correo NO viaja en la URL: queda fuera de los logs y del historial.
  · las cabeceras List-Unsubscribe y List-Unsubscribe-Post (RFC 8058). Con
    ellas Gmail y Outlook enseñan su propio botón «Cancelar suscripción»,
    que hace un POST a la misma dirección. Gmail las exige a quien manda
    correo masivo.
  · el ENVÍO por Amazon SES (sesv2). Antes de cada correo se vuelve a mirar
    la baja: alguien pudo darse de baja a la mitad de la campaña.

Falla cerrado: sin la sal no se firma ni se verifica nada, y sin el enlace de
baja en el cuerpo no se manda el correo.
"""
from __future__ import annotations

import hashlib
import hmac
import logging
import os
import re

log = logging.getLogger("novedades")

VAR_SAL = "AUTOMATIZA_SAL_BAJA"
VAR_REMITENTE = "AUTOMATIZA_REMITENTE"          # p. ej. «Irremplazables <novedades@…>»
VAR_CONFIG_SES = "AUTOMATIZA_SES_CONFIG"        # configuration set de SES (opcional)
VAR_BASE = "AUTOMATIZA_BASE_URL"
BASE_URL = "https://irremplazables.xyz"

# El hueco que tiene que traer el cuerpo de cada campaña, en el HTML y en el
# texto: ahí va el enlace de baja de ESA persona.
HUECO_BAJA = "{{baja}}"

_TOKEN = re.compile(r"(\d{1,18})\.([0-9a-f]{32})")


class SinSal(RuntimeError):
    """Falta AUTOMATIZA_SAL_BAJA: no se puede firmar ni verificar un enlace."""


def _sal() -> str:
    sal = os.getenv(VAR_SAL, "")
    if not sal:
        raise SinSal(f"falta {VAR_SAL} (SSM /<entorno>/env, tools/ssm_env.py)")
    return sal


def _firma(contacto_id: int, sal: str) -> str:
    # «baja:» separa este uso de cualquier otro HMAC que algún día use la sal
    return hmac.new(sal.encode(), f"baja:{contacto_id}".encode(),
                    hashlib.sha256).hexdigest()[:32]


def firmar(contacto_id: int) -> str:
    """El token del enlace de baja de ese contacto: «<id>.<firma>»."""
    return f"{int(contacto_id)}.{_firma(int(contacto_id), _sal())}"


def verificar(token: str) -> int | None:
    """El id del contacto si la firma es buena; None si no lo es. Sin la sal
    revienta con SinSal: «no sé» no puede parecerse a «firma mala»."""
    m = _TOKEN.fullmatch(token or "")
    if not m:
        return None
    contacto_id = int(m.group(1))
    if not hmac.compare_digest(_firma(contacto_id, _sal()), m.group(2)):
        return None
    return contacto_id


def enlace_baja(contacto_id: int, base: str | None = None) -> str:
    sitio = (base or os.getenv(VAR_BASE) or BASE_URL).rstrip("/")
    return f"{sitio}/automatiza/baja/{firmar(contacto_id)}"


def con_baja(cuerpo: str, enlace: str, *, html_: bool) -> str:
    """Pone el enlace de baja en el hueco. En HTML va escapado (es un atributo)."""
    if HUECO_BAJA not in cuerpo:
        raise ValueError(f"el cuerpo no trae el hueco {HUECO_BAJA}: sin enlace de baja no sale")
    if html_:
        import html
        enlace = html.escape(enlace, quote=True)
    return cuerpo.replace(HUECO_BAJA, enlace)


def mensaje(asunto: str, cuerpo_html: str, cuerpo_texto: str, enlace: str) -> dict:
    """El `Content` de sesv2.send_email, con el enlace de baja en el cuerpo y
    en las cabeceras de un clic."""
    return {"Simple": {
        "Subject": {"Data": asunto, "Charset": "UTF-8"},
        "Body": {
            "Html": {"Data": con_baja(cuerpo_html, enlace, html_=True), "Charset": "UTF-8"},
            "Text": {"Data": con_baja(cuerpo_texto, enlace, html_=False), "Charset": "UTF-8"},
        },
        "Headers": [
            {"Name": "List-Unsubscribe", "Value": f"<{enlace}>"},
            {"Name": "List-Unsubscribe-Post", "Value": "List-Unsubscribe=One-Click"},
        ],
    }}


def enviar(destino: str, contacto_id: int, asunto: str, cuerpo_html: str,
           cuerpo_texto: str, *, cli=None, base: str | None = None) -> str | None:
    """Manda UN correo de novedades por SES. Devuelve el MessageId, o None si
    la persona está de baja (se vuelve a mirar justo antes de mandar)."""
    from pipeline import db
    if db.automatiza_de_baja(destino):
        return None
    remitente = os.getenv(VAR_REMITENTE, "")
    if not remitente:
        raise RuntimeError(f"falta {VAR_REMITENTE}: ¿desde qué dirección sale?")
    if cli is None:
        import boto3
        cli = boto3.client("sesv2")
    kwargs = {
        "FromEmailAddress": remitente,
        "Destination": {"ToAddresses": [destino]},
        "Content": mensaje(asunto, cuerpo_html, cuerpo_texto, enlace_baja(contacto_id, base)),
    }
    if os.getenv(VAR_CONFIG_SES):
        kwargs["ConfigurationSetName"] = os.environ[VAR_CONFIG_SES]
    return cli.send_email(**kwargs).get("MessageId")
