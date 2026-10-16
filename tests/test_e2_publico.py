"""E2 · Ajustes 2 — lo que el navegador ve de una copia (D-11, H9, INT-07).

`GET /api/editar/<copia>` (el sondeo de la caja, cada 5 s) y `GET /api/edicion/proyectos` devolvían el
`doc.editar` ENTERO: las keys de S3 de los originales (`fuentes[]`: `origen_key`, `canonico_key`, `wav_key`),
la clave de idempotencia (`pedido`) y el error crudo del worker. No cruza cuentas y la web solo lee `estado`,
pero es carga de más y rutas internas a la vista. El doc guardado NO cambia: `reintentar` y el worker lo
necesitan. Y el aviso 502 de `iniciar` ya no copia un ARN de AWS al navegador.
"""
import json

import pytest

from pipeline import creditos
from server import edicion_api, editar_api
from test_e2_mundo import cliente, mundo, tarifa  # noqa: F401

COPIA = "ed-9f1c0a7b"
ARN = "arn:aws:sts::123456789012:assumed-role/ApiStack-ApiFnServiceRole-ABC/ApiFn"


def con_fuentes(mundo, **extra):
    mundo.copia(COPIA, "T", estado="listo", pedido="9f1c0a7b4d2e4f6a8b3c1d5e7f9a0b2c", creditos=8, devueltos=None,
                paso="vista", n_videos=2, formato="horizontal",
                fuentes=[{"orden": 1, "clip_id": "c01", "origen_key": "videos/a/subidas/a.mp4",
                          "canonico_key": "videos/a/work/transcripts/a.canonical.json",
                          "wav_key": "videos/a/work/audio/a.wav", "bytes": 5},
                         {"orden": 2, "clip_id": "c02", "origen_key": "usuarios/u1/clips/c.mp4", "bytes": 6}],
                **extra)


def test_el_sondeo_de_una_copia_no_trae_keys_de_s3_ni_la_clave_de_idempotencia(cliente, mundo):
    con_fuentes(mundo)
    r = cliente.get(f"/api/editar/{COPIA}")
    assert r.status_code == 200
    e = r.json()["editar"]
    for privado in ("fuentes", "pedido"):
        assert privado not in e
    assert "videos/a/subidas" not in r.text and "usuarios/u1" not in r.text and "wav_key" not in r.text
    # lo que la web SÍ lee sigue ahí
    assert (e["estado"], e["paso"], e["creditos"], e["n_videos"], e["copia"]) == ("listo", "vista", 8, 2, True)
    assert e["instruccion"]


def test_el_doc_guardado_conserva_lo_que_el_worker_y_el_reintento_necesitan(cliente, mundo):
    con_fuentes(mundo)
    cliente.get(f"/api/editar/{COPIA}")
    cliente.get("/api/edicion/proyectos")
    guardado = mundo.docs()[COPIA]["editar"]
    assert len(guardado["fuentes"]) == 2 and guardado["pedido"].startswith("9f1c0a7b")


def test_la_lista_de_mis_creaciones_tampoco_las_trae(cliente, mundo):
    con_fuentes(mundo)
    fila = next(f for f in cliente.get("/api/edicion/proyectos").json() if f["nombre"] == COPIA)
    assert "fuentes" not in fila["editar"] and "pedido" not in fila["editar"]
    assert fila["editar"]["estado"] == "listo" and fila["n_videos"] == 1 and fila["titulo"] == "T"


def test_una_corrida_vieja_de_e1_conserva_su_contrato(cliente, mundo):
    """Lo que no es una copia no se toca: `Subir.tsx` y `e1.html` leen `editar.error` y `editar.fuente`."""
    mundo.subida("viejo", dur=300.0)
    mundo.docs()["viejo"]["editar"] = {"estado": "error", "fuente": "videos/viejo/subidas/viejo.mp4",
                                       "duracion_s": 300.0, "creditos": 4, "error": "RuntimeError: x"}
    e = cliente.get("/api/editar/viejo").json()["editar"]
    assert e == mundo.docs()["viejo"]["editar"]
    fila = next(f for f in cliente.get("/api/edicion/proyectos").json() if f["nombre"] == "viejo")
    assert fila["editar"] == mundo.docs()["viejo"]["editar"]


def test_el_error_crudo_del_worker_sale_sin_arn_ni_numeros_de_cuenta(cliente, mundo):
    con_fuentes(mundo, error=f"ClientError: HeadObject denied for {ARN} in 123456789012")
    e = cliente.get(f"/api/editar/{COPIA}").json()["editar"]
    assert "arn:aws" not in e["error"] and "123456789012" not in e["error"]
    assert e["error"].startswith("ClientError: HeadObject denied for [")
    assert mundo.docs()[COPIA]["editar"]["error"].count("arn:aws") == 1       # el guardado no cambia


def test_editar_publico_es_puro_y_tolera_cualquier_cosa():
    original = {"copia": True, "estado": "listo", "fuentes": [1], "pedido": "x", "error": "a"}
    copia = json.loads(json.dumps(original))
    assert editar_api.editar_publico(copia) == {"copia": True, "estado": "listo", "error": "a"}
    assert copia == original                                                # no muta lo que recibe
    for raro in (None, "texto", 5, [], {}, {"estado": "error", "fuentes": [1]}):
        assert editar_api.editar_publico(raro) == raro


@pytest.mark.parametrize("crudo,esperado", [
    (f"User: {ARN} is not authorized", "User: […] is not authorized"),
    ("cuenta 123456789012 y 1234567890123 y 12345678901", "cuenta […] y 1234567890123 y 12345678901"),
    ("arn:aws-cn:states:cn-north-1:123456789012:stateMachine:x,", "[…],"),
    ("sin nada que tachar", "sin nada que tachar"),
])
def test_tachar_infra(crudo, esperado):
    assert editar_api.tachar_infra(crudo) == esperado


def test_el_502_de_iniciar_no_copia_el_arn_al_navegador_ni_al_doc(cliente, mundo):
    mundo.lanzar_falla = RuntimeError(f"An error occurred (AccessDeniedException) when calling StartExecution: "
                                      f"User: {ARN} is not authorized to perform: states:StartExecution")
    mundo.subida("a", dur=20.0, canonico=True)
    mundo.subida("b", dur=15.0, canonico=True)
    r = cliente.post("/api/edicion/iniciar", json=mundo.cuerpo("proyecto:a", "proyecto:b"))
    assert r.status_code == 502
    assert "arn:aws" not in r.json()["detail"] and "123456789012" not in r.json()["detail"]
    assert "AccessDeniedException" in r.json()["detail"]                     # lo útil se conserva
    assert "arn:aws" not in mundo.docs()[COPIA]["editar"]["error"]
    assert "AccessDeniedException" in mundo.docs()[COPIA]["editar"]["error"]
