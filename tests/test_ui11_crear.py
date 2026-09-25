"""UI·11 — crear con la carta de diseño (docs/DISENO.md §8).

Lo que se defiende aquí:
- la espera larga dice los pasos con nombre, lo que falta y que puedes cerrar
  la pestaña; los pasos nunca retroceden, igual que la barra;
- el error llega en tres partes (qué pasó, tus créditos, qué sigue) con un solo
  botón ámbar, y lo técnico queda plegado;
- la cifra de «Te devolvimos ✦ N» es la que devuelve el worker, no otra.
"""
import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parent.parent
CREAR = (RAIZ / "static" / "crear.html").read_text(encoding="utf-8")


def _js(html: str) -> str:
    return html[html.index("<script>\nconst $") + len("<script>"):html.rindex("</script>")]


def _seccion(id_: str) -> str:
    i = CREAR.index(f'<section id="{id_}"')
    return CREAR[i:CREAR.index("</section>", i)]


def _bloque(js: str, inicio: str) -> str:
    i = js.index(inicio)
    j = js.index("{", i)
    nivel = 0
    for k in range(j, len(js)):
        nivel += {"{": 1, "}": -1}.get(js[k], 0)
        if nivel == 0:
            return js[i:k + 1]
    raise AssertionError(inicio)


# ---------------------------------------------------------------------------
# lo que se lee en el HTML

def test_carga_los_iconos_antes_del_script():
    assert CREAR.index('src="/iconos.js"') < CREAR.index("<script>\nconst $")


def test_la_espera_tiene_pasos_y_lo_que_falta():
    prog = _seccion("progreso")
    assert 'id="ppasos"' in prog and 'id="pfalta" hidden' in prog
    # la barra y el orbe se quedan
    assert 'id="pbar"' in prog and 'id="orbe-prog"' in prog
    assert "Puedes cerrar esta pestaña" in CREAR


def test_el_filtro_ambar_de_los_emojis_no_toca_los_iconos():
    """crear ya tenía .ico: un emoji de título con filtro sepia → ámbar. Si el
    filtro alcanza al SVG, la palomita verde y el aviso rojo salen ámbar."""
    assert "span.ico { filter:" in CREAR
    assert not re.search(r"(?<![\w.])\.ico \{ filter", CREAR)
    assert "svg.ico { width" in CREAR


def test_sin_emojis_en_la_espera_ni_en_el_error():
    for e in "🎥✍❌":
        assert e not in CREAR, e
    assert "Error desconocido" not in CREAR


def test_el_error_llega_en_tres_partes():
    error = _seccion("error")
    assert 'id="emsg"' in error                       # qué pasó
    assert "<h3>Tus créditos</h3>" in error and 'id="edevol"' in error
    assert "<h3>Qué sigue</h3>" in error and 'id="esigue"' in error
    assert "<summary>Detalles técnicos</summary>" in error
    # un solo principal: «Empezar de nuevo» es secundario mientras se pueda reintentar
    assert 'class="btn" id="reintentar"' in error and 'class="btn sec" id="denuevo"' in error
    js = _bloque(_js(CREAR), "function pintaError(p)")
    assert "$('#denuevo').classList.toggle('sec', fallaProducir);" in js


def test_el_error_de_reintentar_no_pisa_lo_que_paso():
    js = _js(CREAR)
    reintentar = js[js.index("$('#reintentar').onclick"):js.index("// --- reanudar por URL")]
    assert "$('#eerr').textContent = e.message" in reintentar
    assert "#emsg" not in reintentar


def test_devuelve_la_misma_cifra_que_el_worker():
    """producir_task devuelve creditos.producir_cobrado(p) → p.cobrado_producir;
    lambda_worker devuelve costo_preparar() → tarifas.preparar."""
    js = _bloque(_js(CREAR), "function pintaError(p)")
    assert "p.cobrado_producir ??" in js
    assert ": mon.tarifas.preparar;" in js
    worker = (RAIZ / "worker" / "producir_task.py").read_text(encoding="utf-8")
    assert "n = creditos.producir_cobrado(p)" in worker
    lam = (RAIZ / "worker" / "lambda_worker.py").read_text(encoding="utf-8")
    assert "creditos.devolver(creditos.costo_preparar()" in lam


def test_los_pasos_cubren_todas_las_etapas_del_pipeline():
    """Una etapa que no está en ningún paso dejaría el paso anterior encendido
    mientras la barra avanza. Se leen de ETAPA_TXT, que ya las nombra todas."""
    js = _js(CREAR)
    etapa_txt = js[js.index("const ETAPA_TXT = {"):js.index("};", js.index("const ETAPA_TXT = {"))]
    etapas = set(re.findall(r"(\w+):'", etapa_txt))
    prep = js[js.index("const PASOS_PREP"):js.index("const PASOS_PROD")]
    prod = js[js.index("const PASOS_PROD"):js.index("const pasoDe")]
    cubiertas = set(re.findall(r"'(\w+)'", prep + prod))
    assert etapas <= cubiertas, etapas - cubiertas


# ---------------------------------------------------------------------------
# la lógica corriendo en node contra un DOM mínimo

NODO = r"""
const nodos = {};
const $ = s => nodos[s] || (nodos[s] = {textContent: '', innerHTML: '', hidden: false, href: '',
  classList: {c: new Set(), toggle(n, v) { v ? this.c.add(n) : this.c.delete(n); }}});
const esc = s => String(s);
const icono = n => `[${n}]`;
const costoProducir = s => s * 3;
let mon = null, proyecto = null, pctPrev = 0;
__CODIGO__
const out = {};
const base = {id: 'x', progreso: {}, pipeline: 'narracion', narracion: 'hola', guion: [], brief: 'Un faro'};
// producción: los pasos avanzan y nunca retroceden
pintaPasos({...base, etapa: 'tts'}, true);
out.tts = $('#ppasos').innerHTML;
pintaPasos({...base, etapa: 'media', progreso: {escenas_total: 6, escenas_listas: 2}}, true);
out.media = $('#ppasos').innerHTML;
pintaPasos({...base, etapa: 'director'}, true);
out.atras = $('#ppasos').innerHTML;
// lo que falta
minutosProd = 10; pintaFalta(40); out.falta = $('#pfalta').textContent;
pintaFalta(95); out.casi = $('#pfalta').textContent;
minutosProd = null; pintaFalta(40); out.sinCifra = $('#pfalta').hidden;
// error al producir, con monedero
mon = {activo: true, saldo: 5, tarifas: {preparar: 10}};
fallaProducir = true;
pintaError({...base, etapa: 'media', error: 'RuntimeError: veo 503', duracion_s: 30, cobrado_producir: 90});
out.prod = {titulo: $('#etitulo').innerHTML, msg: $('#emsg').textContent,
  devol: $('#edevol').textContent, sigue: $('#esigue').textContent,
  boton: $('#reintentar').textContent, tecnico: $('#etecnico').textContent,
  denuevoSec: $('#denuevo').classList.c.has('sec'), creditosOcultos: $('#ecreditos').hidden};
// error al preparar
fallaProducir = false;
pintaError({...base, etapa: 'research', error: '', duracion_s: 30});
out.prep = {titulo: $('#etitulo').innerHTML, msg: $('#emsg').textContent,
  devol: $('#edevol').textContent, sigue: $('#esigue').textContent, href: $('#denuevo').href,
  denuevoSec: $('#denuevo').classList.c.has('sec'), tecnicoOculto: $('#etecnico-caja').hidden};
// sin monedero (dev local): no se habla de créditos
mon = {activo: false};
pintaError({...base, etapa: 'research'});
out.local = $('#ecreditos').hidden;
console.log(JSON.stringify(out));
"""


@pytest.fixture(scope="module")
def corrida(tmp_path_factory):
    node = shutil.which("node")
    if not node:
        pytest.skip("node no está instalado")
    js = _js(CREAR)
    codigo = "\n".join([
        js[js.index("const ETAPA_TXT = {"):js.index("};", js.index("const ETAPA_TXT = {")) + 2],
        js[js.index("const PASOS_PREP"):js.index("let minutosProd = null;")],
        "let minutosProd = null;",
        _bloque(js, "function pintaError(p)"),
        "let fallaProducir = false;",
    ])
    f = tmp_path_factory.mktemp("ui11") / "prueba.js"
    f.write_text(NODO.replace("__CODIGO__", codigo), encoding="utf-8")
    r = subprocess.run([node, str(f)], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout)


def test_los_pasos_de_la_produccion(corrida):
    assert "[listo]</span><span>Guion aprobado" in corrida["tts"]
    assert 'aria-current="step"><span class="marca"></span><span>Grabando la voz</span>' in corrida["tts"]
    # la etapa fina la dice el orbe (o #petapa): los pasos no la repiten
    assert "Grabando la narración" not in corrida["tts"]
    assert "<span>Animar las escenas</span>" in corrida["tts"]
    assert "Animando las escenas · 2 de 6" in corrida["media"]
    assert "Voz grabada" in corrida["media"]


def test_los_pasos_nunca_retroceden(corrida):
    assert corrida["atras"].count("aria-current") == 1
    assert "Animando las escenas" in corrida["atras"] and "Grabando la voz" not in corrida["atras"]


def test_lo_que_falta_es_aproximado_y_no_se_inventa(corrida):
    assert corrida["falta"] == "Faltan unos 6 min."
    assert corrida["casi"] == "Falta alrededor de un minuto."
    assert corrida["sinCifra"] is True


def test_error_al_producir(corrida):
    e = corrida["prod"]
    assert e["titulo"] == "[aviso]No pudimos terminar tu película"
    assert e["msg"] == "Se detuvo en «Animando las escenas». Tu guion, tu voz y tu personaje siguen guardados."
    assert e["devol"] == "Te devolvimos ✦ 90: no pagas por una película que no salió."
    assert e["boton"] == "Reintentar ✦ 90"
    assert e["sigue"].endswith("Cuesta 90 créditos y se cobran de nuevo.")
    assert e["tecnico"] == "RuntimeError: veo 503"
    assert e["denuevoSec"] is True and e["creditosOcultos"] is False


def test_error_al_preparar(corrida):
    e = corrida["prep"]
    assert e["titulo"] == "[aviso]No pudimos terminar tu guion"
    assert e["msg"].startswith("Se detuvo en «Entendiendo tu idea».")
    assert e["devol"] == "Te devolvimos ✦ 10: no pagas por un guion que no salió."
    assert e["href"] == "/crear.html?brief=Un%20faro"
    # sin nada que reintentar, «Empezar de nuevo» es el principal
    assert e["denuevoSec"] is False
    assert e["tecnicoOculto"] is True


def test_sin_monedero_no_se_habla_de_creditos(corrida):
    assert corrida["local"] is True
