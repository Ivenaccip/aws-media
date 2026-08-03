# DECISIONES — pendientes de §9 del handoff, resueltos con evidencia

Verificado el 2026-08-03 sobre clones frescos (`vendor/claude-youtube-editor`,
`vendor/claude-shorts`, HEAD de esa fecha) y pruebas ejecutadas en esta máquina
(Windows 10, Git Bash MINGW64, ffmpeg 8.1.2, Python 3.10.1, Node 20.17, GPU NVIDIA).

---

## Pendiente #1 — ¿S1 corre en Git Bash nativo en Windows, o exige WSL?

**Respuesta: corre en Git Bash nativo. WSL NO es requisito.**

Prueba ejecutada: `bash scripts/preflight.sh <video.mp4> <outdir>` desde Git Bash
(MINGW64) con rutas Windows (`C:/...`) como input, output dir y `SHORTS_TMP`.

Resultado real:

```json
{
  "pass": false,
  "duration": 5.000000,
  "resolution": "640,360",
  "venv": "/c/Users/Ivenaccip/.shorts-skill",
  "errors": ["Remotion dependencies not installed — run: bash setup.sh"],
  "warnings": []
}
```

Todo el mecanismo del script funcionó: `ffprobe` parseó duración/resolución con ruta
Windows, `df -k /tmp` resolvió (MSYS mapea `/tmp`), `jq` armó el JSON, y el chequeo
`import faster_whisper` pasó. El único error fue `node_modules` sin instalar en el
clon fresco — esperado, no es un problema de plataforma.

**Caveats que el instalador debe cubrir (decisión para Fase 3):**

1. **Alias `bin/` del venv.** Los scripts de S1 invocan `$VENV/bin/python3`
   incondicionalmente (`scripts/preflight.sh:75`, `setup.sh:20,24`). Un venv creado
   por Python de Windows solo trae `Scripts/`. En esta máquina la prueba pasó porque
   el venv existente (`~/.shorts-skill`) tiene un alias `bin/` añadido a mano
   (verificado: `pyvenv.cfg` apunta a CPython de Windows y `bin/python3.exe` existe
   junto a `Scripts/`). → `tools/setup.py` crea el venv **y** el alias `bin/`
   (junction o copia) cuando corre en Windows.
2. **`jq` es dependencia real** de `preflight.sh` y `export.sh` usa `bc`. Git Bash no
   trae `jq` por defecto (aquí está vía scoop). → el setup lo verifica y lo reporta.

**Decisión:** el requisito de Windows del instalador es **Git Bash + jq**, no WSL.

## Pendiente #2 — ¿S1 respeta un `transcript.json` pre-colocado?

**Respuesta: NO. `transcribe.py` sobreescribe siempre.**

Evidencia en código (no hace falta prueba empírica — la ruta es inequívoca):

- `vendor/claude-shorts/scripts/transcribe.py:193-194` — `with open(args.output, "w")`
  incondicional. No hay chequeo de existencia, no hay flag `--skip-existing` ni
  `--force` (el archivo completo se leyó; no existe ninguna rama que lo evite).
- `vendor/claude-shorts/SKILL.md:79-81` — el paso 2 del flujo instruye ejecutar
  `transcribe.py --output $SHORTS_TMP/transcript.json` sin condición previa.

**Decisión para el puente:** no se parchea el S1 vendorizado (evitamos el fork que
§9 del handoff advierte). En el repo fusionado la skill orquestadora de shorts es
**nuestra** (`.claude/skills/shorts/SKILL.md`): su paso de transcripción primero
busca el transcript canónico del proyecto
(`videos/video-N/work/transcripts/canonical.json`); si existe, genera el JSON dual
de S1 con `tools/normalizers/canonical_to_s1_dual.py` y **no ejecuta**
`transcribe.py` de S1. La transcripción ocurre UNA vez por proyecto.

## Pendiente #3 — ¿`@remotion/captions` parsea SRT directo?

**Respuesta: el paquete exporta `parseSrt()`, pero S1 no usa SRT en ningún punto —
y el puente tampoco lo necesita.**

Evidencia:

- `vendor/claude-shorts/remotion/src/hooks/useCaptionPages.ts:2,28-31` — el único
  uso de `@remotion/captions` es `createTikTokStyleCaptions()`, alimentado con el
  array de captions `{text, startMs, endMs, timestampMs, confidence}` construido en
  memoria desde las props.
- El contrato de entrada del render es el array `captions` del JSON dual
  (`scripts/transcribe.py:106-112` lo genera; `src/types.ts:36` lo tipa con zod).
- SRT no aparece en ninguna ruta del pipeline de S1 (`grep -rn "srt" → 0 hits`
  en scripts/ y remotion/src/).

**Decisión:** el normalizador `canonical_to_s1_dual.py` produce directamente el
array `captions` en formato Remotion (`{text, startMs, endMs}`) desde las palabras
canónicas — conversión trivial (`startMs = round(start*1000)`). No se introduce SRT
como formato intermedio: sería un paso extra sin consumidor.

## Pendiente #4 — El "crossfade" de L1 (leyendo `cutlib.py` completo + bloque `styles`)

**Respuesta: L1 NO tiene crossfade de video. Las transiciones son cortes duros con
tres mecanismos de suavizado, todos parametrizados por el bloque `styles` de
`cuts.json`:**

1. **Snap-to-audio tails** (`cutlib.py:77-87`, `AudioProbe.snap_tail`): tras la
   última palabra de cada átomo de habla, el corte se extiende hasta que la
   envolvente RMS decae al piso de ruido del clip (percentil 10, `floor_db`,
   `cutlib.py:62-75`) + `margin` dB. Así la cola de la palabra nunca se recorta.
2. **Aterrizajes soft vs. punchy** (`cutlib.py:119-130`, `tail_for`): si el gap
   siguiente ≥ `soft_gap` (fin de sección / retake eliminado), la cola usa
   `soft_max_tail` y `soft_margin` (más aire); un gap corto en medio del flujo usa
   `max_tail` (corte más seco).
3. **Micro-fades de audio de 10 ms** por segmento (`render_cuts.py:67-68`:
   `afade=t=in:d=0.01` + `afade=t=out:d=0.01` sobre el corte sample-exacto) — evitan
   clicks en las junturas. Esto es lo más cercano a un "crossfade" que existe, y es
   de audio, no de video.

**Bloque `styles`** (knobs, sin constantes por video — `cutlib.py:4-5`,
`clean-cut/SKILL.md:91-93`): `internal_gap` (partir keeps en átomos en pausas ≥),
`min_tail`/`max_tail` (rango del snap), `head` (lead-in antes del átomo), `margin`
(dB sobre el piso que cuenta como "decaído"), `soft_gap`, `soft_max_tail`,
`soft_margin`. Valores de referencia calibrados contra el corte manual del autor:
`tight = {internal_gap:0.4, min_tail:0.14, max_tail:0.4, head:0.11, soft_gap:1.2,
soft_max_tail:0.6, soft_margin:3.0}`; `natural` sube `min_tail:0.26, max_tail:0.45,
head:0.19`.

**Decisión:** se documenta tal cual (este archivo + `docs/QA.md`); no hay nada que
portar como "crossfade". El repo fusionado conserva el mecanismo íntegro al copiar
`cutlib.py` + `render_cuts.py` sin tocar su lógica de timing.

---

## Decisiones adicionales tomadas durante la verificación

- **El venv de shorts en Windows**: `tools/setup.py` es dueño del venv (crea, instala
  deps fijadas de `requirements.txt`, añade alias `bin/`). Los scripts de S1 se copian
  a `tools/shorts/` sin cambios de lógica.
- **`vendor/` queda gitignorado**: los upstream son referencia de verificación y
  fuente de copia (MIT), no dependencia de runtime. `docs/DRIFT.md` registra el
  estado contra el que se verificó.

## Bugs reales encontrados y corregidos durante el flujo end-to-end (2026-08-03)

1. **Drift A/V por tasa de muestreo en `render_cuts.py` (bug heredado de L1).**
   `render_audio_segment` recortaba con `atrim=end_sample=n` donde `n` se calcula a
   48 kHz — pero `end_sample` cuenta muestras a la tasa del audio FUENTE. Con metraje
   cuyo audio no viene a 48 kHz (la prueba usaba 16 kHz) el trim nunca actuaba: cada
   segmento quedaba +0.2 s largo y el gate `v:0 == a:0` falló por 3.0 s acumulados en
   15 cortes. Fix: `aresample=48000` ANTES del `atrim` en el filtergraph. Tras el fix,
   el gate pasa exacto (61.233 == 61.233) y el diff de palabras del verify quedó
   0 extra / 0 missing / 0 different. Con el metraje típico de L1 (48 kHz) el bug era
   invisible — por eso sobrevivió upstream.
2. **Detección de NVENC por listado ≠ NVENC funcional.** En esta máquina (RTX 3050
   Ti, driver 566.07, ffmpeg 8.1.2) `h264_nvenc` aparece en `-encoders` pero falla al
   codificar (ffmpeg 8 exige driver ≥ 570). `render_cuts.py` (que lo hardcodeaba) y
   `export.sh` de S1 (que solo grep-eaba el listado) se parchearon con una prueba
   funcional (codificar 3 frames negros) y fallback a libx264/libx265 — mismo
   pipeline, más lento.
3. **`bc` no existe en Git Bash** → `export.sh` y `validate.sh` ahora usan `awk`
   (siempre presente). Un requisito menos en Windows.
4. **`validate.sh` fallaba en Windows** por artefactos de la salida CSV de ffprobe
   (comas/CR colgantes) — se limpian con `tr -d` antes de comparar.

Verificación empírica de la pasada única de loudness: el render de Remotion mide
−20.3 LUFS (sin tocar) y el export −14.0 LUFS exactos — una sola normalización,
en export, como dicta docs/QA.md.
