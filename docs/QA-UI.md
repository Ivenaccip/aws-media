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

## estilos · `/estudio/estilos/`

| # | Paso | Qué tiene que pasar |
|---|---|---|
| 1 | Entrar con la liga vacía y pulsar Analizar | «Pega la liga primero.» y ningún cobro |
| 2 | 💳 Pegar un reel real y hacer doble clic rápido en Analizar | **Un** cobro; una tarjeta «Analizando…» con el orbe |
| 3 | Mientras analiza, modo avión 20 s y volver | «Sin conexión — reintentando…»; al volver la red, sigue sola y termina |
| 4 | Pegar el mismo reel otra vez | 409 junto al botón: «Ese video ya tiene su perfil de estilo…» |
| 5 | Copiar el prompt | «Copiado»; pegarlo en crear imágenes funciona |
| 6 | 402 con un usuario de prueba sin saldo | el botón apagado dice «Te faltan ✦ N · Escríbenos por el canal…» (recarga cerrada) |

## competencia · `/estudio/competencia/`

| # | Paso | Qué tiene que pasar |
|---|---|---|
| 1 | Agregar una cuenta de Instagram y otra de TikTok | aparecen; «Revisar ✦ N» con N = tarifa × 2; nada cobrado |
| 2 | Agregar la misma otra vez | 409 junto al campo |
| 3 | Quitar una | desaparece y el precio baja |
| 4 | 💳 Doble clic en Revisar | **Un** cobro; «Revisando…» con el orbe; la pestaña lo dice |
| 5 | Al terminar, Ver | lectura, publicaciones con «N× lo normal» y sus números; «—» donde no vino un número |
| 6 | Cerrar y volver a Ver | abre al instante (no lo vuelve a pedir) |
| 7 | Una cuenta privada en la revisión | «No se pudo traer @…» con los créditos devueltos |

## subir · `/estudio/subir/`

(antes `/e1.html`). Con un video real de 3-10 minutos, en el teléfono (390 px)
y en el escritorio.

| # | Paso | Qué tiene que pasar |
|---|---|---|
| 1 | Entrar sin `?p=` | Solo «Subir metraje»; Subir es el único botón ámbar |
| 2 | Nombre con espacio («mi video») y Subir | El aviso de letras, números y guiones; no se pide nada |
| 3 | Subir un `.mp4` de más de 100 MB | Barra ámbar y «Subiendo x — N% (a de b MB)» que avanza de verdad |
| 4 | A mitad, intentar cerrar la pestaña | El navegador pregunta antes de salir |
| 5 | A mitad, Cancelar | «Subida cancelada — nada quedó a medias…»; Subir vuelve a servir |
| 6 | Subir hasta el final | «Listo: …», la URL gana `?p=`, el video se reproduce, «Proponer ✦ N» con «Metraje de X min…» |
| 7 | Subir otra vez con el nombre de un proyecto de OTRA cuenta | 409: el campo queda con `nombre-xxxx` y lo dice |
| 8 | «Sacar mis cortes» (o clic en cualquier parte de la tarjeta) | Llega a shorts con el mismo proyecto |
| 9 | 💳 Doble clic en «Proponer ✦ N» | **Un** diálogo; Cancelar no cobra. Otra vez y «Proponer»: **un** cobro (`tarifas.json` §editar: 2 créditos + 2 por cada 5 min sin transcript) |
| 10 | Mientras corre, cambiar de pestaña | La pestaña dice «Revisando tu metraje · …»; el orbe ocupa la caja de la animación |
| 11 | Mientras corre, modo avión 30 s | «Sin conexión — reintentando…»; al volver la red, sigue sola |
| 12 | Al terminar | «Corte propuesto: …», «Editar» abre `/editor/<p>/`; la pestaña dice «✓ Corte propuesto»; la píldora con el saldo nuevo |
| 13 | Abrir `/estudio/subir/?p=<proyecto ya editado>` | Directo a «Editar», sin pedir precio |
| 14 | «Usar la versión anterior» | Llega a `/e1.html`; en `todos`, `/e1.html` ya no redirige para ti durante 7 días |
