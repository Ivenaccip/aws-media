"""C2 — estado: Aurora Serverless v2 Postgres con Data API habilitado.

En **prod**, mínimo 0.5 ACU y SIN auto-pausa. En **dev**, lo contrario: mínimo 0
y auto-pausa a los 5 min, porque ahí el suelo permanente es todo el coste del
entorno y un despertar de ~25 s con un solo usuario es aceptable. Las cuatro
diferencias (suelo, auto-pausa, protección de borrado y qué pasa al destruir el
stack) salen de `entorno.es_prod` y nada más; el resto es idéntico. La Lambda queda FUERA de la VPC (HANDOFF §3): habla por el
endpoint HTTPS de rds-data, así que la VPC solo tiene subredes aisladas y CERO
NAT Gateways (exclusión deliberada del plan).

Coste: 0.5 ACU permanentes (~$0.12/ACU-hora ⇒ ~$44/mes) + almacenamiento
(~$0.10/GB-mes, centavos con este volumen) + el secreto del master en Secrets
Manager ($0.40/mes). Tope 2 ACU. Ese tope es el único freno duro de gasto del
producto: el Budget avisa, no frena.

Aquí viven los datos de los usuarios: proyectos, saldos y movimientos de
créditos. No hay otra copia. Las dos guardas de abajo —protección de borrado y
ventana de backups— son lo único que separa un error de una pérdida definitiva,
y por eso `tests/test_db_protegida.py` las fija."""
import aws_cdk as cdk
from aws_cdk import Stack, aws_ec2 as ec2, aws_rds as rds
from constructs import Construct

from entornos import PROD, Entorno


class DbStack(Stack):
    def __init__(self, scope: Construct, id_: str, *,
                 entorno: Entorno = PROD, **kwargs) -> None:
        super().__init__(scope, id_, **kwargs)
        # El default es PROD y reproduce el clúster vivo tal cual. Lo que
        # cambia en dev son las cuatro decisiones de abajo, y ninguna otra.
        e = entorno

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
                # El tercer campo de `of()` NO viaja al template: le dice
                # al CDK si esta versión admite la auto-pausa, y sin él un
                # `serverless_v2_min_capacity=0` no pasa la validación del
                # synth. 16.14 la admite (Aurora PostgreSQL la trae desde la
                # 16.3). Va detrás de `es_prod` para que la composición de
                # producción siga siendo la misma llamada de antes.
                version=rds.AuroraPostgresEngineVersion.of("16.14", "16")
                if e.es_prod else rds.AuroraPostgresEngineVersion.of(
                    "16.14", "16", serverless_v2_auto_pause_supported=True)),
            writer=rds.ClusterInstance.serverless_v2("writer"),
            # min 0.5 y NO 0: con 0 el clúster se auto-pausa a los ~5 min y la
            # siguiente petición paga el despertar —medido: ~25 s, o un 503 si
            # cae dentro de los 29 s de API Gateway. Con tráfico de 7 personas
            # eso pasaba a diario en la pantalla de inicio. 0.5 ACU permanentes
            # cuestan ~$0.06/hora (~$44/mes) y compran que /api/creditos no
            # empiece por un arranque. Volver a 0 es una línea y no pierde datos.
            serverless_v2_min_capacity=0.5 if e.es_prod else 0,
            # …y en dev justo lo contrario, por decisión del dueño (27-sep):
            # min 0 + auto-pausa. Dormido no paga cómputo, que es lo que vuelve
            # a dev casi gratis frente a los $43.80 dólares al mes del suelo de
            # producción. Se paga con ~25 s de despertar en el primer acceso.
            #
            # La ventana son los 5 min del default, decidido por el dueño el
            # 28-sep: «solo lo usaré pocas veces para ver los cambios». Se
            # consideró una hora para que el despertar no cayera en medio de la
            # sesión, y se descartó justamente por eso — no hay sesiones largas
            # que proteger, hay vistazos sueltos, y entre vistazo y vistazo una
            # hora de suelo es suelo que se paga sin que nadie esté mirando.
            #
            # Va escrito y no omitido aunque coincida con el default: así el
            # `cdk diff` lo enseña, y el test de abajo lo fija. Un default que
            # cambie en una versión del CDK no puede moverlo en silencio.
            serverless_v2_auto_pause_duration=(
                None if e.es_prod else cdk.Duration.minutes(5)),
            # 1 -> 2 el 2026-09-21: con 7 usuarios el clúster ya pegaba en el
            # techo a diario (CPU con máximos de 432-497%, ACUUtilization contra
            # el 100%) y /api/creditos daba p95 de 17.9 s. A 2 y NO a 4: este
            # tope es hoy el ÚNICO freno duro de gasto del producto —el Budget
            # avisa, no frena— y nadie ha medido lo que cuestan 4 ACU sostenidas.
            serverless_v2_max_capacity=2,
            vpc=vpc,
            vpc_subnets=ec2.SubnetSelection(subnet_type=ec2.SubnetType.PRIVATE_ISOLATED),
            enable_data_api=True,
            default_database_name="media",
            # Si el stack se borra, queda un snapshot final — los datos no se
            # pierden y el clúster no sigue cobrando.
            #
            # En dev no: ahí lo que hay son pruebas, y un snapshot de pruebas
            # es almacenamiento que se paga para siempre por algo que nadie va
            # a restaurar nunca. `cdk destroy` de dev se lleva su base y ya.
            removal_policy=(cdk.RemovalPolicy.SNAPSHOT if e.es_prod
                            else cdk.RemovalPolicy.DESTROY),
            # …pero esa política solo cubre el camino de CloudFormation. Un
            # `aws rds delete-db-cluster`, o un clic en la consola, se lleva el
            # clúster igual y no pasa por aquí. Esto cierra esa puerta: para
            # borrarlo de verdad hay que ponerlo en False y desplegar primero,
            # que es exactamente la pausa que se quiere.
            #
            # Dev la lleva apagada, igual que su pool de Cognito: un entorno de
            # pruebas tiene que poder tirarse, y con ACTIVE el `cdk destroy` del
            # stack de dev falla y hay que ir a apagarla a mano antes.
            deletion_protection=e.es_prod,
            # Estaba en el default de 1 día: un error de datos del viernes ya no
            # tenía arreglo el lunes. El volumen son 53 MB (medido 2026-09-14) y
            # AWS incluye el almacenamiento de backup hasta el tamaño del
            # clúster, así que ampliar la ventana no mueve la factura. La franja
            # horaria (09:46-10:16 UTC, madrugada aquí) se deja como está.
            backup=rds.BackupProps(retention=cdk.Duration.days(7)),
        )

        cdk.CfnOutput(self, "ClusterArn", value=self.cluster.cluster_arn)
        cdk.CfnOutput(self, "SecretArn", value=self.cluster.secret.secret_arn)
