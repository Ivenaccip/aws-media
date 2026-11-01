// A dónde vuelve el foco al cerrar el diálogo de Blotato. Sin el prefijo `inicio.` (ver PaginaNivel.test.tsx).
//
// El defecto que esto fija: el diálogo recordaba «lo que tenía el foco» en el instante en que se MONTA (`useFocoDeVuelta`, ui/Dialogo.tsx).
// Si la lectura del estado llega ANTES que el código del diálogo (que se pide con import()), el diálogo se monta ya con el campo de la clave
// y su `autoFocus` le quita el foco al botón antes de anotarlo; al cerrar, el campo ya no existe y el foco caía a <body>: quien navega con
// teclado perdía su sitio. Ahora `GrupoConBlotato` anota lo que tenía el foco al PEDIR abrir, que es lo único que no depende de quién llegue
// primero. Aquí el orden de llegada se fija con una puerta en el import() del diálogo.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { json, llamadas, servidor } from '../../../prueba/servidor';

const SIN_CLAVE = { conectado: false, origen: null, cuentas: [], error: null, plan: null };

// la puerta del código del diálogo: mientras esté cerrada, `import('../Blotato')` no resuelve
const puerta = vi.hoisted(() => ({ abierta: null as Promise<void> | null, soltar: (() => undefined) as () => void }));

beforeEach(() => {
  vi.resetModules();
  vi.doMock('../Blotato', async importarOriginal => {
    await puerta.abierta;
    return importarOriginal();
  });
});
afterEach(() => {
  vi.doUnmock('../Blotato');
  vi.unstubAllGlobals();
  puerta.abierta = null;
});

function cerrarLaPuerta() {
  puerta.abierta = new Promise<void>(resolver => {
    puerta.soltar = () => resolver();
  });
}

async function pintar() {
  const { PaginaNivel } = await import('./PaginaNivel');
  return render(<PaginaNivel nivel={{ tipo: 'grupo', area: 'mkt', grupo: 'blotato' }} />);
}

const BOTON = 'Conecta tu cuenta de Blotato';
const CAMPO = 'Tu clave de API de Blotato';

/** Enfoca el botón (como lo haría el teclado) y lo pulsa. Devuelve el botón. */
async function abrirDesdeElTeclado() {
  const boton = await screen.findByRole('button', { name: BOTON });
  boton.focus();
  expect(document.activeElement).toBe(boton);
  fireEvent.click(boton);
  return boton;
}

describe('niveles · el foco al cerrar el diálogo de Blotato', () => {
  it('niveles.blotato_foco.la_lectura_llega_antes_que_el_codigo_del_dialogo: Esc devuelve el foco al boton que lo abrió', async () => {
    cerrarLaPuerta();
    const f = servidor({ '/api/blotato': () => json(SIN_CLAVE) });
    await pintar();
    const boton = await abrirDesdeElTeclado();
    // la lectura completa (la del diálogo) ya contestó, y el código del diálogo todavía no llegó
    await waitFor(() => expect(llamadas(f, '/api/blotato', 'GET')).toHaveLength(1));
    await new Promise(r => setTimeout(r, 20));
    expect(screen.queryByRole('dialog')).toBeNull();

    puerta.soltar();
    // el diálogo se monta con el campo ya pintado y enfocado (su autoFocus): el botón ya no tiene el foco
    const campo = await screen.findByLabelText(CAMPO);
    await waitFor(() => expect(document.activeElement).toBe(campo));

    fireEvent.keyDown(campo, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(boton));
  });

  it('niveles.blotato_foco.la_lectura_llega_despues_que_el_dialogo: el foco vuelve al mismo boton', async () => {
    // el orden contrario (el código llega primero y se monta «revisando», con el botón aún enfocado): no se rompe
    let contestar!: () => void;
    const lectura = new Promise<void>(r => (contestar = r));
    servidor({
      '/api/blotato?redes=0': () => json(SIN_CLAVE),
      '/api/blotato': async () => {
        await lectura;
        return json(SIN_CLAVE);
      },
    });
    await pintar();
    const boton = await abrirDesdeElTeclado();
    const dialogo = await screen.findByRole('dialog');
    contestar();
    const campo = await screen.findByLabelText(CAMPO);
    await waitFor(() => expect(document.activeElement).toBe(campo));

    fireEvent.keyDown(campo, { key: 'Escape' });
    await waitFor(() => expect(dialogo).not.toBeInTheDocument());
    await waitFor(() => expect(document.activeElement).toBe(boton));
  });

  it('niveles.blotato_foco.abierto_por_la_direccion_no_hay_a_donde_volver_y_no_se_rompe_nada', async () => {
    // ?blotato=conectar abre el diálogo al cargar, sin que nadie haya enfocado nada: el foco queda donde Radix lo deje, sin error
    history.replaceState(null, '', '/estudio/marketing/blotato/?blotato=conectar');
    try {
      servidor({ '/api/blotato': () => json(SIN_CLAVE) });
      await pintar();
      const campo = await screen.findByLabelText(CAMPO);
      fireEvent.keyDown(campo, { key: 'Escape' });
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(screen.getByRole('button', { name: BOTON })).toBeInTheDocument();
    } finally {
      history.replaceState(null, '', '/');
    }
  });

  it('niveles.blotato_foco.una_tarjeta_apagada_tambien_vuelve_a_su_sitio: el foco regresa a la tarjeta que se pulso', async () => {
    cerrarLaPuerta();
    servidor({ '/api/blotato': () => json(SIN_CLAVE) });
    await pintar();
    const tarjeta = await screen.findByRole('link', { name: /^Agenda tus publicaciones/ });
    await waitFor(() => expect(tarjeta).toHaveAttribute('aria-disabled', 'true'));
    tarjeta.focus();
    fireEvent.click(tarjeta);
    await new Promise(r => setTimeout(r, 20));
    puerta.soltar();
    const campo = await screen.findByLabelText(CAMPO);
    await waitFor(() => expect(document.activeElement).toBe(campo));

    fireEvent.keyDown(campo, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(tarjeta));
  });
});
