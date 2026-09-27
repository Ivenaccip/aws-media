// Investiga tu competencia, como COMPORTAMIENTO. Cada test empieza por el ID
// de su invariante (tests/test_migracion_ui.py).
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { json, llamadas, ponerMonedero, servidor, sinRed } from '../../prueba/servidor';
import { Competencia } from './Competencia';
import type { Cuenta, Informe, Listado, Resumen } from './logica';

const TARIFA = 5; // falsa a propósito: el botón tiene que multiplicar la del server
const A: Cuenta = { id: 'ig-a', red: 'instagram', cuenta: 'cuenta_a' };
const B: Cuenta = { id: 'tt-b', red: 'tiktok', cuenta: 'cuenta_b' };
const LISTO: Resumen = {
  id: 'inf-1',
  estado: 'listo',
  inicio: '2026-09-20T10:00:00Z',
  creditos: 10,
  devueltos: 5,
  cuentas: [{ cuenta: 'cuenta_a' }, { cuenta: 'cuenta_b' }],
  n_publicaciones: 2,
};
const VIVO: Resumen = { ...LISTO, id: 'inf-2', estado: 'analizando' };
const INFORME: Informe = {
  id: 'inf-1',
  devueltos: 5,
  fallidas: [{ cuenta: 'cuenta_b', motivo: 'la cuenta es privada.' }],
  lectura: {
    patrones: [{ que: 'Abren con una pregunta', ids: ['p1', 'p2', 'otra'] }],
    ganchos: 'Preguntas',
    formato: 'Vertical corto',
    probar: ['Abre con una pregunta'],
    advertencia: 'Solo 2 publicaciones: tómalo con calma.',
  },
  publicaciones: [
    {
      id: 'p1',
      red: 'instagram',
      cuenta: 'cuenta_a',
      cuando: '2026-09-18T10:00:00Z',
      duracion_s: 7926,
      indice: 2.34,
      enlace: 'https://instagram.com/p/1',
      texto: 'x'.repeat(200),
      vistas: 12000,
      me_gusta: 0,
      comentarios: null,
      compartidos: 3,
    },
    { id: 'p2', red: 'instagram', cuenta: 'cuenta_a', indice: 0.8, enlace: 'javascript:alert(1)', texto: '<img src=x onerror=alert(1)>' },
  ],
};

const listado = (cuentas: Cuenta[], informes: Resumen[] = []): Listado => ({
  cuentas,
  informes,
  credito_por_cuenta: TARIFA,
  max_cuentas: 5,
});

let monedero: ReturnType<typeof ponerMonedero>;
beforeEach(() => {
  vi.unstubAllGlobals();
  monedero = ponerMonedero(100);
  document.title = 'Estudio de video · Investiga tu competencia';
});
afterEach(() => {
  vi.useRealTimers();
  delete window.monedero;
});

describe('competencia', () => {
  it('competencia.cobro.precio_por_cuenta_del_servidor', async () => {
    servidor({ '/api/competencia': () => json(listado([A, B])) });
    render(<Competencia />);
    expect(await screen.findByRole('button', { name: `Revisar ✦ ${TARIFA * 2}` })).toBeInTheDocument();
    expect(screen.getByText(`${TARIFA} créditos por cuenta · 2 de 5`)).toBeInTheDocument();
  });

  it('competencia.cobro.sin_cuentas_no_se_puede_revisar', async () => {
    servidor({ '/api/competencia': () => json(listado([])) });
    render(<Competencia />);
    expect(await screen.findByText(`${TARIFA} créditos por cuenta, hasta 5 cuentas`)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Revisar' })).toBeDisabled();
    expect(screen.getByText('Todavía no vigilas a nadie — pega la liga de un perfil abajo.')).toBeInTheDocument();
  });

  it('competencia.cobro.doble_clic_un_solo_post', async () => {
    let soltar!: (r: Response) => void;
    const f = servidor({
      '/api/competencia': () => json(listado([A])),
      '/api/competencia/analizar': () => new Promise<Response>(r => (soltar = r)),
    });
    render(<Competencia />);
    const b = await screen.findByRole('button', { name: /Revisar ✦/ });
    await userEvent.dblClick(b);
    await userEvent.click(b);
    expect(llamadas(f, '/api/competencia/analizar')).toHaveLength(1);
    await act(async () => soltar(json({ lanzado: true, id: 'inf-3', creditos: TARIFA })));
    expect(monedero.refrescar).toHaveBeenCalled();
  });

  it('competencia.cobro.el_error_va_junto_a_revisar', async () => {
    servidor({
      '/api/competencia': () => json(listado([A])),
      '/api/competencia/analizar': () => json({ detail: 'Ya hay una revisión en marcha — espera a que termine' }, 409),
    });
    render(<Competencia />);
    await userEvent.click(await screen.findByRole('button', { name: /Revisar ✦/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Ya hay una revisión en marcha');
  });

  it('competencia.cobro.sin_saldo_402_con_la_recarga_abierta_ofrece_recargar', async () => {
    servidor({
      '/api/competencia': () => json(listado([A])),
      '/api/competencia/analizar': () => json({ detail: 'Te faltan 3 créditos' }, 402),
    });
    render(<Competencia />);
    await userEvent.click(await screen.findByRole('button', { name: /Revisar ✦/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Te faltan 3 créditos');
    await userEvent.click(screen.getByRole('button', { name: 'Recargar' }));
    expect(monedero.recargar).toHaveBeenCalled();
  });

  it('competencia.cuentas.agregar_es_gratis_y_limpia_el_campo', async () => {
    let cuentas: Cuenta[] = [];
    const f = servidor({
      '/api/competencia': () => json(listado(cuentas)),
      '/api/competencia/cuentas': () => {
        cuentas = [A];
        return json({ cuentas });
      },
    });
    render(<Competencia />);
    const campo = await screen.findByLabelText('Liga del perfil que quieres vigilar');
    await userEvent.type(campo, 'instagram.com/cuenta_a');
    await userEvent.click(screen.getByRole('button', { name: 'Agregar' }));
    expect(await screen.findByText('@cuenta_a')).toBeInTheDocument();
    expect(campo).toHaveValue('');
    expect(JSON.parse(String(llamadas(f, '/api/competencia/cuentas')[0]![1]!.body))).toEqual({ url: 'instagram.com/cuenta_a' });
    expect(llamadas(f, '/api/competencia/analizar')).toHaveLength(0);
  });

  it('competencia.cuentas.sin_liga_o_con_error_lo_dice_junto_al_campo', async () => {
    servidor({
      '/api/competencia': () => json(listado([])),
      '/api/competencia/cuentas': () => json({ detail: 'Ya estás vigilando a @cuenta_a en Instagram' }, 409),
    });
    render(<Competencia />);
    await userEvent.click(await screen.findByRole('button', { name: 'Agregar' }));
    expect(screen.getByText('Pega la liga del perfil primero.')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Liga del perfil que quieres vigilar'), 'instagram.com/cuenta_a');
    await userEvent.click(screen.getByRole('button', { name: 'Agregar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Ya estás vigilando a @cuenta_a');
  });

  it('competencia.cuentas.quitar_y_su_fallo_con_reintentar', async () => {
    let intentos = 0;
    const f = servidor({
      '/api/competencia': () => json(listado([A, B])),
      '/api/competencia/cuentas': () => (++intentos === 1 ? sinRed() : json({ cuentas: [B] })),
    });
    render(<Competencia />);
    await userEvent.click(await screen.findByRole('button', { name: 'Quitar @cuenta_a' }));
    expect(await screen.findByText(/No pudimos quitar esa cuenta/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    await waitFor(() => expect(screen.queryByText('@cuenta_a')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: `Revisar ✦ ${TARIFA}` })).toBeInTheDocument();
    expect(llamadas(f, '/api/competencia/cuentas/ig-a', 'DELETE')).toHaveLength(2);
  });

  it('competencia.informe.resumen_ver_y_cerrar', async () => {
    const f = servidor({
      '/api/competencia': () => json(listado([A], [LISTO])),
      '/api/competencia/informes': () => json(INFORME),
    });
    render(<Competencia />);
    expect(await screen.findByText(/2 publicaciones · 10 créditos \(5 devueltos\)/)).toBeInTheDocument();
    // la fecha, en español aunque el navegador esté en inglés
    expect(screen.getByRole('heading', { name: /20 de septiembre/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Ver' }));
    expect(await screen.findByText('Qué se repite en las que rinden')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(screen.queryByText('Qué se repite en las que rinden')).not.toBeInTheDocument();
    // abrirlo otra vez no lo vuelve a pedir
    await userEvent.click(screen.getByRole('button', { name: 'Ver' }));
    expect(screen.getByText('Qué se repite en las que rinden')).toBeInTheDocument();
    expect(llamadas(f, '/api/competencia/informes/inf-1', 'GET')).toHaveLength(1);
  });

  it('competencia.informe.lectura_fallidas_y_devueltos', async () => {
    servidor({ '/api/competencia': () => json(listado([A], [LISTO])), '/api/competencia/informes': () => json(INFORME) });
    render(<Competencia />);
    await userEvent.click(await screen.findByRole('button', { name: 'Ver' }));
    expect(await screen.findByText(/No se pudo traer @cuenta_b: la cuenta es privada\. Te devolvimos 5 créditos\./)).toBeInTheDocument();
    // solo cuenta las publicaciones que de verdad están en el informe
    expect(screen.getByText('(2 publicaciones)')).toBeInTheDocument();
    expect(screen.getByText('Solo 2 publicaciones: tómalo con calma.')).toBeInTheDocument();
  });

  it('competencia.informe.numeros_honestos', async () => {
    servidor({ '/api/competencia': () => json(listado([A], [LISTO])), '/api/competencia/informes': () => json(INFORME) });
    render(<Competencia />);
    await userEvent.click(await screen.findByRole('button', { name: 'Ver' }));
    await screen.findByText('Qué se repite en las que rinden');
    const vistas = screen.getAllByText(/^Vistas/)[0]!;
    expect(within(vistas).getByText('12,000')).toBeInTheDocument();
    // 0 sí vino (es cero); null no vino (es «—»)
    expect(within(screen.getAllByText(/^Me gusta/)[0]!).getByText('0')).toBeInTheDocument();
    expect(within(screen.getAllByText(/^Comentarios/)[0]!).getByText('—')).toBeInTheDocument();
    expect(screen.getByText(/2 h 12 min/)).toBeInTheDocument();
    expect(screen.getByText('2.3× lo normal')).toHaveClass('text-exito');
    expect(screen.getByText('0.8× lo normal')).not.toHaveClass('text-exito');
    expect(screen.getByText('x'.repeat(180) + '…')).toBeInTheDocument();
  });

  it('competencia.informe.textos_y_ligas_de_terceros_seguros', async () => {
    servidor({ '/api/competencia': () => json(listado([A], [LISTO])), '/api/competencia/informes': () => json(INFORME) });
    const { container } = render(<Competencia />);
    await userEvent.click(await screen.findByRole('button', { name: 'Ver' }));
    expect(await screen.findByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(container.querySelector('img[src="x"]')).toBeNull();
    const ligas = screen.getAllByRole('link', { name: /Ver/ });
    expect(ligas.map(a => a.getAttribute('href'))).toEqual(['https://instagram.com/p/1']);
    expect(ligas[0]!.getAttribute('rel')).toContain('noopener');
  });

  it('competencia.informe.fallo_al_abrir_avisa_y_reintenta', async () => {
    let red = false;
    servidor({
      '/api/competencia': () => json(listado([A], [LISTO])),
      '/api/competencia/informes': () => (red ? json(INFORME) : sinRed()),
    });
    render(<Competencia />);
    await userEvent.click(await screen.findByRole('button', { name: 'Ver' }));
    expect(await screen.findByText(/No pudimos abrir ese informe/)).toBeInTheDocument();
    red = true;
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('Qué se repite en las que rinden')).toBeInTheDocument();
  });

  it('competencia.informe.error_dice_que_los_creditos_volvieron', async () => {
    servidor({ '/api/competencia': () => json(listado([A], [{ ...LISTO, estado: 'error', error: 'Apify no respondió' }])) });
    render(<Competencia />);
    expect(await screen.findByText(/La revisión falló \(Apify no respondió\) — tus créditos se devolvieron\./)).toBeInTheDocument();
  });

  it('competencia.lista.sondea_mientras_revisa_y_para_al_terminar', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let informes: Resumen[] = [VIVO];
    const f = servidor({ '/api/competencia': () => json(listado([A], informes)) });
    render(<Competencia />);
    await screen.findByText(/Revisando a la competencia/);
    const gets = () => llamadas(f, '/api/competencia', 'GET').length;
    const antes = gets();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(gets()).toBe(antes + 1);
    informes = [{ ...VIVO, estado: 'listo' }];
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    const alTerminar = gets();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60000);
    });
    expect(gets()).toBe(alTerminar);
    expect(monedero.refrescar).toHaveBeenCalled();
  });

  it('competencia.lista.sin_red_con_una_revision_viva_sigue_reintentando', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let red = true;
    servidor({ '/api/competencia': () => (red ? json(listado([A], [VIVO])) : sinRed()) });
    render(<Competencia />);
    await screen.findByText(/Revisando a la competencia/);
    red = false;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(screen.getByText('Sin conexión — reintentando… Tu revisión sigue en la nube.')).toBeInTheDocument();
    red = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(screen.queryByText(/Sin conexión/)).not.toBeInTheDocument();
  });

  it('competencia.lista.fallo_de_carga_avisa_y_reintenta', async () => {
    let red = false;
    servidor({ '/api/competencia': () => (red ? json(listado([A])) : sinRed()) });
    render(<Competencia />);
    expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos traer tus cuentas y revisiones.');
    expect(screen.queryByText('Cargando…')).not.toBeInTheDocument();
    red = true;
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('@cuenta_a')).toBeInTheDocument();
  });

  it('competencia.espera.titulo_de_la_pestana_dice_revisando', async () => {
    servidor({ '/api/competencia': () => json(listado([A], [VIVO])) });
    render(<Competencia />);
    await waitFor(() => expect(document.title).toBe('Revisando a la competencia · Estudio de video · Investiga tu competencia'));
  });

  it('competencia.marco.enlaces_estudio_y_version_anterior', async () => {
    servidor({ '/api/competencia': () => json(listado([])) });
    render(<Competencia />);
    expect(screen.getByRole('link', { name: 'Usar la versión anterior' })).toHaveAttribute('href', '/ui/clasica?pantalla=competencia');
    await screen.findByRole('button', { name: 'Revisar' });
  });
});
