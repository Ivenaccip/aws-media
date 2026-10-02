# Migración de imágenes (UI·8.7)

`static/imagenes.html` → `/estudio/imagenes/` (`web/src/pantallas/imagenes/`).

Una sola herramienta para tres cosas. El estado decide cuál:

| Sobre la mesa | Qué hace el botón | Endpoint |
|---|---|---|
| sin imagen | «Generar ✦ N»: crea una imagen | `POST /api/imagenes` (JSON) |
| imagen + «Cambiar una zona» | «Cambiar ✦ N»: cambia la zona pintada | `POST /api/imagenes/editar` (`modo=pincel`, `imagen`, `marcada`) |
| imagen + «Transformar toda la imagen» | «Transformar ✦ N»: la imagen entera | `POST /api/imagenes/editar` (`modo=todo`, `imagen`, y `estilo` solo si se eligió uno) |

Los tres cobran lo mismo: `video.imagen` de `tools/tarifas.json` (hoy 2),
que es la tarifa que usa el server en `creditos.costo_imagen()`. Si la
generación falla, el server devuelve los créditos.

Antes de cobrar, el texto pasa por el guardarraíl (`/api/moderar`,
`nucleo/moderar.ts`). Si no pasa, no sale ninguna petición que cobre.

Las versiones no se sobrescriben: cada envío crea un nombre nuevo
(`<12 hex>.jpg`). Después de editar, la imagen de trabajo sigue siendo la
original: enviar otra vez da otra versión, no pisa la anterior.

## Etapas

| Etapa | Qué pasa | Cómo se pasa | Estado |
|---|---|---|---|
| `nueva` | `/estudio/imagenes/` existe; `/imagenes.html` sigue igual | este PR | ✅ 28-sep |
| `todos` | `/imagenes.html?…` → 302 a `/estudio/imagenes/?…` (conserva `img`, `editar` y `prompt`), salvo la cookie `ui=clasica` | `etapa="todos"` + deploy | ⏳ al desplegar |
| `retirada` | 302 siempre; se borran `static/imagenes.html` y sus tests viejos | `etapa="retirada"`, `git rm` + deploy | pendiente |

Antes de `todos`, el dueño hace una corrida de verdad en `/estudio/imagenes/`
y el QA manual de `docs/QA-UI.md` § imágenes. Son tres envíos: crear,
cambiar una zona y transformar. Cada uno cuesta `video.imagen` = 2 créditos
(6 en total) 💳, y la corrida necesita su «sí» al gasto.

Los enlaces que llevan a `/imagenes.html` no se tocan: el inicio (el menú,
la caja con `?prompt=` y «Mis imágenes» con `?img=`) y los 302 viejos de
`/crear-imagenes.html` y `/editor-imagenes.html`. En `todos` los lleva el 302.

## Los invariantes (tests/test_migracion_ui.py)

Cada uno es un test de vitest en `web/src/pantallas/imagenes/Imagenes.test.tsx`
con ese nombre exacto.

| ID | Qué garantiza |
|---|---|
| `imagenes.cobro.precio_de_tarifas_json_y_verbo_segun_el_modo` | «Generar / Cambiar / Transformar ✦ N» con `video.imagen` de `tarifas.json` |
| `imagenes.cobro.crear_manda_texto_estilo_y_formato` | crear manda `{prompt, estilo, estilo_custom, formato}` |
| `imagenes.cobro.doble_clic_un_solo_envio` | doble clic = 1 POST; que monedero.js refresque el saldo a media petición no revive el botón |
| `imagenes.cobro.el_guardarrail_corta_antes_de_cobrar` | si el texto no pasa: «Revisa tu texto» con el mensaje y el motivo como TEXTO, cero cobros, y el foco vuelve a la caja |
| `imagenes.cobro.con_el_guardarrail_caido_se_sigue` | si `/api/moderar` falla, se deja pasar (los filtros de los proveedores siguen detrás) |
| `imagenes.cobro.el_pedido_se_arma_antes_de_moderar` | lo que se toque durante la revisión (texto, estilo, formato) no cambia lo que se cobra |
| `imagenes.cobro.lo_que_se_dice_antes_no_se_cobra` | el texto vacío, un atajo a medio escribir (`/xyz`) y «edítala» sin imagen se dicen sin llamar a nadie; «edítala» nunca crea una imagen nueva |
| `imagenes.cobro.el_pincel_sin_zona_no_cobra` | el modo no se deduce del trazo: el pincel sin zona pintada lo pide y no cobra |
| `imagenes.cobro.el_pincel_manda_la_imagen_y_la_zona_sin_estilo` | pincel: `prompt`, `modo=pincel`, `imagen` y `marcada`; nunca un estilo |
| `imagenes.cobro.transformar_solo_manda_el_estilo_que_se_eligio` | el destino empieza vacío (el «Animado» de crear no viaja); con uno elegido viaja; tocarlo otra vez lo suelta; transformar no manda zona |
| `imagenes.cobro.sin_saldo_dice_a_quien_escribir` | un 402 enseña su detalle y el texto de `monedero.cta`, sin un «Recargar» muerto |
| `imagenes.cobro.saldo_conocido_que_no_alcanza_no_cobra` | si la píldora sabe que no alcanza, el botón se apaga y dice cuánto falta |
| `imagenes.cobro.refresca_el_saldo_tras_cobrar` | refresca la píldora al terminar |
| `imagenes.cobro.en_vuelo_nada_cambia_la_imagen_ni_el_modo` | con la petición en vuelo: modos, Quitar, Nueva imagen, Borrar zona y el grosor apagados; soltar o pegar otra imagen no hace nada |
| `imagenes.cobro.mientras_abre_una_imagen_no_se_envia` | mientras la imagen se decodifica, «Abriendo tu imagen…» y el botón apagado |
| `imagenes.cobro.una_respuesta_sin_imagen_valida_no_se_pinta` | **nuevo:** `nombre` y `url` del server se revisan antes de usarlos en un `src`, un `href` o un `fetch` |
| `imagenes.cobro.un_solo_principal_por_vista` | el único ámbar es el botón que cobra, en las dos vistas |
| `imagenes.espera.revisando_y_luego_trabajando_y_nunca_junto_al_error` | «Revisando tu texto…», luego «Creando tu imagen · ~20 s»; con un error, el orbe ya no está |
| `imagenes.resultado.lo_creado_pasa_a_editarse` | lo recién creado se abre para editarlo, pedido a `/api/imagenes/<n>/archivo` (nunca al CDN: ensuciaría el canvas); la caja queda vacía; Descargar por `/archivo`; «Nueva imagen» vuelve con el texto de la creada |
| `imagenes.resultado.quitar_no_tira_el_resultado_pagado` | «Quitar imagen» suelta la de trabajo, no el resultado; «Enviar otra vez vuelve a aplicar el cambio sobre tu imagen.» |
| `imagenes.resultado.seguir_editando_no_pinta_una_version_vieja` | si mientras baja «Seguir editando» cambia lo que hay en pantalla, lo que llega no se pinta |
| `imagenes.formato.con_imagen_lo_pone_ella_y_al_quitarla_vuelve_el_elegido` | el formato de una imagen se lee (umbral 1.15); al quitarla vuelve el que eligió el usuario, y ese viaja |
| `imagenes.vista.pedir_editar_en_el_texto_abre_el_editor` | «edita mi foto», «retoca», «mis bocetos»… abren el editor cuando deja de escribir (700 ms), no a media palabra; «No, quiero crear una imagen nueva» vuelve |
| `imagenes.paleta.atajos_sin_llm_y_el_comando_no_viaja` | «/ver» + Enter = formato vertical, «/acu» = estilo; el comando no viaja al modelo; «24/7» no abre la paleta |
| `imagenes.paleta.nuevo_nunca_sale_marcado_y_las_flechas_se_anuncian` | «/nuevo» va al final y nunca sale marcado: un Enter con solo «/» no tira nada; flechas con `aria-activedescendant`; Escape la cierra; «N atajos…» se anuncia |
| `imagenes.enlace.solo_abre_una_imagen_con_nombre_valido` | `?img=` solo con `<12 hex>.jpg`; lo demás no sale a la red |
| `imagenes.enlace.si_no_abre_avisa_fuera_del_formulario` | si `?img=` no abre, un aviso aparte (no el error del botón); al cargar otra, se quita |
| `imagenes.enlace.el_texto_del_inicio_llega_recortado` | `?prompt=` del inicio llega a la caja, recortado a 2000 |
| `imagenes.enlace.editar_abre_el_editor` | `?editar=1` abre el editor |
| `imagenes.estilos.si_no_llegan_se_avisa_y_se_sigue` | sin `/api/estilos`, un aviso y se sigue con el estilo de siempre |
| `imagenes.archivo.pegar_texto_gana_a_la_imagen` | pegar con texto (Excel, PowerPoint) pega el texto; sin texto, abre la imagen |
| `imagenes.archivo.tipo_y_tamano_antes_de_abrir` | solo JPG, PNG o WebP, hasta 15 MB, sin llegar a abrirla |
| `imagenes.teclado.ctrl_enter_envia` | Ctrl/Cmd+Enter envía |
| `imagenes.titulo.el_lector_oye_el_titulo_fijo` | la palabra que gira es decorativa: el lector oye «Crea tu imagen» / «Edita tu imagen» |
| `imagenes.textos.del_servidor_como_texto` | los nombres de estilo con HTML se leen como texto |
| `imagenes.marco.enlace_estudio_sin_version_anterior` | «← Estudio», sin «Usar la versión anterior» (se quitó el 28-sep; `/ui/clasica` sigue a mano) |

## Cada aserción vieja y su destino

Al pasar a `retirada` se borran (o se recortan) estos tests junto con
`static/imagenes.html`. Los que prueban el server se quedan:
`test_m15_editor_imagenes.py`, `test_m12_hub.py`,
`test_m23_modelo_imagen.py`, los de server de `test_m23_imagenes.py` y
`test_m22_editor_y_descargas.py`.

### tests/test_m23_imagenes.py (los de la página)

| Test viejo | Destino |
|---|---|
| `test_la_pagina_se_sirve` | `test_migracion_ui.py::test_la_pantalla_nueva_tiene_su_pagina` y el 302 de `migracion.py` |
| `test_ofrece_los_tres_formatos_y_los_manda` | `imagenes.cobro.crear_manda_texto_estilo_y_formato` |
| `test_con_imagen_el_formato_se_lee_y_no_se_elige`, `test_quitar_la_imagen_devuelve_el_formato_que_eligio_el_usuario` | `imagenes.formato.con_imagen_lo_pone_ella_y_al_quitarla_vuelve_el_elegido` |
| `test_los_dos_modos_viajan_y_el_estilo_solo_si_se_eligio`, `test_al_transformar_el_estilo_por_defecto_no_viaja`, `test_el_estilo_propio_de_crear_y_el_de_transformar_no_se_mezclan` | `imagenes.cobro.el_pincel_manda_la_imagen_y_la_zona_sin_estilo` y `imagenes.cobro.transformar_solo_manda_el_estilo_que_se_eligio` (el campo propio de crear y el de transformar son dos estados distintos) |
| `test_el_modo_no_se_deduce_del_trazo` | `imagenes.cobro.el_pincel_sin_zona_no_cobra` |
| `test_un_atajo_a_medio_escribir_no_se_cobra`, `test_pedir_editar_sin_imagen_nunca_crea_una` | `imagenes.cobro.lo_que_se_dice_antes_no_se_cobra` |
| `test_el_guardrail_corta_antes_de_cobrar` | `imagenes.cobro.el_guardarrail_corta_antes_de_cobrar` y `imagenes.cobro.el_pedido_se_arma_antes_de_moderar` |
| `test_monta_el_orbe_con_red`, `test_el_orbe_se_desmonta_antes_del_error`, `test_el_orbe_gira_donde_se_trabaja` | `<EsperaIA>` (sin `orbe.js` queda el texto); `imagenes.espera.revisando_y_luego_trabajando_y_nunca_junto_al_error`. Al crear gira bajo el botón; al editar, en la esquina de la imagen |
| `test_guarda_contra_el_doble_cobro` | `imagenes.cobro.doble_clic_un_solo_envio` (el candado de `<BotonCobro>`) |
| `test_en_vuelo_nada_cambia_la_imagen_ni_la_vista` | `imagenes.cobro.en_vuelo_nada_cambia_la_imagen_ni_el_modo` (ahora también mira el grosor) |
| `test_una_carga_a_medias_no_se_cuela_bajo_la_peticion` | `imagenes.cobro.mientras_abre_una_imagen_no_se_envia` |
| `test_quitar_no_tira_el_resultado_pagado` | `imagenes.resultado.quitar_no_tira_el_resultado_pagado` |
| `test_el_resultado_llega_despues_de_la_respuesta` | `imagenes.espera.revisando_y_luego_trabajando_y_nunca_junto_al_error` |
| `test_seguir_editando_pide_los_bytes_a_nuestro_origen` | `imagenes.resultado.lo_creado_pasa_a_editarse` |
| `test_seguir_editando_no_pinta_una_version_vieja` | `imagenes.resultado.seguir_editando_no_pinta_una_version_vieja` |
| `test_pegar_texto_de_office_pega_el_texto` | `imagenes.archivo.pegar_texto_gana_a_la_imagen` |
| `test_el_pincel_funciona_con_el_dedo` | `Lienzo.tsx`: la capa del pincel lleva `touch-none` |
| `test_nada_flota_encima_de_la_imagen` | `Imagenes.tsx`: la barra del pincel va arriba y las acciones abajo, en el flujo (solo el orbe flota, en una esquina) |
| `test_la_paleta_no_borra_por_accidente` | `imagenes.paleta.nuevo_nunca_sale_marcado_y_las_flechas_se_anuncian` y `imagenes.paleta.atajos_sin_llm_y_el_comando_no_viaja` |
| `test_la_paleta_se_anuncia` | `imagenes.paleta.nuevo_nunca_sale_marcado_y_las_flechas_se_anuncian` |
| `test_el_formato_bloqueado_se_anuncia` | con imagen, la tarjeta de formato no está (la vista de editar no la lleva) y el formato lo pone la imagen |
| `test_la_pantalla_es_la_de_crear_video`, `test_hay_respaldo_sin_unidades_de_contenedor` | la rejilla de `Imagenes.tsx` (dos columnas en crear; imagen grande y columna derecha en editar); Playwright a 1440 y 390 |
| `test_el_titulo_gira_entre_crea_edita_y_bocetea`, `test_tu_imagen_no_se_mueve_cuando_gira_la_palabra`, `test_el_titulo_esta_centrado_y_mas_grande_en_las_dos_pantallas` | `imagenes.titulo.el_lector_oye_el_titulo_fijo`; el giro respeta `prefers-reduced-motion`. El título va a la izquierda, como en todas las pantallas del `<Marco>` |
| `test_pedir_editar_en_el_texto_abre_el_editor`, `test_la_vista_sale_del_estado` | `imagenes.vista.pedir_editar_en_el_texto_abre_el_editor` |
| `test_lo_recien_creado_pasa_a_editarse` | `imagenes.resultado.lo_creado_pasa_a_editarse` |
| `test_mis_imagenes_abre_una_imagen_validada` | `imagenes.enlace.solo_abre_una_imagen_con_nombre_valido` y `imagenes.enlace.editar_abre_el_editor` |
| `test_soltar_una_imagen_en_cualquier_parte_la_abre` | el `drop` del documento en `Imagenes.tsx` (se prueba apagado en vuelo en `imagenes.cobro.en_vuelo_nada_cambia_la_imagen_ni_el_modo`) |
| `test_el_js_de_la_pagina_es_valido` | `tsc` y `npm run build` |

### tests/test_ui14_imagenes.py (la carta de diseño en la vieja)

| Test viejo | Destino |
|---|---|
| `test_carga_la_carta_y_los_iconos`, `test_titulos_en_bricolage_y_texto_en_geist`, `test_sin_tamanos_de_letra_fuera_de_la_escala`, `test_enlaces_campos_y_tarjetas_de_la_carta`, `test_el_foco_es_el_de_la_carta` | `tokens.css`, `<Marco>` y los guardianes sobre `web/` |
| `test_sin_emojis_como_iconos`, `test_los_iconos_que_usa_imagenes_existen`, `test_los_iconos_de_los_titulos_van_en_gris` | `<Icono>`, TypeScript (`NombreIcono`) y `text-secundario` en los iconos de los títulos |
| `test_un_solo_principal_y_es_el_que_cobra` | `imagenes.cobro.un_solo_principal_por_vista` y `imagenes.cobro.precio_de_tarifas_json_y_verbo_segun_el_modo` |
| `test_el_resto_son_secundarios_o_enlace` | `<Boton nivel="secundario">`; «No, quiero crear una imagen nueva» es `enlace` |
| `test_elegir_no_es_ambar` | los chips de estilo, los modos y los formatos se marcan en blanco (`border-texto bg-elevada`) |
| `test_lo_que_se_toca_mide_44` | `min-h-11` / `size-11` en chips, modos, formatos, «+» y el grosor |
| `test_nada_queda_debajo_de_la_pildora` | `<Marco>` (`pt-16`) |

### tests/test_ui16_imagenes.py (el cuadro de avisos de trabajos.js)

| Test viejo | Destino |
|---|---|
| `test_abrir_desde_enlace_avisa_en_el_cuadro_y_no_en_el_formulario`, `test_el_aviso_de_abrir_se_quita_al_cargar_una_imagen` | `imagenes.enlace.si_no_abre_avisa_fuera_del_formulario` (el aviso va en la pantalla, no en `trabajos.js`) |
| `test_sin_lista_de_estilos_se_avisa_sin_romper` | `imagenes.estilos.si_no_llegan_se_avisa_y_se_sigue` |
| `test_seguir_y_la_validacion_se_quedan_en_gerr` | `imagenes.archivo.tipo_y_tamano_antes_de_abrir` y `imagenes.cobro.lo_que_se_dice_antes_no_se_cobra` (bajo el botón, `role=alert`) |
| `test_avisos_con_encadenamiento_opcional` | sin destino: la nueva no carga `trabajos.js` |

### Otros módulos que miran imágenes

| Aserción vieja | Destino |
|---|---|
| `test_m22_editor_y_descargas.py::test_la_pagina_ofrece_los_dos_modos` | `imagenes.cobro.el_pincel_manda_la_imagen_y_la_zona_sin_estilo` y `imagenes.cobro.transformar_solo_manda_el_estilo_que_se_eligio` |
| `test_m25_entrada.py::test_las_imagenes_recogen_el_texto_que_ya_escribieron` | `imagenes.enlace.el_texto_del_inicio_llega_recortado` |
| `test_m21_botones.py` (`COBRAN` de imagenes.html) | `BotonCobro` impone «Verbo ✦ N» (Generar, Cambiar y Transformar están en `VERBOS`); al retirar, sale de `COBRAN` |
| `test_m19_orbe.py::test_el_boton_conserva_su_precio` | `BotonCobro` (dice «Creando…» mientras trabaja y vuelve con su precio) |
| `test_m4_recarga_cerrada.py` (`CON_AVISO`) | `imagenes.cobro.sin_saldo_dice_a_quien_escribir`; al retirar, sale de la lista |
| `test_ui_escapar.py` (`PERMITIDOS["e.nombre"]`) | `imagenes.textos.del_servidor_como_texto` (React escapa); al retirar hay que quitar esa entrada o `test_los_permitidos_siguen_existiendo` falla |
| `test_ui14_todas.py`, `test_ui15_trabajos.py` (PANTALLAS) | al retirar, `imagenes` sale de las listas |
| `test_m15_editor_imagenes.py::test_el_inicio_lleva_a_la_herramienta_unica_de_imagenes`, `test_m25_entrada.py`, `Inicio.test.tsx` (enlazan `/imagenes.html`) | se quedan: el 302 hace el resto |

## Diferencias a propósito

- **El precio sale de `tarifas.json`** (`video.imagen`), como en el resto de
  `web/` y en el menú del inicio. La vieja lo leía del evento de
  `monedero.js` y, con los créditos apagados, enseñaba solo el verbo. El
  número es el mismo: el server lee la misma línea.
- **Se revisa lo que devuelve el server** (`nombre` con forma `<12 hex>.jpg`,
  `url` de `/api/imagenes/` o `https://`) antes de usarlo en un `src`, un
  `href` o un `fetch`. La vieja lo usaba tal cual.
- **El aviso del guardarraíl** es el `<Dialogo>` de la carta y no el popup
  con 🛑 de `guardrail.js`. Al cerrarlo, el foco vuelve a la caja de texto.
- **La zona vacía del editor** tiene un botón «Elegir una imagen» en vez de
  ser ella misma un botón con otro botón dentro («No, quiero crear…»):
  controles anidados que el lector de pantalla no sabe anunciar.
- **La lista de atajos** se puede enfocar con Tab y manejar con las flechas
  también desde ella. Rueda cuando hay muchos, y lo que rueda tiene que poder
  recibir el foco.
- **`Dialogo` gana `focoAlCerrar`** (a dónde vuelve el foco al cerrar) y
  **`Marco` acepta un título con contenido** (la palabra que gira).
- **Sin `trabajos.js`:** los avisos van en la pantalla.
