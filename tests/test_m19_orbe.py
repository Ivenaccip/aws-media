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
