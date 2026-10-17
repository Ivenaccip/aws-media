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
from test_coi_mundo import CASA_DE_PRUEBA

RUTA = Path(__file__).resolve().parent.parent / "server" / "biblioteca_casa.json"


def _leer(ruta=RUTA):
    """Como lo lee el API: `utf-8-sig`, porque los editores de Windows guardan «UTF-8 con BOM»."""
    return json.loads(ruta.read_text(encoding="utf-8-sig"))


@pytest.fixture(scope="module")
def doc():
    return _leer()


@pytest.fixture
def prompts(doc):
    return doc["prompts"]


@pytest.fixture
def muestra():
    """Un archivo de la casa de prueba, siempre válido: sobre él se prueban el validador y el API.
    Solo las pruebas de arriba miran el archivo del dueño, y solo para ver que sea válido."""
    return copy.deepcopy(CASA_DE_PRUEBA)


def test_el_archivo_es_valido_de_principio_a_fin(doc):
    validos, problemas = api.validar_casa(doc)
    assert problemas == []
    assert len(validos) == len(doc["prompts"])


def test_cada_prompt_cae_en_una_de_las_cuatro_categorias(prompts):
    """No se fija cuántos prompts trae el archivo ni cómo se reparten: el dueño lo reemplaza a su gusto."""
    por_categoria = {c: sum(p["categoria"] == c for p in prompts) for c in api.CLAVES_CATEGORIA}
    assert sum(por_categoria.values()) == len(prompts)


def test_ids_unicos_y_con_forma_estable(prompts):
    ids = [p["id"] for p in prompts]
    assert len(set(ids)) == len(ids)
    for i in ids:
        assert re.fullmatch(r"casa-[a-z0-9]+(-[a-z0-9]+)*", i), i      # un slug legible: sin fechas ni azar
    otra_lectura = [p["id"] for p in _leer()["prompts"]]
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
    ({"prompt": "x" * (api.MAX_PROMPT + 1)}, "prompt"),
    ({"categoria": "musica"}, "categoría"),
    ({"etiquetas": ["a", "b", "c", "d"]}, "etiquetas"),
    ({"etiquetas": ["x" * 25]}, "etiquetas"),
    ({"etiquetas": "retrato"}, "etiquetas"),
    ({"lleva_a": None}, "lleva_a"),                       # imagen sin destino
    ({"lleva_a": "video"}, "lleva_a"),                    # imagen que se lleva a video
    ({"categoria": "guion"}, "lleva_a"),                  # guion que dice llevarse a imagen
])
def test_el_validador_caza_cada_descuido(muestra, cambios, pista):
    validos, problemas = api.validar_casa(_doc_con(muestra, **cambios))
    assert len(validos) == len(muestra["prompts"]) - 1
    assert len(problemas) == 1 and pista in problemas[0]


def test_el_validador_caza_ids_repetidos(muestra):
    d = copy.deepcopy(muestra)
    d["prompts"][1]["id"] = d["prompts"][0]["id"]
    validos, problemas = api.validar_casa(d)
    assert len(validos) == len(muestra["prompts"]) - 1 and "repetido" in problemas[0]


@pytest.mark.parametrize("roto", [None, [], {}, {"prompts": "no es lista"}, {"prompts": [1, "x"]}])
def test_un_archivo_que_no_es_el_esperado_no_revienta(roto):
    validos, problemas = api.validar_casa(roto)
    assert validos == [] and problemas


# ---------------------------------------------------------------------------
# el API con un archivo descompuesto: se queda con lo válido y lo avisa en el log

def test_el_api_se_queda_con_lo_valido_y_avisa(monkeypatch, tmp_path, caplog, muestra):
    roto = _doc_con(muestra, categoria="musica")
    ruta = tmp_path / "casa.json"
    ruta.write_text(json.dumps(roto, ensure_ascii=False), encoding="utf-8")
    monkeypatch.setattr(api, "CASA_RUTA", ruta)
    api._casa.cache_clear()
    try:
        caplog.set_level("ERROR")
        assert len(api.casa()) == len(muestra["prompts"]) - 1
        assert any("categoría desconocida" in r.getMessage() for r in caplog.records)
    finally:
        api._casa.cache_clear()


def _con_archivo(monkeypatch, ruta):
    monkeypatch.setattr(api, "CASA_RUTA", ruta)
    api._casa.cache_clear()


def test_el_api_con_json_roto_devuelve_casa_vacia(monkeypatch, tmp_path):
    ruta = tmp_path / "casa.json"
    ruta.write_text("{ esto no es json", encoding="utf-8")
    _con_archivo(monkeypatch, ruta)
    try:
        assert api.casa() == []
    finally:
        api._casa.cache_clear()


def test_el_log_de_un_json_roto_dice_el_motivo_y_la_linea(monkeypatch, tmp_path, caplog, muestra):
    """Un tabulador literal dentro de un texto, una coma de más…: el log dice qué y dónde, no solo el nombre de la clase."""
    ruta = tmp_path / "casa.json"
    crudo = json.dumps(muestra, ensure_ascii=False, indent=2).replace('"titulo": "', '"titulo": "\t', 1)
    ruta.write_text(crudo, encoding="utf-8")
    _con_archivo(monkeypatch, ruta)
    try:
        caplog.set_level("ERROR")
        assert api.casa() == []
        (linea,) = [r.getMessage() for r in caplog.records if "casa.json" in r.getMessage()]
        assert "no es un JSON válido" in linea and "Invalid control character" in linea
        assert re.search(r"línea \d+, columna \d+", linea)
        numero = int(re.search(r"línea (\d+)", linea).group(1))
        assert '"titulo": "\t' in crudo.splitlines()[numero - 1]            # y es la línea del tabulador
    finally:
        api._casa.cache_clear()


def test_el_api_lee_un_archivo_guardado_con_bom(monkeypatch, tmp_path, muestra):
    """Los editores de Windows guardan «UTF-8 con BOM»: con `utf-8` pelón ese primer carácter invisible
    rompía el JSON y «De la casa» salía vacía, sin avisar por qué."""
    ruta = tmp_path / "casa.json"
    ruta.write_bytes(b"\xef\xbb\xbf" + json.dumps(muestra, ensure_ascii=False).encode("utf-8"))
    _con_archivo(monkeypatch, ruta)
    try:
        assert len(api.casa()) == len(muestra["prompts"])
    finally:
        api._casa.cache_clear()


def test_el_api_con_un_archivo_que_no_es_utf8_avisa_y_devuelve_casa_vacia(monkeypatch, tmp_path, caplog):
    ruta = tmp_path / "casa.json"
    ruta.write_bytes('{"prompts": [{"titulo": "canción"}]}'.encode("latin-1"))
    _con_archivo(monkeypatch, ruta)
    try:
        caplog.set_level("ERROR")
        assert api.casa() == []
        assert any("UTF-8" in r.getMessage() for r in caplog.records)
    finally:
        api._casa.cache_clear()


def test_el_dueno_puede_agregar_o_quitar_prompts_y_el_api_los_sirve_todos(monkeypatch, tmp_path, muestra):
    """Un 15.º prompt (o uno menos, o muchos más) no rompe nada: el API sirve los que haya, en su orden."""
    base = muestra["prompts"]
    for cuantos in (len(base) + 1, len(base) - 1, 1, 40, 0):
        prompts = [dict(base[n % len(base)], id=f"casa-prueba-{n}") for n in range(cuantos)]
        ruta = tmp_path / f"casa-{cuantos}.json"
        ruta.write_text(json.dumps({"prompts": prompts}, ensure_ascii=False), encoding="utf-8")
        _con_archivo(monkeypatch, ruta)
        try:
            assert [p["id"] for p in api.casa()] == [p["id"] for p in prompts]
            assert api.validar_casa({"prompts": prompts})[1] == []
        finally:
            api._casa.cache_clear()


def test_el_api_con_archivo_ausente_devuelve_casa_vacia(monkeypatch, tmp_path):
    monkeypatch.setattr(api, "CASA_RUTA", tmp_path / "no-existe.json")
    api._casa.cache_clear()
    try:
        assert api.casa() == []
    finally:
        api._casa.cache_clear()
