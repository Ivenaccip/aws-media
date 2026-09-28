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

## inicio · `/estudio/inicio/`

(antes `/estudio/`). Con una cuenta que ya tiene cosas y con una nueva, en el
teléfono (390 px) y en el escritorio. Nada de esto cobra.

| # | Paso | Qué tiene que pasar |
|---|---|---|
| 1 | Cuenta nueva | «Tu primer video, en tres caminos»; «Crear un video» pone «Creador de cuentos» y enfoca la caja |
| 2 | Abrir el desplegable con el teclado (Tab, ↓, ↓, Enter) | Cambia la opción; los precios coinciden con `tarifas.json` (clip 30, historias 55–190, imágenes 2) |
| 3 | En el teléfono, abrir el desplegable | No se sale de la pantalla; la página no se desplaza de lado |
| 4 | Escribir algo y «Crear» en cada opción | Llega a la pantalla correcta con el texto ya puesto |
| 5 | Con proyectos: clic en una película, en una imagen y en una edición | Abren `crear`, `imagenes` y `e1` con su proyecto |
| 6 | Archivar una película → Cancelar → Archivar | Nada con Cancelar; con Archivar pasa a «Proyectos archivados» |
| 7 | Restaurar con los slots llenos | El motivo del server en un aviso |
| 8 | Cuenta sin Blotato | Agenda, competencia, métricas y MIX en gris; el clic abre «Conecta tu Blotato» con el aviso del cobro antes del campo |
| 9 | Pegar una clave mala, luego una buena | El error en el diálogo; con la buena, «Tu Blotato está conectado» con las redes y el menú se enciende |
| 10 | Pegar una clave y cerrar con la X o con el fondo | Al volver a abrir, el campo está vacío |
| 11 | Desde el editor, «conectar Blotato» | Llega con el diálogo abierto |
| 12 | Modo avión y recargar | «No pudimos traer tus proyectos» con Reintentar; no aparecen los tres caminos |
| 13 | «Tus trabajos» con un render en curso | El cuadro de siempre, abajo a la derecha |
| 14 | «Usar la versión anterior» | Llega a `/estudio/`; en `todos`, `/estudio/` ya no redirige para ti durante 7 días |

## shorts · `/estudio/shorts/`

Con un video de YouTube de 2-5 minutos, en el teléfono (390 px) y en el
escritorio. Precios de `tarifas.json` §shorts: importar 2 por minuto;
analizar 2, más 2 por cada 5 min sin transcript; renderizar 2 por short.

| # | Paso | Qué tiene que pasar |
|---|---|---|
| 1 | Entrar sin `?p=` | Tus proyectos con metraje como enlaces; subir y la liga de YouTube |
| 2 | Pegar una liga y Cotizar | «título» · duración y «Importar ✦ N» = 2 × minutos |
| 3 | Cambiar una letra de la liga | «Importar» desaparece hasta volver a cotizar |
| 4 | 💳 Doble clic en Importar | **Un** cobro; la URL gana `?p=`; «Trayendo… de YouTube» sin orbe; la pestaña lo dice |
| 5 | Al terminar la descarga | «Analizar ✦ N» con la duración |
| 6 | 💳 Analizar; durante el análisis, modo avión 20 s | El orbe; «Sin conexión — reintentando…»; con red, sigue solo |
| 7 | Con candidatos: poner fin < inicio + 5 en uno marcado | El error junto al campo y «Renderizar» apagado |
| 8 | Ajustar un gancho, desmarcar uno, y 💳 Renderizar con doble clic | **Un** cobro de 2 × marcados; el spinner (no el orbe) |
| 9 | Durante el render, esperar 1 min | Lo marcado y ajustado sigue igual |
| 10 | Al terminar | «3 · Tus shorts» con Ver y Descargar; Descargar baja el archivo (no abre otra pestaña) |
| 11 | Pegar la liga de un video ya importado e Importar | Abre ese proyecto en vez de un error |
| 12 | «Usar la versión anterior» | Llega a `/shorts.html`; en `todos`, `/shorts.html` ya no redirige para ti durante 7 días |

## agenda · `/estudio/agenda/`

No cobra. Hace falta al menos una publicación programada de prueba, con
destino si la red lo pide (una página de Facebook, por ejemplo). Hazlo en el
teléfono (390 px) y en el escritorio.

| # | Paso | Qué tiene que pasar |
|---|---|---|
| 1 | Entrar | «N publicaciones programadas» y una tarjeta por publicación: red · cuenta · destino, la fecha en español y los archivos |
| 2 | Doble clic en «Cambiar la hora» | El diálogo se abre y **no** se cierra con el segundo clic; el foco cae en la fecha |
| 3 | Poner una hora dentro del próximo minuto y Guardar | «Falta menos de un minuto…» junto al campo, sin llamada |
| 4 | Poner mañana a esta hora y Guardar | Se cierra; «Hora cambiada: … (tu hora)»; la tarjeta dice la hora nueva; en Blotato también |
| 5 | «Cancelar» en una tarjeta y pulsar Enter | La confirmación nombra red, cuenta, cuándo y texto; Enter = «No, dejarla» (no cancela) |
| 6 | «Cancelar» → «Sí, cancelarla» | «Publicación cancelada.»; la tarjeta se va; el foco queda en Actualizar; en Blotato ya no está |
| 7 | Con más de 20 programadas: «Ver más» | Se añaden al final; sin más páginas, el botón se va |
| 8 | Desconectar Blotato en el inicio y volver | Aviso con «Conectar Blotato», que lleva al diálogo del inicio |
| 9 | «Usar la versión anterior» | Llega a `/agenda.html`; en `todos`, `/agenda.html` ya no redirige para ti durante 7 días |

## métricas · `/estudio/metricas/`

No cobra. Necesita publicaciones que hayan salido por Blotato. Lo ideal:
una de hace más de 3 horas, una fallida y una de LinkedIn. Hazlo en el
teléfono (390 px) y en el escritorio.

| # | Paso | Qué tiene que pasar |
|---|---|---|
| 1 | Entrar | «De lo más nuevo a lo más viejo. Del … al ….» y las tarjetas; la fallida con borde rojo, «No salió» y el error de la red |
| 2 | En una con números: «Ver el resto» | Despliega todo lo que informó la red y «Cómo fue cambiando»; la tabla rueda sola en el teléfono |
| 3 | «Las más vistas» | Numeradas 1., 2., …; «Ordenadas por vistas…»; sin «Ver más»; no hubo recarga (sin «Buscando…») |
| 4 | En una con «Ver números»: doble clic | «Preguntando…» y **una** consulta; luego sus números o el motivo, anunciados |
| 5 | «Ver más» hasta el final | Primero «Ver más», luego «Ver 30 días más atrás», y al llegar al año, «Métricas llega hasta un año atrás.» |
| 6 | «Ver la publicación» | Abre la red en otra pestaña |
| 7 | La de LinkedIn | Dice que Blotato todavía no recoge números de LinkedIn, sin botón |
| 8 | «Usar la versión anterior» | Llega a `/metricas.html`; en `todos`, `/metricas.html` ya no redirige para ti durante 7 días |

## imágenes · `/estudio/imagenes/`

Cobra `video.imagen` de `tarifas.json` (2 créditos) por cada envío. La
corrida completa son 3 envíos: crear, cambiar una zona y transformar. Hazla
en el teléfono (390 px) y en el escritorio.

| # | Paso | Qué tiene que pasar |
|---|---|---|
| 1 | Entrar | «Crea tu imagen» con la primera palabra girando; estilos con su muestra; formatos; «Generar ✦ 2» |
| 2 | Escribir «/» | La lista de atajos, sin ninguno marcado; flechas para moverse; Escape la cierra |
| 3 | Escribir algo que el moderador rechace y Generar | «Revisa tu texto» con el motivo; **no** se descuenta nada; al cerrar, el cursor en la caja |
| 4 | 💳 Elegir Vertical y un estilo, escribir y hacer doble clic en Generar | **Un** cobro; «Revisando tu texto…» y luego el orbe; la imagen sale vertical y queda abierta para editarla |
| 5 | Sin pintar nada, «Cambiar» | Pide que pintes la zona; no cobra |
| 6 | 💳 Pintar una zona con el dedo o el mouse, escribir y Cambiar | Un cobro; solo cambia lo pintado; «Tu imagen» vuelve a la original |
| 7 | «Quitar imagen» | El resultado sigue ahí, con «Seguir editando» y «Descargar» |
| 8 | 💳 «Seguir editando» → «Transformar toda la imagen» → Acuarela → Transformar | Un cobro; la imagen entera cambia de estilo |
| 9 | Descargar | Baja el archivo (no abre otra pestaña) |
| 10 | Pegar una celda de Excel en la caja | Pega el texto, no una imagen |
| 11 | Desde el inicio, «Mis imágenes» → una imagen | Se abre aquí, lista para editar |
| 12 | «Usar la versión anterior» | Llega a `/imagenes.html`; en `todos`, `/imagenes.html` ya no redirige para ti durante 7 días |

## MIX · `/estudio/mix/`

Ver el ejemplo es gratis. **Encender cobra días × 5 créditos** (`tarifas.json`
§mix): la prueba más barata es una campaña de 1 día, y apagarla antes de que
salga devuelve lo cobrado. Hazla en el teléfono (390 px) y en el escritorio.

| # | Paso | Qué tiene que pasar |
|---|---|---|
| 1 | Entrar | Los 6 pasos; «Ver un ejemplo» apagado y «Falta la foto de tu producto.» |
| 2 | Subir un GIF | «Tiene que ser JPG, PNG o WebP.», sin subir nada |
| 3 | Foto, motivo, «3 días» y una cuenta | Rango «Del … al … · 3 días, 3 publicaciones.»; aún **ningún** número de costo |
| 4 | Ver un ejemplo | El orbe «Preparando tu ejemplo · hasta 2 min»; cerrar la pestaña y volver: retoma la espera |
| 5 | Con el ejemplo | La publicación del día 1 y debajo «Son N créditos y se te cobran ahora» = días × 5 |
| 6 | Cambiar la hora | El costo sigue; el ejemplo sigue valiendo |
| 7 | Cambiar una letra del motivo | «Cambiaste la campaña después de ver esto…» y «Encender» desaparece |
| 8 | Ver otro ejemplo, y 💳 marcar 1 solo día y doble clic en «Encender la campaña» | **Un** cobro de 5; «Campaña encendida…»; el panel «Tu campaña» |
| 9 | Apagar la campaña → Enter | La confirmación dice cuánto se devuelve; Enter = «No, dejarla» |
| 10 | Apagar → «Sí, apagarla» | «Te devolvimos 5 créditos» (si aún no salió); la píldora del saldo lo refleja |
| 11 | Desconectar Blotato y volver a MIX | El aviso y el formulario apagado; un clic lleva a conectar |
| 12 | «Usar la versión anterior» | Llega a `/mix.html`; en `todos`, `/mix.html` ya no redirige para ti durante 7 días |

## crear · `/estudio/crear/`

Generar cobra el guion (**✦ 10**, `tarifas.json` §video.preparar) y producir,
el resto de la duración (`por_duracion − preparar`). La película más barata es
de 15 s: **✦ 10 + ✦ 45**. Cambiar el personaje o una imagen cuesta **✦ 2**.
Hazla en el teléfono (390 px) y en el escritorio.

| # | Paso | Qué tiene que pasar |
|---|---|---|
| 1 | Entrar desde el inicio con una idea escrita | La idea en el cuadro; «Generar ✦ 10»; «Película de 0:30: ✦ 100 en total» y la nota que reparte 10 + 90 |
| 2 | Bajar la duración a 0:15 (botón − y flechas del teclado) | «✦ 55 en total» y «los otros 45, al producir»; el botón sigue en «Generar ✦ 10» |
| 3 | Subir 5 imágenes del personaje | Entran 4 y «1 se quedó fuera»; quitar una devuelve el foco a otra miniatura |
| 4 | Escribir algo violento y Generar | «Revisa tu texto» explica por qué; **no** se cobra nada |
| 5 | Poner un rubro que no cuadre y Generar | «¿Crear de todos modos?», con el foco en «No, la cambio» |
| 6 | 💳 Texto normal, doble clic en «Generar ✦ 10» | **Un** cobro de 10; la URL pasa a `?p=…`; los pasos «Entendiendo tu idea…» |
| 7 | Cerrar la pestaña a media espera y volver con el enlace | Retoma la espera donde iba; la barra no retrocede |
| 8 | En revisión: elegir una opción, editar una escena, esperar 1 s y recargar | «Guardado a las HH:MM»; tras recargar, la escena editada sigue ahí |
| 9 | «Escuchar» una voz | Suena la muestra; no cobra |
| 10 | 💳 «Cambiar ✦ 2» con «ponle lentes» | Aparece una opción nueva marcada; la píldora baja 2 |
| 11 | Marcar «Enséñame las imágenes antes de animar» y 💳 «Producir ✦ 45» (doble clic) | **Un** cobro de 45; «Produciendo tu película»; se detiene en «¿Te gustan estas imágenes?» |
| 12 | «Mejor no» → Enter | Enter = «No, seguir aquí»; nada cambia |
| 13 | «Animar la película» | Sin cobro; vuelve la espera con «Faltan unos N min.» |
| 14 | Con la película lista | Video con portada; «Descargar» baja el mp4; «Editor» abre el editor de cortes |
| 15 | «Rehacer» | Vuelve a revisión; no cobra |
| 16 | «Usar la versión anterior» | Llega a `/crear.html`; en `todos`, `/crear.html` ya no redirige para ti durante 7 días |
