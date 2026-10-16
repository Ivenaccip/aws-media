# Biblioteca de prompts (Ajustes 3, 16-oct-2026)

`/estudio/biblioteca/` (`web/src/pantallas/biblioteca/`). **Pantalla nueva: no sustituye a ninguna.** Prompts listos para copiar y
usar, y un **top 3** que cada quien fija para recordar. Es la dirección B del lienzo («Taller de dos paneles») más el pin. Vive en
**Central › Distrito › Biblioteca de prompts** (`web/src/marca/menu.ts`: ya no es «Próximamente»).

No cobra nada: copiar, fijar, borrar uno propio y «Llevar a la caja» son gratis (crear, ya en la caja, sí cobra, como siempre).

- **De la casa**: los cura el dueño. Salen del archivo estático `server/biblioteca_casa.json` (lo edita el dueño; solo lectura para la
  web). Almacén PROPIO: nunca se mezcla con `prompts/` ni con `tools/prompts_sync.py` (los prompts internos del sistema).
- **Míos**: los que cada quien guardó desde COI. Privados: nunca se ve, se fija ni se borra lo de otra persona.
- **Fijados**: hasta 3, en orden, de la casa o propios. Los guarda el servidor (`PUT /api/biblioteca/fijados`).

## El API que lee (contrato de Ajustes 3, §2; lo construye el rol servidor)

| Llamada | Para qué |
|---|---|
| `GET /api/biblioteca` | UNA carga: `categorias`, `casa`, `mios`, `fijados` (ids que siguen existiendo, en orden) y `limites`. La búsqueda se hace en el navegador. |
| `PUT /api/biblioteca/fijados` `{ids}` | REEMPLAZA la lista; el orden importa. 422 `demasiados` · `repetido` · `desconocido`. |
| `DELETE /api/biblioteca/mios/{id}` | Borra un «mío» y lo quita de los fijados. 404 `no_es_tuyo` si no existe o es de otra persona. |

Los errores traen `detail` como OBJETO `{codigo, texto}` y el `texto` ya está listo para mostrarse: `web/src/nucleo/api.ts` lo lee
(antes solo conocía `detail.mensaje`), y su prueba está en `api.test.ts`. La pantalla nunca habla de `POST /api/biblioteca/mios`
(guardar): eso es de COI.

## Etapas

`server/migracion.py` la registra directo en **`retirada`** (`/biblioteca.html` → 302 a la nueva, sin HTML viejo ni cookie
`ui=clasica`): no hay nada que migrar ni a lo que volver. Se registra, y no se deja fuera, para entrar al guardián de invariantes de
`tests/test_migracion_ui.py` y a este mapa como las demás.

## Los invariantes (tests/test_migracion_ui.py)

Todos en `web/src/pantallas/biblioteca/Biblioteca.test.tsx`, con ese nombre exacto. No vienen de una pantalla vieja: son los
compromisos del contrato (dinero, aislamiento, pin, accesibilidad) con una prueba que cae si se quita el arreglo.

| ID | Qué garantiza |
|---|---|
| `biblioteca.carga.una_sola_lectura_con_conteos_por_categoria` | una sola lectura de `GET /api/biblioteca`; la lista sale en el orden del servidor, los chips dicen cuántos hay por categoría y el primero queda elegido |
| `biblioteca.carga.cargando_y_error_con_reintentar` | «Cargando la Biblioteca…» mientras llega; un fallo dice «No pudimos cargar la Biblioteca» con «Reintentar», que pide otra vez y no deja el cargando colgado |
| `biblioteca.carga.sin_red_pide_revisar_la_conexion` | sin red el error dice «No hay conexión. Revisa tu internet…» y ofrece reintentar |
| `biblioteca.carga.vacia_manda_a_coi` | sin nada de la casa ni propio: «Aún no hay prompts en la Biblioteca» y el único ámbar es «Diseñar un prompt con COI» |
| `biblioteca.buscar.sin_acentos_ni_mayusculas_sobre_titulo_para_que_etiquetas_y_categoria` | la búsqueda ignora tildes y mayúsculas y mira título, «para qué sirve», etiquetas y nombre de categoría; con varias palabras, todas |
| `biblioteca.buscar.sin_resultados_ofrece_coi_y_quitar_filtros` | sin resultados: «No encontramos ese prompt», con «Diseñar uno con COI» (el único ámbar) y «Quitar filtros» |
| `biblioteca.buscar.chips_con_conteo_que_siguen_a_la_busqueda_y_filtran_por_categoria` | los números de los chips siguen a la búsqueda (no a la categoría elegida); un chip filtra y el resumen lo dice |
| `biblioteca.buscar.una_etiqueta_del_detalle_filtra_y_se_quita` | tocar `#etiqueta` en el detalle filtra por ella; su chip la quita |
| `biblioteca.lista.una_parada_de_tab_con_flechas_inicio_y_fin` | la lista es UNA parada de Tab (`tabindex` 0 en una fila); ↑ ↓ Inicio y Fin mueven el foco sin elegir; Enter elige; Tab sale de la lista |
| `biblioteca.copiar.usa_el_portapapeles_y_confirma_sin_mover_el_foco` | `navigator.clipboard.writeText` con el prompt entero; el botón confirma («Copiado»), la región viva lo anuncia, el foco no se mueve y el botón vuelve solo |
| `biblioteca.copiar.reserva_con_el_metodo_viejo_si_el_navegador_niega_la_api` | si el navegador niega la API moderna, `execCommand('copy')` |
| `biblioteca.copiar.ultima_reserva_deja_el_prompt_seleccionado_y_lo_dice` | si tampoco eso: el prompt queda SELECCIONADO, se dice cómo copiarlo y no se miente con «Copiado» |
| `biblioteca.llevar.imagen_y_video_van_al_inicio_con_el_texto_codificado` | Imagen → `/estudio/inicio/?prompt=`, Video → `?brief=`, con `encodeURIComponent`; el texto vuelve idéntico al leer la dirección |
| `biblioteca.llevar.guion_e_investigacion_y_los_mios_solo_se_copian` | Guion, Investigación y todo «mío» no tienen «Llevar a la caja» |
| `biblioteca.llevar.el_ambar_es_llevar_si_existe_y_copiar_si_no_y_nunca_hay_dos` | un solo botón ámbar: «Llevar a la caja» si existe y «Copiar» si no; el interruptor del pin no es ámbar |
| `biblioteca.llevar.mas_de_1800_caracteres_solo_se_copian` | 1800 se lleva; 1801 solo se copia, y lo dice |
| `biblioteca.llevar.el_texto_es_texto_nunca_html` | título, para qué sirve, etiquetas y prompt se pintan como texto: nada de lo que traen se vuelve HTML ni rompe la dirección |
| `biblioteca.fijar.interruptor_con_aria_pressed_que_se_guarda_en_el_servidor` | «Fijar» ↔ «Quitar de fijados» con `aria-pressed` y el título en su nombre; cada cambio manda la lista entera por `PUT` |
| `biblioteca.fijar.el_estado_viene_del_servidor_y_lo_que_ya_no_existe_no_se_ensena` | los fijados salen del servidor, en su orden; un id huérfano no ocupa casilla |
| `biblioteca.fijar.es_optimista_y_vuelve_atras_si_el_servidor_falla` | se ve al instante, con la petición en vuelo; si falla, vuelve a lo confirmado y dice el texto del servidor |
| `biblioteca.fijar.sin_red_tambien_vuelve_atras` | lo mismo sin conexión: «No hay conexión…» y todo como estaba |
| `biblioteca.fijar.con_tres_ya_fijados_no_sustituye_en_silencio_y_no_mueve_el_foco` | con 3 fijados, el cuarto avisa «Ya tienes 3 fijados. Quita uno para fijar este.», no pide nada, no cambia nada y deja el foco en el botón |
| `biblioteca.fijar.la_franja_siempre_tiene_tres_casillas_numeradas_y_las_vacias_dicen_como_llenarse` | «Tus 3 fijados»: tres casillas 1·2·3; las vacías dicen «Fija aquí un prompt que quieras recordar»; cada llena abre su prompt |
| `biblioteca.fijar.subir_bajar_y_quitar_guardan_el_orden_y_el_foco_se_queda_en_el_mismo_boton` | subir, bajar y quitar guardan el orden; el foco sigue en el mismo botón aunque la casilla cambie de lugar y nunca cae a `<body>`; los extremos quedan `aria-disabled` y no hacen nada |
| `biblioteca.fijar.una_peticion_a_la_vez_y_gana_el_ultimo_cambio` | con cambios seguidos solo vuela UNA petición; al volver sale una más con el estado final (las del medio nunca salen) |
| `biblioteca.fijar.lo_que_el_servidor_omite_no_se_queda_en_la_pantalla` | si el servidor devuelve la lista sin un id, la pantalla se queda sin él |
| `biblioteca.fijar.un_mio_tambien_se_fija_y_su_casilla_lo_abre_desde_la_casa` | un «mío» se fija igual; desde «De la casa», su casilla abre ese prompt en «Míos» |
| `biblioteca.mios.el_conmutador_cambia_de_lista_y_sin_ninguno_manda_a_coi` | «De la casa / Míos» con su conteo; sin ninguno: «Todavía no guardas ninguno. Arma uno con COI y pulsa «Guardar».» y enlace a COI |
| `biblioteca.mios.borrar_pide_confirmar_y_lo_quita_tambien_de_los_fijados` | «Borrar» solo en los míos; pide confirmar (Cancelar no borra); borra ESE id, lo quita de la lista y de la franja sin un `PUT` de más |
| `biblioteca.mios.si_no_se_pudo_borrar_lo_dice_y_el_prompt_se_queda` | un fallo al borrar lo dice junto al prompt y el prompt se queda |
| `biblioteca.mios.un_404_no_es_tuyo_es_que_ya_no_estaba_y_se_quita_igual` | `no_es_tuyo` = ya no existe: se quita sin alarmar |
| `biblioteca.celular.dos_pasos_elegir_pasa_al_segundo_con_el_foco_en_el_titulo_y_volver_regresa_a_la_fila` | en celular: «1 Elige» → «2 Úsalo»; elegir pasa al segundo con el foco en el título del prompt y «Volver a la lista» regresa a su fila |
| `biblioteca.marco.irremplazables_arriba_y_migas_de_tres_niveles_que_reabren_su_nivel` | un solo `h1` («Irremplazables»), sin ícono ni tarjeta; migas «Central › Distrito › Biblioteca de prompts»: las dos primeras reabren el mapa y las opciones (`?desde=…&ver=…`) |
| `biblioteca.marco.los_enlaces_a_coi_son_enlaces_a_su_pantalla` | «Ir a COI» es un enlace a `/estudio/coi/` (la pantalla es de otro rol: aquí no se importa nada de ella) |
| `biblioteca.seguridad.no_guarda_nada_en_el_navegador` | ni `localStorage` ni `sessionStorage`: ni prompts, ni búsquedas, ni fijados |
| `biblioteca.dinero.nada_cobra_ni_crea_solo_lecturas_el_put_de_fijados_y_el_delete_de_un_mio` | las únicas escrituras son `PUT /fijados` y `DELETE /mios/{id}`; el saldo no se toca |
| `biblioteca.accesibilidad.los_avisos_van_a_una_region_viva_y_cada_boton_dice_sobre_que_actua` | una región `aria-live` anuncia copiar, fijar, borrar y elegir; los botones de la franja y el interruptor llevan el título en su nombre |

### Pruebas sueltas (sin ID)

- `logica.test.ts`: los bordes de `logica.ts` (leer una respuesta rara, buscar, fijar y mover, la dirección de «Llevar a la caja»).
- `web/e2e/biblioteca.spec.ts`: lo que jsdom no ve, a 1100 y a 390 px: que no se arrastre de lado, objetivos de 44 px, letra de 13,
  el aro de foco en cada parada, un solo ámbar, el portapapeles de verdad, el orden de Tab, **axe** sin violaciones en cada estado y
  el viaje completo «Llevar a la caja» → inicio real. (El guardián de «reducir movimiento», `movimiento-reducido.spec.ts`, la
  recoge sola: lee `web/estudio/`.)
- `Llegada.test.tsx` (en `web/src/pantallas/inicio/`): llegar al inicio con `?prompt=` o `?brief=` (ver abajo).

## «Llevar a la caja» y el inicio

Imagen → `/estudio/inicio/?prompt=<texto>`; Video → `/estudio/inicio/?brief=<texto>`. Solo prompts de hasta **1800** caracteres (y, con
tildes, de dirección de hasta 6000: más largos solo se copian), siempre con `encodeURIComponent`. **Nunca crea ni cobra**: es un enlace.

El inicio (`pantallas/inicio/`) aprendió a leerlos, con cambios mínimos:

- `estadoRecorrido.ts`: `leerLlegadaDeTexto(busqueda)` (con los dos, gana `prompt`; vacío o solo espacios no cuenta; se corta a los 5000
  del cuadro) y `estadoInicial`, que con texto abre la caja (Marketing › Distrito) en lugar del mapa. `urlSinEntrada` quita también
  `prompt` y `brief`: el inicio los lee UNA vez y `history.replaceState` limpia la dirección (recargar no vuelve a llenar la caja).
- `Inicio.tsx` lee el texto una vez y se lo pasa a `Caja`; `Caja.tsx` arranca en «Crear una imagen» (Imagen) o «Un video corto» (Video)
  con el texto puesto, lleva el foco a su cuadro, y dice **«Te trajimos el prompt. Cambia lo que va entre [corchetes] y pulsa Crear.»**
  (un prompt sin huecos dice «Te trajimos el prompt. Revísalo y pulsa Crear.»). El aviso se va al crear, al cambiar de pestaña o al
  vaciar el cuadro; el cuadro queda `aria-describedby` de él.
- Sin parámetros no cambia nada: el mismo mapa, la misma caja en Video, el foco donde estaba.

**Plan B** (si el inicio diera problemas): en `logica.ts` la tabla `DESTINO` es la ÚNICA que sabe a dónde lleva cada caja; cambiar
`ruta` de `/estudio/inicio/` a `/estudio/imagenes/` (parámetro `prompt`) y `/estudio/clip/` (parámetro `brief`) lleva directo a las
pantallas que ya leían esos parámetros. No hace falta tocar nada más (la prueba de la dirección lo dirá).

## Lo que NO está (v1, a propósito)

Editar un «mío», sugerir un prompt, votar y crear uno a mano. Se guarda desde COI (`Guardar`) y se borra aquí; nada más.

## Lo que se tocó fuera de la carpeta

`web/src/marca/menu.ts` (la fila de la Biblioteca: `href` y su texto, sin `proximamente`; sin `pagina` a propósito, porque esa clave exige un
`<Marco pantalla="…">` y esta pantalla lleva su propio encabezado), `web/src/nucleo/api.ts` (`detail.texto`), `web/src/ui/iconos.ts` +
`static/iconos.js` (Copiar, Fijar, Llevar, Investiga), `server/migracion.py`, `docs/DISENO.md` (el interruptor), `docs/QA-UI.md` (§
biblioteca), y las pruebas del inicio que contaban cuatro «Próximamente» en Central › Distrito (`Pantallas.test.tsx`,
`Recorrido.test.tsx`, `inicio-recorrido.spec.ts`).
