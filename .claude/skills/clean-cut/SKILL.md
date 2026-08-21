---
name: clean-cut
description: Paso 1 de la rama longform — convertir metraje crudo de talking-head en un master limpio. Úsala cuando el usuario quiera "clean cut", "cortar el metraje", "quitar muletillas / aire muerto / malas tomas", "apretar el ritmo", producir cuts.json, auditar el corte en el editor visual, o renderizar preview/master de un video-N de este repo. Cubre extracción de audio, transcripción (backend según .video-stack/config.json, al esquema canónico), autoría de cuts.json, la política de corte, la AUDITORÍA en el editor de cortes (transcript clickeable + flags escuchables + corrección de texto ASR), el verify único sobre el corte aprobado, el render final y edited-transcript.json por mapeo determinístico. No construye overlays TSX (eso es /make-tsx).
---

# clean-cut — el corte de la rama longform

Convierte los clips crudos de `videos/video-N/` en un **master limpio** +
**`edited-transcript.json`**. La fuente de verdad es
`videos/video-N/work/analysis/cuts.json` — la escribes TÚ (Claude) leyendo el
transcript; no hay un segundo modelo. Los tools manejan audio, encoding y QA;
el juicio editorial es tuyo y se rige por la **política de corte** de abajo.
La **verificación acústica es del usuario** en el editor de cortes (paso 9):
tú no tienes oídos — no la simules con ciclos de render + ASR.

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
9. **AUDITORÍA EN EL EDITOR (gate duro — aquí vive la verificación acústica):**
   pre-flight: `python tools/check_claude_login.py` — si sale `[FALTA]`,
   ANTES de abrir el editor entrégale `claude /login` en su propio bloque
   ```bash``` (botón Run) + pasos: click → autorizar en el navegador → "listo";
   re-corre el chequeo y recién entonces lanza el server (su chat embebido usa
   la sesión del CLI; sin ella abre pero no responde). Luego
   `python tools/editor/server.py P [puerto]` (default 8765; si está ocupado pasa
   otro) → entrega la URL al usuario. Ahí el usuario:
   - **lee el transcript** (panel izquierdo): lo tachado/coloreado por categoría es
     lo que sale del corte — leer lo no tachado = leer el video final. Click en
     palabra = seek; durante playback la palabra actual se ilumina.
   - **escucha cada 🚩** (panel derecho, "Decisiones"): botón "▶ ±2s" reproduce a
     caballo del empalme en modo Edited. Semáforo por flag: 🔴 pendiente →
     🟡 nota guardada → 🟢 resuelto (`status: "resolved"` en cuts.json). El usuario
     puede anotar su decisión por flag y mandarlas JUNTAS al chat embebido, que
     aplica todo en un pase; o resolverlas a mano actuando sobre los bloques.
   - **ajusta**: bordes por drag/nudge de frame, cortar/restaurar por bloque o por
     selección de palabras, todo con toolbar + tooltips.
   - **corrige texto del ASR** (doble click en la palabra): se persiste al
     CANÓNICO con respaldo — y por el paso 12 fluye a subtítulos y b-roll.
   - **💾 Save** y **🎬 Render preview** desde el editor para el chequeo final de
     oído (el playback del navegador es aproximado; el render es exacto). Puede
     comparar `tight` vs `natural` con el selector antes de renderizar.
   TÚ (Claude) esperas su OK y el estilo elegido. NO iteres ciclos
   render→ASR→ajuste por tu cuenta: la verificación acústica es del usuario y es
   instantánea en el editor.
10. **Verificación de máquina (UNA vez, sobre el corte APROBADO):** extraer WAV del
    preview aprobado → `python tools/transcribe.py P --clips preview --force` →
    `python tools/verify_cut.py P --style <s>` → `verify-report.md`. Cada hallazgo
    se explica o se corrige — no declares bueno un corte con líneas sin explicar.
    (Los renders de audición intermedios del editor no llevan verify individual;
    ver docs/QA.md.)
11. **Master final**: `render_cuts.py P --style <elegido> --mode final` + los dos
    pasos obligatorios post-render: gate `ffprobe` v:0 == a:0, y transcode H.264 de
    entrega con `-r <fps_fuente>` antes de `-i` (re-estampa CFR exacto — clave en
    metraje NTSC 60000/1001; ver docs/QA.md).
12. **`edited-transcript.json`** — el spine palabra→timestamp del corte final (ms,
    contrato interno de la rama longform). Se deriva SIN re-transcribir:
    `python tools/edited_transcript.py P --style <elegido> --mode final`
    remapea el canónico al timeline del master usando las duraciones reales del
    render (`segments.json`, lo escribe render_cuts.py). Cero costo ASR, timestamps
    exactos, y las correcciones de texto hechas en el editor llegan intactas a
    subtítulos y b-roll. PROHIBIDO volver a transcribir el master para esto.

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
  "flags": [ { "id": 1, "clip": "0233", "at": "00:30", "issue": "...", "default": "keep both",
               "status": "pending" } ]
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
  soft (más cola). El usuario compara ambos estilos en el editor (selector +
  playback simulado) y renderiza a oído el que le convenza.
- **Flags:** todo juicio dudoso se surface con un `default` — no lo resuelvas en
  silencio.

## Notas de engine (no tocar sin leer docs/QA.md)

- `tools/cutlib.py`: segmentación word-aware, piso de ruido percentil-10 por clip y
  snap-to-audio de colas — no ajustas padding a mano, ajustas los knobs de `styles`.
- `render_cuts.py` re-encodea (frame-exacto), corta VIDEO-ONLY y arma el audio
  aparte sample-exacto; concat por MPEG-TS intermedio. El porqué está documentado en
  el propio archivo y en docs/DECISIONES.md (pendiente #4).
- **El master longform NUNCA lleva loudnorm** (política de una sola pasada por rama).
