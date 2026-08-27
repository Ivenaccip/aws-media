# HANDOFF — Edición de múltiples videos (F3.5, pendiente)

**Fecha:** 2026-08-25 · **Estado:** diseño acordado a grandes rasgos, sin código.
**Origen:** pregunta del usuario ("¿qué pasa si quiero editar 2 videos a la vez?
¿tenemos flujo para unirlos?") tras cerrar las Fases 0-3 de la fusión (PLAN-FUSION.md).

## Lo que YA existe (no reconstruir)

- **El motor es multi-clip nativo.** `cuts.json` tiene `clip_order: [ids]` y `clips[]`
  (cada uno con `file`, `duration`, `keeps/cuts`); `tools/make_proxy.py` concatena
  todos los clips en UN proxy y escribe `manifest.json` con offsets por clip; el
  cut-editor pinta marcadores de clip y corta a través de todos; `render_cuts.py`
  une en el orden de `clip_order`. El flujo `/empezar` de video-stack con varios
  MP4 produce exactamente esto.
- **Transcripts por clip.** Un canónico por fuente: `work/transcripts/<source.id>.canonical.json`
  (docs/SCHEMA.md). El editor carga palabras por clip (`load_canonical_words`).
- **Editor multi-proyecto.** `/editor/{name}/` con estado por proyecto (render,
  chat, candado `_ocupado`). Dos pestañas = dos proyectos en paralelo, ya funciona.
  Limitación conocida: un solo worker, operaciones pesadas compiten por CPU.
- **El puente** (`tools/normalizers/generated_to_canonical.py`) crea proyectos de
  UN solo clip (`source_id = "pelicula"`), con overlays por escena en
  `work/overlays.json` (pista 2, regenerables vía g1/g2).

## Los 3 casos, en orden recomendado

### Caso A — Unir 2+ películas generadas en un proyecto (esfuerzo BAJO)
`gen-tesla` + `gen-oso` → un solo editor. Diseño:
- Puente acepta N work dirs: `generated_to_canonical.py WORK1 WORK2 NOMBRE --unir`.
- Cada película = un clip del proyecto (`clip_order: ["peli1", "peli2"]`), su
  canónico propio (tiempos relativos a SU fuente — regla del schema), su wav.
- `overlays.json`: los `t_in/t_out` de la película 2 se corren por la duración de
  la 1 (o mejor: agregar campo `clip` al overlay y resolver offset vía manifest —
  decidir al implementar; la segunda opción sobrevive reordenamientos).
- `rearmar_pelicula()` hoy asume un `pelicula.mp4` único → generalizar a
  reconstruir el clip afectado y regenerar proxy (el render final ya une clips).
- UI: en e1, selección múltiple de proyectos generados + botón "Unir en un proyecto".

### Caso B — Agregar un video (metraje real) a un proyecto existente (esfuerzo MEDIO)
- Endpoint de subida (multipart) → guarda el MP4 en `videos/<n>/` → transcribe UNA
  vez (`tools/transcribe.py`, backend según `.video-stack/config.json`) → append a
  `clip_order`/`clips` con keep-all → `make_proxy` → recargar editor.
- Cuidado: transcripción en nube exige preview de costo (regla del repo).
- UI: botón "＋ Agregar video" en el editor o en e1.

### Caso C — Mezclar metraje real + escenas generadas en un timeline (esfuerzo ALTO)
El caso ambicioso (grabación propia con escenas IA intercaladas). Piezas: contrato
canónico común (ya), `tools/insert_broll.py` (inserción en master), overlays g1/g2.
Diseño abierto: los overlays necesitarían un modo "insertado" (desplaza el timeline)
además del actual "sustituye clip" — implica remapear edited-transcript y subs tras
cada inserción (lo que hoy hace `edited_transcript.py` para cortes). NO empezar por
aquí; diseñarlo cuando A y B estén vivos.

## Claves técnicas / trampas conocidas

- El canónico es SIEMPRE relativo a su fuente cruda; NUNCA emitir un canónico
  "global" del timeline unido (rompe el contrato — docs/SCHEMA.md). Lo global
  vive en manifest offsets y en edited-transcript.json (ms sobre el master).
- `subs` y `edited_transcript.py` ya saben de multi-clip (offsets del manifest) —
  para el caso A hay que generar edited-transcript con el mismo mecanismo, no 1:1.
- Regeneración g2 en proyecto unido: recorta a duración exacta del clip original
  (invariante que mantiene válidos manifest/subs) — igual que hoy.
- Candado `_ocupado` es por proyecto; en proyecto unido sigue siendo uno a la vez.
- Costeo: `overlays.json` del proyecto unido debe HEREDAR los libros de gastos de
  los proyectos origen o empezar en cero — decidir (propuesta: heredar suma con
  nota de origen).

## Decisiones abiertas

1. Caso A: ¿overlay con campo `clip` + offset dinámico, o t_in/t_out globales
   recalculados al unir? (propuesta: campo `clip`).
2. ¿Unir es copia (proyecto nuevo independiente) o referencia (los origen quedan)?
   Propuesta: copia — coherente con "las versiones nunca se borran".
3. UI del caso A: ¿desde e1 (selección múltiple) o desde el editor (menú)?
4. Nombre del proyecto unido (`gen-tesla+oso`? el usuario elige?).

## Referencias

`PLAN-FUSION.md` (raíz de D:\adquisition) · `docs/SCHEMA.md` · `tools/make_proxy.py`
· `tools/normalizers/generated_to_canonical.py` · `pipeline/overlays.py` ·
`server/editor.py` · `server/overlays_api.py` · memoria de sesión:
`fusion-video-stack-pipeline`.
