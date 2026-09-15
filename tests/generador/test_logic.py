"""Tests de la lógica pura (sin red, sin ffmpeg)."""
from pathlib import Path

import pytest

from pipeline.casting import separar_casting
from pipeline.director import normalizar_escenas
from pipeline.ffmpeg import mux_duracion
from pipeline.library import preparar_biblioteca
from pipeline.models import Casting, Entidad, Scene
from pipeline.scenes import ordenar_cola, partir_en_cadenas, resolver_referencias
from pipeline.tts import armar_sub_escenas, decidir_duracion
from pipeline.utils import natural_key, norm, parse_ffmpeg_duration, parse_llm_json


# ---------- utils ----------
def test_norm():
    assert norm("  Salmón ") == "salmon"
    assert norm(None) == ""


def test_parse_llm_json_fences():
    assert parse_llm_json('```json\n{"a": 1}\n```') == {"a": 1}
    with pytest.raises(ValueError):
        parse_llm_json("no json")


def test_parse_ffmpeg_duration():
    err = "Input #0, mp3\n  Duration: 00:00:06.02, start: 0.000000, bitrate: 128 kb/s"
    assert parse_ffmpeg_duration(err) == 6.02
    assert parse_ffmpeg_duration("nada") is None


def test_natural_order():
    ids = ["10", "2", "5b", "1", "5a"]
    assert sorted(ids, key=natural_key) == ["1", "2", "5a", "5b", "10"]


# ---------- biblioteca / casting ----------
FILAS = [
    {"nombre": "Oso", "tipo": "personaje", "descriptor": "the same brown bear", "drive_id": "ABC", "estado": "activo"},
    {"nombre": "estilo", "tipo": "estilo", "descriptor": "", "url": "https://x/estilo.png", "estado": "activo"},
    {"nombre": "zorro", "tipo": "personaje", "descriptor": "fox", "drive_id": "Z", "estado": "inactivo"},
]


def test_preparar_biblioteca():
    b = preparar_biblioteca(FILAS)
    assert b.estilo_url == "https://x/estilo.png"
    assert [e["nombre"] for e in b.entidades] == ["oso"]
    assert b.entidades[0]["url"].endswith("id=ABC")


def test_separar_casting_prota_existente_y_secundario_inline():
    b = preparar_biblioteca(FILAS)
    r = {
        "protagonista": "Oso",
        "casting": [
            {"nombre": "oso", "tipo": "personaje", "importancia": "principal"},
            {"nombre": "montaña", "tipo": "lugar", "importancia": "principal", "descriptor": "a snowy mountain"},
        ],
        "mundo": "forest",
    }
    c = separar_casting(r, b)
    assert c.faltantes == []
    assert c.casting[0].existe and c.casting[0].descriptor == "the same brown bear"
    # solo el protagonista puede ser principal
    assert c.casting[1].importancia == "secundario" and c.casting[1].inline


def test_separar_casting_prota_faltante_bloquea():
    b = preparar_biblioteca(FILAS)
    c = separar_casting({"protagonista": "salmón", "casting": [], "mundo": ""}, b)
    assert c.faltantes == ["salmon"]
    assert "no está en la hoja" in c.motivos[0]


# ---------- director ----------
def ctx():
    return Casting(protagonista="oso", mundo="forest", casting=[
        Entidad(nombre="oso", tipo="personaje", importancia="principal", existe=True, inline=False,
                descriptor="the same brown bear", url="https://x/oso.png"),
        Entidad(nombre="rio", tipo="lugar", importancia="secundario", existe=False, inline=True, descriptor="a river"),
    ])


def test_normalizar_escenas():
    r = {"escenas": [
        {"id": 1, "transicion": "continua", "narracion": "a", "personajes": ["Oso", "ajeno", "rio", "x"]},
        {"id": 2, "transicion": "continua", "narracion": "b", "personajes": ["oso"]},
        {"id": 3, "transicion": "raro", "narracion": "c"},
    ]}
    es = normalizar_escenas(r, ctx())
    assert [e.transicion for e in es] == ["corte", "continua", "corte"]  # la 1 siempre corte
    assert es[0].personajes == ["oso", "rio"]  # filtrados por elenco y máx 2


# ---------- tts ----------
@pytest.mark.parametrize("real,intentos,ajustado,esperado", [
    (3.0, 0, False, ("ok", 4)),
    (5.1, 0, False, ("ok", 6)),
    (7.2, 0, False, ("ok", 8)),
    (7.3, 0, False, ("ajustar", None)),   # 7.3 + 0.8 > 8
    (7.3, 0, True, ("cortar", None)),     # ya ajustado → cortar
    (12.0, 0, False, ("cortar", None)),   # > 9.5 → directo a cortar
    (12.0, 2, False, ("ok", 8)),          # agotados intentos → 8 s
])
def test_decidir_duracion(real, intentos, ajustado, esperado):
    assert decidir_duracion(real, intentos, ajustado) == esperado


def test_armar_sub_escenas():
    orig = Scene(id="5", narracion="larga", transicion="corte", personajes=["oso"], prompt_visual="pv", intentos=0)
    subs = armar_sub_escenas({"sub_escenas": [{"id": "5a", "narracion": "x"}, {"id": "5b", "narracion": "y"}]}, orig)
    assert [s.id for s in subs] == ["5a", "5b"]
    assert subs[0].transicion == "corte" and subs[1].transicion == "continua"
    assert all(s.intentos == 1 and s.prompt_visual == "pv" for s in subs)


def test_una_escena_partida_conserva_la_voz_y_el_formato():
    """Partir una escena por duración pasa DESPUÉS de bajar la voz y el formato
    del proyecto, y nadie los repone aguas abajo: la escena partida salía con la
    voz por defecto —no la elegida— y apaisada dentro de una película vertical.
    Sin excepción: la película salía mal y nadie se enteraba."""
    orig = Scene(id="5", narracion="larga", voz="Rachel", formato="vertical")
    subs = armar_sub_escenas(
        {"sub_escenas": [{"id": "5a", "narracion": "x"}, {"id": "5b", "narracion": "y"}]}, orig)
    assert [s.voz for s in subs] == ["Rachel", "Rachel"]
    assert [s.formato for s in subs] == ["vertical", "vertical"]


# ---------- cola / cadenas ----------
def test_ordenar_cola_y_cadenas():
    es = [
        Scene(id="5b", narracion="", transicion="continua", personajes=["oso"]),
        Scene(id="1", narracion="", transicion="corte", personajes=["oso"]),
        Scene(id="3", narracion="", transicion="continua", personajes=["oso"]),
        Scene(id="2", narracion="", transicion="corte", personajes=["oso"]),
        Scene(id="4", narracion="", transicion="continua", personajes=["rio"]),  # cambia personajes → corte
        Scene(id="5a", narracion="", transicion="corte", personajes=["oso"]),
    ]
    cola = ordenar_cola(es)
    assert [e.id for e in cola] == ["1", "2", "3", "4", "5a", "5b"]
    assert [e.transicion for e in cola] == ["corte", "corte", "continua", "corte", "corte", "continua"]
    assert cola[2].prev_id == "2" and cola[2].modo_inicio == "continua"
    assert cola[-1].es_ultima
    cadenas = partir_en_cadenas(cola)
    assert [[e.id for e in c] for c in cadenas] == [["1"], ["2", "3"], ["4"], ["5a", "5b"]]


def test_resolver_referencias_corte():
    e = Scene(id="1", narracion="", personajes=["oso", "rio"], prompt_visual="bear by the river", modo_inicio="corte")
    r = resolver_referencias(e, ctx(), "https://x/estilo.png", hay_prev=False)
    assert r.image_urls == ["https://x/estilo.png", "https://x/oso.png"]  # estilo primero, inline sin url
    assert "MUST appear" in r.prompt_imagen and "the same brown bear; a river" in r.prompt_imagen
    assert "flat 2D cartoon" in r.prompt_imagen


def test_resolver_referencias_continua_sin_prev_cae_a_corte():
    e = Scene(id="2", narracion="", modo_inicio="continua")
    assert resolver_referencias(e, ctx(), None, hay_prev=False).modo_inicio == "corte"
    assert resolver_referencias(e, ctx(), None, hay_prev=True).modo_inicio == "continua"


# ---------- mux ----------
def test_mux_duracion():
    assert mux_duracion(8, 5.0) == 5.9
    assert mux_duracion(6, 5.5) == 6.0  # nunca más que el clip


# ---------- pricing ----------
def test_costo_fal():
    from pipeline.pricing import costo_fal
    assert costo_fal("fal-ai/veo3.1/lite/image-to-video", {"duration": "6s", "resolution": "720p", "generate_audio": False}) == 0.18
    assert costo_fal("xai/grok-imagine-image/edit", {"image_urls": ["a", "b"]}) == 0.024
    assert costo_fal("fal-ai/elevenlabs/tts/eleven-v3", {"text": "x" * 500}) == 0.05
    assert costo_fal("otro", {}) is None


# ---------- qc ----------
def test_interpretar_qc():
    from pipeline.qc import interpretar_qc, prompt_con_correccion
    r = interpretar_qc({"ok": False, "correccion": "bear must face RIGHT toward the cave", "motivo": "mira al lado contrario"})
    assert not r.ok and r.correccion.startswith("bear must")
    # sin corrección no se puede regenerar → se aprueba
    assert interpretar_qc({"ok": False, "correccion": "", "motivo": "x"}).ok
    # respuesta ambigua → se aprueba
    assert interpretar_qc({"motivo": "no sé"}).ok
    assert interpretar_qc({"ok": True, "correccion": "ignorar"}).correccion == ""
    assert prompt_con_correccion("p.", "c") == "p. IMPORTANT STAGING: c"
