"""RAG·26 — el borrador del conjunto de prueba y tools/eval_rag.py, sin gastar."""
import pytest

from pipeline import armado, claude_rag, n8n_catalogo, puente
from tools import eval_rag

B = "n8n-nodes-base."


def test_el_borrador_cuadra_con_el_catalogo():
    casos = eval_rag.conjunto()
    assert len(casos) == 25
    assert len({c["id"] for c in casos}) == 25
    permitidos = n8n_catalogo.permitidos()
    for c in casos:
        assert c["esperado"] in ("listo", "sin_cobertura")
        assert c["peticion"].strip()
        for t in c["nodos"]:
            raiz, _ = n8n_catalogo.base(t)
            assert raiz in permitidos, (c["id"], t)
        if c["esperado"] == "sin_cobertura":
            assert c["nodos"] == []
    # hay de todo: fuera de cobertura, otro proveedor de IA y datos personales
    assert sum(c["esperado"] == "sin_cobertura" for c in casos) >= 4
    assert any("anthropic" in c["peticion"].lower() for c in casos)
    assert any("@" in c["peticion"] for c in casos)


def test_solo():
    assert [c["id"] for c in eval_rag.conjunto(["ventas-1"])] == ["ventas-1"]
    with pytest.raises(SystemExit, match="nada"):
        eval_rag.conjunto(["nada"])


def _caso(**kw):
    return {"id": "x", "peticion": "avísale a ana@x.mx, clave sk-proj-ABCDEFGHIJKL",
            "esperado": "listo", "nodos": [B + "gmail", B + "if"], **kw}


def test_calificar():
    flujo = {"nodes": [{"type": B + "gmail"}, {"type": B + "manualTrigger"}]}
    r = eval_rag.calificar(_caso(), "listo", flujo, 1)
    assert r == {"acierto_estado": True, "valido_1er": True,
                 "cobertura_nodos": 0.5, "nodos_faltantes": [B + "if"],
                 "sin_secretos": True}
    r = eval_rag.calificar(_caso(), "listo", {"nodes": [], "x": "ana@x.mx"}, 2)
    assert not r["valido_1er"] and not r["sin_secretos"] and r["cobertura_nodos"] == 0
    r = eval_rag.calificar(_caso(esperado="sin_cobertura", nodos=[]), "sin_cobertura", None, 1)
    assert r["acierto_estado"] and r["cobertura_nodos"] is None and not r["valido_1er"]


def test_correr_uno_sin_gastar():
    vistos = []

    def armar(peticion, consulta, vector, *, embeber, uso, modelo_):
        vistos.append((consulta.camino, modelo_))
        uso.llamadas.append({"etapa": "armar1", "modelo": modelo_, "entrada": 10, "salida": 5,
                             "cache_escrita": 0, "cache_leida": 0})
        return armado.Armado("listo", {"nodes": [{"type": B + "gmail"}]}, "r", [B + "gmail"])
    f = eval_rag.correr_uno(_caso(), "claude-sonnet-5-5", "directo",
                            embeber=lambda t, k: [[0.1]], armar=armar,
                            reescritor=lambda u, m: None)
    assert vistos == [("directo", "claude-sonnet-5-5")]
    assert f["estado"] == "listo" and f["tokens"]["entrada"] == 10 and f["cobertura_nodos"] == 0.5


def test_correr_uno_reescrita_usa_el_mismo_modelo():
    modelos = []

    def reescritor(uso, modelo):
        modelos.append(modelo)
        return lambda s, u: {"consulta": "Gmail", "nodos": []}

    def armar(peticion, consulta, vector, **kw):
        assert consulta.camino == "reescrita"
        return armado.Armado("listo", {"nodes": []}, "", [])
    eval_rag.correr_uno(_caso(), "claude-opus-5-5", "reescrita",
                        embeber=lambda t, k: [[0.1]], armar=armar, reescritor=reescritor)
    assert modelos == ["claude-opus-5-5"]


@pytest.mark.parametrize("error, estado", [
    (armado.NoSalio("validador: x"), "no_salio"), (claude_rag.SinClave("x"), "error")])
def test_correr_uno_no_para_por_una_mala(error, estado):
    def armar(*a, **kw):
        raise error
    f = eval_rag.correr_uno(_caso(), "claude-opus-5-5", "directo",
                            embeber=lambda t, k: [[0.1]], armar=armar, reescritor=None)
    assert f["estado"] == estado and not f["acierto_estado"]


def test_resumir():
    filas = [{"modelo": "m", "camino": "directo", "acierto_estado": a, "valido_1er": v,
              "cobertura_nodos": c, "sin_secretos": True, "segundos": 2.0,
              "tokens": {"entrada": 10, "salida": 5}}
             for a, v, c in ((True, True, 1.0), (False, False, None))]
    r = eval_rag.resumir(filas)["m · directo"]
    assert r["acierto_estado"] == 0.5 and r["cobertura_nodos"] == 1.0 and r["tokens_entrada"] == 20


def test_ensayo_y_sin_confirmar_no_llaman(monkeypatch, capsys):
    monkeypatch.setattr(eval_rag, "_claves", lambda e: (_ for _ in ()).throw(AssertionError()))
    assert eval_rag.main(["ensayo"]) == 0
    assert eval_rag.main(["correr"]) == 0
    out = capsys.readouterr().out
    assert "= 50 corridas" in out and "claude-sonnet-5-5" in out


def test_modelos_y_caminos_validos():
    with pytest.raises(SystemExit, match="gpt"):
        eval_rag.main(["--modelos", "gpt-5", "ensayo"])
    with pytest.raises(SystemExit, match="lateral"):
        eval_rag.main(["--caminos", "lateral", "ensayo"])
    assert puente.CAMINOS == ("directo", "reescrita")


def test_banderas_antes_o_despues_del_subcomando(monkeypatch, capsys):
    """El docstring las pone después; el 1-oct se usaron antes. Valen igual."""
    monkeypatch.setattr(eval_rag, "_claves", lambda e: (_ for _ in ()).throw(AssertionError()))
    caso = eval_rag.conjunto()[0]["id"]
    for argv in (["--solo", caso, "--modelos", "claude-sonnet-5-5", "ensayo"],
                 ["ensayo", "--solo", caso, "--modelos", "claude-sonnet-5-5"],
                 ["correr", "--solo", caso, "--modelos", "claude-sonnet-5-5"]):
        assert eval_rag.main(argv) == 0
        assert "= 1 corridas" in capsys.readouterr().out


def test_tabla_con_tantas_columnas_como_valores(capsys):
    eval_rag.imprimir({"m · directo": {
        "corridas": 1, "acierto_estado": 1.0, "valido_1er": 1.0, "cobertura_nodos": 2 / 3,
        "sin_secretos": 1.0, "tokens_entrada": 2980, "tokens_salida": 1008, "segundos_prom": 11.2}})
    encabezado, fila = capsys.readouterr().out.splitlines()[:2]
    assert len(encabezado.split("·")[1].split()) - 1 == len(fila.split("·")[1].split()) - 1 == 7
