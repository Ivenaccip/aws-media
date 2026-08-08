# HANDOFF — Panel de transcript en el Cut Editor (+ backlog de eficiencia)

**Fecha:** 2026-08-07 · **Origen:** sesión de edición real de `videos/video-1` (Problemas.mp4)
**Objetivo:** reducir el ciclo de edición de ~40 min a ~15-20 min por video, moviendo la
verificación acústica de "iteraciones ciegas de máquina" a "una pasada humana de 5 min".

> **ESTADO (2026-08-07, misma fecha, sesión posterior): construido.** El panel del §3
> está implementado en `tools/editor/` (transcript clickeable con tachado por categoría,
> karaoke, selección de palabras→corte, flags anclados con "▶ ±2s", corrección de texto
> ASR al canónico con respaldo, toolbar con tooltips). Del backlog §5: **#3 hecho**
> (`tools/edited_transcript.py` + `segments.json` de render_cuts.py — delta 0 ms
> verificado contra ffprobe) y `/clean-cut` ya cablea el editor como su gate (paso 9)
> con verify único post-aprobación (#4 qa_loop quedó obsoleto por eso). Pendientes
> vivos del backlog: #1 (auditor de valles), #2 (verify audio-only), #5, #6, #7, #8,
> y el modo shorts del editor.

---

## 1. El problema, medido en una sesión real

La sesión de `video-1` (3:03 de metraje crudo, guion tipo reel con 4 retakes y 3 false
starts) tomó **~40 minutos** hasta dejar previews auditables. Desglose:

| Fase | Tiempo | Naturaleza |
|---|---|---|
| Setup, copia, WAV, transcripción | ~4 min | Piso de hardware |
| Autoría de `cuts.json` (juicio editorial de Claude) | ~6-8 min | Valor real |
| QA + proxy + primer render de previews | ~5 min | Necesario (1 render mínimo) |
| **4 ciclos render → transcribir preview → verify → ajustar bordes** | **~18-22 min** | **Desperdicio estructural** |
| Tropiezos de sesión (WAV manual, exploración inicial) | ~3-4 min | Evitable |

**Causa raíz del desperdicio:** Claude no tiene oídos. Su única retroalimentación sobre
un empalme es renderizar el video completo y re-transcribirlo con ASR (paso 10 del
pipeline de `/clean-cut`). Cada corrección de borde cuesta un ciclo completo de
~4-5 min. Ejemplos reales de la sesión:

- El onset de la palabra "compila" estaba fusionado dentro de un tropiezo ("uno" de
  1.1s según el ASR). Encontrar el borde costó 3 iteraciones (88.60 → 88.71 → 88.65) y
  al final la palabra se sacrificó por decisión editorial.
- Un empalme de retake dejó un residuo que suena "es decir" — gramaticalmente fluido,
  pero solo un oído humano puede confirmar si pasa o molesta. Quedó en flag.
- El verify ASR-vs-ASR genera falsas alarmas (Mikhail/Tiersman/Precionen sobre nombres
  propios) que hay que triar a mano en cada ciclo.

## 2. Lo que YA existe (no construir de cero)

- **`tools/editor/` (server.py 149 líneas + index.html 469 líneas):** editor de
  auditoría en localhost:8765. Ya tiene: timeline con waveform, bloques keep/cut con
  bordes arrastrables, nudge por frame (`,`/`.`), panel de flags, guardar a
  `cuts.json`, botón de render, y — clave — **modo "Edited" que reproduce el corte
  simulado en el navegador** saltando los cuts al vuelo sobre el video crudo
  (función `buildSegments`/`rebuildPlan`, playback con seeks). La audición instantánea
  sin render ya funciona.
- **`work/transcripts/<id>.canonical.json`:** cada palabra con timestamps
  (esquema canónico 1.0, `docs/SCHEMA.md`). Todo lo necesario para una vista de texto.
- **`cuts.json`:** fuente de verdad con keeps/cuts categorizados (`retake |
  false_start | filler | long_pause | dead_air`), fluff_suggestions y flags con
  `default`.

**Lo que NO existe:** ninguna vista de palabras. Hoy el usuario navega por waveform a
ciegas — encontrar el empalme de "compila" exige scrubbear.

## 3. El feature: panel de transcript estilo Riverside

Referencia visual: editor de Riverside (transcript a la izquierda clickeable y
editable, preview a la derecha, timeline abajo). Spec:

1. **Render del transcript por palabras** (spans desde el canónico). Lo cortado se ve
   **tachado y coloreado por categoría** (retake rojo, false_start naranja, pausas
   gris — reutilizar las CSS vars existentes `--cut-*`). Leer el texto saltándose lo
   tachado = leer el video final.
2. **Click en palabra → seek** al tiempo crudo (mapear con `fromGlobal`/plan en modo
   edited). Durante playback, la palabra actual se ilumina (karaoke inverso).
3. **Selección de palabras → "cortar selección":** crea el cut con bordes pegados a
   los límites de palabra del canónico (más preciso que arrastrar pixeles).
   Click en texto tachado → restaurar. Debe respetar la regla del repo: los keeps
   nunca se borran.
4. **Flags anclados en el texto:** marcador 🚩 inline en su posición, con botón
   "escuchar este empalme" que reproduce ±2s a caballo del corte en modo edited.
   (Hoy los flags viven en un panel aparte con timestamps que hay que buscar.)
5. **El ajuste sub-palabra se queda en el timeline** (nudge por frame ya existente):
   el transcript te lleva al lugar exacto, el timeline remata. Caso "compila" — el
   transcript no lo resuelve solo porque los bordes ASR eran incorrectos; el oído +
   nudge sí, en segundos.

**Cambios técnicos contenidos:**
- `server.py`: servir el canonical.json del proyecto (endpoint o estático).
- `index.html`: panel nuevo (izquierda o pestaña), sincronización bidireccional
  transcript ↔ timeline ↔ video. Vanilla JS, sin dependencias nuevas.
- Ninguna modificación al engine (`cutlib.py`, `render_cuts.py`) ni al esquema.

## 4. El flujo objetivo y los tiempos esperados

| Paso | Tiempo | Quién |
|---|---|---|
| `/empezar` + transcripción | ~4 min | máquina |
| Autoría de `cuts.json` + flags | ~5 min | Claude |
| UN render de preview | ~2 min | máquina |
| **Auditoría en el editor** (leer transcript, saltar a los 🚩, escuchar empalmes al instante, mover 2-3 bordes a oído) | **~5 min** | **usuario** |
| Master + gate ffprobe + transcode + verify único + edited-transcript | ~4-5 min | máquina |
| **Total hasta master terminado** | **~20 min** (vs ~50+ hoy) | |

Matiz honesto: queda **un** verify de máquina al final. La reproducción del navegador
es una aproximación por seeks; las colas exactas (snap-to-audio, soft landings) las
decide el engine al renderizar. Pero es 1 ciclo sobre un corte ya aprobado por oído,
no 4 ciclos de adivinanza.

## 5. Backlog complementario de eficiencia (discutido y priorizado)

Por relación esfuerzo/impacto, todos compatibles con el feature principal:

1. **Auditor de valles en `analyze_cut.py`** — ya detecta "hard entries" (atrapó los
   dos empalmes problemáticos ANTES del primer render) pero no propone. Extender para
   que devuelva la posición exacta del valle de silencio más cercano a cada borde
   planeado ("tu cut-in en 88.60 cae en voz; valle limpio en 88.54"). Colapsa las
   iteraciones de autoría a ~1.
2. **Verify sobre audio-only** — el corte de audio se arma aparte y sample-exacto;
   generar solo la pista de audio (segundos), transcribir y verificar, y renderizar
   video una única vez cuando pasa. Cada iteración residual baja de ~4-5 min a ~1 min.
3. **`edited-transcript.json` por mapeo determinístico** — el paso 13 hoy re-transcribe
   el master; el mapeo crudo→editado lo conoce `cutlib`. Derivarlo remapeando el
   canónico: timestamps exactos, cero costo ASR, cero varianza heredada por
   subtítulos/beats.
4. **`tools/qa_loop.py`** — un comando que encadene render→WAV→transcribe→verify
   (hoy son 4 comandos a mano por ciclo).
5. **Costura `/empezar`:** extraer el WAV automáticamente (el tropiezo "nada que
   transcribir" de la sesión) y pedir/deducir keyterms ANTES de transcribir (en la
   sesión se transcribió sin keyterms → "Lean"→"Ling", "Steersman" destrozado).
6. **Detección automática de retakes** — el retake de "Jacob Steersman" era repetición
   verbatim de 9s, detectable con similitud de n-gramas por ventana. Pre-marcar pares
   de tomas con ganadora sugerida acelera la autoría y sube decisiones tipo
   "la toma ganadora no dice 'en vivo'" a antes del render.
7. **Forced alignment (whisperX/CTC)** — el cambio más profundo: bordes de palabra
   ±20ms en el crudo (evita el caso "compila") y verify alineando el texto planeado
   contra el audio del render (mata las falsas alarmas ASR-vs-ASR). Contra: dependencia
   nueva en el venv fijado — evaluar aparte.
8. **Modelo asimétrico** — `large-v3` para la transcripción única del crudo (mejores
   nombres y bordes, se paga una vez), `small` para los loops de verify.

## 6. Criterios de aceptación del feature

- [ ] El transcript completo del clip se ve con tachado/colores fieles a `cuts.json`.
- [ ] Click en cualquier palabra hace seek correcto en modos raw y edited.
- [ ] Seleccionar palabras y cortar produce entradas válidas en `cuts.json`
      (categoría `manual` o elegible), y lo tachado se puede restaurar (keeps nunca
      se borran).
- [ ] Cada flag aparece anclado en el texto y su botón reproduce el empalme ±2s.
- [ ] Guardar desde el editor conserva el esquema de `cuts.json` intacto
      (compatible con `analyze_cut.py`, `render_cuts.py`, `verify_cut.py`).
- [ ] Un usuario sin conocimiento del pipeline completa la auditoría de un video de
      3 min en ≤5 minutos usando solo transcript + flags.

## 7. Estado del proyecto de referencia

`videos/video-1` quedó con previews renderizados y verificados
(`output/preview-tight.mp4`, `output/preview-natural.mp4`), `cuts.json` con 6 flags
documentados, y la auditoría del usuario pendiente — es el caso de prueba ideal para
el feature: tiene empalmes sutiles reales ("es decir" en 01:54, doble "eso" en 01:59,
"compila" sacrificada en 01:07, CTA doble en 02:57).
