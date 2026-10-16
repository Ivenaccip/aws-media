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

- [ ] `python tools/verify_cut.py P --style <s>` sobre todo corte que se declare
      listo — mínimo el preview APROBADO en la auditoría, antes del master. (Los
      renders de audición que el usuario dispara desde el editor mientras itera a
      oído no llevan verify individual: el oído humano es ese gate.) Diff de
      palabras (extra = ghost speech, faltantes = clipped), gaps interiores, drift A/V
- [ ] Gate definitivo del master: `ffprobe stream=duration` en v:0 vs a:0 — **iguales**
      (el presupuesto creciente de verify_cut puede enmascarar drift acumulado)
- [ ] fps NTSC fraccional (60000/1001): el transcode de entrega re-estampa con
      `-r <fps_fuente>` ANTES de `-i` (ver nota en `render_cuts.py:145-152`)

## QA de la unión de videos (E2)

La caja «Edición» del inicio une varios videos en una COPIA (`worker/editar_copia.py`). Lo que se
verifica, con ffmpeg real y metraje sintético (`tests/test_e2_ffmpeg_union.py`, `-f lavfi`):

- [ ] **El render de la nube corre la compuerta `v:0 == a:0`.** `worker/render_task.py` mide el
      `preview-<estilo>.mp4` con `ffprobe` y, si video y audio difieren más de `DRIFT_TOL_S` (0,15 s,
      la de `make_subs.py` e `insert_broll.py`), deja el render en `error` y NO lo sube como listo.
      Antes solo el render local la corría. (`tests/test_e2_render_gate.py`)
- [ ] **El proxy de la unión es normalizado**: `tools/make_proxy.py` deja TODAS las partes en 1280×720
      (720×1280 si el primer clip es vertical), 30 fps y AAC 48 kHz estéreo — con silencio si un clip no
      trae audio — para que `concat -c copy` no descuadre. El manifiesto (`manifest.json`) cuenta lo
      mismo que el video. El proxy es solo para auditar: no cambia lo que se corta.
- [ ] **Se prueba con el ffmpeg de la imagen (5.1), no solo con el de la máquina (6.x).** El audio de cada
      parte se corta con `-t` (no `-shortest`, que con 5.1 deja pasar el relleno): corre
      `tests/test_e2_ffmpeg_union.py` también con un ffmpeg 5.1 (la CI lo hace dentro del contenedor).
      Con la imagen de producción: cada `part-*.mp4` debe tener `|a:0 − v:0| ≤ 0,03 s` y la suma de los
      offsets del manifiesto debe dar la duración del video del proxy (±0,05 s).
- [ ] **`render_cuts.py --mode preview` usa el mismo filtro** (tamaño del primer clip, 30 fps), rellena
      con silencio un clip sin audio y rellena con silencio un audio más corto que su video (si no, la
      deriva se suma clip tras clip). **`--mode final` no cambia**: sin filtro de video y con su
      encoder de siempre.
- [ ] **`loudnorm` sigue prohibido en el master.** La unión no nivela el sonido ni lo promete; el
      `grep -rn "loudnorm" tools/ remotion/` del checklist de arriba debe seguir mostrando SOLO
      `tools/shorts/export.sh`.
- [ ] Un clip marcado `sin_transcript` no tiene canónico y `tools/edited_transcript.py` lo trata como
      sin palabras (docs/SCHEMA.md); un canónico que falta sin esa marca sigue siendo error.
- [ ] Dinero: cada camino de fallo devuelve el monto cobrado una vez
      (`tests/test_e2_worker_copia.py`, `tests/test_m23_barredor.py`). El evento FAILED de una ejecución
      VIEJA no cierra el reintento (se compara su `startDate` con `editar.inicio`), y una deuda anotada
      por el worker (`editar.devolucion_pendiente`) la cobra el barredor aunque el doc ya no esté
      `corriendo`, una sola vez.

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
