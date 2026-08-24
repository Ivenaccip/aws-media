"""Proyecto = una sesión de la UI. Estado persistido en work/<id>/proyecto.json."""
from __future__ import annotations

import json
import uuid
from datetime import datetime
from pathlib import Path
from typing import Literal, Optional

from pydantic import BaseModel, Field

from .config import settings

Estado = Literal["creado", "preparando", "revision", "produciendo", "listo", "error"]

DURACION_MAX_S = 60
DURACION_MIN_S = 15


class Referencia(BaseModel):
    nombre_archivo: str
    path: str
    url: Optional[str] = None  # URL en fal una vez subida


class OpcionPersonaje(BaseModel):
    url: str
    path: str


class Personaje(BaseModel):
    nombre: str = "Protagonista"
    descripcion: str = ""
    opciones: list[OpcionPersonaje] = Field(default_factory=list)
    elegida: Optional[int] = None

    @property
    def url_elegida(self) -> Optional[str]:
        if self.elegida is None or self.elegida >= len(self.opciones):
            return None
        return self.opciones[self.elegida].url


class EscenaGuion(BaseModel):
    id: str
    narracion: str


class Proyecto(BaseModel):
    id: str
    creado: str
    estado: Estado = "creado"
    brief: str
    tipo_brief: Optional[Literal["historia", "idea"]] = None
    estilo: str = "animated"
    estilo_custom: Optional[str] = None
    duracion_s: int = 45
    modo: Literal["auto", "investigacion", "idea"] = "auto"  # F3.3: elección explícita del usuario
    rubro: Optional[str] = None                              # rubro del canal (balanceador)
    referencias: list[Referencia] = Field(default_factory=list)

    dossier: Optional[str] = None
    fuentes: list[str] = Field(default_factory=list)
    guion: list[EscenaGuion] = Field(default_factory=list)
    guion_original: list[EscenaGuion] = Field(default_factory=list)  # salida del guionista, antes del editor
    personaje: Personaje = Field(default_factory=Personaje)
    voz: Optional[str] = None
    voces: list[dict] = Field(default_factory=list)  # [{id, nivel, motivo}] ordenado, mejor primero

    etapa: Optional[str] = None  # subetapa de preparando/produciendo
    progreso: dict = Field(default_factory=dict)
    resultado: Optional[dict] = None
    error: Optional[str] = None

    @property
    def workdir(self) -> Path:
        return settings.work_dir / self.id

    @property
    def archivo(self) -> Path:
        return self.workdir / "proyecto.json"

    def guardar(self) -> None:
        self.workdir.mkdir(parents=True, exist_ok=True)
        self.archivo.write_text(self.model_dump_json(indent=2), encoding="utf-8")

    def texto_guion(self) -> str:
        return "\n\n".join(e.narracion for e in self.guion)


def nuevo_proyecto(brief: str, estilo: str, estilo_custom: str | None, duracion_s: int,
                   modo: str = "auto", rubro: str | None = None) -> Proyecto:
    duracion_s = max(DURACION_MIN_S, min(DURACION_MAX_S, int(duracion_s)))
    p = Proyecto(
        id=uuid.uuid4().hex[:8], creado=datetime.now().isoformat(timespec="seconds"),
        brief=brief.strip(), estilo=estilo, estilo_custom=estilo_custom, duracion_s=duracion_s,
        modo=modo if modo in ("auto", "investigacion", "idea") else "auto",
        rubro=(rubro or "").strip() or None,
    )
    p.guardar()
    return p


def cargar_proyecto(id_: str) -> Proyecto | None:
    f = settings.work_dir / id_ / "proyecto.json"
    if not f.exists():
        return None
    return Proyecto.model_validate_json(f.read_text(encoding="utf-8"))


def listar_proyectos() -> list[Proyecto]:
    out = []
    for f in settings.work_dir.glob("*/proyecto.json"):
        try:
            out.append(Proyecto.model_validate(json.loads(f.read_text(encoding="utf-8"))))
        except Exception:  # noqa: BLE001 — archivos viejos/corruptos no rompen el listado
            continue
    return sorted(out, key=lambda p: p.creado, reverse=True)
