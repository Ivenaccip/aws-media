---
name: shorts
description: Rama shorts del repo — extraer clips cortos virales (9:16, captions animados) de un video largo o de un proyecto video-N existente. Úsala cuando el usuario diga "shorts", "clips cortos", "tiktok/reels del video", "clips verticales" o "saca shorts de video-N". Flujo interactivo: Claude puntúa candidatos con la rúbrica, el usuario aprueba y ajusta, Remotion renderiza captions, FFmpeg exporta por plataforma. Consume el transcript canónico del proyecto — NO re-transcribe si ya existe.
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - AskUserQuestion
---

# shorts — creador interactivo de clips verticales

Eres el productor de la rama shorts. El juicio editorial (qué segmento tiene hook
real) es tuyo, guiado por `references/scoring-rubric.md`; los scripts en
`tools/shorts/` y el proyecto `remotion/` ejecutan.

## Pre-Flight — SHORTS_TMP se cablea al proyecto, SIEMPRE

Nada se escribe a `/tmp`. Todo el estado vive en el árbol `work/` del proyecto:

```bash
# P = nombre del proyecto (p.ej. video-1); créalo si no existe:
python tools/project.py new video-1
export SHORTS_TMP="$(python tools/project.py shorts-tmp video-1)"
mkdir -p "$SHORTS_TMP/clips"
```

Esto lo haces TÚ al arrancar la skill — nunca se lo pidas al usuario a mano.
INPUT_FILE = el metraje crudo del proyecto o el master de la rama longform
(`videos/video-1/output/master-<style>-h264.mp4`) — el master no trae loudnorm,
así que la única pasada de sonoridad seguirá siendo el export (docs/QA.md).

## Pipeline interactivo

### 1. PREFLIGHT

```bash
bash tools/shorts/preflight.sh INPUT_FILE "videos/video-1/output/shorts"
bash tools/shorts/detect_gpu.sh
```

Si falla, reporta y detente. Reporta duración, resolución, GPU y tiempo estimado.

### 2. TRANSCRIPT — canónico primero, transcribir solo si falta

**Regla del repo: se transcribe UNA vez por proyecto** (DECISIONES pendiente #2).

1. Busca el canónico: `videos/video-1/work/transcripts/*.canonical.json`.
2. **Si existe** → genera el JSON dual sin transcribir:
   ```bash
   python tools/normalizers/canonical_to_s1_dual.py \
       videos/video-1/work/transcripts/<id>.canonical.json "$SHORTS_TMP/transcript.json"
   ```
3. **Si NO existe** → transcribe con el backend configurado (muestra preview de
   costo si es nube) y luego deriva el dual:
   ```bash
   python tools/transcribe.py videos/video-1        # escribe también el canónico
   python tools/normalizers/canonical_to_s1_dual.py ... "$SHORTS_TMP/transcript.json"
   ```
   (Para un archivo suelto sin proyecto: créale proyecto con tools/project.py —
   la trazabilidad no es opcional.)

### 3. TIPO DE CONTENIDO

```bash
python tools/shorts/detect_content.py INPUT_FILE --output "$SHORTS_TMP/content_type.json"
```
talking-head → crop 9:16 con face-tracking · screen → layout con letterbox ·
podcast → tracking de hablantes. Pregunta si quiere override.

### 4. ANÁLISIS — tú lees el transcript

Lee `$SHORTS_TMP/transcript.json` completo y `references/scoring-rubric.md`.
Puntúa 8-12 candidatos (15-55 s) en las 5 dimensiones ponderadas (hook 0.30,
coherencia 0.25, emoción 0.20, densidad 0.15, payoff 0.10). Recuerda: el
code-switching español-inglés es la voz normal del canal, no incoherencia.

**Limpieza de captions:** produce `$SHORTS_TMP/transcript_cleaned.json` (misma
estructura): quita muletillas de AMBOS idiomas ("este…", "o sea", "¿no?", "um"),
corrige errores obvios de ASR por contexto, **sin tocar ningún timestamp**.

### 5. PRESENTAR — tabla de candidatos con score, hook sugerido y por qué. Pregunta
con AskUserQuestion: ¿cuáles?, ¿estilo de captions (bold/bounce/clean)?,
¿plataforma (youtube/tiktok/instagram/all)?

### 6. APROBAR — ajustes de timecodes del usuario ("mueve el inicio del 2 tres
segundos atrás"), confirma, estima tiempo de render y escribe
`$SHORTS_TMP/approved_segments.json` (formato S1: segments[{id,start,end,hook_line1,hook_line2,score}], style, platform, content_type).

### 7. SNAP — límites por palabra + silencio (nunca corta a media palabra):

```bash
python tools/shorts/snap_boundaries.py \
    --segments "$SHORTS_TMP/approved_segments.json" \
    --transcript "$SHORTS_TMP/transcript.json" \
    --input-video INPUT_FILE \
    --output "$SHORTS_TMP/snapped_segments.json"
```
Reporta los deltas. De aquí en adelante usa `snapped_segments.json`.

### 8. EXTRAER — **stream copy OBLIGATORIO** (prohibido re-encode en este paso):

```bash
ffmpeg -y -ss START -to END -i INPUT_FILE -c copy "$SHORTS_TMP/clips/clip_01.mp4"
python tools/shorts/compute_reframe.py --clips-dir "$SHORTS_TMP/clips/" \
    --content-type TIPO --output "$SHORTS_TMP/reframe.json"
```

### 9. RENDER (Remotion, fps fijo 30 — documentado en README):

```bash
node remotion/render.mjs \
    --segments "$SHORTS_TMP/snapped_segments.json" \
    --reframe "$SHORTS_TMP/reframe.json" \
    --captions "$SHORTS_TMP/transcript_cleaned.json" \
    --style STYLE --clips-dir "$SHORTS_TMP/clips/" \
    --output-dir "$SHORTS_TMP/render/"
```

### 10. EXPORT — la ÚNICA pasada de loudnorm de esta rama:

```bash
bash tools/shorts/export.sh --input-dir "$SHORTS_TMP/render/" \
    --platform PLATAFORMA --output-dir "videos/video-1/output/shorts/"
bash tools/shorts/validate.sh --output-dir "videos/video-1/output/shorts/"
```

Presenta la tabla final (archivo, plataforma, duración, tamaño). Si algún archivo
falla validación, re-render/re-export antes de entregar.

## Reglas duras

1. Preflight siempre antes de procesar.
2. **Nunca renderices sin aprobación explícita** de candidatos.
3. Transcribir en nube sin mostrar preview de costo = bug (precios SOLO de
   `tools/pricing.json`; escribir "$0.21 dólares por hora", jamás "centavos").
4. Stream copy al extraer clips; el loudnorm vive solo en export.sh.
5. `SHORTS_TMP` apunta al proyecto — si ves rutas `/tmp/claude-shorts`, algo está
   mal cableado; detente y corrige.
6. Errores: reporta y sugiere arreglo; "re-analiza" te regresa al paso 4.
7. Referencias: `references/caption-styles.md` (estilos y springs),
   `references/platform-specs.md` (encoding por plataforma).
