"""UI·15 — «Tus trabajos», el cuadro de abajo a la derecha (dueño, 25-sep).

Lo que se defiende aquí:
- cada tipo de trabajo dice qué es, en qué va y a dónde llevar al usuario;
- lo terminado se ve 24 horas y lo colgado no se anuncia como vivo;
- una película que falló dice los MISMOS créditos devueltos que crear;
- lo que cuesta leer (S3) se recorta por fecha antes de abrir nada;
- el cuadro va en las doce pantallas, plegado, y no repite lo que la pantalla
  ya enseña.
"""
import json
import os
import shutil
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from pipeline import project
from pipeline.project import EscenaGuion, OpcionPersonaje, Personaje, Proyecto
from server import trabajos_api as tj

RAIZ = Path(__file__).resolve().parent.parent
JS = (RAIZ / "static" / "trabajos.js").read_text(encoding="utf-8")
AHORA = time.time()


def _iso(t):
    return datetime.fromtimestamp(t, timezone.utc).isoformat(timespec="seconds")


def _p(**kw):
    base = dict(id="p1", creado="2026-09-25", brief="Un faro en la tormenta", duracion_s=30)
    base.update(kw)
    return Proyecto(**base)


# ---------------------------------------------------------------------------
# películas

def test_pelicula_produciendo_dice_el_paso_y_el_avance():
    f = tj.ficha_pelicula(_p(estado="produciendo", etapa="media",
                             progreso={"escenas_total": 6, "escenas_listas": 2}), AHORA)
    assert f["estado"] == "corriendo" and f["titulo"] == "Produciendo «Un faro en la tormenta»"
    assert f["detalle"] == "Animando las escenas · 2 de 6" and f["progreso"] == 33
    assert f["url"] == "/crear.html?p=p1"


def test_pelicula_preparando_sin_barra_inventada():
    f = tj.ficha_pelicula(_p(estado="preparando", etapa="research"), AHORA)
    assert f["detalle"] == "Entendiendo tu idea" and f["progreso"] is None


@pytest.mark.parametrize("estado,titulo", [
    ("revision", "Tu guion está listo para revisar"),
    ("imagenes", "Tus escenas están listas para aprobar"),
    ("listo", "Tu película está lista"),
])
def test_pelicula_terminada(estado, titulo):
    f = tj.ficha_pelicula(_p(estado=estado), AHORA)
    assert f["estado"] == "listo" and f["titulo"] == titulo


def test_pelicula_creada_no_es_trabajo():
    assert tj.ficha_pelicula(_p(estado="creado"), AHORA) is None


def test_fallo_al_producir_devuelve_lo_cobrado(monkeypatch):
    monkeypatch.setattr(tj.creditos, "activo", lambda: True)
    p = _p(estado="error", etapa="media", pipeline="narracion", narracion="Había una vez.",
           personaje=Personaje(opciones=[OpcionPersonaje(url="a", path="a")], elegida=0),
           cobrado_producir=90)
    f = tj.ficha_pelicula(p, AHORA)
    assert f["estado"] == "error" and f["devueltos"] == 90
    assert f["detalle"] == "En «Animando las escenas»."


def test_fallo_al_preparar_devuelve_la_preparacion(monkeypatch):
    monkeypatch.setattr(tj.creditos, "activo", lambda: True)
    f = tj.ficha_pelicula(_p(estado="error", etapa="research",
                             guion=[EscenaGuion(id="1", narracion="")]), AHORA)
    assert f["devueltos"] == tj.creditos.costo_preparar()
    assert f["detalle"] == "En «Entendiendo tu idea»."


def test_sin_monedero_no_se_habla_de_creditos(monkeypatch):
    monkeypatch.setattr(tj.creditos, "activo", lambda: False)
    assert tj.ficha_pelicula(_p(estado="error"), AHORA)["devueltos"] is None


def test_el_id_cambia_con_cada_corrida():
    """Cerrar el aviso de una corrida no esconde el de la siguiente."""
    a = tj.ficha_pelicula(_p(estado="listo"), AHORA)
    b = tj.ficha_pelicula(_p(estado="listo"), AHORA + 60)
    assert a["id"] != b["id"]


# ---------------------------------------------------------------------------
# editor: propuesta de corte y shorts

def test_editor_corriendo_listo_y_colgado():
    doc = {
        "editar": {"estado": "corriendo", "inicio": _iso(AHORA - 60)},
        "shorts": {"estado": "candidatos", "inicio": _iso(AHORA - 900), "listo": _iso(AHORA - 600),
                   "render": {"estado": "corriendo", "inicio": _iso(AHORA - 5 * 3600),
                              "segmentos": [{}, {}, {}]}},
    }
    fs = {f["tipo"]: f for f in tj.fichas_editor("podcast", doc, AHORA - 24 * 3600, AHORA)}
    assert fs["editar"]["estado"] == "corriendo" and fs["editar"]["url"] == "/e1.html?p=podcast"
    assert fs["analizar"]["titulo"] == "Tus candidatos a shorts están listos"
    assert "render" not in fs      # 5 h «corriendo» es un colgado: no se anuncia como vivo


def test_editor_listo_lleva_al_editor_y_lo_viejo_no_sale():
    desde = AHORA - 24 * 3600
    listo = {"editar": {"estado": "listo", "inicio": _iso(AHORA - 700), "fin": _iso(AHORA - 600)}}
    f = tj.fichas_editor("mi video", listo, desde, AHORA)[0]
    assert f["url"] == "/editor/mi%20video/" and f["estado"] == "listo"
    viejo = {"editar": {"estado": "listo", "inicio": _iso(AHORA - 30 * 3600), "fin": _iso(AHORA - 29 * 3600)}}
    assert tj.fichas_editor("x", viejo, desde, AHORA) == []


def test_render_en_curso_cuenta_los_shorts():
    doc = {"shorts": {"estado": "candidatos", "listo": _iso(AHORA - 60),
                      "render": {"estado": "corriendo", "inicio": _iso(AHORA - 30), "segmentos": [{}, {}, {}]}}}
    fs = {f["tipo"]: f for f in tj.fichas_editor("n", doc, AHORA - 86400, AHORA)}
    assert fs["render"]["titulo"] == "Renderizando 3 shorts"


# ---------------------------------------------------------------------------
# S3: clips, estilos, competencia

def test_s3_clip_estilo_competencia():
    clip = tj.ficha_s3("clip", "clip-1", {"estado": "generando", "inicio": _iso(AHORA - 30),
                                          "texto": "Mi perro en la playa"}, AHORA)
    assert clip["estado"] == "corriendo" and clip["url"] == "/clip.html"
    est = tj.ficha_s3("estilo", "ig-1", {"estado": "listo", "inicio": _iso(AHORA - 90),
                                         "listo": _iso(AHORA - 30), "url": "https://instagram.com/reel/x"}, AHORA)
    assert est["titulo"] == "Tu perfil de estilo está listo"
    comp = tj.ficha_s3("competencia", "inf-1", {"estado": "error", "inicio": _iso(AHORA - 60),
                                                "devueltos": 6, "cuentas": [{"cuenta": "@rival"}]}, AHORA)
    assert comp["estado"] == "error" and comp["devueltos"] == 6 and comp["detalle"] == "@rival"


def test_s3_se_recorta_por_fecha_antes_de_abrir(monkeypatch):
    abiertos = []
    monkeypatch.setattr(tj.media_sync, "listar_prefijo_con_fecha", lambda pre: [
        (pre + "nuevo.json", AHORA - 60), (pre + "viejo.json", AHORA - 30 * 3600)])
    monkeypatch.setattr(tj.media_sync, "leer_texto",
                        lambda k: abiertos.append(k) or json.dumps({"estado": "listo", "listo": _iso(AHORA - 60)}))
    assert [r for r, _ in tj._recientes_s3("u/", AHORA - 24 * 3600)] == ["nuevo"]
    assert abiertos == ["u/nuevo.json"]


def test_la_consulta_de_peliculas_usa_la_ventana_y_el_cast():
    src = (RAIZ / "pipeline" / "db.py").read_text(encoding="utf-8")
    i = src.index("def proyectos_recientes")
    cuerpo = src[i:src.index("\ndef ", i + 10)]
    assert "make_interval(mins => :m::int)" in cuerpo
    assert "estado IN ('preparando', 'produciendo')" in cuerpo
    # del editor solo las tres corridas, no el doc entero
    i = src.index("def corridas_editor")
    assert "doc->'editar'" in src[i:src.index("\ndef ", i + 10)]


# ---------------------------------------------------------------------------
# el endpoint, con el backend local (JSON en disco)

def test_endpoint_local(monkeypatch, tmp_path):
    monkeypatch.setattr(project, "settings", SimpleNamespace(work_dir=tmp_path))
    _p(id="nuevo", estado="produciendo", etapa="tts").guardar()
    _p(id="listo", estado="listo").guardar()
    _p(id="viejo", estado="listo").guardar()
    hace = AHORA - 30 * 3600
    os.utime(tmp_path / "viejo" / "proyecto.json", (hace, hace))
    _p(id="arch", estado="listo", archivado=True).guardar()
    from server.app import app
    d = TestClient(app).get("/api/trabajos").json()
    ids = [t["id"].split(":")[1] for t in d["trabajos"]]
    assert ids == ["nuevo", "listo"]      # lo que corre primero; lo viejo y lo archivado, fuera
    assert d["sondeo_s"] == 15 and d["horas_visible"] == 24


# ---------------------------------------------------------------------------
# el cuadro en las pantallas

PANTALLAS = ["index", "crear", "imagenes", "clip", "e1", "shorts", "estilos",
             "agenda", "metricas", "competencia", "mix", "admin"]


@pytest.mark.parametrize("nombre", PANTALLAS)
def test_va_en_todas_las_pantallas_despues_del_monedero(nombre):
    html = (RAIZ / "static" / f"{nombre}.html").read_text(encoding="utf-8")
    assert html.index('src="/monedero.js"') < html.index('src="/trabajos.js"')


@pytest.mark.parametrize("nombre", ["e1", "shorts"])
def test_las_subidas_salen_en_el_cuadro(nombre):
    html = (RAIZ / "static" / f"{nombre}.html").read_text(encoding="utf-8")
    assert 'window.trabajos?.local("subida", {' in html and "no cierres esta pestaña" in html
    assert 'window.trabajos?.local("subida", null)' in html


def test_plegado_por_defecto_y_lo_del_servidor_escapado():
    assert "abierto = false" in JS
    # títulos y detalles traen el brief del usuario: siempre por esc()
    assert "${esc(t.titulo)}" in JS and "esc(t.detalle" in JS
    # solo sondea mientras algo corre y la pestaña se ve
    assert "remotos.some(t => t.estado === 'corriendo') && !document.hidden" in JS


NODO = r"""
__CODIGO__
const P = globalThis.trabajosPuro;
const loc = {origin: 'http://x', pathname: '/index.html', search: ''};
const L = [
  {id: 'a', estado: 'corriendo', url: '/crear.html?p=1', progreso: 40},
  {id: 'b', estado: 'corriendo', url: '/shorts.html?p=n', progreso: null},
  {id: 'c', estado: 'listo', url: '/clip.html'},
  {id: 'd', estado: 'error', url: '/crear.html?p=2'},
];
const out = {};
out.todos = P.visibles(L, {}, loc).map(t => t.id);
out.cerrado = P.visibles(L, {c: 1}, loc).map(t => t.id);
out.corriendoNoSeCierra = P.visibles(L, {a: 1}, loc).map(t => t.id);
out.enClip = P.visibles(L, {}, {origin: 'http://x', pathname: '/clip.html', search: ''}).map(t => t.id);
out.enCrear1 = P.visibles(L, {}, {origin: 'http://x', pathname: '/crear.html', search: '?p=1'}).map(t => t.id);
out.resumen = P.resumen(L);
out.soloListo = P.resumen([L[2]]).pildora;
out.soloFallo = P.resumen([L[3]]).pildora;
out.nuevos = P.nuevos(L, {c: 1});
out.podado = Object.keys(P.podar({viejo: Date.now() - 49 * 3600e3, nuevo: Date.now()}, Date.now()));
console.log(JSON.stringify(out));
"""


@pytest.fixture(scope="module")
def corrida(tmp_path_factory):
    node = shutil.which("node")
    if not node:
        pytest.skip("node no está instalado")
    f = tmp_path_factory.mktemp("ui15") / "p.js"
    f.write_text(NODO.replace("__CODIGO__", JS), encoding="utf-8")
    r = subprocess.run([node, str(f)], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout)


def test_lo_que_se_ve(corrida):
    assert corrida["todos"] == ["a", "b", "c", "d"]
    assert corrida["cerrado"] == ["a", "b", "d"]
    assert corrida["corriendoNoSeCierra"] == ["a", "b", "c", "d"]


def test_no_repite_lo_que_la_pantalla_ya_ensena(corrida):
    assert corrida["enClip"] == ["a", "b", "d"]          # clip ya lista sus clips
    assert corrida["enCrear1"] == ["b", "c", "d"]        # la película 1 ya está en pantalla


def test_la_pildora(corrida):
    r = corrida["resumen"]
    assert r["pildora"] == "2 trabajos en curso" and r["texto"] == "2 en curso · 1 listo · 1 falló"
    assert r["avance"] == 40                              # solo promedia lo que tiene avance real
    assert corrida["soloListo"] == "1 trabajo listo" and corrida["soloFallo"] == "Un trabajo falló"


def test_se_abre_solo_con_lo_no_visto(corrida):
    assert corrida["nuevos"] == ["d"]
    assert corrida["podado"] == ["nuevo"]
