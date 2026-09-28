# Migración de clip (UI·8.1)

`static/clip.html` → `/estudio/clip/` (`web/src/pantallas/clip/`).

Es la primera pantalla con usuarios reales y cobra una sola cosa,
«Generar ✦ N». El precio sale siempre de `/api/clip/config`, que el server
lee de `tools/tarifas.json`; la pantalla no escribe ningún número de
créditos.

## Etapas

| Etapa | Qué pasa | Cómo se pasa | Estado |
|---|---|---|---|
| `nueva` | `/estudio/clip/` existe; `/clip.html` sigue igual | este PR | ⏳ al desplegar |
| `todos` | `/clip.html?brief=…` → 302 a `/estudio/clip/?brief=…`, salvo la cookie `ui=clasica` | `etapa="todos"` + deploy | pendiente |
| `retirada` | 302 siempre; se borran `static/clip.html` y sus tests viejos | `etapa="retirada"`, `git rm` + deploy | pendiente |

Antes de `todos`: el dueño genera **un clip de verdad** en `/estudio/clip/`
(cobra ✦ 30, o ✦ 32 con dos fotos o más según `tarifas.json` §clip; necesita su «sí» al gasto) y corre
el QA manual de `docs/QA-UI.md` § clip.

Los enlaces que apuntan a `/clip.html` (la caja del inicio con `?brief=`,
«Tus trabajos») no se tocan: en `todos` los lleva el 302, que conserva el
query.

## Los invariantes (tests/test_migracion_ui.py)

Cada uno es un test de vitest en `web/src/pantallas/clip/Clip.test.tsx` con
ese nombre exacto.

| ID | Qué garantiza |
|---|---|
| `clip.cobro.precio_del_servidor_en_el_boton` | «Generar ✦ N» con el precio de `/api/clip/config`, y el de composición con dos fotos o más (el test usa una tarifa falsa a propósito: si alguien escribe el número en el cliente, falla) |
| `clip.cobro.doble_clic_un_solo_post` | doble clic en Generar = 1 POST |
| `clip.cobro.manda_texto_formato_y_fotos` | el POST lleva el texto sin espacios de más, el formato y las keys de las fotos |
| `clip.cobro.sin_texto_no_cobra` | sin texto, dice qué falta y no hay POST |
| `clip.cobro.fotos_subiendo_no_cobra` | con una foto subiendo, pide esperar y no hay POST |
| `clip.cobro.error_junto_al_boton_y_se_puede_reintentar` | el error del server (409 y otros) junto al botón; el texto se queda y el botón vuelve a funcionar |
| `clip.cobro.sin_saldo_402_ofrece_recargar` | con la recarga abierta, un 402 enseña su detalle y «Recargar» abre el panel del monedero |
| `clip.cobro.recarga_cerrada_dice_a_quien_escribir` | con la recarga cerrada (`monedero.js`, hoy), el 402 dice a quién escribir en vez de ofrecer un «Recargar» que no hace nada |
| `clip.cobro.saldo_conocido_que_no_alcanza_no_cobra` | si la píldora sabe que no alcanza, el botón se apaga y dice cuánto falta (nuevo, de `BotonCobro`) |
| `clip.cobro.refresca_el_saldo_y_limpia_tras_cobrar` | tras cobrar: texto y fotos vacíos, `monedero.refrescar()` |
| `clip.cobro.espera_a_que_termine_antes_de_otro` | tras generar, el botón espera a que ese clip termine |
| `clip.fotos.pesada_no_se_sube` | más de 20 MB: aviso y ni siquiera se pide firma |
| `clip.fotos.heic_sin_tipo_firma_y_sube_con_image_heic` | el `.heic` del iPhone sin `file.type` se firma y se sube con `image/heic` (si no, S3 da 403) |
| `clip.fotos.fallo_de_subida_la_quita_y_avisa` | una subida que falla quita la miniatura y avisa junto a las fotos |
| `clip.fotos.tope_oculta_agregar_y_quitar_la_devuelve` | con 3 fotos desaparece «Agregar foto»; quitar una lo devuelve |
| `clip.formato.horizontal_por_defecto` | Horizontal elegido al entrar, con `aria-pressed` |
| `clip.entrada.brief_rellena_el_texto_y_se_limpia_la_url` | `?brief=` del inicio rellena el texto y se quita de la URL |
| `clip.entrada.recupera_lo_apartado_si_la_sesion_vencio` | si la sesión venció a mitad de «Generar», el texto vuelve (nuevo, `api.ts`) |
| `clip.lista.textos_del_usuario_como_texto` | un texto con HTML se lee como texto, nunca se ejecuta |
| `clip.lista.listo_con_video_detalle_y_recorte` | el clip listo: «8 s · 1 foto tuya · ✦ 30», el aviso de recorte y el video |
| `clip.lista.error_dice_que_los_creditos_volvieron` | el clip fallido lo dice y aclara que los créditos volvieron |
| `clip.lista.sin_historial_manda_a_mis_videos` | UI·26 (dueño, 28-sep): ya no hay historial «Tus clips». Los clips ya hechos no se ven aquí: viven en «Mis videos» del inicio, y un enlace lo dice. Reemplaza a `clip.lista.vacia_invita_al_primero` («Todavía no has hecho ninguno.»), que no tiene sentido sin historial |
| `clip.lista.abre_el_de_mis_videos_con_c` | `?c=<id>` (lo pone «Mis videos») abre ese clip con su video; se queda en la URL |
| `clip.lista.el_abierto_que_ya_no_esta_en_la_lista_se_pide_solo` | si el abierto ya no viene en `/api/clip` (lista solo los más nuevos), se pide con `/api/clip/<id>` |
| `clip.lista.el_que_termina_con_la_pantalla_abierta_se_queda` | el que se generaba con la pantalla abierta se sigue viendo al quedar listo (o fallar) |
| `clip.lista.sondea_mientras_genera_y_para_al_terminar` | sondea mientras hay uno generándose, para al terminar y refresca el saldo |
| `clip.lista.fallo_de_carga_avisa_reintenta_y_sigue_solo` | sin red: aviso con «Reintentar», sin «Cargando…» colgado, y el sondeo sigue solo |
| `clip.espera.titulo_de_la_pestana_dice_generando` | la pestaña dice «Generando tu clip · …» mientras se genera |
| `clip.marco.enlace_estudio_sin_version_anterior` | «← Estudio», sin «Usar la versión anterior» (se quitó el 28-sep; `/ui/clasica` sigue a mano) |

## Cada aserción vieja y su destino

Al pasar a `retirada` se borran estos tests junto con `static/clip.html`.

### tests/test_ui14_clip.py (la carta de diseño en la vieja)

| Test viejo | Destino |
|---|---|
| `test_carga_la_carta_y_los_iconos` | `tokens.css` y `ui/iconos.ts` (iguales a `iconos.js`, `test_web_tuberia.py`) |
| `test_titulos_en_bricolage_y_texto_en_geist` | `tokens.css`; el `h1` del `Marco` va en `font-titulo` |
| `test_sin_tamanos_de_letra_fuera_de_la_escala` | `tokens.css` borra la escala de Tailwind: fuera de los seis tamaños no compila |
| `test_sin_emojis_como_iconos` | guardianes M19/M21 sobre `web/` e `<Icono>` |
| `test_los_iconos_que_usa_clip_existen` | TypeScript: `NombreIcono` |
| `test_un_solo_principal_y_es_generar` | `<BotonCobro verbo="Generar">` es el único principal; «Verbo ✦ N» lo impone el componente (M21) y lo prueba `clip.cobro.precio_del_servidor_en_el_boton` |
| `test_sin_el_azul_viejo_de_los_botones` | guardián M20 sobre `web/` |
| `test_elegir_no_es_ambar` | el formato elegido va en `border-texto bg-elevada` (`Clip.tsx`), nunca `ambar` |
| `test_quitar_foto_es_un_icono_con_nombre` | `aria-label="Quitar foto"`, usado por `clip.fotos.tope_oculta_agregar_y_quitar_la_devuelve` |
| `test_enlaces_y_campos_con_los_tokens` | `text-enlace` en el `Marco`; el texto usa `border-campo rounded-medio` |
| `test_lo_que_se_toca_mide_44` | quitar foto `size-11`, formatos `min-h-11`, enlaces del `Marco` `min-h-11` |
| `test_los_iconos_de_los_titulos_van_en_gris` | los iconos de los `h2` llevan `text-secundario` |
| `test_no_queda_debajo_de_la_pildora` | el `Marco` empieza a 64 px (`pt-16`): la píldora acaba a 52 |

### tests/test_ui16_clip.py (los avisos)

| Test viejo | Destino |
|---|---|
| `test_el_fallo_de_carga_va_al_cuadro_con_reintentar` | `clip.lista.fallo_de_carga_avisa_reintenta_y_sigue_solo`. El aviso va dentro de «Tus clips», no al cuadro de `trabajos.js` (la nueva no lo carga) |
| `test_sigue_el_reintento_solo_y_se_quita_al_cargar_bien` | `clip.lista.fallo_de_carga_avisa_reintenta_y_sigue_solo` |
| `test_todas_las_llamadas_usan_encadenamiento_opcional` | sin destino: la nueva no llama a `window.avisos` |
| `test_estado_y_est_foto_siguen_en_su_sitio` | `clip.cobro.sin_texto_no_cobra`, `clip.cobro.fotos_subiendo_no_cobra`, `clip.cobro.error_junto_al_boton_y_se_puede_reintentar`, `clip.fotos.pesada_no_se_sube` y `clip.fotos.fallo_de_subida_la_quita_y_avisa` |

### Otros módulos que miran clip

| Aserción vieja | Destino |
|---|---|
| `test_m25_entrada.py::test_el_clip_recoge_el_texto_que_ya_escribieron` | `clip.entrada.brief_rellena_el_texto_y_se_limpia_la_url`. Al retirar, esta aserción se borra; `test_el_clip_va_a_su_pantalla` se queda (el inicio sigue apuntando a `/clip.html` y el 302 hace el resto) |
| `test_ui_escapar.py::test_se_encontraron_las_esc` (`static/clip.html` define su `esc`) | `clip.lista.textos_del_usuario_como_texto`. Al retirar, sale de la lista esperada |
| `test_ui15_trabajos.py` (`url == "/clip.html"`) | se queda: es del server y la URL vieja sigue funcionando por el 302 |
| `test_m25_clip.py` | se queda entero: prueba el server, no el HTML |

## Diferencias a propósito

- **Sondeo:** la vieja preguntaba cada 5 s fijos (15 s tras un fallo); la
  nueva usa la escalera 5-5-5-10-10-20 s y se duerme con la pestaña oculta
  (al volver, pregunta al instante).
- **Saldo:** si la píldora ya sabe que no alcanza, el botón se apaga y dice
  cuánto falta, en vez de dejar que el server conteste 402.
- **Sesión vencida:** el texto de «Generar» se aparta en `sessionStorage`
  mientras vuela y vuelve si auth.js tuvo que ir a Cognito.
- **Sin `trabajos.js`:** los avisos van dentro de la pantalla. «Tus trabajos»
  sigue en el resto del estudio.
- **Orbe:** igual que la vieja, solo con UN clip generándose; con más, texto.
- **Sin historial (UI·26):** la vieja listaba todos tus clips. La nueva solo
  enseña el que se genera, el que terminó con la pantalla abierta y el que se
  abrió desde «Mis videos» (`?c=`). Nada se borra: los clips siguen en
  `/api/clip` y se ven en el inicio con la etiqueta «Video corto».
