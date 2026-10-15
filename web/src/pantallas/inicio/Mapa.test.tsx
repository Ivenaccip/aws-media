// El mapa en X (paso 1 del recorrido) y las tres opciones (paso 2), cada uno solo: su orden, sus fichas inertes, «Estás aquí» y lo
// que le avisan a quien los pinta. El recorrido entero, con la tarjeta, el foco y Esc, está en Recorrido.test.tsx.
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { MENU } from '../../marca/menu';
import { areaDe } from './recorrido';
import { Grupos } from './Grupos';
import { Mapa, PUESTOS } from './Mapa';

describe('Mapa · las cinco áreas en su X', () => {
  it('todas las áreas de menu.ts tienen puesto en el mapa (un área nueva sin puesto no saldría, y nadie lo notaría)', () => {
    expect(Object.keys(PUESTOS).sort()).toEqual(MENU.map(a => a.clave).sort());
  });

  it('el orden del DOM es el de lectura, fila a fila: Marketing, Producto, Central, Ventas, Automatizaciones (así Tab recorre la X como se ve)', () => {
    render(<Mapa aqui="mkt" alElegir={() => undefined} />);
    const fichas = within(screen.getByRole('group', { name: 'Áreas' })).getAllByRole('button');
    expect(fichas.map(f => f.querySelector('span')?.textContent)).toEqual(['Marketing', 'Producto', 'Central', 'Ventas', 'Automatizaciones']);
  });

  it('cada ficha va a su lugar de la cuadrícula: esquinas para cuatro y el centro para Central (y la banda de ancho completo en el celular)', () => {
    render(<Mapa aqui="mkt" alElegir={() => undefined} />);
    const clases = (nombre: string) => screen.getByRole('button', { name: new RegExp(`^${nombre}`) }).className.split(/\s+/);
    expect(clases('Marketing')).toEqual(expect.arrayContaining(['col-start-1', 'row-start-1']));
    expect(clases('Producto')).toEqual(expect.arrayContaining(['col-start-3', 'row-start-1', 'max-[560px]:col-start-2']));
    expect(clases('Central')).toEqual(
      expect.arrayContaining(['col-start-2', 'row-start-2', 'max-[560px]:col-start-1', 'max-[560px]:col-span-2']),
    );
    expect(clases('Ventas')).toEqual(expect.arrayContaining(['col-start-1', 'row-start-3']));
    expect(clases('Automatizaciones')).toEqual(expect.arrayContaining(['col-start-3', 'row-start-3', 'max-[560px]:col-start-2']));
  });

  it('Producto, Ventas y Automatizaciones se ven apagadas («Próximamente», aria-disabled) y no avisan al pulsarlas; Marketing y Central sí', async () => {
    const alElegir = vi.fn();
    render(<Mapa aqui="mkt" alElegir={alElegir} />);
    for (const nombre of ['Producto', 'Ventas', 'Automatizaciones']) {
      const ficha = screen.getByRole('button', { name: new RegExp(`^${nombre}`) });
      expect(ficha).toHaveAttribute('aria-disabled', 'true');
      expect(ficha).toHaveTextContent('Próximamente');
      await userEvent.click(ficha);
    }
    expect(alElegir).not.toHaveBeenCalled();
    for (const nombre of ['Marketing', 'Central']) {
      expect(screen.getByRole('button', { name: new RegExp(`^${nombre}`) })).not.toHaveAttribute('aria-disabled');
    }
    await userEvent.click(screen.getByRole('button', { name: /^Central/ }));
    expect(alElegir).toHaveBeenCalledExactlyOnceWith(areaDe('central'));
  });

  it('las apagadas siguen en el orden de Tab (con teclado se llega a ellas y el lector las lee), sin tabindex que las saque', async () => {
    render(<Mapa aqui="mkt" alElegir={() => undefined} />);
    await userEvent.tab();
    const vistas: string[] = [];
    for (let i = 0; i < 5; i++) {
      vistas.push(document.activeElement?.querySelector('span')?.textContent ?? '?');
      await userEvent.tab();
    }
    expect(vistas).toEqual(['Marketing', 'Producto', 'Central', 'Ventas', 'Automatizaciones']);
  });

  it('«Estás aquí» marca el área donde estás (y solo esa), con aria-current', () => {
    const { rerender } = render(<Mapa aqui="central" alElegir={() => undefined} />);
    const aqui = screen.getAllByText('Estás aquí');
    expect(aqui).toHaveLength(1);
    expect(screen.getByRole('button', { name: /^Central/ })).toHaveAttribute('aria-current', 'location');
    expect(screen.getByRole('button', { name: /^Marketing/ })).not.toHaveAttribute('aria-current');
    rerender(<Mapa aqui="mkt" alElegir={() => undefined} />);
    expect(screen.getByRole('button', { name: /^Marketing/ })).toHaveTextContent('Estás aquí');
    expect(screen.getByRole('button', { name: /^Central/ })).not.toHaveTextContent('Estás aquí');
  });

  it('«Estás aquí» no se parte en dos renglones (whitespace-nowrap) ni se corta: así cabe a 390 y a 320', () => {
    render(<Mapa aqui="mkt" alElegir={() => undefined} />);
    expect(screen.getByText('Estás aquí').className).toContain('whitespace-nowrap');
  });

  it('las dos diagonales y los trazos cortos del celular son decoración: ocultos al lector y sin recibir clics', () => {
    const { container } = render(<Mapa aqui="mkt" alElegir={() => undefined} />);
    const svg = container.querySelector('svg[viewBox="0 0 100 100"]')!;
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg.querySelectorAll('line')).toHaveLength(2);
    expect(svg.getAttribute('class')).toContain('pointer-events-none');
    // y van DETRÁS de las fichas (z-0 contra z-10): el texto nunca queda tapado
    expect(svg.getAttribute('class')).toContain('z-0');
    for (const ficha of screen.getAllByRole('button')) expect(ficha.className).toContain('z-10');
    // la X grande no se pinta en el celular: ahí van los trazos cortos entre las esquinas y la banda
    expect(svg.getAttribute('class')).toContain('max-[560px]:hidden');
    const trazos = container.querySelectorAll('button > span[aria-hidden="true"]');
    expect(trazos).toHaveLength(4);
    for (const t of trazos) expect(t.className).toContain('pointer-events-none');
  });

  it('«Automatizaciones» (la palabra más larga) puede partirse como último recurso en vez de salirse de su ficha', () => {
    render(<Mapa aqui="mkt" alElegir={() => undefined} />);
    expect(screen.getByText('Automatizaciones').className).toContain('[overflow-wrap:anywhere]');
  });
});

describe('Grupos · las tres opciones', () => {
  const marketing = areaDe('mkt')!;

  it('una tarjeta por grupo del área, con lo que trae: Distrito, Blotato y Avanzado', () => {
    render(<Grupos area={marketing} aqui="distrito" alElegir={() => undefined} />);
    const grupo = screen.getByRole('group', { name: 'Marketing' });
    const tarjetas = within(grupo).getAllByRole('button');
    expect(tarjetas.map(t => t.querySelector('b')?.textContent)).toEqual(['Distrito', 'Blotato', 'Avanzado']);
    expect(tarjetas[0]).toHaveTextContent('Imagen · Video · Edición');
    expect(tarjetas[1]).toHaveTextContent('Agenda tus publicaciones · Investiga tu competencia · Ver mis métricas');
    expect(tarjetas[2]).toHaveTextContent('Publicaciones automáticas · Copiadora de estilos');
  });

  it('«Estás aquí» va solo en el grupo donde estás, y sin grupo (otra área) en ninguno', () => {
    const { rerender } = render(<Grupos area={marketing} aqui="blotato" alElegir={() => undefined} />);
    expect(screen.getAllByText('Estás aquí')).toHaveLength(1);
    expect(screen.getByRole('button', { name: /^Blotato/ })).toHaveAttribute('aria-current', 'location');
    rerender(<Grupos area={marketing} aqui={null} alElegir={() => undefined} />);
    expect(screen.queryByText('Estás aquí')).toBeNull();
  });

  it('avisa qué grupo se eligió y con cuántos clics (`detail`: 1 un clic, 2 un doble clic, 0 el teclado)', async () => {
    const alElegir = vi.fn();
    render(<Grupos area={marketing} aqui={null} alElegir={alElegir} />);
    await userEvent.click(screen.getByRole('button', { name: /^Avanzado/ }));
    expect(alElegir).toHaveBeenLastCalledWith(marketing.grupos[2], 1);
    await userEvent.dblClick(screen.getByRole('button', { name: /^Blotato/ }));
    expect(alElegir.mock.calls.at(-1)).toEqual([marketing.grupos[1], 2]);
    screen.getByRole('button', { name: /^Distrito/ }).focus();
    await userEvent.keyboard('{Enter}');
    expect(alElegir.mock.calls.at(-1)).toEqual([marketing.grupos[0], 0]);
  });

  it('en el celular apilan en una columna; en pantalla ancha se reparten (auto-fit de 140 px)', () => {
    render(<Grupos area={marketing} aqui={null} alElegir={() => undefined} />);
    const clases = screen.getByRole('group', { name: 'Marketing' }).className;
    expect(clases).toContain('grid-cols-[repeat(auto-fit,minmax(140px,1fr))]');
    expect(clases).toContain('max-[560px]:grid-cols-1');
  });

  it('el área de Central trae Distrito y Deepseek', () => {
    render(<Grupos area={areaDe('central')!} aqui={null} alElegir={() => undefined} />);
    const tarjetas = within(screen.getByRole('group', { name: 'Central' })).getAllByRole('button');
    expect(tarjetas.map(t => t.querySelector('b')?.textContent)).toEqual(['Distrito', 'Deepseek']);
    expect(tarjetas[0]).toHaveTextContent('COI · Biblioteca de prompts · Preguntas sobre la clase · Glosario IA');
    // Deepseek todavía no existe: lo dice la tarjeta (no «Una sola pantalla»), igual que su contenido dirá que no está disponible
    expect(tarjetas[1]).toHaveTextContent('Próximamente');
    expect(tarjetas[1]).not.toHaveTextContent('Una sola pantalla');
  });
});
