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

## inicio · `/estudio/` (una página por nivel)

**Desde el 22-oct-2026 (rutas por nivel) se empieza por los pasos N1 a N24**: el
recorrido por las páginas de nivel con el ratón y con el teclado, la caja en sus
tres direcciones, Central, Automatizaciones, Blotato conectado y sin conectar, las
direcciones de antes (marcadores) y el 404. Ninguno cobra. Después vienen los
pasos de siempre de la caja.

Antes vivía en `/estudio/` (la clásica) y, del 14 al 22-oct-2026, en `/estudio/inicio/`. Con una cuenta que ya tiene cosas y con una nueva, en el
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
«Volver a …» (desde las rutas por nivel, tampoco el de la página de donde se
llegó: los pasos N1 a N24 de abajo); y el 71 a 73 son lo nuevo de
esa ronda (el botón «Iniciar» de Edición con el ancho del selector de modelo, y la
frase de ayuda que ya no se ve). **El 53b (20-oct-2026)** es el área Automatizaciones ya
encendida: Distrito con el Constructor y el Asistente, y «Tus automatizaciones» todavía sin
pantallas (no cobra). Los pasos marcados 💳 gastan créditos reales y solo se
corren con el «sí» del dueño; el resto no cobra.

### Por páginas de nivel (22-oct-2026): empieza aquí

Cada nivel es su propia página, con su dirección y su título en la pestaña del
navegador (`docs/migracion/inicio.md` § «Rutas por nivel»). Ninguno de estos
pasos cobra. «La barra» es la barra de direcciones del navegador.

| # | Paso | Qué tiene que pasar |
|---|---|---|
| N1 | Abrir `/estudio/` en el escritorio (1100 px), sin tocar nada | La barra dice `/estudio/` y la pestaña, «Estudio de video». «Irremplazables» arriba, en dorado, y debajo «Elige un área» con la X: Marketing, Producto, Central (al centro), Ventas y Automatizaciones. **Ninguna ficha se ve elegida** (ni «Estás aquí» ni otro tono); no hay migas ni «Volver a …». La caja y «Mis creaciones» no están en esta página. Si hay algo en curso, «Tus trabajos» abajo a la derecha, como siempre |
| N2 | Con el ratón: pasar el cursor por Marketing, Central y Automatizaciones (mira la dirección que el navegador enseña abajo); Ctrl+clic (o la rueda) en Marketing; clic en Producto y en Ventas | Las tres son **enlaces**: `/estudio/marketing/`, `/estudio/central/`, `/estudio/automatizaciones/`; Ctrl+clic abre Marketing en otra pestaña. Producto y Ventas no son enlaces: dicen «Próximamente» y el clic no hace nada |
| N3 | Clic en Marketing | Carga otra página (con el fundido de siempre): la barra dice `/estudio/marketing/` y la pestaña «Estudio de video · Marketing». «Elige un grupo» con Distrito (Imagen · Video · Edición), Blotato y Avanzado; **ninguna dice «Estás aquí»**. Bajo el título, centrada, la miga «Marketing» |
| N4 | Clic en Distrito | `/estudio/marketing/distrito/`, pestaña «Estudio de video · Marketing · Distrito». Título «Distrito» y **una lista de tres tarjetas: Imagen, Video y Edición**, con su ícono y su nombre (todavía no es la caja). Migas «Marketing › Distrito» |
| N5 | Clic en Video | `/estudio/marketing/distrito/video/`, pestaña «… · Distrito · Video». La caja «¿Qué vamos a crear hoy?» en su tarjeta, con Video marcado en el riel y las migas «Marketing › Distrito» arriba, dentro de la tarjeta; debajo, «Mis creaciones» (o los tres caminos, si la cuenta es nueva) |
| N6 | En la caja, escribir algo en Video; tocar «Imagen» en el riel, luego «Edición», luego otra vez «Video» | En cada cambio la barra pasa a `…/imagen/`, `…/edicion/` y `…/video/`, y la pestaña del navegador dice « · Imagen», « · Edición», « · Video», **sin recargar** (la página no parpadea). Al volver a Video lo escrito sigue ahí |
| N7 | Con la caja en Edición: recargar (F5); luego copiar la dirección y pegarla en otra pestaña | Las dos abren la caja **en Edición** (la pestaña que dice la dirección), vacía |
| N8 | Desde la caja: «Atrás» del navegador tres veces; luego «Adelante» una vez | Sube un nivel cada vez: la lista de Distrito, las opciones de Marketing y el mapa, cada una con su título. Los cambios de pestaña del paso N6 no cuentan: el primer «Atrás» no va a otra pestaña de la caja. «Adelante» baja a las opciones de Marketing |
| N9 | En la caja, escribir un texto; tocar la miga «Distrito»; volver a la caja por Distrito → Video. Repetir en Edición con un video subiéndose (el «+» → un MP4 grande) y tocar la miga «Marketing» | La miga «Distrito» lleva a las **opciones de Marketing** (`/estudio/marketing/`), no a la lista. **Al volver, la caja está vacía**: salir de la caja descarta lo escrito, sin aviso (es lo decidido). Con la subida a medias, antes de salir el navegador pregunta si quieres salir de la página (la misma pregunta de cerrar la pestaña); si sales, esa subida se pierde, sin cobrar nada |
| N10 | Esc: abrir `/estudio/marketing/` y, sin tocar nada, pulsar Esc; «Atrás»; luego Esc en `/estudio/`, en `/estudio/marketing/distrito/`, en `/estudio/marketing/blotato/` y en la caja con texto escrito | En las opciones de Marketing, Esc lleva al mapa (también sin haber tocado nada) y «Atrás» te regresa a ellas. En el mapa, en las dos listas y en la caja **no pasa nada** (la caja no borra lo escrito). Lo mismo en `/estudio/central/` y `/estudio/automatizaciones/`: Esc lleva al mapa |
| N11 | Solo con el teclado, desde `/estudio/`: Tab hasta Marketing y Enter; Tab hasta Distrito y Enter; Tab hasta Video y Enter; en la caja, Tab hasta la miga «Marketing» y Enter | Cada Enter abre la página siguiente. En el mapa el orden de Tab es Marketing, Producto, Central, Ventas, Automatizaciones (Producto y Ventas también paran, y el lector de pantalla las dice no disponibles). Cada página nueva empieza con el foco al principio, sin saltar a ningún título. Las migas se alcanzan con Tab y Enter las sigue (la de «Marketing» lleva al mapa). El anillo ámbar se ve en cada parada |
| N12 | Con la ventana a 390 px de ancho (o el modo teléfono de las herramientas del navegador): doble clic rápido en la ficha Marketing del mapa; luego, en Distrito, doble clic rápido en la tarjeta «Imagen» y, de vuelta en Distrito, en «Video» | Se queda en las opciones de Marketing: el segundo clic no abre Distrito, aunque la tarjeta «Distrito» quede justo donde estaba la ficha. En la caja pasa lo mismo: el segundo clic no abre «Crear una imagen ▾» (en Imagen) ni el selector de modelo (en Video), aunque queden bajo el dedo. Un clic normal, pasado el medio segundo, sí abre cada cosa |
| N13 | Central: mapa → Central → Distrito; tocar Preguntas sobre la clase; luego Central → Deepseek | `/estudio/central/` con Distrito y Deepseek. En `/estudio/central/distrito/`, **COI y Biblioteca de prompts** son enlaces (`/estudio/central/distrito/coi/` y `/estudio/central/distrito/biblioteca/`); Preguntas sobre la clase y Glosario IA salen quietas con «Próximamente» y el clic no hace nada. `/estudio/central/deepseek/` dice «Deepseek» y «Todavía no está disponible.» |
| N14 | Automatizaciones: mapa → Automatizaciones → Distrito; luego → Tus automatizaciones | `/estudio/automatizaciones/distrito/`: **Constructor** y **Asistente** son enlaces (`/estudio/automatizaciones/distrito/constructor/` y `/estudio/automatizaciones/distrito/asistente/`); «Actualizar flujos» sale quieta con «Próximamente», sin botón de conectar Blotato. `/estudio/automatizaciones/tus/`: «Tus automatizaciones» y «Todavía no está disponible.» |
| N15 | Teclear `/estudio/producto/` y `/estudio/ventas/` | Su página existe (no es un error): el nombre del área y «Todavía no está disponible.»; Esc lleva al mapa |
| N16 | Cuenta SIN Blotato: mapa → Marketing → Blotato; tocar una tarjeta; pegar una clave buena | `/estudio/marketing/blotato/`: arriba **«Conecta tu cuenta de Blotato»**; las tres tarjetas en gris con «Conecta tu Blotato para usarlo». El clic abre el diálogo «Conecta tu Blotato» en vez de navegar. Con la clave buena las tres se encienden y el botón pasa a verde, «Blotato conectado: ver o cambiar», sin salir de la página |
| N17 | Cuenta CON Blotato: mapa → Marketing → Blotato; luego Marketing → Avanzado (con y sin Blotato) | El botón dice «Blotato conectado: ver o cambiar» y las tres tarjetas llevan a Agenda, Competencia y Métricas. En `/estudio/marketing/avanzado/` no hay botón de conectar; sin Blotato solo «Publicaciones automáticas» sale en gris y su clic ofrece conectar |
| N18 | Desde Agenda (`/estudio/marketing/blotato/agenda/`): tocar la miga «Marketing»; «Atrás»; tocar la miga «Blotato». Repetir desde MIX, COI y el Constructor | «Marketing» lleva al mapa (`/estudio/`) y «Blotato» a las opciones de Marketing (`/estudio/marketing/`): sin parámetros en la barra, sin «Volver a Agenda…» y sin «Estás aquí». Para regresar a Agenda, «Atrás». Desde MIX, «Avanzado» lleva a `/estudio/marketing/`; desde COI (`/estudio/central/distrito/coi/`), «Central» al mapa y «Distrito» a `/estudio/central/`; desde el Constructor (`/estudio/automatizaciones/distrito/constructor/`), «Distrito» a `/estudio/automatizaciones/` |
| N19 | Marcadores de antes (pegarlos en la barra): `/estudio/inicio/`, `/estudio/inicio/?prompt=hola`, `/estudio/?brief=Un%20video`, `/estudio/?blotato=conectar`, `/estudio/inicio/?desde=mkt.blotato.agenda&ver=grupos`, `/estudio/coi/`, `/coi.html`, `/estudio/biblioteca/?ver=mios`, `/biblioteca.html`, `/estudio/constructor/`, `/constructor.html`, `/estudio/asistente/`, `/asistente.html` y `/estudio/agenda/` | `/estudio/inicio/` acaba en el mapa, `/estudio/`. `/estudio/coi/` y `/coi.html` acaban en COI, con la barra en `/estudio/central/distrito/coi/`. `/estudio/biblioteca/?ver=mios` acaba en la Biblioteca abierta en «Míos», con la barra en `/estudio/central/distrito/biblioteca/?ver=mios`; `/biblioteca.html`, en la Biblioteca, con la barra en `/estudio/central/distrito/biblioteca/`. `/estudio/constructor/` y `/constructor.html` acaban en el Constructor, con la barra en `/estudio/automatizaciones/distrito/constructor/` (y el borrador que tenías, intacto: vive en este navegador, no en la dirección). `/estudio/asistente/` y `/asistente.html` acaban en el Asistente, con la barra en `/estudio/automatizaciones/distrito/asistente/`. `/estudio/agenda/` acaba en la Agenda, con la barra en `/estudio/marketing/blotato/agenda/`. `?prompt=hola` acaba en la caja **en Imagen** con «hola» escrito y la barra en `/estudio/marketing/distrito/imagen/` (sin el `?prompt=`); `?brief=` en la caja **en Video** con su texto. `?blotato=conectar` acaba en Marketing › Blotato con el diálogo de conectar abierto. `?desde=…&ver=…` acaba en el mapa, sin nada abierto ni marcado y con la barra limpia (`/estudio/`). Nada de esto crea ni cobra |
| N20 | Desde el editor de cortes, y desde Agenda, Métricas o MIX (las nuevas y las clásicas, `/agenda.html`…), «Conectar Blotato» | Llega a `/estudio/marketing/blotato/?blotato=conectar` con el diálogo de conectar abierto |
| N21 | Direcciones tecleadas a mano: `/estudio/marketing` (sin barra), `/estudio/Marketing/`, `/estudio/marketing/distrito/Video` | Llegan a la página, con la dirección corregida en la barra (`/estudio/marketing/`, `/estudio/marketing/distrito/video/`) y sin ningún error |
| N22 | Una dirección que no existe: `/estudio/nada/` y `/estudio/marketing/nada/`. Luego Tab por la página | Una página, oscura como todas (no en blanco ni un texto `{"detail":…}`): «No encontramos esa página», «La dirección no existe o cambió de lugar.» y dos enlaces, «Subir un nivel» e «Ir al inicio». En `/estudio/marketing/nada/`, «Subir un nivel» lleva a `/estudio/marketing/`; en `/estudio/nada/`, al mapa. «Ir al inicio» lleva al mapa. Tab llega a los dos enlaces |
| N23 | Teléfono (390 px y, si se puede, 320 px): `/estudio/`, `/estudio/marketing/`, `/estudio/marketing/distrito/`, `/estudio/marketing/blotato/`, `/estudio/central/distrito/` y la caja | Ninguna página se arrastra de lado. El mapa es la «X compacta»; «Automatizaciones» y «Próximamente» caben en una línea; las fichas, tarjetas y migas se tocan sin errar (44 px o más). «Irremplazables» está en el mismo lugar en todas |
| N24 | Con «reducir movimiento» activo en el sistema: del mapa a Marketing, a Distrito y a la caja con clics | Las páginas cambian sin fundido y nada se queda moviéndose (en Edición, la pista queda fija en la primera idea) |

### La caja y lo de siempre

Los pasos de abajo son anteriores a las rutas por nivel. Donde decían «el
inicio» se lee hoy «la caja» (`/estudio/marketing/distrito/<pestaña>/`) o «el
mapa» (`/estudio/`); los que describían el inicio de una sola página se
reescribieron (11, 14, 15, 43, 49, 51, 58 a 63, 66, 67, 88 y 89) o se retiraron
(52 y 65).

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
| 11 | Desde el editor, «conectar Blotato» | Llega a Marketing › Blotato (`/estudio/marketing/blotato/`) con el diálogo abierto (ver N20) |
| 12 | Modo avión y recargar la caja | «No pudimos traer tus proyectos» con Reintentar; no aparecen los tres caminos |
| 13 | «Tus trabajos» con un render en curso | El cuadro de siempre, abajo a la derecha |
| 14 | Teclear `/ui/clasica?pantalla=inicio` (el enlace «Usar la versión anterior» se quitó el 28-sep); luego, en el clásico, ir a otra pantalla y volver con «← Estudio»; cerrar sesión y entrar de nuevo | Llega a `/index.html`, el inicio clásico; durante 7 días `/index.html` ya no te redirige (sin la cookie va a `/estudio/`) y **`/estudio/` te lleva al clásico** (`/index.html`, con lo que traiga la dirección): «← Estudio» y el login te dejan en el clásico, no en el mapa nuevo. `/ui/nueva?pantalla=inicio` borra la cookie y te lleva a `/estudio/`, el mapa |
| 15 | En la caja (mapa → Marketing → Distrito → Video, o directo `/estudio/marketing/distrito/video/`), tocar «Edición» del riel; mirar la barra | Tres botones: Imagen · Video · Edición (la caja sigue arrancando en Video); la barra pasa a `…/distrito/edicion/`. Aparecen el campo «Cuéntale a la IA qué quieres» (en su cuadro con borde, con la pista gris «Cuéntale a la IA qué quieres. Ejemplo: «Quita muletillas y silencios»»; **ya no hay una fila de ideas debajo**), el «+», el chip «Editar ▾» junto al «+» e «Iniciar» sin precio y **dorado**. **Debajo ya no hay ninguna frase** (antes, «Escribe qué quieres hacer con tu video.»): solo la oye quien usa lector de pantalla, como la descripción de «Iniciar» mientras no hay texto |
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
| 43 | Abrir `/estudio/` en el escritorio (1100 px) sin tocar nada | **Aterrizas en el mapa:** «Irremplazables» arriba (único título, en negritas y en **dorado con degradado**, más claro arriba y más hondo abajo; se lee bien, sin icono) y, debajo, «Elige un área» con la X de las cinco áreas, **sin ningún cuadro alrededor** y **centrada** (arriba y abajo queda un hueco parecido). **Ninguna ficha se ve elegida**: ni «Estás aquí», ni un tono distinto en Marketing; Marketing y Central se ven iguales. **No hay «Volver a …»**, ni migas, ni menú o columna a la izquierda, y «Editor de videos» no sale en ninguna parte. La caja y «Mis creaciones» no están en esta página. Para llegar a la caja: Marketing → Distrito → Video (N1 a N5). En una cuenta nueva, «Desde tu metraje → Subir metraje» (ya con la caja a la vista) sigue llevando a `/e1.html` |
| 44 | En «Imagen», «Video» y «Edición», mirar dónde se escribe | En las tres, un cuadro con borde bien visible y fondo un poco más claro que la caja; el ejemplo en gris legible. Un clic en cualquier parte del cuadro (no solo en las líneas con letra) pone el cursor para escribir |
| 45 | Tab hasta el campo en cada familia | **Un solo** anillo ámbar, alrededor del cuadro entero (no uno dentro de otro) |
| 46 | En «Edición»: mirar la fila de abajo y tocar «Editar ▾» | El chip está junto al «+», como «Un video corto ▾» en Video; abre una lista con **DOS opciones** («Editar · según el video», la de ahora, y «De videos a Shorts · según el video»; ver los pasos 67 a 70); elegir la de ahora solo cierra la lista; Esc la cierra y el foco vuelve al chip; Tab la cierra y el foco sigue al «Iniciar» (Shift+Tab, al «+»), nunca se pierde. Lo mismo en Imagen y Video. Al pasar el ratón (o enfocar el chip con Tab) sale una pista con lo que hace la opción de ahora —en Edición, «Sube tu metraje y la IA te propone el corte. Se edita una copia: tu original se queda como está.»; en Imagen y Video, la nota de su opción— y se ve entera, también a 390 px. No hay chip de modelo ni de duración |
| 47 | Teléfono (390 px), pestaña «Edición» | «+» y «Editar ▾» van en la misma fila arriba; «Iniciar» abajo a todo el ancho (igual que el selector de modelo en Video); nada se sale de la pantalla; con la lista abierta, tampoco |
| 48 | «Iniciar» en cada estado: sin video, con video y sin texto, con todo, sin saldo | Siempre **dorado** (nunca gris ni discontinuo); lo que cambia es lo que dice («Iniciar» o «Iniciar ✦ N»), la nota de abajo y qué hace al pulsarlo (avisa, lleva el foco al campo o al «+», o cobra solo cuando está todo) |
| 49 | Escritorio: en la caja, tocar la miga «Marketing» | Se abre **otra página**, `/estudio/`, con **«Elige un área»**: el mapa en X con las cinco áreas (Marketing, Producto, Central en el centro, Ventas, Automatizaciones) y dos diagonales punteadas por detrás de las fichas que no tapan ningún texto. **Ninguna ficha dice «Estás aquí»** ni se ve distinta. **No aparece ningún «Volver a …»** y en el mapa **no hay migas**. «Irremplazables» no se movió de lugar. La caja ya no está (era otra página): con ella se fueron «Mis creaciones», lo de debajo y lo escrito; la tarjeta se va (el mapa no tiene cuadro alrededor) |
| 50 | En el mapa, tocar Producto y Ventas | No pasa nada: el mapa se queda como estaba. Se ven apagadas con «Próximamente» (fondo más hundido, texto gris legible), pero sí reciben el foco con Tab y el lector de pantalla las anuncia como no disponibles. **Automatizaciones ya no es una de ellas** (20-oct-2026): se ve igual que Marketing y Central (sin «Próximamente» ni tono distinto) y se abre; ver el paso 53b |
| 51 | En el mapa, tocar Marketing | Se abre **«Elige un grupo»** con tres tarjetas: **Distrito** (Imagen · Video · Edición), **Blotato** (Agenda tus publicaciones · Investiga tu competencia · Ver mis métricas) y **Avanzado** (Publicaciones automáticas · Copiadora de estilos), sin cuadro alrededor y centradas; debajo del título, centrada, la miga «Marketing»; la barra dice `/estudio/marketing/`. **Ninguna dice «Estás aquí»**, aunque vengas de la caja o de una lista. Tocar Distrito abre la lista Imagen · Video · Edición (`/estudio/marketing/distrito/`), no la caja |
| 52 | *Retirado el 22-oct-2026* | Pedía comprobar que mirar otra área no te sacaba de la caja escondida y que al volver seguía con su texto. Ya no hay caja escondida: salir de la caja descarta lo escrito (N9) y Esc en las opciones sube al mapa (N10) |
| 53 | Central → Distrito, y luego Central → Deepseek | Distrito: la lista COI, Biblioteca de prompts, Preguntas sobre la clase y Glosario IA. **COI y Biblioteca de prompts son enlaces** a su pantalla (16-oct-2026); Preguntas y Glosario siguen apagadas con «Próximamente», sin enlace ni nada que hacer (el clic no hace nada). Deepseek dice «Próximamente» en su tarjeta y, al abrirla, «Todavía no está disponible.» bajo su título |
| 53b | Mapa → Automatizaciones; luego Distrito, y después Automatizaciones → Tus automatizaciones | Se abre **«Elige un grupo»** con dos tarjetas: **Distrito** (Constructor · Asistente · Actualizar flujos) y **Tus automatizaciones** («Próximamente»). En Distrito, la lista: **Constructor** y **Asistente** son enlaces a `/estudio/automatizaciones/distrito/constructor/` y `/estudio/automatizaciones/distrito/asistente/`; «Actualizar flujos» sale apagada con «Próximamente», sin enlace y sin nada que hacer (el clic no hace nada). «Tus automatizaciones» no tiene pantallas: dice «Todavía no está disponible.» bajo su título. Lo cubre `web/e2e/inicio-recorrido.spec.ts` (que no corre en CI), pero ver la ficha y la lista con tus ojos es de este paso |
| 54 | Cuenta SIN Blotato: mapa → Marketing → Blotato | Arriba, el botón **«Conecta tu cuenta de Blotato»**; debajo las tres tarjetas en gris (menos opacidad) con «Conecta tu Blotato para usarlo». El clic en cualquiera NO navega: abre el diálogo «Conecta tu Blotato» con el aviso del cobro antes del campo. Pegar una clave buena enciende las tres y el botón pasa a verde, «Blotato conectado: ver o cambiar»; el recorrido no se movió |
| 55 | Cuenta CON Blotato: mapa → Marketing → Blotato | El botón dice **«Blotato conectado: ver o cambiar»** (verde) y abre el diálogo «Tu Blotato» con las redes. Las tres tarjetas están encendidas y cada una lleva a su pantalla (Agenda, Competencia, Métricas) |
| 56 | Con el estado de Blotato sin poder saberse: en las herramientas del navegador, bloquear la petición `/api/blotato` y recargar el inicio; abrir Blotato y Avanzado | **Nada se apaga**: ninguna tarjeta está en gris ni dice «Conecta tu Blotato», y un clic navega. (Dejar sin sus herramientas a quien sí paga porque una consulta no respondió es peor que dejar entrar a quien no) |
| 57 | Mapa → Marketing → Avanzado (con y sin Blotato) | Dos tarjetas: «Publicaciones automáticas» (MIX) y «Copiadora de estilos». Sin Blotato solo MIX sale en gris y su clic abre conectar; la Copiadora no se apaga. **No hay botón de conectar** en Avanzado (no todo el grupo depende de Blotato). «De videos a Shorts» no está en ninguna lista |
| 58 | Abrir `/estudio/marketing/blotato/agenda/` y tocar «Marketing» en las migas (junto a «← Estudio»); «Atrás»; luego tocar «Blotato» | «Marketing» lleva al mapa, `/estudio/`, **sin «Estás aquí» ni «Volver a Agenda…»**; «Blotato» lleva a las opciones de Marketing, `/estudio/marketing/`, sin ninguna tarjeta marcada. La barra no lleva `?desde=`. Para regresar a Agenda: «Atrás» (no hay «Volver a …» y Esc no regresa a Agenda: en las opciones sube al mapa) |
| 59 | Lo mismo desde Competencia, Métricas, MIX y la Copiadora de estilos; y abrir Admin, Crear, Subir, Clip, Imágenes y Shorts | Cada hoja dice su propio camino (MIX y la Copiadora: «Marketing › Avanzado»; las otras tres: «Marketing › Blotato») y sus migas llevan a `/estudio/` y a `/estudio/marketing/`, sin «Volver a …». Admin, Crear, Subir, Clip, Imágenes y Shorts **no** traen migas: solo «← Estudio». A 320 px las migas pasan a una segunda fila sin salirse |
| 60 | Escribir a mano `/estudio/inicio/?desde=mkt.nada.nada&ver=mapa` (y otra con `ver=otra`); luego la misma con `&blotato=conectar` al final | Acaba en el mapa, sin ningún error ni «Volver a …», con la barra en `/estudio/` (sin `?desde=` ni `?ver=`). Con `&blotato=conectar` acaba en Marketing › Blotato con el diálogo de conectar abierto |
| 61 | Esc en cada nivel (ver también N10): en el mapa, en las opciones de Marketing recién cargadas (sin tocar nada), en la lista de Distrito o de Blotato y en la caja; luego con el diálogo de Blotato abierto y con la lista de «Editar ▾» abierta | **En las opciones de un área, Esc lleva al mapa** (otra página: «Atrás» te regresa). En el mapa, en una lista y en la caja no hace nada (la caja no borra lo escrito). Con el diálogo de Blotato abierto, Esc cierra solo el diálogo y devuelve el foco a su botón; con la lista de «Editar ▾» abierta, cierra solo la lista |
| 62 | Teclado: en `/estudio/`, Tab y Shift+Tab; Enter en una ficha; en la página que abre, Tab hasta una tarjeta de grupo y Enter | El orden es el de lectura: Marketing, Producto, Central, Ventas, Automatizaciones (Producto y Ventas, apagadas, también paran y el lector las anuncia como no disponibles); en el mapa no hay migas ni «Volver a …» que tabular. Enter en una ficha o en una tarjeta abre su página; cada página nueva empieza con el foco al principio, sin saltar a ningún título, y Tab sigue desde ahí. El anillo ámbar se ve en cada parada |
| 63 | A 390 px (como N12; en el escritorio no cae nada bajo la ficha y no hay qué medir): doble clic rápido en la ficha de Marketing del mapa | Se abre la página de Marketing (`/estudio/marketing/`) y **se queda ahí**, en «Elige un grupo»: el segundo clic no elige un grupo por accidente. Un clic normal pasado el medio segundo (o Enter) sí elige |
| 64 | Teléfono (390 px y, si se puede, 320 px): abrir el inicio (el mapa), Marketing, Blotato, Central, Automatizaciones | El mapa es la **«X compacta»**: dos columnas, Central como una banda de ancho completo en medio y trazos punteados cortos hacia ella, **centrada** en la pantalla y sin cuadro alrededor. «Automatizaciones» (ya sin «Próximamente») y el «Próximamente» de Producto y Ventas salen en una sola línea, sin cortarse; las fichas se tocan sin errar; las tres opciones se apilan en una columna; **la página no se arrastra de lado a 320 px**; el título dorado se lee entero y está en el mismo lugar en todos los pasos. Con la caja, la tarjeta baja del título (no queda pegada arriba) y el riel (Imagen · Video · Edición) va horizontal |
| 65 | *Retirado el 22-oct-2026* | Pedía que la caja conservara todo al ir y volver por el mapa (la caja escondida). Hoy salir de la caja a un nivel superior descarta lo escrito y la subida (con una subida a medias, el navegador pregunta antes); cambiar de pestaña dentro de la caja sí conserva todo: N6 y N9 |
| 66 | Con proyectos o imágenes hechos: abrir `/estudio/`, Marketing, Distrito, una lista de Blotato y luego la caja (Video) | «Mis creaciones» (con su filtro y su «Ver más») y lo de debajo solo salen en la caja, nunca en el mapa, las opciones ni las listas. A quien empieza, «Tu primer video, en tres caminos» tampoco le sale fuera de la caja |
| 67 | Edición → «Editar ▾» → «De videos a Shorts» | El chip dice «De videos a Shorts ▾» y el cuerpo cambia: «Sube un video largo o pega la liga de YouTube y te proponemos los mejores momentos como shorts.», el campo **«Liga de YouTube»**, el «+» y **«Iniciar» dorado SIN precio**; debajo «Subirlo no cuesta nada: el precio aparece cuando termina de subir.». La pista de ideas no rota en este modo. Cambiar a «Video» y volver: sigue en Shorts y con la liga escrita (salir de la caja, en cambio, lo descarta) |
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
| 78 | «+» → «Subir de tu computadora» y elegir DOS o TRES MP4 a la vez; mientras suben, cancelar el que está subiendo con su ✕ («Cancelar la subida de «x»») | Suben **de uno en uno**: el primero con su barra y «Subiendo… N %», los demás «En cola» (sin barra); «Iniciar» dice «Subiendo…» y la nota «Cuando termine de subir calculamos el precio…». Al terminar el último sale **UN solo precio** con todos. Cancelar el que sube corta SU subida (no confirma nada) y la cola sigue con el siguiente. Un archivo que falla sale de la caja con su motivo **y su nombre** («“dos.mp4”: La subida a la nube falló (500)…», «Se perdió la conexión con “dos.mp4” a los 41 %…») y los demás siguen; si fallan dos, el aviso dice los dos (no se pisan). Más de 12 archivos se recortan a 12 y se dice |
| 79 | Mezclar: elegir una película de «Mis creaciones» y además subir un MP4 de la computadora; luego, desde la hoja, pestaña «Mi computadora» → «Elegir archivos…» con algo marcado | Conviven en la misma unión, en el orden en que entraron (lo nuevo va AL FINAL, nada se reemplaza). «Elegir archivos…» no pierde lo que habías marcado: se agrega primero y luego se abre el selector. Un servidor que no puede unirlos (p. ej. formatos mezclados: horizontal con vertical) dice **su propio texto**, tal cual, bajo «Iniciar» (que sigue dorado, sin precio y con `aria-disabled`); tocarlo lleva el foco al «+» |
| 80 | 💳 Con 3 videos en la caja y un texto («Únelos en este orden y quita los silencios»): «Iniciar ✦ N»; repetirlo cortando la conexión justo al pulsar | **Un solo cobro** (vuela «−N» con lo que cobró el servidor); la caja queda vacía; abajo a la derecha: «Ya estamos uniendo y editando tus 3 videos. Sigue el avance en «Tus trabajos».». En «Mis creaciones» aparece la copia como **«Edición · Editando…»** con el título que el servidor le puso y «Copia de …» (sin enlace hasta que esté lista); los originales siguen intactos. Si la respuesta nunca llegó (sin red / 504) la caja **conserva todo** y reintentar manda la MISMA clave de pedido: el servidor no cobra dos veces. Con el saldo corto: «Tienes ✦ S: no alcanza para editar estos videos.» y «Te faltan ✦ N · Recargar». Si la puerta de enlace se rinde con un error genérico («Algo salió mal (HTTP 503).»), «Mis creaciones» se relee en seguida: si la edición sí salió, su tarjeta «Editando…» aparece sin tener que volver a pulsar «Iniciar». Un 409 «Todavía estamos devolviendo los créditos…» o un 502/503 «Estamos devolviendo lo cobrado» se leen tal cual y NO dejan la caja ocupada |
| 81 | Mientras corre la copia: mirar «Tus trabajos» (ábrelo con la píldora); esperar a que termine | La ficha dice «La IA edita {título}», los **tres pasos** (Entender · Editar · Vista previa) con el actual marcado (con texto, no solo color), «Pediste: …» con tu instrucción y «Llevas m:ss. Puedes cerrar esta pestaña: sigue en la nube.» (el tiempo corre solo cada segundo sin que la ficha parpadee ni te quite el foco; y **tampoco cuando otra ficha cambia** —el avance de un clip que corre al lado—: una ficha de error que no cambió conserva su nodo, su foco en «Reintentar» y no se vuelve a anunciar). Al terminar la bandeja se abre sola: **«Tu video editado está listo»** con el resumen del servidor (p. ej. «Unimos 3 videos · 10:54 → 10:21»), «Ábrelo en el editor para revisar los cortes y renderizarlo.», **«Abrir el editor»** (`/editor/<copia>/`) y «Cerrar»; «Edición · Listo» en «Mis creaciones» |
| 82 | 💳 Una copia que falla de nuestro lado; luego «Reintentar»; y con el saldo corto, otra vez «Reintentar» | La ficha sale en rojo y se anuncia (`role=alert`), en **tres partes**: Qué pasó · Tus créditos («Te devolvimos ✦ N.») · Qué sigue («Tus videos originales no se tocaron. Reintentar vuelve a cobrar ✦ N.»), con «Reintentar» y «Cerrar». La píldora sube de nuevo (se devolvió lo cobrado). «Reintentar» vuelve a cobrar lo que dice «Qué sigue» sobre la MISMA copia (no crea otra); sin saldo dice «Te faltan ✦ N ·» con «Recargar» solo si la recarga está abierta. Aceptado el reintento, **sin recargar la página**: la píldora baja a su saldo nuevo, el «−N» vuela y la tarjeta de «Mis creaciones» pasa de «No se pudo editar» a «Editando…» (y luego a «Listo»). Mientras se están devolviendo los créditos («Estamos devolviendo tus ✦ N.») no hay «Reintentar» |
| 83 | Abrir `/editor/<copia>/` de una unión de varios videos y de una copia de uno solo; abrir además el editor de un proyecto que NO es copia; ventana de 1100 px | Bajo el encabezado, en **su propia fila**: «Copia de «{primero}» y N más. Tus originales no se tocan.» (con uno: «Copia de «x». Tu original no se toca.»; la lista completa al pasar el cursor) y el nombre del proyecto pasa a ser el **título** de la copia (si es largo se corta con puntos suspensivos). **Los botones del encabezado (Guardar, Render, Publicar) no se mueven** en 1100 px. Un proyecto que no es copia se ve **exactamente igual que antes**, sin esa fila |
| 84 | Teléfono (390 px y 320 px): la caja con tres videos, el menú del «+» abierto y la hoja con tarjetas marcadas | Nada se sale de la pantalla ni se desplaza de lado. Cada fila de la unión mide al menos 44 px y sus botones Subir, Bajar y Quitar, 44 × 44; a 390 px caben en la misma línea que el nombre y **a 320 px pasan juntos a la línea de abajo** (el nombre no se aplasta). El menú se abre hacia arriba cuando la unión ya es alta y cabe en la pantalla. La hoja entra entera en la ventana **a las alturas de un teléfono de verdad** (320 × 568, 375 × 553, 360 × 640 y 390 × 664, que el e2e mide con el título, la ✕, la lista, «Cancelar» y «Usar N videos» a la vista): lo que cede es la lista, que se desplaza por dentro; tarjetas de 2 columnas, botones de 44 px, pestañas de 44 px. **De lado (568 × 320)** no cabe: la hoja se desplaza por dentro y «Cancelar» y «Usar N videos» quedan pegados abajo, siempre a la vista. Al pasar el ratón sobre un video marcado el borde se queda ámbar |
| 85 | Con «reducir movimiento» activo en el sistema: abrir el menú, la hoja, marcar, reordenar y subir un archivo | Nada se queda moviéndose (ni barras, ni fundidos de la hoja, ni la barra de subida infinita); la información se entiende igual |
| 86 | 💳 Una copia que falló: cerrar su aviso en «Tus trabajos» (o esperar a que pasen 24 h) y mirar «Mis creaciones»; pulsar «Reintentar ✦ N» de la tarjeta; repetirlo con el saldo corto y con un 409 | La tarjeta roja «Edición · No se pudo editar» **ya no se queda sin salida**: trae «Reintentar ✦ N» (N = lo cobrado; objetivo de 48 px, cabe en 320 px aunque el texto pase a dos líneas; su descripción para el lector de pantalla es el título de la copia). Aceptado: vuela el «−N», la píldora se pone al día y la tarjeta pasa a «Editando…». Sin saldo: «Te faltan ✦ N ·» dentro de la tarjeta; con un 409 o un 502/503: el texto del servidor, tal cual. Un doble clic es UN reintento. Con créditos devolviéndose («Estamos devolviendo tus ✦ N.») no hay botón |
| 87 | Una copia cuya tarea murió sin cerrarse (figura «corriendo» hace más de 2 h; se simula con un `inicio` viejo en `proyectos_editor`), con «Mis creaciones» abierto | Si el servidor ya la soltó al listar (D-15) la tarjeta dice «No se pudo editar» con «Reintentar». Si no, dice **«Edición · Sin respuesta»**, sin `aria-busy` y sin botón, y la pantalla **no relee cinco listas cada 5 s** (en las herramientas de red: sin ráfagas de `/api/proyectos`, `/api/slots`, `/api/imagenes`, `/api/edicion/proyectos` y `/api/clip`). Una copia que corre de verdad sigue «Editando…» y sondeando. Cuando una copia que veías correr termina —también con «Listo» sin cortes y devolución de créditos— la píldora se pone al día sola |
| 88 | Desde la Biblioteca de prompts (pantalla `/estudio/central/distrito/biblioteca/`): elegir un prompt de Imagen con `[huecos]` y pulsar «Llevar a la caja» (1100 px y 390 px) | El inicio abre **directo la caja** (sin pasar por el mapa) en **Imagen › Crear una imagen**, con el prompt puesto, el foco en su cuadro y, sobre él, **«Te trajimos el prompt. Cambia lo que va entre [corchetes] y pulsa Crear.»** Las migas dicen «Marketing › Distrito». La dirección queda en `/estudio/marketing/distrito/imagen/` (sin `?prompt=`). **No se creó ni cobró nada**: la píldora del saldo no se mueve y «Tus trabajos» no tiene nada nuevo. Recargar la página abre la caja **en Imagen**, con el cuadro vacío |
| 89 | Lo mismo con un prompt de Video (sin huecos) y luego con uno de Guion | Video: la caja abre en **Video › Un video corto** (la barra en `/estudio/marketing/distrito/video/`) con el texto y el aviso dice «Te trajimos el prompt. Revísalo y pulsa Crear.». Guion no tiene «Llevar a la caja» (solo se copia). Al teclear en el cuadro el aviso se queda; al vaciar el cuadro o cambiar de pestaña, se va. 💳 «Crear» con ese texto cobra y se porta **igual que con un texto escrito a mano** (modera primero) |

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

## agenda · `/estudio/marketing/blotato/agenda/`

No cobra. Hace falta al menos una publicación programada de prueba, con
destino si la red lo pide (una página de Facebook, por ejemplo). Hazlo en el
teléfono (390 px) y en el escritorio.

| # | Paso | Qué tiene que pasar |
|---|---|---|
| 1 | Entrar | La barra dice `/estudio/marketing/blotato/agenda/` (también si tecleaste la de antes, `/estudio/agenda/`). «N publicaciones programadas» y una tarjeta por publicación: red · cuenta · destino, la fecha en español y los archivos |
| 2 | Doble clic en «Cambiar la hora» | El diálogo se abre y **no** se cierra con el segundo clic; el foco cae en la fecha |
| 3 | Poner una hora dentro del próximo minuto y Guardar | «Falta menos de un minuto…» junto al campo, sin llamada |
| 4 | Poner mañana a esta hora y Guardar | Se cierra; «Hora cambiada: … (tu hora)»; la tarjeta dice la hora nueva; en Blotato también |
| 5 | «Cancelar» en una tarjeta y pulsar Enter | La confirmación nombra red, cuenta, cuándo y texto; Enter = «No, dejarla» (no cancela) |
| 6 | «Cancelar» → «Sí, cancelarla» | «Publicación cancelada.»; la tarjeta se va; el foco queda en Actualizar; en Blotato ya no está |
| 7 | Con más de 20 programadas: «Ver más» | Se añaden al final; sin más páginas, el botón se va |
| 8 | Desconectar Blotato (en Marketing › Blotato) y volver | Aviso con «Conectar Blotato», que lleva a Marketing › Blotato (`/estudio/marketing/blotato/`) con el diálogo de conectar abierto |
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

## COI · `/estudio/central/distrito/coi/`

COI = Contexto · Objetivo · Instrucciones, en **Central › Distrito › COI**. Es **gratis** (0 créditos): la píldora del saldo no se mueve nunca.
Tope de **3 por persona por día**, día de México (se renueva a las 12:00 a. m. de México); solo cuentan las respuestas terminadas. Es una
pantalla nueva: no hay «versión anterior». Cada «Armar COI» de verdad es una llamada al modelo (su costo queda en el log del servidor, en
dólares): pruébala con calma y no más de 3 veces por persona. Hazla en el teléfono (390 px) y en el escritorio.

| # | Paso | Qué tiene que pasar |
|---|---|---|
| 1 | Entrar por Central › Distrito › COI | «Irremplazables» dorado arriba, migas «Central › Distrito › COI» centradas (COI es un chip quieto, no un botón), cuadro grande, «Te quedan 3 de 3 hoy» y **un solo** botón ámbar: «Armar COI» (sin ✦) |
| 2 | Pulsar un ejemplo | Llena el cuadro y el foco queda en él; los ejemplos se esconden al escribir |
| 3 | «Armar COI» con el cuadro vacío | «Escribe primero qué necesitas…» junto al cuadro; no se manda nada |
| 4 | Escribir y pulsar Ctrl+Intro (o Cmd+Intro) | Lo mismo que el botón |
| 5 | Mientras arma | «Armando tu COI…» sin pasos falsos; el botón dice «Armando…»; el contador **no** baja todavía. La caja avisa que si sales antes de que termine, el uso se cuenta igual |
| 6 | Al terminar | El foco va a «Tu COI»; **un solo texto** en un cuadro: #CONTEXTO, #OBJETIVO y #INSTRUCCIONES (con sus siete partes), uno tras otro y con sus encabezados en negritas; el contador baja a «Te quedan 2 de 3 hoy» |
| 7 | Un COI largo (o achicar la ventana) | El cuadro no pasa de un alto máximo y se desplaza **por dentro** (rueda, dedo, o flechas y Re Pág con el cuadro enfocado con Tab); la página no se alarga |
| 8 | «Copiar» y pegar en otro lado | Pega todo el COI con los tres encabezados, en orden; el botón dice «Copiado» un momento y el foco no se mueve |
| 9 | Mirar el texto | No salen asteriscos de negrita (`**`); lo que se pega es el texto de la respuesta tal cual |
| 10 | «Guardar» | Hoja chica: título con la primera frase del objetivo (editable, 80 como máximo) y categoría; «Guardar» → «Guardado en tu Biblioteca» con enlace «Ver en Míos»; **no** baja el contador |
| 11 | Guardar con el internet cortado y reintentar con internet | El error sale en la hoja; el reintento guarda **un** solo prompt (no dos) en «Míos» |
| 12 | Recargar la página | La caja y el resultado vuelven vacíos (no se guardó nada en el navegador); lo guardado sigue en «Míos» |
| 13 | Armar hasta el tercero | Tras el tercero: «Ya usaste tus 3 de hoy», el cuadro y el botón apagados (no es un error), «Se renuevan a la medianoche, hora de México… Faltan X h Y min» y el último COI sigue a la vista para copiarlo |
| 14 | Con los 3 usados, Tab hasta el botón apagado y Enter | No manda nada y el lector de pantalla dice por qué (el cuadro de «Ya usaste tus 3 COI de hoy») |
| 15 | Mismo usuario en dos pestañas: armar en una y, a media espera, armar en la otra | La segunda dice «Ya hay un COI en camino» sin ser error y se desbloquea sola en unos segundos |
| 16 | Escribir algo que la moderación rechace | «No pudimos usar ese texto», con el motivo, junto al cuadro; el foco al cuadro; **no** gasta ninguno |
| 17 | Cortar el internet y «Armar COI» | «No hay conexión»; el texto sigue en el cuadro; el contador se vuelve a leer del servidor |
| 18 | Entrar sin poder leer el contador (servidor caído) y pulsar «Reintentar» con el servicio aún caído | «COI no está disponible ahora» con «Reintentar»; el botón apagado hasta que vuelva. Al pulsar dice «Reintentando…» (y el lector de pantalla lo anuncia); si sigue caído, vuelve «Reintentar». **«No se gastó ninguno de tus usos» sale una sola vez** (o ninguna: aquí nadie intentó armar nada) |
| 19 | Pegar más de 2000 caracteres | «Es muy largo: el máximo es de 2000 caracteres y llevas N»; el botón se apaga |
| 20 | Lector de pantalla: armar y terminar | Anuncia «Armando tu COI…», luego «Tu COI está listo…»; el contador se anuncia al cambiar |
| 21 | «Reducir movimiento» del sistema | El giro de «Armando…» no gira y nada se mueve |
| 22 | Al día siguiente (pasada la medianoche de México) con la pestaña abierta | Sola, tras unos segundos, vuelve «Te quedan 3 de 3 hoy» y el cuadro se enciende |
| 23 | Central › Distrito desde el mapa | COI es un enlace (y también la Biblioteca de prompts); Preguntas y Glosario siguen «Próximamente» |
| 24 | Pantalla a 390 px y a 320 px | Sin desplazamiento horizontal; todo lo que se toca mide 44 px o más (también la ✕ de la hoja de «Guardar» a 320); «Copiar» de cada bloque queda en su sitio |
| 25 | Armar un COI y, **mientras llega otro** («Armar otro COI»), pulsar «Guardar» del viejo | «Guardar» está apagado (se puede enfocar y dice por qué); no abre la hoja. Al llegar el nuevo vuelve a funcionar y guarda **el nuevo** |
| 26 | Armar y, a media espera, recargar o cerrar la pestaña | El navegador pregunta antes de salir (en iOS Safari no pregunta). Si sales igual, al volver el contador bajó y no hay resultado: no se guardó nada |
| 27 | Tener la Biblioteca llena (100 «Míos») y pulsar «Guardar» | Dice que está llena y «Abre tu Biblioteca en otra pestaña para borrar alguno»: el enlace abre OTRA pestaña y el COI sigue en esta |
| 28 | Que el servidor conteste «demasiados intentos» (muchos intentos seguidos que no salieron) | «Por hoy ya no podemos intentarlo más» con el texto del servidor y «Faltan X h Y min»; la entrada y el botón apagados; el contador sigue en «Te quedan 3 de 3» (no se gastó ninguno) y NO dice «Ya usaste tus 3»; no es un error. Pasada la medianoche de México, vuelve sola |
| 29 | Escribir algo con un carácter que el servidor no acepta | El texto del servidor, tal cual, junto al cuadro y con el foco en él; escribir lo quita |
| 30 | Un COI tan largo que la Biblioteca no lo guarda | «Este COI es demasiado largo para guardarlo en tu Biblioteca. Cierra esta hoja y usa «Copiar» para llevártelo.» (sin nombres de campos ni cifras) |

## biblioteca · `/estudio/central/distrito/biblioteca/`

(pantalla nueva, Ajustes 3: **Central › Distrito › Biblioteca de prompts**; sin versión anterior). No cobra: copiar, fijar, borrar uno
propio y «Llevar a la caja» son gratis. Hazla en el teléfono (390 px) y en el escritorio (1100 px o más), con tu usuario de verdad y
cada paso con el servidor de verdad (la web se probó con un API de mentira: `web/e2e/biblioteca.ts`).

| # | Paso | Qué tiene que pasar |
|---|---|---|
| 1 | Entrar por el mapa: Central › Distrito › «Biblioteca de prompts» | La barra dice `/estudio/central/distrito/biblioteca/`. «Irremplazables» arriba (dorado, sin ícono, fuera de tarjeta) y las migas **Central › Distrito › Biblioteca de prompts** centradas. «Central» y «Distrito» llevan al mapa (`/estudio/`) y a las opciones de Central (`/estudio/central/`), sin «Volver a …»: para regresar a la Biblioteca, «Atrás» |
| 2 | Mirar la pantalla a 1100 px | Dos paneles: a la izquierda conmutador «De la casa / Míos», la franja **«Tus 3 fijados»**, buscador, categorías con su número y la lista (se desplaza por dentro); a la derecha el prompt completo con **un solo botón ámbar** («Llevar a la caja» si lo hay; «Copiar» si no). Nada se arrastra de lado |
| 3 | Mirar la pantalla a 390 px | Dos pasos, «1 Elige» y «2 Úsalo». Tocar un prompt pasa al 2 y deja el foco en su título; «Volver a la lista» regresa a esa fila. Todo mide al menos 44 px; las migas caben en una línea (sin íconos) |
| 4 | Buscar «ilustracion» (sin tilde) y «ILUSTRACIÓN» | Los dos traen «Ilustración plana…». Buscar una etiqueta, una palabra del «para qué sirve» o «investigacion» también encuentra. Sin coincidencias: «No encontramos ese prompt» con «Diseñar uno con COI» y «Quitar filtros» |
| 5 | Pulsar una categoría y luego buscar | Los números de las categorías siguen a la búsqueda; el resumen dice «N resultados para «…» en Video» |
| 6 | Tab desde el buscador | **Una sola parada** en toda la lista; ↑ ↓ Inicio y Fin mueven el foco, Enter elige; Tab sigue a «Ir a COI». Cada parada se ve con su aro ámbar |
| 7 | «Copiar» y pegar en otro lado (con el lector de pantalla encendido, si puedes) | Pega el prompt completo; el botón dice «Copiado» un momento, el foco no se mueve y el lector anuncia «Copiado: …». En un navegador que niega el portapapeles, el prompt queda **seleccionado** y lo dice |
| 8 | «Llevar a la caja» con un prompt de Imagen y otro de Video | Ver los pasos 88 y 89 de § inicio. Un prompt de más de 1800 caracteres no trae «Llevar a la caja» y dice que lo copies |
| 9 | **Fijar** tres prompts (uno de cada categoría) | El botón pasa a «Quitar de fijados» (`aria-pressed`) y la franja los muestra en 1, 2 y 3. Recargar la página los trae igual y en el mismo orden |
| 10 | Intentar fijar un cuarto | **No sustituye a ninguno**: dice «Ya tienes 3 fijados. Quita uno para fijar este.» y el foco se queda en el botón |
| 11 | Subir, bajar y quitar con el teclado | El orden cambia y se guarda (recargar lo confirma); el foco se queda en el mismo botón aunque la casilla se mueva; «Subir» en la primera y «Bajar» en la última no hacen nada pero se pueden enfocar. Al quitar uno el foco no cae al principio de la página |
| 12 | Cortar la conexión (modo avión) y fijar uno | Se ve fijado al instante y, al fallar, **vuelve atrás** y dice «No hay conexión… Tus fijados quedaron como estaban.» |
| 13 | Entrar a «Míos» sin haber guardado nada | «Todavía no guardas ninguno. Arma uno con COI y pulsa «Guardar».» y un enlace a COI; la franja de fijados sigue ahí |
| 14 | Guardar uno desde COI y volver a «Míos» | Aparece, se puede copiar y fijar; no trae «Llevar a la caja». **Otra persona con su cuenta no lo ve ni puede fijarlo** |
| 15 | «Borrar» un «mío» fijado | Pregunta («¿Borrar este prompt?», con el foco en «Cancelar»); al confirmar desaparece de la lista **y de la franja** y el foco no cae a `<body>`. Borrar siempre se puede |
| 16 | Tumbar el servidor y recargar | «No pudimos cargar la Biblioteca» con «Reintentar» (el único ámbar); al volver el servidor, reintenta y carga. Nunca se queda en «Cargando…» |
| 17 | Con «reducir movimiento» activo | Nada se mueve (ni el cargando ni el esqueleto) |
| 18 | Revisar con el lector de pantalla | Una región `aria-live` anuncia copiar, fijar, borrar y elegir; cada botón de la franja y el interruptor dicen el título del prompt sobre el que actúan |
| 19 | La misma cuenta en dos aparatos (o dos pestañas), las dos abiertas con los fijados vacíos: fijar un prompt en una y OTRO en la otra | La segunda **no pisa** a la primera: se pone al día con lo que el servidor tiene (el fijado de la primera), dice «Tus fijados cambiaron en otra pestaña o aparato. Ya los actualizamos.» (sin mover el foco) y volver a fijar SUMA. Recargar muestra los dos |
| 20 | Escribir algo en el buscador, ir con Tab a «Quitar filtros» y pulsar Enter (y lo mismo con «Quitar la etiqueta»; a 390 px, con una etiqueta del detalle) | El foco pasa al buscador (o a «Quitar la etiqueta»); nunca cae al principio de la página |
| 21 | «Míos» con un título de 80 letras sin espacios y otro con una dirección larga (a 1100, 390 y 320 px) | El texto se parte dentro de su fila; la página no se arrastra de lado ni la lista se desplaza |

## admin · Clases · `/estudio/admin/` (pestaña «4 · Clases»)

(Guía de clases, rebanada S1; la pestaña es nueva y no tiene versión anterior). Aquí el dueño da de alta las clases de la Guía y sube el
video de cada una. **No cobra nada ni llama a ningún proveedor de pago** (ni AssemblyAI, ni Gemini, ni OpenAI): subir, confirmar y medir
no gastan en servicios de IA. Lo único que ocupa es almacenamiento de S3, y de S3 **no hay precio confirmado** (no está en
`tools/pricing.json`). Procesar la clase es de la rebanada S4: aquí no se ofrece ni se promete. Pruébala con tu usuario del grupo `admin`
en dev, en el escritorio (1100 px) y en el teléfono (390 px), con un `.mp4` chico (unos MB) y, si tienes, uno grande. La web se probó con
un servidor de mentira (`web/e2e/admin-clases.spec.ts`; con `GUIA_CAPTURAS=<carpeta>` guarda capturas): este recorrido es con el servidor
y S3 de verdad.

| # | Paso | Qué tiene que pasar |
|---|---|---|
| 1 | Abrir `/estudio/admin/` y mirar las pestañas | Son cuatro: «1 · Ingresos», «2 · Costos», «3 · Flujo» y «4 · Clases» (la última). La bajada dice «Cuatro vistas…». Con la pestaña de Clases cerrada, en la pestaña Red del navegador **no** hay ninguna llamada a `/api/admin/clases` |
| 2 | Pulsar «4 · Clases» | Sale una sola petición (`?archivadas=0`); la ayuda «Aquí subes los videos de las clases que usará la Guía. Subir no cuesta nada.»; **un solo** botón ámbar, «Nueva clase»; sin clases, «Todavía no hay clases» (sin un segundo botón) |
| 3 | Entrar con un usuario que no es admin | Como siempre: «solo para administradores», sin pestañas (ni la de Clases) |
| 4 | «Nueva clase» | Se abre el formulario con el foco en «Número de clase»; «Nueva clase» desaparece y el único ámbar es «Guardar clase». «Cancelar» lo cierra y el foco vuelve a «Nueva clase» |
| 5 | «Guardar clase» con todo vacío | «Escribe el número de la clase…» y «Escribe el título de la clase.» junto a cada campo, foco en el primero y **ninguna** petición |
| 6 | Número 1, título «Clase de prueba», una fecha y un «Para qué sirve»; doble clic rápido en «Guardar clase» | Una **sola** clase en la lista (chip «Borrador») y el foco en su título; el formulario se cierra |
| 7 | Crear otra con el mismo número | El texto del servidor («Ya hay otra clase con ese número…») junto al número, con el foco ahí; lo escrito se queda |
| 8 | Escribir una liga `https://…` y guardar | La clase queda como **solo una referencia** (sin «Subir video»): «Es solo una referencia: no lleva video que subir.» y «Abrir la liga de referencia» abre en otra pestaña. Una liga `http://` o con un puerto raro la rechaza el servidor, con su texto |
| 9 | «Editar» y cambiar solo el título | «Guardar clase» actualiza la tarjeta; sin cambiar nada, «Guardar clase» solo cierra. Una clase con archivo no muestra el campo de liga |
| 10 | «Subir video de la clase» con un `.mp4` chico | «Subiendo… N %» con la barra y «Cancelar»; al terminar el chip pasa a «Subido» y sale «Listo: 1 min · 12.3 MB» (la duración la mide el servidor); aparecen «Ver video», «Editar» y «Archivar» |
| 11 | Subir uno grande y pulsar «Cancelar» a la mitad | «Subida cancelada. Puedes elegir el video otra vez.», el chip vuelve a «Borrador» y se puede elegir otro. En S3 no queda confirmado nada |
| 12 | Subir y cerrar o recargar la pestaña a media subida | El navegador pregunta antes de salir (en iOS Safari no pregunta). Si sales igual, la clase se queda en «Subiendo» y la tarjeta dice «Hay una subida en curso o que quedó a medias…» y ofrece «Cancelar subida». Cambiar a otra pestaña del panel **no** detiene la subida ni la pierde de vista: «4 · Clases» se queda montada (oculta), así que al volver la tarjeta sigue con su barra y su «Cancelar» (no con «Cancelar subida»), y el formulario que dejaste a medias sigue con lo que escribiste |
| 13 | Elegir un `.pdf` o un `.exe` | «Ese archivo no es de un tipo que se pueda subir. Elige un video .mp4, .mov, .m4v.» antes de pedir nada al servidor |
| 14 | Cortar la conexión (modo avión) a media subida | «No se pudo subir el video. Revisa tu conexión e inténtalo otra vez.»; la clase vuelve a «Borrador». Si la red no deja ni avisarle al servidor, la tarjeta dice «Subiendo» (no «Borrador»), explica que «La subida quedó abierta en el servidor» y ofrece «Cancelar subida»: con la red de vuelta la suelta y se puede elegir el video otra vez |
| 15 | «Ver video» en una clase subida | El reproductor sale dentro de la tarjeta (16:9, sin reproducir solo); la liga firmada **no** se ve como texto. «Ocultar video» lo quita. **Aparte, en el navegador:** `https://<cdn>/clases/<id>/video.mp4` da 403 (el CDN no sirve las clases) |
| 16 | «Archivar la clase» | Diálogo «¿Archivar la clase N?» con el foco en «Cancelar» y la acción en rojo (no ámbar). Esc y «Cancelar» no archivan; confirmar la quita de la lista y el foco queda en el título «Clases». **En S3 el archivo sigue ahí** (nada borra) |
| 17 | «Ver clases archivadas» | La lista de archivadas (chip «Archivada») con solo «Restaurar». Apagar el interruptor las esconde. En la pestaña Red, `?archivadas=1` solo sale al prenderlo |
| 18 | «Restaurar» una archivada | Vuelve a la lista, en su lugar por número, con el foco en su título. Si otra clase viva ya tiene su número, el servidor lo dice y la archivada se queda |
| 19 | Recargar la página | Todo vuelve del servidor; nada de las clases ni de la subida quedó en el navegador (Aplicación → almacenamiento: vacío) |
| 20 | Pantalla a 390 px y a 320 px | Sin desplazamiento horizontal; las pestañas pasan a dos filas; todo lo que se toca mide 44 px o más; un título de 120 letras sin espacios se parte dentro de su tarjeta |
| 21 | Lector de pantalla: subir un video | Anuncia «Subiendo el video.», luego «Confirmando…», «Midiendo…» y «Listo: …»; el porcentaje no se lee a cada rato (la barra es un `progressbar`) |
| 22 | «Reducir movimiento» del sistema | La barra de progreso crece sin animación y nada más se mueve |
| 23 | Subir un video y, justo cuando llega al 100 %, cortar la conexión (o pedirle a quien administra la base que la duerma) para que «confirmar» falle | **No** se cancela ni se tira el video: la tarjeta sigue «Subiendo», dice «Tu video ya llegó a la nube, pero no pudimos confirmarlo…» y ofrece «Reintentar la confirmación» y «Cancelar subida». Con la red de vuelta, «Reintentar la confirmación» la deja «Subida» y mide la duración, sin volver a subir nada. Cerrar la pestaña en ese estado todavía pregunta (el video se perdería) |
| 24 | Solo con el teclado: Tab hasta «Subir video de la clase N» y elegir el video; luego Tab hasta «Cancelar» y Enter | El foco nunca vuelve al principio de la página: al empezar, al cancelar, al terminar y tras «Medir duración» queda en el título de la tarjeta (el lector de pantalla lo lee y sigue avisando las fases) |
| 25 | Subir dos videos a la vez (dos clases) y recargar cuando termine el primero | El navegador sigue preguntando antes de salir mientras la segunda siga subiendo; deja de preguntar cuando terminan las dos |
| 26 | Provocar un fallo al archivar (con muchas clases, la de abajo) y otro al restaurar (número repetido) | El aviso sale **dentro de la tarjeta** que tocaste, junto al botón, y se ve sin desplazar la página; no hay ninguna alerta arriba de la lista |
| 27 | «Nueva clase», escribir un título y, sin guardar, pulsar «Editar» en otra tarjeta | Un diálogo «¿Dejar lo que estás escribiendo?» con el foco en «Seguir escribiendo». «Seguir escribiendo» (o Esc) deja todo como estaba con el foco en el formulario; «Editar la clase N» cambia de formulario con el foco en su primer campo. Con el formulario vacío no pregunta nada |
| 28 | Encender «Ver clases archivadas» | La pista queda en el tono de «elegido» (borde dorado oscuro sobre fondo café, bolita ámbar claro), no en el ámbar de «Nueva clase»: a la vista hay un solo ámbar |
| 29 | Control por voz: decir «clic en Medir duración» | Activa el botón (su nombre es «Medir duración de la clase N»: repite lo que se ve) |

## constructor · `/estudio/automatizaciones/distrito/constructor/`

(pantalla nueva, 20-oct-2026: **Automatizaciones › Distrito › Constructor**; no tuvo versión anterior). **No cobra**, no llama a
ningún servicio y no guarda nada en el servidor: el flujo se arma en el navegador y se baja como un `.json` para importarlo en n8n. Lo
único que se guarda es un **borrador en este navegador** (`localStorage`, llave `constructor.borrador.v1`). Hazla en el escritorio
(1100 px) y en el teléfono (390 px y 320 px), con un lector de pantalla si puedes y con una instancia de n8n a la mano.

**Qué cubre ya el e2e automático y qué no.** `web/e2e/constructor.spec.ts` recorre la pantalla en un navegador de verdad (Chromium de
Playwright, con los pedidos simulados): las medidas y axe a 1100, 390 y 320 px en cada estado, armar flujos con el «+», la patita y el
editor de la flecha, quitar y «Deshacer» (aviso, botón de la barra y Ctrl+Z), «Limpiar», la descarga real del `.json` (lee el archivo),
«Ver el JSON» y «Copiar», el borrador que sobrevive a recargar, el teclado, el arrastre con el ratón y con un dedo **emulado** a 390 px, y
«reducir movimiento». **El e2e no corre en CI**: el `docker build` solo corre `npm run verificar` (tipos, lint, vitest y build) en la etapa
`web`, que no instala navegadores de Playwright, y ningún paso de `docker.yml` ejecuta `playwright test` (el Chromium de la imagen final es el de
Remotion). Se corre a mano, desde `web/`, con `npm run e2e` (compila y corre todas las pruebas de navegador; `PW_CANAL=chrome` usa
el Chrome instalado y `AUTOMATIZA_CAPTURAS=<carpeta>` guarda una captura por estado) y su salida se pega en el PR. Lo que queda **solo a
mano**, y es el motivo de esta lista, es lo que un navegador de pruebas no puede: dedos y pantallas de verdad, Safari de iPhone, lectores
de pantalla, una instancia de n8n que abra el archivo, una sesión que vence de verdad y el aspecto. Cada fila termina con «e2e: sí», «en
parte» o «no».

| # | Paso | Qué tiene que pasar |
|---|---|---|
| 1 | Entrar por el mapa: Automatizaciones › Distrito › Constructor | La barra dice `/estudio/automatizaciones/distrito/constructor/`. «Irremplazables» dorado arriba (es el único `h1`) y las migas «Automatizaciones › Distrito › Constructor» centradas debajo: las dos primeras vuelven al mapa y a las opciones, la última es un chip quieto. La pestaña dice «Estudio de video · Constructor». Después, «Arma tu automatización», la pista «Paso 1: elige cómo arranca tu flujo.» y, sobre el lienzo, la tarjeta «¿Qué hace que tu flujo arranque?» con cuatro opciones (Tiempo, Chat, Web, App) y «Cargar el ejemplo». «Deshacer», «Limpiar» y «Descargar .json» se ven apagados pero se enfocan y dicen por qué; **todavía no hay ningún botón ámbar**. e2e: sí (a 1100, 390 y 320 px) |
| 2 | Elegir cada uno de los cuatro disparadores (uno por vez; para probar otro, quita el cuadro con su «×» o cambia el tipo en Ajustes) | Aparece su cuadro (el del disparador es redondo a la izquierda), queda elegido y el foco pasa a él; Ajustes se trae a la vista con los campos de ese disparador («¿Cada cuánto?» en Tiempo, «Ruta del enlace» en Web, «¿En qué app tiene que pasar algo?» en App). El aviso de la esquina dice «Listo: el flujo arranca con «…». Ahora toca el + para agregar lo que sigue.». La tarjeta se va y nada entra animado. e2e: sí |
| 3 | «Cargar el ejemplo» (solo está con el lienzo vacío) | Aparecen cinco cuadros (Chat → «Atención a clientes» → «Revisor», con Google Sheets y Slack de herramientas), el nombre del flujo pasa a «Atención a clientes», el foco va al agente elegido y debajo se lee «Listo para descargar: 5 cuadros.». «Descargar .json» pasa a ser el **único** botón ámbar. «Deshacer» devuelve el lienzo vacío. e2e: sí |
| 4 | «+» a la derecha de un cuadro → «Un agente de IA» (y elegir la IA); otra vez «+» → «Una aplicación» → una app | El menú se abre pegado al «+» y el foco cae en su primera opción; Esc lo cierra y el foco vuelve al «+»; Tab lo cierra y sigue, no atrapa. El cuadro nuevo queda a la derecha, elegido, a la vista y sin tapar a otro; el aviso dice «Agregamos … después de …. Sus ajustes están en el panel de Ajustes.». Con 4 agentes o 8 apps, la opción correspondiente se apaga y dice «Por ahora son hasta 4 agentes por flujo.» o «Por ahora son hasta 8 apps por flujo.». e2e: sí |
| 5 | La patita de un agente (el «+» de abajo) → una app; luego un agente después de otro y tocar el círculo de la flecha que los une | La patita solo ofrece apps y la app cuelga debajo con línea discontinua. El círculo de la flecha dice con **texto** («un solo sentido» o «ida y vuelta»), no solo con el trazo; al pasar a «ida y vuelta» el aviso pide revisar en sus ajustes para qué le sirve el segundo agente, y se puede volver a «un solo sentido». e2e: sí |
| 6 | En el editor de la flecha, «Poner un cuadro en medio»; y «+» → «Uno que ya está en el lienzo» | En medio inserta el cuadro y reemplaza la flecha por dos; si no cabe a la derecha, avisa «No hay lugar en medio de esa conexión…» y no toca nada. «Uno que ya está»: «Conectando.» dice qué cuadro tocar, marca a dónde sí y a dónde no (con el motivo), Esc cancela y el foco vuelve al cuadro. e2e: sí |
| 7 | Arrastrar un cuadro con el ratón | Sigue al puntero sin retraso y se acomoda a una rejilla de 8 px; un clic corto (menos de 6 px de movimiento) abre Ajustes y arrastrar **no** los abre; la página no se desplaza ni de lado ni arriba y abajo. Un clic derecho no arrastra y soltar fuera de la ventana termina el arrastre. e2e: sí |
| 8 | **Arrastrar con el dedo de verdad**, en un Android y en un iPhone con Safari | El dedo sobre un cuadro arrastra el cuadro, no la página; un toque abre Ajustes; el dedo sobre el fondo del lienzo desplaza el lienzo por dentro. La captura del puntero (`setPointerCapture`) **no está probada en Safari de iPhone**: si el cuadro se queda atrás o se suelta a medio gesto, apúntalo. e2e: en parte, emula un dedo a 390 px en Chromium; no es un teléfono ni Safari |
| 9 | Con el teclado, sin ratón: Tab por los cuadros, sus «×», sus «+» y sus flechas; Enter sobre un cuadro; las flechas (y Mayús) para moverlo; Supr; Esc | El orden de Tab es el de lectura y cada parada lleva **un solo** aro de foco; Enter lleva el foco a Ajustes y Esc regresa al cuadro; las flechas mueven el cuadro 8 px (24 con Mayús) sin desplazar la página; Supr quita el cuadro y el foco pasa al anterior; el foco nunca cae a `<body>`. «Atajos del teclado», bajo el lienzo, dice lo mismo. e2e: sí |
| 10 | Quitar un cuadro con su «×» y luego «Deshacer»: por el botón del aviso, por el botón de la barra y con Ctrl+Z (Cmd+Z en Mac) | Abajo a la derecha sale «Quitamos «X» y sus conexiones.» (o «…y unimos lo de antes con lo de después.») con un botón «Deshacer» de 44 px que dura 10 s. Las tres puertas hacen lo mismo: reponen el cuadro, sus conexiones y la selección, y el foco va al cuadro que volvió. Se puede deshacer hasta 20 cambios seguidos. Si moviste o escribiste en otro cuadro después de quitar, eso **no** se pierde al deshacer. e2e: sí |
| 11 | Con el foco dentro de un campo de texto (el nombre del flujo, la tarea de un agente), pulsar Ctrl+Z | Deshace lo **escrito** (es del navegador) y el flujo no cambia. Con el foco fuera de los campos, Ctrl+Z deshace el flujo. e2e: sí |
| 12 | «Limpiar» (con cuadros) | Pregunta «¿Limpiar todo el flujo?» con el foco en «Cancelar»; Esc y «Cancelar» no borran. «Limpiar todo» vacía el lienzo, deja el nombre, manda el foco a la primera opción del disparador y avisa «Empezamos de cero. Elige cómo arranca tu flujo.»; «Deshacer» lo repone. Con el lienzo vacío «Limpiar» está apagado. e2e: sí |
| 13 | «Descargar .json» con lo que falta (por ejemplo un disparador web sin ruta) | Apagado (`aria-disabled`), pero se puede pulsar: dice por qué en la esquina («Todavía no se puede descargar. …») y la lista «Te falta esto para poder descargar:» está junto al botón. La lista es texto fijo: el lector de pantalla no la repite a cada tecla. Al completar lo que falta, el aviso rojo se quita solo. e2e: sí |
| 14 | «Descargar .json» con el flujo completo; luego doble clic rápido | Baja **un** archivo con el nombre del flujo sin acentos ni espacios (con «Mi automatización»: `mi-automatizacion.json`) y la esquina dice «Listo: …. En n8n, abre el menú «⋯» de arriba a la derecha y elige «Import from File».», aviso que **se queda hasta cerrarlo**. Debajo del lienzo está la misma instrucción por escrito. e2e: sí (lee el archivo bajado) |
| 15 | **Importar ese archivo en n8n de verdad**, en una instancia propia (menú «⋯» → «Import from File»), con un flujo sencillo (Chat → agente con Gmail en la patita), con el ejemplo y con uno de dos agentes que conversan | n8n lo abre sin error, con los mismos nodos y conexiones, y los nodos que piden cuenta (el modelo de IA, Gmail, Google Sheets…) quedan sin credencial para que elijas la tuya. Apunta la versión de n8n que probaste. e2e: **no**; los tests lo validan contra el catálogo de n8n del repo (`tests/test_constructor_paridad.py` y el archivo dorado), pero ninguno abre n8n. Los flujos donde dos agentes conversan exportan el nodo `agentTool`, que el validador del repo (`media/library/n8n/permitidos.json`) todavía no permite: es una decisión del dueño (ver `web/src/pantallas/constructor/modelo/golden/LEEME.md`) y por eso importarlos en n8n es justo lo que hay que probar |
| 16 | Un navegador que no deja descargar (una vista incrustada o con las descargas bloqueadas) | Dice «Tu navegador no nos dejó descargar el archivo. Dejamos el JSON abierto abajo: cópialo y guárdalo como un archivo .json.», abre «Ver el JSON» y manda el foco a «Copiar el JSON». e2e: sí (simulado) |
| 17 | «Ver el JSON» y «Copiar el JSON» | La caja trae exactamente lo que se descarga; se lee con el teclado (Tab la enfoca y las flechas la desplazan); «Copiar el JSON» pega el JSON entero en otro programa; el botón pasa a «Copiado» y la esquina dice «Copiamos el JSON.»; si el navegador niega el portapapeles, el texto queda seleccionado para Ctrl+C y lo dice («No pudimos copiar solos. Selecciona el texto y usa Ctrl+C.»). e2e: sí (con el portapapeles de verdad de Chromium) |
| 18 | Cortar el internet (modo avión) y seguir armando, descargando y copiando | Todo sigue funcionando: el Constructor no hace ningún pedido propio (en la pestaña Red no sale nada a `/api/` por editar). e2e: sí (se vigila que el Constructor no pida nada); aquí, con la red de verdad |
| 19 | Recargar la página con un flujo a medias; y luego «Limpiar» y recargar | Vuelven los cuadros, las conexiones y el nombre, con el aviso «Recuperamos tu borrador.»; bajo el lienzo se lee, con un candado, «Tu borrador se guarda solo en este navegador.». El borrador se escribe 500 ms después del último cambio y de inmediato al cerrar o recargar la pestaña. Con el lienzo vacío no hay borrador: tras «Limpiar» y recargar arranca vacío. e2e: sí |
| 20 | Dejar vencer la sesión de verdad con un flujo a medias | `auth.js` te lleva a iniciar sesión y al volver tu flujo está en el lienzo. e2e: en parte, dispara el evento `auth:saliendo` que usa la pantalla para guardar al momento; no hay una sesión de Cognito que venza |
| 21 | Con los datos del sitio bloqueados en el navegador (y, según el navegador, en una ventana privada), editar el flujo | La pantalla funciona igual; la esquina dice **una sola vez** «Tu navegador no deja guardar el borrador (¿ventana privada?). Descarga el .json para no perder tu trabajo.». e2e: no |
| 22 | Pegar en un texto del flujo (la tarea o las instrucciones de un agente) algo que parece una clave: `sk-…`, `AIza…` o un token de Telegram | **No** se guarda el borrador y la esquina dice «No guardamos tu borrador porque parece que hay una clave pegada en el flujo. Quítala: las claves se ponen en n8n al conectar la cuenta.»; «Descargar .json» tampoco baja el archivo. Al quitarla, el aviso se retira y todo vuelve a la normalidad. e2e: sí |
| 23 | Dos pestañas con el mismo borrador: cambiar el flujo en una y después en la otra | La que se quedó atrás dice «Este borrador cambió en otra pestaña, así que dejamos de guardar aquí para no pisarlo. Recarga esta página para ver la última versión; si quieres conservar lo de esta pestaña, descarga el .json.» y no guarda más hasta recargar. e2e: no (lo cubren pruebas unitarias del hook) |
| 24 | Armar a mano el flujo más grande: 1 disparador, 4 agentes y 8 apps (13 cuadros) | Sigue fluido; Tab es razonable; el JSON no se parte; no cabe un cuadro más (ver el paso 4). e2e: en parte, carga un flujo de 13 cuadros desde el borrador y lo mide; no lo arma con las manos |
| 25 | Con avisos abiertos en la esquina (el «Listo: …» de la descarga no se cierra solo), a 1100, 390 y 320 px | La caja de avisos de abajo a la derecha no tapa un control que necesites (la barra, el «+» del último cuadro, Ajustes) y su «Cerrar aviso» se alcanza siempre. En el teléfono la caja va abajo a todo lo ancho. e2e: **no**, mide la página y el lienzo, no lo que tapa esa caja |
| 26 | Lector de pantalla de verdad (VoiceOver en iPhone o Mac, TalkBack o NVDA): elegir el disparador, agregar, conectar, quitar, deshacer y descargar | Cada aviso se anuncia **una vez** (la esquina es su propia región viva; la página no repite el anuncio); cada botón de solo ícono dice qué hace y sobre qué cuadro («Quitar «Gmail»», «Agregar lo que sigue después de «Agente 1»…»); los cuadros dicen su tipo y su nombre; el lienzo se describe con los atajos; «Te falta esto…» no se repite a cada tecla. e2e: **no**, axe revisa nombres y roles pero no oye |
| 27 | «Reducir movimiento» activo en el sistema | Nada se mueve: ni los cuadros que entran, ni el menú, ni el aviso, ni el desplazamiento al traer algo a la vista. e2e: sí (con la preferencia emulada; además `movimiento-reducido.spec.ts` entra solo en cada página de `web/estudio/`); aquí, con el ajuste real |
| 28 | Teléfono (390 px y 320 px) | El lienzo se desplaza **dentro de su caja** y la página no se arrastra de lado; todo lo que se toca mide 44 px o más y la «×», el «+» y la patita de un cuadro no se tapan entre sí ni con otro cuadro; Ajustes queda debajo del lienzo y se alcanza (al elegir un cuadro se baja hasta él); el texto mide 13 px o más; un nombre de 60 u 80 letras sin espacios se parte dentro de su caja. e2e: sí (desborde, letra, 44 px, solapes y axe); aquí, con dedos y con el teclado de la pantalla abierto |

## asistente · `/estudio/automatizaciones/distrito/asistente/`

(pantalla nueva, 20-oct-2026: **Automatizaciones › Distrito › Asistente**; sin versión anterior). **Hoy corre en modo «prueba» y no gasta
nada**: `GET /api/automatiza/config` contesta `modo: "prueba"` y el servidor responde con un flujo de **ejemplo enlatado**, elegido por las
palabras del pedido. No llama a ningún modelo, base de datos, cola ni al monedero, y no guarda ni registra lo que escribes (la línea del log del Asistente solo lleva
cuál ejemplo salió y cuántos caracteres; el log de acceso del servidor anota la ruta de cada pedido, y el `id` que viaja en ella codifica el ejemplo, nunca el texto): ver `docs/OPERACION.md`, «El Asistente de Automatizaciones (modo prueba)». Por eso **ninguna fila
de esta sección lleva 💳**. Cuando el dueño encienda el armado real —cuesta dinero y guarda texto de la gente, así que exige su «sí» con el
costo a la vista— esta sección se reescribe con los 💳 donde cobre. Hazla en el escritorio (1100 px) y en el teléfono (390 px y 320 px).

`web/e2e/asistente.spec.ts` cubre la pantalla con el servidor **simulado** (nada sale de la máquina): las medidas y axe en cada estado a
1100, 390 y 320 px, los límites del pedido, los pasos que informa el servidor, el resultado, la descarga real del `.json`, «sin cobertura»,
cada error, el traspaso al Constructor y «reducir movimiento». **No corre en CI** (ver arriba, en el Constructor). Aquí se prueba con el
servidor de verdad, que es lo que el e2e no hace.

| # | Paso | Qué tiene que pasar |
|---|---|---|
| 1 | Entrar por el mapa: Automatizaciones › Distrito › Asistente | La barra dice `/estudio/automatizaciones/distrito/asistente/`. «Irremplazables» arriba y las migas «Automatizaciones › Distrito › Asistente»; la pestaña dice «Estudio de video · Asistente». Bajo «Cuéntanos qué quieres automatizar», el letrero **«Prueba: por ahora armamos flujos de ejemplo.»** («Elegimos el que más se parece a tu pedido. No guardamos lo que escribes.»), el cuadro «Cuéntale qué necesitas» con el contador «0 de 1500 caracteres» (el máximo lo dice el servidor), «Ejemplos para empezar» (tres) y **un solo** botón ámbar, «Armar flujo». En el contenido de la pantalla (letrero, cuadro, botón, resultado) no hay precio, ni ✦, ni la palabra «créditos»: es gratis. La **píldora del saldo de la cabecera** («N créditos ✦») sí aparece cuando tu cuenta tiene el monedero activo: es de la página (`monedero.js`), no de la pantalla, y no es un fallo. e2e: sí (revisa solo el `<main>` de la pantalla, no la cabecera) |
| 2 | Pulsar «Armar flujo» con el cuadro vacío; luego con menos de 20 caracteres | Vacío: «Escribe primero qué quieres automatizar, aunque sea en una frase.» junto al cuadro y el foco en él; no se manda nada. Poco texto: «Cuéntanos un poco más: escribe al menos 20 caracteres. Llevas N.» y el contador agrega «· mínimo 20». e2e: sí |
| 3 | Pegar más de 1500 caracteres | Al cruzar el máximo se dice **una vez** y queda a la vista «Es muy largo: el máximo es de 1500 caracteres y llevas N. Acórtalo para armar tu flujo.»; «Armar flujo» se apaga (`aria-disabled`) y dice por qué; ni Ctrl+Intro manda el pedido. Los números salen del servidor, no de la pantalla. e2e: sí |
| 4 | Escribir un pedido de más de 20 caracteres, pulsar Ctrl+Intro (Cmd+Intro en Mac) y, en otro intento, hacer doble clic rápido en «Armar flujo» | Ctrl+Intro hace lo mismo que el botón; el doble clic manda **un** solo pedido. El botón dice «Armando…», el cuadro queda de solo lectura, la pestaña dice «Armando tu flujo · Estudio de video · Asistente» y se ve el primer paso, «Entendiendo lo que pides», con «Llevas 0:07» (el reloj corre solo). La pantalla trae los cuatro pasos (entender, buscar ejemplos parecidos, armar los cuadros, revisar que se pueda importar en n8n) y avanzan con lo que informa el servidor; en prueba el servidor termina a los 4.8 s, **antes** del primer sondeo de la pantalla (a los 5 s), así que normalmente verás el primer paso y luego el resultado. e2e: sí (con un servidor simulado que sí informa los cuatro pasos) |
| 5 | Armar con estas frases, una por una: (a) el primer ejemplo de la pantalla, (b) el segundo, (c) «Quiero que cada día me llegue un resumen», (d) «conectar hubspot con github» | (a) «Responder correos de clientes»; (b) «Asistente de preguntas frecuentes»; (c) «Resumen diario»; (d) «Todavía no podemos armar esto» (paso 7). En prueba se elige por palabras (sin acentos ni mayúsculas): ten en cuenta que el **tercer** ejemplo de la pantalla («Cada mañana, un resumen de lo importante por correo y por Slack») también da «Responder correos de clientes», porque contiene «correo»; para ver «Resumen diario» escribe (c). e2e: sí, con respuestas simuladas |
| 6 | Mirar el resultado de (a), (b) y (c) | El foco va al encabezado «Tu flujo está listo»; el nombre del flujo, los cuadros como chips en español («Llega un correo (Gmail)», «Agente de IA», «Modelo de IA (OpenAI)», «Google Sheets (lo consulta el agente)», «Gmail (paso)»), el resumen, «Antes de usarlo en n8n» con una línea por cuenta que hay que conectar, y «Ten en cuenta» **solo** en (b): «El chat quedará público: cualquiera con el enlace podrá escribirle (y gastar tu llave de IA).». Se lee «Ejemplo de prueba: lo elegimos por las palabras de tu pedido, no lo armamos a tu medida.». «Descargar .json» es el único ámbar; «Armar flujo» pasa a «Armar otro flujo» (secundario) y, al pulsarlo, el resultado de antes no se mezcla con el nuevo. e2e: sí |
| 7 | Armar (d) | No es un error, es una respuesta: «Todavía no podemos armar esto», «Todavía no sabemos armar esto con n8n.», «Lo que nos falta» con la frase del servidor (en la prueba, «En esta prueba, apps como HubSpot, GitHub, Instagram, lectores de RSS y Google Calendar todavía no se pueden conectar.»), «Qué sigue» («Cuéntalo con otras palabras, o arma tu flujo a mano en el constructor.») y un enlace «Abrir el constructor». El foco va al título. e2e: sí |
| 8 | «Descargar .json» del resultado; doble clic rápido; e **importar el archivo en n8n** (menú «⋯» → «Import from File») | Baja **un** archivo con el nombre del flujo (por ejemplo `Responder correos de clientes.json`), con sangría y tal cual lo mandó el servidor; el lector de pantalla oye «Descargamos «…».». En n8n abre sin error y los nodos que piden cuenta quedan sin credencial. Debajo del botón está escrito cómo importarlo. e2e: sí para la descarga; la importación en n8n, **no** (ningún test abre n8n) |
| 9 | «Abrir en el constructor» con el Constructor vacío | Llega a `/estudio/automatizaciones/distrito/constructor/` con el flujo tal cual (cuadros, conexiones y nombre), el primer agente elegido con el foco y el aviso «Abrimos tu flujo del Asistente.»; no pide nada al servidor y los cuadros no entran animados. El flujo queda como tu borrador: recargar lo conserva. «Abrir en el constructor» solo sale cuando la respuesta trae un flujo que el Constructor puede dibujar; en prueba lo traen las tres muestras (el de (d) no). e2e: sí |
| 10 | «Abrir en el constructor» cuando ya hay un flujo armado en el Constructor | Pregunta «¿Reemplazar tu flujo del constructor?» (con «Reemplazar y abrir» y «Cancelar»); Esc y «Cancelar» no tocan nada y el flujo de antes se reemplaza solo si confirmas. e2e: sí |
| 11 | Cortar el internet antes de pulsar «Armar flujo», y de nuevo a media espera | Al pedir: «No hay conexión. Revisa tu internet y vuelve a intentar.» con su «Qué sigue» («Revisa tu conexión y pulsa «Armar flujo» otra vez: tu texto sigue en el cuadro.») y tu texto todavía en el cuadro. A media espera no se cae el armado: dice «Sin conexión. Seguimos intentando…», sigue preguntando solo y termina cuando vuelve la red. Si no se puede leer si el Asistente está disponible, sale un error con «Reintentar» y, si el servidor lo da por apagado, «No está disponible por ahora» con un enlace «Abrir el constructor». e2e: sí (simulado) |
| 12 | Revisar lo que queda en el navegador (Aplicación → almacenamiento local y cookies) y la pestaña Red, después de armar | Lo que escribiste **no** queda en el navegador (lo único que se guarda es el borrador del Constructor cuando usas «Abrir en el constructor», y ahí va el flujo, no tu pedido). Las llamadas propias del Asistente son solo `GET /api/automatiza/config`, `POST /api/automatiza/armar` y `GET /api/automatiza/armar/<id>`. e2e: sí (almacenamiento y cookies) |
| 13 | Lector de pantalla de verdad: armar y recibir el resultado | Una sola región viva dice «Armando tu flujo. Entendiendo lo que pides…» y los cambios; al final, el foco va al encabezado «Tu flujo está listo» y se lee; los errores se anuncian solos (`role="alert"`). El Asistente no pone avisos propios abajo a la derecha. e2e: **no** oye; sí vigila que no ponga avisos propios en la esquina ni deje caer el foco al `<body>` |
| 14 | «Reducir movimiento» y teléfono (390 px y 320 px) | Nada gira ni se mueve mientras arma (el giro del botón «Armando…» solo corre si el sistema permite movimiento) y el resultado no entra animado; a 320 px la página no se arrastra de lado, lo tocable mide 44 px o más y el texto 13 px o más. e2e: sí; aquí, con el ajuste real y un dedo |
