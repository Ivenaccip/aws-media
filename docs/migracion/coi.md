# Migración de COI (Ajustes 3, 16-oct-2026)

`web/src/pantallas/coi/` → `/estudio/coi/`. **COI nace en la UI nueva: no tuvo pantalla vieja**, así que aquí no hay «aserciones viejas»
que mapear. Se registra en `server/migracion.py` como `retirada` desde el primer día (no hay HTML viejo que servir: `/coi.html` solo es un
atajo que redirige) para que el registro anti-pérdida (`tests/test_migracion_ui.py`) cubra sus invariantes como a las demás.

COI = **C**ontexto · **O**bjetivo · **I**nstrucciones: un chat de UNA sola entrada. La persona escribe una vez y la IA responde una vez
con el COI en tres bloques. Dirección A del lienzo («Conversación»: una columna, un cuadro grande, tres tarjetas plegables; tablero
`COI-A.dc.html`). **Gratis por ahora (0 créditos), 3 usos por persona por día** (día de México). Solo cuentan las respuestas terminadas.
Lo cuenta el SERVIDOR (`GET /api/coi/estado`): la web solo lo enseña.

## Lo que esta pantalla NO hace (a propósito)

- **No guarda lo que la persona escribe ni lo que responde la IA.** Ni en `localStorage`/`sessionStorage`/IndexedDB/cookies, ni con
  `apartar` de `nucleo/api.ts` (que deja el cuerpo de la petición en `sessionStorage` mientras vuela). El texto vive en el estado de React
  y se va con la pestaña. Solo se guarda el COI que la persona decida guardar, con «Guardar», y solo en su Biblioteca.
- **No conoce las instrucciones del modelo.** Viven solo en el servidor; ni el bundle ni ninguna respuesta del API las llevan
  (`tests/test_coi_web_guardianes.py` lo vigila).
- **No usa el reloj del navegador para la renovación.** «Faltan X h Y min» sale de `renueva_en_s` del servidor.
- **No cobra ni lleva ✦**: el botón es «Armar COI».

## Etapas

| Etapa | Qué pasa | Estado |
|---|---|---|
| `retirada` | `/estudio/coi/` existe; `/coi.html` → 302 siempre (no hubo vieja) | ⏳ al desplegar |

Antes de desplegar: `tools/db_migrate.py` en CADA entorno (tablas `coi_estado`, `biblioteca_mios` y `biblioteca_fijados`, del rol servidor) y las
filas de `docs/QA-UI.md` § COI. Dónde vive: **Central › Distrito › COI** (`web/src/marca/menu.ts`).

## Los invariantes (tests/test_migracion_ui.py)

En `web/src/pantallas/coi/Coi.test.tsx` y `web/src/pantallas/coi/logica.test.ts`, con ese nombre exacto.

| ID | Qué garantiza |
|---|---|
| `coi.contador.dice_cuantos_quedan_en_singular_y_plural` | «Te quedan N de 3 hoy» / «Te queda 1 de 3 hoy» / «Ya usaste tus 3 de hoy», y los puntitos llenos |
| `coi.contador.faltan_sale_de_los_segundos_del_servidor_y_se_redondea_hacia_arriba` | «Faltan 5 h 20 min» a partir de `renueva_en_s`; los minutos suben (nunca «0 min» con tiempo por delante) |
| `coi.contador.dice_cuantos_quedan_con_lo_que_dice_el_servidor` | el contador sale de `GET /api/coi/estado` (3, 2, 1 y 0), con su línea de apoyo y `aria-live="polite"` |
| `coi.contador.el_faltan_sale_de_renueva_en_s_del_servidor_y_no_del_reloj_del_navegador` | con el reloj del navegador a otra hora, el «Faltan…» sigue diciendo lo del servidor |
| `coi.contador.ya_usaste_los_3_se_vuelve_a_preguntar_cada_minuto_y_el_faltan_lo_dice_el_servidor` | con los 3 usados se le pregunta al servidor cada minuto y el «Faltan…» baja con lo que él diga |
| `coi.contador.al_cumplirse_el_plazo_del_servidor_se_vuelve_a_preguntar_y_la_entrada_se_enciende` | al cumplirse `renueva_en_s` (una duración, no una hora del reloj) se pregunta y, si cambió el día, la entrada vuelve |
| `coi.contador.sin_poder_leerlo_falla_cerrado_y_reintentar_vuelve_a_preguntar` | sin poder leer el contador no se arma nada (botón apagado); «Reintentar» vuelve a preguntar y el foco pasa al cuadro |
| `coi.armar.los_caracteres_se_cuentan_como_el_servidor_un_emoji_es_uno` | el largo se cuenta en puntos de código, como el servidor (un emoji es uno, no dos) |
| `coi.armar.manda_el_texto_recortado_una_sola_vez_aunque_se_pulse_dos_veces` | `POST /api/coi` lleva `{texto}` sin espacios de los lados y una sola vez, aunque se pulse otra vez mientras trabaja |
| `coi.armar.sin_texto_no_manda_y_lo_dice_junto_al_campo` | sin texto (o solo espacios) no manda nada; «Escribe primero qué necesitas…» junto al campo y el foco en el cuadro |
| `coi.armar.ctrl_o_cmd_intro_envian_desde_el_cuadro` | Ctrl+Intro y Cmd+Intro envían desde el cuadro (`aria-keyshortcuts`) |
| `coi.armar.mas_de_2000_caracteres_no_se_manda_y_dice_cuantos_lleva` | más de 2000 caracteres: botón apagado con su motivo y nada se manda; 2000 justos sí |
| `coi.armar.generando_dice_armando_sin_pasos_falsos_y_el_contador_no_baja_hasta_terminar` | «Armando tu COI…» sin pasos falsos ni barra; el botón dice «Armando…» con `aria-busy` y `aria-disabled` (no `disabled`); el contador baja solo al terminar |
| `coi.armar.el_foco_va_al_encabezado_del_resultado_y_lo_anuncia` | al llegar el COI el foco va a «Tu COI» y la región viva lo anuncia |
| `coi.armar.un_ejemplo_llena_el_cuadro_deja_el_foco_en_el_y_esconde_los_ejemplos` | los 4 ejemplos llenan el cuadro, el foco se queda en él y la lista se esconde al escribir |
| `coi.resultado.las_partes_numeradas_de_las_instrucciones_se_separan` | «1. Título» con sus líneas se vuelve una lista de partes (con negritas y viñetas del modelo) |
| `coi.resultado.un_texto_que_no_trae_partes_se_lee_como_parrafos_sin_perder_nada` | si no hay al menos dos partes numeradas (o hay texto antes de la primera) se lee como párrafos, sin perder nada |
| `coi.resultado.las_suposiciones_se_marcan_y_el_resto_son_parrafos` | la línea «Suposición:» (o «Assumption:») lleva su etiqueta; el resto son párrafos |
| `coi.resultado.tres_tarjetas_con_sus_encabezados_y_las_siete_partes_de_las_instrucciones` | #CONTEXTO, #OBJETIVO y #INSTRUCCIONES (con sus siete partes) como tarjetas abiertas con `aria-expanded` |
| `coi.resultado.lo_que_dice_el_modelo_se_pinta_como_texto_nunca_como_html` | HTML o scripts en la respuesta salen como texto; no hay `dangerouslySetInnerHTML` |
| `coi.resultado.plegar_una_tarjeta_plegar_todo_y_abrir_todo` | plegar una, «Plegar todo» y «Abrir todo» según lo que haya; el foco se queda en el botón |
| `coi.resultado.copiar_un_bloque_y_copiar_todo_copian_el_texto_tal_cual_sin_mover_el_foco` | «Copiar» por bloque (con su encabezado) y «Copiar todo»; el botón dice «Copiado» sin mover el foco |
| `coi.resultado.si_el_navegador_no_deja_copiar_deja_el_texto_seleccionado_y_lo_dice` | sin permiso para copiar, deja el bloque seleccionado y dice «cópialo con Ctrl+C» |
| `coi.resultado.sin_estructura_sale_una_sola_tarjeta_con_el_texto_completo_y_copiar` | `estructura_ok=false`: una sola tarjeta con el texto completo y «Copiar»; esa respuesta SÍ cuenta |
| `coi.resultado.en_ingles_los_encabezados_van_en_ingles_y_se_copian_asi` | `idioma: "en"`: #CONTEXT, #OBJECTIVE y #INSTRUCTIONS, también al copiar |
| `coi.guardar.el_titulo_propuesto_es_la_primera_frase_del_objetivo_y_cabe_en_80` | el título propuesto es la primera frase del objetivo, sin markdown, en 80 como máximo (con «…» si se corta) |
| `coi.guardar.la_clave_son_32_hex_y_cada_intento_trae_otra` | la clave de guardado son 32 hex aleatorios |
| `coi.guardar.abre_la_hoja_con_la_primera_frase_del_objetivo_editable_y_en_80_como_maximo` | «Guardar» abre la hoja chica con el título prefijado, editable (`maxlength` 80), la categoría en «Guion y texto» y el foco en el título |
| `coi.guardar.manda_titulo_categoria_origen_coi_y_clave_de_32_hex_y_no_gasta_un_uso` | `POST /api/biblioteca/mios` con título, categoría, `origen: "coi"`, clave de 32 hex y el COI completo; no llama al modelo ni gasta un uso |
| `coi.guardar.dice_guardado_en_tu_biblioteca_con_enlace_a_mios_y_el_foco_vuelve_al_boton` | «Guardado en tu Biblioteca» con enlace a Míos; el foco vuelve al botón (ahora «Guardado») y otro clic no abre la hoja |
| `coi.guardar.el_reintento_del_mismo_guardado_manda_la_misma_clave_y_un_coi_nuevo_trae_otra` | el reintento del mismo guardado repite la clave (el servidor devuelve el mismo registro); un COI nuevo trae otra |
| `coi.guardar.sin_titulo_no_manda_y_lo_dice_junto_al_campo` | sin título no manda nada y lo dice junto al campo |
| `coi.guardar.un_error_se_dice_en_la_hoja_con_el_texto_del_servidor_y_la_biblioteca_llena_ofrece_borrar` | un error se dice en la hoja con el texto del servidor; con la Biblioteca llena (`lleno`) ofrece abrirla para borrar; un fallo no marca nada como guardado |
| `coi.errores.el_codigo_y_el_texto_salen_del_detail_objeto` | el `detail` objeto `{codigo, texto, …}` se lee por su código; el 429 trae `renueva_en_s` y `se_renueva` |
| `coi.errores.sin_conexion_y_lo_que_no_es_del_contrato_se_distinguen` | sin conexión, un 504 de la puerta y un código desconocido se distinguen de los del contrato |
| `coi.errores.falla_el_modelo_dice_que_no_se_gasto_ninguno_deja_el_texto_y_se_puede_reintentar` | 502 `modelo`: «no se gastó ninguno», el texto sigue en el cuadro, el contador no baja y se puede reintentar |
| `coi.errores.tardo_lo_dice_y_no_gasta_ninguno` | 504 `tardo`: lo dice y no gasta ninguno |
| `coi.errores.moderacion_dice_el_motivo_del_servidor_junto_al_cuadro_lleva_el_foco_y_se_quita_al_escribir` | 422 `moderacion`: el motivo del servidor junto al cuadro (nunca el texto de la persona), foco al cuadro y se quita al escribir |
| `coi.errores.otra_en_curso_apaga_el_boton_avisa_y_se_sondea_hasta_que_el_servidor_la_suelta` | 409 `en_curso`: el botón se apaga (`aria-disabled`, con su motivo), avisa sin ser error y se sondea cada 4 s hasta que el servidor suelta el candado |
| `coi.errores.otra_en_curso_al_abrir_apaga_el_boton_con_su_motivo` | si al abrir ya hay otra en curso (otra pestaña), el botón nace apagado con su motivo |
| `coi.errores.ya_usaste_los_3_apaga_la_entrada_no_es_un_error_y_el_ultimo_resultado_sigue_a_la_vista` | ya usaste los 3: entrada y botón apagados (`aria-disabled`), NO es un error, «Faltan…» del servidor, enlace a la Biblioteca y el último resultado sigue a la vista |
| `coi.errores.un_429_pone_el_renueva_en_s_que_manda_el_servidor_y_apaga_la_entrada_sin_perder_lo_escrito` | un 429 (otra pestaña gastó el último) apaga la entrada con el `renueva_en_s` del servidor, sin perder lo escrito |
| `coi.errores.sin_conexion_al_armar_lo_dice_y_el_texto_sigue_ahi` | sin conexión al armar: lo dice y el texto sigue ahí |
| `coi.errores.un_muy_largo_o_vacio_del_servidor_que_el_cliente_ya_evita_igual_se_dice` | un 422 `muy_largo` o `vacio` que el cliente ya evita pero se cuela se dice igual (con el texto del servidor) y el texto sigue en el cuadro |
| `coi.errores.tras_cualquier_fallo_se_vuelve_a_leer_el_contador_del_servidor` | tras cualquier fallo se vuelve a leer el contador del servidor (la respuesta pudo no llegar y el uso sí contarse) |
| `coi.errores.el_detail_que_es_objeto_se_lee_por_su_texto_y_no_como_un_dato_invalido` | un 422 con `detail` objeto se lee por su `texto`, no como «hay un dato que no es válido» (extensión de `nucleo/api.ts`) |
| `coi.privacidad.lo_que_se_escribe_y_lo_que_responde_la_ia_no_toca_el_almacenamiento_del_navegador` | escribir, armar y guardar no escriben nada en localStorage ni sessionStorage |
| `coi.privacidad.ninguna_llamada_aparta_el_cuerpo_mientras_vuela` | ninguna llamada usa `apartar` (que deja el cuerpo en sessionStorage mientras vuela la petición) |
| `coi.privacidad.la_linea_de_privacidad_esta_siempre_a_la_vista` | «No guardamos lo que escribes ni lo que te responde. Solo se guarda el COI que tú decidas guardar, y solo en tu Biblioteca.» en reposo, sin poder leer el contador y con resultado |
| `coi.marco.irremplazables_en_dorado_y_las_migas_central_distrito_coi_con_la_ultima_quieta` | «Irremplazables» dorado y sin ícono arriba; migas Central › Distrito › COI (las dos primeras llevan al inicio, COI es un chip quieto con `aria-current`) |
| `coi.marco.el_mapa_enciende_coi_y_enlaza_la_biblioteca_desde_la_pantalla` | `marca/menu.ts` enciende COI (`/estudio/coi/`, sin «Próximamente») y la pantalla enlaza la Biblioteca |
| `coi.marco.un_solo_boton_ambar_y_es_armar_coi` | un solo botón ámbar por pantalla: «Armar COI» (sin ✦: es gratis); «Guardar» y «Copiar» son secundarios |
| `coi.logica.el_texto_copiado_lleva_encabezado_y_los_tres_bloques_en_orden` | lo que se copia y se guarda: encabezado y texto de cada bloque, en orden; sin estructura, lo que respondió el modelo |
| `coi.logica.los_encabezados_siguen_el_idioma_en_que_salio` | los encabezados siguen el idioma de la respuesta |

## Pruebas sueltas (sin ID: función nueva que ninguna pantalla vieja garantizaba)

Las protege el registro de archivos de este doc, no el de IDs:

- `coi.spec.ts` (Playwright, a 1100 y 390 px, con el API simulado): cada estado con su captura, sin desborde horizontal, objetivos de 44 px o
  más, letra de 13 px o más, axe sin violaciones, el foco nunca cae al body, el portapapeles de verdad, «reducir movimiento», y que lo
  escrito no quede en el almacenamiento del navegador.
- `tests/test_coi_web_guardianes.py` (pytest): ninguna frase de las instrucciones de COI en `web/src/` ni en `web/dist/`, y ninguna API de
  almacenamiento en la pantalla; con una prueba de que el guardián de verdad CAE si la frase entra.

## Extensiones a archivos compartidos

- `web/src/nucleo/api.ts`: `mensajeDe` lee también `texto` de un `detail` objeto (COI y Biblioteca mandan `{codigo, texto, …}`). Antes un 422 con
  `detail` objeto decía «Revisa lo que escribiste: hay un dato que no es válido.» y la moderación perdía su motivo.
- `web/src/marca/Migas.tsx`: la miga `actual` sin `href` ni `alPulsar` se pinta como un chip quieto (`<span aria-current="step">`), no como
  un botón que no hace nada.
- `web/src/marca/menu.ts`: COI deja de ser «Próximamente» (`href: '/estudio/coi/'`, `pagina: 'coi'`). Las pruebas de `pantallas/inicio` que
  daban por «Próximamente» a las cuatro de Central › Distrito se leen ahora del propio mapa.

## Fuera de v1 (a propósito)

Editar un COI guardado, compartirlo, votar y un historial de lo que se armó **no están**. Lo guardado vive en «Míos» de la Biblioteca.
