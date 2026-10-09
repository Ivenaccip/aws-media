"""R4 · F1 — el servidor sabe qué modelo se pidió y no se deja engañar.

Lo que este archivo defiende:
  * que el id de modelo sea lo único que manda el cliente: el servidor lo busca
    en su tabla (pipeline/modelos_ia.py) y cobra de tools/tarifas.json §modelos;
  * que un modelo que no está en la tabla, o no trae tarifa, se rechace con 422
    ANTES de cobrar — nunca se cae al modelo de siempre, porque cobraría uno y
    entregaría otro;
  * que el costo en dólares case por endpoint EXACTO: Veo 3.1 Fast o Nano Banana
    2 no pueden heredar la tabla de Veo Lite o del Nano Banana viejo;
  * que sumar un endpoint por pricing.json §generacion.endpoints se cueste sin
    tocar código, y que una ficha a medias dé «sin costo», no un cero.

La duración del clip (4, 6, 8 s) y su precio por duración viven en
tests/test_r4_duracion.py.

OJO: nada de importar pipeline/server a nivel de módulo (ver test_m25_clip)."""
import json
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

RAIZ = Path(__file__).resolve().parent.parent


# ---------------------------------------------------------------------------
# la tabla

def test_sin_modelo_se_usa_el_predeterminado():
    from pipeline import modelos_ia
    assert modelos_ia.resolver("clip", None).id == "veo-lite"
    assert modelos_ia.resolver("clip", "  ").id == "veo-lite"
    assert modelos_ia.resolver("imagen", "").id == "grok"
    assert modelos_ia.resolver("editar", None).id == "grok"


def test_un_modelo_desconocido_no_cae_al_predeterminado():
    from pipeline import modelos_ia
    for tarea, id_ in (("clip", "kling"), ("imagen", "gpt2"), ("editar", "nbp")):
        with pytest.raises(modelos_ia.ModeloDesconocido):
            modelos_ia.resolver(tarea, id_)
    with pytest.raises(modelos_ia.ModeloDesconocido):
        modelos_ia.resolver("audio", "grok")


def test_los_endpoints_salen_de_settings():
    from pipeline import modelos_ia
    from pipeline.config import settings
    clip = modelos_ia.resolver("clip", "veo-lite")
    assert clip.endpoint_para(False) == settings.fal_veo_t2v
    assert clip.endpoint_para(True) == settings.fal_veo
    img = modelos_ia.resolver("imagen", "grok")
    assert img.endpoint_para(False) == settings.fal_imagen
    assert img.endpoint_para(True) == settings.fal_imagen_edit
    assert modelos_ia.resolver("editar", "grok").endpoint == settings.fal_imagen_edit


def test_cada_numero_de_la_tarifa_es_de_un_modelo_de_la_tabla():
    """La tabla y la tarifa tienen que andar juntas. Un número en tarifas.json
    para un modelo que la tabla no conoce es una tarifa que nadie puede pedir
    (dedazo). Al revés NO es un error: una fila de la tabla sin número es un
    modelo INERTE (Ola 1: veo-fast, veo-std, nb2) y el servidor lo rechaza con 422;
    cuáles son hoy los inertes lo fija tests/test_r4_ola1.py."""
    from pipeline import creditos, modelos_ia
    for tarea, tabla in creditos.MODELOS_CR.items():
        assert tarea in modelos_ia.TAREAS, tarea
        assert set(tabla) <= set(modelos_ia.disponibles(tarea)), tarea
    # los que sí tienen número se cobran: entero, o uno por cada duración
    for tarea in modelos_ia.TAREAS:
        for id_ in creditos.MODELOS_CR.get(tarea, {}):
            m = modelos_ia.resolver(tarea, id_)
            if m.duraciones:       # el clip: un número por cada duración que admite
                for s in m.duraciones:
                    assert isinstance(creditos.costo_modelo(tarea, id_, s), int)
            else:
                assert isinstance(creditos.costo_modelo(tarea, id_), int)
    # los dos modelos a la venta desde R4 siguen con número
    assert set(creditos.MODELOS_CR["imagen"]) >= {"grok"}
    assert set(creditos.MODELOS_CR["editar"]) >= {"grok"}
    assert set(creditos.MODELOS_CR["clip"]) >= {"veo-lite"}


def test_los_predeterminados_cuestan_lo_de_siempre():
    from pipeline import creditos
    # el clip trae un número por duración; a 8 s (la de siempre) vale la tarifa plana
    assert creditos.costo_modelo("clip", "veo-lite", 8) == creditos.costo_clip(0)
    assert creditos.costo_modelo("clip", "veo-lite") == creditos.costo_clip(0)
    assert creditos.costo_modelo("imagen", "grok") == creditos.costo_imagen()
    assert creditos.costo_modelo("editar", "grok") == creditos.costo_imagen()
    assert creditos.costo_clip(2, "veo-lite", 8) == creditos.costo_clip(2)
    assert creditos.costo_clip(2, "veo-lite") == creditos.costo_clip(2)


# ---------------------------------------------------------------------------
# el costo en dólares: por endpoint exacto

def test_un_modelo_de_la_misma_familia_no_hereda_el_costo_de_lite():
    """Cada endpoint se cuesta por su nombre EXACTO. Veo Fast y Standard (Ola 1)
    traen su propia ficha, con su propio precio: no el de Lite. Un endpoint
    vecino al que nadie le anotó ficha sigue dando «sin costo»."""
    from pipeline.pricing import costo_fal, unidades_fal
    args = {"duration": "8s", "resolution": "720p", "generate_audio": True}
    assert costo_fal("fal-ai/veo3.1/lite", args) == 0.4
    # los de Ola 1 cuestan lo suyo: ni lo de Lite ni None
    assert costo_fal("fal-ai/veo3.1/fast", args) == 1.2
    assert costo_fal("fal-ai/veo3.1", args) == 3.2
    assert costo_fal("fal-ai/veo3.1/image-to-video", args) == 3.2
    assert costo_fal("fal-ai/nano-banana-2", {"num_images": 1}) == 0.08
    # los vecinos sin ficha: «sin costo conocido», nunca el del que se parece
    for otro in ("fal-ai/veo3.1/reference-to-video", "fal-ai/veo3.1/lite/extend-video",
                 "fal-ai/veo3.1/first-last-frame-to-video"):
        assert costo_fal(otro, args) is None, otro
        assert unidades_fal(otro, args) is None, otro
    for otro in ("fal-ai/nano-banana-pro", "fal-ai/nano-banana-pro/edit",
                 "google/nano-banana-2-lite", "fal-ai/nano-banana-2/lite"):
        assert costo_fal(otro, {"num_images": 1}) is None, otro
        assert unidades_fal(otro, {"num_images": 1}) is None, otro


def test_un_endpoint_en_pricing_json_se_cuesta_sin_tocar_codigo(monkeypatch):
    from pipeline import pricing
    monkeypatch.setitem(pricing.ENDPOINTS_JSON, "fal-ai/prueba/imagen",
                        {"unidad": "imagen", "usd": 0.05, "usd_referencia": 0.01})
    monkeypatch.setitem(pricing.ENDPOINTS_JSON, "fal-ai/prueba/video",
                        {"unidad": "segundo",
                         "usd_por_segundo": {"720p_con_audio": 0.1, "720p_sin_audio": 0.07}})
    assert pricing.costo_fal("fal-ai/prueba/imagen",
                             {"num_images": 2, "image_urls": ["a"]}) == 0.11
    assert pricing.costo_fal("fal-ai/prueba/video",
                             {"duration": "8s", "resolution": "720p", "generate_audio": True}) == 0.8
    assert pricing.costo_fal("fal-ai/prueba/video",
                             {"duration": "4s", "resolution": "720p"}) == 0.28
    assert pricing.unidades_fal("fal-ai/prueba/video", {"duration": "4s"}) == {"video_seconds": 4}


def test_una_ficha_a_medias_da_sin_costo_y_no_cero(monkeypatch):
    from pipeline import pricing
    monkeypatch.setitem(pricing.ENDPOINTS_JSON, "fal-ai/a/medias", {"unidad": "imagen"})
    monkeypatch.setitem(pricing.ENDPOINTS_JSON, "fal-ai/sin/res",
                        {"unidad": "segundo", "usd_por_segundo": {"720p_con_audio": 0.1}})
    assert pricing.costo_fal("fal-ai/a/medias", {"num_images": 1}) is None
    # pidió 1080p y la ficha no lo trae: no se inventa
    assert pricing.costo_fal("fal-ai/sin/res",
                             {"duration": "8s", "resolution": "1080p", "generate_audio": True}) is None


def test_pricing_json_trae_la_seccion_de_endpoints():
    d = json.loads((RAIZ / "tools" / "pricing.json").read_text(encoding="utf-8"))
    assert isinstance(d["generacion"]["endpoints"], dict)


# ---------------------------------------------------------------------------
# la API

@pytest.fixture
def cliente(monkeypatch):
    monkeypatch.delenv("COGNITO_POOL_ID", raising=False)
    monkeypatch.setenv("STATE_BACKEND", "postgres")
    monkeypatch.setenv("MEDIA_BUCKET", "bucket-de-prueba")
    from server.app import app
    return TestClient(app)


@pytest.fixture
def s3(monkeypatch):
    from pipeline import media_sync
    docs = {}
    monkeypatch.setattr(media_sync, "leer_texto", docs.get)
    monkeypatch.setattr(media_sync, "escribir_texto",
                        lambda key, texto, tipo="application/json": docs.__setitem__(key, texto))
    monkeypatch.setattr(media_sync, "listar_prefijo",
                        lambda pref: sorted(k for k in docs if k.startswith(pref)))
    return docs


def _espiar_cobro(monkeypatch):
    from pipeline import creditos, jobs
    cobros = []
    monkeypatch.setattr(creditos, "activo", lambda: True)
    monkeypatch.setattr(creditos, "cobrar", lambda n, ref, u=None: cobros.append((n, ref)))
    monkeypatch.setattr(jobs, "encolar_clip", lambda *a: None)
    return cobros


def test_el_clip_con_modelo_desconocido_se_rechaza_antes_de_cobrar(cliente, s3, monkeypatch):
    cobros = _espiar_cobro(monkeypatch)
    r = cliente.post("/api/clip/generar", json={"texto": "mi perro", "modelo": "kling"})
    assert r.status_code == 422
    assert cobros == [] and s3 == {}


def test_el_clip_guarda_el_modelo_y_cobra_su_tarifa(cliente, s3, monkeypatch):
    from pipeline import creditos
    cobros = _espiar_cobro(monkeypatch)
    r = cliente.post("/api/clip/generar", json={"texto": "mi perro", "modelo": "veo-lite"})
    assert r.status_code == 200
    assert cobros[0][0] == creditos.costo_clip(0, "veo-lite")
    doc = json.loads(next(iter(s3.values())))
    assert doc["modelo"] == "veo-lite" and doc["segundos"] == 8


def test_el_clip_sin_modelo_se_queda_con_el_predeterminado(cliente, s3, monkeypatch):
    cobros = _espiar_cobro(monkeypatch)
    r = cliente.post("/api/clip/generar", json={"texto": "mi perro"})
    assert r.status_code == 200
    assert json.loads(next(iter(s3.values())))["modelo"] == "veo-lite"
    assert cobros


def test_una_imagen_con_modelo_desconocido_no_cobra(cliente, monkeypatch):
    from pipeline import creditos
    cobros = []
    monkeypatch.setattr(creditos, "activo", lambda: True)
    monkeypatch.setattr(creditos, "cobrar", lambda n, ref, u=None: cobros.append(n))
    r = cliente.post("/api/imagenes", json={"prompt": "un gato", "modelo": "gpt2"})
    assert r.status_code == 422 and cobros == []


def test_editar_con_modelo_desconocido_no_cobra(cliente, monkeypatch):
    from pipeline import creditos
    cobros = []
    monkeypatch.setattr(creditos, "activo", lambda: True)
    monkeypatch.setattr(creditos, "cobrar", lambda n, ref, u=None: cobros.append(n))
    r = cliente.post("/api/imagenes/editar",
                     data={"prompt": "más sol", "modo": "todo", "modelo": "nbp"},
                     files={"imagen": ("a.png", b"\x89PNG-de-prueba", "image/png")})
    assert r.status_code == 422 and cobros == []


def test_la_imagen_con_modelo_pedido_llama_a_su_endpoint(cliente, monkeypatch, tmp_path):
    from pipeline import creditos, fal
    from pipeline.config import settings
    llamadas = []

    async def llamar(app, args, timeout_s, nombre, meta=None):
        llamadas.append(app)
        return {"images": [{"url": "https://fal.test/x.jpg"}]}

    async def descargar(url, destino):
        Path(destino).write_bytes(b"x")
    monkeypatch.setattr(fal, "llamar", llamar)
    monkeypatch.setattr(fal, "descargar", descargar)
    monkeypatch.setattr(creditos, "activo", lambda: False)
    import server.app as app_mod
    monkeypatch.setattr(app_mod, "_dir_imagenes", lambda: tmp_path)
    monkeypatch.setattr(app_mod, "_publicar_imagen", lambda *a: None)
    r = cliente.post("/api/imagenes", json={"prompt": "un gato", "modelo": "grok"})
    assert r.status_code == 200, r.text
    assert llamadas == [settings.fal_imagen]
