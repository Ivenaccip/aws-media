// Las flechas del lienzo (Flechas.tsx): un <svg> por conexión con su curva y sus puntas, y el círculo de 44 × 44 que es
// lo único clicable. Los datos salen de los selectores del motor (vistaFlechas), igual que en la pantalla.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { InsigniasFlechas, LineasFlechas } from './Flechas';
import { ejemplo } from './modelo/ejemplos';
import { vistaFlechas, type EstadoVista, type VistaFlecha } from './modelo/selectores';
import type { Flujo } from './modelo/tipos';

const estado = (flujo: Flujo = ejemplo(), extra: Partial<EstadoVista> = {}): EstadoVista => ({ flujo, sel: null, selEdge: null, menu: null, conectando: null, ...extra });
const flechasDe = (e: EstadoVista = estado()) => vistaFlechas(e);

// new URL(…, import.meta.url) no sirve aquí: el URL global es el de jsdom
const leer = (archivo: string) => readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), archivo), 'utf8');
const FUENTE = leer('Flechas.tsx');

/** Las capas pintadas, tal como las pone Lienzo.tsx: las líneas y, aparte, los círculos. */
function Capas({ flechas, alAbrir = () => {} }: { flechas: readonly VistaFlecha[]; alAbrir?: (id: string) => void }) {
  return (
    <div data-testid="capas">
      <LineasFlechas flechas={flechas} />
      <InsigniasFlechas flechas={flechas} alAbrir={alAbrir} />
    </div>
  );
}

const svgs = () => Array.from(document.querySelectorAll('svg[data-flecha]'));

describe('LineasFlechas', () => {
  it('constructor.flechas.hay_un_svg_por_conexion_con_su_id_y_dos_trazos_la_curva_y_las_puntas_aparte', () => {
    const flechas = flechasDe();
    render(<Capas flechas={flechas} />);
    expect(svgs().map(s => s.getAttribute('data-flecha'))).toEqual(['e1', 'e2', 'e3', 'e4']);
    for (const f of flechas) {
      const svg = document.querySelector(`svg[data-flecha="${f.id}"]`)!;
      const trazos = svg.querySelectorAll('path');
      expect(trazos).toHaveLength(2);
      expect(trazos[0]!.getAttribute('d')).toBe(f.d); // la curva
      expect(trazos[1]!.getAttribute('d')).toBe(f.puntas); // las puntas, aparte
      expect(trazos[0]!.getAttribute('fill')).toBe('none'); // la curva no se rellena
      expect(trazos[1]!.getAttribute('stroke')).toBe('none'); // las puntas son relleno, sin borde
    }
  });

  it('constructor.flechas.las_lineas_son_decoracion_sin_eventos_y_fuera_del_arbol_de_accesibilidad', () => {
    render(<Capas flechas={flechasDe()} />);
    for (const s of svgs()) {
      expect(s.getAttribute('aria-hidden')).toBe('true');
      expect(s.getAttribute('focusable')).toBe('false');
      expect(s.getAttribute('class')).toContain('pointer-events-none');
      expect(s.getAttribute('class')).toContain('overflow-visible');
      expect(s.querySelector('[tabindex]')).toBeNull();
    }
  });

  it('constructor.flechas.cada_svg_cubre_el_lienzo_por_css_y_no_trae_ancho_ni_alto_que_cambien_al_crecer', () => {
    render(<Capas flechas={flechasDe()} />);
    for (const s of svgs()) {
      expect(s.getAttribute('class')).toContain('absolute');
      expect(s.getAttribute('class')).toContain('inset-0');
      expect(s.getAttribute('class')).toContain('size-full');
      expect(s.hasAttribute('width')).toBe(false);
      expect(s.hasAttribute('height')).toBe(false);
      expect(s.hasAttribute('viewBox')).toBe(false);
    }
  });

  it('constructor.flechas.solo_las_de_ida_y_vuelta_van_punteadas_y_la_elegida_es_mas_gruesa_y_ambar', () => {
    const e = estado(ejemplo(), { selEdge: 'e2' });
    render(<Capas flechas={flechasDe(e)} />);
    const linea = (id: string) => document.querySelector(`svg[data-flecha="${id}"] path`)!;
    expect(linea('e1').getAttribute('stroke-dasharray')).toBeNull(); // un solo sentido: continua
    expect(linea('e2').getAttribute('stroke-dasharray')).toBeNull();
    expect(linea('e3').getAttribute('stroke-dasharray')).toBe('6 6'); // herramienta: punteada
    expect(linea('e4').getAttribute('stroke-dasharray')).toBe('6 6');
    expect(linea('e1').getAttribute('stroke-width')).toBe('2');
    expect(linea('e2').getAttribute('stroke-width')).toBe('3'); // la elegida
    expect(linea('e1').getAttribute('class')).toBe('stroke-secundario');
    expect(linea('e2').getAttribute('class')).toBe('stroke-ambar-claro');
    const puntas = (id: string) => document.querySelectorAll(`svg[data-flecha="${id}"] path`)[1]!;
    expect(puntas('e1').getAttribute('class')).toBe('fill-secundario');
    expect(puntas('e2').getAttribute('class')).toBe('fill-ambar-claro');
  });

  it('constructor.flechas.ninguna_curva_ni_punta_ni_insignia_trae_nan_ni_undefined', () => {
    // el ejemplo, dos IA que conversan y una herramienta al lado y a la misma altura del agente (los cuatro caminos de geometriaFlecha)
    const flujos: Flujo[] = [
      ejemplo(),
      {
        nombreFlujo: 'x',
        nodes: [
          { id: 'a1', kind: 'agent', x: 8, y: 180, nombre: 'A', ia: 'openai', tarea: '', instrucciones: '' },
          { id: 'a2', kind: 'agent', x: 352, y: 180, nombre: 'B', ia: 'openai', tarea: '', instrucciones: '', desc: 'x' },
          { id: 'p1', kind: 'app', x: 8, y: 180, nombre: 'Gmail' }, // encima del agente: el caso degenerado
          { id: 'p2', kind: 'app', x: 300, y: 100, nombre: 'Slack' }, // al lado
          { id: 'p3', kind: 'app', x: 8, y: 20, nombre: 'Notion' }, // arriba
        ],
        edges: [
          { id: 'e1', de: 'a1', a: 'a2', tipo: 'tool' },
          { id: 'e2', de: 'a1', a: 'p1', tipo: 'tool' },
          { id: 'e3', de: 'a1', a: 'p2', tipo: 'tool' },
          { id: 'e4', de: 'a1', a: 'p3', tipo: 'tool' },
        ],
      },
    ];
    for (const flujo of flujos) {
      const { unmount } = render(<Capas flechas={flechasDe(estado(flujo))} />);
      expect(screen.getByTestId('capas').innerHTML).not.toMatch(/NaN|undefined|Infinity|\[object/);
      unmount();
    }
  });

  it('constructor.flechas.un_cuadro_que_ya_no_existe_no_deja_flecha_huerfana', () => {
    const flujo = ejemplo();
    flujo.nodes = flujo.nodes.filter(n => n.id !== 'a2');
    render(<Capas flechas={flechasDe(estado(flujo))} />);
    expect(svgs().map(s => s.getAttribute('data-flecha'))).toEqual(['e1', 'e3']); // e2 y e4 tocaban a «a2»
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });

  it('un_svg_ya_pintado_se_conserva_si_su_dibujo_no_cambia_y_se_repinta_si_cambia', () => {
    const { rerender } = render(<Capas flechas={flechasDe()} />);
    const antes = document.querySelector('svg[data-flecha="e1"] path')!;
    // otra lectura de los selectores: objetos nuevos con los mismos datos
    rerender(<Capas flechas={flechasDe()} />);
    expect(document.querySelector('svg[data-flecha="e1"] path')).toBe(antes);
    const movido = ejemplo();
    const a2 = movido.nodes.find(n => n.id === 'a2')!;
    a2.x += 40;
    rerender(<Capas flechas={flechasDe(estado(movido))} />);
    const e2 = vistaFlechas(estado(movido)).find(f => f.id === 'e2')!;
    expect(document.querySelector('svg[data-flecha="e2"] path')!.getAttribute('d')).toBe(e2.d);
  });
});

describe('InsigniasFlechas', () => {
  it('constructor.flechas.cada_flecha_tiene_su_circulo_de_44_con_el_nombre_que_dice_el_selector', () => {
    const flechas = flechasDe();
    render(<Capas flechas={flechas} />);
    const botones = screen.getAllByRole('button');
    expect(botones).toHaveLength(flechas.length);
    for (const f of flechas) {
      const b = screen.getByRole('button', { name: f.etiqueta });
      expect(b.getAttribute('data-insignia')).toBe(f.id);
      expect(b.getAttribute('title')).toBe(f.titulo);
      expect(b.getAttribute('title')).not.toBe(f.etiqueta); // el title es otro texto a propósito
      expect(b.style.left).toBe(`${f.insignia.x}px`); // la esquina de la caja de 44 × 44
      expect(b.style.top).toBe(`${f.insignia.y}px`);
    }
    expect(screen.getByRole('button', { name: 'Conexión de «Disparador Chat» a «Atención a clientes»: un solo sentido. Editar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Conexión de «Atención a clientes» a «Google Sheets»: ida y vuelta. Editar' })).toBeInTheDocument();
  });

  it('constructor.flechas.el_circulo_mide_44_por_44_y_el_aro_de_foco_va_en_el_dibujo_de_28', () => {
    const css = leer('constructor.css');
    const b44 = css.match(/\.cn-b44\s*\{([^}]*)\}/)![1]!;
    expect(b44).toMatch(/width:\s*44px/);
    expect(b44).toMatch(/height:\s*44px/);
    expect(css).toMatch(/\.cn-b44:focus-visible\s*\{\s*outline:\s*none/); // el botón no pinta aro…
    expect(css).toMatch(/\.cn-b44:focus-visible \.cn-dibujo\s*\{[^}]*outline:\s*2px solid var\(--color-ambar-claro\)/); // …lo pinta el dibujo
    expect(css).toMatch(/\.cn-d28\s*\{[^}]*width:\s*28px[^}]*height:\s*28px/);
    render(<Capas flechas={flechasDe()} />);
    for (const b of screen.getAllByRole('button')) {
      expect(b.className).toContain('cn-b44');
      const dibujo = b.querySelector('.cn-dibujo')!;
      expect(dibujo.className).toContain('cn-d28');
      expect(b.querySelectorAll('.cn-dibujo')).toHaveLength(1); // un solo aro, nunca dos
    }
  });

  it('constructor.flechas.la_flecha_elegida_se_oye_con_aria_pressed_y_se_ve_por_su_clase_no_solo_por_el_tono', () => {
    const e = estado(ejemplo(), { selEdge: 'e3' });
    render(<Capas flechas={flechasDe(e)} />);
    const botones = screen.getAllByRole('button');
    const elegidos = botones.filter(b => b.getAttribute('aria-pressed') === 'true');
    expect(elegidos.map(b => b.getAttribute('data-insignia'))).toEqual(['e3']);
    expect(elegidos[0]!.className).toContain('cn-insignia-act');
    expect(botones.filter(b => b.getAttribute('aria-pressed') === 'false')).toHaveLength(3);
  });

  it('constructor.flechas.la_insignia_de_ida_y_vuelta_es_discontinua_y_lleva_otro_icono_que_la_de_un_sentido', () => {
    render(<Capas flechas={flechasDe()} />);
    const uno = document.querySelector('[data-insignia="e1"]')!;
    const dos = document.querySelector('[data-insignia="e3"]')!;
    expect(uno.className).not.toContain('cn-insignia-tool');
    expect(dos.className).toContain('cn-insignia-tool');
    // el ícono es el trazo del selector (unSentido / idaYVuelta), no el mismo
    expect(uno.querySelector('path')!.getAttribute('d')).not.toBe(dos.querySelector('path')!.getAttribute('d'));
    expect(uno.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
  });

  it('constructor.flechas.tocar_el_circulo_o_pulsar_enter_abre_esa_flecha_y_ninguna_otra', async () => {
    const alAbrir = vi.fn();
    const user = userEvent.setup();
    render(<Capas flechas={flechasDe()} alAbrir={alAbrir} />);
    await user.click(document.querySelector('[data-insignia="e2"]')!);
    expect(alAbrir).toHaveBeenCalledTimes(1);
    expect(alAbrir).toHaveBeenLastCalledWith('e2');
    document.querySelector<HTMLElement>('[data-insignia="e4"]')!.focus();
    await user.keyboard('{Enter}');
    expect(alAbrir).toHaveBeenLastCalledWith('e4');
    await user.keyboard(' ');
    expect(alAbrir).toHaveBeenCalledTimes(3);
  });

  it('constructor.flechas.dos_ia_que_conversan_son_una_flecha_de_ida_y_vuelta_con_dos_puntas', () => {
    const flujo = ejemplo();
    flujo.edges.push({ id: 'e9', de: 'a1', a: 'a2', tipo: 'tool' });
    const f = flechasDe(estado(flujo)).find(x => x.id === 'e9')!;
    expect(f.forma).toBe('conversan');
    render(<Capas flechas={[f]} />);
    const puntas = document.querySelectorAll('svg[data-flecha="e9"] path')[1]!.getAttribute('d')!;
    expect(puntas.match(/z/g)).toHaveLength(2); // una punta en cada extremo
    expect(screen.getByRole('button', { name: /ida y vuelta\. Editar$/ })).toBeInTheDocument();
  });

  it('constructor.flechas.ni_el_codigo_ni_la_hoja_traen_un_color_suelto', () => {
    const hoja = leer('constructor.css');
    const suelto = new RegExp(['#[0-9a-fA-F]{3,8}\\b', 'rgba?\\(', 'hsla?\\(', 'oklch\\('].join('|'));
    expect(FUENTE).not.toMatch(suelto);
    expect(hoja).not.toMatch(suelto);
    // el color de cada trazo es una clase de token (cadena completa) y nada pinta con un literal
    expect(FUENTE).toContain("'stroke-secundario'");
    expect(FUENTE).toContain("'fill-ambar-claro'");
    expect(FUENTE).not.toMatch(/stroke=["'{](?!none)/);
  });

  it('el_dibujo_de_cada_boton_vive_en_su_propio_nodo_y_el_boton_no_tiene_otro_texto_que_su_nombre', () => {
    render(<Capas flechas={flechasDe()} />);
    const b = screen.getAllByRole('button')[0]!;
    expect(within(b).queryByText(/./)).toBeNull(); // sin texto visible: el nombre es solo el aria-label
    fireEvent.focus(b);
    expect(b).toHaveAccessibleName(/^Conexión de /);
  });
});
