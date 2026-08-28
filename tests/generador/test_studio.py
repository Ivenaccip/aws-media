"""Lógica pura del estudio web: estilos, guionista, research, casting forzado, proyecto."""
from pathlib import Path

import pytest

from pipeline.flow import casting_con_personaje, guion_numerado
from pipeline.models import Casting, Entidad, Scene
from pipeline.project import EscenaGuion, OpcionPersonaje, Personaje, Proyecto
from pipeline.research import interpretar_tipo
from pipeline.scenes import prompt_veo, resolver_referencias
from pipeline.styles import ESTILOS, resolver_estilo
from pipeline.writer import estimar_segundos, normalizar_guion, presupuesto


def _proyecto(**kw) -> Proyecto:
    base = dict(id="t1", creado="2026-08-22T00:00:00", brief="x", guion=[EscenaGuion(id="1", narracion="Hola mundo")],
                personaje=Personaje(nombre="oso", descripcion="a brown bear",
                                    opciones=[OpcionPersonaje(url="http://f/0.jpg", path="p0")], elegida=0))
    base.update(kw)
    return Proyecto(**base)


def test_resolver_estilo():
    assert resolver_estilo("animated").negativo.startswith("text")
    assert resolver_estilo("custom", "ukiyo-e woodblock").prompt == "ukiyo-e woodblock"
    assert all(e.prompt and e.negativo for e in ESTILOS.values())
    with pytest.raises(ValueError):
        resolver_estilo("nope")


def test_presupuesto_y_normalizar_guion():
    p = presupuesto(60)
    # A3: 1.7 palabras por segundo DE PELÍCULA (medido en gen-tesla, ver writer.py)
    assert p["palabras_max"] == 102 and p["escenas_min"] == 8 and p["escenas_max"] == 12
    g = normalizar_guion({"escenas": [{"narracion": " uno "}, {"narracion": ""}, "dos"]}, 30)
    assert [e.id for e in g] == ["1", "2"] and g[1].narracion == "dos"
    assert estimar_segundos(g) == 1.2
    with pytest.raises(ValueError):
        normalizar_guion({"escenas": []}, 30)


def test_interpretar_tipo():
    assert interpretar_tipo({"tipo": "idea"}, "x") == "idea"
    assert interpretar_tipo({}, "palabra " * 200) == "historia"
    assert interpretar_tipo({"tipo": "otro"}, "corto") == "idea"


def test_casting_con_personaje_fuerza_protagonista():
    p = _proyecto()
    otro = Entidad(nombre="rio", tipo="lugar", importancia="secundario", existe=False, inline=True, descriptor="a river")
    ctx = Casting(protagonista="osito", casting=[otro], faltantes=["osito"], motivos=["no está"], mundo="forest")
    c = casting_con_personaje(ctx, p)
    assert c.protagonista == "oso" and not c.faltantes
    assert c.casting[0].url == "http://f/0.jpg" and c.casting[0].existe and c.casting[1].nombre == "rio"
    ok = Casting(protagonista="oso", casting=[otro], mundo="forest")
    assert casting_con_personaje(ok, p) is ok


def test_guion_numerado_y_personaje():
    p = _proyecto(guion=[EscenaGuion(id="1", narracion="a"), EscenaGuion(id="2", narracion="b")])
    assert guion_numerado(p) == "1. a\n2. b"
    assert p.personaje.url_elegida == "http://f/0.jpg"
    assert Personaje(opciones=[], elegida=0).url_elegida is None


def test_estilo_en_prompts():
    ctx = Casting(protagonista="oso", mundo="spring forest",
                  casting=[Entidad(nombre="oso", tipo="personaje", importancia="principal", existe=True, inline=False,
                                   descriptor="a bear", url="http://f/0.jpg")])
    e = Scene(id="1", narracion="n", personajes=["oso"], prompt_visual="bear walks", prompt_movimiento="pan")
    r = resolver_referencias(e, ctx, None, hay_prev=False, estilo=resolver_estilo("monochrome"))
    assert r.image_urls == ["http://f/0.jpg"] and "black and white" in r.prompt_imagen and "flat 2D" not in r.prompt_imagen
    sin = resolver_referencias(e.model_copy(update={"personajes": []}), ctx, "http://f/0.jpg", hay_prev=False, estilo=resolver_estilo("cinematic"))
    assert sin.image_urls == ["http://f/0.jpg"] and "does NOT appear" in sin.prompt_imagen
    con = resolver_referencias(e, ctx, "http://f/0.jpg", hay_prev=False, estilo=resolver_estilo("cinematic"))
    assert con.image_urls == ["http://f/0.jpg"]  # sin duplicar
    assert r.veo_negativo and "color" in r.veo_negativo and "black and white" in prompt_veo(r)
    clasico = resolver_referencias(e, ctx, "http://estilo", hay_prev=False)
    assert clasico.image_urls == ["http://estilo", "http://f/0.jpg"] and clasico.estilo_prompt is None


def test_interpretar_ranking_voces():
    from pipeline.voices import VOCES, interpretar_ranking
    r = interpretar_ranking({"voces": [
        {"id": "Brian", "nivel": "verde", "motivo": "grave"}, {"id": "Aria", "nivel": "rojo"},
        {"id": "George", "nivel": "verde"}, {"id": "Nadie", "nivel": "verde"}, {"id": "Lily", "nivel": "raro"},
    ]})
    assert [v.id for v in r[:2]] == ["Brian", "George"] and r[-1].id == "Aria"
    assert len(r) == len(VOCES) and all(v.nivel == "amarillo" for v in r if v.motivo == "sin evaluar")


def test_fusionar_edicion():
    from pipeline.editor import fusionar_edicion
    orig = [EscenaGuion(id="1", narracion="Tesla recorta diagramas bajo la lámpara."),
            EscenaGuion(id="2", narracion="Periódicos apilados con titulares sensacionalistas.")]
    g, av = fusionar_edicion(orig, {"escenas": [
        {"id": "1", "narracion": "Tesla recorta diagramas bajo la lámpara, rodeado de papeles."},
        {"id": "2", "narracion": "Mientras tanto, los periódicos apilan titulares sensacionalistas sobre él."}]}, 30)
    assert not av and g[1].narracion.startswith("Mientras tanto")
    # número de escenas distinto → se descarta entero
    g, av = fusionar_edicion(orig, {"escenas": [{"id": "1", "narracion": "x"}]}, 30)
    assert g == orig and "descartado" in av[0]
    # una escena demasiado larga → se conserva solo esa
    larga = " ".join(["palabra"] * 25)
    g, av = fusionar_edicion(orig, {"escenas": [{"id": "1", "narracion": larga}, {"id": "2", "narracion": "Luego, todo cambió para siempre en la ciudad."}]}, 30)
    assert g[0] == orig[0] and g[1].narracion.startswith("Luego") and "escena 1" in av[0]
