"""R4 · selector de duración del clip — el servidor cobra, manda y devuelve por
la duración que se pidió, y no se deja engañar con ella.

Lo que este archivo defiende:
  * que el precio salga de tools/tarifas.json §modelos.clip, un número por
    duración (4 s = 18, 6 s = 28, 8 s = 36), con los 2 de componer fijos aparte,
    y que sin duración valga la de siempre (8 s = 36);
  * que una duración sin número, o que el modelo no admite, sea un error (422) y
    nunca un cero ni un cambio silencioso a otra: `true`, «8», 8.5, 8.0, -4, 0,
    5, 12 y `null` se rechazan ANTES de cobrar, de crear el doc y de encolar;
  * que el navegador no pueda mandar un precio: solo el id del modelo y los
    segundos, y el costo lo calcula el servidor;
  * que el doc del clip y el mensaje de la cola lleven los segundos, y que la
    llamada a fal mande «4s», «6s» u «8s» al endpoint correcto;
  * que el costo en dólares use la duración real y que un costo desconocido sea
    un error, no un cero;
  * que el fallo devuelva LO COBRADO por esa duración (no la tarifa de hoy);
  * que todos los créditos de tarifas.json §modelos sean pares y positivos: el
    dueño decidió (9-oct-2026) redondear siempre hacia arriba al par.

Sin red: fal/LLM/SQS/S3/Postgres mockeados.

OJO: nada de importar pipeline/server a nivel de módulo (ver test_m25_clip)."""
import asyncio
import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

RAIZ = Path(__file__).resolve().parent.parent

# Lo que el dueño decidió el 9-oct-2026 (tarifas.json §modelos.clip.veo-lite):
# costo ÷ 0.75 ÷ $0.015 dólares, hacia arriba y al par.
PRECIO_VEO_LITE = {4: 18, 6: 28, 8: 36}

# Todo lo que el navegador NO puede mandar como duración. Se pone en JSON tal
# cual, así que `True` viaja como `true` y `None` como `null`.
SEGUNDOS_INVALIDOS = [
    pytest.param(True, id="true"),
    pytest.param(False, id="false"),
    pytest.param("8", id="texto-8"),
    pytest.param("", id="texto-vacio"),
    pytest.param("ocho", id="texto-ocho"),
    pytest.param(8.5, id="decimal-8.5"),
    pytest.param(8.0, id="decimal-8.0"),
    pytest.param(-4, id="negativo"),
    pytest.param(0, id="cero"),
    pytest.param(5, id="fuera-de-las-duraciones-5"),
    pytest.param(12, id="fuera-de-las-duraciones-12"),
    pytest.param(10**30, id="enorme"),
    pytest.param(None, id="null-explicito"),
    pytest.param([8], id="lista"),
    pytest.param({"s": 8}, id="objeto"),
]


def _tarifas() -> dict:
    return json.loads((RAIZ / "tools" / "tarifas.json").read_text(encoding="utf-8"))


def _pricing() -> dict:
    return json.loads((RAIZ / "tools" / "pricing.json").read_text(encoding="utf-8"))


# ---------------------------------------------------------------------------
# la tabla de modelos: cada modelo declara sus duraciones

def test_veo_lite_admite_4_6_y_8_segundos():
    from pipeline import modelos_ia
    assert modelos_ia.resolver("clip", "veo-lite").duraciones == (4, 6, 8)


def test_la_duracion_predeterminada_es_8_y_el_modelo_la_admite():
    from pipeline import clip, modelos_ia
    assert modelos_ia.DURACION_PREDETERMINADA_S == 8
    assert clip.DURACION_S == modelos_ia.DURACION_PREDETERMINADA_S
    assert modelos_ia.DURACION_PREDETERMINADA_S in modelos_ia.resolver("clip", "veo-lite").duraciones


def test_imagen_y_editar_no_tienen_duracion_que_elegir():
    from pipeline import modelos_ia
    assert modelos_ia.resolver("imagen", "grok").duraciones == ()
    assert modelos_ia.resolver("editar", "grok").duraciones == ()


@pytest.mark.parametrize("segundos", [4, 6, 8])
def test_una_duracion_admitida_se_devuelve_tal_cual(segundos):
    from pipeline import modelos_ia
    assert modelos_ia.valida_duracion("clip", "veo-lite", segundos) == segundos
    # sin modelo es el predeterminado
    assert modelos_ia.valida_duracion("clip", None, segundos) == segundos


@pytest.mark.parametrize("segundos", SEGUNDOS_INVALIDOS)
def test_una_duracion_invalida_levanta_el_error_del_modulo(segundos):
    """El mismo tipo que el modelo desconocido, para que la API lo cubra con el
    mismo `except` y devuelva 422; el mensaje es claro y está en español."""
    from pipeline import modelos_ia
    with pytest.raises(modelos_ia.ModeloDesconocido) as e:
        modelos_ia.valida_duracion("clip", "veo-lite", segundos)
    assert isinstance(e.value, modelos_ia.DuracionNoAdmitida)
    assert "clip" in str(e.value).lower()


def test_el_mensaje_dice_cuales_si_admite():
    from pipeline import modelos_ia
    with pytest.raises(modelos_ia.DuracionNoAdmitida) as e:
        modelos_ia.valida_duracion("clip", "veo-lite", 5)
    msg = str(e.value)
    assert "veo-lite" in msg and "5 s" in msg
    assert "4, 6, 8" in msg


def test_un_modelo_desconocido_sigue_siendo_modelo_desconocido():
    """Con un id que no existe, el error es el de siempre y no el de duración."""
    from pipeline import modelos_ia
    with pytest.raises(modelos_ia.ModeloDesconocido) as e:
        modelos_ia.valida_duracion("clip", "kling", 8)
    assert not isinstance(e.value, modelos_ia.DuracionNoAdmitida)


def test_una_tarea_sin_duracion_rechaza_cualquier_segundo():
    from pipeline import modelos_ia
    with pytest.raises(modelos_ia.DuracionNoAdmitida):
        modelos_ia.valida_duracion("imagen", "grok", 8)


@pytest.fixture
def modelo_sin_4s(monkeypatch):
    """Un modelo de clip como LTX: no admite 4 s. Declara 6, 8 y 10, pero la
    tarifa solo trae 6 y 8: la de 10 s existe en el modelo y NO se ofrece."""
    from pipeline import creditos, modelos_ia
    original = modelos_ia._tabla

    def tabla():
        t = original()
        t[("clip", "ltx")] = modelos_ia.Modelo(
            "ltx", "clip", "fal-ai/prueba/ltx", "fal-ai/prueba/ltx/imagen",
            duraciones=(6, 8, 10))
        return t
    monkeypatch.setattr(modelos_ia, "_tabla", tabla)
    monkeypatch.setitem(creditos.MODELOS_CR["clip"], "ltx", {6: 48, 8: 64})


def test_un_modelo_que_no_admite_4s_la_rechaza(modelo_sin_4s):
    from pipeline import modelos_ia
    assert modelos_ia.valida_duracion("clip", "ltx", 6) == 6
    with pytest.raises(modelos_ia.DuracionNoAdmitida) as e:
        modelos_ia.valida_duracion("clip", "ltx", 4)
    assert "ltx" in str(e.value) and "4 s" in str(e.value) and "6, 8, 10" in str(e.value)


# ---------------------------------------------------------------------------
# el precio por duración

@pytest.mark.parametrize("segundos,esperado", sorted(PRECIO_VEO_LITE.items()))
def test_el_clip_cuesta_lo_de_su_duracion(segundos, esperado):
    from pipeline import creditos
    assert creditos.costo_modelo("clip", "veo-lite", segundos) == esperado
    assert creditos.costo_clip(0, "veo-lite", segundos) == esperado
    assert creditos.costo_clip(1, "veo-lite", segundos) == esperado


def test_los_precios_salen_de_tarifas_json():
    from pipeline import creditos
    tabla = _tarifas()["modelos"]["clip"]["veo-lite"]
    assert {int(k): v for k, v in tabla.items()} == PRECIO_VEO_LITE
    for k, v in tabla.items():
        assert creditos.costo_clip(0, "veo-lite", int(k)) == v


@pytest.mark.parametrize("segundos,base", sorted(PRECIO_VEO_LITE.items()))
@pytest.mark.parametrize("n_imagenes", [2, 3])
def test_componer_suma_2_con_dos_o_tres_imagenes_en_cualquier_duracion(
        segundos, base, n_imagenes):
    from pipeline import creditos
    assert creditos.costo_clip(n_imagenes, "veo-lite", segundos) == base + 2


@pytest.mark.parametrize("segundos", sorted(PRECIO_VEO_LITE))
def test_con_cero_o_una_imagen_no_se_paga_componer(segundos):
    from pipeline import creditos
    assert creditos.costo_clip(0, "veo-lite", segundos) == PRECIO_VEO_LITE[segundos]
    assert creditos.costo_clip(1, "veo-lite", segundos) == PRECIO_VEO_LITE[segundos]


def test_el_extra_de_componer_no_depende_de_la_duracion():
    from pipeline import creditos
    extras = {creditos.costo_clip(2, "veo-lite", s) - creditos.costo_clip(0, "veo-lite", s)
              for s in PRECIO_VEO_LITE}
    assert extras == {_tarifas()["clip"]["componer_imagenes"]}


def test_sin_duracion_vale_8_segundos_y_36_creditos():
    from pipeline import creditos
    assert creditos.costo_clip(0, "veo-lite") == 36
    assert creditos.costo_clip(0, "veo-lite", None) == 36
    assert creditos.costo_clip(0, None, 8) == 36
    assert creditos.costo_modelo("clip", "veo-lite") == 36
    assert creditos.costo_clip(2, "veo-lite") == 38


def test_la_ruta_heredada_sigue_cobrando_los_36_de_siempre():
    """/clip.html no manda modelo ni segundos: la tarifa plana de §clip, que
    tiene que valer lo mismo que 8 s en la tabla por duración."""
    from pipeline import creditos
    plana = _tarifas()["clip"]["video_8s"]
    assert creditos.costo_clip(0) == plana == 36
    assert creditos.costo_clip(3) == plana + _tarifas()["clip"]["componer_imagenes"]
    assert creditos.costo_clip(0, "veo-lite", 8) == plana


@pytest.mark.parametrize("segundos", [5, 12, 0, -4, True, False, "8", 8.0, 8.5])
def test_una_duracion_sin_numero_es_un_error_y_no_un_cero(segundos):
    from pipeline import creditos
    with pytest.raises(KeyError):
        creditos.costo_modelo("clip", "veo-lite", segundos)
    with pytest.raises(KeyError):
        creditos.costo_clip(0, "veo-lite", segundos)


def test_un_modelo_sin_tarifa_sigue_siendo_un_error():
    from pipeline import creditos
    with pytest.raises(KeyError):
        creditos.costo_modelo("clip", "kling", 8)
    with pytest.raises(KeyError):
        creditos.costo_clip(0, "kling")


def test_una_duracion_declarada_pero_sin_numero_no_cae_en_otra(monkeypatch):
    """Si tarifas.json no trae la de 4 s, pedir 4 s no cobra la de 6 ni la de 8."""
    from pipeline import creditos
    tabla = dict(creditos.MODELOS_CR["clip"]["veo-lite"])
    del tabla[4]
    monkeypatch.setitem(creditos.MODELOS_CR["clip"], "veo-lite", tabla)
    with pytest.raises(KeyError):
        creditos.costo_clip(0, "veo-lite", 4)
    assert creditos.costo_clip(0, "veo-lite", 6) == 28


def test_imagen_y_editar_siguen_cobrando_un_entero_por_modelo():
    from pipeline import creditos
    assert creditos.costo_modelo("imagen", "grok") == 2
    assert creditos.costo_modelo("editar", "grok") == 2
    # no tienen tabla por duración: pedirles una es un error, no se ignora
    with pytest.raises(KeyError):
        creditos.costo_modelo("imagen", "grok", 8)


def test_el_cargador_se_queda_solo_con_numeros_validos():
    """Un modelo (o una duración) sin número válido no se ofrece: ni un cero que
    regale el servicio, ni un negativo que abone saldo, ni una llave rota."""
    from pipeline import creditos
    crudo = {
        "nota": "texto",
        "imagen": {"grok": 2, "roto": 0, "negativo": -2, "decimal": 2.5, "bool": True},
        "clip": {"veo-lite": {"8": 36, "4": 18, "6": 0, "x": 20, "-4": 20,
                              "10": 20.5, "12": True, "٤": 18},
                 "vacio": {"4": 0}},
    }
    assert creditos._modelos_de(crudo) == {
        "imagen": {"grok": 2},
        "clip": {"veo-lite": {4: 18, 8: 36}},
    }


# ---------------------------------------------------------------------------
# guardianes de tarifas.json §modelos

def _numeros_de_modelos() -> list[tuple[str, str | None, object]]:
    """Cada número de §modelos con su ruta: ('clip/veo-lite/4', '4', 18)."""
    salida = []
    for tarea, tabla in _tarifas()["modelos"].items():
        if not isinstance(tabla, dict):
            continue                         # la «nota»
        for modelo, valor in tabla.items():
            if isinstance(valor, dict):
                salida += [(f"{tarea}/{modelo}/{seg}", seg, cr) for seg, cr in valor.items()]
            else:
                salida.append((f"{tarea}/{modelo}", None, valor))
    return salida


def test_guardian_todos_los_creditos_de_modelos_son_pares_y_positivos():
    """Decisión del dueño (9-oct-2026): los créditos van redondeados HACIA ARRIBA
    al par. Un impar es que alguien lo redondeó hacia abajo o lo tecleó a mano."""
    numeros = _numeros_de_modelos()
    # que el guardián no quede vacío: imagen, editar y las tres duraciones del clip
    assert len(numeros) >= 5
    for ruta, _, cr in numeros:
        assert isinstance(cr, int) and not isinstance(cr, bool), f"{ruta}: {cr!r} no es entero"
        assert cr > 0, f"{ruta}: {cr} no es positivo"
        assert cr % 2 == 0, f"{ruta}: {cr} es impar — los créditos van al par"


def test_guardian_las_llaves_por_duracion_son_segundos_enteros_positivos():
    for ruta, seg, _ in _numeros_de_modelos():
        if seg is not None:
            assert seg.isascii() and seg.isdecimal() and int(seg) > 0, f"{ruta}: llave {seg!r}"


def test_guardian_el_cargador_no_descarta_ningun_numero_de_tarifas_json():
    """Si el cargador se come un número (un impar no, pero sí un decimal o una
    llave mal escrita), ese modelo o esa duración deja de ofrecerse sin que nadie
    lo note: aquí se vuelve un fallo ruidoso."""
    from pipeline import creditos
    cargados = 0
    for tabla in creditos.MODELOS_CR.values():
        for valor in tabla.values():
            cargados += len(valor) if isinstance(valor, dict) else 1
    assert cargados == len(_numeros_de_modelos())


def test_guardian_las_duraciones_de_la_tarifa_son_las_que_declara_el_modelo():
    """La tabla de modelos y la tarifa tienen que andar juntas, en las dos
    direcciones: un modelo que declara una duración sin número no la ofrece
    (error 422), y un número para una duración que el modelo no admite es un
    dedazo."""
    from pipeline import creditos, modelos_ia
    for id_ in modelos_ia.disponibles("clip"):
        declaradas = set(modelos_ia.resolver("clip", id_).duraciones)
        con_numero = set(creditos.MODELOS_CR["clip"][id_])
        assert con_numero == declaradas, id_


def test_guardian_a_mas_segundos_mas_creditos():
    from pipeline import creditos
    precios = [creditos.costo_modelo("clip", "veo-lite", s) for s in (4, 6, 8)]
    assert precios == sorted(set(precios))


def test_guardian_la_tarifa_plana_de_8s_vale_lo_de_la_tabla():
    assert _tarifas()["clip"]["video_8s"] == _tarifas()["modelos"]["clip"]["veo-lite"]["8"]


@pytest.mark.parametrize("n_imagenes", [0, 1, 2, 3])
@pytest.mark.parametrize("segundos", sorted(PRECIO_VEO_LITE))
def test_guardian_cada_duracion_cubre_su_costo_en_dolares(segundos, n_imagenes):
    """Al piso de venta, lo que se cobra tiene que superar lo que cuesta."""
    from pipeline import clip, creditos
    piso = _tarifas()["economia"]["piso_venta_usd_por_credito"]
    venta = creditos.costo_clip(n_imagenes, "veo-lite", segundos) * piso
    assert clip.costo_usd(n_imagenes, "veo-lite", segundos) < venta


# ---------------------------------------------------------------------------
# el costo en dólares con la duración real

def test_costo_fal_lee_la_duracion_de_los_argumentos():
    from pipeline.config import settings
    from pipeline.pricing import costo_fal, unidades_fal
    veo = _pricing()["generacion"]["veo31_lite_usd_por_segundo"]["720p_con_audio"]
    for s in (4, 6, 8):
        args = {"duration": f"{s}s", "resolution": "720p", "generate_audio": True}
        for app in (settings.fal_veo_t2v, settings.fal_veo):
            assert costo_fal(app, args) == round(s * veo, 4)
        assert unidades_fal(settings.fal_veo_t2v, args) == {"video_seconds": s}


@pytest.mark.parametrize("n_imagenes", [0, 1, 2, 3])
@pytest.mark.parametrize("segundos", [4, 6, 8])
def test_el_costo_usd_va_con_la_duracion_real(segundos, n_imagenes):
    from pipeline import clip
    g = _pricing()["generacion"]
    esperado = segundos * g["veo31_lite_usd_por_segundo"]["720p_con_audio"]
    if n_imagenes >= 2:       # Grok junta las imágenes antes de animar
        esperado += (g["grok_edit"]["usd_por_imagen_salida"]
                     + g["grok_edit"]["usd_por_imagen_referencia"] * n_imagenes)
    assert clip.costo_usd(n_imagenes, "veo-lite", segundos) == round(esperado, 4)


def test_el_costo_usd_sin_duracion_es_el_de_8_segundos():
    from pipeline import clip
    assert clip.costo_usd(0) == clip.costo_usd(0, "veo-lite", 8)
    assert clip.costo_usd(0, "veo-lite", 4) < clip.costo_usd(0, "veo-lite", 6) < clip.costo_usd(0)


def test_el_costo_usd_rechaza_una_duracion_que_el_modelo_no_admite():
    from pipeline import clip, modelos_ia
    for s in (5, True, "8", None):
        with pytest.raises(modelos_ia.DuracionNoAdmitida):
            clip.costo_usd(0, "veo-lite", s)


def test_un_costo_desconocido_es_un_error_y_no_un_cero(monkeypatch, modelo_sin_4s):
    from pipeline import clip, pricing
    # el modelo existe pero su endpoint no está en pricing.json
    with pytest.raises(clip.ClipError):
        clip.costo_usd(0, "ltx", 6)
    # una ficha con tarifa en cero tampoco puede parecer gratis
    monkeypatch.setitem(pricing.ENDPOINTS_JSON, "fal-ai/prueba/ltx",
                        {"unidad": "segundo", "usd_por_segundo": {"720p_con_audio": 0}})
    with pytest.raises(clip.ClipError):
        clip.costo_usd(0, "ltx", 6)


def test_el_costo_usd_usa_el_endpoint_que_de_verdad_se_llama(monkeypatch, modelo_sin_4s):
    """Con imagen se llama al de imagen-a-video: si solo el de texto tiene costo
    conocido, un clip con imagen es «sin costo», no el del vecino."""
    from pipeline import clip, pricing
    monkeypatch.setitem(pricing.ENDPOINTS_JSON, "fal-ai/prueba/ltx",
                        {"unidad": "segundo", "usd_por_segundo": {"720p_con_audio": 0.1}})
    assert clip.costo_usd(0, "ltx", 6) == 0.6
    with pytest.raises(clip.ClipError):
        clip.costo_usd(1, "ltx", 6)
    monkeypatch.setitem(pricing.ENDPOINTS_JSON, "fal-ai/prueba/ltx/imagen",
                        {"unidad": "segundo", "usd_por_segundo": {"720p_con_audio": 0.1}})
    assert clip.costo_usd(1, "ltx", 6) == 0.6


# ---------------------------------------------------------------------------
# la llamada a fal manda la duración pedida

class _Fal:
    """Registra cada llamada a fal en vez de hacerla."""

    def __init__(self):
        self.llamadas = []

    async def llamar(self, app, argumentos, timeout_s, nombre, meta=None):
        self.llamadas.append({"app": app, "args": argumentos})
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


@pytest.mark.parametrize("con_imagen", [False, True])
@pytest.mark.parametrize("segundos", [4, 6, 8])
def test_animar_manda_la_duracion_al_endpoint_correcto(falso_fal, segundos, con_imagen):
    from pipeline import clip
    from pipeline.config import settings
    url = asyncio.run(clip.animar("a dog", "https://fal.test/foto.jpg" if con_imagen else None,
                                  "horizontal", "veo-lite", segundos))
    assert url == "https://fal.test/clip.mp4"
    (llamada,) = falso_fal.llamadas
    assert llamada["app"] == (settings.fal_veo if con_imagen else settings.fal_veo_t2v)
    assert llamada["args"]["duration"] == f"{segundos}s"
    # lo demás del producto no cambia con la duración: 720p y con audio
    assert llamada["args"]["resolution"] == "720p"
    assert llamada["args"]["generate_audio"] is True


def test_animar_sin_duracion_manda_8s(falso_fal):
    from pipeline import clip
    asyncio.run(clip.animar("a dog"))
    assert falso_fal.llamadas[0]["args"]["duration"] == "8s"


@pytest.mark.parametrize("segundos", [5, True, "8", 8.0, None, 0])
def test_animar_no_llama_a_fal_con_una_duracion_que_el_modelo_no_admite(falso_fal, segundos):
    from pipeline import clip, modelos_ia
    with pytest.raises(modelos_ia.DuracionNoAdmitida):
        asyncio.run(clip.animar("a dog", None, "horizontal", "veo-lite", segundos))
    assert falso_fal.llamadas == []


@pytest.mark.parametrize("segundos", [4, 6, 8])
def test_generar_devuelve_los_segundos_reales(falso_fal, falso_llm, segundos):
    from pipeline import clip
    r = asyncio.run(clip.generar("mi perro", [], "horizontal", "veo-lite", segundos))
    assert r["segundos"] == segundos
    assert falso_fal.llamadas[-1]["args"]["duration"] == f"{segundos}s"


def test_generar_sin_duracion_son_8_segundos(falso_fal, falso_llm):
    from pipeline import clip
    r = asyncio.run(clip.generar("mi perro"))
    assert r["segundos"] == 8
    assert falso_fal.llamadas[-1]["args"]["duration"] == "8s"


def test_la_composicion_no_lleva_duracion_pero_el_video_si(falso_fal, falso_llm):
    """Grok junta las imágenes (una imagen, sin tiempo) y Veo anima con la
    duración pedida: la duración solo va en la última llamada."""
    from pipeline import clip
    from pipeline.config import settings
    r = asyncio.run(clip.generar("mi perro y mi gato", ["a.jpg", "b.jpg"],
                                 "horizontal", "veo-lite", 4))
    assert [c["app"] for c in falso_fal.llamadas] == [settings.fal_imagen_edit, settings.fal_veo]
    assert "duration" not in falso_fal.llamadas[0]["args"]
    assert falso_fal.llamadas[1]["args"]["duration"] == "4s"
    assert r["segundos"] == 4 and r["origen_inicial"] == "compuesta"


@pytest.mark.parametrize("segundos", [5, True, "8", None])
def test_generar_valida_la_duracion_antes_de_gastar(monkeypatch, falso_fal, segundos):
    """El LLM y Grok cuestan: una duración inválida no llega ni al prompt."""
    from pipeline import clip, modelos_ia

    async def no_debe_llamarse(*a, **k):
        pytest.fail("se gastó antes de validar la duración")
    monkeypatch.setattr("pipeline.clip.chat_json", no_debe_llamarse)
    with pytest.raises(modelos_ia.DuracionNoAdmitida):
        asyncio.run(clip.generar("mi perro y mi gato", ["a.jpg", "b.jpg"],
                                 "horizontal", "veo-lite", segundos))
    assert falso_fal.llamadas == []


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


@pytest.fixture
def espia(monkeypatch):
    """El monedero y la cola en memoria: lo que el API cobraría, encolaría y
    devolvería contra Postgres y SQS."""
    from pipeline import creditos, jobs
    e = SimpleNamespace(cobros=[], encolados=[], devueltos=[])
    monkeypatch.setattr(creditos, "activo", lambda: True)
    monkeypatch.setattr(creditos, "cobrar", lambda n, ref, u=None: e.cobros.append((n, ref)))
    monkeypatch.setattr(creditos, "devolver", lambda n, ref, u=None: e.devueltos.append((n, ref)))
    monkeypatch.setattr(jobs, "encolar_clip", lambda *a: e.encolados.append(a))
    return e


def _imagenes(n: int) -> list[str]:
    from pipeline import db
    user = db.usuario_actual()
    return [f"usuarios/{user}/clips/subidas/{i}.jpg" for i in range(n)]


def _doc(s3: dict) -> dict:
    (texto,) = s3.values()
    return json.loads(texto)


@pytest.mark.parametrize("segundos,esperado", sorted(PRECIO_VEO_LITE.items()))
def test_el_clip_cobra_el_precio_de_su_duracion(cliente, s3, espia, segundos, esperado):
    r = cliente.post("/api/clip/generar",
                     json={"texto": "mi perro", "modelo": "veo-lite", "segundos": segundos})
    assert r.status_code == 200, r.text
    assert r.json()["creditos"] == esperado
    assert espia.cobros == [(esperado, f"clip:{r.json()['id']}")]


@pytest.mark.parametrize("n_imagenes", [2, 3])
@pytest.mark.parametrize("segundos,base", sorted(PRECIO_VEO_LITE.items()))
def test_componer_se_suma_al_precio_de_la_duracion(cliente, s3, espia, segundos, base, n_imagenes):
    r = cliente.post("/api/clip/generar",
                     json={"texto": "mi perro y mi gato", "segundos": segundos,
                           "imagenes": _imagenes(n_imagenes)})
    assert r.status_code == 200, r.text
    assert espia.cobros[0][0] == base + 2
    assert _doc(s3)["creditos"] == base + 2


def test_con_una_imagen_no_se_suma_componer(cliente, s3, espia):
    r = cliente.post("/api/clip/generar",
                     json={"texto": "mi perro", "segundos": 6, "imagenes": _imagenes(1)})
    assert r.status_code == 200
    assert espia.cobros[0][0] == 28


def test_sin_segundos_vale_8_y_cobra_36(cliente, s3, espia):
    """Lo que hace la ruta heredada /clip.html: ni modelo ni segundos."""
    r = cliente.post("/api/clip/generar", json={"texto": "mi perro"})
    assert r.status_code == 200
    assert r.json()["creditos"] == 36 and espia.cobros[0][0] == 36
    doc = _doc(s3)
    assert doc["segundos"] == 8 and doc["creditos"] == 36 and doc["modelo"] == "veo-lite"
    assert espia.encolados[0][2] == 8


@pytest.mark.parametrize("segundos", [4, 6, 8])
def test_el_doc_y_el_mensaje_de_la_cola_llevan_los_segundos(cliente, s3, espia, segundos):
    from pipeline import db
    r = cliente.post("/api/clip/generar", json={"texto": "mi perro", "segundos": segundos})
    assert r.status_code == 200
    doc = _doc(s3)
    assert doc["segundos"] == segundos
    assert doc["creditos"] == PRECIO_VEO_LITE[segundos]
    assert espia.encolados == [(db.usuario_actual(), r.json()["id"], segundos)]


def test_el_mensaje_de_sqs_lleva_los_segundos(monkeypatch):
    from pipeline import jobs
    enviados = []
    cola = SimpleNamespace(send_message=lambda **k: enviados.append(k))
    monkeypatch.setattr(jobs, "_sqs", lambda: cola)
    monkeypatch.setenv("JOBS_QUEUE_URL", "https://sqs.test/cola")
    jobs.encolar_clip("u1", "clip-20261009-120000-abcdef", 4)
    (envio,) = enviados
    assert json.loads(envio["MessageBody"]) == {
        "tipo": "clip", "user_id": "u1", "clip_id": "clip-20261009-120000-abcdef",
        "segundos": 4}


@pytest.mark.parametrize("segundos", SEGUNDOS_INVALIDOS)
def test_una_duracion_invalida_se_rechaza_antes_de_cobrar(cliente, s3, espia, segundos):
    r = cliente.post("/api/clip/generar",
                     json={"texto": "mi perro", "modelo": "veo-lite", "segundos": segundos})
    assert r.status_code == 422, r.text
    # mensaje en español, claro, como texto (no la lista de errores de pydantic)
    detalle = r.json()["detail"]
    assert isinstance(detalle, str) and "clip" in detalle
    # y nada ocurrió: ni cobro, ni doc, ni cola
    assert espia.cobros == [] and espia.encolados == [] and espia.devueltos == []
    assert s3 == {}


def test_una_duracion_invalida_tampoco_gasta_con_imagenes(cliente, s3, espia):
    r = cliente.post("/api/clip/generar",
                     json={"texto": "mi perro", "segundos": 5, "imagenes": _imagenes(3)})
    assert r.status_code == 422
    assert espia.cobros == [] and s3 == {}


def test_una_duracion_invalida_no_se_arregla_sola_a_la_de_siempre(cliente, s3, espia):
    """5 s no se vuelven 4, 6 ni 8: el pedido se rechaza."""
    for s in (5, 7, 9, 3, 1):
        assert cliente.post("/api/clip/generar",
                            json={"texto": "x", "segundos": s}).status_code == 422
    assert espia.cobros == [] and s3 == {}


def test_el_navegador_no_puede_mandar_el_precio(cliente, s3, espia):
    """Solo el id del modelo y los segundos: lo demás se ignora y el costo sale
    del servidor."""
    r = cliente.post("/api/clip/generar", json={
        "texto": "mi perro", "modelo": "veo-lite", "segundos": 8,
        "creditos": 1, "costo": 0, "precio": 0})
    assert r.status_code == 200
    assert espia.cobros[0][0] == 36
    assert _doc(s3)["creditos"] == 36


def test_un_modelo_desconocido_sigue_rechazandose_con_cualquier_duracion(cliente, s3, espia):
    for s in (4, 8, 5):
        r = cliente.post("/api/clip/generar",
                         json={"texto": "x", "modelo": "kling", "segundos": s})
        assert r.status_code == 422
    assert espia.cobros == [] and s3 == {}


def test_un_modelo_sin_tarifa_no_se_ofrece(cliente, s3, espia, monkeypatch):
    from pipeline import creditos
    monkeypatch.delitem(creditos.MODELOS_CR["clip"], "veo-lite")
    r = cliente.post("/api/clip/generar", json={"texto": "x", "segundos": 8})
    assert r.status_code == 422
    assert espia.cobros == [] and s3 == {}


def test_una_duracion_sin_tarifa_no_se_ofrece_aunque_el_modelo_la_admita(
        cliente, s3, espia, monkeypatch):
    from pipeline import creditos
    tabla = dict(creditos.MODELOS_CR["clip"]["veo-lite"])
    del tabla[4]
    monkeypatch.setitem(creditos.MODELOS_CR["clip"], "veo-lite", tabla)
    r = cliente.post("/api/clip/generar", json={"texto": "x", "segundos": 4})
    assert r.status_code == 422
    assert espia.cobros == [] and espia.encolados == [] and s3 == {}
    # las que sí tienen número siguen funcionando
    assert cliente.post("/api/clip/generar",
                        json={"texto": "x", "segundos": 6}).status_code == 200
    assert espia.cobros[0][0] == 28


def test_un_modelo_que_no_admite_la_duracion_se_rechaza(cliente, s3, espia, modelo_sin_4s):
    # ltx no admite 4 s
    r = cliente.post("/api/clip/generar",
                     json={"texto": "x", "modelo": "ltx", "segundos": 4})
    assert r.status_code == 422 and "ltx" in r.json()["detail"]
    # admite 10 s, pero tarifas.json no le puso número: tampoco se ofrece
    r = cliente.post("/api/clip/generar",
                     json={"texto": "x", "modelo": "ltx", "segundos": 10})
    assert r.status_code == 422
    assert espia.cobros == [] and espia.encolados == [] and s3 == {}
    # las que admite y tienen número, sí, con SU precio (y no el de Veo)
    r = cliente.post("/api/clip/generar",
                     json={"texto": "x", "modelo": "ltx", "segundos": 6})
    assert r.status_code == 200 and espia.cobros[-1][0] == 48
    r = cliente.post("/api/clip/generar",
                     json={"texto": "x", "modelo": "ltx", "segundos": 8,
                           "imagenes": _imagenes(2)})
    assert r.status_code == 200 and espia.cobros[-1][0] == 66
    assert [d["modelo"] for d in map(json.loads, s3.values())] == ["ltx", "ltx"]


def test_sin_saldo_con_otra_duracion_no_crea_doc_ni_encola(cliente, s3, espia, monkeypatch):
    from pipeline import creditos
    pedidos = []

    def sin_saldo(n, ref, u=None):
        pedidos.append(n)
        raise creditos.SinSaldo(n, 4)
    monkeypatch.setattr(creditos, "cobrar", sin_saldo)
    r = cliente.post("/api/clip/generar", json={"texto": "x", "segundos": 4})
    assert r.status_code == 402
    assert pedidos == [18] and "18 créditos" in r.json()["detail"]
    assert espia.encolados == [] and s3 == {}


def test_cobrado_y_sin_encolar_devuelve_lo_de_esa_duracion(cliente, s3, espia, monkeypatch):
    from pipeline import jobs
    monkeypatch.setattr(jobs, "encolar_clip",
                        lambda *a: (_ for _ in ()).throw(RuntimeError("SQS caído")))
    r = cliente.post("/api/clip/generar", json={"texto": "x", "segundos": 4})
    assert r.status_code == 502
    assert [n for n, _ in espia.devueltos] == [18] == [n for n, _ in espia.cobros]
    doc = _doc(s3)
    assert doc["estado"] == "error" and doc["segundos"] == 4


def test_la_ficha_enseña_los_segundos_del_clip(cliente, s3, espia):
    cliente.post("/api/clip/generar", json={"texto": "x", "segundos": 6})
    (ficha,) = cliente.get("/api/clip").json()["clips"]
    assert ficha["segundos"] == 6 and ficha["creditos"] == 28


def test_la_config_sigue_enseñando_lo_de_siempre(cliente, s3):
    d = cliente.get("/api/clip/config").json()
    assert d["creditos"] == 36 and d["creditos_con_composicion"] == 38 and d["segundos"] == 8


# ---------------------------------------------------------------------------
# el worker: la duración del doc llega a Veo, y el reembolso es lo cobrado

@pytest.fixture
def worker(monkeypatch, s3):
    from pipeline import costes_infra, creditos, db
    import worker.clip_generar as w
    # generar() asigna os.environ["DEFAULT_USER_ID"] directo: registrarla aquí
    # hace que monkeypatch la restaure (ver test_m25_clip)
    monkeypatch.setenv("DEFAULT_USER_ID", "u1")
    devueltos = []
    monkeypatch.setattr(creditos, "activo", lambda: True)
    monkeypatch.setattr(creditos, "devolver",
                        lambda n, ref, u=None: devueltos.append((n, ref, u)))
    monkeypatch.setattr(db, "backend", lambda: "off")
    monkeypatch.setattr(costes_infra, "registrar", lambda *a, **k: None)
    return w, devueltos


def _clip_id(sufijo: str) -> str:
    return f"clip-20261009-120000-{sufijo}"


def _poner_doc(s3: dict, clip_id: str, **campos) -> str:
    key = f"usuarios/u1/clips/{clip_id}.json"
    s3[key] = json.dumps({"estado": "generando", "texto": "mi perro", "imagenes": [],
                          **campos})
    return key


@pytest.mark.parametrize("segundos", [4, 6, 8])
def test_el_worker_le_pide_a_veo_la_duracion_del_doc(worker, falso_fal, falso_llm, monkeypatch,
                                                     tmp_path, segundos):
    w, _ = worker
    from pipeline import fal

    async def descargar(url, destino):
        Path(destino).write_bytes(b"video")
    monkeypatch.setattr(fal, "descargar", descargar)
    res = asyncio.run(w._correr({"texto": "mi perro", "imagenes": [], "formato": "vertical",
                                 "modelo": "veo-lite", "segundos": segundos}, tmp_path))
    assert falso_fal.llamadas[-1]["args"]["duration"] == f"{segundos}s"
    assert res["segundos"] == segundos


def test_un_doc_sin_segundos_falla_y_devuelve_no_se_inventan_8(worker, s3, falso_fal, falso_llm):
    """El API siempre escribe `segundos` (también lo hacía cuando solo había 8 s).
    Un doc sin ese campo no lo escribió el API: pedir 8 s a Veo por un cobro de 18
    o 28 sería entregar de más. Queda en error y los créditos vuelven."""
    w, devueltos = worker
    clip_id = _clip_id("bbbbbb")
    key = _poner_doc(s3, clip_id, creditos=18)
    w.generar("u1", clip_id)
    assert falso_fal.llamadas == []
    assert devueltos == [(18, f"clip:{clip_id}", "u1")]
    assert json.loads(s3[key])["estado"] == "error"


def test_un_doc_con_duracion_corrupta_falla_y_devuelve(worker, s3, falso_fal, falso_llm):
    """Si el doc trae algo que el API nunca escribiría, no se llama a Veo: el
    clip queda en error y los créditos vuelven."""
    w, devueltos = worker
    clip_id = _clip_id("aaaaaa")
    key = _poner_doc(s3, clip_id, creditos=36, segundos="8")
    w.generar("u1", clip_id)
    assert falso_fal.llamadas == []
    assert devueltos == [(36, f"clip:{clip_id}", "u1")]
    assert json.loads(s3[key])["estado"] == "error"


@pytest.mark.parametrize("segundos,n_imagenes,cobrado", [
    (4, 0, 18), (6, 0, 28), (8, 0, 36),
    (4, 2, 20), (6, 3, 30), (8, 2, 38),
])
def test_si_el_clip_falla_se_devuelve_lo_cobrado_por_esa_duracion(
        cliente, s3, espia, worker, monkeypatch, segundos, n_imagenes, cobrado):
    """El camino completo: el API cobra con la tarifa de la duración y escribe el
    doc, el worker falla y devuelve exactamente eso, con la misma referencia."""
    from pipeline import db
    w, devueltos = worker
    user = db.usuario_actual()
    # el API corre contra el servicio (Postgres); el worker de este archivo no
    monkeypatch.setattr(db, "backend", lambda: "postgres")
    r = cliente.post("/api/clip/generar",
                     json={"texto": "mi perro y mi gato", "segundos": segundos,
                           "imagenes": _imagenes(n_imagenes)})
    assert r.status_code == 200, r.text
    clip_id = r.json()["id"]
    assert espia.cobros == [(cobrado, f"clip:{clip_id}")]
    monkeypatch.setattr(db, "backend", lambda: "off")

    async def falla(doc, tmp):
        from pipeline import clip
        raise clip.ClipError("Veo no respondió")
    monkeypatch.setattr(w, "_correr", falla)

    w.generar(user, clip_id)

    assert devueltos == [(cobrado, f"clip:{clip_id}", user)]
    doc = json.loads(s3[f"usuarios/{user}/clips/{clip_id}.json"])
    assert doc["estado"] == "error" and doc["creditos"] == cobrado and doc["segundos"] == segundos


def test_el_reembolso_es_lo_cobrado_y_no_la_tarifa_de_hoy(worker, s3, monkeypatch):
    """Entre el cobro y el fallo puede desplegarse una tarifa nueva (la API y el
    worker se despliegan por separado): la devolución sale del doc."""
    from pipeline import creditos
    w, devueltos = worker
    clip_id = _clip_id("bbbbbb")
    _poner_doc(s3, clip_id, creditos=18, segundos=4)
    monkeypatch.setitem(creditos.MODELOS_CR["clip"], "veo-lite", {4: 50, 6: 60, 8: 70})

    async def falla(doc, tmp):
        raise RuntimeError("boom")
    monkeypatch.setattr(w, "_correr", falla)
    w.generar("u1", clip_id)
    assert devueltos == [(18, f"clip:{clip_id}", "u1")]


def test_un_clip_bueno_de_4s_queda_listo_con_sus_segundos_y_su_costo_real(
        worker, s3, monkeypatch):
    w, devueltos = worker
    from pipeline import clip, db, media_sync
    gastos = []
    monkeypatch.setattr(db, "backend", lambda: "postgres")
    monkeypatch.setattr(db, "ejecutar", lambda sql, params=None: gastos.append(params))
    monkeypatch.setattr(media_sync, "subir_archivo", lambda local, key: None)
    clip_id = _clip_id("cccccc")
    key = _poner_doc(s3, clip_id, creditos=18, segundos=4, modelo="veo-lite")

    async def bien(doc, tmp):
        destino = tmp / "clip.mp4"
        destino.write_bytes(b"video")
        return {"video_url": "https://fal.test/clip.mp4", "imagen_inicial": None,
                "origen_inicial": "sin_imagen", "prompt": "a dog", "recorte": "",
                "prompt_composicion": "", "segundos": 4, "bytes": 5, "_local": destino}
    monkeypatch.setattr(w, "_correr", bien)

    w.generar("u1", clip_id)

    assert devueltos == []
    assert json.loads(s3[key])["estado"] == "listo" and json.loads(s3[key])["segundos"] == 4
    # el gasto anotado es el de 4 s (0.20 dólares), no el de 8 (0.40)
    assert [g["usd"] for g in gastos] == [clip.costo_usd(0, "veo-lite", 4)] == [0.2]


def test_un_costo_que_no_se_puede_anotar_no_tumba_el_clip_entregado(worker, s3, monkeypatch):
    """Sin costo conocido el gasto no se anota, pero el video ya está entregado:
    ni se marca error ni se devuelven créditos por un clip que el usuario recibió."""
    w, devueltos = worker
    from pipeline import clip, db, media_sync
    monkeypatch.setattr(db, "backend", lambda: "postgres")
    monkeypatch.setattr(db, "ejecutar", lambda *a, **k: pytest.fail("anotó un costo inventado"))
    monkeypatch.setattr(media_sync, "subir_archivo", lambda local, key: None)
    monkeypatch.setattr(clip, "costo_usd",
                        lambda *a, **k: (_ for _ in ()).throw(clip.ClipError("Sin costo conocido")))
    clip_id = _clip_id("dddddd")
    key = _poner_doc(s3, clip_id, creditos=28, segundos=6)

    async def bien(doc, tmp):
        destino = tmp / "clip.mp4"
        destino.write_bytes(b"video")
        return {"video_url": "https://fal.test/clip.mp4", "imagen_inicial": None,
                "origen_inicial": "sin_imagen", "prompt": "a dog", "recorte": "",
                "prompt_composicion": "", "segundos": 6, "bytes": 5, "_local": destino}
    monkeypatch.setattr(w, "_correr", bien)

    w.generar("u1", clip_id)

    assert devueltos == []
    assert json.loads(s3[key])["estado"] == "listo"
