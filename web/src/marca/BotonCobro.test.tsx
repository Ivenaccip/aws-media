import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { BotonCobro } from './BotonCobro';

describe('BotonCobro', () => {
  it('dice «Verbo ✦ N» y nada más', () => {
    render(<BotonCobro verbo="Generar" costo={100} alCobrar={async () => {}} />);
    expect(screen.getByRole('button')).toHaveTextContent(/^Generar ✦ 100$/);
  });

  it('cobro.boton_apagado_antes_de_await: doble clic = una petición', async () => {
    let soltar!: () => void;
    const alCobrar = vi.fn(() => new Promise<void>(r => { soltar = r; }));
    render(<BotonCobro verbo="Producir" costo={90} alCobrar={alCobrar} trabajando="Produciendo…" />);
    const b = screen.getByRole('button');
    // dos clics en el MISMO tic, sin que React alcance a repintar entre uno y
    // otro: lo único que frena el segundo es el candado (un dedo nervioso o
    // un ratón que rebota; userEvent sí repinta entre eventos)
    b.click();
    b.click();
    await userEvent.dblClick(b);
    expect(alCobrar).toHaveBeenCalledTimes(1);
    expect(b).toHaveTextContent('Produciendo…');
    expect(b).toHaveAttribute('aria-busy', 'true');
    soltar();
    await vi.waitFor(() => expect(b).toHaveTextContent(/^Producir/));
    await userEvent.click(b);
    expect(alCobrar).toHaveBeenCalledTimes(2);
  });

  it('cobro.sin_saldo_no_cobra: deshabilitado y dice cuánto falta', async () => {
    const alCobrar = vi.fn(async () => {});
    const alRecargar = vi.fn();
    render(<BotonCobro verbo="Generar" costo={100} saldo={30} alCobrar={alCobrar} alRecargar={alRecargar} />);
    const b = screen.getByRole('button', { name: /Generar/ });
    expect(b).toBeDisabled();
    await userEvent.click(b);
    expect(alCobrar).not.toHaveBeenCalled();
    expect(screen.getByText(/Te faltan ✦ 70/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Recargar' }));
    expect(alRecargar).toHaveBeenCalledOnce();
  });

  it('si el cobro falla, el botón se suelta para reintentar', async () => {
    const alCobrar = vi.fn(async () => { throw new Error('402'); });
    render(<BotonCobro verbo="Generar" costo={10} alCobrar={() => alCobrar().catch(() => {})} />);
    await userEvent.click(screen.getByRole('button'));
    await vi.waitFor(() => expect(screen.getByRole('button')).not.toHaveAttribute('aria-busy'));
  });
});
