"""Ajustes 3 — la lógica pura de COI (pipeline/coi.py): separar los tres bloques,
el idioma, el costo con la tarifa de pricing.json, la configuración y el archivo
de instrucciones. Sin red ni base."""
import json
from pathlib import Path

import pytest

from pipeline import coi

RAIZ = Path(__file__).resolve().parent.parent


# ---------------------------------------------------------------------------
# separar_bloques

def test_separa_los_tres_bloques_sin_su_encabezado():
    r = coi.separar_bloques("#CONTEXTO\nEres una estratega.\n\n#OBJETIVO\nCrear un plan.\n\n"
                            "#INSTRUCCIONES\n\n1. Rol\n   * estratega\n2. Datos\n")
    assert r["estructura_ok"] is True
    assert r["contexto"] == "Eres una estratega."
    assert r["objetivo"] == "Crear un plan."
    assert r["instrucciones"] == "1. Rol\n   * estratega\n2. Datos"
    assert set(r) == {"contexto", "objetivo", "instrucciones", "completo", "estructura_ok"}


def test_completo_es_lo_que_respondio_el_modelo_entero():
    texto = "Aquí tienes:\n\n#CONTEXT\na\n#OBJECTIVE\nb\n#INSTRUCTIONS\nc\n"
    assert coi.separar_bloques(texto)["completo"] == texto


@pytest.mark.parametrize("c,o,i", [
    ("#CONTEXTO", "#OBJETIVO", "#INSTRUCCIONES"),
    ("#CONTEXT", "#OBJECTIVE", "#INSTRUCTIONS"),
    ("# Contexto", "# Objetivo", "# Instrucciones"),
    ("## CONTEXTO", "## OBJETIVO", "## INSTRUCCIONES"),
    ("**#CONTEXTO**", "**#OBJETIVO**", "**#INSTRUCCIONES**"),
    ("#**CONTEXTO**", "#**OBJETIVO**", "#**INSTRUCCIONES**"),
    ("**#CONTEXT:**", "**#OBJECTIVE:**", "**#INSTRUCTIONS:**"),
    ("#contexto:", "#objetivo:", "#instrucciones:"),
    ("**# CONTEXTO**", "__# OBJETIVO__", "**#INSTRUCCIONES**"),
])
def test_los_encabezados_con_o_sin_negritas_en_ambos_idiomas(c, o, i):
    r = coi.separar_bloques(f"{c}\nuno\n\n{o}\ndos\n\n{i}\ntres")
    assert (r["estructura_ok"], r["contexto"], r["objetivo"], r["instrucciones"]) == (True, "uno", "dos", "tres")


def test_el_texto_en_la_misma_linea_del_encabezado_es_cuerpo():
    r = coi.separar_bloques("#CONTEXTO: Eres un asesor.\n#OBJETIVO: Ayudar.\n#INSTRUCCIONES: Haz esto.\nY esto.")
    assert r["contexto"] == "Eres un asesor."
    assert r["objetivo"] == "Ayudar."
    assert r["instrucciones"] == "Haz esto.\nY esto."


def test_quita_reglas_horizontales_entre_bloques():
    r = coi.separar_bloques("#CONTEXTO\na\n\n---\n\n#OBJETIVO\nb\n***\n#INSTRUCCIONES\nc\n___")
    assert (r["contexto"], r["objetivo"], r["instrucciones"]) == ("a", "b", "c")


def test_un_titulo_que_solo_empieza_con_la_palabra_no_es_encabezado():
    # «# Contexto histórico» dentro del cuerpo no corta nada
    r = coi.separar_bloques("#CONTEXTO\nuno\n# Contexto histórico\nmás\n#OBJETIVO\ndos\n#INSTRUCCIONES\ntres")
    assert r["contexto"] == "uno\n# Contexto histórico\nmás"


def test_los_encabezados_repetidos_despues_son_cuerpo():
    r = coi.separar_bloques("#CONTEXTO\na\n#OBJETIVO\nb\n#INSTRUCCIONES\nc\n#CONTEXTO\nrepetido")
    assert r["instrucciones"] == "c\n#CONTEXTO\nrepetido"


def test_la_respuesta_envuelta_en_una_cerca_de_codigo_se_desenvuelve():
    r = coi.separar_bloques("```markdown\n#CONTEXTO\na\n#OBJETIVO\nb\n#INSTRUCCIONES\nc\n```")
    assert r["estructura_ok"] and r["instrucciones"] == "c"


def test_cerca_de_cierre_huerfana_no_ensucia_el_ultimo_bloque():
    r = coi.separar_bloques("Aquí va:\n```\n#CONTEXTO\na\n#OBJETIVO\nb\n#INSTRUCCIONES\nc\n```\nlisto")
    assert r["estructura_ok"]
    # el bloque con su cerca propia (abre y cierra) no se toca
    r2 = coi.separar_bloques("#CONTEXTO\na\n#OBJETIVO\nb\n#INSTRUCCIONES\nc\n```json\n{}\n```")
    assert r2["instrucciones"] == "c\n```json\n{}\n```"


@pytest.mark.parametrize("texto", [
    "",
    "Hola, esto no trae encabezados.",
    "#CONTEXTO\na\n#OBJETIVO\nb",                                   # falta un encabezado
    "#OBJETIVO\nb\n#CONTEXTO\na\n#INSTRUCCIONES\nc",                # desordenados
    "#CONTEXTO\n\n#OBJETIVO\nb\n#INSTRUCCIONES\nc",                 # un bloque vacío
    "CONTEXTO\na\nOBJETIVO\nb\nINSTRUCCIONES\nc",                   # sin «#»
])
def test_sin_estructura_los_bloques_van_null_y_completo_se_conserva(texto):
    r = coi.separar_bloques(texto)
    assert r["estructura_ok"] is False
    assert (r["contexto"], r["objetivo"], r["instrucciones"]) == (None, None, None)
    assert r["completo"] == texto


def test_entrada_que_no_es_texto_no_revienta():
    assert coi.separar_bloques(None)["estructura_ok"] is False
    assert coi.separar_bloques(None)["completo"] == ""


def test_el_formato_exacto_del_archivo_de_instrucciones_se_separa():
    """Lo que el dueño pide en coi_system.md (#CONTEXT / #OBJECTIVE / #INSTRUCTIONS con sus siete
    partes) es justo lo que este parser entiende."""
    texto = ("#CONTEXT\nYou are X.\n#OBJECTIVE\nDo Y.\n#INSTRUCTIONS\n\n1. Primary Target Definition\n"
             "   * a\n2. Initial Data Cues\n   * b\n3. Search / Action Strategy\n   * c\n"
             "4. Validation Criteria\n   * d\n5. Disambiguation Rules\n   * e\n6. Output Format\n   * f\n"
             "7. Constraints\n   * g")
    r = coi.separar_bloques(texto)
    assert r["estructura_ok"] and r["instrucciones"].startswith("1. Primary Target Definition")
    assert r["instrucciones"].endswith("* g")


# ---------------------------------------------------------------------------
# idioma

@pytest.mark.parametrize("texto,esperado", [
    ("Quiero un plan de contenido para mi canal de cocina", "es"),
    ("¿Cómo hago un guion para mis ventas?", "es"),
    ("Necesito ayuda con el correo de mi jefe", "es"),
    ("Write a prompt for my podcast about travel", "en"),
    ("I need help with the marketing plan for a startup", "en"),
    ("podcast", "es"),                      # sin señal: el idioma de quien usa el producto
    ("", "es"),
    ("Plan de marketing for my startup en México", "es"),
])
def test_idioma(texto, esperado):
    assert coi.idioma(texto) == esperado


# ---------------------------------------------------------------------------
# costo

def test_costo_con_la_tarifa_del_dueno():
    """1500 tokens de entrada (1000 en caché), 700 de salida, a 0.25 / 0.025 / 2.00 dólares por millón."""
    uso = {"modelo": "gpt-5-mini", "entrada": 1500, "salida": 700, "cache_leida": 1000}
    esperado = (500 * 0.25 + 1000 * 0.025 + 700 * 2.0) / 1_000_000
    assert coi.costo_usd(uso) == pytest.approx(esperado, abs=1e-9)
    assert coi.costo_usd({**uso, "cache_leida": 0}) == pytest.approx((1500 * 0.25 + 700 * 2.0) / 1e6, abs=1e-9)


def test_la_fila_de_la_tarifa_esta_en_pricing_json_con_su_fuente():
    precios = json.loads((RAIZ / "tools" / "pricing.json").read_text(encoding="utf-8"))["rag"]
    fila = precios["modelos"]["gpt-5-mini"]
    assert fila == {"entrada": 0.25, "cache_leida": 0.025, "salida": 2.0}
    assert "2026-10-15" in precios["fuente"] and "dueño" in precios["fuente"]


@pytest.mark.parametrize("uso", [
    None, {}, {"modelo": "no-esta-en-la-tarifa", "entrada": 1, "salida": 1},
    {"modelo": "gpt-5-mini", "entrada": None, "salida": 1},
    {"modelo": "gpt-5-mini", "entrada": 1, "salida": "7"},
])
def test_sin_precio_o_sin_conteo_el_costo_es_none_nunca_inventado(uso):
    assert coi.costo_usd(uso) is None


def test_tokens_en_cache_sin_precio_de_cache_no_se_inventan(monkeypatch):
    from pipeline import costos_rag
    monkeypatch.setattr(costos_rag, "precios", lambda: {"m": {"entrada": 1.0, "salida": 1.0}})
    assert coi.costo_usd({"modelo": "m", "entrada": 10, "salida": 10, "cache_leida": 5}) is None
    assert coi.costo_usd({"modelo": "m", "entrada": 10, "salida": 10, "cache_leida": 0}) == pytest.approx(2e-5)


# ---------------------------------------------------------------------------
# configuración

def test_modelo_y_razonamiento_por_defecto(monkeypatch):
    from pipeline.config import settings
    monkeypatch.delenv("COI_MODELO", raising=False)
    monkeypatch.delenv("COI_RAZONAMIENTO", raising=False)
    assert coi.modelo() == settings.openai_model
    assert coi.razonamiento() == "minimal"


def test_las_variables_de_entorno_mandan(monkeypatch):
    monkeypatch.setenv("COI_MODELO", "otro-modelo")
    monkeypatch.setenv("COI_RAZONAMIENTO", "low")
    assert (coi.modelo(), coi.razonamiento()) == ("otro-modelo", "low")
    for apagado in ("", "ninguno", "OFF", "none"):
        monkeypatch.setenv("COI_RAZONAMIENTO", apagado)
        assert coi.razonamiento() is None


def test_motivo_corto_una_linea_y_con_tope():
    assert coi.motivo_corto("  una\n frase   corta ") == "una frase corta"
    assert len(coi.motivo_corto("x" * 1000)) <= 241
    assert coi.motivo_corto(None) == ""


# ---------------------------------------------------------------------------
# el archivo de instrucciones

def test_el_archivo_de_instrucciones_trae_el_formato_que_el_parser_entiende():
    """No se fija el texto exacto (el dueño lo edita a su gusto), solo que el formato que pide
    al modelo —#CONTEXT/#OBJECTIVE/#INSTRUCTIONS, y sus equivalentes en español— sea el que
    `separar_bloques` sabe leer."""
    texto = (RAIZ / "prompts" / "coi_system.md").read_text(encoding="utf-8")
    assert "#CONTEXT" in texto and "#OBJECTIVE" in texto and "#INSTRUCTIONS" in texto
    assert "#CONTEXTO" in texto and "#OBJETIVO" in texto and "#INSTRUCCIONES" in texto


def test_instrucciones_sin_langfuse_son_el_archivo(monkeypatch):
    monkeypatch.delenv("LANGFUSE_PROMPTS", raising=False)
    assert coi.instrucciones() == (RAIZ / "prompts" / "coi_system.md").read_text(encoding="utf-8")


def test_las_instrucciones_no_traen_llaves_que_format_se_comeria():
    """load_prompt devuelve un str que algunos sitios formatean; las de COI van tal cual."""
    texto = (RAIZ / "prompts" / "coi_system.md").read_text(encoding="utf-8")
    assert "{" not in texto and "}" not in texto
