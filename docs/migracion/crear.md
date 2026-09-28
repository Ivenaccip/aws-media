# Migración de crear (UI·8.9)

`static/crear.html` → `/estudio/crear/` (`web/src/pantallas/crear/`).

Crear una película es el camino más largo del estudio: configurar, esperar el
guion, revisarlo, producir (con o sin aprobar las imágenes antes de animar) y
verla. Cobra en tres momentos, y la pantalla no calcula ningún número aparte:

| Qué se enseña | De dónde sale |
|---|---|
| «Generar ✦ N» (lo que se cobra al empezar: historia y personaje) | `video.preparar` de `tarifas.json` |
| «Película de 0:30: ✦ N en total» y la nota «los otros N, al producir» | `video.por_duracion` de `tarifas.json` (la misma tabla que valida el server) |
| «Producir ✦ N» y «Te faltan N» | `creditos` y `creditos_saldo` de `POST /api/proyectos/{id}/estimacion` (el mismo `costo_producir` que cobra `/producir`) |
| «Cambiar ✦ N» (el personaje o una imagen antes de animar) | `video.imagen` de `tarifas.json` |
| «Reintentar ✦ N» y «Cuesta N créditos y se cobran de nuevo» | `por_duracion − preparar` de la duración del proyecto |
| «Te devolvimos ✦ N» en el error | `cobrado_producir` del proyecto (o la tabla, si falta); al preparar, `video.preparar` |
| «Te devolvimos N créditos» al volver de las imágenes | `devueltos` de `/cancelar` |
| «≈ $X.XX dólares» (solo sin monedero, en dev local) | `total` de `/estimacion` (el server lo saca de `pricing.json`) |

Sin la cifra de `/estimacion` no hay botón que cobre al producir: se dice «No
pudimos calcular el costo» y se ofrece reintentar.

## Etapas

| Etapa | Qué pasa | Cómo se pasa | Estado |
|---|---|---|---|
| `nueva` | `/estudio/crear/` existe; `/crear.html` sigue igual | este PR | ✅ 28-sep |
| `todos` | `/crear.html` → 302 a `/estudio/crear/` (conserva `?p=`, `?brief=` y `?modo=`), salvo la cookie `ui=clasica` | `etapa="todos"` + deploy | ⏳ al desplegar |
| `retirada` | 302 siempre; se borran `static/crear.html` y sus tests viejos | `etapa="retirada"`, `git rm` + deploy | pendiente |

El inicio, el cuadro de trabajos (`trabajos_api`) y el hub enlazan a
`/crear.html?p=` y `/crear.html?brief=`: en `todos` el 302 los lleva con su
query y no hay que tocarlos.

Antes de `todos`, el dueño hace el QA de `docs/QA-UI.md` § crear. **Producir
cobra** 💳: la película más barata es de 15 s (✦ 10 al generar + ✦ 45 al
producir), y cambiar el personaje o una imagen cuesta ✦ 2. Necesita su «sí» al
gasto.

## Los invariantes (tests/test_migracion_ui.py)

Cada ID es el nombre exacto de un test de vitest en
`web/src/pantallas/crear/Crear.test.tsx`.

| ID | Qué garantiza |
|---|---|
| `crear.formulario.estilos_radiogroup_muestra_y_personalizado` | Los estilos de `/api/estilos` son un radiogroup; la muestra es `/estilos/<id>.jpg` y, sin foto, la descripción. «Personalizado» cambia la muestra por el cuadro donde se describe y le da el foco |
| `crear.formulario.sin_estilos_dice_con_cual_sale` | Si `/api/estilos` falla, se dice que sale en Animado y que recargar deja elegir |
| `crear.formulario.brief_y_modo_llegan_por_la_url` | `?brief=` y `?modo=` del inicio llenan el cuadro y marcan el modo (con su nota y el contador) |
| `crear.formulario.modo_segundo_clic_suelta` | «Investigación» y «Tengo una idea» son interruptores excluyentes; el segundo clic vuelve a «detectar solo» |
| `crear.formulario.imagenes_hasta_cuatro_y_se_quitan` | Hasta 4 imágenes del personaje (lo que sobra se dice), solo imágenes, cada una con su «Quitar» (suelta su blob: URL y el foco no se pierde). Con imagen aparece «Detalles del personaje» |
| `crear.formulario.duracion_de_la_tabla_con_teclado_y_limites` | El temporizador solo toma las duraciones de `video.por_duracion`; flechas, Inicio y Fin, límites apagados y `aria-valuetext` en palabras |
| `crear.cobro.generar_dice_lo_de_ahora_y_el_total_junto_a_la_duracion` | «Generar ✦ `preparar`» (lo que cobra al tocarlo); el total de la duración va junto al temporizador y la nota reparte guion y producción |
| `crear.cobro.generar_sin_saldo_para_el_guion_no_cobra` | Sin saldo para el guion, «Generar» se apaga, dice cuánto falta y no llama ni a moderar |
| `crear.cobro.alcanza_para_el_guion_y_no_para_producir_se_dice` | Si alcanza para el guion pero no para producir, se dice antes de empezar |
| `crear.cobro.generar_doble_clic_una_pelicula` | Doble clic en «Generar» = UNA película; después se refresca el saldo |
| `crear.cobro.el_pedido_se_arma_antes_de_moderar_y_la_rejilla_queda_inerte` | El pedido se arma antes de moderar; mientras vuela la cuadrícula queda `inert` y el orbe dice «Revisando tu texto…» |
| `crear.cobro.moderacion_rechaza_sin_llamar_y_explica` | Si la moderación rechaza, un diálogo explica por qué, no se crea nada y el foco vuelve al texto |
| `crear.cobro.brief_vacio_no_llama` | Sin texto se dice «Describe tu video primero.» sin llamar a nadie |
| `crear.cobro.slots_409_avisa_y_balanceador_pregunta_y_fuerza` | El 409 de espacio se dice; el del balanceador pregunta con `<Confirmar>` (arranca en «No, la cambio») y, si se acepta, reenvía con `forzar=true` sin volver a moderar |
| `crear.cobro.un_402_dice_a_quien_escribir` | Un 402 dice el texto del server y a quién escribir (`<Recarga>`) |
| `crear.crear.manda_todos_los_campos_y_pone_p_en_la_url` | El multipart lleva brief, estilo, estilo_custom, duracion_s, modo, rubro, personaje_extra, formato, pipeline (del A/B `?pipeline=`) y las referencias; se modera brief + detalles; la URL pasa a `?p=<id>` y empieza la espera |
| `crear.progreso.pasos_y_barra_no_retroceden` | La barra y los pasos nunca retroceden dentro de una fase, y arrancan de cero en la siguiente; el orden de narración no mueve el paso |
| `crear.progreso.falta_con_estimacion_y_sin_ella_nada` | «Faltan unos N min.» sale de `/estimacion` (una vez, con el texto aprobado) repartida por la barra; «Animando las escenas · 2 de 6» y «puedes cerrar esta pestaña» |
| `crear.progreso.sin_estimacion_no_promete_minutos` | Sin estimación no se inventa ninguna cifra de minutos |
| `crear.progreso.sondea_hasta_terminal_y_duerme_oculta` | Sondea cada 2.5 s mientras trabaja, duerme con la pestaña oculta, pregunta al volver y se para en revisión, imágenes, listo o error |
| `crear.progreso.sin_red_avisa_y_el_orbe_reposa` | Tras 2 fallos seguidos avisa «Sin conexión…» y el orbe pasa a reposo; al volver la red, se quita y vuelve a «pensando». El orbe se precarga una vez |
| `crear.reanudar.p_en_la_url_abre_la_pelicula_y_si_falla_reintentar` | `?p=` abre la película con una llamada (aunque StrictMode monte dos veces); si falla, aviso con Reintentar |
| `crear.revision.personaje_elegir_y_crear_opciones_gratis` | Sin opciones, «Crear 2 opciones» (gratis, no toca el saldo); las opciones son botones con `aria-pressed` |
| `crear.revision.crear_opciones_si_falla_lo_dice` | Si crear las opciones falla, se dice y el botón vuelve |
| `crear.revision.cambiar_personaje_cobra_imagen_y_valida_antes` | «Cambiar ✦ `video.imagen`» dice antes de cobrar si falta el texto o la opción; al volver marca la versión nueva y refresca el saldo |
| `crear.revision.voces_con_nivel_motivo_y_muestra` | Las voces dicen su nivel en palabras y su motivo; «Escuchar» carga la muestra gratis y, si falla, lo dice |
| `crear.revision.sin_voces_queda_una` | Sin recomendación del server queda George: nunca un selector vacío |
| `crear.revision.escenas_editar_quitar_anadir_y_meta` | Cada escena dice palabras y segundos y se marca con más de 14 palabras; se quitan y se añaden; la estimación total se actualiza |
| `crear.revision.narracion_texto_corrido` | En el pipeline de narración es un solo texto corrido, sin «Añadir escena», y el PUT manda `{narracion, voz}` |
| `crear.revision.autoguardado_no_guarda_vacio_y_reintenta` | Autoguardado a 1 s del último cambio (guion y, si hay, personaje); si falla reintenta a los 4 s; jamás persiste un guion vacío |
| `crear.revision.cerrar_con_cambios_sin_guardar_pregunta` | Con cambios sin guardar, cerrar la pestaña pregunta |
| `crear.revision.fuentes_solo_http_son_enlaces` | Las fuentes del dossier solo son enlaces si son http(s), con `noopener noreferrer` |
| `crear.cobro.producir_con_precio_del_servidor_y_guarda_antes` | «Producir ✦ N» con `creditos` de `/estimacion`; la nota suma con el guion; doble clic = un cobro; antes guarda guion y personaje |
| `crear.cobro.producir_sin_personaje_no_cobra` | Sin personaje elegido se dice y no se llama a producir |
| `crear.cobro.producir_si_no_alcanza_no_cobra_y_un_402_lo_dice` | Si no alcanza, «Producir» se apaga con cuánto falta y la nota no repite el saldo |
| `crear.cobro.producir_manual_aprueba_imagenes` | «Enséñame las imágenes antes de animar» manda `aprobar_imagenes=true` |
| `crear.cobro.producir_sin_precio_no_cobra` | Sin la cifra del server no hay botón que cobre: «No pudimos calcular el costo.» con Reintentar |
| `crear.cobro.producir_sin_monedero_dice_dolares_del_servidor` | Sin monedero (dev local), «Producir» sin estrella y la nota con `total` del server en «$X.XX dólares» |
| `crear.imagenes.cambiar_una_cobra_y_refresca_la_imagen` | Cada imagen tiene «Cambiar ✦ `video.imagen`» con su descripción editable; doble clic = un cobro; `?v=` hace ver la imagen nueva |
| `crear.imagenes.un_402_al_cambiar_dice_a_quien_escribir` | Un 402 al cambiar una imagen dice a quién escribir |
| `crear.imagenes.animar_no_cobra` | «Animar la película» no lleva precio y vuelve a la espera |
| `crear.imagenes.mejor_no_confirma_y_dice_lo_devuelto` | «Mejor no» pregunta con `<Confirmar>` (arranca en «No, seguir aquí»); al aceptar vuelve a revisión, dice lo devuelto por el server y refresca el saldo |
| `crear.resultado.video_descargar_editor_y_drive_http` | El video con su portada, «Descargar», «Editor» a `/editor/gen-<id>/` y «Abrir en Drive» |
| `crear.resultado.sin_editor_lo_explica_y_sin_http_no_hay_drive` | Sin editor el botón está apagado y se explica; un link que no es http(s) no se pinta |
| `crear.resultado.rehacer_vuelve_a_revision_gratis` | «Rehacer» reabre a revisión sin tocar el saldo; si falla lo dice y el botón vuelve |
| `crear.error.al_producir_reintentar_con_precio_y_devolucion` | Falla al producir: dónde se detuvo, «Te devolvimos ✦ `cobrado_producir`», «Reintentar ✦ N» (cobra otra vez y lo dice), lo técnico plegado, el saldo se pide a los 4 s y el error de reintentar va aparte |
| `crear.error.al_producir_sin_cobrado_usa_la_tabla` | Sin `cobrado_producir`, lo devuelto sale de la tabla de hoy |
| `crear.error.narracion_con_personaje_es_de_producir` | El criterio de «falló al producir» es el del server: con narración (no solo guion) y un personaje válido |
| `crear.error.al_preparar_empezar_de_nuevo_con_la_idea` | Falla al preparar: devuelve el guion, «Empezar de nuevo» es el principal y lleva la idea a `/estudio/crear/?brief=` |
| `crear.error.sin_monedero_no_habla_de_creditos` | Sin monedero no se menciona ningún crédito |
| `crear.textos.del_servidor_como_texto` | Dossier, fuentes, descripción, motivos y guion se pintan como texto |
| `crear.marco.enlace_estudio_sin_version_anterior` | «← Estudio», sin «Usar la versión anterior» (se quitó el 28-sep; `/ui/clasica` sigue a mano) |
| `crear.cobro.un_solo_principal_por_vista` | Un solo principal en el formulario, la revisión, las imágenes y el error; ninguno en el resultado |

## Cada aserción vieja y su destino

Al pasar a `retirada` se borran (o se recortan) estos tests junto con
`static/crear.html`. Los que prueban el server **se quedan**:
`test_m1_desbloqueo.py`, `test_m5_proteger.py`, `test_m11_narracion.py`,
`test_m12_hub.py`, `test_creditos_c5.py`, y las partes de API de
`test_m22_imagen_antes_de_animar.py`, `test_m22_formato.py` y
`test_m23_crear_video.py`.

### tests/test_m23_crear_video.py (la pantalla)

| Aserción vieja | Destino |
|---|---|
| La rejilla de tres columnas (`p-estilo`, `p-prompt`, `p-formato`, `p-duracion`) | `Formulario.tsx`: `md:grid-cols-3`, el cuadro de texto `md:col-span-2` y el formato `md:col-span-2` |
| `#estilos` radiogroup, `/estilos/${estilo}.jpg` | `crear.formulario.estilos_radiogroup_muestra_y_personalizado` |
| El cuadro con `#adjuntos`, `#mas`, `#files`, `#pextra`, `MAX_REFS = 4` | `crear.formulario.imagenes_hasta_cuatro_y_se_quitan` |
| `data-fmt`, «YouTube · 16:9», «Se elige ahora…» | `crear.crear.manda_todos_los_campos_y_pone_p_en_la_url` (manda `formato`) y el texto en `Formulario.tsx` |
| El temporizador (`#dur-menos`, `#dur-mas`, spinbutton, `0:30`) y su test en node | `crear.formulario.duracion_de_la_tabla_con_teclado_y_limites` |
| `Generar ✦ ${prep}`, la nota «Ahora se cobran…», `falta = prep - mon.saldo` | `crear.cobro.generar_dice_lo_de_ahora_y_el_total_junto_a_la_duracion`, `crear.cobro.generar_sin_saldo_para_el_guion_no_cobra` y `crear.cobro.alcanza_para_el_guion_y_no_para_producir_se_dice` |
| El FormData antes del guardarraíl y `.rejilla` inert | `crear.cobro.el_pedido_se_arma_antes_de_moderar_y_la_rejilla_queda_inerte` |
| El orden bajo el botón (orbe, saldo, error, nota) | `Formulario.tsx`: orbe, aviso de saldo, error (`role=alert`) y nota del cobro |
| `costoProducir(p.duracion_s)` al reintentar; «Con los N créditos del guion, tu película suma N» | `crear.error.al_producir_reintentar_con_precio_y_devolucion` y `crear.cobro.producir_con_precio_del_servidor_y_guarda_antes` |
| `?brief` y `?modo` desde el hub | `crear.formulario.brief_y_modo_llegan_por_la_url` |

### tests/test_ui11_crear.py (la espera y el error)

| Aserción vieja | Destino |
|---|---|
| `#ppasos`, `#pfalta`, `#pbar`, `#orbe-prog`, «Puedes cerrar esta pestaña» | `crear.progreso.falta_con_estimacion_y_sin_ella_nada` |
| Los pasos no retroceden; «Animando las escenas · 2 de 6» | `crear.progreso.pasos_y_barra_no_retroceden` y `crear.progreso.falta_con_estimacion_y_sin_ella_nada` |
| «Faltan unos N min.» / «Falta alrededor de un minuto.» / oculto sin cifra | `textoFalta()` de `logica.ts`, `crear.progreso.falta_con_estimacion_y_sin_ella_nada` y `crear.progreso.sin_estimacion_no_promete_minutos` |
| Todas las etapas de `ETAPA_TXT` caen en un paso | `logica.ts` (`PASOS_PREP`, `PASOS_PROD`); ahora también `encolado`, `imagenes` y `puente` tienen texto y porcentaje |
| El error en tres partes, lo técnico plegado, principal/secundario según dónde falló | `crear.error.al_producir_reintentar_con_precio_y_devolucion` y `crear.error.al_preparar_empezar_de_nuevo_con_la_idea` |
| «Te devolvimos ✦ N» con `cobrado_producir ??` y `preparar` | `crear.error.al_producir_reintentar_con_precio_y_devolucion`, `crear.error.al_producir_sin_cobrado_usa_la_tabla` y `crear.error.al_preparar_empezar_de_nuevo_con_la_idea` |
| El error de reintentar va aparte | `crear.error.al_producir_reintentar_con_precio_y_devolucion` |
| Sin monedero no se habla de créditos | `crear.error.sin_monedero_no_habla_de_creditos` |
| `href = /crear.html?brief=…` | `crear.error.al_preparar_empezar_de_nuevo_con_la_idea` (ahora `/estudio/crear/?brief=`) |

### tests/test_ui13_crear.py (la carta de diseño en la vieja)

| Aserción vieja | Destino |
|---|---|
| carta.css, tamaños de letra, emojis, iconos que existen | `tokens.css`, `<Marco>`, `<Icono>` (TypeScript: `NombreIcono`) y los guardianes sobre `web/` |
| Un solo `btn-pri` por estado, ninguno en el resultado | `crear.cobro.un_solo_principal_por_vista` |
| Lo elegido no es ámbar | `Piezas.tsx` (`Chip`: `border-texto bg-elevada`) y las opciones de personaje (`border-texto`) |
| Lo que se toca mide 44 px | `min-h-11`/`size-11` en chips, campos y botones redondos |
| `NIVEL = {verde:'Encaja', …}` | `crear.revision.voces_con_nivel_motivo_y_muestra` |

### tests/test_ui16_crear.py (el cuadro de avisos de trabajos.js)

| Aserción vieja | Destino |
|---|---|
| El aviso de red con clave `red` y el orbe a reposo | `crear.progreso.sin_red_avisa_y_el_orbe_reposa` (el aviso va en la pantalla) |
| «Te devolvimos N créditos.» al cancelar | `crear.imagenes.mejor_no_confirma_y_dice_lo_devuelto` |
| La muestra de voz que falla | `crear.revision.voces_con_nivel_motivo_y_muestra` |
| Reabrir que falla: el error y el botón vuelve | `crear.resultado.rehacer_vuelve_a_revision_gratis` |
| Reanudar con `?p=` que falla: aviso con Reintentar | `crear.reanudar.p_en_la_url_abre_la_pelicula_y_si_falla_reintentar` |
| El `confirm` del balanceador | `crear.cobro.slots_409_avisa_y_balanceador_pregunta_y_fuerza` (`<Confirmar>`) |
| Las 5 llamadas a `window.avisos?.mostrar(` y los ids | sin destino literal: la nueva no carga `trabajos.js` |

### tests/test_m22_imagen_antes_de_animar.py y test_m22_formato.py (la pantalla)

| Aserción vieja | Destino |
|---|---|
| `data-img="auto"/"manual"` y `aprobar_imagenes=${modoImg === 'manual'}` | `crear.cobro.producir_manual_aprueba_imagenes` |
| `#imagenes`, `#animar`, `#cancelar` | `crear.imagenes.animar_no_cobra` y `crear.imagenes.mejor_no_confirma_y_dice_lo_devuelto` |
| `TERMINAL = [...]` | `crear.progreso.sondea_hasta_terminal_y_duerme_oculta` |
| `?v=${imgVersion}` | `crear.imagenes.cambiar_una_cobra_y_refresca_la_imagen` |
| `fd.append('formato', formato)` | `crear.crear.manda_todos_los_campos_y_pone_p_en_la_url` |

### tests/test_m19_orbe.py (la parte de crear)

| Aserción vieja | Destino |
|---|---|
| `/orbe.js`, `#orbe-prog`, `precargar()`, `SIN_ORBE` | `web/estudio/crear/index.html` carga `/orbe.js`; `<EsperaIA>` sin orbe deja el texto; `crear.progreso.sin_red_avisa_y_el_orbe_reposa` (precarga una vez) |
| La barra sigue y es monotónica | `crear.progreso.pasos_y_barra_no_retroceden` |
| `if (enVuelo) return;` (el monedero no reabre botones a media petición) | el candado de `<BotonCobro>`: `crear.cobro.generar_doble_clic_una_pelicula`, `crear.cobro.producir_con_precio_del_servidor_y_guarda_antes` y `crear.imagenes.cambiar_una_cobra_y_refresca_la_imagen` |
| El orbe se va antes del confirm, del error y del resultado | `Crear.tsx`/`Formulario.tsx`: el orbe solo existe mientras hay espera (`espera` o `enMarcha`) |
| El poll duerme con la pestaña oculta | `crear.progreso.sondea_hasta_terminal_y_duerme_oculta` |
| La clave del latido `[estado, etapa, escenas_listas]` | `Crear.tsx` (`latido`) con `<EsperaIA latido>` |
| Reintentar con el criterio del server | `crear.error.narracion_con_personaje_es_de_producir` |

### tests/test_m21_botones.py (la parte de crear)

| Aserción vieja | Destino |
|---|---|
| Generar, Cambiar, Producir y Reintentar con `Verbo ✦ N` | `<BotonCobro>` en los cuatro; «Pedir otra» también pasó a «Cambiar ✦ N» |
| «se cobran de nuevo» cerca de «Qué sigue» | `crear.error.al_producir_reintentar_con_precio_y_devolucion` |
| «Te quedan N créditos · ~M min.» y sin repetir el saldo si no alcanza | `crear.cobro.producir_con_precio_del_servidor_y_guarda_antes` y `crear.cobro.producir_si_no_alcanza_no_cobra_y_un_402_lo_dice` |

### Otros módulos que miran crear

| Aserción vieja | Destino |
|---|---|
| `test_ui_escapar.py` (`esHttp` en fuentes y en el link de Drive) | `crear.revision.fuentes_solo_http_son_enlaces`, `crear.resultado.sin_editor_lo_explica_y_sin_http_no_hay_drive` y `crear.textos.del_servidor_como_texto` |
| `test_m4_recarga_cerrada.py` (usa `window.monedero.cta`) | `<Recarga>`: `crear.cobro.un_402_dice_a_quien_escribir` |
| `test_ui12_pildora.py`, `test_m23_imagenes.py` (la cabecera centrada) | `<Marco>` (`pt-16`) |
| `test_ui14_todas.py`, `test_ui15_trabajos.py`, `test_cache_estaticos.py` | al retirar, `crear` sale de las listas |
| `test_m25_entrada.py`, `test_ui15_trabajos.py`, `Inicio.test.tsx` (enlazan `/crear.html`) | se quedan: el 302 hace el resto |
| `test_m20_paleta.py` | los colores salen de `tokens.css` |

## Diferencias a propósito

- **«Pedir otra» (una imagen antes de animar) ahora dice su precio:
  «Cambiar ✦ 2».** La vieja no lo decía en el botón (solo en la nota).
- **«Mejor no» pregunta** con `<Confirmar>`: vuelve a revisión, devuelve la
  animación menos las imágenes, y producir otra vez cobra de nuevo. Arranca
  en «No, seguir aquí».
- **El balanceador pregunta con `<Confirmar>`** en vez de `confirm()`, y
  arranca en «No, la cambio».
- **Sin la cifra del server no se puede producir.** La vieja dejaba pulsar
  «Producir» sin precio mientras llegaba la estimación. Tampoco se cobra con
  el guion vacío: se dice antes.
- **Se quitó «(≈ $0.10 dólares extra)»** de la nota de «Investigación». Era
  un dólar escrito a mano, no de `pricing.json`, y el usuario no lo paga: el
  guion cuesta los mismos créditos en los tres modos.
- **`encolado`, `imagenes` y `puente`** tienen nombre y porcentaje. En la
  vieja caían al 5 % y la etiqueta decía el código interno.
- **Las opciones del personaje son botones** (`aria-pressed`), no imágenes
  con clic: se eligen con el teclado.
- **«Empezar de nuevo»** lleva a `/estudio/crear/?brief=…`.
- **Sin `trabajos.js`:** los avisos (red, voz, reabrir, reanudar) van en la
  pantalla.
