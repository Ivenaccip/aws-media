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

# Los translúcidos (rgba(), #RGBA, #RRGGBBAA) que ya existían cuando el guardián
# aprendió a verlos (UI·1). Ninguno sale de la paleta tal cual: mezclan su tono
# con lo que tengan debajo. Cada uno dice DÓNDE vive y POR QUÉ se tolera; añadir
# otro obliga a decidirlo a propósito, igual que en PALETA. La forma canónica es
# «rgba(r,g,b,a)» (ver _colores), la escriba el archivo como la escriba.
TRANSLUCIDOS = {
    # negro a medias: sombras y velos. El negro puro solo está en PALETA para el
    # fondo de <video>; como sombra o velo va translúcido, nunca opaco.
    "rgba(0,0,0,0.35)": "orbe.js — sombra de la píldora del orbe",
    "rgba(0,0,0,0.4)": "monedero.js (sombra de la píldora del saldo) y auth.js "
                       "(sombra del aviso de acceso)",
    "rgba(0,0,0,0.5)": "monedero.js (sombra del panel de recarga) e index.html "
                       "(sombra del tooltip de los botones)",
    "rgba(0,0,0,0.533)": "index.html — sombra del desplegable del inicio, escrita "
                         "#0008 (0x88/255)",
    "rgba(0,0,0,0.55)": "guardrail.js — velo detrás del popup del guardarraíl",
    "rgba(0,0,0,0.65)": "tools/editor/index.html — velo de los modales "
                        "(#ayudaModal, #g1modal, #b3modal, #b1modal)",
    # medianoche hundida (#040911): velos que oscurecen sin volverse gris
    "rgba(4,9,17,0.55)": "trabajos.js — sombra de la bandeja de trabajos",
    "rgba(4,9,17,0.72)": "index.html (#dlg-blotato) y agenda.html (#agDlg) — "
                         "::backdrop de los diálogos; web/src/ui/Dialogo.tsx "
                         "(VELO) — el mismo velo en la UI nueva",
    # restos del fondo viejo (#12141a/#14161a, ver test_no_quedan_rastros_…) que
    # sobrevivieron como translúcidos. Se toleran para no tocar el HTML en UI·1;
    # la migración a web/ los cambia por tokens de la paleta.
    "rgba(18,20,26,0.94)": "orbe.js y monedero.js — fondo de las píldoras "
                           "flotantes (orbe y saldo)",
    "rgba(18,20,26,0.97)": "monedero.js — fondo del panel de recarga",
    "rgba(20,22,26,0.72)": "index.html — botón de archivar sobre la miniatura "
                           "de un proyecto (.proy .arch)",
    "rgba(20,22,26,0.95)": "index.html — el mismo botón con el ratón encima",
    "rgba(13,15,19,0.7)": "tools/editor/index.html — casilla sobre la miniatura "
                          "al importar imágenes (.imptile .chk)",
    # colores de la paleta a opacidad 0: el final de un degradado radial que se
    # desvanece. Con alfa 0 no pintan nada; el tono solo evita el gris sucio
    # que deja «transparent» al interpolar.
    "rgba(240,169,74,0)": "orbe.js — núcleo CSS del orbe (#f0a94a que se desvanece)",
    "rgba(91,141,214,0)": "orbe.js — núcleo CSS del orbe (#5b8dd6 que se desvanece)",
}


def _web(*patrones: str) -> list[Path]:
    """Los fuentes de web/ (Fase 3 de docs/PLAN-UI.md) que casan con los patrones.

    Si web/ todavía no existe no hay nada que vigilar: lista vacía, no error.
    node_modules/ (de terceros), dist/ (compilado de estos mismos fuentes) y lo
    que dejan las pruebas de navegador (playwright-report/, test-results/) no
    se miran."""
    web = RAIZ / "web"
    if not web.is_dir():
        return []
    return [p for patron in patrones for p in web.glob(patron)
            if not {"node_modules", "dist", "playwright-report", "test-results"} & set(p.relative_to(web).parts)]


ARCHIVOS = sorted(
    list(ESTATICOS.glob("*.html")) + list(ESTATICOS.glob("*.js"))
    # UI·10: la carta de diseño hecha CSS también se vigila
    + list(ESTATICOS.glob("*.css"))
    + list((RAIZ / "tools" / "editor").glob("*.html"))
    # UI·1: y las pantallas nuevas, antes de que exista la primera
    + _web("**/*.html", "src/**/*.ts", "src/**/*.tsx", "src/**/*.css")
)


def _id(p: Path) -> str:
    """El nombre, como siempre; en web/ la ruta, porque allí casi todo es index.html."""
    web = RAIZ / "web"
    return str(p.relative_to(RAIZ)) if web in p.parents else p.name


_HEX = re.compile(r"#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b")
# rgb()/rgba() con números: «rgba(4, 9, 17, .72)», «rgb(0 0 0 / 50%)». Con
# variables dentro («rgb(desde[i], hacia[i], k)») no es un color que se pueda
# juzgar leyendo, y no casa.
_NUM = r"\s*(?:\d+(?:\.\d*)?|\.\d+)%?\s*"
_RGB = re.compile(r"\brgba?\((" + _NUM + r"(?:[,\s]" + _NUM + r"){2}(?:[,/]" + _NUM + r")?)\)",
                  re.I)


def _canonico(r: float, g: float, b: float, a: float) -> str:
    """Opaco → «#rrggbb», para cotejarlo con PALETA. Translúcido → «rgba(r,g,b,a)»,
    con el alfa a tres cifras, para cotejarlo con TRANSLUCIDOS."""
    r, g, b = (max(0, min(255, round(x))) for x in (r, g, b))
    if a >= 1:
        return "#%02x%02x%02x" % (r, g, b)
    return f"rgba({r},{g},{b},{float(f'{a:.3g}'):g})"


def _colores(texto: str) -> set[str]:
    fuera = set()
    for m in _HEX.findall(texto):
        c = m.lower()[1:]
        if len(c) in (3, 4):
            c = "".join(ch * 2 for ch in c)
        r, g, b = (int(c[i:i + 2], 16) for i in (0, 2, 4))
        a = int(c[6:8], 16) / 255 if len(c) == 8 else 1.0
        fuera.add(_canonico(r, g, b, a))
    for m in _RGB.finditer(texto):
        partes = [x for x in re.split(r"[\s,/]+", m.group(1).strip()) if x]
        canales = [float(x[:-1]) * 2.55 if x.endswith("%") else float(x) for x in partes[:3]]
        a = 1.0
        if len(partes) == 4:
            a = float(partes[3][:-1]) / 100 if partes[3].endswith("%") else float(partes[3])
        fuera.add(_canonico(*canales, a))
    return fuera


@pytest.mark.parametrize("texto, esperado", [
    ("color: #DA8C28;", "#da8c28"),
    ("color:#fff", "#ffffff"),
    ("box-shadow: 0 10px 28px #0008;", "rgba(0,0,0,0.533)"),
    ("background: #da8c2880;", "rgba(218,140,40,0.502)"),
    ("background: #da8c28ff;", "#da8c28"),
    ("background: rgba(4, 9, 17, .72);", "rgba(4,9,17,0.72)"),
    ("background:rgba(0,0,0,0.5)", "rgba(0,0,0,0.5)"),
    ("color: rgb(218, 140, 40);", "#da8c28"),
    ("color: RGB(218,140,40)", "#da8c28"),
    ("color: rgba(218, 140, 40, 1);", "#da8c28"),
    ("color: rgb(0 0 0 / 50%);", "rgba(0,0,0,0.5)"),
    ("color: rgb(100% 0% 0%);", "#ff0000"),
])
def test_el_guardian_reconoce_cada_forma_de_escribir_un_color(texto, esperado):
    assert _colores(texto) == {esperado}


@pytest.mark.parametrize("texto", [
    "rgb(desde[i], hacia[i], k)",      # orbe-gpu.v1.js: calculado, no escrito
    "rgb(aLineal(a), 0, 0)",
    "href=\"#b3agendar\"",             # un id que empieza por hex no es un color
    "#abcde",                          # cinco cifras no es ninguna forma
    "background: transparent;",
])
def test_el_guardian_no_ve_colores_donde_no_los_hay(texto):
    assert _colores(texto) == set()


@pytest.mark.parametrize("archivo", ARCHIVOS, ids=_id)
def test_solo_colores_de_la_paleta(archivo):
    ajenos = _colores(archivo.read_text(encoding="utf-8")) - set(PALETA) - set(TRANSLUCIDOS)
    assert not ajenos, (
        f"{_id(archivo)} usa colores que no son de la paleta: {sorted(ajenos)}. "
        "Si hace falta uno nuevo, añádelo a PALETA con su papel (o, si es "
        "translúcido, a TRANSLUCIDOS con dónde vive y por qué)."
    )


def test_la_lista_de_translucidos_no_guarda_colores_muertos():
    """Una entrada que ya no usa nadie es un permiso en blanco para el siguiente
    que la escriba sin pensarlo. Si se borra el último uso, se borra la entrada."""
    vivos = set().union(*(_colores(a.read_text(encoding="utf-8")) for a in ARCHIVOS))
    sobran = set(TRANSLUCIDOS) - vivos
    assert not sobran, f"TRANSLUCIDOS permite colores que ya nadie usa: {sorted(sobran)}"


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
