"""C3 — media: bucket S3 privado (subidas prefirmadas directo del navegador) +
CloudFront con Origin Access Control para servirlo. El layout de claves espeja
MEDIA_ROOT (videos/<proyecto>/...), así los ejecutores de C4 sincronizan por
prefijo. Sin coste fijo: S3 por GB (centavos) y CloudFront con free tier.

El bucket es RETAIN: el media de los usuarios es dinero gastado (regla dura:
las versiones no se borran)."""
import sys
from pathlib import Path

import aws_cdk as cdk
from aws_cdk import (
    Stack,
    aws_cloudfront as cloudfront,
    aws_cloudfront_origins as origins,
    aws_iam as iam,
    aws_s3 as s3,
)
from constructs import Construct

from entornos import PROD, Entorno

# La lista de prefijos servibles vive en pipeline/media_rutas.py porque la leen
# también el servidor y los ejecutores, y tienen que decir LO MISMO que la
# política de este bucket. `cdk` corre app.py con cwd=infra/, así que la raíz
# del repo no entra sola en el path.
RAIZ = Path(__file__).resolve().parents[2]
if str(RAIZ) not in sys.path:
    sys.path.insert(0, str(RAIZ))
from pipeline import media_rutas  # noqa: E402


class MediaStack(Stack):
    def __init__(self, scope: Construct, id_: str, *,
                 entorno: Entorno = PROD, **kwargs) -> None:
        super().__init__(scope, id_, **kwargs)
        e = entorno

        self.bucket = s3.Bucket(
            self, "Media",
            block_public_access=s3.BlockPublicAccess.BLOCK_ALL,
            encryption=s3.BucketEncryption.S3_MANAGED,
            enforce_ssl=True,
            # el PUT prefirmado llega directo del navegador: CORS obligatorio.
            # Estaba en `*` con un comentario que decía «se restringe cuando
            # haya auth»; el auth existe desde M2, así que se restringe ahora.
            # Son los MISMOS tres orígenes que los callbacks de Cognito
            # (api.py), por la misma razón: hay que cubrir cada sitio desde el
            # que alguien pueda entrar, o su subida muere en el preflight.
            #
            # El execute-api va con comodín porque este stack no conoce su host
            # —ApiStack depende de éste, no al revés— y S3 admite un `*` en el
            # origen. Cubre el host de prod y el que tenga dev el día que exista.
            cors=[s3.CorsRule(
                allowed_methods=[s3.HttpMethods.PUT, s3.HttpMethods.GET,
                                 s3.HttpMethods.HEAD],
                allowed_origins=(
                    ([e.dominio_publico] if e.dominio_publico else [])
                    + [f"https://*.execute-api.{self.region}.amazonaws.com",
                       "http://localhost:8011"]),
                allowed_headers=["*"], max_age=3600)],
            removal_policy=cdk.RemovalPolicy.RETAIN,
            # 21-sep-2026 — versionado. RETAIN protege el bucket de CDK, pero no
            # protegía su contenido de nosotros mismos: una clave sobrescrita
            # por un reintento, o un `delete-object` a mano, se llevaba el
            # trabajo del usuario sin dejar nada que restaurar. Con versionado,
            # S3 guarda la anterior y volver atrás es un comando.
            #
            # Aquí es casi gratis: hoy no hay UN SOLO borrado de S3 en server/,
            # worker/ ni pipeline/ (`limpiar` borra de /tmp, y el único
            # `delete_parameter` es de SSM), y las claves llevan id o fecha, así
            # que no se pisan. O sea que una versión no-actual solo aparece
            # cuando algo salió mal — que es justo la que queremos conservar.
            versioned=True,
            # M12: a los 10 días los binarios pasan a Glacier Instant Retrieval
            # (~6× más barato de guardar; lectura instantánea por el CDN, así
            # que la UX no cambia). Solo objetos grandes: GIR factura mínimo
            # 128 KB/objeto y encarecería los json/transcripts chicos. La regla
            # cuenta días desde la SUBIDA (no el último uso) — asumido en el
            # plan: un proyecto aún en edición paga ~$0.03/GB por relectura.
            lifecycle_rules=[s3.LifecycleRule(
                id="frio-glacier-ir-10d",
                object_size_greater_than=1_000_000,
                transitions=[s3.Transition(
                    storage_class=s3.StorageClass.GLACIER_INSTANT_RETRIEVAL,
                    transition_after=cdk.Duration.days(10),
                )],
                # Las versiones viejas siguen el mismo camino al frío, y NO se
                # expiran: la regla dura del repo es que las versiones no se
                # borran, y una copia de seguridad con fecha de caducidad no es
                # una copia de seguridad. A los 10 días cuestan ~6× menos.
                noncurrent_version_transitions=[s3.NoncurrentVersionTransition(
                    storage_class=s3.StorageClass.GLACIER_INSTANT_RETRIEVAL,
                    transition_after=cdk.Duration.days(10),
                )],
            )],
        )
        self.cdn = cloudfront.Distribution(
            self, "Cdn",
            default_behavior=cloudfront.BehaviorOptions(
                origin=origins.S3BucketOrigin.with_origin_access_control(self.bucket),
                viewer_protocol_policy=cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                cache_policy=cloudfront.CachePolicy.CACHING_OPTIMIZED,
            ),
        )

        # LA FUGA, cerrada en el origen. El OAC que monta CDK arriba le da a
        # CloudFront `s3:GetObject` sobre `<bucket>/*` — el bucket ENTERO— y por
        # ahí se servía `videos/<proyecto>/work/editor/proxy.mp4` a cualquiera
        # que adivinara el nombre del proyecto. Ocho se adivinaban a la primera.
        #
        # Se cierra con un Deny sobre el principal de CloudFront y NO recortando
        # el Allow que pone CDK, por dos razones: un Deny gana siempre, y con
        # `NotResource` la regla queda «lo que no esté listado, no se sirve», o
        # sea que un prefijo NUEVO nace cerrado. La versión que cortaba por
        # extensión fallaba al revés: cualquier `.mp4` nuevo nacía público solo.
        #
        # Solo toca a CloudFront. El rol de la Lambda y los de los ejecutores
        # siguen leyendo el bucket entero por la API de S3, que es como bajan lo
        # que tienen que procesar. Lo de fuera pasa a ir firmado
        # (pipeline/media_sync.url_media).
        self.bucket.add_to_resource_policy(iam.PolicyStatement(
            effect=iam.Effect.DENY,
            principals=[iam.ServicePrincipal("cloudfront.amazonaws.com")],
            actions=["s3:GetObject"],
            not_resources=[self.bucket.arn_for_objects(f"{p}*")
                           for p in media_rutas.SERVIBLES_CDN],
        ))

        cdk.CfnOutput(self, "BucketName", value=self.bucket.bucket_name)
        cdk.CfnOutput(self, "CdnDomain", value=self.cdn.distribution_domain_name)
