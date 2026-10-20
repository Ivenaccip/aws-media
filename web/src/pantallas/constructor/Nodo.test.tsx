// Un cuadro del lienzo (Nodo.tsx) con su ×, sus «+» y su patita. Los datos salen de los selectores del motor
// (vistaNodos) con el flujo de ejemplo: un chat → «Atención a clientes» → «Revisor», con Google Sheets y Slack de herramientas.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ejemplo } from './modelo/ejemplos';
import { vistaNodos, type EstadoVista, type VistaNodo } from './modelo/selectores';
import { Nodo } from './Nodo';
import { useArrastre } from './useArrastre';

// new URL(…, import.meta.url) no sirve aquí: el URL global es el de jsdom
const leer = (archivo: string) => readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), archivo), 'utf8');

const estado = (extra: Partial<EstadoVista> = {}): EstadoVista => ({ flujo: ejemplo(), sel: null, selEdge: null, menu: null, conectando: null, ...extra });
const vista = (id: string, e: EstadoVista = estado()): VistaNodo => vistaNodos(e).find(v => v.id === id)!;

function fns() {
  return { alAbrir: vi.fn(), alQuitar: vi.fn(), alAbrirMas: vi.fn(), alMoverConTeclado: vi.fn(), alMover: vi.fn() };
}

/** Un cuadro con el arrastre real colgado, como lo monta Lienzo.tsx. */
function Montado({ v, f }: { v: VistaNodo; f: ReturnType<typeof fns> }) {
  const arrastre = useArrastre({ alMover: f.alMover });
  return <Nodo vista={v} arrastre={arrastre} alAbrir={f.alAbrir} alQuitar={f.alQuitar} alAbrirMas={f.alAbrirMas} alMoverConTeclado={f.alMoverConTeclado} />;
}

function montar(id: string, e: EstadoVista = estado()) {
  const f = fns();
  const v = vista(id, e);
  const r = render(<Montado v={v} f={f} />);
  return { f, v, r, cuadro: () => document.querySelector<HTMLButtonElement>(`[data-nodo="${id}"]`)! };
}

const dedo = (clientX: number, clientY: number, extra: Record<string, unknown> = {}) => ({ clientX, clientY, pointerId: 1, button: 0, buttons: 1, ...extra });

describe('Nodo: lo que dice y cómo se llama', () => {
  it('constructor.nodo.el_cuadro_dice_su_tipo_titulo_y_detalle_y_su_nombre_accesible_es_la_etiqueta_del_selector', () => {
    const { cuadro } = montar('a1');
    // el nombre trae las tres líneas que se ven, en el mismo orden (WCAG 2.5.3: quien dicta «clic OpenAI GPT» tiene que poder elegirlo)
    expect(cuadro()).toHaveAccessibleName('Agente de IA: Atención a clientes. OpenAI (GPT)');
    expect(cuadro()).toHaveTextContent('Agente de IA');
    expect(cuadro()).toHaveTextContent('Atención a clientes');
    expect(cuadro()).toHaveTextContent('OpenAI (GPT)');
    expect(cuadro().querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('constructor.nodo.las_tres_lineas_del_cuadro_van_separadas_por_espacios_para_quien_lee_su_texto_sin_el_css', () => {
    // axe junta el texto de los tres <span> sin espacios si el DOM no los trae: «Agente de IAAtención a clientesOpenAI (GPT)»
    const { cuadro } = montar('a1');
    expect(cuadro().textContent).toBe('Agente de IA Atención a clientes OpenAI (GPT)');
    // y el nombre accesible contiene ese texto visible (sin la puntuación), que es lo que pide WCAG 2.5.3
    const sinPuntos = (t: string) => t.replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    expect(sinPuntos(cuadro().getAttribute('aria-label') ?? '')).toContain(sinPuntos(cuadro().textContent ?? ''));
  });

  it('constructor.nodo.ningun_boton_del_cuadro_repite_su_nombre_en_un_title', () => {
    // un title igual al aria-label sale dos veces en el árbol de accesibilidad (nombre y descripción)
    const { r } = montar('a1');
    for (const b of Array.from(r.container.querySelectorAll('button'))) {
      expect(b.getAttribute('title'), b.getAttribute('aria-label') ?? '').toBeNull();
    }
  });

  it('constructor.nodo.cada_clase_de_cuadro_dice_lo_suyo_en_su_etiqueta', () => {
    for (const [id, nombre, descripcion] of [
      ['t1', 'Disparador: Chat. Mensaje en el chat', ''],
      ['a2', 'Agente de IA: Revisor. Claude (Anthropic)', ''],
      // de quién cuelga no va en el nombre (no está en el texto visible): va en la descripción
      ['p1', 'App · herramienta: Google Sheets. Lista para n8n', 'App · herramienta de «Atención a clientes»'],
    ] as const) {
      const { cuadro, r } = montar(id);
      expect(cuadro()).toHaveAccessibleName(nombre);
      expect(cuadro()).toHaveAccessibleDescription(descripcion);
      r.unmount();
    }
  });

  it('constructor.nodo.la_caja_del_cuadro_va_en_su_lugar_y_mide_216_por_96', () => {
    const { v, r } = montar('a1');
    const caja = r.container.firstElementChild as HTMLElement;
    expect(caja.style.left).toBe(`${v.x}px`);
    expect(caja.style.top).toBe(`${v.y}px`);
    expect(caja.style.width).toBe('216px');
    expect(caja.style.height).toBe('96px');
    expect(caja.className).toBe('cn-caja-nodo');
  });

  it('constructor.nodo.cada_variante_lleva_su_forma_y_lo_elegido_y_lo_colgado_cambian_el_borde_no_solo_el_tono', () => {
    expect(montar('t1').cuadro().className).toContain('cn-nodo-trig'); // la forma redonda del disparador
    expect(montar('a2').cuadro().className).toContain('cn-nodo-ag');
    const p = montar('p1');
    expect(p.cuadro().className).toContain('cn-nodo-app');
    expect(p.cuadro().className).toContain('cn-nodo-tool'); // cuelga de un agente: discontinuo
    expect(p.cuadro().className).not.toContain('cn-nodo-sel');
  });

  it('constructor.nodo.el_elegido_se_oye_con_aria_pressed_y_se_ve_con_su_clase', () => {
    const e = estado({ sel: 'a1' });
    const a1 = montar('a1', e);
    expect(a1.cuadro()).toHaveAttribute('aria-pressed', 'true');
    expect(a1.cuadro().className).toContain('cn-nodo-sel');
    const a2 = montar('a2', e);
    expect(a2.cuadro()).toHaveAttribute('aria-pressed', 'false');
    expect(a2.cuadro().className).not.toContain('cn-nodo-sel');
  });

  it('constructor.nodo.el_cuadro_anuncia_que_supr_lo_quita', () => {
    // Supr y Retroceso lo quitan; las flechas lo mueven (y Mayús las acelera): todo eso también lo oye quien usa lector de pantalla
    expect(montar('a1').cuadro()).toHaveAttribute('aria-keyshortcuts', 'Delete Backspace ArrowUp ArrowDown ArrowLeft ArrowRight');
  });
});

describe('Nodo: la ×, los «+» y la patita (contrato de atributos del foco)', () => {
  it('constructor.nodo.los_atributos_de_foco_son_el_contrato_data_nodo_data_quitar_y_data_mas', () => {
    const { r } = montar('a1');
    expect(r.container.querySelector('[data-nodo="a1"]')).toBeInTheDocument();
    expect(r.container.querySelector('[data-quitar="a1"]')).toBeInTheDocument();
    expect(r.container.querySelector('[data-mas="der-a1"]')).toBeInTheDocument();
    expect(r.container.querySelector('[data-mas="tool-a1"]')).toBeInTheDocument();
    // y el orden del DOM (el de Tab): cuadro, ×, «+» de la derecha, «+» de la patita
    const orden = Array.from(r.container.querySelectorAll('button')).map(b => b.getAttribute('data-nodo') ?? b.getAttribute('data-quitar') ?? b.getAttribute('data-mas'));
    expect(orden).toEqual(['a1', 'a1', 'der-a1', 'tool-a1']);
  });

  it('constructor.nodo.la_x_dice_cual_cuadro_quita_y_al_pulsarla_avisa_su_id', async () => {
    const { f } = montar('a2');
    const x = screen.getByRole('button', { name: 'Quitar «Revisor»' });
    expect(x).toHaveAttribute('data-quitar', 'a2');
    await userEvent.setup().click(x);
    expect(f.alQuitar).toHaveBeenCalledTimes(1);
    expect(f.alQuitar).toHaveBeenCalledWith('a2');
    expect(f.alAbrir).not.toHaveBeenCalled(); // la × no abre el cuadro
  });

  it('constructor.nodo.el_mas_de_la_derecha_es_suelto_si_no_sigue_nada_y_redondo_si_ya_hay_algo', () => {
    // «Revisor» no tiene nada después: el «+» suelto, con su tramo
    const a2 = montar('a2');
    const suelto = a2.r.container.querySelector('[data-mas="der-a2"]')!;
    expect(suelto.className).toContain('cn-mas-stub');
    expect(a2.r.container.querySelector('.cn-rama-der')).toBeInTheDocument();
    expect(suelto.querySelector('.cn-dibujo')!.className).not.toContain('cn-redondo');
    a2.r.unmount();
    // el disparador ya tiene un paso: el «+» redondo, pegado, sin tramo
    const t1 = montar('t1');
    const asa = t1.r.container.querySelector('[data-mas="der-t1"]')!;
    expect(asa.className).toContain('cn-mas-asa');
    expect(t1.r.container.querySelector('.cn-rama-der')).toBeNull();
    expect(asa.querySelector('.cn-dibujo')!.className).toContain('cn-redondo');
  });

  it('constructor.nodo.una_herramienta_no_tiene_mas_a_la_derecha_ni_patita', () => {
    const { r } = montar('p1');
    expect(r.container.querySelector('[data-mas]')).toBeNull();
    expect(r.container.querySelector('.cn-pata-txt')).toBeNull();
    expect(r.container.querySelector('.cn-rama')).toBeNull();
    expect(r.container.querySelectorAll('button')).toHaveLength(2); // el cuadro y su ×
  });

  it('constructor.nodo.un_agente_que_conversa_con_otra_ia_pierde_su_mas_de_la_derecha_pero_conserva_la_patita', () => {
    const flujo = ejemplo();
    flujo.edges.push({ id: 'e9', de: 'a1', a: 'a2', tipo: 'tool' });
    flujo.edges = flujo.edges.filter(e => e.id !== 'e2'); // a2 ya no es un paso, es su ayudante
    const { r } = montar('a1', estado({ flujo }));
    expect(r.container.querySelector('[data-mas="der-a1"]')).toBeNull();
    expect(r.container.querySelector('[data-mas="tool-a1"]')).toBeInTheDocument();
  });

  it('constructor.nodo.la_patita_es_solo_de_los_agentes_con_su_mas_y_su_rotulo_herramientas', async () => {
    const t1 = montar('t1');
    expect(t1.r.container.querySelector('[data-mas="tool-t1"]')).toBeNull();
    t1.r.unmount();
    const a1 = montar('a1');
    const mas = screen.getByRole('button', { name: 'Darle una herramienta a «Atención a clientes»: una app' });
    expect(mas).toHaveAttribute('data-mas', 'tool-a1');
    expect(a1.r.container.querySelector('.cn-pata-txt')).toHaveTextContent('Herramientas');
    expect(a1.r.container.querySelector('.cn-rama-tool')).toBeInTheDocument();
    await userEvent.setup().click(mas);
    expect(a1.f.alAbrirMas).toHaveBeenCalledWith('a1', 'tool');
  });

  it('constructor.nodo.el_mas_de_la_derecha_pide_el_menu_de_lo_que_sigue_con_su_nombre_completo', async () => {
    const { f } = montar('a2');
    const mas = screen.getByRole('button', { name: 'Agregar lo que sigue después de «Revisor»: una app o un agente de IA' });
    await userEvent.setup().click(mas);
    expect(f.alAbrirMas).toHaveBeenCalledTimes(1);
    expect(f.alAbrirMas).toHaveBeenCalledWith('a2', 'seq');
  });

  it('constructor.nodo.los_mas_dicen_si_su_menu_esta_abierto_con_aria_expanded_y_aria_haspopup', () => {
    const cerrado = montar('a1');
    for (const m of cerrado.r.container.querySelectorAll('[data-mas]')) {
      expect(m).toHaveAttribute('aria-haspopup', 'dialog');
      expect(m).toHaveAttribute('aria-expanded', 'false');
    }
    cerrado.r.unmount();
    const menu = { ancla: 'a1', tipo: 'tool' as const, paso: 'app' as const, insertarEn: null };
    const abierto = montar('a1', estado({ menu }));
    expect(abierto.r.container.querySelector('[data-mas="tool-a1"]')).toHaveAttribute('aria-expanded', 'true');
    expect(abierto.r.container.querySelector('[data-mas="tool-a1"]')!.className).toContain('cn-act');
    expect(abierto.r.container.querySelector('[data-mas="der-a1"]')).toHaveAttribute('aria-expanded', 'false');
  });

  it('constructor.nodo.todo_boton_de_solo_icono_tiene_nombre_con_verbo_y_objeto_y_ningun_texto_visible', () => {
    const { r } = montar('a1');
    for (const b of r.container.querySelectorAll<HTMLButtonElement>('[data-quitar],[data-mas]')) {
      expect(b).toHaveAccessibleName(/^(Quitar|Agregar|Darle) /);
      expect(b.textContent).toBe('');
      expect(b.querySelectorAll('.cn-dibujo')).toHaveLength(1); // un solo aro de foco por botón
    }
  });
});

describe('Nodo: abrir, teclado y arrastre', () => {
  it('constructor.nodo.un_clic_de_raton_abre_sin_teclado_y_enter_o_espacio_abren_con_teclado', async () => {
    const { f, cuadro } = montar('a1');
    const user = userEvent.setup();
    await user.click(cuadro());
    expect(f.alAbrir).toHaveBeenLastCalledWith('a1', false);
    cuadro().focus();
    await user.keyboard('{Enter}');
    expect(f.alAbrir).toHaveBeenLastCalledWith('a1', true); // el foco debe pasar a Ajustes
    await user.keyboard(' ');
    expect(f.alAbrir).toHaveBeenLastCalledWith('a1', true);
    expect(f.alAbrir).toHaveBeenCalledTimes(3);
  });

  it('constructor.nodo.las_flechas_mueven_con_la_direccion_y_mayus_pide_el_paso_grande_sin_desplazar_el_marco', () => {
    const { f, cuadro } = montar('a1');
    for (const [tecla, dir] of [
      ['ArrowLeft', 'izquierda'],
      ['ArrowRight', 'derecha'],
      ['ArrowUp', 'arriba'],
      ['ArrowDown', 'abajo'],
    ] as const) {
      // fireEvent devuelve false si alguien llamó a preventDefault: la flecha no debe desplazar el marco del lienzo
      expect(fireEvent.keyDown(cuadro(), { key: tecla })).toBe(false);
      expect(f.alMoverConTeclado).toHaveBeenLastCalledWith('a1', dir, false);
      expect(fireEvent.keyDown(cuadro(), { key: tecla, shiftKey: true })).toBe(false);
      expect(f.alMoverConTeclado).toHaveBeenLastCalledWith('a1', dir, true);
    }
    expect(f.alMoverConTeclado).toHaveBeenCalledTimes(8);
  });

  it('constructor.nodo.supr_y_retroceso_quitan_el_cuadro_una_sola_vez_por_pulsacion', () => {
    const { f, cuadro } = montar('a2');
    expect(fireEvent.keyDown(cuadro(), { key: 'Delete' })).toBe(false);
    expect(f.alQuitar).toHaveBeenLastCalledWith('a2');
    fireEvent.keyDown(cuadro(), { key: 'Backspace' });
    expect(f.alQuitar).toHaveBeenCalledTimes(2);
    // mantenerla apretada repite el evento: el foco ya habría pasado a otro cuadro y se quitaría también
    fireEvent.keyDown(cuadro(), { key: 'Delete', repeat: true });
    expect(f.alQuitar).toHaveBeenCalledTimes(2);
  });

  it('constructor.nodo.con_ctrl_o_cmd_las_teclas_son_del_lienzo_y_el_cuadro_no_las_toca', () => {
    const { f, cuadro } = montar('a2');
    for (const extra of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
      expect(fireEvent.keyDown(cuadro(), { key: 'ArrowLeft', ...extra })).toBe(true);
      expect(fireEvent.keyDown(cuadro(), { key: 'z', ...extra })).toBe(true);
      expect(fireEvent.keyDown(cuadro(), { key: 'Backspace', ...extra })).toBe(true);
    }
    expect(f.alMoverConTeclado).not.toHaveBeenCalled();
    expect(f.alQuitar).not.toHaveBeenCalled();
  });

  it('constructor.nodo.esc_y_las_demas_teclas_no_se_atienden_aqui_y_siguen_su_camino_al_lienzo', () => {
    const { f, cuadro } = montar('a2');
    expect(fireEvent.keyDown(cuadro(), { key: 'Escape' })).toBe(true); // nadie lo frena
    expect(fireEvent.keyDown(cuadro(), { key: 'a' })).toBe(true);
    expect(fireEvent.keyDown(cuadro(), { key: 'Tab' })).toBe(true);
    for (const fn of Object.values(f)) expect(fn).not.toHaveBeenCalled();
  });

  it('constructor.nodo.arrastrar_avisa_la_posicion_desde_la_del_cuadro_y_el_clic_final_no_lo_abre', () => {
    const { f, cuadro, v } = montar('a1'); // está en 312, 180
    expect([v.x, v.y]).toEqual([312, 180]);
    fireEvent.pointerDown(cuadro(), dedo(400, 220));
    fireEvent.pointerMove(cuadro(), dedo(430, 200));
    expect(f.alMover).toHaveBeenLastCalledWith('a1', 342, 160);
    fireEvent.pointerMove(cuadro(), dedo(380, 260));
    expect(f.alMover).toHaveBeenLastCalledWith('a1', 292, 220);
    fireEvent.pointerUp(cuadro(), dedo(380, 260, { buttons: 0 }));
    fireEvent.click(cuadro(), { detail: 1 });
    expect(f.alAbrir).not.toHaveBeenCalled(); // soltar después de arrastrar no abre los ajustes
  });

  it('constructor.nodo.un_clic_corto_con_un_temblor_menor_al_umbral_si_abre_y_no_mueve', () => {
    const { f, cuadro } = montar('a1');
    fireEvent.pointerDown(cuadro(), dedo(400, 220));
    fireEvent.pointerMove(cuadro(), dedo(402, 222)); // 2 + 2 < 6
    fireEvent.pointerUp(cuadro(), dedo(402, 222, { buttons: 0 }));
    fireEvent.click(cuadro(), { detail: 1 });
    expect(f.alMover).not.toHaveBeenCalled();
    expect(f.alAbrir).toHaveBeenCalledWith('a1', false);
  });

  it('constructor.nodo.arrastrar_el_cuadro_no_arrastra_la_x_ni_los_mas_que_son_botones_aparte', () => {
    const { f, r } = montar('a1');
    const x = r.container.querySelector('[data-quitar]')!;
    fireEvent.pointerDown(x, dedo(10, 10));
    fireEvent.pointerMove(x, dedo(80, 10));
    expect(f.alMover).not.toHaveBeenCalled();
  });

  it('constructor.nodo.el_cuadro_no_deja_que_el_dedo_desplace_la_pagina_y_no_se_selecciona_su_texto', () => {
    const css = leer('constructor.css');
    const regla = css.match(/\.cn-nodo\s*\{([^}]*)\}/)![1]!;
    expect(regla).toMatch(/touch-action:\s*none/);
    expect(regla).toMatch(/user-select:\s*none/);
    expect(regla).toMatch(/cursor:\s*grab/);
  });
});

describe('Nodo: el modo «toca el cuadro destino»', () => {
  const conectando = { ancla: 'a1', rol: 'origen' as const, tipo: 'seq' as const };

  it('constructor.nodo.un_cuadro_que_no_es_destino_se_apaga_con_aria_disabled_y_su_motivo_se_lee', async () => {
    const e = estado({ conectando, sel: 'a1' });
    const { f, cuadro, v } = montar('t1', e); // nada puede ir antes de un disparador
    expect(v.modoConexion).toBe('nulo');
    expect(v.motivoNulo).toMatch(/disparador/);
    expect(cuadro()).toHaveAttribute('aria-disabled', 'true');
    expect(cuadro()).not.toBeDisabled(); // sigue enfocable: se puede leer por qué no
    expect(cuadro()).toHaveAccessibleDescription(v.motivoNulo!);
    expect(cuadro().className).toContain('cn-nodo-nulo');
    // y su clic SÍ llega: el reductor contesta con el motivo en un aviso
    await userEvent.setup().click(cuadro());
    expect(f.alAbrir).toHaveBeenCalledWith('t1', false);
  });

  it('constructor.nodo.el_destino_valido_y_el_ancla_se_marcan_distinto_y_ninguno_trae_descripcion_de_motivo', () => {
    const e = estado({ conectando: { ancla: 't1', rol: 'origen', tipo: 'seq' }, sel: 't1' });
    const ancla = montar('t1', e);
    expect(ancla.v.modoConexion).toBe('ancla');
    expect(ancla.cuadro().className).toContain('cn-nodo-sel');
    expect(ancla.cuadro()).not.toHaveAttribute('aria-disabled');
    ancla.r.unmount();
    const destino = montar('a2', e);
    expect(destino.v.modoConexion).toBe('destino');
    expect(destino.cuadro().className).toContain('cn-nodo-destino');
    expect(destino.cuadro()).not.toHaveAttribute('aria-disabled');
    expect(destino.cuadro()).not.toHaveAttribute('aria-describedby');
  });

  it('fuera_del_modo_conectando_ningun_cuadro_se_marca_como_destino_ni_como_apagado', () => {
    const { cuadro } = montar('a2');
    expect(cuadro().className).not.toMatch(/cn-nodo-(destino|nulo)/);
    expect(cuadro()).not.toHaveAttribute('aria-disabled');
  });
});

describe('Nodo: la × no se come los toques del cuadro', () => {
  it('constructor.nodo.el_area_tactil_de_la_x_no_entra_al_cuadro_solo_su_circulo_y_un_pedazo_en_forma_de_l_por_fuera', () => {
    // la × mide 44 × 44 y cuelga de la esquina: 30 × 22 px de ese cuadrado caían DENTRO del cuadro y tocar o arrastrar ahí lo quitaba
    const css = leer('constructor.css').replace(/\/\*[\s\S]*?\*\//g, '');
    const boton = css.match(/\.cn-quitar\s*\{([^}]*)\}/)![1]!;
    expect(boton).toMatch(/pointer-events:\s*none/);
    expect(boton).toMatch(/left:\s*186px/); // el dibujo sigue en la esquina: no se mueve
    expect(boton).toMatch(/top:\s*-22px/);
    // el pedazo transparente de FUERA del cuadro: la «L» (arriba de todo, y la franja derecha), sin el rincón de 30 × 22 que cae sobre el cuadro
    const pedazo = css.match(/\.cn-quitar::before\s*\{([^}]*)\}/)![1]!;
    expect(pedazo).toMatch(/pointer-events:\s*auto/);
    expect(pedazo).toMatch(/clip-path:\s*polygon\(0 0,\s*100% 0,\s*100% 100%,\s*30px 100%,\s*30px 22px,\s*0 22px\)/);
    // y el círculo que se ve sí recibe el toque (aunque cruce la esquina)
    expect(css).toMatch(/\.cn-quitar \.cn-dibujo\s*\{[^}]*pointer-events:\s*auto/);
  });

  it('constructor.nodo.la_x_sigue_siendo_un_boton_de_44_con_su_dibujo_adentro_y_se_alcanza_con_el_teclado', () => {
    const { r } = montar('a1');
    const x = r.container.querySelector<HTMLButtonElement>('[data-quitar="a1"]')!;
    expect(x.className).toContain('cn-b44');
    expect(x.className).toContain('cn-quitar');
    expect(x.querySelector('.cn-dibujo')).toBeInTheDocument();
    expect(x.tabIndex).toBe(0);
    expect(x).toHaveAccessibleName('Quitar «Atención a clientes»');
  });
});

describe('Nodo: hoja y fuente', () => {
  it('constructor.nodo.ni_la_hoja_ni_los_componentes_traen_un_color_suelto', () => {
    const suelto = new RegExp(['#[0-9a-fA-F]{3,8}\\b', 'rgba?\\(', 'hsla?\\(', 'oklch\\(', 'color-mix\\('].join('|'));
    for (const archivo of ['constructor.css', 'Nodo.tsx', 'Lienzo.tsx', 'Flechas.tsx', 'useArrastre.ts']) {
      expect(leer(archivo), archivo).not.toMatch(suelto);
    }
  });

  it('constructor.nodo.la_hoja_prefija_todo_con_cn_va_en_la_capa_components_y_lee_los_colores_de_los_tokens', () => {
    const css = leer('constructor.css').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css.trimStart().startsWith('@layer components {')).toBe(true);
    const clases = css.match(/\.[a-z][\w-]*/g)!.filter(c => !/^\.\d/.test(c));
    expect(clases.length).toBeGreaterThan(20);
    for (const c of clases) expect(c, c).toMatch(/^\.cn-/);
    // los colores son variables de token: ninguna propiedad de color con otra cosa
    for (const m of css.matchAll(/(?:color|background|border-color|border|outline|box-shadow)\s*:\s*([^;]+);/g)) {
      const valor = m[1]!;
      expect(valor, valor).not.toMatch(/#|rgb|hsl/);
    }
    expect(css).toMatch(/var\(--color-ambar-claro\)/);
  });

  it('constructor.nodo.nada_se_anima_en_left_top_ni_transform_solo_color_borde_y_fondo', () => {
    const css = leer('constructor.css').replace(/\/\*[\s\S]*?\*\//g, '');
    const transiciones = [...css.matchAll(/transition(?:-property)?\s*:([^;]+);/g)].map(m => m[1]!);
    expect(transiciones.length).toBeGreaterThan(0);
    for (const t of transiciones) expect(t, t).not.toMatch(/\b(left|top|right|bottom|transform|width|height|all)\b/);
    expect(css).not.toMatch(/animation|@keyframes/);
    // y el TSX no anima por JS: ni requestAnimationFrame, ni animate(), ni scroll suave
    for (const archivo of ['Nodo.tsx', 'Lienzo.tsx', 'Flechas.tsx', 'useArrastre.ts']) {
      expect(leer(archivo), archivo).not.toMatch(/requestAnimationFrame|\.animate\(|behavior:\s*['"]smooth|setInterval/);
    }
  });
});
