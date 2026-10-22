# golden/ · la prueba dorada del exportador a n8n

El exportador (`../exportar.ts`) es un porte del mockup (`Main.dc.html:971-1150`) con correcciones. Esta carpeta prueba las dos cosas:
que el porte es fiel y que cada corrección es la que se dice aquí.

| Archivo | Qué es |
|---|---|
| `casos.ts` | Los 40 casos del harness del mockup (`prueba/harness.cjs`) en TypeScript: 34 flujos que se exportan (31 + 3 muestras del Asistente) y 6 que se rechazan. Mismos nombres y mismo orden que en `casos.json`. También los constructores (`base`, `nodoApp`, `nodoAgente`, `arista`, `conversan`…) que usan las pruebas. |
| `mockup-casos.json` | `casos.json` del mockup, **sin tocar** (sha256 `88d9a5521ebe826fd2b989eb2f5e9282a2961aff7c0842418be351405c914d83`). Es la referencia: lo que dijo el mockup. No se edita ni se regenera. |
| `flujos.json` | **El golden de producción**: lo que sale hoy del exportador para esos 40 casos (zona `UTC`). Lo escribe y lo compara `../exportar.golden.test.ts`. Lo lee `pipeline/validador.py` desde pytest (M4b). |
| `invariantes.ts` | Lo que todo archivo exportado debe cumplir (nombres únicos, conexiones que existen, un modelo por agente, credenciales vacías, sin claves, sin `__proto__`…). |

## Cómo se corre

```
cd web
npx vitest run src/pantallas/constructor/modelo/exportar.golden.test.ts src/pantallas/constructor/modelo/exportar.test.ts
ACTUALIZAR_DORADO=1 npx vitest run src/pantallas/constructor/modelo/exportar.golden.test.ts   # reescribe flujos.json
```

Sin `ACTUALIZAR_DORADO=1`, un `flujos.json` que falta o que cambió **falla** (nada se escribe en silencio). Si cambia a propósito:
reescríbelo, revisa el diff, y vuelve a pasarlo por el validador (`./venv/bin/python -I …`; ver abajo).

## Forma de `flujos.json` (lo que lee pytest)

```
{ "formato": 1, "zona": "UTC",
  "usanAgentTool": ["dos_IA_conversan", …],     // los que exportan `@n8n/n8n-nodes-langchain.agentTool`
  "rechazados":    ["err_sin_trigger", …],      // los 6 sin archivo (`flujo: null`)
  "casos": { "<nombre>": { "errores": [], "avisos": [], "usaAgentTool": false, "flujo": { …n8n… } | null } } }
```

Con el `permitidos.json` de hoy el validador acepta 29 de los 34 y rechaza los 5 de `usanAgentTool`, **solo** por
«Este nodo aún no lo soportamos: AI Agent Tool» (decisión D4 del plan: queda en manos del dueño). Con `agentTool`
permitido pasan los 34. Para pytest: «rechazado hoy; válido si agentTool se permitiera». Los avisos del validador
(`el nodo «…» no está conectado a nada`) son los mismos que ya muestra el Constructor.

## El porte es fiel (tiempo 1)

Antes de corregir nada, el porte reprodujo los 40 casos de `mockup-casos.json` **byte a byte** (`JSON.stringify(…, null, 1)`),
con una sola diferencia, de datos: D5 (abajo). Hoy `exportar.golden.test.ts` repite esa comparación aplicando al mockup
las diferencias deliberadas de esta lista, ni una más: si cambia otra cosa (un texto, el orden de una clave, un id), falla.
Los errores y avisos, y los 6 rechazos, son idénticos palabra por palabra.

## Diferencias respecto del mockup

Datos (no son del exportador):

- **D5 · El modelo de Claude.** El mockup fijaba `claude-haiku-5-5` en el nodo de Anthropic; ese id no existe en el repo ni se pudo
  verificar. `datos/ias.ts` no fija modelo (n8n usa el suyo), igual que Gemini y OpenRouter. Cambia `parameters` de todos los
  nodos «Anthropic Chat Model».

Correcciones del exportador (cada una tiene su prueba en `../exportar.test.ts` con el nombre de lo que cambió):

1. **`webhookId` distinto por flujo** (informe 06 §7.1). El mockup lo repartía con un contador determinista: era `6a99b44c-8a80-442b-8e6d-5c49206bc530`
   en los 26 flujos con chat o webhook, y en n8n la URL del chat es `/webhook/<webhookId>/chat`, así que dos flujos activos se pisaban.
   Ahora es un UUID v4 derivado de una huella del flujo (nombre, nodos y conexiones): el mismo flujo da siempre el mismo, uno distinto
   da otro. No cambia ningún otro id: el número del contador que gastaba se sigue gastando.
2. **Un agente suelto sin tarea no manda prompt vacío** (informe 06 §7.2). Sin entrada y sin tarea el mockup exportaba `promptType: "define"`
   con `text: ""` y n8n marca el prompt como obligatorio (`cadena_app_app` / «Revisor»). Ahora sale `{ options }` sin `promptType` ni `text`.
   Sigue el aviso «no está conectado a nada».
3. **Nombres de nodo únicos con `Set`** (informe 04 §4.3, §9.2-d). Con un objeto plano, `constructor`, `toString` o `valueOf` salían como
   «constructor 2». Ahora salen tal cual. `__proto__` se trata como nombre ya usado (sale «__proto__ 2»): como clave de `connections` no
   guarda nada propio (en el mockup escribía `main` en `Object.prototype`, y todos los objetos de la página lo heredaban), y un importador
   que lea el archivo podría contaminarse igual.
4. **Conexiones sin objetos planos.** `connections[nombre]` con un nodo llamado `constructor` apuntaba a la función `Object`: la conexión
   se perdía del archivo y se escribía en `Object.main` (comprobado con la misma lógica del mockup). Ahora se arma con `Map` y `Object.fromEntries`. La clave que evita repetir una conexión `main`
   (`origen>destino`) era ambigua con nombres que llevan «>» («x>y»+«z» y «x»+«y>z»); ahora es un par.
5. **Parámetros clonados** (informe 04 §4.6, §9.2-e). El mockup metía en el archivo el mismo objeto del catálogo (`parameters === K.IAS[0].params`).
   Ahora cada nodo recibe una copia profunda, aunque el catálogo entregara siempre el mismo objeto.
6. **El disparador va primero** en `nodes` (informe 04 §9.2-g). En el lienzo se agrega al final si se quitó y se vuelve a elegir; el
   archivo ya no depende de eso (y los ids no cambian por ello). En los 40 casos el disparador ya era el primero.
7. **«Recibe de N cuadros» cuenta orígenes distintos.** Un agente y su ayudante conectados al mismo cuadro son UNA entrada para n8n
   (la conexión `main` ya se deduplicaba); el aviso decía «recibe de 2 cuadros».
8. **Un texto que empieza con «=» no puede traer llaves.** `sinIgual` le antepone otro «=» a las instrucciones y a la descripción de un
   ayudante para que n8n no se coma el primero, pero con eso el texto `={{ $json.x }}` quedaba como `=={{ $json.x }}`: el primer «=» marca la
   expresión y las llaves se evaluaban (comprobado con el motor de expresiones de n8n-workflow 2.41.1: daba `=<el valor>`; con las llaves
   quitadas da el texto `= $json.x`). Ahora ese texto (y solo ese) pierde `{` y `}`, como ya pasaba con la tarea. Un texto que no empieza
   con «=» queda tal cual: n8n no evalúa un valor que no empieza con «=».
9. **Claves.** Además de lo que escribió la persona, se revisa lo que queda tras limpiarlo (la ruta del webhook, el nombre recortado o sin
   acentos, la tarea o el texto sin llaves): «sk aaaa…» pasa a ser «sk-aaaa…» en la ruta. Y `construirFlujo` revisa el archivo ya armado
   (textos y claves de objeto): si algo parece una clave, no hay archivo.
10. **Detalles.** Los nombres de nodo se recortan a 100 sin partir un emoji. Una posición no finita sale en 0 (un `NaN` salía `null`).
    La zona horaria se inyecta (`opciones.zona`) y solo se acepta si tiene forma de zona (`America/Mexico_City`); `zonaLocal()` la lee del
    navegador y es lo único que toca `Intl`, cuando se le pide.

No se cambió a propósito (decisión del dueño o fuera del exportador): el tope de largo de la ruta, la tarea, la descripción y las
instrucciones (informe 04 §9.2-i); `descriptionType: 'auto'` solo en Gmail como herramienta (informe 06 §1.7); que el validador de Python
no exija un modelo de chat en `agent`/`agentTool`; las credenciales siguen siendo referencias vacías.

## Cómo se pasa el golden por el validador

```
./venv/bin/python -I - <<'EOF'
import json, sys
sys.path.insert(0, ".")
from pipeline import validador
d = json.load(open("web/src/pantallas/constructor/modelo/golden/flujos.json", encoding="utf-8"))
for nombre, c in d["casos"].items():
    if c["flujo"] is not None:
        r = validador.validar(c["flujo"])
        print(nombre, "ok" if r.ok else r.errores)
EOF
```

Resultado de hoy: 29 `ok`; los 5 de `usanAgentTool` rechazados solo por agentTool; 34/34 con `agentTool` permitido.

## Paridad del catálogo con Python (`catalogo-usado.json`)

| Archivo | Qué es |
|---|---|
| `catalogo-usado.json` | Lo que el catálogo de TypeScript usa de n8n (por fila: `type`, `typeVersion`, credencial, el modelo de OpenAI) más los 16 patrones de claves de `../secretos.ts` y unas sondas de claves. Lo escribe y lo compara `../catalogo.paridad.test.ts`. Lo lee `tests/test_constructor_paridad.py` junto con `flujos.json`. |
| `n8n-referencia.json` | El recorte de `media/library/n8n/catalog.json` y `permitidos.json` que necesita `../catalogo.test.ts` (los nodos que usa la tabla, sus credenciales, el modelo que sugiere el repo y la lista de permitidos). Lo escribe y lo vigila `tests/test_constructor_paridad.py` contra los archivos reales; vitest solo lo lee. |

Dos mitades que solo se hablan por JSON (Python nunca parsea TypeScript; vitest nunca lee `media/` ni `pipeline/`, porque la etapa `web` del Dockerfile solo copia `web/`):

- **vitest** comprueba que `catalogo-usado.json` es EXACTAMENTE lo que dicen `catalogo.ts` y `datos/`, y que todo nodo que exporta el Constructor está en esa tabla (y al revés). Tocar una fila de `datos/` sin regenerar el JSON falla aquí, con la ruta del cambio (`$.apps[0].typeVersion: en el JSON 2.2, en TypeScript 2.3`).
- **pytest** compara el JSON con `media/library/n8n/catalog.json` y `permitidos.json`, pasa los 34 flujos de `flujos.json` por `pipeline/validador.py` (los 5 con `agentTool` en dos variantes: rechazo de hoy y válidos con `agentTool` permitido en una copia EN MEMORIA) y compara los patrones de claves con `validador.SECRETOS`. Regenerar el JSON con algo que n8n o el validador no aceptan falla allá.
- **Claves:** `secretos.ts` va por delante de Python en dos cosas: el límite de palabra (`\b`) delante de `sk-` y de `gh[pousr]_` (sin él, «task-management-system-webhook» parecía una clave) y ocho formatos que Python no conoce (Notion ×2, Airtable, WhatsApp/Meta, Slack de aplicación, GitHub de grano fino, Stripe, SendGrid). Cada diferencia está declarada en `tests/test_constructor_paridad.py` (`PYTHON_ATRASADO`, `REFORMAS_TS`, `EXTRAS_TS`); cuando `pipeline/validador.py` adopte los 16 patrones en el mismo orden, la prueba falla a propósito para borrar la excepción.
- **`n8n-referencia.json`** (Dockerfile): la etapa `web` corre vitest sin `media/` ni `pipeline/`. Lo que `catalogo.test.ts` comparaba contra el catálogo de n8n lo lee de ese recorte, y pytest lo regenera con `ACTUALIZAR_DORADO=1 ./venv/bin/python -m pytest tests/test_constructor_paridad.py -p no:cacheprovider -k referencia` si cambian `catalog.json` o `permitidos.json`. Un guardián de pytest revisa que ningún archivo de vitest del modelo salga de `web/`.

```
cd web && ACTUALIZAR_DORADO=1 npx vitest run src/pantallas/constructor/modelo/catalogo.paridad.test.ts   # reescribe catalogo-usado.json
./venv/bin/python -m pytest tests/test_constructor_paridad.py -p no:cacheprovider                        # desde la raíz
```

Sin `ACTUALIZAR_DORADO=1`, un `catalogo-usado.json` que falta o que cambió **falla** (nada se escribe en silencio). Las sondas se guardan por pedazos (`["sk-", 1], ["a", 20]`) para que el archivo no traiga nada con forma de clave.
