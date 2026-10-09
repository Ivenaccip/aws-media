# Modelos del selector: lo que falta por verificar (R4)

Hoy siete filas están en `pipeline/modelos_ia.py`. A la venta: **Grok Imagine** y
**Nano Banana 2** (crear y editar) y **Veo 3.1 Lite** y **Veo 3.1 Fast** (clip); los dos
últimos de la Ola 1 se encendieron el 9-oct-2026, tras su prueba pagada. **Veo 3.1
Standard** (clip) es la única fila **inerte**: el servidor la conoce, pero no se ofrece ni
se cobra. Los otros 15 solo viven en el catálogo de la web
(`web/src/pantallas/inicio/modelos.ts`) con `activo: false`, igual que Standard.

## Cómo se enciende un modelo (una fila de datos, tres archivos y una prueba)

1. **Endpoint de fal exacto** y los parámetros que acepta (relación de aspecto,
   duración, resolución, audio, imágenes de referencia). → fila en `pipeline/modelos_ia.py`.
2. **Costo en dólares**, leído en la página del modelo el día de la prueba. →
   `tools/pricing.json` §generacion.endpoints (con `verified_on`).
3. **Créditos: la COMPUERTA.** Se calculan como costo ÷ 0.75 ÷ piso de venta, hacia
   arriba y al par (mín. 2 por imagen; en los clips, un número por duración, ver
   abajo), pero el número **no se escribe todavía**. Un modelo con fila en
   `pipeline/modelos_ia.py` y ficha en `tools/pricing.json`, pero sin número en
   `tools/tarifas.json` §modelos, no se ofrece y el servidor lo rechaza con 422, sin
   cobrar. El número se escribe junto con `activo: true` (paso 5), después de la
   prueba pagada (paso 4). → `tools/tarifas.json` §modelos.
4. **Prueba pagada pequeña** (con el «sí» del dueño): 4 s para clips, una imagen
   para imágenes. Se mira que el endpoint responde, que el resultado viene como
   se promete (audio, resolución) y que el costo real de fal coincide con el anotado.
   Se corre con `python tools/probar_modelo.py <tarea> <modelo>`:
   - Sin `--si` es un ensayo: enseña el endpoint, los argumentos, el costo esperado en
     dólares y los créditos (si ya hay número); no llama a fal ni pide la clave.
   - Con `--si` hace UNA sola llamada con el adaptador real (exige `FAL_KEY` en el
     entorno o en el `.env`; la clave nunca se imprime) y es lo que gasta.
   - Mide con ffprobe lo que llegó (ancho×alto, segundos, pista de audio) y marca
     «REVISAR» si algo difiere de lo prometido. Opciones: `--segundos N` (clip),
     `--imagen RUTA` (obligatoria al editar; en clip, imagen a video), `--prompt`,
     `--formato` y `--salida`.
   - El costo esperado se compara después con el panel de fal (Request Details → Cost):
     la herramienta no lo sabe, fal no devuelve lo cobrado.
5. Solo entonces, `activo: true` en el catálogo de la web, junto con el número del paso 3.

## Datos por modelo (lectura del 8-oct-2026)

Las lecturas completas (endpoints, parámetros, tablas de precio y lo que no se
encontró) están en [`DATOS-FAL-2026-10-08.md`](DATOS-FAL-2026-10-08.md). Ningún
precio de ahí está confirmado todavía: faltan la decisión del dueño y la prueba
pagada (los de la Ola 1 ya tienen su costo en dólares en `pricing.json`, leído el
8-oct, pero sigue sin confirmarse). Esta tabla dice qué le falta a cada modelo para
poder encenderse.

| Tarea | Modelo (id) | Endpoint fal | Falta |
|---|---|---|---|
| imagen | FLUX.2 klein (`klein`) | `fal-ai/flux-2/klein/9b` (elegida el 9-oct; la 4B se descartó) | traducción a `image_size`. Costo ya medido en el panel el 9-oct: $0.006 dólares por imagen a 1024×1024 (DATOS §8); se escribe en `pricing.json` con su fila |
| imagen | Z-Image Turbo (`zit`) | `fal-ai/z-image/turbo` | traducción a `image_size` |
| imagen | FLUX.2 pro (`flux2`) | `fal-ai/flux-2-pro` | traducción a `image_size` |
| imagen | Seedream 5.0 Flash (`sdf`) | `bytedance/seedream/v5/flash/text-to-image` | traducción a `image_size` |
| imagen | Nano Banana 2 Lite (`nbl`) | `google/nano-banana-2-lite` | cobra por tokens: **sin precio confirmado** hasta medirlo en la prueba |
| imagen | Seedream 4.5 (`sd45`) | `fal-ai/bytedance/seedream/v4.5/text-to-image` | traducción a `image_size` |
| imagen | GPT Image 2 (`gpt2`) | `openai/gpt-image-2` y `openai/gpt-image-2/edit` | elegir calidad y tamaño fijos; si ofrece editar (el tamaño `auto` no tiene precio predecible) |
| imagen | GPT Image 2.5 (`gpt25`) | `openai/gpt-image-2.5/flare/text-to-image` o `.../sunburst/text-to-image` | elegir Flare o Sunburst y la calidad |
| imagen | FLUX 3 (`flux3`) | `blackforestlabs/flux-3/text-to-image` | sin `num_images`: probar que fal lo ignora |
| imagen | Nano Banana 2 (`nb2`) | `fal-ai/nano-banana-2` y `/edit` | **a la venta desde el 9-oct-2026**: 8 créditos, crear y editar; prueba pagada hecha y costo confirmado en el panel (DATOS §9); `resolution` en el `/edit` comprobado (aviso 3 abajo). Sin probar: editar con dos imágenes (modo «pincel») |
| imagen | Nano Banana Pro (`nbp`) | `fal-ai/nano-banana-pro` y `/edit` | parámetro de calidad (`resolution`) en servidor; precio de 2K y 4K |
| clip | MiniMax H3 Max Turbo (`h3t`) | `minimax/h3-max-turbo/text-to-video` y `/image-to-video` | audio no documentado; adaptador |
| clip | Grok Imagine Video (`grokv`) | `xai/grok-imagine-video/text-to-video` y `/image-to-video` (o `v1.5/…`) | elegir versión base o 1.5; adaptador |
| clip | LTX-2.5 Fast (`ltx`) | `lightricks/ltx-2.5/text-to-video/fast` y `/image-to-video/fast` | adaptador; la prueba es de 6 s (mínimo del modelo) |
| clip | Veo 3.1 Fast (`veo-fast`) | `fal-ai/veo3.1/fast` y `/fast/image-to-video` | **a la venta desde el 9-oct-2026**: 54, 80 y 108 créditos (4, 6 y 8 s); los dos endpoints probados a 4 s y costo confirmado en el panel (DATOS §9). Sin medir: el tiempo de los clips de 6 y 8 s |
| clip | Kling V3 Pro (`kling`) | `fal-ai/kling-video/v3/pro/text-to-video` y `/image-to-video` | adaptador (`start_image_url`, sin resolución) |
| clip | Seedance 2.0 (`seed`) | `bytedance/seedance-2.0/text-to-video` y `/image-to-video` | adaptador; $0.3034 contra $0.3024 por segundo (el clip sale en 216 créditos con las dos) |
| clip | Veo 3.1 Standard (`veo-std`) | `fal-ai/veo3.1` y `/image-to-video` | **inerte**: sin número en `tarifas.json`. Texto a video probado a 4 s con costo confirmado en el panel ($1.60 dólares, DATOS §9); falta la prueba con imagen (`fal-ai/veo3.1/image-to-video`, $1.60 dólares esperados) y la decisión del dueño sobre los créditos propuestos 144, 214 y 286 (4, 6 y 8 s) |

**Ola 1 (9-oct-2026).** Nano Banana 2 y Veo 3.1 Fast ya se ofrecen (número en `tarifas.json` y
`activo: true` en la web); Veo 3.1 Standard sigue inerte. Los clips de Fast y Standard se piden a 720p con audio, como
Lite: a 1080p la página cobra lo mismo, pero no está verificado que 1080p admita 4 y
6 s, así que no se manda y su costo no se anota. Nano Banana 2 manda
`resolution: "1K"` explícito (`args_extra` de su fila): 1K es la única resolución con
precio leído ($0.08 dólares por imagen), y no se depende del valor por defecto de fal.
Ese `resolution` es un PIN: si una tarea manda la misma llave, gana la del modelo, porque
el precio solo vale a 1K. Y Veo 3.1 Fast y Standard hacen **un solo intento** por clip
(`max_intentos=1` en su fila; Lite sigue con los de `CLIP_MAX_ATTEMPTS`).

### Avisos antes de la prueba pagada y de encender la Ola 1

1. **Veo 3.1 Fast y Standard: un solo intento.** Antes de encender Veo 3.1 Fast o
   Standard: el timeout del clip es de 240 s; la prueba pagada imprime cuánto tardó la
   llamada y marca REVISAR si pasa del 70 % — un timeout de cliente puede dejar un
   trabajo vivo y cobrado en fal, y por eso estos dos modelos hacen un solo intento.
   Medido el 8-oct a 4 s: Fast 45.7 s y 28.6 s, Standard 38.5 s. Los clips de 6 y 8 s no
   se han medido.
2. **La imagen de entrada del clip.** La imagen de entrada del clip a partir de imagen
   debe ser de 720p o más de lado corto y de 16:9 o 9:16 (página del modelo, 8-oct). La
   caja acepta fotos de cualquier forma: lo que fal hace con una foto 4:3 o cuadrada NO
   está comprobado (aplica también a Veo Lite hoy); la prueba con `--imagen-sin-validar`
   sirve para medirlo.
3. **Nano Banana 2 al editar: `resolution` quedó comprobado (9-oct-2026).** La lectura del
   8-oct NO lista `resolution` entre los parámetros de `fal-ai/nano-banana-2/edit` (solo
   `image_urls` y `aspect_ratio`), y aun así se manda `"1K"` también al editar. La prueba pagada
   lo resolvió: `/edit` lo acepta y con una entrada de 5.02 MP devolvió 1376×768 (1.06 MP), el
   mismo tamaño que con una de 1 MP, y el panel cobró $0.08 dólares. Lo que sigue sin probar es
   editar con dos imágenes (el modo «pincel» manda la original y la marcada).
4. **`tools/probar_modelo.py` y el reenvío.** `tools/probar_modelo.py` hace UN intento por
   nuestro lado, pero `fal_client` puede reenviar el envío si se pierde la respuesta:
   revisa en Request Details que haya una sola solicitud.

Para los clips, la lectura del 8-oct ya respondió lo básico: los siete tienen
endpoint de texto a video y de imagen a video, y los siete admiten 8 s. El audio es
opcional (`generate_audio`) en LTX, Veo, Kling y Seedance, viene sin parámetro en Grok
Video y no está documentado en MiniMax.

Un modelo de otra familia que Veo recibe argumentos distintos: `pipeline/clip.py`
(`animar`) hoy arma los de la familia Veo (Lite, Fast y Standard comparten ese
armado, por eso las dos filas nuevas no traen adaptador); el primer modelo de otra
familia trae su adaptador de argumentos junto con su fila.

## La duración de un clip (contrato del 9-oct-2026)

El navegador manda el id del modelo y los segundos (4, 6 u 8; si falta, 8). El
servidor valida y calcula el precio: nunca confía en uno que venga del navegador.
Para que un modelo de clip nuevo ofrezca duraciones, se declaran en dos lugares y
tienen que coincidir:

1. **`pipeline/modelos_ia.py`**: su fila trae `duraciones=(...)`, los segundos
   enteros que su endpoint acepta de verdad (LTX no admite 4 s: `(6, 8)`).
   `DURACION_PREDETERMINADA_S` (8) es la del producto cuando el pedido no dice nada.
2. **`tools/tarifas.json` §modelos.clip**: su tabla por duración, por ejemplo
   `"ltx": {"6": 48, "8": 64}`. Las llaves son los segundos como texto y los
   valores, créditos enteros, positivos y **pares** (se redondea hacia arriba al
   par, nunca hacia abajo). Los 2 de componer 2 o 3 imágenes son fijos
   (`clip.componer_imagenes`) y no dependen de la duración.

El costo en dólares sale solo de `pricing.json`: `clip.costo_usd` pasa
`duration: "<n>s"` a `costo_fal`, que cobra por segundo. Un modelo sin ficha para
su endpoint (el de texto y el de imagen) da «sin costo conocido», que es un
error, no un cero.

Solo se ofrece la duración que tiene las dos cosas. Declarada sin número, o con
número pero sin declarar, el servidor responde 422 (no se cobra otra duración en
su lugar), y la prueba `test_guardian_las_duraciones_de_la_tarifa_son_las_que_declara_el_modelo`
(`tests/test_r4_duracion.py`) falla hasta que coincidan. Esa misma prueba
guarda que todos los créditos de §modelos sean pares.
