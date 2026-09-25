"""C5 — monedero de créditos: el gate duro de gasto por usuario.

Pieza de PLATAFORMA (docs/ECONOMIA.md): toda herramienta que queme dinero pasa
por aquí — estimar → saldo → ejecutar → liquidar. La tarifa en créditos vive en
tools/tarifas.json (tarifa de negocio; los dólares de vendors siguen SOLO en
tools/pricing.json).

Selección por env `CREDITOS_BACKEND`: "off" (default — dev local sigue igual
que siempre, sin monedero ni gates) | "postgres" (el servicio en AWS). Reglas
de la spec: se cobra la estimación redondeada hacia arriba ANTES de lanzar; un
fallo nuestro devuelve los créditos; lo que no quema dinero no gasta créditos.
"""
from __future__ import annotations

import json
import math
import os
from pathlib import Path

from . import db
from .project import DURACION_MAX_S, DURACION_MIN_S

_TARIFAS_JSON = Path(__file__).resolve().parent.parent / "tools" / "tarifas.json"

# Fallback si el JSON no existe (p. ej. tests aislados del paquete)
PREPARAR_CR = 10
VIDEO_CR_POR_SEGUNDO = 3
VIDEO_PREMIUM_CR_POR_SEGUNDO = 4
IMAGEN_CR = 2

# M23 · V: precio TOTAL (guion + producción) de cada duración que se puede
# elegir. Vacío = la tabla sale de la fórmula (preparar + por_segundo × s).
PRECIO_POR_DURACION: dict[int, int] = {}

PACKS: list[dict] = []  # M1: la UI enseña los packs en el CTA de recarga
PISO_VENTA_USD = 0.015  # M6: valor de venta por crédito — base del margen

# M8 — shorts en la web (fallbacks espejo de tarifas.json §shorts)
SHORTS_TRANSCRIPCION_CR_5MIN = 2
SHORTS_ANALISIS_CR = 2
SHORTS_RENDER_CR = 2

# M17 — importar de YouTube (fallback espejo de tarifas.json §shorts)
SHORTS_IMPORTAR_CR_MIN = 2

# M14 — editar en la web (fallback espejo de tarifas.json §editar)
EDITAR_SUGERENCIAS_CR = 2

# M16.3 — b-roll del editor en la web (fallback espejo de tarifas.json §editar)
BROLL_SUGERENCIAS_CR = 2

# M18 — copiadora de estilos (fallback espejo de tarifas.json §estilos)
ESTILO_ANALIZAR_CR = 3

# M23 C5 — competencia (fallback espejo de tarifas.json §competencia)
COMPETENCIA_POR_CUENTA_CR = 3

# M25 A/F — clip de 8 s (fallback espejo de tarifas.json §clip)
CLIP_CR = 30
CLIP_COMPONER_CR = 2

# M23 · D — MIX, publicidad automática (fallback espejo de tarifas.json §mix)
MIX_POR_PUBLICACION_CR = 5

def _tabla_de(crudo: dict) -> dict[int, int]:
    """§video.por_duracion → {segundos: total}. Se queda solo con lo que el
    pipeline sabe producir: una llave fuera del rango se cobraría con su precio y
    se produciría recortada, y una mal escrita no puede tumbar la API."""
    tabla = {}
    for k, v in (crudo or {}).items():
        try:
            s, n = int(k), int(v)
        except (TypeError, ValueError):
            continue
        if DURACION_MIN_S <= s <= DURACION_MAX_S:
            tabla[s] = n
    return tabla


try:
    _t = json.loads(_TARIFAS_JSON.read_text(encoding="utf-8"))
    _v = _t["video"]
    PREPARAR_CR = _v["preparar"]
    VIDEO_CR_POR_SEGUNDO = _v["por_segundo"]
    VIDEO_PREMIUM_CR_POR_SEGUNDO = _v["por_segundo_premium"]
    IMAGEN_CR = _v["imagen"]
    PRECIO_POR_DURACION = _tabla_de(_v.get("por_duracion", {}))
    PACKS = _t.get("packs_usd", [])
    PISO_VENTA_USD = _t.get("economia", {}).get("piso_venta_usd_por_credito", PISO_VENTA_USD)
    _s = _t.get("shorts", {})
    SHORTS_TRANSCRIPCION_CR_5MIN = _s.get("transcripcion_por_5min", SHORTS_TRANSCRIPCION_CR_5MIN)
    SHORTS_ANALISIS_CR = _s.get("analisis", SHORTS_ANALISIS_CR)
    SHORTS_RENDER_CR = _s.get("render_por_short", SHORTS_RENDER_CR)
    SHORTS_IMPORTAR_CR_MIN = _s.get("importar_por_min", SHORTS_IMPORTAR_CR_MIN)
    EDITAR_SUGERENCIAS_CR = _t.get("editar", {}).get("sugerencias", EDITAR_SUGERENCIAS_CR)
    BROLL_SUGERENCIAS_CR = _t.get("editar", {}).get("broll_sugerencias", BROLL_SUGERENCIAS_CR)
    ESTILO_ANALIZAR_CR = _t.get("estilos", {}).get("analizar", ESTILO_ANALIZAR_CR)
    COMPETENCIA_POR_CUENTA_CR = _t.get("competencia", {}).get(
        "por_cuenta", COMPETENCIA_POR_CUENTA_CR)
    _c = _t.get("clip", {})
    CLIP_CR = _c.get("video_8s", CLIP_CR)
    CLIP_COMPONER_CR = _c.get("componer_imagenes", CLIP_COMPONER_CR)
    MIX_POR_PUBLICACION_CR = _t.get("mix", {}).get(
        "por_publicacion", MIX_POR_PUBLICACION_CR)
except (FileNotFoundError, KeyError, ValueError, TypeError):
    pass  # fallback: tarifa de arriba (2026-09-02); una llave mal escrita no tumba la API


class SinSaldo(Exception):
    """El cobro no procede: saldo insuficiente (o monedero inexistente)."""

    def __init__(self, costo: int, saldo: int):
        self.costo, self.saldo = costo, saldo
        super().__init__(
            f"Créditos insuficientes: esta acción cuesta {costo} créditos "
            f"y tu saldo es {saldo}. Recarga créditos para continuar.")


def backend() -> str:
    return os.getenv("CREDITOS_BACKEND", "off")


def activo() -> bool:
    return backend() == "postgres"


# ---------------------------------------------------------------------------
# tarifa (créditos por acción)

def costo_preparar() -> int:
    return PREPARAR_CR


def precios_por_duracion() -> dict[int, int]:
    """M23 · V: lo que cuesta la película entera (guion + producción) para cada
    duración elegible. Sus llaves son las únicas duraciones que acepta crear."""
    if PRECIO_POR_DURACION:
        return dict(sorted(PRECIO_POR_DURACION.items()))
    return {s: PREPARAR_CR + math.ceil(VIDEO_CR_POR_SEGUNDO * s)
            for s in range(DURACION_MIN_S, DURACION_MAX_S + 1, 5)}


def costo_producir(duracion_s: int | float) -> int:
    """Producir se cobra por duración OBJETIVO. Una duración de la tabla cobra su
    precio menos el guion, que ya se pagó al empezar; una que no está (proyectos
    de antes de la tabla) sigue con la estimación por segundo hacia arriba."""
    s = float(duracion_s)
    tabla = precios_por_duracion()
    if s.is_integer() and int(s) in tabla:
        return max(0, tabla[int(s)] - PREPARAR_CR)
    return math.ceil(VIDEO_CR_POR_SEGUNDO * s)


def producir_cobrado(p) -> int:
    """Lo que se le cobró a este proyecto al producir. Las devoluciones usan este
    número y no la tabla del momento: entre el cobro y un fallo pueden desplegarse
    precios nuevos (y la API y Fargate se despliegan por separado). Las
    producciones cobradas antes de guardarlo caen a la tarifa de hoy."""
    n = getattr(p, "cobrado_producir", None)
    return costo_producir(p.duracion_s) if n is None else int(n)


def costo_imagen() -> int:
    """Imagen estándar (M1: modificar la opción de personaje)."""
    return IMAGEN_CR


def costo_shorts_analizar(duracion_s: float, con_transcript: bool) -> int:
    """M8: análisis de candidatos (LLM) + transcripción si el proyecto no trae
    canónico — 2 cr por cada 5 min empezados (cubre AssemblyAI de pricing.json)."""
    costo = SHORTS_ANALISIS_CR
    if not con_transcript:
        costo += SHORTS_TRANSCRIPCION_CR_5MIN * math.ceil(float(duracion_s) / 300)
    return costo


def costo_editar_sugerencias(duracion_s: float, con_transcript: bool) -> int:
    """M14: corrida de sugerencias de corte (LLM) + transcripción si el metraje
    no trae canónico — misma tarifa de transcripción que shorts (mismo vendor)."""
    costo = EDITAR_SUGERENCIAS_CR
    if not con_transcript:
        costo += SHORTS_TRANSCRIPCION_CR_5MIN * math.ceil(float(duracion_s) / 300)
    return costo


def costo_broll_sugerencias() -> int:
    """M16.3: propuestas de recursos visuales (LLM, no genera nada)."""
    return BROLL_SUGERENCIAS_CR


def costo_regen_imagenes(n: int) -> int:
    """M16.3: candidatos de imagen del popup g2 — tarifa de imagen × candidato."""
    return IMAGEN_CR * int(n)


def costo_regen_video(veo_segundos: int | float) -> int:
    """M16.3: animar una ventana con Veo — la regla de tarifas.json §video:
    're-generar una escena = por_segundo × segundos' (del clip de Veo 4/6/8)."""
    return math.ceil(VIDEO_CR_POR_SEGUNDO * float(veo_segundos))


def costo_shorts_importar(duracion_s: float) -> int:
    """M17: traer un video de YouTube al proyecto (descarga vía Apify, que
    cobra por MB ≈ por minuto) — tarifa por minuto EMPEZADO del video fuente."""
    return SHORTS_IMPORTAR_CR_MIN * max(1, math.ceil(float(duracion_s) / 60))


def costo_estilo_analizar() -> int:
    """M18: perfil de estilo de un reel/TikTok — tarifa fija (Apify + visión
    gpt-5-mini cuestan centavos de dólar juntos; los reels son cortos)."""
    return ESTILO_ANALIZAR_CR


def costo_competencia(n_cuentas: int) -> int:
    """M23 C5: revisar la competencia — tarifa POR CUENTA vigilada que entra en
    la corrida. Igual en las tres redes (Instagram cuesta nueve veces más que
    TikTok, pero un botón que cambia de precio según a quién vigilas no se
    puede explicar). Volver a ver un informe ya hecho no cuesta."""
    return COMPETENCIA_POR_CUENTA_CR * max(0, int(n_cuentas))


def costo_clip(n_imagenes: int = 0) -> int:
    """M25 A/F: el clip de 8 segundos con audio — una sola llamada a Veo.

    Tarifa plana (no por segundo: la duración es fija). El extra de componer
    solo aparece con DOS o TRES imágenes, que es cuando hay que juntarlas con
    Grok antes de animar: con cero es text-to-video y con una se anima directo,
    y en ninguno de esos casos se paga Grok. El usuario paga lo que usa."""
    return CLIP_CR + (CLIP_COMPONER_CR if int(n_imagenes) >= 2 else 0)


def costo_shorts_render(n_shorts: int) -> int:
    """M8: Remotion + export en Fargate, por short aprobado."""
    return SHORTS_RENDER_CR * int(n_shorts)


def costo_mix(dias: int) -> int:
    """M23 · D: la campaña de publicidad automática, COMPLETA y por adelantado.

    Días × tarifa, porque sale UNA publicación al día. Se cobra entera al
    encender (decisión del dueño, 18-sep) y se devuelve por DÍA lo que no
    salga: un día que falla devuelve sus créditos, y apagar a mitad devuelve
    los días que no se publicaron. El ejemplo del primer día NO entra en esta
    cuenta: se enseña antes de cobrar y es gratis."""
    return MIX_POR_PUBLICACION_CR * max(0, int(dias))


# ---------------------------------------------------------------------------
# operaciones del monedero (backend postgres; user = DEFAULT_USER_ID hoy)

def saldo(user_id: str | None = None) -> int:
    return db.saldo_creditos(user_id or db.usuario_actual())


def cobrar(creditos: int, referencia: str, user_id: str | None = None) -> int:
    """Debita ANTES de lanzar. Atómico (UPDATE condicionado en Postgres): si el
    saldo no alcanza, levanta SinSaldo y no pasa nada. Devuelve el saldo nuevo."""
    u = user_id or db.usuario_actual()
    nuevo = db.cobrar_creditos(u, int(creditos), referencia)
    if nuevo is None:
        raise SinSaldo(int(creditos), db.saldo_creditos(u))
    return nuevo


def abonar(creditos: int, tipo: str, referencia: str | None = None,
           user_id: str | None = None) -> int:
    return db.abonar_creditos(user_id or db.usuario_actual(), int(creditos),
                              tipo, referencia)


def devolver(creditos: int, referencia: str, user_id: str | None = None) -> int:
    """Fallo nuestro = créditos de vuelta (regla 3 de la spec)."""
    return abonar(int(creditos), "devolucion", referencia, user_id)
