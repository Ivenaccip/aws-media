# Estética y receta de prompts para b-roll generado

Base: la skill *promptimagen* del usuario, adaptada al pipeline. Esta es la estética
**default** (`"aesthetic": "iphone-real"` en el plan); si el video pide otra (época,
documental, etc.), el usuario la declara y esa manda — la ESTRUCTURA del prompt no cambia.

## Estética central: "Foto de iPhone, no de cine"

Las imágenes deben parecer **fotos reales sacadas con un celular**, no renders
cinematográficos ni stock photos:

- Sin encuadres perfectos ni regla de tercios forzada
- Grano natural de sensor de celular
- Ligeramente inclinada o fuera de centro, como si se sacó de prisa
- Sin filtros, sin edición visible
- Sin UI ni UX de cámara (sin marcos de iPhone, sin textos de Snapchat, sin timestamps)
- Luz real del ambiente: neón, luz de calle, ventana, fluorescente — no iluminación de estudio

## Selección de momentos (cuando viene de un transcript)

Priorizar en este orden:

1. **La apertura** — el primer frame que ancla el video visualmente
2. **El personaje protagonista** — cuando se presenta a alguien o su historia
3. **La acción central** — cuando se describe lo que hace/logró alguien
4. **El contexto de lugar** — cuando el lugar importa para el mensaje

No hacer prompt de cada línea. Solo de los momentos donde una imagen agrega valor
narrativo real — 2-4 por video.

## Construcción del prompt de imagen (en este orden)

1. **La cámara y el gesto de captura** — "foto rápida con iPhone desde la entrada",
   "captura espontánea con celular", "foto tomada de prisa desde la mano"
2. **El lugar con detalles concretos** — no "panadería" sino "panadería de barrio con
   paredes de azulejo blanco, vitrinas empañadas, estantes de madera"
3. **La persona/acción** — descripción física concreta, qué hace, cómo está posicionada
4. **La luz real** — fluorescente, luz de ventana, neón, sol de medio día
5. **El detalle que da realismo** — algo pequeño e imperfecto: harina en el delantal,
   esmaltes sobre la mesa, cables eléctricos al fondo
6. **El "defecto" fotográfico** — "ligeramente inclinada", "sin centrar", "bordes
   levemente desenfocados", "grano natural"

Además, para b-roll de un mismo video: **declarar la consistencia en cada prompt**
(misma época, misma paleta, mismo grano) — los momentos deben sentirse de la misma
"sesión de fotos".

### Lo que NUNCA va en el prompt

- "cinematográfico", "cinematic", "bokeh perfecto", "iluminación dramática"
- "foto de stock", "profesional", "bien compuesta"
- Referencias a UI ("sin texto", "sin filtros") — mejor no mencionarlo y no pedirlo
- Emociones genéricas: no "feliz" sino "sonriendo mientras acomoda el pan"

## El prompt de movimiento (image-to-video)

El clip nace de la imagen aprobada; el prompt de video solo describe **movimiento
sutil y creíble**:

- Cámara: "leve movimiento de mano, como quien graba con el celular", "paneo mínimo
  hacia la derecha", "acercamiento apenas perceptible"
- Sujeto: UNA acción continua y simple ya implícita en la imagen ("sigue acomodando
  los panes", "el vapor sube de la taza", "la gente pasa al fondo")
- NUNCA: acciones nuevas que no están en la imagen, giros de cámara, cortes, zooms
  dramáticos, cámara lenta. El modelo inventa mal lo que no ve.
- Siempre **sin audio** (el clip va debajo de la narración).

## Ejemplos de prompts de imagen bien construidos

### Panadería española
> Foto tomada con iPhone desde la entrada de una panadería tradicional española de
> barrio, ligeramente desenfocada en los bordes, como captura rápida. Paredes de
> azulejo blanco con manchas de harina, vitrinas de vidrio empañadas con pan
> artesanal. Una mujer de unos 50 años con delantal blanco manchado de harina,
> cabello recogido con un clip, de espaldas acomodando panes en una bandeja de
> madera. Luz cálida de la mañana entrando por una ventana pequeña. Grano natural de
> celular, sin editar, nada estilizado.

### Local de uñas
> Foto tomada con iPhone desde la entrada del local, como si alguien acaba de abrir
> la puerta y sacó el cel en ese instante. Local pequeño de uñas de barrio, paredes
> claras con espejos y estantes con esmaltes de colores alineados al fondo. Marco de
> la puerta visible en primer plano levemente desenfocado. Al centro-izquierda una
> chica joven con uniforme claro inclinada haciendo pedicure a una clienta en silla
> especial con reposapiés y toallas dobladas. A la derecha dos o tres chicas en mesas
> pequeñas con lámparas LED haciendo manicure. Papel aluminio visible en dedos de una
> clienta, botellas de esmalte sobre las mesas. Luz blanca de neón mezclada con luz
> natural de la puerta. Foto levemente ladeada, grano de celular, sin editar.

### Negocio de barrio latinoamericano
> Foto rápida con iPhone desde la acera, retrato casual de la fachada de una
> ferretería pequeña latinoamericana con letrero pintado a mano, reja metálica a
> medio abrir. Una persona mayor atendiendo desde adentro. Calle de ciudad
> latinoamericana al fondo con edificios de colores desgastados y cables eléctricos
> visibles. Luz de medio día. Como si alguien caminara y sacara el celular de golpe,
> sin componer la toma.

## Notas de tono

- Los prompts van siempre en **español**
- Descriptivo pero sin sobrecargar: un párrafo denso, no una lista
- Lo concreto sobre lo abstracto: "botella de esmalte rojo sobre la mesa" > "ambiente de trabajo"
- **Si el usuario pide ajustes en GATE 2** (más luz, otro ángulo, otro personaje),
  modificar SOLO esa parte del prompt — no reescribirlo entero
