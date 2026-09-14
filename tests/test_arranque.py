"""Lo que la app carga al arrancar — porque el init de Lambda tiene 10 s contados.

Medido en produccion el 13-09-2026: los 70 intentos de init de los ultimos 7
dias terminaron en `Status: timeout`, los 70. Cuando eso pasa Lambda aborta la
inicializacion y la repite DENTRO de la invocacion, que si se factura: el primer
usuario tras un arranque esperaba 22 s por un endpoint de 47 ms.

El culpable no era ffmpeg ni Chromium: era `langfuse.openai`, que arrastra el
SDK de OpenAI entero al importar `pipeline/llm.py`. 1,8 s de los 4,7 s que
tardaba importar `server.app`, en una Lambda donde la inmensa mayoria de las
peticiones no llaman a ningun LLM.
"""
import os
import subprocess
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent


def _en_proceso_limpio(codigo: str, clave: str = "") -> str:
    """Corre `codigo` en un intérprete nuevo: sys.modules de otros tests mentiría.

    `clave` va explícita —nunca la real de `.env`— y solo donde construir el
    cliente la exige; el base_url apunta a un puerto muerto, así que aunque
    alguien añadiera una llamada, moriría en local sin salir a la red.
    """
    entorno = {**os.environ, "OPENAI_API_KEY": clave,
               "OPENAI_BASE_URL": "http://127.0.0.1:9"}
    r = subprocess.run([sys.executable, "-c", codigo], capture_output=True,
                       text=True, cwd=str(RAIZ), env=entorno)
    assert r.returncode == 0, f"el subproceso falló:\n{r.stderr[-2000:]}"
    return r.stdout.strip()


def test_el_arranque_no_carga_el_sdk_de_openai():
    """El guardián del cold start: si alguien devuelve el import al nivel de
    módulo de pipeline/llm.py, este test lo dice antes de que lo diga Lambda."""
    salida = _en_proceso_limpio(
        "import sys, server.app; print('openai' in sys.modules, 'langfuse.openai' in sys.modules)")
    assert salida == "False False", f"el arranque volvió a cargar el SDK: {salida}"


def test_el_cliente_se_materializa_al_usarlo():
    """Perezoso no puede significar roto: client() tiene que devolver el wrapper
    de Langfuse de verdad, que es lo que instrumenta cada generation."""
    salida = _en_proceso_limpio(
        "import sys\n"
        "from pipeline import llm\n"
        "antes = 'openai' in sys.modules\n"
        "c = llm.client()\n"
        "print(antes, 'openai' in sys.modules, type(c).__name__, llm.client() is c)",
        clave="sk-falsa-solo-para-construir-el-objeto")
    antes, despues, tipo, singleton = salida.split()
    assert antes == "False", "openai ya estaba cargado antes de pedir el cliente"
    assert despues == "True", "client() no materializó el SDK"
    assert tipo == "AsyncOpenAI", f"tipo inesperado: {tipo}"
    assert singleton == "True", "client() dejó de cachear: crearía un cliente por llamada"


def test_chat_json_sigue_expuesto():
    """Doce módulos de pipeline/ importan chat_json desde aquí: mover el import
    de arriba no puede haberse llevado la superficie pública del módulo."""
    from pipeline import llm
    assert callable(llm.chat_json)
    assert callable(llm.client)
