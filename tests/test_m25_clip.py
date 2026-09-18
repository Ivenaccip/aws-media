"""M25 · A/F — el clip de 8 segundos: la tarifa, los tres caminos según cuántas
imágenes llegaron, la API que cobra y encola, y el worker que devuelve.

Lo que este archivo defiende:
  * que la tarifa cubra el costo real en los TRES casos — 30 créditos salen de
    la economía, y a 20 se perdería dinero en cada clip;
  * que el extra de componer se cobre SOLO con dos o tres imágenes: con cero o
    con una no se paga Grok, así que cobrarlo sería cobrar por nada;
  * que el clip NO herede el prompt negativo del corto animado, que prohíbe
    `photorealistic, humans, people, person, face` — justo lo que la gente sube
    aquí (una cara, un perro, un producto);
  * que sin imagen se llame al endpoint de text-to-video y con imagen al de
    image-to-video, y que en los dos venga el audio encendido: es lo cobrado;
  * que los timeouts sean los del clip y quepan en los 15 minutos de la Lambda;
  * que una key de otro usuario no se pueda animar;
  * que el fallo devuelva los créditos COMPLETOS y no relance (un reintento de
    la cola cobraría un segundo video que nadie pidió).

Sin red: fal/LLM/SQS/S3/Postgres mockeados.

OJO: nada de importar pipeline/server a nivel de módulo — pipeline.config
carga el .env real en la COLECCIÓN y contaminaría el entorno de otros tests."""
import asyncio
import json
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

RAIZ = Path(__file__).resolve().parent.parent


def _tarifas() -> dict:
    return json.loads((RAIZ / "tools" / "tarifas.json").read_text(encoding="utf-8"))


# ---------------------------------------------------------------------------
# la tarifa

def test_tarifa_espejo_de_tarifas_json():
    from pipeline import creditos
    t = _tarifas()["clip"]
    assert creditos.costo_clip(0) == t["video_8s"]
    assert creditos.costo_clip(3) == t["video_8s"] + t["componer_imagenes"]


def test_componer_solo_se_cobra_cuando_de_verdad_se_compone():
    """Con cero imágenes es text-to-video y con una se anima directo: en los dos
    casos no se llama a Grok, así que cobrar el extra sería cobrar por nada."""
    from pipeline import creditos
    assert creditos.costo_clip(0) == creditos.costo_clip(1)
    assert creditos.costo_clip(2) > creditos.costo_clip(1)
    assert creditos.costo_clip(2) == creditos.costo_clip(3)


def test_la_tarifa_cubre_el_costo_en_los_tres_casos():
    """La razón por la que son 30 y no 20. Al piso de venta, 20 créditos son
    $0.30 dólares contra $0.40 de Veo: cada clip perdería dinero."""
    from pipeline import clip, creditos
    piso = _tarifas()["economia"]["piso_venta_usd_por_credito"]
    for n in (0, 1, 2, 3):
        venta = creditos.costo_clip(n) * piso
        assert clip.costo_usd(n) < venta, f"con {n} imagen(es) se vende bajo costo"
    # y el número que se descartó, para que quede escrito por qué
    assert clip.costo_usd(0) > 20 * piso


def test_el_costo_sale_de_pricing_json_y_no_de_aqui():
    from pipeline import clip
    p = json.loads((RAIZ / "tools" / "pricing.json").read_text(encoding="utf-8"))
    veo = p["generacion"]["veo31_lite_usd_por_segundo"]["720p_con_audio"]
    assert clip.costo_usd(0) == round(clip.DURACION_S * veo, 4)


# ---------------------------------------------------------------------------
# los tres caminos

class _Fal:
    """Registra cada llamada a fal en vez de hacerla."""

    def __init__(self):
        self.llamadas = []

    async def llamar(self, app, argumentos, timeout_s, nombre, meta=None):
        self.llamadas.append({"app": app, "args": argumentos, "timeout": timeout_s})
        if "grok" in app:
            return {"images": [{"url": "https://fal.test/compuesta.png"}]}
        return {"video": {"url": "https://fal.test/clip.mp4"}}


@pytest.fixture
def falso_fal(monkeypatch):
    from pipeline import fal
    doble = _Fal()
    monkeypatch.setattr(fal, "llamar", doble.llamar)
    return doble


@pytest.fixture
def falso_llm(monkeypatch):
    async def chat_json(name, system, user):
        return {"video": "A dog running on the beach at sunset. Slow push in.",
                "composicion": "the dog on the left, the cat on the right",
                "recorte": ""}
    monkeypatch.setattr("pipeline.clip.chat_json", chat_json)


def _generar(texto="mi perro en la playa", urls=None, formato="horizontal"):
    from pipeline import clip
    return asyncio.run(clip.generar(texto, urls or [], formato))


def test_sin_imagen_va_al_endpoint_de_texto(falso_fal, falso_llm):
    from pipeline.config import settings
    r = _generar()
    assert [c["app"] for c in falso_fal.llamadas] == [settings.fal_veo_t2v]
    assert "image_url" not in falso_fal.llamadas[0]["args"]
    assert r["origen_inicial"] == "sin_imagen"


def test_una_imagen_se_anima_directo_sin_pagar_grok(falso_fal, falso_llm):
    from pipeline.config import settings
    r = _generar(urls=["https://fal.test/foto.jpg"])
    assert [c["app"] for c in falso_fal.llamadas] == [settings.fal_veo]
    assert falso_fal.llamadas[0]["args"]["image_url"] == "https://fal.test/foto.jpg"
    assert r["origen_inicial"] == "subida"


def test_dos_o_tres_imagenes_pasan_por_grok_antes_de_animar(falso_fal, falso_llm):
    from pipeline.config import settings
    r = _generar(urls=["a.jpg", "b.jpg", "c.jpg"])
    apps = [c["app"] for c in falso_fal.llamadas]
    assert apps == [settings.fal_grok, settings.fal_veo]
    assert falso_fal.llamadas[0]["args"]["image_urls"] == ["a.jpg", "b.jpg", "c.jpg"]
    # la composición ES el cuadro inicial del video
    assert falso_fal.llamadas[1]["args"]["image_url"] == "https://fal.test/compuesta.png"
    assert r["origen_inicial"] == "compuesta"


def test_mas_de_tres_imagenes_se_recortan(falso_fal, falso_llm):
    _generar(urls=["a.jpg", "b.jpg", "c.jpg", "d.jpg", "e.jpg"])
    assert len(falso_fal.llamadas[0]["args"]["image_urls"]) == 3


# ---------------------------------------------------------------------------
# lo que NO se hereda del otro producto

def test_el_clip_no_lleva_el_prompt_negativo_del_corto_animado(falso_fal, falso_llm):
    """La trampa que el plan nombra: VEO_NEGATIVE prohíbe `photorealistic,
    humans, people, person, face` porque el otro producto son cortos animados.
    Con la foto de un perro o de una cara ese negativo le pelea al modelo."""
    from pipeline.scenes import VEO_NEGATIVE
    # el del otro producto sigue prohibiendo justo eso — por eso no se hereda
    assert {"humans", "people", "person", "face"} <= set(
        p.strip() for p in VEO_NEGATIVE.split(","))
    _generar(urls=["https://fal.test/foto.jpg"])
    args = falso_fal.llamadas[-1]["args"]
    assert "negative_prompt" not in args
    assert "photorealistic" not in json.dumps(args)


def test_la_composicion_no_impone_el_estilo_del_proyecto(falso_fal, falso_llm):
    """`resolver_referencias` cuelga ESTILO_SUFIJO y «Keep EXACTLY the same
    character design». Aquí se juntan sujetos, no se rediseñan."""
    _generar(urls=["a.jpg", "b.jpg"])
    prompt = falso_fal.llamadas[0]["args"]["prompt"]
    assert "Keep EXACTLY the same character design" not in prompt


def test_el_audio_viene_encendido_porque_es_lo_que_se_cobra(falso_fal, falso_llm):
    """30 créditos son la tarifa CON audio ($0.05/s contra $0.03). En la
    película está cableado en False; heredarlo aquí sería cobrar de más."""
    for urls in ([], ["a.jpg"]):
        falso_fal.llamadas.clear()
        _generar(urls=urls)
        assert falso_fal.llamadas[-1]["args"]["generate_audio"] is True


def test_dura_ocho_segundos_a_720p(falso_fal, falso_llm):
    _generar()
    args = falso_fal.llamadas[-1]["args"]
    assert args["duration"] == "8s" and args["resolution"] == "720p"


def test_el_formato_vertical_llega_a_los_dos_modelos(falso_fal, falso_llm):
    _generar(urls=["a.jpg", "b.jpg"], formato="vertical")
    assert all(c["args"]["aspect_ratio"] == "9:16" for c in falso_fal.llamadas)


# ---------------------------------------------------------------------------
# timeouts: la DLQ silenciosa

def test_los_timeouts_del_clip_caben_en_la_lambda(falso_fal, falso_llm):
    """La Lambda del worker muere a los 15 minutos. Heredar los 720 s × 2
    intentos de la película son 24: clips sanos a la DLQ."""
    from pipeline.config import settings
    peor_caso = (settings.clip_componer_timeout_s
                 + settings.clip_timeout_s * settings.clip_max_attempts)
    assert peor_caso < 15 * 60
    assert settings.clip_timeout_s < settings.veo_timeout_s
    _generar()
    assert falso_fal.llamadas[-1]["timeout"] == settings.clip_timeout_s


def test_veo_que_falla_se_reintenta_y_luego_se_rinde(monkeypatch, falso_llm):
    from pipeline import clip, fal

    async def siempre_falla(app, argumentos, timeout_s, nombre, meta=None):
        raise fal.FalError("503")
    monkeypatch.setattr(fal, "llamar", siempre_falla)
    with pytest.raises(clip.ClipError):
        _generar()


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
    """media_sync en memoria: {key: texto}."""
    from pipeline import media_sync
    docs = {}
    monkeypatch.setattr(media_sync, "leer_texto", docs.get)
    monkeypatch.setattr(media_sync, "escribir_texto",
                        lambda key, texto, tipo="application/json": docs.__setitem__(key, texto))
    monkeypatch.setattr(media_sync, "listar_prefijo",
                        lambda pref: sorted(k for k in docs if k.startswith(pref)))
    return docs


def test_config_enseña_el_precio_antes_de_cobrar(cliente, s3):
    from pipeline import creditos
    r = cliente.get("/api/clip/config")
    assert r.status_code == 200
    d = r.json()
    assert d["creditos"] == creditos.costo_clip(0)
    assert d["creditos_con_composicion"] == creditos.costo_clip(2)
    assert d["max_imagenes"] == 3 and d["segundos"] == 8


def test_el_heic_del_iphone_se_acepta(cliente, s3):
    """Es el formato con el que salen las fotos de un iPhone: un validador que
    no lo contemple rechaza fotos perfectamente buenas."""
    from pipeline import clip
    assert ".heic" in clip.EXTS
    assert ".heic" in cliente.get("/api/clip/config").json()["extensiones"]


def test_un_archivo_que_veo_no_lee_se_rechaza_antes_de_subir(cliente, s3):
    r = cliente.post("/api/clip/presign", json={"archivo": "virus.exe"})
    assert r.status_code == 422


def test_cobra_antes_de_encolar(cliente, s3, monkeypatch):
    from pipeline import creditos, jobs
    orden = []
    monkeypatch.setattr(creditos, "activo", lambda: True)
    monkeypatch.setattr(creditos, "cobrar",
                        lambda n, ref, u=None: orden.append(("cobrar", n)))
    monkeypatch.setattr(jobs, "encolar_clip",
                        lambda *a: orden.append(("encolar",)))
    r = cliente.post("/api/clip/generar", json={"texto": "mi perro en la playa"})
    assert r.status_code == 200
    assert [o[0] for o in orden] == ["cobrar", "encolar"]
    assert orden[0][1] == creditos.costo_clip(0)
    assert r.json()["creditos"] == creditos.costo_clip(0)


def test_cobrado_y_sin_encolar_se_devuelve(cliente, s3, monkeypatch):
    from pipeline import creditos, jobs
    devuelto = []
    monkeypatch.setattr(creditos, "activo", lambda: True)
    monkeypatch.setattr(creditos, "cobrar", lambda *a, **k: 0)
    monkeypatch.setattr(creditos, "devolver",
                        lambda n, ref, u=None: devuelto.append(n))
    monkeypatch.setattr(jobs, "encolar_clip",
                        lambda *a: (_ for _ in ()).throw(RuntimeError("SQS caído")))
    r = cliente.post("/api/clip/generar", json={"texto": "mi perro"})
    assert r.status_code == 502
    assert devuelto == [creditos.costo_clip(0)]


def test_sin_saldo_no_se_encola_nada(cliente, s3, monkeypatch):
    from pipeline import creditos, jobs
    monkeypatch.setattr(creditos, "activo", lambda: True)
    monkeypatch.setattr(creditos, "cobrar",
                        lambda *a, **k: (_ for _ in ()).throw(creditos.SinSaldo(30, 4)))
    monkeypatch.setattr(jobs, "encolar_clip",
                        lambda *a: pytest.fail("encoló sin saldo"))
    assert cliente.post("/api/clip/generar", json={"texto": "x"}).status_code == 402


def test_la_imagen_de_otro_usuario_no_se_puede_animar(cliente, s3, monkeypatch):
    """Las keys las manda el navegador: sin esto, cualquiera animaría las fotos
    de otra cuenta — y pagándolas, que es peor."""
    from pipeline import creditos, jobs
    monkeypatch.setattr(creditos, "activo", lambda: True)
    monkeypatch.setattr(creditos, "cobrar", lambda *a, **k: pytest.fail("cobró"))
    monkeypatch.setattr(jobs, "encolar_clip", lambda *a: pytest.fail("encoló"))
    r = cliente.post("/api/clip/generar",
                     json={"texto": "x", "imagenes": ["usuarios/otro/clips/subidas/a.jpg"]})
    assert r.status_code == 422


def test_el_extra_de_componer_llega_al_cobro(cliente, s3, monkeypatch):
    from pipeline import creditos, db, jobs
    cobrado = []
    monkeypatch.setattr(creditos, "activo", lambda: True)
    monkeypatch.setattr(creditos, "cobrar", lambda n, ref, u=None: cobrado.append(n))
    monkeypatch.setattr(jobs, "encolar_clip", lambda *a: None)
    user = db.usuario_actual()
    r = cliente.post("/api/clip/generar", json={
        "texto": "mi perro y mi gato",
        "imagenes": [f"usuarios/{user}/clips/subidas/a.jpg",
                     f"usuarios/{user}/clips/subidas/b.jpg"]})
    assert r.status_code == 200
    assert cobrado == [creditos.costo_clip(2)]


def test_no_se_encolan_clips_sin_fin(cliente, s3, monkeypatch):
    from pipeline import creditos, jobs
    monkeypatch.setattr(creditos, "activo", lambda: False)
    monkeypatch.setattr(jobs, "encolar_clip", lambda *a: None)
    for _ in range(3):
        assert cliente.post("/api/clip/generar", json={"texto": "x"}).status_code == 200
    assert cliente.post("/api/clip/generar", json={"texto": "x"}).status_code == 409


def test_el_listado_no_abre_todo_el_historial(cliente, s3, monkeypatch):
    """La página sondea cada 5 segundos mientras hay uno generándose: leer el
    historial entero en cada vuelta son decenas de GET por usuario cada cinco
    segundos. El id empieza por la fecha, así que el recorte va antes de leer."""
    from pipeline import db, media_sync
    from server import clip_api
    user = db.usuario_actual()
    for i in range(clip_api.MAX_CLIPS + 12):
        s3[f"usuarios/{user}/clips/clip-202609{i // 30 + 1:02d}-{i:06d}-aaaaaa.json"] = \
            json.dumps({"estado": "listo", "inicio": "2026-09-18", "texto": f"n{i}"})
    leidas = []
    original = media_sync.leer_texto
    monkeypatch.setattr(media_sync, "leer_texto",
                        lambda k: (leidas.append(k), original(k))[1])

    clips = cliente.get("/api/clip").json()["clips"]

    assert len(clips) == clip_api.MAX_CLIPS
    assert len(leidas) == clip_api.MAX_CLIPS
    assert clips[0]["id"] > clips[-1]["id"]      # del más nuevo al más viejo


def test_un_clip_ajeno_no_se_ve(cliente, s3, monkeypatch):
    s3["usuarios/otro/clips/clip-20260918-120000-abcdef.json"] = json.dumps(
        {"estado": "listo", "key": "usuarios/otro/clips/x.mp4"})
    r = cliente.get("/api/clip/clip-20260918-120000-abcdef")
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# el worker: devolver y NO relanzar

@pytest.fixture
def worker(monkeypatch, s3):
    from pipeline import costes_infra, creditos, db
    import worker.clip_generar as w
    # generar() asigna os.environ["DEFAULT_USER_ID"] directo (el worker corre
    # solo en su Lambda). Registrarla aquí es lo que hace que monkeypatch la
    # restaure al terminar: sin esto el "u1" se queda puesto y los tests de
    # login y de Stripe que corren después ven ese usuario en vez del suyo.
    monkeypatch.setenv("DEFAULT_USER_ID", "u1")
    devueltos = []
    monkeypatch.setattr(creditos, "activo", lambda: True)
    monkeypatch.setattr(creditos, "devolver",
                        lambda n, ref, u=None: devueltos.append(n))
    monkeypatch.setattr(db, "backend", lambda: "off")
    monkeypatch.setattr(costes_infra, "registrar", lambda *a, **k: None)
    return w, devueltos


def test_un_clip_que_falla_devuelve_todo_y_no_relanza(worker, s3, monkeypatch):
    """No hay medias entregas: o hay video o no hay nada. Y si esto relanzara,
    la cola generaría un segundo video —otros $0.40 dólares— que nadie pidió."""
    w, devueltos = worker
    s3["usuarios/u1/clips/clip-20260918-120000-aaaaaa.json"] = json.dumps(
        {"estado": "generando", "creditos": 30, "texto": "x", "imagenes": []})

    async def falla(doc, tmp):
        from pipeline import clip
        raise clip.ClipError("Veo no respondió")
    monkeypatch.setattr(w, "_correr", falla)

    w.generar("u1", "clip-20260918-120000-aaaaaa")   # no levanta: SQS borra el mensaje

    assert devueltos == [30]
    doc = json.loads(s3["usuarios/u1/clips/clip-20260918-120000-aaaaaa.json"])
    assert doc["estado"] == "error"
    assert "Veo no respondió" in doc["error"]


def test_un_error_inesperado_no_se_le_enseña_al_usuario(worker, s3, monkeypatch):
    """Un KeyError o una traza de boto3 no dicen nada y asustan; lo que el
    usuario necesita saber es que no se le cobró."""
    w, devueltos = worker
    s3["usuarios/u1/clips/clip-20260918-120000-bbbbbb.json"] = json.dumps(
        {"estado": "generando", "creditos": 32, "texto": "x", "imagenes": []})

    async def revienta(doc, tmp):
        raise KeyError("start_image_url")
    monkeypatch.setattr(w, "_correr", revienta)

    w.generar("u1", "clip-20260918-120000-bbbbbb")

    assert devueltos == [32]
    doc = json.loads(s3["usuarios/u1/clips/clip-20260918-120000-bbbbbb.json"])
    assert "start_image_url" not in doc["error"]
    assert "no se te cobró" in doc["error"].lower()


def test_un_clip_bueno_no_devuelve_nada_y_queda_listo(worker, s3, monkeypatch):
    w, devueltos = worker
    from pipeline import media_sync
    subidas = []
    monkeypatch.setattr(media_sync, "subir_archivo",
                        lambda local, key: subidas.append(key))
    s3["usuarios/u1/clips/clip-20260918-120000-cccccc.json"] = json.dumps(
        {"estado": "generando", "creditos": 30, "texto": "x", "imagenes": []})

    async def bien(doc, tmp):
        destino = tmp / "clip.mp4"
        destino.write_bytes(b"video")
        return {"video_url": "https://fal.test/clip.mp4", "imagen_inicial": None,
                "origen_inicial": "sin_imagen", "prompt": "a dog", "recorte": "",
                "prompt_composicion": "", "segundos": 8, "bytes": 5, "_local": destino}
    monkeypatch.setattr(w, "_correr", bien)

    w.generar("u1", "clip-20260918-120000-cccccc")

    assert devueltos == []
    doc = json.loads(s3["usuarios/u1/clips/clip-20260918-120000-cccccc.json"])
    assert doc["estado"] == "listo"
    assert doc["key"] == "usuarios/u1/clips/clip-20260918-120000-cccccc.mp4"
    assert subidas == [doc["key"]]


def test_el_worker_conoce_el_tipo_de_trabajo():
    """Sin la rama en el despachador, el mensaje cae en «tipo desconocido» y la
    cola lo reintenta hasta la DLQ — con el clip ya cobrado."""
    fuente = (RAIZ / "worker" / "lambda_worker.py").read_text(encoding="utf-8")
    assert '"clip"' in fuente
