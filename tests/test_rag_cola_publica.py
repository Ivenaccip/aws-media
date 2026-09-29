"""RAG·4 — cola y worker propios de /automatiza.

El worker toma, arma y cierra una corrida dentro del candado de identidad; un
fallo del armado se cierra como «no_salio» y NO se relanza; solo se relanza
si ni siquiera se pudo escribir en la base. Lo que se encola va a la cola
pública, nunca a la de pago. La infra (solo en dev, prod idéntico) se vigila
en tests/test_entornos.py."""
import json

import pytest

from pipeline import db, jobs
from worker import publico


@pytest.fixture
def base(monkeypatch):
    """Una base de mentira con lo mínimo: tomar y cerrar."""
    estado = {"tomada": True, "cerradas": [], "en_publico": []}

    def tomar(i):
        estado["en_publico"].append(db.en_camino_publico())
        return estado["tomada"]

    def cerrar(i, e, **kw):
        estado["en_publico"].append(db.en_camino_publico())
        estado["cerradas"].append((i, e, kw))
        return True
    monkeypatch.setattr(db, "automatiza_tomar", tomar)
    monkeypatch.setattr(db, "automatiza_cerrar", cerrar)
    return estado


def test_procesar_cierra_listo_con_el_flujo(base):
    assert publico.procesar(7) == "listo"
    (i, e, kw), = base["cerradas"]
    assert (i, e) == (7, "listo")
    assert kw["resultado"]["flujo"]["nodes"]
    assert kw["nodos"] == ["n8n-nodes-base.manualTrigger", "n8n-nodes-base.set"]
    assert all(base["en_publico"]), "todo el worker corre dentro del candado"


def test_procesar_no_toca_una_corrida_ajena(base):
    base["tomada"] = False
    assert publico.procesar(7) == "ajena"
    assert base["cerradas"] == []


def test_fallo_del_armado_cierra_no_salio_y_no_relanza(base, monkeypatch):
    def truena(_):
        raise ValueError("flujo imposible")
    monkeypatch.setattr(publico, "armar", truena)
    assert publico.procesar(7) == "no_salio"
    (_, e, kw), = base["cerradas"]
    assert e == "no_salio" and kw["motivo"] == "ValueError: flujo imposible"


def test_si_el_armado_pide_usuario_revienta_y_cierra(base, monkeypatch):
    # el candado de RAG·1 funciona también en el worker
    monkeypatch.setattr(publico, "armar", lambda c: db.usuario_actual())
    assert publico.procesar(7) == "no_salio"
    assert base["cerradas"][0][2]["motivo"].startswith("IdentidadEnCaminoPublico")


def test_sin_base_si_relanza(monkeypatch):
    # no poder escribir es lo único que merece el reintento de SQS
    def caida(i):
        raise db.DespertandoError("la base de datos sigue despertando")
    monkeypatch.setattr(db, "automatiza_tomar", caida)
    with pytest.raises(db.DespertandoError):
        publico.procesar(7)


def test_el_flujo_de_mentira_se_importa_en_n8n():
    f = publico.FLUJO_DE_MENTIRA
    nombres = {n["name"] for n in f["nodes"]}
    assert len({n["id"] for n in f["nodes"]}) == len(f["nodes"])
    for origen, salidas in f["connections"].items():
        assert origen in nombres
        for rama in salidas["main"]:
            assert all(c["node"] in nombres for c in rama)
    json.dumps(f)


def _evento(*cuerpos):
    return {"Records": [{"body": c} for c in cuerpos]}


def test_handler_procesa_cada_mensaje(base):
    r = publico.handler(_evento(json.dumps(jobs.mensaje_publico(1)),
                                json.dumps(jobs.mensaje_publico(2))), None)
    assert r == {"ok": True}
    assert [c[0] for c in base["cerradas"]] == [1, 2]


@pytest.mark.parametrize("cuerpo", [
    "no es json", "{}", json.dumps({"tipo": "preparar", "corrida_id": 1}),
    json.dumps({"tipo": "automatiza", "corrida_id": "x"}),
])
def test_handler_ignora_mensajes_ajenos_sin_relanzar(base, cuerpo):
    assert publico.handler(_evento(cuerpo), None) == {"ok": True}
    assert base["cerradas"] == []


def test_el_worker_publico_no_importa_el_de_pago():
    fuente = open(publico.__file__, encoding="utf-8").read()
    assert "lambda_worker" not in fuente.split('"""', 2)[2]
    assert "cargar_env_usuario" not in fuente


# ---------------------------------------------------------------------------
# encolar

def test_encolar_publico_va_a_la_cola_publica(monkeypatch):
    enviados = []
    monkeypatch.setenv("JOBS_BACKEND", "aws")
    monkeypatch.setenv("PUBLICO_QUEUE_URL", "https://sqs/publico")
    monkeypatch.setenv("JOBS_QUEUE_URL", "https://sqs/de-pago")
    monkeypatch.setattr(jobs, "_sqs", lambda: type("S", (), {
        "send_message": staticmethod(lambda **kw: enviados.append(kw))})())
    jobs.encolar_publico(42)
    (kw,), = [enviados]
    assert kw["QueueUrl"] == "https://sqs/publico"
    assert json.loads(kw["MessageBody"]) == {"tipo": "automatiza", "corrida_id": 42}


def test_encolar_publico_sin_su_cola_no_cae_en_la_de_pago(monkeypatch):
    monkeypatch.setenv("JOBS_BACKEND", "aws")
    monkeypatch.delenv("PUBLICO_QUEUE_URL", raising=False)
    monkeypatch.setenv("JOBS_QUEUE_URL", "https://sqs/de-pago")
    monkeypatch.setattr(jobs, "_sqs", lambda: pytest.fail("no debe enviar"))
    with pytest.raises(KeyError):
        jobs.encolar_publico(42)


def test_encolar_publico_en_local_corre_en_un_hilo(monkeypatch):
    import threading
    hecho = threading.Event()
    monkeypatch.setenv("JOBS_BACKEND", "local")
    monkeypatch.setattr(publico, "procesar", lambda i: hecho.set())
    jobs.encolar_publico(3)
    assert hecho.wait(2)


# ---------------------------------------------------------------------------
# retomar una corrida de un worker que murió a medias

def test_tomar_retoma_armando_viejo_y_cuenta_el_reintento(monkeypatch):
    llamadas = []
    monkeypatch.setattr(db, "ejecutar", lambda q, p=None: llamadas.append(" ".join(q.split())) or [])
    assert db.automatiza_tomar(1) is False
    q = llamadas[0]
    assert "estado = 'en_fila'" in q
    assert f"interval '{db.RETOMAR_AUTOMATIZA_MIN} minutes'" in q
    assert "reintentos = reintentos + CASE WHEN estado = 'armando'" in q


def test_retomar_es_mas_largo_que_el_worker():
    # si fuera menor, un worker VIVO perdería su corrida a manos del reintento
    texto = open("infra/stacks/jobs.py", encoding="utf-8").read()
    bloque = texto[texto.index("def _tuberia_publica"):]
    assert "timeout=Duration.minutes(5)" in bloque
    assert "visibility_timeout=Duration.minutes(6)" in bloque
    assert db.RETOMAR_AUTOMATIZA_MIN >= 6
