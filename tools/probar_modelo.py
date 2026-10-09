#!/usr/bin/env python
"""Prueba pagada pequeña de UN modelo del selector (R4, regla de oro).

Antes de poner créditos en tools/tarifas.json §modelos (la compuerta que ofrece
un modelo a los usuarios) hay que ver, con los adaptadores REALES del repo, que
el modelo responde como se promete: el endpoint correcto, los argumentos
correctos, la medida y el audio que prometemos. Esta herramienta hace UNA llamada
y mide lo que llegó. La corre el dueño con su «sí» (--si), o la otra IA en
Windows desde D:\\aws-project con el venv.

  python tools/probar_modelo.py <tarea> <modelo> [opciones]

  tarea   imagen | editar | clip
  modelo  un id de pipeline/modelos_ia.py (grok, veo-lite, veo-fast, veo-std, nb2…)

  --segundos N         clip: duración del clip (sin esto, la más corta que admite
                       el modelo: es una prueba pequeña)
  --imagen RUTA        editar: la imagen a transformar (obligatoria).
                       clip: si va, imagen a video; si no, texto a video
  --prompt TEXTO       lo que se pide (sin esto, uno corto de prueba). Va tal cual
                       al adaptador: NO pasa por el LLM que escribe prompts
  --formato F          horizontal | vertical (imagen y clip; editar conserva el
                       encuadre de la imagen)
  --salida CARPETA     dónde guardar lo generado (por defecto work/probar_modelo)
  --si                 SÍ llamar a fal y gastar. Sin esto solo es un ensayo

SIN --si: ensayo. Enseña la tarea, el modelo, el endpoint exacto, los argumentos
que armaría el adaptador, el costo esperado en dólares (tools/pricing.json) y los
créditos que cobraría (tools/tarifas.json, si hay número). No llama a nada, no
pide clave, no crea carpetas.

CON --si: exige FAL_KEY (del entorno o del .env de la carpeta actual; la clave
jamás se imprime), valida la duración ANTES de llamar, hace UNA sola llamada con
el adaptador real (un reintento del adaptador se corta: dos llamadas serían el
doble de gasto), descarga el resultado sin pisar nada y lo mide con ffprobe:
ancho×alto, segundos y si trae pista de audio. fal no devuelve lo cobrado: el
costo esperado se compara después con Request Details en el panel de fal.

Salida: 0 = el ensayo o la prueba terminaron; 1 = la llamada o la medición
fallaron (revisa el panel por si se cobró); 2 = el pedido no es válido o falta
algo, y NO se gastó nada. Las diferencias con lo prometido salen en el texto
(«REVISAR»), no en el código de salida.

Ejemplos (desde la raíz del repo):
  python tools/probar_modelo.py clip veo-lite --segundos 4
  python tools/probar_modelo.py clip veo-lite --segundos 4 --si
  python tools/probar_modelo.py editar grok --imagen boceto.png --prompt "pásalo a acuarela" --si
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import shutil
import subprocess
import sys
import time
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import urlparse

RAIZ = Path(__file__).resolve().parent.parent
if str(RAIZ) not in sys.path:      # `python tools/probar_modelo.py` pone tools/ en el path, no la raíz
    sys.path.insert(0, str(RAIZ))

TAREAS = ("imagen", "editar", "clip")
FORMATOS = ("horizontal", "vertical")
SALIDA_PREDETERMINADA = Path("work") / "probar_modelo"

# Lo que se pide si no se da --prompt. Cortos y verificables a simple vista; en
# el clip se pide sonido ambiente para comprobar de oído que la pista no es muda.
PROMPT_PREDETERMINADO = {
    "imagen": "Una taza de café humeante sobre una mesa de madera junto a una ventana, "
              "luz suave de la mañana, fotografía realista",
    "editar": "pásala a acuarela, con colores suaves",
    "clip": "Una taza de café humeante sobre una mesa de madera junto a una ventana; "
            "la cámara se acerca despacio y se oye el ambiente tranquilo de una cafetería",
}

# Lo que se enseña en lugar de la URL de la imagen subida, que en el ensayo no existe.
IMAGEN_SUBIDA_ENSAYO = "<imagen subida a fal>"

EXT_IMAGEN = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif"}
EXT_VIDEO = {".mp4", ".webm", ".mov"}

TOLERANCIA_SEGUNDOS = 0.5      # un clip de «8 s» mide 8.0x: medio segundo sobra
TOLERANCIA_ASPECTO = 0.03      # ancho/alto contra el aspecto pedido (3 %)


class _Uso(Exception):
    """El pedido no es válido o falta algo. Sale con 2 y NO se gastó nada."""


class _FinDelEnsayo(Exception):
    """La grabadora ya tiene lo que el adaptador iba a mandar: se corta ahí."""


class _SegundaLlamada(Exception):
    """El adaptador quiso llamar a fal por segunda vez. No hereda de FalError a
    propósito: así el reintento del clip no la atrapa y sale del adaptador."""


class _SinMedida(Exception):
    """ffprobe no pudo medir el archivo."""


class Plan:
    """El pedido ya validado. Clase simple y no @dataclass: la herramienta se carga
    también por importlib (como hacen los tests), y un dataclass con anotaciones
    en texto falla si el módulo no está registrado en sys.modules."""

    def __init__(self, tarea: str, modelo, prompt: str, imagen: Path | None,
                 formato: str | None, segundos: int | None, salida: Path):
        self.tarea = tarea
        self.modelo = modelo               # pipeline.modelos_ia.Modelo
        self.prompt = prompt
        self.imagen = imagen
        self.formato = formato             # None en editar: conserva el encuadre
        self.segundos = segundos           # solo el clip
        self.salida = salida
        # los llena el ensayo (_planear), con el adaptador real
        self.endpoint = ""
        self.argumentos: dict = {}
        self.costo_usd: float | None = None

    @property
    def con_imagen(self) -> bool:
        """¿La llamada lleva imagen de entrada? (decide el endpoint de la tabla)"""
        return self.tarea == "editar" or (self.tarea == "clip" and self.imagen is not None)

    @property
    def base(self) -> str:
        partes = [self.tarea, self.modelo.id] + ([f"{self.segundos}s"] if self.segundos else [])
        return _nombre_seguro("-".join(partes))


# ---------------------------------------------------------------------------
# salida a pantalla: la clave nunca se imprime

def _secretos() -> list[str]:
    vistos = (os.getenv(k) or "" for k in ("FAL_KEY", "FAL_KEY_ID", "FAL_KEY_SECRET"))
    # una clave de menos de 4 caracteres no es una clave: tapar «a» destrozaría el texto
    return sorted({v for v in vistos if len(v) >= 4}, key=len, reverse=True)


def _limpio(texto: str) -> str:
    """El texto sin la clave de fal, aunque llegue dentro de un mensaje de error."""
    for secreto in _secretos():
        texto = texto.replace(secreto, "***")
    return texto


def _decir(texto: str = "", *, err: bool = False) -> None:
    print(_limpio(texto), file=sys.stderr if err else sys.stdout)


def _salida_segura() -> None:
    """La consola de Windows puede no ser UTF-8: un carácter raro se vuelve «?»
    en lugar de tumbar la herramienta después de haber gastado."""
    for flujo in (sys.stdout, sys.stderr):
        try:
            flujo.reconfigure(errors="replace")
        except Exception:  # noqa: BLE001 — un flujo sin reconfigure basta como está
            pass


def _cargar_env() -> None:
    try:
        from dotenv import load_dotenv
        # primero el .env de donde se corre (el script puede vivir en otra carpeta), luego el de siempre
        load_dotenv(Path.cwd() / ".env")
        load_dotenv()
    except Exception:  # noqa: BLE001 — sin python-dotenv basta con el entorno
        pass


# ---------------------------------------------------------------------------
# archivos: nada se pisa

def _nombre_seguro(texto: str) -> str:
    return "".join(c if c.isalnum() or c in "-_." else "_" for c in texto)


def _ruta_libre(destino: Path) -> Path:
    """Lo ya guardado nunca se pisa: si el nombre existe, se agrega _2, _3…"""
    if not destino.exists():
        return destino
    k = 2
    while (candidata := destino.with_name(f"{destino.stem}_{k}{destino.suffix}")).exists():
        k += 1
    return candidata


def _guardar_sin_pisar(origen: Path, salida: Path, base: str, ext: str) -> Path:
    """Mueve `origen` a salida/base+ext, o a base_2+ext, base_3+ext… El nombre se
    reserva con creación exclusiva («x»): si dos corridas coinciden, la segunda
    ve el nombre ocupado y sigue, en lugar de escribir encima."""
    k = 1
    while True:
        destino = salida / (f"{base}{ext}" if k == 1 else f"{base}_{k}{ext}")
        try:
            f = open(destino, "xb")
        except FileExistsError:
            k += 1
            continue
        try:
            with f, open(origen, "rb") as src:
                shutil.copyfileobj(src, f)
        except BaseException:
            destino.unlink(missing_ok=True)      # era nuestro: lo reservamos nosotros
            raise
        origen.unlink(missing_ok=True)
        return destino


def _extension(url: str, ruta: Path, tarea: str) -> str:
    """La extensión del resultado: la de la URL; si no dice, la del contenido."""
    ext = Path(urlparse(url or "").path).suffix.lower()
    if ext in EXT_IMAGEN | EXT_VIDEO:
        return ext
    try:
        cabeza = ruta.read_bytes()[:16]
    except OSError:
        cabeza = b""
    if cabeza.startswith(b"\x89PNG"):
        return ".png"
    if cabeza.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if cabeza[:4] == b"RIFF" and cabeza[8:12] == b"WEBP":
        return ".webp"
    if cabeza[4:8] == b"ftyp":
        return ".mp4"
    return ".mp4" if tarea == "clip" else ".png"


# ---------------------------------------------------------------------------
# el pedido

def _analizar(argv: list[str] | None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Prueba pagada pequeña de un modelo del selector, con los adaptadores reales. "
                    "Sin --si solo es un ensayo: no llama a nada.")
    p.add_argument("tarea", choices=TAREAS, help="qué se prueba: imagen (crear), editar o clip")
    p.add_argument("modelo", help="el id del modelo en pipeline/modelos_ia.py, p. ej. veo-lite, grok, nb2")
    p.add_argument("--segundos", type=int, help="clip: duración en segundos (por defecto la más corta que admite el modelo)")
    p.add_argument("--imagen", help="editar: la imagen a transformar (obligatoria). clip: imagen a video")
    p.add_argument("--prompt", help="lo que se pide; va tal cual al adaptador, sin pasar por el LLM")
    p.add_argument("--formato", choices=FORMATOS, help="imagen y clip: horizontal (por defecto) o vertical")
    p.add_argument("--salida", help=f"carpeta donde guardar lo generado (por defecto {SALIDA_PREDETERMINADA})")
    p.add_argument("--si", action="store_true", help="SÍ llamar a fal y gastar. Sin esto solo se muestra el plan")
    return p.parse_args(argv)


def _preparar(a: argparse.Namespace) -> Plan:
    """El pedido validado, o _Uso con el motivo. No toca la red ni el disco (salvo leer)."""
    from pipeline import clip, modelos_ia

    if not a.modelo.strip():
        raise _Uso(f"Falta el modelo. Disponibles para {a.tarea}: {', '.join(modelos_ia.disponibles(a.tarea))}.")
    try:
        modelo = modelos_ia.resolver(a.tarea, a.modelo)
    except modelos_ia.ModeloDesconocido as err:
        raise _Uso(f"{err}. Modelos disponibles para {a.tarea}: {', '.join(modelos_ia.disponibles(a.tarea)) or 'ninguno'}.") from err

    # lo que no aplica a la tarea se rechaza: callarlo cobraría algo distinto de lo que se cree
    if a.tarea != "clip" and a.segundos is not None:
        raise _Uso(f"--segundos solo aplica a la tarea clip, no a {a.tarea}.")
    if a.tarea == "imagen" and a.imagen:
        raise _Uso("La tarea imagen crea desde texto y no usa --imagen. Para transformar una imagen usa la tarea editar.")
    if a.tarea == "editar" and a.formato:
        raise _Uso("--formato no aplica a editar: se conserva el encuadre de la imagen.")
    if a.tarea == "editar" and not a.imagen:
        raise _Uso("La tarea editar necesita --imagen RUTA (la imagen a transformar).")

    segundos = None
    if a.tarea == "clip":
        segundos = a.segundos if a.segundos is not None else (
            min(modelo.duraciones) if modelo.duraciones else modelos_ia.DURACION_PREDETERMINADA_S)
        try:
            modelos_ia.valida_duracion("clip", modelo.id, segundos)
        except modelos_ia.ModeloDesconocido as err:      # incluye DuracionNoAdmitida
            raise _Uso(str(err)) from err

    imagen = None
    if a.imagen:
        imagen = Path(a.imagen).expanduser()
        if not imagen.is_file():
            raise _Uso(f"No encuentro la imagen: {imagen}")
        if imagen.suffix.lower() not in clip.EXTS:
            raise _Uso(f"La imagen debe ser de las que acepta fal ({', '.join(sorted(clip.EXTS))}), no {imagen.suffix or 'sin extensión'}.")
        if imagen.stat().st_size > clip.MAX_BYTES_IMAGEN:
            raise _Uso(f"La imagen pesa más de {clip.MAX_BYTES_IMAGEN // 1024**2} MB: {imagen}")

    if a.prompt is not None and not a.prompt.strip():
        raise _Uso("--prompt está vacío: escribe qué quieres ver, o quítalo para usar el de prueba.")
    prompt = (a.prompt or PROMPT_PREDETERMINADO[a.tarea]).strip()

    return Plan(tarea=a.tarea, modelo=modelo, prompt=prompt, imagen=imagen,
                formato=None if a.tarea == "editar" else (a.formato or "horizontal"),
                segundos=segundos, salida=Path(a.salida).expanduser() if a.salida else SALIDA_PREDETERMINADA)


# ---------------------------------------------------------------------------
# los adaptadores reales

@contextmanager
def _sustituir(modulo, **cambios):
    """Cambia atributos de un módulo mientras dura el bloque y los deja como estaban."""
    originales = {k: getattr(modulo, k) for k in cambios}
    for k, v in cambios.items():
        setattr(modulo, k, v)
    try:
        yield
    finally:
        for k, v in originales.items():
            setattr(modulo, k, v)


async def _invocar(plan: Plan, destino: Path) -> str:
    """UNA vez el adaptador real que la tarea usa en producción. Devuelve la URL
    del resultado. imagen/editar descargan ellos mismos a `destino`; el clip solo
    devuelve la URL (la descarga la hace quien llama)."""
    from pipeline import clip, fal, media_fal
    from pipeline.models import formato_de

    meta = {"probar_modelo": True}
    if plan.tarea == "imagen":
        return await media_fal.imagen_fal(
            plan.prompt, destino, meta=meta, aspecto=formato_de(plan.formato)["aspecto"],
            modelo=plan.modelo.id)
    if plan.tarea == "editar":
        return await media_fal.imagen_transformar(
            plan.prompt, plan.imagen, destino, meta=meta, modelo=plan.modelo.id)
    # clip: sin pasar por clip.generar, que llama al LLM que escribe el prompt
    url_imagen = await fal.subir_archivo(plan.imagen) if plan.imagen else None
    return await clip.animar(plan.prompt, url_imagen, plan.formato, plan.modelo.id, plan.segundos)


async def _planear(plan: Plan) -> None:
    """Qué mandaría el adaptador, sin mandarlo: corre el adaptador REAL con
    fal.llamar sustituido por una grabadora que anota (endpoint, argumentos) y
    corta. Así lo que se enseña es lo que se enviaría, no una copia que pueda
    desviarse. Y de paso calcula el costo con la misma tarifa del pipeline."""
    from pipeline import clip, fal, pricing

    visto: dict = {}

    async def grabadora(app, argumentos, timeout_s=None, nombre=None, meta=None):
        visto["app"], visto["argumentos"] = app, dict(argumentos)
        raise _FinDelEnsayo

    async def subir_falso(path):
        return IMAGEN_SUBIDA_ENSAYO

    with _sustituir(fal, llamar=grabadora, subir_archivo=subir_falso):
        try:
            await _invocar(plan, plan.salida / ".ensayo")     # jamás se escribe: la grabadora corta antes
        except _FinDelEnsayo:
            pass
    if not visto:
        raise RuntimeError("El adaptador no llegó a llamar a fal: no hay nada que enseñar.")
    plan.endpoint, plan.argumentos = visto["app"], visto["argumentos"]

    if plan.tarea == "clip":
        try:
            plan.costo_usd = clip.costo_usd(1 if plan.imagen else 0, plan.modelo.id, plan.segundos)
        except clip.ClipError:                  # «sin costo conocido»: no hay ficha en pricing.json
            plan.costo_usd = None
    else:
        plan.costo_usd = pricing.costo_fal(plan.endpoint, plan.argumentos)


def _linea_creditos(plan: Plan) -> str:
    from pipeline import creditos
    try:
        n = creditos.costo_modelo(plan.tarea, plan.modelo.id, plan.segundos)
    except KeyError:
        return "sin número en tarifas.json: todavía no se ofrece"
    return f"{n} créditos (tools/tarifas.json §modelos)"


def _linea_costo(plan: Plan) -> str:
    if plan.costo_usd is None:
        return "sin precio confirmado (no hay ficha de este endpoint en tools/pricing.json)"
    return f"${plan.costo_usd:.4f} dólares (tools/pricing.json)"


def _imprimir_plan(plan: Plan, titulo: str) -> None:
    _decir(f"{titulo} · tarea {plan.tarea} · modelo {plan.modelo.id}")
    _decir(f"  endpoint: {plan.endpoint}")
    if plan.tarea == "clip":
        _decir(f"  segundos: {plan.segundos}")
    _decir(f"  argumentos: {json.dumps(plan.argumentos, ensure_ascii=False, default=str)}")
    _decir(f"  costo esperado: {_linea_costo(plan)}")
    _decir(f"  créditos que cobraría: {_linea_creditos(plan)}")


# ---------------------------------------------------------------------------
# la prueba de verdad

def _ffprobe_exe() -> str | None:
    return shutil.which("ffprobe")


def _medir(ruta: Path) -> dict:
    """ffprobe sobre el archivo → ancho, alto, segundos (None si el formato no
    los dice) y si trae pista de audio. Sin shell: la lista va directo."""
    exe = _ffprobe_exe()
    if not exe:
        raise _SinMedida("ffprobe no está instalado o no está en el PATH")
    try:
        r = subprocess.run(
            [exe, "-v", "error", "-print_format", "json", "-show_streams", "-show_format", str(ruta)],
            capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=60)
        datos = json.loads(r.stdout or "{}")
    except (OSError, subprocess.SubprocessError, ValueError) as err:
        raise _SinMedida(f"ffprobe no pudo leer {ruta.name}: {err}") from err
    if r.returncode != 0:
        raise _SinMedida(f"ffprobe no pudo leer {ruta.name}: {(r.stderr or '').strip()[:200]}")
    flujos = datos.get("streams") or []
    video = next((s for s in flujos if s.get("codec_type") == "video"), None)
    if not video or not video.get("width") or not video.get("height"):
        raise _SinMedida(f"{ruta.name} no tiene un flujo de imagen que medir")
    audio = next((s for s in flujos if s.get("codec_type") == "audio"), None)
    try:
        segundos = float((datos.get("format") or {}).get("duration") or video.get("duration"))
    except (TypeError, ValueError):
        segundos = None
    return {"ancho": int(video["width"]), "alto": int(video["height"]), "segundos": segundos,
            "audio": audio is not None, "codec_audio": (audio or {}).get("codec_name")}


def _veredicto(plan: Plan, medida: dict) -> list[str]:
    """Las diferencias entre lo que se pidió y lo que llegó. Vacío = coincide."""
    from pipeline import clip
    from pipeline.models import formato_de

    dif: list[str] = []
    ancho, alto = medida["ancho"], medida["alto"]
    if plan.formato:
        a, b = (int(v) for v in formato_de(plan.formato)["aspecto"].split(":"))
        if abs(ancho / alto - a / b) > (a / b) * TOLERANCIA_ASPECTO:
            dif.append(f"se pidió {a}:{b} y llegó {ancho}×{alto}")
    if plan.tarea != "clip":
        return dif
    pedida = int(clip.RESOLUCION.rstrip("p"))
    if min(ancho, alto) != pedida:
        dif.append(f"se pidió {clip.RESOLUCION} y el lado corto mide {min(ancho, alto)}")
    seg = medida["segundos"]
    if seg is None:
        dif.append("el archivo no dice cuánto dura")
    elif abs(seg - plan.segundos) > TOLERANCIA_SEGUNDOS:
        dif.append(f"se pidieron {plan.segundos} s y dura {seg:.2f} s")
    if clip.CON_AUDIO and plan.modelo.con_audio and not medida["audio"]:
        dif.append("se pidió con audio y el archivo NO trae pista de audio")
    return dif


def _describir(plan: Plan, medida: dict) -> str:
    """Lo medido en una línea. Segundos y audio solo tienen sentido en un clip."""
    partes = [f"{medida['ancho']}×{medida['alto']}"]
    if plan.tarea == "clip":
        if medida["segundos"] is not None:
            partes.append(f"{medida['segundos']:.2f} s")
        partes.append("audio: SÍ" + (f" ({medida['codec_audio']})" if medida["codec_audio"] else "")
                      if medida["audio"] else "audio: NO")
    return " · ".join(partes)


class _UnaLlamada:
    """fal.llamar con tope de UNA llamada por corrida. La primera pasa; la
    segunda —el reintento del clip, o un adaptador que reintenta por su cuenta—
    se corta antes de salir: otra llamada sería otro cobro."""

    def __init__(self, real):
        self.real = real
        self.llamadas = 0
        self.error: BaseException | None = None

    async def __call__(self, app, argumentos, timeout_s=None, nombre=None, meta=None):
        self.llamadas += 1
        if self.llamadas > 1:
            raise _SegundaLlamada("segunda llamada a fal en la misma corrida")
        try:
            return await self.real(app, argumentos, timeout_s=timeout_s, nombre=nombre, meta=meta)
        except Exception as err:  # noqa: BLE001 — se anota y se relanza tal cual
            self.error = err
            raise


async def _gastar(plan: Plan) -> tuple[Path, float]:
    """UNA llamada real al adaptador. Devuelve (archivo guardado, segundos que tardó)."""
    from pipeline import fal

    plan.salida.mkdir(parents=True, exist_ok=True)
    parcial = _ruta_libre(plan.salida / f".{plan.base}.parcial")
    una = _UnaLlamada(fal.llamar)
    t0 = time.monotonic()
    try:
        with _sustituir(fal, llamar=una):
            url = await _invocar(plan, parcial)
        if plan.tarea == "clip":
            await fal.descargar(url, parcial)
        seg = time.monotonic() - t0
        if not parcial.is_file() or parcial.stat().st_size == 0:
            raise RuntimeError("fal respondió, pero no quedó nada descargado")
        return _guardar_sin_pisar(parcial, plan.salida, plan.base, _extension(url, parcial, plan.tarea)), seg
    except _SegundaLlamada as err:
        motivo = str(una.error) if una.error else "fal no devolvió el resultado esperado"
        raise RuntimeError(f"La llamada a fal falló ({motivo}). El adaptador quiso reintentar y se cortó: "
                           "una llamada por corrida.") from err
    finally:
        parcial.unlink(missing_ok=True)


def _correr(plan: Plan) -> int:
    _imprimir_plan(plan, "PRUEBA PAGADA")
    _decir(f"  carpeta de salida: {plan.salida}")
    _decir("Llamando a fal (una sola llamada)…")
    try:
        archivo, segundos = asyncio.run(_gastar(plan))
    except KeyboardInterrupt:
        _decir("Interrumpido. Si la llamada ya había salido, revisa Request Details en el panel de fal por si se cobró.", err=True)
        return 1
    except Exception as err:  # noqa: BLE001 — cualquier fallo se cuenta con claridad, sin traza
        _decir(f"La prueba falló: {err}", err=True)
        _decir("Revisa Request Details en el panel de fal por si se cobró algo.", err=True)
        return 1
    # desde aquí ya se gastó: pase lo que pase, el recordatorio del cobro sale
    _decir(f"  respuesta en {segundos:.1f} s")
    _decir(f"  guardado: {archivo}")
    codigo = 0
    try:
        medida = _medir(archivo)
        mp = medida["ancho"] * medida["alto"] / 1_000_000
        _decir(f"MEDIDO · {_describir(plan, medida)} · {mp:.2f} MP")
        dif = _veredicto(plan, medida)
        for d in dif:
            _decir(f"  REVISAR: {d}")
        if not dif:
            _decir("  coincide con lo prometido")
    except Exception as err:  # noqa: BLE001 — el archivo ya está guardado; la medición falló
        _decir(f"Se guardó el archivo, pero no se pudo medir: {err}", err=True)
        _decir(f"Mídelo a mano: ffprobe -v error -show_streams \"{archivo}\"", err=True)
        codigo = 1
    _decir(f"Costo esperado: {_linea_costo(plan)}")
    _decir("Recordatorio: compáralo con Request Details en el panel de fal: fal no devuelve lo cobrado.")
    return codigo


def main(argv: list[str] | None = None) -> int:
    _salida_segura()
    a = _analizar(argv)
    try:
        plan = _preparar(a)
        asyncio.run(_planear(plan))
        esperado = plan.modelo.endpoint_para(plan.con_imagen)
        if plan.endpoint != esperado:
            _decir(f"El adaptador llamaría a {plan.endpoint}, pero la tabla de modelos dice {esperado}. "
                   "No se gasta nada hasta que concuerden.", err=True)
            return 1
        if not a.si:
            _imprimir_plan(plan, "ENSAYO")
            _decir("  NO se llamó a nada. Para gastar de verdad, repite el comando con --si.")
            return 0

        # con --si: todo lo que se pueda comprobar se comprueba ANTES de gastar
        _cargar_env()
        if not os.getenv("FAL_KEY"):
            raise _Uso("Falta FAL_KEY en el entorno o en el .env de esta carpeta "
                       "(la clave la pone el dueño; aquí no se imprime).")
        if not _ffprobe_exe():
            raise _Uso("Falta ffprobe (viene con ffmpeg): sin él no se puede medir lo que llegue, "
                       "y no se gasta una prueba que no se pueda comprobar.")
        if plan.salida.exists() and not plan.salida.is_dir():
            raise _Uso(f"--salida no es una carpeta: {plan.salida}")
        return _correr(plan)
    except _Uso as err:
        _decir(str(err), err=True)
        return 2
    except Exception as err:  # noqa: BLE001 — un fallo propio se cuenta sin traza
        _decir(f"La herramienta falló: {err}", err=True)
        return 1


if __name__ == "__main__":
    sys.exit(main())
