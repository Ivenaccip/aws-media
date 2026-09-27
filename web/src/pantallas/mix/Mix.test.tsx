// MIX, como COMPORTAMIENTO. Cada test empieza por el ID de su invariante
// (tests/test_migracion_ui.py); el mapa contra las aserciones de
// static/mix.html está en docs/migracion/mix.md.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { json, llamadas, ponerMonedero, servidor, sinRed, type Ruta } from '../../prueba/servidor';
import { clicDia, devolucion, fechaLarga, fraseDevolucion, hoy, leerEjemplo, suma, type Campana, type Corrida, type EstadoMix } from './logica';
import { Mix } from './Mix';

const d = (n: number) => suma(hoy(), n);
const IMG = '/api/imagenes/mix-aaaa-base.jpg/archivo';
const TXT = 'Abrimos en tu barrio. Ven a probar el menú del día.';

const BASE: EstadoMix = {
  campana: null,
  ultima: null,
  corridas: [],
  saldo: 120,
  tarifa: 5,
  tonos: ['vender', 'informar', 'recordar'],
  atajos: { '3 días': 3, '1 semana': 7 },
  max_dias: 60,
  tiene_blotato: true,
  devolucion: 0,
};
const BORRADOR: Campana = {
  id: 'mix-abc',
  motivo: 'Que la gente sepa que abrimos',
  tono: 'informar',
  canal_id: 'c1',
  canal_red: 'instagram',
  canal_nombre: 'cafe',
  hora: '10:00',
  empieza: d(1),
  termina: d(7),
  estado: 'borrador',
  imagen: IMG,
};
const EJEMPLO: Corrida = { dia: d(1), estado: 'ejemplo', texto: TXT, imagen: IMG };
const CON_EJEMPLO: EstadoMix = { ...BASE, campana: BORRADOR, corridas: [EJEMPLO] };
const CUENTAS = { cuentas: [{ id: 'c1', platform: 'instagram', username: 'cafe' }, { id: 'c2', platform: 'threads', fullname: 'Café' }] };
const COSTO = { dias: 7, publicaciones: 7, creditos: 37, saldo: 120, alcanza: true, faltan: 0 }; // 37: falso a propósito
const VIVA: EstadoMix = {
  ...BASE,
  devolucion: 20,
  campana: { ...BORRADOR, estado: 'activa', empieza: d(-2), termina: d(4), creditos_cobrados: 35, creditos_devueltos: 5 },
  corridas: [
    { dia: d(-2), estado: 'publicada', texto: TXT, imagen: IMG },
    { dia: d(-1), estado: 'error', error: 'Instagram rechazó la imagen.' },
  ],
};

const gets = (f: ReturnType<typeof servidor>) => f.mock.calls.filter(c => c[0] === '/api/mix' && !c[1]?.method?.match(/POST/));

function montar(estado: EstadoMix | (() => EstadoMix | Promise<Response>), rutas: Record<string, Ruta> = {}) {
  return servidor({
    '/api/mix': () => (typeof estado === 'function' ? (() => { const r = estado(); return r instanceof Promise ? r : json(r); })() : json(estado)),
    '/api/mix/cuentas': () => json(CUENTAS),
    '/api/mix/borrador': () => json({ id: 'mix-abc', costo: COSTO }),
    '/api/mix/ejemplo': () => json({ dia: d(1), estado: 'preparando' }),
    '/api/mix/encender': () => json({ ok: true, id: 'mix-abc', dias: 7, creditos: 35 }),
    '/api/mix/apagar': () => json({ ok: true, salieron: 1, devueltos: 20 }),
    '/api/mix/reanudar': () => json({ ok: true, id: 'mix-abc' }),
    ...rutas,
  });
}

let monedero: ReturnType<typeof ponerMonedero>;
beforeEach(() => {
  vi.unstubAllGlobals();
  monedero = ponerMonedero(120);
  document.title = 'Estudio de video · MIX';
});
afterEach(() => {
  vi.useRealTimers();
  delete window.monedero;
});

const encenderBtn = () => screen.queryByRole('button', { name: 'Encender la campaña' });
const esperarCosto = () => screen.findByRole('button', { name: 'Encender la campaña' }, { timeout: 3000 });
async function avanzar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('mix', () => {
  it('mix.carga.una_llamada_al_abrir_y_restaura_el_borrador', async () => {
    const f = montar(CON_EJEMPLO);
    render(
      <StrictMode>
        <Mix />
      </StrictMode>,
    );
    expect(await screen.findByDisplayValue('Que la gente sepa que abrimos')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Informar' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('La hora de cada día')).toHaveValue('10:00');
    await waitFor(() => expect(screen.getByLabelText('La cuenta de Blotato')).toHaveValue('c1'));
    expect(screen.getByRole('img', { name: 'La foto de tu producto' })).toHaveAttribute('src', IMG);
    // el ejemplo que ya vio sigue valiendo: no se vuelve a pedir
    expect(screen.getByText(TXT)).toBeInTheDocument();
    expect(gets(f)).toHaveLength(1);
    expect(f.mock.calls.filter(x => x[0] === '/api/mix/cuentas')).toHaveLength(1);
    expect(llamadas(f, '/api/mix/ejemplo')).toHaveLength(0);
  });

  it('mix.blotato.sin_clave_el_formulario_no_se_usa_y_lleva_a_conectar', async () => {
    const f = montar({ ...BASE, tiene_blotato: false });
    render(<Mix />);
    expect(await screen.findByRole('heading', { name: 'Conecta tu Blotato para usar MIX' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Conectar Blotato para usar MIX' })).toHaveAttribute('href', '/estudio/?blotato=conectar');
    expect(screen.getByRole('heading', { name: /Los días/ }).closest('[inert]')).not.toBeNull();
    expect(f.mock.calls.some(c => c[0] === '/api/mix/cuentas')).toBe(false);
  });

  it('mix.cuentas.sin_clave_ofrece_conectar_y_otro_fallo_reintentar', async () => {
    let n = 0;
    montar(BASE, {
      '/api/mix/cuentas': () =>
        n++ === 0 ? json({ detail: 'Conecta tu cuenta de Blotato para que MIX pueda publicar por ti.' }, 409) : json(CUENTAS),
    });
    const { unmount } = render(<Mix />);
    const p = await screen.findByText(/Conecta tu cuenta de Blotato para que MIX/);
    expect(within(p).getByRole('link', { name: 'Conectar Blotato' })).toBeInTheDocument();
    unmount();
    let m = 0;
    montar(BASE, { '/api/mix/cuentas': () => (m++ === 0 ? sinRed() : json(CUENTAS)) });
    render(<Mix />);
    await userEvent.click(await screen.findByRole('button', { name: 'Reintentar' }));
    await waitFor(() => expect(screen.getByRole('option', { name: 'Instagram · cafe' })).toBeInTheDocument());
  });

  it('mix.cuentas.la_que_ya_no_esta_conectada_se_dice', async () => {
    montar({ ...BASE, campana: { ...BORRADOR, canal_id: 'c9' } });
    render(<Mix />);
    expect(await screen.findByText('La cuenta que habías elegido ya no está conectada en Blotato. Elige otra.')).toBeInTheDocument();
    expect(screen.getByLabelText('La cuenta de Blotato')).toHaveValue('');
  });

  it('mix.foto.tipo_y_tamano_antes_de_subir', async () => {
    montar(BASE);
    render(<Mix />);
    await screen.findByRole('heading', { name: /Los días/ });
    const input = document.querySelector('input[type=file]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['x'], 'a.gif', { type: 'image/gif' })] } });
    expect(screen.getByRole('alert')).toHaveTextContent('Tiene que ser JPG, PNG o WebP.');
    const grande = new File([new Uint8Array(12 * 1024 * 1024 + 1)], 'a.jpg', { type: 'image/jpeg' });
    fireEvent.change(input, { target: { files: [grande] } });
    expect(screen.getByRole('alert')).toHaveTextContent('el máximo son 12 MB');
  });

  it('mix.falta.dice_lo_primero_que_falta_y_no_llama', async () => {
    const f = montar(BASE);
    render(<Mix />);
    await screen.findByRole('heading', { name: /Los días/ });
    expect(screen.getByText('Falta la foto de tu producto.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ver un ejemplo' })).toBeDisabled();
    fireEvent.change(document.querySelector('input[type=file]')!, { target: { files: [new File(['x'], 'a.jpg', { type: 'image/jpeg' })] } });
    expect(screen.getByText('Falta contarnos para qué es la campaña.')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/Cuéntanos qué quieres lograr/), 'Abrimos');
    expect(screen.getByText('Faltan las fechas: marca el primer día y el último.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '3 días' }));
    expect(screen.getByText('Falta elegir en qué cuenta va a salir.')).toBeInTheDocument();
    expect(f.mock.calls.filter(c => String(c[0]).startsWith('/api/mix/') && c[0] !== '/api/mix/cuentas')).toHaveLength(0);
  });

  it('mix.calendario.dos_clics_marcan_el_rango_y_el_tope_no_se_pulsa', async () => {
    expect(clicDia(null, null, '2030-01-05')).toEqual({ ini: '2030-01-05', fin: null });
    expect(clicDia('2030-01-05', null, '2030-01-09')).toEqual({ ini: '2030-01-05', fin: '2030-01-09' });
    expect(clicDia('2030-01-05', null, '2030-01-02')).toEqual({ ini: '2030-01-02', fin: null });
    expect(clicDia('2030-01-05', '2030-01-09', '2030-01-20')).toEqual({ ini: '2030-01-20', fin: null });
    montar({ ...BASE, max_dias: 3 });
    render(<Mix />);
    await screen.findByRole('heading', { name: /Los días/ });
    const dia = (n: number) => screen.queryByRole('button', { name: fechaLarga(d(n)) });
    // el pasado no se elige (si ayer cae en el mes a la vista)
    if (dia(-1)) expect(dia(-1)).toBeDisabled();
    await userEvent.click(dia(1)!);
    expect(screen.getByText(/Ahora marca el último día/)).toBeInTheDocument();
    // con el inicio puesto, lo que pasa del tope (3 días) no se puede pulsar
    expect(dia(3)).toBeEnabled();
    expect(dia(4)).toBeDisabled();
    await userEvent.click(dia(3)!);
    expect(screen.getByText(/3 días, 3 publicaciones/)).toBeInTheDocument();
    expect(dia(2)).toHaveAttribute('aria-pressed', 'true');
    // un atajo rellena desde hoy
    await userEvent.click(screen.getByRole('button', { name: '3 días' }));
    expect(dia(0)).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Borrar las fechas' }));
    expect(screen.getByText('Marca el primer día de la campaña.')).toBeInTheDocument();
  });

  it('mix.ejemplo.se_pide_se_espera_y_luego_se_ve_el_costo', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let vueltas = 0;
    const f = montar(() => {
      vueltas++;
      if (vueltas === 1) return { ...BASE, campana: BORRADOR };
      return { ...BASE, campana: BORRADOR, corridas: [vueltas < 3 ? { dia: d(1), estado: 'preparando' } : EJEMPLO] };
    });
    render(<Mix />);
    await screen.findByDisplayValue('Que la gente sepa que abrimos');
    await waitFor(() => expect(screen.getByLabelText('La cuenta de Blotato')).toHaveValue('c1'));
    // antes del ejemplo no se enseña ningún número ni se puede encender
    expect(encenderBtn()).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Ver un ejemplo' }));
    await waitFor(() => expect(llamadas(f, '/api/mix/ejemplo')).toHaveLength(1));
    expect(llamadas(f, '/api/mix/borrador')).toHaveLength(1);
    const fd = llamadas(f, '/api/mix/borrador')[0]![1]!.body as FormData;
    expect(Object.fromEntries([...fd.entries()].filter(([k]) => k !== 'zona'))).toEqual({
      motivo: 'Que la gente sepa que abrimos',
      tono: 'informar',
      canal_id: 'c1',
      canal_red: 'instagram',
      canal_nombre: 'cafe',
      hora: '10:00',
      empieza: d(1),
      termina: d(7),
    });
    expect(await screen.findByText('Preparando tu ejemplo · hasta 2 min')).toBeInTheDocument();
    await avanzar(5000);
    expect(screen.queryByText(TXT)).toBeNull();
    await avanzar(5000);
    expect(await screen.findByText(TXT)).toBeInTheDocument();
    expect(screen.queryByText('Preparando tu ejemplo · hasta 2 min')).toBeNull();
    await avanzar(800);
    expect(await esperarCosto()).toBeEnabled();
    // el número es el del server, no una cuenta de la pantalla
    expect(screen.getByText(/Son/).textContent).toContain('37 créditos');
    expect(screen.queryByText(/Te quedarían/)).toBeNull();
  });

  it('mix.ejemplo.cambiar_lo_que_se_ve_lo_invalida_y_la_hora_no', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    montar(CON_EJEMPLO);
    render(<Mix />);
    await avanzar(800);
    await esperarCosto();
    // la hora cambia el costo, no la publicación
    await userEvent.selectOptions(screen.getByLabelText('La hora de cada día'), '11:00');
    await avanzar(800);
    expect(encenderBtn()).not.toBeNull();
    // el motivo cambia lo que se ve: el ejemplo ya no vale y no hay botón
    await userEvent.type(screen.getByLabelText(/Cuéntanos qué quieres lograr/), '!');
    expect(screen.getByText(/Cambiaste la campaña después de ver esto/)).toBeInTheDocument();
    expect(encenderBtn()).toBeNull();
  });

  it('mix.ejemplo.si_el_intento_muere_lo_dice_sin_orbe', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let vueltas = 0;
    montar(() =>
      vueltas++ === 0
        ? { ...BASE, campana: BORRADOR }
        : { ...BASE, campana: BORRADOR, corridas: [{ dia: d(1), estado: 'preparando', error: 'No pudimos preparar tu ejemplo. Inténtalo otra vez.' }] },
    );
    render(<Mix />);
    await waitFor(() => expect(screen.getByLabelText('La cuenta de Blotato')).toHaveValue('c1'));
    await userEvent.click(screen.getByRole('button', { name: 'Ver un ejemplo' }));
    await avanzar(5100);
    expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos preparar tu ejemplo.');
    expect(screen.queryByText('Preparando tu ejemplo · hasta 2 min')).toBeNull();
    expect(screen.getByRole('button', { name: 'Ver un ejemplo' })).toBeEnabled();
  });

  it('mix.ejemplo.un_4xx_corta_la_espera_y_un_5xx_no', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let vueltas = 0;
    montar(() => {
      vueltas++;
      if (vueltas === 1) return { ...BASE, campana: BORRADOR };
      if (vueltas === 2) return Promise.resolve(json({ detail: 'caído' }, 503));
      if (vueltas === 3) return sinRed() as Promise<Response>;
      return Promise.resolve(json({ detail: 'Tu sesión caducó.' }, 401));
    });
    render(<Mix />);
    await waitFor(() => expect(screen.getByLabelText('La cuenta de Blotato')).toHaveValue('c1'));
    await userEvent.click(screen.getByRole('button', { name: 'Ver un ejemplo' }));
    await avanzar(5100);
    await avanzar(5100);
    expect(screen.getByText('Preparando tu ejemplo · hasta 2 min')).toBeInTheDocument();
    await avanzar(5100);
    expect(await screen.findByRole('alert')).toHaveTextContent('Tu sesión caducó.');
  });

  it('mix.ejemplo.el_409_recarga_en_vez_de_dejar_un_callejon', async () => {
    const f = montar({ ...BASE, campana: BORRADOR }, {
      '/api/mix/ejemplo': () => json({ detail: 'Ya estamos preparando tu ejemplo.' }, 409),
    });
    render(<Mix />);
    await waitFor(() => expect(screen.getByLabelText('La cuenta de Blotato')).toHaveValue('c1'));
    await userEvent.click(screen.getByRole('button', { name: 'Ver un ejemplo' }));
    await waitFor(() => expect(gets(f)).toHaveLength(2));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('mix.ejemplo.al_volver_se_retoma_uno_a_medias_o_se_lee_el_que_murio', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let vueltas = 0;
    const f = montar(() =>
      vueltas++ === 0 ? { ...BASE, campana: BORRADOR, corridas: [{ dia: d(1), estado: 'preparando' }] } : CON_EJEMPLO,
    );
    const { unmount } = render(
      <StrictMode>
        <Mix />
      </StrictMode>,
    );
    expect(await screen.findByText('Preparando tu ejemplo · hasta 2 min')).toBeInTheDocument();
    expect(llamadas(f, '/api/mix/ejemplo')).toHaveLength(0);
    await avanzar(5100);
    expect(await screen.findByText(TXT)).toBeInTheDocument();
    // una sola espera aunque StrictMode monte dos veces
    expect(gets(f)).toHaveLength(2);
    unmount();
    montar({ ...BASE, campana: BORRADOR, corridas: [{ dia: d(1), estado: 'preparando', error: 'Ese intento no salió.' }] });
    render(<Mix />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Ese intento no salió.');
    expect(screen.queryByText('Preparando tu ejemplo · hasta 2 min')).toBeNull();
  });

  it('mix.ejemplo.pedir_otro_retira_el_anterior_y_su_boton', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let vueltas = 0;
    montar(() => (vueltas++ === 0 ? CON_EJEMPLO : { ...BASE, campana: BORRADOR, corridas: [{ dia: d(1), estado: 'preparando' }] }));
    render(<Mix />);
    await avanzar(800);
    await esperarCosto();
    await userEvent.click(screen.getByRole('button', { name: 'Ver otro ejemplo' }));
    await waitFor(() => expect(screen.queryByText(TXT)).toBeNull());
    expect(encenderBtn()).toBeNull();
  });

  it('mix.ejemplo.si_la_campana_cambio_se_descarta_sin_error', () => {
    expect(leerEjemplo({ ...BASE, campana: BORRADOR, corridas: [] }, d(1))).toEqual({ tipo: 'descartado' });
    expect(leerEjemplo({ ...BASE, campana: { ...BORRADOR, estado: 'activa' }, corridas: [EJEMPLO] }, d(1))).toEqual({ tipo: 'descartado' });
    expect(leerEjemplo({ ...BASE, campana: BORRADOR, corridas: [{ dia: d(1), estado: 'preparando' }] }, d(1))).toEqual({ tipo: 'seguir' });
    expect(leerEjemplo(CON_EJEMPLO, d(1))).toMatchObject({ tipo: 'listo' });
  });

  it('mix.cobro.encender_doble_clic_un_cobro_con_su_id', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let soltar!: (r: Response) => void;
    const f = montar(CON_EJEMPLO, { '/api/mix/encender': () => new Promise<Response>(r => (soltar = r)) });
    render(<Mix />);
    await avanzar(800);
    const b = await esperarCosto();
    // dos clics en el mismo tic, antes de que React repinte: el candado es la ref
    act(() => {
      b.click();
      b.click();
    });
    await userEvent.click(screen.getByRole('button', { name: 'Encendiendo…' }));
    expect(llamadas(f, '/api/mix/encender')).toHaveLength(1);
    expect(JSON.parse(String(llamadas(f, '/api/mix/encender')[0]![1]!.body))).toEqual({ id: 'mix-abc' });
    await act(async () => soltar(json({ ok: true, id: 'mix-abc', dias: 7, creditos: 35 })));
    expect(await screen.findByText('Campaña encendida: 7 publicaciones, una cada día a las 10:00.')).toBeInTheDocument();
    expect(monedero.refrescar).toHaveBeenCalled();
    expect(gets(f).length).toBeGreaterThanOrEqual(2);
  });

  it('mix.cobro.si_no_alcanza_no_se_enciende_y_dice_a_quien_escribir', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    ponerMonedero(3, false);
    montar(CON_EJEMPLO, { '/api/mix/borrador': () => json({ id: 'mix-abc', costo: { ...COSTO, saldo: 3, alcanza: false, faltan: 34 } }) });
    render(<Mix />);
    await avanzar(800);
    expect(await esperarCosto()).toBeDisabled();
    const p = screen.getByText(/Te faltan 34 créditos para esta campaña/);
    expect(p).toHaveTextContent('Escríbenos por el canal de la comunidad');
  });

  it('mix.cobro.un_402_dice_a_quien_escribir_y_un_409_recarga', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    ponerMonedero(null, false);
    let n = 0;
    const f = montar(CON_EJEMPLO, {
      '/api/mix/encender': () =>
        n++ === 0
          ? json({ detail: 'Créditos insuficientes: esta acción cuesta 35 créditos y tu saldo es 3.' }, 402)
          : json({ detail: 'Esa campaña ya cambió. Vuelve a abrir la pantalla.' }, 409),
    });
    render(<Mix />);
    await avanzar(800);
    await userEvent.click(await esperarCosto());
    const a = await screen.findByRole('alert');
    expect(a).toHaveTextContent('Créditos insuficientes');
    expect(a).toHaveTextContent('Escríbenos por el canal de la comunidad');
    const antes = gets(f).length;
    await avanzar(800);
    await userEvent.click(await esperarCosto());
    await waitFor(() => expect(gets(f).length).toBe(antes + 1));
  });

  it('mix.cobro.el_saldo_apagado_no_promete_cobro', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    montar({ ...CON_EJEMPLO, saldo: null });
    render(<Mix />);
    await avanzar(800);
    expect(await esperarCosto()).toBeEnabled();
    expect(screen.queryByText(/se te cobran ahora/)).toBeNull();
  });

  it('mix.cobro.un_solo_principal_por_vista', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const ambar = () => [...document.querySelectorAll('button')].filter(b => b.className.includes('bg-ambar')).map(b => b.textContent);
    montar(CON_EJEMPLO);
    render(<Mix />);
    await avanzar(800);
    await esperarCosto();
    expect(ambar()).toEqual(['Encender la campaña']);
    expect(screen.getByRole('button', { name: 'Ver otro ejemplo' }).className).not.toContain('bg-ambar');
  });

  it('mix.viva.estado_proxima_y_cada_dia', async () => {
    montar(VIVA);
    render(<Mix />);
    expect(await screen.findByText(/Publicando todos los días a las 10:00\. Ya salieron/)).toHaveTextContent('1 de 7');
    expect(screen.getByText(/La próxima sale/)).toBeInTheDocument();
    expect(screen.getByText('Pagaste 35 créditos por adelantado. Te devolvimos 5 créditos de los días que no salieron.')).toBeInTheDocument();
    const filas = screen.getAllByRole('listitem');
    expect(filas).toHaveLength(7);
    expect(filas[0]).toHaveTextContent('Publicada');
    expect(filas[1]).toHaveTextContent('No salió');
    expect(filas[1]).toHaveTextContent('Instagram rechazó la imagen.');
    expect(filas[2]).toHaveTextContent('Pendiente');
    expect(screen.getByText('Si la apagas ahora te devolvemos 20 créditos, los 4 días que no salieron.')).toBeInTheDocument();
    expect([...document.querySelectorAll('button')].filter(b => b.className.includes('bg-ambar'))).toHaveLength(0);
  });

  it('mix.viva.apagar_confirma_con_la_cifra_del_servidor', async () => {
    const f = montar(VIVA);
    render(<Mix />);
    await userEvent.click(await screen.findByRole('button', { name: 'Apagar la campaña' }));
    const c = await screen.findByRole('alertdialog', { name: '¿Apagar la campaña?' });
    expect(c).toHaveTextContent('Si la apagas ahora te devolvemos 20 créditos, los 4 días que no salieron.');
    expect(c).toHaveTextContent('No se puede deshacer');
    expect(within(c).getByRole('button', { name: 'No, dejarla' })).toHaveFocus();
    await userEvent.click(within(c).getByRole('button', { name: 'No, dejarla' }));
    expect(llamadas(f, '/api/mix/apagar')).toHaveLength(0);
    await userEvent.click(screen.getByRole('button', { name: 'Apagar la campaña' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Sí, apagarla' }));
    await waitFor(() => expect(llamadas(f, '/api/mix/apagar')).toHaveLength(1));
    expect(JSON.parse(String(llamadas(f, '/api/mix/apagar')[0]![1]!.body))).toEqual({ confirmar: true });
    expect(await screen.findByText('Campaña apagada. Te devolvimos 20 créditos.')).toBeInTheDocument();
    expect(monedero.refrescar).toHaveBeenCalled();
  });

  it('mix.viva.sin_cifra_del_servidor_no_se_inventa_una', () => {
    const sin = { ...VIVA, devolucion: null };
    expect(devolucion(sin)).toEqual({ dias: 6, creditos: null });
    expect(fraseDevolucion(devolucion(sin))).toBe('Si la apagas ahora dejan de salir los 6 días que faltan y te devolvemos sus créditos.');
    expect(fraseDevolucion({ dias: 0, creditos: 0 })).toBe('Ya salieron todas las publicaciones que pagaste: apagarla no devuelve nada.');
    expect(fraseDevolucion({ dias: 0, creditos: 10 })).toBe('Si la apagas ahora te devolvemos 10 créditos.');
  });

  it('mix.viva.pausada_dice_por_que_y_se_reanuda', async () => {
    const f = montar({ ...VIVA, campana: { ...VIVA.campana!, estado: 'pausada', nota: 'Se desconectó tu cuenta de Blotato.' } });
    render(<Mix />);
    expect(await screen.findByText(/Campaña en pausa\. Ya salieron 1 de 7\./)).toBeInTheDocument();
    expect(screen.getByText('Se desconectó tu cuenta de Blotato.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reanudar' }));
    await waitFor(() => expect(llamadas(f, '/api/mix/reanudar')).toHaveLength(1));
    expect(JSON.parse(String(llamadas(f, '/api/mix/reanudar')[0]![1]!.body))).toEqual({ id: 'mix-abc' });
    expect(await screen.findByText('Campaña reanudada. La próxima sale a su hora.')).toBeInTheDocument();
  });

  it('mix.viva.con_un_dia_en_marcha_mira_cada_minuto_solo_a_la_vista', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const f = montar({ ...VIVA, corridas: [...VIVA.corridas, { dia: d(0), estado: 'corriendo' }] });
    render(<Mix />);
    await screen.findByText(/Publicando todos los días/);
    await avanzar(61000);
    expect(gets(f)).toHaveLength(2);
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await avanzar(130000);
    expect(gets(f)).toHaveLength(2);
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
  });

  it('mix.viva.al_volver_a_la_pestana_recarga_la_encendida_y_no_el_borrador', async () => {
    const f = montar(VIVA);
    const { unmount } = render(<Mix />);
    await screen.findByText(/Publicando todos los días/);
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => expect(gets(f)).toHaveLength(2));
    unmount();
    const g = montar(CON_EJEMPLO);
    render(<Mix />);
    await userEvent.type(await screen.findByLabelText(/Cuéntanos qué quieres lograr/), ' sin guardar');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(gets(g)).toHaveLength(1);
    expect(screen.getByLabelText(/Cuéntanos qué quieres lograr/)).toHaveValue('Que la gente sepa que abrimos sin guardar');
  });

  it('mix.ultima.dice_como_acabo_la_anterior', async () => {
    montar({ ...BASE, ultima: { empieza: d(-20), termina: d(-6), estado: 'cancelada', salieron: 4, creditos_devueltos: 50 } });
    render(<Mix />);
    expect(await screen.findByText(/Apagaste tu campaña: salieron 4 de 15 días\. Te devolvimos 50 créditos\./)).toBeInTheDocument();
  });

  it('mix.carga.fallo_avisa_con_reintentar', async () => {
    let n = 0;
    const f = montar(() => (n++ === 0 ? (sinRed() as Promise<Response>) : BASE));
    render(<Mix />);
    const a = await screen.findByRole('alert');
    expect(a).toHaveTextContent('No pudimos hablar con el servidor. Intenta de nuevo.');
    await userEvent.click(within(a).getByRole('button', { name: 'Reintentar' }));
    await screen.findByRole('heading', { name: /Los días/ });
    expect(gets(f)).toHaveLength(2);
  });

  it('mix.textos.del_servidor_como_texto', async () => {
    const malo = '<img src=x onerror=alert(1)>';
    const { container } = (montar({
      ...VIVA,
      campana: { ...VIVA.campana!, motivo: malo, canal_nombre: malo, tono: 'constructor', imagen: 'javascript:alert(1)' },
      corridas: [{ dia: d(-2), estado: 'constructor', texto: malo, imagen: 'javascript:alert(1)' }],
    }),
    render(<Mix />));
    expect((await screen.findAllByText(malo, { exact: false })).length).toBeGreaterThan(0);
    expect(container.querySelector('img[onerror]')).toBeNull();
    expect(container.innerHTML).not.toContain('javascript:');
    // un estado o un tono que no conocemos no pinta una función
    expect(screen.getAllByRole('listitem')[0]).toHaveTextContent('Pendiente');
    expect(container.textContent).not.toContain('function');
  });

  it('mix.marco.enlaces_estudio_y_version_anterior', async () => {
    montar(BASE);
    render(<Mix />);
    expect(screen.getByRole('link', { name: 'Usar la versión anterior' })).toHaveAttribute('href', '/ui/clasica?pantalla=mix');
    expect(screen.getByRole('link', { name: 'Estudio' })).toHaveAttribute('href', '/estudio/');
    await screen.findByRole('heading', { name: /Los días/ });
  });
});
