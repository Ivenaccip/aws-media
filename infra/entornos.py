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
    # El nombre público del producto: callbacks, logout y la liga del correo de
    # invitación. None = el entorno no tiene nombre propio y se entra por el
    # host execute-api.
    dominio_publico: str | None
    # RAG·4 — la tubería pública de /automatiza (cola y worker propios). Va
    # apagada en prod a propósito: aunque el código llegue a main, producción
    # no crea nada público hasta el encendido de RAG·30, que es cambiar este
    # False por True en PROD con su PR y su deploy, no un efecto secundario.
    publico: bool = False
    # RAG·7 — throttling de API Gateway, (peticiones por segundo sostenidas,
    # ráfaga). Es la red de último recurso: aguanta mientras los contadores de
    # la base (RAG·5/6) se enteran. None = sin throttling propio, que es como
    # sigue prod hasta RAG·30 (su template no cambia con esta tarjeta).
    # `throttle_etapa` cubre TODAS las rutas del entorno; `throttle_publico`
    # solo /api/publico/*, mucho más estrecho porque ahí entra internet abierto.
    throttle_etapa: tuple[int, int] | None = None
    throttle_publico: tuple[int, int] | None = None
    # RAG·17 — el almacén vectorial del RAG en S3 Vectors. El bucket y el
    # índice NO los crea el CDK (aws-cdk-lib 2.221 no trae el módulo): los
    # crea el dueño con `tools/vectores.py crear`, y así el índice sobrevive a
    # un `cdk destroy` y al cierre del 25-oct. El CDK solo le da al worker
    # público permiso de LEER este índice. None = el entorno no tiene RAG, que
    # es como sigue prod hasta RAG·30. El nombre del bucket es único por
    # cuenta y región, así que dev y prod nunca comparten uno.
    vectores_bucket: str | None = None
    vectores_indice: str | None = None

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
    dominio_publico=None,
    publico=True,
    # Holgado para el estudio (una pantalla pide decenas de archivos de golpe)
    # y estrecho para lo público: provisionales hasta que RAG·28 diga cuánta
    # gente viene.
    throttle_etapa=(50, 100),
    throttle_publico=(5, 10),
    vectores_bucket="aws-media-vectores-dev",
    # el sufijo es la versión del corpus: reindexar con otro modelo de
    # embeddings o con otro troceado es un índice NUEVO, nunca pisar este
    vectores_indice="n8n-docs-v1",
)
