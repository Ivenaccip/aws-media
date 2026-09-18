"""M23 C5 — competencia: las últimas publicaciones de las cuentas que vigilas.

Tres redes, tres actores de Apify, una sola forma de publicación (`normalizar`)
para que la pantalla y el LLM no sepan de dónde vino cada número. Los ids de
los actores viven en config.py (settings.apify_*) y sus precios reales, en
tools/pricing.json §apify — medidos con corridas reales el 2026-09-17.

Dos reglas que sostienen el módulo:

- **Un número que no vino NO es cero.** Instagram no informa compartidos y
  YouTube tampoco; una foto no tiene vistas. Eso viaja como None y la pantalla
  escribe «—». Un cero inventado diría que a nadie le gustó.
- **Las vistas sueltas no comparan cuentas.** Una cuenta con diez veces más
  seguidores siempre gana, y eso no enseña nada. Por eso cada publicación lleva
  un `indice` = sus vistas ÷ la mediana de SU cuenta: 1.0 es lo normal de esa
  cuenta y 3.0 es que le fue tres veces mejor de lo habitual. Es lo único que
  se puede ordenar y lo único que el LLM puede comparar.
"""
from __future__ import annotations

import re
import statistics
from datetime import datetime, timezone

MAX_CUENTAS = 5        # tope por corrida: 5 × POR_CUENTA publicaciones al LLM
POR_CUENTA = 10        # las últimas N de cada cuenta (decisión del dueño, 17-sep)
MIN_PARA_INDICE = 3    # con menos publicaciones medidas, la mediana no dice nada

# El usuario pega la URL del perfil: la red se detecta de ahí y no se pregunta.
# @natgeo existe en las tres redes, así que un handle suelto sería ambiguo.
_PERFIL = (
    ("instagram", re.compile(r"instagram\.com/([A-Za-z0-9._]{1,30})/?(?:\?|$)")),
    ("tiktok", re.compile(r"tiktok\.com/@([A-Za-z0-9._]{1,30})")),
    ("youtube", re.compile(r"youtube\.com/@([A-Za-z0-9._-]{1,40})")),
    ("youtube", re.compile(r"youtube\.com/(?:c|user|channel)/([A-Za-z0-9._-]{1,40})")),
)
# rutas de Instagram que no son una cuenta (p/DxX…, reel/…, explore/…)
_IG_NO_CUENTA = {"p", "reel", "reels", "explore", "stories", "tv", "accounts", "direct"}

REDES = ("instagram", "tiktok", "youtube")
NOMBRE_RED = {"instagram": "Instagram", "tiktok": "TikTok", "youtube": "YouTube"}


class CuentaInvalida(ValueError):
    """Lo pegado no es la liga de un perfil de Instagram, TikTok o YouTube."""


def detectar(url: str) -> tuple[str, str]:
    """(red, cuenta) desde la liga del perfil. Levanta CuentaInvalida."""
    texto = (url or "").strip()
    for red, patron in _PERFIL:
        m = patron.search(texto)
        if not m:
            continue
        cuenta = m.group(1).strip("/")
        if red == "instagram" and cuenta.lower() in _IG_NO_CUENTA:
            raise CuentaInvalida(
                "Esa es la liga de una publicación, no de una cuenta. "
                "Pega la liga del perfil: instagram.com/lacuenta")
        if cuenta:
            return red, cuenta
    raise CuentaInvalida(
        "Pega la liga del perfil que quieres vigilar: instagram.com/lacuenta, "
        "tiktok.com/@lacuenta o youtube.com/@lacuenta")


def id_cuenta(red: str, cuenta: str) -> str:
    """Id estable de una cuenta vigilada (llave en el archivo del usuario)."""
    return f"{red[:2]}-{cuenta.lower()}"


def url_perfil(red: str, cuenta: str) -> str:
    if red == "instagram":
        return f"https://www.instagram.com/{cuenta}/"
    if red == "tiktok":
        return f"https://www.tiktok.com/@{cuenta}"
    return f"https://www.youtube.com/@{cuenta}"


def entrada_actor(red: str, cuenta: str, cuantas: int = POR_CUENTA) -> tuple[str, dict]:
    """(id del actor, entrada) para traer las últimas publicaciones de la cuenta.

    Los tres actores están verificados con corridas reales (2026-09-17): el de
    Instagram es el mismo oficial que ya usa la copiadora de estilos.
    """
    from .config import settings

    if red == "instagram":
        return settings.apify_ig, {
            "directUrls": [url_perfil(red, cuenta)], "resultsType": "posts",
            "resultsLimit": cuantas}
    if red == "tiktok":
        return settings.apify_tiktok_perfil, {
            "startUrls": [url_perfil(red, cuenta)], "maxItems": cuantas}
    return settings.apify_yt_canal, {
        "channelUrls": [url_perfil(red, cuenta)], "maxResults": cuantas}


def _entero(v) -> int | None:
    """El número tal cual, o None si no vino. NUNCA 0 por defecto."""
    if v is None or isinstance(v, bool):
        return None
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return None


def _iso(v) -> str:
    """Fecha en ISO UTC. Acepta ISO, epoch en segundos y cadena vacía."""
    if v is None:
        return ""
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return datetime.fromtimestamp(float(v), timezone.utc).isoformat(timespec="seconds")
    texto = str(v).strip()
    if not texto:
        return ""
    try:
        d = datetime.fromisoformat(texto.replace("Z", "+00:00"))
    except ValueError:
        return ""
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return d.astimezone(timezone.utc).isoformat(timespec="seconds")


def _segundos(v) -> float | None:
    """Duración en segundos desde un número o desde «00:44:25»."""
    if v is None:
        return None
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return round(float(v), 1) or None
    partes = str(v).strip().split(":")
    if not partes or not all(p.strip().isdigit() for p in partes if p.strip()):
        return None
    try:
        total = 0.0
        for p in partes:
            total = total * 60 + float(p or 0)
    except ValueError:
        return None
    return round(total, 1) or None


def _texto(v, tope: int = 400) -> str:
    return " ".join(str(v or "").split())[:tope]


def normalizar(item: dict, red: str, cuenta: str) -> dict:
    """Un item crudo de cualquiera de los tres actores → la forma común.

    `enlace` es además el puente con la copiadora de estilos: de Instagram y
    TikTok es la liga del post, que es justo lo que /api/estilo sabe analizar.
    """
    it = item or {}
    if red == "instagram":
        # las reproducciones son el número que Instagram enseña hoy; el
        # videoViewCount viejo queda de respaldo. Una foto no tiene ninguno.
        vistas = _entero(it.get("videoPlayCount"))
        if vistas is None:
            vistas = _entero(it.get("videoViewCount"))
        crudo = {
            "id": str(it.get("shortCode") or it.get("id") or ""),
            "enlace": str(it.get("url") or ""),
            "texto": _texto(it.get("caption")),
            "cuando": _iso(it.get("timestamp")),
            "vistas": vistas,
            "me_gusta": _entero(it.get("likesCount")),
            "comentarios": _entero(it.get("commentsCount")),
            "compartidos": None,   # Instagram no lo informa
            "duracion_s": _segundos(it.get("videoDuration")),
        }
    elif red == "tiktok":
        crudo = {
            "id": str(it.get("id") or ""),
            "enlace": str(it.get("postPage") or ""),
            "texto": _texto(it.get("title")),
            "cuando": _iso(it.get("uploadedAtFormatted") or it.get("uploadedAt")),
            "vistas": _entero(it.get("views")),
            "me_gusta": _entero(it.get("likes")),
            "comentarios": _entero(it.get("comments")),
            "compartidos": _entero(it.get("shares")),
            "duracion_s": _segundos((it.get("video") or {}).get("duration")),
        }
    else:
        crudo = {
            "id": str(it.get("id") or ""),
            "enlace": str(it.get("url") or ""),
            "texto": _texto(it.get("title")),
            "cuando": _iso(it.get("date")),
            "vistas": _entero(it.get("viewCount")),
            "me_gusta": _entero(it.get("likes")),
            "comentarios": _entero(it.get("commentsCount")),
            "compartidos": None,   # YouTube no lo informa
            "duracion_s": _segundos(it.get("durationSeconds") or it.get("duration")),
        }
    crudo.update(red=red, cuenta=cuenta, indice=None)
    return crudo


def con_indice(publicaciones: list[dict]) -> list[dict]:
    """Añade el `indice` de cada publicación DENTRO de su propia cuenta.

    Con menos de MIN_PARA_INDICE publicaciones medidas la mediana no significa
    nada, así que el índice se queda en None: mejor sin dato que con un dato
    que invita a concluir. Las publicaciones sin vistas (una foto) tampoco
    entran en la mediana ni reciben índice.
    """
    por_cuenta: dict[str, list[int]] = {}
    for p in publicaciones:
        if p.get("vistas") is not None:
            por_cuenta.setdefault(p.get("cuenta", ""), []).append(int(p["vistas"]))
    medianas = {c: statistics.median(v) for c, v in por_cuenta.items()
                if len(v) >= MIN_PARA_INDICE and statistics.median(v) > 0}
    for p in publicaciones:
        mediana = medianas.get(p.get("cuenta", ""))
        # la clave queda SIEMPRE puesta: quien lea el informe distingue «no se
        # pudo calcular» de «esta publicación llegó por otro camino»
        p["indice"] = (round(int(p["vistas"]) / mediana, 2)
                       if mediana and p.get("vistas") is not None else None)
    return publicaciones


def ordenar(publicaciones: list[dict]) -> list[dict]:
    """Las que más rindieron PARA SU CUENTA primero; las que no tienen índice
    van después por fecha, que es lo único honesto que queda de ellas."""
    return sorted(
        publicaciones,
        key=lambda p: (p.get("indice") is not None, p.get("indice") or 0,
                       str(p.get("cuando") or "")),
        reverse=True)


def para_llm(publicaciones: list[dict], tope: int = MAX_CUENTAS * POR_CUENTA) -> list[dict]:
    """Lo que ve el LLM: sin enlaces ni campos que no usa para razonar."""
    return [{"id": p.get("id"), "red": NOMBRE_RED.get(p.get("red", ""), p.get("red")),
             "cuenta": p.get("cuenta"), "cuando": (p.get("cuando") or "")[:10],
             "texto": _texto(p.get("texto"), 200), "duracion_s": p.get("duracion_s"),
             "vistas": p.get("vistas"), "me_gusta": p.get("me_gusta"),
             "comentarios": p.get("comentarios"), "indice": p.get("indice")}
            for p in publicaciones[:tope]]
