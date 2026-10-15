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
| 3 | Subir una segunda foto | «Generar ✦ 38» y la nota «36 créditos + 2 por juntar tus 2 fotos en una» (`tarifas.json` §clip: `video_8s` 36 + `componer_imagenes` 2) |
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
teléfono (390 px) y en el escritorio. **Desde R4b la caja cobra** (el clip y la
imagen se piden en ella) **y desde E1 también la edición de un video** (pasos
15 a 33; **E2** —varios videos, «Elegir de Mis creaciones», copia y unión— en los pasos 74 a 85) **y, desde el 14-oct-2026, la foto del personaje de cuentos e historias**
(pasos 35 a 42; «Crear» en la caja solo navega y NO cobra, el que cobra es el 42, ya
en la pantalla Crear). Los pasos 43 a 48 son los ajustes del dueño del 14-oct-2026
al título y a la pestaña Edición (el 43 y el 46 se reescribieron el 15-oct-2026 para
la tarjeta nueva; ninguno cobra). **Los pasos 49 a 70 son el recorrido del 15-oct-2026
(«Mapa con Irremplazables»):** el mapa en X, las tres opciones, las migas, Esc, el
celular, Blotato conectado y sin conectar, Central, la miga desde Agenda y
«De videos a Shorts» dentro de «Editar ▾» (49 a 66 no cobran; en 67 a 70 solo
cobra, y con el «sí» del dueño, «Importar ✦ N» de la pantalla de Shorts). **Los pasos
43, 46, 47 y 49 a 66 se reescribieron en la segunda ronda del dueño (15-oct-2026,
«el mapa es el inicio»):** se aterriza en el mapa, sin nada elegido; «Irremplazables»
va arriba y fuera de cualquier tarjeta; solo la caja lleva tarjeta; ya no hay
«Volver a …» (salvo el de la página de donde se llegó); y el 71 a 73 son lo nuevo de
esa ronda (el botón «Iniciar» de Edición con el ancho del selector de modelo, y la
frase de ayuda que ya no se ve). Los pasos marcados 💳 gastan créditos reales y solo se
corren con el «sí» del dueño; el resto no cobra.

| # | Paso | Qué tiene que pasar |
|---|---|---|
| 1 | Cuenta nueva | «Tu primer video, en tres caminos»; «Crear un video» pone «Creador de cuentos» y enfoca la caja |
| 2 | Abrir el desplegable con el teclado (Tab, ↓, ↓, Enter) | Cambia la opción; los precios coinciden con `tarifas.json` (clip 36, historias 55–190, imágenes 2) |
| 3 | En el teléfono, abrir el desplegable | No se sale de la pantalla; la página no se desplaza de lado |
| 4 | 💳 Escribir algo y «Crear» en cada opción | Las que navegan llegan a la pantalla correcta con el texto ya puesto. El clip y «Crear una imagen» **cobran en la caja** (💳); «Editar una imagen» sin foto no cobra: pide la foto con el «+» |
| 5 | Con proyectos: clic en una película, en una imagen y en una edición | Abren `crear`, `imagenes` y `e1` con su proyecto |
| 6 | Archivar una película → Cancelar → Archivar | Nada con Cancelar; con Archivar pasa a «Proyectos archivados» |
| 7 | Restaurar con los slots llenos | El motivo del server en un aviso |
| 8 | Cuenta sin Blotato: mapa → Marketing → Blotato (y luego Avanzado); ver los pasos 54 y 57 | Agenda, competencia y métricas (y MIX, en Avanzado) en gris con «Conecta tu Blotato para usarlo»; el clic no navega: abre «Conecta tu Blotato» con el aviso del cobro antes del campo |
| 9 | Pegar una clave mala, luego una buena | El error en el diálogo; con la buena, «Tu Blotato está conectado» con las redes, las tarjetas se encienden y el botón de arriba pasa a «Blotato conectado: ver o cambiar» |
| 10 | Pegar una clave y cerrar con la X o con el fondo | Al volver a abrir, el campo está vacío |
| 11 | Desde el editor, «conectar Blotato» | Llega con el diálogo abierto |
| 12 | Modo avión y recargar | «No pudimos traer tus proyectos» con Reintentar; no aparecen los tres caminos |
| 13 | «Tus trabajos» con un render en curso | El cuadro de siempre, abajo a la derecha |
| 14 | Teclear `/ui/clasica?pantalla=inicio` (el enlace «Usar la versión anterior» se quitó el 28-sep) | Llega a `/estudio/` clásico; en `todos`, `/estudio/` ya no redirige para ti durante 7 días. `/ui/nueva?pantalla=inicio` te regresa |
| 15 | En la caja (mapa → Marketing → Distrito), tocar «Edición» del riel | Tres botones: Imagen · Video · Edición (la caja sigue arrancando en Video). Aparecen el campo «Cuéntale a la IA qué quieres» (en su cuadro con borde, con la pista gris «Cuéntale a la IA qué quieres. Ejemplo: «Quita muletillas y silencios»»; **ya no hay una fila de ideas debajo**), el «+», el chip «Editar ▾» junto al «+» e «Iniciar» sin precio y **dorado**. **Debajo ya no hay ninguna frase** (antes, «Escribe qué quieres hacer con tu video.»): solo la oye quien usa lector de pantalla, como la descripción de «Iniciar» mientras no hay texto |
| 16 | Tocar «Iniciar» sin video | Aviso abajo a la derecha: «Primero agrega el video: pulsa el «+» o arrástralo a la caja.»; no cobra |
| 17 | «+» → «Subir de tu computadora» y elegir un MP4 de unos 12 min (o arrastrarlo a la caja; pegar con Ctrl+V no hace nada) | La tarjeta con nombre, formato y tamaño; barra de progreso que avanza de verdad; el botón dice «Subiendo…» y la nota «Cuando termine de subir calculamos el precio. Hasta entonces no se cobra nada.»; no cobra |
| 18 | Mientras sube: escribir algo, cambiar a «Video» y volver a «Edición»; tocar el «+» y «Subiendo…» | El texto y la subida siguen donde iban (no se cortó); el «+» y el botón avisan «Ya hay un trabajo en curso. Cuando termine puedes empezar otro.» |
| 19 | Al terminar de subir | La tarjeta suma la duración («12:04 · MP4 · …»); «Iniciar ✦ N», dorado y con `aria-disabled`, con el N que dice el servidor (✦ 8 para 12:04 sin transcripción, ✦ 2 con ella; `tarifas.json` §editar y §shorts) |
| 20 | Tocar «Iniciar ✦ N» sin haber escrito nada | El foco pasa al campo; no sale ningún aviso y no cobra |
| 21 | Dejar el campo vacío y sin el foco unos 15 s mirando la pista; luego tocar el campo; luego escribir una letra; luego borrarla y tocar fuera | **Rota sola**: cada ~4 s la idea se apaga con un fundido y entra la siguiente («Un short vertical para Reels», «Resumen de 60 segundos», «Subtítulos grandes y un título») y da la vuelta a la primera; el cuadro **no cambia de alto** ni mueve lo de abajo. Al tocar el campo se queda **quieta y entera**; al escribir desaparece como cualquier texto de pista; al borrar y soltar el foco vuelve a rotar. Abrir la pestaña de Edición siempre empieza en la primera, sin animación. Con «reducir movimiento» del sistema queda fija en la primera idea (si lo apagas con la pantalla abierta sigue en la primera y rota desde ahí, sin saltar de golpe a otra). Con otra pestaña al frente no avanza (al volver sigue desde donde iba). Escribir cualquier texto enciende «Iniciar ✦ N» (sin `aria-disabled`; debajo: «Tienes ✦ S; después te quedan ✦ …»). Con lector de pantalla: el campo se anuncia «Cuéntale a la IA qué quieres», con la descripción fija «Por ejemplo: quítale las muletillas, ponle subtítulos y hazlo vertical para Reels.» (se oye al enfocar el campo, **no** otra vez como párrafo suelto en modo lectura), y el cambio de idea **no** se anuncia |
| 22 | Subir un video de menos de 1 min | «Iniciar» sin precio, dorado pero con `aria-disabled`, con el aviso del servidor debajo; tocarlo lleva el foco al «+» (cambiar el video); no cobra |
| 23 | 💳 Doble clic rápido en «Iniciar ✦ N» (mientras sale dice «Iniciando…») | **Un** cobro en la píldora (vuela «−N»); la caja se vacía (texto y video); «Tus trabajos» muestra la edición sola |
| 24 | 💳 Con la corrida en marcha: tocar el «+» e «Iniciar» | «Ya hay un trabajo en curso. Cuando termine puedes empezar otro.»; cuando termina, vuelven a servir (el servidor todavía no tiene candado por cuenta: dos pestañas pueden lanzar dos) |
| 25 | Con el saldo por debajo del precio (o con la píldora desactualizada) | «Iniciar ✦ N» dorado pero con `aria-disabled`, «Tienes ✦ S: no alcanza para editar este video.» y «Te faltan ✦ N · …» (con la recarga cerrada, el texto del monedero y no un botón muerto); no cobra y no se vacía nada |
| 26 | 💳 Al terminar la corrida, abrir «Abrir el editor» en la ficha de «Tus trabajos» | Abre `/editor/<copia>/` con los cortes propuestos para auditar (desde E2 el encabezado dice «Copia de «x». Tu original no se toca.»); el archivo que subiste no cambió. Si pediste algo que el motor no hace (p. ej. «hazlo vertical») sale como duda en el editor, no se calla |
| 27 | 💳 Si una corrida falla de nuestro lado o no encuentra relleno | Los créditos vuelven: la píldora sube otra vez |
| 28 | Con el teclado: Tab hasta «Iniciar» cuando aún no se puede (sin video o sin texto) | Se enfoca (anillo ámbar) y el lector de pantalla lo anuncia como no disponible y por qué |
| 29 | Teléfono (390 px) con un video en la caja | La caja no se sale de la pantalla; el «+», el chip «Editar ▾», la ✕ e «Iniciar» se tocan sin errar (al menos 44 px) |
| 30 | Subir DOS videos distintos que se llamen igual (p. ej. dos «final.mp4»), uno después del otro, con la misma cuenta | El segundo se sube como un proyecto nuevo (en «Tus trabajos» sale con un nombre distinto) y su precio es el suyo: no hereda la transcripción ni los cortes del primero |
| 31 | Con el teclado, sin ratón: Tab desde «Edición» por el campo, el «+», el chip «Editar ▾» e «Iniciar» (las ideas ya no son botones: no hay paradas de Tab entre el campo y el «+»); Espacio en el «+»; Enter y Espacio en «Iniciar» con `aria-disabled` | El anillo ámbar se ve en cada parada, **también alrededor del cuadro del campo** (uno solo, no dos; y cuando «Iniciar» le lleva el foco); el orden es el de la pantalla y Shift+Tab lo recorre al revés; Espacio en el «+» abre su menú (E2: Enter en «Subir de tu computadora» abre el selector de archivos); Enter y Espacio hacen lo mismo que el clic |
| 32 | Teléfono (390 px y, si se puede, 320 px): campo vacío y, con un video subiéndose, el botón | La pista del campo se lee **entera** con cada una de las 4 ideas (sin cortarse y sin que el cuadro cambie de alto al rotar); «Subiendo…» está en **ámbar** con el cursor de espera (no gris discontinuo) y la nota de abajo lo explica; el cuadro del campo no se sale de la pantalla; **a 320 px la página no se arrastra de lado** y la pista del chip («Editar ▾», «Un video corto ▾»…) queda dentro de la pantalla al pasar el ratón o al enfocarlo con Tab |
| 33 | Tocar el «+» mientras sube un video; esperar a que termine de subir y salga el precio | El aviso «Ya hay un trabajo en curso. Cuando termine puedes empezar otro.» se **quita solo** cuando el trabajo termina; si la subida falla, el aviso lo reemplaza el error y ese sí se queda |
| 34 | 💳 En «Imagen» → «Crear una imagen», escribir algo realista y sin estilo (p. ej. «una foto de un perro en la playa, de día») y «Crear» | Un cobro; la imagen sale como lo escribiste, **no** en caricatura 3D tipo Pixar (antes salía «Animado» siempre). En `/estudio/imagenes/` el estilo elegido sigue funcionando |
| 35 | En «Video» → «Creador de cuentos» (y luego «Crea tu historia») mirar la caja | Hay un «+» (antes no): su pista dice «Agrega la foto de tu personaje, arrástrala a la caja o pégala con Ctrl+V», la nota de la opción y el ejemplo dicen «Con el + puedes agregar la foto de tu personaje.». En «Un video corto», «Crear una imagen» y «Editar una imagen» el «+» dice lo de siempre |
| 36 | En «Creador de cuentos»: «+» → elegir un JPG; luego otro PNG; luego un HEIC, un GIF y uno de más de 15 MB; luego arrastrar una foto a la caja y pegar una captura con Ctrl+V | Se ve **una** miniatura (la foto de tu personaje) con su ✕; la segunda **reemplaza** a la primera (no dice «Como mucho»); HEIC, GIF y el pesado se rechazan con su motivo abajo a la derecha («Sirven: .jpg, .jpeg, .png, .webp» / «pesa demasiado (máximo 15 MB)»); arrastrar y pegar también valen. Con imágenes en Mis creaciones el «+» abre su menú («Subir de tu computadora · JPG, PNG o WebP · hasta 15 MB», «Elegir de Mis creaciones») y la hoja deja elegir una |
| 36b | En «Un video corto» agregar una foto HEIC (o GIF), cambiar a «Creador de cuentos», escribir un texto y «Crear» | **No navega ni guarda nada**: abajo a la derecha dice por qué no sirve («Sirven: .jpg, .jpeg, .png, .webp»); quitar la foto o reemplazarla por un JPG deja seguir. Reemplazar la foto en cuentos no borra las otras del clip al volver a él |
| 37 | Con la foto puesta y un texto, cambiar a «Crea tu historia», a «Un video corto» y volver a «Creador de cuentos» | La foto sigue ahí en cada una (en el clip cuenta como una de sus referencias). «Quitar» la saca |
| 38 | Con la foto puesta y un texto, «Crear» (doble clic rápido) en «Crea tu historia» | **No cobra** (la píldora no cambia): solo navega, **una vez**, a `/estudio/crear/` con el texto, el modo «Tengo una idea» marcado y **la foto como miniatura** en su cuadro, con su ✕ y «Detalles del personaje». Sin ningún aviso rojo. La dirección trae `refs=…` mientras no se crea la película. Va directo a `/estudio/crear/`, también con el interruptor en `nueva` (sin `UI_ETAPA_MINIMA`) |
| 39 | En esa pantalla de Crear: recargar la página (F5) | La foto sigue ahí (se guarda 10 minutos o hasta crear la película). Pasados 10 minutos sin crearla, recargar muestra «Tu foto no alcanzó a llegar desde el inicio. Agrégala con el «+» de aquí.» |
| 40 | En ventana privada de Firefox (o con los datos del sitio bloqueados): foto + texto + «Crear» en «Creador de cuentos» | Navega igual a Crear (con `refs=perdida`) y ahí dice, **junto al «+» y a la vista sin bajar** (también a 390 px de ancho), «Tu foto no alcanzó a llegar desde el inicio. Agrégala con el «+» de aquí.»; «Generar» sigue sirviendo y el «+» de Crear también; no cobra |
| 41 | Sin foto: «Crear» en «Creador de cuentos» y en «Crea tu historia» | Igual que siempre: llega a Crear con el texto y el modo, sin foto y sin ningún aviso; la dirección no lleva `refs` |
| 42 | 💳 En Crear con la foto llegada del inicio, «Generar ✦ N» (la primera vez) | **Cobra de verdad** (✦ `video.preparar`): se crea la película con la foto como imagen del personaje (la ve en el paso de «Revisa tu película», el personaje sale parecido). Solo con el «sí» del dueño. Nota: Crear acepta 4 fotos pero el motor usa la primera |
| 43 | Abrir `/estudio/inicio/` en el escritorio (1100 px) sin tocar nada | **Aterrizas en el mapa:** «Irremplazables» arriba (único título, en negritas y en **dorado con degradado**, más claro arriba y más hondo abajo; se lee bien, sin icono) y, debajo, «Elige un área» con la X de las cinco áreas, **sin ningún cuadro alrededor** y **centrada** (arriba y abajo queda un hueco parecido). **Ninguna ficha se ve elegida**: ni «Estás aquí», ni un tono distinto en Marketing; Marketing y Central se ven iguales. **No hay «Volver a …»**, ni migas, ni menú o columna a la izquierda, y «Editor de videos» no sale en ninguna parte. La caja y «Mis creaciones» no se ven todavía. Para llegar a la caja: Marketing → Distrito. En una cuenta nueva, «Desde tu metraje → Subir metraje» (ya con la caja a la vista) sigue llevando a `/e1.html` |
| 44 | En «Imagen», «Video» y «Edición», mirar dónde se escribe | En las tres, un cuadro con borde bien visible y fondo un poco más claro que la caja; el ejemplo en gris legible. Un clic en cualquier parte del cuadro (no solo en las líneas con letra) pone el cursor para escribir |
| 45 | Tab hasta el campo en cada familia | **Un solo** anillo ámbar, alrededor del cuadro entero (no uno dentro de otro) |
| 46 | En «Edición»: mirar la fila de abajo y tocar «Editar ▾» | El chip está junto al «+», como «Un video corto ▾» en Video; abre una lista con **DOS opciones** («Editar · según el video», la de ahora, y «De videos a Shorts · según el video»; ver los pasos 67 a 70); elegir la de ahora solo cierra la lista; Esc la cierra y el foco vuelve al chip; Tab la cierra y el foco sigue al «Iniciar» (Shift+Tab, al «+»), nunca se pierde. Lo mismo en Imagen y Video. Al pasar el ratón (o enfocar el chip con Tab) sale una pista con lo que hace la opción de ahora —en Edición, «Sube tu metraje y la IA te propone el corte. Se edita una copia: tu original se queda como está.»; en Imagen y Video, la nota de su opción— y se ve entera, también a 390 px. No hay chip de modelo ni de duración |
| 47 | Teléfono (390 px), pestaña «Edición» | «+» y «Editar ▾» van en la misma fila arriba; «Iniciar» abajo a todo el ancho (igual que el selector de modelo en Video); nada se sale de la pantalla; con la lista abierta, tampoco |
| 48 | «Iniciar» en cada estado: sin video, con video y sin texto, con todo, sin saldo | Siempre **dorado** (nunca gris ni discontinuo); lo que cambia es lo que dice («Iniciar» o «Iniciar ✦ N»), la nota de abajo y qué hace al pulsarlo (avisa, lleva el foco al campo o al «+», o cobra solo cuando está todo) |
| 49 | Escritorio: en la caja, tocar la miga «Marketing» | Se abre **«Elige un área»**: el mapa en X con las cinco áreas (Marketing, Producto, Central en el centro, Ventas, Automatizaciones) y dos diagonales punteadas por detrás de las fichas que no tapan ningún texto. **Ninguna ficha dice «Estás aquí»** ni se ve distinta. **No aparece ningún «Volver a …»** y en el mapa **no hay migas**. «Irremplazables» no se movió de lugar. La caja desaparece de la vista, y con ella «Mis creaciones» y todo lo de debajo; la tarjeta se va (el mapa no tiene cuadro alrededor) |
| 50 | En el mapa, tocar Producto, Ventas y Automatizaciones | No pasa nada: el mapa se queda como estaba. Se ven apagadas con «Próximamente» (fondo más hundido, texto gris legible), pero sí reciben el foco con Tab y el lector de pantalla las anuncia como no disponibles |
| 51 | En el mapa, tocar Marketing | Se abre **«Elige un grupo»** con tres tarjetas: **Distrito** (Imagen · Video · Edición), **Blotato** (Agenda tus publicaciones · Investiga tu competencia · Ver mis métricas) y **Avanzado** (Publicaciones automáticas · Copiadora de estilos), sin cuadro alrededor y centradas; debajo del título, centrada, la miga «Marketing». **Recién abierto el inicio, ninguna dice «Estás aquí»** (nadie ha elegido nada); si ya habías estado en la caja o en una lista, esa tarjeta sí lo dice. Tocar Distrito muestra la caja tal cual la dejaste |
| 52 | Con la caja abierta: miga «Marketing» → mapa → Central → mirar sus opciones → Esc → Marketing → Distrito | Mirar otra área no te saca de donde estabas: en Central la miga dice «Central» y «Estás aquí» no aparece en ninguna de sus tarjetas; Esc sube al mapa (no hay «Volver a …»); y Marketing › Distrito muestra la misma caja de antes, con su texto |
| 53 | Central → Distrito, y luego Central → Deepseek | Distrito: la lista COI, Biblioteca de prompts, Preguntas sobre la clase y Glosario IA, las cuatro apagadas con «Próximamente»; ninguna es un enlace ni lleva a ningún lado (el clic no hace nada). Deepseek dice «Próximamente» en su tarjeta y, al abrirla, «Todavía no está disponible.» bajo su título |
| 54 | Cuenta SIN Blotato: mapa → Marketing → Blotato | Arriba, el botón **«Conecta tu cuenta de Blotato»**; debajo las tres tarjetas en gris (menos opacidad) con «Conecta tu Blotato para usarlo». El clic en cualquiera NO navega: abre el diálogo «Conecta tu Blotato» con el aviso del cobro antes del campo. Pegar una clave buena enciende las tres y el botón pasa a verde, «Blotato conectado: ver o cambiar»; el recorrido no se movió |
| 55 | Cuenta CON Blotato: mapa → Marketing → Blotato | El botón dice **«Blotato conectado: ver o cambiar»** (verde) y abre el diálogo «Tu Blotato» con las redes. Las tres tarjetas están encendidas y cada una lleva a su pantalla (Agenda, Competencia, Métricas) |
| 56 | Con el estado de Blotato sin poder saberse: en las herramientas del navegador, bloquear la petición `/api/blotato` y recargar el inicio; abrir Blotato y Avanzado | **Nada se apaga**: ninguna tarjeta está en gris ni dice «Conecta tu Blotato», y un clic navega. (Dejar sin sus herramientas a quien sí paga porque una consulta no respondió es peor que dejar entrar a quien no) |
| 57 | Mapa → Marketing → Avanzado (con y sin Blotato) | Dos tarjetas: «Publicaciones automáticas» (MIX) y «Copiadora de estilos». Sin Blotato solo MIX sale en gris y su clic abre conectar; la Copiadora no se apaga. **No hay botón de conectar** en Avanzado (no todo el grupo depende de Blotato). «De videos a Shorts» no está en ninguna lista |
| 58 | Abrir `/estudio/agenda/` y tocar «Marketing» en las migas (junto a «← Estudio»); luego repetir con «Blotato» | «Marketing» lleva al inicio con **«Elige un área»**, **sin «Estás aquí»** y con **«Volver a Agenda tus publicaciones»** centrado bajo el título (es el único «Volver a …» que existe: esa página no se alcanza con las migas); «Blotato» abre **«Elige un grupo»** con «Estás aquí» en Blotato (venías de él). En los dos casos la barra de direcciones queda en `/estudio/inicio/` (sin `?desde=`). Recargar (F5) aterriza en el mapa, ya sin «Volver a Agenda…». «Volver a Agenda tus publicaciones» (y Esc, sin tocar nada antes) regresa a Agenda, y el botón «Atrás» del navegador también. Elegir un grupo olvida la página de la que venías: ya no hay ningún «Volver a …» |
| 59 | Lo mismo desde Competencia, Métricas, MIX y la Copiadora de estilos; y abrir Admin, Crear, Subir, Clip, Imágenes y Shorts | Cada hoja dice su propio camino (MIX y la Copiadora: «Marketing › Avanzado»; las otras tres: «Marketing › Blotato») y su «Volver a …» nombra esa pantalla. Admin, Crear, Subir, Clip, Imágenes y Shorts **no** traen migas: solo «← Estudio». A 320 px las migas pasan a una segunda fila sin salirse |
| 60 | Escribir a mano `/estudio/inicio/?desde=mkt.nada.nada&ver=mapa` (y otra con `ver=otra`) | Aterriza en el mapa, sin ningún error ni «Volver a …», y la barra de direcciones se limpia. Un `?blotato=conectar` que viniera en la misma dirección sigue abriendo el diálogo |
| 61 | Esc: con el mapa abierto (el foco dentro de la región), luego con las tres opciones, en la caja y en una lista | **En el mapa no hace nada. En las tres opciones sube un nivel: abre el mapa** (con el foco en «Elige un área»). En la caja no hace nada y no borra lo escrito; en la lista de un grupo tampoco. Con una página de por medio (llegaste desde Agenda), Esc regresa a ella desde el mapa y desde las opciones. Con el diálogo de Blotato abierto, Esc cierra solo el diálogo y devuelve el foco a su botón; con la lista de «Editar ▾» abierta, cierra solo la lista. Con el foco fuera de la región (en la barra del navegador, por ejemplo) no hace nada |
| 62 | Teclado: con el mapa abierto, Tab y Shift+Tab; Enter en una ficha; Enter en una tarjeta de grupo | El orden es el de lectura: Marketing, Producto, Central, Ventas, Automatizaciones (las apagadas también paran); sin migas ni «Volver a …» que tabular (con una página de por medio, «Volver a …» va primero). Enfocando el título «Elige un área», el primer Tab cae en Marketing. Tras Automatizaciones el siguiente Tab sale de la región. Enter lleva el foco al título del paso nuevo («Elige un grupo», el nombre del grupo o el título de la caja) y el siguiente Tab sigue desde ahí: el foco no se pierde. Al abrir el inicio sin más, el foco se queda en la página (no se le roba). El anillo ámbar se ve en cada parada |
| 63 | Doble clic rápido en la ficha de Marketing del mapa | Se abren las tres opciones y **se quedan ahí**, en «Elige un grupo»: el segundo clic no elige un grupo por accidente. Un clic normal pasado el medio segundo (o Enter) sí elige |
| 64 | Teléfono (390 px y, si se puede, 320 px): abrir el inicio (el mapa), Marketing, Blotato, Central | El mapa es la **«X compacta»**: dos columnas, Central como una banda de ancho completo en medio y trazos punteados cortos hacia ella, **centrada** en la pantalla y sin cuadro alrededor. «Automatizaciones» y «Próximamente» salen en una sola línea, sin cortarse; las fichas se tocan sin errar; las tres opciones se apilan en una columna; **la página no se arrastra de lado a 320 px**; el título dorado se lee entero y está en el mismo lugar en todos los pasos. Con la caja, la tarjeta baja del título (no queda pegada arriba) y el riel (Imagen · Video · Edición) va horizontal |
| 65 | Escribir un texto en «Video», abrir el mapa con la miga y volver por Marketing → Distrito; repetir yéndote a Blotato y regresando por Marketing › Distrito, y con un video subiéndose en «Edición» | **La caja conserva todo**: el texto sigue ahí, la subida siguió corriendo mientras mirabas el mapa (y termina con su precio), y regresas a la misma pestaña (a Edición si estabas en Edición). No hay ningún «Volver a Video» ni «Volver a Edición» |
| 66 | Con proyectos o imágenes hechos: abrir el inicio (el mapa), elegir Marketing → Distrito, y luego abrir el mapa, las tres opciones y una lista de Blotato | «Mis creaciones» (con su filtro y su «Ver más») y lo de debajo solo se ven con la caja a la vista (no al abrir el inicio); al volver están como los dejaste. A quien empieza, «Tu primer video, en tres caminos» tampoco le sale con el mapa abierto |
| 67 | Edición → «Editar ▾» → «De videos a Shorts» | El chip dice «De videos a Shorts ▾» y el cuerpo cambia: «Sube un video largo o pega la liga de YouTube y te proponemos los mejores momentos como shorts.», el campo **«Liga de YouTube»**, el «+» y **«Iniciar» dorado SIN precio**; debajo «Subirlo no cuesta nada: el precio aparece cuando termina de subir.». La pista de ideas no rota en este modo. Abrir el mapa, volver por Marketing › Distrito y cambiar a «Video» y volver: sigue en Shorts y con la liga escrita |
| 68 | Pegar una liga de YouTube y tocar «Iniciar» (o Enter en el campo). 💳 solo si además se importa | La nota pasa a «Te llevamos a Shorts: ahí ves el precio antes de que se cobre algo.»; **la caja no cobra ni pide nada** (la píldora no se mueve): navega a `/estudio/shorts/?url=…` y ahí la liga ya está escrita en «Importar», sin haber cotizado ni importado. El precio aparece al cotizar; **cobrar es de «Importar ✦ N»** de esa pantalla (💳, paso 4 de shorts, solo con el «sí» del dueño) |
| 69 | En «De videos a Shorts»: «Iniciar» sin liga ni video; con una liga que no es de YouTube (p. ej. de Vimeo); y con un MP4 desde el «+» | Sin nada: aviso abajo a la derecha «Primero pega la liga de YouTube o agrega el video con el «+».», no navega y el botón sigue enfocable. Liga de otro sitio: «Esa no parece una liga de YouTube…» junto al campo, el foco vuelve a él y no se gasta nada; el error se va al escribir. La nota de debajo sigue diciendo «Subirlo no cuesta nada…» (nunca «Te llevamos a Shorts…», ni antes ni después de tocar «Iniciar»: solo lo dice con una liga de YouTube o con un video subido). Con el video: sube con la tarjeta, el progreso y «Cancelar la subida» de Edición, **sin pedir el precio de Edición**, y «Iniciar» navega a `/estudio/shorts/?p=<proyecto>`; mientras hay un video, el campo de la liga se oculta, y al quitarlo vuelve con lo que tenía |
| 70 | Después de pasar por Shorts, volver a «Editar» (texto y video puestos) | Editar sigue como en los pasos 15 a 33: «Iniciar ✦ N» cobra por el servidor y **no navega**; con una corrida de Edición en marcha, «Iniciar» en Shorts avisa «Ya hay un trabajo en curso…» en vez de navegar. Un video que subiste estando en Shorts pide su precio de Edición al pasar a «Editar» |
| 71 | Escritorio (1100 px): pestaña «Video» y mirar «Modelo Veo 3.1 Lite · 8 s ▾»; luego «Edición» y mirar «Iniciar» | **Los dos miden lo mismo de ancho** (216 px: el selector de modelo, con su flecha al borde derecho, y «Iniciar», dorado) y quedan pegados al borde derecho del cuadro, a la altura del «+» y de «Editar ▾» / «Un video corto ▾» (44 px). Con un modelo de nombre más largo (p. ej. «Grok Imagine Video 1.5 Lite») el selector **crece** y «Iniciar» se queda en 216 px; en el teléfono los dos ocupan todo el ancho |
| 72 | Pestaña «Edición», sin texto ni video, con el lector de pantalla (o mirando el árbol de accesibilidad) | **No se ve ninguna frase** bajo el «+» y «Iniciar» (antes: «Escribe qué quieres hacer con tu video.»); el lector sí la dice al enfocar «Iniciar» como su descripción mientras el campo está vacío, y la caja no deja un hueco vacío debajo de la fila |
| 73 | Al abrir el inicio, mirar la posición de «Irremplazables» y, en cada paso (mapa, opciones, lista de Blotato, caja), compararla | **No se mueve** de un paso a otro (arriba, debajo del saldo, centrado). Solo la caja tiene tarjeta: empieza **debajo del título, con aire** (a 1100×800 su borde cae a unos 155 px, no a los 64 de antes) y no se centra en vertical; el mapa, las opciones y las listas no tienen ningún cuadro y quedan centrados en el alto que sobra |
| 74 | Edición → «+» (con la caja vacía, y luego con un video ya puesto); con el teclado: Enter, flechas, Inicio, Fin, Esc, Tab y un clic fuera; con una subida o una corrida en marcha | El «+» abre un menú «Agregar videos» con **«Subir de tu computadora»** y **«Elegir de Mis creaciones»** (el foco cae en la primera; las flechas dan la vuelta; Esc lo cierra y devuelve el foco al «+»; Tab lo cierra y sigue al chip «Editar ▾»; un clic fuera lo cierra) y la línea «También puedes arrastrar el video a la caja.». Con un video puesto el «+» dice «Agregar otro video». Con una subida o una corrida en marcha **no abre**: avisa «Ya hay un trabajo en curso…». Abrirlo no pide nada a la red |
| 75 | «+» → «Elegir de Mis creaciones» con películas, cuentos y clips ya hechos; mirar la hoja; marcar tres en un orden (p. ej. el clip, luego la película, luego el cuento) y «Usar 3 videos» | Se abre la hoja «Agregar videos» con las pestañas «Mis creaciones» y «Mi computadora» y los filtros Todo · Películas · Cuentos · Clips · Ediciones, cada uno con su cuenta. Cada tarjeta dice su nombre, tipo, fecha, **duración y 16:9**; los de menos de 1 min llevan la etiqueta «Solo para unir». Marcar numera **1, 2, 3 en el orden en que marcas**; el pie dice «3 videos · m:ss en total · Se edita una copia; tus originales no se tocan.». «Usar 3 videos» cierra, el foco vuelve al «+» y la caja muestra **«3 videos · m:ss · se unen en este orden»** con una fila por video y «Se edita una copia. Tus originales se quedan como están.»; «Iniciar ✦ N» trae el precio del servidor (UNO solo, no uno por video) |
| 76 | En la hoja: marcar un video horizontal y mirar los verticales; tener a la vista uno de más de 90 min y una edición (copia); marcar UN solo video de menos de 1 min; marcar dos cortos; llegar a 12 videos o a 90 min en total | Con un horizontal marcado los verticales se apagan con «Vertical · no se une con horizontales» (y al revés; al desmarcar vuelven). Los de más de 90 min y las ediciones van **aparte**, bajo «No se pueden editar», cada uno con su motivo y sin forma de marcarlos. Con UN solo video corto «Usar este video» queda apagado y el pie avisa «Un video de menos de 1 min no se puede editar solo. Marca otro para unirlos.»; con dos cortos sí se puede. Al pasarse de 90 min o de 12 videos lo que ya no cabe se apaga con su motivo («Se pasa de 90 min», «Ya son 12 videos · es el máximo»). Esc, Cancelar y la ✕ cierran y **olvidan lo marcado** |
| 77 | Con tres videos en la caja: con el teclado, «Bajar “x”» y «Subir “x”» (Enter y Espacio); mirar el primero y el último; quitar uno con su ✕ | El orden cambia, **el foco se queda en el mismo botón** aunque la fila se movió, y el lector de pantalla oye «“x” ahora es el número N de M.». La primera fila no puede subir y la última no puede bajar (apagadas pero enfocables). **Reordenar no vuelve a pedir el precio ni cobra**; quitar uno sí lo vuelve a pedir con los que quedan, recorre los números y lleva el foco al «+»; con UNO solo vuelve su tarjeta de siempre |
| 78 | «+» → «Subir de tu computadora» y elegir DOS o TRES MP4 a la vez; mientras suben, cancelar el que está subiendo con su ✕ («Cancelar la subida de «x»») | Suben **de uno en uno**: el primero con su barra y «Subiendo… N %», los demás «En cola» (sin barra); «Iniciar» dice «Subiendo…» y la nota «Cuando termine de subir calculamos el precio…». Al terminar el último sale **UN solo precio** con todos. Cancelar el que sube corta SU subida (no confirma nada) y la cola sigue con el siguiente. Un archivo que falla sale de la caja con su motivo y los demás siguen. Más de 12 archivos se recortan a 12 y se dice |
| 79 | Mezclar: elegir una película de «Mis creaciones» y además subir un MP4 de la computadora; luego, desde la hoja, pestaña «Mi computadora» → «Elegir archivos…» con algo marcado | Conviven en la misma unión, en el orden en que entraron (lo nuevo va AL FINAL, nada se reemplaza). «Elegir archivos…» no pierde lo que habías marcado: se agrega primero y luego se abre el selector. Un servidor que no puede unirlos (p. ej. formatos mezclados: horizontal con vertical) dice **su propio texto**, tal cual, bajo «Iniciar» (que sigue dorado, sin precio y con `aria-disabled`); tocarlo lleva el foco al «+» |
| 80 | 💳 Con 3 videos en la caja y un texto («Únelos en este orden y quita los silencios»): «Iniciar ✦ N»; repetirlo cortando la conexión justo al pulsar | **Un solo cobro** (vuela «−N» con lo que cobró el servidor); la caja queda vacía; abajo a la derecha: «Ya estamos uniendo y editando tus 3 videos. Sigue el avance en «Tus trabajos».». En «Mis creaciones» aparece la copia como **«Edición · Editando…»** con el título que el servidor le puso y «Copia de …» (sin enlace hasta que esté lista); los originales siguen intactos. Si la respuesta nunca llegó (sin red / 504) la caja **conserva todo** y reintentar manda la MISMA clave de pedido: el servidor no cobra dos veces. Con el saldo corto: «Tienes ✦ S: no alcanza para editar estos videos.» y «Te faltan ✦ N · Recargar» |
| 81 | Mientras corre la copia: mirar «Tus trabajos» (ábrelo con la píldora); esperar a que termine | La ficha dice «La IA edita {título}», los **tres pasos** (Entender · Editar · Vista previa) con el actual marcado (con texto, no solo color), «Pediste: …» con tu instrucción y «Llevas m:ss. Puedes cerrar esta pestaña: sigue en la nube.» (el tiempo corre solo cada segundo sin que la ficha parpadee ni te quite el foco). Al terminar la bandeja se abre sola: **«Tu video editado está listo»** con el resumen del servidor (p. ej. «Unimos 3 videos · 10:54 → 10:21»), «Ábrelo en el editor para revisar los cortes y renderizarlo.», **«Abrir el editor»** (`/editor/<copia>/`) y «Cerrar»; «Edición · Listo» en «Mis creaciones» |
| 82 | 💳 Una copia que falla de nuestro lado; luego «Reintentar»; y con el saldo corto, otra vez «Reintentar» | La ficha sale en rojo y se anuncia (`role=alert`), en **tres partes**: Qué pasó · Tus créditos («Te devolvimos ✦ N.») · Qué sigue («Tus videos originales no se tocaron. Reintentar vuelve a cobrar ✦ N.»), con «Reintentar» y «Cerrar». La píldora sube de nuevo (se devolvió lo cobrado). «Reintentar» vuelve a cobrar lo que dice «Qué sigue» sobre la MISMA copia (no crea otra); sin saldo dice «Te faltan ✦ N ·» con «Recargar» solo si la recarga está abierta |
| 83 | Abrir `/editor/<copia>/` de una unión de varios videos y de una copia de uno solo; abrir además el editor de un proyecto que NO es copia; ventana de 1100 px | Bajo el encabezado, en **su propia fila**: «Copia de «{primero}» y N más. Tus originales no se tocan.» (con uno: «Copia de «x». Tu original no se toca.»; la lista completa al pasar el cursor) y el nombre del proyecto pasa a ser el **título** de la copia (si es largo se corta con puntos suspensivos). **Los botones del encabezado (Guardar, Render, Publicar) no se mueven** en 1100 px. Un proyecto que no es copia se ve **exactamente igual que antes**, sin esa fila |
| 84 | Teléfono (390 px y 320 px): la caja con tres videos, el menú del «+» abierto y la hoja con tarjetas marcadas | Nada se sale de la pantalla ni se desplaza de lado. Cada fila de la unión mide al menos 44 px y sus botones Subir, Bajar y Quitar, 44 × 44; a 390 px caben en la misma línea que el nombre y **a 320 px pasan juntos a la línea de abajo** (el nombre no se aplasta). El menú se abre hacia arriba cuando la unión ya es alta y cabe en la pantalla. La hoja cabe entera: tarjetas de 2 columnas, «Cancelar» y «Usar N videos» de 44 px a la vista, pestañas de 44 px |
| 85 | Con «reducir movimiento» activo en el sistema: abrir el menú, la hoja, marcar, reordenar y subir un archivo | Nada se queda moviéndose (ni barras, ni fundidos de la hoja, ni la barra de subida infinita); la información se entiende igual |

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
| 9 | En una con varias mediciones: «Ver el resto» | Sobre la tabla, las barras de vistas crecen desde la base una detrás de otra y cada cifra sale al final; «Ocultar el resto» y «Ver el resto» otra vez: ya no crecen. En el teléfono, si la gráfica queda abajo, crece cuando llegas con el scroll. Con «reducir movimiento», completa desde el principio |

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
