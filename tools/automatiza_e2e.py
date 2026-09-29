"""RAG·8 — prueba de punta a punta de /automatiza contra un entorno desplegado.

Hace lo mismo que hará la página: pide un flujo, sondea hasta que termina y
descarga el .json. Imprime cuánto tardó cada paso, que es lo que importa aquí
(arranque en frío del API y del worker, la cola, el muro de 29 s).

RAG·11 — también imprime cada paso de la espera (entender → buscar → armar →
revisar) y, al final, cuánto estuvo en la fila y cuánto armando: con eso se
fijan TARDA_MIN y TARDA_MAX de la página («suele tardar entre 1 y 3 min»,
PROVISIONALES hasta medirlos aquí). Corre varias veces y con el armado real
(RAG·21) antes de prometer un número.

RAG·10/13 — revisa además que las páginas públicas respondan con su CSP y que
el execute-api salga con X-Robots-Tag: noindex (solo irremplazables.xyz se
indexa).

NO gasta en modelos mientras el armado sea de mentira (pipeline/publico.py
ARMADO_DE_MENTIRA). SÍ cuenta como una corrida para el tope del día y para el
de tu IP. El interruptor tiene que estar encendido (tools/automatiza.py).
Con --correo deja ESE correo guardado en la corrida (automatiza_contactos):
usa uno tuyo, nunca el de otra persona.

Uso (cmd, desde la raíz del repo):
    venv\\Scripts\\python tools\\automatiza_e2e.py --api https://xxxx.execute-api.us-east-1.amazonaws.com
    venv\\Scripts\\python tools\\automatiza_e2e.py --api ... --correo tu@correo.com
"""
from __future__ import annotations

import argparse
import html
import json
import re
import sys
import time
import urllib.error
import urllib.request

TEXTO = ("Cada vez que llegue un correo con una factura en PDF, guardarla en "
         "una carpeta de Google Drive y anotar el monto en una hoja de cálculo.")
PAGINAS = ("/automatiza", "/privacidad", "/terminos")


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


def _pagina(url: str) -> tuple[int, dict, float]:
    """GET de una página HTML: código y cabeceras (en minúsculas)."""
    t0 = time.monotonic()
    try:
        with urllib.request.urlopen(urllib.request.Request(url), timeout=35) as r:
            codigo, cab = r.status, r.headers
    except urllib.error.HTTPError as e:
        codigo, cab = e.code, e.headers
    return codigo, {k.lower(): v for k, v in cab.items()}, (time.monotonic() - t0) * 1000


def version_del_aviso(api: str) -> str:
    """La versión del aviso con la que el servidor llena /automatiza
    (data-aviso-version). El POST de la corrida y el del correo la exigen
    igual que a la página: sin ella contestan 409 y no guardan nada."""
    try:
        with urllib.request.urlopen(urllib.request.Request(api + "/automatiza"), timeout=35) as r:
            pagina = r.read().decode("utf-8", errors="replace")
    except (urllib.error.URLError, OSError):
        return ""
    m = re.search(r'data-aviso-version="([^"]*)"', pagina)
    return html.unescape(m.group(1)) if m else ""


def revisar_paginas(api: str, pid: str | None) -> bool:
    """Las páginas públicas: 200, con CSP, y X-Robots-Tag donde toca."""
    ok = True
    rutas = list(PAGINAS) + ([f"/automatiza/c/{pid}"] if pid else [])
    propio = "irremplazables.xyz" in api
    for ruta in rutas:
        codigo, cab, ms = _pagina(api + ruta)
        robots = cab.get("x-robots-tag", "—")
        # en el dominio propio se indexa todo menos el enlace para volver
        debe = "noindex, nofollow" if (not propio or "/c/" in ruta) else "—"
        bien = codigo == 200 and "content-security-policy" in cab and robots == debe
        ok &= bien
        print(f"   {ruta:<34} {codigo} en {ms:.0f} ms  x-robots-tag={robots}"
              f"{'' if bien else '  ← REVISAR (se esperaba ' + debe + ' y CSP)'}")
    return ok


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--api", required=True, help="ApiUrl del stack (sin / al final)")
    ap.add_argument("--texto", default=TEXTO)
    ap.add_argument("--espera", type=int, default=120, help="segundos máximos de sondeo")
    ap.add_argument("--correo", help="deja este correo en la corrida (tuyo, no de otra persona)")
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

    # como la página: la descripción viaja con la versión del aviso aceptado
    # (RAG·13); sin ella el POST contesta 409 y no guarda nada
    version = version_del_aviso(api)
    codigo, cuerpo, ms = _pedir("POST", base + "/corridas", {"texto": a.texto, "utm_source": "e2e",
                                                             "aviso_version": version})
    print(f"2. pedir       {codigo} en {ms:.0f} ms  {cuerpo}")
    if codigo != 202:
        return 1
    pid = cuerpo["id"]

    # cuándo se vio por primera vez cada estado: con eso se mide fila y armado
    t0, vistos, primera = time.monotonic(), [], {}
    while time.monotonic() - t0 < a.espera:
        codigo, cuerpo, ms = _pedir("GET", f"{base}/corridas/{pid}")
        ahora = time.monotonic() - t0
        paso = (cuerpo.get("estado"), cuerpo.get("lugar"), cuerpo.get("paso"))
        primera.setdefault(paso[0], ahora)
        if paso not in vistos:
            vistos.append(paso)
            print(f"3. sondeo      {codigo} a los {ahora:4.1f} s  "
                  f"estado={paso[0]} lugar={paso[1]} paso={paso[2]} "
                  f"lleva_seg={cuerpo.get('lleva_seg')}")
        if cuerpo.get("estado") not in ("en_fila", "armando"):
            break
        time.sleep(2)
    else:
        print(f"   → sigue sin terminar tras {a.espera} s: revisa los logs del WorkerPublico")
        return 1
    fin = time.monotonic() - t0
    arranca = primera.get("armando", fin)
    print(f"   espera total {fin:.1f} s · en fila {arranca:.1f} s · armando {fin - arranca:.1f} s"
          "  (lo que mide TARDA_MIN/TARDA_MAX; resolución de 2 s)")
    if not cuerpo.get("listo"):
        print(f"   → terminó sin flujo: {cuerpo}")
        return 1

    codigo, flujo, ms = _pedir("GET", api + cuerpo["descarga"])
    ok = codigo == 200 and isinstance(flujo, dict) and flujo.get("nodes")
    print(f"4. descargar   {codigo} en {ms:.0f} ms  {len(flujo.get('nodes', [])) if ok else flujo} nodos")

    if a.correo:
        codigo, r, ms = _pedir("POST", f"{base}/corridas/{pid}/correo",
                               {"correo": a.correo, "recontacto": False, "origen": "listo",
                                "aviso_version": version})
        _, sondeo, _ = _pedir("GET", f"{base}/corridas/{pid}")
        bien = codigo == 200 and sondeo.get("correo") == r.get("correo")
        ok = ok and bien
        print(f"5. correo      {codigo} en {ms:.0f} ms  {r}  (el sondeo dice {sondeo.get('correo')})")

    print("6. páginas")
    ok = revisar_paginas(api, pid) and ok
    print("\nTUBERÍA COMPLETA ✓" if ok else "\nFALLÓ algo: revisa arriba")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
