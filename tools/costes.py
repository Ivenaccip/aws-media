"""C6 — coste real por usuario y por proyecto, desde Langfuse (la base de
facturación: cada traza lleva user_id y session_id = proyecto).

    python tools/costes.py resumen --dias 30          # $ por usuario/proyecto
    python tools/costes.py resumen --user piloto
    python tools/costes.py sync --dias 30             # vuelca a la tabla costes

Claves Langfuse por env (LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY /
LANGFUSE_BASE_URL) — se cargan de .env si existe, jamás se imprimen. Para
`sync` además DB_CLUSTER_ARN/DB_SECRET_ARN (o --cluster-arn/--secret-arn);
idempotente: la columna `traza` (trace id) evita duplicar. Redacción de UI:
siempre "$X.XX dólares".
"""
from __future__ import annotations

import argparse
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def _cargar_env() -> None:
    env = Path(__file__).resolve().parent.parent / ".env"
    if not env.exists():
        return
    for linea in env.read_text(encoding="utf-8").splitlines():
        if "=" in linea and not linea.strip().startswith("#"):
            k, _, v = linea.partition("=")
            os.environ.setdefault(k.strip(), v.strip().strip('"'))


def traer_trazas(dias: int, user: str | None) -> list[dict]:
    """Trazas con coste del periodo (paginado). Devuelve dicts crudos de Langfuse."""
    import requests

    base = os.environ.get("LANGFUSE_BASE_URL", "https://us.cloud.langfuse.com").rstrip("/")
    auth = (os.environ["LANGFUSE_PUBLIC_KEY"], os.environ["LANGFUSE_SECRET_KEY"])
    desde = (datetime.now(timezone.utc) - timedelta(days=dias)).isoformat()
    trazas, pagina = [], 1
    while True:
        params: dict = {"page": pagina, "limit": 100, "fromTimestamp": desde}
        if user:
            params["userId"] = user
        r = requests.get(f"{base}/api/public/traces", params=params, auth=auth, timeout=60)
        r.raise_for_status()
        data = r.json()
        trazas += data["data"]
        if pagina >= data["meta"]["totalPages"]:
            return trazas
        pagina += 1


def resumen(trazas: list[dict]) -> dict[str, dict[str, float]]:
    """{user_id: {proyecto: costo_usd}} — usuario '?' = trazas previas a C6."""
    por_usuario: dict[str, dict[str, float]] = {}
    for t in trazas:
        costo = t.get("totalCost") or 0
        if not costo:
            continue
        u = t.get("userId") or "?"
        proy = t.get("sessionId") or "?"
        por_usuario.setdefault(u, {})
        por_usuario[u][proy] = por_usuario[u].get(proy, 0) + costo
    return por_usuario


def sincronizar(dias: int = 3, user: str | None = None,
                trazas: list[dict] | None = None) -> int:
    """Vuelca a la tabla `costes` las trazas nuevas del periodo. Idempotente
    (la columna traza evita duplicar), así que la ventana puede solaparse.
    M6: también lo corre el worker (EventBridge diario) y el botón del admin."""
    from pipeline import db

    if trazas is None:
        trazas = traer_trazas(dias, user)
    ya = {f["traza"] for f in db.ejecutar("SELECT traza FROM costes WHERE traza IS NOT NULL")}
    nuevas = 0
    for t in trazas:
        costo = t.get("totalCost") or 0
        if not costo or t["id"] in ya:
            continue
        db.ejecutar(
            """INSERT INTO costes (user_id, proyecto_id, concepto, proveedor, costo_usd, traza)
               VALUES (:u, :p, :c, 'langfuse', :usd, :t)""",
            {"u": t.get("userId") or "?", "p": t.get("sessionId"),
             "c": t.get("name") or "traza", "usd": round(costo, 4), "t": t["id"]})
        nuevas += 1
    return nuevas


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("accion", choices=["resumen", "sync"])
    ap.add_argument("--dias", type=int, default=30)
    ap.add_argument("--user", default=None, help="filtrar a un usuario")
    ap.add_argument("--cluster-arn", default=os.getenv("DB_CLUSTER_ARN"))
    ap.add_argument("--secret-arn", default=os.getenv("DB_SECRET_ARN"))
    args = ap.parse_args()
    _cargar_env()

    trazas = traer_trazas(args.dias, args.user)
    agg = resumen(trazas)
    total = 0.0
    for u in sorted(agg):
        sub = sum(agg[u].values())
        total += sub
        print(f"{u}: ${sub:.2f} dólares ({args.dias} días)")
        for proy, c in sorted(agg[u].items(), key=lambda x: -x[1]):
            print(f"    {proy}: ${c:.4f}")
    print(f"TOTAL: ${total:.2f} dólares en {len(trazas)} trazas")

    if args.accion != "sync":
        return
    if not args.cluster_arn or not args.secret_arn:
        ap.error("sync necesita --cluster-arn/--secret-arn (o DB_CLUSTER_ARN/DB_SECRET_ARN)")
    os.environ["DB_CLUSTER_ARN"] = args.cluster_arn
    os.environ["DB_SECRET_ARN"] = args.secret_arn
    os.environ.setdefault("AWS_DEFAULT_REGION", "us-east-1")

    nuevas = sincronizar(args.dias, args.user, trazas=trazas)
    print(f"sync: {nuevas} trazas nuevas en la tabla costes "
          f"({len(trazas) - nuevas} ya estaban o no tienen costo)")


if __name__ == "__main__":
    main()
