"""tools/probar_modelo.py: la prueba pagada pequeña de un modelo del selector.

Lo que este archivo defiende:
  * el ensayo (sin --si) no llama a nada, no pide clave y no crea carpetas, y
    enseña lo que el adaptador REAL mandaría: endpoint, argumentos, costo en
    dólares y créditos (o «sin precio confirmado» / «sin número en tarifas.json»);
  * con --si y sin FAL_KEY, o con una duración que el modelo no admite, o sin
    ffprobe, sale con 2 y NO llama (nada se gasta si algo no se puede comprobar);
  * la clave de fal jamás sale en pantalla, ni dentro de un mensaje de error, ni
    en el log de una librería (sale por logging directo a stderr), ni en su forma
    escapada o a medias (id:secreto); una clave con espacios se rechaza;
  * un solo intento de llamada de nuestro lado: el reintento del clip se corta;
  * la respuesta pagada no se pierde: su URL se imprime antes de descargar y en todo
    fallo posterior, y la carpeta de salida se prueba ANTES de gastar;
  * la imagen de entrada se mide antes de gastar (vacía, ilegible, lado corto,
    relación 16:9 / 9:16, formato deducido) y --imagen-sin-validar salta solo la regla;
  * lo descargado nunca pisa lo que ya estaba, y se mide con ffprobe (tamaño,
    segundos y si trae pista de audio); un parcial que no se deja borrar no tapa el éxito;
  * lo medido se compara con lo prometido, incluido el 1K de Nano Banana 2 y el
    tiempo de la llamada contra su timeout;
  * un pedido mal hecho (editar sin imagen, modelo desconocido) da un error
    claro, no una traza; todo fallo de preflight sale con 2 (no se gastó nada).

Sin red: fal, la descarga y ffprobe están sustituidos. Los tests usan veo-lite y
grok, que ya existen; el único que toca veo-fast se salta si aún no resuelve.

OJO: nada de importar pipeline a nivel de módulo (ver test_m25_clip).
"""
from __future__ import annotations

import importlib.util
import json
import logging
import os
import re
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

RAIZ = Path(__file__).resolve().parent.parent
_spec = importlib.util.spec_from_file_location("probar_modelo", RAIZ / "tools" / "probar_modelo.py")
probar = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(probar)

CLAVE = "clave-secreta-de-prueba-123"
NO_LLAMO = "NO se llamó a nada. Para gastar de verdad, repite el comando con --si."
SIN_NUMERO = "sin número en tarifas.json: todavía no se ofrece"
PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 16

MEDIDA_CLIP = {"ancho": 1280, "alto": 720, "segundos": 4.04, "audio": True, "codec_audio": "aac"}
MEDIDA_IMAGEN = {"ancho": 1280, "alto": 720, "segundos": None, "audio": False, "codec_audio": None}


class Entorno:
    """fal, la descarga y ffprobe falsos, con la cuenta de lo que se les pidió."""

    def __init__(self):
        self.llamadas: list[tuple[str, dict]] = []     # (endpoint, argumentos) de fal.llamar
        self.subidas: list[Path] = []
        self.descargas: list[tuple[str, Path]] = []
        self.medidos: list[Path] = []
        self.resultado: dict = {"video": {"url": "https://fal.invalid/v/salida.mp4"}}
        self.error: Exception | None = None             # lo que levanta fal.llamar
        self.medida: dict = dict(MEDIDA_CLIP)
        # lo que mide ffprobe de una IMAGEN DE ENTRADA concreta (ruta → medida, o una excepción)
        self.medidas_entrada: dict[Path, dict | Exception] = {}
        self.n_descargas = 0


@pytest.fixture
def env(monkeypatch, tmp_path):
    from pipeline import fal
    e = Entorno()

    async def llamar(app, argumentos, timeout_s=None, nombre=None, meta=None):
        e.llamadas.append((app, dict(argumentos)))
        if e.error:
            raise e.error
        return e.resultado

    async def subir_archivo(path):
        e.subidas.append(Path(path))
        return "https://fal.invalid/subida.png"

    async def descargar(url, destino):
        e.n_descargas += 1
        e.descargas.append((url, destino))
        destino.parent.mkdir(parents=True, exist_ok=True)
        destino.write_bytes(f"contenido-{e.n_descargas}".encode())
        return destino

    def medir(ruta):
        ruta = Path(ruta)
        assert ruta.is_file(), "se mide un archivo que existe"
        e.medidos.append(ruta)
        entrada = e.medidas_entrada.get(ruta)
        if isinstance(entrada, Exception):
            raise entrada
        return dict(entrada if entrada is not None else e.medida)

    monkeypatch.setattr(fal, "llamar", llamar)
    monkeypatch.setattr(fal, "subir_archivo", subir_archivo)
    monkeypatch.setattr(fal, "descargar", descargar)
    monkeypatch.setattr(probar, "_medir", medir)
    monkeypatch.setattr(probar, "_ffprobe_exe", lambda: "ffprobe")
    monkeypatch.setattr(probar, "_cargar_env", lambda: None)   # el .env real no se toca
    monkeypatch.setenv("FAL_KEY", CLAVE)
    monkeypatch.chdir(tmp_path)                                  # work/probar_modelo cae en tmp
    return e


@pytest.fixture
def foto(tmp_path):
    ruta = tmp_path / "foto.png"
    ruta.write_bytes(PNG)
    return ruta


def _correr(capsys, *argv):
    code = probar.main([str(a) for a in argv])
    salida = capsys.readouterr()
    return code, salida.out, salida.err


# ---------------------------------------------------------------------------
# el ensayo: enseña, no gasta

def test_el_ensayo_enseña_endpoint_argumentos_costo_y_creditos_sin_llamar(env, capsys, tmp_path):
    from pipeline import clip, creditos, modelos_ia
    salida = tmp_path / "no_debe_existir"
    code, out, err = _correr(capsys, "clip", "veo-lite", "--segundos", 4, "--salida", salida)

    assert code == 0 and err == ""
    assert env.llamadas == [] and env.subidas == [] and env.descargas == []
    assert "ENSAYO" in out and "clip" in out and "veo-lite" in out
    assert modelos_ia.resolver("clip", "veo-lite").endpoint_para(False) in out
    assert '"duration": "4s"' in out and '"generate_audio": true' in out
    esperado = clip.costo_usd(0, "veo-lite", 4)
    assert f"${esperado:.4f} dólares" in out
    assert re.search(r"\$\d+\.\d{4} dólares", out)
    assert f"{creditos.costo_modelo('clip', 'veo-lite', 4)} créditos" in out
    assert NO_LLAMO in out
    assert not salida.exists()                         # el ensayo no crea carpetas


def test_el_ensayo_de_un_clip_con_imagen_usa_el_endpoint_de_imagen_a_video(env, capsys, foto):
    from pipeline import clip, modelos_ia
    code, out, _ = _correr(capsys, "clip", "veo-lite", "--segundos", 6, "--imagen", foto)

    assert code == 0 and NO_LLAMO in out
    assert modelos_ia.resolver("clip", "veo-lite").endpoint_para(True) in out
    assert "image_url" in out
    assert f"${clip.costo_usd(1, 'veo-lite', 6):.4f} dólares" in out
    assert env.llamadas == [] and env.subidas == []    # ni siquiera sube la imagen


def test_el_ensayo_de_imagen_manda_el_aspecto_del_formato(env, capsys):
    from pipeline import creditos, modelos_ia
    code, out, _ = _correr(capsys, "imagen", "grok", "--formato", "vertical")

    assert code == 0 and env.llamadas == []
    assert modelos_ia.resolver("imagen", "grok").endpoint_para(False) in out
    assert '"aspect_ratio": "9:16"' in out and '"num_images": 1' in out
    assert re.search(r"\$\d+\.\d{4} dólares", out)
    assert f"{creditos.costo_modelo('imagen', 'grok')} créditos" in out


def test_el_ensayo_de_editar_lleva_la_imagen_y_el_endpoint_de_editar(env, capsys, foto):
    from pipeline import modelos_ia, pricing
    code, out, _ = _correr(capsys, "editar", "grok", "--imagen", foto, "--prompt", "pásala a óleo")

    assert code == 0 and env.llamadas == []
    endpoint = modelos_ia.resolver("editar", "grok").endpoint_para(True)
    assert endpoint in out and "image_urls" in out and "pásala a óleo" in out
    esperado = pricing.costo_fal(endpoint, {"num_images": 1, "image_urls": ["x"]})
    assert f"${esperado:.4f} dólares" in out


def test_sin_ficha_de_precio_dice_sin_precio_confirmado(env, capsys, monkeypatch):
    from pipeline import pricing
    monkeypatch.setattr(pricing, "costo_fal", lambda app, args: None)
    code, out, _ = _correr(capsys, "imagen", "grok")
    assert code == 0 and "sin precio confirmado" in out
    assert "$" not in out.split("costo esperado:")[1].split("\n")[0]


def test_un_clip_sin_costo_conocido_dice_sin_precio_confirmado(env, capsys, monkeypatch):
    from pipeline import clip
    def sin_costo(*a, **k):
        raise clip.ClipError("Sin costo conocido para el modelo veo-lite")
    monkeypatch.setattr(clip, "costo_usd", sin_costo)
    code, out, _ = _correr(capsys, "clip", "veo-lite", "--segundos", 4)
    assert code == 0 and "sin precio confirmado" in out and NO_LLAMO in out


def test_sin_numero_en_tarifas_dice_que_todavia_no_se_ofrece(env, capsys, monkeypatch):
    from pipeline import creditos
    monkeypatch.setattr(creditos, "MODELOS_CR", {})
    code, out, _ = _correr(capsys, "clip", "veo-lite", "--segundos", 4)
    assert code == 0 and SIN_NUMERO in out


def test_veo_fast_en_ensayo_se_salta_si_aun_no_esta_en_la_tabla(env, capsys):
    from pipeline import clip, creditos, modelos_ia
    try:
        m = modelos_ia.resolver("clip", "veo-fast")
    except modelos_ia.ModeloDesconocido:
        pytest.skip("veo-fast todavía no resuelve en pipeline/modelos_ia.py")
    code, out, _ = _correr(capsys, "clip", "veo-fast", "--segundos", 4)
    assert code == 0 and env.llamadas == [] and m.endpoint_para(False) in out
    try:
        costo = f"${clip.costo_usd(0, 'veo-fast', 4):.4f} dólares"
    except clip.ClipError:
        costo = "sin precio confirmado"
    assert costo in out
    try:
        cr = f"{creditos.costo_modelo('clip', 'veo-fast', 4)} créditos"
    except KeyError:
        cr = SIN_NUMERO
    assert cr in out


def test_sin_si_no_se_pide_la_clave_ni_se_lee_el_env(env, capsys, monkeypatch):
    monkeypatch.delenv("FAL_KEY", raising=False)

    def no_debe_leer():
        raise AssertionError("el ensayo no necesita la clave: no debe leer el .env")
    monkeypatch.setattr(probar, "_cargar_env", no_debe_leer)
    code, out, err = _correr(capsys, "clip", "veo-lite", "--segundos", 4)
    assert code == 0 and "FAL_KEY" not in err and NO_LLAMO in out


@pytest.mark.parametrize("si", [[], ["--si"]])
def test_si_el_adaptador_y_la_tabla_no_concuerdan_no_se_gasta_y_sale_con_2(env, capsys, monkeypatch, foto, si):
    from pipeline import modelos_ia
    monkeypatch.setattr(modelos_ia.Modelo, "endpoint_para", lambda self, con_imagen: "fal-ai/otro")
    code, out, err = _correr(capsys, "editar", "grok", "--imagen", foto, *si)
    assert code == 2 and env.llamadas == [] and env.subidas == []     # 2 = no se gastó nada
    assert "fal-ai/otro" in err and "No se gasta nada" in err
    assert "Request Details" not in err                               # con 0 llamadas no hay cobro que revisar


# ---------------------------------------------------------------------------
# --si: todo lo comprobable se comprueba ANTES de gastar

def test_con_si_y_sin_clave_sale_con_2_y_no_llama(env, capsys, monkeypatch, tmp_path):
    monkeypatch.delenv("FAL_KEY", raising=False)
    salida = tmp_path / "s"
    code, out, err = _correr(capsys, "clip", "veo-lite", "--segundos", 4, "--si", "--salida", salida)
    assert code == 2 and env.llamadas == [] and env.descargas == []
    assert "FAL_KEY" in err
    assert not salida.exists()


def test_con_si_y_sin_ffprobe_sale_con_2_y_no_llama(env, capsys, monkeypatch):
    monkeypatch.setattr(probar, "_ffprobe_exe", lambda: None)
    code, out, err = _correr(capsys, "clip", "veo-lite", "--segundos", 4, "--si")
    assert code == 2 and env.llamadas == []
    assert "ffprobe" in err


@pytest.mark.parametrize("segundos", [5, 12, 0, -4])
def test_una_duracion_no_admitida_sale_con_2_antes_de_llamar(env, capsys, segundos):
    code, out, err = _correr(capsys, "clip", "veo-lite", "--segundos", segundos, "--si")
    assert code == 2 and env.llamadas == [] and env.subidas == []
    assert "no admite" in err or "Duraciones disponibles" in err
    assert "Traceback" not in err


def test_la_duracion_tambien_se_valida_en_el_ensayo(env, capsys):
    code, out, err = _correr(capsys, "clip", "veo-lite", "--segundos", 5)
    assert code == 2 and "Duraciones disponibles: 4, 6, 8 s" in err and "ENSAYO" not in out


@pytest.mark.parametrize("si", [[], ["--si"]])
def test_editar_sin_imagen_da_un_error_claro(env, capsys, si):
    code, out, err = _correr(capsys, "editar", "grok", *si)
    assert code == 2 and env.llamadas == []
    assert "--imagen" in err and "Traceback" not in err


def test_una_imagen_que_no_existe_da_un_error_claro(env, capsys, tmp_path):
    code, out, err = _correr(capsys, "editar", "grok", "--imagen", tmp_path / "nada.png", "--si")
    assert code == 2 and env.llamadas == [] and "No encuentro la imagen" in err


def test_una_imagen_de_un_tipo_que_fal_no_acepta_se_rechaza(env, capsys, tmp_path):
    doc = tmp_path / "foto.txt"
    doc.write_text("no soy una imagen")
    code, out, err = _correr(capsys, "clip", "veo-lite", "--imagen", doc, "--si")
    assert code == 2 and env.llamadas == [] and "acepta fal" in err


@pytest.mark.parametrize("tarea, modelo", [("clip", "veo-xx"), ("imagen", "veo-lite"),
                                          ("editar", "inventado"), ("clip", "grok")])
def test_un_modelo_desconocido_da_un_error_claro_y_no_una_traza(env, capsys, tarea, modelo):
    code, out, err = _correr(capsys, tarea, modelo, "--si")
    assert code == 2 and env.llamadas == []
    assert modelo in err and "desconocido" in err and "Modelos disponibles" in err
    assert "Traceback" not in err and "Traceback" not in out


@pytest.mark.parametrize("argv, texto", [
    (["imagen", "grok", "--segundos", "4"], "--segundos solo aplica a la tarea clip"),
    (["imagen", "grok", "--imagen", "{foto}"], "no usa --imagen"),
    (["editar", "grok", "--imagen", "{foto}", "--formato", "vertical"], "--formato no aplica a editar"),
    (["clip", "veo-lite", "--prompt", "   "], "--prompt está vacío"),
])
def test_lo_que_no_aplica_a_la_tarea_se_rechaza(env, capsys, foto, argv, texto):
    argv = [a.replace("{foto}", str(foto)) for a in argv]
    code, out, err = _correr(capsys, *argv, "--si")
    assert code == 2 and env.llamadas == []
    assert texto in err


def test_la_tarea_de_la_herramienta_son_las_de_la_tabla_de_modelos():
    from pipeline import modelos_ia
    assert probar.TAREAS == modelos_ia.TAREAS


# ---------------------------------------------------------------------------
# --si: una llamada, descarga sin pisar, medición

def test_con_si_hace_una_sola_llamada_la_guarda_y_la_mide(env, capsys, tmp_path):
    from pipeline import clip, modelos_ia
    salida = tmp_path / "s"
    code, out, err = _correr(capsys, "clip", "veo-lite", "--segundos", 4, "--prompt", "un perro corre",
                             "--si", "--salida", salida)

    assert code == 0, err
    assert len(env.llamadas) == 1
    app, args = env.llamadas[0]
    assert app == modelos_ia.resolver("clip", "veo-lite").endpoint_para(False)
    assert args["prompt"] == "un perro corre" and args["duration"] == "4s"      # tal cual: sin LLM
    assert args["resolution"] == "720p" and args["generate_audio"] is True
    guardado = salida / "clip-veo-lite-4s.mp4"
    assert guardado.read_bytes() == b"contenido-1"
    assert env.medidos == [guardado]
    assert [p.name for p in salida.iterdir()] == ["clip-veo-lite-4s.mp4"]      # sin parciales a medias
    assert "PRUEBA PAGADA" in out and "MEDIDO" in out
    assert "1280×720" in out and "4.04 s" in out and "audio: SÍ" in out
    assert "coincide con lo prometido" in out and "REVISAR" not in out
    assert f"${clip.costo_usd(0, 'veo-lite', 4):.4f} dólares" in out
    assert "Request Details" in out and "fal no devuelve lo cobrado" in out
    assert CLAVE not in out and CLAVE not in err


def test_con_si_y_sin_segundos_usa_la_duracion_mas_corta_del_modelo(env, capsys, tmp_path):
    from pipeline import modelos_ia
    code, out, err = _correr(capsys, "clip", "veo-lite", "--si", "--salida", tmp_path / "s")
    corta = min(modelos_ia.resolver("clip", "veo-lite").duraciones)
    assert code == 0 and env.llamadas[0][1]["duration"] == f"{corta}s"


def test_clip_con_imagen_sube_la_imagen_y_llama_al_endpoint_de_imagen_a_video(env, capsys, foto, tmp_path):
    from pipeline import modelos_ia
    code, out, err = _correr(capsys, "clip", "veo-lite", "--segundos", 6, "--imagen", foto,
                             "--si", "--salida", tmp_path / "s")
    assert code == 0, err
    assert env.subidas == [foto]
    app, args = env.llamadas[0]
    assert app == modelos_ia.resolver("clip", "veo-lite").endpoint_para(True)
    assert args["image_url"] == "https://fal.invalid/subida.png" and args["duration"] == "6s"
    assert (tmp_path / "s" / "clip-veo-lite-6s.mp4").is_file()


def test_sin_salida_guarda_en_work_probar_modelo(env, capsys, tmp_path):
    code, out, err = _correr(capsys, "clip", "veo-lite", "--segundos", 4, "--si")
    assert code == 0, err
    assert (tmp_path / "work" / "probar_modelo" / "clip-veo-lite-4s.mp4").is_file()


def test_imagen_con_si_usa_imagen_fal_y_guarda_con_la_extension_de_la_url(env, capsys, tmp_path):
    from pipeline import modelos_ia
    env.resultado = {"images": [{"url": "https://fal.invalid/i/resultado.jpg"}]}
    env.medida = dict(MEDIDA_IMAGEN)
    code, out, err = _correr(capsys, "imagen", "grok", "--prompt", "un faro", "--si", "--salida", tmp_path / "s")

    assert code == 0, err
    app, args = env.llamadas[0]
    assert len(env.llamadas) == 1 and app == modelos_ia.resolver("imagen", "grok").endpoint
    assert args["prompt"] == "un faro" and args["aspect_ratio"] == "16:9" and args["num_images"] == 1
    assert "image_urls" not in args
    assert (tmp_path / "s" / "imagen-grok.jpg").read_bytes() == b"contenido-1"
    assert "MEDIDO · 1280×720" in out and "coincide con lo prometido" in out
    assert "audio" not in out and " s ·" not in out        # en una imagen no hay segundos ni audio
    assert [p.name for p in (tmp_path / "s").iterdir()] == ["imagen-grok.jpg"]


def test_editar_con_si_sube_la_imagen_y_usa_el_adaptador_de_transformar(env, capsys, foto, tmp_path):
    from pipeline import modelos_ia
    env.resultado = {"images": [{"url": "https://fal.invalid/i/resultado.png"}]}
    env.medida = dict(MEDIDA_IMAGEN)
    code, out, err = _correr(capsys, "editar", "grok", "--imagen", foto, "--prompt", "pásala a acuarela",
                             "--si", "--salida", tmp_path / "s")

    assert code == 0, err
    assert env.subidas == [foto]
    app, args = env.llamadas[0]
    assert app == modelos_ia.resolver("editar", "grok").endpoint
    assert args["image_urls"] == ["https://fal.invalid/subida.png"]
    assert "pásala a acuarela" in args["prompt"]            # el adaptador lo envuelve en su instrucción
    assert (tmp_path / "s" / "editar-grok.png").is_file()
    assert "REVISAR" not in out                              # editar no promete un aspecto


def test_dos_corridas_a_la_misma_carpeta_no_se_pisan(env, capsys, tmp_path):
    salida = tmp_path / "s"
    salida.mkdir()
    (salida / "clip-veo-lite-4s.mp4").write_bytes(b"lo que ya estaba")
    for _ in range(3):
        code, _, err = _correr(capsys, "clip", "veo-lite", "--segundos", 4, "--si", "--salida", salida)
        assert code == 0, err
    guardados = {p.name: p.read_bytes() for p in salida.iterdir()}
    assert guardados == {"clip-veo-lite-4s.mp4": b"lo que ya estaba",
                         "clip-veo-lite-4s_2.mp4": b"contenido-1",
                         "clip-veo-lite-4s_3.mp4": b"contenido-2",
                         "clip-veo-lite-4s_4.mp4": b"contenido-3"}


def test_guardar_sin_pisar_reserva_el_nombre_aunque_aparezca_a_mitad(tmp_path):
    origen = tmp_path / "parcial"
    origen.write_bytes(b"nuevo")
    (tmp_path / "a.png").write_bytes(b"viejo")
    destino = probar._guardar_sin_pisar(origen, tmp_path, "a", ".png")
    assert destino.name == "a_2.png" and destino.read_bytes() == b"nuevo"
    assert (tmp_path / "a.png").read_bytes() == b"viejo" and not origen.exists()


@pytest.mark.parametrize("url, contenido, tarea, esperada", [
    ("https://x/y/resultado.webp?token=1", b"", "imagen", ".webp"),
    ("https://x/y/sin-extension", PNG, "imagen", ".png"),
    ("https://x/y/sin-extension", b"\xff\xd8\xff\xe0" + b"0" * 12, "imagen", ".jpg"),
    ("https://x/y/sin-extension", b"\x00\x00\x00\x18ftypmp42" + b"0" * 4, "clip", ".mp4"),
    ("https://x/y/sin-extension", b"", "clip", ".mp4"),
])
def test_la_extension_sale_de_la_url_o_del_contenido(tmp_path, url, contenido, tarea, esperada):
    ruta = tmp_path / "parcial"
    ruta.write_bytes(contenido)
    assert probar._extension(url, ruta, tarea) == esperada


# ---------------------------------------------------------------------------
# la clave y los fallos

def test_la_clave_nunca_aparece_ni_dentro_de_un_error_de_fal(env, capsys):
    from pipeline import fal
    env.error = fal.FalError(f"401 Unauthorized: Authorization: Key {CLAVE}")
    code, out, err = _correr(capsys, "imagen", "grok", "--si")
    assert code == 1
    assert CLAVE not in out and CLAVE not in err
    assert "***" in err and "Request Details" in err      # avisa de revisar el cobro
    assert "Traceback" not in err


def test_la_clave_tampoco_sale_en_el_ensayo(env, capsys):
    code, out, err = _correr(capsys, "imagen", "grok", "--prompt", f"mi clave es {CLAVE}")
    assert code == 0 and CLAVE not in out and CLAVE not in err


def test_el_reintento_del_clip_se_corta_y_solo_hay_una_llamada(env, capsys, monkeypatch, tmp_path):
    from pipeline import clip, fal
    monkeypatch.setattr(clip, "settings", SimpleNamespace(clip_max_attempts=3, clip_timeout_s=5))
    env.error = fal.FalError("el servicio está caído")
    salida = tmp_path / "s"
    code, out, err = _correr(capsys, "clip", "veo-lite", "--segundos", 4, "--si", "--salida", salida)

    assert code == 1
    assert len(env.llamadas) == 1                          # el adaptador quería tres
    assert "una llamada por corrida" in err and "el servicio está caído" in err
    assert env.descargas == [] and list(salida.iterdir()) == []


def test_si_fal_responde_sin_video_tampoco_se_reintenta(env, capsys, monkeypatch, tmp_path):
    from pipeline import clip
    monkeypatch.setattr(clip, "settings", SimpleNamespace(clip_max_attempts=3, clip_timeout_s=5))
    env.resultado = {}
    code, out, err = _correr(capsys, "clip", "veo-lite", "--segundos", 4, "--si", "--salida", tmp_path / "s")
    assert code == 1 and len(env.llamadas) == 1
    assert "no devolvió" in err and "una llamada por corrida" in err


def test_un_fallo_de_imagen_sale_con_1_y_no_deja_parciales(env, capsys, tmp_path):
    from pipeline import fal
    env.error = fal.FalError("timeout")
    salida = tmp_path / "s"
    code, out, err = _correr(capsys, "imagen", "grok", "--si", "--salida", salida)
    assert code == 1 and len(env.llamadas) == 1
    assert "timeout" in err and list(salida.iterdir()) == []


# ---------------------------------------------------------------------------
# lo medido contra lo prometido

def test_un_clip_sin_pista_de_audio_se_marca_para_revisar(env, capsys, tmp_path):
    env.medida = {**MEDIDA_CLIP, "audio": False, "codec_audio": None}
    code, out, err = _correr(capsys, "clip", "veo-lite", "--segundos", 4, "--si", "--salida", tmp_path / "s")
    assert code == 0                                       # la prueba corrió; el veredicto va en el texto
    assert "audio: NO" in out and "REVISAR" in out and "NO trae pista de audio" in out
    assert "coincide con lo prometido" not in out


def test_una_duracion_o_una_resolucion_distintas_se_marcan_para_revisar(env, capsys, tmp_path):
    env.medida = {**MEDIDA_CLIP, "ancho": 1920, "alto": 1080, "segundos": 8.0}
    code, out, err = _correr(capsys, "clip", "veo-lite", "--segundos", 4, "--si", "--salida", tmp_path / "s")
    assert code == 0
    assert "se pidieron 4 s y dura 8.00 s" in out and "720p" in out and "1080" in out


def test_un_clip_vertical_mide_el_aspecto_pedido(env, capsys, tmp_path):
    env.medida = {**MEDIDA_CLIP, "ancho": 720, "alto": 1280}
    code, out, err = _correr(capsys, "clip", "veo-lite", "--segundos", 4, "--formato", "vertical",
                             "--si", "--salida", tmp_path / "s")
    assert code == 0 and env.llamadas[0][1]["aspect_ratio"] == "9:16"
    assert "720×1280" in out and "REVISAR" not in out


def test_un_clip_horizontal_que_llega_vertical_se_marca(env, capsys, tmp_path):
    env.medida = {**MEDIDA_CLIP, "ancho": 720, "alto": 1280}
    code, out, err = _correr(capsys, "clip", "veo-lite", "--segundos", 4, "--si", "--salida", tmp_path / "s")
    assert "REVISAR" in out and "se pidió 16:9" in out


def test_si_ffprobe_falla_despues_de_gastar_se_avisa_y_se_recuerda_el_cobro(env, capsys, monkeypatch, tmp_path):
    def roto(ruta):
        raise probar._SinMedida("el archivo está corrupto")
    monkeypatch.setattr(probar, "_medir", roto)
    salida = tmp_path / "s"
    code, out, err = _correr(capsys, "clip", "veo-lite", "--segundos", 4, "--si", "--salida", salida)
    assert code == 1 and len(env.llamadas) == 1
    assert (salida / "clip-veo-lite-4s.mp4").is_file()     # lo gastado no se pierde
    assert "no se pudo medir" in err and "corrupto" in err
    assert "Request Details" in out


# ---------------------------------------------------------------------------
# ffprobe: cómo se lee

def _ffprobe_falso(monkeypatch, datos, returncode=0, stderr=""):
    visto = {}

    def correr(cmd, **kwargs):
        visto["cmd"], visto["kwargs"] = cmd, kwargs
        return SimpleNamespace(returncode=returncode, stdout=json.dumps(datos), stderr=stderr)

    monkeypatch.setattr(probar, "_ffprobe_exe", lambda: "ffprobe")
    monkeypatch.setattr(probar.subprocess, "run", correr)
    return visto


def test_medir_lee_tamano_segundos_y_audio_de_un_video(monkeypatch, tmp_path):
    visto = _ffprobe_falso(monkeypatch, {
        "streams": [{"codec_type": "video", "width": 1280, "height": 720},
                    {"codec_type": "audio", "codec_name": "aac"}],
        "format": {"duration": "8.041000"}})
    m = probar._medir(tmp_path / "v.mp4")
    assert m == {"ancho": 1280, "alto": 720, "segundos": 8.041, "audio": True, "codec_audio": "aac"}
    # sin shell, lista de argumentos, y la salida se lee en UTF-8 (Windows)
    assert isinstance(visto["cmd"], list) and visto["cmd"][0] == "ffprobe"
    assert "shell" not in visto["kwargs"] and visto["kwargs"]["encoding"] == "utf-8"


def test_medir_dice_que_no_hay_audio_cuando_no_hay_pista(monkeypatch, tmp_path):
    _ffprobe_falso(monkeypatch, {"streams": [{"codec_type": "video", "width": 1024, "height": 576,
                                              "duration": "5.0"}], "format": {}})
    m = probar._medir(tmp_path / "v.mp4")
    assert m["audio"] is False and m["codec_audio"] is None and m["segundos"] == 5.0


def test_medir_una_imagen_no_trae_segundos(monkeypatch, tmp_path):
    _ffprobe_falso(monkeypatch, {"streams": [{"codec_type": "video", "width": 1024, "height": 1024}],
                                 "format": {}})
    m = probar._medir(tmp_path / "i.png")
    assert (m["ancho"], m["alto"], m["segundos"], m["audio"]) == (1024, 1024, None, False)


def test_medir_falla_con_claridad_si_ffprobe_no_puede(monkeypatch, tmp_path):
    _ffprobe_falso(monkeypatch, {}, returncode=1, stderr="Invalid data found")
    with pytest.raises(probar._SinMedida, match="Invalid data"):
        probar._medir(tmp_path / "v.mp4")


def test_medir_sin_ffprobe_instalado_lo_dice(monkeypatch, tmp_path):
    monkeypatch.setattr(probar, "_ffprobe_exe", lambda: None)
    with pytest.raises(probar._SinMedida, match="ffprobe no está instalado"):
        probar._medir(tmp_path / "v.mp4")


# ---------------------------------------------------------------------------
# X1 · la promesa de 1K de Nano Banana 2

@pytest.mark.parametrize("tarea, ancho, alto, se_marca", [
    ("imagen", 2752, 1536, True),       # 4.2 MP: llegó en 2K
    ("editar", 2752, 1536, True),
    ("editar", 4096, 4096, True),       # 16.8 MP: llegó en 4K
    ("imagen", 688, 384, True),         # 0.26 MP: llegó en 0.5K, cuyo precio no está leído
    ("editar", 512, 512, True),         # 0.26 MP
    ("imagen", 1376, 768, False),       # 1.06 MP: 1K de verdad
    ("editar", 1376, 768, False),
    ("editar", 1024, 1024, False),      # 1.05 MP
])
def test_nb2_promete_1k_y_una_salida_mayor_se_marca_para_revisar(env, capsys, foto, tmp_path, tarea, ancho, alto, se_marca):
    from pipeline import modelos_ia
    assert dict(modelos_ia.resolver(tarea, "nb2").args_extra)["resolution"] == "1K"
    env.resultado = {"images": [{"url": "https://fal.invalid/i/resultado.png"}]}
    env.medida = {**MEDIDA_IMAGEN, "ancho": ancho, "alto": alto}
    extra = ["--imagen", foto] if tarea == "editar" else []
    code, out, err = _correr(capsys, tarea, "nb2", *extra, "--si", "--salida", tmp_path / "s")

    assert code == 0, err                                  # la prueba corrió; el veredicto va en el texto
    assert env.llamadas[0][1]["resolution"] == "1K"
    if se_marca:
        assert "REVISAR" in out and "se prometió 1K" in out and f"{ancho}×{alto}" in out
        assert re.search(r"el costo anotado \(\$0\.08 dólares\) solo vale a 1K", out)
        assert "coincide con lo prometido" not in out
    else:
        assert "REVISAR" not in out and "coincide con lo prometido" in out


def test_un_modelo_sin_resolucion_fija_no_se_juzga_por_los_megapixeles(env, capsys, tmp_path):
    env.resultado = {"images": [{"url": "https://fal.invalid/i/resultado.png"}]}
    env.medida = {**MEDIDA_IMAGEN, "ancho": 2752, "alto": 1536}        # 16:9, 4.2 MP, en Grok
    code, out, err = _correr(capsys, "imagen", "grok", "--si", "--salida", tmp_path / "s")
    assert code == 0 and "REVISAR" not in out and "coincide con lo prometido" in out


# ---------------------------------------------------------------------------
# Ola 2 · imágenes con image_size (FLUX.2 klein) y el formato cuadrado

@pytest.mark.parametrize("formato,valor", [("cuadrado", "square_hd"), ("horizontal", "landscape_16_9"),
                                           ("vertical", "portrait_16_9"), (None, "landscape_16_9")])
def test_el_ensayo_de_klein_manda_el_image_size_de_su_familia(env, capsys, monkeypatch, formato, valor):
    from pipeline import creditos
    monkeypatch.setattr(creditos, "MODELOS_CR", {})      # «sin número» fijo: no depende de si ya se encendió
    extra = ["--formato", formato] if formato else []
    code, out, err = _correr(capsys, "imagen", "klein", *extra)
    assert code == 0 and err == "" and env.llamadas == [] and NO_LLAMO in out
    assert "fal-ai/flux-2/klein/9b" in out
    assert f'"image_size": "{valor}"' in out and "aspect_ratio" not in out
    assert "$0.0060 dólares" in out and SIN_NUMERO in out


def test_cuadrado_no_se_vuelve_16_9_en_silencio(env, capsys):
    """pipeline.models.formato_de cae en horizontal ante un nombre que no conoce: aquí no."""
    code, out, _ = _correr(capsys, "imagen", "grok", "--formato", "cuadrado")
    assert code == 0 and '"aspect_ratio": "1:1"' in out and "16:9" not in out


def test_el_clip_no_admite_cuadrado(env, capsys):
    code, out, err = _correr(capsys, "clip", "veo-lite", "--segundos", 4, "--formato", "cuadrado")
    assert code == 2 and "solo aplica a imagen" in err and env.llamadas == []


def test_los_formatos_de_la_prueba_son_los_de_la_caja_de_imagenes():
    import server.app as app_mod
    assert probar.ASPECTOS_IMAGEN == app_mod.ASPECTOS_IMAGEN
    assert probar.FORMATOS_IMAGEN == tuple(app_mod.ASPECTOS_IMAGEN)


@pytest.mark.parametrize("formato,ancho,alto,marca", [
    ("cuadrado", 1024, 1024, None),                  # 1.05 MP: lo que se anotó
    ("horizontal", 1024, 576, None),                 # 0.59 MP: cuesta menos, no se marca
    ("vertical", 576, 1024, None),
    ("cuadrado", 2048, 2048, "~1 MP"),               # 4.2 MP: el costo anotado es el de 1 MP
    ("horizontal", 1024, 1024, "se pidió 16:9"),     # llegó con otro aspecto
])
def test_klein_se_juzga_por_su_aspecto_y_por_su_megapixel(env, capsys, tmp_path, formato, ancho, alto, marca):
    env.resultado = {"images": [{"url": "https://fal.invalid/i/resultado.png"}]}
    env.medida = {**MEDIDA_IMAGEN, "ancho": ancho, "alto": alto}
    code, out, err = _correr(capsys, "imagen", "klein", "--formato", formato, "--si",
                             "--salida", tmp_path / "s")
    assert code == 0, err
    (app, args), = env.llamadas
    assert app == "fal-ai/flux-2/klein/9b" and "aspect_ratio" not in args and "image_size" in args
    if marca is None:
        assert "REVISAR" not in out and "coincide con lo prometido" in out
    else:
        assert "REVISAR" in out and marca in out


# ---------------------------------------------------------------------------
# X2 · la clave no se filtra

def test_la_clave_en_un_aviso_de_logging_de_una_libreria_tampoco_sale(env, capsys, caplog, monkeypatch, tmp_path):
    """clip.animar hace log.warning(... err): sale por logging, no por _decir."""
    from pipeline import clip, fal
    monkeypatch.setattr(clip, "settings", SimpleNamespace(clip_max_attempts=3, clip_timeout_s=5))
    env.error = fal.FalError(f"401 Unauthorized: Authorization: Key {CLAVE}")
    caplog.set_level(logging.WARNING)
    code, out, err = _correr(capsys, "clip", "veo-lite", "--segundos", 4, "--si", "--salida", tmp_path / "s")

    assert code == 1 and len(env.llamadas) == 1
    assert "Veo falló en el clip" in caplog.text            # el aviso sí salió por logging…
    assert CLAVE not in caplog.text                         # …sin la clave
    for registro in caplog.records:
        assert CLAVE not in registro.getMessage() and CLAVE not in str(registro.args)
    assert CLAVE not in out and CLAVE not in err


def test_la_clave_en_el_log_no_llega_a_stderr_en_un_proceso_real(tmp_path):
    """El caso que describió el revisor: sin ningún handler configurado, logging
    escribe el aviso directo a stderr (handler de último recurso)."""
    guion = (
        "import importlib.util, os, sys\n"
        "from types import SimpleNamespace\n"
        "raiz = sys.argv[1]\n"
        "sys.path.insert(0, raiz)\n"
        "spec = importlib.util.spec_from_file_location('probar_modelo', raiz + '/tools/probar_modelo.py')\n"
        "probar = importlib.util.module_from_spec(spec); spec.loader.exec_module(probar)\n"
        "from pipeline import clip, fal\n"
        "async def llamar(app, argumentos, timeout_s=None, nombre=None, meta=None):\n"
        "    raise fal.FalError('401 Unauthorized: Authorization: Key ' + os.environ['FAL_KEY'])\n"
        "fal.llamar = llamar\n"
        "clip.settings = SimpleNamespace(clip_max_attempts=3, clip_timeout_s=5)\n"
        "probar._ffprobe_exe = lambda: 'ffprobe'\n"
        "probar._cargar_env = lambda: None\n"
        "sys.exit(probar.main(['clip', 'veo-lite', '--segundos', '4', '--si', '--salida', sys.argv[2]]))\n")
    r = subprocess.run([sys.executable, "-c", guion, str(RAIZ), str(tmp_path / "s")], capture_output=True,
                       text=True, encoding="utf-8", cwd=tmp_path, timeout=180,
                       env={**os.environ, "FAL_KEY": CLAVE, "LANGFUSE_TRACING_ENABLED": "false",
                            "PYTHONIOENCODING": "utf-8"})
    assert r.returncode == 1, r.stderr
    assert "Veo falló en el clip" in r.stderr               # el aviso salió de verdad por stderr…
    assert CLAVE not in r.stderr and CLAVE not in r.stdout  # …sin la clave
    assert "***" in r.stderr


def test_el_filtro_de_logs_tapa_mensaje_argumentos_y_traza_y_se_quita_al_terminar(monkeypatch):
    import io
    monkeypatch.setenv("FAL_KEY", CLAVE)
    original = logging.getLogRecordFactory()
    flujo = io.StringIO()
    manejador = logging.StreamHandler(flujo)
    manejador.setFormatter(logging.Formatter("%(name)s|%(message)s"))
    logger = logging.getLogger("terceros.libreria")
    logger.addHandler(manejador)
    logger.propagate = False
    try:
        with probar._logs_sin_clave():
            assert logging.getLogRecordFactory() is not original
            logger.error("falló con %s y %s", CLAVE, {"k": CLAVE})        # argumentos
            logger.error(f"mensaje con {CLAVE} dentro")                     # mensaje
            try:
                raise ValueError(f"mal: {CLAVE}")
            except ValueError:
                logger.error("con traza", exc_info=True)                    # exc_info
        assert logging.getLogRecordFactory() is original                    # se quita al terminar
        logger.error("ya sin filtro: %s", CLAVE)
    finally:
        logger.removeHandler(manejador)
        logger.propagate = True
    texto = flujo.getvalue()
    antes, despues = texto.split("ya sin filtro")
    assert CLAVE not in antes and antes.count("***") >= 4
    assert "ValueError" in antes and "Traceback" in antes
    assert CLAVE in despues                                                 # fuera del bloque no se toca nada


@pytest.mark.parametrize("clave, error", [
    ("idclave-1234:secretoSOLO-98765", "401: secreto equivocado secretoSOLO-98765"),    # solo la mitad secreta
    ("idclave-1234:secretoSOLO-98765", "401: key id idclave-1234 inválido"),            # solo la mitad id
])
def test_un_error_que_nombra_solo_una_mitad_de_la_clave_tambien_se_tapa(env, capsys, monkeypatch, clave, error):
    from pipeline import fal
    monkeypatch.setenv("FAL_KEY", clave)
    env.error = fal.FalError(error)
    code, out, err = _correr(capsys, "imagen", "grok", "--si")
    assert code == 1
    for mitad in clave.split(":"):
        assert mitad not in out and mitad not in err
    assert "***" in err


def test_la_forma_escapada_de_la_clave_tambien_se_tapa(env, capsys, monkeypatch):
    """h11 pone el valor con repr(): una barra invertida sale duplicada y ya no es la clave tal cual."""
    from pipeline import fal
    clave = "abcd-efgh\\ijkl-5678"
    escapada = repr(clave)[1:-1]
    assert escapada != clave
    monkeypatch.setenv("FAL_KEY", clave)
    env.error = fal.FalError(f"Illegal header value b'Key {escapada}'")
    code, out, err = _correr(capsys, "imagen", "grok", "--si")
    assert code == 1 and clave not in err and escapada not in err and "***" in err


def test_limpio_tapa_la_clave_terminada_en_salto_de_linea_en_todas_sus_formas(monkeypatch):
    monkeypatch.setenv("FAL_KEY", "clave-nl-1234567\n")
    for texto in ("Illegal header value b'Key clave-nl-1234567\\n'",     # h11: repr escapado
                  "Key clave-nl-1234567 rechazada",                      # sin el salto (strip)
                  "Key clave-nl-1234567\n rechazada"):                   # tal cual
        assert "clave-nl-1234567" not in probar._limpio(texto), texto


@pytest.mark.parametrize("clave", ["clave-123456 ", " clave-123456", "clave-123456\n", "clave-123456\r",
                                   "clave 123456", "clave\t123456", "clave-12\x0734567"])
def test_una_clave_con_espacios_o_caracteres_de_control_se_rechaza_sin_imprimirla(env, capsys, monkeypatch, tmp_path, clave):
    monkeypatch.setenv("FAL_KEY", clave)
    salida = tmp_path / "s"
    code, out, err = _correr(capsys, "clip", "veo-lite", "--segundos", 4, "--si", "--salida", salida)

    assert code == 2 and env.llamadas == [] and env.subidas == [] and env.descargas == []
    assert "FAL_KEY" in err and "espacios" in err
    assert "clave-123456" not in out + err and "clave-12" not in out + err    # el mensaje no la imprime
    assert not salida.exists()                                                # ni se creó la carpeta


# ---------------------------------------------------------------------------
# X3 · lo pagado no se pierde

@pytest.mark.parametrize("tarea, modelo, url", [
    ("clip", "veo-lite", "https://fal.invalid/v/salida.mp4"),
    ("imagen", "grok", "https://fal.invalid/i/resultado.png"),
])
def test_si_la_descarga_falla_la_url_ya_salio_antes_y_el_exit_no_es_2(env, capsys, monkeypatch, tmp_path, tarea, modelo, url):
    from pipeline import fal
    if tarea == "clip":
        env.resultado = {"video": {"url": url}}
    else:
        env.resultado = {"images": [{"url": url}]}
    antes = {}

    async def descargar_roto(u, destino):
        antes["out"] = capsys.readouterr().out            # lo que ya se había impreso al empezar a descargar
        raise OSError("se cortó la conexión")

    monkeypatch.setattr(fal, "descargar", descargar_roto)
    code, out, err = _correr(capsys, tarea, modelo, "--si", "--salida", tmp_path / "s")

    assert code == 1 and len(env.llamadas) == 1            # falló después de pagar: no es «pedido inválido»
    assert url in antes["out"]                             # la URL salió ANTES de descargar
    assert url in err and "SÍ se generó y se cobró" in err and "se cortó la conexión" in err
    assert "la prueba falló" not in err.lower()            # no es el «falló» a secas
    assert "Request Details" in err


def test_si_el_guardado_falla_la_url_tambien_sale(env, capsys, monkeypatch, tmp_path):
    def guardar_roto(*a, **k):
        raise PermissionError("acceso denegado")
    monkeypatch.setattr(probar, "_guardar_sin_pisar", guardar_roto)
    code, out, err = _correr(capsys, "clip", "veo-lite", "--segundos", 4, "--si", "--salida", tmp_path / "s")
    assert code == 1
    assert "https://fal.invalid/v/salida.mp4" in out and "https://fal.invalid/v/salida.mp4" in err
    assert "SÍ se generó y se cobró" in err and "acceso denegado" in err


def test_el_exito_tambien_imprime_la_url_del_resultado(env, capsys, tmp_path):
    code, out, err = _correr(capsys, "clip", "veo-lite", "--segundos", 4, "--si", "--salida", tmp_path / "s")
    assert code == 0 and "https://fal.invalid/v/salida.mp4" in out


@pytest.mark.parametrize("resultado, esperadas", [
    ({"video": {"url": "https://x/v.mp4"}}, ["https://x/v.mp4"]),
    ({"images": [{"url": "https://x/a.png"}, {"url": "https://x/b.png"}]}, ["https://x/a.png", "https://x/b.png"]),
    ({"images": [{}], "video": None}, []),
    ({"images": None}, []),
    ({}, []),
    (None, []),
    ("no es un dict", []),
])
def test_las_urls_del_resultado_se_leen_de_video_e_imagenes(resultado, esperadas):
    assert probar._urls(resultado) == esperadas


@pytest.mark.parametrize("como", ["debajo_de_un_archivo", "sin_permiso_de_escritura"])
def test_una_carpeta_de_salida_que_no_se_puede_escribir_sale_con_2_y_sin_llamar(env, capsys, monkeypatch, tmp_path, como):
    if como == "debajo_de_un_archivo":
        archivo = tmp_path / "ocupado"
        archivo.write_text("soy un archivo")
        salida = archivo / "dentro"
    else:
        salida = tmp_path / "solo_lectura"
        escribir = Path.write_bytes

        def write_bytes(self, datos):
            if self.name.startswith(".prueba-escritura"):
                raise PermissionError(13, "Permission denied", str(self))
            return escribir(self, datos)

        monkeypatch.setattr(Path, "write_bytes", write_bytes)
    code, out, err = _correr(capsys, "clip", "veo-lite", "--segundos", 4, "--si", "--salida", salida)

    assert code == 2 and env.llamadas == [] and env.subidas == [] and env.descargas == []
    assert "No puedo escribir en la carpeta de salida" in err and "No se gastó nada" in err
    assert "Request Details" not in err                    # con 0 llamadas no hay cobro que revisar


def test_con_si_la_carpeta_de_salida_se_crea_y_se_prueba_antes_de_llamar(env, capsys, tmp_path):
    """Si falla la llamada, la carpeta ya existe y no queda el archivo de prueba."""
    from pipeline import fal
    env.error = fal.FalError("caído")
    salida = tmp_path / "a" / "b"
    code, out, err = _correr(capsys, "imagen", "grok", "--si", "--salida", salida)
    assert code == 1 and salida.is_dir() and list(salida.iterdir()) == []


def test_un_fallo_antes_de_llamar_dice_que_no_se_gasto_nada_y_no_habla_de_cobro(env, capsys, monkeypatch, foto, tmp_path):
    from pipeline import fal

    async def subir_roto(path):
        raise OSError("sin red para subir")

    monkeypatch.setattr(fal, "subir_archivo", subir_roto)
    code, out, err = _correr(capsys, "editar", "grok", "--imagen", foto, "--si", "--salida", tmp_path / "s")
    assert code == 2 and env.llamadas == []          # no se llegó a llamar: «no se gastó nada» es el código 2
    assert "sin red para subir" in err and "no se gastó nada" in err
    assert "Request Details" not in err and "se cobró" not in err


def test_un_fallo_de_la_llamada_sin_respuesta_manda_a_revisar_el_cobro(env, capsys, tmp_path):
    from pipeline import fal
    env.error = fal.FalError("timeout")
    code, out, err = _correr(capsys, "imagen", "grok", "--si", "--salida", tmp_path / "s")
    assert code == 1 and len(env.llamadas) == 1
    assert "Request Details" in err and "solicitudes duplicadas" in err
    assert "SÍ se generó" not in err                       # no hay respuesta: no se promete un resultado


# ---------------------------------------------------------------------------
# X4 · la imagen de entrada se mide ANTES de gastar

def _con_medida(env, foto, ancho, alto):
    env.medidas_entrada[foto] = {"ancho": ancho, "alto": alto, "segundos": None, "audio": False, "codec_audio": None}


def test_una_imagen_de_cero_bytes_se_rechaza_siempre(env, capsys, foto, tmp_path):
    foto.write_bytes(b"")
    for extra in ([], ["--imagen-sin-validar"]):
        code, out, err = _correr(capsys, "clip", "veo-lite", "--imagen", foto, *extra, "--si", "--salida", tmp_path / "s")
        assert code == 2 and env.llamadas == [] and env.subidas == []
        assert "vacía" in err and "0 bytes" in err
    code, out, err = _correr(capsys, "editar", "grok", "--imagen", foto, "--si", "--salida", tmp_path / "s")
    assert code == 2 and env.llamadas == [] and "vacía" in err


@pytest.mark.parametrize("tarea, modelo, extra", [("clip", "veo-lite", ["--imagen-sin-validar"]),
                                                 ("clip", "veo-lite", []), ("editar", "grok", [])])
def test_una_imagen_ilegible_se_rechaza_siempre_tambien_con_sin_validar(env, capsys, foto, tmp_path, tarea, modelo, extra):
    env.medidas_entrada[foto] = probar._SinMedida("Invalid data found when processing input")
    code, out, err = _correr(capsys, tarea, modelo, "--imagen", foto, *extra, "--si", "--salida", tmp_path / "s")
    assert code == 2 and env.llamadas == [] and env.subidas == []
    assert "No puedo leer la imagen" in err and "Invalid data" in err and "No se gastó nada" in err


@pytest.mark.parametrize("ancho, alto, motivo", [
    (1, 1, "lado corto mide 1 px"),                    # el PNG de 1×1
    (960, 540, "lado corto mide 540 px"),              # 16:9 pero de menos de 720p
    (1440, 1080, "relación es 1.33:1"),                # una foto 4:3
    (1080, 1080, "relación es 1.00:1"),                # cuadrada
    (3000, 2000, "relación es 1.50:1"),                # 3:2 de cámara
    (1920, 1020, "relación es 1.88:1"),                # 16:9 corrido: fuera del ±3 %
])
def test_un_clip_rechaza_una_imagen_que_el_modelo_no_acepta_y_explica_el_requisito(env, capsys, foto, tmp_path, ancho, alto, motivo):
    _con_medida(env, foto, ancho, alto)
    code, out, err = _correr(capsys, "clip", "veo-lite", "--imagen", foto, "--si", "--salida", tmp_path / "s")

    assert code == 2 and env.llamadas == [] and env.subidas == []
    assert f"{ancho}×{alto}" in err and motivo in err
    assert "720" in err and "16:9 o 9:16" in err and "página del modelo" in err
    assert "--imagen-sin-validar" in err and "No se gastó nada" in err


@pytest.mark.parametrize("ancho, alto, formato", [
    (1280, 720, "16:9"), (1920, 1080, "16:9"), (3840, 2160, "16:9"),
    (720, 1280, "9:16"), (1080, 1920, "9:16"),
    (1920, 1060, "16:9"),                              # 1.81:1, dentro del ±3 %
])
def test_un_clip_acepta_una_imagen_de_720p_o_mas_en_16_9_o_9_16_y_deduce_el_formato(env, capsys, foto, tmp_path, ancho, alto, formato):
    _con_medida(env, foto, ancho, alto)
    code, out, err = _correr(capsys, "clip", "veo-lite", "--imagen", foto, "--si", "--salida", tmp_path / "s")
    assert code == 0, err
    assert env.llamadas[0][1]["aspect_ratio"] == formato          # lo que se pagó sigue a la imagen
    assert f'"aspect_ratio": "{formato}"' in out                  # y el plan impreso también (se rehízo)


def test_con_formato_explicito_que_concuerda_no_se_toca(env, capsys, foto, tmp_path):
    _con_medida(env, foto, 720, 1280)
    code, out, err = _correr(capsys, "clip", "veo-lite", "--imagen", foto, "--formato", "vertical",
                             "--si", "--salida", tmp_path / "s")
    assert code == 0, err and env.llamadas[0][1]["aspect_ratio"] == "9:16"


@pytest.mark.parametrize("ancho, alto, formato", [(1280, 720, "vertical"), (720, 1280, "horizontal")])
@pytest.mark.parametrize("sin_validar", [[], ["--imagen-sin-validar"]])
def test_un_formato_que_discrepa_de_la_imagen_se_rechaza_tambien_con_sin_validar(env, capsys, foto, tmp_path, ancho, alto, formato, sin_validar):
    _con_medida(env, foto, ancho, alto)
    code, out, err = _correr(capsys, "clip", "veo-lite", "--imagen", foto, "--formato", formato, *sin_validar,
                             "--si", "--salida", tmp_path / "s")
    assert code == 2 and env.llamadas == [] and env.subidas == []
    assert f"--formato {formato} no concuerda con la imagen" in err and f"{ancho}×{alto}" in err


@pytest.mark.parametrize("ancho, alto", [(1, 1), (1440, 1080), (1080, 1080), (960, 540)])
def test_sin_validar_salta_solo_la_regla_de_lado_corto_y_relacion_y_avisa(env, capsys, foto, tmp_path, ancho, alto):
    _con_medida(env, foto, ancho, alto)
    code, out, err = _correr(capsys, "clip", "veo-lite", "--imagen", foto, "--imagen-sin-validar",
                             "--si", "--salida", tmp_path / "s")
    assert code == 0, err and len(env.llamadas) == 1 and env.subidas == [foto]
    assert "AVISO" in err and "--imagen-sin-validar" in err


def test_sin_validar_con_una_imagen_que_pasa_igual_avisa(env, capsys, foto, tmp_path):
    code, out, err = _correr(capsys, "clip", "veo-lite", "--imagen", foto, "--imagen-sin-validar",
                             "--si", "--salida", tmp_path / "s")
    assert code == 0 and "AVISO" in err


@pytest.mark.parametrize("ancho, alto", [(1, 1), (1440, 1080), (300, 200)])
def test_editar_no_aplica_la_regla_de_720p_ni_de_16_9(env, capsys, foto, tmp_path, ancho, alto):
    env.resultado = {"images": [{"url": "https://fal.invalid/i/resultado.png"}]}
    env.medida = dict(MEDIDA_IMAGEN)
    _con_medida(env, foto, ancho, alto)
    code, out, err = _correr(capsys, "editar", "grok", "--imagen", foto, "--si", "--salida", tmp_path / "s")
    assert code == 0, err and len(env.llamadas) == 1


@pytest.mark.parametrize("argv, tarea_modelo", [
    (["--imagen-sin-validar"], ("clip", "veo-lite")),                       # clip sin imagen
    (["--imagen", "{foto}", "--imagen-sin-validar"], ("editar", "grok")),   # editar: la regla no aplica
    (["--imagen-sin-validar"], ("imagen", "grok")),
])
def test_sin_validar_donde_no_aplica_se_rechaza(env, capsys, foto, argv, tarea_modelo):
    argv = [a.replace("{foto}", str(foto)) for a in argv]
    code, out, err = _correr(capsys, *tarea_modelo, *argv, "--si")
    assert code == 2 and env.llamadas == [] and "--imagen-sin-validar solo aplica" in err


def test_el_ensayo_no_mide_la_imagen_y_avisa_que_con_si_se_mide(env, capsys, foto):
    env.medidas_entrada[foto] = probar._SinMedida("no me deberían llamar en el ensayo")
    code, out, err = _correr(capsys, "clip", "veo-lite", "--imagen", foto)
    assert code == 0 and env.medidos == [] and err == ""
    assert "con --si se mide la imagen" in out and "720" in out and "16:9 o 9:16" in out


# ---------------------------------------------------------------------------
# X5 · el tiempo de la llamada contra su timeout

def _reloj_falso(env, monkeypatch, tarda):
    """La llamada «tarda» `tarda` segundos en un reloj que controla el test."""
    from pipeline import fal
    reloj = {"t": 1000.0}
    original = fal.llamar

    async def lenta(app, argumentos, **kw):
        reloj["t"] += tarda
        return await original(app, argumentos, **kw)

    monkeypatch.setattr(fal, "llamar", lenta)
    monkeypatch.setattr(probar, "_reloj", lambda: reloj["t"])


@pytest.mark.parametrize("tarea, modelo, tarda, se_marca", [
    ("clip", "veo-lite", 80, True),        # 80 % de 100 s
    ("clip", "veo-lite", 71, True),
    ("clip", "veo-lite", 70, False),       # exactamente el 70 % no pasa del 70 %
    ("clip", "veo-lite", 12, False),
    ("imagen", "grok", 91, True),          # 91 s de 120 s = 76 %
    ("imagen", "grok", 60, False),
])
def test_una_llamada_que_tarda_mas_del_70_por_ciento_del_timeout_se_marca(env, capsys, monkeypatch, tmp_path, tarea, modelo, tarda, se_marca):
    from pipeline import clip, media_fal
    monkeypatch.setattr(clip, "settings", SimpleNamespace(clip_max_attempts=1, clip_timeout_s=100))
    monkeypatch.setattr(media_fal, "settings", SimpleNamespace(grok_timeout_s=120))
    if tarea == "imagen":
        env.resultado = {"images": [{"url": "https://fal.invalid/i/resultado.png"}]}
        env.medida = dict(MEDIDA_IMAGEN)
    _reloj_falso(env, monkeypatch, tarda)
    limite = 100 if tarea == "clip" else 120
    code, out, err = _correr(capsys, tarea, modelo, "--si", "--salida", tmp_path / "s")

    assert code == 0, err
    assert f"fal respondió en {tarda:.1f} s (el cliente espera hasta {limite} s)" in out     # se reporta siempre
    if se_marca:
        assert "REVISAR" in out and f"tardó {tarda} s de los {limite} s" in out
        assert "vivo y cobrado" in out and "coincide con lo prometido" not in out
    else:
        assert "REVISAR" not in out and "coincide con lo prometido" in out


def test_el_tiempo_lento_se_marca_aunque_la_medicion_falle(env, capsys, monkeypatch, tmp_path):
    from pipeline import clip

    def roto(ruta):
        raise probar._SinMedida("corrupto")

    monkeypatch.setattr(clip, "settings", SimpleNamespace(clip_max_attempts=1, clip_timeout_s=100))
    monkeypatch.setattr(probar, "_medir", roto)
    _reloj_falso(env, monkeypatch, 90)
    code, out, err = _correr(capsys, "clip", "veo-lite", "--segundos", 4, "--si", "--salida", tmp_path / "s")
    assert code == 1 and "no se pudo medir" in err
    assert "REVISAR" in out and "vivo y cobrado" in out
    assert "coincide con lo prometido" not in out


# ---------------------------------------------------------------------------
# X6 · el ensayo no llama a nada, ni al trazado

def _espiar_planear(monkeypatch):
    """Anota el valor de LANGFUSE_TRACING_ENABLED en el momento en que se planea."""
    visto: list = []
    planear = probar._planear

    async def espia(plan):
        visto.append(os.environ.get("LANGFUSE_TRACING_ENABLED"))
        return await planear(plan)

    monkeypatch.setattr(probar, "_planear", espia)
    return visto


def test_el_ensayo_apaga_el_trazado_de_langfuse_y_lo_deja_como_estaba(env, capsys, monkeypatch):
    monkeypatch.delenv("LANGFUSE_TRACING_ENABLED", raising=False)
    visto = _espiar_planear(monkeypatch)
    code, out, err = _correr(capsys, "clip", "veo-lite", "--segundos", 4)
    assert code == 0 and visto == ["false"]
    assert "LANGFUSE_TRACING_ENABLED" not in os.environ        # no se queda puesta para el resto del proceso


def test_si_el_dueno_ya_definio_el_trazado_se_respeta(env, capsys, monkeypatch):
    monkeypatch.setenv("LANGFUSE_TRACING_ENABLED", "true")
    visto = _espiar_planear(monkeypatch)
    code, out, err = _correr(capsys, "clip", "veo-lite", "--segundos", 4)
    assert code == 0 and visto == ["true"] and os.environ["LANGFUSE_TRACING_ENABLED"] == "true"


def test_con_si_no_se_toca_el_trazado(env, capsys, monkeypatch, tmp_path):
    monkeypatch.delenv("LANGFUSE_TRACING_ENABLED", raising=False)
    visto = _espiar_planear(monkeypatch)
    code, out, err = _correr(capsys, "clip", "veo-lite", "--segundos", 4, "--si", "--salida", tmp_path / "s")
    assert code == 0 and visto == [None]


# ---------------------------------------------------------------------------
# X8 · ffprobe dice «N/A»

@pytest.mark.parametrize("formato, flujo, esperado", [
    ("N/A", "4.004000", 4.004),            # el contenedor no sabe: gana la del flujo
    ("nan", "4.004000", 4.004),
    ("8.041000", "N/A", 8.041),            # el contenedor manda si es válido
    ("8.041000", "4.004000", 8.041),
    ("N/A", "N/A", None),
    (None, None, None),
    ("N/A", None, None),
])
def test_medir_prueba_las_dos_duraciones_y_se_queda_con_la_primera_valida(monkeypatch, tmp_path, formato, flujo, esperado):
    video = {"codec_type": "video", "width": 1280, "height": 720}
    if flujo is not None:
        video["duration"] = flujo
    _ffprobe_falso(monkeypatch, {"streams": [video], "format": {} if formato is None else {"duration": formato}})
    assert probar._medir(tmp_path / "v.mp4")["segundos"] == esperado


# ---------------------------------------------------------------------------
# X9 · un parcial que no se deja borrar no tapa el éxito

def _unlink_que_niega_el_parcial(monkeypatch):
    unlink = Path.unlink

    def negado(self, *a, **k):
        if self.name.endswith(".parcial"):
            raise PermissionError(13, "El proceso no tiene acceso al archivo (otro proceso lo usa)", str(self))
        return unlink(self, *a, **k)

    monkeypatch.setattr(Path, "unlink", negado)


def test_si_no_se_puede_borrar_el_parcial_el_archivo_final_queda_guardado_y_se_mide(env, capsys, monkeypatch, tmp_path):
    _unlink_que_niega_el_parcial(monkeypatch)
    salida = tmp_path / "s"
    code, out, err = _correr(capsys, "clip", "veo-lite", "--segundos", 4, "--si", "--salida", salida)

    assert code == 0, err
    guardado = salida / "clip-veo-lite-4s.mp4"
    assert guardado.read_bytes() == b"contenido-1"
    assert env.medidos == [guardado]
    assert "MEDIDO" in out and "falló" not in err


def test_si_el_sistema_no_deja_mover_el_parcial_se_copia_y_el_exito_se_mantiene(env, capsys, monkeypatch, tmp_path):
    """Windows: el antivirus tiene abierto el parcial, así que ni se mueve ni se borra."""
    _unlink_que_niega_el_parcial(monkeypatch)

    def replace_negado(origen, destino):
        raise PermissionError(13, "El proceso no tiene acceso al archivo", str(origen))

    monkeypatch.setattr(probar.os, "replace", replace_negado)
    salida = tmp_path / "s"
    code, out, err = _correr(capsys, "clip", "veo-lite", "--segundos", 4, "--si", "--salida", salida)

    assert code == 0, err
    guardado = salida / "clip-veo-lite-4s.mp4"
    assert guardado.read_bytes() == b"contenido-1" and env.medidos == [guardado]
    assert "MEDIDO" in out and "falló" not in err


def test_si_ni_mover_ni_copiar_funcionan_no_queda_un_destino_vacio(tmp_path, monkeypatch):
    origen = tmp_path / ".x.parcial"
    origen.write_bytes(b"datos")

    def negado(*a, **k):
        raise PermissionError(13, "acceso denegado")

    monkeypatch.setattr(probar.os, "replace", negado)
    monkeypatch.setattr(probar.shutil, "copyfile", negado)
    with pytest.raises(PermissionError):
        probar._guardar_sin_pisar(origen, tmp_path, "x", ".mp4")
    assert not (tmp_path / "x.mp4").exists()               # la reserva vacía se retira


# ---------------------------------------------------------------------------
# X10 · «una sola llamada» es de nuestro lado

def test_el_texto_no_promete_una_sola_llamada_absoluta_y_pide_revisar_que_no_haya_duplicadas(env, capsys, tmp_path):
    code, out, err = _correr(capsys, "clip", "veo-lite", "--segundos", 4, "--si", "--salida", tmp_path / "s")
    assert code == 0
    assert "un solo intento de nuestro lado" in out and "fal_client puede reenviar el envío" in out
    assert "UNA solicitud" in out and "no duplicadas" in out and "Request Details" in out


def test_el_docstring_explica_que_fal_client_puede_reenviar_el_envio():
    doc = " ".join(probar.__doc__.split())
    assert "UN solo intento de llamada de nuestro lado" in doc
    assert "fal_client puede reenviar el POST de envío hasta 10 veces" in doc and "sin idempotencia" in doc
    assert "UNA solicitud" in doc


# ---------------------------------------------------------------------------
# segunda ronda de la revisión

class _Raro(BaseException):
    """Algo que NO es una Exception (como asyncio.CancelledError): el traceback crudo del
    intérprete llevaría la clave en su mensaje."""


def test_una_excepcion_que_no_es_exception_no_suelta_un_traceback_con_la_clave(env, capsys, tmp_path):
    env.error = _Raro(f"401 Unauthorized: Authorization: Key {CLAVE}")
    code, out, err = _correr(capsys, "imagen", "grok", "--si", "--salida", tmp_path / "s")
    assert code == 1 and len(env.llamadas) == 1
    assert CLAVE not in out and CLAVE not in err
    assert "_Raro" in err and "***" in err and "Traceback" not in err


def test_un_ctrl_c_al_medir_despues_de_pagar_igual_deja_el_recordatorio_del_cobro(env, capsys, monkeypatch, tmp_path):
    def interrumpido(ruta):
        raise KeyboardInterrupt

    monkeypatch.setattr(probar, "_medir", interrumpido)
    code, out, err = _correr(capsys, "clip", "veo-lite", "--segundos", 4, "--si", "--salida", tmp_path / "s")
    assert code == 1 and len(env.llamadas) == 1
    assert "Interrumpido" in err and "Traceback" not in err
    assert "Recordatorio" in out and "Request Details" in out and "Costo esperado" in out


def test_el_plan_corre_el_adaptador_sin_su_decorador_de_trazas(env, capsys, monkeypatch, tmp_path):
    """clip.animar lleva @observe: planearlo con el decorador exportaría un span falso
    (en ERROR) a Langfuse antes de cada prueba pagada. El plan usa __wrapped__; la llamada
    real, la función tal cual."""
    from pipeline import clip, fal, modelos_ia

    llamado: list[str] = []

    async def desnudo(prompt, url, formato, modelo, segundos):
        llamado.append("desnudo")
        res = await fal.llamar(modelos_ia.resolver("clip", modelo).endpoint_para(bool(url)), {"prompt": prompt})
        return res["video"]["url"]

    async def decorado(prompt, url, formato, modelo, segundos):
        llamado.append("decorado")
        return await desnudo(prompt, url, formato, modelo, segundos)

    decorado.__wrapped__ = desnudo
    monkeypatch.setattr(clip, "animar", decorado)

    code, out, err = _correr(capsys, "clip", "veo-lite", "--segundos", 4)             # ensayo
    assert code == 0 and llamado == ["desnudo"]

    llamado.clear()
    code, out, err = _correr(capsys, "clip", "veo-lite", "--segundos", 4, "--si", "--salida", tmp_path / "s")
    assert code == 0, err
    # el plan, sin decorar; la llamada real sí pasa por la función decorada (que a su vez llama al desnudo)
    assert llamado == ["desnudo", "decorado", "desnudo"]
