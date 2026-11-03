"""Imágenes en segundo plano — el patrón del clip aplicado a `POST /api/imagenes`.

`/api/imagenes` generaba DENTRO de la petición y la Lambda del API corta a los 29 s (API
Gateway: tope fijo de 30 s; un arranque en frío gasta unos 16). Tres modelos tardaron
más de 10 s en la prueba pagada y van por la cola (FLUX 3 hasta 25.0 s, Seedream 4.5 hasta
22.7 s, Seedream 5.0 Flash 15.0 s; Grok y Nano Banana 2 también pasan de 10 s, pero siguen
síncronos «de momento» por decisión del dueño) y, cortada la petición, se cobraba, no se
devolvía y fal cobraba igual. Esos pasan por la cola: cobrar → doc en S3 → `jobs.encolar_imagen` →
`worker/imagen_generar.py` → la pantalla sondea `GET /api/imagenes/pedidos/{id}`.

Lo que este archivo defiende:

  * la TABLA: qué modelos van a segundo plano y por qué (los segundos medidos están fijados
    aquí) — la regla es «segundo_plano si y solo si algún tiempo medido pasó de 10 s», con DOS
    excepciones nombradas: Grok (13 a 29 s medidos) y Nano Banana 2 al crear (11.7 s), que siguen
    síncronos «de momento» por decisión del dueño del 11-oct-2026 (docs/OPERACION.md);
  * el contrato HTTP: validar todo antes de cobrar (422), el tope de 3 en marcha (409), el
    orden cobrar → doc → encolar, la devolución si no se pudo lanzar (502), y la respuesta de
    siempre para los rápidos y para el backend local;
  * `pendientes` en `GET /api/imagenes` y `GET /api/imagenes/pedidos/{id}`: la ficha sin el
    prompt completo, el recorte por fecha ANTES de leer, que jamás se vea lo de otro, que se
    lean ANTES que las imágenes y que un S3 caído no tumbe la lista de imágenes —pero lo diga:
    `pendientes_ok: false`, para que un `[]` no se lea como «no hay pendientes»—; la caducidad
    de 45 min que comparten el tope y el aviso de «tardó demasiado»;
  * el worker: nunca relanza la generación, devuelve EXACTAMENTE lo cobrado (leído del doc),
    devuelve ANTES de escribir el doc `error` (que guarda `devuelto`) y, si la devolución
    falla o el doc `error` no se puede escribir, levanta para que SQS reentregue y la reentrega
    repite SOLO la devolución (idempotente: una sentencia atómica, no abona dos veces aunque
    falle a medias); deja marcado el fallo en el reclamo ANTES de devolver, así que ni con el
    doc sin escribir se regenera; la imagen ya subida nunca se devuelve aunque el doc `listo` no
    se pueda escribir; y no paga ni devuelve dos veces cuando SQS entrega el mismo mensaje a la
    vez (el reclamo en S3, con un token propio: el 412 que recibe el reintento de botocore sobre
    su PUT ya aplicado no lo hace perder su propio reclamo);
  * el despachador de la Lambda del worker y que el API y el worker hablen del mismo doc;
  * «Tus trabajos» (/api/trabajos) también enseña las imágenes en segundo plano, con un enlace al
    inicio nuevo (donde «Mis creaciones» las enseña) y leyéndolas como «Mis creaciones», sin listar
    todo el historial.

Sin red hacia afuera: fal, S3, SQS y el monedero mockeados. La única conexión es la de botocore real
contra un S3 falso en 127.0.0.1 (`_S3Http`), que existe para provocar lo que un doble en memoria no puede.

OJO: nada de importar pipeline/server a nivel de módulo (ver test_m25_clip)."""
import importlib.util
import json
import logging
import os
import re
import shutil
import subprocess
import sys
import threading
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import unquote

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

RAIZ = Path(__file__).resolve().parent.parent
USER = "ana"

LENTOS = ("sdf", "sd45", "flux3", "nbp-2k", "nbp-4k")
RAPIDOS = ("grok", "klein", "zit", "flux2", "nb2")
# Los segundos MEDIDOS por llamada en las pruebas pagadas (docs/modelos-ia/POR-VERIFICAR.md,
# DATOS-FAL-2026-10-08.md §9 y §11): (menor, mayor). Nano Banana 2 son tres llamadas (crear 11.7 s;
# editar 11.5 y 13.9 s). Grok Imagine SÍ tiene medición: ocho llamadas reales el 18-sep, de 13 a 29 s
# (mediana 16; el vertical, 28.7 s), en PLAN-PRODUCTO.md y en tools/pricing.json (`grok_nota`).
TIEMPOS_MEDIDOS = {
    "nb2": (11.5, 13.9),
    "sdf": (13.4, 15.0),
    "sd45": (8.6, 22.7),
    "flux3": (21.8, 25.0),
    "flux2": (7.2, 8.1),
    "klein": (0.8, 1.2),
    "zit": (1.0, 1.8),
    "grok": (13, 29),
    # Nano Banana Pro (Ola 3), prueba pagada del 11-oct-2026 hora de México (DATOS-FAL §13): 2K 28.1 y 24.9 s;
    # 4K 37.4 y 43.5 s
    "nbp-2k": (24.9, 28.1),
    "nbp-4k": (37.4, 43.5),
}
# La regla manda en todos menos en dos, y las excepciones están NOMBRADAS: Grok (el predeterminado) rozaba
# el muro de 29 s ya en síncrono, y Nano Banana 2 al crear midió 11.7 s: la regla mandaría a los dos a
# segundo plano, pero el dueño decidió el 11-oct-2026 dejarlos como están «de momento» (docs/OPERACION.md,
# «Decisión del dueño: Grok y Nano Banana 2»). Mientras no cambie, las banderas siguen en False; cuando
# cambie, se borra su línea aquí y la prueba obliga a que la bandera siga a la regla.
EXCEPCIONES_A_LA_REGLA = {"grok": "decisión del dueño, de momento", "nb2": "decisión del dueño, de momento"}

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
    ese booleano tiene que seguir a la medición: un modelo nuevo sin medir obliga a medirlo aquí.
    Las únicas excepciones son Grok y Nano Banana 2, nombradas, y tienen que serlo de verdad."""
    from pipeline import modelos_ia
    imagen = modelos_ia.disponibles("imagen")
    assert set(imagen) == set(TIEMPOS_MEDIDOS), "modelo nuevo de imagen: anota sus segundos"
    for id_, (_, mayor) in TIEMPOS_MEDIDOS.items():
        va = modelos_ia.resolver("imagen", id_).segundo_plano
        if id_ in EXCEPCIONES_A_LA_REGLA:
            assert mayor > _muro_s() and va is False, id_      # la regla lo mandaría; el dueño aún no
        else:
            assert va is (mayor > _muro_s()), id_
    assert set(EXCEPCIONES_A_LA_REGLA) == {"grok", "nb2"}


def test_exactamente_estos_van_a_segundo_plano_al_crear():
    """Los que midieron más de 10 s: Seedream 5.0 Flash, Seedream 4.5, FLUX 3 y las dos calidades de Nano Banana Pro."""
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
    y si va en segundo plano. Grok (13 a 29 s) y Nano Banana 2 (11.7 s al crear) llevan su «no, por ahora»."""
    doc = (RAIZ / "docs" / "modelos-ia" / "POR-VERIFICAR.md").read_text(encoding="utf-8")
    seccion = doc[doc.index("### Qué va en segundo plano y por qué"):]
    filas = {}
    for linea in seccion.splitlines():
        celdas = [c.strip() for c in linea.strip().strip("|").split("|")]
        m = re.search(r"\(`([a-z0-9-]+)`\)", celdas[0]) if len(celdas) == 3 else None
        if m:
            filas[m.group(1)] = celdas
    assert set(filas) == set(TIEMPOS_MEDIDOS)
    for id_, (menor, mayor) in TIEMPOS_MEDIDOS.items():
        _, segundos, va = filas[id_]
        assert segundos.startswith(f"{menor} a {mayor}"), id_
        if id_ in EXCEPCIONES_A_LA_REGLA:
            assert va.lower().startswith("no") and "decisión del dueño" in va.lower(), id_
        else:
            assert va.lower().startswith("sí" if mayor > _muro_s() else "no"), id_


def test_grok_y_nb2_tienen_medicion_y_la_decision_del_dueno_esta_escrita_donde_la_lee():
    """La documentación decía que Grok no tenía medición «en el repo» y que era «rápido y conocido»: falso.
    Lo que hay medido sigue en su sitio, ya no se afirma lo contrario y la decisión del dueño (Grok y
    Nano Banana 2 se quedan síncronos «de momento») está en OPERACION.md."""
    assert "13–29 s por imagen" in (RAIZ / "PLAN-PRODUCTO.md").read_text(encoding="utf-8")
    assert "13-29 s" in (RAIZ / "tools" / "pricing.json").read_text(encoding="utf-8")
    for md in (RAIZ / "docs" / "modelos-ia").glob("*.md"):
        texto = md.read_text(encoding="utf-8").lower()
        assert "sin medición registrada" not in texto and "rápido y conocido" not in texto, md.name
    operacion = (RAIZ / "docs" / "OPERACION.md").read_text(encoding="utf-8")
    titulo = "**Decisión del dueño (11-oct-2026): Grok y Nano Banana 2 siguen síncronos"
    assert titulo in operacion
    decision = operacion[operacion.index(titulo):][:4200]
    assert "13 a 29 s" in decision and "28.7" in decision and "segundo_plano=True" in decision
    assert "11.7 s" in decision and "EXCEPCIONES_A_LA_REGLA" in decision


# ---------------------------------------------------------------------------
# fixtures

class _S3(dict):
    """Los docs de S3 en memoria ({key: texto}) y lo que se hizo con ellos.

    Falla como falla S3 de verdad, no solo «antes de escribir»: `escritura_rota` hace fallar toda escritura
    (o, con un sufijo como ".json", solo las de esas keys); `respuesta_perdida` APLICA las siguientes N
    escrituras y levanta igual (se escribió, se perdió la respuesta); `condicional_aplicada_412` APLICA la
    escritura condicional número N (1 = la primera) y contesta como si hubiera perdido —el 412 que recibe el
    reintento automático de botocore sobre un PUT que sí se aplicó—; `condicional_roto` hace fallar las
    condicionales."""

    def __init__(self):
        super().__init__()
        self.lecturas: list[str] = []
        self.prefijos: list[str] = []
        self.escrituras: list[str] = []
        self.subidas: dict[str, bytes] = {}
        self.escritura_rota: bool | str = False
        self.respuesta_perdida = 0
        self.condicional_aplicada_412: set[int] = set()
        self.condicional_roto = False
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
        if docs.escritura_rota is True or (docs.escritura_rota and key.endswith(docs.escritura_rota)):
            raise OSError("S3 caído")
        with docs.candado:
            docs.escrituras.append(key)
            docs.poner(key, texto)
            if docs.respuesta_perdida:
                docs.respuesta_perdida -= 1
                raise OSError("se escribió, pero la respuesta se perdió")

    def leer_con_etag(key):
        with docs.candado:
            return docs.get(key), docs.etags.get(key)

    def escribir_si(key, texto, etag=None, tipo="application/json"):
        """Como el de S3: sin etiqueta solo si no existe (If-None-Match), con ella solo si nadie lo cambió."""
        if docs.condicional_roto:
            raise OSError("S3 caído")
        with docs.candado:
            ok = (key not in docs) if etag is None else docs.etags.get(key) == etag
            docs.condicionales.append((key, etag, ok))
            if not ok:
                return None
            nueva = docs.poner(key, texto)
            # aplicada, pero el reintento de botocore recibió 412 y esto cree que perdió
            return None if len(docs.condicionales) in docs.condicional_aplicada_412 else nueva

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
    f = SimpleNamespace(llamadas=[], error=None, secuencia=[], contenido=b"jpg-de-fal", por_hilo={},
                        al_llamar=None)

    async def imagen_fal(*args, **kw):
        hilo = threading.current_thread().name
        f.llamadas.append(SimpleNamespace(args=args, kw=kw, hilo=hilo))
        if f.al_llamar:
            f.al_llamar()                        # p. ej. «justo ahora S3 se cae»
        # lo que sale puede depender de QUÉ entrega llama (por nombre de hilo), de la llamada o de todas
        error = f.por_hilo[hilo] if hilo in f.por_hilo else f.secuencia.pop(0) if f.secuencia else f.error
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


def test_con_estilo_ninguno_el_doc_lleva_el_texto_y_las_reglas_sin_estilo_y_la_ficha_no_enseña_el_prompt(
        cliente, nube, s3, monedero, cola):
    """La caja del inicio manda `ninguno` (dueño, 14-oct-2026): al doc —y de ahí al worker, que lo manda tal
    cual a fal— llega el texto de la persona y las reglas de siempre, sin «Pixar». La ficha que ve la UI
    («Mis creaciones») no trae el prompt armado, solo lo que escribió: no cambia con esto."""
    r = _pedir(cliente, "flux3", estilo="ninguno", estilo_custom="acuarela suave")
    assert r.status_code == 200, r.text
    (clave,) = s3
    doc = json.loads(s3[clave])
    assert doc["texto"] == "un gato astronauta"
    assert doc["prompt"] == "un gato astronauta. No text, no watermark."
    assert "pixar" not in doc["prompt"].lower() and "acuarela" not in doc["prompt"]
    ficha = cliente.get(f"/api/imagenes/pedidos/{r.json()['id']}").json()
    assert ficha["texto"] == "un gato astronauta" and "prompt" not in ficha


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
    _doc(edad_s=46 * 60),                                          # generando, pero caducó (más de 45 min)
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
    """Solo CREAR se encola: `POST /api/imagenes/editar` con Nano Banana 2 queda como estaba.

    Editar con él se apagó el 14-oct-2026 (sin número en tarifas.json, tests/test_r4_ola1.py
    INERTES): aquí se le pone el número para probar el camino, que es el que volvería al
    encenderlo sin pasar editar a segundo plano."""
    from pipeline import creditos, media_fal
    monkeypatch.setitem(creditos.MODELOS_CR["editar"], "nb2", 8)
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


def test_sin_pedidos_pendientes_es_una_lista_vacia_y_nunca_faltan_las_llaves(cliente, nube, s3):
    assert cliente.get("/api/imagenes").json() == {"total": 0, "imagenes": [], "pendientes": [],
                                                   "pendientes_ok": True}


def test_en_local_pendientes_es_vacia_y_no_se_consulta_s3(cliente, s3, monkeypatch):
    monkeypatch.delenv("JOBS_BACKEND", raising=False)
    _poner(s3, _id(30), _doc())                         # aunque hubiera un doc a la vista
    assert _pendientes(cliente) == []
    assert cliente.get("/api/imagenes").json()["pendientes_ok"] is True        # no leer no es fallar
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
    """Más de 45 minutos sin respuesta: ya no es «Generando…», pero tampoco desaparece en silencio. No
    sabemos qué le pasó al worker, así que NO se afirma que se devolvieron los créditos."""
    _poner(s3, _id(50 * 60), _doc(edad_s=50 * 60, nombre="a" * 12 + ".jpg"))
    (p,) = _pendientes(cliente)
    assert (p["id"], p["estado"], p["error"], p["url"]) == (_id(50 * 60), "error", CADUCADO, "")
    assert "devolvieron" not in p["error"] and p["nombre"] == "a" * 12 + ".jpg"


@pytest.mark.parametrize("edad_s,se_ve", [(44 * 60, "generando"), (46 * 60, "error"), (59 * 60, "error"),
                                          (61 * 60, None), (5 * 3600, None)])
def test_el_generando_pasa_a_error_a_los_45_min_y_se_va_a_la_hora(cliente, nube, s3, edad_s, se_ve):
    _poner(s3, _id(edad_s), _doc(edad_s=edad_s))
    assert [p["estado"] for p in _pendientes(cliente)] == ([se_ve] if se_ve else [])


def test_la_caducidad_es_de_45_minutos_y_la_comparten_el_tope_y_el_mensaje(cliente, nube, s3, monedero, cola):
    """30 min era poco: la cola reentrega a los 15 y un pedido puede esperar detrás de dos clips. El tope de 3
    (`MAX_EN_MARCHA`), el paso a error de «Mis creaciones» y de «Tus trabajos» salen de la MISMA constante."""
    from server import imagen_cola
    assert imagen_cola.HORAS_CADUCA == 0.75 and imagen_cola.MAX_EN_MARCHA == 3
    for i in range(3):                                          # tres de 44 min: siguen contando
        _poner(s3, _id(44 * 60 + i), _doc(edad_s=44 * 60 + i))
    assert _pedir(cliente, "flux3").status_code == 409
    for clave in list(s3):
        del s3[clave]
    for i in range(3):                                          # tres de 46 min: ya no ocupan lugar
        _poner(s3, _id(46 * 60 + i), _doc(edad_s=46 * 60 + i))
    assert _pedir(cliente, "flux3").status_code == 200
    assert [p["estado"] for p in _pendientes(cliente) if p["id"] != monedero.cobros[0][1].removeprefix("imagen:")] \
        == ["error"] * 3


def test_un_generando_caducado_se_enseña_pero_sigue_sin_contar_para_el_tope(cliente, nube, s3, monedero, cola):
    for i in range(3):
        _poner(s3, _id(50 * 60 + i), _doc(edad_s=50 * 60 + i))
    assert [p["estado"] for p in _pendientes(cliente)] == ["error"] * 3
    assert _pedir(cliente, "flux3").status_code == 200          # tres «error» visibles, ninguno ocupa lugar


def test_un_generando_caducado_sin_fecha_legible_no_se_enseña(cliente, nube, s3):
    _poner(s3, _id(50 * 60), _doc(inicio="ayer"))
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
    assert r.json()["pendientes_ok"] is False           # y lo dice: [] aquí NO significa «no hay pendientes»
    avisos = [x for x in caplog.records if x.name == "imagen_cola"]
    assert [x.levelno for x in avisos] == [logging.WARNING] and avisos[0].exc_info is not None


def test_si_s3_falla_al_leer_todos_los_pedidos_la_lista_de_imagenes_sigue_saliendo(cliente, nube, s3):
    s3.subidas[f"imagenes/{USER}/0123456789ab.jpg"] = b"jpg"
    _poner(s3, _id(30), _doc())
    s3.lectura_rota = True
    r = cliente.get("/api/imagenes")
    assert r.status_code == 200 and r.json()["pendientes"] == []
    assert r.json()["pendientes_ok"] is False
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
    # …pero la respuesta ya no dice «esto es todo»: al pedido que falta lo tapaba un 200 sin aviso
    assert cliente.get("/api/imagenes").json()["pendientes_ok"] is False


def test_pendientes_ok_es_true_si_se_leyo_todo_aunque_un_doc_no_sea_json(cliente, nube, s3):
    """Un doc corrupto no se va a arreglar solo ni es un fallo de S3: no apaga la señal de «se leyó todo»."""
    _poner(s3, _id(30), _doc(texto="el bueno"))
    s3[f"usuarios/{USER}/imagenes-pedidos/{_id(31)}.json"] = "esto no es json"
    d = cliente.get("/api/imagenes").json()
    assert [p["texto"] for p in d["pendientes"]] == ["el bueno"] and d["pendientes_ok"] is True


def test_pendientes_ok_vuelve_a_ser_true_cuando_s3_se_recupera(cliente, nube, s3):
    """La señal es de ESA lectura: no se queda pegada."""
    _poner(s3, _id(30), _doc(texto="en marcha"))
    s3.listado_roto = True
    assert cliente.get("/api/imagenes").json()["pendientes_ok"] is False
    s3.listado_roto = False
    d = cliente.get("/api/imagenes").json()
    assert d["pendientes_ok"] is True and [p["texto"] for p in d["pendientes"]] == ["en marcha"]


def test_la_llave_pendientes_sigue_en_la_respuesta_cuando_la_lectura_fallo(cliente, nube, s3):
    s3.listado_roto = True
    d = cliente.get("/api/imagenes").json()
    assert d["pendientes"] == [] and d["pendientes_ok"] is False and {"total", "imagenes"} <= set(d)


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
# botocore REAL contra un S3 que aplica el PUT y pierde la respuesta

class _S3Http:
    """Un S3 en localhost para botocore de verdad (con sus reintentos de fábrica). Aplica los PUT condicionales
    y en los que se le piden (`perder_respuesta_de`, 1 = el primer PUT) CORTA la conexión sin responder: lo que
    pasa con un reset o un timeout justo después de que S3 escribió. botocore reintenta solo, y el reintento de
    un PUT condicional que ya se aplicó recibe 412 aunque el primero sí escribió. Un doble en memoria no
    produce eso, y por eso las pruebas de concurrencia no lo cubrían. `bitacora` anota cada petición con el
    número de intento que declara el SDK (`amz-sdk-request: attempt=N`)."""

    def __init__(self):
        self.objetos: dict[str, tuple[bytes, str]] = {}
        self.bitacora: list[tuple[str, str, str, int]] = []
        self.perder_respuesta_de: set[int] = set()
        self._puts = 0
        self._candado = threading.Lock()
        servidor = self

        class Manejador(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, *args):
                pass

            def _key(self):
                return unquote(self.path.split("?")[0]).lstrip("/").split("/", 1)[1]

            def _intento(self):
                return int(self.headers.get("amz-sdk-request", "attempt=1").split("=")[1].split(";")[0])

            def _xml(self, estado, codigo):
                cuerpo = f"<?xml version='1.0'?><Error><Code>{codigo}</Code><Message>{codigo}</Message></Error>".encode()
                self.send_response(estado)
                self.send_header("Content-Type", "application/xml")
                self.send_header("Content-Length", str(len(cuerpo)))
                self.end_headers()
                self.wfile.write(cuerpo)

            def do_PUT(self):
                cuerpo = self.rfile.read(int(self.headers.get("Content-Length") or 0))
                key = self._key()
                with servidor._candado:
                    servidor._puts += 1
                    n = servidor._puts
                    actual = servidor.objetos.get(key)
                    crear, tomar = self.headers.get("If-None-Match"), self.headers.get("If-Match")
                    if (crear == "*" and actual) or (tomar and (actual is None or actual[1] != tomar)):
                        servidor.bitacora.append(("PUT", key, "412", self._intento()))
                        return self._xml(412, "PreconditionFailed")
                    etag = f'"e{n}"'
                    servidor.objetos[key] = (cuerpo, etag)
                    perdida = n in servidor.perder_respuesta_de
                    servidor.bitacora.append(("PUT", key, "aplicado, respuesta perdida" if perdida else "aplicado",
                                              self._intento()))
                if perdida:
                    self.close_connection = True
                    self.connection.close()
                    return
                self.send_response(200)
                self.send_header("ETag", etag)
                self.send_header("Content-Length", "0")
                self.end_headers()

            def do_GET(self):
                key = self._key()
                actual = servidor.objetos.get(key)
                if actual is None:
                    servidor.bitacora.append(("GET", key, "404", self._intento()))
                    return self._xml(404, "NoSuchKey")
                servidor.bitacora.append(("GET", key, "200", self._intento()))
                self.send_response(200)
                self.send_header("ETag", actual[1])
                self.send_header("Content-Length", str(len(actual[0])))
                self.end_headers()
                self.wfile.write(actual[0])

        self.http = ThreadingHTTPServer(("127.0.0.1", 0), Manejador)
        self.http.daemon_threads = True
        threading.Thread(target=self.http.serve_forever, daemon=True).start()
        self.url = f"http://127.0.0.1:{self.http.server_address[1]}"

    def poner(self, key: str, texto: str) -> str:
        etag = f'"p{len(self.objetos) + 1}-{len(texto)}"'
        self.objetos[key] = (texto.encode("utf-8"), etag)
        return etag

    def texto(self, key: str) -> str:
        return self.objetos[key][0].decode("utf-8")


@pytest.fixture
def s3_http(monkeypatch):
    """botocore real apuntando al servidor de arriba, y `media_sync` usándolo (sin tocar sus funciones)."""
    import boto3
    from pipeline import media_sync
    servidor = _S3Http()
    for var in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"):
        monkeypatch.delenv(var, raising=False)
    monkeypatch.setenv("NO_PROXY", "127.0.0.1,localhost")
    monkeypatch.setenv("AWS_CONFIG_FILE", os.devnull)
    monkeypatch.setenv("AWS_SHARED_CREDENTIALS_FILE", os.devnull)
    cliente_s3 = boto3.client("s3", endpoint_url=servidor.url, region_name="us-east-1",
                              aws_access_key_id="x", aws_secret_access_key="x")
    monkeypatch.setattr(media_sync, "_s3", lambda: cliente_s3)
    monkeypatch.setattr(media_sync, "_bucket", lambda: "bkt")
    yield servidor
    servidor.http.shutdown()
    servidor.http.server_close()


def test_botocore_reintenta_un_put_condicional_aplicado_y_recibe_412(s3_http):
    """La premisa, con el cliente de verdad: la respuesta del PUT se pierde, botocore reintenta (intento 2) y el
    reintento recibe 412 aunque el primero escribió. Es lo que hay que sobrevivir."""
    from pipeline import media_sync
    s3_http.perder_respuesta_de = {1}
    assert media_sync.escribir_texto_si("k", "uno") is None          # parece que perdió…
    assert s3_http.texto("k") == "uno"                              # …pero escribió
    assert s3_http.bitacora == [("PUT", "k", "aplicado, respuesta perdida", 1), ("PUT", "k", "412", 2)]


def test_con_botocore_real_un_reclamo_creado_con_la_respuesta_perdida_sigue_siendo_nuestro(s3_http):
    import worker.imagen_generar as w
    s3_http.perder_respuesta_de = {1}
    key = w._key_reclamo("u1", IMAGEN_ID)
    assert w._reclamar(key, "mi-token") == {}                       # ganado, no perdido
    assert json.loads(s3_http.texto(key))["token"] == "mi-token"
    assert ("PUT", key, "412", 2) in s3_http.bitacora               # el 412 del reintento sí ocurrió


def test_con_botocore_real_la_toma_de_un_reclamo_vencido_con_la_respuesta_perdida_sigue_siendo_nuestra(s3_http):
    import worker.imagen_generar as w
    key = w._key_reclamo("u1", IMAGEN_ID)
    s3_http.poner(key, _reclamo(20 * 60, token="de-un-worker-muerto"))
    s3_http.perder_respuesta_de = {2}           # el PUT 1 es crear (412 de verdad); el 2 es la toma con If-Match
    previo = w._reclamar(key, "mi-token")
    assert previo is not None and previo["token"] == "de-un-worker-muerto"
    assert json.loads(s3_http.texto(key))["token"] == "mi-token"
    assert ("PUT", key, "412", 2) in s3_http.bitacora


def test_con_botocore_real_un_reclamo_reciente_ajeno_sigue_perdiendo(s3_http):
    import worker.imagen_generar as w
    key = w._key_reclamo("u1", IMAGEN_ID)
    s3_http.poner(key, _reclamo(30, token="otra-entrega"))
    assert w._reclamar(key, "mi-token") is None
    assert json.loads(s3_http.texto(key))["token"] == "otra-entrega"


def test_con_botocore_real_el_pedido_se_genera_aunque_el_reclamo_pierda_la_respuesta(
        s3_http, fal_imagen, monkeypatch):
    """De punta a punta con el worker real: lo que pasaba era «pedido cobrado, sin fal, sin devolución» —el
    worker salía callado— y ahora se genera como si nada."""
    from pipeline import costes_infra, creditos, media_sync
    import worker.imagen_generar as w
    monkeypatch.setenv("DEFAULT_USER_ID", "otro-usuario")
    monkeypatch.setattr(creditos, "activo", lambda: True)
    monkeypatch.setattr(creditos, "devolver_unica", lambda *a: pytest.fail("devolvió con una imagen buena"))
    monkeypatch.setattr(costes_infra, "registrar", lambda *a, **k: None)
    subidas = {}
    monkeypatch.setattr(media_sync, "subir_archivo", lambda local, key: subidas.__setitem__(key, Path(local).read_bytes()))
    s3_http.poner(CLAVE_DOC, json.dumps(_doc_worker()))
    s3_http.perder_respuesta_de = {1}                               # el PUT del reclamo
    w.generar("u1", IMAGEN_ID)
    assert len(fal_imagen.llamadas) == 1 and list(subidas) == ["imagenes/u1/abcdef012345.jpg"]
    assert json.loads(s3_http.texto(CLAVE_DOC))["estado"] == "listo"
    assert json.loads(s3_http.texto(RECLAMO))["token"]


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
    e = SimpleNamespace(w=w, devueltos=[], llamadas_devolver=[], infra=[], doc_al_devolver=[],
                        reclamo_al_devolver=[], devolver_roto=None, refs=set())

    def devolver_unica(n, ref, u=None):
        # lo que decía el doc y el reclamo en el instante de devolver: la devolución va ANTES del doc
        # `error` y DESPUÉS de marcar el fallo en el reclamo
        e.doc_al_devolver.append(json.loads(s3[CLAVE_DOC])["estado"] if CLAVE_DOC in s3 else None)
        e.reclamo_al_devolver.append(json.loads(s3[RECLAMO]) if RECLAMO in s3 else None)
        e.llamadas_devolver.append((n, ref, u))
        if e.devolver_roto:
            raise e.devolver_roto
        if ref in e.refs:                   # como la sentencia real: la misma referencia no abona dos veces
            return None
        e.refs.add(ref)
        e.devueltos.append((n, ref, u))
        return 100

    monkeypatch.setattr(creditos, "activo", lambda: True)
    monkeypatch.setattr(creditos, "devolver_unica", devolver_unica)
    monkeypatch.setattr(costes_infra, "registrar", lambda *a, **k: e.infra.append(a))
    return e


class _PgFalso:
    """El monedero de Postgres sin Postgres: cada `db.ejecutar` es UNA sentencia que se confirma sola, como en
    el Data API (no hay transacción entre una llamada y la siguiente). Solo entiende lo que usa el monedero.
    `fallos[n]`: la n-ésima sentencia falla `antes` de aplicarse o `despues`, con la respuesta perdida.
    El SQL de verdad se probó contra un Postgres 16 desechable; esto prueba lo que el worker hace con él."""

    def __init__(self):
        self.saldo: dict[str, int] = {}
        self.libro: list[tuple[str, int, str, str | None]] = []       # (usuario, créditos, tipo, referencia)
        self.usuarios: set[str] = set()
        self.sentencias: list[str] = []
        self.fallos: dict[int, str] = {}

    def __call__(self, sql, params=None):
        self.sentencias.append(sql)
        falla = self.fallos.get(len(self.sentencias))
        if falla == "antes":
            raise OSError("Data API caído")
        filas = self._aplicar(" ".join(sql.split()), params or {})
        if falla == "despues":
            raise OSError("se aplicó, pero la respuesta del Data API se perdió")
        return filas

    def _aplicar(self, sql, p):
        u, n = p.get("u"), p.get("n")
        if sql.startswith("INSERT INTO usuarios"):
            self.usuarios.add(u)
            return []
        if sql.startswith("WITH mov AS"):               # abonar_devolucion: libro y saldo en UNA sentencia
            if "NOT EXISTS" in sql and any(f[0] == u and f[2] == "devolucion" and f[3] == p["r"]
                                           for f in self.libro):
                return []
            self.libro.append((u, n, "devolucion", p["r"]))
            self.saldo[u] = self.saldo.get(u, 0) + n
            return [{"saldo": self.saldo[u]}]
        if sql.startswith("INSERT INTO monedero (user_id, saldo)"):         # abonar_creditos: primero el saldo…
            self.saldo[u] = self.saldo.get(u, 0) + n
            return [{"saldo": self.saldo[u]}]
        if sql.startswith("INSERT INTO monedero_movimientos"):              # …y luego, aparte, el libro
            self.libro.append((u, n, p["t"], p["r"]))
            return []
        raise AssertionError(f"sentencia que el monedero falso no conoce: {sql[:70]}")

    def devoluciones(self, user="u1") -> list[tuple[int, str]]:
        return [(n, r) for u, n, t, r in self.libro if u == user and t == "devolucion"]


@pytest.fixture
def pg(monkeypatch):
    from pipeline import db
    falso = _PgFalso()
    monkeypatch.setattr(db, "ejecutar", falso)
    return falso


@pytest.fixture
def worker_pg(monkeypatch, s3, fal_imagen, pg):
    """El worker con la devolución REAL (`creditos.devolver_unica` → `db.abonar_devolucion`) contra el
    monedero falso: lo que se defiende es el saldo y el libro, no que se llame a una función."""
    from pipeline import costes_infra, creditos
    import worker.imagen_generar as w
    monkeypatch.setenv("DEFAULT_USER_ID", "otro-usuario")
    monkeypatch.setattr(w, "PAUSA_ESCRITURA_S", 0)
    monkeypatch.setattr(creditos, "activo", lambda: True)
    monkeypatch.setattr(costes_infra, "registrar", lambda *a, **k: None)
    return SimpleNamespace(w=w)


def _doc_worker(**kw) -> dict:
    base = dict(creditos=7, modelo="flux3", aspecto="16:9", nombre="abcdef012345.jpg",
                prompt="un faro. Estilo X. No text, no watermark.")
    return _doc(**{**base, **kw})


def _reclamo(segundos_atras: float, **extra) -> str:
    return json.dumps({"reclamado": _iso(segundos_atras), **extra})


def _estados_escritos(s3) -> list[str]:
    """El estado de cada doc que se escribió, en orden (el reclamo no es un doc)."""
    return [e for e in s3.escrituras if e.endswith(".json")]


@pytest.mark.parametrize("nombre", ["../otro.jpg", "x/abcdef012345.jpg", "ABCDEF012345.jpg", "abcdef012345.png", ""])
def test_un_nombre_de_imagen_invalido_en_el_doc_no_llama_a_fal_ni_sube_y_devuelve_lo_cobrado(
        worker, s3, fal_imagen, nombre):
    """Solo el API escribe el doc, pero el worker no confía a ciegas en lo que sale de S3: un nombre que no sea
    el que fija el API (12 hex + .jpg) se trata como una generación fallida, no se usa para armar una ruta."""
    s3[CLAVE_DOC] = json.dumps(_doc_worker(nombre=nombre))

    worker.w.generar("u1", IMAGEN_ID)

    assert fal_imagen.llamadas == [] and s3.subidas == {}
    assert worker.devueltos == [(7, f"imagen:{IMAGEN_ID}", "u1")]
    assert json.loads(s3[CLAVE_DOC])["estado"] == "error"


def test_un_pedido_con_creditos_negativos_no_resta_saldo(worker, s3, fal_imagen):
    """`creditos` negativo en el doc se lee como 0 (nada cobrado): no se llama a devolver con un número que restaría."""
    s3[CLAVE_DOC] = json.dumps(_doc_worker(creditos=-5, nombre="../malo.jpg"))

    worker.w.generar("u1", IMAGEN_ID)

    assert worker.devueltos == []
    doc = json.loads(s3[CLAVE_DOC])
    assert doc["estado"] == "error" and doc["devuelto"] is True


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
    # el pedido se reclamó (con la hora y el token de esta invocación) antes de generar, y el PRIMER
    # reclamo es una escritura CONDICIONAL de crear (If-None-Match): sin eso dos entregas no se excluyen
    reclamo = json.loads(s3[RECLAMO])
    assert datetime.fromisoformat(reclamo["reclamado"]).tzinfo is not None
    assert re.fullmatch(r"[0-9a-f]{32}", reclamo["token"]) and "fallo" not in reclamo
    assert s3.condicionales == [(RECLAMO, None, True)]
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


def test_si_ni_siquiera_se_puede_escribir_el_doc_de_error_igual_se_devuelve_y_el_worker_levanta(
        worker, s3, fal_imagen, caplog):
    """Devolver va primero y es idempotente: con el doc sin poder escribirse la devolución ya está hecha y
    el worker LEVANTA, para que la reentrega escriba el doc (si el mensaje se borrara, el pedido quedaría
    en `generando` hasta que caduque, sin haber dicho nunca que falló)."""
    s3[CLAVE_DOC] = json.dumps(_doc_worker())
    fal_imagen.error = RuntimeError("boom")
    s3.escritura_rota = ".json"
    with caplog.at_level(logging.ERROR, logger="imagen_generar"):
        with pytest.raises(worker.w.DocNoEscrito, match="devuelto=True"):
            worker.w.generar("u1", IMAGEN_ID)
    assert worker.devueltos == [(7, f"imagen:{IMAGEN_ID}", "u1")]
    assert "no se pudo escribir el doc `error`" in caplog.text
    assert json.loads(s3[CLAVE_DOC])["estado"] == "generando"      # y el doc no cambió
    assert len(worker.infra) == 1                                   # el finally corre aunque levante


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


# --- el fallo queda MARCADO en el reclamo antes de devolver: ni la doble falla regenera

def test_el_fallo_queda_marcado_en_el_reclamo_antes_de_devolver_con_una_escritura_condicional(
        worker, s3, fal_imagen):
    s3[CLAVE_DOC] = json.dumps(_doc_worker())
    fal_imagen.error = RuntimeError("boom")
    worker.w.generar("u1", IMAGEN_ID)
    (reclamo,) = worker.reclamo_al_devolver                 # lo que decía el reclamo AL devolver
    assert reclamo["fallo"] is True and re.fullmatch(r"[0-9a-f]{32}", reclamo["token"])
    # crear el reclamo y marcarlo son escrituras condicionales; la marca lleva la etiqueta del reclamo
    crear, marcar = s3.condicionales
    assert crear == (RECLAMO, None, True) and marcar[0] == RECLAMO and marcar[1] and marcar[2]


def test_la_marca_del_fallo_se_reintenta_y_basta_con_que_una_escritura_salga(worker, s3, fal_imagen, monkeypatch):
    from pipeline import media_sync
    s3[CLAVE_DOC] = json.dumps(_doc_worker())
    fal_imagen.error = RuntimeError("boom")
    escribir_si = media_sync.escribir_texto_si
    marcas = []

    def escribir_si_con_mal_momento(key, texto, etag=None, tipo="application/json"):
        if etag is not None:                                # solo la marca lleva etiqueta aquí
            marcas.append(etag)
            if len(marcas) <= 2:
                raise OSError("S3 con un mal momento")
        return escribir_si(key, texto, etag=etag, tipo=tipo)

    monkeypatch.setattr(media_sync, "escribir_texto_si", escribir_si_con_mal_momento)
    worker.w.generar("u1", IMAGEN_ID)
    assert len(marcas) == 3 and json.loads(s3[RECLAMO])["fallo"] is True
    assert worker.reclamo_al_devolver[0]["fallo"] is True


def test_si_la_marca_se_aplico_pero_su_respuesta_se_perdio_no_se_escribe_otra_vez(worker, s3, fal_imagen):
    """Como el 412 del reintento de botocore: la marca (la 2ª condicional) SE APLICÓ y contestó que no.
    Se relee, se ve el `fallo` con nuestro token y se sigue: nada de una tercera escritura."""
    s3[CLAVE_DOC] = json.dumps(_doc_worker())
    fal_imagen.error = RuntimeError("boom")
    s3.condicional_aplicada_412 = {2}
    worker.w.generar("u1", IMAGEN_ID)
    assert len(s3.condicionales) == 2
    assert worker.reclamo_al_devolver[0]["fallo"] is True and len(worker.devueltos) == 1


def test_si_la_marca_no_sale_nunca_se_devuelve_igual_y_queda_en_el_log(worker, s3, fal_imagen, monkeypatch, caplog):
    """La marca es una red de seguridad: jamás impide devolver ni escribir el doc."""
    from pipeline import media_sync
    s3[CLAVE_DOC] = json.dumps(_doc_worker())
    fal_imagen.error = RuntimeError("boom")
    escribir_si = media_sync.escribir_texto_si

    def sin_marca(key, texto, etag=None, tipo="application/json"):
        if etag is not None:
            raise OSError("S3 con un mal momento")
        return escribir_si(key, texto, etag=etag, tipo=tipo)

    monkeypatch.setattr(media_sync, "escribir_texto_si", sin_marca)
    with caplog.at_level(logging.ERROR, logger="imagen_generar"):
        worker.w.generar("u1", IMAGEN_ID)                   # no levanta: devolvió y escribió el doc
    assert "el fallo no quedó marcado" in caplog.text
    assert worker.devueltos == [(7, f"imagen:{IMAGEN_ID}", "u1")]
    assert json.loads(s3[CLAVE_DOC])["devuelto"] is True


def test_la_marca_del_fallo_conserva_la_hora_del_reclamo(worker, s3):
    """Refrescarla retrasaría el vencimiento: si después ni siquiera se puede soltar el reclamo, la reentrega de
    los 15 min lo encontraría «reciente» y saldría en silencio (mensaje borrado, créditos sin devolver)."""
    s3.poner(RECLAMO, _reclamo(5 * 60, token="mio"))
    reclamado = json.loads(s3[RECLAMO])["reclamado"]
    worker.w._marcar_fallo(RECLAMO, "mio")
    assert json.loads(s3[RECLAMO]) == {"reclamado": reclamado, "token": "mio", "fallo": True}


def test_la_marca_del_fallo_no_pisa_un_reclamo_que_ya_es_de_otra_entrega(worker, s3):
    s3.poner(RECLAMO, _reclamo(1, token="otra-entrega"))
    antes = s3[RECLAMO]
    worker.w._marcar_fallo(RECLAMO, "mio")
    assert s3[RECLAMO] == antes and s3.condicionales == []         # ni siquiera escribió


def test_si_fal_falla_devolver_falla_y_el_doc_error_no_se_escribe_la_reentrega_no_regenera(worker, s3, fal_imagen):
    """El hueco que había: el doc se quedaba en `generando` con el reclamo soltado y la reentrega
    REGENERABA (otra llamada a fal, que cobra) en vez de solo devolver."""
    s3[CLAVE_DOC] = json.dumps(_doc_worker())
    fal_imagen.error = RuntimeError("boom")
    worker.devolver_roto = RuntimeError("Aurora caída")
    s3.escritura_rota = ".json"                             # el doc no se escribe; el reclamo sí
    with pytest.raises(RuntimeError, match="Aurora caída"):
        worker.w.generar("u1", IMAGEN_ID)
    assert json.loads(s3[CLAVE_DOC])["estado"] == "generando"
    reclamo = json.loads(s3[RECLAMO])
    assert reclamo["fallo"] is True and worker.w._reclamo_vencido(s3[RECLAMO])    # marcado y ya soltado

    # la reentrega, con Aurora y S3 de vuelta. Si regenerara, esta vez fal saldría bien
    fal_imagen.error = None
    worker.devolver_roto = None
    s3.escritura_rota = False
    worker.w.generar("u1", IMAGEN_ID)

    assert len(fal_imagen.llamadas) == 1 and s3.subidas == {}          # NO se regeneró
    assert worker.devueltos == [(7, f"imagen:{IMAGEN_ID}", "u1")]
    doc = json.loads(s3[CLAVE_DOC])
    assert (doc["estado"], doc["devuelto"], doc["error"]) == ("error", True, MENSAJE_ERROR)


def test_un_reclamo_vencido_marcado_con_fallo_nunca_regenera_aunque_el_doc_siga_generando(worker, s3, fal_imagen):
    s3[CLAVE_DOC] = json.dumps(_doc_worker())
    s3.poner(RECLAMO, _reclamo(20 * 60, token="de-la-entrega-anterior", fallo=True))
    worker.w.generar("u1", IMAGEN_ID)                       # fal saldría bien, pero no se llama
    assert fal_imagen.llamadas == [] and s3.subidas == {}
    assert worker.devueltos == [(7, f"imagen:{IMAGEN_ID}", "u1")]
    doc = json.loads(s3[CLAVE_DOC])
    assert (doc["estado"], doc["devuelto"], doc["error"]) == ("error", True, MENSAJE_ERROR)
    # lo contrario sí regenera: el mismo reclamo vencido SIN marca es el de un worker que murió generando
    assert not worker.w._reclamo_vencido(s3[RECLAMO])


def test_un_reclamo_reciente_marcado_con_fallo_lo_tiene_otra_entrega(worker, s3, fal_imagen):
    s3[CLAVE_DOC] = json.dumps(_doc_worker())
    s3.poner(RECLAMO, _reclamo(60, token="otra-entrega", fallo=True))
    antes = dict(s3)
    worker.w.generar("u1", IMAGEN_ID)
    assert fal_imagen.llamadas == [] and worker.devueltos == [] and dict(s3) == antes


def test_devolvio_pero_el_doc_error_no_se_pudo_escribir_la_reentrega_lo_escribe_sin_abonar_dos_veces(
        worker_pg, s3, fal_imagen, pg):
    """La devolución de verdad (`devolver_unica` contra el monedero falso): el saldo sube UNA vez y el doc que
    quedó sin escribir se escribe en la reentrega, que no regenera ni vuelve a abonar."""
    s3[CLAVE_DOC] = json.dumps(_doc_worker())
    fal_imagen.error = RuntimeError("boom")
    s3.escritura_rota = ".json"
    with pytest.raises(worker_pg.w.DocNoEscrito):
        worker_pg.w.generar("u1", IMAGEN_ID)
    assert pg.saldo == {"u1": 7} and pg.devoluciones() == [(7, f"imagen:{IMAGEN_ID}")]
    assert json.loads(s3[CLAVE_DOC])["estado"] == "generando"

    s3.escritura_rota = False
    worker_pg.w.generar("u1", IMAGEN_ID)                    # la reentrega

    assert pg.saldo == {"u1": 7} and len(pg.devoluciones()) == 1       # SIGUE en 7: no abonó otra vez
    assert len(fal_imagen.llamadas) == 1
    doc = json.loads(s3[CLAVE_DOC])
    assert (doc["estado"], doc["devuelto"], doc["error"]) == ("error", True, MENSAJE_ERROR)


def test_la_reentrega_que_devuelve_pero_no_puede_escribir_el_doc_deja_de_decir_que_no_devolvio_en_la_siguiente(
        worker_pg, s3, fal_imagen, pg):
    """Aurora se cae en la primera entrega (el doc dice `devuelto: false`). En la segunda vuelve Aurora y se cae
    S3: abona pero no puede cambiar el doc, que seguiría diciendo «no pudimos devolverte» con el saldo ya
    repuesto. Por eso levanta (a la DLQ si no hay una tercera) y la tercera cierra el doc con `devuelto: true`."""
    s3[CLAVE_DOC] = json.dumps(_doc_worker())
    fal_imagen.error = RuntimeError("boom")
    pg.fallos = {2: "antes"}                                # la sentencia del monedero de la 1ª entrega
    with pytest.raises(OSError, match="Data API caído"):
        worker_pg.w.generar("u1", IMAGEN_ID)
    assert json.loads(s3[CLAVE_DOC])["devuelto"] is False and pg.saldo == {}

    s3.escritura_rota = ".json"
    with pytest.raises(worker_pg.w.DocNoEscrito):
        worker_pg.w.generar("u1", IMAGEN_ID)                # abonó, pero el doc sigue igual
    assert pg.saldo == {"u1": 7}
    assert json.loads(s3[CLAVE_DOC])["devuelto"] is False

    s3.escritura_rota = False
    worker_pg.w.generar("u1", IMAGEN_ID)                    # la tercera
    assert pg.saldo == {"u1": 7} and len(pg.devoluciones()) == 1
    assert json.loads(s3[CLAVE_DOC])["devuelto"] is True and len(fal_imagen.llamadas) == 1


def test_sin_cobro_y_sin_poder_escribir_el_doc_error_tambien_levanta_y_la_reentrega_lo_escribe(worker, s3, fal_imagen):
    """Aunque no haya nada que devolver: con el doc en `generando` la reentrega regeneraría."""
    s3[CLAVE_DOC] = json.dumps(_doc_worker(creditos=0))
    fal_imagen.error = RuntimeError("boom")
    s3.escritura_rota = ".json"
    with pytest.raises(worker.w.DocNoEscrito):
        worker.w.generar("u1", IMAGEN_ID)
    s3.escritura_rota = False
    fal_imagen.error = None
    worker.w.generar("u1", IMAGEN_ID)
    assert len(fal_imagen.llamadas) == 1 and worker.devueltos == []
    doc = json.loads(s3[CLAVE_DOC])
    assert doc["estado"] == "error" and doc["error"] == "La imagen no se pudo generar. No se te cobró."


def test_el_hueco_que_queda_si_s3_no_deja_ni_marcar_el_fallo_la_reentrega_regenera(worker, s3, fal_imagen):
    """Lo ÚNICO que sigue sin cubrir, y está documentado (docs/OPERACION.md): S3 cae justo al fallar —ni la marca
    ni el doc ni soltar el reclamo se pueden escribir— y Aurora tampoco devuelve. La reentrega llega con el
    reclamo vencido, sin marca, y es indistinguible de un worker que murió generando: llama a fal otra vez.
    Si esto cambia, que sea a propósito."""
    s3[CLAVE_DOC] = json.dumps(_doc_worker())
    fal_imagen.error = RuntimeError("boom")
    worker.devolver_roto = RuntimeError("Aurora caída")

    def se_cae_s3():
        s3.escritura_rota = True
        s3.condicional_roto = True

    fal_imagen.al_llamar = se_cae_s3
    with pytest.raises(RuntimeError, match="Aurora caída"):
        worker.w.generar("u1", IMAGEN_ID)
    assert "fallo" not in json.loads(s3[RECLAMO]) and json.loads(s3[CLAVE_DOC])["estado"] == "generando"

    s3.escritura_rota = False
    s3.condicional_roto = False
    fal_imagen.al_llamar = None
    fal_imagen.error = None
    worker.devolver_roto = None
    s3.poner(RECLAMO, _reclamo(15 * 60))                    # la cola reentrega a los 15 min
    worker.w.generar("u1", IMAGEN_ID)
    assert len(fal_imagen.llamadas) == 2                    # regeneró: una llamada más a fal


# --- la devolución es idempotente: falle donde falle, el saldo sube UNA vez

@pytest.mark.parametrize("sentencia,como", [(1, "antes"), (2, "antes"), (2, "despues")],
                         ids=["cae-al-asegurar-al-usuario", "cae-antes-de-abonar", "abona-y-se-pierde-la-respuesta"])
def test_si_la_devolucion_falla_a_medias_la_reentrega_no_abona_dos_veces(
        worker_pg, s3, fal_imagen, pg, sentencia, como):
    """El abono del libro y el saldo van en UNA sentencia: o entran los dos o ninguno, y si ya entraron la
    reentrega no suma. Con las tres sentencias sueltas de `abonar_creditos`, un fallo entre el saldo y el
    libro dejaba el saldo sumado y la reentrega lo sumaba otra vez (14 por una imagen de 7)."""
    s3[CLAVE_DOC] = json.dumps(_doc_worker())
    fal_imagen.error = RuntimeError("boom")
    pg.fallos = {sentencia: como}
    with pytest.raises(OSError):
        worker_pg.w.generar("u1", IMAGEN_ID)
    doc = json.loads(s3[CLAVE_DOC])
    assert doc["estado"] == "error" and doc["devuelto"] is False and doc["error"] == SIN_DEVOLVER

    worker_pg.w.generar("u1", IMAGEN_ID)                    # la reentrega, con Aurora de vuelta

    assert pg.saldo == {"u1": 7}                            # exactamente lo cobrado
    assert pg.devoluciones() == [(7, f"imagen:{IMAGEN_ID}")]
    assert json.loads(s3[CLAVE_DOC])["devuelto"] is True and len(fal_imagen.llamadas) == 1
    worker_pg.w.generar("u1", IMAGEN_ID)                    # y una tercera no hace nada
    assert pg.saldo == {"u1": 7}


def test_el_worker_devuelve_con_devolver_unica_y_nunca_con_devolver(worker, s3, fal_imagen, monkeypatch):
    """`creditos.devolver` no es idempotente (otros llamadores repiten referencias a propósito): el worker de
    imágenes usa SOLO la única, con la referencia `imagen:<id>`, que no se repite entre pedidos."""
    from pipeline import creditos
    monkeypatch.setattr(creditos, "devolver", lambda *a, **k: pytest.fail("el worker debe usar devolver_unica"))
    s3[CLAVE_DOC] = json.dumps(_doc_worker())
    fal_imagen.error = RuntimeError("boom")
    worker.w.generar("u1", IMAGEN_ID)
    assert worker.llamadas_devolver == [(7, f"imagen:{IMAGEN_ID}", "u1")]


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


def test_un_412_del_reintento_de_botocore_sobre_el_reclamo_inicial_no_hace_perder_el_pedido(worker, s3, fal_imagen):
    """El PUT del reclamo SE APLICÓ, pero la respuesta se perdió; botocore reintentó y su reintento recibió
    412. Sin el token, el worker se creía perdedor de su PROPIO reclamo y salía en silencio: pedido cobrado,
    sin fal, sin devolución, mensaje borrado (ni DLQ ni alarma). Con el token lo lee y sigue."""
    s3[CLAVE_DOC] = json.dumps(_doc_worker())
    s3.condicional_aplicada_412 = {1}
    worker.w.generar("u1", IMAGEN_ID)
    assert len(fal_imagen.llamadas) == 1 and json.loads(s3[CLAVE_DOC])["estado"] == "listo"
    assert s3.condicionales == [(RECLAMO, None, True)]      # una sola condicional: se aplicó y se reconoció


def test_un_412_del_reintento_sobre_la_toma_de_un_reclamo_vencido_tampoco_lo_hace_perder(worker, s3, fal_imagen):
    """Lo mismo en la otra ruta: la 1ª condicional (crear) pierde de verdad, y la 2ª (If-Match, tomar el vencido)
    se aplica y contesta 412 al reintento: la etiqueta ya cambió."""
    s3[CLAVE_DOC] = json.dumps(_doc_worker())
    s3.poner(RECLAMO, _reclamo(20 * 60))
    s3.condicional_aplicada_412 = {2}
    worker.w.generar("u1", IMAGEN_ID)
    assert len(fal_imagen.llamadas) == 1 and json.loads(s3[CLAVE_DOC])["estado"] == "listo"
    assert [(k, e is None, ok) for k, e, ok in s3.condicionales] == [(RECLAMO, True, False), (RECLAMO, False, True)]


@pytest.mark.parametrize("ajeno", [{"token": "de-otra-entrega"}, {"token": ""}, {}],
                         ids=["token-ajeno", "token-vacio", "sin-token"])
def test_un_reclamo_reciente_con_otro_token_sigue_perdiendo(worker, s3, fal_imagen, ajeno):
    """El token solo reconoce lo PROPIO: un reclamo fresco de otra entrega (con su token, o de una versión
    anterior sin token) no se toma ni se confunde."""
    s3[CLAVE_DOC] = json.dumps(_doc_worker())
    s3.poner(RECLAMO, _reclamo(30, **ajeno))
    antes = dict(s3)
    worker.w.generar("u1", IMAGEN_ID)
    assert fal_imagen.llamadas == [] and worker.devueltos == [] and dict(s3) == antes


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


def _correr_entregas(worker, nombres):
    """Una entrega por hilo, cada uno con su nombre (`fal_imagen` lo anota); devuelve lo que levantaron."""
    errores = []

    def correr():
        try:
            worker.w.generar("u1", IMAGEN_ID)
        except BaseException as e:      # noqa: BLE001 — se reporta abajo, no se pierde en el hilo
            errores.append(e)

    hilos = [threading.Thread(target=correr, name=n) for n in nombres]
    [h.start() for h in hilos]
    [h.join(30) for h in hilos]
    assert not any(h.is_alive() for h in hilos), "una entrega se colgó"
    return errores


def _dos_entregas_a_la_vez(worker, s3, monkeypatch, estado_esperado, primera=None):
    """DOS copias del mismo mensaje corriendo a la vez. La barrera las obliga a leer el doc ANTES de que
    cualquiera escriba: es la ventana del «leo, veo `generando`, genero» sin escritura condicional.
    `primera` es el nombre de la entrega que llega PRIMERO al reclamo (la otra espera a que esa lo haya
    escrito): así se sabe QUIÉN gana y la prueba puede afirmarlo."""
    from pipeline import media_sync
    barrera = threading.Barrier(2)
    leer = media_sync.leer_texto
    escribir_si = media_sync.escribir_texto_si
    reclamo_escrito = threading.Event()

    def leer_juntas(key):
        v = leer(key)
        if key == CLAVE_DOC:
            barrera.wait(timeout=10)
        return v

    def escribir_si_en_orden(key, texto, etag=None, tipo="application/json"):
        if threading.current_thread().name != primera:
            assert reclamo_escrito.wait(timeout=10), "la entrega que iba primero nunca reclamó"
        r = escribir_si(key, texto, etag=etag, tipo=tipo)
        reclamo_escrito.set()
        return r

    monkeypatch.setattr(media_sync, "leer_texto", leer_juntas)
    if primera:
        monkeypatch.setattr(media_sync, "escribir_texto_si", escribir_si_en_orden)
    assert _correr_entregas(worker, ["entrega-buena", "entrega-mala"]) == []
    assert json.loads(s3[CLAVE_DOC])["estado"] == estado_esperado


def test_dos_entregas_a_la_vez_que_fallan_devuelven_UNA_sola_vez(worker, s3, fal_imagen, monkeypatch):
    s3[CLAVE_DOC] = json.dumps(_doc_worker())
    fal_imagen.error = RuntimeError("rechazo de contenido")
    _dos_entregas_a_la_vez(worker, s3, monkeypatch, "error")
    assert worker.devueltos == [(7, f"imagen:{IMAGEN_ID}", "u1")]
    assert len(fal_imagen.llamadas) == 1                    # y fal tampoco se pagó dos veces
    assert len(worker.infra) == 1                           # la que perdió el reclamo no anotó nada


@pytest.mark.parametrize("primera,estado,devoluciones", [
    ("entrega-buena", "listo", 0),
    ("entrega-mala", "error", 1),
], ids=["gana-la-buena", "gana-la-mala"])
def test_dos_entregas_a_la_vez_gana_la_que_llega_primero_y_solo_cuenta_su_resultado(
        worker, s3, fal_imagen, monkeypatch, primera, estado, devoluciones):
    """Una entrega saldría bien y la otra mal; se fuerza cuál llega primero al reclamo y se afirma que ESA es la
    que llama a fal y que su resultado es el único. Sin reclamo, la buena dejaba la imagen en la galería y la
    mala la marcaba `error` y devolvía los créditos: imagen gratis y un doc que miente."""
    s3[CLAVE_DOC] = json.dumps(_doc_worker())
    fal_imagen.por_hilo = {"entrega-buena": None, "entrega-mala": RuntimeError("rechazo")}
    _dos_entregas_a_la_vez(worker, s3, monkeypatch, estado, primera=primera)
    assert [ll.hilo for ll in fal_imagen.llamadas] == [primera]     # fal solo lo llamó quien ganó
    assert len(worker.devueltos) == devoluciones
    assert len(s3.subidas) == (1 if estado == "listo" else 0)
    assert _estados_escritos(s3) == [CLAVE_DOC]             # un solo doc escrito, una sola vez
    # solo los intentos de CREAR el reclamo (sin etiqueta): la marca de fallo de la ganadora (If-Match con su
    # etag) se registra antes o después del intento rechazado de la otra según quién corra primero, y comparar
    # las dos primeras entradas sin filtrar hacía la prueba intermitente (3 de 100 corridas en paralelo)
    assert [(k, e, ok) for k, e, ok in s3.condicionales if e is None] == [(RECLAMO, None, True), (RECLAMO, None, False)]


def test_dos_entregas_que_leen_el_mismo_reclamo_vencido_solo_una_lo_toma(worker, s3, fal_imagen, monkeypatch):
    """La barrera está en la lectura del reclamo con su etiqueta: las dos ven el MISMO reclamo vencido antes de
    que cualquiera escriba. La etiqueta vieja solo le sirve a la primera; sin If-Match las dos lo tomarían y las
    dos llamarían a fal."""
    from pipeline import media_sync
    s3[CLAVE_DOC] = json.dumps(_doc_worker())
    s3.poner(RECLAMO, _reclamo(20 * 60))
    barrera = threading.Barrier(2)
    leer_con_etag = media_sync.leer_texto_con_etag
    ya_leyeron = set()

    def leer_juntas(key):
        visto = leer_con_etag(key)
        if threading.current_thread().name not in ya_leyeron:      # solo la PRIMERA lectura de cada una
            ya_leyeron.add(threading.current_thread().name)
            barrera.wait(timeout=10)
        return visto

    monkeypatch.setattr(media_sync, "leer_texto_con_etag", leer_juntas)
    assert _correr_entregas(worker, ["entrega-1", "entrega-2"]) == []
    assert len(fal_imagen.llamadas) == 1 and json.loads(s3[CLAVE_DOC])["estado"] == "listo"
    assert len([c for c in s3.condicionales if c[2]]) == 1          # una sola toma ganó


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

    monkeypatch.setattr(creditos, "devolver_unica", lambda *a: pytest.fail("devolvió con una imagen buena"))
    worker.w.generar(USER, imagen_id)

    ficha = cliente.get(f"/api/imagenes/pedidos/{imagen_id}").json()
    assert ficha["estado"] == "listo" and NOMBRE_RE.match(ficha["nombre"])
    assert ficha["url"] == f"/api/imagenes/{ficha['nombre']}"
    assert list(s3.subidas) == [f"imagenes/{USER}/{ficha['nombre']}"]
    (ll,) = fal_imagen.llamadas
    assert ll.kw["aspecto"] == "9:16" and ll.kw["modelo"] == "flux3"
    d = cliente.get("/api/imagenes").json()
    assert d["pendientes"] == [] and d["pendientes_ok"] is True
    assert [i["nombre"] for i in d["imagenes"]] == [ficha["nombre"]]


# ---------------------------------------------------------------------------
# «Tus trabajos» (/api/trabajos): las imágenes en segundo plano, como los clips

def _ficha_trabajo(doc, ref="img-1", ahora=None):
    from server import trabajos_api
    return trabajos_api.ficha_s3("imagen", ref, doc, ahora or datetime.now(timezone.utc).timestamp())


def test_trabajos_una_imagen_generandose_es_un_trabajo_en_curso():
    from server import trabajos_api
    f = _ficha_trabajo(_doc(edad_s=60, texto="un faro de noche"))
    assert (f["tipo"], f["estado"], f["titulo"], f["detalle"], f["url"]) == (
        "imagen", "corriendo", "Generando tu imagen", "un faro de noche", trabajos_api.URL_IMAGEN)


@pytest.mark.parametrize("doc", [
    _doc(edad_s=60), _doc("listo", edad_s=120, listo=_iso(30)),
    _doc("error", edad_s=120, listo=_iso(30), error="x"), _doc(edad_s=50 * 60)],
    ids=["corriendo", "listo", "error", "caducado"])
def test_trabajos_la_ficha_de_una_imagen_lleva_a_la_pagina_de_la_caja_en_imagen_donde_mis_creaciones_la_ensena(doc):
    """El «Ver» llevaba a /imagenes.html, que es el formulario de crear, vacío: ni la imagen ni el error. «Mis
    creaciones» solo existe en la Caja, y la Caja vive en una página por pestaña (una dirección por herramienta):
    la de Imagen. No es /estudio/ (la principal, «Elige un área», sin Caja) ni la página única de antes."""
    from server import migracion, trabajos_api
    f = _ficha_trabajo(doc)
    assert f["url"] == trabajos_api.URL_IMAGEN == "/estudio/marketing/distrito/imagen/"
    assert f["url"] not in ("/imagenes.html", migracion.PANTALLAS["imagenes"].nueva, "/estudio/", "/estudio/inicio/")


def test_trabajos_url_imagen_es_una_pagina_que_existe_y_es_la_de_la_caja_en_imagen():
    """Si `URL_IMAGEN` se desfasara de las páginas que genera web/src/marca/paginas.ts (se renombra el grupo, se
    mueve la herramienta, se confunde con la de Video), el «Ver» de una imagen terminada llevaría a un 404 o a una
    Caja en otra pestaña, y ninguna otra prueba lo vería: las fichas solo comparan contra la constante. Aquí se ata
    a la página compilada de verdad: el index.html de esa carpeta existe, monta la Caja y su título dice Imagen."""
    from server import trabajos_api
    url = trabajos_api.URL_IMAGEN
    assert url.startswith("/estudio/") and url.endswith("/")
    pagina = RAIZ / "web" / url.strip("/") / "index.html"
    assert pagina.is_file(), f"URL_IMAGEN = {url}, y no existe {pagina.relative_to(RAIZ)}"
    html = pagina.read_text(encoding="utf-8")
    assert '<script type="module" src="/src/pantallas/inicio/herramienta.tsx"></script>' in html, \
        "esa página no monta la Caja (herramienta.tsx): ahí «Mis creaciones» no enseñaría el pedido"
    assert re.search(r"<title>[^<]*· Imagen</title>", html), "esa página no es la de la pestaña Imagen"


def test_trabajos_js_enlaza_a_esa_ruta_y_no_la_repite_en_la_pantalla_que_ya_la_ensena():
    """static/trabajos.js pinta la URL de la ficha tal cual en un <a href> y oculta la ficha en la pantalla a la
    que apunta (`deEstaPantalla`): en la Caja, en CUALQUIERA de sus tres pestañas (Imagen, Video y Edición son la
    misma pantalla con tres direcciones, y «Mis creaciones» se ve en las tres), no repite lo que «Mis creaciones» ya
    dice, ni su «Ver» carga otra página que descartaría lo escrito; en cualquier otra (estilos, clip, el mapa, la
    lista de Distrito…) el «Ver» lleva a esa página."""
    node = shutil.which("node")
    if not node:
        pytest.skip("node no está instalado")
    codigo = (RAIZ / "static" / "trabajos.js").read_text(encoding="utf-8")
    assert 'href="${esc(t.url)}"' in codigo
    guion = codigo + """
const P = globalThis.trabajosPuro;
const L = [{id: 'imagen:img-1', estado: 'listo', url: '/estudio/marketing/distrito/imagen/'},
           {id: 'clip:1', estado: 'listo', url: '/clip.html'}];
const en = p => P.visibles(L, {}, {origin: 'http://x', pathname: p, search: ''}).map(t => t.id);
const c = '/estudio/marketing/distrito/';
console.log(JSON.stringify({estilos: en('/estilos.html'), caja: en(c + 'imagen/'), video: en(c + 'video/'),
                            edicion: en(c + 'edicion/'), lista: en(c), otra: en(c + 'imagenx/'), mapa: en('/estudio/')}));
"""
    r = subprocess.run([node, "-e", guion], capture_output=True, text=True, encoding="utf-8")
    assert r.returncode == 0, r.stderr
    assert json.loads(r.stdout) == {"estilos": ["imagen:img-1", "clip:1"], "caja": ["clip:1"], "video": ["clip:1"],
                                    "edicion": ["clip:1"], "lista": ["imagen:img-1", "clip:1"],
                                    "otra": ["imagen:img-1", "clip:1"], "mapa": ["imagen:img-1", "clip:1"]}


def test_trabajos_no_lista_el_historial_de_imagenes_ni_lee_los_reclamos(cliente, nube, s3, monkeypatch):
    """Cada carga del cuadro y cada sondeo de 15 s pagaban un LIST de TODO el prefijo (un .json y un .reclamo por
    pedido, para siempre). Ahora usa lo mismo que «Mis creaciones»: los ids de hoy y de ayer, y solo abre los
    más nuevos."""
    from pipeline import db, media_sync
    from server import imagen_cola
    ahora = datetime.now(timezone.utc)
    monkeypatch.setattr(db, "backend", lambda: "postgres")
    monkeypatch.setattr(db, "proyectos_recientes", lambda user, horas: [])
    monkeypatch.setattr(db, "corridas_editor", lambda user: [])
    for dias in range(3, 400, 3):                          # un año de historial: un doc y un .reclamo por pedido
        viejo = ahora - timedelta(days=dias)
        _poner(s3, _id(5, ahora=viejo), _doc("listo", listo=_iso(0)))
        s3[f"usuarios/{USER}/imagenes-pedidos/{_id(5, ahora=viejo)}.reclamo"] = _reclamo(0)
    _poner(s3, _id(30), _doc(texto="la de hoy", edad_s=30))
    s3[f"usuarios/{USER}/imagenes-pedidos/{_id(30)}.reclamo"] = _reclamo(30)
    listados_con_fecha = []
    monkeypatch.setattr(media_sync, "listar_prefijo_con_fecha",
                        lambda prefijo: listados_con_fecha.append(prefijo) or [])
    r = cliente.get("/api/trabajos")
    assert r.status_code == 200, r.text
    assert [t["detalle"] for t in r.json()["trabajos"] if t["tipo"] == "imagen"] == ["la de hoy"]
    # el prefijo entero de pedidos no se lista; solo los de hoy y de ayer, y de ahí solo los .json
    assert f"usuarios/{USER}/imagenes-pedidos/" not in listados_con_fecha
    assert s3.prefijos == [f"usuarios/{USER}/imagenes-pedidos/img-{ahora:%Y%m%d}",
                           f"usuarios/{USER}/imagenes-pedidos/img-{ahora - timedelta(days=1):%Y%m%d}"]
    assert s3.lecturas and len(s3.lecturas) <= imagen_cola.MAX_PENDIENTES
    assert all(k.endswith(".json") for k in s3.lecturas)


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
    f = _ficha_trabajo(_doc(edad_s=50 * 60))
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
