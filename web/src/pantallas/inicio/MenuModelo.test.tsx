// El menú de modelo con un catálogo de PRUEBA que sí trae lo que todavía no
// está activo (varios niveles, un modelo con resolución, un clip que no tiene
// todas las duraciones): así se prueba el comportamiento completo aunque hoy
// solo haya un modelo por tarea.
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { MenuModelo, type Eleccion } from './MenuModelo';
import {
  admite,
  cambioPorDuracion,
  CATALOGO,
  duracionesDe,
  duracionesOfrecidas,
  grupos as gruposDe,
  ofrecidosDe,
  precioDe,
  type Grupo,
  type TablaPrecios,
} from './modelos';

const GRUPOS: Grupo[] = [
  {
    nivel: 'economico',
    titulo: 'Económicos',
    rango: '2–3',
    modelos: [
      { id: 'grok', nombre: 'Grok Imagine', detalle: 'xAI', nivel: 'economico', activo: true },
      { id: 'flux2', nombre: 'FLUX.2 pro', detalle: 'Black Forest Labs', nivel: 'economico', activo: true },
    ],
  },
  {
    nivel: 'maxima',
    titulo: 'Máxima calidad',
    rango: '14–27',
    modelos: [
      {
        id: 'nbp',
        nombre: 'Nano Banana Pro',
        detalle: 'Google',
        nivel: 'maxima',
        activo: true,
        calidades: [
          { id: '2k', etiqueta: 'hasta 2K' },
          { id: '4k', etiqueta: '4K' },
        ],
      },
    ],
  },
];
const PRECIOS: Record<string, number> = { grok: 2, flux2: 3, 'nbp-2k': 14, 'nbp-4k': 27 };
const precio = (id: string, cal?: string) => PRECIOS[cal ? `${id}-${cal}` : id]!;

function Montado({ alCrear = () => {}, enviando = false, alElegir }: { alCrear?: () => void; enviando?: boolean; alElegir?: (e: Eleccion) => void }) {
  const [e, setE] = useState<Eleccion>({ id: 'grok' });
  return (
    <>
      <button type="button">fuera</button>
      <MenuModelo
        tarea="imagen"
        grupos={GRUPOS}
        elegido={e}
        alElegir={x => {
          setE(x);
          alElegir?.(x);
        }}
        precio={precio}
        alCrear={alCrear}
        enviando={enviando}
      />
    </>
  );
}

// El clip de PRUEBA: LTX no tiene 4 s y Kling (más calidad) tiene las tres. Los
// números son inventados, no los de tarifas.json.
const TABLA_CLIP: TablaPrecios = {
  imagen: {},
  editar: {},
  clip: {
    'veo-lite': { '4': 4, '6': 6, '8': 8 },
    ltx: { '6': 10, '8': 12 },
    kling: { '4': 20, '6': 30, '8': 40 },
  },
};
const CATALOGO_CLIP = { ...CATALOGO, clip: CATALOGO.clip.map(m => ({ ...m, activo: true })) };
// un solo modelo y una sola duración: no hay nada que elegir
const CATALOGO_UNO = { ...CATALOGO, clip: CATALOGO.clip.map(m => ({ ...m, activo: m.id === 'veo-lite' })) };
const TABLA_UNA: TablaPrecios = { imagen: {}, editar: {}, clip: { 'veo-lite': { '8': 8 } } };

/** Hace lo mismo que la caja: la duración manda en los precios, y si el modelo no la tiene vuelve el predeterminado. */
function MontadoClip({
  alElegir,
  catalogo = CATALOGO_CLIP,
  tabla = TABLA_CLIP,
}: {
  alElegir?: (e: Eleccion) => void;
  catalogo?: typeof CATALOGO_CLIP;
  tabla?: TablaPrecios;
}) {
  const [e, setE] = useState<Eleccion>({ id: 'veo-lite' });
  const [segundos, setSegundos] = useState(8);
  const ofrecidos = ofrecidosDe('clip', catalogo, tabla);
  return (
    <MenuModelo
      tarea="clip"
      grupos={gruposDe('clip', catalogo, tabla, segundos)}
      elegido={e}
      alElegir={x => {
        setE(x);
        alElegir?.(x);
      }}
      precio={id => precioDe('clip', id, undefined, tabla, segundos)!}
      alCrear={() => {}}
      enviando={false}
      duracion={{
        segundos,
        opciones: duracionesOfrecidas('clip', ofrecidos, tabla),
        alElegir: s => {
          setSegundos(s);
          const cambio = cambioPorDuracion('clip', ofrecidos, ofrecidos.find(m => m.id === e.id)!, s, tabla);
          if (!cambio) return undefined;
          setE({ id: cambio.queda.id });
          return cambio.aviso;
        },
        admite: m => admite('clip', m, segundos, tabla),
        desde: m => duracionesDe('clip', m, tabla)[0]!,
      }}
    />
  );
}

const chip = () => screen.getByRole('button', { name: /^Modelo / });
const menu = () => screen.getByRole('dialog', { name: 'Elegir modelo' });
const duracion = (nombre: string) => within(menu()).getByRole('radio', { name: nombre });
const fila = (nombre: RegExp) => within(menu()).getByRole('radio', { name: nombre });

describe('el menú de modelo', () => {
  it('inicio.menumodelo.niveles_precios_y_predeterminado', async () => {
    render(<Montado />);
    expect(chip()).toHaveTextContent('Modelo Grok Imagine');
    expect(screen.queryByRole('dialog')).toBeNull();
    await userEvent.click(chip());
    const m = within(menu());
    expect(m.getByText('Económicos')).toBeInTheDocument();
    expect(m.getByText('Máxima calidad')).toBeInTheDocument();
    expect(menu()).toHaveTextContent('✦ 2–3 por imagen');
    expect(m.getByRole('radio', { name: /Grok Imagine/ })).toHaveTextContent('Predeterminado');
    expect(m.getByRole('radio', { name: /FLUX\.2 pro/ })).not.toHaveTextContent('Predeterminado');
    // con resolución, el precio de la fila es el «desde»
    expect(m.getByRole('radio', { name: /Nano Banana Pro/ })).toHaveTextContent('desde ✦ 14');
    // el pie dice el modelo elegido y su precio
    expect(menu()).toHaveTextContent('Grok Imagine✦ 2 por imagen');
  });

  it('inicio.menumodelo.la_resolucion_solo_aparece_en_el_modelo_que_la_tiene', async () => {
    const alElegir = vi.fn();
    render(<Montado alElegir={alElegir} />);
    await userEvent.click(chip());
    expect(within(menu()).queryByRole('radiogroup', { name: 'Resolución' })).toBeNull();
    await userEvent.click(within(menu()).getByRole('radio', { name: /Nano Banana Pro/ }));
    const res = within(menu()).getByRole('radiogroup', { name: 'Resolución' });
    expect(within(res).getByRole('radio', { name: /hasta 2K/ })).toHaveAttribute('aria-checked', 'true');
    expect(within(res).getByRole('radio', { name: /4K/ })).toHaveTextContent('✦ 27');
    expect(chip()).toHaveTextContent('Modelo Nano Banana Pro · hasta 2K');
    expect(menu()).toHaveTextContent('✦ 14 por imagen');
    await userEvent.click(within(res).getByRole('radio', { name: /4K/ }));
    expect(alElegir).toHaveBeenLastCalledWith({ id: 'nbp', calidad: '4k' });
    expect(chip()).toHaveTextContent('Modelo Nano Banana Pro · 4K');
    expect(menu()).toHaveTextContent('✦ 27 por imagen');
    // volver a un modelo sin resolución la quita
    await userEvent.click(within(menu()).getByRole('radio', { name: /FLUX\.2 pro/ }));
    expect(within(menu()).queryByRole('radiogroup', { name: 'Resolución' })).toBeNull();
    expect(menu()).toHaveTextContent('✦ 3 por imagen');
  });

  it('inicio.menumodelo.crear_va_en_el_pie_y_no_acepta_dos_clics_mientras_trabaja', async () => {
    const alCrear = vi.fn();
    const { rerender } = render(<Montado alCrear={alCrear} />);
    await userEvent.click(chip());
    await userEvent.click(within(menu()).getByRole('button', { name: 'Crear' }));
    expect(alCrear).toHaveBeenCalledTimes(1);
    rerender(<Montado alCrear={alCrear} enviando />);
    const boton = within(menu()).getByRole('button', { name: 'Generando…' });
    await userEvent.click(boton);
    expect(alCrear).toHaveBeenCalledTimes(1);
  });

  it('inicio.menumodelo.teclado_y_cierres', async () => {
    render(<Montado />);
    chip().focus();
    await userEvent.keyboard('{Enter}');
    // al abrir, el foco va al modelo elegido
    expect(within(menu()).getByRole('radio', { name: /Grok Imagine/ })).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(within(menu()).getByRole('radio', { name: /FLUX\.2 pro/ })).toHaveAttribute('aria-checked', 'true');
    expect(within(menu()).getByRole('radio', { name: /FLUX\.2 pro/ })).toHaveFocus();
    await userEvent.keyboard('{End}');
    expect(within(menu()).getByRole('radio', { name: /Nano Banana Pro/ })).toHaveAttribute('aria-checked', 'true');
    await userEvent.keyboard('{Home}');
    expect(within(menu()).getByRole('radio', { name: /Grok Imagine/ })).toHaveAttribute('aria-checked', 'true');
    // Esc cierra y devuelve el foco al chip
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(chip()).toHaveFocus();
    // un clic fuera también
    await userEvent.click(chip());
    await userEvent.click(screen.getByRole('button', { name: 'fuera' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('inicio.menumodelo.la_duracion_solo_sale_en_el_clip_y_recalcula_las_filas', async () => {
    // imagen: ni rastro de la duración, ni en el chip ni en el menú
    const { unmount } = render(<Montado />);
    expect(chip()).not.toHaveTextContent(' s');
    await userEvent.click(chip());
    expect(within(menu()).queryByRole('radiogroup', { name: 'Duración del clip' })).toBeNull();
    expect(menu()).toHaveTextContent('por imagen');
    unmount();

    render(<MontadoClip />);
    expect(chip()).toHaveTextContent('Modelo Veo 3.1 Lite · 8 s');
    await userEvent.click(chip());
    const grupo = within(menu()).getByRole('radiogroup', { name: 'Duración del clip' });
    expect(grupo).toHaveAccessibleDescription('Más corto, más barato');
    const botones = within(grupo).getAllByRole('radio');
    expect(botones.map(b => b.textContent)).toEqual(['4 s', '6 s', '8 s']);
    // de al menos 44 px: min-h-11 es 2.75 rem
    for (const b of botones) expect(b).toHaveClass('min-h-11');
    expect(duracion('8 s')).toHaveAttribute('aria-checked', 'true');
    // 8 s: los créditos, el rango de cada grupo y el pie
    expect(fila(/Veo 3\.1 Lite/)).toHaveTextContent('✦ 8');
    expect(fila(/LTX-2\.5 Fast/)).toHaveTextContent('✦ 12');
    expect(fila(/Kling V3 Pro/)).toHaveTextContent('✦ 40');
    expect(menu()).toHaveTextContent('✦ 8–12 por clip de 8 s');
    expect(menu()).toHaveTextContent('✦ 40 por clip de 8 s');
    expect(menu()).toHaveTextContent('Veo 3.1 Lite✦ 8 por clip de 8 s');
    // 6 s: todo se recalcula, también el chip
    await userEvent.click(duracion('6 s'));
    expect(duracion('6 s')).toHaveAttribute('aria-checked', 'true');
    expect(duracion('8 s')).toHaveAttribute('aria-checked', 'false');
    expect(chip()).toHaveTextContent('Modelo Veo 3.1 Lite · 6 s');
    expect(fila(/Veo 3\.1 Lite/)).toHaveTextContent('✦ 6');
    expect(fila(/LTX-2\.5 Fast/)).toHaveTextContent('✦ 10');
    expect(fila(/Kling V3 Pro/)).toHaveTextContent('✦ 30');
    expect(menu()).toHaveTextContent('✦ 6–10 por clip de 6 s');
    expect(menu()).toHaveTextContent('Veo 3.1 Lite✦ 6 por clip de 6 s');
    // 4 s
    await userEvent.click(duracion('4 s'));
    expect(chip()).toHaveTextContent('Modelo Veo 3.1 Lite · 4 s');
    expect(fila(/Kling V3 Pro/)).toHaveTextContent('✦ 20');
    expect(menu()).toHaveTextContent('Veo 3.1 Lite✦ 4 por clip de 4 s');
    // volver a tocar la que ya está no cambia nada
    await userEvent.click(duracion('4 s'));
    expect(duracion('4 s')).toHaveAttribute('aria-checked', 'true');
  });

  it('inicio.menumodelo.el_modelo_sin_esa_duracion_se_atenua_y_no_se_elige', async () => {
    const alElegir = vi.fn();
    render(<MontadoClip alElegir={alElegir} />);
    await userEvent.click(chip());
    await userEvent.click(duracion('4 s'));
    // LTX no tiene 4 s: atenuado, sin precio, con su «Desde N s» y sin poder elegirse
    const ltx = fila(/LTX-2\.5 Fast/);
    expect(ltx).toHaveAttribute('aria-disabled', 'true');
    expect(ltx).toHaveTextContent('Desde 6 s');
    expect(ltx).not.toHaveTextContent('✦');
    expect(ltx).toHaveAttribute('aria-checked', 'false');
    expect(ltx).toHaveAttribute('tabindex', '-1');
    expect(ltx).toHaveClass('cursor-not-allowed');
    // los que sí la tienen siguen normales
    expect(fila(/Veo 3\.1 Lite/)).not.toHaveAttribute('aria-disabled');
    expect(fila(/Kling V3 Pro/)).not.toHaveAttribute('aria-disabled');
    // el rango del grupo solo cuenta los que la tienen
    expect(menu()).toHaveTextContent('✦ 4 por clip de 4 s');
    await userEvent.click(ltx);
    await userEvent.keyboard('{Enter}');
    expect(alElegir).not.toHaveBeenCalled();
    expect(ltx).toHaveAttribute('aria-checked', 'false');
    expect(chip()).toHaveTextContent('Modelo Veo 3.1 Lite · 4 s');
    // con 6 s ya se puede
    await userEvent.click(duracion('6 s'));
    expect(fila(/LTX-2\.5 Fast/)).not.toHaveAttribute('aria-disabled');
    expect(fila(/LTX-2\.5 Fast/)).toHaveTextContent('✦ 10');
    await userEvent.click(fila(/LTX-2\.5 Fast/));
    expect(alElegir).toHaveBeenLastCalledWith({ id: 'ltx' });
    expect(chip()).toHaveTextContent('Modelo LTX-2.5 Fast · 6 s');
  });

  it('inicio.menumodelo.si_el_elegido_no_la_tiene_vuelve_el_predeterminado_con_un_aviso_en_el_pie', async () => {
    render(<MontadoClip />);
    await userEvent.click(chip());
    expect(within(menu()).queryByRole('status')).toBeNull();
    await userEvent.click(fila(/LTX-2\.5 Fast/));
    expect(chip()).toHaveTextContent('Modelo LTX-2.5 Fast · 8 s');
    await userEvent.click(duracion('4 s'));
    // el modelo vuelve al predeterminado y el pie dice por qué
    const aviso = within(menu()).getByRole('status');
    expect(aviso).toHaveTextContent('LTX-2.5 Fast empieza en 6 s. Te dejamos Veo 3.1 Lite.');
    expect(chip()).toHaveTextContent('Modelo Veo 3.1 Lite · 4 s');
    expect(fila(/Veo 3\.1 Lite/)).toHaveAttribute('aria-checked', 'true');
    expect(fila(/LTX-2\.5 Fast/)).toHaveAttribute('aria-checked', 'false');
    // está en el pie, después de la lista de modelos y antes del «Crear»
    const pie = within(menu()).getByRole('button', { name: 'Crear' }).parentElement!;
    expect(pie).toContainElement(aviso);
    // elegir otra duración que el modelo de ahora sí tiene lo quita, y LTX no vuelve solo
    await userEvent.click(duracion('6 s'));
    expect(within(menu()).queryByRole('status')).toBeNull();
    expect(chip()).toHaveTextContent('Modelo Veo 3.1 Lite · 6 s');
    // elegir un modelo también lo quita
    await userEvent.click(fila(/LTX-2\.5 Fast/));
    await userEvent.click(duracion('4 s'));
    expect(within(menu()).getByRole('status')).toBeInTheDocument();
    await userEvent.click(fila(/Kling V3 Pro/));
    expect(within(menu()).queryByRole('status')).toBeNull();
    // y al cerrar y volver a abrir no queda el de la vez anterior
    await userEvent.click(duracion('8 s'));
    await userEvent.click(fila(/LTX-2\.5 Fast/));
    await userEvent.click(duracion('4 s'));
    expect(within(menu()).getByRole('status')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await userEvent.click(chip());
    expect(within(menu()).queryByRole('status')).toBeNull();
  });

  it('inicio.menumodelo.con_una_sola_duracion_no_hay_selector', async () => {
    render(<MontadoClip catalogo={CATALOGO_UNO} tabla={TABLA_UNA} />);
    // el chip y el pie siguen diciendo los segundos; lo que no tiene sentido es un selector de uno
    expect(chip()).toHaveTextContent('Modelo Veo 3.1 Lite · 8 s');
    await userEvent.click(chip());
    expect(within(menu()).queryByRole('radiogroup', { name: 'Duración del clip' })).toBeNull();
    expect(within(menu()).queryByText('Más corto, más barato')).toBeNull();
    expect(menu()).toHaveTextContent('✦ 8 por clip de 8 s');
  });

  it('inicio.menumodelo.duracion_con_flechas_y_foco', async () => {
    render(<MontadoClip />);
    await userEvent.click(chip());
    // al abrir el foco sigue yendo al modelo elegido, no a la duración
    expect(fila(/Veo 3\.1 Lite/)).toHaveFocus();
    // una sola duración en el tabulador, y es la elegida
    expect(duracion('8 s')).toHaveAttribute('tabindex', '0');
    expect(duracion('6 s')).toHaveAttribute('tabindex', '-1');
    expect(duracion('4 s')).toHaveAttribute('tabindex', '-1');
    duracion('8 s').focus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(duracion('6 s')).toHaveAttribute('aria-checked', 'true');
    expect(duracion('6 s')).toHaveFocus();
    expect(duracion('6 s')).toHaveAttribute('tabindex', '0');
    await userEvent.keyboard('{ArrowUp}');
    expect(duracion('4 s')).toHaveAttribute('aria-checked', 'true');
    expect(duracion('4 s')).toHaveFocus();
    // en el extremo se queda donde está
    await userEvent.keyboard('{ArrowLeft}');
    expect(duracion('4 s')).toHaveAttribute('aria-checked', 'true');
    expect(duracion('4 s')).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}{ArrowDown}{ArrowRight}');
    expect(duracion('8 s')).toHaveAttribute('aria-checked', 'true');
    expect(duracion('8 s')).toHaveFocus();
    expect(chip()).toHaveTextContent('Modelo Veo 3.1 Lite · 8 s');
    // cambiar la duración con el teclado no se lleva el foco a la lista ni lo saca del menú
    expect(menu()).toContainElement(document.activeElement as HTMLElement);

    // las flechas entre modelos se saltan los atenuados (a 4 s, LTX): Home y End también
    await userEvent.click(duracion('4 s'));
    fila(/Veo 3\.1 Lite/).focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(fila(/Kling V3 Pro/)).toHaveAttribute('aria-checked', 'true');
    expect(fila(/Kling V3 Pro/)).toHaveFocus();
    expect(fila(/LTX-2\.5 Fast/)).toHaveAttribute('aria-checked', 'false');
    await userEvent.keyboard('{ArrowUp}');
    expect(fila(/Veo 3\.1 Lite/)).toHaveFocus();
    await userEvent.keyboard('{End}');
    expect(fila(/Kling V3 Pro/)).toHaveFocus();
    await userEvent.keyboard('{Home}');
    expect(fila(/Veo 3\.1 Lite/)).toHaveFocus();
    // con todas disponibles (6 s) pasan por LTX
    await userEvent.click(duracion('6 s'));
    fila(/Veo 3\.1 Lite/).focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(fila(/LTX-2\.5 Fast/)).toHaveFocus();
    // Esc cierra y el foco vuelve al chip
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(chip()).toHaveFocus();
  });
});
