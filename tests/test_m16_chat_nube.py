"""M16.4 — chat editorial en la nube: consejero con la API de Claude, clave
por-usuario (SSM, D4), historial en doc.chat, tope de turnos/día y tarifa 0 cr.
Sin red: Anthropic/S3/Postgres van mockeados."""
import json
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from pipeline import chat_nube, db, media_sync
from server import editor


@pytest.fixture
def nube(monkeypatch, tmp_path):
    monkeypatch.delenv("COGNITO_POOL_ID", raising=False)
    monkeypatch.setenv("STATE_BACKEND", "postgres")
    monkeypatch.setenv("CDN_BASE", "https://cdn.example.com")
    monkeypatch.setenv("MEDIA_ROOT", str(tmp_path))
    docs = {"gen-abc": {"flags": {"cuts": True}}}
    monkeypatch.setattr(db, "cargar_proyecto_editor", lambda u, n: docs.get(n))
    monkeypatch.setattr(media_sync, "leer_texto", lambda key: json.dumps(
        {"total": 30.0} if key.endswith("manifest.json")
        else {"words": [{"text": "hola.", "start": 0, "end": 500}]}))
    from server.app import app
    cliente = TestClient(app)
    cliente.docs = docs
    return cliente


# ---------------------------------------------------------------------------
# poll — el chat en nube está DISPONIBLE (ya no es el copy de "solo local")

def test_poll_nube_disponible_con_nota(nube):
    st = nube.get("/editor/gen-abc/api/chat/poll").json()
    assert st["available"] is True and st["error"] is None
    assert "Consejero" in st["messages"][0]["text"]


def test_poll_nube_devuelve_historial(nube):
    nube.docs["gen-abc"]["chat"] = {"mensajes": [
        {"role": "user", "text": "¿corto el inicio?", "ts": "2026-09-08T01:00:00"},
        {"role": "assistant", "text": "Sí, en el 2.1s.", "ts": "2026-09-08T01:00:05"}]}
    st = nube.get("/editor/gen-abc/api/chat/poll").json()
    assert [m["text"] for m in st["messages"]] == ["¿corto el inicio?", "Sí, en el 2.1s."]
    del nube.docs["gen-abc"]["chat"]


# ---------------------------------------------------------------------------
# chat — responde, persiste ambos turnos y reporta usage

def test_chat_nube_responde_y_persiste(nube, monkeypatch):
    guardado = {}
    monkeypatch.setattr(db, "fijar_chat_editor",
                        lambda u, n, s: guardado.update(json.loads(s)))
    visto = {}

    def responder(name, user, contexto, historial, texto):
        visto.update(name=name, contexto=contexto, historial=list(historial), texto=texto)
        return "Corta en el 12.4s.", {"input": 900, "output": 40}
    monkeypatch.setattr(chat_nube, "responder", responder)
    r = nube.post("/editor/gen-abc/api/chat", json={"text": "¿dónde corto?"})
    assert r.status_code == 200 and r.json() == {"sent": True}
    assert visto["name"] == "gen-abc" and "Transcript" in visto["contexto"]
    roles = [m["role"] for m in guardado["mensajes"]]
    assert roles == ["user", "assistant"]
    assert guardado["mensajes"][1]["usage"] == {"input": 900, "output": 40}


def test_chat_nube_429_al_tope_diario(nube, monkeypatch):
    hoy = datetime.now(timezone.utc).isoformat(timespec="seconds")
    nube.docs["gen-abc"]["chat"] = {"mensajes": [
        {"role": "user", "text": f"m{i}", "ts": hoy} for i in range(chat_nube.TURNOS_DIA)]}
    r = nube.post("/editor/gen-abc/api/chat", json={"text": "otro"})
    assert r.status_code == 429 and "tope" in r.json()["detail"]
    del nube.docs["gen-abc"]["chat"]


def test_chat_nube_503_sin_clave(nube, monkeypatch):
    def sin_clave(*a):
        raise chat_nube.SinClave("falta CLAUDE_API_KEY")
    monkeypatch.setattr(chat_nube, "responder", sin_clave)
    r = nube.post("/editor/gen-abc/api/chat", json={"text": "hola"})
    assert r.status_code == 503 and "CLAUDE_API_KEY" in r.json()["detail"]


def test_chat_nube_502_no_persiste_en_fallo(nube, monkeypatch):
    guardados = []
    monkeypatch.setattr(db, "fijar_chat_editor", lambda u, n, s: guardados.append(s))

    def truena(*a):
        raise RuntimeError("API caída")
    monkeypatch.setattr(chat_nube, "responder", truena)
    r = nube.post("/editor/gen-abc/api/chat", json={"text": "hola"})
    assert r.status_code == 502 and guardados == []


# ---------------------------------------------------------------------------
# clave_claude — D4: SSM del usuario pisa; sin nada = SinClave

def test_clave_claude_cae_al_entorno(monkeypatch):
    chat_nube.clave_claude.cache_clear()
    monkeypatch.setenv("SSM_USUARIOS_PREFIX", "")
    monkeypatch.setenv("CLAUDE_API_KEY", "sk-local")
    assert chat_nube.clave_claude("u1") == "sk-local"
    chat_nube.clave_claude.cache_clear()


def test_clave_claude_sin_nada_lanza(monkeypatch):
    chat_nube.clave_claude.cache_clear()
    monkeypatch.setenv("SSM_USUARIOS_PREFIX", "")
    monkeypatch.delenv("CLAUDE_API_KEY", raising=False)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    with pytest.raises(chat_nube.SinClave):
        chat_nube.clave_claude("u1")
    chat_nube.clave_claude.cache_clear()


# ---------------------------------------------------------------------------
# responder — arma system (prompt + contexto), mapea historial y reporta usage

def test_responder_llama_a_claude_con_historial(monkeypatch):
    chat_nube.clave_claude.cache_clear()
    monkeypatch.setenv("SSM_USUARIOS_PREFIX", "")
    monkeypatch.setenv("CLAUDE_API_KEY", "sk-test")
    visto = {}

    class Uso:
        input_tokens, output_tokens = 900, 40

    class Bloque:
        type, text = "text", "Corta en el 12.4s."

    class Resp:
        content, usage, stop_reason = [Bloque()], Uso(), "end_turn"

    class Mensajes:
        def create(self, **kw):
            visto.update(kw)
            return Resp()

    class Beta:
        messages = Mensajes()

    class Cliente:
        def __init__(self, api_key):
            visto["api_key"] = api_key
            self.beta = Beta()
    import anthropic
    monkeypatch.setattr(anthropic, "Anthropic", Cliente)
    respuesta, usage = chat_nube.responder(
        "gen-abc", "u1", "Duración: 30 s",
        [{"role": "user", "text": "hola"}, {"role": "assistant", "text": "hola, dime"}],
        "¿dónde corto?")
    assert respuesta == "Corta en el 12.4s." and usage == {
        "input": 900, "output": 40, "cache_write": 0, "cache_read": 0}
    assert visto["api_key"] == "sk-test" and visto["model"] == chat_nube.MODELO
    assert visto["fallbacks"] == "default"
    assert [m["content"] for m in visto["messages"]] == ["hola", "hola, dime", "¿dónde corto?"]
    assert "Duración: 30 s" in visto["system"][1]["text"]
    # el marcador de caché va en el ÚLTIMO bloque estable (el contexto), para
    # cachear system + transcript juntos — no solo el prompt chico
    assert visto["system"][1]["cache_control"] == {"type": "ephemeral"}
    assert "cache_control" not in visto["system"][0]
    chat_nube.clave_claude.cache_clear()


def test_responder_acota_historial(monkeypatch):
    """Sesiones largas: solo los últimos CHAT_HISTORIAL_MAX turnos viajan."""
    chat_nube.clave_claude.cache_clear()
    monkeypatch.setenv("SSM_USUARIOS_PREFIX", "")
    monkeypatch.setenv("CLAUDE_API_KEY", "sk-test")
    visto = {}

    class Uso:
        input_tokens, output_tokens = 900, 40

    class Bloque:
        type, text = "text", "ok"

    class Resp:
        content, usage, stop_reason = [Bloque()], Uso(), "end_turn"

    class Mensajes:
        def create(self, **kw):
            visto.update(kw)
            return Resp()

    class Beta:
        messages = Mensajes()

    class Cliente:
        def __init__(self, api_key):
            self.beta = Beta()
    import anthropic
    monkeypatch.setattr(anthropic, "Anthropic", Cliente)
    historial = [{"role": "user", "text": f"m{i}"} for i in range(30)]
    chat_nube.responder("gen-abc", "u1", "ctx", historial, "¿dónde corto?")
    textos = [m["content"] for m in visto["messages"]]
    assert len(textos) == chat_nube.HISTORIAL_MAX + 1  # historial acotado + turno nuevo
    assert textos[-1] == "¿dónde corto?" and textos[0] == f"m{30 - chat_nube.HISTORIAL_MAX}"
    chat_nube.clave_claude.cache_clear()


def test_responder_sin_fallbacks_fuera_de_opus(monkeypatch):
    """El parámetro fallbacks solo existe en Opus — con CHAT_MODEL=sonnet la
    llamada no debe mandarlo (Sonnet responde 400 si viaja)."""
    chat_nube.clave_claude.cache_clear()
    monkeypatch.setenv("SSM_USUARIOS_PREFIX", "")
    monkeypatch.setenv("CLAUDE_API_KEY", "sk-test")
    monkeypatch.setattr(chat_nube, "MODELO", "claude-sonnet-5")
    visto = {}

    class Uso:
        input_tokens, output_tokens = 10, 5

    class Bloque:
        type, text = "text", "ok"

    class Resp:
        content, usage, stop_reason = [Bloque()], Uso(), "end_turn"

    class Mensajes:
        def create(self, **kw):
            visto.update(kw)
            return Resp()

    class Beta:
        messages = Mensajes()

    class Cliente:
        def __init__(self, api_key):
            self.beta = Beta()
    import anthropic
    monkeypatch.setattr(anthropic, "Anthropic", Cliente)
    chat_nube.responder("gen-abc", "u1", "ctx", [], "hola")
    assert "fallbacks" not in visto and "betas" not in visto
    chat_nube.clave_claude.cache_clear()


def test_responder_refusal_da_respuesta_amable(monkeypatch):
    chat_nube.clave_claude.cache_clear()
    monkeypatch.setenv("SSM_USUARIOS_PREFIX", "")
    monkeypatch.setenv("CLAUDE_API_KEY", "sk-test")

    class Uso:
        input_tokens, output_tokens = 10, 0

    class Resp:
        content, usage, stop_reason = [], Uso(), "refusal"

    class Mensajes:
        def create(self, **kw):
            return Resp()

    class Beta:
        messages = Mensajes()

    class Cliente:
        def __init__(self, api_key):
            self.beta = Beta()
    import anthropic
    monkeypatch.setattr(anthropic, "Anthropic", Cliente)
    respuesta, _ = chat_nube.responder("gen-abc", "u1", "ctx", [], "x")
    assert "edición de tu video" in respuesta
    chat_nube.clave_claude.cache_clear()
