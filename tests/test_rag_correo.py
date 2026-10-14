"""RAG·12/13 — el correo de la corrida: POST /api/publico/corridas/{id}/correo.

Se deja en la fila, en «ya está armado» o en «no salió». Cada vez se AGREGA
una fila con la prueba del consentimiento, y el texto de la casilla y la
versión del aviso los pone el servidor (server/aviso.py): el cliente solo
dice sí o no. Hacia afuera el correo viaja SIEMPRE enmascarado."""
import pytest
from fastapi.testclient import TestClient

from pipeline import db, publico
from server import aviso, publico_api
from test_rag_tuberia import AVISO, TEXTO, BaseDeMentira


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
    r = cliente.post("/api/publico/corridas", json={**AVISO, "texto": TEXTO})
    assert r.status_code == 202, r.text
    return r.json()["id"]


def _correo(cliente, pid, correo="Guadalupe.Ruiz@Gmail.com ", **extra):
    # la página manda la versión del aviso con la que se llenó (data-aviso-version)
    return cliente.post(f"/api/publico/corridas/{pid}/correo",
                        json={"correo": correo, "recontacto": False, "origen": "fila",
                              "aviso_version": aviso.AVISO_VERSION, **extra})


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
                recontacto_texto="acepto todo")
    assert r.status_code == 200
    (fila,) = base.correos
    assert fila["recontacto"] is True and fila["origen"] == "listo"
    assert fila["recontacto_texto"] == aviso.RECONTACTO_TEXTO
    assert fila["aviso_version"] == aviso.AVISO_VERSION


@pytest.mark.parametrize("vio", ["2026-01-01-la-de-antes", "la-que-yo-diga", None])
def test_con_otro_aviso_en_la_pagina_no_se_guarda(cliente, base, pid, vio):
    """Una pestaña abierta desde antes de un deploy que cambió la casilla o el
    aviso: guardar el texto de HOY sería registrar un consentimiento a algo
    que la persona no vio. Se le pide recargar (y sin versión, igual)."""
    extra = {"aviso_version": vio} if vio else {}
    r = cliente.post(f"/api/publico/corridas/{pid}/correo",
                     json={"correo": "ana@correo.mx", "recontacto": True, "origen": "listo",
                           **extra})
    assert r.status_code == 409
    assert r.json() == {"motivo": "aviso", "mensaje": publico_api.MENSAJE_AVISO}
    assert "Recarga la página" in publico_api.MENSAJE_AVISO
    assert base.correos == []


def test_la_prueba_e2e_manda_la_version_del_aviso(monkeypatch):
    """tools/automatiza_e2e.py --correo hace lo que la página: la versión la
    lee de /automatiza (data-aviso-version). Sin ella, el 409 de arriba deja
    la prueba de punta a punta en rojo."""
    from tools import automatiza_e2e as e2e

    class Respuesta:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def read(self):
            return aviso.renderizar("automatiza.html").encode()
    monkeypatch.setattr(e2e.urllib.request, "urlopen", lambda req, timeout: Respuesta())
    assert e2e.version_del_aviso("https://x") == aviso.AVISO_VERSION

    posts = []

    def pedir(metodo, url, cuerpo=None):
        if url.endswith("/estado"):
            return 200, {"disponible": True}, 1
        if metodo == "POST" and url.endswith("/correo"):
            posts.append(cuerpo)
            return 200, {"ok": True, "correo": "tu•••@x.mx"}, 1
        if metodo == "POST":
            return 202, {"id": "AAAAAAAAAAAAAAAA"}, 1
        if url.endswith(".json"):
            return 200, {"nodes": [{}]}, 1
        return 200, {"estado": "listo", "listo": True, "correo": "tu•••@x.mx",
                     "descarga": "/api/publico/corridas/AAAAAAAAAAAAAAAA/flujo.json"}, 1
    corridas = []

    def pedir_y_anotar(metodo, url, cuerpo=None):
        if metodo == "POST" and url.endswith("/corridas"):
            corridas.append(cuerpo)
        return pedir(metodo, url, cuerpo)
    monkeypatch.setattr(e2e, "_pedir", pedir_y_anotar)
    monkeypatch.setattr(e2e, "revisar_paginas", lambda api, pid: True)
    assert e2e.main(["--api", "https://x", "--correo", "tu@x.mx"]) == 0
    assert posts == [{"correo": "tu@x.mx", "recontacto": False, "origen": "listo",
                      "aviso_version": aviso.AVISO_VERSION}]
    # la corrida también viaja con la versión del aviso (RAG·13)
    assert [c["aviso_version"] for c in corridas] == [aviso.AVISO_VERSION]


@pytest.mark.parametrize("origen", publico_api.ORIGENES_CORREO)
def test_los_origenes(cliente, base, pid, origen):
    assert _correo(cliente, pid, origen=origen).status_code == 200
    assert base.correos[-1]["origen"] == origen


def test_se_paso_del_tiempo_tiene_su_origen():
    # 2d sale también mientras arma: no es «fila» (RAG·16/28 leen el origen)
    assert publico_api.ORIGENES_CORREO == ("listo", "fila", "no_salio", "espera")


@pytest.mark.parametrize("estado", ["en_fila", "armando", "listo", "no_salio", "sin_cobertura"])
def test_el_sondeo_trae_el_correo_enmascarado_nunca_el_completo(cliente, base, pid, estado):
    """El enlace /automatiza/c/{id} se comparte: en NINGÚN estado sale el
    correo completo (tampoco en «listo», donde la página dice «Te lo mandamos a…»)."""
    assert "correo" not in cliente.get(f"/api/publico/corridas/{pid}").json()
    _correo(cliente, pid)
    base.filas[1]["estado"] = estado
    r = cliente.get(f"/api/publico/corridas/{pid}")
    assert r.json()["estado"] == estado
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


def test_el_api_deja_el_tope_a_la_sentencia_que_guarda(cliente, base, pid, monkeypatch):
    """Contar aparte (automatiza_correos_de) y luego guardar es la carrera que
    dejaba pasar de 8 a 20 correos con peticiones simultáneas: el API le pasa
    el tope a automatiza_guardar_correo, que cuenta y guarda en una sentencia."""
    topes, guardar = [], base.guardar_correo

    def espia(i, correo, **kw):
        topes.append(kw.get("tope"))
        return guardar(i, correo, **kw)
    monkeypatch.setattr(db, "automatiza_guardar_correo", espia)
    monkeypatch.setattr(db, "automatiza_correos_de",
                        lambda i: pytest.fail("contar aparte y luego guardar es la carrera"))
    assert _correo(cliente, pid).status_code == 200
    assert topes == [publico_api.TOPE_CORREOS]


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


@pytest.fixture
def sql(monkeypatch):
    llamadas, respuestas = [], []

    def falso(q, p=None):
        llamadas.append((" ".join(q.split()), p))
        r = respuestas.pop(0) if respuestas else []
        if isinstance(r, Exception):
            raise r
        return r
    monkeypatch.setattr(db, "ejecutar", falso)
    return llamadas, respuestas


def test_la_cuenta_del_tope_vive_en_la_corrida():
    assert ("ALTER TABLE automatiza_corridas ADD COLUMN IF NOT EXISTS correos int "
            "NOT NULL DEFAULT 0") in db.ESQUEMA


def test_el_tope_se_cuenta_y_se_guarda_en_una_sola_sentencia(sql):
    """Contar y luego insertar son dos viajes: con 30 peticiones a la vez
    pasaban de 8 a 20 correos. El UPDATE toma el candado de la fila de la
    corrida y Postgres vuelve a mirar `correos < :tope` tras esperar."""
    llamadas, respuestas = sql
    respuestas.extend([[{"id": 7}], []])
    with db.camino_publico():
        assert db.automatiza_guardar_correo(9, " a@b.co ", origen="fila", recontacto=True,
                                            recontacto_texto="Quiero…", aviso_version="v",
                                            tope=5) is True
        assert db.automatiza_guardar_correo(9, "a@b.co", origen="fila", tope=5) is False
    (q, p), _ = llamadas
    assert q == ("WITH turno AS ( UPDATE automatiza_corridas SET correos = correos + 1 "
                 "WHERE id = :i AND correos < :tope RETURNING id) "
                 "INSERT INTO automatiza_contactos (corrida_id, correo, origen, recontacto, "
                 "recontacto_texto, aviso_version) SELECT id, :c, :o, :r, :t, :v FROM turno "
                 "RETURNING id")
    assert p == {"i": 9, "c": "a@b.co", "o": "fila", "r": True, "t": "Quiero…", "v": "v",
                 "tope": 5}


@pytest.mark.parametrize("hay,guarda", [(2, True), (5, False)])
def test_sin_db_migrate_el_correo_se_sigue_guardando(sql, hay, guarda):
    """Si el API nuevo llega antes que la columna, «Mandármelo y descargar» no
    puede dar 500: vuelve al tope de antes (contar y luego guardar)."""
    llamadas, respuestas = sql
    respuestas.extend([RuntimeError('column "correos" of relation "automatiza_corridas" '
                                    'does not exist'), [{"n": hay}], []])
    with db.camino_publico():
        assert db.automatiza_guardar_correo(9, "a@b.co", origen="fila", tope=5) is guarda
    assert llamadas[1][0].startswith("SELECT count(*) AS n FROM automatiza_contactos")
    assert len(llamadas) == (3 if guarda else 2)
    if guarda:
        assert llamadas[2][0].startswith("INSERT INTO automatiza_contactos")


def test_otro_error_de_la_base_no_se_perdona(sql):
    _, respuestas = sql
    respuestas.append(RuntimeError('relation "automatiza_contactos" does not exist'))
    with db.camino_publico(), pytest.raises(RuntimeError):
        db.automatiza_guardar_correo(9, "a@b.co", origen="fila", tope=5)


def test_contar_correos_de_una_corrida(monkeypatch):
    llamadas = []
    monkeypatch.setattr(db, "ejecutar",
                        lambda q, p=None: llamadas.append((" ".join(q.split()), p)) or [{"n": 3}])
    with db.camino_publico():
        assert db.automatiza_correos_de(9) == 3
    assert llamadas == [("SELECT count(*) AS n FROM automatiza_contactos "
                         "WHERE corrida_id = :i", {"i": 9})]


# ---------------------------------------------------------------------------
# RAG·13 — el aviso se acepta en el pop-up ANTES de mandar la descripción:
# POST /corridas exige la versión vigente igual que el del correo, y la
# corrida guarda cuál aceptó (automatiza_corridas.aviso_version)

@pytest.mark.parametrize("vio", ["2026-01-01-la-de-antes", "", None])
def test_pedir_sin_el_aviso_vigente_da_409_y_no_guarda_nada(cliente, base, monkeypatch, vio):
    """Sin aviso aceptado (o con uno viejo) no se guarda la descripción, no se
    modera (cuesta) ni cuenta para el tope por IP: la página vuelve a abrir el
    aviso. Por eso va antes que todo lo demás."""
    from pipeline import jobs
    encoladas = []
    monkeypatch.setattr(jobs, "encolar_publico", encoladas.append)

    async def admitir(*a, **k):
        raise AssertionError("sin aviso aceptado no se admite nada")
    monkeypatch.setattr(publico, "admitir", admitir)
    extra = {"aviso_version": vio} if vio is not None else {}
    r = cliente.post("/api/publico/corridas", json={"texto": TEXTO, **extra})
    assert r.status_code == 409
    assert r.headers["cache-control"] == "no-store"
    assert r.json() == {"motivo": "aviso", "mensaje": publico_api.MENSAJE_AVISO_PEDIR}
    assert base.filas == {} and encoladas == []


def test_pedir_guarda_la_version_que_acepto(cliente, base):
    r = cliente.post("/api/publico/corridas", json={**AVISO, "texto": TEXTO, "utm_source": "ig"})
    assert r.status_code == 202, r.text
    fila = base.filas[1]
    assert fila["aviso_version"] == aviso.AVISO_VERSION
    # la versión no se cuela en el origen (referrer y utm)
    assert "aviso_version" not in fila["origen"] and fila["origen"]["utm_source"] == "ig"


def test_la_version_aceptada_vive_en_la_corrida():
    assert ("ALTER TABLE automatiza_corridas ADD COLUMN IF NOT EXISTS aviso_version text"
            in db.ESQUEMA)


def test_crear_guarda_la_version_en_su_columna(sql):
    llamadas, respuestas = sql
    respuestas.append([{"id": 7, "publico_id": "x"}])
    with db.camino_publico():
        assert db.automatiza_crear("texto", ip_hash="h", aviso_version="v1") == {
            "id": 7, "publico_id": "x"}
    ((q, p),) = llamadas
    assert q.startswith("INSERT INTO automatiza_corridas (publico_id, texto, ip_hash, referrer,")
    assert ", aviso_version) VALUES (" in q and q.endswith(":v) RETURNING id, publico_id")
    assert p["v"] == "v1" and p["t"] == "texto"


def test_sin_db_migrate_la_corrida_se_guarda_sin_la_version(sql):
    """Si el API nuevo llega antes que la columna, «Armar mi flujo» no puede
    dar 500: se guarda la corrida sin la versión (la vigente es la del deploy)."""
    llamadas, respuestas = sql
    respuestas.extend([RuntimeError('column "aviso_version" of relation '
                                    '"automatiza_corridas" does not exist'),
                       [{"id": 8, "publico_id": "y"}]])
    with db.camino_publico():
        assert db.automatiza_crear("texto", aviso_version="v1") == {"id": 8, "publico_id": "y"}
    (q1, _), (q2, p2) = llamadas
    assert "aviso_version" in q1
    assert "aviso_version" not in q2 and "v" not in p2 and p2["t"] == "texto"


def test_crear_no_perdona_otro_error(sql):
    llamadas, respuestas = sql
    respuestas.append(RuntimeError('column "referrer" of relation "automatiza_corridas" '
                                   'does not exist'))
    with db.camino_publico(), pytest.raises(RuntimeError):
        db.automatiza_crear("texto", aviso_version="v1")
    assert len(llamadas) == 1


def test_crear_sin_version_no_la_nombra(sql):
    # quien no la pasa (tools, pruebas viejas) guarda como antes
    llamadas, respuestas = sql
    respuestas.append([{"id": 1, "publico_id": "z"}])
    db.automatiza_crear("texto")
    assert "aviso_version" not in llamadas[0][0]
