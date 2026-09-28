"""Dos ramas: «dev» integra, «main» es lo que corre en producción.

LA REGLA CAMBIÓ DE FORMA EL 2026-09-28, Y CONVIENE SABER POR QUÉ

Antes decía «solo main toca el ECR». Era correcta mientras hubo UN entorno AWS:
la Lambda de producción resuelve su digest desde la etiqueta «latest» de ese
repositorio, así que cualquier push desde dev dejaba código sin liberar a un
«cdk deploy» de distancia de los usuarios.

Ya hay dos entornos (infra/app_dev.py), y dev necesita sus propias imágenes o no
sirve para lo que se creó. Así que la regla se estrecha hasta lo que de verdad
protege producción, que siempre fue una sola cosa:

    «latest» SOLO se escribe desde main.

dev sube «dev-<sha>» y nada más. Esa imagen no llega a producción sola: hay que
NOMBRARLA con IMAGE_TAG, y el nombre dice de dónde viene.

Ensanchar la regla otra vez —dejar que dev escriba «latest», o volver a
«--all-tags»— reabre exactamente el agujero que la versión vieja cerraba.
"""
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parent.parent
WF_PATH = RAIZ / ".github" / "workflows" / "docker.yml"
DOC_PATH = RAIZ / "docs" / "OPERACION.md"

# Estos tests miran el REPO, no la imagen. La suite corre también dentro del
# contenedor, y .dockerignore excluye .github/ a propósito — el CI no tiene nada
# que hacer en la imagen de producción. Ahí se saltan; donde de verdad importa
# que corran es en el runner, y el propio workflow los corre en su primer paso
# («Reglas del repo»), antes del build, para fallar en segundos y no en minutos.
pytestmark = pytest.mark.skipif(
    not WF_PATH.exists(),
    reason="sin .github/ (dentro del contenedor) — corren en el runner")

WF = WF_PATH.read_text(encoding="utf-8") if WF_PATH.exists() else ""
DOC = DOC_PATH.read_text(encoding="utf-8") if DOC_PATH.exists() else ""

GUARDA = "if: github.ref == 'refs/heads/main'"
PUSH_MAIN = "Push a ECR desde main (latest + sha)"
PUSH_DEV = "Push a ECR desde dev (dev-sha, nunca latest)"


def _comandos(texto: str) -> str:
    """Lo que el runner EJECUTA: sin comentarios y sin los `- name:`.

    Hace falta porque el nombre de un paso y los comentarios de este workflow
    nombran «latest» y «--all-tags» precisamente para prohibirlos. Un test que
    buscara la cadena en el texto crudo fallaría por la explicación de la regla
    en vez de por una infracción — y se «arreglaría» borrando el comentario."""
    return "\n".join(l for l in texto.splitlines()
                      if not l.strip().startswith("#")
                      and not l.strip().startswith("- name:"))


def _paso_de(linea_idx: int) -> str:
    """En qué paso cae una línea del workflow, buscando hacia atrás.

    Se hace así y no troceando por pasos porque los comentarios que preceden a
    un «- name:» caen dentro del trozo del paso ANTERIOR, y uno de esos
    comentarios habla de «latest» justo para decir que dev no lo toca."""
    lineas = WF.splitlines()
    for i in range(linea_idx, -1, -1):
        if lineas[i].lstrip().startswith("- name:"):
            return lineas[i].split("- name:", 1)[1].strip()
    return "(ninguno)"


def _paso(nombre: str) -> str:
    """El bloque YAML de un paso, hasta el siguiente «- name:»."""
    i = WF.index(f"- name: {nombre}")
    j = WF.find("- name:", i + 10)
    return WF[i:j if j != -1 else len(WF)]


# ---------------------------------------------------------------------------
# la frontera con producción

def test_solo_main_escribe_latest():
    """LA regla. Es la única etiqueta que la Lambda de producción resuelve sola.

    Se comprueba por línea y no por paso a propósito: da igual cómo se llame el
    paso o cuántos haya — si en algún sitio del workflow se escribe «latest»,
    ese sitio tiene que colgar de main y de nada más."""
    culpables = []
    for i, linea in enumerate(WF.splitlines()):
        if "aws-media:latest" not in linea:
            continue
        paso = _paso_de(i)
        if paso != PUSH_MAIN:
            culpables.append(f"línea {i + 1}, en «{paso}»")
    assert not culpables, (
        "se escribe la etiqueta latest fuera del paso de main: "
        + ", ".join(culpables))


def test_el_paso_que_escribe_latest_cuelga_solo_de_main():
    """La otra mitad: que ese paso no gane un «|| dev» con el tiempo."""
    cabecera = _paso(PUSH_MAIN).split("run:")[0]
    condiciones = [l.strip() for l in cabecera.splitlines() if l.strip().startswith("if:")]
    assert condiciones == [GUARDA.replace("if: ", "if: ")], (
        f"el push de latest cuelga de {condiciones}, no solo de main")
    assert "refs/heads/dev" not in cabecera


def test_el_push_de_dev_no_toca_latest():
    """dev sube «dev-<sha>». Si alguna vez escribe «latest», el siguiente
    «cdk deploy» de producción —hecho desde donde fuera— se lleva código sin
    liberar a los usuarios, que es justo lo que este archivo existe para
    impedir."""
    paso = _paso(PUSH_DEV)
    assert "refs/heads/dev" in paso, "el push de dev perdió su guarda"
    assert "latest" not in _comandos(paso), "el push de dev escribe latest"
    assert "dev-${{ github.sha }}" in paso, (
        "la imagen de dev tiene que llevar el sha: sin él nadie sabe qué código "
        "lleva dentro, y IMAGE_TAG deja de poder nombrarla")


def test_ningun_push_usa_all_tags():
    """«--all-tags» sube TODAS las etiquetas locales del repositorio. Un
    «latest» colgando en el daemon del runner viajaría desde dev sin que nadie
    lo pidiera. Los dos pushes son explícitos."""
    assert "--all-tags" not in _comandos(WF), (
        "vuelve a haber un push con --all-tags: nombra las etiquetas una a una")


def test_ninguna_otra_rama_se_cuela_en_la_guarda():
    """main y dev, y ni una más. Una rama de trabajo cualquiera empujando al
    ECR gasta el margen del lifecycle que protege la imagen desplegada
    (infra/ecr-lifecycle.json, tools/ecr_preview.py)."""
    assert "refs/heads/" in WF
    # TODAS las de cada línea, no la primera. Desde que las condiciones son
    # «main || dev» hay dos por línea, y quedarse con la primera dejaba entrar
    # una tercera rama sin que nadie se enterara — lo cazó una mutación del
    # workflow, no la lectura del test.
    ramas = {trozo.split("'")[0]
             for l in WF.splitlines() if "refs/heads/" in l
             for trozo in l.split("refs/heads/")[1:]}
    assert ramas == {"main", "dev"}, (
        f"el CI condiciona pasos a ramas de más: {ramas}")


def test_las_credenciales_de_aws_solo_salen_en_main_y_dev():
    """El rol OIDC solo sabe subir al ECR —no despliega— pero pedir sus
    credenciales en un PR de cualquiera es regalar un token que no hace falta."""
    paso = _paso("Credenciales AWS (OIDC)")
    assert "refs/heads/main" in paso and "refs/heads/dev" in paso
    assert "role/aws-media-github-ecr" in paso, (
        "el rol cambió: comprueba que el nuevo tampoco puede desplegar")


# ---------------------------------------------------------------------------
# pero dev y los PRs sí se validan

def test_dev_y_los_prs_corren_la_suite():
    """De nada sirve integrar en dev si nadie la prueba."""
    assert "branches: [main, dev]" in WF, "dev no dispara el CI"
    assert "\n  pull_request:\n" in WF, "los PRs no disparan el CI"


@pytest.mark.parametrize("paso", [
    "Build de la imagen",
    "Suite de tests dentro del contenedor",
    "Smoke del server (sin .env, MEDIA_ROOT vacío)",
])
def test_la_validacion_corre_en_todas_las_ramas(paso):
    assert GUARDA not in _paso(paso), (
        f"«{paso}» quedó condicionado a main: dev dejaría de validarse")


# ---------------------------------------------------------------------------
# y está escrito donde el dueño lo busca

def test_el_runbook_explica_las_dos_ramas():
    assert "## Ramas" in DOC
    for pieza in ("`main`", "`dev`", "cdk deploy"):
        assert pieza in DOC.split("## Ramas")[1].split("## Deploy")[0], \
            f"la sección Ramas no menciona {pieza}"


def test_el_runbook_dice_donde_se_ve_dev_y_que_imagen_corre():
    """Sustituye al test que exigía la frase «hay UN entorno AWS», cierta hasta
    el 2026-09-28 y falsa desde el deploy de los stacks -dev.

    El malentendido caro ya no es creer que dev existe: es creer que dev corre
    lo que tienes en tu rama. Corre lo que se haya mergeado a `dev` y subido al
    ECR como `dev-<sha>`, y solo después de que alguien lo despliegue a mano."""
    seccion = DOC.split("## Ramas")[1].split("## Deploy")[0]
    assert "execute-api" in seccion, (
        "la tabla «dónde se ve cada una» tiene que dar la liga de dev")
    for pieza in ("dev-", "IMAGE_TAG", "app_dev.py"):
        assert pieza in seccion, (
            f"la sección Ramas no explica {pieza}: sin eso nadie sabe cómo llega "
            "una imagen de dev al entorno dev")


def test_las_reglas_del_repo_corren_fuera_del_contenedor():
    """Si este paso desaparece, los tests de arriba se saltan en TODAS partes:
    dentro del contenedor por falta de .github/, y en ningún otro lado porque
    nadie los corre. El skip dejaría de ser inofensivo y pasaría a ser un hueco."""
    paso = _paso("Reglas del repo")
    assert "test_flujo_ramas.py" in paso
    assert "--noconftest" in paso, (
        "sin --noconftest el runner tendría que instalar todas las deps del "
        "proyecto: tests/conftest.py importa pipeline.config")
    assert GUARDA not in paso, "las reglas del repo también valen en dev y en los PRs"
