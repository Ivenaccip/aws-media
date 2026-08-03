# video-stack

**Editor de metraje real con Claude como cerebro.** Fusiona dos herramientas MIT —
la rama **longform** de [claude-youtube-editor](https://github.com/hassancs91/claude-youtube-editor)
y la rama **shorts** de [claude-shorts](https://github.com/AgriciDaniel/claude-shorts) —
sobre un **esquema canónico de transcript** compartido.

> Claude no ve ni corta video: escribe código y decisiones editoriales sobre un
> transcript con timestamps a nivel palabra; FFmpeg y Remotion ejecutan.
> Esto NO es un generador de video desde prompts.

## Arranque

```bash
python -m venv venv && venv/Scripts/pip install -r requirements.txt   # (bin/ en macOS/Linux)
python tools/setup.py        # escanea tu hardware, CALIBRA de verdad y escribe tu config
cd remotion && npm ci && cd ..
python tools/project.py new video-1
```

`tools/setup.py` es **re-ejecutable**: cambiaste de máquina o compraste GPU → córrelo
otra vez. Escribe `.video-stack/config.json` (gitignored — puedes clonar este repo en
tres máquinas y cada una tiene su config sin pisarse). Te presenta **tres rutas**:
local con el modelo que tu equipo corre bien (gratis), local universal (`int8` + CPU,
lento pero corre en cualquier lado), o nube (AssemblyAI) como conveniencia si
prefieres no instalar nada — con preview de costo antes de cada corrida.

Requisitos de sistema: `ffmpeg`/`ffprobe`, Node 18+; en Windows: **Git Bash + jq**
(no hace falta WSL — ver `docs/DECISIONES.md`).

## El corazón: un solo transcript para todo

Se transcribe **una vez** por proyecto — con faster-whisper local o AssemblyAI, da
igual: ambos backends normalizan al esquema canónico versionado
(`schema/transcript.schema.json`, segundos-float, nivel palabra, relativo a la fuente
cruda). Ninguna skill sabe de qué backend vino. Detalles y política de versionado en
`docs/SCHEMA.md`.

```
metraje crudo ─▶ tools/transcribe.py (backend según tu config)
                   └─▶ work/transcripts/<id>.canonical.json      ← el contrato
                        ├─▶ rama longform: /clean-cut → cuts.json → master + edited-transcript.json
                        └─▶ rama shorts:  /shorts → candidatos con score → Remotion → export
```

## Skills

| Skill | Rama | Qué hace |
|---|---|---|
| `/clean-cut` | longform | corte del metraje crudo → master limpio (política editorial editable) |
| `/shorts` | shorts | clips 9:16 con captions animados, aprobación interactiva |
| `/clean-audio` | longform | denoise/aislar voz (RMS-match, niveles preservados) |
| `/make-tsx`, `/fake-screencast`, `/vidtsx-2d-generator` | longform | beats visuales Remotion (proyecto en `remotion-longform/`) |
| `/suggest-sfx` | longform | plan de SFX desde la librería compartida |
| `/brand-setup`, `/packaging` | longform | identidad del canal · títulos + thumbnails |

**La voz editorial vive en dos archivos EDITABLES por ti** (mismos criterios,
pensados para español LATAM con términos técnicos en inglés — el code-switching
jamás se penaliza como incoherencia):

- `.claude/skills/clean-cut/SKILL.md` — política de corte (qué es false start, qué
  es relleno, qué se conserva)
- `references/scoring-rubric.md` — 5 dimensiones ponderadas para shorts (hook 0.30,
  coherencia 0.25, emoción 0.20, densidad 0.15, payoff 0.10)

## Estructura

```
.claude/skills/       skills fusionadas (8 de L1 + flujo shorts de S1)
schema/               transcript.schema.json — el contrato (docs/SCHEMA.md)
tools/                CLIs: transcribe (doble backend), setup, project, normalizers/,
                      engine de corte de L1 (cutlib, render_cuts, verify_cut…),
                      shorts/ (scripts de S1), pricing.json (ÚNICA fuente de precios)
remotion/             render de captions de S1 — fps FIJO 30 (interno a su salida)
remotion-longform/    proyecto Remotion de L1 (beats visuales de /make-tsx)
media/                librería SFX/música de L1 — cada clip con su procedencia en
                      los catálogos (generados con ElevenLabs por Hasan Aboul Hasan)
references/           rúbrica de scoring, estilos de captions, specs de plataforma
assets/calibration/   WAV de calibración del setup (voz es-MX sintética, ~80 s)
docs/                 SCHEMA, DECISIONES (pendientes resueltos con evidencia), DRIFT, QA
videos/               tus proyectos (gitignored) — python tools/project.py new video-1
.video-stack/         config por máquina (gitignored)
```

## Reglas que este repo NO negocia

- **Loudness: una sola pasada por rama.** Longform: RMS-match para voz + ebur128
  para assets, **sin loudnorm en el master**. Shorts: `loudnorm I=-14:TP=-1:LRA=11`
  solo en export. Checklist en `docs/QA.md`.
- **Stream copy al extraer clips de shorts** (jamás re-encode en ese paso) y
  snapping por word boundaries + silencedetect.
- **Aprobación interactiva**: nada se renderiza sin que el usuario elija y ajuste.
- **QA del corte**: `verify_cut.py` (palabras fantasma/cortadas, drift A/V) + gate
  `v:0 == a:0` + manejo de fps NTSC fraccional (60000/1001).
- **Precios en un solo archivo** (`tools/pricing.json`, con `verified_on`) — ninguna
  skill los hardcodea. En UI siempre "$X.XX **dólares** por hora" (jamás "centavos");
  del free tier de AssemblyAI no se promete nada.
- **Español**: prohibidas las variantes `.en` (English-only); solo modelos
  multilingües (`small` ~2 GB, `medium` ~5 GB, `large-v3` ~10 GB; `int8` ≈ mitad).

## Créditos y licencia

MIT (ver `LICENSE`). Este repo existe gracias a:

- **Hasan Aboul Hasan** — [claude-youtube-editor](https://github.com/hassancs91/claude-youtube-editor)
  (rama longform: engine de corte, QA de render, pipeline de audio/SFX, skills de
  visuales). Los clips de música/SFX de `media/library/` fueron generados por él con
  ElevenLabs; la procedencia por clip está en los `catalog.json`.
- **Daniel Agrici** — [claude-shorts](https://github.com/AgriciDaniel/claude-shorts)
  (rama shorts: scoring interactivo, snapping, captions Remotion, export por
  plataforma).

No se tomó código de `claude-video-editor` (Commons Clause) ni de
`skill-caption-clip` (sin licencia) — restricción legal deliberada del diseño.
