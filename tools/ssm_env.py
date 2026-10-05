"""Sube las claves de API del .env local a SSM Parameter Store (SecureString)
— de ahí las leen los ejecutores de C4 (worker/env_ssm.py).

    python tools/ssm_env.py                    # sube a PRODUCCIÓN (pide teclear PROD)
    python tools/ssm_env.py --dry              # solo lista QUÉ subiría (nunca valores)
    python tools/ssm_env.py --entorno dev      # sube al Parameter Store de dev

Solo viaja la lista blanca de abajo (jamás GOOGLE_*_FILE ni rutas locales).
Los VALORES nunca se imprimen. Hoy son claves de plataforma; C5 las vuelve
por-usuario (decisión D4).

A QUÉ ENTORNO SUBE — paso 2 del entorno dev

El prefijo ya no es una constante de este archivo: sale de `infra/entornos.py`,
la misma fuente que usan los stacks. Antes era imposible subir claves a dev sin
editar el código, y peor: no había forma de saber a qué Parameter Store estabas
escribiendo hasta después de escribir.

Ahora la herramienta **dice el destino antes de actuar**, y subir a producción
exige teclear PROD. La razón no es ceremonia: `put_parameter` va con
`Overwrite=True`, así que una subida equivocada **pisa la clave que están usando
las Lambdas y los workers vivos**, sin avisar y sin guardar la anterior.

El prefijo no puede empezar con "aws" (nombres reservados de SSM, mismo gotcha
que el dominio de Cognito); `tests/test_entornos.py` lo fija para los dos
entornos.
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from infra import entornos  # noqa: E402  (Python puro, no importa el CDK)

# Mismo idiom que tools/usuarios.py y tools/env_local.py: sin esto, la consola
# cp1252 de Windows parte los acentos de los avisos de abajo, que es justo donde
# se explica por qué una clave no sube.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

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
    # RAG·6 — la sal del hash de IP de /automatiza. La genera el dueño
    # (python -c "import secrets; print(secrets.token_hex(32))") y la pega en
    # su .env; sin ella la sección pública queda cerrada (falla cerrado).
    "AUTOMATIZA_SAL_IP",
    # RAG·35 — firma los enlaces de baja de la lista de novedades. Se genera
    # igual que la de IP y NO debe ser la misma: si una se filtra, la otra
    # sigue sirviendo. Sin ella /automatiza/baja/… responde 503 (falla cerrado).
    "AUTOMATIZA_SAL_BAJA",
    # M17 — importar videos por liga (actores de Apify, pricing.json §apify)
    "APIFY_TOKEN",
]
# Los prefijos de PRODUCCIÓN siguen expuestos como constantes porque
# tests/test_creditos_c5.py y tests/test_jobs_c4.py los importan, pero ya no son
# la verdad: salen de infra/entornos.py. Para otro entorno, prefijos().
PREFIJO = entornos.PROD.ssm_env + "/"

# C5 (D4): claves que un usuario puede aportar como propias — van bajo
# /media-ivenaccip/usuarios/<user_id>/ y PISAN a las de plataforma en el worker.
CLAVES_USUARIO = ["BLOTATO_API_KEY",
                  # M16.4 — chat editorial: la clave de la API de Claude del
                  # usuario (pisa a la de plataforma en el server y los workers)
                  "CLAUDE_API_KEY"]
PREFIJO_USUARIOS = entornos.PROD.ssm_usuarios + "/"


# Claves que NUNCA salen de producción (decisiones de la tarjeta del entorno
# dev). Ninguna falla si llega a dev: todas hacen algo peor, en silencio.
SOLO_PROD = {
    "STRIPE_WEBHOOK_SECRET":
        "es el apagador de los pagos. Sin esta variable el módulo responde 503 "
        "y no sirve links, y así se queda dev.",
    "STRIPE_LINK_100": "link de pago real: en dev no hay nada que cobrar.",
    "STRIPE_LINK_550": "link de pago real: en dev no hay nada que cobrar.",
    "STRIPE_LINK_1200": "link de pago real: en dev no hay nada que cobrar.",
    "LANGFUSE_PUBLIC_KEY":
        "identifica el proyecto de Langfuse. Compartirlo obliga a mover el "
        "label `production` para probar un prompt, y eso cambia producción en "
        "caliente y sin PR.",
    "LANGFUSE_SECRET_KEY": "misma razón que LANGFUSE_PUBLIC_KEY.",
}


def filtrar(presentes: list[str], entorno: entornos.Entorno) -> tuple[list[str], list[str]]:
    """(las que suben, las vetadas). En producción no se veta nada."""
    if entorno.es_prod:
        return presentes, []
    return ([c for c in presentes if c not in SOLO_PROD],
            [c for c in presentes if c in SOLO_PROD])


def prefijos(entorno: entornos.Entorno) -> tuple[str, str]:
    """(claves de plataforma, claves por-usuario) de ese entorno, con la barra
    final que espera put_parameter."""
    return entorno.ssm_env + "/", entorno.ssm_usuarios + "/"


def confirmar_prod(prefijo: str) -> bool:
    """put_parameter va con Overwrite=True: subir aquí PISA la clave que están
    usando las Lambdas y los workers vivos, sin avisar y sin guardar la
    anterior. Por eso producción se teclea."""
    if not sys.stdin.isatty():
        print("\nSubir a PRODUCCIÓN exige confirmarlo a mano y esta terminal no es")
        print("interactiva. Córrelo tú directamente, o usa --dry.")
        return False
    print(f"\nEsto PISA las claves de producción bajo {prefijo}")
    print("(Overwrite=True: la versión anterior no se guarda).")
    if input("Teclea PROD para confirmar: ").strip() != "PROD":
        print("Cancelado: no se subió nada.")
        return False
    return True


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
    ap.add_argument("--entorno", default="prod", choices=["prod", "dev"],
                    help="a qué Parameter Store suben las claves (default prod)")
    args = ap.parse_args()

    entorno = entornos.PROD if args.entorno == "prod" else entornos.DEV
    p_env, p_usuarios = prefijos(entorno)
    claves, prefijo = ((CLAVES_USUARIO, p_usuarios + args.usuario + "/")
                       if args.usuario else (CLAVES, p_env))
    valores = leer_env(Path(args.env))
    presentes = [c for c in claves if valores.get(c)]
    faltan = [c for c in claves if not valores.get(c)]
    presentes, vetadas = filtrar(presentes, entorno)
    # el destino ANTES que la lista: es el dato que decide si esto se cancela
    print(f"Entorno: {entorno.nombre}")
    print(f"Destino: {prefijo}")
    print("A subir:", ", ".join(presentes) or "(ninguna)")
    if faltan:
        print("Sin valor en .env (se omiten):", ", ".join(faltan))
    if vetadas:
        print(f"NO suben a {entorno.nombre}, a propósito:")
        for c in vetadas:
            print(f"  {c} — {SOLO_PROD[c]}")
    if args.dry:
        return
    if entorno.es_prod and not confirmar_prod(prefijo):
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
