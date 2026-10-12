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
