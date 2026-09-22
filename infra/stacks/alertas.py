"""Avisos de CloudWatch. Stack AISLADO a propósito.

Cero imports de otros stacks, cero dependencias cruzadas, todas las dimensiones
son ids físicos literales. Su plantilla solo contiene SNS + Alarm + MetricFilter,
así que desplegarlo nunca arrastra la base de datos — `cdk deploy aws-media-api`
sí lo hace: «Including dependency stacks: aws-media-db, aws-media-media».

Los umbrales salen de 14 días de métricas reales con 5 testers, no de números
redondos: una alarma que suena a diario no la lee nadie, y una que no suena
nunca tampoco sirve. Cada `alarm_description` lleva el dato que justifica su
umbral y qué mirar primero al recibirla.

`treat_missing_data=NOT_BREACHING` en todas: la cobertura real de las series va
del 8% al 89% —el API solo tiene tráfico en el 8% de las ventanas de 5 min—, así
que sin fijarlo los conteos «M de N» no son reproducibles. Contrapartida que hay
que conocer: una dimensión que deje de existir NO cae en INSUFFICIENT_DATA, se
queda en OK y la alarma se vuelve ciega en silencio. Por eso el runbook manda
re-verificar los ids tras cualquier deploy que pueda reemplazar un recurso.
"""
import aws_cdk as cdk
from aws_cdk import (Duration, Stack,
                     aws_cloudwatch as cw,
                     aws_cloudwatch_actions as cw_actions,
                     aws_logs as logs,
                     aws_sns as sns,
                     aws_sns_subscriptions as subs)
from constructs import Construct

# Ids físicos verificados contra la cuenta el 2026-09-14. Van literales y no
# importados de los otros stacks para que este template no pueda arrastrarlos.
CLUSTER = "aws-media-db-db5d02a0a9-luualrjywhm7"
API_ID = "2ecset5i94"
FN_API = "aws-media-api-ApiF70053CD-YeW12ZJZWsRm"
COLA = "aws-media-jobs-JobsDF1CC2D4-jhEweLCOheGK"
DLQ = "aws-media-jobs-JobsDlqB53173A1-PqG2S7vwB01s"
SM_ARN = "arn:aws:states:us-east-1:191241816158:stateMachine:aws-media-producir"
LOG_API = f"/aws/lambda/{FN_API}"

P5 = Duration.minutes(5)


class AlertasStack(Stack):
    """Las siete alarmas que convierten «algo va mal» en un correo accionable.

    `vigilar_init` arma la octava, la del arranque en frío: hoy estaría
    permanentemente en ALARM (71 de 71 intentos de init terminan en timeout),
    así que la métrica se publica ya —gratis, y pone el número en una gráfica—
    pero la alarma se arma como detector de regresión cuando el init vuelva a
    caber en su ventana.
    """

    def __init__(self, scope: Construct, id_: str, *, correos: list[str],
                 vigilar_init: bool = False, **kwargs) -> None:
        super().__init__(scope, id_, **kwargs)

        if not correos:
            raise ValueError("sin destinatarios, las siete alarmas disparan al vacío")

        topic = sns.Topic(self, "Alertas", topic_name="aws-media-alertas",
                          display_name="aws-media")
        # PASO MANUAL OBLIGATORIO, y por cada dirección: la suscripción nace en
        # PendingConfirmation y CloudFormation reporta CREATE_COMPLETE igual.
        # Sin el clic en el correo, esa dirección no recibe nada. El gate está
        # en docs/OPERACION.md.
        for correo in correos:
            topic.add_subscription(subs.EmailSubscription(correo))
        accion = cw_actions.SnsAction(topic)

        def alarma(cid: str, metrica: cw.Metric, *, umbral: float,
                   periodos: int, desc: str) -> cw.Alarm:
            a = cw.Alarm(
                self, cid, metric=metrica, threshold=umbral,
                evaluation_periods=periodos, datapoints_to_alarm=periodos,
                comparison_operator=(cw.ComparisonOperator
                                     .GREATER_THAN_OR_EQUAL_TO_THRESHOLD),
                treat_missing_data=cw.TreatMissingData.NOT_BREACHING,
                alarm_description=desc)
            a.add_alarm_action(accion)
            a.add_ok_action(accion)   # el «ya pasó» también es información
            return a

        # 1) La única que mide daño al usuario. Medido en 14 días: 66 respuestas
        #    5xx frente a 9 `Errors` de la Lambda — contar solo los Errors deja
        #    ciego al 86%, porque una invocación throttleada da 5xx sin contar
        #    como error de la función.
        alarma("Api5xx", cw.Metric(
            namespace="AWS/ApiGateway", metric_name="5xx",
            dimensions_map={"ApiId": API_ID}, statistic="Sum", period=P5),
            umbral=5, periodos=1,
            desc="5xx del API >=5 en 5 min. DIAGNOSTICO EN ESTE ORDEN: "
                 "1) Throttles y ConcurrentExecutions de la MISMA ventana (en "
                 "UTC), 2) INIT_REPORT en el log group, 3) ACUUtilization AL "
                 "FINAL. Los dos incidentes con throttles tenian Aurora al 30%: "
                 "culpar a la base de datos manda al sitio equivocado. "
                 "Calibrada con 5 testers — RETARAR el 2026-09-24.")

        # 2) Un throttle es una peticion perdida: el usuario ve un error.
        alarma("ApiThrottles", cw.Metric(
            namespace="AWS/Lambda", metric_name="Throttles",
            dimensions_map={"FunctionName": FN_API}, statistic="Sum", period=P5),
            umbral=1, periodos=1,
            desc="Throttle del API = peticion perdida. Causa: la cuota de "
                 "concurrencia de la CUENTA (L-B99A9384), hoy en 1000 "
                 "(verificado por API el 2026-09-21; estuvo en 10 y esta "
                 "descripcion lo siguio citando). NO subir max_concurrency de "
                 "jobs.py:97 como remedio sin mirar antes esta alarma: el "
                 "worker come de esa misma cuota y le roba concurrencia al API. "
                 "Medido: 5 throttles en 14 dias con 5 testers y cuota 10.")

        # 3) El aviso PREVIO al throttle, y por eso se tara CONTRA LA CUOTA, no
        #    contra un numero absoluto. Con cuota 10 el umbral era 8; con la
        #    cuota en 1000 ese mismo 8 disparo 23 veces en 7 dias con 7 usuarios
        #    —ruido puro, y ruido que entrena la bandeja a ignorar el remitente
        #    justo antes de abrir a 182. 650 = 65% de la cuota: deja margen para
        #    reaccionar y hoy no lo toca ni de lejos.
        #    `1 de 1` se conserva: un pico de concurrencia dura segundos, y con
        #    `2 de 2` esta alarma no dispararia nunca por construccion.
        alarma("ConcurrenciaCuenta", cw.Metric(
            namespace="AWS/Lambda", metric_name="ConcurrentExecutions",
            statistic="Maximum", period=P5),        # sin dimensiones = la cuenta
            umbral=650, periodos=1,
            desc="Concurrencia de CUENTA >=650 de 1000. Es el techo real del "
                 "producto: API y worker comparten esa cuota, y cada arranque "
                 "en frio ocupa un hueco 16 s. Al recibirla: mira ApiThrottles "
                 "de la MISMA ventana y la profundidad de la cola. Retarada el "
                 "2026-09-21 al subir la cuota de 10 a 1000. RETARAR de nuevo "
                 "tras la primera semana con 182 usuarios.")

        # 4) Average y no Maximum: con Maximum rompe el 80% en 229 de 3.587
        #    periodos. Y 3 de 3 por un pico diario de UN solo datapoint hacia
        #    las 00:03Z, presente 10 de los 14 dias.
        alarma("AuroraTecho", cw.Metric(
            namespace="AWS/RDS", metric_name="ACUUtilization",
            dimensions_map={"DBClusterIdentifier": CLUSTER},
            statistic="Average", period=P5),
            umbral=80, periodos=3,
            desc="Aurora >=80% de su techo durante 15 min. ACUUtilization se "
                 "autonormaliza contra serverless_v2_max_capacity, asi que el "
                 "80% sigue significando 'pegada al techo' si el techo sube. El "
                 "techo ya subio de 1 a 2 ACU el 2026-09-21. NO subirlo a 4 sin "
                 "medir antes el coste: ese tope es el unico freno duro de gasto "
                 "que existe, y cuatro ACU sostenidas rondan los ~350 dolares al "
                 "mes. Mira primero si el consumo viene de una ruta concreta.")

        # 5) Cero mensajes en 14 dias: cualquiera que aparezca es real.
        alarma("DlqConMensajes", cw.Metric(
            namespace="AWS/SQS", metric_name="ApproximateNumberOfMessagesVisible",
            dimensions_map={"QueueName": DLQ}, statistic="Maximum", period=P5),
            umbral=1, periodos=1,
            desc="Mensaje en la DLQ = trabajo de un usuario perdido tras sus "
                 "reintentos (jobs.py:79). Medido: 0 en 14 dias, asi que no "
                 "hay falsos positivos que temer.")

        # 6) 1200 s es 4,6x el peor caso medido (259 s): no suena hoy, y avisa
        #    cuando max_concurrency=2 deje de dar abasto con 166 usuarios.
        alarma("ColaAtascada", cw.Metric(
            namespace="AWS/SQS", metric_name="ApproximateAgeOfOldestMessage",
            dimensions_map={"QueueName": COLA}, statistic="Maximum", period=P5),
            umbral=1200, periodos=3,
            desc="El mensaje mas viejo lleva >20 min esperando, durante 15 min. "
                 "Maximo medido en 14 dias: 259 s. Causa probable con 166 "
                 "usuarios: max_concurrency=2 (jobs.py:97) — pero mira "
                 "ApiThrottles ANTES de subirlo, comparten cuota.")

        # 7) `>=1` y no `>=3 por hora`: con 16 ejecuciones en 14 dias, un umbral
        #    por hora no dispararia nunca pese a un 19% de produccciones rotas.
        alarma("ProduccionFallida", cw.Metric(
            namespace="AWS/States", metric_name="ExecutionsFailed",
            dimensions_map={"StateMachineArn": SM_ARN},
            statistic="Sum", period=P5),
            umbral=1, periodos=1,
            desc="Produccion fallida. Medido en 14 dias: 3 de 16 ejecuciones, "
                 "un 19% de tasa de fallo que nadie estaba viendo. Tres avisos "
                 "en 14 dias es soportable hoy; RETARAR a una TASA el "
                 "2026-09-24, con 20-60 producciones al dia.")

        # 8) La metrica del arranque en frio. Publicarla es gratis y pone el
        #    numero en una grafica; la alarma solo tiene sentido cuando el init
        #    vuelva a caber (hoy serian 71 de 71 y viviria en ALARM).
        lg = logs.LogGroup.from_log_group_name(self, "LogApi", LOG_API)
        logs.MetricFilter(
            self, "InitTimeouts", log_group=lg,
            filter_pattern=logs.FilterPattern.all_terms(
                "INIT_REPORT", "Status: timeout"),
            metric_namespace="aws-media/InitTimeouts",
            metric_name="InitTimeout", metric_value="1", default_value=0)

        if vigilar_init:
            alarma("InitTimeoutRegresion", cw.Metric(
                namespace="aws-media/InitTimeouts", metric_name="InitTimeout",
                statistic="Sum", period=Duration.hours(1)),
                umbral=5, periodos=1,
                desc="El arranque en frio volvio a no caber en los 10 s del "
                     "init de Lambda. Detector de REGRESION: armar solo "
                     "despues de partir la imagen.")

        cdk.CfnOutput(self, "TopicArn", value=topic.topic_arn)
