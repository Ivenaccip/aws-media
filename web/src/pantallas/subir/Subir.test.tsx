// Editar metraje, como COMPORTAMIENTO (docs/PLAN-UI.md §5). Cada test empieza
// por el ID de su invariante: tests/test_migracion_ui.py exige que cada ID
// del registro exista aquí.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { json, llamadas, oirCobros, ponerMonedero, servidor, sinRed, type Ruta } from '../../prueba/servidor';
import type { Costo, EstadoEditar } from './logica';
import { Subir } from './Subir';

// una tarifa que no existe en tarifas.json: si alguien escribe el número en
// el cliente, el botón deja de decir 17
const COSTO: Costo = {
  fuente: 'usuarios/u/podcast/crudo.mp4',
  duracion_s: 754.2,
  con_transcript: false,
  creditos: 17,
  backend_listo: true,
  aviso: null,
};
const CON_FUENTE: EstadoEditar = { editar: null, fuente: COSTO.fuente, editor_listo: false };
const SIN_FUENTE: EstadoEditar = { editar: null, fuente: null, editor_listo: false };
const CORRIENDO: EstadoEditar = { ...CON_FUENTE, editar: { estado: 'corriendo' } };
const LISTO: EstadoEditar = {
  ...CON_FUENTE,
  editar: { estado: 'listo', cortes: 3, fluff: 2, flags: 1 },
  editor_listo: true,
};

// el PUT a S3 va por XHR (para tener progreso): uno de mentira que el test mueve
class XhrFalso {
  static todos: XhrFalso[] = [];
  metodo = '';
  url = '';
  cabeceras: Record<string, string> = {};
  cuerpo: unknown = null;
  status = 0;
  abortado = false;
  upload: { onprogress: ((ev: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = {
    onprogress: null,
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  constructor() {
    XhrFalso.todos.push(this);
  }
  open(metodo: string, url: string) {
    this.metodo = metodo;
    this.url = url;
  }
  setRequestHeader(k: string, v: string) {
    this.cabeceras[k] = v;
  }
  send(cuerpo: unknown) {
    this.cuerpo = cuerpo;
  }
  abort() {
    this.abortado = true;
    this.onabort?.();
  }
  avanzar(cargados: number, total: number) {
    this.upload.onprogress?.({ lengthComputable: true, loaded: cargados, total });
  }
  terminar(status = 200) {
    this.status = status;
    this.onload?.();
  }
}

const ultimoXhr = () => XhrFalso.todos[XhrFalso.todos.length - 1]!;

interface Opciones {
  activo?: boolean;
  estado?: () => EstadoEditar | Promise<Response>;
  costo?: Costo;
  rutas?: Record<string, Ruta>;
}

function montar({ activo = true, estado = () => CON_FUENTE, costo = COSTO, rutas = {} }: Opciones = {}) {
  return servidor({
    '/api/media/config': () => json({ activo, cdn: 'https://cdn.ejemplo/' }),
    '/api/media/presign': (_u, init) => {
      const b = JSON.parse(String(init?.body)) as { proyecto: string; content_type: string };
      return json({ url: 'https://s3.ejemplo/subida?firma=1', key: `usuarios/u/${b.proyecto}/crudo.mp4`, content_type: b.content_type });
    },
    '/api/media/confirmar': (_u, init) => {
      const b = JSON.parse(String(init?.body)) as { key: string };
      return json({ archivo: 'crudo.mp4', cdn: 'https://cdn.ejemplo/' + b.key });
    },
    '/api/editar': () => {
      const r = estado();
      return r instanceof Promise ? r : json(r);
    },
    '/api/editar/podcast/costo': () => json(costo),
    ...rutas,
  });
}

function irA(p: string | null) {
  history.replaceState(null, '', p === null ? '/estudio/subir/' : '/estudio/subir/?p=' + encodeURIComponent(p));
}

function video(nombre = 'entrevista.mp4', tipo = 'video/mp4', bytes = 50_000_000) {
  const f = new File(['x'], nombre, { type: tipo });
  Object.defineProperty(f, 'size', { value: bytes });
  return f;
}

async function llenar(nombre: string, f: File | null = video()) {
  const campo = await screen.findByLabelText('Nombre del proyecto');
  await userEvent.clear(campo);
  if (nombre) await userEvent.type(campo, nombre);
  if (f) fireEvent.change(screen.getByLabelText('Archivo de video'), { target: { files: [f] } });
}

const botonSubir = () => screen.getByRole('button', { name: 'Subir' });

let monedero: ReturnType<typeof ponerMonedero>;

beforeEach(() => {
  vi.unstubAllGlobals();
  XhrFalso.todos = [];
  vi.stubGlobal('XMLHttpRequest', XhrFalso);
  monedero = ponerMonedero(100);
  irA('podcast');
  document.title = 'Estudio de video · Editar';
});

afterEach(() => {
  vi.useRealTimers();
  delete window.monedero;
});

describe('editor IA: lo que cobra', () => {
  it('subir.cobro.precio_del_servidor_en_el_boton', async () => {
    montar();
    render(<Subir />);
    expect(await screen.findByRole('button', { name: 'Proponer ✦ 17' })).toBeInTheDocument();
  });

  it('subir.cobro.pide_confirmar_y_cancelar_no_cobra', async () => {
    const cobros = oirCobros();
    const f = montar();
    render(<Subir />);
    await userEvent.click(await screen.findByRole('button', { name: 'Proponer ✦ 17' }));
    const dialogo = screen.getByRole('alertdialog', { name: '¿Proponer el corte?' });
    expect(dialogo).toHaveTextContent('por 17 créditos');
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(llamadas(f, '/api/editar/podcast/sugerir')).toHaveLength(0);
    expect(cobros).toEqual([]);
    // y el botón sigue sirviendo
    await userEvent.click(screen.getByRole('button', { name: 'Proponer ✦ 17' }));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });

  it('subir.cobro.doble_clic_un_solo_post', async () => {
    let soltar!: (r: Response) => void;
    const f = montar({ rutas: { '/api/editar/podcast/sugerir': () => new Promise<Response>(r => (soltar = r)) } });
    render(<Subir />);
    const boton = await screen.findByRole('button', { name: 'Proponer ✦ 17' });
    await userEvent.dblClick(boton);
    expect(screen.getAllByRole('alertdialog')).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Proponer' }));
    await userEvent.click(screen.getByRole('button', { name: /Lanzando/ }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(llamadas(f, '/api/editar/podcast/sugerir')).toHaveLength(1);
    await act(async () => soltar(json({ lanzado: true, creditos: 17 })));
  });

  it('subir.cobro.sin_precio_no_hay_boton', async () => {
    montar({ costo: { ...COSTO, backend_listo: false, aviso: 'un video tan corto no tiene relleno que recortar' } });
    const { unmount } = render(<Subir />);
    expect(await screen.findByText('un video tan corto no tiene relleno que recortar')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Proponer/ })).toBeNull();
    unmount();
    // y si el precio no llega, tampoco: nube sin preview = bug
    montar({ rutas: { '/api/editar/podcast/costo': () => json({ detail: 'sin duración' }, 500) } });
    render(<Subir />);
    expect(await screen.findByRole('alert')).toHaveTextContent('sin duración');
    expect(screen.queryByRole('button', { name: /Proponer/ })).toBeNull();
  });

  it('subir.cobro.error_se_queda_y_el_boton_vuelve', async () => {
    const cobros = oirCobros();
    let veces = 0;
    const f = montar({
      rutas: {
        '/api/editar/podcast/sugerir': () =>
          ++veces === 1
            ? json({ detail: 'La corrida ya está en curso — espera a que termine' }, 409)
            : json({ lanzado: true, creditos: 17 }),
      },
    });
    render(<Subir />);
    await userEvent.click(await screen.findByRole('button', { name: 'Proponer ✦ 17' }));
    await userEvent.click(screen.getByRole('button', { name: 'Proponer' }));
    expect(await screen.findByText('La corrida ya está en curso — espera a que termine')).toBeInTheDocument();
    expect(cobros).toEqual([]);
    // no se borra solo (la vieja lo pintaba y el initCorte() de abajo lo borraba)
    await act(async () => {
      await new Promise(r => setTimeout(r, 50));
    });
    expect(screen.getByText('La corrida ya está en curso — espera a que termine')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Proponer ✦ 17' }));
    await userEvent.click(screen.getByRole('button', { name: 'Proponer' }));
    await waitFor(() => expect(llamadas(f, '/api/editar/podcast/sugerir')).toHaveLength(2));
  });

  it('subir.cobro.sin_saldo_con_la_recarga_cerrada_dice_a_quien_escribir', async () => {
    const cobros = oirCobros();
    monedero = ponerMonedero(null, false);
    montar({ rutas: { '/api/editar/podcast/sugerir': () => json({ detail: 'Te faltan créditos.' }, 402) } });
    render(<Subir />);
    await userEvent.click(await screen.findByRole('button', { name: 'Proponer ✦ 17' }));
    await userEvent.click(screen.getByRole('button', { name: 'Proponer' }));
    const alerta = await screen.findByText(/Te faltan créditos\./);
    expect(alerta).toHaveTextContent(monedero.cta);
    expect(screen.queryByRole('button', { name: 'Recargar' })).toBeNull();
    expect(cobros).toEqual([]);
  });

  it('subir.cobro.saldo_conocido_que_no_alcanza_no_cobra', async () => {
    const cobros = oirCobros();
    monedero = ponerMonedero(5);
    const f = montar();
    render(<Subir />);
    const boton = await screen.findByRole('button', { name: 'Proponer ✦ 17' });
    expect(boton).toBeDisabled();
    expect(screen.getByText(/Te faltan ✦ 12/)).toBeInTheDocument();
    await userEvent.click(boton);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(llamadas(f, '/api/editar/podcast/sugerir')).toHaveLength(0);
    expect(cobros).toEqual([]);
  });

  it('subir.cobro.refresca_el_saldo_y_pasa_a_revisando', async () => {
    const cobros = oirCobros();
    let st = CON_FUENTE;
    const f = montar({
      estado: () => st,
      rutas: {
        '/api/editar/podcast/sugerir': () => {
          st = CORRIENDO;
          return json({ lanzado: true, creditos: 17 });
        },
      },
    });
    render(<Subir />);
    await userEvent.click(await screen.findByRole('button', { name: 'Proponer ✦ 17' }));
    await userEvent.click(screen.getByRole('button', { name: 'Proponer' }));
    expect(await screen.findByText('Revisando tu metraje · transcribir y proponer el corte')).toBeInTheDocument();
    expect(monedero.refrescar).toHaveBeenCalled();
    expect(cobros).toEqual([expect.objectContaining({ costo: COSTO.creditos })]);
    expect(screen.queryByRole('button', { name: /Proponer/ })).toBeNull();
    // el POST va sin cuerpo, como siempre
    expect(llamadas(f, '/api/editar/podcast/sugerir')[0]![1]!.body).toBeUndefined();
  });
});

describe('subir metraje', () => {
  it('subir.subida.sin_servicio_no_se_ofrece', async () => {
    irA(null);
    montar({ activo: false });
    render(<Subir />);
    expect(await screen.findByText(/aquí no se puede subir/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Subir' })).toBeNull();
  });

  it('subir.subida.sin_nombre_o_archivo_no_pide_firma', async () => {
    irA(null);
    const f = montar();
    const { unmount } = render(<Subir />);
    await llenar('', video());
    await userEvent.click(botonSubir());
    expect(screen.getByText('Falta el nombre del proyecto o el archivo.')).toBeInTheDocument();
    unmount();
    render(<Subir />);
    await llenar('entrevista', null);
    await userEvent.click(botonSubir());
    expect(screen.getByText('Falta el nombre del proyecto o el archivo.')).toBeInTheDocument();
    expect(llamadas(f, '/api/media/presign')).toHaveLength(0);
  });

  it('subir.subida.nombre_invalido_no_pide_firma', async () => {
    irA(null);
    const f = montar();
    render(<Subir />);
    await llenar('mi entrevista');
    await userEvent.click(botonSubir());
    expect(screen.getByRole('alert')).toHaveTextContent('solo puede llevar letras, números, guion y guion bajo');
    expect(llamadas(f, '/api/media/presign')).toHaveLength(0);
  });

  it('subir.subida.firma_con_proyecto_archivo_tipo_y_bytes', async () => {
    irA(null);
    const f = montar();
    render(<Subir />);
    // un .mov sin file.type se firma como video/mp4, igual que la vieja
    await llenar('entrevista-año', video('toma.mov', '', 1234));
    await userEvent.click(botonSubir());
    await waitFor(() => expect(XhrFalso.todos).toHaveLength(1));
    expect(JSON.parse(String(llamadas(f, '/api/media/presign')[0]![1]!.body))).toEqual({
      proyecto: 'entrevista-año',
      archivo: 'toma.mov',
      content_type: 'video/mp4',
      bytes: 1234,
    });
    const x = ultimoXhr();
    expect(x.metodo).toBe('PUT');
    expect(x.url).toBe('https://s3.ejemplo/subida?firma=1');
    expect(x.cabeceras['Content-Type']).toBe('video/mp4');
    await act(async () => x.terminar());
  });

  it('subir.subida.progreso_real_con_porcentaje_y_mb', async () => {
    irA(null);
    montar();
    render(<Subir />);
    await llenar('entrevista');
    await userEvent.click(botonSubir());
    await waitFor(() => expect(XhrFalso.todos).toHaveLength(1));
    act(() => ultimoXhr().avanzar(20_000_000, 50_000_000));
    expect(screen.getByRole('progressbar', { name: 'Avance de la subida' })).toHaveAttribute('aria-valuenow', '40');
    expect(screen.getByText('Subiendo entrevista.mp4 — 40% (20.0 de 50.0 MB)')).toBeInTheDocument();
    expect(botonSubir()).toBeDisabled();
    await act(async () => ultimoXhr().terminar());
    await waitFor(() => expect(screen.queryByRole('progressbar')).toBeNull());
  });

  it('subir.subida.cancelar_aborta_y_lo_dice', async () => {
    irA(null);
    const f = montar();
    render(<Subir />);
    await llenar('entrevista');
    await userEvent.click(botonSubir());
    await waitFor(() => expect(XhrFalso.todos).toHaveLength(1));
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(ultimoXhr().abortado).toBe(true);
    expect(await screen.findByRole('alert')).toHaveTextContent('Subida cancelada — nada quedó a medias en tu proyecto.');
    expect(llamadas(f, '/api/media/confirmar')).toHaveLength(0);
    expect(botonSubir()).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Cancelar' })).toBeNull();
  });

  it('subir.subida.nombre_ocupado_409_deja_una_variante', async () => {
    irA(null);
    vi.spyOn(crypto, 'getRandomValues').mockImplementation(((a: Uint16Array) => {
      a[0] = 0xbeef;
      return a;
    }) as typeof crypto.getRandomValues);
    montar({ rutas: { '/api/media/presign': () => json({ detail: 'Ese nombre ya está en uso.' }, 409) } });
    render(<Subir />);
    await llenar('entrevista');
    await userEvent.click(botonSubir());
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Ese nombre ya está en uso. Te dejamos «entrevista-beef» en el nombre: pulsa Subir para usarlo.',
    );
    expect(screen.getByLabelText('Nombre del proyecto')).toHaveValue('entrevista-beef');
    expect(XhrFalso.todos).toHaveLength(0);
  });

  it('subir.subida.fallo_del_put_avisa_y_deja_reintentar', async () => {
    irA(null);
    const f = montar();
    render(<Subir />);
    await llenar('entrevista');
    await userEvent.click(botonSubir());
    await waitFor(() => expect(XhrFalso.todos).toHaveLength(1));
    await act(async () => ultimoXhr().terminar(403));
    expect(await screen.findByRole('alert')).toHaveTextContent('La subida a la nube falló (403) — intenta de nuevo.');
    expect(llamadas(f, '/api/media/confirmar')).toHaveLength(0);
    await userEvent.click(botonSubir());
    await waitFor(() => expect(XhrFalso.todos).toHaveLength(2));
    await act(async () => ultimoXhr().onerror?.());
    expect(await screen.findByRole('alert')).toHaveTextContent('revisa tu conexión');
  });

  it('subir.subida.confirma_y_pasa_al_panel_con_p_en_la_url', async () => {
    irA(null);
    const f = montar();
    render(<Subir />);
    expect(screen.queryByRole('heading', { name: /Tu video/ })).toBeNull();
    await llenar('podcast');
    await userEvent.click(botonSubir());
    await waitFor(() => expect(XhrFalso.todos).toHaveLength(1));
    await act(async () => ultimoXhr().terminar());
    expect(await screen.findByText('Listo: crudo.mp4 ya está en tu proyecto podcast.')).toBeInTheDocument();
    expect(JSON.parse(String(llamadas(f, '/api/media/confirmar')[0]![1]!.body))).toEqual({
      proyecto: 'podcast',
      key: 'usuarios/u/podcast/crudo.mp4',
    });
    expect(location.search).toBe('?p=podcast');
    expect(screen.getByRole('heading', { name: /Tu video/ })).toHaveTextContent('podcast');
    expect(document.querySelector('video')).toHaveAttribute('src', 'https://cdn.ejemplo/usuarios/u/podcast/crudo.mp4');
    expect(await screen.findByRole('button', { name: 'Proponer ✦ 17' })).toBeInTheDocument();
  });

  it('subir.subida.avisa_antes_de_cerrar_a_medias', async () => {
    irA(null);
    montar();
    render(<Subir />);
    const cerrar = () => {
      const ev = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(ev);
      return ev.defaultPrevented;
    };
    expect(cerrar()).toBe(false);
    await llenar('entrevista');
    await userEvent.click(botonSubir());
    await waitFor(() => expect(XhrFalso.todos).toHaveLength(1));
    expect(cerrar()).toBe(true);
    await act(async () => ultimoXhr().terminar());
    await waitFor(() => expect(cerrar()).toBe(false));
  });

  it('subir.subida.doble_clic_una_sola_firma', async () => {
    irA(null);
    const f = montar();
    render(<Subir />);
    await llenar('entrevista');
    // los dos clics en el mismo tic: el botón todavía no se ha repintado apagado
    act(() => {
      fireEvent.click(botonSubir());
      fireEvent.click(botonSubir());
    });
    await waitFor(() => expect(XhrFalso.todos).toHaveLength(1));
    expect(llamadas(f, '/api/media/presign')).toHaveLength(1);
    await act(async () => ultimoXhr().terminar());
  });
});

describe('el panel de los dos caminos', () => {
  it('subir.panel.sin_proyecto_no_hay_panel', async () => {
    irA(null);
    const f = montar();
    render(<Subir />);
    await screen.findByRole('button', { name: 'Subir' });
    expect(screen.queryByText('Cortes IA')).toBeNull();
    expect(f.mock.calls.some(c => String(c[0]).startsWith('/api/editar'))).toBe(false);
  });

  it('subir.panel.proyecto_codificado_en_la_ruta', async () => {
    irA('año');
    const f = montar({ rutas: { '/api/editar/a%C3%B1o/costo': () => json(COSTO) } });
    render(<Subir />);
    await screen.findByRole('button', { name: 'Proponer ✦ 17' });
    expect(llamadas(f, '/api/editar/a%C3%B1o', 'GET')).toHaveLength(1);
    expect(screen.getByRole('link', { name: /Sacar mis cortes/ })).toHaveAttribute('href', '/shorts.html?p=a%C3%B1o');
  });

  it('subir.panel.video_de_muestra_desde_el_cdn', async () => {
    montar();
    render(<Subir />);
    await screen.findByRole('button', { name: 'Proponer ✦ 17' });
    // la barra final del CDN no se duplica
    expect(document.querySelector('video')).toHaveAttribute('src', 'https://cdn.ejemplo/usuarios/u/podcast/crudo.mp4');
  });

  it('subir.panel.sin_metraje_pide_subirlo_primero', async () => {
    const f = montar({ estado: () => SIN_FUENTE });
    render(<Subir />);
    expect(await screen.findByText('Sube tu metraje arriba y aquí aparecen tus dos caminos.')).toBeInTheDocument();
    expect(screen.getAllByText('Sube tu metraje primero')).toHaveLength(2);
    expect(screen.queryByRole('link', { name: /Sacar mis cortes/ })).toBeNull();
    // sin metraje no se pide precio
    expect(llamadas(f, '/api/editar/podcast/costo', 'GET')).toHaveLength(0);
  });

  it('subir.panel.cortes_ia_lleva_a_shorts_con_el_proyecto', async () => {
    montar();
    render(<Subir />);
    expect(await screen.findByRole('link', { name: /Sacar mis cortes/ })).toHaveAttribute('href', '/shorts.html?p=podcast');
  });

  it('subir.panel.listo_editar_y_resumen', async () => {
    const f = montar({ estado: () => LISTO });
    render(<Subir />);
    expect(await screen.findByRole('link', { name: /Editar/ })).toHaveAttribute('href', '/editor/podcast/');
    expect(screen.getByText('Corte propuesto: propuso 3 cortes, 2 sugerencias y 1 dudas.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Proponer/ })).toBeNull();
    expect(llamadas(f, '/api/editar/podcast/costo', 'GET')).toHaveLength(0);
    await waitFor(() => expect(document.title).toBe('✓ Corte propuesto · Estudio de video · Editar'));
  });

  it('subir.panel.sin_relleno_dice_que_devolvimos', async () => {
    montar({ estado: () => ({ ...LISTO, editar: { estado: 'listo', cortes: 0, fluff: 0, flags: 0, devueltos: 12 } }) });
    render(<Subir />);
    expect(
      await screen.findByText(
        'Tu video ya está apretado: no encontramos relleno que quitar — te devolvimos 12 créditos. Puedes abrir el editor y cortar a mano.',
      ),
    ).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe('✓ Sin relleno que quitar · Estudio de video · Editar'));
  });

  it('subir.panel.corrida_fallida_dice_que_los_creditos_volvieron', async () => {
    montar({ estado: () => ({ ...CON_FUENTE, editar: { estado: 'error', error: 'boom' } }) });
    render(<Subir />);
    expect(await screen.findByText('La corrida anterior falló y tus créditos se devolvieron.')).toBeInTheDocument();
    // y se puede volver a pedir
    expect(screen.getByRole('button', { name: 'Proponer ✦ 17' })).toBeInTheDocument();
  });

  it('subir.panel.metraje_con_duracion_y_transcript', async () => {
    montar();
    render(<Subir />);
    expect(await screen.findByText('Metraje de 12.6 min (la corrida del editor incluye la transcripción).')).toBeInTheDocument();
  });

  it('subir.panel.local_503_manda_a_clean_cut', async () => {
    montar({ estado: () => Promise.resolve(json({ detail: 'solo en el servicio' }, 503)) });
    render(<Subir />);
    expect(
      await screen.findByText('En esta instalación local el corte se hace con /clean-cut desde Claude Code.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Proponer/ })).toBeNull();
  });

  it('subir.panel.un_solo_principal', async () => {
    const ambar = () => [...document.querySelectorAll('button, a')].filter(b => b.className.includes('bg-ambar'));
    irA(null);
    montar();
    const { unmount } = render(<Subir />);
    await screen.findByRole('button', { name: 'Subir' });
    // sin metraje, lo que sigue es subirlo
    expect(ambar().map(b => b.textContent)).toEqual(['Subir']);
    unmount();
    irA('podcast');
    render(<Subir />);
    await screen.findByRole('button', { name: 'Proponer ✦ 17' });
    // con metraje, la acción del Editor IA y Subir pasa a secundario
    expect(ambar().map(b => b.textContent)).toEqual(['Proponer ✦ 17']);
  });

  it('subir.panel.textos_del_server_como_texto', async () => {
    irA('<img src=x onerror=alert(1)>');
    montar({ estado: () => Promise.resolve(json({ detail: '<b>roto</b>' }, 404)) });
    render(<Subir />);
    expect(await screen.findByText('<b>roto</b>')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Tu video/ })).toHaveTextContent('<img src=x onerror=alert(1)>');
    expect(document.querySelector('img, b')).toBeNull();
    // y el error deja reintentar
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  });
});

describe('la espera', () => {
  it('subir.espera.sondea_mientras_corre_y_para_al_terminar', async () => {
    const cobros = oirCobros();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let st: EstadoEditar = CORRIENDO;
    const f = montar({ estado: () => st });
    render(<Subir />);
    await screen.findByText('Revisando tu metraje · transcribir y proponer el corte');
    const gets = () => llamadas(f, '/api/editar/podcast', 'GET').length;
    const antes = gets();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(gets()).toBe(antes + 1);
    st = LISTO;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(await screen.findByRole('link', { name: /Editar/ })).toBeInTheDocument();
    const alTerminar = gets();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60000);
    });
    expect(gets()).toBe(alTerminar);
    // si falló o no encontró relleno, hubo devolución: el saldo se refresca
    expect(monedero.refrescar).toHaveBeenCalled();
    expect(cobros).toEqual([]); // pero una devolución no vuela como un cobro
  });

  it('subir.espera.sin_red_con_la_corrida_viva_sigue_reintentando', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let red = true;
    montar({ estado: () => (red ? CORRIENDO : (sinRed() as Promise<Response>)) });
    render(<Subir />);
    await screen.findByText('Revisando tu metraje · transcribir y proponer el corte');
    red = false;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(await screen.findByText(/Sin conexión — reintentando/)).toBeInTheDocument();
    // la corrida sigue a la vista
    expect(screen.getByText('Revisando tu metraje · transcribir y proponer el corte')).toBeInTheDocument();
    red = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20000);
    });
    await waitFor(() => expect(screen.queryByText(/Sin conexión/)).toBeNull());
  });

  it('subir.espera.titulo_de_la_pestana_dice_revisando', async () => {
    montar({ estado: () => CORRIENDO });
    render(<Subir />);
    await waitFor(() => expect(document.title).toBe('Revisando tu metraje · Estudio de video · Editar'));
  });

  it('subir.espera.el_orbe_ocupa_el_sitio_de_la_animacion', async () => {
    let st: EstadoEditar = CON_FUENTE;
    montar({ estado: () => st });
    const { unmount } = render(<Subir />);
    await screen.findByRole('button', { name: 'Proponer ✦ 17' });
    expect(document.querySelector('.anim-editor')).not.toBeNull();
    unmount();
    st = CORRIENDO;
    render(<Subir />);
    await screen.findByText('Revisando tu metraje · transcribir y proponer el corte');
    expect(document.querySelector('.anim-editor')).toBeNull();
    // la de shorts es decoración que corre siempre
    expect(document.querySelector('.anim-shorts')).not.toBeNull();
  });
});

describe('el marco', () => {
  it('subir.marco.enlace_estudio_sin_version_anterior', async () => {
    montar();
    render(<Subir />);
    expect(screen.queryByRole('link', { name: 'Usar la versión anterior' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Estudio' })).toHaveAttribute('href', '/estudio/');
    await screen.findByRole('button', { name: 'Proponer ✦ 17' });
  });
});
