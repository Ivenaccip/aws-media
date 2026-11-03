"""E2 — las constantes de la web son las del servidor.

El servidor es el único dueño de los límites (`server/edicion_api.py`, que importa
los de `shorts_api` para que no puedan separarse). La web los lee de
`GET /api/edicion/elegibles` → `limites`, pero lleva copia de respaldo en
`web/src/pantallas/inicio/reglasVideos.ts` para pintar la hoja mientras carga.
Este guardián las compara (mismo patrón que los VERBOS de test_web_tuberia.py):
si alguien cambia una sola, la prueba falla antes de que la hoja prometa algo
que el servidor rechaza.
"""
import re
from pathlib import Path

import pytest

from server import edicion_api, shorts_api

RAIZ = Path(__file__).resolve().parent.parent
REGLAS_TS = RAIZ / "web" / "src" / "pantallas" / "inicio" / "reglasVideos.ts"
# nombre en la web → valor del servidor
DEL_SERVIDOR = {
    "MAX_S": shorts_api.MAX_DURACION_S,
    "MIN_SOLO_S": shorts_api.MIN_DURACION_S,
    "MAX_VIDEOS": edicion_api.MAX_VIDEOS,
    "MAX_BYTES": edicion_api.MAX_BYTES_TOTAL,
}


def constantes_web(texto: str) -> dict[str, int]:
    """Las cuatro constantes, UNA por línea y con este formato exacto."""
    return {m.group(1): int(m.group(2)) for m in re.finditer(
        r"^export const (MAX_S|MIN_SOLO_S|MAX_VIDEOS|MAX_BYTES) = (\d+);[ \t]*$", texto, re.M)}


def test_los_valores_del_servidor_son_los_del_contrato():
    assert DEL_SERVIDOR == {"MAX_S": 5400, "MIN_SOLO_S": 60, "MAX_VIDEOS": 12, "MAX_BYTES": 16106127360}
    assert edicion_api.MAX_BYTES_TOTAL == 15 * 1024**3


def test_el_piso_y_el_tope_de_shorts_no_cambiaron():
    """E2 no toca los de shorts (los protege test_m22_testers): un video SOLO sigue pidiendo 1 a 90 min."""
    assert (shorts_api.MIN_DURACION_S, shorts_api.MAX_DURACION_S) == (60, 5400)


def test_el_servidor_importa_los_limites_no_los_copia():
    assert edicion_api.MAX_S == shorts_api.MAX_DURACION_S
    assert edicion_api.MIN_SOLO_S == shorts_api.MIN_DURACION_S


def test_los_textos_del_catalogo_dicen_los_mismos_limites():
    """Si una constante cambia, sus textos cambian con ella (están armados con ellas)."""
    assert "12 videos" in edicion_api.ERRORES["demasiados"][1]
    assert "90 min" in edicion_api.ERRORES["larga"][1] and "90 min" in edicion_api.ERRORES["total_largo"][1]
    assert "15 GB" in edicion_api.ERRORES["muy_pesado"][1]


def test_el_parser_lee_una_constante_por_linea():
    ok = ("export const MAX_S = 5400;\nexport const MIN_SOLO_S = 60;\n"
          "export const MAX_VIDEOS = 12;\nexport const MAX_BYTES = 16106127360;\n")
    assert constantes_web(ok) == {"MAX_S": 5400, "MIN_SOLO_S": 60, "MAX_VIDEOS": 12, "MAX_BYTES": 16106127360}
    # lo que no está en una línea con ese formato no cuenta: así no se cuela un comentario o un `let`
    assert constantes_web("// export const MAX_S = 5400;\nexport const MAX_S: number = 5400;\n") == {}
    assert constantes_web("export const MAX_S = 5400\n") == {}


def test_las_constantes_de_respaldo_de_la_web_son_las_del_servidor():
    if not REGLAS_TS.exists():
        pytest.skip("web/src/pantallas/inicio/reglasVideos.ts aún no existe (lo crea el trabajo de UI)")
    web = constantes_web(REGLAS_TS.read_text(encoding="utf-8"))
    assert web == DEL_SERVIDOR, f"la web y el servidor ya no coinciden: {web} != {DEL_SERVIDOR}"
