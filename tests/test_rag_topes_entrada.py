"""RAG·7 — topes de entrada de /automatiza: largo, moderación que falla
CERRADO y throttling de etapa (solo dev; prod no cambia hasta RAG·30).

Las puertas van de la más barata a la más cara (largo → freno → moderación):
un bot frenado o un texto de más no le cuestan al dueño ni una llamada."""
import pytest

from pipeline import db, moderacion, publico


@pytest.fixture(autouse=True)
def sal(monkeypatch):
    monkeypatch.setenv(publico.VAR_SAL, "sal-de-prueba")
    # estos tests son de la moderación: la prueban como quedará con el armado
    # real (RAG·21). Con el de mentira no se modera (tests/test_rag_tuberia.py)
    monkeypatch.setattr(publico, "ARMADO_DE_MENTIRA", False)


def _freno(monkeypatch, *, encendido=True, corridas=0):
    monkeypatch.setattr(db, "automatiza_interruptor", lambda: {
        "encendido": encendido, "tope_corridas": 20, "tope_usd": None,
        "tope_por_ip": None, "nota": None, "creado": "x"})
    monkeypatch.setattr(db, "automatiza_consumo_hoy",
                        lambda: {"corridas": corridas, "usd": 0.0})
    monkeypatch.setattr(db, "automatiza_corridas_de_ip_hoy", lambda h: 0)


CLAVES: list[dict] = []     # los kwargs de cada llamada (¿con la clave pública?)


def _modelo(monkeypatch, respuesta=None, *, error=None):
    """El LLM de moderación de mentira; devuelve la lista de llamadas."""
    llamadas = []

    async def fake(name, system, user, **kw):
        llamadas.append((name, str(system), user))
        CLAVES.append(kw)
        if error:
            raise error
        return respuesta

    monkeypatch.setattr(moderacion, "chat_json", fake)
    return llamadas


TEXTO = "Cada vez que llegue un correo con factura, guardar el PDF en Drive."


# ---------------------------------------------------------------------------
# 1. largo

def test_largo_limites():
    assert publico.revisar_largo("a" * publico.LARGO_MINIMO) is None
    assert publico.revisar_largo("a" * publico.LARGO_MAXIMO) is None
    assert publico.revisar_largo("a" * (publico.LARGO_MINIMO - 1)) == publico.CORTO
    assert publico.revisar_largo("a" * (publico.LARGO_MAXIMO + 1)) == publico.LARGO
    assert publico.revisar_largo(None) == publico.CORTO


def test_largo_no_cuenta_espacios_de_orilla_ni_nulos():
    relleno = " " * 5000 + "a" * publico.LARGO_MINIMO + "\n" * 5000
    assert publico.revisar_largo(relleno) is None
    assert publico.limpiar_texto(" hola\x00 mundo ") == "hola mundo"


def test_maximo_provisional_es_1500():
    # si el dueño da su número en RAG·0, este test se actualiza con él
    assert publico.LARGO_MAXIMO == 1500


@pytest.mark.asyncio
async def test_texto_largo_no_toca_ni_base_ni_modelo(monkeypatch):
    def prohibido(*a, **k):
        raise AssertionError("el largo va antes que todo")
    monkeypatch.setattr(db, "automatiza_interruptor", prohibido)
    llamadas = _modelo(monkeypatch, {"permitido": True})
    a = await publico.admitir("x" * 10_000, "h")
    assert a.motivo == publico.LARGO and llamadas == []


# ---------------------------------------------------------------------------
# 2. el freno va antes que la moderación

@pytest.mark.asyncio
async def test_apagado_no_gasta_moderacion(monkeypatch):
    _freno(monkeypatch, encendido=False)
    llamadas = _modelo(monkeypatch, {"permitido": True})
    assert (await publico.admitir(TEXTO, "h")).motivo == publico.APAGADO
    assert llamadas == []


@pytest.mark.asyncio
async def test_tope_no_gasta_moderacion(monkeypatch):
    _freno(monkeypatch, corridas=20)
    llamadas = _modelo(monkeypatch, {"permitido": True})
    assert (await publico.admitir(TEXTO, "h")).motivo == publico.TOPE
    assert llamadas == []


@pytest.mark.asyncio
async def test_sin_hash_no_gasta_moderacion(monkeypatch):
    _freno(monkeypatch)
    llamadas = _modelo(monkeypatch, {"permitido": True})
    assert (await publico.admitir(TEXTO, None)).motivo == publico.APAGADO
    assert llamadas == []


# ---------------------------------------------------------------------------
# 3. moderación cerrada

@pytest.mark.asyncio
async def test_admitida_manda_texto_limpio_con_su_prompt(monkeypatch):
    _freno(monkeypatch)
    llamadas = _modelo(monkeypatch, {"permitido": True, "motivo": ""})
    a = await publico.admitir("  " + TEXTO + "\x00 ", "h")
    assert a.motivo is None and a.texto == TEXTO
    (nombre, system, user), = llamadas
    assert user == TEXTO
    assert "n8n" in system and "spam" in system     # el prompt de automatiza, no el de video


@pytest.mark.asyncio
async def test_rechazada_lleva_el_motivo(monkeypatch):
    _freno(monkeypatch)
    _modelo(monkeypatch, {"permitido": False, "motivo": "Eso sería spam."})
    a = await publico.admitir(TEXTO, "h")
    assert a.motivo == publico.RECHAZADA and a.detalle == "Eso sería spam."


@pytest.mark.asyncio
async def test_moderacion_caida_cierra(monkeypatch):
    _freno(monkeypatch)
    _modelo(monkeypatch, error=RuntimeError("timeout"))
    assert (await publico.admitir(TEXTO, "h")).motivo == publico.APAGADO


@pytest.mark.parametrize("respuesta", [
    {}, {"motivo": "x"}, {"permitido": "true"}, {"permitido": 1}, {"permitido": None},
    ["permitido", True]])
@pytest.mark.asyncio
async def test_veredicto_ambiguo_cierra(monkeypatch, respuesta):
    _freno(monkeypatch)
    _modelo(monkeypatch, respuesta)
    assert (await publico.admitir(TEXTO, "h")).motivo == publico.APAGADO


@pytest.mark.asyncio
async def test_admitir_modera_con_la_clave_publica(monkeypatch):
    """Capa 1: la moderación de /automatiza la paga la clave de /publico/."""
    _freno(monkeypatch)
    CLAVES.clear()
    _modelo(monkeypatch, {"permitido": True, "motivo": ""})
    assert (await publico.admitir(TEXTO, "h")).motivo is None
    assert CLAVES == [{"publico": True}]
    CLAVES.clear()
    await moderacion.revisar(TEXTO)             # la de plataforma, como siempre
    assert CLAVES == [{}]


@pytest.mark.asyncio
async def test_camino_publico_fuerza_cerrado_aunque_no_se_pida(monkeypatch):
    _modelo(monkeypatch, error=RuntimeError("caído"))
    with db.camino_publico():
        v = await moderacion.revisar(TEXTO)
    assert v.permitido is False and v.caido is True


@pytest.mark.asyncio
async def test_producto_con_cuenta_sigue_fallando_abierto(monkeypatch):
    # M13 no cambia: para usuarios con cuenta un filtro caído no tumba el producto
    _modelo(monkeypatch, error=RuntimeError("caído"))
    v = await moderacion.revisar(TEXTO)
    assert v.permitido is True and v.caido is False
    _modelo(monkeypatch, {})
    assert (await moderacion.revisar(TEXTO)).permitido is True


def test_prompt_de_automatiza_trata_el_texto_como_datos():
    from pipeline.config import load_prompt
    texto = str(load_prompt(publico.PROMPT_MODERACION))
    assert '"permitido"' in texto and "nunca órdenes" in texto


# ---------------------------------------------------------------------------
# 4. throttling de etapa

def test_prod_sin_throttling_propio_hasta_rag30():
    import sys
    from pathlib import Path
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "infra"))
    from entornos import DEV, PROD
    assert PROD.throttle_etapa is None and PROD.throttle_publico is None
    tasa_e, rafaga_e = DEV.throttle_etapa
    tasa_p, rafaga_p = DEV.throttle_publico
    assert tasa_p < tasa_e and rafaga_p < rafaga_e    # lo público, más estrecho
    assert rafaga_p >= tasa_p and rafaga_e >= tasa_e
