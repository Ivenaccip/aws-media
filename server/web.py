"""UI·6 — sirve la UI nueva, compilada en web/dist (docs/PLAN-UI.md §3).

dist/ repite las URLs tal cual: dist/estudio/_vitrina/index.html se sirve en
/estudio/_vitrina/ y los assets con hash en /estudio/assets/. Aquí solo se
montan carpetas; una pantalla nueva aparece sola al compilarla.

El montaje es CONDICIONAL. Sin dist (pytest en Windows, un clon recién hecho,
cualquier máquina que no haya corrido `npm run build`) no se monta nada y el
resto del server sigue igual. En la imagen, dist siempre existe: la etapa
`web` del Dockerfile lo construye y, si algo falla, falla el build.

Caché (misma lógica que UI·3 en server/app.py):
  · assets con hash: un año e `immutable` — cambiar el contenido cambia el
    nombre, así que nunca hay que revalidarlos;
  · HTML: `no-cache`, para que el deploy llegue en la siguiente carga;
  · las carpetas que empiezan por «_» (la vitrina), a CUALQUIER profundidad
    (`/estudio/marketing/_borrador/` también), son internas: además llevan
    `X-Robots-Tag: noindex`.
Un asset que no existe da 404 JSON, nunca el HTML de una pantalla: un
<script> que recibe HTML revienta con un error que no dice nada.

Rutas por nivel: una pantalla puede vivir a cualquier profundidad bajo /estudio/
(/estudio/marketing/distrito/imagen/) y `rutas()` es el registro de todas las que
hay compiladas. Con él:
  · una dirección tecleada a mano a la que le falta la barra, o que viene en
    mayúsculas (también «/Estudio/»), con «//» o escrita con «%XX»
    (`/estudio/%6Darketing/`: uvicorn la decodifica y la serviría, pero la página
    lee la dirección cruda y no reconocería su nivel), se corrige con un 302
    RELATIVO (nunca el 307 con URL absoluta de StaticFiles), con el query intacto
    y `Cache-Control: no-store`;
  · una dirección que no existe da el 404 JSON de siempre y, SOLO si quien la
    pide acepta HTML (el tipo `text/html` con q > 0), una página mínima con un
    enlace al nivel de arriba. Las dos caras llevan `Vary: Accept`.
El destino de un 302 sale SIEMPRE del registro (`rutas`) o de la tabla de
alias, jamás de la petición: no hay redirección abierta. Tampoco se refleja
nunca lo pedido en el cuerpo del 404.

Por qué el arreglo vive en el manejador de 404 y no en una ruta: en la app real
el montaje `app.mount("/", …)` de static/ (server/app.py) casa con TODO lo que
llega detrás, así que `/estudio/coi` (sin barra) no encuentra su montaje
`/estudio/coi/…`, cae en static/ y da 404. Por eso las pruebas llevan ese mismo
montaje detrás (tests/test_web_rutas.py): sin él Starlette redirige la barra por
su cuenta y la prueba no vería el defecto.

La raíz /estudio/ ES la página principal (el mapa «Elige un área»): `rutas()` la
cuenta y `montar` registra una ruta explícita GET/HEAD con el mismo `no-cache`, ETag
y 304 que las demás. Antes la decidía server/migracion.py (un 302 a /estudio/inicio/);
ahora esa pantalla vive en /index.html (el inicio clásico, salida de emergencia con
la cookie `ui=clasica`) y migracion.py solo redirige a /estudio/. Si dist no trae
estudio/index.html, la raíz no se sirve (da 404) y `/index.html` sirve el clásico.

Las direcciones de ANTES siguen funcionando:
  · `ENTRADAS_VIEJAS`: /estudio/?prompt=… (la Caja en Imagen), ?brief=… (en Video) y
    ?blotato=conectar (el grupo Blotato) redirigen con un 302 a la página que hoy hace
    eso, con el query intacto. Quien las manda: el editor de cortes, tres pantallas
    clásicas, tres `logica.ts` y la Biblioteca de prompts. El destino sale de la tabla
    y solo se usa si está compilado (`rutas`); cualquier otro query se sirve tal cual;
  · `alias`: las direcciones de pantallas que cambiaron de sitio (`/estudio/inicio/`
    → `/estudio/`). Salen de `migracion.alias_del_estudio()`, que `montar` importa AL
    LLAMARLO (así `server/app.py` no cambia y no hay ciclo). Un alias es inerte
    mientras la carpeta vieja siga existiendo en dist: una pantalla que existe manda.
    La de `/estudio/inicio/` (la página única de antes) se retiró en E5.3, así que su
    alias contesta: 302 a la principal, y de ahí, si trae `?prompt=`/`?brief=`/
    `?blotato=conectar`, un segundo 302 a la herramienta.

El manejador de 404 es ÚNICO por app (Starlette guarda uno por código): `montar`
conserva el que hubiera y le delega todo lo que no es de /estudio/. Un `montar`
sin dist/estudio no registra nada.
"""
from __future__ import annotations

import logging
import posixpath
import re
from html import escape
from inspect import isawaitable
from pathlib import Path
from urllib.parse import quote, quote_from_bytes

from fastapi.exception_handlers import http_exception_handler
from fastapi.responses import HTMLResponse, RedirectResponse
from starlette.exceptions import HTTPException
from starlette.requests import Request
from starlette.staticfiles import StaticFiles

log = logging.getLogger("web")

DIST = Path(__file__).resolve().parent.parent / "web" / "dist"

INMUTABLE = "public, max-age=31536000, immutable"
SIN_CACHE = {"Cache-Control": "no-cache"}
# 302 y no 301 (un 301 se queda en la caché del navegador para siempre) que además no se guarda: el deploy que cambie
# un nivel llega en la siguiente carga.
NO_STORE = {"Cache-Control": "no-store"}
NO_INDEXAR = {"X-Robots-Tag": "noindex, nofollow"}
# El 404 de un nivel tiene dos caras (JSON o página) según el Accept: que ninguna caché sirva una por la otra.
VARIA_CON_ACCEPT = {"Vary": "Accept"}

# Lo que el inicio de una sola página leía de la barra de direcciones y a qué herramienta mandarlo ahora:
# (parámetro, valor exigido o None, destino). El destino sale de AQUÍ, nunca de la petición, y solo se usa si está en `rutas`.
# El editor de cortes (tools/editor/index.html), agenda/métricas/mix clásicas y la Biblioteca de prompts siguen mandando aquí.
ENTRADAS_VIEJAS = (
    ("prompt", None, "/estudio/marketing/distrito/imagen/"),
    ("brief", None, "/estudio/marketing/distrito/video/"),
    ("blotato", "conectar", "/estudio/marketing/blotato/"),
)
RAIZ = "/estudio/"

# Lo único que de un query se deja pasar sin codificar. Igual que RedirectResponse, salvo «#»: un «#» crudo en el query
# (una petición hecha a mano) se codifica en vez de volverse un fragmento.
_QUERY_SEGURO = ":/%?=@[]!$&'()*+,;"

# El texto de esta página lo decide el dueño: se cambia aquí y nada más. El único hueco es {arriba} (se llena con `replace`, no
# con `format`: el CSS lleva llaves); el estilo usa las fichas de carta.css (ahí vive la paleta) y por eso no lleva ningún color suelto.
_PAGINA_404 = (
    '<!doctype html><html lang="es"><head><meta charset="utf-8">'
    '<meta name="viewport" content="width=device-width, initial-scale=1">'
    '<meta name="robots" content="noindex, nofollow"><title>No encontramos esa página</title>'
    '<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/carta.css">'
    '<style>body{margin:0;padding:32px 16px;background:var(--c-fondo);color:var(--c-texto);'
    'font:var(--t-sm)/1.55 var(--f-texto)}main{max-width:440px;margin:0 auto}'
    'h1{margin:0 0 16px;font:800 var(--t-titulo-md)/1.15 var(--f-titulo)}p{margin:0 0 16px}'
    'a{color:var(--c-enlace)}</style></head>'
    '<body><main><h1>No encontramos esa página</h1>'
    '<p>La dirección no existe o cambió de lugar.</p>'
    '<p><a href="{arriba}">Subir un nivel</a> · <a href="/estudio/">Ir al inicio</a></p>'
    '</main></body></html>'
)


class _Assets(StaticFiles):
    def file_response(self, *args, **kwargs):
        resp = super().file_response(*args, **kwargs)
        resp.headers["Cache-Control"] = INMUTABLE
        return resp


def rutas(estudio: Path) -> frozenset[str]:
    """Todas las URLs de pantalla (con barra final) que hay bajo dist/estudio, a cualquier profundidad.

    Es una carpeta con `index.html`; `assets` no cuenta. La raíz «/estudio/» (estudio/index.html) sí."""
    out: set[str] = set()
    for p in estudio.rglob("index.html"):
        rel = p.parent.relative_to(estudio).parts
        if p.is_file() and (not rel or rel[0] != "assets"):
            out.add(RAIZ + "/".join(rel) + "/" if rel else RAIZ)
    return frozenset(out)


def entrada_vieja(query_params, rutas_: frozenset[str]) -> str | None:
    """Si la raíz recibe un parámetro de los de antes, a qué página mandarlo (sin query: lo agrega quien redirige).

    Con un parámetro repetido manda el PRIMER valor, como `URLSearchParams.get` en la página y `params.get` en
    web/e2e/servidor.mjs. `query_params[param]` de Starlette devuelve el último y el servidor decidía al revés que el cliente."""
    for param, valor, destino in ENTRADAS_VIEJAS:
        valores = query_params.getlist(param)
        if valores and (valor is None or valores[0] == valor) and destino in rutas_:
            return destino
    return None


def _limpia(ruta: str) -> str:
    """«/estudio//a/../b» → «/estudio/b»; conserva la barra final."""
    n = posixpath.normpath(re.sub(r"/{2,}", "/", ruta))
    return n + "/" if ruta.endswith("/") and not n.endswith("/") else n


def destino_de(ruta: str, rutas_: frozenset[str], alias: dict[str, str]) -> str | None:
    """A dónde llevar una ruta que no es una pantalla tal cual; None = no se sabe.

    Orden: primero lo que ya es una pantalla (arreglo de barra, de mayúsculas o de «//»); después la URL vieja (alias).
    Lo que devuelve es SIEMPRE un elemento de `rutas_` o un valor de `alias` que está en `rutas_`."""
    r = _limpia(ruta)
    cand = r if r.endswith("/") else r + "/"
    for c in dict.fromkeys((cand, cand.lower())):
        if c in rutas_:                      # una pantalla que existe manda sobre cualquier alias
            return c if c != ruta else None
        if c in alias and alias[c] in rutas_:
            return alias[c]
    return None


def _arriba(ruta: str, rutas_: frozenset[str]) -> str:
    """El nivel más cercano que sí existe, hacia arriba; «/estudio/» si no hay otro.

    Devuelve un elemento de `rutas_` (o «/estudio/»), nunca un trozo de lo pedido. Solo mira tantos niveles como tiene la
    pantalla más profunda: una dirección de miles de tramos no vuelve cuadrático el trabajo."""
    partes = [p for p in ruta.split("/") if p]
    profundo = max((r.count("/") - 1 for r in rutas_), default=0)
    for n in range(min(len(partes) - 1, profundo), 1, -1):
        c = "/" + "/".join(partes[:n]) + "/"
        for k in dict.fromkeys((c, c.lower())):
            if k in rutas_:
                return k
    return "/estudio/"


def _niveles_sin_pagina(rutas_: frozenset[str]) -> list[str]:
    """Los niveles que no son una pantalla pero tienen una debajo (`/estudio/huerfano/` con `/estudio/huerfano/hijo/`), de arriba abajo.

    No dejan ciegos a sus hijos (el montaje es por la carpeta de primer nivel), pero ellos mismos dan 404: casi siempre un `vite build`
    a medias o una carpeta movida sin su `index.html`. La raíz «/estudio/» no cuenta como nivel."""
    sin_pagina: set[str] = set()
    for r in rutas_:
        partes = r.strip("/").split("/")
        for n in range(2, len(partes)):
            nivel = "/" + "/".join(partes[:n]) + "/"
            if nivel not in rutas_:
                sin_pagina.add(nivel)
    return sorted(sin_pagina)


def _con_query(destino: str, scope) -> str:
    """El destino con el query de la petición, byte por byte (sin decodificar nada)."""
    q = scope.get("query_string", b"")
    return f"{destino}?{quote_from_bytes(q, safe=_QUERY_SEGURO)}" if q else destino


def _bajo_estudio(ruta: str) -> bool:
    """/estudio/… menos /estudio/assets y lo que cuelga de ahí: un asset que falta siempre es 404 JSON, aun escrito «Assets».

    Sin distinguir mayúsculas («/Estudio/» es lo mismo que escribirlo bien) y, para lo de assets, sobre la ruta NORMALIZADA (`_limpia`), la
    misma con la que `destino_de` busca el destino: «//assets/», «./assets/» o «x/../assets/» son assets aunque se escriban así."""
    baja = ruta.lower()
    limpia = _limpia(ruta).lower()
    return baja.startswith("/estudio/") and limpia != "/estudio/assets" and not limpia.startswith("/estudio/assets/")


def _pide_html(accept: str) -> bool:
    """¿El Accept pide `text/html` de verdad? Compara el TIPO entero (no una subcadena: «text/htmlx» o «x/text/html» no) y respeta
    `q=0` («no lo quiero»). Un `q` mal escrito no se toma como un no. Si llegan dos cabeceras Accept gana la primera (la de Starlette)."""
    for parte in accept.split(","):
        tipo, *params = (p.strip() for p in parte.split(";"))
        if tipo.lower() != "text/html":
            continue
        q = next((p[2:].strip() for p in params if p[:2].lower() == "q="), "1")
        try:
            if float(q) > 0:
                return True
        except ValueError:
            return True
    return False


def _escrita_con_porcentajes(scope) -> bool:
    """¿La pantalla llegó escrita con «%XX» (`/estudio/%6Darketing/`, `/estudio/marketing%2Fdistrito/`)?

    uvicorn pone en `path` la dirección ya DECODIFICADA y en `raw_path` la que llegó por el cable. La página lee `location.pathname`
    (cruda) y no reconoce su nivel: se manda a la forma normal. Solo cuando la normal es una ruta simple (sin nada que escapar): con un
    nombre que lleva espacio o «&» cada cliente lo escribe a su manera y un bucle de redirecciones sería peor que servirlo. Sin `raw_path`
    (Mangum, detrás de API Gateway, lo manda en None) no hay con qué comparar y se sirve como siempre."""
    raw = scope.get("raw_path")
    ruta = scope["path"]
    return isinstance(raw, bytes) and quote(ruta, safe="/") == ruta and raw != ruta.encode("ascii")


def _es_interna(ruta: str) -> bool:
    """Un tramo que empieza por «_» (`/estudio/_vitrina/`, `/estudio/marketing/_borrador/`) es una página interna, en cualquier nivel."""
    return any(tramo.startswith("_") for tramo in ruta.split("/"))


class _Pantalla(StaticFiles):
    def __init__(self, *args, rutas_: frozenset[str] = frozenset(), alias: dict[str, str] | None = None, **kwargs):
        super().__init__(*args, **kwargs)
        self.rutas = rutas_
        self.alias = alias or {}

    def file_response(self, full_path, stat_result, scope, *args, **kwargs):
        resp = super().file_response(full_path, stat_result, scope, *args, **kwargs)
        resp.headers["Cache-Control"] = "no-cache"
        # lo interno se decide por la dirección completa (cada tramo), no por la carpeta de primer nivel que monta esta clase
        if _es_interna(scope["path"]):
            resp.headers["X-Robots-Tag"] = "noindex, nofollow"
        return resp

    async def get_response(self, path, scope):
        """«/estudio/a/b» (sin barra) → 302 relativo a «/estudio/a/b/», no el 307 con URL absoluta de StaticFiles
        (armada con el Host que llegue; detrás de API Gateway y Cloudflare no es el de afuera). Lo mismo para mayúsculas, «//» y «%XX»."""
        if scope.get("method") in ("GET", "HEAD"):
            ruta = scope["path"]
            if ruta not in self.rutas:
                d = destino_de(ruta, self.rutas, self.alias)
            else:
                d = ruta if _escrita_con_porcentajes(scope) else None
            if d:
                return RedirectResponse(_con_query(d, scope), status_code=302, headers=NO_STORE)
        return await super().get_response(path, scope)


def montar(app, dist: Path = DIST, alias: dict[str, str] | None = None) -> list[str]:
    """Monta lo que haya en dist/estudio y devuelve las rutas servibles, sin barra final y con las anidadas.

    `alias` = {URL vieja con barra: URL nueva con barra}. Sin pasarlo (`None`) sale de `migracion.alias_del_estudio()`,
    importado aquí y no arriba: así `server/app.py` no tiene que cambiar y los dos módulos no se importan en ciclo; `{}`
    es «ninguno». Tiene que llamarse ANTES de `app.mount("/", …)`: ese montaje se queda con todo lo que llegue después.
    Orden de lo devuelto: los assets, la raíz «/estudio» (si dist trae estudio/index.html), las pantallas de primer nivel
    y después las anidadas (que sirve el montaje de su carpeta de primer nivel)."""
    estudio = dist / "estudio"
    if not estudio.is_dir():
        return []
    if alias is None:
        from server import migracion
        alias = migracion.alias_del_estudio()
    todas = rutas(estudio)
    montadas = []
    assets = estudio / "assets"
    if assets.is_dir():
        app.mount("/estudio/assets", _Assets(directory=assets), name="web-assets")
        montadas.append("/estudio/assets")
    if RAIZ in todas:
        sirve_raiz = _Pantalla(directory=estudio, rutas_=todas, alias=alias)   # sin montar: solo index.html (con su ETag y 304)

        async def raiz(request: Request):
            antes = entrada_vieja(request.query_params, todas)
            if antes:
                return RedirectResponse(_con_query(antes, request.scope), status_code=302, headers=NO_STORE)
            return await sirve_raiz.get_response("index.html", request.scope)

        app.add_api_route(RAIZ, raiz, methods=["GET", "HEAD"], include_in_schema=False, name="web-raiz")
        montadas.append("/estudio")
    # Se monta cada carpeta de primer nivel que tenga una pantalla en cualquier profundidad (no solo las que traen su
    # propio index.html): así un nivel sin index.html no deja ciegos a sus hijos. Ese nivel no es una ruta y da 404.
    for nombre in sorted({r.split("/")[2] for r in todas if r != RAIZ}):
        ruta = f"/estudio/{nombre}"
        app.mount(ruta, _Pantalla(directory=estudio / nombre, html=True, rutas_=todas, alias=alias), name=f"web-{nombre}")
        if f"{ruta}/" in todas:
            montadas.append(ruta)
    montadas += [r.rstrip("/") for r in sorted(todas) if r.count("/") > 3]
    for nivel in _niveles_sin_pagina(todas):
        log.warning("web: %s no tiene index.html pero tiene páginas debajo: esa dirección da 404", nivel)

    previo = app.exception_handlers.get(404)

    async def no_encontrada(request: Request, exc: HTTPException):
        ruta = request.scope["path"]
        de_un_nivel = request.method in ("GET", "HEAD") and exc.detail == "Not Found" and _bajo_estudio(ruta)
        if de_un_nivel:
            d = destino_de(ruta, todas, alias)
            if d:
                return RedirectResponse(_con_query(d, request.scope), status_code=302, headers=NO_STORE)
            if _pide_html(request.headers.get("accept", "")):
                pagina = _PAGINA_404.replace("{arriba}", escape(_arriba(_limpia(ruta), todas), quote=True))
                return HTMLResponse(pagina, status_code=404, headers={**SIN_CACHE, **NO_INDEXAR, **VARIA_CON_ACCEPT})
        if previo is not None:
            resp = previo(request, exc)
            resp = await resp if isawaitable(resp) else resp
        else:
            resp = await http_exception_handler(request, exc)
        if de_un_nivel:                      # el 404 de un nivel que no pidió HTML: la otra cara del mismo 404
            resp.headers["Vary"] = "Accept"
        return resp

    app.add_exception_handler(404, no_encontrada)
    return montadas
