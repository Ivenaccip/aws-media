"""Modelos de datos que atraviesan el pipeline."""
from __future__ import annotations

from pathlib import Path
from typing import Literal, Optional

from pydantic import BaseModel, Field

Tipo = Literal["personaje", "prop", "lugar"]
Transicion = Literal["corte", "continua"]


class Entidad(BaseModel):
    nombre: str
    tipo: Tipo
    importancia: Literal["principal", "secundario"]
    existe: bool
    inline: bool
    descriptor: str = ""
    url: Optional[str] = None


class Biblioteca(BaseModel):
    entidades: list[dict]  # {nombre, tipo, descriptor, url}
    estilo_url: Optional[str]


class Casting(BaseModel):
    protagonista: str
    casting: list[Entidad]
    faltantes: list[str] = Field(default_factory=list)
    motivos: list[str] = Field(default_factory=list)
    mundo: str = ""


class Scene(BaseModel):
    id: str
    transicion: Transicion = "corte"
    narracion: str
    personajes: list[str] = Field(default_factory=list)
    prompt_visual: str = ""
    prompt_movimiento: str = ""

    # TTS
    voz: Optional[str] = None  # None → voz por defecto
    intentos: int = 0
    ya_ajustado: bool = False
    duration_seconds: Optional[int] = None  # parámetro enviado a ElevenLabs en "ajustar"
    audio_url: Optional[str] = None
    audio_path: Optional[Path] = None
    duracion_real: Optional[float] = None
    duracion_video: Optional[int] = None

    # Orden / cadenas
    orden: int = 0
    total: int = 0
    prev_id: Optional[str] = None
    es_ultima: bool = False

    # Imagen de inicio
    modo_inicio: Transicion = "corte"
    image_urls: list[str] = Field(default_factory=list)
    prompt_imagen: str = ""
    estilo_prompt: Optional[str] = None  # estilo del proyecto (None → sufijo clásico de v9)
    veo_negativo: Optional[str] = None
    start_image_url: Optional[str] = None  # URL http o data-URI
    start_image_origen: Optional[str] = None  # grok | frame_previo | frame_previo_fallback | fallo_grok
    start_image_path: Optional[Path] = None
    qc: Optional[str] = None  # ok | corregido | fallido | omitido
    qc_motivo: Optional[str] = None

    # Video
    video_url: Optional[str] = None
    video_path: Optional[Path] = None
    video_origen: Optional[str] = None  # veo | estatico
    veo_intento: int = 0
    last_frame_path: Optional[Path] = None
    final_path: Optional[Path] = None
    duracion_final: Optional[float] = None

    @property
    def es_fallback(self) -> bool:
        return self.video_origen == "estatico" or self.start_image_origen == "frame_previo_fallback" or self.qc == "fallido"


class Resultado(BaseModel):
    pelicula_path: Path
    drive_id: Optional[str]
    link: Optional[str]
    duracion_pelicula: Optional[float]
    escenas: list[Scene]
    mensaje: str
