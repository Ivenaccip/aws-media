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


def test_cada_modelo_de_la_tabla_trae_tarifa():
    """Un modelo sin número en tarifas.json no se puede ofrecer: la tabla y la
    tarifa tienen que andar juntas, en las dos direcciones."""
    from pipeline import creditos, modelos_ia
    for tarea in modelos_ia.TAREAS:
        for id_ in modelos_ia.disponibles(tarea):
            assert isinstance(creditos.costo_modelo(tarea, id_), int)
        assert set(creditos.MODELOS_CR.get(tarea, {})) == set(modelos_ia.disponibles(tarea))


def test_los_predeterminados_cuestan_lo_de_siempre():
    from pipeline import creditos
    assert creditos.costo_modelo("clip", "veo-lite") == creditos.costo_clip(0)
    assert creditos.costo_modelo("imagen", "grok") == creditos.costo_imagen()
    assert creditos.costo_modelo("editar", "grok") == creditos.costo_imagen()
    assert creditos.costo_clip(2, "veo-lite") == creditos.costo_clip(2)


# ---------------------------------------------------------------------------
# el costo en dólares: por endpoint exacto

def test_un_modelo_de_la_misma_familia_no_hereda_el_costo_de_lite():
    from pipeline.pricing import costo_fal, unidades_fal
    args = {"duration": "8s", "resolution": "720p", "generate_audio": True}
    assert costo_fal("fal-ai/veo3.1/lite", args) is not None
    for otro in ("fal-ai/veo3.1/fast", "fal-ai/veo3.1", "fal-ai/veo3.1/image-to-video"):
        assert costo_fal(otro, args) is None, otro
        assert unidades_fal(otro, args) is None, otro
    assert costo_fal("fal-ai/nano-banana-2", {"num_images": 1}) is None
    assert costo_fal("fal-ai/nano-banana-pro", {"num_images": 1}) is None


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
    assert doc["modelo"] == "veo-lite"


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
