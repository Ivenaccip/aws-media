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

A QUÉ ENTORNO ESCRIBE — paso 2 del entorno dev

`abonar` mueve dinero en la base y no se puede deshacer con un botón. Antes esta
herramienta no decía a qué clúster escribía, y peor: `--user` con un correo lo
resolvía contra el pool de PRODUCCIÓN cableado en tools/usuarios.py, fuera cual
fuera el clúster de destino. Con dev en pie eso habría abonado al `sub` de un
usuario de producción dentro de la base de dev — dos identidades cruzadas, sin
un solo error por pantalla.

Ahora:
  · El pool sale de `COGNITO_POOL_ID` (lo pone .env.local, que genera
    tools/env_local.py) o de `--pool`. **Sin default de producción.**
  · `abonar` comprueba contra CloudFormation que el clúster que recibió es de
    verdad el del `--entorno` declarado, y se niega si no cuadra.
  · Y si es producción, hay que teclear PROD.
`saldo` y `movimientos` no preguntan nada: leer no rompe nada.
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import pipeline.config  # noqa: E402,F401 — carga el .env y el .env.local

from infra import entornos  # noqa: E402  (Python puro, no importa el CDK)

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def confirmar_abono(entorno: entornos.Entorno, cluster_arn: str, resumen: str) -> bool:
    """Cruza el clúster contra CloudFormation y, si es producción, lo hace
    teclear. Devuelve False si no se debe seguir."""
    from tools.env_local import cluster_del_entorno
    real = cluster_del_entorno(entorno)
    if real != cluster_arn:
        print(f"ALTO: dijiste --entorno {entorno.nombre}, pero el clúster que")
        print(f"recibí no es el que CloudFormation publica para {entorno.nombre}.")
        print("No abono nada. Revisa DB_CLUSTER_ARN o --cluster-arn.")
        return False
    if not entorno.es_prod:
        return True
    if not sys.stdin.isatty():
        print("\nAbonar en PRODUCCIÓN exige confirmarlo a mano y esta terminal no")
        print("es interactiva. Córrelo tú directamente.")
        return False
    print(f"\nEsto es PRODUCCIÓN: {resumen}")
    print("No hay deshacer; un abono equivocado se arregla con otro movimiento.")
    return input("Teclea PROD para confirmar: ").strip() == "PROD"


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
    ap.add_argument("--entorno", default="prod", choices=["prod", "dev"],
                    help="a qué entorno escribe (default prod)")
    # sin default de producción: si no hay COGNITO_POOL_ID ni --pool, resolver un
    # correo falla en vez de resolverlo contra el pool equivocado
    ap.add_argument("--pool", default=os.getenv("COGNITO_POOL_ID"),
                    help="pool donde se resuelve un --user con correo")
    args = ap.parse_args()
    if not args.cluster_arn or not args.secret_arn:
        ap.error("faltan --cluster-arn/--secret-arn (o DB_CLUSTER_ARN/DB_SECRET_ARN)")

    entorno = entornos.PROD if args.entorno == "prod" else entornos.DEV
    # el destino ANTES de actuar: es el dato que decide si esto se cancela
    print(f"Entorno: {entorno.nombre} · clúster {args.cluster_arn.rsplit(':', 1)[-1]}")

    # --user acepta el correo: se resuelve al sub de Cognito (el user_id real
    # de la base — abonar al correo crearía un monedero huérfano)
    if "@" in args.user:
        if not args.pool:
            sys.exit("Para resolver un correo hace falta el pool: pon COGNITO_POOL_ID "
                     "(lo genera tools/env_local.py en .env.local) o pasa --pool.\n"
                     "Antes había un default de producción aquí, y con dev en pie "
                     "resolvía el correo contra el pool equivocado sin avisar.")
        from tools.usuarios import _cognito, _sub
        print(f"Resolviendo {args.user} en el pool {args.pool}")
        try:
            u = _cognito().admin_get_user(UserPoolId=args.pool, Username=args.user)
        except Exception as err:  # noqa: BLE001
            sys.exit(f"{args.user}: no existe en el pool {args.pool} "
                     f"({type(err).__name__}) — ¿ya corriste usuarios.py alta?")
        args.user = _sub(u)

    if args.accion == "abonar":
        if args.creditos is None:
            ap.error("abonar necesita la cantidad de créditos")
        resumen = f"{args.creditos:+d} créditos ({args.tipo}) a {args.user}"
        if not confirmar_abono(entorno, args.cluster_arn, resumen):
            sys.exit(1)

    os.environ["DB_CLUSTER_ARN"] = args.cluster_arn
    os.environ["DB_SECRET_ARN"] = args.secret_arn
    os.environ.setdefault("AWS_DEFAULT_REGION", "us-east-1")

    from pipeline import db

    if args.accion == "saldo":
        print(f"{args.user}: {db.saldo_creditos(args.user)} créditos")
    elif args.accion == "abonar":
        # la cantidad y la confirmación ya se validaron arriba, antes de tocar AWS
        nuevo = db.abonar_creditos(args.user, args.creditos, args.tipo, args.ref)
        print(f"{args.user}: {args.creditos:+d} ({args.tipo}) -> saldo {nuevo}")
    else:
        for m in db.movimientos_creditos(args.user, args.n):
            ref = f" · {m['referencia']}" if m.get("referencia") else ""
            print(f"  {m['creado']}  {m['creditos']:+5d}  {m['tipo']}{ref}")
        print(f"{args.user}: saldo {db.saldo_creditos(args.user)}")


if __name__ == "__main__":
    main()
