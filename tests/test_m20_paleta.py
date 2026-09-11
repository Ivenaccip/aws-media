"""M20 — «Ámbar sobre medianoche»: una sola paleta para todo el producto.

Antes de esto convivían TRES: la magenta/violeta de crear*, la azul sobria de
e1/shorts/estilos/index/admin y el púrpura/turquesa del orbe. Este test es el
guardián de que no vuelvan a divergir: cualquier color nuevo que no salga de la
paleta falla aquí, y añadirlo obliga a decidirlo a propósito.
"""
import json
import re
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parent.parent
ESTATICOS = RAIZ / "static"

# La paleta, tal cual la referencia. Cada entrada dice qué papel cumple para que
# añadir una nueva obligue a justificarla.
PALETA = {
    "#0b1626": "fondo",
    "#08111e": "fondo hundido",
    "#111f33": "superficie",
    "#18293f": "elevada / fondo de campo",
    "#1b3049": "pestaña activa",
    "#22354f": "línea",
    "#55708f": "línea de campo (3:1)",
    "#2b4a75": "relleno azul",
    "#5b8dd6": "azul",
    "#a9c6ee": "azul claro (categoría «manual» del editor)",
    "#da8c28": "ámbar — la marca",
    "#f0a94a": "ámbar claro",
    "#a96716": "ámbar hondo",
    "#14100a": "tinta: el ÚNICO texto válido sobre el ámbar",
    "#ece8e1": "texto",
    "#93a3b8": "secundario",
    "#6b7a8f": "secundario apagado",
    "#3dd68c": "éxito",
    "#ff8080": "error",
    "#f2c14e": "amarillo del semáforo de voces",
    "#2e2110": "fondo teñido de ámbar (chip elegido, etiqueta «generado»)",
    "#102e22": "fondo teñido de verde (etiqueta «listo»)",
    "#2e1b1b": "fondo del banner sin conexión",
    "#8f4a4a": "borde del banner sin conexión",
    "#ffb4b4": "texto del banner sin conexión",
    "#73353a": "el tramo que corta la animación de e1",
    "#1e2c42": "núcleo del orbe (centro)",
    "#070e18": "núcleo del orbe (borde)",
    "#f7f2e9": "crema del brillo del orbe",
    # el vídeo se mira sobre negro puro, y eso no es una decisión de paleta
    "#000000": "fondo de <video>",
}

ARCHIVOS = sorted(
    list(ESTATICOS.glob("*.html")) + list(ESTATICOS.glob("*.js"))
    + list((RAIZ / "tools" / "editor").glob("*.html"))
)


def _colores(texto: str) -> set[str]:
    fuera = set()
    for m in re.findall(r"#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b", texto):
        c = m.lower()
        if len(c) == 4:
            c = "#" + "".join(ch * 2 for ch in c[1:])
        fuera.add(c)
    return fuera


@pytest.mark.parametrize("archivo", ARCHIVOS, ids=lambda p: p.name)
def test_solo_colores_de_la_paleta(archivo):
    ajenos = _colores(archivo.read_text(encoding="utf-8")) - set(PALETA)
    assert not ajenos, (
        f"{archivo.name} usa colores que no son de la paleta: {sorted(ajenos)}. "
        "Si hace falta uno nuevo, añádelo a PALETA con su papel."
    )


def test_no_quedan_rastros_de_las_paletas_viejas():
    """Los acentos que definían las dos paletas anteriores."""
    muertos = {
        "#c93fb6": "magenta de crear*", "#7b3fe4": "violeta de crear*",
        "#ff4fd8": "rosa del editor de imágenes", "#d98be0": "enlace violeta",
        "#b28cff": "púrpura del orbe", "#3ce0c0": "turquesa del orbe",
        "#6fd6ce": "turquesa del editor", "#a259d9": "violeta del editor",
        "#14161a": "fondo viejo", "#0f0f14": "fondo viejo de crear*",
    }
    for archivo in ARCHIVOS:
        texto = archivo.read_text(encoding="utf-8").lower()
        for c, que in muertos.items():
            assert c not in texto, f"{archivo.name} conserva {c} ({que})"


def test_el_texto_sobre_el_ambar_nunca_es_blanco():
    """#FFFFFF sobre #DA8C28 da 2.71:1 — falla AA. Es el error más fácil de
    cometer con este color, porque el ámbar parece oscuro y no lo es."""
    for archivo in ARCHIVOS:
        texto = archivo.read_text(encoding="utf-8").lower()
        for linea in texto.splitlines():
            if "#da8c28" in linea or "#f0a94a" in linea or "var(--acc)" in linea:
                assert "color:#fff" not in linea.replace(" ", ""), \
                    f"{archivo.name}: texto blanco junto al ámbar → {linea.strip()[:90]}"


# ---------------------------------------------------------------------------
# el orbe

def _ajustes():
    js = (ESTATICOS / "orbe-gpu.v1.js").read_text(encoding="utf-8")
    return {n: json.loads(re.search(rf"^\s*{n}: (\[.*?\]),$", js, re.M).group(1))
            for n in ("idle", "pensando")}


def _hex(v, i):
    b = 40 + i * 4
    return "#%02x%02x%02x" % tuple(max(0, min(255, round(v[b + k] * 255))) for k in range(3))


def test_el_orbe_es_ambar_sobre_medianoche():
    """Los índices salen del WGSL: 1/2/3 son las tres capas del fluido y 6/7 la
    dispersión fría y cálida de la cáscara de vidrio."""
    a = _ajustes()
    p = a["pensando"]
    assert _hex(p, 1) == "#f0a94a", "la capa cálida dejó de ser ámbar"
    assert _hex(p, 3) == "#da8c28", "el cuerpo dejó de ser el ámbar de marca"
    assert _hex(p, 6) == "#5b8dd6", "la dispersión fría del vidrio debe ser azul"
    assert _hex(p, 7) == "#f0a94a", "y la cálida, ámbar"
    # el azul SÍ es de la familia; lo que no vuelve son el púrpura y el turquesa
    for nombre, v in a.items():
        for i in range(12):
            r, g, b = (v[40 + i * 4 + k] for k in range(3))
            assert not (b > 0.6 and r > 0.45 and g < r * 0.75), \
                f"{nombre}: el color {i} ({_hex(v, i)}) volvió a ser púrpura"
            # en el azul de la paleta el canal azul domina claramente al verde;
            # en un turquesa los dos van casi parejos
            assert not (r < 0.4 and g > 0.5 and g >= b * 0.9), \
                f"{nombre}: el color {i} ({_hex(v, i)}) volvió a ser turquesa"


def test_idle_sigue_siendo_el_mismo_orbe_con_menos_luz():
    """Reposo y trabajo tienen que leerse como el MISMO objeto: mismos matices,
    distinta energía. Si no, el cambio de estado parece un cambio de página."""
    a = _ajustes()
    for i in (1, 3):     # las dos capas cálidas
        claro = sum(a["pensando"][40 + i * 4 + k] for k in range(3))
        oscuro = sum(a["idle"][40 + i * 4 + k] for k in range(3))
        assert oscuro < claro, f"el color {i} de idle no está más apagado"
