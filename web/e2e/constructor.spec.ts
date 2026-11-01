// El Constructor de automatizaciones (/estudio/automatizaciones/distrito/constructor/) en un navegador de verdad: lo que jsdom no ve (el
// aro de foco, el arrastre con el ratón y con el dedo, el scroll del lienzo, las medidas a 1100, 390 y 320 px, axe) y los viajes completos
// de punta a punta: armar un flujo con el «+», la patita y la flecha, quitar y «Deshacer» (por el botón de la barra, Ctrl+Z y el aviso),
// «Limpiar» con su pregunta, la descarga REAL del .json (con `waitForEvent('download')`, leyendo el archivo), «Ver el JSON», «Copiar», el
// borrador que sobrevive a recargar y el teclado.
//
// No se llama a nada: el Constructor se arma 100 % en el navegador. Lo único que sale de la página son los pedidos de sus scripts (auth.js,
// monedero.js y trabajos.js, con /api/trabajos simulado) y `simular` anota cualquier otro /api/: las pruebas lo exigen vacío.
//
// Capturas: con AUTOMATIZA_CAPTURAS=<carpeta> cada estado que se `revisa` se guarda como PNG (para mirarlas). Sin la variable no se guarda nada.
import { expect, test, type Page } from '@playwright/test';

import {
  abrir,
  agregarAgente,
  agregarApp,
  ajustes,
  ANCHOS,
  aroDelFoco,
  avisoDeshacer,
  bandeja,
  botonDeshacer,
  botonDescargar,
  botonJson,
  botonLimpiar,
  cajaJson,
  campoNombre,
  CLAVE_BORRADOR,
  darHerramienta,
  descargar,
  elegirDisparador,
  esFlujoDeN8n,
  esperarBorrador,
  flecha,
  flechas,
  flujoSencillo,
  focoEnElCuerpo,
  leerBorrador,
  lienzo,
  mas,
  medir,
  menu,
  nodo,
  nodos,
  opcion,
  patita,
  principal,
  quitarX,
  revisar,
  simular,
  solapes,
  tiposDe,
} from './constructor';
import { animacionesVivas } from './pantallas';

const TIPO_CHAT = '@n8n/n8n-nodes-langchain.chatTrigger';
const TIPO_AGENTE = '@n8n/n8n-nodes-langchain.agent';
const TIPO_AGENTE_HERRAMIENTA = '@n8n/n8n-nodes-langchain.agentTool';
const TIPO_MODELO_OPENAI = '@n8n/n8n-nodes-langchain.lmChatOpenAi';
const TIPO_GMAIL = 'n8n-nodes-base.gmail';
const TIPO_SHEETS_HERRAMIENTA = 'n8n-nodes-base.googleSheetsTool';

/** Carga el ejemplo del lienzo vacío (cinco cuadros: Chat → «Atención a clientes» → «Revisor», con Google Sheets y Slack de herramientas). */
async function cargarEjemplo(page: Page) {
  await page.getByRole('button', { name: 'Cargar el ejemplo' }).click();
  await expect(nodos(page)).toHaveCount(5);
}

/** La posición de un cuadro en el lienzo, leída de su caja. */
const posicion = (page: Page, titulo: string) =>
  nodo(page, titulo).evaluate(el => {
    const caja = el.parentElement as HTMLElement;
    return { x: parseInt(caja.style.left, 10), y: parseInt(caja.style.top, 10) };
  });

/** Un flujo de 13 cuadros (el máximo: 1 disparador, 4 agentes y 8 apps) tal como lo guarda el borrador del navegador. */
function flujoMaximo() {
  const nodes: Array<Record<string, unknown>> = [{ id: 't1', kind: 'trigger', x: 8, y: 180, tipo: 'chat', frec: 'dia', ruta: 'mi-flujo', app: 'gmail' }];
  const edges: Array<Record<string, string>> = [];
  let e = 0;
  for (let i = 0; i < 4; i++) {
    const x = 312 + 304 * i;
    nodes.push({ id: `a${i + 1}`, kind: 'agent', x, y: 180, nombre: `Agente ${i + 1}`, ia: 'openai', tarea: '', instrucciones: 'Eres un asistente útil. Responde en español, con claridad.' });
    edges.push({ id: `e${++e}`, de: i === 0 ? 't1' : `a${i}`, a: `a${i + 1}`, tipo: 'seq' });
    for (let k = 0; k < 2; k++) {
      const id = `p${2 * i + k + 1}`;
      nodes.push({ id, kind: 'app', x: x - 136, y: 380 + 192 * k, nombre: ['Gmail', 'Slack', 'Notion', 'Airtable', 'WhatsApp', 'Telegram', 'Google Drive', 'Google Docs'][2 * i + k] });
      edges.push({ id: `e${++e}`, de: `a${i + 1}`, a: id, tipo: 'tool' });
    }
  }
  return { v: 1, nodes, edges, nombreFlujo: 'El flujo más grande' };
}

// ---------------------------------------------------------------------------
// Medidas y axe: a 1100, 390 y 320 px, un `revisar` por estado

for (const { ancho, alto } of ANCHOS) {
  test.describe(`Constructor a ${ancho} px`, () => {
    test.use({ viewport: { width: ancho, height: alto } });

    test('reposo: encabezado, la tarjeta del disparador, nada que descargar y ningún botón ámbar', async ({ page }) => {
      const red = await simular(page);
      await abrir(page);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Irremplazables');
      await expect(page.getByRole('navigation', { name: 'Dónde estás' }).locator('li')).toContainText(['Automatizaciones', 'Distrito', 'Constructor']);
      await expect(page.getByText('Paso 1: elige cómo arranca tu flujo.')).toBeVisible();
      // la tarjeta sobre el lienzo, con las cuatro maneras de arrancar y el ejemplo
      const tarjeta = page.getByRole('group', { name: 'Disparador del flujo' });
      await expect(page.getByRole('heading', { name: '¿Qué hace que tu flujo arranque?' })).toBeVisible();
      await expect(tarjeta.getByRole('button')).toHaveText([/^Tiempo/, /^Chat/, /^Web/, /^App/]);
      await expect(page.getByRole('button', { name: 'Cargar el ejemplo' })).toBeVisible();
      // sin cuadros no hay nada que deshacer, limpiar ni descargar: apagados con `aria-disabled`, enfocables, y explican por qué
      for (const b of [botonDeshacer(page), botonLimpiar(page), botonDescargar(page)]) {
        await expect(b).toHaveAttribute('aria-disabled', 'true');
        await expect(b).not.toHaveAttribute('disabled', /.*/);
        await expect(b).toHaveAccessibleDescription(/\S/);
      }
      await expect(botonDescargar(page)).toHaveAccessibleDescription('Todavía no hay nada que descargar: primero elige cómo arranca tu flujo.');
      // un solo botón ámbar por pantalla: con el flujo vacío, ninguno (el principal está apagado)
      const ambar = await page.locator('button').evaluateAll(bs => bs.filter(b => getComputedStyle(b).backgroundColor === 'rgb(218, 140, 40)').map(b => b.textContent));
      expect(ambar).toEqual([]);
      // el lienzo es un marco con su propio scroll y, con la tarjeta adentro, no necesita foco propio
      await expect(lienzo(page)).toHaveCSS('overflow-x', 'auto');
      await tarjeta.getByRole('button').first().focus();
      await revisar(page, 'constructor-reposo');
      expect(red.ajenos).toEqual([]);
    });

    test('el ejemplo: cinco cuadros, el agente elegido con sus ajustes, un solo botón ámbar y el lienzo que se desplaza por dentro', async ({ page }) => {
      const red = await simular(page);
      await abrir(page);
      await cargarEjemplo(page);
      await expect(campoNombre(page)).toHaveValue('Atención a clientes');
      await expect(nodo(page, 'Atención a clientes')).toBeFocused();
      await expect(nodo(page, 'Atención a clientes')).toHaveAttribute('aria-pressed', 'true');
      await expect(ajustes(page)).toHaveAccessibleName('Ajustes del cuadro');
      await expect(ajustes(page).getByRole('heading', { name: 'Agente de IA' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Cargar el ejemplo' })).toHaveCount(0);
      await expect(page.getByText(/^Listo para descargar: 5 cuadros\./)).toBeVisible();
      // «Descargar .json» es ahora el ÚNICO botón ámbar
      await expect(botonDescargar(page)).not.toHaveAttribute('aria-disabled', 'true');
      await expect(botonDescargar(page)).toHaveCSS('background-color', 'rgb(218, 140, 40)');
      const ambar = await page.locator('button').evaluateAll(bs => bs.filter(b => getComputedStyle(b).backgroundColor === 'rgb(218, 140, 40)').map(b => b.textContent?.trim()));
      expect(ambar).toEqual(['Descargar .json']);
      // el ejemplo no hace «entrar» los cuadros: cuando termina de cargarse no queda ninguna animación corriendo
      expect(await page.evaluate(animacionesVivas)).toEqual([]);
      // el marco hace scroll por dentro: la página no se ensancha ni a 320 px
      const m = await lienzo(page).evaluate(el => ({ ancho: el.clientWidth, total: el.scrollWidth, overflowX: getComputedStyle(el).overflowX }));
      expect(m.overflowX).toBe('auto');
      if (ancho < 1100) expect(m.total).toBeGreaterThan(m.ancho);
      await lienzo(page).evaluate(el => (el.scrollLeft = 200));
      expect(await page.evaluate(() => window.scrollX)).toBe(0);
      expect((await medir(page)).scrollW).toBeLessThanOrEqual(ancho);
      await revisar(page, 'constructor-ejemplo');
      expect(red.ajenos).toEqual([]);
    });

    test('Ajustes de cada clase de cuadro (disparador, agente, herramienta) y del disparador web, cada uno revisado', async ({ page }) => {
      await simular(page);
      await abrir(page);
      await cargarEjemplo(page);
      // el disparador de chat: ni frecuencia ni ruta
      await nodo(page, 'Chat').click();
      await expect(ajustes(page).getByRole('heading', { name: 'Disparador' })).toBeVisible();
      await expect(ajustes(page).getByRole('group', { name: 'Tipo de disparador' }).getByRole('button', { pressed: true })).toHaveText(/^Chat/);
      await revisar(page, 'constructor-ajustes-disparador');
      // una herramienta (app)
      await nodo(page, 'Google Sheets').click();
      await expect(ajustes(page).getByRole('heading', { name: 'App' })).toBeVisible();
      await expect(ajustes(page).getByLabel('Nombre de la app')).toHaveValue('Google Sheets');
      await expect(ajustes(page).getByText('n8n ya sabe conectarse a esta app.')).toBeVisible();
      await revisar(page, 'constructor-ajustes-app');
      // el agente: nombre, las cuatro IA, instrucciones
      await nodo(page, 'Revisor').click();
      await expect(ajustes(page).getByRole('group', { name: 'IA del agente' }).getByRole('button')).toHaveCount(4);
      await expect(ajustes(page).getByRole('group', { name: 'IA del agente' }).getByRole('button', { pressed: true })).toHaveText(/^Claude \(Anthropic\)/);
      await revisar(page, 'constructor-ajustes-agente');
      // el disparador web pide una ruta y enseña el enlace que va a quedar
      await nodo(page, 'Chat').click();
      await ajustes(page).getByRole('group', { name: 'Tipo de disparador' }).getByRole('button', { name: /^Web/ }).click();
      await expect(ajustes(page).getByLabel('Ruta del enlace (letras, números y guiones)')).toBeVisible();
      await expect(ajustes(page).getByText(/^Tu enlace quedará así: .*\/webhook\/mi-flujo$/)).toBeVisible();
      await revisar(page, 'constructor-ajustes-disparador-web');
    });

    test('el «+» abre su menú pegado al lienzo: primero qué poner, luego qué app, y los dos se revisan', async ({ page }) => {
      await simular(page);
      await abrir(page);
      await elegirDisparador(page, 'Chat');
      await mas(page, 'Disparador Chat').click();
      await expect(menu(page)).toHaveAccessibleName('Agregar después de «Disparador Chat»');
      await expect(mas(page, 'Disparador Chat')).toHaveAttribute('aria-expanded', 'true');
      await expect(opcion(menu(page), 'Una aplicación')).toBeFocused();
      await revisar(page, 'constructor-menu-inicio');
      await opcion(menu(page), 'Una aplicación').click();
      await expect(menu(page)).toHaveAccessibleName('Elige la aplicación');
      await expect(menu(page).getByRole('button', { name: 'Gmail', exact: true })).toBeFocused();
      await expect(menu(page).getByRole('group', { name: 'Apps con conector listo' }).getByRole('button')).toHaveCount(10);
      await revisar(page, 'constructor-menu-apps');
      // el menú entra entero en la ventana (no se corta por ningún lado)
      const caja = (await menu(page).boundingBox())!;
      expect(caja.x).toBeGreaterThanOrEqual(0);
      expect(caja.x + caja.width).toBeLessThanOrEqual(ancho);
    });

    test('el editor de la flecha: las dos maneras de conectar, con texto y no solo con el trazo', async ({ page }) => {
      await simular(page);
      await abrir(page);
      await flujoSencillo(page);
      await flecha(page, 'Agente 1', 'Gmail').click();
      await expect(ajustes(page)).toHaveAccessibleName('Ajustes de la conexión');
      await expect(ajustes(page).getByRole('heading', { name: 'Conexión' })).toBeVisible();
      await expect(ajustes(page).getByRole('button', { name: /^Un solo sentido/ })).toHaveAttribute('aria-pressed', 'true');
      await expect(ajustes(page).getByRole('button', { name: /^Ida y vuelta/ })).toHaveAttribute('aria-pressed', 'false');
      await expect(ajustes(page).getByRole('button', { name: 'Poner un cuadro en medio' })).toBeVisible();
      await revisar(page, 'constructor-editor-flecha');
    });

    test('Ver el JSON y el aviso con «Deshacer» de la esquina, juntos', async ({ page }) => {
      await simular(page);
      await abrir(page);
      await flujoSencillo(page);
      await botonJson(page).click();
      await expect(cajaJson(page)).toBeVisible();
      await quitarX(page, 'Gmail').click();
      await expect(avisoDeshacer(page)).toBeVisible();
      await expect(bandeja(page)).toContainText('Quitamos «Gmail» y sus conexiones.');
      await nodo(page, 'Agente 1').focus();
      await revisar(page, 'constructor-json-y-aviso');
      // el aviso no tapa ningún control del lienzo: abajo a la derecha no hay nada que tocar de la pantalla bajo la caja de avisos
      const caja = (await bandeja(page).boundingBox())!;
      const tapados = await page.evaluate(({ x, y, w, h }) => {
        const botones = [...document.querySelectorAll<HTMLElement>('main button, main a, main input, main select, main textarea')];
        return botones
          .filter(b => {
            const r = b.getBoundingClientRect();
            return r.width > 0 && r.right > x && r.left < x + w && r.bottom > y && r.top < y + h && r.top < window.innerHeight && r.bottom > 0;
          })
          .map(b => b.getAttribute('aria-label') ?? b.textContent?.trim().slice(0, 30));
      }, { x: caja.x, y: caja.y, w: caja.width, h: caja.height });
      // en un celular la caja ocupa todo el ancho de abajo y puede tapar lo que quede ahí un rato: se mide para saberlo, no se exige
      if (ancho >= 1100) expect(tapados, 'controles bajo la caja de avisos').toEqual([]);
    });

    test('un flujo de 13 cuadros, el máximo, se carga del borrador y se mide; los topes de apps y agentes lo dicen', async ({ page }) => {
      await simular(page);
      await page.addInitScript(
        ([clave, borrador]) => localStorage.setItem(clave!, borrador!),
        [CLAVE_BORRADOR, JSON.stringify(flujoMaximo())],
      );
      await abrir(page);
      await expect(nodos(page)).toHaveCount(13);
      await expect(campoNombre(page)).toHaveValue('El flujo más grande');
      await expect(page.getByText('Recuperamos tu borrador.').first()).toBeVisible();
      await expect(page.getByText(/^Listo para descargar: 13 cuadros\./)).toBeVisible();
      await nodo(page, 'Agente 4').focus();
      await revisar(page, 'constructor-flujo-grande');
      // el menú del último agente: ni una app ni un agente más (los dos topes se dicen con texto, no solo con el aspecto)
      await mas(page, 'Agente 4').click();
      await expect(opcion(menu(page), 'Una aplicación')).toHaveAttribute('aria-disabled', 'true');
      await expect(opcion(menu(page), 'Un agente de IA')).toHaveAttribute('aria-disabled', 'true');
      await expect(opcion(menu(page), 'Una aplicación')).toContainText('Por ahora son hasta 8 apps por flujo.');
      await expect(opcion(menu(page), 'Un agente de IA')).toContainText('Por ahora son hasta 4 agentes por flujo.');
      await opcion(menu(page), 'Una aplicación').click({ force: true }); // apagada con `aria-disabled`: el clic llega y el reductor dice el motivo
      await expect(nodos(page)).toHaveCount(13);
      await expect(bandeja(page).getByRole('alert')).toContainText('Por ahora son hasta 8 apps por flujo.');
      await revisar(page, 'constructor-topes');
    });

    test('palabras largas sin espacios (nombres de 60 y 80 letras) no ensanchan la página ni se salen de su caja', async ({ page }) => {
      await simular(page);
      await abrir(page);
      await flujoSencillo(page);
      const larga = 'W'.repeat(60);
      await nodo(page, 'Agente 1').click();
      await ajustes(page).getByLabel('Nombre del agente').fill(larga);
      await campoNombre(page).fill('M'.repeat(80));
      await nodo(page, larga).focus();
      await botonJson(page).click();
      await revisar(page, 'constructor-palabras-largas');
      // el cuadro corta el nombre con puntos suspensivos dentro de sus 216 px: no crece
      const caja = await nodo(page, larga).boundingBox();
      expect(caja!.width).toBeLessThanOrEqual(216 + 0.5);
    });

    test('la pregunta de «Limpiar» se revisa: foco en «Cancelar»', async ({ page }) => {
      await simular(page);
      await abrir(page);
      await flujoSencillo(page);
      await botonLimpiar(page).click();
      const pregunta = page.getByRole('alertdialog', { name: '¿Limpiar todo el flujo?' });
      await expect(pregunta).toBeVisible();
      await expect(pregunta.getByRole('button', { name: 'Cancelar' })).toBeFocused();
      await revisar(page, 'constructor-limpiar-pregunta');
    });
  });
}

// ---------------------------------------------------------------------------
// Armar un flujo, de punta a punta (a 1100 px)

test.describe('Constructor: armar un flujo', () => {
  test.use({ viewport: { width: 1100, height: 900 } });

  test('un sentido y ida y vuelta: disparador, agente, Gmail como paso y Google Sheets en la patita; se descarga el .json de verdad', async ({ page }) => {
    const red = await simular(page);
    await abrir(page);
    await expect(botonDescargar(page)).toHaveAttribute('aria-disabled', 'true');

    await elegirDisparador(page, 'Chat');
    await expect(nodo(page, 'Chat')).toBeFocused(); // el foco pasa al cuadro que acaba de nacer
    await expect(bandeja(page)).toContainText('Listo: el flujo arranca con «Disparador Chat». Ahora toca el + para agregar lo que sigue.');
    await expect(page.getByRole('group', { name: 'Disparador del flujo' })).toHaveCount(0); // la tarjeta se fue: ya hay disparador
    await expect(page.getByText('Paso 2: toca el + junto al disparador', { exact: false })).toBeVisible();
    await expect(botonDescargar(page)).toHaveAttribute('aria-disabled', 'true'); // «toca el + … para agregar el primer paso»

    await agregarAgente(page, 'Disparador Chat');
    await expect(nodo(page, 'Agente 1')).toBeFocused();
    await expect(menu(page)).toHaveCount(0); // el menú se cierra solo al agregar
    await expect(flecha(page, 'Disparador Chat', 'Agente 1')).toHaveAccessibleName('Conexión de «Disparador Chat» a «Agente 1»: un solo sentido. Editar');

    // Gmail DESPUÉS del agente: un solo sentido
    await agregarApp(page, 'Agente 1', 'Gmail');
    await expect(nodo(page, 'Gmail')).toBeFocused();
    await expect(nodo(page, 'Gmail')).toHaveAccessibleName(/^App · paso del flujo: Gmail\./);
    await expect(flecha(page, 'Agente 1', 'Gmail')).toHaveAccessibleName(/un solo sentido\. Editar$/);

    // Google Sheets por la PATITA: herramienta, ida y vuelta (la patita abre directo la lista de apps y solo ofrece apps)
    await patita(page, 'Agente 1').click();
    await expect(menu(page)).toHaveAccessibleName('Darle una herramienta a «Agente 1»');
    await expect(menu(page).getByRole('group', { name: 'Apps con conector listo' }).getByRole('button')).toHaveCount(10);
    await expect(menu(page).getByRole('button', { name: /^Un agente de IA/ })).toHaveCount(0);
    await menu(page).getByRole('button', { name: 'Google Sheets', exact: true }).click();
    await expect(nodo(page, 'Google Sheets')).toBeFocused();
    await expect(nodo(page, 'Google Sheets')).toHaveAccessibleName(/^App · herramienta: Google Sheets\./);
    await expect(nodo(page, 'Google Sheets')).toHaveAccessibleDescription(/herramienta de «Agente 1»/);
    await expect(flecha(page, 'Agente 1', 'Google Sheets')).toHaveAccessibleName(/ida y vuelta\. Editar$/);
    await expect(flechas(page)).toHaveCount(3);

    // ya se puede descargar: listo, un solo botón ámbar, y el archivo es el de n8n
    await expect(page.getByText(/^Listo para descargar: 4 cuadros\./)).toBeVisible();
    await expect(botonDescargar(page)).not.toHaveAttribute('aria-disabled', 'true');
    const archivo = await descargar(page);
    expect(archivo.nombre).toBe('mi-automatizacion.json');
    expect(esFlujoDeN8n(archivo.json)).toBe(true);
    expect(archivo.json.name).toBe('Mi automatización');
    // el agente trae SU modelo (un nodo aparte) y las apps traen su cuenta sin llaves
    expect(tiposDe(archivo.json)).toEqual([TIPO_CHAT, TIPO_AGENTE, TIPO_MODELO_OPENAI, TIPO_GMAIL, TIPO_SHEETS_HERRAMIENTA]);
    const c = archivo.json.connections;
    expect(c['When chat message received'].main[0]).toEqual([{ node: 'Agente 1', type: 'main', index: 0 }]); // el disparador pasa al agente
    expect(c['Agente 1'].main[0]).toEqual([{ node: 'Gmail', type: 'main', index: 0 }]); // un sentido: el agente le pasa a Gmail
    expect(c['Google Sheets'].ai_tool[0]).toEqual([{ node: 'Agente 1', type: 'ai_tool', index: 0 }]); // ida y vuelta: Sheets es herramienta del agente
    expect(c['OpenAI Chat Model'].ai_languageModel[0]).toEqual([{ node: 'Agente 1', type: 'ai_languageModel', index: 0 }]);
    expect(archivo.texto).not.toMatch(/sk-|AIza|Bearer /);
    for (const n of archivo.json.nodes) for (const cred of Object.values(n.credentials ?? {})) expect((cred as { id: string }).id).toBe(''); // sin llaves ni ids de cuentas
    // lo que sigue (importarlo en n8n) queda a la vista y se lo dice el aviso, que no se apaga solo
    await expect(bandeja(page)).toContainText('Listo: mi-automatizacion.json. En n8n, abre el menú «⋯» de arriba a la derecha y elige «Import from File».');
    await expect(page.getByText('Para abrirlo en n8n: en el menú «⋯» de arriba a la derecha, elige «Import from File».')).toBeVisible();
    // armarlo no mandó nada a ningún servidor
    expect(red.ajenos).toEqual([]);
  });

  test('dos IA conversan: un agente después de otro, y su flecha pasa a «ida y vuelta» (y vuelve)', async ({ page }) => {
    await simular(page);
    await abrir(page);
    await elegirDisparador(page, 'Chat');
    await agregarAgente(page, 'Disparador Chat');
    await agregarAgente(page, 'Agente 1');
    await expect(nodo(page, 'Agente 2')).toBeFocused();
    // el segundo agente va a la derecha del primero, en línea recta
    const uno = await posicion(page, 'Agente 1');
    const dos = await posicion(page, 'Agente 2');
    expect(dos.x).toBeGreaterThanOrEqual(uno.x + 216 + 60);
    expect(dos.y).toBe(uno.y);
    await expect(flecha(page, 'Agente 1', 'Agente 2')).toHaveAccessibleName(/un solo sentido/);

    await flecha(page, 'Agente 1', 'Agente 2').click();
    await expect(ajustes(page)).toHaveAccessibleName('Ajustes de la conexión');
    await expect(ajustes(page).getByRole('button', { name: /^Un solo sentido/ })).toBeFocused(); // el foco cae en la primera opción del editor
    await ajustes(page).getByRole('button', { name: /^Ida y vuelta/ }).click();
    await expect(bandeja(page)).toContainText('«Agente 1» y «Agente 2» ahora conversan: ida y vuelta.');
    await expect(flecha(page, 'Agente 1', 'Agente 2')).toHaveAccessibleName(/ida y vuelta\. Editar$/);
    await expect(ajustes(page).getByRole('button', { name: /^Ida y vuelta/ })).toHaveAttribute('aria-pressed', 'true');
    // el segundo agente ahora conversa con el primero: su cuadro lo dice; lo que sigue se agrega desde él, así que el primero pierde su «+» de la derecha
    await expect(nodo(page, 'Agente 2')).toHaveAccessibleDescription('Agente de IA que conversa con «Agente 1»');
    await expect(mas(page, 'Agente 1')).toHaveCount(0);
    await expect(mas(page, 'Agente 2')).toBeVisible();
    // y le pide para qué le sirve al otro (trae una frase por omisión)
    await nodo(page, 'Agente 2').click();
    await expect(ajustes(page).getByText('Conversa con otra IA')).toBeVisible();
    await expect(ajustes(page).getByLabel('¿Para qué le sirve a «Agente 1»? (así sabe cuándo pedirle su opinión)')).toHaveValue(
      'Un colega que revisa lo que le mandes, señala qué mejorar y responde con su propuesta.',
    );
    const archivo = await descargar(page);
    expect(tiposDe(archivo.json)).toEqual([TIPO_CHAT, TIPO_AGENTE, TIPO_MODELO_OPENAI, TIPO_AGENTE_HERRAMIENTA, TIPO_MODELO_OPENAI]);
    const ayudante = archivo.json.nodes.find((n: { type: string }) => n.type === TIPO_AGENTE_HERRAMIENTA);
    expect(ayudante.parameters.toolDescription).toBe('Un colega que revisa lo que le mandes, señala qué mejorar y responde con su propuesta.');
    expect(archivo.json.connections[ayudante.name].ai_tool[0]).toEqual([{ node: 'Agente 1', type: 'ai_tool', index: 0 }]);

    // de vuelta a un solo sentido
    await flecha(page, 'Agente 1', 'Agente 2').click();
    await ajustes(page).getByRole('button', { name: /^Un solo sentido/ }).click();
    await expect(flecha(page, 'Agente 1', 'Agente 2')).toHaveAccessibleName(/un solo sentido\. Editar$/);
    await expect(mas(page, 'Agente 1')).toBeVisible();
    // una IA no puede ir por la patita: solo apps
    await patita(page, 'Agente 1').click();
    await expect(menu(page).getByRole('button', { name: /^Un agente de IA/ })).toHaveCount(0);
  });

  test('poner un cuadro en medio de una conexión: el editor de la flecha lo inserta y las dos flechas nuevas reemplazan a la vieja', async ({ page }) => {
    await simular(page);
    await abrir(page);
    await flujoSencillo(page);
    const antes = await posicion(page, 'Gmail');
    await flecha(page, 'Agente 1', 'Gmail').click();
    await ajustes(page).getByRole('button', { name: 'Poner un cuadro en medio' }).click();
    await expect(menu(page)).toHaveAccessibleName('Poner en medio');
    await expect(ajustes(page).getByRole('button', { name: 'Poner un cuadro en medio' })).toHaveAttribute('aria-expanded', 'true');
    await opcion(menu(page), 'Una aplicación').click();
    await menu(page).getByRole('button', { name: 'Slack', exact: true }).click();
    await expect(nodo(page, 'Slack')).toBeFocused();
    await expect(bandeja(page)).toContainText('Agregamos «Slack» en medio.');
    await expect(flecha(page, 'Agente 1', 'Slack')).toBeVisible();
    await expect(flecha(page, 'Slack', 'Gmail')).toBeVisible();
    await expect(flecha(page, 'Agente 1', 'Gmail')).toHaveCount(0); // la conexión vieja se reemplazó
    await expect(flechas(page)).toHaveCount(3);
    // Gmail se corrió a la derecha para hacerle lugar, y Slack quedó entre el agente y Gmail
    const agente = await posicion(page, 'Agente 1');
    const slack = await posicion(page, 'Slack');
    const despues = await posicion(page, 'Gmail');
    expect(despues.x).toBeGreaterThan(antes.x);
    expect(slack.x).toBeGreaterThan(agente.x + 216);
    expect(slack.x + 216).toBeLessThanOrEqual(despues.x);
    const archivo = await descargar(page);
    expect(archivo.json.connections['Agente 1'].main[0]).toEqual([{ node: 'Slack', type: 'main', index: 0 }]);
    expect(archivo.json.connections.Slack.main[0]).toEqual([{ node: 'Gmail', type: 'main', index: 0 }]);
  });

  test('conectar con un cuadro que ya está: «Conectando…» dice qué tocar, marca a dónde sí y a dónde no (con su motivo), Esc cancela y el foco vuelve al cuadro', async ({ page }) => {
    await simular(page);
    await abrir(page);
    await elegirDisparador(page, 'Chat');
    await agregarAgente(page, 'Disparador Chat');
    await agregarApp(page, 'Agente 1', 'Gmail');
    await agregarApp(page, 'Agente 1', 'Slack');
    await expect(nodos(page)).toHaveCount(4);
    // Gmail → «Uno que ya está en el lienzo»
    await mas(page, 'Gmail').click();
    await opcion(menu(page), 'Uno que ya está en el lienzo').click();
    await expect(menu(page)).toHaveCount(0);
    const conectando = page.getByText('Toca el cuadro que irá DESPUÉS de «Gmail».', { exact: false }).first();
    await expect(principal(page).getByText(/^Conectando\./)).toBeVisible();
    await expect(conectando).toBeVisible();
    await expect(nodo(page, 'Gmail')).toBeFocused();
    // a Slack sí se puede llegar; al agente no (haría un círculo) y al disparador tampoco: se oyen con `aria-disabled` y su motivo
    await expect(nodo(page, 'Slack')).not.toHaveAttribute('aria-disabled', 'true');
    await expect(nodo(page, 'Agente 1')).toHaveAttribute('aria-disabled', 'true');
    await expect(nodo(page, 'Agente 1')).toHaveAccessibleDescription('Eso haría un círculo: el flujo volvería a empezar solo.');
    await expect(nodo(page, 'Chat')).toHaveAttribute('aria-disabled', 'true');
    await expect(nodo(page, 'Chat')).toHaveAccessibleDescription('Nada puede ir antes de un disparador: él es el inicio del flujo.');
    await nodo(page, 'Slack').focus();
    await revisar(page, 'constructor-conectando');
    // tocar uno que no se puede explica por qué, con cómo seguir, y sigue esperando
    await nodo(page, 'Agente 1').click({ force: true }); // `aria-disabled`, no `disabled`: el clic llega y el reductor explica
    await expect(bandeja(page).getByRole('alert')).toContainText('Eso haría un círculo: el flujo volvería a empezar solo. Elige otro cuadro, o cancela.');
    await expect(principal(page).getByText(/^Conectando\./)).toBeVisible();
    // Esc sobre un cuadro cancela y el foco no se pierde
    await nodo(page, 'Slack').focus();
    await page.keyboard.press('Escape');
    await expect(principal(page).getByText(/^Conectando\./)).toHaveCount(0);
    expect(await focoEnElCuerpo(page)).toBe(false);
    // otra vez, y ahora «Cancelar» devuelve el foco al cuadro desde el que se empezó
    await mas(page, 'Gmail').click();
    await opcion(menu(page), 'Uno que ya está en el lienzo').click();
    await principal(page).getByRole('button', { name: 'Cancelar' }).click();
    await expect(principal(page).getByText(/^Conectando\./)).toHaveCount(0);
    await expect(nodo(page, 'Gmail')).toBeFocused();
    // y por fin: tocar Slack los conecta
    await mas(page, 'Gmail').click();
    await opcion(menu(page), 'Uno que ya está en el lienzo').click();
    await nodo(page, 'Slack').click();
    await expect(bandeja(page)).toContainText('Conectamos «Gmail» con «Slack».');
    await expect(flecha(page, 'Gmail', 'Slack')).toHaveAccessibleName(/un solo sentido/);
    await expect(principal(page).getByText(/^Conectando\./)).toHaveCount(0);
  });

  test('la flecha de una herramienta pasa a ser un paso del flujo (y regresa); una herramienta no puede llevar pasos después', async ({ page }) => {
    await simular(page);
    await abrir(page);
    await elegirDisparador(page, 'Chat');
    await agregarAgente(page, 'Disparador Chat');
    await darHerramienta(page, 'Agente 1', 'Google Sheets');
    const colgada = await posicion(page, 'Google Sheets');
    const agente = await posicion(page, 'Agente 1');
    expect(colgada.y).toBeGreaterThan(agente.y + 96); // la herramienta cuelga debajo de su agente
    // una herramienta no tiene «+» para seguir: no puede tener pasos después
    await expect(mas(page, 'Google Sheets')).toHaveCount(0);
    await flecha(page, 'Agente 1', 'Google Sheets').click();
    await ajustes(page).getByRole('button', { name: /^Un solo sentido/ }).click();
    await expect(bandeja(page)).toContainText('«Google Sheets» ahora va después de «Agente 1»: un solo sentido.');
    await expect(nodo(page, 'Google Sheets')).toHaveAccessibleName(/^App · paso del flujo: Google Sheets\./);
    const paso = await posicion(page, 'Google Sheets');
    expect(paso.x).toBeGreaterThanOrEqual(agente.x + 216 + 60); // un paso va a la derecha
    await expect(mas(page, 'Google Sheets')).toBeVisible();
    await expect(avisoDeshacer(page)).toBeVisible(); // reacomodar entra en la pila y su aviso ofrece «Deshacer»
    await ajustes(page).getByRole('button', { name: /^Ida y vuelta/ }).click();
    await expect(bandeja(page)).toContainText('«Google Sheets» ahora es herramienta de «Agente 1»: ida y vuelta.');
    await expect(nodo(page, 'Google Sheets')).toHaveAccessibleName(/^App · herramienta: Google Sheets\./);
    const vuelta = await posicion(page, 'Google Sheets');
    expect(vuelta.y).toBeGreaterThan(agente.y + 96);
    // y deshacer lo devuelve a un paso
    await avisoDeshacer(page).click();
    await expect(nodo(page, 'Google Sheets')).toHaveAccessibleName(/^App · paso del flujo: Google Sheets\./);
  });

  test('quitar el disparador deja la tarjeta para elegir otro, que se conecta solo con el primer cuadro suelto; y quitar una conexión', async ({ page }) => {
    await simular(page);
    await abrir(page);
    await flujoSencillo(page);
    await quitarX(page, 'Disparador Chat').click();
    await expect(nodos(page)).toHaveCount(2);
    await expect(bandeja(page)).toContainText('Elige otro disparador para que el flujo vuelva a arrancar.');
    const tarjeta = page.getByRole('group', { name: 'Disparador del flujo' });
    await expect(page.getByRole('heading', { name: 'Elige qué hace que tu flujo arranque' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cargar el ejemplo' })).toHaveCount(0); // el ejemplo solo es con el lienzo vacío
    await expect(botonDescargar(page)).toHaveAttribute('aria-disabled', 'true');
    await expect(page.locator('#faltan')).toContainText('Falta un disparador: dile al flujo cuándo arrancar.');
    expect(await focoEnElCuerpo(page)).toBe(false);
    await opcion(tarjeta, 'Tiempo').click();
    await expect(bandeja(page)).toContainText('Listo: el flujo arranca con «Disparador Tiempo» y lo conectamos con «Agente 1».');
    await expect(flecha(page, 'Disparador Tiempo', 'Agente 1')).toBeVisible();
    await expect(tarjeta).toHaveCount(0);
    // quitar una conexión desde su editor deja los dos cuadros y el foco en el de donde salía
    await flecha(page, 'Agente 1', 'Gmail').click();
    await ajustes(page).getByRole('button', { name: 'Quitar esta conexión' }).click();
    await expect(flecha(page, 'Agente 1', 'Gmail')).toHaveCount(0);
    await expect(nodos(page)).toHaveCount(3);
    await expect(bandeja(page)).toContainText('Quitamos la conexión.');
    await expect(nodo(page, 'Agente 1')).toBeFocused();
  });

  test('el disparador web: sin ruta no se puede descargar; con ella, el enlace y el nombre del webhook salen limpios', async ({ page }) => {
    await simular(page);
    await abrir(page);
    await elegirDisparador(page, 'Web');
    await agregarAgente(page, 'Disparador Web');
    await nodo(page, 'Web').click();
    const ruta = ajustes(page).getByLabel('Ruta del enlace (letras, números y guiones)');
    await ruta.fill('###');
    await expect(page.locator('#faltan')).toContainText('El disparador web necesita una ruta para su enlace.');
    await expect(botonDescargar(page)).toHaveAttribute('aria-disabled', 'true');
    await expect(botonDescargar(page)).toHaveAccessibleDescription(/El disparador web necesita una ruta para su enlace\./);
    await ruta.fill('Mi Flujo Ñandú');
    await expect(ajustes(page).getByText(/^Tu enlace quedará así: .*\/webhook\/mi-flujo-nandu$/)).toBeVisible();
    // un agente después de un disparador que no es chat pide su tarea
    await expect(page.locator('#faltan')).toContainText('Dile a «Agente 1» qué debe hacer cada vez que se dispare.');
    await nodo(page, 'Agente 1').click();
    await ajustes(page).getByLabel(/^¿Qué debe hacer/).fill('Resume lo que llegue y mándalo por correo.');
    await expect(page.locator('#faltan')).toHaveCount(0);
    const archivo = await descargar(page);
    const webhook = archivo.json.nodes.find((n: { type: string }) => n.type === 'n8n-nodes-base.webhook');
    expect(webhook.parameters.path).toBe('mi-flujo-nandu');
    expect(webhook.parameters.httpMethod).toBe('POST');
  });

  test('un disparador de tiempo guarda su frecuencia y la zona horaria del navegador', async ({ page }) => {
    await simular(page);
    await abrir(page);
    await elegirDisparador(page, 'Tiempo');
    await agregarAgente(page, 'Disparador Tiempo');
    await nodo(page, 'Tiempo').click();
    await ajustes(page).getByLabel('¿Cada cuánto?').selectOption({ label: 'Cada hora' });
    await nodo(page, 'Agente 1').click();
    await ajustes(page).getByLabel(/^¿Qué debe hacer/).fill('Prepara un resumen de lo importante.');
    const archivo = await descargar(page);
    const regla = archivo.json.nodes.find((n: { type: string }) => n.type === 'n8n-nodes-base.scheduleTrigger').parameters.rule.interval[0];
    expect(regla).toEqual({ field: 'hours', hoursInterval: 1 });
    expect(archivo.json.settings.timezone).toBe(await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone));
  });

  test('quitar un cuadro y «Deshacer»: por el aviso, por el botón de la barra y con Ctrl+Z; el foco nunca cae al body', async ({ page }) => {
    await simular(page);
    await abrir(page);
    await flujoSencillo(page); // Chat → Agente 1 → Gmail

    // 1) la × del cuadro de en medio: lo de antes se une con lo de después, y el aviso de la esquina ofrece «Deshacer»
    await quitarX(page, 'Agente 1').click();
    await expect(nodos(page)).toHaveCount(2);
    await expect(bandeja(page)).toContainText('Quitamos «Agente 1» y unimos lo de antes con lo de después.');
    await expect(flecha(page, 'Disparador Chat', 'Gmail')).toBeVisible(); // A → B → C pasó a A → C
    await expect(nodo(page, 'Chat')).toBeFocused(); // el foco pasa al cuadro de antes
    await avisoDeshacer(page).click();
    await expect(nodos(page)).toHaveCount(3);
    await expect(flecha(page, 'Disparador Chat', 'Agente 1')).toBeVisible();
    await expect(flecha(page, 'Agente 1', 'Gmail')).toBeVisible();
    await expect(flecha(page, 'Disparador Chat', 'Gmail')).toHaveCount(0);
    await expect(bandeja(page)).toContainText('Listo: volvimos a poner lo que quitaste.');
    await expect(nodo(page, 'Agente 1')).toBeFocused(); // y el botón de «Deshacer» del aviso ya no está: el foco no se queda en el aire
    expect(await focoEnElCuerpo(page)).toBe(false);

    // 2) el botón «Deshacer» de la barra
    await quitarX(page, 'Gmail').click();
    await expect(nodos(page)).toHaveCount(2);
    await expect(bandeja(page)).toContainText('Quitamos «Gmail» y sus conexiones.');
    await botonDeshacer(page).click();
    await expect(nodos(page)).toHaveCount(3);
    await expect(nodo(page, 'Gmail')).toBeFocused();
    await expect(flecha(page, 'Agente 1', 'Gmail')).toBeVisible();

    // 3) Supr sobre el cuadro y Ctrl+Z
    await nodo(page, 'Gmail').focus();
    await page.keyboard.press('Delete');
    await expect(nodos(page)).toHaveCount(2);
    expect(await focoEnElCuerpo(page)).toBe(false);
    await page.keyboard.press('Control+z');
    await expect(nodos(page)).toHaveCount(3);
    await expect(nodo(page, 'Gmail')).toBeFocused();
    await expect(flecha(page, 'Agente 1', 'Gmail')).toBeVisible();
  });

  test('«Deshacer» apagado se explica al pulsarlo, y un cambio de texto después de quitar no se pierde al deshacer', async ({ page }) => {
    await simular(page);
    await abrir(page);
    await expect(botonDeshacer(page)).toHaveAttribute('aria-disabled', 'true');
    await botonDeshacer(page).click({ force: true }); // apagado con `aria-disabled`: el clic llega y el reductor explica
    await expect(bandeja(page)).toContainText('Ya no hay nada que deshacer.');
    await elegirDisparador(page, 'Chat');
    await agregarAgente(page, 'Disparador Chat');
    await agregarApp(page, 'Agente 1', 'Gmail');
    await expect(avisoDeshacer(page)).toHaveCount(0); // agregar entra en la pila pero su aviso no ofrece «Deshacer»
    await quitarX(page, 'Gmail').click();
    await expect(avisoDeshacer(page)).toBeVisible();
    // lo que se escribió o se movió después de quitar se queda al deshacer: nunca se pisa
    await nodo(page, 'Agente 1').click();
    await ajustes(page).getByLabel('Nombre del agente').fill('Atención');
    await campoNombre(page).fill('Mi flujo nuevo');
    await botonDeshacer(page).click();
    await expect(nodo(page, 'Gmail')).toBeVisible();
    await expect(nodo(page, 'Atención')).toBeVisible();
    await expect(campoNombre(page)).toHaveValue('Mi flujo nuevo');
  });

  test('Ctrl+Z dentro de un campo de texto es del navegador (deshace lo escrito) y no toca el flujo', async ({ page }) => {
    await simular(page);
    await abrir(page);
    await flujoSencillo(page);
    await quitarX(page, 'Gmail').click();
    await expect(nodos(page)).toHaveCount(2);
    await campoNombre(page).click();
    await campoNombre(page).press('End');
    await campoNombre(page).pressSequentially(' 2');
    await expect(campoNombre(page)).toHaveValue('Mi automatización 2');
    await page.keyboard.press('Control+z');
    await expect(nodos(page)).toHaveCount(2); // el cuadro quitado NO volvió
    await expect(campoNombre(page)).not.toHaveValue('Mi automatización 2'); // lo que volvió fue el texto
    // fuera del campo, el mismo atajo sí deshace el flujo
    await nodo(page, 'Agente 1').focus();
    await page.keyboard.press('Control+z');
    await expect(nodos(page)).toHaveCount(3);
  });

  test('«Limpiar» pregunta antes: Esc y «Cancelar» no borran; confirmar vacía el lienzo, borra el borrador y se puede deshacer', async ({ page }) => {
    await simular(page);
    await abrir(page);
    await flujoSencillo(page);
    await esperarBorrador(page, b => b.nodes.length === 3);
    const pregunta = page.getByRole('alertdialog', { name: '¿Limpiar todo el flujo?' });

    await botonLimpiar(page).click();
    await expect(pregunta).toBeVisible();
    await expect(pregunta).toContainText('Si te arrepientes, puedes volver atrás con «Deshacer» o con Ctrl+Z.');
    await expect(pregunta.getByRole('button', { name: 'Cancelar' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(pregunta).toHaveCount(0);
    await expect(nodos(page)).toHaveCount(3);
    await expect(botonLimpiar(page)).toBeFocused();

    await botonLimpiar(page).click();
    await pregunta.getByRole('button', { name: 'Cancelar' }).click();
    await expect(nodos(page)).toHaveCount(3);
    await expect(botonLimpiar(page)).toBeFocused();

    await botonLimpiar(page).click();
    await pregunta.getByRole('button', { name: 'Limpiar todo' }).click();
    await expect(nodos(page)).toHaveCount(0);
    await expect(page.getByRole('heading', { name: '¿Qué hace que tu flujo arranque?' })).toBeVisible();
    await expect(campoNombre(page)).toHaveValue('Mi automatización'); // el nombre se queda
    await expect(opcion(page.getByRole('group', { name: 'Disparador del flujo' }), 'Tiempo')).toBeFocused(); // el foco pasa a la primera opción
    await expect(bandeja(page)).toContainText('Empezamos de cero. Elige cómo arranca tu flujo.');
    await expect(avisoDeshacer(page)).toBeVisible();
    await expect(botonDescargar(page)).toHaveAttribute('aria-disabled', 'true');
    await expect(botonLimpiar(page)).toHaveAttribute('aria-disabled', 'true');
    // un flujo sin cuadros no es un borrador: se borró
    await expect.poll(() => leerBorrador(page)).toBeNull();

    // «Limpiar» se deshace de verdad: vuelve todo
    await avisoDeshacer(page).click();
    await expect(nodos(page)).toHaveCount(3);
    await expect(flechas(page)).toHaveCount(2);
    await esperarBorrador(page, b => b.nodes.length === 3);
  });

  test('el ejemplo: se carga, no se queda con las manos vacías al deshacer y «Cargar el ejemplo» solo está con el lienzo vacío', async ({ page }) => {
    await simular(page);
    await abrir(page);
    await cargarEjemplo(page);
    await expect(bandeja(page)).toContainText('Cargamos el ejemplo.');
    await expect(flechas(page)).toHaveCount(4);
    await expect(flecha(page, 'Atención a clientes', 'Google Sheets')).toHaveAccessibleName(/ida y vuelta/);
    await expect(flecha(page, 'Revisor', 'Slack')).toHaveAccessibleName(/ida y vuelta/);
    await expect(flecha(page, 'Atención a clientes', 'Revisor')).toHaveAccessibleName(/un solo sentido/);
    await avisoDeshacer(page).click();
    await expect(nodos(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Cargar el ejemplo' })).toBeVisible();
    expect(await focoEnElCuerpo(page)).toBe(false);
    // el ejemplo descarga tal cual: dos agentes, cada uno con su modelo, y dos herramientas
    await page.getByRole('button', { name: 'Cargar el ejemplo' }).click();
    const archivo = await descargar(page);
    expect(archivo.nombre).toBe('atencion-a-clientes.json');
    expect(archivo.json.name).toBe('Atención a clientes');
    expect(archivo.json.nodes.filter((n: { type: string }) => n.type === TIPO_AGENTE)).toHaveLength(2);
    expect(archivo.json.nodes.filter((n: { type: string }) => n.type.endsWith('Tool'))).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// El archivo: descargar, ver el JSON y copiar (a 1100 px)

test.describe('Constructor: el archivo', () => {
  test.use({ viewport: { width: 1100, height: 900 } });

  test('«Descargar .json» apagado no baja nada: dice por qué y enlaza la lista de lo que falta', async ({ page }) => {
    await simular(page);
    await abrir(page);
    await elegirDisparador(page, 'Chat');
    await agregarAgente(page, 'Disparador Chat');
    await nodo(page, 'Chat').click();
    await ajustes(page).getByRole('group', { name: 'Tipo de disparador' }).getByRole('button', { name: /^Web/ }).click();
    await ajustes(page).getByLabel('Ruta del enlace (letras, números y guiones)').fill('');
    // la lista de lo que falta es validación junto al botón: estática (sin `role="status"`, que la anunciaría en cada tecla)
    const faltan = page.locator('#faltan');
    await expect(faltan).toContainText('Te falta esto para poder descargar:');
    await expect(faltan).toContainText('El disparador web necesita una ruta para su enlace.');
    await expect(faltan).not.toHaveAttribute('role', /.*/);
    await expect(faltan.locator('[role="status"], [aria-live]')).toHaveCount(0);
    await expect(botonDescargar(page)).toHaveAttribute('aria-disabled', 'true');
    await expect(botonDescargar(page)).toHaveAttribute('aria-describedby', 'faltan');
    let bajo = false;
    page.on('download', () => (bajo = true));
    await botonDescargar(page).click({ force: true });
    await expect(bandeja(page).getByRole('alert')).toContainText('Todavía no se puede descargar. El disparador web necesita una ruta para su enlace.');
    await page.waitForTimeout(300);
    expect(bajo).toBe(false);
    // con la ruta puesta, esa línea se va de la lista (queda lo que sigue faltando: la tarea del agente)
    await ajustes(page).getByLabel('Ruta del enlace (letras, números y guiones)').fill('mi-flujo');
    await expect(faltan).not.toContainText('El disparador web necesita una ruta');
    await expect(faltan).toContainText('Dile a «Agente 1» qué debe hacer cada vez que se dispare.');
    // en cuanto se puede descargar, el aviso rojo (que no se cierra solo) se retira
    await nodo(page, 'Agente 1').click();
    await ajustes(page).getByLabel(/^¿Qué debe hacer/).fill('Resume lo que llegue.');
    await expect(page.locator('#faltan')).toHaveCount(0);
    await expect(bandeja(page).getByRole('alert')).toHaveCount(0);
  });

  test('dos clics seguidos en «Descargar .json» bajan UN solo archivo', async ({ page }) => {
    await simular(page);
    await abrir(page);
    await flujoSencillo(page);
    const bajados: string[] = [];
    page.on('download', d => bajados.push(d.suggestedFilename()));
    await botonDescargar(page).dblclick();
    await expect.poll(() => bajados.length).toBe(1);
    await page.waitForTimeout(500);
    expect(bajados).toEqual(['mi-automatizacion.json']);
    // pasado el candado, se puede volver a bajar
    await page.waitForTimeout(700);
    await botonDescargar(page).click();
    await expect.poll(() => bajados.length).toBe(2);
  });

  test('el nombre del archivo sale del nombre del flujo, limpio', async ({ page }) => {
    await simular(page);
    await abrir(page);
    await flujoSencillo(page);
    await campoNombre(page).fill('Atención a clientes (v2) · ¡Ñandú!');
    const archivo = await descargar(page);
    expect(archivo.nombre).toBe('atencion-a-clientes-v2-nandu.json');
    expect(archivo.json.name).toBe('Atención a clientes (v2) · ¡Ñandú!');
    await page.waitForTimeout(1100); // el candado de un segundo: dos clics seguidos bajan un solo archivo
    await campoNombre(page).fill('');
    await expect(campoNombre(page)).toHaveValue('');
    const sinNombre = await descargar(page);
    expect(sinNombre.nombre).toBe('flujo.json');
    expect(sinNombre.json.name).toBe('Mi automatización'); // sin nombre, el de siempre
  });

  test('Ver el JSON: la caja trae exactamente lo que se descarga, es un JSON válido y se lee con el teclado', async ({ page }) => {
    await simular(page);
    await abrir(page);
    await expect(botonJson(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(cajaJson(page)).toHaveCount(0);
    // con el lienzo vacío se puede abrir, pero la caja dice por qué todavía no hay JSON, y «Copiar» está apagado
    await botonJson(page).click();
    await expect(botonJson(page)).toHaveText('Ocultar el JSON');
    await expect(botonJson(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(botonJson(page)).toHaveAttribute('aria-controls', 'json-caja');
    await expect(cajaJson(page)).toContainText('Todavía no hay JSON');
    await expect(page.getByRole('button', { name: 'Copiar el JSON' })).toHaveAttribute('aria-disabled', 'true');
    await flujoSencillo(page);
    await expect(cajaJson(page)).toContainText('"name": "Mi automatización"');
    const texto = (await cajaJson(page).locator('pre').textContent()) ?? '';
    const archivo = await descargar(page);
    expect(texto).toBe(archivo.texto); // lo que se ve es lo que se baja, letra por letra
    expect(JSON.parse(texto)).toEqual(archivo.json);
    expect(esFlujoDeN8n(JSON.parse(texto))).toBe(true);
    // la caja se desplaza por dentro, así que se enfoca con el teclado (Re Pág la mueve) y no ensancha la página
    const m = await cajaJson(page).evaluate(el => ({ alto: el.clientHeight, total: el.scrollHeight, overflowY: getComputedStyle(el).overflowY }));
    expect(m.overflowY).toBe('auto');
    expect(m.total).toBeGreaterThan(m.alto);
    await cajaJson(page).focus();
    await expect(cajaJson(page)).toBeFocused();
    await page.keyboard.press('PageDown');
    await expect.poll(() => cajaJson(page).evaluate(el => el.scrollTop)).toBeGreaterThan(0);
    expect((await medir(page)).scrollW).toBeLessThanOrEqual(1100);
    // el JSON se pone al día con cada cambio, y ocultarlo lo quita
    await campoNombre(page).fill('Otro nombre');
    await expect(cajaJson(page)).toContainText('"name": "Otro nombre"');
    await botonJson(page).click();
    await expect(cajaJson(page)).toHaveCount(0);
    await expect(botonJson(page)).toHaveAttribute('aria-expanded', 'false');
  });

  test('copiar: el JSON entero, con el portapapeles de verdad, y el botón dice «Copiado»', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await simular(page);
    await abrir(page);
    await flujoSencillo(page);
    await botonJson(page).click();
    const texto = (await cajaJson(page).locator('pre').textContent()) ?? '';
    await page.getByRole('button', { name: 'Copiar el JSON' }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(texto);
    expect(JSON.parse(await page.evaluate(() => navigator.clipboard.readText()))).toMatchObject({ name: 'Mi automatización' });
    await expect(page.getByRole('button', { name: 'Copiado: el JSON' })).toBeVisible();
    await expect(bandeja(page)).toContainText('Copiamos el JSON.');
    // si el flujo cambia, el botón vuelve a decir «Copiar el JSON» (lo copiado ya no es lo de ahora)
    await campoNombre(page).fill('Otro nombre');
    await expect(page.getByRole('button', { name: 'Copiar el JSON' })).toBeVisible();
  });

  test('si el navegador niega copiar, lo dice y deja el texto seleccionado para Ctrl+C', async ({ page }) => {
    await simular(page);
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new DOMException('negado', 'NotAllowedError')) }, configurable: true });
      document.execCommand = () => false;
    });
    await abrir(page);
    await flujoSencillo(page);
    await botonJson(page).click();
    await page.getByRole('button', { name: 'Copiar el JSON' }).click();
    await expect(bandeja(page).getByRole('alert')).toContainText('No pudimos copiar solos. Selecciona el texto y usa Ctrl+C.');
    expect(await page.evaluate(() => window.getSelection()?.toString().length ?? 0)).toBeGreaterThan(100);
  });

  test('si el navegador niega la descarga, deja el JSON abierto y el foco en «Copiar el JSON»', async ({ page }) => {
    await simular(page);
    await page.addInitScript(() => {
      URL.createObjectURL = () => {
        throw new Error('sin descargas aquí');
      };
    });
    await abrir(page);
    await flujoSencillo(page);
    await botonDescargar(page).click();
    await expect(bandeja(page).getByRole('alert')).toContainText('Tu navegador no nos dejó descargar el archivo. Dejamos el JSON abierto abajo');
    await expect(cajaJson(page)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Copiar el JSON' })).toBeFocused();
  });
});

// ---------------------------------------------------------------------------
// El borrador del navegador (D3): sobrevive a recargar, no guarda claves

test.describe('Constructor: el borrador', () => {
  test.use({ viewport: { width: 1100, height: 900 } });

  test('el flujo sobrevive a recargar: cuadros, conexiones y nombre; y avisa que lo recuperó', async ({ page }) => {
    await simular(page);
    await abrir(page);
    await flujoSencillo(page);
    await darHerramienta(page, 'Agente 1', 'Google Sheets');
    await campoNombre(page).fill('Mi flujo de prueba');
    await nodo(page, 'Agente 1').click();
    await ajustes(page).getByLabel('Nombre del agente').fill('Atención');
    await esperarBorrador(page, b => b.nodes.length === 4 && b.nombreFlujo === 'Mi flujo de prueba' && b.nodes.some(n => n.nombre === 'Atención'));
    // nada de la pantalla (selección, menús, avisos) va al borrador: solo el flujo
    const guardado = JSON.parse((await leerBorrador(page))!);
    expect(Object.keys(guardado).sort()).toEqual(['edges', 'nodes', 'nombreFlujo', 'v']);
    expect(guardado.v).toBe(1);
    await page.reload();
    await expect(page.getByRole('heading', { level: 2, name: 'Arma tu automatización' })).toBeVisible();
    await expect(nodos(page)).toHaveCount(4);
    await expect(campoNombre(page)).toHaveValue('Mi flujo de prueba');
    await expect(nodo(page, 'Atención')).toBeVisible();
    await expect(flecha(page, 'Atención', 'Gmail')).toHaveAccessibleName(/un solo sentido/);
    await expect(flecha(page, 'Atención', 'Google Sheets')).toHaveAccessibleName(/ida y vuelta/);
    await expect(bandeja(page)).toContainText('Recuperamos tu borrador.');
    await expect(page.getByRole('group', { name: 'Disparador del flujo' })).toHaveCount(0);
    await expect(page.getByText('Tu borrador se guarda solo en este navegador.')).toBeVisible();
    // y se puede seguir: agregar un cuadro nuevo no repite ids con los del borrador
    await agregarApp(page, 'Gmail', 'Slack');
    await expect(nodos(page)).toHaveCount(5);
    const ids = await nodos(page).evaluateAll(ns => ns.map(n => n.getAttribute('data-nodo')));
    expect(new Set(ids).size).toBe(ids.length);
    const archivo = await descargar(page);
    const nombres = archivo.json.nodes.map((n: { name: string }) => n.name);
    expect(new Set(nombres).size).toBe(nombres.length);
  });

  test('un cambio justo antes de recargar no se pierde: la pestaña guarda al irse (pagehide), sin esperar al guardado diferido', async ({ page }) => {
    await simular(page);
    await abrir(page);
    await flujoSencillo(page);
    await esperarBorrador(page, b => b.nodes.length === 3);
    await campoNombre(page).fill('Cambio de último momento');
    await page.reload(); // antes de que pasen los 500 ms del guardado diferido
    await expect(campoNombre(page)).toHaveValue('Cambio de último momento');
  });

  test('si la sesión caduca (auth.js avisa con auth:saliendo) lo que había se guarda al momento', async ({ page }) => {
    await simular(page);
    await abrir(page);
    await flujoSencillo(page);
    await campoNombre(page).fill('Antes de que caduque la sesión');
    await page.evaluate(() => window.dispatchEvent(new Event('auth:saliendo')));
    const guardado = JSON.parse((await leerBorrador(page))!);
    expect(guardado.nombreFlujo).toBe('Antes de que caduque la sesión');
    expect(guardado.nodes).toHaveLength(3);
  });

  test('un borrador roto o de una versión futura se ignora sin tocarlo: lienzo vacío y un aviso', async ({ page }) => {
    await simular(page);
    await page.addInitScript(([clave]) => localStorage.setItem(clave!, '{esto no es json'), [CLAVE_BORRADOR]);
    await abrir(page);
    await expect(nodos(page)).toHaveCount(0);
    await expect(bandeja(page)).toContainText('No pudimos recuperar tu borrador anterior, así que empezamos de cero.');
    await expect(page.getByRole('heading', { name: '¿Qué hace que tu flujo arranque?' })).toBeVisible();
    // sin cambios no se escribe nada encima (guardar un lienzo vacío borraría lo que no se pudo leer)
    await page.waitForTimeout(800);
    expect(await leerBorrador(page)).toBe('{esto no es json');
  });

  test('una clave pegada en el flujo no se guarda ni se descarga: lo dice, y al quitarla todo vuelve a la normalidad', async ({ page }) => {
    await simular(page);
    await abrir(page);
    await flujoSencillo(page);
    await esperarBorrador(page, b => b.nodes.length === 3);
    const llave = 'sk-abcdefghijklmnopqrstuvwxyz0123456789';
    await nodo(page, 'Agente 1').click();
    await ajustes(page).getByLabel('Instrucciones del agente').fill(`Usa esta llave: ${llave}`);
    // lo dice (rojo, en la esquina) y el borrador conserva lo ANTERIOR, sin la clave
    await expect(bandeja(page).getByRole('alert')).toContainText('No guardamos tu borrador porque parece que hay una clave pegada en el flujo.');
    await expect(page.locator('#faltan')).toContainText('Parece que pegaste una clave en «Agente 1». Quítala: las claves se ponen en n8n al conectar la cuenta, nunca dentro del archivo.');
    await expect(botonDescargar(page)).toHaveAttribute('aria-disabled', 'true');
    await page.waitForTimeout(900);
    const crudo = (await leerBorrador(page)) ?? '';
    expect(crudo).not.toContain(llave);
    expect(crudo).not.toContain('sk-abc');
    // la clave tampoco sale por «Ver el JSON»: sin JSON mientras esté ahí
    await botonJson(page).click();
    await expect(cajaJson(page)).toContainText('Todavía no hay JSON');
    await expect(cajaJson(page)).not.toContainText('sk-abc');
    // al quitarla, el aviso se retira solo y el borrador vuelve a guardarse
    await ajustes(page).getByLabel('Instrucciones del agente').fill('Responde con amabilidad.');
    await expect(bandeja(page).getByRole('alert')).toHaveCount(0);
    await esperarBorrador(page, b => b.nodes.length === 3);
    expect(await leerBorrador(page)).toContain('Responde con amabilidad.');
    await expect(cajaJson(page)).toContainText('"name": "Mi automatización"');
  });
});

// ---------------------------------------------------------------------------
// El teclado (a 1100 px)

/** Los nombres de los controles por los que pasa el foco al pulsar Tab `veces` veces. */
async function recorrerConTab(page: Page, veces: number): Promise<string[]> {
  const nombres: string[] = [];
  for (let i = 0; i < veces; i++) {
    await page.keyboard.press('Tab');
    nombres.push(await page.evaluate(() => (document.activeElement as HTMLElement | null)?.getAttribute('aria-label') ?? document.activeElement?.textContent?.trim().slice(0, 40) ?? '(nada)'));
  }
  return nombres;
}

test.describe('Constructor: el teclado', () => {
  test.use({ viewport: { width: 1100, height: 900 } });

  test('Tab recorre cada cuadro con su ×, su «+» y su patita, y luego las flechas: el orden de lectura; y cada parada lleva UN solo aro de foco', async ({ page }) => {
    await simular(page);
    await abrir(page);
    await elegirDisparador(page, 'Chat');
    await agregarAgente(page, 'Disparador Chat');
    await nodo(page, 'Chat').focus();
    const paradas = await recorrerConTab(page, 8);
    expect(paradas[0]).toBe('Quitar «Disparador Chat»');
    expect(paradas[1]).toMatch(/^Agregar lo que sigue después de «Disparador Chat»/);
    expect(paradas[2]).toMatch(/^Agente de IA: Agente 1\. /);
    expect(paradas[3]).toBe('Quitar «Agente 1»');
    expect(paradas[4]).toMatch(/^Agregar lo que sigue después de «Agente 1»/);
    expect(paradas[5]).toMatch(/^Darle una herramienta a «Agente 1»/);
    expect(paradas[6]).toMatch(/^Conexión de «Disparador Chat» a «Agente 1»: un solo sentido\. Editar$/);
    expect(paradas[7]).toBe('Atajos del teclado');
    // Shift+Tab regresa por el mismo camino
    await page.keyboard.press('Shift+Tab');
    expect(await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))).toMatch(/^Conexión de «Disparador Chat»/);
    // un solo aro por parada, de 2 px y en ámbar claro: en los botones de 44 px va en su dibujo, no en el botón
    await nodo(page, 'Chat').focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    for (let i = 0; i < 7; i++) {
      await page.keyboard.press('Tab');
      const aro = await aroDelFoco(page);
      expect(aro, `parada ${i + 1}`).not.toBeNull();
      expect(aro!.aros, `${aro!.nombre}: aros de foco`).toBe(1);
      const trazo = aro!.interior && aro!.interior.ancho >= 2 ? aro!.interior : aro!.propio;
      expect(trazo.color, `${aro!.nombre}: color del aro`).toBe('rgb(240, 169, 74)');
    }
  });

  test('Enter sobre un cuadro lleva el foco a Ajustes y Esc regresa al cuadro; con el ratón el foco se queda en el cuadro', async ({ page }) => {
    await simular(page);
    await abrir(page);
    await flujoSencillo(page);
    await nodo(page, 'Agente 1').click(); // con el ratón: abre Ajustes pero el foco se queda en el cuadro
    await expect(nodo(page, 'Agente 1')).toBeFocused();
    await expect(ajustes(page).getByLabel('Nombre del agente')).toHaveValue('Agente 1');
    await nodo(page, 'Gmail').focus();
    await page.keyboard.press('Enter');
    await expect(ajustes(page)).toBeFocused();
    await expect(ajustes(page).getByRole('heading', { name: 'App' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(nodo(page, 'Gmail')).toBeFocused();
    // lo mismo con una flecha: Enter lleva a Ajustes de la conexión y Esc regresa a su círculo
    await flecha(page, 'Agente 1', 'Gmail').focus();
    await page.keyboard.press('Enter');
    await expect(ajustes(page).getByRole('button', { name: /^Un solo sentido/ })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(flecha(page, 'Agente 1', 'Gmail')).toBeFocused();
  });

  test('Esc dentro de un selector nativo no saca del panel de Ajustes', async ({ page }) => {
    await simular(page);
    await abrir(page);
    await elegirDisparador(page, 'Tiempo');
    await nodo(page, 'Tiempo').click();
    const frecuencia = ajustes(page).getByLabel('¿Cada cuánto?');
    await frecuencia.focus();
    await page.keyboard.press('Escape');
    await expect(frecuencia).toBeFocused();
    // en un campo de texto, en cambio, Esc sí regresa al cuadro
    await ajustes(page).getByRole('group', { name: 'Tipo de disparador' }).getByRole('button', { name: /^Web/ }).click();
    await ajustes(page).getByLabel('Ruta del enlace (letras, números y guiones)').focus();
    await page.keyboard.press('Escape');
    await expect(nodo(page, 'Web')).toBeFocused();
  });

  test('las flechas mueven el cuadro 8 px (24 con Mayús) sin desplazar la página; Supr lo quita y el foco pasa al anterior', async ({ page }) => {
    await simular(page);
    await abrir(page);
    await flujoSencillo(page);
    const inicio = await posicion(page, 'Agente 1');
    await nodo(page, 'Agente 1').focus();
    const desplazada = () => page.evaluate(() => `${window.scrollX},${window.scrollY}`);
    const antes = await desplazada();
    await page.keyboard.press('ArrowRight');
    expect(await posicion(page, 'Agente 1')).toEqual({ x: inicio.x + 8, y: inicio.y });
    await page.keyboard.press('ArrowDown');
    expect(await posicion(page, 'Agente 1')).toEqual({ x: inicio.x + 8, y: inicio.y + 8 });
    await page.keyboard.press('Shift+ArrowLeft');
    expect(await posicion(page, 'Agente 1')).toEqual({ x: inicio.x - 16, y: inicio.y + 8 });
    await page.keyboard.press('Shift+ArrowUp');
    expect(await posicion(page, 'Agente 1')).toEqual({ x: inicio.x - 16, y: inicio.y - 16 });
    expect(await desplazada()).toBe(antes); // la flecha no desplaza la página ni el marco
    await expect(nodo(page, 'Agente 1')).toBeFocused();
    await expect(nodo(page, 'Agente 1')).toHaveAttribute('aria-pressed', 'true');
    // Supr: se quita (con su «Deshacer») y el foco no se pierde
    await page.keyboard.press('Delete');
    await expect(nodo(page, 'Agente 1')).toHaveCount(0);
    await expect(avisoDeshacer(page)).toBeVisible();
    expect(await focoEnElCuerpo(page)).toBe(false);
    // Retroceso también, y mantener la tecla apretada no se come los demás cuadros
    await nodo(page, 'Gmail').focus();
    await page.keyboard.down('Backspace');
    await page.keyboard.down('Backspace');
    await page.keyboard.down('Backspace');
    await page.keyboard.up('Backspace');
    await expect(nodos(page)).toHaveCount(1);
    expect(await focoEnElCuerpo(page)).toBe(false);
  });

  test('el menú del «+»: Enter lo abre en su primera opción, Esc lo cierra y devuelve el foco al «+», Tab sale sin atraparte', async ({ page }) => {
    await simular(page);
    await abrir(page);
    await elegirDisparador(page, 'Chat');
    await mas(page, 'Disparador Chat').focus();
    await page.keyboard.press('Enter');
    await expect(menu(page)).toBeVisible();
    await expect(opcion(menu(page), 'Una aplicación')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu(page)).toHaveCount(0);
    await expect(mas(page, 'Disparador Chat')).toBeFocused();
    await expect(mas(page, 'Disparador Chat')).toHaveAttribute('aria-expanded', 'false');
    // el paso de las apps: Esc también regresa al «+», no al cuadro
    await page.keyboard.press('Enter');
    await opcion(menu(page), 'Una aplicación').press('Enter');
    await expect(menu(page).getByRole('button', { name: 'Gmail', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(mas(page, 'Disparador Chat')).toBeFocused();
    // Tab no atrapa: pasando el último control del menú el foco sigue su camino, y nunca cae al body
    await page.keyboard.press('Enter');
    await expect(opcion(menu(page), 'Una aplicación')).toBeFocused();
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('Tab');
      expect(await focoEnElCuerpo(page)).toBe(false);
    }
    expect(await menu(page).locator(':focus').count()).toBe(0);
    // y con el foco perdido en el body (se hizo clic en un texto, que no se enfoca), Esc cierra el menú igual
    await page.evaluate(() => (document.activeElement as HTMLElement).blur());
    await page.keyboard.press('Escape');
    await expect(menu(page)).toHaveCount(0);
  });

  test('clic en el fondo del lienzo cierra el menú; Esc sobre un cuadro cierra lo abierto y el foco no se pierde', async ({ page }) => {
    await simular(page);
    await abrir(page);
    await flujoSencillo(page);
    await mas(page, 'Gmail').click();
    await expect(menu(page)).toBeVisible();
    await lienzo(page).click({ position: { x: 200, y: 520 } }); // un hueco del lienzo
    await expect(menu(page)).toHaveCount(0);
    expect(await focoEnElCuerpo(page)).toBe(false);
    await mas(page, 'Gmail').click();
    await nodo(page, 'Agente 1').focus();
    await page.keyboard.press('Escape');
    await expect(menu(page)).toHaveCount(0);
    await expect(nodo(page, 'Agente 1')).toBeFocused();
  });

  test('los atajos están dichos para quien usa lector de pantalla: ayuda ligada al lienzo y teclas en cada cuadro', async ({ page }) => {
    await simular(page);
    await abrir(page);
    await cargarEjemplo(page);
    await expect(lienzo(page)).toHaveAccessibleDescription(/Tab recorre los cuadros.*Supr quita el cuadro.*Ctrl\+Z \(o Cmd\+Z\) deshace/);
    await expect(nodo(page, 'Revisor')).toHaveAttribute('aria-keyshortcuts', /Delete/);
    // y a la vista, plegada en una línea
    await page.getByText('Atajos del teclado').click();
    await expect(page.getByText(/^Tab recorre los cuadros, sus «×»/)).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Arrastrar (ratón y dedo) y objetivos táctiles que no se tapan

test.describe('Constructor: arrastrar con el ratón', () => {
  test.use({ viewport: { width: 1100, height: 900 } });

  test('el cuadro sigue al puntero, se acomoda a la rejilla de 8 px, no abre Ajustes al soltar, y la página no se desplaza', async ({ page }) => {
    await simular(page);
    await abrir(page);
    await flujoSencillo(page); // el elegido al terminar es Gmail
    const inicio = await posicion(page, 'Agente 1');
    const caja = (await nodo(page, 'Agente 1').boundingBox())!;
    const desplazada = () => page.evaluate(() => `${window.scrollX},${window.scrollY}`);
    const antes = await desplazada();
    // el cuadro no tiene ninguna transición: sigue al puntero sin retraso
    expect(await nodo(page, 'Agente 1').evaluate(el => getComputedStyle(el.parentElement!).transitionDuration)).toBe('0s');
    await page.mouse.move(caja.x + 60, caja.y + 50);
    await page.mouse.down();
    await page.mouse.move(caja.x + 100, caja.y + 70, { steps: 4 });
    const aMedias = await posicion(page, 'Agente 1');
    expect(aMedias.x).toBeGreaterThan(inicio.x); // mientras se arrastra ya va con el puntero
    await page.mouse.move(caja.x + 163, caja.y + 93, { steps: 6 });
    await page.mouse.up();
    const fin = await posicion(page, 'Agente 1');
    expect(fin.x % 8).toBe(0);
    expect(fin.y % 8).toBe(0);
    expect(Math.abs(fin.x - (inicio.x + 103))).toBeLessThanOrEqual(8);
    expect(Math.abs(fin.y - (inicio.y + 43))).toBeLessThanOrEqual(8);
    // soltar después de arrastrar no cuenta como un clic: el cuadro no se eligió y Ajustes sigue con Gmail
    await expect(nodo(page, 'Agente 1')).toHaveAttribute('aria-pressed', 'false');
    await expect(nodo(page, 'Gmail')).toHaveAttribute('aria-pressed', 'true');
    expect(await desplazada()).toBe(antes);
    // las flechas siguen al cuadro (el círculo de la conexión se movió con él)
    const insignia = (await flecha(page, 'Disparador Chat', 'Agente 1').boundingBox())!;
    expect(insignia.x).toBeLessThan(fin.x);
    // un clic corto, sin mover, sí lo elige
    const nueva = (await nodo(page, 'Agente 1').boundingBox())!;
    await page.mouse.click(nueva.x + 60, nueva.y + 50);
    await expect(nodo(page, 'Agente 1')).toHaveAttribute('aria-pressed', 'true');
    await expect(ajustes(page).getByLabel('Nombre del agente')).toBeVisible();
    // mover no entra en la pila de «Deshacer» (solo lo estructural): lo de antes (agregar los cuadros) sigue ahí intacto
    await expect(botonDeshacer(page)).not.toHaveAttribute('aria-disabled', 'true');
  });

  test('un clic derecho no empieza un arrastre, y soltar fuera de la ventana lo termina', async ({ page }) => {
    await simular(page);
    await abrir(page);
    await flujoSencillo(page);
    const inicio = await posicion(page, 'Agente 1');
    const caja = (await nodo(page, 'Agente 1').boundingBox())!;
    await page.mouse.move(caja.x + 60, caja.y + 50);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(caja.x + 160, caja.y + 120, { steps: 5 });
    await page.mouse.up({ button: 'right' });
    expect(await posicion(page, 'Agente 1')).toEqual(inicio);
    // sale de la ventana con el botón apretado y se suelta allá: al volver el cuadro no «sigue pegado» al puntero
    await page.mouse.move(caja.x + 60, caja.y + 50);
    await page.mouse.down();
    await page.mouse.move(caja.x + 90, caja.y + 80, { steps: 3 });
    await page.mouse.move(caja.x + 400, caja.y + 500, { steps: 3 });
    await page.mouse.up();
    const enMedio = await posicion(page, 'Agente 1');
    await page.mouse.move(caja.x + 200, caja.y + 50, { steps: 3 });
    expect(await posicion(page, 'Agente 1')).toEqual(enMedio);
  });

  test('lo que se construye con el «+» no tapa ningún par de áreas táctiles; los dibujos que se ven, nunca', async ({ page }) => {
    await simular(page);
    await abrir(page);
    await elegirDisparador(page, 'Chat');
    await agregarAgente(page, 'Disparador Chat');
    await agregarApp(page, 'Agente 1', 'Gmail');
    await darHerramienta(page, 'Agente 1', 'Google Sheets');
    await agregarAgente(page, 'Gmail');
    expect(await solapes(page)).toEqual([]);
    expect(await solapes(page, true)).toEqual([]);
  });

  test('el ejemplo (con las coordenadas del mockup, a 88 px entre cuadros): los dibujos no se tocan y las áreas de 44 px se rozan por 8 px como máximo', async ({ page }) => {
    await simular(page);
    await abrir(page);
    await cargarEjemplo(page);
    expect(await solapes(page, true)).toEqual([]);
    const tapados = await solapes(page);
    for (const t of tapados) {
      const m = /: (\d+)×(\d+)$/.exec(t)!;
      expect(Number(m[1]), t).toBeLessThanOrEqual(8);
    }
  });
});

test.describe('Constructor: arrastrar con el dedo', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('un toque abre Ajustes, y arrastrar un cuadro con el dedo lo mueve sin desplazar la página ni el lienzo', async ({ page }) => {
    await simular(page);
    await abrir(page);
    await cargarEjemplo(page);
    await lienzo(page).scrollIntoViewIfNeeded();
    // el cuadro del medio del ejemplo, a la vista dentro del marco
    await lienzo(page).evaluate(el => (el.scrollLeft = 150));
    const revisor = nodo(page, 'Atención a clientes');
    const antes = await posicion(page, 'Atención a clientes');
    const caja = (await revisor.boundingBox())!;
    const marcoAntes = await lienzo(page).evaluate(el => ({ x: el.scrollLeft, y: el.scrollTop }));
    const paginaAntes = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
    // arrastre con el dedo: toques de verdad (CDP), porque `touchscreen` solo sabe tocar
    const cdp = await page.context().newCDPSession(page);
    const punto = (x: number, y: number) => [{ x, y, id: 1 }];
    const x0 = caja.x + 80;
    const y0 = caja.y + 50;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: punto(x0, y0) });
    for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: punto(x0 + i * 8, y0 + i * 6) });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(async () => (await posicion(page, 'Atención a clientes')).x).toBeGreaterThan(antes.x + 30);
    const despues = await posicion(page, 'Atención a clientes');
    expect(despues.x % 8).toBe(0);
    expect(despues.y % 8).toBe(0);
    expect(despues.y).toBeGreaterThan(antes.y);
    expect(await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }))).toEqual(paginaAntes);
    expect(await lienzo(page).evaluate(el => ({ x: el.scrollLeft, y: el.scrollTop }))).toEqual(marcoAntes);
    // un toque sobre otro cuadro lo elige y trae sus Ajustes
    await nodo(page, 'Revisor').scrollIntoViewIfNeeded();
    await nodo(page, 'Revisor').tap();
    await expect(nodo(page, 'Revisor')).toHaveAttribute('aria-pressed', 'true');
    await expect(ajustes(page).getByLabel('Nombre del agente')).toHaveValue('Revisor');
  });
});

// ---------------------------------------------------------------------------
// «Reducir movimiento»

test.describe('Constructor con «reducir movimiento»', () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' }, viewport: { width: 1100, height: 900 } });

  test('armar, abrir el menú, quitar con aviso, ver el JSON y cargar el ejemplo: ninguna animación corre y nada se desplaza con animación', async ({ page }) => {
    await simular(page);
    await abrir(page);
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior)).toBe('auto');
    expect(await page.evaluate(animacionesVivas)).toEqual([]);
    await elegirDisparador(page, 'Chat');
    await agregarAgente(page, 'Disparador Chat');
    expect(await page.evaluate(animacionesVivas)).toEqual([]);
    await mas(page, 'Agente 1').click();
    await expect(menu(page)).toBeVisible();
    expect(await page.evaluate(animacionesVivas)).toEqual([]);
    await opcion(menu(page), 'Una aplicación').click();
    await menu(page).getByRole('button', { name: 'Gmail', exact: true }).click();
    await botonJson(page).click();
    await quitarX(page, 'Gmail').click();
    await expect(avisoDeshacer(page)).toBeVisible();
    expect(await page.evaluate(animacionesVivas)).toEqual([]);
    await botonLimpiar(page).click();
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await page.getByRole('button', { name: 'Cancelar' }).click();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    expect(await page.evaluate(animacionesVivas)).toEqual([]);
    // cargar un flujo no hace «entrar» los cuadros
    await page.reload();
    await expect(nodos(page)).toHaveCount(2);
    expect(await page.evaluate(animacionesVivas)).toEqual([]);
  });
});

