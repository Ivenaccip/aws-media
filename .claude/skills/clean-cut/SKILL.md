---
name: clean-cut
description: Paso 1 de la rama longform — convertir metraje crudo de talking-head en un master limpio. Úsala cuando el usuario quiera "clean cut", "cortar el metraje", "quitar muletillas / aire muerto / malas tomas", "apretar el ritmo", producir cuts.json, o renderizar preview/master de un video-N de este repo. Cubre extracción de audio, transcripción (backend según .video-stack/config.json, al esquema canónico), autoría de cuts.json, la política de corte, QA + verify, previews tight/natural, el render final y edited-transcript.json. No construye overlays TSX (eso es /make-tsx).
---

# clean-cut — el corte de la rama longform

Convierte los clips crudos de `videos/video-N/` en un **master limpio** +
**`edited-transcript.json`**. La fuente de verdad es
`videos/video-N/work/analysis/cuts.json` — la escribes TÚ (Claude) leyendo el
transcript; no hay un segundo modelo. Los tools manejan audio, encoding y QA;
el juicio editorial es tuyo y se rige por la **política de corte** de abajo.

## Pipeline (en orden; P = videos/video-N)

1. **Scaffold** (una vez): `python tools/project.py new video-N`
2. **WAV 16 kHz mono por clip** → `P/work/audio/<id>.wav`:
   `ffmpeg -i P/<clip>.MP4 -vn -ac 1 -ar 16000 P/work/audio/<id>.wav`
3. **Keyterms del video** → `P/work/keyterms.txt` (antes de transcribir): ~10-40
   nombres propios/tech/jerga, uno por línea. En contenido LATAM el vocabulario
   técnico va EN INGLÉS (deploy, hook, pipeline) — inclúyelo tal cual; los keyterms
   evitan que el ASR "traduzca" o destroce esos términos.
4. **Transcribir UNA vez** (backend y modelo según `.video-stack/config.json`):
   `python tools/transcribe.py P` → `P/work/transcripts/<id>.json` (formato del
   engine de corte) + `<id>.canonical.json` (esquema canónico 1.0 — el contrato que
   consumen ambas ramas; ver docs/SCHEMA.md). Si el backend es nube, el tool muestra
   el **preview de costo** ("este archivo dura 47 min ≈ $0.16", precios de
   tools/pricing.json) y pide confirmación.
5. **Vista por takes**: `python tools/format_transcript.py P` → `P/work/analysis/takes-<id>.txt`
6. **Autoría de `cuts.json`** leyendo los takes (esquema abajo): keeps, cuts
   categorizados, fluff sugerido, flags de criterio.
7. **QA**: `python tools/analyze_cut.py P [--style tight]` → `qa-report.md`;
   `python tools/make_review.py P` → `review.md`
8. **Proxy del editor** (una vez): `python tools/make_proxy.py P`
9. **Previews** (ambos, el usuario elige): `python tools/render_cuts.py P --style tight --mode preview` y `--style natural`
10. **Verificación de máquina (OBLIGATORIA tras cada render, antes de mostrar):**
    extraer WAV del preview → `python tools/transcribe.py P --clips preview --force` →
    `python tools/verify_cut.py P --style <s>` → `verify-report.md`. Cada hallazgo se
    explica o se corrige — no declares bueno un corte con líneas sin explicar.
11. **AUDITORÍA DEL USUARIO** (gate duro): `python tools/editor/server.py P` →
    http://localhost:8765 — ajusta bordes, compara raw vs editado, guarda. Itera.
12. **Master final**: `render_cuts.py P --style <elegido> --mode final` + los dos
    pasos obligatorios post-render: gate `ffprobe` v:0 == a:0, y transcode H.264 de
    entrega con `-r <fps_fuente>` antes de `-i` (re-estampa CFR exacto — clave en
    metraje NTSC 60000/1001; ver docs/QA.md).
13. **`edited-transcript.json`** — el spine palabra→timestamp del corte final (ms,
    contrato interno de la rama longform): extraer WAV del master, transcribir y
    normalizar a `{words:[{text,start,end}...]}`.

## cuts.json (lo que TÚ escribes)

```jsonc
{
  "project": "video-1",
  "clip_order": ["0233"],
  "clips": [{
    "id": "0233", "file": "DJI_0233.MP4", "duration": 245.3,
    "keeps": [ { "s": 7.32, "e": 13.13, "text": "..." } ],
    "cuts":  [ { "s": 2.18, "e": 5.04, "cat": "retake", "text": "...", "note": "por qué" } ],
    "fluff_suggestions": [ { "s": 40.1, "e": 44.0, "text": "...", "crit": "restated-idea",
                            "status": "suggested" } ]
  }],
  "styles": { "tight":   { "internal_gap": 0.4, "min_tail": 0.14, "max_tail": 0.4,
                           "head": 0.11, "soft_gap": 1.2, "soft_max_tail": 0.6, "soft_margin": 3.0 },
              "natural": { "internal_gap": 0.4, "min_tail": 0.26, "max_tail": 0.45,
                           "head": 0.19, "soft_gap": 1.2, "soft_max_tail": 0.6, "soft_margin": 3.0 } },
  "flags": [ { "id": 1, "clip": "0233", "at": "00:30", "issue": "...", "default": "keep both" } ]
}
```

`cat` ∈ `retake | false_start | filler | long_pause | dead_air`. Tiempos en segundos
crudos del clip. **Los keeps nunca se borran** (un fluff `auto_applied` solo los
oculta; deshacer = volver a `suggested`).

## Política de corte (la voz editorial — mitad longform)

**Archivo editable por el usuario.** Su gemela es `references/scoring-rubric.md`
(rama shorts): mismos criterios, mismo transcript canónico. Objetivo de ritmo:
**agresivo con el contenido, natural con las pausas** (~0.45-0.5 s de respiración).
La palanca de retención es cortar relleno y redundancia, NO aplastar el silencio.

- **Corta siempre:** retakes y false starts (queda la toma ganadora; anota cuál
  supersede a cuál), tropiezos, aire muerto, y muletillas claras. En español LATAM
  las muletillas típicas son "este…", "o sea", "¿no?", "eh", "digamos", "como que" —
  y también las inglesas ("um", "you know") si el hablante mezcla. Una muletilla se
  corta cuando no carga intención; se conserva cuando es énfasis o personalidad
  (el transcript es verbatim justo para que puedas decidirlo).
- **Sugiere, no auto-quites (por regla):** fluff — preámbulo que retrasa el payoff,
  acotaciones evaluativas, ideas re-explicadas. Categoriza cada una (`crit`) y deja
  decidir al usuario en la auditoría.
- **Code-switching NO es error:** términos técnicos en inglés dentro de frases en
  español son la voz normal del canal. Jamás los marques como tropiezo, false start
  ni "palabra rara" — y protégelos vía keyterms al transcribir.
- **Pausas:** comprime sin aplanar. `tight` aterriza las pausas de flujo punchy;
  `natural` da más aire. Fin de sección o hueco de retake eliminado → aterrizaje
  soft (más cola). Renderiza AMBOS estilos y que el usuario elija.
- **Flags:** todo juicio dudoso se surface con un `default` — no lo resuelvas en
  silencio.

## Notas de engine (no tocar sin leer docs/QA.md)

- `tools/cutlib.py`: segmentación word-aware, piso de ruido percentil-10 por clip y
  snap-to-audio de colas — no ajustas padding a mano, ajustas los knobs de `styles`.
- `render_cuts.py` re-encodea (frame-exacto), corta VIDEO-ONLY y arma el audio
  aparte sample-exacto; concat por MPEG-TS intermedio. El porqué está documentado en
  el propio archivo y en docs/DECISIONES.md (pendiente #4).
- **El master longform NUNCA lleva loudnorm** (política de una sola pasada por rama).
