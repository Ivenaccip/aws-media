"""Lo único que separa un error de una pérdida definitiva.

En este clúster viven los proyectos, los saldos y los movimientos de créditos de
los usuarios. No hay otra copia: ni réplica, ni export periódico, ni un segundo
entorno del que rescatar nada.

El 14 de septiembre de 2026, con nueve días para abrir a 166 usuarios, estaba
así: `DeletionProtection` en False, backups de **un** día y cero snapshots
manuales. Estos tests fijan lo que se cambió para que no vuelva por descuido —
son propiedades que no dan la cara en el día a día, así que nadie notaría que se
han perdido hasta el día en que hicieran falta.

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


def _cluster() -> dict:
    """El recurso DBCluster del template, con sus políticas."""
    from stacks.db import DbStack
    app = cdk.App()
    DbStack(app, "aws-media-db",
            env=cdk.Environment(account="191241816158", region="us-east-1"))
    recursos = app.synth().get_stack_by_name("aws-media-db").template["Resources"]
    clusters = [r for r in recursos.values() if r["Type"] == "AWS::RDS::DBCluster"]
    assert len(clusters) == 1, f"se esperaba un clúster, hay {len(clusters)}"
    return clusters[0]


CLUSTER = _cluster()
PROPS = CLUSTER["Properties"]


def test_el_cluster_no_se_borra_con_un_solo_comando():
    """`removal_policy=SNAPSHOT` NO cubre esto.

    Esa política vive en CloudFormation y solo actúa cuando el borrado pasa por
    un `cdk destroy`. Un `aws rds delete-db-cluster` o un clic en la consola van
    directos a RDS y se lo llevan sin preguntar a CloudFormation. Son dos
    caminos distintos y hacen falta las dos guardas; quitar esta porque «ya
    está la otra» reabre el camino corto.
    """
    assert PROPS.get("DeletionProtection") is True, (
        "el clúster vuelve a poder borrarse con un comando y sin confirmación")


def test_la_ventana_de_backup_aguanta_un_fin_de_semana():
    """Con el default de 1 día, un error de datos del viernes es irrecuperable
    el lunes. La ventana tiene que ser más larga que el tiempo que puede pasar
    entre que algo se rompe y alguien lo nota."""
    dias = PROPS.get("BackupRetentionPeriod")
    assert dias is not None, "sin retención explícita se cae al default de 1 día"
    assert dias >= 7, (
        f"{dias} día(s) de backup: menos de una semana no cubre un error que se "
        "detecte pasado el fin de semana")


def test_borrar_el_stack_sigue_dejando_un_snapshot():
    """La otra mitad del par: si el borrado SÍ pasa por CloudFormation, los
    datos tienen que sobrevivir al stack."""
    assert CLUSTER.get("DeletionPolicy") == "Snapshot", (
        f"DeletionPolicy es {CLUSTER.get('DeletionPolicy')!r}: un cdk destroy "
        "se llevaría los datos sin dejar copia")
    assert CLUSTER.get("UpdateReplacePolicy") == "Snapshot", (
        "un cambio que obligue a reemplazar el clúster se llevaría los datos")


def test_el_techo_de_acu_sigue_siendo_el_freno_de_gasto():
    """El otro «no hay otra copia»: no hay otro freno de gasto.

    El Budget de la cuenta AVISA, no frena. `serverless_v2_max_capacity` es hoy
    lo único que pone un techo duro a lo que puede costar esta base en una
    noche. Subió de 1 a 2 el 2026-09-21 porque con 7 usuarios el clúster ya
    pegaba en el techo a diario (p95 de 17.9 s en /api/creditos contra el muro
    de 29 s de API Gateway). Lo que este test impide es el siguiente paso dado
    por inercia: nadie ha medido lo que cuestan 4 u 8 ACU sostenidas, y el día
    que alguien las necesite tiene que ser una decisión, no un descuido.
    """
    cfg = PROPS.get("ServerlessV2ScalingConfiguration", {})
    assert cfg.get("MaxCapacity") == 2, (
        f"techo en {cfg.get('MaxCapacity')} ACU: subirlo es una decisión de "
        "gasto sin medir, y este tope es el único freno duro que existe")
    assert cfg.get("MinCapacity") == 0.5, (
        "min 0 reactiva la auto-pausa: la primera petición tras ~5 min sin "
        "tráfico paga ~25 s de despertar, o un 503 dentro del muro de 29 s")


def test_el_data_api_sigue_encendido():
    """La Lambda está FUERA de la VPC a propósito y habla por el endpoint HTTPS
    de rds-data; las subredes son aisladas y no hay NAT. Sin Data API no queda
    ninguna ruta hacia la base: ni la aplicación, ni `tools/usuarios.py`, ni
    `tools/creditos.py`. Los datos seguirían ahí y nadie podría alcanzarlos."""
    assert PROPS.get("EnableHttpEndpoint") is True, (
        "sin Data API la base queda incomunicada: no hay NAT ni Lambda en la VPC")
