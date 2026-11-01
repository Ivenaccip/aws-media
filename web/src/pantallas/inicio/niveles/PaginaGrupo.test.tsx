// Las listas de los grupos y el diálogo de Blotato, en la página de su grupo (PaginaNivel en Marketing › Blotato, › Avanzado y Central ›
// Distrito, con GrupoConBlotato donde hace falta). Hasta E8 estos IDs probaban lo mismo DENTRO del inicio de una sola página
// (Inicio.test.tsx, que lo abría en el mapa y llegaba a cada lista por el recorrido en página); esa página ya no la monta nadie, y
// aquí se prueba la que sí ve la gente. Conservan su ID (tests/test_migracion_ui.py los exige) y lo que afirman: docs/migracion/inicio.md
// dice qué afirma hoy cada uno. Ninguna prueba sale a la red: `servidor()` contesta todo y no gasta nada.
//
// GrupoConBlotato pide su lógica y el diálogo con import(): lo que aparece después del primer pintado se espera con findBy/waitFor.
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { json, llamadas, servidor, sinRed, type Ruta } from '../../../prueba/servidor';
import type { EstadoBlotato } from '../logica';
import { PaginaNivel, type PropsPaginaNivel } from './PaginaNivel';

const CONECTADO: EstadoBlotato = {
  conectado: true,
  origen: 'usuario',
  cuentas: [{ id: '1', platform: 'instagram', fullname: 'Estudio Norte', username: 'estudio.norte' }],
  error: null,
  plan: { nombre: 'Starter', usd_por_mes: 29 },
};
const SIN_CLAVE: EstadoBlotato = { ...CONECTADO, conectado: false, origen: null, cuentas: [] };

const BLOTATO = { tipo: 'grupo', area: 'mkt', grupo: 'blotato' } as const;
const AVANZADO = { tipo: 'grupo', area: 'mkt', grupo: 'avanzado' } as const;
const CENTRAL = { tipo: 'grupo', area: 'central', grupo: 'distrito' } as const;

/** El servidor de mentira: solo Blotato (las páginas de nivel no piden nada más). `blotato: null` = la consulta falla. */
function montar({ blotato = CONECTADO, ruta }: { blotato?: EstadoBlotato | null; ruta?: Ruta } = {}) {
  return servidor({ '/api/blotato': ruta ?? (() => (blotato ? json(blotato) : sinRed())) });
}

let ir: ReturnType<typeof vi.fn<(url: string) => void>>;
beforeEach(() => {
  vi.unstubAllGlobals();
  ir = vi.fn<(url: string) => void>();
});
afterEach(() => {
  vi.unstubAllGlobals();
  // jsdom conserva la dirección entre pruebas
  history.replaceState(null, '', '/');
});

const pintar = (nivel: PropsPaginaNivel['nivel']) => render(<PaginaNivel nivel={nivel} ir={ir} />);
/** La lista de herramientas del grupo (la `ul`; las migas son otra lista, la `ol` de su <nav>). */
const lista = () => document.querySelector<HTMLElement>('main ul')!;
const enlacesDeLaLista = (opciones: { hidden?: boolean } = {}) => within(lista()).getAllByRole('link', opciones);
/** Ya contestó la lectura ligera de Blotato (con la clave, el botón lo dice): nada queda por llegar al terminar la prueba. */
const leido = () => screen.findByRole('button', { name: 'Blotato conectado: ver o cambiar' });
/** El botón de conectar (o ver la cuenta), arriba de las tarjetas de Marketing › Blotato: lo que abre el diálogo. */
const abrir = async () => {
  await userEvent.click(await screen.findByRole('button', { name: /Blotato conectado|Conecta tu cuenta de Blotato/ }));
};

describe('el menú', () => {
  it('inicio.menu.entradas_y_grupos_en_orden', async () => {
    const f = montar();
    // ya no hay menú: ni «Secciones», ni sus grupos (MIX tuvo el suyo debajo de Blotato; ahora vive en Avanzado). Tampoco en el mapa
    const sinMenu = () => {
      expect(screen.queryByRole('navigation', { name: 'Secciones' })).toBeNull();
      expect(screen.queryByText('Estudio de Contenido')).toBeNull();
      expect(screen.queryByText('Publicidad Automática')).toBeNull();
    };
    let r = pintar({ tipo: 'mapa' });
    sinMenu();
    r.unmount();
    // las pantallas de cada grupo, en su orden y con sus destinos
    r = pintar(BLOTATO);
    await leido();
    sinMenu();
    expect(enlacesDeLaLista().map(a => a.getAttribute('href'))).toEqual(['/agenda.html', '/competencia.html', '/metricas.html']);
    // «De videos a Shorts» salió de las listas: vive en «Editar ▾»
    expect(screen.queryByText('De videos a Shorts')).toBeNull();
    expect(lista().textContent).not.toMatch(/próximamente/i);
    r.unmount();
    f.mockClear();
    r = pintar(AVANZADO);
    await waitFor(() => expect(llamadas(f, '/api/blotato?redes=0', 'GET')).toHaveLength(1));
    // MIX, con Blotato como requisito (se apaga sin su clave), y la Copiadora de estilos, que se queda aquí hasta que exista «Marcas»
    expect(enlacesDeLaLista().map(a => a.getAttribute('href'))).toEqual(['/mix.html', '/estilos.html']);
    expect(screen.queryByText('De videos a Shorts')).toBeNull();
    // nada de Marketing dice «próximamente»; lo de Central, sí
    expect(lista().textContent).not.toMatch(/próximamente/i);
    r.unmount();
    pintar(CENTRAL);
    sinMenu();
    expect(lista().textContent).toMatch(/próximamente/i);
    // lo que ya existe de Central › Distrito (COI y la Biblioteca de prompts, 16-oct-2026) son enlaces a su pantalla, en su lugar del mapa
    // desde E7; lo demás sigue apagado y no navega
    expect(enlacesDeLaLista().map(a => a.getAttribute('href'))).toEqual(['/estudio/central/distrito/coi/', '/estudio/central/distrito/biblioteca/']);
  });

  it('inicio.menu.editor_de_videos_salio_y_las_otras_dos_de_su_grupo_se_quedan', async () => {
    montar();
    // «Editor de videos» (/e1.html) salió el 14-oct-2026 (dueño): editar metraje es la pestaña «Edición» de la caja. Sigue sin salir
    // en ninguna lista de grupo, ni su texto, ni un enlace a /e1.html
    for (const nivel of [BLOTATO, AVANZADO, CENTRAL]) {
      const { unmount } = pintar(nivel);
      if (nivel === BLOTATO) await leido();
      expect(screen.queryByText('Editor de videos')).toBeNull();
      expect(screen.queryByText('Sube tu metraje y la IA te propone el corte.')).toBeNull();
      expect(document.querySelector('a[href^="/e1.html"]')).toBeNull();
      unmount();
    }
    // la Copiadora de estilos se queda donde estaba su puerta (Avanzado), con su texto tal cual; «De videos a Shorts» pasó a «Editar ▾»
    pintar(AVANZADO);
    const estilos = enlacesDeLaLista().find(a => a.getAttribute('href') === '/estilos.html')!;
    expect(estilos.querySelector('b')?.textContent).toBe('Copiadora de estilos');
    expect(estilos).toHaveTextContent('Recrea el estilo visual de un contenido que te guste');
    expect(enlacesDeLaLista().some(a => a.getAttribute('href') === '/shorts.html')).toBe(false);
  });

  it('inicio.menu.el_titulo_dice_irremplazables_en_dorado_sin_icono', async () => {
    montar();
    // el mismo título en cada página del recorrido: el mapa, un área y un grupo
    for (const nivel of [{ tipo: 'mapa' }, { tipo: 'area', area: 'mkt' }, BLOTATO] as const) {
      const { unmount } = pintar(nivel);
      const h1 = screen.getByRole('heading', { level: 1 });
      expect(h1).toHaveTextContent(/^Irremplazables$/);
      // el dorado del título (dueño, 15-oct-2026): un degradado que solo usa este título, de la clase `texto-oro` de tokens.css; mismo
      // tamaño de pantalla y peso de título que las demás pantallas (`text-titulo-lg`, extrabold, Bricolage por `h1`)
      expect(h1.className.split(/\s+/)).toEqual(expect.arrayContaining(['text-titulo-lg', 'font-extrabold']));
      // el degradado es un FONDO recortado a la letra (`texto-oro`): en el h1, solo cubriría la caja del h1, y la letra que se desbordara
      // (espaciado de texto de WCAG 1.4.12 a 320 px, letra más grande) quedaría transparente y desaparecería. Va en un <span> en línea, cuya
      // caja mide lo que el texto; y el h1 parte la palabra en vez de dejarla salirse de la región
      expect(h1.className.split(/\s+/)).not.toContain('texto-oro');
      expect(h1.className.split(/\s+/)).toContain('[overflow-wrap:anywhere]');
      expect(h1.children).toHaveLength(1);
      const marca = h1.children[0]!;
      expect(marca.tagName).toBe('SPAN');
      expect(marca).toHaveClass('texto-oro');
      expect(marca).toHaveTextContent(/^Irremplazables$/);
      // el ámbar claro de antes ya no pinta el nombre
      expect(h1.className.split(/\s+/)).not.toContain('text-ambar-claro');
      expect(marca.className.split(/\s+/)).not.toContain('text-ambar-claro');
      // sin icono: ni un dibujo dentro del título
      expect(h1.querySelector('svg, img, i')).toBeNull();
      // el nombre de antes ya no sale en la pantalla, y es el único h1
      expect(screen.queryByText(/Estudio de video/)).toBeNull();
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
      if (nivel === BLOTATO) await leido();
      unmount();
    }
  });

  it('inicio.menu.sin_clave_se_apagan_las_cuatro_de_blotato_y_ofrecen_conectar', async () => {
    montar({ blotato: SIN_CLAVE });
    const { unmount } = pintar(BLOTATO);
    await waitFor(() => expect(within(lista()).getAllByRole('link', { name: /Conecta tu Blotato/ })).toHaveLength(3));
    const apagadas = enlacesDeLaLista().filter(a => a.getAttribute('aria-disabled') === 'true');
    expect(apagadas.map(a => a.getAttribute('href'))).toEqual(['/agenda.html', '/competencia.html', '/metricas.html']);
    // el clic no lleva a un callejón: abre conectar
    const clic = new MouseEvent('click', { bubbles: true, cancelable: true });
    act(() => {
      apagadas[0]!.dispatchEvent(clic);
    });
    expect(clic.defaultPrevented).toBe(true);
    expect(await screen.findByRole('dialog', { name: 'Conecta tu Blotato' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    unmount();
    // la cuarta es MIX (en Avanzado); la Copiadora de estilos, que no depende de Blotato, no se apaga
    pintar(AVANZADO);
    await waitFor(() =>
      expect(enlacesDeLaLista().map(a => [a.getAttribute('href'), a.getAttribute('aria-disabled')])).toEqual([
        ['/mix.html', 'true'],
        ['/estilos.html', null],
      ]),
    );
  });

  it('inicio.menu.si_no_se_sabe_no_se_apaga_nada', async () => {
    const f = montar({ blotato: null });
    for (const nivel of [BLOTATO, AVANZADO]) {
      const { unmount } = pintar(nivel);
      await waitFor(() => expect(llamadas(f, '/api/blotato?redes=0', 'GET')).toHaveLength(1));
      // dejar que la consulta fallida termine antes de mirar
      await act(() => new Promise(r => setTimeout(r, 0)));
      expect(enlacesDeLaLista().filter(a => a.hasAttribute('aria-disabled'))).toHaveLength(0);
      unmount();
      f.mockClear();
    }
  });

  it('inicio.menu.pregunta_ligero', async () => {
    const f = montar();
    // la página del grupo pregunta con `?redes=0`, UNA vez al montar, sin gastar una llamada a Blotato: el GET completo espera al diálogo
    for (const nivel of [BLOTATO, AVANZADO]) {
      const { unmount } = pintar(nivel);
      await waitFor(() => expect(llamadas(f, '/api/blotato?redes=0', 'GET')).toHaveLength(1));
      expect(llamadas(f, '/api/blotato', 'GET')).toHaveLength(0);
      if (nivel === BLOTATO) await leido();
      unmount();
      f.mockClear();
    }
  });
});

describe('Blotato', () => {
  it('inicio.blotato.mas_abre_el_dialogo_con_las_redes', async () => {
    montar();
    pintar(BLOTATO);
    await abrir();
    const dlg = await screen.findByRole('dialog', { name: 'Tu Blotato' });
    expect(within(dlg).getByText('Tu Blotato está conectado')).toBeInTheDocument();
    expect(within(dlg).getByRole('list', { name: 'Redes conectadas en tu Blotato' })).toHaveTextContent(
      'InstagramEstudio Norte · @estudio.norte',
    );
  });

  it('inicio.blotato.aviso_del_cobro_con_el_precio_del_server_antes_del_campo', async () => {
    montar({ blotato: SIN_CLAVE });
    pintar(BLOTATO);
    await abrir();
    const dlg = await screen.findByRole('dialog', { name: 'Conecta tu Blotato' });
    const nota = await within(dlg).findByRole('note');
    expect(nota).toHaveTextContent('la API no viene en la prueba gratis de Blotato');
    expect(nota).toHaveTextContent('desde $29 dólares al mes con Starter');
    expect(nota).toHaveTextContent('Ese cobro es de Blotato, no nuestro.');
    const campo = within(dlg).getByLabelText('Tu clave de API de Blotato');
    expect(nota.compareDocumentPosition(campo) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('inicio.blotato.clave_password_sin_autocompletar', async () => {
    montar({ blotato: SIN_CLAVE });
    pintar(BLOTATO);
    await abrir();
    const campo = await screen.findByLabelText('Tu clave de API de Blotato');
    expect(campo).toHaveAttribute('type', 'password');
    expect(campo).toHaveAttribute('autocomplete', 'off');
    expect(campo).toHaveAttribute('spellcheck', 'false');
    expect(campo).toHaveAttribute('autocapitalize', 'off');
  });

  it('inicio.blotato.la_clave_se_borra_al_conectar_cancelar_y_cerrar', async () => {
    let estado = SIN_CLAVE;
    const f = montar({
      ruta: (_u, init) => {
        if (init?.method === 'POST') estado = CONECTADO;
        return json(estado);
      },
    });
    pintar(BLOTATO);
    await abrir();
    // cerrar la vacía
    await userEvent.type(await screen.findByLabelText('Tu clave de API de Blotato'), 'secreta-1');
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    // reabrir es el mismo botón de arriba de las tarjetas
    await abrir();
    expect(await screen.findByLabelText('Tu clave de API de Blotato')).toHaveValue('');
    // conectar la manda una vez y la vacía
    await userEvent.type(screen.getByLabelText('Tu clave de API de Blotato'), '  secreta-2 ');
    await userEvent.click(screen.getByRole('button', { name: 'Conectar' }));
    expect(await screen.findByText('Tu Blotato está conectado')).toBeInTheDocument();
    const posts = llamadas(f, '/api/blotato');
    expect(posts).toHaveLength(1);
    expect(JSON.parse(String(posts[0]![1]!.body))).toEqual({ clave: 'secreta-2' });
    // cambiar y cancelar la vacía
    await userEvent.click(screen.getByRole('button', { name: 'Cambiar clave' }));
    await userEvent.type(screen.getByLabelText('Tu clave de API de Blotato'), 'secreta-3');
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cambiar clave' }));
    expect(screen.getByLabelText('Tu clave de API de Blotato')).toHaveValue('');
    // y ninguna clave quedó escrita en la página
    expect(document.body.innerHTML).not.toMatch(/secreta/);
  });

  it('inicio.blotato.sin_clave_no_manda_nada', async () => {
    const f = montar({ blotato: SIN_CLAVE });
    pintar(BLOTATO);
    await abrir();
    await userEvent.click(await screen.findByRole('button', { name: 'Conectar' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Pega tu clave de Blotato primero.');
    expect(llamadas(f, '/api/blotato')).toHaveLength(0);
  });

  it('inicio.blotato.error_del_server_se_dice_en_el_dialogo', async () => {
    montar({
      ruta: (_u, init) => (init?.method === 'POST' ? json({ detail: 'Blotato no reconoce esa clave.' }, 400) : json(SIN_CLAVE)),
    });
    pintar(BLOTATO);
    await abrir();
    await userEvent.type(await screen.findByLabelText('Tu clave de API de Blotato'), 'mala');
    await userEvent.click(screen.getByRole('button', { name: 'Conectar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Blotato no reconoce esa clave.');
    expect(screen.getByRole('button', { name: 'Conectar' })).toBeEnabled();
  });

  it('inicio.blotato.clave_del_env_no_se_ofrece_desconectar', async () => {
    montar({ blotato: { ...CONECTADO, origen: 'env' } });
    pintar(BLOTATO);
    await abrir();
    expect(await screen.findByText(/clave del/)).toHaveTextContent('Estás usando la clave del .env de esta máquina.');
    expect(screen.queryByRole('button', { name: 'Desconectar' })).toBeNull();
  });

  it('inicio.blotato.desconectar_pide_confirmar', async () => {
    const f = montar({ ruta: (_u, init) => json(init?.method === 'DELETE' ? SIN_CLAVE : CONECTADO) });
    pintar(BLOTATO);
    await abrir();
    await userEvent.click(await screen.findByRole('button', { name: 'Desconectar' }));
    expect(screen.getByRole('alertdialog', { name: '¿Desconectar tu cuenta de Blotato?' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(llamadas(f, '/api/blotato', 'DELETE')).toHaveLength(0);
    await userEvent.click(screen.getByRole('button', { name: 'Desconectar' }));
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Desconectar' }));
    await waitFor(() => expect(llamadas(f, '/api/blotato', 'DELETE')).toHaveLength(1));
    // y las pantallas de Blotato se apagan (lo avisa el diálogo a GrupoConBlotato, que todavía las tapa: por eso `hidden`)
    await waitFor(() =>
      expect(enlacesDeLaLista({ hidden: true }).filter(a => a.getAttribute('aria-disabled') === 'true')).toHaveLength(3),
    );
  });

  it('inicio.blotato.viene_del_editor_con_blotato_conectar', async () => {
    // el editor manda al inicio con ?blotato=conectar, y el servidor lo reenvía aquí (server/web.py, ENTRADAS_VIEJAS)
    history.replaceState(null, '', '/estudio/marketing/blotato/?blotato=conectar');
    const f = montar({ blotato: SIN_CLAVE });
    pintar(BLOTATO);
    expect(await screen.findByRole('dialog', { name: 'Conecta tu Blotato' })).toBeInTheDocument();
    // con el diálogo abierto se pide el estado completo, no el ligero
    await waitFor(() => expect(llamadas(f, '/api/blotato', 'GET')).toHaveLength(1));
    expect(llamadas(f, '/api/blotato?redes=0', 'GET')).toHaveLength(0);
  });

  it('inicio.blotato.enlace_a_la_api_con_noopener', async () => {
    montar({ blotato: SIN_CLAVE });
    pintar(BLOTATO);
    await abrir();
    const a = await screen.findByRole('link', { name: 'Blotato → Settings → API' });
    expect(a).toHaveAttribute('href', 'https://my.blotato.com/settings');
    expect(a).toHaveAttribute('rel', 'noopener noreferrer');
    expect(a).toHaveAttribute('target', '_blank');
  });

  it('inicio.blotato.conectar_enciende_el_menu', async () => {
    // (el «menú» son ahora las tarjetas de la página de Blotato)
    let estado = SIN_CLAVE;
    montar({
      ruta: (_u, init) => {
        if (init?.method === 'POST') estado = CONECTADO;
        return json(estado);
      },
    });
    pintar(BLOTATO);
    await waitFor(() => expect(within(lista()).getAllByRole('link', { name: /Conecta tu Blotato/ })).toHaveLength(3));
    await abrir();
    await userEvent.type(await screen.findByLabelText('Tu clave de API de Blotato'), 'buena');
    await userEvent.click(screen.getByRole('button', { name: 'Conectar' }));
    await screen.findByText('Tu Blotato está conectado');
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(within(lista()).queryAllByRole('link', { name: /Conecta tu Blotato/ })).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Blotato conectado: ver o cambiar' })).toBeInTheDocument();
  });
});

describe('UI·24 · conectar Blotato dice «listo» con la palomita', () => {
  const palomita = (texto: HTMLElement) => texto.parentElement!.querySelector('svg path')!;

  it('UI·24: la clave recién guardada dibuja la palomita y se anuncia; al volver a abrir, quieta y callada', async () => {
    let estado = SIN_CLAVE;
    montar({
      ruta: (_u, init) => {
        if (init?.method === 'POST') estado = CONECTADO;
        return json(estado);
      },
    });
    pintar(BLOTATO);
    await abrir();
    await userEvent.type(await screen.findByLabelText('Tu clave de API de Blotato'), 'buena');
    await userEvent.click(screen.getByRole('button', { name: 'Conectar' }));
    const listo = await screen.findByText('Tu Blotato está conectado');
    expect(listo.closest('[role="status"]')).not.toBeNull();
    expect(palomita(listo).getAttribute('class')).toBe('motion-safe:animate-trazo-se-dibuja');
    // «Guardado» no se lleva el foco: sigue dentro del diálogo
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
    // Cambiar clave y Cancelar no guardó nada nuevo: quieta
    await userEvent.click(screen.getByRole('button', { name: 'Cambiar clave' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(palomita(screen.getByText('Tu Blotato está conectado'))).not.toHaveAttribute('class');
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    await abrir();
    const quieta = await screen.findByText('Tu Blotato está conectado');
    expect(quieta.closest('[role="status"]')).toBeNull();
    expect(palomita(quieta)).not.toHaveAttribute('class');
  });
});
