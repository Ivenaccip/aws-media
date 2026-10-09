"""R4 · Ola 1 — Veo 3.1 Fast, Veo 3.1 Standard y Nano Banana 2 como filas INERTES.

Lo que este archivo defiende:
  * que las filas y sus endpoints sean los exactos (docs/modelos-ia/DATOS-FAL-2026-10-08.md
    §1, §3 y §4) y que Nano Banana 2 mande `resolution: "1K"` explícito, sin que
    Grok cambie un solo argumento;
  * que el costo en dólares salga de las fichas de tools/pricing.json
    §generacion.endpoints (por endpoint exacto), con la duración real, y que un
    endpoint sin ficha sea «sin costo conocido», nunca un cero ni el de un vecino;
  * LA COMPUERTA: sin un número en tools/tarifas.json §modelos los tres ids se
    rechazan con 422 ANTES de cobrar, de leer S3, de crear el doc, de subir nada
    a fal o de encolar. Ese número lo escribe el dueño tras la prueba pagada;
  * que escribirlo sea lo único que falta: con el número puesto (aquí simulado),
    el mismo camino cobra, llama al endpoint correcto y registra el costo;
  * que la fórmula de la hoja de costos (costo ÷ 0.75 ÷ $0.015 dólares, hacia
    arriba, al par) reproduzca la propuesta, para que el número que se escriba al
    encender no se pueda equivocar;
  * que los argumentos fijos de un modelo sean un PIN (ganan sobre los de la tarea:
    el precio de Nano Banana 2 solo vale a 1K), que cualquier Modelo se pueda copiar,
    serializar y recorrer, y que Veo 3.1 Fast y Standard hagan UN solo intento (un
    timeout de cliente puede dejar vivo y cobrado el trabajo en fal).

Sin red: fal, LLM, S3, SQS y Langfuse mockeados.

OJO: nada de importar pipeline/server a nivel de módulo (ver test_m25_clip)."""
import asyncio
import copy
import dataclasses
import json
import math
import pickle
import sys
from dataclasses import FrozenInstanceError
from fractions import Fraction
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

RAIZ = Path(__file__).resolve().parent.parent

# Los modelos de la Ola 1 que HOY no tienen número en tarifas.json. Cuando el
# dueño enciende uno (número en tarifas.json + `activo: true` en la web), se saca
# de aquí: el test `test_hoy_tarifas_json_no_trae_numero_para_los_inertes` es el
# aviso de que la compuerta se abrió a propósito.
INERTES = {("imagen", "nb2"), ("editar", "nb2"), ("clip", "veo-fast"), ("clip", "veo-std")}

# endpoint de texto y de imagen de cada modelo de clip
CLIPS = {
    "veo-fast": ("fal-ai/veo3.1/fast", "fal-ai/veo3.1/fast/image-to-video"),
    "veo-std": ("fal-ai/veo3.1", "fal-ai/veo3.1/image-to-video"),
}
# dólares por segundo a 720p: (con audio, sin audio), leídos el 2026-10-08
TARIFA_S = {"veo-fast": (0.15, 0.10), "veo-std": (0.40, 0.20)}
# dólares del clip CON audio (lo que se pide) a 4, 6 y 8 s
USD_CLIP = {"veo-fast": {4: 0.6, 6: 0.9, 8: 1.2}, "veo-std": {4: 1.6, 6: 2.4, 8: 3.2}}
NB2_USD = 0.08
# créditos propuestos (docs/modelos-ia/DATOS-FAL-2026-10-08.md): NO están en tarifas.json
PROPUESTA_CLIP = {"veo-fast": {4: 54, 6: 80, 8: 108}, "veo-std": {4: 144, 6: 214, 8: 286}}
PROPUESTA_NB2 = 8


def _pricing() -> dict:
    return json.loads((RAIZ / "tools" / "pricing.json").read_text(encoding="utf-8"))


def _tarifas() -> dict:
    return json.loads((RAIZ / "tools" / "tarifas.json").read_text(encoding="utf-8"))


# ---------------------------------------------------------------------------
# las filas de la tabla

def test_las_filas_de_clip_traen_sus_endpoints_exactos():
    from pipeline import modelos_ia
    for id_, (t2v, i2v) in CLIPS.items():
        m = modelos_ia.resolver("clip", id_)
        assert (m.id, m.tarea) == (id_, "clip")
        assert (m.endpoint, m.endpoint_con_imagen) == (t2v, i2v)
        assert m.endpoint_para(False) == t2v and m.endpoint_para(True) == i2v
        assert m.con_audio is True
        assert m.duraciones == (4, 6, 8)
        assert not m.args_extra


def test_nano_banana_2_crea_y_con_referencia_va_al_edit():
    from pipeline import modelos_ia
    m = modelos_ia.resolver("imagen", "nb2")
    assert (m.id, m.tarea) == ("nb2", "imagen")
    assert m.endpoint_para(False) == "fal-ai/nano-banana-2"
    assert m.endpoint_para(True) == "fal-ai/nano-banana-2/edit"
    assert m.duraciones == ()


def test_nano_banana_2_editar_siempre_va_al_edit():
    from pipeline import modelos_ia
    m = modelos_ia.resolver("editar", "nb2")
    assert (m.id, m.tarea) == ("nb2", "editar")
    assert m.endpoint == "fal-ai/nano-banana-2/edit"
    assert m.endpoint_para(False) == m.endpoint_para(True) == "fal-ai/nano-banana-2/edit"
    assert m.duraciones == ()


def test_la_tabla_trae_exactamente_estos_modelos():
    """Nano Banana 2 Lite (`nbl`) NO entra: cobra por tokens y no hay precio."""
    from pipeline import modelos_ia
    assert modelos_ia.disponibles("imagen") == ["grok", "nb2"]
    assert modelos_ia.disponibles("editar") == ["grok", "nb2"]
    assert modelos_ia.disponibles("clip") == ["veo-lite", "veo-fast", "veo-std"]
    for tarea, id_ in (("imagen", "nbl"), ("editar", "nbl"), ("imagen", "nbp"),
                       ("clip", "kling")):
        with pytest.raises(modelos_ia.ModeloDesconocido):
            modelos_ia.resolver(tarea, id_)


def test_los_predeterminados_no_cambian():
    from pipeline import modelos_ia
    assert modelos_ia.PREDETERMINADO == {"imagen": "grok", "editar": "grok", "clip": "veo-lite"}
    assert modelos_ia.resolver("imagen", None).id == "grok"
    assert modelos_ia.resolver("clip", "").id == "veo-lite"


def test_los_endpoints_nuevos_no_dependen_de_settings(monkeypatch):
    """Su costo se anota por nombre exacto: sobrescribirlos por entorno los
    dejaría sin costo conocido. Lite y Grok sí siguen a settings."""
    from pipeline import modelos_ia
    monkeypatch.setattr(modelos_ia, "settings", SimpleNamespace(
        fal_imagen="xai/otro", fal_imagen_edit="xai/otro/edit",
        fal_veo="fal-ai/otro/lite/i2v", fal_veo_t2v="fal-ai/otro/lite"))
    assert modelos_ia.resolver("clip", "veo-lite").endpoint_con_imagen == "fal-ai/otro/lite/i2v"
    assert modelos_ia.resolver("imagen", "grok").endpoint == "xai/otro"
    assert modelos_ia.resolver("clip", "veo-fast").endpoint_con_imagen == CLIPS["veo-fast"][1]
    assert modelos_ia.resolver("clip", "veo-std").endpoint == CLIPS["veo-std"][0]
    assert modelos_ia.resolver("imagen", "nb2").endpoint == "fal-ai/nano-banana-2"
    assert modelos_ia.resolver("editar", "nb2").endpoint == "fal-ai/nano-banana-2/edit"


# ---------------------------------------------------------------------------
# args_extra: inmutable, copiable, un pin, y solo lo trae Nano Banana 2

def _toda_la_tabla():
    from pipeline import modelos_ia
    return [modelos_ia.resolver(t, i) for t in modelos_ia.TAREAS for i in modelos_ia.disponibles(t)]


def test_solo_nano_banana_2_trae_argumentos_extra():
    from pipeline import modelos_ia
    for tarea in ("imagen", "editar"):
        nb2 = modelos_ia.resolver(tarea, "nb2")
        assert nb2.args_extra == (("resolution", "1K"),)
        assert nb2.args_extra_dict == {"resolution": "1K"}
        assert not modelos_ia.resolver(tarea, "grok").args_extra
    for id_ in ("veo-lite", "veo-fast", "veo-std"):
        assert not modelos_ia.resolver("clip", id_).args_extra


def test_args_extra_es_inmutable():
    from pipeline import modelos_ia
    m = modelos_ia.resolver("imagen", "nb2")
    with pytest.raises(TypeError):
        m.args_extra[0] = ("resolution", "2K")
    with pytest.raises(TypeError):
        m.args_extra[0][1] = "2K"
    with pytest.raises(FrozenInstanceError):
        m.args_extra = ()
    with pytest.raises(FrozenInstanceError):
        m.max_intentos = 5
    # el dict que se pide es NUEVO cada vez: cambiarlo no toca al modelo
    d = m.args_extra_dict
    d["resolution"] = "4K"
    d["otro"] = 1
    assert m.args_extra_dict == {"resolution": "1K"}
    assert m.con_args_extra({"prompt": "x"}) == {"prompt": "x", "resolution": "1K"}
    # y el modelo sigue sirviendo de llave (hash e igualdad, con los argumentos dentro)
    assert hash(m) == hash(modelos_ia.resolver("imagen", "nb2"))
    assert m == modelos_ia.resolver("imagen", "nb2")
    assert m != modelos_ia.Modelo("nb2", "imagen", m.endpoint, m.endpoint_con_imagen)
    assert {m: 1}[modelos_ia.resolver("imagen", "nb2")] == 1


def test_el_dict_que_se_le_pasa_se_copia():
    """Quien arma el Modelo no puede cambiarle los argumentos después."""
    from pipeline import modelos_ia
    origen = {"resolution": "1K"}
    m = modelos_ia.Modelo("x", "imagen", "fal-ai/x", args_extra=origen)
    origen["resolution"] = "4K"
    origen["otro"] = 1
    assert dict(m.args_extra) == {"resolution": "1K"}
    assert m.args_extra == (("resolution", "1K"),)


def test_args_extra_se_normaliza_igual_venga_como_venga():
    """Un dict, pares en una lista o pares en otro orden dan el MISMO modelo."""
    from pipeline import modelos_ia
    a = modelos_ia.Modelo("x", "imagen", "fal-ai/x", args_extra={"b": 2, "a": 1})
    b = modelos_ia.Modelo("x", "imagen", "fal-ai/x", args_extra=[("a", 1), ("b", 2)])
    c = modelos_ia.Modelo("x", "imagen", "fal-ai/x", args_extra=(("b", 2), ("a", 1)))
    assert a.args_extra == b.args_extra == c.args_extra == (("a", 1), ("b", 2))
    assert a == b == c and hash(a) == hash(b) == hash(c)
    assert modelos_ia.Modelo("x", "imagen", "fal-ai/x").args_extra == ()
    assert modelos_ia.Modelo("x", "imagen", "fal-ai/x", args_extra={}).args_extra == ()


@pytest.mark.parametrize("llave", ["prompt", "image_urls", "image_url", "num_images",
                                   "aspect_ratio", "duration"])
def test_un_modelo_no_puede_fijar_una_llave_que_manda_la_tarea(llave):
    from pipeline import modelos_ia
    assert llave in modelos_ia.LLAVES_PROTEGIDAS
    for extra in ({llave: "x"}, [(llave, "x")], {"resolution": "1K", llave: "x"}):
        with pytest.raises(ValueError, match=llave):
            modelos_ia.Modelo("x", "imagen", "fal-ai/x", args_extra=extra)


def test_las_llaves_protegidas_son_las_que_manda_la_tarea():
    from pipeline import modelos_ia
    assert {"prompt", "image_urls", "num_images", "aspect_ratio", "duration"} \
        <= modelos_ia.LLAVES_PROTEGIDAS
    # ninguna fila de la tabla fija una (se arma al importar: si no, esto ya habría fallado)
    for m in _toda_la_tabla():
        assert not {k for k, _ in m.args_extra} & modelos_ia.LLAVES_PROTEGIDAS, m.id


def test_args_extra_mal_formados_se_rechazan():
    from pipeline import modelos_ia
    Modelo = modelos_ia.Modelo
    with pytest.raises(ValueError):
        Modelo("x", "imagen", "e", args_extra=[("a", 1), ("a", 2)])       # llave repetida
    with pytest.raises(ValueError):
        Modelo("x", "imagen", "e", args_extra=[("a", 1, 2)])              # no es un par
    with pytest.raises(ValueError):
        Modelo("x", "imagen", "e", args_extra={1: "x"})                   # llave sin texto
    with pytest.raises(ValueError):
        Modelo("x", "imagen", "e", args_extra={"": "x"})
    with pytest.raises(ValueError):
        Modelo("x", "imagen", "e", args_extra={"lista": [1, 2]})          # valor mutable
    with pytest.raises(TypeError):
        Modelo("x", "imagen", "e", args_extra=5)


@pytest.mark.parametrize("copiar", [
    copy.copy,
    copy.deepcopy,
    lambda m: pickle.loads(pickle.dumps(m)),
    lambda m: pickle.loads(pickle.dumps(m, protocol=0)),
], ids=["copy", "deepcopy", "pickle", "pickle-p0"])
def test_todo_modelo_se_copia_y_se_serializa(copiar):
    """Con un MappingProxyType esto lanzaba «cannot pickle 'mappingproxy'» para
    CUALQUIER fila, incluido Grok."""
    for m in _toda_la_tabla():
        otro = copiar(m)
        assert otro == m and hash(otro) == hash(m), m.id
        assert otro.args_extra == m.args_extra and otro.max_intentos == m.max_intentos
        assert otro.con_args_extra({"prompt": "x"}) == m.con_args_extra({"prompt": "x"})


def test_dataclasses_asdict_recorre_cualquier_modelo():
    from pipeline import modelos_ia
    for m in _toda_la_tabla():
        d = dataclasses.asdict(m)
        assert d["id"] == m.id and d["max_intentos"] == m.max_intentos
        assert tuple(map(tuple, d["args_extra"])) == m.args_extra
    nb2 = dataclasses.asdict(modelos_ia.resolver("imagen", "nb2"))
    assert dict(nb2["args_extra"]) == {"resolution": "1K"}
    assert dataclasses.asdict(modelos_ia.resolver("imagen", "grok"))["args_extra"] == ()
    # y de vuelta: lo que sale de asdict reconstruye el mismo modelo
    assert modelos_ia.Modelo(**nb2) == modelos_ia.resolver("imagen", "nb2")


def test_el_extra_agrega_lo_que_falta_y_el_original_no_se_toca():
    from pipeline import modelos_ia
    m = modelos_ia.resolver("imagen", "nb2")
    base = {"prompt": "un gato", "num_images": 1}
    mezcla = m.con_args_extra(base)
    assert mezcla == {"prompt": "un gato", "num_images": 1, "resolution": "1K"}
    assert base == {"prompt": "un gato", "num_images": 1}      # no se toca el original


@pytest.mark.parametrize("tarea", ["imagen", "editar"])
@pytest.mark.parametrize("pedida", ["4K", "2K", "0.5K", "1K", "", None])
def test_el_pin_de_1k_de_nano_banana_2_manda_sobre_la_tarea(tarea, pedida):
    """$0.08 dólares por imagen solo vale a 1K: si un llamador futuro manda
    `resolution` (p. ej. la calidad de Nano Banana Pro), el modelo NO la obedece."""
    from pipeline import modelos_ia
    m = modelos_ia.resolver(tarea, "nb2")
    args = {"prompt": "un gato", "num_images": 1, "aspect_ratio": "16:9",
            "image_urls": ["https://fal.test/a.png"], "resolution": pedida}
    mezcla = m.con_args_extra(args)
    assert mezcla == {**args, "resolution": "1K"}
    assert args["resolution"] == pedida                       # y el original queda como estaba


def test_grok_sigue_identico_aunque_la_tarea_mande_resolution():
    """Grok no fija nada: lo que manda la tarea sale tal cual, copia idéntica."""
    from pipeline import modelos_ia
    m = modelos_ia.resolver("imagen", "grok")
    args = {"prompt": "un gato", "num_images": 1, "aspect_ratio": "1:1", "resolution": "4K"}
    salida = m.con_args_extra(args)
    assert salida == args and salida is not args
    editar = modelos_ia.resolver("editar", "grok").con_args_extra(args)
    assert editar == args and editar is not args


def test_el_pin_no_pisa_el_prompt_ni_las_imagenes_de_la_tarea():
    """Eso lo garantiza la validación de arriba: un pin solo puede ser de llaves
    que la tarea NO manda, así que el prompt y las imágenes pasan siempre."""
    from pipeline import modelos_ia
    m = modelos_ia.Modelo("x", "editar", "fal-ai/x", args_extra={"resolution": "1K", "seed": 7})
    args = {"prompt": "un gato", "image_urls": ["a", "b"], "num_images": 1}
    assert m.con_args_extra(args) == {**args, "resolution": "1K", "seed": 7}


def test_sin_extra_los_argumentos_quedan_identicos():
    from pipeline import modelos_ia
    base = {"prompt": "un gato", "num_images": 1, "aspect_ratio": "1:1"}
    salida = modelos_ia.resolver("imagen", "grok").con_args_extra(base)
    assert salida == base and salida is not base


# ---------------------------------------------------------------------------
# media_fal: el extra llega a fal.llamar de Nano Banana 2 y NO de Grok

@pytest.fixture
def falso_fal(monkeypatch):
    """Registra cada llamada a fal en vez de hacerla."""
    from pipeline import fal
    llamadas = []

    async def llamar(app, argumentos, timeout_s, nombre, meta=None):
        llamadas.append(SimpleNamespace(app=app, args=argumentos, nombre=nombre))
        return {"images": [{"url": "https://fal.test/x.jpg"}]}

    async def subir_archivo(path):
        return f"https://fal.test/subida/{Path(path).name}"

    async def descargar(url, destino):
        Path(destino).write_bytes(b"x")
    monkeypatch.setattr(fal, "llamar", llamar)
    monkeypatch.setattr(fal, "subir_archivo", subir_archivo)
    monkeypatch.setattr(fal, "descargar", descargar)
    return llamadas


def _png(tmp_path, nombre="ref.png") -> Path:
    f = tmp_path / nombre
    f.write_bytes(b"\x89PNG-de-prueba")
    return f


def test_nano_banana_2_crear_sin_referencia_manda_1k_explicito(falso_fal, tmp_path):
    from pipeline import media_fal
    asyncio.run(media_fal.imagen_fal("un gato", tmp_path / "a.jpg", aspecto="16:9", modelo="nb2"))
    (ll,) = falso_fal
    assert ll.app == "fal-ai/nano-banana-2"
    assert ll.args == {"prompt": "un gato", "num_images": 1, "aspect_ratio": "16:9",
                       "resolution": "1K"}


def test_nano_banana_2_crear_sin_aspecto_sigue_en_1_a_1(falso_fal, tmp_path):
    from pipeline import media_fal
    asyncio.run(media_fal.imagen_fal("un gato", tmp_path / "a.jpg", modelo="nb2"))
    assert falso_fal[0].args["aspect_ratio"] == "1:1"
    assert falso_fal[0].args["resolution"] == "1K"


def test_nano_banana_2_crear_con_referencia_va_al_edit_con_1k(falso_fal, tmp_path):
    from pipeline import media_fal
    asyncio.run(media_fal.imagen_fal("un gato", tmp_path / "a.jpg", _png(tmp_path),
                                     aspecto="9:16", modelo="nb2"))
    (ll,) = falso_fal
    assert ll.app == "fal-ai/nano-banana-2/edit"
    assert ll.args == {"prompt": "un gato", "num_images": 1, "aspect_ratio": "9:16",
                       "image_urls": ["https://fal.test/subida/ref.png"], "resolution": "1K"}


def test_nano_banana_2_pincel_manda_las_dos_imagenes_y_1k(falso_fal, tmp_path):
    from pipeline import media_fal
    asyncio.run(media_fal.imagen_pincel("más sol", _png(tmp_path, "o.png"), _png(tmp_path, "m.png"),
                                        tmp_path / "a.jpg", modelo="nb2"))
    (ll,) = falso_fal
    assert ll.app == "fal-ai/nano-banana-2/edit" and ll.nombre == "imagen_pincel"
    assert ll.args["image_urls"] == ["https://fal.test/subida/o.png",
                                     "https://fal.test/subida/m.png"]
    assert ll.args["num_images"] == 1 and ll.args["resolution"] == "1K"
    assert "highlighted region: más sol" in ll.args["prompt"]       # el prompt no se pisa


def test_nano_banana_2_transformar_manda_la_imagen_y_1k(falso_fal, tmp_path):
    from pipeline import media_fal
    asyncio.run(media_fal.imagen_transformar("pásalo a acuarela", _png(tmp_path),
                                             tmp_path / "a.jpg", modelo="nb2"))
    (ll,) = falso_fal
    assert ll.app == "fal-ai/nano-banana-2/edit" and ll.nombre == "imagen_transformar"
    assert ll.args["image_urls"] == ["https://fal.test/subida/ref.png"]
    assert ll.args["num_images"] == 1 and ll.args["resolution"] == "1K"


def test_grok_manda_exactamente_los_argumentos_de_siempre(falso_fal, tmp_path):
    """Sin `modelo` y con `grok` explícito: ni `resolution` ni nada nuevo."""
    from pipeline import media_fal
    from pipeline.config import settings
    ref = _png(tmp_path)
    for modelo in (None, "grok"):
        falso_fal.clear()
        asyncio.run(media_fal.imagen_fal("un gato", tmp_path / "a.jpg", aspecto="16:9",
                                         modelo=modelo))
        asyncio.run(media_fal.imagen_fal("un gato", tmp_path / "a.jpg", ref, modelo=modelo))
        asyncio.run(media_fal.imagen_pincel("más sol", ref, _png(tmp_path, "m.png"),
                                            tmp_path / "a.jpg", modelo=modelo))
        asyncio.run(media_fal.imagen_transformar("acuarela", ref, tmp_path / "a.jpg",
                                                 modelo=modelo))
        crear, con_ref, pincel, transformar = falso_fal
        assert (crear.app, crear.args) == (
            settings.fal_imagen,
            {"prompt": "un gato", "num_images": 1, "aspect_ratio": "16:9"})
        assert (con_ref.app, con_ref.args) == (
            settings.fal_imagen_edit,
            {"prompt": "un gato", "num_images": 1, "aspect_ratio": "1:1",
             "image_urls": ["https://fal.test/subida/ref.png"]})
        assert pincel.app == settings.fal_imagen_edit
        assert set(pincel.args) == {"prompt", "image_urls", "num_images"}
        assert transformar.app == settings.fal_imagen_edit
        assert set(transformar.args) == {"prompt", "image_urls", "num_images"}


def test_un_modelo_desconocido_falla_antes_de_subir_nada(falso_fal, monkeypatch, tmp_path):
    from pipeline import fal, media_fal, modelos_ia
    subidas = []

    async def subir(path):
        subidas.append(path)
        return "https://fal.test/x"
    monkeypatch.setattr(fal, "subir_archivo", subir)
    ref = _png(tmp_path)
    for coro in (media_fal.imagen_fal("x", tmp_path / "a.jpg", ref, modelo="nbl"),
                 media_fal.imagen_pincel("x", ref, ref, tmp_path / "a.jpg", modelo="nbl"),
                 media_fal.imagen_transformar("x", ref, tmp_path / "a.jpg", modelo="nbl")):
        with pytest.raises(modelos_ia.ModeloDesconocido):
            asyncio.run(coro)
    assert subidas == [] and falso_fal == []


# ---------------------------------------------------------------------------
# clip.animar: los argumentos de la familia Veo son los mismos que los de Lite

@pytest.mark.parametrize("modelo", sorted(CLIPS))
@pytest.mark.parametrize("con_imagen", [False, True])
@pytest.mark.parametrize("segundos", [4, 6, 8])
def test_animar_manda_a_fast_y_standard_lo_mismo_que_a_lite(monkeypatch, modelo, con_imagen,
                                                            segundos):
    from pipeline import clip, fal
    llamadas = []

    async def llamar(app, argumentos, timeout_s, nombre, meta=None):
        llamadas.append((app, argumentos))
        return {"video": {"url": "https://fal.test/clip.mp4"}}
    monkeypatch.setattr(fal, "llamar", llamar)
    imagen = "https://fal.test/foto.jpg" if con_imagen else None
    for id_ in ("veo-lite", modelo):
        assert asyncio.run(clip.animar("a dog", imagen, "vertical", id_, segundos)) \
            == "https://fal.test/clip.mp4"
    (app_lite, args_lite), (app, args) = llamadas
    assert app == CLIPS[modelo][1 if con_imagen else 0]
    assert app != app_lite
    assert args == args_lite                   # mismos argumentos: no hace falta adaptador
    assert args["duration"] == f"{segundos}s"
    assert args["resolution"] == "720p" and args["generate_audio"] is True
    assert args["aspect_ratio"] == "9:16" and args["safety_tolerance"] == "6"
    assert ("image_url" in args) is con_imagen


# ---------------------------------------------------------------------------
# clip.animar: los intentos son del modelo (un timeout de cliente puede dejar vivo y
# cobrado el trabajo en fal, y Standard cuesta $3.20 dólares por intento a 8 s)

@pytest.fixture
def veo_que_falla(monkeypatch):
    """fal.llamar que siempre falla, como un timeout de cliente (FalError). Anota cada llamada."""
    from pipeline import fal
    llamadas = []

    async def llamar(app, argumentos, timeout_s, nombre, meta=None):
        llamadas.append(SimpleNamespace(app=app, args=argumentos, meta=meta))
        raise fal.FalError(f"{app}: timeout tras {timeout_s}s")
    monkeypatch.setattr(fal, "llamar", llamar)
    return llamadas


@pytest.fixture
def veo_sin_video(monkeypatch):
    """fal.llamar que responde bien pero sin video."""
    from pipeline import fal
    llamadas = []

    async def llamar(app, argumentos, timeout_s, nombre, meta=None):
        llamadas.append(app)
        return {}
    monkeypatch.setattr(fal, "llamar", llamar)
    return llamadas


def _intentos_de_settings(monkeypatch, n):
    from pipeline import clip
    monkeypatch.setattr(clip, "settings", SimpleNamespace(clip_max_attempts=n, clip_timeout_s=5))


def test_los_intentos_por_defecto_de_un_modelo_son_los_de_settings():
    """max_intentos=0 es «los de settings»: nadie que no lo pida cambia de conducta."""
    from pipeline import modelos_ia
    assert modelos_ia.Modelo("x", "clip", "fal-ai/x").max_intentos == 0
    for m in _toda_la_tabla():
        esperado = 1 if (m.tarea, m.id) in {("clip", "veo-fast"), ("clip", "veo-std")} else 0
        assert m.max_intentos == esperado, (m.tarea, m.id)
    assert modelos_ia.resolver("imagen", "grok").max_intentos == 0
    assert modelos_ia.resolver("clip", "veo-lite").max_intentos == 0


@pytest.mark.parametrize("malo", [-1, 1.0, "1", True, None])
def test_max_intentos_solo_acepta_enteros_de_cero_o_mas(malo):
    from pipeline import modelos_ia
    with pytest.raises(ValueError, match="max_intentos"):
        modelos_ia.Modelo("x", "clip", "fal-ai/x", max_intentos=malo)


@pytest.mark.parametrize("modelo", sorted(CLIPS))
@pytest.mark.parametrize("con_imagen", [False, True])
@pytest.mark.parametrize("segundos", [4, 6, 8])
def test_un_fallo_en_fast_o_standard_hace_exactamente_una_llamada(
        veo_que_falla, monkeypatch, modelo, con_imagen, segundos):
    from pipeline import clip
    imagen = "https://fal.test/foto.jpg" if con_imagen else None
    with pytest.raises(clip.ClipError, match="No se pudo generar el video"):
        asyncio.run(clip.animar("a dog", imagen, "vertical", modelo, segundos))
    (ll,) = veo_que_falla
    assert ll.app == CLIPS[modelo][1 if con_imagen else 0]
    assert ll.meta == {"clip": True, "intento": 1}


@pytest.mark.parametrize("modelo", sorted(CLIPS))
@pytest.mark.parametrize("n", [1, 2, 3, 10])
def test_aunque_settings_pida_mas_intentos_fast_y_standard_hacen_uno(
        veo_que_falla, monkeypatch, modelo, n):
    from pipeline import clip
    _intentos_de_settings(monkeypatch, n)
    with pytest.raises(clip.ClipError):
        asyncio.run(clip.animar("a dog", None, "horizontal", modelo, 8))
    assert len(veo_que_falla) == 1


@pytest.mark.parametrize("modelo", sorted(CLIPS))
def test_si_fal_responde_sin_video_fast_y_standard_tampoco_reintentan(
        veo_sin_video, monkeypatch, modelo):
    from pipeline import clip
    _intentos_de_settings(monkeypatch, 3)
    with pytest.raises(clip.ClipError, match="Veo no devolvió video"):
        asyncio.run(clip.animar("a dog", None, "horizontal", modelo, 8))
    assert len(veo_sin_video) == 1


@pytest.mark.parametrize("n", [1, 2, 3, 5])
def test_lite_sigue_reintentando_lo_que_dice_settings(veo_que_falla, monkeypatch, n):
    """Lite no cambió: con N intentos en settings hace N llamadas, como siempre."""
    from pipeline import clip
    _intentos_de_settings(monkeypatch, n)
    with pytest.raises(clip.ClipError):
        asyncio.run(clip.animar("a dog", "https://fal.test/foto.jpg", "vertical", "veo-lite", 8))
    assert [ll.meta["intento"] for ll in veo_que_falla] == list(range(1, n + 1))


def test_lite_con_la_configuracion_real_hace_clip_max_attempts_llamadas(veo_que_falla):
    from pipeline import clip
    from pipeline.config import settings
    assert settings.clip_max_attempts >= 2        # el valor de siempre es 2
    with pytest.raises(clip.ClipError):
        asyncio.run(clip.animar("a dog", None, "horizontal", "veo-lite", 6))
    assert len(veo_que_falla) == settings.clip_max_attempts
    # y sin modelo (el predeterminado, Lite) igual
    veo_que_falla.clear()
    with pytest.raises(clip.ClipError):
        asyncio.run(clip.animar("a dog"))
    assert len(veo_que_falla) == settings.clip_max_attempts


def test_lite_reintenta_y_se_recupera_pero_standard_no_tiene_segunda_oportunidad(monkeypatch):
    """Primer intento falla, el segundo responde: Lite entrega el video; Standard,
    con el mismo guion de fal, se rinde en el primero (y no gasta un segundo cobro)."""
    from pipeline import clip, fal
    _intentos_de_settings(monkeypatch, 2)
    for modelo, llamadas_esperadas, sale_video in (("veo-lite", 2, True), ("veo-std", 1, False)):
        llamadas = []

        async def llamar(app, argumentos, timeout_s, nombre, meta=None, _l=llamadas):
            _l.append(app)
            if len(_l) == 1:
                raise fal.FalError("timeout")
            return {"video": {"url": "https://fal.test/clip.mp4"}}
        monkeypatch.setattr(fal, "llamar", llamar)
        if sale_video:
            assert asyncio.run(clip.animar("a dog", None, "horizontal", modelo, 8)) \
                == "https://fal.test/clip.mp4"
        else:
            with pytest.raises(clip.ClipError):
                asyncio.run(clip.animar("a dog", None, "horizontal", modelo, 8))
        assert len(llamadas) == llamadas_esperadas, modelo


def test_el_tope_de_un_modelo_nunca_sube_los_intentos_de_settings(
        veo_que_falla, monkeypatch):
    """max_intentos es un TECHO: un modelo puede pedir menos que settings, jamás más."""
    from pipeline import clip, modelos_ia
    veo = modelos_ia.resolver("clip", "veo-lite")
    casos = ((5, 2, 2),    # el modelo pide 5, settings 2 -> 2
             (2, 3, 2),    # el modelo pide 2, settings 3 -> 2
             (1, 3, 1),    # el modelo pide 1 -> 1
             (0, 3, 3))    # 0 = los de settings
    for tope, de_settings, esperado in casos:
        veo_que_falla.clear()
        _intentos_de_settings(monkeypatch, de_settings)
        modelo = dataclasses.replace(veo, max_intentos=tope)
        monkeypatch.setattr(modelos_ia, "resolver", lambda tarea, id_, _m=modelo: _m)
        with pytest.raises(clip.ClipError):
            asyncio.run(clip.animar("a dog", None, "horizontal", "veo-lite", 8))
        assert len(veo_que_falla) == esperado, (tope, de_settings)


def test_el_clip_completo_con_standard_hace_una_sola_llamada_a_fal(
        veo_que_falla, monkeypatch):
    """Por el camino real (generar): el prompt se escribe una vez y fal se llama una."""
    from pipeline import clip

    async def chat_json(name, system, user):
        return {"video": "A dog running.", "composicion": "", "recorte": ""}
    monkeypatch.setattr("pipeline.clip.chat_json", chat_json)
    with pytest.raises(clip.ClipError):
        asyncio.run(clip.generar("mi perro", None, "horizontal", "veo-std", 8))
    assert len(veo_que_falla) == 1 and veo_que_falla[0].app == CLIPS["veo-std"][0]


# ---------------------------------------------------------------------------
# lo que NO está comprobado queda escrito donde el dueño lo lee antes de pagar

def _plano(ruta: Path) -> str:
    """El texto en una sola línea y sin las comillas de código, para buscar frases."""
    return " ".join(ruta.read_text(encoding="utf-8").replace("`", "").split())


def test_el_supuesto_de_resolution_en_el_edit_de_nano_banana_2_esta_anotado():
    """DATOS §3 no lista `resolution` entre los parámetros de /edit: mandar 1K ahí es un
    supuesto, y la prueba pagada de editar lo decide. Si desaparece de alguno de los tres
    sitios, alguien podría encender nb2 sin saber que editar no está comprobado."""
    docs = RAIZ / "docs" / "modelos-ia"
    textos = {"pricing.json nota_ola1": " ".join(_pricing()["generacion"]["endpoints"]["nota_ola1"].split()),
              "POR-VERIFICAR": _plano(docs / "POR-VERIFICAR.md"),
              "DATOS §3": _plano(docs / "DATOS-FAL-2026-10-08.md")}
    for donde, t in textos.items():
        assert "nano-banana-2/edit" in t and "resolution" in t, donde
        assert "supuesto sin comprobar" in t.lower(), donde
        assert "ignora" in t and "$0.08 dólares" in t and "daría error con devolución" in t, donde
        assert "la prueba pagada de editar lo decide" in t, donde


def test_los_avisos_de_la_ola_1_estan_en_por_verificar():
    t = _plano(RAIZ / "docs" / "modelos-ia" / "POR-VERIFICAR.md")
    # (a) el timeout de cliente y el único intento de Fast y Standard
    for trozo in ("el timeout del clip es de 240 s", "marca REVISAR si pasa del 70 %",
                  "un timeout de cliente puede dejar un trabajo vivo y cobrado en fal",
                  "estos dos modelos hacen un solo intento"):
        assert trozo in t, trozo
    # (b) la forma de la imagen de entrada
    for trozo in ("720p o más de lado corto", "16:9 o 9:16", "NO está comprobado",
                  "--imagen-sin-validar"):
        assert trozo in t, trozo
    # (c) el reenvío de fal_client
    for trozo in ("UN intento por nuestro lado", "fal_client puede reenviar el envío",
                  "una sola solicitud"):
        assert trozo in t, trozo


def test_los_docs_y_las_notas_de_la_ola_1_nunca_dicen_centavos():
    docs = RAIZ / "docs" / "modelos-ia"
    nota = _pricing()["generacion"]["endpoints"]["nota_ola1"]
    for t in (nota, (docs / "POR-VERIFICAR.md").read_text(encoding="utf-8"),
              (docs / "DATOS-FAL-2026-10-08.md").read_text(encoding="utf-8")):
        assert "centavos" not in t.lower()


# ---------------------------------------------------------------------------
# el costo en dólares: fichas de pricing.json, por endpoint exacto

@pytest.mark.parametrize("modelo", sorted(CLIPS))
def test_costo_fal_del_clip_por_duracion_y_endpoint(modelo):
    from pipeline.pricing import costo_fal, unidades_fal
    con_audio, sin_audio = TARIFA_S[modelo]
    for app in CLIPS[modelo]:
        for s, usd in USD_CLIP[modelo].items():
            args = {"duration": f"{s}s", "resolution": "720p", "generate_audio": True}
            assert costo_fal(app, args) == usd, (app, s)
            assert unidades_fal(app, args) == {"video_seconds": s}
            mudo = {"duration": f"{s}s", "resolution": "720p", "generate_audio": False}
            assert costo_fal(app, mudo) == round(s * sin_audio, 4), (app, s)
            assert costo_fal(app, {"duration": f"{s}s", "resolution": "720p"}) \
                == round(s * sin_audio, 4)


def test_costos_exactos_de_la_lectura_del_8_de_octubre():
    """Los números tal cual los pidió el dueño."""
    from pipeline.pricing import costo_fal
    fast, std = CLIPS["veo-fast"][0], CLIPS["veo-std"][0]

    def con_audio(s):
        return {"duration": f"{s}s", "resolution": "720p", "generate_audio": True}
    assert [costo_fal(fast, con_audio(s)) for s in (4, 6, 8)] == [0.6, 0.9, 1.2]
    assert costo_fal(std, con_audio(4)) == 1.6
    assert costo_fal(std, con_audio(8)) == 3.2
    assert costo_fal("fal-ai/nano-banana-2", {"num_images": 1}) == 0.08


def test_no_se_inventa_la_resolucion_de_1080p():
    """El clip se pide a 720p. 1080p cuesta lo mismo en la página, pero no está
    anotado ni verificado para 4 y 6 s: sin llave, sin costo conocido."""
    from pipeline.pricing import costo_fal
    for id_, apps in CLIPS.items():
        for app in apps:
            ficha = _pricing()["generacion"]["endpoints"][app]
            assert set(ficha["usd_por_segundo"]) == {"720p_con_audio", "720p_sin_audio"}
            args = {"duration": "8s", "resolution": "1080p", "generate_audio": True}
            assert costo_fal(app, args) is None, app


@pytest.mark.parametrize("n_referencias", [0, 1, 2, 14])
@pytest.mark.parametrize("num_images", [1, 2])
@pytest.mark.parametrize("app", ["fal-ai/nano-banana-2", "fal-ai/nano-banana-2/edit"])
def test_costo_fal_de_nano_banana_2_es_por_imagen_de_salida(app, num_images, n_referencias):
    """$0.08 dólares por imagen generada; la lectura no cobra la referencia."""
    from pipeline.pricing import costo_fal, unidades_fal
    args = {"num_images": num_images, "resolution": "1K",
            "image_urls": [f"https://fal.test/{i}.png" for i in range(n_referencias)]}
    assert costo_fal(app, args) == round(NB2_USD * num_images, 4)
    assert unidades_fal(app, args) == {"images": num_images, "reference_images": n_referencias}


def test_las_seis_fichas_traen_fecha_y_la_forma_de_la_nota():
    ep = _pricing()["generacion"]["endpoints"]
    fichas = {k: v for k, v in ep.items() if isinstance(v, dict)}
    esperadas = {a for apps in CLIPS.values() for a in apps} \
        | {"fal-ai/nano-banana-2", "fal-ai/nano-banana-2/edit"}
    assert esperadas <= set(fichas)
    for app in esperadas:
        f = fichas[app]
        assert f["verified_on"] == "2026-10-08", app
        assert f["unidad"] in ("segundo", "imagen"), app
        if f["unidad"] == "imagen":
            assert f["usd"] == NB2_USD, app
            assert "usd_referencia" not in f, app     # la lectura no lo trae: no se inventa
        else:
            assert all(isinstance(v, float) and v > 0 for v in f["usd_por_segundo"].values())
    # una ficha por endpoint EXACTO: ninguna casa por trozo con las de Lite
    assert "fal-ai/veo3.1/lite" not in fichas


def test_ninguna_ficha_nueva_pisa_el_costo_de_lite_ni_de_grok():
    from pipeline.pricing import costo_fal
    args = {"duration": "8s", "resolution": "720p", "generate_audio": True}
    assert costo_fal("fal-ai/veo3.1/lite", args) == 0.4
    assert costo_fal("fal-ai/veo3.1/lite/image-to-video", args) == 0.4
    assert costo_fal("xai/grok-imagine-image", {"num_images": 1}) == 0.02
    assert costo_fal("xai/grok-imagine-image/edit",
                     {"num_images": 1, "image_urls": ["a"]}) == 0.022


@pytest.mark.parametrize("app,args,esperado,unidades", [
    ("fal-ai/veo3.1/fast", {"duration": "4s", "resolution": "720p", "generate_audio": True},
     0.6, {"video_seconds": 4}),
    ("fal-ai/veo3.1/fast/image-to-video",
     {"duration": "6s", "resolution": "720p", "generate_audio": True}, 0.9, {"video_seconds": 6}),
    ("fal-ai/veo3.1", {"duration": "4s", "resolution": "720p", "generate_audio": True},
     1.6, {"video_seconds": 4}),
    ("fal-ai/veo3.1/image-to-video",
     {"duration": "8s", "resolution": "720p", "generate_audio": True}, 3.2, {"video_seconds": 8}),
    ("fal-ai/nano-banana-2", {"num_images": 1, "resolution": "1K"}, 0.08,
     {"images": 1, "reference_images": 0}),
    ("fal-ai/nano-banana-2/edit", {"num_images": 1, "resolution": "1K", "image_urls": ["a", "b"]},
     0.08, {"images": 1, "reference_images": 2}),
])
def test_fal_llamar_anota_costo_y_unidades_en_langfuse(monkeypatch, app, args, esperado, unidades):
    """El camino real hacia Langfuse: fal.llamar lee costo_fal y unidades_fal. Las
    fichas nuevas tienen que llegar hasta el span, no solo a las funciones."""
    from pipeline import fal
    spans = []

    class _Span:
        def update(self, **kw):
            spans.append(kw)

    class _Ctx:
        def __enter__(self):
            return _Span()

        def __exit__(self, *a):
            return False

    class _Cliente:
        def start_as_current_observation(self, **kw):
            return _Ctx()

    async def subscribe_async(app_, arguments):
        return {"ok": True}
    monkeypatch.setattr(fal, "get_client", lambda: _Cliente())
    monkeypatch.setattr(fal, "fal_client", SimpleNamespace(subscribe_async=subscribe_async))
    asyncio.run(fal.llamar(app, args, timeout_s=5, nombre="prueba"))
    (final,) = [s for s in spans if "cost_details" in s]
    assert final["cost_details"] == {"total": esperado}
    assert final["usage_details"] == unidades


# ---------------------------------------------------------------------------
# clip.costo_usd: la composición suma lo de Grok

def _grok_componer(n_imagenes: int) -> float:
    g = _pricing()["generacion"]["grok_edit"]
    if n_imagenes < 2:
        return 0.0
    return g["usd_por_imagen_salida"] + g["usd_por_imagen_referencia"] * n_imagenes


@pytest.mark.parametrize("n_imagenes", [0, 1, 2, 3])
@pytest.mark.parametrize("segundos", [4, 6, 8])
@pytest.mark.parametrize("modelo", sorted(CLIPS))
def test_costo_usd_del_clip_suma_la_composicion_de_grok(modelo, segundos, n_imagenes):
    from pipeline import clip
    esperado = USD_CLIP[modelo][segundos] + _grok_componer(n_imagenes)
    assert clip.costo_usd(n_imagenes, modelo, segundos) == round(esperado, 4)


def test_costo_usd_de_los_extremos_en_numeros_redondos():
    from pipeline import clip
    assert clip.costo_usd(0, "veo-fast", 4) == 0.6
    assert clip.costo_usd(0, "veo-fast", 6) == 0.9
    assert clip.costo_usd(0, "veo-fast", 8) == 1.2
    assert clip.costo_usd(0, "veo-std", 4) == 1.6
    assert clip.costo_usd(1, "veo-std", 8) == 3.2
    assert clip.costo_usd(2, "veo-fast", 4) == 0.624       # 0.6 + 0.02 + 2 × 0.002
    assert clip.costo_usd(3, "veo-std", 8) == 3.226        # 3.2 + 0.02 + 3 × 0.002
    # sin duración vale la de siempre, 8 s
    assert clip.costo_usd(0, "veo-fast") == clip.costo_usd(0, "veo-fast", 8) == 1.2


@pytest.mark.parametrize("modelo", sorted(CLIPS))
def test_un_endpoint_sin_ficha_es_sin_costo_conocido_y_no_un_cero(monkeypatch, modelo):
    from pipeline import clip, pricing
    t2v, i2v = CLIPS[modelo]
    # sin la ficha del de texto: sin imagen no hay costo; con imagen sí (es otro endpoint)
    monkeypatch.delitem(pricing.ENDPOINTS_JSON, t2v)
    assert pricing.costo_fal(t2v, {"duration": "8s", "resolution": "720p",
                                   "generate_audio": True}) is None
    with pytest.raises(clip.ClipError, match="Sin costo conocido"):
        clip.costo_usd(0, modelo, 8)
    assert clip.costo_usd(1, modelo, 8) == USD_CLIP[modelo][8]
    # sin la del de imagen también cae: una imagen o la compuesta de varias
    monkeypatch.delitem(pricing.ENDPOINTS_JSON, i2v)
    for n in (1, 2, 3):
        with pytest.raises(clip.ClipError, match="Sin costo conocido"):
            clip.costo_usd(n, modelo, 4)


def test_una_ficha_a_medias_de_un_clip_nuevo_tampoco_parece_gratis(monkeypatch):
    from pipeline import clip, pricing
    monkeypatch.setitem(pricing.ENDPOINTS_JSON, "fal-ai/veo3.1/fast",
                        {"unidad": "segundo", "usd_por_segundo": {"720p_sin_audio": 0.1}})
    with pytest.raises(clip.ClipError, match="Sin costo conocido"):    # pide CON audio
        clip.costo_usd(0, "veo-fast", 8)


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
    """Todo lo que costaría dinero o dejaría rastro, anotado: el monedero, la cola
    y las lecturas y escrituras de S3."""
    from pipeline import creditos, jobs, media_sync
    e = SimpleNamespace(cobros=[], devueltos=[], encolados=[], s3={}, s3_toques=[])
    monkeypatch.setattr(creditos, "activo", lambda: True)
    monkeypatch.setattr(creditos, "cobrar", lambda n, ref, u=None: e.cobros.append((n, ref)))
    monkeypatch.setattr(creditos, "devolver", lambda n, ref, u=None: e.devueltos.append((n, ref)))
    monkeypatch.setattr(jobs, "encolar_clip", lambda *a: e.encolados.append(a))

    def leer(key):
        e.s3_toques.append(("leer", key))
        return e.s3.get(key)

    def escribir(key, texto, tipo="application/json"):
        e.s3_toques.append(("escribir", key))
        e.s3[key] = texto

    def listar(pref):
        e.s3_toques.append(("listar", pref))
        return sorted(k for k in e.s3 if k.startswith(pref))
    monkeypatch.setattr(media_sync, "leer_texto", leer)
    monkeypatch.setattr(media_sync, "escribir_texto", escribir)
    monkeypatch.setattr(media_sync, "listar_prefijo", listar)
    return e


@pytest.fixture
def sin_numero(monkeypatch):
    """Fuerza que los modelos de la Ola 1 no tengan número de créditos, pase lo que
    pase en tarifas.json: así la compuerta se prueba aunque el dueño ya los haya
    encendido."""
    from pipeline import creditos
    for tarea, id_ in INERTES:
        monkeypatch.delitem(creditos.MODELOS_CR.get(tarea, {}), id_, raising=False)


@pytest.fixture
def imagenes_al_disco(cliente, falso_fal, monkeypatch, tmp_path):
    """/api/imagenes escribe en una carpeta de prueba y no publica nada."""
    import server.app as app_mod
    destino = tmp_path / "imagenes"
    monkeypatch.setattr(app_mod, "_dir_imagenes", lambda: destino)
    monkeypatch.setattr(app_mod, "_publicar_imagen", lambda *a: None)
    return destino


def _sin_rastro(espia, falso_fal, destino=None):
    assert espia.cobros == [] and espia.devueltos == []
    assert espia.encolados == [] and espia.s3_toques == [] and espia.s3 == {}
    assert falso_fal == []                                # ni se subió ni se llamó a fal
    if destino is not None:
        assert not destino.exists() or list(destino.iterdir()) == []


def _imagenes_propias(n: int) -> list[str]:
    from pipeline import db
    user = db.usuario_actual()
    return [f"usuarios/{user}/clips/subidas/{i}.jpg" for i in range(n)]


@pytest.mark.parametrize("n_imagenes", [0, 1, 2, 3])
@pytest.mark.parametrize("segundos", [4, 6, 8])
@pytest.mark.parametrize("modelo", ["veo-fast", "veo-std"])
def test_el_clip_inerte_da_422_sin_cobrar_ni_leer_s3_ni_encolar(
        cliente, espia, falso_fal, sin_numero, modelo, segundos, n_imagenes):
    r = cliente.post("/api/clip/generar",
                     json={"texto": "mi perro", "modelo": modelo, "segundos": segundos,
                           "imagenes": _imagenes_propias(n_imagenes)})
    assert r.status_code == 422, r.text
    assert modelo in r.json()["detail"]
    _sin_rastro(espia, falso_fal)


@pytest.mark.parametrize("modelo", ["veo-fast", "veo-std"])
def test_el_clip_inerte_sin_segundos_tambien_da_422(cliente, espia, falso_fal, sin_numero, modelo):
    r = cliente.post("/api/clip/generar", json={"texto": "mi perro", "modelo": modelo})
    assert r.status_code == 422, r.text
    _sin_rastro(espia, falso_fal)


@pytest.mark.parametrize("formato", ["horizontal", "vertical", "cuadrado", ""])
@pytest.mark.parametrize("prompt", ["un gato"])
def test_crear_imagen_con_nano_banana_2_inerte_da_422(
        cliente, espia, falso_fal, sin_numero, imagenes_al_disco, formato, prompt):
    cuerpo = {"prompt": prompt, "modelo": "nb2", "estilo": "animated"}
    if formato:
        cuerpo["formato"] = formato
    r = cliente.post("/api/imagenes", json=cuerpo)
    assert r.status_code == 422, r.text
    assert "nb2" in r.json()["detail"]
    _sin_rastro(espia, falso_fal, imagenes_al_disco)


@pytest.mark.parametrize("modo", ["todo", "pincel"])
def test_editar_imagen_con_nano_banana_2_inerte_da_422(
        cliente, espia, falso_fal, sin_numero, imagenes_al_disco, modo):
    archivos = {"imagen": ("a.png", b"\x89PNG-de-prueba", "image/png")}
    if modo == "pincel":
        archivos["marcada"] = ("m.jpg", b"\xff\xd8-de-prueba", "image/jpeg")
    r = cliente.post("/api/imagenes/editar",
                     data={"prompt": "más sol", "modo": modo, "modelo": "nb2"}, files=archivos)
    assert r.status_code == 422, r.text
    assert "nb2" in r.json()["detail"]
    _sin_rastro(espia, falso_fal, imagenes_al_disco)


def test_los_tres_ids_siguen_rechazados_aunque_el_dueño_no_haya_tocado_nada(
        cliente, espia, falso_fal, imagenes_al_disco):
    """Con la tarifa REAL (sin forzar nada): lo que el dueño ve hoy. Es el mismo
    contrato de arriba pero contra tools/tarifas.json tal como está."""
    for modelo in ("veo-fast", "veo-std"):
        r = cliente.post("/api/clip/generar", json={"texto": "mi perro", "modelo": modelo})
        assert r.status_code == 422, (modelo, r.text)
    r = cliente.post("/api/imagenes", json={"prompt": "un gato", "modelo": "nb2"})
    assert r.status_code == 422, r.text
    r = cliente.post("/api/imagenes/editar",
                     data={"prompt": "más sol", "modo": "todo", "modelo": "nb2"},
                     files={"imagen": ("a.png", b"\x89PNG-de-prueba", "image/png")})
    assert r.status_code == 422, r.text
    _sin_rastro(espia, falso_fal, imagenes_al_disco)


def test_hoy_tarifas_json_no_trae_numero_para_los_inertes():
    """EL AVISO DE QUE LA COMPUERTA SE ABRIÓ. Mientras estos números no existan, los
    modelos no se ofrecen. Cuando el dueño los escriba (tras la prueba pagada),
    este test falla a propósito: se saca el modelo de INERTES y se ajusta lo demás
    (catálogo de la web, docs). No es un fallo del código."""
    from pipeline import creditos
    modelos = _tarifas()["modelos"]
    for tarea, id_ in INERTES:
        assert id_ not in modelos.get(tarea, {}), (tarea, id_)
        assert id_ not in creditos.MODELOS_CR.get(tarea, {}), (tarea, id_)
    # la compuerta, vista desde el monedero: ni un número ni un cero
    for s in (None, 4, 6, 8):
        for id_ in ("veo-fast", "veo-std"):
            with pytest.raises(KeyError):
                creditos.costo_modelo("clip", id_, s)
            with pytest.raises(KeyError):
                creditos.costo_clip(0, id_, s)
            with pytest.raises(KeyError):
                creditos.costo_clip(2, id_, s)
    for tarea in ("imagen", "editar"):
        with pytest.raises(KeyError):
            creditos.costo_modelo(tarea, "nb2")


def test_los_modelos_a_la_venta_no_se_movieron():
    from pipeline import creditos
    assert creditos.costo_modelo("imagen", "grok") == 2
    assert creditos.costo_modelo("editar", "grok") == 2
    assert [creditos.costo_modelo("clip", "veo-lite", s) for s in (4, 6, 8)] == [18, 28, 36]


# ---------------------------------------------------------------------------
# escribir el número es lo ÚNICO que falta (simulado: tarifas.json no se toca)

@pytest.fixture
def encendido(monkeypatch):
    """Como si el dueño hubiera escrito la propuesta en tarifas.json §modelos."""
    from pipeline import creditos
    monkeypatch.setitem(creditos.MODELOS_CR.setdefault("imagen", {}), "nb2", PROPUESTA_NB2)
    monkeypatch.setitem(creditos.MODELOS_CR.setdefault("editar", {}), "nb2", PROPUESTA_NB2)
    for id_, tabla in PROPUESTA_CLIP.items():
        monkeypatch.setitem(creditos.MODELOS_CR["clip"], id_, dict(tabla))


@pytest.mark.parametrize("n_imagenes,extra", [(0, 0), (1, 0), (2, 2), (3, 2)])
@pytest.mark.parametrize("segundos", [4, 6, 8])
@pytest.mark.parametrize("modelo", sorted(PROPUESTA_CLIP))
def test_con_el_numero_puesto_el_clip_cobra_guarda_y_encola(
        cliente, espia, encendido, modelo, segundos, n_imagenes, extra):
    r = cliente.post("/api/clip/generar",
                     json={"texto": "mi perro", "modelo": modelo, "segundos": segundos,
                           "imagenes": _imagenes_propias(n_imagenes)})
    assert r.status_code == 200, r.text
    cobro = PROPUESTA_CLIP[modelo][segundos] + extra
    assert r.json()["creditos"] == cobro
    assert espia.cobros == [(cobro, f"clip:{r.json()['id']}")]
    (doc,) = [json.loads(t) for t in espia.s3.values()]
    assert (doc["modelo"], doc["segundos"], doc["creditos"]) == (modelo, segundos, cobro)
    assert len(espia.encolados) == 1 and espia.encolados[0][2] == segundos


@pytest.mark.parametrize("modelo", sorted(PROPUESTA_CLIP))
def test_con_el_numero_puesto_el_worker_llama_al_endpoint_del_modelo(
        cliente, espia, encendido, monkeypatch, tmp_path, modelo):
    """El doc que escribió el API (con el id del modelo) llega al endpoint de fal
    de ese modelo, a 720p y con audio; el costo anotado es el de su ficha."""
    import worker.clip_generar as w
    from pipeline import fal
    cliente.post("/api/clip/generar",
                 json={"texto": "mi perro", "modelo": modelo, "segundos": 6})
    (doc,) = [json.loads(t) for t in espia.s3.values()]
    llamadas = []

    async def llamar(app, argumentos, timeout_s, nombre, meta=None):
        llamadas.append((app, argumentos))
        return {"video": {"url": "https://fal.test/clip.mp4"}}

    async def descargar(url, destino):
        Path(destino).write_bytes(b"video")

    async def chat_json(name, system, user):
        return {"video": "A dog running.", "composicion": "", "recorte": ""}
    monkeypatch.setattr(fal, "llamar", llamar)
    monkeypatch.setattr(fal, "descargar", descargar)
    monkeypatch.setattr("pipeline.clip.chat_json", chat_json)
    res = asyncio.run(w._correr(doc, tmp_path))
    ((app, args),) = llamadas
    assert app == CLIPS[modelo][0]
    assert (args["duration"], args["resolution"], args["generate_audio"]) == ("6s", "720p", True)
    assert res["segundos"] == 6
    from pipeline import clip
    assert clip.costo_usd(0, modelo, 6) == USD_CLIP[modelo][6]


def test_con_el_numero_puesto_crear_imagen_cobra_y_llama_a_nano_banana_2(
        cliente, espia, falso_fal, encendido, imagenes_al_disco):
    r = cliente.post("/api/imagenes",
                     json={"prompt": "un gato", "modelo": "nb2", "formato": "horizontal"})
    assert r.status_code == 200, r.text
    assert espia.cobros == [(PROPUESTA_NB2, "imagen:estudio")] and espia.devueltos == []
    (ll,) = falso_fal
    assert ll.app == "fal-ai/nano-banana-2"
    assert ll.args["resolution"] == "1K" and ll.args["aspect_ratio"] == "16:9"
    assert ll.args["num_images"] == 1


@pytest.mark.parametrize("modo,esperado_imagenes", [("todo", 1), ("pincel", 2)])
def test_con_el_numero_puesto_editar_cobra_y_llama_al_edit_de_nano_banana_2(
        cliente, espia, falso_fal, encendido, imagenes_al_disco, modo, esperado_imagenes):
    archivos = {"imagen": ("a.png", b"\x89PNG-de-prueba", "image/png")}
    if modo == "pincel":
        archivos["marcada"] = ("m.jpg", b"\xff\xd8-de-prueba", "image/jpeg")
    r = cliente.post("/api/imagenes/editar",
                     data={"prompt": "más sol", "modo": modo, "modelo": "nb2"}, files=archivos)
    assert r.status_code == 200, r.text
    assert espia.cobros == [(PROPUESTA_NB2, "imagen:editor")]
    (ll,) = falso_fal
    assert ll.app == "fal-ai/nano-banana-2/edit"
    assert len(ll.args["image_urls"]) == esperado_imagenes
    assert ll.args["resolution"] == "1K"


def test_si_nano_banana_2_falla_se_devuelve_lo_cobrado(
        cliente, espia, falso_fal, encendido, imagenes_al_disco, monkeypatch):
    from pipeline import fal

    async def falla(*a, **k):
        raise fal.FalError("fal caído")
    monkeypatch.setattr(fal, "llamar", falla)
    r = cliente.post("/api/imagenes", json={"prompt": "un gato", "modelo": "nb2"})
    assert r.status_code == 502
    assert espia.cobros == [(PROPUESTA_NB2, "imagen:estudio")]
    assert espia.devueltos == [(PROPUESTA_NB2, "imagen:estudio")]


# ---------------------------------------------------------------------------
# guardián de fórmula: el número que se escriba al encender no se puede equivocar

PISO_VENTA = Fraction(15, 1000)       # $0.015 dólares por crédito (tarifas.json §economia)
FACTOR_MARGEN = Fraction(75, 100)     # costo ÷ 0.75: el margen de la hoja de costos


def creditos_sugeridos(usd, minimo: int = 0) -> int:
    """La regla de la hoja de costos: costo ÷ 0.75 ÷ $0.015 dólares, redondeado
    hacia arriba y luego al par (decisión del dueño del 9-oct-2026: nunca hacia
    abajo, así que el margen solo sube). `minimo` es el piso por imagen (2).

    Va con Fraction a propósito: con floats, 0.9 ÷ 0.75 ÷ 0.015 da 80.00000000000001
    y el «hacia arriba» lo mandaría a 82."""
    n = math.ceil(Fraction(str(usd)) / FACTOR_MARGEN / PISO_VENTA)
    n = max(n, minimo)
    return n + (n % 2)


def test_la_formula_reproduce_la_propuesta_de_los_veo_fast_y_standard():
    for id_, tabla in PROPUESTA_CLIP.items():
        for s, creditos in tabla.items():
            assert creditos_sugeridos(USD_CLIP[id_][s]) == creditos, (id_, s)
    assert [creditos_sugeridos(u) for u in (0.6, 0.9, 1.2)] == [54, 80, 108]
    assert [creditos_sugeridos(u) for u in (1.6, 2.4, 3.2)] == [144, 214, 286]


def test_la_formula_reproduce_el_de_nano_banana_2():
    assert creditos_sugeridos(NB2_USD, minimo=2) == PROPUESTA_NB2 == 8


def test_la_formula_reproduce_lo_que_ya_esta_a_la_venta():
    """El control: Veo Lite (36 a 8 s) y Grok (2, el mínimo por imagen)."""
    assert [creditos_sugeridos(u) for u in (0.2, 0.3, 0.4)] == [18, 28, 36]
    assert creditos_sugeridos(0.02, minimo=2) == 2
    assert creditos_sugeridos(0.022, minimo=2) == 2


def test_la_formula_no_cae_en_el_error_de_los_flotantes():
    """$0.27 dólares dan EXACTAMENTE 24 créditos; con flotantes salen
    24.000000000000004 y el «hacia arriba» los mandaría a 25 (y al par, a 26)."""
    assert 0.27 / 0.75 / 0.015 > 24                 # el flotante se pasa de 24...
    assert creditos_sugeridos(0.27) == 24           # ...y la fórmula no
    assert creditos_sugeridos(0.27) % 2 == 0
    assert creditos_sugeridos(0.9) == 80            # y 80 exactos siguen siendo 80


def test_la_formula_siempre_da_un_par_y_nunca_cubre_menos_que_el_costo():
    for centavos in range(1, 400):
        usd = centavos / 100
        cr = creditos_sugeridos(usd)
        assert cr % 2 == 0
        assert Fraction(cr) * PISO_VENTA * FACTOR_MARGEN >= Fraction(str(usd))


def test_el_piso_de_venta_de_la_formula_es_el_de_tarifas_json():
    t = _tarifas()["economia"]["piso_venta_usd_por_credito"]
    assert Fraction(str(t)) == PISO_VENTA


def test_la_propuesta_sale_de_los_costos_de_pricing_json():
    """Encadenado de punta a punta: ficha de pricing.json → costo → fórmula →
    propuesta. Si alguien corrige una ficha, la propuesta de aquí se entera."""
    from pipeline import clip
    from pipeline.pricing import costo_fal
    for id_, tabla in PROPUESTA_CLIP.items():
        for s, creditos in tabla.items():
            assert creditos_sugeridos(clip.costo_usd(0, id_, s)) == creditos
    for app, args in (("fal-ai/nano-banana-2", {"num_images": 1}),
                      ("fal-ai/nano-banana-2/edit", {"num_images": 1, "image_urls": ["a"]})):
        assert creditos_sugeridos(costo_fal(app, args), minimo=2) == PROPUESTA_NB2


def test_guardian_todo_modelo_con_numero_cubre_su_costo_con_el_margen():
    """Cuando el dueño escriba un número en tarifas.json §modelos, este guardián
    comprueba que no quede por debajo de la fórmula (el margen solo puede subir).
    Hoy cubre a los modelos a la venta; mañana, a los que se enciendan."""
    from pipeline import clip, creditos, modelos_ia
    from pipeline.pricing import costo_fal
    revisados = 0
    for tarea, tabla in creditos.MODELOS_CR.items():
        for id_, valor in tabla.items():
            m = modelos_ia.resolver(tarea, id_)
            if tarea == "clip":
                for s, cr in valor.items():
                    assert cr >= creditos_sugeridos(clip.costo_usd(0, id_, s)), (id_, s)
                    revisados += 1
            else:
                args = {"num_images": 1}
                if tarea == "editar":
                    args["image_urls"] = ["a"]          # una referencia, como el editor
                usd = costo_fal(m.endpoint_para(tarea == "editar"), args)
                assert usd, (tarea, id_)
                assert valor >= creditos_sugeridos(usd, minimo=2), (tarea, id_)
                revisados += 1
    assert revisados >= 5                              # grok ×2 y las tres duraciones de Lite
