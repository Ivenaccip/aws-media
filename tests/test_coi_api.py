"""Ajustes 3 — server/coi_api.py: el contrato de GET /api/coi/estado y POST /api/coi.

El modelo, la moderación y la base van con dobles (`test_coi_mundo.Mundo`): aquí se
prueba la ORQUESTACIÓN —el orden del contrato, cuándo suma y cuándo no, el candado,
los errores y sus textos—. El SQL se prueba contra un Postgres real en
test_coi_postgres.py y la ausencia de trazas en test_coi_guardianes.py. Sin red."""
import threading
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

from pipeline import coi, llm, moderacion
from test_coi_mundo import COI_ES, SECRETO, TEXTO, Mundo, cliente, esperar, mundo  # noqa: F401


def detalle(r):
    d = r.json()["detail"]
    assert isinstance(d, dict), f"el detail debe ser un objeto, no {type(d).__name__}"
    assert {"codigo", "texto"} <= set(d)
    return d


def pedir(cliente, texto=TEXTO):
    return cliente.post("/api/coi", json={"texto": texto})


# ---------------------------------------------------------------------------
# GET /api/coi/estado

def test_estado_de_quien_no_ha_usado_nada(cliente, mundo):
    r = cliente.get("/api/coi/estado")
    assert r.status_code == 200
    cuerpo = r.json()
    assert cuerpo["tope"] == 3 and cuerpo["usos"] == 0 and cuerpo["quedan"] == 3
    assert cuerpo["en_curso"] is False and cuerpo["gratis"] is True
    assert isinstance(cuerpo["renueva_en_s"], int) and 0 < cuerpo["renueva_en_s"] <= 86400
    assert cuerpo["se_renueva"].endswith("T00:00:00-06:00")
    assert set(cuerpo) == {"tope", "usos", "quedan", "renueva_en_s", "se_renueva", "en_curso", "gratis"}
    assert r.headers["cache-control"] == "no-store"


def test_estado_cuenta_los_usos_y_las_que_quedan(cliente, mundo):
    mundo.poner_usos(2)
    assert cliente.get("/api/coi/estado").json()["quedan"] == 1
    mundo.poner_usos(3)
    cuerpo = cliente.get("/api/coi/estado").json()
    assert (cuerpo["usos"], cuerpo["quedan"]) == (3, 0)


def test_estado_dice_si_hay_una_en_curso(cliente, mundo):
    mundo._coi_tomar("u1", "ajeno", 3, 60)
    assert cliente.get("/api/coi/estado").json()["en_curso"] is True


def test_estado_falla_cerrado_si_no_puede_leer_el_consumo(cliente, mundo):
    mundo.fallas["coi_estado"] = RuntimeError("Aurora no responde")
    r = cliente.get("/api/coi/estado")
    assert r.status_code == 503 and detalle(r)["codigo"] == "no_disponible"
    assert "Aurora" not in r.text


def test_renueva_en_s_es_hasta_la_proxima_medianoche_de_mexico(cliente, mundo):
    mundo.ahora = mundo.ahora.replace(hour=1, minute=0, second=0, microsecond=0)   # 19:00 del día anterior en México
    cuerpo = cliente.get("/api/coi/estado").json()
    assert cuerpo["renueva_en_s"] == 5 * 3600
    assert cuerpo["se_renueva"] == (mundo.dia() + timedelta(days=1)).strftime("%Y-%m-%dT00:00:00-06:00")


# ---------------------------------------------------------------------------
# POST /api/coi — el camino feliz y su forma

def test_camino_feliz_forma_de_la_respuesta(cliente, mundo):
    r = pedir(cliente)
    assert r.status_code == 200
    cuerpo = r.json()
    assert set(cuerpo) == {"coi", "idioma", "tope", "usos", "quedan", "renueva_en_s", "se_renueva"}
    assert set(cuerpo["coi"]) == {"contexto", "objetivo", "instrucciones", "completo", "estructura_ok"}
    assert cuerpo["coi"]["estructura_ok"] is True
    assert cuerpo["coi"]["contexto"].startswith("Eres un estratega")
    assert cuerpo["coi"]["objetivo"].startswith("Diseñar un plan")
    assert cuerpo["coi"]["instrucciones"].startswith("1. Definición")
    assert cuerpo["coi"]["completo"] == COI_ES
    assert (cuerpo["idioma"], cuerpo["tope"], cuerpo["usos"], cuerpo["quedan"]) == ("es", 3, 1, 2)
    assert r.headers["cache-control"] == "no-store"


def test_el_orden_del_contrato(cliente, mundo):
    pedir(cliente)
    assert mundo.eventos == [("estado",), ("tomar", True), ("moderar",), ("modelo",), ("sumar", 1)]


def test_la_moderacion_va_sin_trazas_y_falla_cerrado(cliente, mundo):
    pedir(cliente)
    assert mundo.llamadas_moderacion == [{"texto": TEXTO, "falla_cerrado": True, "sin_trazas": True}]


def test_al_modelo_le_llegan_las_instrucciones_del_dueno_y_solo_el_texto(cliente, mundo):
    pedir(cliente, f"  {TEXTO}  \n")
    (ll,) = mundo.llamadas_modelo
    assert ll["system"] == coi.instrucciones() and ll["user"] == TEXTO
    assert (ll["razonamiento"], ll["modelo"]) == ("minimal", coi.modelo())
    assert 0 < ll["timeout"] <= coi.PLAZO_MODELO_S and ll["max_tokens"] == coi.MAX_SALIDA_TOKENS


def test_las_variables_de_entorno_llegan_al_modelo(cliente, mundo, monkeypatch):
    monkeypatch.setenv("COI_MODELO", "otro-modelo")
    monkeypatch.setenv("COI_RAZONAMIENTO", "low")
    pedir(cliente)
    assert (mundo.llamadas_modelo[0]["modelo"], mundo.llamadas_modelo[0]["razonamiento"]) == ("otro-modelo", "low")


def test_idioma_en_ingles(cliente, mundo):
    assert pedir(cliente, "Write a prompt for my podcast about travel").json()["idioma"] == "en"


def test_sin_los_tres_encabezados_cuenta_igual_y_los_bloques_van_null(cliente, mundo):
    mundo.modelo_respuesta = "Claro, aquí tienes un resumen sin la estructura pedida."
    r = pedir(cliente)
    assert r.status_code == 200
    coi_ = r.json()["coi"]
    assert coi_["estructura_ok"] is False
    assert (coi_["contexto"], coi_["objetivo"], coi_["instrucciones"]) == (None, None, None)
    assert coi_["completo"] == mundo.modelo_respuesta
    assert r.json()["usos"] == 1 and mundo.usos() == 1      # fue una respuesta terminada


def test_tres_respuestas_y_la_cuarta_es_429(cliente, mundo):
    for n in (1, 2, 3):
        r = pedir(cliente)
        assert r.status_code == 200 and (r.json()["usos"], r.json()["quedan"]) == (n, 3 - n)
    mundo.eventos.clear()
    mundo.llamadas_moderacion.clear()
    r = pedir(cliente)
    d = detalle(r)
    assert r.status_code == 429 and d["codigo"] == "agotado"
    assert d["quedan"] == 0 and isinstance(d["renueva_en_s"], int) and d["se_renueva"].endswith("-06:00")
    assert "3" in d["texto"] and "medianoche" in d["texto"]
    assert mundo.nombres() == ["estado"]                    # ni candado, ni moderación, ni modelo
    assert len(mundo.llamadas_modelo) == 3


# ---------------------------------------------------------------------------
# validar el cuerpo: antes de tocar la base

@pytest.mark.parametrize("cuerpo,codigo,estado", [
    ({}, "vacio", 422),
    ({"texto": None}, "vacio", 422),
    ({"texto": ""}, "vacio", 422),
    ({"texto": "  \n\t "}, "vacio", 422),
    ({"texto": "a" * 2001}, "muy_largo", 422),
    ({"texto": 12}, "cuerpo", 422),
    ({"texto": ["x"]}, "cuerpo", 422),
])
def test_cuerpos_invalidos(cliente, mundo, cuerpo, codigo, estado):
    r = cliente.post("/api/coi", json=cuerpo)
    assert r.status_code == estado and detalle(r)["codigo"] == codigo
    assert mundo.eventos == []                              # no se tocó ni la base


@pytest.mark.parametrize("crudo", [b"", b"no es json", b"[1, 2]", b'"hola"', b"\xff\xfe"])
def test_cuerpo_que_no_es_un_objeto_json(cliente, mundo, crudo):
    r = cliente.post("/api/coi", content=crudo, headers={"content-type": "application/json"})
    assert r.status_code == 422 and detalle(r)["codigo"] == "cuerpo"
    assert mundo.eventos == []


def test_el_limite_son_2000_caracteres_ya_recortados(cliente, mundo):
    assert pedir(cliente, "  " + "a" * 2000 + "  ").status_code == 200
    assert detalle(pedir(cliente, "a" * 2001))["codigo"] == "muy_largo"


def test_un_cuerpo_enorme_ni_se_lee(cliente, mundo):
    r = cliente.post("/api/coi", content=b'{"texto": "' + b"a" * 70_000 + b'"}',
                     headers={"content-type": "application/json"})
    assert r.status_code == 422 and detalle(r)["codigo"] == "muy_largo"


def test_el_error_de_validacion_no_repite_lo_que_escribio_la_persona(cliente, mundo):
    r = cliente.post("/api/coi", json={"texto": SECRETO, "extra": {"x": 1}, "otro": 5})
    assert r.status_code == 200
    r = cliente.post("/api/coi", json={"texto": [SECRETO]})
    assert SECRETO not in r.text


def test_sin_clave_de_openai_no_hay_coi_y_no_se_toca_la_base(cliente, mundo, monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY")
    r = pedir(cliente)
    assert r.status_code == 503 and detalle(r)["codigo"] == "no_disponible"
    assert mundo.eventos == []


def test_en_local_sin_postgres_no_hay_coi(cliente, mundo, monkeypatch):
    from pipeline import db
    monkeypatch.setattr(db, "backend", lambda: "json")
    assert detalle(pedir(cliente))["codigo"] == "no_nube"
    assert cliente.get("/api/coi/estado").status_code == 503
    assert mundo.eventos == []


# ---------------------------------------------------------------------------
# falla cerrado: sin poder leer o escribir el consumo, no hay COI

def test_no_se_puede_leer_el_consumo(cliente, mundo):
    mundo.fallas["coi_estado"] = RuntimeError("Aurora no responde: " + TEXTO)
    r = pedir(cliente)
    assert r.status_code == 503 and detalle(r)["codigo"] == "no_disponible"
    assert mundo.llamadas_modelo == [] and mundo.llamadas_moderacion == []
    assert TEXTO not in r.text and "Aurora" not in r.text


def test_no_se_puede_tomar_el_candado(cliente, mundo):
    mundo.fallas["coi_tomar"] = RuntimeError("x")
    r = pedir(cliente)
    assert r.status_code == 503 and detalle(r)["codigo"] == "no_disponible"
    assert mundo.llamadas_modelo == []


def test_no_se_puede_sumar_la_respuesta_no_se_entrega_y_se_suelta(cliente, mundo):
    mundo.fallas["coi_sumar"] = RuntimeError("x")
    r = pedir(cliente)
    assert r.status_code == 503 and detalle(r)["codigo"] == "no_disponible"
    assert COI_ES[:20] not in r.text                         # sin contar no hay respuesta gratis
    assert mundo.usos() == 0 and not mundo.candado_puesto()  # y el candado quedó suelto


def test_el_candado_ya_no_era_nuestro_no_se_entrega_y_no_se_pisa(cliente, mundo):
    def otro_toma_el_candado():
        mundo.coi["u1"]["candado"] = "de-otro"             # caducó y otra respuesta lo tomó
    mundo.antes_de_sumar = otro_toma_el_candado
    r = pedir(cliente)
    assert r.status_code == 503 and detalle(r)["codigo"] == "no_disponible"
    assert mundo.usos() == 0
    assert mundo.coi["u1"]["candado"] == "de-otro"          # NO le soltamos el candado a la otra


def test_si_tampoco_se_puede_soltar_igual_responde_con_el_error_correcto(cliente, mundo):
    mundo.modelo_error = RuntimeError("boom")
    mundo.fallas["coi_soltar"] = RuntimeError("x")
    r = pedir(cliente)
    assert r.status_code == 502 and detalle(r)["codigo"] == "modelo"
    assert mundo.candado_puesto()                           # caducará solo a los 60 s


# ---------------------------------------------------------------------------
# una sola en curso, y el candado caduca

def test_otra_en_curso_responde_409_y_no_gasta_nada(cliente, mundo):
    mundo._coi_tomar("u1", "de-otra-pestana", 3, 60)
    mundo.eventos.clear()
    r = pedir(cliente)
    d = detalle(r)
    assert r.status_code == 409 and d["codigo"] == "en_curso"
    assert "otro COI" in d["texto"]
    assert mundo.llamadas_moderacion == [] and mundo.llamadas_modelo == []
    assert mundo.candado_puesto() and mundo.coi["u1"]["candado"] == "de-otra-pestana"   # el suyo sigue


def test_si_la_otra_suelta_el_candado_justo_despues_de_perder_se_reintenta_una_vez(cliente, mundo):
    """Perdí el candado, pero la otra respuesta falló y lo soltó antes de que yo mirara por qué:
    decir «hay otra en curso» sería mentira. Un segundo intento, y listo."""
    mundo._coi_tomar("u1", "otra", 3, 60)
    mundo.tras_tomar_fallido = lambda: mundo._coi_soltar("u1", "otra")
    mundo.eventos.clear()
    r = pedir(cliente)
    assert r.status_code == 200 and mundo.usos() == 1
    assert mundo.nombres() == ["estado", "tomar", "soltar", "estado", "tomar", "moderar", "modelo", "sumar"]


def test_si_el_segundo_intento_tambien_pierde_es_409(cliente, mundo):
    mundo._coi_tomar("u1", "otra", 3, 60)
    def relevo():
        mundo._coi_soltar("u1", "otra")
        mundo._coi_tomar("u1", "una-mas", 3, 60)          # otra pestaña se adelanta
    mundo.tras_tomar_fallido = relevo
    r = pedir(cliente)
    assert r.status_code == 409 and detalle(r)["codigo"] == "en_curso" and mundo.llamadas_modelo == []


def test_sin_sesion_la_puerta_es_401(mundo, monkeypatch):
    """Los dos APIs cuelgan de /api/: con Cognito encendido, sin token no hay nada."""
    from server import auth
    from server.app import app
    monkeypatch.setenv("COGNITO_POOL_ID", "us-east-1_prueba")
    monkeypatch.setenv("COGNITO_CLIENT_ID", "cliente")
    assert auth.activo()
    c = TestClient(app)
    for ruta in ("/api/coi/estado", "/api/biblioteca"):
        assert c.get(ruta).status_code == 401
    assert c.post("/api/coi", json={"texto": "hola"}).status_code == 401
    assert c.put("/api/biblioteca/fijados", json={"ids": []}).status_code == 401
    assert c.post("/api/biblioteca/mios", json={"titulo": "t", "prompt": "p"}).status_code == 401
    assert c.delete("/api/biblioteca/mios/mio-0123456789ab").status_code == 401
    assert mundo.eventos == []


def test_el_candado_caducado_deja_pasar(cliente, mundo):
    mundo._coi_tomar("u1", "abandonado", 3, 60)             # la Lambda murió a mitad de camino
    assert pedir(cliente).status_code == 409
    mundo.ahora += timedelta(seconds=61)
    r = pedir(cliente)
    assert r.status_code == 200 and mundo.usos() == 1


def test_el_candado_se_toma_con_el_tope_y_la_caducidad_del_contrato(cliente, mundo):
    pedir(cliente)
    assert mundo.tope_visto == [3]
    assert coi.CADUCA_CANDADO_S == 60 and coi.PLAZO_MODELO_S == 24


def test_ocho_peticiones_simultaneas_a_lo_mucho_una_en_curso(mundo):
    from server.app import app
    mundo.modelo_demora = 0.6
    estados, tope = [], threading.Barrier(8)

    def una():
        c = TestClient(app)
        tope.wait()
        estados.append(c.post("/api/coi", json={"texto": TEXTO}).status_code)

    hilos = [threading.Thread(target=una) for _ in range(8)]
    [h.start() for h in hilos]
    [h.join(30) for h in hilos]
    assert sorted(estados) == [200] + [409] * 7
    assert len(mundo.llamadas_modelo) == 1 and mundo.usos() == 1 and not mundo.candado_puesto()


def test_nunca_mas_de_tres_contadas_aunque_lleguen_en_rondas_simultaneas(mundo):
    from server.app import app
    mundo.modelo_demora = 0.15
    estados = []

    def ronda(n):
        tope, hilos = threading.Barrier(n), []

        def una():
            c = TestClient(app)
            tope.wait()
            estados.append(c.post("/api/coi", json={"texto": TEXTO}).status_code)
        hilos = [threading.Thread(target=una) for _ in range(n)]
        [h.start() for h in hilos]
        [h.join(30) for h in hilos]

    for _ in range(6):
        ronda(8)
    assert estados.count(200) == 3 and mundo.usos() == 3
    assert set(estados) <= {200, 409, 429} and len(mundo.llamadas_modelo) == 3


def test_en_el_limite_dos_simultaneas_solo_una_cuenta(mundo):
    from server.app import app
    mundo.poner_usos(2)
    mundo.modelo_demora = 0.3
    estados, tope = [], threading.Barrier(2)

    def una():
        c = TestClient(app)
        tope.wait()
        estados.append(c.post("/api/coi", json={"texto": TEXTO}).status_code)

    hilos = [threading.Thread(target=una) for _ in range(2)]
    [h.start() for h in hilos]
    [h.join(30) for h in hilos]
    assert sorted(estados)[0] == 200 and sorted(estados)[1] in (409, 429) and mundo.usos() == 3


# ---------------------------------------------------------------------------
# lo que NO suma: el modelo falla, la moderación rechaza, pasa el plazo

def _nada_sumo(mundo):
    assert mundo.usos() == 0 and not mundo.candado_puesto()
    assert ("soltar", True) in mundo.eventos
    assert not any(e[0] == "sumar" for e in mundo.eventos)


def test_el_modelo_falla(cliente, mundo):
    mundo.modelo_error = RuntimeError("503 del proveedor: " + TEXTO)
    r = pedir(cliente)
    d = detalle(r)
    assert r.status_code == 502 and d["codigo"] == "modelo"
    assert d["texto"] == "No pudimos armar tu COI ahora. No se gastó ninguno de tus usos."
    assert TEXTO not in r.text
    _nada_sumo(mundo)


def test_despues_de_un_fallo_se_puede_volver_a_intentar_y_ya_cuenta(cliente, mundo):
    mundo.modelo_error = RuntimeError("boom")
    assert pedir(cliente).status_code == 502
    mundo.modelo_error = None
    r = pedir(cliente)
    assert r.status_code == 200 and r.json()["usos"] == 1


def test_la_moderacion_rechaza(cliente, mundo):
    mundo.moderacion_veredicto = moderacion.Veredicto(
        permitido=False, motivo="Eso pide violencia explícita; cámbialo por una escena sin sangre.")
    r = pedir(cliente, f"{SECRETO} " + TEXTO)
    d = detalle(r)
    assert r.status_code == 422 and d["codigo"] == "moderacion"
    assert d["texto"] == "Eso pide violencia explícita; cámbialo por una escena sin sangre. No se gastó ninguno de tus usos."
    assert d["motivo"].startswith("Eso pide violencia")
    assert SECRETO not in r.text                                    # nunca el texto de la persona
    assert mundo.llamadas_modelo == []                              # el modelo ni se llamó
    _nada_sumo(mundo)


def test_la_moderacion_sin_motivo_usa_el_mensaje_general(cliente, mundo):
    mundo.moderacion_veredicto = moderacion.Veredicto(permitido=False, motivo="")
    d = detalle(pedir(cliente))
    assert d["texto"].startswith(moderacion.MENSAJE_BASE) and d["texto"].endswith("No se gastó ninguno de tus usos.")


def test_el_motivo_de_la_moderacion_se_acorta(cliente, mundo):
    mundo.moderacion_veredicto = moderacion.Veredicto(permitido=False, motivo="muy largo " * 200)
    assert len(detalle(pedir(cliente))["motivo"]) <= 241


def test_la_moderacion_caida_falla_cerrado_como_error_del_modelo(cliente, mundo):
    mundo.moderacion_veredicto = moderacion.Veredicto(permitido=False, caido=True)
    r = pedir(cliente)
    assert r.status_code == 502 and detalle(r)["codigo"] == "modelo"
    assert mundo.llamadas_modelo == []
    _nada_sumo(mundo)


def test_la_moderacion_revienta_no_suma_y_no_filtra_el_error(cliente, mundo):
    mundo.moderacion_error = RuntimeError("revienta " + SECRETO)
    r = pedir(cliente)
    assert r.status_code == 503 and detalle(r)["codigo"] == "no_disponible"
    assert SECRETO not in r.text
    _nada_sumo(mundo)


def test_el_modelo_pasa_su_plazo(cliente, mundo, monkeypatch):
    monkeypatch.setattr(coi, "PLAZO_MODELO_S", 0.3)
    monkeypatch.setattr(coi, "MIN_MODELO_S", 0.05)
    mundo.modelo_demora = 5
    r = pedir(cliente)
    d = detalle(r)
    assert r.status_code == 504 and d["codigo"] == "tardo" and "No se gastó ninguno" in d["texto"]
    _nada_sumo(mundo)


@pytest.mark.parametrize("nombre", ["APITimeoutError", "ReadTimeout"])
def test_el_timeout_del_sdk_tambien_es_tardo(cliente, mundo, nombre):
    mundo.modelo_error = type(nombre, (Exception,), {})("se acabó el tiempo")
    r = pedir(cliente)
    assert r.status_code == 504 and detalle(r)["codigo"] == "tardo"
    _nada_sumo(mundo)


def test_la_moderacion_pasa_su_plazo(cliente, mundo, monkeypatch):
    monkeypatch.setattr(coi, "PLAZO_MODERACION_S", 0.2)
    mundo.moderacion_demora = 5
    r = pedir(cliente)
    assert r.status_code == 504 and detalle(r)["codigo"] == "tardo"
    assert mundo.llamadas_modelo == []
    _nada_sumo(mundo)


def test_si_no_queda_tiempo_para_el_modelo_ni_se_llama(cliente, mundo, monkeypatch):
    monkeypatch.setattr(coi, "PRESUPUESTO_S", 0.5)
    monkeypatch.setattr(coi, "MIN_MODELO_S", 4)
    r = pedir(cliente)
    assert r.status_code == 504 and mundo.llamadas_modelo == []
    _nada_sumo(mundo)


def test_el_plazo_del_modelo_nunca_pasa_de_lo_que_resta_del_presupuesto(cliente, mundo, monkeypatch):
    monkeypatch.setattr(coi, "PRESUPUESTO_S", 6.0)
    mundo.moderacion_demora = 0.5
    pedir(cliente)
    assert mundo.llamadas_modelo[0]["timeout"] < 6.0 - 0.4


@pytest.mark.parametrize("respuesta,uso", [
    ("", {"fin": "stop"}),
    ("   \n", {"fin": "stop"}),
    ("#CONTEXTO\na\n#OBJETIVO\nb\n#INSTRUCCIONES\nc", {"fin": "length"}),     # cortada por el tope de tokens
])
def test_respuesta_vacia_o_cortada_no_es_una_respuesta_terminada(cliente, mundo, respuesta, uso):
    mundo.modelo_respuesta, mundo.modelo_uso = respuesta, {**mundo.modelo_uso, **uso}
    r = pedir(cliente)
    assert r.status_code == 502 and detalle(r)["codigo"] == "modelo"
    _nada_sumo(mundo)


def test_clave_faltante_a_mitad_de_camino_es_no_disponible(cliente, mundo):
    mundo.modelo_error = llm.ClaveFaltante("falta")
    r = pedir(cliente)
    assert r.status_code == 503 and detalle(r)["codigo"] == "no_disponible"
    _nada_sumo(mundo)


def test_las_instrucciones_que_no_se_pueden_leer_son_no_disponible_y_no_suman(cliente, mundo, monkeypatch):
    def revienta():
        raise FileNotFoundError("prompts/coi_system.md")
    monkeypatch.setattr(coi, "instrucciones", revienta)
    r = pedir(cliente)
    assert r.status_code == 503 and detalle(r)["codigo"] == "no_disponible"
    assert "coi_system" not in r.text
    _nada_sumo(mundo)


# ---------------------------------------------------------------------------
# el día de México

def test_el_cambio_de_dia_reinicia_el_contador_en_1(cliente, mundo):
    mundo.poner_usos(3, dia=mundo.dia() - timedelta(days=1))        # ayer usó las 3
    assert cliente.get("/api/coi/estado").json()["quedan"] == 3
    r = pedir(cliente)
    assert r.status_code == 200 and (r.json()["usos"], r.json()["quedan"]) == (1, 2)
    assert mundo.coi["u1"]["dia"] == mundo.dia()


def test_si_el_dia_cambia_mientras_responde_la_suma_cae_en_el_dia_nuevo(cliente, mundo):
    mundo.poner_usos(2)
    mundo.antes_de_sumar = lambda: setattr(mundo, "ahora", mundo.ahora + timedelta(days=1))
    r = pedir(cliente)
    assert r.status_code == 200 and r.json()["usos"] == 1


def test_a_las_6_de_la_tarde_en_mexico_no_se_renueva_es_la_medianoche_de_mexico(cliente, mundo):
    """El día NO es el de UTC: a las 00:30 UTC todavía es el día anterior en México."""
    mundo.ahora = mundo.ahora.replace(hour=0, minute=30, second=0, microsecond=0)
    pedir(cliente)
    assert mundo.coi["u1"]["dia"] == (mundo.ahora - timedelta(hours=6)).date() != mundo.ahora.date()


# ---------------------------------------------------------------------------
# aislamiento entre personas

def test_el_tope_y_el_candado_son_de_cada_persona(cliente, mundo):
    for _ in range(3):
        assert pedir(cliente).status_code == 200
    assert pedir(cliente).status_code == 429
    mundo.user = "u2"
    assert cliente.get("/api/coi/estado").json()["usos"] == 0
    assert pedir(cliente).status_code == 200
    mundo.user = "u1"
    assert mundo.usos("u1") == 3 and mundo.usos("u2") == 1


def test_la_en_curso_de_una_persona_no_bloquea_a_otra(cliente, mundo):
    mundo._coi_tomar("u1", "pestana", 3, 60)
    mundo.user = "u2"
    assert pedir(cliente).status_code == 200


# ---------------------------------------------------------------------------
# lo que va al log: solo números

def test_el_log_de_una_respuesta_lleva_modelo_tokens_ms_y_costo(cliente, mundo, monkeypatch, caplog):
    from pipeline import costos_rag
    monkeypatch.setattr(costos_rag, "precios", lambda: {
        "modelo-de-prueba": {"entrada": 0.25, "cache_leida": 0.025, "salida": 2.0}})
    caplog.set_level("DEBUG")
    pedir(cliente)
    linea = next(r.getMessage() for r in caplog.records if r.name == "coi_api")
    assert "modelo=modelo-de-prueba" in linea and "entrada=1500" in linea and "salida=700" in linea
    assert "en_cache=1000" in linea and "ms=" in linea
    esperado = (500 * 0.25 + 1000 * 0.025 + 700 * 2.0) / 1e6
    assert f"costo_usd={esperado}" in linea or f"costo_usd={round(esperado, 6)}" in linea


def test_el_costo_sin_tarifa_se_loguea_como_none_no_inventado(cliente, mundo, caplog):
    caplog.set_level("DEBUG")
    pedir(cliente)
    assert "costo_usd=None" in next(r.getMessage() for r in caplog.records if r.name == "coi_api")


@pytest.mark.parametrize("escenario", ["feliz", "modelo_falla", "moderacion_revienta", "moderacion_rechaza",
                                       "tardo", "sumar_falla", "estado_falla", "agotado", "en_curso"])
def test_ningun_log_lleva_el_texto_de_la_persona_ni_la_respuesta(cliente, mundo, caplog, monkeypatch, escenario):
    texto = f"{SECRETO} " + TEXTO
    mundo.modelo_respuesta = COI_ES.replace("estratega", "ESTRATEGA-" + SECRETO)
    if escenario == "modelo_falla":
        mundo.modelo_error = RuntimeError("eco: " + texto)
    elif escenario == "moderacion_revienta":
        mundo.moderacion_error = RuntimeError("eco: " + texto)
    elif escenario == "moderacion_rechaza":
        mundo.moderacion_veredicto = moderacion.Veredicto(permitido=False, motivo="no pasa")
    elif escenario == "tardo":
        monkeypatch.setattr(coi, "PLAZO_MODELO_S", 0.2)
        monkeypatch.setattr(coi, "MIN_MODELO_S", 0.05)
        mundo.modelo_demora = 3
    elif escenario == "sumar_falla":
        mundo.fallas["coi_sumar"] = RuntimeError("eco: " + texto)
    elif escenario == "estado_falla":
        mundo.fallas["coi_estado"] = RuntimeError("eco: " + texto)
    elif escenario == "agotado":
        mundo.poner_usos(3)
    elif escenario == "en_curso":
        mundo._coi_tomar("u1", "otra", 3, 60)
    caplog.set_level("DEBUG")
    pedir(cliente, texto)
    todo = " ".join(r.getMessage() + " " + str(r.args) + " " + (r.exc_text or "") for r in caplog.records)
    assert SECRETO not in todo and "ESTRATEGA" not in todo and "plan de contenido" not in todo
    assert not any(r.exc_info for r in caplog.records)             # ningún traceback (arrastra el mensaje del error)


def test_la_peticion_se_loguea_sin_cuerpo_ni_query(cliente, mundo, caplog):
    caplog.set_level("DEBUG")
    cliente.post("/api/coi?x=" + SECRETO, json={"texto": TEXTO})
    peticiones = [r.getMessage() for r in caplog.records if r.name == "peticiones"]
    assert peticiones and all(SECRETO not in p and "plan de contenido" not in p for p in peticiones)
