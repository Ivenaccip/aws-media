"""M11 — narración primero (flag por proyecto): el narrador de texto corrido,
las ventanas 4/6/8 sobre la duración REAL del TTS, el director por ventana, el
ensamblaje pista-única y el cableado de API/modelo. Sin red."""
import asyncio
import json
from pathlib import Path

import pytest

from pipeline import narracion
from pipeline.models import Casting, Entidad
from pipeline.project import Proyecto


# ---------------------------------------------------------------------------
# ventanas

def test_planear_ventanas_cubre_la_duracion():
    for dur in (9.0, 15.0, 20.4, 45.0, 60.0):
        vs = planear = narracion.planear_ventanas(dur)
        assert len(vs) >= 2
        assert vs[0]["t0"] == 0 and vs[-1]["t1"] == pytest.approx(dur)
        for a, b in zip(vs, vs[1:]):
            assert a["t1"] == b["t0"]                      # contiguas, sin huecos
        for v in vs:
            assert v["video_s"] in (4, 6, 8)
            # el clip pedido siempre cubre su ventana (el sobrante se recorta)
            assert v["video_s"] >= (v["t1"] - v["t0"])


def test_planear_ventanas_casos_conocidos():
    assert [v["video_s"] for v in narracion.planear_ventanas(15.0)] == [8, 8]
    assert len(narracion.planear_ventanas(45.0)) == 6
    assert [v["video_s"] for v in narracion.planear_ventanas(9.0)] == [6, 6]


def test_texto_por_ventana_reparte_por_punto_medio():
    ventanas = [{"t0": 0.0, "t1": 5.0}, {"t0": 5.0, "t1": 10.0}]
    palabras = [
        {"text": "hola", "start": 0.0, "end": 1.0},        # medio 0.5 → v1
        {"text": "cruza", "start": 4.6, "end": 5.6},       # medio 5.1 → v2
        {"text": "final", "start": 9.5, "end": 10.5},      # medio 10.0 → última
    ]
    assert narracion.texto_por_ventana(palabras, ventanas) == ["hola", "cruza final"]


# ---------------------------------------------------------------------------
# narrador (guion corrido)

def test_escribir_narracion_normaliza(monkeypatch):
    from pipeline import writer
    visto = {}
    async def falso(name, system, user):
        visto.update(system=str(system), user=user)
        return {"titulo": "t", "narracion": "  Una  historia\n con   espacios raros " + "palabra " * 12}
    monkeypatch.setattr(writer, "chat_json", falso)
    texto = asyncio.run(writer.escribir_narracion("material", "historia", "animado", 30, None))
    assert "  " not in texto and "\n" not in texto
    assert str(int(30 * writer.PALABRAS_POR_S_HABLA)) in visto["system"]   # presupuesto de habla


def test_escribir_narracion_rechaza_texto_vacio(monkeypatch):
    from pipeline import writer
    async def falso(name, system, user):
        return {"narracion": "muy corto"}
    monkeypatch.setattr(writer, "chat_json", falso)
    with pytest.raises(ValueError):
        asyncio.run(writer.escribir_narracion("m", "historia", "e", 30, None))


# ---------------------------------------------------------------------------
# director por ventana

CTX = Casting(protagonista="pato", mundo="orilla del río", casting=[
    Entidad(nombre="pato", tipo="personaje", importancia="principal",
            existe=True, inline=False, descriptor="un pato café")])


def test_dirigir_ventanas_normaliza_y_rellena(monkeypatch):
    ventanas = narracion.planear_ventanas(15.0)
    textos = ["el pato nada", "y se hunde"]
    async def falso(name, system, user):
        assert "[0.0–7.5 s]" in user and "el pato nada" in user
        return {"escenas": [  # devuelve UNA sola: la segunda se rellena con ella
            {"transicion": "continua", "personajes": ["pato", "fantasma"],
             "prompt_visual": "duck swimming", "prompt_movimiento": "slow pan"}]}
    monkeypatch.setattr(narracion, "chat_json", falso)
    escenas = asyncio.run(narracion.dirigir_ventanas("texto", ventanas, textos, CTX))
    assert len(escenas) == 2
    assert escenas[0].transicion == "corte"            # la 1 siempre es corte
    assert escenas[1].transicion == "continua"
    assert escenas[0].personajes == ["pato"]           # fantasma no está en el elenco
    assert escenas[0].narracion == "el pato nada"
    assert escenas[0].duracion_video == 8
    assert escenas[0].duracion_real == pytest.approx(7.5)


# ---------------------------------------------------------------------------
# producir_pelicula — orquestación completa con todo mockeado

@pytest.fixture
def orquestada(monkeypatch, tmp_path):
    from pipeline import deliver, ffmpeg, media
    reg = {"recortes": [], "concat": None, "mux": None}

    async def tts_falso(texto, voz, workdir):
        return workdir / "narracion.mp3", 15.0
    monkeypatch.setattr(narracion, "tts_narracion", tts_falso)
    monkeypatch.setattr(narracion, "alinear_palabras", lambda audio: [
        {"text": "hola", "start": 0.2, "end": 0.5},
        {"text": "mundo", "start": 8.0, "end": 8.4}])
    async def director_falso(name, system, user):
        return {"escenas": [{"prompt_visual": "v", "prompt_movimiento": "m"},
                            {"prompt_visual": "v2", "prompt_movimiento": "m2"}]}
    monkeypatch.setattr(narracion, "chat_json", director_falso)

    async def imagen_falsa(e, ctx, estilo_url, prev, estilo):
        return e.model_copy(update={"start_image_url": "http://img", "start_image_origen": "grok"})
    async def video_falso(e, prev):
        e.video_path.write_bytes(b"v")
        return e.model_copy(update={"video_origen": "veo"})
    monkeypatch.setattr(media, "imagen_inicio", imagen_falsa)
    monkeypatch.setattr(media, "video_escena", video_falso)

    async def recortar(origen, destino, t):
        reg["recortes"].append(round(t, 3))
        Path(destino).write_bytes(b"r")
    async def ultimo(video, destino):
        Path(destino).write_bytes(b"f")
    async def concat_v(partes, destino):
        reg["concat"] = [p.name for p in partes]
        Path(destino).write_bytes(b"c")
    async def mux_unico(video, audio, destino):
        reg["mux"] = (video.name, audio.name)
        Path(destino).write_bytes(b"m")
        return 15.0
    monkeypatch.setattr(ffmpeg, "recortar_video", recortar)
    monkeypatch.setattr(ffmpeg, "ultimo_frame", ultimo)
    monkeypatch.setattr(ffmpeg, "concat_video", concat_v)
    monkeypatch.setattr(ffmpeg, "mux_pista_unica", mux_unico)
    monkeypatch.setattr(deliver, "subir_drive", lambda p: (None, p.name, None))
    monkeypatch.setattr(deliver, "mensaje_final", lambda *a: "listo")

    monkeypatch.setenv("MEDIA_ROOT", str(tmp_path))
    monkeypatch.setenv("WORK_DIR", str(tmp_path / "work"))
    p = Proyecto(id="abc12345", creado="2026-09-04", brief="b", pipeline="narracion",
                 narracion="hola mundo " * 5, duracion_s=15, estado="produciendo")
    return p, reg


def test_producir_pelicula_pista_unica(orquestada):
    p, reg = orquestada
    etapas = []
    r = asyncio.run(narracion.producir_pelicula(
        p, CTX, None, lambda etapa, datos: etapas.append(etapa)))
    # cada clip se recortó al largo EXACTO de su ventana (15 s → 2 de 7.5)
    assert reg["recortes"] == [7.5, 7.5]
    assert reg["concat"] == ["final_1.mp4", "final_2.mp4"]
    assert reg["mux"] == ("video_ventanas.mp4", "narracion.mp3")
    assert r.duracion_pelicula == 15.0 and len(r.escenas) == 2
    assert "tts" in etapas and "alinear" in etapas and "concat" in etapas


# ---------------------------------------------------------------------------
# modelo y API

def test_texto_guion_prefiere_narracion():
    p = Proyecto(id="x", creado="c", brief="b", pipeline="narracion", narracion="texto corrido")
    assert p.texto_guion() == "texto corrido" and p.tiene_guion()
    p2 = Proyecto(id="y", creado="c", brief="b", pipeline="narracion")
    assert not p2.tiene_guion()


def test_guion_numerado_en_narracion():
    from pipeline import flow
    p = Proyecto(id="x", creado="c", brief="b", pipeline="narracion", narracion="la historia corrida")
    assert flow.guion_numerado(p) == "la historia corrida"


@pytest.fixture
def cliente(monkeypatch, tmp_path):
    monkeypatch.delenv("COGNITO_POOL_ID", raising=False)
    monkeypatch.delenv("STATE_BACKEND", raising=False)
    monkeypatch.delenv("PIPELINE_DEFAULT", raising=False)
    monkeypatch.setenv("MEDIA_ROOT", str(tmp_path))
    monkeypatch.setenv("WORK_DIR", str(tmp_path / "work"))
    from fastapi.testclient import TestClient
    from pipeline import flow
    from server.app import app
    async def nada(p):
        return None
    monkeypatch.setattr(flow, "preparar", nada)
    return TestClient(app)


def test_crear_con_pipeline_narracion(cliente):
    r = cliente.post("/api/proyectos", data={"brief": "un pato", "pipeline": "narracion"})
    assert r.status_code == 200 and r.json()["pipeline"] == "narracion"


def test_crear_pipeline_invalido_cae_al_default(cliente):
    r = cliente.post("/api/proyectos", data={"brief": "un pato", "pipeline": "raro"})
    assert r.json()["pipeline"] == "escenas"


def test_put_guion_narracion_sin_pisar_con_vacio(cliente, monkeypatch):
    from server import app as srv
    p = Proyecto(id="n1", creado="c", brief="b", estado="revision",
                 pipeline="narracion", narracion="texto original")
    monkeypatch.setattr(srv, "_proyecto", lambda id_: p)
    r = cliente.put("/api/proyectos/n1/guion", json={"narracion": "texto nuevo"})
    assert r.status_code == 200 and p.narracion == "texto nuevo"
    cliente.put("/api/proyectos/n1/guion", json={"narracion": "   "})
    assert p.narracion == "texto nuevo"          # M5: vacío jamás pisa
