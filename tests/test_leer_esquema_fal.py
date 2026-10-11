"""tools/leer_esquema_fal.py: la lectura SOLO LECTURA de los esquemas públicos de fal.

Lo que este archivo defiende:
  * no gasta ni autoriza nada: ni lee el .env ni la clave, ni manda un encabezado de
    autorización, ni llama a un modelo (una sola petición GET por endpoint);
  * un nombre de endpoint raro se rechaza con 2 antes de pedir nada;
  * el resumen sabe seguir `$ref`, `anyOf`, objetos con rangos y listas, y enseña el
    enum completo y el valor por defecto de cada llave (lo que hace falta para escribir
    un adaptador: `image_size`, `num_images`, `quality`, `image_urls`);
  * un esquema que no se entiende no tira el programa: dice qué no pudo leer;
  * una página caída no frena a las demás y se sale con 1.

Sin red: el OpenAPI es una muestra con la forma que fal publica (FastAPI/pydantic).
OJO: la forma exacta de un OpenAPI real de fal NO se pudo comprobar desde aquí (el
entorno no llega a fal.ai); la prueba con el esquema real la corre el dueño.
"""
from __future__ import annotations

import importlib.util
import json
import urllib.error
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parent.parent
_spec = importlib.util.spec_from_file_location("leer_esquema_fal", RAIZ / "tools" / "leer_esquema_fal.py")
leer = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(leer)

ENDPOINT = "fal-ai/flux-2/klein/9b"

# Un OpenAPI con la forma de los de fal: el POST de la ruta del endpoint recibe un esquema
# por `$ref`; `image_size` es un anyOf (enum nombrado u objeto con ancho y alto).
MUESTRA = {
    "openapi": "3.0.4",
    "paths": {
        f"/{ENDPOINT}/requests/{{request_id}}/status": {"get": {}},
        f"/{ENDPOINT}": {"post": {"requestBody": {"content": {"application/json": {
            "schema": {"$ref": "#/components/schemas/KleinInput"}}}}}},
    },
    "components": {"schemas": {
        "KleinInput": {
            "type": "object",
            "required": ["prompt"],
            "properties": {
                "prompt": {"type": "string", "description": "El texto."},
                "image_size": {
                    "anyOf": [{"$ref": "#/components/schemas/ImageSize"}, {"$ref": "#/components/schemas/Enum"}],
                    "description": "El tamaño de la imagen generada.", "default": "landscape_4_3"},
                "num_images": {"type": "integer", "minimum": 1, "maximum": 4, "default": 1,
                               "description": "Cuántas imágenes."},
                "image_urls": {"type": "array", "items": {"type": "string"}, "maxItems": 16},
                "seed": {"type": "integer"},
            },
        },
        "ImageSize": {"type": "object", "properties": {
            "width": {"type": "integer", "minimum": 64, "maximum": 14142},
            "height": {"type": "integer", "minimum": 64, "maximum": 14142}}},
        "Enum": {"type": "string", "enum": ["square_hd", "square", "portrait_4_3", "portrait_16_9",
                                            "landscape_4_3", "landscape_16_9"]},
    }},
}


def test_el_resumen_enseña_enum_objeto_rangos_lista_y_defecto():
    r = leer.resumir(MUESTRA, ENDPOINT)
    assert "entrada: KleinInput" in r
    assert "- prompt (OBLIGATORIA): string" in r
    assert "enum[square_hd, square, portrait_4_3, portrait_16_9, landscape_4_3, landscape_16_9]" in r
    assert "objeto{height, width} (height 64–14142; width 64–14142)" in r
    assert 'por defecto "landscape_4_3"' in r
    assert "- num_images: integer minimum=1 maximum=4 · por defecto 1" in r
    assert "lista de string maxItems=16" in r
    assert "El tamaño de la imagen generada." in r          # descripción de una llave clave


def test_una_llave_que_no_es_clave_no_trae_descripcion():
    r = leer.resumir(MUESTRA, ENDPOINT)
    assert "El texto." not in r                               # `prompt` no está en las llaves clave


def test_la_ruta_exacta_del_endpoint_gana_sobre_otro_post():
    doc = json.loads(json.dumps(MUESTRA))
    doc["paths"]["/otra/ruta"] = {"post": {"requestBody": {"content": {"application/json": {
        "schema": {"type": "object", "properties": {"x": {"type": "string"}}}}}}}}
    nombre, esq = leer.esquema_de_entrada(doc, ENDPOINT)
    assert nombre == "KleinInput" and "image_size" in esq["properties"]


@pytest.mark.parametrize("doc,motivo", [
    ({}, "no trae un POST"),
    ({"paths": {"/x": {"post": {"requestBody": {"content": {"application/json": {
        "schema": {"type": "object"}}}}}}}}, "no declara propiedades"),
])
def test_un_esquema_que_no_se_entiende_lo_dice_y_no_truena(doc, motivo):
    r = leer.resumir(doc, ENDPOINT)
    assert "no se pudo leer la entrada" in r and motivo in r


def test_un_ref_roto_no_cae_en_un_ciclo():
    doc = {"components": {"schemas": {"A": {"$ref": "#/components/schemas/A"}}}}
    assert leer._ref(doc, {"$ref": "#/components/schemas/A"}) == {"$ref": "#/components/schemas/A"}
    assert leer._ref(doc, {"$ref": "https://otro/esquema.json"}) == {"$ref": "https://otro/esquema.json"}


@pytest.mark.parametrize("malo", ["", "flux", "../etc/passwd", "fal-ai/../x", "fal ai/x", "https://x.com/a/b",
                                  "fal-ai/flux 2", "-fal/x", "fal-ai/"])
def test_un_endpoint_raro_se_rechaza_antes_de_pedir_nada(malo, monkeypatch, capsys):
    monkeypatch.setattr(leer, "descargar", lambda ep: pytest.fail("no debió pedir nada"))
    with pytest.raises(SystemExit) as e:
        leer.main([malo])
    assert e.value.code == 2


@pytest.mark.parametrize("bueno", list(leer.OLA2) + ["fal-ai/nano-banana-pro/edit"])
def test_los_endpoints_de_la_ola_2_pasan_la_validacion(bueno):
    assert leer.validar_endpoint(bueno) == bueno


def test_la_ola_2_trae_los_doce_endpoints_y_sin_la_4b_de_klein():
    assert len(leer.OLA2) == len(set(leer.OLA2)) == 12
    assert "fal-ai/flux-2/klein/9b" in leer.OLA2 and "fal-ai/flux-2/klein/4b" not in leer.OLA2


def test_main_guarda_json_y_resumen_y_sale_con_0(monkeypatch, tmp_path, capsys):
    visto = []
    monkeypatch.setattr(leer, "descargar", lambda ep: visto.append(ep) or MUESTRA)
    code = leer.main([ENDPOINT, "--salida", str(tmp_path / "s")])
    out = capsys.readouterr().out
    assert code == 0 and visto == [ENDPOINT]
    assert json.loads((tmp_path / "s" / f"fal-ai__flux-2__klein__9b.json").read_text(encoding="utf-8")) == MUESTRA
    resumen = (tmp_path / "s" / "RESUMEN.txt").read_text(encoding="utf-8")
    assert f"== {ENDPOINT}" in resumen and "image_size" in resumen
    assert "No se llamó a ningún modelo ni se gastó nada." in out


def test_una_pagina_caida_no_frena_a_las_demas(monkeypatch, tmp_path, capsys):
    def descargar(ep):
        if ep == "fal-ai/z-image/turbo":
            raise urllib.error.URLError("sin red")
        return MUESTRA
    monkeypatch.setattr(leer, "descargar", descargar)
    code = leer.main([ENDPOINT, "fal-ai/z-image/turbo", "fal-ai/flux-2-pro", "--salida", str(tmp_path)])
    resumen = (tmp_path / "RESUMEN.txt").read_text(encoding="utf-8")
    assert code == 1
    assert "NO SE PUDO LEER: URLError" in resumen and resumen.count("entrada: KleinInput") == 2
    assert not (tmp_path / "fal-ai__z-image__turbo.json").exists()


def test_una_respuesta_que_no_es_json_cuenta_como_fallo(monkeypatch, tmp_path):
    def descargar(ep):
        raise json.JSONDecodeError("x", "<html>", 0)
    monkeypatch.setattr(leer, "descargar", descargar)
    assert leer.main([ENDPOINT, "--salida", str(tmp_path)]) == 1


def test_no_se_puede_crear_la_carpeta_de_salida(monkeypatch, tmp_path):
    ocupado = tmp_path / "archivo"
    ocupado.write_text("x")
    monkeypatch.setattr(leer, "descargar", lambda ep: pytest.fail("no debió pedir nada"))
    with pytest.raises(SystemExit) as e:
        leer.main([ENDPOINT, "--salida", str(ocupado / "dentro")])
    assert e.value.code == 2


# ---------------------------------------------------------------------------
# solo lectura: sin clave, sin .env, sin fal_client, sin encabezado de autorización

def test_la_peticion_es_un_get_publico_sin_autorizacion(monkeypatch):
    pedido = {}

    class Respuesta:
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def read(self): return json.dumps(MUESTRA).encode("utf-8")

    def urlopen(req, timeout=None):
        pedido.update(url=req.full_url, metodo=req.get_method(), encabezados=dict(req.header_items()),
                      timeout=timeout)
        return Respuesta()
    monkeypatch.setenv("FAL_KEY", "clave-secreta-de-prueba")
    monkeypatch.setattr(leer.urllib.request, "urlopen", urlopen)
    assert leer.descargar(ENDPOINT) == MUESTRA
    assert pedido["url"] == "https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/flux-2/klein/9b"
    assert pedido["metodo"] == "GET" and pedido["timeout"] == leer.TIMEOUT_S
    claves = {k.lower() for k in pedido["encabezados"]}
    assert not claves & {"authorization", "x-api-key", "cookie"}
    assert "clave-secreta-de-prueba" not in json.dumps(pedido)


def test_el_codigo_no_toca_claves_ni_el_env_ni_fal_client():
    fuente = (RAIZ / "tools" / "leer_esquema_fal.py").read_text(encoding="utf-8")
    codigo = "\n".join(l for l in fuente.splitlines() if not l.lstrip().startswith("#"))
    for prohibido in ("FAL_KEY", "dotenv", "fal_client", "os.environ", "getenv", ".env\"", "Authorization",
                      "subscribe", "settings"):
        assert prohibido not in codigo.split('"""', 2)[2], prohibido
