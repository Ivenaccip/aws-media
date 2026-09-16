"""M22 · C y D — el editor que solo sabía retocar, y los botones que no bajaban.

**C.** El editor de imágenes tenía un solo modo y su instrucción al modelo dice
«keep every other part of the original pixel-identical». Esa frase es
exactamente lo que impedía lo que pedían los testers: subían un boceto, pedían
«pásalo a acuarela» y recibían el mismo boceto con un retoque local. No era que
Nano Banana no supiera — se lo estábamos prohibiendo, y encima el endpoint
exigía pintar una zona.

**D.** «No hay botón de descargar en algunos casos.» Los había, pero no
descargaban: el atributo `download` de un `<a>` lo IGNORA el navegador cuando
el archivo vive en otro origen, y todo lo nuestro vive en el CDN. Y el caso
grande era peor que eso: en el servicio, el modal de Publicar llamaba a
`descargables()`, que lee el disco de la Lambda, donde el proyecto no está —
la película estaba hecha en S3 y no había forma de bajarla.
"""
import pytest
from fastapi.testclient import TestClient

from pipeline import creditos, media_fal
from server import publicar_api


@pytest.fixture
def cliente():
    from server.app import app
    return TestClient(app)


@pytest.fixture
def srv(monkeypatch, tmp_path):
    from server import app as srv
    monkeypatch.setattr(srv, "_dir_imagenes", lambda: tmp_path / "_imagenes")
    return srv


IMG = {"imagen": ("imagen.jpg", b"jpg-original", "image/jpeg")}
MARCA = {"marcada": ("marcada.jpg", b"jpg-marcada", "image/jpeg")}


# ---------------------------------------------------------------------------
# C · los dos modos del editor de imágenes

def test_transformar_no_le_pide_al_modelo_que_no_cambie_nada(monkeypatch):
    """El corazón del bug: la instrucción del pincel ordena dejar el resto
    pixel-idéntico, y por eso un cambio de estilo era imposible. La del modo
    nuevo no puede heredar esa frase."""
    vistos = {}

    async def espiar(app, args, **kw):
        vistos["prompt"] = args["prompt"]
        return {"images": [{"url": "https://fal/x.jpg"}]}

    async def no_descargar(url, destino):
        destino.write_bytes(b"jpg")

    async def subir(p):
        return "https://fal/in.jpg"

    from pipeline import fal
    monkeypatch.setattr(fal, "llamar", espiar)
    monkeypatch.setattr(fal, "descargar", no_descargar)
    monkeypatch.setattr(fal, "subir_archivo", subir)

    import asyncio
    from pathlib import Path
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        src, dst = Path(td) / "a.jpg", Path(td) / "b.jpg"
        src.write_bytes(b"jpg")
        asyncio.run(media_fal.imagen_transformar("acuarela suave", src, dst))

    p = vistos["prompt"].lower()
    assert "pixel-identical" not in p, (
        "el modo «toda la imagen» heredó la cláusula que le prohíbe cambiar el "
        "resto: con ella, pedir otro estilo devuelve la misma imagen")
    assert "entire" in p and "acuarela suave" in vistos["prompt"]
    # lo que sí se conserva es el CONTENIDO: si no, deja de ser SU boceto
    assert "composition" in p


def test_el_modo_todo_no_exige_zona_pintada(cliente, srv, monkeypatch):
    async def fake(prompt, imagen, destino, **kw):
        destino.write_bytes(b"jpg-transformada")
        return "https://fal/x.jpg"

    monkeypatch.setattr(media_fal, "imagen_transformar", fake)
    r = cliente.post("/api/imagenes/editar",
                     data={"prompt": "pásalo a acuarela", "modo": "todo"}, files=IMG)
    assert r.status_code == 200, r.text
    assert cliente.get(r.json()["url"]).content == b"jpg-transformada"


def test_el_modo_pincel_sigue_exigiendo_la_zona(cliente, srv):
    """El modo viejo no se relaja: sin zona pintada no sabe qué tocar."""
    r = cliente.post("/api/imagenes/editar",
                     data={"prompt": "quita el letrero", "modo": "pincel"}, files=IMG)
    assert r.status_code == 422
    assert "transformar toda la imagen" in r.json()["detail"]


def test_sin_modo_declarado_se_comporta_como_siempre(cliente, srv, monkeypatch):
    """Compat: el front viejo no manda `modo` y debe seguir pintando zonas."""
    llamadas = []

    async def fake(prompt, imagen, marcada, destino, **kw):
        llamadas.append("pincel")
        destino.write_bytes(b"jpg")
        return "https://fal/x.jpg"

    monkeypatch.setattr(media_fal, "imagen_pincel", fake)
    r = cliente.post("/api/imagenes/editar", data={"prompt": "quita el letrero"},
                     files={**IMG, **MARCA})
    assert r.status_code == 200 and llamadas == ["pincel"]


def test_un_modo_inventado_no_cobra(cliente, srv, monkeypatch):
    movimientos = []
    monkeypatch.setattr(creditos, "activo", lambda: True)
    monkeypatch.setattr(creditos, "cobrar", lambda c, ref: movimientos.append(ref))
    r = cliente.post("/api/imagenes/editar",
                     data={"prompt": "algo", "modo": "magia"}, files=IMG)
    assert r.status_code == 422 and movimientos == []


def test_los_dos_modos_cuestan_lo_mismo(cliente, srv, monkeypatch):
    """Misma tarifa de imagen: una llamada a Nano Banana es una llamada."""
    cobros = []

    async def fake(prompt, imagen, destino, **kw):
        destino.write_bytes(b"jpg")
        return "https://fal/x.jpg"

    monkeypatch.setattr(media_fal, "imagen_transformar", fake)
    monkeypatch.setattr(creditos, "activo", lambda: True)
    monkeypatch.setattr(creditos, "cobrar", lambda c, ref: cobros.append((c, ref)))
    cliente.post("/api/imagenes/editar",
                 data={"prompt": "acuarela", "modo": "todo"}, files=IMG)
    assert cobros == [(creditos.costo_imagen(), "imagen:editor")]


def test_la_pagina_ofrece_los_dos_modos():
    from pathlib import Path
    html = Path("static/editor-imagenes.html").read_text(encoding="utf-8")
    assert 'id="modo-todo"' in html and 'id="modo-pincel"' in html
    assert "fd.append('modo', MODO)" in html, "el modo elegido no viaja al servidor"


# ---------------------------------------------------------------------------
# D · que el botón de descargar descargue

CLAVES = [
    ("videos/v1/pelicula.mp4", 1000),
    ("videos/v1/pelicula-subtitulado.mp4", 2000),
    ("videos/v1/output/preview-tight.mp4", 3000),
    ("videos/v1/output/shorts/short_01_yt.mp4", 4000),   # tiene su propia página
    ("videos/v1/work/subs/subs.srt", 50),
    ("videos/v1/work/editor/proxy.mp4", 9000),           # material de trabajo
    ("videos/v1/subidas/charla.mp4", 8000),
]


@pytest.fixture
def s3(monkeypatch):
    from pipeline import media_sync
    monkeypatch.setattr(media_sync, "listar_prefijo_con_bytes",
                        lambda pre: [(k, t) for k, t in CLAVES if k.startswith(pre)])


def test_los_descargables_en_nube_salen_de_s3(s3):
    """En el servicio el proyecto NO está en el disco de la Lambda: mirarlo ahí
    daba 404 y el modal de Publicar no enseñaba nada."""
    d = publicar_api.descargables_nube("v1")
    assert d["pelicula"] == ("videos/v1/pelicula.mp4", 1000)
    assert d["subtitulado"][0] == "videos/v1/pelicula-subtitulado.mp4"
    assert d["preview-tight"][0] == "videos/v1/output/preview-tight.mp4"
    assert d["srt"][0] == "videos/v1/work/subs/subs.srt"


def test_output_no_se_recorre_hacia_dentro(s3):
    """Espeja el glob local, que tampoco es recursivo: los shorts se bajan desde
    su propia página, y colarlos aquí llenaría el modal de Publicar."""
    claves = publicar_api.descargables_nube("v1")
    assert not any("shorts" in k for k in claves)
    assert not any(key.startswith("videos/v1/work/editor/")
                   for key, _ in claves.values())
    assert not any(key.startswith("videos/v1/subidas/")
                   for key, _ in claves.values())


def test_la_url_firmada_pide_que_el_archivo_se_guarde(monkeypatch):
    """La instrucción no puede viajar en el enlace (`download` no cruza
    orígenes), así que viaja en el archivo."""
    from server import media_api
    visto = {}

    class S3Falso:
        def generate_presigned_url(self, op, Params, ExpiresIn):
            visto.update(op=op, params=Params, expira=ExpiresIn)
            return "https://s3.example/firmada"

    monkeypatch.setenv("MEDIA_BUCKET", "bucket-de-prueba")
    monkeypatch.setattr(media_api, "_s3", lambda: S3Falso())
    url = media_api.url_firmada_descarga("videos/v1/pelicula.mp4", "v1-pelicula.mp4")
    assert url == "https://s3.example/firmada" and visto["op"] == "get_object"
    assert visto["params"]["ResponseContentDisposition"] == \
        'attachment; filename="v1-pelicula.mp4"'


def test_el_nombre_del_archivo_no_puede_romper_el_encabezado(monkeypatch):
    """El nombre llega por query string: unas comillas dentro cortarían el
    Content-Disposition en dos."""
    from server import media_api
    visto = {}

    class S3Falso:
        def generate_presigned_url(self, op, Params, ExpiresIn):
            visto.update(Params)
            return "u"

    monkeypatch.setenv("MEDIA_BUCKET", "bucket-de-prueba")
    monkeypatch.setattr(media_api, "_s3", lambda: S3Falso())
    media_api.url_firmada_descarga("videos/v1/x.mp4", 'mal"; algo=otra cosa.mp4')
    puesto = visto["ResponseContentDisposition"]
    assert puesto.count('"') == 2 and ";" not in puesto[len("attachment; "):]


@pytest.mark.parametrize("key", [
    "videos/../secreto.mp4",
    "/etc/passwd",
    "imagenes/otro-usuario/foto.jpg",
    "otracosa/v1/x.mp4",
])
def test_no_se_descarga_lo_que_no_es_tuyo(monkeypatch, key):
    """La key la escribe el navegador: sin esta guarda, cambiarla a mano bajaría
    el archivo de otro."""
    from fastapi import HTTPException

    from pipeline import db
    from server import media_api
    monkeypatch.setattr(db, "usuario_actual", lambda: "yo")
    monkeypatch.setattr(db, "cargar_proyecto_editor", lambda u, n: None)
    with pytest.raises(HTTPException):
        media_api._mio(key)


def test_tu_propia_imagen_si_se_descarga(monkeypatch):
    from pipeline import db
    from server import media_api
    monkeypatch.setattr(db, "usuario_actual", lambda: "yo")
    media_api._mio("imagenes/yo/foto.jpg")        # no lanza


def test_tu_propio_proyecto_si_se_descarga(monkeypatch):
    from pipeline import db
    from server import media_api
    monkeypatch.setattr(db, "usuario_actual", lambda: "yo")
    monkeypatch.setattr(db, "cargar_proyecto_editor", lambda u, n: {"subidas": []})
    media_api._mio("videos/v1/output/preview-tight.mp4")   # no lanza


def test_publicar_a_redes_dice_la_verdad_en_nube(monkeypatch):
    """La otra mitad de b3 lee el disco del proyecto, que en el servicio no
    existe. Antes ni se llegaba a verla (el modal moría al pedir su estado);
    ahora que la descarga funciona, el aviso tiene que explicarse."""
    from fastapi import HTTPException
    monkeypatch.setattr(publicar_api, "_nube", lambda: True)
    with pytest.raises(HTTPException) as e:
        publicar_api._solo_local("Agendar en tus redes")
    assert e.value.status_code == 503 and "descarga el video" in e.value.detail


def test_en_local_publicar_sigue_funcionando(monkeypatch):
    monkeypatch.setattr(publicar_api, "_nube", lambda: False)
    publicar_api._solo_local("Agendar en tus redes")   # no lanza


def test_el_estado_de_publicar_responde_en_nube(monkeypatch, s3):
    """El arreglo de D se quedó a medias: la rama de nube listaba bien los
    descargables, pero la respuesta leía el registro de publicaciones con la
    ruta del disco, que solo existe en local. En el servicio eso era un
    UnboundLocalError → 500, y el modal de Publicar volvía a no ofrecer nada.
    En la nube no hay registro que leer: agendar todavía no corre ahí."""
    from server import editor
    monkeypatch.setattr(publicar_api, "_nube", lambda: True)
    monkeypatch.setattr(editor, "_proyecto_nube", lambda name: {"subidas": []})
    monkeypatch.setattr(publicar_api.blotato, "disponible", lambda: False)
    r = publicar_api.estado("v1")
    assert {a["clave"] for a in r["descargables"]} >= {"pelicula", "subtitulado", "srt"}
    assert r["publicadas"] == [] and r["blotato"] is False


def test_el_front_de_shorts_ofrece_ver_y_descargar():
    from pathlib import Path
    html = Path("static/shorts.html").read_text(encoding="utf-8")
    assert "urlDescarga(" in html and "/api/media/descarga?key=" in html
    # el texto viejo se cita en los comentarios a propósito: lo que no puede
    # volver es el ENLACE que lo llevaba
    assert ">abrir / descargar" not in html, (
        "volvió el enlace que solo abría el mp4 en una pestaña")


def test_el_editor_puede_bajar_sus_imagenes_y_su_preview():
    from pathlib import Path
    html = Path("tools/editor/index.html").read_text(encoding="utf-8")
    assert "?descargar=1" in html, "las imágenes generadas no tienen cómo bajarse"
    assert "/api/media/descarga?key=" in html, "el preview de render tampoco"
