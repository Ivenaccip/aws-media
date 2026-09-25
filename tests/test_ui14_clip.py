"""UI·14 — el clip de 8 segundos con la carta de diseño (docs/DISENO.md).

Retoque en su sitio, como crear en UI·13: carta.css (Bricolage + Geist,
botones de tres niveles, foco), iconos de trazo en vez de emojis, la escala
de seis tamaños y un solo botón ámbar (Generar ✦ N). Cambia el aspecto, no
el comportamiento.
"""
import re
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
CLIP = (RAIZ / "static" / "clip.html").read_text(encoding="utf-8")
ICONOS = (RAIZ / "static" / "iconos.js").read_text(encoding="utf-8")


def _estilo():
    return CLIP[CLIP.index("<style>"):CLIP.index("</style>")]


def _regla(selector):
    e = _estilo()
    i = e.index(selector)
    return e[i:e.index("}", i)]


def test_carga_la_carta_y_los_iconos():
    assert CLIP.index('href="/carta.css"') < CLIP.index("<style>")
    # iconos.js antes del script principal, que llama a icono()
    assert CLIP.index('<script src="/iconos.js"></script>') < CLIP.index("<script>\n")
    assert "--acc:var(--c-ambar); --acc2:var(--c-ambar-claro);" in CLIP


def test_titulos_en_bricolage_y_texto_en_geist():
    e = _estilo()
    assert "body { font: var(--t-sm)/1.5 var(--f-texto);" in e
    assert "h1 { font: 800 var(--t-titulo-lg)/1.1 var(--f-titulo); letter-spacing: -0.02em;" in e
    assert "section h2 { font: 700 var(--t-titulo-sm)/1.3 var(--f-titulo);" in e


def test_sin_tamanos_de_letra_fuera_de_la_escala():
    assert not re.findall(r"font-size:\s*[\d.]+(px|em|rem)", CLIP)
    assert not re.search(r"font:\s*(\d+\s+)?[\d.]+px", CLIP)
    for t in re.findall(r"font-size:\s*([^;]+);", CLIP):
        assert t.strip() in {"var(--t-xs)", "var(--t-sm)", "var(--t-md)",
                             "var(--t-titulo-sm)", "var(--t-titulo-md)", "var(--t-titulo-lg)"}, t


EMOJIS = "✨📐⏱🧑🎙📝📚⚡🖼🎬✅⬇✂🔁▶📡🟢🟡🔴✕🔄⚖●✓×📷➕←"


def test_sin_emojis_como_iconos():
    for e in EMOJIS:
        assert e not in CLIP, f"quedó {e} en clip"
    assert "sepia(" not in CLIP


def test_los_iconos_que_usa_clip_existen():
    nombres = set(re.findall(r'data-icono="([a-z]+)"', CLIP)) | set(re.findall(r"icono\('([a-z]+)'", CLIP))
    assert {"volver", "cerrar", "mas"} <= nombres
    for n in nombres:
        assert f"    {n}: '" in ICONOS, n


def test_un_solo_principal_y_es_generar():
    assert CLIP.count("btn-pri") == 1
    assert '<button id="btn-generar" class="btn btn-pri">Generar</button>' in CLIP
    # el precio sigue diciéndose «Verbo ✦ N» (M21)
    assert "`Generar ✦ ${cr}`" in CLIP


def test_sin_el_azul_viejo_de_los_botones():
    assert "#2b4a75" not in CLIP and "#5b8dd6" not in CLIP


def test_elegir_no_es_ambar():
    """Carta §3: el formato elegido se marca en blanco; el hover, en gris."""
    elegido = _regla('.formatos button[aria-pressed="true"] {')
    assert "border-color: var(--txt)" in elegido and "background: var(--elev)" in elegido
    assert "--acc" not in elegido
    assert "border-color: var(--mut)" in _regla(".formatos button:hover {")
    assert "--acc" not in _estilo().split("}", 1)[1]   # fuera del :root, ni rastro de ámbar


def test_quitar_foto_es_un_icono_con_nombre():
    assert 'aria-label="Quitar foto">${icono(\'cerrar\')}</button>' in CLIP


def test_enlaces_y_campos_con_los_tokens():
    assert "a { color: var(--c-enlace); }" in CLIP
    t = _regla("textarea {")
    assert "border: 1px solid var(--campo)" in t and "var(--r-medio)" in t


def test_lo_que_se_toca_mide_44():
    assert "width: 44px; height: 44px;" in _regla(".foto .quitar {")
    assert "min-height: 44px" in _regla(".formatos button {")
    assert "min-height: 44px" in _regla(".volver {")


def test_los_iconos_de_los_titulos_van_en_gris():
    assert "  h2 .ico { color: var(--mut); }" in _estilo()


def test_no_queda_debajo_de_la_pildora():
    """UI·12: la píldora del monedero acaba a 52 px."""
    m = re.search(r"body \{[^}]*padding: (\d+)px", _estilo())
    assert m and int(m.group(1)) >= 52 + 12
