"""E2 — `POST /api/edicion/iniciar`: copia, cobro y lanzamiento. LO MÁS DELICADO: dinero.

Cobrar dos veces, cobrar y no devolver, cobrar sin lanzar, cobrar lo que no se
cotizó. Cada camino de fallo devuelve los créditos y esta prueba lo comprueba
contra un monedero en memoria (`test_e2_mundo.Mundo`) cuyo libro mayor dice lo
que de verdad se pagó.

El orden de los eventos ES el contrato: reservar sin apartar → resolver
(medir) → mirar si hay otra corrida → reservar → candado (INSERT de la copia) →
cobrar → anotar el cobro → lanzar. Quien cambie el orden rompe la lista.
"""
import json
import threading

import pytest
from fastapi.testclient import TestClient

from pipeline import creditos, jobs
from server import edicion_api
from test_e2_mundo import (INSTRUCCION, PEDIDO, PEDIDO_2, ahora_iso, cliente, mundo,  # noqa: F401
                           tarifa)

CLIP = "clip-20261008-101500-ab12cd"
REF_DINERO = "editar-sugerir:ed-9f1c0a7b"
TEXTO_OCUPADO = "Ya hay un trabajo en curso. Cuando termine puedes empezar otro."


def iniciar(cliente, mundo, *refs, **kw):
    return cliente.post("/api/edicion/iniciar", json=mundo.cuerpo(*refs, **kw))


def tres_videos(mundo):
    """Una película con transcript, un clip y una subida cruda de 12:04."""
    mundo.pelicula("1a2b3c4d", "El tren de papel", dur=30.04)
    mundo.clip(CLIP, "Perro en la playa")
    mundo.subida("entrevista-final", dur=724.0)
    return ["proyecto:gen-1a2b3c4d", f"clip:{CLIP}", "proyecto:entrevista-final"]


def dos_cortos(mundo):
    """Dos videos de menos de un minuto que ya traen transcript: se unen por solo la edición."""
    mundo.subida("a", dur=20.0, canonico=True)
    mundo.subida("b", dur=15.0, canonico=True)
    return ["proyecto:a", "proyecto:b"]


def sin_efectos(mundo):
    """Nada se cobró, ni se lanzó, ni quedó una copia."""
    assert not [e for e in mundo.eventos if e[0] in ("cobrar", "lanzar", "crear")]
    assert mundo.libro == [] and "ed-9f1c0a7b" not in mundo.docs()


# ---------------------------------------------------------------------------
# el camino feliz y su orden

def test_el_orden_es_el_contrato(cliente, mundo):
    mundo.subida("charla", dur=300.0, canonico=True, bytes_=1_000_000)
    r = iniciar(cliente, mundo, "proyecto:charla")
    assert r.status_code == 200, r.text
    util = [e for e in mundo.eventos if e[0] in ("reservar", "cargar", "medir", "corriendo", "crear",
                                                 "cobrar", "fijar", "lanzar")]
    assert util == [
        ("reservar", "ed-9f1c0a7b", False),             # 3 · el nombre, sin apartarlo todavía
        ("cargar", "ed-9f1c0a7b"),                      # 4 · ¿ya existe? (idempotencia)
        ("cargar", "charla"),                           # 5 · resolver: identificar...
        ("medir", "videos/charla/subidas/charla.mp4"),  #     ...y medir
        ("fijar", "charla", "meta"),                    #     (la caché de la medición)
        ("corriendo",),                                 # 6 · ¿hay otra corrida?
        ("reservar", "ed-9f1c0a7b", True),              # 8 · ahora sí se aparta
        ("crear", "ed-9f1c0a7b"),                       # 9 · el candado: el INSERT, ANTES de cobrar
        ("corriendo",),                                 # 9b · insertar y LUEGO mirar: ¿entró otra pestaña también?
        ("cobrar", tarifa("edicion"), REF_DINERO),      # 10 · cobrar
        ("fijar", "ed-9f1c0a7b", "editar", "corriendo", True),    # 11 · anotar el cobro
        ("lanzar", "ed-9f1c0a7b"),                      # 12 · lanzar
    ]


def test_la_respuesta_y_el_documento_de_la_copia(cliente, mundo):
    refs = tres_videos(mundo)
    r = iniciar(cliente, mundo, *refs)
    n = tarifa("edicion") + tarifa("transcripcion") * 3
    assert r.status_code == 200 and r.json() == {
        "lanzado": True, "nombre": "ed-9f1c0a7b", "titulo": "El tren de papel + 2 más",
        "creditos": n, "n_videos": 3, "repetido": False}
    doc = mundo.docs()["ed-9f1c0a7b"]
    assert doc["titulo"] == "El tren de papel + 2 más"
    # REGLA CRÍTICA (K-08): la copia no se parece a una película
    assert doc["subidas"] == [] and "origen" not in doc and "generado" not in doc.get("flags", {})
    assert doc["copia"]["version"] == 1
    assert doc["copia"]["de"] == [
        {"orden": 1, "ref": refs[0], "tipo": "pelicula", "titulo": "El tren de papel", "clip_id": "c01"},
        {"orden": 2, "ref": refs[1], "tipo": "clip", "titulo": "Perro en la playa", "clip_id": "c02"},
        {"orden": 3, "ref": refs[2], "tipo": "edicion", "titulo": "entrevista-final", "clip_id": "c03"}]
    e = doc["editar"]
    assert (e["copia"], e["estado"], e["paso"], e["cobrado"], e["creditos"], e["pedido"]) == (
        True, "corriendo", "entender", True, n, PEDIDO)
    assert e["desglose"] == {"edicion": tarifa("edicion"), "transcripcion": tarifa("transcripcion") * 3}
    assert (e["instruccion"], e["n_videos"], e["formato"], e["fin"]) == (INSTRUCCION, 3, "horizontal", None)
    assert e["duracion_entrada_s"] == round(30.04 + 8.0 + 724.0, 3)
    assert mundo.saldos["u1"] == 100 - n and mundo.neto(REF_DINERO) == n


def test_las_fuentes_que_lee_el_worker(cliente, mundo):
    refs = tres_videos(mundo)
    mundo.s3["videos/entrevista-final/work/audio/entrevista-final.wav"] = "x"
    iniciar(cliente, mundo, *refs)
    f = mundo.docs()["ed-9f1c0a7b"]["editar"]["fuentes"]
    assert [x["clip_id"] for x in f] == ["c01", "c02", "c03"] and [x["orden"] for x in f] == [1, 2, 3]
    assert f[0] == {
        "orden": 1, "clip_id": "c01", "ref": refs[0], "tipo": "pelicula", "titulo": "El tren de papel",
        "origen_key": "videos/gen-1a2b3c4d/pelicula.mp4", "ext": ".mp4",
        "canonico_key": "videos/gen-1a2b3c4d/work/transcripts/pelicula.canonical.json", "wav_key": None,
        "bytes": 11_534_336, "duracion_s": 30.04, "ancho": 1280, "alto": 720, "audio": True,
        "con_transcript": True, "transcribir": False}
    assert f[1]["origen_key"] == f"usuarios/u1/clips/{CLIP}.mp4" and f[1]["canonico_key"] is None
    assert f[1]["transcribir"] is False and f[1]["tipo"] == "clip"
    assert f[2]["origen_key"] == "videos/entrevista-final/subidas/entrevista-final.mp4"
    assert f[2]["transcribir"] is True and f[2]["con_transcript"] is False
    assert f[2]["wav_key"] == "videos/entrevista-final/work/audio/entrevista-final.wav"


def test_el_orden_de_los_videos_es_el_de_la_lista(cliente, mundo):
    refs = tres_videos(mundo)
    iniciar(cliente, mundo, *reversed(refs))
    de = mundo.docs()["ed-9f1c0a7b"]["copia"]["de"]
    assert [d["ref"] for d in de] == list(reversed(refs)) and [d["clip_id"] for d in de] == ["c01", "c02", "c03"]
    assert mundo.docs()["ed-9f1c0a7b"]["titulo"] == "entrevista-final + 2 más"


def test_el_precio_es_el_del_servidor_aunque_el_cuerpo_diga_otra_cosa(cliente, mundo):
    mundo.subida("charla", dur=724.0)
    r = iniciar(cliente, mundo, "proyecto:charla", creditos=0, precio=0, costo=0, duracion_s=1,
                key="videos/otro/subidas/x.mp4", formato="vertical")
    esperado = tarifa("edicion") + tarifa("transcripcion") * 3
    assert r.status_code == 200 and r.json()["creditos"] == esperado
    assert mundo.neto(REF_DINERO) == esperado == creditos.costo_editar([724.0])


def test_se_cobra_lo_que_cotizar_dijo(cliente, mundo):
    refs = tres_videos(mundo)
    cot = cliente.post("/api/edicion/cotizar", json={"videos": refs}).json()
    r = iniciar(cliente, mundo, *refs)
    assert r.json()["creditos"] == cot["creditos"] == mundo.neto(REF_DINERO)


def test_la_instruccion_se_guarda_limpia(cliente, mundo):
    mundo.subida("charla", dur=300.0, canonico=True)
    iniciar(cliente, mundo, "proyecto:charla", instruccion="  Quita​ los silencios\u0007  ")
    assert mundo.docs()["ed-9f1c0a7b"]["editar"]["instruccion"] == "Quita los silencios"


def test_el_original_nunca_se_escribe(cliente, mundo):
    refs = tres_videos(mundo)
    antes = json.dumps({k: v for k, v in mundo.docs().items()}, sort_keys=True)
    iniciar(cliente, mundo, *refs)
    despues = {k: v for k, v in mundo.docs().items() if not k.startswith("ed-")}
    for d in despues.values():
        d.pop("meta", None)                      # la caché de la medición es lo único que se añade
    antes_sin_meta = {k: v for k, v in json.loads(antes).items()}
    for d in antes_sin_meta.values():
        d.pop("meta", None)
    assert despues == antes_sin_meta
    # y nada más se escribió fuera de la copia, salvo esa caché
    for e in mundo.eventos:
        if e[0] in ("fijar", "crear", "borrar", "reclamar"):
            assert e[1] == "ed-9f1c0a7b" or (e[0] == "fijar" and e[2] == "meta")


def test_sin_monedero_se_lanza_sin_cobrar(cliente, mundo, monkeypatch):
    monkeypatch.setattr(creditos, "activo", lambda: False)
    mundo.subida("charla", dur=300.0, canonico=True)
    assert iniciar(cliente, mundo, "proyecto:charla").status_code == 200
    assert mundo.libro == [] and ("lanzar", "ed-9f1c0a7b") in mundo.eventos


def test_el_nombre_no_choca_con_el_de_otra_cuenta(cliente, mundo):
    mundo.docs("u2")["ed-9f1c0a7b"] = {}
    mundo.nombres["ed-9f1c0a7b"] = "u2"
    mundo.subida("charla", dur=300.0, canonico=True)
    r = iniciar(cliente, mundo, "proyecto:charla").json()
    assert r["nombre"].startswith("ed-9f1c0a7b-") and r["nombre"] in mundo.docs()
    # y repetir el mismo pedido da la misma copia
    assert iniciar(cliente, mundo, "proyecto:charla").json()["nombre"] == r["nombre"]


# ---------------------------------------------------------------------------
# todo lo validable, ANTES de cobrar

@pytest.mark.parametrize("armar,estado", [
    (lambda m: (m.subida("c", dur=59.96), ["proyecto:c"])[1], 422),                      # corto_solo
    (lambda m: (m.subida("l", dur=5401.0), ["proyecto:l"])[1], 413),                     # larga
    (lambda m: (m.subida("a", dur=2000.0), m.subida("b", dur=2000.0), m.subida("c", dur=2000.0),
                ["proyecto:a", "proyecto:b", "proyecto:c"])[3], 413),                    # total_largo
    (lambda m: (m.subida("h", dur=30.0), m.subida("v", dur=30.0, ancho=720, alto=1280),
                ["proyecto:h", "proyecto:v"])[2], 422),                                  # formatos_distintos
    (lambda m: (m.subida("p", dur=30.0, bytes_=16 * 1024**3), ["proyecto:p"])[1], 413),  # muy_pesado
    (lambda m: (m.subida("a", dur=30.0), ["proyecto:a", "proyecto:a"])[1], 422),         # repetido
    (lambda m: (m.copia("ed-1", "Copia"), ["proyecto:ed-1"])[1], 422),                   # es_copia
    (lambda m: (m.docs().__setitem__("v", {"subidas": []}), ["proyecto:v"])[1], 422),    # sin_metraje
    (lambda m: (m.subida("r", dur=30.0), m.medidas.__setitem__("videos/r/subidas/r.mp4", None),
                ["proyecto:r"])[2], 502),                                                # no_se_pudo_medir
    (lambda m: ["proyecto:no_existe"], 404),                                             # no_encontrado
    (lambda m: (m.subida("ajeno", dur=300.0, user="u2"), ["proyecto:ajeno"])[1], 404),   # R12
    (lambda m: [], 422),                                                                 # sin_videos
])
def test_cada_regla_corta_antes_de_cobrar(cliente, mundo, armar, estado):
    refs = armar(mundo)
    r = iniciar(cliente, mundo, *refs)
    assert r.status_code == estado, r.text
    sin_efectos(mundo)
    assert mundo.nombres.get("ed-9f1c0a7b") is None          # ni siquiera se apartó el nombre


def test_demasiados_videos_cortan_antes_de_cobrar(cliente, mundo):
    refs = []
    for i in range(13):
        mundo.subida(f"v{i}", dur=20.0)
        refs.append(f"proyecto:v{i}")
    r = iniciar(cliente, mundo, *refs)
    assert r.status_code == 422 and r.json()["detail"] == "Puedes unir hasta 12 videos a la vez."
    sin_efectos(mundo)
    assert mundo.eventos == []              # el tope de cantidad se mira ANTES de apartar el nombre (paso 2)


def test_sin_clave_de_transcripcion_es_503_y_no_cobra(cliente, mundo, monkeypatch):
    monkeypatch.delenv("ASSEMBLYAI_API_KEY")
    mundo.subida("cruda", dur=300.0)
    r = iniciar(cliente, mundo, "proyecto:cruda")
    assert r.status_code == 503 and r.json()["detail"].startswith("Todavía no podemos transcribir")
    sin_efectos(mundo)


def test_los_textos_de_los_rechazos_son_los_del_catalogo(cliente, mundo):
    mundo.subida("c", dur=30.0)
    assert iniciar(cliente, mundo, "proyecto:c").json()["detail"] == (
        "Un video de menos de 1 min no se puede editar solo. Agrega otro para unirlos, o sube uno de 1 a 90 min.")
    assert iniciar(cliente, mundo, "proyecto:fantasma").json()["detail"] == (
        "No encontramos uno de los videos entre los tuyos. Recarga la lista e inténtalo de nuevo.")


@pytest.mark.parametrize("instruccion,texto", [
    ("", "Cuéntale a la IA qué quieres hacer con tus videos."),
    ("   \n  ", "Cuéntale a la IA qué quieres hacer con tus videos."),
    ("​‍⁠", "Cuéntale a la IA qué quieres hacer con tus videos."),     # solo invisibles
    (None, "Cuéntale a la IA qué quieres hacer con tus videos."),
    ("x" * 2001, None), (123, "La instrucción debe ser texto"), (["a"], "La instrucción debe ser texto"),
])
def test_la_instruccion_es_obligatoria_y_se_valida_antes_de_reservar_nada(cliente, mundo, instruccion, texto):
    mundo.subida("charla", dur=300.0, canonico=True)
    r = iniciar(cliente, mundo, "proyecto:charla", instruccion=instruccion)
    assert r.status_code == 422
    if texto:
        assert r.json()["detail"] == texto
    assert mundo.eventos == [] and mundo.libro == []


def test_sin_instruccion_en_el_cuerpo_tambien_es_422(cliente, mundo):
    mundo.subida("charla", dur=300.0, canonico=True)
    r = cliente.post("/api/edicion/iniciar", json={"pedido": PEDIDO, "videos": ["proyecto:charla"]})
    assert r.status_code == 422 and mundo.eventos == []


@pytest.mark.parametrize("pedido", [None, "", "abc", "9F1C0A7B4D2E4F6A8B3C1D5E7F9A0B2C",
                                    "9f1c0a7b-4d2e-4f6a-8b3c-1d5e7f9a0b2c", "z" * 32, "9f1c0a7b4d2e4f6a8b3c1d5e7f9a0b2", 12])
def test_un_pedido_malo_es_422_antes_de_todo(cliente, mundo, pedido):
    mundo.subida("charla", dur=300.0, canonico=True)
    r = cliente.post("/api/edicion/iniciar", json={"pedido": pedido, "videos": ["proyecto:charla"],
                                                   "instruccion": INSTRUCCION})
    assert r.status_code == 422
    assert r.json()["detail"] == "Falta la clave del pedido. Recarga la página e inténtalo de nuevo."
    assert mundo.eventos == []


@pytest.mark.parametrize("ref", ["videos/gen-1/subidas/x.mp4", "proyecto:../x", "clip:malo", "otra cosa"])
def test_una_key_de_s3_en_la_lista_es_422_y_no_toca_nada(cliente, mundo, ref):
    r = iniciar(cliente, mundo, ref)
    assert r.status_code == 422 and mundo.eventos == []


def test_un_cuerpo_que_no_es_un_objeto_es_422(cliente, mundo):
    assert cliente.post("/api/edicion/iniciar", json=[1, 2]).status_code == 422
    assert cliente.post("/api/edicion/iniciar").status_code == 422
    assert mundo.eventos == []


def test_en_local_es_503(cliente, mundo, monkeypatch):
    from pipeline import db
    monkeypatch.setattr(db, "backend", lambda: "json")
    r = iniciar(cliente, mundo, "proyecto:a")
    assert r.status_code == 503 and "clean-cut" in r.json()["detail"] and mundo.eventos == []


# ---------------------------------------------------------------------------
# el saldo

def test_sin_saldo_es_402_borra_la_copia_y_no_lanza(cliente, mundo):
    mundo.saldos["u1"] = 1
    refs = dos_cortos(mundo)
    r = iniciar(cliente, mundo, *refs)
    assert r.status_code == 402
    assert r.json()["detail"] == (f"Créditos insuficientes: esta acción cuesta {tarifa('edicion')} créditos "
                                  "y tu saldo es 1.")
    nombres = [e[0] for e in mundo.eventos]
    assert "crear" in nombres and "borrar" in nombres and "lanzar" not in nombres
    assert nombres.index("crear") < nombres.index("borrar")
    assert mundo.libro == [] and mundo.saldos["u1"] == 1 and "ed-9f1c0a7b" not in mundo.docs()


def test_despues_del_402_la_persona_puede_volver_a_intentar_con_el_mismo_pedido(cliente, mundo):
    mundo.saldos["u1"] = 0
    refs = dos_cortos(mundo)
    assert iniciar(cliente, mundo, *refs).status_code == 402
    mundo.saldos["u1"] = 50                                   # recargó
    r = iniciar(cliente, mundo, *refs)
    assert r.status_code == 200 and r.json()["repetido"] is False
    assert mundo.neto(REF_DINERO) == tarifa("edicion")


def test_el_402_no_deja_la_puerta_cerrada_para_otro_intento(cliente, mundo):
    """El candado se suelta: una copia sin cobrar no bloquea a la persona."""
    mundo.saldos["u1"] = 0
    refs = dos_cortos(mundo)
    iniciar(cliente, mundo, *refs)
    mundo.saldos["u1"] = 50
    assert iniciar(cliente, mundo, *refs, pedido=PEDIDO_2).status_code == 200


# ---------------------------------------------------------------------------
# idempotencia (R20)

def test_repetir_el_mismo_pedido_cobra_una_sola_vez(cliente, mundo):
    refs = dos_cortos(mundo)
    primera = iniciar(cliente, mundo, *refs).json()
    mundo.eventos.clear()
    segunda = iniciar(cliente, mundo, *refs)
    assert segunda.status_code == 200
    assert segunda.json() == {**primera, "repetido": True}
    assert [e for e in mundo.eventos if e[0] in ("cobrar", "lanzar", "crear", "medir", "corriendo")] == []
    assert len([m for m in mundo.libro if m["tipo"] == "cargo"]) == 1


def test_repetir_el_pedido_de_una_copia_terminada_devuelve_la_misma(cliente, mundo):
    refs = dos_cortos(mundo)
    iniciar(cliente, mundo, *refs)
    mundo.docs()["ed-9f1c0a7b"]["editar"]["estado"] = "listo"
    r = iniciar(cliente, mundo, *refs)
    assert r.status_code == 200 and r.json()["repetido"] is True and len(mundo.libro) == 1


def test_repetir_el_pedido_de_una_copia_que_fallo_es_409(cliente, mundo):
    refs = dos_cortos(mundo)
    iniciar(cliente, mundo, *refs)
    mundo.docs()["ed-9f1c0a7b"]["editar"]["estado"] = "error"
    r = iniciar(cliente, mundo, *refs)
    assert r.status_code == 409
    assert r.json()["detail"] == ("Esta edición ya falló y se te devolvió lo cobrado. "
                                  "Pulsa Iniciar otra vez para empezar de nuevo.")
    assert len(mundo.libro) == 1                        # no cobra


def test_un_pedido_nuevo_tras_el_error_empieza_de_cero(cliente, mundo):
    refs = dos_cortos(mundo)
    iniciar(cliente, mundo, *refs)
    d = mundo.docs()["ed-9f1c0a7b"]["editar"]
    d.update(estado="error")
    r = iniciar(cliente, mundo, *refs, pedido=PEDIDO_2)
    assert r.status_code == 200 and r.json()["nombre"] == "ed-aaaaaaaa" and r.json()["repetido"] is False
    assert len([m for m in mundo.libro if m["tipo"] == "cargo"]) == 2


def test_la_misma_copia_con_otro_pedido_de_igual_prefijo_es_409_sin_cobrar(cliente, mundo):
    """Colisión de los 8 primeros hex con una copia ya hecha: no es la misma petición."""
    refs = dos_cortos(mundo)
    iniciar(cliente, mundo, *refs)
    mundo.docs()["ed-9f1c0a7b"]["editar"]["estado"] = "listo"
    otro = "9f1c0a7b" + "0" * 24
    r = iniciar(cliente, mundo, *refs, pedido=otro)
    assert r.status_code == 409 and r.json()["detail"] == TEXTO_OCUPADO
    assert len(mundo.libro) == 1


def test_dos_peticiones_simultaneas_con_el_mismo_pedido_cobran_una_vez(mundo):
    from server.app import app
    refs = dos_cortos(mundo)
    resp = []

    def llamar():
        c = TestClient(app)
        resp.append(c.post("/api/edicion/iniciar", json=mundo.cuerpo(*refs)))
    hilos = [threading.Thread(target=llamar) for _ in range(6)]
    for h in hilos:
        h.start()
    for h in hilos:
        h.join()
    assert sorted(r.status_code for r in resp) == [200] * 6
    assert sorted(r.json()["repetido"] for r in resp).count(False) == 1
    assert len([m for m in mundo.libro if m["tipo"] == "cargo"]) == 1
    assert len([e for e in mundo.eventos if e[0] == "lanzar"]) == 1


def _con_gemela_en(mundo, monkeypatch, donde):
    """Hace que una llamada GEMELA (mismo pedido) termine entera justo después de `donde`
    (`resolver` o `corriendo`), o sea, en la ventana que las pruebas con hilos casi nunca
    alcanzan. Devuelve la respuesta de la gemela."""
    from server.app import app
    refs = dos_cortos(mundo)
    gemela = {}

    def lanzar_gemela():
        if not gemela:
            gemela["lanzada"] = True          # antes de llamar: la gemela pasa por este mismo gancho
            gemela["r"] = TestClient(app).post("/api/edicion/iniciar", json=mundo.cuerpo(*refs))
    if donde == "resolver":
        original = edicion_api._resolver
        monkeypatch.setattr(edicion_api, "_resolver",
                            lambda *a, **k: (lambda r: (lanzar_gemela(), r)[1])(original(*a, **k)))
    else:
        from pipeline import db
        original = db.ediciones_corriendo
        monkeypatch.setattr(db, "ediciones_corriendo",
                            lambda u: (lambda r: (lanzar_gemela(), r)[1])(original(u)))
    r = TestClient(app).post("/api/edicion/iniciar", json=mundo.cuerpo(*refs))
    return r, gemela["r"]


def test_la_gemela_que_gana_entre_mi_lectura_y_el_candado_me_da_la_primera_respuesta(mundo, monkeypatch):
    """La gemela toma el candado DESPUÉS de que yo miré si la copia existía: al llegar a «¿hay otra
    corrida?» la veo corriendo, y es mía (mismo pedido), no una ajena que me ocupe."""
    r, gemela = _con_gemela_en(mundo, monkeypatch, "resolver")
    assert gemela.status_code == 200 and gemela.json()["repetido"] is False
    assert r.status_code == 200, r.text
    assert r.json() == {**gemela.json(), "repetido": True}
    assert len([m for m in mundo.libro if m["tipo"] == "cargo"]) == 1
    assert len([e for e in mundo.eventos if e[0] == "lanzar"]) == 1


def test_la_gemela_que_gana_entre_la_lectura_de_ocupado_y_el_insert_tambien(mundo, monkeypatch):
    """Ahora la ventana es la del INSERT: `crear_copia_editor` dice que no insertó porque ya existe."""
    r, gemela = _con_gemela_en(mundo, monkeypatch, "corriendo")
    assert gemela.status_code == 200 and gemela.json()["repetido"] is False
    assert r.status_code == 200, r.text
    assert r.json() == {**gemela.json(), "repetido": True}
    assert len([m for m in mundo.libro if m["tipo"] == "cargo"]) == 1
    assert len([e for e in mundo.eventos if e[0] == "lanzar"]) == 1


def test_dos_pestanas_con_pedidos_distintos_una_gana_y_la_otra_es_409_sin_cobrar(mundo):
    from server.app import app
    refs = dos_cortos(mundo)
    resp = []

    def llamar(pedido):
        resp.append(TestClient(app).post("/api/edicion/iniciar", json=mundo.cuerpo(*refs, pedido=pedido)))
    hilos = [threading.Thread(target=llamar, args=(p,)) for p in (PEDIDO, PEDIDO_2, "b" * 32, "c" * 32)]
    for h in hilos:
        h.start()
    for h in hilos:
        h.join()
    assert sorted(r.status_code for r in resp) == [200, 409, 409, 409]
    assert len([m for m in mundo.libro if m["tipo"] == "cargo"]) == 1       # UN solo cargo
    assert len([e for e in mundo.eventos if e[0] == "lanzar"]) == 1
    assert {r.json()["detail"] for r in resp if r.status_code == 409} == {TEXTO_OCUPADO}


# ---------------------------------------------------------------------------
# ocupado (R8): por lectura Y por el índice

def test_otra_corrida_en_marcha_es_409_sin_cobrar(cliente, mundo):
    mundo.copia("ed-otra", "Otra", estado="corriendo")
    refs = dos_cortos(mundo)
    r = iniciar(cliente, mundo, *refs)
    assert r.status_code == 409 and r.json()["detail"] == TEXTO_OCUPADO
    sin_efectos_cobro = [e for e in mundo.eventos if e[0] in ("cobrar", "lanzar", "crear")]
    assert sin_efectos_cobro == [] and mundo.libro == []


def test_una_corrida_vieja_de_e1_en_marcha_tambien_ocupa(cliente, mundo):
    mundo.subida("e1", dur=300.0)
    mundo.docs()["e1"]["editar"] = {"estado": "corriendo", "inicio": ahora_iso(-30), "creditos": 4}
    refs = dos_cortos(mundo)
    assert iniciar(cliente, mundo, *refs).status_code == 409


def test_si_la_lectura_no_la_ve_el_indice_la_frena_sin_cobrar(cliente, mundo, monkeypatch):
    """Dos pestañas leen «nada corriendo» a la vez: el INSERT del segundo no inserta (índice parcial)."""
    refs = dos_cortos(mundo)
    mundo.copia("ed-otra", "Otra", estado="corriendo")
    vistas = []
    original = mundo._corriendo
    monkeypatch.setattr("pipeline.db.ediciones_corriendo", lambda u: vistas.append(1) or [])   # la lectura no la ve
    r = iniciar(cliente, mundo, *refs)
    assert vistas and r.status_code == 409 and r.json()["detail"] == TEXTO_OCUPADO
    assert [e for e in mundo.eventos if e[0] in ("cobrar", "lanzar")] == [] and mundo.libro == []
    assert "ed-9f1c0a7b" not in mundo.docs()


def test_sin_el_indice_la_lectura_sola_cubre_el_hueco(cliente, mundo):
    """Antes de correr db_migrate el API funciona igual: la lectura previa frena a la segunda."""
    mundo.indice = False
    refs = dos_cortos(mundo)
    assert iniciar(cliente, mundo, *refs).status_code == 200
    assert iniciar(cliente, mundo, *refs, pedido=PEDIDO_2).status_code == 409
    assert len([m for m in mundo.libro if m["tipo"] == "cargo"]) == 1


def test_una_corrida_de_3_horas_ya_cobrada_se_libera_y_se_devuelve(cliente, mundo):
    mundo.copia("ed-vieja", "Colgada", estado="corriendo", inicio=ahora_iso(-3 * 3600), creditos=4)
    mundo.libro.append({"user": "u1", "creditos": -4, "tipo": "cargo", "referencia": "editar-sugerir:ed-vieja"})
    mundo.saldos["u1"] = 96
    refs = dos_cortos(mundo)
    r = iniciar(cliente, mundo, *refs)
    assert r.status_code == 200, r.text                       # NO bloquea
    vieja = mundo.docs()["ed-vieja"]["editar"]
    assert vieja["estado"] == "error" and vieja["devueltos"] == 4
    assert mundo.neto("editar-sugerir:ed-vieja") == 0         # se devolvió, una sola vez
    assert [m for m in mundo.libro if m["referencia"] == "editar-sugerir:ed-vieja" and m["tipo"] == "devolucion"
            ] == [{"user": "u1", "creditos": 4, "tipo": "devolucion", "referencia": "editar-sugerir:ed-vieja"}]


def test_una_corrida_sin_cobrar_de_6_minutos_se_libera_sin_devolver_si_el_libro_no_tiene_cargo(cliente, mundo):
    mundo.copia("ed-huerfana", "Huérfana", estado="corriendo", cobrado=False, inicio=ahora_iso(-6 * 60))
    refs = dos_cortos(mundo)
    r = iniciar(cliente, mundo, *refs)
    assert r.status_code == 200
    assert mundo.docs()["ed-huerfana"]["editar"]["estado"] == "error"
    assert [m for m in mundo.libro if m["tipo"] == "devolucion"] == []


def test_una_corrida_sin_cobrar_de_6_minutos_con_cargo_en_el_libro_se_devuelve(cliente, mundo):
    """La Lambda murió ENTRE cobrar y anotar `cobrado`: el doc dice que no se cobró, el libro dice que sí."""
    mundo.copia("ed-huerfana", "Huérfana", estado="corriendo", cobrado=False, creditos=8,
                inicio=ahora_iso(-6 * 60))
    mundo.libro.append({"user": "u1", "creditos": -8, "tipo": "cargo", "referencia": "editar-sugerir:ed-huerfana"})
    mundo.saldos["u1"] = 92
    refs = dos_cortos(mundo)
    assert iniciar(cliente, mundo, *refs).status_code == 200
    d = mundo.docs()["ed-huerfana"]["editar"]
    assert d["estado"] == "error" and d["devueltos"] == 8
    assert mundo.neto("editar-sugerir:ed-huerfana") == 0


def test_una_corrida_sin_cobrar_de_1_minuto_todavia_cuenta(cliente, mundo):
    mundo.copia("ed-en-vuelo", "En vuelo", estado="corriendo", cobrado=False, inicio=ahora_iso(-60))
    assert iniciar(cliente, mundo, *dos_cortos(mundo)).status_code == 409


def test_liberar_dos_veces_la_misma_caducada_devuelve_una_sola_vez(cliente, mundo):
    mundo.copia("ed-vieja", "Colgada", estado="corriendo", inicio=ahora_iso(-3 * 3600), creditos=4)
    mundo.libro.append({"user": "u1", "creditos": -4, "tipo": "cargo", "referencia": "editar-sugerir:ed-vieja"})
    fila = {"nombre": "ed-vieja", "editar": dict(mundo.docs()["ed-vieja"]["editar"])}
    assert edicion_api._liberar_caducadas("u1", [fila]) == []
    assert edicion_api._liberar_caducadas("u1", [fila]) == []           # otro request con la misma foto
    assert mundo.neto("editar-sugerir:ed-vieja") == 0
    assert len([m for m in mundo.libro if m["tipo"] == "devolucion"]) == 1


def test_las_caducadas_de_e1_solo_se_descartan_no_se_tocan(cliente, mundo):
    mundo.subida("e1", dur=300.0)
    mundo.docs()["e1"]["editar"] = {"estado": "corriendo", "inicio": ahora_iso(-5 * 3600), "creditos": 4}
    assert iniciar(cliente, mundo, *dos_cortos(mundo)).status_code == 200
    assert mundo.docs()["e1"]["editar"]["estado"] == "corriendo"            # igual que hoy
    assert mundo.libro[-1]["referencia"] == REF_DINERO


# ---------------------------------------------------------------------------
# fallos DESPUÉS de cobrar: el dinero siempre vuelve

def test_si_no_se_pudo_lanzar_se_devuelve_lo_mismo_que_se_cobro_y_es_502(cliente, mundo):
    mundo.lanzar_falla = RuntimeError("SFN dijo que no")
    r = iniciar(cliente, mundo, *dos_cortos(mundo))
    n = tarifa("edicion")
    assert r.status_code == 502
    assert r.json()["detail"] == "No se pudo lanzar la edición: SFN dijo que no. Se te devolvió lo cobrado."
    assert [e for e in mundo.eventos if e[0] in ("cobrar", "devolver")] == [
        ("cobrar", n, REF_DINERO), ("devolver", n, REF_DINERO)]            # mismo n, misma referencia
    e = mundo.docs()["ed-9f1c0a7b"]["editar"]
    assert e["estado"] == "error" and e["devueltos"] == n and "SFN dijo que no" in e["error"]
    assert mundo.neto(REF_DINERO) == 0 and mundo.saldos["u1"] == 100


def test_el_detalle_del_502_se_recorta_a_200_caracteres(cliente, mundo):
    mundo.lanzar_falla = RuntimeError("x" * 500)
    r = iniciar(cliente, mundo, *dos_cortos(mundo))
    assert r.json()["detail"] == f"No se pudo lanzar la edición: {'x' * 200}. Se te devolvió lo cobrado."


def test_sin_capacidad_devuelve_y_es_503_no_502(cliente, mundo):
    mundo.lanzar_falla = jobs.SinCapacidad("Ahorita hay mucha gente produciendo y no se te cobró. "
                                           "Vuelve a intentarlo en unos minutos.")
    r = iniciar(cliente, mundo, *dos_cortos(mundo))
    assert r.status_code == 503
    assert r.json()["detail"] == ("Ahorita hay mucha gente produciendo y no se te cobró. "
                                  "Vuelve a intentarlo en unos minutos.")
    assert mundo.neto(REF_DINERO) == 0
    e = mundo.docs()["ed-9f1c0a7b"]["editar"]
    assert e["estado"] == "error" and e["devueltos"] == tarifa("edicion")


def test_tras_un_fallo_al_lanzar_se_puede_pedir_otra_vez_con_otro_pedido(cliente, mundo):
    mundo.lanzar_falla = RuntimeError("no")
    refs = dos_cortos(mundo)
    iniciar(cliente, mundo, *refs)
    mundo.lanzar_falla = None
    r = iniciar(cliente, mundo, *refs, pedido=PEDIDO_2)
    assert r.status_code == 200 and mundo.neto("editar-sugerir:ed-aaaaaaaa") == tarifa("edicion")
    assert mundo.neto(REF_DINERO) == 0


def test_si_el_worker_ya_cerro_la_corrida_no_se_devuelve_dos_veces(cliente, mundo, monkeypatch):
    """`lanzar` falla DESPUÉS de que la ejecución ya arrancó y el worker cerró y devolvió: no se abona otra vez."""
    def lanza_y_se_cae(u, n):
        mundo.eventos.append(("lanzar", n))
        d = mundo.docs()[n]["editar"]
        d.update(estado="error", error="el worker falló")           # el worker reclamó y devolvió
        mundo._abonar(u, d["creditos"], "devolucion", f"editar-sugerir:{n}")
        raise RuntimeError("se perdió la respuesta de start_execution")
    monkeypatch.setattr(jobs, "lanzar_editar", lanza_y_se_cae)
    r = iniciar(cliente, mundo, *dos_cortos(mundo))
    assert r.status_code == 502
    assert len([m for m in mundo.libro if m["tipo"] == "devolucion"]) == 1       # UNA devolución, no dos
    assert mundo.neto(REF_DINERO) == 0


def test_si_anotar_el_cobro_falla_se_devuelve_y_no_se_lanza(cliente, mundo, monkeypatch):
    from pipeline import db
    original = db.fijar_campo_editor

    def falla_al_anotar(u, n, campo, valor):
        if campo == "editar" and json.loads(valor).get("cobrado") is True:
            raise RuntimeError("Aurora se cayó")
        return original(u, n, campo, valor)
    monkeypatch.setattr(db, "fijar_campo_editor", falla_al_anotar)
    r = iniciar(cliente, mundo, *dos_cortos(mundo))
    assert r.status_code == 502 and "Aurora se cayó" in r.json()["detail"]
    assert "lanzar" not in [e[0] for e in mundo.eventos]
    assert mundo.neto(REF_DINERO) == 0 and mundo.saldos["u1"] == 100


def test_si_el_reclamo_del_fallo_tambien_falla_se_devuelve_de_todos_modos(cliente, mundo, monkeypatch):
    from pipeline import db
    mundo.lanzar_falla = RuntimeError("no")
    monkeypatch.setattr(db, "reclamar_fallo_editor", lambda *a: (_ for _ in ()).throw(RuntimeError("Aurora")))
    r = iniciar(cliente, mundo, *dos_cortos(mundo))
    assert r.status_code == 502 and mundo.neto(REF_DINERO) == 0


def test_si_cobrar_se_cae_despues_de_cargar_el_libro_mayor_decide_y_se_devuelve(mundo):
    """La respuesta de `cobrar` se perdió pero el cargo entró: no se queda cobrado sin entregar."""
    from server.app import app
    mundo.cobrar_falla_despues = ConnectionError("se cayó la red")
    cliente = TestClient(app, raise_server_exceptions=False)
    r = cliente.post("/api/edicion/iniciar", json=mundo.cuerpo(*dos_cortos(mundo)))
    assert r.status_code == 500
    assert mundo.neto(REF_DINERO) == 0 and mundo.saldos["u1"] == 100
    assert "lanzar" not in [e[0] for e in mundo.eventos]
    assert mundo.docs()["ed-9f1c0a7b"]["editar"]["estado"] == "error"


def test_si_cobrar_se_cae_antes_de_cargar_no_se_devuelve_nada(mundo):
    from pipeline import db
    from server.app import app
    mundo.mp.setattr(db, "cobrar_creditos", lambda *a: (_ for _ in ()).throw(ConnectionError("antes")))
    cliente = TestClient(app, raise_server_exceptions=False)
    r = cliente.post("/api/edicion/iniciar", json=mundo.cuerpo(*dos_cortos(mundo)))
    assert r.status_code == 500 and mundo.libro == []
    assert mundo.docs()["ed-9f1c0a7b"]["editar"]["estado"] == "error"      # y no queda bloqueando


def test_sin_nombre_libre_es_503_y_no_cobra(cliente, mundo, monkeypatch):
    from pipeline import db
    monkeypatch.setattr(db, "reservar_nombre_derivado", lambda *a, **k: None)
    r = iniciar(cliente, mundo, *dos_cortos(mundo))
    assert r.status_code == 503 and r.json()["detail"] == "No pudimos preparar tu copia ahora. Inténtalo otra vez."
    sin_efectos(mundo)


# ---------------------------------------------------------------------------
# el catálogo de textos (§3.8): una sola tabla, tal cual

CATALOGO = {
    "sin_videos": (422, "Agrega al menos un video para editar."),
    "demasiados": (422, "Puedes unir hasta 12 videos a la vez."),
    "repetido": (422, "«{titulo}» está repetido: agrégalo una sola vez."),
    "no_encontrado": (404, "No encontramos uno de los videos entre los tuyos. Recarga la lista e inténtalo de nuevo."),
    "es_copia": (422, "«{titulo}» ya es una edición: ábrela en su editor para seguir con ella."),
    "sin_metraje": (422, "«{titulo}» no tiene un video para editar."),
    "no_se_pudo_medir": (502, "No pudimos leer «{titulo}». Quítalo e inténtalo de nuevo."),
    "larga": (413, "«{titulo}» dura {n} min y el máximo es 90 min."),
    "formatos_distintos": (422, "Los videos horizontales y los verticales no se mezclan. Quita los {quitar} o edítalos aparte."),
    "total_largo": (413, "Entre todos suman {n} min · el máximo es 90 min."),
    "muy_pesado": (413, "Entre todos pesan {n} GB · el máximo es 15 GB."),
    "corto_solo": (422, "Un video de menos de 1 min no se puede editar solo. Agrega otro para unirlos, o sube uno de 1 a 90 min."),
    "sin_transcripcion": (503, "Todavía no podemos transcribir videos nuevos en esta instalación. Prueba con videos que ya hiciste con IA."),
    "ocupado": (409, "Ya hay un trabajo en curso. Cuando termine puedes empezar otro."),
    "instruccion_vacia": (422, "Cuéntale a la IA qué quieres hacer con tus videos."),
    "sin_pedido": (422, "Falta la clave del pedido. Recarga la página e inténtalo de nuevo."),
    "ya_fallo": (409, "Esta edición ya falló y se te devolvió lo cobrado. Pulsa Iniciar otra vez para empezar de nuevo."),
    "sin_capacidad": (503, "Ahorita hay mucha gente produciendo y no se te cobró. Vuelve a intentarlo en unos minutos."),
    "no_se_pudo_lanzar": (502, "No se pudo lanzar la edición: {detalle}. Se te devolvió lo cobrado."),
    "reintento_no_aplica": (409, "Esta edición no está esperando un reintento."),
    "reintento_en_curso": (409, "Esta edición ya se está reintentando."),
    "no_nube": (503, "El flujo web de edición corre en el servicio — en local usa /clean-cut desde Claude Code"),
}


def test_el_catalogo_es_el_de_la_seccion_3_8_del_contrato_tal_cual():
    for codigo, esperado in CATALOGO.items():
        assert edicion_api.ERRORES[codigo] == esperado, codigo
        assert edicion_api.status_de(codigo) == esperado[0]
    # y lo único que el contrato no lista son las de apoyo
    assert set(edicion_api.ERRORES) - set(CATALOGO) == {
        "ref_mal", "sin_nombre", "no_es_copia",
        # Ajustes 2: cuando el abono no se pudo hacer ahora, el texto no dice «se devolvió»
        "no_se_pudo_lanzar_pendiente", "sin_capacidad_pendiente", "devolucion_en_curso"}


def test_el_saldo_usa_el_texto_de_siempre_de_creditos():
    exc = creditos.SinSaldo(4, 1)
    assert str(exc) == "Créditos insuficientes: esta acción cuesta 4 créditos y tu saldo es 1."


# ---------------------------------------------------------------------------
# la ruta vieja: ahora deja `devueltos` cuando no se pudo lanzar (la bandeja lo necesita)

def test_la_ruta_vieja_sugerir_anota_devueltos_si_no_se_pudo_lanzar(monkeypatch):
    from pipeline import db
    from server import editar_api
    doc = {"subidas": [{"key": "videos/v/subidas/a.mp4"}]}
    guardado, movs = {}, []
    monkeypatch.delenv("COGNITO_POOL_ID", raising=False)
    monkeypatch.setenv("ASSEMBLYAI_API_KEY", "x")
    monkeypatch.setattr(db, "backend", lambda: "postgres")
    monkeypatch.setattr(db, "usuario_actual", lambda: "u1")
    monkeypatch.setattr(editar_api, "_proyecto", lambda n: doc)
    monkeypatch.setattr(editar_api, "_duracion_s", lambda k: 360.0)
    monkeypatch.setattr(editar_api, "_con_transcript", lambda n: False)
    monkeypatch.setattr(db, "fijar_campo_editor", lambda u, n, c, v: guardado.update({c: json.loads(v)}))
    monkeypatch.setattr(creditos, "activo", lambda: True)
    monkeypatch.setattr(creditos, "cobrar", lambda n, ref, u=None: movs.append(("cobro", n)))
    monkeypatch.setattr(creditos, "devolver", lambda n, ref, u=None: movs.append(("devolucion", n)))

    def truena(u, n):
        raise RuntimeError("sin SFN")
    monkeypatch.setattr(jobs, "lanzar_editar", truena)
    from server.app import app
    assert TestClient(app).post("/api/editar/video-1/sugerir").status_code == 502
    assert guardado["editar"]["estado"] == "error"
    assert guardado["editar"]["devueltos"] == movs[0][1] == movs[1][1]


def test_la_ruta_vieja_sin_monedero_no_habla_de_devueltos(monkeypatch):
    from pipeline import db
    from server import editar_api
    guardado = {}
    monkeypatch.delenv("COGNITO_POOL_ID", raising=False)
    monkeypatch.setenv("ASSEMBLYAI_API_KEY", "x")
    monkeypatch.setattr(db, "backend", lambda: "postgres")
    monkeypatch.setattr(db, "usuario_actual", lambda: "u1")
    monkeypatch.setattr(editar_api, "_proyecto", lambda n: {"subidas": [{"key": "videos/v/subidas/a.mp4"}]})
    monkeypatch.setattr(editar_api, "_duracion_s", lambda k: 360.0)
    monkeypatch.setattr(editar_api, "_con_transcript", lambda n: True)
    monkeypatch.setattr(db, "fijar_campo_editor", lambda u, n, c, v: guardado.update({c: json.loads(v)}))
    monkeypatch.setattr(creditos, "activo", lambda: False)
    monkeypatch.setattr(jobs, "lanzar_editar", lambda u, n: (_ for _ in ()).throw(RuntimeError("x")))
    from server.app import app
    assert TestClient(app).post("/api/editar/video-1/sugerir").status_code == 502
    assert "devueltos" not in guardado["editar"]
