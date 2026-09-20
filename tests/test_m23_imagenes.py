"""M23 — una sola herramienta de imágenes: crear y editar en la misma pantalla.

Crear y editar eran dos páginas con el mismo monedero, el mismo guardrail y el
mismo orbe; la diferencia real es si hay una imagen sobre la mesa. La página
única (static/imagenes.html) reemplaza a las dos viejas —sus URLs redirigen—
y por debajo usa los MISMOS dos endpoints, con estos añadidos:

- **formato** al crear (horizontal, vertical o cuadrado): los prompts solos no
  alcanzaban para pedir una imagen apaisada o de teléfono;
- **estilo** al transformar la imagen entera, como destino («pásala a
  Animado») y solo si el usuario lo elige; en el pincel no, porque la zona
  nueva tiene que pegar con el resto;
- **los bytes** de una imagen propia desde nuestro origen, para «seguir
  editando»: la URL del CDN no manda CORS y ensucia el canvas;
- **la lista** de las imágenes del usuario, para «Mis imágenes» del inicio.

La pantalla copia la de «Crea tu video»: título centrado cuya primera palabra
gira (Crea / Edita / Bocetea), estilo + texto arriba y los tres formatos
abajo. Con imagen —subida, recién creada o pedida en el texto («edítala»)—
pasa a editar: la imagen grande y a la derecha qué cambiar.

Y una corrección que venía de antes: en la nube, la carpeta local de imágenes
la comparten todos los usuarios del contenedor, así que ahí ya no se deja ni se
sirve nada.
"""
import asyncio
import re
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from pipeline import creditos, db, fal, media_fal, media_sync
from pipeline.styles import ESTILOS

RAIZ = Path(__file__).resolve().parent.parent
PAGINA = RAIZ / "static" / "imagenes.html"


@pytest.fixture
def cliente():
    from server.app import app
    return TestClient(app)


@pytest.fixture
def srv(monkeypatch, tmp_path):
    from server import app as srv
    monkeypatch.setattr(srv, "_dir_imagenes", lambda: tmp_path / "_imagenes")
    return srv


@pytest.fixture
def nube(monkeypatch):
    """El servicio: JOBS_BACKEND=aws y un S3 falso en memoria, por usuario."""
    monkeypatch.setenv("JOBS_BACKEND", "aws")
    monkeypatch.setenv("CDN_BASE", "https://cdn.example")
    s3 = {}

    def subir(local, key):
        s3[key] = Path(local).read_bytes()

    def bajar(key, destino):
        if key not in s3:
            return False
        Path(destino).write_bytes(s3[key])
        return True
    monkeypatch.setattr(media_sync, "subir_archivo", subir)
    monkeypatch.setattr(media_sync, "bajar_archivo", bajar)
    return s3


IMG = {"imagen": ("imagen.jpg", b"jpg-original", "image/jpeg")}
MARCA = {"marcada": ("marcada.jpg", b"jpg-marcada", "image/jpeg")}


@pytest.fixture
def nano(monkeypatch):
    vistos = {}

    async def fake(prompt, destino, **kw):
        vistos.update(prompt=prompt, **kw)
        destino.write_bytes(b"jpg-creada")
        return "https://fal/x.jpg"
    monkeypatch.setattr(media_fal, "imagen_fal", fake)
    return vistos


# ---------------------------------------------------------------------------
# formato al crear

@pytest.mark.parametrize("formato,aspecto", [
    ("horizontal", "16:9"), ("vertical", "9:16"), ("cuadrado", "1:1")])
def test_crear_pide_el_aspecto_del_formato(cliente, srv, nano, formato, aspecto):
    r = cliente.post("/api/imagenes", json={"prompt": "un faro", "formato": formato})
    assert r.status_code == 200, r.text
    assert nano["aspecto"] == aspecto


def test_sin_formato_sigue_saliendo_cuadrada(cliente, srv, nano):
    """Una pestaña vieja abierta no manda formato: su imagen no cambia de golpe."""
    assert cliente.post("/api/imagenes", json={"prompt": "un faro"}).status_code == 200
    assert nano["aspecto"] == "1:1"


def test_un_formato_inventado_no_cobra(cliente, srv, nano, monkeypatch):
    cobros = []
    monkeypatch.setattr(creditos, "activo", lambda: True)
    monkeypatch.setattr(creditos, "cobrar", lambda c, ref: cobros.append(ref))
    r = cliente.post("/api/imagenes", json={"prompt": "un faro", "formato": "panoramico"})
    assert r.status_code == 422 and cobros == [] and "prompt" not in nano


def test_el_formato_de_imagenes_no_toca_el_del_video():
    """Veo no acepta 1:1: el cuadrado vive en una tabla propia."""
    from pipeline.models import FORMATOS
    from server.app import ASPECTOS_IMAGEN
    assert "cuadrado" not in FORMATOS
    assert ASPECTOS_IMAGEN["horizontal"] == FORMATOS["horizontal"]["aspecto"]
    assert ASPECTOS_IMAGEN["vertical"] == FORMATOS["vertical"]["aspecto"]


def _espiar_fal(monkeypatch):
    vistos = {}

    async def espiar(app, args, **kw):
        vistos.update(app=app, args=args)
        return {"images": [{"url": "https://fal/x.jpg"}]}

    async def descargar(url, destino):
        destino.write_bytes(b"jpg")

    async def subir(p):
        return "https://fal/ref.jpg"
    monkeypatch.setattr(fal, "llamar", espiar)
    monkeypatch.setattr(fal, "descargar", descargar)
    monkeypatch.setattr(fal, "subir_archivo", subir)
    return vistos


def test_quien_no_elige_formato_recibe_cuadrada_por_escrito(monkeypatch, tmp_path):
    """M1 (personaje) y el b-roll del editor también llaman aquí y no eligen
    formato. Recibían cuadrada porque ese era el valor por defecto de Nano
    Banana, no porque nadie lo hubiera decidido: al cambiar de modelo (M23 · B)
    el encuadre se habría movido solo y no lo habría visto nadie hasta ver las
    imágenes. Ahora va escrito y ya no depende del modelo de turno."""
    vistos = _espiar_fal(monkeypatch)
    asyncio.run(media_fal.imagen_fal("un faro", tmp_path / "a.jpg"))
    assert vistos["args"]["aspect_ratio"] == "1:1"
    asyncio.run(media_fal.imagen_fal("un faro", tmp_path / "b.jpg", aspecto="9:16"))
    assert vistos["args"]["aspect_ratio"] == "9:16"


# ---------------------------------------------------------------------------
# estilo al transformar

@pytest.fixture
def transformar(monkeypatch):
    vistos = {}

    async def fake(prompt, imagen, destino, **kw):
        vistos["prompt"] = prompt
        destino.write_bytes(b"jpg")
        return "https://fal/x.jpg"
    monkeypatch.setattr(media_fal, "imagen_transformar", fake)
    return vistos


# «animated» es también el estilo de reserva: probarlo solo con él no
# distinguiría «se aplicó el elegido» de «se aplicó el de siempre»
@pytest.mark.parametrize("estilo", ["cinematic", "monochrome", "artistic"])
def test_transformar_lleva_el_estilo_elegido(cliente, srv, transformar, estilo):
    r = cliente.post("/api/imagenes/editar", files=IMG, data={
        "prompt": "de noche", "modo": "todo", "estilo": estilo})
    assert r.status_code == 200, r.text
    assert transformar["prompt"].startswith("de noche")
    assert ESTILOS[estilo].prompt in transformar["prompt"]
    assert ESTILOS["animated"].prompt not in transformar["prompt"]


def test_transformar_con_estilo_propio(cliente, srv, transformar):
    cliente.post("/api/imagenes/editar", files=IMG, data={
        "prompt": "de noche", "modo": "todo",
        "estilo": "custom", "estilo_custom": "linocut print, two inks"})
    assert "linocut print, two inks" in transformar["prompt"]


def test_transformar_sin_estilo_no_inventa_uno(cliente, srv, transformar):
    """Es lo que manda la página nueva mientras el usuario no elige un estilo,
    y lo que siempre mandó editor-imagenes.html."""
    cliente.post("/api/imagenes/editar", files=IMG, data={"prompt": "de noche", "modo": "todo"})
    assert transformar["prompt"] == "de noche"


def test_el_pincel_ignora_el_estilo(cliente, srv, monkeypatch):
    """La zona nueva tiene que pegar con el resto de SU imagen: pedirle otro
    estilo la delataría."""
    vistos = {}

    async def fake(prompt, imagen, marcada, destino, **kw):
        vistos["prompt"] = prompt
        destino.write_bytes(b"jpg")
        return "https://fal/x.jpg"
    monkeypatch.setattr(media_fal, "imagen_pincel", fake)
    r = cliente.post("/api/imagenes/editar", files={**IMG, **MARCA}, data={
        "prompt": "una ventana", "modo": "pincel", "estilo": "cinematic"})
    assert r.status_code == 200, r.text
    assert vistos["prompt"] == "una ventana"


def test_con_estilo_sigue_costando_una_imagen(cliente, srv, transformar, monkeypatch):
    cobros = []
    monkeypatch.setattr(creditos, "activo", lambda: True)
    monkeypatch.setattr(creditos, "cobrar", lambda c, ref: cobros.append((c, ref)))
    r = cliente.post("/api/imagenes/editar", files=IMG, data={
        "prompt": "de noche", "modo": "todo", "estilo": "artistic"})
    assert r.status_code == 200, r.text
    assert cobros == [(creditos.costo_imagen(), "imagen:editor")]


# ---------------------------------------------------------------------------
# los bytes de una imagen propia, desde nuestro origen

def test_en_local_los_bytes_salen_del_disco(cliente, srv, tmp_path, monkeypatch):
    """En local no hay S3: el disco es la única copia."""
    monkeypatch.delenv("JOBS_BACKEND", raising=False)
    (tmp_path / "_imagenes").mkdir()
    (tmp_path / "_imagenes" / "abc123.jpg").write_bytes(b"jpg-local")
    monkeypatch.setattr(media_sync, "bajar_archivo",
                        lambda k, d: pytest.fail("en local no se consulta S3"))
    r = cliente.get("/api/imagenes/abc123.jpg/archivo")
    assert r.status_code == 200 and r.content == b"jpg-local"
    assert r.headers["content-type"] == "image/jpeg"


def test_en_nube_los_bytes_salen_de_la_carpeta_del_usuario(cliente, srv, nube, monkeypatch):
    monkeypatch.setattr(db, "usuario_actual", lambda: "ana")
    nube["imagenes/ana/abc123.jpg"] = b"jpg-de-ana"
    r = cliente.get("/api/imagenes/abc123.jpg/archivo")
    assert r.status_code == 200 and r.content == b"jpg-de-ana"


def test_en_nube_el_disco_compartido_no_se_sirve(cliente, srv, nube, tmp_path, monkeypatch):
    """/tmp/work/_imagenes lo comparten todos los usuarios del contenedor
    caliente: lo que haya ahí no es de quien pregunta."""
    (tmp_path / "_imagenes").mkdir()
    (tmp_path / "_imagenes" / "abc123.jpg").write_bytes(b"jpg-de-ana")
    monkeypatch.setattr(db, "usuario_actual", lambda: "beto")
    assert cliente.get("/api/imagenes/abc123.jpg/archivo").status_code == 404
    r = cliente.get("/api/imagenes/abc123.jpg", follow_redirects=False)
    assert r.status_code in (302, 307)
    assert r.headers["location"] == "https://cdn.example/imagenes/beto/abc123.jpg"


def test_otro_usuario_no_alcanza_lo_que_ana_acaba_de_crear(cliente, srv, nube, nano,
                                                           tmp_path, monkeypatch):
    """El caso completo en un contenedor caliente: Ana crea, Beto adivina el
    nombre. Ana la encuentra; Beto no."""
    monkeypatch.setattr(db, "usuario_actual", lambda: "ana")
    nombre = cliente.post("/api/imagenes", json={"prompt": "un faro"}).json()["nombre"]
    assert not (tmp_path / "_imagenes" / nombre).exists(), "la copia local se quedó en /tmp"
    assert nube[f"imagenes/ana/{nombre}"] == b"jpg-creada"
    assert cliente.get(f"/api/imagenes/{nombre}/archivo").content == b"jpg-creada"
    monkeypatch.setattr(db, "usuario_actual", lambda: "beto")
    assert cliente.get(f"/api/imagenes/{nombre}/archivo").status_code == 404


def test_en_nube_la_copia_de_la_peticion_se_borra(cliente, srv, nube, monkeypatch, tmp_path):
    """Cada petición baja SU copia y la borra al responder: nada queda en /tmp."""
    import tempfile
    monkeypatch.setattr(tempfile, "tempdir", str(tmp_path))
    monkeypatch.setattr(db, "usuario_actual", lambda: "ana")
    nube["imagenes/ana/abc123.jpg"] = b"jpg-de-ana"
    antes = set(tmp_path.iterdir())
    assert cliente.get("/api/imagenes/abc123.jpg/archivo").status_code == 200
    assert set(tmp_path.iterdir()) == antes


def test_en_nube_editar_tampoco_deja_copia(cliente, srv, nube, transformar, tmp_path, monkeypatch):
    monkeypatch.setattr(db, "usuario_actual", lambda: "ana")
    r = cliente.post("/api/imagenes/editar", files=IMG, data={"prompt": "de noche", "modo": "todo"})
    nombre = r.json()["nombre"]
    assert f"imagenes/ana/{nombre}" in nube
    assert not (tmp_path / "_imagenes" / nombre).exists()


def test_sin_imagen_en_ningun_lado_es_404(cliente, srv, nube):
    assert cliente.get("/api/imagenes/abc123.jpg/archivo").status_code == 404


@pytest.mark.parametrize("nombre", ["abc.png", "..jpg", "abc.jpg.exe",
                                   "abc..jpg", "-abc.jpg", "abc-.jpg"])
def test_un_nombre_raro_no_llega_a_s3(cliente, srv, nube, monkeypatch, nombre):
    monkeypatch.setattr(media_sync, "bajar_archivo",
                        lambda k, d: pytest.fail(f"{nombre!r} llegó a S3"))
    assert cliente.get(f"/api/imagenes/{nombre}/archivo").status_code == 404


# ---------------------------------------------------------------------------
# MIX no bautiza como el editor

def test_las_imagenes_de_mix_se_sirven(cliente, srv, nube, monkeypatch):
    """El editor pone 12 hex; MIX pone `mix-<hex>-base.jpg` (la foto que sube
    el usuario) y `mix-<campaña>-<fecha>.jpg` (la de cada día). El guarda pedía
    `isalnum()`, así que el guion las tumbaba TODAS y la pantalla recibía 404
    al pedir SU PROPIA foto, en 4 ms, sin llegar a mirar S3.

    Los nombres los arman los mismos ayudantes que en producción, y la URL sale
    del mismo `_url` que se le manda a la pantalla: si alguien cambia cómo se
    bautizan y no toca el guarda, esto falla aquí y no en casa de un cliente."""
    from datetime import date

    from pipeline import mix
    from server import mix_api
    monkeypatch.setattr(db, "usuario_actual", lambda: "ana")
    campana = "mix-e348a935c769"
    for nombre in (f"{campana}-base.jpg", mix.nombre_del_dia(campana, date(2026, 9, 21))):
        nube[f"imagenes/ana/{nombre}"] = b"jpg-de-mix"
        r = cliente.get(mix_api._url(nombre))
        assert r.status_code == 200 and r.content == b"jpg-de-mix", nombre


@pytest.mark.parametrize("nombre", [
    "../otro/abc.jpg",
    "/etc/passwd.jpg",
    "a/b.jpg",
    "..\\otro\\abc.jpg",
    "ABC123.JPG",
])
def test_ningun_nombre_se_sale_de_la_carpeta_del_usuario(srv, nombre):
    """Lo que el guarda tiene que impedir no son los guiones: es salir de
    `imagenes/<usuario>/`. La regla nombra lo permitido, así que no depende de
    acordarse de todas las formas de escribir `..`."""
    assert not srv._servible(nombre)


def test_la_pagina_se_sirve(cliente):
    r = cliente.get("/imagenes.html")
    assert r.status_code == 200 and 'id="enviar"' in r.text


# ---------------------------------------------------------------------------
# la página

CARGAR = "function cargarImagen(f, nombre = null)"
SEGUIR = "$('#seguir').onclick = async"   # la otra mención solo lo llama


@pytest.fixture(scope="module")
def html():
    return PAGINA.read_text(encoding="utf-8")


def _js(html):
    return "\n".join(re.findall(r"<script>(.*?)</script>", html, re.S))


def _bloque(js, inicio):
    """Desde `inicio` hasta la llave que lo cierra."""
    i = js.index(inicio)
    j = js.index("{", i)
    nivel = 0
    for k in range(j, len(js)):
        nivel += {"{": 1, "}": -1}.get(js[k], 0)
        if nivel == 0:
            return js[i:k + 1]
    raise AssertionError(f"sin cierre: {inicio}")


@pytest.fixture(scope="module")
def envio(html):
    return _bloque(_js(html), "$('#enviar').onclick")


def test_ofrece_los_tres_formatos_y_los_manda(html, envio):
    for f in ("horizontal", "vertical", "cuadrado"):
        assert f'data-fmt="{f}"' in html
    assert "estilo_custom: $('#estilo_custom').value, formato })" in envio


def test_con_imagen_el_formato_se_lee_y_no_se_elige(html):
    js = _js(html)
    assert "if (!b || archivo) return;" in _bloque(js, "$('#formatos').onclick")
    carga = _bloque(js, CARGAR)
    assert "fijarFormato(imgC.width > imgC.height * 1.15 ? 'horizontal'" in carga
    assert "imgC.height > imgC.width * 1.15 ? 'vertical' : 'cuadrado'" in carga


def test_quitar_la_imagen_devuelve_el_formato_que_eligio_el_usuario(html):
    """El formato leído de una foto vertical no puede quedarse como elección
    para la siguiente imagen que se cree."""
    js = _js(html)
    assert "fijarFormato(formatoElegido)" in _bloque(js, "function soltarImagen()")
    assert "formatoElegido = f;" in _bloque(js, "function elegirFormato(f)")


def test_los_dos_modos_viajan_y_el_estilo_solo_si_se_eligio(html):
    cuerpo = _bloque(_js(html), "async function cuerpoEditar")
    assert "fd.append('modo', modo)" in cuerpo
    rama = _bloque(cuerpo, "if (modo === 'todo' && estiloDestino)")
    assert "fd.append('estilo', estiloDestino)" in rama
    assert cuerpo.count("fd.append('estilo'") == 1


def test_al_transformar_el_estilo_por_defecto_no_viaja(html):
    """El chip «Animado» viene marcado para CREAR. Si viajara al transformar,
    «pásala a acuarela» llegaría como «acuarela… Target look: Pixar»."""
    js = _js(html)
    assert "let estiloDestino = null;" in js
    assert "estiloDestino = null" in _bloque(js, "function soltarImagen()")
    fijar = _bloque(js, "function fijarEstilo(id, destino = transformando())")
    assert "if (destino) estiloDestino" in fijar
    # los chips de cada tarjeta dicen a cuál estilo tocan, sin adivinarlo
    assert "fijarEstilo(b.dataset.id, false)" in _bloque(js, "$('#estilos').onclick")
    assert "fijarEstilo(b.dataset.id, true)" in _bloque(js, "$('#estilos-destino').onclick")
    assert "const transformando = () => vista === 'editar' && MODO === 'todo';" in js


def test_el_estilo_propio_de_crear_y_el_de_transformar_no_se_mezclan(html):
    cuerpo = _bloque(_js(html), "async function cuerpoEditar")
    assert "$('#estilo_custom_dest').value" in cuerpo
    assert "$('#estilo_custom').value" not in cuerpo
    assert 'id="estilo_custom_dest"' in html


def test_el_modo_no_se_deduce_del_trazo(envio):
    """Adivinar «transformar» porque no hay zona pintada cobraría un cambio
    que nadie pidió: sin trazo, el pincel se queja y no manda nada."""
    queja = _bloque(envio, "if (modo === 'pincel' && !hayTrazo)")
    assert queja.rstrip("}").rstrip().endswith("return;")
    assert envio.index("if (modo === 'pincel' && !hayTrazo)") < envio.index("enVuelo = true")


def test_un_atajo_a_medio_escribir_no_se_cobra(envio):
    atajo = _bloque(envio, "if (/^\\/\\S*$/.test(prompt))")
    assert "return;" in atajo
    assert envio.index("/^\\/\\S*$/") < envio.index("enVuelo = true")


def test_el_guardrail_corta_antes_de_cobrar(envio):
    corte = "if (!await guardrail(prompt)) return;"
    assert corte in envio, "el veredicto del guardrail ya no corta el envío"
    assert envio.index(corte) < envio.index("await fetch(url, pedido)")
    assert envio.count("fetch(") == 1, "hay un fetch que se salta el pedido armado"
    # el pedido se arma ANTES de moderar: tocar la pantalla durante la revisión
    # ya no cambia lo que se cobra
    assert envio.index("const pedido =") < envio.index(corte)
    assert envio.index("await cuerpoEditar(modo, prompt)") < envio.index(corte)


def test_monta_el_orbe_con_red(html):
    assert '<script src="/orbe.js">' in html
    assert "orbe.montar(" in html and 'id="orbe-hueco"' in html
    assert "precargar()" in html and "alAgotar:" in html
    assert "SIN_ORBE" in html and "window.orbe ?" in html


def test_el_orbe_se_desmonta_antes_del_error(envio):
    cuerpo = envio[envio.index("} catch (e) {"):]
    assert cuerpo.index("mando.desmontar()") < cuerpo.index("$('#gerr').textContent = e.message")


def test_guarda_contra_el_doble_cobro(html, envio):
    listener = html[html.index("document.addEventListener('monedero'"):]
    assert listener.index("enVuelo) return") < listener.index("pintaBoton()")
    pinta = _bloque(_js(html), "function pintaBoton()")
    assert pinta.index("if (enVuelo) return;") < pinta.index("$('#enviar').disabled")
    assert envio.startswith("$('#enviar').onclick = async () => {\n  if (enVuelo || cargando) return;")


def test_en_vuelo_nada_cambia_la_imagen_ni_la_vista(html):
    """«Empezar de nuevo», «Seguir editando», la miniatura o los modos a media
    petición borraban la máscara o cambiaban la vista bajo el cobro."""
    js = _js(html)
    herramientas = js[js.index("const HERRAMIENTAS"):js.index("];", js.index("const HERRAMIENTAS"))]
    for sel in ("#quitar", "#limpiar", "#seguir", "#ver-original", "#ver-resultado",
                "#mas", "#borrar", "#modo-pincel", "#modo-todo"):
        assert f"'{sel}'" in herramientas, f"{sel} sigue activo en vuelo"
    assert "'#a-crear'" in herramientas
    for f in ("function quitarAdjunto()", "function empezarDeNuevo()", "function fijarModo(m)",
              CARGAR, "function usarAtajo(i)"):
        assert "enVuelo" in _bloque(js, f).split("\n", 3)[1] + _bloque(js, f).split("\n", 3)[2], f


def test_una_carga_a_medias_no_se_cuela_bajo_la_peticion(html, envio):
    carga = _bloque(_js(html), CARGAR)
    assert carga.index("if (enVuelo) return;") < carga.index("new Image()")
    onload = _bloque(carga, "img.onload")
    assert "if (gen !== generacion || enVuelo) return;" in onload
    assert onload.index("gen !== generacion") < onload.index("archivo = f")
    assert "cargando" in envio.split("\n")[1]


def test_quitar_no_tira_el_resultado_pagado(html):
    js = _js(html)
    assert "verEstado(ultimoNombre ? 'resultado' : 'vacio')" in _bloque(js, "function quitarAdjunto()")
    assert "ultimoNombre = null" not in _bloque(js, "function quitarAdjunto()")
    # y desde la imagen original siempre hay vuelta al resultado
    assert 'id="ver-resultado"' in html
    assert "verEstado('resultado')" in _bloque(js, "$('#ver-resultado').onclick")


def test_el_resultado_llega_despues_de_la_respuesta(envio):
    assert envio.index("const d = await r.json()") < envio.index("verEstado('resultado')")


def test_seguir_editando_pide_los_bytes_a_nuestro_origen(html):
    """La URL del resultado redirige al CDN, que no manda CORS: cargarla en el
    canvas lo ensucia y la máscara ya no se puede exportar."""
    js = _js(html)
    bajar = js[js.index("const bajarPropia"):js.index(SEGUIR)]
    assert "fetch(`/api/imagenes/${nombre}/archivo`)" in bajar
    seguir = _bloque(js, SEGUIR)
    assert "await bajarPropia(nombre)" in seguir
    assert "d.url" not in seguir and "fetch(" not in seguir
    # la descarga, igual: `download` no funciona entre orígenes
    assert ("$('#descargar').href = `/api/imagenes/${propia}/archivo`"
            in _bloque(js, "function verEstado(e)"))


def test_seguir_editando_no_pinta_una_version_vieja(html):
    seguir = _bloque(_js(html), SEGUIR)
    guarda = "if (enVuelo || nombre !== ultimoNombre || ESTADO !== 'resultado') return;"
    assert guarda in seguir
    assert seguir.index(guarda) < seguir.index("cargarImagen(")


def test_pegar_texto_de_office_pega_el_texto(html):
    """Excel y PowerPoint copian el texto y además un dibujo de lo copiado."""
    pegar = _bloque(_js(html), "document.addEventListener('paste'")
    assert "includes('text/plain')) return;" in pegar
    assert pegar.index("text/plain") < pegar.index("e.preventDefault()")


def test_el_pincel_funciona_con_el_dedo(html):
    """Sin touch-action, el primer arrastre en un teléfono dispara
    pointercancel y el trazo se corta."""
    regla = html[html.index("#mask-canvas {"):]
    assert "touch-action:none" in regla[:regla.index("}")]


def test_nada_flota_encima_de_la_imagen(html):
    """La barra del pincel flotaba sobre la esquina del lienzo: un clic para
    pintar ahí caía en «Borrar». Ahora barra y acciones son filas propias."""
    for regla in (".herramientas {", ".acciones {"):
        cuerpo = html[html.index(regla):]
        cuerpo = cuerpo[:cuerpo.index("}")]
        assert "position:absolute" not in cuerpo, regla
    assert "grid-row:1" in html[html.index(".herramientas {"):][:120]
    assert "grid-row:3" in html[html.index(".acciones {"):][:120]
    zona = html[html.index(".lienzo-zona {"):]
    assert "isolation:isolate" in zona[:zona.index("}")], \
        "sin aislar, en el teléfono las acciones se pintan encima del composer"


def test_la_paleta_no_borra_por_accidente(html):
    js = _js(html)
    pinta = _bloque(js, "function pintaPaleta()")
    assert "t.startsWith('/') && !/\\s/.test(t)" in pinta
    # con solo «/» no hay nada elegido, y lo que borra nunca sale preseleccionado
    assert "sel = t.length > 1 ? visibles.findIndex(a => !a.borra) : -1;" in pinta
    assert js.index("const NUEVO") > js.index("const ATAJOS")
    teclas = _bloque(js, "$('#prompt').addEventListener('keydown'")
    assert "'Tab'" not in teclas, "Tab tiene que mover el foco, no ejecutar un atajo"
    # el comando no viaja al modelo
    usar = _bloque(js, "function usarAtajo(i)")
    assert usar.index("$('#prompt').value = ''") < usar.index("a.hacer()")


def test_la_paleta_se_anuncia(html):
    js = _js(html)
    assert 'aria-live="polite"' in html
    assert "setAttribute('aria-activedescendant'" in _bloque(js, "function marcaSel()")
    assert 'id="atajo-${i}"' in js


def test_el_formato_bloqueado_se_anuncia(html):
    assert 'aria-describedby="nota-formato"' in html
    assert "setAttribute('aria-disabled', String(conImagen))" in _bloque(_js(html), "function verEstado(e)")


def _regla(html, selector):
    """La regla de nivel superior (dos espacios): no la de un @media ni la de
    `#form > .cabeza`."""
    cuerpo = html[html.index("\n  " + selector + " {") + 3:]
    return cuerpo[:cuerpo.index("}")]


def test_la_pantalla_es_la_de_crear_video(html):
    """Estilo (1) + texto (2) arriba y los tres formatos abajo; al editar, la
    imagen ocupa dos columnas y dos filas y a la derecha va qué cambiar."""
    assert '"estilo prompt prompt" "formato formato formato"' in _regla(html, ".vista-crear .rejilla")
    editar = _regla(html, ".vista-editar .rejilla")
    assert '"imagen imagen modos" "imagen imagen prompt"' in editar
    assert "height:var(--alto-escena)" in editar
    assert ".vista-crear .solo-editar, .vista-editar .solo-crear { display:none !important; }" in html
    assert html.count('class="card p-estilo solo-crear"') == 1
    assert html.count('class="card p-formato solo-crear"') == 1
    assert 'class="card p-imagen lienzo-zona solo-editar"' in html
    assert 'class="card p-modos solo-editar"' in html
    assert 'class="card p-prompt caja"' in html        # el texto está en las dos
    # centrada también en alto, y si no cabe la página baja (nunca se corta)
    escritorio = html[html.index("@media (min-width: 901px)"):]
    assert "grid-template-rows:1fr auto auto auto 1fr" in escritorio[:300]
    assert "overflow:hidden" not in _regla(html, "body")
    # en el teléfono todo va en una columna y la imagen tiene alto propio
    movil = html[html.index("@media (max-width: 900px)"):]
    assert "grid-template-columns:minmax(0, 1fr)" in movil
    assert '"imagen" "modos" "prompt"' in movil
    assert "height:min(62dvh, 560px)" in movil


def test_el_titulo_gira_entre_crea_edita_y_bocetea(html):
    js = _js(html)
    assert "const PALABRAS = ['Crea', 'Edita', 'Bocetea'];" in js
    assert '<span class="palabra on">Crea</span>' in html
    assert 'class="palabra">Edita</span>' in html and 'class="palabra">Bocetea</span>' in html
    titulo = _bloque(js, "function pintaTitulo()")
    # gira solo con la pantalla en blanco y si el sistema no pide menos movimiento
    assert "vista === 'crear' && !$('#prompt').value.trim() && !reducir.matches" in titulo
    assert "const fija = vista === 'editar' ? 1 : 0;" in titulo
    # el lector de pantalla oye el título quieto, no las tres palabras
    assert '<span class="sr" id="titulo-texto">Crea tu imagen</span>' in html
    assert '<span aria-hidden="true"><span class="rotor" id="rotor">' in html
    assert ".palabra.on, .palabra.sale, .rejilla.entrando > .card { animation:none; }" in html


def test_tu_imagen_no_se_mueve_cuando_gira_la_palabra(html):
    """Con el ancho de cada palabra, el título centrado se reajustaba en cada
    giro y «tu imagen» bailaba. Las tres comparten celda: la caja mide lo que
    la más larga, y cada una se pega a la derecha."""
    rotor = _regla(html, ".rotor")
    assert "display:inline-grid" in rotor and "justify-items:end" in rotor
    assert "transition" not in rotor
    assert "grid-area:1 / 1" in _regla(html, ".palabra")
    assert "position:absolute" not in _regla(html, ".palabra")
    assert ".style.width" not in _js(html)


def test_el_titulo_esta_centrado_y_mas_grande_en_las_dos_pantallas(html):
    crear = (RAIZ / "static" / "crear.html").read_text(encoding="utf-8")
    for pagina in (html, crear):
        cabeza = _regla(pagina, ".cabeza")
        assert "justify-content:center" in cabeza
        assert "padding-inline:max(0px, min(300px, calc(50% - 230px)))" in cabeza
    assert "font-size:30px" in _regla(html, ".titulo")
    assert "font-size:30px" in _regla(crear, ".cabeza h1")


def _intencion(frases):
    """Evalúa la expresión de la página en node, tal cual está escrita."""
    import json
    import shutil
    import subprocess
    node = shutil.which("node")
    if not node:
        pytest.skip("node no está instalado")
    js = _js(PAGINA.read_text(encoding="utf-8"))
    ini = js.index("const QUIERE_EDITAR")
    expr = js[ini:js.index("');", ini) + 3]
    ini_sin = js.index("const sinAcentos")
    sin = js[ini_sin:js.index("\n", ini_sin)]
    codigo = (f"{expr}\n{sin}\nconsole.log(JSON.stringify("
              f"{json.dumps(frases)}.map(t => QUIERE_EDITAR.test(sinAcentos(t)))))")
    r = subprocess.run([node, "-e", codigo], capture_output=True, text=True, encoding="utf-8")
    assert r.returncode == 0, r.stderr
    return dict(zip(frases, json.loads(r.stdout)))


def test_pedir_editar_en_el_texto_abre_el_editor():
    si = ["Edita mi foto para que sea de noche", "edítala en blanco y negro",
          "quiero editarla", "EDITAR el fondo", "retoca la piel", "pon mi boceto a color",
          "mis imágenes en acuarela"]
    no = ["un edificio al atardecer", "portada editorial de revista", "una edición especial",
          "un gato con sombrero", "crea un retrato de mi perro", "créditos finales"]
    v = _intencion(si + no)
    assert all(v[t] for t in si), {t: v[t] for t in si}
    assert not any(v[t] for t in no), {t: v[t] for t in no}


def test_pedir_editar_sin_imagen_nunca_crea_una(envio):
    """«Edítala» con la pantalla aún en crear: se relee el texto al enviar, y
    sin imagen el botón se queja en vez de cobrar una imagen nueva."""
    assert envio.index("leerIntencion();") < envio.index("const modo = cual()")
    queja = _bloque(envio, "if (modo !== 'crear' && !archivo)")
    assert queja.rstrip("}").rstrip().endswith("return;")
    assert envio.index("if (modo !== 'crear' && !archivo)") < envio.index("enVuelo = true")
    js = _js(PAGINA.read_text(encoding="utf-8"))
    assert "const cual = () => (archivo || vista === 'editar' ? MODO : 'crear');" in js


def test_la_vista_sale_del_estado(html):
    js = _js(html)
    vq = _bloque(js, "function vistaQueToca()")
    assert "if (archivo || ultimoNombre || cargando) return 'editar';" in vq
    assert "(intencion || pidioEditar) && !prefiereCrear" in vq
    assert "pintaVista();" in _bloque(js, "function verEstado(e)")
    # mientras hay una petición el texto no mueve la pantalla
    assert "if (enVuelo) return;" in _bloque(js, "function leerIntencion()")
    assert "setTimeout(leerIntencion, 700)" in js


def test_lo_recien_creado_pasa_a_editarse(envio):
    """El texto de crear ya se gastó: la caja se vacía para decir qué cambiar,
    y la imagen nueva se abre en el lienzo — pero FUERA del vuelo: dentro,
    «seguir» vería enVuelo y no haría nada."""
    rama = _bloque(envio, "if (modo === 'crear')")
    assert "promptCreado = prompt;" in rama and "$('#prompt').value = '';" in rama
    assert envio.index("finally {") < envio.index("if (creada) $('#seguir').onclick();")
    js = _js(PAGINA.read_text(encoding="utf-8"))
    assert "$('#prompt').value = promptCreado;" in _bloque(js, "function empezarDeNuevo()")


def test_el_orbe_gira_donde_se_trabaja(envio):
    assert "montarOrbe(modo === 'crear' ? $('#orbe-form') : $('#orbe-hueco')" in envio


def test_mis_imagenes_abre_una_imagen_validada(html):
    js = _js(html)
    abrir = _bloque(js, "async function abrirDesdeEnlace()")
    assert "/^[0-9a-f]{12}\\.jpg$/.test(nombre)" in abrir
    assert abrir.index(".test(nombre)") < abrir.index("bajarPropia(nombre)")
    assert "cargarImagen(f, nombre)" in abrir
    assert "if (q.has('editar') || nombre) pidioEditar = true;" in abrir


def test_soltar_una_imagen_en_cualquier_parte_la_abre(html):
    js = _js(html)
    assert "document.addEventListener(ev, e => {" in js
    assert "if (!conArchivos(e)) return;" in js      # arrastrar texto no cuenta


def test_hay_respaldo_sin_unidades_de_contenedor(html):
    respaldo = html[html.index("@supports not (width: 1cqw)"):]
    assert "#lienzo-wrap" in respaldo[:200] and "#final" in respaldo[:200]


def test_el_js_de_la_pagina_es_valido(html, tmp_path):
    import shutil
    import subprocess
    node = shutil.which("node")
    if not node:
        pytest.skip("node no está instalado")
    f = tmp_path / "imagenes.js"
    f.write_text(_js(html), encoding="utf-8")
    r = subprocess.run([node, "--check", str(f)], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr


# ---------------------------------------------------------------------------
# «Mis imágenes»: la lista, las páginas viejas y el inicio

def test_en_local_la_lista_sale_del_disco_de_la_mas_nueva_a_la_mas_vieja(cliente, srv, tmp_path,
                                                                         monkeypatch):
    import os
    monkeypatch.delenv("JOBS_BACKEND", raising=False)
    d = tmp_path / "_imagenes"
    d.mkdir()
    for i, nombre in enumerate(["aaaaaaaaaaaa.jpg", "bbbbbbbbbbbb.jpg", "cccccccccccc.jpg"]):
        (d / nombre).write_bytes(b"jpg")
        os.utime(d / nombre, (1_700_000_000 + i, 1_700_000_000 + i))
    # lo que no tiene la forma de una imagen nuestra no se enseña
    (d / "notas.jpg").write_bytes(b"x")
    (d / "dddddddddddd.png").write_bytes(b"x")
    monkeypatch.setattr(media_sync, "listar_prefijo_con_fecha",
                        lambda p: pytest.fail("en local no se consulta S3"))
    r = cliente.get("/api/imagenes")
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["total"] == 3
    assert [i["nombre"] for i in d["imagenes"]] == [
        "cccccccccccc.jpg", "bbbbbbbbbbbb.jpg", "aaaaaaaaaaaa.jpg"]
    assert d["imagenes"][0] == {"nombre": "cccccccccccc.jpg", "creado": 1_700_000_002,
                                "url": "/api/imagenes/cccccccccccc.jpg"}


def test_sin_carpeta_la_lista_esta_vacia(cliente, srv, monkeypatch):
    monkeypatch.delenv("JOBS_BACKEND", raising=False)
    assert cliente.get("/api/imagenes").json() == {"total": 0, "imagenes": []}


def test_en_nube_cada_quien_ve_solo_su_carpeta(cliente, srv, nube, monkeypatch):
    pedidos = []
    claves = {
        "imagenes/ana/": [("imagenes/ana/aaaaaaaaaaaa.jpg", 10.0),
                          ("imagenes/ana/bbbbbbbbbbbb.jpg", 30.0),
                          ("imagenes/ana/sub/cccccccccccc.jpg", 99.0)],   # no es de la raíz
    }

    def listar(prefijo):
        pedidos.append(prefijo)
        return claves.get(prefijo, [])
    monkeypatch.setattr(media_sync, "listar_prefijo_con_fecha", listar)
    monkeypatch.setattr(db, "usuario_actual", lambda: "ana")
    d = cliente.get("/api/imagenes").json()
    assert [i["nombre"] for i in d["imagenes"]] == ["bbbbbbbbbbbb.jpg", "aaaaaaaaaaaa.jpg"]
    monkeypatch.setattr(db, "usuario_actual", lambda: "beto")
    assert cliente.get("/api/imagenes").json()["imagenes"] == []
    # la barra final: «ana» no puede leer la carpeta de «ana2»
    assert pedidos == ["imagenes/ana/", "imagenes/beto/"]


def test_la_lista_tiene_tope_pero_dice_cuantas_hay(cliente, srv, nube, monkeypatch):
    from server import app as srv_app
    monkeypatch.setattr(srv_app, "MAX_IMAGENES", 2)
    monkeypatch.setattr(db, "usuario_actual", lambda: "ana")
    monkeypatch.setattr(media_sync, "listar_prefijo_con_fecha", lambda p: [
        (f"{p}{c * 12}.jpg", float(i)) for i, c in enumerate("abcde")])
    d = cliente.get("/api/imagenes").json()
    assert d["total"] == 5
    assert [i["nombre"] for i in d["imagenes"]] == ["eeeeeeeeeeee.jpg", "dddddddddddd.jpg"]


def test_listar_con_fecha_lee_la_fecha_de_s3(monkeypatch):
    from datetime import datetime, timezone

    class Pag:
        def paginate(self, Bucket, Prefix):
            assert (Bucket, Prefix) == ("cubo", "imagenes/ana/")
            return [{"Contents": [{"Key": "imagenes/ana/aaaaaaaaaaaa.jpg", "Size": 3,
                                   "LastModified": datetime(2026, 9, 16, tzinfo=timezone.utc)}]},
                    {}]

    class S3:
        def get_paginator(self, nombre):
            assert nombre == "list_objects_v2"
            return Pag()
    monkeypatch.setenv("MEDIA_BUCKET", "cubo")
    monkeypatch.setattr(media_sync, "_s3", lambda: S3())
    assert media_sync.listar_prefijo_con_fecha("imagenes/ana/") == [
        ("imagenes/ana/aaaaaaaaaaaa.jpg", datetime(2026, 9, 16, tzinfo=timezone.utc).timestamp())]
    monkeypatch.delenv("MEDIA_BUCKET")
    assert media_sync.listar_prefijo_con_fecha("imagenes/ana/") == []


@pytest.mark.parametrize("vieja,nueva", [
    ("/crear-imagenes.html", "/imagenes.html"),
    ("/editor-imagenes.html", "/imagenes.html?editar=1"),
])
def test_las_paginas_viejas_llevan_a_la_nueva(cliente, vieja, nueva):
    """Quien las tenga guardadas llega a la herramienta única; el editor, ya
    en modo editar. 302: un 301 se queda para siempre en el navegador."""
    r = cliente.get(vieja, follow_redirects=False)
    assert r.status_code == 302
    assert r.headers["location"] == nueva
    assert not (RAIZ / "static" / vieja.lstrip("/")).exists()


@pytest.fixture(scope="module")
def hub():
    return (RAIZ / "static" / "index.html").read_text(encoding="utf-8")


def test_mis_imagenes_va_entre_proyectos_y_ediciones(hub):
    assert hub.index("<h2>Mis proyectos</h2>") < hub.index("<h2>Mis imágenes</h2>") \
        < hub.index("<h2>Mis ediciones</h2>")


def test_cada_imagen_se_abre_para_seguir_editandola(hub):
    js = _js(hub)
    pinta = _bloque(js, "function renderImagenes()")
    assert "/imagenes.html?img=${encodeURIComponent(im.nombre)}" in pinta
    assert "src=\"${esc(im.url)}\"" in pinta and 'loading="lazy"' in pinta
    assert '<a class="proy vacio" href="/imagenes.html">＋ Nueva imagen</a>' in pinta
    # una imagen que no carga no deja un ícono roto
    assert "im.onerror" in pinta
    # la lista no rompe el inicio si falla
    carga = _bloque(js, "async function cargar()")
    assert "fetch('/api/imagenes').catch(() => null)" in carga
    assert "if (ri && ri.ok)" in carga


def test_se_ven_las_mas_nuevas_y_el_resto_con_ver_todas(hub):
    js = _js(hub)
    assert "const IMG_A_LA_VISTA = 5;" in js
    pinta = _bloque(js, "function renderImagenes()")
    assert "todasVisibles ? imagenes : imagenes.slice(0, IMG_A_LA_VISTA)" in pinta
    assert "b.hidden = imagenes.length <= IMG_A_LA_VISTA;" in pinta
    assert "setAttribute('aria-expanded', String(todasVisibles))" in pinta


def test_el_js_del_inicio_es_valido(hub, tmp_path):
    import shutil
    import subprocess
    node = shutil.which("node")
    if not node:
        pytest.skip("node no está instalado")
    f = tmp_path / "hub.js"
    f.write_text(_js(hub), encoding="utf-8")
    r = subprocess.run([node, "--check", str(f)], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
