"""R4 · Ola 2 — imágenes de familias nuevas (FLUX.2, Z-Image, Seedream, GPT Image, FLUX 3).

Esta primera entrega trae el MECANISMO y el primer modelo: FLUX.2 klein 9B.

Lo que cambia respecto a la Ola 1: Grok y Nano Banana piden el tamaño con
`aspect_ratio` («16:9»); FLUX.2, Z-Image, Seedream y GPT Image no lo entienden y piden
`image_size` con valores propios («square_hd», «landscape_16_9»…). Cada fila declara
cómo lo pide (`llave_tamano`, `tamanos`) y `Modelo.args_de_imagen` traduce el aspecto de
la caja. FLUX 3 además no documenta `num_images` (`con_num_images=False`).

Lo que este archivo defiende:
  * la tabla EXACTA de modelos de hoy (y los que siguen fuera);
  * que la traducción sea total: cada aspecto de la caja tiene valor en cada modelo
    de `image_size`, y un aspecto que la caja no conozca es un error del pedido, no un
    cambio silencioso a otro;
  * que Grok y Nano Banana 2 manden exactamente los mismos argumentos de siempre;
  * que un modelo de solo texto a imagen no reciba una imagen de referencia;
  * LA COMPUERTA de klein: sin número en tools/tarifas.json, 422 antes de cobrar, de
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

# Los modelos de la Ola 2 que ya tienen fila: (tarea, id) -> endpoint de crear
OLA2 = {("imagen", "klein"): "fal-ai/flux-2/klein/9b"}
# Los que HOY no tienen número en tarifas.json. Cuando el dueño enciende uno (número en
# tarifas.json + `activo: true` en la web) se saca de aquí: el test
# `test_hoy_tarifas_json_no_trae_numero_para_los_inertes` es el aviso de que la compuerta
# se abrió a propósito.
INERTES = set(OLA2)
# dólares por imagen de cada modelo (pricing.json, a 1024×1024) y su propuesta de créditos
USD = {"klein": 0.006}
PROPUESTA = {"klein": 2}
# lo que la caja sabe pedir (server/app.py::ASPECTOS_IMAGEN)
ASPECTOS = {"1:1": "square_hd", "16:9": "landscape_16_9", "9:16": "portrait_16_9"}


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
    assert modelos_ia.disponibles("imagen") == ["grok", "klein", "nb2"]
    assert modelos_ia.disponibles("editar") == ["grok", "nb2"]
    assert modelos_ia.disponibles("clip") == ["veo-lite", "veo-fast", "veo-std"]
    for tarea, id_ in (("imagen", "nbl"), ("editar", "nbl"), ("imagen", "nbp"),
                       ("editar", "klein"), ("clip", "kling")):
        with pytest.raises(modelos_ia.ModeloDesconocido):
            modelos_ia.resolver(tarea, id_)


def test_klein_es_la_9b_y_solo_crea():
    """La 4B quedó descartada el 9-oct (misma tarifa de 2 créditos, la 9B es más grande)."""
    from pipeline import modelos_ia
    m = modelos_ia.resolver("imagen", "klein")
    assert (m.id, m.tarea) == ("klein", "imagen")
    assert m.endpoint == "fal-ai/flux-2/klein/9b"
    assert m.endpoint_para(False) == m.endpoint_para(True) == m.endpoint
    assert "4b" not in m.endpoint
    assert m.admite_referencia is False
    assert (m.llave_tamano, m.con_num_images) == ("image_size", True)
    assert dict(m.tamanos) == ASPECTOS
    assert not m.args_extra and not m.duraciones and m.max_intentos == 0


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

@pytest.mark.parametrize("aspecto,valor", sorted(ASPECTOS.items()))
def test_klein_pide_image_size_y_nunca_aspect_ratio(aspecto, valor):
    from pipeline import modelos_ia
    args = modelos_ia.resolver("imagen", "klein").args_de_imagen("un gato", aspecto)
    assert args == {"prompt": "un gato", "num_images": 1, "image_size": valor}
    assert "aspect_ratio" not in args


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


def test_un_aspecto_que_el_modelo_no_traduce_es_un_error_del_pedido():
    from pipeline import modelos_ia
    m = modelos_ia.resolver("imagen", "klein")
    with pytest.raises(modelos_ia.AspectoNoAdmitido) as err:
        m.args_de_imagen("x", "21:9")
    assert isinstance(err.value, modelos_ia.ModeloDesconocido)     # un solo except lo cubre
    assert "klein" in str(err.value) and "21:9" in str(err.value)


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


def test_los_modelos_con_image_size_se_copian_y_se_serializan():
    from pipeline import modelos_ia
    m = modelos_ia.resolver("imagen", "klein")
    assert copy.deepcopy(m) == m and pickle.loads(pickle.dumps(m)) == m
    assert dataclasses.asdict(m)["tamanos"] == tuple(sorted(ASPECTOS.items()))
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


@pytest.mark.parametrize("aspecto,valor", sorted(ASPECTOS.items()))
def test_imagen_fal_con_klein_llama_a_la_9b_con_image_size(falso_fal, tmp_path, aspecto, valor):
    from pipeline import media_fal
    url = asyncio.run(media_fal.imagen_fal("un gato", tmp_path / "a.jpg", aspecto=aspecto,
                                           modelo="klein"))
    assert url == "https://fal.test/x.jpg" and (tmp_path / "a.jpg").exists()
    (ll,) = falso_fal
    assert ll.app == "fal-ai/flux-2/klein/9b"
    assert ll.args == {"prompt": "un gato", "num_images": 1, "image_size": valor}


def test_imagen_fal_con_klein_sin_aspecto_es_cuadrada(falso_fal, tmp_path):
    from pipeline import media_fal
    asyncio.run(media_fal.imagen_fal("un gato", tmp_path / "a.jpg", modelo="klein"))
    assert falso_fal[0].args["image_size"] == "square_hd"


def test_imagen_fal_no_le_manda_una_referencia_a_un_modelo_de_solo_texto(falso_fal, tmp_path):
    """No se sube nada, no se llama a fal y no se cae en silencio a otro modelo."""
    from pipeline import media_fal, modelos_ia
    ref = tmp_path / "ref.png"
    ref.write_bytes(b"\x89PNG-de-prueba")
    with pytest.raises(modelos_ia.ModeloDesconocido, match="no admite imagen de referencia"):
        asyncio.run(media_fal.imagen_fal("un gato", tmp_path / "a.jpg", referencia=ref,
                                         modelo="klein"))
    assert falso_fal == [] and falso_fal.subidas == [] and not (tmp_path / "a.jpg").exists()


def test_imagen_fal_con_un_aspecto_sin_traduccion_no_cambia_a_otro_en_silencio(falso_fal, tmp_path):
    """La invariante vive en el adaptador que gasta el dinero, no solo en `args_de_imagen`:
    un aspecto que el modelo no traduce NO cae en 1:1 (se cobraría un cuadrado que nadie pidió)."""
    from pipeline import media_fal, modelos_ia
    with pytest.raises(modelos_ia.AspectoNoAdmitido):
        asyncio.run(media_fal.imagen_fal("un gato", tmp_path / "a.jpg", aspecto="21:9", modelo="klein"))
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


def test_el_pincel_y_transformar_no_aceptan_a_klein(falso_fal, tmp_path):
    """Klein no tiene fila en «editar»: el editor no puede llamarlo ni por error."""
    from pipeline import media_fal, modelos_ia
    img = tmp_path / "a.png"
    img.write_bytes(b"\x89PNG-de-prueba")
    with pytest.raises(modelos_ia.ModeloDesconocido):
        asyncio.run(media_fal.imagen_transformar("acuarela", img, tmp_path / "o.jpg", modelo="klein"))
    with pytest.raises(modelos_ia.ModeloDesconocido):
        asyncio.run(media_fal.imagen_pincel("acuarela", img, img, tmp_path / "o.jpg", modelo="klein"))
    assert falso_fal == []


# ---------------------------------------------------------------------------
# el costo: ficha por endpoint exacto

def test_la_ficha_de_klein_es_la_medida_en_el_panel():
    ficha = _pricing()["generacion"]["endpoints"]["fal-ai/flux-2/klein/9b"]
    assert ficha == {"unidad": "imagen", "usd": USD["klein"], "verified_on": "2026-10-09"}
    assert "fal-ai/flux-2/klein/4b" not in _pricing()["generacion"]["endpoints"]    # la 4B se descartó


@pytest.mark.parametrize("aspecto", sorted(ASPECTOS))
def test_costo_fal_de_klein_es_el_techo_de_1024_por_1024(aspecto):
    """La página cobra por megapíxel, así que el cuadrado de 1 MP es la peor corrida y el
    número de la ficha es su techo: los apaisados y verticales cuestan igual o menos."""
    from pipeline import media_fal, modelos_ia, pricing
    args = modelos_ia.resolver("imagen", "klein").args_de_imagen("x", aspecto)
    assert pricing.costo_fal("fal-ai/flux-2/klein/9b", args) == USD["klein"]
    assert pricing.costo_fal("fal-ai/flux-2/klein/9b", {**args, "num_images": 2}) == 0.012


def test_un_endpoint_de_la_ola_2_sin_ficha_es_sin_costo_conocido_y_no_un_cero():
    """La 4B quedó fuera del catálogo y no tiene ficha: jamás se cotiza con la de la 9B."""
    from pipeline import pricing
    assert pricing.costo_fal("fal-ai/flux-2/klein/4b", {"prompt": "x", "num_images": 1}) is None


def test_la_formula_de_la_hoja_de_costos_reproduce_la_propuesta():
    """costo ÷ 0.75 ÷ $0.015 dólares, hacia arriba, al par, mínimo 2 por imagen. Con
    Fraction a propósito: con floats los redondeos hacia arriba se equivocan."""
    for id_, usd in USD.items():
        n = math.ceil(Fraction(str(usd)) / Fraction(75, 100) / Fraction(15, 1000))
        n = max(2, n + (n % 2))
        assert n == PROPUESTA[id_], id_
        assert Fraction(n) * Fraction(15, 1000) * Fraction(75, 100) >= Fraction(str(usd))


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
def test_klein_inerte_da_422_sin_cobrar_ni_llamar_a_fal(
        cliente, espia, falso_fal, sin_numero, imagenes_al_disco, formato):
    cuerpo = {"prompt": "un gato", "modelo": "klein", "estilo": "animated"}
    if formato:
        cuerpo["formato"] = formato
    r = cliente.post("/api/imagenes", json=cuerpo)
    assert r.status_code == 422, r.text
    assert "klein" in r.json()["detail"]
    assert espia.cobros == [] and espia.devueltos == []
    assert falso_fal == []
    assert not imagenes_al_disco.exists() or list(imagenes_al_disco.iterdir()) == []


@pytest.mark.parametrize("modo", ["todo", "pincel"])
def test_klein_nunca_entra_al_editor(cliente, espia, falso_fal, imagenes_al_disco, modo):
    """No tiene fila en «editar»: 422 aunque alguien le ponga número en tarifas.json."""
    archivos = {"imagen": ("a.png", b"\x89PNG-de-prueba", "image/png")}
    if modo == "pincel":
        archivos["marcada"] = ("m.jpg", b"\xff\xd8-de-prueba", "image/jpeg")
    r = cliente.post("/api/imagenes/editar",
                     data={"prompt": "más sol", "modo": modo, "modelo": "klein"}, files=archivos)
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


def test_el_catalogo_de_la_web_trae_a_klein_apagado():
    """Mientras la compuerta esté cerrada, la web no lo ofrece aunque lo conozca."""
    ts = (RAIZ / "web" / "src" / "pantallas" / "inicio" / "modelos.ts").read_text(encoding="utf-8")
    fila = next(l for l in ts.splitlines() if "id: 'klein'" in l)
    assert "activo: false" in fila


# ---------------------------------------------------------------------------
# escribir el número es lo ÚNICO que falta (simulado: tarifas.json no se toca)

@pytest.fixture
def encendido(monkeypatch):
    """Como si el dueño hubiera escrito la propuesta en tarifas.json §modelos."""
    from pipeline import creditos
    monkeypatch.setitem(creditos.MODELOS_CR.setdefault("imagen", {}), "klein", PROPUESTA["klein"])


@pytest.mark.parametrize("formato,valor", [("horizontal", "landscape_16_9"),
                                           ("vertical", "portrait_16_9"),
                                           ("cuadrado", "square_hd"), ("", "square_hd")])
def test_con_el_numero_puesto_klein_cobra_y_llama_a_su_endpoint(
        cliente, espia, falso_fal, encendido, imagenes_al_disco, formato, valor):
    cuerpo = {"prompt": "un gato", "modelo": "klein", "estilo": "animated"}
    if formato:
        cuerpo["formato"] = formato
    r = cliente.post("/api/imagenes", json=cuerpo)
    assert r.status_code == 200, r.text
    assert espia.cobros == [(PROPUESTA["klein"], "imagen:estudio")] and espia.devueltos == []
    (ll,) = falso_fal
    assert ll.app == "fal-ai/flux-2/klein/9b"
    assert ll.args["image_size"] == valor
    assert "aspect_ratio" not in ll.args
    assert ll.args["prompt"].startswith("un gato")


def test_si_fal_falla_con_klein_se_devuelven_los_creditos(
        cliente, espia, encendido, imagenes_al_disco, monkeypatch):
    from pipeline import fal

    async def llamar(app, argumentos, timeout_s, nombre, meta=None):
        raise fal.FalError("boom")
    monkeypatch.setattr(fal, "llamar", llamar)
    r = cliente.post("/api/imagenes", json={"prompt": "un gato", "modelo": "klein"})
    assert r.status_code == 502, r.text
    assert espia.cobros == [(2, "imagen:estudio")] and espia.devueltos == [(2, "imagen:estudio")]


def test_los_modelos_a_la_venta_no_se_movieron():
    from pipeline import creditos
    assert creditos.costo_modelo("imagen", "grok") == 2
    assert creditos.costo_modelo("imagen", "nb2") == creditos.costo_modelo("editar", "nb2") == 8
    assert creditos.costo_modelo("editar", "grok") == 2
    assert [creditos.costo_modelo("clip", "veo-lite", s) for s in (4, 6, 8)] == [18, 28, 36]
    assert [creditos.costo_modelo("clip", "veo-fast", s) for s in (4, 6, 8)] == [54, 80, 108]
