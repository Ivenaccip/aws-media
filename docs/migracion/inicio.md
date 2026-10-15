# Migración del inicio (UI·8.4)

`static/index.html` (servido en `/estudio/`) → `/estudio/inicio/`
(`web/src/pantallas/inicio/`).

El inicio **no decide ningún precio**: el servidor cobra. Reparte, y desde R4b también pide lo que elige modelo (un video corto, crear o editar una imagen); desde E1 también lanza la **edición** de un video subido (`POST /api/editar/<p>/sugerir`), con el precio que da `GET /api/editar/<p>/costo`. Tiene cuatro partes:

- **La caja** «¿Qué vamos a crear hoy?» lleva a la pantalla que cobra con el
  texto ya puesto, pide aquí lo que elige modelo y, en su tercera familia
  (**Edición**), sube un video y lanza la edición.
- **El recorrido** lleva a las herramientas: un mapa en X con las áreas, tres
  opciones por área y la pantalla (la caja, o la lista de las pantallas de un
  grupo). Es la tarjeta única del 15-oct-2026 y reemplazó al **menú de la
  izquierda** (ver «Diferencias a propósito»; los IDs `inicio.menu.*` conservan
  su nombre por historia).
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
| `nueva` | `/estudio/inicio/` existe; `/estudio/` sigue igual | el PR de la pantalla | ✅ en producción; la caja que cobra (R4 y Edición) llegó con el PR #160 (14-oct-2026) |
| `todos` | `/estudio/?q` → 302 a `/estudio/inicio/?q`, salvo la cookie `ui=clasica` | `etapa="todos"` + deploy | 14-oct-2026, decisión del dueño (con Nano Banana 2 fuera de «Editar») |
| `retirada` | 302 siempre; se borran `static/index.html` y sus tests viejos | `etapa="retirada"`, `git rm` + deploy | pendiente |

Antes de `todos`, el dueño corre el QA manual de `docs/QA-UI.md` § inicio.
**El inicio cobra** (desde R4b el clip y la imagen; desde E1 la edición de un
video, «Iniciar ✦ N»): los pasos del QA marcados con 💳 gastan créditos de
verdad y solo se corren con el «sí» del dueño. No hay interruptor por función:
al pasar el inicio a `todos` la familia Edición sale para todos de golpe, con
su cobro.

**14-oct-2026 — lo que abre `todos`, además de la Edición:** el clip y las
imágenes de la caja, con todo el catálogo de modelos; y la foto del personaje
de cuentos e historias, que lleva a la Crear **nueva** (`/estudio/crear/`, que
sigue en `nueva` y cobra el guion). Nano Banana 2 sale de «Editar» en el mismo
cambio (`docs/OPERACION.md`). No hay enlace visible a la clásica: a quien lo
necesite se le manda `/ui/clasica?pantalla=inicio`.

**15-oct-2026 — el recorrido reemplaza al menú de la izquierda (solo en la
nueva):** `static/index.html`, la clásica, **no se tocó**: conserva su menú, y
sus guardianes (`test_ui10_inicio.py`, `test_m25_entrada.py`…) siguen leyéndola
hasta `retirada`. Lo que se pierde al pasar del menú al recorrido está
inventariado abajo («Diferencias a propósito» y las filas `inicio.menu.*`). Esto
cambia lo que ve **toda** la gente que entra a `/estudio/inicio/`, así que antes
de que llegue a `main` el dueño corre en `docs/QA-UI.md` § inicio los pasos 43 a 70.

## Los invariantes (tests/test_migracion_ui.py)

Cada uno es un test de vitest con ese nombre exacto: los de `inicio.edicion.*`
en `web/src/pantallas/inicio/Edicion.test.tsx`; el resto, en `Inicio.test.tsx`
(y sus hermanos de la carpeta).

**Pruebas sueltas (15-oct-2026).** El recorrido nuevo (mapa, opciones, migas,
Esc, foco) y el modo «De videos a Shorts» son función **nueva**, no algo que la
pantalla vieja garantizara, así que sus pruebas no llevan el prefijo `inicio.` y
el guardián no exige registrarlas: `recorrido.test.ts` (el estado y la entrada
por URL, sin React), `Recorrido.test.tsx` (la tarjeta), `Mapa.test.tsx` (el mapa
y las tres opciones), `Pantallas.test.tsx` (la lista de un grupo),
`EdicionShorts.test.tsx` (el modo Shorts de la caja) y, fuera de esta carpeta,
`src/marca/Marco.test.tsx` (las migas de las hojas y su guardián de deriva con
`menu.ts`), más los e2e `inicio-recorrido.spec.ts`, `inicio-shorts.spec.ts` e
`inicio-caja.spec.ts`. Lo que **sí** viene de la pantalla vieja (las puertas del
menú, la regla de Blotato, el título) conservó sus IDs `inicio.menu.*` e
`inicio.blotato.*`: la tabla de abajo dice cómo cambió lo que cada uno afirma.

| ID | Qué garantiza |
|---|---|
| `inicio.caja.arranca_en_el_clip_lo_mas_barato` | arranca en Video → «Un video corto» con su modelo de siempre (Veo 3.1 Lite), para quien no abra el menú (M25 · B); el chip de la tarea ya no lleva precio |
| `inicio.caja.precios_de_tarifas_json` | las historias con el rango mín–máx de `video.por_duracion`; las tareas que eligen modelo (clip, imagen, editar) dicen «según el modelo» y su precio sale de `tarifas.json` §modelos; el test compara contra el mismo `tarifas.json` |
| `inicio.caja.cada_opcion_lleva_a_su_destino_con_su_modo` | las tareas SIN modelo siguen llevando a su pantalla: cuentos → `/crear.html?…&modo=investigacion`; historia → `modo=idea`; el texto va sin espacios de más. SIN foto del personaje la dirección es la de siempre, byte a byte; con foto va a `/estudio/crear/?…&refs=…` (ver `inicio.caja.crear_con_foto_*`). (Clip e imágenes ya no navegan: ver las filas de abajo) |
| `inicio.caja.sin_texto_no_navega` | sin texto: el aviso (en el cuadro de abajo a la derecha, o junto a la caja si la página no lo trae), el foco vuelve a ella y no se navega |
| `inicio.caja.cada_opcion_cambia_el_ejemplo` | cada opción trae su ejemplo en el hueco (cuentos e historia, además, dicen que con el + se agrega la foto del personaje) |
| `inicio.caja.desplegable_con_teclado` | ↓ abre con el foco en la opción, ↓/Enter elige, Esc cierra sin cambiar y devuelve el foco; un clic fuera cierra. Desde el 14-oct-2026 el chip y su lista son `SelectorOpcion.tsx` (antes en línea en `Caja.tsx`) y los comparte Edición: esta prueba y las de las opciones pasan tal cual. La revisión del mismo día corrigió, para las tres familias a la vez, dos defectos que traía el chip desde antes (ver `inicio.caja.selector_*` abajo): el rótulo va ahora en un `<span>` que recorta con «…» y el botón ya no lleva `overflow-hidden` (recortaba su propia pista), y **Tab / Shift+Tab** con la lista abierta la cierran y dejan el foco en el chip (el navegador sigue desde ahí) en vez de tirarlo a `<body>`; aquí lo vigila la parte final de la prueba |
| `inicio.caja.imagen_y_video_escriben_en_un_cuadro_con_borde_de_campo_y_fondo_elevada` | 14-oct-2026 (dueño: «un cuadro bien definido para que se vea que ahí tienen un área de escritura»): el `<textarea>` de Imagen y de Video vive en `ui/CuadroDeTexto` — borde `border-campo` (no el de línea, que no llega a 3:1), fondo `bg-elevada`, radio de campos `rounded-medio`, relleno de 12 — y adentro no pone borde, fondo ni relleno propios; su ejemplo usa `placeholder:text-secundario`. **El aro de foco** (antes `outline-none` a secas: sin aro) lo dibuja el cuadro con `has-focus-visible` (las medidas de `tokens.css`) y el texto no dibuja otro. Un clic en el relleno lleva el foco al texto. Conserva `resize-y` y la altura mínima de 88 px (`min-h-22`) desde 360 px de ancho; por debajo (teléfonos de 320 px) el piso es de 112 px (`min-h-28`), porque con el relleno del cuadro el texto perdió 26 px de ancho y el ejemplo de «Creador de cuentos» pasaba a 5 líneas y se cortaba la última (`web/e2e/inicio-caja.spec.ts`: cada opción de Imagen y Video, a 320, 340, 359, 360, 375 y 390 px) |
| `inicio.caja.el_cuadro_y_el_chip_de_tarea_son_los_mismos_en_las_tres_familias` | un solo `CuadroDeTexto` y un solo `SelectorOpcion`: el cuadro y el chip de Edición tienen exactamente las mismas clases y atributos que los de Video, y su lista también. Si uno se desfasa de otro, falla |
| `inicio.caja.cambiar_de_familia_o_elegir_desde_fuera_cierra_la_lista_de_opciones_abierta` | al extraer el chip, el estado abierto/cerrado salió de `Caja`: ella lo cierra con `selector.current.cerrar()` al cambiar de familia (también con un clic que no pasa por `mousedown`, p. ej. teclado o lector de pantalla) y con el mando `elegir()` (la tarjeta «Crear un video» de quien empieza) |
| `inicio.caja.selector_el_chip_dice_la_opcion_elegida_y_su_pista_y_no_recorta_su_propia_pista` | `SelectorOpcion.test.tsx` (el chip solo, con tres opciones): dice la opción elegida, lleva su `data-pista` y el botón NO lleva `overflow-hidden` / `overflow-clip` / `text-ellipsis`: la pista es un `::after` que cuelga fuera del botón y esa clase la recortaba (jsdom no pinta, así que antes solo se miraba el atributo). El «…» va en el `<span class="truncate">` del rótulo. Con la lista abierta el globo se quita (`aria-expanded:after:hidden`): la misma nota ya sale en la fila y el globo taparía las ideas de arriba. Que se PINTA de verdad lo comprueba `web/e2e/inicio-caja.spec.ts` y `inicio-edicion.spec.ts` (`pistaSePinta`: compara la pantalla con y sin el ratón encima) |
| `inicio.caja.selector_abre_marcando_la_elegida_y_solo_ella_lleva_aria_selected` | al abrir, el foco va a la opción elegida (no a la primera) y solo ella lleva `aria-selected="true"`. 14-oct-2026 (revisión): `aria-controls` del chip existe SOLO mientras la lista está abierta (la lista se monta al abrir: cerrada, el id no tenía destino, en las tres familias desde antes); al cerrarla se quita, como en `MenuModelo` |
| `inicio.caja.selector_flechas_inicio_y_fin_recorren_y_enter_elige_la_marcada` | ↑ ↓ Inicio y Fin recorren la lista y se sujetan en los extremos; Enter elige la marcada, cierra y devuelve el foco al chip |
| `inicio.caja.selector_pasar_el_raton_marca_la_fila` | pasar el ratón por una fila la marca y le pasa el foco |
| `inicio.caja.selector_tab_y_mayus_tab_cierran_y_el_foco_sigue_desde_el_chip_nunca_a_body` | Tab y Shift+Tab con la lista abierta la cierran y el foco sigue desde el chip (al control de después / de antes), nunca a `<body>`; no eligen nada |
| `inicio.caja.selector_esc_y_clic_fuera_cierran_y_esc_devuelve_el_foco_al_chip` | Esc cierra y devuelve el foco al chip; un clic fuera cierra |
| `inicio.caja.selector_se_sujeta_dentro_de_la_ventana_al_abrir_y_al_girar_el_telefono` | la lista se mide y se sujeta con 12 px de margen dentro de la ventana al abrir y se vuelve a medir con `resize` (girar el teléfono) |
| `inicio.caja.cambiar_de_familia_elige_la_primera` | Imagen/Video/Edición (el riel, tres familias) con `aria-pressed`; Imagen y Video eligen la primera opción de la familia al entrar y Edición, que no tiene opciones, deja las de Imagen/Video como estaban |
| `inicio.caja.el_modelo_se_paga_con_tarifas_json` | R4 (7-oct-2026): el menú de modelo enseña los créditos de `tarifas.json` §modelos, y son los mismos que cobran las pantallas (`clip.video_8s` = el clip de 8 s de `modelos.clip.veo-lite`, `video.imagen`) |
| `inicio.caja.el_envio_va_en_el_pie_del_menu_de_modelo` | el «Crear» de las tareas con modelo vive en el pie del menú; pide el clip a `/api/clip/generar` con `modelo` y `segundos` (8 si no se tocó), sin navegar; el menú se cierra, el texto se vacía y se avisa dónde mirar |
| `inicio.caja.el_servidor_decide_el_precio_y_un_error_se_dice` | un 402 (o cualquier error) se dice —en el cuadro de abajo a la derecha, o junto a la caja si la página no lo trae— y el texto no se pierde; el cuerpo nunca trae créditos |
| `inicio.caja.un_texto_vetado_no_se_pide` | la moderación (M13) corre antes de lo que cobra |
| `inicio.caja.crear_una_imagen_se_pide_aqui` | `/api/imagenes` con `modelo` y SIN estilo (`estilo: 'ninguno'`): sale lo que escribió la persona, no el «Animado» que traía la pantalla de imágenes (decisión del dueño, 14-oct-2026) |
| `inicio.caja.crear_una_imagen_manda_nano_banana_2` | con Nano Banana 2 elegido, `/api/imagenes` lleva `modelo: nb2` y la fila enseña el número de `tarifas.json` |
| `inicio.caja.crear_una_imagen_no_promete_un_estilo` | la caja no tiene selector de estilo y la nota de «Crear una imagen» ya no ofrece uno: dice que se dibuja lo que escribes y que con el «+» se edita |
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
| `inicio.caja.editar_no_ofrece_nano_banana_2` | desde el 14-oct-2026 «Editar una imagen» no ofrece Nano Banana 2 (sin número en `tarifas.json` §modelos.editar: con un arranque en frío pasaba de los 29 s de la Lambda); el pedido sale con Grok Imagine, `modelo=grok` en modo `todo`. Hasta ese día era `inicio.caja.editar_manda_nano_banana_2` |
| `inicio.caja.el_mas_agrega_quita_y_respeta_el_tope` | el «+» solo existe en las tareas que usan imágenes (clip, editar, crear una imagen desde el 12-oct-2026 y cuentos e historia desde el 14-oct-2026; en Edición el «+» es del video y no hay el de imágenes); tope 3 (clip) o 1 (editar, cuentos, historia); un archivo que no sirve se rechaza con su motivo. Con imágenes en Mis creaciones el «+» abre un menú: ver `inicio.biblioteca.*` |
| `inicio.caja.el_clip_con_fotos_las_sube_y_suma_el_juntarlas` | las fotos suben directo a S3 (`/api/clip/presign`) y el menú dice lo que suma juntarlas (tarifas.json `clip.componer_imagenes`); la nota no cambia con la duración del clip |
| `inicio.caja.arrastrar_imagenes_a_la_caja_las_agrega` | arrastrar es un atajo del «+»; solo cuenta lo que trae archivos (`dataTransfer.types` con `Files`) |
| `inicio.caja.crear_una_imagen_tambien_tiene_el_mas_y_con_una_imagen_la_caja_edita` | «Crear una imagen» tiene su «+» (sin miniaturas propias): con una imagen la tarea es editarla, y la caja pasa sola a «Editar una imagen» con la miniatura, el texto escrito y el mismo modelo si ese también edita (hoy solo Grok; la prueba le pone su número a Nano Banana 2 mientras corre); el pedido sale a `/api/imagenes/editar`, no a `/api/imagenes`. Lo dice con «pasamos a «Editar una imagen»» |
| `inicio.caja.si_el_modelo_de_crear_no_edita_la_caja_edita_con_el_predeterminado` | si el modelo elegido para crear no tiene versión que edite (FLUX.2 klein…), la edición arranca con el predeterminado de editar (Grok Imagine): nunca se le pide editar a quien no sabe |
| `inicio.caja.una_imagen_que_no_sirve_no_saca_a_crear_una_imagen_de_su_tarea` | en «Crear una imagen» un archivo que el editor no lee (solo .jpg, .jpeg, .png, .webp) se rechaza con su motivo y la caja se queda en crear |
| `inicio.caja.pegar_una_imagen_la_agrega_igual_que_el_mas` | Ctrl+V con una imagen copiada (captura o archivo del explorador) la agrega como con el «+», con los mismos topes y rechazos, esté donde esté el foco de la página; una captura («image.png») se llama «imagen-pegada.png» (con número si son varias) y un archivo conserva su nombre |
| `inicio.caja.pegar_trae_la_imagen_aunque_el_navegador_solo_la_ofrezca_como_elemento` | si `clipboardData.files` viene vacío, la imagen se saca de `clipboardData.items` |
| `inicio.caja.pegar_texto_o_lo_que_no_es_imagen_no_se_toca` | un pegado con texto (Word, Excel…) o sin imagen (un PDF) sigue su camino normal: la caja no lo corta. Única excepción: el texto que son solo los nombres de los mismos archivos (ver la fila del Finder) |
| `inicio.caja.pegar_solo_agrega_donde_la_caja_usa_imagenes_y_a_la_vista` | no se agrega nada en Edición (ahí el «+» es del video; cuentos e historias SÍ pegan, desde el 14-oct-2026), ni cuando lo pegado va a otro campo (la clave de Blotato), ni con un diálogo abierto (la caja queda detrás con `aria-hidden`) |
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
| `inicio.caja.cuentos_e_historia_tienen_el_mas_con_textos_de_la_foto_del_personaje` | «Creador de cuentos» y «Crea tu historia» tienen «+» (14-oct-2026). Hablan de **la foto de tu personaje**: botón «Agregar la foto de tu personaje», su `title`, la nota y el ejemplo de la opción («Con el + puedes agregar la foto de tu personaje.»). El selector de archivos es de UNA foto (sin `multiple`). Los textos viven en `Opcion.textosMas` (`logica.ts`): las demás opciones no lo traen y siguen diciendo «imágenes de referencia» / «Agregar una imagen para editarla» / «Agregar la imagen que quieres editar», ni un carácter distinto. En Edición no hay «+» de imágenes |
| `inicio.caja.la_foto_del_personaje_se_agrega_se_reemplaza_se_quita_y_viaja_con_la_opcion` | tope **1** (el motor solo usa `p.referencias[0]`: `pipeline/character.py:96`, `pipeline/flow.py:69`; ofrecer 4 prometería lo que no pasa): una segunda REEMPLAZA a la primera sin decir «Como mucho»; la lista de miniaturas se llama «Foto de tu personaje»; cambiar de opción conserva la foto (en el clip es una de sus referencias); «Quitar» la saca |
| `inicio.caja.una_foto_que_no_sirve_se_rechaza_con_la_regla_del_editor_y_lo_dice_en_el_cuadro` | la regla es `rechazo(f, 'editar')`, la más conservadora: JPG, PNG o WebP de hasta 15 MB (HEIC, GIF y AVIF no, aunque el clip los lea). El aviso sale en el cuadro de abajo a la derecha (clave `caja`) y no junto a la caja; igual arrastrando o pegando |
| `inicio.caja.la_foto_del_personaje_se_arrastra_y_se_pega` | arrastrar un archivo a la caja y Ctrl+V (como imagen, no como texto) agregan la foto; un texto que se mueve dentro de la caja no se corta |
| `inicio.caja.crear_con_foto_la_deja_en_el_navegador_y_navega_con_refs_sin_cobrar_ni_vaciar` | «Crear» con foto: `guardarArchivos([foto])` (nucleo/traspaso, IndexedDB) y `ir('/estudio/crear/?brief=…&modo=…&refs=<token>')` (directo a la pantalla nueva: `/crear.html` ignora `refs` y en la etapa `nueva` ni redirige). **No cobra ni pide nada** (solo navega), y no vacía texto ni foto (si regresa con «atrás», ahí siguen). Con varias fotos heredadas del clip viaja SOLO la primera |
| `inicio.caja.crear_con_foto_con_doble_clic_guarda_una_sola_vez_y_navega_una_sola_vez` | el candado (`setEnviando(true)`) se pone antes del primer `await`: doble clic mientras guarda = UNA escritura en el navegador y UNA navegación; el botón dice «Generando…» |
| `inicio.caja.sin_foto_la_direccion_es_la_de_siempre_y_no_se_toca_el_navegador` | sin foto, `destinoDe` no suma `refs` y la dirección es idéntica a la de antes; no se llama a `guardarArchivos` |
| `inicio.caja.con_foto_va_directo_a_la_pantalla_nueva_de_crear_sin_pasar_por_crear_html` | con foto, `destinoDe` apunta a `/estudio/crear/` (no depende de la etapa del interruptor); sin foto sigue siendo `/crear.html?…`. «Crear» con foto navega a la nueva |
| `inicio.caja.una_foto_heredada_del_clip_pasa_por_la_regla_de_editar_antes_de_dejarla_y_navegar` | un HEIC agregado en «Un video corto» y llevado a cuentos: «Crear» lo rechaza con el motivo de `rechazo(f, 'editar')` en el cuadro de avisos, sin `guardarArchivos` ni navegar; reemplazarla por una buena abre el camino |
| `inicio.caja.reemplazar_la_foto_del_personaje_no_borra_las_del_clip` | con tope 1 la foto nueva toma el lugar de la primera; las otras referencias del clip se guardan y vuelven al regresar |
| `inicio.caja.una_foto_sin_tipo_se_completa_al_aceptarla_para_que_crear_no_la_descarte` | un `File` con `type: ''` y extensión `.webp` entra a la caja y se guarda con `image/webp` (`tipoDe`), que es lo que Crear exige; uno con tipo viaja tal cual |
| `inicio.caja.si_el_navegador_no_deja_guardar_la_foto_se_navega_igual_con_refs_perdida` | si `guardarArchivos` da `null` (sin IndexedDB, ventana privada, cuota, plazo) —o lanzara— se navega igual con `&refs=perdida`: navegar no cobra y la persona no se queda sin camino; Crear le dice que la foto no llegó |
| `inicio.biblioteca.el_mas_ofrece_subir_o_elegir_de_mis_creaciones` | con imágenes en «Mis creaciones» el «+» abre un menú (`role=menu`, `aria-haspopup`/`aria-expanded`, foco en la primera opción) con «Subir de tu computadora» —que dice qué sirve y su tope: clip «JPG, PNG, WebP, GIF, AVIF o HEIC · hasta 20 MB», editar «JPG, PNG o WebP · hasta 15 MB»— y «Elegir de Mis creaciones» («4 imágenes tuyas»), más el recordatorio de arrastrar y pegar con Ctrl+V. «Subir» abre el selector de archivos de siempre |
| `inicio.biblioteca.sin_imagenes_el_mas_abre_el_selector_de_siempre` | sin ninguna imagen en Mis creaciones el «+» no abre menú: abre el selector de archivos, como antes (y sin `aria-haspopup`) |
| `inicio.biblioteca.elegir_trae_las_imagenes_a_la_caja_en_el_orden_marcado` | la hoja «Agregar imágenes» (diálogo de 760 px, pestañas «Mis creaciones» y «Mi computadora») enseña las imágenes de la más nueva a la más vieja; cada elegida lleva su número (el orden en que se marcó), elegirla de nuevo la quita, y el contador dice «N de M seleccionadas». «Agregar N» las trae del servidor (una sola vez cada una), las suma a la caja con su nombre de archivo, en ese orden, y cierra la hoja. Sin elegidas, «Agregar» está apagado |
| `inicio.biblioteca.el_tope_sale_de_lo_que_le_cabe_a_la_caja` | en el clip caben 3 menos las que ya están en la caja: al llegar al tope las demás se apagan (`aria-disabled`, sin efecto al pulsarlas); con 3 puestas la hoja dice «Ya tienes todas las que caben» y no deja agregar |
| `inicio.biblioteca.en_crear_una_imagen_elige_una_y_la_caja_pasa_a_editar` | desde «Crear una imagen» la hoja admite UNA (elegir otra reemplaza a la anterior), «Mi computadora» dice los archivos del editor (no los del clip) y, al agregar, la caja pasa a «Editar una imagen» con esa imagen |
| `inicio.biblioteca.en_cuentos_e_historia_el_mas_habla_de_la_foto_del_personaje_y_elige_una` | en cuentos e historia el menú del «+» se llama «Agregar la foto de tu personaje», dice «JPG, PNG o WebP · hasta 15 MB» y su recordatorio habla de UNA foto («arrastrarla… pegarla»); la hoja «Elegir de Mis creaciones» admite una (elegir otra reemplaza) y NO pasa a otra opción. La hoja conserva su título genérico «Agregar imágenes» |
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
| `inicio.modelos.cada_modelo_activo_tiene_precio_y_cada_precio_su_modelo` | el catálogo (`modelos.ts`) y `tarifas.json` §modelos no se desfasan, en ninguno de los dos sentidos; la única excepción son los apagados a propósito (`APAGADOS`: hoy editar con Nano Banana 2), que deben seguir SIN número |
| `inicio.modelos.el_predeterminado_esta_activo_y_es_el_que_ya_valia` | el predeterminado de cada tarea está activo y vale lo mismo que cobra la pantalla |
| `inicio.modelos.sin_precio_confirmado_no_se_ofrece_aunque_este_activo` | sin número en `tarifas.json` el modelo no sale, ni uno con resolución a medias |
| `inicio.modelos.un_modelo_apagado_no_se_ofrece_aunque_tenga_precio` | `activo: false` lo saca del menú aunque tenga precio |
| `inicio.modelos.lo_que_esta_a_la_venta_hoy` | el catálogo real tiene activos, para crear imágenes, Grok, FLUX.2 klein, Z-Image Turbo, FLUX.2 pro, Seedream 5.0 Flash, Seedream 4.5, FLUX 3, Nano Banana 2 y Nano Banana Pro (dos calidades, 2K y 4K; solo para crear) (en el catálogo de editar, Grok y Nano Banana 2; a la venta para editar, solo Grok: desde el 14-oct-2026 Nano Banana 2 no tiene número en `tarifas.json` §modelos.editar) y, para el clip, MiniMax H3 Max Turbo, Veo 3.1 Lite, Grok Imagine Video, Grok Imagine Video 1.5 Lite y Veo 3.1 Fast (en ese orden); Veo 3.1 Standard, LTX, Kling y Seedance siguen apagados |
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
| `inicio.menu.entradas_y_grupos_en_orden` | **15-oct-2026: ya no hay menú** (ni la nav «Secciones», ni «Estudio de Contenido», ni «Publicidad Automática»); las puertas de siempre siguen, ahora por mapa → opciones → lista. Marketing › Blotato: `/agenda.html`, `/competencia.html`, `/metricas.html`, en ese orden; Marketing › Avanzado: `/mix.html` (MIX, con su requisito Blotato) y `/estilos.html` (la Copiadora de estilos, provisional hasta «Marcas»). «De videos a Shorts» no sale en ninguna lista: vive en «Editar ▾» (ver `inicio.edicion.el_chip_editar_…`). Nada de Marketing dice «próximamente»; Central › Distrito sí, y ninguna de sus pantallas es un enlace. Eran 6 puertas (7 hasta el 14-oct-2026: «Editor de videos», `/e1.html`, salió) y siguen siendo 6: cinco en las listas y la de Shorts en el chip. El ID conserva «menú» por historia |
| `inicio.menu.editor_de_videos_salio_y_las_otras_dos_de_su_grupo_se_quedan` | 14-oct-2026 (dueño: «olvidaste quitar la caja de ahora de la izquierda, donde dice editor de videos»): el menú ya no trae «Editor de videos» ni su texto ni ningún enlace a `/e1.html`; «De videos a Shorts» (`/shorts.html`) y «Copiadora de estilos» (`/estilos.html`) se quedan en «Estudio de Contenido», con sus textos tal cual. Editar metraje es la pestaña «Edición» de la caja (el camino de primer uso «Desde tu metraje → Subir metraje» sigue llevando a `/e1.html`: `inicio.caminos.enlaces_a_shorts_y_metraje`). **15-oct-2026:** sin menú, la prueba recorre las listas de Blotato, Avanzado y Central › Distrito y exige lo mismo (ni «Editor de videos», ni su texto, ni un `a[href^="/e1.html"]`); la Copiadora de estilos se queda en Avanzado con su texto tal cual, y «De videos a Shorts» ya no es un enlace de ninguna lista (`/shorts.html` no aparece): pasó al chip «Editar ▾». El nombre del ID habla de «las otras dos de su grupo» por historia |
| `inicio.menu.el_titulo_dice_irremplazables_en_dorado_sin_icono` | 14-oct-2026 (dueño): el `<h1>` de la columna izquierda pasa de «icono + Estudio de video» a **«Irremplazables»** a secas, en `text-ambar-claro` (el ámbar claro de la paleta: el de los «títulos-marca», DISENO §3; ningún color nuevo) y con el mismo tamaño, peso y tipografía de título (`text-titulo-sm font-bold`, Bricolage por `h1`); sin icono ni hijos. Los `<title>` de las páginas y el título de las demás pantallas **no** se tocaron (decisión pendiente del dueño). **15-oct-2026 (dueño):** la columna izquierda ya no existe; «Irremplazables» es el **único `<h1>`** de la tarjeta del inicio, centrado, en **dorado con degradado** (clase `texto-oro` de `tokens.css`: `#f3dc92` → `#e6c35c` → `#b98d2f`, y `#e6c35c` liso si el navegador no recorta el fondo a la letra) con el tamaño de título de pantalla (`text-titulo-lg`, 32 px, `font-extrabold`). La prueba exige esas tres clases, que **no** lleve `text-ambar-claro`, que no tenga icono ni hijos (el nombre a secas) y que «Estudio de video» no salga. El ámbar claro deja de ser el color del título-marca |
| `inicio.menu.sin_clave_se_apagan_las_cuatro_de_blotato_y_ofrecen_conectar` | sin clave se apagan agenda, competencia (a propósito, dueño 18-sep), métricas y MIX; el clic abre conectar en vez de navegar. **15-oct-2026:** la misma regla, en las listas del recorrido: en Marketing › Blotato las tres tarjetas (agenda, competencia, métricas) quedan `aria-disabled` y dicen «Conecta tu Blotato para usarlo», y el clic NO navega (`preventDefault`) sino que abre el diálogo «Conecta tu Blotato»; la cuarta, MIX, se apaga igual en Marketing › Avanzado, mientras la Copiadora de estilos (que no depende de Blotato) no. El ID dice «cuatro» por las cuatro entradas del menú de antes |
| `inicio.menu.si_no_se_sabe_no_se_apaga_nada` | si `/api/blotato` falla, nada se apaga (en el recorrido: ninguna tarjeta de Blotato ni de Avanzado lleva `aria-disabled`) |
| `inicio.menu.pregunta_ligero` | el inicio pregunta con `?redes=0`, UNA vez al montar (aunque no se abra ninguna lista), sin gastar una llamada a Blotato: el `GET /api/blotato` a secas no sale hasta abrir el diálogo |
| `inicio.blotato.mas_abre_el_dialogo_con_las_redes` | el «+» (o ✓) abre el diálogo, no un alert, con las redes conectadas. **15-oct-2026:** ese «+»/✓ del encabezado del grupo en el menú de la izquierda pasó a ser un botón con texto, «Conecta tu cuenta de Blotato» o «Blotato conectado: ver o cambiar» (`aria-haspopup="dialog"`), arriba de las tarjetas de Marketing › Blotato; abre el mismo diálogo, con el mismo `DialogoBlotato`. Solo sale en un grupo cuyas pantallas dependen TODAS de Blotato (en Avanzado, que trae la Copiadora, no) |
| `inicio.blotato.aviso_del_cobro_con_el_precio_del_server_antes_del_campo` | el cobro de Blotato se avisa ANTES del campo, con el precio que manda el server (`pricing.json` nunca entra al cliente) |
| `inicio.blotato.clave_password_sin_autocompletar` | `type=password`, sin autocompletar, corrector ni mayúsculas |
| `inicio.blotato.la_clave_se_borra_al_conectar_cancelar_y_cerrar` | la clave se manda una vez, sin espacios, y se vacía al conectar, al cancelar y al cerrar; nunca queda escrita en la página |
| `inicio.blotato.sin_clave_no_manda_nada` | «Pega tu clave de Blotato primero.» y ningún POST |
| `inicio.blotato.error_del_server_se_dice_en_el_dialogo` | el error del server en el diálogo y Conectar vuelve a servir |
| `inicio.blotato.clave_del_env_no_se_ofrece_desconectar` | con la clave del `.env` lo dice y no ofrece Desconectar |
| `inicio.blotato.desconectar_pide_confirmar` | Desconectar pide confirmación; al desconectar, el menú se apaga (15-oct-2026: las tres tarjetas de la lista de Blotato pasan a `aria-disabled`) |
| `inicio.blotato.viene_del_editor_con_blotato_conectar` | `?blotato=conectar` abre el diálogo al llegar |
| `inicio.blotato.enlace_a_la_api_con_noopener` | «Blotato → Settings → API» en otra pestaña con `noopener noreferrer` |
| `inicio.blotato.conectar_enciende_el_menu` | al conectar, las cuatro entradas se encienden (15-oct-2026: las tres tarjetas de Blotato dejan de decir «Conecta tu Blotato» y el botón de arriba pasa a «Blotato conectado: ver o cambiar»; el ID dice «menú» por historia) |
| `inicio.marco.sin_version_anterior` | Sin «Usar la versión anterior» (se quitó el 28-sep; `/ui/clasica` sigue a mano) |
| `inicio.edicion.el_riel_tiene_tres_familias_con_aria_pressed_y_arranca_en_video` | el riel dice Imagen · Video · Edición (icono `cortar`) con `aria-pressed`; la caja sigue ARRANCANDO en Video; Edición trae el campo «Cuéntale a la IA qué quieres» (`aria-required`, la pista de la primera idea —`huecoDe`—, 2000 caracteres) y el título sigue siendo «¿Qué vamos a crear hoy?» |
| `inicio.edicion.sin_video_el_boton_es_iniciar_sin_precio_dorado_enfocable_y_avisa` | sin video: «Iniciar» (antes «Editar») sin precio, DORADO (14-oct-2026; antes gris discontinuo), `aria-disabled` (no `disabled`: se puede enfocar) y, al tocarlo, avisa «Primero agrega el video: pulsa el «+» o arrástralo a la caja.» en el cuadro; sin ninguna petición |
| `inicio.edicion.con_texto_y_sin_video_la_ayuda_dice_donde_agregarlo` | con texto y sin video, la línea «Agrega el video con el «+» o arrástralo a la caja.» reemplaza a «Escribe qué quieres hacer…» |
| `inicio.edicion.la_fila_de_botones_de_ideas_ya_no_existe_y_la_ayuda_no_dice_toca_una_idea` | 14-oct-2026 (**sustituye a** `inicio.edicion.una_idea_pone_su_texto_en_el_campo_y_le_da_el_foco`): ya no hay `role="group"` «Ideas para escribir» ni ningún botón con el texto de las 4 ideas, el riel sigue con sus 3 botones, el campo sigue vacío (la pista no es su valor) y `AYUDA_TEXTO` dice «Escribe qué quieres hacer con tu video.», sin «toca una idea» |
| `inicio.edicion.la_pista_arranca_en_la_primera_idea_sin_fundido_y_las_cuatro_leen_igual` | la pista (el `placeholder` del campo) arranca SIEMPRE en «Cuéntale a la IA qué quieres. Ejemplo: «Quita muletillas y silencios»», con la opacidad en 1 y sin salir ni entrar (la carta §4: lo que ya estaba al abrir no anima); la rotación no empieza hasta cumplido el primer intervalo; `huecoDe` da la misma frase con las 4 ideas (en ese orden, sin punto final: la idea 1 y la 4 son verbo y nombre y las 4 leen igual); cambiar de familia y volver reabre en la primera |
| `inicio.edicion.la_pista_rota_cada_4_s_con_fundido_de_salida_y_de_entrada_y_da_la_vuelta` | con el reloj falso, dos vueltas completas: a los 3.75 s la idea empieza a salir (opacidad 0, `ease-entrada`, MISMO texto todavía), a los 4 s justos cambia el texto y entra la siguiente (opacidad 1, `ease-salida`); da la vuelta a la primera y nunca salta una idea. El reloj es un solo `setTimeout` que se re-arma en cada paso |
| `inicio.edicion.la_pista_no_rota_con_el_foco_se_congela_entera_y_retoma_al_soltarlo_vacio` | con el foco en el campo no queda ningún temporizador (`vi.getTimerCount()`) y la pista se queda en la que estaba, ENTERA aunque el foco llegue a mitad del fundido de salida (congelada a media luz sería un campo sin pista); al soltar el foco con el campo vacío retoma desde esa idea con su intervalo completo |
| `inicio.edicion.si_la_caja_abre_con_el_foco_en_el_campo_la_pista_nace_congelada` | `elegir('edicion')` (el mando de la caja, «Subir metraje» del primer uso) monta el campo y lo enfoca en el mismo render: la pista nace congelada en la primera y no rota hasta soltar el foco |
| `inicio.edicion.con_texto_la_pista_no_corre_ni_arma_temporizadores_y_al_vaciar_retoma` | con texto escrito (también un solo espacio: el campo ya no está vacío y la pista no se ve) no hay temporizadores ni cambia la pista por mucho que pase; al borrar todo retoma desde la idea en que estaba |
| `inicio.edicion.con_reducir_movimiento_la_pista_queda_fija_y_reacciona_si_cambia_la_preferencia` | con `prefers-reduced-motion: reduce` (`matchMedia`) la pista queda fija en la primera idea, sin fundido, sin rotación y sin ningún temporizador; si la persona apaga la preferencia con la pantalla abierta arranca la rotación, y si la enciende a mitad de un fundido vuelve a la primera, entera, y se detiene; al volver a apagarla sigue en la primera (sin saltar, sin fundido, a la idea que traía guardada la rotación) y de ahí rota con su intervalo completo |
| `inicio.edicion.apagar_reducir_movimiento_sigue_en_la_primera_idea_tambien_con_el_foco_o_con_texto` | 14-oct-2026 (revisión): encender y apagar «reducir movimiento» con el campo ENFOCADO o con TEXTO (`rota` ya era falso: el reinicio no puede colgar de que `rota` cambie) deja la pista en la primera, sin temporizadores, sin fundido y sin saltar a la idea que iba; al soltar el foco (o vaciar el campo) rota desde la primera con su intervalo completo. Se rompió a propósito: sin el reinicio por `reducido` fallan esta y la anterior; con el reinicio dentro del bloque de `rota` (la primera propuesta) falla solo esta |
| `inicio.edicion.un_temporizador_viejo_que_vence_al_parar_la_rotacion_no_deja_la_pista_a_medio_apagar` | 14-oct-2026 (revisión), en `usePistaRotatoria.test.tsx` con un arnés: si el temporizador de la idea vence entre el commit que para la rotación y la limpieza de su efecto, `paso.saliendo` queda en true con `rota` en falso; el guardia `rota &&` del retorno evita que la pista se devuelva apagada (opacidad 0 con el campo enfocado). Desde la caja entera esa carrera no se produce, por eso el arnés vence el temporizador en un efecto de layout. Sin el guardia, falla |
| `inicio.edicion.con_la_pestana_oculta_la_pista_no_rota_ni_acumula_ciclos` | con `document.hidden` no hay temporizadores ni se dispara nada (60 s ocultas = 0 cambios); al volver, UNA idea más tras un intervalo completo, no los ciclos que «pasaron» |
| `inicio.edicion.si_la_pestana_ya_esta_oculta_al_abrir_la_pista_no_arma_el_reloj` | si la pestaña ya estaba oculta al abrir Edición, la pista no arma el reloj; al hacerse visible, sí |
| `inicio.edicion.la_pista_no_deja_temporizadores_al_desmontar_ni_al_cambiar_de_familia_y_en_strictmode_corre_uno_solo` | bajo `<StrictMode>` (doble efecto) hay exactamente UN temporizador de más con la pista rodando, la rotación pasa de la 1.ª a la 2.ª (no a la 3.ª); cambiar de familia lo quita; desmontar todo deja `vi.getTimerCount()` en 0 |
| `inicio.edicion.la_pista_es_el_placeholder_nativo_con_el_token_de_duracion_el_gris_secundario_y_sin_aria_live` | el fundido va en el `::placeholder` del propio `<textarea>` (`placeholder:transition-opacity`, `placeholder:duration-(--dur-media)`, `ease-salida`/`ease-entrada`, `motion-reduce:placeholder:transition-none` porque `::placeholder` no es `*` y la regla global de `tokens.css` no lo alcanza), sin capa encima; `PISTA_FUNDIDO_MS` = `--dur-media` de `tokens.css` (250 ms); gris secundario; ni el campo ni su cuadro son región viva (sin `aria-live`) y su nombre accesible sigue siendo «Cuéntale a la IA qué quieres», no la pista |
| `inicio.edicion.el_lector_de_pantalla_recibe_un_ejemplo_fijo_como_descripcion_del_campo_sin_repetirlo_a_la_vista` | las ideas ya no se alcanzan con Tab y la pista no se anuncia: el campo se describe con un ejemplo FIJO («Por ejemplo: quítale las muletillas, ponle subtítulos y hazlo vertical para Reels.», `aria-describedby`) en un `<p hidden>` (14-oct-2026, revisión: antes `sr-only`, que lo dejaba además como párrafo suelto en el árbol de accesibilidad y se oía dos veces, como párrafo en modo lectura y como descripción al enfocar el campo): no se repite a la vista ni queda suelto, `aria-describedby` lo sigue leyendo, y la descripción sigue ahí con texto escrito y a lo largo de la rotación. Un e2e (`inicio-edicion.spec.ts`) lo mira en el árbol de accesibilidad de Chromium |
| `inicio.edicion.subir_muestra_progreso_real_y_el_precio_llega_del_servidor_al_terminar` | la subida usa `nucleo/subida` (config, presign, PUT con progreso, confirmar): el nombre del proyecto sale del archivo, la tarjeta dice nombre, formato y tamaño, `role=progressbar` con el avance real, el botón dice «Subiendo…» y «Cuando termine de subir calculamos el precio…»; el precio SOLO se pide al terminar y es el del servidor (la prueba usa un número que no está en ninguna tarifa); la tarjeta gana la duración medida («12:04 · MP4 · 824 MB») |
| `inicio.edicion.el_precio_del_servidor_8_sin_transcript_y_2_con_transcript` | ✦ 8 para 724 s sin transcripción y ✦ 2 con ella: los muestra tal cual los manda el servidor, y la prueba comprueba que coinciden con `tarifas.json` (`editar.sugerencias` + `shorts.transcripcion_por_5min` × bloques de 5 min) |
| `inicio.edicion.sin_texto_el_boton_con_precio_sigue_enfocable_lleva_el_foco_al_campo_y_no_avisa` | con video y sin texto: «Iniciar ✦ N», dorado y con `aria-disabled` (sigue enfocable), descrito por «Escribe qué quieres hacer con tu video.» (hasta el 14-oct-2026 terminaba en «, o toca una idea»); tocarlo lleva el foco al campo y NO abre aviso; escribir lo enciende |
| `inicio.edicion.un_aviso_del_servidor_apaga_el_boton_sin_precio_y_lleva_el_foco_al_mas` | si `/costo` trae `aviso` (fuera de 1–90 min, falta la transcripción en nube…) se enseña tal cual, «Iniciar» queda sin precio, dorado y con `aria-disabled` aunque haya texto, y tocarlo lleva el foco al «+» (cambiar el video), sin aviso |
| `inicio.edicion.lanzar_manda_solo_la_instruccion_y_vacia_la_caja_y_refresca_el_saldo` | `POST /api/editar/<p>/sugerir` con SOLO `{instruccion}` (recortada): nunca créditos en el cuerpo; se modera ANTES; la línea «Tienes ✦ 269; después te quedan ✦ 261.» antes de pulsar; tras lanzar la caja se vacía (texto y video), el saldo se refresca, vuela el «−N» con lo que cobró el servidor y el foco no se pierde (es el mismo botón) |
| `inicio.edicion.doble_clic_en_iniciar_es_una_sola_peticion` | dos clics en el mismo tic = UN moderar y UN sugerir (el candado se cierra antes del primer `await`); mientras espera el botón dice «Iniciando…» (antes «Editando…») y no acepta otro |
| `inicio.edicion.sin_saldo_el_boton_se_apaga_y_dice_cuanto_falta_con_recargar` | si el saldo conocido no alcanza: «Iniciar ✦ N» dorado pero con `aria-disabled`, «Tienes ✦ S: no alcanza para editar este video.» y «Te faltan ✦ N · Recargar» (el componente `Recarga`); tocarlo no pide nada |
| `inicio.edicion.402_del_servidor_dice_te_faltan_y_no_cobra_ni_vacia_la_caja` | si el servidor contesta 402 (el saldo de la píldora estaba atrasado): «Te faltan ✦ N · Recargar» (N sale del detalle del 402), el saldo se refresca, ningún «−N», y el video y el texto se quedan para reintentar |
| `inicio.edicion.402_con_la_recarga_cerrada_dice_la_salida_de_la_interfaz` | con la recarga cerrada (`window.monedero.recarga` false) no hay botón «Recargar» muerto: sale el texto `cta` del monedero (`tests/test_m4_recarga_cerrada.py`) |
| `inicio.edicion.502_avisa_y_refresca_el_saldo_porque_el_servidor_devolvio_los_creditos` | 502 (no se pudo lanzar): el mensaje del servidor al cuadro, el saldo se refresca (el servidor devuelve los créditos), ningún «−N» y la caja conserva texto y video |
| `inicio.edicion.un_gate_del_servidor_se_dice_tal_cual_y_no_se_empieza_otra_cosa` | 413/422 (gate de duración, ANTES de cobrar) y demás errores: el mensaje del servidor tal cual al cuadro; el texto se conserva |
| `inicio.edicion.si_otra_cuenta_tiene_el_nombre_se_reintenta_una_vez_con_nombre_alterno` | 409 al firmar = el nombre del proyecto es de otra cuenta: se reintenta UNA vez con `nombreAlterno` y el precio se pide por el proyecto que sí se reservó |
| `inicio.edicion.un_409_que_se_repite_no_reintenta_otra_vez_y_lo_dice` | si el reintento también da 409: dos firmas en total, ninguna subida, el error al cuadro y la caja sin video |
| `inicio.edicion.una_tarea_a_la_vez_avisa_durante_la_subida_y_durante_la_corrida` | durante la subida y mientras la corrida lanzada siga `corriendo`, «+» e «Iniciar» avisan «Ya hay un trabajo en curso. Cuando termine puedes empezar otro.» (el «+» queda `aria-disabled`); el sondeo de `GET /api/editar/<p>` es PEREZOSO (solo tras lanzar, cada 5 s), al terminar refresca el saldo y se detiene. El servidor aún no tiene candado por cuenta: este aviso es de la pantalla |
| `inicio.edicion.un_409_de_ya_corre_pasa_a_una_tarea_en_curso` | si el servidor dice 409 («ya está en curso») la pantalla también lo sabe desde ahí: nada empieza hasta que termine |
| `inicio.edicion.cambiar_de_familia_y_volver_conserva_texto_y_video_y_no_cancela_la_subida` | el estado vive en `useEdicion` (llamado desde `Caja`): cambiar a Video o Imagen y volver conserva el texto y el video, y una subida a medias sigue (no se aborta) y termina con su precio |
| `inicio.edicion.quitar_durante_la_subida_la_cancela_sin_error_y_no_pide_precio` | «Cancelar la subida» aborta el PUT, no es un error de nadie (ningún aviso), no confirma ni pide precio, y el foco vuelve al «+» |
| `inicio.edicion.quitar_un_video_listo_deja_la_caja_para_otro` | «Quitar este video» vacía la tarjeta, el botón vuelve a «Iniciar» sin precio y el foco va al «+» (que ahora dice «Agregar el video que quieres editar») |
| `inicio.edicion.soltar_un_video_en_la_caja_lo_sube_y_pegar_se_ignora` | soltar un video en la caja de Edición lo sube (si no es video, lo dice; si son varios toma el primero y lo dice); pegar (Ctrl+V) NO agrega nada en esta familia |
| `inicio.edicion.un_archivo_que_no_sirve_se_rechaza_con_su_motivo_antes_de_subir` | solo .mp4, .mov y .m4v, hasta 5 GB (los mismos límites que `/api/media/presign`); lo demás se rechaza con su motivo ANTES de pedir permiso de subida |
| `inicio.edicion.si_no_hay_subidas_en_esta_instalacion_lo_dice_sin_intentar` | si `/api/media/config` dice que no hay subidas, se dice y no se firma nada |
| `inicio.edicion.si_el_precio_no_llega_el_video_se_queda_e_iniciar_lo_vuelve_a_pedir` | si el precio falla el video subido se queda, el error va al cuadro y tocar «Iniciar» (la nota dice «Toca «Iniciar» para intentarlo otra vez.») vuelve a pedir SOLO el precio (no se sube otra vez) |
| `inicio.edicion.una_instruccion_que_la_moderacion_frena_no_llega_al_servidor` | M13: una instrucción vetada por la moderación no llega a `/sugerir` ni cobra, y el texto se conserva |
| `inicio.edicion.sin_el_cuadro_de_avisos_lo_que_se_dice_sale_junto_a_la_caja` | en una página sin `window.avisos` (tests, vitrina) lo que dice la caja de Edición sale junto a ella (`role=alert`), y se quita al corregirlo |
| `inicio.edicion.todo_lo_tocable_mide_al_menos_44_px` | el riel, el «+», el chip «Editar ▾», «Iniciar» y la ✕ de la tarjeta miden al menos 44 px (las 4 ideas, que eran botones de `min-h-11`, salieron el 14-oct-2026) (clases `min-h-11`/`min-h-12`/`size-11`/`size-12`) |
| `inicio.edicion.ninguna_peticion_al_montar_ni_al_abrir_la_familia` | el Inicio entero: montar y abrir la familia Edición no piden NADA de `/api/editar`, `/api/media` ni `/api/moderar`; las peticiones de Edición son perezosas (`servidor()` de las pruebas y el e2e fijan las rutas del montaje) |
| `inicio.edicion.el_boton_apagado_enfocable_no_usa_disabled_ni_opacidad_y_si_recibe_el_clic` | `<Boton apagado>`: `aria-disabled`, sin `disabled`, el apagado de la carta (borde discontinuo, gris; DISENO §5), sin ámbar a media opacidad, sin hover, y el clic SÍ llega a `onClick`. Desde el 14-oct-2026 es solo la prueba de la pieza de `ui/Boton`: «Iniciar» ya no la usa (ver `inicio.edicion.iniciar_es_dorado_en_todos_los_estados_y_solo_cambian_lo_que_dice_y_su_semantica`) |
| `inicio.edicion.si_la_subida_falla_se_dice_y_la_caja_queda_lista_para_elegir_otro` | si el PUT falla o no hay red, se dice y la caja queda sin video, lista para elegir otro |
| `inicio.edicion.el_boton_sigue_el_orden_sin_video_subiendo_sin_precio_aviso_sin_texto_sin_saldo_listo` | `estadoDelBoton`: sin video → subiendo → calculando → sin precio → aviso del servidor → sin texto → sin saldo → listo; un aviso manda sobre el texto y el saldo; un saldo que no se sabe no bloquea |
| `inicio.edicion.el_reloj_el_tamano_y_lo_que_falta_tras_un_402` | `reloj` («12:04», «1:18:00»), `tamano` («824 MB», «1.4 GB») y `faltanTras402` (lee «…cuesta 8 créditos y tu saldo es 5.»; sin ese texto usa el saldo conocido) |
| `inicio.edicion.el_mando_de_la_caja_elige_edicion_y_le_da_el_foco_al_campo` | `MandoCaja.elegir('edicion')` (la caja la ofrece a quien la monta, como `elegir('videos', …)`): cambia a Edición y le da el foco al campo aunque ese campo se monte en el render que sigue; las otras familias siguen eligiendo su opción |
| `inicio.edicion.mientras_sale_el_pedido_la_x_de_la_tarjeta_no_quita_el_video` | entre el clic en «Iniciar ✦ N» y la respuesta del servidor, la ✕ de la tarjeta queda `aria-disabled` y no quita el video (el pedido no se deja a medias) |
| `inicio.edicion.enter_repetido_en_iniciar_es_una_sola_peticion` | Enter pulsado (o mantenido) tres veces sobre «Iniciar ✦ N» = UN moderar y UN sugerir y UN «−N»; con la caja ya vaciada otro Enter no lanza nada |
| `inicio.edicion.clic_durante_el_402_y_el_502_en_vuelo_no_duplica_y_despues_se_puede_reintentar` | clics mientras el pedido vuela no mandan otro; tras un 402 (sin cobro) o un 502 (el servidor devolvió) el botón vuelve a servir y el reintento sale UNA vez; al reintentar desaparece el «Te faltan» viejo; tres pedidos, UN cobro |
| `inicio.edicion.cambiar_de_familia_a_mitad_del_cobro_lo_termina_y_al_volver_la_caja_esta_vacia` | irse a Video con el pedido en vuelo no lo cancela: el cobro termina, vuela el «−N», la caja vuelve vacía y «+»/«Iniciar» avisan que hay una corrida en curso |
| `inicio.edicion.un_402_que_llega_en_otra_familia_se_ve_al_volver_y_no_pierde_nada` | un 402 que llega con la persona en otra familia se ve al volver («Te faltan ✦ N · Recargar»), conserva texto y video, no cobra, y cuando monedero.js trae el saldo de verdad la línea no se repite ni se contradice |
| `inicio.edicion.quitar_con_el_precio_en_camino_y_subir_otro_ignora_la_respuesta_vieja` | quitar un video mientras se calcula su precio y subir otro: el precio tardío del primero no se lo queda el segundo |
| `inicio.edicion.un_archivo_nuevo_sobre_un_video_listo_lo_reemplaza_y_el_pedido_va_al_proyecto_nuevo` | un video nuevo sobre uno listo lo reemplaza (precio nuevo, texto conservado) e «Iniciar» pide el proyecto nuevo, nunca el viejo |
| `inicio.edicion.otro_archivo_durante_la_subida_avisa_y_no_empieza_otra_subida` | soltar o elegir otro archivo mientras sube avisa «Ya hay un trabajo en curso…» y no abre una segunda subida |
| `inicio.edicion.los_nombres_raros_de_archivo_dan_un_proyecto_que_el_servidor_acepta_o_se_rechazan_con_motivo` | acentos, espacios, mayúsculas, 200 caracteres, solo símbolos o solo guiones bajos (`_.mp4`): el nombre del proyecto siempre es válido para el servidor (≤ 40, letras o cifras, `mi-video` si no queda nada); un archivo llamado solo «.mp4» o de 0 bytes se rechaza con su motivo ANTES de pedir permiso |
| `inicio.edicion.un_nombre_que_ya_es_un_proyecto_tuyo_con_video_se_estrena_con_nombre_nuevo` | antes de firmar se pregunta `GET /api/media/<p>`: si ese nombre ya es un proyecto tuyo con video (otro «final.mp4») se estrena un nombre con `nombreAlterno`, para no mezclar el video nuevo con la transcripción y los cortes del viejo; el 409 de otra cuenta sigue reintentando UNA vez |
| `inicio.edicion.si_no_se_puede_saber_si_el_nombre_ya_existe_se_sube_con_el_nombre_del_archivo` | si esa pregunta falla (5xx, sin red) la subida sigue con el nombre del archivo: preguntar no frena |
| `inicio.edicion.un_precio_que_no_es_un_numero_no_se_ensena_ni_se_deja_cobrar` | un `creditos` que no es un entero ≥ 0 (null, texto, NaN, negativo, con decimales) cuenta como «sin precio»: «Iniciar» sin ✦, con `aria-disabled` (nunca «✦ 0» ni «✦ NaN»), tocarlo vuelve a pedir el precio y no modera ni cobra; una duración que no es número no rompe la tarjeta |
| `inicio.edicion.si_el_precio_nunca_llega_se_puede_quitar_el_video_y_empezar_de_nuevo` | si `/costo` no contesta nunca, «Calculando…» no cobra y la ✕ sigue quitando el video para empezar de nuevo (el texto se conserva) |
| `inicio.edicion.un_campo_con_solo_espacios_saltos_o_invisibles_esta_vacio_y_no_enciende_el_boton` | un campo con solo espacios, saltos, NBSP, ancho cero, marcas bidi o «etiquetas» U+E00xx está vacío: el botón sigue con `aria-disabled`, la ayuda sigue pidiendo texto y no se pide nada (`limpiarInstruccion` copia la limpieza del servidor, `limpiar_instruccion`) |
| `inicio.edicion.la_instruccion_que_viaja_es_la_limpia_y_es_la_misma_que_se_modera` | lo que se manda a `/sugerir` y a `/api/moderar` es la instrucción limpia (sin invisibles, tabuladores a espacio, `\r\n` a salto), la misma que verá la IA |
| `inicio.edicion.el_campo_limita_a_2000_y_si_algo_pasa_el_servidor_es_la_autoridad` | pegar 2500 caracteres deja 2000; si uno de más se cuela, NO se recorta en silencio: el 422 del servidor (antes de cobrar) se dice tal cual, sin «−N», y texto y video se conservan |
| `inicio.edicion.si_el_saldo_cambia_despues_del_precio_el_boton_lo_sigue_antes_de_cobrar` | si el saldo baja (o sube) después de mostrar el precio, el botón pasa a `aria-disabled` con «Te faltan» (o lo pierde) sin pedir nada; el servidor sigue siendo quien decide |
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
| `inicio.edicion.el_campo_conserva_el_aro_de_foco_y_su_ejemplo_se_lee_con_el_gris_secundario` | el aro ámbar de la carta (§4, «sin excepción») sigue saliendo cuando se le lleva el foco desde «Iniciar» (desde una idea, hasta el 14-oct-2026, cuando eran botones). **Desde el 14-oct-2026 lo dibuja el cuadro** (`CuadroDeTexto`, `has-focus-visible:outline-2 … outline-ambar-claro`, offset 3) y el campo lleva `outline-none` para no duplicarlo (antes el campo era el que no llevaba `outline-none`); su pista (placeholder) usa `placeholder:text-secundario` (6.45:1 sobre la superficie, y también ≥ 4.5 sobre `elevada`, el fondo del cuadro) y no el 50 % del texto de Tailwind (4.39:1, no pasa AA). La prueba lee `tokens.css` y calcula los contrastes; el navegador real lo comprueba `web/e2e/inicio-edicion.spec.ts` (un solo aro, el del cuadro) |
| `inicio.edicion.el_campo_vive_en_un_cuadro_con_borde_de_campo_y_fondo_elevada_y_un_clic_en_el_cuadro_enfoca_el_texto` | 14-oct-2026: el campo de Edición está en el mismo cuadro bien definido que Imagen y Video (`border-campo` ≥ 3:1 contra la caja, `bg-elevada`, `rounded-medio`, `p-3`); un `mousedown` en el relleno del cuadro le da el foco al texto y no lo suelta, y un clic en el propio texto sigue su camino |
| `inicio.edicion.el_campo_crece_para_que_su_ejemplo_no_se_corte_en_un_telefono` | el piso de 96 px en teléfono (`min-h-24`; 68 px desde 640 px) y `field-sizing-content` (que crece hasta lo que haga falta, con tope `max-h-56`) evitan que se corte la pista. Medido el 14-oct-2026 con las cuatro ideas rotando (Chromium): la más larga ocupa 3 renglones (67.5 px) a 320 px, 2 (45 px) de 360 a 861 px y 1 (22.5 px) a 1100: siempre cabe en el piso y el cuadro NO cambia de alto al rotar (`web/e2e/inicio-edicion.spec.ts`). Cuando la pista era un solo ejemplo largo («…hazlo vertical para Reels.») ocupaba 4 renglones en 390 px y el piso era justo ese |
| `inicio.edicion.subiendo_y_calculando_se_ven_trabajando_en_ambar_con_cursor_de_espera_y_el_clic_avisa` | «Subiendo…» y «Calculando…» son el «Trabajando» de la carta (§5) y del lienzo (`.btn.p.trab`): ámbar, `cursor-progress`, `aria-busy` y `aria-disabled`, sin el borde discontinuo del apagado, descritos por su nota; el clic sigue llegando y avisa «Ya hay un trabajo en curso…»; con el precio sigue dorado (desde el 14-oct-2026 ya no vuelve el gris discontinuo), con `aria-disabled` mientras falte el texto, sin `aria-busy` y sin cursor de espera |
| `inicio.edicion.cada_apagado_se_explica_con_su_propia_linea` | `aria-describedby` en cada estado en que «Iniciar» tiene `aria-disabled`: sin video y con texto → «Agrega el video con el «+»…»; sin precio → «No pudimos calcular el precio…»; sin saldo → «Tienes ✦ S: no alcanza…» (antes solo «sin texto» y «fuera de rango» tenían su línea) |
| `inicio.edicion.el_recargar_mide_44_px_aunque_su_letra_sea_chica` | con la recarga abierta, «Recargar» (un enlace de una línea de letra de 13 px) trae `min-h-11 min-w-11` y márgenes negativos que lo devuelven al renglón, y su aro de foco va por dentro; medido en un navegador de verdad: 44 × 44 y la nota no crece |
| `inicio.edicion.el_chip_editar_va_junto_al_mas_antes_del_boton_principal_con_su_lista_de_una_opcion` | 14-oct-2026 (dueño: «el botón de editar lo vamos a poner a lado del +, como los otros casos; más adelante vamos a poner aquí también lo de videos a shorts»): «Editar ▾» es el MISMO `SelectorOpcion` que «Un video corto ▾», justo después del «+» y antes de «Iniciar» (el orden del foco); `aria-haspopup="listbox"`, `aria-expanded`, `aria-controls`, y `data-pista` = la nota de la opción («Sube tu metraje y la IA te propone el corte. Se edita una copia: tu original se queda como está.»). Su lista tenía UNA opción (`MODOS_EDICION`, en `edicion.ts`), seleccionada, con «según el video» a la derecha. Edición no trae chip de modelo ni de duración. «De videos a Shorts» seguía en el menú de la izquierda. **15-oct-2026:** la lista tiene DOS opciones, que la prueba afirma (`MODOS_EDICION.map(id)` = `editar`, `shorts`): «Editar» (la de ahora, seleccionada al abrir y con el foco) y «De videos a Shorts» (nota «Sube un video largo y te daremos los mejores momentos.»), las dos con «según el video». Ya no hay menú de la izquierda: «De videos a Shorts» solo se alcanza por aquí (cumplido el «más adelante irá aquí» del dueño). El ID conserva «de_una_opcion» porque era la única |
| `inicio.edicion.el_chip_se_porta_como_el_de_video_flechas_esc_clic_fuera_y_elegir_la_unica_solo_cierra` | ↓ abre con el foco en la opción; con una sola opción, ↑ ↓ Inicio y Fin no se salen de ella; Esc cierra y devuelve el foco al chip; Enter, Espacio y el clic la eligen: cierra, devuelve el foco al chip y no cambia nada (ninguna petición, el texto se conserva); el clic fuera y Tab cierran; irse a otra familia con la lista abierta la deja cerrada al volver. **15-oct-2026:** con DOS opciones, ↓ y Fin van a «De videos a Shorts», ↑ e Inicio vuelven a «Editar» y ninguna sale de la lista; Enter, Espacio y el clic en la opción de AHORA («Editar») siguen siendo solo cerrar. Elegir la otra cambia de modo, y eso lo prueba `EdicionShorts.test.tsx`. El ID dice «la única» por historia |
| `inicio.edicion.iniciar_es_dorado_en_todos_los_estados_y_solo_cambian_lo_que_dice_y_su_semantica` | 14-oct-2026 (dueño: «donde está ahora el botón de Editar, va a decir «Iniciar» con el botón dorado como el de Generar»): sin video, con texto sin video, subiendo, con precio y con precio sin texto, el botón es ámbar (`bg-ambar`, nada de borde discontinuo ni gris) como «Crear» de Imagen y Video, que tampoco se pinta apagado sino que avisa al pulsarlo. Lo que cambia entre estados es lo que dice y su semántica: `aria-disabled` mientras no se pueda (nunca `disabled`: retiene el foco y explica), `aria-busy` solo subiendo/calculando, y NADA de `aria-disabled` cuando cobra. «Editar ✦ N» y «Editando…» ya no existen |
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
| `test_cada_entrada_del_menu_lleva_icono` | `GRUPOS` en `Inicio.tsx`: cada `Entrada` exige `icono`; `inicio.menu.entradas_y_grupos_en_orden` cuenta las 6 (eran 7 hasta el 14-oct-2026). **15-oct-2026:** `GRUPOS` y `EntradaMenu` ya no existen; el registro es `marca/menu.ts`, donde `AreaMenu`, `GrupoMenu` y `PantallaMenu` exigen `icono: NombreIcono` (sin él no compila) y `Mapa`, `Grupos` y `Pantallas` lo pintan. `Marco.test.tsx` vigila que cada `pagina` de `menu.ts` sea el `pantalla` de un `<Marco>` real |
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
| `test_en_el_telefono_el_inicio_no_se_desplaza_de_lado` | Playwright a 390 px (sin scroll horizontal); el menú se desplaza en su fila y las pistas tienen `max-w` contra la ventana. **15-oct-2026:** ya no hay fila de menú que se desplace: la tarjeta es de una columna y el mapa pasa a la «X compacta» (≤ 560 px); lo mide `web/e2e/inicio-recorrido.spec.ts` en cada paso a 320, 390 y 1100 px (sin desborde horizontal, lo tocable de 44 px y letra de 13 px o más). Las pistas con `max-w` contra la ventana son las del chip de la caja (`inicio-caja.spec.ts`, 320–359 px) |
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
| `test_mix_tiene_su_propio_grupo_en_el_menu` | `inicio.menu.entradas_y_grupos_en_orden` (15-oct-2026: ya no tiene grupo propio, «Publicidad Automática»: MIX está en Marketing › Avanzado, junto a la Copiadora de estilos) |
| `test_mix_va_debajo_de_blotato_porque_blotato_es_su_requisito` | `inicio.menu.entradas_y_grupos_en_orden` (el orden ya no es «debajo»; el requisito sigue: MIX se apaga sin la clave de Blotato, `inicio.menu.sin_clave_se_apagan_las_cuatro_de_blotato_y_ofrecen_conectar`) |

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
| `test_entrar_portada.py::test_estudio_sirve_el_mismo_index` | desde `todos` (14-oct-2026) pide la vieja con la cookie `ui=clasica`; `test_estudio_lleva_al_inicio_nuevo` espera el 302 que conserva el query, y `test_las_tres_son_publicas_con_cognito` sigue el 302 hasta `/estudio/inicio/` sin pasar por `/entrar`. Las dos que esperan el 302 (`test_estudio_lleva_al_inicio_nuevo` y `test_las_tres_son_publicas_con_cognito`) solo lo esperan si la pantalla nueva está compilada (en el contenedor del CI); sin `web/dist` dan 200 |
| `test_cache_estaticos.py` (`/estudio/` y `/index.html` en `no-cache`) | se queda con la cookie `ui=clasica`: `server/migracion.py` sirve la vieja con `no-cache`. `test_el_302_del_estudio_no_se_queda_en_cache` fija el `no-store` del 302 |
| `test_web_tuberia.py::test_la_app_real_sirve_la_vitrina_si_esta_compilada` | con `web/dist`, `/estudio/` da el 302 y con la cookie `ui=clasica` el 200 |

## Diferencias a propósito

- **Mapa con Irremplazables (dueño, 15-oct-2026: «Me gusta, ahora empecemos a
  tocar el código»):** el inicio deja de tener menú a la izquierda, en cualquier
  ancho, y pasa a ser un **recorrido de tres pasos dentro de una sola tarjeta**.
  Cómo quedó cada decisión:
  - **Mapa en X → tres opciones → pantalla (15-oct-2026).** El mapa tiene las
    cinco áreas (Marketing, Producto, Central, Ventas y Automatizaciones);
    elegir una abre sus tres opciones (las de Marketing: Distrito · Blotato ·
    Avanzado); elegir una abre la pantalla: la caja (Distrito) o la lista de las
    pantallas del grupo. Producto, Ventas y Automatizaciones son fichas inertes
    («Próximamente»: se enfocan, no se abren). Hay **una sola lista de adónde
    ir**, `web/src/marca/menu.ts` (áreas → grupos → pantallas); de ella salen el
    recorrido (`recorrido.ts`, todo su estado sin React), el mapa, las opciones,
    la lista y las migas de las hojas, así que no se desincronizan. Lo que hacían
    `GRUPOS`, `Menu` y `EntradaMenu` de `Inicio.tsx` (y la columna `<aside>`) ya
    no existe como tal.
  - **Se aterriza en la caja (15-oct-2026).** Al abrir `/estudio/inicio/` se ve
    la caja, como siempre, con las migas «Marketing › Distrito»: el mapa se abre
    desde las migas y «Estás aquí» marca el lugar actual. La caja sigue
    ARRANCANDO en Video, donde arrancaba
    (`inicio.caja.arranca_en_el_clip_lo_mas_barato`,
    `inicio.edicion.el_riel_tiene_tres_familias_con_aria_pressed_y_arranca_en_video`):
    por eso el primer «Volver a …» que se ve dice «Volver a Video».
  - **Tarjeta única (15-oct-2026).** 820 px como mucho, centrada y pegada arriba
    (`pt-16`, no se centra en vertical para que no salte de un paso a otro). Adentro, el
    `h1` «Irremplazables» (dorado, único `h1`, sin icono), las migas y el paso con
    su `h2` («Elige un área», «Elige un grupo», «¿Qué vamos a crear hoy?», el
    nombre del grupo en la lista). La `<section>` de la caja deja de ser su
    propia tarjeta (sin borde, fondo ni margen propios; pierde el
    `min-[861px]:mt-[82px]` que la alineaba con el menú) y «Mis creaciones» queda
    debajo, del mismo ancho.
  - **Migas, «Volver a …» y Esc (15-oct-2026).** La ruta elegida son chips
    («Marketing › Distrito») y cada uno reabre su nivel. Con el mapa o las
    opciones abiertos aparece «Volver a Imagen» (o Video, o Edición: la pestaña
    de ahora; o la pantalla de la que vienes; o el grupo). **Esc** hace lo mismo,
    pero solo cuando el foco está dentro de la tarjeta (el `onKeyDown` es de
    ella, no de la página: con un diálogo, el menú del «+» o la lista de «Editar
    ▾» abiertos, Esc es de ellos). Mirar otra área NO te saca de donde estabas:
    «Volver» regresa a Marketing › Distrito, no a Central.
  - **La caja siempre montada (15-oct-2026).** Con el mapa, las opciones o una
    lista a la vista, la caja y lo que cuelga de ella («Mis creaciones», los
    caminos de quien empieza, los archivados) se esconden con `hidden`, no se
    desmontan: así no se pierden el texto escrito, el video subido, una subida
    en curso ni el filtro de la galería. Se esconde de la vista, del foco y del
    lector de pantalla.
  - **La lista de pantallas de un grupo (15-oct-2026).** Lo que enseña un
    grupo que no es la caja: tarjetas-enlace con título, línea de apoyo e icono.
    Las de Blotato se apagan (`aria-disabled`, «Conecta tu Blotato para usarlo»)
    solo cuando se sabe que no está conectado, y su clic abre el diálogo en
    vez de navegar: es la regla M23 · C de siempre, sin cambios (ver las filas
    `inicio.menu.*`). El botón de conectar o ver la cuenta (antes el «+»/✓ del
    encabezado del grupo en el menú) pasó arriba de esa lista y ahora dice lo que
    hace. Todo Central sale «Próximamente» y no navega (fondo hundido y texto
    secundario, no media opacidad: a media opacidad no pasaba el contraste); un
    grupo sin pantallas (Deepseek) dice «Todavía no está disponible.».
  - **Las hojas llevan migas (15-oct-2026).** Agenda, Competencia, Métricas, MIX
    y la Copiadora de estilos siguen siendo páginas, con «← Estudio» y, al lado,
    «Marketing › Blotato» (o «Avanzado») como **enlaces** al inicio con
    `?desde=<lugar>&ver=mapa|grupos`. El inicio lee esos dos parámetros UNA vez,
    al abrir, con las claves validadas contra `menu.ts` (una clave que no existe
    se ignora y se aterriza en la caja) y limpia solo lo suyo de la URL (deja
    `?blotato=conectar` y el ancla). Las pantallas que el mapa no tiene (Admin,
    Crear, Subir, Clip, Imágenes y Shorts) no llevan migas. Las migas son
    `<ol><li>`: las pruebas de Agenda, Métricas y MIX que cuentan `listitem`
    lo hacen ahora dentro de `<main>`.
  - **«De videos a Shorts» dentro de «Editar ▾» (15-oct-2026).** Es la segunda
    opción del chip y ya no tiene entrada propia (en el menú tenía el enlace a
    `/shorts.html`, que sigue valiendo en la clásica). El modo vive en
    `useEdicion`, así que cambiar de pestaña, abrir el mapa o dejar rotar la
    pista no lo pierde, ni la liga escrita. Su cuerpo: texto de apoyo, el campo
    «Liga de YouTube», el «+» y «Iniciar» dorado **sin precio**. **«Iniciar» no
    cobra: navega** a la pantalla de Shorts (la que muestra cada precio y cobra
    con su propio botón): con liga de YouTube, a `/estudio/shorts/?url=<liga>`,
    donde queda escrita en «Importar» sin cotizar ni importar; con un video
    subido desde el «+», a `?p=<proyecto>`; sin nada, avisa qué falta; con una
    liga que no es de YouTube, error junto al campo. No se inventó ningún
    endpoint ni se tocó el servidor. Editar no cambió: lo siguen cubriendo,
    tal cual, los `inicio.edicion.*` de más arriba.
  - **Copiadora de estilos, provisional en Avanzado (15-oct-2026).** No estaba
    en el prototipo: va a ser parte de «Marcas», que todavía no existe. Se queda
    en Marketing › Avanzado (con MIX) para no dejar sin puerta una pantalla que
    funciona, y se quita cuando Marcas exista.
  - **Celular, dorado y foco (15-oct-2026).** Hasta 560 px el mapa es la «X
    compacta» (dos columnas, Central como banda de ancho completo en medio,
    trazos punteados cortos); en escritorio, una cuadrícula de 3×3 con las dos
    diagonales punteadas por detrás. Fichas de 44 px o más, letra de 13 px o más,
    «Automatizaciones» y «Estás aquí» sin partirse a 390 ni a 320 px. El título
    lleva un degradado dorado solo para él (tokens `--color-oro*` y la clase
    `texto-oro`; `docs/DISENO.md` §3). El foco nunca cae a `<body>`: al cambiar de
    paso va al `h2` del paso nuevo, y el segundo clic de un doble clic en una
    ficha del mapa (menos de 500 ms) no elige un grupo por accidente.

  **Qué pasó con cada aserción vieja que cambió (15-oct-2026).** Ninguna se
  borró: los IDs `inicio.menu.*` e `inicio.blotato.*` se conservaron con su
  nombre y se adaptó el cuerpo de cada prueba a la ruta nueva (la tabla de
  arriba dice qué afirma ahora cada una).
  - `inicio.menu.entradas_y_grupos_en_orden`: ya no cuenta entradas de un menú:
    recorre mapa → Marketing → Blotato y Avanzado, y Central › Distrito, y
    comprueba las mismas puertas y el mismo orden; exige que no haya nav
    «Secciones» ni «De videos a Shorts» en las listas.
  - `inicio.menu.editor_de_videos_salio_y_las_otras_dos_de_su_grupo_se_quedan`:
    «De videos a Shorts» deja de ser una de «las otras dos»: está en el chip; la
    Copiadora de estilos sigue con su texto tal cual.
  - `inicio.menu.el_titulo_dice_irremplazables_en_dorado_sin_icono`: de
    `text-ambar-claro` y `text-titulo-sm font-bold` a `texto-oro`,
    `text-titulo-lg` y `font-extrabold`; y es el único `h1`.
  - `inicio.menu.sin_clave_…`, `…si_no_se_sabe_…` y `…pregunta_ligero`: la misma
    regla, en las listas.
  - `inicio.blotato.*`: las 11 se conservaron; su `abrir` ya no pulsa el «+» del
    menú sino que entra a la lista de Blotato por el mapa y pulsa el botón de
    conectar; `desconectar_pide_confirmar` y `conectar_enciende_el_menu` miran
    ahora las tres tarjetas.
  - `inicio.edicion.el_chip_editar_…` y `…el_chip_se_porta_como_el_de_video_…`:
    de una a dos opciones (ver sus filas).
  - `inicio.caja.sin_texto_no_navega`: el aviso ya no manda «a entrar por el
    menú de la izquierda» (no hay): dice solo «Cuéntanos qué quieres primero.».
  - Lo que NO se registró: ninguna de las pruebas nuevas del recorrido ni del modo
    Shorts lleva `inicio.` (ver «Pruebas sueltas»), porque no son algo que la
    pantalla vieja garantizara.
  - El e2e que miraba el menú (`inicio-caja.spec.ts`: «el título del menú dice
    Irremplazables…») se reescribió para la tarjeta y se le sumó que ya no hay
    nav «Secciones»; `docs/QA-UI.md` § inicio reemplaza las filas 43 y 46,
    reescribe la 8 y la 9 y suma las 49 a 70.

- **Ajustes del dueño a la pestaña Edición y al menú (14-oct-2026, mirando una
  captura; el menú de la izquierda dejó de existir el 15-oct-2026, ver el
  bullet de arriba, y lo que sigue se lee como historia de ese día):** (1)
  «Editor de videos» salió del menú de la izquierda (quedan «De
  videos a Shorts» y «Copiadora de estilos»); `static/index.html`, la página
  vieja, no se tocó, y la tarjeta «Desde tu metraje → Subir metraje» del primer
  uso sigue llevando a `/e1.html`. (2) El título de la columna izquierda dice
  **«Irremplazables»** en dorado (`text-ambar-claro`; desde el 15-oct-2026 es
  el dorado con degradado de la tarjeta), sin icono; los `<title>`
  de las páginas y el título de las otras pantallas siguen diciendo «Estudio de
  video · …» (pendiente de decidir). (3) El texto de las TRES familias está en un
  cuadro bien definido (`ui/CuadroDeTexto`): borde de campo, fondo `elevada`,
  radio de campos; el aro de foco lo dibuja el cuadro y el texto no dibuja otro.
  (4) «Editar ▾» junto al «+», como el chip de las otras familias: se extrajo
  `SelectorOpcion.tsx` de `Caja.tsx` y lo usan las dos cajas, así que hay un solo
  teclado, un solo foco y una sola posición (la revisión del mismo día corrigió en las tres familias que la pista del chip no se pintaba y que Tab con la lista abierta tiraba el foco a `<body>`: ver `inicio.caja.selector_*`).
  Ese día tenía una opción; desde el 15-oct-2026 tiene dos, y «De videos a
  Shorts» quedó ahí mismo (ver el bullet de arriba). (5) *No se hizo en
  esta pasada:* que las ideas («Quita muletillas y silencios»…) aparezcan y
  desaparezcan donde dice «Cuéntale a la IA». La fila de ideas, `usarIdea` y su
  `role="group"` quedaron como estaban, debajo del cuadro. *(Se hizo después, en
  el commit de las ideas que rotan: ver el bullet de abajo.)* (6) El botón principal
  dice **«Iniciar»** (antes «Editar»; «Iniciando…» antes «Editando…») y es dorado
  en TODOS los estados, también sin video y sin texto, y sin saldo: avisa al
  pulsarlo, como «Crear». Conserva la semántica de antes (`aria-disabled`, nunca
  `disabled`; el clic llega y explica; «Subiendo…» y «Calculando…» ocupados). Eso
  contradice la fila «Sin saldo / deshabilitado» del botón principal de
  `docs/DISENO.md` §5 para este botón: la carta lo registra ahí con su porqué.
  **Qué pasó con cada aserción vieja:** las 4 pruebas cuyo ID nombraba «Editar»
  (`sin_video_el_boton_es_editar…`, `doble_clic_en_editar…`,
  `…_editar_lo_vuelve_a_pedir`, `enter_repetido_en_editar…`) se renombraron a
  «iniciar»; `el_boton_apagado_enfocable_…` quedó como la prueba de la pieza
  `<Boton apagado>` (que sigue en `ui/Boton`, ya sin uso en producción);
  `el_campo_conserva_el_aro_de_foco_…` y `subiendo_y_calculando_…` cambiaron lo
  que afirman (el aro es del cuadro; con el precio el botón sigue dorado, ya no
  vuelve al gris); `entradas_y_grupos_en_orden` cuenta 6 entradas y no 7. El
  guardián de botones (`test_m21_botones.py`) ganó el verbo «Iniciar».

- **Las ideas de Edición pasan de botones a pista que rota (dueño, 14-oct-2026,
  punto 5 de los ajustes; eligió «Rotan solas como pista»):** las cuatro ideas
  («Quita muletillas y silencios», «Un short vertical para Reels», «Resumen de 60
  segundos», «Subtítulos grandes y un título») eran botones-píldora debajo del
  campo que ponían su texto. Ya no: en el lugar del texto gris del campo va
  apareciendo y desapareciendo UNA idea a la vez («Cuéntale a la IA qué quieres.
  Ejemplo: «<idea>»»), con fundido, cada 4 s, en círculo; son solo una pista y
  desaparecen al escribir como cualquier texto de pista. Se fueron la fila
  `role="group"`, los cuatro `<button>`, `usarIdea` de `useEdicion` y
  `AYUDA_TEXTO` ya no dice «o toca una idea». **Cómo:** el `placeholder` NATIVO del
  `<textarea>` con su opacidad en transición (`placeholder:` de Tailwind), y no una
  capa encima: alinea idéntico a lo que se escriba, no tapa clics, desaparece solo
  al escribir y no hay nada que desalinear. **Se midió, no se supuso:** Chromium
  (Playwright, reloj de la pantalla falso y muestreo real de
  `getComputedStyle(campo, '::placeholder').opacity`) sí transiciona
  `::placeholder`: la salida baja de 1 a 0 pasando por 0.89 → 0.56 → 0.30 → 0.11 y
  la entrada sube de 0.22 a 1, en los 250 ms de `--dur-media` (la curva de lo que
  se va, `--ease-entrada`, a la salida; la de lo que llega, `--ease-salida`, a la
  entrada). La capa `aria-hidden` queda descartada por innecesaria. **Solo se midió
  Chromium.** Firefox y Safari no están probados aquí. Donde un navegador no
  transicione `::placeholder` la pista no hace fundido: se simuló en Chromium con
  `textarea::placeholder{transition:none}` y la idea se apaga de golpe (opacidad
  1 → 0 a los ~3.7 s), el campo queda ~250 ms sin pista y la idea siguiente
  aparece de golpe (0 → 1 con el texto nuevo a los ~3.98 s). Se degradaría a una
  pista que parpadea cada 4 s, no a un cambio directo; no se perdería ninguna
  función. Si el dueño quiere cerrarlo, lo que falta es probar en un Firefox real
  y, solo si falla ahí, usar la capa `aria-hidden` que el brief ya preveía.
  `document.getAnimations()` NO lista esas transiciones, así que
  `animacionesVivas` de `e2e/pantallas.ts` no las ve: el guardián de movimiento
  reducido las mide por `::placeholder` (ver abajo). **El reloj**
  (`usePistaRotatoria`): un solo `setTimeout` que se re-arma en cada paso (la idea
  quieta 3.75 s; sale 0.25 s; al terminar el fundido se cambia el texto, que ya no
  se ve, y entra la siguiente), así de una idea a la siguiente pasan 4 s justos y
  nunca hay más de un temporizador vivo: ni al desmontar, ni bajo StrictMode, ni
  al cambiar de familia (Edición se desmonta y al volver abre en la primera).
  Empieza SIEMPRE en la primera y sin animación (carta §4: «Nada anima por defecto
  lo que ya estaba al abrir la pantalla»). **Cuándo NO rota:** con «reducir
  movimiento» (queda fija en la primera idea: la carta pide que con la preferencia
  todo quede quieto, y `::placeholder` no es `*`, así que la regla global de
  `tokens.css` NO lo alcanzaría: lo decide el hook con `matchMedia`, reacciona si
  la persona cambia la preferencia y el campo lleva además
  `motion-reduce:placeholder:transition-none`. Al ENCENDERLA el hook olvida lo
  que la rotación había avanzado (vuelve a la primera), y por eso al APAGARLA
  sigue en la primera y rota desde ahí con su fundido, en vez de saltar sin
  fundido a la idea que traía guardada; el reinicio cuelga de `reducido`, no de
  que `rota` cambie, porque con el campo enfocado o con texto `rota` ya era
  falso y el cambio no se habría visto); con el foco en el campo (quien va a
  escribir no ve la pista cambiar bajo el cursor: se congela entera y retoma al
  perder el foco con el campo vacío); con texto (no corre nada, ni temporizador ni
  fundidos; vaciarlo retoma); y con la pestaña oculta (sin ciclos acumulados).
  **Accesibilidad:** la rotación no se anuncia (sin `aria-live`); el nombre del
  campo sigue siendo su `aria-label` y no la pista; y como las ideas ya no se
  alcanzan con Tab, quien usa lector de pantalla recibe un ejemplo FIJO como
  descripción del campo (`aria-describedby` a un `<p hidden>` con «Por
  ejemplo: quítale las muletillas, ponle subtítulos y hazlo vertical para
  Reels.», el que traía el campo antes): lo más simple que no repite a la vista lo
  que ya se ve rotando. Va `hidden` y no `sr-only`: `sr-only` es invisible pero NO
  está oculto, así que el lector lo recitaba también como párrafo suelto entre el
  campo y el «+» (medido con `ariaSnapshot` en Chromium); `hidden` lo saca del
  árbol y `aria-describedby` sigue calculando la descripción desde él. La pista sigue en el gris secundario (6.45:1 sobre la
  superficie, 5.72:1 sobre el cuadro). **Alturas:** el cuadro no cambia de alto al
  rotar (ni mueve lo de abajo): con las cuatro ideas, la más larga ocupa 3
  renglones a 320 px (67.5 px), 2 de 360 a 861 px y 1 a 1100, dentro de los pisos
  de 96 px (teléfono) y 68 px (desde 640 px); medido a 320, 390 y 1100.
  **Qué pasó con cada aserción vieja:**
  `inicio.edicion.una_idea_pone_su_texto_en_el_campo_y_le_da_el_foco` (las 4
  ideas, tocar una pone su texto y enfoca el campo) se retiró: murió con los
  botones. Lo que de ella sigue siendo verdad (las 4 ideas y su orden; la ayuda ya
  no manda a tocarlas) está en
  `…la_fila_de_botones_de_ideas_ya_no_existe_…` y
  `…la_pista_arranca_en_la_primera_idea_…`. `todo_lo_tocable_mide_al_menos_44_px`
  dejó de contar las ideas; `sin_texto_el_boton_con_precio_…` ya no «enciende»
  «Iniciar» tocando una idea (escribe); `el_riel_…` lee la pista de la primera
  idea en vez del `HUECO_TEXTO` fijo (que se retiró: ahora es `huecoDe(idea)`); y
  en los e2e, el recorrido por Tab pasó de siete paradas a tres (el «+», «Editar
  ▾» e «Iniciar») y la comprobación de que el ejemplo no se corta ahora recorre
  las cuatro ideas. `web/e2e/movimiento-reducido.spec.ts` NO cubría esto (solo
  abre cada pantalla en su pestaña inicial, Video): ganó tres pruebas (quieta con
  «reducir movimiento», control sin la preferencia donde sí rota, y reacción al
  cambiar la preferencia con la pantalla abierta).

- **Dos defectos del chip `SelectorOpcion` que la revisión de la pista encontró (ya estaban
  en `a9721f0`; 14-oct-2026), arreglados para las tres familias a la vez:** (1)
  `aria-controls` apuntaba a un id sin elemento mientras la lista estaba cerrada (la
  lista solo se monta al abrir): ahora solo lo lleva abierta, como `MenuModelo`;
  probado en `SelectorOpcion.test.tsx`. (2) A 320 px la página se podía arrastrar de
  lado hasta 24 px: la pista del chip (su `::after`, invisible pero con lugar) medía
  hasta `100vw - 72px` desde el chip, que empieza en x = 95 por debajo de 640 px
  (20 de margen, 1 de borde, 16 de relleno, 48 del «+» y 10 de separación); con
  `100vw - 132px` el borde derecho de la pista queda dentro de la pantalla (sobrante
  0 px a 320, 330, 344, 345, 360 y 390, en Imagen, Video y Edición; de 382 px para
  arriba sigue valiendo 250 y no cambia nada). Lo vigila un e2e a 320, 340 y 359 px
  en `inicio-caja.spec.ts` (mide la página entera y el borde derecho de la pista;
  con el valor viejo falla).

- **Cuentos e historias llevan «+» para la foto del personaje (dueño, 14-oct-2026,
  «en cuento e historia debe de tener el +»):** hasta hoy «Creador de cuentos» y
  «Crea tu historia» solo mandaban el texto por la URL a `/crear.html`, y la
  pantalla Crear (que sí acepta la imagen del personaje) no recibía nada. Ahora la
  caja admite **una** foto en esas dos opciones y, al pulsar «Crear», la deja en
  el navegador y navega a Crear, que la recoge y la pone en su cuadro como si la
  persona la hubiera agregado allá (`docs/migracion/crear.md`). Cómo:
  `nucleo/traspaso.ts` guarda el `File` en **IndexedDB** (un archivo no cabe en la
  URL ni en `sessionStorage`, que solo guarda texto y unos 5 MB) bajo un token
  (`crypto.randomUUID()`) con vigencia de 10 minutos; la URL lleva `&refs=<token>`.
  **No se toca el servidor ni `pipeline/`.** Decisiones: (1) **una foto, no
  cuatro:** Crear acepta hasta 4, pero el motor solo usa la primera
  (`pipeline/character.py:96`, `pipeline/flow.py:69`); ofrecer 4 en la caja
  prometería lo que no pasa. Con tope 1 la caja ya reemplaza la anterior (el mismo
  camino de «Editar una imagen»). Subir el tope es decisión de la persona dueña y
  se hace en `referencias:` de `logica.ts` (y en el motor). (2) **La validación es
  la del editor** (`rechazo(f, 'editar')`: JPG, PNG o WebP de hasta 15 MB), la más
  conservadora: una foto HEIC o GIF que el clip leería aquí se rechaza con su
  motivo, porque Crear no las convierte. Vale también para la foto que llegó del
  clip al cambiar de opción: al pulsar «Crear» se revisa con la misma regla y,
  si no sirve, se dice por qué y no se guarda ni se navega (la persona la quita o
  la reemplaza). Una foto sin tipo MIME (WebP sin registrar en el sistema, un
  archivo de Drive) se completa al aceptarla con `tipoDe`, porque Crear filtra
  por tipo y la descartaría con un aviso falso. Reemplazar la foto del personaje
  no borra las otras referencias del clip: solo toma el lugar de la primera. (3) **Si no se pudo guardar** (sin
  IndexedDB, ventana privada, cuota, o no contestó en 4 s) se navega igual con
  `refs=perdida`: navegar no cobra nada y la persona no se queda sin camino;
  Crear le dice «Tu foto no alcanzó a llegar desde el inicio. Agrégala con el «+»
  de aquí.» (4) **Leer no borra**: si recarga Crear, la foto sigue ahí hasta que
  venza o se cree la película (entonces Crear la olvida). (5) Al navegar no se
  vacían texto ni foto (como hoy con el texto): si regresa con «atrás» siguen. Los
  textos del «+» de estas dos opciones (`Opcion.textosMas`) hablan de «la foto de
  tu personaje»; los de las demás no cambian. **Con foto la caja navega directo a
  `/estudio/crear/?brief=…&modo=…&refs=…`, no por `/crear.html`:** la vieja
  `static/crear.html` ignora `refs`, y en la etapa `nueva` `/crear.html` NO
  redirige (`server/migracion.py: decidir` da `None`), así que pasar por ella
  perdería la foto sin aviso. Sin foto la dirección sigue siendo
  `/crear.html?brief=…&modo=…`, idéntica a la de siempre (ahí rige la cookie
  `ui=clasica`). **Límite conocido:** quien tiene la cookie `ui=clasica` y usa la
  foto llega igual a la pantalla nueva (la clásica no sabe recibirla). Y Crear
  acepta 4 fotos pero el motor usa la primera.

- **Crear una imagen, sin estilo (dueño, 14-oct-2026, «me parece bien la opción
  1»):** la caja manda `estilo: 'ninguno'` a `POST /api/imagenes` y a fal le
  llega el texto de la persona más las reglas de siempre
  (`«<texto>. No text, no watermark.»`), sin el «3D animated film style,
  Pixar-like…» que antes se le pegaba a TODA imagen. Era una herencia de R4b
  (7-oct): la caja copió el estilo fijo de la pantalla de Imágenes, donde sí hay
  selector, y nadie lo decidió para la caja. Ahora es como con los clips de «Un
  video corto»: lo que escribes es lo que se dibuja (quien quiera un look lo
  pide con sus palabras, o usa `/estudio/imagenes/`, que conserva su selector).
  La nota de la opción lo dice así. `ninguno` no es un estilo más: vive aparte
  en `pipeline/styles.py`, **no** está en `ESTILOS` y por eso no sale en
  `/api/estilos`, ni en Imágenes ni en Crear; `POST /api/proyectos` lo rechaza
  con 422. Lo demás sigue igual: un cliente que no manda `estilo` (o manda uno
  que no conoce) sigue recibiendo `animated` del servidor, el modo «todo» de
  editar una imagen no cambia, y el pedido de los modelos lentos (cola) lleva el
  mismo `prompt` armado. «Mis creaciones» no enseña ese prompt (solo el texto de
  la persona), así que no cambia nada ahí.

- **Edición (dueño, 13-oct-2026):** la caja gana una TERCERA familia, Edición
  (riel Imagen · Video · Edición; la caja sigue arrancando en Video). En E1 es:
  un texto obligatorio («Cuéntale a la IA qué quieres…», con 4 ideas que
  hasta el 14-oct-2026 eran botones de un toque y desde entonces rotan como pista) + UN video que se sube desde el «+» o soltándolo en la caja + «Iniciar
  ✦ N» (se llamaba «Editar ✦ N» hasta el 14-oct-2026). El precio lo da `GET /api/editar/<p>/costo` y lo cobra el servidor al
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
  ideas de la pista con ese límite en mente. El botón principal se apaga con
  `aria-disabled` (sin `disabled`: sigue enfocable y explica por qué). Hasta el
  14-oct-2026 además se pintaba con la variante `apagado` de `<Boton>` (borde
  discontinuo y gris); desde esa fecha «Iniciar» es ámbar pleno en todos los
  estados y ya no usa `apagado`.

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
  campo traía `outline-none` y al llevarle el foco desde «Editar» (hoy «Iniciar») o una idea (entonces un botón) no
  se veía dónde caía (ahora conserva el aro de la carta); su ejemplo se leía a
  4.39:1 (el 50 % del texto) y ahora a 6.45:1, y en un teléfono se cortaba su
  último renglón; «Subiendo…» y «Calculando…» eran gris discontinuo (el apagado)
  cuando son el «Trabajando» de la carta, en ámbar; «Recargar», con la recarga
  abierta, medía 54 × 19 px; cada apagado ahora se explica con su línea
  (`aria-describedby`); y «Ya hay un trabajo en curso…» se quita solo cuando ese
  trabajo termina, como en el lienzo. Lo que **difiere a propósito** del lienzo:
  (1) (hasta el 14-oct-2026) el apagado era el gris discontinuo de la carta y no
  el ámbar a media opacidad; hoy «Iniciar» es ámbar pleno en todos los estados y
  solo avisa con `aria-disabled` (ver «Ajustes del dueño» del 14-oct y DISENO
  §5); (2) «Te faltan ✦ N · Recargar» va junto al botón (`<Recarga>`,
  DISENO §5 y §8: el 402 se queda junto al botón que cobra) y no en el cuadro de
  avisos: ese cuadro es de `trabajos.js` y no puede pintar un componente de
  React; (3) sin Marca (chip, menú y «Administrar marcas…»), sin el menú del «+»
  ni la hoja «Agregar videos», sin la lista de varios videos: son piezas
  posteriores, así que el «+» abre directo el selector y se llama «Cambiar el
  video» cuando ya hay uno (el lienzo: «Agregar otro video»); (4) el campo se
  puede redimensionar (`resize-y`, como el de Imagen y Video; el lienzo lo
  fija); (5) el botón se llama «Editar ✦ N» (hoy «Iniciar ✦ N») a secas para el lector de
  pantalla (como todo botón que cobra del repo); el lienzo le pone `aria-label` «Editar
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
  que se desplaza. *(Hasta el 15-oct-2026: ya no hay menú ni fila; el botón de
  Blotato está en la lista del grupo y el mapa del celular es la «X compacta».)*
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
