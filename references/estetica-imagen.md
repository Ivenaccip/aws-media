# estetica-imagen — receta de prompts para el b-roll (/broll-ai)

Referencia que `/broll-ai` lee al inicio. Define **dónde** vale la pena un momento
de b-roll y **cómo** se redacta el prompt. El default del repo es la estética
**"foto de iPhone, no de cine"**; el usuario puede pedir otra estética por video
("escenas de época", "editorial", …) y entonces esa manda — conservando la
estructura del prompt de aquí.

## Criterios de momento (dónde SÍ va b-roll)

Un talking-head no necesita ilustrar cada frase. Un momento califica solo si la
imagen **agrega información o emoción que la cara del presentador no da**:

1. **Apertura** — situar el tema en el primer tercio (una sola vez).
2. **Personaje** — se nombra a alguien/algo concreto que el espectador no conoce.
3. **Acción central** — el verbo del que trata el video ("grabar", "publicar",
   "entrenar") mostrado sucediendo.
4. **Contexto de lugar** — un sitio físico que el guion menciona.

Anti-criterios: conceptos abstractos genéricos ("el éxito", "la mente"), decorar
una frase que ya se entiende, y cualquier momento cuyo texto en pantalla deba ser
legible (eso es un beat de Remotion vía ruta `remotion`, no una foto — los modelos
de imagen escriben texto chueco).

## La estética default: foto de iPhone, no de cine

El b-roll debe sentirse **capturado, no producido** — coherente con un video de
creador hablando a cámara. En la práctica:

- luz natural o de interior real; NADA de golden-hour perpetuo ni rim light
- encuadre a mano alzada, ligera imperfección; nada de drone épico ni dolly
- colores neutros de sensor de teléfono; sin teal-and-orange ni LUT de cine
- personas normales con ropa normal; nada de modelos posando
- fondo con vida real (cables, tazas, desorden leve) — lo pulcro delata IA

## Estructura del prompt de imagen (en este orden)

```
[sujeto + acción concreta] , [entorno específico] , [luz] ,
candid smartphone photo, natural lighting, slight handheld feel,
realistic sensor noise, no text, no watermark
```

Reglas:

- **Una sola idea por imagen.** Si el prompt tiene "y… y…", son dos momentos.
- **Sustantivos concretos**, no categorías: "una mano sosteniendo un teléfono con
  un video vertical reproduciéndose", no "tecnología móvil".
- **`no text` SIEMPRE** — encabezados generados salen chuecos (visto en video-1:
  "Now / Just / Wed / The / San"). Si el momento necesita texto legible, es ruta
  `remotion`.
- **Consistencia entre momentos del mismo video**: repetir en cada prompt la misma
  declaración de época/paleta/grano (p. ej. "same muted color palette, same
  afternoon indoor light").
- El aspecto NO va en el prompt: lo fija el backend con el aspect del video base.

## Prompt de movimiento (SOLO ruta fal — Blotato lo ignora)

Para veo3.1 lite image-to-video: **movimiento sutil de cámara o del sujeto, uno
solo** — el modelo inventa mal la acción compleja.

```
slow push-in, subject continues [la acción de la imagen] naturally,
no camera shake, no scene change, no new elements
```

Prohibido: cortes internos, apariciones de objetos/personas nuevas, giros de
cámara, velocidad ("timelapse", "fast"). Si la imagen es estática por naturaleza
(un diagrama impreso, un paisaje), pedir solo parallax/push-in lento.

## Regla de regeneración (GATE 2)

Cuando el usuario anota una imagen ("más luz", "otro ángulo", "sin la persona"),
**se modifica SOLO la parte del prompt que corresponde a la nota** — nunca se
reescribe entero: reescribirlo cambia lo que ya estaba aprobado de la imagen. En
fal, usar la semilla de la imagen que casi gustó para variar solo lo anotado.
