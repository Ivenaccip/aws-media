"""Los nombres físicos de cada entorno, en un solo lugar.

Decisión del 2026-09-24: dos entornos, `prod` y `dev`, y dev con su PROPIO
pool de Cognito. Este módulo es Python puro —no importa el CDK— para que los
tests que lo vigilan corran en cualquier parte, también en el primer paso del
CI, donde no está instalado `aws_cdk`.

LO QUE HAY QUE SABER ANTES DE TOCAR `PROD`

Cada valor de `PROD` es el nombre de algo que ya existe en la cuenta con datos
dentro. Cambiar uno no renombra nada: CloudFormation crea otro recurso y deja
el viejo atrás. Los que duelen:

  pool / dominio_cognito
      El pool lleva RETAIN: sobrevive huérfano con los usuarios dentro, pero el
      stack pasa a hablar con uno nuevo y vacío, el client_id cambia y las filas
      de `usuarios` y `monedero` quedan indexadas contra un pool al que la app
      ya no habla. Cambiar el prefijo del dominio REEMPLAZA el dominio (se lleva
      el Hosted UI y el branding de Managed Login, que vive fuera de
      CloudFormation). No hay rollback: hay una recuperación manual fea.
  ssm_env / ssm_usuarios
      No es un reemplazo, es una caída: la Lambda busca sus claves donde no
      están.
  maquina_producir
      Reemplaza la máquina de estados; las ejecuciones en curso se pierden.

Por eso `tests/test_entornos.py` fija estos valores literales: un cambio aquí
tiene que romper un test antes de llegar a un deploy.

LO QUE DEV NO COMPARTE CON PROD

Ningún nombre que sea único por cuenta y región (pool, dominio del Hosted UI,
máquina de estados) ni ningún prefijo de SSM: si dev compartiera los de prod,
los permisos de IAM de sus Lambdas alcanzarían las claves de producción. El
test lo comprueba campo por campo.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Entorno:
    nombre: str
    # Cognito
    pool: str
    dominio_cognito: str          # prefijo de <prefijo>.auth.<región>.amazoncognito.com
    # Parameter Store ("aws*" es prefijo reservado en SSM)
    ssm_env: str
    ssm_usuarios: str
    # Step Functions (el nombre es único por cuenta y región)
    maquina_producir: str
    # API Gateway (no es único, pero en la consola se distingue por él)
    api: str
    # Quién firma los correos del pool (invitación, recuperar contraseña).
    # None = el remitente de fábrica de Cognito, no-reply@verificationemail.com.
    # La DIRECCIÓN tiene que estar verificada en SES por separado (no basta con
    # el dominio: SES no admite envío delegado con una dirección que solo hereda
    # la verificación) y llevar la política de infra/ses-politica-remitente.json.
    # Las dos cosas viven fuera del CDK (las pone el dueño): sin ellas el deploy
    # del pool falla.
    # El pool sigue mandando con el correo integrado de Cognito: conserva el
    # tope de 50 correos al día (que es de la CUENTA: lo comparten prod y dev).
    # Dev usa la MISMA dirección porque es la única dirección verificada en SES
    # (la identidad del dominio no sirve como SourceArn): es un remitente, no
    # una liga, y el asunto de dev ya lleva «[dev] » delante.
    remitente_correo: str | None
    # El nombre público del producto: callbacks, logout y la liga del correo de
    # invitación. None = el entorno no tiene nombre propio y se entra por el
    # host execute-api.
    dominio_publico: str | None

    @property
    def es_prod(self) -> bool:
        return self.nombre == "prod"


PROD = Entorno(
    nombre="prod",
    pool="aws-media-users",
    dominio_cognito="media-ivenaccip",
    ssm_env="/media-ivenaccip/env",
    ssm_usuarios="/media-ivenaccip/usuarios",
    maquina_producir="aws-media-producir",
    api="aws-media",
    remitente_correo="hola@irremplazables.xyz",
    dominio_publico="https://irremplazables.xyz",
)

# Sin dominio público a propósito: con el de prod, el correo de invitación de
# dev mandaría a la gente a irremplazables.xyz y sus callbacks de Cognito
# apuntarían a producción. Dev se usa por su execute-api y por localhost.
DEV = Entorno(
    nombre="dev",
    pool="aws-media-users-dev",
    dominio_cognito="media-ivenaccip-dev",
    ssm_env="/media-ivenaccip-dev/env",
    ssm_usuarios="/media-ivenaccip-dev/usuarios",
    maquina_producir="aws-media-producir-dev",
    api="aws-media-dev",
    remitente_correo="hola@irremplazables.xyz",
    dominio_publico=None,
)
