# Migración de estilos (UI·8.2)

`static/estilos.html` → `/estudio/estilos/` (`web/src/pantallas/estilos/`).

La copiadora de estilos cobra una cosa, «Analizar ✦ N». La tarifa llega en
el listado (`GET /api/estilo` → `creditos`, de `tarifas.json` §estilos).

## El arreglo de dinero que trae

En la vieja, `cargar()` (estilos.html:157) volvía a poner
`btn-analizar.disabled = false` en **cada vuelta del sondeo**. Con un análisis
vivo, el sondeo corre cada 5 s. Si el POST de «Analizar» tardaba más que eso,
el botón se volvía a encender con el cobro todavía en vuelo, y un segundo clic
cobraba otra vez. En la nueva el candado es el de `<BotonCobro>`, y el sondeo
no lo toca: `estilos.cobro.el_sondeo_no_reabre_el_boton_con_el_cobro_en_vuelo`.

## Etapas

| Etapa | Qué pasa | Estado |
|---|---|---|
| `nueva` | `/estudio/estilos/` existe; `/estilos.html` sigue igual | ⏳ al desplegar |
| `todos` | `/estilos.html` → 302 a `/estudio/estilos/`, salvo la cookie `ui=clasica` | pendiente |
| `retirada` | 302 siempre; se borran `static/estilos.html` y sus tests viejos | pendiente |

Antes de `todos`: un análisis de verdad en `/estudio/estilos/` y el QA de
`docs/QA-UI.md` § estilos. 💳 Cobra la tarifa de `tarifas.json` §estilos.

## Los invariantes (tests/test_migracion_ui.py)

En `web/src/pantallas/estilos/Estilos.test.tsx`, con ese nombre exacto.

| ID | Qué garantiza |
|---|---|
| `estilos.cobro.precio_del_servidor_en_el_boton` | «Analizar ✦ N» con la tarifa del listado (el test usa una falsa a propósito) |
| `estilos.cobro.doble_clic_un_solo_post` | doble clic = 1 POST, con la liga en el cuerpo |
| `estilos.cobro.el_sondeo_no_reabre_el_boton_con_el_cobro_en_vuelo` | el arreglo de arriba |
| `estilos.cobro.sin_liga_no_cobra` | «Pega la liga primero.» y ningún POST |
| `estilos.cobro.error_junto_al_boton` | el error del server (409) junto al botón; la liga se queda |
| `estilos.cobro.sin_saldo_con_la_recarga_cerrada_dice_a_quien_escribir` | 402 con la recarga cerrada: el texto de `monedero.cta`, nunca un botón muerto |
| `estilos.cobro.limpia_y_refresca_el_saldo_tras_cobrar` | tras cobrar: campo vacío y `monedero.refrescar()` |
| `estilos.lista.perfil_listo_con_sus_campos` | @autor, «plataforma · N s · N cortes/min», los cinco campos y el prompt |
| `estilos.lista.solo_colores_de_verdad_entran_al_style` | un «hex» que no es un color no llega al `style` |
| `estilos.lista.textos_del_server_como_texto` | un autor con HTML se lee como texto |
| `estilos.lista.error_dice_que_los_creditos_volvieron` | «El análisis falló (…) — tus créditos se devolvieron.» |
| `estilos.lista.copiar_el_prompt_y_su_fallo` | «Copiar» copia el prompt y avisa; sin portapapeles, dice que se copie a mano |
| `estilos.lista.sondea_mientras_analiza_y_para_al_terminar` | sondea mientras hay un análisis, para al terminar y refresca el saldo |
| `estilos.lista.sin_red_con_un_analisis_vivo_sigue_reintentando` | sin red con un análisis vivo: «reintentando…», la tarjeta sigue y el sondeo no muere (M19) |
| `estilos.lista.fallo_de_carga_avisa_y_reintenta` | sin red y nada vivo: aviso con Reintentar, sin «Cargando…» colgado |
| `estilos.espera.titulo_de_la_pestana_dice_analizando` | «Analizando el estilo · …» en la pestaña |
| `estilos.marco.enlaces_estudio_y_version_anterior` | «← Estudio» y «Usar la versión anterior» (`/ui/clasica?pantalla=estilos`) |

## Cada aserción vieja y su destino

### tests/test_ui14_estilos.py

| Test viejo | Destino |
|---|---|
| `test_carga_la_carta_y_los_iconos` | `tokens.css` y `ui/iconos.ts` |
| `test_titulos_en_bricolage_y_texto_en_geist` | `tokens.css`; `h1` del `Marco` en `font-titulo` |
| `test_sin_tamanos_de_letra_fuera_de_la_escala` | la escala de Tailwind borrada en `tokens.css` |
| `test_sin_emojis_como_iconos` | guardianes M19/M21 sobre `web/` |
| `test_los_iconos_que_usa_existen` | TypeScript: `NombreIcono` |
| `test_un_solo_principal_y_es_el_que_cobra` | `<BotonCobro verbo="Analizar">` es el único principal |
| `test_sin_filtro_sepia` | guardián M20 sobre `web/` |
| `test_enlaces_campos_y_tarjetas_de_la_carta` | `Marco` (`text-enlace`), campo `border-campo`, `<Tarjeta>` |
| `test_lo_que_se_toca_mide_44` | campo `min-h-11`, botones de `<Boton>` (48/40 px) |
| `test_sin_colores_sueltos` | guardián M20; la paleta del perfil pasa por `colorSeguro` |
| `test_la_pildora_no_tapa_nada` | el `Marco` empieza a 64 px |

### tests/test_ui16_estilos.py

| Test viejo | Destino |
|---|---|
| `test_el_banner_local_de_sin_red_ya_no_existe` | sin destino: la nueva no tiene banner propio; el aviso va en la lista |
| `test_sin_red_va_al_cuadro_con_la_clave_red` | `estilos.lista.sin_red_con_un_analisis_vivo_sigue_reintentando` (el aviso va dentro de la lista: la nueva no carga `trabajos.js`) |
| `test_el_fallo_de_carga_va_al_cuadro_con_reintentar` | `estilos.lista.fallo_de_carga_avisa_y_reintenta` |
| `test_copiar_por_delegacion_y_aviso_ok` | `estilos.lista.copiar_el_prompt_y_su_fallo` |
| `test_todas_las_llamadas_usan_encadenamiento_opcional` | sin destino: la nueva no llama a `window.avisos` |
| `test_la_validacion_y_el_402_siguen_junto_al_boton` | `estilos.cobro.sin_liga_no_cobra` y `estilos.cobro.sin_saldo_con_la_recarga_cerrada_dice_a_quien_escribir` |

### Otros módulos que miran estilos.html

| Aserción vieja | Destino |
|---|---|
| `test_m4_recarga_cerrada.py` (`estilos.html` en `CON_BOTON`) | `test_web_solo_ofrece_recargar_desde_recarga_tsx` (nuevo, mismo módulo). Al retirar, `estilos.html` sale de `CON_BOTON` |
| `test_m19_orbe.py` (estilos en `PAGINAS_FASE3`: sobrevive a un poll fallido) | `estilos.lista.sin_red_con_un_analisis_vivo_sigue_reintentando` |
| `test_m21_botones.py`, `test_ui_escapar.py`, `test_m23_blotato_clave_ui.py`, `test_m25_entrada.py` | se quita `estilos.html` de sus listas al retirar; su intención la cubren `<BotonCobro>` (M21), React (escape) y el menú del inicio, que sigue enlazando `/estilos.html` y el 302 hace el resto |

## Diferencias a propósito

- El candado del cobro es de `<BotonCobro>` (el arreglo de arriba).
- El sondeo usa la escalera 5-5-5-10-10-20 s; al terminar un análisis se
  refresca el saldo (por si hubo devolución).
- La paleta se pinta proporcional al `pct` de cada color.
