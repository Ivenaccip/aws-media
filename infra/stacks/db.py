"""C2 — estado: Aurora Serverless v2 Postgres con mínimo 0 ACU (auto-pausa a los
~5 min sin tráfico) y Data API habilitado. La Lambda queda FUERA de la VPC
(HANDOFF §3): habla por el endpoint HTTPS de rds-data, así que la VPC solo tiene
subredes aisladas y CERO NAT Gateways (exclusión deliberada del plan).

Coste en reposo: almacenamiento (~$0.10/GB-mes, centavos con este volumen) +
el secreto del master en Secrets Manager ($0.40/mes). Activo: desde 0.5 ACU
(~$0.12/ACU-hora), tope 1 ACU.

Aquí viven los datos de los usuarios: proyectos, saldos y movimientos de
créditos. No hay otra copia. Las dos guardas de abajo —protección de borrado y
ventana de backups— son lo único que separa un error de una pérdida definitiva,
y por eso `tests/test_db_protegida.py` las fija."""
import aws_cdk as cdk
from aws_cdk import Stack, aws_ec2 as ec2, aws_rds as rds
from constructs import Construct


class DbStack(Stack):
    def __init__(self, scope: Construct, id_: str, **kwargs) -> None:
        super().__init__(scope, id_, **kwargs)

        vpc = ec2.Vpc(
            self, "Vpc", max_azs=2, nat_gateways=0,
            subnet_configuration=[ec2.SubnetConfiguration(
                name="db", subnet_type=ec2.SubnetType.PRIVATE_ISOLATED, cidr_mask=24)],
        )
        self.cluster = rds.DatabaseCluster(
            self, "Db",
            # of(): las versiones menores rotan en RDS más rápido que el enum
            # del CDK (16.6 ya no existía al desplegar — verificado por API)
            engine=rds.DatabaseClusterEngine.aurora_postgres(
                version=rds.AuroraPostgresEngineVersion.of("16.14", "16")),
            writer=rds.ClusterInstance.serverless_v2("writer"),
            serverless_v2_min_capacity=0,   # 0 = auto-pausa (requiere PG >= 16.3)
            serverless_v2_max_capacity=1,
            vpc=vpc,
            vpc_subnets=ec2.SubnetSelection(subnet_type=ec2.SubnetType.PRIVATE_ISOLATED),
            enable_data_api=True,
            default_database_name="media",
            # Si el stack se borra, queda un snapshot final — los datos no se
            # pierden y el clúster no sigue cobrando.
            removal_policy=cdk.RemovalPolicy.SNAPSHOT,
            # …pero esa política solo cubre el camino de CloudFormation. Un
            # `aws rds delete-db-cluster`, o un clic en la consola, se lleva el
            # clúster igual y no pasa por aquí. Esto cierra esa puerta: para
            # borrarlo de verdad hay que ponerlo en False y desplegar primero,
            # que es exactamente la pausa que se quiere.
            deletion_protection=True,
            # Estaba en el default de 1 día: un error de datos del viernes ya no
            # tenía arreglo el lunes. El volumen son 53 MB (medido 2026-09-14) y
            # AWS incluye el almacenamiento de backup hasta el tamaño del
            # clúster, así que ampliar la ventana no mueve la factura. La franja
            # horaria (09:46-10:16 UTC, madrugada aquí) se deja como está.
            backup=rds.BackupProps(retention=cdk.Duration.days(7)),
        )

        cdk.CfnOutput(self, "ClusterArn", value=self.cluster.cluster_arn)
        cdk.CfnOutput(self, "SecretArn", value=self.cluster.secret.secret_arn)
