"""La política de retención de ECR: lo que no puede cambiar sin pensarlo.

Contexto de por qué existe (medido el 2026-09-14): el repositorio tenía 86
imágenes y 122 GB —el 43% de la factura— porque nada las borraba. Y crecía de
verdad: dos builds consecutivos solo comparten 4 de sus 17 capas, así que cada
merge a `main` sube ~1,6 GB genuinamente nuevos.

Estos tests no hablan con AWS. Fijan las tres decisiones del archivo que, si
alguien las cambia sin darse cuenta, o dejan la política sin efecto o se llevan
por delante la imagen que corre producción.
"""
import json
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
POLITICA = RAIZ / "infra" / "ecr-lifecycle.json"

DATOS = json.loads(POLITICA.read_text(encoding="utf-8"))
REGLAS = DATOS["rules"]


def test_hay_exactamente_una_regla():
    """Con varias reglas hay que razonar sobre prioridades y sobre qué regla
    reclama cada imagen. Una sola se entiende de un vistazo."""
    assert len(REGLAS) == 1


def test_selecciona_todas_las_imagenes_no_solo_las_sin_tag():
    """La regla de manual —«expira las untagged»— aquí no liberaría ni un byte:
    las 86 imágenes tienen tag, porque el CI etiqueta cada build con su sha."""
    assert REGLAS[0]["selection"]["tagStatus"] == "any"


def test_conserva_un_margen_que_aguante_el_retraso_de_produccion():
    """Las Lambdas apuntan a un digest, no al tag `latest`.

    Si la imagen desplegada cae fuera de las que se conservan, la función deja
    de poder arrancar contenedores nuevos. Ya ha pasado estar tres PRs por
    detrás, así que el margen no puede ser ajustado.
    """
    sel = REGLAS[0]["selection"]
    assert sel["countType"] == "imageCountMoreThan"
    assert sel["countNumber"] >= 15, (
        "menos de 15 deja a producción a un par de merges de que le borren su "
        "imagen; comprueba con tools/ecr_preview.py antes de bajarlo")


def test_la_descripcion_cabe_en_el_limite_de_ecr():
    """ECR rechaza la política entera si pasa de 255 caracteres, y el error solo
    aparece al aplicarla contra AWS — aquí se ve antes."""
    desc = REGLAS[0]["description"]
    assert 0 < len(desc) <= 255, f"{len(desc)} caracteres"


def test_la_descripcion_explica_el_riesgo():
    """Es lo único que verá quien abra la consola de ECR dentro de seis meses."""
    desc = REGLAS[0]["description"].lower()
    assert "digest" in desc, "sin esto, nadie sabrá por qué el número importa"


def test_la_accion_es_expirar():
    assert REGLAS[0]["action"]["type"] == "expire"


def test_existe_la_herramienta_de_comprobacion():
    """El runbook manda correrla antes de aplicar; si desaparece, el
    procedimiento documentado deja de poder seguirse."""
    assert (RAIZ / "tools" / "ecr_preview.py").exists()


# ---------------------------------------------------------------------------
# Qué imagen se despliega (19-sep). El synth no se puede importar en un test
# —`infra/app.py` sintetiza los cinco stacks al importarse— así que estas tres
# decisiones se fijan leyendo el archivo, como ya se hace con el worker.

APP = (RAIZ / "infra" / "app.py").read_text(encoding="utf-8")


def test_se_puede_nombrar_la_imagen_que_se_despliega():
    """Sin esto, `cdk deploy` significa «pon lo que haya en :latest»: todo lo
    mergeado desde el último deploy, lo haya probado alguien o no. Un arreglo
    urgente arrastraba con él cualquier cosa que estuviera esperando."""
    assert 'IMAGE_TAG = os.getenv("IMAGE_TAG", "latest")' in APP
    assert "_digest_de(IMAGE_TAG)" in APP


def test_un_tag_que_no_existe_para_el_deploy_en_vez_de_caer_a_latest():
    """El peor final posible de una vuelta atrás es desplegar OTRA imagen sin
    avisar. Si el tag lo pidió una persona y no se resuelve, se para."""
    cuerpo = APP[APP.index("def _digest_de"):APP.index("app = cdk.App()")]
    assert "raise SystemExit" in cuerpo
    assert 'if ref != "latest"' in cuerpo, (
        "solo el default puede caer a 'latest': es lo que deja sintetizar sin "
        "credenciales")


def test_el_deploy_dice_en_voz_alta_que_imagen_pone():
    """El digest es ilegible y el tag no sale en el diff de CDK: si no se
    imprime, nadie puede comprobar que desplegó lo que quería."""
    assert 'print(f"imagen: {IMAGE_TAG} -> {digest}"' in APP
