"""C1 — API viva: la app completa (f1/e1/APIs) servida por Lambda contenedor
detrás de API Gateway HTTP. M2: el login se EXIGE — la app (server/auth.py)
valida el id_token del pool en /api/* y /editor/* usando las envs COGNITO_*
que se cablean aquí. La exigencia vive en la app y no en un authorizer del
gateway a propósito: los <img>/<audio> piden /api/.../archivo/... sin header
Authorization (viajan con cookie) y el authorizer solo lee headers."""
import aws_cdk as cdk
from aws_cdk import (
    Duration, Stack,
    aws_apigatewayv2 as apigwv2,
    aws_apigatewayv2_integrations as apigw_int,
    aws_cognito as cognito,
    aws_ecr as ecr,
    aws_iam as iam,
    aws_lambda as lambda_,
    aws_logs as logs,
    aws_rds as rds,
    aws_s3 as s3,
    aws_sqs as sqs,
    aws_stepfunctions as sfn,
)
from constructs import Construct


class ApiStack(Stack):
    def __init__(self, scope: Construct, id_: str, *,
                 cluster: rds.DatabaseCluster, media_bucket: s3.Bucket,
                 cdn_domain: str, jobs_queue: sqs.Queue,
                 producir_sm: sfn.StateMachine, image_ref: str = "latest",
                 **kwargs) -> None:
        super().__init__(scope, id_, **kwargs)

        repo = ecr.Repository.from_repository_name(self, "Repo", "aws-media")
        fn = lambda_.DockerImageFunction(
            self, "Api",
            # image_ref = digest resuelto en app.py (nunca el tag "latest":
            # CloudFormation no ve cambios en esa cadena y no actualiza el código)
            code=lambda_.DockerImageCode.from_ecr(
                repo, tag_or_digest=image_ref,
                entrypoint=["/usr/local/bin/python", "-m", "awslambdaric"],
                cmd=["server.lambda_handler.handler"],
            ),
            memory_size=1536,
            timeout=Duration.seconds(29),   # API Gateway corta a los 30 s
            # C6: retención corta — el log group auto-creado vive para siempre
            log_retention=logs.RetentionDays.ONE_WEEK,
            environment={
                "MEDIA_ROOT": "/data",       # horneado vacío en la imagen (C3 lo lleva a S3)
                "PYTHONIOENCODING": "utf-8",
                "HOME": "/tmp",              # único directorio escribible en Lambda
                # C2: la verdad de los proyectos vive en Aurora vía Data API;
                # el workdir cae en /tmp (artefactos efímeros hasta C3/S3).
                "STATE_BACKEND": "postgres",
                "WORK_DIR": "/tmp/work",
                "DB_CLUSTER_ARN": cluster.cluster_arn,
                "DB_SECRET_ARN": cluster.secret.secret_arn,
                "DB_NAME": "media",
                # C3: subidas prefirmadas a S3, servidas por CloudFront
                "MEDIA_BUCKET": media_bucket.bucket_name,
                "CDN_BASE": f"https://{cdn_domain}",
                # C4: preparar → SQS, producir → Step Functions; claves en SSM
                "JOBS_BACKEND": "aws",
                "JOBS_QUEUE_URL": jobs_queue.queue_url,
                "PRODUCIR_SM_ARN": producir_sm.state_machine_arn,
                "SSM_ENV_PREFIX": "/media-ivenaccip/env",   # "aws*" reservado en SSM
                # C5: monedero de créditos (gates 402 en crear/producir)
                "CREDITOS_BACKEND": "postgres",
                "SSM_USUARIOS_PREFIX": "/media-ivenaccip/usuarios",
            },
            # La regla single-worker se protege aquí cuando la cuota de la
            # cuenta lo permita (las cuentas nuevas traen 10 concurrentes y
            # reservar 1 rompe el mínimo no-reservado; aumento ya solicitado).
            # En C1 no hay estado que proteger: FS de solo lectura y sin datos.
        )

        cluster.grant_data_api_access(fn)   # rds-data + leer el secreto del clúster
        # presign PUT + head_object; SIN delete a propósito (las versiones no se borran)
        media_bucket.grant_put(fn)
        media_bucket.grant_read(fn)
        jobs_queue.grant_send_messages(fn)
        producir_sm.grant_start_execution(fn)
        fn.add_to_role_policy(iam.PolicyStatement(
            actions=["ssm:GetParameter", "ssm:GetParameters", "ssm:GetParametersByPath"],
            resources=[f"arn:aws:ssm:{self.region}:{self.account}:parameter/media-ivenaccip/env*",
                       f"arn:aws:ssm:{self.region}:{self.account}:parameter/media-ivenaccip/usuarios*"]))

        http_api = apigwv2.HttpApi(
            self, "HttpApi", api_name="aws-media",
            default_integration=apigw_int.HttpLambdaIntegration("Fn", fn),
        )

        pool = cognito.UserPool(
            self, "Users", user_pool_name="aws-media-users",
            self_sign_up_enabled=False,      # alta manual mientras es piloto
            sign_in_aliases=cognito.SignInAliases(email=True),
            # M2: el email que dispara tools/usuarios.py alta — {username} y
            # {####} los rellena Cognito (correo y contraseña provisional)
            user_invitation=cognito.UserInvitationConfig(
                email_subject="Bienvenid@ a la demo de editor irremplazable",
                email_body=(
                    "<p>Hola:</p>"
                    "<p>Ya tienes acceso a la demo. Entra aquí:<br>"
                    f'<a href="{http_api.api_endpoint}">{http_api.api_endpoint}</a></p>'
                    "<p>Correo: <b>{username}</b><br>"
                    "Contraseña provisional: <b>{####}</b></p>"
                    "<p>Al entrar por primera vez te pedirá cambiar la "
                    "contraseña. Y un aviso: la primera carga puede tardar un "
                    "poco (alrededor de un minuto) mientras despierta el "
                    "servidor — si algo no aparece, espera unos segundos y "
                    "recarga la página.</p>"
                ),
            ),
            removal_policy=cdk.RemovalPolicy.RETAIN,
        )
        client = pool.add_client(
            "web",
            o_auth=cognito.OAuthSettings(
                flows=cognito.OAuthFlows(authorization_code_grant=True),
                scopes=[cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL],
                # M2: el Hosted UI vuelve a callback.html (PKCE, sin secret);
                # localhost habilita probar el flujo con el server de dev
                callback_urls=[f"{http_api.api_endpoint}/callback.html",
                               "http://localhost:8011/callback.html"],
                logout_urls=[f"{http_api.api_endpoint}/",
                             "http://localhost:8011/"],
            ),
        )
        # ojo: los prefijos de dominio Cognito no admiten la palabra reservada "aws"
        pool.add_domain("Domain", cognito_domain=cognito.CognitoDomainOptions(
            domain_prefix="media-ivenaccip"))

        # M6: el dashboard admin exige pertenecer a este grupo (el id_token lo
        # trae en cognito:groups); miembros por CLI: tools/usuarios.py admin
        cognito.CfnUserPoolGroup(
            self, "AdminGroup", user_pool_id=pool.user_pool_id,
            group_name="admin",
            description="Acceso al dashboard de costes (/admin.html)")

        # M2: con estas envs presentes, server/auth.py exige el JWT
        fn.add_environment("COGNITO_POOL_ID", pool.user_pool_id)
        fn.add_environment("COGNITO_CLIENT_ID", client.user_pool_client_id)
        fn.add_environment(
            "COGNITO_DOMINIO",
            f"media-ivenaccip.auth.{self.region}.amazoncognito.com")

        cdk.CfnOutput(self, "ApiUrl", value=http_api.api_endpoint)
        cdk.CfnOutput(self, "UserPoolId", value=pool.user_pool_id)
        cdk.CfnOutput(self, "UserPoolClientId", value=client.user_pool_client_id)
