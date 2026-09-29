"""RAG·9 a RAG·13 — la página pública /automatiza (static/automatiza.{html,css,js}).

Lo que decide qué ve el visitante corre de verdad en tests/automatiza_nodo.js
(qué pantalla toca con cada respuesta, los tiempos, el campo, los nombres de
los nodos, utm y referrer). Aquí, sin navegador, lo que la página promete por
contrato y se rompe sin hacer ruido:

  · las ocho pantallas existen y solo una se ve al abrir;
  · carga /sondeo.js ANTES que /automatiza.js y nunca auth.js ni monedero.js;
  · solo pide /api/publico/* y pinta lo del servidor con textContent;
  · cada formulario de correo lleva la casilla APARTE, desmarcada, con el
    texto del servidor, y un hueco para el ÚNICO aviso simplificado;
  · «¿Te funcionó?» va escondido (RAG·25);
  · los números que comparte con el servidor son los mismos.

Lo que se VE (las 12 pantallas a 1440 y 390 px, la CSP y el scroll lateral)
lo recorre Playwright con la API simulada; no corre en esta suite.
"""
import os
import re
import shutil
import subprocess
from pathlib import Path

import pytest

from pipeline import db
from server import publico_api

RAIZ = Path(__file__).resolve().parent.parent
HTML = (RAIZ / "static" / "automatiza.html").read_text(encoding="utf-8")
CSS = (RAIZ / "static" / "automatiza.css").read_text(encoding="utf-8")
JS = (RAIZ / "static" / "automatiza.js").read_text(encoding="utf-8")
ARNES = RAIZ / "tests" / "automatiza_nodo.js"
PANTALLAS = ("pedir", "espera", "fila", "correo", "listo", "no-salio", "rechazada", "no-disponible")


def _nodo() -> str | None:
    """El node de la máquina de pruebas (/opt/node22) o, si no, el del PATH."""
    fijo = "/opt/node22/bin/node"
    if os.path.exists(fijo):
        return fijo
    return shutil.which("node")


def _sin_comentarios_js(js: str) -> str:
    js = re.sub(r"/\*.*?\*/", "", js, flags=re.S)
    return re.sub(r"(?m)^\s*//[^\n]*|\s//\s[^\n]*", "", js)


def _sin_comentarios_html(html: str) -> str:
    return re.sub(r"<!--.*?-->", "", html, flags=re.S)


@pytest.mark.skipif(_nodo() is None, reason="node no está instalado")
def test_arnes_de_la_logica_en_node():
    r = subprocess.run([_nodo(), str(ARNES)], capture_output=True, text=True,
                       encoding="utf-8", cwd=str(RAIZ), timeout=60)
    assert r.returncode == 0, r.stdout + r.stderr
    assert "comprobaciones OK" in r.stdout, r.stdout


# ---------------------------------------------------------------------------
# las pantallas

def test_estan_las_ocho_pantallas_y_al_abrir_solo_se_ve_pedir():
    secciones = re.findall(r"<section\b[^>]*\bdata-pantalla=\"([^\"]+)\"[^>]*>", HTML)
    assert sorted(secciones) == sorted(PANTALLAS)
    for etiqueta in re.findall(r"<section\b[^>]*\bdata-pantalla=\"[^\"]+\"[^>]*>", HTML):
        nombre = re.search(r'data-pantalla="([^"]+)"', etiqueta).group(1)
        assert ("hidden" in etiqueta) == (nombre != "pedir"), nombre


def test_cada_pantalla_tiene_un_h1_que_recibe_el_foco():
    """Al cambiar de pantalla el foco va a su título (accesibilidad del contrato)."""
    partes = re.split(r"(?=<section\b[^>]*\bdata-pantalla=)", HTML)[1:]
    for parte in partes:
        nombre = re.search(r'data-pantalla="([^"]+)"', parte).group(1)
        h1 = re.search(r"<h1\b[^>]*>", parte)
        assert h1 and 'tabindex="-1"' in h1.group(0), nombre


def test_el_progreso_se_anuncia_con_aria_live():
    assert re.search(r'<[^>]+data-anuncio[^>]+aria-live="polite"', HTML)


# ---------------------------------------------------------------------------
# lo que carga y lo que pide

def test_sondeo_va_antes_que_la_pagina_y_con_defer():
    scripts = re.findall(r"<script\b[^>]*>", _sin_comentarios_html(HTML))
    assert scripts == ['<script src="/sondeo.js" defer>', '<script src="/automatiza.js" defer>']


def test_nunca_carga_auth_ni_monedero():
    """monedero.js llama a /api/creditos y un 401 manda a Cognito."""
    html = _sin_comentarios_html(HTML)
    assert "auth.js" not in html and "monedero.js" not in html
    assert "trabajos.js" not in html and "guardrail.js" not in html


def test_todo_lo_propio_va_con_ruta_absoluta():
    """La página también vive en /automatiza/c/<id>: una ruta relativa se rompe ahí."""
    html = _sin_comentarios_html(HTML)
    for attr in re.findall(r'\b(?:src|href)="([^"#]+)"', html):
        if attr.startswith("https://irremplazables.xyz/"):
            continue      # canonical y og:*
        assert attr.startswith("/"), attr


def test_solo_pide_la_api_publica():
    codigo = _sin_comentarios_js(JS)
    for url in re.findall(r"['\"](/api/[^'\"]*)['\"]", codigo):
        assert url.startswith("/api/publico/"), url
    assert "/api/publico/" in codigo


def test_nada_que_choque_con_la_csp_ni_html_del_servidor():
    """Lo que manda el servidor (mensajes, nombres de nodos) se pinta con
    textContent: nunca como HTML."""
    codigo = _sin_comentarios_js(JS)
    assert not re.search(r"\beval\s*\(|new\s+Function\b", codigo)
    assert "setAttribute('style'" not in codigo and 'setAttribute("style"' not in codigo
    assert "innerHTML" not in codigo and "outerHTML" not in codigo
    assert "insertAdjacentHTML" not in codigo and "document.write" not in codigo


def test_el_js_no_lleva_marcadores():
    """Solo el HTML se llena en el servidor: un marcador en el JS saldría crudo."""
    assert "{{" not in JS and "{{" not in CSS


# ---------------------------------------------------------------------------
# el correo y el consentimiento (RAG·12/13)

def _formularios_de_correo() -> list[str]:
    return re.findall(r"<form\b[^>]*\bdata-form-correo\b.*?</form>", HTML, flags=re.S)


def test_los_formularios_de_correo_y_sus_origenes():
    formas = _formularios_de_correo()
    origenes = [re.search(r'data-origen="([^"]+)"', f).group(1) for f in formas]
    assert sorted(set(origenes)) == sorted(publico_api.ORIGENES_CORREO)
    # «se pasó del tiempo» (2d) sale también mientras arma: no es «fila»
    tope = re.search(r"<div class=\"tope\" data-tope.*?</form>", HTML, flags=re.S).group(0)
    assert 'data-origen="espera"' in tope


def test_el_correo_viaja_con_la_version_del_aviso_de_la_pagina():
    """Sin ella el servidor guardaría el texto de HOY aunque la pestaña se
    abriera con otro (el consentimiento a un texto que no vio)."""
    assert 'data-aviso-version="{{aviso_version}}"' in HTML
    assert "principal.dataset.avisoVersion" in JS
    assert re.search(r"aviso_version:\s*AVISO_VERSION", JS)


@pytest.mark.parametrize("campo", ["correo-tarde", "correo-fila", "correo-listo", "correo-no-salio"])
def test_cada_campo_de_correo_se_llama_correo(campo):
    """El nombre accesible sale de su <label>: una pregunta suelta («¿No
    quieres esperar aquí?») no le dice al lector de pantalla qué escribir."""
    etiqueta = re.search(rf'<label for="{campo}"[^>]*>(.*?)</label>', HTML, flags=re.S).group(1)
    assert "correo" in re.sub(r"<[^>]+>", "", etiqueta).lower(), campo


@pytest.mark.parametrize("i", range(4))
def test_cada_formulario_lleva_la_casilla_aparte_y_desmarcada(i):
    forma = _formularios_de_correo()[i]
    casillas = re.findall(r'<input\b[^>]*type="checkbox"[^>]*>', forma)
    assert len(casillas) == 1
    assert "checked" not in casillas[0], "la casilla de recontacto va DESMARCADA"
    assert 'name="recontacto"' in casillas[0]
    # el texto lo pone el servidor (el mismo que guarda con el correo)
    assert "{{recontacto_texto}}" in forma
    assert re.search(r'<input\b[^>]*type="email"[^>]*\brequired\b', forma)
    assert "data-aviso-aqui" in forma, "cada formulario lleva el aviso simplificado"


@pytest.mark.parametrize("cual", ["plantilla-aviso", "plantilla-aviso-compacto"])
def test_el_aviso_simplificado_vive_en_sus_plantillas(cual):
    """Una plantilla completa (pantalla 3) y una compacta (fila, 2d, no salió),
    cada una UNA vez, con sus cuatro filas y el enlace al integral."""
    assert HTML.count(f'<template id="{cual}">') == 1
    plantilla = re.search(rf'<template id="{cual}">(.*?)</template>', HTML, flags=re.S).group(1)
    assert [m for m in re.findall(r"<dt>([^<]+)</dt>", plantilla)] == \
        ["Quién", "Para qué", "Qué guardamos", "Tus derechos"]
    for clave in ("responsable", "domicilio", "plazo_peticion", "plazo_correo",
                  "correo_privacidad"):
        assert "{{" + clave + "}}" in plantilla, clave
    assert 'href="/privacidad"' in plantilla
    # la IP: se guarda una huella para los topes (pipeline/publico.py), así
    # que el aviso no puede decir «tu IP no» a secas
    assert "huella" in plantilla
    assert cual in JS


def test_la_pantalla_1_ya_da_el_aviso_minimo():
    """Los datos se guardan desde el primer «Armar» (aun si se rechaza): la
    pantalla 1 nombra al responsable, el plazo, la huella de la IP y los Términos."""
    pedir = re.search(r'<form class="tarjeta pedir-form".*?</form>', HTML, flags=re.S).group(0)
    pedir = _sin_comentarios_html(pedir)
    for clave in ("responsable", "domicilio", "plazo_peticion"):
        assert "{{" + clave + "}}" in pedir, clave
    assert "huella" in pedir and "No guardamos tu IP" not in pedir
    assert 'href="/terminos"' in pedir and 'href="/privacidad"' in pedir
    # en el mismo POST viajan el referrer y los utm (automatiza.js): la
    # línea lo dice, y dice a dónde escribir para oponerse
    assert "de dónde llegan las visitas" in pedir and "llegaste" in pedir
    assert "{{correo_privacidad}}" in pedir and "oponerte" in pedir


def test_la_huella_no_se_llama_cifrada():
    """Es un HMAC con una sal que tiene el responsable: no se descifra, pero
    con la sal la IP se recupera probando las 2^32 direcciones. «Cifrada»
    promete algo que no es."""
    for nombre in ("automatiza.html", "privacidad.html"):
        texto = (RAIZ / "static" / nombre).read_text(encoding="utf-8")
        assert "cifrad" not in texto.lower(), nombre
        assert "Del código no se puede leer tu IP" not in texto


@pytest.mark.parametrize("cual", ["plantilla-aviso", "plantilla-aviso-compacto"])
def test_el_simplificado_dice_lo_mismo_que_el_integral_del_correo(cual):
    """Junto a la casilla no se puede prometer un plazo más corto que el
    real: con la casilla, el correo se guarda hasta la baja (integral §4)."""
    plantilla = re.search(rf'<template id="{cual}">(.*?)</template>', HTML, flags=re.S).group(1)
    assert "{{plazo_correo}} (si marcas la casilla, hasta que te des de baja)" in plantilla
    assert "No te pedimos datos sensibles" in plantilla
    assert "negarte a los usos adicionales" in plantilla


def test_terminos_y_privacidad_estan_enlazados():
    html = _sin_comentarios_html(HTML)
    assert 'href="/terminos"' in html and 'href="/privacidad"' in html


def _bloque_js(inicio: str) -> str:
    """El cuerpo de una función (o manejador) de la página, sin comentarios."""
    i = JS.index(inicio)
    return _sin_comentarios_js(JS[i:JS.index("\n  }", i)])


def test_volver_a_mirar_arranca_un_sondeo_nuevo():
    """reanudar() reutiliza el sondeo que ya avisó «Se cortó tu conexión» y no
    lo vuelve a decir, pero ese aviso se quitó al entrar al tope. Y repintar
    con el lleva_seg viejo haría retroceder «Lo pediste hace…»."""
    bloque = _bloque_js("$('[data-volver-a-mirar]').addEventListener")
    assert "mirar(true)" in bloque and "reanudar" not in bloque
    assert "repintar()" in bloque
    assert "lleva_seg: undefined" in _bloque_js("function repintar()")


def test_la_pausa_solo_promete_el_borrador_si_se_guardo():
    """Con localStorage bloqueado, «Guardamos lo que escribiste» sería mentira."""
    assert "e.hidden = !(hay && estado.guardado)" in _bloque_js("function pintarPausa()")


def test_los_errores_se_anuncian_si_el_foco_ya_estaba_en_el_campo():
    """Enter en el correo o Ctrl+Enter en la petición: no hay evento de foco
    que lea el aria-describedby, así que el error va a la región viva."""
    assert "anunciar(texto, true)" in _bloque_js("function errorCorreo(")
    assert "anunciar(error, true)" in _bloque_js("function pintarCampo(")
    assert "anunciar(" in _bloque_js("function corridaPerdida()")


def test_el_correo_guardado_repinta_la_corrida():
    """Si el POST del correo contesta cuando la pantalla ya cambió (la fila
    pasó a la espera, o quedó lista y pide el correo), lo decide la corrida."""
    bloque = _bloque_js("function correoGuardado(")
    assert "repintar()" in bloque and "correoSesionVer" in bloque


def test_la_fila_no_se_quita_mientras_escribe_el_correo():
    """pantallaPara(…, enFila) lo prueba el arnés de node; esto fija que la
    corrida se lo pase: sin eso, al avanzar del lugar 3 al 2 el formulario
    desaparece a media palabra y el foco se va al título."""
    assert "pantallaPara(c, tieneCorreo(), escribiendoEnFila())" in _bloque_js("function pintarCorrida(")


def test_el_area_tactil_de_cambiar_el_correo():
    regla = re.search(r"\.btn-enlace\.chica \{[^}]*\}", CSS).group(0)
    assert "min-height: 44px" in regla


def test_te_funciono_va_escondido_hasta_rag25():
    etiqueta = re.search(r"<section\b[^>]*\bdata-te-funciono\b[^>]*>", HTML).group(0)
    assert "hidden" in etiqueta


def test_el_campo_usa_los_topes_del_servidor():
    assert 'data-largo-minimo="{{largo_minimo}}"' in HTML
    assert 'data-largo-maximo="{{largo_maximo}}"' in HTML
    assert "0 / {{largo_maximo}}" in HTML
    # el lienzo 1b: se puede pasar del máximo y ver cuántos sobran, así que
    # el campo NO lleva maxlength
    assert "maxlength" not in HTML.lower()


# ---------------------------------------------------------------------------
# lo que la página y el servidor tienen que decir igual

def test_los_pasos_son_los_de_la_base():
    pasos = re.search(r"const PASOS = \[([^\]]+)\]", JS).group(1)
    assert [p.strip().strip("'") for p in pasos.split(",")] == list(db.PASOS_AUTOMATIZA)


def test_el_id_es_el_del_servidor():
    patron = re.search(r"const ID = /\^(.+?)\$/;", JS).group(1)
    assert patron == publico_api.ID_PUBLICO.pattern


def test_los_tiempos_provisionales_estan_marcados():
    assert re.search(r"const TARDA_MIN = 1;", JS) and re.search(r"const TARDA_MAX = 3;", JS)
    assert "[POR MEDIR con tools/automatiza_e2e.py]" in JS


# ---------------------------------------------------------------------------
# la carta (docs/DISENO.md)

def test_solo_tamanos_de_la_escala():
    """Seis tamaños y ninguno más (§2): en px sueltos o con las variables."""
    escala = {"13", "15", "17", "20", "24", "32"}
    for n in re.findall(r"font-size:\s*(\d+)px", CSS):
        assert n in escala, n
    for n in re.findall(r"\bfont:[^;]*?\b(\d+)px", CSS):
        assert n in escala, n


def test_head_para_compartir():
    for meta in ('rel="canonical" href="https://irremplazables.xyz/automatiza"',
                 'property="og:title"', 'property="og:description"',
                 'property="og:image" content="https://irremplazables.xyz/automatiza-og.png"',
                 'property="og:image:width" content="1200"', 'property="og:image:height" content="630"',
                 'property="og:locale" content="es_MX"',
                 'property="og:url" content="https://irremplazables.xyz/automatiza"',
                 'name="twitter:card" content="summary_large_image"', 'rel="icon"'):
        assert meta in HTML, meta
