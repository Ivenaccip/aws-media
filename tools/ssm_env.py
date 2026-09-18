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
    # M23 · B — los dos ids del modelo de imagen. No son secretos: viajan por
    # aquí para poder cambiar de modelo SIN desplegar, que es justo lo que hace
    # falta entre el lanzamiento del 23-sep y el apagón de Nano Banana del
    # 2-oct, y lo que convierte el selector de modelos en configuración.
    "FAL_IMAGEN", "FAL_IMAGEN_EDIT",
    # M4 — Stripe: el whsec_ del webhook y los 3 Payment Links (los links no
    # son secretos, pero viajan por aquí para no hornearlos en la infra)
    "STRIPE_WEBHOOK_SECRET", "STRIPE_LINK_100", "STRIPE_LINK_550", "STRIPE_LINK_1200",
    # M16.4+: la API de Claude como BASE de plataforma — todos los usuarios
    # tienen el chat editorial configurado; una clave por-usuario (D4) la pisa
    "CLAUDE_API_KEY",
    # M17 — importar videos por liga (actores de Apify, pricing.json §apify)
    "APIFY_TOKEN",
]
PREFIJO = "/media-ivenaccip/env/"

# C5 (D4): claves que un usuario puede aportar como propias — van bajo
# /media-ivenaccip/usuarios/<user_id>/ y PISAN a las de plataforma en el worker.
CLAVES_USUARIO = ["BLOTATO_API_KEY",
                  # M16.4 — chat editorial: la clave de la API de Claude del
                  # usuario (pisa a la de plataforma en el server y los workers)
                  "CLAUDE_API_KEY"]
PREFIJO_USUARIOS = "/media-ivenaccip/usuarios/"


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
    ap.add_argument("--usuario", help="subir las CLAVES_USUARIO bajo el prefijo de ese user_id")
    args = ap.parse_args()

    claves, prefijo = ((CLAVES_USUARIO, PREFIJO_USUARIOS + args.usuario + "/")
                       if args.usuario else (CLAVES, PREFIJO))
    valores = leer_env(Path(args.env))
    presentes = [c for c in claves if valores.get(c)]
    faltan = [c for c in claves if not valores.get(c)]
    print("A subir:", ", ".join(presentes) or "(ninguna)")
    if faltan:
        print("Sin valor en .env (se omiten):", ", ".join(faltan))
    if args.dry:
        return

    os.environ.setdefault("AWS_DEFAULT_REGION", "us-east-1")
    import boto3
    ssm = boto3.client("ssm")
    for clave in presentes:
        ssm.put_parameter(Name=prefijo + clave, Value=valores[clave],
                          Type="SecureString", Overwrite=True)
        print(f"  {prefijo}{clave} OK")
    print(f"{len(presentes)} parámetros en {prefijo}")


if __name__ == "__main__":
    main()
