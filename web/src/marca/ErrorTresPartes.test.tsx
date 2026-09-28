// UI·27 — el error en tres partes de UI·11, compartido.
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ponerMonedero } from '../prueba/servidor';
import { ErrorTresPartes } from './ErrorTresPartes';

afterEach(() => {
  delete window.monedero;
});

describe('ErrorTresPartes', () => {
  it('UI·27: dice qué pasó, qué pasó con tus créditos y qué sigue; lo técnico, plegado', () => {
    ponerMonedero(100);
    render(<ErrorTresPartes paso="Se detuvo." creditos="Te devolvimos ✦ 30." sigue="Vuelve a intentarlo." detalle="boom 500" />);
    expect(screen.getByRole('heading', { level: 2, name: 'Qué pasó' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Tus créditos' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Qué sigue' })).toBeInTheDocument();
    expect(screen.getByText('boom 500').closest('details')).not.toHaveAttribute('open');
    // el que la pantalla abre con él no se anuncia
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('UI·27: sin monedero no se habla de créditos', () => {
    render(<ErrorTresPartes paso="Se detuvo." creditos="Te devolvimos ✦ 30." sigue="Vuelve a intentarlo." />);
    expect(screen.queryByText('Tus créditos')).toBeNull();
    expect(screen.queryByText(/Te devolvimos/)).toBeNull();
    expect(screen.getByText('Qué sigue')).toBeInTheDocument();
  });

  it('UI·27: dentro de una tarjeta baja un nivel y el que llega solo se anuncia', () => {
    ponerMonedero(100);
    render(<ErrorTresPartes nivel={3} anunciar paso="Se detuvo." creditos="Te devolvimos." sigue="Otra vez." />);
    expect(screen.getByRole('alert')).toHaveTextContent('Qué pasóSe detuvo.');
    expect(screen.getByRole('heading', { level: 3, name: 'Qué pasó' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 4, name: 'Tus créditos' })).toBeInTheDocument();
  });
});
