"""C5 — administración del monedero de créditos vía Data API (como db_migrate).

    python tools/creditos.py saldo                        # saldo del piloto
    python tools/creditos.py abonar 100 --tipo cortesia   # cortesía mensual
    python tools/creditos.py abonar 500 --tipo compra --ref pack-500
    python tools/creditos.py abonar -97 --tipo ajuste     # ajuste admin (±)
    python tools/creditos.py movimientos -n 20

ARNs por env (DB_CLUSTER_ARN / DB_SECRET_ARN, outputs del stack aws-media-db)
o con --cluster-arn/--secret-arn. Tipos válidos: cortesia | compra | ajuste
(devolucion y cargo los escriben solo la app y los workers). La tarifa vive en
tools/tarifas.json; la spec de negocio, en docs/ECONOMIA.md.
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("accion", choices=["saldo", "abonar", "movimientos"])
    ap.add_argument("creditos", nargs="?", type=int, help="créditos a abonar (± en ajustes)")
    ap.add_argument("--user", default=os.getenv("DEFAULT_USER_ID", "piloto"))
    ap.add_argument("--tipo", default="ajuste", choices=["cortesia", "compra", "ajuste"])
    ap.add_argument("--ref", default=None, help="referencia libre del movimiento")
    ap.add_argument("-n", type=int, default=20, help="movimientos a listar")
    ap.add_argument("--cluster-arn", default=os.getenv("DB_CLUSTER_ARN"))
    ap.add_argument("--secret-arn", default=os.getenv("DB_SECRET_ARN"))
    args = ap.parse_args()
    if not args.cluster_arn or not args.secret_arn:
        ap.error("faltan --cluster-arn/--secret-arn (o DB_CLUSTER_ARN/DB_SECRET_ARN)")

    os.environ["DB_CLUSTER_ARN"] = args.cluster_arn
    os.environ["DB_SECRET_ARN"] = args.secret_arn
    os.environ.setdefault("AWS_DEFAULT_REGION", "us-east-1")

    from pipeline import db

    if args.accion == "saldo":
        print(f"{args.user}: {db.saldo_creditos(args.user)} créditos")
    elif args.accion == "abonar":
        if args.creditos is None:
            ap.error("abonar necesita la cantidad de créditos")
        nuevo = db.abonar_creditos(args.user, args.creditos, args.tipo, args.ref)
        print(f"{args.user}: {args.creditos:+d} ({args.tipo}) -> saldo {nuevo}")
    else:
        for m in db.movimientos_creditos(args.user, args.n):
            ref = f" · {m['referencia']}" if m.get("referencia") else ""
            print(f"  {m['creado']}  {m['creditos']:+5d}  {m['tipo']}{ref}")
        print(f"{args.user}: saldo {db.saldo_creditos(args.user)}")


if __name__ == "__main__":
    main()
