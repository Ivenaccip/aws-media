"""Ajustes 3 — el archivo «De la casa» (server/biblioteca_casa.json), que edita el dueño.

Una prueba valida el archivo entero para que un descuido al editarlo se vea en CI y no
en la pantalla: ids únicos y estables, categorías válidas, largos, `lleva_a` coherente
con la categoría y hasta 3 etiquetas. Sin red ni base."""
import copy
import json
import re
from pathlib import Path

import pytest

from server import biblioteca_api as api

RUTA = Path(__file__).resolve().parent.parent / "server" / "biblioteca_casa.json"


@pytest.fixture(scope="module")
def doc():
    return json.loads(RUTA.read_text(encoding="utf-8"))


@pytest.fixture
def prompts(doc):
    return doc["prompts"]


def test_el_archivo_es_valido_de_principio_a_fin(doc):
    validos, problemas = api.validar_casa(doc)
    assert problemas == []
    assert len(validos) == len(doc["prompts"])


def test_trae_los_14_de_muestra_repartidos_en_las_cuatro_categorias(prompts):
    assert len(prompts) == 14
    por_categoria = {c: sum(p["categoria"] == c for p in prompts) for c in api.CLAVES_CATEGORIA}
    assert por_categoria == {"imagen": 4, "video": 3, "guion": 4, "investigacion": 3}


def test_ids_unicos_y_con_forma_estable(prompts):
    ids = [p["id"] for p in prompts]
    assert len(set(ids)) == len(ids)
    for i in ids:
        assert re.fullmatch(r"casa-[a-z0-9]+(-[a-z0-9]+)*", i), i      # un slug legible: sin fechas ni azar
    otra_lectura = [p["id"] for p in json.loads(RUTA.read_text(encoding="utf-8"))["prompts"]]
    assert otra_lectura == ids


def test_titulo_para_que_y_prompt_con_largos_razonables(prompts):
    for p in prompts:
        assert 1 <= len(p["titulo"]) <= api.MAX_TITULO, p["id"]
        assert 1 <= len(p["para_que"]) <= api.MAX_PARA_QUE, p["id"]
        assert 30 <= len(p["prompt"]) <= api.MAX_PROMPT, p["id"]


def test_categorias_validas(prompts):
    assert all(p["categoria"] in {"imagen", "video", "guion", "investigacion"} for p in prompts)


def test_lleva_a_coherente_imagen_y_video_llevan_guion_e_investigacion_no(prompts):
    for p in prompts:
        esperado = {"imagen": "imagen", "video": "video"}.get(p["categoria"])
        assert p["lleva_a"] == esperado, p["id"]


def test_los_que_se_llevan_a_la_caja_caben_en_la_direccion(prompts):
    """«Llevar a la caja» solo acepta prompts de hasta 1800 caracteres (contrato web)."""
    for p in prompts:
        if p["lleva_a"]:
            assert len(p["prompt"]) <= 1800, p["id"]


def test_los_de_imagen_y_video_traen_sus_corchetes_para_que_la_persona_los_cambie(prompts):
    for p in prompts:
        if p["lleva_a"]:
            assert re.search(r"\[[^\]]+\]", p["prompt"]), f"{p['id']} no trae ningún [corchete]"


def test_hasta_tres_etiquetas_cortas_y_sin_repetir(prompts):
    for p in prompts:
        assert len(p["etiquetas"]) <= 3, p["id"]
        assert all(1 <= len(e) <= api.MAX_ETIQUETA for e in p["etiquetas"]), p["id"]
        assert len({e.lower() for e in p["etiquetas"]}) == len(p["etiquetas"]), p["id"]


def test_el_texto_esta_en_espanol_sin_dinero_ni_modelos(prompts):
    todo = json.dumps(prompts, ensure_ascii=False).lower()
    assert "centavos" not in todo and "gpt" not in todo and "$" not in todo


def test_los_ids_de_la_casa_no_chocan_con_los_de_los_mios():
    # «mio-<12 hex>» y «casa-…» jamás se confunden: el API decide por el prefijo
    assert not re.fullmatch(r"mio-[0-9a-f]{12}", "casa-algo")


# ---------------------------------------------------------------------------
# el validador tiene dientes: cada descuido posible se caza

def _doc_con(doc, **cambios):
    d = copy.deepcopy(doc)
    d["prompts"][0].update(cambios)
    return d


@pytest.mark.parametrize("cambios,pista", [
    ({"id": "sin-prefijo"}, "id"),
    ({"id": "casa-Con_Mayusculas"}, "id"),
    ({"id": "casa-retrato-estudio-luz-suave"[:-3] + "  "}, "id"),
    ({"titulo": ""}, "título"),
    ({"titulo": "x" * 81}, "título"),
    ({"para_que": "x" * 161}, "para_que"),
    ({"prompt": ""}, "prompt"),
    ({"prompt": "x" * 12001}, "prompt"),
    ({"categoria": "musica"}, "categoría"),
    ({"etiquetas": ["a", "b", "c", "d"]}, "etiquetas"),
    ({"etiquetas": ["x" * 25]}, "etiquetas"),
    ({"etiquetas": "retrato"}, "etiquetas"),
    ({"lleva_a": None}, "lleva_a"),                       # imagen sin destino
    ({"lleva_a": "video"}, "lleva_a"),                    # imagen que se lleva a video
    ({"categoria": "guion"}, "lleva_a"),                  # guion que dice llevarse a imagen
])
def test_el_validador_caza_cada_descuido(doc, cambios, pista):
    validos, problemas = api.validar_casa(_doc_con(doc, **cambios))
    assert len(validos) == len(doc["prompts"]) - 1
    assert len(problemas) == 1 and pista in problemas[0]


def test_el_validador_caza_ids_repetidos(doc):
    d = copy.deepcopy(doc)
    d["prompts"][1]["id"] = d["prompts"][0]["id"]
    validos, problemas = api.validar_casa(d)
    assert len(validos) == len(doc["prompts"]) - 1 and "repetido" in problemas[0]


@pytest.mark.parametrize("roto", [None, [], {}, {"prompts": "no es lista"}, {"prompts": [1, "x"]}])
def test_un_archivo_que_no_es_el_esperado_no_revienta(roto):
    validos, problemas = api.validar_casa(roto)
    assert validos == [] and problemas


# ---------------------------------------------------------------------------
# el API con un archivo descompuesto: se queda con lo válido y lo avisa en el log

def test_el_api_se_queda_con_lo_valido_y_avisa(monkeypatch, tmp_path, caplog, doc):
    roto = _doc_con(doc, categoria="musica")
    ruta = tmp_path / "casa.json"
    ruta.write_text(json.dumps(roto, ensure_ascii=False), encoding="utf-8")
    monkeypatch.setattr(api, "CASA_RUTA", ruta)
    api._casa.cache_clear()
    try:
        caplog.set_level("ERROR")
        assert len(api.casa()) == 13
        assert any("categoría desconocida" in r.getMessage() for r in caplog.records)
    finally:
        api._casa.cache_clear()


def test_el_api_con_json_roto_devuelve_casa_vacia(monkeypatch, tmp_path):
    ruta = tmp_path / "casa.json"
    ruta.write_text("{ esto no es json", encoding="utf-8")
    monkeypatch.setattr(api, "CASA_RUTA", ruta)
    api._casa.cache_clear()
    try:
        assert api.casa() == []
    finally:
        api._casa.cache_clear()


def test_el_api_con_archivo_ausente_devuelve_casa_vacia(monkeypatch, tmp_path):
    monkeypatch.setattr(api, "CASA_RUTA", tmp_path / "no-existe.json")
    api._casa.cache_clear()
    try:
        assert api.casa() == []
    finally:
        api._casa.cache_clear()
