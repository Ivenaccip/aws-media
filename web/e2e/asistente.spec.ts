// El Asistente de Automatizaciones (/estudio/asistente/) en un navegador de verdad, a 1100, 390 y 320 px, con la API simulada (`page.route`):
// el servidor lo construye otro rol y aquí NO se llama a nada (ni al modelo, ni a la base, ni al monedero). Mide lo que jsdom no ve (desborde,
// letra, objetivos de 44 px, axe, el foco que nunca cae al body) y recorre los viajes de punta a punta: el letrero de «prueba», los límites
// del pedido que dice el servidor, los pasos que informa el servidor (con el reloj adelantado: el sondeo pregunta cada 5 s), el resultado, la
// descarga REAL del .json, «sin cobertura», cada error, y el traspaso al Constructor por el borrador (con la pregunta si ya había uno).
//
// Capturas: con AUTOMATIZA_CAPTURAS=<carpeta> cada estado que se `revisa` se guarda como PNG. Sin la variable no se guarda nada.
import { readFileSync } from 'node:fs';

import { expect, test, type Page } from '@playwright/test';

import {
  abrir,
  armandoEn,
  armar,
  bandeja,
  botonAbrirEnConstructor,
  botonDescargar,
  contador,
  copiarJson,
  CONFIG,
  cuadro,
  ejemplos,
  estadoDePasos,
  falla,
  ID,
  INICIO,
  listo,
  MUESTRA_CORREOS,
  MUESTRA_PREGUNTAS,
  ok,
  pasos,
  pedir,
  principal,
  regionViva,
  simular,
  sinCobertura,
  sinRed,
  TEXTO_DE_LA_PERSONA,
  tituloListo,
} from './asistente';
import { ANCHOS, CLAVE_BORRADOR, focoEnElCuerpo, leerBorrador, medir, nodos, nodo, revisar } from './constructor';
import { animacionesVivas } from './pantallas';

/** El pedido más corto que acepta el servidor de las pruebas (20 caracteres). */
const MINIMO = 'a'.repeat(20);

/** Lo que se ve de los avisos de la esquina, para decir que el Asistente no puso ninguno propio. */
const avisosDeLaEsquina = (page: Page) => bandeja(page).locator('.bj-aviso');

// ---------------------------------------------------------------------------
// Medidas y axe: a 1100, 390 y 320 px, un `revisar` por estado

for (const { ancho, alto } of ANCHOS) {
  test.describe(`Asistente a ${ancho} px`, () => {
    test.use({ viewport: { width: ancho, height: alto } });

    test('reposo: el letrero de prueba, el cuadro con el contador del servidor, tres ejemplos y un solo botón ámbar', async ({ page }) => {
      const sim = await simular(page);
      await abrir(page);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Irremplazables');
      await expect(page.getByRole('navigation', { name: 'Dónde estás' }).locator('li')).toContainText(['Automatizaciones', 'Distrito', 'Asistente']);
      // el letrero de prueba: se dice que NO es el flujo a la medida, mientras el servidor diga que está en modo «prueba»
      await expect(principal(page)).toContainText('Prueba: por ahora armamos flujos de ejemplo. Elegimos el que más se parece a tu pedido. No guardamos lo que escribes.');
      await expect(cuadro(page)).toBeVisible();
      await expect(cuadro(page)).toHaveAttribute('aria-keyshortcuts', 'Control+Enter Meta+Enter');
      await expect(contador(page)).toHaveText('0 de 1500 caracteres');
      await expect(ejemplos(page)).toHaveCount(3);
      await expect(armar(page)).toHaveText('Armar flujo');
      await expect(armar(page)).not.toHaveAttribute('aria-disabled', 'true');
      // un solo botón ámbar por pantalla, y sin precios ni créditos en el botón
      await expect(armar(page)).toHaveCSS('background-color', 'rgb(218, 140, 40)');
      const ambar = await page.locator('button').evaluateAll(bs => bs.filter(b => getComputedStyle(b).backgroundColor === 'rgb(218, 140, 40)').map(b => b.textContent?.trim()));
      expect(ambar).toEqual(['Armar flujo']);
      await expect(principal(page)).not.toContainText(/✦|créditos|\$|dólares/);
      expect(sim.pedidos).toEqual([]); // abrir la pantalla no pide ningún armado
      await cuadro(page).focus();
      await revisar(page, 'asistente-reposo');
      expect(sim.ajenos).toEqual([]);
    });

    test('con un pedido escrito los ejemplos se van y el contador cuenta lo escrito', async ({ page }) => {
      await simular(page);
      await abrir(page);
      await cuadro(page).fill(TEXTO_DE_LA_PERSONA);
      await expect(ejemplos(page)).toHaveCount(0);
      await expect(contador(page)).toHaveText(`${TEXTO_DE_LA_PERSONA.length} de 1500 caracteres`);
      await revisar(page, 'asistente-escrito');
    });

    test('un ejemplo llena el cuadro y el foco se queda en él', async ({ page }) => {
      await simular(page);
      await abrir(page);
      const primero = ejemplos(page).first();
      const frase = (await primero.textContent())!;
      await primero.click();
      await expect(cuadro(page)).toHaveValue(frase);
      await expect(cuadro(page)).toBeFocused();
      await expect(ejemplos(page)).toHaveCount(0);
      await revisar(page, 'asistente-ejemplo');
    });

    test('armando: «Armando…», los cuatro pasos que informa el servidor, «Llevas…» y la pestaña lo dice; no se puede editar el pedido', async ({ page }) => {
      await page.clock.install();
      const sim = await simular(page, { consultar: [ok(armandoEn('entender'))] });
      await abrir(page);
      await pedir(page);
      await expect(armar(page)).toHaveText('Armando…');
      await expect(armar(page)).toHaveAttribute('aria-busy', 'true');
      await expect(cuadro(page)).toHaveAttribute('readonly', '');
      await expect(pasos(page).getByRole('listitem')).toHaveCount(4);
      expect(await estadoDePasos(page)).toEqual({ activo: 'Entendiendo lo que pides', hechos: [] });
      await expect(principal(page)).toContainText('Llevas 0:0');
      expect(await page.title()).toBe('Armando tu flujo · Estudio de video · Asistente');
      await expect(regionViva(page)).toHaveText('Armando tu flujo. Entendiendo lo que pides…');
      await expect(page.getByRole('progressbar', { name: 'Avance' })).toBeVisible();
      await armar(page).focus();
      await revisar(page, 'asistente-armando');
      // lo que se mandó es el pedido, recortado, una sola vez
      expect(sim.pedidos).toEqual([{ texto: TEXTO_DE_LA_PERSONA }]);
    });

    test('resultado: el nombre, los cuadros, lo que falta conectar, un solo botón ámbar («Descargar .json») y «Abrir en el constructor»', async ({ page }) => {
      await simular(page, { consultar: [ok(listo())] });
      await page.clock.install();
      await abrir(page);
      await pedir(page);
      await page.clock.fastForward(5000);
      await expect(tituloListo(page)).toBeFocused(); // el foco pasa al resultado
      await expect(principal(page)).toContainText('Responder correos de clientes');
      await expect(principal(page).getByRole('list', { name: 'Cuadros del flujo' }).getByRole('listitem')).toHaveCount(5);
      await expect(principal(page)).toContainText(MUESTRA_CORREOS.resumen!);
      await expect(principal(page).getByRole('heading', { name: 'Antes de usarlo en n8n' })).toBeVisible();
      await expect(principal(page)).toContainText('Conecta tu cuenta de Gmail en n8n y elige el destinatario.');
      await expect(principal(page)).toContainText('Ejemplo de prueba: lo elegimos por las palabras de tu pedido, no lo armamos a tu medida.');
      await expect(principal(page)).toContainText('Para usarlo: en n8n, abre el menú «⋯» de arriba a la derecha y elige «Import from File».');
      // «Armar flujo» pasa a «Armar otro flujo» y a secundario; el ámbar es solo de «Descargar .json»
      await expect(armar(page)).toHaveText('Armar otro flujo');
      await expect(botonDescargar(page)).toHaveCSS('background-color', 'rgb(218, 140, 40)');
      const ambar = await page.locator('button').evaluateAll(bs => bs.filter(b => getComputedStyle(b).backgroundColor === 'rgb(218, 140, 40)').map(b => b.textContent?.trim()));
      expect(ambar).toEqual(['Descargar .json']);
      await expect(botonAbrirEnConstructor(page)).toBeVisible();
      expect(await page.title()).toBe('Tu flujo está listo · Estudio de video · Asistente');
      await revisar(page, 'asistente-resultado');
    });

    test('sin cobertura: no es un error, es una respuesta; dice lo que falta y adónde seguir', async ({ page }) => {
      await simular(page, { consultar: [ok(sinCobertura())] });
      await page.clock.install();
      await abrir(page);
      await pedir(page, 'Cuando alguien me escriba en Instagram, que lo anote en HubSpot');
      await page.clock.fastForward(5000);
      const titulo = page.getByRole('heading', { level: 2, name: 'Todavía no podemos armar esto' });
      await expect(titulo).toBeFocused();
      await expect(principal(page)).toContainText('Todavía no sabemos armar esto con n8n.');
      await expect(principal(page).getByRole('heading', { name: 'Lo que nos falta' })).toBeVisible();
      await expect(principal(page)).toContainText('apps como HubSpot, GitHub, Instagram, lectores de RSS y Google Calendar todavía no se pueden conectar');
      await expect(principal(page).getByRole('heading', { name: 'Qué sigue' })).toBeVisible();
      await expect(principal(page).getByRole('link', { name: 'Abrir el constructor' })).toHaveAttribute('href', '/estudio/automatizaciones/distrito/constructor/');
      await expect(page.getByRole('alert')).toHaveCount(0); // no es un error
      await expect(principal(page).getByRole('button', { name: 'Descargar .json' })).toHaveCount(0);
      await expect(cuadro(page)).toHaveValue('Cuando alguien me escriba en Instagram, que lo anote en HubSpot'); // lo escrito se queda
      await revisar(page, 'asistente-sin-cobertura');
    });

    test('un error del servicio se dice con sus tres partes y el pedido se queda en el cuadro', async ({ page }) => {
      await simular(page, { armar: [falla(503, 'no_disponible', 'El Asistente no está disponible por ahora. Inténtalo en unos minutos.')] });
      await abrir(page);
      await pedir(page);
      const alerta = page.getByRole('alert');
      await expect(alerta).toContainText('El Asistente no está disponible por ahora. Inténtalo en unos minutos.');
      await expect(alerta).toContainText('Tu texto sigue en el cuadro. Pulsa «Armar flujo» para intentarlo otra vez.');
      await expect(cuadro(page)).toHaveValue(TEXTO_DE_LA_PERSONA);
      await expect(armar(page)).toBeFocused(); // un fallo del servicio deja el foco donde estaba
      await revisar(page, 'asistente-error');
    });

    test('moderación y pedido inválido se dicen junto al cuadro, con el foco en él', async ({ page }) => {
      await simular(page, { armar: [falla(422, 'moderacion', 'Esta petición no la podemos armar. Prueba describiéndola de otra forma.')] });
      await abrir(page);
      await pedir(page, 'Un flujo para presionar a un cliente que no ha pagado');
      const aviso = page.locator('#asis-mod');
      await expect(aviso).toContainText('Esta petición no la podemos armar. Prueba describiéndola de otra forma.');
      await expect(cuadro(page)).toBeFocused();
      await expect(cuadro(page)).toHaveAttribute('aria-invalid', 'true');
      await expect(cuadro(page)).toHaveAttribute('aria-describedby', /asis-mod/);
      await revisar(page, 'asistente-moderacion');
      // al escribir otra cosa, el aviso del pedido anterior se va
      await cuadro(page).press('End');
      await cuadro(page).pressSequentially(' de otra manera');
      await expect(aviso).toHaveCount(0);
      await expect(cuadro(page)).not.toHaveAttribute('aria-invalid', 'true');
    });

    test('el servidor apagado (activo: false) no ofrece escribir y manda al constructor', async ({ page }) => {
      await simular(page, { config: ok({ ...CONFIG, activo: false, texto: 'El Asistente no está disponible por ahora. Inténtalo en unos minutos.' }) });
      await abrir(page);
      await expect(page.getByRole('heading', { name: 'No está disponible por ahora' })).toBeVisible();
      await expect(principal(page)).toContainText('El Asistente no está disponible por ahora. Inténtalo en unos minutos.');
      await expect(principal(page)).toContainText('Mientras tanto, puedes armar tu flujo a mano en el constructor.');
      await expect(principal(page).getByRole('link', { name: 'Abrir el constructor' })).toHaveAttribute('href', '/estudio/automatizaciones/distrito/constructor/');
      await expect(cuadro(page)).toHaveCount(0);
      await expect(armar(page)).toHaveCount(0);
      await revisar(page, 'asistente-apagado', { foco: false });
    });

    test('un resultado largo con palabras sin espacios no ensancha la página ni se sale de su caja', async ({ page }) => {
      const larga = 'W'.repeat(90);
      const enlace = 'https://ejemplo.com/' + 'abcdefghij'.repeat(6);
      await page.clock.install();
      await simular(page, {
        consultar: [
          ok(
            listo(MUESTRA_CORREOS, {
              nombre: larga,
              resumen: `Cuando llegue ${larga} se manda a ${enlace}.`,
              pendientes: [`Conecta ${larga} en n8n.`, enlace],
              advertencias: [`«${larga}» no está conectado a nada.`],
              nodos: [{ tipo: 'x', nombre: larga, etiqueta: larga }],
            }),
          ),
        ],
      });
      await abrir(page);
      await pedir(page);
      await page.clock.fastForward(5000);
      await expect(tituloListo(page)).toBeFocused();
      await revisar(page, 'asistente-palabras-largas');
    });
  });
}

// ---------------------------------------------------------------------------
// Los límites del pedido (a 1100 px): los dice el servidor, no la pantalla

test.describe('Asistente: los límites del pedido', () => {
  test.use({ viewport: { width: 1100, height: 900 } });

  test('vacío: se dice junto al cuadro, el foco va al cuadro y no se manda nada', async ({ page }) => {
    const sim = await simular(page);
    await abrir(page);
    await armar(page).click();
    const error = page.locator('#asis-err');
    await expect(error).toContainText('Escribe primero qué quieres automatizar, aunque sea en una frase.');
    await expect(error).toHaveAttribute('role', 'alert');
    await expect(cuadro(page)).toBeFocused();
    await expect(cuadro(page)).toHaveAttribute('aria-invalid', 'true');
    await expect(cuadro(page)).toHaveAttribute('aria-describedby', /asis-err/);
    expect(sim.pedidos).toEqual([]);
    await revisar(page, 'asistente-vacio');
    // escribir quita el aviso
    await cuadro(page).pressSequentially('Un correo');
    await expect(error).toHaveCount(0);
    // solo espacios cuenta como vacío
    await cuadro(page).fill('     ');
    await armar(page).click();
    await expect(error).toContainText('Escribe primero qué quieres automatizar');
    expect(sim.pedidos).toEqual([]);
  });

  test('corto: dice cuántos caracteres faltan, con el mínimo del servidor, y no manda nada', async ({ page }) => {
    const sim = await simular(page);
    await abrir(page);
    await cuadro(page).fill('Mandar un correo');
    await expect(contador(page)).toHaveText('16 de 1500 caracteres · mínimo 20');
    await armar(page).click();
    await expect(page.locator('#asis-err')).toContainText('Cuéntanos un poco más: escribe al menos 20 caracteres. Llevas 16.');
    await expect(cuadro(page)).toBeFocused();
    expect(sim.pedidos).toEqual([]);
    // con 20 justos sí se manda
    await cuadro(page).fill(MINIMO);
    await armar(page).click();
    await expect(armar(page)).toHaveText('Armando…');
    expect(sim.pedidos).toEqual([{ texto: MINIMO }]);
  });

  test('largo: se dice al pasarse, el botón se apaga con su motivo y ni Ctrl+Intro manda el pedido', async ({ page }) => {
    const sim = await simular(page);
    await abrir(page);
    await cuadro(page).fill('a'.repeat(1500));
    await expect(page.locator('#asis-largo')).toHaveCount(0);
    await expect(armar(page)).not.toHaveAttribute('aria-disabled', 'true');
    await cuadro(page).fill('a'.repeat(1501));
    const largo = page.locator('#asis-largo');
    await expect(largo).toContainText('Es muy largo: el máximo es de 1500 caracteres y llevas 1501. Acórtalo para armar tu flujo.');
    await expect(contador(page)).toHaveText('1501 de 1500 caracteres');
    await expect(armar(page)).toHaveAttribute('aria-disabled', 'true');
    await expect(armar(page)).toHaveAttribute('aria-describedby', 'asis-largo');
    // el aviso no es una región viva (cambiaría con cada letra): se dice UNA vez, al cruzar el máximo
    await expect(largo).not.toHaveAttribute('role', /.*/);
    await expect(regionViva(page)).toHaveText('Es muy largo: el máximo es de 1500 caracteres y llevas 1501. Acórtalo para armar tu flujo.');
    await armar(page).click({ force: true });
    await cuadro(page).press('Control+Enter');
    expect(sim.pedidos).toEqual([]);
    await revisar(page, 'asistente-largo');
    await cuadro(page).fill('a'.repeat(1500));
    await expect(largo).toHaveCount(0);
  });

  test('los límites son los que dice la API, no los de la pantalla', async ({ page }) => {
    const sim = await simular(page, { config: ok({ ...CONFIG, largo_minimo: 30, largo_maximo: 200 }) });
    await abrir(page);
    await expect(contador(page)).toHaveText('0 de 200 caracteres');
    await cuadro(page).fill('a'.repeat(29));
    await expect(contador(page)).toHaveText('29 de 200 caracteres · mínimo 30');
    await armar(page).click();
    await expect(page.locator('#asis-err')).toContainText('al menos 30 caracteres. Llevas 29.');
    await cuadro(page).fill('a'.repeat(201));
    await expect(page.locator('#asis-largo')).toContainText('el máximo es de 200 caracteres y llevas 201');
    expect(sim.pedidos).toEqual([]);
  });

  test('el pedido se manda recortado; Ctrl+Intro también lo manda; y un doble clic manda UNO solo', async ({ page }) => {
    const sim = await simular(page);
    await abrir(page);
    await cuadro(page).fill(`   ${TEXTO_DE_LA_PERSONA}   \n`);
    await cuadro(page).press('Control+Enter');
    await expect(armar(page)).toHaveText('Armando…');
    await armar(page).dblclick({ force: true });
    await armar(page).click({ force: true });
    await page.waitForTimeout(300);
    expect(sim.pedidos).toEqual([{ texto: TEXTO_DE_LA_PERSONA }]);
  });

  test('el pedido no queda en el navegador: ni en el almacenamiento ni en las cookies', async ({ page, context }) => {
    await simular(page);
    await abrir(page);
    await pedir(page, 'Mi pedido secreto sobre la lampara de escritorio de mi cliente');
    await expect(armar(page)).toHaveText('Armando…');
    const guardado = await page.evaluate(async () => {
      const bd = 'indexedDB' in window && typeof indexedDB.databases === 'function' ? (await indexedDB.databases()).map(d => d.name) : [];
      return JSON.stringify({ local: { ...localStorage }, sesion: { ...sessionStorage }, cookies: document.cookie, bd });
    });
    expect(guardado).not.toContain('secreto');
    expect(guardado).not.toContain('lampara');
    expect(JSON.stringify(await context.cookies())).not.toContain('lampara');
    await page.reload();
    await expect(cuadro(page)).toHaveValue('');
  });
});

// ---------------------------------------------------------------------------
// Los pasos, el resultado y la descarga (a 1100 px)

test.describe('Asistente: armar, esperar y recibir', () => {
  test.use({ viewport: { width: 1100, height: 900 } });

  test('los pasos avanzan con lo que informa el servidor y nunca retroceden; al final llega el flujo', async ({ page }) => {
    await page.clock.install();
    const sim = await simular(page, {
      consultar: [ok(armandoEn('buscar')), ok(armandoEn('entender')), ok(armandoEn('revisar')), ok(listo())],
    });
    await abrir(page);
    await pedir(page);
    expect(await estadoDePasos(page)).toEqual({ activo: 'Entendiendo lo que pides', hechos: [] });
    await page.clock.fastForward(5000);
    await expect(regionViva(page)).toHaveText('Armando tu flujo. Buscando ejemplos parecidos…');
    expect(await estadoDePasos(page)).toEqual({ activo: 'Buscando ejemplos parecidos', hechos: ['Entendimos lo que pides'] });
    await page.clock.fastForward(5000); // una respuesta vieja («entender») NO regresa los pasos
    await expect.poll(() => sim.consultas.length).toBe(2);
    expect(await estadoDePasos(page)).toEqual({ activo: 'Buscando ejemplos parecidos', hechos: ['Entendimos lo que pides'] });
    await page.clock.fastForward(5000);
    await expect(regionViva(page)).toHaveText('Armando tu flujo. Revisando que se pueda importar en n8n…');
    expect(await estadoDePasos(page)).toEqual({
      activo: 'Revisando que se pueda importar en n8n',
      hechos: ['Entendimos lo que pides', 'Encontramos ejemplos parecidos', 'Armamos los cuadros'],
    });
    expect(await page.title()).toBe('Armando tu flujo · Estudio de video · Asistente');
    await page.clock.fastForward(10000);
    await expect(tituloListo(page)).toBeFocused();
    await expect(pasos(page)).toHaveCount(0);
    expect(await page.title()).toBe('Tu flujo está listo · Estudio de video · Asistente');
    // se preguntó siempre por el mismo pedido, y no se mandó otro
    expect(new Set(sim.consultas)).toEqual(new Set([ID]));
    expect(sim.pedidos).toHaveLength(1);
  });

  test('el sondeo de verdad: la primera pregunta llega a los 5 s, no antes, y la segunda trae el flujo', async ({ page }) => {
    test.setTimeout(45_000);
    const sim = await simular(page, { consultar: [ok(armandoEn('armar')), ok(listo())] });
    await abrir(page);
    const t0 = Date.now();
    await pedir(page);
    await expect(principal(page)).toContainText('Llevas 0:0');
    await expect.poll(() => sim.consultas.length, { timeout: 12_000 }).toBeGreaterThanOrEqual(1);
    const espera = sim.cuando[0]! - t0;
    expect(espera).toBeGreaterThanOrEqual(4500);
    expect(espera).toBeLessThanOrEqual(9000);
    await expect(regionViva(page)).toHaveText('Armando tu flujo. Armando los cuadros…');
    await expect(tituloListo(page)).toBeFocused({ timeout: 12_000 }); // la segunda pregunta, 5 s después, trae el flujo
    expect(sim.cuando[1]! - sim.cuando[0]!).toBeGreaterThanOrEqual(4500);
  });

  test('la descarga baja de verdad el .json de n8n, tal cual lo mandó el servidor, con sangría', async ({ page }) => {
    await page.clock.install();
    await simular(page, { consultar: [ok(listo())] });
    await abrir(page);
    await pedir(page);
    await page.clock.fastForward(5000);
    await expect(tituloListo(page)).toBeFocused();
    const [descarga] = await Promise.all([page.waitForEvent('download'), botonDescargar(page).click()]);
    expect(descarga.suggestedFilename()).toBe('Responder correos de clientes.json');
    const texto = readFileSync(await descarga.path(), 'utf8');
    expect(JSON.parse(texto)).toEqual(MUESTRA_CORREOS.flujo);
    expect(texto).toBe(JSON.stringify(MUESTRA_CORREOS.flujo, null, 2));
    expect(JSON.parse(texto)).toMatchObject({ name: 'Responder correos de clientes', connections: expect.any(Object), nodes: expect.any(Array) });
    expect(texto).not.toMatch(/sk-|AIza|Bearer /);
    await expect(regionViva(page)).toHaveText('Descargamos «Responder correos de clientes.json».');
    // dos clics seguidos bajan UN archivo
    await page.waitForTimeout(1100);
    const bajados: string[] = [];
    page.on('download', d => bajados.push(d.suggestedFilename()));
    await botonDescargar(page).dblclick();
    await expect.poll(() => bajados.length).toBe(1);
    await page.waitForTimeout(400);
    expect(bajados).toHaveLength(1);
  });

  test('si el navegador niega la descarga, deja el JSON a la vista para copiarlo', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.clock.install();
    await page.addInitScript(() => {
      URL.createObjectURL = () => {
        throw new Error('sin descargas aquí');
      };
    });
    await simular(page, { consultar: [ok(listo())] });
    await abrir(page);
    await pedir(page);
    await page.clock.fastForward(5000);
    await expect(tituloListo(page)).toBeFocused();
    await botonDescargar(page).click();
    await expect(principal(page)).toContainText('Tu navegador no dejó descargar el archivo. Copia el JSON y pégalo en un archivo con el nombre «Responder correos de clientes.json».');
    const caja = page.getByRole('textbox', { name: 'El JSON de tu flujo' });
    await expect(caja).toHaveAttribute('readonly', '');
    expect(JSON.parse(await caja.inputValue())).toEqual(MUESTRA_CORREOS.flujo);
    await copiarJson(page).click();
    expect(JSON.parse(await page.evaluate(() => navigator.clipboard.readText()))).toEqual(MUESTRA_CORREOS.flujo);
    await expect(page.getByRole('button', { name: 'Copiado: el JSON' })).toBeVisible();
    await revisar(page, 'asistente-sin-descarga');
  });

  test('«Armar otro flujo» pide otro y el resultado de antes no se mezcla con el nuevo', async ({ page }) => {
    await page.clock.install();
    const sim = await simular(page, { consultar: [ok(listo(MUESTRA_CORREOS)), ok(listo(MUESTRA_PREGUNTAS))] });
    await abrir(page);
    await pedir(page);
    await page.clock.fastForward(5000);
    await expect(principal(page)).toContainText('Responder correos de clientes');
    await cuadro(page).fill('Un chat donde mis clientes pregunten lo de siempre y una IA les responda');
    await armar(page).click();
    await expect(armar(page)).toHaveText('Armando…');
    await page.clock.fastForward(5000);
    await expect(tituloListo(page)).toBeVisible();
    await expect(principal(page)).toContainText('Asistente de preguntas frecuentes');
    await expect(principal(page)).not.toContainText('Responder correos de clientes');
    expect(sim.pedidos).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Los errores (a 1100 px)

test.describe('Asistente: los errores', () => {
  test.use({ viewport: { width: 1100, height: 900 } });

  test('sin conexión al pedir: lo dice, el texto sigue ahí y se puede reintentar', async ({ page }) => {
    const sim = await simular(page, { armar: [sinRed] });
    await abrir(page);
    await pedir(page);
    await expect(page.getByRole('alert')).toContainText('No hay conexión. Revisa tu internet y vuelve a intentar.');
    await expect(page.getByRole('alert')).toContainText('Revisa tu conexión y pulsa «Armar flujo» otra vez: tu texto sigue en el cuadro.');
    await expect(cuadro(page)).toHaveValue(TEXTO_DE_LA_PERSONA);
    await revisar(page, 'asistente-sin-conexion');
    await armar(page).click();
    await expect(armar(page)).toHaveText('Armando…');
    expect(sim.pedidos).toHaveLength(2);
  });

  test('429 agotado: dice que no se puede hoy (sin invitar a reintentar ya) y el texto se queda', async ({ page }) => {
    await simular(page, { armar: [falla(429, 'agotado', 'Ya usaste tus armados de hoy. Se renuevan a la medianoche, hora de México.')] });
    await abrir(page);
    await pedir(page);
    const alerta = page.getByRole('alert');
    await expect(alerta).toContainText('Ya usaste tus armados de hoy. Se renuevan a la medianoche, hora de México.');
    await expect(alerta).toContainText('Vuelve mañana para armar otro flujo.');
    await expect(alerta).not.toContainText('otra vez');
    await expect(cuadro(page)).toHaveValue(TEXTO_DE_LA_PERSONA);
  });

  test('409 en curso y 402 sin saldo: se dicen con su texto y con qué sigue', async ({ page }) => {
    await simular(page, {
      armar: [
        falla(409, 'en_curso', 'Ya estamos armando otro flujo para ti, quizá en otra pestaña. Espera a que termine.'),
        falla(402, 'sin_saldo', 'No te alcanzan los créditos para armar este flujo.'),
      ],
    });
    await abrir(page);
    await pedir(page);
    await expect(page.getByRole('alert')).toContainText('Ya estamos armando otro flujo para ti, quizá en otra pestaña.');
    await expect(page.getByRole('alert')).toContainText('Cuando termine ese armado, pulsa «Armar flujo» otra vez.');
    await armar(page).click();
    await expect(page.getByRole('alert')).toContainText('No te alcanzan los créditos para armar este flujo.');
    await expect(page.getByRole('alert')).toContainText('Cuando recargues, pulsa «Armar flujo» otra vez.');
  });

  test('el pedido que ya no existe (404 al preguntar): lo dice y el foco va al cuadro para escribirlo de nuevo', async ({ page }) => {
    await page.clock.install();
    await simular(page, { consultar: [falla(404, 'no_encontrada', 'No encontramos ese pedido. Escribe de nuevo qué quieres automatizar.')] });
    await abrir(page);
    await pedir(page);
    await page.clock.fastForward(5000);
    await expect(page.getByRole('alert')).toContainText('No encontramos ese pedido. Escribe de nuevo qué quieres automatizar.');
    await expect(page.getByRole('alert')).toContainText('Escribe tu pedido de nuevo y pulsa «Armar flujo».');
    await expect(cuadro(page)).toBeFocused();
    await expect(armar(page)).toHaveText('Armar flujo');
    await expect(pasos(page)).toHaveCount(0);
  });

  test('el servidor dice que no salió o que la rechazó: lo dice con sus palabras y se puede volver a pedir', async ({ page }) => {
    await page.clock.install();
    const sim = await simular(page, {
      consultar: [
        ok({ id: ID, estado: 'no_salio', listo: false, modo: 'prueba', lleva_seg: 9, mensaje: 'Esta vez no pudimos armar tu flujo. Inténtalo de nuevo.' }),
      ],
    });
    await abrir(page);
    await pedir(page);
    await page.clock.fastForward(5000);
    await expect(page.getByRole('alert')).toContainText('Esta vez no pudimos armar tu flujo. Inténtalo de nuevo.');
    await expect(armar(page)).toHaveText('Armar flujo');
    await armar(page).click();
    await expect(armar(page)).toHaveText('Armando…');
    expect(sim.pedidos).toHaveLength(2);
  });

  test('un corte de internet mientras arma no tumba el armado: avisa «Sin conexión», sigue preguntando y termina', async ({ page }) => {
    await page.clock.install();
    const sim = await simular(page, { consultar: [sinRed, ok(listo())] });
    await abrir(page);
    await pedir(page);
    await page.clock.fastForward(5000);
    await expect(principal(page)).toContainText('Sin conexión. Seguimos intentando…');
    await expect(regionViva(page)).toHaveText('Sin conexión. Seguimos intentando.');
    await expect(armar(page)).toHaveText('Armando…');
    await expect(page.getByRole('alert')).toHaveCount(0); // no es un error: se sigue solo
    await revisar(page, 'asistente-corte-armando');
    await page.clock.fastForward(5000);
    await expect(tituloListo(page)).toBeFocused();
    await expect(principal(page)).not.toContainText('Sin conexión');
    expect(sim.consultas.length).toBeGreaterThanOrEqual(2);
  });

  test('una respuesta que no se entiende no rompe la pantalla', async ({ page }) => {
    await page.clock.install();
    await simular(page, { consultar: [ok({ id: ID, estado: 'quien-sabe', llave: 1 })] });
    await abrir(page);
    await pedir(page);
    await page.clock.fastForward(5000);
    await expect(page.getByRole('alert')).toContainText('Recibimos una respuesta que no entendemos. Inténtalo otra vez.');
    await expect(cuadro(page)).toHaveValue(TEXTO_DE_LA_PERSONA);
  });

  test('no se pudo leer si está disponible (503): «Reintentar» vuelve a preguntar y entonces aparece el cuadro', async ({ page }) => {
    const sim = await simular(page, { config: falla(503, 'no_disponible', 'El Asistente no está disponible por ahora. Inténtalo en unos minutos.') });
    await abrir(page); // sin cuadro todavía: el encabezado de la pantalla sí está
    const alerta = page.getByRole('alert');
    await expect(alerta).toContainText('El Asistente no está disponible por ahora. Inténtalo en unos minutos.');
    await expect(alerta).toContainText('Revisa tu conexión y pulsa «Reintentar».');
    await expect(cuadro(page)).toHaveCount(0);
    await revisar(page, 'asistente-sin-config', { foco: false });
    sim.config = ok(CONFIG);
    await page.getByRole('button', { name: 'Reintentar' }).click();
    await expect(cuadro(page)).toBeVisible();
    await expect(cuadro(page)).toBeFocused();
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(sim.configs).toBeGreaterThanOrEqual(2);
  });

  test('un servidor que cobra o que no dice si es gratis no se ofrece: esta pantalla no sabe mostrar un costo', async ({ page }) => {
    await simular(page, { config: ok({ ...CONFIG, modo: 'real', gratis: false, costo_creditos: 3 }) });
    await abrir(page);
    await expect(page.getByRole('heading', { name: 'No está disponible por ahora' })).toBeVisible();
    await expect(cuadro(page)).toHaveCount(0);
    await expect(principal(page)).not.toContainText(/✦|créditos|\$/);
  });

  test('sin el letrero de prueba cuando el servidor arma de verdad (modo real y gratis)', async ({ page }) => {
    await simular(page, { config: ok({ ...CONFIG, modo: 'real', gratis: true }) });
    await abrir(page);
    await expect(cuadro(page)).toBeVisible();
    await expect(principal(page)).not.toContainText('Prueba: por ahora armamos flujos de ejemplo.');
  });

  test('el Asistente no pone avisos propios en la esquina (los errores van en la pantalla)', async ({ page }) => {
    await simular(page, { armar: [falla(503, 'no_disponible', 'El Asistente no está disponible por ahora. Inténtalo en unos minutos.')] });
    await abrir(page);
    await pedir(page);
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(avisosDeLaEsquina(page)).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// El traspaso al Constructor: el flujo pasa por el borrador del navegador, con pregunta si ya había uno

/** El Asistente con el flujo de «Responder correos de clientes» ya armado. */
async function conResultado(page: Page) {
  await page.clock.install();
  const sim = await simular(page, { consultar: [ok(listo(MUESTRA_CORREOS))] });
  await abrir(page);
  await pedir(page);
  await page.clock.fastForward(5000);
  await expect(tituloListo(page)).toBeFocused();
  return sim;
}

test.describe('Asistente: abrir en el constructor', () => {
  test.use({ viewport: { width: 1100, height: 900 } });

  test('el flujo llega al Constructor tal cual: cuadros, conexiones, nombre, el primer agente elegido, y sin pedir nada al servidor', async ({ page }) => {
    await conResultado(page);
    await botonAbrirEnConstructor(page).click();
    await page.waitForURL('**/estudio/automatizaciones/distrito/constructor/');
    await expect(page.getByRole('heading', { level: 2, name: 'Arma tu automatización' })).toBeVisible();
    await expect(nodos(page)).toHaveCount(4);
    await expect(page.getByLabel('Nombre del flujo')).toHaveValue('Responder correos de clientes');
    await expect(bandeja(page)).toContainText('Abrimos tu flujo del Asistente.');
    await expect(nodo(page, 'Atención por correo')).toBeFocused();
    await expect(nodo(page, 'Atención por correo')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('group', { name: 'Disparador del flujo' })).toHaveCount(0);
    await expect(page.getByText(/^Listo para descargar: 4 cuadros\./)).toBeVisible();
    // no es un flujo nuevo cada vez que se recarga: la marca del Asistente se quitó y ahora es «tu borrador»
    await expect.poll(async () => 'origen' in JSON.parse((await leerBorrador(page)) ?? '{"origen":1}')).toBe(false);
    const guardado = JSON.parse((await leerBorrador(page))!);
    expect(guardado.nodes).toHaveLength(4);
    expect(guardado.nombreFlujo).toBe('Responder correos de clientes');
    // el pedido de la persona no viaja con el flujo
    expect(JSON.stringify(guardado)).not.toContain(TEXTO_DE_LA_PERSONA);
    await page.reload();
    await expect(nodos(page)).toHaveCount(4);
    await expect(bandeja(page)).toContainText('Recuperamos tu borrador.');
    // y lo que llegó se descarga como cualquier flujo del Constructor
    await expect(page.getByRole('button', { name: 'Descargar .json', exact: true })).not.toHaveAttribute('aria-disabled', 'true');
  });

  test('si ya hay un flujo en el Constructor pregunta antes de reemplazarlo: Esc y «Cancelar» no tocan nada', async ({ page }) => {
    await page.addInitScript(([clave]) => {
      // un flujo previo de la persona (un disparador de chat y un agente), como lo guarda el Constructor
      if (localStorage.getItem(clave!) === null) {
        localStorage.setItem(
          clave!,
          JSON.stringify({
            v: 1,
            nodes: [
              { id: 't1', kind: 'trigger', x: 8, y: 180, tipo: 'chat', frec: 'dia', ruta: 'mi-flujo', app: 'gmail' },
              { id: 'a1', kind: 'agent', x: 312, y: 180, nombre: 'Mi agente de antes', ia: 'openai', tarea: '', instrucciones: 'Responde con amabilidad.' },
            ],
            edges: [{ id: 'e1', de: 't1', a: 'a1', tipo: 'seq' }],
            nombreFlujo: 'Lo que ya tenía',
          }),
        );
      }
    }, [CLAVE_BORRADOR]);
    await conResultado(page);
    const antes = await leerBorrador(page);
    await botonAbrirEnConstructor(page).click();
    const pregunta = page.getByRole('alertdialog', { name: '¿Reemplazar tu flujo del constructor?' });
    await expect(pregunta).toBeVisible();
    await expect(pregunta).toContainText('Ya tienes un flujo en el constructor. Si abres este, el que tienes ahí se reemplaza.');
    await expect(pregunta.getByRole('button', { name: 'Cancelar' })).toBeFocused();
    await revisar(page, 'asistente-reemplazar');
    // Esc: no navega, no toca el borrador y el foco vuelve al botón
    await page.keyboard.press('Escape');
    await expect(pregunta).toHaveCount(0);
    expect(page.url()).toContain('/estudio/asistente/');
    expect(await leerBorrador(page)).toBe(antes);
    await expect(botonAbrirEnConstructor(page)).toBeFocused();
    // «Cancelar»: lo mismo
    await botonAbrirEnConstructor(page).click();
    await pregunta.getByRole('button', { name: 'Cancelar' }).click();
    await expect(pregunta).toHaveCount(0);
    expect(page.url()).toContain('/estudio/asistente/');
    expect(await leerBorrador(page)).toBe(antes);
    expect(JSON.parse(antes!).nombreFlujo).toBe('Lo que ya tenía');
    // «Reemplazar y abrir»: ahora sí, y llega el del Asistente
    await botonAbrirEnConstructor(page).click();
    await pregunta.getByRole('button', { name: 'Reemplazar y abrir' }).click();
    await page.waitForURL('**/estudio/automatizaciones/distrito/constructor/');
    await expect(nodos(page)).toHaveCount(4);
    await expect(page.getByLabel('Nombre del flujo')).toHaveValue('Responder correos de clientes');
    await expect(page.getByText('Mi agente de antes')).toHaveCount(0);
  });

  test('un flujo hecho en el Constructor y luego el Asistente: el borrador se respeta hasta que se elige reemplazarlo', async ({ page }) => {
    await page.clock.install();
    await simular(page, { consultar: [ok(listo(MUESTRA_CORREOS))] });
    await page.goto('/estudio/automatizaciones/distrito/constructor/');
    await page.getByRole('button', { name: 'Cargar el ejemplo' }).click();
    await expect(nodos(page)).toHaveCount(5);
    await expect.poll(async () => JSON.parse((await leerBorrador(page)) ?? '{"nodes":[]}').nodes.length).toBe(5);
    await page.goto('/estudio/asistente/');
    await pedir(page);
    await page.clock.fastForward(5000);
    await expect(tituloListo(page)).toBeFocused();
    await botonAbrirEnConstructor(page).click();
    await expect(page.getByRole('alertdialog', { name: '¿Reemplazar tu flujo del constructor?' })).toBeVisible();
    expect(JSON.parse((await leerBorrador(page))!).nombreFlujo).toBe('Atención a clientes');
  });

  test('sin grafo en la respuesta no se ofrece abrirlo en el constructor: solo descargar', async ({ page }) => {
    await page.clock.install();
    await simular(page, { consultar: [ok(listo(MUESTRA_CORREOS, { grafo: undefined }))] });
    await abrir(page);
    await pedir(page);
    await page.clock.fastForward(5000);
    await expect(tituloListo(page)).toBeFocused();
    await expect(botonDescargar(page)).toBeVisible();
    await expect(botonAbrirEnConstructor(page)).toHaveCount(0);
  });

  test('un grafo que el Constructor no puede abrir (trae una clave pegada) tampoco se ofrece', async ({ page }) => {
    await page.clock.install();
    const grafo = JSON.parse(JSON.stringify(MUESTRA_CORREOS.grafo));
    grafo.nodes.find((n: { kind: string }) => n.kind === 'agent').instrucciones = 'Usa esta llave: sk-abcdefghijklmnopqrstuvwxyz0123456789';
    await simular(page, { consultar: [ok(listo(MUESTRA_CORREOS, { grafo }))] });
    await abrir(page);
    await pedir(page);
    await page.clock.fastForward(5000);
    await expect(tituloListo(page)).toBeFocused();
    await expect(botonAbrirEnConstructor(page)).toHaveCount(0);
    await expect(botonDescargar(page)).toBeVisible();
  });

  test('si el navegador no deja guardar el borrador, no navega y dice por qué (con el .json como salida)', async ({ page }) => {
    await page.addInitScript(() => {
      Storage.prototype.setItem = () => {
        throw new DOMException('lleno', 'QuotaExceededError');
      };
    });
    await conResultado(page);
    await botonAbrirEnConstructor(page).click();
    await expect(page.getByRole('alert')).toContainText('Tu navegador no tiene espacio para pasar el flujo al constructor. Descarga el .json y ábrelo en n8n.');
    expect(page.url()).toContain('/estudio/asistente/');
    await expect(botonDescargar(page)).toBeVisible();
    expect(await focoEnElCuerpo(page)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// «Reducir movimiento»

test.describe('Asistente con «reducir movimiento»', () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' }, viewport: { width: 1100, height: 900 } });

  test('mientras arma y al llegar el resultado no corre ninguna animación', async ({ page }) => {
    let soltar!: () => void;
    await simular(page, { consultar: [ok(armandoEn('armar'))], armar: [{ status: 202, body: INICIO, espera: new Promise<void>(r => (soltar = r)) }] });
    await abrir(page);
    expect(await page.evaluate(animacionesVivas)).toEqual([]);
    await pedir(page);
    await expect(armar(page)).toHaveText('Armando…');
    await expect(page.getByRole('progressbar', { name: 'Avance' })).toBeVisible();
    expect(await page.evaluate(animacionesVivas)).toEqual([]);
    soltar();
    await expect(pasos(page).getByRole('listitem')).toHaveCount(4);
    expect(await page.evaluate(animacionesVivas)).toEqual([]);
    expect((await medir(page)).scrollW).toBeLessThanOrEqual(1100);
  });

  test('el resultado y su pregunta de reemplazar tampoco animan nada', async ({ page }) => {
    await page.clock.install();
    await simular(page, { consultar: [ok(listo())] });
    await abrir(page);
    await pedir(page);
    await page.clock.fastForward(5000);
    await expect(tituloListo(page)).toBeVisible();
    expect(await page.evaluate(animacionesVivas)).toEqual([]);
  });
});
