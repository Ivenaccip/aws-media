// El mapa en X (paso 1 del recorrido) y las tres opciones (paso 2), cada uno solo: su orden, sus fichas inertes, que NADA se ve elegido
// en el mapa («Estás aquí» solo en las opciones, y solo si ya elegiste) y lo que le avisan a quien los pinta. El recorrido entero, con el
// título, el foco y Esc, está en Recorrido.test.tsx.
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { MENU, areaDe } from '../../marca/menu';
import { Grupos } from './Grupos';
import { Mapa, PUESTOS } from './Mapa';

describe('Mapa · las cinco áreas en su X', () => {
  it('todas las áreas de menu.ts tienen puesto en el mapa (un área nueva sin puesto no saldría, y nadie lo notaría)', () => {
    expect(Object.keys(PUESTOS).sort()).toEqual(MENU.map(a => a.clave).sort());
  });

  it('el orden del DOM es el de lectura, fila a fila: Marketing, Producto, Central, Ventas, Automatizaciones (así Tab recorre la X como se ve)', () => {
    render(<Mapa alElegir={() => undefined} />);
    const fichas = within(screen.getByRole('group', { name: 'Áreas' })).getAllByRole('button');
    expect(fichas.map(f => f.querySelector('span')?.textContent)).toEqual(['Marketing', 'Producto', 'Central', 'Ventas', 'Automatizaciones']);
  });

  it('cada ficha va a su lugar de la cuadrícula: esquinas para cuatro y el centro para Central (y la banda de ancho completo en el celular)', () => {
    render(<Mapa alElegir={() => undefined} />);
    const clases = (nombre: string) => screen.getByRole('button', { name: new RegExp(`^${nombre}`) }).className.split(/\s+/);
    expect(clases('Marketing')).toEqual(expect.arrayContaining(['col-start-1', 'row-start-1']));
    expect(clases('Producto')).toEqual(expect.arrayContaining(['col-start-3', 'row-start-1', 'max-[560px]:col-start-2']));
    expect(clases('Central')).toEqual(
      expect.arrayContaining(['col-start-2', 'row-start-2', 'max-[560px]:col-start-1', 'max-[560px]:col-span-2']),
    );
    expect(clases('Ventas')).toEqual(expect.arrayContaining(['col-start-1', 'row-start-3']));
    expect(clases('Automatizaciones')).toEqual(expect.arrayContaining(['col-start-3', 'row-start-3', 'max-[560px]:col-start-2']));
  });

  it('Producto y Ventas se ven apagadas («Próximamente», aria-disabled) y no avisan al pulsarlas; Marketing, Central y Automatizaciones sí', async () => {
    const alElegir = vi.fn();
    render(<Mapa alElegir={alElegir} />);
    for (const nombre of ['Producto', 'Ventas']) {
      const ficha = screen.getByRole('button', { name: new RegExp(`^${nombre}`) });
      expect(ficha).toHaveAttribute('aria-disabled', 'true');
      expect(ficha).toHaveTextContent('Próximamente');
      await userEvent.click(ficha);
    }
    expect(alElegir).not.toHaveBeenCalled();
    for (const nombre of ['Marketing', 'Central', 'Automatizaciones']) {
      const ficha = screen.getByRole('button', { name: new RegExp(`^${nombre}`) });
      expect(ficha).not.toHaveAttribute('aria-disabled');
      expect(ficha).not.toHaveTextContent('Próximamente');
    }
    await userEvent.click(screen.getByRole('button', { name: /^Central/ }));
    expect(alElegir).toHaveBeenLastCalledWith(areaDe('central'));
    await userEvent.click(screen.getByRole('button', { name: /^Automatizaciones/ }));
    expect(alElegir).toHaveBeenLastCalledWith(areaDe('automatizaciones'));
    expect(alElegir).toHaveBeenCalledTimes(2);
  });

  it('las apagadas siguen en el orden de Tab (con teclado se llega a ellas y el lector las lee), sin tabindex que las saque', async () => {
    render(<Mapa alElegir={() => undefined} />);
    await userEvent.tab();
    const vistas: string[] = [];
    for (let i = 0; i < 5; i++) {
      vistas.push(document.activeElement?.querySelector('span')?.textContent ?? '?');
      await userEvent.tab();
    }
    expect(vistas).toEqual(['Marketing', 'Producto', 'Central', 'Ventas', 'Automatizaciones']);
  });

  it('ninguna ficha se ve elegida: sin «Estás aquí», sin aria-current y sin el tono de seleccionada (dueño, 15-oct-2026)', () => {
    render(<Mapa alElegir={() => undefined} />);
    expect(screen.queryByText('Estás aquí')).toBeNull();
    for (const ficha of screen.getAllByRole('button')) {
      expect(ficha).not.toHaveAttribute('aria-current');
      // el tono de «elegida» era `border-campo bg-elevada` a secas; ahora esas dos solo aparecen con `hover:`
      const clases = ficha.className.split(/\s+/);
      expect(clases).not.toContain('bg-elevada');
      expect(clases).not.toContain('border-campo');
    }
  });

  it('Marketing, Central y Automatizaciones, las que se abren, se ven EXACTAMENTE igual (mismo borde, mismo fondo, mismo texto); el hover se conserva', () => {
    render(<Mapa alElegir={() => undefined} />);
    // todo menos lo que las distingue de sitio y de tamaño (la cuadrícula, el centro más grande): el aspecto
    const aspecto = (nombre: string) =>
      screen
        .getByRole('button', { name: new RegExp(`^${nombre}`) })
        .className.split(/\s+/)
        .filter(c => /^(border|bg|text-texto|hover:|cursor|font)/.test(c) && !/^(text-(xs|sm|md))$/.test(c))
        .sort();
    expect(aspecto('Marketing')).toEqual(aspecto('Central'));
    expect(aspecto('Marketing')).toEqual(aspecto('Automatizaciones'));
    expect(aspecto('Marketing')).toEqual(expect.arrayContaining(['border-linea', 'bg-superficie', 'hover:border-campo', 'hover:bg-elevada']));
  });

  it('las apagadas se distinguen de las que se abren: fondo hundido y texto secundario, sin hover', () => {
    render(<Mapa alElegir={() => undefined} />);
    const apagada = screen.getByRole('button', { name: /^Producto/ }).className.split(/\s+/);
    expect(apagada).toEqual(expect.arrayContaining(['border-linea', 'bg-hundido', 'text-secundario']));
    expect(apagada).not.toContain('hover:bg-elevada');
  });

  it('las dos diagonales y los trazos cortos del celular son decoración: ocultos al lector y sin recibir clics', () => {
    const { container } = render(<Mapa alElegir={() => undefined} />);
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
    render(<Mapa alElegir={() => undefined} />);
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

  it('«Estás aquí» va solo en el grupo donde estás (si ya elegiste uno), y sin grupo (otra área, o nada elegido) en ninguno', () => {
    const { rerender } = render(<Grupos area={marketing} aqui="blotato" alElegir={() => undefined} />);
    expect(screen.getAllByText('Estás aquí')).toHaveLength(1);
    expect(screen.getByRole('button', { name: /^Blotato/ })).toHaveAttribute('aria-current', 'location');
    rerender(<Grupos area={marketing} aqui={null} alElegir={() => undefined} />);
    expect(screen.queryByText('Estás aquí')).toBeNull();
  });

  it('avisa qué grupo se eligió, con el ratón y con el teclado', async () => {
    const alElegir = vi.fn();
    render(<Grupos area={marketing} aqui={null} alElegir={alElegir} />);
    await userEvent.click(screen.getByRole('button', { name: /^Avanzado/ }));
    expect(alElegir).toHaveBeenLastCalledWith(marketing.grupos[2]);
    screen.getByRole('button', { name: /^Distrito/ }).focus();
    await userEvent.keyboard('{Enter}');
    expect(alElegir).toHaveBeenLastCalledWith(marketing.grupos[0]);
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
    // Deepseek todavía no existe: lo dice la tarjeta, igual que su contenido dirá que no está disponible
    expect(tarjetas[1]).toHaveTextContent('Próximamente');
  });

  it('el área de Automatizaciones trae Distrito y Tus automatizaciones; la segunda todavía no trae pantallas y lo dice', () => {
    render(<Grupos area={areaDe('automatizaciones')!} aqui={null} alElegir={() => undefined} />);
    const tarjetas = within(screen.getByRole('group', { name: 'Automatizaciones' })).getAllByRole('button');
    expect(tarjetas.map(t => t.querySelector('b')?.textContent)).toEqual(['Distrito', 'Tus automatizaciones']);
    expect(tarjetas[0]).toHaveTextContent('Constructor · Asistente · Actualizar flujos');
    expect(tarjetas[1]).toHaveTextContent('Próximamente');
  });
});
