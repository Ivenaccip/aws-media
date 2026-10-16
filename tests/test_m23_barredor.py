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

    # E2: el barredor anota `devueltos` en el doc de una edición; el doc es falso.
    # Lo escrito queda en `db.fijar_campo_editor.escritos` (user, nombre, campo, valor).
    def fijar(user_id, nombre, campo, valor):
        fijar.escritos.append((user_id, nombre, campo, json.loads(valor)))
    fijar.escritos = []
    monkeypatch.setattr(db, "fijar_campo_editor", fijar)
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


# ---------------------------------------------------------------------------
# E2 — la bandeja dice «Te devolvimos ✦ N» leyendo doc.editar.devueltos

def _escritos():
    from pipeline import db
    return db.fijar_campo_editor.escritos


def test_el_barredor_anota_devueltos_en_una_edicion(editor):
    """Una edición que ni arrancó la cierra el barredor, y es la única pieza que sabe
    cuánto devolvió: sin `devueltos` la bandeja callaría el reembolso."""
    barredor, devueltos, trabajo, _ = editor
    trabajo.update(creditos=8, estado="error", paso="editar", copia=True)

    barredor.barrer(_evento(["python", "-m", "worker.editar_task", "u1", "ed-1"], proyecto_id="ed-1"))

    assert devueltos == [(8, "editar-sugerir:ed-1", "u1")]
    (user, nombre, campo, doc), = _escritos()
    assert (user, nombre, campo) == ("u1", "ed-1", "editar")
    assert doc["devueltos"] == 8
    # y lo que ya traía el doc (el paso en que murió, el monto cobrado) se conserva
    assert doc["paso"] == "editar" and doc["creditos"] == 8 and doc["estado"] == "error"


@pytest.mark.parametrize("modulo", ["shorts_task", "overlay_task"])
def test_los_otros_trabajos_no_escriben_devueltos(editor, modulo):
    """Solo `editar` lleva la anotación: shorts y overlay guardan su estado en otro lugar."""
    barredor, devueltos, _, _ = editor
    barredor.barrer(_evento(["python", "-m", f"worker.{modulo}", "u1", "v"], proyecto_id="v"))
    assert len(devueltos) == 1 and _escritos() == []


def test_sin_monedero_no_se_promete_una_devolucion(editor, monkeypatch):
    """En local (`creditos.activo()` falso) no se devuelve ni se escribe `devueltos`."""
    from pipeline import creditos
    barredor, devueltos, _, _ = editor
    monkeypatch.setattr(creditos, "activo", lambda: False)
    barredor.barrer(_evento(["python", "-m", "worker.editar_task", "u1", "v"], proyecto_id="v"))
    assert devueltos == [] and _escritos() == []


def test_un_trabajo_sin_monto_no_anota_nada(editor):
    barredor, devueltos, trabajo, _ = editor
    trabajo["creditos"] = 0
    barredor.barrer(_evento(["python", "-m", "worker.editar_task", "u1", "v"], proyecto_id="v"))
    assert devueltos == [] and _escritos() == []


def test_si_la_anotacion_falla_el_dinero_ya_volvio_y_no_se_levanta_nada(editor, monkeypatch):
    """Devolver va ANTES de anotar: si Postgres se cae al anotar, el reintento del evento
    perdería el reclamo (ya está en error) y no devolvería otra vez. Solo se queda en el log."""
    from pipeline import db
    barredor, devueltos, _, _ = editor

    def truena(*a):
        raise RuntimeError("Postgres no responde")
    monkeypatch.setattr(db, "fijar_campo_editor", truena)

    r = barredor.barrer(_evento(["python", "-m", "worker.editar_task", "u1", "v"], proyecto_id="v"))
    assert r["accion"] == "devuelto" and len(devueltos) == 1


def test_si_el_monedero_falla_el_doc_se_reabre_y_el_reintento_devuelve(monkeypatch):
    """El peor hueco del barredor: ganó el reclamo (el doc pasó a `error`) y entonces el
    monedero falló. Sin reabrir, el reintento del evento pierde el reclamo y los créditos
    NO vuelven nunca. Con un doc de verdad (estado que cambia): la primera pasada falla y
    deja el doc `corriendo`; la segunda lo reclama otra vez y devuelve UNA vez."""
    from pipeline import creditos, db
    from worker import barredor
    doc = {"estado": "corriendo", "creditos": 8, "copia": True, "paso": "entender"}
    abonos, fallos = [], [1]

    def reclamar(user_id, nombre, campo, mensaje):
        if doc["estado"] != "corriendo":
            return None
        doc.update(estado="error", error=mensaje)
        return dict(doc)

    def devolver(n, ref, u=None):
        if fallos:
            fallos.pop()
            raise RuntimeError("el monedero no respondió")
        abonos.append((n, ref, u))

    def fijar(user_id, nombre, campo, valor):
        doc.clear()
        doc.update(json.loads(valor))
    monkeypatch.setattr(db, "reclamar_fallo_editor", reclamar)
    monkeypatch.setattr(db, "fijar_campo_editor", fijar)
    # Ajustes 2 · D-08: cuando el reclamo se pierde, el barredor mira el doc por si el worker dejó una
    # deuda anotada (`devolucion_pendiente`); aquí ya está saldada y no hay nada que cobrar
    monkeypatch.setattr(db, "cargar_proyecto_editor", lambda u, n: {"editar": dict(doc)})
    monkeypatch.setattr(creditos, "activo", lambda: True)
    monkeypatch.setattr(creditos, "devolver", devolver)
    evento = _evento(["python", "-m", "worker.editar_task", "u1", "ed-1"], proyecto_id="ed-1")

    with pytest.raises(RuntimeError):
        barredor.barrer(evento)                      # EventBridge lo reintentará
    assert abonos == [] and doc["estado"] == "corriendo" and doc["devolucion_pendiente"] == 8

    r = barredor.barrer(evento)                      # el reintento
    assert r == {"accion": "devuelto", "creditos": 8, "proyecto": "ed-1"}
    assert abonos == [(8, "editar-sugerir:ed-1", "u1")]
    assert doc["estado"] == "error" and doc["devueltos"] == 8 and "devolucion_pendiente" not in doc

    assert barredor.barrer(evento)["accion"] == "nada"   # un tercer evento no devuelve de nuevo
    assert len(abonos) == 1


# ---------------------------------------------------------------------------
# Ajustes 2 · D-07 y D-08 — el evento tardío de la corrida VIEJA y las deudas sin cobrar
#
# Un `Copia` es el doc de una edición con su libro mayor y su monedero falsos. A diferencia del
# fixture `editor`, el doc tiene ESTADO (el reclamo lo pasa de `corriendo` a `error`), así que se
# ven los cierres de verdad: quién gana, qué queda escrito y cuánto se abona.

from copy import deepcopy
from datetime import datetime, timedelta, timezone

INICIO = datetime(2026, 10, 15, 18, 0, 0, tzinfo=timezone.utc)
COPIA = "ed-1"
REF = f"editar-sugerir:{COPIA}"


def _iso(t: datetime) -> str:
    return t.isoformat(timespec="seconds")


def _ms(t: datetime) -> int:
    return int(t.timestamp() * 1000)


class Copia:
    def __init__(self, monkeypatch, **editar):
        from pipeline import creditos, db
        self.editar = {"copia": True, "estado": "corriendo", "paso": "entender", "cobrado": True,
                       "creditos": 2, "inicio": _iso(INICIO), **editar}
        self.libro = [{"creditos": -self.editar["creditos"], "tipo": "cargo", "referencia": REF}]
        self.abonos, self.lecturas, self.reclamos = [], 0, 0
        self.devolver_falla = 0
        self.escritura_falla = None                  # callable(editar_nuevo) -> Exception | None
        monkeypatch.setattr(creditos, "activo", lambda: True)
        monkeypatch.setattr(creditos, "devolver", self._devolver)
        monkeypatch.setattr(db, "reclamar_fallo_editor", self._reclamar)
        monkeypatch.setattr(db, "cargar_proyecto_editor", self._cargar)
        monkeypatch.setattr(db, "fijar_campo_editor", self._fijar)
        monkeypatch.setattr(db, "movimientos_creditos", lambda u, limite=20: list(self.libro)[:limite])

    def _reclamar(self, user, nombre, campo, mensaje):
        self.reclamos += 1
        if self.editar.get("estado") != "corriendo":
            return None
        self.editar.update(estado="error", error=mensaje)
        return deepcopy(self.editar)

    def _cargar(self, user, nombre):
        self.lecturas += 1
        return {"editar": deepcopy(self.editar)}

    def _fijar(self, user, nombre, campo, valor):
        nuevo = json.loads(valor)
        if self.escritura_falla and (err := self.escritura_falla(nuevo)):
            raise err
        self.editar = nuevo

    def _devolver(self, n, ref, user=None):
        if self.devolver_falla:
            self.devolver_falla -= 1
            raise RuntimeError("el monedero no respondió")
        self.abonos.append((n, ref, user))
        self.libro.insert(0, {"creditos": n, "tipo": "devolucion", "referencia": ref})


@pytest.fixture
def copia(monkeypatch):
    return lambda **editar: Copia(monkeypatch, **editar)


def _barrer(arranque=None, proyecto=COPIA):
    from worker import barredor
    extra = {} if arranque is None else {"startDate": _ms(arranque) if isinstance(arranque, datetime) else arranque}
    return barredor.barrer(_evento(["python", "-m", "worker.editar_task", "u1", proyecto],
                                   proyecto_id=proyecto, **extra))


# --- D-07 ------------------------------------------------------------------

def test_un_evento_tardio_de_la_corrida_vieja_no_cierra_ni_devuelve_el_reintento(copia):
    """La ejecución 1 falló (el worker devolvió y salió 1); la persona pulsó Reintentar sobre la MISMA
    copia, que está `corriendo` otra vez con otro `inicio`. El evento FAILED de la ejecución 1 llega
    tarde: antes reclamaba la corrida nueva y le devolvía lo recién cobrado."""
    c = copia(inicio=_iso(INICIO + timedelta(minutes=3)), reintentos=1)
    r = _barrer(INICIO + timedelta(seconds=2))                 # la ejecución 1 arrancó con la copia
    assert r["accion"] == "nada" and "anterior" in r["motivo"]
    assert c.reclamos == 0 and c.abonos == []                  # ni siquiera intentó reclamar
    assert c.editar["estado"] == "corriendo" and "error" not in c.editar


def test_un_evento_duplicado_de_la_corrida_vieja_tampoco_cierra_un_tercer_reintento(copia):
    c = copia(inicio=_iso(INICIO + timedelta(minutes=6)), reintentos=2)
    evento_viejo = INICIO + timedelta(seconds=2)
    assert _barrer(evento_viejo)["accion"] == "nada"
    assert _barrer(evento_viejo)["accion"] == "nada"
    assert c.reclamos == 0 and c.abonos == [] and c.editar["estado"] == "corriendo"


def test_el_evento_de_la_corrida_vigente_si_devuelve(copia):
    c = copia(creditos=8)
    r = _barrer(INICIO + timedelta(seconds=2))                 # la ejecución arrancó DESPUÉS de `inicio`
    assert r == {"accion": "devuelto", "creditos": 8, "proyecto": COPIA}
    assert c.abonos == [(8, REF, "u1")] and c.editar["estado"] == "error" and c.editar["devueltos"] == 8


@pytest.mark.parametrize("adelanto_s,esperado", [(4.9, "devuelto"), (5.1, "nada")],
                         ids=["dentro_de_la_holgura", "fuera_de_la_holgura"])
def test_la_holgura_cubre_el_desfase_de_relojes_y_nada_mas(copia, adelanto_s, esperado):
    """El API escribe `inicio` y lanza después; el reloj de Step Functions no es el del API. Hasta
    HOLGURA_RELOJ_S segundos de ventaja del `inicio` sobre el arranque se siguen contando como la
    misma corrida; más que eso, es otra."""
    from worker import barredor
    assert barredor.HOLGURA_RELOJ_S == 5.0
    c = copia(inicio=_iso(INICIO + timedelta(seconds=10)))
    r = _barrer(INICIO + timedelta(seconds=10) - timedelta(seconds=adelanto_s))
    assert r["accion"] == esperado
    assert (len(c.abonos) == 1) is (esperado == "devuelto")


@pytest.mark.parametrize("start_date", [None, "no es una fecha", True, 0, -5, float("inf"), ""],
                         ids=["ausente", "texto", "booleano", "cero", "negativo", "infinito", "vacio"])
def test_sin_un_startdate_legible_el_barredor_actua_como_siempre(copia, start_date):
    c = copia(inicio=_iso(INICIO + timedelta(days=1)), creditos=6)       # un inicio MUY posterior
    r = _barrer(start_date)
    assert r["accion"] == "devuelto" and c.abonos == [(6, REF, "u1")]


@pytest.mark.parametrize("inicio", [None, "", "ayer", 12345, "2026-13-45T99:00:00"],
                         ids=["ausente", "vacio", "texto", "numero", "imposible"])
def test_sin_un_inicio_legible_en_el_doc_tampoco_hay_con_que_comparar(copia, inicio):
    c = copia()
    c.editar["inicio"] = inicio
    r = _barrer(INICIO - timedelta(days=1))
    assert r["accion"] == "devuelto" and c.abonos == [(2, REF, "u1")]


def test_el_startdate_puede_venir_en_milisegundos_o_en_segundos_y_el_inicio_con_zona_o_con_z(copia):
    from worker import barredor
    assert barredor._arranque_s({"startDate": 1_760_551_200_000}) == 1_760_551_200.0
    assert barredor._arranque_s({"startDate": 1_760_551_200}) == 1_760_551_200.0
    assert barredor._arranque_s({"startDate": "1760551200000"}) == 1_760_551_200.0
    assert barredor._epoch("2026-10-15T18:00:00+00:00") == barredor._epoch("2026-10-15T18:00:00Z")
    assert barredor._epoch("2026-10-15T18:00:00") == barredor._epoch("2026-10-15T18:00:00+00:00")  # sin zona = UTC


def test_el_arranque_solo_se_compara_en_las_ediciones(monkeypatch):
    """shorts y overlay no leen el doc: su claim ya distingue una corrida de otra."""
    from pipeline import creditos, db
    leidos = []
    monkeypatch.setattr(db, "cargar_proyecto_editor", lambda u, n: leidos.append(n))
    monkeypatch.setattr(db, "reclamar_fallo_editor", lambda u, n, c, m: {"estado": "error", "creditos": 3})
    monkeypatch.setattr(creditos, "activo", lambda: True)
    monkeypatch.setattr(creditos, "devolver", lambda n, ref, u=None: None)
    from worker import barredor
    r = barredor.barrer(_evento(["python", "-m", "worker.shorts_task", "u1", "v"], proyecto_id="v",
                                startDate=_ms(INICIO)))
    assert r["accion"] == "devuelto" and leidos == []


def test_sin_startdate_no_se_lee_el_doc_para_nada(copia):
    """Un evento sin fecha de arranque (los de las pruebas viejas) no cuesta una lectura de más."""
    c = copia()
    _barrer(None)
    assert c.lecturas == 0


@pytest.mark.parametrize("neto,devuelve", [(0, 0), (2, 2), (1, 1)],
                         ids=["el_libro_dice_que_no_se_cobro", "se_cobro_y_no_se_anoto", "cobro_parcial"])
def test_si_el_doc_no_confirma_el_cobro_manda_el_libro_mayor_y_no_el_monto_del_doc(copia, neto, devuelve):
    """`cobrado: false` solo existe entre reservar el reintento y anotar el cobro. Aunque el evento
    llegue sin fecha de arranque, el barredor no devuelve lo que el libro no muestra cobrado."""
    c = copia(cobrado=False, creditos=2)
    c.libro = [{"creditos": -neto, "tipo": "cargo", "referencia": REF}] if neto else []
    r = _barrer(None)
    assert r["creditos"] == devuelve
    assert c.abonos == ([(devuelve, REF, "u1")] if devuelve else [])


def test_con_el_cobro_confirmado_se_devuelve_el_monto_del_doc(copia):
    c = copia(cobrado=True, creditos=8)
    c.libro = []                                              # el libro no se consulta si el doc lo confirma
    assert _barrer(None)["creditos"] == 8 and c.abonos == [(8, REF, "u1")]


# --- D-08: la deuda anotada por el worker ------------------------------------

@pytest.mark.parametrize("estado", ["error", "listo"])
def test_el_barredor_cobra_la_deuda_anotada_aunque_el_doc_no_este_corriendo(copia, estado):
    """El worker deja `devolucion_pendiente` cuando el monedero falla y no puede reabrir el doc
    (`error`, por el índice único) o cuando la copia se entregó con cero sugerencias (`listo`)."""
    c = copia(estado=estado, creditos=8, devolucion_pendiente=2)
    r = _barrer(INICIO + timedelta(seconds=2))
    assert r == {"accion": "devuelto", "creditos": 2, "proyecto": COPIA}
    assert c.abonos == [(2, REF, "u1")]
    assert c.editar["estado"] == estado and c.editar["devueltos"] == 2
    assert "devolucion_pendiente" not in c.editar


def test_la_deuda_se_cobra_una_sola_vez(copia):
    c = copia(estado="error", creditos=8, devolucion_pendiente=8)
    assert _barrer()["accion"] == "devuelto"
    assert _barrer()["accion"] == "nada"                      # el evento duplicado
    assert c.abonos == [(8, REF, "u1")]


def test_si_el_libro_ya_tiene_la_devolucion_solo_se_anota(copia):
    """El abono salió y lo que falló fue la anotación: el evento se reintenta y NO debe abonar otra
    vez (devolver de más es tan malo como no devolver)."""
    c = copia(estado="error", creditos=8, devolucion_pendiente=8)
    c.libro.insert(0, {"creditos": 8, "tipo": "devolucion", "referencia": REF})
    r = _barrer()
    assert r["accion"] == "nada" and c.abonos == []
    assert c.editar["devueltos"] == 8 and "devolucion_pendiente" not in c.editar


def test_el_libro_ya_con_una_devolucion_parcial_tampoco_se_abona_de_nuevo(copia):
    """Cero sugerencias con un video: se devuelven 2 de 8. El neto sigue siendo −6, y aun así esa
    deuda de 2 ya está pagada (la última entrada del libro es la devolución)."""
    c = copia(estado="listo", creditos=8, devolucion_pendiente=2)
    c.libro.insert(0, {"creditos": 2, "tipo": "devolucion", "referencia": REF})
    assert _barrer()["accion"] == "nada" and c.abonos == []


def test_sin_movimientos_de_esa_copia_en_el_libro_no_se_toca_el_monedero(copia):
    c = copia(estado="error", creditos=8, devolucion_pendiente=8)
    c.libro = [{"creditos": -3, "tipo": "cargo", "referencia": "editar-sugerir:otra"}]
    assert _barrer()["accion"] == "nada" and c.abonos == []
    assert c.editar["devolucion_pendiente"] == 8 and "devueltos" not in c.editar   # sigue anotada


@pytest.mark.parametrize("marca", [0, -2, "2", 2.5, True, None],
                         ids=["cero", "negativa", "texto", "decimal", "booleano", "nula"])
def test_una_marca_de_deuda_invalida_no_se_cobra(copia, marca):
    c = copia(estado="error", creditos=8, devolucion_pendiente=marca)
    assert _barrer()["accion"] == "nada" and c.abonos == []


@pytest.mark.parametrize("cambio", [{"copia": False}, {"copia": None}, {"devueltos": 2}, {"creditos": 0}],
                         ids=["no_es_copia", "sin_marca_de_copia", "ya_devuelta", "sin_monto_cobrado"])
def test_solo_se_cobra_la_deuda_de_una_copia_que_no_se_ha_devuelto_y_se_cobro(copia, cambio):
    c = copia(estado="error", creditos=8, devolucion_pendiente=2)
    c.editar.update(cambio)
    assert _barrer()["accion"] == "nada" and c.abonos == []


def test_la_deuda_nunca_pasa_de_lo_que_se_cobro(copia):
    """Un doc con `devolucion_pendiente: 500` no regala 500: tope en `editar.creditos`."""
    c = copia(estado="error", creditos=2, devolucion_pendiente=500)
    assert _barrer()["creditos"] == 2 and c.abonos == [(2, REF, "u1")]


def test_una_copia_corriendo_se_reclama_como_siempre_y_no_pasa_por_la_deuda(copia):
    c = copia(estado="corriendo", creditos=8, devolucion_pendiente=8)
    assert _barrer()["creditos"] == 8
    assert c.reclamos == 1 and c.abonos == [(8, REF, "u1")]
    assert c.editar["estado"] == "error" and c.editar["devueltos"] == 8 and "devolucion_pendiente" not in c.editar


def test_si_el_abono_de_la_deuda_falla_el_error_sube_y_la_deuda_sigue_anotada(copia):
    """Para que EventBridge/Lambda reintenten el evento; la marca no se borra."""
    c = copia(estado="error", creditos=8, devolucion_pendiente=8)
    c.devolver_falla = 1
    with pytest.raises(RuntimeError):
        _barrer()
    assert c.abonos == [] and c.editar["devolucion_pendiente"] == 8
    assert _barrer()["accion"] == "devuelto" and c.abonos == [(8, REF, "u1")]    # el reintento


def test_sin_monedero_encendido_la_deuda_no_se_toca(copia, monkeypatch):
    from pipeline import creditos
    c = copia(estado="error", creditos=8, devolucion_pendiente=8)
    monkeypatch.setattr(creditos, "activo", lambda: False)
    assert _barrer()["accion"] == "nada" and c.abonos == [] and c.editar["devolucion_pendiente"] == 8


def test_si_la_anotacion_de_la_deuda_falla_el_dinero_ya_volvio_y_no_se_levanta(copia):
    c = copia(estado="error", creditos=8, devolucion_pendiente=8)
    c.escritura_falla = lambda nuevo: RuntimeError("Postgres no responde")
    assert _barrer()["creditos"] == 8 and c.abonos == [(8, REF, "u1")]
    # y el reintento del evento no abona de nuevo: el libro ya lo dice
    c.escritura_falla = None
    assert _barrer()["accion"] == "nada" and len(c.abonos) == 1
    assert c.editar["devueltos"] == 8


def test_si_reabrir_choca_con_el_indice_el_barredor_deja_la_deuda_anotada_en_error(copia):
    """El monedero falló DESPUÉS de ganar el reclamo, y reabrir (`corriendo`) lo rechaza el índice
    único porque la persona ya tiene otra copia en curso. Antes solo quedaba un log y el reintento
    del evento perdía el reclamo; ahora el doc se queda `error` con la deuda anotada."""
    c = copia(creditos=8)
    c.devolver_falla = 1
    c.escritura_falla = lambda nuevo: (RuntimeError('duplicate key value violates unique constraint '
                                                     '"proyectos_editor_copia_en_curso"')
                                       if nuevo.get("estado") == "corriendo" else None)
    with pytest.raises(RuntimeError, match="el monedero"):
        _barrer()                                              # el error del monedero sigue subiendo
    assert c.editar["estado"] == "error" and c.editar["devolucion_pendiente"] == 8
    assert "devueltos" not in c.editar and c.abonos == []
    # EventBridge reintenta: ya no se puede reclamar, pero la deuda se cobra
    assert _barrer() == {"accion": "devuelto", "creditos": 8, "proyecto": COPIA}
    assert c.abonos == [(8, REF, "u1")] and c.editar["devueltos"] == 8 and "devolucion_pendiente" not in c.editar
