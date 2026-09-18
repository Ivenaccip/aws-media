"""M25 · B — la entrada del inicio: dos botones y un desplegable.

Antes la caja tenía dos chips, «Investigación» y «Tengo una idea», que mezclaban
dos ejes distintos: qué te llevas y cómo se investiga. Ahora el botón de arriba
dice QUÉ (Imágenes o Videos) y el desplegable CUÁL de esas cosas, con su precio.

Lo que este archivo defiende:
  * que los precios del desplegable salgan de `tarifas.json` y no de la mano de
    nadie — un desplegable que promete 30 y cobra 35 es peor que no poner precio;
  * que el clip sea lo primero seleccionado: es lo más barato, o sea lo que
    menos daño hace a quien no abra el menú (decisión del dueño, M25 · B);
  * que las tres puertas de video sigan llevando a donde llevaban, con el `modo`
    correcto — «Creador de cuentos» es `investigacion` y «Crea tu historia» es
    `idea`, que en el código se llaman al revés de lo que suenan;
  * que el texto que ya escribió el usuario viaje a las tres pantallas destino:
    volver a pedírselo es hacerle escribir dos veces lo mismo.

Sin navegador: se lee el HTML, como el resto de los tests de interfaz."""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

RAIZ = Path(__file__).resolve().parent.parent
INICIO = (RAIZ / "static" / "index.html").read_text(encoding="utf-8")
CLIP = (RAIZ / "static" / "clip.html").read_text(encoding="utf-8")
IMAGENES = (RAIZ / "static" / "imagenes.html").read_text(encoding="utf-8")


def _tarifas() -> dict:
    return json.loads((RAIZ / "tools" / "tarifas.json").read_text(encoding="utf-8"))


def _opcion(rotulo: str) -> str:
    """El bloque `{ ... }` de una opción del desplegable, por su rótulo."""
    m = re.search(r"\{[^{}]*rotulo: '" + re.escape(rotulo) + r"'[^{}]*\}", INICIO)
    assert m, f"no encuentro la opción «{rotulo}» en el desplegable del inicio"
    return m.group(0)


# ---------------------------------------------------------------------------
# los precios no pueden mentir

def test_el_precio_del_clip_sale_de_tarifas_json():
    """Es el único de los tres que se sabe exacto de antemano."""
    assert f"cr: '{_tarifas()['clip']['video_8s']}'" in _opcion("Un video corto")


def test_las_historias_ensenan_el_rango_real_de_su_tabla():
    """No dependen de un clasificador sino de la duración que el usuario elige
    DESPUÉS, en crear.html: el rango es el de §video.por_duracion, de punta a
    punta. Prometer un número exacto aquí sería inventarlo."""
    por_duracion = _tarifas()["video"]["por_duracion"].values()
    rango = f"cr: '{min(por_duracion)}–{max(por_duracion)}'"
    assert rango in _opcion("Creador de cuentos")
    assert rango in _opcion("Crea tu historia")


def test_el_precio_de_las_imagenes_sale_de_tarifas_json():
    imagen = _tarifas()["video"]["imagen"]
    assert f"cr: '{imagen}'" in _opcion("Crear una imagen")
    assert f"cr: '{imagen}'" in _opcion("Editar una imagen")


# ---------------------------------------------------------------------------
# qué se ofrece y en qué orden

def test_arranca_en_el_clip():
    """Lo que esté seleccionado se lo lleva todo el que no abra el menú, así que
    arranca en lo más barato: equivocarse cuesta 30 y no 145."""
    assert "let familiaHub = 'videos', opcionHub = OPCIONES.videos[0];" in INICIO
    videos = INICIO[INICIO.index("videos: ["):INICIO.index("imagenes: [")]
    assert videos.index("Un video corto") < videos.index("Creador de cuentos")
    assert videos.index("Creador de cuentos") < videos.index("Crea tu historia")


def test_los_rotulos_son_los_que_eligio_el_dueno():
    for rotulo in ("Un video corto", "Creador de cuentos", "Crea tu historia"):
        assert f"rotulo: '{rotulo}'" in INICIO


def test_los_chips_viejos_ya_no_estan():
    """«Investigación» y «Tengo una idea» describían CÓMO se investiga, no qué
    te llevas — y dejaban a las imágenes sin puerta en el inicio."""
    assert "btn-inv" not in INICIO and "btn-idea" not in INICIO
    assert ">Investigación<" not in INICIO and ">Tengo una idea<" not in INICIO


def test_las_imagenes_por_fin_tienen_puerta():
    """Hasta ahora solo se llegaba por la lista del menú de la izquierda."""
    assert 'data-familia="imagenes"' in INICIO
    assert "destino: '/imagenes.html'" in _opcion("Crear una imagen")


# ---------------------------------------------------------------------------
# las tres puertas de video llevan a donde llevaban

def test_el_clip_va_a_su_pantalla():
    assert "destino: '/clip.html'" in _opcion("Un video corto")
    assert "modo:" not in _opcion("Un video corto")   # el clip no tiene modo


def test_las_etiquetas_internas_van_al_reves_de_lo_que_suenan():
    """`pipeline/flow.py`: la ficha que INVESTIGA se llama `investigacion` y la
    que usa el texto tal cual se llama `idea`. Cruzarlas mandaría a research el
    cuento ya escrito — y luego se lo reescribiría encima."""
    assert "modo: 'investigacion'" in _opcion("Creador de cuentos")
    assert "modo: 'idea'" in _opcion("Crea tu historia")
    assert "destino: '/crear.html'" in _opcion("Creador de cuentos")
    assert "destino: '/crear.html'" in _opcion("Crea tu historia")


# ---------------------------------------------------------------------------
# el texto viaja

def test_el_inicio_manda_el_texto_con_el_nombre_que_espera_cada_pantalla():
    """crear.html y clip.html leen `brief`; imagenes.html lee `prompt`."""
    assert "q.set(opcionHub.destino === '/imagenes.html' ? 'prompt' : 'brief', texto);" in INICIO


def test_el_clip_recoge_el_texto_que_ya_escribieron():
    assert 'new URLSearchParams(location.search).get("brief")' in CLIP
    assert '$("texto").value = CLBRIEF' in CLIP


def test_las_imagenes_recogen_el_texto_que_ya_escribieron():
    assert "q.get('prompt')" in IMAGENES
    assert "$('#prompt').value = texto" in IMAGENES


# ---------------------------------------------------------------------------
# el menú de la izquierda

def _menu() -> str:
    return INICIO[INICIO.index('<nav aria-label="Secciones">'):INICIO.index("</nav>")]


def test_lo_que_ya_esta_en_la_caja_no_se_repite_en_el_menu():
    """«Crear imágenes» y «Crear contenido» salieron del menú: su puerta es la
    caja. Tenerlos en los dos sitios repetía la misma entrada."""
    menu = _menu()
    assert 'href="/imagenes.html"' not in menu
    assert 'href="/crear.html"' not in menu
    # y el menú se queda con lo que empieza con algo tuyo, más lo de publicar
    for queda in ("/e1.html", "/shorts.html", "/estilos.html", "/agenda.html"):
        assert f'href="{queda}"' in menu


def test_las_tres_de_blotato_se_apagan_sin_clave():
    """Decisión del dueño (18-sep): el grupo se comporta como un BLOQUE.

    «Investiga tu competencia» lleva el atributo a propósito aunque corra con
    Apify y funcionaría sin ninguna clave — se tomó sabiendo el costo, y se
    prefiere eso a que una de las tres se comporte distinta que sus vecinas.
    Si alguien le quita el atributo «arreglando» la dependencia, este test lo
    para: es una decisión de producto, no un error."""
    menu = _menu()
    for href in ("/agenda.html", "/competencia.html", "/metricas.html"):
        bloque = menu[menu.index(f'href="{href}"'):]
        assert bloque.startswith(f'href="{href}" data-blotato'), f"{href} sin apagar"
    assert menu.count(' data-blotato>') == 3   # solo el atributo, no el comentario


def test_el_apagado_ofrece_conectar_en_vez_de_dejar_un_callejon():
    assert "a.classList.toggle('apagada', !conectado)" in INICIO
    assert "abrirBlotato();" in INICIO[INICIO.index("e.preventDefault();"):]


def test_si_no_se_sabe_si_hay_clave_no_se_apaga_nada():
    """`leerBlotato` falla → se quedan encendidas. Dejar sin sus herramientas a
    quien sí pagó, porque un fetch no respondió, es peor que dejar entrar a
    quien no: el backend responde 409 de todos modos."""
    assert ".catch(() => {})" in INICIO
    assert "apagada" not in _menu()   # el estado inicial del HTML es encendido


# ---------------------------------------------------------------------------
# el desplegable cabe en la pantalla

def test_el_triangulo_es_contenido_del_boton_y_va_a_la_derecha():
    """Como `::after` se quedaba huérfano en su propia línea cuando la fila se
    apretaba, y parecía una cajita suelta encima del botón (visto 2026-09-18).
    Va al final: a la derecha del rótulo y del precio."""
    assert ".prompt button.opcion::after" not in INICIO
    assert '<span class="ca">▾</span>`' in INICIO
    assert "white-space: nowrap" in INICIO[INICIO.index(".prompt button.opcion {"):
                                           INICIO.index(".prompt button.opcion:hover")]


def test_el_menu_se_sujeta_dentro_de_la_ventana():
    """El menú es más ancho que su botón y el botón está a media fila: anclado
    a la izquierda se salía por la derecha, y anclado a la derecha se salía por
    la izquierda. Ninguna de las dos sirve a todos los anchos — se mide."""
    assert "function ubicaMenu()" in INICIO
    assert "Math.max(margen, Math.min(boton.left, tope))" in INICIO
    assert "ubicaMenu();" in INICIO[INICIO.index("lista.hidden = false;"):]
    # y si la ventana cambia de tamaño con el menú abierto, se recoloca
    assert "addEventListener('resize'" in INICIO


def test_cada_opcion_cambia_el_ejemplo_del_hueco():
    """«Pega tu historia completa» no es un buen ejemplo para un clip de 8 s."""
    for rotulo in ("Un video corto", "Creador de cuentos", "Crea tu historia",
                   "Crear una imagen", "Editar una imagen"):
        assert "hueco:" in _opcion(rotulo)
    assert "$('#idea').placeholder = opcionHub.hueco;" in INICIO
