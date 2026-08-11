# Rutas de b-roll — hallazgos verificados

> Handoff de la sesión del **2026-08-10** (video-1). Todo lo de aquí se comprobó
> corriendo el pipeline, no de memoria. Las marcas de tiempo de la API son UTC.
>
> **Motivo:** `/broll-ai` está escrita asumiendo que Blotato genera video con
> `veo3.1/fast/image-to-video`. **Eso es falso por API.** Ese supuesto costó varios
> turnos de usuario y un b-roll que solo hace zoom. Este documento es la base para
> corregir la skill.

## TL;DR

| Ruta | Imagen | Movimiento | Costo (9 s de b-roll) | Automatizable |
|---|---|---|---|---|
| **1. Blotato** | gpt-image-1, $0.15 c/u | Ken Burns (zoom) | **$0.30** | Sí |
| **2. Remotion** | — (es código) | Animación autorada | **$0** | Sí, pero hay que escribir el shot |
| **3. fal** | nanobanana ~$0.08 c/u | veo3.1 lite, $0.03/s | **~$0.43** | Sí |
| (4. Blotato web) | ya generada | veo3.1/fast, 35 cr/s | $1.89 | **No — a mano** |

---

## Ruta 1 — Blotato (API/MCP)

### Lo que SÍ da

- **Imágenes.** Plantilla `/base/v2/image-slideshow/5903b592-1255-43b4-b9ac-f8ed7cbf6a5f/v1`
  con `aiImageModel: "openai/gpt-image-1"`, `aspectRatio: "9:16"`, un solo slide y
  `textOverlay: ""`.
  - **25 créditos = $0.15** por imagen (verificado: saldo 1600 → 1575).
  - Salida **1080×1920** JPG, vía `imageUrls` de `blotato_get_visual_status`.
  - Precio del crédito: **$6 dólares por 1000**.
- **Movimiento Ken Burns.** Plantilla `/base/v2/ai-story-video/5903fe43-514d-40ee-a060-0d6628c5f8fd/v1`
  con `animateAiImages: true`, `enableVoiceover: false`, `trimToVoiceover: false`,
  `transition: "none"`, `aspectRatio: "9:16"`.

### Hallazgo 1 — acepta imágenes SUBIDAS (la etiqueta miente)

La etiqueta dice *"Convert **AI-generated** images into short animated videos"*, pero
**sí acepta imágenes subidas**. Flujo verificado:

1. `blotato_create_presigned_upload_url` con el nombre del archivo → devuelve
   `presignedUrl` + `publicUrl`.
2. `curl -X PUT "<presignedUrl>" -H "Content-Type: image/jpeg" --data-binary "@archivo.jpg"` → HTTP 200.
3. Pasar el `publicUrl` como `scenes[0].mediaSource`.

Verificado 2026-08-11T04:47Z (m1) y 04:52Z (m2).

### Hallazgo 2 — `animateAiImages` NO es un modelo de IA

Sobre imagen subida produce un **Ken Burns determinista**, no generación:

- **0 créditos** por clip (saldo 1550 → 1550 tras DOS clips). Si hubiera invocado
  veo3.1 habría cobrado 35 cr/s; kling 210; veo3 1250.
- Duración **fija de 3.000 s**, 1080×1920, 30 fps, 90 frames.
- Entrega una pista **aac en silencio digital (−91 dB)**; se descarta con `-an`.
- El `video_prompt` **nunca se usa** — nada lo lee.
- Firma del movimiento (diferencia media contra el frame 0, sobre 255):
  - m1: `22.4 → 31.0 → 36.8 → 40.9`
  - m2: `19.0 → 29.7 → 36.7 → 40.7`
  - Crecimiento monótono y casi idéntico entre clips distintos = zoom lineal.

### Lo que NO da, y es lo importante

**Ningún modelo image-to-video es invocable por API ni por MCP.** Existen en la
plataforma con precio publicado, pero solo se alcanzan desde `my.blotato.com`:

| Modelo | Créditos |
|---|---|
| framepack | 55 |
| runway gen3 | 85 |
| luma dream machine · minimax | 170 |
| kling v1.5 · v1.6 | 210 |
| google veo2 | 835 |
| veo3/fast | 400 |
| veo3 | 1250 |
| **veo3.1/fast** · `/image-to-video` · `/first-last-frame-to-video` | **50 c/audio · 35 sin audio, por segundo** |

Fuente: <https://help.blotato.com/features/videos/ai-video-credits>

Evidencia de que no hay endpoint:

- `blotato_list_visual_templates` con búsquedas `veo`, `image-to-video`, `animate`,
  `motion` → **0 resultados**.
- Ninguna plantilla expone selector de modelo de video (solo `aiImageModel`, que es
  de imagen).
- `https://help.blotato.com/llms-full.txt`: los únicos endpoints de video son
  *Create Visual* (plantillas), *Publish Post*, *Scheduled Posts* y *Upload Media*.

### Pendiente sin probar

`animateAiImages` sobre una imagen **generada por la plantilla** (rama `aiPrompt`,
no `uploadedMedia`) podría invocar un modelo real — el "using AI" de la etiqueta
apunta ahí. **No se probó.** Riesgo: si usa veo3, una sola prueba cuesta **1250
créditos ($7.50)**. Concesiones aunque funcione: se pierde la imagen aprobada
(la regenera) y sigue sin haber selector de modelo.

---

## Ruta 2 — Remotion (`remotion-longform/`)

No es b-roll fotográfico: son **beats visuales en código**. Categoría distinta,
misma ranura en el timeline.

### Por qué encaja en el pipeline de b-roll

- **Dimensiones por shot.** [`Root.tsx:17`](../remotion-longform/src/Root.tsx) lee
  `config.width` / `config.height` del `compositionConfig` de cada shot. Los
  ejemplos son 1920×1080, pero un shot puede declarar `{ width: 1080, height: 1920, fps: 30 }`
  y renderiza vertical. **Nada es global.**
- **Salida directa a mp4.** `npm run render <IdDelShot>` → `out/<id>.mp4`,
  h264 crf 18, `scale=2` por default.
- **`insert_broll.py` no distingue el origen.** Solo lee `m["clip"]` y hace
  `scale` + `crop` + `overlay`. Un mp4 de Remotion entra igual que uno de veo.

### Capacidad exclusiva: alpha

[`render-all.mjs:44`](../remotion-longform/scripts/render-all.mjs): un shot con
`transparent: true` se renderiza **ProRes 4444 con alpha** en `.mov`. Como el
filtro de inserción usa `overlay`, que respeta alpha, se abre la puerta a
**overlays parciales** — lower-thirds, badges, etiquetas flotando sobre el
presentador — en vez de cutaways de cuadro completo.

**NO VERIFICADO.** La cadena hace `fps` + `scale` + `crop` antes del `overlay`;
esos filtros preservan alpha en teoría, pero no se probó en este repo. Confirmar
con un render de prueba antes de prometerlo.

### Costo y límites

- **$0.** Solo tiempo de render local.
- Hay que **autorar el shot** (código TSX). Reglas duras en la skill
  `vidtsx-2d-generator`.
- **No sustituye una foto.** Lugares, texturas, personas reales, ambiente → un
  gráfico vectorial se siente frío.
- La vía oficial es `/make-tsx` con `timeline.json` + `tools/bake.py`, que
  distingue cutaway de overlay. Meterlo por `broll-plan.json` es un atajo válido
  para un beat suelto; para varios, mejor por su camino.

---

## Ruta 3 — fal.ai

La única que da **movimiento real y automatizable**.

### Precios

Imagen (la página normaliza a 1 MP; a 1080×1920 ≈ 2 MP va al doble):

| Modelo | Por 1 MP | ≈ a 1080×1920 |
|---|---|---|
| Qwen | $0.02 | ~$0.04 |
| Seedream V4 | $0.03 | ~$0.06 |
| Nanobanana | $0.0398 | ~$0.08 |
| Flux Kontext Pro | $0.04 | ~$0.08 |
| **GPT Image 2** | (sin precio público) | — |

Video:

| Modelo | Precio |
|---|---|
| **veo3.1 lite i2v, 720p SIN audio** | **$0.03/s** |
| veo3.1 lite i2v, 720p con audio | $0.05/s |
| veo3.1 lite i2v, 1080p sin audio | $0.05/s |
| veo3.1 lite i2v, 1080p con audio | $0.08/s |
| kling 2.5 turbo pro | $0.07/s |
| veo 3 | $0.40/s |

Fuentes: <https://fal.ai/pricing> ·
<https://fal.ai/models/fal-ai/veo3.1/lite/image-to-video>

### Ventajas sobre la ruta 1

- **Anima LA imagen aprobada.** Los modelos i2v reciben una URL de imagen. Con
  Blotato era estructuralmente imposible: o Ken Burns sobre tu imagen, o un modelo
  sobre una imagen que él regenera.
- **Control de duración** → sin el retimado `setpts` que hizo falta para estirar
  los 3 s fijos de Blotato.
- **Semillas** → variantes de una imagen que casi gustó, en vez de tirar los dados.
- **GPT Image 2** existe aquí y no en Blotato.

### Notas de resolución

720p vertical = 720×1280. Para un base de 478×850 **sobra** (1.5× el ancho);
`insert_broll.py` recorta el excedente al escalar. Pagar 1080p es tirar píxeles.

### Sin documentar en la página del modelo

- **Duraciones soportadas.** Veo suele trabajar en bloques fijos (4/6/8 s). No
  importa que sobre: [`insert_broll.py:74`](../tools/insert_broll.py) recorta el
  clip a la ventana — de hecho **elimina la necesidad de retimar**.
- **Aspecto.** Solo muestra `auto`. En i2v normalmente hereda el de la imagen de
  entrada. Verificar con el primer clip.

### Requisito

`FAL_KEY` en `.env` (no está; el `.env` actual solo tiene AssemblyAI, ElevenLabs y
Gemini, las tres vacías). **La llave la pega el usuario — jamás se pide en el chat.**

---

## Qué está mal en el repo hoy

1. **`.claude/skills/broll-ai/SKILL.md`** — dice *"en Blotato: `veo3.1/fast/image-to-video`"*
   (etapa 5). Falso por API. Es el origen de todo el rodeo de esta sesión.
2. **`tools/pricing.json` §broll** — `models_note` repite *"video: veo3.1/fast/image-to-video sin audio"*.
3. **`references/estetica-imagen.md` NO EXISTE.** La skill lo declara como la receta
   de prompts y lo manda leer al inicio. Hay que escribirlo o quitar la referencia.
4. La skill dice *"16:9 para longform"* como aspecto destino. En un proyecto
   vertical eso es incorrecto: el aspecto se toma del base con `ffprobe`.

## Cambio de diseño recomendado

**La ruta se elige POR MOMENTO, no por video, y dentro del GATE 1 que ya existe.**

Razón: en este mismo video los dos momentos piden cosas distintas.

- **m2** — *"ponerle subtítulos a este tipo de videos"* → una mano sosteniendo un
  teléfono. Objeto físico. **Foto.**
- **m1** — *"publicarlo en redes sociales de forma automática"* → un proceso.
  **Diagrama.** Y es justo donde gpt-image-1 escribió encabezados chuecos
  (*"Now / Just / Wed / The / San"*), problema que un beat TSX no tiene porque el
  texto lo escribe uno.

Preguntar una sola vez por video obliga a un compromiso equivocado en la mitad de
los momentos. Y preguntarlo como gate aparte **agrega un paso** — justo lo que
sobró en esta sesión.

Propuesta: que la tabla del GATE 1 lleve una columna **ruta**, con un default
propuesto por Claude y justificado en una línea. El usuario aprueba la tabla
completa o cambia la ruta de un momento. Cero turnos extra.

**Además: detectar disponibilidad antes de ofrecer.** `FAL_KEY` en `.env`, MCP de
Blotato conectado. Ofrecer una ruta imposible es exactamente lo que pasó aquí.

## Guía de selección

| El momento es… | Ruta | Por qué |
|---|---|---|
| Lugar, objeto, textura, persona, ambiente | **3 (fal)** | Solo una foto lo resuelve |
| Proceso, dato, comparación, UI, arquitectura | **2 (Remotion)** | Texto perfecto, marca propia, $0 |
| Cualquiera, y no hay `FAL_KEY` | **1 (Blotato)** | Imagen buena, movimiento pobre |
| Necesita overlay parcial, no cutaway | **2 (Remotion)** | Única con alpha |
| Presupuesto cero | **2 (Remotion)** | La única gratis de verdad |

## Otros cambios hechos en esta sesión

Bugs reales encontrados al correr el pipeline, ya corregidos:

- **`tools/cutlib.py:16` y `:28`** — `read_text()` sin `encoding="utf-8"`. En
  Windows usaba cp1252 y **doble-codificaba todos los acentos**. `load_words` es el
  cargador del motor de corte: los acentos rotos habrían llegado hasta los
  subtítulos quemados.
- **`tools/format_transcript.py:33`** — mismo bug.
- **`tools/make_subs.py:130` y `:183`** — margen lateral fijo en 60 px mientras
  tamaño y margen vertical sí escalaban con la resolución. En un 1920 son el 3% del
  ancho; en un 478 son el **25%**. Ahora es el flag `--margin-h`, default 60, sin
  cambio de comportamiento para 16:9.
- **`.claude/skills/empezar/SKILL.md`** — omite la extracción del WAV que
  `transcribe.py` necesita. El primer intento falla con `nada que transcribir`,
  mensaje que no distingue "no hay WAVs" de "ya está todo transcrito". **Pendiente.**
