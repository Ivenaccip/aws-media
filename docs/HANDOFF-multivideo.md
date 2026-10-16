# HANDOFF — Edición de múltiples videos (F3.5)

**Fecha:** 2026-08-25 (diseño) · **Actualizado:** 2026-10-15 (E2) · **Estado:** los Casos A y B
están **hechos en la nube** (la caja «Edición» del inicio: «Elegir de Mis creaciones» y subir varios
videos); el Caso C sigue abierto. Lo que viene después de este bloque es el diseño original, que se
conserva porque explica por qué el motor es como es.
**Origen:** pregunta del usuario ("¿qué pasa si quiero editar 2 videos a la vez?
¿tenemos flujo para unirlos?") tras cerrar las Fases 0-3 de la fusión (PLAN-FUSION.md).

## Qué se hizo en E2 (Casos A y B en la nube)

- **La unión la hace `worker/editar_copia.py`**, NO `generated_to_canonical.py --unir` (esa opción
  nunca existió). `worker/editar_task.py` despacha ahí cuando `doc.editar.copia` es `true`; el camino
  de UN video sin `copia` (E1, `/api/editar`) quedó como estaba. El contrato completo vive en el
  archivo y en `tests/test_e2_*.py`.
- **Decisión 2 resuelta: copia, no referencia.** Siempre se edita una COPIA (`videos/ed-<8 hex>/`)
  y el original queda como respaldo, intacto. La copia es de servidor a servidor (`media_sync.copiar`,
  copia gestionada de S3, sin bajar nada) en `videos/<copia>/clips/c01…c12.<ext>` — nombre por
  `clip_id`, no por título. El worker verifica que cada original es de la cuenta, nunca escribe fuera
  de `videos/<copia>/` y fija el ETag del original al copiarlo.
- **Un canónico por clip**, reescrito con `source.id` = id del clip, `source.path` = su archivo en la
  copia y `source.duration` = lo medido con `ffprobe` (los tiempos son LOCALES a su fuente, como
  manda `docs/SCHEMA.md`; jamás se emite un canónico «global»). Un clip de IA (8 s) no se transcribe:
  su entrada en `cuts.json` lleva `"sin_transcript": true`, no hay canónico, y entra entero.
- **El LLM se llama una vez por clip** con el mismo texto y la línea fija «Este es el video k de n…»
  (`_mensaje_usuario(…, union=(k, n))`). Si falla en cualquiera, falla todo y se devuelve todo.
  «No aplicado:» se junta en una duda por motivo.
- **La copia NO es una película.** No se llama `pelicula.mp4`, no lleva `flags.generado`, `origen` ni
  `subidas`: subtítulos, publicar, render y shorts toman esos tres como «la base» y quemarían o
  publicarían la película SIN editar. `tests/test_e2_worker_copia.py` lo prueba contra los
  consumidores reales.
- **No se copian** `overlays.json` (sus `t_in/t_out` son de UNA película), `output/`, `work/render/`,
  `edited-transcript.json`, `portada.jpg`, ni los cortes previos del original: una edición nueva parte
  de su metraje crudo. No se sube `clips/` (ya está en S3 por la copia) ni las partes del proxy.
- **Topes:** hasta 12 videos, 90 min en total, 15 GB en total (disco efímero de Fargate), todos
  horizontales o todos verticales. El servidor los rechaza ANTES de cobrar; el worker los vuelve a
  comprobar sobre lo que mide de verdad.
- **Dinero:** cada camino de fallo devuelve el monto cobrado (`doc.editar.creditos`) con la referencia
  `editar-sugerir:<copia>`, reclamando antes con `db.reclamar_fallo_editor` (lo gana el worker o el
  barredor, nunca los dos). Una unión de 2+ videos no se devuelve por «cero sugerencias»: la unión ES
  el entregable. Ver `docs/OPERACION.md`.
  - **Un evento tardío no cierra el reintento.** «Reintentar» reutiliza el MISMO doc, así que el evento
    FAILED de la ejecución vieja llegaba cuando la corrida nueva ya estaba `corriendo` y la reclamaba
    (devolviéndole lo recién cobrado, o lo que aún no se cobraba). El barredor compara el `startDate`
    del evento con `editar.inicio` (que el API escribe antes de lanzar): si la corrida vigente empezó
    más de `HOLGURA_RELOJ_S` (5 s) DESPUÉS de esa ejecución, el evento es de otra y no se toca nada. Con
    `cobrado: false` (el reintento aún no confirma su cobro) manda el libro mayor, no el monto del doc.
  - **Una deuda nunca se queda sin lector.** Si el monedero falla y el worker no puede reabrir la corrida
    (el índice único de «una copia en curso» lo rechaza porque la persona ya lanzó otra), o si la copia se
    entregó con CERO sugerencias y el abono falló, el worker deja la deuda en `editar.devolucion_pendiente`
    y **sale con 1**: la ejecución muere FAILED y su evento llega al barredor, que (sin poder reclamar,
    porque no está `corriendo`) cobra la deuda (`barredor._cobrar_deuda_editar`). El libro mayor decide si
    falta: si su último movimiento de esa copia ya es una devolución, solo se anota.
- **Lo que el motor NO hace todavía:** fundidos, música, títulos, nivelar el sonido (`loudnorm` está
  prohibido en el master) ni cambiar de vertical a horizontal. Los cortes son directos. Lo que la
  instrucción pida y no se pueda sale como duda «No aplicado:».

### Los dos fallos de `make_proxy.py` y `render_cuts.py` que se arreglaron

Medidos con ffmpeg real y clips sintéticos (`tests/test_e2_ffmpeg_union.py`), contra el código de
antes de E2:

| Caso | `make_proxy.py` | `render_cuts.py` |
|---|---|---|
| un clip SIN pista de audio junto a otro con audio | reventaba (`-map 0:1`, exit 234) | reventaba en `render_audio_segment` (exit 234) |
| 24 fps/44,1 kHz mono + 30 fps/48 kHz estéreo | video 8,77 s y audio 7,67 s; `r_frame_rate` 48 | salía parejo pero VFR (`120/1`) |
| 16:9 junto a 4:3 | partes de alto distinto pegadas con `-c copy` | `non monotonically increasing dts` al decodificar |
| dos verticales (720×1280) | se agrandaban a 1280×2276 | ídem en preview |
| audio 150 ms más corto que su video, 4 clips | — | el audio del master quedaba 0,58 s corto: cada clip acortaba el suyo y la deriva se SUMABA |
| cualquier unión con **ffmpeg 5.1** (la imagen de producción y de la CI, Debian bookworm) | el audio de CADA parte sobrepasaba a su video entre 16 y 101 ms (`-shortest` + `apad`): aire muerto en cada empalme, `r_frame_rate` 60/1 o 30000/1001 y un `manifest.total` 0,1 s por parte más largo que el video | no le pasaba |

Arreglo: `make_proxy.py` normaliza siempre cada parte a 1280×720 (720×1280 si el primer clip es
vertical, con barras si el aspecto no coincide), 30 fps y AAC 48 kHz estéreo (silencio de la duración
del video si no hay pista); `render_cuts.py --mode preview` usa el MISMO filtro, rellena con silencio
un clip sin audio y rellena (`apad`) un audio corto hasta las muestras exactas de su segmento. **El
modo `final` no cambia**: sin filtro de video, mismo encoder (el flujo local de video-stack). La
orientación del primer clip manda; las herramientas no vuelven a juzgar lo que el servidor ya rechazó.

**Dónde se corta el audio de cada parte (ffmpeg 5.1 contra 6.1).** `make_proxy.py` rellena el audio
(`apad`, o `anullsrc` si no hay pista) y lo corta con `-t <duración del video de la parte>` —la del
flujo de video de la fuente, en cuadros enteros a 30 fps (`duracion_de_parte`)—, no con `-shortest`: con
ffmpeg 5.1 `-shortest` deja pasar el relleno. Con 6.1 las dos formas daban lo mismo, y por eso la prueba
solo se puso roja en la CI. Un contenedor que no declara la duración del flujo (Matroska/WebM) conserva
`-shortest`. El manifiesto sale de `ffprobe` de cada parte, no se calcula.

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
   recalculados al unir? (propuesta: campo `clip`). **Sigue abierta**: E2 no copia
   `overlays.json`; una unión parte sin overlays.
2. ~~¿Unir es copia o referencia?~~ **Resuelta en E2: copia** (ver arriba).
3. UI del caso A: ¿desde e1 (selección múltiple) o desde el editor (menú)?
4. Nombre del proyecto unido (`gen-tesla+oso`? el usuario elige?).

## Referencias

`PLAN-FUSION.md` (raíz de D:\adquisition) · `docs/SCHEMA.md` · `tools/make_proxy.py`
· `tools/normalizers/generated_to_canonical.py` · `pipeline/overlays.py` ·
`server/editor.py` · `server/overlays_api.py` · memoria de sesión:
`fusion-video-stack-pipeline`.
