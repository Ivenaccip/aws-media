// El panel del negocio, como COMPORTAMIENTO (docs/PLAN-UI.md §5). Cada test
// empieza por el ID de su invariante: tests/test_migracion_ui.py exige que
// cada ID del registro exista aquí antes de que admin pase a `todos`.
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Admin } from './Admin';
import type { Detalle, Resumen } from './logica';

const RESUMEN: Resumen = {
  usuarios: [
    {
      user_id: 'u-1',
      email: 'ana@ejemplo.com',
      saldo: 40,
      cortesia: 50,
      comprados: 100,
      gastados: 110,
      peliculas: 3,
      s3_bytes: 2_500_000,
      fargate_s: 120,
      costo_usd: 1.5,
      costo_aws_usd: 0.25,
      aurora_usd: 0.1,
      costo_ia_usd: 1.25,
      costo_ia_prov: { openai: 1, fal: 0.2, claude: 0.05 },
      ingresos_usd: 5.5,
      margen_usd: 4,
    },
    {
      user_id: 'u/2 raro',
      email: '<img src=x onerror=alert(1)>',
      saldo: 0,
      cortesia: 10,
      comprados: 0,
      gastados: 0,
      peliculas: 0,
      s3_bytes: null,
      costo_usd: 0.3,
      margen_usd: -0.3,
    },
  ],
  aurora: { acu_horas: 12, usd: 1.44 },
  piso_venta_usd: 0.05,
  totales: {
    costo_usd: 1.8,
    costo_aws_usd: 0.25,
    costo_ia_usd: 1.55,
    costo_ia_prov: { openai: 1, fal: 0.2, claude: 0.05, otros: 0.3 },
    ingresos_usd: 5.5,
    margen_usd: 3.7,
    gastados: 110,
    peliculas: 3,
  },
  langfuse_base: 'https://lf.ejemplo',
};

const DETALLE: Detalle = {
  user_id: 'u-1',
  proyectos: [
    {
      id: 'p1',
      creado: '2026-09-20T10:00:00Z',
      estado: 'listo',
      brief: 'Un perro astronauta',
      duracion_s: '30',
      creditos: 60,
      costo_usd: 0.9,
      trazas: [{ concepto: 'video', costo_usd: 0.9, segundos: null, traza: 'tr#1/a' }],
    },
  ],
  sin_proyecto: [],
  langfuse_base: 'https://lf.ejemplo',
};

function json(cuerpo: unknown, estado = 200) {
  return new Response(JSON.stringify(cuerpo), { status: estado, headers: { 'Content-Type': 'application/json' } });
}

type Ruta = (url: string, init?: RequestInit) => Promise<Response> | Response;

function servidor(rutas: Record<string, Ruta>) {
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    const clave = Object.keys(rutas).find(k => url.startsWith(k));
    if (!clave) throw new Error('ruta no esperada: ' + url);
    return rutas[clave]!(url, init);
  });
  vi.stubGlobal('fetch', f);
  return f;
}

const sinRed = () => Promise.reject(new TypeError('Failed to fetch'));

async function abrirCostos() {
  await userEvent.click(await screen.findByRole('tab', { name: '2 · Costos' }));
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('admin', () => {
  it('admin.vistas.tres_pestanas_con_aria', async () => {
    servidor({ '/api/admin/resumen': () => json(RESUMEN) });
    render(<Admin />);
    const lista = await screen.findByRole('tablist', { name: 'Vistas' });
    expect(within(lista).getAllByRole('tab').map(t => t.textContent)).toEqual([
      '1 · Ingresos',
      '2 · Costos',
      '3 · Flujo',
    ]);
    expect(screen.getByRole('tab', { name: '1 · Ingresos' })).toHaveAttribute('aria-selected', 'true');
  });

  it('admin.acceso.sin_permiso_muestra_solo_administradores', async () => {
    servidor({ '/api/admin/resumen': () => json({ detail: 'Solo administradores' }, 403) });
    render(<Admin />);
    expect(await screen.findByText(/Esta página es solo para administradores/)).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  });

  it('admin.carga.sin_red_pide_revisar_la_conexion', async () => {
    servidor({ '/api/admin/resumen': sinRed });
    render(<Admin />);
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo cargar — revisa tu conexión y recarga.');
  });

  it('admin.carga.error_del_server_muestra_su_detalle', async () => {
    servidor({ '/api/admin/resumen': () => json({ detail: 'La base está dormida' }, 503) });
    render(<Admin />);
    expect(await screen.findByRole('alert')).toHaveTextContent('La base está dormida');
  });

  it('admin.textos.del_server_se_pintan_como_texto', async () => {
    servidor({ '/api/admin/resumen': () => json(RESUMEN) });
    const { container } = render(<Admin />);
    expect(await screen.findByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
  });

  it('admin.dinero.totales_en_dolares', async () => {
    servidor({ '/api/admin/resumen': () => json(RESUMEN) });
    render(<Admin />);
    expect(await screen.findByText('$5.50 dólares')).toBeInTheDocument();
    expect(screen.getByText('créditos quemados (× $0.05/cr)')).toBeInTheDocument();
    // por usuario, cuatro decimales como la pantalla vieja
    expect(screen.getByText('$5.5000')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/centavo/i);
  });

  it('admin.detalle.uid_codificado_en_la_ruta', async () => {
    const f = servidor({
      '/api/admin/resumen': () => json(RESUMEN),
      '/api/admin/usuarios/': () => json({ ...DETALLE, proyectos: [] }),
    });
    render(<Admin />);
    await abrirCostos();
    await userEvent.click(screen.getByRole('button', { name: 'Ver las corridas de <img src=x onerror=alert(1)>' }));
    expect(await screen.findByText('Sin proyectos.')).toBeInTheDocument();
    expect(f.mock.calls.map(c => c[0])).toContain('/api/admin/usuarios/u%2F2%20raro');
  });

  it('admin.detalle.traza_con_id_codificado', async () => {
    servidor({ '/api/admin/resumen': () => json(RESUMEN), '/api/admin/usuarios/': () => json(DETALLE) });
    render(<Admin />);
    await abrirCostos();
    await userEvent.click(screen.getByRole('button', { name: 'Ver las corridas de ana@ejemplo.com' }));
    const enlace = await screen.findByRole('link', { name: /traza/ });
    expect(enlace).toHaveAttribute('href', 'https://lf.ejemplo/trace/tr%231%2Fa');
    expect(enlace).toHaveAttribute('target', '_blank');
    expect(enlace.getAttribute('rel')).toContain('noopener');
  });

  it('admin.detalle.sin_red_avisa_y_reintenta', async () => {
    let intentos = 0;
    servidor({
      '/api/admin/resumen': () => json(RESUMEN),
      '/api/admin/usuarios/': () => (++intentos === 1 ? sinRed() : json(DETALLE)),
    });
    render(<Admin />);
    await abrirCostos();
    await userEvent.click(screen.getByRole('button', { name: 'Ver las corridas de ana@ejemplo.com' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo abrir el detalle — revisa tu conexión.');
    // ya no se queda en «Cargando…» para siempre
    const detalle = screen.getByRole('region', { name: 'Corridas de ana@ejemplo.com' });
    expect(within(detalle).queryByText('Cargando…')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('Un perro astronauta')).toBeInTheDocument();
    expect(intentos).toBe(2);
  });

  it('admin.detalle.error_del_server_en_su_tarjeta', async () => {
    servidor({ '/api/admin/resumen': () => json(RESUMEN), '/api/admin/usuarios/': () => json({}, 500) });
    render(<Admin />);
    await abrirCostos();
    await userEvent.click(screen.getByRole('button', { name: 'Ver las corridas de ana@ejemplo.com' }));
    const detalle = screen.getByRole('region', { name: 'Corridas de ana@ejemplo.com' });
    expect(await within(detalle).findByText('Error 500.')).toBeInTheDocument();
  });

  it('admin.sync.doble_clic_un_solo_post', async () => {
    let soltar!: (r: Response) => void;
    const f = servidor({
      '/api/admin/resumen': () => json(RESUMEN),
      '/api/admin/costes/sync': () => new Promise<Response>(r => (soltar = r)),
    });
    render(<Admin />);
    await abrirCostos();
    const boton = screen.getByRole('button', { name: /Sincronizar costes/ });
    await userEvent.dblClick(boton);
    await userEvent.click(boton);
    const posts = () => f.mock.calls.filter(c => c[1]?.method === 'POST');
    expect(posts()).toHaveLength(1);
    expect(posts()[0]![0]).toBe('/api/admin/costes/sync?dias=7');
    expect(screen.getByText(/trayendo trazas de Langfuse…/)).toBeInTheDocument();
    await act(async () => soltar(json({ ok: true, nuevas: 7 })));
    expect(await screen.findByText(/7 trazas nuevas/)).toBeInTheDocument();
    // y trae el resumen otra vez (la vieja recargaba la página entera)
    expect(f.mock.calls.filter(c => c[0] === '/api/admin/resumen')).toHaveLength(2);
  });

  it('admin.sync.error_deja_volver_a_intentar', async () => {
    const f = servidor({
      '/api/admin/resumen': () => json(RESUMEN),
      '/api/admin/costes/sync': () => json({ detail: 'Langfuse no configurado (falta X)' }, 503),
    });
    render(<Admin />);
    await abrirCostos();
    const boton = screen.getByRole('button', { name: /Sincronizar costes/ });
    await userEvent.click(boton);
    expect(await screen.findByText('Error: Langfuse no configurado (falta X)')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Sincronizar costes/ }));
    expect(f.mock.calls.filter(c => c[1]?.method === 'POST')).toHaveLength(2);
  });

  it('admin.flujo.signo_pinta_verde_o_rojo', async () => {
    servidor({ '/api/admin/resumen': () => json(RESUMEN) });
    render(<Admin />);
    await userEvent.click(await screen.findByRole('tab', { name: '3 · Flujo' }));
    expect(screen.getByText('$4.0000')).toHaveClass('text-exito');
    expect(screen.getByText('-$0.3000')).toHaveClass('text-error');
    expect(screen.getByText('$3.70 dólares')).toHaveClass('text-exito');
  });

  it('admin.marco.enlaces_estudio_y_version_anterior', async () => {
    servidor({ '/api/admin/resumen': () => json(RESUMEN) });
    render(<Admin />);
    expect(screen.getByRole('link', { name: 'Estudio' })).toHaveAttribute('href', '/estudio/');
    expect(screen.getByRole('link', { name: 'Usar la versión anterior' })).toHaveAttribute(
      'href',
      '/ui/clasica?pantalla=admin',
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Panel del negocio');
    await screen.findByRole('tablist');
  });
});
