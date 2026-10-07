"""R4 · F1 — la tabla de modelos de IA que el usuario puede elegir.

Un id de modelo («grok», «veo-lite») es lo único que cruza del navegador al
servidor. De aquí sale a qué endpoint de fal se llama, y de tools/tarifas.json
§modelos sale cuánto se cobra: el navegador NUNCA manda un precio ni un endpoint.

Un modelo está en esta tabla solo cuando ya se verificó su endpoint, sus
parámetros y su costo (tools/pricing.json). Sumar uno es una fila de datos aquí,
su costo en pricing.json §generacion.endpoints y sus créditos en tarifas.json
§modelos — y recién entonces `activo: true` en el catálogo de la web
(web/src/pantallas/inicio/modelos.ts). Un id que no está aquí se rechaza con 422:
no se cae al modelo de siempre, porque cobraría uno y entregaría otro.
"""
from __future__ import annotations

from dataclasses import dataclass

from .config import settings

TAREAS = ("imagen", "editar", "clip")
PREDETERMINADO = {"imagen": "grok", "editar": "grok", "clip": "veo-lite"}


class ModeloDesconocido(ValueError):
    """El id no existe para esa tarea. Es un error del pedido (422), no nuestro."""


@dataclass(frozen=True)
class Modelo:
    id: str
    tarea: str
    endpoint: str                      # imagen: crear; clip: sin imagen (text-to-video)
    endpoint_con_imagen: str = ""      # editar/clip con imagen ("" = el mismo)
    # clip: ¿trae audio este modelo? El producto promete «8 s con sonido».
    con_audio: bool = False

    def endpoint_para(self, con_imagen: bool) -> str:
        return (self.endpoint_con_imagen or self.endpoint) if con_imagen else self.endpoint


def _tabla() -> dict[tuple[str, str], Modelo]:
    # Se arma al llamar y no al importar: los endpoints de Grok y Veo viven en
    # settings (se pueden sobrescribir por entorno) y esta tabla debe seguirlos.
    grok = Modelo("grok", "imagen", settings.fal_imagen, settings.fal_imagen_edit)
    veo = Modelo("veo-lite", "clip", settings.fal_veo_t2v, settings.fal_veo, con_audio=True)
    return {("imagen", "grok"): grok,
            ("editar", "grok"): Modelo("grok", "editar", settings.fal_imagen_edit),
            ("clip", "veo-lite"): veo}


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
