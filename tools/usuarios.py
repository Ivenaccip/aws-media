"""M2 — altas y bajas de usuarios (espejo de tools/creditos.py, corre el dueño).

    python tools/usuarios.py alta correo@x.com --plan mensual  # invita + 100 cr
    python tools/usuarios.py alta correo@x.com --plan anual    # invita + 200 cr
    python tools/usuarios.py alta correo@x.com --reenviar      # reenvía la provisional (sin re-abonar)
    python tools/usuarios.py suspender correo@x.com            # churn: no entra más (sus datos quedan)
    python tools/usuarios.py reactivar correo@x.com
    python tools/usuarios.py adoptar correo@x.com --de piloto  # migra proyectos+saldo del id viejo
    python tools/usuarios.py lista

`alta` crea el usuario en Cognito (correo = username; Cognito envía la
contraseña provisional por email y fuerza el cambio al primer login), registra
la fila en `usuarios` (id = sub) y abona la cortesía del plan en el mismo
comando. La cortesía sale de tools/tarifas.json. `suspender` deshabilita al
usuario Y revoca sus sesiones (global sign-out) — el VPS de la comunidad
llamará esto mismo cuando detecte churn.

Necesita credenciales AWS: cognito-idp + Data API (DB_CLUSTER_ARN /
DB_SECRET_ARN o --cluster-arn/--secret-arn, outputs del stack aws-media-db).
Pool por COGNITO_POOL_ID o --pool.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

POOL_DEFAULT = os.getenv("COGNITO_POOL_ID", "us-east-1_WyPvxnj1V")


def cortesia(plan: str) -> int:
    tarifas = json.loads((Path(__file__).parent / "tarifas.json").read_text(encoding="utf-8"))
    return int(tarifas["cortesia_mensual"][plan])


def _cognito(pool: str = POOL_DEFAULT):
    import boto3
    return boto3.client("cognito-idp", region_name=pool.split("_")[0])


def _sub(respuesta_usuario: dict) -> str:
    for a in respuesta_usuario.get("Attributes", respuesta_usuario.get("UserAttributes", [])):
        if a["Name"] == "sub":
            return a["Value"]
    raise RuntimeError("Cognito no devolvió el sub del usuario")


def alta(pool: str, correo: str, plan: str, reenviar: bool = False) -> str:
    from pipeline import db
    c = _cognito(pool)
    kwargs = dict(UserPoolId=pool, Username=correo,
                  UserAttributes=[{"Name": "email", "Value": correo},
                                  {"Name": "email_verified", "Value": "true"}],
                  DesiredDeliveryMediums=["EMAIL"])
    if reenviar:
        # reenvía la contraseña provisional a un invitado que la dejó vencer;
        # NO vuelve a abonar cortesía
        c.admin_create_user(MessageAction="RESEND", **kwargs)
        print(f"{correo}: contraseña provisional reenviada")
        return _sub(c.admin_get_user(UserPoolId=pool, Username=correo))
    r = c.admin_create_user(**kwargs)
    sub = _sub(r["User"])
    db.ejecutar("""INSERT INTO usuarios (id, email) VALUES (:i, :e)
                   ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email""",
                {"i": sub, "e": correo})
    saldo = db.abonar_creditos(sub, cortesia(plan), "cortesia", f"alta-{plan}")
    print(f"{correo}: alta OK (id {sub}) — {cortesia(plan)} créditos de cortesía, saldo {saldo}")
    print("Cognito le envió la contraseña provisional por email; el primer login fuerza el cambio.")
    return sub


def suspender(pool: str, correo: str) -> None:
    c = _cognito(pool)
    c.admin_disable_user(UserPoolId=pool, Username=correo)
    c.admin_user_global_sign_out(UserPoolId=pool, Username=correo)
    print(f"{correo}: suspendido y sesiones revocadas (sus proyectos y saldo quedan intactos)")


def reactivar(pool: str, correo: str) -> None:
    _cognito(pool).admin_enable_user(UserPoolId=pool, Username=correo)
    print(f"{correo}: reactivado")


def adoptar(pool: str, correo: str, de: str) -> None:
    """Migra TODO lo del id viejo (p. ej. el 'piloto' de antes del login) al
    usuario real: proyectos, versiones, costes, movimientos y saldo."""
    from pipeline import db
    sub = _sub(_cognito(pool).admin_get_user(UserPoolId=pool, Username=correo))
    db.ejecutar("INSERT INTO usuarios (id, email) VALUES (:i, :e) ON CONFLICT (id) DO NOTHING",
                {"i": sub, "e": correo})
    for tabla in ("proyectos_gen", "proyectos_editor", "clip_versiones",
                  "costes", "monedero_movimientos"):
        db.ejecutar(f"UPDATE {tabla} SET user_id = :n WHERE user_id = :v",  # noqa: S608 — tablas fijas
                    {"n": sub, "v": de})
    saldo_viejo = db.saldo_creditos(de)
    if saldo_viejo:
        db.abonar_creditos(sub, saldo_viejo, "ajuste", f"adopcion:{de}")
        db.abonar_creditos(de, -saldo_viejo, "ajuste", f"adopcion:{sub}")
    print(f"{correo}: adoptó lo de '{de}' (+{saldo_viejo} créditos, saldo {db.saldo_creditos(sub)})")


def lista(pool: str) -> None:
    con_db = bool(os.getenv("DB_CLUSTER_ARN") and os.getenv("DB_SECRET_ARN"))
    if con_db:
        from pipeline import db
    pag = _cognito(pool).get_paginator("list_users")
    for pagina in pag.paginate(UserPoolId=pool):
        for u in pagina["Users"]:
            correo = next((a["Value"] for a in u["Attributes"] if a["Name"] == "email"), "?")
            estado = "activo" if u["Enabled"] else "SUSPENDIDO"
            extra = f"  saldo {db.saldo_creditos(_sub(u))}" if con_db else ""
            print(f"  {correo:35s} {estado:10s} {u['UserStatus']:20s}{extra}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("accion", choices=["alta", "suspender", "reactivar", "adoptar", "lista"])
    ap.add_argument("correo", nargs="?")
    ap.add_argument("--plan", default="mensual", choices=["mensual", "anual"])
    ap.add_argument("--reenviar", action="store_true")
    ap.add_argument("--de", default="piloto", help="id viejo que adopta el usuario")
    ap.add_argument("--pool", default=POOL_DEFAULT)
    ap.add_argument("--cluster-arn", default=os.getenv("DB_CLUSTER_ARN"))
    ap.add_argument("--secret-arn", default=os.getenv("DB_SECRET_ARN"))
    args = ap.parse_args()
    if args.accion != "lista" and not args.correo:
        ap.error(f"{args.accion} necesita el correo")
    if args.accion in ("alta", "adoptar"):
        if not args.cluster_arn or not args.secret_arn:
            ap.error("faltan --cluster-arn/--secret-arn (o DB_CLUSTER_ARN/DB_SECRET_ARN)")
        os.environ["DB_CLUSTER_ARN"] = args.cluster_arn
        os.environ["DB_SECRET_ARN"] = args.secret_arn
    os.environ.setdefault("AWS_DEFAULT_REGION", args.pool.split("_")[0])

    if args.accion == "alta":
        alta(args.pool, args.correo, args.plan, reenviar=args.reenviar)
    elif args.accion == "suspender":
        suspender(args.pool, args.correo)
    elif args.accion == "reactivar":
        reactivar(args.pool, args.correo)
    elif args.accion == "adoptar":
        adoptar(args.pool, args.correo, args.de)
    else:
        lista(args.pool)


if __name__ == "__main__":
    main()
