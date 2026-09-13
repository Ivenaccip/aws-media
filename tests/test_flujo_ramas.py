"""Dos ramas: «dev» integra, «main» es lo que corre en AWS.

La regla que este archivo defiende es una sola, y es la que separa lo que se
prueba de lo que ven los testers: hay UN entorno AWS, y la Lambda de producción
consume la etiqueta «latest» del repositorio de ECR. El CI empuja esa etiqueta.
Si el push dejara de colgar de main, un merge a dev — o un PR de cualquiera —
pondría código sin liberar a un «cdk deploy» de distancia de producción.
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


def _paso(nombre: str) -> str:
    """El bloque YAML de un paso, hasta el siguiente «- name:»."""
    i = WF.index(f"- name: {nombre}")
    j = WF.find("- name:", i + 10)
    return WF[i:j if j != -1 else len(WF)]


# ---------------------------------------------------------------------------
# la frontera con producción

@pytest.mark.parametrize("paso", [
    "Push a ECR (latest + sha)",
    "Credenciales AWS (OIDC)",
])
def test_solo_main_toca_produccion(paso):
    """dev construye y prueba; publicar es privilegio de main."""
    assert GUARDA in _paso(paso), (
        f"«{paso}» perdió la guarda de main: dev empujaría a la etiqueta que "
        "consume la Lambda de producción")


def test_ninguna_otra_rama_se_cuela_en_la_guarda():
    """Un «|| github.ref == refs/heads/dev» añadido sin pensar rompería todo."""
    assert "refs/heads/" in WF
    ramas = {l.split("refs/heads/")[1].split("'")[0]
             for l in WF.splitlines() if "refs/heads/" in l}
    assert ramas == {"main"}, f"el CI condiciona pasos a ramas de más: {ramas}"


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


def test_el_runbook_avisa_de_que_el_entorno_es_uno_solo():
    """El malentendido caro sería creer que dev es un lugar seguro en la nube."""
    seccion = DOC.split("## Ramas")[1].split("## Deploy")[0]
    assert "UN entorno AWS" in seccion


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
