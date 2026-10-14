"""RAG·11 — el sondeo de /automatiza (static/sondeo.js).

Lo que se protege es la lógica de TIEMPO de la espera: la escalera copiada de
MIX, el aviso y el tope que miden silencio y no espera, el 429 que no cancela,
la pestaña oculta que no pide y el plazo de cada petición. Todo eso corre de
verdad en tests/sondeo_nodo.js, con reloj y fetch de mentira (sin esperar
minutos). Aquí, además, lo que se revisa sin node: que la escalera siga siendo
la de MIX y que el archivo no choque con la CSP de /automatiza.
"""
import os
import re
import shutil
import subprocess
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parent.parent
SONDEO = RAIZ / "static" / "sondeo.js"
MIX = RAIZ / "static" / "mix.html"
ARNES = RAIZ / "tests" / "sondeo_nodo.js"


def _nodo() -> str | None:
    """El node de la máquina de pruebas (/opt/node22) o, si no, el del PATH."""
    fijo = "/opt/node22/bin/node"
    if os.path.exists(fijo):
        return fijo
    return shutil.which("node")


def _codigo() -> str:
    """sondeo.js sin comentarios: la cabecera NOMBRA eval para decir que no se usa."""
    js = SONDEO.read_text(encoding="utf-8")
    js = re.sub(r"/\*.*?\*/", "", js, flags=re.S)
    return re.sub(r"//[^\n]*", "", js)


@pytest.mark.skipif(_nodo() is None, reason="node no está instalado")
def test_arnes_del_sondeo_en_node():
    """La escalera, el aviso, el tope, el 429, la pestaña oculta, alConexion,
    reanudar y el plazo por petición, contra un reloj que el arnés empuja.
    Con tope de tiempo: una regresión que despierte cada milisegundo no puede
    colgar la suite entera."""
    r = subprocess.run([_nodo(), str(ARNES)], capture_output=True, text=True,
                       encoding="utf-8", cwd=str(RAIZ), timeout=120)
    assert r.returncode == 0, r.stdout + r.stderr
    assert "comprobaciones OK" in r.stdout, r.stdout


def test_la_escalera_y_los_plazos_son_los_de_mix():
    mix = MIX.read_text(encoding="utf-8")
    js = SONDEO.read_text(encoding="utf-8")
    pasos_mix = re.search(r"const MXEJ_PASOS = \[([^\]]+)\]", mix).group(1)
    pasos = re.search(r"PASOS: \[([^\]]+)\]", js).group(1)
    escalera = [int(x) for x in pasos.split(",")]
    assert escalera == [int(x) for x in pasos_mix.split(",")]
    # no decreciente, no creciente: la escalera repite 5000 a propósito
    assert all(b >= a for a, b in zip(escalera, escalera[1:]))
    assert re.search(r"AVISO_MS: (\d+)", js).group(1) == \
        re.search(r"const MXEJ_AVISO = (\d+)", mix).group(1)
    assert re.search(r"TOPE_MS: (\d+)", js).group(1) == \
        re.search(r"const MXEJ_TOPE = (\d+)", mix).group(1)
    assert re.search(r"TIMEOUT_MS: (\d+)", js).group(1) == \
        re.search(r"AbortSignal\.timeout\((\d+)\)", mix).group(1)
    assert re.search(r"MAX_429_MS: (\d+)", js).group(1) == "60000"


def test_nada_que_choque_con_la_csp():
    """/automatiza sirve script-src 'self' sin 'unsafe-eval' y style-src 'self'."""
    codigo = _codigo()
    assert not re.search(r"\beval\s*\(|new\s+Function\b|\bFunction\s*\(", codigo)
    assert "setAttribute('style'" not in codigo and 'setAttribute("style"' not in codigo
    assert "innerHTML" not in codigo and "insertAdjacentHTML" not in codigo
    assert "document.write" not in codigo


def test_sin_dependencias_ni_urls_propias():
    """Un módulo suelto: no importa nada y no pide nada que la página no le dé."""
    codigo = _codigo()
    assert not re.search(r"\brequire\s*\(|\bimport\b", codigo)
    assert not re.search(r"https?://|/api/", codigo)


def test_se_expone_en_window_y_para_node():
    codigo = _codigo()
    assert "raiz.Sondeo = Sondeo" in codigo
    assert "module.exports = Sondeo" in codigo
