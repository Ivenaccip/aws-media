"""Paso 0 del entorno dev — escribe `.env.local`: el 8011 con login real.

    venv/Scripts/python tools/env_local.py                  # ENSAYO: dice qué escribiría
    venv/Scripts/python tools/env_local.py --ejecutar        # escribe .env.local
    venv/Scripts/python tools/env_local.py --entorno dev --ejecutar   # cuando exista (paso 8)

POR QUÉ UN ARCHIVO APARTE Y NO EL .env

`.env` son TUS claves de terceros y las pones tú a mano. `.env.local` es el
cableado de AWS y lo genera esta herramienta leyendo los outputs del stack
desplegado. Así el cableado se regenera sin riesgo de pisar una clave, y
`pipeline/config.py` lo carga DESPUÉS del `.env` y con override, para que el
generado gane. El paso 2 de la tarjeta saca `DB_CLUSTER_ARN`/`DB_SECRET_ARN` del
`.env`: este archivo es su destino.

LO QUE APUNTA A PRODUCCIÓN — LÉELO ANTES DE CORRERLO

Mientras no existan los stacks `-dev` (paso 8), el único pool y la única base que
hay son los de producción. Con `.env.local` puesto, tu 8011 entra con login real
y el monedero, los proyectos y los créditos que vea son los REALES: lo que
cobres o borres ahí le pasa a un usuario de verdad. Por eso escribirlo con
`--entorno prod` exige teclear PROD.

LO QUE NO ESCRIBE, A PROPÓSITO

  JOBS_BACKEND, JOBS_QUEUE_URL, PRODUCIR_SM_ARN
      Con esos tres tu máquina despacha trabajos a la cola y a la máquina de
      estados de PRODUCCIÓN: pagarías generaciones de verdad desde un servidor
      de pruebas, y el trabajo lo recogería el worker de prod. Local se queda
      con su backend local.
  STRIPE_WEBHOOK_SECRET
      Decisión de la tarjeta: sin esa variable el módulo de pagos responde 503 y
      no sirve links. Es el apagador y se queda apagado.
  LANGFUSE_PROMPTS
      Con el flag los prompts salen del label `production` de Langfuse: probar
      un prompt en local exigiría mover ese label, y eso cambia producción en
      caliente y sin PR. Local lee los .md del repo.
  SSM_USUARIOS_PREFIX
      Es el peor de todos y no falla: PUBLICA. Con el prefijo de producción,
      `claves_usuario.en_nube()` da True y `blotato.clave_y_origen()` devuelve la
      clave de Blotato de un usuario REAL leída de SSM; a partir de ahí cualquier
      prueba de MIX publica en la cuenta de redes de ese cliente. Sin el prefijo,
      las claves salen de `work/_claves` (archivo local que git ignora) y el flujo
      de «conecta tu clave» se prueba igual. Lo mismo vale para la clave de la API
      de Claude que lee pipeline/chat_nube.py.
  SSM_ENV_PREFIX
      En local no lo lee nadie: lo consume worker/env_ssm.py, que importa
      `server/lambda_handler.py` (el entrypoint de Lambda), no `server/app.py`,
      que es lo que arranca uvicorn. Una variable que hoy no hace nada pero que
      mañana traería las claves de plataforma de SSM pisando al .env no se
      escribe: en local las claves son las del .env.
  MEDIA_ROOT, WORK_DIR, HOME, PYTHONIOENCODING
      Son rutas de la Lambda (/data, /tmp), no de tu máquina.

NUNCA IMPRIME VALORES. Ni en ensayo ni al escribir: solo nombres y de dónde sale
cada uno. Los identificadores del stack no son secretos, pero la regla del repo
es que no se pegan en una terminal cuyo texto acaba en un chat.
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ))

from infra import entornos  # noqa: E402  (Python puro, no importa el CDK)

# Mismo idiom que tools/usuarios.py y tools/setup.py (consola cp1252 en Windows).
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# Lo que solo sabe AWS: (variable, stack, output). Los nombres de output son los
# CfnOutput de infra/stacks/*.py — si alguien los renombra, esto falla fuerte y
# con nombre, que es lo que se quiere.
DESDE_STACK = (
    ("COGNITO_POOL_ID", "api", "UserPoolId"),
    ("COGNITO_CLIENT_ID", "api", "UserPoolClientId"),
    ("DB_CLUSTER_ARN", "db", "ClusterArn"),
    ("DB_SECRET_ARN", "db", "SecretArn"),
    ("MEDIA_BUCKET", "media", "BucketName"),
    ("CDN_BASE", "media", "CdnDomain"),      # se le antepone https:// como en api.py
)

# Literales que IGUALAN a infra/stacks/api.py. Sin ellos el estado y el monedero
# caen a sus backends de archivo y el login real no sirve de nada: entrarías con
# tu cuenta de verdad a un monedero de mentira.
LITERALES = {
    "DB_NAME": "media",
    "STATE_BACKEND": "postgres",
    "CREDITOS_BACKEND": "postgres",
}

# Las que NUNCA se escriben. tests/test_entorno_local.py fija esta lista: si
# alguien añade una aquí o allá sin la otra, el test lo dice.
PROHIBIDAS = (
    "JOBS_BACKEND", "JOBS_QUEUE_URL", "PRODUCIR_SM_ARN",
    "STRIPE_WEBHOOK_SECRET", "LANGFUSE_PROMPTS",
    "SSM_USUARIOS_PREFIX", "SSM_ENV_PREFIX",
    "MEDIA_ROOT", "WORK_DIR", "HOME", "PYTHONIOENCODING",
)


def stacks_de(entorno: entornos.Entorno) -> dict[str, str]:
    """Los tres stacks que tienen los outputs que necesita el 8011."""
    sufijo = "" if entorno.es_prod else f"-{entorno.nombre}"
    return {k: f"aws-media-{k}{sufijo}" for k in ("api", "db", "media")}


def outputs(cfn, stack: str) -> dict[str, str]:
    from botocore.exceptions import ClientError
    try:
        desc = cfn.describe_stacks(StackName=stack)["Stacks"][0]
    except ClientError as e:
        if "does not exist" in str(e):
            raise SystemExit(
                f"No existe el stack {stack}.\n"
                "Si pediste --entorno dev: sus stacks son el paso 8 de la "
                "tarjeta, todavía no están desplegados.")
        raise
    return {o["OutputKey"]: o["OutputValue"] for o in desc.get("Outputs", [])}


def cluster_del_entorno(entorno: entornos.Entorno) -> str:
    """El ARN del clúster de Aurora de ese entorno, según CloudFormation.

    Se PREGUNTA en vez de adivinarse. El nombre físico del clúster lo genera CDK
    (`awsmediadb…`), así que deducir el entorno leyendo el texto del ARN es
    justo el tipo de heurística que acierta hasta el día que no. Lo usa
    tools/creditos.py para negarse a mover créditos si el clúster que recibió no
    es el del entorno que le declararon."""
    import boto3
    stack = stacks_de(entorno)["db"]
    outs = outputs(boto3.client("cloudformation"), stack)
    if "ClusterArn" not in outs:
        raise SystemExit(
            f"El stack {stack} no publica el output ClusterArn. "
            "¿Se renombró en infra/stacks/db.py?")
    return outs["ClusterArn"]


def region_del_pool(pool_id: str) -> str:
    """El pool id trae la región delante: us-east-1_XXXX. Mismo truco que
    server/auth.py:_region(), así no depende de la región del perfil."""
    return pool_id.split("_")[0]


def recolectar(entorno: entornos.Entorno) -> dict[str, str]:
    import boto3
    nombres = stacks_de(entorno)
    cfn = boto3.client("cloudformation")
    por_stack = {k: outputs(cfn, s) for k, s in nombres.items()}

    valores: dict[str, str] = {}
    for var, stack, clave in DESDE_STACK:
        if clave not in por_stack[stack]:
            raise SystemExit(
                f"El stack {nombres[stack]} no publica el output {clave}, que es "
                f"de donde sale {var}. ¿Se renombró en infra/stacks/?")
        valores[var] = por_stack[stack][clave]
    valores["CDN_BASE"] = "https://" + valores["CDN_BASE"]

    # Cruce que atrapa apuntar al stack equivocado: el pool que devolvió el
    # stack tiene que llamarse como dice infra/entornos.py para este entorno.
    pool_id = valores["COGNITO_POOL_ID"]
    region = region_del_pool(pool_id)
    idp = boto3.client("cognito-idp", region_name=region)
    real = idp.describe_user_pool(UserPoolId=pool_id)["UserPool"]["Name"]
    if real != entorno.pool:
        raise SystemExit(
            f"El stack {nombres['api']} habla con un pool llamado {real!r}, pero "
            f"infra/entornos.py dice que {entorno.nombre} usa {entorno.pool!r}.\n"
            "No escribo nada: o el stack no es el de este entorno, o alguien "
            "cambió un nombre que no se puede cambiar (lee el docstring de "
            "infra/entornos.py).")

    valores["COGNITO_DOMINIO"] = (
        f"{entorno.dominio_cognito}.auth.{region}.amazoncognito.com")
    # Los dos prefijos de SSM del entorno NO se escriben — ver PROHIBIDAS y el
    # docstring. El de usuarios publicaría en la cuenta de redes de un cliente.
    valores.update(LITERALES)

    fugas = [v for v in valores if v in PROHIBIDAS]
    if fugas:      # cinturón: la lista de arriba y esta no pueden solaparse
        raise SystemExit(f"Bug: iba a escribir variables prohibidas: {fugas}")
    return valores


def origen(var: str) -> str:
    """De dónde sale cada variable, para el ensayo. Sin valores."""
    for v, stack, clave in DESDE_STACK:
        if v == var:
            return f"output {clave} del stack {stack}"
    if var in LITERALES:
        return "literal, igual que infra/stacks/api.py"
    return "infra/entornos.py"


def git_lo_ignora(salida: Path) -> bool:
    r = subprocess.run(["git", "check-ignore", "-q", str(salida)],
                       cwd=RAIZ, capture_output=True)
    return r.returncode == 0


def cabecera(entorno: entornos.Entorno, nombres: dict[str, str]) -> str:
    aviso = ("# OJO: APUNTA A PRODUCCIÓN. El monedero, los créditos y los\n"
             "# proyectos que veas en http://localhost:8011 son REALES.\n"
             if entorno.es_prod else
             f"# Entorno {entorno.nombre}: datos de prueba.\n")
    return (
        "# Generado por tools/env_local.py — NO se comitea (.gitignore) y NO se\n"
        "# edita a mano: vuelve a correr la herramienta y se regenera.\n"
        f"# Entorno: {entorno.nombre} · stacks: {', '.join(sorted(nombres.values()))}\n"
        f"# Fecha: {datetime.now(timezone.utc).isoformat(timespec='seconds')}\n"
        + aviso +
        "#\n"
        "# Lo carga pipeline/config.py DESPUÉS del .env y con override, así que lo\n"
        "# que esté aquí gana. Para volver al dev local de siempre (sin login, todo\n"
        "# como DEFAULT_USER_ID), borra o renombra este archivo.\n"
        "#\n"
        "# A propósito NO están JOBS_BACKEND/JOBS_QUEUE_URL/PRODUCIR_SM_ARN (tu\n"
        "# máquina despacharía trabajos de pago a producción), STRIPE_WEBHOOK_SECRET\n"
        "# ni LANGFUSE_PROMPTS. Ver el docstring de tools/env_local.py.\n"
    )


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Escribe .env.local con el cableado de AWS del entorno.")
    ap.add_argument("--entorno", default="prod", choices=["prod", "dev"])
    ap.add_argument("--salida", default=".env.local",
                    help="ruta relativa a la raíz del repo (default .env.local)")
    ap.add_argument("--ejecutar", action="store_true",
                    help="escribe el archivo; sin esto solo dice qué haría")
    ap.add_argument("--forzar", action="store_true",
                    help="sobreescribe un .env.local que ya exista")
    args = ap.parse_args()

    entorno = entornos.PROD if args.entorno == "prod" else entornos.DEV
    salida = (RAIZ / args.salida).resolve()
    nombres = stacks_de(entorno)

    if not git_lo_ignora(salida):
        print(f"ERROR: git NO ignora {args.salida}.")
        print("Añádelo al .gitignore antes de generarlo: este archivo lleva los")
        print("ARN de la base y del secreto, y el pool de Cognito.")
        return 2

    valores = recolectar(entorno)

    print(f"Entorno {entorno.nombre} · pool {entorno.pool} (cruce con el stack OK)")
    print(f"Stacks leídos: {', '.join(sorted(nombres.values()))}")
    print(f"{len(valores)} variables para {args.salida}:")
    for var in sorted(valores):
        print(f"  {var:<22} <- {origen(var)}")
    print("NO se escriben, a propósito: " + ", ".join(PROHIBIDAS))

    if not args.ejecutar:
        print("\nEnsayo: no se escribió nada. Añade --ejecutar cuando lo hayas leído.")
        return 0

    if salida.exists() and not args.forzar:
        print(f"\n{args.salida} ya existe. Con --forzar lo sobreescribo.")
        return 1

    if entorno.es_prod:
        if not sys.stdin.isatty():
            print("\nEscribir el cableado de PRODUCCIÓN exige confirmarlo a mano y")
            print("esta terminal no es interactiva. Córrelo tú directamente.")
            return 1
        print("\nEsto apunta tu 8011 al pool y a la base de PRODUCCIÓN.")
        if input("Teclea PROD para confirmar: ").strip() != "PROD":
            print("Cancelado: no se escribió nada.")
            return 1

    cuerpo = "".join(f"{k}={valores[k]}\n" for k in sorted(valores))
    salida.write_text(cabecera(entorno, nombres) + "\n" + cuerpo, encoding="utf-8")
    os.chmod(salida, 0o600)
    print(f"\nEscrito {args.salida} ({len(valores)} variables).")
    print("Arranca con:  venv/Scripts/python -m uvicorn server.app:app --port 8011")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
