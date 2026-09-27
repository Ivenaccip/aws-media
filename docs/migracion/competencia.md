# Migración de competencia (UI·8.2)

`static/competencia.html` → `/estudio/competencia/` (`web/src/pantallas/competencia/`).

Guardar y quitar cuentas es gratis. «Revisar ✦ N» cobra la tarifa por cuenta
(`GET /api/competencia` → `credito_por_cuenta`, de `tarifas.json`
§competencia) por cada cuenta vigilada (`pipeline/creditos.py:
costo_competencia`, lineal).

## Etapas

| Etapa | Qué pasa | Estado |
|---|---|---|
| `nueva` | `/estudio/competencia/` existe; `/competencia.html` sigue igual | ⏳ al desplegar |
| `todos` | `/competencia.html` → 302, salvo la cookie `ui=clasica` | pendiente |
| `retirada` | 302 siempre; se borran `static/competencia.html` y sus tests viejos | pendiente |

Antes de `todos`: una revisión de verdad con una cuenta y el QA de
`docs/QA-UI.md` § competencia. 💳 Cobra la tarifa por cuenta de `tarifas.json`.

## Los invariantes (tests/test_migracion_ui.py)

En `web/src/pantallas/competencia/Competencia.test.tsx`, con ese nombre exacto.

| ID | Qué garantiza |
|---|---|
| `competencia.cobro.precio_por_cuenta_del_servidor` | «Revisar ✦ tarifa × cuentas» y la nota «N créditos por cuenta · n de max» |
| `competencia.cobro.sin_cuentas_no_se_puede_revisar` | sin cuentas, «Revisar» apagado y el primer paso dicho |
| `competencia.cobro.doble_clic_un_solo_post` | doble clic = 1 POST; tras cobrar, `monedero.refrescar()` |
| `competencia.cobro.el_error_va_junto_a_revisar` | el 409 («ya hay una revisión en marcha») junto al botón |
| `competencia.cobro.sin_saldo_402_con_la_recarga_abierta_ofrece_recargar` | 402 con la recarga abierta: «Recargar» abre el panel |
| `competencia.cuentas.agregar_es_gratis_y_limpia_el_campo` | agregar manda la liga, no cobra y limpia el campo |
| `competencia.cuentas.sin_liga_o_con_error_lo_dice_junto_al_campo` | validación y error del server junto al campo de la liga |
| `competencia.cuentas.quitar_y_su_fallo_con_reintentar` | quitar que falla avisa con Reintentar; al salir bien, el precio baja |
| `competencia.informe.resumen_ver_y_cerrar` | «N publicaciones · N créditos (N devueltos)», Ver/Cerrar, y abrirlo otra vez no lo vuelve a pedir |
| `competencia.informe.lectura_fallidas_y_devueltos` | lo que no se pudo traer con los créditos devueltos; los patrones cuentan solo publicaciones que existen; la advertencia en su caja |
| `competencia.informe.numeros_honestos` | «—» para lo que no vino y 0 para el cero; duración en su escala; «N× lo normal» en verde desde 1.3; texto cortado a 180 |
| `competencia.informe.textos_y_ligas_de_terceros_seguros` | texto de la red como texto; una liga que no es http(s) no se enlaza; `noopener` |
| `competencia.informe.fallo_al_abrir_avisa_y_reintenta` | abrir que falla avisa y Reintentar lo abre (no queda un informe vacío) |
| `competencia.informe.error_dice_que_los_creditos_volvieron` | «La revisión falló (…) — tus créditos se devolvieron.» |
| `competencia.lista.sondea_mientras_revisa_y_para_al_terminar` | sondea mientras hay una revisión, para al terminar y refresca el saldo |
| `competencia.lista.sin_red_con_una_revision_viva_sigue_reintentando` | sin red con una revisión viva: «reintentando…» y el sondeo no muere |
| `competencia.lista.fallo_de_carga_avisa_y_reintenta` | sin red y nada vivo: aviso con Reintentar, sin «Cargando…» colgado |
| `competencia.espera.titulo_de_la_pestana_dice_revisando` | «Revisando a la competencia · …» en la pestaña |
| `competencia.marco.enlaces_estudio_y_version_anterior` | «Usar la versión anterior» (`/ui/clasica?pantalla=competencia`) |

## Cada aserción vieja y su destino

### tests/test_m23_competencia_ui.py

| Test viejo | Destino |
|---|---|
| `test_la_pantalla_arranca_despues_de_auth` | `estudio/competencia/index.html` carga `/auth.js` antes del módulo (`test_migracion_ui.py::test_la_pantalla_nueva_tiene_su_pagina`) |
| `test_el_menu_del_estudio_enlaza_la_pantalla` | se queda: el menú sigue enlazando `/competencia.html` y el 302 hace el resto |
| `test_no_hay_sondeo_ciego` | `competencia.lista.sondea_mientras_revisa_y_para_al_terminar` + `sondeo.ts` (se duerme con la pestaña oculta) |
| `test_el_boton_dice_el_precio_antes_de_cobrar` | `competencia.cobro.precio_por_cuenta_del_servidor` |
| `test_esc_escapa_los_cinco` | React; `competencia.informe.textos_y_ligas_de_terceros_seguros` |
| `test_una_liga_que_no_es_http_no_se_pinta` | `competencia.informe.textos_y_ligas_de_terceros_seguros` |
| `test_un_contador_que_no_llego_es_un_hueco_y_no_un_cero` | `competencia.informe.numeros_honestos` |
| `test_la_duracion_se_lee_en_su_escala` | `competencia.informe.numeros_honestos` |
| `test_el_indice_se_lee_como_lo_que_es` | `competencia.informe.numeros_honestos` |
| `test_el_texto_de_otro_no_puede_inyectar` | `competencia.informe.textos_y_ligas_de_terceros_seguros` |
| `test_sin_patron_lo_dice_en_vez_de_rellenar` | `LecturaInforme` («No hay un patrón que estos datos sostengan.»); `competencia.informe.lectura_fallidas_y_devueltos` cubre la lectura |
| `test_lo_que_no_se_pudo_traer_se_dice_con_los_creditos` | `competencia.informe.lectura_fallidas_y_devueltos` |
| `test_al_cargar_pide_una_sola_vez` | `useListaViva`: una carga al montar y luego solo el sondeo |
| `test_el_boton_enseña_el_precio_de_las_cuentas_que_hay` | `competencia.cobro.precio_por_cuenta_del_servidor` y `competencia.cuentas.quitar_y_su_fallo_con_reintentar` |

### tests/test_ui14_competencia.py

| Test viejo | Destino |
|---|---|
| `test_carga_la_carta_y_los_iconos`, `test_las_variables_locales_son_tokens_de_la_carta` | `tokens.css` y `ui/iconos.ts` |
| `test_titulos_en_bricolage_y_texto_en_geist`, `test_sin_tamanos_de_letra_fuera_de_la_escala` | `tokens.css` |
| `test_sin_emojis_como_iconos`, `test_los_iconos_que_usa_existen` | guardianes sobre `web/` y `NombreIcono` |
| `test_un_solo_principal_y_es_el_que_cobra` | `<BotonCobro verbo="Revisar">` es el único principal; Agregar es secundario y Quitar es de peligro |
| `test_el_ambar_solo_dice_haz_algo` | «N× lo normal» alto va en verde (estado), nunca en ámbar |
| `test_enlaces_campos_y_tarjetas`, `test_lo_que_se_toca_mide_44` | `Marco`, campo `min-h-11`, «Ver» externo `min-h-11`, `<Boton>` |
| `test_no_queda_debajo_de_la_pildora` | el `Marco` empieza a 64 px |
| `test_el_foco_es_el_de_la_carta` | el foco ámbar global de `tokens.css` |

### tests/test_ui16_competencia.py

| Test viejo | Destino |
|---|---|
| `test_el_banner_local_de_sin_red_ya_no_existe`, `test_todas_las_llamadas_usan_encadenamiento_opcional` | sin destino: la nueva no usa banner propio ni `window.avisos` |
| `test_sin_red_va_al_cuadro_con_la_clave_red` | `competencia.lista.sin_red_con_una_revision_viva_sigue_reintentando` |
| `test_el_fallo_de_carga_va_al_cuadro_con_reintentar`, `test_fallo_de_carga_no_pinta_el_error_y_reintentar_lo_arregla` | `competencia.lista.fallo_de_carga_avisa_y_reintenta` |
| `test_abrir_un_informe_ya_no_calla`, `test_abrir_que_falla_avisa_y_no_deja_un_informe_vacio`, `test_reintentar_abrir_no_cierra_un_informe_ya_abierto` | `competencia.informe.fallo_al_abrir_avisa_y_reintenta` |
| `test_quitar_una_cuenta_avisa_en_el_cuadro_y_no_en_el_campo`, `test_quitar_que_luego_sale_bien_quita_el_aviso` | `competencia.cuentas.quitar_y_su_fallo_con_reintentar` |
| `test_la_validacion_y_el_402_siguen_en_su_sitio` | `competencia.cuentas.sin_liga_o_con_error_lo_dice_junto_al_campo`, `competencia.cobro.el_error_va_junto_a_revisar` y `competencia.cobro.sin_saldo_402_con_la_recarga_abierta_ofrece_recargar` |

### Otros módulos que miran competencia.html

| Aserción vieja | Destino |
|---|---|
| `test_m4_recarga_cerrada.py` (`CON_BOTON`) | `test_web_solo_ofrece_recargar_desde_recarga_tsx`; al retirar sale de `CON_BOTON` |
| `test_m21_botones.py`, `test_ui_escapar.py`, `test_m23_blotato_clave_ui.py`, `test_m25_entrada.py` | se quita `competencia.html` de sus listas al retirar |

## Diferencias a propósito

- Las fechas van siempre en español (`es-MX`); la vieja usaba el idioma del
  navegador y en uno en inglés decía «September 25».
- Abrir un informe ya abierto antes no lo vuelve a pedir (se guarda en la tarjeta).
- El sondeo usa la escalera 5-5-5-10-10-20 s; al terminar una revisión se
  refresca el saldo (por si hubo devolución).
