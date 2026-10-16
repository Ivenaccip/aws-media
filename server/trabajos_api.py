"""UI·15 — «Tus trabajos»: el cuadro de abajo a la derecha, en todas las pantallas.

Una sola lectura que junta lo que corre y lo que terminó en las últimas
HORAS_VISIBLE horas, de todos los tipos: películas, clips, imágenes en segundo
plano, shorts (importar, analizar, renderizar), la propuesta de corte del
editor IA, estilos y competencia. Cada ficha trae qué es, en qué va y a dónde
llevar al usuario.

Solo lee y no cobra. El cuadro sondea mientras hay algo corriendo, así que lo
que cuesta leer se recorta ANTES de abrir nada: de S3 solo se abren los
documentos que cambiaron dentro de la ventana (la fecha sale del listado).

E2: una copia editable (`doc.editar.copia`) tiene su PROPIA ficha, `tipo: "edicion"`, con
los tres pasos, el resumen y el error en tres partes ya armados aquí: `static/trabajos.js`
pinta lo que llega y no arma frases.

MIX queda fuera a propósito: sus publicaciones diarias las dispara el reloj,
no el usuario, y su pantalla ya dice cómo va la campaña.
"""
from __future__ import annotations

import json
import math
import time
from datetime import datetime, timezone
from urllib.parse import quote

from fastapi import APIRouter

from pipeline import creditos, db, media_sync
from pipeline.project import Proyecto, listar_proyectos
from server import imagen_cola

router = APIRouter(prefix="/api/trabajos", tags=["trabajos"])

HORAS_VISIBLE = 24        # lo terminado se ve un día (dueño, 25-sep)
HORAS_COLGADO = 3         # algo «corriendo» más que esto no se anuncia como vivo
SONDEO_S = 15             # cada cuánto pregunta el cuadro mientras algo corre
MAX_POR_TIPO = 10
# A dónde lleva la ficha de una imagen en segundo plano: el inicio nuevo, que es donde «Mis
# creaciones» enseña el pedido (en curso, lista o con su error). Ni /imagenes.html ni
# /estudio/imagenes/ lo enseñan: son el formulario de crear, vacío. No es /estudio/: aunque desde
# el 14-oct-2026 el inicio está en `todos` (server/migracion.py) y esa URL redirige aquí, con la
# cookie `ui=clasica` sirve el inicio viejo, que no lista pedidos. static/trabajos.js oculta la
# ficha en la pantalla a la que apunta, así que en el propio inicio no se repite lo que «Mis
# creaciones» ya dice.
URL_IMAGEN = "/estudio/inicio/"

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


# ---------------------------------------------------------------------------
# E2 — la copia editable: una ficha propia, con sus tres pasos

PASOS_EDICION = ["Entender", "Editar", "Vista previa"]
_PASO_NOMBRE = dict(zip(("entender", "editar", "vista"), PASOS_EDICION))
MAX_PEDIDO = 140


def reloj(segundos) -> str:
    """Segundos como se lee un reloj: «12:04», «1:18:00». El mismo formato (y el
    mismo redondeo, hacia arriba en la mitad) que `reloj()` de edicion.ts."""
    try:
        s = max(0, int(math.floor(float(segundos) + 0.5)))
    except (TypeError, ValueError, OverflowError):
        return ""
    h, m, r = s // 3600, (s % 3600) // 60, s % 60
    return f"{h}:{m:02d}:{r:02d}" if h else f"{m}:{r:02d}"


def _detalle_paso(paso: str, n: int) -> str:
    """Lo que está pasando AHORA. A propósito no dice «nivelando el sonido» ni
    «con fundidos»: el motor no lo hace (decisión D-07 del contrato E2)."""
    if paso == "vista":
        return "Preparando la vista previa…"
    if paso == "editar":
        return "La IA está editando tu video…" if n == 1 else "La IA está uniendo tus videos…"
    return "Entendiendo tu video…" if n == 1 else f"Ordenando tus {n} videos…"


def _resumen_edicion(editar: dict, n: int) -> tuple[str | None, str | None]:
    """(título, detalle) de una copia terminada, con las cifras de
    `editar.resultado`: nunca se inventan. Sin ellas no hay resumen."""
    r = editar.get("resultado")
    if not isinstance(r, dict):
        return None, None
    entrada, salida = r.get("dur_entrada_s"), r.get("dur_salida_s")
    if not all(isinstance(x, (int, float)) and not isinstance(x, bool) for x in (entrada, salida)):
        return None, None
    rango = f"{reloj(entrada)} → {reloj(salida)}"
    if n >= 2:
        return None, f"Unimos {n} videos · {rango}"
    if not (editar.get("cortes") or editar.get("fluff") or editar.get("flags")):
        # una copia sin nada que cortar: los créditos de la edición vuelven (los
        # devuelve el worker y deja `devueltos`)
        dev = editar.get("devueltos")
        resto = f" Te devolvimos ✦ {dev}." if isinstance(dev, int) and dev > 0 else ""
        return "Tu copia está lista, sin cortes", f"La IA no encontró nada que cortar.{resto}"
    return None, f"Quitamos {reloj(entrada - salida)} · {rango}"


def _entero_positivo(valor) -> int | None:
    return valor if isinstance(valor, int) and not isinstance(valor, bool) and valor > 0 else None


def _se_debe(editar: dict) -> int | None:
    """Los créditos que se están devolviendo AHORA: `devolucion_pendiente` (la dejan el worker, para que
    la cierre el barredor, y el API, que la salda en la siguiente llamada de la persona) mientras
    todavía no conste `devueltos`. Una marca residual de algo ya devuelto no cuenta."""
    if _entero_positivo(editar.get("devueltos")):
        return None
    return _entero_positivo(editar.get("devolucion_pendiente"))


def _error_edicion(nombre: str, editar: dict, n: int) -> dict:
    """El fallo en tres partes: qué pasó, qué pasó con los créditos, qué sigue.
    `creditos` solo existe si de verdad se devolvió algo, o si se está devolviendo (sin monedero no se
    habla de créditos). Mientras se debe una devolución NO se ofrece «Reintentar»: cobraría otra vez
    sin haber devuelto."""
    paso = _PASO_NOMBRE.get(editar.get("paso"), "Editar")
    cr = _entero_positivo(editar.get("creditos"))
    monedero = creditos.activo() and cr is not None
    dev = editar.get("devueltos")
    debe = _se_debe(editar) if creditos.activo() else None
    solo = "Tu original no se tocó." if n == 1 else "Tus videos originales no se tocaron."
    out = {
        "que_paso": (f"Falló el paso «{paso}», de nuestro lado." if n == 1
                     else f"Falló el paso «{paso}» al unir tus {n} videos, de nuestro lado."),
        "que_sigue": solo + (f" Reintentar vuelve a cobrar ✦ {cr}." if monedero else ""),
        "reintentar": {"texto": "Reintentar", "ruta": f"/api/edicion/{nombre}/reintentar"},
    }
    if monedero:
        out["reintentar"]["creditos"] = cr
    if _entero_positivo(dev):
        out = {"que_paso": out["que_paso"], "creditos": f"Te devolvimos ✦ {dev}.",
               "que_sigue": out["que_sigue"], "reintentar": out["reintentar"]}
    elif debe:
        out = {"que_paso": out["que_paso"], "creditos": f"Estamos devolviendo tus ✦ {debe}.",
               "que_sigue": solo}
    return out


def ficha_edicion(nombre: str, doc: dict, desde: float, ahora: float) -> dict | None:
    """La ficha de una copia de E2 (`doc.editar.copia`). Una sola, en lugar de la
    ficha vieja «La IA revisa tu metraje»: la forma de siempre MÁS un objeto
    `edicion` que `static/trabajos.js` pinta tal cual (no arma frases).

    `url` va vacío mientras corre: la bandeja oculta la ficha cuya `url` es la
    página actual, y la caja vive en /estudio/inicio/. Con `cobrado` falso la
    ficha NO se emite: todavía no se cobró y puede no llegar a existir."""
    editar = doc.get("editar")
    if not isinstance(editar, dict) or editar.get("copia") is not True or not editar.get("estado"):
        return None
    if editar.get("cobrado") is False:
        return None
    if editar.get("no_lanzada") is True:
        # falló al LANZAR (502/503): los créditos volvieron y nada llegó a correr, así que no hay un
        # «paso que falló» que contar ni nada que reintentar de esta copia
        return None
    inicio = _epoch(editar.get("inicio"))
    fin = _epoch(editar.get("fin") or editar.get("listo")) or inicio
    estado = editar["estado"]
    debe = estado in ("corriendo", "error") and _se_debe(editar) is not None
    n = editar.get("n_videos")
    if not isinstance(n, int) or isinstance(n, bool) or n < 1:
        n = len(editar.get("fuentes") or []) or 1
    paso = editar.get("paso") if editar.get("paso") in _PASO_NOMBRE else "entender"
    titulo = str(doc.get("titulo") or nombre)
    pedido = _corto(editar.get("instruccion") or "", MAX_PEDIDO)
    edicion = {"nombre": nombre, "paso": paso, "pasos": list(PASOS_EDICION), "pedido": pedido,
               "inicio": editar.get("inicio"), "resumen": None, "enlace": None, "error": None}
    if estado == "corriendo" and not debe:
        if inicio is None or ahora - inicio > HORAS_COLGADO * 3600:
            return None
        f = _ficha("edicion", nombre, "corriendo", f"La IA edita {titulo}", "", inicio,
                   detalle=_detalle_paso(paso, n))
    elif fin is None or fin < desde:
        return None
    elif estado == "listo":
        url = f"/editor/{quote(nombre)}/"
        titulo_listo, detalle = _resumen_edicion(editar, n)
        edicion.update(resumen=detalle, enlace={"texto": "Abrir el editor", "url": url})
        f = _ficha("edicion", nombre, "listo", titulo_listo or "Tu video editado está listo", url, fin,
                   detalle=detalle or "")
    elif estado == "error" or debe:
        # `debe` con la corrida aún `corriendo`: la reabrió el worker para que la cierre el barredor;
        # ya falló, así que no se anuncia como viva
        edicion["error"] = _error_edicion(nombre, editar, n)
        dev = editar.get("devueltos")
        f = _ficha("edicion", nombre, "error",
                   "No se pudo editar tu video" if n == 1 else "No se pudo editar la unión de tus videos",
                   "", fin, devueltos=dev if isinstance(dev, int) and not isinstance(dev, bool) else None)
    else:
        return None
    f["edicion"] = edicion
    return f


def fichas_editor(nombre: str, doc: dict, desde: float, ahora: float) -> list[dict]:
    q = quote(nombre)
    shorts = doc.get("shorts") or {}
    render = shorts.get("render") if isinstance(shorts, dict) else None
    n = len((render or {}).get("segmentos") or [])
    editar = doc.get("editar")
    es_copia = isinstance(editar, dict) and editar.get("copia") is True
    cand = [
        # una copia de E2 tiene su propia ficha; la vieja «La IA revisa tu metraje»
        # sería la misma corrida contada dos veces
        ficha_edicion(nombre, doc, desde, ahora) if es_copia else
        _sub("editar", nombre, editar,
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
# lo que vive en S3 como un JSON por corrida: clips, imágenes, estilos y competencia

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


def _segundos_del_clip(doc: dict) -> int:
    """Lo que el usuario eligió (4, 6 u 8), para el título; 8 si el documento no lo trae."""
    s = doc.get("segundos")
    return s if isinstance(s, int) and not isinstance(s, bool) and s > 0 else 8


def ficha_s3(tipo: str, ref: str, doc: dict, ahora: float) -> dict | None:
    seg = _segundos_del_clip(doc)
    devueltos = doc.get("devueltos")
    if tipo == "imagen":
        # el worker guarda lo cobrado (`creditos`) y si volvió (`devuelto`); un pedido que
        # caducó sin respuesta se enseña como error (lo mismo que «Mis creaciones»)
        doc = imagen_cola.como_se_ve(doc) or {}
        devueltos = doc.get("creditos") if doc.get("devuelto") is not False else None
    textos = {
        "clip": (f"Generando tu clip de {seg} segundos", f"Tu clip de {seg} segundos está listo",
                 "No se pudo generar tu clip", "/clip.html", _corto(doc.get("texto", ""))),
        "imagen": ("Generando tu imagen", "Tu imagen está lista", "No se pudo generar tu imagen",
                   URL_IMAGEN, _corto(doc.get("texto", ""))),
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
        return _ficha(tipo, ref, "error", error, url, fin, detalle=detalle, devueltos=devueltos)
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
    # las imágenes NO listan su prefijo entero (un .json y un .reclamo por pedido, todo el
    # historial): `_mios` solo mira los ids de hoy y de ayer, que cubren las HORAS_VISIBLE
    for ref, doc in imagen_cola._mios(user):
        f = ficha_s3("imagen", ref, doc, ahora)
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
