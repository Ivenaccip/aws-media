"""Guía de clases · S1 — constantes, límites y validación de lo que el dueño escribe en «Clases».

Python puro (sin boto3, sin FastAPI, sin base): lo importan `server/clases_admin_api.py` y, cuando
lleguen, el worker y la pantalla del alumno. Aquí vive todo lo que decide qué entra y qué no:

  - los LÍMITES (tamaño, tipos, largos, duración) —el servidor se los entrega a la web en
    `limites()`; la web no copia ninguno—;
  - la CLAVE de S3 de cada video, que la fabrica el servidor: `clases/<id>/video.<ext>`. Nada del
    navegador entra a esa clave (ni el nombre del archivo, ni una ruta): la extensión sale de una
    lista cerrada y el id lo genera `id_nuevo()`;
  - la validación del título, el resumen, la fecha y la liga.

`clases/` NO está en `media_rutas.SERVIBLES_CDN` y no debe estarlo nunca: los videos de las clases
solo se ven con una URL firmada de S3 (tests/test_cdn_lista_blanca.py lo fija).

Cada validador devuelve el valor ya limpio o levanta `ValorInvalido(codigo)`; quien llama (el API)
traduce el código a un `{codigo, texto}` con su estado HTTP. Aquí no hay textos para la persona.
"""
from __future__ import annotations

import ipaddress
import re
import secrets
import unicodedata
from datetime import date, timedelta
from urllib.parse import urlsplit

# ---------------------------------------------------------------------------
# límites (sección 5.4 de docs/DISENO-GUIA.md). Los lee el servidor y los entrega en `limites()`.

MAX_BYTES = 5 * 1024**3        # tope del PUT prefirmado de UNA parte (el de S3; el mismo de media_api)
PRESIGN_S = 15 * 60            # cuánto vale la URL de subida
VISTA_S = 2 * 60 * 60          # la vista previa del dueño: una clase larga no se puede congelar a la hora
DURACION_MIN_S = 60            # provisional (v1); lo recalibra S5. Lo aplica el costo de S4, no `medir`
DURACION_MAX_S = 7200
TITULO_MAX = 120
RESUMEN_MAX = 140
NUMERO_MIN = 1
NUMERO_MAX = 999
LIGA_MAX = 500
NOMBRE_MAX = 120               # el nombre del archivo tal como se muestra
ARCHIVO_MAX = 255              # lo más largo que acepta un sistema de archivos

# Lista CERRADA, de extensiones Y de tipos: el precedente (`clip_api.presign`) firma el que mande el
# navegador sin lista y no se copia. Un tipo que no esté aquí no se firma ni se confirma.
EXTENSIONES: tuple[str, ...] = (".mp4", ".mov", ".m4v")
CONTENT_TYPES: tuple[str, ...] = ("video/mp4", "video/quicktime", "video/x-m4v")

# Los hosts de ligas que el dueño autoriza (p. ej. "youtube.com", "vimeo.com"). Vacío = cualquier
# nombre de host público; las demás reglas de `validar_liga` valen igual. La liga NO se descarga ni
# se transcribe nunca: solo se guarda como referencia (sección 8, SSRF).
HOSTS_PERMITIDOS: tuple[str, ...] = ()

PREFIJO = "clases/"

# estados (sección 3.3 de docs/DISENO-GUIA.md). S1 solo usa los tres primeros; el resto los escribe S4.
BORRADOR, SUBIENDO, SUBIDO, PROCESANDO, LISTA, ERROR = (
    "borrador", "subiendo", "subido", "procesando", "lista", "error")
ESTADOS = (BORRADOR, SUBIENDO, SUBIDO, PROCESANDO, LISTA, ERROR)
# en cuáles ya hay un video confirmado en S3 (la vista previa solo se firma en estos)
ESTADOS_CON_VIDEO = (SUBIDO, PROCESANDO, LISTA, ERROR)

ORIGENES = ("archivo", "liga")


def limites() -> dict:
    """Lo que la web necesita saber para no duplicar constantes (va en la lista del admin)."""
    return {
        "max_bytes": MAX_BYTES,
        "extensiones": list(EXTENSIONES),
        "content_types": list(CONTENT_TYPES),
        "presign_s": PRESIGN_S,
        "duracion_min_s": DURACION_MIN_S,
        "duracion_max_s": DURACION_MAX_S,
        "titulo_max": TITULO_MAX,
        "resumen_max": RESUMEN_MAX,
        "numero_min": NUMERO_MIN,
        "numero_max": NUMERO_MAX,
        "liga_max": LIGA_MAX,
    }


class ValorInvalido(ValueError):
    """Un dato que no pasó. `codigo` es el del catálogo de errores del API."""

    def __init__(self, codigo: str):
        self.codigo = codigo
        super().__init__(codigo)


# ---------------------------------------------------------------------------
# ids y claves de S3

_ID = re.compile(r"cl-[0-9a-f]{8}")


def id_nuevo() -> str:
    """`cl-` + 8 hex, como el `ed-<8 hex>` de E2. Siempre lo genera el servidor."""
    return "cl-" + secrets.token_hex(4)


def es_id(valor) -> bool:
    return isinstance(valor, str) and _ID.fullmatch(valor) is not None


def clave_video(id_: str, ext: str) -> str:
    """`clases/<id>/video.<ext>`. Es la ÚNICA forma de armar la clave de un video, y por eso sale de
    un id con el formato exacto y de una extensión de la lista cerrada: ni uno ni otro pueden traer
    una barra, un `..` o un nombre de persona."""
    if not es_id(id_):
        raise ValueError("id de clase inválido")
    if ext not in EXTENSIONES:
        raise ValueError("extensión fuera de la lista")
    return f"{PREFIJO}{id_}/video{ext}"


# ---------------------------------------------------------------------------
# texto

def limpiar_texto(valor) -> str:
    """Sin caracteres de control, sin invisibles ni sustitutos sueltos (U+0000 y U+D800 a U+DFFF no
    se pueden guardar en Postgres ni codificar a UTF-8), con los espacios normales y sin bordes."""
    if not isinstance(valor, str):
        return ""
    sin_raros = "".join(c for c in valor if c.isprintable() or c.isspace())
    return " ".join(sin_raros.split())


def validar_titulo(valor) -> str:
    titulo = limpiar_texto(valor)
    if not titulo or len(titulo) > TITULO_MAX:
        raise ValorInvalido("titulo_invalido")
    return titulo


def validar_resumen(valor) -> str | None:
    """«Para qué sirve»: hasta 140 caracteres. Vacío o None = sin resumen."""
    if valor is None:
        return None
    if not isinstance(valor, str):
        raise ValorInvalido("resumen_largo")
    resumen = limpiar_texto(valor)
    if len(resumen) > RESUMEN_MAX:
        raise ValorInvalido("resumen_largo")
    return resumen or None


def validar_numero(valor) -> int:
    """El «Clase N» que ve el alumno: entero de 1 a 999 (un bool no es un número)."""
    if isinstance(valor, bool) or not isinstance(valor, int) or not NUMERO_MIN <= valor <= NUMERO_MAX:
        raise ValorInvalido("numero_invalido")
    return valor


_FECHA = re.compile(r"\d{4}-\d{2}-\d{2}")


def validar_fecha(valor, hoy: date | None = None) -> str | None:
    """`grabada_en`: «AAAA-MM-DD», real, desde el 2000 y a lo sumo mañana (el día de quien graba
    puede ir adelantado respecto del servidor). Vacío o None = sin fecha. Devuelve el texto ISO."""
    if valor is None or valor == "":
        return None
    if not isinstance(valor, str) or not _FECHA.fullmatch(valor):
        raise ValorInvalido("fecha_invalida")
    try:
        d = date.fromisoformat(valor)
    except ValueError:
        raise ValorInvalido("fecha_invalida") from None
    if d < date(2000, 1, 1) or d > (hoy or date.today()) + timedelta(days=1):
        raise ValorInvalido("fecha_invalida")
    return d.isoformat()


_CLAVE = re.compile(r"[A-Za-z0-9_-]{8,64}")


_TOKEN = re.compile(r"[0-9a-f]{32}")


def token_nuevo() -> str:
    """El TOKEN de una subida: 32 hex que fabrica el servidor al pasar la clase a `subiendo` y que la web
    devuelve en `confirmar` y `cancelar` para que una subida que ya no es la vigente (la huérfana de otra
    pestaña, la que se canceló) no toque la nueva. No es un permiso —quien puede confirmar es el admin—,
    es la identidad de UNA subida; nunca llega a una clave de S3 ni a un log."""
    return secrets.token_hex(16)


def validar_token(valor) -> str:
    """El `token` que manda la web: tiene que ser una cadena de 32 hex (lo único que `token_nuevo` fabrica)."""
    if not isinstance(valor, str) or not _TOKEN.fullmatch(valor):
        raise ValorInvalido("clave_invalida")
    return valor


def validar_clave(valor) -> str:
    """La `clave` de idempotencia que manda el navegador (un UUID): solo se usa para reconocer el
    doble clic; nunca llega a una clave de S3."""
    if not isinstance(valor, str) or not _CLAVE.fullmatch(valor):
        raise ValorInvalido("clave_invalida")
    return valor


# ---------------------------------------------------------------------------
# archivo, tipo y tamaño de la subida

def nombre_para_mostrar(nombre) -> str | None:
    """El nombre del archivo como la persona lo vio («Clase 5 final.mp4»), limpio para guardarse y
    pintarse: sin ruta, sin invisibles y de 120 caracteres o menos. SOLO para mostrar: no entra a
    ninguna clave de S3."""
    if not isinstance(nombre, str):
        return None
    base = nombre.replace("\\", "/").rsplit("/", 1)[-1]
    return limpiar_texto(base)[:NOMBRE_MAX] or None


def _caracter_de_nombre_ok(c: str) -> bool:
    """¿Cabe en el nombre de un archivo que eligió una persona? Todo lo imprimible y, además, los
    espacios SEPARADORES de Unicode (categoría Zs: U+00A0, U+202F, U+2009, U+3000…), que `isprintable()`
    rechaza aunque son espacios de verdad: el espacio fino (U+202F) antes de «PM» es justo como macOS 13
    o posterior nombra una grabación de pantalla. Los controles (`\\t`, `\\n`, `\\x85`, categoría Cc), los
    separadores de línea y de párrafo (U+2028 y U+2029, Zl y Zp) y los invisibles (U+200B, U+202E…,
    Cf) siguen fuera."""
    return c.isprintable() or unicodedata.category(c) == "Zs"


def validar_archivo(archivo) -> tuple[str, str | None]:
    """(extensión en minúsculas, nombre para mostrar) de lo que dice el navegador que sube.

    Un nombre con barras (`../../x.mp4`, `a/b.mp4`, `..\\x.mp4`) o con caracteres de control NO es el
    nombre de un archivo que eligió una persona: se rechaza. Los espacios Unicode (Zs) sí pasan, y
    `nombre_para_mostrar` los vuelve un espacio normal. La extensión tiene que estar en la lista
    cerrada. El nombre nunca llega a la clave de S3."""
    if not isinstance(archivo, str) or not archivo or len(archivo) > ARCHIVO_MAX:
        raise ValorInvalido("nombre_invalido")
    if "/" in archivo or "\\" in archivo or not all(_caracter_de_nombre_ok(c) for c in archivo):
        raise ValorInvalido("nombre_invalido")
    punto = archivo.rfind(".")
    ext = archivo[punto:].lower() if punto > 0 else ""
    if ext not in EXTENSIONES:
        raise ValorInvalido("extension_no_soportada")
    return ext, nombre_para_mostrar(archivo)


def validar_content_type(valor) -> str:
    """El tipo con el que se firma el PUT: uno de la lista cerrada, tal cual (sin parámetros)."""
    tipo = valor.strip().lower() if isinstance(valor, str) else ""
    if tipo not in CONTENT_TYPES:
        raise ValorInvalido("tipo_no_soportado")
    return tipo


def tipo_de_cabecera(valor) -> str:
    """El `ContentType` de un `head_object`, sin parámetros y en minúsculas (para compararlo)."""
    return valor.split(";", 1)[0].strip().lower() if isinstance(valor, str) else ""


def validar_tamano_declarado(valor) -> int:
    """Los bytes que el navegador DICE que va a subir: de 1 a 5 GiB. El tamaño no queda firmado en la
    URL, así que `confirmar` vuelve a medirlo con un HEAD."""
    if isinstance(valor, bool) or not isinstance(valor, int) or not 0 < valor <= MAX_BYTES:
        raise ValorInvalido("tamano_invalido")
    return valor


# ---------------------------------------------------------------------------
# la liga: SOLO se guarda como referencia

# Nombres que nunca son un sitio público: la liga no se descarga, pero tampoco se guarda una que
# apunte adentro de nuestra red si algún día alguien la descarga.
_SUFIJOS_INTERNOS = ("localhost", "local", "localdomain", "internal", "intranet", "lan", "home",
                     "corp", "invalid", "test")
_ETIQUETA = re.compile(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?")
_TLD = re.compile(r"(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})")


def validar_liga(valor) -> str:
    """`https://sitio.com/lo-que-sea`, 500 caracteres o menos, y nada más.

    Rechaza: cualquier esquema que no sea `https` (`javascript:`, `file:`, `http:`, `data:`…),
    credenciales (`usuario:clave@`), IP literal en cualquier forma (`169.254.169.254`, `[::1]`,
    `2130706433`, `0x7f.0.0.1`), `localhost` y los nombres de red interna, un puerto que no sea el
    443, espacios, barras invertidas y caracteres que no sean ASCII (los nombres con acentos viajan
    como `xn--`). Un host sin punto o cuya última etiqueta no sea una palabra (`.254`, `.1`) no
    existe en internet: también se rechaza. Si el dueño fijó `HOSTS_PERMITIDOS`, el host tiene que
    ser uno de ellos o un subdominio."""
    if not isinstance(valor, str):
        raise ValorInvalido("liga_invalida")
    liga = valor.strip()
    if not liga or len(liga) > LIGA_MAX:
        raise ValorInvalido("liga_invalida")
    if not liga.isascii() or any(c.isspace() or not c.isprintable() or c == "\\" for c in liga):
        raise ValorInvalido("liga_invalida")
    try:
        partes = urlsplit(liga)
        puerto = partes.port
        host = partes.hostname
    except ValueError:
        raise ValorInvalido("liga_invalida") from None
    if partes.scheme != "https" or not host or "@" in partes.netloc:
        raise ValorInvalido("liga_invalida")
    if puerto not in (None, 443) or ":" in host:
        raise ValorInvalido("liga_invalida")
    try:
        ipaddress.ip_address(host)
    except ValueError:
        pass
    else:
        raise ValorInvalido("liga_invalida")
    etiquetas = host.split(".")
    if len(etiquetas) < 2 or len(host) > 253:
        raise ValorInvalido("liga_invalida")
    if not all(_ETIQUETA.fullmatch(e) for e in etiquetas) or not _TLD.fullmatch(etiquetas[-1]):
        raise ValorInvalido("liga_invalida")
    if etiquetas[-1] in _SUFIJOS_INTERNOS:
        raise ValorInvalido("liga_invalida")
    if HOSTS_PERMITIDOS and not any(host == h or host.endswith("." + h) for h in HOSTS_PERMITIDOS):
        raise ValorInvalido("liga_invalida")
    return liga
