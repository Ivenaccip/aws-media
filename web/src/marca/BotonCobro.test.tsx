import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { oirCobros } from '../prueba/servidor';
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
    const recargar = vi.fn();
    window.monedero = { get: () => null, refrescar: vi.fn(), recargar, recarga: true, cta: '' };
    render(<BotonCobro verbo="Generar" costo={100} saldo={30} alCobrar={alCobrar} />);
    const b = screen.getByRole('button', { name: /Generar/ });
    expect(b).toBeDisabled();
    await userEvent.click(b);
    expect(alCobrar).not.toHaveBeenCalled();
    expect(screen.getByText(/Te faltan ✦ 70/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Recargar' }));
    expect(recargar).toHaveBeenCalledOnce();
    delete window.monedero;
  });

  it('cobro.recarga_cerrada_no_ofrece_un_boton_muerto', () => {
    window.monedero = {
      get: () => null, refrescar: vi.fn(), recargar: vi.fn(), recarga: false,
      cta: 'Escríbenos por el canal de la comunidad para conseguir más.',
    };
    render(<BotonCobro verbo="Generar" costo={100} saldo={30} alCobrar={async () => {}} />);
    expect(screen.queryByRole('button', { name: 'Recargar' })).not.toBeInTheDocument();
    expect(screen.getByText(/Escríbenos por el canal de la comunidad/)).toBeInTheDocument();
    delete window.monedero;
  });

  it('si el cobro falla, el botón se suelta para reintentar', async () => {
    const alCobrar = vi.fn(async () => { throw new Error('402'); });
    render(<BotonCobro verbo="Generar" costo={10} alCobrar={() => alCobrar().catch(() => {})} />);
    await userEvent.click(screen.getByRole('button'));
    await vi.waitFor(() => expect(screen.getByRole('button')).not.toHaveAttribute('aria-busy'));
  });

  it('UI·19: un cobro que salió bien le avisa a monedero.js cuánto y desde dónde', async () => {
    const cobros = oirCobros();
    render(<BotonCobro verbo="Generar" costo={30} alCobrar={async () => true} />);
    await userEvent.click(screen.getByRole('button'));
    // jsdom no mide: el rect sale en ceros, pero sale
    await vi.waitFor(() => expect(cobros).toEqual([{ costo: 30, rect: { x: 0, y: 0, ancho: 0, alto: 0 } }]));
  });

  it('UI·19: sin `true` no vuela nada: un 402, un veto o una validación no cobraron', async () => {
    const cobros = oirCobros();
    for (const alCobrar of [
      async () => {},
      async () => false,
      () => Promise.reject(new Error('402')).catch(() => undefined),
    ]) {
      const { unmount } = render(<BotonCobro verbo="Generar" costo={30} alCobrar={alCobrar} />);
      await userEvent.click(screen.getByRole('button'));
      await vi.waitFor(() => expect(screen.getByRole('button')).not.toHaveAttribute('aria-busy'));
      unmount();
    }
    expect(cobros).toEqual([]);
  });

  it('UI·19: doble clic que cobra una vez vuela una vez', async () => {
    const cobros = oirCobros();
    let soltar!: (v: boolean) => void;
    render(<BotonCobro verbo="Producir" costo={90} alCobrar={() => new Promise<boolean>(r => { soltar = r; })} />);
    const b = screen.getByRole('button');
    b.click();
    b.click();
    soltar(true);
    await vi.waitFor(() => expect(cobros).toHaveLength(1));
  });

  it('UI·19: si el cobro desmonta el botón, el «−N» sale de donde estaba', async () => {
    const cobros = oirCobros();
    function Pantalla() {
      const [hecho, setHecho] = useState(false);
      return hecho ? <p>Listo</p> : <BotonCobro verbo="Generar" costo={12} alCobrar={async () => { setHecho(true); return true; }} />;
    }
    render(<Pantalla />);
    await userEvent.click(screen.getByRole('button'));
    await screen.findByText('Listo');
    expect(cobros).toEqual([expect.objectContaining({ costo: 12 })]);
    expect(cobros[0]!.rect).not.toBeNull();
  });
});
