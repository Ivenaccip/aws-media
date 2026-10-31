# Migración del Asistente (Automatizaciones, 20-oct-2026)

`web/src/pantallas/asistente/` → `/estudio/asistente/`. **El Asistente nace en la UI nueva: no tuvo pantalla vieja**, así que aquí no hay «aserciones viejas» que mapear. Se registra en
`server/migracion.py` como `retirada` desde el primer día (no hay HTML viejo que servir: `/asistente.html` solo es un atajo que responde 302 a la nueva, conservando el query) para que
el registro anti-pérdida (`tests/test_migracion_ui.py`) cubra sus invariantes como a las demás. Esa dirección no choca con nada: la página pública del RAG vive en `/automatiza` (y `/automatiza/…`,
en `server/app.py`), el API de esta pantalla en `/api/automatiza/*`, y ni `/asistente.html` ni `/constructor.html` existen en `static/`.

La persona cuenta con sus palabras qué quiere automatizar y el servidor le devuelve un flujo de n8n, que puede descargar como `.json` o abrir en el Constructor
(`docs/migracion/constructor.md`). **Hoy corre en modo «prueba» (Fase A): no usa ninguna IA.** El servidor elige, por las palabras del pedido, una de cuatro muestras enlatadas
(`media/library/n8n/muestras_prueba.json`) y la devuelve como si la hubiera armado; la pantalla lo dice con un letrero. **Gasto: cero**, y **no guarda ni registra el texto que la persona escribe**.
El modo real (RAG + un modelo de Claude) NO está implementado: exige el «sí» del dueño con el costo a la vista (abajo).

Piezas: `web/src/pantallas/asistente/` (pantalla), `server/automatiza_api.py` (las tres rutas), `pipeline/asistente.py` (la lógica pura, sin base ni cola ni proveedor), `media/library/n8n/muestras_prueba.json`
(las muestras) y `server/app.py` (el `include_router`, junto a COI y la Biblioteca).

## Cómo se llega

- **Menú:** `automatizaciones › distrito › asistente` en `web/src/marca/menu.ts` (ícono `magia`, `href: '/estudio/asistente/'`, texto «Cuéntanos qué quieres automatizar y te armamos el flujo.»), **sin `pagina`**
  (como COI, la Biblioteca y el Constructor: no se pinta con `<Marco>`). Desde el Inicio: mapa › Automatizaciones › Distrito › Asistente.
- **Migas:** «Automatizaciones › Distrito › Asistente», con el mismo `marca/EncabezadoHoja.tsx` que el Constructor (`LUGAR = { area: 'automatizaciones', grupo: 'distrito', pantalla: 'asistente' }`): el área abre el mapa y el grupo
  las opciones, estando «desde» esta pantalla; la última miga es un chip quieto. El único `h1` es «Irremplazables» (dorado); «Cuéntanos qué quieres automatizar» es un `h2`.
- **La página** (`web/estudio/asistente/index.html`): privada, con `auth.js` clásico ANTES del módulo y `monedero.js` (la píldora del saldo). **No carga `trabajos.js`**: el Asistente no pone avisos en la esquina;
  sus errores y anuncios van en la propia pantalla, con una sola región viva (`asistente.avisos.una_sola_region_viva_y_los_errores_no_se_duplican` y, en el navegador, `asistente.spec.ts`).

## Lo que esta pantalla NO hace (a propósito; plan D17)

- **No gasta ni cobra.** En modo prueba no se llama a ningún modelo, proveedor, moderación, créditos, base de datos ni cola; el botón dice «Armar flujo», sin estrella ni precio. Si el servidor dijera que
  cobra (`gratis` distinto de `true`, o ausente), **la pantalla no ofrece escribir**: todavía no sabe mostrar un costo y no ofrece nada antes de poder decirlo (`puedeOfrecer = activo && gratis`).
- **No guarda lo que la persona escribe.** Ni en el navegador (nada de `localStorage` ni `sessionStorage`; las llamadas no usan `apartar`, que deja el cuerpo en `sessionStorage` mientras vuela) ni en el servidor
  (no hay base: la línea del log del Asistente lleva solo `modo=prueba`, la clave de la muestra y el número de caracteres; el log de acceso del servidor, `peticiones`, anota la ruta de cada pedido y el `id` de la ruta codifica la muestra y un hash corto del usuario, nunca el texto). El único almacenamiento que toca la pantalla es el borrador del Constructor al «Abrir en el
  constructor», y ahí va el FLUJO que armamos, nunca el pedido.
- **No implementa el modo real** (Fase B): ni el cobro, ni los verbos ✦, ni la tabla de corridas, ni el límite por persona. Tampoco toca `permitidos.json` ni regenera `catalog.json`.
- **No tiene un importador n8n → grafo.** «Abrir en el constructor» solo se ofrece cuando la respuesta trae un `grafo` que el Constructor puede abrir (en prueba, las tres muestras «listo» lo traen).
- **No inventa pasos:** los cuatro de la espera son los que informa el servidor (`entender`, `buscar`, `armar`, `revisar`); en prueba los reparte el reloj del servidor, no un temporizador de la pantalla.

## Decisiones tomadas (plan de implementación de Automatizaciones, D1 a D17)

Las que aplican al Asistente (las de página, encabezado, avisos, íconos, colores y «lo que no entra» son las mismas del Constructor; ver `constructor.md`):

| # | Decisión | Por qué |
|---|---|---|
| D1 | Página propia y plana, `web/estudio/asistente/` | `server/web.py` no sirve carpetas anidadas; las llaves del registro no llevan guion |
| D2 | Encabezado de `marca/EncabezadoHoja.tsx`, sin `<Marco>` y sin `pagina` | el mismo molde de COI y la Biblioteca |
| D3 | El traspaso Asistente → Constructor pasa por el borrador (`localStorage`) del Constructor; antes de reemplazar un borrador con cuadros se pide confirmación | el JSON de un flujo pesa kilobytes y no cabe en la URL (el `?prompt=` de la Biblioteca corta a 1800 caracteres); además así no hay un segundo mecanismo de almacenamiento |
| D9 | Sin región viva duplicada: el Asistente no usa el cuadro de avisos de la esquina | una sola región viva (`role="status"`) y los cuadros de error se anuncian solos: así nada se anuncia doble |
| D14 | Visible en producción, con el letrero «Prueba: por ahora armamos flujos de ejemplo.» mientras `modo === 'prueba'` | si el Asistente aparece en el menú de producción mientras solo hay prueba es decisión del dueño; mientras tanto, lo honesto es mostrarlo diciendo que son ejemplos (`modo` viaja siempre en las respuestas) |
| D15 | Los límites del pedido son los de la API (`GET /config`: hoy 20 a 1500 caracteres), no los 600 del mockup | una sola fuente (`pipeline/publico.py`, donde el máximo es «PROVISIONAL hasta que el dueño ponga su número») |
| D16 | «Abrir en el constructor» solo con un `grafo` representable, pasando por el borrador | sin importador n8n → grafo: un flujo que el Constructor no sabe dibujar solo se puede descargar |
| D17 | Lo que NO entra: modo real, cobro y créditos, tabla de corridas, importador, «Actualizar flujos», «Tus automatizaciones» | cada una es un trabajo aparte y las de gasto exigen el «sí» del dueño |

## El contrato HTTP (`server/automatiza_api.py`)

Las tres rutas viven fuera de `/api/publico/`: `/api/automatiza/*` cae en `PREFIJOS_PROTEGIDOS` de `server/auth.py` (401 sin token cuando Cognito está activo) y la identidad es `db.usuario_actual()` (el `sub`), que solo
se usa para saber QUIÉN pregunta. Todas responden `Cache-Control: no-store` (éxitos y errores del módulo; el 401 de la sesión y el 404/405 del enrutado los contesta otra capa y no lo llevan).

| Ruta | Pide | Responde |
|---|---|---|
| `GET /api/automatiza/config` | nada | 200 `{activo, modo, gratis, costo_creditos, largo_minimo, largo_maximo, cupo}`; en prueba: `activo: true`, `modo: "prueba"`, `gratis: true`, `costo_creditos: 0`, `largo_minimo: 20`, `largo_maximo: 1500`, `cupo: null`. Con `activo: false` trae además `texto` (la frase lista para mostrarse). `modo` es `prueba`, `real` o `no_disponible` |
| `POST /api/automatiza/armar` | `{"texto": "…"}` (cuerpo de 64 KiB como máximo, leído con tope de bytes) | 202 `{id, estado: "armando", modo, paso: "entender", costo_creditos}`; el `id` es opaco |
| `GET /api/automatiza/armar/{id}` | el `id` | 200 con las llaves de cada estado (abajo) |

La pantalla decide por `activo` antes que por `modo`, y lee todo sin fiarse de su forma (`leerConfig`, `leerArmado`): una respuesta que no entiende es «Recibimos una respuesta que no entendemos».

**Llaves por estado** de `GET /armar/{id}` (lista blanca en `LLAVES_BASE` y `LLAVES_POR_ESTADO`; nunca se serializa una fila ni un resultado crudo): todos llevan `id`, `estado`, `listo`, `modo` y `lleva_seg`; además,

| Estado | Llaves |
|---|---|
| `armando` | `paso` (`entender`, `buscar`, `armar` o `revisar`) |
| `listo` | `nombre`, `resumen`, `nodos` (`[{tipo, nombre, etiqueta, nombre_en_flujo}]`: `nombre` es el de n8n, en inglés; `etiqueta` es el chip en español), `pendientes` («Conecta tu cuenta de X en n8n y elige el destinatario.»), `advertencias` (las del validador y, si el flujo abre un chat público, el aviso de que cualquiera con el enlace podrá escribirle), `flujo` (el JSON de n8n) y `grafo` (el mismo flujo como grafo del Constructor; llave OPCIONAL: sin `grafo` no se ofrece «Abrir en el constructor») |
| `sin_cobertura` | `mensaje`, `faltan` (una lista) |
| reservados para el modo real | `en_fila` (`lugar`), `no_salio` y `rechazada` (`mensaje`) |

Nunca viajan `uso`, `modelo`, `fuentes`, `intentos`, `costo_usd`, el texto del pedido ni la IP. `resumen`, `faltan` y `advertencias` pasan por `validador.SECRETOS`: si alguno parece una clave, ese campo se omite.
Un `id` mal formado, ajeno, caducado o de otra muestra es 404 `no_encontrada`, nunca 403.

**Errores:** el `detail` es un objeto `{codigo, texto, …extras}` con el `texto` listo para mostrarse (el cliente web ya lo lee: `nucleo/api.ts`).

| Código | Estado | Cuándo |
|---|---|---|
| `vacio` | 422 | no hay `texto` o está en blanco |
| `corto` | 422 | menos de `minimo` caracteres (viaja `minimo`) |
| `largo` | 422 | más de `maximo` caracteres, o un cuerpo de más de 64 KiB (viaja `maximo`) |
| `cuerpo` | 422 | JSON roto o que no es un objeto, o `texto` que no es texto |
| `texto_invalido` | 422 | trae U+0000 o un sustituto suelto (suele venir de pegar desde otro programa) |
| `no_encontrada` | 404 | el `id` no es propio y vigente |
| `no_disponible` | 503 | el modo real mal configurado o sin implementar, el archivo de muestras roto, y la red de seguridad para lo que ningún caso previó (nunca un 500 de texto plano) |
| reservados para la Fase B | | `moderacion` 422, `en_curso` 409, `agotado` 429, `sin_saldo` 402, `no_nube` 503 |

No se usa un modelo de Pydantic a propósito: su 422 por omisión devuelve el cuerpo recibido (el texto de la persona) y un `detail` que es una lista, no el objeto del contrato.

## El modo prueba (`pipeline/asistente.py`)

- **Qué modo corre** (`modo()`): la única rama que se activa sola es «prueba». El real exige cinco cosas a la vez (`ARMADO_REAL=1` y `AUTOMATIZA_ASISTENTE_REAL=1`, la fila del asistente encendida con topes en la base, el cobro por uso definido y
  `CREDITOS_BACKEND` y `STATE_BACKEND` en `postgres`) y lo mal configurado **no degrada en silencio a prueba** (mostraría un ejemplo enlatado como si fuera el flujo de la persona): da `no_disponible`. Con solo `ARMADO_REAL=1`
  —que DEV ya tiene encendido para el worker público— el Asistente sigue en prueba. En esta fase el modo real ni siquiera se sirve: `sirve()` solo acepta la prueba, así que aun con todo configurado la API contesta 503.
- **Las muestras** (`muestras_prueba.json`): cuatro. `sin_cobertura` (claves `hubspot`, `github`, `instagram`, `rss` y `calendar`: devuelve «Todavía no sabemos armar esto con n8n.» y lo que falta, para poder ver ese estado en pantalla), `correos`
  («Responder correos de clientes»; `correo`, `gmail`, `email`, `mail`), `preguntas` («Asistente de preguntas frecuentes»; `chat`, `preguntas`, `whatsapp`, `telegram`, `investig`) y `resumen_diario` («Resumen diario»), la de por omisión.
  Se normaliza el pedido (minúsculas, sin acentos) y gana la **primera** muestra, en el orden del archivo, cuya lista de claves tenga una subcadena; si ninguna, la de por omisión.
- **Todo lo que sale pasó por los validadores del repo:** cada muestra «listo» pasa `pipeline/validador.py` (lo mismo que pasaría el generador real) y su `grafo` cumple los invariantes del Constructor (`invariantes_del_grafo`, el port
  en Python de `invariantesDelGrafo`), se llama igual que el flujo y no trae nada que parezca una clave. Si el archivo de muestras tiene el menor problema, **falla cerrado**: `MuestrasInvalidas` → 503 `no_disponible`, sin detalles.
- **El estado se deriva del reloj, no hay fila en ninguna parte.** El `id` es `p1.<base64url(json)>` con tres llaves: `u` (los 12 primeros hex de `sha256(sub)`: de quién es), `t` (el instante de inicio, en milisegundos) y `m` (la clave de la muestra).
  Sin firma ni secreto: lo único que logra quien fabrique uno a mano es ver una muestra enlatada de su propio usuario. La validación es estricta (prefijo, alfabeto, 120 caracteres como máximo, JSON canónico con exactamente esas
  tres llaves, `u` igual al de quien pregunta, entre −60 s y 3600 s desde `t` y una muestra que exista) y todo lo demás es `no_encontrada`. La forma `p1.…` lleva un punto, que no existe en los ids reales
  (`[A-Za-z0-9_-]{16}`): nunca se confunden.
- **La espera:** cuatro pasos de 1.2 s (4.8 s en total): `entender`, `buscar`, `armar` y `revisar`; después, el final de la muestra (`listo` o `sin_cobertura`) hasta que el `id` caduca, a la hora. Los 4.8 s caben antes del primer sondeo de la
  web (a los 5 s: `ESCALERA` de `nucleo/sondeo.ts`), y lo fija una prueba. El reloj se inyecta (`ahora=`) para que las pruebas no esperen.
- **El pedido** (`revisar_texto`): se recorta; vacío, `texto_invalido` (U+0000 y sustitutos), `corto` (menos de 20) o `largo` (más de 1500, los límites de `pipeline/publico.py`). Del pedido solo se conserva el largo y la clave de la muestra, en el log:
  `automatiza: armar · modo=prueba · muestra=<clave> · chars=<N>`. No hay otro registro **del texto**; el log de acceso (`peticiones`, de `server/app.py`) sí anota cada ruta, y la del sondeo lleva el `id`, que decodifica a la clave de la muestra y al hash corto del usuario (nunca el texto).
- **Garantías de gasto cero** (`tests/test_automatiza_guardianes.py`, que cae si se quita cualquiera): (1) un recorrido AST: `pipeline/asistente.py` y `server/automatiza_api.py` solo importan lo que está en una lista blanca (y la lista negra de
  `anthropic`, `openai`, `google`, `boto3`, `langfuse` y los módulos que gastan o encolan, como segunda red); (2) en un intérprete limpio, importarlos no carga ningún SDK; (3) el recorrido completo funciona con los SDK «desinstalados»; (4) cero E/S:
  cada frontera de gasto o de red tiene un espía que revienta y un gancho de auditoría (`sys.addaudithook`) anota todo socket, toda escritura a disco y todo subproceso durante un recorrido completo, sin ninguno; (5) la matriz de `modo()`;
  (6) las rutas son solo las tres, ninguna pública; (7) ningún entorno de la infra enciende el modo real.

## Estado y flujo de datos (la pantalla)

- **`useArmado`** (`useArmado.ts`): al abrir pregunta `GET /config` (`activo`, `modo`, `gratis` y los límites). El pedido es `POST /armar` y luego se pregunta cómo va con la escalera **5, 5, 5, 10, 10 y 20 s** (`useSondeo`; el último paso se
  repite, se duerme con la pestaña oculta y vuelve a preguntar al volver). Las fases son `libre`, `armando`, `listo`, `sin_cobertura` y `fallo`. El doble clic manda **un solo** pedido (el candado se cierra antes de que React pinte «Armando…»);
  los pasos solo avanzan (una respuesta vieja no los regresa); una respuesta tardía de un armado anterior no pisa el de ahora; al desmontar se para el sondeo y se aborta lo que vuela. Un corte de red o un 502/504 no tumban el armado: se sigue
  preguntando y se dice «Sin conexión. Seguimos intentando…». Pasados **10 minutos** (`ESPERA_MAX_MS`) se deja de esperar, pero después de preguntar una última vez (la pestaña pudo estar oculta y el flujo ya estar listo).
- **Qué se ofrece:** escribir solo si `activo && gratis`. Con el servidor apagado (`activo: false`, o gratis ausente o falso) sale «No está disponible por ahora», con el `texto` del servidor y un enlace «Abrir el constructor», y no se ofrece el cuadro; si no se pudo ni leer la configuración, un error en tres partes con «Reintentar». Mientras `modo === 'prueba'` se ve el letrero
  «**Prueba: por ahora armamos flujos de ejemplo.** Elegimos el que más se parece a tu pedido. No guardamos lo que escribes.» y, en el resultado, «Ejemplo de prueba: lo elegimos por las palabras de tu pedido, no lo armamos a tu medida.»
- **El pedido:** un cuadro de texto con tres ejemplos (`EJEMPLOS` de `constructor/modelo/ejemplos.ts`; llenan el cuadro y el foco se queda en él), un contador «N de M caracteres» (y «· mínimo X» mientras falta), `maxLength` de cuatro veces el máximo
  del servidor (deja pasar un poco de más para poder decir «Es muy largo», pero no millones de caracteres que congelaban el navegador), Ctrl o Cmd + Intro para armar y la validación **junto al cuadro**: vacío («Escribe primero qué quieres automatizar,
  aunque sea en una frase.»), corto («…escribe al menos 20 caracteres. Llevas N.») y largo (el botón queda `aria-disabled`, dice cuánto lleva y pasarse del máximo se anuncia una sola vez). Los límites (20 y 1500) salen de la API; la pantalla no lleva los suyos.
  Los errores del pedido (`vacio`, `corto`, `largo`, `texto_invalido`, `moderacion`) se dicen junto al cuadro y mandan el foco a él (salvo `largo` mientras se escribe, que se dice solo y no mueve el foco); los demás van en tres partes (`ErrorTresPartes`: qué pasó, qué sigue y «Detalles técnicos» plegado) y dejan el foco donde estaba (en «Armar flujo»), salvo `no_encontrada`, que lo manda al cuadro porque hay que volver a escribir el pedido.
- **La espera:** «Armando…», los cuatro pasos de verdad (`EsperaPasos`), «Llevas 0:07» y, si el servidor lo dice, «Vas en el lugar N de la fila.»; el cuadro queda de solo lectura; la pestaña dice «Armando tu flujo · …» y, al final, «Tu flujo está listo · …».
- **El resultado** (`Resultado.tsx`): el nombre, los cuadros como chips en español, el resumen, «Antes de usarlo en n8n» (los pendientes), «Ten en cuenta» (las advertencias, en un `div` y no en un `Aviso`, que anunciaría cada resultado), «Descargar .json» (el **único** botón ámbar: «Armar flujo» pasa a
  secundario y dice «Armar otro flujo») y, si hay `grafo` abrible, «Abrir en el constructor». Todo lo que manda el servidor es TEXTO y se pinta como texto. Al llegar, el foco va a «Tu flujo está listo».
  Si el navegador no deja descargar (`nucleo/descargarArchivo.ts` devuelve `false`) se deja el JSON a la vista con «Copiar el JSON» (y, si tampoco se puede copiar, queda seleccionado). Un segundo clic en menos de 1 s no baja otro archivo.
- **`sin_cobertura` no es un error:** «Todavía no podemos armar esto», con lo que falta y «Cuéntalo con otras palabras, o arma tu flujo a mano en el constructor» (un enlace a `/estudio/automatizaciones/distrito/constructor/`, `URL_CONSTRUCTOR`).
- **El traspaso al Constructor** (`traspaso.ts`): el Asistente escribe el flujo como borrador del Constructor (`constructor.borrador.v1`, con `origen: "asistente"`, por `prepararTraspaso`) y navega a `/estudio/automatizaciones/distrito/constructor/` (`location.assign`; su lugar desde E7.3);
  el Constructor lo lee al abrir, dice «Abrimos tu flujo del Asistente.» y elige el primer agente. `sePuedeAbrir(grafo)` revisa forma, claves, topes e invariantes: si no se puede, el botón ni se ofrece. Si ya hay un flujo con cuadros en el Constructor se
  pregunta antes («¿Reemplazar tu flujo del constructor?», `Confirmar` de peligro, «Reemplazar y abrir»). Si el navegador no deja guardar (ventana privada, sin espacio) no navega y dice por qué, con el `.json` como salida. Un doble clic abre una sola vez
  y no pregunta si reemplazar lo que acaba de escribir.

## Accesibilidad

- **Foco:** nunca cae a `<body>`. Al llegar el resultado va a su encabezado; si falla por lo que se escribió (o hay que volver a escribirlo), al cuadro de texto; un fallo del servicio deja el foco en «Armar flujo» (moverlo justo cuando entra el aviso puede
  cortar su anuncio); los ejemplos mandan el foco al cuadro antes de irse; «Reintentar» lo deja en el cuadro (o en el título si hoy no se puede escribir).
- **Una sola región viva** (`role="status"`, `aria-live="polite"`) para la espera, lo copiado y lo descargado; los cuadros de error se anuncian solos (`role="alert"`), así que nada se anuncia doble. Un texto igual al anterior se vuelve a decir (un espacio final lo hace «nuevo»).
- El cuadro de texto lleva `aria-keyshortcuts="Control+Enter Meta+Enter"`, `aria-invalid` y `aria-describedby` hacia el contador y el error, y no se anuncia dos veces como región y como campo; el botón apagado se queda enfocable (`aria-disabled`) y explica por qué.
- Objetivos de 44 px o más, letra de 13 px o más y sin desborde horizontal a 1100, 390 y 320 px (el título y los resultados parten las palabras largas); sin animaciones con «reducir movimiento» (el e2e lo comprueba mientras arma y al llegar el resultado).

## Límites conocidos y decisiones PENDIENTES del dueño

Límites de hoy:

- Es una **prueba**: devuelve un ejemplo parecido, no un flujo hecho a la medida; con un pedido que no se parece a nada sale «Resumen diario».
- Las muestras «listo» son tres y siempre abren en el Constructor; un flujo real del generador puede traer nodos que el Constructor no dibuja (`if`, `code`, `manualTrigger`…) y por eso no habría «Abrir en el constructor»: solo descargar.
- Los 20 y 1500 caracteres son **provisionales** (los pone `pipeline/publico.py`).

Decisiones PENDIENTES (del dueño; no se tomaron aquí):

1. **Encender el modo real** (RAG + modelo): exige el «sí» del dueño **con el costo a la vista**. Falta, por ejemplo, el precio por armado (`tools/tarifas.json` no tiene `cobro_por_uso`; no se inventó ninguno), el tope diario y por persona, decidir qué
   clave paga la moderación, si el texto de las personas se guarda (y entonces actualizar el aviso de privacidad), y, para producción, desacoplar `publicado()` de `PUBLICO_QUEUE_URL` (`pipeline/publico.py`): hoy una cola para el Asistente publicaría también la sección pública `/automatiza`. Hasta entonces, el interruptor `AUTOMATIZA_ASISTENTE_REAL` queda ausente y nada gasta. Cuando exista, esta pantalla ya sabe leer
   `modo`, `gratis` y los códigos reservados, pero tendrá que aprender a mostrar el costo (hoy no ofrece escribir si el servidor cobra).
2. **`agentTool`** (D4): el Constructor lo exporta y el generador real no lo conoce; ver `constructor.md`.
3. **El validador `SECRETOS` de Python** (D4 y paridad): `secretos.ts` va por delante; ver `constructor.md`.
4. **Mover `coi/copiar.ts` a `nucleo/` y migrar COI y la Biblioteca a `EncabezadoHoja`:** el Asistente (`Resultado.tsx`) importa `copiarTexto` de `../coi/copiar`, una pieza de otra pantalla.
5. **Si el Asistente debe verse en producción mientras solo hay prueba** (D14): hoy sí, con su letrero.

## Cómo probarlo

Desde la raíz del repo (con el python del venv: `./venv/bin/python`; en Windows con Git Bash es `venv/Scripts/python`, como en `docs/OPERACION.md`):

```
cd web
npx vitest run src/pantallas/asistente              # 4 archivos, 96 pruebas (43 con ID registrado)
npm run verificar
npm run e2e
cd ..
./venv/bin/python -m pytest tests/test_automatiza_api.py tests/test_automatiza_asistente.py tests/test_automatiza_guardianes.py tests/test_automatiza_idioma.py -p no:cacheprovider -q
```

- **pytest** (528 pruebas, sin red, sin base y sin reloj de verdad): `tests/test_automatiza_api.py` (92) es el contrato HTTP y que nadie llamó a la base, la cola, un modelo, la moderación ni los créditos; `tests/test_automatiza_asistente.py` (214) la lógica pura y las
  muestras (cada una pasa el validador, la selección por palabras clave, el `id`, el reloj, la lista blanca de llaves y que el `grafo` es el de `ejemplos.ts`); `tests/test_automatiza_guardianes.py` (157) los guardianes de «gasto 0» de arriba; y `tests/test_automatiza_idioma.py` (65) la guarda de
  español LATAM con tuteo (mira las terminaciones del voseo, no una lista) sobre los errores, los mensajes y el texto de cada muestra.
- **e2e** (`web/e2e/asistente.spec.ts` y su apoyo `web/e2e/asistente.ts`, 60 pruebas) a **1100, 390 y 320 px** con el API simulado (`page.route`; no se llama a nada): medidas, **axe**, el foco, el sondeo de verdad (la primera pregunta llega a los 5 s, con el reloj adelantado), la descarga REAL del `.json`,
  cada error, el traspaso al Constructor por el borrador (con la pregunta si ya había uno), que el pedido no queda en el almacenamiento ni en las cookies, y «reducir movimiento».
- **Los e2e NO corren en CI:** el `docker build` solo corre `npm run verificar` en la etapa `web` (sin navegadores de Playwright) y ningún paso de `.github/workflows/docker.yml` ejecuta `playwright test`; la imagen final sí trae el Chromium del sistema, pero es para Remotion. Cada vez que se toque esta pantalla hay que correr `npm run e2e` a mano y **pegar la salida en el PR**. Corrida del 20-oct-2026: `cd web && npx playwright test e2e/constructor.spec.ts e2e/asistente.spec.ts` sobre el `dist/` ya compilado, 125 pruebas (60 de esta pantalla y 65 del Constructor), **todas pasaron** (1.5 min).

## Etapas

| Etapa | Qué pasa | Estado |
|---|---|---|
| `retirada` | `/estudio/asistente/` existe; `/asistente.html` → 302 siempre (no hubo vieja) | ⏳ al desplegar |

Antes de desplegar no hace falta migrar ninguna tabla (el modo prueba no usa base). Va en el mismo cambio que el mapa (`menu.ts`), el Constructor y el registro.

## Los invariantes (tests/test_migracion_ui.py)

Todos en `web/src/pantallas/asistente/` (2 de los 4 archivos de prueba de la carpeta llevan IDs), con ese nombre exacto: **43 IDs** registrados en `INVARIANTES["asistente"]` de `tests/test_migracion_ui.py`. No vienen de una pantalla vieja: son los compromisos del contrato con una prueba que cae si se quita el arreglo. Abajo están todos, agrupados por archivo de prueba (en el mismo orden que `INVARIANTES`: por ruta del archivo y luego por aparición), con una frase por grupo que dice qué protege. Un `it()` nuevo con forma de ID (`asistente.<tema>.<frase_sin_espacios>`) tiene que registrarse en `INVARIANTES` y aparecer aquí entre acentos graves, o el guardián cae.

### `Asistente.test.tsx` (35)

La pantalla entera, con el API simulado: encabezado y migas, un solo `h1` y un solo botón ámbar que cambia con el estado; el dinero (en prueba el botón dice «Armar flujo» sin estrella ni precio, y si el servidor cobra no se ofrece escribir); el letrero de prueba solo mientras `modo` es `prueba`; los límites del pedido salen de `GET /config`; el pedido se manda recortado y los pasos son los cuatro del servidor; el resultado (descargar, copiar si no se puede, «Abrir en el constructor» por el borrador, con su pregunta si ya hay uno); sin cobertura, no encontrada, apagado, 503 y sin conexión; el foco que nunca cae a `<body>`; una sola región viva; lo escrito no toca el almacenamiento; el título de la pestaña; las palabras largas no desbordan a 320 px.

- `asistente.marco.irremplazables_en_dorado_y_migas_automatizaciones_distrito_asistente_con_la_ultima_quieta`
- `asistente.marco.un_solo_h1_y_un_solo_boton_ambar_que_cambia_con_el_estado`
- `asistente.dinero.en_prueba_el_boton_dice_armar_flujo_sin_estrella_ni_precio`
- `asistente.dinero.si_el_servidor_cobra_no_se_ofrece_escribir_hasta_poder_mostrar_el_costo`
- `asistente.prueba.el_letrero_se_ve_mientras_el_modo_es_prueba_y_no_en_otro_modo`
- `asistente.limites.los_limites_salen_de_config_y_no_de_la_pantalla`
- `asistente.limites.demasiado_largo_apaga_el_boton_y_dice_cuanto_lleva`
- `asistente.limites.vacio_o_corto_se_dice_junto_al_cuadro_sin_mandar_nada`
- `asistente.armado.el_pedido_se_manda_recortado_y_los_pasos_son_los_cuatro_del_servidor`
- `asistente.armado.doble_clic_manda_un_solo_pedido`
- `asistente.resultado.muestra_nombre_resumen_chips_en_espanol_pendientes_y_advertencias`
- `asistente.resultado.descargar_baja_el_json_con_el_nombre_del_flujo`
- `asistente.resultado.si_no_se_puede_descargar_ofrece_copiar_el_json`
- `asistente.resultado.sin_grafo_no_ofrece_abrir_en_el_constructor`
- `asistente.resultado.abrir_en_el_constructor_pasa_el_grafo_por_el_borrador_y_navega`
- `asistente.resultado.con_un_borrador_existente_pide_confirmacion_antes_de_reemplazarlo`
- `asistente.resultado.si_el_traspaso_falla_lo_dice_y_no_navega`
- `asistente.estados.sin_cobertura_dice_el_mensaje_y_lo_que_falta`
- `asistente.estados.no_encontrada_dice_que_vuelvas_a_escribir_el_pedido`
- `asistente.estados.activo_falso_no_ofrece_escribir`
- `asistente.estados.el_503_y_la_falta_de_conexion_se_dicen_con_reintentar`
- `asistente.estados.sin_conexion_al_preguntar_se_ve_en_la_espera_y_se_anuncia_una_vez`
- `asistente.foco.al_llegar_el_resultado_va_al_encabezado_y_al_fallar_al_cuadro`
- `asistente.foco.los_ejemplos_pasan_el_foco_al_cuadro_antes_de_irse`
- `asistente.foco.reintentar_deja_el_foco_en_el_cuadro`
- `asistente.avisos.una_sola_region_viva_y_los_errores_no_se_duplican`
- `asistente.privacidad.lo_escrito_no_toca_el_almacenamiento`
- `asistente.pestana.la_pestana_dice_armando_y_al_final_listo`
- `asistente.estados.un_limite_o_un_armado_en_curso_no_invitan_a_pulsar_armar_flujo_otra_vez_como_si_nada`
- `asistente.resultado.un_doble_clic_en_abrir_en_el_constructor_abre_una_vez_y_no_pregunta_si_reemplazar`
- `asistente.limites.el_cuadro_tiene_un_tope_de_escritura_generoso_para_que_pegar_un_volcado_no_congele_la_pagina`
- `asistente.limites.pasarse_del_maximo_se_anuncia_una_sola_vez_en_la_region_viva_y_otra_al_volver_a_pasarse`
- `asistente.foco.un_fallo_del_servicio_no_le_quita_el_foco_al_boton_y_uno_del_texto_si_lo_manda_al_cuadro`
- `asistente.marco.el_cuadro_de_escribir_no_se_anuncia_dos_veces_como_region_y_como_campo`
- `asistente.marco.el_titulo_de_la_pantalla_parte_una_palabra_larga_en_vez_de_desbordar_a_320_px`

### `useArmado.test.tsx` (8)

El gancho que habla con el servidor: el sondeo sigue la escalera 5-5-5-10-10-20 s, se limpia y se cancela al desmontar, un doble envío en el mismo tic manda un solo pedido, sin conexión mientras pregunta sigue intentando y lo dice, y pasada la espera máxima deja de preguntar (una última vez, por si el flujo ya estaba listo).

- `asistente.armado.el_sondeo_usa_la_escalera_de_5_5_5_10_10_20_segundos`
- `asistente.armado.el_sondeo_se_limpia_al_desmontar`
- `asistente.armado.al_desmontar_se_cancela_lo_que_vuela`
- `asistente.armado.el_doble_envio_en_el_mismo_tic_manda_un_solo_pedido`
- `asistente.armado.sin_conexion_mientras_pregunta_sigue_intentando_y_lo_dice`
- `asistente.armado.pasada_la_espera_maxima_deja_de_preguntar_y_lo_dice`
- `asistente.armado.una_pestana_oculta_mas_de_diez_minutos_no_tira_un_flujo_que_el_servidor_ya_termino`
- `asistente.armado.pasada_la_espera_maxima_si_el_servidor_sigue_armando_se_rinde_despues_de_preguntar_una_ultima_vez`


## Pruebas sueltas (sin ID)

Las protege el registro de archivos de este doc, no el de IDs:

- `logica.test.ts` (29 pruebas) y `traspaso.test.ts` (5): los bordes de `logica.ts` (leer la configuración y las respuestas del servidor sin fiarse de su forma, validar el pedido, el nombre del archivo, los fallos) y del traspaso al Constructor (qué se puede abrir, qué dice cuando no). Las otras 19 pruebas sin ID de
  esta carpeta están en `Asistente.test.tsx` (11) y `useArmado.test.tsx` (8).
- `asistente.spec.ts` (Playwright): ver «Cómo probarlo».
- Las cuatro pruebas de Python de arriba (`tests/test_automatiza_*.py`), que no tienen ID: las vigila `pytest`, no este registro.
- `EncabezadoHoja.test.tsx`, `descargarArchivo.test.ts` y `AutomatizacionesRecorrido.test.tsx`: las piezas compartidas con el Constructor (ver `constructor.md`) y el recorrido del Inicio.

## Extensiones a archivos compartidos

Las mismas que las del Constructor (`menu.ts`, `EncabezadoHoja.tsx`, `descargarArchivo.ts`, íconos), más:

- `server/app.py`: `from server.automatiza_api import router as automatiza_router` y `app.include_router(automatiza_router)`.
- `server/migracion.py`: la entrada `asistente` (`retirada`).
