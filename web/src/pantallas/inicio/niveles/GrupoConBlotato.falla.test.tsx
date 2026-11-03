// Si lo que se pide con import() no llega (la red se cayó, o un deploy borró el archivo con hash que la página vieja todavía nombra), la
// lista del grupo SIGUE ahí: es lo único que la persona necesita para ir a su herramienta. Esta prueba vive aparte porque cambia lo que
// devuelven los módulos de Blotato para TODO el archivo. Sin el prefijo `inicio.` (ver PaginaNivel.test.tsx).
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { json, servidor } from '../../../prueba/servidor';

const SIN_CLAVE = { conectado: false, origen: null, cuentas: [], error: null, plan: null };

/** Hace que el import() de un módulo falle como falla una descarga que no llegó. */
function que_no_llegue(modulo: '../Blotato' | '../logica'): void {
  vi.doMock(modulo, () => {
    throw new Error(`Failed to fetch dynamically imported module: /estudio/assets/${modulo.slice(3)}-x.js`);
  });
}

beforeEach(() => {
  // lo que falla al importar se queda fallado en el registro de módulos, y `lazy()` guarda su promesa: cada prueba parte de cero
  vi.doUnmock('../Blotato');
  vi.doUnmock('../logica');
  vi.resetModules();
  // React cuenta el error de un límite en la consola: no es lo que se prueba y ensucia la salida
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

async function pintar() {
  const { PaginaNivel } = await import('./PaginaNivel');
  return render(<PaginaNivel nivel={{ tipo: 'grupo', area: 'mkt', grupo: 'blotato' }} />);
}
const tarjetas = () => ['Agenda tus publicaciones', 'Investiga tu competencia', 'Ver mis métricas'].map(n => screen.getByRole('link', { name: new RegExp(n) }));

describe('niveles · Blotato no llega', () => {
  it('niveles.blotato_falla.si_el_dialogo_no_carga_la_lista_sigue_ahi_y_se_avisa_donde_se_pulso', async () => {
    que_no_llegue('../Blotato');
    servidor({ '/api/blotato': () => json(SIN_CLAVE) });
    await pintar();
    await waitFor(() => expect(tarjetas()[0]).toHaveAttribute('aria-disabled', 'true'));
    fireEvent.click(screen.getByRole('button', { name: 'Conecta tu cuenta de Blotato' }));
    const aviso = await screen.findByRole('alert');
    expect(aviso).toHaveTextContent('No pudimos abrir la conexión con Blotato');
    expect(aviso).toHaveTextContent('Recarga la página');
    // nada desapareció: el título, las migas, la lista y el botón
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Blotato');
    expect(screen.getByRole('navigation', { name: 'Dónde estás' })).toBeInTheDocument();
    expect(tarjetas()).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Conecta tu cuenta de Blotato' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('niveles.blotato_falla.si_la_logica_no_carga_no_se_apaga_nada_y_no_se_rompe_la_pagina', async () => {
    que_no_llegue('../logica');
    servidor({});
    await pintar();
    // no se pudo saber si hay cuenta: `conectado === null` nunca apaga nada
    await new Promise(r => setTimeout(r, 30));
    for (const a of tarjetas()) expect(a).not.toHaveAttribute('aria-disabled');
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Blotato');
    expect(screen.queryByRole('alert')).toBeNull();
    // el diálogo comparte esa lógica y tampoco llega: la persona que pulsa conectar lo ve dicho, y la lista sigue
    fireEvent.click(screen.getByRole('button', { name: 'Conecta tu cuenta de Blotato' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos abrir la conexión con Blotato');
    expect(tarjetas()).toHaveLength(3);
  });

  it('niveles.blotato_falla.con_todo_en_su_lugar_no_hay_ningun_aviso', async () => {
    servidor({ '/api/blotato': () => json(SIN_CLAVE) });
    await pintar();
    await waitFor(() => expect(tarjetas()[0]).toHaveAttribute('aria-disabled', 'true'));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
