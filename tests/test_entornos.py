"""Los nombres de producción no se mueven, y dev no pisa ninguno.

Decisión del 2026-09-24: dos entornos, y dev con su propio pool de Cognito.
Para llegar ahí, ApiStack y JobsStack reciben un `entorno` (infra/entornos.py)
del que salen todos sus nombres físicos. El default es PROD.

Lo que puede dejar fuera a los usuarios no es un dedazo en dev: es que el stack
VIVO, `aws-media-api`, reciba otro nombre de pool o de dominio. En ese instante
CloudFormation crea un pool nuevo y vacío, el viejo queda huérfano con la gente
dentro y el client_id cambia. No hay rollback. Un `cdk diff` vacío lo comprueba
una vez; estos tests lo comprueban en cada push, también cuando el que teclea el
deploy es otro a las once de la noche.

Tres capas:
  1. Python puro sobre infra/entornos.py: corre en todas partes.
  2. Texto de infra/app.py: importarlo no sintetiza ni habla con AWS.
  3. Síntesis real con `construir()` de infra/app.py, la MISMA composición que
     despliega el dueño (no stacks armados a mano: si alguien escribiera
     `entorno=DEV` en app.py, un test que arma los stacks por su cuenta
     seguiría en verde). Necesita aws_cdk, que no viaja en la imagen; el CI lo
     instala en un paso propio antes del build y exporta EXIGIR_CDK=1 para que
     ahí la falta del CDK sea un fallo y no un skip silencioso.
"""
import importlib
import os
import sys
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parent.parent
INFRA = RAIZ / "infra"
if str(INFRA) not in sys.path:
    sys.path.insert(0, str(INFRA))

from entornos import DEV, PROD  # noqa: E402

APP = (INFRA / "app.py").read_text(encoding="utf-8")
APP_DEV = (INFRA / "app_dev.py").read_text(encoding="utf-8")
WF_PATH = RAIZ / ".github" / "workflows" / "docker.yml"

# Los ids lógicos de lo que tiene estado en Cognito y Step Functions. Cambiar
# uno (renombrar el construct "Users", meterlo en un sub-construct) crea un
# recurso nuevo aunque el nombre físico siga igual, y un test que solo mire
# nombres no lo ve.
IDS_LOGICOS_API = {
    "Users0A0EEA89": "AWS::Cognito::UserPool",
    "Usersweb57A99F0B": "AWS::Cognito::UserPoolClient",
    "UsersDomainC6632324": "AWS::Cognito::UserPoolDomain",
    "AdminGroup": "AWS::Cognito::UserPoolGroup",
}
IDS_LOGICOS_JOBS = {
    "ProducirSmA0EBD9D0": "AWS::StepFunctions::StateMachine",
}


# ---------------------------------------------------------------------------
# 1. los valores, sin CDK

def test_los_nombres_de_prod_son_los_que_existen_en_la_cuenta():
    """Cada uno es el nombre de algo vivo con datos dentro. Si este test falla
    no se arregla cambiando el test: se para y se lee infra/entornos.py."""
    assert PROD.nombre == "prod"
    assert PROD.pool == "aws-media-users"
    assert PROD.dominio_cognito == "media-ivenaccip"
    assert PROD.ssm_env == "/media-ivenaccip/env"
    assert PROD.ssm_usuarios == "/media-ivenaccip/usuarios"
    assert PROD.maquina_producir == "aws-media-producir"
    assert PROD.api == "aws-media"
    assert PROD.dominio_publico == "https://irremplazables.xyz"


@pytest.mark.parametrize("campo", [
    "pool", "dominio_cognito", "ssm_env", "ssm_usuarios", "maquina_producir", "api",
])
def test_dev_no_comparte_ningun_nombre_con_prod(campo):
    assert getattr(DEV, campo) != getattr(PROD, campo)


@pytest.mark.parametrize("campo", ["ssm_env", "ssm_usuarios"])
def test_los_permisos_de_ssm_de_un_entorno_no_alcanzan_al_otro(campo):
    """IAM concede `parameter<prefijo>*`. Si un prefijo empezara por el otro,
    las Lambdas de dev leerían las claves de producción (o al revés)."""
    d, p = getattr(DEV, campo), getattr(PROD, campo)
    assert not d.startswith(p) and not p.startswith(d)
    assert not d.startswith(PROD.ssm_env) and not d.startswith(PROD.ssm_usuarios)


def test_dev_no_tiene_nombre_publico():
    """Con el de prod, el correo de invitación de dev mandaría a la gente a
    irremplazables.xyz, y sus callbacks de Cognito apuntarían a producción."""
    assert DEV.dominio_publico is None


@pytest.mark.parametrize("e", [PROD, DEV], ids=["prod", "dev"])
def test_prefijos_reservados_de_aws(e):
    """SSM reserva «aws*» y Cognito no admite «aws» en el prefijo del dominio."""
    for prefijo in (e.ssm_env, e.ssm_usuarios):
        assert not prefijo.lstrip("/").lower().startswith("aws")
    assert "aws" not in e.dominio_cognito.lower()


# ---------------------------------------------------------------------------
# 2. importar infra/app.py no despliega nada

def test_app_solo_sintetiza_bajo_main():
    """Antes, `cdk.App()`, la consulta al ECR y `app.synth()` corrían al
    importar el módulo: no se podía probar la composición sin sintetizarla."""
    guarda = 'if __name__ == "__main__":'
    assert guarda in APP
    principal = APP.split(guarda, 1)[1]
    cabecera = APP.split(guarda, 1)[0]
    for llamada in ("app = cdk.App()", "_digest_de(IMAGE_TAG)", "app.synth()",
                    "construir(app, digest)"):
        assert llamada in principal, f"{llamada} salió de la guarda"
        assert llamada not in cabecera.replace("def _digest_de", ""), (
            f"{llamada} volvió a correr al importar")


def test_la_composicion_de_prod_no_pasa_entorno():
    """El default de los stacks es PROD. Escribir `entorno=` en `construir()`
    es exactamente el disparador que se quiere evitar: dev va en su propia app."""
    cuerpo = APP[APP.index("def construir"):APP.index('if __name__ == "__main__":')]
    codigo = cuerpo.split('"""')[2]   # sin el docstring, que sí lo nombra
    assert "ApiStack(" in codigo and "JobsStack(" in codigo
    assert "entorno=" not in codigo


# ---------------------------------------------------------------------------
# 3. síntesis real

@pytest.fixture(scope="module")
def cdk():
    try:
        return importlib.import_module("aws_cdk")
    except ImportError:
        if os.getenv("EXIGIR_CDK"):
            pytest.fail("EXIGIR_CDK=1 y aws_cdk no está instalado: el CI "
                        "tiene que instalar infra/requirements.txt")
        pytest.skip("aws_cdk vive en infra/requirements.txt, no en la imagen")


@pytest.fixture(scope="module")
def prod(cdk, monkeypatch_modulo):
    """Los templates de la composición real de infra/app.py."""
    try:
        import boto3
    except ImportError:   # en el paso del CI no está: no hay nada que vigilar
        boto3 = None
    if boto3 is not None:
        def _prohibido(*a, **k):
            raise AssertionError("construir() no debe hablar con AWS")
        monkeypatch_modulo.setattr(boto3, "client", _prohibido)
    infra_app = importlib.import_module("app")
    app = cdk.App()
    infra_app.construir(app, "sha256:" + "0" * 64)
    ensamblado = app.synth()
    return {s.stack_name: s.template for s in ensamblado.stacks}


@pytest.fixture(scope="module")
def monkeypatch_modulo():
    mp = pytest.MonkeyPatch()
    yield mp
    mp.undo()


def _de_tipo(template, tipo):
    return {k: r for k, r in template["Resources"].items() if r["Type"] == tipo}


def _uno(template, tipo):
    rs = _de_tipo(template, tipo)
    assert len(rs) == 1, f"se esperaba un {tipo}, hay {len(rs)}"
    return next(iter(rs.values()))["Properties"]


def test_construir_arma_los_cinco_stacks_de_prod(prod):
    assert set(prod) == {"aws-media-base", "aws-media-db", "aws-media-media",
                         "aws-media-jobs", "aws-media-api"}


def test_cognito_de_prod_conserva_sus_nombres(prod):
    api = prod["aws-media-api"]
    assert _uno(api, "AWS::Cognito::UserPool")["UserPoolName"] == "aws-media-users"
    assert _uno(api, "AWS::Cognito::UserPoolDomain")["Domain"] == "media-ivenaccip"
    assert _uno(api, "AWS::Cognito::UserPoolGroup")["GroupName"] == "admin"


def test_los_ids_logicos_con_estado_no_cambian(prod):
    for stack, ids in (("aws-media-api", IDS_LOGICOS_API),
                       ("aws-media-jobs", IDS_LOGICOS_JOBS)):
        recursos = prod[stack]["Resources"]
        for id_logico, tipo in ids.items():
            assert id_logico in recursos, f"{stack}: desapareció {id_logico}"
            assert recursos[id_logico]["Type"] == tipo


def test_el_pool_sigue_con_retain(prod):
    pool = prod["aws-media-api"]["Resources"]["Users0A0EEA89"]
    assert pool["DeletionPolicy"] == "Retain"
    assert pool["UpdateReplacePolicy"] == "Retain"


def test_el_pool_de_prod_lleva_proteccion_de_borrado(prod):
    """RETAIN y DeletionProtection no son lo mismo y los dos hacen falta.

    RETAIN es de CloudFormation: si el stack deja de declarar el pool, el pool
    sobrevive huérfano. DeletionProtection es de Cognito: impide el
    `delete-user-pool` de la consola o de la CLI, que RETAIN no ve pasar.

    Va en el template y no puesta a mano justamente por esto: la propiedad
    puesta desde la consola no viaja en él, así que nadie podía responder si
    sobrevivía al siguiente update del ApiStack. Declarada aquí, la gobierna
    CloudFormation y la respuesta deja de ser una pregunta."""
    pool = prod["aws-media-api"]["Resources"]["Users0A0EEA89"]
    assert pool["Properties"]["DeletionProtection"] == "ACTIVE"


def test_el_pool_de_dev_no_lleva_proteccion_de_borrado(dev):
    """Un entorno de pruebas tiene que poder tirarse. Con ACTIVE, el `cdk
    destroy` del stack de dev falla y hay que ir a apagarla a mano primero."""
    pool = dev["aws-media-api-dev"]["Resources"]["Users0A0EEA89"]
    assert pool["Properties"].get("DeletionProtection", "INACTIVE") == "INACTIVE"


def test_la_maquina_de_producir_conserva_su_nombre(prod):
    sm = _uno(prod["aws-media-jobs"], "AWS::StepFunctions::StateMachine")
    assert sm["StateMachineName"] == "aws-media-producir"


def _env_lambdas(template):
    return [r["Properties"]["Environment"]["Variables"]
            for r in _de_tipo(template, "AWS::Lambda::Function").values()
            if "Environment" in r["Properties"]]


def test_las_lambdas_de_prod_leen_sus_claves_de_siempre(prod):
    """Con otro prefijo no hay reemplazo: hay caída. La Lambda busca sus claves
    donde no están."""
    envs = _env_lambdas(prod["aws-media-api"]) + _env_lambdas(prod["aws-media-jobs"])
    con_ssm = [e for e in envs if "SSM_ENV_PREFIX" in e]
    assert len(con_ssm) == 2, "se esperaban la Lambda del API y el worker"
    for e in con_ssm:
        assert e["SSM_ENV_PREFIX"] == "/media-ivenaccip/env"
        assert e["SSM_USUARIOS_PREFIX"] == "/media-ivenaccip/usuarios"
    api = [e for e in envs if "COGNITO_DOMINIO" in e]
    assert len(api) == 1
    assert api[0]["COGNITO_DOMINIO"] == "media-ivenaccip.auth.us-east-1.amazoncognito.com"

    contenedor = _uno(prod["aws-media-jobs"], "AWS::ECS::TaskDefinition")
    vars_ = {v["Name"]: v["Value"]
             for v in contenedor["ContainerDefinitions"][0]["Environment"]}
    assert vars_["SSM_ENV_PREFIX"] == "/media-ivenaccip/env"
    assert vars_["SSM_USUARIOS_PREFIX"] == "/media-ivenaccip/usuarios"


def _arns_ssm(template):
    """Las ARNs de SSM de las políticas, aplanando los Fn::Join."""
    out = []
    for pol in _de_tipo(template, "AWS::IAM::Policy").values():
        for st in pol["Properties"]["PolicyDocument"]["Statement"]:
            acciones = st["Action"] if isinstance(st["Action"], list) else [st["Action"]]
            if not any(a.startswith("ssm:") for a in acciones):
                continue
            recursos = st["Resource"] if isinstance(st["Resource"], list) else [st["Resource"]]
            for r in recursos:
                if isinstance(r, dict) and "Fn::Join" in r:
                    r = "".join(p if isinstance(p, str) else "<ref>"
                                for p in r["Fn::Join"][1])
                out.append((tuple(sorted(acciones)), r))
    return out


def test_los_permisos_de_ssm_de_prod_no_se_mueven(prod):
    api = _arns_ssm(prod["aws-media-api"])
    lectura = [r for a, r in api if "ssm:GetParameter" in a]
    escritura = [r for a, r in api if "ssm:PutParameter" in a]
    assert any(r.endswith(":parameter/media-ivenaccip/env*") for r in lectura)
    assert any(r.endswith(":parameter/media-ivenaccip/usuarios*") for r in lectura)
    assert escritura and all(
        r.endswith(":parameter/media-ivenaccip/usuarios/*/BLOTATO_API_KEY")
        for r in escritura)
    jobs = [r for _, r in _arns_ssm(prod["aws-media-jobs"])]
    assert any(r.endswith(":parameter/media-ivenaccip/env*") for r in jobs)
    assert any(r.endswith(":parameter/media-ivenaccip/usuarios*") for r in jobs)


def test_la_invitacion_y_los_callbacks_de_prod_usan_el_nombre_propio(prod):
    api = prod["aws-media-api"]
    pool = _uno(api, "AWS::Cognito::UserPool")
    cuerpo = pool["AdminCreateUserConfig"]["InviteMessageTemplate"]["EmailMessage"]
    assert '<a href="https://irremplazables.xyz">' in cuerpo
    asunto = pool["AdminCreateUserConfig"]["InviteMessageTemplate"]["EmailSubject"]
    assert not asunto.startswith("[")
    cliente = _uno(api, "AWS::Cognito::UserPoolClient")
    assert cliente["CallbackURLs"][0] == "https://irremplazables.xyz/callback.html"
    assert "http://localhost:8011/callback.html" in cliente["CallbackURLs"]
    assert len(cliente["CallbackURLs"]) == 3, "falta el execute-api de las ligas viejas"


# Sin «From» y con el ARN de la DIRECCIÓN, no el del dominio: con el correo
# integrado Cognito rechaza las otras dos formas (medido el 7-oct, ver api.py).
REMITENTE = {
    "EmailSendingAccount": "COGNITO_DEFAULT",
    "SourceArn": "arn:aws:ses:us-east-1:191241816158:identity/hola@irremplazables.xyz",
}


def test_el_pool_de_prod_firma_con_el_dominio_propio_sin_cambiar_de_servicio(prod):
    """El remitente es hola@irremplazables.xyz, pero el envío sigue siendo el
    integrado de Cognito (COGNITO_DEFAULT). DEVELOPER manda por el SES de la
    cuenta, y mientras SES siga en el sandbox eso solo entrega a direcciones
    verificadas: la invitación dejaría de llegarle a todo el mundo sin que
    ningún deploy falle. El día que SES salga del sandbox y esto se cambie, se
    cambia este test a sabiendas."""
    pool = _uno(prod["aws-media-api"], "AWS::Cognito::UserPool")
    assert pool.get("EmailConfiguration") == REMITENTE, (
        "el pool de prod ya no firma como hola@irremplazables.xyz; si es la "
        "vuelta atrás de docs/OPERACION.md, este test se cambia a sabiendas")


def test_la_politica_de_ses_autoriza_al_remitente_del_template(prod, dev):
    """La política vive fuera del CDK (la pone el dueño con la CLI, sobre la
    identidad de la DIRECCIÓN) y sin ella el update del pool falla. Si alguien
    cambia el remitente, este archivo tiene que cambiar con él: aquí se nota
    antes de un deploy."""
    import json
    politica = json.loads((INFRA / "ses-politica-remitente.json").read_text(encoding="utf-8"))
    (regla,) = politica["Statement"]
    assert regla["Effect"] == "Allow"
    assert regla["Principal"] == {"Service": "email.cognito-idp.amazonaws.com"}
    assert {a.lower() for a in regla["Action"]} == {"ses:sendemail", "ses:sendrawemail"}
    for template in (prod["aws-media-api"], dev["aws-media-api-dev"]):
        correo = _uno(template, "AWS::Cognito::UserPool").get("EmailConfiguration")
        if correo is None:      # ese entorno está con el remitente de fábrica
            continue
        assert regla["Resource"] == correo["SourceArn"]
    # Solo los pools de ESTA cuenta, en esta región. No lleva ids de pool a
    # propósito: dev se puede tirar y recrear (nace con otro id) y un id mal
    # tecleado aquí no lo ve ningún test: se vería en un deploy fallido.
    cuenta = regla["Resource"].split(":")[4]
    assert regla["Condition"] == {
        "StringEquals": {"aws:SourceAccount": cuenta},
        "ArnLike": {"aws:SourceArn": f"arn:aws:cognito-idp:us-east-1:{cuenta}:userpool/*"},
    }


# --- dev: su propia app, infra/app_dev.py (paso 8) --------------------------

@pytest.fixture(scope="module")
def dev(cdk):
    """Los templates de la composición real de infra/app_dev.py.

    Armados por su `construir()` y no a mano, por la MISMA razón que los de
    prod: unos stacks montados aquí seguirían en verde aunque `app_dev.py`
    dejara de pasar `entorno=DEV`, que es justo el fallo que importa."""
    app_dev = importlib.import_module("app_dev")
    app = cdk.App()
    app_dev.construir(app, "sha256:" + "1" * 64)
    ensamblado = app.synth()
    return {s.stack_name: s.template for s in ensamblado.stacks}


def test_app_dev_arma_los_cuatro_stacks_y_ninguno_mas(dev):
    """`base`, `alertas` y `dominio` no se instancian a propósito: el rol OIDC
    es único y ya existe, las alertas llevan los ids de producción cableados
    (vigilarían prod con nombre de dev) y el dominio es irremplazables.xyz."""
    assert set(dev) == {"aws-media-db-dev", "aws-media-media-dev",
                        "aws-media-jobs-dev", "aws-media-api-dev"}


def test_app_dev_solo_sintetiza_bajo_main():
    """Igual que app.py: importarlo no puede construir ni hablar con AWS, o el
    fixture de arriba sintetizaría dos veces y los tests no podrían importarlo."""
    guarda = 'if __name__ == "__main__":'
    assert guarda in APP_DEV
    cabecera = APP_DEV.split(guarda, 1)[0]
    for llamada in ("app = cdk.App()", "app.synth()", "construir(app, digest)"):
        assert llamada in APP_DEV.split(guarda, 1)[1]
        assert llamada not in cabecera


def test_app_dev_le_pasa_entorno_a_los_cuatro_stacks():
    """El default de los cuatro es PROD. Olvidar un `entorno=DEV` no rompe el
    synth: deja ese stack de dev hablando con los nombres de producción."""
    cuerpo = APP_DEV[APP_DEV.index("def construir"):
                     APP_DEV.index('if __name__ == "__main__":')]
    codigo = cuerpo.split('"""')[2]   # sin el docstring, que también los nombra
    for stack in ("DbStack(", "MediaStack(", "JobsStack(", "ApiStack("):
        assert stack in codigo, f"falta {stack}"
    assert codigo.count("entorno=DEV") == 4, (
        "los cuatro stacks de dev tienen que recibir entorno=DEV")


def test_app_dev_no_toca_los_stacks_de_una_sola_cuenta():
    for prohibido in ("BaseStack", "AlertasStack", "DominioStack"):
        assert prohibido not in APP_DEV.split('"""')[2], (
            f"{prohibido} es único por cuenta: dev no lo instancia")


def test_dev_usa_sus_propios_nombres(dev):
    api, jobs = dev["aws-media-api-dev"], dev["aws-media-jobs-dev"]
    assert _uno(api, "AWS::Cognito::UserPool")["UserPoolName"] == DEV.pool
    assert _uno(api, "AWS::Cognito::UserPoolDomain")["Domain"] == DEV.dominio_cognito
    assert _uno(jobs, "AWS::StepFunctions::StateMachine")["StateMachineName"] == DEV.maquina_producir
    for e in _env_lambdas(api) + _env_lambdas(jobs):
        if "SSM_ENV_PREFIX" in e:
            assert e["SSM_ENV_PREFIX"] == DEV.ssm_env
            assert e["SSM_USUARIOS_PREFIX"] == DEV.ssm_usuarios
        if "COGNITO_DOMINIO" in e:
            assert e["COGNITO_DOMINIO"].startswith(DEV.dominio_cognito + ".auth.")


def test_nada_de_dev_apunta_a_produccion(dev):
    """El síntoma de un hueco aquí sería «el login de dev funciona»: contra el
    Hosted UI de producción, o invitando a la gente a irremplazables.xyz."""
    import copy
    import json
    for nombre, template in dev.items():
        # La ÚNICA mención permitida: el remitente del correo del pool. Es la
        # única dirección verificada en SES (el dominio no sirve como
        # SourceArn), no una liga: no manda a nadie a producción. Se quita esa
        # propiedad y se revisa todo lo demás.
        template = copy.deepcopy(template)
        for r in template["Resources"].values():
            if r["Type"] == "AWS::Cognito::UserPool":
                quitado = r["Properties"].pop("EmailConfiguration", None)
                assert quitado in (None, REMITENTE), quitado
        texto = json.dumps(template)
        assert "irremplazables.xyz" not in texto, f"{nombre} menciona el dominio de prod"
        for literal in ('"aws-media-users"', '"media-ivenaccip"',
                        '"aws-media-producir"', "/media-ivenaccip/"):
            assert literal not in texto, f"{nombre} contiene {literal}"
    pool = _uno(dev["aws-media-api-dev"], "AWS::Cognito::UserPool")
    assert pool["AdminCreateUserConfig"]["InviteMessageTemplate"]["EmailSubject"].startswith("[dev] ")


# --- y lo que dev hace DISTINTO, no solo con otro nombre --------------------

def _cluster(template):
    cs = [r for r in template["Resources"].values() if r["Type"] == "AWS::RDS::DBCluster"]
    assert len(cs) == 1, f"se esperaba un clúster, hay {len(cs)}"
    return cs[0]


def test_la_aurora_de_dev_duerme_y_la_de_prod_no(dev, prod):
    """La diferencia que paga el entorno. El suelo de 0.5 ACU de producción
    cuesta $43.80 dólares al mes esté quieto o no; dev con suelo 0 y auto-pausa
    solo paga mientras se usa. Decisión del dueño del 27-sep-2026.

    La ventana son 5 min, decidido el 28-sep: dev se usa a vistazos sueltos
    para ver un cambio, no en sesiones largas, así que no hay nada que proteger
    de un despertar y sí una hora de suelo que se pagaría sin que nadie mire.
    El valor va escrito en el stack aunque coincida con el default del CDK —
    aquí se fija para que ni un cambio de default lo mueva en silencio."""
    d = _cluster(dev["aws-media-db-dev"])["Properties"]["ServerlessV2ScalingConfiguration"]
    assert d["MinCapacity"] == 0
    assert d["SecondsUntilAutoPause"] == 300

    p_ = _cluster(prod["aws-media-db"])["Properties"]["ServerlessV2ScalingConfiguration"]
    assert p_["MinCapacity"] == 0.5, "prod no se pausa: un 503 dentro del muro de 29 s"
    assert "SecondsUntilAutoPause" not in p_


def test_la_base_de_dev_se_puede_tirar_y_la_de_prod_no(dev, prod):
    """Un entorno de pruebas que no se puede destruir deja de ser de pruebas:
    con DeletionProtection el `cdk destroy` de dev falla y hay que ir a
    apagarla a mano. Y su snapshot final sería almacenamiento pagado para
    siempre por datos que nadie va a restaurar."""
    d = _cluster(dev["aws-media-db-dev"])
    assert d["Properties"].get("DeletionProtection") is False
    assert d.get("DeletionPolicy") == "Delete"

    p_ = _cluster(prod["aws-media-db"])
    assert p_["Properties"].get("DeletionProtection") is True
    assert p_.get("DeletionPolicy") == "Snapshot"


def _relojes(template):
    return {k: r["Properties"].get("ScheduleExpression")
            for k, r in template["Resources"].items()
            if r["Type"] == "AWS::Events::Rule"}


def test_dev_no_hereda_el_reloj_de_costes_y_si_el_de_mix(dev, prod):
    """El sync de costes lee Langfuse, y dev NO comparte ese proyecto a
    propósito (`tools/ssm_env.py` se niega a subirle esas claves). Sin ellas
    fallaría a las 06:00 todos los días: ruido diario en los logs de un entorno
    donde nadie los mira, que es como se aprende a ignorarlos.

    El de MIX sí viaja, porque MIX hay que poder probarlo y para que hiciera
    daño harían falta DOS cosas a la vez que no se dan: campañas activas en la
    base de dev y la clave de Blotato de un cliente real bajo el prefijo de
    dev."""
    d = _relojes(dev["aws-media-jobs-dev"])
    assert not any(k.startswith("SyncCostes") for k in d), (
        "el reloj de costes de Langfuse no pinta nada en dev")
    assert any(k.startswith("MixReloj") for k in d)

    p_ = _relojes(prod["aws-media-jobs"])
    assert any(k.startswith("SyncCostes") for k in p_), (
        "prod SÍ lo necesita: es la base del dashboard admin")


# ---------------------------------------------------------------------------
# y el CI de verdad los corre

@pytest.mark.skipif(not WF_PATH.exists(),
                    reason="sin .github/ (dentro del contenedor) — corre en el runner")
def test_el_ci_corre_la_sintesis_antes_del_build():
    """Dentro del contenedor no hay aws_cdk y la capa 3 se salta. Sin este
    paso, la red solo existiría en la máquina de quien se acuerde de correrla."""
    wf = WF_PATH.read_text(encoding="utf-8")
    i = wf.index("- name: Nombres de producción (CDK)")
    j = wf.find("- name:", i + 10)
    paso = wf[i:j]
    assert "infra/requirements.txt" in paso
    assert "tests/test_entornos.py" in paso
    assert "EXIGIR_CDK" in paso
    assert "--noconftest" in paso
    assert "github.ref" not in paso, "tiene que correr en dev y en los PRs"
    assert i < wf.index("- name: Build de la imagen")


def test_solo_dev_manda_a_las_pantallas_nuevas(prod, dev):
    """UI_ETAPA_MINIMA sube todas las pantallas a `todos` (server/migracion.py).
    En prod no puede existir: las etapas de producción las decide PANTALLAS,
    una por una y en su deploy."""
    for template in list(prod.values()):
        for env in _env_lambdas(template):
            assert "UI_ETAPA_MINIMA" not in env
    api = [e for e in _env_lambdas(dev["aws-media-api-dev"]) if "COGNITO_DOMINIO" in e]
    assert len(api) == 1
    assert api[0]["UI_ETAPA_MINIMA"] == "todos"
    for template in (dev["aws-media-jobs-dev"],):
        for env in _env_lambdas(template):
            assert "UI_ETAPA_MINIMA" not in env, "solo la Lambda del API sirve pantallas"

