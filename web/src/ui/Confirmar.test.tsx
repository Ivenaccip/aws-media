import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { simularSalida } from '../prueba/salida';
import { Confirmar } from './Confirmar';
import { Dialogo } from './Dialogo';

// vitest no procesa CSS: se lee tal cual del disco
const TOKENS = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../estilos/tokens.css'), 'utf8');

describe('Confirmar', () => {
  it('es un alertdialog y el foco arranca en Cancelar', () => {
    render(
      <Confirmar abierto alCambiar={() => {}} titulo="¿Borrar?" descripcion="No se deshace."
        confirmar="Borrar" peligro alConfirmar={() => {}} />,
    );
    expect(screen.getByRole('alertdialog', { name: '¿Borrar?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toHaveFocus();
  });

  it('confirmar llama una vez y cierra', async () => {
    const alConfirmar = vi.fn();
    const alCambiar = vi.fn();
    render(
      <Confirmar abierto alCambiar={alCambiar} titulo="¿Apagar?" descripcion="…"
        confirmar="Apagar" alConfirmar={alConfirmar} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Apagar' }));
    expect(alConfirmar).toHaveBeenCalledOnce();
    expect(alCambiar).toHaveBeenCalledWith(false);
  });
});

describe('Dialogo', () => {
  it('Esc cierra y el texto del usuario entra como texto', async () => {
    const alCambiar = vi.fn();
    render(
      <Dialogo abierto alCambiar={alCambiar} titulo="Revisa tu texto">
        <p>{'<img src=x onerror=alert(1)>'}</p>
      </Dialogo>,
    );
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
    await userEvent.keyboard('{Escape}');
    expect(alCambiar).toHaveBeenCalledWith(false);
  });
});

function ConBoton({ tipo }: { tipo: 'dialogo' | 'confirmar' }) {
  const [abierto, setAbierto] = useState(false);
  return (
    <>
      <button onClick={() => setAbierto(true)}>Abrir</button>
      {tipo === 'dialogo'
        ? <Dialogo abierto={abierto} alCambiar={setAbierto} titulo="Hola" />
        : <Confirmar abierto={abierto} alCambiar={setAbierto} titulo="¿Seguro?" descripcion="…"
            confirmar="Sí" alConfirmar={() => {}} />}
    </>
  );
}

describe('el foco vuelve a quien abrió', () => {
  it.each(['dialogo', 'confirmar'] as const)('%s: al cerrar con Esc', async tipo => {
    render(<ConBoton tipo={tipo} />);
    const abrir = screen.getByRole('button', { name: 'Abrir' });
    await userEvent.click(abrir);
    expect(abrir).not.toHaveFocus();
    await userEvent.keyboard('{Escape}');
    await vi.waitFor(() => expect(abrir).toHaveFocus());
  });
});

describe('UI·20 · la salida (100 ms) no cambia nada de lo de antes', () => {
  function Harness({ tipo }: { tipo: 'dialogo' | 'confirmar' }) {
    // quien cierra vacía su estado en el mismo clic, como Agenda o Formulario
    const [que, setQue] = useState<string | null>('Instagram · miCuenta');
    return tipo === 'confirmar' ? (
      <Confirmar abierto={que !== null} alCambiar={a => !a && setQue(null)} titulo="¿Cancelarla?"
        descripcion={que ?? ''} confirmar="Sí" alConfirmar={() => {}} />
    ) : (
      <Dialogo abierto={que !== null} alCambiar={a => !a && setQue(null)} titulo="Cambiar la hora"
        acciones={que && <button>Guardar {que}</button>}>
        {que && <p>{que}</p>}
      </Dialogo>
    );
  }

  it.each(['dialogo', 'confirmar'] as const)('%s: mientras sale sigue diciendo lo mismo, y luego se va', async tipo => {
    const salida = simularSalida();
    render(<Harness tipo={tipo} />);
    await userEvent.keyboard('{Escape}');
    const caja = document.querySelector('[role="dialog"], [role="alertdialog"]')!;
    expect(caja).toHaveAttribute('data-state', 'closed');
    expect(caja).toHaveTextContent('Instagram · miCuenta');
    salida.terminar();
    expect(document.querySelector('[role="dialog"], [role="alertdialog"]')).toBeNull();
  });

  it('el doble clic en confirmar, mientras la caja se va, confirma una vez', async () => {
    simularSalida();
    const alConfirmar = vi.fn();
    function Uno() {
      const [abierto, setAbierto] = useState(true);
      return <Confirmar abierto={abierto} alCambiar={setAbierto} titulo="¿Borrar?" descripcion="…"
        confirmar="Sí" alConfirmar={alConfirmar} />;
    }
    render(<Uno />);
    const si = screen.getByRole('button', { name: 'Sí' });
    si.click();
    si.click();
    expect(alConfirmar).toHaveBeenCalledOnce();
  });

  it.each(['dialogo', 'confirmar'] as const)('%s: el foco vuelve al terminar la salida, no antes', async tipo => {
    const salida = simularSalida();
    render(<ConBoton tipo={tipo} />);
    const abrir = screen.getByRole('button', { name: 'Abrir' });
    await userEvent.click(abrir);
    await userEvent.keyboard('{Escape}');
    expect(abrir).not.toHaveFocus();
    salida.terminar();
    await vi.waitFor(() => expect(abrir).toHaveFocus());
  });

  it.each(['borrar', 'deshabilitar'] as const)(
    'si lo que abrió se va a %s mientras la caja sale, el foco cae en el respaldo',
    async accion => {
      const salida = simularSalida();
      function Tarjeta() {
        const [abierto, setAbierto] = useState(false);
        const [estado, setEstado] = useState<'normal' | 'borrar' | 'deshabilitar'>('normal');
        const respaldo = useRef<HTMLButtonElement>(null);
        return (
          <>
            <button ref={respaldo}>Actualizar</button>
            {estado !== 'borrar' && (
              <button disabled={estado === 'deshabilitar'} onClick={() => setAbierto(true)}>Cancelar</button>
            )}
            <Confirmar abierto={abierto} alCambiar={setAbierto} titulo="¿Cancelar?" descripcion="…"
              confirmar="Sí, cancelarla" alConfirmar={() => setEstado(accion)} focoDeRespaldo={respaldo} />
          </>
        );
      }
      render(<Tarjeta />);
      await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
      await userEvent.click(screen.getByRole('button', { name: 'Sí, cancelarla' }));
      salida.terminar();
      await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Actualizar' })).toHaveFocus());
    },
  );

  it('la caja y el velo llevan su entrada y su salida', () => {
    render(<Confirmar abierto alCambiar={() => {}} titulo="¿Borrar?" descripcion="…" confirmar="Sí" alConfirmar={() => {}} />);
    expect(screen.getByRole('alertdialog').className).toContain('data-[state=closed]:animate-caja-sale');
    expect(screen.getByRole('alertdialog').className).toContain('data-[state=closed]:pointer-events-none');
    expect(document.querySelector('.fixed.inset-0')!.className).toContain('data-[state=closed]:animate-velo-sale');
  });

  it('ningún nombre de animación contiene a otro (Presence los compara con includes)', () => {
    const nombres = [...TOKENS.matchAll(/@keyframes ([\w-]+)/g)].map(m => m[1]!);
    for (const n of ['caja-entra', 'caja-sale', 'velo-entra', 'velo-sale']) expect(nombres).toContain(n);
    for (const a of nombres) for (const b of nombres) if (a !== b) expect(b.includes(a), `${b} contiene ${a}`).toBe(false);
    expect(TOKENS).toContain('--animate-caja-entra: caja-entra 150ms');
    expect(TOKENS).toContain('--animate-caja-sale: caja-sale 100ms');
  });
});
