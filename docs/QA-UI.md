# QA manual de las pantallas migradas (UI·8)

Lo corre el dueño antes de pasar una pantalla de `nueva` a `todos`
(`server/migracion.py`). Los tests de vitest cubren el comportamiento; esto
cubre lo que solo se ve con el navegador, la red y el dinero de verdad.

**Gasto:** los pasos marcados 💳 cobran créditos reales. Se corren solo con
el «sí» del dueño.

## clip · `/estudio/clip/`

Ábrelo tecleando la URL (en `nueva` nadie más llega). En el teléfono (390 px)
y en el escritorio.

| # | Paso | Qué tiene que pasar |
|---|---|---|
| 1 | Entrar desde el inicio: «Un video corto», escribir algo, seguir. En `nueva` llega a `/clip.html`; cambia la URL a `/estudio/clip/?brief=hola` | El texto aparece en «Qué quieres ver» y la URL queda sin `?brief` |
| 2 | Subir una foto `.heic` del iPhone | Miniatura, sin error. «Generar ✦ 30» |
| 3 | Subir una segunda foto | «Generar ✦ 32» y la nota «30 créditos + 2 por juntar tus 2 fotos en una» (`tarifas.json` §clip: `video_8s` 30 + `componer_imagenes` 2) |
| 4 | 💳 Doble clic rápido en Generar | **Un** cobro en la píldora; un solo clip en «Tus clips» |
| 5 | Mientras se genera, cambiar de pestaña 1 min y volver | La lista se actualiza al volver; la pestaña decía «Generando tu clip · …» |
| 6 | Recargar la página a mitad | El clip sigue en «Generando…» y termina solo |
| 7 | Al terminar | El video se reproduce; la píldora muestra el saldo nuevo |
| 8 | 402: con saldo menor que el precio (usuario de prueba) | El botón se apaga y dice «Te faltan ✦ N · Recargar» |
| 9 | 409: lanzar tres clips seguidos y un cuarto | «Ya tienes 3 clips generándose — espera a que terminen.» junto al botón |
| 10 | Modo avión y recargar | «No pudimos traer tus clips…» con Reintentar; sin «Cargando…» colgado |
| 11 | «Usar la versión anterior» | Llega a `/clip.html`; en `todos`, `/clip.html` ya no redirige para ti durante 7 días |
