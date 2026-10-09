#!/usr/bin/env python
"""Prueba pagada pequeña de un endpoint de fal (R4).

Hace N llamadas al mismo endpoint, mide el tamaño de la salida y el tiempo, y
calcula el costo ESPERADO con la tarifa que se le dé (la de la página del
modelo). fal no devuelve lo cobrado: la cifra real se compara después en el
panel de uso de fal. Para tarifas por megapíxel enseña dos lecturas, porque la
página no dice si se cobra proporcional o redondeado hacia arriba:

  proporcional = ancho × alto ÷ 1,000,000 × tarifa
  redondeado   = megapíxeles hacia arriba × tarifa

SIN --si solo enseña el plan y el costo esperado: no llama a nada, no gasta.
La clave sale de FAL_KEY (entorno o .env) y jamás se imprime.

Ejemplos (desde la raíz del repo):
  python tools/probe_fal.py fal-ai/flux-2/klein/9b --usd-por-mp 0.006 \\
      --args '{"prompt": "un gato astronauta", "image_size": "square_hd", "num_images": 1}'
  python tools/probe_fal.py fal-ai/flux-2/klein/9b --usd-por-mp 0.006 --n 2 --si \\
      --salida work/probe_fal --args '{...}'
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time
from pathlib import Path


def _cargar_env() -> None:
    try:
        from dotenv import load_dotenv
        load_dotenv()
    except Exception:  # noqa: BLE001 — sin python-dotenv basta con el entorno
        pass


def _analizar(argv: list[str] | None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Prueba pagada pequeña de un endpoint de fal.")
    p.add_argument("endpoint", help="el endpoint exacto de fal, p. ej. fal-ai/flux-2/klein/9b")
    p.add_argument("--args", default="{}", help="argumentos del modelo, en JSON")
    p.add_argument("--n", type=int, default=2, help="cuántas llamadas (por defecto 2)")
    tarifa = p.add_mutually_exclusive_group()
    tarifa.add_argument("--usd-por-mp", type=float, help="tarifa por megapíxel (de la página del modelo)")
    tarifa.add_argument("--usd-por-imagen", type=float, help="tarifa por imagen (de la página del modelo)")
    tarifa.add_argument("--usd-por-segundo", type=float, help="tarifa por segundo de video (con --segundos)")
    p.add_argument("--segundos", type=float, help="segundos de video de cada llamada")
    p.add_argument("--mp-estimado", type=float, default=1.048576,
                   help="megapíxeles que se espera por imagen, solo para el ensayo (1024×1024 = 1.048576)")
    p.add_argument("--salida", help="carpeta donde guardar lo generado (si no se da, no se descarga)")
    p.add_argument("--si", action="store_true", help="SÍ llamar a fal y gastar. Sin esto solo se muestra el plan")
    return p.parse_args(argv)


def _costos_imagen(a: argparse.Namespace, imagenes: list[dict]) -> dict[str, float] | None:
    """Los costos esperados de una llamada, o None si no hay tarifa."""
    if a.usd_por_imagen is not None:
        return {"por imagen": a.usd_por_imagen * max(1, len(imagenes))}
    if a.usd_por_mp is not None:
        mp = sum(i["width"] * i["height"] for i in imagenes) / 1_000_000 if imagenes else a.mp_estimado
        return {"proporcional": a.usd_por_mp * mp,
                "redondeado": a.usd_por_mp * sum(math.ceil(i["width"] * i["height"] / 1_000_000)
                                                 for i in imagenes) if imagenes else a.usd_por_mp}
    if a.usd_por_segundo is not None and a.segundos:
        return {"por segundo": a.usd_por_segundo * a.segundos}
    return None


def _plan(a: argparse.Namespace, argumentos: dict) -> None:
    print(f"ENSAYO · {a.n} llamada(s) a {a.endpoint}")
    print(f"  argumentos: {json.dumps(argumentos, ensure_ascii=False)}")
    lado = (a.mp_estimado * 1_000_000) ** 0.5   # una imagen cuadrada del tamaño esperado
    costos = _costos_imagen(a, [{"width": lado, "height": lado}])
    if costos is None:
        print("  sin tarifa: pásale --usd-por-mp, --usd-por-imagen o --usd-por-segundo (con --segundos)")
    else:
        for nombre, usd in costos.items():
            print(f"  costo esperado ({nombre}): ${usd:.4f} dólares por llamada · ${usd * a.n:.4f} dólares en total")
    print("  NO se llamó a nada. Para gastar de verdad, repite el comando con --si.")


def main(argv: list[str] | None = None) -> int:
    a = _analizar(argv)
    try:
        argumentos = json.loads(a.args)
        assert isinstance(argumentos, dict)
    except (ValueError, AssertionError):
        print("--args debe ser un objeto JSON, p. ej. '{\"prompt\": \"...\"}'", file=sys.stderr)
        return 2
    if a.n < 1 or a.n > 10:
        print("--n va de 1 a 10: esto es una prueba pequeña", file=sys.stderr)
        return 2
    if not a.si:
        _plan(a, argumentos)
        return 0

    _cargar_env()
    if not os.getenv("FAL_KEY"):
        print("Falta FAL_KEY en el entorno o en .env (la clave la pone el dueño; aquí no se imprime).", file=sys.stderr)
        return 2
    import fal_client  # tarde: el ensayo no la necesita

    salida = Path(a.salida) if a.salida else None
    if salida:
        salida.mkdir(parents=True, exist_ok=True)
    tiempos: list[float] = []
    por_nombre: dict[str, list[float]] = {}
    for k in range(1, a.n + 1):
        t0 = time.monotonic()
        res = fal_client.subscribe(a.endpoint, arguments=argumentos)
        seg = time.monotonic() - t0
        tiempos.append(seg)
        imagenes = [i for i in (res.get("images") or []) if isinstance(i, dict) and "width" in i]
        print(f"llamada {k}: {seg:.1f} s · " + (" · ".join(f"{i['width']}×{i['height']}" for i in imagenes) or "sin imágenes"))
        costos = _costos_imagen(a, imagenes)
        for nombre, usd in (costos or {}).items():
            por_nombre.setdefault(nombre, []).append(usd)
            print(f"  costo esperado ({nombre}): ${usd:.4f} dólares")
        if salida:
            import httpx
            urls = [i.get("url") for i in res.get("images") or []] + [(res.get("video") or {}).get("url")]
            for j, url in enumerate(u for u in urls if u):
                ext = Path(url.split("?")[0]).suffix or ".bin"
                destino = salida / f"{a.endpoint.replace('/', '_')}-{k}-{j}{ext}"
                destino.write_bytes(httpx.get(url, timeout=120, follow_redirects=True).content)
                print(f"  guardado: {destino}")
    print(f"PROMEDIO · {sum(tiempos) / len(tiempos):.1f} s por llamada")
    for nombre, usd in por_nombre.items():
        print(f"  costo esperado promedio ({nombre}): ${sum(usd) / len(usd):.4f} dólares · total ${sum(usd):.4f} dólares")
    print("Compara el total con el panel de uso de fal: fal no devuelve lo cobrado en la respuesta.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
