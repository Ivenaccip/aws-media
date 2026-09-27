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
  · las carpetas que empiezan por «_» (la vitrina) son internas: además
    llevan `X-Robots-Tag: noindex`.
Un asset que no existe da 404 JSON, nunca el HTML de una pantalla: un
<script> que recibe HTML revienta con un error que no dice nada.
"""
from __future__ import annotations

from pathlib import Path

from starlette.staticfiles import StaticFiles

DIST = Path(__file__).resolve().parent.parent / "web" / "dist"

INMUTABLE = "public, max-age=31536000, immutable"


class _Assets(StaticFiles):
    def file_response(self, *args, **kwargs):
        resp = super().file_response(*args, **kwargs)
        resp.headers["Cache-Control"] = INMUTABLE
        return resp


class _Pantalla(StaticFiles):
    def __init__(self, *args, interna: bool = False, **kwargs):
        super().__init__(*args, **kwargs)
        self.interna = interna

    def file_response(self, *args, **kwargs):
        resp = super().file_response(*args, **kwargs)
        resp.headers["Cache-Control"] = "no-cache"
        if self.interna:
            resp.headers["X-Robots-Tag"] = "noindex, nofollow"
        return resp


def montar(app, dist: Path = DIST) -> list[str]:
    """Monta lo que haya en dist/estudio y devuelve las rutas montadas.

    Tiene que llamarse ANTES de `app.mount("/", …)`: ese montaje se queda con
    todo lo que llegue después."""
    estudio = dist / "estudio"
    if not estudio.is_dir():
        return []
    montadas = []
    assets = estudio / "assets"
    if assets.is_dir():
        app.mount("/estudio/assets", _Assets(directory=assets), name="web-assets")
        montadas.append("/estudio/assets")
    for d in sorted(estudio.iterdir()):
        if d.name == "assets" or not (d / "index.html").is_file():
            continue
        ruta = f"/estudio/{d.name}"
        app.mount(ruta, _Pantalla(directory=d, html=True, interna=d.name.startswith("_")),
                  name=f"web-{d.name}")
        montadas.append(ruta)
    return montadas
