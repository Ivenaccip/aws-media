"""Proyecto = una sesión de la UI. Estado persistido en work/<id>/proyecto.json;
con STATE_BACKEND=postgres (C2) la fuente de verdad es Aurora vía pipeline.db y
el JSON del workdir queda como artefacto efímero (en Lambda, /tmp)."""
from __future__ import annotations

import json
import uuid
from datetime import datetime
from pathlib import Path
from typing import Literal, Optional

from pydantic import BaseModel, Field

from . import db
from .config import settings
from .models import FORMATOS, Formato

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
    # M22 · F — horizontal (16:9) o vertical (9:16), elegido al crear. Los
    # proyectos anteriores no lo traen y caen al default, que es lo que eran.
    formato: Formato = "horizontal"
    modo: Literal["auto", "investigacion", "idea"] = "auto"  # F3.3: elección explícita del usuario
    rubro: Optional[str] = None                              # rubro del canal (balanceador)
    referencias: list[Referencia] = Field(default_factory=list)
    # M12 (mock del formulario): notas libres del usuario sobre su personaje —
    # se anexan a la descripción detectada antes de guion y opciones.
    personaje_extra: str = ""

    # M11 — "narracion" invierte el orden: guion continuo → TTS único →
    # ventanas de video sobre la voz. "escenas" = el pipeline de siempre.
    pipeline: Literal["escenas", "narracion"] = "escenas"
    narracion: Optional[str] = None   # el guion corrido (solo pipeline narracion)

    # M12 — archivado libera el slot sin borrar nada: el doc se queda entero
    # (los binarios de S3 se enfrían solos con la lifecycle del bucket).
    archivado: bool = False

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
        # El archivo se escribe SIEMPRE: el pipeline trabaja sobre el workdir
        # (con backend postgres es artefacto efímero; la verdad vive en Aurora).
        self.workdir.mkdir(parents=True, exist_ok=True)
        self.archivo.write_text(self.model_dump_json(indent=2), encoding="utf-8")
        if db.backend() == "postgres":
            db.guardar_proyecto(db.usuario_actual(), self.id, self.creado,
                                self.estado, self.brief, self.model_dump_json())

    def texto_guion(self) -> str:
        """El texto narrado completo, venga de donde venga (M11: la narración
        corrida manda cuando existe)."""
        if self.pipeline == "narracion" and (self.narracion or "").strip():
            return self.narracion.strip()
        return "\n\n".join(e.narracion for e in self.guion)

    def tiene_guion(self) -> bool:
        return bool(self.texto_guion().strip())


def nuevo_proyecto(brief: str, estilo: str, estilo_custom: str | None, duracion_s: int,
                   modo: str = "auto", rubro: str | None = None,
                   pipeline: str = "escenas", formato: str = "horizontal") -> Proyecto:
    duracion_s = max(DURACION_MIN_S, min(DURACION_MAX_S, int(duracion_s)))
    p = Proyecto(
        id=uuid.uuid4().hex[:8], creado=datetime.now().isoformat(timespec="seconds"),
        brief=brief.strip(), estilo=estilo, estilo_custom=estilo_custom, duracion_s=duracion_s,
        modo=modo if modo in ("auto", "investigacion", "idea") else "auto",
        rubro=(rubro or "").strip() or None,
        pipeline=pipeline if pipeline in ("escenas", "narracion") else "escenas",
        # el formato NO se puede cambiar después: media.py fija el aspecto en
        # cada llamada y una película a medias con dos aspectos no se concatena
        formato=formato if formato in FORMATOS else "horizontal",
    )
    p.guardar()
    return p


def cargar_proyecto(id_: str) -> Proyecto | None:
    if db.backend() == "postgres":
        doc = db.cargar_proyecto(db.usuario_actual(), id_)
        return Proyecto.model_validate(doc) if doc else None
    f = settings.work_dir / id_ / "proyecto.json"
    if not f.exists():
        return None
    return Proyecto.model_validate_json(f.read_text(encoding="utf-8"))


def listar_proyectos() -> list[Proyecto]:
    if db.backend() == "postgres":
        return [Proyecto.model_validate(d)
                for d in db.listar_proyectos(db.usuario_actual())]
    out = []
    for f in settings.work_dir.glob("*/proyecto.json"):
        try:
            out.append(Proyecto.model_validate(json.loads(f.read_text(encoding="utf-8"))))
        except Exception:  # noqa: BLE001 — archivos viejos/corruptos no rompen el listado
            continue
    return sorted(out, key=lambda p: p.creado, reverse=True)
