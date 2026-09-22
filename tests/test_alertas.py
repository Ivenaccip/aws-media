"""El stack de avisos, y la propiedad que lo hace seguro: no toca producción.

`cdk deploy aws-media-api` arrastra la base de datos — la salida del diff lo dice
literalmente: «Including dependency stacks: aws-media-db, aws-media-media». Por
eso las alarmas viven en su propio stack y en su propia `cdk.App()`: para que
desplegarlas no pueda meter al clúster Aurora en el radio de una actualización.

Este archivo fija esa propiedad. Si alguien importa aquí un stack de producción
para tomar prestada una referencia —que es la forma natural de escribirlo y la
razón por la que está prohibido— el primer test lo dice.

`aws_cdk` no viaja en la imagen Docker (Dockerfile:58 instala solo
requirements.txt; el CDK está en infra/requirements.txt), así que dentro del
contenedor estos tests se saltan solos.
"""
import sys
from pathlib import Path

import pytest

pytest.importorskip("aws_cdk", reason="aws_cdk vive en infra/requirements.txt, no en la imagen")

import aws_cdk as cdk  # noqa: E402

RAIZ = Path(__file__).resolve().parent.parent
if str(RAIZ / "infra") not in sys.path:
    sys.path.insert(0, str(RAIZ / "infra"))


def _plantilla(correos=("pruebas@ejemplo.invalid",), **kwargs) -> dict:
    from stacks.alertas import AlertasStack
    app = cdk.App()
    AlertasStack(app, "aws-media-alertas",
                 env=cdk.Environment(account="191241816158", region="us-east-1"),
                 correos=list(correos), **kwargs)
    return app.synth().get_stack_by_name("aws-media-alertas").template


def _alarmas(t: dict) -> dict:
    """Indexadas por el id del construct.

    CloudFormation le pega un hash al logical id (`Api5xx` -> `Api5xx3D9EE91A`),
    así que la clave del template no sirve para buscar por nombre.
    """
    salida = {}
    for clave, r in t["Resources"].items():
        if r["Type"] != "AWS::CloudWatch::Alarm":
            continue
        salida[clave[:-8] if len(clave) > 8 else clave] = r   # fuera el hash
    return salida


# ---------------------------------------------------------------------------
# la propiedad que lo hace seguro

def test_no_contiene_ni_un_recurso_de_produccion():
    """Lo único que puede aparecer aquí es superficie de aviso."""
    permitidos = {"AWS::CloudWatch::Alarm", "AWS::Logs::MetricFilter",
                  "AWS::SNS::Topic", "AWS::SNS::Subscription"}
    tipos = {r["Type"] for r in _plantilla()["Resources"].values()}
    assert tipos <= permitidos, f"se coló un recurso que no es de aviso: {tipos - permitidos}"


def test_el_log_group_se_importa_nunca_se_crea():
    """El log group del API lo crea el Custom::LogRetention de api.py:46.

    Declararlo aquí como recurso haría que CloudFormation se lo disputara al
    stack del API — y el perdedor se lleva los logs.
    """
    tipos = [r["Type"] for r in _plantilla()["Resources"].values()]
    assert "AWS::Logs::LogGroup" not in tipos


# ---------------------------------------------------------------------------
# que las alarmas realmente avisen

def test_las_siete_alarmas_estan():
    assert len(_alarmas(_plantilla())) == 7


def test_todas_notifican_al_tema():
    """Una alarma sin acción cambia de color en una consola que nadie mira."""
    t = _plantilla()
    for nombre, a in _alarmas(t).items():
        props = a["Properties"]
        assert props.get("AlarmActions"), f"{nombre} no avisa a nadie al saltar"
        assert props.get("OKActions"), f"{nombre} no avisa de que ya pasó"


def test_todas_tratan_el_hueco_como_sano():
    """El API solo tiene tráfico en el 8% de las ventanas de 5 min: sin fijar
    esto, los conteos «M de N» dependen de si hubo datos, y no son reproducibles."""
    for nombre, a in _alarmas(_plantilla()).items():
        assert a["Properties"].get("TreatMissingData") == "notBreaching", nombre


def test_todas_explican_su_umbral():
    """La descripción es lo único que el operador tiene a las 3 de la mañana."""
    for nombre, a in _alarmas(_plantilla()).items():
        desc = a["Properties"].get("AlarmDescription", "")
        assert len(desc) > 80, f"{nombre} no explica qué hacer: {desc!r}"


# ---------------------------------------------------------------------------
# las decisiones de diseño que costaron medirse

def test_la_concurrencia_se_mide_en_toda_la_cuenta():
    """Sin dimensiones a propósito: la cuota es de la CUENTA, y el worker la
    comparte con el API. Con FunctionName solo veríamos media película."""
    a = _alarmas(_plantilla())["ConcurrenciaCuenta"]["Properties"]
    assert not a.get("Dimensions"), "con dimensiones deja de medir la cuota real"
    assert a["DatapointsToAlarm"] == 1, (
        "con 2 de 2 no dispara nunca: un pico de concurrencia dura segundos")


def test_el_umbral_de_concurrencia_va_tarado_a_la_cuota_vigente():
    """Este umbral es una FRACCIÓN de la cuota, no un número absoluto.

    Nació como «8 de 10». La cuota pasó a 1000 (verificado por API el
    2026-09-21) y el 8 se quedó: disparó 23 veces en 7 días con 7 usuarios,
    mientras Api5xx, ApiThrottles y AuroraTecho llevaban 0. El daño de una
    alarma así no es el ruido, es que entrena la bandeja a ignorar el remitente
    —y el 5xx de verdad llega a un buzón ya sordo.

    El rango de abajo es el que mantiene el aviso ANTES del throttle sin que
    suene a diario. Si vuelve a caer fuera, la cuota cambió y toca retarar.
    """
    umbral = _alarmas(_plantilla())["ConcurrenciaCuenta"]["Properties"]["Threshold"]
    assert 500 <= umbral <= 800, (
        f"umbral {umbral} sobre una cuota de 1000: fuera del 50-80% no es un "
        "aviso previo al throttle, es ruido (si es bajo) o llega tarde (si es alto)")


def test_aurora_se_mide_en_media_no_en_maximo():
    """Con Maximum rompe el 80% en 229 de 3.587 periodos — ruido diario."""
    a = _alarmas(_plantilla())["AuroraTecho"]["Properties"]
    assert a["Statistic"] == "Average"
    assert a["DatapointsToAlarm"] == 3, (
        "3 de 3 por el pico diario de un solo datapoint hacia las 00:03Z")


def test_los_5xx_se_miden_en_api_gateway_no_en_lambda():
    """Contar solo `Errors` de la Lambda deja ciego al 86%: una invocación
    throttleada devuelve 5xx sin contar como error de la función."""
    a = _alarmas(_plantilla())["Api5xx"]["Properties"]
    assert a["Namespace"] == "AWS/ApiGateway"
    assert a["MetricName"] == "5xx"


# ---------------------------------------------------------------------------
# la octava, la del arranque en frío

def test_la_metrica_del_init_se_publica_siempre():
    """Publicarla es gratis y pone el número en una gráfica."""
    t = _plantilla()
    filtros = [r for r in t["Resources"].values()
               if r["Type"] == "AWS::Logs::MetricFilter"]
    assert len(filtros) == 1
    assert filtros[0]["Properties"]["MetricTransformations"][0]["MetricNamespace"] \
        == "aws-media/InitTimeouts"


def test_la_alarma_del_init_nace_desarmada():
    """Hoy el init falla 71 de 71 veces: armada viviría en ALARM sin informar
    de nada. Solo tiene sentido como detector de regresión, tras partir la imagen."""
    assert "InitTimeoutRegresion" not in _alarmas(_plantilla())
    assert "InitTimeoutRegresion" in _alarmas(_plantilla(vigilar_init=True))


# ---------------------------------------------------------------------------
# los destinatarios

def test_una_suscripcion_por_correo():
    """La cuenta de AWS se dio de alta con un correo y el proyecto se sigue
    desde otro: si solo suscribimos uno, las alarmas llegan a la bandeja que
    nadie abre."""
    t = _plantilla(correos=["uno@ejemplo.invalid", "dos@ejemplo.invalid"])
    subs_ = [r["Properties"]["Endpoint"] for r in t["Resources"].values()
             if r["Type"] == "AWS::SNS::Subscription"]
    assert sorted(subs_) == ["dos@ejemplo.invalid", "uno@ejemplo.invalid"]


def test_sin_destinatarios_no_se_sintetiza():
    """Un stack de avisos sin nadie a quien avisar pasa el deploy en verde y no
    sirve para nada: mejor que falle aquí."""
    with pytest.raises(ValueError, match="dispar"):
        _plantilla(correos=[])


def test_el_despliegue_real_avisa_a_los_dos():
    """La app que se despliega de verdad, no solo el stack en abstracto."""
    fuente = (RAIZ / "infra" / "app_alertas.py").read_text(encoding="utf-8")
    assert "ivenaccip@gmail.com" in fuente
    assert "developer.leonardomedina@gmail.com" in fuente
