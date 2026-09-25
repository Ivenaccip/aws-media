"""UI·14 — las doce pantallas de la app usan la carta de diseño.

callback.html se queda fuera a propósito (docs/PLAN-UI.md §4: solo redirige).
"""
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parent.parent
PANTALLAS = ["index", "crear", "imagenes", "clip", "e1", "shorts", "estilos",
             "agenda", "metricas", "competencia", "mix", "admin"]


@pytest.mark.parametrize("nombre", PANTALLAS)
def test_carga_la_carta_y_los_iconos(nombre):
    html = (RAIZ / "static" / f"{nombre}.html").read_text(encoding="utf-8")
    assert 'href="/carta.css"' in html
    assert 'src="/iconos.js"' in html
    assert "sepia(" not in html


def test_un_boton_oculto_no_se_ve():
    """.btn es inline-flex y le ganaba al atributo hidden."""
    css = (RAIZ / "static" / "carta.css").read_text(encoding="utf-8")
    assert ".btn[hidden] { display: none; }" in css


@pytest.mark.parametrize("nombre", ["clip", "competencia", "mix"])
def test_los_avisos_van_en_la_caja_de_aviso(nombre):
    """Dueño, 25-sep: un aviso no es texto ámbar suelto ni gris perdido."""
    html = (RAIZ / "static" / f"{nombre}.html").read_text(encoding="utf-8")
    assert 'class="aviso aviso-caja"' in html
    css = (RAIZ / "static" / "carta.css").read_text(encoding="utf-8")
    assert "--c-aviso-fondo: #2e2110;" in css and "--c-aviso-borde: #a96716;" in css
