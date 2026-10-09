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
(web/src/pantallas/inicio/modelos.ts). Hoy están a la venta Grok, Nano Banana 2, Veo 3.1
Lite y Veo 3.1 Fast (los dos últimos entraron el 9-oct-2026 tras su prueba pagada);
Veo 3.1 Standard es la única fila inerte.

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


class ModeloDesconocido(ValueError):
    """El id no existe para esa tarea. Es un error del pedido (422), no nuestro."""


class DuracionNoAdmitida(ModeloDesconocido):
    """El modelo existe, pero no hace clips de esa duración. También es un error
    del pedido (422); hereda de ModeloDesconocido para que un solo `except` cubra
    las dos y la API pueda distinguirlas cuando quiera."""


# Llaves que la TAREA manda siempre (el texto, las imágenes, el aspecto, los
# segundos): ningún modelo puede fijarlas en `args_extra`, porque pisaría lo que el
# usuario pidió y se cobró. `image_url` es la imagen de entrada de la familia Veo.
LLAVES_PROTEGIDAS = frozenset(
    {"prompt", "image_urls", "image_url", "num_images", "aspect_ratio", "duration"})


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


@dataclass(frozen=True)
class Modelo:
    id: str
    tarea: str
    endpoint: str                      # imagen: crear; clip: sin imagen (text-to-video)
    endpoint_con_imagen: str = ""      # editar/clip con imagen ("" = el mismo)
    # clip: ¿trae audio este modelo? El producto promete «8 s con sonido».
    con_audio: bool = False
    # clip: los segundos enteros que admite. Vacío = la tarea no tiene duración.
    # Un modelo que no admite 4 s (p. ej. LTX) simplemente no la trae aquí.
    duraciones: tuple[int, ...] = ()
    # Argumentos que este modelo manda SIEMPRE además de los de la tarea (imagen:
    # los de `media_fal`). Tupla inmutable de pares (llave, valor): al construir se
    # acepta un dict, se copia y se ordena por llave, así que ni quien lo pasó ni
    # quien lo lea puede cambiarlo después, y el Modelo se copia, serializa y
    # compara sin sorpresas. Son un pin: ver `con_args_extra`.
    args_extra: tuple[tuple[str, object], ...] = ()
    # clip: tope de intentos de este modelo. 0 = vale el de settings.clip_max_attempts.
    # Con N > 0 se usa min(settings.clip_max_attempts, N): un modelo puede pedir
    # MENOS intentos que el ambiente, nunca más. Un timeout de cliente no cancela el
    # trabajo en fal, así que un reintento puede cobrar dos veces; en los modelos
    # caros (Veo 3.1 Standard, $3.20 dólares por clip de 8 s) se fija en 1.
    max_intentos: int = 0

    def __post_init__(self):
        # frozen: la única forma de reemplazar el campo es object.__setattr__
        object.__setattr__(self, "args_extra", _normaliza_args_extra(self.id, self.args_extra))
        if type(self.max_intentos) is not int or self.max_intentos < 0:
            raise ValueError(f"max_intentos de {self.id!r} debe ser un entero de 0 o más "
                             f"(0 = los de settings.clip_max_attempts)")

    @property
    def args_extra_dict(self) -> dict:
        """Los argumentos fijos como un dict NUEVO cada vez (cambiarlo no toca al modelo)."""
        return dict(self.args_extra)

    def endpoint_para(self, con_imagen: bool) -> str:
        return (self.endpoint_con_imagen or self.endpoint) if con_imagen else self.endpoint

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
NB2_CREAR = "fal-ai/nano-banana-2"
NB2_EDITAR = "fal-ai/nano-banana-2/edit"

# Nano Banana 2 solo tiene leída la tarifa de 1K ($0.08 dólares por imagen). Se
# manda explícito para no depender de que el default de fal siga siendo 1K.
NB2_ARGS_EXTRA = (("resolution", "1K"),)


def _tabla() -> dict[tuple[str, str], Modelo]:
    # Se arma al llamar y no al importar: los endpoints de Grok y Veo Lite viven en
    # settings (se pueden sobrescribir por entorno) y esta tabla debe seguirlos.
    grok = Modelo("grok", "imagen", settings.fal_imagen, settings.fal_imagen_edit)
    veo = Modelo("veo-lite", "clip", settings.fal_veo_t2v, settings.fal_veo,
                 con_audio=True, duraciones=(4, 6, 8))
    # Veo 3.1 Fast y Standard: mismos argumentos que Lite (los arma clip.animar), solo
    # cambia el endpoint. Fast ya está a la venta; Standard sigue INERTE hasta que tarifas.json le ponga créditos. Un solo
    # intento (max_intentos=1): el timeout del clip es de cliente y puede dejar vivo y
    # cobrado el trabajo en fal; Standard son $3.20 dólares por intento a 8 s, hasta 8
    # veces el de Lite, y devolver créditos no devuelve lo que fal ya cobró.
    veo_fast = Modelo("veo-fast", "clip", VEO_FAST_T2V, VEO_FAST_I2V,
                      con_audio=True, duraciones=(4, 6, 8), max_intentos=1)
    veo_std = Modelo("veo-std", "clip", VEO_STD_T2V, VEO_STD_I2V,
                     con_audio=True, duraciones=(4, 6, 8), max_intentos=1)
    # Nano Banana 2: crear (con referencia va al /edit) y editar. A la venta desde el 9-oct-2026.
    nb2 = Modelo("nb2", "imagen", NB2_CREAR, NB2_EDITAR, args_extra=NB2_ARGS_EXTRA)
    nb2_editar = Modelo("nb2", "editar", NB2_EDITAR, args_extra=NB2_ARGS_EXTRA)
    return {("imagen", "grok"): grok,
            ("imagen", "nb2"): nb2,
            ("editar", "grok"): Modelo("grok", "editar", settings.fal_imagen_edit),
            ("editar", "nb2"): nb2_editar,
            ("clip", "veo-lite"): veo,
            ("clip", "veo-fast"): veo_fast,
            ("clip", "veo-std"): veo_std}


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
