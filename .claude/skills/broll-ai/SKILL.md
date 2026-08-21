---
name: broll-ai
description: Paso de b-roll de la rama longform — del transcript al video con clips insertados. Arranca con el MENÚ de herramientas del usuario (Remotion = gráficos y marca · fal.ai = videos con IA · Blotato = imágenes con IA, cada una marcada "activo" o "conectar" con su paso a paso), y según lo elegido propone momentos en dos familias (gráficos y marca / contenido audiovisual) con ruta por momento. Úsala cuando el usuario quiera "b-roll con IA", "agregar videos hechos con IA", "insertar clips generados", "broll-ai", "ilustrar momentos del video", o pida generar imágenes/videos para intercalar en un video-N de este repo. Cubre el menú de herramientas, proponer momentos desde edited-transcript.json, los prompts receta (estética iPhone-real por default), el DOBLE gate de aprobación (momentos+rutas+costo antes de generar; imágenes antes de animar), la generación por ruta, el broll-plan.json y la inserción verificada con tools/insert_broll.py. No es la skill de beats visuales sobre el timeline oficial (eso es /make-tsx directo) ni la de shorts.
---

# broll-ai — del transcript al video con b-roll insertado

Toma un video ya cortado (master o preview de `/clean-cut`) y le inserta clips de
b-roll en los momentos donde una imagen suma valor narrativo.

**Base de verdad de rutas y precios: `docs/BROLL-RUTAS.md`** (hallazgos verificados
por API, 2026-08-10). El resumen que manda:

| Ruta | Qué da | Movimiento | Costo típico (9 s) | Cuándo |
|---|---|---|---|---|
| **blotato** | imagen gpt-image-1 ($0.15 c/u) | Ken Burns (zoom, gratis) | ~$0.30 | foto está bien con zoom; ya paga Blotato |
| **remotion** | beat visual autorado (código, vía `/make-tsx`) | el que se programe | $0 | proceso, dato, UI, comparación, overlay |
| **fal** | imagen nanobanana (~$0.08) + veo3.1 lite i2v ($0.03/s) | **movimiento real** | ~$0.43 | lugar/persona/objeto que debe moverse |

**Blotato NO tiene image-to-video por API/MCP** (veo/kling/runway solo existen en su
web, a mano). Su `animateAiImages` es un Ken Burns determinista: 3.000 s fijos, cero
créditos, pista de audio en silencio (descartar con `-an`) y el `video_prompt` no lo
lee nadie. Prometer veo3.1 vía Blotato es un bug de esta skill que ya nos costó una
sesión.

Mismo patrón que el resto del pipeline: **plan declarativo** (`broll-plan.json`) →
**tool** (`tools/insert_broll.py`) → **gates duros de usuario** — DOS, porque
generar cuesta dinero:

```
MENÚ de herramientas (activo / conectar → modo)
          → transcript → momentos propuestos por FAMILIA (gráficos y marca / audiovisual)
          → GATE 1 (momentos + rutas + prompts + costo)
          → imágenes / shots TSX → GATE 2 (aprobar cada imagen o render)
          → movimiento según ruta → inserción → verificación
```

**Nada se genera sin pasar su gate.** Una generación lanzada sin aprobación explícita
es un bug, igual que una corrida de nube sin preview de costo.

## Insumos (leer siempre, al inicio)

- **`videos/video-N/work/edited-transcript.json`** — tiempos por palabra en **ms
  sobre el timeline MASTER**. Toda ventana de inserción se ancla a palabras reales
  de aquí (grep de la frase → start/end ms). Nunca estimar tiempos de oído.
- **El video base** — el master o preview elegido por el usuario (`output/…`).
  Probar con ffprobe: **su resolución y aspecto son el destino de los clips** (nada
  de asumir 16:9; un proyecto vertical genera vertical — se decide ANTES de generar,
  nunca reencuadrar después: lección de video-2).
- **Disponibilidad de herramientas, verificada EN VIVO** — es lo primero que ve el
  usuario (Etapa 0). Ofrecer una ruta imposible fue el error de la sesión que
  originó BROLL-RUTAS.md.
- **`references/estetica-imagen.md`** — la receta de prompts (estética "foto de
  iPhone, no de cine"). Es el default; el usuario puede pedir otra estética para el
  video y entonces esa manda, conservando la estructura del prompt.
- **`media/projects/<video-N>/broll/`** — assets generados de ESTE video y su
  `catalog.json` (procedencia obligatoria: modelo, backend, prompt, fecha).
- **Precios SOLO de `tools/pricing.json` §broll** (con fuentes). Nada de memoria.

## Etapa 0 — Menú de herramientas (el modo)

Lo primero que ve el usuario. Las herramientas viven en dos **familias**, y el
registro es extensible: agregar una herramienta nueva (p. ej. Higgsfield) = agregar
una fila aquí y en `pricing.json`, nada más.

| Herramienta | Familia | Etiqueta en el menú | "Activo" si… | Si está en "(conectar)" |
|---|---|---|---|---|
| **Remotion** | gráficos y marca | gráficos y animaciones con tu marca · $0 | `remotion-longform/node_modules/` existe | guion en `references/conectar.md` (npm install, 1-3 min, sin cuenta) |
| **fal.ai** | contenido audiovisual | videos con IA (clips cortos) · precio de `pricing.json` por clip | `FAL_KEY` existe en `.env` (verificar que la variable existe — JAMÁS imprimirla ni pedirla en el chat) | guion en `references/conectar.md` (key en fal.ai/dashboard/keys → `.env` → "listo") |
| **Blotato** | contenido audiovisual | imágenes con IA (foto + zoom) · **saldo en vivo**: "N créditos ≈ M imágenes" (25 créditos por imagen, `pricing.json`) | `blotato_get_credits` **responde** (un MCP configurado que no responde = no conectado) | guion en `references/conectar.md` (MCP `mcp.blotato.com` + OAuth; plan de pago; requiere reiniciar Claude Code — retoma con `/broll-ai`) |

**Los guiones completos de "(conectar)" — qué decir, paso a paso, con los comandos
en bloque Run — viven en `references/conectar.md`. Úsalos textuales.**

**Cómo se presenta** (selector de opciones, selección múltiple):

- Cada herramienta como `Nombre (activo) — etiqueta` o `Nombre (conectar) — etiqueta`.
- **Si hay ≥ 2 activas**, la primera opción es **"Recomiéndame por momento"
  (recomendado)** = todas las activas.
- **Si hay 1 activa**, no existe "recomiéndame": la opción es "Continuar con
  Nombre (activo)" + las de conectar.
- Marcar una **(conectar)** → su paso a paso (solo el de esa herramienta, no
  `/instalar` completo) → al confirmar, re-verificar y **volver a mostrar el menú**
  con el estado nuevo.
- Marcar **≥ 2 herramientas** (o "recomiéndame") → Etapa 1 con las familias que
  tengan al menos una herramienta elegida. Marcar **1** → Etapa 1 con una sola tabla.
- La elección se guarda en `broll-plan.json` (`mode`, `tools`) para no volver a
  preguntar al retomar la sesión.

Es una **preferencia, no un candado**: en el GATE 1 la ruta sigue siendo por
momento y el usuario puede cambiarla a mano.

## Etapa 1 — Proponer momentos, por familia

Leer el transcript completo. Criterios de `references/estetica-imagen.md`: solo
donde la imagen agrega valor narrativo real. La selección es **consciente de las
herramientas elegidas**: con solo Remotion se buscan los momentos que brillan como
gráfico (datos, procesos, comparaciones); con solo fal/Blotato, los que piden lugar,
persona, objeto o atmósfera; con ambas familias, el abanico completo.

Se proponen **hasta 2-4 momentos por familia elegida** (menos si no hay buenos
momentos — decir por qué), con **numeración continua** entre tablas (gráficos 1-4,
audiovisual 5-8) para que el usuario responda "1, 3 y 6". Reglas:

- **Un momento vive en UNA familia** — la que lo sirve mejor; nunca repetido.
- **Las ventanas no se enciman** ni dentro ni entre tablas: cualquier combinación
  aprobada debe convivir en el timeline.
- **★ marca la recomendación real** de Claude (un conjunto total coherente, ~1
  cutaway cada 20-30 s en longform). Proponer más es para que el usuario elija;
  recomendar más es hacer reel.
- El encabezado de la familia audiovisual lista **solo las herramientas conectadas**
  ("Contenido audiovisual — fal.ai (video con IA)"; "— Blotato (imagen + zoom)"; o
  ambas). Dentro de esa tabla la ruta sigue siendo por momento, con su porqué y su
  costo (movimiento necesario → fal; con zoom basta → Blotato). Si solo hay una,
  la columna de ruta colapsa.

Por momento: la **cita textual**, la **ventana** `start_ms–end_ms` anclada a
palabras (3-6 s típico), la **ruta con una línea de por qué** (en la familia
audiovisual), y el prompt que corresponda (imagen para blotato/fal + movimiento para
fal; descripción del beat para remotion). Guía de asignación:

| El momento es… | Familia / ruta | Por qué |
|---|---|---|
| Proceso, dato, comparación, UI, arquitectura | **gráficos — remotion** | texto perfecto, marca propia, $0 |
| Overlay parcial (lower-third, badge) en vez de cutaway | **gráficos — remotion** | única con alpha (ProRes 4444 — verificar el primer uso) |
| Lugar, objeto, textura, persona, ambiente que debe moverse | **audiovisual — fal** | solo video con IA lo resuelve |
| Foto donde un zoom basta | **audiovisual — blotato** | imagen buena, movimiento pobre |
| Presupuesto cero | **gráficos — remotion** | la única gratis de verdad |

Formato de salida (ejemplo con ambas familias):

> **Gráficos y marca — Remotion ($0)**
> | # | Momento | Ventana | Idea |
> | ★1 | "27 años aguantando a los mejores cerebros" | 00:31–00:35 | contador 1999 → 2026 |
> | 2 | … | … | … |
>
> **Contenido audiovisual — fal.ai (video con IA) · Blotato (imagen + zoom)**
> | # | Momento | Ventana | Ruta | Por qué | Costo |
> | ★3 | "el terreno que nació la física cuántica" | 00:05–00:09 | fal | lugar, pide movimiento | ~$0.22 |
> | 4 | "se va a OpenAI" | 01:56–02:00 | Blotato | un zoom basta | 25 créditos (saldo 120) |
>
> ★ = mi recomendación (N en total, uno cada ~30 s). Dime cuáles quieres.

## Etapa 2 — GATE 1: momentos + rutas + prompts + costo

Con los momentos que el usuario eligió de la Etapa 1, presentar UNA tabla: momento,
cita, ventana, duración, **ruta (editable)**, prompt, costo estimado por momento y
total. El usuario aprueba la tabla completa, cambia la ruta de un momento, recorta o
ajusta — **cero turnos extra por ruta**. Si lo aprobado queda más denso que ~1
cutaway cada 20 s, decirlo en una línea (es su decisión; el costo narrativo es el
dato que le falta).

Costos: blotato → consultar `blotato_get_credits` y presentar "N imágenes × 25
créditos contra tu saldo de X" (tras la primera corrida real, reportar consumo y
extrapolar); fal → precios de `pricing.json` §broll con fuente; remotion → $0.
Si ninguna ruta con costo está disponible y el momento pide foto, decir qué conectar
y parar. **Sin el "sí" explícito no se genera nada.**

## Etapa 3 — Imágenes / shots por ruta

Solo los momentos aprobados, con consistencia visual entre ellos (misma época,
paleta y grano — decláralo en cada prompt).

- **blotato**: plantilla `image-slideshow` con `aiImageModel: "openai/gpt-image-1"`,
  `aspectRatio` del base, un slide, `textOverlay: ""`. Salida por `imageUrls` de
  `blotato_get_visual_status`.
- **fal**: nanobanana (o el modelo de imagen que el usuario preferira) al aspecto
  del base. Las semillas permiten variantes de una imagen que casi gustó.
- **remotion**: autorar el shot TSX con las reglas de `/make-tsx` +
  `vidtsx-2d-generator` (`compositionConfig` con width/height/fps del base — nada es
  global), `npm run render <Id>` → `out/<id>.mp4`. Para UN beat suelto este atajo
  por broll-plan es válido; si el video pide VARIOS beats visuales, mejor el camino
  oficial completo de `/make-tsx` (timeline.json + bake) y no esta skill.

Guardar imagen/render en `media/projects/<video-N>/broll/<id>.(jpg|mp4)` y registrar
en `catalog.json`. **Mostrar cada resultado al usuario** (viéndolo tú primero: texto
ilegible, anatomía rota o estilo que contradice el prompt → regenerar antes de
mostrar).

## Etapa 4 — GATE 2: aprobar cada imagen/render

El usuario aprueba pieza por pieza, o pide otra opción con notas ("más luz", "otro
ángulo", "sin la persona"). Al regenerar, **modificar solo la parte del prompt que
corresponde a la nota** — no reescribirlo entero (regla de la referencia). El
movimiento es la parte cara (en fal) o la definitiva (en blotato/remotion): ninguna
pieza avanza sin aprobación.

## Etapa 5 — Movimiento según ruta

- **fal** (la única con generación i2v real): veo3.1 lite image-to-video, **720p SIN
  audio** ($0.03/s — 1080p es tirar píxeles si el base es menor), sobre **LA imagen
  aprobada** (URL), duración ≥ la ventana (si el modelo trabaja en bloques fijos,
  sobra: `insert_broll.py` recorta a la ventana — no retimar). Verificar el aspecto
  del primer clip antes de lanzar el resto. La generación tarda minutos: lanzar
  todas, poll con pausas (60-90 s) en segundo plano, avisar avance.
- **blotato**: plantilla `ai-story-video` con `animateAiImages: true`,
  `enableVoiceover: false`, `trimToVoiceover: false`, `transition: "none"`, y la
  imagen aprobada como `scenes[0].mediaSource` (acepta subidas:
  `blotato_create_presigned_upload_url` → `curl -X PUT` → `publicUrl`). Sale un Ken
  Burns de 3.000 s exactos con audio en silencio → descartar audio con `-an`. Si la
  ventana pide más de 3 s, decírselo al usuario ANTES (opciones: acortar ventana,
  cambiar a fal, aceptar retimado con `setpts` — última opción, se nota).
- **remotion**: el render de la Etapa 3 ya ES el clip final.

Guardar en `media/projects/<video-N>/broll/<id>.mp4` + catálogo.

## Etapa 6 — Inserción

Autorar `videos/video-N/work/broll/broll-plan.json` (esquema abajo), presentar la
hoja de auditoría y luego insertar:

```bash
python tools/insert_broll.py videos/video-N/work/broll/broll-plan.json --print   # auditoría
python tools/insert_broll.py videos/video-N/work/broll/broll-plan.json           # inserta
```

La tool cubre el cuadro completo (scale+crop a la resolución del base — no
distingue el origen del mp4: veo, Ken Burns o Remotion entran igual), **copia el
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
  "mode": "recommend",                                 // recommend | single | custom (lo elegido en el menú)
  "tools": ["remotion", "fal"],                        // herramientas elegidas (activas) — no volver a preguntar
  "moments": [
    {
      "id": "m1",
      "quote": "en 1999 no había nada de esto",        // cita textual del transcript
      "start_ms": 12300, "end_ms": 16800,              // mismo reloj que edited-transcript.json
      "route": "fal",                                  // blotato | remotion | fal — POR momento
      "route_why": "lugar físico: pide foto con movimiento real",
      "image_prompt": "…",                             // receta de references/estetica-imagen.md (blotato/fal)
      "video_prompt": "…",                             // movimiento sutil — SOLO ruta fal (blotato lo ignora)
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

- **Dos gates, sin excepciones.** GATE 1 (con rutas y costo) antes de gastar en
  imágenes; GATE 2 antes del movimiento. El usuario puede matar un momento en
  cualquiera de los dos.
- **El menú (Etapa 0) elige herramientas; la ruta sigue siendo POR MOMENTO** dentro
  de las elegidas y se ajusta en el GATE 1 — nunca un gate aparte. Restringir a una
  sola herramienta es decisión del usuario en el menú, no de Claude.
- **Disponibilidad verificada en vivo antes de ofrecer**: "activo" solo si la
  verificación de la tabla de la Etapa 0 pasa en ese momento. Jamás prometer
  image-to-video de Blotato por API: no existe.
- **Etiquetas del menú sin jerga**: gráficos y animaciones / videos con IA /
  imágenes con IA. Blotato muestra su saldo traducido a imágenes; fal su precio de
  `pricing.json`. Blotato nunca se etiqueta "videos".
- **Ventanas ancladas a palabras** de `edited-transcript.json` (ms), nunca de oído.
- **Resolución/aspecto destino = los del base (ffprobe), fijados antes de generar.**
- **El audio del base no se toca.** `insert_broll.py` lo copia; si alguien pide
  "normalizar de paso", eso es de la matriz de loudness de `docs/QA.md`, no de aquí.
- **Procedencia en el catálogo** por cada asset (ruta/modelo/backend, prompt, fecha).
- **Backend caído ≠ improvisar:** si una ruta falla a mitad, ofrecer cambiar la ruta
  de los momentos restantes (GATE exprés) o parar; no cambiar de modelo en silencio.
- Los renders de prueba van al scratchpad, no al proyecto.
