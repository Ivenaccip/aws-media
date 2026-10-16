"""E2 · Ajustes 2 — el dinero DESPUÉS del cobro: devolver, devolver una sola vez y no perder la deuda.

La revisión adversarial de E2 encontró seis huecos entre «cobré» y «entregué»; cada prueba de aquí
reproduce uno con el monedero en memoria de `test_e2_mundo.Mundo` y falla sin el arreglo:

- D-03  devolver reintenta una devolución que no era atómica: ahora el abono del libro mayor es UNA
        sentencia (`abonar_creditos`) y el API devuelve con `devolver_cargo`, que solo abona si lo último
        del libro para esa referencia es un cargo: repetir el abono —un intento que sí entró pero cuya
        respuesta se perdió— no abona dos veces, y la devolución de un cobro posterior (un Reintentar)
        no queda bloqueada por la del primero. La referencia es la de siempre, `editar-sugerir:<copia>`;
- D-04  el API reclamaba y devolvía UNA vez, sin reintento ni marca: si el abono fallaba, la persona
        se quedaba sin sus créditos y nadie más podía devolverlos;
- D-05  el cierre (reclamar → devolver → escribir) pisaba a un reintento que arrancó en medio;
- D-09  `reintentar` y `_soltar` dejaban la marca `devolucion_pendiente` de la corrida anterior;
- D-15  el reembolso de un huérfano solo ocurría cuando la persona volvía a pulsar Iniciar o
        Reintentar: ahora también al abrir la app (`GET /api/edicion/proyectos`).
"""
import json
import time

import pytest
from fastapi.testclient import TestClient

from pipeline import jobs
from server import edicion_api
from test_e2_mundo import PEDIDO_2, ahora_iso, cliente, mundo, tarifa  # noqa: F401

COPIA = "ed-9f1c0a7b"
REF = f"editar-sugerir:{COPIA}"


@pytest.fixture(autouse=True)
def _sin_esperas(monkeypatch):
    monkeypatch.setattr(time, "sleep", lambda s: None)


def dos_cortos(mundo):
    mundo.subida("a", dur=20.0, canonico=True)
    mundo.subida("b", dur=15.0, canonico=True)
    return ["proyecto:a", "proyecto:b"]


def iniciar(cliente, mundo, *refs, **kw):
    return cliente.post("/api/edicion/iniciar", json=mundo.cuerpo(*refs, **kw))


def devoluciones(mundo, prefijo=REF):
    return [m for m in mundo.libro if m["tipo"] == "devolucion" and m["referencia"].startswith(prefijo)]


def doc(mundo, nombre=COPIA):
    return mundo.docs()[nombre]["editar"]


# ---------------------------------------------------------------------------
# D-03 · la devolución del API es idempotente: una referencia por cobro

def test_el_api_devuelve_con_la_referencia_de_siempre(cliente, mundo):
    mundo.lanzar_falla = RuntimeError("SFN dijo que no")
    assert iniciar(cliente, mundo, *dos_cortos(mundo)).status_code == 502
    assert [m["referencia"] for m in devoluciones(mundo)] == [REF]
    assert [m["referencia"] for m in mundo.libro if m["tipo"] == "cargo"] == [REF]
    assert mundo.neto(REF) == 0 and mundo.saldos["u1"] == 100


def test_si_el_abono_titubea_una_vez_se_reintenta_y_se_devuelve_una_sola_vez(cliente, mundo):
    mundo.lanzar_falla = RuntimeError("no")
    mundo.abonar_fallas = 1
    r = iniciar(cliente, mundo, *dos_cortos(mundo))
    n = tarifa("edicion")
    assert r.status_code == 502 and r.json()["detail"].endswith("Se te devolvió lo cobrado.")
    assert len(devoluciones(mundo)) == 1 and mundo.saldos["u1"] == 100
    assert doc(mundo)["devueltos"] == n and "devolucion_pendiente" not in doc(mundo)


def test_si_la_respuesta_del_abono_se_pierde_el_reintento_no_abona_otra_vez(cliente, mundo):
    """El abono SÍ entró pero el Data API no contestó: el segundo intento ve que lo último del libro ya es
    una devolución y no toca nada. Con `devolver` (sin esa regla) se abonaba dos veces."""
    mundo.lanzar_falla = RuntimeError("no")
    mundo.abono_pierde_respuesta = 1
    r = iniciar(cliente, mundo, *dos_cortos(mundo))
    assert r.status_code == 502
    assert len(devoluciones(mundo)) == 1 and mundo.saldos["u1"] == 100
    assert ("devolver_repetida", tarifa("edicion"), REF) in mundo.eventos
    assert doc(mundo)["devueltos"] == tarifa("edicion")


def test_el_segundo_cobro_de_la_misma_copia_se_devuelve_aunque_la_referencia_se_repita(cliente, mundo):
    """`devolver_unica` con la referencia de siempre bloquearía la segunda devolución legítima: tras un
    Reintentar que también falla, lo último del libro es OTRO cargo y el abono sí entra."""
    mundo.copia(COPIA, "T", estado="error", creditos=2, devueltos=2,
                fuentes=[{"orden": 1, "clip_id": "c01", "duracion_s": 20.0, "transcribir": False}])
    mundo.libro += [{"user": "u1", "creditos": -2, "tipo": "cargo", "referencia": REF},
                    {"user": "u1", "creditos": 2, "tipo": "devolucion", "referencia": REF}]
    mundo.lanzar_falla = RuntimeError("otra vez no")
    r = cliente.post(f"/api/edicion/{COPIA}/reintentar")
    assert r.status_code == 502
    assert [m["referencia"] for m in devoluciones(mundo)] == [REF, REF]
    assert mundo.neto(REF) == 0 and mundo.saldos["u1"] == 100


def test_sin_un_cargo_pendiente_no_se_abona_nada(cliente, mundo):
    """Si el libro no tiene un cargo sin devolver para esa referencia (la persona nunca pagó, o ya se le
    devolvió) el abono no inventa créditos: un doc manipulado no regala saldo."""
    assert edicion_api._abonar("u1", COPIA, 2) is True                 # «ya estaba devuelto» también es éxito
    assert mundo.saldos["u1"] == 100 and mundo.libro == []
    mundo.libro.append({"user": "u1", "creditos": -2, "tipo": "cargo", "referencia": REF})
    mundo.saldos["u1"] = 98
    assert edicion_api._abonar("u1", COPIA, 2) and edicion_api._abonar("u1", COPIA, 2)
    assert mundo.saldos["u1"] == 100 and len(devoluciones(mundo)) == 1


# ---------------------------------------------------------------------------
# D-04 · si el abono falla del todo, la deuda queda anotada y se salda en la siguiente llamada

def _fallo_con_abono_roto(cliente, mundo):
    mundo.lanzar_falla = RuntimeError("SFN dijo que no")
    mundo.abonar_fallas = 3                        # los tres intentos
    r = iniciar(cliente, mundo, *dos_cortos(mundo))
    mundo.lanzar_falla = None
    return r


def test_si_los_tres_intentos_fallan_el_doc_queda_con_la_deuda_y_el_texto_no_miente(cliente, mundo):
    r = _fallo_con_abono_roto(cliente, mundo)
    n = tarifa("edicion")
    assert r.status_code == 502
    assert r.json()["detail"] == "No se pudo lanzar la edición: SFN dijo que no. Estamos devolviendo lo cobrado."
    e = doc(mundo)
    assert (e["estado"], e["devolucion_pendiente"], e["devolucion_api"]) == ("error", n, True)
    assert "devueltos" not in e                                   # la bandeja no puede decir «Te devolvimos»
    assert devoluciones(mundo) == [] and mundo.saldos["u1"] == 100 - n     # el dinero aún no volvió...
    assert [f["nombre"] for f in edicion_api.db.devoluciones_pendientes("u1")] == [COPIA]   # ...pero consta


def test_la_siguiente_llamada_de_la_persona_salda_la_deuda_antes_de_hacer_otra_cosa(cliente, mundo):
    _fallo_con_abono_roto(cliente, mundo)
    n = tarifa("edicion")
    r = iniciar(cliente, mundo, *dos_cortos(mundo), pedido=PEDIDO_2)
    assert r.status_code == 200, r.text
    e = doc(mundo)
    assert e["devueltos"] == n and "devolucion_pendiente" not in e and "devolucion_api" not in e
    assert [m["referencia"] for m in devoluciones(mundo)] == [REF]
    assert mundo.neto(REF) == 0                                   # lo de la copia fallida volvió
    assert mundo.neto("editar-sugerir:ed-aaaaaaaa") == n          # y la nueva edición cobró lo suyo


def test_repetir_el_mismo_pedido_con_la_deuda_pendiente_no_dice_que_ya_se_devolvio(cliente, mundo):
    refs = dos_cortos(mundo)
    mundo.lanzar_falla = RuntimeError("no")
    mundo.abonar_fallas = 4                       # los 3 intentos del fallo y el 1 de saldar al repetir
    assert iniciar(cliente, mundo, *refs).status_code == 502
    mundo.lanzar_falla = None
    r = iniciar(cliente, mundo, *refs)
    assert r.status_code == 409
    assert r.json()["detail"] == "Todavía estamos devolviendo los créditos de esta edición. Inténtalo en unos minutos."
    # y en cuanto el monedero responde, el mismo pedido ya dice la verdad: se devolvió
    r = iniciar(cliente, mundo, *refs)
    assert r.status_code == 409 and r.json()["detail"].startswith("Esta edición ya falló y se te devolvió")
    assert len(devoluciones(mundo)) == 1 and mundo.saldos["u1"] == 100


def test_al_abrir_la_app_tambien_se_salda(cliente, mundo):
    """No hace falta iniciar otra edición: `GET /api/edicion/proyectos` es lo primero que se pide."""
    _fallo_con_abono_roto(cliente, mundo)
    assert cliente.get("/api/edicion/proyectos").status_code == 200
    assert doc(mundo)["devueltos"] == tarifa("edicion") and mundo.neto(REF) == 0


def test_saldar_no_se_pone_a_esperar_si_el_monedero_sigue_caido(cliente, mundo, monkeypatch):
    """Un solo intento y sin esperas: el que llega a Iniciar no paga las esperas de otro abono roto."""
    _fallo_con_abono_roto(cliente, mundo)
    esperas = []
    monkeypatch.setattr(time, "sleep", lambda s: esperas.append(s))
    mundo.abonar_fallas = 5
    assert cliente.get("/api/edicion/proyectos").status_code == 200
    assert esperas == [] and mundo.abonar_fallas == 4             # exactamente UN intento
    assert doc(mundo)["devolucion_pendiente"] == tarifa("edicion")


def test_reintentar_una_copia_con_deuda_pendiente_primero_la_salda(cliente, mundo):
    """Reintentar cobra otra vez y limpiaría la marca: sin saldar antes, la deuda se perdía."""
    _fallo_con_abono_roto(cliente, mundo)
    n = tarifa("edicion")
    r = cliente.post(f"/api/edicion/{COPIA}/reintentar")
    assert r.status_code == 200, r.text
    assert [m["referencia"] for m in devoluciones(mundo)] == [REF]          # la deuda se pagó
    e = doc(mundo)
    assert e["estado"] == "corriendo" and e["reintentos"] == 1
    assert "devolucion_pendiente" not in e and "devolucion_api" not in e and "devueltos" not in e
    assert mundo.neto(REF) == n                                   # solo el segundo cobro, que sí corre


def test_reintentar_con_deuda_que_no_se_puede_saldar_se_niega_sin_cobrar(cliente, mundo):
    _fallo_con_abono_roto(cliente, mundo)
    mundo.abonar_fallas = 9
    antes, lanzados = len(mundo.libro), mundo.eventos.count(("lanzar", COPIA))
    r = cliente.post(f"/api/edicion/{COPIA}/reintentar")
    assert r.status_code == 409
    assert r.json()["detail"] == "Todavía estamos devolviendo los créditos de esta edición. Inténtalo en unos minutos."
    assert len(mundo.libro) == antes and doc(mundo)["devolucion_pendiente"] == tarifa("edicion")
    assert mundo.eventos.count(("lanzar", COPIA)) == lanzados and ("cobrar", tarifa("edicion"), REF) not in mundo.eventos[-3:]


def test_el_soltar_de_una_caducada_con_el_abono_roto_tambien_deja_la_deuda(cliente, mundo):
    mundo.copia("ed-vieja", "Colgada", estado="corriendo", inicio=ahora_iso(-3 * 3600), creditos=4)
    mundo.libro.append({"user": "u1", "creditos": -4, "tipo": "cargo", "referencia": "editar-sugerir:ed-vieja"})
    mundo.saldos["u1"] = 96
    mundo.abonar_fallas = 3
    r = iniciar(cliente, mundo, *dos_cortos(mundo))
    assert r.status_code == 200                                   # liberar no bloquea a nadie
    vieja = mundo.docs()["ed-vieja"]["editar"]
    assert (vieja["estado"], vieja["devolucion_pendiente"], vieja["devolucion_api"]) == ("error", 4, True)
    assert "devueltos" not in vieja
    # y la siguiente llamada la salda (una sola devolución, con la referencia de ese cobro)
    assert cliente.get("/api/edicion/proyectos").status_code == 200
    vieja = mundo.docs()["ed-vieja"]["editar"]
    assert vieja["devueltos"] == 4 and "devolucion_pendiente" not in vieja
    assert [m["referencia"] for m in devoluciones(mundo, "editar-sugerir:ed-vieja")] == ["editar-sugerir:ed-vieja"]


def test_el_reclamo_roto_sigue_devolviendo_pero_ya_no_dos_veces(cliente, mundo, monkeypatch):
    """Antes: si el reclamo fallaba se devolvía igual y, si el doc se quedaba `corriendo`, la caducidad
    devolvía OTRA vez. Con la referencia por cobro, la segunda devolución ve la primera y no abona."""
    mundo.lanzar_falla = RuntimeError("no")
    with monkeypatch.context() as m:
        m.setattr(edicion_api.db, "reclamar_fallo_editor", lambda *a: (_ for _ in ()).throw(RuntimeError("Aurora")))
        m.setattr(edicion_api.db, "fijar_campo_editor", lambda *a, **k: None)     # el cierre tampoco entra
        r = iniciar(cliente, mundo, *dos_cortos(mundo))
    assert r.status_code == 502 and len(devoluciones(mundo)) == 1
    # el doc quedó `corriendo` (nada lo cerró): 3 h después la caducidad lo suelta
    mundo.docs()[COPIA]["editar"].update(estado="corriendo", inicio=ahora_iso(-3 * 3600), cobrado=True)
    edicion_api._liberar_caducadas("u1", [{"nombre": COPIA, "editar": dict(doc(mundo))}])
    assert len(devoluciones(mundo)) == 1 and mundo.neto(REF) == 0 and mundo.saldos["u1"] == 100


# ---------------------------------------------------------------------------
# D-05 · el cierre no pisa a un reintento que arrancó mientras se devolvía

def test_el_cierre_de_un_fallo_al_lanzar_no_pisa_un_reintento_que_arranco_en_medio(cliente, mundo):
    """El reclamo deja la copia en `error` (visible y reintentable) ANTES de abonar. Si la persona pulsa
    Reintentar mientras el abono tarda, el reintento cobra y lanza; el cierre viejo NO puede escribir
    `error` + `devueltos` encima: el segundo cobro se quedaba sin devolver y la bandeja mentía."""
    n = tarifa("edicion")
    mundo.lanzar_falla = RuntimeError("SFN dijo que no")

    def reintentan_mientras_se_devuelve():
        mundo.lanzar_falla = None
        r = cliente.post(f"/api/edicion/{COPIA}/reintentar")
        assert r.status_code == 200, r.text
    mundo.al_abonar = reintentan_mientras_se_devuelve
    r = iniciar(cliente, mundo, *dos_cortos(mundo))
    assert r.status_code == 502
    e = doc(mundo)
    assert e["estado"] == "corriendo" and e["reintentos"] == 1                      # la corrida NUEVA sigue viva
    assert "devueltos" not in e and "error" not in e
    assert ("cerrar", COPIA, False) in mundo.eventos                                # el cierre viejo lo intentó y no pudo
    assert len(devoluciones(mundo)) == 1 and mundo.neto(REF) == n                   # el 1.er cobro volvió; el 2.º corre


def test_el_soltar_de_una_caducada_no_pisa_un_reintento_que_arranco_en_medio(cliente, mundo):
    n = tarifa("edicion")
    fuentes = [{"orden": 1, "clip_id": "c01", "duracion_s": 20.0, "transcribir": False}]
    mundo.copia("ed-vieja", "Colgada", estado="corriendo", inicio=ahora_iso(-3 * 3600), creditos=n, fuentes=fuentes)
    mundo.libro.append({"user": "u1", "creditos": -n, "tipo": "cargo", "referencia": "editar-sugerir:ed-vieja"})
    mundo.saldos["u1"] = 100 - n

    def reintentan():
        r = cliente.post("/api/edicion/ed-vieja/reintentar")
        assert r.status_code == 200, r.text
    mundo.al_abonar = reintentan
    fila = {"nombre": "ed-vieja", "editar": dict(mundo.docs()["ed-vieja"]["editar"])}
    assert edicion_api._liberar_caducadas("u1", [fila]) == []
    e = mundo.docs()["ed-vieja"]["editar"]
    assert e["estado"] == "corriendo" and e["reintentos"] == 1 and "devueltos" not in e
    assert mundo.neto("editar-sugerir:ed-vieja") == n          # el cobro del reintento sigue en pie; el viejo volvió


# ---------------------------------------------------------------------------
# D-09 · la marca de la corrida anterior no se hereda

def test_reintentar_no_hereda_la_marca_de_una_devolucion_que_ya_no_importa(cliente, mundo):
    mundo.copia(COPIA, "T", estado="error", creditos=2, devueltos=2, devolucion_pendiente=2,
                fuentes=[{"orden": 1, "clip_id": "c01", "duracion_s": 20.0, "transcribir": False}])
    r = cliente.post(f"/api/edicion/{COPIA}/reintentar")
    assert r.status_code == 200, r.text
    e = doc(mundo)
    assert e["estado"] == "corriendo" and "devolucion_pendiente" not in e and "devueltos" not in e


def test_soltar_limpia_la_marca_que_dejo_el_worker_para_el_barredor(cliente, mundo):
    """El worker reabrió la copia (`corriendo` + `devolucion_pendiente`) para que el barredor devolviera y
    el evento nunca llegó: pasadas 2 h la caducidad la cierra y devuelve; la marca no se queda."""
    n = tarifa("edicion")
    mundo.copia("ed-vieja", "Colgada", estado="corriendo", inicio=ahora_iso(-3 * 3600), creditos=n,
                devolucion_pendiente=n)
    mundo.libro.append({"user": "u1", "creditos": -n, "tipo": "cargo", "referencia": "editar-sugerir:ed-vieja"})
    mundo.saldos["u1"] = 100 - n
    assert edicion_api._liberar_caducadas("u1", [{"nombre": "ed-vieja", "editar": dict(mundo.docs()["ed-vieja"]["editar"])}]) == []
    e = mundo.docs()["ed-vieja"]["editar"]
    assert e["estado"] == "error" and e["devueltos"] == n and "devolucion_pendiente" not in e
    assert mundo.neto("editar-sugerir:ed-vieja") == 0


def test_una_corrida_reabierta_para_el_barredor_no_se_devuelve_a_mano_antes_de_tiempo(cliente, mundo):
    """Petición de S2: `corriendo` + `devolucion_pendiente` (sin `devolucion_api`) lo cerrará el barredor
    en segundos; mientras no caduque, la API no la toca ni la suelta."""
    n = tarifa("edicion")
    mundo.copia("ed-reabierta", "Reabierta", estado="corriendo", inicio=ahora_iso(-60), creditos=n,
                devolucion_pendiente=n)
    vivas = edicion_api._liberar_caducadas("u1", [{"nombre": "ed-reabierta",
                                                   "editar": dict(mundo.docs()["ed-reabierta"]["editar"])}])
    assert [f["nombre"] for f in vivas] == ["ed-reabierta"]
    assert mundo.docs()["ed-reabierta"]["editar"]["estado"] == "corriendo" and devoluciones(mundo, "editar-sugerir:") == []
    assert edicion_api.db.devoluciones_pendientes("u1") == []     # tampoco cuenta como deuda del API


# ---------------------------------------------------------------------------
# D-15 · el reembolso de un huérfano no espera a que la persona vuelva a editar

def test_al_abrir_la_app_se_libera_y_se_devuelve_una_copia_huerfana(cliente, mundo):
    n = tarifa("edicion")
    mundo.copia("ed-huerfana", "Huérfana", estado="corriendo", inicio=ahora_iso(-3 * 3600), creditos=n)
    mundo.libro.append({"user": "u1", "creditos": -n, "tipo": "cargo", "referencia": "editar-sugerir:ed-huerfana"})
    mundo.saldos["u1"] = 100 - n
    r = cliente.get("/api/edicion/proyectos")
    assert r.status_code == 200
    fila = next(f for f in r.json() if f["nombre"] == "ed-huerfana")
    assert fila["editar"]["estado"] == "error" and fila["editar"]["devueltos"] == n      # lo que la tarjeta lee
    assert mundo.neto("editar-sugerir:ed-huerfana") == 0 and mundo.saldos["u1"] == 100


def test_lo_que_sigue_vivo_no_se_toca_al_abrir_la_app(cliente, mundo):
    mundo.copia("ed-viva", "Viva", estado="corriendo", inicio=ahora_iso(-60), creditos=2)
    fila = next(f for f in cliente.get("/api/edicion/proyectos").json() if f["nombre"] == "ed-viva")
    assert fila["editar"]["estado"] == "corriendo" and mundo.libro == []


def test_si_liberar_revienta_la_lista_de_proyectos_sigue_respondiendo(cliente, mundo, monkeypatch):
    mundo.copia("ed-x", "X", estado="listo")
    monkeypatch.setattr(edicion_api, "liberar_huerfanas", lambda *a: (_ for _ in ()).throw(RuntimeError("Aurora")))
    r = cliente.get("/api/edicion/proyectos")
    assert r.status_code == 200 and any(f["nombre"] == "ed-x" for f in r.json())


def test_liberar_dos_veces_desde_dos_pestanas_devuelve_una_sola_vez(cliente, mundo):
    n = tarifa("edicion")
    mundo.copia("ed-huerfana", "Huérfana", estado="corriendo", inicio=ahora_iso(-3 * 3600), creditos=n)
    mundo.libro.append({"user": "u1", "creditos": -n, "tipo": "cargo", "referencia": "editar-sugerir:ed-huerfana"})
    for _ in range(3):
        cliente.get("/api/edicion/proyectos")
    assert len(devoluciones(mundo, "editar-sugerir:ed-huerfana")) == 1


def test_la_lectura_de_cotizar_y_elegibles_no_libera_nada(cliente, mundo):
    """Solo se libera donde ya hay efectos de dinero permitidos: `cotizar` y `elegibles` siguen sin efectos."""
    mundo.copia("ed-huerfana", "Huérfana", estado="corriendo", inicio=ahora_iso(-3 * 3600), creditos=2)
    cliente.post("/api/edicion/cotizar", json={"videos": []})
    cliente.get("/api/edicion/elegibles")
    assert mundo.docs()["ed-huerfana"]["editar"]["estado"] == "corriendo" and mundo.libro == []
