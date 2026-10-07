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

from entornos import PROD, Entorno

# El nombre público del producto. Vive en una constante y no cableado en tres
# f-strings porque aparece en tres sitios que TIENEN que decir lo mismo: los
# callbacks de Cognito, los logout y la liga del correo de invitación. Si uno se
# queda atrás, el síntoma es un `redirect_mismatch` del Hosted UI que no apunta
# a ningún lado.
#
# El dominio personalizado de API Gateway que sirve este nombre NO se declara
# aquí: vive en el stack aislado `aws-media-dominio` (stacks/dominio.py), porque
# cada synth de infra/app.py re-fija el ImageUri de las Lambdas al digest de
# `:latest` y un `cdk deploy aws-media-api` arrastra además a aws-media-db,
# aws-media-media y aws-media-jobs.
#
# El valor vive en infra/entornos.py (PROD.dominio_publico); dev no tiene.
DOMINIO_PUBLICO = PROD.dominio_publico


class ApiStack(Stack):
    def __init__(self, scope: Construct, id_: str, *,
                 cluster: rds.DatabaseCluster, media_bucket: s3.Bucket,
                 cdn_domain: str, jobs_queue: sqs.Queue,
                 producir_sm: sfn.StateMachine, image_ref: str = "latest",
                 entorno: Entorno = PROD, **kwargs) -> None:
        super().__init__(scope, id_, **kwargs)
        # Todos los nombres físicos salen de `entorno`. El default es PROD y
        # reproduce los nombres de hoy; pasar DEV a ESTE stack (el vivo) no
        # lo convierte en dev: le cambia el pool por uno vacío. Ver
        # infra/entornos.py y tests/test_entornos.py.
        e = entorno

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
                "SSM_ENV_PREFIX": e.ssm_env,   # "aws*" reservado en SSM
                # C5: monedero de créditos (gates 402 en crear/producir)
                "CREDITOS_BACKEND": "postgres",
                "SSM_USUARIOS_PREFIX": e.ssm_usuarios,
                # M10: los prompts se sirven desde Langfuse (label production)
                # con fallback a los .md de la imagen; sin este flag (dev
                # local, tests) siempre se leen los .md del repo.
                "LANGFUSE_PROMPTS": "1",
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
        # M23 · D (prerrequisito): el freno de capacidad cuenta las ejecuciones
        # vivas antes de arrancar otra (pipeline/jobs.py `_hay_sitio`). Sin este
        # permiso el conteo revienta y el freno falla ABIERTO — que es lo que
        # debe hacer, pero entonces no frena nada y solo se ve en los logs.
        fn.add_to_role_policy(iam.PolicyStatement(
            actions=["states:ListExecutions"],
            resources=[producir_sm.state_machine_arn]))
        fn.add_to_role_policy(iam.PolicyStatement(
            actions=["ssm:GetParameter", "ssm:GetParameters", "ssm:GetParametersByPath"],
            resources=[f"arn:aws:ssm:{self.region}:{self.account}:parameter{e.ssm_env}*",
                       f"arn:aws:ssm:{self.region}:{self.account}:parameter{e.ssm_usuarios}*"]))
        # M23 C: el usuario conecta y quita SU clave de Blotato desde la web
        # (server/blotato_api.py). Solo ese nombre: la API no puede escribir
        # la CLAUDE_API_KEY de nadie ni las claves de plataforma. El cifrado
        # usa la llave administrada aws/ssm, que ya permite a la cuenta usarla
        # a través de SSM (igual que el GetParameter de arriba).
        fn.add_to_role_policy(iam.PolicyStatement(
            actions=["ssm:PutParameter", "ssm:DeleteParameter"],
            resources=[f"arn:aws:ssm:{self.region}:{self.account}:parameter"
                       f"{e.ssm_usuarios}/*/BLOTATO_API_KEY"]))
        # dashboard admin: horas-ACU reales de Aurora del mes (las métricas de
        # CloudWatch no soportan permisos por recurso — solo lectura)
        fn.add_to_role_policy(iam.PolicyStatement(
            actions=["cloudwatch:GetMetricStatistics"], resources=["*"]))

        http_api = apigwv2.HttpApi(
            self, "HttpApi", api_name=e.api,
            default_integration=apigw_int.HttpLambdaIntegration("Fn", fn),
        )

        # Sin dominio propio (dev), la liga de la invitación y los callbacks
        # van al execute-api de ESTE stack: nunca a los de producción.
        entrada = e.dominio_publico or http_api.api_endpoint
        pool = cognito.UserPool(
            self, "Users", user_pool_name=e.pool,
            # Protección de borrado SOLO en producción, y en el template a
            # propósito: puesta a mano desde la consola no viaja en él, así que
            # no había forma de saber si sobrevivía al siguiente update del
            # stack. Aquí la gobierna CloudFormation y la respuesta es sí.
            # Dev la lleva apagada porque un entorno de pruebas tiene que poder
            # tirarse: con ACTIVE, `cdk destroy` del stack de dev falla y hay
            # que ir a apagarla a mano antes de poder borrar nada.
            deletion_protection=e.es_prod,
            self_sign_up_enabled=False,      # alta manual mientras es piloto
            sign_in_aliases=cognito.SignInAliases(email=True),
            # M2: el email que dispara tools/usuarios.py alta — {username} y
            # {####} los rellena Cognito (correo y contraseña provisional)
            user_invitation=cognito.UserInvitationConfig(
                email_subject=("" if e.es_prod else f"[{e.nombre}] ")
                + "Bienvenid@ a la demo de editor irremplazable",
                email_body=(
                    "<p>Hola:</p>"
                    "<p>Ya tienes acceso a la demo. Entra aquí:<br>"
                    # La invitación manda al nombre propio, no al execute-api.
                    # ORDEN OBLIGATORIO: este texto solo cambia con un deploy, y
                    # ese deploy va DESPUÉS de que irremplazables.xyz resuelva y
                    # conteste 200 — si no, el correo invita a un dominio que no
                    # existe. Las invitaciones ya enviadas siguen apuntando al
                    # execute-api, que sigue vivo y sirviendo.
                    f'<a href="{entrada}">{entrada}</a></p>'
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
        # Remitente propio SIN cambiar de servicio de envío. `UserPoolEmail`
        # del CDK solo ofrece dos caminos: with_cognito (no deja poner el
        # remitente) y with_ses (EmailSendingAccount=DEVELOPER, que con SES en
        # el sandbox solo entrega a direcciones verificadas: dejaría de llegar
        # la invitación a todo el mundo). El punto medio existe en Cognito pero
        # no en el construct de alto nivel, así que va por el recurso L1:
        # COGNITO_DEFAULT + la identidad de SES como remitente. Cognito necesita
        # permiso sobre esa identidad (infra/ses-politica-remitente.json, fuera
        # del CDK): sin él este update falla y CloudFormation lo deshace.
        # Dos cosas medidas el 7-oct contra la API, que la guía no deja claras:
        # con COGNITO_DEFAULT el campo From se rechaza («Cannot configure From
        # email address for default email configuration»), y el SourceArn tiene
        # que ser el de la DIRECCIÓN: con el del dominio responde «Invalid FROM
        # email address ARN». El remitente es la dirección de ese ARN.
        if e.remitente_correo:
            pool.node.default_child.email_configuration = (
                cognito.CfnUserPool.EmailConfigurationProperty(
                    email_sending_account="COGNITO_DEFAULT",
                    source_arn=(f"arn:aws:ses:{self.region}:{self.account}"
                                f":identity/{e.remitente_correo}"),
                ))
        origenes = ([e.dominio_publico] if e.dominio_publico else []) + [
            http_api.api_endpoint, "http://localhost:8011"]
        client = pool.add_client(
            "web",
            o_auth=cognito.OAuthSettings(
                flows=cognito.OAuthFlows(authorization_code_grant=True),
                scopes=[cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL],
                # M2: el Hosted UI vuelve a callback.html (PKCE, sin secret);
                # localhost habilita probar el flujo con el server de dev
                #
                # Las TRES conviven a propósito. static/auth.js:37 y
                # static/callback.html:27 arman el redirect_uri con
                # location.origin + "/callback.html", así que esta lista tiene
                # que cubrir CADA origen desde el que alguien pueda entrar: el
                # nombre propio, el execute-api (donde están los usuarios que ya
                # tienen su liga) y localhost:8011. Quitar el execute-api de
                # aquí es exactamente lo que los deja fuera.
                callback_urls=[f"{o}/callback.html" for o in origenes],
                logout_urls=[f"{o}/" for o in origenes],
            ),
        )
        # ojo: los prefijos de dominio Cognito no admiten la palabra reservada "aws"
        # Managed Login (v2): el branding con la paleta del producto vive FUERA
        # de CloudFormation (create-managed-login-branding / editor de la
        # consola) — aquí solo se fija la versión para que un deploy no
        # regrese el dominio al Hosted UI clásico.
        pool.add_domain("Domain", cognito_domain=cognito.CognitoDomainOptions(
            domain_prefix=e.dominio_cognito),
            managed_login_version=cognito.ManagedLoginVersion.NEWER_MANAGED_LOGIN)

        # M6: el dashboard admin exige pertenecer a este grupo (el id_token lo
        # trae en cognito:groups); miembros por CLI: tools/usuarios.py admin
        cognito.CfnUserPoolGroup(
            self, "AdminGroup", user_pool_id=pool.user_pool_id,
            group_name="admin",
            description="Acceso al dashboard de costes (/admin.html)")

        # M2: con estas envs presentes, server/auth.py exige el JWT
        fn.add_environment("COGNITO_POOL_ID", pool.user_pool_id)
        fn.add_environment("COGNITO_CLIENT_ID", client.user_pool_client_id)
        # Cadena armada y no el recurso del dominio (así era antes y así se
        # queda: cambiarlo movería el template de prod). Sale del MISMO campo
        # que el domain_prefix de arriba: si solo se parametrizara aquel, dev
        # mandaría a su gente al Hosted UI de producción y «funcionaría».
        fn.add_environment(
            "COGNITO_DOMINIO",
            f"{e.dominio_cognito}.auth.{self.region}.amazoncognito.com")

        # UI·18 (dev): las URLs viejas mandan a las pantallas nuevas en dev,
        # sin tocar las etapas de server/migracion.py (esas llegan a main con
        # el código). Solo fuera de prod: el template de prod no cambia.
        if not e.es_prod:
            fn.add_environment("UI_ETAPA_MINIMA", "todos")

        cdk.CfnOutput(self, "ApiUrl", value=http_api.api_endpoint)
        # El nombre propio al lado del técnico, para que el output del deploy
        # diga las dos verdades: por dónde entra la gente y por dónde sigue
        # entrando quien tenga la liga vieja.
        if e.dominio_publico:
            cdk.CfnOutput(self, "DominioPublico", value=e.dominio_publico)
        cdk.CfnOutput(self, "UserPoolId", value=pool.user_pool_id)
        cdk.CfnOutput(self, "UserPoolClientId", value=client.user_pool_client_id)
