"""R4 · Ola 4 — los argumentos de cada familia de clip.

`clip.animar` arma los de Veo (duración «8s», `safety_tolerance`, `image_url`). Los clips de las otras
familias hablan distinto, y mandarles los de Veo es un pedido que fal rechaza o, peor, que contesta con
otra cosa de la que se cobró. Cada armador recibe lo que la tarea sabe (el prompt ya escrito, la imagen
de entrada si la hay, el aspecto de la caja y los segundos que se cobraron) y devuelve exactamente lo que
el esquema público de fal de esa familia pide (leído el 12-oct-2026 con `tools/leer_esquema_fal.py --ola4`,
docs/modelos-ia/DATOS-FAL-2026-10-08.md §14; `tests/fixtures/esquemas_fal_ola4.json` lo guarda).

Lo que cambia por familia:

  familia     duración             resolución  audio (generate_audio)   imagen de entrada   aspect_ratio
  minimax     número               «768P»      (no existe)              image_url           solo sin imagen
  grok        entero               «720p»      (sin parámetro)          image_url           siempre
  grok_lite   entero               «720p»      (sin parámetro)          image_url           solo sin imagen
  ltx         entero               «720p»      sí                       image_url           siempre
  kling       texto                (no existe) sí                       start_image_url     solo sin imagen
  seedance    texto                «720p»      sí                       image_url           siempre

Con imagen, `aspect_ratio` se manda donde el endpoint lo acepta (como Veo: gana el formato que el usuario
eligió); donde no existe (MiniMax, Kling y Grok Lite, imagen a video) el lienzo sale de la imagen. La resolución se
manda SIEMPRE explícita donde existe: el precio de pricing.json es el de esa resolución y no se deja al valor
por defecto de fal, que puede cambiar sin avisar (el de LTX ya es 1080p: $0.13 dólares por segundo contra
$0.09 a 720p).

Los modelos de este módulo son INERTES hasta que su prueba pagada y su número en tools/tarifas.json los
enciendan (docs/modelos-ia/POR-VERIFICAR.md, «Ola 4»).
"""
from __future__ import annotations

from typing import Callable

# Todos prometen sonido donde el endpoint lo deja pedir (es la tarifa en créditos del producto).
# MiniMax no trae parámetro de audio (no se puede pedir ni apagar); su clip trae pista aac de todos modos
# (medido el 12-oct-2026 en sus dos llamadas, DATOS §15).
CON_AUDIO = True


def minimax(prompt: str, image_url: str | None, aspecto: str, segundos: int) -> dict:
    """MiniMax H3 Max Turbo: `duration` es un número (0.92–15), `resolution` va en mayúscula
    (480P, 768P, 1080P) y `prompt_expansion_mode` figura como obligatoria aunque trae «balanced» por
    defecto. El image-to-video no tiene `aspect_ratio`: sigue a la imagen."""
    args: dict = {"prompt": prompt, "duration": segundos, "resolution": "768P",
                  "prompt_expansion_mode": "balanced"}
    if image_url:
        args["image_url"] = image_url
    else:
        args["aspect_ratio"] = aspecto
    return args


def grok(prompt: str, image_url: str | None, aspecto: str, segundos: int) -> dict:
    """Grok Imagine Video (versión base): `duration` entero (1–15), `resolution` 480p o 720p. Sin parámetro
    de audio. El image-to-video de la versión base sí acepta `aspect_ratio` (con «auto» por defecto)."""
    args: dict = {"prompt": prompt, "duration": segundos, "resolution": "720p",
                  "aspect_ratio": aspecto}
    if image_url:
        args["image_url"] = image_url
    return args


def grok_lite(prompt: str, image_url: str | None, aspecto: str, segundos: int) -> dict:
    """Grok Imagine Video 1.5 Lite (`xai/grok-imagine-video/v1.5/lite/…`, esquema leído el 12-oct-2026): igual
    que la base —`duration` entero (1–15), `resolution` 480p, 720p o 1080p, sin parámetro de audio, la imagen en
    `image_url`— salvo que su image-to-video NO tiene `aspect_ratio` (el lienzo sale de la imagen) y la base sí. Mandarle
    el aspecto con imagen es una llave que su esquema no trae. La resolución va explícita: el valor por defecto es
    720p, pero el precio de pricing.json es el de la que se pide."""
    args: dict = {"prompt": prompt, "duration": segundos, "resolution": "720p"}
    if image_url:
        args["image_url"] = image_url
    else:
        args["aspect_ratio"] = aspecto
    return args


def ltx(prompt: str, image_url: str | None, aspecto: str, segundos: int) -> dict:
    """LTX-2.5 Fast: `duration` es un enum MEZCLADO (los enteros 6, 8… 20 y el texto «auto»; relectura del
    12-oct-2026), así que los segundos van como entero. No admite 4 s. El valor por defecto de `resolution`
    es 1080p ($0.13 dólares por segundo contra $0.09 a 720p), así que 720p va explícito. `aspect_ratio`
    solo admite 16:9 y 9:16."""
    args: dict = {"prompt": prompt, "duration": segundos, "resolution": "720p",
                  "generate_audio": CON_AUDIO, "aspect_ratio": aspecto}
    if image_url:
        args["image_url"] = image_url
    return args


def kling(prompt: str, image_url: str | None, aspecto: str, segundos: int) -> dict:
    """Kling V3 Pro: la duración es un enum de TEXTO («3»…«15»), la imagen de entrada es `start_image_url`
    (no `image_url`) y no tiene parámetro de resolución. El image-to-video no tiene `aspect_ratio`."""
    args: dict = {"prompt": prompt, "duration": str(segundos), "generate_audio": CON_AUDIO}
    if image_url:
        args["start_image_url"] = image_url
    else:
        args["aspect_ratio"] = aspecto
    return args


def seedance(prompt: str, image_url: str | None, aspecto: str, segundos: int) -> dict:
    """Seedance 2.0: `duration` es un enum de TEXTO («auto», «4»…«15»), `resolution` va explícita
    (el valor por defecto es 720p, pero hay 1080p y 4k) y el audio no cambia el costo."""
    args: dict = {"prompt": prompt, "duration": str(segundos), "resolution": "720p",
                  "generate_audio": CON_AUDIO, "aspect_ratio": aspecto}
    if image_url:
        args["image_url"] = image_url
    return args


# La familia Veo no está aquí: la arma `pipeline/clip.py::_args_veo`, tal como siempre.
ARMADORES: dict[str, Callable[[str, str | None, str, int], dict]] = {
    "minimax": minimax,
    "grok": grok,
    "grok_lite": grok_lite,
    "ltx": ltx,
    "kling": kling,
    "seedance": seedance,
}
