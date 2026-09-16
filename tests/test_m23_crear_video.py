"""M23 · V — la pantalla de crear video, según el boceto del dueño.

Tres columnas iguales y dos filas que se invierten: estilo (1) + un cuadro de
texto al estilo del de Claude (2) arriba, formato (2) + un temporizador de
duración (1) abajo, y «Generar ✦ N» debajo. N es el precio de la película
entera y sigue al tiempo elegido.

Ese precio vive en UNA tabla de tools/tarifas.json (§video.por_duracion), y
la misma tabla decide qué duraciones acepta el servidor y cuánto cobra al
producir. Así la pantalla y el cobro no pueden contarse cosas distintas.
"""
import json
import shutil
import subprocess
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from pipeline import creditos, db, jobs
from pipeline.project import DURACION_MAX_S

RAIZ = Path(__file__).resolve().parent.parent
PAGINA = RAIZ / "static" / "crear.html"
TARIFAS = json.loads((RAIZ / "tools" / "tarifas.json").read_text(encoding="utf-8"))


# ---------------------------------------------------------------------------
# la tabla de precios

def test_la_tabla_es_la_fuente_y_no_cambio_ningun_precio():
    """Hoy la tabla es exactamente preparar + por_segundo × s: la película de
    30 s sigue costando 100, como promete docs/ECONOMIA.md."""
    v = TARIFAS["video"]
    tabla = {int(s): n for s, n in v["por_duracion"].items()}
    assert tabla == creditos.precios_por_duracion()
    for s, n in tabla.items():
        assert n == v["preparar"] + v["por_segundo"] * s, f"{s} s cambió de precio"
    assert tabla[30] == 100


def test_la_tabla_es_elegible_de_verdad():
    """Pasos de 5 s (el reloj suma y resta 5), nada por encima del tope del
    pipeline, cada total paga al menos el guion y más tiempo nunca cuesta menos."""
    tabla = creditos.precios_por_duracion()
    duraciones = sorted(tabla)
    assert duraciones[0] == 15 and duraciones[-1] == DURACION_MAX_S
    assert all(s % 5 == 0 for s in duraciones)
    assert all(b - a == 5 for a, b in zip(duraciones, duraciones[1:])), "hay huecos en la tabla"
    # estrictamente mayor: un total igual al guion haría gratis la producción
    assert all(n > creditos.costo_preparar() for n in tabla.values())
    precios = [tabla[s] for s in duraciones]
    assert precios == sorted(precios)


def test_producir_cobra_la_tabla_menos_el_guion(monkeypatch):
    """Editar un número de la tabla cambia lo que se cobra al producir."""
    monkeypatch.setattr(creditos, "PRECIO_POR_DURACION", {30: 80, 60: 150})
    assert creditos.costo_producir(30) == 80 - creditos.costo_preparar()
    assert creditos.costo_producir(60.0) == 150 - creditos.costo_preparar()
    # fuera de la tabla (proyectos de antes): por segundo, hacia arriba
    assert creditos.costo_producir(45) == 45 * creditos.VIDEO_CR_POR_SEGUNDO
    assert creditos.costo_producir(30.5) == 92


def test_la_tabla_descarta_lo_que_no_se_puede_producir():
    """Una llave fuera de 15-60 s se cobraría con su precio y se produciría
    recortada; una mal escrita no puede tumbar el arranque de la API."""
    crudo = {"30": 100, "90": 280, "10": 40, "0:45": 145, "50": "caro", "60": "190"}
    assert creditos._tabla_de(crudo) == {30: 100, 60: 190}
    assert creditos._tabla_de(None) == {}


def test_sin_tabla_sale_de_la_formula(monkeypatch):
    monkeypatch.setattr(creditos, "PRECIO_POR_DURACION", {})
    tabla = creditos.precios_por_duracion()
    assert sorted(tabla) == list(range(15, 61, 5))
    assert tabla[30] == creditos.costo_preparar() + 30 * creditos.VIDEO_CR_POR_SEGUNDO


# ---------------------------------------------------------------------------
# lo que se devuelve es lo que se cobró, no la tabla del momento

def _proyecto(**extra):
    return SimpleNamespace(id="p1", estado="revision", etapa="", error=None, progreso={},
                           workdir=Path("."), duracion_s=30, tiene_guion=lambda: True,
                           personaje=SimpleNamespace(url_elegida="opciones/a.png"),
                           guardar=lambda: None, **extra)


@pytest.fixture
def api(monkeypatch):
    from server import app as srv
    monkeypatch.setenv("STATE_BACKEND", "postgres")
    monkeypatch.setattr(jobs, "backend", lambda: "aws")
    monkeypatch.setattr(jobs, "lanzar_produccion", lambda u, i, fase="todo": None)
    monkeypatch.setattr(creditos, "activo", lambda: True)
    movs = SimpleNamespace(cobros=[], devueltos=[])
    monkeypatch.setattr(creditos, "cobrar", lambda n, ref: movs.cobros.append(n) or 0)
    monkeypatch.setattr(creditos, "devolver", lambda n, ref, u=None: movs.devueltos.append(n) or n)
    monkeypatch.setattr(db, "reclamar_produccion", lambda u, i, desde=None: True)
    monkeypatch.setattr(db, "liberar_produccion", lambda u, i, e: None)
    movs.srv, movs.cliente = srv, TestClient(srv.app, raise_server_exceptions=False)
    return movs


def test_producir_guarda_lo_que_cobro(api, monkeypatch):
    p = _proyecto()
    monkeypatch.setattr(api.srv, "_proyecto", lambda i: p)
    assert api.cliente.post("/api/proyectos/p1/producir").status_code == 200
    assert api.cobros == [90] and p.cobrado_producir == 90


def test_cancelar_devuelve_sobre_lo_cobrado(api, monkeypatch):
    """Se cobraron 90 y después la tabla subió el precio de 30 s. «Mejor no»
    devuelve sobre los 90, no sobre el precio nuevo."""
    p = _proyecto(cobrado_producir=90)
    p.estado, p.progreso = "imagenes", {"imagenes": [{"id": "1"}]}
    monkeypatch.setattr(api.srv, "_proyecto", lambda i: p)
    monkeypatch.setattr(creditos, "PRECIO_POR_DURACION", {30: 130})
    r = api.cliente.post("/api/proyectos/p1/cancelar")
    assert r.status_code == 200
    assert api.devueltos == [90 - creditos.costo_imagen()]


@pytest.mark.parametrize("cobrado,esperado", [(70, 70), (None, 90)])
def test_el_worker_devuelve_lo_cobrado(monkeypatch, tmp_path, cobrado, esperado):
    """Con el número guardado se devuelve ese; una producción cobrada antes de
    guardarlo cae a la tarifa de hoy (30 s → 90)."""
    monkeypatch.setenv("DEFAULT_USER_ID", "piloto")
    from pipeline import costes_infra, flow, media_sync
    from pipeline import project as project_mod
    p = SimpleNamespace(estado="error", workdir=tmp_path, progreso={}, duracion_s=30,
                        error=None, cobrado_producir=cobrado)

    async def producir(proy, fase="todo"):
        pass
    monkeypatch.setattr(flow, "producir", producir)
    monkeypatch.setattr(media_sync, "bajar_prefijo", lambda pref, d: 0)
    monkeypatch.setattr(media_sync, "subir_dir", lambda d, pref: 0)
    monkeypatch.setattr(project_mod, "cargar_proyecto", lambda id_: p)
    monkeypatch.setattr(costes_infra, "registrar", lambda *a: None)
    monkeypatch.setattr(costes_infra, "costo_fargate", lambda s: 0.0)
    monkeypatch.setattr(creditos, "activo", lambda: True)
    devueltos = []
    monkeypatch.setattr(creditos, "devolver", lambda n, ref, u=None: devueltos.append(n) or n)
    from worker import producir_task
    assert producir_task.main("sub", "p1", "todo") == 1
    assert devueltos == [esperado]


def test_el_proyecto_guarda_el_cobro():
    from pipeline.project import Proyecto
    p = Proyecto(id="x", creado="2026-09-16T00:00:00", brief="b")
    assert p.cobrado_producir is None
    doc = {**p.model_dump(), "cobrado_producir": 90}
    assert Proyecto.model_validate(doc).cobrado_producir == 90


# ---------------------------------------------------------------------------
# el servidor

@pytest.fixture
def centinela(monkeypatch):
    """nuevo_proyecto responde 418: prueba hasta dónde llegó la petición sin
    crear nada (mismo truco que test_m12_hub y test_m22_formato)."""
    from fastapi import HTTPException

    from server import app as srv
    visto = {}

    def _boom(*a, **k):
        visto.update(args=a, **k)
        raise HTTPException(418, "hasta aquí")
    monkeypatch.setattr(srv, "nuevo_proyecto", _boom)
    return visto


@pytest.mark.parametrize("duracion", ["0", "1", "32", "90", "-15"])
def test_una_duracion_sin_precio_se_rechaza_antes_de_gastar(monkeypatch, centinela, duracion):
    cobros = []
    monkeypatch.setattr(creditos, "cobrar", lambda *a, **k: cobros.append(a))
    from server.app import app
    r = TestClient(app).post("/api/proyectos", data={"brief": "una idea", "duracion_s": duracion})
    assert r.status_code == 422
    assert "30 s" in r.json()["detail"], "el aviso no dice qué duraciones hay"
    assert not centinela and not cobros


@pytest.mark.parametrize("duracion", ["15", "30", "60"])
def test_las_duraciones_de_la_tabla_pasan(centinela, duracion):
    from server.app import app
    r = TestClient(app).post("/api/proyectos", data={"brief": "una idea", "duracion_s": duracion})
    assert r.status_code == 418
    assert centinela["args"][3] == int(duracion)


def test_sin_duracion_sigue_valiendo_el_default(centinela):
    """El hub y los clientes viejos no mandan duración: 45 s está en la tabla."""
    from server.app import app
    r = TestClient(app).post("/api/proyectos", data={"brief": "una idea"})
    assert r.status_code == 418 and centinela["args"][3] == 45


def test_el_monedero_trae_la_tabla(monkeypatch):
    monkeypatch.setenv("CREDITOS_BACKEND", "postgres")
    monkeypatch.setattr(db, "saldo_creditos", lambda u: 42)
    monkeypatch.setattr(db, "movimientos_creditos", lambda u, n=20: [])
    from server.app import app
    t = TestClient(app).get("/api/creditos").json()["tarifas"]
    assert t["video_por_duracion"] == {str(s): n for s, n in creditos.precios_por_duracion().items()}
    assert t["preparar"] == creditos.costo_preparar()


# ---------------------------------------------------------------------------
# la pantalla

@pytest.fixture(scope="module")
def html():
    return PAGINA.read_text(encoding="utf-8")


def _js(html):
    return html[html.index("<script>\nconst $"):html.rindex("</script>")]


def _bloque(js, inicio):
    """Desde `inicio` hasta la llave que lo cierra."""
    i = js.index(inicio)
    j = js.index("{", i)
    nivel = 0
    for k in range(j, len(js)):
        nivel += {"{": 1, "}": -1}.get(js[k], 0)
        if nivel == 0:
            return js[i:k + 1]
    raise AssertionError(f"sin cierre: {inicio}")


def test_la_cuadricula_es_la_del_boceto(html):
    assert "grid-template-columns:repeat(3, minmax(0, 1fr))" in html
    for clase, columnas in [("p-estilo", "1 / 2"), ("p-prompt", "2 / 4"),
                            ("p-formato", "1 / 3"), ("p-duracion", "3 / 4")]:
        assert f".{clase} {{ grid-column:{columnas}; }}" in html, clase


def test_en_el_telefono_se_apila_en_el_orden_del_boceto(html):
    """Una columna sigue el orden del documento: estilo, prompt, formato,
    duración y el botón."""
    form = html[html.index('<section id="form">'):html.index('<section id="progreso"')]
    orden = [form.index(m) for m in ('class="card p-estilo"', 'class="card p-prompt',
                                     'class="card p-formato"', 'class="card p-duracion"',
                                     'id="enviar"')]
    assert orden == sorted(orden)
    movil = html[html.index("@media (max-width: 900px)"):]
    assert "grid-template-columns:minmax(0, 1fr)" in movil[:movil.index("\n  }")]


def test_el_estilo_se_conserva_con_su_muestra(html):
    assert 'id="estilos" role="radiogroup"' in html
    assert 'id="muestra-img"' in html and "/estilos/${estilo}.jpg" in html
    assert "Estilo visual</h2>" in html


def test_el_cuadro_de_texto_es_uno_solo(html):
    caja = html[html.index('id="caja"'):html.index('class="card p-formato"')]
    assert 'placeholder="Describe tu video…"' in caja
    assert 'id="adjuntos" hidden' in caja, "sin imagen la fila de la miniatura no se ve"
    assert caja.index('id="adjuntos"') < caja.index('id="brief"') < caja.index('id="mas"')
    assert 'id="files"' in caja and 'id="pextra"' in caja
    # sin flecha de enviar: eso lo hace «Generar»
    assert "➤" not in caja and "↑" not in caja and "enviar" not in caja.lower()
    assert ".miniatura { position:relative; width:88px; height:88px;" in html


def test_la_imagen_se_quita_y_se_limita_a_cuatro(html):
    js = _js(html)
    assert "const MAX_REFS = 4;" in js
    pinta = _bloque(js, "function pintaAdjuntos()")
    assert "$('#adjuntos').hidden = !files.length;" in pinta
    assert "$('#mas').disabled = files.length >= MAX_REFS;" in pinta
    assert "files.splice(+b.dataset.i, 1);" in _bloque(js, "$('#miniaturas').onclick")
    # pegar texto gana sobre pegar el dibujo de la tabla
    assert "d.types.includes('text/plain')" in js


def test_formato_alinea_los_titulos(html):
    for fmt, sub in [("horizontal", "YouTube · 16:9"), ("vertical", "Reels · TikTok · Shorts · 9:16")]:
        tarjeta = html[html.index(f'data-fmt="{fmt}"'):]
        tarjeta = tarjeta[:tarjeta.index("</button>")]
        assert '<span class="fmt-hueco">' in tarjeta, f"{fmt}: el icono no vive en su hueco fijo"
        assert sub in tarjeta
    assert ".fmt-hueco { height:40px;" in html
    assert "grid-template-rows:subgrid" in html
    assert "Se elige ahora y no se puede cambiar después." in html


def test_el_temporizador(html):
    duracion = html[html.index('class="card p-duracion"'):html.index('id="enviar"')]
    assert 'id="dur-menos"' in duracion and 'id="dur-mas"' in duracion
    assert 'role="spinbutton"' in duracion and 'id="durv">0:30<' in duracion
    assert 'pathLength="100"' in duracion
    assert "Costo aprox.: <b>✦ <span id=\"durcosto\">" in duracion
    js = _js(html)
    assert "let dur = 30;" in js
    assert "const DUR_BASE = [15, 20, 25, 30, 35, 40, 45, 50, 55, 60];" in js


def test_el_boton_dice_el_precio_de_la_duracion(html):
    js = _js(html)
    costos = _bloque(js, "function pintaCostos()")
    assert "total = precioDe(dur)" in costos
    assert "`Generar ✦ ${total}`" in costos
    # y explica que se cobra en dos partes
    assert "al empezar y ${total - prep} al producir" in costos
    # al empezar solo tiene que alcanzar el guion
    assert "const falta = prep - mon.saldo;" in costos
    # la duración se ajusta a la tabla ANTES de leer su precio
    assert costos.index("pintaDur();") < costos.index("precioDe(dur)")
    assert ".btn.generar { width:calc((100% - 24px) / 3);" in html


def test_el_pedido_se_arma_antes_de_moderar(html):
    envio = _bloque(_js(html), "$('#enviar').onclick")
    assert "fd.append('duracion_s', dur)" in envio
    assert envio.index("new FormData()") < envio.index("guardrail(")
    assert "guardrail(fd.get('brief')" in envio
    # nada de la cuadrícula cambia mientras vuela, y fin() lo suelta
    assert "$('.rejilla').inert = true;" in envio
    assert "$('.rejilla').inert = false;" in _bloque(envio, "const fin = msg =>")


def test_lo_que_explica_el_boton_va_pegado_a_el(html):
    """Orbe, saldo y error bajo el botón y antes de la nota del cobro: en una
    pantalla de 657 px la nota puede quedar fuera; el motivo de un botón
    apagado, no."""
    form = html[html.index('id="enviar"'):html.index('<section id="progreso"')]
    marcas = ('id="orbe-form"', 'id="saldoform"', 'id="ferr"', 'id="cobronota"')
    orden = [form.index(m) for m in marcas]
    assert orden == sorted(orden)
    assert 'id="ferr" role="alert"' in form
    assert "$('#ferr').scrollIntoView({block: 'nearest'});" in html


def test_en_escritorio_queda_centrada_en_alto(html):
    """Filas 1fr arriba y abajo con alto FIJO (con min-height la fila de arriba
    copia a la de abajo y todo baja), y lo que sale bajo el botón vive en la
    fila de abajo para no mover la cuadrícula."""
    escritorio = html[html.index("@media (min-width: 901px)"):]
    escritorio = escritorio[:escritorio.index("\n  }\n")]
    assert "grid-template-rows:1fr auto auto auto 1fr;" in escritorio
    assert "height:calc(100dvh - 24px)" in escritorio and "min-height" not in escritorio
    assert "#form > .estado-envio { grid-row:5; align-self:start; }" in escritorio
    estado = html[html.index('<div class="estado-envio">'):html.index("</section>")]
    for pieza in ('id="orbe-form"', 'id="saldoform"', 'id="ferr"', 'id="cobronota"'):
        assert pieza in estado, pieza


def test_tus_peliculas_ya_no_vive_en_crear(html):
    """Decisión del dueño: la pantalla de crear es solo configurar. Las
    películas hechas se retoman desde el inicio, que ya las lista."""
    for resto in ('id="mispelis"', "lista-pelis", "cargarPeliculas", "ESTADO_PELI"):
        assert resto not in html, resto
    inicio = (RAIZ / "static" / "index.html").read_text(encoding="utf-8")
    assert "'/crear.html?p=' + c.dataset.p" in inicio, "el inicio perdió el camino de vuelta"


def test_el_estilo_personalizado_no_agranda_la_fila(html):
    muestra = html[html.index('<div class="muestra">'):html.index('<!-- Un solo cuadro')]
    assert '<textarea id="estilo_custom"' in muestra
    assert ".muestra textarea { position:absolute; inset:0;" in html


def test_solo_configuracion_y_revision_son_anchas(html):
    js = _js(html)
    assert "classList.toggle('wide', id === 'form' || id === 'revision')" in js
    assert "classList.add('wide')" not in js


def test_el_modo_elegido_se_explica_a_la_vista(html):
    fijar = _bloque(_js(html), "function fijarModo(id)")
    assert "$('#modonota').hidden = modo === 'auto';" in fijar
    assert 'id="modonota" hidden' in html


def test_sin_lista_de_estilos_se_avisa(html):
    js = _js(html)
    estilos = js[js.index("fetch('/api/estilos')"):]
    estilos = estilos[:estilos.index("\n});") + 5]
    assert ".catch(() => {" in estilos
    assert "Tu video saldrá en Animado" in estilos


def test_reintentar_cobra_con_la_misma_tabla(html):
    error = _bloque(_js(html), "function pintaError(p)")
    assert "costoProducir(p.duracion_s)" in error
    assert "video_por_segundo" not in error


def test_la_idea_del_hub_llega_al_cuadro(html):
    js = _js(html)
    assert "$('#brief').value = briefQ" in js
    assert "if (modoQ) fijarModo(modoQ);" in js
    assert "card-brief" not in html and "card-modo" not in html


# ---------------------------------------------------------------------------
# el temporizador, corriendo de verdad en node contra un DOM mínimo

NODO = r"""
const els = {};
const el = id => els[id] || (els[id] = {id, textContent: '', hidden: false, disabled: false,
  attrs: {}, setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k]; },
  addEventListener(t, f) { this['on' + t] = f; }});
const $ = s => el(s.replace('#', ''));
let mon = null, enVuelo = false, pintados = 0;
function pintaCostos() { pintados++; }
__BLOQUE__
const foto = () => ({dur, txt: els.durv.textContent, aro: els.aro.attrs['stroke-dasharray'],
  menos: els['dur-menos'].disabled, mas: els['dur-mas'].disabled, fila: els['costo-fila'].hidden,
  costo: els.durcosto.textContent, texto: els.reloj.attrs['aria-valuetext']});
const out = {};
out.inicio = foto();
for (let i = 0; i < 20; i++) els['dur-mas'].onclick();
out.tope = foto();
els.reloj.onkeydown({key: 'Home', preventDefault() {}});
out.piso = foto();
const tabla = {"15": 55, "20": 70, "25": 85, "30": 100, "35": 115, "40": 130, "45": 145, "50": 160, "55": 175, "60": 190};
mon = {activo: true, saldo: 50, tarifas: {preparar: 10, video_por_segundo: 3, video_por_duracion: tabla}};
dur = 30; pintaDur();
out.conTabla = foto();
out.producir = costoProducir(30);
out.viejo = precioDe(47);
mon.tarifas.video_por_duracion = {"20": 60, "40": 120};
pintaDur();
out.recortada = foto();
enVuelo = true; const antes = pintados; els['dur-mas'].onclick();
out.enVuelo = {dur, pintados: pintados - antes};
console.log(JSON.stringify(out));
"""


@pytest.mark.skipif(shutil.which("node") is None, reason="node no está en el PATH")
def test_el_temporizador_en_node(html, tmp_path):
    js = _js(html)
    bloque = js[js.index("const DUR_BASE"):js.index("pintaDur();\n", js.index("$('#reloj').addEventListener")) + 11]
    script = tmp_path / "reloj.js"
    script.write_text(NODO.replace("__BLOQUE__", bloque), encoding="utf-8")
    r = subprocess.run(["node", str(script)], capture_output=True, text=True, encoding="utf-8")
    assert r.returncode == 0, r.stderr
    o = json.loads(r.stdout)
    # sin monedero: el rango del servidor, 0:30 y sin fila de costo
    assert o["inicio"] == {"dur": 30, "txt": "0:30", "aro": "50.00 100", "menos": False, "mas": False,
                           "fila": True, "costo": "", "texto": "30 segundos"}
    # el + se detiene en el máximo, que llena el aro
    assert o["tope"]["txt"] == "1:00" and o["tope"]["mas"] and not o["tope"]["menos"]
    assert o["tope"]["aro"] == "100.00 100" and o["tope"]["texto"] == "1 minuto"
    assert o["piso"]["txt"] == "0:15" and o["piso"]["menos"] and o["piso"]["aro"] == "25.00 100"
    # con la tabla: el costo es el total y producir es el total menos el guion
    assert o["conTabla"]["costo"] == 100 and o["conTabla"]["fila"] is False
    assert o["producir"] == 90
    assert o["viejo"] == 10 + 3 * 47
    # si la tabla pierde el 30, el reloj cae en la duración más cercana
    assert o["recortada"]["dur"] == 20 and o["recortada"]["aro"] == "50.00 100"
    assert o["recortada"]["menos"] and not o["recortada"]["mas"]
    # en vuelo el reloj no se mueve
    assert o["enVuelo"] == {"dur": 20, "pintados": 0}
