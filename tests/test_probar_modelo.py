"""tools/probar_modelo.py: la prueba pagada pequeña de un modelo del selector.

Lo que este archivo defiende:
  * el ensayo (sin --si) no llama a nada, no pide clave y no crea carpetas, y
    enseña lo que el adaptador REAL mandaría: endpoint, argumentos, costo en
    dólares y créditos (o «sin precio confirmado» / «sin número en tarifas.json»);
  * con --si y sin FAL_KEY, o con una duración que el modelo no admite, o sin
    ffprobe, sale con 2 y NO llama (nada se gasta si algo no se puede comprobar);
  * la clave de fal jamás sale en pantalla, ni dentro de un mensaje de error;
  * UNA sola llamada por corrida: el reintento del clip se corta;
  * lo descargado nunca pisa lo que ya estaba, y se mide con ffprobe (tamaño,
    segundos y si trae pista de audio);
  * un pedido mal hecho (editar sin imagen, modelo desconocido) da un error
    claro, no una traza.

Sin red: fal, la descarga y ffprobe están sustituidos. Los tests usan veo-lite y
grok, que ya existen; el único que toca veo-fast se salta si aún no resuelve.

OJO: nada de importar pipeline a nivel de módulo (ver test_m25_clip).
"""
from __future__ import annotations

import importlib.util
import json
import re
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
        assert Path(ruta).is_file(), "se mide el archivo ya guardado"
        e.medidos.append(Path(ruta))
        return dict(e.medida)

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


def test_si_el_adaptador_y_la_tabla_no_concuerdan_no_se_gasta(env, capsys, monkeypatch, foto):
    from pipeline import modelos_ia
    monkeypatch.setattr(modelos_ia.Modelo, "endpoint_para", lambda self, con_imagen: "fal-ai/otro")
    code, out, err = _correr(capsys, "editar", "grok", "--imagen", foto, "--si")
    assert code == 1 and env.llamadas == []
    assert "fal-ai/otro" in err and "No se gasta nada" in err


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
