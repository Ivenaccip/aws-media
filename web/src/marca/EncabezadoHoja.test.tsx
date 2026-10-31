// El encabezado de las hojas con título propio: un solo h1 («Irremplazables»), tres migas (área › grupo › pantalla) y la última quieta.
// Se prueba con una hoja que ya existe en el menú (COI); Automatizaciones usa el mismo componente.
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { EncabezadoHoja } from './EncabezadoHoja';
import { urlDeInicio, type Lugar } from './menu';

const COI: Lugar = { area: 'central', grupo: 'distrito', pantalla: 'coi' };

describe('EncabezadoHoja', () => {
  it('lleva un solo h1, «Irremplazables», y las tres migas del lugar', () => {
    render(<EncabezadoHoja lugar={COI} />);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Irremplazables');
    const nav = screen.getByRole('navigation', { name: 'Dónde estás' });
    expect(within(nav).getAllByRole('listitem')).toHaveLength(3);
    expect(nav.textContent).toContain('Central');
    expect(nav.textContent).toContain('Distrito');
  });

  it('el área abre el mapa y el grupo las opciones, desde esta pantalla; la última miga es un chip quieto', () => {
    render(<EncabezadoHoja lugar={COI} />);
    const enlaces = screen.getAllByRole('link');
    expect(enlaces.map(a => a.getAttribute('href'))).toEqual([urlDeInicio(COI, 'mapa'), urlDeInicio(COI, 'grupos')]);
    const actual = screen.getByText('COI', { selector: 'span' });
    expect(actual.getAttribute('aria-current')).toBe('step');
    expect(screen.queryByRole('link', { name: /COI/ })).toBeNull();
  });

  it('un lugar que no está en el menú avisa con un error claro en vez de pintar migas vacías', () => {
    expect(() => render(<EncabezadoHoja lugar={{ area: 'nada', grupo: 'nada', pantalla: 'nada' }} />)).toThrow(/no está en marca\/menu\.ts/);
  });
});
