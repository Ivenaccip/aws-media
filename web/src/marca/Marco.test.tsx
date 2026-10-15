import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { Marco } from './Marco';
import { MENU } from './menu';

function marco(pantalla: string) {
  return render(
    <Marco pantalla={pantalla} titulo="Una pantalla">
      <p>El cuerpo</p>
    </Marco>,
  );
}

const migas = () => screen.queryByRole('navigation', { name: 'Dónde estás' });

// Las cinco pantallas hoja que el mapa conoce, con lo que sus migas deben decir y a dónde deben llevar. Los hrefs son LITERALES
// a propósito: la prueba es el contrato con el inicio (`?desde=<área>.<grupo>.<pantalla>&ver=mapa|grupos`, pantallas/inicio/recorrido.ts).
const EN_EL_MAPA = [
  { pantalla: 'agenda', area: 'Marketing', grupo: 'Blotato', lugar: 'mkt.blotato.agenda' },
  { pantalla: 'competencia', area: 'Marketing', grupo: 'Blotato', lugar: 'mkt.blotato.competencia' },
  { pantalla: 'metricas', area: 'Marketing', grupo: 'Blotato', lugar: 'mkt.blotato.metricas' },
  // MIX se llama «mix» en el Marco y «Publicaciones automáticas» en el mapa
  { pantalla: 'mix', area: 'Marketing', grupo: 'Avanzado', lugar: 'mkt.avanzado.automaticas' },
  { pantalla: 'estilos', area: 'Marketing', grupo: 'Avanzado', lugar: 'mkt.avanzado.estilos' },
];

const FUERA_DEL_MAPA = ['admin', 'crear', 'subir', 'clip', 'imagenes', 'shorts'];

describe('Marco · las migas de las pantallas hoja', () => {
  it.each(EN_EL_MAPA)('marco.migas.$pantalla: «$area › $grupo» son enlaces al inicio con la pantalla de origen', ({ pantalla, area, grupo, lugar }) => {
    marco(pantalla);
    const ruta = within(migas()!);
    const enlaces = ruta.getAllByRole('link');
    expect(enlaces.map(a => a.textContent)).toEqual([area, grupo]);
    // «Marketing» abre el mapa de áreas; el grupo, las tres opciones de su área
    expect(enlaces[0]).toHaveAttribute('href', `/estudio/inicio/?desde=${lugar}&ver=mapa`);
    expect(enlaces[1]).toHaveAttribute('href', `/estudio/inicio/?desde=${lugar}&ver=grupos`);
  });

  it('marco.migas.rotulos: cada enlace dice a dónde lleva y dónde estás, con su texto visible dentro (WCAG 2.5.3)', () => {
    marco('agenda');
    expect(screen.getByRole('link', { name: 'Ir al mapa para cambiar de área (ahora: Marketing)' })).toHaveTextContent('Marketing');
    expect(screen.getByRole('link', { name: 'Ir a las opciones de Marketing (ahora: Blotato)' })).toHaveTextContent('Blotato');
  });

  it.each(FUERA_DEL_MAPA)('marco.migas.%s: una pantalla que el mapa no conoce no lleva migas', pantalla => {
    marco(pantalla);
    expect(migas()).toBeNull();
    expect(screen.getAllByRole('navigation')).toHaveLength(1);
  });

  it('marco.migas.desconocida: una clave que nadie registró tampoco rompe nada ni inventa migas', () => {
    marco('algo-que-no-existe');
    expect(migas()).toBeNull();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Una pantalla');
  });
});

describe('Marco · «← Estudio» sigue donde las pantallas lo buscan', () => {
  it.each([...EN_EL_MAPA.map(p => p.pantalla), ...FUERA_DEL_MAPA])('marco.estudio.%s: la nav «Navegación» solo lleva «Estudio»', pantalla => {
    marco(pantalla);
    const nav = screen.getByRole('navigation', { name: 'Navegación' });
    const enlaces = within(nav).getAllByRole('link');
    expect(enlaces).toHaveLength(1);
    expect(enlaces[0]).toHaveAttribute('href', '/estudio/');
    // el mismo nombre con el que las pruebas de las doce pantallas lo buscan
    expect(screen.getByRole('link', { name: 'Estudio' })).toBe(enlaces[0]);
  });

  it('marco.estudio.separado: las migas viven en su propia nav, no dentro de «Navegación»', () => {
    marco('agenda');
    const navegacion = screen.getByRole('navigation', { name: 'Navegación' });
    expect(navegacion.contains(migas())).toBe(false);
    expect(migas()!.contains(navegacion)).toBe(false);
    expect(within(navegacion).queryByRole('link', { name: /Marketing|Blotato/ })).toBeNull();
  });

  it('marco.orden: con Tab se pasa por «Estudio», luego el área y luego el grupo, y la página sigue después', async () => {
    marco('metricas');
    const usuario = userEvent.setup();
    await usuario.tab();
    expect(screen.getByRole('link', { name: 'Estudio' })).toHaveFocus();
    await usuario.tab();
    expect(screen.getByRole('link', { name: /^Ir al mapa/ })).toHaveFocus();
    await usuario.tab();
    expect(screen.getByRole('link', { name: /^Ir a las opciones/ })).toHaveFocus();
  });

  it('marco.titulo: el título sigue siendo el único h1 y el cuerpo va dentro de <main>', () => {
    marco('agenda');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(within(screen.getByRole('main')).getByText('El cuerpo')).toBeVisible();
    expect(within(screen.getByRole('main')).queryByRole('navigation')).toBeNull();
  });
});

// El mapa (marca/menu.ts) y las pantallas llaman igual a cada página solo si alguien lo vigila: una `pagina` mal escrita no rompe
// nada, simplemente deja la pantalla sin migas. Y una pantalla nueva con `<Marco pantalla="…">` que nadie puso en el mapa tampoco
// avisa. Esta prueba lee los fuentes para que las dos cosas fallen aquí, con el nombre de la pantalla a la vista.
describe('Marco · el mapa y las pantallas hablan de las mismas páginas', () => {
  const fuentes = import.meta.glob<string>(['../pantallas/*/*.tsx', '!../pantallas/*/*.test.tsx'], {
    query: '?raw',
    import: 'default',
    eager: true,
  });
  const usadas = new Set(
    Object.values(fuentes).flatMap(fuente => [...fuente.matchAll(/<Marco\b[^>]*?\bpantalla="([^"]+)"/gs)].map(m => m[1]!)),
  );
  const registradas = MENU.flatMap(a => a.grupos.flatMap(g => g.pantallas)).flatMap(p => (p.pagina ? [p.pagina] : []));

  it('marco.mapa.paginas_existen: cada `pagina` del mapa es la `pantalla` de un <Marco> de verdad', () => {
    expect(usadas.size).toBeGreaterThanOrEqual(EN_EL_MAPA.length + FUERA_DEL_MAPA.length);
    expect(registradas.filter(p => !usadas.has(p))).toEqual([]);
  });

  it('marco.mapa.sin_migas_a_proposito: las pantallas con <Marco> que el mapa no tiene son las seis decididas', () => {
    const sinLugar = [...usadas].filter(p => !registradas.includes(p)).sort();
    // pantalla nueva con Marco: o va al mapa (`pagina` en menu.ts, y aquí en EN_EL_MAPA), o se decide a propósito que no lleva migas
    expect(sinLugar).toEqual([...FUERA_DEL_MAPA].sort());
  });
});
