---
name: broll-ai
description: Paso de b-roll con IA de la rama longform — del transcript al video con clips generados insertados. Úsala cuando el usuario quiera "b-roll con IA", "agregar videos hechos con IA", "insertar clips generados", "broll-ai", "ilustrar momentos del video con imágenes/videos de IA", o pida generar imágenes/videos para intercalar en un video-N de este repo. Cubre proponer momentos desde edited-transcript.json, los prompts receta (estética iPhone-real por default), el DOBLE gate de aprobación (momentos+costo antes de generar; imágenes antes de animar), la generación con Blotato (respaldo: fal.ai), el broll-plan.json y la inserción verificada con tools/insert_broll.py. No es la skill de beats visuales TSX (eso es /make-tsx) ni la de shorts.
---

# broll-ai — del transcript al video con b-roll generado

Toma un video ya cortado (master o preview de `/clean-cut`) y le inserta clips de
b-roll generados con IA en los momentos donde una imagen suma valor narrativo.

Mismo patrón que el resto del pipeline: un **plan declarativo** (`broll-plan.json`)
es la fuente de verdad → una **tool** lo consume (`tools/insert_broll.py`) → y hay
**gates duros de usuario** — aquí son DOS, porque generar cuesta dinero:

```
transcript → momentos propuestos → GATE 1 (momentos + prompts + costo)
          → imágenes → GATE 2 (aprobar/regenerar cada imagen)
          → videos (image-to-video) → inserción → verificación
```

**Nada se genera sin pasar su gate.** Una generación lanzada sin aprobación explícita
es un bug, igual que una corrida de nube sin preview de costo.

## Insumos (leer siempre, al inicio)

- **`videos/video-N/work/edited-transcript.json`** — tiempos por palabra en **ms sobre
  el timeline MASTER**. Toda ventana de inserción se ancla a palabras reales de aquí
  (grep de la frase → start/end ms). Nunca estimar tiempos de oído.
- **El video base** — el master o preview elegido por el usuario (`output/…`). Probar
  su resolución/fps con ffprobe: define la resolución destino de los clips.
- **`references/estetica-imagen.md`** — la receta de prompts (estética "foto de
  iPhone, no de cine"). Es el default; el usuario puede pedir otra estética para el
  video (p.ej. "escenas de época") y entonces esa manda, conservando la estructura
  del prompt.
- **`media/projects/<video-N>/broll/`** — assets generados de ESTE video y su
  `catalog.json` (procedencia obligatoria: modelo, backend, prompt, fecha).

## Etapa 1 — Proponer momentos

Leer el transcript completo y proponer **2-4 momentos** (no más). Criterios de
`references/estetica-imagen.md`: apertura, personaje, acción central, contexto de
lugar — solo donde la imagen agrega valor narrativo real; un talking-head no
necesita ilustrar cada frase.

Por momento: la **cita textual** del transcript, la **ventana** `start_ms–end_ms`
anclada a las palabras (3-6 s típico; las ventanas no se enciman), el **prompt de
imagen** (receta de la referencia) y el **prompt de movimiento** para image-to-video
(movimiento sutil de cámara/sujeto — nada de acción compleja, el modelo la inventa mal).

## Etapa 2 — GATE 1: momentos + prompts + costo

Presentar la tabla completa: momento, cita, ventana en segundos, duración, ambos
prompts. Y el **costo antes de generar**:

- **Blotato** (backend principal): consultar `blotato_get_credits` y decir cuántas
  generaciones va a correr (N imágenes + N videos) contra el saldo. Tras la primera
  corrida real, reportar los créditos consumidos y extrapolar el resto.
- **fal.ai** (respaldo, si su MCP está conectado): precio por modelo según su página
  de pricing — citarlo con fuente, no de memoria.
- Sin precios inventados: la política de `tools/pricing.json` §broll aplica.

El usuario aprueba, recorta o ajusta momentos/prompts. **Sin su "sí" explícito no se
genera nada.** Si no hay ningún backend conectado, parar aquí y decirle qué conectar.

## Etapa 3 — Imágenes

Generar SOLO los momentos aprobados, con consistencia visual entre ellos (misma
época, paleta y grano — decláralo en cada prompt). Guardar en
`media/projects/<video-N>/broll/<id>.jpg` y registrar en `catalog.json`.

**Mostrar cada imagen al usuario** (leerla tú primero: si salió texto ilegible,
anatomía rota o un estilo que contradice el prompt, regenera antes de mostrarla).

## Etapa 4 — GATE 2: aprobar cada imagen

El usuario aprueba imagen por imagen, o pide otra opción con notas ("más luz",
"otro ángulo", "sin la persona"). Al regenerar, **modificar solo la parte del prompt
que corresponde a la nota** — no reescribirlo entero (regla de la referencia).
Iterar hasta que cada momento tenga imagen aprobada. Los videos son la parte cara:
ninguna imagen pasa a video sin aprobación.

## Etapa 5 — Videos (image-to-video)

Por cada imagen aprobada, generar el clip con el modelo image-to-video del backend
(en Blotato: `veo3.1/fast/image-to-video`), **sin audio**, con duración ≥ la ventana
y **ya en el aspecto del destino** (16:9 para longform — se decide ANTES de generar,
nunca reencuadrar después: lección de video-2). Guardar en
`media/projects/<video-N>/broll/<id>.mp4` + catálogo.

La generación tarda minutos: lanzar todas, hacer poll con pausas (60-90 s) en
segundo plano, y avisar al usuario del avance sin bloquear la conversación.

## Etapa 6 — Inserción

Autorar `videos/video-N/work/broll/broll-plan.json` (esquema abajo), presentar la
hoja de auditoría y luego insertar:

```bash
python tools/insert_broll.py videos/video-N/work/broll/broll-plan.json --print   # auditoría
python tools/insert_broll.py videos/video-N/work/broll/broll-plan.json           # inserta
```

La tool cubre el cuadro completo (scale+crop a la resolución del base), **copia el
audio bit a bit** (aquí jamás se toca loudness — regla del repo) y recodifica el
video con la cadena de encoders de `hwenc`.

## Etapa 7 — Verificación

`insert_broll.py` ya verifica solo (v:0 == a:0 == duración del base; falla el gate y
no se usa la salida si hay drift) y escribe un **still del punto medio de cada
inserción** en `work/broll/verify/`. Míralos tú, muéstraselos al usuario, y que él
vea los segmentos insertados en el video. Hecho = stills aprobados + gate de
duración en OK + catálogo actualizado.

## broll-plan.json (la fuente de verdad)

```jsonc
{
  "base": "videos/video-2/output/preview-tight.mp4",   // sobre qué se inserta
  "out":  "videos/video-2/output/tight-broll.mp4",
  "aesthetic": "iphone-real",                          // default; puede ser custom por video
  "backend": "blotato",                                // blotato | fal
  "moments": [
    {
      "id": "m1",
      "quote": "en 1999 no había nada de esto",        // cita textual del transcript
      "start_ms": 12300, "end_ms": 16800,              // mismo reloj que edited-transcript.json
      "image_prompt": "…",                             // receta de references/estetica-imagen.md
      "video_prompt": "…",                             // movimiento sutil para image-to-video
      "image": "media/projects/video-2/broll/m1.jpg",
      "clip":  "media/projects/video-2/broll/m1.mp4",
      "status": "proposed"                             // proposed → approved → image_ok → clip_ready → inserted
    }
  ]
}
```

Rutas relativas a la raíz del repo. `status` registra en qué gate va cada momento —
al retomar una sesión, el plan dice exactamente qué falta.

## Reglas duras

- **Dos gates, sin excepciones.** GATE 1 antes de gastar en imágenes; GATE 2 antes
  de gastar en videos. El usuario puede matar un momento en cualquiera de los dos.
- **Ventanas ancladas a palabras** de `edited-transcript.json` (ms), nunca de oído.
- **Resolución/aspecto destino se fija antes de generar** los videos.
- **El audio del base no se toca.** `insert_broll.py` lo copia; si alguien pide
  "normalizar de paso", eso es de la matriz de loudness de `docs/QA.md`, no de aquí.
- **Procedencia en el catálogo** por cada asset generado (modelo, backend, prompt,
  fecha) — regla de `media/`.
- **Backend caído ≠ improvisar:** si Blotato falla o se queda sin créditos a mitad,
  ofrecer fal.ai (si está) o parar; no cambiar de modelo en silencio.
- Los renders de prueba van al scratchpad, no al proyecto.
