# Migración de MIX (UI·8.8)

`static/mix.html` → `/estudio/mix/` (`web/src/pantallas/mix/`).

MIX es publicidad automática: sale una publicación al día, sola. Es la pantalla
con más dinero en juego, porque **cobra la campaña entera al encenderla**
(días × `mix.por_publicacion` de `tarifas.json`, hoy 5) y devuelve por día lo
que no sale. Ver el ejemplo no cobra.

La pantalla no decide ningún número:

| Qué se enseña | De dónde sale |
|---|---|
| «Cada publicación cuesta N créditos» | `tarifa` de `GET /api/mix` |
| «Son N créditos y se te cobran ahora», «Te faltan N» | `costo` de `POST /api/mix/borrador`, que es el mismo `mix.resumen_costo` que cobra `/encender` |
| «Si la apagas ahora te devolvemos N» (el pie y la confirmación) | `devolucion` de `GET /api/mix`, ya topada en lo cobrado |
| «Te devolvimos N» al apagar | `devueltos` de `/api/mix/apagar` |

Si `devolucion` no llega, la frase se dice **sin cifra** («te devolvemos sus
créditos»): nunca se inventa una.

El costo solo aparece cuando hay un **ejemplo vigente**, es decir, cuando la
publicación del día 1 que se vio sigue siendo lo que va a salir. Cambiar el
motivo, el tono, la foto o el día de inicio lo invalida, y sin ejemplo vigente
no hay botón «Encender la campaña». Cambiar la hora o el último día cambia el
costo, pero no el ejemplo.

## Etapas

| Etapa | Qué pasa | Cómo se pasa | Estado |
|---|---|---|---|
| `nueva` | `/estudio/mix/` existe; `/mix.html` sigue igual | este PR | ⏳ al desplegar |
| `todos` | `/mix.html` → 302 a `/estudio/mix/`, salvo la cookie `ui=clasica` | `etapa="todos"` + deploy | pendiente |
| `retirada` | 302 siempre; se borran `static/mix.html` y sus tests viejos | `etapa="retirada"`, `git rm` + deploy | pendiente |

Antes de `todos`, el dueño hace el QA de `docs/QA-UI.md` § MIX. El ejemplo es
gratis. **Encender cobra días × 5 créditos** 💳: la prueba más barata es una
campaña de 1 día (5 créditos), y apagarla antes de que salga devuelve esos 5.
Necesita su «sí» al gasto.

## Los invariantes (tests/test_migracion_ui.py)

Cada ID es el nombre exacto de un test de vitest en
`web/src/pantallas/mix/Mix.test.tsx`.

| ID | Qué garantiza |
|---|---|
| `mix.carga.una_llamada_al_abrir_y_restaura_el_borrador` | Una llamada a `/api/mix` y una a `/cuentas`, aunque StrictMode monte dos veces. Restaura el borrador: motivo, tono, hora, cuenta y foto. El ejemplo ya visto sigue valiendo y no se vuelve a pedir |
| `mix.blotato.sin_clave_el_formulario_no_se_usa_y_lleva_a_conectar` | Sin Blotato, el aviso y el formulario `inert`. Un clic lleva a `/estudio/?blotato=conectar` y no se piden cuentas |
| `mix.cuentas.sin_clave_ofrece_conectar_y_otro_fallo_reintentar` | Un 409 al traer las cuentas ofrece conectar; cualquier otro fallo, Reintentar |
| `mix.cuentas.la_que_ya_no_esta_conectada_se_dice` | La cuenta guardada que ya no está se dice, y el selector queda vacío |
| `mix.foto.tipo_y_tamano_antes_de_subir` | Solo JPG, PNG o WebP de hasta 12 MB, sin llamar a nadie |
| `mix.falta.dice_lo_primero_que_falta_y_no_llama` | Dice lo primero que falta (foto, motivo, fechas, cuenta) con «Ver un ejemplo» apagado, y no llama a nadie |
| `mix.calendario.dos_clics_marcan_el_rango_y_el_tope_no_se_pulsa` | Un clic marca el inicio y otro el fin; un día antes del inicio vuelve a empezar. El pasado no se elige, y lo que pasa de `max_dias` no se pulsa. Los atajos rellenan desde hoy y «Borrar las fechas» limpia |
| `mix.ejemplo.se_pide_se_espera_y_luego_se_ve_el_costo` | Guarda el borrador (con estos campos exactos), pide el ejemplo y espera mirando `GET /api/mix` hasta que el día 1 está en `ejemplo`. Solo entonces aparece el costo, con la cifra del server |
| `mix.ejemplo.cambiar_lo_que_se_ve_lo_invalida_y_la_hora_no` | La hora no invalida el ejemplo. El motivo sí: aparece el aviso y se va «Encender» |
| `mix.ejemplo.si_el_intento_muere_lo_dice_sin_orbe` | `preparando` con `error` se dice sin orbe, y se puede pedir otro |
| `mix.ejemplo.un_4xx_corta_la_espera_y_un_5xx_no` | Sin red o con un 5xx sigue esperando; un 4xx corta la espera con su texto |
| `mix.ejemplo.el_409_recarga_en_vez_de_dejar_un_callejon` | Un 409 al pedir el ejemplo recarga en lugar de dejar un error |
| `mix.ejemplo.al_volver_se_retoma_uno_a_medias_o_se_lee_el_que_murio` | Si quedó uno a medias se retoma la espera (una sola, aunque StrictMode monte dos veces). Si ese intento murió, se lee el error |
| `mix.ejemplo.pedir_otro_retira_el_anterior_y_su_boton` | Pedir otro ejemplo quita el anterior, el costo y «Encender»: mientras tanto `/encender` contestaría 409 |
| `mix.ejemplo.si_la_campana_cambio_se_descarta_sin_error` | La fila desaparece o la campaña se encendió: se descarta, no es un error |
| `mix.cobro.encender_doble_clic_un_cobro_con_su_id` | Dos clics en el mismo tic hacen 1 POST con `{id}`. Luego «Campaña encendida…», refresca el saldo y recarga |
| `mix.cobro.si_no_alcanza_no_se_enciende_y_dice_a_quien_escribir` | Con `alcanza: false`, el botón queda apagado con «Te faltan N créditos» y el texto de `monedero.cta` |
| `mix.cobro.un_402_dice_a_quien_escribir_y_un_409_recarga` | Un 402 muestra su detalle y la CTA; un 409 recarga (lo que la pantalla creía era falso) |
| `mix.cobro.el_saldo_apagado_no_promete_cobro` | Con `saldo: null` (monedero apagado) no dice «se te cobran ahora» |
| `mix.cobro.un_solo_principal_por_vista` | Con el costo a la vista, el único ámbar es «Encender la campaña»; «Ver otro ejemplo» pasa a secundario |
| `mix.viva.estado_proxima_y_cada_dia` | «Publicando… Ya salieron N de M», la próxima, lo pagado y lo devuelto, cada día con su píldora y el error de la red, la devolución del server y ningún botón ámbar |
| `mix.viva.apagar_confirma_con_la_cifra_del_servidor` | La confirmación dice la devolución del server y arranca en «No, dejarla». Decir no no llama; decir sí manda `{confirmar:true}` y avisa lo devuelto |
| `mix.viva.sin_cifra_del_servidor_no_se_inventa_una` | Sin `devolucion`, la frase va sin cifra; con 0, «apagarla no devuelve nada» |
| `mix.viva.pausada_dice_por_que_y_se_reanuda` | En pausa dice el porqué (`nota`); «Reanudar» manda `{id}` |
| `mix.viva.con_un_dia_en_marcha_mira_cada_minuto_solo_a_la_vista` | Con un día `corriendo` recarga cada 60 s, y deja de mirar con la pestaña oculta |
| `mix.viva.al_volver_a_la_pestana_recarga_la_encendida_y_no_el_borrador` | Al volver a la pestaña recarga la campaña encendida. El borrador no: se perdería lo escrito sin guardar |
| `mix.ultima.dice_como_acabo_la_anterior` | «Apagaste tu campaña / Tu campaña terminó: salieron N de M días. Te devolvimos…» |
| `mix.carga.fallo_avisa_con_reintentar` | Sin red: el aviso en español con Reintentar |
| `mix.textos.del_servidor_como_texto` | Motivo, cuenta y textos con HTML se leen como texto. Una imagen `javascript:` no se pinta. Un estado o tono «constructor» no pinta una función |
| `mix.marco.enlace_estudio_sin_version_anterior` | «← Estudio», sin «Usar la versión anterior» (se quitó el 28-sep; `/ui/clasica` sigue a mano) |

## Cada aserción vieja y su destino

Al pasar a `retirada` se borran (o se recortan) estos tests junto con
`static/mix.html`. Los que prueban el server **se quedan**:
`test_m23_mix.py`, `test_m23_mix_ejemplo.py`, `test_m23_mix_reloj.py` y
`test_m23_imagenes.py::test_las_imagenes_de_mix_se_sirven`.

### tests/test_m23_mix_ejemplo_ui.py

| Test viejo | Destino |
|---|---|
| `test_la_pantalla_ya_no_espera_el_ejemplo_en_la_respuesta_del_post`, `test_la_pantalla_consulta_hasta_que_el_dia_uno_esta_listo` | `mix.ejemplo.se_pide_se_espera_y_luego_se_ve_el_costo` y `mix.ejemplo.si_la_campana_cambio_se_descarta_sin_error` (cada GET lleva `AbortSignal.timeout(20000)`) |
| `test_la_pantalla_retoma_un_ejemplo_a_medias_al_volver`, `test_un_intento_muerto_se_lee_al_volver_a_la_pantalla` | `mix.ejemplo.al_volver_se_retoma_uno_a_medias_o_se_lee_el_que_murio` |
| `test_el_409_de_pedir_otro_ejemplo_no_deja_un_callejon` | `mix.ejemplo.el_409_recarga_en_vez_de_dejar_un_callejon` |
| `test_el_sondeo_se_va_frenando`, `test_el_orbe_avisa_antes_de_que_la_pantalla_se_rinda` | `PASOS_MS`, `AVISO_MS` y `TOPE_MS` de `logica.ts` (los mismos valores) |
| `test_pedir_otro_ejemplo_retira_el_anterior_de_la_pantalla` | `mix.ejemplo.pedir_otro_retira_el_anterior_y_su_boton` |
| `test_los_errores_de_la_espera_llevan_status`, `test_un_tropiezo_del_servidor_no_cancela_la_espera` | `mix.ejemplo.un_4xx_corta_la_espera_y_un_5xx_no` y `mix.ejemplo.si_el_intento_muere_lo_dice_sin_orbe` |
| `test_la_espera_ya_no_promete_veinte_segundos` | el texto «Preparando tu ejemplo · hasta 2 min» (`mix.ejemplo.se_pide_se_espera_y_luego_se_ve_el_costo`) |

### tests/test_ui14_mix.py (la carta de diseño en la vieja)

| Test viejo | Destino |
|---|---|
| `test_carga_la_carta_y_los_iconos`, `test_titulos_en_bricolage_y_texto_en_geist`, `test_sin_tamanos_de_letra_fuera_de_la_escala`, `test_enlaces_en_azul_claro_y_campos_de_la_carta`, `test_sin_sepia_y_sin_foco_propio` | `tokens.css`, `<Marco>` y los guardianes sobre `web/` |
| `test_los_numeros_que_cambian_no_bailan` | `tabular-nums` en los días del calendario |
| `test_sin_glifos_como_iconos`, `test_los_iconos_que_usa_mix_existen` | `<Icono>` y TypeScript (`NombreIcono`) |
| `test_las_flechas_del_mes_dicen_que_son` | `Calendario.tsx`: «Mes anterior» y «Mes siguiente» (`mix.calendario.dos_clics_marcan_el_rango_y_el_tope_no_se_pulsa` las usa) |
| `test_botones_con_los_niveles_de_la_carta`, `test_un_solo_principal_por_vista`, `test_encender_sigue_diciendo_lo_mismo` | `mix.cobro.un_solo_principal_por_vista` y `mix.viva.estado_proxima_y_cada_dia`. Apagar sigue siendo `peligro` |
| `test_elegir_no_es_ambar` | el tono y el rango se marcan en blanco y gris (`border-texto`, `bg-texto`, `bg-elevada`) |
| `test_lo_que_se_toca_mide_44` | los días miden 44 px de alto (`h-11`) y las flechas, los atajos y los selects, 40–44 px (`denso` / `min-h-11`) |
| `test_la_pildora_no_tapa_el_contenido` | `<Marco>` (`pt-16`) |

### tests/test_ui16_mix.py (el cuadro de avisos de trabajos.js)

| Test viejo | Destino |
|---|---|
| `test_la_caja_de_error_y_la_linea_de_estado_ya_no_existen`, `test_el_aviso_de_pagina_va_al_cuadro_con_su_clave`, `test_cada_llamador_de_mxaviso_esta_clasificado`, `test_siempre_con_encadenamiento_opcional`, `test_en_node_los_avisos_llegan_con_su_clave` | sin destino literal: la nueva no carga `trabajos.js` y los avisos van en la pantalla (`<Aviso>`). Lo que prometían queda en `mix.carga.fallo_avisa_con_reintentar`, `mix.cuentas.sin_clave_ofrece_conectar_y_otro_fallo_reintentar` y `mix.falta.dice_lo_primero_que_falta_y_no_llama` (lo que falta va junto al botón) |
| `test_la_carga_fallida_ofrece_reintentar` | `mix.carga.fallo_avisa_con_reintentar` |
| `test_las_confirmaciones_van_como_ok`, `test_los_avisos_del_ejemplo_son_info_de_ocho_segundos` | `mix.cobro.encender_doble_clic_un_cobro_con_su_id`, `mix.viva.apagar_confirma_con_la_cifra_del_servidor`, `mix.viva.pausada_dice_por_que_y_se_reanuda` y los avisos del ejemplo en `Mix.tsx` |
| `test_confirm_de_apagar_sigue` | `mix.viva.apagar_confirma_con_la_cifra_del_servidor` (`<Confirmar>` en vez de `confirm()`) |

### Otros módulos que miran MIX

| Aserción vieja | Destino |
|---|---|
| `test_ui_escapar.py::test_se_encontraron_las_esc` | `mix.textos.del_servidor_como_texto` (React escapa); al retirar, `static/mix.html` sale de la lista |
| `test_ui14_todas.py`, `test_ui15_trabajos.py` (PANTALLAS) | al retirar, `mix` sale de las listas |
| `test_m4_recarga_cerrada.py` (`CON_BOTON`) | `mix.cobro.si_no_alcanza_no_se_enciende_y_dice_a_quien_escribir` con `<Recarga>`; `test_web_solo_ofrece_recargar_desde_recarga_tsx` ya vigila `web/` |
| `test_m25_entrada.py`, `Inicio.test.tsx` (el menú enlaza `/mix.html`) | se quedan: el 302 hace el resto |

## Diferencias a propósito

- **Al volver a la pestaña ya no se rearma un borrador.** La vieja recargaba
  también el formulario a medias y perdía el motivo sin guardar y la foto
  elegida. Ahora solo se recarga la campaña encendida, que es la que cambia
  sola.
- **Se quitó «Te quedarían N».** Era la única resta de créditos que hacía la
  pantalla (saldo − costo). El saldo está en la píldora de arriba.
- **Días `cancelada`** tienen su píldora («Cancelada»); en la vieja salían
  como «Pendiente».
- **`<Confirmar>` en vez de `confirm()`** para apagar: arranca en «No,
  dejarla» y dice la misma frase de devolución que el pie.
- **Las fechas van en español** (`es-MX`) y en la zona del navegador; el ISO
  se arma a mano, como antes.
- **Sin `trabajos.js`:** los avisos van en la pantalla.
