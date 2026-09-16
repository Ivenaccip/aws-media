"""M23 — una sola herramienta de imágenes: crear y editar en la misma pantalla.

Crear y editar eran dos páginas con el mismo monedero, el mismo guardrail y el
mismo orbe; la diferencia real es si hay una imagen sobre la mesa. La página
nueva (static/imagenes.html) convive con las dos viejas hasta validarla, y
por debajo usa los MISMOS dos endpoints, con tres añadidos:

- **formato** al crear (horizontal, vertical o cuadrado): los prompts solos no
  alcanzaban para pedir una imagen apaisada o de teléfono;
- **estilo** al transformar la imagen entera, como destino («pásala a
  Animado») y solo si el usuario lo elige; en el pincel no, porque la zona
  nueva tiene que pegar con el resto;
- **los bytes** de una imagen propia desde nuestro origen, para «seguir
  editando»: la URL del CDN no manda CORS y ensucia el canvas.

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
    monkeypatch.setattr(media_fal, "imagen_nano", fake)
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
    """Las dos páginas viejas no mandan formato: su imagen no cambia de golpe."""
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


def test_nano_solo_manda_aspecto_si_se_lo_piden(monkeypatch, tmp_path):
    """M1 (personaje) y el b-roll del editor también llaman a imagen_nano y no
    eligen formato: para ellos fal sigue decidiendo, como hasta hoy."""
    vistos = _espiar_fal(monkeypatch)
    asyncio.run(media_fal.imagen_nano("un faro", tmp_path / "a.jpg"))
    assert "aspect_ratio" not in vistos["args"]
    asyncio.run(media_fal.imagen_nano("un faro", tmp_path / "b.jpg", aspecto="9:16"))
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


@pytest.mark.parametrize("nombre", ["abc.png", "a-b.jpg", "..jpg", "abc.jpg.exe"])
def test_un_nombre_raro_no_llega_a_s3(cliente, srv, nube, monkeypatch, nombre):
    monkeypatch.setattr(media_sync, "bajar_archivo",
                        lambda k, d: pytest.fail(f"{nombre!r} llegó a S3"))
    assert cliente.get(f"/api/imagenes/{nombre}/archivo").status_code == 404


def test_la_pagina_se_sirve(cliente):
    r = cliente.get("/imagenes.html")
    assert r.status_code == 200 and 'id="enviar"' in r.text


# ---------------------------------------------------------------------------
# la página

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
    carga = _bloque(js, "function cargarImagen(f)")
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
    fijar = _bloque(js, "function fijarEstilo(id)")
    assert "if (transformando()) estiloDestino" in fijar


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
    for f in ("function quitarAdjunto()", "function empezarDeNuevo()", "function fijarModo(m)",
              "function cargarImagen(f)", "function usarAtajo(i)"):
        assert "enVuelo" in _bloque(js, f).split("\n", 3)[1] + _bloque(js, f).split("\n", 3)[2], f


def test_una_carga_a_medias_no_se_cuela_bajo_la_peticion(html, envio):
    carga = _bloque(_js(html), "function cargarImagen(f)")
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
    seguir = _bloque(js, "$('#seguir').onclick")
    assert "fetch(`/api/imagenes/${nombre}/archivo`)" in seguir
    assert "d.url" not in seguir
    assert "`/api/imagenes/${d.nombre}/archivo`" in js   # la descarga, igual


def test_seguir_editando_no_pinta_una_version_vieja(html):
    seguir = _bloque(_js(html), "$('#seguir').onclick")
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


def test_todo_cabe_en_una_pantalla_y_hay_salida_si_no(html):
    assert "overflow:hidden" in html[html.index("body {"):html.index("h1 {")]
    # pantalla baja pero ancha (Windows al 125-150 %): sigue a dos columnas
    baja = html[html.index("@media (max-height: 520px) and (min-width: 901px)"):]
    assert "body { overflow:auto; }" in baja[:200]
    assert "grid-template-columns:1fr" not in baja[:200]
    movil = html[html.index("@media (max-width: 900px)"):]
    assert "body { overflow:auto; }" in movil
    assert "grid-template-columns:1fr" in movil
    assert "height:min(55dvh, 100dvh - 290px)" in movil


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
