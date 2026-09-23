"""App CDK aparte, solo para el dominio personalizado.

Por qué no vive en `app.py`: esa app llama a `_digest_de()` en CADA synth
(app.py:142) y re-fija el ImageUri de la Lambda del API, del worker y de la task
definition de Fargate al digest que tenga `:latest` en ese momento. Sintetizar
el dominio desde ahí no despliega nada por sí solo, pero deja abierta la puerta
a que un `cdk deploy --all` embarque a producción una imagen que nadie pidió.
Con una App propia ese riesgo no existe: este template solo contiene un
DomainName y su ApiMapping. Mismo razonamiento que `app_alertas.py`.

Deploy (desde infra/):

    cmd         set "CERT_ARN=arn:aws:acm:us-east-1:191241816158:certificate/XXXX"
    PowerShell  $env:CERT_ARN = "arn:aws:acm:us-east-1:191241816158:certificate/XXXX"

    npx cdk --app "python app_dominio.py" deploy aws-media-dominio

Y al terminar, soltar la variable: `set` dura lo que dure la ventana, no lo que
dure el comando, y eso ya mordió dos veces con IMAGE_TAG (ver app.py).

    cmd         set "CERT_ARN="
    PowerShell  Remove-Item Env:CERT_ARN

Las comillas de `set "VAR=valor"` no son adorno: sin ellas, `set VAR=x && ...`
mete dentro del valor el espacio que hay antes del `&&`. Mordió el 2026-09-22.
"""
import os
import sys

import aws_cdk as cdk

from stacks.dominio import DominioStack

# El ARN no es un secreto —es un identificador público, igual que los ids de
# alertas.py—, pero se lee del entorno porque el día que se escribe este archivo
# todavía no existe. Si falta, esto se PARA: desplegar un dominio personalizado
# contra un certificado inventado deja el stack en ROLLBACK y el mensaje de
# CloudFormation no dice por qué de forma obvia.
CERT_ARN = os.getenv("CERT_ARN", "").strip()
if not CERT_ARN:
    raise SystemExit(
        "ERROR: falta CERT_ARN. Es el ARN del certificado de ACM para\n"
        "irremplazables.xyz, en us-east-1 y en estado ISSUED. Sácalo con:\n\n"
        "  aws acm list-certificates --region us-east-1 "
        "--certificate-statuses ISSUED "
        "--query \"CertificateSummaryList[?DomainName=='irremplazables.xyz']"
        ".CertificateArn\" --output text\n\n"
        "Si ese comando no devuelve nada, el certificado todavía no está "
        "emitido y este deploy fallaría.")

# Un ARN de otra región no sirve para un dominio REGIONAL: la documentación de
# AWS lo dice textual — «To use an ACM certificate with a Regional custom domain
# name, you must request or import the certificate in the same Region as your
# API». Se comprueba aquí porque el error de CloudFormation llega varios minutos
# después y no nombra la región.
if ":acm:us-east-1:" not in CERT_ARN:
    raise SystemExit(
        f"ERROR: el certificado no parece de us-east-1 ({CERT_ARN}).\n"
        "Un dominio personalizado REGIONAL exige el certificado en la misma "
        "región que el API.")

app = cdk.App()

DominioStack(
    app, "aws-media-dominio",
    env=cdk.Environment(account="191241816158", region="us-east-1"),
    certificado_arn=CERT_ARN,
)

# Que el deploy diga en voz alta contra qué certificado va: el ARN es ilegible y
# no aparece en el diff de CloudFormation de forma útil.
print(f"certificado: {CERT_ARN}", file=sys.stderr)
app.synth()
