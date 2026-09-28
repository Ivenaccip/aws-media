# Migración del inicio (UI·8.4)

`static/index.html` (servido en `/estudio/`) → `/estudio/inicio/`
(`web/src/pantallas/inicio/`).

El inicio **no cobra**: reparte. Tiene cuatro partes:

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
| `inicio.caja.arranca_en_el_clip_lo_mas_barato` | arranca en Videos → «Un video corto», lo más barato, para quien no abra el desplegable (M25 · B) |
| `inicio.caja.precios_de_tarifas_json` | el clip con `clip.video_8s`, las historias con el rango mín–máx de `video.por_duracion` y las imágenes con `video.imagen`; el test compara contra el mismo `tarifas.json` |
| `inicio.caja.cada_opcion_lleva_a_su_destino_con_su_modo` | clip → `/clip.html?brief=`; cuentos → `/crear.html?…&modo=investigacion`; historia → `modo=idea`; imágenes → `/imagenes.html?prompt=` (y `&editar=1`); el texto va sin espacios de más |
| `inicio.caja.sin_texto_no_navega` | sin texto: el aviso junto a la caja, el foco vuelve a ella y no se navega |
| `inicio.caja.cada_opcion_cambia_el_ejemplo` | cada opción trae su ejemplo en el hueco |
| `inicio.caja.desplegable_con_teclado` | ↓ abre con el foco en la opción, ↓/Enter elige, Esc cierra sin cambiar y devuelve el foco; un clic fuera cierra |
| `inicio.caja.cambiar_de_familia_elige_la_primera` | Imágenes/Videos con `aria-pressed` y la primera opción de la familia |
| `inicio.caminos.solo_con_todas_las_listas_bien_y_vacias` | los tres caminos solo si proyectos, imágenes, ediciones y clips llegaron bien y vacíos; una que falló no cuenta como vacía (UI·10). El 503 de clips en local («corre en el servicio») sí cuenta como vacío |
| `inicio.caminos.desde_una_idea_no_cobra_solo_elige` | «Crear un video» elige «Creador de cuentos» y enfoca la caja; ni navega ni manda nada |
| `inicio.caminos.enlaces_a_shorts_y_metraje` | «Hacer shorts» → `/shorts.html`, «Subir metraje» → `/e1.html` |
| `inicio.carga.sin_proyectos_avisa_y_reintentar` | sin la lista de proyectos: aviso con Reintentar, sin concluir que es alguien nuevo; al cargar bien el aviso se va |
| `inicio.proyectos.cada_tarjeta_lleva_a_crear` | cada película abre `/crear.html?p=<id>`; su estado con icono si no está lista y «N de M slots» |
| `inicio.videos.nuevo_video_aun_sin_slots` | UI·26: «Nuevo video» siempre (con los slots llenos todavía caben un clip y unos shorts), elige Videos y enfoca la caja. Reemplaza a `inicio.proyectos.nueva_pelicula_solo_si_hay_slot`; el tope de películas lo sigue cuidando el server (409 al crear) |
| `inicio.videos.mezcla_peliculas_clips_y_shorts_lo_mas_nuevo_primero` | UI·26: «Mis videos» junta películas, clips (`/api/clip`) y los proyectos del editor que pasaron por shorts, por fecha |
| `inicio.videos.las_cuatro_etiquetas` | abajo va el tipo: `idea` y el viejo `auto` = Video largo, `investigacion` = Cuento, clip = Video corto, shorts = Shorts |
| `inicio.videos.el_estado_solo_si_no_esta_listo` | «Cuento · en revisión — te espera», «Video corto · con error»; lo listo solo lleva la etiqueta y la fecha |
| `inicio.videos.cada_uno_abre_su_pantalla` | película → `/crear.html?p=`, clip → `/clip.html?c=`, shorts → `/shorts.html?p=`; el clip listo enseña su primer cuadro, callado y fuera del tabulador |
| `inicio.videos.los_slots_cuentan_solo_peliculas` | «N de M slots» y archivar siguen siendo solo de películas |
| `inicio.videos.las_ediciones_sin_shorts_no_entran` | un metraje subido solo para el corte sigue en «Mis ediciones» |
| `inicio.videos.sin_los_clips_avisa_y_reintenta` | si `/api/clip` falla, las películas se ven y una línea ofrece reintentar |
| `inicio.proyectos.miniatura_rota_cae_al_personaje_y_al_hueco` | portada rota → personaje → hueco, sin icono roto |
| `inicio.proyectos.archivar_pide_confirmar` | archivar pide confirmación («No se borra nada…»); Cancelar no manda nada; al archivar pasa a «Proyectos archivados» |
| `inicio.proyectos.no_se_ofrece_archivar_mientras_corre` | ni se ofrece con una tarea en curso (`preparando`, `produciendo`) |
| `inicio.proyectos.error_al_archivar_dice_el_motivo` | el motivo del server (409) o «Sin conexión — intenta de nuevo.» |
| `inicio.proyectos.restaurar_desde_archivados` | Restaurar lo devuelve a «Mis videos» |
| `inicio.imagenes.cinco_y_ver_todas` | las 5 más nuevas; «Ver todas (N)» / «Ver menos» con `aria-expanded`, solo si hay más de 5 |
| `inicio.imagenes.cada_una_abre_para_editar_y_la_rota_no_deja_icono` | `/imagenes.html?img=<nombre codificado>`, carga diferida, «Nueva imagen», y una rota no deja icono roto |
| `inicio.imagenes.si_falla_la_lista_no_se_rompe` | sin `/api/imagenes` la sección no sale y el resto sí |
| `inicio.ediciones.estado_y_enlace_a_e1` | cada edición abre `/e1.html?p=<codificado>` con su estado (M14) |
| `inicio.listas.orden_videos_imagenes_ediciones` | el orden: videos → imágenes → ediciones |
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
| `test_el_clip_va_a_su_pantalla` | `inicio.caja.cada_opcion_lleva_a_su_destino_con_su_modo` |
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
