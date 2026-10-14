"""RAG·23 — la traza de Langfuse de /automatiza: apagada sin claves, siempre
enmascarada y sin tragarse los errores de la corrida."""
import contextlib
import sys
import types as pytypes

import pytest

from pipeline import trazas_rag


@pytest.mark.parametrize("entra, sale", [
    ("escríbeme a ana.perez+n8n@correo.com.mx", "escríbeme a [correo]"),
    ("mi cel es +52 55 1234 5678, gracias", "mi cel es [teléfono], gracias"),
    ("llámame al (55) 1234-5678", "llámame al [teléfono]"),
    ("cada 15 minutos y 3 veces", "cada 15 minutos y 3 veces"),
    ("n8n-nodes-base.googleSheets v4.7", "n8n-nodes-base.googleSheets v4.7"),
    ("https://api.ejemplo.com/v1/12345678901", "https://api.ejemplo.com/v1/12345678901"),
])
def test_enmascarar(entra, sale):
    assert trazas_rag.enmascarar(entra) == sale


def test_enmascarar_anidado():
    assert trazas_rag.enmascarar({"a": ["x@y.com", 3], "b": {"c": "5512345678"}}) == \
        {"a": ["[correo]", 3], "b": {"c": "[teléfono]"}}


def test_sin_claves_no_hace_nada(monkeypatch):
    monkeypatch.delenv("LANGFUSE_PUBLIC_KEY", raising=False)
    monkeypatch.delenv("LANGFUSE_SECRET_KEY", raising=False)
    monkeypatch.setitem(sys.modules, "langfuse", None)    # si lo importara, truena
    with trazas_rag.corrida(1) as t:
        t.update(output={"x": 1})


@pytest.fixture
def langfuse(monkeypatch):
    monkeypatch.setenv("LANGFUSE_PUBLIC_KEY", "pk")
    monkeypatch.setenv("LANGFUSE_SECRET_KEY", "sk")
    visto = {"updates": [], "sesion": None, "flush": 0, "salida": None}

    class Span:
        def update(self, **kw):
            visto["updates"].append(kw)

    @contextlib.contextmanager
    def observar(**kw):
        visto["input"] = kw["input"]
        try:
            yield Span()
        except Exception as e:
            visto["salida"] = e
            raise

    @contextlib.contextmanager
    def propagar(**kw):
        visto["sesion"] = kw["session_id"]
        yield

    cli = pytypes.SimpleNamespace(start_as_current_observation=observar,
                                  flush=lambda: visto.__setitem__("flush", visto["flush"] + 1))
    monkeypatch.setitem(sys.modules, "langfuse", pytypes.SimpleNamespace(
        get_client=lambda: cli, propagate_attributes=propagar))
    return visto


def test_con_claves_manda_enmascarado(langfuse):
    with trazas_rag.corrida(9, entrada={"texto": "a@b.com"}) as t:
        t.update(output={"consulta": "avísale a ana@x.mx"})
    assert langfuse["sesion"] == "automatiza-9"
    assert langfuse["input"] == {"texto": "[correo]"}
    assert langfuse["updates"] == [{"output": {"consulta": "avísale a [correo]"}}]
    assert langfuse["flush"] == 1


def test_el_error_de_la_corrida_sale_tal_cual(langfuse):
    with pytest.raises(ZeroDivisionError):
        with trazas_rag.corrida(9):
            1 / 0
    assert isinstance(langfuse["salida"], ZeroDivisionError)    # la traza lo vio


def test_si_langfuse_falla_al_abrir_la_corrida_sigue(monkeypatch):
    monkeypatch.setenv("LANGFUSE_PUBLIC_KEY", "pk")
    monkeypatch.setenv("LANGFUSE_SECRET_KEY", "sk")

    def truena():
        raise ConnectionError("sin red")
    monkeypatch.setitem(sys.modules, "langfuse", pytypes.SimpleNamespace(
        get_client=truena, propagate_attributes=None))
    with trazas_rag.corrida(9) as t:
        t.update(output=1)
        hecho = True
    assert hecho


def test_si_update_falla_no_tumba(langfuse, monkeypatch):
    with trazas_rag.corrida(9) as t:
        t._span.update = lambda **kw: (_ for _ in ()).throw(RuntimeError("x"))
        t.update(output=1)
