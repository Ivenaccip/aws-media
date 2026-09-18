"""M23 · B — el modelo de imagen es Grok, y los dos endpoints no se cruzan.

Por qué existe este archivo: al mapear el cambio salió que **no se rompía ni un
test**. La suite se quedaba verde entera describiendo un modelo que ya no se
llamaba, y ningún test del repo mira una imagen de salida. Eso no es una red,
es su ausencia.

Lo que se defiende aquí:
  * que ningún id de imagen apunte a `nano-banana` — es `gemini-2.5-flash-image`
    y Google lo apaga el 2026-10-02, nueve días después del lanzamiento;
  * que SIN referencia se llame al modelo de crear y CON referencia al de
    editar. Cruzarlos no revienta: el de editar copia el encuadre «de la
    primera imagen de entrada» y sin entrada no tiene ninguno, y el camino que
    más lo sufre —las opciones de personaje— atrapa toda excepción y devuelve
    None, dejando el proyecto varado sin error a la vista;
  * que el aspecto viaje SIEMPRE escrito, para que el encuadre no dependa del
    valor por defecto del modelo de turno;
  * que el pincel no pase del tope de imágenes que acepta el endpoint;
  * y que el precio que se le enseña al usuario sea el del modelo que de
    verdad se llama.

Sin red: fal mockeado. Lo que solo se puede saber pagando (si Grok respeta la
marca del pincel) se probó a mano el 2026-09-18 — 8 llamadas, ~$0.18 dólares —
y quedó anotado en PLAN-PRODUCTO.md; un test no puede mirar una imagen.
"""
import asyncio
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

RAIZ = Path(__file__).resolve().parent.parent

# el modelo que Google apaga el 2026-10-02 (fal-ai/nano-banana ES ese modelo)
MUERTO = ("nano-banana", "gemini-2.5-flash-image")


@pytest.fixture
def espia(monkeypatch, tmp_path):
    """Apunta qué app de fal se llamó y con qué argumentos."""
    from pipeline import fal
    vistos = []

    async def llamar(app, args, timeout_s, nombre, meta=None):
        vistos.append({"app": app, "args": args, "nombre": nombre})
        return {"images": [{"url": "https://fal/x.jpg"}]}

    async def descargar(url, destino):
        Path(destino).write_bytes(b"x")
        return destino

    async def subir(path):
        return f"https://fal/subida/{Path(path).name}"
    monkeypatch.setattr(fal, "llamar", llamar)
    monkeypatch.setattr(fal, "descargar", descargar)
    monkeypatch.setattr(fal, "subir_archivo", subir)
    return vistos


# ---------------------------------------------------------------------------
# el modelo

def test_ningun_id_de_imagen_apunta_al_modelo_que_se_apaga():
    from pipeline.config import settings
    for campo in ("fal_imagen", "fal_imagen_edit"):
        valor = getattr(settings, campo)
        assert not any(m in valor for m in MUERTO), f"{campo} sigue en {valor}"


def test_el_modelo_se_puede_cambiar_sin_desplegar():
    """El selector de modelos que viene después tiene que ser configuración.
    Entre el lanzamiento (23-sep) y el apagón (2-oct) hay nueve días: si el id
    solo vive en el código, cambiarlo exige build de imagen y deploy de dos
    stacks con 182 usuarios dentro."""
    texto = (RAIZ / "pipeline" / "config.py").read_text(encoding="utf-8")
    assert 'os.getenv("FAL_IMAGEN"' in texto
    assert 'os.getenv("FAL_IMAGEN_EDIT"' in texto


def test_crear_y_editar_son_endpoints_distintos():
    from pipeline.config import settings
    assert settings.fal_imagen != settings.fal_imagen_edit


# ---------------------------------------------------------------------------
# el cruce que rompe en silencio

def test_sin_referencia_va_al_de_crear(espia, tmp_path):
    from pipeline import media_fal
    from pipeline.config import settings
    asyncio.run(media_fal.imagen_fal("un faro", tmp_path / "a.jpg"))
    assert espia[0]["app"] == settings.fal_imagen
    assert "image_urls" not in espia[0]["args"]


def test_con_referencia_va_al_de_editar(espia, tmp_path):
    from pipeline import media_fal
    from pipeline.config import settings
    ref = tmp_path / "ref.jpg"
    ref.write_bytes(b"x")
    asyncio.run(media_fal.imagen_fal("un faro", tmp_path / "a.jpg", referencia=ref))
    assert espia[0]["app"] == settings.fal_imagen_edit
    assert len(espia[0]["args"]["image_urls"]) == 1


def test_las_opciones_de_personaje_sin_referencia_no_van_al_de_editar(espia, tmp_path, monkeypatch):
    """El camino más silencioso del repo: `_opcion_sin_ref` atrapa TODA
    excepción y devuelve None, así que si esto se rompe el usuario no ve un
    error — ve un proyecto varado en revisión con cero opciones, que es
    exactamente el bug que M1 existió para arreglar."""
    from pipeline import character
    from pipeline.config import settings

    class ProyectoFalso:
        workdir = tmp_path

    asyncio.run(character._opcion_sin_ref(ProyectoFalso(), "una niña con paraguas", 0))

    assert espia, "no llamó al modelo"
    assert espia[0]["app"] == settings.fal_imagen


# ---------------------------------------------------------------------------
# el encuadre y el tope de imágenes

def test_el_aspecto_siempre_viaja_escrito(espia, tmp_path):
    """Sin esto el encuadre lo decide el valor por defecto del modelo, y ese
    valor cambia cuando cambia el modelo."""
    from pipeline import media_fal
    asyncio.run(media_fal.imagen_fal("un faro", tmp_path / "a.jpg"))
    assert espia[0]["args"]["aspect_ratio"] == "1:1"


def test_el_pincel_manda_dos_imagenes_y_cabe_en_el_tope(espia, tmp_path):
    """El endpoint de edición documenta un máximo de 3 imágenes de entrada.
    El pincel manda 2 —la original y la marcada— y ese es todo el «inpainting»
    que hay: ninguna máscara, una instrucción."""
    from pipeline import media_fal
    a, b = tmp_path / "a.jpg", tmp_path / "b.jpg"
    a.write_bytes(b"x")
    b.write_bytes(b"y")
    asyncio.run(media_fal.imagen_pincel("ponle un sombrero", a, b, tmp_path / "out.jpg"))
    assert len(espia[0]["args"]["image_urls"]) == 2 <= 3


def test_transformar_manda_una(espia, tmp_path):
    from pipeline import media_fal
    a = tmp_path / "a.jpg"
    a.write_bytes(b"x")
    asyncio.run(media_fal.imagen_transformar("a acuarela", a, tmp_path / "out.jpg"))
    assert len(espia[0]["args"]["image_urls"]) == 1


# ---------------------------------------------------------------------------
# el dinero

def test_el_precio_que_se_enseña_es_el_del_modelo_que_se_llama():
    """`estimar_regeneracion` es lo que el popup del b-roll enseña ANTES de
    cobrar, y ese número también se guarda en el libro de gastos del proyecto.
    Cotizar el modelo viejo no revienta nada: miente hacia arriba, que es la
    dirección que parece inofensiva."""
    from pipeline.config import settings
    from pipeline.pricing import costo_fal, estimar_regeneracion
    est = estimar_regeneracion(6.5, n_imagenes=1, backend="fal")
    # el b-roll manda una referencia: el precio real de esa llamada
    real = costo_fal(settings.fal_imagen_edit,
                     {"prompt": "x", "num_images": 1, "image_urls": ["u"]})
    assert est["imagen"] == pytest.approx(real)


def test_los_precios_salen_del_json_y_no_del_codigo():
    tarifas = json.loads((RAIZ / "tools" / "pricing.json").read_text(encoding="utf-8"))
    grok = tarifas["generacion"]["grok_edit"]
    from pipeline import pricing
    assert pricing.GROK_EDIT_SALIDA == grok["usd_por_imagen_salida"]
    assert pricing.GROK_EDIT_ENTRADA == grok["usd_por_imagen_referencia"]
    # la nota tiene que decir que la misma salida sirve para los dos endpoints:
    # es la razón por la que crear no necesita entrada propia
    assert "grok_nota" in tarifas["generacion"]
