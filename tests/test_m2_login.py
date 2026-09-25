"""M2 — login: identidad por-request (contextvar), verificación del id_token,
middleware que exige el JWT en /api/* y /editor/* (header o cookie) y
tools/usuarios.py (alta con cortesía, suspender con revocación, adoptar).
Sin red — Cognito y la Data API van con monkeypatch; la firma RS256 es real."""
import importlib.util
import time
from pathlib import Path
from types import SimpleNamespace

import jwt as pyjwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient

from pipeline import db
from server import auth

REPO = Path(__file__).resolve().parent.parent
POOL = "us-east-1_TESTPOOL"
CLIENTE = "clienteweb123"


# ---------------------------------------------------------------------------
# identidad por-request

def test_usuario_actual_contextvar():
    assert db.usuario_actual() == "piloto"          # sin request: cae al default
    marca = db.fijar_usuario("sub-abc")
    assert db.usuario_actual() == "sub-abc"
    db._usuario_request.reset(marca)
    assert db.usuario_actual() == "piloto"


# ---------------------------------------------------------------------------
# verificación del id_token (firma RS256 real, JWKS falso)

@pytest.fixture
def cognito_env(monkeypatch):
    monkeypatch.setenv("COGNITO_POOL_ID", POOL)
    monkeypatch.setenv("COGNITO_CLIENT_ID", CLIENTE)


@pytest.fixture
def llave():
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


def _token(llave, **extra):
    claims = {"sub": "sub-abc", "aud": CLIENTE, "token_use": "id",
              "iss": f"https://cognito-idp.us-east-1.amazonaws.com/{POOL}",
              "exp": int(time.time()) + 3600, "email": "x@y.com"}
    claims.update(extra)
    return pyjwt.encode(claims, llave, algorithm="RS256")


def _jwks_falso(monkeypatch, llave):
    falso = SimpleNamespace(get_signing_key_from_jwt=lambda t: SimpleNamespace(key=llave.public_key()))
    monkeypatch.setattr(auth, "_jwks", lambda: falso)


def test_verificar_acepta_id_token_valido(cognito_env, llave, monkeypatch):
    _jwks_falso(monkeypatch, llave)
    claims = auth.verificar(_token(llave))
    assert claims["sub"] == "sub-abc" and claims["email"] == "x@y.com"


@pytest.mark.parametrize("extra", [
    {"token_use": "access"},                       # solo id_token
    {"exp": int(time.time()) - 10},                # vencido
    {"aud": "otro-cliente"},                       # de otro client
    {"iss": "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_OTRO"},
])
def test_verificar_rechaza(cognito_env, llave, monkeypatch, extra):
    _jwks_falso(monkeypatch, llave)
    with pytest.raises(Exception):
        auth.verificar(_token(llave, **extra))


def test_verificar_rechaza_firma_ajena(cognito_env, llave, monkeypatch):
    _jwks_falso(monkeypatch, llave)
    otra = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    with pytest.raises(Exception):
        auth.verificar(_token(otra))


# ---------------------------------------------------------------------------
# middleware: exige token en /api/* (header o cookie), config queda público

@pytest.fixture
def cliente(cognito_env, monkeypatch):
    from server.app import app
    monkeypatch.setattr(auth, "verificar",
                        lambda t: {"sub": "sub-abc"} if t == "BUENO" else (_ for _ in ()).throw(ValueError(t)))
    return TestClient(app)


def test_api_sin_token_401(cliente):
    r = cliente.get("/api/estilos")
    assert r.status_code == 401 and "sesión" in r.json()["detail"].lower()


def test_api_con_bearer_pasa_y_fija_usuario(cliente, monkeypatch):
    from server import app as srv
    visto = {}
    monkeypatch.setattr(srv, "listar_proyectos",
                        lambda: visto.setdefault("u", db.usuario_actual()) and [] or [])
    r = cliente.get("/api/proyectos", headers={"Authorization": "Bearer BUENO"})
    assert r.status_code == 200
    assert visto["u"] == "sub-abc"                 # el sub llegó a usuario_actual()


def test_api_con_cookie_pasa(cliente):
    r = cliente.get("/api/estilos", cookies={"token": "BUENO"})
    assert r.status_code == 200


def test_api_token_invalido_401(cliente):
    r = cliente.get("/api/estilos", headers={"Authorization": "Bearer MALO"})
    assert r.status_code == 401 and "venció" in r.json()["detail"]


def test_navegacion_html_sin_token_redirige_a_entrar(cliente):
    # tarjeta 37: ya no a «/» (la portada pública), sino a /entrar con la ruta
    r = cliente.get("/editor/x", headers={"Accept": "text/html"}, follow_redirects=False)
    assert r.status_code in (302, 307) and r.headers["location"] == "/entrar?volver=%2Feditor%2Fx"


def test_auth_config_es_publico(cliente, monkeypatch):
    monkeypatch.setenv("COGNITO_DOMINIO", "media-ivenaccip.auth.us-east-1.amazoncognito.com")
    r = cliente.get("/api/auth/config")
    assert r.status_code == 200
    d = r.json()
    assert d["activo"] is True and d["client_id"] == CLIENTE and "amazoncognito" in d["dominio"]


def test_estaticos_quedan_publicos(cliente):
    assert cliente.get("/callback.html").status_code == 200


def test_sin_cognito_todo_pasa_como_piloto(monkeypatch):
    monkeypatch.delenv("COGNITO_POOL_ID", raising=False)
    from server.app import app
    r = TestClient(app).get("/api/estilos")
    assert r.status_code == 200                    # dev local: sin login, como siempre


# ---------------------------------------------------------------------------
# tools/usuarios.py

@pytest.fixture
def usuarios_mod():
    spec = importlib.util.spec_from_file_location("usuarios_m2", REPO / "tools" / "usuarios.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class CognitoFalso:
    def __init__(self):
        self.llamadas = []

    def admin_create_user(self, **kw):
        self.llamadas.append(("create", kw))
        return {"User": {"Attributes": [{"Name": "sub", "Value": "sub-nuevo"}]}}

    def admin_get_user(self, **kw):
        self.llamadas.append(("get", kw))
        return {"UserAttributes": [{"Name": "sub", "Value": "sub-nuevo"}]}

    def admin_disable_user(self, **kw):
        self.llamadas.append(("disable", kw))

    def admin_user_global_sign_out(self, **kw):
        self.llamadas.append(("signout", kw))


@pytest.mark.parametrize("plan,esperado", [("mensual", 100), ("anual", 200)])
def test_alta_crea_en_cognito_y_abona_cortesia(usuarios_mod, monkeypatch, plan, esperado):
    falso = CognitoFalso()
    monkeypatch.setattr(usuarios_mod, "_cognito", lambda pool=None: falso)
    abonos, sqls = [], []
    monkeypatch.setattr(db, "ejecutar", lambda sql, p=None: sqls.append(sql) or [])
    monkeypatch.setattr(db, "abonar_creditos",
                        lambda u, n, t, r=None: abonos.append((u, n, t, r)) or n)
    sub = usuarios_mod.alta(POOL, "nuevo@x.com", plan)
    assert sub == "sub-nuevo"
    kw = falso.llamadas[0][1]
    assert kw["Username"] == "nuevo@x.com" and kw["DesiredDeliveryMediums"] == ["EMAIL"]
    assert "MessageAction" not in kw               # invitación nueva, no RESEND
    assert abonos == [("sub-nuevo", esperado, "cortesia", f"alta-{plan}")]
    assert any("INSERT INTO usuarios" in s for s in sqls)


def test_alta_reenviar_no_vuelve_a_abonar(usuarios_mod, monkeypatch):
    falso = CognitoFalso()
    monkeypatch.setattr(usuarios_mod, "_cognito", lambda pool=None: falso)
    monkeypatch.setattr(db, "abonar_creditos",
                        lambda *a, **k: pytest.fail("reenviar NO re-abona cortesía"))
    usuarios_mod.alta(POOL, "nuevo@x.com", "mensual", reenviar=True)
    assert falso.llamadas[0][1]["MessageAction"] == "RESEND"


def test_suspender_deshabilita_y_revoca_sesiones(usuarios_mod, monkeypatch):
    falso = CognitoFalso()
    monkeypatch.setattr(usuarios_mod, "_cognito", lambda pool=None: falso)
    usuarios_mod.suspender(POOL, "churn@x.com")
    assert [n for n, _ in falso.llamadas] == ["disable", "signout"]


def test_adoptar_migra_tablas_y_saldo(usuarios_mod, monkeypatch):
    falso = CognitoFalso()
    monkeypatch.setattr(usuarios_mod, "_cognito", lambda pool=None: falso)
    sqls, abonos = [], []
    monkeypatch.setattr(db, "ejecutar", lambda sql, p=None: sqls.append((sql, p)) or [])
    monkeypatch.setattr(db, "saldo_creditos", lambda u: 70 if u == "piloto" else 170)
    monkeypatch.setattr(db, "abonar_creditos",
                        lambda u, n, t, r=None: abonos.append((u, n, t, r)) or n)
    usuarios_mod.adoptar(POOL, "ivenaccip@gmail.com", "piloto")
    actualizadas = [p for s, p in sqls if s.startswith("UPDATE")]
    assert len(actualizadas) == 6 and all(p == {"n": "sub-nuevo", "v": "piloto"} for p in actualizadas)
    # las reservas de nombre viajan con los proyectos del editor
    assert any("UPDATE nombres_editor" in s for s, _ in sqls)
    assert ("sub-nuevo", 70, "ajuste", "adopcion:piloto") in abonos
    assert ("piloto", -70, "ajuste", "adopcion:sub-nuevo") in abonos


def test_cortesia_sale_de_tarifas_json(usuarios_mod):
    import json
    tarifas = json.loads((REPO / "tools" / "tarifas.json").read_text(encoding="utf-8"))
    assert usuarios_mod.cortesia("mensual") == tarifas["cortesia_mensual"]["mensual"]
    assert usuarios_mod.cortesia("anual") == tarifas["cortesia_mensual"]["anual"]


# ---------------------------------------------------------------------------
# B2 — altas en tanda. Lo que se prueba aquí no es «que funcione»: es que los
# tres fallos caros de una tanda de 50 sean imposibles. Un rebote duro gasta
# reputación del remitente (10 malas de 182 = 5.5%, por encima del umbral de
# revisión), un usuario creado sin correo enviado espera una clave que no
# existe, y un `alta` repetido re-abonaría cortesía porque el índice único del
# monedero solo cubre `tipo='compra'`.

def test_revisar_normaliza(usuarios_mod):
    """La misma persona escrita de tres formas es una sola dirección."""
    for crudo in ("  Correo@Gmail.COM ", "<correo@gmail.com>", "CORREO@GMAIL.COM"):
        correo, rechazo, sospecha = usuarios_mod.revisar(crudo)
        assert (correo, rechazo, sospecha) == ("correo@gmail.com", None, None)


@pytest.mark.parametrize("basura", [
    "", "   ", "sin-arroba", "dos@@arrobas.com", "sin@dominio",
    "espacio en@medio.com", "@gmail.com", "termina@gmail.",
])
def test_revisar_rechaza_lo_que_reboteria(usuarios_mod, basura):
    _correo, rechazo, _sospecha = usuarios_mod.revisar(basura)
    assert rechazo, f"{basura!r} pasó el filtro y habría rebotado"


@pytest.mark.parametrize("dedazo,sugerido", [
    ("gmial.com", "gmail.com"),      # TRANSPOSICIÓN: el más común de todos
    ("gmai.com", "gmail.com"),
    ("gmail.con", "gmail.com"),
    ("hotmial.com", "hotmail.com"),
    ("outlok.com", "outlook.com"),
    ("yaho.com", "yahoo.com"),
])
def test_revisar_caza_el_dedazo_de_dominio(usuarios_mod, dedazo, sugerido):
    """`gmial.com` está a distancia 2 en Levenshtein puro: sin contar la
    transposición como un paso, el dedazo más frecuente se cuela entero."""
    _correo, rechazo, sospecha = usuarios_mod.revisar(f"quien@{dedazo}")
    assert not rechazo                      # tiene forma válida, el fallo es el dominio
    assert sospecha and sugerido in sospecha


@pytest.mark.parametrize("legitimo", [
    "mail.com",          # a un paso de gmail.com y es un proveedor real
    "me.com", "live.com", "prodigy.net.mx", "miempresa.com.mx",
])
def test_revisar_no_marca_dominios_buenos(usuarios_mod, legitimo):
    """Un falso positivo aquí manda a preguntarle a alguien cuyo correo estaba
    bien: el filtro tiene que ser silencioso con lo que no es un dedazo."""
    _correo, rechazo, sospecha = usuarios_mod.revisar(f"quien@{legitimo}")
    assert not rechazo and not sospecha


def test_leer_lista_anota_comenta_y_lleva_plan_por_linea(usuarios_mod, tmp_path):
    lista = tmp_path / "tanda1.txt"
    lista.write_text("# tanda 1 — lunes\n\nuno@gmail.com\n"
                     "dos@gmail.com, anual\ntres@gmail.com  anual  # VIP\n",
                     encoding="utf-8")
    filas = usuarios_mod.leer_lista(lista, "mensual")
    assert [(c, p) for _n, c, p in filas] == [
        ("uno@gmail.com", "mensual"),        # cae al --plan de la corrida
        ("dos@gmail.com", "anual"),
        ("tres@gmail.com", "anual"),         # y el `#` de la cola no estorba
    ]


@pytest.fixture
def lote(usuarios_mod, monkeypatch, tmp_path):
    """Devuelve (correr, falso) — `correr` toma el texto de la lista y kwargs."""
    falso = CognitoFalso()
    monkeypatch.setattr(usuarios_mod, "_cognito", lambda pool=None: falso)
    monkeypatch.setattr(db, "ejecutar", lambda sql, p=None: [])
    monkeypatch.setattr(db, "abonar_creditos", lambda u, n, t, r=None: n)
    monkeypatch.setattr(db, "fijar_slots", lambda u, s: None)

    def correr(texto, **kw):
        lista = tmp_path / "tanda.txt"
        lista.write_text(texto, encoding="utf-8")
        kw.setdefault("pausa", 0)
        return usuarios_mod.alta_lote(POOL, lista, "mensual", **kw), lista
    return correr, falso


def test_el_ensayo_es_el_default_y_no_toca_nada(lote):
    """LA propiedad de seguridad. Un comando que crea 50 personas reales en
    Cognito no puede dispararse por escribirlo bien la primera vez."""
    correr, falso = lote
    hechas, _lista = correr("uno@gmail.com\ndos@gmail.com\n")
    assert hechas == 0
    assert falso.llamadas == [], "el ensayo llamó a Cognito"


def test_ejecutar_da_de_alta_y_deja_bitacora(lote):
    correr, falso = lote
    hechas, lista = correr("uno@gmail.com\ndos@gmail.com, anual\n", ejecutar=True)
    assert hechas == 2
    assert [kw["Username"] for n, kw in falso.llamadas if n == "create"] \
        == ["uno@gmail.com", "dos@gmail.com"]
    bitacora = lista.with_suffix(".txt.altas.tsv")
    lineas = bitacora.read_text(encoding="utf-8").strip().splitlines()
    assert lineas[0].startswith("cuando\tcorreo")
    assert [l.split("\t")[1:3] for l in lineas[1:]] == [
        ["uno@gmail.com", "mensual"], ["dos@gmail.com", "anual"]]


def test_una_direccion_repetida_no_se_da_de_alta_dos_veces(lote):
    """Dos veces en el archivo = dos altas = cortesía duplicada."""
    correr, falso = lote
    hechas, _ = correr("uno@gmail.com\nUNO@gmail.com\n uno@GMAIL.com \n",
                       ejecutar=True)
    assert hechas == 1


def test_las_sospechosas_se_quedan_fuera_salvo_que_se_pidan(lote):
    correr, _falso = lote
    assert correr("bien@gmail.com\ndedazo@gmial.com\n", ejecutar=True)[0] == 1
    assert correr("bien@gmail.com\ndedazo@gmial.com\n", ejecutar=True,
                  con_sospechosos=True)[0] == 2


def test_pasarse_del_tope_aborta_antes_de_crear_a_nadie(lote):
    """El pool manda ~50 correos al día: la 51 se crea y no recibe clave. El
    tope frena la corrida ENTERA en vez de truncarla en silencio, para que la
    decisión de a quién le toca hoy sea visible y no un efecto de borde."""
    correr, falso = lote
    texto = "".join(f"u{i}@gmail.com\n" for i in range(60))
    hechas, _ = correr(texto, ejecutar=True, tope=50)
    assert hechas == 0 and falso.llamadas == []


def test_quien_ya_existe_se_salta_sin_re_abonar_cortesia(usuarios_mod, monkeypatch, tmp_path):
    """`admin_create_user` sobre alguien existente truena, y `alta` abona DESPUÉS
    de crear — pero en una tanda ese error no puede ni matar la corrida ni
    convertirse en un segundo abono."""
    class YaExiste(Exception):
        pass

    class Falso(CognitoFalso):
        def admin_create_user(self, **kw):
            if kw["Username"] == "repetido@gmail.com":
                e = YaExiste("ya existe")
                e.response = {"Error": {"Code": "UsernameExistsException"}}
                raise e
            return super().admin_create_user(**kw)

    monkeypatch.setattr(usuarios_mod, "_cognito", lambda pool=None: Falso())
    monkeypatch.setattr(db, "ejecutar", lambda sql, p=None: [])
    monkeypatch.setattr(db, "abonar_creditos",
                        lambda u, n, t, r=None: (abonos.append(u), n)[1])
    abonos = []
    lista = tmp_path / "t.txt"
    lista.write_text("repetido@gmail.com\nnuevo@gmail.com\n", encoding="utf-8")
    hechas = usuarios_mod.alta_lote(POOL, lista, "mensual", ejecutar=True, pausa=0)
    assert hechas == 1                      # la corrida siguió
    assert abonos == ["sub-nuevo"], "se re-abonó cortesía a quien ya existía"


def test_el_tope_de_correo_de_cognito_aborta_la_corrida(usuarios_mod, monkeypatch, tmp_path):
    """El fallo silencioso que hay que hacer imposible: si Cognito ya no manda
    más correo hoy, seguir creando usuarios los deja con fila en `usuarios` y
    créditos abonados esperando una clave que nunca salió."""
    class Falso(CognitoFalso):
        def admin_create_user(self, **kw):
            if kw["Username"] != "uno@gmail.com":
                e = Exception("daily message limit")
                e.response = {"Error": {"Code": "LimitExceededException"}}
                raise e
            return super().admin_create_user(**kw)

    monkeypatch.setattr(usuarios_mod, "_cognito", lambda pool=None: Falso())
    monkeypatch.setattr(db, "ejecutar", lambda sql, p=None: [])
    monkeypatch.setattr(db, "abonar_creditos", lambda u, n, t, r=None: n)
    lista = tmp_path / "t.txt"
    lista.write_text("uno@gmail.com\ndos@gmail.com\ntres@gmail.com\n"
                     "cuatro@gmail.com\n", encoding="utf-8")
    hechas = usuarios_mod.alta_lote(POOL, lista, "mensual", ejecutar=True, pausa=0)
    assert hechas == 1
    # la de «dos» aborta: «tres» y «cuatro» no se intentan siquiera
    filas = (lista.with_suffix(".txt.altas.tsv")
             .read_text(encoding="utf-8").strip().splitlines()[1:])
    assert [f.split("\t")[1] for f in filas] == ["uno@gmail.com", "dos@gmail.com"]
