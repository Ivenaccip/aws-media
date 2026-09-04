"""M10 — prompts gestionados en Langfuse: load_prompt sirve `production` con
fallback a los .md del repo (y JAMÁS se cae por Langfuse), el objeto del prompt
sobrevive al .format() y chat_json enlaza la generation a esa versión;
tools/prompts_sync.py siembra idempotente. Sin red."""
import asyncio
import json

import pytest

from pipeline import config


class PromptFalso:
    def __init__(self, texto, is_fallback=False, version=7):
        self.prompt, self.is_fallback, self.version = texto, is_fallback, version


class ClienteFalso:
    def __init__(self, respuesta=None, error=None):
        self.respuesta, self.error, self.creados = respuesta, error, []

    def get_prompt(self, name, **kw):
        if self.error:
            raise self.error
        # el SDK con fallback= devuelve un objeto marcado is_fallback en fallo
        return self.respuesta or PromptFalso(kw.get("fallback", ""), is_fallback=True)

    def create_prompt(self, **kw):
        self.creados.append(kw)


def _con_cliente(monkeypatch, cliente):
    import langfuse
    monkeypatch.setattr(langfuse, "get_client", lambda: cliente)


# ---------------------------------------------------------------------------
# load_prompt

def test_sin_flag_lee_el_md_local_sin_tocar_langfuse(monkeypatch):
    monkeypatch.delenv("LANGFUSE_PROMPTS", raising=False)
    monkeypatch.setenv("LANGFUSE_PUBLIC_KEY", "pk")
    import langfuse
    monkeypatch.setattr(langfuse, "get_client",
                        lambda: pytest.fail("no debía tocar Langfuse"))
    texto = config.load_prompt("guionista_system")
    assert texto == (config.PROMPTS_DIR / "guionista_system.md").read_text(encoding="utf-8")
    assert texto.objeto is None


def test_con_flag_sirve_la_version_production(monkeypatch):
    monkeypatch.setenv("LANGFUSE_PROMPTS", "1")
    monkeypatch.setenv("LANGFUSE_PUBLIC_KEY", "pk")
    remoto = PromptFalso("Eres guionista v7 con {tema}")
    _con_cliente(monkeypatch, ClienteFalso(respuesta=remoto))
    texto = config.load_prompt("guionista_system")
    assert str(texto) == "Eres guionista v7 con {tema}"
    assert texto.objeto is remoto
    # el templating local de Python sigue igual Y conserva el enlace
    formateado = texto.format(tema="Tesla")
    assert formateado == "Eres guionista v7 con Tesla"
    assert formateado.objeto is remoto


def test_langfuse_caido_cae_al_md_local(monkeypatch):
    monkeypatch.setenv("LANGFUSE_PROMPTS", "1")
    monkeypatch.setenv("LANGFUSE_PUBLIC_KEY", "pk")
    _con_cliente(monkeypatch, ClienteFalso(error=RuntimeError("timeout")))
    texto = config.load_prompt("guionista_system")
    assert texto == (config.PROMPTS_DIR / "guionista_system.md").read_text(encoding="utf-8")
    assert texto.objeto is None


def test_fallback_del_sdk_no_se_enlaza(monkeypatch):
    """El SDK con fallback= no lanza: devuelve el texto local marcado
    is_fallback — esa 'versión' no existe en Langfuse y no debe enlazarse."""
    monkeypatch.setenv("LANGFUSE_PROMPTS", "1")
    monkeypatch.setenv("LANGFUSE_PUBLIC_KEY", "pk")
    _con_cliente(monkeypatch, ClienteFalso())    # sin respuesta → is_fallback
    texto = config.load_prompt("guionista_system")
    assert texto.objeto is None
    assert texto == (config.PROMPTS_DIR / "guionista_system.md").read_text(encoding="utf-8")


def test_sin_claves_ni_intenta(monkeypatch):
    monkeypatch.setenv("LANGFUSE_PROMPTS", "1")
    monkeypatch.delenv("LANGFUSE_PUBLIC_KEY", raising=False)
    import langfuse
    monkeypatch.setattr(langfuse, "get_client",
                        lambda: pytest.fail("no debía tocar Langfuse"))
    assert config.load_prompt("guionista_system").objeto is None


# ---------------------------------------------------------------------------
# chat_json enlaza la versión

class _Msg:
    def __init__(self):
        self.message = type("M", (), {"content": json.dumps({"ok": True})})()


class _OpenAIFalso:
    def __init__(self):
        self.kwargs = None
        self.chat = self
        self.completions = self

    async def create(self, **kw):
        self.kwargs = kw
        return type("R", (), {"choices": [_Msg()]})()


def test_chat_json_pasa_langfuse_prompt(monkeypatch):
    from pipeline import llm
    falso = _OpenAIFalso()
    monkeypatch.setattr(llm, "client", lambda: falso)
    system = config.PromptTexto("Eres editor")
    system.objeto = PromptFalso("Eres editor")
    assert asyncio.run(llm.chat_json("editor", system, "hola")) == {"ok": True}
    assert falso.kwargs["langfuse_prompt"] is system.objeto


def test_chat_json_sin_objeto_no_manda_el_kwarg(monkeypatch):
    from pipeline import llm
    falso = _OpenAIFalso()
    monkeypatch.setattr(llm, "client", lambda: falso)
    asyncio.run(llm.chat_json("editor", "Eres editor", "hola"))
    assert "langfuse_prompt" not in falso.kwargs


# ---------------------------------------------------------------------------
# prompts_sync: siembra idempotente

def test_sync_crea_solo_lo_que_difiere(monkeypatch):
    from tools import prompts_sync
    local = (config.PROMPTS_DIR / "guionista_system.md").read_text(encoding="utf-8")

    class Cliente(ClienteFalso):
        def get_prompt(self, name, **kw):
            if name == "guionista_system":
                return PromptFalso(local)              # idéntico → igual
            if name == "director_system":
                return PromptFalso("texto viejo")      # difiere → actualizado
            raise RuntimeError("no existe")            # → nuevo

    c = Cliente()
    r = prompts_sync.sincronizar(cliente=c)
    assert r["guionista_system"] == "igual"
    assert r["director_system"] == "actualizado"
    assert r["editor_system"] == "nuevo"
    creados = {kw["name"] for kw in c.creados}
    assert "guionista_system" not in creados
    assert {"director_system", "editor_system"} <= creados
    assert all(kw["labels"] == ["production"] for kw in c.creados)


def test_sync_dry_no_crea_nada():
    from tools import prompts_sync
    c = ClienteFalso(error=RuntimeError("no existe"))   # todo sería "nuevo"
    r = prompts_sync.sincronizar(dry=True, cliente=c)
    assert set(r.values()) == {"nuevo"} and c.creados == []


def test_sync_solo_un_prompt():
    from tools import prompts_sync
    c = ClienteFalso(error=RuntimeError("no existe"))
    r = prompts_sync.sincronizar(solo="voz_system", cliente=c)
    assert list(r) == ["voz_system"]
    assert [kw["name"] for kw in c.creados] == ["voz_system"]
