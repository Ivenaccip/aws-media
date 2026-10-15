// La lista de pantallas de un grupo que no es la caja (Pantallas.tsx): lo que antes hacía el menú de la izquierda (UI·8.4), con las
// mismas reglas (M23 · C). Aquí solo, sin el recorrido: el camino completo (mapa → opciones → lista → diálogo) está en
// Recorrido.test.tsx e Inicio.test.tsx.
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { grupoDe } from './recorrido';
import { Pantallas } from './Pantallas';

const blotato = grupoDe('mkt', 'blotato')!;
const avanzado = grupoDe('mkt', 'avanzado')!;
const distritoCentral = grupoDe('central', 'distrito')!;
const deepseek = grupoDe('central', 'deepseek')!;

const enlaces = () => within(screen.getByRole('list')).getAllByRole('link');

/** Un clic de verdad sobre un enlace: devuelve si la página lo CANCELÓ (no navega) y deja que jsdom no intente navegar. */
function clic(el: Element): boolean {
  let cancelado = false;
  const oir = (e: Event) => {
    cancelado = e.defaultPrevented;
    e.preventDefault();
  };
  document.addEventListener('click', oir, { once: true });
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  document.removeEventListener('click', oir);
  return cancelado;
}

describe('Pantallas · el grupo Blotato', () => {
  it('trae sus tres pantallas como enlaces, en orden, con su texto de apoyo', () => {
    render(<Pantallas grupo={blotato} conectado alConectar={() => undefined} />);
    expect(enlaces().map(a => [a.getAttribute('href'), a.querySelector('b')?.textContent])).toEqual([
      ['/agenda.html', 'Agenda tus publicaciones'],
      ['/competencia.html', 'Investiga tu competencia'],
      ['/metricas.html', 'Ver mis métricas'],
    ]);
    expect(enlaces()[0]).toHaveTextContent('Programa tus posts en todas tus redes');
    expect(enlaces()[1]).toHaveTextContent('Qué le está funcionando a quien vigilas');
    expect(enlaces()[2]).toHaveTextContent('Cómo rinden tus publicaciones');
    for (const a of enlaces()) expect(a).not.toHaveAttribute('aria-disabled');
  });

  it('el botón de conectar dice «Blotato conectado: ver o cambiar» si hay clave y «Conecta tu cuenta de Blotato» si no (y si no se sabe)', () => {
    const { rerender } = render(<Pantallas grupo={blotato} conectado alConectar={() => undefined} />);
    expect(screen.getByRole('button', { name: 'Blotato conectado: ver o cambiar' })).toHaveAttribute('aria-haspopup', 'dialog');
    rerender(<Pantallas grupo={blotato} conectado={false} alConectar={() => undefined} />);
    expect(screen.getByRole('button', { name: 'Conecta tu cuenta de Blotato' })).toHaveAttribute('aria-haspopup', 'dialog');
    rerender(<Pantallas grupo={blotato} conectado={null} alConectar={() => undefined} />);
    expect(screen.getByRole('button', { name: 'Conecta tu cuenta de Blotato' })).toBeInTheDocument();
  });

  it('el botón de conectar va ANTES de las tarjetas (arriba de la lista, como pide el diseño) y abre el diálogo al pulsarlo', async () => {
    const alConectar = vi.fn();
    render(<Pantallas grupo={blotato} conectado alConectar={alConectar} />);
    const boton = screen.getByRole('button', { name: /Blotato conectado/ });
    expect(boton.compareDocumentPosition(screen.getByRole('list')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await userEvent.click(boton);
    expect(alConectar).toHaveBeenCalledOnce();
  });

  it('sin clave las tres se APAGAN a la vista (aria-disabled), no se esconden, y dicen cómo encenderlas', () => {
    render(<Pantallas grupo={blotato} conectado={false} alConectar={() => undefined} />);
    expect(enlaces()).toHaveLength(3);
    for (const a of enlaces()) {
      expect(a).toHaveAttribute('aria-disabled', 'true');
      expect(a).toHaveTextContent('Conecta tu Blotato para usarlo');
      expect(a.className).toContain('opacity-60');
    }
    // ya no dicen su texto de apoyo: lo que importa es cómo desbloquearlas
    expect(screen.queryByText('Programa tus posts en todas tus redes')).toBeNull();
  });

  it('el clic de una apagada NO navega: ofrece conectar', () => {
    const alConectar = vi.fn();
    render(<Pantallas grupo={blotato} conectado={false} alConectar={alConectar} />);
    expect(clic(enlaces()[0]!)).toBe(true);
    expect(alConectar).toHaveBeenCalledOnce();
  });

  it('con clave el clic sigue su camino (navega) y no abre nada', () => {
    const alConectar = vi.fn();
    render(<Pantallas grupo={blotato} conectado alConectar={alConectar} />);
    expect(clic(enlaces()[0]!)).toBe(false);
    expect(alConectar).not.toHaveBeenCalled();
  });

  it('si no se sabe (null: la consulta falló) no se apaga nada: dejar sin sus herramientas a quien sí pagó es peor que dejar entrar a quien no', () => {
    const alConectar = vi.fn();
    render(<Pantallas grupo={blotato} conectado={null} alConectar={alConectar} />);
    for (const a of enlaces()) expect(a).not.toHaveAttribute('aria-disabled');
    expect(clic(enlaces()[1]!)).toBe(false);
    expect(alConectar).not.toHaveBeenCalled();
  });
});

describe('Pantallas · Avanzado', () => {
  it('MIX depende de Blotato y la Copiadora de estilos no: sin clave solo MIX se apaga, y no hay botón de conectar (no es un grupo de Blotato)', () => {
    render(<Pantallas grupo={avanzado} conectado={false} alConectar={() => undefined} />);
    expect(screen.queryByRole('button')).toBeNull();
    const [mix, estilos] = enlaces();
    expect([mix?.getAttribute('href'), estilos?.getAttribute('href')]).toEqual(['/mix.html', '/estilos.html']);
    expect(mix).toHaveAttribute('aria-disabled', 'true');
    expect(estilos).not.toHaveAttribute('aria-disabled');
    expect(estilos).toHaveTextContent('Recrea el estilo visual de un contenido que te guste');
  });

  it('clic en MIX apagada ofrece conectar; clic en la Copiadora navega', () => {
    const alConectar = vi.fn();
    render(<Pantallas grupo={avanzado} conectado={false} alConectar={alConectar} />);
    const [mix, estilos] = enlaces();
    expect(clic(mix!)).toBe(true);
    expect(alConectar).toHaveBeenCalledOnce();
    expect(clic(estilos!)).toBe(false);
    expect(alConectar).toHaveBeenCalledOnce();
  });
});

describe('Pantallas · lo que todavía no existe', () => {
  it('todo Central › Distrito sale apagado con «Próximamente» y ninguna tarjeta es un enlace (no navegan)', () => {
    render(<Pantallas grupo={distritoCentral} conectado alConectar={() => undefined} />);
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    const filas = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(filas.map(f => f.querySelector('b')?.textContent)).toEqual(['COI', 'Biblioteca de prompts', 'Preguntas sobre la clase', 'Glosario IA']);
    for (const f of filas) {
      expect(f).toHaveTextContent('Próximamente');
      // apagadas como las fichas del mapa (fondo hundido, texto secundario), sin opacidad: «Próximamente» es información y se lee a 7:1
      const clases = f.firstElementChild!.className.split(/\s+/);
      expect(clases).toEqual(expect.arrayContaining(['bg-hundido', 'text-secundario']));
      expect(clases).not.toContain('opacity-60');
    }
    // pulsar una no abre el diálogo de Blotato ni nada: no hay nada que pulsar
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('«Próximamente» manda sobre la dirección: una pantalla apagada con href tampoco es un enlace', () => {
    const grupo = { ...distritoCentral, pantallas: [{ clave: 'x', titulo: 'Algo nuevo', icono: 'coi', href: '/algo.html', proximamente: true }] } as const;
    render(<Pantallas grupo={grupo} conectado alConectar={() => undefined} />);
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(screen.getByText('Algo nuevo')).toBeInTheDocument();
    expect(screen.getByText('Próximamente')).toBeInTheDocument();
  });

  it('un grupo sin pantallas todavía (Deepseek) lo dice en una línea', () => {
    render(<Pantallas grupo={deepseek} conectado alConectar={() => undefined} />);
    expect(screen.getByText('Todavía no está disponible.')).toBeInTheDocument();
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
