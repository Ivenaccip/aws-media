"""UI·7 — el interruptor de migración: la ÚNICA autoridad sobre qué versión
de cada pantalla ve cada quien (docs/PLAN-UI.md §3 y §4, fase 5).

Cada pantalla que se migra a web/ pasa por tres etapas, una por deploy:

  · `nueva`    la pantalla nueva existe, pero solo se llega tecleando su URL
               (/estudio/<p>/). La vieja sigue igual. Es el canario del dueño.
  · `todos`    la URL vieja responde 302 a la nueva, SALVO que el usuario
               tenga la cookie `ui=clasica` (la deja /ui/clasica?pantalla=<p>,
               que se abre a mano: el enlace «Usar la versión anterior» del
               Marco se quitó el 28-sep). Así una pantalla nueva con un bug se
               revierte para UNA persona sin desplegar.
  · `retirada` 302 siempre, con o sin cookie; el HTML viejo ya no existe.

Reglas del 302 (el precedente de /crear-imagenes.html perdía el query):
  · CONSERVA el query: /admin.html?x=1 → /estudio/admin/?x=1;
  · lleva `Cache-Control: no-store`, para que pasar de etapa llegue en la
    siguiente carga y el navegador no se quede con un 302 viejo;
  · deja una línea de log con el `sub` del usuario. Las peticiones de HTML no
    se autentican (server/auth.py solo protege /api/ y /editor/), así que el
    sub se lee de la cookie `token` SIN verificar la firma: sirve para contar
    («≥ 3 de 5 usuarios pasaron por la nueva»), nunca para dar acceso.

Si web/dist no trae la pantalla nueva (pytest en Windows, un clon sin
`npm run build`), `todos` no redirige: mandaría a un 404. `retirada` sí,
porque ya no hay nada viejo que servir.

La principal (/estudio/) es la NUEVA del inicio y no una URL vieja, así que
lo de arriba no la cubre. `principal_a_la_clasica` hace lo mismo para ella:
con la cookie `ui=clasica` (o sin la principal compilada) lleva a la
versión anterior, /index.html. Todo lo que trae a alguien de vuelta al
estudio apunta a /estudio/; sin esto la salida de emergencia del inicio
duraba una carga.

Cambiar de etapa = editar PANTALLAS y desplegar (lo corre el dueño).
tests/test_migracion_ui.py exige, antes de `todos`, que cada invariante de la
pantalla exista como test en web/.

UI_ETAPA_MINIMA (solo el stack de dev la tiene, infra/stacks/api.py): sube
TODAS las pantallas por lo menos a esa etapa sin tocar PANTALLAS. Las etapas
viven en el código y el código de dev es el que luego llega a main: pasar una
pantalla a `todos` para verla en dev la pasaría también en producción. Con la
variable, dev navega por las pantallas nuevas y prod sigue donde diga
PANTALLAS. Solo acepta `todos`: `retirada` quitaría la salida de emergencia
(/ui/clasica) y `nueva` no cambiaría nada.
"""
from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from pathlib import Path

from fastapi import Request
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse

log = logging.getLogger("migracion")

ETAPAS = ("nueva", "todos", "retirada")

COOKIE = "ui"
CLASICA = "clasica"
# 7 días: la regla de retiro es «7 días en `todos` sin incidentes de dinero».
# Quien eligió la clásica vuelve a ver la nueva al cabo de ese tiempo.
DURACION_COOKIE = 7 * 24 * 3600

ETAPA_MINIMA_VAR = "UI_ETAPA_MINIMA"
MINIMAS = ("todos",)

NO_STORE = {"Cache-Control": "no-store"}
SIN_CACHE = {"Cache-Control": "no-cache"}

# La página principal del estudio (el mapa, server/web.py): la `nueva` del inicio.
PRINCIPAL = "/estudio/"


@dataclass(frozen=True)
class Pantalla:
    vieja: str       # la URL de siempre, p. ej. /admin.html
    nueva: str       # /estudio/<p>/ (o más hondo: /estudio/<área>/<grupo>/<p>/); la principal es /estudio/
    etapa: str
    # el HTML viejo en static/, si no se llama como la URL
    fichero: str = ""

    @property
    def archivo(self) -> str:
        return self.fichero or self.vieja.lstrip("/")


PANTALLAS: dict[str, Pantalla] = {
    # el piloto: solo la usa el dueño (grupo admin de Cognito)
    "admin": Pantalla(vieja="/admin.html", nueva="/estudio/admin/", etapa="nueva"),
    # UI·8.1: la primera con usuarios reales; cobra una sola cosa
    "clip": Pantalla(vieja="/clip.html", nueva="/estudio/clip/", etapa="nueva"),
    # UI·8.2: las dos cobran una cosa y comparten el patrón «lista que se
    # sondea mientras la IA trabaja» (nucleo/useListaViva.ts)
    "estilos": Pantalla(vieja="/estilos.html", nueva="/estudio/estilos/", etapa="nueva"),
    # E7.6 (31-oct-2026): la competencia vive en su lugar del mapa, Marketing ›
    # Blotato; /estudio/competencia/ (la carpeta plana de antes, que da nombre
    # a la clave) es un alias con 302. /competencia.html no cambia: sigue en `nueva`
    "competencia": Pantalla(vieja="/competencia.html", nueva="/estudio/marketing/blotato/competencia/", etapa="nueva"),
    # UI·8.3: editar metraje (e1). Sube con progreso real y cobra una cosa,
    # «Proponer ✦ N»; la URL nueva dice lo que se hace en ella
    "subir": Pantalla(vieja="/e1.html", nueva="/estudio/subir/", etapa="nueva"),
    # UI·8.4: el inicio. Cobra en su caja (el clip, la imagen, editar una imagen
    # y la edición de un video); lo demás lo reparte a las pantallas que cobran.
    # 14-oct-2026: la primera en `todos`, por decisión del dueño.
    # Rutas por nivel (22-oct-2026): la principal ES /estudio/ (el mapa), así que
    # la URL vieja ya no puede ser /estudio/ misma: con vieja == nueva, `retirada`
    # y «sin dist» darían un bucle de redirecciones, y /ui/clasica?pantalla=inicio
    # dejaría de llevar al clásico. La versión anterior (static/index.html) queda
    # en /index.html: en `todos` redirige a /estudio/, y con la cookie `ui=clasica`
    # (la deja /ui/clasica?pantalla=inicio) sirve el clásico. /estudio/inicio/ (la
    # página única de antes) se retiró: ya no es una carpeta de web/estudio/ y el
    # alias de más abajo la manda a /estudio/ con un 302.
    "inicio": Pantalla(vieja="/index.html", nueva="/estudio/", etapa="todos"),
    # UI·8.5: shorts cobra tres cosas (importar, analizar, renderizar). La
    # subida es la misma de editar metraje (marca/SubirVideo)
    "shorts": Pantalla(vieja="/shorts.html", nueva="/estudio/shorts/", etapa="nueva"),
    # UI·8.6: las dos hermanas de Blotato (lo programado y lo que ya salió).
    # No cobran; leen de Blotato y cuidan su cupo de 60 llamadas por minuto.
    # E7.5 (31-oct-2026): la agenda vive en su lugar del mapa, Marketing ›
    # Blotato; /estudio/agenda/ (la carpeta plana de antes, que da nombre a la
    # clave) es un alias con 302. /agenda.html no cambia: sigue en `nueva`
    "agenda": Pantalla(vieja="/agenda.html", nueva="/estudio/marketing/blotato/agenda/", etapa="nueva"),
    "metricas": Pantalla(vieja="/metricas.html", nueva="/estudio/metricas/", etapa="nueva"),
    # UI·8.7: crear, editar con pincel o transformar. Cobra una cosa por envío
    # y modera el texto antes de cobrar
    "imagenes": Pantalla(vieja="/imagenes.html", nueva="/estudio/imagenes/", etapa="nueva"),
    # UI·8.8: MIX cobra la campaña ENTERA al encender y devuelve por día
    "mix": Pantalla(vieja="/mix.html", nueva="/estudio/mix/", etapa="nueva"),
    # UI·8.9: crear una película. Cobra el guion al empezar, el resto al
    # producir y cada imagen que se cambia; el 302 conserva ?p=, ?brief= y ?modo=
    "crear": Pantalla(vieja="/crear.html", nueva="/estudio/crear/", etapa="nueva"),
    # Ajustes 3 (16-oct-2026): la Biblioteca de prompts NACE sin versión anterior (no hay nada que migrar ni a lo que volver). Se registra
    # directo en `retirada` —302 siempre a la nueva, sin HTML viejo ni cookie— para entrar al guardián de invariantes y al mapa
    # docs/migracion/biblioteca.md igual que las demás; `/biblioteca.html` queda de dirección corta. No cobra. E7.2 (31-oct-2026): vive en
    # su lugar del mapa, Central › Distrito; /estudio/biblioteca/ (la carpeta plana de antes, que da nombre a la clave) es un alias con 302
    "biblioteca": Pantalla(vieja="/biblioteca.html", nueva="/estudio/central/distrito/biblioteca/", etapa="retirada"),
    # 16-oct-2026: COI (Contexto · Objetivo · Instrucciones) nace en la UI nueva: NO tuvo pantalla vieja. Se registra `retirada` desde
    # el primer día para que el registro anti-pérdida cubra sus invariantes (docs/migracion/coi.md); `/coi.html` solo es un atajo que
    # redirige. Gratis (3 al día); lo que la persona escribe no se guarda en ningún lado. E7.1 (31-oct-2026): vive en su lugar del mapa,
    # Central › Distrito; /estudio/coi/ (la carpeta plana de antes, que da nombre a la clave) es un alias con 302 (alias_del_estudio)
    "coi": Pantalla(vieja="/coi.html", nueva="/estudio/central/distrito/coi/", etapa="retirada"),
    # 20-oct-2026: Automatizaciones › Distrito. El Constructor y el Asistente NACEN en la UI nueva, como COI y la Biblioteca: no tuvieron
    # pantalla vieja. Se registran `retirada` desde el primer día (302 siempre a la nueva, sin HTML viejo ni cookie) para que el registro
    # anti-pérdida cubra sus invariantes (docs/migracion/constructor.md y asistente.md); `/constructor.html` y `/asistente.html` solo son
    # atajos. No chocan con `/automatiza*` (la página pública del RAG, otra cosa). El Constructor no cobra ni llama a ningún servicio (todo
    # se arma en el navegador); el Asistente corre en modo prueba: muestras enlatadas, sin base, sin cola, sin proveedor y sin créditos
    # (gasto 0). Su modo real exige el «sí» del dueño con el costo a la vista y NO está implementado. E7.3 (31-oct-2026): el Constructor
    # vive en su lugar del mapa, Automatizaciones › Distrito; /estudio/constructor/ (la carpeta plana de antes, que da nombre a la clave)
    # es un alias con 302. E7.4 (31-oct-2026): el Asistente también, a su lado; /estudio/asistente/ es otro alias con 302
    "constructor": Pantalla(vieja="/constructor.html", nueva="/estudio/automatizaciones/distrito/constructor/", etapa="retirada"),
    "asistente": Pantalla(vieja="/asistente.html", nueva="/estudio/automatizaciones/distrito/asistente/", etapa="retirada"),
}


def alias_del_estudio() -> dict[str, str]:
    """Las URLs viejas bajo /estudio/ → su canónica nueva, para server/web.py.

    La clave de PANTALLAS ES el nombre de la carpeta de siempre (/estudio/<p>/), así que el alias se deduce: lo que
    cambió de sitio. El inicio (/estudio/inicio/ → /estudio/), cuya carpeta se retiró en E5.3, y cada hoja del mapa que
    E7 mudó a su carpeta anidada (/estudio/coi/ → /estudio/central/distrito/coi/): sus carpetas planas ya no existen, así
    que esos alias están activos. Un alias es inerte mientras su carpeta vieja siga existiendo en web/dist: una pantalla
    que existe manda sobre cualquier alias (web.destino_de). Ningún alias apunta a otro alias ni a sí mismo
    (tests/test_web_rutas.py)."""
    return {f"/estudio/{n}/": p.nueva for n, p in PANTALLAS.items() if p.nueva != f"/estudio/{n}/"}


def etapa_minima() -> str:
    """La etapa mínima del entorno, o "" si no hay. Un valor que no sea
    `todos` revienta: mejor que el deploy falle a que dev se quede en `nueva`
    sin avisar o que alguien retire pantallas por una variable."""
    v = os.getenv(ETAPA_MINIMA_VAR, "").strip()
    if v and v not in MINIMAS:
        raise ValueError(f"migracion: {ETAPA_MINIMA_VAR}={v!r}; solo se acepta {MINIMAS}")
    return v


def etapa(p: Pantalla) -> str:
    """La etapa que rige de verdad: la de PANTALLAS o la mínima del entorno,
    la que vaya más adelante."""
    minima = etapa_minima()
    if minima and ETAPAS.index(minima) > ETAPAS.index(p.etapa):
        return minima
    return p.etapa


def _sub(request: Request) -> str:
    """El sub del id_token de la cookie, sin verificar. Solo para el log."""
    token = request.cookies.get("token")
    if not token:
        return "anonimo"
    try:
        import jwt
        return str(jwt.decode(token, options={"verify_signature": False}).get("sub") or "?")
    except Exception:  # noqa: BLE001 — un token roto no tumba la navegación
        return "?"


def _con_query(ruta: str, request: Request) -> str:
    return f"{ruta}?{request.url.query}" if request.url.query else ruta


def _anotar(accion: str, nombre: str, p: Pantalla, request: Request) -> None:
    log.info("migracion %s pantalla=%s etapa=%s sub=%s", accion, nombre, etapa(p), _sub(request))


def decidir(nombre: str, request: Request, nueva_montada: bool) -> str | None:
    """A dónde redirige la URL vieja de `nombre`; None = servir la vieja."""
    p = PANTALLAS[nombre]
    e = etapa(p)
    if e == "retirada":
        return _con_query(p.nueva, request)
    if e == "todos" and nueva_montada and request.cookies.get(COOKIE) != CLASICA:
        return _con_query(p.nueva, request)
    return None


def _de_la_principal() -> Pantalla | None:
    """La pantalla cuya nueva es la principal (hoy, el inicio); None si no hay. Se busca por su `nueva`, no por su clave."""
    return next((p for p in PANTALLAS.values() if p.nueva == PRINCIPAL), None)


def principal_a_la_clasica(request: Request, principal_montada: bool = True) -> str | None:
    """A dónde manda /estudio/ a quien no debe ver la principal: la URL vieja del inicio (/index.html), con el query. None = servirla.

    Dos casos, los dos solo mientras la clásica exista (en `retirada` ya no hay, y /index.html manda aquí: sería un bucle):
      · la cookie `ui=clasica`. Todo lo que trae a alguien de vuelta al estudio —el login (callback.html, entrar.html), los «← Estudio»
        de las pantallas clásicas, el editor de cortes, «Conectar Blotato»— apunta a /estudio/: sin esto quien volvió a la clásica
        salía de ella al primer clic. Va con el query: la clásica lee ?blotato=conectar;
      · sin la principal compilada (un clon sin `npm run build`, pytest en Windows) /estudio/ no tiene nada que servir: el login
        terminaría en un 404. Así se sigue entrando, al clásico, como antes de las rutas por nivel."""
    p = _de_la_principal()
    if p is None or etapa(p) == "retirada":
        return None
    if principal_montada and request.cookies.get(COOKIE) != CLASICA:
        return None
    return _con_query(p.vieja, request)


def montar(app, montadas: list[str], static: Path) -> None:
    """Registra la URL vieja de cada pantalla y las rutas /ui/clasica y /ui/nueva.

    Va ANTES de `app.mount("/", …)`, igual que web.montar, y recibe lo que
    este montó para saber qué pantallas nuevas existen de verdad."""
    minima = etapa_minima()   # un valor mal escrito revienta al arrancar
    if minima:
        log.info("migracion: %s=%s, ninguna pantalla por debajo de esa etapa",
                 ETAPA_MINIMA_VAR, minima)
    for nombre, p in PANTALLAS.items():
        if p.etapa not in ETAPAS:
            raise ValueError(f"migracion: etapa desconocida {p.etapa!r} en {nombre}")
        montada = p.nueva.rstrip("/") in montadas
        # HEAD como GET: `curl -I` y los verificadores de enlaces tienen que ver lo mismo que el navegador (sin él, HEAD /index.html
        # caía en el montaje de static/ y daba 200 mientras GET daba el 302)
        app.add_api_route(p.vieja, _vista_vieja(nombre, montada, static),
                          methods=["GET", "HEAD"], include_in_schema=False)
    # Sin la principal compilada web.montar no registra /estudio/: aquí se registra para que lleve a la clásica
    # (principal_a_la_clasica). Con ella, es la ruta de web.montar la que pregunta.
    if PRINCIPAL.rstrip("/") not in montadas and _de_la_principal() is not None:
        app.add_api_route(PRINCIPAL, _principal_sin_compilar, methods=["GET", "HEAD"],
                          include_in_schema=False, name="migracion-principal-sin-compilar")

    @app.get("/ui/clasica", include_in_schema=False)
    def _usar_clasica(request: Request, pantalla: str = ""):
        """«Usar la versión anterior»: deja la cookie y lleva a la URL vieja."""
        p = PANTALLAS.get(pantalla)
        if p is None:
            return RedirectResponse("/estudio/", status_code=302, headers=NO_STORE)
        if etapa(p) == "retirada":
            # ya no hay versión anterior: se queda en la nueva
            return RedirectResponse(p.nueva, status_code=302, headers=NO_STORE)
        _anotar("clasica", pantalla, p, request)
        resp = RedirectResponse(p.vieja, status_code=302, headers=NO_STORE)
        resp.set_cookie(COOKIE, CLASICA, max_age=DURACION_COOKIE, path="/",
                        httponly=True, samesite="lax",
                        secure=request.url.scheme == "https")
        return resp

    @app.get("/ui/nueva", include_in_schema=False)
    def _volver_a_la_nueva(request: Request, pantalla: str = ""):
        """El camino de vuelta: borra la cookie y lleva a la pantalla nueva."""
        p = PANTALLAS.get(pantalla)
        destino = p.nueva if p else "/estudio/"
        if p:
            _anotar("nueva", pantalla, p, request)
        resp = RedirectResponse(destino, status_code=302, headers=NO_STORE)
        resp.delete_cookie(COOKIE, path="/")
        return resp


def _principal_sin_compilar(request: Request):
    destino = principal_a_la_clasica(request, principal_montada=False)
    if destino:
        return RedirectResponse(destino, status_code=302, headers=NO_STORE)
    return JSONResponse({"detail": "Not Found"}, status_code=404)


def _vista_vieja(nombre: str, montada: bool, static: Path):
    p = PANTALLAS[nombre]
    archivo = static / p.archivo

    def vista(request: Request):
        destino = decidir(nombre, request, montada)
        if destino:
            _anotar("302", nombre, p, request)
            return RedirectResponse(destino, status_code=302, headers=NO_STORE)
        if not archivo.is_file():
            return JSONResponse({"detail": "Not Found"}, status_code=404)
        return FileResponse(archivo, headers=SIN_CACHE)

    vista.__name__ = f"_vieja_{nombre}"
    return vista
