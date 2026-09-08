"""Aplica el esquema C2 a Aurora vía Data API (idempotente — se puede re-correr).

Corre desde cualquier máquina con credenciales AWS que tengan rds-data +
lectura del secreto del clúster (p. ej. admin-cli local):

    python tools/db_migrate.py \
        --cluster-arn arn:aws:rds:us-east-1:...:cluster:... \
        --secret-arn  arn:aws:secretsmanager:us-east-1:...

Los ARNs también pueden venir del env (DB_CLUSTER_ARN / DB_SECRET_ARN); ambos
salen de los outputs del stack aws-media-db. La primera sentencia puede tardar
~15 s si el clúster está auto-pausado (0 ACU): el reintento ya está en db.ejecutar.
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import pipeline.config  # noqa: E402,F401 — carga el .env (DB_CLUSTER_ARN/DB_SECRET_ARN)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--cluster-arn", default=os.getenv("DB_CLUSTER_ARN"))
    ap.add_argument("--secret-arn", default=os.getenv("DB_SECRET_ARN"))
    ap.add_argument("--database", default=os.getenv("DB_NAME", "media"))
    args = ap.parse_args()
    if not args.cluster_arn or not args.secret_arn:
        ap.error("faltan --cluster-arn/--secret-arn (o DB_CLUSTER_ARN/DB_SECRET_ARN)")

    os.environ["DB_CLUSTER_ARN"] = args.cluster_arn
    os.environ["DB_SECRET_ARN"] = args.secret_arn
    os.environ["DB_NAME"] = args.database
    os.environ.setdefault("AWS_DEFAULT_REGION", "us-east-1")

    from pipeline import db

    for sentencia in db.ESQUEMA:
        nombre = sentencia.split("(", 1)[0].strip().splitlines()[0]
        print(f"  {nombre} ...", flush=True)
        db.ejecutar(sentencia)
    db.ejecutar("INSERT INTO usuarios (id) VALUES (:u) ON CONFLICT (id) DO NOTHING",
                {"u": db.usuario_actual()})
    tablas = db.ejecutar(
        "SELECT table_name FROM information_schema.tables "
        "WHERE table_schema = 'public' ORDER BY table_name")
    print("Tablas en", args.database + ":", ", ".join(t["table_name"] for t in tablas))


if __name__ == "__main__":
    main()
