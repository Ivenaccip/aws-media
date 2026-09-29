"""El entorno dev — paso 8 del plan, la app que produce la liga de pruebas.

Es una app de CDK SEPARADA de `app.py` a propósito, y esa es la decisión de
fondo de todo el plan: dev y prod no comparten composición. Escribir
`entorno=DEV` dentro de `construir()` de `app.py` no habría creado un dev, le
habría cambiado el pool de Cognito al stack VIVO. Aquí no hay forma de que eso
pase: este archivo no toca ningún nombre de producción y `app.py` no importa
este módulo.

CUATRO STACKS, NO SIETE
  aws-media-db-dev    Aurora con suelo 0 y auto-pausa (ver stacks/db.py).
  aws-media-media-dev bucket y CDN propios, con la misma lista blanca de
                      prefijos que prod (pipeline/media_rutas.py).
  aws-media-jobs-dev  cola, worker, Fargate y su máquina de estados.
  aws-media-api-dev   Lambda + API Gateway + su PROPIO pool de Cognito.

`base`, `alertas` y `dominio` NO se instancian, y no es por ahorrar:

  base    es el rol OIDC que deja a GitHub Actions empujar al ECR. Hay UN ECR
          y ya tiene su rol; un segundo rol para el mismo repositorio no añade
          nada y sí añade permisos.
  alertas tiene los ids físicos de producción cableados (alertas.py:31-37), o
          sea que unas «alertas de dev» vigilarían producción y avisarían de
          cosas de prod con nombre de dev. Peor que no tener alertas.
  dominio es irremplazables.xyz. Dev se entra por su execute-api: `DEV` no
          tiene `dominio_publico` justamente para eso.

De paso, los tres son los otros nombres únicos por cuenta y región, así que no
instanciarlos resuelve sus colisiones sin tocar una línea.

CÓMO SE DESPLIEGA

`cdk.json` dice `python app.py`, que es PRODUCCIÓN. Dev necesita `--app`
SIEMPRE, en cada comando, también en el `diff` y en el `destroy`:

    cd infra
    npx cdk --app "python app_dev.py" diff
    npx cdk --app "python app_dev.py" deploy --all

Olvidarlo NO despliega prod por error. Comprobado con el comando en la mano:
`app.py` no declara ningún stack que acabe en `-dev`, así que

    npx cdk deploy aws-media-db-dev     ->  exit 1
                                            "No stacks match the name(s) ..."

y lo mismo el `diff`. La excepción es `cdk ls`, que ahí no falla: imprime nada
y sale con 0, así que una lista vacía significa «te falta el --app», no «no hay
stacks». La ÚNICA forma de hacer daño con un despiste es un `--all` sin
`--app`: eso sí despliega los cinco de producción.

Y DESPUÉS DEL PRIMER DEPLOY, la base nace vacía:

    python tools/db_migrate.py        # con las envs de dev, no las de prod
    python tools/ssm_env.py --prefijo /media-ivenaccip-dev/env
    python tools/usuarios.py alta <correo> --pool <el de dev> --cluster-arn <el de dev>

El alta manda un correo de invitación con el asunto `[dev]` y una liga a su
propio execute-api (api.py:140). Dev tiene UN usuario, el dueño, y el grupo
`admin` lo crea el CDK: no hay nada que hacer en la consola.
"""
import os
import sys

import aws_cdk as cdk

# De `app.py` se reusan el destino y las dos funciones que resuelven y vigilan
# la imagen del ECR. Importarlo no sintetiza nada ni habla con AWS: desde el
# paso 3 todo eso vive bajo su `if __name__ == "__main__"`, y hay un test que
# lo fija (test_entornos.test_app_solo_sintetiza_bajo_main).
from app import ENV, _avisar_si_no_es_la_mas_nueva, _digest_de
from entornos import DEV
from stacks.api import ApiStack
from stacks.db import DbStack
from stacks.jobs import JobsStack
from stacks.media import MediaStack

# Dev es donde se prueba lo nuevo, así que el default es `latest` — al revés
# que en un rollback de producción. Fijar un sha sigue valiendo igual:
#
#   IMAGE_TAG=<sha> npx cdk --app "python app_dev.py" deploy --all
IMAGE_TAG = os.getenv("IMAGE_TAG", "latest")


def construir(app: cdk.App, image_ref: str) -> None:
    """Los cuatro stacks de dev.

    Todos reciben `entorno=DEV` explícitamente, incluido `MediaStack`: de ahí
    sale el CORS de su bucket, y con el default (PROD) el bucket de dev diría
    que acepta subidas desde irremplazables.xyz. No es hipotético — lo cazó
    `test_nada_de_dev_apunta_a_produccion` la primera vez que `MediaStack`
    recibió el parámetro."""
    db = DbStack(app, "aws-media-db-dev", env=ENV, entorno=DEV)
    media = MediaStack(app, "aws-media-media-dev", env=ENV, entorno=DEV)
    jobs = JobsStack(app, "aws-media-jobs-dev", env=ENV, cluster_db=db.cluster,
                     media_bucket=media.bucket,
                     cdn_domain=media.cdn.distribution_domain_name,
                     image_ref=image_ref, entorno=DEV)
    ApiStack(app, "aws-media-api-dev", env=ENV, cluster=db.cluster,
             media_bucket=media.bucket,
             cdn_domain=media.cdn.distribution_domain_name,
             jobs_queue=jobs.queue, producir_sm=jobs.state_machine,
             cola_publica=jobs.cola_publica,
             image_ref=image_ref, entorno=DEV)


if __name__ == "__main__":
    app = cdk.App()
    digest = _digest_de(IMAGE_TAG)
    print(f"imagen: {IMAGE_TAG} -> {digest}  [ENTORNO DEV]", file=sys.stderr)
    if IMAGE_TAG != "latest":
        _avisar_si_no_es_la_mas_nueva(IMAGE_TAG, digest)
    construir(app, digest)
    app.synth()
