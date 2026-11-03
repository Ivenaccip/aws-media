"""Asistente de Automatizaciones — la guarda de español LATAM (tuteo), compartida.

El copy del Asistente va en español de Latinoamérica con tuteo: ni «vos», ni «tenés», ni «escribí». Antes
la guarda era una lista cerrada de 12 palabras: un resumen con «preparás» o «redactá» la pasaba. Aquí la
guarda mira las TERMINACIONES del voseo y no una lista:

  - presente de vos: -ás / -és / -ís  (tenés, querés, preparás, vivís)
  - imperativo de vos: -á / -é / -í    (redactá, hacé, escribí)
  - y una lista corta de formas que las terminaciones no ven (con pronombre pegado: «avisame», «decime»,
    «contanos»; o que acaban en -rá: «mirá»).

Las terminaciones también las tiene el tuteo (el futuro «podrás», el presente de «estás», «además», «así»,
«aquí»). Esas se dejan pasar con `TUTEO_PERMITIDO` y con la regla «el futuro acaba en -rá/-rás». Si una
palabra legítima salta, se agrega a la lista a propósito, con su motivo. `voseo(texto)` devuelve las palabras
que no pasan: lista vacía = tuteo. La Fase B (modo real) importa esta misma función.

Qué textos revisa este archivo: los errores del API, los mensajes de los finales, y de cada muestra su
nombre, resumen, `faltan`, `pendientes`, `advertencias`, las etiquetas de sus nodos y todo texto con espacios
del flujo de n8n (instrucciones, tareas, asuntos).
"""
import re
import unicodedata

import pytest

from pipeline import asistente
from server import automatiza_api

# Las terminaciones -rá / -rás / -ré / -rés son AMBIGUAS: «prepararás» (tuteo, futuro) y «preparás» (vos,
# presente) acaban igual, y sin un diccionario no se distinguen. Por eso esas terminaciones se dejan pasar
# (son casi siempre futuros) y el voseo de los verbos del copy de una app se ve por esta lista de verbos:
# de cada infinitivo salen sus formas de vos (presente e imperativo).
VERBOS_DEL_COPY = """
preparar redactar conectar mirar recargar intentar borrar acortar revisar mandar enviar avisar contar ayudar
dejar pegar copiar descargar probar cambiar usar guardar agregar quitar pulsar tocar armar buscar esperar
cerrar empezar pensar tomar cuidar cargar iniciar activar apagar encender confirmar cancelar escoger
comer vender ofrecer leer volver mover responder entender correr romper
escribir elegir abrir pedir decir hacer poner tener venir salir seguir repetir recibir permitir
""".split()
_IRREGULARES = {"decir": ("decís", "decí"), "hacer": ("hacés", "hacé"), "poner": ("ponés", "poné"),
                "tener": ("tenés", "tené"), "venir": ("venís", "vení"), "salir": ("salís", "salí")}


def _formas_de_vos(infinitivo: str) -> tuple[str, str]:
    if infinitivo in _IRREGULARES:
        return _IRREGULARES[infinitivo]
    raiz, fin = infinitivo[:-2], infinitivo[-2:]
    return raiz + {"ar": "ás", "er": "és", "ir": "ís"}[fin], raiz + {"ar": "á", "er": "é", "ir": "í"}[fin]


# formas que las terminaciones no ven: con pronombre pegado (el acento se pierde) y los verbos sueltos
FORMAS_DE_VOS = frozenset(
    set("""
vos sos querés podés sabés querés
fijate contanos decime avisame avisanos mandame mandanos contame ayudame ayudanos
dejame acordate quedate ponete sentate animate cuidate
""".split()) | {f for v in VERBOS_DEL_COPY for f in _formas_de_vos(v)})

# palabras que acaban como el voseo y son del tuteo (adverbios, nacionalidades, futuros, deícticos…)
TUTEO_PERMITIDO = frozenset("""
más además demás atrás detrás jamás quizás después través interés revés
inglés francés portugués japonés holandés cortés país anís
estás estés está allá acá ahí aquí allí así sí mí qué porqué café bebé mamá papá sofá sé té dé quizá
""".split())

_PRESENTE = re.compile(r"\b([a-zñü]+(?:ás|és|ís))\b")
_IMPERATIVO = re.compile(r"\b([a-zñü]+[áéí])\b")
_PALABRA = re.compile(r"[\wñü]+")


def _futuro(palabra: str) -> bool:
    """El futuro del tuteo acaba en -rá / -rás / -ré / -rés («podrás», «llegará», «tendré»). Ver arriba por
    qué esta terminación se deja pasar si el verbo no está en `VERBOS_DEL_COPY`."""
    return bool(re.search(r"r[áé]s?$", palabra))


def voseo(texto: str) -> list[str]:
    """Las palabras de `texto` que son voseo, en orden y sin repetir. Vacía = español de tuteo."""
    texto = unicodedata.normalize("NFC", str(texto)).lower()
    halladas: list[str] = []
    for p in _PALABRA.findall(texto):
        if p in TUTEO_PERMITIDO:
            continue
        malo = p in FORMAS_DE_VOS
        if not malo and not _futuro(p):
            malo = bool(_PRESENTE.fullmatch(p) or _IMPERATIVO.fullmatch(p))
        if malo and p not in halladas:
            halladas.append(p)
    return halladas


# ---------------------------------------------------------------------------
# la guarda se prueba a sí misma

VOSEANTES = [
    # las 12 de la lista vieja y las del API
    "vos", "tenés", "querés", "podés", "sabés", "escribí", "mirá", "andá", "hacé", "fijate", "contanos",
    "decime", "avisame", "mandame", "intentá", "recargá", "borrá", "acortá",
    # las que la lista vieja no veía
    "preparás", "redactá", "conectás", "elegí", "poné", "tené", "vení", "pensá", "decís", "vivís", "pedí",
    "Revisá tu cuenta de Gmail", "Cuando llega un correo, preparás una respuesta", "sos el dueño",
]

TUTEANTES = [
    "Cuéntanos qué quieres automatizar, aunque sea en una frase.", "podrás", "tendrás", "estarás", "verás",
    "recibirás", "llegará", "estará", "será", "tendré", "más", "además", "después", "así", "aquí", "ahí",
    "está", "estás", "inglés", "país", "sí", "qué", "Conecta tu cuenta de Gmail en n8n y elige el destinatario.",
    "Esta vez no pudimos armar un flujo que importe bien en n8n. Preferimos no darte uno roto.",
    "Prepara un resumen de lo importante del día.", "Redacta una respuesta amable y revisa el tono.",
    "Escribe, elige, conecta, recarga, intenta, borra, mira, pon, ten, ven.", "",
]


@pytest.mark.parametrize("texto", VOSEANTES)
def test_la_guarda_ve_el_voseo_por_sus_terminaciones_y_no_solo_por_una_lista(texto):
    assert voseo(texto), texto


@pytest.mark.parametrize("texto", TUTEANTES)
def test_la_guarda_no_da_falsas_alarmas_con_el_tuteo(texto):
    assert voseo(texto) == [], texto


def test_la_guarda_dice_cual_palabra_es_y_no_repite():
    assert voseo("Tenés que elegir; elegí y tenés más") == ["tenés", "elegí"]
    assert voseo("PREPARÁS") == ["preparás"]


def test_la_guarda_ve_una_forma_con_tilde_combinante():
    assert voseo("tenés") == ["tenés"]


# ---------------------------------------------------------------------------
# los textos del Asistente

def _hojas(valor):
    """Todo texto del flujo de n8n que parece prosa (lleva espacios y no es una expresión de n8n)."""
    if isinstance(valor, str):
        if " " in valor.strip() and not valor.startswith("="):
            yield valor
    elif isinstance(valor, dict):
        for v in valor.values():
            yield from _hojas(v)
    elif isinstance(valor, list):
        for v in valor:
            yield from _hojas(v)


def test_los_errores_y_mensajes_del_asistente_son_de_tuteo():
    textos = [t for _, t in automatiza_api.ERRORES.values()] + list(asistente.MENSAJES.values())
    assert len(textos) >= 13
    for t in textos:
        assert voseo(t) == [], t


def test_todo_el_copy_de_las_muestras_es_de_tuteo():
    revisados = 0
    for m in asistente.muestras():
        textos = [m.resumen, *m.faltan, *m.pendientes, *m.advertencias]
        textos += [n.get("etiqueta", "") for n in m.nodos]
        if m.flujo:
            textos += [m.flujo["name"], *_hojas(m.flujo["nodes"])]
        if m.grafo:
            textos += [m.grafo["nombreFlujo"]]
        for t in textos:
            revisados += 1
            assert voseo(t) == [], (m.id, t, voseo(t))
    assert revisados > 30, "la guarda no revisó casi nada: ¿cambió la forma de las muestras?"


# la lista cerrada de 12 palabras que había antes (tests/test_automatiza_asistente.py): la mutación pasaba
LISTA_VIEJA = re.compile(r"\b(vos|tenés|querés|podés|sabés|escribí|mirá|andá|hacé|fijate|contanos|decime)\b", re.I)


def test_un_resumen_con_voseo_no_pasa_la_guarda_aunque_la_lista_vieja_lo_dejaba_pasar():
    """La mutación del hallazgo: «prepara» → «preparás» (resumen_diario) y «redacta» → «redactá» (correos)."""
    mutados = 0
    for m in asistente.muestras():
        if m.estado != "listo":
            continue
        sucio = m.resumen.replace("prepara ", "preparás ").replace("redacta ", "redactá ")
        if sucio == m.resumen:
            continue
        mutados += 1
        assert LISTA_VIEJA.search(sucio) is None, "la lista vieja ya lo veía: este test dejó de probar algo"
        assert voseo(sucio), m.id
        assert voseo(m.resumen) == [], m.id
    assert mutados == 2
