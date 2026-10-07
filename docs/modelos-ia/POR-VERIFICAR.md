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

## Datos que hay que traer por modelo

| Tarea | Modelo (id) | Endpoint fal | USD | Parámetros / notas por confirmar |
|---|---|---|---|---|
| imagen | FLUX.2 klein (`klein`) | — | — | |
| imagen | Z-Image Turbo (`zit`) | — | — | |
| imagen | FLUX.2 pro (`flux2`) | — | — | |
| imagen | Seedream 5.0 Flash (`sdf`) | — | — | |
| imagen | Nano Banana 2 Lite (`nbl`) | — | — | el precio de la hoja era estimado |
| imagen | Seedream 4.5 (`sd45`) | — | — | el precio salió de un listado |
| imagen | GPT Image 2 (`gpt2`) | — | — | ¿tiene `/edit`? |
| imagen | GPT Image 2.5 (`gpt25`) | — | — | |
| imagen | FLUX 3 (`flux3`) | — | — | |
| imagen | Nano Banana 2 (`nb2`) | — | — | ¿tiene `/edit`? |
| imagen | Nano Banana Pro (`nbp`) | — | 2K y 4K | dos precios, uno por resolución; ¿`/edit`? |
| clip | MiniMax H3 Max Turbo (`h3t`) | — | — | ¿8 s? ¿con audio? |
| clip | Grok Imagine Video (`grokv`) | — | — | ¿8 s? ¿con audio? |
| clip | LTX-2.5 Fast (`ltx`) | — | — | |
| clip | Veo 3.1 Fast (`veo-fast`) | — | — | tabla propia, no la de Lite |
| clip | Kling V3 Pro (`kling`) | — | — | |
| clip | Seedance 2.0 (`seed`) | — | — | |
| clip | Veo 3.1 Standard (`veo-std`) | — | — | tabla propia |

Para los clips, además: ¿acepta duración de 8 s (casi todos admiten 4/6/8)?, ¿trae
audio?, ¿tiene endpoint de imagen a video y de texto a video por separado?

Un modelo de otra familia que Veo recibe argumentos distintos: `pipeline/clip.py`
(`animar`) hoy arma los de la familia Veo; el primer modelo de otra familia trae
su adaptador de argumentos junto con su fila.
