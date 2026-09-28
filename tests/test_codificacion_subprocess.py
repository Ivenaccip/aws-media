"""Un subproceso con `text=True` y sin `encoding` se lee en cp1252 en Windows.

QUÉ ROMPE

`subprocess.run(..., text=True)` decodifica la salida con
`locale.getpreferredencoding()`. En Linux eso es UTF-8 y nadie se entera; en la
consola de Windows es **cp1252**, así que cualquier acento que imprima el
subproceso vuelve partido. Los tests que comparan cadenas fallan con un diff
ilegible:

    assert 'se cayó' in '… pendientes: se cay\\xf3 — recarga para intentarlo'

El síntoma es peor que el fallo: la suite verde en el CI (Linux, dentro del
contenedor) y roja en la máquina del dueño. Cinco tests vivieron así lo
suficiente como para que «esos cinco siempre fallan» se volviera ruido de fondo
— y un fallo de verdad se habría escondido justo ahí.

POR QUÉ UN TEST Y NO UN COMENTARIO

El arreglo es una palabra por llamada, y por eso mismo se olvida: nadie escribe
`encoding="utf-8"` de memoria en una llamada nueva a node. Este test recorre la
suite y nombra las que faltan.

ALCANCE

Solo `tests/`. El mismo hueco existe en `tools/` (ffmpeg, check_js, los
generadores), pero ahí la salida no siempre es UTF-8 —ffmpeg escribe en la
codificación del sistema— y cambiarlo es tocar rutas de producción del pipeline
de video. Va en su propia tarjeta, no de rondón en un arreglo de tests.
"""
from __future__ import annotations

import re
from pathlib import Path

TESTS = Path(__file__).resolve().parent


def llamadas(texto: str):
    """El texto de cada subprocess.run(...), con los paréntesis balanceados.
    Una regex sola no vale: los argumentos llevan paréntesis dentro."""
    for m in re.finditer(r"subprocess\.run\(", texto):
        i = m.end() - 1
        prof, j = 0, i
        while j < len(texto):
            if texto[j] == "(":
                prof += 1
            elif texto[j] == ")":
                prof -= 1
                if prof == 0:
                    break
            j += 1
        yield texto[m.start():j + 1]


def test_ningun_subproceso_de_la_suite_se_lee_en_cp1252():
    culpables = []
    for p in sorted(TESTS.glob("test_*.py")):
        # este archivo se salta a sí mismo: es el que DEFINE la regla, así que
        # lleva llamadas malas a propósito —en el docstring y en el test del
        # detector de abajo— y se acusaría solo
        if p.name == Path(__file__).name:
            continue
        texto = p.read_text(encoding="utf-8")
        for call in llamadas(texto):
            if "text=True" in call and "encoding=" not in call:
                linea = texto[:texto.index(call)].count("\n") + 1
                culpables.append(f"{p.name}:{linea}")
    assert not culpables, (
        "estas llamadas leen la salida en cp1252 en Windows y van a fallar solo "
        "en la máquina del dueño; añádeles encoding=\"utf-8\":\n  "
        + "\n  ".join(culpables))


def test_el_detector_encuentra_el_caso_malo():
    """Si el escáner dejara de ver una llamada, el test de arriba pasaría
    siempre y no protegería nada. Aquí se le enseña una mala y una buena."""
    mala = 'r = subprocess.run([node, str(f)], capture_output=True, text=True)'
    buena = 'r = subprocess.run([node, str(f)], text=True, encoding="utf-8")'
    conparen = 'r = subprocess.run([node, "-e", f(x)], capture_output=True, text=True)'
    assert [c for c in llamadas(mala) if "encoding=" not in c]
    assert not [c for c in llamadas(buena) if "encoding=" not in c]
    # el caso que tumba a una regex ingenua: paréntesis dentro de los argumentos
    assert [c for c in llamadas(conparen) if "encoding=" not in c]
