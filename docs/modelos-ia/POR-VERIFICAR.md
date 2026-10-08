# Modelos del selector: lo que falta por verificar (R4)

Hoy solo dos modelos están en `pipeline/modelos_ia.py`: **Grok Imagine** (crear y
editar) y **Veo 3.1 Lite** (clip). Los otros 18 viven en el catálogo de la web
(`web/src/pantallas/inicio/modelos.ts`) con `activo: false`.

## Cómo se enciende un modelo (una fila de datos, tres archivos y una prueba)

1. **Endpoint de fal exacto** y los parámetros que acepta (relación de aspecto,
   duración, resolución, audio, imágenes de referencia). → fila en `pipeline/modelos_ia.py`.
2. **Costo en dólares**, leído en la página del modelo el día de la prueba. →
   `tools/pricing.json` §generacion.endpoints (con `verified_on`).
3. **Créditos**: costo ÷ 0.75 ÷ piso de venta, hacia arriba (mín. 2 por imagen).
   → `tools/tarifas.json` §modelos.
4. **Prueba pagada pequeña** (con el «sí» del dueño): 4 s para clips, una imagen
   para imágenes. Se mira que el endpoint responde, que el resultado viene como
   se promete (audio, resolución) y que el costo real de fal coincide con el anotado.
5. Solo entonces, `activo: true` en el catálogo de la web.

## Datos por modelo (lectura del 8-oct-2026)

Las lecturas completas (endpoints, parámetros, tablas de precio y lo que no se
encontró) están en [`DATOS-FAL-2026-10-08.md`](DATOS-FAL-2026-10-08.md). Ningún
precio de ahí está confirmado todavía: faltan la decisión del dueño y la prueba
pagada. Esta tabla dice qué le falta a cada modelo para poder encenderse.

| Tarea | Modelo (id) | Endpoint fal | Falta |
|---|---|---|---|
| imagen | FLUX.2 klein (`klein`) | `fal-ai/flux-2/klein/4b` o `/9b` | elegir 4B o 9B; traducción a `image_size` |
| imagen | Z-Image Turbo (`zit`) | `fal-ai/z-image/turbo` | traducción a `image_size` |
| imagen | FLUX.2 pro (`flux2`) | `fal-ai/flux-2-pro` | traducción a `image_size` |
| imagen | Seedream 5.0 Flash (`sdf`) | `bytedance/seedream/v5/flash/text-to-image` | traducción a `image_size` |
| imagen | Nano Banana 2 Lite (`nbl`) | `google/nano-banana-2-lite` | cobra por tokens: **sin precio confirmado** hasta medirlo en la prueba |
| imagen | Seedream 4.5 (`sd45`) | `fal-ai/bytedance/seedream/v4.5/text-to-image` | traducción a `image_size` |
| imagen | GPT Image 2 (`gpt2`) | `openai/gpt-image-2` y `openai/gpt-image-2/edit` | elegir calidad y tamaño fijos; si ofrece editar (el tamaño `auto` no tiene precio predecible) |
| imagen | GPT Image 2.5 (`gpt25`) | `openai/gpt-image-2.5/flare/text-to-image` o `.../sunburst/text-to-image` | elegir Flare o Sunburst y la calidad |
| imagen | FLUX 3 (`flux3`) | `blackforestlabs/flux-3/text-to-image` | sin `num_images`: probar que fal lo ignora |
| imagen | Nano Banana 2 (`nb2`) | `fal-ai/nano-banana-2` y `/edit` | solo la prueba pagada |
| imagen | Nano Banana Pro (`nbp`) | `fal-ai/nano-banana-pro` y `/edit` | parámetro de calidad (`resolution`) en servidor; precio de 2K y 4K |
| clip | MiniMax H3 Max Turbo (`h3t`) | `minimax/h3-max-turbo/text-to-video` y `/image-to-video` | audio no documentado; adaptador |
| clip | Grok Imagine Video (`grokv`) | `xai/grok-imagine-video/text-to-video` y `/image-to-video` (o `v1.5/…`) | elegir versión base o 1.5; adaptador |
| clip | LTX-2.5 Fast (`ltx`) | `lightricks/ltx-2.5/text-to-video/fast` y `/image-to-video/fast` | adaptador; la prueba es de 6 s (mínimo del modelo) |
| clip | Veo 3.1 Fast (`veo-fast`) | `fal-ai/veo3.1/fast` y `/fast/image-to-video` | tabla de precios propia; mismos argumentos que Lite |
| clip | Kling V3 Pro (`kling`) | `fal-ai/kling-video/v3/pro/text-to-video` y `/image-to-video` | adaptador (`start_image_url`, sin resolución) |
| clip | Seedance 2.0 (`seed`) | `bytedance/seedance-2.0/text-to-video` y `/image-to-video` | adaptador; $0.3034 contra $0.3024 por segundo (el clip sale en 216 créditos con las dos) |
| clip | Veo 3.1 Standard (`veo-std`) | `fal-ai/veo3.1` y `/image-to-video` | tabla de precios propia; mismos argumentos que Lite |

Para los clips, la lectura del 8-oct ya respondió lo básico: los siete tienen
endpoint de texto a video y de imagen a video, y los siete admiten 8 s. El audio es
opcional (`generate_audio`) en LTX, Veo, Kling y Seedance, viene sin parámetro en Grok
Video y no está documentado en MiniMax.

Un modelo de otra familia que Veo recibe argumentos distintos: `pipeline/clip.py`
(`animar`) hoy arma los de la familia Veo; el primer modelo de otra familia trae
su adaptador de argumentos junto con su fila.
