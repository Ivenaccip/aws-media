"""RAG·11 — los pasos de la espera (entender → buscar → armar → revisar).

El worker los anota en orden mientras arma, dentro del candado de identidad;
con el armado de mentira se queda PAUSA_DE_MENTIRA_SEG en cada uno para que
la espera se vea avanzar en dev. Anotar es cosmético: si falla, la corrida
sigue. El sondeo trae el paso SOLO mientras arma, y los segundos que lleva."""
import pytest
from fastapi.testclient import TestClient

from pipeline import db, publico
from worker import publico as worker


@pytest.fixture
def base(monkeypatch):
    """Base de mentira del worker: tomar, cerrar y anotar el paso. Como
    automatiza_paso, una corrida ya cerrada no anota nada: `pasos` es lo que
    quedó escrito, no lo que se intentó."""
    estado = {"pasos": [], "cerradas": [], "en_publico": [], "paso_falla": False}

    def paso(i, p):
        estado["en_publico"].append(db.en_camino_publico())
        if estado["paso_falla"]:
            raise db.DespertandoError("la base de datos sigue despertando")
        if estado["cerradas"]:
            return False
        estado["pasos"].append(p)
        return True

    monkeypatch.setattr(db, "automatiza_tomar", lambda i: True)
    monkeypatch.setattr(db, "automatiza_cerrar",
                        lambda i, e, **kw: estado["cerradas"].append((e, kw)) or True)
    monkeypatch.setattr(db, "automatiza_paso", paso)
    monkeypatch.setattr(publico, "encendido", lambda: True)
    monkeypatch.setattr(publico, "ARMADO_DE_MENTIRA", True)
    return estado


@pytest.fixture
def esperas(monkeypatch):
    """time.sleep de mentira: junta las pausas sin esperar de verdad."""
    hechas = []
    monkeypatch.setattr(worker.time, "sleep", hechas.append)
    return hechas


# ---------------------------------------------------------------------------
# worker

def test_la_pausa_de_mentira_es_de_dos_segundos():
    # ~8 s de espera en dev: lo bastante para ver avanzar los 4 pasos
    assert worker.PAUSA_DE_MENTIRA_SEG == 2.0
    assert db.PASOS_AUTOMATIZA == ("entender", "buscar", "armar", "revisar")


def test_anota_los_cuatro_pasos_en_orden_y_dentro_del_candado(base, esperas):
    assert worker.procesar(7) == "listo"
    assert base["pasos"] == list(db.PASOS_AUTOMATIZA)
    assert all(base["en_publico"])
    assert [e for e, _ in base["cerradas"]] == ["listo"]


def test_con_el_armado_de_mentira_espera_en_cada_paso(base, esperas):
    worker.procesar(7)
    assert esperas == [2.0] * 4


def test_con_la_pausa_en_cero_no_espera(base, esperas, monkeypatch):
    monkeypatch.setattr(worker, "PAUSA_DE_MENTIRA_SEG", 0)
    worker.procesar(7)
    assert esperas == [] and base["pasos"] == list(db.PASOS_AUTOMATIZA)


def test_con_el_armado_real_no_hay_pausa_de_mentira(base, esperas, monkeypatch):
    monkeypatch.setattr(publico, "ARMADO_DE_MENTIRA", False)
    worker.procesar(7)
    assert esperas == [] and base["pasos"] == list(db.PASOS_AUTOMATIZA)


def test_si_anotar_el_paso_falla_la_corrida_sigue(base, esperas, caplog):
    base["paso_falla"] = True
    assert worker.procesar(7) == "listo"
    assert [e for e, _ in base["cerradas"]] == ["listo"]
    assert "no se pudo anotar el paso" in caplog.text


def test_revisar_se_anota_antes_de_cerrar(base, esperas):
    # después de cerrar, automatiza_paso ya no escribe: el visitante nunca
    # vería «revisar»
    worker.procesar(7)
    assert base["pasos"][-1] == "revisar"


def test_si_el_armado_falla_no_llega_a_revisar(base, esperas, monkeypatch):
    monkeypatch.setattr(worker, "armar", lambda c: (_ for _ in ()).throw(ValueError("x")))
    assert worker.procesar(7) == "no_salio"
    assert base["pasos"] == ["entender", "buscar", "armar"]


def test_apagado_no_anota_pasos(base, esperas, monkeypatch):
    monkeypatch.setattr(publico, "encendido", lambda: False)
    assert worker.procesar(7) == "apagado"
    assert base["pasos"] == [] and esperas == []


# ---------------------------------------------------------------------------
# base

@pytest.fixture
def sql(monkeypatch):
    llamadas, respuestas = [], []

    def falso(q, params=None):
        llamadas.append((" ".join(q.split()), params or {}))
        return respuestas.pop(0) if respuestas else []
    monkeypatch.setattr(db, "ejecutar", falso)
    return llamadas, respuestas


def test_la_columna_se_agrega_sin_recrear_la_tabla():
    assert "ALTER TABLE automatiza_corridas ADD COLUMN IF NOT EXISTS paso text" in db.ESQUEMA


def test_paso_solo_se_anota_mientras_arma(sql):
    llamadas, respuestas = sql
    respuestas.append([{"id": 3}])
    with db.camino_publico():
        assert db.automatiza_paso(3, "buscar") is True
        assert db.automatiza_paso(3, "revisar") is False     # ya cerró: no toca nada
    q, p = llamadas[0]
    assert q.startswith("UPDATE automatiza_corridas SET paso = :p")
    assert "WHERE id = :i AND estado = 'armando'" in q
    assert p == {"i": 3, "p": "buscar"}


@pytest.mark.parametrize("paso", ["", "listo", "armar'; DROP TABLE x; --", None])
def test_paso_es_lista_blanca(sql, paso):
    llamadas, _ = sql
    with pytest.raises(ValueError):
        db.automatiza_paso(3, paso)
    assert llamadas == []


def test_tomar_no_depende_de_la_columna_paso(sql):
    """Si el worker nuevo llega antes que db_migrate, tomar no puede reventar:
    la corrida se quedaría en la fila para siempre (y contando para el tope
    del día). El paso del worker que murió lo pisa el primer «entender»."""
    llamadas, _ = sql
    db.automatiza_tomar(3)
    assert "paso" not in llamadas[0][0]


def test_al_retomar_lo_primero_que_se_anota_es_entender(base, esperas):
    worker.procesar(7)
    assert base["pasos"][0] == "entender"


def test_la_corrida_trae_paso_segundos_y_correo_en_una_vuelta(sql):
    llamadas, respuestas = sql
    respuestas.append([{"id": 1, "publico_id": "p", "estado": "armando", "paso": "armar",
                        "creado": "2026-10-10 12:00:00", "lleva_seg": 42,
                        "correo": "a@b.co", "nodos": None, "resultado": None}])
    with db.camino_publico():
        c = db.automatiza_corrida("p")
    assert (c["paso"], c["lleva_seg"], c["creado"]) == ("armar", 42, "2026-10-10 12:00:00")
    (q, _), = llamadas
    # el paso por to_jsonb(c): sin db_migrate da NULL («entender»), no un 500
    # en cada sondeo; c.paso revienta si la columna todavía no existe
    assert "to_jsonb(c)->>'paso' AS paso" in q and "c.paso" not in q
    assert "c.creado" in q
    # el reloj es el de la base, no el de la Lambda, y ENTERO: sin floor y
    # ::bigint, extract da numeric y el Data API lo manda como texto
    assert "GREATEST(0, floor(extract(epoch FROM now() - c.creado)))::bigint AS lleva_seg" in q
    # el correo vigente es la ÚLTIMA fila de contactos
    assert "FROM automatiza_contactos k WHERE k.corrida_id = c.id ORDER BY k.id DESC LIMIT 1" in q


# ---------------------------------------------------------------------------
# GET /api/publico/corridas/{id}

PID = "AbCdEfGhIjKlMn_-"


@pytest.fixture
def cliente():
    from server.app import app
    return TestClient(app)


def _corrida(monkeypatch, **campos):
    fila = {"id": 1, "publico_id": PID, "estado": "armando", "paso": None,
            "lleva_seg": 73, "correo": None, "nodos": None, "resultado": None,
            "motivo": None, **campos}
    monkeypatch.setattr(db, "automatiza_corrida", lambda p: dict(fila))
    monkeypatch.setattr(db, "automatiza_lugar", lambda i: 4)


@pytest.mark.parametrize("anotado,visto", [
    (None, "entender"),              # recién tomada: todavía no anota nada
    ("buscar", "buscar"), ("revisar", "revisar"),
    ("otra-cosa", "entender"),       # nunca se pinta algo fuera de la lista
])
def test_mientras_arma_trae_el_paso(cliente, monkeypatch, anotado, visto):
    _corrida(monkeypatch, paso=anotado)
    r = cliente.get(f"/api/publico/corridas/{PID}")
    assert r.status_code == 200 and r.headers["cache-control"] == "no-store"
    assert r.json() == {"id": PID, "estado": "armando", "listo": False,
                        "paso": visto, "lleva_seg": 73}


@pytest.mark.parametrize("estado", ["en_fila", "listo", "no_salio", "sin_cobertura", "rechazada"])
def test_fuera_de_armando_no_hay_paso(cliente, monkeypatch, estado):
    # un «revisar» que se quedó en la fila de una corrida cerrada no se enseña
    _corrida(monkeypatch, estado=estado, paso="revisar")
    r = cliente.get(f"/api/publico/corridas/{PID}").json()
    assert "paso" not in r and r["lleva_seg"] == 73
    if estado == "en_fila":
        assert r["lugar"] == 4


@pytest.mark.parametrize("crudo,visto", [(None, 0), (73, 73), ("176.262595", 176)])
def test_lleva_seg_es_entero(cliente, monkeypatch, crudo, visto):
    # "176.262595": un numeric tal como lo manda el Data API (decimales como texto)
    _corrida(monkeypatch, lleva_seg=crudo)
    assert cliente.get(f"/api/publico/corridas/{PID}").json()["lleva_seg"] == visto
