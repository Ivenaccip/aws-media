"""Pista 2 del editor: recursos IA por escena, con versionado (PLAN-FUSION.md F2.1).

work/overlays.json por proyecto — todo acceso vía pipeline.storage. Las versiones
NUNCA se borran (cada regeneración cuesta dólares; deshacer = activar la anterior).

Estructura:
{
  "version": 1,
  "estilo_prompt": "...",                      # sufijo de estilo de la producción
  "overlays": [{
    "id": "5a", "t_in": 12.4, "t_out": 18.4, "narracion": "...",
    "prompt_imagen": "...",                    # prompt REAL con el que nació la imagen
    "prompt_movimiento": "...", "veo_negativo": "...",
    "version_activa": 1,
    "versiones": [{"n": 1, "video": "overlays/5a/v1.mp4", "imagen_base": null,
                   "origen": "produccion", "costo_usd": 0.0, "creado": "..."}]
  }]
}

Archivos bajo work/overlays/<id>/: v1.mp4 (clip original), audio.mp3 (narración,
se reutiliza SIEMPRE — la regeneración no toca el audio), vN.mp4, vN.jpg,
candidatos/*.jpg (opciones de imagen de g2 aún no convertidas en versión).
"""
from __future__ import annotations

import json
import shutil
import subprocess
import time
from pathlib import Path

from .storage import escribir_json, leer_json

MUX_ITSOFFSET = "0.3"   # mismo corrimiento de audio que pipeline/ffmpeg.py


def ruta(project: Path) -> Path:
    return project / "work" / "overlays.json"


def cargar(project: Path) -> dict:
    return leer_json(ruta(project), default={"version": 1, "estilo_prompt": "", "overlays": []})


def guardar(project: Path, data: dict) -> None:
    escribir_json(ruta(project), data)


def obtener(data: dict, oid: str) -> dict:
    for ov in data["overlays"]:
        if ov["id"] == oid:
            return ov
    raise KeyError(f"overlay {oid} no existe")


def dir_overlay(project: Path, oid: str) -> Path:
    return project / "work" / "overlays" / oid


def duracion_clip(ov: dict) -> float:
    return round(ov["t_out"] - ov["t_in"], 3)


def version_activa(ov: dict) -> dict:
    for v in ov["versiones"]:
        if v["n"] == ov["version_activa"]:
            return v
    return ov["versiones"][0]


def costo_total(data: dict) -> float:
    """Suma del libro de gastos (cada llamada con costo se registra ahí una sola vez)."""
    return round(sum(g["usd"] for g in data.get("gastos", [])), 3)


def registrar_gasto(project: Path, tipo: str, oid: str, usd: float) -> None:
    data = cargar(project)
    data.setdefault("gastos", []).append(
        {"tipo": tipo, "overlay": oid, "usd": round(usd, 3), "creado": _stamp()})
    guardar(project, data)


def _stamp() -> str:
    return time.strftime("%Y-%m-%d %H:%M:%S")


def crear_desde_produccion(project: Path, work_dir: Path, orden: list[str],
                           duraciones: dict[str, float]) -> dict:
    """El puente registra cada escena generada como overlay v1: clip y audio se
    copian al proyecto (autocontenido), prompts reales desde estado.json si existe."""
    estado = {e["id"]: e for e in leer_json(work_dir / "estado.json", default={}).get("escenas", [])}
    proyecto = leer_json(work_dir / "proyecto.json", default={})
    narraciones = {e["id"]: e["narracion"] for e in proyecto.get("guion", [])}
    primera = next(iter(estado.values()), {})

    data = {"version": 1, "estilo_prompt": primera.get("estilo_prompt", ""), "overlays": []}
    t = 0.0
    for oid in orden:
        d = dir_overlay(project, oid)
        d.mkdir(parents=True, exist_ok=True)
        shutil.copy2(work_dir / f"final_{oid}.mp4", d / "v1.mp4")
        shutil.copy2(work_dir / f"audio_{oid}.mp3", d / "audio.mp3")
        e = estado.get(oid, {})
        dur = duraciones[oid]
        data["overlays"].append({
            "id": oid, "t_in": round(t, 3), "t_out": round(t + dur, 3),
            "narracion": e.get("narracion") or narraciones.get(oid.rstrip("ab"), ""),
            "prompt_imagen": e.get("prompt_imagen") or e.get("prompt_visual", ""),
            "prompt_movimiento": e.get("prompt_movimiento", ""),
            "veo_negativo": e.get("veo_negativo", ""),
            "version_activa": 1,
            "versiones": [{"n": 1, "video": f"overlays/{oid}/v1.mp4", "imagen_base": None,
                           "origen": "produccion", "costo_usd": 0.0, "creado": _stamp()}],
        })
        t += dur
    guardar(project, data)
    return data


def _ff(*args: str) -> None:
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *args], check=True)


def mux_reemplazo(video_veo: Path, audio: Path, destino: Path, t: float) -> None:
    """Mux del clip regenerado: el audio del clip de Veo se DESCARTA (manda la
    narración TTS) y el video se RE-ENCODEA — a diferencia del mux de producción
    (stream copy), aquí la duración debe calzar EXACTO con la del clip original
    para no desincronizar el canónico/subtítulos (copy corta en keyframes y se
    pasa ~0.1s)."""
    _ff("-i", str(video_veo), "-itsoffset", MUX_ITSOFFSET, "-i", str(audio),
        "-map", "0:v:0", "-map", "1:a:0",
        "-c:v", "libx264", "-preset", "medium", "-crf", "19", "-r", "24",
        "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2", "-af", "apad",
        "-t", f"{t}", "-movflags", "+faststart", str(destino))


def agregar_version(project: Path, oid: str, video_mux: Path, imagen_base: Path | None,
                    costo_usd: float, origen: str = "regeneracion") -> dict:
    """Alta de versión nueva (ya muxeada a la duración del clip) y activación."""
    data = cargar(project)
    ov = obtener(data, oid)
    n = max(v["n"] for v in ov["versiones"]) + 1
    d = dir_overlay(project, oid)
    destino = d / f"v{n}.mp4"
    shutil.move(str(video_mux), destino)
    entrada = {"n": n, "video": f"overlays/{oid}/v{n}.mp4", "imagen_base": None,
               "origen": origen, "costo_usd": round(costo_usd, 3), "creado": _stamp()}
    if imagen_base is not None:
        img = d / f"v{n}.jpg"
        shutil.copy2(imagen_base, img)
        entrada["imagen_base"] = f"overlays/{oid}/v{n}.jpg"
    ov["versiones"].append(entrada)
    ov["version_activa"] = n
    guardar(project, data)
    return entrada


def activar_version(project: Path, oid: str, n: int) -> dict:
    data = cargar(project)
    ov = obtener(data, oid)
    if not any(v["n"] == n for v in ov["versiones"]):
        raise KeyError(f"overlay {oid}: versión {n} no existe")
    ov["version_activa"] = n
    guardar(project, data)
    return ov


def rearmar_pelicula(project: Path, con_proxy: bool = True) -> float:
    """Reconstruye pelicula.mp4 concatenando la versión ACTIVA de cada overlay
    (re-encode uniforme, mismas duraciones → el canónico y los subs siguen válidos)
    y regenera el wav de análisis y el proxy del editor."""
    data = cargar(project)
    if not data["overlays"]:
        raise RuntimeError("proyecto sin overlays — nada que rearmar")
    lista = project / "work" / "overlays" / "lista.txt"
    lista.write_text("\n".join(
        f"file '{(project / 'work' / version_activa(ov)['video']).resolve().as_posix()}'"
        for ov in data["overlays"]), encoding="utf-8")
    destino = project / "pelicula.mp4"
    _ff("-f", "concat", "-safe", "0", "-i", str(lista),
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "19", "-r", "24",
        "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2",
        "-movflags", "+faststart", str(destino))
    _ff("-i", str(destino), "-ar", "16000", "-ac", "1",
        str(project / "work" / "audio" / "pelicula.wav"))
    if con_proxy:
        import sys
        # la raíz del repo sale de ESTE archivo, no del proyecto: con MEDIA_ROOT
        # configurado el proyecto puede vivir fuera del repo
        raiz = Path(__file__).resolve().parent.parent
        subprocess.run([sys.executable, str(raiz / "tools" / "make_proxy.py"),
                        str(project)], check=True, cwd=str(raiz))
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                        "-of", "csv=p=0", str(destino)], capture_output=True, text=True, check=True)
    return float(r.stdout.strip())
