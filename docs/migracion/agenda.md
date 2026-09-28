# Migración de la agenda (UI·8.6)

`static/agenda.html` → `/estudio/agenda/` (`web/src/pantallas/agenda/`).

**No cobra nada.** Lista lo que Blotato todavía no ha publicado y deja hacer
dos cosas: cambiar la hora y cancelar. Lo que cuida es otra cosa:

- **El cupo de Blotato:** 60 llamadas por minuto por usuario, que comparte con
  el modal de Publicar. Por eso hace una sola carga al abrir, no sondea y
  nunca manda dos cargas a la vez.
- **Lo irreversible:** cancelar pide confirmación.

## Etapas

| Etapa | Qué pasa | Cómo se pasa | Estado |
|---|---|---|---|
| `nueva` | `/estudio/agenda/` existe; `/agenda.html` sigue igual | este PR | ⏳ al desplegar |
| `todos` | `/agenda.html` → 302 a `/estudio/agenda/`, salvo la cookie `ui=clasica` | `etapa="todos"` + deploy | pendiente |
| `retirada` | 302 siempre; se borran `static/agenda.html` y sus tests viejos | `etapa="retirada"`, `git rm` + deploy | pendiente |

Antes de `todos`, el dueño hace el QA de `docs/QA-UI.md` § agenda. Necesita
una publicación programada de prueba. Cambiarle la hora y cancelarla no cuesta
créditos, pero cancelar no se deshace.

## Los invariantes (tests/test_migracion_ui.py)

Cada ID es un test de vitest con ese nombre exacto, en
`web/src/pantallas/agenda/Agenda.test.tsx`.

| ID | Qué garantiza |
|---|---|
| `agenda.carga.una_sola_llamada_al_abrir_y_ningun_sondeo` | una llamada a `/api/agenda` al abrir, aunque StrictMode monte dos veces, y ninguna más con el paso del tiempo |
| `agenda.lista.resumen_con_el_total_del_servidor` | «12 publicaciones programadas» con el `total` del server; sin `total`, no inventa un número |
| `agenda.lista.ver_mas_agrega_al_final_con_el_cursor` | «Ver más» añade al final (no repinta) con `?cursor=`, y se va sin cursor |
| `agenda.lista.ultima_pagina_vacia_apaga_ver_mas` | una última página vacía y sin cursor apaga «Ver más» y conserva lo pintado |
| `agenda.lista.fallo_blando_conserva_tarjetas_total_y_cursor` | 200 con `error` (o un 429 en «Ver más»): las tarjetas, el total y el cursor se quedan |
| `agenda.lista.fallo_sin_nada_pintado_dice_que_no_pudo_no_que_no_hay` | un fallo con la lista vacía dice «No pudimos traer tu agenda», nunca «No tienes nada programado» |
| `agenda.lista.vacia_dice_como_programar` | la lista vacía explica cómo programar desde el editor |
| `agenda.lista.recarga_pedida_durante_otra_se_encola` | cancelar dos seguidas: la segunda recarga espera su turno en vez de salir en paralelo o perderse |
| `agenda.lista.botones_apagados_mientras_recarga` | Actualizar, Ver más y los botones de cada tarjeta se apagan mientras recarga |
| `agenda.lista.textos_de_blotato_como_texto` | red, cuenta, destino y texto con HTML se leen como texto; ninguna `<img>` ni URL del CDN de Blotato |
| `agenda.tarjeta.destino_en_la_tarjeta_el_dialogo_y_la_confirmacion` | «red · cuenta · destino» en los tres sitios; sin destino no queda un « · » colgando |
| `agenda.tarjeta.puntos_suspensivos_los_decide_cortado` | el «…» solo con `cortado`; «Sin texto» si no trae |
| `agenda.tarjeta.adjuntos_se_llaman_archivos_y_cero_no_se_pinta` | «1 archivo» / «3 archivos», 0 no se pinta y nunca dice «video» |
| `agenda.errores.solo_el_409_ofrece_conectar_blotato` | con 409, el aviso ofrece «Conectar Blotato» (`/estudio/?blotato=conectar`); con 502, Reintentar |
| `agenda.errores.clave_rechazada_al_listar_ofrece_conectar` | un 200 con `reconectar: true` también ofrece conectar |
| `agenda.errores.sin_red_en_espanol_y_reintentar_recarga` | sin red, «No pudimos hablar con el servidor» (nunca «Failed to fetch»); Reintentar recarga y quita el aviso |
| `agenda.hora.solo_manda_id_y_cuando_en_utc` | reprogramar manda **solo** `{id, cuando}`, sin `draft`, con la hora en UTC terminada en Z |
| `agenda.hora.fecha_vacia_o_pasada_no_llama_y_no_apaga_guardar` | una fecha vacía o pasada se marca junto al campo, con cero llamadas y Guardar vivo |
| `agenda.hora.menos_de_un_minuto_no_llama` | el margen de 60 s del server (`_cuando`) se valida antes; una fecha ilegible, también |
| `agenda.hora.el_minimo_del_campo_lleva_el_margen` | el `min` del campo es ahora + 60 s; el valor inicial es la hora programada, en tu hora; el foco cae en el campo |
| `agenda.hora.el_404_cierra_repinta_y_avisa_con_el_texto_del_servidor` | 404 al reprogramar: cierra, recarga y después avisa con el texto del server |
| `agenda.hora.otro_fallo_se_queda_en_el_dialogo` | cualquier otro fallo se enseña dentro del diálogo, con Guardar vivo |
| `agenda.hora.cerrar_mientras_guarda_el_fallo_va_a_la_pantalla` | si se cierra el diálogo mientras viaja, el fallo va al aviso de la pantalla |
| `agenda.hora.una_respuesta_tardia_no_cierra_el_dialogo_de_otra` | una respuesta tardía no cierra el diálogo de otra publicación ni pisa lo escrito |
| `agenda.hora.el_doble_clic_no_cierra_el_dialogo_recien_abierto` | los primeros 300 ms el velo no cierra (el segundo clic de un doble clic); después, sí |
| `agenda.hora.el_exito_se_anuncia_y_el_foco_no_cae_al_body` | «Hora cambiada: <red> sale el … (tu hora).» con `role=status`; el foco no cae al `<body>` |
| `agenda.cancelar.la_confirmacion_arranca_en_no_y_decir_no_no_llama` | la confirmación nombra red, cuenta, cuándo y el texto; arranca en «No, dejarla»; decir que no no llama ni apaga el botón |
| `agenda.cancelar.manda_confirmar_true_anuncia_y_devuelve_el_foco` | manda `{id, confirmar: true}`; la tarjeta queda apagada mientras viaja; al terminar, «Publicación cancelada.» y el foco en Actualizar |
| `agenda.cancelar.el_404_recarga_y_despues_avisa` | 404 al cancelar: primero repinta y después avisa (el aviso sobrevive a la recarga) |
| `agenda.cancelar.el_409_ofrece_conectar` | un 409 al cancelar ofrece conectar |
| `agenda.cobro.no_cobra_ni_pinta_ambar_fuera_del_dialogo` | ningún ✦ ni botón ámbar en la lista; el único principal es Guardar, dentro del diálogo |
| `agenda.marco.enlace_estudio_sin_version_anterior` | «← Estudio», sin «Usar la versión anterior» (se quitó el 28-sep; `/ui/clasica` sigue a mano) |

## Cada aserción vieja y su destino

Al pasar a `retirada` se borran (o se recortan) estos tests junto con
`static/agenda.html`. `test_m23_agenda_api.py`, `test_m23_agenda_blotato.py`
y `test_m23_agenda_registro.py` prueban el server y **se quedan**.

### tests/test_m23_agenda_ui.py

| Test viejo | Destino |
|---|---|
| `test_existe_esc_y_escapa_los_cinco_caracteres`, `test_esc_escapa_los_cinco_en_node`, `test_ningun_innerhtml_interpola_datos_sin_escapar`, `test_lo_que_llega_de_blotato_va_escapado_en_node` | React escapa; `agenda.lista.textos_de_blotato_como_texto` |
| `test_la_pantalla_no_carga_nada_del_cdn_de_blotato` | `agenda.lista.textos_de_blotato_como_texto` |
| `test_auth_js_va_antes_del_script_inline` | `test_migracion_ui.py::test_la_pantalla_nueva_tiene_su_pagina` |
| `test_todo_el_arranque_va_dentro_de_domcontentloaded` | el módulo corre después de `auth.js`; `agenda.carga.una_sola_llamada_al_abrir_y_ningun_sondeo` |
| `test_el_dialogo_lleva_margin_auto` | `ui/Dialogo.tsx` (centrado y velo) |
| `test_la_agenda_no_hace_poll` | `agenda.carga.una_sola_llamada_al_abrir_y_ningun_sondeo` |
| `test_cambiar_la_hora_nunca_manda_draft` | `agenda.hora.solo_manda_id_y_cuando_en_utc` |
| `test_cancelar_manda_el_confirmar_del_gate` | `agenda.cancelar.manda_confirmar_true_anuncia_y_devuelve_el_foco` |
| `test_la_pantalla_no_copia_los_mensajes_del_servidor` | `agenda.hora.el_404_cierra_repinta_y_avisa_con_el_texto_del_servidor` y `agenda.cancelar.el_404_recarga_y_despues_avisa` (el texto es el del server) |
| `test_el_409_es_lo_unico_que_ofrece_conectar_blotato`, `test_el_409_ofrece_conectar_blotato` | `agenda.errores.solo_el_409_ofrece_conectar_blotato`, `agenda.errores.clave_rechazada_al_listar_ofrece_conectar` y `agenda.cancelar.el_409_ofrece_conectar` |
| `test_la_validacion_de_fecha_no_gasta_una_llamada` | `agenda.hora.fecha_vacia_o_pasada_no_llama_y_no_apaga_guardar` y `agenda.hora.menos_de_un_minuto_no_llama` |
| `test_el_boton_de_cancelar_se_apaga_despues_del_confirm` | `agenda.cancelar.la_confirmacion_arranca_en_no_y_decir_no_no_llama` y `agenda.cancelar.manda_confirmar_true_anuncia_y_devuelve_el_foco` |
| `test_ver_mas_concatena_y_no_repinta` | `agenda.lista.ver_mas_agrega_al_final_con_el_cursor` y `agenda.lista.resumen_con_el_total_del_servidor` |
| `test_el_404_al_reprogramar_cierra_el_dialogo_y_repinta` | `agenda.hora.el_404_cierra_repinta_y_avisa_con_el_texto_del_servidor` y `agenda.hora.solo_manda_id_y_cuando_en_utc` |
| `test_el_404_al_cancelar_recarga_y_luego_avisa` | `agenda.cancelar.el_404_recarga_y_despues_avisa` |
| `test_el_fallo_blando_no_borra_lo_ya_pintado`, `test_ver_mas_que_falla_conserva_las_tarjetas_y_el_cursor` | `agenda.lista.fallo_blando_conserva_tarjetas_total_y_cursor` |
| `test_el_fallo_blando_con_la_lista_vacia_pinta_la_caida_no_el_vacio` | `agenda.lista.fallo_sin_nada_pintado_dice_que_no_pudo_no_que_no_hay` |
| `test_la_ultima_pagina_vacia_sin_error_apaga_ver_mas` | `agenda.lista.ultima_pagina_vacia_apaga_ver_mas` |
| `test_una_recarga_pedida_mientras_carga_se_encola` | `agenda.lista.recarga_pedida_durante_otra_se_encola` |
| `test_los_botones_se_apagan_mientras_recarga` | `agenda.lista.botones_apagados_mientras_recarga` |
| `test_la_pantalla_no_acepta_una_hora_que_el_servidor_rechaza` | `agenda.hora.menos_de_un_minuto_no_llama` (`MARGEN_S` = 60, el de `_cuando`) |
| `test_el_minimo_del_campo_tambien_lleva_el_margen` | `agenda.hora.el_minimo_del_campo_lleva_el_margen` |
| `test_cerrar_el_dialogo_mientras_guarda_enseña_el_fallo_en_la_pantalla` | `agenda.hora.cerrar_mientras_guarda_el_fallo_va_a_la_pantalla` |
| `test_una_respuesta_tardia_no_cierra_el_dialogo_de_otra_publicacion` | `agenda.hora.una_respuesta_tardia_no_cierra_el_dialogo_de_otra` |
| `test_el_fondo_no_cierra_el_dialogo_recien_abierto` | `agenda.hora.el_doble_clic_no_cierra_el_dialogo_recien_abierto` (la gracia vive ahora en `ui/Dialogo.tsx`, para todos los diálogos) |
| `test_cancelar_anuncia_el_resultado_y_devuelve_el_foco` | `agenda.cancelar.manda_confirmar_true_anuncia_y_devuelve_el_foco` |
| `test_cambiar_la_hora_anuncia_el_resultado_y_devuelve_el_foco` | `agenda.hora.el_exito_se_anuncia_y_el_foco_no_cae_al_body` |
| `test_la_region_viva_existe_en_el_html` | `<Aviso>` lleva `role=status`/`alert` |
| `test_sin_conexion_el_mensaje_esta_en_espanol` | `agenda.errores.sin_red_en_espanol_y_reintentar_recarga` |
| `test_el_destino_se_ve_en_la_tarjeta_el_confirm_y_el_dialogo` | `agenda.tarjeta.destino_en_la_tarjeta_el_dialogo_y_la_confirmacion` |
| `test_los_puntos_suspensivos_los_decide_cortado` | `agenda.tarjeta.puntos_suspensivos_los_decide_cortado` |
| `test_los_adjuntos_no_se_llaman_videos` | `agenda.tarjeta.adjuntos_se_llaman_archivos_y_cero_no_se_pinta` |
| `test_b3etiqueta_cancelado_en_node`, `test_la_pildora_aviso_existe_en_el_editor` | se quedan: son del editor, no de la agenda |
| `test_el_hub_enlaza_la_agenda` | se queda mientras viva `static/index.html`; en la nueva, `Inicio.test.tsx` |

### tests/test_ui14_agenda.py (la carta de diseño en la vieja)

| Test viejo | Destino |
|---|---|
| `test_carga_la_carta_y_los_iconos`, `test_los_tokens_locales_salen_de_la_carta`, `test_titulos_en_bricolage_y_texto_en_geist`, `test_sin_tamanos_de_letra_fuera_de_la_escala`, `test_sin_filtro_sepia`, `test_enlaces_en_azul_claro`, `test_campos_y_tarjetas_de_la_carta` | `tokens.css`, `<Marco>`, `<Campo>` y los guardianes sobre `web/` |
| `test_sin_emojis_como_iconos`, `test_los_iconos_que_usa_la_agenda_existen`, `test_la_lista_pinta_los_iconos_que_escribe` | `<Icono>` y TypeScript (`NombreIcono`) |
| `test_la_x_de_cerrar_es_un_icono_con_nombre` | `ui/Dialogo.tsx` (`aria-label="Cerrar"`, 44 px) |
| `test_botones_con_los_niveles_de_la_carta` | Cambiar la hora = `secundario`, Cancelar = `peligro` |
| `test_un_solo_principal_por_vista` | `agenda.cobro.no_cobra_ni_pinta_ambar_fuera_del_dialogo` |
| `test_lo_que_se_toca_mide_44` | `<Marco>` y `<Campo>` (`min-h-11`) |
| `test_el_contenido_empieza_bajo_la_pildora` | `<Marco>` (`pt-16`) |
| `test_ver_mas_se_sigue_escondiendo` | en React, «Ver más» sin cursor no se pinta (`agenda.lista.ver_mas_agrega_al_final_con_el_cursor`) |

### tests/test_ui16_agenda.py (el cuadro de avisos de trabajos.js)

| Test viejo | Destino |
|---|---|
| `test_la_caja_de_error_y_la_linea_de_estado_ya_no_existen`, `test_el_aviso_de_pagina_va_al_cuadro_con_su_clave`, `test_el_comentario_dice_quien_lleva_el_role`, `test_siempre_con_encadenamiento_opcional` | sin destino: la nueva no carga `trabajos.js` y los avisos van en la pantalla (`<Aviso>`), como en clip, estilos, competencia, subir y shorts |
| `test_la_carga_ofrece_reintentar_y_limpia_al_empezar`, `test_en_node_reintentar_recarga_y_el_aviso_se_quita_al_recuperarse` | `agenda.errores.sin_red_en_espanol_y_reintentar_recarga` |
| `test_las_confirmaciones_van_como_ok` | `agenda.hora.el_exito_se_anuncia_y_el_foco_no_cae_al_body` y `agenda.cancelar.manda_confirmar_true_anuncia_y_devuelve_el_foco` |
| `test_confirm_y_el_error_del_dialogo_siguen_en_su_sitio` | `<Confirmar>` en vez de `confirm()`; `agenda.hora.otro_fallo_se_queda_en_el_dialogo` |

### Otros módulos que miran la agenda

| Aserción vieja | Destino |
|---|---|
| `test_ui_escapar.py::test_se_encontraron_las_esc` | al retirar, `static/agenda.html` sale de la lista |
| `test_ui14_todas.py`, `test_ui15_trabajos.py` (PANTALLAS) | al retirar, `agenda` sale de las listas |
| `test_m20_paleta.py` (`rgba(4,9,17,0.72)`) | lo usa también `ui/Dialogo.tsx` (`VELO`) |
| `test_m25_entrada.py`, `Inicio.test.tsx` (el menú enlaza `/agenda.html`) | se quedan: el 302 hace el resto |

## Diferencias a propósito

- **`<Confirmar>` en vez de `confirm()`.** El foco arranca en «No, dejarla».
  Los botones dicen «Sí, cancelarla» / «No, dejarla»: con `confirm()` la
  pregunta era «¿Cancelar?» con un botón «Cancelar» que significaba «no».
- **El pie del diálogo dice «Volver»**, no «Cerrar». La equis ya se llama
  «Cerrar», y dos botones con el mismo nombre confunden al lector de pantalla.
- **La gracia del doble clic** vive en `ui/Dialogo.tsx` y cubre todos los
  diálogos, no solo este.
- **Los errores de fecha van junto al campo** (`aria-invalid`); los del
  server, en un aviso dentro del diálogo.
- **Las fechas van en español** (`es-MX`) y en la zona del navegador. La
  vieja usaba también el idioma del navegador: uno en inglés leía «sale el
  May 1, 2099» a media frase.
- **Tras cambiar la hora,** si la tarjeta sigue ahí, el foco vuelve a su
  botón; solo cae en Actualizar si la tarjeta desapareció.
- **Sin `trabajos.js`:** los avisos van en la pantalla.
