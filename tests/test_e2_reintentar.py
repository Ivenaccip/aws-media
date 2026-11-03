"""E2 — `POST /api/edicion/<copia>/reintentar`: la misma copia, otra vez, y vuelve a cobrar.

«Reintentar vuelve a cobrar ✦ N» tiene que ser verdad: cobra lo que quedó
escrito en `editar.creditos` (lo cobrado la primera vez), no recalcula, y solo
UNA llamada gana el claim aunque haya doble clic o dos pestañas.
"""
import threading

import pytest
from fastapi.testclient import TestClient

from pipeline import jobs
from test_e2_mundo import ahora_iso, cliente, mundo, tarifa  # noqa: F401  (las fixtures se importan por nombre)

COPIA = "ed-9f1c0a7b"
REF = f"editar-sugerir:{COPIA}"


def dos_cortos(mundo):
    mundo.subida("a", dur=20.0, canonico=True)
    mundo.subida("b", dur=15.0, canonico=True)
    return ["proyecto:a", "proyecto:b"]


def copia_que_fallo(cliente, mundo, paso="editar"):
    """El camino real: `iniciar` cobra y lanza; luego el worker falla, reclama y devuelve."""
    r = cliente.post("/api/edicion/iniciar", json=mundo.cuerpo(*dos_cortos(mundo)))
    assert r.status_code == 200, r.text
    e = mundo.docs()[COPIA]["editar"]
    assert mundo._reclamar_fallo("u1", COPIA, "editar", "RuntimeError: ffmpeg") is not None
    e.update(paso=paso, fin=ahora_iso())
    mundo._abonar("u1", e["creditos"], "devolucion", REF)
    e["devueltos"] = e["creditos"]
    mundo.eventos.clear()
    return e


def reintentar(cliente, nombre=COPIA):
    return cliente.post(f"/api/edicion/{nombre}/reintentar")


# ---------------------------------------------------------------------------

def test_reintentar_cobra_otra_vez_lo_mismo_y_lanza_la_misma_copia(cliente, mundo):
    e = copia_que_fallo(cliente, mundo)
    n = e["creditos"]
    assert mundo.neto(REF) == 0
    r = reintentar(cliente)
    assert r.status_code == 200 and r.json() == {"lanzado": True, "nombre": COPIA, "creditos": n}
    assert [x for x in mundo.eventos if x[0] in ("reclamar_reintento", "cobrar", "fijar", "lanzar")] == [
        ("reclamar_reintento", COPIA, True),        # el claim ANTES de cobrar
        ("cobrar", n, REF),
        ("fijar", COPIA, "editar", "corriendo", True),
        ("lanzar", COPIA)]
    d = mundo.docs()[COPIA]["editar"]
    assert d["estado"] == "corriendo" and d["cobrado"] is True and d["creditos"] == n
    assert d["paso"] == "entender" and d["reintentos"] == 1
    assert mundo.neto(REF) == n


def test_el_reintento_conserva_lo_que_el_worker_necesita_y_borra_el_fallo(cliente, mundo):
    antes = copia_que_fallo(cliente, mundo)
    reintentar(cliente)
    d = mundo.docs()[COPIA]["editar"]
    for k in ("fuentes", "instruccion", "pedido", "desglose", "n_videos", "formato", "duracion_entrada_s", "copia"):
        assert d[k] == antes[k], k
    for k in ("error", "devueltos", "fin", "resultado", "cortes", "fluff", "flags", "no_aplicado"):
        assert k not in d or d[k] is None, k
    assert d["inicio"] >= antes["inicio"]


def test_cobra_lo_que_quedo_escrito_aunque_la_tarifa_de_hoy_sea_otra(cliente, mundo):
    """El precio del reintento es `editar.creditos` (D-13), no un recálculo."""
    copia_que_fallo(cliente, mundo)
    mundo.docs()[COPIA]["editar"]["creditos"] = 9
    r = reintentar(cliente)
    assert r.json()["creditos"] == 9 and mundo.neto(REF) == 9


def test_si_creditos_no_esta_escrito_se_recalcula_de_las_fuentes_guardadas(cliente, mundo):
    copia_que_fallo(cliente, mundo)
    del mundo.docs()[COPIA]["editar"]["creditos"]
    assert reintentar(cliente).json()["creditos"] == tarifa("edicion")


def test_el_reintento_no_resuelve_de_nuevo_las_fuentes(cliente, mundo):
    copia_que_fallo(cliente, mundo)
    mundo.docs()["a"]["subidas"] = []                 # el original ya no está: da igual, se usa lo escrito
    mundo.medidas.clear()
    r = reintentar(cliente)
    assert r.status_code == 200
    assert not [e for e in mundo.eventos if e[0] == "medir" or e[:2] in (("cargar", "a"), ("cargar", "b"))]


# ---------------------------------------------------------------------------
# a quién le toca

def test_solo_una_copia_en_error_se_reintenta(cliente, mundo):
    copia_que_fallo(cliente, mundo)
    mundo.docs()[COPIA]["editar"]["estado"] = "listo"
    r = reintentar(cliente)
    assert r.status_code == 409 and r.json()["detail"] == "Esta edición no está esperando un reintento."
    mundo.docs()[COPIA]["editar"]["estado"] = "corriendo"           # la primera corrida, sin reintentos
    assert reintentar(cliente).json()["detail"] == "Esta edición no está esperando un reintento."
    assert [m for m in mundo.libro if m["tipo"] == "cargo"].__len__() == 1       # solo el de la primera vez


def test_lo_que_no_existe_es_404(cliente, mundo):
    r = reintentar(cliente, "no_existe")
    assert r.status_code == 404 and r.json()["detail"] == "No encontramos esa edición entre las tuyas."
    assert mundo.libro == []


@pytest.mark.parametrize("nombre", ["../x", "a/b", "ed 1", "", "x" * 3 + "\u0000"])
def test_un_nombre_invalido_es_404_sin_tocar_la_base(mundo, nombre):
    """La ruta recibe el nombre del navegador: se valida como en todo el repo (`ruta_proyecto`)."""
    from fastapi import HTTPException
    from server import edicion_api
    with pytest.raises(HTTPException) as e:
        edicion_api.reintentar(nombre)
    assert e.value.status_code == 404
    assert not [x for x in mundo.eventos if x[0] in ("cargar", "cobrar")]


def test_un_proyecto_que_no_es_copia_es_404(cliente, mundo):
    mundo.subida("e1", dur=300.0)
    mundo.docs()["e1"]["editar"] = {"estado": "error", "creditos": 4}
    assert reintentar(cliente, "e1").status_code == 404
    assert mundo.libro == []


def test_una_copia_ajena_es_404(cliente, mundo):
    mundo.copia("ed-ajena", "De otra", estado="error", user="u2", creditos=2, fuentes=[{"x": 1}])
    assert reintentar(cliente, "ed-ajena").status_code == 404
    assert mundo.libro == []


# ---------------------------------------------------------------------------
# el claim: solo UNA llamada gana

def test_la_segunda_llamada_es_409_ya_se_esta_reintentando(cliente, mundo):
    copia_que_fallo(cliente, mundo)
    assert reintentar(cliente).status_code == 200
    r = reintentar(cliente)
    assert r.status_code == 409 and r.json()["detail"] == "Esta edición ya se está reintentando."
    assert len([m for m in mundo.libro if m["tipo"] == "cargo"]) == 2       # el original y UN reintento


def test_seis_llamadas_a_la_vez_cobran_una_sola_vez(mundo):
    from server.app import app
    cliente = TestClient(app)
    copia_que_fallo(cliente, mundo)
    resp = []

    def llamar():
        resp.append(TestClient(app).post(f"/api/edicion/{COPIA}/reintentar"))
    hilos = [threading.Thread(target=llamar) for _ in range(6)]
    for h in hilos:
        h.start()
    for h in hilos:
        h.join()
    assert sorted(r.status_code for r in resp) == [200, 409, 409, 409, 409, 409]
    assert len([m for m in mundo.libro if m["tipo"] == "cargo"]) == 2
    assert len([e for e in mundo.eventos if e[0] == "lanzar"]) == 1


def test_si_ya_hay_otra_copia_corriendo_es_409_ocupado_sin_cobrar(cliente, mundo):
    copia_que_fallo(cliente, mundo)
    mundo.copia("ed-otra", "Otra", estado="corriendo")
    r = reintentar(cliente)
    assert r.status_code == 409 and r.json()["detail"] == (
        "Ya hay un trabajo en curso. Cuando termine puedes empezar otro.")
    assert mundo.neto(REF) == 0 and mundo.docs()[COPIA]["editar"]["estado"] == "error"


def test_sin_el_indice_la_lectura_previa_frena_el_reintento(cliente, mundo):
    """Antes de correr db_migrate el reintento también funciona: la lectura de «¿hay otra?» manda."""
    mundo.indice = False
    copia_que_fallo(cliente, mundo)
    mundo.copia("ed-otra", "Otra", estado="corriendo")
    r = reintentar(cliente)
    assert r.status_code == 409 and mundo.neto(REF) == 0
    assert not [x for x in mundo.eventos if x[0] in ("reclamar_reintento", "cobrar", "lanzar")]


def test_si_la_lectura_no_ve_la_otra_el_indice_rechaza_el_claim_y_es_409_sin_cobrar(cliente, mundo, monkeypatch):
    from pipeline import db
    copia_que_fallo(cliente, mundo)
    mundo.copia("ed-otra", "Otra", estado="corriendo")
    monkeypatch.setattr(db, "ediciones_corriendo", lambda u: [])
    r = reintentar(cliente)
    assert r.status_code == 409 and "trabajo en curso" in r.json()["detail"]
    assert mundo.neto(REF) == 0 and mundo.docs()[COPIA]["editar"]["estado"] == "error"
    assert not [e for e in mundo.eventos if e[0] in ("cobrar", "lanzar")]


def test_una_corrida_atascada_de_la_misma_persona_no_bloquea_el_reintento(cliente, mundo):
    copia_que_fallo(cliente, mundo)
    mundo.copia("ed-vieja", "Colgada", estado="corriendo", inicio=ahora_iso(-3 * 3600), creditos=4)
    mundo.libro.append({"user": "u1", "creditos": -4, "tipo": "cargo", "referencia": "editar-sugerir:ed-vieja"})
    assert reintentar(cliente).status_code == 200
    assert mundo.neto("editar-sugerir:ed-vieja") == 0


# ---------------------------------------------------------------------------
# dinero

def test_sin_saldo_es_402_y_el_doc_sigue_en_error_tal_cual(cliente, mundo):
    e = copia_que_fallo(cliente, mundo)
    antes = dict(e)
    mundo.saldos["u1"] = 1
    r = reintentar(cliente)
    assert r.status_code == 402
    assert r.json()["detail"] == f"Créditos insuficientes: esta acción cuesta {e['creditos']} créditos y tu saldo es 1."
    assert mundo.docs()[COPIA]["editar"] == antes
    assert not [x for x in mundo.eventos if x[0] == "lanzar"]
    # y con saldo vuelve a poder
    mundo.saldos["u1"] = 50
    assert reintentar(cliente).status_code == 200


def test_si_no_se_pudo_lanzar_se_devuelve_y_vuelve_a_error_con_devueltos(cliente, mundo):
    e = copia_que_fallo(cliente, mundo)
    n = e["creditos"]
    mundo.lanzar_falla = RuntimeError("SFN no responde")
    r = reintentar(cliente)
    assert r.status_code == 502
    assert r.json()["detail"] == "No se pudo lanzar la edición: SFN no responde. Se te devolvió lo cobrado."
    assert [x for x in mundo.eventos if x[0] in ("cobrar", "devolver")] == [("cobrar", n, REF), ("devolver", n, REF)]
    d = mundo.docs()[COPIA]["editar"]
    assert d["estado"] == "error" and d["devueltos"] == n and "SFN no responde" in d["error"]
    assert mundo.neto(REF) == 0
    # y se puede volver a intentar
    mundo.lanzar_falla = None
    assert reintentar(cliente).status_code == 200 and mundo.docs()[COPIA]["editar"]["reintentos"] == 2


def test_sin_capacidad_en_el_reintento_devuelve_y_es_503(cliente, mundo):
    copia_que_fallo(cliente, mundo)
    mundo.lanzar_falla = jobs.SinCapacidad("Ahorita hay mucha gente produciendo y no se te cobró. "
                                           "Vuelve a intentarlo en unos minutos.")
    r = reintentar(cliente)
    assert r.status_code == 503 and mundo.neto(REF) == 0
    assert mundo.docs()[COPIA]["editar"]["estado"] == "error"


def test_si_cobrar_se_cae_despues_de_cargar_el_libro_decide_y_se_devuelve(mundo):
    """Aquí el libro tiene el cargo y la devolución de la primera vez: el neto solo cuenta lo que falta."""
    from server.app import app
    cliente = TestClient(app, raise_server_exceptions=False)
    e = copia_que_fallo(cliente, mundo)
    mundo.cobrar_falla_despues = ConnectionError("red")
    r = reintentar(cliente)
    assert r.status_code == 500
    assert mundo.neto(REF) == 0 and mundo.saldos["u1"] == 100
    d = mundo.docs()[COPIA]["editar"]
    assert d["estado"] == "error" and d["devueltos"] == e["creditos"]
    assert not [x for x in mundo.eventos if x[0] == "lanzar"]
    # las devoluciones del libro: la de la primera vez y esta, ni una más
    assert len([m for m in mundo.libro if m["tipo"] == "devolucion"]) == 2


def test_el_reintento_no_toca_los_originales(cliente, mundo):
    copia_que_fallo(cliente, mundo)
    antes = {k: dict(v) for k, v in mundo.docs().items() if not k.startswith("ed-")}
    reintentar(cliente)
    assert {k: dict(v) for k, v in mundo.docs().items() if not k.startswith("ed-")} == antes


def test_en_local_es_503(cliente, monkeypatch):
    from pipeline import db
    monkeypatch.setattr(db, "backend", lambda: "json")
    assert reintentar(cliente).status_code == 503
