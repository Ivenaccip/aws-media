"""App CDK aparte, solo para el stack de avisos.

Por qué no vive en `app.py`: esa app llama a `_digest_latest()` en CADA synth
(app.py:38-51) y re-fija el ImageUri de la Lambda del API, del worker y de la
task definition de Fargate al digest que tenga `:latest` en ese momento.
Sintetizar las alarmas desde ahí no despliega nada por sí solo, pero deja
abierta la puerta a que un `cdk deploy --all` embarque a producción una imagen
que nadie pidió. Con una App propia ese riesgo no existe: este template solo
contiene SNS, alarmas y un metric filter.

Deploy (desde infra/):

    npx cdk --app "python app_alertas.py" deploy aws-media-alertas

Después del deploy queda UN paso manual sin el cual nada de esto sirve:
confirmar la suscripción desde el correo. Ver docs/OPERACION.md.
"""
import aws_cdk as cdk

from stacks.alertas import AlertasStack

app = cdk.App()

AlertasStack(
    app, "aws-media-alertas",
    env=cdk.Environment(account="191241816158", region="us-east-1"),
    correo="ivenaccip@gmail.com",
    # True solo DESPUÉS de partir la imagen: hoy el init falla el 100% de las
    # veces y la alarma viviría en ALARM sin decir nada nuevo.
    vigilar_init=False,
)

app.synth()
