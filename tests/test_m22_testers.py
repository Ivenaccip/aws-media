"""M22 — lo que reportaron los testers: el cobro sin piso y la liga invisible.

Los dos salen del mismo reporte del 2026-09-14 (laboratoriovisnity@gmail.com) y
los dos se verificaron en la base antes de escribir una línea de código:

    02:02:34   -4  cargo       editar-sugerir:1
    02:02:52   -4  cargo       shorts-analizar:1
    02:03:27   +4  devolucion  shorts-analizar:1

Ocho cobrados, cuatro devueltos — «la mitad», como lo contó ella. El proyecto
era un video de SEIS SEGUNDOS: shorts falló honestamente y devolvió; la corrida
de sugerencias terminó «listo» con 0 cortes, 0 fluff y 0 flags, y como no hubo
excepción nadie le devolvió nada.

Estos tests fijan las dos mitades del arreglo (nada se cobra fuera de rango; una
corrida que no entrega nada devuelve) y que el campo de la liga no vuelva a
esconderse detrás de una condición de la URL.
"""
import json
import re
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from pipeline import creditos, db, jobs, media_sync
from server import editar_api, shorts_api

RAIZ = Path(__file__).resolve().parent.parent
DOC = {"flags": {"generado": True},
       "subidas": [{"key": "videos/v1/subidas/charla.mp4", "bytes": 9}]}
SEIS_SEGUNDOS = 6.0      # el clip exacto del reporte


@pytest.fixture
def nube(monkeypatch, tmp_path):
    """Espejo del fixture de test_m8_shorts, con la duración como parámetro."""
    monkeypatch.delenv("COGNITO_POOL_ID", raising=False)
    monkeypatch.setenv("STATE_BACKEND", "postgres")
    monkeypatch.setenv("MEDIA_ROOT", str(tmp_path))
    monkeypatch.setenv("CDN_BASE", "https://cdn.example.com")
    monkeypatch.setenv("ASSEMBLYAI_API_KEY", "test")
    docs = {"v1": json.loads(json.dumps(DOC))}
    monkeypatch.setattr(db, "cargar_proyecto_editor", lambda u, n: docs.get(n))
    monkeypatch.setattr(db, "fijar_campo_editor", lambda u, n, c, v: None)
    monkeypatch.setattr(db, "guardar_proyecto_editor", lambda u, n, v: None)
    monkeypatch.setattr(db, "reservar_nombre_editor", lambda u, n: True)
    monkeypatch.setattr(db, "nombre_editor_ajeno", lambda u, n: False)
    monkeypatch.setattr(media_sync, "listar_prefijo",
                        lambda pre: [f"{pre}charla.canonical.json"])
    monkeypatch.setattr(creditos, "activo", lambda: True)
    cobros = []
    monkeypatch.setattr(creditos, "cobrar",
                        lambda n, ref, u=None: cobros.append((n, ref)) or 1)
    monkeypatch.setattr(jobs, "encolar_shorts_analizar", lambda u, n: None)
    monkeypatch.setattr(jobs, "lanzar_editar", lambda u, n: None)
    from server.app import app
    cliente = TestClient(app)
    cliente.cobros = cobros
    # editar_api hizo `from server.shorts_api import _duracion_s`, así que tiene
    # su PROPIA referencia: parchear solo shorts_api dejaría a editar midiendo
    # de verdad, contra un CDN que no existe.
    def dura(s):
        for mod in (shorts_api, editar_api):
            monkeypatch.setattr(mod, "_duracion_s", lambda key: s)
    cliente.dura = dura
    cliente.dura(SEIS_SEGUNDOS)
    return cliente


# ---------------------------------------------------------------------------
# A · nada se cobra por una corrida que no puede salir bien

def test_el_piso_cabe_dentro_del_tope():
    """Sanidad: un piso por encima del tope dejaría el flujo entero muerto."""
    assert 0 < shorts_api.MIN_DURACION_S < shorts_api.MAX_DURACION_S


def test_shorts_no_cobra_por_el_video_de_seis_segundos(nube):
    r = nube.post("/api/shorts/v1/analizar")
    assert r.status_code == 422, r.text
    assert nube.cobros == [], "se cobró antes de mirar si el video daba para algo"


def test_editar_no_cobra_por_el_video_de_seis_segundos(nube):
    r = nube.post("/api/editar/v1/sugerir")
    assert r.status_code == 422, r.text
    assert nube.cobros == []


def test_el_rechazo_dice_la_duracion_real_y_la_minima(nube):
    """Un 422 que no dice cuánto dura ni cuánto hace falta no ayuda a nadie."""
    detalle = nube.post("/api/shorts/v1/analizar").json()["detail"]
    assert "6 s" in detalle and str(shorts_api.MIN_DURACION_S) in detalle


def test_los_dos_flujos_explican_por_que_cada_uno(nube):
    """Mismo límite, motivos distintos: shorts recorta, editar quita relleno."""
    d_shorts = nube.post("/api/shorts/v1/analizar").json()["detail"]
    d_editar = nube.post("/api/editar/v1/sugerir").json()["detail"]
    assert "short" in d_shorts and "relleno" in d_editar


def test_el_preview_apaga_el_boton_en_vez_de_romper_la_pagina(nube):
    """Los dos previos de costo pintan `aviso` y deshabilitan con
    `backend_listo` (static/shorts.html y static/e1.html): el gate viaja por
    ahí, no por una excepción que dejaría la página en blanco."""
    for ruta in ("/api/shorts/v1/costo", "/api/editar/v1/costo"):
        j = nube.get(ruta).json()
        assert j["backend_listo"] is False, ruta
        assert "6 s" in j["aviso"], ruta


def test_el_tope_de_noventa_minutos_sigue_cortando(nube):
    """El piso es nuevo; el tope estaba desde M8 y no se tocó."""
    nube.dura(shorts_api.MAX_DURACION_S + 1)
    assert nube.post("/api/shorts/v1/analizar").status_code == 413
    assert nube.cobros == []


def test_un_video_normal_sigue_cobrando_y_lanzando(nube):
    """El contrapunto: sin esto, un gate demasiado ancho pasaría inadvertido."""
    nube.dura(1200.0)
    r = nube.post("/api/shorts/v1/analizar")
    assert r.status_code == 200 and nube.cobros == [
        (creditos.SHORTS_ANALISIS_CR, "shorts-analizar:v1")]


def test_importar_de_youtube_tambien_mira_la_duracion(nube, monkeypatch):
    """Traer un clip de YouTube que no da para shorts cuesta igual: el gate va
    en la cotización y en el POST, no solo en el análisis posterior."""
    monkeypatch.setattr(shorts_api, "_info_youtube",
                        lambda vid: {"titulo": "clip", "duracion_s": SEIS_SEGUNDOS})
    url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    assert nube.post("/api/shorts/importar/cotizar", json={"url": url}).status_code == 422
    assert nube.post("/api/shorts/importar", json={"url": url}).status_code == 422
    assert nube.cobros == []


# ---------------------------------------------------------------------------
# A · una corrida que no entrega nada devuelve lo que cobró

def test_cero_sugerencias_devuelve_la_parte_del_llm():
    from worker.editar_task import creditos_a_devolver
    st = {"creditos": 4, "cortes": 0, "fluff": 0, "flags": 0}
    assert creditos_a_devolver(st) == creditos.EDITAR_SUGERENCIAS_CR


def test_la_transcripcion_no_se_devuelve():
    """El canónico SÍ quedó hecho y la próxima corrida ya no lo cobra: devolver
    también esa parte nos dejaría pagando AssemblyAI de nuestro bolsillo."""
    from worker.editar_task import creditos_a_devolver
    caro = creditos.EDITAR_SUGERENCIAS_CR + 10   # LLM + transcripción larga
    st = {"creditos": caro, "cortes": 0, "fluff": 0, "flags": 0}
    assert creditos_a_devolver(st) == creditos.EDITAR_SUGERENCIAS_CR


@pytest.mark.parametrize("st", [
    {"creditos": 4, "cortes": 3, "fluff": 0, "flags": 0},
    {"creditos": 4, "cortes": 0, "fluff": 2, "flags": 0},
    {"creditos": 4, "cortes": 0, "fluff": 0, "flags": 1},
])
def test_una_sola_sugerencia_ya_es_entrega(st):
    """Con algo que enseñar, el servicio se prestó: no se devuelve nada."""
    from worker.editar_task import creditos_a_devolver
    assert creditos_a_devolver(st) == 0


# ---------------------------------------------------------------------------
# B · la liga de YouTube, visible también con un proyecto abierto

SHORTS_HTML = (RAIZ / "static" / "shorts.html").read_text(encoding="utf-8")


def test_la_liga_no_vive_solo_en_elegir_proyecto():
    """El bug: `sec-importar` se revelaba en un único sitio, dentro de
    elegirProyecto(), que solo corre cuando la URL NO trae ?p=. Con un proyecto
    abierto la sección no existía y no había dónde pegar la liga."""
    revelados = SHORTS_HTML.count('$("sec-importar").hidden = false')
    assert revelados >= 2, (
        "la sección de la liga vuelve a revelarse en un solo sitio: si ese sitio "
        "es elegirProyecto(), con ?p= en la URL no hay dónde pegar la liga")


def test_cargar_revela_la_liga_con_proyecto_abierto():
    cuerpo = re.search(r"async function cargar\(\) \{(.*?)\n\}", SHORTS_HTML, re.S)
    assert cuerpo, "cambió la firma de cargar() — revisa este test"
    assert '$("sec-importar").hidden = false' in cuerpo.group(1)


def test_la_descarga_en_curso_sigue_ocultandola():
    """Mientras ESE proyecto se descarga, la sección estorba."""
    assert '$("sec-importar").hidden = true' in SHORTS_HTML
