"""UI·16 — imágenes manda sus avisos sueltos al cuadro de trabajos.js
(window.avisos).

Se mueven: el fallo al abrir la imagen que llega por enlace (?img=, antes en
#gerr, que es el error del formulario) y el fallo al traer /api/estilos (antes
callaba). Se queda en #gerr: la validación del formulario y el fallo de
«seguir editando», que está junto a su botón.
"""
import re
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
PAGINA = (RAIZ / "static" / "imagenes.html").read_text(encoding="utf-8")
JS = PAGINA[PAGINA.rindex("<script>\n"):PAGINA.rindex("</script>")]


def _bloque(firma):
    i = JS.index(firma)
    return JS[i:JS.index("\n}", i) + 2]


def test_abrir_desde_enlace_avisa_en_el_cuadro_y_no_en_el_formulario():
    a = _bloque("async function abrirDesdeEnlace()")
    assert "$('#gerr')" not in a
    assert ("window.avisos?.mostrar(`No pude abrir tu imagen: ${e.message}`,\n"
            "                           {tipo: 'mal', clave: 'imagenes-abrir'});") in a
    # el título del hueco vuelve a su texto pase lo que pase
    assert "finally {\n    $('#vacio-titulo').textContent = 'Sube la imagen o el boceto que quieres editar';" in a


def test_sin_lista_de_estilos_se_avisa_sin_romper():
    i = JS.index("fetch('/api/estilos')")
    estilos = JS[i:JS.index("\n});", i) + 4]
    assert "if (!r.ok) throw new Error(r.status);" in estilos
    assert re.search(r"\}\)\.catch\(\(\) => \{\n  window\.avisos\?\.mostrar\('No pudimos cargar los estilos\. "
                     r"Recarga la página para elegir otro\.',\n\s+\{tipo: 'mal', clave: 'imagenes-estilos'\}\);\n\}\);",
                     estilos)


def test_seguir_y_la_validacion_se_quedan_en_gerr():
    assert 'id="gerr"' in PAGINA
    s = _bloque("$('#seguir').onclick = async () => {")
    assert "$('#gerr').textContent = `No pude abrir tu imagen para editarla: ${e.message}`;" in s
    assert "$('#gerr').textContent = 'Elige una imagen JPG, PNG o WebP.'; return;" in JS
    assert "if (!prompt) { $('#gerr').textContent = TEXTOS[modo].vacio;" in JS


def test_avisos_con_encadenamiento_opcional():
    assert "window.avisos.mostrar" not in PAGINA
    assert '<script src="/trabajos.js"></script>' in PAGINA


def test_el_aviso_de_abrir_se_quita_al_cargar_una_imagen():
    # si el enlace falló y luego el usuario sube su imagen, el aviso 'mal' sobra
    c = _bloque("function cargarImagen(f, nombre = null)")
    assert "window.avisos?.quitar('imagenes-abrir');" in c
    assert c.index("$('#gerr').textContent = '';") < c.index("window.avisos?.quitar('imagenes-abrir');")
