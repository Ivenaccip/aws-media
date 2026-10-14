"""«Crear una imagen» desde la caja del inicio sale SIN estilo (dueño, 14-oct-2026).

La caja mandaba siempre `estilo: 'animated'` y el servidor le pegaba al texto «3D animated
film style, Pixar-like…»: una herencia de la pantalla de Imágenes (R4b, 7-oct) que nadie
decidió para la caja. Ahora manda `estilo: 'ninguno'` y a fal le llega lo que escribió la
persona, nada más (y las reglas de siempre: sin texto ni marca de agua).

Lo que se defiende aquí:

  * `ninguno` es un estilo SIN prompt que `resolver_estilo` acepta, pero que NO está en
    `ESTILOS`: si entrara, saldría en `/api/estilos` y, con él, en los selectores de
    Imágenes y de Crear y como estilo de una película;
  * el prompt a fal es EXACTAMENTE `«<texto>. No text, no watermark.»` (sin el hueco «. .»),
    no contiene «Pixar» ni «animated», y `estilo_custom` se ignora;
  * todo lo que NO cambia: sin campo `estilo` el servidor sigue usando `animated` (clientes
    viejos, la pantalla de Imágenes y la de Crear), un id desconocido cae a `animated`,
    `custom` (también el vacío, con su hueco de siempre: Imágenes no cambia) y los cinco
    estilos arman el mismo prompt byte por byte, y el precio, el modelo y la cola son los
    mismos;
  * las películas no aceptan `ninguno` (422 antes de crear nada);
  * la palabra que manda la caja (web/src/pantallas/inicio/envio.ts) es la que el servidor
    conoce: si una se renombra sin la otra, el servidor la trataría como desconocida y la
    caja volvería, en silencio, al «Animado».

Sin red ni dinero: fal, el monedero y la cola son dobles.

OJO: nada de importar pipeline/server a nivel de módulo (ver test_m25_clip)."""
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

REGLAS = "No text, no watermark."
CINCO = ("cinematic", "animated", "monochrome", "experimental", "artistic")
MARCAS_DEL_ANIMADO = ("pixar", "animated")


@pytest.fixture
def cliente(monkeypatch, tmp_path):
    """El API en local (todo síncrono, sin SQS ni S3) y las imágenes en una carpeta temporal."""
    from server import app as app_mod
    monkeypatch.setenv("JOBS_BACKEND", "local")
    monkeypatch.setattr(app_mod, "_dir_imagenes", lambda: tmp_path / "_imagenes")
    return TestClient(app_mod.app)


@pytest.fixture
def fal(monkeypatch):
    """`media_fal.imagen_fal` anotado: el prompt exacto que saldría hacia fal y lo demás por nombre."""
    from pipeline import media_fal
    f = SimpleNamespace(llamadas=[])

    async def imagen_fal(prompt, destino, **kw):
        f.llamadas.append(SimpleNamespace(prompt=prompt, kw=kw))
        Path(destino).write_bytes(b"jpg-de-fal")
        return "https://fal.test/x.jpg"

    monkeypatch.setattr(media_fal, "imagen_fal", imagen_fal)
    return f


@pytest.fixture
def monedero(monkeypatch):
    """El monedero anotado: lo que se cobró y lo que se devolvió."""
    from pipeline import creditos
    m = SimpleNamespace(cobros=[], devueltos=[])
    monkeypatch.setattr(creditos, "activo", lambda: True)
    monkeypatch.setattr(creditos, "cobrar", lambda n, ref, u=None: m.cobros.append((n, ref)))
    monkeypatch.setattr(creditos, "devolver", lambda n, ref, u=None: m.devueltos.append((n, ref)))
    return m


def _pedir(cliente, **kw):
    cuerpo = {"prompt": "un gato en la luna"}
    cuerpo.update(kw)
    return cliente.post("/api/imagenes", json=cuerpo)


def _prompt_a_fal(fal) -> str:
    (llamada,) = fal.llamadas
    return llamada.prompt


# ---------------------------------------------------------------------------
# el estilo «ninguno»

def test_resolver_estilo_acepta_ninguno_y_devuelve_un_estilo_sin_prompt():
    from pipeline.styles import NINGUNO, Estilo, resolver_estilo
    e = resolver_estilo("ninguno")
    assert NINGUNO == "ninguno"
    assert isinstance(e, Estilo) and e.id == "ninguno"
    assert e.prompt == ""
    # el negativo es el base (el mismo que el de «custom»): sin ningún look impuesto
    assert e.negativo == resolver_estilo("custom", "x").negativo
    assert not any(m in e.negativo.lower() for m in MARCAS_DEL_ANIMADO)


@pytest.mark.parametrize("custom", [None, "", "acuarela suave", "3D animated film style, Pixar-like"])
def test_ninguno_ignora_el_texto_custom_en_el_resolver(custom):
    from pipeline.styles import resolver_estilo
    assert resolver_estilo("ninguno", custom).prompt == ""


def test_ninguno_no_esta_en_ESTILOS_y_un_id_desconocido_sigue_siendo_error():
    """`ESTILOS` alimenta /api/estilos, los selectores de Imágenes y de Crear y el estilo de las películas."""
    from pipeline.styles import ESTILOS, resolver_estilo
    assert tuple(ESTILOS) == CINCO
    assert "ninguno" not in ESTILOS
    for malo in ("Ninguno", " ninguno", "NINGUNO", "none", ""):
        with pytest.raises(ValueError, match="Estilo desconocido"):
            resolver_estilo(malo)


def test_api_estilos_no_lista_ninguno(cliente):
    r = cliente.get("/api/estilos")
    assert r.status_code == 200
    ids = [e["id"] for e in r.json()]
    assert ids == [*CINCO, "custom"]
    assert "ninguno" not in ids
    assert "Sin estilo" not in {e["nombre"] for e in r.json()}


# ---------------------------------------------------------------------------
# POST /api/imagenes — el prompt que sale hacia fal

def test_con_ninguno_a_fal_le_llega_exactamente_el_texto_y_las_reglas(cliente, fal):
    r = _pedir(cliente, estilo="ninguno", estilo_custom="")
    assert r.status_code == 200, r.text
    assert _prompt_a_fal(fal) == f"un gato en la luna. {REGLAS}"
    assert _prompt_a_fal(fal) == "un gato en la luna. No text, no watermark."
    bajo = _prompt_a_fal(fal).lower()
    assert not any(m in bajo for m in MARCAS_DEL_ANIMADO)
    assert ". ." not in _prompt_a_fal(fal)


def test_con_ninguno_el_texto_se_recorta_como_siempre(cliente, fal):
    r = _pedir(cliente, estilo="ninguno", prompt="  " + "a" * 2500 + "  ")
    assert r.status_code == 200, r.text
    assert _prompt_a_fal(fal) == "a" * 2000 + f". {REGLAS}"


@pytest.mark.parametrize("texto, esperado", [
    ("perro", "perro. No text, no watermark."),                                    # una palabra
    ("un perro.", "un perro.. No text, no watermark."),                            # punto final: como con cualquier estilo
    ("  un perro \n\n", "un perro. No text, no watermark."),                       # espacios y saltos de los bordes
    ("línea uno\nlínea dos", "línea uno\nlínea dos. No text, no watermark."),      # el salto de en medio se respeta
    ("a" * 2000, "a" * 2000 + ". No text, no watermark."),                         # justo el tope
    ("a" * 2001, "a" * 2000 + ". No text, no watermark."),                         # un carácter de más
    ("ñandú «raro» 🙂 ¿sí?", "ñandú «raro» 🙂 ¿sí?. No text, no watermark."),      # unicode intacto
])
def test_con_ninguno_el_texto_de_la_persona_sale_tal_cual_y_sin_hueco(cliente, fal, texto, esperado):
    r = _pedir(cliente, estilo="ninguno", prompt=texto)
    assert r.status_code == 200, r.text
    assert _prompt_a_fal(fal) == esperado
    assert ". ." not in _prompt_a_fal(fal)


def test_con_ninguno_el_estilo_custom_se_ignora(cliente, fal):
    r = _pedir(cliente, estilo="ninguno", estilo_custom="acuarela suave, 3D animated film style, Pixar-like")
    assert r.status_code == 200, r.text
    assert _prompt_a_fal(fal) == f"un gato en la luna. {REGLAS}"
    assert "acuarela" not in _prompt_a_fal(fal)


def test_con_ninguno_se_responde_lo_de_siempre(cliente, fal):
    r = _pedir(cliente, estilo="ninguno")
    assert r.status_code == 200, r.text
    cuerpo = r.json()
    assert set(cuerpo) == {"nombre", "url"} and cuerpo["url"] == f"/api/imagenes/{cuerpo['nombre']}"


# ---------------------------------------------------------------------------
# lo que NO cambia

def test_sin_campo_estilo_el_servidor_sigue_usando_animated(cliente, fal):
    """Un cliente viejo (y la pantalla de Imágenes o la de Crear si no mandan estilo) no manda `estilo`."""
    from pipeline.styles import resolver_estilo
    from server.app import PedidoImagen
    assert PedidoImagen(prompt="x").estilo == "animated"
    r = cliente.post("/api/imagenes", json={"prompt": "un gato en la luna"})
    assert r.status_code == 200, r.text
    animado = resolver_estilo("animated").prompt
    assert "Pixar" in animado
    assert _prompt_a_fal(fal) == f"un gato en la luna. {animado}. {REGLAS}"


@pytest.mark.parametrize("desconocido", ["no-existe", "Ninguno", " ninguno", "NINGUNO", "none", "", "custom2"])
def test_un_estilo_desconocido_sigue_cayendo_a_animated(cliente, fal, desconocido):
    from pipeline.styles import resolver_estilo
    r = _pedir(cliente, estilo=desconocido, estilo_custom="acuarela suave")
    assert r.status_code == 200, r.text
    assert _prompt_a_fal(fal) == f"un gato en la luna. {resolver_estilo('animated').prompt}. {REGLAS}"


@pytest.mark.parametrize("estilo", CINCO)
def test_los_cinco_estilos_de_siempre_arman_el_mismo_prompt(cliente, fal, estilo):
    from pipeline.styles import resolver_estilo
    r = _pedir(cliente, estilo=estilo, estilo_custom="se ignora")
    assert r.status_code == 200, r.text
    assert _prompt_a_fal(fal) == f"un gato en la luna. {resolver_estilo(estilo).prompt}. {REGLAS}"


def test_custom_sigue_igual_con_su_texto(cliente, fal):
    r = _pedir(cliente, estilo="custom", estilo_custom="  acuarela suave  ")
    assert r.status_code == 200, r.text
    assert _prompt_a_fal(fal) == f"un gato en la luna. acuarela suave. {REGLAS}"


def test_custom_vacio_queda_exactamente_como_siempre_y_no_cae_a_animated(cliente, fal):
    """«Personalizado» sin descripción se puede mandar desde Imágenes y esa pantalla NO cambia: su
    prompt sale igual que antes de «ninguno», con su hueco «. .» incluido (feo, pero es lo de
    siempre; arreglarlo es otra decisión, no la de la caja). Lo que importa: no cae a animated."""
    r = _pedir(cliente, estilo="custom", estilo_custom="")
    assert r.status_code == 200, r.text
    assert _prompt_a_fal(fal) == f"un gato en la luna. . {REGLAS}"
    assert "pixar" not in _prompt_a_fal(fal).lower()


@pytest.mark.parametrize("estilo", ["ninguno", "animated", "custom", "no-existe"])
def test_los_422_de_siempre_siguen_pasando_antes_de_cobrar(cliente, fal, monedero, estilo):
    for cuerpo, motivo in [(dict(prompt="   "), "Escribe qué imagen quieres"),
                           (dict(formato="panoramico"), "formato desconocido"),
                           (dict(modelo="no-existe"), "Ese modelo no está disponible")]:
        r = _pedir(cliente, estilo=estilo, **cuerpo)
        assert r.status_code == 422 and motivo in r.text, (estilo, cuerpo)
    assert monedero.cobros == [] and fal.llamadas == []


def test_el_formato_y_el_modelo_viajan_igual_con_ninguno(cliente, fal):
    r = _pedir(cliente, estilo="ninguno", formato="vertical", modelo="klein")
    assert r.status_code == 200, r.text
    (llamada,) = fal.llamadas
    assert llamada.kw["aspecto"] == "9:16" and llamada.kw["modelo"] == "klein"
    assert llamada.kw["meta"] == {"imagen_estudio": r.json()["nombre"]}


@pytest.mark.parametrize("modelo", ["", "grok", "klein", "nb2"])
def test_ninguno_cobra_lo_mismo_que_cualquier_otro_estilo(cliente, fal, monedero, modelo):
    from pipeline import creditos
    esperado = creditos.costo_imagen() if not modelo else creditos.costo_modelo("imagen", modelo)
    for estilo in ("ninguno", "animated"):
        monedero.cobros.clear()
        r = _pedir(cliente, estilo=estilo, modelo=modelo)
        assert r.status_code == 200, r.text
        assert monedero.cobros == [(esperado, "imagen:estudio")], estilo
        assert monedero.devueltos == []


def test_si_fal_falla_con_ninguno_se_devuelve_lo_cobrado(cliente, monkeypatch, monedero):
    from pipeline import media_fal

    async def revienta(*a, **kw):
        raise RuntimeError("fal caído")

    monkeypatch.setattr(media_fal, "imagen_fal", revienta)
    r = _pedir(cliente, estilo="ninguno")
    assert r.status_code == 502
    assert len(monedero.cobros) == 1 and len(monedero.devueltos) == 1
    assert monedero.devueltos[0][0] == monedero.cobros[0][0]


# ---------------------------------------------------------------------------
# la caja y el servidor hablan de lo mismo

def test_la_palabra_que_manda_la_caja_es_la_que_el_servidor_conoce():
    """Si `envio.ts` dijera otra cosa («sin_estilo», «none»…), el servidor la vería como un id
    desconocido y la mandaría a `animated`: el Pixar volvería y ninguna otra prueba lo notaría
    (las de vitest solo miran lo que la caja manda; estas, lo que el servidor entiende)."""
    import re
    from pipeline.styles import NINGUNO
    raiz = Path(__file__).resolve().parent.parent
    envio = (raiz / "web" / "src" / "pantallas" / "inicio" / "envio.ts").read_text(encoding="utf-8")
    cuerpo = re.search(r"export const pedirImagen\b.*?\n\s*\}\);", envio, re.S)
    assert cuerpo, "no encontré pedirImagen en envio.ts"
    assert re.findall(r"estilo:\s*'([^']*)'", cuerpo.group(0)) == [NINGUNO]


def test_ninguna_otra_peticion_de_la_caja_manda_un_estilo_fijo():
    """La caja no tiene selector de estilo: ningún `estilo: '…'` distinto de «ninguno» (el «animated»
    de antes, por ejemplo) puede volver a escribirse en su código (los tests quedan fuera)."""
    import re
    carpeta = Path(__file__).resolve().parent.parent / "web" / "src" / "pantallas" / "inicio"
    fuentes = [f for f in carpeta.rglob("*") if f.suffix in {".ts", ".tsx"} and ".test." not in f.name]
    assert fuentes
    for f in fuentes:
        texto = f.read_text(encoding="utf-8")
        assert not re.search(r"""estilo\s*:\s*['"](?!ninguno['"])""", texto), f.name


# ---------------------------------------------------------------------------
# los modelos lentos (la cola)

@pytest.fixture
def cola(monkeypatch):
    """Todo modelo cuenta como lento y `imagen_cola.lanzar` anota lo que recibe (sin S3 ni SQS)."""
    from server import imagen_cola
    c = SimpleNamespace(llamadas=[])
    monkeypatch.setattr(imagen_cola, "en_segundo_plano", lambda modelo: True)

    def lanzar(user, texto, prompt, aspecto, modelo, costo):
        c.llamadas.append(SimpleNamespace(user=user, texto=texto, prompt=prompt, aspecto=aspecto,
                                          modelo=modelo, costo=costo))
        return {"lanzado": True, "id": "img-20261014-120000-abcdef", "creditos": costo}

    monkeypatch.setattr(imagen_cola, "lanzar", lanzar)
    return c


def test_un_modelo_lento_con_ninguno_recibe_el_mismo_prompt_que_fal(cliente, fal, cola):
    r = _pedir(cliente, estilo="ninguno", estilo_custom="se ignora", modelo="flux3", formato="horizontal")
    assert r.status_code == 200, r.text
    assert r.json() == {"lanzado": True, "id": "img-20261014-120000-abcdef", "creditos": cola.llamadas[0].costo}
    (ll,) = cola.llamadas
    # `texto` es lo que escribió la persona y `prompt` el que va a fal: con ninguno solo cambian las reglas
    assert ll.texto == "un gato en la luna"
    assert ll.prompt == f"un gato en la luna. {REGLAS}"
    assert (ll.modelo, ll.aspecto) == ("flux3", "16:9")
    assert fal.llamadas == []       # nada se generó dentro de la petición


def test_un_modelo_lento_con_animated_sigue_llevando_el_estilo(cliente, fal, cola):
    from pipeline.styles import resolver_estilo
    r = _pedir(cliente, estilo="animated", modelo="flux3")
    assert r.status_code == 200, r.text
    (ll,) = cola.llamadas
    assert ll.texto == "un gato en la luna"
    assert ll.prompt == f"un gato en la luna. {resolver_estilo('animated').prompt}. {REGLAS}"


# ---------------------------------------------------------------------------
# las películas (Crear)

def test_una_pelicula_no_acepta_ninguno_como_estilo(cliente, monkeypatch):
    """Antes de crear nada ni gastar en nada: 422. Un estilo de la lista sigue llegando al creador."""
    from server import app as app_mod
    creados = []

    def nuevo(brief, estilo, *a, **kw):
        creados.append(estilo)
        raise RuntimeError("llegó al creador")

    monkeypatch.setattr(app_mod, "nuevo_proyecto", nuevo)
    sin_errores = TestClient(app_mod.app, raise_server_exceptions=False)

    r = sin_errores.post("/api/proyectos", data={"brief": "un pato valiente", "estilo": "ninguno"})
    assert r.status_code == 422, r.text
    assert "estilos de la lista" in r.text
    assert creados == []

    # el control: con un estilo de la lista la petición SÍ llega a crear el proyecto (aquí revienta a propósito)
    r = sin_errores.post("/api/proyectos", data={"brief": "un pato valiente", "estilo": "animated"})
    assert r.status_code == 500 and creados == ["animated"]


def test_el_flujo_de_las_peliculas_sigue_resolviendo_solo_los_estilos_de_la_lista():
    """`flow.py` resuelve `p.estilo` con `resolver_estilo`: los cinco y `custom` siguen siendo lo que ofrece Crear."""
    from pipeline.styles import ESTILOS, resolver_estilo
    for id_ in ESTILOS:
        assert resolver_estilo(id_).prompt
    assert resolver_estilo("custom", "acuarela").prompt == "acuarela"
