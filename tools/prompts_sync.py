"""M10 — siembra los prompts del repo en Langfuse (Prompt Management).

    python tools/prompts_sync.py            # sube lo que difiera, con resumen
    python tools/prompts_sync.py --dry      # solo reporta, no crea nada
    python tools/prompts_sync.py --solo guionista_system

Cada prompts/<name>.md se crea como versión de texto con label `production`
(el MISMO nombre que usa pipeline/config.py::load_prompt). Idempotente: si la
versión `production` ya tiene texto idéntico, no se crea otra. Después de la
siembra, el dueño edita en la UI de Langfuse y mueve el label a mano; el
pipeline toma `production` al vuelo (fallback: el .md del repo).

Flujo recomendado tras editar en la UI: probar en una película propia y recién
ahí promover el label — los tests del repo corren contra los .md locales.
Requiere LANGFUSE_PUBLIC_KEY/SECRET_KEY en .env (config ya carga dotenv).
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pipeline.config import PROMPTS_DIR  # noqa: E402 — también carga .env


def sincronizar(solo: str | None = None, dry: bool = False,
                cliente=None) -> dict[str, str]:
    """→ {nombre: 'nuevo' | 'actualizado' | 'igual'}. `cliente` inyectable
    para tests; default el get_client() de Langfuse."""
    if cliente is None:
        from langfuse import get_client
        cliente = get_client()
    resultado: dict[str, str] = {}
    for md in sorted(PROMPTS_DIR.glob("*.md")):
        nombre = md.stem
        if solo and nombre != solo:
            continue
        texto = md.read_text(encoding="utf-8")
        try:
            actual = cliente.get_prompt(nombre, label="production", type="text",
                                        max_retries=1, cache_ttl_seconds=0)
            estado = "igual" if actual.prompt == texto else "actualizado"
        except Exception:  # noqa: BLE001 — no existe todavía en Langfuse
            estado = "nuevo"
        if estado != "igual" and not dry:
            cliente.create_prompt(name=nombre, prompt=texto, type="text",
                                  labels=["production"],
                                  commit_message="siembra desde el repo (tools/prompts_sync.py)")
        resultado[nombre] = estado
    return resultado


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--solo", help="sincronizar únicamente este prompt")
    ap.add_argument("--dry", action="store_true", help="reportar sin crear versiones")
    args = ap.parse_args()

    import os
    if not os.getenv("LANGFUSE_PUBLIC_KEY"):
        sys.exit("Faltan las claves de Langfuse en .env (LANGFUSE_PUBLIC_KEY/SECRET_KEY)")

    r = sincronizar(solo=args.solo, dry=args.dry)
    if not r:
        sys.exit(f"ningún prompt coincide con --solo {args.solo!r}")
    ancho = max(len(n) for n in r)
    for nombre, estado in r.items():
        marca = {"nuevo": "+", "actualizado": "~", "igual": "="}[estado]
        print(f"  {marca} {nombre:<{ancho}}  {estado}")
    cambios = sum(1 for e in r.values() if e != "igual")
    print(f"{'(dry) ' if args.dry else ''}{cambios} de {len(r)} prompts "
          f"{'necesitan versión nueva' if args.dry else 'sembrados con label production'}")


if __name__ == "__main__":
    main()
