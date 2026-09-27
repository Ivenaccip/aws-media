# Migración de shorts (UI·8.5)

`static/shorts.html` → `/estudio/shorts/` (`web/src/pantallas/shorts/`).

Es la primera pantalla migrada que cobra **tres** cosas, cada una con su
`<BotonCobro>`. Los tres precios salen del server:

| Botón | De dónde sale el precio |
|---|---|
| «Importar ✦ N» | la cotización de `/api/shorts/importar/cotizar` |
| «Analizar ✦ N» / «Re-analizar ✦ N» | `creditos_analizar` de `/api/shorts/<p>/costo` |
| «Renderizar ✦ N» | `creditos_por_short` × los shorts marcados |

La vieja caía a un `2` escrito a mano si faltaba `creditos_por_short`. La
nueva no: sin precio del server no hay botón.

La subida ya no es una copia: `marca/SubirVideo.tsx` y `nucleo/subida.ts`
son los mismos que usa editar metraje (`/estudio/subir/`).

## Etapas

| Etapa | Qué pasa | Cómo se pasa | Estado |
|---|---|---|---|
| `nueva` | `/estudio/shorts/` existe; `/shorts.html` sigue igual | este PR | ⏳ al desplegar |
| `todos` | `/shorts.html?p=…` → 302 a `/estudio/shorts/?p=…`, salvo la cookie `ui=clasica` | `etapa="todos"` + deploy | pendiente |
| `retirada` | 302 siempre; se borran `static/shorts.html` y sus tests viejos | `etapa="retirada"`, `git rm` + deploy | pendiente |

Antes de `todos`, el dueño hace una corrida de verdad en `/estudio/shorts/`
y el QA manual de `docs/QA-UI.md` § shorts. La corrida es:

1. **Importar** un video corto de YouTube.
2. **Analizarlo.**
3. **Renderizar un short.**

Cada paso cobra 💳 según `tarifas.json` §shorts, y la corrida necesita su
«sí» al gasto:

- importar: `importar_por_min` = 2 por minuto;
- analizar: `analisis` = 2, más `transcripcion_por_5min` = 2 por cada
  5 min si no trae transcript;
- renderizar: `render_por_short` = 2 por short.

Los enlaces que apuntan a `/shorts.html` no se tocan: el menú y los caminos
del inicio, «Cortes IA» de editar metraje y «Tus trabajos». En `todos` los
lleva el 302, que conserva el query.

## Los invariantes (tests/test_migracion_ui.py)

Cada uno es un test de vitest en `web/src/pantallas/shorts/Shorts.test.tsx`
con ese nombre exacto.

| ID | Qué garantiza |
|---|---|
| `shorts.cobro.analizar_con_el_precio_del_servidor` | «Analizar ✦ N» con el precio de `/costo`, y la duración con si trae transcript (el test usa una tarifa falsa a propósito) |
| `shorts.cobro.analizar_doble_clic_un_solo_post` | doble clic en Analizar = 1 POST |
| `shorts.cobro.el_sondeo_no_reabre_analizar_con_el_cobro_en_vuelo` | **arreglo de dinero:** con un render corriendo hay sondeo, y la vieja volvía a encender «Re-analizar» en cada vuelta aunque su cobro siguiera en vuelo. Ahora el candado es el de `BotonCobro` |
| `shorts.cobro.sin_backend_listo_analizar_apagado_con_el_aviso` | sin `backend_listo`, el botón se apaga y se dice por qué (M22) |
| `shorts.cobro.sin_precio_no_hay_boton_de_analizar` | si `/costo` falla, el error y ningún botón que cobre (nube sin preview = bug) |
| `shorts.analisis.orbe_solo_en_el_analisis` | el orbe solo mientras analiza; el render (y la descarga) llevan un indicador de espera sin orbe (M19) |
| `shorts.analisis.error_dice_que_los_creditos_volvieron_sin_orbe` | el análisis fallido lo dice, sin orbe, y se puede volver a analizar |
| `shorts.cobro.renderizar_n_por_el_precio_del_servidor` | los tres mejores marcados de entrada; «Renderizar ✦ n × precio»; sin ninguno, apagado y «Marca al menos un candidato.» |
| `shorts.cobro.renderizar_sin_precio_del_servidor_no_cobra` | sin `creditos_por_short` no hay botón que cobre (la vieja ponía 2) |
| `shorts.cobro.renderizar_manda_lo_elegido_y_ajustado` | el POST lleva solo los marcados, con inicio, fin y ganchos ajustados, y el estilo, la plataforma y el contenido |
| `shorts.cobro.renderizar_doble_clic_un_solo_post` | doble clic en Renderizar = 1 POST |
| `shorts.cobro.tiempos_fuera_de_rango_no_cobran` | **nuevo:** un short de menos de 5 s o más de 90 s se marca junto al campo y no se cobra (antes llegaba al server y volvía con un 400) |
| `shorts.cobro.mas_de_diez_no_cobra` | **nuevo:** más de 10 marcados no se cobra y se dice el máximo |
| `shorts.cobro.sin_saldo_con_la_recarga_cerrada_dice_a_quien_escribir` | un 402 enseña su detalle y el texto de `monedero.cta`, sin un «Recargar» muerto |
| `shorts.cobro.saldo_conocido_que_no_alcanza_no_cobra` | si la píldora sabe que no alcanza, el botón se apaga y dice cuánto falta |
| `shorts.cobro.refresca_el_saldo_tras_cobrar_y_al_terminar` | refresca la píldora al cobrar y otra vez al terminar (puede haber devolución) |
| `shorts.candidatos.lo_elegido_sobrevive_al_sondeo` | **arreglo:** la vieja repintaba la lista de candidatos en cada vuelta del sondeo y borraba lo marcado y ajustado |
| `shorts.cobro.importar_cotiza_antes_de_cobrar` | sin cotizar no hay «Importar»; la cotización dice título y duración |
| `shorts.cobro.cambiar_la_liga_anula_la_cotizacion` | **arreglo de dinero:** la vieja cobraba la liga que hubiera en el campo aunque la cotización fuera de otra. Ahora cambiarla borra la cotización |
| `shorts.cobro.importar_doble_clic_un_solo_post` | doble clic en Importar = 1 POST, con la liga cotizada |
| `shorts.cobro.importado_abre_el_proyecto` | al importar, `?p=<nombre>` y la descarga en curso; refresca el saldo |
| `shorts.cobro.importar_409_abre_el_que_ya_existe` | «ya importado» abre el proyecto que existe en vez de un error |
| `shorts.importacion.descargando_sin_orbe_y_sin_la_liga` | «Trayendo «título» de YouTube» (el título como texto), sin orbe, sin la sección de la liga ni el análisis; la pestaña lo dice |
| `shorts.importacion.fallida_dice_que_los_creditos_volvieron` | la importación fallida lo dice y ofrece intentarlo de nuevo |
| `shorts.cobro.un_solo_principal_por_vista` | sin proyecto, Importar; con proyecto, Analizar; con candidatos, Renderizar (Re-analizar e Importar pasan a secundario) |
| `shorts.eleccion.lista_los_proyectos_con_metraje` | sin `?p=`, los proyectos con metraje (subidas o película) como enlaces `?p=` |
| `shorts.eleccion.sin_red_no_dice_que_no_tienes_videos` | un fallo avisa con Reintentar y nunca dice «no tienes videos»; la lista vacía sí lo dice (UI·16) |
| `shorts.carga.fallo_avisa_con_reintentar` | sin red, un mensaje genérico; con 404, el detalle del server; Reintentar lo abre (UI·16) |
| `shorts.render.corriendo_sondea_y_al_terminar_muestra_las_salidas` | sondea mientras renderiza, para al terminar y enseña las salidas; la pestaña dice «Renderizando» y luego «✓ Shorts listos» |
| `shorts.render.error_dice_que_los_creditos_volvieron` | el render fallido lo dice con el log recortado y se puede volver a intentar |
| `shorts.salidas.descargar_por_el_servicio_y_ver_solo_http` | Descargar pasa por `/api/media/descarga` (con la key del render o sacada de la URL del CDN, M22 · D); «Ver» solo con http(s), en otra pestaña y `noopener` |
| `shorts.salidas.textos_del_server_como_texto` | los textos de los candidatos se leen como texto |
| `shorts.espera.sin_red_con_algo_vivo_sigue_reintentando` | sin red con algo corriendo: «Sin conexión — reintentando…» y sigue solo |
| `shorts.espera.titulo_de_la_pestana` | la pestaña dice «Analizando tu video» y «✓ Análisis listo» |
| `shorts.subida.sube_y_abre_el_proyecto` | subir propone el nombre desde el archivo, no es el principal y al terminar abre el proyecto |
| `shorts.marco.enlaces_estudio_y_version_anterior` | «← Estudio», «Usar la versión anterior» (`/ui/clasica?pantalla=shorts`) y «Shorts · <proyecto>» |

## Cada aserción vieja y su destino

Al pasar a `retirada` se borran (o se recortan) estos tests junto con
`static/shorts.html`.

### tests/test_ui14_shorts.py (la carta de diseño en la vieja)

| Test viejo | Destino |
|---|---|
| `test_carga_la_carta_y_los_iconos` | `tokens.css` y `ui/iconos.ts` |
| `test_titulos_en_bricolage_y_texto_en_geist` | `tokens.css`; `h1`/`h2` en `font-titulo` |
| `test_sin_tamanos_de_letra_fuera_de_la_escala` | `tokens.css` borra la escala de Tailwind |
| `test_sin_emojis_como_iconos` | guardianes M19/M21 sobre `web/` e `<Icono>` |
| `test_los_iconos_que_usa_shorts_existen` | TypeScript: `NombreIcono` |
| `test_botones_con_los_niveles_de_la_carta` | `<Boton>` y `<BotonCobro nivel>`; Subir y Cotizar son `secundario` |
| `test_un_solo_principal_por_vista` | `shorts.cobro.un_solo_principal_por_vista` |
| `test_los_botones_que_cobran_siguen_igual` | `shorts.cobro.analizar_con_el_precio_del_servidor`, `shorts.cobro.renderizar_n_por_el_precio_del_servidor`, `shorts.cobro.importar_cotiza_antes_de_cobrar` y `shorts.cobro.renderizar_sin_precio_del_servidor_no_cobra` (el «2 si falta» se fue a propósito) |
| `test_elegir_no_es_ambar` | la casilla usa `accent-texto` y el candidato no marcado baja de opacidad; nada en ámbar |
| `test_enlaces_y_campos_de_la_carta` | `text-enlace` del `Marco`; campos y selects con `border-campo bg-elevada rounded-medio` |
| `test_lo_que_se_toca_mide_44` | enlaces de proyecto y de salida `min-h-11`; enlaces del `Marco` `min-h-11` |
| `test_sin_filtro_sepia_ni_foco_propio` | el foco es el de `tokens.css` |
| `test_en_celular_nada_queda_bajo_la_pildora` | el `Marco` empieza a 64 px (`pt-16`) |
| `test_hidden_sigue_escondiendo_los_botones` | en React un botón que no toca no se pinta |

### tests/test_ui16_shorts.py (los avisos)

| Test viejo | Destino |
|---|---|
| `test_cargar_ya_no_pinta_el_error_en_el_aviso` | `shorts.carga.fallo_avisa_con_reintentar` (el aviso va en la pantalla, no en el cuadro de `trabajos.js`) |
| `test_los_otros_usos_de_aviso_siguen` | `shorts.importacion.descargando_sin_orbe_y_sin_la_liga` e `shorts.importacion.fallida_dice_que_los_creditos_volvieron` |
| `test_los_errores_junto_a_su_boton_se_quedan` | `shorts.cobro.sin_saldo_con_la_recarga_cerrada_dice_a_quien_escribir` y `shorts.cobro.sin_precio_no_hay_boton_de_analizar` |
| `test_sin_red_no_dice_que_no_tienes_videos` | `shorts.eleccion.sin_red_no_dice_que_no_tienes_videos` |
| `test_cargar_un_proyecto_que_falla_avisa_y_reintentar_lo_abre` | `shorts.carga.fallo_avisa_con_reintentar` |

### tests/test_m19_orbe.py

| Aserción vieja | Destino |
|---|---|
| `test_la_pestana_dice_en_que_va[shorts.html]` | `shorts.espera.titulo_de_la_pestana`, `shorts.importacion.descargando_sin_orbe_y_sin_la_liga` y `shorts.render.corriendo_sondea_y_al_terminar_muestra_las_salidas` |
| `test_el_poll_se_duerme_con_la_pestana_oculta[shorts.html]` | `nucleo/sondeo.ts` (`sondeo.test.ts`) |
| `test_sin_orbe_la_pagina_sigue_funcionando[shorts.html]` | `<EsperaIA>`: sin `window.orbe` queda el texto con `role=status` |
| `test_en_shorts_solo_lleva_orbe_el_analisis` | `shorts.analisis.orbe_solo_en_el_analisis` e `shorts.importacion.descargando_sin_orbe_y_sin_la_liga` |
| `test_el_orbe_no_acompana_errores_en_shorts` | `shorts.analisis.error_dice_que_los_creditos_volvieron_sin_orbe` |
| `test_ya_no_hay_enlaces_al_monedero_inexistente` (shorts) | `marca/Recarga.tsx` (`test_m4_recarga_cerrada.py`) |
| favicon, motor GPU, `check_js` (glob) | favicon en `web/estudio/shorts/index.html`; el motor lo carga `orbe.js`; `tsc` y `npm run build` |

### Otros módulos que miran shorts

| Aserción vieja | Destino |
|---|---|
| `test_m21_botones.py` (`Importar`, `Renderizar`, forma, sin «créditos», la misma ✦) | `BotonCobro` impone «Verbo ✦ N» (`Verbo` incluye Importar, Analizar, Re-analizar y Renderizar); lo prueban los `shorts.cobro.*` |
| `test_m21_botones.py::test_shorts_sigue_diciendo_cuantos_van_en_el_precio` | `shorts.cobro.renderizar_n_por_el_precio_del_servidor` |
| `test_m22_editor_y_descargas.py::test_el_front_de_shorts_ofrece_ver_y_descargar` | `shorts.salidas.descargar_por_el_servicio_y_ver_solo_http` |
| `test_m22_testers_ui.py` (la liga también con proyecto, oculta mientras descarga) | `shorts.cobro.un_solo_principal_por_vista` (la liga está con proyecto) e `shorts.importacion.descargando_sin_orbe_y_sin_la_liga` |
| `test_m4_recarga_cerrada.py` (shorts en `CON_BOTON`) | `shorts.cobro.sin_saldo_con_la_recarga_cerrada_dice_a_quien_escribir`; al retirar, shorts sale de `CON_BOTON` |
| `test_ui15_trabajos.py[shorts]` (carga `trabajos.js`; la subida sale en el cuadro) | sin destino: la nueva no carga `trabajos.js` (como clip, estilos, competencia y subir). El progreso de la subida se ve en la pantalla (`subir.subida.progreso_real_con_porcentaje_y_mb` prueba el mismo componente). Al retirar, `shorts` sale de las listas |
| `test_ui_escapar.py` (la `esc` de shorts y sus plantillas) | `shorts.salidas.textos_del_server_como_texto` e `shorts.importacion.descargando_sin_orbe_y_sin_la_liga` (React escapa). Al retirar, `static/shorts.html` sale de la lista de `esc` esperadas |
| `test_ui14_todas.py[shorts]` | `tokens.css`; al retirar, `shorts` sale de la lista |
| `test_m20_paleta.py` (glob) | ya mira `web/` |
| `test_cache_estaticos.py[/shorts.html]` | se queda: `server/migracion.py` sirve la vieja con `no-cache` |
| `test_entrar_portada.py` (no enlaza a la portada) | el `Marco` enlaza a `/estudio/` |
| `test_ui10_inicio.py` / `test_m25_entrada.py` (el inicio enlaza a `/shorts.html`) | se quedan: el 302 hace el resto |

## Diferencias a propósito

- **Tres arreglos de dinero** (arriba):
  - el sondeo ya no reabre Analizar con el cobro en vuelo;
  - cambiar la liga anula la cotización;
  - sin `creditos_por_short` del server no se cobra.
- **Validar antes de cobrar:** la duración de 5 a 90 s y el máximo de 10 shorts, junto al campo.
- **Lo elegido se queda:** marcar y ajustar candidatos sobrevive al sondeo.
- **Subida compartida** con editar metraje. Propone el nombre desde el
  archivo; la regla del nombre es la del server (`isalnum`, con acentos). La
  vieja de shorts era más estricta que el server (solo ASCII).
- **Al subir o importar,** el proyecto se abre en la misma página
  (`?p=`), sin recargarla.
- **Sondeo:** la escalera 5-5-5-10-10-20 s, en vez de cada 5 s fijos.
- **Sin `trabajos.js`:** los avisos y el progreso van dentro de la pantalla.
- **«← Editar»:** la vieja volvía a `/e1.html`; la nueva usa el `Marco`
  («← Estudio»).
- **`useTituloPestana`:** ahora devuelve el título al desmontarse. Sin eso,
  al abrir otro proyecto la pestaña apilaba «Analizando… · Analizando… ·
  Estudio…».
