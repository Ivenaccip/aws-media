"""RAG·17 — crea y revisa el almacén vectorial del RAG (corre el dueño).

    python tools/vectores.py estado                 # dev por defecto
    python tools/vectores.py crear                  # ensayo: dice qué haría
    python tools/vectores.py crear --confirmar      # crea bucket e índice
    python tools/vectores.py crear --solo-bucket --confirmar
                                                    # solo el bucket: el índice
                                                    # espera a que se decida el
                                                    # modelo de embeddings

Por qué un script y no el CDK: aws-cdk-lib 2.221 no trae S3 Vectors, y aunque
lo trajera el índice tiene que sobrevivir a un `cdk destroy` de dev y al cierre
del 25-oct. Los nombres salen de infra/entornos.py (`vectores_bucket`,
`vectores_indice`); la dimensión, la métrica y los metadatos no filtrables, de
pipeline/vectores.py.

`crear` es idempotente: lo que ya existe con la misma configuración lo deja en
paz. Si el índice ya existe con OTRA dimensión o métrica, para y no toca nada:
eso no se arregla modificándolo (S3 Vectors no deja), se arregla con un índice
nuevo (`n8n-docs-v2`) en infra/entornos.py.

No hay comando para borrar, a propósito. Borrar el índice es perder la ingesta
pagada; si algún día hace falta, se hace a mano en la consola.

Precio: sin precio confirmado (S3 Vectors no está en tools/pricing.json). Un
índice vacío solo guarda la configuración; lo que cuesta es lo que se ingesta
(RAG·19) y cada consulta.

Necesita credenciales AWS con permisos de s3vectors (las del dueño).
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ))

from infra import entornos  # noqa: E402  (Python puro, no importa el CDK)
from pipeline import vectores  # noqa: E402

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


class Distinto(SystemExit):
    """El índice existe con otra configuración: no se toca."""


def _codigo(exc) -> str | None:
    return getattr(exc, "response", {}).get("Error", {}).get("Code")


def _no_existe(llamada, **kw):
    """El resultado de `llamada`, o None si S3 Vectors dice NotFound."""
    try:
        return llamada(**kw)
    except Exception as exc:  # botocore.ClientError, sin importar botocore aquí
        if _codigo(exc) == "NotFoundException":
            return None
        raise


def esperado() -> dict:
    return {
        "dataType": vectores.TIPO_DATO,
        "dimension": vectores.DIMENSION,
        "distanceMetric": vectores.METRICA,
        "nonFilterableMetadataKeys": sorted(vectores.NO_FILTRABLES),
    }


def real(indice: dict) -> dict:
    return {
        "dataType": indice.get("dataType"),
        "dimension": indice.get("dimension"),
        "distanceMetric": indice.get("distanceMetric"),
        "nonFilterableMetadataKeys": sorted(
            (indice.get("metadataConfiguration") or {}).get("nonFilterableMetadataKeys") or []),
    }


def diferencias(indice: dict) -> list[str]:
    q, r = esperado(), real(indice)
    return [f"{k}: el índice tiene {r[k]!r}, pipeline/vectores.py dice {q[k]!r}"
            for k in q if q[k] != r[k]]


def nombres(entorno: entornos.Entorno) -> tuple[str, str]:
    if not (entorno.vectores_bucket and entorno.vectores_indice):
        raise SystemExit(
            f"{entorno.nombre} no tiene almacén vectorial en infra/entornos.py "
            "(prod lo recibe en RAG·30, con su PR).")
    return entorno.vectores_bucket, entorno.vectores_indice


def crear(entorno: entornos.Entorno, confirmar: bool, s3v,
          solo_bucket: bool = False) -> list[str]:
    """Crea lo que falte. Devuelve lo que hizo (o haría, sin `confirmar`).
    Con `solo_bucket` no mira ni crea el índice: el bucket no depende del
    modelo de embeddings, el índice sí (su dimensión es para siempre)."""
    bucket, indice = nombres(entorno)
    hechos: list[str] = []

    if _no_existe(s3v.get_vector_bucket, vectorBucketName=bucket) is None:
        hechos.append(f"crear el bucket vectorial {bucket} (cifrado SSE-S3)")
        if confirmar:
            s3v.create_vector_bucket(
                vectorBucketName=bucket,
                encryptionConfiguration={"sseType": "AES256"},
                tags={"proyecto": "aws-media", "entorno": entorno.nombre, "tarjeta": "RAG-17"})
        ya = None
    elif solo_bucket:
        return hechos
    else:
        ya = _no_existe(s3v.get_index, vectorBucketName=bucket, indexName=indice)

    if ya is not None:
        malas = diferencias(ya["index"])
        if malas:
            raise Distinto(
                f"El índice {bucket}/{indice} ya existe con otra configuración:\n  "
                + "\n  ".join(malas)
                + "\nNo toco nada. Eso no se modifica: se crea un índice nuevo "
                  "(sube la versión en infra/entornos.py) y se reindexa.")
        return hechos

    if solo_bucket:
        return hechos
    q = esperado()
    hechos.append(f"crear el índice {indice}: {q['dimension']} dimensiones, "
                  f"{q['distanceMetric']}, no filtrables {q['nonFilterableMetadataKeys']}")
    if confirmar:
        s3v.create_index(
            vectorBucketName=bucket, indexName=indice,
            dataType=q["dataType"], dimension=q["dimension"],
            distanceMetric=q["distanceMetric"],
            metadataConfiguration={"nonFilterableMetadataKeys": q["nonFilterableMetadataKeys"]})
    return hechos


def estado(entorno: entornos.Entorno, s3v) -> int:
    bucket, indice = nombres(entorno)
    print(f"Entorno: {entorno.nombre}")
    b = _no_existe(s3v.get_vector_bucket, vectorBucketName=bucket)
    if b is None:
        print(f"Bucket vectorial {bucket}: NO EXISTE  (python tools/vectores.py crear)")
        return 1
    print(f"Bucket vectorial {bucket}: existe")
    i = _no_existe(s3v.get_index, vectorBucketName=bucket, indexName=indice)
    if i is None:
        print(f"Índice {indice}: NO EXISTE  (python tools/vectores.py crear)")
        return 1
    r = real(i["index"])
    print(f"Índice {indice}: {r['dimension']} dimensiones, {r['distanceMetric']}, "
          f"{r['dataType']}, no filtrables {r['nonFilterableMetadataKeys']}")
    print(f"  ARN: {i['index'].get('indexArn')}")
    malas = diferencias(i["index"])
    for m in malas:
        print(f"  DISTINTO — {m}")
    print(f"Modelo de embeddings esperado: {vectores.MODELOS[entorno.embeddings or vectores.PROVEEDOR_POR_DEFECTO]}")
    return 1 if malas else 0


def main(argv: list[str] | None = None, s3v=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--entorno", choices=("dev", "prod"), default="dev")
    sub = ap.add_subparsers(dest="accion", required=True)
    sub.add_parser("estado")
    cr = sub.add_parser("crear")
    cr.add_argument("--confirmar", action="store_true",
                    help="crea de verdad; sin esto solo dice qué haría")
    cr.add_argument("--solo-bucket", action="store_true",
                    help="crea solo el bucket; el índice espera al modelo de embeddings")
    args = ap.parse_args(argv)
    entorno = entornos.PROD if args.entorno == "prod" else entornos.DEV
    nombres(entorno)                       # falla antes de hablar con AWS
    s3v = s3v or vectores.cliente()

    if args.accion == "estado":
        return estado(entorno, s3v)

    hechos = crear(entorno, args.confirmar, s3v, solo_bucket=args.solo_bucket)
    if not hechos:
        print("Nada que hacer: el bucket ya existe." if args.solo_bucket else
              "Nada que hacer: el bucket y el índice ya existen con la configuración esperada.")
        return 0
    titulo = "Hecho:" if args.confirmar else "Ensayo — esto es lo que haría (agrega --confirmar):"
    print(titulo)
    for h in hechos:
        print(f"  - {h}")
    print("Precio: sin precio confirmado (S3 Vectors no está en tools/pricing.json).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
