"""UI·6 · Lo que la tarjeta pide ver EN PRODUCCIÓN, en un solo comando.

    python tools/verificar_web.py                       # https://irremplazables.xyz
    python tools/verificar_web.py --base https://…      # otro origen

Solo hace GET; no toca AWS ni Cloudflare. Comprueba:
  1. /estudio/_vitrina/ responde 200, HTML, `no-cache` y `noindex, nofollow`.
  2. Cada asset que enlaza la vitrina lleva `immutable` y, a la segunda
     petición, Cloudflare lo sirve con HIT.
  3. /estudio/assets/no-existe.js da 404 y no HTML.
  4. /auth.js sigue `no-cache` (si sale `max-age=14400`, Cloudflare pisa la
     cabecera: docs/OPERACION.md, «Browser Cache TTL»).
  5. Ninguna clave propia de tools/pricing.json viaja en los assets
     (la misma regla que tests/test_web_tuberia.py aplica al dist).

Lo único que queda fuera es lo que no mide una máquina: que el dueño abra la
vitrina en su teléfono y la apruebe. Sale 0 si todo pasó y 1 si algo falló.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
BASE = "https://irremplazables.xyz"
# Cloudflare trata distinto a un cliente sin User-Agent de navegador
AGENTE = "Mozilla/5.0 (verificar_web; Irremplazables)"


def pedir(url: str) -> tuple[int, dict[str, str], str]:
    req = urllib.request.Request(url, headers={"User-Agent": AGENTE})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, {k.lower(): v for k, v in r.headers.items()}, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, {k.lower(): v for k, v in e.headers.items()}, e.read().decode("utf-8", "replace")


def _claves(d, acc: set[str] | None = None) -> set[str]:
    acc = set() if acc is None else acc
    if isinstance(d, dict):
        for k, v in d.items():
            acc.add(k)
            _claves(v, acc)
    elif isinstance(d, list):
        for v in d:
            _claves(v, acc)
    return acc


def claves_prohibidas() -> set[str]:
    pricing = json.loads((RAIZ / "tools" / "pricing.json").read_text(encoding="utf-8"))
    tarifas = json.loads((RAIZ / "tools" / "tarifas.json").read_text(encoding="utf-8"))
    solo = {k for k in _claves(pricing) - _claves(tarifas) if "_" in k and len(k) >= 8}
    # nombre de un campo de /api/blotato; ver test_el_dist_no_trae_nada_de_pricing_json
    solo -= {"usd_por_mes"}
    return solo | {"costo_interno_usd_por_credito", "piso_venta_usd_por_credito",
                   "nota_por_duracion", "verified_on", "pricing.json"}


def verificar(base: str, pedir=pedir, prohibidas: set[str] | None = None) -> list[tuple[bool, str]]:
    base = base.rstrip("/")
    prohibidas = claves_prohibidas() if prohibidas is None else prohibidas
    res: list[tuple[bool, str]] = []

    def anota(ok: bool, texto: str) -> bool:
        res.append((ok, texto))
        return ok

    st, h, html = pedir(base + "/estudio/_vitrina/")
    if not anota(st == 200 and "text/html" in h.get("content-type", ""),
                 f"vitrina 200 y HTML (salió {st}, {h.get('content-type', '—')})"):
        return res  # sin vitrina no hay assets que revisar: UI·6 no está desplegada
    anota(h.get("cache-control") == "no-cache", f"vitrina no-cache (salió {h.get('cache-control', '—')})")
    anota(h.get("x-robots-tag") == "noindex, nofollow", f"vitrina noindex (salió {h.get('x-robots-tag', '—')})")

    assets = sorted(set(re.findall(r'(/estudio/assets/[^"\']+\.(?:js|css))', html)))
    if anota(bool(assets), f"la vitrina enlaza {len(assets)} assets"):
        textos = []
        for a in assets:
            pedir(base + a)  # la primera llena el borde
            st, h, cuerpo = pedir(base + a)
            textos.append(cuerpo)
            anota(st == 200 and "immutable" in h.get("cache-control", ""),
                  f"{a} immutable (salió {st}, {h.get('cache-control', '—')})")
            anota(h.get("cf-cache-status") == "HIT", f"{a} HIT en Cloudflare (salió {h.get('cf-cache-status', '—')})")
        coladas = sorted(k for k in prohibidas if any(k in t for t in textos))
        anota(not coladas, "sin claves de pricing.json en los assets" + (f": {coladas[:5]}" if coladas else ""))

    st, h, _ = pedir(base + "/estudio/assets/no-existe.js")
    anota(st == 404 and "text/html" not in h.get("content-type", ""),
          f"asset inexistente 404 y no HTML (salió {st}, {h.get('content-type', '—')})")

    st, h, _ = pedir(base + "/auth.js")
    anota(st == 200 and h.get("cache-control") == "no-cache",
          f"/auth.js no-cache (salió {st}, {h.get('cache-control', '—')})")
    return res


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--base", default=BASE)
    res = verificar(ap.parse_args().base)
    for ok, texto in res:
        print(("  ✓ " if ok else "  ✗ ") + texto)
    fallas = sum(not ok for ok, _ in res)
    if fallas:
        print(f"\n{fallas} comprobación(es) fallaron.")
        return 1
    print("\nTodo en orden. Falta solo abrir /estudio/_vitrina/ en el teléfono y aprobarla.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
