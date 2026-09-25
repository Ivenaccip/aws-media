"""M23 · D (prerrequisito) — el barredor de ejecuciones caídas.

El agujero que tapa: la state machine tiene UN estado y ningún `Catch`, y el
`creditos.devolver` de cada tarea vive DENTRO del contenedor. Si la tarea no
llega a arrancar —la imagen de ECR no se pudo bajar, no había capacidad para
4 vCPU, la máquina venció a las 2 h— la ejecución muere FAILED, ese código
nunca corre, y el usuario se queda sin película **y sin créditos**.

Lo que este archivo defiende:
  * que un fallo de arranque devuelva lo que se cobró y cierre el proyecto;
  * que NO devuelva dos veces cuando el contenedor sí alcanzó a devolver —
    ese es el error caro en la otra dirección: créditos regalados que nadie
    compró. La idempotencia es el UPDATE condicionado, no una marca nueva;
  * que devuelva lo COBRADO y no la tarifa de hoy (entre el cobro y el fallo
    pueden desplegarse precios nuevos);
  * que sin datos no invente: input recortado, ilegible o incompleto = no se
    toca el monedero;
  * que un final BUENO no devuelva nada aunque el evento llegue aquí;
  * y que la regla de EventBridge escuche solo a nuestra máquina y solo los
    tres finales malos.

Sin AWS: Postgres, monedero y disco mockeados."""
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

RAIZ = Path(__file__).resolve().parent.parent


def _evento(command, user_id="u1", proyecto_id="abc123", status="FAILED",
            **extra) -> dict:
    """El `detail` tal como lo manda EventBridge: `input` es un STRING JSON."""
    d = {"status": status, "executionArn": "arn:exec",
         "input": json.dumps({"user_id": user_id, "proyecto_id": proyecto_id,
                              "command": command})}
    d.update(extra)
    return d


COMANDO = ["python", "-m", "worker.producir_task", "u1", "abc123", "todo"]


# ---------------------------------------------------------------------------
# leer el evento

def test_el_modulo_sale_del_comando_que_arma_jobs(monkeypatch):
    """Atado al productor a propósito: si `lanzar_produccion` cambia la forma
    del comando, el barredor deja de reconocer qué murió y este test lo dice."""
    from pipeline import jobs
    from worker import barredor
    monkeypatch.setenv("PRODUCIR_SM_ARN", "arn:sm")
    capturado = {}

    class SFN:
        def start_execution(self, stateMachineArn, name, input):
            capturado.update(json.loads(input))
            return {"executionArn": "arn:exec"}
    monkeypatch.setattr(jobs, "_sfn", lambda: SFN())
    jobs.lanzar_produccion("u1", "abc123")

    assert barredor.modulo_de(capturado["command"]) == "producir_task"


def test_un_comando_raro_no_revienta():
    """Esto corre reaccionando a un evento: una excepción aquí se pierde en los
    logs de Lambda y nadie se entera de que el dinero no volvió."""
    from worker import barredor
    assert barredor.modulo_de(None) == ""
    assert barredor.modulo_de([]) == ""
    assert barredor.modulo_de(["python", "-m"]) == ""
    assert barredor.modulo_de(["bash", "-c", "algo"]) == ""


# ---------------------------------------------------------------------------
# el caso que tapa el agujero

@pytest.fixture
def barrido(monkeypatch):
    """(barredor, devueltos, proyecto, claims) con Postgres y monedero falsos."""
    from pipeline import creditos, db
    from pipeline import project as proyecto_mod
    from pipeline.project import Proyecto
    from worker import barredor
    # _barrer_producir asigna os.environ["DEFAULT_USER_ID"] directo (corre solo
    # en su Lambda). Registrarla aquí es lo que hace que monkeypatch la
    # restaure: sin esto el "u1" se queda puesto y contamina otros tests.
    monkeypatch.setenv("DEFAULT_USER_ID", "u1")
    p = Proyecto(id="abc123", creado="2026-09-18T12:00:00", brief="un gato",
                 estado="produciendo", duracion_s=30, cobrado_producir=90)
    devueltos, claims = [], []

    def reclamar(user_id, id_):
        claims.append((user_id, id_))
        return True                      # el proyecto seguía en 'produciendo'
    monkeypatch.setattr(db, "reclamar_fallo_produccion", reclamar)
    monkeypatch.setattr(creditos, "activo", lambda: True)
    monkeypatch.setattr(creditos, "devolver",
                        lambda n, ref, u=None: devueltos.append((n, ref, u)))
    monkeypatch.setattr(proyecto_mod, "cargar_proyecto", lambda i: p)
    monkeypatch.setattr(Proyecto, "guardar", lambda self: None)
    return barredor, devueltos, p, claims


def test_una_produccion_que_nunca_arranco_devuelve_y_cierra(barrido):
    barredor, devueltos, p, _ = barrido
    r = barredor.barrer(_evento(COMANDO))

    assert r["accion"] == "devuelto" and r["creditos"] == 90
    assert devueltos == [(90, "producir:abc123", "u1")]
    assert p.estado == "error"
    # el usuario no tiene por qué saber qué es ResourceInitializationError; lo
    # que necesita saber es que no se le cobró y que puede reintentar
    assert "no se te cobró" in p.error
    assert "Fargate" not in p.error and "Error" not in p.error


def test_no_devuelve_dos_veces_si_el_contenedor_ya_cerro(barrido, monkeypatch):
    """El error caro en la otra dirección. Si la tarea SÍ corrió y falló, ella
    ya devolvió y movió el proyecto a 'error': el claim pierde y aquí no se
    toca el monedero. Sin esto, cada fallo normal devolvería el doble."""
    from pipeline import db
    barredor, devueltos, p, _ = barrido
    monkeypatch.setattr(db, "reclamar_fallo_produccion", lambda u, i: False)

    r = barredor.barrer(_evento(COMANDO))

    assert devueltos == []
    assert r["accion"] == "nada"


def test_devuelve_lo_cobrado_y_no_la_tarifa_de_hoy(barrido):
    """Entre el cobro y el fallo pueden desplegarse precios nuevos: la API y
    Fargate se despliegan por separado. Lo que vuelve es lo que salió."""
    from pipeline import creditos
    barredor, devueltos, p, _ = barrido
    p.cobrado_producir = 77
    assert creditos.costo_producir(p.duracion_s) != 77      # la tabla dice otra cosa

    barredor.barrer(_evento(COMANDO))

    assert devueltos[0][0] == 77


def test_el_claim_va_con_el_usuario_del_evento(barrido):
    """El user_id sale del input de la ejecución. Reclamar con otro usuario
    cerraría el proyecto de alguien más."""
    barredor, _, _, claims = barrido
    barredor.barrer(_evento(COMANDO, user_id="ana", proyecto_id="zzz999"))
    assert claims == [("ana", "zzz999")]


def test_sin_monedero_encendido_no_se_devuelve_nada(barrido, monkeypatch):
    from pipeline import creditos
    barredor, devueltos, p, _ = barrido
    monkeypatch.setattr(creditos, "activo", lambda: False)

    r = barredor.barrer(_evento(COMANDO))

    assert devueltos == []
    assert r["creditos"] == 0
    assert p.estado == "error"          # el proyecto se cierra igual


# ---------------------------------------------------------------------------
# lo que NO debe tocar

def test_un_final_bueno_no_devuelve_nada(barrido):
    """El filtro vive en la regla de EventBridge, pero se revisa otra vez aquí:
    una regla mal editada no debe poder devolver créditos de películas que
    salieron bien."""
    barredor, devueltos, _, _ = barrido
    for bueno in ("SUCCEEDED", "RUNNING", ""):
        assert barredor.barrer(_evento(COMANDO, status=bueno))["accion"] == "nada"
    assert devueltos == []


def test_un_input_recortado_no_inventa_a_quien_devolverle(barrido):
    """EventBridge recorta el input si pasa de 256 KB. Sin él no hay usuario ni
    proyecto, y adivinar es peor que no hacer nada."""
    barredor, devueltos, _, _ = barrido
    ev = _evento(COMANDO)
    ev["inputDetails"] = {"included": False}
    ev["input"] = ""

    assert barredor.barrer(ev)["motivo"] == "input recortado"
    assert devueltos == []


def test_un_input_ilegible_o_incompleto_no_toca_el_monedero(barrido):
    barredor, devueltos, _, _ = barrido
    assert barredor.barrer({"status": "FAILED", "input": "{no es json"})["accion"] == "nada"
    assert barredor.barrer({"status": "FAILED", "input": "{}"})["accion"] == "nada"
    assert barredor.barrer(_evento(COMANDO, user_id=""))["accion"] == "nada"
    assert barredor.barrer(_evento(None))["accion"] == "nada"
    assert devueltos == []


def test_los_trabajos_que_no_cobran_no_se_barren(barrido):
    """`render_task` y `subtitulos_task` no cobran créditos: no hay nada que
    devolver y reclamar su proyecto sería cerrarlo por la espalda."""
    barredor, devueltos, _, claims = barrido
    for modulo in ("render_task", "subtitulos_task"):
        cmd = ["python", "-m", f"worker.{modulo}", "u1", "abc123"]
        assert "no cobra" in barredor.barrer(_evento(cmd))["motivo"]
    assert devueltos == [] and claims == []


def test_un_modulo_sin_barredor_no_devuelve_a_ciegas(barrido):
    """Devolver sin saber cuánto se cobró es regalar créditos. Un módulo que
    todavía no se barre se registra y se queda como deuda visible."""
    barredor, devueltos, _, _ = barrido
    cmd = ["python", "-m", "worker.futuro_task", "u1", "abc123"]

    assert barredor.barrer(_evento(cmd))["motivo"].endswith("sin barredor")
    assert devueltos == []


# ---------------------------------------------------------------------------
# los tres trabajos del editor que cobran

@pytest.fixture
def editor(monkeypatch):
    """(barredor, devueltos, trabajo) con el doc del editor falso."""
    from pipeline import creditos, db
    from worker import barredor
    devueltos, reclamos = [], []
    trabajo = {"estado": "error", "creditos": 6}

    def reclamar(user_id, nombre, campo, mensaje):
        reclamos.append((user_id, nombre, campo, mensaje))
        return trabajo
    monkeypatch.setattr(db, "reclamar_fallo_editor", reclamar)
    monkeypatch.setattr(creditos, "activo", lambda: True)
    monkeypatch.setattr(creditos, "devolver",
                        lambda n, ref, u=None: devueltos.append((n, ref, u)))
    return barredor, devueltos, trabajo, reclamos


@pytest.mark.parametrize("modulo,campo,ref", [
    ("shorts_task", "shorts", "shorts-render:mi-video"),
    ("editar_task", "editar", "editar-sugerir:mi-video"),
    ("overlay_task", "overlay_job", "overlay:mi-video"),
])
def test_un_trabajo_del_editor_que_nunca_arranco_devuelve(editor, modulo, campo, ref):
    """Sin esto el trabajo se queda 'corriendo' para siempre, y lo único que lo
    destraba es la caducidad de 2 h de su pantalla — que deja lanzar otro, y el
    otro VUELVE A COBRAR. El usuario acababa pagando dos veces."""
    barredor, devueltos, _, reclamos = editor
    cmd = ["python", "-m", f"worker.{modulo}", "u1", "mi-video"]

    r = barredor.barrer(_evento(cmd, proyecto_id="mi-video"))

    assert r == {"accion": "devuelto", "creditos": 6, "proyecto": "mi-video"}
    assert devueltos == [(6, ref, "u1")]
    assert reclamos[0][:3] == ("u1", "mi-video", campo)
    assert "no se te cobró" in reclamos[0][3]   # el motivo se escribe al cerrar


def test_el_monto_sale_del_doc_y_no_de_la_tarifa(editor):
    """Cada uno cobra distinto (2 por short, 2+transcripción, 3 por segundo de
    Veo). El número exacto ya quedó escrito al cobrar: recalcularlo aquí sería
    devolver el precio de hoy."""
    barredor, devueltos, trabajo, _ = editor
    trabajo["creditos"] = 24
    barredor.barrer(_evento(["python", "-m", "worker.editar_task", "u1", "v"]))
    assert devueltos[0][0] == 24


def test_activar_un_overlay_no_cobra_asi_que_no_devuelve(editor):
    """`overlay_task` tiene dos acciones: generar cobra los segundos de Veo y
    activar es gratis. El doc las distingue solo, por el monto."""
    barredor, devueltos, trabajo, _ = editor
    trabajo["creditos"] = 0

    r = barredor.barrer(_evento(["python", "-m", "worker.overlay_task", "u1", "v"]))

    assert r["creditos"] == 0 and devueltos == []


def test_si_el_trabajo_ya_no_corria_no_se_devuelve(editor, monkeypatch):
    from pipeline import db
    barredor, devueltos, _, _ = editor
    monkeypatch.setattr(db, "reclamar_fallo_editor", lambda u, n, c, m: None)

    r = barredor.barrer(_evento(["python", "-m", "worker.shorts_task", "u1", "v"]))

    assert r["accion"] == "nada" and devueltos == []


@pytest.mark.parametrize("archivo,referencia", [
    ("server/shorts_api.py", "shorts-render:"),
    ("server/editar_api.py", "editar-sugerir:"),
    ("server/overlays_api.py", "overlay:"),
])
def test_la_referencia_es_la_que_ya_usan_sus_devoluciones(archivo, referencia):
    """Dos fallos del mismo trabajo tienen que verse iguales en el libro mayor:
    el que barrió el barredor y el que devolvió el worker."""
    texto = (RAIZ / archivo).read_text(encoding="utf-8")
    assert f'creditos.devolver' in texto and referencia in texto


# ---------------------------------------------------------------------------
# el despacho en la Lambda

def test_el_worker_reconoce_el_evento_de_step_functions(monkeypatch):
    """Llega directo de EventBridge, sin Records de SQS y sin transformar."""
    from worker import barredor, lambda_worker
    visto = {}
    monkeypatch.setattr(barredor, "barrer",
                        lambda d: visto.update(d) or {"accion": "devuelto"})

    r = lambda_worker.handler(
        {"detail-type": "Step Functions Execution Status Change",
         "source": "aws.states", "detail": _evento(COMANDO)}, None)

    assert r == {"accion": "devuelto"}
    assert visto["status"] == "FAILED"


# ---------------------------------------------------------------------------
# la infra

def _plantilla_jobs() -> dict:
    pytest.importorskip("aws_cdk", reason="aws_cdk vive en infra/requirements.txt, no en la imagen")
    import aws_cdk as cdk
    if str(RAIZ / "infra") not in sys.path:
        sys.path.insert(0, str(RAIZ / "infra"))
    from stacks.db import DbStack
    from stacks.jobs import JobsStack
    from stacks.media import MediaStack
    env = cdk.Environment(account="191241816158", region="us-east-1")
    app = cdk.App()
    base = DbStack(app, "aws-media-db", env=env)
    media = MediaStack(app, "aws-media-media", env=env)
    JobsStack(app, "aws-media-jobs", env=env, cluster_db=base.cluster,
              media_bucket=media.bucket,
              cdn_domain=media.cdn.distribution_domain_name, image_ref="latest")
    return app.synth().get_stack_by_name("aws-media-jobs").template


@pytest.fixture(scope="module")
def reglas() -> list[dict]:
    return [r["Properties"] for r in _plantilla_jobs()["Resources"].values()
            if r["Type"] == "AWS::Events::Rule"]


def test_la_regla_escucha_solo_los_finales_malos(reglas):
    patrones = [r["EventPattern"] for r in reglas if "EventPattern" in r]
    assert len(patrones) == 1, "solo debería haber una regla por patrón"
    p = patrones[0]
    assert p["source"] == ["aws.states"]
    assert p["detail-type"] == ["Step Functions Execution Status Change"]
    assert sorted(p["detail"]["status"]) == ["ABORTED", "FAILED", "TIMED_OUT"]
    # y de NUESTRA máquina: sin este filtro, cualquier state machine de la
    # cuenta despertaría al barredor
    assert p["detail"]["stateMachineArn"]


def test_la_regla_despierta_al_worker(reglas):
    """El worker es quien sabe de Postgres y del monedero; una Lambda nueva
    sería otra cosa que mantener con los mismos permisos."""
    objetivos = [t for r in reglas if "EventPattern" in r for t in r["Targets"]]
    assert len(objetivos) == 1
    assert "Input" not in objetivos[0], (
        "el evento va sin transformar: detail.input ya es JSON y meterlo en "
        "una plantilla de EventBridge deja comillas sin escapar")


def test_el_sync_diario_sigue_en_pie(reglas):
    """La regla vieja no se toca: son reglas distintas sobre el mismo worker.

    Se busca por expresión y no por conteo a propósito. Este test se escribió
    contando las reglas de cron y se rompió en cuanto MIX añadió la suya, que
    es justo lo que NO queremos: que añadir un cron nuevo obligue a tocar la
    comprobación del viejo. Lo que importa es que el sync diario siga ahí."""
    cron = {r["ScheduleExpression"] for r in reglas if "ScheduleExpression" in r}
    assert "cron(0 6 * * ? *)" in cron
