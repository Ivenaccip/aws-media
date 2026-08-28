"""A3: gate de duración post-TTS (pipeline/duracion.py) — lógica pura."""

import pytest

from pipeline import duracion
from pipeline.models import Scene


def _escena(id_: str, slot: int | None, palabras: int = 12, voz: str | None = None) -> Scene:
    return Scene(id=id_, narracion=" ".join(["palabra"] * palabras),
                 duracion_video=slot, voz=voz)


def test_total_video_s():
    escenas = [_escena("1", 8), _escena("2", 6), _escena("3", None)]
    assert duracion.total_video_s(escenas) == 14


def test_sin_exceso_no_recorta():
    # 8+6+4 = 18 s para objetivo 17: dentro del 10% de tolerancia
    escenas = [_escena("1", 8), _escena("2", 6), _escena("3", 4)]
    assert duracion.elegir_recortes(escenas, 17) == []


def test_exceso_elige_las_mas_largas():
    # 8+8+6+4 = 26 s para objetivo 20 → exceso 4 s → 2 recortes, slots más largos primero
    escenas = [_escena("corta", 4), _escena("a", 8, palabras=14),
               _escena("b", 8, palabras=10), _escena("c", 6)]
    elegidas = duracion.elegir_recortes(escenas, 20)
    assert [e.id for e in elegidas] == ["a", "b"]  # 8s primero; a antes que b por palabras


def test_escenas_de_4s_no_bajan_mas():
    escenas = [_escena("1", 4), _escena("2", 4)]
    # 8 s para objetivo 4: excedido, pero no hay slot menor — nada que recortar
    assert duracion.elegir_recortes(escenas, 4) == []


def test_palabras_objetivo_usa_tasa_de_la_voz():
    # slot 8 → objetivo 6 s; George mide 1.98 pal/s → int(1.98 * (6 - 0.8)) = 10
    assert duracion.palabras_objetivo(_escena("1", 8, voz="George")) == 10
    # voz sin medir → default 1.9 → int(1.9 * 5.2) = 9
    assert duracion.palabras_objetivo(_escena("1", 8, voz="Aria")) == 9
    # slot 6 → objetivo 4 s: int(1.98 * 3.2) = 6
    assert duracion.palabras_objetivo(_escena("1", 6, voz="George")) == 6


def test_interpretar_recorte():
    assert duracion.interpretar_recorte({"narracion": " corta y clara "}, "orig", 10) == "corta y clara"
    # vacío o basura → se queda la original
    assert duracion.interpretar_recorte({}, "orig", 10) == "orig"
    assert duracion.interpretar_recorte({"narracion": "  "}, "orig", 10) == "orig"
    # pasada del límite (+2 de gracia) → corte duro
    larga = " ".join(f"p{i}" for i in range(20))
    assert len(duracion.interpretar_recorte({"narracion": larga}, "orig", 10).split()) == 10
    # dentro de la gracia → se respeta
    casi = " ".join(f"p{i}" for i in range(11))
    assert duracion.interpretar_recorte({"narracion": casi}, "orig", 10) == casi
