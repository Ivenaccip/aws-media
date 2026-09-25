# Origen de las referencias

Copiadas de tasteskill (licencia MIT, © 2026 Leonxlnx) en el commit fijo
`c184364c58658b2f131b4ae8bd3d206cabb3deee` de
https://github.com/leonxlnx/taste-skill. No se usa su CLI (`npx skills`):
trae telemetría y no fija versiones.

Van renombradas para que ningún `SKILL.md` anidado se registre como skill.
No se copian el README (trae afiliados), ni soft, gpt-taste, stitch ni
imagegen.

| Archivo aquí | Archivo original | sha256 |
|---|---|---|
| `taste-v2.md` | `skills/taste-skill/SKILL.md` | `aa194351b246b8b4799099d4ed7b033d29eab6e6e3d58d8d2172978be7b3ec89` |
| `redesign.md` | `skills/redesign-skill/SKILL.md` | `98ad3e5b051bfb71b2795f7e8a6aa0d32b51ee095606c098a4b2822ac07926c9` |
| `LICENSE` | `LICENSE` | `4575a543ab88dad12ccea7d97e563d0bce5b448b06072e65d3264497dad326df` |

`tests/test_diseno_ui_referencias.py` comprueba que los hashes coinciden.
Para actualizar: cambia el commit, vuelve a copiar, recalcula los sha256
y anota aquí qué cambió.
