"""RAG·29 (TEMPORAL) — abona en PRODUCCIÓN los usos de /automatiza de los testers.

    python tools/abonos_testers.py                    # ensayo: qué se abonaría
    python tools/abonos_testers.py --abonar           # abona (teclear PROD)
    python tools/abonos_testers.py --desde 2026-10-06

Mientras dura la prueba con testers (decisión del dueño, 5-oct-2026; una a dos
semanas), /automatiza vive en DEV y no cobra: al revés, cada uso ABONA créditos
en la cuenta de producción que tiene el mismo correo. Cuenta como uso una
corrida terminada (listo o no_salio) con correo; vale el último correo que se
dejó en esa corrida. Cuánto y con qué tope al día salen de tools/tarifas.json
(§rag). Cómo se apaga y qué se cambia al terminar: docs/RAG_TESTERS.md.

Por qué una herramienta y no el servidor de dev escribiendo en producción: dev
no tiene (ni debe tener) permiso sobre la base de producción. Un error en dev
movería dinero real. Aquí el dueño corre esto cuando quiere, ve primero el
ensayo y teclea PROD; la base de dev solo se LEE.

Lo que lo hace seguro de repetir:
  · cada abono lleva la referencia `rag-tester:<id público de la corrida>` y
    antes de abonar se mira si ya existe: correrlo dos veces no abona doble;
  · el correo se busca en el pool de Cognito de PRODUCCIÓN (lo dice
    CloudFormation, no un default); sin cuenta allá, no se abona nada;
  · el tope diario por cuenta cuenta también lo ya abonado ese día.

En pantalla los correos salen tapados. Necesita credenciales AWS con
CloudFormation, Cognito (leer) y Data API de los dos clústeres.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import pipeline.config  # noqa: E402,F401 — carga el .env

from infra import entornos  # noqa: E402

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# El primer día que cuenta. Lo de antes fueron pruebas del equipo.
INICIO = "2026-10-06"
PREFIJO_REF = "rag-tester:"


def tarifa() -> tuple[int, int]:
    rag = json.loads((Path(__file__).parent / "tarifas.json").read_text(encoding="utf-8"))["rag"]
    return int(rag["abono_tester_por_uso"]), int(rag["abono_tester_max_por_dia"])


def tapar(correo: str) -> str:
    usuario, _, dominio = correo.partition("@")
    return f"{usuario[:2]}***@{dominio}" if dominio else "***"


def plan(usos: list[dict], sub_de: dict[str, str | None], ya: set[str],
         por_uso: int, max_dia: int) -> list[dict]:
    """Qué pasa con cada uso: 'abonar', 'ya_abonado', 'sin_cuenta' o 'tope'.
    Lo ya abonado cuenta para el tope de su día, así que el tope se respeta
    aunque se corra varias veces al día."""
    por_dia: dict[tuple[str, str], int] = defaultdict(int)
    salida = []
    for u in usos:
        ref = PREFIJO_REF + u["publico_id"]
        sub = sub_de.get(u["correo"])
        if sub is None:
            accion = "sin_cuenta"
        else:
            llave = (sub, u["dia"])
            if ref in ya:
                accion = "ya_abonado"
                por_dia[llave] += 1
            elif por_dia[llave] >= max_dia:
                accion = "tope"
            else:
                accion = "abonar"
                por_dia[llave] += 1
        salida.append({**u, "sub": sub, "referencia": ref, "accion": accion,
                       "creditos": por_uso if accion == "abonar" else 0})
    return salida


def _usar(valores: dict[str, str]) -> None:
    os.environ["DB_CLUSTER_ARN"] = valores["DB_CLUSTER_ARN"]
    os.environ["DB_SECRET_ARN"] = valores["DB_SECRET_ARN"]
    os.environ["DB_NAME"] = "media"


def _sub_por_correo(idp, pool: str, correo: str) -> str | None:
    if '"' in correo or "\\" in correo:
        return None          # rompería el filtro de Cognito; un correo así no tiene cuenta
    r = idp.list_users(UserPoolId=pool, Filter=f'email = "{correo}"', Limit=2)
    activos = [u for u in r.get("Users", []) if u.get("Enabled", True)]
    if len(activos) != 1:
        return None          # sin cuenta, o ambiguo: no se adivina
    from tools.usuarios import _sub
    return _sub(activos[0])


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--desde", default=INICIO, help="AAAA-MM-DD, hora de México")
    ap.add_argument("--abonar", action="store_true", help="abona de verdad en producción")
    args = ap.parse_args()
    os.environ.setdefault("AWS_DEFAULT_REGION", "us-east-1")

    import boto3

    from pipeline import db
    from tools.creditos import confirmar_abono
    from tools.env_local import recolectar

    por_uso, max_dia = tarifa()
    dev, prod = recolectar(entornos.DEV), recolectar(entornos.PROD)
    print(f"Lee usos de DEV ({dev['DB_CLUSTER_ARN'].rsplit(':', 1)[-1]}) desde {args.desde}; "
          f"abona en PROD ({prod['DB_CLUSTER_ARN'].rsplit(':', 1)[-1]}).")
    print(f"Tarifa (tools/tarifas.json §rag): {por_uso} créditos por uso, "
          f"máximo {max_dia} usos al día por cuenta.")

    _usar(dev)
    usos = [{**u, "correo": db.correo_normal(u["correo"])}
            for u in db.automatiza_usos_con_correo(args.desde)]
    pool = prod["COGNITO_POOL_ID"]
    idp = boto3.client("cognito-idp", region_name=pool.split("_")[0])
    sub_de = {c: _sub_por_correo(idp, pool, c) for c in {u["correo"] for u in usos}}

    _usar(prod)
    ya = {PREFIJO_REF + u["publico_id"] for u in usos
          if db.movimiento_con_referencia(PREFIJO_REF + u["publico_id"])}
    filas = plan(usos, sub_de, ya, por_uso, max_dia)

    cuenta = defaultdict(int)
    for f in filas:
        cuenta[f["accion"]] += 1
        print(f"  {f['dia']}  {f['publico_id']}  {f['estado']:9}  {tapar(f['correo']):28}  {f['accion']}")
    nuevos = [f for f in filas if f["accion"] == "abonar"]
    total = sum(f["creditos"] for f in nuevos)
    print(f"Usos: {len(filas)} · por abonar: {cuenta['abonar']} ({total} créditos) · "
          f"ya abonados: {cuenta['ya_abonado']} · sin cuenta en la plataforma: "
          f"{cuenta['sin_cuenta']} · pasaron el tope: {cuenta['tope']}")
    if not nuevos:
        return
    if not args.abonar:
        print("ENSAYO: no se abonó nada. Para abonar, repite con --abonar.")
        return
    resumen = f"{total} créditos (cortesia) repartidos en {len(nuevos)} usos de testers del RAG"
    if not confirmar_abono(entornos.PROD, prod["DB_CLUSTER_ARN"], resumen):
        sys.exit(1)
    for f in nuevos:
        if db.movimiento_con_referencia(f["referencia"]):
            continue        # alguien lo abonó entre el ensayo y ahora
        saldo = db.abonar_creditos(f["sub"], f["creditos"], "cortesia", f["referencia"])
        print(f"  +{f['creditos']} a {tapar(f['correo'])} → saldo {saldo}")
    print("Listo.")


if __name__ == "__main__":
    main()
