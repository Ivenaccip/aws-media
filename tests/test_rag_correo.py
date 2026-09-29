"""RAG·12/13 — el correo de la corrida: POST /api/publico/corridas/{id}/correo.

Se deja en la fila, en «ya está armado» o en «no salió». Cada vez se AGREGA
una fila con la prueba del consentimiento, y el texto de la casilla y la
versión del aviso los pone el servidor (server/aviso.py): el cliente solo
dice sí o no. Hacia afuera el correo viaja SIEMPRE enmascarado."""
import pytest
from fastapi.testclient import TestClient

from pipeline import db, publico
from server import aviso, publico_api
from test_rag_tuberia import TEXTO, BaseDeMentira


@pytest.fixture(autouse=True)
def entorno(monkeypatch):
    monkeypatch.setenv(publico.VAR_SAL, "sal-de-prueba")
    monkeypatch.setattr(publico, "ARMADO_DE_MENTIRA", True)


@pytest.fixture
def base(monkeypatch):
    return BaseDeMentira(monkeypatch)


@pytest.fixture
def cliente(base, monkeypatch):
    from pipeline import jobs
    monkeypatch.setattr(jobs, "encolar_publico", lambda i: None)
    # con login exigido: el correo tampoco pide token
    monkeypatch.setenv("COGNITO_POOL_ID", "us-east-1_TESTPOOL")
    monkeypatch.setenv("COGNITO_CLIENT_ID", "clienteweb123")
    from server.app import app
    return TestClient(app)


@pytest.fixture
def pid(cliente):
    r = cliente.post("/api/publico/corridas", json={"texto": TEXTO})
    assert r.status_code == 202, r.text
    return r.json()["id"]


def _correo(cliente, pid, correo="Guadalupe.Ruiz@Gmail.com ", **extra):
    return cliente.post(f"/api/publico/corridas/{pid}/correo",
                        json={"correo": correo, "recontacto": False, "origen": "fila", **extra})


# ---------------------------------------------------------------------------
# el camino bueno

def test_guarda_limpio_y_contesta_enmascarado(cliente, base, pid):
    r = _correo(cliente, pid)
    assert r.status_code == 200, r.text
    assert r.headers["cache-control"] == "no-store"
    assert r.json() == {"ok": True, "correo": "gu•••@gmail.com"}
    (fila,) = base.correos
    assert fila["corrida_id"] == 1
    assert fila["correo"] == "guadalupe.ruiz@gmail.com"      # minúsculas, sin orillas
    assert fila["origen"] == "fila" and fila["recontacto"] is False


def test_la_prueba_del_consentimiento_la_pone_el_servidor(cliente, base, pid):
    r = _correo(cliente, pid, recontacto=True, origen="listo",
                recontacto_texto="acepto todo", aviso_version="la-que-yo-diga")
    assert r.status_code == 200
    (fila,) = base.correos
    assert fila["recontacto"] is True and fila["origen"] == "listo"
    assert fila["recontacto_texto"] == aviso.RECONTACTO_TEXTO
    assert fila["aviso_version"] == aviso.AVISO_VERSION


@pytest.mark.parametrize("origen", publico_api.ORIGENES_CORREO)
def test_los_tres_origenes(cliente, base, pid, origen):
    assert _correo(cliente, pid, origen=origen).status_code == 200
    assert base.correos[-1]["origen"] == origen


def test_el_sondeo_trae_el_correo_enmascarado_nunca_el_completo(cliente, base, pid):
    assert "correo" not in cliente.get(f"/api/publico/corridas/{pid}").json()
    _correo(cliente, pid)
    r = cliente.get(f"/api/publico/corridas/{pid}")
    assert r.json()["correo"] == "gu•••@gmail.com"
    assert "guadalupe" not in r.text.lower()
    # cambiarlo vale: se ve el último
    _correo(cliente, pid, correo="otra.persona@empresa.mx")
    assert cliente.get(f"/api/publico/corridas/{pid}").json()["correo"] == "ot•••@empresa.mx"
    assert len(base.correos) == 2                              # se agrega, no se edita


def test_vale_en_listo_y_en_no_salio(cliente, base, pid):
    base.filas[1]["estado"] = "no_salio"
    assert _correo(cliente, pid, origen="no_salio").status_code == 200
    base.filas[1]["estado"] = "listo"
    assert _correo(cliente, pid, origen="listo").status_code == 200


# ---------------------------------------------------------------------------
# los no

@pytest.mark.parametrize("correo", [
    "", "   ", "sinarroba.com", "dos@@gmail.com", "a@b@c.com", "a@gmail",
    "a@.com", "a@gmail.", "a@gmail..com", "@gmail.com", "con espacio@gmail.com",
    "a@gm ail.com", "a@gmail.com, b@gmail.com", "a@gmail.com;b@x.com",
    "<a@gmail.com>", "a\x00@gmail.com", "a\n@gmail.com",
    "x" * 250 + "@g.co",                                       # más de 254
])
def test_correo_que_no_parece_correo_es_422(cliente, base, pid, correo):
    r = _correo(cliente, pid, correo=correo)
    assert r.status_code == 422
    assert r.json() == {"motivo": "correo",
                        "mensaje": "Revisa tu correo: parece que le falta algo."}
    assert base.correos == []


def test_origen_desconocido_no_se_guarda(cliente, base, pid):
    r = _correo(cliente, pid, origen="portada")
    assert r.status_code == 422 and r.json()["motivo"] == "origen"
    assert base.correos == []


@pytest.mark.parametrize("raro", ["nope", "x" * 17, "AAAAAAAAAAAAAAA'", "AAAAAAAAAAAAAAAA%0A"])
def test_id_raro_es_404_sin_tocar_la_base(cliente, base, monkeypatch, raro):
    monkeypatch.setattr(db, "automatiza_corrida",
                        lambda p: pytest.fail("un id raro no llega a la base"))
    assert _correo(cliente, raro).status_code == 404
    assert base.correos == []


def test_id_que_no_existe_es_404(cliente, base):
    r = _correo(cliente, "AAAAAAAAAAAAAAAA")
    assert r.status_code == 404 and base.correos == []


def test_rechazada_es_409_y_no_guarda(cliente, base, pid):
    base.filas[1]["estado"] = "rechazada"
    r = _correo(cliente, pid)
    assert r.status_code == 409 and r.json()["mensaje"]
    assert base.correos == []


def test_tope_de_cinco_correos_por_corrida(cliente, base, pid):
    for i in range(publico_api.TOPE_CORREOS):
        assert _correo(cliente, pid, correo=f"p{i}@gmail.com").status_code == 200
    r = _correo(cliente, pid, correo="sexto@gmail.com")
    assert r.status_code == 429
    assert r.json() == {"mensaje": "Ya cambiaste el correo varias veces. "
                                   "Si necesitas ayuda, escríbenos."}
    assert len(base.correos) == 5 and publico_api.TOPE_CORREOS == 5


def test_el_candado_de_identidad_aplica(cliente, base, pid, monkeypatch):
    # BaseDeMentira.guardar_correo exige el camino público; aquí además se
    # comprueba que nadie pide un usuario por el camino
    def prohibido():
        raise AssertionError("el correo de una corrida no es de ningún usuario")
    monkeypatch.setattr(db, "usuario_actual", prohibido)
    assert _correo(cliente, pid).status_code == 200


# ---------------------------------------------------------------------------
# piezas

@pytest.mark.parametrize("correo,visto", [
    ("guadalupe@gmail.com", "gu•••@gmail.com"),
    ("abc@x.mx", "ab•••@x.mx"),
    ("ab@x.mx", "a•••@x.mx"),          # dos letras: no se enseña el usuario entero
    ("a@x.mx", "•••@x.mx"),
])
def test_enmascarar(correo, visto):
    assert publico_api.enmascarar(correo) == visto


@pytest.mark.parametrize("crudo,limpio", [
    ("  Ana@Correo.MX ", "ana@correo.mx"),
    ("nombre.apellido+n8n@sub.dominio.com.mx", "nombre.apellido+n8n@sub.dominio.com.mx"),
    ("josé@correo.mx", "josé@correo.mx"),
])
def test_limpiar_correo_valido(crudo, limpio):
    assert publico_api.limpiar_correo(crudo) == limpio


def test_contar_correos_de_una_corrida(monkeypatch):
    llamadas = []
    monkeypatch.setattr(db, "ejecutar",
                        lambda q, p=None: llamadas.append((" ".join(q.split()), p)) or [{"n": 3}])
    with db.camino_publico():
        assert db.automatiza_correos_de(9) == 3
    assert llamadas == [("SELECT count(*) AS n FROM automatiza_contactos "
                         "WHERE corrida_id = :i", {"i": 9})]
