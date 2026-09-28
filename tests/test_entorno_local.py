"""Entorno dev, pasos 0 y 2: lo que NO cruza de producción a una máquina o a dev.

Dos invariantes que no se ven leyendo el diff:

1. **El archivo no se comitea.** El patrón `.env` del .gitignore NO cubre
   `.env.local` — gitignore no hace prefijos — así que el archivo con los ARN de
   la base y del secreto se subiría solo. El día que alguien reordene el
   .gitignore, este test lo dice.
2. **El cableado local no incluye lo que despacha trabajos de pago.** Con
   JOBS_BACKEND / JOBS_QUEUE_URL / PRODUCIR_SM_ARN en el entorno, un uvicorn en
   el 8011 encola en la cola de PRODUCCIÓN y el worker de prod recoge y paga.
   La lista de prohibidas vive en tools/env_local.py y este test la fija: añadir
   una variable al escritor sin sacarla de la lista (o al revés) falla aquí.

3. **Las claves que no salen de producción.** `tools/ssm_env.py` sube a SSM con
   `Overwrite=True`. Subir a dev las de Stripe reabre el apagador de los pagos
   —sin `STRIPE_WEBHOOK_SECRET` el módulo responde 503 y no sirve links— y subir
   las de Langfuse comparte el proyecto, lo que obliga a mover el label
   `production` para probar un prompt: producción cambiada en caliente y sin PR.

Los tests de nombres físicos (pool, dominio, prefijos de SSM) están en
tests/test_entornos.py; aquí va lo que cruza de un entorno a otro. Ninguno
necesita el CDK ni credenciales: corren en la imagen y en cualquier rama.
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parent.parent
if str(RAIZ) not in sys.path:
    sys.path.insert(0, str(RAIZ))

WF_PATH = RAIZ / ".github" / "workflows" / "docker.yml"

# Los tests que preguntan por `git check-ignore` miran el REPO, no la imagen:
# .dockerignore excluye .git/ a propósito y el contenedor ni siquiera trae git.
# Ahí se saltan; donde importa que corran es en el runner, y el workflow los
# corre en su primer paso («Reglas del repo»), antes del build, para fallar en
# segundos y no tras varios minutos de docker build. Mismo patrón que
# tests/test_flujo_ramas.py. El skip no es un hueco: lo vigila el último test
# de este archivo.
sin_repo = pytest.mark.skipif(
    not (RAIZ / ".git").exists(),
    reason="sin .git/ (dentro del contenedor) — corren en el runner")

from tools import env_local  # noqa: E402  (boto3 se importa dentro de funciones)

FUENTE = (RAIZ / "tools" / "env_local.py").read_text(encoding="utf-8")
CONFIG = (RAIZ / "pipeline" / "config.py").read_text(encoding="utf-8")
EJEMPLO = (RAIZ / ".env.example").read_text(encoding="utf-8")
STACKS = {k: (RAIZ / "infra" / "stacks" / f"{k}.py").read_text(encoding="utf-8")
          for k in ("api", "db", "media")}


def escritas() -> set[str]:
    """Todas las variables que el escritor pone en el archivo."""
    return ({v for v, _, _ in env_local.DESDE_STACK}
            | set(env_local.LITERALES)
            | {"COGNITO_DOMINIO"})


# ---------------------------------------------------------------------------
# 1. no se comitea

@sin_repo
@pytest.mark.parametrize("ruta", [".env.local", ".env.dev.local"])
def test_git_ignora_el_env_local(ruta):
    """Lleva DB_SECRET_ARN y el pool de Cognito. El patrón `.env` no lo cubre."""
    r = subprocess.run(["git", "check-ignore", "-q", ruta],
                       cwd=RAIZ, capture_output=True)
    assert r.returncode == 0, (
        f"git NO ignora {ruta}. El patrón `.env` del .gitignore no hace "
        "prefijos: `.env.local` y `.env.*.local` van explícitos.")


@sin_repo
@pytest.mark.parametrize("ruta", ["tools/tanda1.txt", "tools/tanda1.txt.altas.tsv"])
def test_git_ignora_las_listas_de_invitacion(ruta):
    """Las tandas y su bitácora llevan correos personales reales."""
    r = subprocess.run(["git", "check-ignore", "-q", ruta],
                       cwd=RAIZ, capture_output=True)
    assert r.returncode == 0, f"git NO ignora {ruta}, y lleva correos reales."


@sin_repo
def test_el_escritor_se_niega_si_git_no_lo_ignora(tmp_path):
    """El cinturón del propio script, no solo el .gitignore de hoy."""
    assert not env_local.git_lo_ignora(tmp_path / "cableado.txt")
    assert env_local.git_lo_ignora(RAIZ / ".env.local")


# ---------------------------------------------------------------------------
# 2. lo que paga de verdad no se escribe

def test_lo_que_despacharia_trabajos_de_pago_esta_prohibido():
    """Con estas tres, el 8011 de tu máquina encola en producción y el worker
    de prod recoge y paga la generación."""
    for var in ("JOBS_BACKEND", "JOBS_QUEUE_URL", "PRODUCIR_SM_ARN"):
        assert var in env_local.PROHIBIDAS, var


def test_el_prefijo_de_claves_de_usuario_esta_prohibido():
    """El peor de todos, y no falla: PUBLICA. Con SSM_USUARIOS_PREFIX de
    producción, claves_usuario.en_nube() da True y blotato.clave_y_origen()
    devuelve la clave de Blotato de un usuario REAL leída de SSM: cualquier
    prueba de MIX en local publica en la cuenta de redes de ese cliente."""
    assert "SSM_USUARIOS_PREFIX" in env_local.PROHIBIDAS
    assert "SSM_ENV_PREFIX" in env_local.PROHIBIDAS


def test_sin_el_prefijo_las_claves_de_usuario_son_locales():
    """Y por eso quitarlo no rompe el flujo: sin prefijo el almacén es un
    archivo bajo work/, que git ignora."""
    import pipeline.claves_usuario as cu
    assert cu.en_nube() is False, (
        "SSM_USUARIOS_PREFIX está puesto en ESTE entorno: si salió de un "
        ".env.local generado, el escritor tiene un bug.")


def test_stripe_y_langfuse_siguen_apagados():
    """Decisiones de la tarjeta del entorno dev: sin STRIPE_WEBHOOK_SECRET los
    pagos responden 503, y con LANGFUSE_PROMPTS probar un prompt en local
    exigiría mover el label `production` — producción en caliente, sin PR."""
    assert "STRIPE_WEBHOOK_SECRET" in env_local.PROHIBIDAS
    assert "LANGFUSE_PROMPTS" in env_local.PROHIBIDAS


def test_las_prohibidas_y_las_escritas_no_se_solapan():
    assert not escritas() & set(env_local.PROHIBIDAS)


def test_las_rutas_de_la_lambda_no_se_copian_a_tu_maquina():
    """MEDIA_ROOT=/data y WORK_DIR=/tmp/work son de Lambda; en Windows ni
    existen, y pisarían el MEDIA_ROOT del .env."""
    for var in ("MEDIA_ROOT", "WORK_DIR", "HOME", "PYTHONIOENCODING"):
        assert var in env_local.PROHIBIDAS, var


# ---------------------------------------------------------------------------
# 3. no deriva de infra/stacks/

@pytest.mark.parametrize("var,stack,clave", env_local.DESDE_STACK,
                         ids=[v for v, _, _ in env_local.DESDE_STACK])
def test_los_outputs_que_lee_existen_en_su_stack(var, stack, clave):
    """El escritor lee outputs por nombre. Renombrar un CfnOutput rompe la
    herramienta en tiempo de ejecución; aquí se rompe antes."""
    assert f'CfnOutput(self, "{clave}"' in STACKS[stack], (
        f"{var} sale del output {clave} de infra/stacks/{stack}.py y ahí ya no está.")


@pytest.mark.parametrize("var", sorted(env_local.LITERALES))
def test_los_literales_igualan_a_api_py(var):
    """Si api.py mueve CREDITOS_BACKEND a otro valor, el 8011 entraría con login
    real a un monedero de mentira. Mismo par literal en los dos lados."""
    assert f'"{var}": "{env_local.LITERALES[var]}"' in STACKS["api"], (
        f"{var} no vale {env_local.LITERALES[var]!r} en infra/stacks/api.py.")


def test_dev_no_lee_ningun_stack_de_prod():
    from infra.entornos import DEV, PROD
    de_dev, de_prod = env_local.stacks_de(DEV), env_local.stacks_de(PROD)
    assert not set(de_dev.values()) & set(de_prod.values())
    assert all(s.endswith("-dev") for s in de_dev.values())


# ---------------------------------------------------------------------------
# 4. el archivo se carga, y el ensayo es el default

def test_config_carga_el_env_local_despues_del_env_y_con_override():
    """Si se cargara antes, o sin override, el .env ganaría y el cableado
    generado no serviría de nada."""
    assert 'load_dotenv(ROOT / ".env.local", override=True)' in CONFIG
    assert CONFIG.index("load_dotenv()") < CONFIG.index('load_dotenv(ROOT / ".env.local"')


def test_el_ensayo_es_el_default():
    """Mismo idiom que tools/usuarios.py: sin --ejecutar no se toca nada."""
    assert "if not args.ejecutar:" in FUENTE
    assert FUENTE.index("if not args.ejecutar:") < FUENTE.index("salida.write_text(")


def test_escribir_el_cableado_de_prod_exige_teclearlo():
    assert "if entorno.es_prod:" in FUENTE
    assert 'input("Teclea PROD para confirmar: ").strip() != "PROD"' in FUENTE
    assert FUENTE.index("if entorno.es_prod:") < FUENTE.index("salida.write_text(")


def test_no_sobreescribe_sin_forzar():
    assert "salida.exists() and not args.forzar" in FUENTE


def test_la_herramienta_nunca_imprime_valores():
    """Los identificadores del stack no son secretos, pero la regla del repo es
    que no se pegan en una terminal cuyo texto acaba en un chat."""
    malas = [l.strip() for l in FUENTE.splitlines()
             if "print(" in l and ("valores[" in l or "valores.get" in l)]
    assert not malas, f"estas líneas imprimirían valores: {malas}"


# ---------------------------------------------------------------------------
# 5. lo que no cruza a un entorno que no es producción (tools/ssm_env.py)

def test_ssm_env_saca_sus_prefijos_de_entornos_py():
    """Antes eran constantes de módulo: subir claves a dev exigía editar el
    archivo, y no había forma de saber el destino hasta después de escribir."""
    from infra.entornos import DEV, PROD
    from tools import ssm_env
    assert ssm_env.prefijos(PROD) == ("/media-ivenaccip/env/", "/media-ivenaccip/usuarios/")
    assert ssm_env.prefijos(DEV) == ("/media-ivenaccip-dev/env/", "/media-ivenaccip-dev/usuarios/")
    # los dos nombres que importan otros tests siguen siendo los de producción
    assert ssm_env.PREFIJO == "/media-ivenaccip/env/"
    assert ssm_env.PREFIJO_USUARIOS == "/media-ivenaccip/usuarios/"


def test_stripe_no_sube_a_dev():
    """Decisión de la tarjeta: sin STRIPE_WEBHOOK_SECRET el módulo de pagos
    responde 503 y no sirve links. Ese apagador se queda puesto en dev."""
    from infra.entornos import DEV
    from tools import ssm_env
    suben, vetadas = ssm_env.filtrar(list(ssm_env.CLAVES), DEV)
    assert "STRIPE_WEBHOOK_SECRET" in vetadas
    assert not any(c.startswith("STRIPE_") for c in suben)


def test_langfuse_no_sube_a_dev():
    """Compartir el proyecto de Langfuse obliga a mover el label `production`
    para probar un prompt: producción cambiada en caliente y sin PR."""
    from infra.entornos import DEV
    from tools import ssm_env
    suben, vetadas = ssm_env.filtrar(list(ssm_env.CLAVES), DEV)
    assert {"LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY"} <= set(vetadas)
    assert "LANGFUSE_BASE_URL" in suben      # una URL no identifica el proyecto


def test_en_produccion_no_se_veta_nada():
    """El veto es para los entornos que NO son producción: si empezara a filtrar
    en prod, las Lambdas vivas se quedarían sin sus claves al siguiente deploy."""
    from infra.entornos import PROD
    from tools import ssm_env
    suben, vetadas = ssm_env.filtrar(list(ssm_env.CLAVES), PROD)
    assert vetadas == [] and suben == list(ssm_env.CLAVES)


def test_subir_a_produccion_exige_teclearlo():
    """put_parameter va con Overwrite=True: pisa la clave que usan las Lambdas
    vivas, sin avisar y sin guardar la anterior."""
    fuente = (RAIZ / "tools" / "ssm_env.py").read_text(encoding="utf-8")
    assert 'input("Teclea PROD para confirmar: ").strip() != "PROD"' in fuente
    assert "if entorno.es_prod and not confirmar_prod(prefijo):" in fuente
    assert fuente.index("if args.dry:") < fuente.index("ssm.put_parameter(")


# ---------------------------------------------------------------------------
# 6. tools/creditos.py: abonar no se equivoca de entorno en silencio

CREDITOS = (RAIZ / "tools" / "creditos.py").read_text(encoding="utf-8")


def test_creditos_ya_no_hereda_el_pool_de_produccion():
    """Era el peor cable de los tres: `--user correo@` se resolvía contra
    POOL_DEFAULT de tools/usuarios.py —producción, cableado— fuera cual fuera el
    clúster de destino. Con dev en pie, eso abona al `sub` de un usuario de
    producción dentro de la base de dev, sin un solo error por pantalla."""
    assert "POOL_DEFAULT" not in CREDITOS
    assert 'ap.add_argument("--pool", default=os.getenv("COGNITO_POOL_ID")' in CREDITOS


def test_sin_pool_resolver_un_correo_falla_en_vez_de_adivinar():
    assert "if not args.pool:" in CREDITOS
    assert CREDITOS.index("if not args.pool:") < CREDITOS.index("admin_get_user")


def test_abonar_confirma_antes_de_tocar_la_base():
    """La confirmación va antes de exportar los ARN y de importar pipeline.db:
    si se colara después, el primer movimiento ya estaría escrito."""
    assert "if not confirmar_abono(entorno, args.cluster_arn, resumen):" in CREDITOS
    assert (CREDITOS.index("confirmar_abono(entorno")
            < CREDITOS.index('os.environ["DB_CLUSTER_ARN"] = args.cluster_arn'))


def test_abonar_en_produccion_exige_teclearlo():
    assert 'input("Teclea PROD para confirmar: ").strip() == "PROD"' in CREDITOS


def test_solo_abonar_confirma_leer_no():
    """saldo y movimientos no preguntan nada: leer no rompe nada, y meterles una
    confirmación es la vía rápida a que alguien la aprenda de memoria."""
    assert CREDITOS.count("confirmar_abono(") == 2   # la def y su única llamada
    assert 'if args.accion == "abonar":' in CREDITOS


def test_el_entorno_del_cluster_se_pregunta_no_se_adivina():
    """El nombre físico del clúster lo genera CDK: deducir el entorno del texto
    del ARN acierta hasta el día que no."""
    assert "cluster_del_entorno" in CREDITOS
    assert "def cluster_del_entorno" in FUENTE
    assert "describe_stacks" not in CREDITOS   # la pregunta vive en un solo sitio


# ---------------------------------------------------------------------------
# 7. el skip de arriba no puede volverse un hueco

@pytest.mark.skipif(not WF_PATH.exists(),
                    reason="sin .github/ (dentro del contenedor)")
def test_los_tests_de_git_corren_fuera_del_contenedor():
    """Si este archivo sale del paso «Reglas del repo», los tests marcados con
    @sin_repo dejan de correr en TODAS partes: dentro del contenedor por falta
    de .git/, y en ningún otro lado porque nadie los correría. Entonces el
    .gitignore podría perder `.env.local` sin que nada se pusiera rojo."""
    wf = WF_PATH.read_text(encoding="utf-8")
    i = wf.index("- name: Reglas del repo")
    j = wf.find("- name:", i + 10)
    paso = wf[i:j if j != -1 else len(wf)]
    assert "test_entorno_local.py" in paso
    assert "--noconftest" in paso, (
        "sin --noconftest el runner tendría que instalar todas las deps del "
        "proyecto: tests/conftest.py importa pipeline.config")


def test_el_env_example_manda_al_env_local():
    assert "tools/env_local.py" in EJEMPLO
    for var in ("COGNITO_CLIENT_ID", "DB_SECRET_ARN"):
        assert var in EJEMPLO, f"{EJEMPLO!r} no explica dónde vive {var}"
