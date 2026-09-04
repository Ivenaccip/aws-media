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

SSM_PREFIX = "/media-ivenaccip/env"   # "aws*" es prefijo reservado en SSM
SSM_USUARIOS = "/media-ivenaccip/usuarios"   # C5: claves POR-USUARIO (D4)


class JobsStack(Stack):
    def __init__(self, scope: Construct, id_: str, *,
                 cluster_db: rds.DatabaseCluster, media_bucket: s3.Bucket,
                 cdn_domain: str, image_ref: str = "latest", **kwargs) -> None:
        super().__init__(scope, id_, **kwargs)

        repo = ecr.Repository.from_repository_name(self, "Repo", "aws-media")
        env_comun = {
            "STATE_BACKEND": "postgres",
            "DB_CLUSTER_ARN": cluster_db.cluster_arn,
            "DB_SECRET_ARN": cluster_db.secret.secret_arn,
            "DB_NAME": "media",
            "MEDIA_BUCKET": media_bucket.bucket_name,
            "CDN_BASE": f"https://{cdn_domain}",
            "SSM_ENV_PREFIX": SSM_PREFIX,
            "SSM_USUARIOS_PREFIX": SSM_USUARIOS,
            "CREDITOS_BACKEND": "postgres",   # C5: monedero + devoluciones
            "WORK_DIR": "/tmp/work",
            "MEDIA_ROOT": "/tmp/media",
            "HOME": "/tmp",
            "PYTHONIOENCODING": "utf-8",
        }

        def dar_permisos(role: iam.IRole) -> None:
            cluster_db.grant_data_api_access(role)
            media_bucket.grant_put(role)    # sin delete: las versiones no se borran
            media_bucket.grant_read(role)
            role.add_to_principal_policy(iam.PolicyStatement(
                actions=["ssm:GetParameter", "ssm:GetParameters",
                         "ssm:GetParametersByPath"],
                resources=[f"arn:aws:ssm:{self.region}:{self.account}:parameter{SSM_PREFIX}*",
                           f"arn:aws:ssm:{self.region}:{self.account}:parameter{SSM_USUARIOS}*"]))

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
            environment=env_comun,
            # C6: retención corta — el log group auto-creado vive para siempre
            log_retention=logs.RetentionDays.ONE_WEEK,
        )
        # max_concurrency=2: pocos workers a la vez (la cuota de la cuenta es 10
        # y preparar pega a APIs con rate limits)
        worker.add_event_source(event_sources.SqsEventSource(
            self.queue, batch_size=1, max_concurrency=2))
        dar_permisos(worker.role)

        # M6: sync diario de costes Langfuse → tabla `costes` (la base del
        # dashboard admin). El worker detecta el input sin "Records" y corre
        # tools/costes.sincronizar; es idempotente por trace id.
        events.Rule(
            self, "SyncCostes",
            schedule=events.Schedule.cron(minute="0", hour="6"),   # 06:00 UTC diario
            targets=[targets.LambdaFunction(
                worker, event=events.RuleTargetInput.from_object(
                    {"tipo": "sync_costes", "dias": 3}))],
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
            self, "ProducirSm", state_machine_name="aws-media-producir",
            definition_body=sfn.DefinitionBody.from_chainable(correr),
            timeout=Duration.hours(2),
        )

        cdk.CfnOutput(self, "QueueUrl", value=self.queue.queue_url)
        cdk.CfnOutput(self, "StateMachineArn", value=self.state_machine.state_machine_arn)
