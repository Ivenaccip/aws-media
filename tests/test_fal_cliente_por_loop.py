"""fal por event loop — el «Event loop is closed» de un worker tibio.

`fal_client` guarda UN httpx.AsyncClient global (`fal_client.async_client`) que se ata al event
loop de la primera corrida. Un worker Lambda tibio hace `asyncio.run()` en cada invocación (imagen,
clip, MIX, overlay…): la conexión keep-alive que quedó en el pool es de un loop ya cerrado y la
siguiente invocación falla. Se reprodujo como ok / FALLO / ok / FALLO. El semáforo de
`pipeline/fal.py` tenía el mismo defecto: con más llamadas que cupos se ata al loop donde hubo
espera y en el siguiente lanza «is bound to a different event loop».

Lo que se defiende aquí: un cliente (y un semáforo) POR event loop en ejecución, el mismo mientras el
loop vive (Mangum), y que `llamar` y `subir_archivo` pasen por él. La prueba de punta a punta corre en
un proceso aparte contra un fal falso local (el guardián de la suite bloquea toda red en el proceso de
pytest): sin la corrección, la segunda invocación falla.
"""
import asyncio
import json
import os
import subprocess
import sys
import threading
from contextlib import nullcontext
from pathlib import Path
from types import SimpleNamespace

import pytest

RAIZ = Path(__file__).resolve().parent.parent


@pytest.fixture
def fal(monkeypatch):
    from pipeline import fal as modulo
    monkeypatch.setattr(modulo, "_clientes", type(modulo._clientes)())
    monkeypatch.setattr(modulo, "_semaforos", type(modulo._semaforos)())
    return modulo


class _ClienteQueSabeSuLoop:
    """Como el de fal_client: lo que guarda (el pool de conexiones) referencia al loop que lo creó."""

    def __init__(self):
        self.loop = asyncio.get_running_loop()
        self.llamadas: list[tuple] = []

    async def subscribe(self, application, arguments=None, **kw):
        self.llamadas.append(("subscribe", application, arguments))
        await asyncio.sleep(0)                       # se suspende: las demás llamadas esperan el cupo
        return {"images": [{"url": "https://fal.invalid/x.jpg"}]}

    async def upload_file(self, path):
        self.llamadas.append(("upload_file", path))
        return "https://cdn.fal.invalid/x.jpg"


@pytest.fixture
def falso(fal, monkeypatch):
    """`fal_client.AsyncClient` falso (anota cada instancia) y Langfuse sin red."""
    creados: list[_ClienteQueSabeSuLoop] = []

    def crear():
        creados.append(_ClienteQueSabeSuLoop())
        return creados[-1]

    class _Langfuse:
        def start_as_current_observation(self, **kw):
            return nullcontext(SimpleNamespace(update=lambda **k: None))

    monkeypatch.setattr(fal, "fal_client", SimpleNamespace(AsyncClient=crear))
    monkeypatch.setattr(fal, "get_client", lambda: _Langfuse())
    return creados


async def _cliente(fal):
    return fal.cliente()


def test_dos_asyncio_run_seguidos_no_comparten_cliente(fal):
    import fal_client
    a = asyncio.run(_cliente(fal))
    b = asyncio.run(_cliente(fal))
    assert a is not b                                # el segundo loop no hereda el pool del primero
    assert isinstance(a, fal_client.AsyncClient) and isinstance(b, fal_client.AsyncClient)


def test_dentro_del_mismo_loop_se_reutiliza_el_mismo_cliente(fal):
    async def dos_veces():
        return fal.cliente(), fal.cliente(), fal.semaforo(), fal.semaforo()

    c1, c2, s1, s2 = asyncio.run(dos_veces())
    assert c1 is c2 and s1 is s2


def test_bajo_mangum_el_loop_persiste_y_el_cliente_tambien(fal):
    """Un loop que sigue vivo entre invocaciones (Mangum) conserva su cliente y su pool."""
    loop = asyncio.new_event_loop()
    try:
        a = loop.run_until_complete(_cliente(fal))
        b = loop.run_until_complete(_cliente(fal))
    finally:
        loop.close()
    assert a is b


def test_dos_loops_vivos_a_la_vez_en_hilos_distintos_tienen_cada_uno_el_suyo(fal):
    barrera = threading.Barrier(2)
    vistos: dict[int, tuple] = {}

    async def corrida(n):
        antes = fal.cliente()
        barrera.wait(timeout=10)                      # los dos loops están vivos al mismo tiempo
        await asyncio.sleep(0)
        vistos[n] = (antes, fal.cliente(), fal.semaforo())

    hilos = [threading.Thread(target=lambda n=n: asyncio.run(corrida(n))) for n in (1, 2)]
    [h.start() for h in hilos]
    [h.join(30) for h in hilos]
    assert set(vistos) == {1, 2}
    assert all(antes is despues for antes, despues, _ in vistos.values())    # estable dentro de su loop
    assert vistos[1][0] is not vistos[2][0] and vistos[1][2] is not vistos[2][2]


def test_los_loops_cerrados_no_se_acumulan(fal, falso):
    """El cliente referencia a su loop (como el pool de httpx), así que la clave débil sola no lo
    suelta: sin sacar los cerrados, cada invocación del worker dejaría uno más en memoria."""
    for _ in range(6):
        asyncio.run(_cliente(fal))
    assert len(falso) == 6
    assert len(fal._clientes) <= 1                   # a lo sumo el de la última corrida


def test_los_semaforos_de_loops_cerrados_tampoco_se_acumulan(fal, falso):
    """Un `asyncio.Semaphore` que ESPERÓ guarda su loop con referencia fuerte, así que la clave débil sola no lo
    suelta: sin la purga de `_del_loop` en `semaforo()`, cada invocación del worker con más llamadas que cupos
    dejaría un loop cerrado (y todo lo suyo) en memoria. Antes de esta prueba solo se miraba `_clientes`."""
    n = fal.settings.fal_concurrency + 2

    async def muchas():
        return await asyncio.gather(*[
            fal.llamar("fal-ai/flux/dev", {"prompt": str(i)}, timeout_s=5, nombre="prueba")
            for i in range(n)])

    for _ in range(10):
        assert len(asyncio.run(muchas())) == n
    assert len(fal._semaforos) <= 1 and len(fal._clientes) <= 1


def test_varios_hilos_con_su_propio_asyncio_run_no_se_pisan_al_purgar_loops_cerrados(fal, falso):
    """El API tiene endpoints `def` que corren en el threadpool y hacen `asyncio.run` (server/overlays_api.py):
    dos hilos purgan a la vez el MISMO loop cerrado. Sin el `threading.Lock` de `_del_loop` uno revienta con
    KeyError («del guardado[viejo]») o con «dictionary changed size during iteration», dentro de `llamar` y
    con la imagen ya cobrada. La ventana es de microsegundos: con el intervalo de cambio de hilo por defecto
    (5 ms) casi nunca se ve, así que se estrecha para que la carrera salga siempre."""
    errores: list[BaseException] = []

    async def una():
        fal.cliente()
        fal.semaforo()
        await asyncio.sleep(0)
        fal.cliente()
        fal.semaforo()

    def hilo():
        try:
            for _ in range(100):
                asyncio.run(una())
        except BaseException as e:      # noqa: BLE001 — se reporta abajo, no se pierde en el hilo
            errores.append(e)

    antes = sys.getswitchinterval()
    sys.setswitchinterval(1e-6)
    try:
        hilos = [threading.Thread(target=hilo) for _ in range(8)]
        [h.start() for h in hilos]
        [h.join(120) for h in hilos]
    finally:
        sys.setswitchinterval(antes)
    assert not any(h.is_alive() for h in hilos), "un hilo se colgó"
    assert errores == [], f"{len(errores)} hilos reventaron: {errores[:2]!r}"
    assert len(fal._clientes) <= 8 and len(fal._semaforos) <= 8      # a lo sumo los loops que sigan vivos


def test_llamar_y_subir_archivo_pasan_por_el_cliente_del_loop(fal, falso, tmp_path):
    async def uso():
        res = await fal.llamar("fal-ai/flux/dev", {"prompt": "un faro"}, timeout_s=5, nombre="prueba")
        url = await fal.subir_archivo(tmp_path / "a.jpg")
        return res, url

    for _ in range(2):
        res, url = asyncio.run(uso())
        assert res == {"images": [{"url": "https://fal.invalid/x.jpg"}]}
        assert url == "https://cdn.fal.invalid/x.jpg"
    assert len(falso) == 2                           # un cliente por asyncio.run, no uno global
    for cliente in falso:
        assert [c[0] for c in cliente.llamadas] == ["subscribe", "upload_file"]
        assert cliente.llamadas[0][1:] == ("fal-ai/flux/dev", {"prompt": "un faro"})
        assert cliente.llamadas[1][1] == str(tmp_path / "a.jpg")


def test_el_semaforo_no_queda_atado_al_loop_de_la_primera_corrida(fal, falso):
    """Más llamadas que cupos: las que sobran esperan, y esa espera ata un asyncio.Semaphore a su loop.
    En el siguiente asyncio.run (otro loop) el semáforo global reventaba."""
    n = fal.settings.fal_concurrency + 2

    async def muchas():
        return await asyncio.gather(*[
            fal.llamar("fal-ai/flux/dev", {"prompt": str(i)}, timeout_s=5, nombre="prueba")
            for i in range(n)])

    for _ in range(3):
        assert len(asyncio.run(muchas())) == n


# ---------------------------------------------------------------------------
# punta a punta: un fal falso local con keep-alive, varias invocaciones con asyncio.run

GUION = r'''
import asyncio, json, os, sys, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, sys.argv[1])
os.environ["FAL_KEY"] = "falsa:falsa"
os.environ["LANGFUSE_TRACING_ENABLED"] = "false"
for k in ("LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY"):
    os.environ.pop(k, None)


class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"          # keep-alive: la conexión queda en el pool entre invocaciones

    def log_message(self, *a):
        pass

    def _enviar(self, cuerpo):
        b = json.dumps(cuerpo).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def do_POST(self):
        self.rfile.read(int(self.headers.get("Content-Length") or 0))
        base = f"http://127.0.0.1:{PORT}/" + self.path.lstrip("/") + "/requests/r1"
        self._enviar({"request_id": "r1", "response_url": base, "status_url": base + "/status",
                      "cancel_url": base + "/cancel"})

    def do_GET(self):
        if "/status" in self.path:
            return self._enviar({"status": "COMPLETED", "logs": [], "metrics": {}})
        self._enviar({"images": [{"url": "https://fal.invalid/x.jpg"}]})


srv = ThreadingHTTPServer(("127.0.0.1", 0), H)
PORT = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()

import fal_client.client as fc
fc.QUEUE_URL_FORMAT = f"http://127.0.0.1:{PORT}/"
from pipeline import fal

resultados = []
for i in range(int(sys.argv[2])):
    try:
        res = asyncio.run(fal.llamar("fal-ai/flux/dev", {"prompt": "un faro"}, timeout_s=20, nombre="prueba"))
        resultados.append("ok" if res.get("images") else f"sin imagenes: {res}")
    except BaseException as e:
        resultados.append(f"FALLO {type(e).__name__}: {e}")
print("RESULTADOS " + json.dumps(resultados))
'''


def test_varias_invocaciones_seguidas_con_asyncio_run_salen_todas_bien(tmp_path):
    """Antes: ok, FALLO («Event loop is closed»), ok, FALLO. Ahora: todas bien."""
    guion = tmp_path / "invocaciones.py"
    guion.write_text(GUION, encoding="utf-8")
    env = {k: v for k, v in os.environ.items()
           if k.upper() not in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY")}
    env["NO_PROXY"] = "127.0.0.1,localhost"
    r = subprocess.run([sys.executable, str(guion), str(RAIZ), "4"], cwd=tmp_path, env=env,
                       capture_output=True, text=True, encoding="utf-8", timeout=180)
    linea = [x for x in r.stdout.splitlines() if x.startswith("RESULTADOS ")]
    assert linea, f"el guion no terminó:\n{r.stdout}\n{r.stderr[-2000:]}"
    assert json.loads(linea[0].removeprefix("RESULTADOS ")) == ["ok"] * 4
