# DRIFT — diferencias entre el handoff (2026-08-03) y el código real clonado

Los repos se clonaron el 2026-08-03 (`git clone --depth 1`). La mayoría de las citas
`archivo:línea` del handoff verifican; aquí solo lo que difiere o se movió.

## S1 — claude-shorts

| Cita del handoff | Estado real | Impacto |
|---|---|---|
| "lado Python **sin** archivo de deps" | **Ya existe `requirements.txt`** (`faster-whisper>=1.0.0`, `mediapipe>=0.10.0`, `numpy>=1.24.0`, `opencv-python>=4.8.0`) — con rangos `>=`, no fijadas | El repo fusionado fija versiones exactas igual; el drift es a favor |
| `Root.tsx:32` (fps fijo 30) | El `fps={30}` está en `Root.tsx:13`; la línea 32 es el `calculateMetadata` que también fija `fps: 30` | Ninguno — la afirmación se sostiene, la línea se movió |
| `SKILL.md:44-46` (SHORTS_TMP) | Real: `SKILL.md:44-48` | Ninguno |
| `transcribe.py:2-23` (esquema dual en docstring) | Real: docstring `:2-35` (el ejemplo creció) | Ninguno; sigue sin versionado — razón del esquema canónico |
| — (no citado) | S1 ahora incluye `.claude-plugin/plugin.json`, `uninstall.ps1`, CHANGELOG y plantillas de GitHub | Ninguno para la fusión |
| — (no citado) | `preflight.sh:75` y `setup.sh` asumen layout `$VENV/bin/` (POSIX); un venv Windows estándar trae `Scripts/` | Cubierto por `tools/setup.py` (alias `bin/`) — ver DECISIONES #1 |

## L1 — claude-youtube-editor

| Cita del handoff | Estado real | Impacto |
|---|---|---|
| `transcribe.py:21-23,27-28,34` | `API_BASE:21`, `SPEECH_MODELS:23` ✓; el prompt verbatim está en `:25-29` y `disfluencies` en el payload `:74` | Ninguno |
| `render_cuts.py:145-150` (NTSC fraccional) | Real: nota NTSC/PTS en `:145-152`; el manejo activo (`Fraction(avg_frame_rate)`) en `video_duration()` `:52-61` | Ninguno |
| `verify_cut.py:77` | La línea 77 es carga de datos; los chequeos (diff de palabras, gaps interiores, drift A/V) están en `:100-199` | Ninguno |
| `cutlib.py:2,33` | ✓ (`AudioProbe` arranca en `:32`) | Ninguno |
| `gen_music.py:77-102`, `clean_voice.py:125-132` | ✓ verificados (ebur128 para música, RMS-match para voz) | Ninguno |
| `clean-cut/SKILL.md:8` | ✓ (`cuts.json` fuente de verdad + `edited-transcript.json` como spine) | Ninguno |

## Conclusión

Ningún drift invalida decisiones del handoff. Los dos hallazgos accionables
(requirements.txt nuevo de S1; layout `bin/` vs `Scripts/` del venv) están
incorporados en `docs/DECISIONES.md` y en el diseño de `tools/setup.py`.
