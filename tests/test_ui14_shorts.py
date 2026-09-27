"""UI·14 — shorts con la carta de diseño (docs/DISENO.md).

Retoque en su sitio, como crear en UI·13: carta.css (Bricolage + Geist,
botones de tres niveles, foco), iconos de trazo en vez de emojis, la escala
de seis tamaños y un solo botón ámbar por vista. El comportamiento no cambia.
"""
import re
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
SHORTS = (RAIZ / "static" / "shorts.html").read_text(encoding="utf-8")
ICONOS = (RAIZ / "static" / "iconos.js").read_text(encoding="utf-8")


def _estilo():
    return SHORTS[SHORTS.index("<style>"):SHORTS.index("</style>")]


def _sin_titulos_de_pestana(texto):
    # document.title es texto plano: ahí la palomita es el estado, no un icono
    return re.sub(r'titulo\("[^"]*"\)', "", texto)


def test_carga_la_carta_y_los_iconos():
    assert SHORTS.index('href="/carta.css"') < SHORTS.index("<style>")
    inline = SHORTS.index("<script>\nconst $ =")
    assert SHORTS.index('<script src="/iconos.js"></script>') < inline
    assert "--acc:var(--c-ambar); --acc2:var(--c-ambar-claro);" in SHORTS


def test_titulos_en_bricolage_y_texto_en_geist():
    e = _estilo()
    assert "body { font: var(--t-sm)/1.5 var(--f-texto);" in e
    assert "h1 { font: 800 var(--t-titulo-lg)/1.1 var(--f-titulo); letter-spacing: -0.02em;" in e
    assert "section h2 { font: 700 var(--t-titulo-sm)/1.3 var(--f-titulo);" in e


def test_sin_tamanos_de_letra_fuera_de_la_escala():
    assert not re.findall(r"font-size:\s*[\d.]+(px|em|rem)", SHORTS)
    assert not re.search(r"font:\s*(\d+\s+)?[\d.]+px", SHORTS)
    for tam in re.findall(r"font-size:\s*([^;}]+)", SHORTS):
        assert tam.strip() in {"var(--t-xs)", "var(--t-sm)", "var(--t-md)", "inherit"}, tam


EMOJIS = "←▸✓⚠↗⬇✕✨🎬📹⬆"


def test_sin_emojis_como_iconos():
    texto = _sin_titulos_de_pestana(SHORTS)
    for e in EMOJIS:
        assert e not in texto, f"quedó {e} en shorts"


def test_los_iconos_que_usa_shorts_existen():
    nombres = set(re.findall(r'data-icono="([a-z]+)"', SHORTS)) | set(re.findall(r"icono\('([a-z]+)'", SHORTS))
    assert {"volver", "listo", "descargar", "externo", "aviso"} <= nombres
    for n in nombres:
        assert f"    {n}: '" in ICONOS, n


def test_botones_con_los_niveles_de_la_carta():
    # ya no hay estilo propio de <button> ni la clase .sec vieja
    assert not re.search(r"^\s*button\s*\{", _estilo(), re.M)
    assert 'className = "sec"' not in SHORTS and 'class="sec"' not in SHORTS
    for id_ in ("sub-btn", "sub-cancelar", "btn-cotizar"):
        assert re.search(rf'<button id="{id_}" class="btn btn-sec"', SHORTS), id_


def test_un_solo_principal_por_vista():
    """Sin proyecto: importar. Con proyecto: analizar hasta que hay
    candidatos; entonces renderizar, y re-analizar baja a secundario."""
    marcado = SHORTS[SHORTS.index("<main>"):SHORTS.index("</main>")]
    assert marcado.count("btn-pri") == 2
    assert '<button id="btn-analizar" class="btn btn-pri"' in marcado
    assert '<button id="btn-render" class="btn btn-pri"' in marcado
    assert '<button id="btn-importar" class="btn btn-sec"' in marcado
    assert 'b.className = etiqueta === "Analizar" ? "btn btn-pri" : "btn btn-sec";' in SHORTS
    elegir = SHORTS[SHORTS.index("async function elegirProyecto()"):SHORTS.index("/* ---------- Subir")]
    assert '$("btn-importar").className = "btn btn-pri";' in elegir


def test_los_botones_que_cobran_siguen_igual():
    assert "`Importar ✦ ${COTIZA.creditos}`" in SHORTS
    assert "`${etiqueta} ✦ ${COSTO.creditos_analizar}`" in SHORTS
    assert "`Renderizar ✦ ${n * (EST.creditos_por_short || 2)}`" in SHORTS


def test_elegir_no_es_ambar():
    e = _estilo()
    cuerpo = e[e.index(".cand:not(.off) {"):e.index("}", e.index(".cand:not(.off) {"))]
    assert "var(--txt)" in cuerpo and "--acc" not in cuerpo
    assert "border-color: var(--mut)" in e[e.index(".cand:hover {"):]


def test_enlaces_y_campos_de_la_carta():
    assert "a { color: var(--c-enlace); }" in SHORTS
    assert "#5b8dd6" not in SHORTS and "#2b4a75" not in SHORTS
    e = _estilo()
    campos = e[e.index("input:not([type=checkbox]), select {"):]
    campos = campos[:campos.index("}")]
    for regla in ("var(--elev)", "var(--campo)", "var(--r-medio)", "min-height: 44px"):
        assert regla in campos, regla
    assert "border-radius: var(--r-grande)" in e[e.index("section {"):]


def test_lo_que_se_toca_mide_44():
    e = _estilo()
    for regla in (".volver {", ".proyectos a {", ".cand .marca {", ".salida a {"):
        assert "min-height: 44px" in e[e.index(regla):e.index("}", e.index(regla))], regla


def test_sin_filtro_sepia_ni_foco_propio():
    assert "sepia(" not in SHORTS
    # el foco es el de la carta (ámbar claro), no un azul local
    assert ":focus-visible" not in _estilo()


def test_en_celular_nada_queda_bajo_la_pildora():
    m = re.search(r"@media \(max-width: 600px\) \{ body \{ padding: (\d+)px", SHORTS)
    assert m and int(m.group(1)) >= 52 + 16


def test_hidden_sigue_escondiendo_los_botones():
    """.btn de carta.css pone display:inline-flex, que le gana al atributo
    hidden: sin esto, Importar salía como un botón ámbar vacío."""
    assert "[hidden] { display: none !important; }" in _estilo()
