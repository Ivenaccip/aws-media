"""Ajustes 3 — server/biblioteca_api.py: la Biblioteca de prompts y el top 3 fijado.

La base va con el doble de `test_coi_mundo.Mundo` (misma semántica que su SQL, que se
prueba contra un Postgres real en test_coi_postgres.py). Aquí: las formas JSON, los
códigos de error con su `detail` como objeto, los fijados (máximo 3, sin repetidos, solo
ids de la casa o propios, en orden), la clave que hace idempotente el guardado, y el
aislamiento entre personas. Sin red."""
import re

import pytest

from server import biblioteca_api as api
from test_coi_mundo import Mundo, cliente, mundo  # noqa: F401

CASA = [p["id"] for p in api.casa()]
UNO, DOS, TRES, CUATRO = CASA[:4]
CLAVE = "a1b2c3d4e5f60718293a4b5c6d7e8f90"


def detalle(r):
    d = r.json()["detail"]
    assert isinstance(d, dict) and {"codigo", "texto"} <= set(d), d
    return d


def guardar(cliente, **campos):
    cuerpo = {"titulo": "Plan de cocina", "prompt": "#CONTEXTO\nEres chef.", "categoria": "guion",
              "etiquetas": ["cocina"], "origen": "coi", **campos}
    return cliente.post("/api/biblioteca/mios", json=cuerpo)


def fijar(cliente, ids):
    return cliente.put("/api/biblioteca/fijados", json={"ids": ids})


# ---------------------------------------------------------------------------
# GET /api/biblioteca

def test_get_trae_todo_en_una_carga(cliente, mundo):
    r = cliente.get("/api/biblioteca")
    assert r.status_code == 200
    d = r.json()
    assert set(d) == {"categorias", "casa", "mios", "fijados", "limites"}
    assert d["categorias"] == [{"clave": "imagen", "nombre": "Imagen"}, {"clave": "video", "nombre": "Video"},
                               {"clave": "guion", "nombre": "Guion y texto"},
                               {"clave": "investigacion", "nombre": "Investigación"}]
    assert d["limites"] == {"fijados": 3, "mios": 100, "titulo": 80, "prompt": 12000}
    assert d["mios"] == [] and d["fijados"] == []
    assert len(d["casa"]) == 14
    assert set(d["casa"][0]) == {"id", "titulo", "para_que", "prompt", "categoria", "etiquetas", "lleva_a"}
    assert r.headers["cache-control"] == "no-store"


def test_la_casa_sale_en_el_orden_del_archivo(cliente, mundo):
    assert [p["id"] for p in cliente.get("/api/biblioteca").json()["casa"]] == CASA
    assert CASA[0].startswith("casa-")


def test_lleva_a_solo_imagen_y_video(cliente, mundo):
    casa = cliente.get("/api/biblioteca").json()["casa"]
    assert {p["lleva_a"] for p in casa if p["categoria"] in ("imagen", "video")} == {"imagen", "video"}
    assert all(p["lleva_a"] is None for p in casa if p["categoria"] in ("guion", "investigacion"))


def test_mios_con_su_forma_el_mas_nuevo_primero_y_lleva_a_null(cliente, mundo):
    primero = guardar(cliente, titulo="Primero").json()["prompt"]
    segundo = guardar(cliente, titulo="Segundo", categoria="imagen").json()["prompt"]
    d = cliente.get("/api/biblioteca").json()
    assert [m["id"] for m in d["mios"]] == [segundo["id"], primero["id"]]
    m = d["mios"][0]
    assert set(m) == {"id", "titulo", "para_que", "prompt", "categoria", "etiquetas", "origen", "creado", "lleva_a"}
    assert re.fullmatch(r"mio-[0-9a-f]{12}", m["id"]) and m["lleva_a"] is None and m["origen"] == "coi"
    assert re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ", m["creado"])
    assert m["categoria"] == "imagen"          # un «mío» de imagen no se lleva a la caja: solo se copia


def test_fijados_huerfanos_se_omiten_y_el_orden_se_conserva(cliente, mundo):
    mio = guardar(cliente).json()["prompt"]["id"]
    mundo.fijados["u1"] = [TRES, "casa-ya-no-existe", mio, "mio-0123456789ab", UNO]
    assert cliente.get("/api/biblioteca").json()["fijados"] == [TRES, mio, UNO]


def test_en_local_sin_postgres_se_ve_la_casa_y_nada_se_guarda(cliente, mundo, monkeypatch):
    from pipeline import db
    monkeypatch.setattr(db, "backend", lambda: "json")
    d = cliente.get("/api/biblioteca").json()
    assert len(d["casa"]) == 14 and d["mios"] == [] and d["fijados"] == []
    for r in (fijar(cliente, [UNO]), guardar(cliente), cliente.delete("/api/biblioteca/mios/mio-0123456789ab")):
        assert r.status_code == 503 and detalle(r)["codigo"] == "no_nube"
    assert mundo.eventos == []


def test_get_si_la_base_no_responde_es_503_con_detail_objeto(cliente, mundo):
    mundo.fallas["biblioteca_mios"] = RuntimeError("Aurora: " + "secreto-interno")
    r = cliente.get("/api/biblioteca")
    assert r.status_code == 503 and detalle(r)["codigo"] == "no_disponible"
    assert "secreto-interno" not in r.text and "Aurora" not in r.text


# ---------------------------------------------------------------------------
# PUT /api/biblioteca/fijados

def test_fijar_reemplaza_la_lista_y_conserva_el_orden(cliente, mundo):
    r = fijar(cliente, [TRES, UNO, DOS])
    assert r.status_code == 200 and r.json() == {"fijados": [TRES, UNO, DOS]}
    assert cliente.get("/api/biblioteca").json()["fijados"] == [TRES, UNO, DOS]
    assert fijar(cliente, [DOS]).json() == {"fijados": [DOS]}                 # REEMPLAZA, no suma
    assert cliente.get("/api/biblioteca").json()["fijados"] == [DOS]
    assert fijar(cliente, []).json() == {"fijados": []}                       # y vaciar se puede
    assert cliente.get("/api/biblioteca").json()["fijados"] == []


def test_mas_de_tres_es_422_demasiados_con_el_texto_del_contrato(cliente, mundo):
    r = fijar(cliente, [UNO, DOS, TRES, CUATRO])
    d = detalle(r)
    assert r.status_code == 422 and d["codigo"] == "demasiados"
    assert d["texto"] == "Ya tienes 3 fijados. Quita uno para fijar otro."
    assert mundo.fijados.get("u1", []) == []                                  # y no se guardó nada


def test_repetidos_es_422(cliente, mundo):
    r = fijar(cliente, [UNO, DOS, UNO])
    assert r.status_code == 422 and detalle(r)["codigo"] == "repetido"


def test_demasiados_gana_sobre_repetido(cliente, mundo):
    assert detalle(fijar(cliente, [UNO, UNO, UNO, UNO]))["codigo"] == "demasiados"


@pytest.mark.parametrize("ids", [["casa-no-existe"], ["mio-0123456789ab"], ["cualquier-cosa"], [""],
                                 ["mio-XYZ"], [UNO, "casa-no-existe"]])
def test_un_id_desconocido_es_422(cliente, mundo, ids):
    r = fijar(cliente, ids)
    assert r.status_code == 422 and detalle(r)["codigo"] == "desconocido"
    assert mundo.fijados.get("u1", []) == []


def test_se_puede_fijar_un_mio_propio_y_uno_de_la_casa(cliente, mundo):
    mio = guardar(cliente).json()["prompt"]["id"]
    assert fijar(cliente, [mio, UNO]).json() == {"fijados": [mio, UNO]}


def test_jamas_se_acepta_el_id_de_otra_persona(cliente, mundo):
    ajeno = guardar(cliente).json()["prompt"]["id"]
    mundo.user = "u2"
    r = fijar(cliente, [ajeno])
    assert r.status_code == 422 and detalle(r)["codigo"] == "desconocido"
    assert mundo.fijados.get("u2", []) == []


@pytest.mark.parametrize("cuerpo", [{}, {"ids": "x"}, {"ids": [1, 2]}, {"ids": None}, [UNO]])
def test_cuerpo_mal_formado(cliente, mundo, cuerpo):
    r = cliente.put("/api/biblioteca/fijados", json=cuerpo)
    assert r.status_code == 422 and detalle(r)["codigo"] == "cuerpo"


def test_json_roto_en_fijados(cliente, mundo):
    r = cliente.put("/api/biblioteca/fijados", content=b"{no", headers={"content-type": "application/json"})
    assert r.status_code == 422 and detalle(r)["codigo"] == "cuerpo"


def test_fijar_no_toca_a_la_otra_persona(cliente, mundo):
    fijar(cliente, [UNO, DOS])
    mundo.user = "u2"
    assert cliente.get("/api/biblioteca").json()["fijados"] == []
    fijar(cliente, [TRES])
    mundo.user = "u1"
    assert cliente.get("/api/biblioteca").json()["fijados"] == [UNO, DOS]


# ---------------------------------------------------------------------------
# POST /api/biblioteca/mios

def test_guardar_un_coi_201_con_su_forma(cliente, mundo):
    r = guardar(cliente, para_que="Para mi canal")
    assert r.status_code == 201
    m = r.json()["prompt"]
    assert m["titulo"] == "Plan de cocina" and m["prompt"] == "#CONTEXTO\nEres chef."
    assert (m["categoria"], m["etiquetas"], m["para_que"], m["origen"], m["lleva_a"]) == \
        ("guion", ["cocina"], "Para mi canal", "coi", None)
    assert set(r.json()) == {"prompt"}


def test_los_defaults_categoria_guion_origen_coi_etiquetas_vacias(cliente, mundo):
    r = cliente.post("/api/biblioteca/mios", json={"titulo": "T", "prompt": "P"})
    m = r.json()["prompt"]
    assert r.status_code == 201 and (m["categoria"], m["origen"], m["etiquetas"], m["para_que"]) == ("guion", "coi", [], "")


def test_titulo_se_recorta_y_acepta_80(cliente, mundo):
    assert guardar(cliente, titulo="   " + "t" * 80 + "  ").json()["prompt"]["titulo"] == "t" * 80


def test_guardar_no_llama_al_modelo_ni_gasta_un_uso_de_coi(cliente, mundo):
    for _ in range(5):
        guardar(cliente)
    assert mundo.llamadas_modelo == [] and mundo.llamadas_moderacion == [] and mundo.coi == {}


@pytest.mark.parametrize("campos,codigo", [
    ({"titulo": ""}, "titulo_vacio"),
    ({"titulo": "   "}, "titulo_vacio"),
    ({"titulo": None}, "titulo_vacio"),
    ({"prompt": ""}, "prompt_vacio"),
    ({"prompt": "  \n "}, "prompt_vacio"),
    ({"titulo": "t" * 81}, "muy_largo"),
    ({"prompt": "p" * 12001}, "muy_largo"),
    ({"para_que": "x" * 161}, "muy_largo"),
    ({"categoria": "musica"}, "categoria"),
    ({"categoria": 5}, "categoria"),
    ({"etiquetas": ["a", "b", "c", "d"]}, "etiquetas"),
    ({"etiquetas": ["x" * 25]}, "etiquetas"),
    ({"etiquetas": "cocina"}, "etiquetas"),
    ({"etiquetas": [1]}, "etiquetas"),
    ({"origen": "manual"}, "origen"),
    ({"origen": ""}, "origen"),
    ({"clave": "corta"}, "clave"),
    ({"clave": "z" * 32}, "clave"),
    ({"clave": 123}, "clave"),
])
def test_validaciones_con_su_codigo(cliente, mundo, campos, codigo):
    r = guardar(cliente, **campos)
    assert r.status_code == 422 and detalle(r)["codigo"] == codigo
    assert mundo.mios.get("u1", []) == []                      # no se guardó nada


def test_muy_largo_dice_cual_campo(cliente, mundo):
    d = detalle(guardar(cliente, titulo="t" * 81))
    assert d["campo"] == "titulo" and d["max"] == 80 and "titulo" in d["texto"]
    assert detalle(guardar(cliente, prompt="p" * 12001))["campo"] == "prompt"


def test_el_prompt_de_12000_caracteres_si_cabe(cliente, mundo):
    assert guardar(cliente, prompt="p" * 12000).status_code == 201


def test_etiquetas_se_limpian_y_sin_repetir(cliente, mundo):
    m = guardar(cliente, etiquetas=["  ventas  ", "Ventas", "", "guion  corto", "x"]).json()["prompt"]
    assert m["etiquetas"] == ["ventas", "guion corto", "x"]


def test_cuerpo_mal_formado_en_guardar(cliente, mundo):
    for crudo in (b"", b"[]", b"no json"):
        r = cliente.post("/api/biblioteca/mios", content=crudo, headers={"content-type": "application/json"})
        assert r.status_code == 422 and detalle(r)["codigo"] == "cuerpo"
    r = cliente.post("/api/biblioteca/mios", json={"titulo": 5, "prompt": "p"})
    assert r.status_code == 422 and detalle(r)["codigo"] == "cuerpo"


def test_la_clave_hace_idempotente_el_guardado(cliente, mundo):
    a = guardar(cliente, clave=CLAVE)
    b = guardar(cliente, clave=CLAVE)                          # doble clic
    c = guardar(cliente, clave=CLAVE.upper())                  # la misma clave en mayúsculas
    assert (a.status_code, b.status_code, c.status_code) == (201, 200, 200)
    assert a.json() == b.json() == c.json()
    assert len(mundo.mios["u1"]) == 1


def test_otra_clave_o_sin_clave_crea_otro(cliente, mundo):
    guardar(cliente, clave=CLAVE)
    guardar(cliente, clave="f" * 32)
    guardar(cliente)
    guardar(cliente)
    assert len(mundo.mios["u1"]) == 4


def test_la_misma_clave_de_otra_persona_no_es_el_mismo_registro(cliente, mundo):
    a = guardar(cliente, clave=CLAVE).json()["prompt"]
    mundo.user = "u2"
    b = guardar(cliente, clave=CLAVE)
    assert b.status_code == 201 and b.json()["prompt"]["id"] != a["id"]


def test_al_llegar_a_100_es_409_lleno(cliente, mundo):
    for n in range(100):
        assert guardar(cliente, titulo=f"p{n}").status_code == 201
    r = guardar(cliente, titulo="el 101")
    d = detalle(r)
    assert r.status_code == 409 and d["codigo"] == "lleno" and "100" in d["texto"]
    assert len(mundo.mios["u1"]) == 100
    # repetir una clave ya guardada con la lista llena sigue siendo idempotente
    mundo.mios["u1"][0]["clave"] = CLAVE
    assert guardar(cliente, clave=CLAVE).status_code == 200


def test_si_la_base_no_responde_al_guardar(cliente, mundo):
    mundo.fallas["biblioteca_crear_mio"] = RuntimeError("boom")
    r = guardar(cliente)
    assert r.status_code == 503 and detalle(r)["codigo"] == "no_disponible"


def test_si_el_id_al_azar_choca_una_vez_se_reintenta(cliente, mundo, monkeypatch):
    import uuid
    a, b = uuid.UUID(int=1 << 120), uuid.UUID(int=2 << 120)       # los 12 primeros hex son los que cuentan
    ids = iter([a, a, b])
    monkeypatch.setattr(api.uuid, "uuid4", lambda: next(ids))
    assert guardar(cliente).status_code == 201
    assert guardar(cliente).status_code == 201                  # chocó con el primero; el reintento lo logra
    assert len(mundo.mios["u1"]) == 2


# ---------------------------------------------------------------------------
# DELETE /api/biblioteca/mios/{id}

def test_borrar_uno_mio_lo_quita_tambien_de_los_fijados_y_conserva_el_orden(cliente, mundo):
    a = guardar(cliente, titulo="A").json()["prompt"]["id"]
    b = guardar(cliente, titulo="B").json()["prompt"]["id"]
    fijar(cliente, [UNO, a, b])
    r = cliente.delete(f"/api/biblioteca/mios/{a}")
    assert r.status_code == 200 and r.json() == {"ok": True}
    d = cliente.get("/api/biblioteca").json()
    assert [m["id"] for m in d["mios"]] == [b] and d["fijados"] == [UNO, b]
    assert mundo.fijados["u1"] == [UNO, b]                      # y quedó limpio en la base


def test_borrar_uno_que_no_existe_es_404_no_es_tuyo(cliente, mundo):
    r = cliente.delete("/api/biblioteca/mios/mio-0123456789ab")
    d = detalle(r)
    assert r.status_code == 404 and d["codigo"] == "no_es_tuyo"


def test_borrar_con_un_id_mal_formado_ni_toca_la_base(cliente, mundo):
    for malo in ("casa-algo", "mio-XYZ", "otra-cosa", "mio-0123456789abc"):
        assert cliente.delete(f"/api/biblioteca/mios/{malo}").status_code == 404
    assert mundo.eventos == []


def test_borrar_el_de_otra_persona_responde_igual_que_uno_inexistente(cliente, mundo):
    ajeno = guardar(cliente).json()["prompt"]["id"]
    mundo.user = "u2"
    r = cliente.delete(f"/api/biblioteca/mios/{ajeno}")
    assert r.status_code == 404 and detalle(r)["codigo"] == "no_es_tuyo"
    mundo.user = "u1"
    assert [m["id"] for m in cliente.get("/api/biblioteca").json()["mios"]] == [ajeno]   # sigue ahí


def test_borrar_siempre_se_puede_aunque_este_lleno(cliente, mundo):
    for n in range(100):
        guardar(cliente, titulo=f"p{n}")
    un_id = mundo.mios["u1"][0]["id"]
    assert cliente.delete(f"/api/biblioteca/mios/{un_id}").status_code == 200
    assert guardar(cliente).status_code == 201


def test_borrar_si_la_base_no_responde(cliente, mundo):
    mundo.fallas["biblioteca_borrar_mio"] = RuntimeError("boom")
    r = cliente.delete("/api/biblioteca/mios/mio-0123456789ab")
    assert r.status_code == 503 and detalle(r)["codigo"] == "no_disponible"


# ---------------------------------------------------------------------------
# aislamiento: nunca ves lo de otra persona

def test_cada_persona_ve_solo_lo_suyo(cliente, mundo):
    mio_1 = guardar(cliente, titulo="De uno").json()["prompt"]["id"]
    fijar(cliente, [UNO, mio_1])
    mundo.user = "u2"
    d = cliente.get("/api/biblioteca").json()
    assert d["mios"] == [] and d["fijados"] == []
    guardar(cliente, titulo="De dos")
    assert [m["titulo"] for m in cliente.get("/api/biblioteca").json()["mios"]] == ["De dos"]
    mundo.user = "u1"
    assert [m["titulo"] for m in cliente.get("/api/biblioteca").json()["mios"]] == ["De uno"]


def test_un_pin_a_un_mio_ajeno_que_alguien_logro_escribir_no_se_muestra(cliente, mundo):
    """Defensa en profundidad: aunque la base trajera un id de otra persona en los fijados,
    GET solo muestra ids de la casa o de los «míos» de quien pregunta."""
    ajeno = guardar(cliente).json()["prompt"]["id"]
    mundo.user = "u2"
    mundo.fijados["u2"] = [ajeno, UNO]
    assert cliente.get("/api/biblioteca").json()["fijados"] == [UNO]


# ---------------------------------------------------------------------------
# todo error de la Biblioteca lleva el detail como objeto

def test_ningun_error_trae_el_detail_como_lista_o_texto(cliente, mundo):
    casos = [fijar(cliente, "mal"), guardar(cliente, titulo=""), cliente.delete("/api/biblioteca/mios/x"),
             cliente.put("/api/biblioteca/fijados", content=b"x", headers={"content-type": "application/json"})]
    for r in casos:
        assert r.status_code >= 400 and isinstance(r.json()["detail"], dict)
