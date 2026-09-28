# Migración de editar metraje (UI·8.3)

`static/e1.html` → `/estudio/subir/` (`web/src/pantallas/subir/`).

La pantalla tiene dos partes:

- **Subir metraje:** el video sube directo a S3 con XHR, con progreso real,
  la opción de cancelar y un aviso si se cierra la pestaña a medias.
- **Los dos caminos**, una vez que hay metraje:
  - Cortes IA lleva a shorts.
  - Editor IA cobra una cosa, «Proponer ✦ N». El precio sale siempre de
    `/api/editar/<p>/costo`, que el server calcula con `tools/tarifas.json`
    §editar; la pantalla no escribe ningún número de créditos.

El nombre de la pantalla es `subir` (la URL dice lo que se hace en ella); la
vieja se llamaba `e1`.

## Etapas

| Etapa | Qué pasa | Cómo se pasa | Estado |
|---|---|---|---|
| `nueva` | `/estudio/subir/` existe; `/e1.html` sigue igual | este PR | ⏳ al desplegar |
| `todos` | `/e1.html?p=…` → 302 a `/estudio/subir/?p=…`, salvo la cookie `ui=clasica` | `etapa="todos"` + deploy | pendiente |
| `retirada` | 302 siempre; se borran `static/e1.html` y sus tests viejos | `etapa="retirada"`, `git rm` + deploy | pendiente |

Antes de `todos`, el dueño hace dos cosas en `/estudio/subir/`:

1. Sube un video de verdad (no cobra).
2. Pide **un corte de verdad**. Cobra 💳 según `tarifas.json`:
   - con transcript: `editar.sugerencias` = 2 créditos;
   - sin transcript: se suman `shorts.transcripcion_por_5min` = 2 créditos por
     cada 5 minutos o fracción.

   Esta prueba necesita su «sí» al gasto.

Después corre el QA manual de `docs/QA-UI.md` § subir.

Los enlaces que apuntan a `/e1.html` no se tocan: el menú y «Subir metraje»
del inicio, las tarjetas de «Mis ediciones» (`?p=`) y «Tus trabajos»
(`server/trabajos_api.py`). En `todos` los lleva el 302, que conserva el
query.

## Los invariantes (tests/test_migracion_ui.py)

Cada uno es un test de vitest en `web/src/pantallas/subir/Subir.test.tsx` con
ese nombre exacto.

| ID | Qué garantiza |
|---|---|
| `subir.cobro.precio_del_servidor_en_el_boton` | «Proponer ✦ N» con el precio de `/costo`. El test usa una tarifa falsa a propósito: si alguien escribe el número en el cliente, falla |
| `subir.cobro.pide_confirmar_y_cancelar_no_cobra` | antes de cobrar pide confirmación («por N créditos»); Cancelar no manda nada y el botón sigue sirviendo |
| `subir.cobro.doble_clic_un_solo_post` | un doble clic abre un solo diálogo y hace un solo POST; mientras vuela, el botón dice «Lanzando…» y se traga los clics |
| `subir.cobro.sin_precio_no_hay_boton` | sin `backend_listo` enseña el aviso del server; si el precio no llega, enseña el error. En los dos casos no hay botón (nube sin preview = bug) |
| `subir.cobro.error_se_queda_y_el_boton_vuelve` | un 409 u otro error se queda a la vista y el botón vuelve a cobrar. La vieja lo pintaba y el `initCorte()` siguiente lo borraba (M19) |
| `subir.cobro.sin_saldo_con_la_recarga_cerrada_dice_a_quien_escribir` | un 402 enseña su detalle y el texto de `monedero.cta`, sin un «Recargar» muerto |
| `subir.cobro.saldo_conocido_que_no_alcanza_no_cobra` | si la píldora sabe que no alcanza, el botón se apaga y dice cuánto falta (nuevo, de `BotonCobro`) |
| `subir.cobro.refresca_el_saldo_y_pasa_a_revisando` | tras cobrar: `monedero.refrescar()`, el orbe «Revisando tu metraje…» y el botón desaparece. El POST va sin cuerpo, como siempre |
| `subir.subida.sin_servicio_no_se_ofrece` | sin `MEDIA_BUCKET` (`activo: false`) no hay sección de subida y un aviso lo dice |
| `subir.subida.sin_nombre_o_archivo_no_pide_firma` | «Falta el nombre del proyecto o el archivo.» y no hay presign |
| `subir.subida.nombre_invalido_no_pide_firma` | la regla de `_validar_nombre` (letras, números, `-`, `_`; con acentos) antes de pedir nada |
| `subir.subida.firma_con_proyecto_archivo_tipo_y_bytes` | el presign lleva proyecto, archivo, tipo (`video/mp4` si el navegador no da uno) y bytes; el PUT va a la URL firmada con ese `Content-Type` |
| `subir.subida.progreso_real_con_porcentaje_y_mb` | barra `role=progressbar` con `aria-valuenow`, «Subiendo x — 40% (20.0 de 50.0 MB)» y Subir apagado mientras sube (M5) |
| `subir.subida.cancelar_aborta_y_lo_dice` | Cancelar aborta el XHR, dice «Subida cancelada — nada quedó a medias…» y no confirma |
| `subir.subida.fallo_del_put_avisa_y_deja_reintentar` | un PUT 403 o sin red avisa y se puede volver a subir |
| `subir.subida.confirma_y_pasa_al_panel_con_p_en_la_url` | tras confirmar: «Listo: …», `?p=` en la URL, el video del CDN y el panel con «Proponer ✦ N» (M14) |
| `subir.subida.avisa_antes_de_cerrar_a_medias` | `beforeunload` avisa solo mientras sube |
| `subir.subida.nombre_ocupado_409_deja_una_variante` | un 409 del presign deja `nombre-xxxx` en el campo y lo dice; no sube nada |
| `subir.subida.doble_clic_una_sola_firma` | dos clics en el mismo tic son una sola subida (el candado se cierra antes de cualquier `await`) |
| `subir.panel.sin_proyecto_no_hay_panel` | sin `?p=` no hay panel ni llamadas a `/api/editar` |
| `subir.panel.proyecto_codificado_en_la_ruta` | `?p=año` → `/api/editar/a%C3%B1o` y `/shorts.html?p=a%C3%B1o` |
| `subir.panel.video_de_muestra_desde_el_cdn` | `<video>` con `cdn + "/" + fuente`, sin doble barra |
| `subir.panel.sin_metraje_pide_subirlo_primero` | «Sube tu metraje arriba y aquí aparecen tus dos caminos.», «Sube tu metraje primero» en los dos caminos; no se pide precio |
| `subir.panel.cortes_ia_lleva_a_shorts_con_el_proyecto` | con metraje, la tarjeta entera lleva a `/shorts.html?p=<p>` |
| `subir.panel.listo_editar_y_resumen` | «Editar» lleva a `/editor/<p>/`; «Corte propuesto: propuso N cortes, …»; pestaña «✓ Corte propuesto»; no se pide precio |
| `subir.panel.sin_relleno_dice_que_devolvimos` | cero sugerencias: «Tu video ya está apretado… te devolvimos N créditos…»; pestaña «✓ Sin relleno que quitar» |
| `subir.panel.corrida_fallida_dice_que_los_creditos_volvieron` | «La corrida anterior falló y tus créditos se devolvieron.» y se puede volver a pedir |
| `subir.panel.metraje_con_duracion_y_transcript` | «Metraje de 12.6 min (la corrida del editor incluye la transcripción).» |
| `subir.panel.local_503_manda_a_clean_cut` | el 503 de la instalación local manda a `/clean-cut`, sin botón |
| `subir.panel.un_solo_principal` | un solo ámbar: Subir sin metraje; con metraje, la acción del Editor IA y Subir pasa a secundario |
| `subir.panel.textos_del_server_como_texto` | el nombre del proyecto (de la URL) y los errores del server se leen como texto; el error deja Reintentar |
| `subir.espera.sondea_mientras_corre_y_para_al_terminar` | sondea mientras corre, para al terminar y refresca el saldo (si falló o no encontró relleno hubo devolución) |
| `subir.espera.sin_red_con_la_corrida_viva_sigue_reintentando` | sin red con la corrida viva: «Sin conexión — reintentando…», el orbe se queda y sigue solo |
| `subir.espera.titulo_de_la_pestana_dice_revisando` | la pestaña dice «Revisando tu metraje · …» |
| `subir.espera.el_orbe_ocupa_el_sitio_de_la_animacion` | con la corrida viva, el orbe reemplaza la animación del editor, no se le suma; la de shorts se queda |
| `subir.marco.enlace_estudio_sin_version_anterior` | «← Estudio», sin «Usar la versión anterior» (se quitó el 28-sep; `/ui/clasica` sigue a mano) |

## Cada aserción vieja y su destino

Al pasar a `retirada` se borran estos tests junto con `static/e1.html`.

### tests/test_ui14_e1.py (la carta de diseño en la vieja)

| Test viejo | Destino |
|---|---|
| `test_carga_la_carta_y_los_iconos` | `tokens.css` y `ui/iconos.ts` (iguales a `iconos.js`, `test_web_tuberia.py`) |
| `test_titulos_en_bricolage_y_texto_en_geist` | `tokens.css`; el `h1` del `Marco` va en `font-titulo` |
| `test_sin_tamanos_de_letra_fuera_de_la_escala` | `tokens.css` borra la escala de Tailwind: fuera de los seis tamaños no compila |
| `test_sin_emojis_como_iconos` | guardianes M19/M21 sobre `web/` e `<Icono>` |
| `test_los_iconos_que_usa_e1_existen` | TypeScript: `NombreIcono` |
| `test_sin_metraje_el_principal_es_subir` | `subir.panel.un_solo_principal` |
| `test_elegir_y_pasar_encima_no_es_ambar` | la tarjeta de Cortes IA pasa a `border-secundario` al pasar encima; el único ámbar que no es botón es la barra de subida (`bg-ambar`) |
| `test_enlaces_campos_y_tarjetas_de_la_carta` | `<Campo>` (`border-campo bg-elevada rounded-medio`) y tarjetas `rounded-grande bg-superficie` |
| `test_lo_que_se_toca_mide_44` | `<Campo>` `min-h-11`, el botón del archivo `file:min-h-11`, el enlace de Cortes IA `min-h-11`, enlaces del `Marco` `min-h-11` |
| `test_los_iconos_de_los_titulos_van_en_gris` | los iconos de los `h2` llevan `text-secundario`; el de error del estado, `text-error` |
| `test_el_estado_sigue_entrando_como_texto` | `subir.panel.textos_del_server_como_texto` (React escapa) y `subir.cobro.precio_del_servidor_en_el_boton` |
| `test_con_metraje_el_principal_es_el_editor` | `subir.panel.un_solo_principal` |

### tests/test_m19_orbe.py (fase 3: las esperas de minutos)

| Aserción vieja | Destino |
|---|---|
| `test_la_pestana_dice_en_que_va[e1.html]` | `subir.espera.titulo_de_la_pestana_dice_revisando`, `subir.panel.listo_editar_y_resumen` y `subir.panel.sin_relleno_dice_que_devolvimos` |
| `test_el_poll_se_duerme_con_la_pestana_oculta[e1.html]` | `nucleo/sondeo.ts` (se duerme con la pestaña oculta; `sondeo.test.ts`) |
| `test_sin_orbe_la_pagina_sigue_funcionando[e1.html]` | `<EsperaIA>`: sin `window.orbe` queda el texto con `role=status` |
| `test_e1_no_acumula_timers_de_poll` | `useSondeo`: un solo sondeo, que se para al desmontar o al terminar (`subir.espera.sondea_mientras_corre_y_para_al_terminar`) |
| `test_e1_el_error_de_lanzar_ya_no_se_borra_solo` | `subir.cobro.error_se_queda_y_el_boton_vuelve` |
| `test_e1_el_orbe_reemplaza_la_animacion_no_se_le_suma` | `subir.espera.el_orbe_ocupa_el_sitio_de_la_animacion` |
| `test_todas_las_paginas_tienen_favicon` | se queda: ya mira `web/**/index.html` |

### Otros módulos que miran e1

| Aserción vieja | Destino |
|---|---|
| `test_m21_botones.py` (`("static/e1.html", "Proponer")`) | `subir.cobro.precio_del_servidor_en_el_boton`; la forma «Verbo ✦ N» la impone `BotonCobro` (`Verbo` incluye «Proponer»). Al retirar, sale de `COBRAN` |
| `test_ui15_trabajos.py::test_va_en_todas_las_pantallas_despues_del_monedero[e1]` | sin destino: la nueva no carga `trabajos.js` (como clip, estilos y competencia). Al retirar, `e1` sale de `PANTALLAS` |
| `test_ui15_trabajos.py::test_las_subidas_salen_en_el_cuadro[e1]` | `subir.subida.progreso_real_con_porcentaje_y_mb`: el progreso se ve en la pantalla, que es donde hay que quedarse |
| `test_ui15_trabajos.py` (`url == "/e1.html?p=podcast"`) | se queda: es del server y la URL vieja sigue funcionando por el 302 |
| `test_ui14_todas.py` (`"e1"` en `PANTALLAS`) | la carta la imponen `tokens.css` y los componentes. Al retirar, `e1` sale de la lista |
| `test_ui10_inicio.py` / `test_m25_entrada.py` (`href="/e1.html"` en el inicio) | se quedan: el inicio sigue apuntando a `/e1.html` y el 302 hace el resto |
| `test_m22_testers.py` (el gate `backend_listo`) | se queda: prueba el server. En la nueva, `subir.cobro.sin_precio_no_hay_boton` |

## Diferencias a propósito

- **Confirmación:** en vez de `confirm()`, `<Confirmar>` (Radix, con el foco
  en Cancelar). El candado de `BotonCobro` sigue cerrado mientras el diálogo
  está abierto, así que un doble clic no abre dos.
- **La tarjeta de Editor IA ya no es un botón entero:** el que cobra es
  «Proponer ✦ N» y «Editar» es un enlace de verdad (se puede abrir en otra
  pestaña). La de Cortes IA sigue siendo clicable entera, con un enlace
  estirado («Sacar mis cortes»).
- **Sondeo:** la vieja preguntaba cada 10 s y se paraba en el primer fallo de
  red. La nueva usa la escalera 5-5-5-10-10-20 s y sigue sola sin red
  mientras la corrida está viva (M19).
- **Saldo:** al terminar la corrida se refresca la píldora; si falló o no
  encontró relleno, hubo devolución. Si la píldora ya sabe que no alcanza, el
  botón se apaga en vez de dejar que el server conteste 402.
- **Etiquetas visibles:** «Nombre del proyecto» y «Archivo de video» ya no
  son solo `aria-label`.
- **Sin servicio de subida y sin `?p=`:** la vieja enseñaba un título solo;
  la nueva dice que la subida corre en el servicio.
- **Sin `trabajos.js`:** el progreso de la subida se ve en la pantalla, no
  en el cuadro de «Tus trabajos».
