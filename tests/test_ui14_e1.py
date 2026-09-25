"""UI·14 — editar metraje (e1) con la carta de diseño (docs/DISENO.md).

Subir metraje y el panel de los dos caminos: carta.css (Bricolage + Geist,
botones de tres niveles, foco), iconos de trazo en vez de emojis, la escala de
seis tamaños y un solo botón ámbar: Subir mientras no hay metraje y la acción
del Editor IA (Proponer ✦ N o Editar) cuando ya lo hay (dueño, 25-sep). Las
tarjetas de camino se marcan en gris al pasar encima: el ámbar solo dice
«haz algo».
"""
import re
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
E1 = (RAIZ / "static" / "e1.html").read_text(encoding="utf-8")
ICONOS = (RAIZ / "static" / "iconos.js").read_text(encoding="utf-8")


def _estilo():
    return E1[E1.index("<style>"):E1.index("</style>")]


def _regla(selector):
    e = _estilo()
    i = e.index(selector)
    return e[i:e.index("}", i)]


def test_carga_la_carta_y_los_iconos():
    assert E1.index('href="/carta.css"') < E1.index("<style>")
    # iconos.js antes del script principal de la página
    assert E1.index('<script src="/iconos.js"></script>') < E1.index("<script>\n")
    assert "--acc:var(--c-ambar); --acc2:var(--c-ambar-claro);" in E1


def test_titulos_en_bricolage_y_texto_en_geist():
    e = _estilo()
    assert "font: var(--t-sm)/1.5 var(--f-texto);" in _regla("body {")
    assert "h1 { font: 800 var(--t-titulo-lg)/1.1 var(--f-titulo); letter-spacing: -0.02em;" in e
    assert "font: 700 var(--t-titulo-sm)/1.3 var(--f-titulo);" in _regla("section h2 {")
    assert "system-ui" not in e.replace("var(--f-texto)", "")


def test_sin_tamanos_de_letra_fuera_de_la_escala():
    assert not re.findall(r"font-size:\s*[\d.]+px", E1)
    assert not re.search(r"font:\s*(\d+ )?[\d.]+px", E1)
    for t in re.findall(r"var\(--t-([a-z-]+)\)", E1):
        assert t in {"xs", "sm", "md", "titulo-sm", "titulo-md", "titulo-lg"}, t


EMOJIS = "🎬✂🎛❌⏳✅✕🔄📡"


def test_sin_emojis_como_iconos():
    for e in EMOJIS:
        assert e not in E1, f"quedó {e} en e1"
    assert "sepia(" not in E1


def test_los_iconos_que_usa_e1_existen():
    nombres = set(re.findall(r'data-icono="([a-z]+)"', E1)) | set(re.findall(r'iconoEstado\("([a-z]+)"', E1))
    assert {"volver", "subir", "video", "shorts", "cortar", "aviso"} <= nombres
    for n in nombres:
        assert f"    {n}: '" in ICONOS, n


def test_sin_metraje_el_principal_es_subir():
    assert '<button id="sub-btn" class="btn btn-pri">Subir</button>' in E1
    assert '<button id="sub-cancelar" hidden class="btn btn-sec">Cancelar</button>' in E1
    # sin botones con color propio en línea
    assert "<button" not in E1.split('id="sub-cancelar"')[1].split("</main>")[0]
    assert 'style="' not in E1[E1.index("<body>"):E1.index("</main>")]


def test_elegir_y_pasar_encima_no_es_ambar():
    assert "border-color: var(--mut);" in _regla(".tarjeta:hover")
    # el ámbar de la página es solo la barra de subida, como en crear y shorts
    resto = _estilo().split(":root")[1].split("}", 1)[1]
    assert resto.count("--acc") == 1 and "background: var(--acc)" in _regla("#sub-avance {")


def test_enlaces_campos_y_tarjetas_de_la_carta():
    assert "a { color: var(--c-enlace); }" in E1
    campo = _regla("#sub-proyecto {")
    assert "border: 1px solid var(--campo)" in campo and "background: var(--elev)" in campo
    assert "border-radius: var(--r-medio)" in campo
    tarjeta = _regla("section {")
    assert "background: var(--card)" in tarjeta and "border-radius: var(--r-grande)" in tarjeta


def test_lo_que_se_toca_mide_44():
    assert "min-height: 44px" in _regla(".volver {")
    assert "min-height: 44px" in _regla("#sub-proyecto {")
    carta = (RAIZ / "static" / "carta.css").read_text(encoding="utf-8")
    assert "min-height: 44px" in carta[carta.index("input[type=file]::file-selector-button {"):]


def test_los_iconos_de_los_titulos_van_en_gris():
    assert "section h2 .ico { color: var(--mut); }" in _estilo()
    assert "#corte-estado .ico.mal { color: var(--c-error); }" in _estilo()


def test_el_estado_sigue_entrando_como_texto():
    """El icono se añade con un SVG constante; lo que llega del servidor sigue
    por textContent."""
    assert 'insertAdjacentHTML("afterbegin", icono(nombre, clase))' in E1
    assert "corte-estado\").innerHTML" not in E1
    assert "`Proponer ✦ ${c.creditos}`" in E1


# ---------------------------------------------------------------------------
# quién es el principal, corriendo principal() en node

NODO = r"""
const nodos = {};
const ui = id => nodos[id] || (nodos[id] = {classList: {c: new Set(["btn", "btn-pri"]),
  toggle(n, v) { v ? this.c.add(n) : this.c.delete(n); }, has(n) { return this.c.has(n); }}});
nodos["editor-nota"] = {classList: {c: new Set(["ir"]), toggle(n, v) { v ? this.c.add(n) : this.c.delete(n); }}};
let CON_FUENTE = false, EDITOR = {modo: "off"};
__CODIGO__
const out = {};
const foto = () => ({subir: [...ui("sub-btn").classList.c].sort(), nota: [...ui("editor-nota").classList.c].sort()});
principal(); out.sin = foto();
CON_FUENTE = true; EDITOR.modo = "cobrar"; principal(); out.cobrar = foto();
EDITOR.modo = "corriendo"; principal(); out.corriendo = foto();
EDITOR.modo = "listo"; principal(); out.listo = foto();
console.log(JSON.stringify(out));
"""


def test_con_metraje_el_principal_es_el_editor(tmp_path):
    import json, shutil, subprocess
    import pytest
    node = shutil.which("node")
    if not node:
        pytest.skip("node no está instalado")
    i = E1.index("function principal()")
    codigo = E1[i:E1.index("\n}\n", i) + 3]
    f = tmp_path / "p.js"
    f.write_text(NODO.replace("__CODIGO__", codigo), encoding="utf-8")
    r = subprocess.run([node, str(f)], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    o = json.loads(r.stdout)
    assert o["sin"] == {"subir": ["btn", "btn-pri"], "nota": ["ir"]}
    assert o["cobrar"] == {"subir": ["btn", "btn-sec"], "nota": ["btn", "btn-pri", "ir"]}
    # trabajando no hay nada que apretar: ningún ámbar
    assert o["corriendo"] == {"subir": ["btn", "btn-sec"], "nota": ["ir"]}
    assert o["listo"]["nota"] == ["btn", "btn-pri", "ir"]
