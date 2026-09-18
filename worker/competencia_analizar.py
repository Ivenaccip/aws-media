"""M23 C5 — investiga tu competencia (worker Lambda, <15 min):

  1. una corrida de Apify POR CUENTA vigilada trae sus últimas publicaciones
     (Instagram, TikTok y YouTube, cada una con su actor — pipeline/competencia.py);
  2. se normalizan a una sola forma y cada publicación recibe su `indice`: sus
     vistas divididas entre la mediana de SU cuenta, que es lo único que
     permite comparar una cuenta chica con una grande;
  3. gpt-5-mini lee todas juntas y dice qué se repite en las que rinden;
  4. el informe queda por usuario en S3: usuarios/<user>/competencia/informes/<id>.json

La regla que gobierna este worker: **una cuenta que falla no tumba el informe.**
Instagram puede estar caído mientras TikTok responde, o una cuenta puede haberse
vuelto privada. Cada cuenta que no trae nada devuelve SU parte de los créditos
(la tarifa es por cuenta) y el informe sale con las demás, diciendo cuáles
faltaron y por qué. Si no llegó ninguna, el informe es un error y se devuelve
todo.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from datetime import datetime, timezone
from pathlib import Path

log = logging.getLogger("competencia_analizar")

TIMEOUT_CUENTA_S = 240   # una cuenta que se cuelga no se lleva a las demás
# freno de gasto por cuenta: el peor caso real son 10 publicaciones de
# Instagram a $0.0027 = $0.027; el doble deja aire sin dejar la puerta abierta
TOPE_USD_CUENTA = 0.06


def _ahora() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _precio_usd(red: str) -> float:
    """Costo real del vendor desde pricing.json §apify — jamás hardcodeado."""
    raiz = Path(__file__).resolve().parent.parent
    try:
        p = json.loads((raiz / "tools" / "pricing.json").read_text(encoding="utf-8"))["apify"]
        if red == "instagram":
            return float(p["instagram_scraper"]["usd_por_resultado"])
        if red == "tiktok":
            return float(p["tiktok_profile_scraper"]["usd_por_video"])
        return float(p["youtube_channel_videos"]["usd_por_video"])
    except (FileNotFoundError, KeyError, ValueError):
        return 0.0027   # espejo de pricing.json §apify: el más caro de los tres


def _traer(red: str, cuenta: str) -> list[dict]:
    """Las últimas publicaciones de una cuenta, ya normalizadas."""
    from pipeline import apify, competencia

    actor, entrada = competencia.entrada_actor(red, cuenta)
    items = apify.correr(actor, entrada, timeout_s=TIMEOUT_CUENTA_S,
                         tope_usd=TOPE_USD_CUENTA)
    publicaciones = [competencia.normalizar(it, red, cuenta) for it in items]
    # sin enlace no hay nada que enseñar ni adónde mandar al usuario
    return [p for p in publicaciones if p.get("enlace")][:competencia.POR_CUENTA]


async def _lectura_llm(publicaciones: list[dict]) -> dict:
    """gpt-5-mini sobre todas las publicaciones juntas: qué se repite en las
    que rinden. Lo que el LLM ve NO lleva enlaces (no los necesita para
    razonar) y sí lleva el índice, que es lo que hace comparables las cuentas."""
    from pipeline import competencia
    from pipeline.config import load_prompt
    from pipeline.llm import chat_json

    datos = competencia.para_llm(publicaciones)
    return await chat_json("competencia", load_prompt("competencia_system"),
                           json.dumps(datos, ensure_ascii=False))


def analizar(user_id: str, informe_id: str, cuentas: list[dict]) -> None:
    t0 = time.monotonic()
    os.environ["DEFAULT_USER_ID"] = user_id
    from pipeline import apify, competencia, costes_infra, creditos, db, media_sync

    key_doc = f"usuarios/{user_id}/competencia/informes/{informe_id}.json"
    doc = json.loads(media_sync.leer_texto(key_doc) or "{}")
    por_cuenta = int(doc.get("credito_por_cuenta") or 0)
    publicaciones: list[dict] = []
    fallidas: list[dict] = []
    costo_usd = 0.0

    try:
        for c in cuentas or []:
            red, cuenta = c.get("red", ""), c.get("cuenta", "")
            try:
                traidas = _traer(red, cuenta)
            except Exception as err:  # noqa: BLE001 — una cuenta no tumba el informe
                apify.registrar_fallo(log, err, "%s: %s/@%s no se pudo traer",
                                      informe_id, red, cuenta)
                fallidas.append({**c, "motivo": apify.describir_error(err, 200)})
                continue
            if not traidas:
                fallidas.append({**c, "motivo": "No devolvió publicaciones: la "
                                                "cuenta puede ser privada, estar "
                                                "vacía o haber cambiado de nombre."})
                continue
            publicaciones.extend(traidas)
            costo_usd += _precio_usd(red) * len(traidas)

        if not publicaciones:
            raise RuntimeError("ninguna de las cuentas devolvió publicaciones")

        publicaciones = competencia.ordenar(competencia.con_indice(publicaciones))
        try:
            lectura = asyncio.run(_lectura_llm(publicaciones))
        except Exception as err:  # noqa: BLE001 — los números valen sin la lectura
            log.warning("%s: la lectura del LLM falló: %s", informe_id, err)
            lectura = {}

        # devolución por cuenta: se cobró por cuenta, así que lo que no llegó
        # se devuelve — aunque el informe salga bien con las demás
        devueltos = por_cuenta * len(fallidas)
        if devueltos and creditos.activo():
            creditos.devolver(devueltos, f"competencia:{informe_id}", user_id)
            log.info("%s: %d créditos devueltos por %d cuenta(s) sin datos",
                     informe_id, devueltos, len(fallidas))

        doc.update(
            estado="listo", listo=_ahora(),
            publicaciones=publicaciones,
            lectura=lectura,
            fallidas=fallidas,
            devueltos=devueltos,
            cobrados=max(0, int(doc.get("creditos") or 0) - devueltos))
        media_sync.escribir_texto(key_doc, json.dumps(doc, ensure_ascii=False, indent=1))
        log.info("%s: informe listo (%d publicaciones de %d cuenta(s), %d sin datos)",
                 informe_id, len(publicaciones), len(cuentas or []) - len(fallidas),
                 len(fallidas))

        if db.backend() == "postgres" and costo_usd > 0:
            try:
                db.ejecutar(
                    """INSERT INTO costes (user_id, proyecto_id, concepto, proveedor, costo_usd)
                       VALUES (:u, :p, 'competencia', 'apify', :usd)""",
                    {"u": user_id, "p": informe_id, "usd": round(costo_usd, 6)})
            except Exception as err:  # noqa: BLE001 — el costo no tumba el informe
                log.warning("%s: no se pudo registrar el costo Apify: %s", informe_id, err)
    except Exception as err:  # noqa: BLE001 — estado y devolución quedan registrados
        apify.registrar_fallo(log, err, "%s: la revisión de competencia falló", informe_id)
        doc.update(estado="error", error=apify.describir_error(err), fallidas=fallidas)
        media_sync.escribir_texto(key_doc, json.dumps(doc, ensure_ascii=False, indent=1))
        n = int(doc.get("creditos") or 0)
        if n and creditos.activo():   # fallo nuestro = créditos de vuelta
            creditos.devolver(n, f"competencia:{informe_id}", user_id)
            log.info("%s: %d créditos devueltos", informe_id, n)
    finally:
        costes_infra.registrar(user_id, informe_id, "infra-competencia",
                               costes_infra.costo_lambda(time.monotonic() - t0))
