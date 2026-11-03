// El texto que acompaña al lienzo como COMPORTAMIENTO: la pista de qué sigue, «Conectando. …» con su «Cancelar», la leyenda de las dos
// maneras de conectar, los atajos del teclado plegados y el resumen del flujo («Te falta esto…» sin región viva).
// Cada test con ID (`constructor.guia.…`) es un invariante registrado.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AvisoConectando, AyudaTeclado, Guia, ID_AYUDA_TECLADO, ID_FALTAN, Leyenda, ResumenDelFlujo } from './Guia';
import { ejemplo } from './modelo/ejemplos';
import { estadoInicial, reducir } from './modelo/reductor';
import { guia, resumenFlujo, textoConectar } from './modelo/selectores';
import type { AccionConstructor } from './modelo/tipos';

describe('Guia', () => {
  it('constructor.guia.la_pista_cambia_con_el_flujo_y_es_texto_fijo_sin_region_viva', () => {
    const { rerender } = render(<Guia texto={guia(estadoInicial())} />);
    expect(screen.getByText('Paso 1: elige cómo arranca tu flujo.')).toBeInTheDocument();
    rerender(<Guia texto={guia(estadoInicial(ejemplo()))} />);
    expect(screen.getByText(/^Toca el círculo de una flecha/)).toBeInTheDocument();
    // la pista cambia en cada paso: si fuera una región viva, se anunciaría sola cada vez
    expect(document.querySelector('[role="status"],[aria-live],[role="alert"]')).toBeNull();
  });

  it('constructor.guia.conectando_dice_que_tocar_y_cancelar_manda_cancelarconexion', async () => {
    const user = userEvent.setup();
    const despachar = vi.fn<(a: AccionConstructor) => void>();
    const e = reducir(estadoInicial(ejemplo()), { k: 'iniciarConexion', ancla: 'a2', rol: 'origen', tipo: 'seq' });
    const texto = textoConectar(e);
    expect(texto).toBe('Toca el cuadro que irá DESPUÉS de «Revisor».');
    render(<AvisoConectando texto={texto} despachar={despachar} />);
    expect(screen.getByText('Conectando.')).toBeInTheDocument();
    expect(screen.getByText(/Toca el cuadro que irá DESPUÉS de «Revisor»\./)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(despachar).toHaveBeenCalledTimes(1);
    expect(despachar).toHaveBeenCalledWith({ k: 'cancelarConexion' });
    // no es región viva: el reductor ya dejó el mismo texto en su aviso y se anuncia una sola vez
    expect(document.querySelector('[role="status"],[aria-live],[role="alert"]')).toBeNull();
  });

  it('constructor.guia.sin_conexion_en_curso_el_aviso_no_pinta_nada', () => {
    const { container } = render(<AvisoConectando texto={textoConectar(estadoInicial(ejemplo()))} despachar={() => {}} />);
    expect(textoConectar(estadoInicial(ejemplo()))).toBe('');
    expect(container).toBeEmptyDOMElement();
  });

  it('constructor.guia.la_leyenda_explica_un_solo_sentido_e_ida_y_vuelta_con_dibujos_decorativos', () => {
    const { container } = render(<Leyenda />);
    expect(screen.getByText('Un solo sentido, como pasar un recado.')).toBeInTheDocument();
    expect(screen.getByText('Ida y vuelta, como preguntarle algo a un compañero.')).toBeInTheDocument();
    const dibujos = container.querySelectorAll('svg');
    expect(dibujos).toHaveLength(2);
    for (const d of dibujos) expect(d).toHaveAttribute('aria-hidden', 'true');
  });

  it('constructor.guia.los_atajos_del_teclado_son_una_linea_plegable_con_id_para_aria_describedby', async () => {
    const user = userEvent.setup();
    render(<AyudaTeclado />);
    const resumen = screen.getByText('Atajos del teclado');
    const detalles = resumen.closest('details');
    expect(detalles).not.toBeNull();
    // cerrada por omisión: no es el párrafo permanente del mockup
    expect(detalles).not.toHaveAttribute('open');
    // el texto existe con su id (el lienzo lo enlaza con aria-describedby) y dice las teclas de verdad
    const texto = document.getElementById(ID_AYUDA_TECLADO);
    expect(texto).not.toBeNull();
    expect(texto).toHaveTextContent(/Tab recorre los cuadros/);
    expect(texto).toHaveTextContent(/Supr quita el cuadro/);
    expect(texto).toHaveTextContent(/Ctrl\+Z/);
    expect(texto).toHaveTextContent(/Esc cierra un menú/);
    // es un `summary` nativo: se enfoca (Tab) y se abre con un toque o con Enter (el navegador hace del Enter un clic)
    await user.tab();
    expect(resumen).toHaveFocus();
    await user.click(resumen);
    expect(detalles).toHaveAttribute('open');
  });

  it('constructor.guia.el_texto_de_los_atajos_esta_siempre_en_la_pagina_escondido_cerrado_y_a_la_vista_abierto', async () => {
    const user = userEvent.setup();
    render(<AyudaTeclado />);
    const texto = document.getElementById(ID_AYUDA_TECLADO) as HTMLElement;
    // fuera del <details>: un details cerrado no se expone y el lector de pantalla nunca recibía la descripción del lienzo
    expect(texto.closest('details')).toBeNull();
    expect(texto.className.split(/\s+/)).toContain('sr-only');
    await user.click(screen.getByText('Atajos del teclado'));
    expect(texto.className.split(/\s+/)).not.toContain('sr-only');
    await user.click(screen.getByText('Atajos del teclado'));
    expect(texto.className.split(/\s+/)).toContain('sr-only');
  });

  it('constructor.guia.los_avisos_con_un_nombre_largo_sin_espacios_se_parten_en_vez_de_salirse_de_la_pagina', () => {
    const largo = 'W'.repeat(60);
    const f = ejemplo();
    f.nodes = f.nodes.map(n => (n.id === 'p1' && n.kind === 'app' ? { ...n, nombre: largo } : n));
    const resumen = resumenFlujo(estadoInicial(f));
    expect(resumen.hayAvisos).toBe(true);
    const { container } = render(<ResumenDelFlujo resumen={resumen} />);
    const aviso = screen.getByText(new RegExp(`«${largo}» no trae un conector listo`));
    // la lista de avisos no llevaba `overflow-wrap`: una palabra de 60 letras ensanchaba la página a 1100, 390 y 320 px
    expect(aviso.closest('ul')?.className).toContain('[overflow-wrap:anywhere]');
    expect(container.querySelectorAll('ul')).toHaveLength(1);
  });

  it('constructor.guia.te_falta_esto_lista_los_errores_con_su_id_y_sin_region_viva', () => {
    const sin = reducir(estadoInicial(ejemplo()), { k: 'quitarNodo', id: 't1' });
    const resumen = resumenFlujo(sin);
    expect(resumen.hayErrores).toBe(true);
    render(<ResumenDelFlujo resumen={resumen} />);
    const caja = document.getElementById(ID_FALTAN);
    expect(caja).not.toBeNull();
    expect(caja).toHaveTextContent('Te falta esto para poder descargar:');
    for (const error of resumen.errores) expect(screen.getByText(error)).toBeInTheDocument();
    // validación junto al botón, estática: cambiaría y se anunciaría en cada edición
    expect(caja?.closest('[role="status"],[aria-live],[role="alert"]')).toBeNull();
    expect(screen.queryByText(/^Listo para descargar/)).not.toBeInTheDocument();
  });

  it('constructor.guia.con_el_flujo_listo_dice_listo_para_descargar_con_el_numero_de_cuadros', () => {
    const resumen = resumenFlujo(estadoInicial(ejemplo()));
    expect(resumen.puedeDescargar).toBe(true);
    render(<ResumenDelFlujo resumen={resumen} />);
    expect(screen.getByText(/^Listo para descargar: 5 cuadros\./)).toBeInTheDocument();
    expect(document.getElementById(ID_FALTAN)).toBeNull();
    // lo que conviene saber aunque se pueda descargar, en una lista aparte
    for (const aviso of resumen.avisos) expect(screen.getByText(aviso)).toBeInTheDocument();
  });

  it('con_el_lienzo_vacio_el_resumen_no_pinta_nada_porque_lo_dice_la_tarjeta_del_disparador', () => {
    const { container } = render(<ResumenDelFlujo resumen={resumenFlujo(estadoInicial())} />);
    expect(container).toBeEmptyDOMElement();
  });
});
