# Migración del Constructor (Automatizaciones, 20-oct-2026)

`web/src/pantallas/constructor/` → `/estudio/constructor/`. **El Constructor nace en la UI nueva: no tuvo pantalla vieja**, así que aquí no hay
«aserciones viejas» que mapear. Se registra en `server/migracion.py` como `retirada` desde el primer día (no hay HTML viejo que servir:
`/constructor.html` solo es un atajo que responde 302 a la nueva, conservando el query) para que el registro anti-pérdida
(`tests/test_migracion_ui.py`) cubra sus invariantes como a las demás.

Esa dirección no choca con nada: la página pública del RAG vive en `/automatiza` (y `/automatiza/…`, en `server/app.py`), el API del Asistente en
`/api/automatiza/*`, y ni `/constructor.html` ni `/asistente.html` existen en `static/`. El hermano de esta pantalla es el Asistente
(`docs/migracion/asistente.md`): desde ahí se puede «Abrir en el constructor».

El Constructor es **un lienzo estilo n8n, 100 % en el navegador**, donde la persona arma su flujo cuadro por cuadro (un disparador, hasta 4 agentes de IA y
hasta 8 apps) y descarga un archivo `.json` que se importa en n8n (menú «⋯» › «Import from File»). **No cobra, no llama a ningún servicio y no manda el
flujo a ninguna parte.** Lo único que guarda es un borrador en el propio navegador (abajo, con sus reglas y límites).

## Cómo se llega

- **Menú:** `automatizaciones › distrito › constructor` en `web/src/marca/menu.ts` (ícono `flujo`, `href: '/estudio/constructor/'`, texto «Arma tu flujo
  cuadro por cuadro y descárgalo para n8n.»). Desde el Inicio: mapa › Automatizaciones › Distrito › Constructor (ver `inicio.md`).
- **Sin `pagina`** en el mapa, a propósito, igual que COI y la Biblioteca: esa clave exige un `<Marco pantalla="…">` (`Marco.test.tsx`) y esta pantalla
  lleva su propio encabezado.
- **Migas:** «Automatizaciones › Distrito › Constructor», dibujadas por `marca/EncabezadoHoja.tsx` con `LUGAR = { area: 'automatizaciones', grupo:
  'distrito', pantalla: 'constructor' }` (título e ícono salen del mapa; si el lugar no existe lanza). El área abre el mapa y el grupo las opciones del
  área, directo a sus páginas (`/estudio/` y `/estudio/automatizaciones/`, `urlDeInicio`; antes iban a `/estudio/inicio/?desde=…&ver=…`); la última
  miga es un chip quieto con `aria-current="step"`. El único `h1` es «Irremplazables» (dorado, `texto-oro`); «Arma tu automatización» es un `h2` con
  `tabindex=-1` y es adonde cae el foco si lo que pidió el reductor no existe.
- **La página** (`web/estudio/constructor/index.html`): privada, con `auth.js` clásico ANTES del módulo, `monedero.js` (la píldora del saldo), `iconos.js` y
  `trabajos.js` (el cuadro de avisos de abajo a la derecha). Esos scripts piden por su cuenta `/api/auth/config`, `/api/creditos` y `/api/trabajos`
  (y `trabajos.js` pone «Sin conexión. Reintentando…» al cortarse internet aunque el lienzo siga funcionando); **el código de la pantalla no hace un solo
  pedido** (lo fija `constructor.pantalla.no_llama_a_ningun_servicio_ni_cobra_en_todo_lo_que_hace`, que sustituye `fetch` y exige cero llamadas, y el
  e2e exige vacío todo `/api/` que no sea de esos scripts).

## Lo que esta pantalla NO hace (a propósito; plan D17)

- **No cobra ni lleva ✦.** No hay precios en la pantalla; el botón principal es «Descargar .json».
- **No manda el flujo a un servidor ni lo guarda allí.** Tampoco existe todavía «Tus automatizaciones» (guardar flujos por persona), que es otro trabajo.
- **No importa archivos de n8n.** No hay importador n8n → grafo: un flujo solo entra por el borrador o por el traspaso del Asistente, y ya como grafo del
  Constructor (pasa por la misma limpieza, abajo).
- **No ofrece lo que no sabe exportar:** 4 disparadores (Tiempo, Chat, Web y App —Gmail o Telegram—), el agente de IA con 4 proveedores, 10 apps con conector
  listo y «¿Otra app?» (que sale como un HTTP Request que la persona configura en n8n). Nada de `manualTrigger`, `if`, `code`…
- **No toca `permitidos.json` ni regenera `catalog.json`**, y no cambia nada del RAG (decisiones D4 y D17).
- **No tiene «Actualizar flujos»** (está en el mapa apagada, «Próximamente», sin página).
- **No pone colores de marca por app:** las apps se distinguen por ícono y nombre; todo color sale de un token de `tokens.css` (D12).

## Decisiones tomadas (plan de implementación de Automatizaciones, D1 a D17)

El dueño no contestó las sub-decisiones; se adoptó la opción que recomendaron los lectores del repo y se le informa. Las que aplican a esta pantalla:

| # | Decisión | Por qué |
|---|---|---|
| D1 | Dos páginas planas, `web/estudio/constructor/` y `web/estudio/asistente/` | `server/web.py` solo monta las carpetas con `index.html` directo bajo `dist/estudio/`: una anidada daría 404 en producción; la llave del registro tiene que cumplir `^[a-z0-9_]+$` (sin guion); y `automatiza` choca con las rutas públicas del RAG |
| D2 | Encabezado propio (`marca/EncabezadoHoja.tsx`): «Irremplazables» dorado, migas de tres niveles con la última quieta; sin `<Marco>` y sin `pagina` | es el molde de COI y la Biblioteca; con `<Marco>` el contenido quedaría en 1080 px (angosto para un lienzo; el Constructor usa 1280) y las migas serían de dos niveles |
| D3 | Borrador en `localStorage`, versionado, validado contra los invariantes al cargar, sin texto que parezca una clave, guardado diferido más inmediato al salir | el lienzo es trabajo de la persona y la sesión puede caducar a media edición (`auth.js` navega a Cognito y se perdería); además es el traspaso Asistente → Constructor |
| D4 | `agentTool` («dos IA que conversan») se exporta, pero no se toca `permitidos.json` ni el RAG | permitirlo globalmente cambia lo que el RAG público puede armar (y exigiría ingesta de documentación, que gasta): es del dueño. La paridad lo trata como «rechazado hoy; válido si se permitiera» |
| D5 | Sin modelo fijo para Anthropic, Gemini y OpenRouter; OpenAI usa el de `permitidos.json` | el mockup fijaba `claude-haiku-5-5`, que no existe en el repo ni se pudo verificar: n8n usa el modelo que trae por defecto. El de OpenAI (`gpt-5.4-mini`) lo decidió el dueño el 30-sep-2026 y lo vio en la lista «From list» |
| D6 | 10 apps + «¿Otra app?» (HTTP Request); catálogo = tabla escrita a mano en TypeScript con una prueba de paridad contra `catalog.json` y `permitidos.json` | el navegador no necesita los 568 nodos del catálogo; la fuente de verdad sigue siendo `permitidos.json` y lo que importa es no contradecirla (un chequeo, no una copia) |
| D7 | Topes: 1 disparador, 4 agentes, 8 apps (13 cuadros) | los del mockup; el reductor es la ÚNICA barrera, también al cargar un borrador o un flujo ajeno |
| D8 | «Deshacer» es una pila real de hasta 20 instantáneas | el mockup guardaba una sola copia y la perdía al editar (defecto confirmado); la auditoría de UX ya lo pedía («Escena 3 eliminada · Deshacer», `docs/UX-REVIEW.md`) |
| D9 | Los avisos van al cuadro global de abajo a la derecha (`window.avisos`), ampliado con una `accion` | `static/trabajos.js` ya soportaba el botón del aviso; solo faltaba tiparlo en `nucleo/avisos.ts` y `nucleo/globales.ts`. Una sola voz para el lector de pantalla |
| D10 | «Limpiar» pregunta con `ui/Confirmar` (peligro) y además se puede deshacer | el «Sí, borrar todo» en línea del mockup no tiene precedente en la app |
| D11 | 9 íconos nuevos, idénticos en `web/src/ui/iconos.ts` y `static/iconos.js`: `flujo`, `chat`, `web`, `app`, `enlace`, `unSentido`, `idaYVuelta`, `papelera`, `codigo` | `test_los_iconos_son_los_de_iconos_js` exige la misma cadena en los dos archivos |
| D12 | Solo tokens de color; ningún `#hex` ni `rgb()` en `web/src/` ni en los `.html` de `web/` | `test_m20_paleta.py` lee los `.html` de `web/` y los `.ts`, `.tsx` y `.css` de `web/src/`, comentarios incluidos (no lee `web/e2e/`: los e2e comparan colores ya calculados por el navegador y por eso llevan `rgb(…)` literales, por ejemplo `rgb(218, 140, 40)` para el botón ámbar); el dorado solo con la clase `texto-oro` |
| D13 | `select` nativo y paneles a mano; ninguna dependencia nueva | `package.json` pide versiones exactas y no hay librería de menús flotantes; el panel del mockup (que hace crecer el lienzo) se replicó |
| D17 | Lo que NO entra: modo real del Asistente, cobro, tabla de corridas, `permitidos.json`, regenerar `catalog.json`, importador n8n → grafo, «Actualizar flujos» y «Tus automatizaciones» | cada una es un trabajo aparte y varias exigen el «sí» del dueño (gasto o cambio del RAG) |

(D14, D15 y D16 son del Asistente: `asistente.md`.)

## Estado y flujo de datos

Todo vive en `web/src/pantallas/constructor/modelo/` (puro: sin React, sin DOM, sin reloj) y los componentes solo dibujan y devuelven eventos.

- **Reductor puro** (`modelo/reductor.ts`): `reducir(estado, accion)` con 24 acciones (elegir el disparador, abrir y cerrar menús, crear, conectar, cambiar
  el tipo de una conexión, quitar, mover, editar, renombrar, limpiar, cargar el ejemplo o un flujo ajeno, deshacer…). Es la **única** puerta por la que
  cambia el flujo (`Constructor.tsx` usa `useReducer(reducir, …)`). Nunca modifica el estado ni las listas que recibe; si no pasó nada (un id que ya no
  existe, una acción que no viene al caso) devuelve el MISMO objeto; y su último paso, `sanear`, deja que nada apunte a lo que ya no existe, que no haya
  a la vez un cuadro y una conexión elegidos y que no convivan el menú y el modo «conectando».
- **Estado** (`EstadoConstructor`, `modelo/tipos.ts`): `flujo` (`nodes`, `edges`, `nombreFlujo`), la selección (`sel` o `selEdge`, nunca las dos), `menu`,
  `conectando`, `historial`, `siguiente` (el contador de ids), las peticiones de interfaz (`foco`, `ver`, `scrollAjustes`), `aviso` y `eventos`. **Lo único
  que se guarda como borrador es `flujo`.**
- **Selectores** (`modelo/selectores.ts`): funciones puras que convierten el estado en lo que se pinta (`vistaNodos`, `vistaFlechas`, `vistaLienzo`,
  `vistaMenu`, `vistaAjustes`, `vistaEnlace`, `vistaElegirDisparador`, `guia`, `resumenFlujo`, `textoConectar`, `textoSinSeleccion`, `panelDeAjustes`…).
  Nunca devuelven `NaN`, `undefined` ni objetos compartidos entre llamadas.
- **Efectos como peticiones.** El reductor no toca el DOM: deja en el estado a dónde debe ir el foco (`foco`: un cuadro, un «+», la insignia de una flecha, Ajustes,
  la primera opción del menú…), qué cuadro hay que traer a la vista del marco (`ver`), si hay que llevar Ajustes a la vista (`scrollAjustes`) y el último
  `aviso`. `Constructor.tsx` los cumple en un efecto y los apaga con `limpiarPeticiones` (con `hasta`, no pisa una petición más nueva). El contrato de
  atributos lo ponen los componentes: `data-nodo`, `data-quitar`, `data-mas` (`der-<id>`, `tool-<id>` o `medio`), `data-insignia`, `data-foco="1"`,
  `data-enl="1"` e `id="ajustes"`. Si lo pedido todavía no existe se reintenta en el siguiente cuadro y, si tampoco, cae al primer cuadro, a Ajustes, a la primera
  opción o al título: **el foco nunca cae a `<body>`**.
- **Ids y contador.** Los cuadros son `t<n>` (disparador), `a<n>` (agente) y `p<n>` (app); las conexiones, `e<n>`. `siguiente` arranca en 20 y **nunca baja**
  (ni al deshacer): al abrir un flujo de afuera es `max(20, mayor número que termine algún id + 1)` (`contadorParaFlujo`; los sufijos de más de 12 cifras no cuentan y
  un contador de afuera por encima de 999 999 999 999 se ignora, porque con él los ids se repetirían). El ejemplo y las muestras traen ids bajos (`t1`, `a1`, `a2`, `p1`, `e1`…)
  para no chocar. El borrador NO guarda el contador: al recargar sale del flujo.
- **Topes** (`modelo/datos/constantes.ts`): 1 disparador, 4 agentes, 8 apps = 13 cuadros; hasta 200 conexiones al abrir un flujo de afuera; cada cuadro con `x` e `y`
  entre 0 y 2400, acomodado a una rejilla de 8 px; el cuadro mide 216 × 96 y el lienzo, mínimo 1000 × 780. Textos: nombre del flujo 80 caracteres, nombre de un
  agente o de una app 60, tarea e instrucciones 4000, «para qué sirve» de un ayudante 1000, ruta del webhook 100; el nombre de un nodo en el archivo de n8n, 100.
  Se recortan sin partir un emoji y sin dejar pasar caracteres de control ni de dirección. Los topes de cuadros los pone el reductor y al pasarse el aviso dice «Por ahora son hasta 4 agentes por flujo.» / «Por ahora son hasta 8 apps por flujo.»
  (un segundo disparador, «Por ahora es un solo disparador por flujo.»); en el menú, la opción bloqueada por un tope usa `aria-disabled` y dice su motivo.
- **Reglas de conexión** (`modelo/grafo.ts`): `puedeEnlazar` evalúa 12 reglas en un orden fijo y gana la primera que falla, con el motivo escrito para la persona
  (no se conecta un cuadro consigo mismo ni dos veces igual, nada llega a un disparador, una herramienta o un ayudante no es un paso, no hay círculos, solo un agente
  tiene herramientas o conversa con otra IA, un cuadro tiene a lo sumo un padre). «Por la patita solo van apps» es una regla de la interfaz que se aplica además.
  `invariantesDelGrafo` es la comprobación completa de un flujo (23 códigos de violación).
- **Deshacer** (D8). Una pila de hasta **20** instantáneas (las más viejas se descartan). **Entran** las acciones que cambian la estructura: agregar el disparador o
  un cuadro, conectar con uno que ya está, cambiar el tipo de una conexión, poner un cuadro en medio, quitar un cuadro o una conexión, limpiar, cargar el ejemplo o un
  flujo ajeno (`cargarFlujo`, que hoy ningún botón usa: el Asistente pasa el flujo por el borrador; estas, de clase `cargar`, se deshacen enteras). Su aviso ofrece el botón «Deshacer» solo cuando QUITA o REACOMODA (quitar, limpiar, cambiar el tipo, poner en
  medio, cargar); agregar y conectar entran en la pila, pero su aviso no lo ofrece (el botón de la barra y Ctrl/Cmd+Z sí las deshacen). **No entran:** mover un cuadro
  (con el puntero o con el teclado), teclear en Ajustes, renombrar el flujo, seleccionar, abrir y cerrar menús, empezar o cancelar una conexión. **Qué la tira:** ninguna
  acción de la persona. Mover, teclear y renombrar *no* vacían la pila: anotan en cada instantánea qué cuadros se tocaron después (`tocados`) y si se renombró el flujo
  (`nombreTocado`), y al deshacer devuelven lo estructural pero conservan lo movido, lo escrito y el nombre de ahora. La pila empieza vacía cuando el reductor
  arranca de nuevo (recargar la página; el historial no se guarda en el borrador). «Deshacer» desde el aviso manda el `id` de ese aviso y solo vale si es el de la
  instantánea de arriba: si no, dice «Eso ya no se puede deshacer: cambiaste algo después.»; con la pila vacía, «Ya no hay nada que deshacer.». Tampoco devuelve el
  contador de ids. Ctrl/Cmd+Z hace lo mismo, salvo con el foco en un campo de texto o en un diálogo modal (ahí deshace el navegador lo escrito).
- **Borrador en `localStorage`** (D3; `modelo/borrador.ts` es puro y recibe el almacenamiento; `useBorrador.ts` toca `window`):
  - llave `constructor.borrador.v1`; el contenido lleva `v: 1`, solo `nodes`, `edges` y `nombreFlujo` (y `origen: "asistente"` si lo escribió el Asistente); nada de selección,
    menú, historial ni avisos;
  - se lee UNA vez, al montar, ANTES de guardar nada (guardar un lienzo vacío lo borraría); lo que se leyó no se vuelve a escribir sin cambios;
  - se guarda 500 ms después del último cambio (`ESPERA_GUARDADO_MS`) y de inmediato en `auth:saliendo` (la sesión caducó y `auth.js` está por navegar a Cognito) y en
    `pagehide`; un guardado que falló se reintenta en esos dos eventos;
  - **nunca** se guarda un flujo con texto que parezca una clave (el filtro `SECRETOS`, abajo); el borrador anterior queda como estaba y el aviso es un texto fijo
    (`TEXTO_NO_GUARDADO['con-clave']`: «No guardamos tu borrador porque parece que hay una clave pegada en el flujo. Quítala: …»): no dice dónde está la clave ni repite el texto. El detalle de ids y
    campos («a1.tarea», «nombreFlujo») solo lo devuelve `guardar()` a quien lo llame (`detalle`, sin el texto de la persona) y hoy ninguna pantalla lo muestra; el único mensaje que nombra el
    cuadro es el error de la descarga («Parece que pegaste una clave en «<título>»…», `exportar.ts`), que no es el aviso del borrador;
  - al leer se valida versión y forma campo por campo (lista fija de campos; `__proto__`, `constructor` y campos de otra versión se ignoran; un id con nombre de
    prototipo se rechaza), se pasa por `invariantesDelGrafo` y se recortan los textos largos; un borrador roto, de una versión futura, con una clave o inválido se descarta y
    se dice («No pudimos recuperar tu borrador anterior, así que empezamos de cero.»). Una versión futura no se toca al abrir; el primer guardado posterior la reemplaza;
  - límites: 200 000 caracteres de texto serializado (`MAX_CARACTERES_BORRADOR`), 13 cuadros y 200 conexiones; más que eso se rechaza al guardar y al leer;
  - un lienzo SIN cuadros no es un borrador: «Limpiar» lo borra (y «Deshacer» lo vuelve a guardar);
  - sin almacenamiento (ventana privada, datos bloqueados, cuota llena) la pantalla funciona igual y lo dice UNA vez por motivo («Tu navegador no deja guardar el
    borrador…»); si después un guardado sale bien, el aviso rojo se retira;
  - **dos pestañas:** el hook recuerda el texto exacto que leyó o escribió; si al guardar (o por el evento `storage`) lo guardado es otra cosa, NO lo pisa: lo dice
    una vez («Este borrador cambió en otra pestaña…») y deja de guardar en esa pestaña hasta recargar;
  - lo dice la pantalla: «Recuperamos tu borrador.» al abrir con uno y una línea fija con candado, «Tu borrador se guarda solo en este navegador.»;
  - **traspaso del Asistente:** si el borrador trae `origen: "asistente"`, se avisa «Abrimos tu flujo del Asistente.», se elige el primer agente (o el primer cuadro), el foco va
    a él y se marca como pendiente de guardar para quitarle la marca: se escribe a los 500 ms (o antes, en `pagehide` o `auth:saliendo`), no en el acto, así que durante ese medio
    segundo la marca `origen: "asistente"` sigue en `localStorage`.
- **Avisos y a dónde van** (D9; `Constructor.tsx`):
  - cada aviso nuevo del reductor se dice **una sola vez**, en el cuadro de abajo a la derecha (`avisar`, clave `constructor`: el nuevo reemplaza al anterior); los que
    ofrecen «Deshacer» llevan el botón (`accion`) y duran 10 s; los rojos (`mal`) se quedan hasta cerrarlos; `info` sale como `ok` porque `trabajos.js` le pone a `info`
    el ícono de «sin conexión»;
  - lo del archivo (descargar, «Dejamos el JSON abierto abajo…») y lo del borrador tienen sus propias claves (`constructor-archivo` y `constructor-borrador`) y lo del panel «Ver el JSON» («Copiamos el JSON.», «No pudimos copiar solos…») la suya (`constructor-json`, en `PanelJson.tsx`) para no pisar
    al aviso con «Deshacer». «Listo: <archivo>. En n8n, abre el menú «⋯» de arriba a la derecha y elige «Import from File».» se queda hasta cerrarlo, y el rojo de «Todavía
    no se puede descargar» se retira solo cuando ya se puede;
  - si la página no trae el cuadro (vitest, la vitrina) se dicen en una región `role="status"` de la propia pantalla, con su botón «Deshacer»: un solo mecanismo activo a la
    vez, para que ningún lector de pantalla lo anuncie doble;
  - «Te falta esto para poder descargar» NO es un aviso de la esquina: es una lista estática junto al botón (`#faltan`, enlazada con `aria-describedby` desde «Descargar .json»),
    sin región viva (cambia a cada edición).

## El exportador a n8n (`modelo/exportar.ts`)

Tres funciones, de la más barata a la más cara: `revisarFlujo` (errores y avisos, en cada pulsación), `construirN8n` (arma los nodos y las conexiones) y
`construirFlujo` (las dos más el texto del archivo, con 2 espacios de sangría: se llama solo al descargar, al copiar o con el JSON abierto). Es puro y determinista:
no toca el DOM, el reloj, `crypto` ni `Intl`; la zona horaria se INYECTA (`zonaLocal()` la lee del navegador solo cuando se le pide, y solo el disparador de tiempo la usa).
El mismo flujo sale idéntico byte a byte. Un archivo lleva como máximo 17 nodos (1 disparador, 4 agentes con su modelo de chat cada uno y 8 apps).

- **Errores** (bloquean la descarga): falta el disparador; falta el primer paso; el disparador web sin ruta; un ayudante sin «para qué sirve»; un agente sin tarea tras un
  disparador que no es chat; una app sin nombre; una clave pegada. **Avisos** (no bloquean): sin agente de IA, una app sin conector listo, un cuadro suelto, un cuadro que
  recibe de varios, lo que hay que conectar y elegir en n8n al abrir cada app y que el chat quedará público.
- **Seguridad:**
  - nada de lo que escribe la persona se vuelve una expresión de n8n. n8n toma un valor por expresión solo si empieza con «=»: los textos libres pasan por `sinIgual`, la tarea
    pierde sus llaves, un texto que empieza con «=» pierde `{` y `}`, y los nombres que van dentro de una expresión se escapan con `literalExpr` (comillas, barras, llaves, saltos);
  - ningún objeto se arma con una clave que escriba la persona: las conexiones van por nombre de nodo, con `Map` y `Object.fromEntries`, y `__proto__` se trata como nombre ya
    usado; los nombres de nodo son únicos (n8n conecta por nombre);
  - **claves:** un texto que parezca una clave es un error, también si lo parece solo después de limpiarlo (la ruta del webhook, un nombre recortado), y `construirFlujo` revisa
    una vez más el archivo ya armado (textos y claves de objeto). `modelo/secretos.ts` tiene 16 patrones sin bandera `g` ni lookbehind: los 8 de `pipeline/validador.py:SECRETOS` en el
    mismo orden (con el límite de palabra `\b` delante de `sk-` y de `gh[pousr]_`, para que «task-management-system-webhook» no parezca una clave) y 8 formatos que Python aún no
    conoce (Notion ×2, Airtable, WhatsApp/Meta, Slack de aplicación, GitHub de grano fino, Stripe y SendGrid);
  - las credenciales salen SIEMPRE como referencias vacías (`{ id: '', name }`): se conectan dentro de n8n;
  - los parámetros del catálogo se copian al exportar: ningún nodo comparte un objeto con el catálogo ni con otro nodo;
  - el disparador va primero en el archivo; el `webhookId` (chat y webhook) es un UUID v4 derivado de una huella del flujo, así que dos flujos distintos no comparten la URL del
    chat y el mismo flujo da siempre el mismo; un agente suelto sin tarea no manda un prompt vacío.
- **D5:** Anthropic, Gemini y OpenRouter no fijan modelo (`datos/ias.ts`); OpenAI lleva `gpt-5.4-mini`, el de `permitidos.json → llm.modelo`, y `catalogo.test.ts` falla si dejan de coincidir.
- **Golden** (`modelo/golden/`, ver su `LEEME.md`): `casos.ts` trae los 40 casos del harness del mockup (34 se exportan y 6 se rechazan), `mockup-casos.json` es la referencia sin
  tocar, **`flujos.json`** es lo que sale hoy del exportador para esos casos (zona `UTC`) y `invariantes.ts` lo que todo archivo debe cumplir. Se escribe y se compara con
  `exportar.golden.test.ts`. **Regenerarlo es a propósito, nunca en silencio:**
  `cd web && ACTUALIZAR_DORADO=1 npx vitest run src/pantallas/constructor/modelo/exportar.golden.test.ts`. Sin esa variable, un archivo que falta o que cambió **falla**. Lo mismo
  vale para `catalogo-usado.json` (con `catalogo.paridad.test.ts`) y para `n8n-referencia.json` (lo regenera pytest: `ACTUALIZAR_DORADO=1 ./venv/bin/python -m pytest
  tests/test_constructor_paridad.py -p no:cacheprovider -k referencia`; en Windows, `venv/Scripts/python`).
- **Paridad TypeScript ↔ Python** (`tests/test_constructor_paridad.py`): las dos mitades solo se hablan por JSON (Python nunca parsea TypeScript; vitest nunca lee `media/` ni `pipeline/`,
  porque la etapa `web` del Dockerfile copia `web/` más `tools/tarifas.json` y `static/monedero.js`, y no copia `media/` ni `pipeline/`). Pytest comprueba que cada `type`, `typeVersion` y credencial de la tabla existe en `catalog.json`, no está oculto, es la
  versión por defecto de n8n (`DERIVA_ACEPTADA` está vacío) y está en `permitidos.json`; que las apps y las IA del menú son las permitidas; pasa los 34 flujos del golden por
  `pipeline/validador.py`; compara los patrones de claves con `validador.SECRETOS` (con las diferencias declaradas una por una en `PYTHON_ATRASADO`, `REFORMAS_TS` y `EXTRAS_TS`; cuando Python se
  ponga al día la prueba falla a propósito para borrar la excepción); y trae mutaciones del catálogo para demostrar que la prueba cae si algo se rompe.
- **Excepción documentada: `agentTool`.** El Constructor exporta «dos IA que conversan» como `@n8n/n8n-nodes-langchain.agentTool`, que existe en el catálogo pero NO está en
  `permitidos.json`. Con los permitidos de hoy el validador acepta 29 de los 34 archivos y rechaza los 5 que lo usan (`dos_IA_conversan`, `conversan_y_luego_un_paso`,
  `conversan_en_cadena`, `una_IA_con_dos_que_conversan` y `dos_parejas_en_secuencia`), **solo** por «Este nodo aún no lo soportamos: AI Agent Tool.»; con `agentTool` permitido pasan los 34.
  La prueba lo vigila con `AGENT_TOOL_PERMITIDO = False` y su semáforo `test_agent_tool_esta_como_se_decidio`: si alguien lo permite, falla a propósito hasta cambiar la constante. Nada en producción
  pasa los flujos del Constructor por `validador.py` (todo ocurre en el navegador): hoy el rechazo es solo documental. Es decisión del dueño (abajo).

## Accesibilidad y teclado

- **Foco:** nunca cae a `<body>` (lo pide el reductor, lo cumple `Constructor.tsx`, con respaldos). El aro de foco ámbar de la carta se ve en cada parada y es **uno solo**: en los
  botones de 44 px el aro va en su dibujo de 24 o 28 px, no en el botón.
- **Objetivos de 44 px:** la ×, los «+», la patita y el círculo de cada flecha miden 44 × 44 con un dibujo menor adentro; la × deja pasar el toque al cuadro (solo reciben el puntero
  su círculo y una «L» por fuera del cuadro). El e2e mide además los solapes: lo que se construye con el «+» no tapa ningún par de áreas táctiles, los dibujos que se ven nunca se tocan y en el ejemplo (a 88 px entre cuadros) las áreas de 44 px se rozan por 8 px como máximo. Letra de 13 px o más y nada que desborde a 320 px (el lienzo se
  desplaza **dentro** de su caja, nunca ensancha la página).
- **Estructura:** el lienzo es un `role="group"` «Lienzo del flujo» con la ayuda del teclado en `aria-describedby`; los cuadros son `<button aria-pressed>` cuyo nombre accesible
  contiene lo que se ve (tipo, título y detalle), con la relación con su agente aparte, como descripción; nada interactivo va oculto; las flechas son decoración (`aria-hidden`) y lo
  operable es el círculo de cada una, con su estado dicho en texto (no solo en el trazo). Lo que no se puede hacer se apaga con `aria-disabled` (nunca `disabled`) y dice su motivo.
  El orden del DOM es el orden de lectura: guía, barra, lienzo, leyenda, atajos, resumen, privacidad, JSON y, al final, Ajustes.
- **Teclado:**
  - Tab recorre cada cuadro con su «×», su «+» y su patita (en el orden en que están en el flujo, nunca el del arrastre), luego los círculos de las flechas y, al final, la tarjeta del disparador o el menú abierto;
  - Enter o Espacio abren los Ajustes del cuadro y el foco pasa al panel (con el ratón se queda en el cuadro); Esc dentro de Ajustes regresa al cuadro o a la flecha (menos dentro de un `select`);
  - las flechas mueven el cuadro 8 px (con Mayús, 24) sin desplazar la página y lo traen a la vista sin animación; Supr o Retroceso lo quitan (una sola vez por pulsación);
  - Esc cierra el menú (el foco vuelve al «+» que lo abrió) y cancela el modo «conectando» (el botón «Cancelar» devuelve el foco al cuadro desde el que se empezó); funciona también con el foco perdido en `<body>`, salvo con un diálogo modal; una composición de teclado (IME) nunca cuenta como Esc; un clic en el fondo vacío cierra el menú o cancela la conexión;
  - Ctrl o Cmd + Z deshace, salvo en un campo de texto; Ctrl o Cmd con otra tecla nunca las toma el cuadro;
  - la ayuda («Atajos del teclado») es una línea plegable, siempre presente en la página para `aria-describedby`.
- **Movimiento:** nada se anima en `left`, `top` ni `transform` (el cuadro sigue al puntero sin retraso); las transiciones son de color, borde y fondo en 120 ms; no hay scroll animado
  (`scrollIntoView` sin `behavior`) ni animación de entrada para lo que ya estaba (ejemplo, borrador, flujo del Asistente). El e2e «reducir movimiento» lo comprueba.

## Límites conocidos y decisiones PENDIENTES del dueño

Límites de hoy:

- Solo 10 apps con conector listo (de 47 nodos en `permitidos.json`) y 4 disparadores; todo lo demás se arma en n8n. Los `typeVersion` están fijos en `datos/` (los parámetros dependen de ellos).
- **Nunca se probó una importación en un n8n vivo.** El repo vigila con pruebas la existencia, la versión y la credencial de cada nodo (paridad y validador). Los parámetros de cada nodo se compararon a mano, una vez, contra las descripciones
  publicadas de n8n 2.41 (no hay una prueba automática que lo repita). Falta la prueba de aceptación manual: `Import from File` con tres archivos del golden (`ejemplo`, `todas_las_apps_como_paso` y `dos_IA_conversan`) y comprobar que no sale
  «nodo desconocido», que solo quedan en rojo las credenciales y lo que cada app pide elegir, y que el Chat Trigger abre su URL al activarlo. Los `typeVersion` son los de n8n 2.41: en un n8n más viejo podrían salir nodos desconocidos (supuesto, no probado).
- Solo hay un lienzo y un borrador por navegador; no hay lista de flujos guardados.
- Un flujo con disparador Chat se exporta con el chat público (`public: true`): cualquiera con el enlace podrá escribirle y gastar la llave de IA de quien lo active. El resumen del flujo lo avisa; la decisión es de esa persona.

Decisiones PENDIENTES (del dueño o fuera de esta tarea; no se tomaron aquí):

1. **`agentTool`** (D4): opción A, permitirlo globalmente (cambia lo que arma el RAG público y exige ingesta de documentación, que gasta); opción B, permitirlo en el validador y ocultarlo al generador con un
   campo `alcance` (la que recomendó el lector de datos); opción C, no tocar Python. Mientras tanto el rechazo de los 5 archivos queda documentado y vigilado por la prueba de paridad.
2. **El radio del disparador de 48 px.** El cuadro del disparador es redondo a la izquierda (`border-radius: 48px` en `.cn-nodo-trig`, la mitad del alto): es la firma de n8n, pero queda fuera de la escala de la
   carta (6, 10, 12, 16 y píldora). Se usa SOLO ahí y espera que el dueño lo apruebe o lo cambie por `--radius-boton`.
3. **Tab del lienzo.** Hoy Tab pasa por cada cuadro, su «×», su «+» y su patita (con 13 cuadros son decenas de paradas). Una alternativa posible es una sola parada de Tab y navegar entre cuadros con las flechas (como la lista de la Biblioteca,
   `biblioteca.lista.una_parada_de_tab_con_flechas_inicio_y_fin`), pero las flechas ya mueven el cuadro: habría que decidir qué gesto mueve y cuál navega. Hoy se dejó el recorrido completo (el del mockup).
4. **Tamaños en `rem`.** Los tamaños de letra de la carta (13, 15, 17, 20, 24 y 32) son `px` en `tokens.css`, y las medidas del lienzo (cuadro de 216 × 96, botones de 44, dibujos de 24 y 28) también: no
   crecen con el tamaño de letra del navegador. Pasarlos a `rem` es un cambio de la carta entera, no de esta pantalla.
5. **El modo real del Asistente** y el cobro (verbo ✦, costo a la vista): es del Asistente (`asistente.md`); aquí solo importa porque «Abrir en el constructor» depende de que la respuesta traiga un grafo.
6. **El validador `SECRETOS` de Python.** `secretos.ts` va por delante (límite de palabra y 8 formatos); `pipeline/validador.py` y el RAG público no los conocen. Cuando se adopten los 16 patrones en el mismo orden,
   `PYTHON_ATRASADO` pasa a `False` y se borran las excepciones.
7. **Mover `coi/copiar.ts` a `nucleo/` y migrar COI y la Biblioteca a `EncabezadoHoja`.** El Constructor (`PanelJson.tsx`) y el Asistente (`Resultado.tsx`) importan `copiarTexto` de `../coi/copiar`, una pieza de otra
   pantalla; y COI y la Biblioteca todavía arman su encabezado a mano (`Coi.tsx`, `biblioteca/Encabezado.tsx`) en vez de usar `marca/EncabezadoHoja.tsx`. Es limpieza opcional que no cambia lo que se ve.
8. **Importar un `.json` de n8n** al lienzo, y «Tus automatizaciones» (guardar flujos por persona, que pide objeto por persona y API): no están en esta fase (D17).

## Cómo probarlo

Desde la raíz del repo (el `python3` del sistema no trae las dependencias: usa el del venv, `./venv/bin/python`; en Windows con Git Bash es `venv/Scripts/python`, como en `docs/OPERACION.md`):

```
cd web
npx vitest run src/pantallas/constructor            # 35 archivos, 611 pruebas (600 con ID registrado)
npm run verificar                                   # tipos + lint (--max-warnings 0) + vitest completo + build, lo mismo que la etapa web del Dockerfile
npm run e2e                                         # compila y corre Playwright; PW_PUERTO=<n> para otra copia, PW_CANAL=chrome para el Chrome de la máquina
cd ..
./venv/bin/python -m pytest tests/test_constructor_paridad.py tests/test_migracion_ui.py -p no:cacheprovider -q
```

- **vitest:** jsdom no mide nada ni trae `setPointerCapture`, `ResizeObserver` ni `URL.createObjectURL`; por eso toda la matemática del lienzo está en funciones puras (`colocacion.ts`, `geometria.ts`) y los gestos se prueban
  con eventos de puntero. La descarga se prueba con `descargarArchivo` (un `Blob` y un `<a download>`).
- **pytest:** `tests/test_constructor_paridad.py` (134 pruebas) es la paridad de arriba; `tests/test_migracion_ui.py` es el registro anti-pérdida.
- **e2e** (`web/e2e/constructor.spec.ts` y su apoyo `web/e2e/constructor.ts`, 65 pruebas): lo que jsdom no ve, a **1100, 390 y 320 px** con el API simulado (`page.route`): medidas (nada desborda, letra
  de 13 px o más, objetivos de 44 px), **axe** sin violaciones, el aro de foco, el arrastre con el ratón y con el dedo, el scroll del lienzo, la descarga REAL del `.json` leyendo el archivo, el portapapeles de
  verdad, el borrador que sobrevive a recargar, `auth:saliendo` y `pagehide`, y «reducir movimiento». Con `AUTOMATIZA_CAPTURAS=<carpeta>` guarda una captura de cada estado. Además, `movimiento-reducido.spec.ts` suma
  3 pruebas por cada carpeta nueva de `web/estudio/` sin que nadie las escriba.
- **Los e2e NO corren en CI:** el `docker build` solo corre `npm run verificar` en la etapa `web` (tipos, lint, vitest y build, sin navegadores de Playwright) y ningún paso de
  `.github/workflows/docker.yml` ejecuta `playwright test`. La imagen final sí trae el Chromium del sistema (`CHROMIUM_PATH=/usr/bin/chromium`), pero es para Remotion. Cada vez que se toque esta pantalla hay que
  correr `npm run e2e` a mano y **pegar la salida en el PR**.
  Corrida del 20-oct-2026: `cd web && npx playwright test e2e/constructor.spec.ts e2e/asistente.spec.ts` sobre el `dist/` ya compilado, 125 pruebas (65 de esta pantalla y 60 del Asistente),
  **todas pasaron** (1.5 min). La salida de `npm run e2e` (suite completa, compila primero) se pega en el PR.

## Etapas

| Etapa | Qué pasa | Estado |
|---|---|---|
| `retirada` | `/estudio/constructor/` existe; `/constructor.html` → 302 siempre (no hubo vieja) | ⏳ al desplegar |

Va en el mismo cambio que el mapa (`menu.ts`), el Asistente y el registro: encender el área sin las páginas dejaría enlaces rotos. No hay interruptor para esconder una página ya compilada: en cuanto
`dist/estudio/constructor/index.html` existe, la dirección responde; lo único que la muestra u oculta en el mapa es `menu.ts`.

## Los invariantes (tests/test_migracion_ui.py)

Todos en `web/src/pantallas/constructor/` (los 35 archivos de prueba de la carpeta llevan IDs), con ese nombre exacto: **600 IDs** registrados en `INVARIANTES["constructor"]` de `tests/test_migracion_ui.py`. No vienen de una pantalla vieja: son los compromisos del contrato con una prueba que cae si se quita el arreglo. Abajo están todos, agrupados por archivo de prueba (en el mismo orden que `INVARIANTES`: por ruta del archivo y luego por aparición), con una frase por grupo que dice qué protege. Un `it()` nuevo con forma de ID (`constructor.<tema>.<frase_sin_espacios>`) tiene que registrarse en `INVARIANTES` y aparecer aquí entre acentos graves, o el guardián cae.

### `AjustesEnlace.test.tsx` (6)

El panel de Ajustes de una flecha: dice de cuál cuadro a cuál va; las dos maneras de conectar (un solo sentido e ida y vuelta) son botones `aria-pressed` que cambian el tipo con su acción; la opción que no se puede elegir queda `aria-disabled`, dice su motivo y su clic llega al reductor; «Poner un cuadro en medio» abre el menú con el foco en su primera opción; «Quitar esta conexión» manda `quitarEnlace` y devuelve el foco al cuadro de donde salía; Esc regresa a la flecha que se editaba.

- `constructor.ajustes_enlace.dice_de_cual_a_cual_y_el_foco_cae_en_un_solo_sentido`
- `constructor.ajustes_enlace.las_dos_maneras_son_aria_pressed_y_cambian_el_tipo_con_su_accion`
- `constructor.ajustes_enlace.la_opcion_que_no_se_puede_elegir_usa_aria_disabled_dice_no_se_puede_y_su_clic_llega_al_reductor`
- `constructor.ajustes_enlace.poner_un_cuadro_en_medio_abre_el_menu_en_medio_con_el_foco_en_su_primera_opcion`
- `constructor.ajustes_enlace.quitar_esta_conexion_manda_quitarenlace_y_el_foco_va_al_cuadro_de_donde_salia`
- `constructor.ajustes_enlace.esc_regresa_a_la_flecha_que_se_editaba`

### `AjustesNodo.test.tsx` (15)

El panel de Ajustes de un cuadro (`aside` «Ajustes del cuadro», `tabindex=-1`, al que llega el foco del reductor): los campos de texto usan los mismos topes que el reductor; la tarea solo se pide cuando no llega un chat y el ayudante pide «para qué sirve» en lugar de tarea; las cuatro IA son tarjetas `aria-pressed`; el disparador cambia de tipo y cada tipo pide lo suyo; las apps con conector son pastillas; quitar, agregar lo que sigue y darle una herramienta mandan su acción; Esc regresa al cuadro, menos dentro de un selector.

- `constructor.ajustes_nodo.el_panel_es_ajustes_con_tabindex_menos_uno_y_el_foco_del_reductor_llega_a_el`
- `constructor.ajustes_nodo.los_campos_de_texto_usan_los_mismos_topes_que_el_reductor`
- `constructor.ajustes_nodo.la_tarea_de_un_agente_que_recibe_lo_de_otro_respeta_el_mismo_tope`
- `constructor.ajustes_nodo.el_nombre_de_una_app_respeta_el_tope_y_la_nota_dice_si_hay_conector`
- `constructor.ajustes_nodo.escribir_en_un_campo_edita_el_cuadro_con_editarnodo`
- `constructor.ajustes_nodo.las_cuatro_ia_son_tarjetas_con_aria_pressed_y_cambian_la_ia`
- `constructor.ajustes_nodo.tarea_solo_si_no_llega_un_chat_ni_es_ayudante_y_el_ayudante_pide_para_que_sirve`
- `constructor.ajustes_nodo.un_ayudante_dice_que_conversa_pide_para_que_sirve_y_no_pide_tarea`
- `constructor.ajustes_nodo.tras_un_disparador_que_no_es_chat_la_tarea_se_pregunta_con_su_propia_etiqueta`
- `constructor.ajustes_nodo.el_disparador_cambia_de_tipo_y_cada_tipo_pide_lo_suyo`
- `constructor.ajustes_nodo.las_apps_con_conector_son_pastillas_que_ponen_el_nombre`
- `constructor.ajustes_nodo.quitar_este_cuadro_agregar_lo_que_sigue_y_darle_una_herramienta_mandan_su_accion`
- `constructor.ajustes_nodo.una_app_no_ofrece_herramienta_y_el_disparador_ofrece_el_primer_paso`
- `constructor.ajustes_nodo.esc_regresa_al_cuadro_salvo_dentro_de_un_selector`
- `constructor.ajustes_nodo.sin_cuadro_elegido_el_panel_sigue_siendo_ajustes_y_dice_que_tocar`

### `Barra.test.tsx` (10)

La barra del lienzo: el nombre del flujo (con el tope del reductor), «Deshacer» apagado con `aria-disabled` que explica por qué al pulsarlo, «Limpiar» con la pregunta de `Confirmar` (cancelar no borra, confirmar lleva el foco a elegir el disparador y se puede deshacer), «Descargar .json» como único botón ámbar, apagado con `aria-disabled` y enlazado a lo que falta, y «Ver el JSON» con `aria-expanded`.

- `constructor.barra.el_nombre_del_flujo_edita_con_renombrarflujo_y_respeta_el_tope`
- `constructor.barra.deshacer_se_apaga_sin_disabled_explica_al_pulsarlo_y_se_enciende_tras_quitar`
- `constructor.barra.deshacer_y_descargar_apagados_con_el_lienzo_vacio_dicen_su_motivo_sin_pulsarlos`
- `constructor.barra.con_el_flujo_listo_o_con_algo_que_deshacer_los_botones_ya_no_traen_esas_descripciones`
- `constructor.barra.limpiar_pregunta_con_confirmar_y_cancelar_no_borra_nada`
- `constructor.barra.confirmar_limpia_el_foco_va_a_elegir_el_disparador_y_se_puede_deshacer`
- `constructor.barra.con_el_lienzo_vacio_limpiar_esta_apagado_y_dice_por_que`
- `constructor.barra.descargar_es_el_unico_boton_ambar_se_apaga_con_aria_disabled_y_enlaza_lo_que_falta`
- `constructor.barra.descargar_listo_llama_una_vez_por_clic_y_es_el_principal`
- `constructor.barra.ver_el_json_alterna_con_aria_expanded_y_enlaza_la_caja_solo_cuando_esta_abierta`

### `Conexiones.test.tsx` (5)

La lista de conexiones de un cuadro (texto, además de las flechas del lienzo): cada fila dice su conexión y sus botones dicen de cuál, editar abre la flecha y quitar la quita sin confirmar, un rol con nombre largo se parte, un cuadro sin conexiones sigue ofreciendo cómo seguir.

- `constructor.conexiones.cada_fila_dice_su_conexion_y_sus_botones_dicen_de_cual`
- `constructor.conexiones.editar_abre_el_editor_de_esa_flecha_y_quitar_la_quita_sin_confirmar`
- `constructor.conexiones.el_rol_con_un_nombre_largo_sin_espacios_se_parte_en_vez_de_salirse_de_su_caja`
- `constructor.conexiones.un_cuadro_sin_conexiones_no_pinta_lista_y_sigue_ofreciendo_como_seguir`
- `constructor.conexiones.agregar_lo_que_sigue_y_darle_una_herramienta_abren_su_menu_con_el_foco_en_la_primera_opcion`

### `Constructor.revision.test.tsx` (23)

Las correcciones de la revisión adversarial a la pantalla entera: «Deshacer» sobrevive a mover y a teclear, el foco vuelve a donde debe (el «+», el agente, el cuadro restaurado), Esc funciona con el foco perdido en `<body>` y no se mete con un diálogo modal ni con una composición de teclado (IME), el aviso rojo de «no se puede descargar» y el de borrador sin guardar se retiran cuando dejan de ser ciertos, una descarga bloqueada lleva el foco a «Copiar el JSON», dos pestañas no se pisan el borrador y un guardado que falló se reintenta al salir.

- `constructor.deshacer_pantalla.mover_un_cuadro_despues_de_quitar_otro_no_apaga_deshacer_y_este_lo_repone_sin_mover_lo_movido`
- `constructor.deshacer_pantalla.teclear_en_ajustes_despues_de_quitar_deja_el_deshacer_encendido_y_no_pisa_lo_escrito`
- `constructor.foco.volver_a_pulsar_el_mas_cierra_el_menu_y_el_foco_queda_en_ese_mas_aunque_el_clic_no_enfoque_botones`
- `constructor.foco.cerrar_el_menu_de_poner_un_cuadro_en_medio_deja_el_foco_en_ese_boton_y_el_panel_sigue_siendo_el_de_la_flecha`
- `constructor.foco.quitar_una_herramienta_con_supr_manda_el_foco_a_su_agente_y_deshacer_al_cuadro_que_volvio`
- `constructor.teclado.mover_un_cuadro_con_las_flechas_lo_trae_a_la_vista_y_arrastrarlo_con_el_puntero_no_scrollea`
- `constructor.guia.la_ayuda_de_teclado_que_describe_al_lienzo_no_esta_dentro_de_un_details_cerrado`
- `constructor.avisos.el_aviso_de_no_se_puede_descargar_se_retira_cuando_ya_se_puede_y_uno_de_descargado_no`
- `constructor.avisos.sin_cuadro_de_avisos_el_mensaje_de_no_se_puede_descargar_tambien_se_va_cuando_ya_se_puede`
- `constructor.avisos.el_aviso_rojo_de_borrador_sin_guardar_se_retira_en_cuanto_el_guardado_vuelve_a_funcionar`
- `constructor.avisos.sin_cuadro_de_avisos_el_mensaje_de_borrador_sin_guardar_tambien_se_va_cuando_se_guarda`
- `constructor.descarga.si_el_navegador_bloquea_la_descarga_el_foco_pasa_a_copiar_el_json_que_ahora_esta_abajo`
- `constructor.teclado.esc_cancela_el_modo_conectar_aunque_el_foco_este_en_el_body`
- `constructor.teclado.esc_con_el_foco_en_el_body_cierra_el_menu_abierto`
- `constructor.teclado.el_clic_en_el_fondo_vacio_tambien_cancela_el_modo_conectar`
- `constructor.teclado.esc_no_se_atiende_dos_veces_si_el_menu_ya_lo_atendio_y_no_se_mete_con_un_dialogo_modal`
- `constructor.teclado.esc_o_enter_durante_una_composicion_ime_no_cierra_el_menu_ni_agrega_la_app_ni_saca_de_ajustes`
- `constructor.foco.en_pantalla_ancha_ajustes_se_trae_a_la_vista_si_al_elegir_un_cuadro_su_encabezado_quedo_arriba_fuera_de_la_ventana`
- `constructor.persistencia.si_otra_pestana_cambio_el_borrador_esta_no_lo_pisa_y_lo_dice_una_sola_vez`
- `constructor.persistencia.aunque_el_evento_storage_no_llegue_se_nota_al_guardar_que_el_borrador_ya_no_es_el_que_esta_pestana_escribio`
- `constructor.persistencia.una_sola_pestana_sigue_guardando_como_siempre_y_limpiar_borra_sin_creer_que_es_un_conflicto`
- `constructor.persistencia.un_guardado_que_fallo_se_reintenta_al_salir_y_al_ocultarse_la_pagina`
- `constructor.pantalla.el_titulo_parte_una_palabra_larga_y_las_migas_no_dejan_un_separador_solo_al_inicio_de_la_segunda_linea`

### `Constructor.test.tsx` (52)

La pantalla entera, con el reductor, los selectores y el borrador de verdad: encabezado y migas, un solo botón ámbar, orden del DOM y que no llama a ningún servicio; armar el flujo (disparador, agente, patita, ida y vuelta, poner en medio, ejemplo, topes, arrastre); «Deshacer» por el aviso, el botón y Ctrl+Z; la descarga (archivo, doble clic, reserva sin descarga, Ver el JSON); el foco que nunca cae a `<body>`; el teclado; a dónde va cada aviso; el borrador (500 ms, `auth:saliendo`, `pagehide`, claves, roto, sin almacenamiento); y el traspaso del Asistente.

- `constructor.pantalla.irremplazables_en_dorado_migas_hasta_el_constructor_y_un_solo_h1`
- `constructor.pantalla.arranca_vacia_con_la_tarjeta_del_disparador_y_sin_nada_que_descargar_ni_limpiar`
- `constructor.pantalla.un_solo_boton_ambar_y_es_descargar_json`
- `constructor.pantalla.el_orden_del_dom_es_guia_barra_lienzo_leyenda_y_al_final_ajustes`
- `constructor.pantalla.dice_que_el_borrador_se_guarda_solo_en_este_navegador_y_como_abrir_el_archivo_en_n8n`
- `constructor.pantalla.no_llama_a_ningun_servicio_ni_cobra_en_todo_lo_que_hace`
- `constructor.flujo.elegir_el_disparador_lo_crea_lo_elige_y_pasa_el_foco_al_cuadro`
- `constructor.flujo.agregar_un_agente_con_el_mas_lo_pone_a_la_derecha_lo_conecta_y_lo_enfoca`
- `constructor.flujo.la_patita_de_un_agente_solo_ofrece_apps_y_la_app_queda_colgada_como_herramienta`
- `constructor.flujo.la_flecha_entre_dos_ia_pasa_a_ida_y_vuelta_y_conversan_y_se_vuelve_atras_con_deshacer`
- `constructor.flujo.una_app_pasa_de_herramienta_a_paso_del_flujo_y_vuelve_con_el_editor_de_la_flecha`
- `constructor.flujo.poner_un_cuadro_en_medio_de_una_flecha_reemplaza_la_conexion_y_enfoca_el_cuadro_nuevo`
- `constructor.flujo.cargar_el_ejemplo_arma_el_flujo_elige_el_primer_agente_y_se_puede_deshacer`
- `constructor.flujo.los_topes_los_pone_el_reductor_y_la_opcion_bloqueada_dice_el_motivo_sin_perder_el_foco`
- `constructor.flujo.arrastrar_un_cuadro_lo_mueve_no_abre_sus_ajustes_y_no_tira_el_deshacer`
- `constructor.deshacer_pantalla.quitar_con_la_x_ofrece_deshacer_en_el_aviso_y_su_accion_repone_el_cuadro`
- `constructor.deshacer_pantalla.el_boton_de_la_barra_y_ctrl_z_hacen_lo_mismo_que_el_aviso`
- `constructor.deshacer_pantalla.ctrl_z_en_un_campo_de_texto_es_del_navegador_y_no_deshace_el_flujo`
- `constructor.deshacer_pantalla.editar_algo_despues_deja_el_deshacer_encendido_y_el_aviso_viejo_de_un_cambio_posterior_si_se_rechaza`
- `constructor.deshacer_pantalla.limpiar_pregunta_cancelar_no_borra_confirmar_vacia_y_el_foco_va_al_disparador`
- `constructor.descarga.apagado_explica_por_que_al_pulsarlo_y_no_baja_nada`
- `constructor.descarga.baja_un_archivo_con_el_nombre_del_flujo_y_un_json_que_se_importa_en_n8n`
- `constructor.descarga.un_nombre_vacio_baja_flujo_json_y_el_doble_clic_baja_un_solo_archivo`
- `constructor.descarga.el_candado_del_doble_clic_se_suelta_y_se_puede_bajar_otra_vez`
- `constructor.descarga.si_el_navegador_no_puede_bajar_el_archivo_muestra_el_json_y_lo_dice`
- `constructor.descarga.ver_el_json_abre_y_cierra_la_caja_y_solo_la_arma_si_esta_abierta`
- `constructor.descarga.el_json_de_un_flujo_incompleto_dice_que_te_falta`
- `constructor.foco.nunca_cae_a_body_despues_de_cada_accion_que_cambia_la_estructura`
- `constructor.foco.si_no_hay_una_primera_opcion_en_el_menu_el_foco_cae_a_su_boton_de_cerrar`
- `constructor.foco.con_el_menu_y_la_tarjeta_del_disparador_a_la_vez_el_foco_va_al_menu`
- `constructor.foco.al_quitar_el_ultimo_cuadro_el_foco_va_a_elegir_el_disparador`
- `constructor.foco.al_elegir_un_cuadro_en_una_pantalla_angosta_ajustes_se_trae_a_la_vista_sin_animacion`
- `constructor.teclado.enter_en_un_cuadro_lleva_el_foco_a_ajustes_y_esc_lo_regresa_al_cuadro`
- `constructor.teclado.esc_en_un_campo_de_ajustes_regresa_a_la_flecha_que_se_estaba_editando`
- `constructor.teclado.las_flechas_mueven_un_cuadro_8_px_y_con_mayus_24_sin_desplazar_la_pagina`
- `constructor.teclado.supr_quita_el_cuadro_enfocado_y_el_foco_pasa_al_cuadro_de_donde_venia`
- `constructor.teclado.esc_en_un_cuadro_cancela_el_modo_conectar_y_el_boton_cancelar_tambien`
- `constructor.teclado.esc_sin_nada_abierto_no_hace_nada_y_el_clic_en_el_fondo_cierra_el_menu`
- `constructor.avisos.cada_aviso_nuevo_se_dice_una_vez_en_la_esquina_y_editar_no_repite_ninguno`
- `constructor.avisos.un_rechazo_sale_como_mal_se_queda_hasta_cerrarlo_y_reemplaza_al_anterior`
- `constructor.avisos.sin_cuadro_de_avisos_se_dicen_en_una_region_de_la_pantalla_y_con_el_boton_deshacer`
- `constructor.avisos.con_cuadro_de_avisos_no_se_repite_en_la_pantalla_para_no_anunciar_doble`
- `constructor.persistencia.guarda_diferido_a_los_500_ms_del_ultimo_cambio_y_no_antes`
- `constructor.persistencia.guarda_de_inmediato_en_auth_saliendo_y_en_pagehide`
- `constructor.persistencia.no_guarda_un_texto_que_parece_una_clave_y_lo_dice_una_sola_vez`
- `constructor.persistencia.recupera_el_borrador_al_abrir_lo_dice_y_no_lo_reescribe_sin_cambios`
- `constructor.persistencia.limpiar_borra_tambien_el_borrador_y_deshacer_lo_vuelve_a_guardar`
- `constructor.persistencia.un_borrador_roto_se_descarta_y_se_dice_y_uno_de_una_version_futura_no_se_toca`
- `constructor.persistencia.sin_almacenamiento_la_pantalla_funciona_y_lo_dice_una_sola_vez`
- `constructor.persistencia.sin_cuadro_de_avisos_lo_que_no_se_pudo_guardar_se_dice_en_la_pantalla`
- `constructor.traspaso.un_flujo_del_asistente_abre_con_su_aviso_el_primer_agente_elegido_y_con_el_foco`
- `constructor.traspaso.un_flujo_del_asistente_que_no_pasa_la_limpieza_no_se_abre_y_lo_dice`

### `ElegirDisparador.test.tsx` (4)

La tarjeta «¿Qué hace que tu flujo arranque?» (con cuadros pero sin disparador, el título es «Elige qué hace que tu flujo arranque»): las cuatro opciones mandan su tipo y nada más, con el lienzo vacío ofrece el ejemplo y dice «Paso 1», con cuadros pero sin disparador no ofrece el ejemplo y dice que falta, y solo la primera opción lleva `data-foco`.

- `constructor.elegir_disparador.las_cuatro_opciones_mandan_su_tipo_y_nada_mas`
- `constructor.elegir_disparador.con_el_lienzo_vacio_ofrece_el_ejemplo_y_dice_paso_1`
- `constructor.elegir_disparador.sin_disparador_pero_con_cuadros_no_ofrece_el_ejemplo_y_dice_que_falta`
- `constructor.elegir_disparador.solo_la_primera_opcion_lleva_data_foco_y_con_disparador_no_se_pinta`

### `Flechas.test.tsx` (13)

Las flechas SVG: una por conexión, decoración sin eventos y fuera del árbol de accesibilidad, cubren el lienzo por CSS, solo la de ida y vuelta va punteada, nunca `NaN`; el círculo de cada flecha mide 44 × 44 con el aro de foco en su dibujo de 28, se oye con `aria-pressed`, abre solo su flecha, y ni el código ni la hoja traen un color suelto.

- `constructor.flechas.hay_un_svg_por_conexion_con_su_id_y_dos_trazos_la_curva_y_las_puntas_aparte`
- `constructor.flechas.las_lineas_son_decoracion_sin_eventos_y_fuera_del_arbol_de_accesibilidad`
- `constructor.flechas.cada_svg_cubre_el_lienzo_por_css_y_no_trae_ancho_ni_alto_que_cambien_al_crecer`
- `constructor.flechas.solo_las_de_ida_y_vuelta_van_punteadas_y_la_elegida_es_mas_gruesa_y_ambar`
- `constructor.flechas.ninguna_curva_ni_punta_ni_insignia_trae_nan_ni_undefined`
- `constructor.flechas.un_cuadro_que_ya_no_existe_no_deja_flecha_huerfana`
- `constructor.flechas.cada_flecha_tiene_su_circulo_de_44_con_el_nombre_que_dice_el_selector`
- `constructor.flechas.el_circulo_mide_44_por_44_y_el_aro_de_foco_va_en_el_dibujo_de_28`
- `constructor.flechas.la_flecha_elegida_se_oye_con_aria_pressed_y_se_ve_por_su_clase_no_solo_por_el_tono`
- `constructor.flechas.la_insignia_de_ida_y_vuelta_es_discontinua_y_lleva_otro_icono_que_la_de_un_sentido`
- `constructor.flechas.tocar_el_circulo_o_pulsar_enter_abre_esa_flecha_y_ninguna_otra`
- `constructor.flechas.dos_ia_que_conversan_son_una_flecha_de_ida_y_vuelta_con_dos_puntas`
- `constructor.flechas.ni_el_codigo_ni_la_hoja_traen_un_color_suelto`

### `Guia.test.tsx` (9)

El texto que acompaña al lienzo: la pista del siguiente paso (texto fijo, sin región viva), el aviso «Conectando» con su «Cancelar», la leyenda de las dos maneras de conectar, los atajos del teclado (plegables, siempre en la página para `aria-describedby`) y «Te falta esto…» / «Listo para descargar», sin región viva; los nombres largos se parten.

- `constructor.guia.la_pista_cambia_con_el_flujo_y_es_texto_fijo_sin_region_viva`
- `constructor.guia.conectando_dice_que_tocar_y_cancelar_manda_cancelarconexion`
- `constructor.guia.sin_conexion_en_curso_el_aviso_no_pinta_nada`
- `constructor.guia.la_leyenda_explica_un_solo_sentido_e_ida_y_vuelta_con_dibujos_decorativos`
- `constructor.guia.los_atajos_del_teclado_son_una_linea_plegable_con_id_para_aria_describedby`
- `constructor.guia.el_texto_de_los_atajos_esta_siempre_en_la_pagina_escondido_cerrado_y_a_la_vista_abierto`
- `constructor.guia.los_avisos_con_un_nombre_largo_sin_espacios_se_parten_en_vez_de_salirse_de_la_pagina`
- `constructor.guia.te_falta_esto_lista_los_errores_con_su_id_y_sin_region_viva`
- `constructor.guia.con_el_flujo_listo_dice_listo_para_descargar_con_el_numero_de_cuadros`

### `Lienzo.test.tsx` (24)

El marco del lienzo: grupo con nombre, scroll propio que no ensancha la página, capas (flechas debajo, círculos encima), orden de Tab, `tabindex` solo si está vacío, cada gesto sale como evento con su id, Esc y clic de fondo con las excepciones del menú y de un arrastre, `role="presentation"` y no un `div` con `onClick`, y el arrastre con puntero y con el dedo (un cuadro a la vez, el marco puede desplazarse a mitad del arrastre).

- `constructor.lienzo.el_marco_es_un_grupo_con_nombre_y_el_lienzo_adentro_mide_lo_que_dicen_los_selectores`
- `constructor.lienzo.el_lienzo_crece_con_ancho_y_alto_y_el_marco_desplaza_adentro_sin_ensanchar_la_pagina`
- `constructor.lienzo.las_flechas_van_debajo_de_los_cuadros_los_circulos_encima_y_lo_de_adentro_al_final`
- `constructor.lienzo.el_menu_y_la_tarjeta_se_pintan_dentro_del_lienzo_en_su_sitio_absoluto`
- `constructor.lienzo.el_orden_de_tab_es_cuadros_con_su_x_y_sus_mas_luego_las_flechas_y_al_final_lo_de_adentro`
- `constructor.lienzo.el_marco_no_pide_tabindex_porque_ya_tiene_hijos_enfocables_y_solo_se_vuelve_enfocable_si_esta_vacio`
- `constructor.lienzo.dos_hijos_apagados_con_null_o_false_cuentan_como_nada_adentro`
- `constructor.lienzo.la_ayuda_de_teclado_describe_el_lienzo_si_se_pasa_su_id`
- `constructor.lienzo.el_modo_conectando_se_marca_en_el_marco_y_el_marco_se_entrega_por_ref`
- `constructor.lienzo.cada_cuadro_conserva_su_elemento_al_moverse_el_orden_del_dom_no_cambia_con_el_arrastre`
- `constructor.lienzo.un_lienzo_vacio_no_pinta_cuadros_ni_flechas_pero_si_deja_lo_que_se_le_ponga_adentro`
- `constructor.lienzo.cada_gesto_sale_como_evento_con_el_id_del_cuadro_o_de_la_flecha`
- `constructor.lienzo.los_mas_piden_el_menu_de_lo_que_sigue_o_el_de_herramientas_sin_conexion_donde_insertar`
- `constructor.lienzo.esc_sobre_un_cuadro_avisa_su_id_y_sobre_la_x_un_mas_o_un_circulo_avisa_null`
- `constructor.lienzo.el_esc_de_lo_que_hay_adentro_del_lienzo_como_el_menu_no_llega_a_alescape`
- `constructor.lienzo.un_esc_que_alguien_ya_atendio_no_se_avisa_otra_vez`
- `constructor.lienzo.un_clic_en_el_fondo_vacio_avisa_y_uno_sobre_un_cuadro_un_boton_o_lo_de_adentro_no`
- `constructor.lienzo.el_lienzo_no_se_pone_a_escuchar_clics_con_un_div_con_onclick_sino_con_role_presentation`
- `constructor.lienzo.arrastrar_un_cuadro_avisa_las_coordenadas_de_lienzo_y_no_abre_sus_ajustes_al_soltar`
- `constructor.lienzo.el_clic_que_cierra_un_arrastre_tampoco_cuenta_como_clic_de_fondo`
- `constructor.lienzo.si_el_marco_se_desplaza_en_pleno_arrastre_el_cuadro_va_con_el_puntero`
- `constructor.lienzo.arrastrar_con_el_dedo_no_mueve_los_demas_cuadros_ni_selecciona_nada`
- `constructor.lienzo.un_cuadro_no_arrastra_a_otro_y_un_gesto_a_la_vez_es_de_un_solo_cuadro`
- `constructor.lienzo.cada_cuadro_y_cada_flecha_traen_su_etiqueta_de_los_selectores_y_nada_interactivo_va_oculto`

### `MenuMas.test.tsx` (12)

El menú flotante del «+» y de la patita: dos pasos (inicio y apps) sin trampa de foco, 300 px pero nunca más que la ventana (cabe a 320 px), cada opción manda su acción, una opción bloqueada por un tope usa `aria-disabled` y dice su motivo, la primera opción lleva `data-foco`, «¿Otra app?» se agrega con el botón o con Enter, «Atrás», Esc cierra, el menú de herramientas abre directo en apps y se trae completo a la vista sin scroll animado.

- `constructor.menu_mas.dos_pasos_inicio_y_apps_con_su_titulo_y_sin_trampa_de_foco`
- `constructor.menu_mas.mide_300_pero_nunca_mas_que_la_ventana_para_caber_en_el_marco_a_320_px`
- `constructor.menu_mas.la_nota_con_un_nombre_largo_sin_espacios_se_parte_en_vez_de_salirse_del_menu`
- `constructor.menu_mas.cada_opcion_del_inicio_manda_su_accion`
- `constructor.menu_mas.una_opcion_bloqueada_usa_aria_disabled_dice_el_motivo_y_su_clic_llega_al_reductor`
- `constructor.menu_mas.un_agente_bloqueado_por_su_tope_dice_el_motivo_igual`
- `constructor.menu_mas.la_primera_opcion_no_bloqueada_y_la_primera_app_llevan_data_foco`
- `constructor.menu_mas.las_apps_son_pastillas_y_otra_app_se_agrega_con_el_boton_o_con_enter`
- `constructor.menu_mas.atras_vuelve_al_inicio_y_el_texto_de_otra_app_no_pasa_a_otro_menu`
- `constructor.menu_mas.esc_cierra_el_menu_desde_cualquier_parte_y_la_x_tambien`
- `constructor.menu_mas.el_menu_de_herramientas_abre_directo_en_apps_sin_atras_y_con_uno_que_ya_esta`
- `constructor.menu_mas.se_trae_completo_a_la_vista_al_abrirse_y_sin_scroll_animado`

### `Nodo.test.tsx` (33)

Un cuadro: su nombre accesible es la etiqueta del selector (tipo, título y detalle, sin `title` repetido), mide 216 × 96, cada variante tiene su forma, `aria-pressed`, los atributos `data-*` del contrato de foco, la × (que quita y no entra al cuadro), los «+» y la patita solo donde corresponde, todo botón de solo ícono con verbo y objeto; el teclado (flechas, Mayús, Supr, Retroceso una vez por pulsación, Ctrl/Cmd no se tocan), el arrastre contra el umbral de un clic, el modo «conectando» con `aria-disabled` y su motivo, y la hoja `cn-` sin colores sueltos ni animaciones de posición.

- `constructor.nodo.el_cuadro_dice_su_tipo_titulo_y_detalle_y_su_nombre_accesible_es_la_etiqueta_del_selector`
- `constructor.nodo.las_tres_lineas_del_cuadro_van_separadas_por_espacios_para_quien_lee_su_texto_sin_el_css`
- `constructor.nodo.ningun_boton_del_cuadro_repite_su_nombre_en_un_title`
- `constructor.nodo.cada_clase_de_cuadro_dice_lo_suyo_en_su_etiqueta`
- `constructor.nodo.la_caja_del_cuadro_va_en_su_lugar_y_mide_216_por_96`
- `constructor.nodo.cada_variante_lleva_su_forma_y_lo_elegido_y_lo_colgado_cambian_el_borde_no_solo_el_tono`
- `constructor.nodo.el_elegido_se_oye_con_aria_pressed_y_se_ve_con_su_clase`
- `constructor.nodo.el_cuadro_anuncia_que_supr_lo_quita`
- `constructor.nodo.los_atributos_de_foco_son_el_contrato_data_nodo_data_quitar_y_data_mas`
- `constructor.nodo.la_x_dice_cual_cuadro_quita_y_al_pulsarla_avisa_su_id`
- `constructor.nodo.el_mas_de_la_derecha_es_suelto_si_no_sigue_nada_y_redondo_si_ya_hay_algo`
- `constructor.nodo.una_herramienta_no_tiene_mas_a_la_derecha_ni_patita`
- `constructor.nodo.un_agente_que_conversa_con_otra_ia_pierde_su_mas_de_la_derecha_pero_conserva_la_patita`
- `constructor.nodo.la_patita_es_solo_de_los_agentes_con_su_mas_y_su_rotulo_herramientas`
- `constructor.nodo.el_mas_de_la_derecha_pide_el_menu_de_lo_que_sigue_con_su_nombre_completo`
- `constructor.nodo.los_mas_dicen_si_su_menu_esta_abierto_con_aria_expanded_y_aria_haspopup`
- `constructor.nodo.todo_boton_de_solo_icono_tiene_nombre_con_verbo_y_objeto_y_ningun_texto_visible`
- `constructor.nodo.un_clic_de_raton_abre_sin_teclado_y_enter_o_espacio_abren_con_teclado`
- `constructor.nodo.las_flechas_mueven_con_la_direccion_y_mayus_pide_el_paso_grande_sin_desplazar_el_marco`
- `constructor.nodo.supr_y_retroceso_quitan_el_cuadro_una_sola_vez_por_pulsacion`
- `constructor.nodo.con_ctrl_o_cmd_las_teclas_son_del_lienzo_y_el_cuadro_no_las_toca`
- `constructor.nodo.esc_y_las_demas_teclas_no_se_atienden_aqui_y_siguen_su_camino_al_lienzo`
- `constructor.nodo.arrastrar_avisa_la_posicion_desde_la_del_cuadro_y_el_clic_final_no_lo_abre`
- `constructor.nodo.un_clic_corto_con_un_temblor_menor_al_umbral_si_abre_y_no_mueve`
- `constructor.nodo.arrastrar_el_cuadro_no_arrastra_la_x_ni_los_mas_que_son_botones_aparte`
- `constructor.nodo.el_cuadro_no_deja_que_el_dedo_desplace_la_pagina_y_no_se_selecciona_su_texto`
- `constructor.nodo.un_cuadro_que_no_es_destino_se_apaga_con_aria_disabled_y_su_motivo_se_lee`
- `constructor.nodo.el_destino_valido_y_el_ancla_se_marcan_distinto_y_ninguno_trae_descripcion_de_motivo`
- `constructor.nodo.el_area_tactil_de_la_x_no_entra_al_cuadro_solo_su_circulo_y_un_pedazo_en_forma_de_l_por_fuera`
- `constructor.nodo.la_x_sigue_siendo_un_boton_de_44_con_su_dibujo_adentro_y_se_alcanza_con_el_teclado`
- `constructor.nodo.ni_la_hoja_ni_los_componentes_traen_un_color_suelto`
- `constructor.nodo.la_hoja_prefija_todo_con_cn_va_en_la_capa_components_y_lee_los_colores_de_los_tokens`
- `constructor.nodo.nada_se_anima_en_left_top_ni_transform_solo_color_borde_y_fondo`

### `PanelJson.test.tsx` (5)

La caja del JSON: muestra el archivo tal cual en una región que se alcanza con el teclado, «Copiar el JSON» deja el texto exacto en el portapapeles, sin cuadro de avisos lo dice en una línea de la página, si el navegador no deja copiar deja el texto seleccionado, y sin JSON apaga copiar con `aria-disabled`.

- `constructor.panel_json.muestra_el_archivo_tal_cual_en_una_region_que_se_enfoca_con_el_teclado`
- `constructor.panel_json.copiar_el_json_deja_el_texto_exacto_en_el_portapapeles_y_lo_dice_en_la_esquina`
- `constructor.panel_json.sin_cuadro_de_avisos_lo_dice_en_una_linea_de_la_propia_pagina`
- `constructor.panel_json.si_el_navegador_no_deja_copiar_deja_el_texto_seleccionado_y_dice_como_seguir`
- `constructor.panel_json.sin_json_dice_que_falta_apaga_copiar_con_aria_disabled_y_no_copia_nada`

### `Paneles.test.tsx` (8)

El foco entre los menús y los paneles: el menú lleva el foco a su primera opción y Esc lo devuelve al «+»; la patita abre en apps; agregar una app crea el cuadro y manda el foco y los ajustes a él; «otra app» vacía no crea nada; escribir en Ajustes no le quita el foco; los topes y el modo «conectando con uno que ya está» avisan sin perder el foco; al vaciar el lienzo la tarjeta del disparador recibe el foco.

- `constructor.paneles.el_menu_lleva_el_foco_a_su_primera_opcion_y_esc_lo_devuelve_al_mas_que_lo_abrio`
- `constructor.paneles.la_patita_abre_directo_en_apps_y_esc_devuelve_el_foco_a_la_patita`
- `constructor.paneles.agregar_una_app_desde_el_menu_crea_el_cuadro_y_el_foco_y_los_ajustes_van_a_el`
- `constructor.paneles.otra_app_vacia_no_crea_nada_dice_el_motivo_y_el_menu_sigue_con_el_foco_donde_estaba`
- `constructor.paneles.escribir_en_un_campo_de_ajustes_no_le_quita_el_foco`
- `constructor.paneles.con_el_tope_de_apps_la_opcion_bloqueada_dice_el_aviso_y_el_foco_no_se_pierde`
- `constructor.paneles.al_vaciar_el_lienzo_la_tarjeta_del_disparador_recibe_el_foco`
- `constructor.paneles.conectar_con_uno_que_ya_esta_pone_el_aviso_con_cancelar_y_el_foco_en_el_cuadro_ancla`

### `modelo/borrador.test.ts` (22)

El borrador del navegador, sin tocar `window` (el almacenamiento se inyecta): llave versionada y solo `nodes`, `edges` y `nombreFlujo`; ida y vuelta exacta; lo roto, de una versión futura o con otra forma se descarta sin lanzar; nombres de prototipo y campos inyectados no pasan; los textos largos se recortan sin partir un emoji; los invariantes y los topes; nunca se guarda texto que parezca una clave; tamaño máximo; almacenamiento que lanza o que no existe; un lienzo sin cuadros borra el borrador; el traspaso del Asistente con su marca de origen.

- `constructor.borrador.la_llave_lleva_la_version_y_se_guardan_solo_nodes_edges_y_nombre_del_flujo`
- `constructor.borrador.ida_y_vuelta_exacta_del_ejemplo_las_muestras_y_un_flujo_con_todos_los_campos_y_textos_raros`
- `constructor.borrador.sin_nada_guardado_no_hay_borrador_y_no_es_algo_que_avisar`
- `constructor.borrador.un_json_roto_o_que_no_es_un_borrador_se_descarta_sin_lanzar`
- `constructor.borrador.una_version_futura_o_que_no_es_un_entero_se_descarta_sin_tocar_lo_guardado`
- `constructor.borrador.una_forma_que_no_es_la_esperada_se_descarta_diciendo_donde`
- `constructor.borrador.los_nombres_de_prototipo_como_id_y_los_campos_inyectados_no_pasan_ni_contaminan`
- `constructor.borrador.los_textos_largos_se_recortan_a_su_tope_sin_partir_un_emoji_y_se_dice_cuales`
- `constructor.borrador.un_flujo_que_viola_los_invariantes_o_los_topes_se_descarta_con_los_codigos`
- `constructor.borrador.nunca_se_guarda_un_flujo_con_texto_que_parezca_una_clave_y_el_borrador_anterior_queda_como_estaba`
- `constructor.borrador.un_borrador_o_un_flujo_demasiado_grande_se_rechaza_y_el_peor_flujo_permitido_cabe_de_sobra`
- `constructor.borrador.un_almacenamiento_que_lanza_o_no_existe_no_rompe_nada_y_se_dice_si_fue_cuota_o_modo_privado`
- `constructor.borrador.guardar_un_lienzo_sin_cuadros_borra_el_borrador`
- `constructor.borrador.borrar_quita_solo_su_llave_y_la_ultima_escritura_manda`
- `constructor.borrador.cargar_no_escribe_ni_borra_nada_aunque_descarte`
- `constructor.borrador.sirve_con_el_local_storage_del_navegador_y_con_una_funcion_que_lo_da`
- `constructor.borrador.el_traspaso_escribe_un_flujo_ajeno_como_borrador_con_su_origen_y_el_guardado_normal_lo_quita`
- `constructor.borrador.preparar_el_traspaso_es_pura_acepta_nombre_en_vez_de_nombre_flujo_y_no_acepta_lo_que_no_se_puede_abrir`
- `constructor.borrador.una_marca_de_origen_que_no_es_la_conocida_se_ignora`
- `constructor.borrador.normalizar_devuelve_copias_nuevas_ignora_los_campos_de_mas_y_no_modifica_la_entrada`
- `constructor.borrador.cualquier_texto_deformado_se_lee_sin_lanzar_y_lo_que_pasa_cumple_los_invariantes`
- `constructor.borrador.hay_un_texto_para_cada_motivo_de_no_guardar_y_estan_en_espanol_latam_con_tuteo`

### `modelo/catalogo.paridad.test.ts` (5)

La mitad de vitest de la paridad con Python: `golden/catalogo-usado.json` es exactamente lo que dicen `catalogo.ts` y `datos/` (y solo se reescribe con `ACTUALIZAR_DORADO=1`), una fila tocada cambia el JSON y la comparación dice cuál, la tabla trae las diez apps, las cuatro IA, los cinco disparadores, el agente, el ayudante y «otra app», todo nodo exportado está en la tabla y al revés, y las sondas de claves quedan para Python.

- `constructor.paridad.catalogo_usado_json_es_lo_que_dice_el_catalogo_ts_y_solo_se_reescribe_con_actualizar_dorado`
- `constructor.paridad.una_fila_tocada_cambia_el_json_y_la_comparacion_dice_cual`
- `constructor.paridad.la_tabla_trae_las_diez_apps_las_cuatro_ia_los_cinco_disparadores_el_agente_el_ayudante_y_la_otra_app`
- `constructor.paridad.todo_nodo_que_exporta_el_constructor_esta_declarado_en_la_tabla_y_cada_fila_de_la_tabla_se_exporta`
- `constructor.paridad.las_sondas_de_claves_dicen_lo_que_espera_typescript_y_quedan_en_el_json_para_python`

### `modelo/catalogo.test.ts` (15)

El catálogo contra el recorte del catálogo de n8n (`golden/n8n-referencia.json`): las IA, los disparadores y las diez apps existen, están permitidas, en su versión por defecto y con credencial del nodo; solo OpenAI lleva modelo (el de `permitidos.json`); «otra app» es un HTTP Request; `agentTool` aún no está permitido (decisión D4); parámetros de paso y de herramienta, alias y nombres de prototipo que no rompen nada.

- `constructor.catalogo.las_cuatro_ia_existen_estan_permitidas_con_la_version_por_defecto_y_su_credencial`
- `constructor.catalogo.solo_openai_lleva_modelo_y_es_el_de_permitidos_json`
- `constructor.catalogo.los_cinco_disparadores_existen_estan_permitidos_y_su_credencial_es_del_nodo`
- `constructor.catalogo.las_diez_apps_existen_estan_permitidas_pueden_ser_herramienta_y_su_credencial_es_del_nodo`
- `constructor.catalogo.la_otra_app_es_un_http_request_que_tambien_puede_ser_herramienta`
- `constructor.catalogo.el_agente_existe_y_el_ayudante_agent_tool_aun_no_esta_permitido_decision_d4`
- `constructor.catalogo.las_descripciones_en_espanol_son_las_del_mockup`
- `constructor.catalogo.lo_que_hay_que_elegir_en_n8n_esta_para_cada_app_y_se_busca_sin_prototipos`
- `constructor.catalogo.cada_llamada_a_params_da_un_objeto_nuevo_que_no_comparte_nada_con_el_catalogo`
- `constructor.catalogo.como_paso_la_app_usa_la_respuesta_del_agente_y_como_herramienta_el_agente_decide`
- `constructor.catalogo.los_parametros_de_cada_disparador_dependen_de_su_frecuencia_o_su_ruta`
- `constructor.catalogo.app_de_busca_por_nombre_y_alias_sin_mayusculas_ni_acentos`
- `constructor.catalogo.los_nombres_de_prototipo_no_son_apps_ni_ia_ni_disparadores_y_no_rompen_nada`
- `constructor.catalogo.los_alias_ya_estan_normalizados_y_no_se_repiten_entre_apps`
- `constructor.catalogo.ia_de_y_tipo_de_disparador_caen_en_openai_y_chat`

### `modelo/colocacion.test.ts` (15)

Dónde cae cada cuadro: rejilla de 8 px y límites del lienzo, el lienzo crece (mínimo 1000 × 780), cuándo dos cuadros chocan, lugar libre más cercano (con los casos del mockup), a la derecha (344 px), debajo, y el hueco para poner un cuadro en medio sin dejar una flecha hacia atrás.

- `constructor.colocacion.en_rango_ajusta_a_la_rejilla_de_8_y_limita_al_lienzo`
- `constructor.colocacion.ancho_y_alto_del_lienzo_crecen_hasta_el_ultimo_cuadro_con_minimos_de_1000_y_780`
- `constructor.colocacion.choca_compara_con_menor_estricto_ancho_mas_24_y_alto_mas_24`
- `constructor.colocacion.esta_debajo_y_esta_a_la_derecha_marcan_los_limites_de_16_y_60`
- `constructor.colocacion.lugar_libre_cerca_da_el_punto_ajustado_si_esta_libre_y_los_goldens_del_mockup_si_no`
- `constructor.colocacion.lugar_libre_cerca_desempata_con_el_primero_del_recorrido_y_coincide_con_una_busqueda_aparte`
- `constructor.colocacion.lugar_libre_cerca_devuelve_el_punto_deseado_aunque_choque_si_el_lienzo_esta_lleno`
- `constructor.colocacion.lugar_a_la_derecha_cae_344_px_a_la_derecha_en_el_lugar_libre_mas_cercano`
- `constructor.colocacion.lugar_debajo_prueba_3_filas_por_6_lugares_en_orden_y_cae_en_el_mas_cercano_si_no_hay`
- `constructor.colocacion.crecer_hasta_los_topes_deja_los_cuadros_donde_los_dejo_el_mockup_y_sin_encimar`
- `constructor.colocacion.no_modifica_lo_que_recibe`
- `constructor.colocacion.hueco_para_insertar_corre_lo_que_sigue_y_da_las_coordenadas_del_mockup`
- `constructor.colocacion.hueco_para_insertar_devuelve_null_si_no_se_puede_correr_lo_que_sigue_y_no_cabe_en_medio`
- `constructor.colocacion.hueco_para_insertar_acepta_el_caso_apretado_si_igual_queda_hacia_adelante`
- `constructor.colocacion.hueco_para_insertar_siempre_deja_las_dos_flechas_hacia_adelante_y_sin_encimar`

### `modelo/datos/constantes.test.ts` (2)

Los números del lienzo y los topes (1 disparador, 4 agentes, 8 apps) y los textos con que nace lo nuevo son los del mockup.

- `constructor.constantes.los_numeros_del_lienzo_y_los_topes_son_los_del_mockup`
- `constructor.constantes.los_textos_con_que_nace_lo_nuevo_son_los_del_mockup`

### `modelo/ejemplos.test.ts` (10)

El ejemplo, las tres muestras del mockup y las frases de ejemplo del Asistente: cumplen los invariantes del grafo, ids bajos que no chocan con el contador, ningún cuadro encima de otro, cada llamada arma objetos nuevos, las apps de las muestras tienen conector, y la muestra se elige por palabras clave.

- `constructor.ejemplos.el_verificador_de_invariantes_detecta_cada_violacion_si_no_las_pruebas_de_abajo_no_probarian_nada`
- `constructor.ejemplos.el_ejemplo_es_chat_atencion_a_clientes_revisor_con_sheets_y_slack_como_herramientas`
- `constructor.ejemplos.cada_llamada_arma_objetos_nuevos_que_no_se_comparten`
- `constructor.ejemplos.el_ejemplo_y_las_muestras_cumplen_los_invariantes_del_grafo`
- `constructor.ejemplos.los_ids_son_bajos_para_no_chocar_con_el_contador_y_los_textos_caben_en_sus_topes`
- `constructor.ejemplos.en_el_ejemplo_y_las_muestras_ningun_cuadro_se_encima_con_otro`
- `constructor.ejemplos.todas_las_apps_de_las_muestras_tienen_conector_y_todas_las_ia_existen`
- `constructor.ejemplos.las_tres_muestras_son_las_del_mockup_con_sus_coordenadas`
- `constructor.ejemplos.muestra_de_elige_por_palabras_clave_sin_mayusculas_ni_acentos_y_cae_en_la_ultima`
- `constructor.ejemplos.las_frases_de_ejemplo_del_asistente_son_tres_y_caben_en_los_limites_de_la_api`

### `modelo/exportar.golden.test.ts` (8)

El golden: el porte reproduce los 40 casos del mockup byte a byte salvo las diferencias deliberadas, los errores y avisos son los mismos textos, los 6 rechazos no dan archivo, `golden/flujos.json` es lo que sale hoy del exportador (solo se reescribe con `ACTUALIZAR_DORADO=1`), los flujos con `agentTool` están marcados, los 34 archivos cumplen los invariantes de n8n, cada chat o webhook tiene su `webhookId` y solo el disparador de tiempo lleva zona.

- `constructor.golden.el_porte_reproduce_los_40_casos_del_mockup_byte_a_byte_salvo_las_diferencias_deliberadas`
- `constructor.golden.sin_las_diferencias_deliberadas_solo_difieren_los_flujos_que_las_tienen`
- `constructor.golden.los_errores_y_los_avisos_son_los_mismos_textos_del_mockup_y_los_6_rechazos_no_dan_archivo`
- `constructor.golden.flujos_json_es_lo_que_sale_hoy_del_exportador_y_solo_se_reescribe_con_actualizar_dorado`
- `constructor.golden.los_flujos_con_agent_tool_estan_marcados_en_el_indice_y_en_cada_caso`
- `constructor.golden.los_34_archivos_cumplen_los_invariantes_de_n8n`
- `constructor.golden.cada_flujo_con_chat_o_webhook_tiene_su_propio_webhook_id`
- `constructor.golden.solo_los_disparadores_de_tiempo_llevan_zona_y_es_la_que_se_inyecto`

### `modelo/exportar.test.ts` (33)

El exportador a n8n: errores y avisos en el orden del mockup; puro y determinista (zona inyectada, ids del contador); nombres de nodo únicos y seguros; `webhookId` derivado del flujo; un agente suelto sin tarea no manda prompt vacío; ninguna llave doble ni comilla del usuario llega al código de una expresión; las claves pegadas son un error (también tras limpiar el texto) y hay una red final sobre el archivo; las credenciales salen vacías; las conexiones y el modelo de cada agente.

- `constructor.exportar.los_errores_salen_en_el_orden_del_mockup_con_sus_textos_y_sin_repetirse`
- `constructor.exportar.los_avisos_salen_en_el_orden_del_mockup_con_sus_textos`
- `constructor.exportar.recibe_de_n_cuadros_cuenta_agentes_distintos_y_no_la_conexion_del_agente_y_la_de_su_ayudante`
- `constructor.exportar.revisar_flujo_no_serializa_ni_arma_nada_y_construir_si`
- `constructor.exportar.el_flujo_es_nulo_si_y_solo_si_hay_errores_y_el_json_vuelve_al_mismo_objeto`
- `constructor.exportar.es_puro_y_deterministico_sin_azar_reloj_ni_intl_y_los_ids_son_los_del_contador`
- `constructor.exportar.la_zona_se_inyecta_solo_la_usa_el_disparador_de_tiempo_y_una_zona_sin_forma_se_ignora`
- `constructor.exportar.zona_local_lee_la_del_navegador_solo_cuando_se_le_pide`
- `constructor.exportar.los_nombres_de_nodo_son_unicos_con_set_y_constructor_tostring_o_proto_no_dan_un_sufijo_espurio`
- `constructor.exportar.un_cuadro_llamado___proto___no_sale_con_ese_nombre_ni_contamina_ningun_prototipo`
- `constructor.exportar.los_ids_de_cuadro_con_nombres_de_prototipo_no_cambian_el_archivo`
- `constructor.exportar.los_parametros_no_se_comparten_ni_entre_nodos_ni_con_el_catalogo`
- `constructor.exportar.aunque_el_catalogo_entregara_siempre_el_mismo_objeto_lo_exportado_no_lo_comparte`
- `constructor.exportar.el_webhook_id_depende_del_flujo_es_estable_y_con_forma_de_uuid_v4`
- `constructor.exportar.uuid_de_texto_da_uuid_v4_estables_y_distintos_para_textos_distintos`
- `constructor.exportar.un_agente_suelto_sin_tarea_no_manda_prompt_type_ni_texto_vacio`
- `constructor.exportar.el_disparador_va_primero_en_el_archivo_aunque_se_haya_agregado_al_final`
- `constructor.exportar.las_conexiones_main_no_se_pierden_cuando_los_nombres_llevan_el_signo_mayor_que`
- `constructor.exportar.un_nombre_largo_se_recorta_a_100_sin_partir_un_emoji_y_una_posicion_invalida_sale_en_cero`
- `constructor.exportar.un_nombre_con_caracteres_de_control_o_de_direccion_sale_limpio_en_el_archivo_de_n8n`
- `constructor.exportar.un_texto_que_empieza_con_igual_no_se_vuelve_expresion_ni_con_llaves_dobles_dentro`
- `constructor.exportar.ninguna_llave_doble_ni_comilla_del_usuario_llega_al_codigo_de_una_expresion`
- `constructor.exportar.un_nombre_con_comillas_o_llaves_se_escapa_dentro_de_las_expresiones_que_lo_citan`
- `constructor.exportar.una_clave_pegada_en_cualquier_campo_es_un_error_y_no_hay_archivo`
- `constructor.exportar.tambien_se_rechaza_la_clave_que_aparece_solo_despues_de_limpiar_el_texto`
- `constructor.exportar.la_red_final_revisa_textos_y_claves_de_objeto_de_todo_el_archivo`
- `constructor.exportar.las_credenciales_salen_siempre_como_referencias_vacias_y_no_hay_nada_parecido_a_una_clave`
- `constructor.exportar.las_conexiones_del_ejemplo_son_exactamente_las_esperadas_y_en_el_orden_del_archivo`
- `constructor.exportar.lo_que_recibe_el_agente_depende_de_quien_le_entrega_la_respuesta`
- `constructor.exportar.una_app_como_paso_usa_la_respuesta_del_agente_y_responde_a_quien_escribio`
- `constructor.exportar.una_app_que_no_esta_en_el_catalogo_es_un_http_request_con_su_nota`
- `constructor.exportar.el_modelo_de_cada_agente_va_debajo_sin_pisar_ningun_otro_nodo`
- `constructor.exportar.cualquier_flujo_valido_al_azar_da_un_archivo_que_cumple_los_invariantes_y_la_revision_barata_dice_lo_mismo`

### `modelo/geometria.test.ts` (12)

La geometría pura de las flechas (curva, punta, insignia al 70 % (al 50 % si dos IA conversan), ida y vuelta con dos puntas, herramienta que cuelga) y de la posición del menú y del scroll para ver un cuadro: nunca `NaN` ni `undefined`, nunca fuera del lienzo.

- `constructor.geometria.punta_es_un_triangulo_de_11_de_largo_y_5_de_semiancho_en_la_direccion_dada`
- `constructor.geometria.punta_sin_direccion_o_con_numeros_rotos_no_da_nan`
- `constructor.geometria.flecha_de_un_solo_sentido_sale_del_costado_derecho_y_la_insignia_va_al_70_por_ciento`
- `constructor.geometria.flecha_de_ida_y_vuelta_entre_agentes_lleva_dos_puntas_y_la_insignia_en_el_medio`
- `constructor.geometria.flecha_de_herramienta_cuelga_por_debajo_encima_o_de_lado_segun_donde_quede_la_app`
- `constructor.geometria.flecha_la_insignia_esta_en_el_trazo_y_dentro_de_los_extremos`
- `constructor.geometria.flecha_nunca_da_nan_ni_undefined_en_ninguna_posicion`
- `constructor.geometria.posicion_del_menu_sale_a_la_derecha_bajo_la_patita_o_bajo_la_insignia_segun_el_caso`
- `constructor.geometria.posicion_del_menu_no_se_sale_del_lienzo_por_la_izquierda_ni_por_la_derecha_ni_por_arriba`
- `constructor.geometria.posicion_del_menu_con_numeros_rotos_no_da_nan_y_con_semilla_siempre_queda_dentro`
- `constructor.geometria.scroll_para_ver_deja_el_cuadro_visible_con_su_mas_a_la_derecha_y_algo_de_aire_a_la_izquierda`
- `constructor.geometria.scroll_para_ver_con_numeros_rotos_da_un_numero_y_con_semilla_el_cuadro_queda_a_la_vista`

### `modelo/grafo.helpers.test.ts` (10)

Las preguntas pequeñas sobre el grafo: quién tiene padre, quién es ayudante, la raíz de una cadena de ayudantes (también con círculos o dos padres), y que los ids con nombre de prototipo no las rompen ni se modifica lo recibido.

- `constructor.grafo.tiene_padre_dice_si_un_agente_lo_tiene_por_ida_y_vuelta_ayudantes_incluidos`
- `constructor.grafo.toca_seq_dice_si_entra_o_sale_de_una_conexion_de_un_solo_sentido`
- `constructor.grafo.padre_de_da_el_id_del_agente_del_que_cuelga_o_null`
- `constructor.grafo.raiz_sube_por_la_cadena_de_ayudantes_hasta_el_agente_principal`
- `constructor.grafo.raiz_con_dos_padres_manda_el_ultimo_igual_que_hay_ciclo_y_el_exportador`
- `constructor.grafo.raiz_no_se_cuelga_si_el_grafo_trae_un_circulo_de_ayudantes`
- `constructor.grafo.es_ayudante_solo_para_un_agente_que_cuelga_de_otro_agente`
- `constructor.grafo.ayudantes_de_da_los_agentes_que_conversan_con_este_en_orden_y_sin_apps`
- `constructor.grafo.ids_como_proto_constructor_y_to_string_no_rompen_los_helpers`
- `constructor.grafo.los_helpers_no_modifican_lo_que_reciben`

### `modelo/grafo.test.ts` (19)

Las reglas de conexión: `puedeEnlazar` con sus 12 reglas y su orden (gana la primera que falla) y el motivo exacto de cada rechazo, sin lanzar ni mutar; ciclos; alcance; candidatos; "por la patita solo van apps"; y `invariantesDelGrafo` con cada código de violación, sin lanzar con lo malformado.

- `constructor.grafo.puede_enlazar_porta_las_26_reglas_del_harness_con_su_motivo_exacto`
- `constructor.grafo.puede_enlazar_da_el_motivo_de_cada_una_de_las_12_reglas_de_rechazo`
- `constructor.grafo.puede_enlazar_evalua_en_orden_y_gana_la_primera_regla_que_falla`
- `constructor.grafo.puede_enlazar_acepta_exactamente_lo_que_deja_el_grafo_valido`
- `constructor.grafo.puede_enlazar_no_lanza_ni_ensucia_el_motivo_en_flujos_cualesquiera`
- `constructor.grafo.puede_enlazar_no_modifica_lo_que_recibe_ni_comparte_la_conexion_hipotetica`
- `constructor.grafo.hay_ciclo_detecta_circulos_de_pasos_y_cuenta_lo_que_sale_de_un_ayudante_como_de_su_agente`
- `constructor.grafo.hay_ciclo_no_se_desborda_con_cadenas_largas_ni_se_cuelga_con_circulos_de_ayudantes`
- `constructor.grafo.hay_ciclo_total_cuenta_pasos_y_herramientas_como_flechas_y_ignora_las_huerfanas`
- `constructor.grafo.hay_ciclo_implica_hay_ciclo_total_y_quitar_pasos_no_crea_circulos`
- `constructor.grafo.los_ids_como_proto_constructor_y_to_string_no_confunden_a_las_reglas`
- `constructor.grafo.alcanza_sigue_solo_las_conexiones_de_un_solo_sentido`
- `constructor.grafo.candidatos_son_los_cuadros_a_los_que_puede_enlazar_en_el_orden_del_lienzo`
- `constructor.grafo.solo_apps_por_la_patita_rechaza_agentes_y_disparadores_solo_desde_el_agente`
- `constructor.grafo.invariantes_aceptan_el_ejemplo_las_muestras_y_los_flujos_sin_disparador_o_vacios`
- `constructor.grafo.invariantes_detectan_cada_una_de_las_violaciones_con_su_codigo`
- `constructor.grafo.invariantes_reportan_lo_malformado_sin_lanzar_nunca`
- `constructor.grafo.invariantes_no_modifican_lo_que_reciben_y_dan_el_mismo_resultado_siempre`
- `constructor.grafo.invariantes_codigo_de_violacion_y_la_lista_de_codigos_son_consistentes`

### `modelo/reductor.deshacer.test.ts` (24)

Deshacer: cada acción estructural guarda la instantánea exacta de antes; la pila guarda hasta 20 y descarta las más viejas; lo que no cambia nada no guarda; mover, teclear y renombrar no tiran la pila y lo movido o escrito se conserva al deshacer; cargar se deshace entero; un aviso viejo no deshace lo que vino después; deshacer sin nada lo dice; el foco va al cuadro restaurado.

- `constructor.deshacer.cada_accion_estructural_guarda_la_instantanea_exacta_de_antes_con_su_texto_y_su_aviso`
- `constructor.deshacer.deshacer_devuelve_exactamente_lo_de_antes_para_cada_accion_estructural`
- `constructor.deshacer.el_texto_de_listo_depende_de_la_clase_de_cambio`
- `constructor.deshacer.deshacer_restaura_cuadros_conexiones_nombre_y_seleccion_pero_no_el_contador`
- `constructor.deshacer.limpiar_se_puede_deshacer_y_el_nombre_del_flujo_se_queda_en_ambos_sentidos`
- `constructor.deshacer.cada_deshacer_gasta_una_instantanea_y_se_recorre_en_orden_inverso`
- `constructor.deshacer.la_pila_guarda_hasta_20_y_descarta_las_mas_viejas`
- `constructor.deshacer.agregar_entra_en_la_pila_pero_su_aviso_no_ofrece_deshacer_y_deshacerlo_quita_lo_agregado`
- `constructor.deshacer.lo_que_no_cambia_nada_no_guarda_instantanea_y_los_fallos_tampoco`
- `constructor.deshacer.tras_editar_un_texto_el_deshacer_del_aviso_sigue_valiendo_y_no_borra_lo_escrito`
- `constructor.deshacer.mover_o_teclear_o_renombrar_despues_de_quitar_no_tiran_la_pila_y_deshacer_conserva_lo_movido_y_lo_escrito`
- `constructor.deshacer.lo_movido_o_escrito_se_conserva_en_cada_paso_de_una_pila_de_varias_fotos`
- `constructor.deshacer.una_foto_nueva_empieza_sin_cuadros_tocados_y_lo_que_se_toca_se_suma_a_todas_las_de_la_pila`
- `constructor.deshacer.cambiar_el_tipo_y_luego_mover_ese_cuadro_lo_deja_donde_lo_puso_la_persona`
- `constructor.deshacer.reemplazar_todo_el_flujo_se_deshace_entero_aunque_se_haya_movido_o_escrito_algo_despues`
- `constructor.deshacer.lo_que_no_cambia_nada_no_toca_la_pila`
- `constructor.deshacer.moverse_contra_el_borde_no_cambia_nada_y_la_pila_se_queda`
- `constructor.deshacer.seleccionar_abrir_menus_y_cancelar_no_tocan_la_pila_y_el_aviso_viejo_sigue_valiendo`
- `constructor.deshacer.un_aviso_viejo_no_deshace_lo_que_vino_despues`
- `constructor.deshacer.el_aviso_que_ofrece_deshacer_siempre_es_el_de_la_instantanea_de_arriba`
- `constructor.deshacer.cargar_un_flujo_ajeno_o_el_ejemplo_se_deshace_y_uno_rechazado_no_guarda_nada`
- `constructor.deshacer.poner_en_medio_y_cambiar_el_tipo_devuelven_las_posiciones_exactas_de_antes`
- `constructor.deshacer.deshacer_sin_nada_guardado_lo_dice_sin_tocar_el_flujo`
- `constructor.deshacer.el_foco_va_al_cuadro_restaurado_y_si_no_volvio_ninguno_al_elegido_o_a_elegir_disparador`

### `modelo/reductor.propiedades.test.ts` (23)

Pruebas de propiedades con secuencias al azar reproducibles (la misma semilla da la misma corrida; más mutantes y un minimizador): ninguna secuencia rompe un invariante del grafo ni un tope; nada apunta a lo que no existe; los contadores nunca bajan y ningún id se repite; el JSON exportado es estable y nunca lleva una clave; las conexiones del archivo son las del lienzo; todo estado se guarda como borrador y se recupera igual; ninguna acción lanza ni muta.

- `constructor.propiedades.ninguna_secuencia_al_azar_rompe_un_invariante_del_grafo_ni_un_tope`
- `constructor.propiedades.nada_apunta_a_algo_que_no_existe_y_el_menu_y_la_conexion_en_curso_nunca_conviven`
- `constructor.propiedades.los_contadores_nunca_bajan_ningun_id_se_repite_y_la_pila_no_pasa_de_20`
- `constructor.propiedades.construir_y_revisar_el_flujo_no_lanzan_el_json_es_estable_y_nunca_lleva_una_clave`
- `constructor.propiedades.las_conexiones_del_archivo_son_exactamente_las_que_dibuja_el_lienzo`
- `constructor.propiedades.deshacer_restaura_exactamente_la_instantanea_en_cualquier_momento`
- `constructor.propiedades.los_selectores_nunca_devuelven_nan_ni_undefined_y_dicen_lo_mismo_que_el_grafo`
- `constructor.propiedades.una_accion_a_un_id_que_no_existe_deja_el_estado_exactamente_igual`
- `constructor.propiedades.cada_accion_cambia_solo_lo_que_dice_que_cambia`
- `constructor.propiedades.lo_que_la_interfaz_ofrece_el_reductor_lo_cumple_y_lo_que_marca_imposible_lo_rechaza`
- `constructor.propiedades.puede_enlazar_nunca_acepta_una_conexion_que_rompa_un_invariante`
- `constructor.propiedades.todo_estado_alcanzable_se_guarda_como_borrador_y_se_recupera_igual`
- `constructor.propiedades.ninguna_accion_lanza_ni_modifica_lo_que_recibe`
- `constructor.propiedades.la_corrida_alcanzo_los_casos_dificiles`
- `constructor.propiedades.la_colocacion_hacia_adelante_es_un_objetivo_y_no_un_invariante_duro`
- `constructor.propiedades.un_agente_y_su_ia_que_conversa_con_el_mismo_siguiente_dan_una_sola_conexion_main`
- `constructor.propiedades.los_nombres_y_textos_hostiles_nunca_se_vuelven_expresiones_de_n8n`
- `constructor.propiedades.un_estado_con_punteros_a_lo_que_ya_no_existe_no_hace_tronar_nada_y_la_siguiente_accion_lo_sana`
- `constructor.propiedades.la_misma_semilla_da_la_misma_corrida_y_las_acciones_se_pueden_repetir`
- `constructor.propiedades.los_ojos_de_la_prueba_detectan_cada_mutante_del_reductor_y_del_exportador`
- `constructor.propiedades.el_minimizador_reduce_una_secuencia_que_falla_a_las_acciones_que_la_causan`
- `constructor.propiedades.el_detector_de_suciedad_ve_nan_undefined_infinito_y_objetos_sin_formato`
- `constructor.propiedades.los_estados_y_las_acciones_de_la_prueba_se_congelan_a_fondo`

### `modelo/reductor.puerta.test.ts` (15)

La puerta del reductor para lo que viene de afuera: un flujo con campos de tipo equivocado, con ids que el borrador rechaza, con una clave pegada o enorme se rechaza igual que en el borrador, y lo que acepta el reductor el borrador lo guarda y lo devuelve igual; los textos tecleados no pasan de su tope ni parten un emoji; un contador enorme se ignora; el foco y «ver» no apuntan a lo que ya no existe; ningún aviso repite una clave pegada.

- `constructor.reductor.un_objeto_con_tostring_nulo_en_x_y_o_el_tipo_no_hace_lanzar_a_las_invariantes_ni_al_reductor`
- `constructor.reductor.cargar_un_flujo_con_campos_de_tipo_equivocado_o_enumeraciones_que_no_existen_lo_rechaza`
- `constructor.reductor.cargar_un_flujo_con_ids_que_el_borrador_rechaza_tambien_lo_rechaza_el_reductor`
- `constructor.reductor.lo_que_el_reductor_acepta_de_afuera_el_borrador_lo_guarda_y_lo_devuelve_igual`
- `constructor.reductor.un_flujo_de_afuera_sin_nombre_o_con_un_nombre_que_no_es_texto_se_llama_como_uno_nuevo`
- `constructor.reductor.cargar_un_flujo_con_una_clave_pegada_lo_rechaza_y_el_aviso_no_repite_la_clave`
- `constructor.reductor.un_flujo_enorme_se_rechaza_sin_recorrerlo_y_dice_cuantos_cuadros_admite`
- `constructor.reductor.editar_nodo_nunca_deja_un_texto_mas_largo_que_su_tope`
- `constructor.reductor.lo_que_se_ve_en_el_lienzo_es_lo_que_el_borrador_guarda_y_lo_que_vuelve_al_recargar`
- `constructor.reductor.al_recortar_un_texto_no_queda_la_mitad_de_un_emoji`
- `constructor.reductor.un_contador_enorme_se_ignora_porque_con_el_los_ids_se_repetirian`
- `constructor.reductor.ver_no_apunta_a_un_cuadro_que_se_quito_o_se_deshizo`
- `constructor.reductor.el_foco_no_apunta_a_un_menu_cerrado_ni_a_una_flecha_que_no_esta_elegida`
- `constructor.borrador.preparar_traspaso_y_traspasar_no_lanzan_con_un_objeto_que_lanza_al_leerlo`
- `constructor.reductor.ningun_aviso_error_ni_etiqueta_repite_la_clave_pegada_en_el_nombre_de_un_cuadro`

### `modelo/reductor.revision.test.ts` (16)

Las correcciones de la revisión adversarial al reductor: a dónde va el foco al cerrar menús, quitar un cuadro, una herramienta o un ayudante y deshacer; mover con el teclado pide traer el cuadro a la vista y el arrastre no; el nombre accesible del cuadro lleva tipo, título y detalle en el orden en que se ven; los textos tecleados no dejan pasar caracteres de control ni de dirección.

- `constructor.foco.volver_a_pulsar_el_mas_que_abrio_el_menu_lo_cierra_y_devuelve_el_foco_a_ese_mas`
- `constructor.foco.al_abrir_el_menu_de_poner_en_medio_la_flecha_sigue_elegida_y_su_panel_sigue_en_pantalla`
- `constructor.foco.cerrar_el_menu_de_poner_en_medio_pide_el_foco_del_boton_y_ese_boton_sigue_existiendo`
- `constructor.foco.crear_el_cuadro_en_medio_elige_el_cuadro_nuevo_y_suelta_la_flecha`
- `constructor.foco.si_la_flecha_de_en_medio_deja_de_existir_con_el_menu_abierto_el_menu_se_cierra_y_no_queda_nada_fantasma`
- `constructor.foco.quitar_una_herramienta_manda_el_foco_a_su_agente_y_no_al_primer_cuadro_del_lienzo`
- `constructor.foco.quitar_un_agente_unido_por_ida_y_vuelta_manda_el_foco_a_su_agente_principal`
- `constructor.foco.quitar_un_cuadro_en_una_cadena_sigue_mandando_el_foco_al_que_venia_antes`
- `constructor.foco.deshacer_manda_el_foco_al_cuadro_que_volvio_y_no_al_que_estaba_elegido`
- `constructor.foco.deshacer_algo_que_no_trajo_cuadros_manda_el_foco_al_cuadro_elegido_o_al_primero`
- `constructor.teclado.mover_un_cuadro_con_las_flechas_pide_traerlo_a_la_vista_y_el_arrastre_no`
- `constructor.etiquetas.el_nombre_accesible_del_cuadro_contiene_su_tipo_su_titulo_y_su_detalle_en_el_orden_en_que_se_ven`
- `constructor.etiquetas.la_relacion_con_el_agente_viaja_aparte_como_descripcion_y_solo_cuando_el_cuadro_cuelga_de_otro`
- `constructor.texto.recortar_quita_los_caracteres_de_control_pero_deja_el_tabulador_y_los_saltos_de_linea`
- `constructor.texto.recortar_quita_los_controles_de_direccion_que_invierten_el_resto_de_la_linea_y_los_sustitutos_sueltos`
- `constructor.texto.lo_que_se_teclea_en_un_nombre_no_deja_pasar_un_caracter_de_control_ni_al_estado_ni_al_archivo_de_n8n`

### `modelo/reductor.test.ts` (65)

El reductor puro, acción por acción: estado inicial, elegir el disparador, el menú del «+», la patita, crear agentes y apps, los topes 1/4/8, las dos IA que conversan, cambiar el tipo de una conexión, poner en medio, conectar con uno que ya está, quitar (une lo de antes con lo de después), mover, editar, renombrar, limpiar, cargar el ejemplo y un flujo de afuera, el contador de ids, el foco que pide cada acción, los avisos, y recorridos al azar que no rompen un invariante.

- `constructor.reductor.el_estado_inicial_esta_vacio_con_el_contador_en_20_y_sin_peticiones`
- `constructor.reductor.elegir_disparador_crea_uno_solo_con_sus_valores_por_defecto_y_pide_foco`
- `constructor.reductor.sin_disparador_el_nuevo_se_conecta_con_el_primer_cuadro_que_no_recibe_de_nadie`
- `constructor.reductor.el_disparador_nuevo_tambien_se_conecta_con_una_app_suelta_y_el_flujo_queda_valido`
- `constructor.reductor.el_mas_de_la_derecha_abre_el_menu_y_crear_una_app_la_conecta_en_un_solo_sentido`
- `constructor.reductor.una_app_sin_nombre_no_se_crea_y_el_nombre_se_recorta_a_60`
- `constructor.reductor.tocar_el_mismo_mas_otra_vez_cierra_el_menu_y_devuelve_el_foco_al_mas_igual_que_cerrar`
- `constructor.reductor.abrir_un_menu_cierra_el_modo_conectando_y_solo_hay_uno_a_la_vez`
- `constructor.reductor.el_paso_poner_en_medio_exige_una_conexion_de_un_solo_sentido_que_salga_del_cuadro`
- `constructor.reductor.el_paso_del_menu_cambia_y_la_patita_no_vuelve_al_inicio`
- `constructor.reductor.la_patita_abre_directo_la_lista_de_apps_y_no_crea_una_ia`
- `constructor.reductor.una_app_por_la_patita_cuelga_debajo_de_su_agente_en_ida_y_vuelta`
- `constructor.reductor.una_app_no_tiene_patita_ni_se_abre_su_menu_de_herramientas`
- `constructor.reductor.la_ia_que_sigue_va_a_la_derecha_como_paso_y_el_flujo_no_pide_descripcion`
- `constructor.reductor.el_nombre_de_un_agente_nuevo_es_el_primer_agente_n_libre`
- `constructor.reductor.hay_hasta_4_agentes_y_8_apps_con_su_aviso_y_sin_cuadros_encimados`
- `constructor.reductor.un_tope_alcanzado_no_cambia_el_flujo_ni_gasta_un_numero_de_id`
- `constructor.reductor.tocar_una_flecha_la_elige_y_suelta_el_cuadro_y_al_reves`
- `constructor.reductor.dos_ia_pueden_conversar_en_linea_recta_con_su_descripcion_y_volver_a_un_sentido`
- `constructor.reductor.una_descripcion_que_ya_estaba_escrita_no_se_pisa_al_volverse_ayudante`
- `constructor.reductor.una_herramienta_pasa_a_ser_paso_a_la_derecha_y_un_paso_vuelve_a_colgar_debajo`
- `constructor.reductor.si_la_regla_lo_rechaza_el_tipo_no_cambia_y_el_motivo_sale_en_el_aviso`
- `constructor.reductor.cambiar_el_tipo_de_la_conexion_donde_iba_a_insertar_cierra_ese_menu`
- `constructor.reductor.quitar_una_conexion_la_suelta_cierra_su_menu_y_manda_el_foco_a_su_origen`
- `constructor.reductor.en_medio_reemplaza_la_conexion_vieja_por_a_nuevo_b_y_corre_lo_que_sigue`
- `constructor.reductor.si_no_cabe_en_medio_avisa_y_no_toca_nada`
- `constructor.reductor.si_la_conexion_ya_no_existe_al_crear_se_cierra_el_menu_y_se_dice`
- `constructor.reductor.quitar_el_disparador_lo_dice_y_pide_otro_y_el_nuevo_se_reconecta`
- `constructor.reductor.quitar_un_cuadro_en_medio_une_lo_de_antes_con_lo_de_despues_y_deja_sueltas_sus_herramientas`
- `constructor.reductor.varias_herramientas_sueltas_se_cuentan_en_plural`
- `constructor.reductor.quitar_un_agente_sin_nada_antes_ni_despues_dice_solo_sus_conexiones`
- `constructor.reductor.quitar_cierra_el_menu_y_el_modo_conectando_y_conserva_la_flecha_elegida_si_sobrevive`
- `constructor.reductor.quitar_lo_ultimo_manda_el_foco_a_elegir_el_disparador_y_nunca_al_body`
- `constructor.reductor.quitar_una_ia_que_conversa_pasa_lo_que_le_seguia_a_su_agente`
- `constructor.reductor.conectar_con_uno_suelto_valida_y_rechaza_con_el_motivo_mas_elige_otro`
- `constructor.reductor.tocar_el_cuadro_de_origen_o_el_mismo_boton_cancela_y_cancelar_devuelve_el_foco`
- `constructor.reductor.tocar_un_cuadro_en_modo_conectando_intenta_la_conexion_y_no_abre_ajustes`
- `constructor.reductor.la_patita_tambien_conecta_con_una_app_que_ya_esta_pero_no_con_una_ia`
- `constructor.reductor.el_rol_destino_conecta_al_reves_y_cambia_los_textos`
- `constructor.reductor.volver_al_principio_o_al_disparador_se_rechaza_por_las_reglas`
- `constructor.reductor.por_la_patita_la_ia_libre_se_rechaza_y_la_ia_que_sigue_se_agrega_desde_la_que_conversa`
- `constructor.reductor.tocar_un_cuadro_lo_elige_cierra_el_menu_y_lleva_ajustes_a_la_vista`
- `constructor.reductor.esc_sobre_un_cuadro_cierra_el_menu_y_el_modo_conectando_y_si_no_hay_nada_no_hace_nada`
- `constructor.reductor.mover_un_cuadro_lo_ajusta_a_la_rejilla_de_8_y_al_lienzo_y_solo_mueve_ese`
- `constructor.reductor.mover_con_el_teclado_8_px_o_24_con_mayus_elige_el_cuadro_y_no_avisa`
- `constructor.reductor.editar_un_cuadro_mezcla_solo_los_campos_de_su_tipo_con_valores_que_existen`
- `constructor.reductor.al_cambiar_de_tipo_el_disparador_conserva_los_campos_que_ya_no_usa`
- `constructor.reductor.renombrar_el_flujo_recorta_a_80_sin_quitar_espacios_y_lo_igual_no_cambia`
- `constructor.reductor.limpiar_borra_cuadros_y_conexiones_conserva_el_nombre_y_pide_el_foco_al_disparador`
- `constructor.reductor.cargar_el_ejemplo_pone_el_flujo_el_nombre_el_cuadro_a1_y_pide_su_foco`
- `constructor.reductor.cargar_un_flujo_valido_lo_copia_elige_a1_y_el_contador_pasa_al_mayor_id_mas_uno`
- `constructor.reductor.cargar_un_flujo_que_rompe_un_tope_o_un_invariante_se_rechaza_con_su_aviso_y_no_toca_nada`
- `constructor.reductor.un_flujo_de_afuera_con_nombre_largo_o_sin_nombre_se_normaliza`
- `constructor.reductor.estado_inicial_con_un_flujo_lo_copia_y_uno_invalido_arranca_vacio`
- `constructor.reductor.el_contador_para_un_flujo_es_max_20_y_el_mayor_sufijo_mas_uno`
- `constructor.reductor.el_contador_nunca_baja_y_los_ids_no_se_repiten_ni_al_quitar_ni_al_deshacer`
- `constructor.reductor.nodo_y_conexion_creados_juntos_comparten_el_numero_y_poner_en_medio_gasta_dos`
- `constructor.reductor.cada_accion_pide_el_foco_que_dice_la_tabla_y_nunca_queda_en_body`
- `constructor.reductor.pedir_el_mismo_foco_dos_veces_sube_n_y_limpiar_peticiones_respeta_las_mas_nuevas`
- `constructor.reductor.cada_aviso_lleva_un_id_nuevo_aunque_el_texto_sea_el_mismo`
- `constructor.reductor.un_id_que_no_existe_deja_el_estado_exactamente_igual`
- `constructor.reductor.un_menu_cuyo_cuadro_ya_no_existe_se_cierra_y_nada_apunta_a_un_fantasma`
- `constructor.reductor.ninguna_accion_modifica_el_estado_ni_las_listas_que_recibe`
- `constructor.reductor.los_textos_de_aviso_son_los_del_apendice_a_con_su_tono`
- `constructor.reductor.recorridos_al_azar_jamas_rompen_un_invariante_ni_el_contador_ni_la_pila`

### `modelo/secretos.test.ts` (6)

El filtro `SECRETOS`: sus 16 patrones no guardan estado ni usan lookbehind, reconocen las ocho familias de Python y ocho formatos más, una palabra con `sk-` dentro no es una clave, tolera lo que no es texto y ningún patrón se atora con un texto enorme.

- `constructor.secretos.los_dieciseis_patrones_no_guardan_estado_ni_usan_lookbehind_y_solo_bearer_ignora_mayusculas`
- `constructor.secretos.con_clave_reconoce_las_ocho_familias_de_python_y_deja_pasar_el_texto_normal`
- `constructor.secretos.una_palabra_con_sk_dentro_no_es_una_clave_pero_la_clave_suelta_o_con_etiqueta_si`
- `constructor.secretos.con_clave_reconoce_los_ocho_formatos_de_notion_airtable_whatsapp_slack_github_stripe_y_sendgrid`
- `constructor.secretos.con_clave_tolera_lo_que_no_es_texto`
- `constructor.secretos.ningun_patron_se_atora_con_un_texto_enorme_hecho_a_proposito`

### `modelo/selectores.test.ts` (44)

Los selectores, lo que la pantalla pinta: cuadros (título, detalle, ícono, etiqueta), flechas, menús abiertos, opciones bloqueadas por los topes, el lienzo que crece, los paneles de Ajustes de cada clase de cuadro y de la flecha, la guía y el resumen del flujo; nunca `NaN`, `undefined` ni objetos compartidos entre llamadas, los textos van en español LATAM con tuteo, y los ids con nombre de prototipo no rompen nada.

- `constructor.selectores.cada_cuadro_del_ejemplo_trae_tipo_titulo_detalle_icono_y_etiqueta`
- `constructor.selectores.el_detalle_del_disparador_depende_de_su_tipo_su_frecuencia_su_ruta_y_su_app`
- `constructor.selectores.una_app_dice_si_n8n_la_conoce_si_es_un_paso_o_si_es_herramienta`
- `constructor.selectores.un_agente_que_conversa_con_otro_lo_dice_y_el_que_lo_tiene_pierde_su_mas_de_la_derecha`
- `constructor.selectores.los_flags_del_mas_dicen_si_se_pinta_el_suelto_el_redondo_o_ninguno_y_si_hay_patita`
- `constructor.selectores.las_clases_salen_por_nombre_de_variante_y_ninguna_lleva_color`
- `constructor.selectores.en_modo_conectando_marca_el_ancla_los_destinos_validos_y_los_nulos_con_su_motivo`
- `constructor.selectores.al_conectar_con_rol_destino_se_invierte_la_pregunta_y_la_patita_no_filtra`
- `constructor.selectores.los_menus_abiertos_marcan_el_mas_que_los_abrio`
- `constructor.selectores.las_etiquetas_para_lectores_de_pantalla_dicen_el_verbo_y_el_objeto`
- `constructor.selectores.las_flechas_del_ejemplo_dan_la_curva_las_puntas_y_la_insignia_del_mockup`
- `constructor.selectores.cada_flecha_dice_su_forma_su_trazo_su_icono_y_sus_dos_textos`
- `constructor.selectores.la_conexion_elegida_se_marca_activa_y_se_dibuja_mas_gruesa`
- `constructor.selectores.una_conexion_con_un_extremo_que_no_existe_no_se_dibuja`
- `constructor.selectores.una_herramienta_encima_o_al_lado_del_agente_da_trazos_sin_nan`
- `constructor.selectores.sin_menu_o_con_un_ancla_que_ya_no_existe_no_hay_menu`
- `constructor.selectores.el_menu_de_lo_que_sigue_ofrece_app_agente_y_uno_del_lienzo_con_el_foco_en_la_primera`
- `constructor.selectores.al_final_del_flujo_el_menu_se_abre_mas_a_la_derecha_y_sin_nota`
- `constructor.selectores.el_menu_de_herramientas_abre_en_las_apps_sin_agentes_ni_atras_y_con_su_nota`
- `constructor.selectores.poner_en_medio_se_abre_bajo_la_insignia_de_la_flecha_y_sin_nota_ni_uno_existente`
- `constructor.selectores.los_topes_bloquean_las_opciones_con_su_motivo_y_la_primera_libre_lleva_el_foco`
- `constructor.selectores.el_lienzo_crece_hasta_los_cuadros_y_hasta_donde_pide_el_menu_abierto`
- `constructor.selectores.sin_cuadro_elegido_o_con_uno_que_ya_no_existe_no_hay_ajustes`
- `constructor.selectores.el_panel_de_un_agente_tras_un_chat_no_pide_tarea_y_lista_sus_conexiones`
- `constructor.selectores.un_agente_despues_de_otro_pide_tarea_y_despues_de_un_disparador_que_no_es_chat_la_pide_distinto`
- `constructor.selectores.el_panel_de_dos_ia_que_conversan_pide_para_que_le_sirve_y_el_principal_no_ofrece_lo_que_sigue`
- `constructor.selectores.el_panel_de_un_disparador_trae_sus_tipos_la_ruta_limpia_el_enlace_y_las_opciones`
- `constructor.selectores.el_panel_de_una_app_dice_si_n8n_la_conoce_y_si_es_herramienta_paso_o_esta_suelta`
- `constructor.selectores.una_conexion_con_un_cuadro_que_ya_no_existe_no_sale_en_la_lista`
- `constructor.selectores.sin_flecha_elegida_o_con_un_cuadro_elegido_o_con_un_extremo_perdido_no_hay_editor`
- `constructor.selectores.el_editor_de_un_solo_sentido_entre_dos_agentes_ofrece_ida_y_vuelta_y_poner_en_medio`
- `constructor.selectores.si_ya_conversan_la_opcion_activa_es_ida_y_vuelta_y_no_se_ofrece_poner_en_medio`
- `constructor.selectores.una_flecha_a_una_app_explica_la_ida_y_vuelta_como_herramienta`
- `constructor.selectores.la_opcion_que_no_se_puede_elegir_trae_su_motivo_y_la_activa_nunca_se_marca_asi`
- `constructor.selectores.el_panel_que_toca_es_el_del_cuadro_el_de_la_flecha_o_ninguno`
- `constructor.selectores.la_guia_y_el_texto_sin_seleccion_siguen_los_pasos_del_flujo`
- `constructor.selectores.el_texto_de_conectar_cambia_con_el_tipo_el_rol_y_el_nombre_del_ancla`
- `constructor.selectores.la_tarjeta_de_elegir_disparador_dice_paso_1_o_falta_y_ofrece_el_ejemplo_solo_con_el_lienzo_vacio`
- `constructor.selectores.el_resumen_usa_la_revision_del_exportador_y_no_pinta_errores_con_el_lienzo_vacio`
- `constructor.selectores.los_iconos_que_devuelven_existen_en_la_lista_de_iconos_y_un_estado_entero_del_constructor_sirve_de_entrada`
- `constructor.selectores.no_truenan_en_ningun_estado_ni_dejan_nan_undefined_object_ni_null_en_los_textos`
- `constructor.selectores.no_modifican_el_estado_que_reciben_ni_comparten_objetos_entre_llamadas`
- `constructor.selectores.los_textos_son_de_latam_con_tuteo_sin_puntos_suspensivos_de_tres_puntos_ni_signos_de_apertura`
- `constructor.selectores.los_ids_con_nombre_de_prototipo_no_rompen_nada_ni_tocan_object_prototype`

### `modelo/texto.test.ts` (16)

Las utilidades de texto: normalizar, ruta limpia, `slug`, recortar sin partir un emoji, literales de expresión que escapan comilla, barra, llaves y saltos, `sinIgual`, el primer agente libre, nombre seguro para herramienta, copia JSON que no comparte referencias, uuid determinista con forma de v4.

- `constructor.texto.norm_quita_mayusculas_acentos_y_espacios_y_lo_que_no_es_texto_es_vacio`
- `constructor.texto.ruta_limpia_deja_letras_numeros_guion_y_guion_bajo_sin_guiones_en_los_extremos`
- `constructor.texto.slug_solo_letras_y_numeros_hasta_60_y_nunca_termina_en_guion`
- `constructor.texto.frecuencia_en_texto_y_lo_desconocido_cae_en_cada_dia`
- `constructor.texto.uuid_determinista_da_siempre_lo_mismo_con_forma_de_v4`
- `constructor.texto.titulo_de_cada_cuadro_con_sus_nombres_por_defecto_y_el_disparador_raro_cae_en_chat`
- `constructor.texto.titulo_de_no_repite_un_nombre_que_parece_una_clave`
- `constructor.texto.recortar_corta_sin_dejar_la_mitad_de_un_emoji_y_limpia_un_sustituto_alto_final`
- `constructor.texto.es_objeto_acepta_los_objetos_y_rechaza_listas_null_y_lo_demas`
- `constructor.texto.literal_expr_escapa_comilla_barra_llaves_saltos_y_separadores_de_linea`
- `constructor.texto.expr_deia_y_salida_arman_las_expresiones_exactas`
- `constructor.texto.sin_igual_protege_solo_el_inicio`
- `constructor.texto.numero_libre_es_el_primer_agente_k_que_no_esta_en_uso`
- `constructor.texto.nombre_seguro_deja_solo_ascii_imprimible_y_vacio_es_herramienta`
- `constructor.texto.copia_json_no_comparte_referencias_y_conserva_el_orden_de_las_claves`
- `constructor.texto.copia_json_conserva_una_clave_proto_propia_sin_cambiar_el_prototipo_de_la_copia`

### `modelo/textos.test.ts` (4)

Los textos que se repiten en el menú, el aviso y el motivo de un cuadro son una sola frase (la regla de la patita, «solo un agente tiene herramientas», el banner de conectar y los topes) y un flujo de afuera rechazado dice por qué sin repetir la clave.

- `constructor.textos.la_regla_de_la_patita_se_dice_igual_en_el_menu_al_conectar_y_en_el_motivo_del_cuadro`
- `constructor.textos.solo_un_agente_tiene_herramientas_es_la_misma_frase_en_el_aviso_y_en_la_regla_de_conexion`
- `constructor.textos.el_banner_de_conectar_y_los_topes_del_menu_son_los_de_textos`
- `constructor.textos.un_flujo_de_afuera_rechazado_dice_por_que_sin_repetir_la_clave`

### `useArrastre.test.tsx` (17)

El arrastre con puntero: debajo de 6 px (suma de |dx| y |dy|) es un clic, una vez empezado ya no vuelve a pedir el umbral, el clic que cierra un arrastre se suprime una vez, se cancela si el botón ya no está apretado, solo el botón principal lo inicia, pide la captura del puntero (y sin ella no falla), el marco puede desplazarse a mitad del arrastre, `pointercancel` y la captura perdida lo terminan, y un segundo dedo no lo secuestra.

- `constructor.arrastre.bajo_el_umbral_de_6_manhattan_es_un_clic_y_no_mueve_nada`
- `constructor.arrastre.al_llegar_a_6_manhattan_empieza_y_cada_movimiento_avisa_origen_mas_desplazamiento`
- `constructor.arrastre.una_vez_empezado_ya_no_se_vuelve_a_pedir_el_umbral`
- `constructor.arrastre.el_clic_que_sigue_a_un_arrastre_se_suprime_una_vez_y_el_siguiente_si_pasa`
- `constructor.arrastre.la_marca_de_supresion_se_apaga_sola_si_el_clic_nunca_llega`
- `constructor.arrastre.un_clic_sin_arrastre_no_deja_marca_y_el_siguiente_clic_pasa`
- `constructor.arrastre.si_el_boton_ya_no_esta_apretado_el_arrastre_se_cancela_y_no_mueve_mas`
- `constructor.arrastre.solo_el_boton_principal_inicia_el_gesto`
- `constructor.arrastre.pide_la_captura_del_puntero_al_presionar_y_sin_captura_no_falla`
- `constructor.arrastre.un_puntero_que_ya_no_existe_al_pedir_la_captura_no_rompe_el_gesto`
- `constructor.arrastre.si_el_marco_se_desplaza_durante_el_arrastre_el_cuadro_sigue_al_puntero`
- `constructor.arrastre.pointercancel_y_la_captura_perdida_terminan_el_gesto`
- `constructor.arrastre.un_segundo_dedo_no_secuestra_el_arrastre_en_curso_ni_lo_termina`
- `constructor.arrastre.un_gesto_huerfano_no_deja_muerto_el_arrastre_de_otro_dedo_primario_del_mismo_tipo`
- `constructor.arrastre.un_dedo_que_no_es_primario_o_un_puntero_de_otro_tipo_siguen_sin_secuestrar_el_arrastre`
- `constructor.arrastre.unas_coordenadas_que_no_son_numeros_no_inician_ni_mueven_nada`
- `constructor.arrastre.el_arrastre_no_elige_el_cuadro_ni_abre_nada_por_si_solo`


## Pruebas sueltas (sin ID)

Las protege el registro de archivos de este doc, no el de IDs:

- Las **11 pruebas de las carpetas del Constructor que no llevan ID** (bordes y regresiones chicas) viven en los mismos archivos de arriba: `AjustesEnlace.test.tsx`, `AjustesNodo.test.tsx`, `Barra.test.tsx`,
  `ElegirDisparador.test.tsx`, `Flechas.test.tsx`, `Guia.test.tsx`, `MenuMas.test.tsx`, `Nodo.test.tsx` y `PanelJson.test.tsx`.
- `constructor.spec.ts` (Playwright, a 1100, 390 y 320 px): ver «Cómo probarlo». Cubre los viajes completos de punta a punta (armar con el «+», la patita y la flecha, dos IA que conversan, poner en medio, conectar con
  uno que ya está, quitar y «Deshacer» por el aviso, el botón y Ctrl+Z, «Limpiar», el disparador web y el de tiempo, la descarga real y el borrador), el teclado, el arrastre y «reducir movimiento».
- `EncabezadoHoja.test.tsx` (en `web/src/marca/`): el encabezado compartido de las hojas (un `h1`, tres migas, la última quieta, error claro si el lugar no está en el mapa).
- `avisos.test.ts` (en `web/src/nucleo/`): el aviso con `accion` (el botón «Deshacer»); `descargarArchivo.test.ts` (en `web/src/nucleo/`): el `Blob`, la URL temporal y el nombre limpio del archivo.
- `AutomatizacionesRecorrido.test.tsx` (en `web/src/pantallas/inicio/`) y `inicio-recorrido.spec.ts`: el área de Automatizaciones en el mapa y el recorrido (ver `inicio.md`).
- `tests/test_constructor_paridad.py`: ver «El exportador a n8n».

## Extensiones a archivos compartidos

- `web/src/marca/menu.ts`: el área de Automatizaciones deja de ser «Próximamente» (grupos `distrito` y `tus`; `constructor` y `asistente` con su `href` y sin `pagina`; `actualizar` apagada).
- `web/src/marca/EncabezadoHoja.tsx` (+ su prueba): el encabezado de las hojas con «Irremplazables» y tres migas, que usan el Constructor y el Asistente.
- `web/src/nucleo/avisos.ts` y `web/src/nucleo/globales.ts`: el aviso rápido admite `accion { texto, al }` (el botón «Deshacer»); `static/trabajos.js` ya lo soportaba.
- `web/src/nucleo/descargarArchivo.ts`: la primera descarga que se arma en la propia página (un `Blob`, una URL temporal y un `<a download>`); devuelve `false` donde el navegador no puede y quien llama ofrece copiar el texto.
- `web/src/ui/iconos.ts` y `static/iconos.js`: los 9 íconos nuevos, con la misma cadena en los dos.
- `server/migracion.py`: las entradas `constructor` y `asistente` (`retirada`). `server/app.py`: el router de `/api/automatiza/*` (es del Asistente).
- `web/src/pantallas/inicio/` y `web/e2e/inicio-recorrido.spec.ts`: las pruebas que daban por apagada a Automatizaciones (`Mapa.test.tsx`, `Recorrido.test.tsx`, `estadoRecorrido.test.ts`) y las nuevas del área; `docs/migracion/inicio.md`.
