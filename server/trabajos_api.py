"""UI·15 — «Tus trabajos»: el cuadro de abajo a la derecha, en todas las pantallas.

Una sola lectura que junta lo que corre y lo que terminó en las últimas
HORAS_VISIBLE horas, de todos los tipos: películas, clips, shorts (importar,
analizar, renderizar), la propuesta de corte del editor IA, estilos y
competencia. Cada ficha trae qué es, en qué va y a dónde llevar al usuario.

Solo lee y no cobra. El cuadro sondea mientras hay algo corriendo, así que lo
que cuesta leer se recorta ANTES de abrir nada: de S3 solo se abren los
documentos que cambiaron dentro de la ventana (la fecha sale del listado).

MIX queda fuera a propósito: sus publicaciones diarias las dispara el reloj,
no el usuario, y su pantalla ya dice cómo va la campaña.
"""
from __future__ import annotations

import json
import time
from datetime import datetime, timezone
from urllib.parse import quote

from fastapi import APIRouter

from pipeline import creditos, db, media_sync
from pipeline.project import Proyecto, listar_proyectos

router = APIRouter(prefix="/api/trabajos", tags=["trabajos"])

HORAS_VISIBLE = 24        # lo terminado se ve un día (dueño, 25-sep)
HORAS_COLGADO = 3         # algo «corriendo» más que esto no se anuncia como vivo
SONDEO_S = 15             # cada cuánto pregunta el cuadro mientras algo corre
MAX_POR_TIPO = 10

# Los mismos nombres que enseña crear (static/crear.html, PASOS_PREP y PASOS_PROD)
_PASOS = [
    ("Entendiendo tu idea", {"inicio", "clasificar", "research"}),
    ("Escribiendo el guion", {"guion", "editor"}),
    ("Eligiendo voz y personaje", {"voz", "personaje"}),
]
_PASOS_PROD = [
    ("Grabando la voz", {"encolado", "inicio", "casting", "director", "tts", "alinear"}),
    ("Animando las escenas", {"imagenes", "media"}),
    ("Uniendo el video", {"concat", "drive", "puente"}),
]


def _paso(etapa: str | None, prod: bool) -> str:
    for nombre, etapas in (_PASOS_PROD if prod else _PASOS):
        if etapa in etapas:
            return nombre
    return ""


def _iso(t: float) -> str:
    return datetime.fromtimestamp(t, timezone.utc).isoformat(timespec="seconds")


def _epoch(iso: str | None) -> float | None:
    try:
        return datetime.fromisoformat(str(iso)).timestamp()
    except (TypeError, ValueError):
        return None


def _corto(texto: str, n: int = 48) -> str:
    texto = " ".join(str(texto or "").split())
    return texto if len(texto) <= n else texto[: n - 1].rstrip() + "…"


def _ficha(tipo: str, ref: str, estado: str, titulo: str, url: str, cuando: float, *,
           detalle: str = "", progreso: int | None = None, devueltos: int | None = None) -> dict:
    # el id cambia con cada corrida: cerrar un aviso no esconde el de la siguiente
    return {"id": f"{tipo}:{ref}:{int(cuando)}", "tipo": tipo, "estado": estado,
            "titulo": titulo, "detalle": detalle, "progreso": progreso, "url": url,
            "cuando": _iso(cuando), "devueltos": devueltos}


# ---------------------------------------------------------------------------
# películas (crear)

def _fallo_al_producir(p: Proyecto) -> bool:
    """Igual que crear: con texto y personaje elegido, el fallo fue al producir."""
    texto = (p.narracion or "").strip() if p.pipeline == "narracion" \
        else any((e.narracion or "").strip() for e in p.guion)
    pj = p.personaje
    return bool(texto) and pj.elegida is not None and pj.elegida < len(pj.opciones)


def ficha_pelicula(p: Proyecto, cuando: float) -> dict | None:
    nombre = f"«{_corto(p.brief)}»"
    url = f"/crear.html?p={quote(p.id)}"
    if p.estado == "preparando":
        return _ficha("pelicula", p.id, "corriendo", f"Escribiendo el guion de {nombre}", url,
                      cuando, detalle=_paso(p.etapa, False))
    if p.estado == "produciendo":
        tot = int(p.progreso.get("escenas_total") or 0)
        listas = int(p.progreso.get("escenas_listas") or 0)
        paso = _paso(p.etapa, True)
        if paso == "Animando las escenas" and tot:
            paso += f" · {listas} de {tot}"
        return _ficha("pelicula", p.id, "corriendo", f"Produciendo {nombre}", url, cuando,
                      detalle=paso, progreso=round(100 * listas / tot) if tot else None)
    if p.estado == "revision":
        return _ficha("pelicula", p.id, "listo", "Tu guion está listo para revisar", url,
                      cuando, detalle=nombre)
    if p.estado == "imagenes":
        return _ficha("pelicula", p.id, "listo", "Tus escenas están listas para aprobar", url,
                      cuando, detalle=nombre)
    if p.estado == "listo":
        return _ficha("pelicula", p.id, "listo", "Tu película está lista", url, cuando,
                      detalle=f"{nombre} · {p.duracion_s} s")
    if p.estado == "error":
        prod = _fallo_al_producir(p)
        paso = _paso(p.etapa, prod)
        devueltos = None
        if creditos.activo():
            devueltos = creditos.producir_cobrado(p) if prod else creditos.costo_preparar()
        return _ficha("pelicula", p.id, "error", f"Se detuvo {nombre}", url, cuando,
                      detalle=f"En «{paso}»." if paso else "", devueltos=devueltos)
    return None   # creado: todavía no es un trabajo


def _peliculas(user: str, desde: float) -> list[dict]:
    if db.backend() == "postgres":
        filas = [(Proyecto.model_validate(d), t) for d, t in db.proyectos_recientes(user, HORAS_VISIBLE)]
    else:
        filas = []
        for p in listar_proyectos():
            try:
                filas.append((p, p.archivo.stat().st_mtime))
            except OSError:
                continue
    out = []
    for p, t in filas:
        if p.archivado or (p.estado not in ("preparando", "produciendo") and t < desde):
            continue
        f = ficha_pelicula(p, t)
        if f:
            out.append(f)
    return out[:MAX_POR_TIPO]


# ---------------------------------------------------------------------------
# lo que vive en proyectos_editor.doc: propuesta de corte y shorts

def _sub(tipo: str, nombre: str, st: dict | None, textos: dict, url_listo: str, url_curso: str,
         desde: float, ahora: float, corriendo: tuple[str, ...]) -> dict | None:
    """Una corrida guardada como {estado, inicio, fin|listo, devueltos, …}."""
    if not isinstance(st, dict) or not st.get("estado"):
        return None
    inicio = _epoch(st.get("inicio"))
    fin = _epoch(st.get("fin") or st.get("listo")) or inicio
    estado = st["estado"]
    if estado in corriendo:
        if inicio is None or ahora - inicio > HORAS_COLGADO * 3600:
            return None
        return _ficha(tipo, nombre, "corriendo", textos["corriendo"], url_curso, inicio,
                      detalle=nombre)
    if fin is None or fin < desde:
        return None
    if estado == "error":
        return _ficha(tipo, nombre, "error", textos["error"], url_curso, fin, detalle=nombre,
                      devueltos=st.get("devueltos"))
    if estado in textos:
        return _ficha(tipo, nombre, "listo", textos[estado], url_listo, fin, detalle=nombre)
    return None


def fichas_editor(nombre: str, doc: dict, desde: float, ahora: float) -> list[dict]:
    q = quote(nombre)
    shorts = doc.get("shorts") or {}
    render = shorts.get("render") if isinstance(shorts, dict) else None
    n = len((render or {}).get("segmentos") or [])
    cand = [
        _sub("editar", nombre, doc.get("editar"),
             {"corriendo": "La IA revisa tu metraje", "listo": "Tu corte propuesto está listo",
              "error": "No se pudo proponer el corte"},
             f"/editor/{q}/", f"/e1.html?p={q}", desde, ahora, ("corriendo",)),
        _sub("importar", nombre, doc.get("importar"),
             {"corriendo": "Trayendo tu video de YouTube", "listo": "Tu video de YouTube ya está aquí",
              "error": "No se pudo traer el video de YouTube"},
             f"/shorts.html?p={q}", f"/shorts.html?p={q}", desde, ahora, ("descargando",)),
        _sub("analizar", nombre, shorts if isinstance(shorts, dict) else None,
             {"corriendo": "Buscando los mejores momentos", "candidatos": "Tus candidatos a shorts están listos",
              "error": "No se pudieron buscar los momentos"},
             f"/shorts.html?p={q}", f"/shorts.html?p={q}", desde, ahora, ("analizando",)),
        _sub("render", nombre, render,
             {"corriendo": f"Renderizando {n} shorts" if n > 1 else "Renderizando tu short",
              "listo": "Tus shorts están listos", "error": "No se pudieron renderizar los shorts"},
             f"/shorts.html?p={q}", f"/shorts.html?p={q}", desde, ahora, ("corriendo",)),
    ]
    return [c for c in cand if c]


def _editor(user: str, desde: float, ahora: float) -> list[dict]:
    if db.backend() != "postgres":
        return []
    out = []
    for fila in db.corridas_editor(user):
        out += fichas_editor(fila["nombre"], fila["doc"] or {}, desde, ahora)
    return out[: MAX_POR_TIPO * 2]


# ---------------------------------------------------------------------------
# lo que vive en S3 como un JSON por corrida: clips, estilos y competencia

def _recientes_s3(prefijo: str, desde: float) -> list[tuple[str, dict]]:
    """Solo abre lo que cambió dentro de la ventana: la fecha viene del listado.
    Lo que sigue corriendo se escribió al lanzarse, hace menos de HORAS_COLGADO."""
    claves = sorted(((k, t) for k, t in media_sync.listar_prefijo_con_fecha(prefijo)
                     if k.endswith(".json") and t >= desde), key=lambda kt: kt[1], reverse=True)
    out = []
    for k, _ in claves[:MAX_POR_TIPO]:
        try:
            doc = json.loads(media_sync.leer_texto(k) or "")
        except ValueError:
            continue
        if isinstance(doc, dict):
            out.append((k.rsplit("/", 1)[-1][: -len(".json")], doc))
    return out


def ficha_s3(tipo: str, ref: str, doc: dict, ahora: float) -> dict | None:
    textos = {
        "clip": ("Generando tu clip de 8 segundos", "Tu clip de 8 segundos está listo",
                 "No se pudo generar tu clip", "/clip.html", _corto(doc.get("texto", ""))),
        "estilo": ("Analizando un estilo", "Tu perfil de estilo está listo",
                   "No se pudo analizar el estilo", "/estilos.html",
                   _corto(doc.get("cuenta") or doc.get("url") or "")),
        "competencia": ("Revisando tu competencia", "Tu informe de competencia está listo",
                        "No se pudo revisar tu competencia", "/competencia.html",
                        _corto(", ".join(str(c.get("cuenta") or c) if isinstance(c, dict) else str(c)
                                         for c in (doc.get("cuentas") or [])))),
    }[tipo]
    corriendo, listo, error, url, detalle = textos
    inicio = _epoch(doc.get("inicio"))
    fin = _epoch(doc.get("listo")) or inicio
    estado = doc.get("estado")
    if estado in ("generando", "analizando"):
        if inicio is None or ahora - inicio > HORAS_COLGADO * 3600:
            return None
        return _ficha(tipo, ref, "corriendo", corriendo, url, inicio, detalle=detalle)
    if fin is None:
        return None
    if estado == "listo":
        return _ficha(tipo, ref, "listo", listo, url, fin, detalle=detalle)
    if estado == "error":
        return _ficha(tipo, ref, "error", error, url, fin, detalle=detalle,
                      devueltos=doc.get("devueltos"))
    return None


def _s3(user: str, desde: float, ahora: float) -> list[dict]:
    if db.backend() != "postgres":
        return []
    out = []
    for tipo, prefijo in (("clip", f"usuarios/{user}/clips/"),
                          ("estilo", f"usuarios/{user}/estilos/"),
                          ("competencia", f"usuarios/{user}/competencia/informes/")):
        for ref, doc in _recientes_s3(prefijo, desde):
            f = ficha_s3(tipo, ref, doc, ahora)
            if f and _epoch(f["cuando"]) >= desde:
                out.append(f)
    return out


# ---------------------------------------------------------------------------

@router.get("")
def trabajos():
    """Lo que corre primero y, dentro de cada grupo, lo más nuevo arriba."""
    ahora = time.time()
    desde = ahora - HORAS_VISIBLE * 3600
    user = db.usuario_actual()
    todos = _peliculas(user, desde) + _editor(user, desde, ahora) + _s3(user, desde, ahora)
    corriendo = [t for t in todos if t["estado"] == "corriendo"]
    resto = sorted((t for t in todos if t["estado"] != "corriendo"),
                   key=lambda t: t["cuando"], reverse=True)
    corriendo.sort(key=lambda t: t["cuando"], reverse=True)
    return {"trabajos": corriendo + resto, "sondeo_s": SONDEO_S,
            "horas_visible": HORAS_VISIBLE}
