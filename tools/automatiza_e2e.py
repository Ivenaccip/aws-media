"""RAG·8 — prueba de punta a punta de /automatiza contra un entorno desplegado.

Hace lo mismo que hará la página: pide un flujo, sondea hasta que termina y
descarga el .json. Imprime cuánto tardó cada paso, que es lo que importa aquí
(arranque en frío del API y del worker, la cola, el muro de 29 s).

NO gasta en modelos mientras el armado sea de mentira (pipeline/publico.py
ARMADO_DE_MENTIRA). SÍ cuenta como una corrida para el tope del día y para el
de tu IP. El interruptor tiene que estar encendido (tools/automatiza.py).

Uso (cmd, desde la raíz del repo):
    venv\\Scripts\\python tools\\automatiza_e2e.py --api https://xxxx.execute-api.us-east-1.amazonaws.com
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request

TEXTO = ("Cada vez que llegue un correo con una factura en PDF, guardarla en "
         "una carpeta de Google Drive y anotar el monto en una hoja de cálculo.")


def _pedir(metodo: str, url: str, cuerpo: dict | None = None) -> tuple[int, dict | list, float]:
    datos = json.dumps(cuerpo).encode() if cuerpo is not None else None
    req = urllib.request.Request(url, data=datos, method=metodo,
                                 headers={"Content-Type": "application/json"})
    t0 = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=35) as r:
            codigo, texto = r.status, r.read()
    except urllib.error.HTTPError as e:
        codigo, texto = e.code, e.read()
    ms = (time.monotonic() - t0) * 1000
    try:
        return codigo, json.loads(texto or b"{}"), ms
    except ValueError:
        return codigo, {"crudo": texto[:300].decode(errors="replace")}, ms


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--api", required=True, help="ApiUrl del stack (sin / al final)")
    ap.add_argument("--texto", default=TEXTO)
    ap.add_argument("--espera", type=int, default=120, help="segundos máximos de sondeo")
    a = ap.parse_args(argv)
    # se acepta con o sin https:// (como sale del output del deploy o copiado a mano)
    api = a.api.strip().rstrip("/")
    if not api.startswith(("http://", "https://")):
        api = "https://" + api
    base = api + "/api/publico"

    codigo, cuerpo, ms = _pedir("GET", base + "/estado")
    print(f"1. estado      {codigo} en {ms:.0f} ms  {cuerpo}")
    if codigo != 200 or not cuerpo.get("disponible"):
        print("   → no disponible: ¿interruptor encendido? ¿sal en SSM? (tools/automatiza.py estado)")
        return 1

    codigo, cuerpo, ms = _pedir("POST", base + "/corridas", {"texto": a.texto, "utm_source": "e2e"})
    print(f"2. pedir       {codigo} en {ms:.0f} ms  {cuerpo}")
    if codigo != 202:
        return 1
    pid = cuerpo["id"]

    t0, vistos = time.monotonic(), []
    while time.monotonic() - t0 < a.espera:
        codigo, cuerpo, ms = _pedir("GET", f"{base}/corridas/{pid}")
        paso = (cuerpo.get("estado"), cuerpo.get("lugar"))
        if paso not in vistos:
            vistos.append(paso)
            print(f"3. sondeo      {codigo} a los {time.monotonic() - t0:4.1f} s  "
                  f"estado={paso[0]} lugar={paso[1]}")
        if cuerpo.get("estado") not in ("en_fila", "armando"):
            break
        time.sleep(2)
    else:
        print(f"   → sigue sin terminar tras {a.espera} s: revisa los logs del WorkerPublico")
        return 1
    if not cuerpo.get("listo"):
        print(f"   → terminó sin flujo: {cuerpo}")
        return 1

    codigo, flujo, ms = _pedir("GET", api + cuerpo["descarga"])
    ok = codigo == 200 and isinstance(flujo, dict) and flujo.get("nodes")
    print(f"4. descargar   {codigo} en {ms:.0f} ms  {len(flujo.get('nodes', [])) if ok else flujo} nodos")
    print("\nTUBERÍA COMPLETA ✓" if ok else "\nFALLÓ la descarga")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
