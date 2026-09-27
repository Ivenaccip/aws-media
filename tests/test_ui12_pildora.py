"""UI·12 — la píldora del saldo no se encima con nada.

monedero.js la clava fija arriba a la derecha (top 12 px, 40 px de alto: acaba
a 52 px) en todas las pantallas; cada pantalla le deja su franja. Se auditaron
las 12 pantallas y los estados de crear a 390, 700, 1000 y 1280 px con el
avatar visible: solo chocaban el inicio en celular (el título) y crear fuera
del formulario (la primera tarjeta, en revisión hasta en escritorio).
"""
import re
from pathlib import Path

ESTATICOS = Path(__file__).resolve().parent.parent / "static"
MONEDERO = (ESTATICOS / "monedero.js").read_text(encoding="utf-8")
CREAR = (ESTATICOS / "crear.html").read_text(encoding="utf-8")
INICIO = (ESTATICOS / "index.html").read_text(encoding="utf-8")

FIN_PILDORA = 52   # top 12 + botón de 40


def test_la_pildora_sigue_donde_estaba():
    """Decisión del dueño (25-sep): el saldo se queda arriba a la derecha."""
    assert "position:fixed;top:12px;right:14px;" in MONEDERO
    assert "width:40px;height:40px;" in MONEDERO


def test_crear_baja_todos_sus_estados_sin_cabecera():
    m = re.search(r"#progreso, #revision, #imagenes, #resultado, #error \{ padding-top:(\d+)px; \}", CREAR)
    assert m, "algún estado de crear volvió a quedar debajo de la píldora"
    margen_main = int(re.search(r"main \{ max-width:720px; margin:(\d+)px auto;", CREAR).group(1))
    assert margen_main + int(m.group(1)) >= FIN_PILDORA + 16


def test_crear_no_duplica_el_espacio_del_formulario():
    """El formulario ya tiene su cabecera con la franja libre."""
    assert "#form" not in re.search(r"#progreso, #revision[^{]*\{", CREAR).group(0)


def test_el_inicio_en_celular_baja_el_titulo():
    movil = INICIO[INICIO.index("@media (max-width: 860px)"):]
    m = re.search(r"\.layout \{ grid-template-columns: 1fr; padding-top: (\d+)px; \}", movil)
    assert m and int(m.group(1)) >= FIN_PILDORA + 16
