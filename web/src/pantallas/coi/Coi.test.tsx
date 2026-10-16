// COI, como COMPORTAMIENTO, con el API de mentira: el modelo, la moderación y la Biblioteca NO se llaman de verdad (no cuesta nada).
// Cada test empieza por el ID de su invariante (tests/test_migracion_ui.py).
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MENU, buscar } from '../../marca/menu';
import { json, llamadas, servidor, sinRed, type Ruta } from '../../prueba/servidor';
import { Coi } from './Coi';
import type { Coi as CoiRespuesta } from './logica';

const SE_RENUEVA = '2026-10-17T00:00:00-06:00';
const TEXTO = 'Necesito un guion para presentar mi lámpara en 30 segundos';

const MUESTRA: CoiRespuesta = {
  contexto: 'Necesito un guion para presentar un producto en video.\nSuposición: no dijiste cuál es el producto; uso [PRODUCTO].',
  objetivo: 'Escribir un guion de 75 palabras. Que se lea en 30 segundos.',
  instrucciones: [
    '1. Definición del objetivo primario',
    '   * Actúa como guionista.',
    '2. Datos iniciales',
    '   * Nombre del producto.',
    '3. Estrategia',
    '   * Gancho y cierre.',
    '4. Criterios de validación',
    '   * Máximo 80 palabras.',
    '5. Reglas de desambiguación',
    '   * Elige la más corta.',
    '6. Formato de salida',
    '   * Dos columnas.',
    '7. Restricciones',
    '   * Sin inventar datos.',
  ].join('\n'),
  completo: 'texto completo del modelo',
  estructura_ok: true,
};

const estado = (usos = 0, extra: Record<string, unknown> = {}) => ({
  tope: 3,
  usos,
  quedan: Math.max(0, 3 - usos),
  renueva_en_s: 19200,
  se_renueva: SE_RENUEVA,
  en_curso: false,
  gratis: true,
  ...extra,
});

const respuesta = (usos: number, coi: CoiRespuesta = MUESTRA, idioma: 'es' | 'en' = 'es', extra: Record<string, unknown> = {}) => ({
  coi,
  idioma,
  tope: 3,
  usos,
  quedan: 3 - usos,
  renueva_en_s: 19100,
  se_renueva: SE_RENUEVA,
  ...extra,
});

const fallo = (status: number, codigo: string, texto: string, extra: Record<string, unknown> = {}) =>
  json({ detail: { codigo, texto, ...extra } }, status);

interface Guion {
  estado?: Ruta;
  armar?: Ruta;
  guardar?: Ruta;
}

/** El servidor de COI: el contador lo lleva este doble, como lo llevaría el de verdad. */
function coi(g: Guion = {}, usosIniciales = 0) {
  let usos = usosIniciales;
  return servidor({
    '/api/coi/estado': g.estado ?? (() => json(estado(usos))),
    '/api/coi': g.armar ?? (() => json(respuesta(++usos))),
    '/api/biblioteca/mios': g.guardar ?? ((_u, init) => {
      const p = JSON.parse(String(init?.body)) as { titulo: string; prompt: string; categoria: string };
      return json({ prompt: { id: 'mio-0123456789ab', titulo: p.titulo, categoria: p.categoria } }, 201);
    }),
  });
}

const cuadro = () => screen.getByRole('textbox', { name: 'Cuéntale qué necesitas' });
const boton = () => screen.getByRole('button', { name: /^Armar (otro )?COI$|^Armando…$/ });
const contador = () => document.getElementById('coi-cont')!;
const cuerpos = (f: ReturnType<typeof servidor>, ruta: string) => llamadas(f, ruta).map(c => JSON.parse(String(c[1]?.body)) as Record<string, unknown>);

/** El cuadro «Ya usaste tus 3 COI de hoy» (el contador de arriba también dice «Se renuevan…», en corto). */
const cuadroAgotado = () => document.getElementById('coi-agota')!;

async function esperarContador(texto: string) {
  await waitFor(() => expect(contador()).toHaveTextContent(texto));
}

async function armarConTexto(u: ReturnType<typeof userEvent.setup>, texto = TEXTO) {
  await u.click(cuadro());
  await u.paste(texto);
  await u.click(boton());
}

beforeEach(() => {
  vi.unstubAllGlobals();
  document.title = 'Estudio de video · COI';
});
afterEach(() => {
  vi.useRealTimers();
  delete window.monedero;
});

describe('coi', () => {
  // ---------------------------------------------------------------- contador
  it('coi.contador.dice_cuantos_quedan_con_lo_que_dice_el_servidor', async () => {
    for (const [usos, texto, sub] of [
      [0, 'Te quedan 3 de 3 hoy', 'Gratis por ahora. Solo cuentan los COI que terminan bien.'],
      [1, 'Te quedan 2 de 3 hoy', 'Gratis por ahora. Solo cuentan los COI que terminan bien.'],
      [2, 'Te queda 1 de 3 hoy', 'Es el último de hoy. Solo cuentan los COI que terminan bien.'],
      [3, 'Ya usaste tus 3 de hoy', 'Se renuevan a la medianoche, hora de México.'],
    ] as const) {
      coi({ estado: () => json(estado(usos)) });
      const { unmount } = render(<Coi />);
      await esperarContador(texto);
      expect(screen.getByText(sub)).toBeInTheDocument();
      // `aria-live` para el contador
      expect(contador()).toHaveAttribute('aria-live', 'polite');
      unmount();
    }
  });

  it('coi.contador.el_faltan_sale_de_renueva_en_s_del_servidor_y_no_del_reloj_del_navegador', async () => {
    // el reloj del navegador dice que faltan 10 minutos para la medianoche local: el texto no lo mira
    vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date('2026-10-16T23:50:00-06:00') });
    coi({ estado: () => json(estado(3, { renueva_en_s: 19200 })) });
    render(<Coi />);
    await esperarContador('Ya usaste tus 3 de hoy');
    expect(cuadroAgotado()).toHaveTextContent('Se renuevan a la medianoche, hora de México (12:00 a. m.). Faltan 5 h 20 min.');
  });

  it('coi.contador.ya_usaste_los_3_se_vuelve_a_preguntar_cada_minuto_y_el_faltan_lo_dice_el_servidor', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let renueva = 19200;
    const f = coi({ estado: () => json(estado(3, { renueva_en_s: renueva })) });
    render(<Coi />);
    await esperarContador('Ya usaste tus 3 de hoy');
    expect(cuadroAgotado()).toHaveTextContent('Faltan 5 h 20 min.');
    const antes = llamadas(f, '/api/coi/estado', 'GET').length;
    renueva = 19140;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(llamadas(f, '/api/coi/estado', 'GET').length).toBeGreaterThan(antes);
    await waitFor(() => expect(cuadroAgotado()).toHaveTextContent('Faltan 5 h 19 min.'));
  });

  it('coi.contador.al_cumplirse_el_plazo_del_servidor_se_vuelve_a_preguntar_y_la_entrada_se_enciende', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let usos = 3;
    const f = coi({ estado: () => json(estado(usos, { renueva_en_s: 120 })) });
    render(<Coi />);
    await esperarContador('Ya usaste tus 3 de hoy');
    expect(cuadro()).toHaveAttribute('readonly');
    const antes = llamadas(f, '/api/coi/estado', 'GET').length;
    usos = 0; // pasó la medianoche de México
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000 + 2000);
    });
    expect(llamadas(f, '/api/coi/estado', 'GET').length).toBeGreaterThan(antes);
    await esperarContador('Te quedan 3 de 3 hoy');
    expect(cuadro()).not.toHaveAttribute('readonly');
    expect(boton()).not.toHaveAttribute('aria-disabled', 'true');
  });

  it('coi.contador.sin_poder_leerlo_falla_cerrado_y_reintentar_vuelve_a_preguntar', async () => {
    const u = userEvent.setup();
    let bien = false;
    coi({ estado: () => (bien ? json(estado(0)) : fallo(503, 'no_disponible', 'COI no está disponible en este momento.')) });
    render(<Coi />);
    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent('COI no está disponible ahora');
    expect(alerta).toHaveTextContent('COI no está disponible en este momento.');
    expect(alerta).toHaveTextContent('No se gastó ninguno de tus usos.');
    // sin contador no se arma nada: apagado y sin mandar
    expect(boton()).toHaveAttribute('aria-disabled', 'true');
    bien = true;
    await u.click(within(alerta).getByRole('button', { name: 'Reintentar' }));
    await esperarContador('Te quedan 3 de 3 hoy');
    expect(screen.queryByRole('alert')).toBeNull();
    // el foco no cae al body: el aviso se fue y el foco pasa al cuadro
    expect(cuadro()).toHaveFocus();
    expect(boton()).not.toHaveAttribute('aria-disabled', 'true');
  });

  // ---------------------------------------------------------------- armar
  it('coi.armar.manda_el_texto_recortado_una_sola_vez_aunque_se_pulse_dos_veces', async () => {
    const u = userEvent.setup();
    let soltar!: (r: Response) => void;
    const f = coi({ armar: () => new Promise<Response>(r => (soltar = r)) });
    render(<Coi />);
    await esperarContador('Te quedan 3 de 3 hoy');
    await u.click(cuadro());
    await u.paste(`   ${TEXTO}  \n`);
    await u.click(boton());
    await u.click(screen.getByRole('button', { name: 'Armando…' }));
    await u.click(screen.getByRole('button', { name: 'Armando…' }));
    expect(cuerpos(f, '/api/coi')).toEqual([{ texto: TEXTO }]);
    soltar(json(respuesta(1)));
    expect(await screen.findByRole('heading', { name: 'Tu COI' })).toBeInTheDocument();
    expect(llamadas(f, '/api/coi')).toHaveLength(1);
  });

  it('coi.armar.sin_texto_no_manda_y_lo_dice_junto_al_campo', async () => {
    const u = userEvent.setup();
    const f = coi();
    render(<Coi />);
    await esperarContador('Te quedan 3 de 3 hoy');
    await u.click(boton());
    expect(await screen.findByRole('alert')).toHaveTextContent('Escribe primero qué necesitas, aunque sea en una frase.');
    expect(cuadro()).toHaveFocus();
    expect(cuadro()).toHaveAttribute('aria-invalid', 'true');
    expect(llamadas(f, '/api/coi')).toHaveLength(0);
    // solo espacios es lo mismo que nada
    await u.paste('    ');
    await u.click(boton());
    expect(llamadas(f, '/api/coi')).toHaveLength(0);
    // escribir quita el error
    await u.paste('hola');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('coi.armar.ctrl_o_cmd_intro_envian_desde_el_cuadro', async () => {
    const u = userEvent.setup();
    const f = coi();
    render(<Coi />);
    await esperarContador('Te quedan 3 de 3 hoy');
    expect(cuadro()).toHaveAttribute('aria-keyshortcuts', 'Control+Enter Meta+Enter');
    await u.click(cuadro());
    await u.paste(TEXTO);
    await u.keyboard('{Control>}{Enter}{/Control}');
    expect(await screen.findByRole('heading', { name: 'Tu COI' })).toBeInTheDocument();
    await u.click(cuadro());
    await u.keyboard('{Meta>}{Enter}{/Meta}');
    await waitFor(() => expect(llamadas(f, '/api/coi')).toHaveLength(2));
  });

  it('coi.armar.mas_de_2000_caracteres_no_se_manda_y_dice_cuantos_lleva', async () => {
    const u = userEvent.setup();
    const f = coi();
    render(<Coi />);
    await esperarContador('Te quedan 3 de 3 hoy');
    await u.click(cuadro());
    await u.paste('a'.repeat(2001));
    expect(screen.getByText(/el máximo es de 2000 caracteres y llevas 2001/)).toBeInTheDocument();
    expect(boton()).toHaveAttribute('aria-disabled', 'true');
    expect(boton()).toHaveAttribute('aria-describedby', 'coi-largo');
    await u.click(boton());
    expect(llamadas(f, '/api/coi')).toHaveLength(0);
    // 2000 justos sí se manda
    await u.clear(cuadro());
    await u.paste('b'.repeat(2000));
    expect(screen.queryByText(/el máximo es de 2000/)).toBeNull();
    await u.click(boton());
    await waitFor(() => expect(llamadas(f, '/api/coi')).toHaveLength(1));
  });

  it('coi.armar.generando_dice_armando_sin_pasos_falsos_y_el_contador_no_baja_hasta_terminar', async () => {
    const u = userEvent.setup();
    let soltar!: (r: Response) => void;
    coi({ armar: () => new Promise<Response>(r => (soltar = r)) });
    render(<Coi />);
    await esperarContador('Te quedan 3 de 3 hoy');
    await armarConTexto(u);
    expect(screen.getByRole('heading', { name: 'Armando tu COI…' })).toBeInTheDocument();
    expect(screen.getByText(/No se gasta ninguno hasta que termine bien/)).toBeInTheDocument();
    // sin pasos falsos: ni lista, ni «paso 1 de 3», ni barra de progreso
    expect(screen.queryByRole('list', { name: /paso/i })).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
    const b = screen.getByRole('button', { name: 'Armando…' });
    expect(b).toHaveAttribute('aria-busy', 'true');
    expect(b).toHaveAttribute('aria-disabled', 'true');
    expect(b).not.toBeDisabled(); // `aria-disabled` y no `disabled`: el foco se queda en el botón
    expect(b).toHaveFocus();
    expect(cuadro()).toHaveAttribute('readonly');
    expect(contador()).toHaveTextContent('Te quedan 3 de 3 hoy');
    expect(document.title).toBe('Armando tu COI · Estudio de video · COI');
    soltar(json(respuesta(1)));
    await esperarContador('Te quedan 2 de 3 hoy');
    expect(document.title).toBe('Estudio de video · COI');
    expect(cuadro()).not.toHaveAttribute('readonly');
  });

  it('coi.armar.el_foco_va_al_encabezado_del_resultado_y_lo_anuncia', async () => {
    const u = userEvent.setup();
    coi();
    render(<Coi />);
    await esperarContador('Te quedan 3 de 3 hoy');
    await armarConTexto(u);
    const h = await screen.findByRole('heading', { name: 'Tu COI' });
    await waitFor(() => expect(h).toHaveFocus());
    expect(screen.getByText('Tu COI está listo, en tres bloques: contexto, objetivo e instrucciones.')).toBeInTheDocument();
    expect(boton()).toHaveTextContent('Armar otro COI');
  });

  it('coi.armar.un_ejemplo_llena_el_cuadro_deja_el_foco_en_el_y_esconde_los_ejemplos', async () => {
    const u = userEvent.setup();
    coi();
    render(<Coi />);
    await esperarContador('Te quedan 3 de 3 hoy');
    const lista = screen.getByRole('list', { name: 'Ejemplos para empezar' });
    expect(within(lista).getAllByRole('button')).toHaveLength(4);
    await u.click(within(lista).getByRole('button', { name: 'Ideas de imágenes para una campaña de verano' }));
    expect(cuadro()).toHaveValue('Ideas de imágenes para una campaña de verano');
    expect(cuadro()).toHaveFocus();
    expect(screen.queryByRole('list', { name: 'Ejemplos para empezar' })).toBeNull();
  });

  // ---------------------------------------------------------------- resultado
  it('coi.resultado.tres_tarjetas_con_sus_encabezados_y_las_siete_partes_de_las_instrucciones', async () => {
    const u = userEvent.setup();
    coi();
    render(<Coi />);
    await esperarContador('Te quedan 3 de 3 hoy');
    await armarConTexto(u);
    await screen.findByRole('heading', { name: 'Tu COI' });
    for (const n of ['#CONTEXTO', '#OBJETIVO', '#INSTRUCCIONES'])
      expect(screen.getByRole('button', { name: new RegExp(`^${n}`) })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Escribir un guion de 75 palabras. Que se lea en 30 segundos.')).toBeInTheDocument();
    const partes = within(document.querySelector('[data-bloque="ins"]') as HTMLElement).getAllByRole('listitem');
    expect(partes).toHaveLength(7);
    expect(partes[0]).toHaveTextContent('1Definición del objetivo primarioActúa como guionista.');
    expect(partes[6]).toHaveTextContent('7RestriccionesSin inventar datos.');
    // la suposición va marcada, sin el «Suposición:» repetido
    expect(screen.getByText('Suposición', { exact: true })).toBeInTheDocument();
    expect(screen.getByText('no dijiste cuál es el producto; uso [PRODUCTO].')).toBeInTheDocument();
  });

  it('coi.resultado.lo_que_dice_el_modelo_se_pinta_como_texto_nunca_como_html', async () => {
    const u = userEvent.setup();
    const malo = '<img src=x onerror=alert(1)> <b>negrita</b>';
    coi({
      armar: () => json(respuesta(1, { ...MUESTRA, objetivo: malo, contexto: `<script>alert(2)</script>`, instrucciones: `1. ${malo}\n   * <i>x</i>\n2. B\n   * c` })),
    });
    render(<Coi />);
    await esperarContador('Te quedan 3 de 3 hoy');
    await armarConTexto(u);
    await screen.findByRole('heading', { name: 'Tu COI' });
    expect(screen.getByText(malo, { exact: false, selector: 'p' })).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
    expect(document.querySelector('script')).toBeNull();
    expect([...document.querySelectorAll('main b')].some(b => b.textContent === 'negrita')).toBe(false);
  });

  it('coi.resultado.plegar_una_tarjeta_plegar_todo_y_abrir_todo', async () => {
    const u = userEvent.setup();
    coi();
    render(<Coi />);
    await esperarContador('Te quedan 3 de 3 hoy');
    await armarConTexto(u);
    await screen.findByRole('heading', { name: 'Tu COI' });
    const cuerpo = (c: string) => document.getElementById(`coi-bq-${c}`)!;
    await u.click(screen.getByRole('button', { name: /^#OBJETIVO/ }));
    expect(cuerpo('obj')).not.toBeVisible();
    expect(screen.getByRole('button', { name: /^#OBJETIVO/ })).toHaveAttribute('aria-expanded', 'false');
    expect(cuerpo('ctx')).toBeVisible();
    // con uno plegado, el botón de arriba ofrece abrir todo; con todo abierto, plegar todo
    await u.click(screen.getByRole('button', { name: 'Abrir todo' }));
    for (const c of ['ctx', 'obj', 'ins']) expect(cuerpo(c)).toBeVisible();
    await u.click(screen.getByRole('button', { name: 'Plegar todo' }));
    for (const c of ['ctx', 'obj', 'ins']) expect(cuerpo(c)).not.toBeVisible();
    // el foco se queda en el botón (que ahora dice «Abrir todo»), nunca cae al body
    expect(screen.getByRole('button', { name: 'Abrir todo' })).toHaveFocus();
  });

  it('coi.resultado.copiar_un_bloque_y_copiar_todo_copian_el_texto_tal_cual_sin_mover_el_foco', async () => {
    const u = userEvent.setup();
    coi();
    render(<Coi />);
    await esperarContador('Te quedan 3 de 3 hoy');
    await armarConTexto(u);
    await screen.findByRole('heading', { name: 'Tu COI' });
    await u.click(screen.getByRole('button', { name: 'Copiar el bloque #OBJETIVO' }));
    const b = await screen.findByRole('button', { name: 'Copiado: el bloque #OBJETIVO' });
    expect(b).toHaveFocus();
    expect(b).toHaveTextContent('Copiado');
    expect(await navigator.clipboard.readText()).toBe(`#OBJETIVO\n${MUESTRA.objetivo}`);
    await u.click(screen.getByRole('button', { name: 'Copiar todo el COI' }));
    expect(await navigator.clipboard.readText()).toBe(
      `#CONTEXTO\n${MUESTRA.contexto}\n\n#OBJETIVO\n${MUESTRA.objetivo}\n\n#INSTRUCCIONES\n${MUESTRA.instrucciones}`,
    );
    expect(await screen.findByRole('button', { name: 'Copiado: todo el COI' })).toHaveFocus();
    expect(screen.getByText('Copiado: el COI completo.', { selector: 'p' })).toBeInTheDocument();
  });

  it('coi.resultado.si_el_navegador_no_deja_copiar_deja_el_texto_seleccionado_y_lo_dice', async () => {
    const u = userEvent.setup();
    coi();
    render(<Coi />);
    await esperarContador('Te quedan 3 de 3 hoy');
    await armarConTexto(u);
    await screen.findByRole('heading', { name: 'Tu COI' });
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('negado'));
    document.execCommand = vi.fn(() => false);
    await u.click(screen.getByRole('button', { name: 'Copiar el bloque #CONTEXTO' }));
    expect(await screen.findByText('No pudimos copiar solos. Dejamos el texto seleccionado: cópialo con Ctrl+C.')).toBeInTheDocument();
    expect(window.getSelection()?.toString()).toContain('Necesito un guion para presentar un producto en video.');
    expect(screen.queryByRole('button', { name: /Copiado/ })).toBeNull();
  });

  it('coi.resultado.sin_estructura_sale_una_sola_tarjeta_con_el_texto_completo_y_copiar', async () => {
    const u = userEvent.setup();
    const completo = 'Aquí va tu prompt.\n\nUsa un tono cercano.';
    coi({ armar: () => json(respuesta(1, { contexto: null, objetivo: null, instrucciones: null, completo, estructura_ok: false })) });
    render(<Coi />);
    await esperarContador('Te quedan 3 de 3 hoy');
    await armarConTexto(u);
    await screen.findByRole('heading', { name: 'Tu COI' });
    expect(document.querySelectorAll('article')).toHaveLength(1);
    expect(screen.getByText('Aquí va tu prompt.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Plegar todo|Abrir todo/ })).toBeNull();
    await u.click(screen.getByRole('button', { name: 'Copiar el COI completo' }));
    expect(await navigator.clipboard.readText()).toBe(completo);
    // esa respuesta SÍ cuenta
    expect(contador()).toHaveTextContent('Te quedan 2 de 3 hoy');
  });

  it('coi.resultado.en_ingles_los_encabezados_van_en_ingles_y_se_copian_asi', async () => {
    const u = userEvent.setup();
    coi({ armar: () => json(respuesta(1, MUESTRA, 'en')) });
    render(<Coi />);
    await esperarContador('Te quedan 3 de 3 hoy');
    await armarConTexto(u, 'I need a script to present a product');
    await screen.findByRole('heading', { name: 'Tu COI' });
    for (const n of ['#CONTEXT', '#OBJECTIVE', '#INSTRUCTIONS']) expect(screen.getByRole('button', { name: new RegExp(`^${n}`) })).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'Copiar el bloque #OBJECTIVE' }));
    expect(await navigator.clipboard.readText()).toBe(`#OBJECTIVE\n${MUESTRA.objetivo}`);
  });

  // ---------------------------------------------------------------- guardar
  it('coi.guardar.abre_la_hoja_con_la_primera_frase_del_objetivo_editable_y_en_80_como_maximo', async () => {
    const u = userEvent.setup();
    coi();
    render(<Coi />);
    await esperarContador('Te quedan 3 de 3 hoy');
    await armarConTexto(u);
    await screen.findByRole('heading', { name: 'Tu COI' });
    await u.click(screen.getByRole('button', { name: 'Guardar' }));
    const hoja = await screen.findByRole('dialog', { name: 'Guardar en tu Biblioteca' });
    const titulo = within(hoja).getByRole('textbox', { name: 'Título' });
    expect(titulo).toHaveValue('Escribir un guion de 75 palabras');
    expect(titulo).toHaveFocus();
    expect(titulo).toHaveAttribute('maxlength', '80');
    expect(within(hoja).getByText(/Guardar no gasta ninguno de tus 3 usos de hoy/)).toBeInTheDocument();
    expect(within(hoja).getByRole('radio', { name: 'Guion y texto' })).toBeChecked();
    expect(within(hoja).getAllByRole('radio').map(r => (r as HTMLInputElement).labels?.[0]?.textContent)).toEqual(['Guion y texto', 'Imagen', 'Video', 'Investigación']);
  });

  it('coi.guardar.manda_titulo_categoria_origen_coi_y_clave_de_32_hex_y_no_gasta_un_uso', async () => {
    const u = userEvent.setup();
    const f = coi();
    render(<Coi />);
    await esperarContador('Te quedan 3 de 3 hoy');
    await armarConTexto(u);
    await screen.findByRole('heading', { name: 'Tu COI' });
    await u.click(screen.getByRole('button', { name: 'Guardar' }));
    const hoja = await screen.findByRole('dialog');
    await u.clear(within(hoja).getByRole('textbox', { name: 'Título' }));
    await u.type(within(hoja).getByRole('textbox', { name: 'Título' }), 'Guion de 30 segundos');
    await u.click(within(hoja).getByRole('radio', { name: 'Video' }));
    await u.click(within(hoja).getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const [p] = cuerpos(f, '/api/biblioteca/mios');
    expect(p).toMatchObject({ titulo: 'Guion de 30 segundos', categoria: 'video', origen: 'coi', para_que: '', etiquetas: [] });
    expect(p!.clave).toMatch(/^[0-9a-f]{32}$/);
    expect(p!.prompt).toBe(`#CONTEXTO\n${MUESTRA.contexto}\n\n#OBJETIVO\n${MUESTRA.objetivo}\n\n#INSTRUCCIONES\n${MUESTRA.instrucciones}`);
    // guardar NO llama al modelo ni gasta un uso
    expect(llamadas(f, '/api/coi')).toHaveLength(1);
    expect(contador()).toHaveTextContent('Te quedan 2 de 3 hoy');
  });

  it('coi.guardar.dice_guardado_en_tu_biblioteca_con_enlace_a_mios_y_el_foco_vuelve_al_boton', async () => {
    const u = userEvent.setup();
    coi();
    render(<Coi />);
    await esperarContador('Te quedan 3 de 3 hoy');
    await armarConTexto(u);
    await screen.findByRole('heading', { name: 'Tu COI' });
    await u.click(screen.getByRole('button', { name: 'Guardar' }));
    await u.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Guardar' }));
    const guardado = await screen.findByRole('button', { name: 'Guardado' });
    await waitFor(() => expect(guardado).toHaveFocus());
    expect(guardado).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Guardado en tu Biblioteca. Solo tú lo ves.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver en Míos' })).toHaveAttribute('href', '/estudio/biblioteca/?ver=mios');
    // ya guardado: otro clic no abre la hoja
    await u.click(guardado);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('coi.guardar.el_reintento_del_mismo_guardado_manda_la_misma_clave_y_un_coi_nuevo_trae_otra', async () => {
    const u = userEvent.setup();
    let intento = 0;
    const f = coi({
      guardar: (_u, init) => {
        const p = JSON.parse(String(init?.body)) as { titulo: string };
        return ++intento === 1 ? sinRed() as never : json({ prompt: { id: 'mio-1', titulo: p.titulo, categoria: 'guion' } }, intento === 2 ? 200 : 201);
      },
    });
    render(<Coi />);
    await esperarContador('Te quedan 3 de 3 hoy');
    await armarConTexto(u);
    await screen.findByRole('heading', { name: 'Tu COI' });
    await u.click(screen.getByRole('button', { name: 'Guardar' }));
    const hoja = await screen.findByRole('dialog');
    await u.click(within(hoja).getByRole('button', { name: 'Guardar' }));
    expect(await within(hoja).findByRole('alert')).toHaveTextContent('No hay conexión');
    await u.click(within(hoja).getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const claves = cuerpos(f, '/api/biblioteca/mios').map(c => c.clave);
    expect(claves).toHaveLength(2);
    expect(claves[1]).toBe(claves[0]);
    // otro COI, otro guardado, otra clave
    await u.click(boton());
    await waitFor(() => expect(contador()).toHaveTextContent('Te queda 1 de 3 hoy'));
    await u.click(screen.getByRole('button', { name: 'Guardar' }));
    await u.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const todas = cuerpos(f, '/api/biblioteca/mios').map(c => c.clave);
    expect(todas).toHaveLength(3);
    expect(todas[2]).not.toBe(todas[0]);
  });

  it('coi.guardar.sin_titulo_no_manda_y_lo_dice_junto_al_campo', async () => {
    const u = userEvent.setup();
    const f = coi();
    render(<Coi />);
    await esperarContador('Te quedan 3 de 3 hoy');
    await armarConTexto(u);
    await screen.findByRole('heading', { name: 'Tu COI' });
    await u.click(screen.getByRole('button', { name: 'Guardar' }));
    const hoja = await screen.findByRole('dialog');
    await u.clear(within(hoja).getByRole('textbox', { name: 'Título' }));
    await u.click(within(hoja).getByRole('button', { name: 'Guardar' }));
    expect(await within(hoja).findByText('Ponle un título para encontrarlo después.')).toBeInTheDocument();
    expect(within(hoja).getByRole('textbox', { name: 'Título' })).toHaveFocus();
    expect(llamadas(f, '/api/biblioteca/mios')).toHaveLength(0);
  });

  it('coi.guardar.un_error_se_dice_en_la_hoja_con_el_texto_del_servidor_y_la_biblioteca_llena_ofrece_borrar', async () => {
    const u = userEvent.setup();
    let lleno = true;
    coi({
      guardar: () =>
        lleno
          ? fallo(409, 'lleno', 'Tu Biblioteca ya tiene 100 prompts. Borra alguno para guardar otro.')
          : fallo(422, 'categoria', 'Esa categoría no existe.'),
    });
    render(<Coi />);
    await esperarContador('Te quedan 3 de 3 hoy');
    await armarConTexto(u);
    await screen.findByRole('heading', { name: 'Tu COI' });
    await u.click(screen.getByRole('button', { name: 'Guardar' }));
    const hoja = await screen.findByRole('dialog');
    await u.click(within(hoja).getByRole('button', { name: 'Guardar' }));
    const alerta = await within(hoja).findByRole('alert');
    expect(alerta).toHaveTextContent('Tu Biblioteca ya tiene 100 prompts. Borra alguno para guardar otro.');
    expect(within(alerta).getByRole('link', { name: 'Abre tu Biblioteca para borrar alguno' })).toHaveAttribute('href', '/estudio/biblioteca/?ver=mios');
    lleno = false;
    await u.click(within(hoja).getByRole('button', { name: 'Guardar' }));
    expect(await within(hoja).findByRole('alert')).toHaveTextContent('Esa categoría no existe.');
    expect(within(hoja).queryByRole('link')).toBeNull();
    // un fallo no marca nada como guardado
    await u.click(within(hoja).getByRole('button', { name: 'Cancelar' }));
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeInTheDocument();
    expect(screen.queryByText(/Guardado en tu Biblioteca/)).toBeNull();
  });

  // ---------------------------------------------------------------- errores y estados
  it('coi.errores.falla_el_modelo_dice_que_no_se_gasto_ninguno_deja_el_texto_y_se_puede_reintentar', async () => {
    const u = userEvent.setup();
    let falla = true;
    let usos = 0;
    coi({
      estado: () => json(estado(usos)),
      armar: () => (falla ? fallo(502, 'modelo', 'No pudimos armar tu COI ahora. No se gastó ninguno de tus usos.') : json(respuesta(++usos))),
    });
    render(<Coi />);
    await esperarContador('Te quedan 3 de 3 hoy');
    await armarConTexto(u);
    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent('Algo falló de nuestro lado');
    expect(alerta).toHaveTextContent('No pudimos armar tu COI ahora. No se gastó ninguno de tus usos.');
    expect(alerta).toHaveTextContent('Tu texto sigue en el cuadro.');
    expect(cuadro()).toHaveValue(TEXTO);
    expect(contador()).toHaveTextContent('Te quedan 3 de 3 hoy');
    expect(boton()).toHaveFocus();
    falla = false;
    await u.click(boton());
    expect(await screen.findByRole('heading', { name: 'Tu COI' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(contador()).toHaveTextContent('Te quedan 2 de 3 hoy');
  });

  it('coi.errores.tardo_lo_dice_y_no_gasta_ninguno', async () => {
    const u = userEvent.setup();
    coi({ armar: () => fallo(504, 'tardo', 'Tardó demasiado en responder. No se gastó ninguno de tus usos.') });
    render(<Coi />);
    await esperarContador('Te quedan 3 de 3 hoy');
    await armarConTexto(u);
    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent('Tardó demasiado');
    expect(alerta).toHaveTextContent('No se gastó ninguno de tus usos.');
    expect(contador()).toHaveTextContent('Te quedan 3 de 3 hoy');
  });

  it('coi.errores.moderacion_dice_el_motivo_del_servidor_junto_al_cuadro_lleva_el_foco_y_se_quita_al_escribir', async () => {
    const u = userEvent.setup();
    coi({ armar: () => fallo(422, 'moderacion', 'No se gastó ninguno de tus usos. Motivo: contenido que acosa a otra persona.') });
    render(<Coi />);
    await esperarContador('Te quedan 3 de 3 hoy');
    await armarConTexto(u, 'Un mensaje para presionar a un cliente');
    const aviso = await screen.findByRole('alert');
    expect(aviso).toHaveTextContent('No pudimos usar ese texto.');
    expect(aviso).toHaveTextContent('No se gastó ninguno de tus usos. Motivo: contenido que acosa a otra persona.');
    // nunca repite el texto de la persona
    expect(aviso).not.toHaveTextContent('presionar a un cliente');
    expect(cuadro()).toHaveFocus();
    expect(cuadro()).toHaveAttribute('aria-invalid', 'true');
    expect(cuadro().getAttribute('aria-describedby')).toContain('coi-mod');
    expect(contador()).toHaveTextContent('Te quedan 3 de 3 hoy');
    await u.type(cuadro(), ' otra vez');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('coi.errores.otra_en_curso_apaga_el_boton_avisa_y_se_sondea_hasta_que_el_servidor_la_suelta', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const u = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    let enCurso = false;
    const f = coi({
      estado: () => json(estado(0, { en_curso: enCurso })),
      armar: () => fallo(409, 'en_curso', 'Ya estamos armando otro COI para ti. Espera a que termine.'),
    });
    render(<Coi />);
    await esperarContador('Te quedan 3 de 3 hoy');
    await u.click(cuadro());
    await u.paste(TEXTO);
    enCurso = true;
    await u.click(boton());
    const aviso = await screen.findByText('Ya hay un COI en camino');
    expect(aviso.closest('[role="status"]')).toHaveTextContent('Ya estamos armando otro COI para ti. Espera a que termine.');
    expect(boton()).toHaveAttribute('aria-disabled', 'true');
    expect(boton()).toHaveAttribute('aria-describedby', 'coi-curso');
    expect(boton()).toHaveFocus();
    // el aviso no es un error y el contador no baja
    expect(screen.queryByRole('alert')).toBeNull();
    expect(contador()).toHaveTextContent('Te quedan 3 de 3 hoy');
    // el botón apagado no manda otra petición
    const posts = llamadas(f, '/api/coi').length;
    await u.click(boton());
    expect(llamadas(f, '/api/coi')).toHaveLength(posts);
    // el servidor suelta el candado: el sondeo (cada 4 s) lo ve y todo vuelve
    enCurso = false;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4100);
    });
    await waitFor(() => expect(screen.queryByText('Ya hay un COI en camino')).toBeNull());
    expect(boton()).not.toHaveAttribute('aria-disabled', 'true');
  });

  it('coi.errores.otra_en_curso_al_abrir_apaga_el_boton_con_su_motivo', async () => {
    coi({ estado: () => json(estado(1, { en_curso: true })) });
    render(<Coi />);
    expect(await screen.findByText('Ya hay un COI en camino')).toBeInTheDocument();
    expect(boton()).toHaveAttribute('aria-disabled', 'true');
    expect(boton()).toHaveAttribute('aria-describedby', 'coi-curso');
    expect(cuadro().getAttribute('aria-describedby')).toContain('coi-curso');
  });

  it('coi.errores.ya_usaste_los_3_apaga_la_entrada_no_es_un_error_y_el_ultimo_resultado_sigue_a_la_vista', async () => {
    const u = userEvent.setup();
    const f = coi({ estado: () => json(estado(2)) }, 2);
    render(<Coi />);
    await esperarContador('Te queda 1 de 3 hoy');
    await armarConTexto(u);
    await screen.findByRole('heading', { name: 'Tu COI' });
    await esperarContador('Ya usaste tus 3 de hoy');
    expect(await screen.findByRole('heading', { name: 'Ya usaste tus 3 COI de hoy' })).toBeInTheDocument();
    // la respuesta del POST trae renueva_en_s = 19100 (5 h 19 min): lo dice el servidor
    expect(cuadroAgotado()).toHaveTextContent('Se renuevan a la medianoche, hora de México (12:00 a. m.). Faltan 5 h 19 min.');
    // entrada apagada con `aria-disabled` + de solo lectura, y su motivo
    expect(cuadro()).toHaveAttribute('aria-disabled', 'true');
    expect(cuadro()).toHaveAttribute('readonly');
    expect(boton()).toHaveAttribute('aria-disabled', 'true');
    expect(boton()).toHaveAttribute('aria-describedby', 'coi-agota');
    // NO es un error
    expect(screen.queryByRole('alert')).toBeNull();
    // el último resultado sigue a la vista, con su Copiar
    expect(screen.getByRole('button', { name: 'Copiar todo el COI' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ir a la Biblioteca de prompts' })).toHaveAttribute('href', '/estudio/biblioteca/');
    // pulsar el botón apagado no manda nada
    const antes = llamadas(f, '/api/coi').length;
    await u.click(boton());
    expect(llamadas(f, '/api/coi')).toHaveLength(antes);
  });

  it('coi.errores.un_429_pone_el_renueva_en_s_que_manda_el_servidor_y_apaga_la_entrada_sin_perder_lo_escrito', async () => {
    const u = userEvent.setup();
    let usos = 0;
    coi({
      estado: () => json(estado(usos, { renueva_en_s: 3660 })),
      armar: () => fallo(429, 'agotado', 'Ya usaste tus 3 COI de hoy.', { quedan: 0, renueva_en_s: 3660, se_renueva: SE_RENUEVA }),
    });
    render(<Coi />);
    await esperarContador('Te quedan 3 de 3 hoy');
    await u.click(cuadro());
    await u.paste(TEXTO);
    usos = 3; // otra pestaña gastó el último
    await u.click(boton());
    expect(await screen.findByRole('heading', { name: 'Ya usaste tus 3 COI de hoy' })).toBeInTheDocument();
    expect(cuadroAgotado()).toHaveTextContent('Faltan 1 h 1 min.');
    expect(cuadro()).toHaveValue(TEXTO);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('coi.errores.sin_conexion_al_armar_lo_dice_y_el_texto_sigue_ahi', async () => {
    const u = userEvent.setup();
    coi({ armar: () => sinRed() as never });
    render(<Coi />);
    await esperarContador('Te quedan 3 de 3 hoy');
    await armarConTexto(u);
    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent('No hay conexión');
    expect(cuadro()).toHaveValue(TEXTO);
    expect(boton()).toHaveFocus();
  });

  it('coi.errores.un_muy_largo_o_vacio_del_servidor_que_el_cliente_ya_evita_igual_se_dice', async () => {
    const u = userEvent.setup();
    coi({ armar: () => fallo(422, 'muy_largo', 'Tu texto pasa de 2000 caracteres. Acórtalo e inténtalo otra vez.') });
    render(<Coi />);
    await esperarContador('Te quedan 3 de 3 hoy');
    await armarConTexto(u);
    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent('Tu texto pasa de 2000 caracteres. Acórtalo e inténtalo otra vez.');
    expect(cuadro()).toHaveValue(TEXTO);
    expect(contador()).toHaveTextContent('Te quedan 3 de 3 hoy');
  });

  it('coi.errores.tras_cualquier_fallo_se_vuelve_a_leer_el_contador_del_servidor', async () => {
    const u = userEvent.setup();
    let usos = 0;
    const f = coi({
      estado: () => json(estado(usos)),
      // el servidor sí terminó y contó el uso, pero la respuesta no llegó (la puerta cortó)
      armar: () => {
        usos = 1;
        return json({ message: 'Endpoint request timed out' }, 504);
      },
    });
    render(<Coi />);
    await esperarContador('Te quedan 3 de 3 hoy');
    const antes = llamadas(f, '/api/coi/estado', 'GET').length;
    await armarConTexto(u);
    await screen.findByRole('alert');
    await esperarContador('Te quedan 2 de 3 hoy');
    expect(llamadas(f, '/api/coi/estado', 'GET').length).toBe(antes + 1);
  });

  it('coi.errores.el_detail_que_es_objeto_se_lee_por_su_texto_y_no_como_un_dato_invalido', async () => {
    // pedir() decía «Revisa lo que escribiste: hay un dato que no es válido.» a todo 422 con detail objeto; COI manda `{codigo, texto}`
    const u = userEvent.setup();
    coi({ armar: () => fallo(422, 'moderacion', 'No se gastó ninguno de tus usos. Motivo: x.') });
    render(<Coi />);
    await esperarContador('Te quedan 3 de 3 hoy');
    await armarConTexto(u);
    expect(await screen.findByRole('alert')).toHaveTextContent('Motivo: x.');
    expect(screen.queryByText(/hay un dato que no es válido/)).toBeNull();
  });

  // ---------------------------------------------------------------- privacidad
  it('coi.privacidad.lo_que_se_escribe_y_lo_que_responde_la_ia_no_toca_el_almacenamiento_del_navegador', async () => {
    const u = userEvent.setup();
    const escritos: string[] = [];
    for (const m of ['setItem'] as const) {
      vi.spyOn(Storage.prototype, m).mockImplementation((k: string, v: string) => {
        escritos.push(`${k}=${v}`);
      });
    }
    coi();
    render(<Coi />);
    await esperarContador('Te quedan 3 de 3 hoy');
    await u.click(cuadro());
    await u.paste(TEXTO);
    await u.click(boton());
    await screen.findByRole('heading', { name: 'Tu COI' });
    await u.click(screen.getByRole('button', { name: 'Guardar' }));
    await u.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // nada se escribió, ni del texto, ni del COI, ni siquiera algo «apartado» para recuperarlo
    expect(escritos).toEqual([]);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it('coi.privacidad.ninguna_llamada_aparta_el_cuerpo_mientras_vuela', async () => {
    // `apartar` de nucleo/api.ts deja el cuerpo de la petición en sessionStorage hasta que hay respuesta: con el texto de la persona sería un rastro
    const u = userEvent.setup();
    let durante = '';
    let soltar!: (r: Response) => void;
    coi({
      armar: () => {
        durante = JSON.stringify({ ...sessionStorage });
        return new Promise<Response>(r => (soltar = r));
      },
    });
    render(<Coi />);
    await esperarContador('Te quedan 3 de 3 hoy');
    await armarConTexto(u);
    await waitFor(() => expect(durante).not.toBe(''));
    expect(durante).toBe('{}');
    expect(JSON.stringify({ ...sessionStorage })).toBe('{}');
    soltar(json(respuesta(1)));
    await screen.findByRole('heading', { name: 'Tu COI' });
  });

  it('coi.privacidad.la_linea_de_privacidad_esta_siempre_a_la_vista', async () => {
    const LINEA = 'No guardamos lo que escribes ni lo que te responde. Solo se guarda el COI que tú decidas guardar, y solo en tu Biblioteca.';
    const u = userEvent.setup();
    let modo: 'bien' | 'agotado' | 'caido' = 'caido';
    coi({ estado: () => (modo === 'caido' ? fallo(503, 'no_disponible', 'x') : json(estado(modo === 'agotado' ? 3 : 0))) });
    const { unmount } = render(<Coi />);
    await screen.findByRole('alert');
    expect(screen.getByText(LINEA)).toBeVisible(); // sin poder leer el contador
    unmount();
    modo = 'bien';
    render(<Coi />);
    await esperarContador('Te quedan 3 de 3 hoy');
    expect(screen.getByText(LINEA)).toBeVisible(); // en reposo
    await armarConTexto(u);
    await screen.findByRole('heading', { name: 'Tu COI' });
    expect(screen.getByText(LINEA)).toBeVisible(); // con resultado
  });

  // ---------------------------------------------------------------- marco
  it('coi.marco.irremplazables_en_dorado_y_las_migas_central_distrito_coi_con_la_ultima_quieta', async () => {
    coi();
    render(<Coi />);
    await esperarContador('Te quedan 3 de 3 hoy');
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1).toHaveTextContent('Irremplazables');
    expect(h1.querySelector('.texto-oro')).not.toBeNull();
    expect(h1.querySelector('svg')).toBeNull(); // sin ícono
    const migas = within(screen.getByRole('navigation', { name: 'Dónde estás' }));
    const central = migas.getByRole('link', { name: 'Ir al mapa para cambiar de área (ahora: Central)' });
    const distrito = migas.getByRole('link', { name: 'Ir a las opciones de Central (ahora: Distrito)' });
    expect(central.getAttribute('href')).toBe('/estudio/inicio/?desde=central.distrito.coi&ver=mapa');
    expect(distrito.getAttribute('href')).toBe('/estudio/inicio/?desde=central.distrito.coi&ver=grupos');
    // COI es donde estás: un chip quieto, no un botón que no hace nada
    expect(migas.queryByRole('link', { name: 'COI' })).toBeNull();
    expect(migas.queryByRole('button')).toBeNull();
    const aqui = screen.getByText('COI', { selector: 'nav li span[aria-current="step"]' });
    expect(aqui).toBeInTheDocument();
    // el marco va antes que la pantalla: Irremplazables → migas → título de la pantalla
    const orden = [h1, screen.getByRole('navigation', { name: 'Dónde estás' }), screen.getByRole('heading', { name: 'Diseña un prompt con COI' })];
    for (let i = 1; i < orden.length; i++) expect(orden[i - 1]!.compareDocumentPosition(orden[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('coi.marco.el_mapa_enciende_coi_y_enlaza_la_biblioteca_desde_la_pantalla', async () => {
    const entrada = MENU.find(a => a.clave === 'central')!.grupos.find(g => g.clave === 'distrito')!.pantallas.find(p => p.clave === 'coi')!;
    expect(entrada.href).toBe('/estudio/coi/');
    expect(entrada.proximamente).toBeUndefined();
    expect(buscar({ area: 'central', grupo: 'distrito', pantalla: 'coi' })?.pantalla).toBe(entrada);
    coi();
    render(<Coi />);
    await esperarContador('Te quedan 3 de 3 hoy');
    expect(screen.getByRole('link', { name: /Mira la Biblioteca de prompts/ })).toHaveAttribute('href', '/estudio/biblioteca/');
    expect(screen.getByText('¿Buscas uno que ya esté hecho?')).toBeInTheDocument();
  });

  it('coi.marco.un_solo_boton_ambar_y_es_armar_coi', async () => {
    const u = userEvent.setup();
    coi();
    const { container } = render(<Coi />);
    await esperarContador('Te quedan 3 de 3 hoy');
    const ambar = () => [...container.querySelectorAll('button')].filter(b => b.className.split(/\s+/).includes('bg-ambar')).map(b => b.textContent?.trim());
    expect(ambar()).toEqual(['Armar COI']);
    await armarConTexto(u);
    await screen.findByRole('heading', { name: 'Tu COI' });
    // con el resultado a la vista sigue siendo uno: «Guardar» y «Copiar» son secundarios
    expect(ambar()).toEqual(['Armar otro COI']);
  });
});
