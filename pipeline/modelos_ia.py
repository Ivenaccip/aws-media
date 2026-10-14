"""R4 · F1 — la tabla de modelos de IA que el usuario puede elegir.

Un id de modelo («grok», «veo-lite», «veo-fast», «nb2»…) es lo único que cruza del
navegador al servidor. De aquí sale a qué endpoint de fal se llama, y de
tools/tarifas.json §modelos sale cuánto se cobra: el navegador NUNCA manda un
precio ni un endpoint.

Estar en esta tabla NO es estar a la venta. Una fila con su endpoint, sus
parámetros y su costo en dólares (tools/pricing.json §generacion.endpoints) es
una fila INERTE: el servidor la conoce, pero mientras tools/tarifas.json
§modelos no tenga su número de créditos no se ofrece y se rechaza con 422, sin
cobrar, sin crear documento y sin encolar (pipeline/creditos.py::costo_modelo
levanta KeyError). Ese número lo escribe el dueño DESPUÉS de la prueba pagada, y
es la compuerta: recién entonces `activo: true` en el catálogo de la web
(web/src/pantallas/inicio/modelos.ts). Hoy están a la venta Grok y Veo 3.1 Lite y, desde
el 9-oct-2026 (tras su prueba pagada), Nano Banana 2 y Veo 3.1 Fast. El 11-oct-2026, tras la
suya (18 llamadas y el panel de fal), se encendieron en la rama también FLUX.2 klein 9B, Z-Image
Turbo, FLUX.2 pro, Seedream 5.0 Flash, Seedream 4.5 y FLUX 3, solo para crear; se ofrecen al
desplegarla. El 12-oct-2026, tras su prueba pagada de 4 llamadas y el panel de fal, se encendieron también en
la rama las dos filas de Nano Banana Pro (`nbp-2k` y `nbp-4k`, solo crear); se ofrecen al desplegarla. Veo 3.1
Standard sigue inerte: sin número en tarifas.json da 422 antes de cobrar. Los clips de las otras familias
(Ola 4) tienen fila y adaptador (`pipeline/clip_familias.py`). El 13-oct-2026, tras su prueba pagada y el cobro en el
panel de fal, se encendieron MiniMax H3 Max Turbo (16, 22 y 30 créditos a 4, 6 y 8 s: decisión del dueño), Grok Imagine
Video (26, 38 y 50) y Grok Imagine Video 1.5 Lite (12, 18 y 24); se ofrecen al desplegar la rama. Siguen INERTES LTX-2.5
Fast, Kling V3 Pro y Seedance 2.0: sin número en tarifas.json dan 422 antes de cobrar.

Un id que no está aquí se rechaza con 422 igual: no se cae al modelo de siempre,
porque cobraría uno y entregaría otro.

Lo mismo con la duración del clip: cada modelo declara aquí los segundos que
admite y tools/tarifas.json §modelos.clip trae el precio de cada uno. Una
duración que el modelo no admite, o que no tiene número, se rechaza con 422: no
se cambia en silencio a otra, porque cobraría una y entregaría otra.

Los argumentos que un modelo necesita fijos (p. ej. la resolución de Nano Banana
2: solo la de 1K tiene tarifa leída) viajan en `Modelo.args_extra`: no dependen
del valor por defecto del modelo en fal, que puede cambiar sin avisar. Son un PIN:
si la tarea manda la misma llave, gana la del modelo (el precio solo vale con ese
valor), y una llave que la tarea manda siempre (prompt, imágenes, aspecto,
duración) no se puede fijar.

Los intentos de un clip también son del modelo (`Modelo.max_intentos`): un timeout
de cliente no cancela el trabajo en fal, así que reintentar un modelo caro puede
cobrar dos veces. Veo 3.1 Fast y Standard hacen un solo intento.

Y si una imagen se genera dentro de la petición o en segundo plano también lo decide
el modelo (`Modelo.segundo_plano`): la Lambda del API corta a los 29 s (API Gateway:
tope fijo de 30 s) y un arranque en frío ya gasta unos 16, así que un modelo que tardó
más de 10 s en la prueba pagada no cabe en la petición. Esos se encolan como el clip
(server/imagen_cola.py, worker/imagen_generar.py); los rápidos siguen síncronos. Las dos
excepciones a la regla son Grok (13 a 29 s medidos) y Nano Banana 2 al crear (11.7 s): siguen
síncronos «de momento» por decisión del dueño del 11-oct-2026 (docs/OPERACION.md).
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping

from .config import settings

TAREAS = ("imagen", "editar", "clip")
PREDETERMINADO = {"imagen": "grok", "editar": "grok", "clip": "veo-lite"}

# La duración del clip cuando el pedido no dice nada: lo que el producto siempre
# prometió («8 s con sonido») y el slot máximo de Veo. Solo es un valor
# predeterminado: cada modelo declara abajo las que de verdad admite.
DURACION_PREDETERMINADA_S = 8

# clip: la familia de argumentos de un modelo. Cada una pide distinto la duración (número, texto, «8s»),
# la resolución, el audio y la imagen de entrada, así que `pipeline/clip_familias.py` trae un armador por
# familia y `clip.animar` elige el de la fila (Veo, la de siempre, se arma en `pipeline/clip.py`).
FAMILIAS_CLIP = ("veo", "minimax", "grok", "grok_lite", "ltx", "kling", "seedance")


class ModeloDesconocido(ValueError):
    """El id no existe para esa tarea. Es un error del pedido (422), no nuestro."""


class AspectoNoAdmitido(ModeloDesconocido):
    """El modelo pide el tamaño con valores propios («image_size») y no tiene traducción
    para ese aspecto. Error del pedido (422), igual que la duración: no se cambia en
    silencio a otro aspecto, porque se entregaría una imagen que nadie pidió."""


class DuracionNoAdmitida(ModeloDesconocido):
    """El modelo existe, pero no hace clips de esa duración. También es un error
    del pedido (422); hereda de ModeloDesconocido para que un solo `except` cubra
    las dos y la API pueda distinguirlas cuando quiera."""


class AudioNoAdmitido(ModeloDesconocido):
    """El modelo existe, pero su endpoint no deja pedir el clip sin sonido (o llegó algo que
    no es verdadero ni falso). Error del pedido (422), igual que la duración: no se ignora en
    silencio, porque se cobraría «sin sonido» y se entregaría con él."""


# Llaves que la TAREA manda siempre (el texto, las imágenes, el aspecto, los
# segundos): ningún modelo puede fijarlas en `args_extra`, porque pisaría lo que el
# usuario pidió y se cobró. `image_url` es la imagen de entrada de la familia Veo (y `start_image_url`, la de Kling).
LLAVES_PROTEGIDAS = frozenset(
    {"prompt", "image_urls", "image_url", "start_image_url", "end_image_url", "num_images",
     "aspect_ratio", "image_size", "duration"})


def _normaliza_args_extra(id_: str, valor) -> tuple[tuple[str, object], ...]:
    """Los argumentos fijos como tupla inmutable de pares (llave, valor), ordenada
    por llave: dos modelos con los mismos argumentos son iguales, vengan como
    vengan. Acepta un dict (o cualquier Mapping) o una secuencia de pares.

    Se guardan como tupla y NO como un `MappingProxyType`: éste no se puede copiar
    con `copy.deepcopy`, serializar con `pickle` ni recorrer con
    `dataclasses.asdict`, y rompía todo Modelo (incluido Grok)."""
    if isinstance(valor, Mapping):
        pares = list(valor.items())
    else:
        try:
            pares = [tuple(p) for p in valor]
        except TypeError as err:
            raise TypeError(f"args_extra de {id_!r}: se esperaba un dict o pares "
                            f"(llave, valor), llegó {type(valor).__name__}") from err
    vistas: set[str] = set()
    for par in pares:
        if len(par) != 2:
            raise ValueError(f"args_extra de {id_!r}: cada argumento es un par (llave, valor)")
        llave, dato = par
        if not isinstance(llave, str) or not llave:
            raise ValueError(f"args_extra de {id_!r}: la llave {llave!r} debe ser un texto")
        if llave in LLAVES_PROTEGIDAS:
            raise ValueError(
                f"args_extra de {id_!r}: «{llave}» lo manda la tarea y un modelo no puede "
                f"fijarlo (llaves protegidas: {', '.join(sorted(LLAVES_PROTEGIDAS))})")
        if llave in vistas:
            raise ValueError(f"args_extra de {id_!r}: la llave «{llave}» está repetida")
        vistas.add(llave)
        try:
            hash(dato)
        except TypeError as err:
            raise ValueError(
                f"args_extra de {id_!r}: el valor de «{llave}» debe ser inmutable "
                f"(texto, número, booleano, None o tupla)") from err
    return tuple(sorted(pares, key=lambda par: par[0]))


# Los aspectos que la caja de imágenes sabe pedir (server/app.py::ASPECTOS_IMAGEN) y las
# dos formas con que un endpoint de imagen pide el tamaño.
ASPECTOS_CAJA = ("1:1", "16:9", "9:16")
LLAVES_DE_TAMANO = ("aspect_ratio", "image_size")


def _normaliza_tamanos(id_: str, llave: str, valor) -> tuple[tuple[str, object], ...]:
    """Los tamaños como tupla inmutable de pares (aspecto, valor), ordenada por aspecto.

    Con «aspect_ratio» no hay tabla (el aspecto viaja tal cual). Con «image_size» hace
    falta un valor para CADA aspecto de la caja: un aspecto sin traducción dejaría al
    modelo a medias (se cobraría y no se podría llamar), así que se rechaza al
    construir la fila. El valor es un texto de fal («square_hd») o un par (ancho, alto)
    de enteros: un dict no sería inmutable."""
    if isinstance(valor, Mapping):
        pares = list(valor.items())
    else:
        pares = [tuple(p) for p in (valor or ())]
    if llave == "aspect_ratio":
        if pares:
            raise ValueError(f"tamanos de {id_!r}: con llave_tamano «aspect_ratio» el aspecto "
                             f"viaja tal cual y no lleva tabla")
        return ()
    vistos: set[str] = set()
    for par in pares:
        if len(par) != 2:
            raise ValueError(f"tamanos de {id_!r}: cada tamaño es un par (aspecto, valor)")
        aspecto, dato = par
        if aspecto not in ASPECTOS_CAJA:
            raise ValueError(f"tamanos de {id_!r}: «{aspecto}» no es un aspecto de la caja "
                             f"({', '.join(ASPECTOS_CAJA)})")
        if aspecto in vistos:
            raise ValueError(f"tamanos de {id_!r}: el aspecto «{aspecto}» está repetido")
        vistos.add(aspecto)
        if isinstance(dato, str):
            ok = bool(dato.strip())
        else:
            ok = (isinstance(dato, tuple) and len(dato) == 2
                  and all(type(n) is int and n > 0 for n in dato))
        if not ok:
            raise ValueError(f"tamanos de {id_!r}: el valor de «{aspecto}» debe ser un texto de "
                             f"fal o un par (ancho, alto) de enteros positivos, no {dato!r}")
    faltan = [a for a in ASPECTOS_CAJA if a not in vistos]
    if faltan:
        raise ValueError(f"tamanos de {id_!r}: falta la traducción de {', '.join(faltan)}")
    return tuple(sorted(pares, key=lambda par: par[0]))


@dataclass(frozen=True)
class Modelo:
    id: str
    tarea: str
    endpoint: str                      # imagen: crear; clip: sin imagen (text-to-video)
    endpoint_con_imagen: str = ""      # editar/clip con imagen ("" = el mismo)
    # clip: ¿trae audio este modelo? El producto promete «8 s con sonido».
    con_audio: bool = False
    # clip: ¿el endpoint trae `generate_audio`, o sea que se puede pedir CON o SIN sonido? Solo los que
    # lo traen en su esquema (Veo, LTX, Kling y Seedance). MiniMax, Grok y Grok Lite no: su clip
    # trae la pista que trae y no se puede apagar. Pedir «sin sonido» a uno de esos es un 422.
    audio_opcional: bool = False
    # clip: los segundos enteros que admite. Vacío = la tarea no tiene duración.
    # Un modelo que no admite 4 s (p. ej. LTX) simplemente no la trae aquí.
    duraciones: tuple[int, ...] = ()
    # Argumentos que este modelo manda SIEMPRE además de los de la tarea (imagen:
    # los de `media_fal`). Tupla inmutable de pares (llave, valor): al construir se
    # acepta un dict, se copia y se ordena por llave, así que ni quien lo pasó ni
    # quien lo lea puede cambiarlo después, y el Modelo se copia, serializa y
    # compara sin sorpresas. Son un pin: ver `con_args_extra`.
    args_extra: tuple[tuple[str, object], ...] = ()
    # clip: la familia de argumentos con que se le habla a este endpoint (FAMILIAS_CLIP). Las filas de
    # imagen la ignoran.
    familia_clip: str = "veo"
    # clip: tope de intentos de este modelo. 0 = vale el de settings.clip_max_attempts.
    # Con N > 0 se usa min(settings.clip_max_attempts, N): un modelo puede pedir
    # MENOS intentos que el ambiente, nunca más. Un timeout de cliente no cancela el
    # trabajo en fal, así que un reintento puede cobrar dos veces; en los modelos
    # caros (Veo 3.1 Standard, $3.20 dólares por clip de 8 s) se fija en 1.
    max_intentos: int = 0
    # imagen: cómo pide el tamaño de salida este endpoint. «aspect_ratio» (Grok, Nano
    # Banana, FLUX 3): se manda el aspecto de la caja tal cual («16:9»). «image_size»
    # (FLUX.2, Z-Image, Seedream, GPT Image): cada familia habla con valores propios
    # («square_hd», «landscape_16_9»…), y `tamanos` trae el de cada aspecto de la caja.
    llave_tamano: str = "aspect_ratio"
    tamanos: tuple[tuple[str, object], ...] = ()
    # imagen: ¿el endpoint trae `num_images`? La tarea lo manda siempre, salvo a los que
    # su esquema no lo trae (FLUX.2 pro y FLUX 3, leído el 11-oct-2026): ahí no se manda,
    # en vez de esperar que fal lo ignore.
    con_num_images: bool = True
    # imagen: hasta cuántos megapíxeles de SALIDA vale el costo de su ficha en
    # tools/pricing.json. Los que cobran por megapíxel (FLUX.2, Z-Image, FLUX 3) se anotan
    # a ~1 MP; si llegara una imagen mucho mayor, lo cobrado sería otro. 0 = sin tope (precio
    # fijo por imagen, como Seedream). Solo lo usa la prueba pagada para marcar REVISAR.
    megapixeles_ficha: float = 0.0
    # imagen: ¿se genera en segundo plano (cobrar → doc en S3 → cola → worker) y no dentro
    # de la petición? Verdadero para los que tardaron MÁS DE 10 s en la prueba pagada: la
    # Lambda del API corta a los 29 s (API Gateway HTTP API: tope fijo de 30 s) y un arranque
    # en frío gasta unos 16; cortada la petición, se cobra, no se devuelve y fal cobra igual.
    # Una bandera por fila: mover un modelo de un camino al otro es cambiar este booleano.
    # Grok es la excepción: midió 13–29 s y sigue en False por decisión pendiente del dueño.
    # Solo aplica a CREAR (`POST /api/imagenes`) y solo en la nube; en local todo es síncrono.
    segundo_plano: bool = False

    def __post_init__(self):
        # frozen: la única forma de reemplazar el campo es object.__setattr__
        object.__setattr__(self, "args_extra", _normaliza_args_extra(self.id, self.args_extra))
        if type(self.max_intentos) is not int or self.max_intentos < 0:
            raise ValueError(f"max_intentos de {self.id!r} debe ser un entero de 0 o más "
                             f"(0 = los de settings.clip_max_attempts)")
        mp = self.megapixeles_ficha
        if isinstance(mp, bool) or not isinstance(mp, (int, float)) or not mp >= 0:
            raise ValueError(f"megapixeles_ficha de {self.id!r} debe ser un número de 0 o más "
                             f"(0 = sin tope), no {mp!r}")
        if self.familia_clip not in FAMILIAS_CLIP:
            raise ValueError(f"familia_clip de {self.id!r} debe ser una de "
                             f"{', '.join(FAMILIAS_CLIP)}, no {self.familia_clip!r}")
        if type(self.segundo_plano) is not bool:
            raise ValueError(f"segundo_plano de {self.id!r} debe ser True o False, "
                             f"no {self.segundo_plano!r}")
        if type(self.audio_opcional) is not bool:
            raise ValueError(f"audio_opcional de {self.id!r} debe ser True o False, "
                             f"no {self.audio_opcional!r}")
        if self.llave_tamano not in LLAVES_DE_TAMANO:
            raise ValueError(f"llave_tamano de {self.id!r} debe ser una de "
                             f"{', '.join(LLAVES_DE_TAMANO)}, no {self.llave_tamano!r}")
        object.__setattr__(self, "tamanos", _normaliza_tamanos(self.id, self.llave_tamano,
                                                                self.tamanos))

    @property
    def args_extra_dict(self) -> dict:
        """Los argumentos fijos como un dict NUEVO cada vez (cambiarlo no toca al modelo)."""
        return dict(self.args_extra)

    def endpoint_para(self, con_imagen: bool) -> str:
        return (self.endpoint_con_imagen or self.endpoint) if con_imagen else self.endpoint

    @property
    def admite_referencia(self) -> bool:
        """¿Tiene endpoint propio para partir de una imagen? Un modelo de solo texto a
        imagen (FLUX.2, Z-Image…) no la admite: mandarle `image_urls` a su endpoint de
        crear no es editar, es un argumento que fal puede ignorar y cobrar igual."""
        return bool(self.endpoint_con_imagen)

    def args_de_imagen(self, prompt: str, aspecto: str, num_imagenes: int = 1) -> dict:
        """Los argumentos de «crear una imagen» en el idioma de este endpoint: el
        prompt, `num_images` (si el endpoint lo trae) y el tamaño, ya traducido. Con
        «aspect_ratio» el aspecto viaja tal cual y Grok manda exactamente lo de siempre;
        con «image_size» sale el valor de `tamanos`, o AspectoNoAdmitido."""
        args: dict = {"prompt": prompt}
        if self.con_num_images:
            args["num_images"] = num_imagenes
        if self.llave_tamano == "aspect_ratio":
            args["aspect_ratio"] = aspecto
            return args
        valor = dict(self.tamanos).get(aspecto)
        if valor is None:
            raise AspectoNoAdmitido(
                f"El modelo {self.id} no tiene tamaño para el aspecto {aspecto!r}. "
                f"Aspectos disponibles: {', '.join(a for a, _ in self.tamanos)}.")
        args["image_size"] = ({"width": valor[0], "height": valor[1]}
                              if isinstance(valor, tuple) else valor)
        return args

    def con_args_extra(self, args: dict) -> dict:
        """`args` con los argumentos fijos del modelo sumados. Los del MODELO ganan:
        son un pin, no un valor por defecto. Nano Banana 2 solo tiene leído el
        precio de 1K ($0.08 dólares), así que si una tarea futura manda `resolution`
        (p. ej. la calidad de Nano Banana Pro) no puede subirle la resolución a un
        modelo que cobra por 1K. Las llaves de la tarea (prompt, imágenes…) están
        protegidas al construir el Modelo, así que el pin nunca las pisa. Sin extra
        devuelve una copia idéntica, así que Grok manda exactamente lo que mandaba."""
        return {**args, **self.args_extra_dict} if self.args_extra else dict(args)


# Endpoints de la familia Veo 3.1 que NO viven en settings: el costo en dólares
# se anota por nombre exacto de endpoint (pricing.json §generacion.endpoints), así
# que sobrescribirlos por entorno dejaría la llamada sin costo conocido.
VEO_FAST_T2V = "fal-ai/veo3.1/fast"
VEO_FAST_I2V = "fal-ai/veo3.1/fast/image-to-video"
VEO_STD_T2V = "fal-ai/veo3.1"
VEO_STD_I2V = "fal-ai/veo3.1/image-to-video"
# Ola 4 (clips de otras familias). Endpoints y parámetros leídos del esquema público de fal el 12-oct-2026
# (tools/leer_esquema_fal.py --ola4; docs/modelos-ia/DATOS-FAL-2026-10-08.md §14). Grok Video tiene tres
# versiones: la base, la 1.5 (a $0.14 dólares por segundo, sin fila: decisión del dueño) y la 1.5 Lite (más abajo).
H3T_T2V = "minimax/h3-max-turbo/text-to-video"
H3T_I2V = "minimax/h3-max-turbo/image-to-video"
GROKV_T2V = "xai/grok-imagine-video/text-to-video"
GROKV_I2V = "xai/grok-imagine-video/image-to-video"
# Grok Imagine Video 1.5 Lite: la versión barata de la 1.5 (esquema leído el 12-oct-2026; DATOS §16). Es otra
# familia de argumentos que la base: su image-to-video no tiene `aspect_ratio`.
GROKL_T2V = "xai/grok-imagine-video/v1.5/lite/text-to-video"
GROKL_I2V = "xai/grok-imagine-video/v1.5/lite/image-to-video"
LTX_T2V = "lightricks/ltx-2.5/text-to-video/fast"
LTX_I2V = "lightricks/ltx-2.5/image-to-video/fast"
KLING_T2V = "fal-ai/kling-video/v3/pro/text-to-video"
KLING_I2V = "fal-ai/kling-video/v3/pro/image-to-video"
SEED_T2V = "bytedance/seedance-2.0/text-to-video"
SEED_I2V = "bytedance/seedance-2.0/image-to-video"
NB2_CREAR = "fal-ai/nano-banana-2"
NB2_EDITAR = "fal-ai/nano-banana-2/edit"
NBP_CREAR = "fal-ai/nano-banana-pro"
# Ola 2 (familias nuevas de imagen): todos solo texto a imagen (sin endpoint de editar en el
# selector). Endpoints y parámetros leídos del esquema público de fal el 11-oct-2026
# (tools/leer_esquema_fal.py; docs/modelos-ia/DATOS-FAL-2026-10-08.md §10).
KLEIN_CREAR = "fal-ai/flux-2/klein/9b"
ZIT_CREAR = "fal-ai/z-image/turbo"
FLUX2_CREAR = "fal-ai/flux-2-pro"
SDF_CREAR = "bytedance/seedream/v5/flash/text-to-image"
SD45_CREAR = "fal-ai/bytedance/seedream/v4.5/text-to-image"
FLUX3_CREAR = "blackforestlabs/flux-3/text-to-image"

# La caja guarda TODA imagen como .jpg (server/app.py) y la sirve como image/jpeg: un PNG
# dentro de un .jpg lo pintan los navegadores, pero no lo aceptan las redes al publicar. Los
# modelos nuevos piden jpeg explícito en vez de depender del valor por defecto de fal (que en
# klein y Z-Image es png). Seedream 4.5 no trae `output_format`: la prueba pagada mira qué llega.
SALIDA_JPEG = (("output_format", "jpeg"),)

# Los tamaños de la familia FLUX.2 (klein, pro) y Z-Image: los valores de `image_size` que
# fal documenta para cada aspecto de la caja. Cuadrado es `square_hd` (1024×1024). Los tres
# están en el enum del esquema de fal (leído el 11-oct-2026, DATOS-FAL §10) y la prueba pagada del
# 10-oct (DATOS-FAL §11) midió lo que llega: 1024×1024, 1024×576 y 576×1024 (0.59 MP los apaisados
# y verticales).
TAMANOS_FLUX = (("1:1", "square_hd"), ("16:9", "landscape_16_9"), ("9:16", "portrait_16_9"))

# Seedream NO usa los valores predefinidos: su esquema pide un mínimo de píxeles que
# `landscape_16_9` no alcanza. Se mandan pares (ancho, alto) explícitos, múltiplos de 16.
#   · 5.0 Flash: entre 1024×1024 y 2048×2048 píxeles en total, relación entre 1/16 y 16.
#   · 4.5: ancho y alto entre 1920 y 4096, o píxeles en total entre 2560×1440 y 4096×4096.
TAMANOS_SDF = (("1:1", (1920, 1920)), ("16:9", (2048, 1152)), ("9:16", (1152, 2048)))
TAMANOS_SD45 = (("1:1", (2048, 2048)), ("16:9", (2752, 1536)), ("9:16", (1536, 2752)))

# Nano Banana 2 solo tiene leída la tarifa de 1K ($0.08 dólares por imagen). Se
# manda explícito para no depender de que el default de fal siga siendo 1K. Y pide jpeg:
# su esquema (leído el 10-oct-2026 hora de México, DATOS-FAL §12) trae `output_format` por defecto en
# "png" en crear y en editar, y la caja guarda lo que baja como .jpg sin convertirlo.
NB2_ARGS_EXTRA = (("output_format", "jpeg"), ("resolution", "1K"))

# Nano Banana Pro (Ola 3, solo crear; encendido el 12-oct-2026): la calidad del catálogo de la web («hasta 2K» y «4K») son DOS filas,
# `nbp-2k` y `nbp-4k` (la llave de tools/tarifas.json es `<id>-<calidad>`), y cada una fija su `resolution`:
# el precio depende de ella (pricing.json `usd_por_resolucion`) y no se deja al valor por defecto de fal (1K).
# Pide jpeg (su esquema trae «png» por defecto: DATOS-FAL §12) y fija `enable_web_search` en false, que en el
# editar cobra $0.015 dólares extra (lectura del 8-oct) y aquí no se ofrece.
NBP_ARGS_BASE = (("enable_web_search", False), ("output_format", "jpeg"))


def _tabla() -> dict[tuple[str, str], Modelo]:
    # Se arma al llamar y no al importar: los endpoints de Grok y Veo Lite viven en
    # settings (se pueden sobrescribir por entorno) y esta tabla debe seguirlos.
    # Grok tarda de 13 a 29 s por imagen (mediana 16; el vertical, 28.7 s: ocho llamadas reales
    # el 18-sep, PLAN-PRODUCTO.md y tools/pricing.json). Por la regla de abajo —segundo plano si
    # algún tiempo medido pasó de 10 s— iría a segundo plano, pero sigue síncrono (sin
    # `segundo_plano`) porque esa decisión es del dueño: docs/OPERACION.md, «Decisión pendiente
    # del dueño: Grok».
    grok = Modelo("grok", "imagen", settings.fal_imagen, settings.fal_imagen_edit)
    veo = Modelo("veo-lite", "clip", settings.fal_veo_t2v, settings.fal_veo,
                 con_audio=True, audio_opcional=True, duraciones=(4, 6, 8))
    # Veo 3.1 Fast y Standard: mismos argumentos que Lite (los arma clip.animar), solo
    # cambia el endpoint. Fast ya está a la venta; Standard sigue INERTE hasta que
    # tarifas.json le ponga créditos. Un solo intento (max_intentos=1): el timeout del
    # clip es de cliente y puede dejar vivo y cobrado el trabajo en fal; Standard son
    # $3.20 dólares por intento a 8 s, hasta 8 veces el de Lite, y devolver créditos no
    # devuelve lo que fal ya cobró.
    veo_fast = Modelo("veo-fast", "clip", VEO_FAST_T2V, VEO_FAST_I2V,
                      con_audio=True, audio_opcional=True, duraciones=(4, 6, 8), max_intentos=1)
    veo_std = Modelo("veo-std", "clip", VEO_STD_T2V, VEO_STD_I2V,
                     con_audio=True, audio_opcional=True, duraciones=(4, 6, 8), max_intentos=1)
    # Ola 4: clips de otras familias. MiniMax, Grok Video y Grok Lite están a la venta desde el 13-oct-2026 (tras su prueba
    # pagada); LTX, Kling y Seedance siguen INERTES (sin número en tarifas.json, sin prueba pagada). Un solo
    # intento cada uno mientras no se mida cuánto tardan: un timeout de cliente no cancela el trabajo en
    # fal. MiniMax no trae parámetro de audio y su esquema no dice si la salida lo lleva, pero la prueba pagada
    # del 12-oct-2026 midió una pista aac en sus dos clips (texto a video e imagen a video): `con_audio=True`,
    # y la prueba pagada marca REVISAR si un clip suyo llega sin pista. LTX no admite 4 s (su mínimo es 6).
    h3t = Modelo("h3t", "clip", H3T_T2V, H3T_I2V, familia_clip="minimax",
                 con_audio=True, duraciones=(4, 6, 8), max_intentos=1)
    grokv = Modelo("grokv", "clip", GROKV_T2V, GROKV_I2V, familia_clip="grok",
                   con_audio=True, duraciones=(4, 6, 8), max_intentos=1)
    # Grok 1.5 Lite (12-oct-2026). El esquema no decía si su clip trae sonido; la prueba pagada del mismo día
    # midió una pista aac en sus dos clips (texto a video e imagen a video), aunque muy bajita (DATOS §16): `con_audio=True`,
    # y `probar_modelo` marca REVISAR si un clip suyo llega sin pista.
    grokl = Modelo("grokl", "clip", GROKL_T2V, GROKL_I2V, familia_clip="grok_lite",
                   con_audio=True, duraciones=(4, 6, 8), max_intentos=1)
    ltx = Modelo("ltx", "clip", LTX_T2V, LTX_I2V, familia_clip="ltx",
                 con_audio=True, audio_opcional=True, duraciones=(6, 8), max_intentos=1)
    kling = Modelo("kling", "clip", KLING_T2V, KLING_I2V, familia_clip="kling",
                   con_audio=True, audio_opcional=True, duraciones=(4, 6, 8), max_intentos=1)
    seed = Modelo("seed", "clip", SEED_T2V, SEED_I2V, familia_clip="seedance",
                  con_audio=True, audio_opcional=True, duraciones=(4, 6, 8), max_intentos=1)
    # Nano Banana 2: crear (con referencia va al /edit) y editar. A la venta desde el
    # 9-oct-2026. Crear midió 11.7 s (editar, 11.5 y 13.9 s): por la regla de arriba iría a
    # segundo plano, pero sigue síncrono —como Grok y como editar— «de momento», por decisión
    # del dueño del 11-oct-2026: docs/OPERACION.md, «Decisión del dueño: Grok y Nano Banana 2».
    nb2 = Modelo("nb2", "imagen", NB2_CREAR, NB2_EDITAR, args_extra=NB2_ARGS_EXTRA)
    nb2_editar = Modelo("nb2", "editar", NB2_EDITAR, args_extra=NB2_ARGS_EXTRA)
    # Ola 2: FLUX.2 klein 9B, Z-Image Turbo, FLUX.2 pro, Seedream 5.0 Flash, Seedream 4.5 y
    # FLUX 3. Encendidos el 11-oct-2026 (número en tarifas.json §modelos «imagen»); se ofrecen al
    # desplegar la rama. Sin endpoint de imagen: son solo texto a imagen, así que no entran en
    # «editar». `segundo_plano` va en los que tardaron más de 10 s en la prueba pagada (los
    # segundos de cada uno están en docs/modelos-ia/POR-VERIFICAR.md): FLUX 3 21.8–25.0 s,
    # Seedream 5.0 Flash 13.4–15.0 s y Seedream 4.5 8.6–22.7 s. FLUX.2 pro (7.2–8.1 s), klein
    # (0.8–1.2 s) y Z-Image Turbo (1.0–1.8 s) caben en la petición.
    klein = Modelo("klein", "imagen", KLEIN_CREAR, llave_tamano="image_size",
                   tamanos=TAMANOS_FLUX, args_extra=SALIDA_JPEG, megapixeles_ficha=1.2)
    zit = Modelo("zit", "imagen", ZIT_CREAR, llave_tamano="image_size",
                 tamanos=TAMANOS_FLUX, args_extra=SALIDA_JPEG, megapixeles_ficha=1.2)
    # FLUX.2 pro: su esquema no trae `num_images`
    flux2 = Modelo("flux2", "imagen", FLUX2_CREAR, llave_tamano="image_size",
                   tamanos=TAMANOS_FLUX, args_extra=SALIDA_JPEG, con_num_images=False,
                   megapixeles_ficha=1.2)
    sdf = Modelo("sdf", "imagen", SDF_CREAR, llave_tamano="image_size",
                 tamanos=TAMANOS_SDF, args_extra=SALIDA_JPEG, segundo_plano=True)
    sd45 = Modelo("sd45", "imagen", SD45_CREAR, llave_tamano="image_size",
                  tamanos=TAMANOS_SD45, segundo_plano=True)
    # FLUX 3: pide el aspecto como la caja ("16:9"), no trae `num_images` y solo tiene leído el
    # precio de 1K (resolution "1k"): se fija como el 1K de Nano Banana 2.
    flux3 = Modelo("flux3", "imagen", FLUX3_CREAR, con_num_images=False, megapixeles_ficha=1.2,
                   args_extra=(("output_format", "jpeg"), ("resolution", "1k")),
                   segundo_plano=True)
    # Nano Banana Pro (Ola 3): solo crear, dos filas, una por calidad. Encendido el 12-oct-2026 (número en tarifas.json
    # §modelos «imagen»: nbp-2k 14 y nbp-4k 28; se ofrece al desplegar). Va a segundo plano: la prueba pagada midió
    # 24.9 y 28.1 s en 2K y 37.4 y 43.5 s en 4K, y la regla manda a segundo plano todo lo que pasa de 10 s.
    nbp_2k = Modelo("nbp-2k", "imagen", NBP_CREAR, args_extra=(*NBP_ARGS_BASE, ("resolution", "2K")),
                    segundo_plano=True)
    nbp_4k = Modelo("nbp-4k", "imagen", NBP_CREAR, args_extra=(*NBP_ARGS_BASE, ("resolution", "4K")),
                    segundo_plano=True)
    return {("imagen", "grok"): grok,
            ("imagen", "klein"): klein,
            ("imagen", "zit"): zit,
            ("imagen", "flux2"): flux2,
            ("imagen", "sdf"): sdf,
            ("imagen", "sd45"): sd45,
            ("imagen", "flux3"): flux3,
            ("imagen", "nb2"): nb2,
            ("imagen", "nbp-2k"): nbp_2k,
            ("imagen", "nbp-4k"): nbp_4k,
            ("editar", "grok"): Modelo("grok", "editar", settings.fal_imagen_edit),
            ("editar", "nb2"): nb2_editar,
            ("clip", "veo-lite"): veo,
            ("clip", "veo-fast"): veo_fast,
            ("clip", "veo-std"): veo_std,
            ("clip", "h3t"): h3t,
            ("clip", "grokv"): grokv,
            ("clip", "grokl"): grokl,
            ("clip", "ltx"): ltx,
            ("clip", "kling"): kling,
            ("clip", "seed"): seed}


def resolver(tarea: str, modelo_id: str | None) -> Modelo:
    """El modelo pedido, o el predeterminado si no se pidió ninguno."""
    if tarea not in TAREAS:
        raise ModeloDesconocido(f"tarea desconocida: {tarea!r}")
    id_ = (modelo_id or "").strip() or PREDETERMINADO[tarea]
    m = _tabla().get((tarea, id_))
    if m is None:
        raise ModeloDesconocido(f"modelo desconocido para {tarea}: {id_!r}")
    return m


def disponibles(tarea: str) -> list[str]:
    return [i for (t, i) in _tabla() if t == tarea]


def valida_duracion(tarea: str, modelo_id: str | None, segundos) -> int:
    """Los segundos que el modelo admite, o DuracionNoAdmitida con el motivo.

    Recibe lo que llegó del navegador sin tocar: solo vale un entero de verdad.
    `True` (en Python es un 1), «8», 8.5, 8.0 y None se rechazan igual que -4, 0
    o 5, porque convertirlos en silencio cobraría una duración y entregaría otra.
    El modelo desconocido sigue levantando ModeloDesconocido, como en resolver."""
    m = resolver(tarea, modelo_id)
    if type(segundos) is not int:
        raise DuracionNoAdmitida("Los segundos del clip deben ser un número entero.")
    if segundos not in m.duraciones:
        if not m.duraciones:
            raise DuracionNoAdmitida(f"El modelo {m.id} no tiene duración que elegir.")
        admitidas = ", ".join(str(d) for d in m.duraciones)
        raise DuracionNoAdmitida(
            f"El modelo {m.id} no admite clips de {segundos} s. "
            f"Duraciones disponibles: {admitidas} s.")
    return segundos


def valida_audio(tarea: str, modelo_id: str | None, audio) -> bool:
    """Si el clip lleva sonido: `True` o `False` de verdad, o AudioNoAdmitido con el motivo.

    Recibe lo que llegó del navegador sin tocar, como `valida_duracion`: «false», 0, None y
    «no» se rechazan en vez de leerse como un sí o un no que nadie dijo. Pedir SIN sonido solo
    vale en los modelos que lo permiten (`audio_opcional`): en los demás se rechaza, porque el
    clip saldría con la pista que trae el modelo y el cobro habría sido de otro producto.
    Con sonido (`True`) vale en todos: es lo que se vende y lo que siempre se pidió."""
    m = resolver(tarea, modelo_id)
    if type(audio) is not bool:
        raise AudioNoAdmitido("El sonido del clip debe ser verdadero o falso.")
    if not audio and not m.audio_opcional:
        raise AudioNoAdmitido(
            f"El modelo {m.id} trae su propio sonido y no se puede pedir sin sonido.")
    return audio
