"""UI·4 — las referencias de tasteskill están fijadas y no se registran solas.

`.claude/skills/diseno-ui/referencias/` guarda copias de un commit fijo de
tasteskill. Este test comprueba que nadie las cambió sin actualizar
`ORIGEN.md` y que ningún `SKILL.md` anidado se cuela como skill.
"""
import hashlib
import re
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
SKILL = RAIZ / ".claude" / "skills" / "diseno-ui"
REFS = SKILL / "referencias"


def _hashes_de_origen() -> dict[str, str]:
    texto = (REFS / "ORIGEN.md").read_text(encoding="utf-8")
    return dict(re.findall(r"^\| `([^`]+)` \| `[^`]+` \| `([0-9a-f]{64})` \|$", texto, re.M))


def test_origen_lista_las_tres_referencias():
    assert set(_hashes_de_origen()) == {"taste-v2.md", "redesign.md", "LICENSE"}


def test_hashes_coinciden_con_origen():
    for nombre, esperado in _hashes_de_origen().items():
        real = hashlib.sha256((REFS / nombre).read_bytes()).hexdigest()
        assert real == esperado, f"{nombre} cambió: actualiza ORIGEN.md a propósito"


def test_origen_fija_el_commit():
    assert "c184364c58658b2f131b4ae8bd3d206cabb3deee" in (REFS / "ORIGEN.md").read_text(encoding="utf-8")


def test_sin_skill_md_anidado():
    anidados = [p.relative_to(SKILL) for p in SKILL.rglob("*") if p.name.upper() == "SKILL.MD" and p.parent != SKILL]
    assert not anidados, f"un SKILL.md dentro de referencias/ se registraría como skill: {anidados}"


def test_solo_archivos_permitidos():
    permitidos = {"taste-v2.md", "redesign.md", "LICENSE", "ORIGEN.md"}
    assert {p.name for p in REFS.iterdir()} == permitidos


def test_carta_existe_y_manda():
    carta = (RAIZ / "docs" / "DISENO.md").read_text(encoding="utf-8")
    for clave in ("Bricolage Grotesque", "Geist", "#da8c28", "Solo modo oscuro", "Verbo ✦ N"):
        assert clave in carta, f"docs/DISENO.md perdió «{clave}»"
    skill = (SKILL / "SKILL.md").read_text(encoding="utf-8")
    assert "docs/DISENO.md" in skill and "ÚNICA y EXCLUSIVAMENTE" in skill
