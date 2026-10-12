"""R4 · Ola 3 — Nano Banana Pro (crear), y de paso el formato de Nano Banana 2.

Parte A (este archivo, primera mitad): el resumen de esquemas de fal que pegó la TAREA «OLA 2 ·
RESUMEN ESQUEMAS» (12-oct-2026; tests/fixtures/esquemas_fal_ola3.json) trajo un hallazgo sobre un
modelo que YA está a la venta: Nano Banana 2 trae `output_format` por defecto en «png», tanto al
crear como al editar, y la caja guarda lo que baja como `.jpg` sin convertirlo
(pipeline/media_fal.py::imagen_fal descarga los bytes tal cual; server/app.py los llama .jpg y los
sirve como image/jpeg). Un PNG dentro de un .jpg lo pintan los navegadores, pero no lo aceptan las
redes al publicar. Por eso la fila de Nano Banana 2 pide jpeg explícito, como los de la Ola 2.

Lo que este archivo defiende:
  * que Nano Banana 2 pida jpeg en crear y en editar, y que el jpeg esté en el enum de su esquema;
  * que ningún modelo de imagen de la tabla (crear o editar) deje que fal decida un formato que no
    sea jpeg: o su esquema entrega jpeg por defecto (Grok) o la fila lo pide;
  * que lo que Nano Banana 2 manda siga cabiendo en el esquema de fal.

Sin red: fal, S3 y el monedero mockeados.

OJO: nada de importar pipeline/server a nivel de módulo (ver test_m25_clip)."""
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

RAIZ = Path(__file__).resolve().parent.parent

NB2 = {"imagen": "fal-ai/nano-banana-2", "editar": "fal-ai/nano-banana-2/edit"}
ASPECTOS = ("1:1", "16:9", "9:16")


def _esquemas() -> dict:
    """Los esquemas de las Olas 2 y 3 juntos: cada fila de imagen busca el suyo aquí."""
    todo = {}
    for nombre in ("esquemas_fal_ola2.json", "esquemas_fal_ola3.json"):
        datos = json.loads((RAIZ / "tests" / "fixtures" / nombre).read_text(encoding="utf-8"))
        todo.update({k: v for k, v in datos.items() if not k.startswith("_")})
    return todo


# ---------------------------------------------------------------------------
# A · el formato de Nano Banana 2

def test_el_esquema_guardado_dice_de_donde_sale():
    datos = json.loads((RAIZ / "tests" / "fixtures" / "esquemas_fal_ola3.json").read_text(encoding="utf-8"))
    assert "tools/leer_esquema_fal.py" in datos["_fuente"] and "2026-10-12" in datos["_fuente"]


@pytest.mark.parametrize("tarea", sorted(NB2))
def test_nano_banana_2_trae_png_por_defecto_y_admite_jpeg(tarea):
    """La razón del pin: sin pedirlo, fal entrega PNG."""
    fmt = _esquemas()[NB2[tarea]]["output_format"]
    assert fmt["por_defecto"] == "png" and "jpeg" in fmt["enum"]


@pytest.mark.parametrize("tarea", sorted(NB2))
def test_nano_banana_2_pide_jpeg_explicito_al_crear_y_al_editar(tarea):
    from pipeline import modelos_ia
    m = modelos_ia.resolver(tarea, "nb2")
    assert m.endpoint == NB2[tarea]
    assert m.args_extra_dict["output_format"] == "jpeg"
    assert m.args_extra_dict["resolution"] == "1K"          # y el pin de 1K de siempre sigue


def test_el_pin_de_formato_gana_sobre_lo_que_mande_la_tarea():
    from pipeline import modelos_ia
    m = modelos_ia.resolver("imagen", "nb2")
    mezcla = m.con_args_extra({"prompt": "x", "num_images": 1, "output_format": "png"})
    assert mezcla["output_format"] == "jpeg"


@pytest.mark.parametrize("aspecto", ASPECTOS)
@pytest.mark.parametrize("tarea", sorted(NB2))
def test_lo_que_manda_nano_banana_2_cabe_en_su_esquema(tarea, aspecto):
    from pipeline import modelos_ia
    esq = _esquemas()[NB2[tarea]]
    m = modelos_ia.resolver(tarea, "nb2")
    base = {"prompt": "un gato", "num_images": 1, "aspect_ratio": aspecto}
    if tarea == "editar":
        base["image_urls"] = ["https://fal.test/a.png"]
    args = m.con_args_extra(base)
    assert set(args) <= set(esq["propiedades"]), set(args) - set(esq["propiedades"])
    assert set(esq["obligatorias"]) <= set(args)
    for llave in ("aspect_ratio", "resolution", "output_format"):
        assert args[llave] in esq[llave]["enum"], (llave, args[llave])
    assert esq["num_images"]["min"] <= args["num_images"] <= esq["num_images"]["max"]


def _filas_de_imagen():
    from pipeline import modelos_ia
    for tarea in ("imagen", "editar"):
        for id_ in modelos_ia.disponibles(tarea):
            yield tarea, id_, modelos_ia.resolver(tarea, id_)


def test_ningun_modelo_de_imagen_deja_que_fal_decida_un_formato_que_no_sea_jpeg():
    """LA GUARDIA contra un PNG dentro de un .jpg: para cada endpoint de imagen de la tabla (crear y
    editar), o su esquema entrega jpeg por defecto, o no trae `output_format` (Seedream 4.5 y la
    prueba pagada mira qué llega), o la fila lo pide explícito. Un endpoint SIN esquema guardado
    falla: modelo nuevo de imagen = se guarda su esquema aquí."""
    esquemas = _esquemas()
    revisados = 0
    for tarea, id_, m in _filas_de_imagen():
        for endpoint in {m.endpoint, m.endpoint_con_imagen} - {""}:
            esq = esquemas.get(endpoint)
            assert esq is not None, f"{tarea}/{id_}: guarda el esquema de {endpoint} en las fixtures"
            fmt = esq.get("output_format")
            if fmt is None:
                continue
            if fmt["por_defecto"] != "jpeg":
                assert m.args_extra_dict.get("output_format") == "jpeg", (tarea, id_, endpoint)
            assert "jpeg" in fmt["enum"], (tarea, id_, endpoint)
            revisados += 1
    assert revisados >= 8          # que la guardia de verdad recorra la tabla, no un vacío


def test_grok_ya_entrega_jpeg_por_defecto_y_no_lleva_pin():
    from pipeline import modelos_ia
    esquemas = _esquemas()
    for tarea in ("imagen", "editar"):
        m = modelos_ia.resolver(tarea, "grok")
        assert esquemas[m.endpoint_para(tarea == "editar")]["output_format"]["por_defecto"] == "jpeg"
        assert not m.args_extra


# ---------------------------------------------------------------------------
# B · Nano Banana Pro: dos filas INERTES (una por calidad), solo crear

NBP = {"nbp-2k": "2K", "nbp-4k": "4K"}
NBP_CREAR = "fal-ai/nano-banana-pro"
NBP_EDITAR = "fal-ai/nano-banana-pro/edit"


def _tarifas() -> dict:
    return json.loads((RAIZ / "tools" / "tarifas.json").read_text(encoding="utf-8"))


def test_el_esquema_de_nano_banana_pro_trae_lo_que_las_filas_necesitan():
    esq = _esquemas()[NBP_CREAR]
    assert esq["obligatorias"] == ["prompt"]
    # los tres aspectos de la caja existen en su enum (sin traducirlos)
    assert set(ASPECTOS) <= set(esq["aspect_ratio"]["enum"])
    assert {"2K", "4K"} <= set(esq["resolution"]["enum"]) and esq["resolution"]["por_defecto"] == "1K"
    # sin pedirlo entrega png, y la búsqueda web viene apagada (en el editar cobra de más si se usa)
    assert esq["output_format"]["por_defecto"] == "png" and "jpeg" in esq["output_format"]["enum"]
    assert esq["enable_web_search"]["por_defecto"] is False
    assert "num_images" in esq["propiedades"]
    assert _esquemas()[NBP_EDITAR]["obligatorias"] == ["image_urls", "prompt"]


@pytest.mark.parametrize("id_", sorted(NBP))
def test_las_filas_de_nano_banana_pro_traen_su_endpoint_y_su_resolucion(id_):
    from pipeline import modelos_ia
    m = modelos_ia.resolver("imagen", id_)
    assert (m.id, m.tarea) == (id_, "imagen")
    assert m.endpoint == NBP_CREAR and m.endpoint_para(False) == m.endpoint_para(True) == NBP_CREAR
    assert m.admite_referencia is False                       # solo crear: editar es otra fila
    assert dict(m.args_extra) == {"enable_web_search": False, "output_format": "jpeg",
                                  "resolution": NBP[id_]}
    assert m.llave_tamano == "aspect_ratio" and m.tamanos == ()
    assert m.con_num_images is True and m.megapixeles_ficha == 0
    assert m.segundo_plano is True                            # sin medir se supone lento
    assert not m.duraciones and m.max_intentos == 0


@pytest.mark.parametrize("aspecto", ASPECTOS)
@pytest.mark.parametrize("id_", sorted(NBP))
def test_lo_que_manda_nano_banana_pro_cabe_en_su_esquema(id_, aspecto):
    from pipeline import modelos_ia
    esq = _esquemas()[NBP_CREAR]
    m = modelos_ia.resolver("imagen", id_)
    args = m.con_args_extra(m.args_de_imagen("un gato", aspecto))
    assert args["aspect_ratio"] == aspecto                    # tal cual: es un valor de su enum
    assert set(args) <= set(esq["propiedades"]), set(args) - set(esq["propiedades"])
    assert set(esq["obligatorias"]) <= set(args)
    for llave in ("aspect_ratio", "resolution", "output_format"):
        assert args[llave] in esq[llave]["enum"], (llave, args[llave])
    assert args["enable_web_search"] is False
    assert esq["num_images"]["min"] <= args["num_images"] <= esq["num_images"]["max"]


def test_nano_banana_pro_a_secas_no_existe_y_no_edita_todavia():
    """El id «nbp» es del catálogo de la web, que lo parte en `nbp-2k` y `nbp-4k` (llavePrecio): el
    servidor solo conoce las dos filas. Y ninguna entra al editor: sin fila en «editar»."""
    from pipeline import modelos_ia
    for tarea, id_ in [("imagen", "nbp"), ("imagen", "nbp-1k"), ("editar", "nbp"),
                       ("editar", "nbp-2k"), ("editar", "nbp-4k")]:
        with pytest.raises(modelos_ia.ModeloDesconocido):
            modelos_ia.resolver(tarea, id_)
    assert modelos_ia.disponibles("editar") == ["grok", "nb2"]


def test_la_ficha_de_nano_banana_pro_cobra_por_resolucion_y_el_2k_queda_sin_precio():
    """1K y 4K están en la ficha (el 4K es el cálculo de «el doble»: nota_ola3); el 2K no lo dice la página,
    y un precio que no se sabe es None, nunca el de la resolución de al lado."""
    from pipeline.pricing import costo_fal, unidades_fal
    assert costo_fal(NBP_CREAR, {"num_images": 1, "resolution": "1K"}) == 0.15
    assert costo_fal(NBP_CREAR, {"num_images": 1, "resolution": "4K"}) == 0.3
    assert costo_fal(NBP_CREAR, {"num_images": 2, "resolution": "4K"}) == 0.6
    assert costo_fal(NBP_CREAR, {"num_images": 1, "resolution": "2K"}) is None
    assert costo_fal(NBP_CREAR, {"num_images": 1}) is None                  # sin resolución: no se sabe
    assert costo_fal(NBP_CREAR, {"num_images": 1, "resolution": "4k"}) is None   # y no se adivina el caso
    assert unidades_fal(NBP_CREAR, {"num_images": 1}) == {"images": 1, "reference_images": 0}
    # el editar no tiene ficha: «sin costo conocido»
    assert costo_fal(NBP_EDITAR, {"num_images": 1, "resolution": "1K"}) is None
    # y los demás precios por imagen no cambiaron
    assert costo_fal("fal-ai/nano-banana-2", {"num_images": 1, "resolution": "1K"}) == 0.08
    assert costo_fal("blackforestlabs/flux-3/text-to-image", {"num_images": 1}) == 0.024


def test_una_ficha_por_resolucion_sin_esa_resolucion_no_inventa_nada(monkeypatch):
    from pipeline import pricing
    monkeypatch.setitem(pricing.ENDPOINTS_JSON, "fal-ai/prueba/pro",
                        {"unidad": "imagen", "usd_por_resolucion": {"1K": 0.1, "4K": 0.2},
                         "usd_referencia": 0.01})
    assert pricing.costo_fal("fal-ai/prueba/pro", {"num_images": 1, "resolution": "4K"}) == 0.2
    assert pricing.costo_fal("fal-ai/prueba/pro", {"num_images": 1, "resolution": "4K",
                                                   "image_urls": ["a", "b"]}) == 0.22
    assert pricing.costo_fal("fal-ai/prueba/pro", {"num_images": 1, "resolution": "2K"}) is None


def test_la_nota_de_la_ola_3_dice_dolares_y_aclara_que_el_4k_es_un_calculo():
    nota = _pricing_endpoints()["nota_ola3"]
    assert "centavos" not in nota.lower()
    assert "$0.15 dólares" in nota and "$0.30 dólares" in nota and "$0.015 dólares" in nota
    assert "cálculo" in nota and "sin costo conocido" in nota and "usd_por_resolucion" in nota
    ficha = _pricing_endpoints()[NBP_CREAR]
    assert ficha["usd_por_resolucion"] == {"1K": 0.15, "4K": 0.3} and "usd" not in ficha
    assert ficha["verified_on"] == "2026-10-08"            # leída en la página, sin medir en el panel
    assert NBP_EDITAR not in _pricing_endpoints()


def _pricing_endpoints() -> dict:
    p = json.loads((RAIZ / "tools" / "pricing.json").read_text(encoding="utf-8"))
    return p["generacion"]["endpoints"]


def test_inerte_sin_numero_en_tarifas_no_se_ofrece():
    """LA COMPUERTA: sin número en tarifas.json el servidor no lo conoce como vendible (KeyError → 422)."""
    from pipeline import creditos
    for id_ in NBP:
        with pytest.raises(KeyError):
            creditos.costo_modelo("imagen", id_)
        assert id_ not in _tarifas()["modelos"]["imagen"]
    assert not any(k.startswith("nbp") for tarea in ("imagen", "editar") for k in _tarifas()["modelos"][tarea])


def test_el_catalogo_de_la_web_parte_nbp_en_las_mismas_llaves_que_las_filas():
    """El navegador manda `<id>-<calidad>` (llavePrecio): tienen que ser EXACTAMENTE los ids de las filas,
    y mientras no tengan número el modelo sigue apagado."""
    import re
    ts = (RAIZ / "web" / "src" / "pantallas" / "inicio" / "modelos.ts").read_text(encoding="utf-8")
    calidades = re.search(r"HASTA_2K_Y_4K: Calidad\[\] = \[(.*?)\];", ts, re.S).group(1)
    ids = re.findall(r"id: '([^']+)'", calidades)
    assert {f"nbp-{c}" for c in ids} == set(NBP)
    bloque = re.search(r"id: 'nbp',(.*?)\},", ts, re.S).group(1)
    assert "activo: false" in bloque and "calidades: HASTA_2K_Y_4K" in bloque
