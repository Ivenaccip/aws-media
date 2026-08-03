# CLAUDE.md — video-stack

Repo fusionado de edición de video (longform + shorts) con Claude como cerebro
editorial. **Lee `docs/SCHEMA.md` antes de tocar cualquier cosa que consuma
transcripts.**

| El usuario pide… | Skill | Rama |
|---|---|---|
| cortar metraje / quitar relleno / apretar ritmo | `/clean-cut` | longform |
| shorts / clips verticales / tiktok-reels del video | `/shorts` | shorts |
| limpiar audio / quitar ruido | `/clean-audio` | longform |
| beats visuales / overlays | `/make-tsx` (+`/fake-screencast`) | longform |
| SFX | `/suggest-sfx` | longform |
| marca / packaging | `/brand-setup` · `/packaging` | longform |

## Reglas duras del repo

- **Correr todo desde la raíz del repo.** Proyectos = `videos/video-N`
  (`python tools/project.py new video-N`).
- **Transcribir UNA vez por proyecto** con `python tools/transcribe.py videos/video-N`
  (backend según `.video-stack/config.json`; si no existe, corre `python tools/setup.py`).
  Ambas ramas consumen `work/transcripts/<id>.canonical.json`. Ninguna skill
  ramifica por `asr.backend`. Corrida en nube sin preview de costo = bug.
- **Precios SOLO de `tools/pricing.json`** ("$0.21 dólares por hora", jamás
  "centavos"; free tier: "verifica tu crédito en el dashboard").
- **Loudness una sola pasada por rama** — la matriz completa y el checklist están en
  `docs/QA.md`. El master longform jamás lleva loudnorm; shorts solo en
  `tools/shorts/export.sh`.
- **Shorts extrae con stream copy** (`-c copy`), y `SHORTS_TMP` SIEMPRE apunta a
  `videos/video-N/work/shorts` (lo cablea la skill vía `tools/project.py shorts-tmp`).
- **Dos proyectos Remotion distintos:** `remotion/` = captions de shorts (fps fijo
  30); `remotion-longform/` = beats visuales de L1 (las skills de visuales que
  mencionen "remotion/src" se refieren a `remotion-longform/src`; su registry se
  genera con `cd remotion-longform && npm run gen`).
- **Python: venv en la raíz** (`venv/`) con `requirements.txt` FIJADO. En Windows:
  Git Bash + jq, sin WSL (`docs/DECISIONES.md`). API keys en `.env`
  (copia `.env.example`); nunca se comitea.
- **QA no es opcional:** `verify_cut.py` tras cada render de corte; gate
  `ffprobe` v:0 == a:0 en el master; `tools/shorts/validate.sh` tras cada export.
- **media/** = librería reutilizable con catálogos (procedencia por clip — respétala
  al agregar assets). Lo generado para UN video va en `media/projects/<proyecto>/`.
- La voz editorial (política de corte + rúbrica) es del usuario: se edita en
  `.claude/skills/clean-cut/SKILL.md` y `references/scoring-rubric.md`, coherentes
  entre sí (español LATAM; el code-switching no se penaliza).
