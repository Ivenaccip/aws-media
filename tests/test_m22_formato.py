"""M22 · F — formato vertical: el aspecto deja de estar clavado a 16:9.

«No tenemos un formato vertical, solo tenemos formato horizontal. Para toda
generación de imágenes y video deberíamos de agregar un formato vertical y
horizontal que puedan aplastar.» Era literal: `16:9` estaba cableado en cuatro
puntos del pipeline (Grok, Veo, el Veo del editor y el lienzo del clip de
respaldo), así que producir en vertical —el formato de reels, TikTok y Shorts—
no era cuestión de configurar nada: había que tocar código.

Los dos valores que se le mandan a fal están verificados contra el schema de
los modelos (2026-09-14): Veo 3.1 lite acepta exactamente 'auto', '16:9' y
'9:16'; Grok imagine acepta esos y muchos más.
"""
import asyncio
import json
from pathlib import Path

import pytest

from pipeline import ffmpeg, media, media_fal
from pipeline.models import FORMATOS, Scene, formato_de
from pipeline.project import Proyecto, nuevo_proyecto
from pipeline.scenes import con_formato

RAIZ = Path(__file__).resolve().parent.parent

# los únicos que fal admite: mandarle otro es un 422 del vendor, no un render feo
ASPECTOS_QUE_FAL_ACEPTA = {"auto", "16:9", "9:16"}


# ---------------------------------------------------------------------------
# la tabla

def test_los_dos_formatos_usan_aspectos_que_fal_acepta():
    assert set(FORMATOS) == {"horizontal", "vertical"}
    for nombre, f in FORMATOS.items():
        assert f["aspecto"] in ASPECTOS_QUE_FAL_ACEPTA, nombre


def test_las_medidas_concuerdan_con_el_aspecto():
    """Un lienzo que no case con el aspecto pedido daría bandas o deformación
    al concatenar, que es re-encode."""
    assert FORMATOS["horizontal"]["w"] > FORMATOS["horizontal"]["h"]
    assert FORMATOS["vertical"]["h"] > FORMATOS["vertical"]["w"]
    for f in FORMATOS.values():
        # la salida del zoompan es el mismo lienzo a 720p
        assert round(f["w"] / f["h"], 3) == round(f["w_salida"] / f["h_salida"], 3)


@pytest.mark.parametrize("valor", [None, "", "marciano", "16:9", "VERTICAL"])
def test_un_formato_raro_cae_a_horizontal(valor):
    """Proyectos anteriores a M22, un doc a medio migrar o un valor inventado:
    ninguno puede tumbar una producción."""
    assert formato_de(valor) is FORMATOS["horizontal"]


# ---------------------------------------------------------------------------
# el proyecto

@pytest.fixture
def work(tmp_path, monkeypatch):
    """`settings` es un dataclass frozen: se sustituye entero, como en el resto
    de la suite (test_creditos_c5, test_m12_hub)."""
    from types import SimpleNamespace

    from pipeline import project
    monkeypatch.setattr(project, "settings", SimpleNamespace(work_dir=tmp_path))
    return tmp_path


def test_el_proyecto_guarda_el_formato(work):
    p = nuevo_proyecto("una historia", "animated", None, 30, formato="vertical")
    assert p.formato == "vertical"
    assert json.loads(p.archivo.read_text(encoding="utf-8"))["formato"] == "vertical"


def test_un_formato_inventado_no_se_guarda(work):
    p = nuevo_proyecto("una historia", "animated", None, 30, formato="diagonal")
    assert p.formato == "horizontal"


def test_un_proyecto_de_antes_de_m22_sigue_cargando():
    """Los docs guardados no traen el campo: tienen que valer como lo que eran."""
    p = Proyecto.model_validate({"id": "abc", "creado": "2026-09-01T00:00:00",
                                 "brief": "algo"})
    assert p.formato == "horizontal"


def test_el_formato_baja_del_proyecto_a_cada_escena():
    escenas = [Scene(id=str(i), narracion="x") for i in range(3)]
    assert all(e.formato == "horizontal" for e in escenas)
    puestas = con_formato(escenas, "vertical")
    assert [e.formato for e in puestas] == ["vertical"] * 3
    assert all(e.formato == "horizontal" for e in escenas), "con_formato mutó la entrada"


# ---------------------------------------------------------------------------
# lo que se le pide a cada modelo

def _espiar_fal(monkeypatch):
    """Captura los argumentos de la llamada a fal sin salir a la red."""
    visto = {}

    async def llamar(app, args, **kw):
        visto.update(app=app, **args)
        return {"images": [{"url": "https://fal/x.jpg"}],
                "video": {"url": "https://fal/x.mp4"}}

    from pipeline import fal
    monkeypatch.setattr(fal, "llamar", llamar)
    return visto


@pytest.mark.parametrize("formato,aspecto", [("horizontal", "16:9"), ("vertical", "9:16")])
def test_grok_recibe_el_aspecto_del_proyecto(monkeypatch, formato, aspecto):
    visto = _espiar_fal(monkeypatch)
    e = Scene(id="1", narracion="x", formato=formato, prompt_imagen="un pato")
    asyncio.run(media._grok(e, e.prompt_imagen, 1))
    assert visto["aspect_ratio"] == aspecto


@pytest.mark.parametrize("formato,aspecto", [("horizontal", "16:9"), ("vertical", "9:16")])
def test_veo_recibe_el_aspecto_del_proyecto(monkeypatch, formato, aspecto):
    visto = _espiar_fal(monkeypatch)
    e = Scene(id="1", narracion="x", formato=formato,
              start_image_url="https://x/img.jpg", duracion_video=8)
    asyncio.run(media._veo(e, 1))
    assert visto["aspect_ratio"] == aspecto


@pytest.mark.parametrize("formato,w,h", [("horizontal", 1920, 1080), ("vertical", 1080, 1920)])
def test_el_clip_de_respaldo_usa_el_lienzo_del_formato(monkeypatch, tmp_path, formato, w, h):
    """Cuando Veo falla, el clip lo armamos nosotros: con 1920x1080 clavado, un
    proyecto vertical acababa con un plano apaisado en medio."""
    visto = {}

    async def run_ok(*args, contexto=""):
        visto["args"] = args
        return "", ""

    monkeypatch.setattr(ffmpeg, "_run_ok", run_ok)
    asyncio.run(ffmpeg.clip_estatico(tmp_path / "i.jpg", tmp_path / "o.mp4", 5, formato))
    vf = visto["args"][visto["args"].index("-vf") + 1]
    assert f"scale={w}:{h}" in vf and f"crop={w}:{h}" in vf
    assert f"s={w // 1.5:.0f}x{h // 1.5:.0f}" in vf.replace(".0", "")


def test_el_clip_de_respaldo_sin_formato_sigue_siendo_el_de_siempre(monkeypatch, tmp_path):
    """La firma vieja (tres argumentos) no puede cambiar de comportamiento."""
    visto = {}

    async def run_ok(*args, contexto=""):
        visto["args"] = args
        return "", ""

    monkeypatch.setattr(ffmpeg, "_run_ok", run_ok)
    asyncio.run(ffmpeg.clip_estatico(tmp_path / "i.jpg", tmp_path / "o.mp4", 5))
    vf = visto["args"][visto["args"].index("-vf") + 1]
    assert "scale=1920:1080" in vf


# ---------------------------------------------------------------------------
# el b-roll del editor: no elige formato, lo hereda

def test_el_broll_deduce_el_aspecto_de_su_imagen(monkeypatch, tmp_path):
    """El b-roll se inserta en un video que YA tiene aspecto. Pedía 16:9
    siempre, así que sobre material vertical devolvía un clip apaisado."""
    visto = _espiar_fal(monkeypatch)

    async def subir(p):
        return "https://fal/in.jpg"

    async def bajar(url, destino):
        destino.write_bytes(b"mp4")

    from pipeline import fal
    monkeypatch.setattr(fal, "subir_archivo", subir)
    monkeypatch.setattr(fal, "descargar", bajar)
    monkeypatch.setattr(media_fal, "formato_de_archivo", lambda p: "vertical",
                        raising=False)
    monkeypatch.setattr(ffmpeg, "formato_de_archivo", lambda p: "vertical")
    img = tmp_path / "base.jpg"
    img.write_bytes(b"jpg")
    asyncio.run(media_fal.video_veo(img, "un pato", 5, tmp_path / "o.mp4"))
    assert visto["aspect_ratio"] == "9:16"


def test_el_broll_acepta_que_le_digan_el_formato(monkeypatch, tmp_path):
    visto = _espiar_fal(monkeypatch)

    async def subir(p):
        return "https://fal/in.jpg"

    async def bajar(url, destino):
        destino.write_bytes(b"mp4")

    from pipeline import fal
    monkeypatch.setattr(fal, "subir_archivo", subir)
    monkeypatch.setattr(fal, "descargar", bajar)
    img = tmp_path / "base.jpg"
    img.write_bytes(b"jpg")
    asyncio.run(media_fal.video_veo(img, "un pato", 5, tmp_path / "o.mp4",
                                    formato="vertical"))
    assert visto["aspect_ratio"] == "9:16"


def test_medir_un_archivo_ilegible_no_tumba_la_produccion(tmp_path):
    """ffprobe sobre algo que no es video: el default es el de siempre."""
    basura = tmp_path / "no-es-video.mp4"
    basura.write_bytes(b"esto no es un mp4")
    assert ffmpeg.formato_de_archivo(basura) == "horizontal"


# ---------------------------------------------------------------------------
# la puerta de entrada

def test_el_formulario_ofrece_los_dos_formatos_y_los_manda():
    html = (RAIZ / "static" / "crear.html").read_text(encoding="utf-8")
    assert 'data-fmt="vertical"' in html and 'data-fmt="horizontal"' in html
    assert "fd.append('formato', formato)" in html, "el formato elegido no viaja"


@pytest.mark.parametrize("pedido,esperado", [
    ({"formato": "vertical"}, "vertical"),
    ({"formato": "horizontal"}, "horizontal"),
    ({}, "horizontal"),                      # el front viejo no lo manda
])
def test_el_endpoint_pasa_el_formato_a_nuevo_proyecto(monkeypatch, pedido, esperado):
    """Sin esto la UI enseñaría un botón que no hace nada. El 418 centinela
    prueba que se llegó hasta nuevo_proyecto (mismo truco que test_m12_hub)."""
    from fastapi import HTTPException
    from fastapi.testclient import TestClient

    from server import app as srv
    visto = {}

    def _boom(*a, **k):
        visto.update(k)
        raise HTTPException(418, "hasta aquí")

    monkeypatch.setattr(srv, "nuevo_proyecto", _boom)
    from server.app import app
    r = TestClient(app).post("/api/proyectos", data={"brief": "una idea", **pedido})
    assert r.status_code == 418
    assert visto["formato"] == esperado
