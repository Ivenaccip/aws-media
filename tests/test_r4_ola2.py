"""R4 · Ola 2 — imágenes de familias nuevas (FLUX.2, Z-Image, Seedream, FLUX 3; GPT Image sigue fuera).

Seis filas INERTES: FLUX.2 klein 9B, Z-Image Turbo, FLUX.2 pro, Seedream 5.0 Flash,
Seedream 4.5 y FLUX 3. Ninguna tiene número en tools/tarifas.json ni `activo: true` en la web.

Lo que cambia respecto a la Ola 1: Grok y Nano Banana piden el tamaño con
`aspect_ratio` («16:9»); FLUX.2, Z-Image y Seedream no lo entienden y piden
`image_size` con valores propios («square_hd», «landscape_16_9», {ancho, alto}…). Cada fila
declara cómo lo pide (`llave_tamano`, `tamanos`) y `Modelo.args_de_imagen` traduce el
aspecto de la caja. FLUX.2 pro y FLUX 3 no traen `num_images` (`con_num_images=False`).

Lo que este archivo defiende:
  * la tabla EXACTA de modelos de hoy (y los que siguen fuera);
  * que la traducción sea total: cada aspecto de la caja tiene valor en cada modelo
    de `image_size`, y un aspecto que la caja no conozca es un error del pedido, no un
    cambio silencioso a otro;
  * EL CONTRATO CON FAL: lo que cada fila manda cabe en el esquema que fal publicó el
    11-oct-2026 (tests/fixtures/esquemas_fal_ola2.json): llaves que existen, valores del
    enum, `num_images` solo donde el endpoint lo trae, los mínimos de píxeles de Seedream;
  * que Grok y Nano Banana 2 manden exactamente los mismos argumentos de siempre;
  * que un modelo de solo texto a imagen no reciba una imagen de referencia;
  * LA COMPUERTA de las seis: sin número en tools/tarifas.json, 422 antes de cobrar, de
    crear nada o de llamar a fal; y que escribir el número sea lo único que falta;
  * que el costo salga de la ficha de pricing.json por endpoint exacto.

Sin red: fal, S3 y el monedero mockeados.

OJO: nada de importar pipeline/server a nivel de módulo (ver test_m25_clip)."""
import asyncio
import copy
import dataclasses
import json
import math
import pickle
import sys
from fractions import Fraction
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

RAIZ = Path(__file__).resolve().parent.parent

# Los modelos de la Ola 2 que ya tienen fila: id -> endpoint de crear
ENDPOINTS = {
    "klein": "fal-ai/flux-2/klein/9b",
    "zit": "fal-ai/z-image/turbo",
    "flux2": "fal-ai/flux-2-pro",
    "sdf": "bytedance/seedream/v5/flash/text-to-image",
    "sd45": "fal-ai/bytedance/seedream/v4.5/text-to-image",
    "flux3": "blackforestlabs/flux-3/text-to-image",
}
IDS = tuple(ENDPOINTS)
OLA2 = {("imagen", id_): ep for id_, ep in ENDPOINTS.items()}
# Los que HOY no tienen número en tarifas.json. Cuando el dueño enciende uno (número en
# tarifas.json + `activo: true` en la web) se saca de aquí: el test
# `test_hoy_tarifas_json_no_trae_numero_para_los_inertes` es el aviso de que la compuerta
# se abrió a propósito.
INERTES = set(OLA2)
# dólares por imagen de cada modelo (pricing.json) y su propuesta de créditos
USD = {"klein": 0.006, "zit": 0.005, "flux2": 0.03, "sdf": 0.027, "sd45": 0.04, "flux3": 0.024}
PROPUESTA = {"klein": 2, "zit": 2, "flux2": 4, "sdf": 4, "sd45": 4, "flux3": 4}
# klein es lo MEDIDO en el panel (9-oct); las otras cinco, lo LEÍDO en la página (8-oct)
VERIFICADO = {"klein": "2026-10-09", "zit": "2026-10-08", "flux2": "2026-10-08", "sdf": "2026-10-08",
              "sd45": "2026-10-08", "flux3": "2026-10-08"}
# lo que la caja sabe pedir (server/app.py::ASPECTOS_IMAGEN) y su valor en la familia FLUX.2 / Z-Image
ASPECTOS = {"1:1": "square_hd", "16:9": "landscape_16_9", "9:16": "portrait_16_9"}
# Seedream pide pares explícitos: sus presets no alcanzan el mínimo de píxeles del esquema
PAR = lambda w, h: {"width": w, "height": h}          # noqa: E731
TAMANOS = {
    "klein": ASPECTOS, "zit": ASPECTOS, "flux2": ASPECTOS,
    "sdf": {"1:1": PAR(1920, 1920), "16:9": PAR(2048, 1152), "9:16": PAR(1152, 2048)},
    "sd45": {"1:1": PAR(2048, 2048), "16:9": PAR(2752, 1536), "9:16": PAR(1536, 2752)},
}
JPEG = {"output_format": "jpeg"}
# los argumentos fijos de cada fila (el pin), y si el endpoint trae `num_images`
EXTRA = {"klein": JPEG, "zit": JPEG, "flux2": JPEG, "sdf": JPEG, "sd45": {},
         "flux3": {**JPEG, "resolution": "1k"}}
CON_NUM_IMAGES = {"klein": True, "zit": True, "flux2": False, "sdf": True, "sd45": True, "flux3": False}
# megapíxeles hasta donde vale el costo de la ficha (0 = precio fijo por imagen)
MP_FICHA = {"klein": 1.2, "zit": 1.2, "flux2": 1.2, "sdf": 0.0, "sd45": 0.0, "flux3": 1.2}


def _esperado(id_: str, aspecto: str, prompt: str = "un gato") -> dict:
    """Los argumentos COMPLETOS que debe llevar la llamada a fal (tarea + pin del modelo)."""
    args = {"prompt": prompt}
    if CON_NUM_IMAGES[id_]:
        args["num_images"] = 1
    if id_ == "flux3":
        args["aspect_ratio"] = aspecto
    else:
        args["image_size"] = TAMANOS[id_][aspecto]
    return {**args, **EXTRA[id_]}


def _esquemas() -> dict:
    return json.loads((RAIZ / "tests" / "fixtures" / "esquemas_fal_ola2.json").read_text(encoding="utf-8"))


def _pricing() -> dict:
    return json.loads((RAIZ / "tools" / "pricing.json").read_text(encoding="utf-8"))


def _tarifas() -> dict:
    return json.loads((RAIZ / "tools" / "tarifas.json").read_text(encoding="utf-8"))


# ---------------------------------------------------------------------------
# la tabla

def test_la_tabla_trae_exactamente_estos_modelos():
    """La lista EXACTA de hoy. Nano Banana 2 Lite (`nbl`) no entra (cobra por tokens y
    no hay precio); Nano Banana Pro es de la Ola 3 y los clips de otras familias, de la 4."""
    from pipeline import modelos_ia
    assert modelos_ia.disponibles("imagen") == ["grok", *IDS, "nb2"]
    assert modelos_ia.disponibles("editar") == ["grok", "nb2"]
    assert modelos_ia.disponibles("clip") == ["veo-lite", "veo-fast", "veo-std"]
    # GPT Image (Ola 2, pendiente de decisiones del dueño), Nano Banana Lite y Pro, y los clips
    # de otras familias siguen sin fila; ninguna de las seis entra al editor
    fuera = [("imagen", "nbl"), ("editar", "nbl"), ("imagen", "nbp"), ("imagen", "gpt2"),
             ("imagen", "gpt25"), ("editar", "gpt2"), ("clip", "kling")]
    fuera += [("editar", id_) for id_ in IDS]
    for tarea, id_ in fuera:
        with pytest.raises(modelos_ia.ModeloDesconocido):
            modelos_ia.resolver(tarea, id_)


@pytest.mark.parametrize("id_", IDS)
def test_las_filas_de_la_ola_2_traen_su_endpoint_su_tamano_y_su_pin(id_):
    from pipeline import modelos_ia
    m = modelos_ia.resolver("imagen", id_)
    assert (m.id, m.tarea) == (id_, "imagen")
    assert m.endpoint == ENDPOINTS[id_]
    assert m.endpoint_para(False) == m.endpoint_para(True) == m.endpoint
    assert m.admite_referencia is False                  # solo texto a imagen
    assert m.con_num_images is CON_NUM_IMAGES[id_]
    assert m.llave_tamano == ("aspect_ratio" if id_ == "flux3" else "image_size")
    assert dict(m.args_extra) == EXTRA[id_]
    assert m.megapixeles_ficha == MP_FICHA[id_]
    assert not m.duraciones and m.max_intentos == 0


@pytest.mark.parametrize("id_", ["klein", "zit", "flux2"])
def test_la_familia_flux_2_y_z_image_usan_los_presets_de_fal(id_):
    from pipeline import modelos_ia
    assert dict(modelos_ia.resolver("imagen", id_).tamanos) == ASPECTOS


@pytest.mark.parametrize("id_", ["sdf", "sd45"])
def test_seedream_pide_pares_explicitos_y_no_presets(id_):
    """Los presets (landscape_16_9…) no alcanzan el mínimo de píxeles del esquema de Seedream."""
    from pipeline import modelos_ia
    m = modelos_ia.resolver("imagen", id_)
    assert all(isinstance(v, tuple) for _, v in m.tamanos)
    assert {a: {"width": v[0], "height": v[1]} for a, v in m.tamanos} == TAMANOS[id_]


def test_flux_3_pide_el_aspecto_tal_cual_y_fija_su_1k():
    from pipeline import modelos_ia
    m = modelos_ia.resolver("imagen", "flux3")
    assert (m.llave_tamano, m.tamanos, m.con_num_images) == ("aspect_ratio", (), False)
    assert dict(m.args_extra) == {"output_format": "jpeg", "resolution": "1k"}


def test_la_4b_de_klein_no_existe():
    """La 4B quedó descartada el 9-oct (misma tarifa de 2 créditos, la 9B es más grande)."""
    from pipeline import modelos_ia
    assert "4b" not in modelos_ia.resolver("imagen", "klein").endpoint


def test_los_modelos_de_antes_siguen_pidiendo_el_aspecto_tal_cual():
    from pipeline import modelos_ia
    for tarea, id_ in (("imagen", "grok"), ("imagen", "nb2"), ("editar", "grok"),
                       ("editar", "nb2"), ("clip", "veo-lite"), ("clip", "veo-fast")):
        m = modelos_ia.resolver(tarea, id_)
        assert (m.llave_tamano, m.tamanos, m.con_num_images) == ("aspect_ratio", (), True), id_
    for id_ in ("grok", "nb2"):
        assert modelos_ia.resolver("imagen", id_).admite_referencia is True


def test_los_aspectos_de_la_caja_son_los_que_traduce_cada_modelo():
    """Si la caja aprende un formato nuevo (server/app.py::ASPECTOS_IMAGEN), cada
    modelo de `image_size` tiene que aprender su valor: este test avisa."""
    import server.app as app_mod
    from pipeline import modelos_ia
    assert set(modelos_ia.ASPECTOS_CAJA) == set(app_mod.ASPECTOS_IMAGEN.values())
    assert set(modelos_ia.ASPECTOS_CAJA) == set(ASPECTOS)


# ---------------------------------------------------------------------------
# la traducción del tamaño

@pytest.mark.parametrize("aspecto", sorted(ASPECTOS))
@pytest.mark.parametrize("id_", IDS)
def test_cada_fila_arma_los_argumentos_exactos_de_su_familia(id_, aspecto):
    """La tarea (`args_de_imagen`) más el pin del modelo (`con_args_extra`) = lo que llega a fal."""
    from pipeline import modelos_ia
    m = modelos_ia.resolver("imagen", id_)
    args = m.con_args_extra(m.args_de_imagen("un gato", aspecto))
    assert args == _esperado(id_, aspecto)
    if id_ != "flux3":
        assert "aspect_ratio" not in args
    if not CON_NUM_IMAGES[id_]:
        assert "num_images" not in args


@pytest.mark.parametrize("aspecto", sorted(ASPECTOS))
@pytest.mark.parametrize("id_", ["grok", "nb2"])
def test_grok_y_nano_banana_mandan_exactamente_lo_de_siempre(id_, aspecto):
    from pipeline import modelos_ia
    args = modelos_ia.resolver("imagen", id_).args_de_imagen("un gato", aspecto)
    assert args == {"prompt": "un gato", "num_images": 1, "aspect_ratio": aspecto}


def test_con_aspect_ratio_cualquier_aspecto_viaja_tal_cual():
    """Es lo que hacía imagen_fal antes de la Ola 2: no se valida (el b-roll y M1 mandan los suyos)."""
    from pipeline import modelos_ia
    args = modelos_ia.resolver("imagen", "grok").args_de_imagen("x", "21:9")
    assert args["aspect_ratio"] == "21:9"


@pytest.mark.parametrize("id_", [i for i in IDS if i != "flux3"])
def test_un_aspecto_que_el_modelo_no_traduce_es_un_error_del_pedido(id_):
    from pipeline import modelos_ia
    m = modelos_ia.resolver("imagen", id_)
    with pytest.raises(modelos_ia.AspectoNoAdmitido) as err:
        m.args_de_imagen("x", "21:9")
    assert isinstance(err.value, modelos_ia.ModeloDesconocido)     # un solo except lo cubre
    assert id_ in str(err.value) and "21:9" in str(err.value)


def test_sin_num_images_no_se_manda():
    """FLUX 3 no documenta `num_images`: se le quita, en vez de mandarlo y esperar que fal lo ignore."""
    from pipeline import modelos_ia
    m = modelos_ia.Modelo("x", "imagen", "ep", llave_tamano="aspect_ratio", con_num_images=False)
    assert m.args_de_imagen("x", "1:1") == {"prompt": "x", "aspect_ratio": "1:1"}


def test_un_tamano_en_pixeles_sale_como_ancho_y_alto():
    """GPT Image pide tamaños concretos (1024×1024, 1920×1080): un par (ancho, alto) sale
    como el objeto que fal espera."""
    from pipeline import modelos_ia
    m = modelos_ia.Modelo("x", "imagen", "ep", llave_tamano="image_size",
                          tamanos={"1:1": (1024, 1024), "16:9": (1920, 1080), "9:16": (1080, 1920)})
    assert m.args_de_imagen("x", "16:9")["image_size"] == {"width": 1920, "height": 1080}
    assert m.args_de_imagen("x", "1:1")["image_size"] == {"width": 1024, "height": 1024}


# ---------------------------------------------------------------------------
# las filas mal armadas se rechazan al construirlas

def _fila(**kw):
    from pipeline import modelos_ia
    base = dict(id="x", tarea="imagen", endpoint="ep", llave_tamano="image_size",
                tamanos=tuple(ASPECTOS.items()))
    base.update(kw)
    return modelos_ia.Modelo(**base)


def test_una_fila_bien_armada_se_construye_venga_como_venga_la_tabla():
    a = _fila(tamanos=tuple(ASPECTOS.items()))
    b = _fila(tamanos=dict(reversed(list(ASPECTOS.items()))))
    c = _fila(tamanos=[list(p) for p in ASPECTOS.items()])
    assert a == b == c
    assert a.tamanos == tuple(sorted(ASPECTOS.items()))


@pytest.mark.parametrize("malo,motivo", [
    (dict(llave_tamano="size"), "llave_tamano"),
    (dict(llave_tamano="aspect_ratio", tamanos=(("1:1", "square_hd"),)), "no lleva tabla"),
    (dict(tamanos=()), "falta la traducción"),
    (dict(tamanos=(("1:1", "square_hd"), ("16:9", "landscape_16_9"))), "9:16"),
    (dict(tamanos=tuple(ASPECTOS.items()) + (("4:3", "landscape_4_3"),)), "no es un aspecto"),
    (dict(tamanos=tuple(ASPECTOS.items()) + (("1:1", "square"),)), "repetido"),
    (dict(tamanos=(("1:1", ""), ("16:9", "a"), ("9:16", "b"))), "debe ser un texto"),
    (dict(tamanos=(("1:1", None), ("16:9", "a"), ("9:16", "b"))), "debe ser un texto"),
    (dict(tamanos=(("1:1", (1024, 0)), ("16:9", "a"), ("9:16", "b"))), "enteros positivos"),
    (dict(tamanos=(("1:1", (1024,)), ("16:9", "a"), ("9:16", "b"))), "enteros positivos"),
    (dict(tamanos=(("1:1", (1024.0, 1024)), ("16:9", "a"), ("9:16", "b"))), "enteros positivos"),
    (dict(tamanos=(("1:1", {"width": 1}), ("16:9", "a"), ("9:16", "b"))), "debe ser"),
    (dict(megapixeles_ficha=-1), "megapixeles_ficha"),
    (dict(megapixeles_ficha=True), "megapixeles_ficha"),
    (dict(megapixeles_ficha="1"), "megapixeles_ficha"),
    (dict(megapixeles_ficha=float("nan")), "megapixeles_ficha"),
])
def test_una_tabla_de_tamanos_mal_armada_se_rechaza(malo, motivo):
    with pytest.raises((ValueError, TypeError)) as err:
        _fila(**malo)
    assert motivo in str(err.value)


def test_un_modelo_no_puede_fijar_el_image_size_con_args_extra():
    """`image_size` lo manda la tarea (con la traducción del aspecto): fijarlo en
    args_extra pisaría el formato que el usuario pidió y se cobró."""
    from pipeline import modelos_ia
    assert "image_size" in modelos_ia.LLAVES_PROTEGIDAS
    with pytest.raises(ValueError, match="image_size"):
        _fila(args_extra={"image_size": "square"})


@pytest.mark.parametrize("id_", IDS)
def test_los_modelos_con_image_size_se_copian_y_se_serializan(id_):
    from pipeline import modelos_ia
    m = modelos_ia.resolver("imagen", id_)
    assert copy.deepcopy(m) == m and pickle.loads(pickle.dumps(m)) == m
    assert dataclasses.asdict(m)["tamanos"] == m.tamanos
    assert hash(m) == hash(copy.deepcopy(m))


# ---------------------------------------------------------------------------
# imagen_fal: lo que llega a fal

class _Llamadas(list):
    """Las llamadas a fal.llamar; `.subidas` anota además lo que se subió al CDN de fal."""

    def __init__(self):
        super().__init__()
        self.subidas = []


@pytest.fixture
def falso_fal(monkeypatch):
    """Registra cada llamada a fal (y cada subida) en vez de hacerla."""
    from pipeline import fal
    llamadas = _Llamadas()

    async def llamar(app, argumentos, timeout_s, nombre, meta=None):
        llamadas.append(SimpleNamespace(app=app, args=argumentos, nombre=nombre))
        return {"images": [{"url": "https://fal.test/x.jpg"}]}

    async def subir_archivo(path):
        llamadas.subidas.append(Path(path).name)
        return f"https://fal.test/subida/{Path(path).name}"

    async def descargar(url, destino):
        Path(destino).write_bytes(b"x")
    monkeypatch.setattr(fal, "llamar", llamar)
    monkeypatch.setattr(fal, "subir_archivo", subir_archivo)
    monkeypatch.setattr(fal, "descargar", descargar)
    return llamadas


@pytest.mark.parametrize("aspecto", sorted(ASPECTOS))
@pytest.mark.parametrize("id_", IDS)
def test_imagen_fal_llama_al_endpoint_de_cada_modelo_con_sus_argumentos(falso_fal, tmp_path, id_, aspecto):
    from pipeline import media_fal
    url = asyncio.run(media_fal.imagen_fal("un gato", tmp_path / "a.jpg", aspecto=aspecto, modelo=id_))
    assert url == "https://fal.test/x.jpg" and (tmp_path / "a.jpg").exists()
    (ll,) = falso_fal
    assert ll.app == ENDPOINTS[id_]
    assert ll.args == _esperado(id_, aspecto)


@pytest.mark.parametrize("id_", IDS)
def test_imagen_fal_sin_aspecto_es_cuadrada(falso_fal, tmp_path, id_):
    from pipeline import media_fal
    asyncio.run(media_fal.imagen_fal("un gato", tmp_path / "a.jpg", modelo=id_))
    assert falso_fal[0].args == _esperado(id_, "1:1")


@pytest.mark.parametrize("id_", IDS)
def test_imagen_fal_no_le_manda_una_referencia_a_un_modelo_de_solo_texto(falso_fal, tmp_path, id_):
    """No se sube nada, no se llama a fal y no se cae en silencio a otro modelo."""
    from pipeline import media_fal, modelos_ia
    ref = tmp_path / "ref.png"
    ref.write_bytes(b"\x89PNG-de-prueba")
    with pytest.raises(modelos_ia.ModeloDesconocido, match="no admite imagen de referencia"):
        asyncio.run(media_fal.imagen_fal("un gato", tmp_path / "a.jpg", referencia=ref,
                                         modelo=id_))
    assert falso_fal == [] and falso_fal.subidas == [] and not (tmp_path / "a.jpg").exists()


@pytest.mark.parametrize("id_", [i for i in IDS if i != "flux3"])
def test_imagen_fal_con_un_aspecto_sin_traduccion_no_cambia_a_otro_en_silencio(falso_fal, tmp_path, id_):
    """La invariante vive en el adaptador que gasta el dinero, no solo en `args_de_imagen`:
    un aspecto que el modelo no traduce NO cae en 1:1 (se cobraría un cuadrado que nadie pidió)."""
    from pipeline import media_fal, modelos_ia
    with pytest.raises(modelos_ia.AspectoNoAdmitido):
        asyncio.run(media_fal.imagen_fal("un gato", tmp_path / "a.jpg", aspecto="21:9", modelo=id_))
    assert falso_fal == [] and falso_fal.subidas == [] and not (tmp_path / "a.jpg").exists()


@pytest.mark.parametrize("modelo,endpoint", [("grok", None), ("nb2", "fal-ai/nano-banana-2")])
def test_grok_y_nano_banana_2_llaman_igual_que_antes(falso_fal, tmp_path, modelo, endpoint):
    from pipeline import media_fal
    asyncio.run(media_fal.imagen_fal("un gato", tmp_path / "a.jpg", aspecto="9:16", modelo=modelo))
    (ll,) = falso_fal
    esperado = {"prompt": "un gato", "num_images": 1, "aspect_ratio": "9:16"}
    if modelo == "nb2":
        esperado["resolution"] = "1K"
        assert ll.app == endpoint
    assert ll.args == esperado


def test_imagen_fal_sin_modelo_sigue_siendo_grok(falso_fal, tmp_path):
    from pipeline import media_fal
    asyncio.run(media_fal.imagen_fal("un gato", tmp_path / "a.jpg"))
    (ll,) = falso_fal
    assert ll.args == {"prompt": "un gato", "num_images": 1, "aspect_ratio": "1:1"}


@pytest.mark.parametrize("id_", IDS)
def test_el_pincel_y_transformar_no_aceptan_ninguno_de_la_ola_2(falso_fal, tmp_path, id_):
    """Ninguno tiene fila en «editar»: el editor no puede llamarlos ni por error."""
    from pipeline import media_fal, modelos_ia
    img = tmp_path / "a.png"
    img.write_bytes(b"\x89PNG-de-prueba")
    with pytest.raises(modelos_ia.ModeloDesconocido):
        asyncio.run(media_fal.imagen_transformar("acuarela", img, tmp_path / "o.jpg", modelo=id_))
    with pytest.raises(modelos_ia.ModeloDesconocido):
        asyncio.run(media_fal.imagen_pincel("acuarela", img, img, tmp_path / "o.jpg", modelo=id_))
    assert falso_fal == []


# ---------------------------------------------------------------------------
# el costo: ficha por endpoint exacto

@pytest.mark.parametrize("id_", IDS)
def test_la_ficha_de_cada_modelo_es_la_que_dice_su_origen(id_):
    """Klein, medido en el panel de fal; las otras cinco, leídas en la página y por confirmar."""
    ficha = _pricing()["generacion"]["endpoints"][ENDPOINTS[id_]]
    assert ficha == {"unidad": "imagen", "usd": USD[id_], "verified_on": VERIFICADO[id_]}


def test_la_4b_de_klein_no_tiene_ficha_y_jamas_se_cotiza_con_la_de_la_9b():
    from pipeline import pricing
    assert "fal-ai/flux-2/klein/4b" not in _pricing()["generacion"]["endpoints"]
    assert pricing.costo_fal("fal-ai/flux-2/klein/4b", {"prompt": "x", "num_images": 1}) is None


@pytest.mark.parametrize("aspecto", sorted(ASPECTOS))
@pytest.mark.parametrize("id_", IDS)
def test_costo_fal_es_la_ficha_con_los_argumentos_reales(id_, aspecto):
    """El costo que se anota en Langfuse sale de los MISMOS argumentos que van a fal. Los que
    cobran por megapíxel se anotan a ~1 MP (techo de la peor corrida que se espera, por comprobar
    en la prueba pagada); FLUX.2 pro y FLUX 3 no mandan `num_images`: cuentan una imagen."""
    from pipeline import modelos_ia, pricing
    m = modelos_ia.resolver("imagen", id_)
    args = m.con_args_extra(m.args_de_imagen("x", aspecto))
    assert pricing.costo_fal(ENDPOINTS[id_], args) == USD[id_]
    if CON_NUM_IMAGES[id_]:
        assert pricing.costo_fal(ENDPOINTS[id_], {**args, "num_images": 2}) == round(2 * USD[id_], 4)
    assert pricing.unidades_fal(ENDPOINTS[id_], args) == {"images": 1, "reference_images": 0}


def test_la_formula_de_la_hoja_de_costos_reproduce_la_propuesta():
    """costo ÷ 0.75 ÷ $0.015 dólares, hacia arriba, al par, mínimo 2 por imagen. Con
    Fraction a propósito: con floats los redondeos hacia arriba se equivocan."""
    for id_, usd in USD.items():
        n = math.ceil(Fraction(str(usd)) / Fraction(75, 100) / Fraction(15, 1000))
        n = max(2, n + (n % 2))
        assert n == PROPUESTA[id_], id_
        assert Fraction(n) * Fraction(15, 1000) * Fraction(75, 100) >= Fraction(str(usd))


def test_flux_2_pro_cubre_el_peor_cobro_con_los_mismos_creditos():
    """1024×1024 son 1.05 MP: $0.03 más $0.015 por MP extra da entre $0.03075 (proporcional) y
    $0.045 (si el megapíxel cuenta entero). Los 4 créditos propuestos cubren los dos con margen."""
    for usd in (Fraction(3, 100), Fraction(3075, 100000), Fraction(45, 1000)):
        n = math.ceil(usd / Fraction(75, 100) / Fraction(15, 1000))
        assert max(2, n + (n % 2)) == PROPUESTA["flux2"] == 4
        assert Fraction(PROPUESTA["flux2"]) * Fraction(15, 1000) * Fraction(75, 100) >= usd


def test_la_nota_de_la_ola_2_dice_dolares_y_nunca_centavos_ni_inventa_mediciones():
    nota = " ".join(_pricing()["generacion"]["endpoints"]["nota_ola2"].split())
    assert "centavos" not in nota.lower()
    assert "MEDIDO en el panel" in nota and "NO están medidas todavía" in nota
    for cifra in ("$0.006", "$0.005", "$0.03", "$0.027", "$0.04", "$0.024", "$0.015"):
        assert cifra in nota, cifra
    import re
    # regla del dueño: «$X.XX dólares»; toda cifra con $ va seguida de «dólares»
    cifras = list(re.finditer(r"\$\d+\.\d+", nota))
    assert len(cifras) >= 10
    for m in cifras:
        assert nota[m.end():].startswith(" dólares"), nota[m.start():m.end() + 25]


# ---------------------------------------------------------------------------
# EL CONTRATO CON FAL: lo que cada fila manda cabe en el esquema que fal publicó

def test_el_esquema_guardado_dice_de_donde_sale():
    datos = _esquemas()
    assert "tools/leer_esquema_fal.py" in datos["_fuente"] and "2026-10-11" in datos["_fuente"]
    for id_ in IDS:
        assert ENDPOINTS[id_] in datos, id_
        assert datos[ENDPOINTS[id_]]["obligatorias"] == ["prompt"]


@pytest.mark.parametrize("aspecto", sorted(ASPECTOS))
@pytest.mark.parametrize("id_", IDS)
def test_lo_que_se_manda_cabe_en_el_esquema_de_fal(id_, aspecto):
    """Cada llave existe en el endpoint, cada valor está en su enum, `num_images` va solo donde el
    endpoint lo trae y dentro de su rango, y las obligatorias están."""
    from pipeline import modelos_ia
    esq = _esquemas()[ENDPOINTS[id_]]
    m = modelos_ia.resolver("imagen", id_)
    args = m.con_args_extra(m.args_de_imagen("un gato", aspecto))
    assert set(args) <= set(esq["propiedades"]), set(args) - set(esq["propiedades"])
    assert set(esq["obligatorias"]) <= set(args)
    assert ("num_images" in args) == ("num_images" in esq["propiedades"]) == CON_NUM_IMAGES[id_]
    if "num_images" in args:
        assert esq["num_images"]["min"] <= args["num_images"] <= esq["num_images"]["max"]
    for llave in ("aspect_ratio", "resolution", "output_format"):
        if llave in args:
            assert args[llave] in esq[llave]["enum"], (llave, args[llave])
    tam = args.get("image_size")
    if isinstance(tam, str):
        assert tam in esq["image_size"]["enum"]
    elif tam is not None:
        assert esq["image_size"]["objeto_ancho_alto"] is True
        assert set(tam) == {"width", "height"} and all(type(v) is int and v > 0 for v in tam.values())


@pytest.mark.parametrize("aspecto", sorted(ASPECTOS))
@pytest.mark.parametrize("id_", ["sdf", "sd45"])
def test_los_tamanos_de_seedream_cumplen_los_limites_de_su_esquema(id_, aspecto):
    lim = _esquemas()[ENDPOINTS[id_]]["limite_pixeles"]
    from pipeline import modelos_ia
    tam = modelos_ia.resolver("imagen", id_).args_de_imagen("x", aspecto)["image_size"]
    w, h = tam["width"], tam["height"]
    assert w % 16 == 0 and h % 16 == 0                    # la regla de GPT Image; no se arriesga en Seedream
    if id_ == "sdf":
        assert lim["min"] <= w * h <= lim["max"]
        assert lim["relacion_min"] <= w / h <= lim["relacion_max"]
    else:
        por_lado = lim["lado_min"] <= w <= lim["lado_max"] and lim["lado_min"] <= h <= lim["lado_max"]
        por_pixeles = lim["o_pixeles_min"] <= w * h <= lim["o_pixeles_max"]
        assert por_lado or por_pixeles, (w, h)


def test_los_presets_de_seedream_no_alcanzan_el_minimo_de_pixeles():
    """Por qué Seedream manda pares y no `landscape_16_9`: los presets de la familia (1024 de lado
    mayor) quedan por debajo del mínimo que pide su esquema. Si esto cambia, la fila puede simplificarse."""
    lim = _esquemas()["bytedance/seedream/v5/flash/text-to-image"]["limite_pixeles"]
    assert 1024 * 576 < lim["min"]


def test_gpt_image_queda_documentado_pero_sin_fila():
    """Faltan las decisiones del dueño (calidad, Flare o Sunburst, si GPT Image 2 edita) y el precio
    de los tamaños 16:9 y 9:16: sus tablas de precio no traen 1080×1920."""
    datos = _esquemas()["_gpt_sin_fila_todavia"]
    assert "openai/gpt-image-2" in datos and len(datos) == 7                   # 6 endpoints + la nota
    for ep in ("openai/gpt-image-2.5/flare/edit", "openai/gpt-image-2.5/sunburst/edit",
               "openai/gpt-image-2/edit"):
        assert datos[ep]["image_urls_max"] == 16 and datos[ep]["por_defecto_tamano"] == "auto"
    from pipeline import modelos_ia
    for id_ in ("gpt2", "gpt25"):
        with pytest.raises(modelos_ia.ModeloDesconocido):
            modelos_ia.resolver("imagen", id_)


# ---------------------------------------------------------------------------
# LA COMPUERTA: sin número en tarifas.json, 422 antes de cobrar

@pytest.fixture
def cliente(monkeypatch):
    monkeypatch.delenv("COGNITO_POOL_ID", raising=False)
    monkeypatch.setenv("STATE_BACKEND", "postgres")
    monkeypatch.setenv("MEDIA_BUCKET", "bucket-de-prueba")
    from server.app import app
    return TestClient(app)


@pytest.fixture
def espia(monkeypatch):
    """El monedero anotado: lo que costaría dinero."""
    from pipeline import creditos
    e = SimpleNamespace(cobros=[], devueltos=[])
    monkeypatch.setattr(creditos, "activo", lambda: True)
    monkeypatch.setattr(creditos, "cobrar", lambda n, ref, u=None: e.cobros.append((n, ref)))
    monkeypatch.setattr(creditos, "devolver", lambda n, ref, u=None: e.devueltos.append((n, ref)))
    return e


@pytest.fixture
def imagenes_al_disco(cliente, falso_fal, monkeypatch, tmp_path):
    """/api/imagenes escribe en una carpeta de prueba y no publica nada."""
    import server.app as app_mod
    destino = tmp_path / "imagenes"
    monkeypatch.setattr(app_mod, "_dir_imagenes", lambda: destino)
    monkeypatch.setattr(app_mod, "_publicar_imagen", lambda *a: None)
    return destino


@pytest.fixture
def sin_numero(monkeypatch):
    """Fuerza que los modelos de la Ola 2 no tengan número, pase lo que pase en
    tarifas.json: la compuerta se prueba aunque el dueño ya los haya encendido."""
    from pipeline import creditos
    for tarea, id_ in OLA2:
        monkeypatch.delitem(creditos.MODELOS_CR.get(tarea, {}), id_, raising=False)


@pytest.mark.parametrize("formato", ["horizontal", "vertical", "cuadrado", ""])
@pytest.mark.parametrize("id_", IDS)
def test_un_modelo_inerte_da_422_sin_cobrar_ni_llamar_a_fal(
        cliente, espia, falso_fal, sin_numero, imagenes_al_disco, id_, formato):
    cuerpo = {"prompt": "un gato", "modelo": id_, "estilo": "animated"}
    if formato:
        cuerpo["formato"] = formato
    r = cliente.post("/api/imagenes", json=cuerpo)
    assert r.status_code == 422, r.text
    assert id_ in r.json()["detail"]
    assert espia.cobros == [] and espia.devueltos == []
    assert falso_fal == []
    assert not imagenes_al_disco.exists() or list(imagenes_al_disco.iterdir()) == []


@pytest.mark.parametrize("modo", ["todo", "pincel"])
@pytest.mark.parametrize("id_", IDS)
def test_ninguno_de_la_ola_2_entra_al_editor(cliente, espia, falso_fal, imagenes_al_disco, id_, modo):
    """Ninguno tiene fila en «editar»: 422 aunque alguien le ponga número en tarifas.json."""
    archivos = {"imagen": ("a.png", b"\x89PNG-de-prueba", "image/png")}
    if modo == "pincel":
        archivos["marcada"] = ("m.jpg", b"\xff\xd8-de-prueba", "image/jpeg")
    r = cliente.post("/api/imagenes/editar",
                     data={"prompt": "más sol", "modo": modo, "modelo": id_}, files=archivos)
    assert r.status_code == 422, r.text
    assert espia.cobros == [] and falso_fal == []


def test_hoy_tarifas_json_no_trae_numero_para_los_inertes():
    """EL AVISO DE QUE LA COMPUERTA SE ABRIÓ. Mientras estos números no existan, los
    modelos no se ofrecen. Cuando el dueño los escriba (tras la prueba pagada), este test
    falla a propósito: se saca el modelo de INERTES y se ajusta lo demás (catálogo de la
    web, docs). No es un fallo del código."""
    from pipeline import creditos
    modelos = _tarifas()["modelos"]
    for tarea, id_ in INERTES:
        assert id_ not in modelos.get(tarea, {}), (tarea, id_)
        assert id_ not in creditos.MODELOS_CR.get(tarea, {}), (tarea, id_)
        with pytest.raises(KeyError):
            creditos.costo_modelo(tarea, id_)


@pytest.mark.parametrize("id_", IDS)
def test_el_catalogo_de_la_web_trae_a_los_de_la_ola_2_apagados(id_):
    """Mientras la compuerta esté cerrada, la web no los ofrece aunque los conozca."""
    ts = (RAIZ / "web" / "src" / "pantallas" / "inicio" / "modelos.ts").read_text(encoding="utf-8")
    fila = next(l for l in ts.splitlines() if f"id: '{id_}'" in l)
    assert "activo: false" in fila


# ---------------------------------------------------------------------------
# escribir el número es lo ÚNICO que falta (simulado: tarifas.json no se toca)

@pytest.fixture
def encendido(monkeypatch):
    """Como si el dueño hubiera escrito la propuesta de las seis en tarifas.json §modelos."""
    from pipeline import creditos
    for id_ in IDS:
        monkeypatch.setitem(creditos.MODELOS_CR.setdefault("imagen", {}), id_, PROPUESTA[id_])


@pytest.mark.parametrize("formato,aspecto", [("horizontal", "16:9"), ("vertical", "9:16"),
                                             ("cuadrado", "1:1"), ("", "1:1")])
@pytest.mark.parametrize("id_", IDS)
def test_con_el_numero_puesto_cada_modelo_cobra_y_llama_a_su_endpoint(
        cliente, espia, falso_fal, encendido, imagenes_al_disco, id_, formato, aspecto):
    cuerpo = {"prompt": "un gato", "modelo": id_, "estilo": "animated"}
    if formato:
        cuerpo["formato"] = formato
    r = cliente.post("/api/imagenes", json=cuerpo)
    assert r.status_code == 200, r.text
    assert espia.cobros == [(PROPUESTA[id_], "imagen:estudio")] and espia.devueltos == []
    (ll,) = falso_fal
    assert ll.app == ENDPOINTS[id_]
    assert ll.args["prompt"].startswith("un gato")
    esperado = _esperado(id_, aspecto)
    assert {k: v for k, v in ll.args.items() if k != "prompt"} == {k: v for k, v in esperado.items() if k != "prompt"}


@pytest.mark.parametrize("id_", IDS)
def test_si_fal_falla_se_devuelven_los_creditos(cliente, espia, encendido, imagenes_al_disco, monkeypatch, id_):
    from pipeline import fal

    async def llamar(app, argumentos, timeout_s, nombre, meta=None):
        raise fal.FalError("boom")
    monkeypatch.setattr(fal, "llamar", llamar)
    r = cliente.post("/api/imagenes", json={"prompt": "un gato", "modelo": id_})
    assert r.status_code == 502, r.text
    n = PROPUESTA[id_]
    assert espia.cobros == [(n, "imagen:estudio")] and espia.devueltos == [(n, "imagen:estudio")]


def test_los_modelos_a_la_venta_no_se_movieron():
    from pipeline import creditos
    assert creditos.costo_modelo("imagen", "grok") == 2
    assert creditos.costo_modelo("imagen", "nb2") == creditos.costo_modelo("editar", "nb2") == 8
    assert creditos.costo_modelo("editar", "grok") == 2
    assert [creditos.costo_modelo("clip", "veo-lite", s) for s in (4, 6, 8)] == [18, 28, 36]
    assert [creditos.costo_modelo("clip", "veo-fast", s) for s in (4, 6, 8)] == [54, 80, 108]
