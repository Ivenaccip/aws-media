"""M22 · G — la imagen se aprueba ANTES de animarla.

«Un paso intermedio entre la creación/investigación y la creación de videos,
con un botón automático o manual, pasando de imágenes a videos para decidir si
quieren esa imagen o cambiarla.»

El argumento es de dinero antes que de gusto: la imagen cuesta $0.02 dólares y
animarla ocho segundos cuesta $0.24 (tools/pricing.json). Enseñarla antes es
doce veces más barato que rehacer la escena después, y convierte «no me gustó»
en algo que se arregla sin pagar otra producción entera.

La producción se parte en dos tareas: la primera llega hasta la imagen de cada
cadena y termina; la segunda la retoma. No se pausa un contenedor de Fargate
esperando a una persona — costaría $0.198 la hora parado y moriría a las dos.
"""
import asyncio
import json
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from pipeline import creditos, db, ffmpeg, jobs, media, run
from pipeline.models import Scene
from pipeline.scenes import ordenar_cola

RAIZ = Path(__file__).resolve().parent.parent


def _escenas(transiciones):
    """Escenas ya ordenadas: ordenar_cola es quien fija modo_inicio y cadenas."""
    return ordenar_cola([
        Scene(id=str(i + 1), narracion=f"linea {i + 1}", transicion=t,
              personajes=["oso"], duracion_video=8, duracion_real=4.0)
        for i, t in enumerate(transiciones)])


# ---------------------------------------------------------------------------
# solo se aprueban las cabezas de cadena

def test_solo_las_cabezas_de_cadena_tienen_imagen(monkeypatch, tmp_path):
    """Una escena «continua» NO llama a Grok: arranca del último frame del clip
    anterior, que no existe hasta animar. En una película de 5 escenas con 2
    cortes hay 2 imágenes que aprobar, no 5 — y decirlo al revés en la pantalla
    sería prometer un control que no existe."""
    pedidas = []

    async def imagen(e, ctx, url, prev, estilo=None):
        pedidas.append(e.id)
        return e.model_copy(update={"start_image_url": f"https://fal/{e.id}.jpg"})

    monkeypatch.setattr(media, "imagen_inicio", imagen)
    monkeypatch.setattr(ffmpeg, "descargar_imagen", _bajada_falsa())
    escenas = _escenas(["corte", "continua", "corte", "continua", "continua"])
    hechas = asyncio.run(run.fase_imagenes(escenas, _casting(), None, tmp_path,
                                           ya_preparadas=True))
    assert pedidas == ["1", "3"]
    assert [e.id for e in hechas if e.imagen_fija] == ["1", "3"]


def test_el_resumen_dice_cuantos_planos_manda_cada_imagen():
    """«Esta imagen manda en 3 planos» es lo que explica por qué mirarla."""
    escenas = _escenas(["corte", "continua", "continua", "corte"])
    escenas = [e.model_copy(update={"imagen_fija": e.transicion == "corte",
                                    "start_image_path": Path(f"/w/start_{e.id}.jpg")})
               for e in escenas]
    r = run.resumen_imagenes(escenas)
    assert [(x["id"], x["planos"]) for x in r] == [("1", 3), ("4", 1)]
    assert r[0]["archivo"] == "start_1.jpg" and r[0]["narracion"] == "linea 1"


def test_resumen_de_una_pelicula_sin_imagenes_fijas_esta_vacio():
    assert run.resumen_imagenes(_escenas(["corte", "continua"])) == []


# ---------------------------------------------------------------------------
# la imagen aprobada NO se vuelve a generar

def test_animar_no_regenera_la_imagen_aprobada(monkeypatch, tmp_path):
    """Regenerarla sería pagarla dos veces Y entregar una distinta de la que el
    usuario aprobó, que es peor que el cobro."""
    llamadas = {"inicio": 0, "repone": 0}

    async def inicio(e, ctx, url, prev, estilo=None):
        llamadas["inicio"] += 1
        return e

    async def repone(e):
        llamadas["repone"] += 1
        return e

    async def video(e, prev):
        return e.model_copy(update={"video_origen": "veo"})

    async def mux(e):
        return e.model_copy(update={"duracion_final": 4.0})   # lo que hace el mux real

    monkeypatch.setattr(media, "imagen_inicio", inicio)
    monkeypatch.setattr(media, "reponer_imagen_fija", repone)
    monkeypatch.setattr(media, "video_escena", video)
    monkeypatch.setattr(media, "mux_escena", mux)
    e = _escenas(["corte"])[0].model_copy(update={"imagen_fija": True})
    asyncio.run(run._procesar_escena(e, _casting(), None, None))
    assert llamadas == {"inicio": 0, "repone": 1}


def test_una_escena_sin_aprobar_sigue_generando_su_imagen(monkeypatch):
    """El modo automático no cambia en nada: es el camino de siempre."""
    llamadas = {"inicio": 0, "repone": 0}

    async def inicio(e, ctx, url, prev, estilo=None):
        llamadas["inicio"] += 1
        return e

    async def repone(e):
        llamadas["repone"] += 1
        return e

    async def paso(e, *a):
        return e

    monkeypatch.setattr(media, "imagen_inicio", inicio)
    monkeypatch.setattr(media, "reponer_imagen_fija", repone)
    monkeypatch.setattr(media, "video_escena", paso)
    monkeypatch.setattr(media, "mux_escena",
                        lambda e: _corrutina(e.model_copy(update={"duracion_final": 4.0})))
    asyncio.run(run._procesar_escena(_escenas(["corte"])[0], _casting(), None, None))
    assert llamadas == {"inicio": 1, "repone": 0}


def test_reponer_vuelve_a_subir_la_imagen_del_disco(monkeypatch, tmp_path):
    """Entre aprobar y animar pueden pasar días y la URL de fal caduca. El
    archivo sí sigue ahí: se re-sube, que es gratis."""
    from pipeline import fal
    img = tmp_path / "start_1.jpg"
    img.write_bytes(b"jpg")

    async def subir(p):
        assert Path(p) == img
        return "https://fal/nueva.jpg"

    monkeypatch.setattr(fal, "subir_archivo", subir)
    e = Scene(id="1", narracion="x", imagen_fija=True, start_image_path=img,
              start_image_url="https://fal/vieja.jpg")
    assert asyncio.run(media.reponer_imagen_fija(e)).start_image_url == "https://fal/nueva.jpg"


def test_reponer_sin_archivo_deja_la_escena_como_estaba(tmp_path):
    e = Scene(id="1", narracion="x", imagen_fija=True,
              start_image_path=tmp_path / "no-existe.jpg", start_image_url="https://fal/vieja.jpg")
    assert asyncio.run(media.reponer_imagen_fija(e)).start_image_url == "https://fal/vieja.jpg"


def test_reponer_que_truena_no_tumba_la_produccion(monkeypatch, tmp_path):
    from pipeline import fal
    img = tmp_path / "start_1.jpg"
    img.write_bytes(b"jpg")

    async def truena(p):
        raise RuntimeError("fal caída")

    monkeypatch.setattr(fal, "subir_archivo", truena)
    e = Scene(id="1", narracion="x", imagen_fija=True, start_image_path=img,
              start_image_url="https://fal/vieja.jpg")
    assert asyncio.run(media.reponer_imagen_fija(e)).start_image_url == "https://fal/vieja.jpg"


def test_el_clip_de_respaldo_no_rebaja_una_imagen_que_ya_esta(monkeypatch, tmp_path):
    """Si Veo falla, el respaldo se arma con la imagen. Bajarla otra vez de una
    URL caducada rompería justo el camino de rescate."""
    img = tmp_path / "start_1.jpg"
    img.write_bytes(b"jpg")

    async def no_bajar(url, destino):
        pytest.fail("la imagen ya está en el disco: no hay que bajarla")

    monkeypatch.setattr(ffmpeg, "descargar_imagen", no_bajar)
    e = Scene(id="1", narracion="x", start_image_path=img, start_image_url="https://x/caducada.jpg")
    asyncio.run(media._guardar_imagen_inicio(e, None))


# ---------------------------------------------------------------------------
# pedir otra imagen

def test_pedir_otra_imagen_no_paga_un_qc(monkeypatch, tmp_path):
    """El QC de visión existe para no gastar en Veo sobre una imagen mal
    encuadrada. Aquí el que juzga el encuadre es el usuario, que la tiene
    delante: correrlo sería pagar un juez de más."""
    monkeypatch.setattr(media, "qc_imagen", lambda *a, **k: pytest.fail("QC de más"))
    monkeypatch.setattr(ffmpeg, "descargar_imagen", _bajada_falsa())
    visto = {}

    async def grok(e, prompt, intento, image_urls=None):
        visto["prompt"] = prompt
        return "https://fal/otra.jpg"

    monkeypatch.setattr(media, "_grok", grok)
    e = Scene(id="1", narracion="x", imagen_fija=True, prompt_imagen="un oso",
              start_image_path=tmp_path / "start_1.jpg")
    nueva = asyncio.run(media.regenerar_imagen(e, "un oso con sombrero"))
    assert visto["prompt"] == "un oso con sombrero"
    assert nueva.prompt_imagen == "un oso con sombrero"   # se guarda lo que pidió
    assert nueva.start_image_url == "https://fal/otra.jpg" and nueva.imagen_fija


def test_pedir_otra_sin_escribir_nada_reusa_el_prompt(monkeypatch, tmp_path):
    monkeypatch.setattr(ffmpeg, "descargar_imagen", _bajada_falsa())
    visto = {}

    async def grok(e, prompt, intento, image_urls=None):
        visto["prompt"] = prompt
        return "https://fal/otra.jpg"

    monkeypatch.setattr(media, "_grok", grok)
    e = Scene(id="1", narracion="x", prompt_imagen="un oso",
              start_image_path=tmp_path / "start_1.jpg")
    asyncio.run(media.regenerar_imagen(e, "   "))
    assert visto["prompt"] == "un oso"


# ---------------------------------------------------------------------------
# el estado que cruza de una tarea a la otra

def test_el_estado_guarda_el_casting_para_no_pagarlo_dos_veces(monkeypatch, tmp_path):
    """La fase de animar corre en OTRA tarea de Fargate. Sin el casting
    guardado habría que volver a llamar al LLM — y podría devolver un reparto
    distinto del que produjo las imágenes aprobadas."""
    monkeypatch.setattr(media, "imagen_inicio", _imagen_falsa())
    monkeypatch.setattr(ffmpeg, "descargar_imagen", _bajada_falsa())
    asyncio.run(run.fase_imagenes(_escenas(["corte"]), _casting(), None, tmp_path,
                                 ya_preparadas=True))
    d = json.loads((tmp_path / "estado.json").read_text(encoding="utf-8"))
    assert d["etapa"] == "imagenes" and d["casting"]["protagonista"] == "oso"
    cargado = run.cargar_estado(tmp_path)
    assert cargado["casting"].protagonista == "oso"
    assert cargado["escenas"][0].imagen_fija


def test_cargar_estado_reapunta_las_rutas_al_disco_de_quien_lee(tmp_path):
    """El archivo lo escribió Fargate y lo puede leer la API (Lambda, /tmp).
    Las rutas de dentro son absolutas: sin re-apuntarlas señalarían un disco
    ajeno y la imagen no aparecería."""
    (tmp_path / "estado.json").write_text(json.dumps({"etapa": "imagenes", "escenas": [
        {"id": "1", "narracion": "x", "imagen_fija": True,
         "start_image_path": "/otra/maquina/work/abc/start_1.jpg",
         "audio_path": "/otra/maquina/work/abc/audio_1.mp3"}]}), encoding="utf-8")
    e = run.cargar_estado(tmp_path)["escenas"][0]
    assert e.start_image_path == tmp_path / "start_1.jpg"
    assert e.audio_path == tmp_path / "audio_1.mp3"


def test_un_estado_anterior_a_m22_carga_sin_casting(tmp_path):
    """estado.json ya existía desde M1 y los viejos no traen la clave."""
    (tmp_path / "estado.json").write_text(
        json.dumps({"etapa": "tts", "escenas": [{"id": "1", "narracion": "x"}]}), encoding="utf-8")
    d = run.cargar_estado(tmp_path)
    assert d["casting"] is None and d["escenas"][0].imagen_fija is False


def test_el_puente_al_editor_sigue_leyendo_el_mismo_estado(tmp_path):
    """overlays.crear_desde_produccion saca de estado.json los prompts reales
    de cada escena. La clave nueva es de primer nivel y no le estorba."""
    from pipeline import overlays
    work = tmp_path / "work"
    work.mkdir()
    proyecto = tmp_path / "proy"
    (work / "estado.json").write_text(json.dumps({
        "etapa": "mux", "casting": {"protagonista": "oso", "casting": [], "mundo": ""},
        "escenas": [{"id": "1", "narracion": "hola", "prompt_imagen": "un oso",
                     "prompt_movimiento": "camina", "estilo_prompt": "plano"}]}), encoding="utf-8")
    (work / "final_1.mp4").write_bytes(b"mp4")
    (work / "audio_1.mp3").write_bytes(b"mp3")
    d = overlays.crear_desde_produccion(proyecto, work, ["1"], {"1": 4.0})
    assert d["overlays"][0]["prompt_imagen"] == "un oso"
    assert d["estilo_prompt"] == "plano"


# ---------------------------------------------------------------------------
# el pipeline de narración (el de por defecto) mide la ventana desde la escena

def test_la_narracion_recorta_con_la_duracion_de_la_escena(monkeypatch, tmp_path):
    """El largo de la ventana viaja EN la escena: así animar puede correr en
    otra tarea sin la lista de ventanas en memoria."""
    from pipeline import narracion as narr
    recortes = []

    async def recortar(origen, destino, largo):
        recortes.append(largo)

    async def ultimo(v, destino):
        pass

    monkeypatch.setattr(media, "imagen_inicio", _imagen_falsa())
    monkeypatch.setattr(media, "video_escena", _paso())
    monkeypatch.setattr(ffmpeg, "recortar_video", recortar)
    monkeypatch.setattr(ffmpeg, "ultimo_frame", ultimo)
    cadena = [Scene(id="1", narracion="x", duracion_real=3.5),
              Scene(id="2", narracion="y", transicion="continua", duracion_real=4.25)]
    asyncio.run(narr._procesar_cadena(cadena, _casting(), None, None, None))
    assert recortes == [3.5, 4.25]


# ---------------------------------------------------------------------------
# el API

def _proyecto_falso(estado="revision", workdir=None, **extra):
    return SimpleNamespace(
        id="p1", estado=estado, etapa="", error=None, progreso={},
        workdir=Path(workdir or "."),
        duracion_s=30, guion=[{"n": 1}], pipeline="escenas",
        tiene_guion=lambda: True,
        personaje=SimpleNamespace(url_elegida="opciones/a.png"),
        guardar=lambda: None, **extra)


@pytest.fixture
def api(monkeypatch):
    from server import app as srv
    monkeypatch.setenv("STATE_BACKEND", "postgres")
    monkeypatch.setattr(jobs, "backend", lambda: "aws")
    lanzados, cobros, devueltos = [], [], []
    monkeypatch.setattr(jobs, "lanzar_produccion",
                        lambda u, i, fase="todo": lanzados.append((i, fase)))
    monkeypatch.setattr(creditos, "activo", lambda: True)
    monkeypatch.setattr(creditos, "cobrar", lambda n, ref: cobros.append((n, ref)) or 0)
    monkeypatch.setattr(creditos, "devolver", lambda n, ref: devueltos.append((n, ref)) or n)
    monkeypatch.setattr(db, "reclamar_produccion", lambda u, i, desde=None: True)
    monkeypatch.setattr(db, "liberar_produccion", lambda u, i, e: None)
    return SimpleNamespace(srv=srv, lanzados=lanzados, cobros=cobros, devueltos=devueltos,
                           cliente=TestClient(srv.app, raise_server_exceptions=False))


def test_producir_de_corrido_es_el_camino_de_siempre(api, monkeypatch):
    monkeypatch.setattr(api.srv, "_proyecto", lambda i: _proyecto_falso())
    assert api.cliente.post("/api/proyectos/p1/producir").status_code == 200
    assert api.lanzados == [("p1", "todo")]


def test_producir_pidiendo_aprobar_lanza_la_fase_de_imagenes(api, monkeypatch):
    """Y cobra lo mismo: la película se paga entera aquí, como siempre."""
    monkeypatch.setattr(api.srv, "_proyecto", lambda i: _proyecto_falso())
    r = api.cliente.post("/api/proyectos/p1/producir?aprobar_imagenes=true")
    assert r.status_code == 200
    assert api.lanzados == [("p1", "imagenes")]
    assert api.cobros == [(90, "producir:p1")]


def test_animar_no_cobra_nada(api, monkeypatch):
    """La película se pagó al pulsar Producir. Cobrar aquí sería cobrarla dos
    veces por haberla mirado."""
    monkeypatch.setattr(api.srv, "_proyecto", lambda i: _proyecto_falso("imagenes"))
    r = api.cliente.post("/api/proyectos/p1/animar")
    assert r.status_code == 200
    assert api.lanzados == [("p1", "animar")] and not api.cobros


def test_animar_desde_otro_estado_es_409(api, monkeypatch):
    monkeypatch.setattr(api.srv, "_proyecto", lambda i: _proyecto_falso("listo"))
    r = api.cliente.post("/api/proyectos/p1/animar")
    assert r.status_code == 409 and not api.lanzados


def test_animar_reclama_desde_imagenes(api, monkeypatch):
    """Mismo candado que producir: dos clics seguidos lanzan UNA vez."""
    visto = {}
    monkeypatch.setattr(api.srv, "_proyecto", lambda i: _proyecto_falso("imagenes"))
    monkeypatch.setattr(db, "reclamar_produccion",
                        lambda u, i, desde=None: visto.update(desde=desde) or False)
    r = api.cliente.post("/api/proyectos/p1/animar")
    assert r.status_code == 409 and visto["desde"] == ("imagenes",)
    assert not api.lanzados


def test_pedir_otra_imagen_avisa_el_costo_antes_de_cobrar(api, monkeypatch):
    """Gate 428 con el costo, como el popup de imágenes del editor: nadie gasta
    un crédito sin haber visto cuántos son."""
    monkeypatch.setattr(api.srv, "_proyecto", lambda i: _proyecto_falso("imagenes"))
    r = api.cliente.post("/api/proyectos/p1/imagenes/1/regenerar", json={})
    assert r.status_code == 428
    assert json.loads(r.json()["detail"])["creditos"] == creditos.costo_imagen()
    assert not api.cobros


def test_pedir_otra_imagen_cobra_la_tarifa_de_imagen(api, monkeypatch, tmp_path):
    p = _proyecto_falso("imagenes", workdir=tmp_path)
    monkeypatch.setattr(api.srv, "_proyecto", lambda i: p)
    monkeypatch.setattr(api.srv, "_estado_produccion", lambda _p: {"escenas": [
        {"id": "1", "narracion": "x", "imagen_fija": True, "prompt_imagen": "un oso"}]})
    guardado = {}
    monkeypatch.setattr(api.srv, "_guardar_estado_produccion",
                        lambda _p, d: guardado.update(d))
    monkeypatch.setattr(api.srv, "_sync_workdir", lambda _p: None)

    async def regenerar(e, prompt=None):
        return e.model_copy(update={"start_image_url": "https://fal/otra.jpg"})

    monkeypatch.setattr(api.srv.media, "regenerar_imagen", regenerar)
    r = api.cliente.post("/api/proyectos/p1/imagenes/1/regenerar",
                         json={"confirmar": True, "prompt": "otro oso"})
    assert r.status_code == 200
    assert api.cobros == [(creditos.costo_imagen(), "imagen:p1")]
    assert guardado["escenas"][0]["start_image_url"] == "https://fal/otra.jpg"
    assert p.progreso["imagenes"][0]["id"] == "1"


def test_si_la_imagen_nueva_falla_vuelven_los_creditos(api, monkeypatch, tmp_path):
    monkeypatch.setattr(api.srv, "_proyecto", lambda i: _proyecto_falso("imagenes", workdir=tmp_path))
    monkeypatch.setattr(api.srv, "_estado_produccion", lambda _p: {"escenas": [
        {"id": "1", "narracion": "x", "imagen_fija": True}]})

    async def truena(e, prompt=None):
        raise RuntimeError("fal caída")

    monkeypatch.setattr(api.srv.media, "regenerar_imagen", truena)
    r = api.cliente.post("/api/proyectos/p1/imagenes/1/regenerar", json={"confirmar": True})
    assert r.status_code == 502
    assert api.devueltos == [(creditos.costo_imagen(), "imagen:p1")]


def test_una_escena_que_no_es_cabeza_de_cadena_no_se_puede_regenerar(api, monkeypatch):
    """Las «continua» no tienen imagen propia: pedir otra ahí no significa nada
    y cobrarla sería cobrar por aire."""
    monkeypatch.setattr(api.srv, "_proyecto", lambda i: _proyecto_falso("imagenes"))
    monkeypatch.setattr(api.srv, "_estado_produccion", lambda _p: {"escenas": [
        {"id": "2", "narracion": "x", "imagen_fija": False}]})
    r = api.cliente.post("/api/proyectos/p1/imagenes/2/regenerar", json={"confirmar": True})
    assert r.status_code == 404 and not api.cobros


def test_cancelar_devuelve_lo_que_no_se_gasto(api, monkeypatch):
    """Se cobró la película entera por adelantado y solo se quemó una imagen
    por cadena: el resto vuelve. Nadie paga por una película que no existe."""
    p = _proyecto_falso("imagenes")
    p.progreso = {"imagenes": [{"id": "1"}, {"id": "3"}]}
    monkeypatch.setattr(api.srv, "_proyecto", lambda i: p)
    r = api.cliente.post("/api/proyectos/p1/cancelar")
    assert r.status_code == 200
    esperado = creditos.costo_producir(30) - creditos.costo_imagen() * 2
    assert api.devueltos == [(esperado, "cancelar:p1")]
    assert r.json()["devueltos"] == esperado and p.estado == "revision"


def test_cancelar_desde_otro_estado_no_devuelve_nada(api, monkeypatch):
    monkeypatch.setattr(api.srv, "_proyecto", lambda i: _proyecto_falso("listo"))
    assert api.cliente.post("/api/proyectos/p1/cancelar").status_code == 409
    assert not api.devueltos


# ---------------------------------------------------------------------------
# el worker: parar NO es fallar

def test_pararse_en_las_imagenes_no_devuelve_creditos(monkeypatch, tmp_path):
    """La condición vieja era `estado != "listo"`, así que una película parada a
    enseñar imágenes habría devuelto la producción entera mientras el trabajo
    seguía vivo: gratis para el usuario y a nuestra costa."""
    devueltos = _worker_falso(monkeypatch, tmp_path, "imagenes")
    from worker import producir_task
    assert producir_task.main("sub", "p1", "imagenes") == 0
    assert devueltos == []


def test_una_fase_de_imagenes_que_falla_si_devuelve(monkeypatch, tmp_path):
    devueltos = _worker_falso(monkeypatch, tmp_path, "error")
    from worker import producir_task
    assert producir_task.main("sub", "p1", "imagenes") == 1
    assert devueltos == [90]


def test_el_worker_acepta_la_fase_y_la_pasa_al_flow(monkeypatch, tmp_path):
    vistas = []
    _worker_falso(monkeypatch, tmp_path, "listo", vistas)
    from worker import producir_task
    assert producir_task.main("sub", "p1", "animar") == 0
    assert vistas == ["animar"]


# ---------------------------------------------------------------------------
# la pantalla

def test_el_formulario_ofrece_los_dos_modos_y_manda_el_elegido():
    html = (RAIZ / "static" / "crear.html").read_text(encoding="utf-8")
    assert 'data-img="auto"' in html and 'data-img="manual"' in html
    assert "aprobar_imagenes=${modoImg === 'manual'}" in html, "el modo elegido no viaja"


def test_la_pantalla_de_aprobacion_existe_y_no_se_sigue_encuestando():
    """Una película parada esperando a una persona no cambia sola: seguir
    preguntando cada 2.5 s es una invocación de Lambda y una consulta a Aurora
    por vuelta, para nada."""
    html = (RAIZ / "static" / "crear.html").read_text(encoding="utf-8")
    assert 'id="imagenes"' in html and 'id="animar"' in html and 'id="cancelar"' in html
    assert "const TERMINAL = ['revision', 'imagenes', 'listo', 'error'];" in html


def test_la_imagen_nueva_no_se_queda_en_cache():
    """La imagen nueva se escribe en el MISMO archivo (start_N.jpg): sin
    romper el caché, el botón parecería no hacer nada."""
    html = (RAIZ / "static" / "crear.html").read_text(encoding="utf-8")
    assert "?v=${imgVersion}" in html and "imgVersion++" in html


# ---------------------------------------------------------------------------
# utilidades

def _casting():
    from pipeline.models import Casting
    return Casting(protagonista="oso", casting=[], faltantes=[], motivos=[], mundo="un bosque")


def _corrutina(valor):
    async def _c():
        return valor
    return _c()


def _paso():
    async def _p(e, *a, **k):
        return e
    return _p


def _imagen_falsa():
    async def _i(e, ctx, url, prev, estilo=None):
        return e.model_copy(update={"start_image_url": f"https://fal/{e.id}.jpg"})
    return _i


def _bajada_falsa():
    async def _b(url, destino):
        Path(destino).parent.mkdir(parents=True, exist_ok=True)
        Path(destino).write_bytes(b"jpg")
    return _b


def _worker_falso(monkeypatch, tmp_path, estado_final, vistas=None):
    """producir_task con el pipeline entero espiado: ni red ni ffmpeg.

    DEFAULT_USER_ID se fija con monkeypatch aunque main() lo pise: si no, el
    usuario de esta prueba se filtra a las que corren despues."""
    monkeypatch.setenv("DEFAULT_USER_ID", "piloto")
    from pipeline import costes_infra, media_sync
    from pipeline import project as project_mod
    from pipeline import flow

    p = SimpleNamespace(estado=estado_final, workdir=tmp_path, progreso={},
                        duracion_s=30, error=None)

    async def producir(proy, fase="todo"):
        if vistas is not None:
            vistas.append(fase)

    monkeypatch.setattr(flow, "producir", producir)
    monkeypatch.setattr(media_sync, "bajar_prefijo", lambda pref, d: 0)
    monkeypatch.setattr(media_sync, "subir_dir", lambda d, pref: 0)
    monkeypatch.setattr(project_mod, "cargar_proyecto", lambda id_: p)
    monkeypatch.setattr(costes_infra, "registrar", lambda *a: None)
    monkeypatch.setattr(costes_infra, "costo_fargate", lambda s: 0.0)
    monkeypatch.setattr(creditos, "activo", lambda: True)
    devueltos = []
    monkeypatch.setattr(creditos, "devolver",
                        lambda n, ref, u=None: devueltos.append(n) or n)
    return devueltos
