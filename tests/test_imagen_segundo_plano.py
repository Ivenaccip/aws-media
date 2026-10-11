"""Imágenes en segundo plano — el patrón del clip aplicado a `POST /api/imagenes`.

`/api/imagenes` generaba DENTRO de la petición y la Lambda del API corta a los 29 s (API
Gateway: tope fijo de 30 s; un arranque en frío gasta unos 16). Cuatro modelos tardaron
más de 10 s en la prueba pagada (FLUX 3 hasta 25.0 s, Seedream 4.5 hasta 22.7 s, Seedream
5.0 Flash 15.0 s, Nano Banana 2 13.9 s) y, cortada la petición, se cobraba, no se devolvía y
fal cobraba igual. Esos pasan por la cola: cobrar → doc en S3 → `jobs.encolar_imagen` →
`worker/imagen_generar.py` → la pantalla sondea `GET /api/imagenes/pedidos/{id}`.

Lo que este archivo defiende:

  * la TABLA: qué modelos van a segundo plano y por qué (los segundos medidos están fijados
    aquí) — la regla es «segundo_plano si y solo si algún tiempo medido pasó de 10 s»;
  * el contrato HTTP: validar todo antes de cobrar (422), el tope de 3 en marcha (409), el
    orden cobrar → doc → encolar, la devolución si no se pudo lanzar (502), y la respuesta de
    siempre para los rápidos y para el backend local;
  * `pendientes` en `GET /api/imagenes` y `GET /api/imagenes/pedidos/{id}`: la ficha sin el
    prompt completo, el recorte por fecha ANTES de leer, que jamás se vea lo de otro, que se
    lean ANTES que las imágenes y que un S3 caído no tumbe la lista de imágenes;
  * el worker: nunca relanza la generación, devuelve EXACTAMENTE lo cobrado (leído del doc),
    devuelve ANTES de escribir el doc `error` (que guarda `devuelto`) y, si la devolución
    falla, levanta para que SQS reentregue y la reentrega repite SOLO la devolución; la
    imagen ya subida nunca se devuelve aunque el doc `listo` no se pueda escribir; y no paga
    ni devuelve dos veces cuando SQS entrega el mismo mensaje a la vez (el reclamo en S3);
  * el despachador de la Lambda del worker y que el API y el worker hablen del mismo doc;
  * «Tus trabajos» (/api/trabajos) también enseña las imágenes en segundo plano.

Sin red: fal, S3, SQS y el monedero mockeados.

OJO: nada de importar pipeline/server a nivel de módulo (ver test_m25_clip)."""
import importlib.util
import json
import logging
import os
import re
import sys
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

RAIZ = Path(__file__).resolve().parent.parent
USER = "ana"

LENTOS = ("nb2", "sdf", "sd45", "flux3")
RAPIDOS = ("grok", "klein", "zit", "flux2")
# Los segundos MEDIDOS por llamada en las pruebas pagadas (docs/modelos-ia/POR-VERIFICAR.md,
# DATOS-FAL-2026-10-08.md §9 y §11): (menor, mayor). Nano Banana 2 son tres llamadas (crear 11.7 s;
# editar 11.5 y 13.9 s). Grok NO está: no hay medición registrada en el repo y no tiene regla (es el
# predeterminado, rápido y conocido; la decisión del dueño es que siga síncrono).
TIEMPOS_MEDIDOS = {
    "nb2": (11.5, 13.9),
    "sdf": (13.4, 15.0),
    "sd45": (8.6, 22.7),
    "flux3": (21.8, 25.0),
    "flux2": (7.2, 8.1),
    "klein": (0.8, 1.2),
    "zit": (1.0, 1.8),
}

ID_RE = re.compile(r"^img-[0-9]{8}-[0-9]{6}-[0-9a-f]{6}$")
NOMBRE_RE = re.compile(r"^[0-9a-f]{12}\.jpg$")
MENSAJE_ERROR = "La imagen no se pudo generar. Se te devolvieron los créditos."


def _muro_s() -> float:
    """Lo que la petición puede esperar a fal: el MISMO número con el que tools/probar_modelo.py
    marca REVISAR a un modelo síncrono, no una copia que se pueda desfasar."""
    spec = importlib.util.spec_from_file_location("probar_modelo", RAIZ / "tools" / "probar_modelo.py")
    modulo = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modulo)
    return modulo.LIMITE_PETICION_S


# ---------------------------------------------------------------------------
# la tabla

def test_la_tabla_de_tiempos_medidos_decide_quien_va_a_segundo_plano():
    """segundo_plano <=> algún tiempo medido > 10 s. Mover un modelo es cambiar un booleano, pero
    ese booleano tiene que seguir a la medición: un modelo nuevo sin medir obliga a medirlo aquí."""
    from pipeline import modelos_ia
    imagen = modelos_ia.disponibles("imagen")
    assert set(imagen) == set(TIEMPOS_MEDIDOS) | {"grok"}, "modelo nuevo de imagen: anota sus segundos"
    for id_, (_, mayor) in TIEMPOS_MEDIDOS.items():
        assert modelos_ia.resolver("imagen", id_).segundo_plano is (mayor > _muro_s()), id_
    # Grok: sin medición en el repo, sin regla; sigue síncrono por decisión del dueño
    assert "grok" not in TIEMPOS_MEDIDOS
    assert modelos_ia.resolver("imagen", "grok").segundo_plano is False


def test_exactamente_estos_cuatro_van_a_segundo_plano_al_crear():
    from pipeline import modelos_ia
    lentos = {i for i in modelos_ia.disponibles("imagen")
              if modelos_ia.resolver("imagen", i).segundo_plano}
    assert lentos == set(LENTOS)
    assert not set(RAPIDOS) & lentos


def test_editar_y_clip_no_se_tocan():
    """Solo se encola CREAR una imagen: editar sigue síncrono y los clips ya tenían su cola."""
    from pipeline import modelos_ia
    for tarea in ("editar", "clip"):
        for id_ in modelos_ia.disponibles(tarea):
            assert modelos_ia.resolver(tarea, id_).segundo_plano is False, (tarea, id_)


def test_por_omision_un_modelo_es_sincrono():
    from pipeline import modelos_ia
    assert modelos_ia.Modelo("x", "imagen", "ep").segundo_plano is False
    assert modelos_ia.Modelo("x", "imagen", "ep", segundo_plano=True).segundo_plano is True


@pytest.mark.parametrize("malo", ["si", 1, 0, None, "True", [True]])
def test_segundo_plano_solo_acepta_un_booleano(malo):
    """Como los demás campos de la fila: un `1` o un «si» no se acepta en silencio."""
    from pipeline import modelos_ia
    with pytest.raises(ValueError, match="segundo_plano"):
        modelos_ia.Modelo("x", "imagen", "ep", segundo_plano=malo)


def test_la_documentacion_trae_los_segundos_de_cada_modelo():
    """La tabla de arriba y la de docs/modelos-ia/POR-VERIFICAR.md dicen lo mismo: segundos medidos
    y si va en segundo plano."""
    doc = (RAIZ / "docs" / "modelos-ia" / "POR-VERIFICAR.md").read_text(encoding="utf-8")
    seccion = doc[doc.index("### Qué va en segundo plano y por qué"):]
    filas = {}
    for linea in seccion.splitlines():
        celdas = [c.strip() for c in linea.strip().strip("|").split("|")]
        m = re.search(r"\(`([a-z0-9]+)`\)", celdas[0]) if len(celdas) == 3 else None
        if m:
            filas[m.group(1)] = celdas
    assert set(filas) == set(TIEMPOS_MEDIDOS) | {"grok"}
    for id_, (menor, mayor) in TIEMPOS_MEDIDOS.items():
        _, segundos, va = filas[id_]
        assert segundos.startswith(f"{menor} a {mayor}"), id_
        assert va.lower().startswith("sí" if mayor > _muro_s() else "no"), id_
    assert "sin medición" in filas["grok"][1] and filas["grok"][2].lower().startswith("no")


# ---------------------------------------------------------------------------
# fixtures

class _S3(dict):
    """Los docs de S3 en memoria ({key: texto}) y lo que se hizo con ellos."""

    def __init__(self):
        super().__init__()
        self.lecturas: list[str] = []
        self.prefijos: list[str] = []
        self.escrituras: list[str] = []
        self.subidas: dict[str, bytes] = {}
        self.escritura_rota = False
        self.lectura_rota = False
        self.listado_roto = False
        self.etags: dict[str, str] = {}          # la etiqueta de cada objeto, para las escrituras condicionales
        self.condicionales: list[tuple[str, str | None, bool]] = []   # (key, etag pedido, ¿ganó?)
        self.candado = threading.Lock()
        self._n = 0

    def poner(self, key: str, texto: str) -> str:
        """Escribe y devuelve la etiqueta nueva (cada escritura, condicional o no, cambia la etiqueta)."""
        self._n += 1
        self[key] = texto
        self.etags[key] = f'"e{self._n}"'
        return self.etags[key]


@pytest.fixture
def s3(monkeypatch):
    from pipeline import media_sync
    docs = _S3()

    def leer(key):
        if docs.lectura_rota:
            raise OSError("S3 caído")
        docs.lecturas.append(key)
        return docs.get(key)

    def escribir(key, texto, tipo="application/json"):
        if docs.escritura_rota:
            raise OSError("S3 caído")
        with docs.candado:
            docs.escrituras.append(key)
            docs.poner(key, texto)

    def leer_con_etag(key):
        with docs.candado:
            return docs.get(key), docs.etags.get(key)

    def escribir_si(key, texto, etag=None, tipo="application/json"):
        """Como el de S3: sin etiqueta solo si no existe (If-None-Match), con ella solo si nadie lo cambió."""
        with docs.candado:
            ok = (key not in docs) if etag is None else docs.etags.get(key) == etag
            docs.condicionales.append((key, etag, ok))
            return docs.poner(key, texto) if ok else None

    def listar(prefijo):
        if docs.listado_roto:
            raise OSError("S3 caído al listar")
        docs.prefijos.append(prefijo)
        return sorted(k for k in docs if k.startswith(prefijo))

    monkeypatch.setattr(media_sync, "leer_texto", leer)
    monkeypatch.setattr(media_sync, "leer_texto_con_etag", leer_con_etag)
    monkeypatch.setattr(media_sync, "escribir_texto", escribir)
    monkeypatch.setattr(media_sync, "escribir_texto_si", escribir_si)
    monkeypatch.setattr(media_sync, "listar_prefijo", listar)
    monkeypatch.setattr(media_sync, "subir_archivo",
                        lambda local, key: docs.subidas.__setitem__(key, Path(local).read_bytes()))
    monkeypatch.setattr(media_sync, "listar_prefijo_con_fecha",
                        lambda p: [(k, 1_700_000_000.0) for k in docs.subidas if k.startswith(p)])
    return docs


@pytest.fixture
def nube(monkeypatch):
    """El servicio: JOBS_BACKEND=aws y el usuario del token es «ana»."""
    from pipeline import db
    monkeypatch.setenv("JOBS_BACKEND", "aws")
    monkeypatch.delenv("COGNITO_POOL_ID", raising=False)
    monkeypatch.setattr(db, "usuario_actual", lambda: USER)


@pytest.fixture
def cliente(monkeypatch, tmp_path):
    from server import app as app_mod
    monkeypatch.setattr(app_mod, "_dir_imagenes", lambda: tmp_path / "_imagenes")
    return TestClient(app_mod.app)


@pytest.fixture
def monedero(monkeypatch):
    """El monedero anotado, con el orden de lo que costó dinero."""
    from pipeline import creditos
    m = SimpleNamespace(eventos=[], cobros=[], devueltos=[], con_saldo=True)

    def cobrar(n, ref, u=None):
        if not m.con_saldo:
            raise creditos.SinSaldo(n, 0)
        m.eventos.append("cobrar")
        m.cobros.append((n, ref, u))

    monkeypatch.setattr(creditos, "activo", lambda: True)
    monkeypatch.setattr(creditos, "cobrar", cobrar)
    monkeypatch.setattr(creditos, "devolver", lambda n, ref, u=None: m.devueltos.append((n, ref, u)))
    return m


@pytest.fixture
def cola(monkeypatch, s3, monedero):
    """`jobs.encolar_imagen` anotado. Registra también si el doc YA estaba escrito y el monedero
    ya había cobrado al encolar: ese es el orden que se defiende."""
    from pipeline import jobs
    c = SimpleNamespace(llamadas=[], error=None, docs_al_encolar=[], eventos_al_encolar=[])

    def encolar(user_id, imagen_id):
        c.eventos_al_encolar.append(list(monedero.eventos))
        c.docs_al_encolar.append(s3.get(f"usuarios/{user_id}/imagenes-pedidos/{imagen_id}.json"))
        if c.error:
            raise c.error
        monedero.eventos.append("encolar")
        c.llamadas.append((user_id, imagen_id))

    monkeypatch.setattr(jobs, "encolar_imagen", encolar)
    return c


@pytest.fixture
def fal_imagen(monkeypatch):
    """`media_fal.imagen_fal` anotado: la llamada exacta y, si se pide, un error. `secuencia` da
    un resultado por llamada (None = sale bien, una excepción = falla) antes de caer en `error`."""
    from pipeline import media_fal
    f = SimpleNamespace(llamadas=[], error=None, secuencia=[], contenido=b"jpg-de-fal")

    async def imagen_fal(*args, **kw):
        f.llamadas.append(SimpleNamespace(args=args, kw=kw))
        error = f.secuencia.pop(0) if f.secuencia else f.error
        if error:
            raise error
        Path(args[1]).write_bytes(f.contenido)
        return "https://fal.test/x.jpg"

    monkeypatch.setattr(media_fal, "imagen_fal", imagen_fal)
    return f


# El reloj de los ids se congela al importar el archivo: `_id(30)` da siempre el mismo texto aunque
# pase un segundo entre dos llamadas. Siguen siendo de hoy (o de ayer, si la corrida cruza la medianoche).
_T0 = datetime.now(timezone.utc)


def _id(segundos_atras: int = 0, ahora: datetime | None = None) -> str:
    """Un id de pedido de hace `segundos_atras` segundos (único por segundo + sufijo)."""
    t = (ahora or _T0) - timedelta(seconds=segundos_atras)
    return f"img-{t:%Y%m%d-%H%M%S}-{segundos_atras % 0xFFFFFF:06x}"


def _iso(segundos_atras: float) -> str:
    return (datetime.now(timezone.utc) - timedelta(seconds=segundos_atras)).isoformat(timespec="seconds")


def _doc(estado="generando", edad_s=60, **kw) -> dict:
    d = {"estado": estado, "inicio": _iso(edad_s), "creditos": 4, "modelo": "flux3",
         "texto": "un gato astronauta", "prompt": "un gato astronauta. Estilo X. No text, no watermark.",
         "aspecto": "1:1", "nombre": "0123456789ab.jpg", "listo": None, "error": ""}
    d.update(kw)
    return d


def _poner(s3, imagen_id, doc, user=USER):
    s3[f"usuarios/{user}/imagenes-pedidos/{imagen_id}.json"] = json.dumps(doc)


def _pedir(cliente, modelo="flux3", **kw):
    cuerpo = {"prompt": "un gato astronauta", "estilo": "animated", "formato": "horizontal"}
    if modelo is not None:
        cuerpo["modelo"] = modelo
    cuerpo.update(kw)
    return cliente.post("/api/imagenes", json=cuerpo)


def _costo(id_: str) -> int:
    from pipeline import creditos
    return creditos.costo_modelo("imagen", id_)


# ---------------------------------------------------------------------------
# POST /api/imagenes — el camino de segundo plano

@pytest.mark.parametrize("formato,aspecto", [("horizontal", "16:9"), ("vertical", "9:16"),
                                             ("cuadrado", "1:1"), ("", "1:1")])
@pytest.mark.parametrize("modelo", LENTOS)
def test_un_modelo_lento_en_la_nube_cobra_escribe_el_doc_y_encola_en_ese_orden(
        cliente, nube, s3, monedero, cola, fal_imagen, modelo, formato, aspecto):
    from pipeline.styles import resolver_estilo
    r = _pedir(cliente, modelo, formato=formato)
    assert r.status_code == 200, r.text
    cuerpo = r.json()
    assert set(cuerpo) == {"lanzado", "id", "creditos"} and cuerpo["lanzado"] is True
    assert ID_RE.match(cuerpo["id"]) and cuerpo["creditos"] == _costo(modelo)
    imagen_id = cuerpo["id"]

    # cobró UNA vez, con el id del pedido y a nombre del usuario, antes de encolar
    assert monedero.cobros == [(_costo(modelo), f"imagen:{imagen_id}", USER)]
    assert monedero.eventos == ["cobrar", "encolar"] and cola.llamadas == [(USER, imagen_id)]
    # y el doc YA estaba escrito cuando se encoló (el worker lo lee al arrancar)
    assert cola.docs_al_encolar[0] is not None
    # lo que quedó en S3: un solo doc, bajo el usuario, con el pedido completo
    assert list(s3) == [f"usuarios/{USER}/imagenes-pedidos/{imagen_id}.json"]
    doc = json.loads(s3[f"usuarios/{USER}/imagenes-pedidos/{imagen_id}.json"])
    assert set(doc) == {"estado", "inicio", "creditos", "modelo", "texto", "prompt", "aspecto",
                        "nombre", "listo", "error"}
    assert (doc["estado"], doc["modelo"], doc["creditos"], doc["aspecto"]) == (
        "generando", modelo, _costo(modelo), aspecto)
    assert doc["texto"] == "un gato astronauta"
    assert doc["prompt"] == (f"un gato astronauta. {resolver_estilo('animated').prompt}. "
                             "No text, no watermark.")
    assert NOMBRE_RE.match(doc["nombre"]) and doc["listo"] is None and doc["error"] == ""
    assert datetime.fromisoformat(doc["inicio"]).tzinfo is not None
    # nada se generó dentro de la petición
    assert fal_imagen.llamadas == []


def test_el_texto_es_lo_que_escribio_el_usuario_recortado_y_el_prompt_lleva_el_estilo(
        cliente, nube, s3, monedero, cola):
    r = _pedir(cliente, "flux3", prompt="  " + "a" * 2500 + "  ", estilo="custom",
               estilo_custom="acuarela suave")
    assert r.status_code == 200, r.text
    (clave,) = s3
    doc = json.loads(s3[clave])
    assert doc["texto"] == "a" * 2000
    assert doc["prompt"] == "a" * 2000 + ". acuarela suave. No text, no watermark."


@pytest.mark.parametrize("modelo", LENTOS)
def test_sin_saldo_da_402_sin_doc_ni_cola(cliente, nube, s3, monedero, cola, modelo):
    monedero.con_saldo = False
    r = _pedir(cliente, modelo)
    assert r.status_code == 402, r.text
    assert "Créditos insuficientes" in r.json()["detail"]
    assert list(s3) == [] and s3.escrituras == []
    assert cola.llamadas == [] and monedero.devueltos == []


@pytest.mark.parametrize("con_tope", [False, True])
@pytest.mark.parametrize("cuerpo,motivo", [
    (dict(prompt="   "), "Escribe qué imagen quieres"),
    (dict(formato="panoramico"), "formato desconocido"),
    (dict(modelo="no-existe"), "Ese modelo no está disponible"),
    (dict(modelo="gpt2"), "Ese modelo no está disponible"),
])
def test_lo_invalido_da_422_antes_de_cobrar_ni_del_tope_ni_de_nada(
        cliente, nube, s3, monedero, cola, con_tope, cuerpo, motivo):
    """Se valida TODO igual que siempre ANTES del tope de 3: con tres en marcha un pedido mal
    hecho sigue siendo 422 y no 409."""
    if con_tope:
        for i in range(3):
            _poner(s3, _id(10 + i), _doc())
    antes = dict(s3)
    r = _pedir(cliente, **{"modelo": "flux3", **cuerpo})
    assert r.status_code == 422, r.text
    assert motivo in r.json()["detail"]
    assert monedero.cobros == [] and cola.llamadas == [] and dict(s3) == antes


def test_un_modelo_sin_numero_en_tarifas_da_422_sin_cobrar_ni_crear_doc(
        cliente, nube, s3, monedero, cola, monkeypatch):
    from pipeline import creditos
    monkeypatch.delitem(creditos.MODELOS_CR["imagen"], "flux3")
    r = _pedir(cliente, "flux3")
    assert r.status_code == 422 and "flux3" in r.json()["detail"]
    assert monedero.cobros == [] and cola.llamadas == [] and list(s3) == []


def test_al_tope_de_tres_en_marcha_da_409_sin_cobrar(cliente, nube, s3, monedero, cola):
    for i in range(3):
        _poner(s3, _id(30 + i), _doc(edad_s=30 + i))
    antes = dict(s3)
    r = _pedir(cliente, "sd45")
    assert r.status_code == 409, r.text
    assert r.json()["detail"] == "Ya tienes 3 imágenes generándose — espera a que terminen."
    assert monedero.cobros == [] and cola.llamadas == [] and dict(s3) == antes


def test_con_dos_en_marcha_la_tercera_pasa(cliente, nube, s3, monedero, cola):
    for i in range(2):
        _poner(s3, _id(30 + i), _doc(edad_s=30 + i))
    assert _pedir(cliente, "sd45").status_code == 200
    assert len(cola.llamadas) == 1


@pytest.mark.parametrize("otro", [
    _doc(edad_s=31 * 60),                                          # generando, pero caducó (más de 30 min)
    _doc("listo", edad_s=120, listo=_iso(60)),
    _doc("error", edad_s=90, listo=_iso(60), error="x"),
    _doc(inicio="ayer"),                                           # fecha que no se lee: cuenta como caducado
], ids=["caducado", "listo", "error", "sin-fecha"])
def test_lo_que_no_esta_generando_o_ya_caduco_no_cuenta_para_el_tope(cliente, nube, s3, monedero, cola, otro):
    """Dos en marcha y un tercero que NO cuenta: si contara, este pedido sería el cuarto... y el tercero
    del tope. Pasa."""
    _poner(s3, _id(30), _doc(edad_s=30))
    _poner(s3, _id(40), _doc(edad_s=40))
    _poner(s3, _id(50), otro)
    r = _pedir(cliente, "flux3")
    assert r.status_code == 200, r.text


def test_un_pedido_ilegible_no_ocupa_un_lugar_ni_rompe_el_tope(cliente, nube, s3, monedero, cola):
    _poner(s3, _id(30), _doc(edad_s=30))
    _poner(s3, _id(40), _doc(edad_s=40))
    s3[f"usuarios/{USER}/imagenes-pedidos/{_id(50)}.json"] = "esto no es json"
    assert _pedir(cliente, "flux3").status_code == 200


def test_el_tope_es_por_usuario(cliente, nube, s3, monedero, cola):
    for i in range(3):
        _poner(s3, _id(30 + i), _doc(), user="otro")
        _poner(s3, _id(40 + i), _doc(), user="ana2")       # ni el que comparte el comienzo del nombre
    assert _pedir(cliente, "flux3").status_code == 200


def test_el_tope_no_toca_a_los_rapidos(cliente, nube, s3, monedero, cola, fal_imagen):
    for i in range(3):
        _poner(s3, _id(30 + i), _doc())
    assert _pedir(cliente, "grok").status_code == 200
    assert len(fal_imagen.llamadas) == 1 and cola.llamadas == []


NO_LANZADA = "No se pudo lanzar la imagen. Inténtalo otra vez; no se te cobró."


def test_si_falla_el_encolado_se_devuelve_lo_cobrado_el_doc_queda_en_error_y_es_502(
        cliente, nube, s3, monedero, cola, caplog):
    """El usuario ve un mensaje fijo en español —ni el doc ni el 502 llevan el texto de la excepción—
    y el detalle técnico queda en el log."""
    cola.error = RuntimeError("SQS caído: https://sqs.us-east-1.amazonaws.com/123/cola AccessDenied")
    with caplog.at_level(logging.ERROR, logger="imagen_cola"):
        r = _pedir(cliente, "sdf")
    assert r.status_code == 502, r.text
    assert r.json()["detail"] == NO_LANZADA
    (n, ref, u) = monedero.cobros[0]
    assert monedero.devueltos == [(n, ref, u)] == [(_costo("sdf"), ref, USER)]
    (clave,) = s3
    assert clave == f"usuarios/{USER}/imagenes-pedidos/{ref.removeprefix('imagen:')}.json"
    doc = json.loads(s3[clave])
    assert doc["estado"] == "error" and doc["error"] == NO_LANZADA
    assert datetime.fromisoformat(doc["listo"]).tzinfo is not None
    # ni por el doc, ni por la ficha, ni por el 502 sale la excepción cruda
    for visible in (r.text, s3[clave], json.dumps(cliente.get("/api/imagenes").json()["pendientes"])):
        assert "SQS" not in visible and "AccessDenied" not in visible and "amazonaws" not in visible
    # el detalle técnico sí quedó donde lo ve quien opera
    (registro,) = [x for x in caplog.records if x.name == "imagen_cola"]
    assert "SQS caído" in caplog.text and registro.exc_info is not None and ref.removeprefix("imagen:") in caplog.text


def test_un_lanzamiento_fallido_no_ocupa_un_lugar_y_se_enseña_como_error(cliente, nube, s3, monedero, cola):
    cola.error = RuntimeError("SQS caído")
    for _ in range(4):
        assert _pedir(cliente, "sdf").status_code == 502      # el cuarto no da 409
    assert [p["estado"] for p in cliente.get("/api/imagenes").json()["pendientes"]] == ["error"] * 4


def test_si_no_se_puede_escribir_el_doc_se_devuelve_y_no_se_encola(cliente, nube, s3, monedero, cola):
    """Cobrado y sin doc sería lo peor: el worker no tendría qué leer y nadie devolvería."""
    s3.escritura_rota = True
    r = _pedir(cliente, "flux3")
    assert r.status_code == 502, r.text
    assert monedero.devueltos == [(_costo("flux3"), monedero.cobros[0][1], USER)]
    assert cola.llamadas == []


@pytest.mark.parametrize("modelo", [*RAPIDOS, None])
def test_los_rapidos_siguen_sincronos_con_la_respuesta_de_siempre(
        cliente, nube, s3, monedero, cola, fal_imagen, modelo):
    r = _pedir(cliente, modelo, formato="vertical")
    assert r.status_code == 200, r.text
    cuerpo = r.json()
    assert set(cuerpo) == {"nombre", "url"} and NOMBRE_RE.match(cuerpo["nombre"])
    assert cuerpo["url"] == f"/api/imagenes/{cuerpo['nombre']}"
    # cobró como siempre (sin usuario, con la referencia de la caja) y generó dentro de la petición
    assert [(ref, u) for _, ref, u in monedero.cobros] == [("imagen:estudio", None)]
    (ll,) = fal_imagen.llamadas
    assert ll.kw["aspecto"] == "9:16" and ll.kw["modelo"] == (modelo or None)
    # sin cola y sin doc de pedido; la imagen sí quedó donde viven las de siempre
    assert cola.llamadas == [] and list(s3) == [] and s3.escrituras == []
    assert list(s3.subidas) == [f"imagenes/{USER}/{cuerpo['nombre']}"]


@pytest.mark.parametrize("modelo", LENTOS)
def test_en_local_todo_sigue_sincrono_tambien_los_lentos(
        cliente, s3, monedero, cola, fal_imagen, monkeypatch, modelo):
    monkeypatch.delenv("JOBS_BACKEND", raising=False)
    r = _pedir(cliente, modelo)
    assert r.status_code == 200, r.text
    assert set(r.json()) == {"nombre", "url"}
    assert [ref for _, ref, _ in monedero.cobros] == ["imagen:estudio"]
    assert len(fal_imagen.llamadas) == 1 and fal_imagen.llamadas[0].kw["modelo"] == modelo
    assert cola.llamadas == [] and list(s3) == [] and s3.subidas == {}


def test_editar_sigue_sincrono_aunque_el_modelo_sea_lento(
        cliente, nube, s3, monedero, cola, monkeypatch):
    """Solo CREAR se encola: `POST /api/imagenes/editar` con Nano Banana 2 queda como estaba."""
    from pipeline import media_fal
    llamadas = []

    async def transformar(prompt, imagen, destino, meta=None, modelo=None):
        llamadas.append(modelo)
        Path(destino).write_bytes(b"jpg-editada")
        return "https://fal.test/e.jpg"

    monkeypatch.setattr(media_fal, "imagen_transformar", transformar)
    r = cliente.post("/api/imagenes/editar", data={"prompt": "más sol", "modo": "todo", "modelo": "nb2"},
                     files={"imagen": ("a.png", b"\x89PNG-de-prueba", "image/png")})
    assert r.status_code == 200, r.text
    assert set(r.json()) == {"nombre", "url"} and llamadas == ["nb2"]
    assert cola.llamadas == [] and list(s3) == []


# ---------------------------------------------------------------------------
# GET /api/imagenes — `pendientes`

def _pendientes(cliente):
    r = cliente.get("/api/imagenes")
    assert r.status_code == 200, r.text
    assert "pendientes" in r.json()
    return r.json()["pendientes"]


def test_sin_pedidos_pendientes_es_una_lista_vacia_y_nunca_falta_la_llave(cliente, nube, s3):
    assert cliente.get("/api/imagenes").json() == {"total": 0, "imagenes": [], "pendientes": []}


def test_en_local_pendientes_es_vacia_y_no_se_consulta_s3(cliente, s3, monkeypatch):
    monkeypatch.delenv("JOBS_BACKEND", raising=False)
    _poner(s3, _id(30), _doc())                         # aunque hubiera un doc a la vista
    assert _pendientes(cliente) == []
    assert s3.prefijos == [] and s3.lecturas == []


def test_pendientes_enseña_lo_que_genera_y_los_errores_de_la_ultima_hora_del_mas_nuevo_al_mas_viejo(
        cliente, nube, s3):
    _poner(s3, _id(20 * 60), _doc("error", edad_s=20 * 60, listo=_iso(15 * 60), error="no pudo", nombre="e" * 12 + ".jpg"))
    _poner(s3, _id(90), _doc(edad_s=90, nombre="b" * 12 + ".jpg"))
    _poner(s3, _id(30), _doc(edad_s=30, nombre="a" * 12 + ".jpg", modelo="nb2", creditos=8))
    # lo que NO se enseña: listo (ya está en las imágenes), error de hace más de una hora,
    # generando que caducó hace más de una hora y lo del otro
    _poner(s3, _id(200), _doc("listo", edad_s=200, listo=_iso(150)))
    _poner(s3, _id(2 * 3600), _doc("error", edad_s=2 * 3600, listo=_iso(3600 + 60), error="viejo"))
    _poner(s3, _id(3 * 3600 + 5), _doc(edad_s=3 * 3600 + 5))
    _poner(s3, _id(10), _doc(), user="otro")
    _poner(s3, _id(11), _doc(), user="ana2")

    pendientes = _pendientes(cliente)

    assert [p["id"] for p in pendientes] == [_id(30), _id(90), _id(20 * 60)]
    assert [p["estado"] for p in pendientes] == ["generando", "generando", "error"]
    # la ficha, completa y sin el prompt de fal ni el resto de la plomería
    primera = pendientes[0]
    assert primera == {"id": _id(30), "estado": "generando", "inicio": primera["inicio"],
                       "texto": "un gato astronauta", "modelo": "nb2", "creditos": 8,
                       "nombre": "a" * 12 + ".jpg", "url": "", "error": ""}
    assert pendientes[2]["error"] == "no pudo" and pendientes[2]["url"] == ""
    for p in pendientes:
        assert "prompt" not in p and "aspecto" not in p and "listo" not in p


CADUCADO = "Esta imagen tardó demasiado y no llegó. Si no ves tus créditos de vuelta, escríbenos."


def test_un_generando_caducado_dentro_de_la_hora_se_enseña_como_error_sin_prometer_la_devolucion(
        cliente, nube, s3):
    """Más de 30 minutos sin respuesta: ya no es «Generando…», pero tampoco desaparece en silencio. No
    sabemos qué le pasó al worker, así que NO se afirma que se devolvieron los créditos."""
    _poner(s3, _id(40 * 60), _doc(edad_s=40 * 60, nombre="a" * 12 + ".jpg"))
    (p,) = _pendientes(cliente)
    assert (p["id"], p["estado"], p["error"], p["url"]) == (_id(40 * 60), "error", CADUCADO, "")
    assert "devolvieron" not in p["error"] and p["nombre"] == "a" * 12 + ".jpg"


@pytest.mark.parametrize("edad_s,se_ve", [(29 * 60, "generando"), (31 * 60, "error"), (59 * 60, "error"),
                                          (61 * 60, None), (5 * 3600, None)])
def test_el_generando_pasa_a_error_a_los_30_min_y_se_va_a_la_hora(cliente, nube, s3, edad_s, se_ve):
    _poner(s3, _id(edad_s), _doc(edad_s=edad_s))
    assert [p["estado"] for p in _pendientes(cliente)] == ([se_ve] if se_ve else [])


def test_un_generando_caducado_se_enseña_pero_sigue_sin_contar_para_el_tope(cliente, nube, s3, monedero, cola):
    for i in range(3):
        _poner(s3, _id(40 * 60 + i), _doc(edad_s=40 * 60 + i))
    assert [p["estado"] for p in _pendientes(cliente)] == ["error"] * 3
    assert _pedir(cliente, "flux3").status_code == 200          # tres «error» visibles, ninguno ocupa lugar


def test_un_generando_caducado_sin_fecha_legible_no_se_enseña(cliente, nube, s3):
    _poner(s3, _id(40 * 60), _doc(inicio="ayer"))
    assert _pendientes(cliente) == []


def test_un_error_sin_fecha_de_fin_se_mide_desde_su_inicio(cliente, nube, s3):
    """Un error escrito sin `listo` (doc viejo) no se queda para siempre: se cuenta desde el inicio."""
    _poner(s3, _id(2 * 3600), _doc("error", edad_s=2 * 3600, error="viejo"))
    _poner(s3, _id(5 * 60), _doc("error", edad_s=5 * 60, error="reciente"))
    assert [p["error"] for p in _pendientes(cliente)] == ["reciente"]


def test_pendientes_lee_solo_las_diez_mas_nuevas_y_no_el_historial(cliente, nube, s3):
    """La pantalla sondea cada pocos segundos: el recorte va ANTES de leer. El id empieza por la
    fecha, así que ordenar las keys por nombre ya es ordenarlas por tiempo."""
    from server import imagen_cola
    ids = [_id(i) for i in range(1, 15)]                        # 14 pedidos generando, del 1 al 14 s
    for i, imagen_id in enumerate(ids, start=1):
        _poner(s3, imagen_id, _doc(edad_s=i))
    pendientes = _pendientes(cliente)
    assert imagen_cola.MAX_PENDIENTES == 10
    assert [p["id"] for p in pendientes] == ids[:10]           # los 10 más nuevos, en orden
    assert sorted(s3.lecturas) == sorted(f"usuarios/{USER}/imagenes-pedidos/{i}.json" for i in ids[:10])


def test_el_recorte_se_hace_por_fecha_aunque_los_mas_viejos_sigan_generando(cliente, nube, s3):
    """Con diez pedidos nuevos ya terminados, uno viejo que sigue generando queda fuera de la lectura."""
    for i in range(1, 11):
        _poner(s3, _id(i), _doc("listo", edad_s=i, listo=_iso(0)))
    _poner(s3, _id(300), _doc(edad_s=300))
    assert _pendientes(cliente) == []
    assert not any(_id(300) in k for k in s3.lecturas)


def test_solo_se_listan_las_keys_de_hoy_y_de_ayer(cliente, nube, s3):
    ahora = datetime.now(timezone.utc)
    ayer = ahora - timedelta(days=1)
    antes = ahora - timedelta(days=3)
    _poner(s3, _id(ahora=ayer), _doc(edad_s=10 * 60))            # el pedido de las 23:55 visto a las 00:05
    _poner(s3, _id(5, ahora=antes), _doc(edad_s=5))              # de hace tres días: ni se lista
    pendientes = _pendientes(cliente)
    assert s3.prefijos == [f"usuarios/{USER}/imagenes-pedidos/img-{ahora:%Y%m%d}",
                           f"usuarios/{USER}/imagenes-pedidos/img-{ayer:%Y%m%d}"]
    assert [p["id"] for p in pendientes] == [_id(ahora=ayer)]


def test_pendientes_nunca_toca_los_pedidos_de_otro_usuario(cliente, nube, s3):
    _poner(s3, _id(30), _doc(), user="otro")
    _poner(s3, _id(31), _doc(), user="ana2")
    assert _pendientes(cliente) == []
    assert s3.lecturas == []
    assert all(p.startswith(f"usuarios/{USER}/imagenes-pedidos/") for p in s3.prefijos)


def test_cada_usuario_ve_solo_sus_pendientes(cliente, nube, s3, monkeypatch):
    """Con la sesión de «otro» no sale ni uno de los pedidos de «ana», y al revés."""
    from pipeline import db
    _poner(s3, _id(30), _doc(texto="de ana"))
    _poner(s3, _id(31), _doc(texto="de otro"), user="otro")
    assert [p["texto"] for p in _pendientes(cliente)] == ["de ana"]
    monkeypatch.setattr(db, "usuario_actual", lambda: "otro")
    s3.lecturas.clear()
    s3.prefijos.clear()
    assert [p["texto"] for p in _pendientes(cliente)] == ["de otro"]
    assert s3.lecturas and all(k.startswith("usuarios/otro/imagenes-pedidos/") for k in s3.lecturas)
    assert all(k.startswith("usuarios/otro/imagenes-pedidos/") for k in s3.prefijos)


def test_un_pedido_terminado_ya_no_es_pendiente_y_su_imagen_esta_en_la_lista(cliente, nube, s3):
    """El `listo` se enseña por donde se enseñan todas las imágenes: la lista de siempre."""
    s3.subidas[f"imagenes/{USER}/0123456789ab.jpg"] = b"jpg"
    _poner(s3, _id(30), _doc("listo", edad_s=30, listo=_iso(10)))
    d = cliente.get("/api/imagenes").json()
    assert d["pendientes"] == []
    assert [i["nombre"] for i in d["imagenes"]] == ["0123456789ab.jpg"] and d["total"] == 1


def test_pendientes_se_lee_antes_que_las_imagenes(cliente, nube, s3, monkeypatch):
    """Orden de las lecturas de `GET /api/imagenes`: primero los pedidos, después la galería."""
    from pipeline import media_sync
    eventos = []
    listar_pedidos = media_sync.listar_prefijo
    listar_galeria = media_sync.listar_prefijo_con_fecha
    monkeypatch.setattr(media_sync, "listar_prefijo", lambda p: eventos.append("pedidos") or listar_pedidos(p))
    monkeypatch.setattr(media_sync, "listar_prefijo_con_fecha",
                        lambda p: eventos.append("galeria") or listar_galeria(p))
    cliente.get("/api/imagenes")
    assert eventos[-1] == "galeria" and eventos.count("galeria") == 1
    assert "pedidos" in eventos[:-1]          # hoy y ayer, y solo después la galería


def test_una_imagen_que_termina_entre_las_dos_lecturas_no_desaparece_de_la_pantalla(
        cliente, nube, s3, monkeypatch):
    """El worker termina JUSTO después de la primera lectura. Con la galería leída antes, esa imagen no
    estaba aún en la galería y el pedido ya era `listo`: no salía en ninguna parte hasta el siguiente
    sondeo. Leyendo primero los pedidos puede salir repetida un instante, nunca faltar."""
    from pipeline import media_sync
    _poner(s3, _id(30), _doc(nombre="a" * 12 + ".jpg"))
    estado = {"terminado": False}

    def terminar():
        if not estado["terminado"]:
            estado["terminado"] = True
            s3.subidas[f"imagenes/{USER}/{'a' * 12}.jpg"] = b"jpg"
            _poner(s3, _id(30), _doc("listo", listo=_iso(0), nombre="a" * 12 + ".jpg"))

    leer, galeria = media_sync.leer_texto, media_sync.listar_prefijo_con_fecha

    def leer_y_terminar(key):
        v = leer(key)
        terminar()                    # termina justo después de leer el pedido
        return v

    def galeria_y_terminar(prefijo):
        v = galeria(prefijo)
        terminar()                    # termina justo después de listar la galería
        return v

    monkeypatch.setattr(media_sync, "leer_texto", leer_y_terminar)
    monkeypatch.setattr(media_sync, "listar_prefijo_con_fecha", galeria_y_terminar)
    d = cliente.get("/api/imagenes").json()
    visibles = [i["nombre"] for i in d["imagenes"]] + [p["nombre"] for p in d["pendientes"]]
    assert "a" * 12 + ".jpg" in visibles


def test_si_s3_falla_al_listar_los_pedidos_la_lista_de_imagenes_sigue_saliendo(
        cliente, nube, s3, caplog):
    """`pendientes` es de cortesía: un S3 que se cae en SU prefijo no tumba «Mis creaciones»."""
    s3.subidas[f"imagenes/{USER}/0123456789ab.jpg"] = b"jpg"
    s3.listado_roto = True                    # lo de los pedidos; la galería se lista por otra llamada
    with caplog.at_level(logging.WARNING, logger="imagen_cola"):
        r = cliente.get("/api/imagenes")
    assert r.status_code == 200, r.text
    assert [i["nombre"] for i in r.json()["imagenes"]] == ["0123456789ab.jpg"]
    assert r.json()["pendientes"] == [] and r.json()["total"] == 1
    avisos = [x for x in caplog.records if x.name == "imagen_cola"]
    assert [x.levelno for x in avisos] == [logging.WARNING] and avisos[0].exc_info is not None


def test_si_s3_falla_al_leer_todos_los_pedidos_la_lista_de_imagenes_sigue_saliendo(cliente, nube, s3):
    s3.subidas[f"imagenes/{USER}/0123456789ab.jpg"] = b"jpg"
    _poner(s3, _id(30), _doc())
    s3.lectura_rota = True
    r = cliente.get("/api/imagenes")
    assert r.status_code == 200 and r.json()["pendientes"] == []
    assert [i["nombre"] for i in r.json()["imagenes"]] == ["0123456789ab.jpg"]


def test_un_pedido_que_no_se_puede_leer_no_tumba_a_los_demas(cliente, nube, s3, monkeypatch, caplog):
    from pipeline import media_sync
    _poner(s3, _id(30), _doc(texto="el bueno"))
    _poner(s3, _id(31), _doc(texto="el que falla"))
    leer = media_sync.leer_texto

    def leer_a_medias(key):
        if _id(31) in key:
            raise OSError("S3 con un mal momento")
        return leer(key)

    monkeypatch.setattr(media_sync, "leer_texto", leer_a_medias)
    with caplog.at_level(logging.WARNING, logger="imagen_cola"):
        assert [p["texto"] for p in _pendientes(cliente)] == ["el bueno"]
    assert _id(31) in caplog.text


def test_el_tope_de_tres_cuenta_aunque_un_pedido_no_se_pueda_leer(cliente, nube, s3, monedero, cola, monkeypatch):
    """El tope sigue protegiendo con los que SÍ se leen; uno ilegible no lo cuenta ni lo rompe."""
    from pipeline import media_sync
    for i in range(3):
        _poner(s3, _id(30 + i), _doc(edad_s=30 + i))
    _poner(s3, _id(50), _doc(edad_s=50))
    leer = media_sync.leer_texto

    def leer_a_medias(key):
        if _id(50) in key:
            raise OSError("mal momento")
        return leer(key)

    monkeypatch.setattr(media_sync, "leer_texto", leer_a_medias)
    assert _pedir(cliente, "sd45").status_code == 409


# ---------------------------------------------------------------------------
# GET /api/imagenes/pedidos/{id}

def test_el_pedido_por_id_devuelve_su_ficha(cliente, nube, s3):
    _poner(s3, _id(30), _doc(modelo="sd45", creditos=4))
    r = cliente.get(f"/api/imagenes/pedidos/{_id(30)}")
    assert r.status_code == 200, r.text
    assert r.json() == {"id": _id(30), "estado": "generando", "inicio": r.json()["inicio"],
                        "texto": "un gato astronauta", "modelo": "sd45", "creditos": 4,
                        "nombre": "0123456789ab.jpg", "url": "", "error": ""}


def test_listo_trae_la_url_de_la_imagen_y_error_trae_su_mensaje(cliente, nube, s3):
    _poner(s3, _id(30), _doc("listo", listo=_iso(5)))
    _poner(s3, _id(31), _doc("error", listo=_iso(5), error=MENSAJE_ERROR))
    listo = cliente.get(f"/api/imagenes/pedidos/{_id(30)}").json()
    assert (listo["estado"], listo["url"], listo["error"]) == ("listo", "/api/imagenes/0123456789ab.jpg", "")
    fallo = cliente.get(f"/api/imagenes/pedidos/{_id(31)}").json()
    assert (fallo["estado"], fallo["url"], fallo["error"]) == ("error", "", MENSAJE_ERROR)
    assert "prompt" not in listo and "prompt" not in fallo


def test_un_pedido_que_no_existe_da_404(cliente, nube, s3):
    r = cliente.get(f"/api/imagenes/pedidos/{_id(30)}")
    assert r.status_code == 404 and r.json()["detail"] == "no encontrado"


@pytest.mark.parametrize("malo", [
    "xyz", "pedidos", "img-1", "img-20261011-120000-abcde", "img-20261011-120000-abcdefg",
    "img-20261011-120000-ABCDEF", "IMG-20261011-120000-abcdef", "img-2026101-120000-abcdef",
    "img-20261011-120000-abcdef.json", "img-20261011-120000-abcdef%0A",
])
def test_un_id_mal_formado_da_404_sin_mirar_s3(cliente, nube, s3, malo):
    """Solo la forma del id lo rechaza: aquí cada uno tiene su doc a la vista."""
    for nombre in ("xyz", "pedidos", "img-1", "img-20261011-120000-abcde", "img-20261011-120000-abcdefg",
                   "img-20261011-120000-ABCDEF", "IMG-20261011-120000-abcdef", "img-2026101-120000-abcdef",
                   "img-20261011-120000-abcdef.json", "img-20261011-120000-abcdef\n"):
        s3[f"usuarios/{USER}/imagenes-pedidos/{nombre}.json"] = json.dumps(_doc())
    r = cliente.get(f"/api/imagenes/pedidos/{malo}")
    assert (r.status_code, r.json()["detail"]) == (404, "no encontrado")      # lo dice NUESTRO manejador
    assert s3.lecturas == []


def test_un_id_con_barras_codificadas_no_llega_ni_al_manejador(cliente, nube, s3, monkeypatch):
    """`..%2Fotro%2F…` lo para el enrutador (otra ruta, otro texto) antes de nuestro código: ni se lee
    S3 ni se entra a `ver`. Es el cinturón de afuera; el regex de `ver` es el de adentro."""
    from server import imagen_cola
    visto = []
    monkeypatch.setattr(imagen_cola, "_leer", lambda key: visto.append(key))
    s3[f"usuarios/otro/imagenes-pedidos/{_id(30)}.json"] = json.dumps(_doc())
    r = cliente.get(f"/api/imagenes/pedidos/..%2Fotro%2F{_id(30)}")
    assert r.status_code == 404 and r.json()["detail"] != "no encontrado"
    assert visto == [] and s3.lecturas == []


def test_el_pedido_de_otro_usuario_da_404_y_cada_quien_ve_el_suyo(cliente, nube, s3, monkeypatch):
    from pipeline import db
    _poner(s3, _id(30), _doc(texto="de otro"), user="otro")
    assert cliente.get(f"/api/imagenes/pedidos/{_id(30)}").status_code == 404
    monkeypatch.setattr(db, "usuario_actual", lambda: "otro")
    assert cliente.get(f"/api/imagenes/pedidos/{_id(30)}").json()["texto"] == "de otro"


def test_el_mismo_id_en_dos_cuentas_no_se_mezcla(cliente, nube, s3, monkeypatch):
    from pipeline import db
    _poner(s3, _id(30), _doc(texto="mío"))
    _poner(s3, _id(30), _doc(texto="de otro"), user="otro")
    assert cliente.get(f"/api/imagenes/pedidos/{_id(30)}").json()["texto"] == "mío"
    monkeypatch.setattr(db, "usuario_actual", lambda: "otro")
    assert cliente.get(f"/api/imagenes/pedidos/{_id(30)}").json()["texto"] == "de otro"


@pytest.mark.parametrize("contenido", ["esto no es json", "[]", "null", ""])
def test_un_doc_ilegible_da_404(cliente, nube, s3, contenido):
    s3[f"usuarios/{USER}/imagenes-pedidos/{_id(30)}.json"] = contenido
    assert cliente.get(f"/api/imagenes/pedidos/{_id(30)}").status_code == 404


def test_en_local_el_pedido_por_id_da_404(cliente, s3, monkeypatch):
    monkeypatch.delenv("JOBS_BACKEND", raising=False)
    _poner(s3, _id(30), _doc())
    assert cliente.get(f"/api/imagenes/pedidos/{_id(30)}").status_code == 404
    assert s3.lecturas == []


def test_las_rutas_de_siempre_siguen_donde_estaban(cliente, nube, s3, monkeypatch):
    from pipeline import media_sync
    monkeypatch.setattr(media_sync, "url_media", lambda key, expira=3600: f"https://cdn.test/{key}")
    r = cliente.get("/api/imagenes/0123456789ab.jpg", follow_redirects=False)
    assert r.status_code == 307 and r.headers["location"] == f"https://cdn.test/imagenes/{USER}/0123456789ab.jpg"
    # `pedidos/archivo` lo contesta la ruta NUEVA (su id no es un id), no la vieja `/{nombre}/archivo`
    # —que diría «Imagen no encontrada»—: las dos dan 404 y solo el texto dice quién respondió
    r = cliente.get("/api/imagenes/pedidos/archivo")
    assert (r.status_code, r.json()["detail"]) == (404, "no encontrado")


# ---------------------------------------------------------------------------
# jobs.encolar_imagen

def test_encolar_imagen_manda_solo_los_ids_a_la_cola_de_siempre(monkeypatch):
    from pipeline import jobs
    enviado = {}

    class SQS:
        def send_message(self, QueueUrl, MessageBody):
            enviado.update(url=QueueUrl, body=json.loads(MessageBody))

    monkeypatch.setenv("JOBS_QUEUE_URL", "https://sqs/cola")
    monkeypatch.setattr(jobs, "_sqs", lambda: SQS())
    jobs.encolar_imagen("ana", "img-20261011-120000-abcdef")
    assert enviado == {"url": "https://sqs/cola",
                       "body": {"tipo": "imagen", "user_id": "ana", "imagen_id": "img-20261011-120000-abcdef"}}


# ---------------------------------------------------------------------------
# media_sync: la escritura condicional del reclamo (las mismas de pipeline/publicaciones.py)

class _S3Condicional:
    """Lo justo de boto3 para probar los dos helpers: objetos con ETag y los errores de precondición."""

    def __init__(self):
        from botocore.exceptions import ClientError
        self.ClientError = ClientError
        self.exceptions = SimpleNamespace(
            ClientError=ClientError,
            NoSuchKey=type("NoSuchKey", (ClientError,), {}))
        self.objetos: dict[str, tuple[bytes, str]] = {}
        self.puts: list[dict] = []
        self.codigo: str | None = None          # un error de S3 que se fuerza en el siguiente put

    def get_object(self, Bucket, Key):
        import io
        if Key not in self.objetos:
            raise self.exceptions.NoSuchKey({"Error": {"Code": "NoSuchKey"}}, "GetObject")
        cuerpo, etag = self.objetos[Key]
        return {"Body": io.BytesIO(cuerpo), "ETag": etag}

    def put_object(self, Bucket, Key, Body, ContentType=None, IfMatch=None, IfNoneMatch=None):
        self.puts.append({"Key": Key, "IfMatch": IfMatch, "IfNoneMatch": IfNoneMatch})
        actual = self.objetos.get(Key)
        codigo = self.codigo or (
            "PreconditionFailed" if (IfNoneMatch == "*" and actual) or (
                IfMatch is not None and (actual is None or actual[1] != IfMatch)) else None)
        if codigo:
            raise self.ClientError({"Error": {"Code": codigo}}, "PutObject")
        etag = f'"e{len(self.puts)}"'
        self.objetos[Key] = (Body, etag)
        return {"ETag": etag}


@pytest.fixture
def s3_condicional(monkeypatch):
    from pipeline import media_sync
    falso = _S3Condicional()
    monkeypatch.setattr(media_sync, "_s3", lambda: falso)
    monkeypatch.setattr(media_sync, "_bucket", lambda: "bucket")
    return falso


def test_escribir_texto_si_sin_etiqueta_solo_crea_y_con_etiqueta_solo_reemplaza_lo_que_no_cambio(s3_condicional):
    from pipeline import media_sync
    primero = media_sync.escribir_texto_si("k", "uno")
    assert primero and s3_condicional.puts[-1] == {"Key": "k", "IfMatch": None, "IfNoneMatch": "*"}
    assert media_sync.escribir_texto_si("k", "otro") is None            # ya existe: pierde
    assert media_sync.escribir_texto_si("k", "tarde", etag='"vieja"') is None
    segundo = media_sync.escribir_texto_si("k", "dos", etag=primero)
    assert segundo and segundo != primero and s3_condicional.puts[-1]["IfMatch"] == primero
    assert media_sync.leer_texto_con_etag("k") == ("dos", segundo)


def test_escribir_texto_si_solo_traga_los_dos_errores_de_precondicion(s3_condicional):
    from botocore.exceptions import ClientError
    from pipeline import media_sync
    s3_condicional.codigo = "ConditionalRequestConflict"       # dos escrituras condicionales a la vez
    assert media_sync.escribir_texto_si("k", "x") is None
    s3_condicional.codigo = "AccessDenied"                     # esto NO es perder una carrera
    with pytest.raises(ClientError):
        media_sync.escribir_texto_si("k", "x")


def test_leer_texto_con_etag_de_lo_que_no_existe_o_sin_bucket(s3_condicional, monkeypatch):
    from pipeline import media_sync
    assert media_sync.leer_texto_con_etag("no-existe") == (None, None)
    monkeypatch.setattr(media_sync, "_bucket", lambda: None)
    assert media_sync.leer_texto_con_etag("k") == (None, None)


# ---------------------------------------------------------------------------
# el worker: devolver lo cobrado, NO regenerar y no hacer nada dos veces

IMAGEN_ID = "img-20261011-120000-abcdef"
CLAVE_DOC = f"usuarios/u1/imagenes-pedidos/{IMAGEN_ID}.json"
RECLAMO = f"usuarios/u1/imagenes-pedidos/{IMAGEN_ID}.reclamo"
SIN_DEVOLVER = ("La imagen no se pudo generar y no pudimos devolverte los créditos automáticamente; "
                "ya quedó avisado.")


@pytest.fixture
def worker(monkeypatch, s3, fal_imagen):
    from pipeline import costes_infra, creditos
    import worker.imagen_generar as w
    # generar() asigna os.environ["DEFAULT_USER_ID"] directo (el worker corre solo en su Lambda).
    # Registrarla aquí es lo que hace que monkeypatch la restaure al terminar (ver test_m25_clip).
    monkeypatch.setenv("DEFAULT_USER_ID", "otro-usuario")
    monkeypatch.setattr(w, "PAUSA_ESCRITURA_S", 0)
    e = SimpleNamespace(w=w, devueltos=[], infra=[], doc_al_devolver=[], devolver_roto=None)

    def devolver(n, ref, u=None):
        # lo que decía el doc en el instante de devolver: la devolución va ANTES del doc `error`
        e.doc_al_devolver.append(json.loads(s3[CLAVE_DOC])["estado"] if CLAVE_DOC in s3 else None)
        if e.devolver_roto:
            raise e.devolver_roto
        e.devueltos.append((n, ref, u))

    monkeypatch.setattr(creditos, "activo", lambda: True)
    monkeypatch.setattr(creditos, "devolver", devolver)
    monkeypatch.setattr(costes_infra, "registrar", lambda *a, **k: e.infra.append(a))
    return e


def _doc_worker(**kw) -> dict:
    base = dict(creditos=7, modelo="flux3", aspecto="16:9", nombre="abcdef012345.jpg",
                prompt="un faro. Estilo X. No text, no watermark.")
    return _doc(**{**base, **kw})


def _reclamo(segundos_atras: float) -> str:
    return json.dumps({"reclamado": _iso(segundos_atras)})


def _estados_escritos(s3) -> list[str]:
    """El estado de cada doc que se escribió, en orden (el reclamo no es un doc)."""
    return [e for e in s3.escrituras if e.endswith(".json")]


def test_una_imagen_buena_se_genera_se_sube_y_deja_el_doc_listo(worker, s3, fal_imagen):
    s3[CLAVE_DOC] = json.dumps(_doc_worker())
    original = fal_imagen.contenido

    worker.w.generar("u1", IMAGEN_ID)                       # no levanta

    (ll,) = fal_imagen.llamadas
    destino = Path(ll.args[1])
    # los argumentos EXACTOS: el prompt completo del doc, un destino temporal y lo demás por nombre
    assert ll.args[0] == "un faro. Estilo X. No text, no watermark." and len(ll.args) == 2
    assert ll.kw == {"meta": {"imagen_estudio": "abcdef012345.jpg"}, "aspecto": "16:9", "modelo": "flux3"}
    assert destino.name == "abcdef012345.jpg" and not destino.parent.exists()      # y se borró al terminar
    from server import app as app_mod
    assert Path(app_mod._dir_imagenes()) not in destino.parents                     # NO el compartido
    # subió a donde viven las de siempre, con lo que descargó fal
    assert s3.subidas == {"imagenes/u1/abcdef012345.jpg": original}
    doc = json.loads(s3[CLAVE_DOC])
    assert doc["estado"] == "listo" and doc["error"] == "" and "devuelto" not in doc
    assert datetime.fromisoformat(doc["listo"]).tzinfo is not None
    assert (doc["texto"], doc["modelo"], doc["creditos"], doc["nombre"]) == (
        "un gato astronauta", "flux3", 7, "abcdef012345.jpg")
    assert worker.devueltos == []
    assert os.environ["DEFAULT_USER_ID"] == "u1"
    # el pedido se reclamó (con la hora) antes de generar
    assert datetime.fromisoformat(json.loads(s3[RECLAMO])["reclamado"]).tzinfo is not None
    # y la línea de infra de la Lambda, con el concepto que corresponde
    (infra,) = worker.infra
    assert infra[:3] == ("u1", IMAGEN_ID, "infra-imagen")


def test_una_imagen_que_falla_devuelve_exactamente_lo_del_doc_y_no_relanza(worker, s3, fal_imagen):
    """Siete créditos en el doc: ni la tarifa de hoy del modelo ni otro número. Y sin relanzar, un
    reintento de la cola pagaría una segunda imagen en fal que nadie pidió."""
    from pipeline import creditos
    assert creditos.costo_modelo("imagen", "flux3") != 7
    s3[CLAVE_DOC] = json.dumps(_doc_worker())
    fal_imagen.error = RuntimeError("fal 500: traza con detalles internos")

    worker.w.generar("u1", IMAGEN_ID)                       # no levanta: SQS borra el mensaje

    assert worker.devueltos == [(7, f"imagen:{IMAGEN_ID}", "u1")]
    doc = json.loads(s3[CLAVE_DOC])
    assert doc["estado"] == "error" and doc["error"] == MENSAJE_ERROR and doc["devuelto"] is True
    assert "fal 500" not in doc["error"] and "traza" not in doc["error"]
    assert datetime.fromisoformat(doc["listo"]).tzinfo is not None
    assert s3.subidas == {}
    assert len(fal_imagen.llamadas) == 1                    # UNA sola llamada a fal
    assert len(worker.infra) == 1                           # el costo de la Lambda se anota igual


def test_se_devuelve_antes_de_escribir_el_doc_error(worker, s3, fal_imagen):
    """Si la pantalla ve `error` y refresca el saldo, el abono ya tiene que estar hecho; y el mensaje
    «se te devolvieron» solo puede escribirse DESPUÉS de que la devolución salió bien."""
    s3[CLAVE_DOC] = json.dumps(_doc_worker())
    fal_imagen.error = RuntimeError("boom")
    worker.w.generar("u1", IMAGEN_ID)
    assert worker.doc_al_devolver == ["generando"]          # al devolver, el doc aún no decía `error`
    assert json.loads(s3[CLAVE_DOC])["estado"] == "error"


def test_si_la_subida_falla_tambien_se_devuelve(worker, s3, monkeypatch):
    from pipeline import media_sync

    def sube_mal(local, key):
        raise OSError("S3 rechazó la subida")

    monkeypatch.setattr(media_sync, "subir_archivo", sube_mal)
    s3[CLAVE_DOC] = json.dumps(_doc_worker())
    worker.w.generar("u1", IMAGEN_ID)
    assert worker.devueltos == [(7, f"imagen:{IMAGEN_ID}", "u1")]
    doc = json.loads(s3[CLAVE_DOC])
    assert doc["estado"] == "error" and doc["devuelto"] is True


def _escribir_listo_roto(monkeypatch, s3, fallos: int) -> list[str]:
    """Hace fallar las primeras `fallos` escrituras del doc `listo`; devuelve el estado de cada intento."""
    from pipeline import media_sync
    original = media_sync.escribir_texto
    intentos = []

    def escribe(key, texto, tipo="application/json"):
        intentos.append(json.loads(texto)["estado"])
        if intentos[-1] == "listo" and intentos.count("listo") <= fallos:
            raise OSError("S3 caído")
        return original(key, texto, tipo)

    monkeypatch.setattr(media_sync, "escribir_texto", escribe)
    return intentos


def test_si_el_doc_listo_no_se_puede_escribir_la_imagen_ya_es_del_usuario_y_no_se_devuelve(
        worker, s3, monkeypatch, caplog):
    """Estaba mal: la imagen ya está subida a SU galería («Mis creaciones» la lista), así que
    devolverle los créditos o marcar `error` sería regalarle la imagen y decirle que falló. Se
    reintenta la escritura y, si sigue fallando, queda en el log."""
    s3[CLAVE_DOC] = json.dumps(_doc_worker())
    intentos = _escribir_listo_roto(monkeypatch, s3, fallos=99)
    with caplog.at_level(logging.ERROR, logger="imagen_generar"):
        worker.w.generar("u1", IMAGEN_ID)                   # no levanta: SQS borra el mensaje
    assert intentos == ["listo"] * 3                        # tres intentos, ninguno como `error`
    assert worker.devueltos == [] and worker.doc_al_devolver == []
    assert json.loads(s3[CLAVE_DOC])["estado"] == "generando"      # el doc no cambió
    assert list(s3.subidas) == ["imagenes/u1/abcdef012345.jpg"]    # y la imagen está en la galería
    mensajes = [r.getMessage() for r in caplog.records if r.levelno >= logging.ERROR]
    assert any("quedó en la galería" in m and IMAGEN_ID in m for m in mensajes)
    assert len(worker.infra) == 1


def test_la_escritura_del_doc_listo_se_reintenta_y_basta_con_que_una_salga(worker, s3, monkeypatch):
    s3[CLAVE_DOC] = json.dumps(_doc_worker())
    intentos = _escribir_listo_roto(monkeypatch, s3, fallos=2)
    worker.w.generar("u1", IMAGEN_ID)
    assert intentos == ["listo"] * 3
    assert json.loads(s3[CLAVE_DOC])["estado"] == "listo" and worker.devueltos == []


@pytest.mark.parametrize("estado", ["listo", "error", "otro", ""])
def test_un_pedido_que_no_esta_generando_no_hace_nada(worker, s3, fal_imagen, estado):
    """La reentrega de SQS: ni fal ni devolución ni escritura ni reclamo. Un `error` que ya devolvió
    (o que viene de antes de `devuelto`) no devuelve de nuevo, y un `listo` no paga otra imagen."""
    s3[CLAVE_DOC] = json.dumps(_doc_worker(estado=estado))
    antes = dict(s3)
    worker.w.generar("u1", IMAGEN_ID)
    assert fal_imagen.llamadas == [] and worker.devueltos == [] and dict(s3) == antes
    assert s3.subidas == {} and s3.escrituras == [] and s3.condicionales == [] and worker.infra == []


def test_un_error_ya_devuelto_no_hace_nada(worker, s3, fal_imagen):
    s3[CLAVE_DOC] = json.dumps(_doc_worker(estado="error", devuelto=True, error=MENSAJE_ERROR))
    antes = dict(s3)
    worker.w.generar("u1", IMAGEN_ID)
    assert fal_imagen.llamadas == [] and worker.devueltos == [] and dict(s3) == antes


@pytest.mark.parametrize("contenido", [None, "", "esto no es json", "[]", "null"])
def test_un_doc_que_no_existe_o_no_se_lee_no_hace_nada(worker, s3, fal_imagen, contenido):
    if contenido is not None:
        s3[CLAVE_DOC] = contenido
    worker.w.generar("u1", IMAGEN_ID)
    assert fal_imagen.llamadas == [] and worker.devueltos == [] and s3.escrituras == []
    assert s3.condicionales == []


def test_reentregado_tras_fallar_no_devuelve_dos_veces(worker, s3, fal_imagen):
    s3[CLAVE_DOC] = json.dumps(_doc_worker())
    fal_imagen.error = RuntimeError("boom")
    worker.w.generar("u1", IMAGEN_ID)
    worker.w.generar("u1", IMAGEN_ID)                      # SQS reentrega el mismo mensaje
    assert worker.devueltos == [(7, f"imagen:{IMAGEN_ID}", "u1")]
    assert len(fal_imagen.llamadas) == 1


def test_si_ni_siquiera_se_puede_escribir_el_doc_de_error_igual_se_devuelve(worker, s3, fal_imagen, caplog):
    """Devolver va primero: con S3 caído la devolución ya está hecha y NO se levanta (reentregar
    devolvería dos veces)."""
    s3[CLAVE_DOC] = json.dumps(_doc_worker())
    fal_imagen.error = RuntimeError("boom")
    s3.escritura_rota = True
    with caplog.at_level(logging.ERROR, logger="imagen_generar"):
        worker.w.generar("u1", IMAGEN_ID)                   # no levanta
    assert worker.devueltos == [(7, f"imagen:{IMAGEN_ID}", "u1")]
    assert "tampoco se pudo escribir el doc `error`" in caplog.text


# --- la devolución misma falla

def _fallar_sin_poder_devolver(worker, s3, fal_imagen):
    s3[CLAVE_DOC] = json.dumps(_doc_worker())
    fal_imagen.error = RuntimeError("boom")
    worker.devolver_roto = RuntimeError("Aurora caída")
    with pytest.raises(RuntimeError, match="Aurora caída"):
        worker.w.generar("u1", IMAGEN_ID)


def test_si_la_devolucion_falla_el_doc_lo_dice_y_el_worker_levanta_para_que_sqs_reentregue(
        worker, s3, fal_imagen, caplog):
    """El doc ya no promete lo que no pasó, el log lo dice claro y SQS reentrega (y a la segunda, la DLQ,
    que tiene alarma)."""
    with caplog.at_level(logging.ERROR, logger="imagen_generar"):
        _fallar_sin_poder_devolver(worker, s3, fal_imagen)
    doc = json.loads(s3[CLAVE_DOC])
    assert doc["estado"] == "error" and doc["devuelto"] is False
    assert doc["error"] == SIN_DEVOLVER and "Se te devolvieron" not in doc["error"]
    assert worker.devueltos == []
    assert "NO se pudieron devolver 7 créditos a u1" in caplog.text
    assert len(worker.infra) == 1                           # el finally corre aunque levante


def test_la_reentrega_tras_una_devolucion_fallida_repite_SOLO_la_devolucion(worker, s3, fal_imagen):
    _fallar_sin_poder_devolver(worker, s3, fal_imagen)
    listo_antes = json.loads(s3[CLAVE_DOC])["listo"]
    fal_imagen.error = None                                 # si regenerara, esta vez saldría bien
    worker.devolver_roto = None                             # y Aurora ya despertó

    worker.w.generar("u1", IMAGEN_ID)                       # la reentrega de SQS

    assert len(fal_imagen.llamadas) == 1 and s3.subidas == {}          # NO se regeneró
    assert worker.devueltos == [(7, f"imagen:{IMAGEN_ID}", "u1")]
    doc = json.loads(s3[CLAVE_DOC])
    assert (doc["estado"], doc["devuelto"], doc["error"]) == ("error", True, MENSAJE_ERROR)
    assert doc["listo"] == listo_antes                      # el error es el de siempre, no uno nuevo
    worker.w.generar("u1", IMAGEN_ID)                       # y una tercera entrega ya no hace nada
    assert worker.devueltos == [(7, f"imagen:{IMAGEN_ID}", "u1")]


def test_si_la_devolucion_falla_otra_vez_la_reentrega_tambien_levanta_hacia_la_dlq(worker, s3, fal_imagen):
    _fallar_sin_poder_devolver(worker, s3, fal_imagen)
    with pytest.raises(RuntimeError, match="Aurora caída"):
        worker.w.generar("u1", IMAGEN_ID)                   # sigue caída: el mensaje se va a la DLQ
    doc = json.loads(s3[CLAVE_DOC])
    assert doc["devuelto"] is False and doc["error"] == SIN_DEVOLVER
    assert len(fal_imagen.llamadas) == 1 and worker.devueltos == []


def test_la_reentrega_de_una_devolucion_fallida_no_espera_a_que_el_reclamo_venza(worker, s3, fal_imagen):
    """El worker que no pudo devolver suelta su reclamo: la cola reentrega a los 15 min MENOS lo que
    tardó en arrancar, y esperar los 14 justos dejaría el reintento callado (sin DLQ ni alarma)."""
    _fallar_sin_poder_devolver(worker, s3, fal_imagen)
    assert worker.w._reclamo_vencido(s3[RECLAMO])
    worker.devolver_roto = None
    worker.w.generar("u1", IMAGEN_ID)
    assert worker.devueltos == [(7, f"imagen:{IMAGEN_ID}", "u1")]


@pytest.mark.parametrize("creditos_doc", [0, None])
def test_sin_creditos_cobrados_no_se_devuelve_nada_y_no_se_dice_que_se_devolvieron(
        worker, s3, fal_imagen, creditos_doc):
    s3[CLAVE_DOC] = json.dumps(_doc_worker(creditos=creditos_doc))
    fal_imagen.error = RuntimeError("boom")
    worker.w.generar("u1", IMAGEN_ID)
    doc = json.loads(s3[CLAVE_DOC])
    assert worker.devueltos == [] and doc["estado"] == "error"
    assert doc["error"] == "La imagen no se pudo generar. No se te cobró." and doc["devuelto"] is True


def test_sin_monedero_activo_no_se_devuelve(worker, s3, fal_imagen, monkeypatch):
    from pipeline import creditos
    monkeypatch.setattr(creditos, "activo", lambda: False)
    s3[CLAVE_DOC] = json.dumps(_doc_worker())
    fal_imagen.error = RuntimeError("boom")
    worker.w.generar("u1", IMAGEN_ID)
    assert worker.devueltos == []
    assert json.loads(s3[CLAVE_DOC])["error"] == "La imagen no se pudo generar. No se te cobró."


def test_un_doc_a_medias_se_trata_como_un_fallo_y_devuelve(worker, s3, fal_imagen):
    """`generando` pero sin prompt: no se puede generar, así que se devuelve lo cobrado."""
    doc = _doc_worker()
    del doc["prompt"]
    s3[CLAVE_DOC] = json.dumps(doc)
    worker.w.generar("u1", IMAGEN_ID)
    assert fal_imagen.llamadas == []
    assert worker.devueltos == [(7, f"imagen:{IMAGEN_ID}", "u1")]
    assert json.loads(s3[CLAVE_DOC])["estado"] == "error"


def test_lo_unico_que_sale_del_worker_antes_de_generar_es_no_poder_leer(worker, s3, fal_imagen):
    """Todavía no se llamó a fal ni se sabe qué se cobró: el reintento de la cola es inocuo."""
    s3.lectura_rota = True
    with pytest.raises(OSError):
        worker.w.generar("u1", IMAGEN_ID)
    assert fal_imagen.llamadas == [] and worker.devueltos == []


# --- el reclamo: SQS estándar entrega al menos una vez, a veces dos a la vez

@pytest.mark.parametrize("edad_s", [0, 60, 13 * 60, 14 * 60 - 1])
def test_con_un_reclamo_reciente_esta_entrega_no_hace_nada(worker, s3, fal_imagen, edad_s):
    """Otra entrega lo está resolviendo (o acaba de hacerlo): ni fal, ni devolución, ni escritura."""
    s3[CLAVE_DOC] = json.dumps(_doc_worker())
    s3.poner(RECLAMO, _reclamo(edad_s))
    antes = dict(s3)
    worker.w.generar("u1", IMAGEN_ID)
    assert fal_imagen.llamadas == [] and worker.devueltos == [] and s3.subidas == {}
    assert s3.escrituras == [] and dict(s3) == antes and worker.infra == []


@pytest.mark.parametrize("edad_s", [14 * 60, 14 * 60 + 1, 15 * 60, 3600])
def test_un_reclamo_de_14_minutos_o_mas_es_de_un_worker_muerto_y_se_toma_con_if_match(
        worker, s3, fal_imagen, edad_s):
    s3[CLAVE_DOC] = json.dumps(_doc_worker())
    etag_viejo = s3.poner(RECLAMO, _reclamo(edad_s))
    worker.w.generar("u1", IMAGEN_ID)
    assert len(fal_imagen.llamadas) == 1 and json.loads(s3[CLAVE_DOC])["estado"] == "listo"
    # primero intentó crearlo (y existía) y después lo tomó con la etiqueta VIEJA
    assert s3.condicionales == [(RECLAMO, None, False), (RECLAMO, etag_viejo, True)]
    assert not worker.w._reclamo_vencido(s3[RECLAMO])      # ahora es suyo, y fresco


@pytest.mark.parametrize("basura", ["esto no es json", "{}", "[]", '{"reclamado": "ayer"}',
                                    '{"reclamado": "2026-10-11T12:00:00"}', '{"reclamado": null}', ""])
def test_un_reclamo_que_no_se_lee_cuenta_como_vencido(worker, s3, fal_imagen, basura):
    s3[CLAVE_DOC] = json.dumps(_doc_worker())
    s3.poner(RECLAMO, basura)
    worker.w.generar("u1", IMAGEN_ID)
    assert len(fal_imagen.llamadas) == 1


def test_si_otro_toma_el_reclamo_vencido_entre_leerlo_y_tomarlo_esta_entrega_no_hace_nada(
        worker, s3, fal_imagen, monkeypatch):
    """Dos entregas ven el mismo reclamo vencido: la etiqueta vieja solo le sirve a la primera."""
    from pipeline import media_sync
    s3[CLAVE_DOC] = json.dumps(_doc_worker())
    s3.poner(RECLAMO, _reclamo(20 * 60))
    leer_con_etag = media_sync.leer_texto_con_etag

    def leer_y_que_otro_lo_tome(key):
        visto = leer_con_etag(key)
        s3.poner(key, _reclamo(0))                          # la otra entrega llegó primero
        return visto

    monkeypatch.setattr(media_sync, "leer_texto_con_etag", leer_y_que_otro_lo_tome)
    worker.w.generar("u1", IMAGEN_ID)
    assert fal_imagen.llamadas == [] and worker.devueltos == [] and s3.escrituras == []


def test_si_el_reclamo_no_se_puede_escribir_se_levanta_sin_llamar_a_fal(worker, s3, fal_imagen, monkeypatch):
    """Antes de fal no se cobró nada más: que SQS reentregue es inocuo."""
    from pipeline import media_sync

    def roto(*a, **k):
        raise OSError("S3 caído")

    monkeypatch.setattr(media_sync, "escribir_texto_si", roto)
    s3[CLAVE_DOC] = json.dumps(_doc_worker())
    with pytest.raises(OSError):
        worker.w.generar("u1", IMAGEN_ID)
    assert fal_imagen.llamadas == [] and worker.devueltos == []


def _dos_entregas_a_la_vez(worker, s3, monkeypatch, estado_esperado):
    """DOS copias del mismo mensaje corriendo a la vez. La barrera las obliga a leer el doc ANTES de que
    cualquiera escriba: es la ventana del «leo, veo `generando`, genero» sin escritura condicional."""
    from pipeline import media_sync
    barrera = threading.Barrier(2)
    leer = media_sync.leer_texto

    def leer_juntas(key):
        v = leer(key)
        if key == CLAVE_DOC:
            barrera.wait(timeout=10)
        return v

    monkeypatch.setattr(media_sync, "leer_texto", leer_juntas)
    errores = []

    def correr():
        try:
            worker.w.generar("u1", IMAGEN_ID)
        except BaseException as e:      # noqa: BLE001 — se reporta abajo, no se pierde en el hilo
            errores.append(e)

    hilos = [threading.Thread(target=correr) for _ in range(2)]
    [h.start() for h in hilos]
    [h.join(30) for h in hilos]
    assert not any(h.is_alive() for h in hilos), "una entrega se colgó"
    assert errores == []
    assert json.loads(s3[CLAVE_DOC])["estado"] == estado_esperado


def test_dos_entregas_a_la_vez_que_fallan_devuelven_UNA_sola_vez(worker, s3, fal_imagen, monkeypatch):
    s3[CLAVE_DOC] = json.dumps(_doc_worker())
    fal_imagen.error = RuntimeError("rechazo de contenido")
    _dos_entregas_a_la_vez(worker, s3, monkeypatch, "error")
    assert worker.devueltos == [(7, f"imagen:{IMAGEN_ID}", "u1")]
    assert len(fal_imagen.llamadas) == 1                    # y fal tampoco se pagó dos veces
    assert len(worker.infra) == 1                           # la que perdió el reclamo no anotó nada


@pytest.mark.parametrize("secuencia,estado,devoluciones", [
    ([None, RuntimeError("rechazo")], "listo", 0),          # la primera en llegar es la que sale bien
    ([RuntimeError("rechazo"), None], "error", 1),          # la primera en llegar es la que falla
], ids=["gana-la-buena", "gana-la-mala"])
def test_dos_entregas_a_la_vez_una_buena_y_una_mala_no_se_pisan(
        worker, s3, fal_imagen, monkeypatch, secuencia, estado, devoluciones):
    """Sin reclamo, la buena dejaba la imagen en la galería y la mala la marcaba `error` y devolvía los
    créditos: imagen gratis y un doc que miente. Con reclamo corre UNA y su resultado es el único."""
    s3[CLAVE_DOC] = json.dumps(_doc_worker())
    fal_imagen.secuencia = list(secuencia)
    _dos_entregas_a_la_vez(worker, s3, monkeypatch, estado)
    assert len(fal_imagen.llamadas) == 1
    assert len(worker.devueltos) == devoluciones
    assert len(s3.subidas) == (1 if estado == "listo" else 0)
    assert _estados_escritos(s3) == [CLAVE_DOC]             # un solo doc escrito, una sola vez


def test_dos_reentregas_a_la_vez_de_una_devolucion_fallida_devuelven_UNA_sola_vez(
        worker, s3, fal_imagen, monkeypatch):
    _fallar_sin_poder_devolver(worker, s3, fal_imagen)
    worker.devolver_roto = None
    _dos_entregas_a_la_vez(worker, s3, monkeypatch, "error")
    assert worker.devueltos == [(7, f"imagen:{IMAGEN_ID}", "u1")]
    assert json.loads(s3[CLAVE_DOC])["devuelto"] is True


def test_el_api_y_el_worker_hablan_del_mismo_doc_de_punta_a_punta(
        cliente, nube, s3, monedero, cola, worker, fal_imagen, monkeypatch):
    """El API cobra, escribe el doc y encola; el worker (con SU usuario) lo lee, genera y sube; la pantalla
    ve `listo` y la imagen aparece en «Mis creaciones». Si las dos claves de S3 se separaran, esto falla."""
    from pipeline import creditos
    r = _pedir(cliente, "flux3", formato="vertical")
    assert r.status_code == 200, r.text
    imagen_id = r.json()["id"]
    assert cliente.get(f"/api/imagenes/pedidos/{imagen_id}").json()["estado"] == "generando"
    assert [p["id"] for p in _pendientes(cliente)] == [imagen_id]

    monkeypatch.setattr(creditos, "devolver", lambda *a: pytest.fail("devolvió con una imagen buena"))
    worker.w.generar(USER, imagen_id)

    ficha = cliente.get(f"/api/imagenes/pedidos/{imagen_id}").json()
    assert ficha["estado"] == "listo" and NOMBRE_RE.match(ficha["nombre"])
    assert ficha["url"] == f"/api/imagenes/{ficha['nombre']}"
    assert list(s3.subidas) == [f"imagenes/{USER}/{ficha['nombre']}"]
    (ll,) = fal_imagen.llamadas
    assert ll.kw["aspecto"] == "9:16" and ll.kw["modelo"] == "flux3"
    d = cliente.get("/api/imagenes").json()
    assert d["pendientes"] == [] and [i["nombre"] for i in d["imagenes"]] == [ficha["nombre"]]


# ---------------------------------------------------------------------------
# «Tus trabajos» (/api/trabajos): las imágenes en segundo plano, como los clips

def _ficha_trabajo(doc, ref="img-1", ahora=None):
    from server import trabajos_api
    return trabajos_api.ficha_s3("imagen", ref, doc, ahora or datetime.now(timezone.utc).timestamp())


def test_trabajos_una_imagen_generandose_es_un_trabajo_en_curso():
    f = _ficha_trabajo(_doc(edad_s=60, texto="un faro de noche"))
    assert (f["tipo"], f["estado"], f["titulo"], f["detalle"], f["url"]) == (
        "imagen", "corriendo", "Generando tu imagen", "un faro de noche", "/imagenes.html")


def test_trabajos_una_imagen_lista_dice_que_esta_lista():
    f = _ficha_trabajo(_doc("listo", edad_s=120, listo=_iso(30)))
    assert (f["estado"], f["titulo"], f["devueltos"]) == ("listo", "Tu imagen está lista", None)


@pytest.mark.parametrize("extra,devueltos", [
    ({"devuelto": True}, 4),               # el worker devolvió lo cobrado
    ({}, 4),                               # un error de antes de `devuelto` (o del encolado): ya devolvió
    ({"devuelto": False}, None),           # NO se pudo devolver: no se afirma nada
])
def test_trabajos_el_error_solo_dice_que_se_devolvieron_los_creditos_si_se_devolvieron(extra, devueltos):
    f = _ficha_trabajo(_doc("error", edad_s=120, listo=_iso(30), error="x", **extra))
    assert (f["estado"], f["titulo"], f["devueltos"]) == ("error", "No se pudo generar tu imagen", devueltos)


def test_trabajos_un_pedido_caducado_se_enseña_como_error_sin_devueltos_y_se_va_a_la_hora():
    f = _ficha_trabajo(_doc(edad_s=40 * 60))
    assert (f["estado"], f["titulo"], f["devueltos"]) == ("error", "No se pudo generar tu imagen", None)
    assert _ficha_trabajo(_doc(edad_s=70 * 60)) is None
    assert _ficha_trabajo(_doc(inicio="ayer")) is None


def test_trabajos_el_endpoint_junta_las_imagenes_con_lo_demas(cliente, nube, s3, monkeypatch):
    from pipeline import db, media_sync
    ahora = datetime.now(timezone.utc).timestamp()
    monkeypatch.setattr(db, "backend", lambda: "postgres")
    monkeypatch.setattr(db, "proyectos_recientes", lambda user, horas: [])
    monkeypatch.setattr(db, "corridas_editor", lambda user: [])
    _poner(s3, _id(30), _doc(texto="la que corre", edad_s=30))
    _poner(s3, _id(300), _doc("listo", texto="la lista", edad_s=300, listo=_iso(200)))
    _poner(s3, _id(900), _doc("error", texto="la rota", edad_s=900, listo=_iso(800), devuelto=True))
    s3[f"usuarios/{USER}/imagenes-pedidos/{_id(30)}.reclamo"] = _reclamo(30)      # no es un doc
    _poner(s3, _id(40), _doc(texto="de otro", edad_s=40), user="otro")
    monkeypatch.setattr(media_sync, "listar_prefijo_con_fecha",
                        lambda prefijo: [(k, ahora - 60) for k in s3 if k.startswith(prefijo)])
    r = cliente.get("/api/trabajos")
    assert r.status_code == 200, r.text
    imagenes = [t for t in r.json()["trabajos"] if t["tipo"] == "imagen"]
    assert {t["detalle"]: (t["estado"], t["devueltos"]) for t in imagenes} == {
        "la que corre": ("corriendo", None), "la lista": ("listo", None), "la rota": ("error", 4)}
    assert all(t["id"].startswith("imagen:img-") for t in imagenes)
    # lo que corre va primero
    assert r.json()["trabajos"][0]["estado"] == "corriendo"


# ---------------------------------------------------------------------------
# el despachador de la Lambda del worker

def _mensaje(**cuerpo) -> dict:
    return {"Records": [{"body": json.dumps(cuerpo)}]}


def test_el_despachador_manda_el_tipo_imagen_a_su_trabajo(monkeypatch):
    import worker.imagen_generar as w
    from worker import lambda_worker
    llamadas = []
    monkeypatch.setattr(w, "generar", lambda user_id, imagen_id: llamadas.append((user_id, imagen_id)))
    r = lambda_worker.handler(_mensaje(tipo="imagen", user_id="u1", imagen_id=IMAGEN_ID), None)
    assert r == {"ok": True} and llamadas == [("u1", IMAGEN_ID)]


def test_el_despachador_entrega_un_lote_en_orden(monkeypatch):
    import worker.imagen_generar as w
    from worker import lambda_worker
    llamadas = []
    monkeypatch.setattr(w, "generar", lambda user_id, imagen_id: llamadas.append(imagen_id))
    evento = {"Records": [{"body": json.dumps({"tipo": "imagen", "user_id": "u1", "imagen_id": i})}
                          for i in ("img-1", "img-2")]}
    lambda_worker.handler(evento, None)
    assert llamadas == ["img-1", "img-2"]


@pytest.mark.parametrize("tipo", ["imagenes", "Imagen", "imagen_x", ""])
def test_un_tipo_desconocido_sigue_levantando_value_error(monkeypatch, tipo):
    import worker.imagen_generar as w
    from worker import lambda_worker
    monkeypatch.setattr(w, "generar", lambda *a: pytest.fail("no era una imagen"))
    with pytest.raises(ValueError, match="tipo de trabajo desconocido"):
        lambda_worker.handler(_mensaje(tipo=tipo, user_id="u1", imagen_id=IMAGEN_ID), None)
