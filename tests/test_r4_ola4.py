"""R4 · Ola 4 — los clips de otras familias: MiniMax H3 Max Turbo (`h3t`), Grok Imagine Video (`grokv`),
Grok Imagine Video 1.5 Lite (`grokl`, 12-oct-2026), LTX-2.5 Fast (`ltx`), Kling V3 Pro (`kling`) y Seedance 2.0 (`seed`).

Cada uno nace INERTE: tiene fila (`pipeline/modelos_ia.py`), adaptador de argumentos
(`pipeline/clip_familias.py`) y ficha de costo LEÍDA (`tools/pricing.json`), pero ningún número en
`tools/tarifas.json`, así que el servidor lo conoce y no lo ofrece (422 antes de cobrar).

Lo que este archivo defiende:
  * las seis filas y sus datos (endpoints, familia, duraciones, audio, un solo intento);
  * que Veo manda EXACTAMENTE lo de siempre (el refactor a `args_de_clip` no le cambió ni una llave);
  * que cada familia manda lo que su esquema real pide: llaves que existen, obligatorias presentes, valores
    dentro del enum, el tipo de la duración, y el endpoint de imagen con la llave de imagen de SU familia
    (`tests/fixtures/esquemas_fal_ola4.json`, leído el 12-oct-2026; el de Lite en `esquemas_fal_grok_lite.json`);
  * que el costo sale de los MISMOS argumentos que se mandan (la resolución de MiniMax va en mayúscula y una
    resolución que la ficha no trae es «sin costo conocido», nunca el precio de la de al lado);
  * que siguen inertes: sin número no hay venta.

Sin red: fal mockeado. OJO: nada de importar pipeline/server a nivel de módulo (ver test_m25_clip)."""
import asyncio
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

RAIZ = Path(__file__).resolve().parent.parent

# id → (texto a video, imagen a video, familia, duraciones, con_audio)
NUEVOS = {
    "h3t": ("minimax/h3-max-turbo/text-to-video", "minimax/h3-max-turbo/image-to-video",
            "minimax", (4, 6, 8), True),
    "grokv": ("xai/grok-imagine-video/text-to-video", "xai/grok-imagine-video/image-to-video",
              "grok", (4, 6, 8), True),
    "grokl": ("xai/grok-imagine-video/v1.5/lite/text-to-video", "xai/grok-imagine-video/v1.5/lite/image-to-video",
              "grok_lite", (4, 6, 8), True),
    "ltx": ("lightricks/ltx-2.5/text-to-video/fast", "lightricks/ltx-2.5/image-to-video/fast",
            "ltx", (6, 8), True),
    "kling": ("fal-ai/kling-video/v3/pro/text-to-video", "fal-ai/kling-video/v3/pro/image-to-video",
              "kling", (4, 6, 8), True),
    "seed": ("bytedance/seedance-2.0/text-to-video", "bytedance/seedance-2.0/image-to-video",
             "seedance", (4, 6, 8), True),
}
# La llave donde cada familia pide la imagen de entrada (la de Kling no es `image_url`).
LLAVE_IMAGEN = {"minimax": "image_url", "grok": "image_url", "grok_lite": "image_url", "ltx": "image_url",
                "kling": "start_image_url", "seedance": "image_url"}
# Familias cuyo endpoint de imagen a video NO tiene `aspect_ratio` (el lienzo sale de la imagen).
SIN_ASPECTO_CON_IMAGEN = {"minimax", "kling", "grok_lite"}
ASPECTO = {"horizontal": "16:9", "vertical": "9:16"}


def _fixture() -> dict:
    datos = json.loads((RAIZ / "tests" / "fixtures" / "esquemas_fal_ola4.json").read_text(encoding="utf-8"))
    return datos


def _fixture_lite() -> dict:
    return json.loads((RAIZ / "tests" / "fixtures" / "esquemas_fal_grok_lite.json").read_text(encoding="utf-8"))


def _esquemas() -> dict:
    """Los de la Ola 4 (12) y los de Grok 1.5 Lite (2): cada fila de NUEVOS trae su texto a video y su imagen a video."""
    return {k: v for k, v in {**_fixture(), **_fixture_lite()}.items() if not k.startswith("_")}


def _filas():
    from pipeline import modelos_ia
    return {i: modelos_ia.resolver("clip", i) for i in NUEVOS}


# ---------------------------------------------------------------------------
# A · las filas

@pytest.mark.parametrize("id_", sorted(NUEVOS))
def test_la_fila_trae_sus_endpoints_familia_duraciones_y_un_solo_intento(id_):
    t2v, i2v, familia, duraciones, con_audio = NUEVOS[id_]
    m = _filas()[id_]
    assert (m.tarea, m.endpoint, m.endpoint_con_imagen) == ("clip", t2v, i2v)
    assert m.endpoint_para(False) == t2v and m.endpoint_para(True) == i2v
    assert m.familia_clip == familia
    assert m.duraciones == duraciones
    assert m.con_audio is con_audio
    assert m.max_intentos == 1          # sin medir cuánto tardan, un timeout de cliente no puede cobrar dos veces
    assert not m.args_extra and not m.segundo_plano


def test_los_clips_disponibles_son_los_de_veo_y_los_seis_nuevos():
    from pipeline import modelos_ia
    assert modelos_ia.disponibles("clip") == ["veo-lite", "veo-fast", "veo-std",
                                              "h3t", "grokv", "grokl", "ltx", "kling", "seed"]
    assert modelos_ia.PREDETERMINADO["clip"] == "veo-lite"          # el predeterminado no cambió


def test_ltx_no_admite_cuatro_segundos_y_el_resto_si():
    from pipeline import modelos_ia
    with pytest.raises(modelos_ia.DuracionNoAdmitida):
        modelos_ia.valida_duracion("clip", "ltx", 4)
    assert modelos_ia.valida_duracion("clip", "ltx", 6) == 6
    for id_ in ("h3t", "grokv", "grokl", "kling", "seed"):
        assert modelos_ia.valida_duracion("clip", id_, 4) == 4


def test_cada_familia_declarada_tiene_su_armador_y_veo_se_arma_en_clip():
    from pipeline import clip_familias, modelos_ia
    assert set(modelos_ia.FAMILIAS_CLIP) - {"veo"} == set(clip_familias.ARMADORES)
    assert {m.familia_clip for m in _filas().values()} == set(clip_familias.ARMADORES)
    for id_ in ("veo-lite", "veo-fast", "veo-std"):
        assert modelos_ia.resolver("clip", id_).familia_clip == "veo"


def test_una_familia_que_no_existe_se_rechaza_al_construir_la_fila():
    from pipeline import modelos_ia
    with pytest.raises(ValueError, match="familia_clip"):
        modelos_ia.Modelo("xx", "clip", "a/b", familia_clip="otra")


@pytest.mark.parametrize("llave", ["start_image_url", "end_image_url", "image_url", "duration"])
def test_un_modelo_no_puede_fijar_la_imagen_ni_la_duracion_en_args_extra(llave):
    from pipeline import modelos_ia
    with pytest.raises(ValueError, match="lo manda la tarea"):
        modelos_ia.Modelo("xx", "clip", "a/b", args_extra={llave: "x"})


# ---------------------------------------------------------------------------
# B · Veo manda exactamente lo de siempre

@pytest.mark.parametrize("formato", ["horizontal", "vertical"])
@pytest.mark.parametrize("con_imagen", [False, True])
@pytest.mark.parametrize("id_", ["veo-lite", "veo-fast", "veo-std"])
def test_veo_manda_los_mismos_argumentos_de_siempre(id_, con_imagen, formato):
    from pipeline import clip, modelos_ia
    m = modelos_ia.resolver("clip", id_)
    esperado = {"prompt": "un perro", "aspect_ratio": ASPECTO[formato], "duration": "6s",
                "resolution": "720p", "generate_audio": True, "safety_tolerance": "6"}
    if con_imagen:
        esperado["image_url"] = "https://s3.test/a.jpg"
    assert clip.args_de_clip(m, "un perro", "https://s3.test/a.jpg" if con_imagen else None, formato, 6) == esperado


# ---------------------------------------------------------------------------
# C · lo que manda cada familia (golden) y que cabe en su esquema real

def _args(id_, con_imagen, formato="vertical", segundos=None):
    from pipeline import clip
    m = _filas()[id_]
    return clip.args_de_clip(m, "un perro corre", "https://s3.test/a.jpg" if con_imagen else None,
                             formato, segundos or m.duraciones[0])


def test_minimax_manda_la_resolucion_en_mayuscula_y_sin_aspecto_con_imagen():
    assert _args("h3t", False) == {"prompt": "un perro corre", "duration": 4, "resolution": "768P",
                                   "prompt_expansion_mode": "balanced", "aspect_ratio": "9:16"}
    assert _args("h3t", True) == {"prompt": "un perro corre", "duration": 4, "resolution": "768P",
                                  "prompt_expansion_mode": "balanced", "image_url": "https://s3.test/a.jpg"}


def test_grok_video_manda_la_duracion_entera_y_720p_sin_parametro_de_audio():
    a = _args("grokv", False)
    assert a == {"prompt": "un perro corre", "duration": 4, "resolution": "720p", "aspect_ratio": "9:16"}
    assert type(a["duration"]) is int and "generate_audio" not in a
    assert _args("grokv", True)["image_url"] == "https://s3.test/a.jpg"


def test_grok_lite_manda_720p_y_el_aspecto_solo_en_texto_a_video():
    """Lite (esquema del 12-oct-2026): su image-to-video NO tiene `aspect_ratio`, y la base sí. Es la diferencia que
    obligó a una familia propia: mandarle el aspecto con imagen es una llave que su esquema no trae."""
    sin, con = _args("grokl", False), _args("grokl", True)
    assert sin == {"prompt": "un perro corre", "duration": 4, "resolution": "720p", "aspect_ratio": "9:16"}
    assert con == {"prompt": "un perro corre", "duration": 4, "resolution": "720p", "image_url": "https://s3.test/a.jpg"}
    assert type(sin["duration"]) is int and "generate_audio" not in sin and "generate_audio" not in con
    # la base, en cambio, sí manda el aspecto con imagen
    assert _args("grokv", True)["aspect_ratio"] == "9:16"


def test_ltx_pide_720p_explicito_porque_su_valor_por_defecto_es_1080p():
    a = _args("ltx", False, "horizontal", 8)
    assert a["resolution"] == "720p" and a["generate_audio"] is True and a["aspect_ratio"] == "16:9"
    assert a["duration"] == 8


def test_kling_manda_la_duracion_como_texto_y_su_imagen_se_llama_start_image_url():
    sin, con = _args("kling", False), _args("kling", True)
    assert sin == {"prompt": "un perro corre", "duration": "4", "generate_audio": True, "aspect_ratio": "9:16"}
    assert con == {"prompt": "un perro corre", "duration": "4", "generate_audio": True,
                   "start_image_url": "https://s3.test/a.jpg"}
    assert "image_url" not in con and "resolution" not in sin and "resolution" not in con


def test_seedance_manda_la_duracion_como_texto_y_720p_explicito():
    a = _args("seed", True, "horizontal", 8)
    assert a == {"prompt": "un perro corre", "duration": "8", "resolution": "720p", "generate_audio": True,
                 "aspect_ratio": "16:9", "image_url": "https://s3.test/a.jpg"}


def test_ninguna_familia_nueva_manda_llaves_de_veo():
    for id_ in NUEVOS:
        for con_imagen in (False, True):
            a = _args(id_, con_imagen)
            assert "safety_tolerance" not in a, id_
            assert not str(a["duration"]).endswith("s"), (id_, a["duration"])      # «8s» es de Veo


@pytest.mark.parametrize("id_", sorted(NUEVOS))
def test_el_aspecto_viaja_donde_el_endpoint_lo_acepta(id_):
    familia = NUEVOS[id_][2]
    assert _args(id_, False)["aspect_ratio"] == "9:16"
    con = _args(id_, True)
    if familia in SIN_ASPECTO_CON_IMAGEN:
        assert "aspect_ratio" not in con                        # el lienzo sale de la imagen
    else:
        assert con["aspect_ratio"] == "9:16"                    # gana el formato elegido, como en Veo


@pytest.mark.parametrize("id_", sorted(NUEVOS))
def test_la_imagen_viaja_en_la_llave_de_su_familia(id_):
    familia = NUEVOS[id_][2]
    con, sin = _args(id_, True), _args(id_, False)
    assert con[LLAVE_IMAGEN[familia]] == "https://s3.test/a.jpg"
    assert not ({"image_url", "start_image_url"} & set(sin))
    otras = {"image_url", "start_image_url"} - {LLAVE_IMAGEN[familia]}
    assert not (otras & set(con))


def test_los_argumentos_fijos_de_la_fila_se_suman_a_los_de_su_familia():
    """Un clip puede fijar un argumento propio (un pin, como el 1K de Nano Banana 2) y gana al de la tarea."""
    from pipeline import clip, modelos_ia
    m = modelos_ia.Modelo("xx", "clip", "a/t2v", "a/i2v", familia_clip="kling",
                          args_extra={"cfg_scale": 0.7, "generate_audio": False}, duraciones=(4,))
    a = clip.args_de_clip(m, "un perro", None, "horizontal", 4)
    assert a["cfg_scale"] == 0.7 and a["generate_audio"] is False        # el pin gana sobre lo de la familia
    assert a["duration"] == "4" and a["prompt"] == "un perro"            # y lo de la tarea sigue ahí


def test_los_tipos_de_la_duracion_estan_confirmados_y_son_los_que_mandan_los_adaptadores():
    """La relectura del 12-oct-2026 marcó número o texto: ya no queda nada «por confirmar» en el esquema guardado."""
    esquemas = _esquemas()
    assert "por_confirmar" not in json.dumps(_fixture())
    ltx = esquemas[NUEVOS["ltx"][0]]["duration"]["enum"]
    assert ltx[:-1] == [6, 8, 10, 12, 14, 16, 18, 20] and ltx[-1] == "auto"
    assert all(type(v) is int for v in ltx[:-1])                   # [mezcla; textos: auto]
    for id_ in ("kling", "seed"):
        miembros = esquemas[NUEVOS[id_][0]]["duration"]["enum"]
        assert all(type(v) is str for v in miembros), id_          # [textos]
    for id_, tipo in (("h3t", int), ("grokv", int), ("grokl", int), ("ltx", int), ("kling", str), ("seed", str)):
        assert type(_args(id_, False)["duration"]) is tipo, id_


def test_el_esquema_guardado_dice_de_donde_sale_y_trae_los_doce_endpoints():
    datos = _fixture()
    assert "--ola4" in datos["_fuente"] and "2026-10-12" in datos["_fuente"]
    assert len({k for k in datos if not k.startswith("_")}) == 12
    esquemas = _esquemas()
    assert len(esquemas) == 14                                  # los 12 de la Ola 4 y los 2 de Grok 1.5 Lite
    for id_, (t2v, i2v, *_resto) in NUEVOS.items():
        assert t2v in esquemas and i2v in esquemas, id_
    for endpoint, esq in esquemas.items():
        assert "url" in esq["salida"], endpoint                # el clip se baja de video.url


def test_el_esquema_de_grok_lite_dice_que_esta_transcrito_y_cual_es_la_diferencia_con_la_base():
    datos = _fixture_lite()
    assert "2026-10-12" in datos["_fuente"] and "TRANSCRITOS" in datos["_fuente"]
    lite_t2v, lite_i2v = (datos[NUEVOS["grokl"][0]], datos[NUEVOS["grokl"][1]])
    assert "aspect_ratio" in lite_t2v["propiedades"] and "aspect_ratio" not in lite_i2v["propiedades"]
    base_i2v = _fixture()[NUEVOS["grokv"][1]]
    assert "aspect_ratio" in base_i2v["propiedades"]                       # la base sí lo trae con imagen
    assert lite_t2v["resolution"]["enum"] == ["480p", "720p", "1080p"] and base_i2v["resolution"]["enum"] == ["480p", "720p"]
    assert lite_t2v["duration"] == lite_i2v["duration"] == {"tipo": "integer", "min": 1, "max": 15, "por_defecto": 6}


@pytest.mark.parametrize("formato", ["horizontal", "vertical"])
@pytest.mark.parametrize("con_imagen", [False, True])
@pytest.mark.parametrize("id_", sorted(NUEVOS))
def test_lo_que_manda_cada_familia_cabe_en_su_esquema_real(id_, con_imagen, formato):
    m = _filas()[id_]
    esq = _esquemas()[m.endpoint_para(con_imagen)]
    for segundos in m.duraciones:
        a = _args(id_, con_imagen, formato, segundos)
        assert set(a) <= set(esq["propiedades"]), (id_, set(a) - set(esq["propiedades"]))
        assert set(esq["obligatorias"]) <= set(a), (id_, set(esq["obligatorias"]) - set(a))
        for llave in ("resolution", "aspect_ratio"):
            if llave in a:
                assert a[llave] in esq[llave]["enum"], (id_, llave, a[llave])
        dur = esq["duration"]
        if dur["tipo"] in ("integer", "number"):
            assert dur["min"] <= a["duration"] <= dur["max"], (id_, a["duration"])
            assert type(a["duration"]) is int or dur["tipo"] == "number"
        else:
            # el TIPO también cuenta: «4» (texto) no es 4 (entero) para fal
            assert any(a["duration"] == v and type(a["duration"]) is type(v) for v in dur["enum"]), \
                (id_, a["duration"], dur["enum"])
        if "generate_audio" in esq["propiedades"]:
            assert a["generate_audio"] is True                  # el producto promete sonido donde se puede pedir
        else:
            assert "generate_audio" not in a


@pytest.mark.parametrize("id_", ["ltx", "seed"])
def test_la_resolucion_por_defecto_de_fal_no_es_la_que_se_cobra_o_se_manda_explicita(id_):
    """LTX trae 1080p por defecto ($0.13 dólares por segundo contra $0.09 a 720p): nunca se deja al valor de fal."""
    for con_imagen in (False, True):
        m = _filas()[id_]
        esq = _esquemas()[m.endpoint_para(con_imagen)]
        assert _args(id_, con_imagen, "horizontal", m.duraciones[0])["resolution"] == "720p"
        assert "720p" in esq["resolution"]["enum"]


# ---------------------------------------------------------------------------
# D · el costo sale de los mismos argumentos

# DATOS-FAL §7 (4 s; LTX, 6 s) y la tabla de cada ficha para el resto de las duraciones
USD = {"h3t": {4: 0.096, 6: 0.144, 8: 0.192}, "grokv": {4: 0.28, 6: 0.42, 8: 0.56},
       "grokl": {4: 0.12, 6: 0.18, 8: 0.24},
       "ltx": {6: 0.54, 8: 0.72}, "kling": {4: 0.672, 6: 1.008, 8: 1.344},
       "seed": {4: 1.2136, 6: 1.8204, 8: 2.4272}}


@pytest.mark.parametrize("id_", sorted(NUEVOS))
def test_el_costo_del_clip_es_el_de_la_ficha_por_segundo(id_):
    from pipeline import clip
    for segundos, usd in USD[id_].items():
        assert clip.costo_usd(0, id_, segundos) == pytest.approx(usd, abs=1e-4), (id_, segundos)


def test_seedance_cobra_distinto_en_imagen_a_video():
    from pipeline import clip
    assert clip.costo_usd(0, "seed", 4) == pytest.approx(1.2136, abs=1e-4)
    assert clip.costo_usd(1, "seed", 4) == pytest.approx(1.2096, abs=1e-4)      # su tabla de i2v dice 0.3024


def test_grok_cobra_un_extra_por_la_imagen_de_entrada_del_image_to_video():
    """El panel de fal (12-oct-2026) cobró 0.28 dólares en texto a video y 0.282 en imagen a video de la base (4 s a
    720p): 0.002 por la imagen. Lite lo trae en su página: 0.01 por cada imagen de entrada."""
    from pipeline import clip
    assert clip.costo_usd(0, "grokv", 4) == pytest.approx(0.28, abs=1e-4)
    assert clip.costo_usd(1, "grokv", 4) == pytest.approx(0.282, abs=1e-4)
    assert clip.costo_usd(1, "grokv", 8) == pytest.approx(0.562, abs=1e-4)
    for segundos, sin, con in ((4, 0.12, 0.13), (6, 0.18, 0.19), (8, 0.24, 0.25)):
        assert clip.costo_usd(0, "grokl", segundos) == pytest.approx(sin, abs=1e-4)
        assert clip.costo_usd(1, "grokl", segundos) == pytest.approx(con, abs=1e-4)
    # los demás clips no suman nada por la imagen de entrada
    assert clip.costo_usd(1, "h3t", 4) == pytest.approx(clip.costo_usd(0, "h3t", 4), abs=1e-4)


def test_minimax_se_cobra_por_los_segundos_pedidos_y_no_por_los_entregados():
    """Panel de fal, 12-oct-2026: 0.096 dólares por cada clip (texto a video e imagen a video). Se pidieron 4 s a
    768P ($0.024 por segundo, en promoción hasta el 15-oct): 4 × 0.024. Los 4.48 s del archivo habrían sido 0.1075."""
    from pipeline import clip
    assert clip.costo_usd(0, "h3t", 4) == clip.costo_usd(1, "h3t", 4) == pytest.approx(0.096, abs=1e-4)
    assert abs(clip.costo_usd(0, "h3t", 4) - 4.48 * 0.024) > 0.01


def test_componer_dos_o_tres_imagenes_suma_lo_de_grok_a_cualquier_modelo():
    from pipeline import clip
    assert clip.costo_usd(3, "kling", 4) == pytest.approx(0.672 + 0.02 + 3 * 0.002, abs=1e-4)
    assert clip.costo_usd(2, "h3t", 8) == pytest.approx(0.192 + 0.02 + 2 * 0.002, abs=1e-4)
    # y el extra de la imagen de entrada de Grok Lite se suma UNA vez (la compuesta es una sola imagen)
    assert clip.costo_usd(3, "grokl", 4) == pytest.approx(0.12 + 0.01 + 0.02 + 3 * 0.002, abs=1e-4)


def test_una_resolucion_que_la_ficha_no_trae_es_sin_costo_conocido_y_no_el_precio_de_otra():
    """MiniMax se cobra por «768P»: con «768p» minúscula o con «720p» (la de Veo) no hay precio, no 0.024."""
    from pipeline.pricing import costo_fal
    t2v = NUEVOS["h3t"][0]
    assert costo_fal(t2v, {"duration": 4, "resolution": "768P"}) == pytest.approx(0.096)
    assert costo_fal(t2v, {"duration": 4, "resolution": "768p"}) is None
    assert costo_fal(t2v, {"duration": 4, "resolution": "720p"}) is None
    assert costo_fal(NUEVOS["ltx"][0], {"duration": "6", "resolution": "999p"}) is None


def test_kling_se_cobra_con_audio_y_sin_el_cambia_la_tarifa():
    """Kling no tiene parámetro de resolución: su ficha se lee por `resolucion_base`."""
    from pipeline.pricing import costo_fal
    t2v = NUEVOS["kling"][0]
    assert costo_fal(t2v, {"duration": "4", "generate_audio": True}) == pytest.approx(0.672)
    assert costo_fal(t2v, {"duration": "4", "generate_audio": False}) == pytest.approx(0.448)


def test_las_fichas_nuevas_dicen_que_son_lecturas_de_la_pagina_y_su_fecha():
    datos = json.loads((RAIZ / "tools" / "pricing.json").read_text(encoding="utf-8"))["generacion"]["endpoints"]
    for id_, (t2v, i2v, *_resto) in NUEVOS.items():
        for endpoint in (t2v, i2v):
            fecha = "2026-10-12" if id_ == "grokl" else "2026-10-08"       # Lite se leyó después de la prueba pagada
            assert datos[endpoint]["unidad"] == "segundo" and datos[endpoint]["verified_on"] == fecha, endpoint
    nota = datos["nota_ola4"]
    assert "INERTES" in nota and "LEÍDO" in nota and "1.5" in nota and "PEDIDOS" in nota
    assert "xai/grok-imagine-video/v1.5/text-to-video" not in datos          # la 1.5 (sin Lite) no tiene ficha
    assert "xai/grok-imagine-video/v1.5/image-to-video" not in datos


def test_las_fichas_de_grok_dicen_el_extra_por_imagen_y_las_de_minimax_su_promocion():
    datos = json.loads((RAIZ / "tools" / "pricing.json").read_text(encoding="utf-8"))["generacion"]["endpoints"]
    assert datos[NUEVOS["grokv"][1]]["usd_imagen_entrada"] == 0.002 and "usd_imagen_entrada" not in datos[NUEVOS["grokv"][0]]
    assert datos[NUEVOS["grokl"][1]]["usd_imagen_entrada"] == 0.01 and "usd_imagen_entrada" not in datos[NUEVOS["grokl"][0]]
    for endpoint in NUEVOS["grokl"][:2]:
        assert datos[endpoint]["usd_por_segundo"] == {"480p": 0.02, "720p": 0.03, "1080p": 0.14}
    for endpoint in NUEVOS["h3t"][:2]:
        assert "15-oct-2026" in datos[endpoint]["nota_promocion"] and "0.04" in datos[endpoint]["nota_promocion"]


def test_las_unidades_de_uso_para_langfuse_son_los_segundos_pedidos():
    from pipeline.pricing import unidades_fal
    assert unidades_fal(NUEVOS["kling"][0], {"duration": "6"}) == {"video_seconds": 6}
    assert unidades_fal(NUEVOS["h3t"][1], {"duration": 4}) == {"video_seconds": 4}


# ---------------------------------------------------------------------------
# E · animar: el endpoint y los argumentos de la familia, y un solo intento

def _fal_falso(monkeypatch, respuesta, error=None):
    from pipeline import fal
    visto = []

    async def llamar(app, argumentos, timeout_s, nombre, meta=None):
        visto.append({"app": app, "args": argumentos, "nombre": nombre})
        if error:
            raise error
        return respuesta

    monkeypatch.setattr(fal, "llamar", llamar)
    return visto


@pytest.mark.parametrize("con_imagen", [False, True])
@pytest.mark.parametrize("id_", sorted(NUEVOS))
def test_animar_llama_al_endpoint_de_su_fila_con_los_argumentos_de_su_familia(monkeypatch, id_, con_imagen):
    from pipeline import clip
    t2v, i2v, *_resto = NUEVOS[id_]
    visto = _fal_falso(monkeypatch, {"video": {"url": "https://fal.test/v.mp4"}})
    segundos = _filas()[id_].duraciones[0]
    url = asyncio.run(clip.animar("un perro corre", "https://s3.test/a.jpg" if con_imagen else None,
                                  "vertical", id_, segundos))
    assert url == "https://fal.test/v.mp4"
    assert len(visto) == 1
    assert visto[0]["app"] == (i2v if con_imagen else t2v)
    assert visto[0]["args"] == _args(id_, con_imagen, "vertical", segundos)
    assert visto[0]["nombre"] == f"clip-{id_}"


def test_veo_conserva_su_nombre_en_langfuse(monkeypatch):
    from pipeline import clip
    visto = _fal_falso(monkeypatch, {"video": {"url": "https://fal.test/v.mp4"}})
    asyncio.run(clip.animar("un perro", None, "horizontal", "veo-lite", 4))
    assert visto[0]["nombre"] == "veo"


@pytest.mark.parametrize("id_", sorted(NUEVOS))
def test_si_fal_falla_se_intenta_una_sola_vez_y_el_error_dice_el_modelo(monkeypatch, caplog, id_):
    from pipeline import clip, fal
    visto = _fal_falso(monkeypatch, None, error=fal.FalError("boom"))
    with caplog.at_level("WARNING"), pytest.raises(clip.ClipError, match="boom"):
        asyncio.run(clip.animar("un perro", None, "horizontal", id_, _filas()[id_].duraciones[0]))
    assert len(visto) == 1
    assert f"{id_} falló en el clip" in caplog.text


@pytest.mark.parametrize("id_", sorted(NUEVOS))
def test_una_respuesta_sin_video_es_un_error_con_el_nombre_del_modelo(monkeypatch, id_):
    from pipeline import clip
    _fal_falso(monkeypatch, {"seed": 1})
    with pytest.raises(clip.ClipError, match=f"{id_} no devolvió video"):
        asyncio.run(clip.animar("un perro", None, "horizontal", id_, _filas()[id_].duraciones[0]))


def test_animar_con_una_duracion_que_el_modelo_no_admite_no_llama_a_fal(monkeypatch):
    from pipeline import clip, modelos_ia
    visto = _fal_falso(monkeypatch, {"video": {"url": "x"}})
    with pytest.raises(modelos_ia.DuracionNoAdmitida):
        asyncio.run(clip.animar("un perro", None, "horizontal", "ltx", 4))
    assert visto == []


# ---------------------------------------------------------------------------
# F · inertes: sin número en tarifas.json no se vende

def _tarifas() -> dict:
    return json.loads((RAIZ / "tools" / "tarifas.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("id_", sorted(NUEVOS))
def test_ninguno_de_los_seis_tiene_numero_en_tarifas_y_el_servidor_los_rechaza(id_):
    from pipeline import creditos
    assert id_ not in _tarifas()["modelos"]["clip"]
    for segundos in NUEVOS[id_][3]:
        with pytest.raises(KeyError):
            creditos.costo_modelo("clip", id_, segundos)


def test_el_catalogo_de_la_web_los_deja_apagados():
    texto = (RAIZ / "web" / "src" / "pantallas" / "inicio" / "modelos.ts").read_text(encoding="utf-8")
    for id_ in NUEVOS:
        linea = next(l for l in texto.splitlines() if f"id: '{id_}'" in l)
        assert "activo: false" in linea, id_


# ---------------------------------------------------------------------------
# G · la prueba pagada mide lo que la familia promete, no lo de Veo

def _probar():
    import importlib.util
    spec = importlib.util.spec_from_file_location("probar_modelo", RAIZ / "tools" / "probar_modelo.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _plan(id_, segundos=None, formato="horizontal"):
    probar = _probar()
    m = _filas()[id_]
    return probar, probar.Plan("clip", m, "un perro", None, formato, segundos or m.duraciones[0],
                               Path("work/probar_modelo/x"))


def _medida(ancho, alto, segundos, audio=True):
    return {"ancho": ancho, "alto": alto, "segundos": segundos, "audio": audio,
            "codec_audio": "aac" if audio else None, "codec": "h264"}


@pytest.mark.parametrize("id_,res", [("h3t", "768P"), ("grokv", "720p"), ("grokl", "720p"), ("ltx", "720p"), ("seed", "720p"),
                                     ("kling", "")])
def test_la_resolucion_que_se_compara_es_la_que_manda_el_adaptador(id_, res):
    probar, plan = _plan(id_)
    assert probar._resolucion_pedida(plan) == res


def test_minimax_a_768_no_da_un_revisar_falso_por_no_medir_720():
    probar, plan = _plan("h3t", 4)
    # lo que llegó de verdad en la prueba pagada del 12-oct-2026: 1344×768, 4.48 s, con audio
    assert probar._veredicto(plan, _medida(1344, 768, 4.48)) == []
    dif = probar._veredicto(plan, _medida(1280, 720, 4.0))                     # 720 NO es 768P
    assert any("se pidió 768P y el lado corto mide 720" in d for d in dif)


def test_kling_no_promete_resolucion_asi_que_su_tamano_solo_se_enseña():
    probar, plan = _plan("kling", 4)
    assert probar._veredicto(plan, _medida(1920, 1080, 4.0)) == []
    assert probar._veredicto(plan, _medida(1280, 720, 4.0)) == []


def test_grok_a_720_se_marca_si_llega_otra_resolucion():
    probar, plan = _plan("grokv", 4)
    assert probar._veredicto(plan, _medida(1280, 720, 4.0)) == []
    assert any("se pidió 720p y el lado corto mide 480" in d for d in probar._veredicto(plan, _medida(854, 480, 4.0)))


@pytest.mark.parametrize("id_", sorted(NUEVOS))
def test_una_fila_que_promete_audio_se_marca_sin_pista(id_):
    """Las seis prometen audio (MiniMax y la base de Grok lo trajeron en sus llamadas pagadas; Lite lo supone y la prueba
    pagada lo confirma): un clip sin pista es REVISAR."""
    probar, plan = _plan(id_)
    segundos = plan.segundos
    assert any("NO trae pista de audio" in d
               for d in probar._veredicto(plan, _medida(1366, 768, float(segundos), audio=False)))


def test_una_fila_que_no_promete_audio_no_se_marca_por_no_traerlo():
    from pipeline import modelos_ia
    probar = _probar()
    m = modelos_ia.Modelo("xx", "clip", "a/t2v", "a/i2v", familia_clip="minimax",
                          con_audio=False, duraciones=(4,))
    plan = probar.Plan("clip", m, "x", None, "horizontal", 4, Path("w"))
    assert not any("audio" in d for d in probar._veredicto(plan, _medida(1344, 768, 4.0, audio=False)))


def test_minimax_midio_audio_en_la_prueba_pagada_y_la_fila_lo_promete():
    assert _filas()["h3t"].con_audio is True


@pytest.mark.parametrize("ancho,alto,hay_revisar", [
    (1280, 720, False),        # Grok texto a video: 720 exacto
    (1280, 704, False),        # Grok imagen a video (12-oct-2026): alineado a múltiplos de 16
    (1280, 736, False),
    (854, 480, True),          # otra resolución
    (1920, 1080, True),
    (960, 540, True),
])
def test_un_lado_corto_alineado_a_16_px_no_es_otra_resolucion(ancho, alto, hay_revisar):
    probar, plan = _plan("grokv", 4)
    dif = probar._veredicto(plan, _medida(ancho, alto, 4.04))
    assert any("lado corto mide" in d for d in dif) is hay_revisar, (ancho, alto, dif)


def test_veo_conserva_su_veredicto_de_siempre():
    probar = _probar()
    from pipeline import modelos_ia
    plan = probar.Plan("clip", modelos_ia.resolver("clip", "veo-lite"), "x", None, "horizontal", 4, Path("w"))
    assert probar._veredicto(plan, _medida(1280, 720, 4.0)) == []
    assert any("se pidió 720p y el lado corto mide 1080" in d
               for d in probar._veredicto(plan, _medida(1920, 1080, 4.0)))
