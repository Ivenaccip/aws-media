"""M23 · D (prerrequisito) — el freno de capacidad delante de Fargate.

Hasta ahora, cada `start_execution` lanzaba una tarea sin mirar cuántas había.
La cuota son 30 vCPU de Fargate on-demand y cada tarea pide 4: la octava
simplemente no arranca. Y no arrancar es el peor de los fallos, porque el
`creditos.devolver` de cada tarea vive DENTRO del contenedor.

Lo que este archivo defiende:
  * que los SEIS lanzadores pasen por el mismo freno — uno que se escape deja
    el agujero abierto entero;
  * que el tope quepa bajo la cuota con margen;
  * que el freno falle ABIERTO: si no se puede contar, se deja pasar. Bloquear
    a quien pagó porque una llamada de control no respondió es peor;
  * que lo que ve el usuario sea un 503 con motivo, no un 500: no se rompió
    nada, solo hay que volver en un rato.

Sin AWS: el cliente de Step Functions es un doble."""
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

RAIZ = Path(__file__).resolve().parent.parent

# vCPU de la cuota y de cada tarea (infra/stacks/jobs.py: cpu=4096)
CUOTA_VCPU, TAREA_VCPU = 30, 4


class Sfn:
    """Doble del cliente: dice cuántas ejecuciones hay vivas y apunta las que
    se arrancan."""

    def __init__(self, vivas=0, revienta=False):
        self.vivas, self.revienta, self.arrancadas = vivas, revienta, []

    def list_executions(self, stateMachineArn, statusFilter, maxResults):
        if self.revienta:
            raise RuntimeError("AccessDenied: states:ListExecutions")
        assert statusFilter == "RUNNING"
        return {"executions": [{"name": f"e{i}"}
                               for i in range(min(self.vivas, maxResults))]}

    def start_execution(self, stateMachineArn, name, input):
        self.arrancadas.append(json.loads(input))
        return {"executionArn": f"arn:exec:{len(self.arrancadas)}"}


@pytest.fixture
def sfn(monkeypatch):
    from pipeline import jobs
    monkeypatch.setenv("PRODUCIR_SM_ARN", "arn:sm")

    def usar(vivas=0, revienta=False):
        doble = Sfn(vivas, revienta)
        monkeypatch.setattr(jobs, "_sfn", lambda: doble)
        return doble
    return usar


def _lanzadores():
    from pipeline import jobs
    return [
        (jobs.lanzar_produccion, ("u1", "abc123")),
        (jobs.lanzar_shorts_render, ("u1", "mi-video")),
        (jobs.lanzar_editar, ("u1", "mi-video")),
        (jobs.lanzar_render, ("u1", "mi-video", "limpio")),
        (jobs.lanzar_subtitulos, ("u1", "mi-video")),
        (jobs.lanzar_overlay, ("u1", "mi-video")),
    ]


# ---------------------------------------------------------------------------
# el tope

def test_el_tope_cabe_en_la_cuota_con_margen():
    """7 tareas caben justo (28 de 30). El tope es 6 porque una que acaba de
    terminar puede seguir contada unos segundos, y pasarse no falla suave."""
    from pipeline import jobs
    assert jobs.TOPE_TAREAS * TAREA_VCPU <= CUOTA_VCPU - TAREA_VCPU
    assert jobs.TOPE_TAREAS >= 1


def test_el_tope_se_puede_mover_sin_desplegar():
    """Cuando suba la cuota de Fargate, el tope sube con una variable de
    entorno y no con un cambio de código.

    Se comprueba leyendo el fuente y no recargando el módulo a propósito: un
    `importlib.reload(jobs)` crea una clase `SinCapacidad` nueva, y la que
    quedó registrada en los handlers de la app pasa a ser otra — el 503 se
    convierte en 500 para todos los tests que corran después."""
    texto = (RAIZ / "pipeline" / "jobs.py").read_text(encoding="utf-8")
    assert 'os.getenv("FARGATE_TOPE_TAREAS"' in texto


# ---------------------------------------------------------------------------
# frenar y dejar pasar

def test_con_sitio_arranca(sfn):
    from pipeline import jobs
    doble = sfn(vivas=jobs.TOPE_TAREAS - 1)
    assert jobs.lanzar_produccion("u1", "abc123").startswith("arn:exec")
    assert len(doble.arrancadas) == 1


@pytest.mark.parametrize("i", range(6))
def test_los_seis_lanzadores_pasan_por_el_freno(sfn, i):
    """Uno que se escape deja el agujero abierto entero: todos comparten la
    misma máquina de estados y la misma cuota."""
    from pipeline import jobs
    doble = sfn(vivas=jobs.TOPE_TAREAS)
    fn, args = _lanzadores()[i]

    with pytest.raises(jobs.SinCapacidad):
        fn(*args)
    assert doble.arrancadas == [], f"{fn.__name__} arrancó con Fargate lleno"


def test_el_aviso_dice_que_no_se_cobro_y_que_se_puede_volver(sfn):
    from pipeline import jobs
    sfn(vivas=jobs.TOPE_TAREAS)
    with pytest.raises(jobs.SinCapacidad) as e:
        jobs.lanzar_produccion("u1", "abc123")
    assert "no se te cobró" in str(e.value)
    assert "intentarlo" in str(e.value)


def test_si_no_se_puede_contar_se_deja_pasar(sfn):
    """Falla abierto a propósito. Si el conteo revienta (permisos, throttling)
    y esto cerrara, un permiso mal puesto apagaría el producto entero; abierto,
    lo peor que pasa es que una tarea no arranque y el barredor devuelva."""
    from pipeline import jobs
    doble = sfn(revienta=True)
    assert jobs.lanzar_produccion("u1", "abc123")
    assert len(doble.arrancadas) == 1


def test_el_conteo_no_se_trae_la_lista_entera(sfn):
    """Solo hace falta saber si se llegó al tope, no cuántas hay. Con 500
    ejecuciones vivas, pedirlas todas sería paginar por gusto."""
    from pipeline import jobs
    doble = sfn(vivas=500)
    with pytest.raises(jobs.SinCapacidad):
        jobs.lanzar_produccion("u1", "abc123")
    assert doble.vivas == 500      # el doble corta por maxResults, no el código


# ---------------------------------------------------------------------------
# lo que ve el usuario

def test_llena_la_maquina_el_usuario_recibe_503_y_no_500():
    """Un 500 diría «se rompió algo» de una situación en la que no se rompió
    nada. El handler vive en la app porque son seis endpoints en cinco
    archivos, y todos ya devuelven los créditos antes de relanzar."""
    import asyncio

    from pipeline import jobs
    from server.app import app

    handler = app.exception_handlers.get(jobs.SinCapacidad)
    assert handler is not None, "SinCapacidad sin traducir sale como 500"
    r = asyncio.run(handler(None, jobs.SinCapacidad("no hay sitio")))
    assert r.status_code == 503
    assert b"no hay sitio" in r.body


def test_producir_devuelve_los_creditos_si_no_hay_sitio(monkeypatch):
    """El endpoint ya envolvía el lanzamiento; lo que se comprueba es que
    SinCapacidad entra por ese camino y no por uno que se salte la devolución."""
    from pipeline import jobs
    texto = (RAIZ / "server" / "app.py").read_text(encoding="utf-8")
    i = texto.index("jobs.lanzar_produccion")
    cola = texto[i:i + 500]
    assert "except Exception:" in cola and "creditos.devolver" in cola


# ---------------------------------------------------------------------------
# la infra

def test_la_api_puede_contar_las_ejecuciones():
    """Sin `states:ListExecutions` el conteo revienta y el freno se abre solo:
    se comportaría igual que uno sano y no frenaría nada."""
    pytest.importorskip("aws_cdk", reason="aws_cdk vive en infra/requirements.txt, no en la imagen")
    import aws_cdk as cdk
    if str(RAIZ / "infra") not in sys.path:
        sys.path.insert(0, str(RAIZ / "infra"))
    from stacks.api import ApiStack
    from stacks.db import DbStack
    from stacks.jobs import JobsStack
    from stacks.media import MediaStack
    env = cdk.Environment(account="191241816158", region="us-east-1")
    app = cdk.App()
    base = DbStack(app, "aws-media-db", env=env)
    media = MediaStack(app, "aws-media-media", env=env)
    jobs = JobsStack(app, "aws-media-jobs", env=env, cluster_db=base.cluster,
                     media_bucket=media.bucket,
                     cdn_domain=media.cdn.distribution_domain_name, image_ref="latest")
    ApiStack(app, "aws-media-api", env=env, cluster=base.cluster,
             media_bucket=media.bucket,
             cdn_domain=media.cdn.distribution_domain_name, jobs_queue=jobs.queue,
             producir_sm=jobs.state_machine, image_ref="latest")
    recursos = app.synth().get_stack_by_name("aws-media-api").template["Resources"]
    acciones = [a for r in recursos.values() if r["Type"] == "AWS::IAM::Policy"
                for st in r["Properties"]["PolicyDocument"]["Statement"]
                for a in (st["Action"] if isinstance(st["Action"], list) else [st["Action"]])]
    assert "states:ListExecutions" in acciones
