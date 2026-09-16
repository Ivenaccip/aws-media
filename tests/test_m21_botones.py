"""M21 — botones de una palabra: «<Verbo> ✦ <N>».

Antes cada pantalla escribía el precio a su manera: «20 créditos — escribir el
guion →», «Analizar — 3 créditos», «Renderizar 2 shorts → 4 créditos». Tres
gramáticas distintas para el mismo hecho. Ahora hay una sola, y este test es el
guardián: el botón dice QUÉ hace y CUÁNTO cuesta, y nada más.

La regla del símbolo: ✦ significa «créditos». Donde no hay créditos (dev local,
que cotiza en dólares) el botón lleva solo el verbo y el precio va a la nota.
"""
import re
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parent.parent
ESTATICOS = RAIZ / "static"

ESTRELLA = "✦"          # ✦ BLACK FOUR POINTED STAR

# Los verbos que el producto usa hoy. Añadir uno obliga a decidirlo a propósito
# en vez de que se cuele un «Generar ahora las imágenes» cualquier martes.
VERBOS = {
    "Escribir", "Producir", "Reintentar", "Cambiar", "Generar", "Aplicar",
    "Analizar", "Re-analizar", "Importar", "Renderizar", "Proponer", "Animar",
    # M23: la herramienta unificada distingue el modo en el botón mismo;
    # «Aplicar» servía cuando cada modo tenía su página, aquí no dice cuál
    "Transformar",
}

# Cada botón que gasta créditos, con el verbo que le toca.
COBRAN = [
    # M23 · V: el botón de crear dice el precio de la película entera
    ("static/crear.html", "Generar"),
    ("static/crear.html", "Cambiar"),
    ("static/crear.html", "Producir"),
    ("static/crear.html", "Reintentar"),
    ("static/crear-imagenes.html", "Generar"),
    ("static/editor-imagenes.html", "Aplicar"),
    ("static/imagenes.html", "Generar"),
    ("static/imagenes.html", "Cambiar"),
    ("static/imagenes.html", "Transformar"),
    ("static/estilos.html", "Analizar"),
    ("static/shorts.html", "Importar"),
    ("static/shorts.html", "Renderizar"),
    ("static/e1.html", "Proponer"),
    ("tools/editor/index.html", "Generar"),
    ("tools/editor/index.html", "Animar"),
]

ARCHIVOS = sorted(
    list(ESTATICOS.glob("*.html")) + list(ESTATICOS.glob("*.js"))
    + list((RAIZ / "tools" / "editor").glob("*.html"))
)

# `Escribir ✦ ${prep}` / `Proponer ✦ ${c.creditos}` / `${etiqueta} ✦ ${n}`
FORMA = re.compile(
    r"^(?P<verbo>[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:-[a-záéíóúñ]+)?|\$\{etiqueta\})"
    r" " + ESTRELLA + r" (?:\$\{[^{}]+\}|\d+)$"    # \d+: los ejemplos de los comentarios
)


@pytest.mark.parametrize("rel,verbo", COBRAN, ids=lambda v: str(v).split("/")[-1])
def test_cada_boton_que_cobra_dice_verbo_y_precio(rel, verbo):
    html = (RAIZ / rel).read_text(encoding="utf-8")
    assert f"`{verbo} {ESTRELLA} " + "${" in html, (
        f"{rel}: no encuentro un botón «{verbo} {ESTRELLA} <precio>»"
    )


@pytest.mark.parametrize("archivo", ARCHIVOS, ids=lambda p: p.name)
def test_toda_etiqueta_con_estrella_respeta_la_forma(archivo):
    """Un verbo, la estrella, el número. Nada de «Renderizar 2 shorts ✦ 4»."""
    texto = archivo.read_text(encoding="utf-8")
    for plantilla in re.findall(r"`([^`\n]*" + ESTRELLA + r"[^`\n]*)`", texto):
        if plantilla.startswith("${d.saldo}"):
            continue                       # el saldo de la cabecera, más abajo
        m = FORMA.match(plantilla)
        assert m, f"{archivo.name}: «{plantilla}» no es «Verbo {ESTRELLA} ${{precio}}»"
        verbo = m.group("verbo")
        if not verbo.startswith("${"):
            assert verbo in VERBOS, (
                f"{archivo.name}: «{verbo}» no está en VERBOS. Si el producto "
                "necesita un verbo nuevo, añádelo ahí a propósito."
            )


@pytest.mark.parametrize("archivo", ARCHIVOS, ids=lambda p: p.name)
def test_ningun_boton_dice_la_palabra_creditos(archivo):
    """La estrella ES la unidad: repetir «créditos» en el botón la contradice."""
    texto = archivo.read_text(encoding="utf-8")
    for linea in texto.splitlines():
        if ".textContent" not in linea or "créditos" not in linea:
            continue
        # las notas de ayuda SÍ la escriben entera; los botones no
        assert not re.search(r"#(enviar|producir|reintentar|pmodbtn|generar|editar"
                             r"|btn-analizar|btn-importar|btn-render)", linea), \
            f"{archivo.name}: un botón sigue diciendo «créditos» → {linea.strip()[:90]}"


@pytest.mark.parametrize("archivo", ARCHIVOS, ids=lambda p: p.name)
def test_la_estrella_es_siempre_la_misma(archivo):
    """♦ (U+2666) y ◆ (U+25C6) se parecen a ✦ de un vistazo, y ♦ además se
    dibuja como emoji rojo en iOS/Android. ✨ sí vale como icono de título —
    lo que no vale es que haga de moneda."""
    for linea in archivo.read_text(encoding="utf-8").splitlines():
        if ".textContent" not in linea and "<button" not in linea:
            continue
        for impostor, nombre in [("♦", "U+2666 ♦ (sale emoji en iOS/Android)"),
                                 ("◆", "U+25C6 ◆"),
                                 ("✧", "U+2727 ✧"),
                                 ("✨", "U+2728 ✨ (emoji)")]:
            assert impostor not in linea, (
                f"{archivo.name}: un botón usa {nombre} en vez de ✦ → {linea.strip()[:80]}")


def test_el_saldo_de_la_cabecera_termina_en_la_estrella():
    js = (ESTATICOS / "monedero.js").read_text(encoding="utf-8")
    assert "`${d.saldo} créditos " + ESTRELLA + "`" in js, \
        "el saldo de la cabecera perdió su ✦"


# ---------------------------------------------------------------------------
# lo que el botón soltó tiene que haber aterrizado en algún sitio

def test_el_aviso_de_que_reintentar_vuelve_a_cobrar_no_se_perdio():
    """Acortar el botón a «Reintentar ✦ 40» no puede costarle al usuario el
    aviso de que ese dinero se cobra OTRA vez."""
    html = (ESTATICOS / "crear.html").read_text(encoding="utf-8")
    assert "se cobran de nuevo" in html
    assert "#edevol" in html[html.index("se cobran de nuevo") - 400:
                             html.index("se cobran de nuevo")], \
        "el aviso ya no cuelga de la nota de la pantalla de error"


def test_producir_sigue_diciendo_cuanto_queda_y_cuanto_tarda():
    html = (ESTATICOS / "crear.html").read_text(encoding="utf-8")
    assert "#prodnota" in html
    assert "Te quedan ${saldoProd} créditos" in html
    assert "~${minutosProd} min" in html


def test_el_saldo_no_se_cuenta_dos_veces_seguidas():
    """«Te quedan 33 créditos» seguido de «Te faltan 12 (saldo: 45)» se lee
    como dos saldos distintos. Cuando no alcanza, manda el aviso."""
    html = (ESTATICOS / "crear.html").read_text(encoding="utf-8")
    cuerpo = html[html.index("function pintaProducir()"):]
    cuerpo = cuerpo[:cuerpo.index("\n}")]
    assert "faltaProducir > 0 ? `~${minutosProd} min.`" in cuerpo, \
        "la nota vuelve a repetir el saldo cuando el aviso ya lo dice"


def test_shorts_sigue_diciendo_cuantos_van_en_el_precio():
    html = (ESTATICOS / "shorts.html").read_text(encoding="utf-8")
    assert "marcado${n === 1" in html, "se perdió el recuento de shorts marcados"
    assert "Marca al menos un candidato." in html


def test_el_autoguardado_no_cuelga_del_aviso_de_saldo():
    """Regresión: #autosave vivía DENTRO de #saldoaviso, y pintaProducir le
    ponía textContent al padre — el nodo desaparecía del DOM y marcaCambio()
    reventaba con TypeError antes de programar el autoguardado."""
    html = (ESTATICOS / "crear.html").read_text(encoding="utf-8")
    fila = re.search(r'<p[^>]*id="saldoaviso".*?</p>', html, re.S)
    assert fila is None or "autosave" not in fila.group(0), \
        "#autosave volvió a colgar de #saldoaviso"
    assert re.search(r'<p[^>]*id="autosave"', html), "#autosave perdió su propia caja"
