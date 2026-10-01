"""RAG·5 — el interruptor y el tope diario de /automatiza (corre el dueño).

    python tools/automatiza.py estado
    python tools/automatiza.py encender --tope-corridas 50 --nota "prueba en dev"
    python tools/automatiza.py apagar --nota "emergencia: bots"
    python tools/automatiza.py tope --corridas 200
    python tools/automatiza.py tope --usd 25
    python tools/automatiza.py tope --sin-usd
    python tools/automatiza.py tope --por-ip 10     # corridas al día por visitante
    python tools/automatiza.py corridas --dias 7    # RAG·24: tiempo, tokens y costo

Cambia UNA FILA en la base, sin desplegar nada: el cambio vale en la
siguiente petición. Cada cambio agrega una fila (queda el historial de quién
apagó y por qué); vale la última. Sin ninguna fila, la sección está apagada.

`encender` exige que haya algún tope, ya puesto o en el mismo comando: una
sección pública encendida sin tope es exactamente lo que esto impide.

El tope en dólares cuenta solo el gasto real ya anotado por corrida (RAG·24);
hasta entonces, el que frena es el tope de corridas.

Necesita credenciales AWS con Data API: DB_CLUSTER_ARN / DB_SECRET_ARN o
--cluster-arn/--secret-arn (outputs del stack aws-media-db-dev en dev).
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import pipeline.config  # noqa: E402,F401 — carga el .env (DB_CLUSTER_ARN/DB_SECRET_ARN)

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def _mostrar(db) -> None:
    ajuste = db.automatiza_interruptor()
    hoy = db.automatiza_consumo_hoy()
    if not ajuste:
        print("Interruptor: APAGADO (nunca se ha encendido)")
    else:
        print(f"Interruptor: {'ENCENDIDO' if ajuste['encendido'] else 'APAGADO'}"
              f"  (desde {ajuste['creado']})")
        if ajuste.get("nota"):
            print(f"  nota: {ajuste['nota']}")
        c = ajuste.get("tope_corridas")
        u = ajuste.get("tope_usd")
        print(f"Tope de corridas al día: {c if c is not None else 'sin tope'}")
        print(f"Tope de gasto al día: {f'${u:.2f} dólares' if u is not None else 'sin tope'}")
        from pipeline.publico import TOPE_IP_PROVISIONAL
        i = ajuste.get("tope_por_ip")
        print(f"Tope por visitante (IP) al día: "
              f"{i if i is not None else f'{TOPE_IP_PROVISIONAL} (provisional)'}")
    print(f"Hoy (hora de México): {hoy['corridas']} corridas aceptadas, "
          f"${hoy['usd']:.2f} dólares de gasto anotado")
    from pipeline import publico
    motivo = publico.permiso(por_ip=False)   # la herramienta no es un visitante
    print("Para el visitante:", "disponible" if motivo is None
          else f"«Ahorita no está disponible» (motivo interno: {motivo})")


def _pesos(usd: float | None) -> str:
    return "sin precio confirmado" if usd is None else f"${usd:.2f} dólares"


def resumen_corridas(filas: list[dict]) -> list[str]:
    """RAG·24 — una línea por corrida y el total. El costo sale de
    pipeline/costos_rag.py con los precios de HOY en tools/pricing.json: las
    corridas viejas se cuentan solas cuando se agreguen los precios."""
    import json

    from pipeline import costos_rag
    lineas = [f"{'id':>5}  {'creada':11}  {'estado':13}  {'seg':>5}  {'int':>3}  "
              f"{'claude ent/sal':>15}  {'emb':>5}  {'busq':>4}  costo"]
    total, con_costo, segs = 0.0, True, []
    for f in filas:
        uso = json.loads(f["uso"]) if f.get("uso") else None
        llamadas = (uso or {}).get("llamadas") or []
        claude = [ll for ll in llamadas if ll.get("tipo") != "embedding"]
        emb = sum(ll.get("entrada") or 0 for ll in llamadas if ll.get("tipo") == "embedding")
        ent = sum(ll.get("entrada") or 0 for ll in claude)
        sal = sum(ll.get("salida") or 0 for ll in claude)
        seg = float(f["seg"]) if f.get("seg") else None
        if seg is not None and f["estado"] == "listo":
            segs.append(seg)
        costo = costos_rag.costo_de_resultado(uso)
        if costo is None:
            con_costo = False
        else:
            total += costo
        lineas.append(
            f"{f['id']:>5}  {f.get('creado') or '':11}  {f['estado']:13}  "
            f"{f'{seg:.0f}' if seg is not None else '—':>5}  {f.get('intentos') or '—':>3}  "
            f"{f'{ent}/{sal}' if claude else '—':>15}  {emb or '—':>5}  "
            f"{(uso or {}).get('consultas_vector', '—'):>4}  {_pesos(costo)}")
    lineas.append("")
    lineas.append(f"Corridas: {len(filas)} · listas: {len(segs)}"
                  + (f" · armado promedio de las listas: {sum(segs) / len(segs):.0f} s"
                     if segs else ""))
    lineas.append("Costo total: " + (_pesos(total) if con_costo and filas else
                                     "sin precio confirmado" if filas else "$0.00 dólares"))
    lineas.append("(int = intentos del validador · emb = tokens de embeddings · "
                  "busq = consultas a S3 Vectors · sin la moderación, que corre en el API)")
    return lineas


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--cluster-arn", default=os.getenv("DB_CLUSTER_ARN"))
    ap.add_argument("--secret-arn", default=os.getenv("DB_SECRET_ARN"))
    ap.add_argument("--database", default=os.getenv("DB_NAME", "media"))
    sub = ap.add_subparsers(dest="accion", required=True)
    sub.add_parser("estado")
    en = sub.add_parser("encender")
    en.add_argument("--tope-corridas", type=int)
    en.add_argument("--tope-usd", type=float)
    en.add_argument("--nota")
    ap_ = sub.add_parser("apagar")
    ap_.add_argument("--nota")
    tp = sub.add_parser("tope")
    tp.add_argument("--corridas", type=int)
    tp.add_argument("--usd", type=float)
    tp.add_argument("--sin-usd", action="store_true")
    tp.add_argument("--por-ip", type=int)
    tp.add_argument("--nota")
    co = sub.add_parser("corridas", help="RAG·24: tiempo, tokens y costo por corrida")
    co.add_argument("--dias", type=int, default=1)
    args = ap.parse_args()
    if not args.cluster_arn or not args.secret_arn:
        ap.error("faltan --cluster-arn/--secret-arn (o DB_CLUSTER_ARN/DB_SECRET_ARN)")

    os.environ["DB_CLUSTER_ARN"] = args.cluster_arn
    os.environ["DB_SECRET_ARN"] = args.secret_arn
    os.environ["DB_NAME"] = args.database
    os.environ.setdefault("AWS_DEFAULT_REGION", "us-east-1")
    # el .env trae los ARNs del clúster VIVO: que se vea a cuál se le habla
    print(f"Clúster: {args.cluster_arn.rsplit(':', 1)[-1]} · base: {args.database}")
    from pipeline import db

    for valor in (getattr(args, "tope_corridas", None), getattr(args, "corridas", None),
                  getattr(args, "por_ip", None)):
        if valor is not None and valor < 0:
            ap.error("un tope no puede ser negativo")

    if args.accion == "corridas":
        if args.dias < 1:
            ap.error("--dias tiene que ser 1 o más")
        print("\n".join(resumen_corridas(db.automatiza_corridas_recientes(args.dias))))
        return

    if args.accion == "encender":
        vigente = db.automatiza_interruptor() or {}
        hay_tope = any(v is not None for v in (
            args.tope_corridas, args.tope_usd,
            vigente.get("tope_corridas"), vigente.get("tope_usd")))
        if not hay_tope:
            ap.error("no se enciende sin tope: agrega --tope-corridas N (o --tope-usd X)")
        db.automatiza_ajustar(encendido=True, tope_corridas=args.tope_corridas,
                              tope_usd=args.tope_usd, nota=args.nota)
    elif args.accion == "apagar":
        db.automatiza_ajustar(encendido=False, nota=args.nota)
    elif args.accion == "tope":
        if (args.corridas is None and args.usd is None and not args.sin_usd
                and args.por_ip is None):
            ap.error("di qué tope: --corridas N, --usd X, --sin-usd o --por-ip N")
        db.automatiza_ajustar(tope_corridas=args.corridas, tope_usd=args.usd,
                              sin_tope_usd=args.sin_usd, tope_por_ip=args.por_ip,
                              nota=args.nota)
    _mostrar(db)


if __name__ == "__main__":
    main()
