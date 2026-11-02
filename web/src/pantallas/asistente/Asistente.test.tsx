// El Asistente, como COMPORTAMIENTO, con el API de mentira: el servidor, la descarga y el almacenamiento NO son de verdad (no cuesta
// nada y no sale nada de la máquina). Cada test con ID (`asistente.<tema>.<frase>`) es un invariante registrado
// (tests/test_migracion_ui.py); los que no llevan ID son comportamiento menor.
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { urlDeInicio } from '../../marca/menu';
import { descargarArchivo } from '../../nucleo/descargarArchivo';
import { json, sinRed } from '../../prueba/servidor';
import { CLAVE_BORRADOR, crearBorrador, leerBorrador } from '../constructor/modelo/borrador';
import { EJEMPLOS, ejemplo } from '../constructor/modelo/ejemplos';
import {
  CONFIG,
  FLUJO,
  INICIO,
  SIN_COBERTURA,
  armandoEn,
  asistente,
  consultas,
  cuerpoDe,
  falla,
  grafo,
  listo,
  memoria,
  pedidos,
  type Guion,
} from './arnes';
import { Asistente, type PropsAsistente } from './Asistente';

vi.mock('../../nucleo/descargarArchivo', async importOriginal => {
  const original = await importOriginal<typeof import('../../nucleo/descargarArchivo')>();
  return { ...original, descargarArchivo: vi.fn(() => true) };
});

const TEXTO = 'Cuando me llegue un correo de un cliente, que una IA le conteste y lo anote en una hoja de cálculo';
const ARCHIVO = 'Responder correos de clientes.json';
const JSON_DEL_FLUJO = JSON.stringify(FLUJO, null, 2);

const cuadro = () => screen.getByRole('textbox', { name: 'Cuéntale qué necesitas' });
const botonArmar = () => screen.getByRole('button', { name: /^Armar (otro )?flujo$|^Armando…$/ });
const tituloListo = () => screen.findByRole('heading', { name: 'Tu flujo está listo' });
/** La única región viva propia de la pantalla (lo demás que se anuncia son cuadros con role="alert"). */
const regionViva = () => document.querySelector<HTMLElement>('main p.sr-only[role="status"]')!;
const pestana = 'Estudio de video · Asistente';

/** Deja pasar `ms` del reloj falso, con lo que ocurra en medio (el fetch, el siguiente paso de la escalera). */
const pasar = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

interface Abrir {
  guion?: Guion;
  props?: PropsAsistente;
  /** Relojes falsos (con `shouldAdvanceTime`, como COI): para lo que depende de la escalera de 5 s. */
  tiempo?: boolean;
  /** Esperar el cuadro de texto (no hay en los estados apagados). */
  cuadro?: boolean;
}

async function abrir({ guion = {}, props = {}, tiempo = false, cuadro: conCuadro = true }: Abrir = {}) {
  if (tiempo) vi.useFakeTimers({ shouldAdvanceTime: true });
  const f = asistente(guion);
  const u = userEvent.setup();
  const r = render(<Asistente {...props} />);
  if (conCuadro) await screen.findByRole('textbox', { name: 'Cuéntale qué necesitas' });
  return { f, u, ...r };
}

type Usuario = ReturnType<typeof userEvent.setup>;

async function armarConTexto(u: Usuario, texto = TEXTO) {
  await u.click(cuadro());
  await u.paste(texto);
  await u.click(botonArmar());
}

/** Escribe, arma y deja correr los 5 s del primer sondeo hasta que el flujo está listo. */
async function hastaElResultado(u: Usuario, texto = TEXTO) {
  await armarConTexto(u, texto);
  await pasar(5100);
  await tituloListo();
}

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(descargarArchivo).mockReset().mockReturnValue(true);
  document.title = pestana;
});
afterEach(() => {
  vi.useRealTimers();
  delete window.monedero;
});

describe('Asistente', () => {
  // ---------------------------------------------------------------- marco
  it('asistente.marco.irremplazables_en_dorado_y_migas_automatizaciones_distrito_asistente_con_la_ultima_quieta', async () => {
    await abrir();
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1.textContent).toBe('Irremplazables');
    // el dorado es un fondo recortado a la letra: va en un <span> en línea, no en el h1
    expect(h1.querySelector('.texto-oro')).not.toBeNull();
    const nav = screen.getByRole('navigation', { name: 'Dónde estás' });
    expect(within(nav).getAllByRole('listitem').map(li => li.textContent!.replace('›', '').trim())).toEqual([
      'Automatizaciones',
      'Distrito',
      'Asistente',
    ]);
    const lugar = { area: 'automatizaciones', grupo: 'distrito', pantalla: 'asistente' };
    expect(within(nav).getAllByRole('link').map(a => a.getAttribute('href'))).toEqual([urlDeInicio(lugar, 'mapa'), urlDeInicio(lugar, 'grupos')]);
    // la última miga es la pantalla donde estás: un chip quieto, no un enlace que no lleva a ningún lado
    const actual = within(nav).getByText('Asistente', { selector: 'span' });
    expect(actual).toHaveAttribute('aria-current', 'step');
    expect(within(nav).queryByRole('link', { name: /Asistente/ })).toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: 'Cuéntanos qué quieres automatizar' })).toBeInTheDocument();
  });

  it('asistente.marco.un_solo_h1_y_un_solo_boton_ambar_que_cambia_con_el_estado', async () => {
    const ambar = () =>
      [...document.querySelectorAll('button, a')].filter(e => e.classList.contains('bg-ambar')).map(e => e.textContent!.trim());
    const { u } = await abrir({ tiempo: true });
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(ambar()).toEqual(['Armar flujo']);
    await armarConTexto(u);
    expect(ambar()).toEqual(['Armando…']);
    await pasar(5100);
    await tituloListo();
    // con el flujo listo, lo principal es descargarlo y «Armar» pasa a secundario
    expect(ambar()).toEqual(['Descargar .json']);
    expect(botonArmar()).toHaveTextContent('Armar otro flujo');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  // ---------------------------------------------------------------- dinero
  it('asistente.dinero.en_prueba_el_boton_dice_armar_flujo_sin_estrella_ni_precio', async () => {
    const { u } = await abrir({ tiempo: true });
    expect(screen.getByRole('button', { name: 'Armar flujo' })).toBeInTheDocument();
    const sinDinero = () => expect(document.body.textContent).not.toMatch(/✦|créditos|dólares|\$\s?\d|USD/i);
    sinDinero();
    await hastaElResultado(u);
    sinDinero();
    // la respuesta de pruebas no cobra: ningún pedido lleva costo ni saldo
    expect(screen.getByRole('button', { name: 'Armar otro flujo' })).toBeInTheDocument();
  });

  it('asistente.dinero.si_el_servidor_cobra_no_se_ofrece_escribir_hasta_poder_mostrar_el_costo', async () => {
    const { f } = await abrir({
      cuadro: false,
      guion: { config: () => json({ ...CONFIG, modo: 'real', gratis: false, costo_creditos: 12 }) },
    });
    expect(await screen.findByRole('heading', { name: 'No está disponible por ahora' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: /Armar/ })).toBeNull();
    expect(document.body.textContent).not.toContain('✦');
    // y no manda nada: ningún pedido ni consulta
    expect(pedidos(f)).toHaveLength(0);
    expect(consultas(f)).toHaveLength(0);
  });

  // ---------------------------------------------------------------- la prueba
  it('asistente.prueba.el_letrero_se_ve_mientras_el_modo_es_prueba_y_no_en_otro_modo', async () => {
    const { unmount } = await abrir();
    expect(screen.getByText('Prueba: por ahora armamos flujos de ejemplo.')).toBeInTheDocument();
    // sin precios en el letrero
    expect(screen.getByText('Prueba: por ahora armamos flujos de ejemplo.').parentElement!.textContent).not.toMatch(/\$|✦|créditos|dólares/i);
    unmount();
    await abrir({ guion: { config: () => json({ ...CONFIG, modo: 'real' }) } });
    expect(screen.queryByText(/Prueba: por ahora armamos/)).toBeNull();
  });

  // ---------------------------------------------------------------- límites
  it('asistente.limites.los_limites_salen_de_config_y_no_de_la_pantalla', async () => {
    const { u, f } = await abrir({ guion: { config: () => json({ ...CONFIG, largo_minimo: 30, largo_maximo: 50 }) } });
    expect(screen.getByText('0 de 50 caracteres')).toBeInTheDocument();
    await u.click(cuadro());
    await u.paste('a'.repeat(25));
    expect(screen.getByText('25 de 50 caracteres · mínimo 30')).toBeInTheDocument();
    await u.click(botonArmar());
    expect(await screen.findByRole('alert')).toHaveTextContent('Cuéntanos un poco más: escribe al menos 30 caracteres. Llevas 25.');
    expect(pedidos(f)).toHaveLength(0);
    // 30 y 50 entran; el máximo de la config, no uno de la pantalla
    await u.clear(cuadro());
    await u.paste('a'.repeat(50));
    expect(screen.getByText('50 de 50 caracteres')).toBeInTheDocument();
    expect(botonArmar()).not.toHaveAttribute('aria-disabled', 'true');
  });

  it('asistente.limites.demasiado_largo_apaga_el_boton_y_dice_cuanto_lleva', async () => {
    const { u, f } = await abrir({ guion: { config: () => json({ ...CONFIG, largo_maximo: 50 }) } });
    await u.click(cuadro());
    await u.paste('a'.repeat(60));
    // la frase sale junto al cuadro (y, una sola vez, en la región viva)
    expect(document.getElementById('asis-largo')).toHaveTextContent('Es muy largo: el máximo es de 50 caracteres y llevas 60. Acórtalo para armar tu flujo.');
    const b = botonArmar();
    // apagado pero enfocable, y explica por qué desde el propio botón y desde el cuadro
    expect(b).toHaveAttribute('aria-disabled', 'true');
    expect(b).not.toBeDisabled();
    expect(b).toHaveAttribute('aria-describedby', 'asis-largo');
    expect(cuadro()).toHaveAttribute('aria-invalid', 'true');
    expect(cuadro().getAttribute('aria-describedby')).toContain('asis-largo');
    await u.click(b);
    expect(pedidos(f)).toHaveLength(0);
    // sin duplicar: la frase ya está junto al cuadro, no sale además como alerta
    expect(screen.queryByRole('alert')).toBeNull();
    // al acortarlo vuelve a servir
    await u.clear(cuadro());
    await u.paste('a'.repeat(40));
    expect(botonArmar()).not.toHaveAttribute('aria-disabled', 'true');
    expect(document.getElementById('asis-largo')).toBeNull();
  });

  it('asistente.limites.vacio_o_corto_se_dice_junto_al_cuadro_sin_mandar_nada', async () => {
    const { u, f } = await abrir();
    await u.click(botonArmar());
    const vacio = await screen.findByRole('alert');
    expect(vacio).toHaveTextContent('Escribe primero qué quieres automatizar, aunque sea en una frase.');
    expect(cuadro()).toHaveFocus();
    expect(cuadro()).toHaveAttribute('aria-invalid', 'true');
    expect(cuadro().getAttribute('aria-describedby')).toContain(vacio.id);
    await u.paste('hola');
    // escribir quita el error del pedido anterior
    expect(screen.queryByRole('alert')).toBeNull();
    await u.click(botonArmar());
    expect(await screen.findByRole('alert')).toHaveTextContent('escribe al menos 20 caracteres. Llevas 4.');
    expect(pedidos(f)).toHaveLength(0);
    expect(consultas(f)).toHaveLength(0);
  });

  // ---------------------------------------------------------------- armado
  it('asistente.armado.el_pedido_se_manda_recortado_y_los_pasos_son_los_cuatro_del_servidor', async () => {
    let n = 0;
    const { u, f } = await abrir({
      tiempo: true,
      guion: { consultar: () => json(++n === 1 ? armandoEn('armar') : listo()) },
    });
    await armarConTexto(u, `   ${TEXTO}   `);
    await waitFor(() => expect(pedidos(f)).toHaveLength(1));
    expect(cuerpoDe(pedidos(f)[0]!)).toEqual({ texto: TEXTO });
    const lista = await screen.findByRole('list', { name: 'Pasos' });
    // solo los cuatro que informa el servidor: entender, buscar, armar, revisar
    expect(within(lista).getAllByRole('listitem').map(li => li.textContent)).toEqual([
      'Entendiendo lo que pides',
      'Buscar ejemplos parecidos',
      'Armar los cuadros',
      'Revisar que se pueda importar en n8n',
    ]);
    expect(within(lista).getByRole('listitem', { current: 'step' })).toHaveTextContent('Entendiendo lo que pides');
    expect(screen.getByText(/^Llevas \d+:\d{2}\.$/)).toBeInTheDocument();
    // al primer sondeo (5 s) el servidor dice que va en «armar»: lo anterior queda hecho
    await pasar(5100);
    await waitFor(() => expect(within(lista).getByRole('listitem', { current: 'step' })).toHaveTextContent('Armando los cuadros'));
    expect(within(lista).getAllByRole('listitem').map(li => li.textContent)).toEqual([
      'Entendimos lo que pides',
      'Encontramos ejemplos parecidos',
      'Armando los cuadros',
      'Revisar que se pueda importar en n8n',
    ]);
    await pasar(5000);
    await tituloListo();
    expect(screen.queryByRole('list', { name: 'Pasos' })).toBeNull();
  });

  it('asistente.armado.doble_clic_manda_un_solo_pedido', async () => {
    const { u, f } = await abrir({ tiempo: true });
    await u.click(cuadro());
    await u.paste(TEXTO);
    await u.dblClick(botonArmar());
    await u.click(screen.getByRole('button', { name: 'Armando…' }));
    expect(pedidos(f)).toHaveLength(1);
    // con Ctrl+Enter, también
    await u.click(cuadro());
    await u.keyboard('{Control>}{Enter}{/Control}');
    expect(pedidos(f)).toHaveLength(1);
    expect(botonArmar()).toHaveAttribute('aria-busy', 'true');
  });

  it('Ctrl+Enter en el cuadro arma, como el botón', async () => {
    const { u, f } = await abrir({ tiempo: true });
    await u.click(cuadro());
    await u.paste(TEXTO);
    expect(cuadro()).toHaveAttribute('aria-keyshortcuts', 'Control+Enter Meta+Enter');
    await u.keyboard('{Control>}{Enter}{/Control}');
    expect(pedidos(f)).toHaveLength(1);
    await u.keyboard('{Meta>}{Enter}{/Meta}');
    expect(pedidos(f)).toHaveLength(1);
  });

  it('mientras arma el cuadro es de solo lectura y conserva lo escrito', async () => {
    const { u } = await abrir({ tiempo: true });
    await armarConTexto(u);
    expect(cuadro()).toHaveAttribute('readonly');
    expect(cuadro()).toHaveValue(TEXTO);
    expect(cuadro()).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('Ejemplos para empezar')).toBeNull();
  });

  // ---------------------------------------------------------------- el resultado
  it('asistente.resultado.muestra_nombre_resumen_chips_en_espanol_pendientes_y_advertencias', async () => {
    const aviso = 'El chat quedará público: cualquiera con el enlace podrá escribirle (y gastar tu llave de IA).';
    const { u } = await abrir({ tiempo: true, guion: { consultar: () => json(listo({ advertencias: [aviso] })) } });
    await hastaElResultado(u);
    const tarjeta = screen.getByRole('region', { name: 'Tu flujo está listo' });
    expect(within(tarjeta).getByText('Responder correos de clientes')).toBeInTheDocument();
    expect(within(tarjeta).getByText(/Cuando llega un correo nuevo, una IA redacta la respuesta/)).toBeInTheDocument();
    // los chips son los de la persona (`etiqueta`), no los nombres en inglés de n8n
    const chips = within(within(tarjeta).getByRole('list', { name: 'Cuadros del flujo' })).getAllByRole('listitem');
    expect(chips.map(c => c.textContent)).toEqual(['Llega un correo (Gmail)', 'Agente de IA', 'Gmail (paso)']);
    expect(within(tarjeta).queryByText('AI Agent')).toBeNull();
    expect(within(tarjeta).queryByText('Gmail Trigger')).toBeNull();
    // lo que falta conectar en n8n
    const pendientes = within(tarjeta).getByRole('heading', { name: 'Antes de usarlo en n8n' }).parentElement!;
    expect(within(pendientes).getAllByRole('listitem').map(li => li.textContent)).toEqual([
      'Conecta tu cuenta de Gmail en n8n y elige el destinatario.',
      'Conecta tu cuenta de OpenAI en n8n.',
    ]);
    // las advertencias van en una lista estática: no se anuncian solas como si fueran un estado
    const ten = within(tarjeta).getByRole('heading', { name: 'Ten en cuenta' }).parentElement!;
    expect(within(ten).getByText(aviso)).toBeInTheDocument();
    expect(ten.closest('[role="status"],[role="alert"]')).toBeNull();
    // es una prueba y lo dice; y cómo usarlo queda en la página, no solo en un aviso que se va
    expect(within(tarjeta).getByText(/Ejemplo de prueba/)).toBeInTheDocument();
    expect(within(tarjeta).getByText(/Import from File/)).toBeInTheDocument();
  });

  it('sin pendientes, sin advertencias y sin resumen, la tarjeta no pinta esas secciones vacías', async () => {
    const { u } = await abrir({ tiempo: true, guion: { consultar: () => json(listo({ pendientes: [], advertencias: [], resumen: undefined, nodos: [] })) } });
    await hastaElResultado(u);
    expect(screen.queryByRole('heading', { name: 'Antes de usarlo en n8n' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Ten en cuenta' })).toBeNull();
    expect(screen.queryByRole('list', { name: 'Cuadros del flujo' })).toBeNull();
  });

  it('asistente.resultado.descargar_baja_el_json_con_el_nombre_del_flujo', async () => {
    const { u } = await abrir({ tiempo: true });
    await hastaElResultado(u);
    await u.click(screen.getByRole('button', { name: 'Descargar .json' }));
    expect(descargarArchivo).toHaveBeenCalledExactlyOnceWith(ARCHIVO, JSON_DEL_FLUJO);
    expect(regionViva()).toHaveTextContent(`Descargamos «${ARCHIVO}».`);
    // no aparece «Copiar el JSON»: la descarga salió bien
    expect(screen.queryByRole('button', { name: /Copiar el JSON/ })).toBeNull();
    // el nombre del archivo se limpia
    vi.mocked(descargarArchivo).mockClear();
  });

  it('un doble clic en «Descargar .json» baja un solo archivo', async () => {
    const { u } = await abrir({ tiempo: true });
    await hastaElResultado(u);
    await u.dblClick(screen.getByRole('button', { name: 'Descargar .json' }));
    expect(descargarArchivo).toHaveBeenCalledTimes(1);
  });

  it('asistente.resultado.si_no_se_puede_descargar_ofrece_copiar_el_json', async () => {
    vi.mocked(descargarArchivo).mockReturnValue(false);
    const { u } = await abrir({ tiempo: true });
    await hastaElResultado(u);
    expect(screen.queryByRole('button', { name: 'Copiar el JSON' })).toBeNull();
    await u.click(screen.getByRole('button', { name: 'Descargar .json' }));
    expect(regionViva()).toHaveTextContent('Tu navegador no dejó descargar el archivo. Puedes copiar el JSON.');
    // el texto queda a la vista, para leerlo o seleccionarlo
    const caja = screen.getByRole('textbox', { name: 'El JSON de tu flujo' });
    expect(caja).toHaveValue(JSON_DEL_FLUJO);
    expect(caja).toHaveAttribute('readonly');
    await u.click(screen.getByRole('button', { name: 'Copiar el JSON' }));
    expect(await navigator.clipboard.readText()).toBe(JSON_DEL_FLUJO);
    expect(screen.getByRole('button', { name: 'Copiado: el JSON' })).toHaveTextContent('Copiado');
    expect(regionViva()).toHaveTextContent('Copiamos el JSON.');
  });

  it('si tampoco se puede copiar, deja el JSON seleccionado y dice cómo seguir', async () => {
    vi.mocked(descargarArchivo).mockReturnValue(false);
    const { u } = await abrir({ tiempo: true });
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('sin permiso'));
    await hastaElResultado(u);
    await u.click(screen.getByRole('button', { name: 'Descargar .json' }));
    await u.click(screen.getByRole('button', { name: 'Copiar el JSON' }));
    const caja = screen.getByRole('textbox', { name: 'El JSON de tu flujo' }) as HTMLTextAreaElement;
    expect(caja.selectionStart).toBe(0);
    expect(caja.selectionEnd).toBe(caja.value.length);
    expect(regionViva()).toHaveTextContent('No pudimos copiar solos. Dejamos el texto seleccionado: cópialo con Ctrl+C.');
    // el botón no miente: sigue diciendo «Copiar el JSON»
    expect(screen.getByRole('button', { name: 'Copiar el JSON' })).toBeInTheDocument();
  });

  it('asistente.resultado.sin_grafo_no_ofrece_abrir_en_el_constructor', async () => {
    const sin = await abrir({ tiempo: true, guion: { consultar: () => json(listo({ grafo: undefined })) } });
    await hastaElResultado(sin.u);
    expect(screen.getByRole('button', { name: 'Descargar .json' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Abrir en el constructor' })).toBeNull();
    sin.unmount();
    vi.useRealTimers();
    // un grafo que el Constructor no podría abrir tampoco se ofrece: un botón que siempre falla no se muestra
    const roto = await abrir({ tiempo: true, guion: { consultar: () => json(listo({ grafo: { nodes: [], edges: [], nombreFlujo: 'x' } })) } });
    await hastaElResultado(roto.u);
    expect(screen.queryByRole('button', { name: 'Abrir en el constructor' })).toBeNull();
  });

  it('asistente.resultado.abrir_en_el_constructor_pasa_el_grafo_por_el_borrador_y_navega', async () => {
    const almacen = memoria();
    const ir = vi.fn();
    const { u } = await abrir({ tiempo: true, props: { ir, almacen } });
    await hastaElResultado(u);
    await u.click(screen.getByRole('button', { name: 'Abrir en el constructor' }));
    expect(ir).toHaveBeenCalledExactlyOnceWith('/estudio/automatizaciones/distrito/constructor/');
    // lo que queda guardado es el flujo del Asistente, con su marca, y NO lo que se escribió
    const guardado = almacen.datos.get(CLAVE_BORRADOR)!;
    const leido = leerBorrador(guardado);
    expect(leido.ok && leido.origen).toBe('asistente');
    expect(leido.ok && leido.flujo.nombreFlujo).toBe(grafo().nombreFlujo);
    expect(leido.ok && leido.flujo.nodes).toHaveLength(5);
    expect(guardado).not.toContain('hoja de cálculo');
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('asistente.resultado.con_un_borrador_existente_pide_confirmacion_antes_de_reemplazarlo', async () => {
    const almacen = memoria();
    crearBorrador(almacen).guardar(ejemplo());
    const previo = almacen.datos.get(CLAVE_BORRADOR)!;
    const ir = vi.fn();
    const { u } = await abrir({ tiempo: true, props: { ir, almacen } });
    await hastaElResultado(u);
    const abrirBoton = screen.getByRole('button', { name: 'Abrir en el constructor' });
    await u.click(abrirBoton);
    // pregunta, con el foco en «Cancelar», y no toca nada todavía
    const dialogo = await screen.findByRole('alertdialog', { name: '¿Reemplazar tu flujo del constructor?' });
    expect(within(dialogo).getByRole('button', { name: 'Cancelar' })).toHaveFocus();
    expect(ir).not.toHaveBeenCalled();
    expect(almacen.datos.get(CLAVE_BORRADOR)).toBe(previo);
    // cancelar: sigue igual y el foco vuelve al botón que lo abrió
    await u.click(within(dialogo).getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(ir).not.toHaveBeenCalled();
    expect(almacen.datos.get(CLAVE_BORRADOR)).toBe(previo);
    expect(abrirBoton).toHaveFocus();
    // Esc también cancela
    await u.click(abrirBoton);
    await screen.findByRole('alertdialog');
    await u.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(ir).not.toHaveBeenCalled();
    // confirmar: reemplaza y navega, una sola vez
    await u.click(abrirBoton);
    await u.click(await screen.findByRole('button', { name: 'Reemplazar y abrir' }));
    expect(ir).toHaveBeenCalledExactlyOnceWith('/estudio/automatizaciones/distrito/constructor/');
    const nuevo = leerBorrador(almacen.datos.get(CLAVE_BORRADOR));
    expect(nuevo.ok && nuevo.origen).toBe('asistente');
    expect(almacen.datos.get(CLAVE_BORRADOR)).not.toBe(previo);
  });

  it('asistente.resultado.si_el_traspaso_falla_lo_dice_y_no_navega', async () => {
    const sinEspacio = {
      getItem: () => null,
      removeItem: () => undefined,
      setItem: () => {
        throw Object.assign(new Error('lleno'), { name: 'QuotaExceededError' });
      },
    };
    const ir = vi.fn();
    const { u } = await abrir({ tiempo: true, props: { ir, almacen: sinEspacio } });
    await hastaElResultado(u);
    await u.click(screen.getByRole('button', { name: 'Abrir en el constructor' }));
    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent('Tu navegador no tiene espacio para pasar el flujo al constructor. Descarga el .json y ábrelo en n8n.');
    expect(ir).not.toHaveBeenCalled();
    // y la descarga sigue ahí
    expect(screen.getByRole('button', { name: 'Descargar .json' })).toBeInTheDocument();
  });

  // ---------------------------------------------------------------- estados
  it('asistente.estados.sin_cobertura_dice_el_mensaje_y_lo_que_falta', async () => {
    const { u } = await abrir({ tiempo: true, guion: { consultar: () => json(SIN_COBERTURA) } });
    await armarConTexto(u, 'quiero conectar hubspot con github y publicar en instagram');
    await pasar(5100);
    const titulo = await screen.findByRole('heading', { name: 'Todavía no podemos armar esto' });
    const caja = titulo.closest('section')!;
    expect(within(caja).getByText('Todavía no sabemos armar esto con n8n.')).toBeInTheDocument();
    expect(within(caja).getByText(SIN_COBERTURA.faltan[0]!)).toBeInTheDocument();
    expect(within(caja).getByRole('link', { name: 'Abrir el constructor' })).toHaveAttribute('href', '/estudio/automatizaciones/distrito/constructor/');
    // no es un error ni un resultado: no hay descarga, y lo escrito sigue en el cuadro
    expect(screen.queryByRole('button', { name: 'Descargar .json' })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(cuadro()).toHaveValue('quiero conectar hubspot con github y publicar en instagram');
    expect(botonArmar()).toHaveTextContent('Armar flujo');
    expect(titulo).toHaveFocus();
  });

  it('asistente.estados.no_encontrada_dice_que_vuelvas_a_escribir_el_pedido', async () => {
    const { u, f } = await abrir({
      tiempo: true,
      guion: { consultar: () => falla(404, 'no_encontrada', 'No encontramos ese pedido. Escribe de nuevo qué quieres automatizar.') },
    });
    await armarConTexto(u);
    await pasar(5100);
    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent('No encontramos ese pedido. Escribe de nuevo qué quieres automatizar.');
    expect(alerta).toHaveTextContent('Escribe tu pedido de nuevo y pulsa «Armar flujo».');
    // el texto no se perdió y el foco está en el cuadro
    expect(cuadro()).toHaveValue(TEXTO);
    expect(cuadro()).toHaveFocus();
    // dejó de preguntar y se puede volver a armar
    await pasar(60_000);
    expect(consultas(f)).toHaveLength(1);
    expect(botonArmar()).toHaveTextContent('Armar flujo');
    expect(botonArmar()).not.toHaveAttribute('aria-busy');
  });

  it('asistente.estados.activo_falso_no_ofrece_escribir', async () => {
    const texto = 'El Asistente no está disponible por ahora. Inténtalo en unos minutos.';
    const { f } = await abrir({ cuadro: false, guion: { config: () => json({ ...CONFIG, activo: false, modo: 'no_disponible', gratis: false, texto }) } });
    const titulo = await screen.findByRole('heading', { name: 'No está disponible por ahora' });
    expect(within(titulo.closest('section')!).getByText(texto)).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: /Armar/ })).toBeNull();
    expect(screen.queryByText('Ejemplos para empezar')).toBeNull();
    expect(screen.getByRole('link', { name: 'Abrir el constructor' })).toHaveAttribute('href', '/estudio/automatizaciones/distrito/constructor/');
    // sin letrero de prueba: el modo no es «prueba»
    expect(screen.queryByText(/Prueba: por ahora/)).toBeNull();
    expect(pedidos(f)).toHaveLength(0);
  });

  it('asistente.estados.el_503_y_la_falta_de_conexion_se_dicen_con_reintentar', async () => {
    // a) la configuración: 503 → alerta con «Reintentar»; sin conexión → igual
    let modo: 'cae' | 'sinred' | 'bien' = 'cae';
    const { u, unmount } = await abrir({
      cuadro: false,
      guion: {
        config: () =>
          modo === 'bien'
            ? json(CONFIG)
            : modo === 'sinred'
              ? sinRed()
              : falla(503, 'no_disponible', 'El Asistente no está disponible por ahora. Inténtalo en unos minutos.'),
      },
    });
    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent('Qué pasó');
    expect(alerta).toHaveTextContent('El Asistente no está disponible por ahora. Inténtalo en unos minutos.');
    expect(screen.queryByRole('textbox')).toBeNull();
    modo = 'sinred';
    await u.click(screen.getByRole('button', { name: 'Reintentar' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('No hay conexión. Revisa tu internet y vuelve a intentar.'));
    modo = 'bien';
    await u.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByRole('textbox', { name: 'Cuéntale qué necesitas' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    unmount();

    // b) al mandar el pedido: 503 y sin conexión dejan el texto y se puede volver a intentar
    let n = 0;
    const b = await abrir({
      tiempo: true,
      guion: {
        armar: () => (++n === 1 ? falla(503, 'no_disponible', 'El Asistente no está disponible por ahora. Inténtalo en unos minutos.') : n === 2 ? sinRed() : json(INICIO, 202)),
      },
    });
    await armarConTexto(b.u);
    expect(await screen.findByRole('alert')).toHaveTextContent('El Asistente no está disponible por ahora. Inténtalo en unos minutos.');
    expect(cuadro()).toHaveValue(TEXTO);
    await b.u.click(botonArmar());
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('No hay conexión. Revisa tu internet y vuelve a intentar.'));
    expect(screen.getByRole('alert')).toHaveTextContent('Revisa tu conexión y pulsa «Armar flujo» otra vez');
    // un fallo de conexión no se arregla en el texto: el foco se queda en «Armar flujo» y el aviso habla solo
    expect(botonArmar()).toHaveFocus();
    await b.u.click(botonArmar());
    await pasar(5100);
    await tituloListo();
    expect(pedidos(b.f)).toHaveLength(3);
  });

  it('asistente.estados.sin_conexion_al_preguntar_se_ve_en_la_espera_y_se_anuncia_una_vez', async () => {
    let n = 0;
    const { u } = await abrir({ tiempo: true, guion: { consultar: () => (++n === 1 ? sinRed() : json(listo())) } });
    await armarConTexto(u);
    await pasar(5100);
    expect(await screen.findByText('Sin conexión. Seguimos intentando…')).toBeInTheDocument();
    // lo dice la región viva, una sola vez; el aviso de la página no lleva role
    expect(regionViva()).toHaveTextContent('Sin conexión. Seguimos intentando.');
    expect(screen.getAllByText(/Sin conexión\. Seguimos intentando/)).toHaveLength(2);
    expect(screen.queryByRole('alert')).toBeNull();
    // sigue armando: no se rindió
    expect(screen.getByRole('list', { name: 'Pasos' })).toBeInTheDocument();
    await pasar(5000);
    await tituloListo();
    expect(screen.queryByText('Sin conexión. Seguimos intentando…')).toBeNull();
  });

  it('una respuesta que no se entiende (listo sin flujo) se dice como un fallo, no se pinta como resultado', async () => {
    const { u } = await abrir({ tiempo: true, guion: { consultar: () => json(listo({ flujo: undefined })) } });
    await armarConTexto(u);
    await pasar(5100);
    expect(await screen.findByRole('alert')).toHaveTextContent('Recibimos una respuesta que no entendemos. Inténtalo otra vez.');
    expect(screen.queryByRole('button', { name: 'Descargar .json' })).toBeNull();
  });

  it('mientras pregunta por la configuración no se ofrece nada: solo un hueco que dice qué espera', async () => {
    await abrir({ cuadro: false, guion: { config: () => new Promise<Response>(() => undefined) } });
    expect(await screen.findByRole('status', { name: 'Revisando si el Asistente está disponible' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: /Armar/ })).toBeNull();
  });

  // ---------------------------------------------------------------- foco
  it('asistente.foco.al_llegar_el_resultado_va_al_encabezado_y_al_fallar_al_cuadro', async () => {
    // el resultado: el foco pasa a «Tu flujo está listo»
    let ok = true;
    const { u } = await abrir({
      tiempo: true,
      guion: { consultar: () => (ok ? json(listo()) : falla(404, 'no_encontrada', 'No encontramos ese pedido. Escribe de nuevo qué quieres automatizar.')) },
    });
    await armarConTexto(u);
    expect(botonArmar()).toHaveFocus();
    await pasar(5100);
    const titulo = await tituloListo();
    expect(titulo).toHaveFocus();
    expect(titulo).toHaveAttribute('tabindex', '-1');
    // el fallo: el foco vuelve al cuadro, que es lo que hay que corregir
    ok = false;
    await u.click(botonArmar());
    await pasar(5100);
    await screen.findByRole('alert');
    expect(cuadro()).toHaveFocus();
    // nunca al <body>
    expect(document.body).not.toHaveFocus();
  });

  it('si la persona ya se fue a otra parte de la página, el resultado no le roba el foco', async () => {
    const { u } = await abrir({ tiempo: true });
    await armarConTexto(u);
    const miga = screen.getByRole('link', { name: /Ir al mapa para cambiar de área/ });
    miga.focus();
    await pasar(5100);
    await tituloListo();
    expect(miga).toHaveFocus();
  });

  it('asistente.foco.los_ejemplos_pasan_el_foco_al_cuadro_antes_de_irse', async () => {
    const { u } = await abrir();
    const lista = screen.getByRole('list', { name: 'Ejemplos para empezar' });
    const ejemplos = within(lista).getAllByRole('button');
    // los tres ejemplos son los del Constructor (una sola fuente), y cada uno cabe en los límites del servidor
    expect(ejemplos.map(b => b.textContent)).toEqual([...EJEMPLOS]);
    for (const e of EJEMPLOS) expect(e.length).toBeGreaterThanOrEqual(CONFIG.largo_minimo);
    await u.click(ejemplos[1]!);
    expect(cuadro()).toHaveValue(EJEMPLOS[1]);
    expect(cuadro()).toHaveFocus();
    // al escribir los ejemplos se van, y el foco ya estaba a salvo en el cuadro
    expect(screen.queryByText('Ejemplos para empezar')).toBeNull();
    expect(document.body).not.toHaveFocus();
    // sin texto vuelven
    await u.clear(cuadro());
    expect(screen.getByText('Ejemplos para empezar')).toBeInTheDocument();
  });

  it('asistente.foco.reintentar_deja_el_foco_en_el_cuadro', async () => {
    let bien = false;
    const { u } = await abrir({
      cuadro: false,
      guion: { config: () => (bien ? json(CONFIG) : falla(503, 'no_disponible', 'El Asistente no está disponible por ahora. Inténtalo en unos minutos.')) },
    });
    await screen.findByRole('alert');
    bien = true;
    await u.click(screen.getByRole('button', { name: 'Reintentar' }));
    await waitFor(() => expect(cuadro()).toHaveFocus());
    expect(screen.queryByRole('button', { name: 'Reintentar' })).toBeNull();
  });

  it('tras reintentar, si hoy no se puede escribir, el foco va al título y no al <body>', async () => {
    const activo = false;
    let primera = true;
    const { u } = await abrir({
      cuadro: false,
      guion: {
        config: () => {
          if (primera) {
            primera = false;
            return falla(503, 'no_disponible', 'x');
          }
          return json({ ...CONFIG, activo });
        },
      },
    });
    await screen.findByRole('alert');
    await u.click(screen.getByRole('button', { name: 'Reintentar' }));
    await screen.findByRole('heading', { name: 'No está disponible por ahora' });
    expect(screen.getByRole('heading', { name: 'Cuéntanos qué quieres automatizar' })).toHaveFocus();
  });

  // ---------------------------------------------------------------- anuncios
  it('asistente.avisos.una_sola_region_viva_y_los_errores_no_se_duplican', async () => {
    let ok = true;
    const { u } = await abrir({
      tiempo: true,
      guion: { consultar: () => (ok ? json(listo()) : falla(404, 'no_encontrada', 'No encontramos ese pedido. Escribe de nuevo qué quieres automatizar.')) },
    });
    expect(regionViva()).toHaveTextContent('');
    await armarConTexto(u);
    // la espera se anuncia desde la región viva, con el paso en curso, y los pasos de la lista no son regiones vivas
    expect(regionViva().textContent).toBe('Armando tu flujo. Entendiendo lo que pides…');
    expect(within(screen.getByRole('list', { name: 'Pasos' })).queryByRole('status')).toBeNull();
    expect(screen.getAllByText(/Entendiendo lo que pides/)).toHaveLength(2); // el paso de la lista y la región viva
    await pasar(5100);
    await tituloListo();
    // el resultado no se repite en la región viva: lo dice el foco que llega a su encabezado
    expect(regionViva()).toHaveTextContent('');
    expect(screen.queryByRole('alert')).toBeNull();
    // un error se anuncia SOLO como alerta (una), y la región viva no lo repite
    ok = false;
    await u.click(botonArmar());
    await pasar(5100);
    const alertas = await screen.findAllByRole('alert');
    expect(alertas).toHaveLength(1);
    expect(regionViva()).toHaveTextContent('');
  });

  // ---------------------------------------------------------------- privacidad
  it('asistente.privacidad.lo_escrito_no_toca_el_almacenamiento', async () => {
    const poner = vi.spyOn(Storage.prototype, 'setItem');
    const leer = vi.spyOn(Storage.prototype, 'getItem');
    const ir = vi.fn();
    const { u, f } = await abrir({ tiempo: true, props: { ir } });
    await hastaElResultado(u);
    await u.click(screen.getByRole('button', { name: 'Descargar .json' }));
    // armar, esperar, descargar: ni una lectura ni una escritura en localStorage ni sessionStorage
    expect(poner).not.toHaveBeenCalled();
    expect(leer).not.toHaveBeenCalled();
    expect(localStorage.length + sessionStorage.length).toBe(0);
    // lo único que sale del navegador es el pedido al servidor, sin apartarlo
    expect(pedidos(f)).toHaveLength(1);
    expect(cuerpoDe(pedidos(f)[0]!)).toEqual({ texto: TEXTO });
    // el único almacenamiento es el del traspaso al Constructor, y ahí va el FLUJO, no el pedido
    await u.click(screen.getByRole('button', { name: 'Abrir en el constructor' }));
    expect(poner).toHaveBeenCalledTimes(1);
    expect(poner.mock.calls[0]![0]).toBe(CLAVE_BORRADOR);
    expect(String(poner.mock.calls[0]![1])).not.toContain('hoja de cálculo');
    expect(String(poner.mock.calls[0]![1])).not.toContain(TEXTO);
    expect(ir).toHaveBeenCalledExactlyOnceWith('/estudio/automatizaciones/distrito/constructor/');
  });

  // ---------------------------------------------------------------- la pestaña
  it('asistente.pestana.la_pestana_dice_armando_y_al_final_listo', async () => {
    const { u } = await abrir({ tiempo: true });
    expect(document.title).toBe(pestana);
    await armarConTexto(u);
    await waitFor(() => expect(document.title).toBe(`Armando tu flujo · ${pestana}`));
    await pasar(5100);
    await tituloListo();
    await waitFor(() => expect(document.title).toBe(`Tu flujo está listo · ${pestana}`));
  });

  it('al armar otro flujo el resultado anterior se va: no se mezcla con el pedido nuevo', async () => {
    const { u } = await abrir({ tiempo: true });
    await hastaElResultado(u);
    await u.click(botonArmar());
    expect(screen.queryByRole('heading', { name: 'Tu flujo está listo' })).toBeNull();
    expect(screen.getByRole('list', { name: 'Pasos' })).toBeInTheDocument();
    await pasar(5100);
    await tituloListo();
  });

  it('al desmontar la pantalla con un armado en curso no queda nada corriendo', async () => {
    const { u, f, unmount } = await abrir({ tiempo: true });
    await armarConTexto(u);
    unmount();
    await pasar(60_000);
    expect(consultas(f)).toHaveLength(0);
  });

  // ---------------------------------------------------------------- lo que dejó la revisión de la interfaz
  it('asistente.estados.un_limite_o_un_armado_en_curso_no_invitan_a_pulsar_armar_flujo_otra_vez_como_si_nada', async () => {
    const casos: [number, string, string, RegExp][] = [
      [429, 'agotado', 'Llegaste al límite de hoy. Vuelve mañana.', /Vuelve mañana/],
      [409, 'en_curso', 'Ya estamos armando otro flujo para ti, quizá en otra pestaña. Espera a que termine.', /Espera a que termine/],
      [402, 'sin_saldo', 'No te alcanzan los créditos para armar este flujo.', /recargues/],
    ];
    for (const [estado, codigo, texto, sigue] of casos) {
      const { u, unmount } = await abrir({ tiempo: true, guion: { armar: () => falla(estado, codigo, texto) } });
      await armarConTexto(u);
      const alerta = await screen.findByRole('alert');
      expect(alerta, codigo).toHaveTextContent(texto);
      // «Qué sigue» no se contradice con «Qué pasó»: nada de «Pulsa «Armar flujo» para intentarlo otra vez» tras «vuelve mañana»
      expect(alerta, codigo).not.toHaveTextContent(/Pulsa «Armar flujo» para intentarlo otra vez/);
      expect(alerta, codigo).toHaveTextContent(sigue);
      expect(cuadro(), codigo).toHaveValue(TEXTO);
      unmount();
    }
  });

  it('asistente.resultado.un_doble_clic_en_abrir_en_el_constructor_abre_una_vez_y_no_pregunta_si_reemplazar', async () => {
    const almacen = memoria();
    const ir = vi.fn();
    const { u } = await abrir({ tiempo: true, props: { ir, almacen } });
    await hastaElResultado(u);
    await u.dblClick(screen.getByRole('button', { name: 'Abrir en el constructor' }));
    // el primer clic escribe el borrador y navega; el segundo veía «ya hay un flujo» (el recién escrito) y preguntaba si reemplazarlo
    expect(ir).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('asistente.limites.el_cuadro_tiene_un_tope_de_escritura_generoso_para_que_pegar_un_volcado_no_congele_la_pagina', async () => {
    await abrir({ guion: { config: () => json({ ...CONFIG, largo_maximo: 50 }) } });
    // 4 veces el máximo: deja pasar un poco de más (para que «Es muy largo» se pueda decir) pero no millones de caracteres sin cortes
    expect(cuadro()).toHaveAttribute('maxlength', '200');
  });

  it('asistente.limites.pasarse_del_maximo_se_anuncia_una_sola_vez_en_la_region_viva_y_otra_al_volver_a_pasarse', async () => {
    const { u } = await abrir({ guion: { config: () => json({ ...CONFIG, largo_maximo: 50 }) } });
    await u.click(cuadro());
    await u.paste('a'.repeat(40));
    expect(regionViva().textContent?.trim()).toBe('');
    await u.paste('a'.repeat(20)); // cruza el máximo: 60
    expect(regionViva()).toHaveTextContent('Es muy largo: el máximo es de 50 caracteres y llevas 60.');
    // seguir escribiendo por encima del máximo NO lo repite cada vez
    const dicho = regionViva().textContent;
    await u.type(cuadro(), 'bcd');
    expect(regionViva().textContent).toBe(dicho);
    // al volver a caber y pasarse otra vez, se dice de nuevo
    await u.clear(cuadro());
    await u.paste('a'.repeat(30));
    await u.paste('a'.repeat(30));
    expect(regionViva()).toHaveTextContent('llevas 60');
    expect(regionViva().textContent).not.toBe(dicho);
  });

  it('asistente.foco.un_fallo_del_servicio_no_le_quita_el_foco_al_boton_y_uno_del_texto_si_lo_manda_al_cuadro', async () => {
    // un 500: no hay nada que corregir en el texto, y mover el foco al mismo tiempo que entra el alert puede cortar el anuncio
    const a = await abrir({ tiempo: true, guion: { armar: () => falla(500, 'otro', 'Algo salió mal de nuestro lado. Inténtalo otra vez en unos minutos.') } });
    await armarConTexto(a.u);
    expect(await screen.findByRole('alert')).toHaveTextContent('Algo salió mal de nuestro lado');
    expect(botonArmar()).toHaveFocus();
    expect(cuadro()).not.toHaveFocus();
    a.unmount();
    // un 422 de moderación sí es del texto: el foco va al cuadro (lo que existía)
    const b = await abrir({ tiempo: true, guion: { armar: () => falla(422, 'moderacion', 'Esta petición no la podemos armar. Prueba describiéndola de otra forma.') } });
    await armarConTexto(b.u);
    await screen.findByRole('alert');
    expect(cuadro()).toHaveFocus();
    b.unmount();
    // y si la persona ya se había ido a otra parte de la página, el fallo no le roba el foco (ni siquiera a un botón)
    const c = await abrir({ tiempo: true, guion: { armar: () => falla(500, 'otro', 'Algo salió mal de nuestro lado.') } });
    await armarConTexto(c.u);
    await screen.findByRole('alert');
    expect(document.body).not.toHaveFocus();
  });

  it('asistente.marco.el_cuadro_de_escribir_no_se_anuncia_dos_veces_como_region_y_como_campo', async () => {
    await abrir();
    // la <section aria-labelledby> tomaba su nombre del mismo <label> del campo: «Cuéntale qué necesitas» como región y como cuadro de texto
    expect(screen.queryByRole('region', { name: 'Cuéntale qué necesitas' })).toBeNull();
    expect(cuadro()).toBeInTheDocument();
  });

  it('asistente.marco.el_titulo_de_la_pantalla_parte_una_palabra_larga_en_vez_de_desbordar_a_320_px', async () => {
    await abrir();
    const h2 = screen.getByRole('heading', { level: 2, name: 'Cuéntanos qué quieres automatizar' });
    expect(h2.className).toContain('[overflow-wrap:anywhere]');
  });
});
