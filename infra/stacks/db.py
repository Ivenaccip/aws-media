"""C2 — estado: Aurora Serverless v2 Postgres con mínimo 0 ACU (auto-pausa a los
~5 min sin tráfico) y Data API habilitado. La Lambda queda FUERA de la VPC
(HANDOFF §3): habla por el endpoint HTTPS de rds-data, así que la VPC solo tiene
subredes aisladas y CERO NAT Gateways (exclusión deliberada del plan).

Coste en reposo: almacenamiento (~$0.10/GB-mes, centavos con este volumen) +
el secreto del master en Secrets Manager ($0.40/mes). Activo: desde 0.5 ACU
(~$0.12/ACU-hora), tope 1 ACU."""
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
        )

        cdk.CfnOutput(self, "ClusterArn", value=self.cluster.cluster_arn)
        cdk.CfnOutput(self, "SecretArn", value=self.cluster.secret.secret_arn)
