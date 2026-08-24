"""Cliente fal con semáforo, timeout y span en Langfuse."""
from __future__ import annotations

import asyncio
import time
from pathlib import Path

import fal_client
import httpx
from langfuse import get_client

from .config import settings
from .pricing import costo_fal, unidades_fal

_sem: asyncio.Semaphore | None = None


def semaforo() -> asyncio.Semaphore:
    global _sem
    if _sem is None:
        _sem = asyncio.Semaphore(settings.fal_concurrency)
    return _sem


class FalError(RuntimeError):
    pass


async def llamar(app: str, argumentos: dict, timeout_s: int, nombre: str, meta: dict | None = None) -> dict:
    """subscribe_async (submit + poll) con timeout por llamada. Lanza FalError en fallo/timeout."""
    lf = get_client()
    # as_type="generation": Langfuse solo agrega costes al trace desde generations (no desde spans)
    with lf.start_as_current_observation(
        name=nombre, as_type="generation", model=app, input=_resumir(argumentos), metadata={"app": app, **(meta or {})}
    ) as span:
        t0 = time.monotonic()
        async with semaforo():
            try:
                res = await asyncio.wait_for(fal_client.subscribe_async(app, arguments=argumentos), timeout=timeout_s)
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
    return await fal_client.upload_file_async(str(path))
