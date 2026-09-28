"""M22 — lo que reportaron los testers, la parte de la pantalla: la liga invisible.

Separado de test_m22_testers.py (UI·1, Fase 0 de docs/PLAN-UI.md): allí queda
el cobro sin piso (servidor y worker); aquí solo lo que lee static/shorts.html,
para que retirar el HTML viejo no tumbe los tests del servidor. El reporte
completo está en el docstring de aquel archivo.
"""
import functools
import re
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent


# ---------------------------------------------------------------------------
# B · la liga de YouTube, visible también con un proyecto abierto

@functools.lru_cache(maxsize=None)
def _shorts_html() -> str:
    return (RAIZ / "static" / "shorts.html").read_text(encoding="utf-8")


def test_la_liga_no_vive_solo_en_elegir_proyecto():
    """El bug: `sec-importar` se revelaba en un único sitio, dentro de
    elegirProyecto(), que solo corre cuando la URL NO trae ?p=. Con un proyecto
    abierto la sección no existía y no había dónde pegar la liga."""
    revelados = _shorts_html().count('$("sec-importar").hidden = false')
    assert revelados >= 2, (
        "la sección de la liga vuelve a revelarse en un solo sitio: si ese sitio "
        "es elegirProyecto(), con ?p= en la URL no hay dónde pegar la liga")


def test_cargar_revela_la_liga_con_proyecto_abierto():
    cuerpo = re.search(r"async function cargar\(\) \{(.*?)\n\}", _shorts_html(), re.S)
    assert cuerpo, "cambió la firma de cargar() — revisa este test"
    assert '$("sec-importar").hidden = false' in cuerpo.group(1)


def test_la_descarga_en_curso_sigue_ocultandola():
    """Mientras ESE proyecto se descarga, la sección estorba."""
    assert '$("sec-importar").hidden = true' in _shorts_html()
