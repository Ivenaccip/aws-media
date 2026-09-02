"""Sube las claves de API del .env local a SSM Parameter Store (SecureString)
bajo /aws-media/env/ — de ahí las leen los ejecutores de C4 (worker/env_ssm.py).

    python tools/ssm_env.py            # sube/actualiza las claves presentes
    python tools/ssm_env.py --dry      # solo lista QUÉ subiría (nunca valores)

Solo viaja la lista blanca de abajo (jamás GOOGLE_*_FILE ni rutas locales).
El prefijo no puede empezar con "aws" (nombres reservados de SSM, mismo gotcha
que el dominio de Cognito).
Los VALORES nunca se imprimen. Hoy son claves de plataforma; C5 las vuelve
por-usuario (decisión D4).
"""
from __future__ import annotations

import argparse
import os
from pathlib import Path

CLAVES = [
    "FAL_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "ASSEMBLYAI_API_KEY",
    "LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY", "LANGFUSE_BASE_URL",
    "OPENAI_MODEL", "GEN_BACKEND",
]
PREFIJO = "/media-ivenaccip/env/"


def leer_env(path: Path) -> dict[str, str]:
    valores: dict[str, str] = {}
    for linea in path.read_text(encoding="utf-8").splitlines():
        linea = linea.strip()
        if not linea or linea.startswith("#") or "=" not in linea:
            continue
        nombre, _, valor = linea.partition("=")
        valores[nombre.strip()] = valor.strip().strip('"').strip("'")
    return valores


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dry", action="store_true", help="solo listar nombres, sin subir")
    ap.add_argument("--env", default=str(Path(__file__).resolve().parent.parent / ".env"))
    args = ap.parse_args()

    valores = leer_env(Path(args.env))
    presentes = [c for c in CLAVES if valores.get(c)]
    faltan = [c for c in CLAVES if not valores.get(c)]
    print("A subir:", ", ".join(presentes) or "(ninguna)")
    if faltan:
        print("Sin valor en .env (se omiten):", ", ".join(faltan))
    if args.dry:
        return

    os.environ.setdefault("AWS_DEFAULT_REGION", "us-east-1")
    import boto3
    ssm = boto3.client("ssm")
    for clave in presentes:
        ssm.put_parameter(Name=PREFIJO + clave, Value=valores[clave],
                          Type="SecureString", Overwrite=True)
        print(f"  {PREFIJO}{clave} OK")
    print(f"{len(presentes)} parámetros en {PREFIJO}")


if __name__ == "__main__":
    main()
