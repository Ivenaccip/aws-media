# Migración de admin (UI·7, el piloto)

`static/admin.html` → `/estudio/admin/` (`web/src/pantallas/admin/`).

Es la primera pantalla que pasa por el interruptor (`server/migracion.py`) y
la única que usa solo el dueño: aquí se prueban el interruptor, `api.ts`, las
tablas y las pestañas antes de tocar una pantalla que cobre.

## Etapas

| Etapa | Qué pasa | Cómo se pasa | Estado |
|---|---|---|---|
| `nueva` | `/estudio/admin/` existe; `/admin.html` sigue igual | este PR | ⏳ al desplegar |
| `todos` | `/admin.html` → 302 a `/estudio/admin/` (conserva el query), salvo la cookie `ui=clasica` | `etapa="todos"` en `PANTALLAS` + deploy | pendiente |
| `retirada` | 302 siempre; se borran `static/admin.html` y sus tests viejos (tabla de abajo) | `etapa="retirada"`, `git rm` + deploy | pendiente |

Regla de retiro (docs/PLAN-UI.md §7): 7 días en `todos` sin incidentes. Para
admin no hay dinero de por medio, pero el criterio se mide igual: cada 302
deja en CloudWatch una línea `migracion 302 pantalla=admin etapa=todos sub=…`.

## Los invariantes (tests/test_migracion_ui.py)

Cada uno es un test de vitest en `web/src/pantallas/admin/Admin.test.tsx`
con ese nombre exacto (los `admin.clases.*`, en `Clases.test.tsx`, de la misma carpeta).

| ID | Qué garantiza |
|---|---|
| `admin.vistas.las_pestanas_con_aria` | Ingresos, Costos, Flujo y Clases, en ese orden, como pestañas de verdad (flechas, `aria-selected`). Antes fijaba exactamente tres: con «4 · Clases» (la última, para no mover las otras) el ID se renombró a propósito en tres sitios a la vez: el `it(...)` de `Admin.test.tsx`, `INVARIANTES["admin"]` y esta fila |
| `admin.acceso.sin_permiso_muestra_solo_administradores` | un 403 enseña «solo para administradores» y ningún dato |
| `admin.carga.sin_red_pide_revisar_la_conexion` | sin red, el panel no se queda en «Cargando…» |
| `admin.carga.error_del_server_muestra_su_detalle` | el `detail` del server se enseña tal cual |
| `admin.textos.del_server_se_pintan_como_texto` | un correo con HTML se lee como texto, nunca se ejecuta |
| `admin.dinero.totales_en_dolares` | los totales en «$X.XX dólares»; por usuario, cuatro decimales; nunca «centavos» |
| `admin.detalle.uid_codificado_en_la_ruta` | un id con `/` o espacios no rompe `/api/admin/usuarios/…` |
| `admin.detalle.traza_con_id_codificado` | el enlace a Langfuse codifica el id y abre aparte con `noopener` |
| `admin.detalle.sin_red_avisa_y_reintenta` | sin red, el detalle avisa y «Reintentar» lo abre (UI·16) |
| `admin.detalle.error_del_server_en_su_tarjeta` | «Error N.» dentro de la tarjeta del detalle |
| `admin.sync.doble_clic_un_solo_post` | doble clic en Sincronizar = 1 POST |
| `admin.sync.error_deja_volver_a_intentar` | tras un error, el botón vuelve a funcionar |
| `admin.flujo.signo_pinta_verde_o_rojo` | flujo positivo en verde, negativo en rojo |
| `admin.marco.enlace_estudio_sin_version_anterior` | «← Estudio», sin «Usar la versión anterior» (se quitó el 28-sep; `/ui/clasica` sigue a mano) |

## «4 · Clases» (Guía de clases, rebanada S1): función nueva

La pestaña no existía en `static/admin.html`: no hay aserción vieja que mapear. Sus invariantes se registran igual (con prefijo
`admin.clases.`), porque protegen dinero y seguridad: aquí **nada llama a un proveedor de pago** (subir, confirmar y medir no cuestan
nada; procesar es de la rebanada S4), todo lo que viene del servidor se pinta como texto, y **nada borra en S3** (archivar es un
borrado suave del servidor: la web solo manda `DELETE`/`POST …/restaurar`). Viven en `Clases.test.tsx`, contra un servidor de mentira
con las rutas de la sección 5.1 del diseño y un XHR que la prueba mueve a mano. El navegador de verdad (1100, 390 y 320 px, axe, 44 px,
foco, sin desborde) lo mide `admin-clases.spec.ts`, con la API simulada por `page.route`.

| ID | Qué garantiza |
|---|---|
| `admin.clases.solo_se_pide_al_abrir_la_pestana` | con la pestaña cerrada no hay ni un `fetch` a `/api/admin/clases`; al abrirla, uno solo (`?archivadas=0`), y las archivadas no se piden |
| `admin.clases.sin_clases_ensena_el_primer_paso_y_el_unico_boton_ambar` | sin clases: «Todavía no hay clases», la ayuda («Subir no cuesta nada») y un solo «Nueva clase», el único ámbar |
| `admin.clases.error_de_carga_dice_el_texto_del_servidor_y_reintenta` | un fallo de carga enseña el `detail.texto` del servidor con «Reintentar»; sin lista no hay «Nueva clase» |
| `admin.clases.textos_del_servidor_se_pintan_como_texto` | `<img src=x onerror=alert(1)>` en título, resumen, nombre de archivo, liga o error se lee como texto; nunca hay `img`, `script` ni `javascript:` en el DOM |
| `admin.clases.la_liga_https_abre_aparte_y_las_otras_no_son_enlace` | solo `https:` es enlace (`target=_blank`, `rel="noopener noreferrer"`); `http:`, `file:` y `javascript:` se quedan como texto |
| `admin.clases.chips_de_estado_y_lo_que_se_sabe_del_video` | Borrador · Subiendo · Subido, «Listo: 1 h 02 min · 1.4 GB», la fecha, el nombre del archivo y el orden por número |
| `admin.clases.limites_vienen_del_servidor` | `maxlength` del título y del resumen, el contador y el `accept` del selector salen de `limites`, no de constantes de la web |
| `admin.clases.nueva_clase_abre_el_formulario_con_el_foco_y_guardar_es_el_unico_ambar` | los cinco campos, el foco en el primero, «Guardar clase» como único ámbar (la «Nueva clase» se esconde) y «Cancelar» devuelve el foco |
| `admin.clases.guardar_sin_numero_o_titulo_no_llama_al_servidor` | falta número o título (o un número que no es entero): error junto al campo, foco en el primero y ningún POST |
| `admin.clases.doble_clic_en_guardar_clase_manda_un_solo_post_con_su_clave` | doble clic = un POST, con una `clave` UUID del navegador; el foco va al título de la clase nueva |
| `admin.clases.lo_opcional_vacio_no_viaja_y_un_reintento_manda_la_misma_clave` | resumen, fecha y liga vacíos no viajan (y sin liga la clase es `origen: "archivo"`); tras un fallo, el reintento repite la clave; el siguiente formulario trae otra |
| `admin.clases.con_liga_la_clase_es_solo_una_referencia_sin_video` | con liga la clase se crea como `origen: "liga"` (el servidor no deja ligas en una clase con archivo): sin «Subir video», con el enlace; al editarla la liga es obligatoria y solo viaja si cambió |
| `admin.clases.el_numero_y_la_fecha_se_revisan_con_los_limites_y_el_texto_del_servidor` | el número se revisa contra `numero_min`/`numero_max` del servidor antes de mandar; una fecha mala (`fecha_invalida`) se enseña con el texto del servidor junto al campo, con el foco ahí |
| `admin.clases.errores_del_servidor_se_leen_junto_al_campo_con_su_texto` | un `numero_repetido` (409) se enseña con el texto del servidor junto al número, con el foco ahí y sin perder lo escrito |
| `admin.clases.editar_manda_solo_lo_que_cambio_y_vaciar_manda_null` | el PATCH lleva solo lo cambiado; vaciar el resumen o la fecha viaja como `null`; una clase con archivo no muestra la liga; sin cambios no hay petición |
| `admin.clases.subir_sigue_el_orden_permiso_put_confirmar_medir` | permiso (el servidor elige la clave) → PUT con progreso → confirmar → medir, en ese orden y sin tocar `/api/media/*` |
| `admin.clases.subir_avisa_al_cerrar_la_pestana_solo_mientras_sube` | `beforeunload` solo mientras hay una subida en curso |
| `admin.clases.cambiar_de_pestana_a_media_subida_no_la_detiene` | cambiar de vista no detiene el PUT: el aviso de `beforeunload` sigue, se confirma y se mide, y al volver la tarjeta ya cuenta la clase subida y medida (sin pedir la lista otra vez: «4 · Clases» se queda montada, oculta, con `conservar`) |
| `admin.clases.cancelar_la_subida_no_confirma` | «Cancelar» corta el PUT, no confirma ni mide, y devuelve la clase a «Borrador» |
| `admin.clases.cancelar_antes_de_que_llegue_el_permiso_no_sube_nada` | cancelar con el permiso en el aire: al llegar no se abre ningún PUT |
| `admin.clases.si_falla_el_put_dice_que_revises_la_conexion_y_no_confirma` | un PUT caído o rechazado dice «No se pudo subir el video. Revisa tu conexión e inténtalo otra vez.», no confirma y suelta la subida (con el token de esa subida) |
| `admin.clases.errores_del_servidor_al_subir_se_leen_con_su_texto` | un 409 al pedir permiso enseña el texto del servidor y no abre ningún PUT |
| `admin.clases.si_el_archivo_no_llego_a_s3_confirmar_dice_el_texto_del_servidor` | `archivo_no_esta` se enseña tal cual, no se mide y la subida se suelta |
| `admin.clases.si_no_se_puede_medir_el_video_queda_subido_y_se_mide_otra_vez` | un `medir_fallo` deja la clase «Subida» (no se vuelve a subir) y «Medir duración» lo reintenta |
| `admin.clases.un_archivo_fuera_de_los_limites_del_servidor_no_pide_permiso` | extensión, peso máximo o archivo vacío, contra `limites`, se rechazan antes de pedir el permiso |
| `admin.clases.subida_vieja_en_el_servidor_se_cancela_con_su_boton` | una clase «Subiendo» sin subida en curso (se cerró la pestaña) ofrece «Cancelar subida», que cancela sin token (esa tarjeta no sabe el de la subida) |
| `admin.clases.ver_video_pide_la_url_firmada_al_servidor_y_no_la_ensena` | «Ver video» pide la URL al servidor, la usa en un `<video controls>` sin `autoplay` y no la muestra como texto ni enlace |
| `admin.clases.video_que_no_carga_o_sin_permiso_dice_por_que` | un 404 del servidor o un video que el navegador no reproduce se dicen, y «Ver video» pide una liga nueva |
| `admin.clases.archivar_pide_confirmacion_y_ni_esc_ni_cancelar_archivan` | diálogo de nivel peligro con el foco en «Cancelar»; Esc y «Cancelar» no mandan el `DELETE`; confirmar manda uno y el foco no cae al `<body>` |
| `admin.clases.si_no_se_pudo_archivar_lo_dice_y_la_clase_se_queda` | un fallo del servidor al archivar se enseña con su texto, dentro de la tarjeta, y la clase sigue en la lista |
| `admin.clases.archivadas_se_piden_al_prender_el_interruptor_y_se_restauran` | las archivadas solo se piden al prender «Ver clases archivadas»; «Restaurar» la devuelve a su lugar por número y le lleva el foco |
| `admin.clases.archivar_con_las_archivadas_a_la_vista_la_suma_a_esa_lista` | archivar con ellas a la vista las vuelve a traer; sirve igual si el servidor devuelve solo archivadas o todas |
| `admin.clases.si_no_se_pudo_restaurar_lo_dice_con_el_texto_del_servidor` | un `numero_repetido` al restaurar se enseña (dentro de la tarjeta archivada) y la clase sigue archivada |
| `admin.clases.un_solo_boton_ambar_en_cada_estado` | en reposo, subiendo, con archivadas, con el diálogo y con el formulario (nuevo o de edición) hay a lo más un ámbar de botón; la cuenta incluye la pista y la bolita de los interruptores |
| `admin.clases.ningun_precio_sin_la_palabra_dolares_y_sin_prometer_procesar` | todo «$N» lleva «dólares», nunca «centavos», y la pestaña no ofrece ni promete procesar (eso es la S4) |
| `admin.clases.no_guarda_nada_en_el_almacenamiento_del_navegador` | crear, subir y ver video no escriben en `localStorage` ni `sessionStorage` |
| `admin.clases.doble_clic_en_subir_pide_un_solo_permiso` | dos «elegir video» antes de que React repinte piden UN solo permiso (`POST …/subida`) y abren un PUT, una confirmación y una medida (el candado va antes del primer `await`) |
| `admin.clases.cancelar_justo_cuando_termina_el_put_no_confirma` | si el PUT termina y la persona pulsa «Cancelar» en el mismo instante, no hay `confirmar` ni `medir`: se cancela con el token |
| `admin.clases.un_fallo_pasajero_de_confirmar_no_cancela_la_subida_y_se_reintenta` | con el PUT terminado, un 503 (base dormida), un 502 `s3_fallo`, un 504 sin JSON o la red cortada NO cancelan: la clase sigue «subiendo», el aviso de cerrar la pestaña se queda y «Reintentar la confirmación» confirma con el MISMO token, sin permiso ni PUT nuevos |
| `admin.clases.tras_un_fallo_pasajero_de_confirmar_cancelar_subida_la_suelta_con_su_token` | tras ese fallo, «Cancelar subida» devuelve la clase a «borrador» con el token de esa subida y se puede elegir otro video |
| `admin.clases.cada_rechazo_definitivo_de_confirmar_suelta_la_subida` | `archivo_no_esta`, `video_vacio`, `tamano_invalido` y `tipo_no_soportado` sí sueltan la subida (con su token) y enseñan el texto del servidor; no se ofrece reintentar |
| `admin.clases.una_subida_que_quedo_a_medias_se_confirma_sin_volver_a_subir` | una clase «Subiendo» sin subida local (se cerró la pestaña con el video ya en la nube) ofrece «Reintentar la confirmación»: confirma sin token ni nombre (cuerpo `{}`), sin volver a subir |
| `admin.clases.una_subida_a_medias_a_la_que_el_servidor_no_le_halla_el_video_no_se_cancela_sola` | si esa confirmación da `archivo_no_esta` (otra pestaña la sigue subiendo), se dice y NO se cancela lo que no es de esta tarjeta |
| `admin.clases.la_subida_lleva_su_token_en_confirmar_y_cancelar` | el token que da `…/subida` (32 hex) viaja en el cuerpo de `…/confirmar` y de `…/cancelar`; cada subida lleva el suyo |
| `admin.clases.subida_cambio_no_cancela_nada_ni_se_trata_como_fallo_de_red` | un 409 `subida_cambio` al confirmar se enseña como aviso (no como alerta ni «revisa tu conexión»), no cancela ni mide, y se vuelve a pedir la clase |
| `admin.clases.cancelar_con_una_subida_que_ya_no_es_la_vigente_dice_el_texto_y_no_cambia_nada` | un 409 `subida_cambio` al cancelar dice el texto del servidor, no «Subida cancelada» |
| `admin.clases.sin_internet_a_media_subida_la_tarjeta_sigue_subiendo_y_ofrece_cancelar_subida` | si el PUT se cae y el aviso al servidor también, la tarjeta dice «Subiendo» (no «Borrador»), explica que la subida quedó abierta y ofrece «Cancelar subida», que con la red de vuelta la suelta con su token |
| `admin.clases.cancelar_sin_internet_dice_que_la_subida_quedo_abierta` | «Cancelar» sin red corta el PUT pero no dice «Subida cancelada»: avisa que no se pudo avisar al servidor y ofrece «Cancelar subida» |
| `admin.clases.si_el_permiso_no_contesta_se_vuelve_a_pedir_la_clase` | si `…/subida` no contesta (sin red o 5xx) el servidor pudo dejar la clase «subiendo»: se vuelve a pedir la lista y la tarjeta cuenta la verdad |
| `admin.clases.al_volver_a_la_pestana_a_media_subida_sigue_la_barra_y_no_ofrece_cancelar_subida` | ir a otra vista y volver a media subida: la barra y su «Cancelar» (que corta el PUT) siguen; no sale «Hay una subida en curso…» ni «Cancelar subida» |
| `admin.clases.el_foco_nunca_cae_al_body_al_empezar_cancelar_terminar_ni_medir` | el selector, «Cancelar» y su desaparición al empezar, cancelar o terminar una subida dejan el foco en el título de la tarjeta, no en `<body>` |
| `admin.clases.el_foco_no_cae_al_body_tras_medir_duracion` | «Medir duración» con Enter y la tarjeta ya medida: el foco queda en el título |
| `admin.clases.no_se_le_roba_el_foco_a_quien_ya_se_fue_a_otra_parte` | si la persona se fue a otro botón mientras sube, al terminar el foco sigue donde estaba |
| `admin.clases.si_falla_archivar_o_restaurar_el_aviso_sale_dentro_de_la_tarjeta` | el error de archivar (la 7 de 9) y el de restaurar salen dentro de SU tarjeta, no arriba de toda la lista; el segundo intento sale bien y quita el aviso |
| `admin.clases.dos_subidas_a_la_vez_mantienen_el_aviso_de_cerrar_hasta_que_terminen_las_dos` | `beforeunload` es un solo aviso con un contador: al terminar la primera subida, la segunda sigue protegida |
| `admin.clases.medir_duracion_repite_su_texto_visible_en_su_nombre_accesible` | «Medir duración» se llama «Medir duración de la clase N» (WCAG 2.5.3); en ningún botón de las tarjetas el nombre deja fuera el texto visible |
| `admin.clases.el_interruptor_encendido_no_es_ambar_de_boton` | «Ver clases archivadas» encendido lleva el tono de «elegido» (borde `#a96716`, fondo `#2e2110`, bolita en ámbar claro), no el ámbar del botón principal |
| `admin.clases.editar_otra_clase_con_cambios_sin_guardar_pide_confirmar` | con un formulario escrito, «Editar» de otra tarjeta pregunta (foco inicial en «Seguir escribiendo»); Esc y «Seguir escribiendo» no tocan nada y el foco vuelve al formulario; confirmar cambia de formulario con el foco en su primer campo. Sin nada escrito no pregunta |
| `admin.clases.cambiar_de_pestana_conserva_el_formulario_abierto` | «4 · Clases» no se monta hasta abrirla y después se queda montada (oculta): lo escrito en el formulario sobrevive a mirar otra vista, sin pedir la lista otra vez |

Pruebas sueltas de la misma pestaña (sin ID): `admin-clases.spec.ts` (navegador real a 1100, 390 y 320 px: sin desborde horizontal,
objetivos de 44 px o más, letra de 13 px o más, axe sin violaciones y el foco que nunca cae en `body`: al abrir y cerrar el formulario y
el diálogo de archivar, y al empezar, cancelar y terminar una subida y al medir la duración, SIN enfocar a mano otro botón antes de
mirar; también el estado «Reintentar la confirmación», el aviso de archivar y restaurar dentro de su tarjeta y a la vista, el diálogo de
«Editar» con cambios sin guardar, y que quede un solo ámbar con el interruptor encendido). Con `GUIA_CAPTURAS=<carpeta>` guarda una captura
por estado. Aparte, de `web/src/ui/`: `Pestanas.test.tsx` (`conservar`), `Interruptor.test.tsx` (el tono de «elegido») y
`Confirmar.test.tsx` (`focoAlCerrar`).

### Diferencias a propósito (de esta pestaña)

- Va **última** para no tocar las otras tres, y solo existe si `/api/admin/resumen` salió bien (la barra de pestañas se pinta con él):
  si el resumen falla, tampoco hay «Clases». Limitación aceptada en el diseño.
- La subida **no** usa `/api/media/presign`: ese reserva nombres de proyecto del editor y metería la clase en «Mis creaciones». El
  servidor elige la clave del video (`clases/<id>/video.<ext>`) y la web nunca la ve.
- Los límites (extensiones, `max_bytes`, `titulo_max`, `resumen_max`) los dice el servidor en `GET /api/admin/clases`; la web no tiene
  constantes propias. La lista **no** trae `precios` todavía (llegan con la S4) y la pestaña no escribe ninguno.
- Archivar es un borrado suave del servidor (`DELETE` marca `archivada_en`): la web no borra nada y el rol de la Lambda no puede
  borrar en S3.
- Cada subida lleva un **token** (32 hex, lo da `POST …/subida`): la web lo manda en `…/confirmar` y `…/cancelar` de SU subida. Un 409
  `subida_cambio` ni cancela ni confirma nada: se dice con el texto del servidor y se vuelve a pedir la clase. Una subida que quedó a
  medias (se cerró la pestaña) no sabe su token y cancela o confirma sin él, como siempre.
- «4 · Clases» se queda **montada** (oculta) una vez abierta (`conservar` en `Pestanas`, solo para ella): una subida en curso, sus avisos y
  el formulario a medias no se pierden por mirar otra vista. Las otras tres pestañas siguen desmontándose como siempre.
- Un fallo **pasajero** de `confirmar` (red, 5xx, `s3_fallo`, base dormida) con el PUT ya terminado no cancela: la clase sigue «subiendo» y
  la tarjeta ofrece «Reintentar la confirmación» y «Cancelar subida». Solo `archivo_no_esta`, `video_vacio`, `tamano_invalido` y
  `tipo_no_soportado` sueltan la subida.
- El interruptor encendido ya no es ámbar de botón (DISENO.md §5): lo usan «Ver clases archivadas» y el «Audio» del menú de modelos.

## Cada aserción vieja y su destino

Al pasar a `retirada` se borran estos tests junto con `static/admin.html`.

### tests/test_ui14_admin.py (la carta de diseño en la vieja)

| Test viejo | Destino |
|---|---|
| `test_carga_la_carta_y_los_iconos` | Sin equivalente directo: en web/ los tokens salen de `tokens.css` y los iconos de `ui/iconos.ts`, que `test_web_tuberia.py::test_los_iconos_son_los_de_iconos_js` mantiene iguales a `iconos.js` |
| `test_titulos_en_bricolage_y_texto_en_geist` | `tokens.css` (`--font-titulo`, `--font-texto`); el `h1` del `Marco` usa `font-titulo`; las cifras usan `tabular-nums` |
| `test_sin_tamanos_de_letra_fuera_de_la_escala` | `tokens.css` borra la escala de Tailwind (`--text-*: initial`): fuera de los seis tamaños no hay clase que compile |
| `test_sin_emojis_como_iconos` | Guardián M19/M21 sobre `web/` (UI·1) y los iconos de trazo de `<Icono>` |
| `test_los_iconos_que_usa_admin_existen` | TypeScript: `NombreIcono` es la lista de `iconos.ts`; un nombre que no existe no compila |
| `test_un_solo_principal_por_vista` | Sincronizar es el único `nivel="principal"` de `Admin.tsx` |
| `test_la_vista_elegida_no_es_ambar` | `ui/Pestanas.tsx`: la elegida va en blanco (`border-texto`); arreglado en este PR, venía en ámbar desde UI·6 |
| `test_enlaces_en_azul_claro_y_sin_colores_sueltos` | Guardián M20 sobre `web/` (UI·1): ningún color fuera de la paleta; enlaces con `text-enlace` |
| `test_filas_tocables_de_44` | La fila ya no se toca entera: el nombre es un botón de 44 px (`min-h-11`) con `aria-label`, así el teclado y el lector lo encuentran |
| `test_sin_sepia` | Guardián M20 sobre `web/` |

### tests/test_ui16_admin.py (los avisos del panel)

| Test viejo | Destino |
|---|---|
| `test_detalle_envuelve_el_fetch_y_avisa_en_el_cuadro` | `admin.detalle.sin_red_avisa_y_reintenta` y `admin.detalle.error_del_server_en_su_tarjeta`. El aviso ya no va al cuadro de `trabajos.js`: la pantalla nueva no lo carga y avisa dentro del detalle, con Reintentar |
| `test_lo_que_se_queda_en_su_sitio` | `admin.carga.sin_red_pide_revisar_la_conexion` y `admin.sync.error_deja_volver_a_intentar` |
| `test_sin_red_cierra_el_detalle_y_reintentar_lo_abre` | `admin.detalle.sin_red_avisa_y_reintenta` |

### Otros módulos que miran admin

| Aserción vieja | Destino |
|---|---|
| `test_ui_escapar.py::test_se_encontraron_las_esc` (`static/admin.html` define su `esc`) | `admin.textos.del_server_se_pintan_como_texto`. Al retirar, se quita `static/admin.html` de la lista esperada |
| `test_cache_estaticos.py` (`/admin.html` es HTML `no-cache`) | Mientras la vieja exista la sirve `server/migracion.py` con `no-cache` (`test_migracion.py::test_nueva_sirve_la_vieja_sin_redirigir`). Al retirar, el 302 lleva `no-store` y `/admin.html` sale de esa lista |

## Diferencias a propósito

- Tras sincronizar, el resumen se vuelve a pedir en su sitio; la vieja
  recargaba la página entera.
- Un flujo negativo se escribe `-$0.3000`; la vieja escribía `$-0.3000`.
- No carga `monedero.js` (el panel no cobra) ni `trabajos.js` (los avisos
  van dentro de la pantalla).
- Fuera de la paleta, en React no hay `innerHTML`: el escape lo hace React
  (y eslint prohíbe `dangerouslySetInnerHTML`).
- La nota de Costos ya no nombra `pricing.json`: el bundle es público y
  `test_web_tuberia.py` prohíbe que el nombre llegue a `web/dist`. Dice «la
  tarifa de Aurora» y «las tarifas de AWS».
