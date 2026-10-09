# Migración del inicio (UI·8.4)

`static/index.html` (servido en `/estudio/`) → `/estudio/inicio/`
(`web/src/pantallas/inicio/`).

El inicio **no decide ningún precio**: el servidor cobra. Reparte, y desde R4b también pide lo que elige modelo (un video corto, crear o editar una imagen). Tiene cuatro partes:

- **La caja** «¿Qué vamos a crear hoy?» lleva a la pantalla que cobra con el
  texto ya puesto.
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
No hay prueba que cobre: el inicio solo lleva a otras pantallas.

## Los invariantes (tests/test_migracion_ui.py)

Cada uno es un test de vitest en `web/src/pantallas/inicio/Inicio.test.tsx`
con ese nombre exacto.

| ID | Qué garantiza |
|---|---|
| `inicio.caja.arranca_en_el_clip_lo_mas_barato` | arranca en Video → «Un video corto» con su modelo de siempre (Veo 3.1 Lite), para quien no abra el menú (M25 · B); el chip de la tarea ya no lleva precio |
| `inicio.caja.precios_de_tarifas_json` | las historias con el rango mín–máx de `video.por_duracion`; las tareas que eligen modelo (clip, imagen, editar) dicen «según el modelo» y su precio sale de `tarifas.json` §modelos; el test compara contra el mismo `tarifas.json` |
| `inicio.caja.cada_opcion_lleva_a_su_destino_con_su_modo` | las tareas SIN modelo siguen llevando a su pantalla: cuentos → `/crear.html?…&modo=investigacion`; historia → `modo=idea`; el texto va sin espacios de más. (Clip e imágenes ya no navegan: ver las filas de abajo) |
| `inicio.caja.sin_texto_no_navega` | sin texto: el aviso junto a la caja, el foco vuelve a ella y no se navega |
| `inicio.caja.cada_opcion_cambia_el_ejemplo` | cada opción trae su ejemplo en el hueco |
| `inicio.caja.desplegable_con_teclado` | ↓ abre con el foco en la opción, ↓/Enter elige, Esc cierra sin cambiar y devuelve el foco; un clic fuera cierra |
| `inicio.caja.cambiar_de_familia_elige_la_primera` | Imagen/Video (el riel) con `aria-pressed` y la primera opción de la familia |
| `inicio.caja.el_modelo_se_paga_con_tarifas_json` | R4 (7-oct-2026): el menú de modelo enseña los créditos de `tarifas.json` §modelos, y son los mismos que cobran las pantallas (`clip.video_8s` = el clip de 8 s de `modelos.clip.veo-lite`, `video.imagen`) |
| `inicio.caja.el_envio_va_en_el_pie_del_menu_de_modelo` | el «Crear» de las tareas con modelo vive en el pie del menú; pide el clip a `/api/clip/generar` con `modelo` y `segundos` (8 si no se tocó), sin navegar; el menú se cierra, el texto se vacía y se avisa dónde mirar |
| `inicio.caja.el_servidor_decide_el_precio_y_un_error_se_dice` | un 402 (o cualquier error) se dice en la caja y el texto no se pierde; el cuerpo nunca trae créditos |
| `inicio.caja.un_texto_vetado_no_se_pide` | la moderación (M13) corre antes de lo que cobra |
| `inicio.caja.crear_una_imagen_se_pide_aqui` | `/api/imagenes` con `modelo`, estilo animado (el que traía la pantalla de imágenes) |
| `inicio.caja.editar_pide_la_imagen_con_el_mas` | sin imagen no sale y dice cómo agregarla; con ella va a `/api/imagenes/editar` en modo `todo` con `modelo` |
| `inicio.caja.el_mas_agrega_quita_y_respeta_el_tope` | el «+» solo existe en las tareas que usan imágenes; tope 3 (clip) o 1 (editar); un archivo que no sirve se rechaza con su motivo |
| `inicio.caja.el_clip_con_fotos_las_sube_y_suma_el_juntarlas` | las fotos suben directo a S3 (`/api/clip/presign`) y el menú dice lo que suma juntarlas (tarifas.json `clip.componer_imagenes`); la nota no cambia con la duración del clip |
| `inicio.caja.arrastrar_imagenes_a_la_caja_las_agrega` | arrastrar es un atajo del «+» |
| `inicio.caja.la_duracion_recalcula_los_precios_el_chip_y_el_pie` | R4 · duración (9-oct-2026, opción A): el menú del clip trae «Duración del clip» (4 s · 6 s · 8 s, 8 por defecto, «Más corto, más barato»); al elegirla cambian los créditos de cada fila, el rango de cada grupo, el pie («✦ N por clip de N s») y el chip («Modelo Veo 3.1 Lite · 6 s»). Los números salen de `tarifas.json` §modelos.clip, por duración |
| `inicio.caja.el_clip_manda_los_segundos_elegidos` | el pedido del clip lleva `segundos` junto al `modelo` (nunca créditos: el servidor calcula y cobra); la duración se queda para el próximo pedido |
| `inicio.caja.un_modelo_sin_esa_duracion_se_atenua_y_se_vuelve_al_predeterminado` | un modelo sin número para la duración se atenúa (`aria-disabled`, «Desde N s», no se elige); si era el elegido vuelve el predeterminado y el pie avisa `«<Modelo> empieza en N s. Te dejamos <Predeterminado>.»` (`<Aviso>`, `role="status"`); al volver a una duración que sí tiene, no se elige solo. Se prueba encendiendo LTX un rato con números de prueba |
| `inicio.caja.imagen_y_editar_no_tienen_selector_de_duracion` | crear y editar imagen no traen la duración (ni en el menú ni en el chip ni en el pie); la del clip se recuerda al volver al video |
| `inicio.caja.el_aviso_de_duracion_no_sobrevive_al_cambio_de_tarea` | el aviso «<Modelo> empieza en N s…» es de la tarea del clip: al pasar a Imagen o Editar con el teclado (sin cerrar el menú) la hoja nace de nuevo, sin aviso |
| `inicio.galeria.lo_recien_pedido_aparece_generando_y_se_relee` | mientras el servidor contesta hay una tarjeta «Generando…» al principio; al contestar, la lista se relee y la tarjeta local se va |
| `inicio.galeria.usar_como_referencia_lleva_la_imagen_a_la_caja` | el visor de una imagen la devuelve a la caja, en «Un video corto» |
| `inicio.caja.las_tareas_sin_modelo_no_traen_chip_de_modelo` | cuentos e historias no eligen modelo: su «Crear» está en la barra y lleva a `/crear.html` |
| `inicio.caja.cada_tarea_recuerda_su_modelo` | clip, imagen y editar guardan su modelo por separado |
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
| `inicio.modelos.por_nivel_y_de_menor_a_mayor_precio` | los grupos y su orden |
| `inicio.modelos.todo_modelo_del_catalogo_cae_en_un_nivel_de_su_tarea` | ningún modelo desaparece por traer un nivel que su tarea no enseña |
| `inicio.modelos.editar_solo_los_que_tienen_endpoint_edit` | Grok, GPT Image 2, Nano Banana 2 y Nano Banana Pro |
| `inicio.modelos.el_modelo_viaja_en_la_url_solo_si_no_es_el_predeterminado` | `modelo=<id>` solo si no es el predeterminado, y nunca en tareas sin modelo |
| `inicio.modelos.el_clip_trae_un_precio_por_duracion_en_enteros` | `tarifas.json` §modelos.clip es un objeto por duración: llaves de segundos que el producto sabe pedir (4, 6, 8), créditos enteros positivos y más corto nunca cuesta más; imagen y editar siguen con un entero |
| `inicio.modelos.una_duracion_sin_numero_no_se_ofrece_ni_cuesta_cero` | una duración sin número da `null` (nunca 0 ni el precio de otra); el entero viejo en un clip tampoco es un precio; el modelo se ofrece con número en al menos una duración y el selector solo trae las que algún modelo ofrece |
| `inicio.modelos.cada_duracion_recalcula_el_rango_del_grupo` | el rango «✦ lo–hi» de cada grupo cuenta solo los modelos que tienen esa duración (vacío si ninguno); las filas no se mueven al cambiar de duración |
| `inicio.modelos.cambiar_la_duracion_deja_el_predeterminado_con_su_aviso` | si el elegido no la tiene queda el predeterminado (o, si tampoco, el primero que sí) y el aviso dice desde cuántos segundos empieza; si nadie la tiene, no hay cambio |
| `inicio.modelos.la_duracion_que_rige_cae_en_una_que_se_ofrece` | si la pedida ya no se ofrece rige la de siempre (8 s) o la más larga que sí |
| `inicio.modelos.imagen_y_editar_no_dependen_de_la_duracion` | el precio, los grupos y el «desde» de imagen y editar son los mismos para cualquier duración |
| `inicio.caminos.solo_con_todas_las_listas_bien_y_vacias` | los tres caminos solo si proyectos, imágenes, ediciones y clips llegaron bien y vacíos; una que falló no cuenta como vacía (UI·10). El 503 de clips en local («corre en el servicio») sí cuenta como vacío |
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
