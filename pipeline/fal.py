"""Cliente fal con semáforo, timeout y span en Langfuse."""
from __future__ import annotations

import asyncio
import threading
import time
import weakref
from pathlib import Path

import fal_client
import httpx
from langfuse import get_client

from .config import settings
from .pricing import costo_fal, unidades_fal

# Un worker tibio hace `asyncio.run()` en cada invocación, y lo que se ata a un event loop
# no sirve en el siguiente. Dos cosas se ataban al de la primera corrida:
#  · fal_client guarda UN httpx.AsyncClient global (`fal_client.async_client`): la conexión
#    keep-alive que quedó en su pool es de un loop ya cerrado y la siguiente invocación
#    falla con «Event loop is closed» (ok, FALLO, ok, FALLO);
#  · el semáforo, que con más llamadas que cupos se ata al loop donde hubo espera y en el
#    siguiente lanza «is bound to a different event loop».
# Por eso hay un cliente y un semáforo POR event loop. Bajo Mangum el loop es uno y persiste,
# así que ahí se reutilizan los mismos (con su pool de conexiones).
_clientes: "weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, fal_client.AsyncClient]" = (
    weakref.WeakKeyDictionary())
_semaforos: "weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, asyncio.Semaphore]" = (
    weakref.WeakKeyDictionary())
_candado = threading.Lock()     # varios hilos pueden correr su propio asyncio.run a la vez


def _del_loop(guardado: weakref.WeakKeyDictionary, crear):
    """Lo guardado para el event loop en ejecución; se crea la primera vez que se pide.
    Lo que se guardó para un loop referencia a ese loop (el pool de conexiones, la espera
    del semáforo), así que la clave débil sola no lo suelta: los loops ya cerrados se
    sacan aquí, y no se acumula uno por invocación."""
    loop = asyncio.get_running_loop()
    with _candado:
        for viejo in [lp for lp in guardado if lp.is_closed()]:
            del guardado[viejo]
        if loop not in guardado:
            guardado[loop] = crear()
        return guardado[loop]


def cliente() -> "fal_client.AsyncClient":
    """El cliente de fal del event loop en ejecución. Solo se llama desde código async."""
    return _del_loop(_clientes, fal_client.AsyncClient)


def semaforo() -> asyncio.Semaphore:
    """El tope de llamadas simultáneas a fal del event loop en ejecución."""
    return _del_loop(_semaforos, lambda: asyncio.Semaphore(settings.fal_concurrency))


class FalError(RuntimeError):
    pass


async def llamar(app: str, argumentos: dict, timeout_s: int, nombre: str, meta: dict | None = None) -> dict:
    """subscribe (submit + poll) con timeout por llamada. Lanza FalError en fallo/timeout."""
    lf = get_client()
    # as_type="generation": Langfuse solo agrega costes al trace desde generations (no desde spans)
    with lf.start_as_current_observation(
        name=nombre, as_type="generation", model=app, input=_resumir(argumentos), metadata={"app": app, **(meta or {})}
    ) as span:
        t0 = time.monotonic()
        async with semaforo():
            try:
                res = await asyncio.wait_for(cliente().subscribe(app, arguments=argumentos), timeout=timeout_s)
            except asyncio.TimeoutError as e:
                span.update(level="ERROR", status_message=f"timeout {timeout_s}s")
                raise FalError(f"{app}: timeout tras {timeout_s}s") from e
            except Exception as e:  # noqa: BLE001
                span.update(level="ERROR", status_message=str(e)[:500])
                raise FalError(f"{app}: {e}") from e
        costo = costo_fal(app, argumentos)
        span.update(
            output=res,
            metadata={"segundos": round(time.monotonic() - t0, 1), "costo_usd": costo},
            usage_details=unidades_fal(app, argumentos),
            cost_details={"total": costo} if costo is not None else None,
        )
        return res


def _resumir(args: dict) -> dict:
    """No mandar data-URIs gigantes a Langfuse."""
    out = {}
    for k, v in args.items():
        if isinstance(v, str) and v.startswith("data:"):
            out[k] = f"[data-uri {len(v)} chars]"
        elif isinstance(v, list):
            out[k] = [f"[data-uri]" if isinstance(x, str) and x.startswith("data:") else x for x in v]
        else:
            out[k] = v
    return out


async def descargar(url: str, destino: Path) -> Path:
    destino.parent.mkdir(parents=True, exist_ok=True)
    async with httpx.AsyncClient(timeout=120, follow_redirects=True) as c:
        r = await c.get(url)
        r.raise_for_status()
        destino.write_bytes(r.content)
    return destino


async def subir_archivo(path: Path) -> str:
    """Sube un archivo local al CDN de fal y devuelve su URL (para referencias generadas en local)."""
    return await cliente().upload_file(str(path))
