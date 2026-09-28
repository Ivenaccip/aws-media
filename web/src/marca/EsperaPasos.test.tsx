import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { avanceEspera, EsperaPasos, reloj, textoLlevas } from './EsperaPasos';

const PASOS = [
  { falta: 'Recibir tu idea', hecho: 'Recibimos tu idea' },
  { falta: 'Generar el video', activo: 'Generando el video', hecho: 'Video generado' },
  { falta: 'Tu clip, listo para ver' },
];
const ORBE = { texto: 'Generando tu clip', tope: 1000, textoAlAgotar: 'sigue' };

describe('UI·27 · la lógica de la espera', () => {
  it('la barra va por pasos y, con estimado, avanza dentro del paso sin llegar al final', () => {
    expect(avanceEspera(1, 3, null, null)).toBeCloseTo(33.33, 1);
    expect(avanceEspera(1, 3, 60_000, 120_000)).toBeCloseTo(50, 1);
    // pasado el estimado se queda en el 90 % del paso: nunca «acaba» sola
    expect(avanceEspera(1, 3, 10 * 60_000, 120_000)).toBeCloseTo(63.33, 1);
    expect(avanceEspera(9, 3, null, null)).toBeCloseTo(66.67, 1);
    expect(avanceEspera(0, 0, null, null)).toBe(0);
  });

  it('el reloj y la frase de lo que lleva', () => {
    expect(reloj(65_000)).toBe('1:05');
    expect(reloj(-3000)).toBe('0:00');
    expect(textoLlevas(45_000, '1–2 min')).toBe('Llevas 0:45 · suele tardar 1–2 min.');
    expect(textoLlevas(null, '1–2 min')).toBe('Suele tardar 1–2 min.');
    expect(textoLlevas(12_000)).toBe('Llevas 0:12.');
    expect(textoLlevas(null)).toBeNull();
  });
});

describe('UI·27 · EsperaPasos', () => {
  it('lo anterior hecho, el activo con su texto en curso y lo que falta', () => {
    render(<EsperaPasos pasos={PASOS} paso={1} detalle=" · 2 de 6" orbe={ORBE} />);
    const items = screen.getAllByRole('listitem');
    expect(items.map(i => i.textContent)).toEqual(['Recibimos tu idea', 'Generando el video · 2 de 6', 'Tu clip, listo para ver']);
    expect(items[1]).toHaveAttribute('aria-current', 'step');
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '33');
  });

  it('la barra nunca retrocede aunque llegue un avance menor', () => {
    const { rerender } = render(<EsperaPasos pasos={PASOS} paso={1} pct={60} orbe={ORBE} />);
    rerender(<EsperaPasos pasos={PASOS} paso={1} pct={40} orbe={ORBE} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '60');
  });

  it('«puedes cerrar esta pestaña» solo si se pide (la nube), y sin orbe dice su estado', () => {
    const { rerender } = render(<EsperaPasos pasos={PASOS} paso={1} orbe={ORBE} />);
    expect(screen.queryByText(/cerrar esta pestaña/)).toBeNull();
    rerender(<EsperaPasos pasos={PASOS} paso={1} estado="Renderizando en la nube" cerrar="Puedes cerrar esta pestaña." />);
    expect(screen.getByText('Puedes cerrar esta pestaña.')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Renderizando en la nube');
  });
});
