"""RAG·29 (temporal) — los abonos a los testers de /automatiza.

tools/abonos_testers.py decide qué uso se abona (plan), cuánto (tarifas.json
§rag) y nunca abona dos veces la misma corrida ni pasa el tope diario por
cuenta, aunque se corra varias veces. La parte que toca AWS (CloudFormation,
Cognito y los dos clústeres) no se prueba aquí: va detrás del ensayo y de
teclear PROD (tools/creditos.confirmar_abono).
"""
import json
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ))
from tools import abonos_testers as at  # noqa: E402


def _uso(pid, correo="tester@y.com", dia="2026-10-06", estado="listo"):
    return {"publico_id": pid, "correo": correo, "dia": dia, "estado": estado}


def test_la_tarifa_sale_de_tarifas_json():
    rag = json.loads((RAIZ / "tools" / "tarifas.json").read_text(encoding="utf-8"))["rag"]
    assert at.tarifa() == (rag["abono_tester_por_uso"], rag["abono_tester_max_por_dia"])
    assert at.tarifa() == (20, 5)      # decisión del dueño, 6-oct


def test_un_uso_por_corrida_con_su_referencia():
    filas = at.plan([_uso("a" * 16), _uso("b" * 16)], {"tester@y.com": "sub-1"},
                    set(), 10, 5)
    assert [f["accion"] for f in filas] == ["abonar", "abonar"]
    assert [f["referencia"] for f in filas] == ["rag-tester:" + "a" * 16, "rag-tester:" + "b" * 16]
    assert all(f["creditos"] == 10 and f["sub"] == "sub-1" for f in filas)


def test_sin_cuenta_en_la_plataforma_no_se_abona():
    filas = at.plan([_uso("a" * 16, "nadie@y.com")], {"nadie@y.com": None}, set(), 10, 5)
    assert filas[0]["accion"] == "sin_cuenta" and filas[0]["creditos"] == 0


def test_correrlo_dos_veces_no_abona_doble():
    ya = {"rag-tester:" + "a" * 16}
    filas = at.plan([_uso("a" * 16), _uso("b" * 16)], {"tester@y.com": "sub-1"}, ya, 10, 5)
    assert [f["accion"] for f in filas] == ["ya_abonado", "abonar"]


def test_el_tope_es_por_cuenta_y_por_dia_y_cuenta_lo_ya_abonado():
    usos = [_uso(f"{i:016d}") for i in range(4)] + [_uso("x" * 16, dia="2026-10-07")]
    ya = {"rag-tester:" + f"{0:016d}"}
    filas = at.plan(usos, {"tester@y.com": "sub-1"}, ya, 10, 2)
    assert [f["accion"] for f in filas] == ["ya_abonado", "abonar", "tope", "tope", "abonar"]


def test_dos_correos_de_la_misma_cuenta_comparten_tope():
    usos = [_uso("a" * 16, "uno@y.com"), _uso("b" * 16, "dos@y.com")]
    filas = at.plan(usos, {"uno@y.com": "sub-1", "dos@y.com": "sub-1"}, set(), 10, 1)
    assert [f["accion"] for f in filas] == ["abonar", "tope"]


def test_un_correo_que_romperia_el_filtro_de_cognito_no_se_busca():
    class _Idp:
        def list_users(self, **kw):
            raise AssertionError("no debió preguntarle a Cognito")
    assert at._sub_por_correo(_Idp(), "us-east-1_X", 'a"b@y.com') is None


def test_un_correo_ambiguo_o_deshabilitado_no_se_adivina():
    def idp(usuarios):
        class _Idp:
            def list_users(self, **kw):
                assert kw["Filter"] == 'email = "t@y.com"'
                return {"Users": usuarios}
        return _Idp()
    uno = {"Enabled": True, "Attributes": [{"Name": "sub", "Value": "sub-1"}]}
    apagado = {"Enabled": False, "Attributes": [{"Name": "sub", "Value": "sub-2"}]}
    assert at._sub_por_correo(idp([uno]), "us-east-1_X", "t@y.com") == "sub-1"
    assert at._sub_por_correo(idp([uno, dict(uno)]), "us-east-1_X", "t@y.com") is None
    assert at._sub_por_correo(idp([apagado]), "us-east-1_X", "t@y.com") is None


def test_en_pantalla_el_correo_va_tapado():
    assert at.tapar("tester@gmail.com") == "te***@gmail.com"


def test_abona_solo_tras_confirmar_produccion():
    codigo = (RAIZ / "tools" / "abonos_testers.py").read_text(encoding="utf-8")
    i_confirmar = codigo.index("confirmar_abono(entornos.PROD")
    i_abonar = codigo.index("db.abonar_creditos(")
    assert i_confirmar < i_abonar
    assert 'if not args.abonar:' in codigo
