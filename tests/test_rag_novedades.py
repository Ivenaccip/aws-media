"""RAG·35 — la lista de novedades de /automatiza: quién entra, la baja y el envío.

  · la lista: solo quien marcó la casilla aparte, con su correo VIGENTE en esa
    petición, un renglón por correo (el primer consentimiento) y nadie que se
    haya dado de baja, aunque vuelva a marcar la casilla;
  · la baja: un enlace firmado por contacto (sin el correo en la URL), un GET
    que solo pregunta y un POST que da de baja (el botón de la página y el de
    un clic de Gmail); falla cerrado sin la sal;
  · el envío: lleva el enlace en el cuerpo y en List-Unsubscribe, vuelve a
    mirar la baja justo antes de mandar, y la herramienta es un ENSAYO
    mientras no se le diga --de-verdad.

El SQL corre de verdad contra un SQLite en disco con las tablas de
db.ESQUEMA, igual que tests/test_nombres_editor.py. SES va de mentira.
"""
import re
import sqlite3
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from pipeline import db, novedades
from server import aviso

RAIZ = Path(__file__).resolve().parent.parent
TABLAS = ("automatiza_corridas", "automatiza_contactos", "automatiza_bajas",
          "automatiza_envios")
SAL = "sal-de-prueba-para-bajas"


def _a_sqlite(sql: str) -> str:
    sql = sql.replace("bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY",
                      "INTEGER PRIMARY KEY AUTOINCREMENT")
    sql = re.sub(r"::(jsonb|text|timestamptz)\b", "", sql)
    return sql.replace("now()", "CURRENT_TIMESTAMP").replace("real[]", "text")


@pytest.fixture
def base(monkeypatch, tmp_path):
    ruta = tmp_path / "aurora.sqlite"

    def ejecutar(sql, params=None):
        con = sqlite3.connect(ruta, isolation_level=None)
        con.row_factory = sqlite3.Row
        try:
            return [dict(f) for f in con.execute(_a_sqlite(sql), params or {}).fetchall()]
        finally:
            con.close()

    creadas = set()
    for sentencia in db.ESQUEMA:
        m = re.search(r"CREATE TABLE IF NOT EXISTS (\w+) \(", sentencia)
        if m and m.group(1) in TABLAS:
            ejecutar(sentencia)
            creadas.add(m.group(1))
    assert creadas == set(TABLAS)
    monkeypatch.setattr(db, "ejecutar", ejecutar)
    return ejecutar


def _corrida(base, publico_id: str, utm: str | None = None) -> int:
    base("INSERT INTO automatiza_corridas (publico_id, texto, utm_source) "
         "VALUES (:p, 'una petición de prueba', :u)", {"p": publico_id, "u": utm})
    return base("SELECT id FROM automatiza_corridas WHERE publico_id = :p",
                {"p": publico_id})[0]["id"]


def _correo(id_, correo, *, si: bool, version="v1"):
    db.automatiza_guardar_correo(id_, correo, origen="listo", recontacto=si,
                                 recontacto_texto="Quiero recibir…" if si else None,
                                 aviso_version=version)


@pytest.fixture
def lista(base):
    """ana marcó dos veces (con mayúsculas la primera); en la segunda petición
    dejaron un correo mal escrito y lo cambiaron sin marcar; luis marcó."""
    c1, c2 = _corrida(base, "a" * 16, "instagram"), _corrida(base, "b" * 16)
    c3, c4 = _corrida(base, "c" * 16, "youtube"), _corrida(base, "d" * 16)
    _correo(c1, " Ana@Mail.com", si=True)
    _correo(c2, "tipo@mal.com", si=True)
    _correo(c2, "bien@mail.com", si=False)
    _correo(c3, "ana@mail.com", si=True, version="v2")
    _correo(c4, "luis@mail.com", si=True, version="v2")
    return base


# --- la lista ---------------------------------------------------------------

def test_la_lista_es_un_renglon_por_correo_con_el_primer_consentimiento(lista):
    filas = db.automatiza_lista_novedades()
    assert [f["correo"] for f in filas] == ["ana@mail.com", "luis@mail.com"]
    ana = filas[0]
    assert ana["aviso_version"] == "v1" and ana["utm_source"] == "instagram"
    assert ana["recontacto_texto"] == "Quiero recibir…"


def test_un_correo_cambiado_deja_de_contar_y_sin_casilla_no_entra(lista):
    correos = {f["correo"] for f in db.automatiza_lista_novedades()}
    assert "tipo@mal.com" not in correos       # lo cambiaron: estaba mal escrito
    assert "bien@mail.com" not in correos      # no marcó la casilla


def test_la_baja_es_para_siempre_y_no_se_repite(lista):
    assert db.automatiza_dar_baja("  LUIS@mail.com", origen="manual", nota="por correo")
    assert not db.automatiza_dar_baja("luis@mail.com", origen="enlace")
    assert lista("SELECT count(*) AS n FROM automatiza_bajas")[0]["n"] == 1
    assert [f["correo"] for f in db.automatiza_lista_novedades()] == ["ana@mail.com"]
    # vuelve a marcar la casilla en otra petición: sigue fuera
    _correo(_corrida(lista, "e" * 16), "luis@mail.com", si=True, version="v3")
    assert [f["correo"] for f in db.automatiza_lista_novedades()] == ["ana@mail.com"]


def test_un_envio_se_anota_una_sola_vez_por_campana(lista):
    db.automatiza_anotar_envio("2026-10-nodos", "Ana@mail.com", contacto_id=1, mensaje_id="m1")
    db.automatiza_anotar_envio("2026-10-nodos", "ana@mail.com", contacto_id=1, mensaje_id="m2")
    assert db.automatiza_ya_enviado("2026-10-nodos", "ANA@mail.com")
    assert not db.automatiza_ya_enviado("2026-11-otra", "ana@mail.com")
    filas = lista("SELECT mensaje_id FROM automatiza_envios")
    assert filas == [{"mensaje_id": "m1"}]


def test_las_tablas_solo_agregan_y_la_sal_sube_por_ssm_env():
    esquema = " ".join(db.ESQUEMA)
    assert "CREATE TABLE IF NOT EXISTS automatiza_bajas" in esquema
    assert "PRIMARY KEY (campana, correo)" in esquema
    codigo = (RAIZ / "pipeline" / "db.py").read_text(encoding="utf-8")
    assert "DELETE FROM automatiza_bajas" not in codigo
    assert "UPDATE automatiza_bajas" not in codigo
    sys.path.insert(0, str(RAIZ / "tools"))
    from tools import ssm_env
    assert "AUTOMATIZA_SAL_BAJA" in ssm_env.CLAVES
    assert "AUTOMATIZA_SAL_BAJA" not in ssm_env.SOLO_PROD   # dev también la necesita


# --- la firma del enlace ------------------------------------------------------

def test_el_enlace_firma_el_contacto_y_no_lleva_el_correo(monkeypatch):
    monkeypatch.setenv(novedades.VAR_SAL, SAL)
    token = novedades.firmar(42)
    assert novedades.verificar(token) == 42
    enlace = novedades.enlace_baja(42)
    assert enlace == f"https://irremplazables.xyz/automatiza/baja/{token}"
    assert "@" not in enlace
    assert novedades.enlace_baja(42, "https://x.execute-api.us-east-1.amazonaws.com/").startswith(
        "https://x.execute-api.us-east-1.amazonaws.com/automatiza/baja/42.")


@pytest.mark.parametrize("malo", ["", "42", "42.", "abc.0123", "43.{f}", "42.{f}x",
                                  "-1.{f}", "42.{F}"])
def test_un_token_alterado_no_sirve(monkeypatch, malo):
    monkeypatch.setenv(novedades.VAR_SAL, SAL)
    firma = novedades.firmar(42).split(".")[1]
    assert novedades.verificar(malo.format(f=firma, F=firma.upper())) is None


def test_sin_sal_no_se_firma_ni_se_verifica(monkeypatch):
    monkeypatch.delenv(novedades.VAR_SAL, raising=False)
    with pytest.raises(novedades.SinSal):
        novedades.firmar(1)
    with pytest.raises(novedades.SinSal):
        novedades.verificar("1." + "0" * 32)


def test_otra_sal_invalida_los_enlaces(monkeypatch):
    monkeypatch.setenv(novedades.VAR_SAL, SAL)
    token = novedades.firmar(7)
    monkeypatch.setenv(novedades.VAR_SAL, "otra")
    assert novedades.verificar(token) is None


# --- el correo ---------------------------------------------------------------

HTML_ = '<p>Hola</p><p><a href="{{baja}}">Ya no quiero recibir esto</a></p>'
TEXTO = "Hola\n\nPara darte de baja: {{baja}}"


def test_el_mensaje_lleva_la_baja_en_el_cuerpo_y_en_las_cabeceras():
    enlace = "https://irremplazables.xyz/automatiza/baja/1.abc&x"
    m = novedades.mensaje("Asunto", HTML_, TEXTO, enlace)["Simple"]
    assert 'href="https://irremplazables.xyz/automatiza/baja/1.abc&amp;x"' in m["Body"]["Html"]["Data"]
    assert m["Body"]["Text"]["Data"].endswith(enlace)
    cabeceras = {h["Name"]: h["Value"] for h in m["Headers"]}
    assert cabeceras == {"List-Unsubscribe": f"<{enlace}>",
                         "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"}


@pytest.mark.parametrize("html_, texto", [("<p>sin enlace</p>", TEXTO), (HTML_, "sin enlace")])
def test_sin_el_hueco_de_baja_no_sale(html_, texto):
    with pytest.raises(ValueError):
        novedades.mensaje("A", html_, texto, "https://x/automatiza/baja/1.a")


class _SES:
    def __init__(self):
        self.llamadas = []

    def send_email(self, **kw):
        self.llamadas.append(kw)
        return {"MessageId": f"m-{len(self.llamadas)}"}


def test_enviar_vuelve_a_mirar_la_baja_justo_antes(lista, monkeypatch):
    monkeypatch.setenv(novedades.VAR_SAL, SAL)
    monkeypatch.setenv(novedades.VAR_REMITENTE, "Irremplazables <novedades@irremplazables.xyz>")
    ses = _SES()
    assert novedades.enviar("ana@mail.com", 1, "Hola", HTML_, TEXTO, cli=ses) == "m-1"
    kw = ses.llamadas[0]
    assert kw["FromEmailAddress"] == "Irremplazables <novedades@irremplazables.xyz>"
    assert kw["Destination"] == {"ToAddresses": ["ana@mail.com"]}
    assert "ConfigurationSetName" not in kw
    db.automatiza_dar_baja("ana@mail.com", origen="enlace")
    assert novedades.enviar("ana@mail.com", 1, "Hola", HTML_, TEXTO, cli=ses) is None
    assert len(ses.llamadas) == 1


def test_enviar_sin_remitente_no_manda(lista, monkeypatch):
    monkeypatch.setenv(novedades.VAR_SAL, SAL)
    monkeypatch.delenv(novedades.VAR_REMITENTE, raising=False)
    ses = _SES()
    with pytest.raises(RuntimeError):
        novedades.enviar("ana@mail.com", 1, "Hola", HTML_, TEXTO, cli=ses)
    assert ses.llamadas == []


# --- las páginas de baja --------------------------------------------------------

@pytest.fixture
def cliente(lista, monkeypatch):
    monkeypatch.setenv("COGNITO_POOL_ID", "us-east-1_TESTPOOL")
    monkeypatch.setenv("COGNITO_CLIENT_ID", "clienteweb123")
    monkeypatch.setenv(novedades.VAR_SAL, SAL)
    from server.app import app
    return TestClient(app)


def _bajas(base):
    return base("SELECT correo, origen, contacto_id FROM automatiza_bajas")


def test_el_get_solo_pregunta(cliente, lista):
    r = cliente.get(f"/automatiza/baja/{novedades.firmar(1)}")
    assert r.status_code == 200
    assert '<form method="post"' in r.text and "Sí, darme de baja" in r.text
    assert r.headers["x-robots-tag"] == "noindex, nofollow"
    assert "script-src 'self'" in r.headers["content-security-policy"]
    assert "{{" not in r.text
    assert _bajas(lista) == []


def test_el_post_da_de_baja_al_correo_de_ese_contacto(cliente, lista):
    token = novedades.firmar(1)
    r = cliente.post(f"/automatiza/baja/{token}")
    assert r.status_code == 200 and "ya no recibirás novedades" in r.text
    assert _bajas(lista) == [{"correo": "ana@mail.com", "origen": "enlace", "contacto_id": 1}]
    # el botón de un clic de Gmail (RFC 8058) llega con este cuerpo, y otra vez
    r = cliente.post(f"/automatiza/baja/{token}", data={"List-Unsubscribe": "One-Click"})
    assert r.status_code == 200
    assert len(_bajas(lista)) == 1
    assert [f["correo"] for f in db.automatiza_lista_novedades()] == ["luis@mail.com"]


@pytest.mark.parametrize("token", ["1.0123456789abcdef0123456789abcdef", "9999.{f}", "nada"])
def test_un_enlace_malo_es_404_y_no_da_de_baja(cliente, lista, token):
    firma = novedades._firma(9999, SAL)
    for metodo in (cliente.get, cliente.post):
        r = metodo(f"/automatiza/baja/{token.format(f=firma)}")
        assert r.status_code == 404 and "Este enlace no sirve" in r.text
    assert _bajas(lista) == []


def test_sin_sal_es_503_y_nunca_un_listo(cliente, lista, monkeypatch):
    token = novedades.firmar(1)
    monkeypatch.delenv(novedades.VAR_SAL)
    for metodo in (cliente.get, cliente.post):
        r = metodo(f"/automatiza/baja/{token}")
        assert r.status_code == 503 and "no pudimos" in r.text
    assert _bajas(lista) == []


@pytest.mark.parametrize("cruda", ["/baja.html", "/baja-hecha.html"])
def test_las_plantillas_crudas_no_se_sirven(cliente, cruda):
    r = cliente.get(cruda, follow_redirects=False)
    assert r.status_code == 302 and r.headers["location"] == "/automatiza"


@pytest.mark.parametrize("nombre", ["baja.html", "baja-hecha.html"])
def test_las_paginas_de_baja_caben_en_la_csp(nombre):
    texto = (RAIZ / "static" / nombre).read_text(encoding="utf-8")
    sin_comentarios = re.sub(r"<!--.*?-->", "", texto, flags=re.S)
    assert not re.search(r"<script(?![^>]*\bsrc=)", sin_comentarios)
    assert "<style" not in sin_comentarios and " style=" not in sin_comentarios
    assert not re.search(r"\son[a-z]+=", sin_comentarios)
    lleno = aviso.renderizar_con(nombre, {"baja_titulo": "<b>t</b>", "baja_texto": "x"})
    assert "{{" not in lleno
    if nombre == "baja-hecha.html":
        assert "&lt;b&gt;t&lt;/b&gt;" in lleno      # lo del servidor va escapado


# --- la herramienta -----------------------------------------------------------

def _args(tmp_path, **kw):
    (tmp_path / "c.html").write_text(HTML_, encoding="utf-8")
    (tmp_path / "c.txt").write_text(TEXTO, encoding="utf-8")
    base = dict(campana="2026-10-nodos", asunto="Hola", html=str(tmp_path / "c.html"),
                texto=str(tmp_path / "c.txt"), solo=None, base_url=None,
                por_segundo=1000.0, de_verdad=False)
    return SimpleNamespace(**{**base, **kw})


class _Ap:
    def error(self, msg):
        raise SystemExit(msg)


@pytest.fixture
def herramienta(lista, monkeypatch):
    sys.path.insert(0, str(RAIZ))
    from tools import automatiza
    monkeypatch.setenv(novedades.VAR_SAL, SAL)
    monkeypatch.setenv(novedades.VAR_REMITENTE, "novedades@irremplazables.xyz")
    mandados = []
    monkeypatch.setattr(novedades, "enviar",
                        lambda destino, cid, *a, **k: mandados.append(destino) or f"m-{cid}")
    return automatiza, mandados


def test_sin_de_verdad_es_ensayo(herramienta, tmp_path, capsys):
    automatiza, mandados = herramienta
    automatiza._enviar(_args(tmp_path), _Ap(), db)
    assert mandados == []
    salida = capsys.readouterr().out
    assert "por mandar: 2" in salida and "ENSAYO" in salida
    assert "sin precio confirmado" in salida
    assert "ana@mail.com" not in salida


def test_de_verdad_pide_confirmar_y_no_repite(herramienta, tmp_path, monkeypatch, lista):
    automatiza, mandados = herramienta
    monkeypatch.setattr("builtins.input", lambda _: "ENVIAR 2")
    automatiza._enviar(_args(tmp_path, de_verdad=True), _Ap(), db)
    assert mandados == ["ana@mail.com", "luis@mail.com"]
    monkeypatch.setattr("builtins.input", lambda _: pytest.fail("no hay a quién mandar"))
    automatiza._enviar(_args(tmp_path, de_verdad=True), _Ap(), db)
    assert len(mandados) == 2


def test_una_confirmacion_mal_escrita_no_manda(herramienta, tmp_path, monkeypatch):
    automatiza, mandados = herramienta
    monkeypatch.setattr("builtins.input", lambda _: "enviar 2")
    automatiza._enviar(_args(tmp_path, de_verdad=True), _Ap(), db)
    assert mandados == []


def test_solo_a_un_correo_de_la_lista(herramienta, tmp_path, monkeypatch):
    automatiza, mandados = herramienta
    monkeypatch.setattr("builtins.input", lambda _: "ENVIAR 1")
    automatiza._enviar(_args(tmp_path, de_verdad=True, solo=" LUIS@mail.com"), _Ap(), db)
    assert mandados == ["luis@mail.com"]
    with pytest.raises(SystemExit):
        automatiza._enviar(_args(tmp_path, solo="nadie@mail.com"), _Ap(), db)


def test_cuerpo_sin_baja_o_campana_rara_no_avanza(herramienta, tmp_path):
    automatiza, _ = herramienta
    args = _args(tmp_path)
    Path(args.texto).write_text("sin enlace", encoding="utf-8")
    with pytest.raises(SystemExit, match="baja"):
        automatiza._enviar(args, _Ap(), db)
    with pytest.raises(SystemExit, match="campana"):
        automatiza._enviar(_args(tmp_path, campana="Mi Campaña"), _Ap(), db)


def test_en_pantalla_el_correo_va_tapado():
    from tools import automatiza
    assert automatiza.tapar("ana.lopez@gmail.com") == "an***@gmail.com"
    assert automatiza.tapar("sin-arroba") == "***"
