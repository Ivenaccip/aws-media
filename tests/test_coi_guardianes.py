"""Ajustes 3 — los guardianes de COI (contrato §5). Cada uno CAE si se quita su arreglo:

  1. Las instrucciones del dueño no llegan al navegador: ninguna respuesta de /api/coi*
     ni de /api/biblioteca* (ni el OpenAPI), ni el código de la web, repite una frase
     propia de `prompts/coi_system.md`.
  2. COI no usa el cliente con Langfuse. Esto tiene dos mitades, y la segunda es la que
     importa: (a) `llm.client()` parcheado para fallar → COI sigue funcionando; (b)
     `langfuse.openai` parchea con wrapt el `create` de TODO el proceso, así que un
     cliente «pelón» también quedaría trazado si alguien lo llamara de frente: con
     `langfuse.openai` cargado y su `get_client` convertido en espía, ni la moderación ni
     la respuesta de COI pasan por él, y el testigo (la misma llamada hecha de frente)
     SÍ lo dispara.
  3. El log no lleva el texto de la persona ni la respuesta, tampoco con el SDK real.

El SDK de OpenAI es el de verdad; solo la red es de mentira (`httpx.MockTransport`).
Sin dinero."""
import json
import logging
import re
from pathlib import Path

import httpx
import pytest

from pipeline import coi, llm, moderacion
from test_coi_mundo import COI_ES, SECRETO, TEXTO, Mundo, cliente, mundo  # noqa: F401

RAIZ = Path(__file__).resolve().parent.parent


# ---------------------------------------------------------------------------
# el SDK real con la red de mentira, y Langfuse convertido en espía

class Red:
    """Lo que devuelve «OpenAI»: la moderación o el COI según quién pregunta."""

    def __init__(self):
        self.peticiones: list[dict] = []
        self.coi = COI_ES
        self.veredicto = {"permitido": True, "motivo": ""}
        self.rechazar_razonamiento = False       # el 400 de «reasoning_effort no se acepta»

    def __call__(self, request: httpx.Request) -> httpx.Response:
        cuerpo = json.loads(request.content)
        self.peticiones.append({"url": str(request.url), "cuerpo": cuerpo, "auth": request.headers.get("authorization")})
        if self.rechazar_razonamiento and "reasoning_effort" in cuerpo:
            return httpx.Response(400, json={"error": {
                "message": "Unsupported parameter: 'reasoning_effort' is not supported with this model.",
                "type": "invalid_request_error", "param": "reasoning_effort", "code": "unsupported_parameter"}})
        es_coi = "max_completion_tokens" in cuerpo
        contenido = self.coi if es_coi else json.dumps(self.veredicto)
        return httpx.Response(200, json={
            "id": "x", "object": "chat.completion", "created": 1, "model": cuerpo["model"],
            "choices": [{"index": 0, "finish_reason": "stop",
                         "message": {"role": "assistant", "content": contenido}}],
            "usage": {"prompt_tokens": 1500, "completion_tokens": 700, "total_tokens": 2200,
                      "prompt_tokens_details": {"cached_tokens": 1000}}})

    def del_coi(self):
        return [p for p in self.peticiones if "max_completion_tokens" in p["cuerpo"]]

    def de_moderacion(self):
        return [p for p in self.peticiones if "max_completion_tokens" not in p["cuerpo"]]


@pytest.fixture
def red(monkeypatch):
    import openai
    r = Red()
    sdk = openai.AsyncOpenAI(api_key="sk-de-mentira", max_retries=0,
                             http_client=httpx.AsyncClient(transport=httpx.MockTransport(r)))
    monkeypatch.setattr(llm, "_client_sin_trazas", sdk)
    return r


def _envuelto(f) -> bool:
    """Independiente de la implementación de llm.py: el envoltorio de wrapt se reconoce por su nombre."""
    return type(f).__name__ == "FunctionWrapper"


class Espia:
    def __init__(self):
        self.llamadas: list[dict] = []

    def __call__(self, *a, **kw):
        self.llamadas.append(kw)
        raise AssertionError("Langfuse intervino en una llamada que no debe dejar trazas")


@pytest.fixture
def langfuse_openai(monkeypatch):
    """`langfuse.openai` cargado y con su parche de wrapt activo (como en una Lambda donde ya
    corrió cualquier `llm.client()`), y su `get_client` convertido en espía. Al terminar la
    prueba el parche de la clase se deja como estaba."""
    from openai.resources.chat import completions as comp
    antes = comp.AsyncCompletions.__dict__["create"]
    import langfuse.openai as lo
    if not _envuelto(comp.AsyncCompletions.__dict__["create"]):
        lo.register_tracing()        # el módulo ya estaba importado pero otra prueba deshizo el parche
    assert _envuelto(comp.AsyncCompletions.__dict__["create"]), "el parche de Langfuse no quedó activo"
    espia = Espia()
    monkeypatch.setattr(lo, "get_client", espia)
    yield espia
    monkeypatch.undo()
    comp.AsyncCompletions.create = antes


@pytest.fixture
def mundo_sdk(monkeypatch):
    m = Mundo(monkeypatch, modelo_real=True)
    monkeypatch.setattr(llm, "client", lambda: pytest.fail("COI llamó a llm.client(): ese cliente deja trazas en Langfuse"))
    monkeypatch.setattr(llm, "client_publico", lambda: pytest.fail("COI llamó a llm.client_publico()"))
    return m


@pytest.fixture
def cliente_sdk(mundo_sdk):
    from fastapi.testclient import TestClient
    from server.app import app
    return TestClient(app)


def pedir(cliente, texto=TEXTO):
    return cliente.post("/api/coi", json={"texto": texto})


# ---------------------------------------------------------------------------
# 2 · COI no usa el cliente con Langfuse

def test_coi_funciona_aunque_llm_client_este_roto_y_sin_pasar_por_langfuse(cliente_sdk, red, langfuse_openai):
    r = pedir(cliente_sdk)
    assert r.status_code == 200 and r.json()["coi"]["estructura_ok"] is True
    assert langfuse_openai.llamadas == [], "una llamada de COI pasó por la capa de Langfuse"
    assert len(red.de_moderacion()) == 1 and len(red.del_coi()) == 1


def test_lo_que_sale_hacia_openai_es_lo_que_el_contrato_dice(cliente_sdk, red, langfuse_openai):
    pedir(cliente_sdk, f"  {TEXTO}  ")
    (mod,), (resp,) = red.de_moderacion(), red.del_coi()
    assert resp["cuerpo"]["reasoning_effort"] == "minimal"
    assert resp["cuerpo"]["max_completion_tokens"] == coi.MAX_SALIDA_TOKENS
    assert resp["cuerpo"]["model"] == coi.modelo()
    sistema, usuario = resp["cuerpo"]["messages"]
    assert sistema == {"role": "system", "content": coi.instrucciones()}
    assert usuario == {"role": "user", "content": TEXTO}
    assert resp["auth"] == "Bearer sk-de-mentira"
    assert mod["cuerpo"]["messages"][1]["content"] == TEXTO and "reasoning_effort" not in mod["cuerpo"]
    assert resp["url"].endswith("/chat/completions")


def test_el_testigo_la_misma_llamada_de_frente_SI_pasa_por_langfuse(red, langfuse_openai):
    """Si este testigo dejara de caer en el espía, la prueba de arriba no probaría nada: el
    parche de wrapt ya no atraparía llamadas ajenas (o el espía estaría mal puesto)."""
    import asyncio

    async def de_frente():
        sdk = llm.client_sin_trazas()
        with pytest.raises(AssertionError, match="Langfuse intervino"):
            await sdk.chat.completions.create(model="m", messages=[{"role": "user", "content": TEXTO}])
    asyncio.run(de_frente())
    assert len(langfuse_openai.llamadas) == 1


def test_chat_texto_llama_al_create_original_no_al_envuelto(red, langfuse_openai):
    import asyncio
    texto, uso = asyncio.run(llm.chat_texto("sistema", "usuario"))
    assert texto == COI_ES and langfuse_openai.llamadas == []
    assert uso == {"modelo": coi.modelo(), "entrada": 1500, "salida": 700, "cache_leida": 1000, "fin": "stop"}


def test_chat_json_sin_trazas_tampoco_pasa_por_langfuse(red, langfuse_openai):
    import asyncio
    r = asyncio.run(llm.chat_json("moderar", "sistema", "usuario", sin_trazas=True))
    assert r == {"permitido": True, "motivo": ""} and langfuse_openai.llamadas == []
    (p,) = red.peticiones
    assert "name" not in p["cuerpo"] and "langfuse_prompt" not in p["cuerpo"]


def test_la_moderacion_sin_trazas_no_pasa_por_observe_ni_por_langfuse(red, langfuse_openai, monkeypatch):
    import asyncio

    async def prohibido(*a, **kw):
        raise AssertionError("revisar(sin_trazas=True) usó el span de Langfuse (@observe)")
    monkeypatch.setattr(moderacion, "_revisar_con_trazas", prohibido)
    v = asyncio.run(moderacion.revisar(TEXTO, falla_cerrado=True, sin_trazas=True))
    assert v.permitido is True and langfuse_openai.llamadas == []


def test_la_moderacion_de_siempre_conserva_su_span(monkeypatch):
    """El camino normal NO cambió: sigue pasando por el span `moderar` y por chat_json."""
    import asyncio
    pasos = []

    async def con_trazas(texto, **kw):
        pasos.append(("span", kw))
        return moderacion.Veredicto(permitido=True)
    monkeypatch.setattr(moderacion, "_revisar_con_trazas", con_trazas)
    asyncio.run(moderacion.revisar(TEXTO))
    assert pasos and pasos[0][1] == {"prompt": "moderar_system", "falla_cerrado": False, "publico": False}


def test_el_cliente_sin_trazas_no_es_el_de_langfuse_ni_reintenta(monkeypatch):
    import openai
    monkeypatch.setenv("OPENAI_API_KEY", "sk-x")
    monkeypatch.setattr(llm, "_client_sin_trazas", None)
    c = llm.client_sin_trazas()
    assert type(c) is openai.AsyncOpenAI and not type(c).__module__.startswith("langfuse")
    assert c.max_retries == 0 and llm.client_sin_trazas() is c


def test_sin_clave_el_cliente_sin_trazas_no_se_construye(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.setattr(llm, "_client_sin_trazas", None)
    with pytest.raises(llm.ClaveFaltante):
        llm.client_sin_trazas()


def test_cada_llamada_de_coi_usa_el_create_sin_envoltorio():
    """El parche que quita la capa de Langfuse existe y actúa sobre lo que Langfuse parchea."""
    from openai.resources.chat import completions as comp
    import langfuse.openai as lo
    antes = comp.AsyncCompletions.__dict__["create"]
    if not _envuelto(antes):
        lo.register_tracing()
    try:
        assert _envuelto(comp.AsyncCompletions.__dict__["create"])

        class Falso:
            class chat:
                completions = object.__new__(comp.AsyncCompletions)
        crear = llm._create_sin_envoltorio(Falso)
        assert not _envuelto(crear.func), "se devolvió la función envuelta por Langfuse"
        assert crear.func.__qualname__ == "AsyncCompletions.create"
    finally:
        comp.AsyncCompletions.create = antes


# ---------------------------------------------------------------------------
# el 400 del razonamiento

def test_si_la_api_rechaza_reasoning_effort_se_reintenta_una_vez_sin_el_y_se_avisa(red, caplog):
    import asyncio
    red.rechazar_razonamiento = True
    caplog.set_level("INFO")
    texto, _ = asyncio.run(llm.chat_texto("sistema", f"usuario {SECRETO}"))
    assert texto == COI_ES
    assert len(red.peticiones) == 2
    assert "reasoning_effort" in red.peticiones[0]["cuerpo"] and "reasoning_effort" not in red.peticiones[1]["cuerpo"]
    avisos = [r for r in caplog.records if r.levelno == logging.WARNING and r.name == "pipeline.llm"]
    assert len(avisos) == 1 and "reasoning_effort" in avisos[0].getMessage()
    assert SECRETO not in caplog.text


def test_otro_400_no_se_reintenta(red):
    import asyncio

    def siempre_400(request):
        red.peticiones.append({"cuerpo": json.loads(request.content)})
        return httpx.Response(400, json={"error": {"message": "Invalid prompt", "code": "invalid_prompt"}})
    import openai
    llm._client_sin_trazas = openai.AsyncOpenAI(api_key="x", max_retries=0,
                                                http_client=httpx.AsyncClient(transport=httpx.MockTransport(siempre_400)))
    with pytest.raises(Exception):
        asyncio.run(llm.chat_texto("s", "u"))
    assert len(red.peticiones) == 1


def test_sin_razonamiento_configurado_no_se_manda_el_parametro(red):
    import asyncio
    asyncio.run(llm.chat_texto("s", "u", razonamiento=None))
    assert "reasoning_effort" not in red.peticiones[0]["cuerpo"]


def test_el_plazo_viaja_al_sdk(red):
    import asyncio
    asyncio.run(llm.chat_texto("s", "u", timeout=17))
    # el timeout del SDK no sale en el cuerpo: se comprueba que la llamada aceptó el argumento
    assert len(red.peticiones) == 1


# ---------------------------------------------------------------------------
# 3 · el log, también con el SDK real

def test_el_log_con_el_sdk_real_no_lleva_texto_ni_respuesta(cliente_sdk, red, langfuse_openai, caplog):
    caplog.set_level(logging.INFO)             # el nivel de producción (server.app lo deja en INFO)
    r = pedir(cliente_sdk, f"{SECRETO} " + TEXTO)
    assert r.status_code == 200
    todo = " ".join(rec.getMessage() for rec in caplog.records)
    assert SECRETO not in todo and "estratega de contenido" not in todo
    assert "Prompt Architect" not in todo
    assert "respuesta terminada" in todo


def test_el_sdk_de_openai_no_loguea_cuerpos_al_nivel_de_produccion():
    """El SDK de OpenAI escribe el cuerpo completo de la petición a nivel DEBUG. El API arranca
    con el root en INFO (server.app._configurar_logging): el cuerpo nunca sale. Quien suba el
    nivel a DEBUG en producción (o exporte OPENAI_LOG=debug) rompe esta garantía: está avisado
    en docs/OPERACION.md."""
    from server import app as servidor
    servidor._configurar_logging()
    assert logging.getLogger().level == logging.INFO
    assert logging.getLogger("openai").getEffectiveLevel() >= logging.INFO


# ---------------------------------------------------------------------------
# 1 · las instrucciones no llegan al navegador

def _frases_propias() -> list[str]:
    """Frases del archivo de instrucciones que NO son las plantillas de los encabezados: las
    oraciones largas que solo el dueño escribió."""
    texto = (RAIZ / "prompts" / "coi_system.md").read_text(encoding="utf-8")
    frases = []
    for linea in texto.splitlines():
        for trozo in re.split(r"(?<=[.!?])\s+", linea.strip().lstrip("*-• ").strip()):
            if len(trozo) >= 40:
                frases.append(trozo.strip())
    primera = re.split(r"(?<=[.!?])\s+", texto.strip(), maxsplit=1)[0]     # «You are a Prompt Architect AI.»
    return [primera.strip()] + frases


def test_hay_frases_propias_que_buscar():
    frases = _frases_propias()
    assert len(frases) >= 5 and any("Prompt Architect AI" in f for f in frases)


def _hay_filtracion(texto: str) -> str | None:
    bajo = texto.lower()
    return next((f for f in _frases_propias() if f.lower() in bajo), None)


def test_ninguna_respuesta_del_api_trae_las_instrucciones(cliente, mundo):
    # el modelo doblado devuelve un COI normal; las instrucciones solo se le MANDAN al modelo
    respuestas = [
        cliente.get("/api/coi/estado"),
        cliente.post("/api/coi", json={"texto": TEXTO}),
        cliente.post("/api/coi", json={"texto": ""}),
        cliente.post("/api/coi", json={"texto": "x" * 3000}),
        cliente.get("/api/biblioteca"),
        cliente.put("/api/biblioteca/fijados", json={"ids": ["a", "b", "c", "d"]}),
        cliente.post("/api/biblioteca/mios", json={"titulo": "T", "prompt": "P"}),
        cliente.delete("/api/biblioteca/mios/mio-0123456789ab"),
        cliente.get("/openapi.json"),
        cliente.get("/api/coi"),                    # método que no existe
    ]
    mundo.modelo_error = RuntimeError("falla")
    respuestas.append(cliente.post("/api/coi", json={"texto": TEXTO}))
    mundo.poner_usos(3)
    respuestas.append(cliente.post("/api/coi", json={"texto": TEXTO}))
    for r in respuestas:
        assert _hay_filtracion(r.text) is None, f"{r.request.method} {r.request.url.path} repite una frase del archivo"


def test_la_respuesta_que_llevaba_el_modelo_si_se_devuelve_pero_las_instrucciones_no(cliente, mundo):
    """El testigo: si el modelo de verdad repitiera las instrucciones en su respuesta, la
    comprobación las vería (la guardia no es ciega)."""
    mundo.modelo_respuesta = "#CONTEXTO\n" + _frases_propias()[0] + "\n#OBJETIVO\nb\n#INSTRUCCIONES\nc"
    r = cliente.post("/api/coi", json={"texto": TEXTO})
    assert _hay_filtracion(r.text) is not None


def _archivos_del_navegador():
    carpetas = [RAIZ / "web" / "dist", RAIZ / "web" / "src", RAIZ / "static"]
    for c in carpetas:
        if c.is_dir():
            for f in c.rglob("*"):
                if f.is_file() and f.suffix in {".js", ".mjs", ".css", ".html", ".json", ".ts", ".tsx", ".map", ".svg"} \
                        and "node_modules" not in f.parts:
                    yield f


def test_ni_el_codigo_de_la_web_ni_el_bundle_repiten_las_instrucciones():
    revisados = 0
    for f in _archivos_del_navegador():
        revisados += 1
        # los de tests de la web citan el archivo a propósito para vigilarlo
        if ".test." in f.name or "e2e" in f.parts:
            continue
        try:
            contenido = f.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        hallada = _hay_filtracion(contenido)
        assert hallada is None, f"{f.relative_to(RAIZ)} repite una frase de las instrucciones: {hallada!r}"
    assert revisados > 50, "no se revisó casi nada: ¿cambió la estructura de web/ y static/?"


def test_el_archivo_de_instrucciones_no_se_publica_como_estatico():
    """`static/` se sirve tal cual: el archivo de instrucciones no vive ahí ni se copia."""
    assert not list((RAIZ / "static").rglob("coi_system*"))
    assert not list((RAIZ / "web").rglob("coi_system*")) or all(
        "node_modules" in p.parts for p in (RAIZ / "web").rglob("coi_system*"))
