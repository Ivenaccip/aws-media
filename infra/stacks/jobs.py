"""C4 — trabajos: SQS + los tres ejecutores con la MISMA imagen de ECR.

  1. Worker Lambda (contenedor) — trabajos <10 min: preparar (research/guion/
     personaje). Consume la cola; el progreso viaja por Postgres.
  2. Fargate (4 vCPU / 8 GB) — producciones y renders largos, sin límite de
     15 min. VPC propia con SOLO subredes públicas (IP pública por tarea =
     internet directo sin NAT Gateway, exclusión deliberada del plan); habla
     con Aurora por Data API (HTTPS) y con S3, así que no toca la VPC de la DB.
  3. Step Functions Standard — orquesta la producción (regla dura: producciones
     SIEMPRE por SFN). Hoy es un solo paso RunTask.sync; la descomposición en
     wait states (que no cobran cómputo) queda registrada como optimización.

Claves de API: SecureString bajo /aws-media/env (tools/ssm_env.py); los
ejecutores las cargan al arrancar. Coste en reposo ≈ $0 (cola, SFN, clúster
ECS y logs solo cobran por uso)."""
import aws_cdk as cdk
from aws_cdk import (
    Duration, Stack,
    aws_ec2 as ec2,
    aws_ecr as ecr,
    aws_ecs as ecs,
    aws_events as events,
    aws_events_targets as targets,
    aws_iam as iam,
    aws_lambda as lambda_,
    aws_lambda_event_sources as event_sources,
    aws_logs as logs,
    aws_rds as rds,
    aws_s3 as s3,
    aws_sqs as sqs,
    aws_stepfunctions as sfn,
    aws_stepfunctions_tasks as tasks,
)
from constructs import Construct

from entornos import PROD, Entorno


class JobsStack(Stack):
    def __init__(self, scope: Construct, id_: str, *,
                 cluster_db: rds.DatabaseCluster, media_bucket: s3.Bucket,
                 cdn_domain: str, image_ref: str = "latest",
                 entorno: Entorno = PROD, **kwargs) -> None:
        super().__init__(scope, id_, **kwargs)
        # Nombres físicos desde infra/entornos.py; el default reproduce prod.
        # "aws*" es prefijo reservado en SSM; ssm_usuarios = claves
        # POR-USUARIO (C5, D4).
        ssm_env = entorno.ssm_env
        ssm_usuarios = entorno.ssm_usuarios

        repo = ecr.Repository.from_repository_name(self, "Repo", "aws-media")
        env_comun = {
            "STATE_BACKEND": "postgres",
            "DB_CLUSTER_ARN": cluster_db.cluster_arn,
            "DB_SECRET_ARN": cluster_db.secret.secret_arn,
            "DB_NAME": "media",
            "MEDIA_BUCKET": media_bucket.bucket_name,
            "CDN_BASE": f"https://{cdn_domain}",
            "SSM_ENV_PREFIX": ssm_env,
            "SSM_USUARIOS_PREFIX": ssm_usuarios,
            "CREDITOS_BACKEND": "postgres",   # C5: monedero + devoluciones
            "WORK_DIR": "/tmp/work",
            "MEDIA_ROOT": "/tmp/media",
            "HOME": "/tmp",
            "PYTHONIOENCODING": "utf-8",
            "LANGFUSE_PROMPTS": "1",   # M10: prompts desde Langfuse + fallback
        }

        def dar_permisos(role: iam.IRole) -> None:
            cluster_db.grant_data_api_access(role)
            media_bucket.grant_put(role)    # sin delete: las versiones no se borran
            media_bucket.grant_read(role)
            role.add_to_principal_policy(iam.PolicyStatement(
                actions=["ssm:GetParameter", "ssm:GetParameters",
                         "ssm:GetParametersByPath"],
                resources=[f"arn:aws:ssm:{self.region}:{self.account}:parameter{ssm_env}*",
                           f"arn:aws:ssm:{self.region}:{self.account}:parameter{ssm_usuarios}*"]))

        # --- 1) cola + worker de trabajos cortos -----------------------------
        dlq = sqs.Queue(self, "JobsDlq", retention_period=Duration.days(14))
        self.queue = sqs.Queue(
            self, "Jobs",
            visibility_timeout=Duration.minutes(15),   # >= timeout del worker
            dead_letter_queue=sqs.DeadLetterQueue(max_receive_count=2, queue=dlq),
        )
        worker = lambda_.DockerImageFunction(
            self, "Worker",
            code=lambda_.DockerImageCode.from_ecr(
                repo, tag_or_digest=image_ref,
                entrypoint=["/usr/local/bin/python", "-m", "awslambdaric"],
                cmd=["worker.lambda_worker.handler"],
            ),
            memory_size=3008,
            timeout=Duration.minutes(15),
            # M23 · D: el worker es el único que se encola A SÍ MISMO — el
            # reloj de MIX mira cada hora y manda a la cola el día de cada
            # campaña que toca. Sin estas dos variables `pipeline/jobs.py`
            # revienta con KeyError, y sin el grant de abajo con AccessDenied:
            # las dos, en una corrida que nadie mira.
            environment={**env_comun, "JOBS_BACKEND": "aws",
                         "JOBS_QUEUE_URL": self.queue.queue_url},
            # C6: retención corta — el log group auto-creado vive para siempre
            log_retention=logs.RetentionDays.ONE_WEEK,
        )
        # max_concurrency=2: pocos workers a la vez (la cuota de la cuenta es 10
        # y preparar pega a APIs con rate limits)
        worker.add_event_source(event_sources.SqsEventSource(
            self.queue, batch_size=1, max_concurrency=2))
        dar_permisos(worker.role)
        # add_event_source solo da permiso de CONSUMIR. El reloj de MIX escribe.
        self.queue.grant_send_messages(worker)

        # M6: sync diario de costes Langfuse → tabla `costes` (la base del
        # dashboard admin). El worker detecta el input sin "Records" y corre
        # tools/costes.sincronizar; es idempotente por trace id.
        #
        # Solo en prod: dev NO comparte el proyecto de Langfuse a propósito
        # (probar un prompt ahí exigiría mover el label `production`, o sea
        # cambiar producción en caliente y sin PR), y `tools/ssm_env.py` se
        # niega a subir esas claves a dev. Sin claves, este reloj fallaría
        # todos los días a las 06:00 UTC contra una base sin costes que
        # sincronizar: ruido diario en los logs de un entorno donde nadie mira
        # los logs, que es exactamente cómo se aprende a ignorarlos.
        if entorno.es_prod:
            events.Rule(
                self, "SyncCostes",
                schedule=events.Schedule.cron(minute="0", hour="6"),   # 06:00 UTC diario
                targets=[targets.LambdaFunction(
                    worker, event=events.RuleTargetInput.from_object(
                        {"tipo": "sync_costes", "dias": 3}))],
            )

        # M23 · D — el reloj de MIX, cada hora en punto. Cada hora y no una vez
        # al día porque la hora de publicar es la del USUARIO: las nueve de la
        # mañana en Quito y en Madrid no son el mismo instante, y con una zona
        # por campaña no hay un cron que las cubra a todas. El despachador mira
        # cuáles tocan en SU reloj y encola solo esas; publicar dos veces lo
        # impide el PRIMARY KEY de mix_corridas, no esta regla.
        #
        # Este SÍ va también en dev, al revés que el de costes, porque MIX es
        # algo que hay que poder probar. Para que fuera peligroso tendrían que
        # darse DOS cosas a la vez: campañas activas en la base de dev y la
        # clave de Blotato de un cliente real bajo `SSM_USUARIOS_PREFIX`. Lo
        # primero solo pasa si alguien siembra dev con una copia de producción
        # —por eso la tarjeta dice que no se hace— y lo segundo no puede pasar:
        # el prefijo de dev es `/media-ivenaccip-dev/usuarios` y ahí no hay
        # claves de nadie. Con la base vacía el despachador recoge cero.
        events.Rule(
            self, "MixReloj",
            schedule=events.Schedule.cron(minute="0"),   # :00 de cada hora
            targets=[targets.LambdaFunction(
                worker, event=events.RuleTargetInput.from_object(
                    {"tipo": "mix_reloj"}))],
        )

        # --- 2) Fargate para producciones/renders largos ---------------------
        vpc = ec2.Vpc(
            self, "JobsVpc", max_azs=2, nat_gateways=0,
            subnet_configuration=[ec2.SubnetConfiguration(
                name="publica", subnet_type=ec2.SubnetType.PUBLIC, cidr_mask=24)],
        )
        ecs_cluster = ecs.Cluster(self, "Ecs", vpc=vpc)
        td = ecs.FargateTaskDefinition(self, "ProducirTd",
                                       cpu=4096, memory_limit_mib=8192)
        cont = td.add_container(
            "app",
            image=ecs.ContainerImage.from_ecr_repository(repo, image_ref),
            environment=env_comun,
            logging=ecs.LogDrivers.aws_logs(
                stream_prefix="producir",
                log_retention=logs.RetentionDays.ONE_WEEK),
        )
        dar_permisos(td.task_role)

        # --- 3) Step Functions: la producción completa -----------------------
        correr = tasks.EcsRunTask(
            self, "Producir",
            integration_pattern=sfn.IntegrationPattern.RUN_JOB,   # .sync
            cluster=ecs_cluster,
            task_definition=td,
            assign_public_ip=True,
            subnets=ec2.SubnetSelection(subnet_type=ec2.SubnetType.PUBLIC),
            launch_target=tasks.EcsFargateLaunchTarget(
                platform_version=ecs.FargatePlatformVersion.LATEST),
            # SFN no acepta JsonPath dentro de un array literal: el comando
            # completo viene armado en el input (pipeline/jobs.py)
            container_overrides=[tasks.ContainerOverride(
                container_definition=cont,
                command=sfn.JsonPath.list_at("$.command"),
            )],
        )
        self.state_machine = sfn.StateMachine(
            self, "ProducirSm", state_machine_name=entorno.maquina_producir,
            definition_body=sfn.DefinitionBody.from_chainable(correr),
            timeout=Duration.hours(2),
        )

        # M23 · D (prerrequisito) — el barredor. Esta máquina de estados no
        # tiene `Catch`, y el `creditos.devolver` de cada tarea vive DENTRO del
        # contenedor: si la tarea no llega a arrancar (imagen que no se pudo
        # bajar, sin capacidad para 4 vCPU, timeout de 2 h) la ejecución muere
        # sin devolver nada y el usuario queda cobrado y sin película.
        # El evento va SIN transformar: `detail.input` ya es JSON y meterlo en
        # una plantilla de EventBridge deja comillas sin escapar.
        events.Rule(
            self, "ProduccionCaida",
            event_pattern=events.EventPattern(
                source=["aws.states"],
                detail_type=["Step Functions Execution Status Change"],
                detail={"status": ["FAILED", "TIMED_OUT", "ABORTED"],
                        "stateMachineArn": [self.state_machine.state_machine_arn]},
            ),
            targets=[targets.LambdaFunction(worker)],
        )

        # --- 4) RAG·4 · la tubería pública de /automatiza ---------------------
        # Cola y worker PROPIOS, no la cola de arriba: esa está topada a dos
        # huecos que comparten las campañas de MIX, cobradas por adelantado. Un
        # pico de curiosos anónimos no puede retrasar la publicación de las
        # nueve de alguien que ya pagó. El radio de explosión es el argumento.
        # Solo existe donde `entorno.publico` (hoy dev; prod en RAG·30).
        self.cola_publica = None
        if entorno.publico:
            self.cola_publica = self._tuberia_publica(
                repo, image_ref, cluster_db, media_bucket, cdn_domain, ssm_env,
                entorno)

        cdk.CfnOutput(self, "QueueUrl", value=self.queue.queue_url)
        cdk.CfnOutput(self, "StateMachineArn", value=self.state_machine.state_machine_arn)

    def _tuberia_publica(self, repo, image_ref: str, cluster_db, media_bucket,
                         cdn_domain: str, ssm_env: str,
                         entorno: Entorno) -> sqs.Queue:
        """Cola + worker de /automatiza, con los permisos más cortos posibles.

        El worker público corre código que atiende a cualquiera de internet,
        así que no hereda nada del de arriba: sin las claves POR-USUARIO de
        SSM, sin escribir en la cola de pago, sin el monedero, y en S3 solo
        bajo `automatiza/`. Si algún día hace falta más, se agrega aquí a la
        vista, no por compartir un rol."""
        # Tiempos: el worker corta a los 5 min y la cola no reentrega antes de
        # 6. Un mensaje que vuelve encuentra la corrida en «armando» con más de
        # 6 min y puede retomarla (db.automatiza_tomar); uno que falla tres
        # veces es un mensaje roto, no una corrida: a su propia DLQ, que no
        # dispara las alarmas del trabajo de pago.
        if not entorno.ssm_publico:
            raise ValueError(
                f"{entorno.nombre}: `publico` sin `ssm_publico` en infra/entornos.py. "
                "El worker público no carga las claves de plataforma (/env).")
        dlq = sqs.Queue(self, "PublicoDlq", retention_period=Duration.days(14))
        cola = sqs.Queue(
            self, "Publico",
            visibility_timeout=Duration.minutes(6),
            retention_period=Duration.days(1),   # una petición de ayer ya no espera a nadie
            dead_letter_queue=sqs.DeadLetterQueue(max_receive_count=3, queue=dlq),
        )
        worker = lambda_.DockerImageFunction(
            self, "WorkerPublico",
            code=lambda_.DockerImageCode.from_ecr(
                repo, tag_or_digest=image_ref,
                entrypoint=["/usr/local/bin/python", "-m", "awslambdaric"],
                cmd=["worker.publico.handler"],
            ),
            memory_size=1024,
            timeout=Duration.minutes(5),
            environment={
                "STATE_BACKEND": "postgres",
                "DB_CLUSTER_ARN": cluster_db.cluster_arn,
                "DB_SECRET_ARN": cluster_db.secret.secret_arn,
                "DB_NAME": "media",
                "MEDIA_BUCKET": media_bucket.bucket_name,
                "CDN_BASE": f"https://{cdn_domain}",
                # SOLO sus claves (capa 1): nunca el prefijo de plataforma
                "SSM_ENV_PREFIX": entorno.ssm_publico,
                "HOME": "/tmp",
                "PYTHONIOENCODING": "utf-8",
            },
            log_retention=logs.RetentionDays.ONE_WEEK,
        )
        # Cuántas corridas a la vez. Es LA perilla de carga de la ventana
        # pública: lo que no cabe espera en la cola, y eso es la fila de
        # RAG·12. 2 es el mínimo que acepta SQS; se sube en RAG·30 con el
        # tope diario ya decidido, sabiendo cuánto cuesta cada hueco.
        worker.add_event_source(event_sources.SqsEventSource(
            cola, batch_size=1, max_concurrency=2))
        cluster_db.grant_data_api_access(worker)
        media_bucket.grant_put(worker, "automatiza/*")
        media_bucket.grant_read(worker, "automatiza/*")
        # El camino exacto (GetParametersByPath se autoriza contra él) y lo que
        # cuelga debajo. Sin el `*` suelto de las demás Lambdas: `publico*`
        # alcanzaría también un `/publicoX` que nadie ha revisado.
        worker.add_to_role_policy(iam.PolicyStatement(
            actions=["ssm:GetParametersByPath"],
            resources=[
                f"arn:aws:ssm:{self.region}:{self.account}:parameter{entorno.ssm_publico}",
                f"arn:aws:ssm:{self.region}:{self.account}:parameter{entorno.ssm_publico}/*"]))
        # RAG·17: el índice del RAG, SOLO para leer. Lo crea el dueño con
        # tools/vectores.py (el CDK no trae S3 Vectors) y lo llena la ingesta
        # desde su máquina: nada que atiende a internet escribe el índice.
        # GetVectors va junto a QueryVectors porque S3 Vectors lo exige para
        # devolver metadatos o filtrar por ellos.
        if entorno.vectores_bucket and entorno.vectores_indice:
            worker.add_environment("VECTORES_BUCKET", entorno.vectores_bucket)
            worker.add_environment("VECTORES_INDICE", entorno.vectores_indice)
            worker.add_to_role_policy(iam.PolicyStatement(
                actions=["s3vectors:QueryVectors", "s3vectors:GetVectors"],
                resources=[f"arn:aws:s3vectors:{self.region}:{self.account}:bucket/"
                           f"{entorno.vectores_bucket}/index/{entorno.vectores_indice}"]))
        cdk.CfnOutput(self, "ColaPublicaUrl", value=cola.queue_url)
        return cola
