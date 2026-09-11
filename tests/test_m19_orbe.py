"""M19 — el orbe de «la IA está trabajando» (fase 1: componente + imágenes).

Lo que se protege aquí es lo que no se puede ver en esta máquina: no hay WebGPU
en el entorno de pruebas, así que estos tests cuidan el CONTRATO — que el motor
no se cuele en la carga inicial, que el shader siga siendo el que los ajustes
seleccionan, que la caché no congele lo que debe revalidar, y que las dos
pantallas de imágenes no vuelvan a rehabilitar su botón a media petición.
"""
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

RAIZ = Path(__file__).resolve().parent.parent
ESTATICOS = RAIZ / "static"
PAGINAS_IMAGENES = ["crear-imagenes.html", "editor-imagenes.html"]


@pytest.fixture
def cliente(monkeypatch):
    monkeypatch.delenv("COGNITO_POOL_ID", raising=False)
    from server.app import app
    return TestClient(app)


# ---------------------------------------------------------------------------
# se sirven, y solo los versionados se congelan

def test_los_tres_archivos_se_sirven(cliente):
    for ruta in ("/orbe.js", "/orbe-gpu.v1.js", "/orbe.v1.wgsl"):
        assert cliente.get(ruta).status_code == 200, ruta


def test_cache_inmutable_solo_en_los_versionados(cliente):
    for ruta in ("/orbe-gpu.v1.js", "/orbe.v1.wgsl"):
        cc = cliente.get(ruta).headers.get("cache-control", "")
        assert "immutable" in cc and "604800" in cc, f"{ruta}: {cc!r}"
    # orbe.js NO: tiene que revalidar para que un fix de UI llegue con el deploy
    assert "immutable" not in cliente.get("/orbe.js").headers.get("cache-control", "")


# ---------------------------------------------------------------------------
# el motor es perezoso: la mayoría de las visitas nunca ve un orbe

def test_orbe_js_no_carga_el_motor_ni_el_shader():
    js = (ESTATICOS / "orbe.js").read_text(encoding="utf-8")
    assert "requestAdapter" not in js and "struct Uniforms" not in js
    # techo de cordura: si alguien inlinea el motor (15 KB) o el shader (60 KB)
    # aquí, este número salta. No es un presupuesto de bytes, es una alarma.
    assert len(js.encode()) < 12_000, "orbe.js engordó — ¿se le metió el motor?"


def test_ningun_html_carga_el_motor_directo():
    for html in list(ESTATICOS.glob("*.html")) + [RAIZ / "tools" / "editor" / "index.html"]:
        texto = html.read_text(encoding="utf-8")
        assert "orbe-gpu" not in texto, f"{html.name} carga el motor sin pereza"


# ---------------------------------------------------------------------------
# el shader: el que los ajustes seleccionan, sin el camino de partículas

def test_shader_sin_el_camino_de_particulas():
    wgsl = (ESTATICOS / "orbe.v1.wgsl").read_text(encoding="utf-8")
    # style=24 nunca se ejecuta con estos ajustes; sus 221k instancias sobraban
    for centinela in ("PR_U_SEGMENTS", "ribbon_vs_main", "ribbonTexture"):
        assert centinela not in wgsl, f"volvió el camino de partículas: {centinela}"


def test_shader_conserva_lo_que_el_motor_usa():
    wgsl = (ESTATICOS / "orbe.v1.wgsl").read_text(encoding="utf-8")
    for pieza in ("struct Uniforms", "fn vs_main", "fn fs_main",
                  "fn glsAuroraFluid", "@group(0) @binding(0)"):
        assert pieza in wgsl, f"falta {pieza}"
    # el triángulo fullscreen: 3 vértices, no una malla
    assert "array<vec2<f32>, 3>" in wgsl


def _ajustes():
    js = (ESTATICOS / "orbe-gpu.v1.js").read_text(encoding="utf-8")
    fuera = {}
    for nombre in ("idle", "pensando"):
        m = re.search(rf"^\s*{nombre}: (\[.*?\]),$", js, re.M)
        assert m, f"no encontré los ajustes de {nombre}"
        fuera[nombre] = json.loads(m.group(1))
    return fuera


def test_los_dos_ajustes_cuadran_con_la_struct():
    a = _ajustes()
    # 40 escalares (size.xy + 38) y 24 vec4 de color = 136 floats
    assert len(a["idle"]) == len(a["pensando"]) == 136
    for nombre, v in a.items():
        assert v[15] == 10, f"{nombre}: el preset dejó de ser el de la aurora"
        assert v[19] == 1, f"{nombre}: se apagó la cáscara de vidrio"
    # lo que separa los dos estados: velocidad, deformación y exposición
    assert a["pensando"][3] > a["idle"][3]    # speed
    assert a["pensando"][6] > a["idle"][6]    # warp
    assert a["pensando"][14] > a["idle"][14]  # exposure


# ---------------------------------------------------------------------------
# las dos pantallas de imágenes

@pytest.mark.parametrize("pagina", PAGINAS_IMAGENES)
def test_la_pagina_monta_el_orbe(pagina):
    html = (ESTATICOS / pagina).read_text(encoding="utf-8")
    assert '<script src="/orbe.js">' in html
    assert "orbe.montar(" in html and 'id="orbe-hueco"' in html
    assert "precargar()" in html                 # no se paga el motor al hacer clic
    assert "alAgotar:" in html                   # todo montaje lleva tope
    # un adorno que no cargó no puede romper el botón que gasta créditos
    assert "SIN_ORBE" in html and "window.orbe ?" in html


@pytest.mark.parametrize("pagina", PAGINAS_IMAGENES)
def test_el_orbe_se_desmonta_antes_del_error(pagina):
    html = (ESTATICOS / pagina).read_text(encoding="utf-8")
    cuerpo = html[html.index("} catch (e) {"):]
    desmonta = cuerpo.index("mando.desmontar()")
    pinta = cuerpo.index("$('#gerr').textContent = e.message")
    assert desmonta < pinta, "el orbe sigue girando cuando se pinta el fallo"


@pytest.mark.parametrize("pagina", PAGINAS_IMAGENES)
def test_guarda_contra_el_doble_cobro(pagina):
    """monedero.js refresca en cada visibilitychange: sin la guarda, volver de
    otra pestaña rehabilitaba el botón y el segundo clic cobraba otra vez."""
    html = (ESTATICOS / pagina).read_text(encoding="utf-8")
    listener = html[html.index("document.addEventListener('monedero'"):]
    guarda = listener.index("enVuelo) return")
    toca_el_boton = listener.index(".textContent = `${mon.tarifas.imagen}")
    assert guarda < toca_el_boton, "el listener toca el botón antes de mirar enVuelo"
    assert "if (enVuelo) return;" in html        # y el handler tampoco reentra


@pytest.mark.parametrize("pagina", PAGINAS_IMAGENES)
def test_el_boton_conserva_su_precio(pagina):
    """El precio en créditos es el dato que hay que poder leer: el botón ya no
    se convierte en un indicador de carga."""
    html = (ESTATICOS / pagina).read_text(encoding="utf-8")
    assert "⏳" not in html
    assert "const antes = $(" not in html


def test_el_resultado_no_se_revela_antes_de_tiempo():
    """#resultado contiene un <a download> SIN href hasta que llega la url:
    revelarlo al hacer clic dejaría un botón grande y mentiroso durante la
    espera. Solo se revela después de leer la respuesta."""
    for pagina in PAGINAS_IMAGENES:
        html = (ESTATICOS / pagina).read_text(encoding="utf-8")
        revela = html.index("$('#resultado').classList.remove('hidden')")
        respuesta = html.index("const d = await r.json()")
        assert respuesta < revela, f"{pagina}: se revela el resultado antes de tenerlo"


# ---------------------------------------------------------------------------
# el arnés de sintaxis, sobre TODO el JS del repo

@pytest.mark.skipif(shutil.which("node") is None, reason="node no está en el PATH")
def test_check_js_pasa_en_todo_el_repo():
    r = subprocess.run([sys.executable, str(RAIZ / "tools" / "check_js.py")],
                       capture_output=True, text=True, cwd=str(RAIZ))
    assert r.returncode == 0, r.stdout + r.stderr


@pytest.mark.skipif(shutil.which("node") is None, reason="node no está en el PATH")
def test_check_js_caza_un_error_inline(tmp_path):
    """El arnés sirve si de verdad falla: un <script> roto tiene que salir 1."""
    roto = tmp_path / "roto.html"
    roto.write_text("<html><body>\n<script>\nfunction x( {\n</script>\n</body></html>",
                    encoding="utf-8")
    r = subprocess.run([sys.executable, str(RAIZ / "tools" / "check_js.py"), str(roto)],
                       capture_output=True, text=True, cwd=str(RAIZ))
    assert r.returncode == 1 and "1 con errores" in r.stdout


# ---------------------------------------------------------------------------
# fase 2 — crear.html: la pantalla que TODO usuario recorre
#
# Aquí el orbe no llega a un hueco vacío como en imágenes: hay barra, hay
# etapas y hay dos botones que cobran. Lo que se protege es que el orbe se
# sume sin borrar nada de eso, y que no vuelva a haber un botón de dinero
# rehabilitado a media petición.

CREAR = ESTATICOS / "crear.html"


@pytest.mark.skipif(shutil.which("node") is None, reason="node no está en el PATH")
def test_arnes_del_componente_en_node():
    """La lógica de TIEMPO del orbe (tope, cronómetro, latido, idempotencia)
    corre de verdad contra un DOM mínimo: es la parte que puede mentirle al
    usuario, y no necesita GPU para auditarse."""
    r = subprocess.run(["node", str(RAIZ / "tests" / "orbe_nodo.js")],
                       capture_output=True, text=True, cwd=str(RAIZ))
    assert r.returncode == 0, r.stdout + r.stderr


def test_crear_monta_el_orbe():
    html = CREAR.read_text(encoding="utf-8")
    assert '<script src="/orbe.js">' in html
    assert 'id="orbe-prog"' in html and "orbeProgreso(" in html
    assert "precargar()" in html
    assert "SIN_ORBE" in html and "window.orbe ?" in html


def test_la_barra_se_queda():
    """La barra de esta pantalla es real y monotónica (ETAPAS_PREP/PROD): el
    orbe la acompaña, no la sustituye. Un orbe no sabe decir «vas por el 60 %»."""
    html = CREAR.read_text(encoding="utf-8")
    for pieza in ('id="pbar"', "ETAPAS_PREP", "ETAPAS_PROD", "pctPrev"):
        assert pieza in html, f"desapareció {pieza}: el orbe se comió la barra"


def test_sin_glifos_de_espera():
    """El orbe existe para reemplazar los ⏳, no para acompañarlos."""
    assert "⏳" not in CREAR.read_text(encoding="utf-8")


def test_la_etapa_no_se_pierde_sin_orbe():
    """La etapa se mudó al orbe; si orbe.js no cargó, #petapa vuelve a
    llevarla. Nunca hay una pantalla de progreso que no diga qué está pasando."""
    html = CREAR.read_text(encoding="utf-8")
    assert "$('#petapa').textContent = (window.orbe ? '' : etiqueta + ' · ')" in html


def test_guarda_contra_el_doble_cobro_en_los_dos_botones():
    """En esta pantalla se cobra dos veces: el guion y la producción. El
    listener de monedero corre en CADA visibilitychange, así que sin la guarda
    volver de otra pestaña rehabilitaba el botón a media petición."""
    html = CREAR.read_text(encoding="utf-8")
    assert "function pintaCostos() {\n  if (!mon || !mon.activo || enVuelo) return;" in html
    assert "function pintaProducir() {\n  if (!mon || !mon.activo || enVuelo) return;" in html
    # y ninguno de los tres botones que gastan reentra
    assert html.count("if (enVuelo) return;") >= 3


def test_el_orbe_se_va_antes_del_confirm_del_balanceador():
    """confirm() congela el hilo: un orbe girando detrás afirmaría que estamos
    trabajando cuando lo único que pasa es que te preguntamos algo."""
    html = CREAR.read_text(encoding="utf-8")
    cuerpo = html[html.index("if (d.slots) return fin(d.aviso);"):]
    assert cuerpo.index("fin();") < cuerpo.index("if (confirm(")


def test_el_orbe_se_va_antes_de_la_pantalla_de_error():
    """render() desmonta en cuanto el estado deja de estar en marcha, antes de
    pintar resultado o error."""
    html = CREAR.read_text(encoding="utf-8")
    cuerpo = html[html.index("function render(p) {"):]
    assert cuerpo.index("mandoProg.desmontar()") < cuerpo.index("show('progreso')")


def test_el_poll_se_duerme_con_la_pestana_oculta():
    """Cada vuelta del poll cuesta una Lambda y una consulta a Aurora, y el
    copy de la pantalla invita a irse. Al volver se refresca al instante."""
    html = CREAR.read_text(encoding="utf-8")
    assert "poll = document.hidden ? null : setInterval(refrescar, 2500);" in html
    assert "else { refrescar(); arrancarPoll(); }" in html


def test_sin_conexion_el_orbe_baja_a_reposo():
    """Sin contacto no podemos afirmar que la IA trabaja AHORA: el orbe pasa a
    reposo mientras el banner explica que el trabajo sigue en la nube."""
    html = CREAR.read_text(encoding="utf-8")
    catch = html[html.index("if (++fallosPoll >= 2) {"):]
    assert "mandoProg.estado('idle');" in catch[:600]
    assert "mandoProg.estado('pensando');" in html


def test_el_tope_del_progreso_mide_silencio_y_no_espera():
    """Una película larga tarda lo que tarda: el tope de esta pantalla cuenta
    desde el último avance real, no desde que abriste."""
    html = CREAR.read_text(encoding="utf-8")
    assert "const clave = [p.estado, p.etapa, p.progreso.escenas_listas || 0].join(':');" in html
    assert "mandoProg.latir()" in html
    assert "latir()" in (ESTATICOS / "orbe.js").read_text(encoding="utf-8")


# ---------------------------------------------------------------------------
# el bug que destapó el mapeo: «Reintentar» invisible en el camino por defecto

def test_el_servidor_si_acepta_reintentar_una_narracion_sin_guion():
    """Prueba de que esconder el botón era un bug y no una salvaguarda: para el
    servidor este proyecto tiene guion de sobra y /producir lo aceptaría."""
    from pipeline.project import Proyecto
    p = Proyecto(id="t1", creado="2026-09-11T00:00:00", brief="b",
                 pipeline="narracion", narracion="Un texto narrado completo.")
    assert not p.guion, "el pipeline de narración deja p.guion vacío"
    assert p.tiene_guion(), "el servidor SÍ considera producible este proyecto"


def test_reintentar_usa_el_mismo_criterio_que_el_servidor():
    """El pipeline por defecto es narración desde el 7 de septiembre: la
    condición vieja (solo p.guion) escondía «Reintentar» en el camino normal y
    dejaba «Empezar de nuevo» como única salida — que vuelve a cobrar."""
    html = CREAR.read_text(encoding="utf-8")
    assert "p.pipeline === 'narracion' && (p.narracion || '').trim()" in html
    assert "p.personaje.elegida < p.personaje.opciones.length" in html
    assert "!(p.guion.length && p.personaje.elegida != null)" not in html


def test_el_pipeline_por_defecto_sigue_siendo_narracion(monkeypatch):
    """Si algún día vuelve a ser «escenas», el bug de arriba deja de ser del
    camino normal — pero la condición del cliente tiene que seguir cubriendo
    ambos pipelines igual."""
    import os
    monkeypatch.delenv("PIPELINE_DEFAULT", raising=False)
    assert os.getenv("PIPELINE_DEFAULT", "narracion") == "narracion"


# ---------------------------------------------------------------------------
# fase 3 — e1 + shorts + estilos: las esperas de minutos
#
# Aquí el orbe llega a pantallas cuyo copy dice literalmente «puedes cerrar la
# página». Eso obliga a dos cosas antes que el orbe: que la pestaña se pueda
# encontrar (favicon) y que diga en qué va (título). Y a una regla: de las
# esperas largas, solo llevan orbe las que de verdad son la IA pensando.

E1 = ESTATICOS / "e1.html"
SHORTS = ESTATICOS / "shorts.html"
ESTILOS = ESTATICOS / "estilos.html"
PAGINAS_FASE3 = [E1, SHORTS, ESTILOS]


def test_todas_las_paginas_tienen_favicon(cliente):
    """Media docena de pantallas invitan a cerrar la pestaña y volver. Sin
    favicon, volver es buscar a ciegas entre veinte papeles en blanco."""
    for html in ESTATICOS.glob("*.html"):
        assert '<link rel="icon" href="/favicon.svg"' in html.read_text(encoding="utf-8"), html.name
    r = cliente.get("/favicon.svg")
    assert r.status_code == 200 and "svg" in r.headers.get("content-type", "")


def test_el_favicon_es_el_nucleo_del_orbe():
    """Misma firma que .orbe-css: los tres degradados, los mismos colores."""
    svg = (ESTATICOS / "favicon.svg").read_text(encoding="utf-8")
    for color in ("#b28cff", "#3ce0c0", "#2a1e46", "#0d0a18"):
        assert color in svg, f"el favicon dejó de ser el orbe: falta {color}"
    assert svg.count("radialGradient") == 6   # 3 abiertos + 3 cerrados


@pytest.mark.parametrize("pagina", PAGINAS_FASE3, ids=lambda p: p.name)
def test_la_pestana_dice_en_que_va(pagina):
    html = pagina.read_text(encoding="utf-8")
    assert "const TITULO = document.title;" in html
    assert "document.title = t ?" in html
    assert "titulo(" in html


@pytest.mark.parametrize("pagina", PAGINAS_FASE3, ids=lambda p: p.name)
def test_el_poll_se_duerme_con_la_pestana_oculta(pagina):
    html = pagina.read_text(encoding="utf-8")
    assert "document.hidden" in html, "el poll no mira si la pestaña está oculta"
    assert 'addEventListener("visibilitychange"' in html, "y no se despierta al volver"


@pytest.mark.parametrize("pagina", PAGINAS_FASE3, ids=lambda p: p.name)
def test_sin_orbe_la_pagina_sigue_funcionando(pagina):
    html = pagina.read_text(encoding="utf-8")
    assert "SIN_ORBE" in html and "!window.orbe" in html


# ---------------------------------------------------------------------------
# la regla que mantiene al orbe significando algo

def test_en_shorts_solo_lleva_orbe_el_analisis():
    """Las tres esperas largas de shorts duran minutos, pero solo una es la IA:
    el análisis. Traer el video de YouTube es una descarga y el render es
    Remotion componiendo — si el orbe saliera ahí, dejaría de señalar nada."""
    html = SHORTS.read_text(encoding="utf-8")
    descarga = html[html.index('if (imp.estado === "descargando")'):]
    assert "orbeAnalisis(false)" in descarga[:700], "la descarga de YouTube monta orbe"
    render = html[html.index("function pintarRender(r) {"):]
    assert "orbe" not in render[:900].replace("orbeAnalisis", ""), "el render monta orbe"
    # el del análisis se fue (lo reemplazó el orbe) y quedan exactamente los
    # dos que no son IA: la descarga de YouTube y el render de Remotion
    assert html.count('class="spin"') == 2
    assert "spin\">Analizando en la nube" not in html


def test_el_orbe_no_acompana_errores_en_shorts():
    html = SHORTS.read_text(encoding="utf-8")
    cuerpo = html[html.index('} else {\n    orbeAnalisis(false);'):]
    assert cuerpo.index("orbeAnalisis(false)") < cuerpo.index("El análisis falló")


def test_estilos_un_orbe_es_un_trabajo():
    """Con dos análisis vivos no lleva orbe ninguno: «la IA está trabajando»
    dejaría de señalar algo concreto."""
    html = ESTILOS.read_text(encoding="utf-8")
    assert "vivas.length !== 1" in html


# ---------------------------------------------------------------------------
# los bugs que el mapeo destapó en estas tres pantallas

def test_ya_no_hay_enlaces_al_monedero_inexistente():
    """/monedero.html nunca ha existido: el CTA del 402 era un 404 duro en las
    dos pantallas donde más duele (te acabas de quedar sin créditos)."""
    assert not (ESTATICOS / "monedero.html").exists()
    for html in ESTATICOS.glob("*.html"):
        texto = html.read_text(encoding="utf-8")
        assert 'href="/monedero.html"' not in texto, f"{html.name} sigue llevando al 404"
    # y existe el camino de verdad
    assert "recargar: togglePanel" in (ESTATICOS / "monedero.js").read_text(encoding="utf-8")
    for pagina in (SHORTS, ESTILOS):
        assert "botonRecargar()" in pagina.read_text(encoding="utf-8"), pagina.name


def test_estilos_sobrevive_a_un_poll_fallido():
    """Era la condición para ponerle orbe: un solo fallo de red mataba el poll
    para siempre y la tarjeta se quedaba en «Analizando» hasta recargar."""
    html = ESTILOS.read_text(encoding="utf-8")
    catch = html[html.index('catch (e) {\n    // M19 (bug)'):]
    cuerpo = catch[:catch.index("$(\"lista\").innerHTML")]
    assert "programarPoll();" in cuerpo, "el catch ya no reintenta"
    assert 'orbeEst.estado("idle")' in cuerpo, "sin contacto el orbe debe bajar a reposo"


def test_estilos_no_repinta_la_lista_sin_cambios():
    """El repintado cada 5 s tiraba el «copiado ✓» del usuario y habría matado
    al orbe recién montado."""
    html = ESTILOS.read_text(encoding="utf-8")
    assert "if (firma !== listaFirma) {" in html


def test_e1_no_acumula_timers_de_poll():
    """initCorte() se llama también tras lanzar la corrida y tras subir: el
    setTimeout de antes no se cancelaba nunca."""
    html = E1.read_text(encoding="utf-8")
    assert "clearTimeout(pollTimer);\n  pollTimer = document.hidden ? null" in html
    assert "pollTimer = setTimeout(initCorte, 10000)" not in html


def test_e1_el_error_de_lanzar_ya_no_se_borra_solo():
    """El catch pintaba el error y el initCorte() de la línea siguiente lo
    borraba antes de que diera tiempo a leerlo."""
    html = E1.read_text(encoding="utf-8")
    cuerpo = html[html.index("async function irEditor()"):]
    catch = cuerpo[cuerpo.index("} catch (e) {"):cuerpo.index("for (const [id, fn]")]
    assert 'EDITOR.modo = "cobrar";' in catch and "return;" in catch


def test_e1_el_orbe_reemplaza_la_animacion_no_se_le_suma():
    """La animación de la línea de tiempo es decoración que corre siempre. El
    orbe ocupa su sitio solo mientras la IA trabaja de verdad."""
    html = E1.read_text(encoding="utf-8")
    assert 'ui("anim-editor").hidden = true;' in html
    assert 'ui("anim-editor").hidden = false;' in html
    assert "⏳" not in html
