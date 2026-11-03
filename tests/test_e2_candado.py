"""E2 · Ajustes 2 — el candado de «una edición a la vez» y la capacidad, ANTES de mover dinero.

- D-16   sin el índice parcial (la API se desplegó antes de `tools/db_migrate.py`) dos pestañas con
         `pedido` distinto leían «nada corriendo», insertaban las dos, cobraban las dos y lanzaban las
         dos. Ahora cada una vuelve a mirar DESPUÉS de su propio INSERT: «insertar y luego mirar» es
         hermético, porque la que mira más tarde ve a la otra;
- D-14   `lanzar_editar` comprobaba la capacidad DESPUÉS de cobrar: cada vez que Fargate estaba lleno
         había cargo + devolución en el libro y una copia fantasma. Ahora se pregunta antes;
- INT-06 y si aun así el lanzamiento falla (la carrera entre la pregunta y `start_execution`, o un 502),
         la copia queda marcada `no_lanzada`: ni la bandeja ni «Mis creaciones» la enseñan como un fallo
         del worker que nunca existió.
"""
import threading

import pytest
from fastapi.testclient import TestClient

from pipeline import jobs
from server import edicion_api
from test_e2_mundo import PEDIDO_2, cliente, mundo, tarifa  # noqa: F401

COPIA = "ed-9f1c0a7b"
OTRA = "ed-aaaaaaaa"
TEXTO_OCUPADO = "Ya hay un trabajo en curso. Cuando termine puedes empezar otro."
TEXTO_SIN_SITIO = ("Ahorita hay mucha gente produciendo y no se te cobró. "
                   "Vuelve a intentarlo en unos minutos.")


def dos_cortos(mundo):
    mundo.subida("a", dur=20.0, canonico=True)
    mundo.subida("b", dur=15.0, canonico=True)
    return ["proyecto:a", "proyecto:b"]


def iniciar(cliente, mundo, *refs, **kw):
    return cliente.post("/api/edicion/iniciar", json=mundo.cuerpo(*refs, **kw))


def copia_corriendo(mundo, nombre, **extra):
    """La corrida de la otra pestaña, ya cobrada y viva."""
    from test_e2_mundo import ahora_iso
    mundo.copia(nombre, "De la otra pestaña", estado="corriendo", inicio=ahora_iso(-5), creditos=2, **extra)


# ---------------------------------------------------------------------------
# D-16 · insertar y LUEGO mirar

def test_sin_el_indice_una_segunda_pestana_que_entro_a_la_vez_se_retira_sin_cobrar(cliente, mundo):
    """La otra pestaña leyó «nada corriendo» igual que yo y su INSERT cayó justo después del mío."""
    mundo.indice = False
    refs = dos_cortos(mundo)
    mundo.tras_crear = lambda: copia_corriendo(mundo, OTRA)
    r = iniciar(cliente, mundo, *refs)
    assert r.status_code == 409 and r.json()["detail"] == TEXTO_OCUPADO
    assert COPIA not in mundo.docs()                                     # mi candado se soltó
    assert mundo.libro == [] and "cobrar" not in [e[0] for e in mundo.eventos]
    assert "lanzar" not in [e[0] for e in mundo.eventos]
    assert mundo.docs()[OTRA]["editar"]["estado"] == "corriendo"          # la otra sigue en pie


def test_el_mismo_pedido_repetido_no_se_confunde_con_otra_pestana(cliente, mundo):
    """Doble clic: la segunda llamada devuelve la primera (R20); no cuenta como «otra corrida»."""
    refs = dos_cortos(mundo)
    assert iniciar(cliente, mundo, *refs).status_code == 200
    r = iniciar(cliente, mundo, *refs)
    assert r.status_code == 200 and r.json()["repetido"] is True
    assert len([m for m in mundo.libro if m["tipo"] == "cargo"]) == 1


def test_una_corrida_caducada_de_la_otra_pestana_no_cuenta_como_otra(cliente, mundo):
    from test_e2_mundo import ahora_iso
    mundo.indice = False
    refs = dos_cortos(mundo)
    mundo.tras_crear = lambda: mundo.copia(OTRA, "Colgada", estado="corriendo", inicio=ahora_iso(-3 * 3600),
                                           creditos=2)
    assert iniciar(cliente, mundo, *refs).status_code == 200


def test_la_lectura_final_es_solo_de_las_demas_corridas_de_la_persona(cliente, mundo):
    mundo.indice = False
    refs = dos_cortos(mundo)
    mundo.tras_crear = lambda: copia_corriendo(mundo, OTRA, **{}) or mundo.copia(
        "ed-de-otra-persona", "Ajena", estado="corriendo", user="u2")
    # la copia de la OTRA persona (u2) no estorba; la de u1 sí
    r = iniciar(cliente, mundo, *refs)
    assert r.status_code == 409


def test_dos_pestanas_de_verdad_en_hilos_sin_indice_nunca_cobran_dos_veces(mundo):
    """Entrelazado real con hilos: da igual quién gane y cuántas se retiren, jamás dos cargos."""
    from server.app import app
    mundo.indice = False
    refs = dos_cortos(mundo)
    cliente = TestClient(app)
    for ronda in range(8):
        mundo.docs().pop(COPIA, None), mundo.docs().pop(OTRA, None)
        mundo.libro.clear()
        mundo.saldos["u1"] = 100
        barrera = threading.Barrier(2)
        res = []

        def pestana(pedido):
            barrera.wait()
            res.append(cliente.post("/api/edicion/iniciar", json=mundo.cuerpo(*refs, pedido=pedido)))
        hilos = [threading.Thread(target=pestana, args=(p,)) for p in ("9f1c0a7b4d2e4f6a8b3c1d5e7f9a0b2c", PEDIDO_2)]
        [h.start() for h in hilos]
        [h.join() for h in hilos]
        cargos = [m for m in mundo.libro if m["tipo"] == "cargo"]
        assert len(cargos) <= 1, (ronda, [r.status_code for r in res], cargos)
        assert sorted(r.status_code for r in res) in ([200, 409], [409, 409]), [r.text for r in res]


def test_el_reintento_tambien_mira_despues_de_su_claim(cliente, mundo):
    """Dos copias en error de la misma persona pulsan Reintentar a la vez y no hay índice: la que mira
    después de reclamar ve a la otra corriendo, se echa atrás (vuelve a `error`) y no cobra."""
    mundo.indice = False
    fuentes = [{"orden": 1, "clip_id": "c01", "duracion_s": 20.0, "transcribir": False}]
    mundo.copia(COPIA, "Una", estado="error", creditos=2, fuentes=fuentes, devueltos=2)
    mundo.copia(OTRA, "Otra", estado="error", creditos=2, fuentes=fuentes, devueltos=2)
    original = mundo._reclamar_reintento_atomico

    def reclama_y_entra_la_otra(u, n, editar):
        ok = original(u, n, editar)
        if ok and n == COPIA:                                # mi claim ganó y, justo después, la otra también
            mundo.docs()[OTRA]["editar"].update(estado="corriendo")
        return ok
    mundo._reclamar_reintento_atomico = reclama_y_entra_la_otra
    r = cliente.post(f"/api/edicion/{COPIA}/reintentar")
    assert r.status_code == 409 and r.json()["detail"] == TEXTO_OCUPADO
    assert mundo.docs()[COPIA]["editar"]["estado"] == "error" and "reintentos" not in mundo.docs()[COPIA]["editar"]
    assert [m for m in mundo.libro if m["tipo"] == "cargo"] == []


# ---------------------------------------------------------------------------
# D-14 · se pregunta por la capacidad ANTES de cobrar

def test_sin_sitio_en_fargate_no_se_cobra_ni_se_deja_una_copia(cliente, mundo):
    mundo.hay_sitio = False
    r = iniciar(cliente, mundo, *dos_cortos(mundo))
    assert r.status_code == 503 and r.json()["detail"] == TEXTO_SIN_SITIO
    assert COPIA not in mundo.docs() and mundo.libro == []                # ni copia, ni cargo, ni devolución
    assert not [e for e in mundo.eventos if e[0] in ("cobrar", "devolver", "crear", "lanzar")]


def test_sin_sitio_el_503_dice_la_verdad_el_libro_esta_vacio(cliente, mundo):
    mundo.hay_sitio = False
    iniciar(cliente, mundo, *dos_cortos(mundo))
    assert mundo.neto("editar-sugerir:ed-9f1c0a7b") == 0 and mundo.saldos["u1"] == 100
    assert edicion_api.db.devoluciones_pendientes("u1") == []


def test_cuando_vuelve_a_haber_sitio_el_mismo_pedido_funciona(cliente, mundo):
    refs = dos_cortos(mundo)
    mundo.hay_sitio = False
    assert iniciar(cliente, mundo, *refs).status_code == 503
    mundo.hay_sitio = True
    r = iniciar(cliente, mundo, *refs)
    assert r.status_code == 200 and r.json()["repetido"] is False


def test_el_reintento_tampoco_cobra_sin_sitio(cliente, mundo):
    fuentes = [{"orden": 1, "clip_id": "c01", "duracion_s": 20.0, "transcribir": False}]
    mundo.copia(COPIA, "Una", estado="error", creditos=2, fuentes=fuentes, devueltos=2)
    mundo.hay_sitio = False
    r = cliente.post(f"/api/edicion/{COPIA}/reintentar")
    assert r.status_code == 503 and mundo.libro == []
    assert mundo.docs()[COPIA]["editar"]["estado"] == "error" and "reintentos" not in mundo.docs()[COPIA]["editar"]


def test_hay_sitio_es_publico_y_sigue_a_la_comprobacion_de_siempre(monkeypatch):
    monkeypatch.setattr(jobs, "_hay_sitio", lambda: False)
    assert jobs.hay_sitio() is False
    monkeypatch.setattr(jobs, "_hay_sitio", lambda: True)
    assert jobs.hay_sitio() is True


def test_la_carrera_entre_preguntar_y_lanzar_sigue_devolviendo(cliente, mundo):
    """Entre `hay_sitio` y `start_execution` pudo llenarse: ahí sí se cobró, y se devuelve (503)."""
    mundo.lanzar_falla = jobs.SinCapacidad("Ahorita hay mucha gente produciendo y no se te cobró. "
                                           "Vuelve a intentarlo en unos minutos.")
    r = iniciar(cliente, mundo, *dos_cortos(mundo))
    assert r.status_code == 503 and r.json()["detail"] == TEXTO_SIN_SITIO
    assert mundo.neto("editar-sugerir:ed-9f1c0a7b") == 0 and mundo.saldos["u1"] == 100
    assert mundo.docs()[COPIA]["editar"]["devueltos"] == tarifa("edicion")


# ---------------------------------------------------------------------------
# INT-06 · lo que falló al lanzar no es un fallo del worker

def test_una_copia_que_fallo_al_lanzar_queda_marcada_y_sin_ficha(cliente, mundo):
    from server import trabajos_api
    import time
    mundo.lanzar_falla = RuntimeError("SFN dijo que no")
    assert iniciar(cliente, mundo, *dos_cortos(mundo)).status_code == 502
    e = mundo.docs()[COPIA]["editar"]
    assert e["estado"] == "error" and e["no_lanzada"] is True and e["devueltos"] == tarifa("edicion")
    ahora = time.time()
    assert trabajos_api.fichas_editor(COPIA, mundo.docs()[COPIA], ahora - 86400, ahora) == []


def test_la_misma_marca_si_fue_la_carrera_de_capacidad(cliente, mundo):
    mundo.lanzar_falla = jobs.SinCapacidad("x")
    iniciar(cliente, mundo, *dos_cortos(mundo))
    assert mundo.docs()[COPIA]["editar"]["no_lanzada"] is True


def test_mis_creaciones_tampoco_enseña_una_copia_que_nunca_corrio(cliente, mundo):
    mundo.lanzar_falla = RuntimeError("no")
    iniciar(cliente, mundo, *dos_cortos(mundo))
    nombres = [f["nombre"] for f in cliente.get("/api/edicion/proyectos").json()]
    assert COPIA not in nombres


def test_la_hoja_de_videos_tampoco_la_ofrece_apagada(cliente, mundo):
    mundo.lanzar_falla = RuntimeError("no")
    iniciar(cliente, mundo, *dos_cortos(mundo))
    refs = [v["ref"] for v in cliente.get("/api/edicion/elegibles").json()["videos"]]
    assert f"proyecto:{COPIA}" not in refs


def test_tras_un_fallo_al_lanzar_el_siguiente_intento_con_otro_pedido_funciona(cliente, mundo):
    refs = dos_cortos(mundo)
    mundo.lanzar_falla = RuntimeError("no")
    iniciar(cliente, mundo, *refs)
    mundo.lanzar_falla = None
    r = iniciar(cliente, mundo, *refs, pedido=PEDIDO_2)
    assert r.status_code == 200 and mundo.neto("editar-sugerir:ed-aaaaaaaa") == tarifa("edicion")


def test_un_reintento_que_falla_al_lanzar_NO_oculta_la_copia_que_si_corrio_antes(cliente, mundo):
    """La copia ya había fallado de verdad (con su error y su «Reintentar»): un lanzamiento fallido del
    reintento no la borra de la bandeja."""
    fuentes = [{"orden": 1, "clip_id": "c01", "duracion_s": 20.0, "transcribir": False}]
    mundo.copia(COPIA, "Una", estado="error", creditos=2, fuentes=fuentes, devueltos=2)
    mundo.lanzar_falla = RuntimeError("otra vez no")
    assert cliente.post(f"/api/edicion/{COPIA}/reintentar").status_code == 502
    e = mundo.docs()[COPIA]["editar"]
    assert e["estado"] == "error" and e["devueltos"] == 2 and "no_lanzada" not in e
