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
  --imagen-sin-validar clip con --imagen: no exige lado corto de 720 px ni 16:9 /
                       9:16 (para probar a propósito una foto rara; avisa). Una
                       imagen vacía o ilegible se rechaza siempre
  --prompt TEXTO       lo que se pide (sin esto, uno corto de prueba). Va tal cual
                       al adaptador: NO pasa por el LLM que escribe prompts
  --formato F          horizontal | vertical (imagen y clip) o cuadrado (solo
                       imagen: el clip no admite 1:1); editar conserva el
                       encuadre de la imagen. Con --imagen en un clip, sin esto
                       se deduce de la imagen (apaisada = horizontal)
  --salida CARPETA     dónde guardar lo generado (por defecto work/probar_modelo)
  --si                 SÍ llamar a fal y gastar. Sin esto solo es un ensayo

SIN --si: ensayo. Enseña la tarea, el modelo, el endpoint exacto, los argumentos
que armaría el adaptador, el costo esperado en dólares (tools/pricing.json) y los
créditos que cobraría (tools/tarifas.json, si hay número). No llama a fal ni gasta
nada, no pide clave, no crea carpetas. Para que eso sea cierto apaga el trazado de
Langfuse mientras dura: clip.animar lleva @observe y, con LANGFUSE_* configurado,
el ensayo exportaría un span con error. Se apaga con LANGFUSE_TRACING_ENABLED=false
(comprobado: con un servidor local de prueba, sin la variable llega 1 solicitud a
Langfuse y con ella ninguna); si tú ya definiste esa variable, se respeta tal cual.

CON --si: exige FAL_KEY (del entorno o del .env de la carpeta actual; la clave
jamás se imprime, ni en pantalla, ni en un error, ni en el log de una librería;
una clave con espacios o saltos de línea se rechaza), valida la duración, la imagen
y la carpeta de salida ANTES de llamar, hace UN solo intento de llamada de nuestro
lado (un reintento del adaptador se corta: dos llamadas serían el doble de gasto),
imprime la URL del resultado en cuanto fal responde, lo descarga sin pisar nada y lo
mide con ffprobe: ancho×alto, segundos y si trae pista de audio.

OJO con «un solo intento»: es de NUESTRO lado. Por debajo, fal_client puede reenviar
el POST de envío hasta 10 veces, sin idempotencia, si la respuesta se pierde; eso no
lo vemos desde aquí. Por eso, al terminar, hay que revisar en Request Details que haya
UNA solicitud (no duplicadas). Y fal no devuelve lo cobrado: el costo esperado se
compara con Request Details en el panel de fal.

Salida: 0 = el ensayo o la prueba terminaron; 1 = falló con la llamada ya hecha (revisa
el panel por si se cobró); 2 = NO se gastó nada: el pedido no es válido, falta algo, la
carpeta de salida es imposible, el endpoint no concuerda con la tabla, o falló antes de
llegar a llamar a fal (p. ej. la subida de la imagen).
Las diferencias con lo prometido salen en el texto («REVISAR»), no en el código de
salida.

Ejemplos (desde la raíz del repo):
  python tools/probar_modelo.py clip veo-lite --segundos 4
  python tools/probar_modelo.py clip veo-lite --segundos 4 --si
  python tools/probar_modelo.py editar grok --imagen boceto.png --prompt "pásalo a acuarela" --si
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import math
import os
import shutil
import subprocess
import sys
import time
import traceback
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import urlparse

RAIZ = Path(__file__).resolve().parent.parent
if str(RAIZ) not in sys.path:      # `python tools/probar_modelo.py` pone tools/ en el path, no la raíz
    sys.path.insert(0, str(RAIZ))

TAREAS = ("imagen", "editar", "clip")
FORMATOS = ("horizontal", "vertical")
# La caja de imágenes también pide cuadrado (1:1). La tabla es la de server/app.py::ASPECTOS_IMAGEN
# (un test las compara); NO se usa pipeline.models.formato_de, que ante un nombre que no conoce
# cae en horizontal sin avisar: «cuadrado» se volvería 16:9 en silencio.
ASPECTOS_IMAGEN = {"horizontal": "16:9", "vertical": "9:16", "cuadrado": "1:1"}
FORMATOS_IMAGEN = tuple(ASPECTOS_IMAGEN)
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

# La imagen de entrada de un clip (docs/modelos-ia/DATOS-FAL-2026-10-08.md §4, página
# del modelo): de 720p o más de lado corto y de 16:9 o 9:16. Con otra, la única
# llamada pagada se gasta para nada.
LADO_CORTO_MIN_IMAGEN = 720
ASPECTOS_IMAGEN_CLIP = (16 / 9, 9 / 16)

# «1K» es ~1 megapíxel (1024×1024, 1376×768). Por encima de 1.2 MP la salida no es
# 1K y el costo anotado ($ por imagen a 1K) ya no vale.
MAX_MP_1K = 1.2
MIN_MP_1K = 0.8          # 1K es ~1 MP: algo mucho más chico (0.5K) tiene un precio que no está leído

# Si la llamada tarda más de esto del tiempo que el cliente espera, está cerca de
# cortarse por timeout: un corte de cliente puede dejar el trabajo vivo y cobrado en fal.
UMBRAL_TIEMPO = 0.70


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
                 formato: str | None, segundos: int | None, salida: Path,
                 formato_explicito: bool = False, imagen_sin_validar: bool = False):
        self.tarea = tarea
        self.modelo = modelo               # pipeline.modelos_ia.Modelo
        self.prompt = prompt
        self.imagen = imagen
        self.formato = formato             # None en editar: conserva el encuadre
        self.segundos = segundos           # solo el clip
        self.salida = salida
        self.formato_explicito = formato_explicito      # ¿vino --formato? Si no, un clip lo deduce de la imagen
        self.imagen_sin_validar = imagen_sin_validar    # salta SOLO la regla de lado corto / relación
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

def _formas(v: str) -> set[str]:
    """Las formas en que un valor puede aparecer en un texto: tal cual, sin espacios
    en los bordes y escapado como lo escribe repr() (un «\\n» al final que h11 pone
    en su mensaje de «Illegal header value» ya no es el valor original)."""
    return {v, v.strip(), repr(v)[1:-1], repr(v.strip())[1:-1]}


def _secretos() -> list[str]:
    formas: set[str] = set()
    for k in ("FAL_KEY", "FAL_KEY_ID", "FAL_KEY_SECRET"):
        v = os.getenv(k) or ""
        # la clave de fal tiene la forma «id:secreto» y un error puede nombrar solo una mitad
        for trozo in (v, *v.split(":")):
            formas |= _formas(trozo)
    # menos de 4 caracteres no es una clave: tapar «a» destrozaría el texto
    return sorted((f for f in formas if len(f) >= 4), key=len, reverse=True)


def _limpio(texto: str) -> str:
    """El texto sin la clave de fal, aunque llegue dentro de un mensaje de error."""
    for secreto in _secretos():
        texto = texto.replace(secreto, "***")
    return texto


def _decir(texto: str = "", *, err: bool = False) -> None:
    print(_limpio(texto), file=sys.stderr if err else sys.stdout)


class _FiltroClave(logging.Filter):
    """Tapa la clave en un registro de logging: el mensaje ya formateado (con sus
    argumentos adentro), los argumentos y la traza de la excepción. Nunca levanta:
    si no puede limpiar un registro, lo reemplaza por un aviso en vez de dejarlo pasar."""

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            try:
                mensaje = record.getMessage()
            except Exception:  # noqa: BLE001 — un mensaje mal formado igual se limpia
                mensaje = f"{record.msg} {record.args}"
            record.msg, record.args = _limpio(mensaje), ()
            info = record.exc_info
            if isinstance(info, tuple) and info and info[0] is not None:
                traza = "".join(traceback.format_exception(*info)).rstrip("\n")
                record.exc_text = _limpio(traza)
            elif record.exc_text:
                record.exc_text = _limpio(record.exc_text)
            record.exc_info = None          # que ningún formateador vuelva a armar la traza cruda
            if isinstance(record.stack_info, str):
                record.stack_info = _limpio(record.stack_info)
        except Exception:  # noqa: BLE001 — antes perder el registro que filtrar la clave
            record.msg, record.args = "(registro omitido: no se pudo limpiar)", ()
            record.exc_info = record.exc_text = record.stack_info = None
        return True


@contextmanager
def _logs_sin_clave():
    """Mientras dura el bloque, NINGÚN registro de logging sale con la clave. Los
    avisos de las librerías (pipeline/clip.py hace log.warning(... err)) no pasan por
    _decir: escriben directo a stderr por logging. Un Filter en el logger raíz NO los
    vería (los filtros de un logger no se aplican a lo que sube de sus hijos), así
    que el filtro se cuelga de la fábrica de registros, por la que pasa todo registro
    antes de llegar a cualquier handler, también el de último recurso."""
    previa = logging.getLogRecordFactory()
    filtro = _FiltroClave()

    def fabrica(*args, **kwargs):
        registro = previa(*args, **kwargs)
        filtro.filter(registro)
        return registro

    logging.setLogRecordFactory(fabrica)
    try:
        yield
    finally:
        if logging.getLogRecordFactory() is fabrica:
            logging.setLogRecordFactory(previa)


@contextmanager
def _sin_trazado(apagar: bool):
    """El ensayo no debe llamar a nada, ni al trazado de Langfuse (clip.animar lleva
    @observe y con LANGFUSE_* configurado exportaría un span con error). Se apaga ANTES
    de importar pipeline; si el dueño ya definió la variable, se respeta. Se deja como
    estaba al salir (los tests llaman a main() muchas veces en el mismo proceso)."""
    puesta = apagar and "LANGFUSE_TRACING_ENABLED" not in os.environ
    if puesta:
        os.environ["LANGFUSE_TRACING_ENABLED"] = "false"
    try:
        yield
    finally:
        if puesta:
            os.environ.pop("LANGFUSE_TRACING_ENABLED", None)


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


def _borrar(ruta: Path) -> None:
    """Borra si puede. En Windows un antivirus puede dejar abierto un archivo recién
    escrito y unlink lanza PermissionError: un parcial que no se pudo borrar no debe
    tapar un resultado ya guardado (y ya cobrado)."""
    try:
        ruta.unlink(missing_ok=True)
    except OSError:
        pass


def _guardar_sin_pisar(origen: Path, salida: Path, base: str, ext: str) -> Path:
    """Mueve `origen` a salida/base+ext, o a base_2+ext, base_3+ext… El nombre se
    reserva con creación exclusiva («x»): si dos corridas coinciden, la segunda
    ve el nombre ocupado y sigue, en lugar de escribir encima. Ya reservado, el
    contenido llega con os.replace (un solo paso, sin parcial que borrar después);
    si el sistema no deja moverlo, se copia, y un parcial que no se deje borrar no
    cuenta como fallo."""
    k = 1
    while True:
        destino = salida / (f"{base}{ext}" if k == 1 else f"{base}_{k}{ext}")
        try:
            open(destino, "xb").close()          # la reserva: creación exclusiva
        except FileExistsError:
            k += 1
            continue
        break
    try:
        os.replace(origen, destino)
    except OSError:
        try:
            shutil.copyfile(origen, destino)
        except BaseException:
            _borrar(destino)                     # era nuestro: lo reservamos nosotros
            raise
        _borrar(origen)
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
    p.add_argument("--imagen-sin-validar", action="store_true",
                   help="clip con --imagen: no exige lado corto de 720 px ni 16:9 / 9:16 (avisa). "
                        "Una imagen vacía o ilegible se rechaza siempre")
    p.add_argument("--prompt", help="lo que se pide; va tal cual al adaptador, sin pasar por el LLM")
    p.add_argument("--formato", choices=FORMATOS_IMAGEN,
                   help="imagen y clip: horizontal (por defecto) o vertical; imagen también admite "
                        "cuadrado; con --imagen en un clip, sin esto se deduce de la imagen")
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
    if a.tarea == "clip" and a.formato == "cuadrado":
        raise _Uso("--formato cuadrado solo aplica a imagen: el clip admite horizontal o vertical (Veo no acepta 1:1).")
    if a.tarea == "editar" and not a.imagen:
        raise _Uso("La tarea editar necesita --imagen RUTA (la imagen a transformar).")
    if a.imagen_sin_validar and not (a.tarea == "clip" and a.imagen):
        raise _Uso("--imagen-sin-validar solo aplica a la tarea clip con --imagen: la regla de lado corto "
                   "y relación es del modelo de clip a partir de imagen.")

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
                segundos=segundos, salida=Path(a.salida).expanduser() if a.salida else SALIDA_PREDETERMINADA,
                formato_explicito=bool(a.formato), imagen_sin_validar=a.imagen_sin_validar)


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


async def _invocar(plan: Plan, destino: Path, solo_plan: bool = False) -> str:
    """UNA vez el adaptador real que la tarea usa en producción. Devuelve la URL
    del resultado. imagen/editar descargan ellos mismos a `destino`; el clip solo
    devuelve la URL (la descarga la hace quien llama).

    `solo_plan` es para el ensayo previo (la grabadora corta antes de llamar): corre la
    función SIN su decorador de trazas (`__wrapped__`), porque con el trazado encendido
    cada prueba pagada exportaría a Langfuse un span `clip_animar` falso, en ERROR,
    antes del real."""
    from pipeline import clip, fal, media_fal

    meta = {"probar_modelo": True}
    if plan.tarea == "imagen":
        return await media_fal.imagen_fal(
            plan.prompt, destino, meta=meta, aspecto=_aspecto(plan), modelo=plan.modelo.id)
    if plan.tarea == "editar":
        return await media_fal.imagen_transformar(
            plan.prompt, plan.imagen, destino, meta=meta, modelo=plan.modelo.id)
    # clip: sin pasar por clip.generar, que llama al LLM que escribe el prompt
    url_imagen = await fal.subir_archivo(plan.imagen) if plan.imagen else None
    animar = getattr(clip.animar, "__wrapped__", clip.animar) if solo_plan else clip.animar
    return await animar(plan.prompt, url_imagen, plan.formato, plan.modelo.id, plan.segundos)


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
            await _invocar(plan, plan.salida / ".ensayo", solo_plan=True)   # jamás se escribe: la grabadora corta antes
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
    # ffprobe escribe «N/A» donde no sabe: se prueba cada fuente, en orden, y gana la primera
    # que sea un número (la del contenedor y, si no, la del flujo de video)
    segundos = None
    for crudo in ((datos.get("format") or {}).get("duration"), video.get("duration")):
        try:
            valor = float(crudo)
        except (TypeError, ValueError):
            continue
        if math.isfinite(valor) and valor >= 0:
            segundos = valor
            break
    return {"ancho": int(video["width"]), "alto": int(video["height"]), "segundos": segundos,
            "audio": audio is not None, "codec_audio": (audio or {}).get("codec_name"),
            "codec": video.get("codec_name")}


def _aspecto(plan: Plan) -> str:
    """El aspecto «16:9» que se pide: la tabla de la caja para una imagen, la de Veo para un clip."""
    from pipeline.models import formato_de
    return ASPECTOS_IMAGEN[plan.formato] if plan.tarea == "imagen" else formato_de(plan.formato)["aspecto"]


def _tope_megapixeles(plan: Plan) -> float:
    """Hasta cuántos megapíxeles vale el costo anotado de este modelo (0 = sin tope). Los que
    cobran por megapíxel (FLUX.2 klein: $0.006 dólares por MP) se anotan a ~1 MP, y lo declara
    su fila (`megapixeles_ficha`); si llega mucho más grande, lo cobrado puede ser otro. Los de
    precio fijo por imagen (Seedream) no tienen tope."""
    return float(getattr(plan.modelo, "megapixeles_ficha", 0) or 0) if plan.tarea == "imagen" else 0.0


def _promete_1k(plan: Plan) -> bool:
    """¿La fila del modelo fija la resolución en 1K? (Nano Banana 2 con «1K» y FLUX 3 con «1k»:
    el 1K es la única resolución con tarifa leída; por eso se compara sin distinguir mayúsculas)"""
    # args_extra puede ser un mapping o una tupla de pares (llave, valor): dict() lee las dos
    extra = dict(getattr(plan.modelo, "args_extra", None) or ())
    return str(extra.get("resolution", "")).upper() == "1K"


def _dolares(valor: float | None) -> str:
    """«$0.08 dólares»: dos decimales si bastan, cuatro si no."""
    if valor is None:
        return "sin precio confirmado"
    return f"${valor:.2f} dólares" if round(valor, 2) == round(valor, 4) else f"${valor:.4f} dólares"


def _veredicto_tiempo(plan: Plan, una: "_UnaLlamada") -> list[str]:
    """Una llamada que tardó cerca de su timeout es una prueba que ya estuvo a punto
    de cortarse: un timeout de cliente puede dejar el trabajo vivo y cobrado en fal."""
    limite = una.timeout_s
    if not limite:
        from pipeline.config import settings
        limite = settings.clip_timeout_s if plan.tarea == "clip" else settings.grok_timeout_s
    if una.segundos is None or not limite or una.segundos <= UMBRAL_TIEMPO * limite:
        return []
    variable = "CLIP_TIMEOUT_S" if plan.tarea == "clip" else "GROK_TIMEOUT_S"
    return [f"la llamada tardó {una.segundos:.0f} s de los {limite} s de espera del cliente "
            f"({100 * una.segundos / limite:.0f} %, más del {UMBRAL_TIEMPO:.0%}): un timeout de cliente puede "
            f"dejar el trabajo vivo y cobrado en fal. Revisa Request Details y sube {variable} antes de ofrecerlo"]


def _veredicto(plan: Plan, medida: dict) -> list[str]:
    """Las diferencias entre lo que se pidió y lo que llegó. Vacío = coincide."""
    from pipeline import clip

    dif: list[str] = []
    ancho, alto = medida["ancho"], medida["alto"]
    if plan.formato:
        a, b = (int(v) for v in _aspecto(plan).split(":"))
        if abs(ancho / alto - a / b) > (a / b) * TOLERANCIA_ASPECTO:
            dif.append(f"se pidió {a}:{b} y llegó {ancho}×{alto}")
    tope = _tope_megapixeles(plan)
    if tope and ancho * alto / 1_000_000 > tope:
        dif.append(f"llegó {ancho}×{alto} ({ancho * alto / 1_000_000:.2f} MP) y el costo anotado "
                   f"({_dolares(plan.costo_usd)}) vale hasta {tope:g} MP: lo cobrado puede ser otro")
    codec = medida.get("codec")
    if plan.tarea in ("imagen", "editar") and codec and codec != "mjpeg":
        dif.append(f"llegó como {codec} y la caja guarda toda imagen como .jpg y la sirve como "
                   "image/jpeg: un PNG o WebP ahí lo pintan los navegadores, pero las redes lo rechazan "
                   "al publicar (pide output_format jpeg, o conviértela al guardar)")
    if plan.tarea in ("imagen", "editar") and _promete_1k(plan):
        mp = ancho * alto / 1_000_000
        if mp > MAX_MP_1K or mp < MIN_MP_1K:
            dif.append(f"se prometió 1K (~1 MP) y llegó {ancho}×{alto} ({mp:.2f} MP): el costo anotado "
                       f"({_dolares(plan.costo_usd)}) solo vale a 1K, así que lo cobrado puede ser otro")
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
    elif medida.get("codec"):
        partes.append({"mjpeg": "jpeg"}.get(medida["codec"], medida["codec"]))
    return " · ".join(partes)


def _reloj() -> float:
    return time.monotonic()


def _urls(respuesta) -> list[str]:
    """Las URL del resultado en lo que devolvió fal: video.url (clip) o images[].url."""
    if not isinstance(respuesta, dict):
        return []
    urls: list[str] = []
    video = respuesta.get("video")
    if isinstance(video, dict) and video.get("url"):
        urls.append(str(video["url"]))
    imagenes = respuesta.get("images")
    for imagen in imagenes if isinstance(imagenes, list) else []:
        if isinstance(imagen, dict) and imagen.get("url"):
            urls.append(str(imagen["url"]))
    return urls


class _UnaLlamada:
    """fal.llamar con tope de UNA llamada por corrida. La primera pasa; la
    segunda —el reintento del clip, o un adaptador que reintenta por su cuenta—
    se corta antes de salir: otra llamada sería otro cobro. (Es un solo intento de
    NUESTRO lado: por debajo, fal_client puede reenviar el envío si la respuesta
    se pierde, y eso no lo vemos.)

    Guarda la respuesta EN CUANTO vuelve, antes de que nadie descargue nada: si la
    descarga o el guardado fallan después, la URL del resultado ya cobrado no se pierde."""

    def __init__(self, real, al_volver=None):
        self.real = real
        self.al_volver = al_volver          # se llama con esta misma instancia, cuando fal responde
        self.llamadas = 0
        self.error: BaseException | None = None
        self.respuesta = None               # lo que devolvió la llamada que salió
        self.timeout_s = None               # la espera que el adaptador le dio a fal
        self.segundos: float | None = None  # lo que tardó la llamada (respondiera o fallara)

    def urls(self) -> list[str]:
        return _urls(self.respuesta)

    async def __call__(self, app, argumentos, timeout_s=None, nombre=None, meta=None):
        self.llamadas += 1
        if self.llamadas > 1:
            raise _SegundaLlamada("segunda llamada a fal en la misma corrida")
        self.timeout_s = timeout_s
        t0 = _reloj()
        try:
            respuesta = await self.real(app, argumentos, timeout_s=timeout_s, nombre=nombre, meta=meta)
        except Exception as err:  # noqa: BLE001 — se anota y se relanza tal cual
            self.segundos = _reloj() - t0
            self.error = err
            raise
        self.segundos = _reloj() - t0
        self.respuesta = respuesta
        if self.al_volver:
            try:
                self.al_volver(self)
            except Exception:  # noqa: BLE001 — avisar es un extra: no puede perder lo ya cobrado
                pass
        return respuesta


def _anunciar_respuesta(una: _UnaLlamada) -> None:
    """Se imprime ANTES de descargar: si lo que sigue falla, la URL ya quedó a la vista."""
    espera = f" (el cliente espera hasta {una.timeout_s} s)" if una.timeout_s else ""
    _decir(f"  fal respondió en {una.segundos:.1f} s{espera}")
    urls = una.urls()
    for url in urls:
        _decir(f"  resultado en fal: {url}")
    if not urls:
        _decir("  (fal respondió, pero sin URL de resultado)")


def _avisar_cobro(una: _UnaLlamada) -> None:
    """Qué decir del cobro después de un fallo, según hasta dónde llegó la corrida."""
    urls = una.urls()
    if urls:
        _decir("El resultado SÍ se generó y se cobró. Aquí está la URL (guárdala, fal no la conserva para siempre):", err=True)
        for url in urls:
            _decir(f"  {url}", err=True)
        _decir("Descárgalo de ahí y mídelo a mano; revisa en Request Details que haya UNA solicitud (no duplicadas).", err=True)
    elif una.llamadas >= 1:
        _decir("Revisa Request Details en el panel de fal por si se cobró algo (y que no haya solicitudes duplicadas).", err=True)
    else:
        _decir("No se llegó a llamar a fal: no se gastó nada.", err=True)


async def _gastar(plan: Plan, una: _UnaLlamada) -> Path:
    """UNA llamada real al adaptador (a través de `una`). Devuelve el archivo guardado."""
    from pipeline import fal

    plan.salida.mkdir(parents=True, exist_ok=True)
    parcial = _ruta_libre(plan.salida / f".{plan.base}.parcial")
    try:
        with _sustituir(fal, llamar=una):
            url = await _invocar(plan, parcial)
        if plan.tarea == "clip":
            await fal.descargar(url, parcial)
        if not parcial.is_file() or parcial.stat().st_size == 0:
            raise RuntimeError("fal respondió, pero no quedó nada descargado")
        return _guardar_sin_pisar(parcial, plan.salida, plan.base, _extension(url, parcial, plan.tarea))
    except _SegundaLlamada as err:
        motivo = str(una.error) if una.error else "fal no devolvió el resultado esperado"
        raise RuntimeError(f"La llamada a fal falló ({motivo}). El adaptador quiso reintentar y se cortó: "
                           "una llamada por corrida.") from err
    finally:
        _borrar(parcial)


def _correr(plan: Plan) -> int:
    from pipeline import fal

    _imprimir_plan(plan, "PRUEBA PAGADA")
    _decir(f"  carpeta de salida: {plan.salida}")
    _decir("Llamando a fal (un solo intento de nuestro lado; fal_client puede reenviar el envío "
           "si la respuesta se pierde)…")
    una = _UnaLlamada(fal.llamar, al_volver=_anunciar_respuesta)
    try:
        archivo = asyncio.run(_gastar(plan, una))
    except KeyboardInterrupt:
        _decir("Interrumpido.", err=True)
        _avisar_cobro(una)
        return 1
    except Exception as err:  # noqa: BLE001 — cualquier fallo se cuenta con claridad, sin traza
        if una.urls():
            _decir(f"Falló DESPUÉS de la llamada pagada (al descargar o guardar): {err}", err=True)
        else:
            _decir(f"La prueba falló: {err}", err=True)
        _avisar_cobro(una)
        # 2 = no se gastó nada: si fal.llamar ni siquiera se invocó (p. ej. falló la subida de la imagen) no hubo cobro
        return 2 if una.llamadas == 0 and not una.urls() else 1
    # desde aquí ya se gastó: pase lo que pase —un error al medir, un Ctrl+C— el recordatorio del cobro sale
    _decir(f"  guardado: {archivo}")
    codigo = 0
    dif: list[str] = []
    medido = False
    try:
        try:
            medida = _medir(archivo)
            mp = medida["ancho"] * medida["alto"] / 1_000_000
            _decir(f"MEDIDO · {_describir(plan, medida)} · {mp:.2f} MP")
            dif += _veredicto(plan, medida)
            medido = True
        except Exception as err:  # noqa: BLE001 — el archivo ya está guardado; la medición falló
            _decir(f"Se guardó el archivo, pero no se pudo medir: {err}", err=True)
            _decir(f"Mídelo a mano: ffprobe -v error -show_streams \"{archivo}\"", err=True)
            codigo = 1
        dif += _veredicto_tiempo(plan, una)
        for d in dif:
            _decir(f"  REVISAR: {d}")
        if medido and not dif:
            _decir("  coincide con lo prometido")
    finally:
        _decir(f"Costo esperado: {_linea_costo(plan)}")
        _decir("Recordatorio: compáralo con Request Details en el panel de fal (fal no devuelve lo cobrado) y "
               "revisa que haya UNA solicitud, no duplicadas: fal_client puede reenviar el envío si la respuesta se pierde.")
    return codigo


# ---------------------------------------------------------------------------
# lo que se comprueba ANTES de gastar (todo fallo de aquí sale con 2: no se gastó nada)

def _planear_y_comprobar(plan: Plan) -> None:
    """Corre el adaptador contra la grabadora y exige que el endpoint sea el de la tabla."""
    asyncio.run(_planear(plan))
    esperado = plan.modelo.endpoint_para(plan.con_imagen)
    if plan.endpoint != esperado:
        raise _Uso(f"El adaptador llamaría a {plan.endpoint}, pero la tabla de modelos dice {esperado}. "
                   "No se gasta nada hasta que concuerden.")


def _relacion_valida(ancho: int, alto: int) -> bool:
    r = ancho / alto
    return any(abs(r - objetivo) <= objetivo * TOLERANCIA_ASPECTO for objetivo in ASPECTOS_IMAGEN_CLIP)


def _validar_imagen(plan: Plan) -> None:
    """Mide la imagen de entrada con ffprobe antes de gastar. Una imagen vacía o
    ilegible se rechaza siempre. Para un clip, además: lado corto de 720 px o más y
    16:9 o 9:16 (la página del modelo; --imagen-sin-validar salta SOLO esto), y el
    formato sale de la imagen si no se pasó --formato (o se rechaza si discrepa)."""
    ruta = plan.imagen
    try:
        peso = ruta.stat().st_size
    except OSError as err:
        raise _Uso(f"No puedo leer la imagen {ruta}: {err}. No se gastó nada.") from err
    if peso == 0:
        raise _Uso(f"La imagen está vacía (0 bytes): {ruta}. No se gastó nada.")
    try:
        medida = _medir(ruta)
    except _SinMedida as err:
        raise _Uso(f"No puedo leer la imagen {ruta.name}: {err}. Una imagen ilegible gastaría la única llamada "
                   "para nada, y esto no se salta con --imagen-sin-validar. No se gastó nada.") from err
    if plan.tarea != "clip":
        return                          # editar: ni 720p ni 16:9 (el modelo conserva el encuadre)

    ancho, alto = medida["ancho"], medida["alto"]
    orientacion = "horizontal" if ancho > alto else "vertical" if alto > ancho else None
    if plan.formato_explicito and orientacion and plan.formato != orientacion:
        raise _Uso(f"--formato {plan.formato} no concuerda con la imagen: {ruta.name} mide {ancho}×{alto} "
                   f"({'apaisada' if orientacion == 'horizontal' else 'vertical'}). Quita --formato para "
                   "deducirlo de la imagen, o usa otra. No se gastó nada.")
    if not plan.formato_explicito and orientacion:
        plan.formato = orientacion

    if plan.imagen_sin_validar:
        _decir("AVISO: --imagen-sin-validar: no se comprueba el lado corto ni la relación de la imagen. Si el "
               "modelo la rechaza, la llamada ya salió y puede cobrarse igual.", err=True)
        return
    problemas = []
    if min(ancho, alto) < LADO_CORTO_MIN_IMAGEN:
        problemas.append(f"su lado corto mide {min(ancho, alto)} px y se piden {LADO_CORTO_MIN_IMAGEN} o más")
    if not _relacion_valida(ancho, alto):
        problemas.append(f"su relación es {ancho / alto:.2f}:1 y se pide 16:9 o 9:16 (±{TOLERANCIA_ASPECTO:.0%})")
    if problemas:
        raise _Uso(f"La imagen {ruta.name} mide {ancho}×{alto}: {' y '.join(problemas)}. El modelo de clip a "
                   f"partir de imagen exige una imagen de {LADO_CORTO_MIN_IMAGEN} px o más de lado corto y de 16:9 o 9:16 "
                   "(es un requisito de la página del modelo, docs/modelos-ia/DATOS-FAL-2026-10-08.md §4); con otra se "
                   "gastaría la única llamada para nada. No se gastó nada. Usa otra imagen, o --imagen-sin-validar "
                   "si quieres probarla a propósito.")


def _preparar_salida(salida: Path) -> None:
    """Crea la carpeta y prueba que se puede escribir (crea y borra un archivo temporal)."""
    prueba = salida / f".prueba-escritura-{os.getpid()}"
    try:
        salida.mkdir(parents=True, exist_ok=True)
        prueba.write_bytes(b"ok")
        prueba.unlink()
    except OSError as err:
        _borrar(prueba)
        raise _Uso(f"No puedo escribir en la carpeta de salida {salida}: {err}. No se gastó nada; "
                   "elige otra con --salida.") from err


def _preflight(plan: Plan) -> None:
    """Con --si: todo lo que se pueda comprobar se comprueba ANTES de gastar."""
    clave = os.getenv("FAL_KEY") or ""
    if not clave:
        raise _Uso("Falta FAL_KEY en el entorno o en el .env de esta carpeta "
                   "(la clave la pone el dueño; aquí no se imprime).")
    if clave != clave.strip() or not clave.isprintable() or any(c.isspace() for c in clave):
        raise _Uso("FAL_KEY trae espacios o caracteres de control (¿un salto de línea al final?): fal la "
                   "rechazaría y el error podría delatarla. Corrígela en el entorno o en el .env. "
                   "No se gastó nada (la clave no se imprime).")
    if not _ffprobe_exe():
        raise _Uso("Falta ffprobe (viene con ffmpeg): sin él no se puede medir lo que llegue, "
                   "y no se gasta una prueba que no se pueda comprobar.")
    if plan.salida.exists() and not plan.salida.is_dir():
        raise _Uso(f"--salida no es una carpeta: {plan.salida}")
    if plan.imagen:
        _validar_imagen(plan)
    _preparar_salida(plan.salida)


def main(argv: list[str] | None = None) -> int:
    _salida_segura()
    a = _analizar(argv)
    with _logs_sin_clave(), _sin_trazado(apagar=not a.si):
        try:
            plan = _preparar(a)
            _planear_y_comprobar(plan)
            if not a.si:
                _imprimir_plan(plan, "ENSAYO")
                if plan.tarea == "clip" and plan.imagen:
                    _decir(f"  con --si se mide la imagen antes de gastar: lado corto de {LADO_CORTO_MIN_IMAGEN} px "
                           "o más y 16:9 o 9:16 (sin --formato, el formato sale de ella)")
                _decir("  NO se llamó a nada. Para gastar de verdad, repite el comando con --si.")
                return 0

            _cargar_env()
            formato_antes = plan.formato
            _preflight(plan)
            if plan.formato != formato_antes:       # el formato salió de la imagen: el plan se rehace con él
                _planear_y_comprobar(plan)
            return _correr(plan)
        except _Uso as err:
            _decir(str(err), err=True)
            return 2
        except KeyboardInterrupt:
            _decir("Interrumpido. Si la llamada ya había salido, revisa Request Details en el panel de fal.", err=True)
            return 1
        except SystemExit:
            raise
        except BaseException as err:  # noqa: BLE001 — incluye CancelledError: sin traza cruda (llevaría la clave)
            _decir(f"La herramienta falló: {type(err).__name__}: {err}", err=True)
            return 1


if __name__ == "__main__":
    sys.exit(main())
