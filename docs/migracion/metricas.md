# Migración de métricas (UI·8.6)

`static/metricas.html` → `/estudio/metricas/` (`web/src/pantallas/metricas/`).

**No cobra nada.** El server lo dice así en `server/metricas_api.py`: «cero
créditos».

La pantalla enseña lo que ya salió por Blotato y lo que no pudo salir, con sus
números. Cuida dos cosas:

- **El cupo de Blotato.** Cada carga gasta dos llamadas: la lista y los
  números. No hay sondeo, cambiar de vista no llama y «Ver números» gasta una
  sola llamada.
- **No decir «sin números» de algo que sí los tiene.** Los motivos los
  redacta el server, y solo «no lo sabemos» ofrece preguntar.

## Etapas

| Etapa | Qué pasa | Cómo se pasa | Estado |
|---|---|---|---|
| `nueva` | `/estudio/metricas/` existe; `/metricas.html` sigue igual | este PR | ⏳ al desplegar |
| `todos` | `/metricas.html` → 302 a `/estudio/metricas/`, salvo la cookie `ui=clasica` | `etapa="todos"` + deploy | pendiente |
| `retirada` | 302 siempre; se borran `static/metricas.html` y sus tests viejos | `etapa="retirada"`, `git rm` + deploy | pendiente |

Antes de `todos`, el dueño hace el QA de `docs/QA-UI.md` § métricas. Solo
lee y no cuesta nada.

## Los invariantes (tests/test_migracion_ui.py)

Cada uno es un test de vitest en
`web/src/pantallas/metricas/Metricas.test.tsx` con ese nombre exacto.

| ID | Qué garantiza |
|---|---|
| `metricas.carga.una_llamada_al_abrir_y_ningun_sondeo` | una llamada a `/api/metricas` al abrir, aunque StrictMode monte dos veces, y ninguna más con el paso del tiempo |
| `metricas.numeros.un_contador_que_no_llego_es_un_hueco_y_no_un_cero` | `null`, un texto o `NaN` no se pintan; `0` sí; formato es-MX. Solo las casillas informadas |
| `metricas.numeros.una_bajada_se_ensena_como_bajada` | «−40 vistas desde el …» / «+40 …»; «Una sola medición.» |
| `metricas.numeros.los_milisegundos_no_se_ensenan_como_numero` | ms → «1 min 35 s»; ratio con dos decimales |
| `metricas.detalle.ver_el_resto_despliega_sin_llamar` | «Ver el resto» con `aria-expanded` despliega el detalle y la tabla de mediciones sin llamar |
| `metricas.ver_numeros.solo_para_lo_que_no_sabemos_y_no_promete_actualizar` | «Ver números» solo con `puede_pedir`; la fallida no lleva botón; nunca «Actualizar los números» |
| `metricas.ver_numeros.escribe_en_las_dos_listas_y_el_boton_no_vuelve` | una llamada escribe los números en «Recientes» y en «Las más vistas»; el botón no vuelve; se anuncia «TikTok: 77 vistas.» |
| `metricas.ver_numeros.no_se_pulsa_dos_veces_aunque_se_repinte` | «Preguntando…» vive en el estado: desplegar otra tarjeta o cambiar de vista no lo revive, y sale una sola llamada |
| `metricas.ver_numeros.un_fallo_de_verdad_se_puede_reintentar` | un 429 avisa y el botón vuelve |
| `metricas.vistas.cambiar_de_vista_no_llama_y_numera_el_top` | Recientes / Las más vistas con `aria-pressed`, sin ámbar y sin llamar; el top numerado y sin «Ver más» |
| `metricas.tramo.ver_mas_manda_el_tramo_pegado_al_cursor` | con cursor manda `desde`+`hasta`+`cursor`; sin cursor, solo `desde`, y dice «Ver 30 días más atrás» |
| `metricas.tramo.ver_mas_se_apaga_en_el_ultimo_tramo_y_dice_el_tope` | con `ultimo_tramo`, no hay «Ver más» y dice «Métricas llega hasta un año atrás.» |
| `metricas.tramo.la_misma_publicacion_en_dos_tramos_no_se_duplica` | la repetida actualiza en su sitio y no pisa unos números ya pedidos |
| `metricas.fallos.un_fallo_blando_no_borra_lo_pintado_ni_el_cursor` | 200 con `error`: lo pintado y el cursor se quedan |
| `metricas.fallos.un_fallo_duro_tampoco_y_nunca_en_ingles` | sin red: lo mismo, con «No pudimos hablar con el servidor» |
| `metricas.fallos.sin_nada_pintado_dice_que_no_pudo` | sin nada pintado, «No pudimos traer tus publicaciones»; Reintentar recarga |
| `metricas.fallos.solo_el_409_o_reconectar_ofrecen_conectar` | 409 o `reconectar` ofrecen «Conectar Blotato» |
| `metricas.fallos.si_falla_una_llamada_la_otra_vista_conserva_lo_suyo` | si fallan los números, «Las más vistas» conserva lo suyo; si falla la lista, «Recientes» también |
| `metricas.tramo.las_mas_vistas_llevan_su_propio_tramo` | el rótulo de fechas va por vista: los números de un tramo anterior no llevan la fecha del nuevo |
| `metricas.nota.el_recorte_no_es_un_error_y_lo_escribe_el_servidor` | el `aviso` del recorte va en gris y sin `role=alert`; el texto es del server |
| `metricas.tarjeta.fallida_dice_no_salio_con_el_error_de_la_red_como_texto` | «No salió», el `error_red` y el motivo, todo como texto |
| `metricas.tarjeta.el_enlace_solo_https_y_sin_regalar_la_pestana` | «Ver la publicación» solo con `https://`, en otra pestaña y con `noopener noreferrer`, también en «Las más vistas». El server ya filtra, y la pantalla filtra otra vez |
| `metricas.tarjeta.adjuntos_y_motivo_del_servidor` | «2 archivos» y el motivo que redacta el server |
| `metricas.carga.una_carga_a_la_vez` | mientras carga, todo lo que carga se apaga y no sale una segunda llamada |
| `metricas.cobro.no_cobra_ni_pinta_ambar` | ningún ✦ ni botón ámbar |
| `metricas.marco.enlace_estudio_sin_version_anterior` | «← Estudio», sin «Usar la versión anterior» (se quitó el 28-sep; `/ui/clasica` sigue a mano) |

## Cada aserción vieja y su destino

Al pasar a `retirada` se borran (o se recortan) estos tests junto con
`static/metricas.html`. `test_m23_metricas_api.py` y
`test_m23_metricas_blotato.py` prueban el server y **se quedan**.

### tests/test_m23_metricas_ui.py

| Test viejo | Destino |
|---|---|
| `test_existe_esc_y_escapa_los_cinco_caracteres`, `test_esc_escapa_los_cinco_en_node`, `test_ningun_innerhtml_interpola_datos_sin_escapar`, `test_el_error_que_redacta_la_red_va_escapado` | React escapa; `metricas.tarjeta.fallida_dice_no_salio_con_el_error_de_la_red_como_texto` |
| `test_la_pantalla_no_carga_nada_del_cdn_de_blotato` | la tarjeta no pinta ninguna `<img>` (mismo test) |
| `test_el_enlace_a_la_publicacion_no_le_regala_la_pestaña_a_nadie` | `metricas.tarjeta.el_enlace_solo_https_y_sin_regalar_la_pestana` |
| `test_auth_js_va_antes_del_script_inline` | `test_migracion_ui.py::test_la_pantalla_nueva_tiene_su_pagina` |
| `test_todo_el_arranque_va_dentro_de_domcontentloaded`, `test_la_pantalla_no_hace_poll` | `metricas.carga.una_llamada_al_abrir_y_ningun_sondeo` |
| `test_el_boton_no_promete_actualizar_los_numeros` | `metricas.ver_numeros.solo_para_lo_que_no_sabemos_y_no_promete_actualizar` |
| `test_el_hub_enlaza_metricas_y_ya_no_dice_proximamente` | se queda mientras viva `static/index.html`; en la nueva, `Inicio.test.tsx` |
| `test_un_contador_que_no_llego_es_un_hueco_y_no_un_cero`, `test_las_casillas_vacias_no_se_pintan` | `metricas.numeros.un_contador_que_no_llego_es_un_hueco_y_no_un_cero` |
| `test_una_bajada_se_enseña_como_bajada` | `metricas.numeros.una_bajada_se_ensena_como_bajada` |
| `test_los_milisegundos_no_se_enseñan_como_numero` | `metricas.numeros.los_milisegundos_no_se_ensenan_como_numero` |
| `test_ver_mas_manda_el_tramo_pegado_al_cursor` | `metricas.tramo.ver_mas_manda_el_tramo_pegado_al_cursor` |
| `test_ver_mas_se_apaga_en_el_ultimo_tramo` | `metricas.tramo.ver_mas_se_apaga_en_el_ultimo_tramo_y_dice_el_tope` |
| `test_la_misma_publicacion_en_dos_tramos_no_se_duplica`, `test_ver_mas_no_borra_unos_numeros_que_ya_se_pagaron` | `metricas.tramo.la_misma_publicacion_en_dos_tramos_no_se_duplica` |
| `test_un_fallo_no_borra_lo_ya_pintado_ni_pisa_el_cursor` | `metricas.fallos.un_fallo_blando_no_borra_lo_pintado_ni_el_cursor` |
| `test_cambiar_de_vista_no_gasta_una_llamada` | `metricas.vistas.cambiar_de_vista_no_llama_y_numera_el_top` |
| `test_una_carga_pedida_mientras_hay_otra_se_encola` | `metricas.carga.una_carga_a_la_vez`. La cola existe igual que en la agenda, pero en esta pantalla nada puede pedir una segunda carga con otra en vuelo: todo lo que carga está apagado |
| `test_pedir_numeros_escribe_en_las_dos_listas_y_apaga_el_boton` | `metricas.ver_numeros.escribe_en_las_dos_listas_y_el_boton_no_vuelve` |
| `test_ver_numeros_no_se_puede_pulsar_dos_veces_aunque_se_repinte` | `metricas.ver_numeros.no_se_pulsa_dos_veces_aunque_se_repinte` |
| `test_la_pantalla_no_redacta_los_mensajes_del_servidor`, `test_la_pantalla_no_escribe_el_tope_de_blotato` | los motivos y el aviso los pinta tal cual (`metricas.tarjeta.adjuntos_y_motivo_del_servidor`, `metricas.nota.el_recorte_no_es_un_error_y_lo_escribe_el_servidor`); el «100» no está en `web/` |
| `test_un_fallo_duro_tampoco_borra_lo_ya_pintado_ni_el_cursor` | `metricas.fallos.un_fallo_duro_tampoco_y_nunca_en_ingles` |
| `test_un_fallo_de_la_lista_no_vacia_las_mas_vistas` | `metricas.fallos.si_falla_una_llamada_la_otra_vista_conserva_lo_suyo` |
| `test_las_mas_vistas_llevan_su_propio_tramo` | `metricas.tramo.las_mas_vistas_llevan_su_propio_tramo` |
| `test_el_aviso_del_recorte_no_es_un_error_y_lo_escribe_el_servidor` | `metricas.nota.el_recorte_no_es_un_error_y_lo_escribe_el_servidor` |

### tests/test_ui14_metricas.py (la carta de diseño en la vieja)

| Test viejo | Destino |
|---|---|
| `test_carga_la_carta_y_los_iconos`, `test_titulos_en_bricolage_y_texto_en_geist`, `test_sin_tamanos_de_letra_fuera_de_la_escala`, `test_enlaces_en_azul_claro_y_sin_el_azul_de_datos`, `test_tarjetas_de_la_carta`, `test_sin_sepia` | `tokens.css`, `<Marco>` y los guardianes sobre `web/` |
| `test_los_numeros_van_en_tabular_nums` | `tabular-nums` en las casillas, la línea del cambio, el detalle y la tabla |
| `test_sin_emojis_como_iconos`, `test_los_iconos_que_usa_existen`, `test_los_iconos_de_la_lista_se_pintan_tras_el_innerhtml` | `<Icono>` y TypeScript (`NombreIcono`) |
| `test_botones_con_los_niveles_de_la_carta`, `test_ningun_boton_ambar` | `metricas.cobro.no_cobra_ni_pinta_ambar` |
| `test_elegir_no_es_ambar` | `metricas.vistas.cambiar_de_vista_no_llama_y_numera_el_top` |
| `test_lo_que_se_toca_mide_44` | `<Marco>` y el enlace de la tarjeta (`min-h-11`) |
| `test_deja_libre_la_franja_de_la_pildora` | `<Marco>` (`pt-16`) |

### tests/test_ui16_metricas.py (el cuadro de avisos de trabajos.js)

| Test viejo | Destino |
|---|---|
| `test_la_caja_de_error_ya_no_existe`, `test_el_aviso_de_pagina_va_al_cuadro_con_su_clave`, `test_siempre_con_encadenamiento_opcional` | sin destino: la nueva no carga `trabajos.js` y los avisos van en la pantalla (`<Aviso>`) |
| `test_la_carga_ofrece_reintentar` | `metricas.fallos.sin_nada_pintado_dice_que_no_pudo` |
| `test_el_anuncio_por_tarjeta_y_la_nota_se_quedan` | `metricas.ver_numeros.escribe_en_las_dos_listas_y_el_boton_no_vuelve` (región `role=status`, `aria-live=polite`) y `metricas.nota.el_recorte_no_es_un_error_y_lo_escribe_el_servidor` |

### Otros módulos que miran métricas

| Aserción vieja | Destino |
|---|---|
| `test_ui_escapar.py::test_se_encontraron_las_esc` | al retirar, `static/metricas.html` sale de la lista |
| `test_ui14_todas.py`, `test_ui15_trabajos.py` (PANTALLAS) | al retirar, `metricas` sale de las listas |
| `test_m25_entrada.py`, `Inicio.test.tsx` (el menú enlaza `/metricas.html`) | se quedan: el 302 hace el resto |

## Diferencias a propósito

- **El enlace se filtra dos veces:** el server manda solo `https://`
  (`vista_publicada` y `vista_analitica`) y la pantalla vuelve a exigirlo. En
  la vieja, `esc()` no filtraba esquemas y la defensa era solo del server.
- **Las fechas van en español** (`es-MX`) y en la zona del navegador.
- **La tabla de mediciones** rueda sola en el teléfono y se puede rodar con
  el teclado (región con nombre y `tabIndex`).
- **La tarjeta fallida** se marca con el borde rojo de la carta
  (`peligro-borde`), no con un `#8f4a4a` suelto.
- **Sin `trabajos.js`:** los avisos van en la pantalla.
