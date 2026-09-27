"""UI·7 — el interruptor de migración: la ÚNICA autoridad sobre qué versión
de cada pantalla ve cada quien (docs/PLAN-UI.md §3 y §4, fase 5).

Cada pantalla que se migra a web/ pasa por tres etapas, una por deploy:

  · `nueva`    la pantalla nueva existe, pero solo se llega tecleando su URL
               (/estudio/<p>/). La vieja sigue igual. Es el canario del dueño.
  · `todos`    la URL vieja responde 302 a la nueva, SALVO que el usuario
               tenga la cookie `ui=clasica` (el enlace «Usar la versión
               anterior» del Marco). Así una pantalla nueva con un bug se
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

Cambiar de etapa = editar PANTALLAS y desplegar (lo corre el dueño).
tests/test_migracion_ui.py exige, antes de `todos`, que cada invariante de la
pantalla exista como test en web/.
"""
from __future__ import annotations

import logging
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

NO_STORE = {"Cache-Control": "no-store"}
SIN_CACHE = {"Cache-Control": "no-cache"}


@dataclass(frozen=True)
class Pantalla:
    vieja: str       # la URL de siempre, p. ej. /admin.html
    nueva: str       # /estudio/<p>/
    etapa: str
    # el HTML viejo en static/, si no se llama como la URL (el inicio vive en
    # /estudio/ y su archivo es index.html)
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
    "competencia": Pantalla(vieja="/competencia.html", nueva="/estudio/competencia/", etapa="nueva"),
    # UI·8.3: editar metraje (e1). Sube con progreso real y cobra una cosa,
    # «Proponer ✦ N»; la URL nueva dice lo que se hace en ella
    "subir": Pantalla(vieja="/e1.html", nueva="/estudio/subir/", etapa="nueva"),
    # UI·8.4: el inicio. Su URL vieja es /estudio/ misma (tarjetas 37 y 38):
    # la nueva vive al lado, en /estudio/inicio/, y en `todos` /estudio/
    # redirige ahí. No cobra: reparte a las pantallas que cobran.
    "inicio": Pantalla(vieja="/estudio/", nueva="/estudio/inicio/", etapa="nueva", fichero="index.html"),
    # UI·8.5: shorts cobra tres cosas (importar, analizar, renderizar). La
    # subida es la misma de editar metraje (marca/SubirVideo)
    "shorts": Pantalla(vieja="/shorts.html", nueva="/estudio/shorts/", etapa="nueva"),
    # UI·8.6: las dos hermanas de Blotato (lo programado y lo que ya salió).
    # No cobran; leen de Blotato y cuidan su cupo de 60 llamadas por minuto
    "agenda": Pantalla(vieja="/agenda.html", nueva="/estudio/agenda/", etapa="nueva"),
    "metricas": Pantalla(vieja="/metricas.html", nueva="/estudio/metricas/", etapa="nueva"),
    # UI·8.7: crear, editar con pincel o transformar. Cobra una cosa por envío
    # y modera el texto antes de cobrar
    "imagenes": Pantalla(vieja="/imagenes.html", nueva="/estudio/imagenes/", etapa="nueva"),
    # UI·8.8: MIX cobra la campaña ENTERA al encender y devuelve por día
    "mix": Pantalla(vieja="/mix.html", nueva="/estudio/mix/", etapa="nueva"),
}


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
    log.info("migracion %s pantalla=%s etapa=%s sub=%s", accion, nombre, p.etapa, _sub(request))


def decidir(nombre: str, request: Request, nueva_montada: bool) -> str | None:
    """A dónde redirige la URL vieja de `nombre`; None = servir la vieja."""
    p = PANTALLAS[nombre]
    if p.etapa == "retirada":
        return _con_query(p.nueva, request)
    if p.etapa == "todos" and nueva_montada and request.cookies.get(COOKIE) != CLASICA:
        return _con_query(p.nueva, request)
    return None


def montar(app, montadas: list[str], static: Path) -> None:
    """Registra la URL vieja de cada pantalla y las rutas /ui/clasica y /ui/nueva.

    Va ANTES de `app.mount("/", …)`, igual que web.montar, y recibe lo que
    este montó para saber qué pantallas nuevas existen de verdad."""
    for nombre, p in PANTALLAS.items():
        if p.etapa not in ETAPAS:
            raise ValueError(f"migracion: etapa desconocida {p.etapa!r} en {nombre}")
        montada = p.nueva.rstrip("/") in montadas
        app.add_api_route(p.vieja, _vista_vieja(nombre, montada, static),
                          methods=["GET"], include_in_schema=False)

    @app.get("/ui/clasica", include_in_schema=False)
    def _usar_clasica(request: Request, pantalla: str = ""):
        """«Usar la versión anterior»: deja la cookie y lleva a la URL vieja."""
        p = PANTALLAS.get(pantalla)
        if p is None:
            return RedirectResponse("/estudio/", status_code=302, headers=NO_STORE)
        if p.etapa == "retirada":
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
