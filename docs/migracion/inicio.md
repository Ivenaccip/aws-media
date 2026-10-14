# Migración del inicio (UI·8.4)

`static/index.html` (servido en `/estudio/`) → `/estudio/inicio/`
(`web/src/pantallas/inicio/`).

El inicio **no decide ningún precio**: el servidor cobra. Reparte, y desde R4b también pide lo que elige modelo (un video corto, crear o editar una imagen); desde E1 también lanza la **edición** de un video subido (`POST /api/editar/<p>/sugerir`), con el precio que da `GET /api/editar/<p>/costo`. Tiene cuatro partes:

- **La caja** «¿Qué vamos a crear hoy?» lleva a la pantalla que cobra con el
  texto ya puesto, pide aquí lo que elige modelo y, en su tercera familia
  (**Edición**), sube un video y lanza la edición.
- **El menú** lleva a las herramientas.
- **Las listas** llevan a lo que ya hiciste.
- **El diálogo de Blotato** guarda la clave del usuario.

Los precios del desplegable salen de `tools/tarifas.json`, vía
`nucleo/tarifas`. La vieja los tenía escritos y un test comprobaba que
coincidieran.

## Una pantalla distinta: su URL vieja es `/estudio/`

Las otras pantallas tienen un `.html` propio. El inicio no: vive en
`/estudio/` (tarjetas 37 y 38), que también es a donde llevan
«← Estudio» del `Marco`, el callback de Cognito y la portada con sesión. Por
eso:

- **La nueva va al lado**, en `/estudio/inicio/`, igual que las demás
  (`dist/estudio/<p>/`).
- **`Pantalla` ganó `fichero`:** el HTML viejo se llama `index.html`, no como
  su URL.
- **`/estudio/` lo sirve ahora `server/migracion.py`,** no una ruta propia en
  `server/app.py`. En `nueva` sigue sirviendo el mismo `index.html` con
  `no-cache`. En `todos` responde 302 a `/estudio/inicio/` y conserva el
  query, así que `?blotato=conectar` (del editor) no se pierde.
- **Todo lo que apunta a `/estudio/` sigue funcionando** sin tocar nada: en
  `todos` y `retirada` da un salto más.

| Etapa | Qué pasa | Cómo se pasa | Estado |
|---|---|---|---|
| `nueva` | `/estudio/inicio/` existe; `/estudio/` sigue igual | este PR | ⏳ al desplegar |
| `todos` | `/estudio/?q` → 302 a `/estudio/inicio/?q`, salvo la cookie `ui=clasica` | `etapa="todos"` + deploy | pendiente |
| `retirada` | 302 siempre; se borran `static/index.html` y sus tests viejos | `etapa="retirada"`, `git rm` + deploy | pendiente |

Antes de `todos`, el dueño corre el QA manual de `docs/QA-UI.md` § inicio.
**El inicio cobra** (desde R4b el clip y la imagen; desde E1 la edición de un
video, «Editar ✦ N»): los pasos del QA marcados con 💳 gastan créditos de
verdad y solo se corren con el «sí» del dueño. No hay interruptor por función:
al pasar el inicio a `todos` la familia Edición sale para todos de golpe, con
su cobro.

## Los invariantes (tests/test_migracion_ui.py)

Cada uno es un test de vitest con ese nombre exacto: los de `inicio.edicion.*`
en `web/src/pantallas/inicio/Edicion.test.tsx`; el resto, en `Inicio.test.tsx`
(y sus hermanos de la carpeta).

| ID | Qué garantiza |
|---|---|
| `inicio.caja.arranca_en_el_clip_lo_mas_barato` | arranca en Video → «Un video corto» con su modelo de siempre (Veo 3.1 Lite), para quien no abra el menú (M25 · B); el chip de la tarea ya no lleva precio |
| `inicio.caja.precios_de_tarifas_json` | las historias con el rango mín–máx de `video.por_duracion`; las tareas que eligen modelo (clip, imagen, editar) dicen «según el modelo» y su precio sale de `tarifas.json` §modelos; el test compara contra el mismo `tarifas.json` |
| `inicio.caja.cada_opcion_lleva_a_su_destino_con_su_modo` | las tareas SIN modelo siguen llevando a su pantalla: cuentos → `/crear.html?…&modo=investigacion`; historia → `modo=idea`; el texto va sin espacios de más. (Clip e imágenes ya no navegan: ver las filas de abajo) |
| `inicio.caja.sin_texto_no_navega` | sin texto: el aviso (en el cuadro de abajo a la derecha, o junto a la caja si la página no lo trae), el foco vuelve a ella y no se navega |
| `inicio.caja.cada_opcion_cambia_el_ejemplo` | cada opción trae su ejemplo en el hueco |
| `inicio.caja.desplegable_con_teclado` | ↓ abre con el foco en la opción, ↓/Enter elige, Esc cierra sin cambiar y devuelve el foco; un clic fuera cierra |
| `inicio.caja.cambiar_de_familia_elige_la_primera` | Imagen/Video/Edición (el riel, tres familias) con `aria-pressed`; Imagen y Video eligen la primera opción de la familia al entrar y Edición, que no tiene opciones, deja las de Imagen/Video como estaban |
| `inicio.caja.el_modelo_se_paga_con_tarifas_json` | R4 (7-oct-2026): el menú de modelo enseña los créditos de `tarifas.json` §modelos, y son los mismos que cobran las pantallas (`clip.video_8s` = el clip de 8 s de `modelos.clip.veo-lite`, `video.imagen`) |
| `inicio.caja.el_envio_va_en_el_pie_del_menu_de_modelo` | el «Crear» de las tareas con modelo vive en el pie del menú; pide el clip a `/api/clip/generar` con `modelo` y `segundos` (8 si no se tocó), sin navegar; el menú se cierra, el texto se vacía y se avisa dónde mirar |
| `inicio.caja.el_servidor_decide_el_precio_y_un_error_se_dice` | un 402 (o cualquier error) se dice —en el cuadro de abajo a la derecha, o junto a la caja si la página no lo trae— y el texto no se pierde; el cuerpo nunca trae créditos |
| `inicio.caja.un_texto_vetado_no_se_pide` | la moderación (M13) corre antes de lo que cobra |
| `inicio.caja.crear_una_imagen_se_pide_aqui` | `/api/imagenes` con `modelo`, estilo animado (el que traía la pantalla de imágenes) |
| `inicio.caja.crear_una_imagen_manda_nano_banana_2` | con Nano Banana 2 elegido, `/api/imagenes` lleva `modelo: nb2` y la fila enseña el número de `tarifas.json` |
| `inicio.caja.una_imagen_lanzada_dice_que_va_en_camino_y_refresca_el_saldo` | los modelos que tardan (Seedream 5.0 Flash, Seedream 4.5 y FLUX 3) contestan `lanzado` en vez de `{nombre, url}`: ya se cobró y la imagen se hace en segundo plano. La caja dice «Listo, ya va. Míralo abajo, en «Mis creaciones».», se vacía, refresca el saldo y no navega; «Mis creaciones» la enseña generándose (una sola tarjeta, la del servidor) |
| `inicio.caja.la_respuesta_de_siempre_de_una_imagen_sigue_igual` | los modelos rápidos siguen contestando `{nombre, url}`: el mismo aviso, el mismo refresco del saldo y nada queda generándose |
| `inicio.caja.si_falla_la_primera_relectura_tras_lanzar_la_tarjeta_se_conserva_y_se_reintenta` | tras un `lanzado`, la tarjeta de «Generando…» de la caja se queda hasta que una relectura de `/api/imagenes` salga bien (es lo único que dice que va en camino); mientras tanto la lista se vuelve a pedir cada 5 s, sin duplicar la tarjeta cuando por fin llega la del servidor |
| `inicio.caja.una_lectura_con_los_pedidos_sin_leer_no_cuenta_como_buena_y_la_tarjeta_se_queda` | `GET /api/imagenes` trae `pendientes_ok`: `false` cuando el servidor no pudo leer los pedidos (entonces `pendientes` viene vacía **sin querer decir «no hay»**; sin la llave —un servidor anterior o local— se da por `true`). Una lectura así no cuenta como buena: la tarjeta local se queda y se vuelve a preguntar cada 5 s hasta que una salga bien, y entonces queda UNA tarjeta, la del servidor. Las imágenes ya terminadas que sí vinieron se siguen mostrando |
| `inicio.caja.si_la_lista_no_sale_bien_en_2_min_se_suelta_la_tarjeta_y_se_avisa` | tope de **2 minutos** desde que se lanzó la relectura (se comprueba en cada intento, cada 5 s): sin una lectura buena, la tarjeta local se suelta y sale el aviso que ya existe cuando falla la carga («No pudimos traer tus videos… Reintentar»); ya no gira ni sigue preguntando, y «Reintentar» con la lista sana lo quita. Antes de los 2 minutos no hay aviso |
| `inicio.caja.si_la_lista_se_cae_del_todo_tambien_se_suelta_la_tarjeta_a_los_2_min` | lo mismo cuando `GET /api/imagenes` da 500 todo el rato (en vez de 200 con `pendientes_ok: false`): el POST salió y la lista no responde; a los 2 minutos se suelta y se avisa, sin seguir preguntando |
| `inicio.caja.el_aviso_de_no_poder_confirmar_se_queda_aunque_otra_imagen_siga_preguntando` | el aviso del tope vive en su propio estado y solo lo quita una lectura buena (o «Reintentar»): si otra imagen sigue `generando` y la galería sigue preguntando, las lecturas degradadas no lo borran solas |
| `inicio.caja.una_imagen_que_el_servidor_ya_hizo_no_deja_una_tarjeta_girando_si_la_lista_no_llega` | solo `lanzado` conserva la tarjeta: una imagen que contestó hecha (`{nombre, url}`: el modelo rápido, o la edición, que es síncrona) no deja una tarjeta «Generando…» si la relectura falla, ni se queda preguntando |
| `inicio.caja.quien_empieza_ve_su_tarjeta_aunque_la_lista_no_traiga_los_pedidos` | una tarjeta local cuenta como «algo pedido»: quien no tenía nada (los tres caminos) y pide su primera imagen ve su tarjeta aunque la lista llegue vacía sin poder leer los pedidos; los tres caminos se van |
| `inicio.caja.dos_pedidos_seguidos_con_la_primera_lectura_degradada_no_dejan_tarjetas_de_mas` | una lectura buena trae también lo que ya esperaba: con dos imágenes seguidas y la primera relectura degradada, al salir bien la segunda quedan dos tarjetas (las del servidor), no tres con una repetida |
| `inicio.caja.un_pedido_que_el_servidor_rechazo_no_deja_su_tarjeta_aunque_la_lista_no_llegue` | lo contrario: si el POST falló (nada quedó en marcha) la tarjeta se va aunque la lista no responda, y no se queda preguntando por algo que no existe |
| `inicio.caja.editar_pide_la_imagen_con_el_mas` | sin imagen no sale y dice cómo agregarla; con ella va a `/api/imagenes/editar` en modo `todo` con `modelo` |
| `inicio.caja.editar_manda_nano_banana_2` | con Nano Banana 2 elegido, `/api/imagenes/editar` lleva `modelo=nb2` en modo `todo` |
| `inicio.caja.el_mas_agrega_quita_y_respeta_el_tope` | el «+» solo existe en las tareas que usan imágenes (clip, editar y, desde el 12-oct-2026, crear una imagen); tope 3 (clip) o 1 (editar); un archivo que no sirve se rechaza con su motivo. Con imágenes en Mis creaciones el «+» abre un menú: ver `inicio.biblioteca.*` |
| `inicio.caja.el_clip_con_fotos_las_sube_y_suma_el_juntarlas` | las fotos suben directo a S3 (`/api/clip/presign`) y el menú dice lo que suma juntarlas (tarifas.json `clip.componer_imagenes`); la nota no cambia con la duración del clip |
| `inicio.caja.arrastrar_imagenes_a_la_caja_las_agrega` | arrastrar es un atajo del «+»; solo cuenta lo que trae archivos (`dataTransfer.types` con `Files`) |
| `inicio.caja.crear_una_imagen_tambien_tiene_el_mas_y_con_una_imagen_la_caja_edita` | «Crear una imagen» tiene su «+» (sin miniaturas propias): con una imagen la tarea es editarla, y la caja pasa sola a «Editar una imagen» con la miniatura, el texto escrito y el mismo modelo si ese también edita (Grok y Nano Banana 2); el pedido sale a `/api/imagenes/editar`, no a `/api/imagenes`. Lo dice con «pasamos a «Editar una imagen»» |
| `inicio.caja.si_el_modelo_de_crear_no_edita_la_caja_edita_con_el_predeterminado` | si el modelo elegido para crear no tiene versión que edite (FLUX.2 klein…), la edición arranca con el predeterminado de editar (Grok Imagine): nunca se le pide editar a quien no sabe |
| `inicio.caja.una_imagen_que_no_sirve_no_saca_a_crear_una_imagen_de_su_tarea` | en «Crear una imagen» un archivo que el editor no lee (solo .jpg, .jpeg, .png, .webp) se rechaza con su motivo y la caja se queda en crear |
| `inicio.caja.pegar_una_imagen_la_agrega_igual_que_el_mas` | Ctrl+V con una imagen copiada (captura o archivo del explorador) la agrega como con el «+», con los mismos topes y rechazos, esté donde esté el foco de la página; una captura («image.png») se llama «imagen-pegada.png» (con número si son varias) y un archivo conserva su nombre |
| `inicio.caja.pegar_trae_la_imagen_aunque_el_navegador_solo_la_ofrezca_como_elemento` | si `clipboardData.files` viene vacío, la imagen se saca de `clipboardData.items` |
| `inicio.caja.pegar_texto_o_lo_que_no_es_imagen_no_se_toca` | un pegado con texto (Word, Excel…) o sin imagen (un PDF) sigue su camino normal: la caja no lo corta. Única excepción: el texto que son solo los nombres de los mismos archivos (ver la fila del Finder) |
| `inicio.caja.pegar_solo_agrega_donde_la_caja_usa_imagenes_y_a_la_vista` | no se agrega nada en cuentos ni historias (no usan imágenes), ni cuando lo pegado va a otro campo (la clave de Blotato), ni con un diálogo abierto (la caja queda detrás con `aria-hidden`) |
| `inicio.caja.pegar_una_imagen_en_crear_una_imagen_pasa_a_editar` | pegar en «Crear una imagen» hace lo mismo que el «+»: pasa a «Editar una imagen» |
| `inicio.caja.lo_que_la_caja_dice_sale_en_el_cuadro_de_abajo_a_la_derecha` | UI·15: lo que la caja dice sale en `window.avisos` (el cuadro de `static/trabajos.js`, abajo a la derecha) con la clave `caja`: los errores (`mal`: sin texto, archivo que no sirve, el 402 del servidor) y «Ya estamos creando tu clip de N segundos» (`ok`) en cuanto el pedido sale. Lo nuevo reemplaza lo anterior (el 402 quita el «creando»), y no hay mensaje junto a la caja. Donde la página no trae el cuadro (los tests, la vitrina) se dice junto a la caja como siempre |
| `inicio.caja.un_pedido_que_salio_bien_avisa_una_vez_en_el_cuadro_y_no_junto_a_la_caja` | un pedido bueno avisa UNA vez en el cuadro; el «Listo, ya va» de junto a la caja es solo de las páginas sin cuadro (diría lo mismo dos veces) |
| `inicio.caja.una_imagen_y_una_edicion_dicen_que_se_estan_creando_o_editando` | el aviso dice «creando tu imagen» o «editando tu imagen» según la tarea (y «tu clip de N segundos» en el video) |
| `inicio.caja.un_texto_vetado_se_dice_en_el_cuadro` | el veto de la moderación (M13) sale como error en el cuadro y no cuenta como «ya lo estamos creando» |
| `inicio.caja.arrastrar_una_imagen_a_crear_una_imagen_pasa_a_editar_y_un_texto_arrastrado_no_se_corta` | soltar una imagen en «Crear una imagen» pasa a «Editar una imagen»; un texto seleccionado que se mueve dentro de la caja NO se cancela (ni `dragover` ni `drop`) y no pinta el borde de «suelta aquí» |
| `inicio.caja.pegar_un_archivo_del_finder_cuenta_aunque_el_texto_sea_su_nombre` | el Finder de macOS (Chrome, Edge, Brave) pone el nombre del archivo (o su ruta, o `file:///`) como `text/plain` junto al archivo: eso es la imagen, no letras; se compara sin mayúsculas, con o sin extensión y normalizando NFC/NFD. Un texto que no es solo el nombre de los archivos sigue ganando |
| `inicio.caja.al_corregir_lo_que_faltaba_el_error_del_cuadro_se_quita_y_el_creando_no` | un error de la caja en el cuadro (se queda hasta cerrarlo) se quita en cuanto se corrige —agregar la imagen que faltaba, volver a pedir—; un aviso verde de «ya estamos creando» NO es un error y no se quita. Tras un «falta algo» el menú de modelo se cierra para que el aviso no tape su «Crear» |
| `inicio.caja.un_lote_con_una_imagen_buena_y_otra_mala_conserva_el_aviso_de_la_mala` | con un lote mixto la buena se agrega y el aviso de la mala se queda (no se limpia después de decirlo) |
| `inicio.caja.los_avisos_de_agregar_tambien_van_al_cuadro` | «Como mucho 3 imágenes.» y «pasamos a «Editar una imagen»» salen en el cuadro con la clave `caja`, no junto a la caja |
| `inicio.caja.el_modelo_de_editar_que_ya_se_eligio_no_se_pisa_al_pasar_desde_crear` | al pasar de «Crear una imagen» a editar el modelo de crear se lleva solo si editar no tenía uno elegido y lo ofrece |
| `inicio.biblioteca.el_mas_ofrece_subir_o_elegir_de_mis_creaciones` | con imágenes en «Mis creaciones» el «+» abre un menú (`role=menu`, `aria-haspopup`/`aria-expanded`, foco en la primera opción) con «Subir de tu computadora» —que dice qué sirve y su tope: clip «JPG, PNG, WebP, GIF, AVIF o HEIC · hasta 20 MB», editar «JPG, PNG o WebP · hasta 15 MB»— y «Elegir de Mis creaciones» («4 imágenes tuyas»), más el recordatorio de arrastrar y pegar con Ctrl+V. «Subir» abre el selector de archivos de siempre |
| `inicio.biblioteca.sin_imagenes_el_mas_abre_el_selector_de_siempre` | sin ninguna imagen en Mis creaciones el «+» no abre menú: abre el selector de archivos, como antes (y sin `aria-haspopup`) |
| `inicio.biblioteca.elegir_trae_las_imagenes_a_la_caja_en_el_orden_marcado` | la hoja «Agregar imágenes» (diálogo de 760 px, pestañas «Mis creaciones» y «Mi computadora») enseña las imágenes de la más nueva a la más vieja; cada elegida lleva su número (el orden en que se marcó), elegirla de nuevo la quita, y el contador dice «N de M seleccionadas». «Agregar N» las trae del servidor (una sola vez cada una), las suma a la caja con su nombre de archivo, en ese orden, y cierra la hoja. Sin elegidas, «Agregar» está apagado |
| `inicio.biblioteca.el_tope_sale_de_lo_que_le_cabe_a_la_caja` | en el clip caben 3 menos las que ya están en la caja: al llegar al tope las demás se apagan (`aria-disabled`, sin efecto al pulsarlas); con 3 puestas la hoja dice «Ya tienes todas las que caben» y no deja agregar |
| `inicio.biblioteca.en_crear_una_imagen_elige_una_y_la_caja_pasa_a_editar` | desde «Crear una imagen» la hoja admite UNA (elegir otra reemplaza a la anterior), «Mi computadora» dice los archivos del editor (no los del clip) y, al agregar, la caja pasa a «Editar una imagen» con esa imagen |
| `inicio.biblioteca.si_una_no_se_puede_traer_la_hoja_se_queda_y_lo_dice` | si el servidor no entrega alguna de las elegidas, se dice «No pudimos traer esa imagen — inténtalo de nuevo.» DENTRO de la hoja (`role=alert`; el cuadro de abajo a la derecha queda tapado por el diálogo, aria-hidden, y en un celular cubre sus botones), la hoja sigue abierta con lo elegido y a la caja no se agrega ninguna; cambiar lo elegido quita el error |
| `inicio.biblioteca.cerrar_olvida_lo_elegido` | cerrar la hoja (Cancelar, Esc, el velo) olvida lo elegido: al reabrirla no hay nada marcado |
| `inicio.biblioteca.mi_computadora_elige_o_suelta_archivos` | en «Mi computadora»: «Elegir archivos…» cierra la hoja y abre el selector; soltar archivos suma solo las imágenes y cierra la hoja; un texto arrastrado no se cancela; lo soltado no se agrega dos veces (la hoja está fuera del `<section>` de la caja, que tiene su propio arrastre) |
| `inicio.biblioteca.el_menu_se_cierra_con_esc_y_fuera` | Esc cierra el menú del «+» y devuelve el foco al «+»; un clic fuera lo cierra; el «+» lo abre y lo cierra |
| `inicio.biblioteca.los_bytes_se_piden_a_nuestro_endpoint_y_no_a_la_url_del_cdn` | «Agregar» trae cada imagen de `/api/imagenes/<nombre>/archivo` (mismo origen), jamás de su `url`: en la nube esa redirige a un CDN sin cabeceras CORS y el `fetch` fallaría con toda imagen aunque la miniatura (un `<img>`) cargue. También «Usar como referencia» de la galería, que comparte `traerImagen`. La prueba de navegador lo reproduce con un servidor en otro origen sin CORS |
| `inicio.biblioteca.cerrar_olvida_lo_elegido_por_cualquier_camino` | la selección se olvida al cerrar la hoja POR DONDE SEA, no solo con Cancelar y Esc: «Elegir archivos…» y soltar una imagen también la vacían (al reabrirla, «0 de N seleccionadas» con las que caben ahora) |
| `inicio.biblioteca.cerrar_mientras_trae_cancela_y_no_agrega_nada` | si la hoja se cierra mientras dice «Agregando…», la petición se aborta (lleva una señal) y cuando llega la imagen no se agrega nada, no se cambia de tarea ni sale ningún error |
| `inicio.biblioteca.soltar_algo_que_no_es_imagen_no_cierra_la_hoja_y_lo_dice` | soltar en «Mi computadora» un archivo que no es imagen (un PDF) no cierra la hoja: dice «Solo sirven imágenes: …» dentro de la zona (`role=alert`) y no agrega nada; una imagen después sí se agrega y cierra la hoja |
| `inicio.biblioteca.la_lista_no_se_mueve_mientras_esta_abierta` | una imagen nueva que llega del sondeo con la hoja abierta no mueve ni suma miniaturas (las de abajo del puntero cambiarían de sitio); aparece al cerrarla y volver a abrirla, la más nueva primero |
| `inicio.biblioteca.cada_miniatura_dice_si_esta_elegida_y_con_que_numero` | el nombre accesible de cada miniatura es «Tu imagen del <día>» y, elegida, «…, elegida: número N» (con `aria-pressed`): el número de orden, lo central de la selección, lo oye también quien usa un lector de pantalla |
| `inicio.biblioteca.al_cerrar_la_hoja_el_foco_vuelve_al_mas` | al cerrar la hoja (Cancelar o Esc) el foco vuelve al «+» de la caja, aunque ya no esté el menú desde el que se abrió (antes caía al `<body>`) |
| `inicio.biblioteca.el_menu_se_recorre_con_flechas_y_tab_lo_cierra` | en el menú del «+» las flechas, Inicio y Fin recorren las opciones (dan la vuelta); Tab lo cierra y el foco sigue al control que viene después del «+»: no queda un menú abierto detrás del foco |
| `inicio.biblioteca.abrir_el_menu_quita_el_error_del_cuadro_de_avisos` | abrir el menú del «+» quita el error de la caja que estuviera en el cuadro de abajo a la derecha (`avisos.quitar('caja')`): en un celular chico ese aviso (z-999) tapaba el menú y se llevaba sus toques |
| `inicio.caja.la_duracion_recalcula_los_precios_el_chip_y_el_pie` | R4 · duración (9-oct-2026, opción A): el menú del clip trae «Duración del clip» (4 s · 6 s · 8 s, 8 por defecto, «Más corto, más barato»); al elegirla cambian los créditos de cada fila, el rango de cada grupo, el pie («✦ N por clip de N s») y el chip («Modelo Veo 3.1 Lite · 6 s»). Los números salen de `tarifas.json` §modelos.clip, por duración |
| `inicio.caja.el_clip_manda_veo_fast_y_sus_segundos` | con Veo 3.1 Fast a 4 s, el pedido lleva `modelo: veo-fast` y `segundos: 4` (nunca créditos) y la fila enseña el número de `tarifas.json` a esa duración |
| `inicio.caja.el_clip_manda_los_segundos_elegidos` | el pedido del clip lleva `segundos` junto al `modelo` (nunca créditos: el servidor calcula y cobra); la duración se queda para el próximo pedido |
| `inicio.caja.un_modelo_sin_esa_duracion_se_atenua_y_se_vuelve_al_predeterminado` | un modelo sin número para la duración se atenúa (`aria-disabled`, «Desde N s», no se elige); si era el elegido vuelve el predeterminado y el pie avisa `«<Modelo> empieza en N s. Te dejamos <Predeterminado>.»` (`<Aviso>`, `role="status"`); al volver a una duración que sí tiene, no se elige solo. Se prueba encendiendo LTX un rato con números de prueba |
| `inicio.caja.imagen_y_editar_no_tienen_selector_de_duracion` | crear y editar imagen no traen la duración (ni en el menú ni en el chip ni en el pie); la del clip se recuerda al volver al video |
| `inicio.caja.el_aviso_de_duracion_no_sobrevive_al_cambio_de_tarea` | el aviso «<Modelo> empieza en N s…» es de la tarea del clip: al pasar a Imagen o Editar con el teclado (sin cerrar el menú) la hoja nace de nuevo, sin aviso |
| `inicio.galeria.lo_recien_pedido_aparece_generando_y_se_relee` | mientras el servidor contesta hay una tarjeta «Generando…» al principio; al contestar, la lista se relee y la tarjeta local se va (una imagen que el servidor dejó en marcha, `lanzado`, se queda hasta que esa relectura salga bien —`inicio.caja.si_falla_la_primera_relectura_tras_lanzar_la_tarjeta_se_conserva_y_se_reintenta`— o pasen 2 minutos: `inicio.caja.si_la_lista_no_sale_bien_en_2_min_se_suelta_la_tarjeta_y_se_avisa`) |
| `inicio.galeria.usar_como_referencia_lleva_la_imagen_a_la_caja` | el visor de una imagen la devuelve a la caja, en «Un video corto» |
| `inicio.caja.las_tareas_sin_modelo_no_traen_chip_de_modelo` | cuentos e historias no eligen modelo: su «Crear» está en la barra y lleva a `/crear.html` |
| `inicio.caja.cada_tarea_recuerda_su_modelo` | clip, imagen y editar guardan su modelo por separado: elegir Nano Banana 2 en imagen no cambia el de editar, y al regresar cada una conserva el suyo |
| `inicio.menumodelo.niveles_precios_y_predeterminado` | los modelos por nivel y de menor a mayor precio, «Predeterminado» en el de siempre, «desde ✦ N» si hay resolución, y el pie con el nombre y el precio |
| `inicio.menumodelo.la_resolucion_solo_aparece_en_el_modelo_que_la_tiene` | «Resolución» se elige en el pie solo con Nano Banana Pro; cambia el precio y el chip, y desaparece con otro modelo |
| `inicio.menumodelo.crear_va_en_el_pie_y_no_acepta_dos_clics_mientras_trabaja` | un solo envío por clic, también en el menú |
| `inicio.menumodelo.teclado_y_cierres` | ↑↓ ←→ Home End mueven la elección, Esc cierra y devuelve el foco al chip, un clic fuera cierra |
| `inicio.menumodelo.la_duracion_solo_sale_en_el_clip_y_recalcula_las_filas` | el grupo de radios «Duración del clip» solo existe en el clip, con botones de al menos 44 px (`min-h-11`); cambia filas, rangos, pie y chip |
| `inicio.menumodelo.el_modelo_sin_esa_duracion_se_atenua_y_no_se_elige` | la fila sin esa duración: `aria-disabled`, fuera del tabulador, sin ✦ y con «Desde N s»; ni el clic ni Enter la eligen |
| `inicio.menumodelo.si_el_elegido_no_la_tiene_vuelve_el_predeterminado_con_un_aviso_en_el_pie` | el aviso vive en el pie del menú, se va al elegir otra duración u otro modelo y no sobrevive a cerrar y reabrir |
| `inicio.menumodelo.duracion_con_flechas_y_foco` | ←→↑↓ cambian la duración (sin salirse de los extremos) y llevan el foco al botón nuevo; al abrir el foco sigue yendo al modelo elegido; las flechas entre modelos saltan los atenuados |
| `inicio.menumodelo.con_una_sola_duracion_no_hay_selector` | con una sola duración ofrecida no sale el grupo «Duración del clip» ni su pista; el chip y el pie siguen diciendo los segundos |
| `inicio.modelos.cada_modelo_activo_tiene_precio_y_cada_precio_su_modelo` | el catálogo (`modelos.ts`) y `tarifas.json` §modelos no se desfasan, en ninguno de los dos sentidos |
| `inicio.modelos.el_predeterminado_esta_activo_y_es_el_que_ya_valia` | el predeterminado de cada tarea está activo y vale lo mismo que cobra la pantalla |
| `inicio.modelos.sin_precio_confirmado_no_se_ofrece_aunque_este_activo` | sin número en `tarifas.json` el modelo no sale, ni uno con resolución a medias |
| `inicio.modelos.un_modelo_apagado_no_se_ofrece_aunque_tenga_precio` | `activo: false` lo saca del menú aunque tenga precio |
| `inicio.modelos.lo_que_esta_a_la_venta_hoy` | el catálogo real tiene activos, para crear imágenes, Grok, FLUX.2 klein, Z-Image Turbo, FLUX.2 pro, Seedream 5.0 Flash, Seedream 4.5, FLUX 3, Nano Banana 2 y Nano Banana Pro (dos calidades, 2K y 4K; solo para crear) (para editar, solo Grok y Nano Banana 2) y, para el clip, MiniMax H3 Max Turbo, Veo 3.1 Lite, Grok Imagine Video, Grok Imagine Video 1.5 Lite y Veo 3.1 Fast (en ese orden); Veo 3.1 Standard, LTX, Kling y Seedance siguen apagados |
| `inicio.modelos.por_nivel_y_de_menor_a_mayor_precio` | los grupos y su orden |
| `inicio.modelos.todo_modelo_del_catalogo_cae_en_un_nivel_de_su_tarea` | ningún modelo desaparece por traer un nivel que su tarea no enseña |
| `inicio.modelos.editar_solo_los_que_tienen_endpoint_edit` | Grok, GPT Image 2 y Nano Banana 2; Nano Banana Pro tiene `/edit` en fal pero no se ofrece para editar todavía (necesita su propio camino en segundo plano), así que queda fuera |
| `inicio.modelos.el_modelo_viaja_en_la_url_solo_si_no_es_el_predeterminado` | `modelo=<id>` solo si no es el predeterminado, y nunca en tareas sin modelo |
| `inicio.modelos.el_clip_trae_un_precio_por_duracion_en_enteros` | `tarifas.json` §modelos.clip es un objeto por duración: llaves de segundos que el producto sabe pedir (4, 6, 8), créditos enteros positivos y más corto nunca cuesta más; imagen y editar siguen con un entero |
| `inicio.modelos.una_duracion_sin_numero_no_se_ofrece_ni_cuesta_cero` | una duración sin número da `null` (nunca 0 ni el precio de otra); el entero viejo en un clip tampoco es un precio; el modelo se ofrece con número en al menos una duración y el selector solo trae las que algún modelo ofrece |
| `inicio.modelos.cada_duracion_recalcula_el_rango_del_grupo` | el rango «✦ lo–hi» de cada grupo cuenta solo los modelos que tienen esa duración (vacío si ninguno); las filas no se mueven al cambiar de duración |
| `inicio.modelos.cambiar_la_duracion_deja_el_predeterminado_con_su_aviso` | si el elegido no la tiene queda el predeterminado (o, si tampoco, el primero que sí) y el aviso dice desde cuántos segundos empieza; si nadie la tiene, no hay cambio |
| `inicio.modelos.la_duracion_que_rige_cae_en_una_que_se_ofrece` | si la pedida ya no se ofrece rige la de siempre (8 s) o la más larga que sí |
| `inicio.modelos.imagen_y_editar_no_dependen_de_la_duracion` | el precio, los grupos y el «desde» de imagen y editar son los mismos para cualquier duración |
| `inicio.audio.el_pie_trae_el_interruptor_con_sonido_y_el_precio` | el pie del menú de un clip lleva el modelo y su precio a la izquierda y el interruptor «Audio» a la derecha, encendido y con «Con sonido» escrito; sin «ahorras» y con «con audio» bajo Veo Lite |
| `inicio.audio.apagarlo_baja_el_precio_del_pie_las_filas_y_el_rango_y_dice_cuanto_se_ahorra` | apagarlo muestra el número «sin sonido» de `tarifas.json` en el pie, la fila (que dice «sin audio») y el rango del grupo, más «ahorras ✦ N»; los modelos que no se apagan no cambian; al volver a encenderlo todo vuelve |
| `inicio.audio.las_filas_no_se_mueven_al_apagar_el_sonido` | el orden de las filas es por el precio con sonido: Veo Lite pasa a costar menos que Grok Lite y no salta de lugar |
| `inicio.audio.cambiar_la_duracion_con_el_sonido_apagado_usa_el_numero_sin_sonido_de_esa_duracion` | con el sonido apagado, cada duración (4, 6 y 8 s) usa su propio número «sin sonido» y el interruptor sigue apagado |
| `inicio.audio.el_chip_dice_sin_audio_solo_cuando_el_clip_va_mudo` | el chip del modelo dice «· sin audio» solo si el clip va sin sonido de verdad; con un modelo que no se apaga no lo dice aunque antes se haya elegido mudo |
| `inicio.audio.el_pedido_manda_audio_false_si_se_apago_y_el_aviso_lo_dice` | el pedido del clip lleva `audio: false` y el aviso de «ya estamos creando» dice «sin sonido»; el precio lo calcula el servidor, el cuerpo no trae créditos |
| `inicio.audio.un_modelo_que_no_se_puede_apagar_bloquea_el_interruptor_y_dice_por_que` | MiniMax y los dos Grok: el interruptor queda encendido y bloqueado (`aria-disabled`, sigue en el orden del teclado), su estado («Sonido incluido» o «Sonido muy bajo») y su motivo se leen con él, tocarlo no cambia nada y el pedido va con `audio: true` |
| `inicio.audio.apagado_y_luego_un_modelo_sin_interruptor_pide_con_sonido_y_al_volver_sigue_apagado` | la preferencia de «sin sonido» no se pierde al pasar por un modelo que no se apaga: ese pide con sonido a su precio, y al volver a Veo Lite sigue apagado |
| `inicio.audio.se_recuerda_en_el_navegador_y_si_el_navegador_no_deja_igual_funciona` | la elección se guarda en `localStorage` («caja.sonido») y la caja de otra visita arranca igual (chip y precio al día) |
| `inicio.audio.un_navegador_sin_almacenamiento_no_rompe_la_caja` | con el almacenamiento bloqueado, la caja arranca con sonido y el interruptor funciona para esa visita |
| `inicio.audio.el_interruptor_se_usa_con_teclado` | Espacio y Enter lo cambian, conserva el foco y su estado se lee con él (`aria-describedby`) |
| `inicio.audio.imagen_y_editar_no_traen_interruptor` | las tareas de imagen no tienen interruptor de audio |
| `inicio.audio.el_catalogo_dice_que_modelos_se_apagan_y_el_resto_dice_por_que_no` | `sonido` del catálogo: «opcional» en Veo, LTX, Kling y Seedance; «incluido» en MiniMax; «bajo» en los dos Grok; imagen y editar no lo traen |
| `inicio.audio.la_tabla_sin_sonido_solo_trae_modelos_activos_que_se_apagan_y_cuesta_menos` | `tarifas.json` §modelos.clip_sin_audio solo trae modelos activos con sonido «opcional», con las mismas duraciones que su tabla de con sonido y cada número menor que el de con sonido |
| `inicio.audio.el_precio_sin_sonido_es_el_de_la_tabla_y_los_que_no_se_apagan_siguen_con_su_precio` | `precioDe(…, sonido=false)` da el número «sin sonido»; MiniMax y Grok siguen con el suyo; sin tabla o sin esa duración cae en el de con sonido (nunca cero); el sonido no afecta a imagen |
| `inicio.audio.solo_se_puede_apagar_si_el_endpoint_lo_permite_y_hay_numero_a_esa_duracion` | `puedeApagar`: el modelo es «opcional» Y hay número «sin sonido» a esa duración; un modelo que no se apaga no se apaga aunque alguien le escriba un número |
| `inicio.audio.el_ahorro_es_la_resta_y_cero_si_no_se_apaga` | `ahorroSinSonido` es con sonido menos sin sonido, y 0 si no se puede apagar |
| `inicio.audio.el_detalle_de_la_fila_dice_sin_audio_solo_si_se_apaga_de_verdad` | «con audio» pasa a «sin audio» solo en los modelos que de verdad se pueden apagar a esa duración |
| `inicio.audio.los_modelos_sin_interruptor_dicen_su_estado_y_su_motivo` | los textos de estado y de motivo de MiniMax y de los dos Grok |
| `inicio.audio.el_rango_del_grupo_sigue_el_sonido_y_el_orden_no_se_mueve` | el rango «✦ lo–hi» del grupo cuenta el precio con el sonido elegido y el orden de los modelos no cambia |
| `inicio.caminos.solo_con_todas_las_listas_bien_y_vacias` | los tres caminos solo si proyectos, imágenes, ediciones y clips llegaron bien y vacíos (y sin imágenes en segundo plano); una que falló no cuenta como vacía (UI·10). El 503 de clips en local («corre en el servicio») sí cuenta como vacío |
| `inicio.caminos.desde_una_idea_no_cobra_solo_elige` | «Crear un video» elige «Creador de cuentos» y enfoca la caja; ni navega ni manda nada |
| `inicio.caminos.enlaces_a_shorts_y_metraje` | «Hacer shorts» → `/shorts.html`, «Subir metraje» → `/e1.html` |
| `inicio.carga.sin_proyectos_avisa_y_reintentar` | sin la lista de proyectos: aviso con Reintentar, sin concluir que es alguien nuevo; al cargar bien el aviso se va |
| `inicio.proyectos.cada_tarjeta_lleva_a_crear` | cada película abre `/crear.html?p=<id>`; su estado con icono si no está lista y «N de M slots» |
| `inicio.galeria.los_slots_se_ven_junto_al_titulo_y_no_hay_tarjetas_de_nuevo` | R4b: «N de M slots» junto a «Mis creaciones»; ya no hay tarjetas «Nuevo video» ni «Nueva imagen» (la caja es la puerta). Reemplaza a `inicio.videos.nuevo_video_aun_sin_slots` |
| `inicio.videos.mezcla_peliculas_clips_y_shorts_lo_mas_nuevo_primero` | UI·26: «Mis videos» junta películas, clips (`/api/clip`) y los proyectos del editor que pasaron por shorts, por fecha |
| `inicio.videos.las_cuatro_etiquetas` | abajo va el tipo: `idea` y el viejo `auto` = Video largo, `investigacion` = Cuento, clip = Video corto, shorts = Shorts |
| `inicio.videos.el_estado_solo_si_no_esta_listo` | «Cuento · en revisión — te espera», «Video corto · con error»; lo listo solo lleva la etiqueta y la fecha |
| `inicio.videos.cada_uno_abre_su_pantalla` | película → `/crear.html?p=`, clip → visor de la galería (video con controles y Descargar), shorts → `/shorts.html?p=`; el clip listo enseña su primer cuadro, callado y fuera del tabulador |
| `inicio.videos.los_slots_cuentan_solo_peliculas` | «N de M slots» y archivar siguen siendo solo de películas |
| `inicio.galeria.las_ediciones_van_en_su_filtro_y_los_shorts_en_el_suyo` | las ediciones de metraje entran a la galería (filtro «Ediciones»); los shorts, en «Shorts». Reemplaza a `inicio.videos.las_ediciones_sin_shorts_no_entran` |
| `inicio.videos.sin_los_clips_avisa_y_reintenta` | si `/api/clip` falla, las películas se ven y una línea ofrece reintentar |
| `inicio.proyectos.miniatura_rota_cae_al_personaje_y_al_hueco` | portada rota → personaje → hueco, sin icono roto |
| `inicio.proyectos.archivar_pide_confirmar` | archivar pide confirmación («No se borra nada…»); Cancelar no manda nada; al archivar pasa a «Proyectos archivados» |
| `inicio.proyectos.no_se_ofrece_archivar_mientras_corre` | ni se ofrece con una tarea en curso (`preparando`, `produciendo`) |
| `inicio.proyectos.error_al_archivar_dice_el_motivo` | el motivo del server (409) o «Sin conexión — intenta de nuevo.» |
| `inicio.proyectos.restaurar_desde_archivados` | Restaurar lo devuelve a «Mis videos» |
| `inicio.galeria.doce_y_ver_mas` | se ven 12 tarjetas y «Ver más (N)» trae otras 12. Reemplaza a `inicio.imagenes.cinco_y_ver_todas` |
| `inicio.imagenes.cada_una_abre_en_el_visor_y_la_rota_no_deja_icono` | una imagen abre un visor (Descargar, Editar → `/imagenes.html?img=<nombre codificado>`), carga diferida, y una rota no deja icono roto |
| `inicio.imagenes.si_falla_la_lista_no_se_rompe` | sin `/api/imagenes` la sección no sale y el resto sí |
| `inicio.ediciones.estado_y_enlace_a_e1` | cada edición abre `/e1.html?p=<codificado>` con su estado (M14) |
| `inicio.galeria.una_sola_galeria_lo_mas_nuevo_primero` | una sola sección «Mis creaciones» con todo mezclado, lo más nuevo primero. Reemplaza a `inicio.listas.orden_videos_imagenes_ediciones` |
| `inicio.galeria.los_filtros_solo_ofrecen_lo_que_hay` | Todo, Películas, Videos cortos, Imágenes, Shorts y Ediciones, cada uno con su conteo; un filtro sin nada no sale |
| `inicio.galeria.se_actualiza_sola_mientras_un_clip_se_genera` | mientras un video corto se genera, la lista se vuelve a pedir cada 5 s; al terminar, para |
| `inicio.galeria.una_imagen_en_segundo_plano_aparece_generando` | `GET /api/imagenes` trae `pendientes` (la llave puede faltar: servidor local o anterior); cada una `generando` sale al principio de «Mis creaciones» con la tarjeta «Generando…» de siempre, cuenta en el filtro «Imágenes» y basta para que no salgan los tres caminos de quien empieza |
| `inicio.galeria.una_imagen_que_fallo_dice_por_que` | una `error` de la última hora deja de girar: «Con error» y el mensaje del servidor, con el texto que se pidió; un error que ya estaba al abrir la página no refresca el saldo |
| `inicio.galeria.una_imagen_que_pasa_a_error_se_anuncia` | la tarjeta que pasa de «Generando…» a «Con error» se anuncia a un lector de pantalla: el mensaje vive en una región `aria-live="polite"` que ya estaba en la tarjeta mientras giraba (sin `role="alert"`: al abrir la página con errores de la última hora no suenan todos) |
| `inicio.galeria.se_actualiza_sola_mientras_una_imagen_se_hace` | mientras haya una `generando` la lista se vuelve a pedir cada 5 s (junto a los clips); al quedar lista aparece como cualquier imagen y, sin nada generándose, para |
| `inicio.galeria.una_imagen_que_pasa_a_error_refresca_el_saldo` | cuando una que se veía `generando` pasa a `error`, el worker ya devolvió los créditos: se refresca el saldo (una sola vez) y se deja de preguntar |
| `inicio.galeria.si_falla_la_lista_de_imagenes_a_media_espera_no_se_pierde_el_pedido` | si una relectura de `/api/imagenes` falla, el pedido sigue a la vista y se sigue preguntando |
| `inicio.galeria.una_lectura_con_los_pedidos_sin_leer_a_media_espera_no_borra_el_pedido_ni_apaga_el_sondeo` | lo mismo con un 200 que no pudo leer los pedidos (`pendientes_ok: false`): el pedido sigue a la vista, las imágenes que sí vinieron se enseñan y se sigue preguntando; solo una lectura buena que ya no lo trae lo quita y para el sondeo |
| `inicio.listas.textos_del_server_como_texto` | briefs y nombres con HTML se leen como texto (React escapa; ya no hace falta `esc`) |
| `inicio.menu.entradas_y_grupos_en_orden` | las 7 entradas y sus destinos; Estudio de Contenido → Blotato → Publicidad Automática (MIX debajo de su requisito); nada dice «próximamente» |
| `inicio.menu.sin_clave_se_apagan_las_cuatro_de_blotato_y_ofrecen_conectar` | sin clave se apagan agenda, competencia (a propósito, dueño 18-sep), métricas y MIX; el clic abre conectar en vez de navegar |
| `inicio.menu.si_no_se_sabe_no_se_apaga_nada` | si `/api/blotato` falla, nada se apaga |
| `inicio.menu.pregunta_ligero` | el menú pregunta con `?redes=0`, sin gastar una llamada a Blotato |
| `inicio.blotato.mas_abre_el_dialogo_con_las_redes` | el «+» (o ✓) abre el diálogo, no un alert, con las redes conectadas |
| `inicio.blotato.aviso_del_cobro_con_el_precio_del_server_antes_del_campo` | el cobro de Blotato se avisa ANTES del campo, con el precio que manda el server (`pricing.json` nunca entra al cliente) |
| `inicio.blotato.clave_password_sin_autocompletar` | `type=password`, sin autocompletar, corrector ni mayúsculas |
| `inicio.blotato.la_clave_se_borra_al_conectar_cancelar_y_cerrar` | la clave se manda una vez, sin espacios, y se vacía al conectar, al cancelar y al cerrar; nunca queda escrita en la página |
| `inicio.blotato.sin_clave_no_manda_nada` | «Pega tu clave de Blotato primero.» y ningún POST |
| `inicio.blotato.error_del_server_se_dice_en_el_dialogo` | el error del server en el diálogo y Conectar vuelve a servir |
| `inicio.blotato.clave_del_env_no_se_ofrece_desconectar` | con la clave del `.env` lo dice y no ofrece Desconectar |
| `inicio.blotato.desconectar_pide_confirmar` | Desconectar pide confirmación; al desconectar, el menú se apaga |
| `inicio.blotato.viene_del_editor_con_blotato_conectar` | `?blotato=conectar` abre el diálogo al llegar |
| `inicio.blotato.enlace_a_la_api_con_noopener` | «Blotato → Settings → API» en otra pestaña con `noopener noreferrer` |
| `inicio.blotato.conectar_enciende_el_menu` | al conectar, las cuatro entradas se encienden |
| `inicio.marco.sin_version_anterior` | Sin «Usar la versión anterior» (se quitó el 28-sep; `/ui/clasica` sigue a mano) |
| `inicio.edicion.el_riel_tiene_tres_familias_con_aria_pressed_y_arranca_en_video` | el riel dice Imagen · Video · Edición (icono `cortar`) con `aria-pressed`; la caja sigue ARRANCANDO en Video; Edición trae el campo «Cuéntale a la IA qué quieres» (`aria-required`, el hueco exacto, 2000 caracteres) y el título sigue siendo «¿Qué vamos a crear hoy?» |
| `inicio.edicion.sin_video_el_boton_es_editar_sin_precio_apagado_enfocable_y_avisa` | sin video: «Editar» sin precio, `aria-disabled` (no `disabled`: se puede enfocar) y, al tocarlo, avisa «Primero agrega el video: pulsa el «+» o arrástralo a la caja.» en el cuadro; sin ninguna petición |
| `inicio.edicion.con_texto_y_sin_video_la_ayuda_dice_donde_agregarlo` | con texto y sin video, la línea «Agrega el video con el «+» o arrástralo a la caja.» reemplaza a «Escribe qué quieres hacer…» |
| `inicio.edicion.una_idea_pone_su_texto_en_el_campo_y_le_da_el_foco` | las 4 ideas (Quita muletillas y silencios · Un short vertical para Reels · Resumen de 60 segundos · Subtítulos grandes y un título): tocar una pone ese texto (reemplaza, no suma) y le da el foco al campo |
| `inicio.edicion.subir_muestra_progreso_real_y_el_precio_llega_del_servidor_al_terminar` | la subida usa `nucleo/subida` (config, presign, PUT con progreso, confirmar): el nombre del proyecto sale del archivo, la tarjeta dice nombre, formato y tamaño, `role=progressbar` con el avance real, el botón dice «Subiendo…» y «Cuando termine de subir calculamos el precio…»; el precio SOLO se pide al terminar y es el del servidor (la prueba usa un número que no está en ninguna tarifa); la tarjeta gana la duración medida («12:04 · MP4 · 824 MB») |
| `inicio.edicion.el_precio_del_servidor_8_sin_transcript_y_2_con_transcript` | ✦ 8 para 724 s sin transcripción y ✦ 2 con ella: los muestra tal cual los manda el servidor, y la prueba comprueba que coinciden con `tarifas.json` (`editar.sugerencias` + `shorts.transcripcion_por_5min` × bloques de 5 min) |
| `inicio.edicion.sin_texto_el_boton_con_precio_sigue_enfocable_lleva_el_foco_al_campo_y_no_avisa` | con video y sin texto: «Editar ✦ N» apagado con `aria-disabled` (sigue enfocable) y descrito por «Escribe qué quieres hacer con tu video, o toca una idea.»; tocarlo lleva el foco al campo y NO abre aviso; escribir lo enciende |
| `inicio.edicion.un_aviso_del_servidor_apaga_el_boton_sin_precio_y_lleva_el_foco_al_mas` | si `/costo` trae `aviso` (fuera de 1–90 min, falta la transcripción en nube…) se enseña tal cual, «Editar» queda sin precio y apagado aunque haya texto, y tocarlo lleva el foco al «+» (cambiar el video), sin aviso |
| `inicio.edicion.lanzar_manda_solo_la_instruccion_y_vacia_la_caja_y_refresca_el_saldo` | `POST /api/editar/<p>/sugerir` con SOLO `{instruccion}` (recortada): nunca créditos en el cuerpo; se modera ANTES; la línea «Tienes ✦ 269; después te quedan ✦ 261.» antes de pulsar; tras lanzar la caja se vacía (texto y video), el saldo se refresca, vuela el «−N» con lo que cobró el servidor y el foco no se pierde (es el mismo botón) |
| `inicio.edicion.doble_clic_en_editar_es_una_sola_peticion` | dos clics en el mismo tic = UN moderar y UN sugerir (el candado se cierra antes del primer `await`); mientras espera el botón dice «Editando…» y no acepta otro |
| `inicio.edicion.sin_saldo_el_boton_se_apaga_y_dice_cuanto_falta_con_recargar` | si el saldo conocido no alcanza: botón apagado, «Tienes ✦ S: no alcanza para editar este video.» y «Te faltan ✦ N · Recargar» (el componente `Recarga`); tocarlo no pide nada |
| `inicio.edicion.402_del_servidor_dice_te_faltan_y_no_cobra_ni_vacia_la_caja` | si el servidor contesta 402 (el saldo de la píldora estaba atrasado): «Te faltan ✦ N · Recargar» (N sale del detalle del 402), el saldo se refresca, ningún «−N», y el video y el texto se quedan para reintentar |
| `inicio.edicion.402_con_la_recarga_cerrada_dice_la_salida_de_la_interfaz` | con la recarga cerrada (`window.monedero.recarga` false) no hay botón «Recargar» muerto: sale el texto `cta` del monedero (`tests/test_m4_recarga_cerrada.py`) |
| `inicio.edicion.502_avisa_y_refresca_el_saldo_porque_el_servidor_devolvio_los_creditos` | 502 (no se pudo lanzar): el mensaje del servidor al cuadro, el saldo se refresca (el servidor devuelve los créditos), ningún «−N» y la caja conserva texto y video |
| `inicio.edicion.un_gate_del_servidor_se_dice_tal_cual_y_no_se_empieza_otra_cosa` | 413/422 (gate de duración, ANTES de cobrar) y demás errores: el mensaje del servidor tal cual al cuadro; el texto se conserva |
| `inicio.edicion.si_otra_cuenta_tiene_el_nombre_se_reintenta_una_vez_con_nombre_alterno` | 409 al firmar = el nombre del proyecto es de otra cuenta: se reintenta UNA vez con `nombreAlterno` y el precio se pide por el proyecto que sí se reservó |
| `inicio.edicion.un_409_que_se_repite_no_reintenta_otra_vez_y_lo_dice` | si el reintento también da 409: dos firmas en total, ninguna subida, el error al cuadro y la caja sin video |
| `inicio.edicion.una_tarea_a_la_vez_avisa_durante_la_subida_y_durante_la_corrida` | durante la subida y mientras la corrida lanzada siga `corriendo`, «+» y «Editar» avisan «Ya hay un trabajo en curso. Cuando termine puedes empezar otro.» (el «+» queda `aria-disabled`); el sondeo de `GET /api/editar/<p>` es PEREZOSO (solo tras lanzar, cada 5 s), al terminar refresca el saldo y se detiene. El servidor aún no tiene candado por cuenta: este aviso es de la pantalla |
| `inicio.edicion.un_409_de_ya_corre_pasa_a_una_tarea_en_curso` | si el servidor dice 409 («ya está en curso») la pantalla también lo sabe desde ahí: nada empieza hasta que termine |
| `inicio.edicion.cambiar_de_familia_y_volver_conserva_texto_y_video_y_no_cancela_la_subida` | el estado vive en `useEdicion` (llamado desde `Caja`): cambiar a Video o Imagen y volver conserva el texto y el video, y una subida a medias sigue (no se aborta) y termina con su precio |
| `inicio.edicion.quitar_durante_la_subida_la_cancela_sin_error_y_no_pide_precio` | «Cancelar la subida» aborta el PUT, no es un error de nadie (ningún aviso), no confirma ni pide precio, y el foco vuelve al «+» |
| `inicio.edicion.quitar_un_video_listo_deja_la_caja_para_otro` | «Quitar este video» vacía la tarjeta, el botón vuelve a «Editar» sin precio y el foco va al «+» (que ahora dice «Agregar el video que quieres editar») |
| `inicio.edicion.soltar_un_video_en_la_caja_lo_sube_y_pegar_se_ignora` | soltar un video en la caja de Edición lo sube (si no es video, lo dice; si son varios toma el primero y lo dice); pegar (Ctrl+V) NO agrega nada en esta familia |
| `inicio.edicion.un_archivo_que_no_sirve_se_rechaza_con_su_motivo_antes_de_subir` | solo .mp4, .mov y .m4v, hasta 5 GB (los mismos límites que `/api/media/presign`); lo demás se rechaza con su motivo ANTES de pedir permiso de subida |
| `inicio.edicion.si_no_hay_subidas_en_esta_instalacion_lo_dice_sin_intentar` | si `/api/media/config` dice que no hay subidas, se dice y no se firma nada |
| `inicio.edicion.si_el_precio_no_llega_el_video_se_queda_y_editar_lo_vuelve_a_pedir` | si el precio falla el video subido se queda, el error va al cuadro y tocar «Editar» vuelve a pedir SOLO el precio (no se sube otra vez) |
| `inicio.edicion.una_instruccion_que_la_moderacion_frena_no_llega_al_servidor` | M13: una instrucción vetada por la moderación no llega a `/sugerir` ni cobra, y el texto se conserva |
| `inicio.edicion.sin_el_cuadro_de_avisos_lo_que_se_dice_sale_junto_a_la_caja` | en una página sin `window.avisos` (tests, vitrina) lo que dice la caja de Edición sale junto a ella (`role=alert`), y se quita al corregirlo |
| `inicio.edicion.todo_lo_tocable_mide_al_menos_44_px` | el riel, las ideas, el «+», «Editar» y la ✕ de la tarjeta miden al menos 44 px (clases `min-h-11`/`min-h-12`/`size-11`/`size-12`) |
| `inicio.edicion.ninguna_peticion_al_montar_ni_al_abrir_la_familia` | el Inicio entero: montar y abrir la familia Edición no piden NADA de `/api/editar`, `/api/media` ni `/api/moderar`; las peticiones de Edición son perezosas (`servidor()` de las pruebas y el e2e fijan las rutas del montaje) |
| `inicio.edicion.el_boton_apagado_enfocable_no_usa_disabled_ni_opacidad_y_si_recibe_el_clic` | `<Boton apagado>`: `aria-disabled`, sin `disabled`, el apagado de la carta (borde discontinuo, gris; DISENO §5), sin ámbar a media opacidad, sin hover, y el clic SÍ llega a `onClick` |
| `inicio.edicion.si_la_subida_falla_se_dice_y_la_caja_queda_lista_para_elegir_otro` | si el PUT falla o no hay red, se dice y la caja queda sin video, lista para elegir otro |
| `inicio.edicion.el_boton_sigue_el_orden_sin_video_subiendo_sin_precio_aviso_sin_texto_sin_saldo_listo` | `estadoDelBoton`: sin video → subiendo → calculando → sin precio → aviso del servidor → sin texto → sin saldo → listo; un aviso manda sobre el texto y el saldo; un saldo que no se sabe no bloquea |
| `inicio.edicion.el_reloj_el_tamano_y_lo_que_falta_tras_un_402` | `reloj` («12:04», «1:18:00»), `tamano` («824 MB», «1.4 GB») y `faltanTras402` (lee «…cuesta 8 créditos y tu saldo es 5.»; sin ese texto usa el saldo conocido) |
| `inicio.edicion.el_mando_de_la_caja_elige_edicion_y_le_da_el_foco_al_campo` | `MandoCaja.elegir('edicion')` (la caja la ofrece a quien la monta, como `elegir('videos', …)`): cambia a Edición y le da el foco al campo aunque ese campo se monte en el render que sigue; las otras familias siguen eligiendo su opción |
| `inicio.edicion.mientras_sale_el_pedido_la_x_de_la_tarjeta_no_quita_el_video` | entre el clic en «Editar ✦ N» y la respuesta del servidor, la ✕ de la tarjeta queda `aria-disabled` y no quita el video (el pedido no se deja a medias) |
| `inicio.edicion.enter_repetido_en_editar_es_una_sola_peticion` | Enter pulsado (o mantenido) tres veces sobre «Editar ✦ N» = UN moderar y UN sugerir y UN «−N»; con la caja ya vaciada otro Enter no lanza nada |
| `inicio.edicion.clic_durante_el_402_y_el_502_en_vuelo_no_duplica_y_despues_se_puede_reintentar` | clics mientras el pedido vuela no mandan otro; tras un 402 (sin cobro) o un 502 (el servidor devolvió) el botón vuelve a servir y el reintento sale UNA vez; al reintentar desaparece el «Te faltan» viejo; tres pedidos, UN cobro |
| `inicio.edicion.cambiar_de_familia_a_mitad_del_cobro_lo_termina_y_al_volver_la_caja_esta_vacia` | irse a Video con el pedido en vuelo no lo cancela: el cobro termina, vuela el «−N», la caja vuelve vacía y «+»/«Editar» avisan que hay una corrida en curso |
| `inicio.edicion.un_402_que_llega_en_otra_familia_se_ve_al_volver_y_no_pierde_nada` | un 402 que llega con la persona en otra familia se ve al volver («Te faltan ✦ N · Recargar»), conserva texto y video, no cobra, y cuando monedero.js trae el saldo de verdad la línea no se repite ni se contradice |
| `inicio.edicion.quitar_con_el_precio_en_camino_y_subir_otro_ignora_la_respuesta_vieja` | quitar un video mientras se calcula su precio y subir otro: el precio tardío del primero no se lo queda el segundo |
| `inicio.edicion.un_archivo_nuevo_sobre_un_video_listo_lo_reemplaza_y_el_pedido_va_al_proyecto_nuevo` | un video nuevo sobre uno listo lo reemplaza (precio nuevo, texto conservado) y «Editar» pide el proyecto nuevo, nunca el viejo |
| `inicio.edicion.otro_archivo_durante_la_subida_avisa_y_no_empieza_otra_subida` | soltar o elegir otro archivo mientras sube avisa «Ya hay un trabajo en curso…» y no abre una segunda subida |
| `inicio.edicion.los_nombres_raros_de_archivo_dan_un_proyecto_que_el_servidor_acepta_o_se_rechazan_con_motivo` | acentos, espacios, mayúsculas, 200 caracteres, solo símbolos o solo guiones bajos (`_.mp4`): el nombre del proyecto siempre es válido para el servidor (≤ 40, letras o cifras, `mi-video` si no queda nada); un archivo llamado solo «.mp4» o de 0 bytes se rechaza con su motivo ANTES de pedir permiso |
| `inicio.edicion.un_nombre_que_ya_es_un_proyecto_tuyo_con_video_se_estrena_con_nombre_nuevo` | antes de firmar se pregunta `GET /api/media/<p>`: si ese nombre ya es un proyecto tuyo con video (otro «final.mp4») se estrena un nombre con `nombreAlterno`, para no mezclar el video nuevo con la transcripción y los cortes del viejo; el 409 de otra cuenta sigue reintentando UNA vez |
| `inicio.edicion.si_no_se_puede_saber_si_el_nombre_ya_existe_se_sube_con_el_nombre_del_archivo` | si esa pregunta falla (5xx, sin red) la subida sigue con el nombre del archivo: preguntar no frena |
| `inicio.edicion.un_precio_que_no_es_un_numero_no_se_ensena_ni_se_deja_cobrar` | un `creditos` que no es un entero ≥ 0 (null, texto, NaN, negativo, con decimales) cuenta como «sin precio»: «Editar» sin ✦, apagado (nunca «✦ 0» ni «✦ NaN»), tocarlo vuelve a pedir el precio y no modera ni cobra; una duración que no es número no rompe la tarjeta |
| `inicio.edicion.si_el_precio_nunca_llega_se_puede_quitar_el_video_y_empezar_de_nuevo` | si `/costo` no contesta nunca, «Calculando…» no cobra y la ✕ sigue quitando el video para empezar de nuevo (el texto se conserva) |
| `inicio.edicion.un_campo_con_solo_espacios_saltos_o_invisibles_esta_vacio_y_no_enciende_el_boton` | un campo con solo espacios, saltos, NBSP, ancho cero, marcas bidi o «etiquetas» U+E00xx está vacío: el botón sigue apagado, la ayuda sigue pidiendo texto y no se pide nada (`limpiarInstruccion` copia la limpieza del servidor, `limpiar_instruccion`) |
| `inicio.edicion.la_instruccion_que_viaja_es_la_limpia_y_es_la_misma_que_se_modera` | lo que se manda a `/sugerir` y a `/api/moderar` es la instrucción limpia (sin invisibles, tabuladores a espacio, `\r\n` a salto), la misma que verá la IA |
| `inicio.edicion.el_campo_limita_a_2000_y_si_algo_pasa_el_servidor_es_la_autoridad` | pegar 2500 caracteres deja 2000; si uno de más se cuela, NO se recorta en silencio: el 422 del servidor (antes de cobrar) se dice tal cual, sin «−N», y texto y video se conservan |
| `inicio.edicion.si_el_saldo_cambia_despues_del_precio_el_boton_lo_sigue_antes_de_cobrar` | si el saldo baja (o sube) después de mostrar el precio, el botón se apaga con «Te faltan» (o se enciende) sin pedir nada; el servidor sigue siendo quien decide |
| `inicio.edicion.si_la_respuesta_del_cobro_se_pierde_el_saldo_se_pone_al_dia_y_el_reintento_cae_en_ya_corre` | si se cae la red con el pedido en el aire (o hay un 409/5xx) el servidor pudo haber cobrado: el saldo de la píldora se refresca, no vuela ningún «−N» ni se vacía la caja (no se sabe), y el reintento recibe el 409 «ya corre» que pasa a corrida en curso |
| `inicio.edicion.el_menos_n_sale_de_lo_que_cobro_el_servidor_no_del_precio_de_la_pantalla` | el «−N» que vuela es el `creditos` de la respuesta del servidor aunque el precio de la pantalla fuera otro |
| `inicio.edicion.ningun_cuerpo_de_ninguna_peticion_lleva_creditos_ni_precio` | en todo el flujo (permiso de subida, confirmar, moderar, sugerir) ningún cuerpo habla de créditos, precio, costo ni saldo; el de `/sugerir` es solo `{instruccion}` |
| `inicio.edicion.si_la_moderacion_se_cae_el_pedido_sigue` | M13: un filtro caído (5xx) no frena el pedido |
| `inicio.edicion.lo_que_se_escribe_mientras_sale_el_pedido_no_se_borra` | lo que la persona escribe mientras sale el pedido no es lo que se mandó y no se borra al vaciar la caja |
| `inicio.edicion.quitar_mientras_se_confirma_la_subida_no_pide_precio_ni_dice_nada` | cancelar con el PUT ya terminado y el «confirmar» en camino: no se pide precio ni se dice nada cuando la respuesta tarda en llegar |
| `inicio.edicion.cancelar_o_desmontar_mientras_se_pide_el_permiso_de_subida_no_sube_nada` | cancelar o desmontar la caja mientras el servidor firma: cuando llega el permiso no se abre ningún PUT |
| `inicio.edicion.desmontar_la_caja_a_mitad_de_la_subida_la_cancela_y_no_confirma_nada` | desmontar la caja con la subida a medias aborta el PUT, no confirma ni pide precio y no deja avisos de React |
| `inicio.edicion.desmontar_con_la_corrida_en_curso_deja_de_preguntar_y_no_deja_avisos_de_react` | desmontar con la corrida lanzada detiene el sondeo (cero preguntas después) y no deja avisos de React; el sondeo sigue siendo perezoso |
| `inicio.edicion.el_sondeo_se_libera_con_un_404_y_un_error_del_servidor_no_cuenta_como_terminado` | un 404 al preguntar por la corrida (el proyecto ya no existe) libera la caja; un 5xx no dice que terminó y se sigue preguntando |
| `inicio.edicion.una_pregunta_que_nunca_vuelve_no_bloquea_la_caja_mas_de_2_horas` | el tope de 2 h (el que usa el servidor para dar por caducada una corrida) se cuenta con el reloj, no con una respuesta: si el servidor no contesta nunca, la caja se libera y el saldo se refresca |
| `inicio.edicion.el_campo_conserva_el_aro_de_foco_y_su_ejemplo_se_lee_con_el_gris_secundario` | el campo de Edición NO lleva `outline-none`: el aro ámbar de la carta (§4, «sin excepción») sigue saliendo cuando se le lleva el foco desde «Editar» o desde una idea; y su ejemplo (placeholder) usa `placeholder:text-secundario` (6.45:1 sobre la superficie) y no el 50 % del texto de Tailwind (4.39:1, no pasa AA). La prueba lee `tokens.css` y calcula los dos contrastes; el navegador real lo comprueba `web/e2e/inicio-edicion.spec.ts` |
| `inicio.edicion.el_campo_crece_para_que_su_ejemplo_no_se_corte_en_un_telefono` | el ejemplo del campo ocupa 4 renglones en 390 px (90 px) y a 320 px 5: el piso de 96 px en teléfono (`min-h-24`; 68 px desde 640 px, donde el ejemplo cabe en 3 renglones de 67.5 px) y `field-sizing-content` (que crece hasta lo que haga falta, con tope `max-h-56`) evitan que se corte «para Reels.»; el lienzo lo muestra entero |
| `inicio.edicion.subiendo_y_calculando_se_ven_trabajando_en_ambar_con_cursor_de_espera_y_el_clic_avisa` | «Subiendo…» y «Calculando…» son el «Trabajando» de la carta (§5) y del lienzo (`.btn.p.trab`): ámbar, `cursor-progress`, `aria-busy` y `aria-disabled`, sin el borde discontinuo del apagado, descritos por su nota; el clic sigue llegando y avisa «Ya hay un trabajo en curso…»; con el precio vuelve el apagado gris de siempre |
| `inicio.edicion.cada_apagado_se_explica_con_su_propia_linea` | `aria-describedby` en cada apagado: sin video y con texto → «Agrega el video con el «+»…»; sin precio → «No pudimos calcular el precio…»; sin saldo → «Tienes ✦ S: no alcanza…» (antes solo «sin texto» y «fuera de rango» tenían su línea) |
| `inicio.edicion.el_recargar_mide_44_px_aunque_su_letra_sea_chica` | con la recarga abierta, «Recargar» (un enlace de una línea de letra de 13 px) trae `min-h-11 min-w-11` y márgenes negativos que lo devuelven al renglón, y su aro de foco va por dentro; medido en un navegador de verdad: 44 × 44 y la nota no crece |
| `inicio.edicion.el_aviso_de_trabajo_en_curso_se_quita_solo_cuando_ese_trabajo_termina` | como el lienzo (`aviso === 'ocupada' → ''`): «Ya hay un trabajo en curso…» se quita solo cuando la subida termina y llega el precio, y cuando el servidor dice que la corrida terminó; no antes, y no dos veces |
| `inicio.edicion.si_otro_aviso_reemplazo_al_de_trabajo_en_curso_no_se_quita_nada` | si otro mensaje tomó el lugar de ese aviso (misma clave), p. ej. el error de una subida que falló, no se quita nada: es lo que la persona tiene que leer |

## Cada aserción vieja y su destino

Al pasar a `retirada` se borran (o se recortan) estos tests junto con
`static/index.html`.

### tests/test_ui10_inicio.py

| Test viejo | Destino |
|---|---|
| `test_sin_recursos_externos` | `tokens.css` y las fuentes propias; `test_web_tuberia.py` vigila `web/` |
| `test_el_inicio_carga_la_carta_antes_que_su_estilo` | `tokens.css` es la carta; no hay estilo propio que ordenar |
| `test_un_solo_acento_y_en_un_solo_boton` | el único ámbar de fondo es «Crear» (y Conectar dentro del diálogo); los bordes al pasar van a `border-campo` |
| `test_titulos_en_bricolage_y_texto_en_geist` | `tokens.css` (`h1, h2` en `font-titulo`) y `font-titulo` en los `h3` de los caminos |
| `test_sin_tamanos_de_letra_fuera_de_la_escala` | `tokens.css` borra la escala de Tailwind: fuera de los seis tamaños no compila |
| `test_sin_emojis_como_iconos` | guardianes M19/M21 sobre `web/` e `<Icono>` |
| `test_cada_entrada_del_menu_lleva_icono` | `GRUPOS` en `Inicio.tsx`: cada `Entrada` exige `icono`; `inicio.menu.entradas_y_grupos_en_orden` cuenta las 7 |
| `test_los_iconos_que_usa_el_inicio_existen` | TypeScript: `NombreIcono` |
| `test_el_saldo_se_queda_en_la_pildora_de_arriba` | el inicio nuevo no pinta saldo: lo hace la píldora de `monedero.js` |
| `test_los_tres_caminos` | `inicio.caminos.enlaces_a_shorts_y_metraje`; los botones son `secundario` |
| `test_los_caminos_solo_con_las_cuatro_listas_bien_y_vacias` | `inicio.caminos.solo_con_todas_las_listas_bien_y_vacias` e `inicio.carga.sin_proyectos_avisa_y_reintentar` |
| `test_desde_una_idea_no_cobra_solo_elige` | `inicio.caminos.desde_una_idea_no_cobra_solo_elige` |
| `test_el_js_del_inicio_y_los_iconos_son_validos` | `tsc` y `npm run build` |

### tests/test_ui16_index.py

| Test viejo | Destino |
|---|---|
| `test_el_err_suelto_ya_no_existe` | los avisos van dentro de la pantalla (`<Aviso>`) |
| `test_lo_que_se_queda_en_su_sitio` | `inicio.caja.sin_texto_no_navega`, `inicio.blotato.sin_clave_no_manda_nada`, `inicio.proyectos.archivar_pide_confirmar`, `inicio.blotato.desconectar_pide_confirmar` |
| `test_accion_va_al_cuadro_con_su_clave` | `inicio.proyectos.error_al_archivar_dice_el_motivo` (el aviso va en la pantalla, no en el cuadro) |
| `test_cargar_avisa_con_reintentar_y_quita_al_cargar_bien` | `inicio.carga.sin_proyectos_avisa_y_reintentar` |
| `test_la_carga_que_falla_avisa_una_vez_por_clave_y_reintentar_la_quita` | `inicio.carga.sin_proyectos_avisa_y_reintentar` (un solo aviso: es estado, no una pila) |
| `test_archivar_avisa_el_motivo_y_en_exito_lo_quita` | `inicio.proyectos.error_al_archivar_dice_el_motivo` |

### tests/test_m23_blotato_clave_ui.py

| Test viejo | Destino |
|---|---|
| `test_el_mas_de_blotato_abre_el_modal_y_no_un_alert` | `inicio.blotato.mas_abre_el_dialogo_con_las_redes` |
| `test_el_campo_de_la_clave_no_se_ve_ni_se_autocompleta` | `inicio.blotato.clave_password_sin_autocompletar` |
| `test_la_clave_se_borra_del_campo_al_conectar_y_al_cerrar` | `inicio.blotato.la_clave_se_borra_al_conectar_cancelar_y_cerrar` |
| `test_el_modal_avisa_del_cobro_de_blotato_con_el_precio_del_servidor` | `inicio.blotato.aviso_del_cobro_con_el_precio_del_server_antes_del_campo` |
| `test_el_modal_lleva_a_la_pagina_de_la_api_de_blotato` | `inicio.blotato.enlace_a_la_api_con_noopener` |
| `test_el_menu_pregunta_sin_gastar_llamadas_a_blotato` | `inicio.menu.pregunta_ligero` |
| `test_la_clave_del_env_no_se_ofrece_desconectar` | `inicio.blotato.clave_del_env_no_se_ofrece_desconectar` |
| `test_el_inicio_abre_el_modal_si_viene_del_editor` | `inicio.blotato.viene_del_editor_con_blotato_conectar` y `test_migracion.py::test_el_inicio_en_todos_lleva_el_query_a_la_nueva` |
| `test_ya_no_queda_ninguna_seccion_proximamente` | `inicio.menu.entradas_y_grupos_en_orden` |
| `test_la_competencia_es_un_enlace_y_ya_no_dice_proximamente` | `inicio.menu.entradas_y_grupos_en_orden` |
| `test_la_agenda_es_un_enlace_y_ya_no_dice_proximamente` | `inicio.menu.entradas_y_grupos_en_orden` |
| `test_el_modal_ya_no_dice_que_programar_llega_pronto` | `inicio.blotato.aviso_del_cobro_con_el_precio_del_server_antes_del_campo` |
| `test_arrastrar_desde_el_campo_no_cierra_el_modal` | Radix cierra con `pointerdown` fuera: arrastrar desde el campo y soltar fuera no cierra |
| `test_en_el_telefono_el_inicio_no_se_desplaza_de_lado` | Playwright a 390 px (sin scroll horizontal); el menú se desplaza en su fila y las pistas tienen `max-w` contra la ventana |
| `test_el_modal_se_centra_pese_al_reset_de_margenes` | `<Dialogo>` (Radix) se centra con `translate`, no con `margin` |

### tests/test_m25_entrada.py (lo que mira el inicio)

| Test viejo | Destino |
|---|---|
| `test_el_precio_del_clip_sale_de_tarifas_json` | `inicio.caja.precios_de_tarifas_json` |
| `test_las_historias_ensenan_el_rango_real_de_su_tabla` | `inicio.caja.precios_de_tarifas_json` |
| `test_el_precio_de_las_imagenes_sale_de_tarifas_json` | `inicio.caja.precios_de_tarifas_json` |
| `test_arranca_en_el_clip` | `inicio.caja.arranca_en_el_clip_lo_mas_barato` |
| `test_los_rotulos_son_los_que_eligio_el_dueno` | `inicio.caja.cada_opcion_lleva_a_su_destino_con_su_modo` (los busca por rótulo) |
| `test_los_chips_viejos_ya_no_estan` | `OPCIONES` en `logica.ts` no los tiene |
| `test_las_imagenes_por_fin_tienen_puerta` | `inicio.caja.cambiar_de_familia_elige_la_primera` |
| `test_el_clip_va_a_su_pantalla` | `inicio.caja.el_envio_va_en_el_pie_del_menu_de_modelo` (el clip ya no navega: se pide en la caja) |
| `test_las_etiquetas_internas_van_al_reves_de_lo_que_suenan` | `inicio.caja.cada_opcion_lleva_a_su_destino_con_su_modo` |
| `test_el_inicio_manda_el_texto_con_el_nombre_que_espera_cada_pantalla` | `inicio.caja.cada_opcion_lleva_a_su_destino_con_su_modo` |
| `test_lo_que_ya_esta_en_la_caja_no_se_repite_en_el_menu` | `inicio.menu.entradas_y_grupos_en_orden` |
| `test_las_de_blotato_se_apagan_sin_clave` | `inicio.menu.sin_clave_se_apagan_las_cuatro_de_blotato_y_ofrecen_conectar` |
| `test_el_apagado_ofrece_conectar_en_vez_de_dejar_un_callejon` | `inicio.menu.sin_clave_se_apagan_las_cuatro_de_blotato_y_ofrecen_conectar` |
| `test_si_no_se_sabe_si_hay_clave_no_se_apaga_nada` | `inicio.menu.si_no_se_sabe_no_se_apaga_nada` |
| `test_el_triangulo_es_contenido_del_boton_y_va_a_la_derecha` | el ▾ va dentro del botón, al final (`Caja.tsx`), con `whitespace-nowrap` |
| `test_el_menu_se_sujeta_dentro_de_la_ventana` | el `useLayoutEffect` de `Caja.tsx` mide y sujeta el menú, también al redimensionar; Playwright a 390 px |
| `test_cada_opcion_cambia_el_ejemplo_del_hueco` | `inicio.caja.cada_opcion_cambia_el_ejemplo` |
| `test_mix_tiene_su_propio_grupo_en_el_menu` | `inicio.menu.entradas_y_grupos_en_orden` |
| `test_mix_va_debajo_de_blotato_porque_blotato_es_su_requisito` | `inicio.menu.entradas_y_grupos_en_orden` |

### Otros módulos que miran el inicio

| Aserción vieja | Destino |
|---|---|
| `test_m23_imagenes.py` (orden, abrir para editar, 5 y ver todas, JS válido) | `inicio.listas.orden_videos_imagenes_ediciones`, `inicio.imagenes.*` y `tsc` |
| `test_m23_crear_video.py::test_tus_peliculas_ya_no_vive_en_crear` (su última aserción) | `inicio.proyectos.cada_tarjeta_lleva_a_crear` |
| `test_m15_editor_imagenes.py::test_el_inicio_lleva_a_la_herramienta_unica_de_imagenes` | `inicio.caja.cada_opcion_lleva_a_su_destino_con_su_modo` e `inicio.menu.entradas_y_grupos_en_orden` |
| `test_m23_agenda_ui.py`, `test_m23_competencia_ui.py`, `test_m23_metricas_ui.py` (el hub los enlaza) | `inicio.menu.entradas_y_grupos_en_orden` |
| `test_ui12_pildora.py::test_el_inicio_en_celular_baja_el_titulo` | `pt-16` (64 px) en el contenedor, como el `Marco`: la píldora acaba a 52 |
| `test_ui14_todas.py[index]` | `tokens.css`; al retirar, `index` sale de la lista |
| `test_ui15_trabajos.py[index]` | se queda: la nueva **sí** carga `trabajos.js` después de `monedero.js` (`web/estudio/inicio/index.html`) |
| `test_ui_escapar.py` (la `esc` del inicio y sus plantillas) | `inicio.listas.textos_del_server_como_texto` (React escapa). Al retirar, `static/index.html` sale de la lista de `esc` esperadas |
| `test_m19_orbe.py` (favicon, sin motor GPU, sin `/monedero.html`, `check_js`) | favicon en `web/estudio/inicio/index.html` (ya lo mira `test_todas_las_paginas_tienen_favicon`); el inicio nuevo no carga el orbe |
| `test_m20_paleta.py` | ya mira `web/`. **Al retirar:** `rgba(0,0,0,0.533)` y `rgba(20,22,26,0.72/0.95)` solo viven en `static/index.html`: salen de `TRANSLUCIDOS` en el mismo PR |
| `test_m21_botones.py[index.html]` | el precio del desplegable es `{ESTRELLA} {precio}` en JSX, no una plantilla: no es un botón que cobre |
| `test_entrar_portada.py::test_estudio_sirve_el_mismo_index` | se queda mientras el inicio esté en `nueva`; al pasar a `todos` cambia a esperar el 302 (`test_migracion.py` ya lo prueba) |
| `test_cache_estaticos.py` (`/estudio/` y `/index.html` en `no-cache`) | se queda: `server/migracion.py` sirve la vieja con `no-cache` |

## Diferencias a propósito

- **Edición (dueño, 13-oct-2026):** la caja gana una TERCERA familia, Edición
  (riel Imagen · Video · Edición; la caja sigue arrancando en Video). En E1 es:
  un texto obligatorio («Cuéntale a la IA qué quieres…», con 4 ideas de un
  toque) + UN video que se sube desde el «+» o soltándolo en la caja + «Editar
  ✦ N». El precio lo da `GET /api/editar/<p>/costo` y lo cobra el servidor al
  lanzar `POST /api/editar/<p>/sugerir` con `{instruccion}`: nunca viajan
  créditos en el cuerpo. Sin confirmación (el precio ya está en el botón); sin
  saldo, «Te faltan ✦ N · Recargar». La IA ya editaba bien: no hay prueba
  previa de calidad. Se edita una COPIA: el archivo subido jamás se modifica, los
  cortes son versiones aparte y se auditan en el editor de siempre
  (`/editor/<nombre>/`); la tarea aparece sola en «Tus trabajos» (la ficha
  `editar` de `server/trabajos_api.py`). El estado (texto, video, subida, precio,
  corrida) vive en `useEdicion`, llamado desde `Caja`: cambiar de familia no lo
  pierde ni cancela la subida. Peticiones solo perezosas (al subir, al lanzar y
  el sondeo de después): nada al montar. Una tarea a la vez es un aviso de la
  pantalla (subida o corrida en curso): **pendiente en el servidor** un candado
  por cuenta, hoy solo hay 409 por proyecto. Lo que NO entra todavía (piezas
  posteriores): unir varios videos, elegir de Mis creaciones, copiar una
  creación, fundidos, título, música, Marcas, el editor conversacional y la
  bandeja de tres pasos. Lo que la instrucción pida y el motor de hoy (que solo
  QUITA tramos) no sepa hacer —formato vertical, subtítulos, música— no se
  aplica y llega como duda en el editor, no se calla; por eso conviene leer las
  ideas de la caja con ese límite en mente. El botón principal se apaga con
  `aria-disabled` (variante `apagado` de `<Boton>`, el apagado de la carta:
  borde discontinuo y gris, no el ámbar a media opacidad del lienzo), así sigue
  enfocable y explica por qué.

  *Revisión adversarial (dinero y flujos).* El **nombre del proyecto** sale del
  archivo (`nombreDeProyecto`: `mi-video` si no queda ninguna letra o cifra,
  porque el servidor rechaza `_`), pero ANTES de firmar se pregunta
  `GET /api/media/<p>`: si ese nombre ya es un proyecto TUYO con video (otro
  «final.mp4») se estrena uno con `nombreAlterno`. El servidor deja reusar un
  nombre propio, y entonces el video nuevo quedaría junto a la transcripción y
  los cortes del viejo (el precio saldría de menos, «ya hay transcripción», y la
  corrida editaría sobre tiempos de otro video). El 409 de otra cuenta sigue
  reintentando una vez. Lo que se manda a la IA es la instrucción **limpia**
  (`limpiarInstruccion`, la misma limpieza que `limpiar_instruccion` del
  servidor): un campo con solo caracteres invisibles cuenta como vacío. Un
  `creditos` que no es un entero ≥ 0 cuenta como «sin precio». Al desmontar la
  caja la subida se aborta y el sondeo se detiene; el sondeo se libera con un
  404 o al pasar 2 h aunque el servidor no conteste. Un archivo de 0 bytes o
  llamado solo «.mp4» se rechaza antes de pedir permiso.

  *Revisión visual y de accesibilidad (contra el lienzo Recorrido-2, medida en
  un navegador de verdad a 1440×900, 390×844 y 320 px).* Lo que se corrigió: el
  campo traía `outline-none` y al llevarle el foco desde «Editar» o una idea no
  se veía dónde caía (ahora conserva el aro de la carta); su ejemplo se leía a
  4.39:1 (el 50 % del texto) y ahora a 6.45:1, y en un teléfono se cortaba su
  último renglón; «Subiendo…» y «Calculando…» eran gris discontinuo (el apagado)
  cuando son el «Trabajando» de la carta, en ámbar; «Recargar», con la recarga
  abierta, medía 54 × 19 px; cada apagado ahora se explica con su línea
  (`aria-describedby`); y «Ya hay un trabajo en curso…» se quita solo cuando ese
  trabajo termina, como en el lienzo. Lo que **difiere a propósito** del lienzo:
  (1) el apagado es el gris discontinuo de la carta y no el ámbar a media
  opacidad; (2) «Te faltan ✦ N · Recargar» va junto al botón (`<Recarga>`,
  DISENO §5 y §8: el 402 se queda junto al botón que cobra) y no en el cuadro de
  avisos: ese cuadro es de `trabajos.js` y no puede pintar un componente de
  React; (3) sin Marca (chip, menú y «Administrar marcas…»), sin el menú del «+»
  ni la hoja «Agregar videos», sin la lista de varios videos: son piezas
  posteriores, así que el «+» abre directo el selector y se llama «Cambiar el
  video» cuando ya hay uno (el lienzo: «Agregar otro video»); (4) el campo se
  puede redimensionar (`resize-y`, como el de Imagen y Video; el lienzo lo
  fija); (5) el botón se llama «Editar ✦ N» a secas para el lector de pantalla
  (como todo botón que cobra del repo); el lienzo le pone `aria-label` «Editar
  por N créditos», pero M21 prohíbe «créditos» en el texto del botón y cambiarlo
  aquí solo dejaría un caso distinto: el arreglo es global (ocultar el ✦ y
  decir «créditos» en `BotonCobro`/`ESTRELLA`); (6) los límites del video
  (formatos y 5 GB) viven en el `title` del «+» y en el aviso del servidor, no en
  un menú.

- **Confirmaciones:** archivar y desconectar Blotato usan `<Confirmar>`
  (Radix, con el foco en Cancelar) en lugar de `confirm()`.
- **Avisos:** los de cargar y archivar van dentro de la pantalla (`<Aviso>`),
  no en el cuadro de `trabajos.js`. El cuadro **sí** se carga: en el inicio
  es donde más se mira «Tus trabajos».
- **Tarjetas:** la tarjeta entera sigue siendo el enlace, pero con un `<a>`
  de verdad (se puede abrir en otra pestaña). La X de archivar va por encima
  y dice qué archiva («Archivar «La historia del café»»).
- **Precios:** salen de `tarifas.json` en vez de estar escritos.
- **El desplegable:** es un `listbox` con teclado completo (↑ ↓ Inicio Fin
  Enter Esc).
- **Teléfono:** los grupos del menú y el «+» de Blotato siguen en la fila
  que se desplaza.
- **«Mis videos» (UI·26, dueño 28-sep):** «Mis proyectos» pasa a «Mis
  videos» y junta películas, clips de 8 s y shorts, lo más nuevo primero.
  Abajo de cada una va su tipo (Video largo, Video corto, Shorts, Cuento) en
  lugar de «lista · fecha»; el estado solo si falta algo. «Nueva película» es
  ahora «Nuevo video» y se ve siempre. Los slots y archivar siguen siendo
  solo de películas.
- **Duración del clip (R4, dueño 9-oct-2026, opción A):** el menú de modelo del
  clip trae arriba «Duración del clip» (4, 6 u 8 s; 8 por defecto). Los
  créditos son los de `tarifas.json` §modelos.clip, un objeto por duración
  (`{"4": 18, "6": 28, "8": 36}`, redondeados hacia arriba al par). Un modelo
  solo se ofrece en las duraciones que tienen número: en las demás su fila se
  atenúa y dice «Desde N s». Una duración sin número nunca cuesta cero ni cae
  en otra. La caja manda `segundos` en el pedido y el servidor calcula y cobra.
  El aviso `«<Modelo> empieza en N s. Te dejamos <Predeterminado>.»` va en
  la caja de `<Aviso>` (la carta prohíbe el ámbar suelto), no en texto ámbar
  como en el tablero. Imagen y editar no traen duración. La pantalla heredada
  `/clip.html` no cambia (8 s, 36 créditos).
