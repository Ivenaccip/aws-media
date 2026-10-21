// Las páginas de nivel (PaginaNivel, GrupoConBlotato y la entrada nivel.tsx): lo mismo que el inicio enseñaba en cada paso, como PÁGINAS con
// su dirección. Sin el prefijo `inicio.`: son pruebas de las direcciones, no invariantes del registro de migración
// (docs/migracion/inicio.md · «Rutas por nivel»).
import { existsSync, readFileSync, statSync } from 'node:fs';
import * as ruta from 'node:path';
import { fileURLToPath } from 'node:url';

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MENU } from '../../../marca/menu';
import { json, llamadas, servidor } from '../../../prueba/servidor';
import { Grupos } from '../Grupos';
import { NoEncontrada } from './NoEncontrada';
import { PaginaNivel, type PropsPaginaNivel } from './PaginaNivel';

// nivel.tsx monta la página al cargarse: aquí `montar` es un espía (no hay #raiz) y se mira con qué lo llamó
vi.mock('../../../nucleo/montar', () => ({ montar: vi.fn() }));

// Cuántas veces se CARGÓ (se evaluó) Blotato y su lógica: las páginas de nivel las piden con import() y solo donde y cuando hacen falta. El módulo
// de verdad se entrega tal cual; solo se cuenta (la prueba que lo mira los registra después de reiniciar los módulos: se cachean).
const cargas = { blotato: 0, logica: 0 };

let ir: ReturnType<typeof vi.fn<(url: string) => void>>;
beforeEach(() => {
  vi.unstubAllGlobals();
  ir = vi.fn<(url: string) => void>();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  // por si la prueba que cuenta cargas dejó registrados sus espías
  vi.doUnmock('../Blotato');
  vi.doUnmock('../logica');
  // jsdom conserva la dirección y el título entre pruebas
  history.replaceState(null, '', '/');
  document.title = '';
});

const pintar = (nivel: PropsPaginaNivel['nivel']) => render(<PaginaNivel nivel={nivel} ir={ir} />);
/**
 * Pinta con los módulos como si la página se abriera por primera vez. `lazy()` y `import()` guardan lo que ya cargaron: sin reiniciar, solo
 * la primera prueba de este archivo vería lo que pasa MIENTRAS llega el código (una pantalla de espera que luego se cambia por la de verdad).
 */
async function pintarComoLaPrimeraVez(nivel: PropsPaginaNivel['nivel']) {
  vi.resetModules();
  const { PaginaNivel: Pagina } = await import('./PaginaNivel');
  return render(<Pagina nivel={nivel} ir={ir} />);
}
const hrefs = (el: HTMLElement) => within(el).getAllByRole('link').map(a => a.getAttribute('href'));
/** La lista de herramientas del grupo (la `ul`; las migas son otra lista, la `ol`). */
const lista = () => document.querySelector<HTMLElement>('main ul')!;
const migasDeLaPagina = () => screen.getByRole('navigation', { name: 'Dónde estás' });
const SIN_CLAVE = { conectado: false, origen: null, cuentas: [], error: null, plan: null };

/**
 * Un clic, y si SIGUIÓ SU CAMINO (llegó hasta el documento sin que nadie lo cancelara: un enlace habría navegado). La guarda del doble clic
 * lo cancela y lo detiene en la captura, así que no llega. Cancelarlo aquí, al final, también evita el «Not implemented: navigation» de jsdom.
 */
function clic(el: Element, init?: MouseEventInit): boolean {
  let llego = false;
  const alLlegar = (e: Event) => {
    llego = !e.defaultPrevented;
    e.preventDefault();
  };
  window.addEventListener('click', alLlegar);
  try {
    fireEvent.click(el, init);
  } finally {
    window.removeEventListener('click', alLlegar);
  }
  return llego;
}

describe('niveles · el mapa', () => {
  it('niveles.mapa.las_tres_areas_que_se_abren_son_enlaces_y_producto_y_ventas_siguen_apagadas: no llevan a ningún lado', () => {
    pintar({ tipo: 'mapa' });
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Elige un área');
    expect(hrefs(screen.getByRole('group', { name: 'Áreas' }))).toEqual(['/estudio/marketing/', '/estudio/central/', '/estudio/automatizaciones/']);
    for (const nombre of [/^Producto/, /^Ventas/]) {
      const ficha = screen.getByRole('button', { name: nombre });
      expect(ficha).toHaveAttribute('aria-disabled', 'true');
      expect(ficha).toHaveTextContent('Próximamente');
      fireEvent.click(ficha);
    }
    expect(ir).not.toHaveBeenCalled();
  });

  it('niveles.mapa.el_orden_de_tab_es_el_de_lectura: las apagadas siguen en el orden (botones con aria-disabled, no huecos)', () => {
    pintar({ tipo: 'mapa' });
    const enOrden = Array.from(screen.getByRole('group', { name: 'Áreas' }).querySelectorAll<HTMLElement>('a[href], button')).map(el => ({
      etiqueta: el.tagName.toLowerCase(),
      texto: el.textContent?.replace('Próximamente', '').trim(),
    }));
    expect(enOrden).toEqual([
      { etiqueta: 'a', texto: 'Marketing' },
      { etiqueta: 'button', texto: 'Producto' },
      { etiqueta: 'a', texto: 'Central' },
      { etiqueta: 'button', texto: 'Ventas' },
      { etiqueta: 'a', texto: 'Automatizaciones' },
    ]);
    // un botón con aria-disabled sigue siendo enfocable: no lleva `disabled` ni tabindex negativo
    for (const b of screen.getAllByRole('button')) {
      expect(b).not.toBeDisabled();
      expect(b.tabIndex).toBeGreaterThanOrEqual(0);
    }
  });

  it('niveles.mapa.no_hay_migas_y_irremplazables_es_el_unico_h1', () => {
    pintar({ tipo: 'mapa' });
    expect(screen.queryByRole('navigation', { name: 'Dónde estás' })).toBeNull();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Irremplazables');
  });

  it('niveles.mapa.esc_no_hace_nada_y_la_pagina_no_pide_nada_a_la_api', () => {
    const f = servidor({});
    pintar({ tipo: 'mapa' });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(ir).not.toHaveBeenCalled();
    expect(f).not.toHaveBeenCalled();
  });
});

describe('niveles · un área', () => {
  it('niveles.area.las_opciones_son_enlaces_a_la_pagina_de_cada_grupo: y la miga del área vuelve al mapa como siempre', () => {
    pintar({ tipo: 'area', area: 'mkt' });
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Elige un grupo');
    expect(hrefs(screen.getByRole('group', { name: 'Marketing' }))).toEqual([
      '/estudio/marketing/distrito/',
      '/estudio/marketing/blotato/',
      '/estudio/marketing/avanzado/',
    ]);
    const miga = within(migasDeLaPagina()).getByRole('link', { name: /^Volver al mapa/ });
    expect(miga).toHaveAttribute('href', '/estudio/');
    expect(miga).toHaveAttribute('aria-current', 'step');
    expect(migasDeLaPagina()).toHaveTextContent('Marketing');
  });

  it('niveles.area.ninguna_tarjeta_dice_estas_aqui: la dirección ya dice dónde estás', () => {
    pintar({ tipo: 'area', area: 'mkt' });
    expect(screen.queryByText('Estás aquí')).toBeNull();
    for (const a of within(screen.getByRole('group', { name: 'Marketing' })).getAllByRole('link')) expect(a).not.toHaveAttribute('aria-current');
  });

  it('niveles.area.esc_sube_al_mapa: con la página recién cargada, sin foco dentro de la sección', () => {
    pintar({ tipo: 'area', area: 'central' });
    expect(document.activeElement).toBe(document.body);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(ir).toHaveBeenCalledTimes(1);
    expect(ir).toHaveBeenCalledWith('/estudio/');
  });

  it('niveles.area.otra_tecla_no_navega: solo Escape', () => {
    pintar({ tipo: 'area', area: 'central' });
    for (const key of ['Enter', 'Backspace', 'ArrowLeft', 'Esc']) fireEvent.keyDown(document, { key });
    expect(ir).not.toHaveBeenCalled();
  });

  it('niveles.area.esc_que_ya_atendio_un_menu_no_navega: el que lo atendió lo marcó con preventDefault', () => {
    pintar({ tipo: 'area', area: 'central' });
    const e = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    e.preventDefault();
    document.dispatchEvent(e);
    expect(ir).not.toHaveBeenCalled();
  });

  it('niveles.area.esc_se_atiende_una_vez_y_el_oyente_se_va_con_la_pagina', () => {
    const { unmount } = pintar({ tipo: 'area', area: 'central' });
    const e = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    document.dispatchEvent(e);
    // Esc atendido: se marca para que nadie más lo repita
    expect(e.defaultPrevented).toBe(true);
    expect(ir).toHaveBeenCalledTimes(1);
    unmount();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(ir).toHaveBeenCalledTimes(1);
  });

  it('niveles.area.producto_un_area_proximamente_tiene_su_pagina_y_lo_dice: Esc también sube al mapa', () => {
    pintar({ tipo: 'area', area: 'producto' });
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Producto');
    expect(screen.getByText('Todavía no está disponible.')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Producto' })).toBeNull();
    expect(within(migasDeLaPagina()).getByRole('link')).toHaveAttribute('href', '/estudio/');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(ir).toHaveBeenCalledWith('/estudio/');
  });

  it('niveles.area.central_lista_sus_dos_grupos_y_el_vacio_tambien_tiene_pagina', () => {
    pintar({ tipo: 'area', area: 'central' });
    expect(hrefs(screen.getByRole('group', { name: 'Central' }))).toEqual(['/estudio/central/distrito/', '/estudio/central/deepseek/']);
  });
});

describe('niveles · un grupo', () => {
  it('niveles.grupo.distrito_de_marketing_lista_las_tres_herramientas_de_la_caja_como_enlaces_a_su_pagina', () => {
    const f = servidor({});
    pintar({ tipo: 'grupo', area: 'mkt', grupo: 'distrito' });
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Distrito');
    expect(hrefs(lista())).toEqual(['/estudio/marketing/distrito/imagen/', '/estudio/marketing/distrito/video/', '/estudio/marketing/distrito/edicion/']);
    // sin Caja no hay nada que pedir: ni listas, ni Blotato, ni saldo
    expect(f).not.toHaveBeenCalled();
  });

  it('niveles.grupo.las_migas_son_enlaces_con_la_semantica_de_hoy: el area abre el mapa y el grupo, las opciones del area', () => {
    pintar({ tipo: 'grupo', area: 'mkt', grupo: 'distrito' });
    expect(hrefs(migasDeLaPagina())).toEqual(['/estudio/', '/estudio/marketing/']);
    const [delArea, delGrupo] = within(migasDeLaPagina()).getAllByRole('link');
    expect(delArea).toHaveAttribute('aria-label', 'Volver al mapa para cambiar de área (ahora: Marketing)');
    expect(delArea).not.toHaveAttribute('aria-current');
    expect(delGrupo).toHaveAttribute('aria-label', 'Volver a las opciones de Marketing (ahora: Distrito)');
    expect(delGrupo).toHaveAttribute('aria-current', 'step');
  });

  it('niveles.grupo.el_titulo_del_grupo_no_se_centra_como_los_del_mapa_y_las_opciones: va a la izquierda, con su lista', () => {
    const { unmount } = pintar({ tipo: 'grupo', area: 'mkt', grupo: 'distrito' });
    expect(screen.getByRole('heading', { level: 2 }).className).not.toMatch(/mx-auto|text-center/);
    unmount();
    pintar({ tipo: 'mapa' });
    expect(screen.getByRole('heading', { level: 2 }).className).toMatch(/mx-auto.*text-center/);
  });

  it('niveles.grupo.esc_no_hace_nada_en_la_lista_de_un_grupo', () => {
    pintar({ tipo: 'grupo', area: 'mkt', grupo: 'distrito' });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(ir).not.toHaveBeenCalled();
  });

  it('niveles.grupo.las_hojas_conservan_su_direccion_y_las_que_no_existen_siguen_quietas: salen de menu.ts, no de una lista aparte', () => {
    pintar({ tipo: 'grupo', area: 'central', grupo: 'distrito' });
    const grupo = MENU.find(a => a.clave === 'central')!.grupos.find(g => g.clave === 'distrito')!;
    expect(hrefs(lista())).toEqual(grupo.pantallas.filter(p => p.href).map(p => p.href));
    expect(hrefs(lista())).toHaveLength(2);
    // Próximamente: una tarjeta quieta, sin ser un enlace que no lleva a nada
    for (const titulo of ['Preguntas sobre la clase', 'Glosario IA']) {
      expect(screen.getByText(titulo).closest('a')).toBeNull();
      expect(screen.getByText(titulo).closest('li')).toHaveTextContent('Próximamente');
    }
  });

  it('niveles.grupo.un_grupo_sin_pantallas_lo_dice: Deepseek y Tus automatizaciones', () => {
    for (const [area, grupo] of [
      ['central', 'deepseek'],
      ['automatizaciones', 'tus'],
    ] as const) {
      const { unmount } = pintar({ tipo: 'grupo', area, grupo });
      expect(screen.getByText('Todavía no está disponible.')).toBeInTheDocument();
      expect(document.querySelector('main ul')).toBeNull();
      unmount();
    }
  });
});

describe('niveles · Blotato solo donde se usa', () => {
  it('niveles.blotato.sin_la_clave_sus_tres_herramientas_se_apagan_y_el_boton_ofrece_conectar', async () => {
    const f = servidor({ '/api/blotato': () => json(SIN_CLAVE) });
    pintar({ tipo: 'grupo', area: 'mkt', grupo: 'blotato' });
    // la lista llega con todo encendido (no se sabe aún) y se apaga cuando contesta Blotato: es OTRO nodo, se vuelve a buscar
    await screen.findByRole('link', { name: /Agenda tus publicaciones/ });
    await waitFor(() => expect(screen.getByRole('link', { name: /Agenda tus publicaciones/ })).toHaveAttribute('aria-disabled', 'true'));
    for (const nombre of [/Investiga tu competencia/, /Ver mis métricas/]) {
      expect(screen.getByRole('link', { name: nombre })).toHaveAttribute('aria-disabled', 'true');
    }
    expect(screen.getByRole('button', { name: 'Conecta tu cuenta de Blotato' })).toBeInTheDocument();
    expect(llamadas(f, '/api/blotato?redes=0', 'GET')).toHaveLength(1);
  });

  it('niveles.blotato.con_la_clave_todo_queda_encendido_y_el_boton_dice_ver_o_cambiar', async () => {
    servidor({ '/api/blotato': () => json({ ...SIN_CLAVE, conectado: true }) });
    pintar({ tipo: 'grupo', area: 'mkt', grupo: 'blotato' });
    await screen.findByRole('button', { name: 'Blotato conectado: ver o cambiar' });
    for (const a of within(lista()).getAllByRole('link')) expect(a).not.toHaveAttribute('aria-disabled');
    expect(hrefs(lista())).toEqual(['/agenda.html', '/competencia.html', '/metricas.html']);
  });

  it('niveles.blotato.mientras_no_se_sabe_o_si_la_consulta_falla_no_se_apaga_nada', async () => {
    const f = servidor({ '/api/blotato': () => Promise.reject(new TypeError('Failed to fetch')) });
    pintar({ tipo: 'grupo', area: 'mkt', grupo: 'blotato' });
    await screen.findByRole('link', { name: /Agenda tus publicaciones/ });
    await waitFor(() => expect(llamadas(f, '/api/blotato?redes=0', 'GET')).toHaveLength(1));
    // dejar que la consulta fallida termine antes de mirar
    await new Promise(r => setTimeout(r, 0));
    for (const a of within(lista()).getAllByRole('link')) expect(a).not.toHaveAttribute('aria-disabled');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('niveles.blotato.avanzado_apaga_solo_lo_que_depende_de_blotato_y_no_ofrece_conectar: MIX sí, la Copiadora de estilos no', async () => {
    servidor({ '/api/blotato': () => json(SIN_CLAVE) });
    pintar({ tipo: 'grupo', area: 'mkt', grupo: 'avanzado' });
    await waitFor(() => expect(screen.getByRole('link', { name: /Publicaciones automáticas/ })).toHaveAttribute('aria-disabled', 'true'));
    expect(screen.getByRole('link', { name: /Copiadora de estilos/ })).not.toHaveAttribute('aria-disabled');
    // el botón de conectar es de un grupo que depende ENTERO de Blotato
    expect(screen.queryByRole('button', { name: /Blotato/ })).toBeNull();
  });

  it('niveles.blotato.el_clic_en_una_apagada_ofrece_conectar_en_vez_de_navegar', async () => {
    const f = servidor({ '/api/blotato': () => json(SIN_CLAVE) });
    pintar({ tipo: 'grupo', area: 'mkt', grupo: 'blotato' });
    await waitFor(() => expect(screen.getByRole('link', { name: /Agenda tus publicaciones/ })).toHaveAttribute('aria-disabled', 'true'));
    // el clic NO sigue su camino (conectar lo cancela) y abre el diálogo, que lee el estado completo
    expect(clic(screen.getByRole('link', { name: /Agenda tus publicaciones/ }))).toBe(false);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await waitFor(() => expect(llamadas(f, '/api/blotato', 'GET')).toHaveLength(1));
  });

  it('niveles.blotato.con_blotato_conectar_en_la_direccion_abre_el_dialogo_y_no_limpia_el_parametro', async () => {
    history.replaceState(null, '', '/estudio/marketing/blotato/?blotato=conectar');
    const f = servidor({ '/api/blotato': () => json(SIN_CLAVE) });
    pintar({ tipo: 'grupo', area: 'mkt', grupo: 'blotato' });
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    // la lectura completa del diálogo (no la ligera de `?redes=0`) y una sola
    await waitFor(() => expect(llamadas(f, '/api/blotato', 'GET')).toHaveLength(1));
    expect(llamadas(f, '/api/blotato?redes=0', 'GET')).toHaveLength(0);
    // como el inicio de hoy: ?blotato=conectar se queda (recargar vuelve a ofrecer conectar)
    expect(location.pathname + location.search).toBe('/estudio/marketing/blotato/?blotato=conectar');
  });

  it('niveles.blotato.un_grupo_que_no_usa_blotato_no_le_pregunta_nada: Distrito, en el mapa y en las opciones tampoco', () => {
    const f = servidor({ '/api/blotato': () => json(SIN_CLAVE) });
    pintar({ tipo: 'grupo', area: 'mkt', grupo: 'distrito' });
    expect(f).not.toHaveBeenCalled();
  });

  it('niveles.blotato.la_lista_es_la_misma_cuando_llegan_el_estado_y_el_codigo: el foco de quien ya estaba tabulando se queda donde estaba', async () => {
    servidor({ '/api/blotato': () => json({ ...SIN_CLAVE, conectado: true }) });
    await pintarComoLaPrimeraVez({ tipo: 'grupo', area: 'mkt', grupo: 'blotato' });
    // desde el primer pintado: la lista de espera no es OTRO árbol que React cambie por el de verdad (eso desmontaba los nodos y el
    // foco caía a <body>)
    const tarjeta = screen.getByRole('link', { name: /Investiga tu competencia/ });
    tarjeta.focus();
    expect(document.activeElement).toBe(tarjeta);
    await screen.findByRole('button', { name: 'Blotato conectado: ver o cambiar' });
    expect(screen.getByRole('link', { name: /Investiga tu competencia/ })).toBe(tarjeta);
    expect(document.activeElement).toBe(tarjeta);
  });

  it('niveles.blotato.el_boton_de_conectar_funciona_desde_el_primer_pintado_y_no_espera_al_codigo_de_la_lista', async () => {
    const f = servidor({ '/api/blotato': () => json(SIN_CLAVE) });
    await pintarComoLaPrimeraVez({ tipo: 'grupo', area: 'mkt', grupo: 'blotato' });
    // antes de que conteste nada: el botón de la espera era de mentira (no hacía nada) y luego se cambiaba por el de verdad
    fireEvent.click(screen.getByRole('button', { name: 'Conecta tu cuenta de Blotato' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await waitFor(() => expect(llamadas(f, '/api/blotato', 'GET')).toHaveLength(1));
  });

  it('niveles.blotato.el_dialogo_y_la_logica_solo_se_cargan_donde_y_cuando_hacen_falta', async () => {
    servidor({ '/api/blotato': () => json(SIN_CLAVE) });
    // (cada pintada reinicia los módulos: se cachean, y otra prueba de este archivo ya los habría cargado)
    cargas.blotato = 0;
    cargas.logica = 0;
    vi.doMock('../Blotato', async (importOriginal: () => Promise<object>) => {
      cargas.blotato += 1;
      return importOriginal();
    });
    vi.doMock('../logica', async (importOriginal: () => Promise<object>) => {
      cargas.logica += 1;
      return importOriginal();
    });
    // ni el mapa, ni un área, ni un grupo que no usa Blotato los traen
    for (const nivel of [{ tipo: 'mapa' }, { tipo: 'area', area: 'mkt' }, { tipo: 'grupo', area: 'mkt', grupo: 'distrito' }] as const) {
      const { unmount } = await pintarComoLaPrimeraVez(nivel);
      unmount();
    }
    await new Promise(r => setTimeout(r, 20));
    expect(cargas).toEqual({ blotato: 0, logica: 0 });

    // Avanzado solo necesita saber si hay cuenta: lee su estado (la lógica) y deja el diálogo (Radix, Confirmar…) para quien lo abra
    await pintarComoLaPrimeraVez({ tipo: 'grupo', area: 'mkt', grupo: 'avanzado' });
    await waitFor(() => expect(screen.getByRole('link', { name: /Publicaciones automáticas/ })).toHaveAttribute('aria-disabled', 'true'));
    expect(cargas.logica).toBe(1);
    expect(cargas.blotato).toBe(0);

    // el clic en la apagada ofrece conectar: ahí sí se pide el diálogo
    expect(clic(screen.getByRole('link', { name: /Publicaciones automáticas/ }))).toBe(false);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(cargas.blotato).toBe(1);
  });
});

describe('niveles · el doble clic', () => {
  it('niveles.doble_clic.el_segundo_clic_recien_cargada_la_pagina_se_descarta_y_el_enlace_no_navega', () => {
    pintar({ tipo: 'mapa' });
    const marketing = screen.getByRole('link', { name: /^Marketing/ });
    expect(clic(marketing, { detail: 2 })).toBe(false);
    // un clic sencillo y el teclado (Enter: detail 0) pasan
    expect(clic(marketing, { detail: 1 })).toBe(true);
    expect(clic(marketing, { detail: 0 })).toBe(true);
  });

  it('niveles.doble_clic.vale_para_toda_la_seccion: la tarjeta de un grupo, una herramienta y una miga', () => {
    const { unmount } = pintar({ tipo: 'area', area: 'mkt' });
    expect(clic(screen.getByRole('link', { name: /^Distrito/ }), { detail: 2 })).toBe(false);
    expect(clic(within(migasDeLaPagina()).getByRole('link'), { detail: 2 })).toBe(false);
    unmount();
    servidor({});
    pintar({ tipo: 'grupo', area: 'mkt', grupo: 'distrito' });
    expect(clic(screen.getByRole('link', { name: /^Imagen/ }), { detail: 2 })).toBe(false);
    expect(clic(screen.getByRole('link', { name: /^Imagen/ }), { detail: 1 })).toBe(true);
  });

  it('niveles.doble_clic.pasado_el_medio_segundo_un_clic_doble_ya_es_deliberado', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    pintar({ tipo: 'mapa' });
    const marketing = screen.getByRole('link', { name: /^Marketing/ });
    vi.setSystemTime(Date.now() + 400);
    expect(clic(marketing, { detail: 2 })).toBe(false);
    vi.setSystemTime(Date.now() + 200);
    expect(clic(marketing, { detail: 2 })).toBe(true);
  });

  it('niveles.doble_clic.una_ficha_apagada_no_navega_ni_con_doble_clic', () => {
    pintar({ tipo: 'mapa' });
    const producto = screen.getByRole('button', { name: /^Producto/ });
    clic(producto, { detail: 2 });
    clic(producto, { detail: 1 });
    expect(ir).not.toHaveBeenCalled();
  });
});

/** Lo que de `node:path` se usa para comparar rutas: la de la plataforma, o `win32` / `posix` para probar la otra desde cualquier sitio. */
type RutaDeNode = Pick<typeof ruta, 'relative' | 'sep' | 'isAbsolute'>;

/**
 * Los archivos de `archivos` que cuelgan de `raiz`, como rutas relativas SIEMPRE con «/» y ordenadas. En Windows `relative` devuelve
 * «niveles\nivel.tsx» y un `startsWith(raiz + '/')` no encuentra nada: la prueba del cierre de imports quedaría vacía y rota.
 */
function colgantes(raiz: string, archivos: Iterable<string>, r: RutaDeNode = ruta): string[] {
  return [...archivos]
    .map(a => r.relative(raiz, a))
    .filter(rel => rel !== '' && rel !== '..' && !rel.startsWith(`..${r.sep}`) && !r.isAbsolute(rel))
    .map(rel => rel.split(r.sep).join('/'))
    .sort();
}

describe('niveles · el mapa de la dirección a la página', () => {
  it('niveles.sin_caja.la_lista_de_archivos_sale_igual_con_el_separador_de_windows_que_con_el_de_unix', () => {
    const unix = colgantes(
      '/r/src/pantallas/inicio',
      ['/r/src/pantallas/inicio/Mapa.tsx', '/r/src/pantallas/inicio/niveles/nivel.tsx', '/r/src/pantallas/inicio2/X.tsx', '/r/src/marca/rutas.ts', '/r/src/pantallas/inicio'],
      ruta.posix,
    );
    const windows = colgantes(
      'C:\\r\\src\\pantallas\\inicio',
      [
        'C:\\r\\src\\pantallas\\inicio\\Mapa.tsx',
        'C:\\r\\src\\pantallas\\inicio\\niveles\\nivel.tsx',
        'C:\\r\\src\\pantallas\\inicio2\\X.tsx',
        'C:\\r\\src\\marca\\rutas.ts',
        'C:\\r\\src\\pantallas\\inicio',
        'D:\\otro\\disco\\Y.tsx',
      ],
      ruta.win32,
    );
    expect(unix).toEqual(['Mapa.tsx', 'niveles/nivel.tsx']);
    expect(windows).toEqual(unix);
  });

  it('niveles.sin_caja.ninguna_pagina_de_nivel_trae_la_caja_ni_Blotato_en_su_cierre_de_imports: Blotato solo por import()', () => {
    const { resolve, dirname } = ruta;
    const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
    const INICIO = resolve(SRC, 'pantallas', 'inicio');
    // los imports estáticos de un archivo (`import type` no cuenta: no llega al navegador); `import()` tampoco, y esa es la idea
    const estaticos = (archivo: string): string[] => {
      if (!/\.tsx?$/.test(archivo)) return [];
      const codigo = readFileSync(archivo, 'utf8');
      const especificadores = [
        ...codigo.matchAll(/^\s*(?:import|export)\s+(?!type\b)[\w*${},\s]+?\s+from\s+['"]([^'"]+)['"]/gm),
        ...codigo.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm),
      ].map(m => m[1]!);
      const resueltos: string[] = [];
      for (const e of especificadores) {
        if (!e.startsWith('.')) continue;
        const base = resolve(dirname(archivo), e);
        const hallado = [base, `${base}.ts`, `${base}.tsx`].find(c => existsSync(c) && statSync(c).isFile());
        if (!hallado) throw new Error(`${ruta.relative(SRC, archivo)}: no encuentro «${e}»`);
        resueltos.push(hallado);
      }
      return resueltos;
    };
    const cierre = new Set<string>();
    const pendientes = [resolve(INICIO, 'niveles', 'nivel.tsx')];
    for (let a = pendientes.pop(); a !== undefined; a = pendientes.pop()) {
      if (cierre.has(a)) continue;
      cierre.add(a);
      pendientes.push(...estaticos(a));
    }
    const dentroDeInicio = colgantes(INICIO, cierre);
    expect(dentroDeInicio).toEqual(
      [
        'Grupos.tsx',
        'Mapa.tsx',
        'Pantallas.tsx',
        'estadoRecorrido.ts',
        'niveles/GrupoConBlotato.tsx',
        'niveles/LimiteDeCarga.tsx',
        'niveles/NoEncontrada.tsx',
        'niveles/PaginaNivel.tsx',
        'niveles/nivel.tsx',
        'niveles/navegar.ts',
      ].sort(),
    );
    // ninguna otra pantalla (otra carpeta de pantallas/) entra por la puerta de atrás
    expect(colgantes(resolve(SRC, 'pantallas'), cierre).filter(a => !a.startsWith('inicio/'))).toEqual([]);
    // y Blotato (el diálogo) y su lógica sí existen, pero SOLO detrás de un import(): ni la página ni el grupo los traen en su cierre
    expect(dentroDeInicio).not.toContain('Blotato.tsx');
    expect(dentroDeInicio).not.toContain('logica.ts');
    const grupo = readFileSync(resolve(INICIO, 'niveles', 'GrupoConBlotato.tsx'), 'utf8');
    expect(grupo).toMatch(/import\('\.\.\/Blotato'\)/);
    expect(grupo).toMatch(/import\('\.\.\/logica'\)/);
  });
});

describe('niveles · la página de «no encontramos esa página»', () => {
  it('niveles.noencontrada.dice_lo_que_paso_y_lleva_a_la_principal: un solo h1 y un enlace, como la 404 del servidor', () => {
    render(<NoEncontrada />);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('No encontramos esa página');
    expect(screen.getByText('La dirección no existe o cambió de lugar.')).toBeInTheDocument();
    expect(screen.getAllByRole('link').map(a => a.getAttribute('href'))).toEqual(['/estudio/']);
    expect(screen.getByRole('main')).toBeInTheDocument();
  });
});

describe('niveles · Grupos como enlaces (la rama con hrefDe)', () => {
  const marketing = MENU.find(a => a.clave === 'mkt')!;

  it('niveles.grupos.con_hrefDe_cada_tarjeta_es_un_enlace_y_la_del_grupo_donde_estas_lleva_aria_current_y_estas_aqui', () => {
    render(<Grupos area={marketing} aqui="blotato" alElegir={() => undefined} hrefDe={g => `/estudio/marketing/${g.clave}/`} />);
    const enlaces = within(screen.getByRole('group', { name: 'Marketing' })).getAllByRole('link');
    expect(enlaces.map(a => a.getAttribute('href'))).toEqual(['/estudio/marketing/distrito/', '/estudio/marketing/blotato/', '/estudio/marketing/avanzado/']);
    const aqui = enlaces.filter(a => a.getAttribute('aria-current') === 'location');
    expect(aqui).toHaveLength(1);
    expect(aqui[0]).toHaveAttribute('href', '/estudio/marketing/blotato/');
    expect(aqui[0]).toHaveTextContent('Estás aquí');
    for (const otra of enlaces.filter(a => a !== aqui[0])) {
      expect(otra).not.toHaveAttribute('aria-current');
      expect(otra).not.toHaveTextContent('Estás aquí');
    }
    expect(screen.getAllByText('Estás aquí')).toHaveLength(1);
  });

  it('niveles.grupos.sin_aqui_ninguna_tarjeta_dice_estas_aqui_y_hrefDe_no_la_vuelve_un_boton', () => {
    render(<Grupos area={marketing} aqui={null} alElegir={() => undefined} hrefDe={g => `/estudio/marketing/${g.clave}/`} />);
    expect(screen.queryByText('Estás aquí')).toBeNull();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    for (const a of screen.getAllByRole('link')) expect(a).not.toHaveAttribute('aria-current');
  });
});

describe('niveles · nivel.tsx, la entrada de las 13 páginas', () => {
  /** Carga la entrada como si el navegador abriera `direccion`; devuelve lo que se montó (o undefined si no se montó nada). */
  async function abrir(direccion: string) {
    history.replaceState({ guardado: true }, '', direccion);
    vi.resetModules();
    const { montar } = await import('../../../nucleo/montar');
    // el espía es el mismo en cada carga (la fábrica del mock no se repite): se vacía para contar solo esta
    vi.mocked(montar).mockClear();
    await import('./nivel');
    const llamada = vi.mocked(montar).mock.calls[0];
    return { montar: vi.mocked(montar), pagina: llamada?.[0] as { props: PropsPaginaNivel } | undefined };
  }

  it('niveles.entrada.monta_la_pagina_del_nivel_que_dice_la_direccion: el mapa, un área y un grupo', async () => {
    for (const [direccion, nivel] of [
      ['/estudio/', { tipo: 'mapa' }],
      ['/estudio/marketing/', { tipo: 'area', area: 'mkt' }],
      ['/estudio/central/distrito/', { tipo: 'grupo', area: 'central', grupo: 'distrito' }],
      ['/estudio/marketing/blotato/index.html', { tipo: 'grupo', area: 'mkt', grupo: 'blotato' }],
    ] as const) {
      const { montar, pagina } = await abrir(direccion);
      expect(montar).toHaveBeenCalledTimes(1);
      expect(pagina?.props.nivel).toEqual(nivel);
    }
  });

  it('niveles.entrada.la_direccion_escrita_con_porcentajes_monta_el_mismo_nivel_que_el_servidor_sirvio: nunca una pagina en blanco', async () => {
    // uvicorn decodifica la dirección antes de decidir qué página sirve (/estudio/%6Darketing/ → marketing) y el navegador la entrega cruda
    for (const [direccion, nivel] of [
      ['/estudio/%6Darketing/', { tipo: 'area', area: 'mkt' }],
      ['/estudio/%6darketing/', { tipo: 'area', area: 'mkt' }],
      ['/estudio/marketing/%64istrito/', { tipo: 'grupo', area: 'mkt', grupo: 'distrito' }],
      ['/estudio/marketing%2Fdistrito/', { tipo: 'grupo', area: 'mkt', grupo: 'distrito' }],
      ['/estudio/%63entral/distrito/index.html', { tipo: 'grupo', area: 'central', grupo: 'distrito' }],
    ] as const) {
      const { montar, pagina } = await abrir(direccion);
      expect(montar, direccion).toHaveBeenCalledTimes(1);
      expect(pagina?.props.nivel, direccion).toEqual(nivel);
    }
  });

  it('niveles.entrada.si_la_direccion_no_es_un_nivel_o_es_una_herramienta_de_la_caja_se_dice_en_vez_de_dejar_la_pagina_en_blanco', async () => {
    // una herramienta de la Caja tiene su propia entrada: si una página de nivel se abre en su dirección, tampoco hay nada que enseñar aquí
    for (const direccion of [
      '/estudio/coi/',
      '/estudio/marketing/distrito/video/',
      '/estudio/nada/',
      '/estudio/Marketing/',
      '/otra/',
      '/estudio/%6Dkt/',
      '/estudio/marketing/%/',
      '/estudio/%E0%A4%A/',
    ]) {
      const { montar } = await abrir(direccion);
      expect(montar, direccion).toHaveBeenCalledTimes(1);
      // (la entrada se cargó con los módulos reiniciados: es la MISMA página, no la misma función; se reconoce por su nombre)
      expect((montar.mock.calls[0]?.[0] as { type: { name: string } }).type.name, direccion).toBe(NoEncontrada.name);
      expect(document.title, direccion).toBe('No encontramos esa página');
    }
  });

  it('niveles.entrada.una_direccion_de_nivel_no_cambia_el_titulo_de_la_pagina', async () => {
    document.title = 'Estudio de video · Marketing';
    await abrir('/estudio/marketing/');
    expect(document.title).toBe('Estudio de video · Marketing');
  });

  it('niveles.entrada.el_mapa_lee_y_limpia_desde_y_ver: recargar o compartir la dirección no repite nada, y la historia no crece', async () => {
    const antes = history.length;
    const { montar } = await abrir('/estudio/?desde=mkt.blotato.agenda&ver=mapa');
    expect(montar).toHaveBeenCalledTimes(1);
    expect(location.pathname + location.search).toBe('/estudio/');
    // replaceState, nunca pushState: «atrás» sigue llevando a la pantalla de donde se vino, y el estado de la historia se conserva
    expect(history.state).toEqual({ guardado: true });
    expect(history.length).toBe(antes);
  });

  it('niveles.entrada.limpiar_no_toca_lo_demas_de_la_direccion: ?blotato=conectar y el ancla se quedan', async () => {
    await abrir('/estudio/?desde=mkt.blotato.agenda&ver=mapa&blotato=conectar#abajo');
    expect(location.pathname + location.search + location.hash).toBe('/estudio/?blotato=conectar#abajo');
  });

  it('niveles.entrada.solo_el_mapa_limpia: en un área la dirección se queda como llegó', async () => {
    await abrir('/estudio/marketing/?desde=mkt.blotato.agenda&ver=grupos');
    expect(location.search).toBe('?desde=mkt.blotato.agenda&ver=grupos');
  });
});
