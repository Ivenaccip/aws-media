# QA — checklist de verificación del repo fusionado

## Loudness: una sola pasada por rama (handoff §4.4)

Política verificada leyendo el código final (2026-08-03):

| Rama | Dónde se normaliza | Dónde NO |
|---|---|---|
| **Longform** | Voz: RMS-match al source, con techo de pico (`tools/clean_voice.py`, "NOT integrated LUFS"). Assets de música/SFX: normalizados a ~-20 LUFS por ebur128 **al generarse en la librería** (`tools/gen_music.py` `normalize_clip`, catálogos en `media/library/*/catalog.json`) | **El master NUNCA recibe `loudnorm`.** `render_cuts.py` copia video y codifica AAC sin filtro de sonoridad; `mix_music.py`/`mix_sfx.py` mezclan por gain relativo |
| **Shorts** | `loudnorm=I=-14:TP=-1:LRA=11` **solo en export** (`tools/shorts/export.sh` — las 3 rutas de plataforma: youtube/tiktok/instagram, con y sin NVENC) | `remotion/render.mjs` no aplica ningún filtro de audio; la extracción de clips es stream copy (`-c copy`, sin tocar audio) |

**Invariante:** ningún archivo pasa dos veces por normalización de sonoridad.
- El input de shorts es el metraje crudo o el master longform — que no trae loudnorm —
  y la única pasada ocurre al final, en export.
- El master longform conserva la dinámica del RMS-match; agregarle loudnorm está
  **prohibido** (rompería la política deliberada de L1).

### Checklist al tocar cualquier ruta de audio

- [ ] `grep -rn "loudnorm" tools/ remotion/` → debe aparecer SOLO en `tools/shorts/export.sh`
- [ ] La extracción de clips de shorts sigue siendo `-c copy` (jamás re-encode en ese paso)
- [ ] `clean_voice.py` sigue haciendo RMS-match (no LUFS) con techo de pico
- [ ] Ningún filtro de audio nuevo en `remotion/render.mjs`

## QA del corte (herencia L1 — piezas únicas que no se pierden)

- [ ] `python tools/verify_cut.py P --style <s>` tras CADA render: diff de palabras
      (extra = ghost speech, faltantes = clipped), gaps interiores, drift A/V
- [ ] Gate definitivo del master: `ffprobe stream=duration` en v:0 vs a:0 — **iguales**
      (el presupuesto creciente de verify_cut puede enmascarar drift acumulado)
- [ ] fps NTSC fraccional (60000/1001): el transcode de entrega re-estampa con
      `-r <fps_fuente>` ANTES de `-i` (ver nota en `render_cuts.py:145-152`)

## QA de shorts (herencia S1)

- [ ] Snapping por word boundaries + silencedetect antes de extraer (`snap_boundaries.py`)
- [ ] Aprobación interactiva: candidatos con score → el usuario elige y ajusta timecodes
- [ ] `bash tools/shorts/validate.sh --output-dir ...` tras export: playable, 1080x1920,
      audio presente, codec H.264, duración 3-90 s

## Transcripción

- [ ] Una sola transcripción por proyecto; ambas ramas leen el canónico
      (`work/transcripts/<id>.canonical.json`, schema 1.0)
- [ ] Ninguna skill ramifica por `asr.backend`
- [ ] Toda corrida en nube muestra preview de costo antes de enviar
      ("este archivo dura 47 min ≈ $0.16") con precios de `tools/pricing.json`
