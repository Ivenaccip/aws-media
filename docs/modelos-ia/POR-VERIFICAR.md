# Modelos del selector: lo que falta por verificar (R4)

Hoy veinte filas están en `pipeline/modelos_ia.py` (diecisiete modelos). Con número en
`tools/tarifas.json` y `activo: true` en la web: para crear imágenes **Grok Imagine**, **Nano Banana 2**
y, encendidos el 11-oct-2026 en la rama (se ofrecen al desplegarla), **FLUX.2 klein 9B**, **Z-Image Turbo**,
**FLUX.2 pro**, **Seedream 5.0 Flash**, **Seedream 4.5** y **FLUX 3**, y, encendido el 12-oct-2026 en la rama, **Nano Banana Pro**
(dos calidades, `nbp-2k` y `nbp-4k`); para editar, **Grok Imagine** (Nano Banana 2 editaba en la rama hasta el
14-oct-2026: ese día salió de editar, sin número en `tools/tarifas.json`); para el clip, **Veo 3.1 Lite** y **Veo 3.1 Fast** y, encendidos el 13-oct-2026 en la rama (se ofrecen al desplegarla), **MiniMax H3 Max Turbo**, **Grok Imagine Video** y **Grok Imagine Video 1.5 Lite**. Nano Banana 2 y Veo 3.1 Fast (Ola 1) se
encendieron el 9-oct-2026 tras su prueba pagada, y los seis de imagen de la Ola 2 el 11-oct-2026 tras la suya
(18 llamadas y el panel de fal, DATOS §11); Grok y Veo 3.1 Lite ya estaban; Nano Banana Pro (Ola 3) se encendió el 12-oct-2026 tras su prueba de 4 llamadas (DATOS §13). Cinco filas de imagen (Seedream 5.0 Flash,
Seedream 4.5, FLUX 3 y las dos calidades de Nano Banana Pro) se generan en segundo plano: ver «Qué va en segundo plano y por qué». Los tres clips de la Ola 4 con prueba pagada y cobro confirmado en el panel de fal (DATOS §15 y §16) se encendieron el 13-oct-2026 en la rama, con la decisión del dueño: **MiniMax H3 Max Turbo** 16, 22 y 30 créditos a 4, 6 y 8 s, **Grok Imagine Video** 26, 38 y 50 y **Grok Imagine Video 1.5 Lite** 12, 18 y 24; se ofrecen al desplegarla. Cuatro modelos son **inertes**: el servidor los conoce, pero no se ofrecen ni se cobran: **Veo 3.1 Standard** (clip, Ola 1) y tres clips de la **Ola 4** (LTX-2.5 Fast, Kling V3 Pro y Seedance 2.0: fila, adaptador y ficha de costo, sin número ni prueba pagada). Los otros 3
(Nano Banana 2 Lite y GPT Image 2 y 2.5) solo viven en el catálogo de la web
(`web/src/pantallas/inicio/modelos.ts`) con `activo: false`, sin fila en el servidor.

## Cómo se enciende un modelo (una fila de datos, tres archivos y una prueba)

1. **Endpoint de fal exacto** y los parámetros que acepta (relación de aspecto,
   duración, resolución, audio, imágenes de referencia). → fila en `pipeline/modelos_ia.py`.
   Los valores exactos se leen sin gasto del esquema público de fal con
   `python tools/leer_esquema_fal.py [endpoint …]` (solo lectura, sin clave: guarda el JSON
   y un `RESUMEN.txt` en `work/esquemas_fal/`).
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
precio de ahí está confirmado todavía, salvo los de la Ola 1 y los de imagen de la Ola 2 (medidos en
el panel el 11-oct-2026, DATOS §11: FLUX.2 pro, Seedream 5.0 Flash, Seedream 4.5 y FLUX 3 completos;
FLUX.2 klein con 2 de sus 3 filas; Z-Image Turbo sigue solo LEÍDO, con 1 de 3 filas que coincide): al resto
le falta la decisión del dueño y la prueba pagada. Nano Banana 2 (crear y editar), Veo 3.1 Fast (con
y sin imagen, a 4 s con audio) y Veo 3.1 Standard sin imagen se confirmaron en el panel de
fal el 9-oct-2026 (DATOS §9, $3.04 dólares en seis llamadas); la ficha de Standard con
imagen sigue siendo solo la lectura del 8-oct. Esta tabla dice qué le falta a cada modelo
para poder encenderse.

| Tarea | Modelo (id) | Endpoint fal | Falta |
|---|---|---|---|
| imagen | FLUX.2 klein (`klein`) | `fal-ai/flux-2/klein/9b` (elegida el 9-oct; la 4B se descartó) | **encendido el 11-oct-2026 en la rama; se ofrece al desplegarla** (Ola 2, solo crear): presets `square_hd`, `landscape_16_9` y `portrait_16_9` (los tres están en el esquema de fal, confirmado el 11-oct), jpeg explícito y ficha de $0.006 dólares por imagen (medida en el panel el 9-oct y de nuevo el 11-oct). Prueba pagada hecha el 11-oct-2026 (UTC): llegaron las tres formas en jpeg (1024×1024, 1024×576, 576×1024). Panel (DATOS §11): llegaron 2 de 3 filas, $0.006 dólares y $0.003375 dólares, que es 0.5625 de la ficha (parece cobrar por píxel: inferencia, el panel no trae el tamaño). Encendida con **2 créditos** (decisión del dueño, 11-oct-2026). Falta: la tercera fila del panel |
| imagen | Z-Image Turbo (`zit`) | `fal-ai/z-image/turbo` | **encendido el 11-oct-2026 en la rama; se ofrece al desplegarla** (solo crear): mismos presets que klein, jpeg explícito, ficha de $0.005 dólares por megapíxel (LEÍDA el 8-oct). Prueba pagada hecha el 11-oct-2026 (UTC): tres formas en jpeg (1024×1024, 1024×576, 576×1024). Panel (DATOS §11): llegó **1 de 3 filas**, $0.005 dólares, que coincide con la lectura pero no dice a qué tamaño corresponde. Encendida con **2 créditos** (decisión del dueño, 11-oct-2026). Falta: las otras dos filas del panel |
| imagen | FLUX.2 pro (`flux2`) | `fal-ai/flux-2-pro` | **encendido el 11-oct-2026 en la rama; se ofrece al desplegarla** (solo crear): mismos presets, jpeg explícito y **sin `num_images`** (su esquema no lo trae). Ficha de $0.03 dólares: la lectura del 8-oct dejaba abierto que el 1024×1024 (1.05 MP) se cobrara entre $0.03 dólares y $0.045 dólares según cuente el megapíxel. Prueba pagada hecha el 11-oct-2026 (UTC): tres formas en jpeg (1024×1024, 1024×576, 576×1024). Panel: **las tres solicitudes costaron $0.03 dólares**, con el cuadrado de 1.05 MP entre ellas (no se cobró el megapíxel extra). Encendida con **4 créditos** (decisión del dueño, 11-oct-2026; cubrirían hasta $0.045 dólares) |
| imagen | Seedream 5.0 Flash (`sdf`) | `bytedance/seedream/v5/flash/text-to-image` | **encendido el 11-oct-2026 en la rama; se ofrece al desplegarla** (solo crear): **va en segundo plano** (13.4 a 15.0 s), pares explícitos 1920×1920, 2048×1152 y 1152×2048 (su esquema exige entre 1024×1024 y 2048×2048 píxeles; los presets no llegan), jpeg explícito, ficha de $0.027 dólares por imagen. Prueba pagada hecha el 11-oct-2026 (UTC): llegaron exactamente los tamaños pedidos, en jpeg. Panel: las tres solicitudes costaron $0.027 dólares, con tamaños distintos (3.69 MP el cuadrado, 2.36 MP los otros). Encendida con **4 créditos** (decisión del dueño, 11-oct-2026) |
| imagen | Nano Banana 2 Lite (`nbl`) | `google/nano-banana-2-lite` | cobra por tokens: **sin precio confirmado** hasta medirlo en la prueba |
| imagen | Seedream 4.5 (`sd45`) | `fal-ai/bytedance/seedream/v4.5/text-to-image` | **encendido el 11-oct-2026 en la rama; se ofrece al desplegarla** (solo crear): **va en segundo plano** (8.6 a 22.7 s), pares explícitos 2048×2048, 2752×1536 y 1536×2752 (su esquema exige 2560×1440 píxeles como mínimo), **sin `output_format`** (la prueba mira en qué formato llega), ficha de $0.04 dólares por imagen. Prueba pagada hecha el 11-oct-2026 (UTC): llegaron exactamente los tamaños pedidos y **en jpeg aun sin pedirlo** (su formato por defecto). Panel: las tres solicitudes costaron $0.04 dólares (4 créditos admiten hasta $0.045 dólares, la menor holgura de los seis). Encendida con **4 créditos** (decisión del dueño, 11-oct-2026) |
| imagen | GPT Image 2 (`gpt2`) | `openai/gpt-image-2` y `openai/gpt-image-2/edit` | elegir calidad y tamaño fijos; si ofrece editar (el tamaño `auto` no tiene precio predecible) |
| imagen | GPT Image 2.5 (`gpt25`) | `openai/gpt-image-2.5/flare/text-to-image` o `.../sunburst/text-to-image` | elegir Flare o Sunburst y la calidad |
| imagen | FLUX 3 (`flux3`) | `blackforestlabs/flux-3/text-to-image` | **encendido el 11-oct-2026 en la rama; se ofrece al desplegarla** (solo crear): **va en segundo plano** (21.8 a 25.0 s), pide `aspect_ratio` como la caja, **sin `num_images`**, `resolution: "1k"` fija (el único tamaño con precio leído) y jpeg explícito. Ficha de $0.024 dólares a 1K. Queda `version: "latest"` sin fijar. Prueba pagada hecha el 11-oct-2026 (UTC): tres formas en jpeg, pero **~1 MP en 1360×768 y 768×1360** (no 1024×576). Panel: las tres solicitudes costaron $0.024 dólares, con el cuadrado de 1024×1024 y los dos de ~1 MP. Encendida con **4 créditos** (decisión del dueño, 11-oct-2026) |
| imagen | Nano Banana 2 (`nb2`) | `fal-ai/nano-banana-2` y `/edit` | **a la venta desde el 9-oct-2026 para crear**: 8 créditos; **editar dejó de venderse el 14-oct-2026** (sin número en `tools/tarifas.json` §modelos.editar, decisión del dueño al pasar el inicio a `todos`: `docs/OPERACION.md`); **crear sigue dentro de la petición** (crear midió 11.7 s; editar, 11.5 y 13.9 s): excepción a la regla de segundo plano, decisión del dueño del 11-oct-2026, «de momento»; prueba pagada hecha y costo confirmado en el panel (DATOS §9); `resolution` en el `/edit` comprobado (aviso 3 abajo). **Pide `output_format: "jpeg"` desde el 12-oct-2026 en la rama; se aplica al desplegarla** (su esquema trae «png» por defecto y la caja guarda lo que baja como .jpg: DATOS §12; hasta desplegarla sigue entregando PNG con extensión .jpg: confirmado el 12-oct con los tres archivos de su prueba pagada, PNG de 1.6 a 1.8 MB). Sin probar: editar con dos imágenes (modo «pincel») |
| imagen | Nano Banana Pro (`nbp`) | `fal-ai/nano-banana-pro` y `/edit` | **encendido el 12-oct-2026 en la rama; se ofrece al desplegarla** (Ola 3, solo crear): dos filas, `nbp-2k` y `nbp-4k` (el catálogo de la web las llama «hasta 2K» y «4K»), que fijan `resolution`, piden jpeg y `enable_web_search: false`, y van a **segundo plano** (medidos 24.9 a 28.1 s en 2K y 37.4 a 43.5 s en 4K). Prueba pagada hecha el 11-oct-2026 (hora de México): 4 llamadas, todas en jpeg y con el tamaño de su resolución (2K ~4.2 MP, 4K 16.91 MP). Panel (DATOS §13): dos solicitudes de $0.15 dólares y dos de $0.30 dólares, asignadas por la hora (el panel no trae la resolución): 2K $0.15 dólares, 4K $0.30 dólares, como dice la página («el doble»). Ficha por resolución en `pricing.json`. Encendida con **14 créditos el 2K y 28 el 4K** (decisión del dueño, 12-oct-2026). Falta: el 1K (solo leído, no se vende) y **editar** (`/edit`), que no cabe en la petición y necesita su propio camino en segundo plano |
| clip | MiniMax H3 Max Turbo (`h3t`) | `minimax/h3-max-turbo/text-to-video` y `/image-to-video` | **ENCENDIDO el 13-oct-2026 en la rama; se ofrece al desplegarla** (Ola 4): 16, 22 y 30 créditos a 4, 6 y 8 s (decisión del dueño del 12-oct; en `tools/tarifas.json` §modelos.clip y `activo: true` en el catálogo de la web). Fila y adaptador hechos con el esquema real (DATOS §14). Probado el 12-oct-2026 (hora de México) a 4 s, texto a video e imagen a video (DATOS §15): llegó 1344×768 en 4.48 s con **pista de audio aac** (la más audible de las tres: −25 a −30 dB) y la llamada tardó 3.2 y 3.9 s. **Panel de fal: $0.096 dólares por clip, por los segundos PEDIDOS** (4 × $0.024; no por los 4.48 entregados). $0.024 es la tarifa en **promoción (−40 %) hasta el 15-oct-2026**; después son $0.04 por segundo a 768P, y con esa se calcularon los créditos (con la promoción habrían sido 10, 14 y 18); la ficha de `pricing.json` lleva los $0.04. **Pendiente:** 6 y 8 s no se probaron (solo 4 s; el cobro es lineal en los segundos pedidos), y el 16-oct-2026 conviene confirmar en el panel que se cobra $0.04 |
| clip | Grok Imagine Video (`grokv`) | `xai/grok-imagine-video/text-to-video` y `/image-to-video` (la 1.5 es `v1.5/…`) | **ENCENDIDO el 13-oct-2026 en la rama; se ofrece al desplegarla** (Ola 4): 26, 38 y 50 créditos a 4, 6 y 8 s (la fórmula sobre el imagen a video da 25.07, 37.51 y 49.96: el mismo par para texto e imagen). Fila y adaptador de la versión **base**. Probado el 12-oct-2026 a 4 s, texto a video e imagen a video (DATOS §15): llegó 1280×720 (con imagen, 1280×704) en 4.04 s con **pista de audio aac, muy bajita** (−47 y −50 dB), y la llamada tardó 45.3 y 41.5 s. **Panel de fal: $0.28 dólares en texto a video y $0.282 en imagen a video** (720p a $0.07 por segundo y $0.002 por la imagen de entrada). La 1.5 ($0.14 dólares por segundo) no tiene fila ni ficha: decisión del dueño. **Pendiente:** 6 y 8 s no se probaron |
| clip | Grok Imagine Video 1.5 Lite (`grokl`) | `xai/grok-imagine-video/v1.5/lite/text-to-video` y `/image-to-video` | **ENCENDIDO el 13-oct-2026 en la rama; se ofrece al desplegarla** (Ola 4): 12, 18 y 24 créditos a 4, 6 y 8 s (el imagen a video da 11.56, 16.89 y 22.22; el texto a video solo necesitaría 12, 16 y 22, pero un número por duración cubre los dos). Fila, familia de argumentos propia (`grok_lite`: su imagen a video NO tiene `aspect_ratio`) y ficha, con el esquema real leído (DATOS §16). Probado el 12-oct-2026 a 4 s, texto a video e imagen a video (DATOS §16): llegó 1280×720 (con imagen, 1280×704) en 4.04 s, la llamada tardó 25.4 y 25.3 s (la base, 45 y 42 s) y las dos traen **pista de audio aac, pero muy bajita** (−45 y −58 dB de volumen medio, contra −25 a −30 dB de MiniMax). 720p a $0.03 dólares por segundo (la base: $0.07) y $0.01 por imagen de entrada, **confirmado en el panel de fal el 12-oct-2026: $0.12 en texto a video y $0.13 en imagen a video**. **Pendiente:** 6 y 8 s no se probaron, y el sonido del imagen a video es casi inaudible (el catálogo no promete audio) |
| clip | LTX-2.5 Fast (`ltx`) | `lightricks/ltx-2.5/text-to-video/fast` y `/image-to-video/fast` | **inerte** (Ola 4): fila y adaptador hechos; solo 6 y 8 s (su mínimo es 6); 720p explícito ($0.09 dólares por segundo, solo LEÍDO; su defecto es 1080p). Falta: prueba pagada de 6 s (≈ $0.54 dólares) y la decisión de los créditos propuestos 48 y 64 |
| clip | Veo 3.1 Fast (`veo-fast`) | `fal-ai/veo3.1/fast` y `/fast/image-to-video` | **a la venta desde el 9-oct-2026**: 54, 80 y 108 créditos (4, 6 y 8 s); los dos endpoints probados a 4 s y costo confirmado en el panel (DATOS §9). Sin medir: el tiempo de los clips de 6 y 8 s |
| clip | Kling V3 Pro (`kling`) | `fal-ai/kling-video/v3/pro/text-to-video` y `/image-to-video` | **inerte** (Ola 4): fila y adaptador hechos (`start_image_url`, duración como texto, sin parámetro de resolución); $0.168 dólares por segundo con audio (solo LEÍDO). Falta: prueba pagada (4 s ≈ $0.672 dólares) y la decisión de los créditos propuestos 60, 90 y 120 |
| clip | Seedance 2.0 (`seed`) | `bytedance/seedance-2.0/text-to-video` y `/image-to-video` | **inerte** (Ola 4): fila y adaptador hechos (duración como texto, 720p explícito); $0.3034 dólares por segundo en texto a video y $0.3024 en imagen a video, solo LEÍDO (el clip de 8 s sale en 216 créditos con las dos). Falta: prueba pagada (4 s ≈ $1.21 dólares por llamada, la más cara) y la decisión de los créditos propuestos 108, 162 y 216 |
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

### Avisos de la Ola 1 (vigentes)

1. **Veo 3.1 Fast y Standard: un solo intento.** Hoy el timeout del clip es de 240 s; la
   prueba pagada imprime cuánto tardó la llamada y marca REVISAR si pasa del 70 % — un
   timeout de cliente puede dejar un trabajo vivo y cobrado en fal, y por eso estos dos
   modelos hacen un solo intento. Fast ya está a la venta y se midió a 4 s (45.7 s y
   28.6 s); Standard, inerte, tardó 38.5 s a 4 s y sin imagen. Los clips de 6 y 8 s no se
   han medido.
2. **La imagen de entrada del clip.** La imagen de entrada del clip a partir de imagen
   debe ser de 720p o más de lado corto y de 16:9 o 9:16 (página del modelo, 8-oct). La
   caja acepta fotos de cualquier forma: lo que fal hace con una foto 4:3 o cuadrada NO
   está comprobado (aplica también a Veo Lite, a Veo 3.1 Fast y, desde el 13-oct-2026, a MiniMax, Grok Video y Grok 1.5 Lite; sus pruebas pagadas fueron solo 16:9); la prueba con `--imagen-sin-validar`
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

### Ola 2 (11-oct-2026): el tamaño por familia y seis modelos de imagen (encendidos en la rama ese día; se ofrecen al desplegarla)

Grok y Nano Banana piden el tamaño con `aspect_ratio` («16:9»); FLUX.2, Z-Image y Seedream (y
GPT Image) piden `image_size` con valores propios. Cada fila de imagen lo declara y
`Modelo.args_de_imagen(prompt, aspecto)` lo traduce; `media_fal.imagen_fal` solo lo usa:

- `llave_tamano`: `"aspect_ratio"` (lo de siempre: Grok manda los mismos argumentos de antes)
  o `"image_size"`.
- `tamanos`: con `image_size`, el valor de CADA aspecto de la caja (1:1, 16:9 y 9:16, los de
  `server/app.py::ASPECTOS_IMAGEN`). Una fila sin los tres no se puede construir; un aspecto
  fuera de esos es `AspectoNoAdmitido` (422), nunca un cambio silencioso a otro. El valor es un
  texto de fal (`square_hd`) o un par (ancho, alto), que sale como `{"width", "height"}`
  (Seedream y GPT Image piden tamaños concretos).
- `con_num_images`: FLUX.2 pro y FLUX 3 no traen `num_images` en su esquema; con `False` no se manda.
- `megapixeles_ficha`: hasta cuántos megapíxeles de salida vale el costo de la ficha (los que cobran
  por megapíxel); solo lo usa la prueba pagada para marcar REVISAR. 0 = precio fijo por imagen.
- `admite_referencia`: un modelo de solo texto a imagen (sin `endpoint_con_imagen`) no recibe
  una imagen de referencia: `imagen_fal` lo rechaza, no se la manda ni cae a otro modelo. Ninguno de
  los seis tiene fila en «editar», así que el editor no puede llamarlos.
- `image_size` es llave protegida: ningún modelo puede fijarla en `args_extra`.

**Los esquemas, leídos el 11-oct-2026** con `tools/leer_esquema_fal.py` (solo lectura, sin clave; DATOS
§10 tiene el detalle) son el contrato: `tests/fixtures/esquemas_fal_ola2.json` los guarda y
`tests/test_r4_ola2.py` comprueba que cada fila solo manda llaves que el endpoint tiene, valores de su
enum y `num_images` solo donde existe. Lo que cambió el diseño: (1) los presets de FLUX.2, Z-Image y
klein existen tal cual; (2) los de Seedream NO alcanzan su mínimo de píxeles (5.0 Flash: entre 1024×1024
y 2048×2048; 4.5: 2560×1440 como mínimo), por eso llevan pares explícitos múltiplos de 16; (3) FLUX.2 pro
no trae `num_images`, y FLUX 3 tampoco (ya no hace falta «probar que fal lo ignora»).

**Encendido (11-oct-2026).** Con el «sí» del dueño, tras la prueba pagada y el panel de fal, los seis entraron
con su propuesta de créditos: FLUX.2 klein 2, Z-Image Turbo 2, FLUX.2 pro 4, Seedream 5.0 Flash 4, Seedream 4.5 4 y
FLUX 3 4. El número está en `tools/tarifas.json` §modelos «imagen» (no en «editar»: ninguno edita) y `activo: true` en
`web/src/pantallas/inicio/modelos.ts`. Encendidos el 11-oct-2026 en la rama; se ofrecen al desplegarla. Antes de eso, mirar las 18 imágenes
(`work/probar_modelo/ola2/`) sigue pendiente: lo medido es tamaño, formato y costo, no calidad. Para apagar uno basta quitar
su número de `tarifas.json`: el servidor lo rechaza con 422 sin cobrar.

**El formato del archivo.** La caja guarda TODA imagen como `.jpg` y la sirve como `image/jpeg`
(`server/app.py`), pero klein y Z-Image devuelven PNG por defecto. Un PNG dentro de un `.jpg` lo
pintan los navegadores, pero las redes lo rechazan al publicar. Por eso los seis piden `output_format:
"jpeg"` explícito (menos Seedream 4.5, que no trae el parámetro), y `tools/probar_modelo.py` marca
REVISAR si lo que llega no es JPEG. **Resuelto en la Ola 3 (12-oct-2026, en la rama):** Nano Banana 2 (ya a la venta) no
fijaba `output_format`; su esquema, leído después, trae «png» por defecto (DATOS §12), así que hasta desplegar el arreglo
sus imágenes se guardan como PNG con extensión `.jpg` (confirmado el 12-oct-2026: los tres archivos de su prueba pagada son PNG de verdad, de 1.6 a 1.8 MB). La fila ya pide jpeg (ver «Ola 3» abajo).

**Tamaños de salida: medidos en la prueba pagada del 11-oct-2026 (UTC).** Se hicieron 18 llamadas, una por
modelo y forma, con `tools/probar_modelo.py imagen <modelo> --formato cuadrado|horizontal|vertical --si`.
Las 18 salieron en jpeg, con el tamaño y el formato prometidos y sin ninguna línea REVISAR:

| Modelo | Cuadrado | Horizontal | Vertical | Segundos por llamada |
|---|---|---|---|---|
| Z-Image Turbo (`zit`) | 1024×1024 | 1024×576 | 576×1024 | 1.0 a 1.8 |
| FLUX.2 klein 9B (`klein`) | 1024×1024 | 1024×576 | 576×1024 | 0.8 a 1.2 |
| FLUX 3 (`flux3`) | 1024×1024 | 1360×768 | 768×1360 | 21.8 a 25.0 |
| Seedream 5.0 Flash (`sdf`) | 1920×1920 | 2048×1152 | 1152×2048 | 13.4 a 15.0 |
| FLUX.2 pro (`flux2`) | 1024×1024 | 1024×576 | 576×1024 | 7.2 a 8.1 |
| Seedream 4.5 (`sd45`) | 2048×2048 | 2752×1536 | 1536×2752 | 8.6 a 22.7 |

Lo que enseña: (1) los apaisados y verticales de los presets de FLUX.2 y Z-Image son de 0.59 MP, no
de 1 MP; (2) FLUX 3 devuelve ~1 MP con el aspecto aproximado (1360×768 es 1.771, no 1.778); (3) Seedream 4.5,
sin `output_format`, llega en jpeg. **Lo cobrado, leído en el panel de fal el 11-oct-2026 (DATOS §11):** Seedream 4.5 $0.04 dólares, FLUX.2 pro $0.03 dólares,
Seedream 5.0 Flash $0.027 dólares y FLUX 3 $0.024 dólares: las tres solicitudes de cada uno costaron lo mismo aunque los tamaños
variaron (el cuadrado de 1.05 MP de FLUX.2 pro no pagó el megapíxel extra). El panel trae el endpoint y el costo, no el tamaño de
cada solicitud. **El dueño pegó 15 filas de 18**: de FLUX.2 klein llegaron $0.006 dólares y $0.003375 dólares (0.5625 de la ficha, lo
que parece un cobro por píxel) y falta 1; de Z-Image Turbo llegó una de $0.005 dólares y faltan 2. No cambian los créditos. La herramienta no mira la calidad de las imágenes: eso lo decide el dueño mirándolas. Cada llamada
imprimió en Windows el aviso de cierre «Event loop is closed» de asyncio (18 de 18), con código de salida 0 y el
resultado ya guardado; es ruido, no un fallo.

### Ola 3 (12-oct-2026): Nano Banana Pro (solo crear, encendido en la rama) y el formato de Nano Banana 2

**Estado del despliegue.** La Ola 2 se fusionó a `dev` el 11-oct-2026 (PR 186) y se desplegó en dev el 12-oct. La prueba con FLUX 3
(la primera imagen en segundo plano en AWS) salió bien: la tarjeta pasó de «Generando…» a la imagen, con el saldo en −4. Antes de esa
prueba el worker de imágenes solo se había ejercido con dobles.

**Nano Banana 2 pide jpeg.** El resumen de esquemas (DATOS §12) mostró que su `output_format` por defecto es «png» y que la caja guarda lo
que baja como `.jpg` sin convertirlo: hasta desplegar el arreglo puede seguir entregando PNG con extensión `.jpg`. La fila ya fija `output_format: "jpeg"` en
crear y en editar (en la rama desde el 12-oct, sin desplegar), y `tests/test_r4_ola3.py` falla si alguna fila de imagen deja que fal decida un formato que no sea jpeg.

**Nano Banana Pro, dos filas, encendido.** El catálogo de la web ofrece dos calidades, y el precio de cada una vive en `tarifas.json` como
`<id>-<calidad>` (`llavePrecio`): `nbp-2k` y `nbp-4k` son dos filas con el mismo endpoint (`fal-ai/nano-banana-pro`) y distinta
`resolution`. El costo se calcula con la ficha `usd_por_resolucion` (`pipeline/pricing.py`): una resolución que la ficha no trae da
«sin costo conocido», nunca el precio de la de al lado. Se encendió el 12-oct-2026, con decisión del dueño, tras la prueba pagada de
cuatro llamadas (DATOS §13): número en `tarifas.json` §modelos «imagen» (`nbp-2k` 14 y `nbp-4k` 28, la fórmula de siempre con $0.15 y
$0.30 dólares) y `activo: true` en el catálogo. Si alguien les quita el número, el servidor vuelve a responder 422 sin cobrar. Van a
segundo plano: ninguna de las cuatro llamadas bajó de 24.9 s.

**Lo que no entra en esta ola.** **Editar con Nano Banana Pro**: el editar sigue dentro de la petición y una calidad alta no cabe en
29 s (4K, de 37 a 44 s); necesita su propio camino en segundo plano (subir la foto por S3, como el clip). El **1K** sigue solo leído
en la página ($0.15 dólares, sin medir) y no se vende. Con Nano Banana Pro son 9 los modelos de imagen en el menú, y con 8 ya
desbordaba en escritorio (`max-h-[400px]`, diseño, sin tocar).

### Ola 4 (12-oct-2026): los clips de otras cuatro familias (filas y adaptadores; MiniMax, Grok Video y Grok Lite encendidos el 13-oct-2026)

**Estado.** Seis clips nuevos con fila (`pipeline/modelos_ia.py`), adaptador (`pipeline/clip_familias.py`) y ficha de costo
(`tools/pricing.json`). **Tres están a la venta desde el 13-oct-2026 en la rama** (se ofrecen al desplegarla), los que tuvieron prueba pagada y cobro
confirmado en el panel de fal (DATOS §15 y §16): MiniMax 16, 22 y 30 créditos, Grok Video 26, 38 y 50 y Grok 1.5 Lite 12, 18 y 24 (a 4, 6 y 8 s), con `activo: true` en la web.
**LTX, Kling y Seedance siguen inertes**: sin número en `tools/tarifas.json` y con `activo: false`, el servidor los conoce y los rechaza con 422
sin cobrar (como a Veo 3.1 Standard). Los esquemas los leyó la otra IA con `tools/leer_esquema_fal.py --ola4`
(DATOS §14; `tests/fixtures/esquemas_fal_ola4.json`).

**El mecanismo.** `clip.animar` armaba los argumentos de Veo y nada más. Ahora cada fila declara su **familia** (`Modelo.familia_clip`:
`veo`, `minimax`, `grok`, `grok_lite`, `ltx`, `kling` o `seedance`) y `clip.args_de_clip` elige el armador: Veo se arma como siempre (una prueba fija los
argumentos de los tres de Veo llave por llave) y las otras cuatro familias están en `pipeline/clip_familias.py`, una función cada una. Lo
que cambia entre ellas: el tipo de la duración (entero en Grok, número en MiniMax, texto en Kling y Seedance, «8s» en Veo), la resolución
(«768P» en mayúscula en MiniMax; Kling no tiene parámetro), el audio (`generate_audio` donde existe), la llave de la imagen de entrada
(`start_image_url` en Kling) y si el endpoint de imagen a video acepta `aspect_ratio` (no en MiniMax ni en Kling: el lienzo sale de la
imagen). **El costo sale de los mismos argumentos que se mandan** (`clip.costo_usd` llama al mismo armador): antes mandaba la resolución de
Veo («720p») a todos y MiniMax habría dado «sin costo conocido». `tools/probar_modelo.py` también compara la resolución que llegó contra
la que la familia pidió, no contra 720 fijo.

**Un solo intento por clip** (`max_intentos=1`) en los cinco, mientras no se mida cuánto tardan: un timeout de cliente no cancela el
trabajo en fal. La prueba pagada imprime cuánto tardó y marca REVISAR si pasa del 70 % de la espera.

**Tipos confirmados (12-oct-2026).** La relectura con el lector marcando tipos (DATOS §14) cerró la duda de la duración: Grok un entero, MiniMax un número, LTX los enteros 6 … 20 más el texto «auto» (se manda entero), Kling y Seedance texto. Es lo que ya mandaban los adaptadores, y `tests/test_r4_ola4.py` ahora exige el tipo exacto contra el esquema guardado.

**Pendientes para encender LTX, Kling y Seedance (todo decisión o dinero del dueño):**

1. **Qué modelos se prueban**, con su costo por delante (cada prueba necesita el «sí» del dueño). **MiniMax, Grok Video y Grok Lite ya se probaron** (12-oct-2026, 6 llamadas, DATOS §15 y §16). Faltan LTX, Kling y Seedance (estimados de la página del 8-oct, a 4 s —LTX, 6 s— y por llamada: LTX $0.54 dólares, Kling $0.672 y Seedance $1.2136 en texto a video o $1.2096 en imagen a video). Texto a video e imagen a video son endpoints distintos y los dos deben probarse (como se hizo con Veo 3.1 Fast).
2. **Grok Video: base, 1.5 o 1.5 Lite (decidido el 13-oct-2026).** El dueño encendió la base **y** la 1.5 Lite: las dos están en el menú (la Lite cuesta 12, 18 y 24 créditos contra 26, 38 y 50 de la base y tarda 25 s contra 45 s;
   el sonido de las dos es casi inaudible). La 1.5 normal ($0.14 dólares por segundo a 720p) sigue sin fila: decisión del dueño. Si más adelante una de las dos sobra, se apaga quitando su número de `tools/tarifas.json` (el servidor la rechaza con 422 sin cobrar) y poniendo `activo: false` en `web/src/pantallas/inicio/modelos.ts` (receta de `docs/OPERACION.md`, «Apagar un modelo»); dejar el número sin el modelo activo hace fallar `modelos.test.ts` por precio huérfano, y el servidor seguiría cobrando un pedido que llegue.
3. **El audio de MiniMax (resuelto el 12-oct-2026).** Ni el esquema ni la página lo decían; la prueba pagada midió una pista aac en sus dos clips y la fila lo promete (`con_audio=True`; no hay parámetro para pedirlo ni apagarlo, y `probar_modelo` marca REVISAR si un clip suyo llega sin pista). Tener pista no es tener sonido bueno: lo juzga el dueño escuchando los clips.
4. **Los créditos** salen de la fórmula de siempre con el costo MEDIDO en el panel de fal (no con la lectura de la página): costo ÷ 0.75 ÷ $0.015 dólares, hacia arriba y al par, sobre el más caro de texto a video e imagen a video (`tests/test_r4_ola4.py` los reproduce con fracciones).
5. **La imagen de entrada.** Las reglas de lado corto y relación de aspecto que `probar_modelo` exige (720 px y 16:9 o 9:16) son las de Veo; las
   de las otras familias no están leídas. En MiniMax y Kling la forma del video la decide la imagen (sus endpoints no tienen `aspect_ratio`).
6. **La duración de MiniMax.** La página dice que el clip puede durar hasta ~0.7 s más de lo pedido: a 4 s midió 4.48 s (+0.48 s, justo dentro de la tolerancia de 0.5 s de `probar_modelo`). A 6 y 8 s un REVISAR «se pidieron 6 s y dura 6.6x s» es de esperar y no es un fallo (el costo se anota por los segundos pedidos; el panel de fal confirmó el 12-oct-2026 que cobra por los PEDIDOS: 4 s × $0.024 = $0.096 aunque el archivo dura 4.48 s).
7. **Tiempos.** Medidos solo en MiniMax (3.2 y 3.9 s a 4 s) y Grok Video (45.3 y 41.5 s a 4 s); los demás no. Si algún clip tarda más que la espera del clip (240 s), un solo intento es lo correcto. Con MiniMax, tan rápido y barato, se podría relajar a los intentos de `settings` tras medir 8 s.

### Audio opcional del clip (13-oct-2026): el interruptor «Audio» del menú de modelos

**Estado.** Construido en la rama (se ofrece al desplegarla). El dueño eligió la propuesta A del lienzo de diseño: el pie del menú
lleva el modelo y su precio a la izquierda y el interruptor «Audio» a la derecha, con el estado escrito («Con sonido» o
«Sin sonido»); en MiniMax y los dos Grok queda bloqueado y una línea dice por qué.

**Qué modelos lo permiten.** Solo los que traen `generate_audio` en el esquema (Veo, LTX, Kling y Seedance; en la Ola 4 se compara con
`tests/fixtures/esquemas_fal_ola4.json`). De esos, a la venta hoy: **Veo 3.1 Lite y Veo 3.1 Fast**. MiniMax (pista audible, −25 a
−30 dB) y Grok y Grok Lite (pista casi inaudible, −45 a −58 dB) no traen el parámetro: el servidor rechaza «sin sonido» con 422.

**Créditos «sin sonido»** (`tools/tarifas.json` §modelos.`clip_sin_audio`): costo sin audio ÷ 0.75 ÷ $0.015 dólares, hacia arriba y al
par, con la tarifa sin audio de `pricing.json` (Veo Lite $0.03 dólares por segundo; Fast $0.10). **Veo Lite 12, 16 y 22 y Veo Fast 36, 54
y 72** a 4, 6 y 8 s. Eran los que se dejaron como recomendación en el lienzo («por la fórmula de siempre») y el dueño no escribió otros;
se pueden cambiar sin tocar código. Con el sonido apagado, **una celda** deja menos del 24 % de margen al juntar 3 imágenes (Veo Lite de
6 s: 23.7 %, porque su número base cae justo en el 25 %): el guardián de `tests/test_r4_ola1.py` fija el piso en 23 %.

**Decisiones tomadas por omisión (recomendaciones del lienzo, revisables).** Valor inicial «con sonido» y recordado por navegador;
interruptor bloqueado con su motivo (no oculto) en los que no se apagan; **sin** «sin sonido» artificial en MiniMax y Grok (quitar la pista
con ffmpeg no baja el costo); texto «Audio» con «Con sonido» o «Sin sonido» al lado. Las filas no se reordenan al apagar: el orden es por
el precio con sonido.

**Sin probar en producción (pendiente).** Ninguna prueba pagada de Veo con `generate_audio: false` desde este flujo: el costo sin audio
sale de las fichas de `pricing.json` (la de Veo Lite sin audio es la que ya paga la película, que lleva el audio apagado; la de Veo Fast es una lectura de la página del 8-oct-2026, sin cobro medido en el panel). Antes de anunciarlo conviene UN clip de Veo Fast
de 4 s sin sonido (≈ $0.40 dólares: es el que no tiene cobro medido) y comprobar en el panel que el cobro es ese y no los $0.60 de con sonido, y con `ffprobe` que el archivo no trae pista de audio. Se pide con
`python tools/probar_modelo.py clip veo-fast --segundos 4 --sin-sonido --si` (la herramienta marca REVISAR si llega pista); el de Veo Lite de 4 s ($0.12 dólares) es opcional.

### Qué va en segundo plano y por qué

`POST /api/imagenes` generaba la imagen DENTRO de la petición, y la Lambda del API corta a los 29 s (API Gateway HTTP
API: tope fijo de 30 s); un arranque en frío ya gasta unos 16 s. Cortada la petición, se cobraba, no se devolvía y fal
cobraba igual. Por eso el modelo que tardó **más de 10 s** en la prueba pagada lleva `segundo_plano=True` en su fila de
`pipeline/modelos_ia.py`: al crear en la nube se cobra, se guarda el pedido en S3 (`usuarios/<user>/imagenes-pedidos/<id>.json`)
y se encola, como el clip; `worker/imagen_generar.py` la genera y la sube a «Mis creaciones» (`imagenes/<user>/<nombre>`) y la
pantalla sondea `GET /api/imagenes/pedidos/<id>`. Los rápidos siguen síncronos, con la respuesta de siempre; en local
todo es síncrono; editar no cambia.

| Modelo | Segundos medidos | ¿Segundo plano? |
|---|---|---|
| Nano Banana 2 (`nb2`) | 11.5 a 13.9 (crear 11.7; editar 11.5 y 13.9, DATOS §9) | no, por ahora: decisión del dueño (11-oct-2026), de momento (`docs/OPERACION.md`) |
| Seedream 5.0 Flash (`sdf`) | 13.4 a 15.0 | sí |
| Seedream 4.5 (`sd45`) | 8.6 a 22.7 | sí |
| FLUX 3 (`flux3`) | 21.8 a 25.0 | sí |
| Nano Banana Pro 2K (`nbp-2k`) | 24.9 a 28.1 (DATOS §13: cuadrado 28.1, vertical 24.9) | sí |
| Nano Banana Pro 4K (`nbp-4k`) | 37.4 a 43.5 (DATOS §13: horizontal 37.4, vertical 43.5) | sí |
| FLUX.2 pro (`flux2`) | 7.2 a 8.1 | no |
| FLUX.2 klein (`klein`) | 0.8 a 1.2 | no |
| Z-Image Turbo (`zit`) | 1.0 a 1.8 | no |
| Grok Imagine (`grok`) | 13 a 29 (PLAN-PRODUCTO.md y `tools/pricing.json`: ocho llamadas reales el 18-sep; mediana 16; el vertical, 28.7) | no, por ahora: decisión del dueño (11-oct-2026), de momento (`docs/OPERACION.md`) |

La regla: **segundo plano si y solo si algún tiempo medido pasó de 10 s** (`tests/test_imagen_segundo_plano.py` fija la
tabla y la regla), con **dos excepciones nombradas: Grok y Nano Banana 2 al crear**. Grok midió 13 a 29 s (el vertical, 28.7 s) y
Nano Banana 2 al crear, 11.7 s, así que la regla los mandaría a segundo plano, pero el dueño decidió el 11-oct-2026 dejarlos como
están «de momento» (Grok es el predeterminado y Nano Banana 2 está a la venta síncrono desde el 9-oct): siguen síncronos hasta
que cambie (`docs/OPERACION.md`, «Decisión del dueño: Grok y Nano Banana 2»). Mover un modelo de un camino al otro es cambiar un booleano. `tools/probar_modelo.py` marca REVISAR cuando
una imagen que va dentro de la petición tarda más de 10 s, y para las de segundo plano solo avisa. **Decisión del dueño
(14-oct-2026):** editar (`/api/imagenes/editar`) no se encola y Nano Banana 2 al editar midió 11.5 y 13.9 s; con un arranque en
frío de ~16 s más el cobro y la subida (~2 s) suma de ~29.5 a ~32 s y supera los 29 s de la Lambda y los 30 s del gateway, así que
salió de editar: sin número en `tools/tarifas.json`. Volver a venderlo pide pasar editar a segundo plano (`docs/OPERACION.md`,
«Imágenes en segundo plano»).

**GPT Image sigue sin fila**, por tres razones: faltan las decisiones del dueño (la calidad y el tamaño
fijos que se ofrecen; la propuesta de la hoja de costos es GPT Image 2.5 Flare en `high`, 6 créditos a
1024×1024), Flare contra Sunburst y si GPT Image 2 ofrece editar (con `image_size: auto` el precio
depende del tamaño de la foto del usuario y no es predecible); y las tablas de precio no traen el vertical
(1080×1920): el de 9:16 no tiene precio leído. El esquema ya dice que `image_urls` admite hasta 16,
`mask_url` es opcional y el tamaño por defecto al editar es `auto` (DATOS §10).

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
