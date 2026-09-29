"""RAG·8 — la tubería pública de punta a punta con el flujo de mentira.

POST (puertas de RAG·7) → fila → cola → worker → «listo» → sondeo → descarga,
sin token, sin usuario y sin llamar a ningún modelo. La base es de mentira en
memoria; el recorrido contra un Postgres real se probó aparte (ver el PR)."""
import json

import pytest
from fastapi.testclient import TestClient

from pipeline import db, jobs, moderacion, publico
from worker import publico as worker


@pytest.fixture(autouse=True)
def entorno(monkeypatch):
    monkeypatch.setenv(publico.VAR_SAL, "sal-de-prueba")
    monkeypatch.setattr(publico, "ARMADO_DE_MENTIRA", True)
    monkeypatch.setattr(worker, "PAUSA_DE_MENTIRA_SEG", 0)


class BaseDeMentira:
    """Lo mínimo de automatiza_* para recorrer la tubería en memoria."""

    def __init__(self, monkeypatch):
        self.filas, self.descargas, self.encendido = {}, [], True
        self.pasos, self.correos = [], []
        m = monkeypatch.setattr
        m(db, "automatiza_interruptor", lambda: {
            "encendido": self.encendido, "tope_corridas": 20, "tope_usd": None,
            "tope_por_ip": None, "nota": None, "creado": "x"})
        m(db, "automatiza_consumo_hoy", lambda: {"corridas": 0, "usd": 0.0})
        m(db, "automatiza_corridas_de_ip_hoy", lambda h: 0)
        m(db, "automatiza_crear", self.crear)
        m(db, "automatiza_a_fila", lambda i: self._pasar(i, "recibida", "en_fila"))
        m(db, "automatiza_tomar", lambda i: self._pasar(i, "en_fila", "armando"))
        m(db, "automatiza_cerrar", self.cerrar)
        m(db, "automatiza_corrida", self.corrida)
        m(db, "automatiza_lugar", lambda i: 1 if self.filas[i]["estado"] == "en_fila" else None)
        m(db, "automatiza_descargo", lambda p, q: self.descargas.append((p, q)))
        m(db, "automatiza_paso", self.paso)
        m(db, "automatiza_guardar_correo", self.guardar_correo)
        m(db, "automatiza_correos_de",
          lambda i: sum(1 for c in self.correos if c["corrida_id"] == i))

    def crear(self, texto, *, ip_hash=None, origen=None):
        assert db.en_camino_publico()
        i = len(self.filas) + 1
        self.filas[i] = {"id": i, "publico_id": f"corrida{i:09d}", "texto": texto,
                         "ip_hash": ip_hash, "origen": origen, "estado": "recibida",
                         "motivo": None, "resultado": None, "nodos": None,
                         "paso": None, "lleva_seg": 0}
        return {"id": i, "publico_id": self.filas[i]["publico_id"]}

    def paso(self, i, paso):
        assert db.en_camino_publico()
        assert paso in db.PASOS_AUTOMATIZA
        self.pasos.append((i, paso))
        if self.filas[i]["estado"] != "armando":
            return False
        self.filas[i]["paso"] = paso
        return True

    def guardar_correo(self, i, correo, *, origen, recontacto=False,
                       recontacto_texto=None, aviso_version=None):
        assert db.en_camino_publico()
        self.correos.append({"corrida_id": i, "correo": correo, "origen": origen,
                             "recontacto": recontacto, "recontacto_texto": recontacto_texto,
                             "aviso_version": aviso_version})

    def _pasar(self, i, de, a):
        if self.filas[i]["estado"] != de:
            return False
        self.filas[i]["estado"] = a
        return True

    def cerrar(self, i, estado, *, resultado=None, nodos=None, motivo=None):
        f = self.filas[i]
        if f["estado"] in db.TERMINALES_AUTOMATIZA:
            return False
        # como el Data API: el jsonb vuelve de un viaje por JSON
        f.update(estado=estado, motivo=motivo,
                 resultado=json.loads(json.dumps(resultado)) if resultado else None,
                 nodos=nodos)
        return True

    def corrida(self, publico_id):
        # como automatiza_corrida: trae el correo vigente (la última fila)
        f = next((dict(f) for f in self.filas.values()
                  if f["publico_id"] == publico_id), None)
        if f:
            suyos = [c["correo"] for c in self.correos if c["corrida_id"] == f["id"]]
            f["correo"] = suyos[-1] if suyos else None
        return f


@pytest.fixture
def base(monkeypatch):
    return BaseDeMentira(monkeypatch)


@pytest.fixture
def cola(monkeypatch):
    """La cola de mentira: guarda lo encolado; el test decide cuándo corre el worker."""
    encoladas = []
    monkeypatch.setattr(jobs, "encolar_publico", encoladas.append)
    return encoladas


@pytest.fixture
def cliente():
    from server.app import app
    return TestClient(app)


TEXTO = "Cada vez que llegue un correo con factura, guardar el PDF en Drive."


# ---------------------------------------------------------------------------
# el recorrido entero

def test_de_punta_a_punta_sin_token(base, cola, cliente):
    r = cliente.post("/api/publico/corridas",
                     json={"texto": "  " + TEXTO, "utm_source": "comunidad"})
    assert r.status_code == 202, r.text
    assert r.headers["cache-control"] == "no-store"
    cuerpo = r.json()
    pid = cuerpo["id"]
    assert cuerpo == {"id": pid, "estado": "en_fila", "lugar": 1}
    fila = base.filas[1]
    assert fila["texto"] == TEXTO and fila["ip_hash"] and len(fila["ip_hash"]) == 32
    assert fila["origen"]["utm_source"] == "comunidad"
    assert cola == [1]

    # sondeo mientras espera
    r = cliente.get(f"/api/publico/corridas/{pid}")
    assert r.json() == {"id": pid, "estado": "en_fila", "listo": False, "lugar": 1,
                        "lleva_seg": 0}
    assert cliente.get(f"/api/publico/corridas/{pid}/flujo.json").status_code == 404

    # el worker (lo que haría SQS)
    assert worker.handler({"Records": [{"body": json.dumps(jobs.mensaje_publico(cola[0]))}]},
                          None) == {"ok": True}
    assert [p for _, p in base.pasos] == list(db.PASOS_AUTOMATIZA)
    r = cliente.get(f"/api/publico/corridas/{pid}").json()
    assert r["estado"] == "listo" and r["listo"] is True
    assert "paso" not in r                   # el paso solo viaja mientras arma
    assert r["descarga"] == f"/api/publico/corridas/{pid}/flujo.json"
    assert r["nodos"] == ["n8n-nodes-base.manualTrigger", "n8n-nodes-base.set"]

    # descarga
    r = cliente.get(r["descarga"])
    assert r.status_code == 200
    assert r.json() == worker.FLUJO_DE_MENTIRA
    assert r.headers["content-disposition"] == f'attachment; filename="automatiza-{pid}.json"'
    assert base.descargas == [(pid, "json")]


def test_no_llama_a_ningun_modelo_con_el_armado_de_mentira(base, cola, cliente, monkeypatch):
    async def prohibido(*a, **k):
        raise AssertionError("RAG·8 no gasta: sin modelo mientras el armado sea de mentira")
    monkeypatch.setattr(moderacion, "chat_json", prohibido)
    assert cliente.post("/api/publico/corridas", json={"texto": TEXTO}).status_code == 202


def test_el_armado_real_trae_la_moderacion_de_vuelta(base, cola, cliente, monkeypatch):
    # el día que RAG·21 ponga ARMADO_DE_MENTIRA = False, la moderación corre sola
    monkeypatch.setattr(publico, "ARMADO_DE_MENTIRA", False)
    llamadas = []

    async def modelo(name, system, user):
        llamadas.append(user)
        return {"permitido": False, "motivo": "Eso sería spam."}
    monkeypatch.setattr(moderacion, "chat_json", modelo)
    r = cliente.post("/api/publico/corridas", json={"texto": TEXTO})
    assert r.status_code == 422 and r.json()["mensaje"] == "Eso sería spam."
    assert llamadas == [TEXTO] and cola == []
    # se guarda como rechazada (cuenta por IP) y el sondeo dice por qué
    assert base.filas[1]["estado"] == "rechazada"
    r = cliente.get(f"/api/publico/corridas/{base.filas[1]['publico_id']}").json()
    assert r["estado"] == "rechazada" and r["mensaje"] == "Eso sería spam."


# ---------------------------------------------------------------------------
# las respuestas de no

@pytest.mark.parametrize("texto,motivo", [("hola", "corto"), ("x" * 1501, "largo")])
def test_largo_contesta_422_sin_guardar(base, cola, cliente, texto, motivo):
    r = cliente.post("/api/publico/corridas", json={"texto": texto})
    assert r.status_code == 422 and r.json()["motivo"] == motivo
    assert r.json()["maximo"] == publico.LARGO_MAXIMO
    assert base.filas == {} and cola == []


def test_apagado_contesta_503_igual_que_la_pagina(base, cola, cliente):
    base.encendido = False
    r = cliente.post("/api/publico/corridas", json={"texto": TEXTO})
    assert r.status_code == 503
    assert r.json() == {"disponible": False, "mensaje": "Ahorita no está disponible"}
    assert base.filas == {} and cola == []


def test_sin_sal_no_entra(base, cola, cliente, monkeypatch):
    monkeypatch.delenv(publico.VAR_SAL)
    assert cliente.post("/api/publico/corridas", json={"texto": TEXTO}).status_code == 503
    assert base.filas == {}


def test_si_la_cola_falla_la_corrida_no_queda_colgada(base, cliente, monkeypatch):
    def caida(i):
        raise RuntimeError("SQS no contesta")
    monkeypatch.setattr(jobs, "encolar_publico", caida)
    r = cliente.post("/api/publico/corridas", json={"texto": TEXTO})
    assert r.status_code == 503
    assert base.filas[1]["estado"] == "no_salio"


def test_apagar_con_corridas_en_fila_las_cierra_sin_armar(base, cola, cliente):
    pid = cliente.post("/api/publico/corridas", json={"texto": TEXTO}).json()["id"]
    base.encendido = False
    worker.procesar(cola[0])
    r = cliente.get(f"/api/publico/corridas/{pid}").json()
    # el visitante ve un mensaje amable, nunca el motivo interno («apagado»)
    assert r["estado"] == "no_salio" and "apagado" not in json.dumps(r)
    assert r["mensaje"] == ("Esta vez no pudimos armar un flujo que importe bien en n8n. "
                            "Preferimos no darte uno roto.")


def test_fallo_del_armado_no_filtra_la_excepcion(base, cola, cliente, monkeypatch):
    pid = cliente.post("/api/publico/corridas", json={"texto": TEXTO}).json()["id"]
    monkeypatch.setattr(worker, "armar", lambda c: (_ for _ in ()).throw(
        ValueError("detalle interno /var/task/secreto.py")))
    worker.procesar(cola[0])
    r = cliente.get(f"/api/publico/corridas/{pid}")
    assert "secreto" not in r.text and r.json()["estado"] == "no_salio"


@pytest.mark.parametrize("pid", ["nope", "x" * 17, "../../etc/passwd", "corrida00000001'"])
def test_ids_raros_no_llegan_a_la_base(base, cliente, monkeypatch, pid):
    monkeypatch.setattr(db, "automatiza_corrida",
                        lambda p: (_ for _ in ()).throw(AssertionError("no debió consultar")))
    assert cliente.get(f"/api/publico/corridas/{pid}").status_code == 404


def test_id_que_no_existe_da_404(base, cliente):
    assert cliente.get("/api/publico/corridas/AAAAAAAAAAAAAAAA").status_code == 404


def test_un_token_ajeno_se_ignora(base, cola, cliente):
    # el camino público no mira el token: ni lo pide ni lo usa si viene
    r = cliente.post("/api/publico/corridas", json={"texto": TEXTO},
                     headers={"Authorization": "Bearer basura"})
    assert r.status_code == 202
