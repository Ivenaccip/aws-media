// «Edición» con VARIOS videos (E2) en un navegador de verdad, con el static/trabajos.js real. Lo que jsdom no ve:
//  · el menú del «+» (Subir de tu computadora / Elegir de Mis creaciones) se maneja con el teclado: Enter, flechas, Inicio, Fin, Esc y
//    Tab, y el foco vuelve al «+»;
//  · «Elegir de Mis creaciones»: la hoja «Agregar videos», marcar tres en un orden, «Usar 3 videos» y la caja con «se unen en este orden»;
//    solo se pide UN precio, con las referencias en ese orden; un formato distinto queda apagado con su motivo;
//  · Subir y Bajar con el teclado: el foco sigue al botón que se pulsó, el orden cambia y NO se vuelve a pedir el precio;
//  · formatos que no se mezclan: el texto del servidor se enseña tal cual y «Iniciar» explica en vez de cobrar;
//  · en 390 y en 320 px nada se sale de la pantalla y todo lo tocable (la caja y la hoja) mide al menos 44 × 44 px;
//  · la subida de dos archivos va de uno en uno (XHR real, uno «En cola» mientras el otro sube) y cancelar el que sube sigue con el otro;
//  · «Iniciar ✦ 2» con tres videos manda SOLO la clave del pedido, las referencias en su orden y la instrucción (y repetir tras una
//    respuesta dudosa conserva la clave); la bandeja de verdad pinta los tres pasos, «Pediste», «Llevas» (que corre solo), el listo con
//    «Abrir el editor» y el error con «Reintentar»;
//  · con «reducir movimiento» nada se queda moviéndose.
// No gasta nada: el servidor y «S3» son rutas de mentira (e2e/edicion.ts).
import { expect, test, type Locator, type Page } from '@playwright/test';

import { conTranscripcion, COPIA, cotizacion, elegible, simularEdicion, type OpcionesDeEdicion, type Visto } from './edicion';
import { animacionesVivas } from './pantallas';
import { elegir } from './recorrido';

const TREN = elegible('El tren de papel', { ref: 'proyecto:gen-1a2b3c4d', duracion_s: 312 });
const PERRO = elegible('Perro en la playa', { ref: 'clip:clip-20261008-101500-ab12cd', tipo: 'clip', duracion_s: 30 });
const ENTREVISTA = elegible('Entrevista final', { ref: 'proyecto:entrevista-final', duracion_s: 312 });
const VERTICAL = elegible('Short de la mañana', { ref: 'proyecto:short-manana', tipo: 'clip', formato: 'vertical', duracion_s: 45 });
const ELEGIBLES = [TREN, PERRO, ENTREVISTA, VERTICAL];

const TEXTO_FORMATOS = 'Los videos horizontales y los verticales no se mezclan. Quita los verticales o edítalos aparte.';

/** Todos con transcripción: solo la edición (✦ 2), con la duración y el formato que la hoja ya conocía de cada uno (el servidor mide lo mismo). */
const barato = (refs: string[]) => {
  const c = conTranscripcion(refs);
  const videos = c.videos.map(v => {
    const e = ELEGIBLES.find(x => x.ref === v.ref);
    return { ...v, duracion_s: e?.duracion_s ?? 312, formato: e?.formato ?? v.formato };
  });
  return { ...c, videos, duracion_total_s: videos.reduce((a, v) => a + (v.duracion_s ?? 0), 0) };
};

const riel = (page: Page) => page.getByRole('group', { name: 'Qué quieres crear' });
const campo = (page: Page) => page.getByRole('textbox', { name: 'Cuéntale a la IA qué quieres' });
const mas = (page: Page) => page.locator('button[aria-haspopup="menu"]');
const menu = (page: Page) => page.getByRole('menu', { name: 'Agregar videos' });
const hoja = (page: Page) => page.getByRole('dialog', { name: 'Agregar videos' });
const grupo = (page: Page) => page.getByRole('group', { name: 'Videos que se unen' });
const filas = (page: Page) => grupo(page).locator('[data-fila]');
const iniciar = (page: Page) => page.getByRole('button', { name: /^(Iniciar|Subiendo|Calculando)/ });
const tarjeta = (page: Page, titulo: string) => hoja(page).getByRole('button', { name: new RegExp('^' + titulo) });
const orden = (page: Page) => filas(page).locator('b').allInnerTexts();

async function abrir(page: Page, o: OpcionesDeEdicion = {}): Promise<Visto> {
  const visto = await simularEdicion(page, { elegibles: ELEGIBLES, cotizar: barato, ...o });
  await page.goto('/estudio/inicio/');
  await expect(page.getByRole('heading', { level: 2, name: 'Elige un área' })).toBeVisible();
  await elegir(page, 'Marketing', 'Distrito');
  await riel(page).getByRole('button', { name: 'Edición' }).click();
  await expect(campo(page)).toBeVisible();
  return visto;
}

/** «+» → «Elegir de Mis creaciones» → la hoja con su lista cargada. */
async function abrirLaHoja(page: Page) {
  await mas(page).click();
  await menu(page).getByRole('menuitem', { name: /Elegir de Mis creaciones/ }).click();
  await expect(hoja(page)).toBeVisible();
  await expect(tarjeta(page, 'El tren de papel')).toBeVisible();
}

/** Marca en ese orden y pulsa «Usar»: la caja queda con los videos de `titulos`, en ese orden. */
async function elegirDeCreaciones(page: Page, titulos: string[]) {
  await abrirLaHoja(page);
  for (const t of titulos) await tarjeta(page, t).click();
  await hoja(page).getByRole('button', { name: titulos.length === 1 ? 'Usar este video' : `Usar ${titulos.length} videos` }).click();
  await expect(hoja(page)).toHaveCount(0);
}

const TRES = ['Entrevista final', 'El tren de papel', 'Perro en la playa'];

/** ¿Mide al menos 44 × 44 px y cabe a lo ancho de la ventana? */
async function tocable(l: Locator, ancho: number, nombre: string) {
  const caja = (await l.boundingBox())!;
  expect(caja, nombre).not.toBeNull();
  expect(caja.width, `${nombre}: ancho`).toBeGreaterThanOrEqual(44);
  expect(caja.height, `${nombre}: alto`).toBeGreaterThanOrEqual(44);
  expect(caja.x, `${nombre}: se sale por la izquierda`).toBeGreaterThanOrEqual(0);
  expect(caja.x + caja.width, `${nombre}: se sale por la derecha`).toBeLessThanOrEqual(ancho);
}

const sobraAncho = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

// ---------------------------------------------------------------------------------------------------- el menú del «+»

test('el menú del «+» se maneja con el teclado: Enter abre, flechas, Inicio y Fin recorren, Esc cierra y devuelve el foco, Tab sigue', async ({ page }) => {
  await abrir(page);
  const subir = menu(page).getByRole('menuitem', { name: /Subir de tu computadora/ });
  const elegirItem = menu(page).getByRole('menuitem', { name: /Elegir de Mis creaciones/ });
  await expect(mas(page)).toHaveAttribute('aria-expanded', 'false');
  await mas(page).focus();
  await page.keyboard.press('Enter');
  await expect(menu(page)).toBeVisible();
  await expect(mas(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(subir).toBeFocused();
  // la segunda opción dice para qué sirve, y el menú recuerda que también se puede arrastrar
  await expect(menu(page)).toContainText('Videos que ya hiciste con IA: elige uno o varios');
  await expect(menu(page)).toContainText('También puedes arrastrar el video a la caja.');
  await page.keyboard.press('ArrowDown');
  await expect(elegirItem).toBeFocused();
  await page.keyboard.press('ArrowDown'); // da la vuelta
  await expect(subir).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(elegirItem).toBeFocused();
  await page.keyboard.press('Home');
  await expect(subir).toBeFocused();
  await page.keyboard.press('End');
  await expect(elegirItem).toBeFocused();
  // Esc cierra y el foco vuelve al «+»
  await page.keyboard.press('Escape');
  await expect(menu(page)).toHaveCount(0);
  await expect(mas(page)).toBeFocused();
  await expect(mas(page)).toHaveAttribute('aria-expanded', 'false');
  // Tab lo cierra y sigue al control que viene después del «+» (el chip «Editar ▾»)
  await page.keyboard.press('Space');
  await expect(subir).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(menu(page)).toHaveCount(0);
  await expect(page.locator('button[aria-haspopup="listbox"]')).toBeFocused();
  // un clic fuera lo cierra
  await mas(page).click();
  await expect(menu(page)).toBeVisible();
  await page.mouse.click(5, 5);
  await expect(menu(page)).toHaveCount(0);
});

test('«Elegir de Mis creaciones» abre la hoja; Esc la cierra, nada queda marcado al volver y el foco regresa al «+»', async ({ page }) => {
  const visto = await abrir(page);
  await abrirLaHoja(page);
  await tarjeta(page, 'El tren de papel').click();
  await expect(tarjeta(page, 'El tren de papel')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(hoja(page)).toHaveCount(0);
  await expect(mas(page)).toBeFocused();
  // la caja sigue vacía (marcar no usa nada) y no se pidió ningún precio
  await expect(filas(page)).toHaveCount(0);
  expect(visto.cotizar).toEqual([]);
  // al abrirla otra vez es una foto nueva: nada marcado
  await abrirLaHoja(page);
  await expect(tarjeta(page, 'El tren de papel')).toHaveAttribute('aria-pressed', 'false');
});

// ---------------------------------------------------------------------------------------------------- elegir, ordenar, quitar, lanzar

test('marcar tres en un orden y «Usar 3 videos»: la caja los une en ESE orden y se pide UN solo precio', async ({ page }) => {
  const visto = await abrir(page);
  await abrirLaHoja(page);
  // la hoja numera lo marcado y el pie cuenta
  await tarjeta(page, 'Entrevista final').click();
  await tarjeta(page, 'El tren de papel').click();
  await tarjeta(page, 'Perro en la playa').click();
  await expect(tarjeta(page, 'Entrevista final')).toHaveAccessibleName(/elegido, número 1/);
  await expect(tarjeta(page, 'El tren de papel')).toHaveAccessibleName(/elegido, número 2/);
  await expect(tarjeta(page, 'Perro en la playa')).toHaveAccessibleName(/elegido, número 3/);
  await expect(tarjeta(page, 'Perro en la playa')).toHaveAccessibleName(/solo para unir/);
  await expect(hoja(page).getByRole('status')).toContainText('3 videos · 10:54 en total');
  await hoja(page).getByRole('button', { name: 'Usar 3 videos' }).click();
  // la hoja se cierra, el foco vuelve al «+» y la caja enseña los tres, en orden, con su duración total
  await expect(hoja(page)).toHaveCount(0);
  await expect(mas(page)).toBeFocused();
  await expect(grupo(page)).toBeVisible();
  await expect(grupo(page)).toContainText('3 videos · 10:54 · se unen en este orden');
  expect(await orden(page)).toEqual(TRES);
  await expect(iniciar(page)).toHaveText('Iniciar ✦ 2');
  // UN precio, con las referencias en el orden de la caja y nada más
  expect(visto.cotizar).toEqual([['proyecto:entrevista-final', 'proyecto:gen-1a2b3c4d', 'clip:clip-20261008-101500-ab12cd']]);
  // y la nota dice que se edita una copia (la pista que rota con «Únelos en este orden…» la prueba Edicion.test.tsx: aquí rota con el reloj)
  await expect(grupo(page)).toContainText('Se edita una copia. Tus originales se quedan como están.');
});

test('Subir y Bajar con el teclado: el orden cambia, el foco sigue al botón y NO se vuelve a pedir el precio', async ({ page }) => {
  const visto = await abrir(page);
  await elegirDeCreaciones(page, TRES);
  await expect(iniciar(page)).toHaveText('Iniciar ✦ 2');
  expect(visto.cotizar).toHaveLength(1);
  const accion = (nombre: string) => grupo(page).getByRole('button', { name: nombre });
  // el primero no puede subir y el último no puede bajar: apagados, pero enfocables
  await expect(accion('Subir “Entrevista final”')).toHaveAttribute('aria-disabled', 'true');
  await expect(accion('Bajar “Perro en la playa”')).toHaveAttribute('aria-disabled', 'true');
  await accion('Bajar “Entrevista final”').focus();
  await page.keyboard.press('Enter');
  expect(await orden(page)).toEqual(['El tren de papel', 'Entrevista final', 'Perro en la playa']);
  // el foco se queda en el MISMO botón aunque la fila cambió de lugar
  await expect(accion('Bajar “Entrevista final”')).toBeFocused();
  await expect(grupo(page).getByRole('status')).toHaveText('“Entrevista final” ahora es el número 2 de 3.');
  // un apagado no mueve nada
  await accion('Subir “El tren de papel”').focus();
  await page.keyboard.press('Space');
  expect(await orden(page)).toEqual(['El tren de papel', 'Entrevista final', 'Perro en la playa']);
  // Espacio en Subir
  await accion('Subir “Perro en la playa”').focus();
  await page.keyboard.press('Space');
  expect(await orden(page)).toEqual(['El tren de papel', 'Perro en la playa', 'Entrevista final']);
  await expect(accion('Subir “Perro en la playa”')).toBeFocused();
  // reordenar no es agregar ni quitar: el precio no se pide otra vez (se espera un poco por si acaso)
  await page.waitForTimeout(500);
  expect(visto.cotizar).toHaveLength(1);
  // y lo que se lanza lleva el orden NUEVO
  await campo(page).fill('Únelos en este orden y quita los silencios');
  await iniciar(page).click();
  await expect.poll(() => visto.iniciar.length).toBe(1);
  expect(visto.iniciar[0]!.videos).toEqual(['proyecto:gen-1a2b3c4d', 'clip:clip-20261008-101500-ab12cd', 'proyecto:entrevista-final']);
});

test('quitar un video de la unión vuelve a pedir el precio con los que quedan; con uno solo la caja vuelve a su tarjeta', async ({ page }) => {
  const visto = await abrir(page);
  await elegirDeCreaciones(page, TRES);
  await grupo(page).getByRole('button', { name: 'Quitar “Perro en la playa”' }).click();
  await expect(filas(page)).toHaveCount(2);
  await expect.poll(() => visto.cotizar.length).toBe(2);
  expect(visto.cotizar[1]).toEqual(['proyecto:entrevista-final', 'proyecto:gen-1a2b3c4d']);
  await grupo(page).getByRole('button', { name: 'Quitar “Entrevista final”' }).click();
  // UN video: ya no es una unión, es su tarjeta
  await expect(grupo(page)).toHaveCount(0);
  await expect(page.getByText('El tren de papel')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Quitar este video' })).toBeVisible();
  await expect.poll(() => visto.cotizar.length).toBe(3);
  expect(visto.cotizar[2]).toEqual(['proyecto:gen-1a2b3c4d']);
});

test('un video de otro formato queda apagado en la hoja con su motivo, y se vuelve a poder al desmarcar', async ({ page }) => {
  await abrir(page);
  await abrirLaHoja(page);
  const vertical = tarjeta(page, 'Short de la mañana');
  await expect(vertical).toHaveAttribute('aria-pressed', 'false');
  await expect(vertical).not.toHaveAttribute('aria-disabled', 'true');
  await tarjeta(page, 'El tren de papel').click();
  // apagado (aria-disabled, enfocable) con el motivo en su nombre y a la vista; marcarlo no hace nada
  await expect(vertical).toHaveAttribute('aria-disabled', 'true');
  await expect(vertical).toHaveAccessibleName(/no disponible: Vertical · no se une con horizontales/);
  await expect(hoja(page).getByText('Vertical · no se une con horizontales')).toBeVisible();
  await vertical.click({ force: true });
  await expect(vertical).toHaveAttribute('aria-pressed', 'false');
  await expect(hoja(page).getByRole('button', { name: 'Usar este video' })).toBeVisible();
  // desmarcar el horizontal libera al vertical
  await tarjeta(page, 'El tren de papel').click();
  await expect(vertical).not.toHaveAttribute('aria-disabled', 'true');
  await vertical.click();
  await expect(vertical).toHaveAttribute('aria-pressed', 'true');
});

test('si el servidor dice que no se pueden unir, su texto se enseña TAL CUAL y «Iniciar» explica en vez de cobrar', async ({ page }) => {
  const visto = await abrir(page, {
    cotizar: refs =>
      refs.length > 1 ? cotizacion(refs, { creditos: null, desglose: null, bloqueo: { codigo: 'formatos', texto: TEXTO_FORMATOS } }) : barato(refs),
  });
  await elegirDeCreaciones(page, ['El tren de papel', 'Entrevista final']);
  await campo(page).fill('Únelos');
  const nota = page.getByText(TEXTO_FORMATOS);
  await expect(nota).toBeVisible();
  await expect(iniciar(page)).toHaveText('Iniciar');
  await expect(iniciar(page)).toHaveAttribute('aria-disabled', 'true');
  await expect(iniciar(page)).toHaveAccessibleDescription(TEXTO_FORMATOS);
  // el clic no cobra: lleva el foco al «+» (lo que se puede hacer es cambiar los videos)
  await iniciar(page).click({ force: true });
  await expect(mas(page)).toBeFocused();
  await page.waitForTimeout(300);
  expect(visto.iniciar).toEqual([]);
});

// ---------------------------------------------------------------------------------------------------- subir de la computadora

const ARCHIVO_A = { name: 'entrevista.mp4', mimeType: 'video/mp4', buffer: Buffer.alloc(2048, 1) };
const ARCHIVO_B = { name: 'toma-2.mp4', mimeType: 'video/mp4', buffer: Buffer.alloc(2048, 2) };

test('dos archivos suben de uno en uno (XHR real): uno sube mientras el otro espera «En cola», y el precio se pide UNA vez al final', async ({ page }) => {
  const visto = await abrir(page, { cotizar: refs => cotizacion(refs), subidaMs: { 'entrevista.mp4': 1500, 'toma-2.mp4': 400 } });
  await page.locator('input[type="file"]').setInputFiles([ARCHIVO_A, ARCHIVO_B]);
  const filaA = filas(page).filter({ hasText: 'entrevista.mp4' });
  const filaB = filas(page).filter({ hasText: 'toma-2.mp4' });
  await expect(filas(page)).toHaveCount(2);
  // el primero sube (con su barra) y el segundo espera su turno: sin barra y sin haber pedido siquiera su permiso de subida
  await expect(filaA.getByRole('progressbar', { name: 'Subiendo “entrevista.mp4”' })).toBeVisible();
  await expect(filaA.getByRole('progressbar')).toHaveAttribute('aria-valuenow', /^\d+$/);
  await expect(filaB).toContainText('En cola');
  await expect(filaB.getByRole('progressbar')).toHaveCount(0);
  expect(visto.presign.map(p => p.archivo)).toEqual(['entrevista.mp4']);
  // mientras suben: «Subiendo…» ocupado, y no hay precio todavía
  await expect(iniciar(page)).toHaveText('Subiendo…');
  await expect(page.getByText('Cuando termine de subir calculamos el precio. Hasta entonces no se cobra nada.')).toBeVisible();
  expect(visto.cotizar).toEqual([]);
  // terminan los dos, EN ORDEN, y recién entonces llega UN precio
  await expect(iniciar(page)).toHaveText('Iniciar ✦ 8', { timeout: 15000 });
  expect(visto.presign.map(p => p.archivo)).toEqual(['entrevista.mp4', 'toma-2.mp4']);
  expect(visto.confirmar).toEqual(['videos/entrevista/subidas/entrevista.mp4', 'videos/toma-2/subidas/toma-2.mp4']);
  expect(visto.cotizar).toEqual([['proyecto:entrevista', 'proyecto:toma-2']]);
  expect(await orden(page)).toEqual(['entrevista.mp4', 'toma-2.mp4']);
  // ya con precio, cada fila dice lo que se midió (duración, formato y peso del archivo)
  await expect(filaA).toContainText('12:04 · MP4 · 1 MB');
});

test('cancelar el archivo que sube corta SU PUT (no se confirma) y la cola sigue con el siguiente', async ({ page }) => {
  const visto = await abrir(page, { cotizar: refs => cotizacion(refs), subidaMs: { 'entrevista.mp4': 4000, 'toma-2.mp4': 400 } });
  await page.locator('input[type="file"]').setInputFiles([ARCHIVO_A, ARCHIVO_B]);
  const filaA = filas(page).filter({ hasText: 'entrevista.mp4' });
  await expect(filaA.getByRole('progressbar')).toBeVisible();
  await filaA.getByRole('button', { name: 'Cancelar la subida de “entrevista.mp4”' }).click();
  // el siguiente arranca, termina, y con UN solo video la caja vuelve a su tarjeta con el precio de ese
  await expect(page.getByRole('button', { name: 'Iniciar ✦ 8' })).toBeVisible({ timeout: 15000 });
  await expect(page.getByText('entrevista.mp4')).toHaveCount(0);
  await expect(page.getByText('toma-2.mp4')).toBeVisible();
  await page.waitForTimeout(500);
  expect(visto.presign.map(p => p.archivo)).toEqual(['entrevista.mp4', 'toma-2.mp4']);
  expect(visto.confirmar).toEqual(['videos/toma-2/subidas/toma-2.mp4']);
  expect(visto.cotizar).toEqual([['proyecto:toma-2']]);
});

test('subir archivos junto con los elegidos de Mis creaciones: todo cabe en una unión y se cotiza junto', async ({ page }) => {
  const visto = await abrir(page, { cotizar: refs => cotizacion(refs) });
  await elegirDeCreaciones(page, ['El tren de papel']);
  await expect(page.getByRole('button', { name: 'Iniciar ✦ 8' })).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles(ARCHIVO_A);
  await expect(filas(page)).toHaveCount(2);
  await expect(iniciar(page)).toHaveText('Iniciar ✦ 8', { timeout: 15000 });
  expect(await orden(page)).toEqual(['El tren de papel', 'entrevista.mp4']);
  expect(visto.cotizar.at(-1)).toEqual(['proyecto:gen-1a2b3c4d', 'proyecto:entrevista']);
});

// ---------------------------------------------------------------------------------------------------- iniciar y la bandeja

const INICIO_FICHA = () => new Date(Date.now() - 130_000).toISOString();
const PASOS = ['Entender', 'Editar', 'Vista previa'];
const PEDIDO = 'Únelos en este orden y quita los silencios';

const fichaCorriendo = (paso = 'entender', ts = 1792087331) => ({
  id: `edicion:${COPIA}:${ts}`,
  tipo: 'edicion',
  estado: 'corriendo',
  titulo: 'La IA edita Entrevista final + 2 más',
  detalle: 'Ordenando tus 3 videos…',
  progreso: null,
  url: '',
  cuando: INICIO_FICHA(),
  devueltos: null,
  edicion: { nombre: COPIA, paso, pasos: PASOS, pedido: PEDIDO, inicio: INICIO_FICHA(), resumen: null, enlace: null, error: null },
});

const fichaLista = () => ({
  ...fichaCorriendo('vista', 1792087900),
  estado: 'listo',
  titulo: 'Tu video editado está listo',
  detalle: 'Unimos 3 videos · 10:54 → 10:21',
  url: `/editor/${COPIA}/`,
  edicion: {
    ...fichaCorriendo('vista').edicion,
    resumen: 'Unimos 3 videos · 10:54 → 10:21',
    enlace: { texto: 'Abrir el editor', url: `/editor/${COPIA}/` },
  },
});

const fichaError = () => ({
  ...fichaCorriendo('editar', 1792088000),
  estado: 'error',
  titulo: 'No se pudo editar la unión de tus videos',
  detalle: '',
  devueltos: 2,
  edicion: {
    ...fichaCorriendo('editar').edicion,
    error: {
      que_paso: 'Falló el paso «Editar» al unir tus 3 videos, de nuestro lado.',
      creditos: 'Te devolvimos ✦ 2.',
      que_sigue: 'Tus videos originales no se tocaron. Reintentar vuelve a cobrar ✦ 2.',
      reintentar: { texto: 'Reintentar', ruta: `/api/edicion/${COPIA}/reintentar`, creditos: 2 },
    },
  },
});

/** La bandeja lee /api/trabajos al llamarla: se le da la lista nueva y se le pide que la lea ya (sin esperar su sondeo de 15 s). */
async function ponerTrabajos(page: Page, visto: Visto, lista: unknown[]) {
  visto.trabajos.lista = lista;
  await page.evaluate(() => (window as unknown as { trabajos: { refrescar: () => Promise<void> } }).trabajos.refrescar());
}

const bandeja = (page: Page) => page.locator('#bandeja');

async function abrirLaBandeja(page: Page) {
  const item = bandeja(page).locator('.bj-item');
  if ((await item.count()) === 0) await bandeja(page).locator('[data-abrir]').click();
  await expect(item.first()).toBeVisible();
}

test('«Iniciar ✦ 2» con tres videos manda SOLO el pedido, las referencias en su orden y la instrucción; la caja se vacía', async ({ page }) => {
  const visto = await abrir(page);
  await elegirDeCreaciones(page, TRES);
  await campo(page).fill(PEDIDO);
  await expect(iniciar(page)).toHaveText('Iniciar ✦ 2');
  await iniciar(page).click();
  await expect.poll(() => visto.iniciar.length).toBe(1);
  const cuerpo = visto.iniciar[0]!;
  expect(Object.keys(cuerpo).sort()).toEqual(['instruccion', 'pedido', 'videos']);
  expect(cuerpo.pedido).toMatch(/^[0-9a-f]{32}$/);
  expect(cuerpo.videos).toEqual(['proyecto:entrevista-final', 'proyecto:gen-1a2b3c4d', 'clip:clip-20261008-101500-ab12cd']);
  expect(cuerpo.instruccion).toBe(PEDIDO);
  expect(JSON.stringify(cuerpo)).not.toMatch(/credit|creditos|key|duracion|formato/i);
  // lanzó: la caja queda vacía y lista para otra cosa
  await expect(campo(page)).toHaveValue('');
  await expect(grupo(page)).toHaveCount(0);
  await expect(mas(page)).toHaveAttribute('aria-label', 'Agregar el video que quieres editar');
});

test('una respuesta dudosa (504) conserva la clave del pedido: el reintento manda la MISMA, y no cobra dos veces', async ({ page }) => {
  let llamadas = 0;
  const visto = await abrir(page, {
    iniciar: () => {
      llamadas += 1;
      return llamadas === 1
        ? { status: 504, json: { detail: 'El servidor tardó demasiado en responder.' } }
        : { status: 200, json: { lanzado: true, nombre: COPIA, titulo: 'Entrevista final + 2 más', creditos: 2, n_videos: 3, repetido: true } };
    },
  });
  await elegirDeCreaciones(page, TRES);
  await campo(page).fill(PEDIDO);
  await iniciar(page).click();
  // la caja NO se vacía: no se sabe si cobró, y la clave se conserva
  await expect.poll(() => visto.iniciar.length).toBe(1);
  await expect(bandeja(page).getByRole('alert')).toContainText('El servidor tardó demasiado en responder.');
  await expect(filas(page)).toHaveCount(3);
  await expect(campo(page)).toHaveValue(PEDIDO);
  await expect(iniciar(page)).toHaveText('Iniciar ✦ 2');
  await iniciar(page).click();
  await expect.poll(() => visto.iniciar.length).toBe(2);
  expect(visto.iniciar[1]!.pedido).toBe(visto.iniciar[0]!.pedido);
  await expect(campo(page)).toHaveValue('');
});

test('sin saldo el servidor dice 402: «Te faltan ✦ 1 · Recargar», la caja se queda como estaba y nada se lanzó', async ({ page }) => {
  const visto = await abrir(page, {
    iniciar: () => ({ status: 402, json: { detail: 'Créditos insuficientes: esta acción cuesta 2 créditos y tu saldo es 1.' } }),
  });
  await elegirDeCreaciones(page, TRES);
  await campo(page).fill(PEDIDO);
  await iniciar(page).click();
  await expect.poll(() => visto.iniciar.length).toBe(1);
  // lo que falta lo dice la caja junto al botón (con su «Recargar» solo si la recarga está abierta), y la bandeja no suma un aviso de error
  await expect(page.getByText(/^Te faltan ✦ 1 ·/)).toBeVisible();
  await expect(filas(page)).toHaveCount(3);
  await expect(campo(page)).toHaveValue(PEDIDO);
  await expect(bandeja(page).getByRole('alert')).toHaveCount(0);
});

test('la bandeja de verdad: pasos, «Pediste», «Llevas» que corre solo, el listo con «Abrir el editor» y el error con «Reintentar»', async ({ page }) => {
  const visto = await abrir(page);
  await ponerTrabajos(page, visto, [fichaCorriendo()]);
  await abrirLaBandeja(page);
  const item = bandeja(page).locator('.bj-item.corriendo');
  await expect(item.locator('.bj-tit')).toHaveText('La IA edita Entrevista final + 2 más');
  await expect(item).toContainText('Ordenando tus 3 videos…');
  // el pedido, tal cual lo escribió la persona
  await expect(item.locator('.bj-pedido')).toHaveText(`Pediste: ${PEDIDO}`);
  // los tres pasos, y en cuál va (lo dicen el texto y aria-current, no solo el color)
  const pasos = item.getByRole('list', { name: 'Pasos' }).getByRole('listitem');
  await expect(pasos).toHaveCount(3);
  await expect(pasos.nth(0)).toHaveAttribute('aria-current', 'step');
  await expect(pasos.nth(0)).toContainText('Entender (en curso)');
  await expect(pasos.nth(1)).toContainText('Editar (pendiente)');
  // «Llevas m:ss» lo mueve un reloj, sin repintar (la lista de pasos es el MISMO nodo)
  const llevas = item.locator('[data-llevas]');
  await expect(llevas).toHaveText(/^2:\d\d$/);
  const lista = await item.locator('ul.pasos').elementHandle();
  const antes = (await llevas.textContent())!;
  await expect(llevas).not.toHaveText(antes, { timeout: 5000 });
  expect(await lista!.evaluate(e => e.isConnected)).toBe(true);
  await expect(item).toContainText('Puedes cerrar esta pestaña: sigue en la nube.');
  // el paso avanza
  await ponerTrabajos(page, visto, [fichaCorriendo('editar')]);
  await expect(pasos.nth(0)).toContainText('Entender (hecho)');
  await expect(pasos.nth(1)).toHaveAttribute('aria-current', 'step');

  // listo: «Abrir el editor» lleva a la copia, y solo hay «Cerrar» (la ✕ de siempre ya no está)
  await ponerTrabajos(page, visto, [fichaLista()]);
  const listo = bandeja(page).locator('.bj-item.listo');
  await expect(listo.locator('.bj-tit')).toHaveText('Tu video editado está listo');
  await expect(listo).toContainText('Unimos 3 videos · 10:54 → 10:21');
  await expect(listo).toContainText('Ábrelo en el editor para revisar los cortes y renderizarlo.');
  await expect(listo.getByRole('link', { name: 'Abrir el editor' })).toHaveAttribute('href', `/editor/${COPIA}/`);
  await expect(listo.getByRole('button', { name: 'Cerrar' })).toBeVisible();
  await expect(listo.locator('.bj-ic')).toHaveCount(0);
  await listo.getByRole('button', { name: 'Cerrar' }).click();
  await expect(bandeja(page).locator('.bj-item.listo')).toHaveCount(0);

  // error: en tres partes, con «Reintentar» (que vuelve a cobrar lo que dice «Qué sigue») y «Cerrar»
  await ponerTrabajos(page, visto, [fichaError()]);
  const fallo = bandeja(page).locator('.bj-item.error');
  await expect(fallo).toHaveAttribute('role', 'alert');
  await expect(fallo.locator('dt')).toHaveText(['Qué pasó', 'Tus créditos', 'Qué sigue']);
  await expect(fallo.locator('dd').nth(0)).toHaveText('Falló el paso «Editar» al unir tus 3 videos, de nuestro lado.');
  await expect(fallo.locator('dd').nth(1)).toHaveText('Te devolvimos ✦ 2.');
  await expect(fallo.locator('dd').nth(2)).toHaveText('Tus videos originales no se tocaron. Reintentar vuelve a cobrar ✦ 2.');
  await expect(fallo.getByRole('button', { name: 'Cerrar' })).toBeVisible();
  const peticion = page.waitForRequest(r => r.url().endsWith(`/api/edicion/${COPIA}/reintentar`) && r.method() === 'POST');
  await fallo.getByRole('button', { name: 'Reintentar' }).click();
  await peticion;
  expect(visto.reintentar).toHaveLength(1);
});

// ---------------------------------------------------------------------------------------------------- teléfono

for (const ancho of [390, 320]) {
  test.describe(`a ${ancho} px`, () => {
    test.use({ viewport: { width: ancho, height: 800 } });

    test('la caja con tres videos no se sale de la pantalla y todo lo tocable mide al menos 44 × 44 px', async ({ page }) => {
      await abrir(page);
      await elegirDeCreaciones(page, TRES);
      await campo(page).fill('Únelos');
      await expect(iniciar(page)).toHaveText('Iniciar ✦ 2');
      expect(await sobraAncho(page), 'la página se desplaza de lado').toBeLessThanOrEqual(0);
      const g = (await grupo(page).boundingBox())!;
      expect(g.x).toBeGreaterThanOrEqual(0);
      expect(g.x + g.width).toBeLessThanOrEqual(ancho);
      for (const titulo of TRES) {
        for (const nombre of [`Subir “${titulo}”`, `Bajar “${titulo}”`, `Quitar “${titulo}”`]) {
          await tocable(grupo(page).getByRole('button', { name: nombre }), ancho, nombre);
        }
        // la fila misma también es de 44 px o más
        expect((await filas(page).filter({ hasText: titulo }).boundingBox())!.height, titulo).toBeGreaterThanOrEqual(44);
        // el nombre del video se lee entero (unos 15 letras, ~120 px): a 320 px los tres botones pasan a la línea de abajo en vez de aplastarlo
        expect((await filas(page).filter({ hasText: titulo }).locator('b').boundingBox())!.width, `${titulo}: su nombre se aplasta`).toBeGreaterThanOrEqual(120);
      }
      await tocable(mas(page), ancho, 'el «+»');
      await tocable(page.locator('button[aria-haspopup="listbox"]'), ancho, 'el chip «Editar ▾»');
      await tocable(iniciar(page), ancho, 'Iniciar');
      // el menú del «+» abierto cabe en la pantalla (con la unión armada se abre hacia arriba)
      await mas(page).click();
      const m = (await menu(page).boundingBox())!;
      expect(m.x).toBeGreaterThanOrEqual(0);
      expect(m.x + m.width).toBeLessThanOrEqual(ancho);
      expect(m.y).toBeGreaterThanOrEqual(0);
      for (const item of await menu(page).getByRole('menuitem').all()) expect((await item.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      expect(await sobraAncho(page)).toBeLessThanOrEqual(0);
    });

    test('la hoja «Agregar videos» cabe: sin desplazamiento de lado, tarjetas y botones de 44 px, «Usar» a la vista', async ({ page }) => {
      await abrir(page);
      await abrirLaHoja(page);
      await tarjeta(page, 'El tren de papel').click();
      await tarjeta(page, 'Entrevista final').click();
      const d = (await hoja(page).boundingBox())!;
      expect(d.x, 'la hoja se sale por la izquierda').toBeGreaterThanOrEqual(0);
      expect(d.x + d.width, 'la hoja se sale por la derecha').toBeLessThanOrEqual(ancho);
      expect(d.y).toBeGreaterThanOrEqual(0);
      expect(d.y + d.height, 'la hoja se sale por abajo').toBeLessThanOrEqual(800);
      expect(await sobraAncho(page)).toBeLessThanOrEqual(0);
      expect(await hoja(page).evaluate(e => e.scrollWidth - e.clientWidth), 'la hoja se desplaza de lado').toBeLessThanOrEqual(0);
      for (const t of ['El tren de papel', 'Entrevista final', 'Perro en la playa']) {
        const caja = (await tarjeta(page, t).boundingBox())!;
        expect(caja.height, t).toBeGreaterThanOrEqual(44);
        expect(caja.x + caja.width, t).toBeLessThanOrEqual(ancho);
      }
      // los botones del pie: a la vista sin desplazar y de 44 px
      await tocable(hoja(page).getByRole('button', { name: 'Usar 2 videos' }), ancho, 'Usar 2 videos');
      await tocable(hoja(page).getByRole('button', { name: 'Cancelar' }), ancho, 'Cancelar');
      for (const pestana of await hoja(page).getByRole('tab').all()) expect((await pestana.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    });
  });
}

test('un video marcado conserva su borde ámbar con el ratón encima (justo después de pulsar el puntero sigue ahí)', async ({ page }) => {
  await abrir(page);
  await abrirLaHoja(page);
  const borde = (l: Locator) => l.evaluate(e => getComputedStyle(e).borderTopColor);
  const sinMarcar = tarjeta(page, 'Entrevista final');
  const reposo = await borde(sinMarcar);
  await sinMarcar.hover();
  const alPasarElRaton = await borde(sinMarcar);
  expect(alPasarElRaton, 'lo que NO está marcado cambia de borde al pasar el ratón').not.toBe(reposo);
  await sinMarcar.click(); // el puntero se queda encima, como en la vida real
  const marcado = tarjeta(page, 'Entrevista final');
  await expect(marcado).toHaveAttribute('aria-pressed', 'true');
  const conRaton = await borde(marcado);
  await page.mouse.move(0, 0);
  const sinRaton = await borde(marcado);
  expect(sinRaton, 'el ámbar de «elegido» no es el borde de reposo ni el de pasar el ratón').not.toBe(reposo);
  expect(sinRaton).not.toBe(alPasarElRaton);
  expect(conRaton, 'con el ratón encima sigue siendo el ámbar de «elegido»').toBe(sinRaton);
});

// La hoja en teléfonos de altura de verdad (H1): con 800 px de alto todo cabía, pero en un iPhone SE o con las barras de Safari la hoja
// medía más que la ventana y, centrada y sin desplazamiento, perdía arriba el título y la ✕ y abajo «Usar». Aquí NO se acomoda la
// ventana a la hoja: se mide con las alturas que traen los teléfonos.
const TELEFONOS: Array<[string, number, number]> = [
  ['un iPhone SE', 320, 568],
  ['Safari con sus barras', 375, 553],
  ['un Android común', 360, 640],
  ['un iPhone con barras', 390, 664],
];

/** ¿Se ve ENTERO dentro de la ventana, sin desplazar nada? */
async function seVeEntero(l: Locator, ancho: number, alto: number, nombre: string) {
  const c = (await l.boundingBox())!;
  expect(c, nombre).not.toBeNull();
  expect(c.y, `${nombre}: se corta por arriba`).toBeGreaterThanOrEqual(0);
  expect(c.y + c.height, `${nombre}: se corta por abajo`).toBeLessThanOrEqual(alto);
  expect(c.x, `${nombre}: se corta por la izquierda`).toBeGreaterThanOrEqual(0);
  expect(c.x + c.width, `${nombre}: se corta por la derecha`).toBeLessThanOrEqual(ancho);
}

for (const [telefono, ancho, alto] of TELEFONOS) {
  test.describe(`en ${telefono} (${ancho} × ${alto})`, () => {
    test.use({ viewport: { width: ancho, height: alto } });

    test('la hoja «Agregar videos» entra entera: el título, la ✕, la lista y «Usar» se ven sin desplazar la ventana', async ({ page }) => {
      await abrir(page);
      await abrirLaHoja(page);
      await tarjeta(page, 'El tren de papel').click();
      await tarjeta(page, 'Entrevista final').click();
      await seVeEntero(hoja(page), ancho, alto, 'la hoja');
      await seVeEntero(hoja(page).getByRole('heading', { name: 'Agregar videos' }), ancho, alto, 'el título');
      await seVeEntero(hoja(page).getByRole('button', { name: 'Cerrar' }), ancho, alto, 'la ✕');
      await seVeEntero(hoja(page).getByRole('button', { name: 'Usar 2 videos' }), ancho, alto, 'Usar 2 videos');
      await seVeEntero(hoja(page).getByRole('button', { name: 'Cancelar' }), ancho, alto, 'Cancelar');
      // y lo que cede es la LISTA (se desplaza por dentro), no la hoja
      expect(await hoja(page).evaluate(e => e.scrollHeight - e.clientHeight), 'la hoja se desplaza: tuvo que ceder la lista').toBeLessThanOrEqual(0);
    });
  });
}

test.describe('en un teléfono de lado (568 × 320)', () => {
  test.use({ viewport: { width: 568, height: 320 } });

  test('la hoja no cabe entera, pero se desplaza: el título, la ✕ y «Usar» se alcanzan y «Usar» agrega lo marcado', async ({ page }) => {
    await abrir(page);
    await abrirLaHoja(page);
    await tarjeta(page, 'El tren de papel').click();
    await tarjeta(page, 'Entrevista final').click();
    const d = (await hoja(page).boundingBox())!;
    expect(d.y, 'la hoja se corta por arriba').toBeGreaterThanOrEqual(0);
    expect(d.y + d.height, 'la hoja se corta por abajo').toBeLessThanOrEqual(320);
    // el pie se queda pegado abajo: «Usar» se ve sin desplazar nada, y sigue a la vista aunque la hoja se desplace hasta el título
    await seVeEntero(hoja(page).getByRole('button', { name: 'Usar 2 videos' }), 568, 320, 'Usar 2 videos');
    await hoja(page).getByRole('heading', { name: 'Agregar videos' }).scrollIntoViewIfNeeded({ timeout: 3000 });
    await seVeEntero(hoja(page).getByRole('heading', { name: 'Agregar videos' }), 568, 320, 'el título');
    await seVeEntero(hoja(page).getByRole('button', { name: 'Usar 2 videos' }), 568, 320, 'Usar 2 videos, con la hoja desplazada hasta arriba');
    await hoja(page).getByRole('button', { name: 'Usar 2 videos' }).click({ timeout: 3000 });
    await expect(hoja(page)).toHaveCount(0);
    await expect(filas(page)).toHaveCount(2);
  });
});

test('el menú del «+» y la hoja en un escritorio de 1100 px: cabe, y la unión no pasa de su ancho', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 900 });
  await abrir(page);
  await mas(page).click();
  const m = (await menu(page).boundingBox())!;
  expect(m.x + m.width).toBeLessThanOrEqual(1100);
  await menu(page).getByRole('menuitem', { name: /Elegir de Mis creaciones/ }).click();
  await expect(hoja(page)).toBeVisible();
  const d = (await hoja(page).boundingBox())!;
  expect(d.x).toBeGreaterThanOrEqual(0);
  expect(d.x + d.width).toBeLessThanOrEqual(1100);
  await tarjeta(page, 'El tren de papel').click();
  await tarjeta(page, 'Entrevista final').click();
  await hoja(page).getByRole('button', { name: 'Usar 2 videos' }).click();
  const g = (await grupo(page).boundingBox())!;
  expect(g.width).toBeLessThanOrEqual(560);
  expect(await sobraAncho(page)).toBeLessThanOrEqual(0);
});

// ---------------------------------------------------------------------------------------------------- movimiento reducido

test.describe('con «reducir movimiento»', () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' } });

  test('el menú, la hoja, marcar, reordenar y subir: nada se queda moviéndose', async ({ page }) => {
    await abrir(page, { cotizar: refs => cotizacion(refs), subidaMs: 1500 });
    expect(await page.evaluate(animacionesVivas)).toEqual([]);
    await mas(page).click();
    await expect(menu(page)).toBeVisible();
    await page.waitForTimeout(400);
    expect(await page.evaluate(animacionesVivas)).toEqual([]);
    await menu(page).getByRole('menuitem', { name: /Elegir de Mis creaciones/ }).click();
    await expect(hoja(page)).toBeVisible();
    await tarjeta(page, 'El tren de papel').click();
    await tarjeta(page, 'Entrevista final').click();
    await page.waitForTimeout(400);
    expect(await page.evaluate(animacionesVivas)).toEqual([]);
    await hoja(page).getByRole('button', { name: 'Usar 2 videos' }).click();
    await expect(grupo(page)).toBeVisible();
    await grupo(page).getByRole('button', { name: 'Bajar “El tren de papel”' }).click();
    await page.locator('input[type="file"]').setInputFiles(ARCHIVO_A);
    await expect(filas(page)).toHaveCount(3);
    await page.waitForTimeout(400);
    expect(await page.evaluate(animacionesVivas)).toEqual([]);
  });
});
