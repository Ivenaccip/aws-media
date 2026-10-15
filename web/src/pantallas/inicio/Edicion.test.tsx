// La caja de «Edición» del inicio (E1), como COMPORTAMIENTO. Cada test empieza por el ID de su
// invariante: tests/test_migracion_ui.py exige que cada ID del registro exista aquí.
//
// Nada de esto gasta dinero: el servidor, la subida a S3 (XHR) y el cobro son dobles. Se prueba
// la Caja sola (donde vive el estado) y, para lo de «ninguna petición al montar», el Inicio entero.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRef, StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import { contraste } from '../../nucleo/contraste';
import { editar, shorts } from '../../nucleo/tarifas';
import { json, llamadas, oirCobros, ponerAvisos, ponerMonedero, servidor, sinRed, type Ruta } from '../../prueba/servidor';
import { Boton } from '../../ui/Boton';
import { nombreValido } from '../../nucleo/subida';
import { Caja, type MandoCaja } from './Caja';
import {
  AVISO_OCUPADO,
  AVISO_SIN_VIDEO,
  AYUDA_TEXTO,
  AYUDA_VIDEO,
  EJEMPLO_FIJO,
  estadoDelBoton,
  faltanTras402,
  huecoDe,
  IDEAS_EDICION,
  limpiarInstruccion,
  MODOS_EDICION,
  NOTA_CALCULANDO,
  NOTA_SIN_PRECIO,
  NOTA_SUBIENDO,
  nombreDeProyecto,
  PISTA_CADA_MS,
  PISTA_FUNDIDO_MS,
  reloj,
  tamano,
} from './edicion';
import { rechazoVideo, soloVideos, type CostoEdicion } from './envio';
import { Inicio } from './Inicio';

// los tokens de la carta, tal cual (un `?raw` de un .css lo procesa el plugin de Tailwind y llega vacío; como en Confirmar.test)
const tokens = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../estilos/tokens.css'), 'utf8');

// 12:04 sin transcripción: ✦ 2 de la propuesta + ✦ 6 de transcribir 3 bloques de 5 min (tools/tarifas.json)
const COSTO_8: CostoEdicion = {
  fuente: 'videos/entrevista/subidas/entrevista.mp4',
  duracion_s: 724,
  con_transcript: false,
  creditos: 8,
  backend_listo: true,
  aviso: null,
};
// ya trae transcripción: solo la propuesta
const COSTO_2: CostoEdicion = { ...COSTO_8, creditos: 2, con_transcript: true, duracion_s: 72 };
const FUERA: CostoEdicion = {
  ...COSTO_8,
  duracion_s: 40,
  creditos: 2,
  backend_listo: false,
  aviso: 'Este video dura menos de 1 min: un video tan corto no tiene relleno que recortar.',
};
const TEXTO = 'Quítale las muletillas y los silencios';

// el PUT a S3 va por XHR (para tener progreso): uno de mentira que el test mueve
class XhrFalso {
  static todos: XhrFalso[] = [];
  metodo = '';
  url = '';
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
  setRequestHeader() {}
  send() {}
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

interface Mundo {
  /** El precio por proyecto; o el servidor responde otra cosa (o tarda: una promesa). */
  costo?: (proyecto: string) => CostoEdicion | Response | Promise<CostoEdicion | Response>;
  /** Lo que el servidor ya tiene subido en ese proyecto (GET /api/media/<p>): vacío si el nombre es nuevo. */
  subidas?: (proyecto: string) => unknown[] | Response;
  presign?: Ruta;
  confirmar?: Ruta;
  sugerir?: Ruta;
  /** GET /api/editar/<p>: la corrida. */
  estado?: Ruta;
  moderar?: Ruta;
  config?: boolean;
}

function montar(m: Mundo = {}) {
  return servidor({
    '/api/media/config': () => json({ activo: m.config ?? true, cdn: '' }),
    '/api/media/presign':
      m.presign ??
      ((_u, init) => {
        const b = JSON.parse(String(init?.body)) as { proyecto: string; archivo: string; content_type: string };
        return json({ url: 'https://s3.ejemplo/subida?firma=1', key: `videos/${b.proyecto}/subidas/${b.archivo}`, content_type: b.content_type });
      }),
    '/api/media/confirmar': m.confirmar ?? (() => json({ archivo: 'entrevista.mp4', cdn: '' })),
    // GET /api/media/<proyecto>: lo ya subido (la ruta más corta pierde ante config, presign y confirmar)
    '/api/media': url => {
      const r = (m.subidas ?? (() => []))(decodeURIComponent(url.split('/')[3]!));
      return r instanceof Response ? r : json({ subidas: r });
    },
    '/api/moderar': m.moderar ?? (() => json({ permitido: true })),
    '/api/editar': async (url, init) => {
      if (url.endsWith('/costo')) {
        const proyecto = decodeURIComponent(url.split('/')[3]!);
        const c = await (m.costo ?? (() => COSTO_8))(proyecto);
        return c instanceof Response ? c : json(c);
      }
      if (url.endsWith('/sugerir')) return (m.sugerir ?? (() => json({ lanzado: true, creditos: 8 })))(url, init);
      return (m.estado ?? (() => json({ editar: { estado: 'corriendo' } })))(url, init);
    },
  });
}

let ir: ReturnType<typeof vi.fn<(url: string) => void>>;

beforeEach(() => {
  vi.unstubAllGlobals();
  XhrFalso.todos = [];
  vi.stubGlobal('XMLHttpRequest', XhrFalso);
  ir = vi.fn<(url: string) => void>();
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  history.replaceState(null, '', '/estudio/inicio/');
});

afterEach(() => {
  vi.useRealTimers();
  delete window.monedero;
});

function video(nombre = 'entrevista.mp4', tipo = 'video/mp4', bytes = 824_000_000) {
  const f = new File(['x'], nombre, { type: tipo });
  Object.defineProperty(f, 'size', { value: bytes });
  return f;
}

const pintar = () => render(<Caja ir={ir} />);
const entrada = () => document.querySelector<HTMLInputElement>('input[type="file"]')!;
const campo = () => screen.getByRole('textbox', { name: 'Cuéntale a la IA qué quieres' });
const botonIniciar = () => screen.getByRole('button', { name: /^(Iniciar|Subiendo|Calculando|Iniciando)/ });
// el chip «Editar ▾» junto al «+»: el mismo SelectorOpcion que Imagen y Video (su nombre es «Editar»: la ▾ es decoración)
const chipModo = () => screen.getByRole('button', { name: 'Editar' });
/**
 * ¿El botón principal se ve ámbar —el «dorado» del dueño, como «Crear»— y no el gris discontinuo del apagado de la carta
 * (§5)? Las clases con variante (`disabled:border-dashed`…) vienen en todo principal; se miran las que no la llevan.
 */
const esDorado = (b: HTMLElement) => {
  const clases = b.className.split(/\s+/);
  return clases.includes('bg-ambar') && !clases.some(c => ['border-dashed', 'bg-superficie', 'text-secundario'].includes(c));
};
const botonMas = () => screen.getByRole('button', { name: /^(Agregar el video que quieres editar|Cambiar el video)$/ });
const riel = () => within(screen.getByRole('group', { name: 'Qué quieres crear' }));
const dicho = (a: ReturnType<typeof ponerAvisos>) => a.mostrar.mock.calls.map(c => ({ texto: c[0], ...c[1] }));
const cuerpoDe = (f: ReturnType<typeof montar>, ruta: string) => JSON.parse(llamadas(f, ruta)[0]![1]!.body as string) as Record<string, unknown>;

async function irAEdicion() {
  await userEvent.click(riel().getByRole('button', { name: 'Edición' }));
}

/** Elige el video y deja la subida a medias: el PUT a S3 ya salió. */
async function empezarSubida(f = video()) {
  const antes = XhrFalso.todos.length;
  await userEvent.upload(entrada(), f);
  await waitFor(() => expect(XhrFalso.todos).toHaveLength(antes + 1));
  return ultimoXhr();
}

/** Termina el PUT: confirma y pide el precio. */
async function terminarSubida() {
  await act(async () => {
    ultimoXhr().terminar();
  });
}

/** Hasta tener el video subido y con precio (la caja de Edición ya abierta). */
async function conVideoListo(f = video()) {
  await empezarSubida(f);
  await terminarSubida();
  // «Subiendo…» y «Calculando…» pasan; queda «Iniciar…» (con precio, sin él o con el aviso del servidor)
  await waitFor(() => expect(botonIniciar().textContent).toMatch(/^Iniciar/));
}

const ALTO_44 = /^(min-h-(11|12|14|16)|size-(11|12)|h-(11|12))$/;
const mide44 = (el: HTMLElement) => el.className.split(/\s+/).some(c => ALTO_44.test(c));

describe('la caja de Edición', () => {
  it('inicio.edicion.el_riel_tiene_tres_familias_con_aria_pressed_y_arranca_en_video', async () => {
    montar();
    pintar();
    const botones = riel().getAllByRole('button');
    expect(botones.map(b => b.textContent)).toEqual(['Imagen', 'Video', 'Edición']);
    // arranca en Video, como siempre (inicio.caja.arranca_en_el_clip_lo_mas_barato)
    expect(riel().getByRole('button', { name: 'Video' })).toHaveAttribute('aria-pressed', 'true');
    expect(riel().getByRole('button', { name: 'Edición' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('textbox', { name: 'Cuéntale a la IA qué quieres' })).toBeNull();
    await irAEdicion();
    expect(riel().getByRole('button', { name: 'Edición' })).toHaveAttribute('aria-pressed', 'true');
    expect(riel().getByRole('button', { name: 'Video' })).toHaveAttribute('aria-pressed', 'false');
    expect(riel().getByRole('button', { name: 'Imagen' })).toHaveAttribute('aria-pressed', 'false');
    // el título de la caja sigue siendo el de siempre; el campo es obligatorio y dice lo que se espera
    expect(screen.getByRole('heading', { name: '¿Qué vamos a crear hoy?' })).toBeInTheDocument();
    expect(campo()).toHaveAttribute('aria-required', 'true');
    expect(campo()).toHaveAttribute('placeholder', huecoDe(IDEAS_EDICION[0]));
    expect(campo()).toHaveAttribute('maxlength', '2000');
    // Imagen y Video siguen eligiendo su primera opción al volver
    await userEvent.click(riel().getByRole('button', { name: 'Imagen' }));
    expect(screen.getByRole('button', { name: /Crear una imagen/ })).toBeInTheDocument();
    await irAEdicion();
    await userEvent.click(riel().getByRole('button', { name: 'Video' }));
    expect(screen.getByRole('button', { name: /Un video corto/ })).toBeInTheDocument();
  });

  it('inicio.edicion.sin_video_el_boton_es_iniciar_sin_precio_dorado_enfocable_y_avisa', async () => {
    const avisos = ponerAvisos();
    const f = montar();
    pintar();
    await irAEdicion();
    const boton = botonIniciar();
    expect(boton).toHaveTextContent(/^Iniciar$/);
    expect(boton).not.toHaveTextContent('✦');
    // dorado, como «Crear» (dueño, 14-oct-2026), y sin `disabled`: sigue enfocable, y explica en vez de callar
    expect(esDorado(boton)).toBe(true);
    expect(boton).toHaveAttribute('aria-disabled', 'true');
    expect(boton).not.toBeDisabled();
    boton.focus();
    expect(boton).toHaveFocus();
    expect(screen.getByText('Escribe qué quieres hacer con tu video.')).toBeInTheDocument();
    await userEvent.click(boton);
    expect(dicho(avisos)).toEqual([{ texto: AVISO_SIN_VIDEO, tipo: 'mal', clave: 'caja' }]);
    expect(AVISO_SIN_VIDEO).toBe('Primero agrega el video: pulsa el «+» o arrástralo a la caja.');
    expect(f).not.toHaveBeenCalled();
  });

  // NAV-05 del prototipo: el cuadro de avisos es de toda la página. La tarjeta del inicio esconde la caja (`enVista` falso) al abrir el
  // mapa o una lista, y un error de ella no puede quedarse flotando ahí. No se esconde para volver a ponerlo: se quita (al volver, «Iniciar»
  // lo repite). Los avisos verdes del trabajo en marcha no son errores de la caja y se quedan (Recorrido.test.tsx lo prueba entero).
  it('el error de «Iniciar» sin video sale del cuadro de avisos cuando la caja se esconde, y no vuelve solo al verse otra vez', async () => {
    const avisos = ponerAvisos();
    montar();
    const { rerender } = render(<Caja ir={ir} enVista />);
    await irAEdicion();
    await userEvent.click(botonIniciar());
    expect(dicho(avisos)).toEqual([{ texto: AVISO_SIN_VIDEO, tipo: 'mal', clave: 'caja' }]);
    expect(avisos.quitar).not.toHaveBeenCalled();
    rerender(<Caja ir={ir} enVista={false} />);
    expect(avisos.quitar).toHaveBeenCalledExactlyOnceWith('caja');
    rerender(<Caja ir={ir} enVista />);
    expect(dicho(avisos)).toHaveLength(1);
    expect(avisos.quitar).toHaveBeenCalledTimes(1);
  });

  it('inicio.edicion.con_texto_y_sin_video_la_ayuda_dice_donde_agregarlo', async () => {
    montar();
    pintar();
    await irAEdicion();
    await userEvent.type(campo(), TEXTO);
    expect(screen.getByText('Agrega el video con el «+» o arrástralo a la caja.')).toBeInTheDocument();
    expect(screen.queryByText('Escribe qué quieres hacer con tu video.')).toBeNull();
    expect(botonIniciar()).toHaveAttribute('aria-disabled', 'true');
  });

  it('inicio.edicion.subir_muestra_progreso_real_y_el_precio_llega_del_servidor_al_terminar', async () => {
    const f = montar({ costo: () => ({ ...COSTO_8, creditos: 17 }) });
    pintar();
    await irAEdicion();
    expect(botonMas()).toHaveAccessibleName('Agregar el video que quieres editar');
    const xhr = await empezarSubida();
    // el nombre del proyecto sale del archivo; la persona no lo teclea
    expect(cuerpoDe(f, '/api/media/presign')).toMatchObject({ proyecto: 'entrevista', archivo: 'entrevista.mp4', content_type: 'video/mp4', bytes: 824_000_000 });
    expect(xhr.url).toBe('https://s3.ejemplo/subida?firma=1');
    // la tarjeta: nombre, formato y tamaño; la duración la mide el servidor, aún no se sabe
    expect(screen.getByText('entrevista.mp4')).toBeInTheDocument();
    expect(screen.getByText('MP4 · 824 MB')).toBeInTheDocument();
    expect(screen.getByText('Se edita una copia. Tu original se queda como está.')).toBeInTheDocument();
    // progreso de verdad, y el botón no promete un precio que aún no existe
    act(() => xhr.avanzar(412_000_000, 824_000_000));
    expect(screen.getByRole('progressbar', { name: 'Subiendo el video' })).toHaveAttribute('aria-valuenow', '50');
    expect(screen.getByText('Subiendo… 50 %. No cierres esta pestaña.')).toBeInTheDocument();
    expect(botonIniciar()).toHaveTextContent(/^Subiendo…$/);
    expect(botonIniciar()).not.toHaveTextContent('✦');
    expect(screen.getByText('Cuando termine de subir calculamos el precio. Hasta entonces no se cobra nada.')).toBeInTheDocument();
    expect(llamadas(f, '/api/editar/entrevista/costo', 'GET')).toHaveLength(0);
    expect(llamadas(f, '/api/media/confirmar')).toHaveLength(0);
    await terminarSubida();
    // ya subió: se confirma y se pregunta el precio al servidor (el 17 de la prueba no está en ninguna tarifa)
    await screen.findByRole('button', { name: 'Iniciar ✦ 17' });
    expect(cuerpoDe(f, '/api/media/confirmar')).toEqual({ proyecto: 'entrevista', key: 'videos/entrevista/subidas/entrevista.mp4' });
    expect(llamadas(f, '/api/editar/entrevista/costo', 'GET')).toHaveLength(1);
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.getByText('12:04 · MP4 · 824 MB')).toBeInTheDocument();
  });

  it('inicio.edicion.el_precio_del_servidor_8_sin_transcript_y_2_con_transcript', async () => {
    // la fórmula del servidor (pipeline/creditos.py) sobre tools/tarifas.json: ✦ 2 de la propuesta + ✦ 2 por bloque de 5 min
    expect(COSTO_8.creditos).toBe(editar.sugerencias + shorts.transcripcion_por_5min * Math.ceil(724 / 300));
    expect(COSTO_2.creditos).toBe(editar.sugerencias);
    montar({ costo: p => (p === 'entrevista' ? COSTO_8 : COSTO_2) });
    pintar();
    await irAEdicion();
    await conVideoListo(video('entrevista.mp4'));
    expect(botonIniciar()).toHaveTextContent('Iniciar ✦ 8');
    await userEvent.click(screen.getByRole('button', { name: 'Quitar este video' }));
    await conVideoListo(video('con-transcript.mp4'));
    expect(botonIniciar()).toHaveTextContent('Iniciar ✦ 2');
  });

  it('inicio.edicion.sin_texto_el_boton_con_precio_sigue_enfocable_lleva_el_foco_al_campo_y_no_avisa', async () => {
    const avisos = ponerAvisos();
    montar();
    pintar();
    await irAEdicion();
    await conVideoListo();
    const boton = screen.getByRole('button', { name: 'Iniciar ✦ 8' });
    expect(boton).toHaveAttribute('aria-disabled', 'true');
    expect(boton).not.toBeDisabled();
    expect(esDorado(boton)).toBe(true);
    expect(boton).toHaveAccessibleDescription('Escribe qué quieres hacer con tu video.');
    expect(screen.getByText('Escribe qué quieres hacer con tu video.')).toBeInTheDocument();
    await userEvent.click(boton);
    expect(campo()).toHaveFocus();
    expect(avisos.mostrar).not.toHaveBeenCalled();
    // escribir lo enciende...
    await userEvent.type(campo(), TEXTO);
    expect(screen.getByRole('button', { name: 'Iniciar ✦ 8' })).not.toHaveAttribute('aria-disabled');
    // ...y vaciar el campo lo apaga otra vez
    await userEvent.clear(campo());
    expect(screen.getByRole('button', { name: 'Iniciar ✦ 8' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('inicio.edicion.un_aviso_del_servidor_apaga_el_boton_sin_precio_y_lleva_el_foco_al_mas', async () => {
    const avisos = ponerAvisos();
    montar({ costo: () => FUERA });
    pintar();
    await irAEdicion();
    await conVideoListo();
    const boton = botonIniciar();
    // el aviso del servidor sale tal cual, y sin precio: no se promete lo que no se puede
    expect(boton).toHaveTextContent(/^Iniciar$/);
    expect(screen.getByText(FUERA.aviso!)).toBeInTheDocument();
    expect(boton).toHaveAttribute('aria-disabled', 'true');
    expect(esDorado(boton)).toBe(true);
    expect(boton).toHaveAccessibleDescription(expect.stringContaining(FUERA.aviso!));
    await userEvent.type(campo(), TEXTO);
    expect(botonIniciar()).toHaveAttribute('aria-disabled', 'true'); // el texto no lo enciende
    await userEvent.click(botonIniciar());
    expect(botonMas()).toHaveFocus();
    expect(avisos.mostrar).not.toHaveBeenCalled();
  });

  it('inicio.edicion.lanzar_manda_solo_la_instruccion_y_vacia_la_caja_y_refresca_el_saldo', async () => {
    const avisos = ponerAvisos();
    const monedero = ponerMonedero(269);
    const cobros = oirCobros();
    const f = montar();
    pintar();
    await irAEdicion();
    await conVideoListo();
    await userEvent.type(campo(), `  ${TEXTO}  `);
    // el precio y el saldo, antes de pulsar
    expect(screen.getByText('Tienes ✦ 269; después te quedan ✦ 261.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Iniciar ✦ 8' }));
    await waitFor(() => expect(llamadas(f, '/api/editar/entrevista/sugerir')).toHaveLength(1));
    // solo viaja lo que la persona escribió (recortado): el servidor decide el precio y cobra
    expect(cuerpoDe(f, '/api/editar/entrevista/sugerir')).toEqual({ instruccion: TEXTO });
    // y la instrucción se moderó ANTES de la petición que cobra (M13)
    const orden = f.mock.calls.map(c => c[0]);
    expect(orden.indexOf('/api/moderar')).toBeGreaterThan(-1);
    expect(orden.indexOf('/api/moderar')).toBeLessThan(orden.indexOf('/api/editar/entrevista/sugerir'));
    // la caja queda vacía, el saldo se pone al día y el «−N» vuela con lo que cobró el servidor
    await waitFor(() => expect(campo()).toHaveValue(''));
    expect(screen.queryByText('entrevista.mp4')).toBeNull();
    expect(botonIniciar()).toHaveTextContent(/^Iniciar$/);
    expect(monedero.refrescar).toHaveBeenCalled();
    expect(cobros.map(c => c.costo)).toEqual([8]);
    // el «−N» sale del botón principal (su ref): sin ella el número volaría desde ninguna parte
    expect(cobros[0]!.rect).not.toBeNull();
    expect(dicho(avisos)).toEqual([{ texto: 'Ya estamos editando tu video. Sigue el avance en «Tus trabajos».', tipo: 'ok', clave: 'caja' }]);
    // el foco no se pierde al vaciarse la caja: es el mismo botón
    expect(botonIniciar()).toHaveFocus();
  });

  it('inicio.edicion.doble_clic_en_iniciar_es_una_sola_peticion', async () => {
    ponerMonedero(100);
    let soltar!: () => void;
    const espera = new Promise<void>(r => (soltar = r));
    const f = montar({
      sugerir: async () => {
        await espera;
        return json({ lanzado: true, creditos: 8 });
      },
    });
    pintar();
    await irAEdicion();
    await conVideoListo();
    await userEvent.type(campo(), TEXTO);
    const boton = screen.getByRole('button', { name: 'Iniciar ✦ 8' });
    // dos clics en el mismo tic, antes de que React repinte: el candado se cierra antes del primer await
    act(() => {
      boton.click();
      boton.click();
    });
    await waitFor(() => expect(llamadas(f, '/api/editar/entrevista/sugerir')).toHaveLength(1));
    expect(llamadas(f, '/api/moderar')).toHaveLength(1);
    // y mientras espera, el botón lo dice y no acepta otro
    expect(botonIniciar()).toHaveTextContent('Iniciando…');
    expect(screen.queryByText('Editando…')).toBeNull();
    await userEvent.click(botonIniciar());
    soltar();
    await waitFor(() => expect(campo()).toHaveValue(''));
    expect(llamadas(f, '/api/editar/entrevista/sugerir')).toHaveLength(1);
  });

  it('inicio.edicion.sin_saldo_el_boton_se_apaga_y_dice_cuanto_falta_con_recargar', async () => {
    const avisos = ponerAvisos();
    ponerMonedero(5);
    const f = montar();
    pintar();
    await irAEdicion();
    await conVideoListo();
    await userEvent.type(campo(), TEXTO);
    const boton = screen.getByRole('button', { name: 'Iniciar ✦ 8' });
    expect(boton).toHaveAttribute('aria-disabled', 'true');
    expect(esDorado(boton)).toBe(true); // sin saldo tampoco se pinta gris: la nota de abajo dice cuánto falta
    expect(screen.getByText('Tienes ✦ 5: no alcanza para editar este video.')).toBeInTheDocument();
    expect(screen.getByText(/Te faltan ✦ 3/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Recargar' })).toBeInTheDocument();
    await userEvent.click(boton);
    expect(llamadas(f, '/api/editar/entrevista/sugerir')).toHaveLength(0);
    expect(avisos.mostrar).not.toHaveBeenCalled();
  });

  it('inicio.edicion.402_del_servidor_dice_te_faltan_y_no_cobra_ni_vacia_la_caja', async () => {
    const monedero = ponerMonedero(100); // la píldora creía que alcanzaba; el servidor sabe que no
    const cobros = oirCobros();
    const f = montar({
      sugerir: () => json({ detail: 'Créditos insuficientes: esta acción cuesta 8 créditos y tu saldo es 5.' }, 402),
    });
    pintar();
    await irAEdicion();
    await conVideoListo();
    await userEvent.type(campo(), TEXTO);
    await userEvent.click(screen.getByRole('button', { name: 'Iniciar ✦ 8' }));
    expect(await screen.findByText(/Te faltan ✦ 3/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Recargar' })).toBeInTheDocument();
    expect(monedero.refrescar).toHaveBeenCalled();
    // nada se cobró: ningún «−N», y el video y el texto siguen para reintentar
    expect(cobros).toHaveLength(0);
    expect(campo()).toHaveValue(TEXTO);
    expect(screen.getByText('entrevista.mp4')).toBeInTheDocument();
    expect(llamadas(f, '/api/editar/entrevista/sugerir')).toHaveLength(1);
    // y el botón se puede volver a pulsar (el 402 no lo deja trabajando)
    expect(screen.getByRole('button', { name: 'Iniciar ✦ 8' })).not.toHaveAttribute('aria-busy');
  });

  it('inicio.edicion.402_con_la_recarga_cerrada_dice_la_salida_de_la_interfaz', async () => {
    ponerMonedero(100, false);
    montar({ sugerir: () => json({ detail: 'Créditos insuficientes: esta acción cuesta 8 créditos y tu saldo es 5.' }, 402) });
    pintar();
    await irAEdicion();
    await conVideoListo();
    await userEvent.type(campo(), TEXTO);
    await userEvent.click(screen.getByRole('button', { name: 'Iniciar ✦ 8' }));
    await screen.findByText(/Te faltan ✦ 3/);
    // un botón «Recargar» que no hace nada es peor que ninguno: sale el texto del monedero
    expect(screen.queryByRole('button', { name: 'Recargar' })).toBeNull();
    expect(screen.getByText('Escríbenos por el canal de la comunidad para conseguir más.')).toBeInTheDocument();
  });

  it('inicio.edicion.502_avisa_y_refresca_el_saldo_porque_el_servidor_devolvio_los_creditos', async () => {
    const avisos = ponerAvisos();
    const monedero = ponerMonedero(100);
    const cobros = oirCobros();
    montar({ sugerir: () => json({ detail: 'No se pudo lanzar la corrida: sin capacidad' }, 502) });
    pintar();
    await irAEdicion();
    await conVideoListo();
    await userEvent.type(campo(), TEXTO);
    await userEvent.click(screen.getByRole('button', { name: 'Iniciar ✦ 8' }));
    await waitFor(() => expect(dicho(avisos).at(-1)).toEqual({ texto: 'No se pudo lanzar la corrida: sin capacidad', tipo: 'mal', clave: 'caja' }));
    expect(monedero.refrescar).toHaveBeenCalled();
    expect(cobros).toHaveLength(0);
    // el texto y el video siguen ahí para reintentar
    expect(campo()).toHaveValue(TEXTO);
    expect(screen.getByRole('button', { name: 'Iniciar ✦ 8' })).toBeInTheDocument();
  });

  it('inicio.edicion.un_gate_del_servidor_se_dice_tal_cual_y_no_se_empieza_otra_cosa', async () => {
    const avisos = ponerAvisos();
    ponerMonedero(100);
    montar({ sugerir: () => json({ detail: 'Ese video dura más de 90 min.' }, 413) });
    pintar();
    await irAEdicion();
    await conVideoListo();
    await userEvent.type(campo(), TEXTO);
    await userEvent.click(screen.getByRole('button', { name: 'Iniciar ✦ 8' }));
    await waitFor(() => expect(dicho(avisos).at(-1)).toEqual({ texto: 'Ese video dura más de 90 min.', tipo: 'mal', clave: 'caja' }));
    expect(campo()).toHaveValue(TEXTO);
  });

  it('inicio.edicion.si_otra_cuenta_tiene_el_nombre_se_reintenta_una_vez_con_nombre_alterno', async () => {
    let intento = 0;
    const f = montar({
      presign: (_u, init) => {
        const b = JSON.parse(String(init?.body)) as { proyecto: string; archivo: string; content_type: string };
        if (++intento === 1) return json({ detail: 'El nombre «entrevista» ya lo usa otra cuenta.' }, 409);
        return json({ url: 'https://s3.ejemplo/subida', key: `videos/${b.proyecto}/subidas/${b.archivo}`, content_type: b.content_type });
      },
    });
    pintar();
    await irAEdicion();
    await empezarSubida();
    const nombres = llamadas(f, '/api/media/presign').map(c => (JSON.parse(String(c[1]!.body)) as { proyecto: string }).proyecto);
    expect(nombres).toHaveLength(2);
    expect(nombres[0]).toBe('entrevista');
    expect(nombres[1]).toMatch(/^entrevista-[0-9a-f]{4}$/);
    await terminarSubida();
    // el precio se pide por el proyecto con el nombre que sí se pudo reservar
    await screen.findByRole('button', { name: 'Iniciar ✦ 8' });
    expect(llamadas(f, `/api/editar/${nombres[1]}/costo`, 'GET')).toHaveLength(1);
  });

  it('inicio.edicion.un_409_que_se_repite_no_reintenta_otra_vez_y_lo_dice', async () => {
    const avisos = ponerAvisos();
    const f = montar({ presign: () => json({ detail: 'El nombre ya lo usa otra cuenta.' }, 409) });
    pintar();
    await irAEdicion();
    await userEvent.upload(entrada(), video());
    await waitFor(() => expect(dicho(avisos).at(-1)).toEqual({ texto: 'El nombre ya lo usa otra cuenta.', tipo: 'mal', clave: 'caja' }));
    expect(llamadas(f, '/api/media/presign')).toHaveLength(2); // una vez y UN reintento
    expect(XhrFalso.todos).toHaveLength(0);
    expect(screen.queryByText('entrevista.mp4')).toBeNull();
  });

  it('inicio.edicion.una_tarea_a_la_vez_avisa_durante_la_subida_y_durante_la_corrida', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const avisos = ponerAvisos();
    const monedero = ponerMonedero(100);
    let corriendo = true;
    const f = montar({ estado: () => json({ editar: { estado: corriendo ? 'corriendo' : 'listo' } }) });
    pintar();
    await irAEdicion();
    // durante la subida: ni el «+» ni «Iniciar» empiezan otra cosa
    await empezarSubida();
    await userEvent.click(botonMas());
    expect(dicho(avisos).at(-1)).toEqual({ texto: AVISO_OCUPADO, tipo: 'mal', clave: 'caja' });
    expect(AVISO_OCUPADO).toBe('Ya hay un trabajo en curso. Cuando termine puedes empezar otro.');
    expect(botonMas()).toHaveAttribute('aria-disabled', 'true');
    avisos.mostrar.mockClear();
    await userEvent.click(botonIniciar());
    expect(dicho(avisos)).toEqual([{ texto: AVISO_OCUPADO, tipo: 'mal', clave: 'caja' }]);
    await terminarSubida();
    await screen.findByRole('button', { name: /^Iniciar ✦ 8$/ });
    // hasta aquí no se ha preguntado por ninguna corrida: el sondeo es perezoso
    expect(llamadas(f, '/api/editar/entrevista', 'GET')).toHaveLength(0);
    await userEvent.type(campo(), TEXTO);
    await userEvent.click(screen.getByRole('button', { name: 'Iniciar ✦ 8' }));
    await waitFor(() => expect(campo()).toHaveValue(''));
    expect(llamadas(f, '/api/editar/entrevista', 'GET')).toHaveLength(0);
    // la corrida sigue: el «+» avisa en vez de abrir el selector
    avisos.mostrar.mockClear();
    await userEvent.click(botonMas());
    expect(dicho(avisos)).toEqual([{ texto: AVISO_OCUPADO, tipo: 'mal', clave: 'caja' }]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5100);
    });
    expect(llamadas(f, '/api/editar/entrevista', 'GET')).toHaveLength(1);
    avisos.mostrar.mockClear();
    await userEvent.click(botonMas());
    expect(dicho(avisos)).toHaveLength(1); // sigue corriendo
    // termina: el saldo se pone al día (por si se devolvió algo) y ya se puede empezar otra
    corriendo = false;
    monedero.refrescar.mockClear();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5100);
    });
    expect(monedero.refrescar).toHaveBeenCalled();
    avisos.mostrar.mockClear();
    await userEvent.click(botonMas());
    expect(avisos.mostrar).not.toHaveBeenCalled();
    // y deja de preguntar
    const lecturas = llamadas(f, '/api/editar/entrevista', 'GET').length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(11000);
    });
    expect(llamadas(f, '/api/editar/entrevista', 'GET')).toHaveLength(lecturas);
  });

  it('inicio.edicion.un_409_de_ya_corre_pasa_a_una_tarea_en_curso', async () => {
    const avisos = ponerAvisos();
    ponerMonedero(100);
    montar({ sugerir: () => json({ detail: 'La corrida ya está en curso — espera a que termine' }, 409) });
    pintar();
    await irAEdicion();
    await conVideoListo();
    await userEvent.type(campo(), TEXTO);
    await userEvent.click(screen.getByRole('button', { name: 'Iniciar ✦ 8' }));
    await waitFor(() => expect(dicho(avisos).at(-1)).toEqual({ texto: 'La corrida ya está en curso — espera a que termine', tipo: 'mal', clave: 'caja' }));
    // la pantalla también lo sabe: nada empieza hasta que termine
    await userEvent.click(botonMas());
    expect(dicho(avisos).at(-1)).toEqual({ texto: AVISO_OCUPADO, tipo: 'mal', clave: 'caja' });
  });

  it('inicio.edicion.el_aviso_de_trabajo_en_curso_se_quita_solo_cuando_ese_trabajo_termina', async () => {
    // el lienzo lo hace (aviso === 'ocupada' → ''): un aviso que dice «espera» no se queda cuando ya no hay nada que esperar
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const avisos = ponerAvisos();
    ponerMonedero(100);
    let corriendo = true;
    montar({ estado: () => json({ editar: { estado: corriendo ? 'corriendo' : 'listo' } }) });
    pintar();
    await irAEdicion();
    // 1. la subida: el aviso sale al tocar el «+» y se queda mientras sube y calcula el precio...
    await empezarSubida();
    await userEvent.click(botonMas());
    expect(dicho(avisos).at(-1)).toEqual({ texto: AVISO_OCUPADO, tipo: 'mal', clave: 'caja' });
    avisos.quitar.mockClear();
    await act(async () => {
      ultimoXhr().terminar();
    });
    await waitFor(() => expect(botonIniciar()).toHaveTextContent('Iniciar ✦ 8'));
    // ...y se va cuando la subida terminó y ya hay precio
    expect(avisos.quitar).toHaveBeenCalledWith('caja');
    // 2. la corrida: lo mismo, hasta que el servidor dice que terminó
    await userEvent.type(campo(), TEXTO);
    await userEvent.click(screen.getByRole('button', { name: 'Iniciar ✦ 8' }));
    await waitFor(() => expect(campo()).toHaveValue(''));
    await userEvent.click(botonMas());
    expect(dicho(avisos).at(-1)).toEqual({ texto: AVISO_OCUPADO, tipo: 'mal', clave: 'caja' });
    avisos.quitar.mockClear();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5100);
    });
    expect(avisos.quitar).not.toHaveBeenCalled(); // sigue corriendo
    corriendo = false;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5100);
    });
    expect(avisos.quitar).toHaveBeenCalledWith('caja');
    // un aviso que ya no está no se quita dos veces
    avisos.quitar.mockClear();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(11000);
    });
    expect(avisos.quitar).not.toHaveBeenCalled();
  });

  it('inicio.edicion.si_otro_aviso_reemplazo_al_de_trabajo_en_curso_no_se_quita_nada', async () => {
    const avisos = ponerAvisos();
    montar();
    pintar();
    await irAEdicion();
    const xhr = await empezarSubida();
    await userEvent.click(botonMas());
    expect(dicho(avisos).at(-1)).toEqual({ texto: AVISO_OCUPADO, tipo: 'mal', clave: 'caja' });
    avisos.quitar.mockClear();
    // la subida falla: el error toma el lugar del aviso (misma clave) y es lo que la persona tiene que leer
    await act(async () => {
      xhr.terminar(403);
    });
    await waitFor(() => expect(dicho(avisos).at(-1)).toEqual({ texto: 'La subida a la nube falló (403) — intenta de nuevo.', tipo: 'mal', clave: 'caja' }));
    await new Promise(r => setTimeout(r, 30));
    expect(avisos.quitar).not.toHaveBeenCalled();
  });

  it('inicio.edicion.cambiar_de_familia_y_volver_conserva_texto_y_video_y_no_cancela_la_subida', async () => {
    montar();
    pintar();
    await irAEdicion();
    await userEvent.type(campo(), TEXTO);
    const xhr = await empezarSubida();
    act(() => xhr.avanzar(100_000_000, 824_000_000));
    // a Video y a Imagen: la subida sigue
    await userEvent.click(riel().getByRole('button', { name: 'Video' }));
    expect(screen.queryByRole('textbox', { name: 'Cuéntale a la IA qué quieres' })).toBeNull();
    await userEvent.click(riel().getByRole('button', { name: 'Imagen' }));
    expect(xhr.abortado).toBe(false);
    // la subida termina mientras la persona está en otra familia
    await terminarSubida();
    await userEvent.click(riel().getByRole('button', { name: 'Video' }));
    await irAEdicion();
    // al volver: el texto, el video y su precio están ahí
    expect(campo()).toHaveValue(TEXTO);
    expect(screen.getByText('entrevista.mp4')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Iniciar ✦ 8' })).not.toHaveAttribute('aria-disabled');
  });

  it('inicio.edicion.quitar_durante_la_subida_la_cancela_sin_error_y_no_pide_precio', async () => {
    const avisos = ponerAvisos();
    const f = montar();
    pintar();
    await irAEdicion();
    const xhr = await empezarSubida();
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar la subida' }));
    expect(xhr.abortado).toBe(true);
    expect(screen.queryByText('entrevista.mp4')).toBeNull();
    expect(botonMas()).toHaveAccessibleName('Agregar el video que quieres editar');
    expect(botonMas()).toHaveFocus();
    // cancelar no es un error de nadie
    await new Promise(r => setTimeout(r, 20));
    expect(avisos.mostrar).not.toHaveBeenCalled();
    expect(llamadas(f, '/api/media/confirmar')).toHaveLength(0);
    expect(f.mock.calls.some(c => String(c[0]).endsWith('/costo'))).toBe(false);
  });

  it('inicio.edicion.quitar_un_video_listo_deja_la_caja_para_otro', async () => {
    montar();
    pintar();
    await irAEdicion();
    await conVideoListo();
    expect(botonMas()).toHaveAccessibleName('Cambiar el video');
    await userEvent.click(screen.getByRole('button', { name: 'Quitar este video' }));
    expect(screen.queryByText('entrevista.mp4')).toBeNull();
    expect(botonIniciar()).toHaveTextContent(/^Iniciar$/);
    expect(botonMas()).toHaveFocus();
  });

  it('inicio.edicion.soltar_un_video_en_la_caja_lo_sube_y_pegar_se_ignora', async () => {
    const avisos = ponerAvisos();
    montar();
    const { container } = pintar();
    await irAEdicion();
    const seccion = container.querySelector('section')!;
    // soltar archivos que no son video no sube nada y lo dice
    fireEvent.drop(seccion, { dataTransfer: { files: [new File(['x'], 'foto.png', { type: 'image/png' })], types: ['Files'] } });
    expect(XhrFalso.todos).toHaveLength(0);
    expect(dicho(avisos).at(-1)).toEqual({ texto: 'Eso no es un video. Sirven: MP4, MOV o M4V · hasta 5 GB.', tipo: 'mal', clave: 'caja' });
    // un video suelto sube (el nombre del proyecto sale del archivo)
    fireEvent.drop(seccion, { dataTransfer: { files: [video('Mi Entrevista Final.mov', '')], types: ['Files'] } });
    await waitFor(() => expect(XhrFalso.todos).toHaveLength(1));
    expect(screen.getByText('Mi Entrevista Final.mov')).toBeInTheDocument();
    expect(screen.getByText('MOV · 824 MB')).toBeInTheDocument();
    // varios: se toma el primero y se dice
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar la subida' }));
    fireEvent.drop(seccion, { dataTransfer: { files: [video('uno.mp4'), video('dos.mp4')], types: ['Files'] } });
    await waitFor(() => expect(XhrFalso.todos).toHaveLength(2));
    expect(dicho(avisos).at(-1)).toEqual({ texto: 'Por ahora se edita un video a la vez: usamos «uno.mp4».', tipo: 'ok', clave: 'caja' });
    // pegar una imagen o un video NO agrega nada en esta familia
    avisos.mostrar.mockClear();
    // true: nadie cortó el pegado
    expect(fireEvent.paste(campo(), { clipboardData: { files: [new File(['x'], 'captura.png', { type: 'image/png' })], items: [], getData: () => '' } })).toBe(true);
    expect(fireEvent.paste(campo(), { clipboardData: { files: [video('pegado.mp4')], items: [], getData: () => '' } })).toBe(true);
    expect(avisos.mostrar).not.toHaveBeenCalled();
    expect(XhrFalso.todos).toHaveLength(2);
  });

  it('inicio.edicion.un_archivo_que_no_sirve_se_rechaza_con_su_motivo_antes_de_subir', async () => {
    const avisos = ponerAvisos();
    const f = montar();
    pintar();
    await irAEdicion();
    // fireEvent: el selector ya filtra por tipo, pero se pueden soltar o forzar otros
    fireEvent.change(entrada(), { target: { files: [new File(['x'], 'nota.txt', { type: 'text/plain' })] } });
    expect(dicho(avisos).at(-1)).toEqual({ texto: 'Eso no es un video. Sirven: MP4, MOV o M4V · hasta 5 GB.', tipo: 'mal', clave: 'caja' });
    fireEvent.change(entrada(), { target: { files: [video('enorme.mp4', 'video/mp4', 6 * 1024 ** 3)] } });
    expect(dicho(avisos).at(-1)).toEqual({ texto: '«enorme.mp4» pesa demasiado (máximo 5 GB).', tipo: 'mal', clave: 'caja' });
    expect(llamadas(f, '/api/media/presign')).toHaveLength(0);
    expect(XhrFalso.todos).toHaveLength(0);
    // las reglas puras
    expect(rechazoVideo(video('a.MP4'))).toBe('');
    expect(rechazoVideo(video('a.avi'))).toBe('«a.avi» no se puede usar. Sirven: .mp4, .mov, .m4v.');
    expect(soloVideos([video('a.mov', ''), new File(['x'], 'b.png', { type: 'image/png' }), video('c.mp4')]).map(x => x.name)).toEqual(['a.mov', 'c.mp4']);
  });

  it('inicio.edicion.si_no_hay_subidas_en_esta_instalacion_lo_dice_sin_intentar', async () => {
    const avisos = ponerAvisos();
    const f = montar({ config: false });
    pintar();
    await irAEdicion();
    await userEvent.upload(entrada(), video());
    await waitFor(() => expect(dicho(avisos).at(-1)).toEqual({ texto: 'Subir videos no está disponible en esta instalación.', tipo: 'mal', clave: 'caja' }));
    expect(llamadas(f, '/api/media/presign')).toHaveLength(0);
    expect(screen.queryByText('entrevista.mp4')).toBeNull();
  });

  it('inicio.edicion.si_el_precio_no_llega_el_video_se_queda_e_iniciar_lo_vuelve_a_pedir', async () => {
    const avisos = ponerAvisos();
    let falla = true;
    const f = montar({ costo: () => (falla ? new Response(JSON.stringify({ detail: 'Sin conexión con el medidor' }), { status: 503, headers: { 'Content-Type': 'application/json' } }) : COSTO_8) });
    pintar();
    await irAEdicion();
    await empezarSubida();
    await terminarSubida();
    await waitFor(() => expect(dicho(avisos).at(-1)).toEqual({ texto: 'Sin conexión con el medidor', tipo: 'mal', clave: 'caja' }));
    expect(screen.getByText('entrevista.mp4')).toBeInTheDocument();
    expect(botonIniciar()).toHaveTextContent(/^Iniciar$/);
    // sin precio tampoco se pinta apagado (gris, borde discontinuo): sigue dorado y solo avisa con aria-disabled
    expect(esDorado(botonIniciar())).toBe(true);
    expect(botonIniciar()).toHaveAttribute('aria-disabled', 'true');
    expect(botonIniciar()).not.toBeDisabled();
    expect(screen.getByText('No pudimos calcular el precio. Toca «Iniciar» para intentarlo otra vez.')).toBeInTheDocument();
    falla = false;
    await userEvent.click(botonIniciar());
    await screen.findByRole('button', { name: 'Iniciar ✦ 8' });
    expect(llamadas(f, '/api/editar/entrevista/costo', 'GET')).toHaveLength(2);
    expect(llamadas(f, '/api/media/presign')).toHaveLength(1); // no se vuelve a subir
  });

  it('inicio.edicion.una_instruccion_que_la_moderacion_frena_no_llega_al_servidor', async () => {
    const avisos = ponerAvisos();
    ponerMonedero(100);
    const cobros = oirCobros();
    const f = montar({ moderar: () => json({ permitido: false, mensaje: 'La IA no permite violencia explícita.', motivo: 'violencia' }) });
    pintar();
    await irAEdicion();
    await conVideoListo();
    await userEvent.type(campo(), TEXTO);
    await userEvent.click(screen.getByRole('button', { name: 'Iniciar ✦ 8' }));
    await waitFor(() => expect(dicho(avisos).at(-1)).toEqual({ texto: 'La IA no permite violencia explícita.', tipo: 'mal', clave: 'caja' }));
    expect(llamadas(f, '/api/editar/entrevista/sugerir')).toHaveLength(0);
    expect(cobros).toHaveLength(0);
    expect(campo()).toHaveValue(TEXTO);
  });

  it('inicio.edicion.sin_el_cuadro_de_avisos_lo_que_se_dice_sale_junto_a_la_caja', async () => {
    montar();
    pintar();
    await irAEdicion();
    await userEvent.click(botonIniciar());
    expect(screen.getByRole('alert')).toHaveTextContent(AVISO_SIN_VIDEO);
    // corregirlo (agregar el video) quita el error
    await conVideoListo();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('inicio.edicion.todo_lo_tocable_mide_al_menos_44_px', async () => {
    montar();
    pintar();
    await irAEdicion();
    for (const b of riel().getAllByRole('button')) expect(mide44(b), b.textContent ?? '').toBe(true);
    expect(mide44(botonMas())).toBe(true);
    expect(mide44(chipModo())).toBe(true);
    expect(mide44(botonIniciar())).toBe(true);
    await conVideoListo();
    expect(mide44(screen.getByRole('button', { name: 'Quitar este video' }))).toBe(true);
  });

  it('inicio.edicion.ninguna_peticion_al_montar_ni_al_abrir_la_familia', async () => {
    // el Inicio entero: lo que pide al montar es lo de siempre; Edición no suma nada hasta que hay un video
    const f = servidor({
      '/api/proyectos': () => json([]),
      '/api/slots': () => json({ slots: null, activos: 0 }),
      '/api/imagenes': () => json({ total: 0, imagenes: [] }),
      '/api/edicion/proyectos': () => json([]),
      '/api/clip': () => json({ clips: [] }),
      '/api/blotato': () => json({ conectado: false, origen: null, cuentas: [], error: null, plan: null }),
    });
    render(<Inicio ir={ir} />);
    await screen.findByRole('group', { name: 'Qué quieres crear' });
    await userEvent.click(riel().getByRole('button', { name: 'Edición' }));
    expect(campo()).toBeInTheDocument();
    await new Promise(r => setTimeout(r, 30));
    const urls = f.mock.calls.map(c => String(c[0]));
    expect(urls.filter(u => u.startsWith('/api/editar') || u.startsWith('/api/media') || u === '/api/moderar')).toEqual([]);
  });

  it('inicio.edicion.el_boton_apagado_enfocable_no_usa_disabled_ni_opacidad_y_si_recibe_el_clic', async () => {
    // El `apagado` de ui/Boton (el gris discontinuo de la carta §5, pero enfocable) sigue siendo una pieza de la librería.
    // «Iniciar» ya NO lo usa (dueño, 14-oct-2026: dorado en todos los estados): su prueba es iniciar_es_dorado_…
    const alTocar = vi.fn();
    render(
      <>
        <Boton nivel="principal" apagado onClick={alTocar}>
          Apagado
        </Boton>
        <Boton nivel="principal">Normal</Boton>
      </>,
    );
    const apagado = screen.getByRole('button', { name: 'Apagado' });
    expect(apagado).toHaveAttribute('aria-disabled', 'true');
    expect(apagado).not.toBeDisabled();
    // el aspecto de apagado de la carta (docs/DISENO.md §5): borde discontinuo y gris; nunca ámbar a media opacidad
    expect(apagado.className).toContain('border-dashed');
    expect(apagado.className).toContain('text-secundario');
    expect(apagado.className).not.toMatch(/opacity|bg-ambar/);
    expect(apagado.className).not.toMatch(/hover:enabled/);
    await userEvent.click(apagado);
    expect(alTocar).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Normal' })).not.toHaveAttribute('aria-disabled');
    expect(screen.getByRole('button', { name: 'Normal' }).className).toContain('bg-ambar');
  });

  it('inicio.edicion.si_la_subida_falla_se_dice_y_la_caja_queda_lista_para_elegir_otro', async () => {
    const avisos = ponerAvisos();
    montar();
    pintar();
    await irAEdicion();
    const xhr = await empezarSubida();
    await act(async () => {
      xhr.terminar(403);
    });
    await waitFor(() => expect(dicho(avisos).at(-1)).toEqual({ texto: 'La subida a la nube falló (403) — intenta de nuevo.', tipo: 'mal', clave: 'caja' }));
    expect(screen.queryByText('entrevista.mp4')).toBeNull();
    expect(botonIniciar()).toHaveTextContent(/^Iniciar$/);
    // y sin red desde el principio también
    vi.unstubAllGlobals();
    vi.stubGlobal('XMLHttpRequest', XhrFalso);
    servidor({ '/api/media/config': sinRed });
    await userEvent.upload(entrada(), video());
    await waitFor(() => expect(dicho(avisos).at(-1)!.texto).toMatch(/No hay conexión/));
  });
  it('inicio.edicion.el_mando_de_la_caja_elige_edicion_y_le_da_el_foco_al_campo', async () => {
    montar();
    const mando = createRef<MandoCaja>();
    render(<Caja ref={mando} ir={ir} />);
    expect(screen.queryByRole('textbox', { name: 'Cuéntale a la IA qué quieres' })).toBeNull();
    // desde otra familia: el campo aún no existe cuando se pide, y el foco llega cuando se monta
    act(() => mando.current!.elegir('edicion'));
    expect(riel().getByRole('button', { name: 'Edición' })).toHaveAttribute('aria-pressed', 'true');
    expect(campo()).toHaveFocus();
    // ya en Edición: el foco vuelve al campo
    botonMas().focus();
    act(() => mando.current!.elegir('edicion'));
    expect(campo()).toHaveFocus();
    // y las otras familias siguen eligiendo su opción
    act(() => mando.current!.elegir('videos', 'investigacion'));
    expect(screen.getByRole('button', { name: /Creador de cuentos/ })).toBeInTheDocument();
  });

  it('inicio.edicion.mientras_sale_el_pedido_la_x_de_la_tarjeta_no_quita_el_video', async () => {
    ponerMonedero(100);
    let soltar!: () => void;
    const espera = new Promise<void>(r => (soltar = r));
    montar({
      sugerir: async () => {
        await espera;
        return json({ lanzado: true, creditos: 8 });
      },
    });
    pintar();
    await irAEdicion();
    await conVideoListo();
    await userEvent.type(campo(), TEXTO);
    await userEvent.click(screen.getByRole('button', { name: 'Iniciar ✦ 8' }));
    await waitFor(() => expect(botonIniciar()).toHaveTextContent('Iniciando…'));
    // el pedido ya salió: quitar el video ahora lo dejaría a medias
    const quitar = screen.getByRole('button', { name: 'Quitar este video' });
    expect(quitar).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(quitar);
    expect(screen.getByText('entrevista.mp4')).toBeInTheDocument();
    soltar();
    await waitFor(() => expect(screen.queryByText('entrevista.mp4')).toBeNull());
  });
});

/** Una respuesta que la prueba suelta cuando quiere (el servidor "tarda"). */
function diferida<T>() {
  let resolver!: (v: T) => void;
  const promesa = new Promise<T>(r => (resolver = r));
  return { promesa, resolver };
}

const EXITO = () => json({ lanzado: true, creditos: 8 });
const SIN_SALDO = () => json({ detail: 'Créditos insuficientes: esta acción cuesta 8 créditos y tu saldo es 5.' }, 402);

/** Hasta tener el video listo, el texto escrito y el botón «Iniciar ✦ 8» a punto de pulsarse. */
async function listaParaLanzar() {
  await irAEdicion();
  await conVideoListo();
  await userEvent.type(campo(), TEXTO);
}

// Revisión adversarial (lente dinero y flujos): intentar romperlo. Cada prueba parte de algo que una persona
// distraída, una red mala o un servidor lento pueden hacer de verdad.
// Los ajustes del dueño del 14-oct-2026 a la pestaña Edición: «Editar ▾» junto al «+» (como «Un video corto ▾» en Video) y
// «Iniciar» en lugar de «Editar», dorado en todos los estados. El cuadro del campo está más abajo (revisión visual).
describe('la caja de Edición, el chip «Editar ▾» y el botón «Iniciar»', () => {
  // (el nombre es el de cuando la lista tenía UNA opción: el registro anti-pérdida lo cita. Hoy tiene dos, Editar y «De videos a
  // Shorts»; lo que hace la segunda está en EdicionShorts.test.tsx)
  it('inicio.edicion.el_chip_editar_va_junto_al_mas_antes_del_boton_principal_con_su_lista_de_una_opcion', async () => {
    montar();
    pintar();
    await irAEdicion();
    const chip = chipModo();
    expect(chip).toHaveAttribute('aria-haspopup', 'listbox');
    expect(chip).toHaveAttribute('aria-expanded', 'false');
    expect(chip).toHaveTextContent(/^Editar ▾$/);
    // la pista al pasar el ratón o al enfocar es la nota de la opción: lo que hace, con la promesa de la copia
    expect(MODOS_EDICION.map(m => m.id)).toEqual(['editar', 'shorts']);
    expect(MODOS_EDICION[0].nota).toBe('Sube tu metraje y la IA te propone el corte. Se edita una copia: tu original se queda como está.');
    expect(chip).toHaveAttribute('data-pista', MODOS_EDICION[0].nota);
    // junto al «+», en su misma fila y justo después; el botón principal viene después de los dos (el orden del foco)
    const botones = screen.getAllByRole('button');
    expect(botones.indexOf(chip)).toBe(botones.indexOf(botonMas()) + 1);
    expect(botones.indexOf(botonIniciar())).toBeGreaterThan(botones.indexOf(chip));
    expect(chip.parentElement!.parentElement).toBe(botonMas().parentElement);
    // Edición no tiene modelo ni duración que elegir
    expect(screen.queryByRole('button', { name: /^Modelo / })).toBeNull();
    // la lista: las dos opciones, la de ahora marcada, con «según el video» a la derecha (en las otras familias dice «según el modelo» o el precio)
    await userEvent.click(chip);
    const lista = screen.getByRole('listbox', { name: 'Opciones' });
    expect(chip).toHaveAttribute('aria-expanded', 'true');
    expect(chip).toHaveAttribute('aria-controls', lista.id);
    const opciones = within(lista).getAllByRole('option');
    expect(opciones).toHaveLength(2);
    expect(opciones[0]).toHaveAttribute('aria-selected', 'true');
    expect(opciones[0]).toHaveFocus();
    expect(opciones[0]).toHaveTextContent('Editar');
    expect(opciones[0]).toHaveTextContent('según el video');
    expect(opciones[0]).toHaveTextContent(MODOS_EDICION[0].nota);
    expect(opciones[1]).toHaveAttribute('aria-selected', 'false');
    expect(opciones[1]).toHaveTextContent('De videos a Shorts');
    expect(opciones[1]).toHaveTextContent('según el video');
    expect(opciones[1]).toHaveTextContent('Sube un video largo y te daremos los mejores momentos.');
  });

  // (el nombre es de cuando había una sola opción: elegir la de ahora sigue siendo solo cerrar la lista)
  it('inicio.edicion.el_chip_se_porta_como_el_de_video_flechas_esc_clic_fuera_y_elegir_la_unica_solo_cierra', async () => {
    const f = montar();
    pintar();
    await irAEdicion();
    await userEvent.type(campo(), TEXTO);
    const chip = chipModo();
    const lista = () => screen.queryByRole('listbox');
    // ↓ abre (como en Video) y el foco va a la opción
    chip.focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(within(lista()!).getByRole('option', { name: /Editar/ })).toHaveFocus();
    // con dos opciones, ↓ y Fin van a la segunda, y ↑ e Inicio vuelven a la primera, sin salirse de la lista
    await userEvent.keyboard('{ArrowDown}');
    expect(within(lista()!).getByRole('option', { name: /De videos a Shorts/ })).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(within(lista()!).getByRole('option', { name: /De videos a Shorts/ })).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}');
    expect(within(lista()!).getByRole('option', { name: /Editar/ })).toHaveFocus();
    await userEvent.keyboard('{End}');
    expect(within(lista()!).getByRole('option', { name: /De videos a Shorts/ })).toHaveFocus();
    await userEvent.keyboard('{Home}');
    expect(within(lista()!).getByRole('option', { name: /Editar/ })).toHaveFocus();
    // Esc cierra y el foco vuelve al chip
    await userEvent.keyboard('{Escape}');
    expect(lista()).toBeNull();
    expect(chip).toHaveFocus();
    // Enter (y Espacio) eligen la de ahora: cierra y vuelve al chip; no cambia nada
    for (const tecla of ['{Enter}', ' ']) {
      await userEvent.keyboard('{ArrowDown}');
      await userEvent.keyboard(tecla);
      expect(lista()).toBeNull();
      expect(chip).toHaveFocus();
      expect(chip).toHaveTextContent(/^Editar ▾$/);
    }
    // el clic en la opción de ahora también; el clic en el chip abre y cierra; un clic fuera cierra
    await userEvent.click(chip);
    await userEvent.click(screen.getByRole('option', { name: /Editar/ }));
    expect(lista()).toBeNull();
    expect(chip).toHaveFocus();
    await userEvent.click(chip);
    expect(lista()).not.toBeNull();
    await userEvent.click(chip);
    expect(lista()).toBeNull();
    await userEvent.click(chip);
    await userEvent.click(campo());
    expect(lista()).toBeNull();
    // Tab con la lista abierta la cierra y el foco sigue desde el chip, al botón principal: no se pierde en <body>
    await userEvent.click(chip);
    await userEvent.keyboard('{Tab}');
    expect(lista()).toBeNull();
    expect(document.body).not.toHaveFocus();
    expect(botonIniciar()).toHaveFocus();
    // y Shift+Tab, hacia atrás: al «+»
    await userEvent.click(chip);
    await userEvent.keyboard('{Shift>}{Tab}{/Shift}');
    expect(lista()).toBeNull();
    expect(document.body).not.toHaveFocus();
    expect(botonMas()).toHaveFocus();
    // y nada de esto pidió algo, cobró ni tocó lo escrito
    expect(campo()).toHaveValue(TEXTO);
    expect(f).not.toHaveBeenCalled();
    // cambiar de familia con la lista abierta: al volver, la lista no está
    await userEvent.click(chip);
    expect(lista()).not.toBeNull();
    fireEvent.click(riel().getByRole('button', { name: 'Video' }));
    await irAEdicion();
    expect(lista()).toBeNull();
    expect(chipModo()).toHaveAttribute('aria-expanded', 'false');
    expect(campo()).toHaveValue(TEXTO);
  });

  it('inicio.edicion.iniciar_es_dorado_en_todos_los_estados_y_solo_cambian_lo_que_dice_y_su_semantica', async () => {
    ponerMonedero(100);
    montar();
    pintar();
    await irAEdicion();
    // sin video, sin texto: dorado, sin precio, aria-disabled y NO disabled
    expect(botonIniciar()).toHaveTextContent(/^Iniciar$/);
    expect(esDorado(botonIniciar())).toBe(true);
    expect(botonIniciar()).toHaveAttribute('aria-disabled', 'true');
    expect(botonIniciar()).not.toBeDisabled();
    // sin video, con texto
    await userEvent.type(campo(), TEXTO);
    expect(esDorado(botonIniciar())).toBe(true);
    expect(botonIniciar()).toHaveAttribute('aria-disabled', 'true');
    // subiendo: ámbar, ocupado, cursor de espera
    await empezarSubida();
    expect(botonIniciar()).toHaveTextContent('Subiendo…');
    expect(esDorado(botonIniciar())).toBe(true);
    expect(botonIniciar()).toHaveAttribute('aria-busy', 'true');
    // con video, precio y texto: dorado y SIN aria-disabled (el único estado en que cobra)
    await terminarSubida();
    await screen.findByRole('button', { name: 'Iniciar ✦ 8' });
    expect(esDorado(botonIniciar())).toBe(true);
    expect(botonIniciar()).not.toHaveAttribute('aria-disabled');
    expect(botonIniciar()).not.toHaveAttribute('aria-busy');
    // sin el texto: sigue dorado, con precio, y vuelve el aria-disabled
    await userEvent.clear(campo());
    expect(botonIniciar()).toHaveTextContent('Iniciar ✦ 8');
    expect(esDorado(botonIniciar())).toBe(true);
    expect(botonIniciar()).toHaveAttribute('aria-disabled', 'true');
    // el verbo de antes ya no existe en ninguna parte del botón principal
    expect(screen.queryByRole('button', { name: /^(Editar ✦|Editando)/ })).toBeNull();
  });
});

describe('la caja de Edición, a la defensiva (dinero y flujos)', () => {
  it('inicio.edicion.enter_repetido_en_iniciar_es_una_sola_peticion', async () => {
    ponerMonedero(100);
    const cobros = oirCobros();
    const espera = diferida<Response>();
    const f = montar({ sugerir: () => espera.promesa });
    pintar();
    await listaParaLanzar();
    screen.getByRole('button', { name: 'Iniciar ✦ 8' }).focus();
    // Enter mantenido o pulsado varias veces: cada Enter sobre un botón es un clic
    await userEvent.keyboard('{Enter}{Enter}{Enter}');
    await waitFor(() => expect(llamadas(f, '/api/editar/entrevista/sugerir')).toHaveLength(1));
    expect(llamadas(f, '/api/moderar')).toHaveLength(1);
    espera.resolver(EXITO());
    await waitFor(() => expect(campo()).toHaveValue(''));
    // ya vacía: otro Enter no lanza nada (avisa que hay un trabajo en curso)
    await userEvent.keyboard('{Enter}');
    expect(llamadas(f, '/api/editar/entrevista/sugerir')).toHaveLength(1);
    expect(cobros.map(c => c.costo)).toEqual([8]);
  });

  it('inicio.edicion.clic_durante_el_402_y_el_502_en_vuelo_no_duplica_y_despues_se_puede_reintentar', async () => {
    const avisos = ponerAvisos();
    ponerMonedero(100);
    const cobros = oirCobros();
    const respuestas: Array<ReturnType<typeof diferida<Response>>> = [];
    const f = montar({
      sugerir: () => {
        const d = diferida<Response>();
        respuestas.push(d);
        return d.promesa;
      },
    });
    pintar();
    await listaParaLanzar();
    const pedidos = () => llamadas(f, '/api/editar/entrevista/sugerir').length;
    // 1.º pedido, y dos clics más mientras vuela
    await userEvent.click(screen.getByRole('button', { name: 'Iniciar ✦ 8' }));
    await userEvent.click(botonIniciar());
    await userEvent.click(botonIniciar());
    expect(pedidos()).toBe(1);
    // vuelve el 402: nada se cobró, el botón no queda trabajando y el reintento SÍ sale (uno solo)
    respuestas[0]!.resolver(SIN_SALDO());
    expect(await screen.findByText(/Te faltan ✦ 3/)).toBeInTheDocument();
    expect(botonIniciar()).not.toHaveAttribute('aria-busy');
    await userEvent.click(botonIniciar());
    await userEvent.click(botonIniciar());
    expect(pedidos()).toBe(2);
    // al salir otra vez, el «Te faltan» viejo se quita: ya no es verdad hasta que el servidor lo diga
    expect(screen.queryByText(/Te faltan/)).toBeNull();
    // vuelve el 502: el servidor devolvió los créditos; otra vez se puede reintentar
    respuestas[1]!.resolver(json({ detail: 'No se pudo lanzar la corrida: sin capacidad' }, 502));
    await waitFor(() => expect(dicho(avisos).at(-1)!.texto).toBe('No se pudo lanzar la corrida: sin capacidad'));
    expect(cobros).toHaveLength(0);
    await userEvent.click(botonIniciar());
    await userEvent.click(botonIniciar());
    expect(pedidos()).toBe(3);
    respuestas[2]!.resolver(EXITO());
    await waitFor(() => expect(campo()).toHaveValue(''));
    // tres pedidos, UN cobro
    expect(cobros.map(c => c.costo)).toEqual([8]);
  });

  it('inicio.edicion.cambiar_de_familia_a_mitad_del_cobro_lo_termina_y_al_volver_la_caja_esta_vacia', async () => {
    const avisos = ponerAvisos();
    ponerMonedero(100);
    const cobros = oirCobros();
    const espera = diferida<Response>();
    const f = montar({ sugerir: () => espera.promesa });
    pintar();
    await listaParaLanzar();
    await userEvent.click(screen.getByRole('button', { name: 'Iniciar ✦ 8' }));
    await waitFor(() => expect(llamadas(f, '/api/editar/entrevista/sugerir')).toHaveLength(1));
    // la persona se va a Video mientras el servidor cobra
    await userEvent.click(riel().getByRole('button', { name: 'Video' }));
    espera.resolver(EXITO());
    await waitFor(() => expect(cobros.map(c => c.costo)).toEqual([8]));
    expect(dicho(avisos).at(-1)).toEqual({ texto: 'Ya estamos editando tu video. Sigue el avance en «Tus trabajos».', tipo: 'ok', clave: 'caja' });
    await irAEdicion();
    expect(campo()).toHaveValue('');
    expect(screen.queryByText('entrevista.mp4')).toBeNull();
    // y la corrida lanzada sigue contando: no se empieza otra
    avisos.mostrar.mockClear();
    await userEvent.click(botonMas());
    expect(dicho(avisos)).toEqual([{ texto: AVISO_OCUPADO, tipo: 'mal', clave: 'caja' }]);
  });

  it('inicio.edicion.un_402_que_llega_en_otra_familia_se_ve_al_volver_y_no_pierde_nada', async () => {
    const monedero = ponerMonedero(100);
    const cobros = oirCobros();
    const espera = diferida<Response>();
    const f = montar({ sugerir: () => espera.promesa });
    pintar();
    await listaParaLanzar();
    await userEvent.click(screen.getByRole('button', { name: 'Iniciar ✦ 8' }));
    await waitFor(() => expect(llamadas(f, '/api/editar/entrevista/sugerir')).toHaveLength(1));
    await userEvent.click(riel().getByRole('button', { name: 'Imagen' }));
    espera.resolver(SIN_SALDO());
    await waitFor(() => expect(monedero.refrescar).toHaveBeenCalled());
    await irAEdicion();
    // el texto, el video y lo que falta están ahí; nada se cobró
    expect(campo()).toHaveValue(TEXTO);
    expect(screen.getByText('entrevista.mp4')).toBeInTheDocument();
    expect(screen.getByText(/Te faltan ✦ 3/)).toBeInTheDocument();
    expect(cobros).toHaveLength(0);
    // el saldo de verdad llega (monedero.js): la línea no se repite ni contradice
    monedero.get.mockReturnValue({ saldo: 5 });
    act(() => {
      document.dispatchEvent(new Event('monedero'));
    });
    expect(screen.getAllByText(/Te faltan/)).toHaveLength(1);
    expect(screen.getByText('Tienes ✦ 5: no alcanza para editar este video.')).toBeInTheDocument();
  });

  it('inicio.edicion.quitar_con_el_precio_en_camino_y_subir_otro_ignora_la_respuesta_vieja', async () => {
    const vieja = diferida<CostoEdicion>();
    montar({ costo: p => (p === 'primero' ? vieja.promesa : { ...COSTO_8, creditos: 2 }) });
    pintar();
    await irAEdicion();
    await empezarSubida(video('primero.mp4'));
    await terminarSubida();
    await waitFor(() => expect(botonIniciar()).toHaveTextContent('Calculando…'));
    await userEvent.click(screen.getByRole('button', { name: 'Quitar este video' }));
    await conVideoListo(video('segundo.mp4'));
    expect(botonIniciar()).toHaveTextContent('Iniciar ✦ 2');
    // llega tarde el precio del video que ya no está: no se lo queda el nuevo
    vieja.resolver({ ...COSTO_8, creditos: 99 });
    await new Promise(r => setTimeout(r, 30));
    expect(botonIniciar()).toHaveTextContent('Iniciar ✦ 2');
    expect(screen.getByText('segundo.mp4')).toBeInTheDocument();
    expect(screen.queryByText('primero.mp4')).toBeNull();
  });

  it('inicio.edicion.un_archivo_nuevo_sobre_un_video_listo_lo_reemplaza_y_el_pedido_va_al_proyecto_nuevo', async () => {
    ponerMonedero(100);
    const f = montar({ costo: p => (p === 'primero' ? COSTO_8 : { ...COSTO_8, creditos: 2 }) });
    pintar();
    await irAEdicion();
    await conVideoListo(video('primero.mp4'));
    await userEvent.type(campo(), TEXTO);
    expect(botonIniciar()).toHaveTextContent('Iniciar ✦ 8');
    // otro video encima: el viejo y su precio se van, el texto se queda
    await conVideoListo(video('segundo.mov', ''));
    expect(botonIniciar()).toHaveTextContent('Iniciar ✦ 2');
    expect(screen.queryByText('primero.mp4')).toBeNull();
    expect(campo()).toHaveValue(TEXTO);
    await userEvent.click(botonIniciar());
    await waitFor(() => expect(llamadas(f, '/api/editar/segundo/sugerir')).toHaveLength(1));
    expect(llamadas(f, '/api/editar/primero/sugerir')).toHaveLength(0);
  });

  it('inicio.edicion.otro_archivo_durante_la_subida_avisa_y_no_empieza_otra_subida', async () => {
    const avisos = ponerAvisos();
    montar();
    const { container } = pintar();
    await irAEdicion();
    await empezarSubida(video('primero.mp4'));
    avisos.mostrar.mockClear();
    const ocupado = { texto: AVISO_OCUPADO, tipo: 'mal', clave: 'caja' };
    fireEvent.drop(container.querySelector('section')!, { dataTransfer: { files: [video('segundo.mp4')], types: ['Files'] } });
    expect(dicho(avisos)).toEqual([ocupado]);
    fireEvent.change(entrada(), { target: { files: [video('tercero.mp4')] } });
    expect(dicho(avisos)).toEqual([ocupado, ocupado]);
    expect(XhrFalso.todos).toHaveLength(1);
    expect(screen.getByText('primero.mp4')).toBeInTheDocument();
    expect(screen.queryByText('segundo.mp4')).toBeNull();
  });

  it('inicio.edicion.los_nombres_raros_de_archivo_dan_un_proyecto_que_el_servidor_acepta_o_se_rechazan_con_motivo', async () => {
    const nombres = [
      'Reunión de Equipo (final) .MP4',
      'ÁÉÍ.mov',
      '日本語.m4v',
      '_.mp4',
      '___.mp4',
      '-.mp4',
      '--a--.mp4',
      'A'.repeat(200) + '.mp4',
      'mi.video.final.v2.mp4',
      'sin extension',
      'con   espacios   y\ttabs.mp4',
      '.oculto.mp4',
      'emoji 🎬.mp4',
      ' .mp4',
      "O'Brien; DROP TABLE.mp4",
      '../../etc/passwd.mp4',
    ];
    for (const n of nombres) {
      const p = nombreDeProyecto(n);
      expect(nombreValido(p), n).toBe(true);
      // la regla del servidor (media_api._validar_nombre): quitando «-» y «_» quedan letras o cifras, y no queda vacío
      expect(p.replace(/[-_]/g, ''), n).toMatch(/^[A-Za-z0-9]+$/);
      expect(p.length, n).toBeLessThanOrEqual(40);
      expect(p, n).toBe(p.toLowerCase());
    }
    expect(nombreDeProyecto('_.mp4')).toBe('mi-video');
    expect(nombreDeProyecto('Mi Entrevista.mp4')).toBe('mi-entrevista');
    // lo que el servidor no podría leer como archivo con extensión se rechaza ANTES de pedir permiso
    expect(rechazoVideo(video('.mp4'))).toBe('«.mp4» no tiene nombre, solo la extensión. Ponle un nombre y vuelve a intentar.');
    expect(rechazoVideo(video('..mov'))).not.toBe('');
    expect(rechazoVideo(video('.oculto.mp4'))).toBe('');
    expect(rechazoVideo(video(' .mp4'))).toBe('');
    // en pantalla: «_.mp4» sube como «mi-video» (no es un 422 sobre un nombre que nadie tecleó)...
    const avisos = ponerAvisos();
    const f = montar();
    pintar();
    await irAEdicion();
    await userEvent.upload(entrada(), video('.mp4'));
    expect(dicho(avisos).at(-1)!.texto).toMatch(/no tiene nombre/);
    await userEvent.upload(entrada(), video('vacio.mp4', 'video/mp4', 0));
    expect(dicho(avisos).at(-1)).toEqual({ texto: '«vacio.mp4» está vacío.', tipo: 'mal', clave: 'caja' });
    expect(llamadas(f, '/api/media/presign')).toHaveLength(0);
    await empezarSubida(video('_.mp4'));
    expect(cuerpoDe(f, '/api/media/presign')).toMatchObject({ proyecto: 'mi-video', archivo: '_.mp4' });
  });

  it('inicio.edicion.un_nombre_que_ya_es_un_proyecto_tuyo_con_video_se_estrena_con_nombre_nuevo', async () => {
    let intentos = 0;
    const f = montar({
      subidas: p => (p === 'entrevista' ? [{ key: 'videos/entrevista/subidas/entrevista.mp4' }] : []),
      // y el nombre nuevo también lo tiene otra cuenta: el reintento de siempre (UNA vez) lo cubre
      presign: (_u, init) => {
        const b = JSON.parse(String(init?.body)) as { proyecto: string; archivo: string; content_type: string };
        if (++intentos === 1) return json({ detail: 'El nombre ya lo usa otra cuenta.' }, 409);
        return json({ url: 'https://s3.ejemplo/subida', key: `videos/${b.proyecto}/subidas/${b.archivo}`, content_type: b.content_type });
      },
    });
    pintar();
    await irAEdicion();
    await empezarSubida();
    // se preguntó por el nombre del archivo antes de firmar nada
    expect(llamadas(f, '/api/media/entrevista', 'GET')).toHaveLength(1);
    const nombres = llamadas(f, '/api/media/presign').map(c => (JSON.parse(String(c[1]!.body)) as { proyecto: string }).proyecto);
    expect(nombres).toHaveLength(2);
    expect(nombres[0]).toMatch(/^entrevista-[0-9a-f]{4}$/);
    expect(nombres[1]).toMatch(/^entrevista-[0-9a-f]{4}-[0-9a-f]{4}$/);
    await terminarSubida();
    await screen.findByRole('button', { name: 'Iniciar ✦ 8' });
    // la transcripción y los cortes del proyecto viejo no se mezclan: confirmar y precio van por el nombre nuevo
    expect(cuerpoDe(f, '/api/media/confirmar')).toMatchObject({ proyecto: nombres[1] });
    expect(llamadas(f, `/api/editar/${nombres[1]}/costo`, 'GET')).toHaveLength(1);
    expect(llamadas(f, '/api/editar/entrevista/costo', 'GET')).toHaveLength(0);
  });

  it('inicio.edicion.si_no_se_puede_saber_si_el_nombre_ya_existe_se_sube_con_el_nombre_del_archivo', async () => {
    const f = montar({ subidas: () => json({ detail: 'Algo salió mal' }, 500) });
    pintar();
    await irAEdicion();
    await empezarSubida();
    // preguntar es un lujo: si falla no frena la subida
    expect(cuerpoDe(f, '/api/media/presign')).toMatchObject({ proyecto: 'entrevista' });
    await terminarSubida();
    await screen.findByRole('button', { name: 'Iniciar ✦ 8' });
  });

  it('inicio.edicion.un_precio_que_no_es_un_numero_no_se_ensena_ni_se_deja_cobrar', async () => {
    ponerMonedero(100);
    let respuesta: unknown = { ...COSTO_8, creditos: null };
    const f = montar({ costo: () => json(respuesta) });
    pintar();
    await irAEdicion();
    await conVideoListo();
    await userEvent.type(campo(), TEXTO);
    const boton = botonIniciar();
    // nada de «Iniciar ✦ 0» ni «✦ NaN»: se enciende solo con un precio de verdad
    expect(boton).toHaveTextContent(/^Iniciar$/);
    expect(boton).toHaveAttribute('aria-disabled', 'true');
    expect(esDorado(boton)).toBe(true); // también en sin_precio
    expect(screen.getByText('No pudimos calcular el precio. Toca «Iniciar» para intentarlo otra vez.')).toBeInTheDocument();
    await userEvent.click(boton);
    await waitFor(() => expect(llamadas(f, '/api/editar/entrevista/costo', 'GET')).toHaveLength(2));
    expect(llamadas(f, '/api/editar/entrevista/sugerir')).toHaveLength(0);
    expect(llamadas(f, '/api/moderar')).toHaveLength(0);
    respuesta = COSTO_8;
    await userEvent.click(botonIniciar());
    expect(await screen.findByRole('button', { name: 'Iniciar ✦ 8' })).not.toHaveAttribute('aria-disabled');
    // y las demás formas de no ser un precio
    const listo = (creditos: unknown) => ({ fase: 'listo' as const, costo: { ...COSTO_8, creditos: creditos as number } });
    for (const mal of [null, undefined, Number.NaN, '8', -1, 8.5, Number.POSITIVE_INFINITY]) {
      expect(estadoDelBoton({ video: listo(mal), hayTexto: true, saldo: 100 }).tipo, String(mal)).toBe('sin_precio');
    }
    expect(estadoDelBoton({ video: listo(0), hayTexto: true, saldo: 100 })).toEqual({ tipo: 'listo', creditos: 0 });
    // y una duración que no es número no rompe la tarjeta
    expect(reloj(Number.NaN)).toBe('');
    expect(reloj(undefined as unknown as number)).toBe('');
  });

  it('inicio.edicion.si_el_precio_nunca_llega_se_puede_quitar_el_video_y_empezar_de_nuevo', async () => {
    ponerMonedero(100);
    const f = montar({ costo: p => (p === 'colgado' ? new Promise<Response>(() => undefined) : COSTO_8) });
    pintar();
    await irAEdicion();
    await empezarSubida(video('colgado.mp4'));
    await terminarSubida();
    await waitFor(() => expect(botonIniciar()).toHaveTextContent('Calculando…'));
    expect(botonIniciar()).toHaveAttribute('aria-busy', 'true');
    await userEvent.type(campo(), TEXTO);
    // mientras no hay precio no se cobra nada...
    await userEvent.click(botonIniciar());
    expect(llamadas(f, '/api/editar/colgado/sugerir')).toHaveLength(0);
    // ...pero la persona no queda atrapada
    await userEvent.click(screen.getByRole('button', { name: 'Quitar este video' }));
    await conVideoListo(video('bueno.mp4'));
    expect(botonIniciar()).toHaveTextContent('Iniciar ✦ 8');
    expect(campo()).toHaveValue(TEXTO);
  });

  it('inicio.edicion.un_campo_con_solo_espacios_saltos_o_invisibles_esta_vacio_y_no_enciende_el_boton', async () => {
    ponerMonedero(100);
    const f = montar();
    pintar();
    await irAEdicion();
    await conVideoListo();
    for (const nada of ['   ', '\n\n \n', '​​', '⁠﻿‮', '\t ​\n', '\u{E0041}\u{E0042}']) {
      fireEvent.change(campo(), { target: { value: nada } });
      expect(botonIniciar(), JSON.stringify(nada)).toHaveAttribute('aria-disabled', 'true');
      // y la ayuda sigue pidiendo que escriba (el campo parece lleno, pero no dice nada)
      expect(screen.getByText('Escribe qué quieres hacer con tu video.'), JSON.stringify(nada)).toBeInTheDocument();
      expect(limpiarInstruccion(nada), JSON.stringify(nada)).toBe('');
    }
    await userEvent.click(botonIniciar());
    expect(campo()).toHaveFocus();
    expect(llamadas(f, '/api/editar/entrevista/sugerir')).toHaveLength(0);
    expect(llamadas(f, '/api/moderar')).toHaveLength(0);
    // la misma limpieza que el servidor (server/editar_api.py: limpiar_instruccion)
    expect(limpiarInstruccion('  hola​ mundo\tya\r\nfin x ‮')).toBe('hola mundo ya\nfin\nx');
    expect(limpiarInstruccion('\ud800ok')).toBe('ok');
    expect(limpiarInstruccion('Ñandú 🎬 con acentos')).toBe('Ñandú 🎬 con acentos');
  });

  it('inicio.edicion.la_instruccion_que_viaja_es_la_limpia_y_es_la_misma_que_se_modera', async () => {
    ponerMonedero(100);
    const f = montar();
    pintar();
    await irAEdicion();
    await conVideoListo();
    fireEvent.change(campo(), { target: { value: '  Quita​ muletillas\tya\r\ny ‮' } });
    await userEvent.click(screen.getByRole('button', { name: 'Iniciar ✦ 8' }));
    await waitFor(() => expect(llamadas(f, '/api/editar/entrevista/sugerir')).toHaveLength(1));
    expect(cuerpoDe(f, '/api/editar/entrevista/sugerir')).toEqual({ instruccion: 'Quita muletillas ya\ny' });
    expect(cuerpoDe(f, '/api/moderar')).toEqual({ texto: 'Quita muletillas ya\ny' });
  });

  it('inicio.edicion.el_campo_limita_a_2000_y_si_algo_pasa_el_servidor_es_la_autoridad', async () => {
    ponerMonedero(100);
    const cobros = oirCobros();
    const avisos = ponerAvisos();
    const largo = 'La instrucción es demasiado larga: máximo 2000 caracteres (llevas 2001)';
    const f = montar({ sugerir: () => json({ detail: largo }, 422) });
    pintar();
    await irAEdicion();
    await conVideoListo();
    // pegar un texto enorme: el campo se queda en 2000
    await userEvent.click(campo());
    await userEvent.paste('x'.repeat(2500));
    expect((campo() as HTMLTextAreaElement).value).toHaveLength(2000);
    // si uno de más se cuela por una vía que no respeta `maxlength`, no se recorta en silencio: el servidor decide
    const de2001 = 'y'.repeat(2001);
    fireEvent.change(campo(), { target: { value: de2001 } });
    await userEvent.click(screen.getByRole('button', { name: 'Iniciar ✦ 8' }));
    await waitFor(() => expect(dicho(avisos).at(-1)).toEqual({ texto: largo, tipo: 'mal', clave: 'caja' }));
    expect(cuerpoDe(f, '/api/editar/entrevista/sugerir')).toEqual({ instruccion: de2001 });
    // era un 422 de antes de cobrar: ningún «−N», y el texto y el video siguen para corregirlo
    expect(cobros).toHaveLength(0);
    expect(campo()).toHaveValue(de2001);
    expect(screen.getByText('entrevista.mp4')).toBeInTheDocument();
    expect(botonIniciar()).not.toHaveAttribute('aria-busy');
  });

  it('inicio.edicion.si_el_saldo_cambia_despues_del_precio_el_boton_lo_sigue_antes_de_cobrar', async () => {
    const monedero = ponerMonedero(100);
    const f = montar();
    pintar();
    await listaParaLanzar();
    expect(botonIniciar()).not.toHaveAttribute('aria-disabled');
    // en otra pestaña se gastó casi todo
    monedero.get.mockReturnValue({ saldo: 5 });
    act(() => {
      document.dispatchEvent(new Event('monedero'));
    });
    expect(botonIniciar()).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText(/Te faltan ✦ 3/)).toBeInTheDocument();
    await userEvent.click(botonIniciar());
    expect(llamadas(f, '/api/editar/entrevista/sugerir')).toHaveLength(0);
    // recargó: se enciende sin tocar nada más
    monedero.get.mockReturnValue({ saldo: 50 });
    act(() => {
      document.dispatchEvent(new Event('monedero'));
    });
    expect(botonIniciar()).not.toHaveAttribute('aria-disabled');
    expect(screen.queryByText(/Te faltan/)).toBeNull();
  });

  it('inicio.edicion.si_la_respuesta_del_cobro_se_pierde_el_saldo_se_pone_al_dia_y_el_reintento_cae_en_ya_corre', async () => {
    const avisos = ponerAvisos();
    const monedero = ponerMonedero(100);
    const cobros = oirCobros();
    let intento = 0;
    const f = montar({
      // la 1.ª vez se cae la red con el pedido en el aire (quizá el servidor sí cobró); la 2.ª, el servidor dice que ya corre
      sugerir: () => (++intento === 1 ? sinRed() : json({ detail: 'La corrida ya está en curso — espera a que termine' }, 409)),
    });
    pintar();
    await listaParaLanzar();
    await userEvent.click(screen.getByRole('button', { name: 'Iniciar ✦ 8' }));
    await waitFor(() => expect(dicho(avisos).at(-1)!.texto).toMatch(/No hay conexión/));
    expect(monedero.refrescar).toHaveBeenCalledTimes(1);
    // no se sabe si salió: ni «−N» ni se vacía nada, y el reintento sigue disponible
    expect(cobros).toHaveLength(0);
    expect(campo()).toHaveValue(TEXTO);
    await userEvent.click(botonIniciar());
    await waitFor(() => expect(llamadas(f, '/api/editar/entrevista/sugerir')).toHaveLength(2));
    await waitFor(() => expect(monedero.refrescar).toHaveBeenCalledTimes(2));
    // el 409 confirma que SÍ hay una corrida: la pantalla también lo sabe desde ahí
    avisos.mostrar.mockClear();
    await userEvent.click(botonMas());
    expect(dicho(avisos)).toEqual([{ texto: AVISO_OCUPADO, tipo: 'mal', clave: 'caja' }]);
    expect(cobros).toHaveLength(0);
  });

  it('inicio.edicion.el_menos_n_sale_de_lo_que_cobro_el_servidor_no_del_precio_de_la_pantalla', async () => {
    ponerMonedero(100);
    const cobros = oirCobros();
    montar({ sugerir: () => json({ lanzado: true, creditos: 6 }) }); // el precio cambió entre el costo y el cobro
    pintar();
    await listaParaLanzar();
    await userEvent.click(screen.getByRole('button', { name: 'Iniciar ✦ 8' }));
    await waitFor(() => expect(campo()).toHaveValue(''));
    expect(cobros.map(c => c.costo)).toEqual([6]);
  });

  it('inicio.edicion.ningun_cuerpo_de_ninguna_peticion_lleva_creditos_ni_precio', async () => {
    ponerMonedero(100);
    const f = montar();
    pintar();
    await listaParaLanzar();
    await userEvent.click(screen.getByRole('button', { name: 'Iniciar ✦ 8' }));
    await waitFor(() => expect(campo()).toHaveValue(''));
    const cuerpos = f.mock.calls.map(c => String(c[1]?.body ?? '')).filter(Boolean);
    expect(cuerpos.length).toBeGreaterThanOrEqual(4); // permiso de subida, confirmar, moderar y sugerir
    for (const c of cuerpos) expect(c).not.toMatch(/credit|precio|costo|saldo|✦/i);
    expect(Object.keys(cuerpoDe(f, '/api/editar/entrevista/sugerir'))).toEqual(['instruccion']);
  });

  it('inicio.edicion.si_la_moderacion_se_cae_el_pedido_sigue', async () => {
    ponerMonedero(100);
    const f = montar({ moderar: () => json({ detail: 'caído' }, 500) });
    pintar();
    await listaParaLanzar();
    await userEvent.click(screen.getByRole('button', { name: 'Iniciar ✦ 8' }));
    // un filtro caído no frena el producto (M13: se deja pasar)
    await waitFor(() => expect(llamadas(f, '/api/editar/entrevista/sugerir')).toHaveLength(1));
  });

  it('inicio.edicion.lo_que_se_escribe_mientras_sale_el_pedido_no_se_borra', async () => {
    ponerMonedero(100);
    const espera = diferida<Response>();
    montar({ sugerir: () => espera.promesa });
    pintar();
    await listaParaLanzar();
    await userEvent.click(screen.getByRole('button', { name: 'Iniciar ✦ 8' }));
    await waitFor(() => expect(botonIniciar()).toHaveTextContent('Iniciando…'));
    // el campo sigue siendo suyo: eso que escribió no es lo que se mandó
    await userEvent.type(campo(), ' y ponle música');
    espera.resolver(EXITO());
    await waitFor(() => expect(screen.queryByText('entrevista.mp4')).toBeNull());
    expect(campo()).toHaveValue(`${TEXTO} y ponle música`);
  });

  it('inicio.edicion.quitar_mientras_se_confirma_la_subida_no_pide_precio_ni_dice_nada', async () => {
    const avisos = ponerAvisos();
    const confirmacion = diferida<Response>();
    const f = montar({ confirmar: () => confirmacion.promesa });
    pintar();
    await irAEdicion();
    await empezarSubida();
    await terminarSubida(); // el PUT terminó; falta que el servidor confirme
    await waitFor(() => expect(llamadas(f, '/api/media/confirmar')).toHaveLength(1));
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar la subida' }));
    expect(screen.queryByText('entrevista.mp4')).toBeNull();
    confirmacion.resolver(json({ archivo: 'entrevista.mp4', cdn: '' }));
    await new Promise(r => setTimeout(r, 30));
    expect(f.mock.calls.some(c => String(c[0]).endsWith('/costo'))).toBe(false);
    expect(avisos.mostrar).not.toHaveBeenCalled();
    expect(botonIniciar()).toHaveTextContent(/^Iniciar$/);
  });

  it('inicio.edicion.cancelar_o_desmontar_mientras_se_pide_el_permiso_de_subida_no_sube_nada', async () => {
    const avisos = ponerAvisos();
    const permisos: Array<ReturnType<typeof diferida<Response>>> = [];
    const f = montar({
      presign: () => {
        const d = diferida<Response>();
        permisos.push(d);
        return d.promesa;
      },
    });
    const { unmount } = pintar();
    await irAEdicion();
    const firma = () => json({ url: 'https://s3.ejemplo/subida', key: 'videos/entrevista/subidas/entrevista.mp4', content_type: 'video/mp4' });
    // cancelar con el permiso en camino
    await userEvent.upload(entrada(), video());
    await waitFor(() => expect(permisos).toHaveLength(1));
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar la subida' }));
    permisos[0]!.resolver(firma());
    await new Promise(r => setTimeout(r, 30));
    expect(XhrFalso.todos).toHaveLength(0);
    // desmontar con el permiso en camino
    await userEvent.upload(entrada(), video());
    await waitFor(() => expect(permisos).toHaveLength(2));
    unmount();
    permisos[1]!.resolver(firma());
    await new Promise(r => setTimeout(r, 30));
    expect(XhrFalso.todos).toHaveLength(0);
    expect(llamadas(f, '/api/media/confirmar')).toHaveLength(0);
    expect(avisos.mostrar).not.toHaveBeenCalled();
  });

  it('inicio.edicion.desmontar_la_caja_a_mitad_de_la_subida_la_cancela_y_no_confirma_nada', async () => {
    const avisos = ponerAvisos();
    const errores = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    onTestFinished(() => errores.mockRestore());
    const f = montar();
    const { unmount } = pintar();
    await irAEdicion();
    const xhr = await empezarSubida();
    act(() => xhr.avanzar(100_000_000, 824_000_000));
    unmount();
    // el PUT se aborta: no queda una subida viva confirmando un proyecto que nadie va a ver
    expect(xhr.abortado).toBe(true);
    await new Promise(r => setTimeout(r, 30));
    expect(llamadas(f, '/api/media/confirmar')).toHaveLength(0);
    expect(f.mock.calls.some(c => String(c[0]).endsWith('/costo'))).toBe(false);
    expect(avisos.mostrar).not.toHaveBeenCalled();
    expect(errores).not.toHaveBeenCalled();
  });

  it('inicio.edicion.desmontar_con_la_corrida_en_curso_deja_de_preguntar_y_no_deja_avisos_de_react', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const errores = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    onTestFinished(() => errores.mockRestore());
    ponerMonedero(100);
    const f = montar();
    const { unmount } = pintar();
    await listaParaLanzar();
    await userEvent.click(screen.getByRole('button', { name: 'Iniciar ✦ 8' }));
    await waitFor(() => expect(campo()).toHaveValue(''));
    expect(llamadas(f, '/api/editar/entrevista', 'GET')).toHaveLength(0); // perezoso: aún nada
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5100);
    });
    expect(llamadas(f, '/api/editar/entrevista', 'GET')).toHaveLength(1);
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(llamadas(f, '/api/editar/entrevista', 'GET')).toHaveLength(1);
    expect(errores).not.toHaveBeenCalled();
  });

  it('inicio.edicion.el_sondeo_se_libera_con_un_404_y_un_error_del_servidor_no_cuenta_como_terminado', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const avisos = ponerAvisos();
    ponerMonedero(100);
    let modo: '500' | '404' = '500';
    montar({ estado: () => (modo === '500' ? json({ detail: 'Algo salió mal' }, 500) : json({ detail: 'ya no está' }, 404)) });
    pintar();
    await listaParaLanzar();
    await userEvent.click(screen.getByRole('button', { name: 'Iniciar ✦ 8' }));
    await waitFor(() => expect(campo()).toHaveValue(''));
    const bloqueada = async () => {
      avisos.mostrar.mockClear();
      await userEvent.click(botonMas());
      return avisos.mostrar.mock.calls.length === 1;
    };
    // un 500 no dice que terminó: se sigue esperando
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5100);
    });
    expect(await bloqueada()).toBe(true);
    // un 404 sí: el proyecto ya no existe y nada corre, así que la caja no se queda bloqueada
    modo = '404';
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5100);
    });
    expect(await bloqueada()).toBe(false);
  });

  it('inicio.edicion.una_pregunta_que_nunca_vuelve_no_bloquea_la_caja_mas_de_2_horas', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const avisos = ponerAvisos();
    const monedero = ponerMonedero(100);
    montar({ estado: () => new Promise<Response>(() => undefined) });
    pintar();
    await listaParaLanzar();
    await userEvent.click(screen.getByRole('button', { name: 'Iniciar ✦ 8' }));
    await waitFor(() => expect(campo()).toHaveValue(''));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000 - 10_000);
    });
    avisos.mostrar.mockClear();
    await userEvent.click(botonMas());
    expect(avisos.mostrar).toHaveBeenCalledTimes(1); // a casi 2 h, sigue en curso
    monedero.refrescar.mockClear();
    // el servidor da por caducada la corrida a las 2 h: la pantalla también, sin esperar una respuesta que no viene
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(monedero.refrescar).toHaveBeenCalled();
    avisos.mostrar.mockClear();
    await userEvent.click(botonMas());
    expect(avisos.mostrar).not.toHaveBeenCalled();
  });
});

// Las ideas de Edición ya no son botones sino una pista que rota sola dentro del campo (dueño, 14-oct-2026: «Rotan solas como
// pista»). El reloj es de verdad (setTimeout) pero falso: vi.useFakeTimers() sin avance automático, así que cada prueba mueve
// el tiempo a mano y cuenta los temporizadores vivos con vi.getTimerCount(). Sin userEvent (necesita el reloj real): fireEvent.
describe('la pista que rota en el campo de Edición', () => {
  /** La cuenta de las pruebas: una idea sale a los 3.75 s y la siguiente entra a los 4 (PISTA_CADA_MS). */
  const ANTES_DE_SALIR = PISTA_CADA_MS - PISTA_FUNDIDO_MS;
  const pista = () => campo().getAttribute('placeholder');
  /** El fundido de salida: la opacidad de `::placeholder` en 0 (jsdom no calcula `::placeholder`: se lee la clase que la pone). */
  const saliendo = () => campo().className.split(/\s+/).includes('placeholder:opacity-0');
  /**
   * Mueve el reloj falso. El temporizador de la pista se arma en un efecto de React, y los efectos corren al salir de cada
   * act(): para que cada paso arme el suyo a tiempo (como en el navegador) se avanza de a `paso` ms, de a 1 por omisión. Los
   * saltos largos de «aquí no debe pasar nada» usan un paso grueso: ahí no se miden fronteras.
   */
  const avanzar = (ms: number, paso = 1) => {
    for (let t = 0; t < ms; t += paso) {
      act(() => {
        vi.advanceTimersByTime(Math.min(paso, ms - t));
      });
    }
  };
  const aEdicion = () => fireEvent.click(riel().getByRole('button', { name: 'Edición' }));
  /** Los temporizadores vivos con la pista rodando, y con ella parada (el foco la para): su diferencia es la rotación. */
  function cuentas() {
    const rodando = vi.getTimerCount();
    fireEvent.focus(campo());
    const parada = vi.getTimerCount();
    fireEvent.blur(campo());
    return { rodando, parada };
  }
  /** `matchMedia` con «reducir movimiento» que la prueba puede cambiar, y los oyentes que le quedan puestos. */
  function ponerMovimiento(reducido: boolean) {
    const oyentes = new Set<() => void>();
    let valor = reducido;
    vi.stubGlobal('matchMedia', (consulta: string) => ({
      get matches() {
        return consulta.includes('prefers-reduced-motion') && valor;
      },
      media: consulta,
      addEventListener: (_tipo: string, f: () => void) => oyentes.add(f),
      removeEventListener: (_tipo: string, f: () => void) => oyentes.delete(f),
    }));
    return {
      oyentes,
      cambiar(nuevo: boolean) {
        valor = nuevo;
        act(() => oyentes.forEach(f => f()));
      },
    };
  }
  /** `document.hidden` que la prueba puede cambiar (y avisa con `visibilitychange`, como el navegador). */
  function ponerPestana(oculta: boolean) {
    let valor = oculta;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => valor });
    onTestFinished(() => {
      delete (document as { hidden?: boolean }).hidden;
    });
    return (nuevo: boolean) => {
      valor = nuevo;
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
    };
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('inicio.edicion.la_fila_de_botones_de_ideas_ya_no_existe_y_la_ayuda_no_dice_toca_una_idea', () => {
    montar();
    pintar();
    aEdicion();
    // ya no hay grupo de ideas ni ningún botón con sus textos: eran un atajo que ponía el texto en el campo, y ahora son pista
    expect(screen.queryByRole('group', { name: /ideas/i })).toBeNull();
    for (const idea of IDEAS_EDICION) expect(screen.queryByRole('button', { name: idea })).toBeNull();
    expect(riel().getAllByRole('button')).toHaveLength(3);
    // ...así que la ayuda no manda a tocar nada: «toca una idea» llevaría a un botón que no existe
    expect(AYUDA_TEXTO).toBe('Escribe qué quieres hacer con tu video.');
    expect(AYUDA_TEXTO).not.toMatch(/toca/i);
    expect(screen.getByText(AYUDA_TEXTO)).toBeInTheDocument();
    expect(screen.queryByText(/toca una idea/i)).toBeNull();
    // el campo sigue vacío: la pista NO es su valor
    expect(campo()).toHaveValue('');
  });

  it('inicio.edicion.la_pista_arranca_en_la_primera_idea_sin_fundido_y_las_cuatro_leen_igual', () => {
    montar();
    pintar();
    aEdicion();
    // siempre en la primera, sin salir ni entrar: abrir la pantalla no anima lo que ya estaba (docs/DISENO.md §4)
    expect(pista()).toBe('Cuéntale a la IA qué quieres. Ejemplo: «Quita muletillas y silencios»');
    expect(saliendo()).toBe(false);
    expect(campo().className.split(/\s+/)).toContain('placeholder:opacity-100');
    // la rotación no empieza hasta cumplido el primer intervalo
    avanzar(ANTES_DE_SALIR - 1);
    expect(pista()).toBe(huecoDe(IDEAS_EDICION[0]));
    expect(saliendo()).toBe(false);
    // la misma frase con las cuatro (con el punto, o sin él, igual en todas) y entre comillas angulares
    expect(IDEAS_EDICION.map(huecoDe)).toEqual([
      'Cuéntale a la IA qué quieres. Ejemplo: «Quita muletillas y silencios»',
      'Cuéntale a la IA qué quieres. Ejemplo: «Un short vertical para Reels»',
      'Cuéntale a la IA qué quieres. Ejemplo: «Resumen de 60 segundos»',
      'Cuéntale a la IA qué quieres. Ejemplo: «Subtítulos grandes y un título»',
    ]);
    // y vuelve a abrirse en la primera: cambiar de familia y regresar no deja la pista a medias
    avanzar(PISTA_CADA_MS * 2);
    expect(pista()).not.toBe(huecoDe(IDEAS_EDICION[0]));
    fireEvent.click(riel().getByRole('button', { name: 'Video' }));
    aEdicion();
    expect(pista()).toBe(huecoDe(IDEAS_EDICION[0]));
    expect(saliendo()).toBe(false);
  });

  it('inicio.edicion.la_pista_rota_cada_4_s_con_fundido_de_salida_y_de_entrada_y_da_la_vuelta', () => {
    montar();
    pintar();
    aEdicion();
    // dos vueltas completas: cada idea sale (opacidad 0, curva de lo que se va), se cambia el texto con el campo ya apagado y la
    // siguiente entra (opacidad 1, curva de lo que llega). El texto cambia a los 4 s justos de que empezó la idea anterior
    const clases = () => campo().className.split(/\s+/);
    for (let vuelta = 0; vuelta < 2; vuelta++) {
      for (let i = 0; i < IDEAS_EDICION.length; i++) {
        expect(pista(), `vuelta ${vuelta}, idea ${i}`).toBe(huecoDe(IDEAS_EDICION[i]!));
        expect(saliendo()).toBe(false);
        expect(clases()).toContain('placeholder:ease-(--ease-salida)');
        avanzar(ANTES_DE_SALIR - 1);
        expect(saliendo(), 'todavía no sale').toBe(false);
        avanzar(1);
        // sale: sigue siendo el mismo texto (se cambia cuando ya no se ve), con la curva de lo que se va
        expect(saliendo(), 'ya sale').toBe(true);
        expect(pista()).toBe(huecoDe(IDEAS_EDICION[i]!));
        expect(clases()).toContain('placeholder:ease-(--ease-entrada)');
        expect(clases()).not.toContain('placeholder:opacity-100');
        avanzar(PISTA_FUNDIDO_MS - 1);
        expect(pista(), 'a un instante de cambiar').toBe(huecoDe(IDEAS_EDICION[i]!));
        avanzar(1);
      }
    }
    // dio la vuelta: otra vez la primera, y a los 4 s justos desde que empezó cada una (16 s por vuelta)
    expect(pista()).toBe(huecoDe(IDEAS_EDICION[0]));
    expect(saliendo()).toBe(false);
    expect(PISTA_CADA_MS).toBe(4000);
    // un solo cambio por intervalo: no se salta ninguna idea
    avanzar(PISTA_CADA_MS);
    expect(pista()).toBe(huecoDe(IDEAS_EDICION[1]));
  });

  it('inicio.edicion.la_pista_no_rota_con_el_foco_se_congela_entera_y_retoma_al_soltarlo_vacio', () => {
    montar();
    pintar();
    aEdicion();
    const { rodando, parada } = cuentas();
    // el foco para el reloj: ni el temporizador de la rotación queda vivo
    expect(rodando - parada).toBe(1);
    // se pasa a la segunda idea y, a mitad del fundido de salida de esa, se enfoca el campo
    avanzar(PISTA_CADA_MS);
    expect(pista()).toBe(huecoDe(IDEAS_EDICION[1]));
    avanzar(ANTES_DE_SALIR);
    expect(saliendo()).toBe(true);
    fireEvent.focus(campo());
    // se congela en la que estaba, y ENTERA: dejarla a medio apagar sería un campo sin pista
    expect(pista()).toBe(huecoDe(IDEAS_EDICION[1]));
    expect(saliendo()).toBe(false);
    expect(vi.getTimerCount()).toBe(parada);
    avanzar(PISTA_CADA_MS * 10, 50);
    expect(pista()).toBe(huecoDe(IDEAS_EDICION[1]));
    expect(saliendo()).toBe(false);
    expect(vi.getTimerCount()).toBe(parada);
    // al soltar el foco con el campo vacío, retoma desde esa idea, con su intervalo completo
    fireEvent.blur(campo());
    expect(vi.getTimerCount()).toBe(rodando);
    avanzar(PISTA_CADA_MS - 1);
    expect(pista()).toBe(huecoDe(IDEAS_EDICION[1]));
    avanzar(1);
    expect(pista()).toBe(huecoDe(IDEAS_EDICION[2]));
  });

  it('inicio.edicion.si_la_caja_abre_con_el_foco_en_el_campo_la_pista_nace_congelada', () => {
    // «Subir metraje» del primer uso y el mando de la caja abren Edición y le dan el foco al campo en el mismo render que lo
    // monta: la pista no debe rotar bajo el cursor de quien ya va a escribir
    montar();
    const mando = createRef<MandoCaja>();
    render(<Caja ref={mando} ir={ir} />);
    act(() => mando.current!.elegir('edicion'));
    expect(campo()).toHaveFocus();
    avanzar(PISTA_CADA_MS * 5, 50);
    expect(pista()).toBe(huecoDe(IDEAS_EDICION[0]));
    expect(saliendo()).toBe(false);
    // (el temporizador de una caja con el foco ya no tiene la rotación: se mide cuando los de otras cosas ya vencieron)
    const congelada = vi.getTimerCount();
    // al soltar el foco con el campo vacío, empieza a rotar
    fireEvent.blur(campo());
    expect(vi.getTimerCount()).toBe(congelada + 1);
    avanzar(PISTA_CADA_MS);
    expect(pista()).toBe(huecoDe(IDEAS_EDICION[1]));
  });

  it('inicio.edicion.con_texto_la_pista_no_corre_ni_arma_temporizadores_y_al_vaciar_retoma', () => {
    montar();
    pintar();
    aEdicion();
    const { rodando, parada } = cuentas();
    avanzar(PISTA_CADA_MS);
    expect(pista()).toBe(huecoDe(IDEAS_EDICION[1]));
    // con texto la pista no se ve: no corre nada, ni intervalo ni fundidos (y el campo no se queda a media luz)
    fireEvent.change(campo(), { target: { value: TEXTO } });
    expect(vi.getTimerCount()).toBe(parada);
    expect(saliendo()).toBe(false);
    avanzar(PISTA_CADA_MS * 10, 50);
    expect(pista()).toBe(huecoDe(IDEAS_EDICION[1]));
    expect(vi.getTimerCount()).toBe(parada);
    // también si lo escrito es solo un espacio: el campo ya no está vacío y la pista tampoco se ve
    fireEvent.change(campo(), { target: { value: ' ' } });
    expect(vi.getTimerCount()).toBe(parada);
    // borrar todo retoma la rotación desde esa idea
    fireEvent.change(campo(), { target: { value: '' } });
    expect(vi.getTimerCount()).toBe(rodando);
    avanzar(PISTA_CADA_MS);
    expect(pista()).toBe(huecoDe(IDEAS_EDICION[2]));
  });

  it('inicio.edicion.con_reducir_movimiento_la_pista_queda_fija_y_reacciona_si_cambia_la_preferencia', () => {
    const sistema = ponerMovimiento(true);
    montar();
    pintar();
    aEdicion();
    // quieta en la primera: sin fundido, sin rotación, sin reloj (el foco no cambia la cuenta: ya no hay nada que parar)
    const { rodando, parada } = cuentas();
    expect(rodando).toBe(parada);
    expect(pista()).toBe(huecoDe(IDEAS_EDICION[0]));
    avanzar(PISTA_CADA_MS * 10, 50);
    expect(pista()).toBe(huecoDe(IDEAS_EDICION[0]));
    expect(saliendo()).toBe(false);
    expect(vi.getTimerCount()).toBe(parada);
    expect(sistema.oyentes.size).toBeGreaterThan(0);
    // la persona apaga «reducir movimiento» con la pantalla abierta: la rotación arranca sin recargar
    sistema.cambiar(false);
    expect(vi.getTimerCount()).toBe(parada + 1);
    avanzar(PISTA_CADA_MS);
    expect(pista()).toBe(huecoDe(IDEAS_EDICION[1]));
    // y la vuelve a encender a mitad de un fundido: se queda quieta en la primera, entera, y sin reloj
    avanzar(ANTES_DE_SALIR);
    expect(saliendo()).toBe(true);
    sistema.cambiar(true);
    expect(saliendo()).toBe(false);
    expect(pista()).toBe(huecoDe(IDEAS_EDICION[0]));
    expect(vi.getTimerCount()).toBe(parada);
    avanzar(PISTA_CADA_MS * 10, 50);
    expect(pista()).toBe(huecoDe(IDEAS_EDICION[0]));
    // y la apaga de nuevo: sigue en la primera, entera (no salta de golpe, sin fundido, a la idea 2.ª que traía la rotación
    // guardada) y de ahí rota con su fundido y su intervalo completo
    sistema.cambiar(false);
    expect(pista()).toBe(huecoDe(IDEAS_EDICION[0]));
    expect(saliendo()).toBe(false);
    expect(vi.getTimerCount()).toBe(parada + 1);
    avanzar(PISTA_CADA_MS - 1);
    expect(pista()).toBe(huecoDe(IDEAS_EDICION[0]));
    avanzar(1);
    expect(pista()).toBe(huecoDe(IDEAS_EDICION[1]));
  });

  it('inicio.edicion.apagar_reducir_movimiento_sigue_en_la_primera_idea_tambien_con_el_foco_o_con_texto', () => {
    // `rota` ya es falso con el foco o con texto: el reinicio no puede colgar de que `rota` cambie, o encender y apagar la
    // preferencia en esos estados dejaría la pista saltando a la idea que iba, bajo el cursor
    const sistema = ponerMovimiento(false);
    montar();
    pintar();
    aEdicion();
    avanzar(PISTA_CADA_MS * 2);
    expect(pista()).toBe(huecoDe(IDEAS_EDICION[2]));
    // con el foco en el campo
    fireEvent.focus(campo());
    const quieta = vi.getTimerCount();
    sistema.cambiar(true);
    expect(pista()).toBe(huecoDe(IDEAS_EDICION[0]));
    sistema.cambiar(false);
    expect(pista(), 'con el foco, al apagar sigue en la primera').toBe(huecoDe(IDEAS_EDICION[0]));
    expect(saliendo()).toBe(false);
    expect(vi.getTimerCount()).toBe(quieta);
    avanzar(PISTA_CADA_MS * 5, 50);
    expect(pista()).toBe(huecoDe(IDEAS_EDICION[0]));
    // al soltar el foco con el campo vacío, rota desde la primera con su intervalo completo
    fireEvent.blur(campo());
    avanzar(PISTA_CADA_MS - 1);
    expect(pista()).toBe(huecoDe(IDEAS_EDICION[0]));
    avanzar(1);
    expect(pista()).toBe(huecoDe(IDEAS_EDICION[1]));
    avanzar(PISTA_CADA_MS);
    expect(pista()).toBe(huecoDe(IDEAS_EDICION[2]));
    // con texto escrito
    fireEvent.change(campo(), { target: { value: TEXTO } });
    const conTexto = vi.getTimerCount();
    sistema.cambiar(true);
    sistema.cambiar(false);
    expect(vi.getTimerCount()).toBe(conTexto);
    expect(pista(), 'con texto, al apagar la pista del fondo es la primera').toBe(huecoDe(IDEAS_EDICION[0]));
    // borrar todo retoma desde la primera
    fireEvent.change(campo(), { target: { value: '' } });
    expect(pista()).toBe(huecoDe(IDEAS_EDICION[0]));
    avanzar(PISTA_CADA_MS);
    expect(pista()).toBe(huecoDe(IDEAS_EDICION[1]));
  });

  it('inicio.edicion.con_la_pestana_oculta_la_pista_no_rota_ni_acumula_ciclos', () => {
    const verPestana = ponerPestana(false);
    montar();
    pintar();
    aEdicion();
    const { rodando, parada } = cuentas();
    avanzar(PISTA_CADA_MS);
    expect(pista()).toBe(huecoDe(IDEAS_EDICION[1]));
    // se oculta la pestaña: no queda ningún temporizador y, por mucho que pase, no se dispara nada ni se acumula
    verPestana(true);
    expect(vi.getTimerCount()).toBe(parada);
    avanzar(60_000, 50);
    expect(pista()).toBe(huecoDe(IDEAS_EDICION[1]));
    expect(vi.getTimerCount()).toBe(parada);
    // al volver, UNA sola idea más después de un intervalo completo, no los quince ciclos que «pasaron»
    verPestana(false);
    expect(vi.getTimerCount()).toBe(rodando);
    avanzar(ANTES_DE_SALIR - 1);
    expect(pista()).toBe(huecoDe(IDEAS_EDICION[1]));
    avanzar(1 + PISTA_FUNDIDO_MS);
    expect(pista()).toBe(huecoDe(IDEAS_EDICION[2]));
  });

  it('inicio.edicion.si_la_pestana_ya_esta_oculta_al_abrir_la_pista_no_arma_el_reloj', () => {
    const verPestana = ponerPestana(true);
    montar();
    pintar();
    aEdicion();
    const oculta = vi.getTimerCount();
    avanzar(PISTA_CADA_MS * 5, 50);
    expect(pista()).toBe(huecoDe(IDEAS_EDICION[0]));
    verPestana(false);
    expect(vi.getTimerCount()).toBe(oculta + 1);
  });

  it('inicio.edicion.la_pista_no_deja_temporizadores_al_desmontar_ni_al_cambiar_de_familia_y_en_strictmode_corre_uno_solo', () => {
    montar();
    // StrictMode monta, desmonta y vuelve a montar los efectos: si el primer reloj no se cancelara habría dos rotaciones
    // corriendo (y cada intervalo se saltaría una idea)
    const { unmount } = render(
      <StrictMode>
        <Caja ir={ir} />
      </StrictMode>,
    );
    aEdicion();
    const { rodando, parada } = cuentas();
    expect(rodando - parada).toBe(1);
    avanzar(PISTA_CADA_MS);
    expect(pista(), 'una sola rotación: pasa a la segunda, no a la tercera').toBe(huecoDe(IDEAS_EDICION[1]));
    avanzar(PISTA_CADA_MS);
    expect(pista()).toBe(huecoDe(IDEAS_EDICION[2]));
    // cambiar de familia desmonta la caja de Edición: su reloj se va con ella
    fireEvent.click(riel().getByRole('button', { name: 'Imagen' }));
    expect(vi.getTimerCount()).toBe(parada);
    aEdicion();
    expect(vi.getTimerCount()).toBe(rodando);
    // y desmontar todo no deja NADA vivo
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('inicio.edicion.la_pista_es_el_placeholder_nativo_con_el_token_de_duracion_el_gris_secundario_y_sin_aria_live', () => {
    montar();
    pintar();
    aEdicion();
    const clases = campo().className.split(/\s+/);
    // el fundido va en el `::placeholder` del propio campo (no en una capa encima): alinea idéntico al texto que se escriba,
    // no tapa clics y desaparece solo al escribir. Con los tokens de la carta y el gris secundario de siempre (6.45:1)
    expect(clases).toEqual(
      expect.arrayContaining([
        'placeholder:transition-opacity',
        'placeholder:duration-(--dur-media)',
        'placeholder:text-secundario',
        // `::placeholder` no es `*`: la regla global de «reducir movimiento» no lo alcanza y por eso lleva la suya
        'motion-reduce:placeholder:transition-none',
        'placeholder:opacity-100',
        'placeholder:ease-(--ease-salida)',
      ]),
    );
    expect(clases).not.toContain('placeholder:opacity-0');
    expect(document.querySelector('[data-pista-capa]')).toBeNull();
    // los números del reloj son los de la carta (docs/DISENO.md §4) y las curvas existen
    expect(tokens).toMatch(new RegExp(`--dur-media:\\s*${PISTA_FUNDIDO_MS}ms`));
    expect(tokens).toMatch(/--ease-salida:\s*cubic-bezier/);
    expect(tokens).toMatch(/--ease-entrada:\s*cubic-bezier/);
    // la rotación no se anuncia: ni el campo ni su cuadro son una región viva, y el nombre del campo no es la pista
    const cuadro = campo().parentElement!;
    for (const el of [campo(), cuadro]) {
      expect(el.getAttribute('aria-live')).toBeNull();
      expect(el.getAttribute('role') ?? 'textbox').not.toMatch(/status|alert|log/);
    }
    expect(cuadro.querySelector('[aria-live], [role="status"], [role="alert"]')).toBeNull();
    expect(campo()).toHaveAccessibleName('Cuéntale a la IA qué quieres');
    avanzar(PISTA_CADA_MS * 2);
    expect(pista()).toBe(huecoDe(IDEAS_EDICION[2]));
    expect(campo()).toHaveAccessibleName('Cuéntale a la IA qué quieres');
  });

  it('inicio.edicion.el_lector_de_pantalla_recibe_un_ejemplo_fijo_como_descripcion_del_campo_sin_repetirlo_a_la_vista', () => {
    montar();
    pintar();
    aEdicion();
    // las ideas ya no se alcanzan con Tab y la pista rota no se anuncia: el ejemplo fijo es la descripción del campo
    expect(EJEMPLO_FIJO).toBe('Por ejemplo: quítale las muletillas, ponle subtítulos y hazlo vertical para Reels.');
    expect(campo()).toHaveAccessibleDescription(EJEMPLO_FIJO);
    // ...y no se repite a la vista: lo que se ve ya es la pista rotando. Tampoco queda suelto en el árbol de accesibilidad: con
    // `sr-only` (invisible pero NO oculto) el lector en modo lectura lo recitaba como un párrafo entre el campo y el «+», y otra
    // vez como descripción al enfocar el campo. Oculto (`hidden`), solo lo lee `aria-describedby`
    const nota = screen.getByText(EJEMPLO_FIJO);
    expect(nota.hidden).toBe(true);
    expect(nota.className.split(/\s+/)).not.toContain('sr-only');
    expect(screen.queryAllByRole('paragraph').map(p => p.textContent)).not.toContain(EJEMPLO_FIJO);
    expect(pista()).not.toContain('quítale las muletillas');
    // sigue ahí con texto escrito y a lo largo de la rotación
    avanzar(PISTA_CADA_MS * 2);
    expect(campo()).toHaveAccessibleDescription(EJEMPLO_FIJO);
    fireEvent.change(campo(), { target: { value: TEXTO } });
    expect(campo()).toHaveAccessibleDescription(EJEMPLO_FIJO);
  });

  // A11Y-11 del prototipo: la tarjeta del inicio esconde la caja con `hidden` mientras se ve el mapa, las opciones o una lista, pero
  // NO la desmonta (perdería el texto, el video o una subida). Escondida, la pista no se ve: no debe correr nada, y al volver debe
  // empezar otra vez en la primera idea. `enVista` es lo que la tarjeta le avisa a la caja. Los nombres de estas pruebas no llevan
  // el prefijo `inicio.` (el de los invariantes del registro anti-pérdida): es una función nueva.
  describe('con la caja escondida por la tarjeta del inicio', () => {
    const escondida = <Caja ir={vi.fn()} enVista={false} />;
    const aLaVista = <Caja ir={vi.fn()} />;

    it('la_pista_no_arma_ningun_temporizador_y_al_volver_arranca_en_la_primera_idea_sin_fundido_y_rota_desde_ahi', () => {
      montar();
      const { rerender } = pintar();
      aEdicion();
      const { rodando, parada } = cuentas();
      expect(rodando - parada).toBe(1);
      avanzar(PISTA_CADA_MS * 2);
      expect(pista()).toBe(huecoDe(IDEAS_EDICION[2]));
      // se esconde: la caja sigue montada, pero la pista ya no corre
      rerender(escondida);
      expect(vi.getTimerCount()).toBe(parada);
      avanzar(PISTA_CADA_MS * 40, 50);
      expect(vi.getTimerCount()).toBe(parada);
      // vuelve a la vista: la primera idea, entera y sin salir; el reloj arma su intervalo completo y de ahí rota
      rerender(aLaVista);
      expect(vi.getTimerCount()).toBe(rodando);
      expect(pista()).toBe(huecoDe(IDEAS_EDICION[0]));
      expect(saliendo()).toBe(false);
      expect(campo().className.split(/\s+/)).toContain('placeholder:opacity-100');
      avanzar(ANTES_DE_SALIR - 1);
      expect(pista()).toBe(huecoDe(IDEAS_EDICION[0]));
      expect(saliendo()).toBe(false);
      avanzar(1);
      expect(saliendo()).toBe(true);
      avanzar(PISTA_FUNDIDO_MS);
      expect(pista()).toBe(huecoDe(IDEAS_EDICION[1]));
    });

    it('escondida_a_mitad_del_fundido_de_salida_vuelve_entera_en_la_primera_idea', () => {
      montar();
      const { rerender } = pintar();
      aEdicion();
      avanzar(PISTA_CADA_MS);
      avanzar(ANTES_DE_SALIR);
      expect(pista()).toBe(huecoDe(IDEAS_EDICION[1]));
      expect(saliendo()).toBe(true);
      rerender(escondida);
      rerender(aLaVista);
      expect(pista()).toBe(huecoDe(IDEAS_EDICION[0]));
      expect(saliendo()).toBe(false);
    });

    it('si_el_campo_tenia_el_foco_la_pista_no_vuelve_congelada_aunque_el_navegador_no_avise_con_blur', () => {
      montar();
      const { rerender } = pintar();
      aEdicion();
      const { rodando, parada } = cuentas();
      fireEvent.focus(campo());
      expect(vi.getTimerCount()).toBe(parada);
      // esconder un campo enfocado le quita el foco; Chromium lo avisa con blur, pero no se da por hecho en todos los navegadores
      // (aquí no hay aviso). Con el `enfocado` viejo la pista volvería parada, sin nadie escribiendo
      rerender(escondida);
      rerender(aLaVista);
      expect(vi.getTimerCount()).toBe(rodando);
      avanzar(PISTA_CADA_MS);
      expect(pista()).toBe(huecoDe(IDEAS_EDICION[1]));
    });

    it('lo_escrito_sobrevive_y_al_vaciarlo_ya_a_la_vista_la_pista_rota_desde_la_primera_idea', () => {
      montar();
      const { rerender } = pintar();
      aEdicion();
      avanzar(PISTA_CADA_MS);
      fireEvent.change(campo(), { target: { value: TEXTO } });
      rerender(escondida);
      rerender(aLaVista);
      // el texto no se pierde (la caja no se desmontó) y, con él, la pista sigue sin correr
      expect(campo()).toHaveValue(TEXTO);
      const conTexto = vi.getTimerCount();
      avanzar(PISTA_CADA_MS * 10, 50);
      expect(vi.getTimerCount()).toBe(conTexto);
      fireEvent.change(campo(), { target: { value: '' } });
      expect(vi.getTimerCount()).toBe(conTexto + 1);
      expect(pista()).toBe(huecoDe(IDEAS_EDICION[0]));
      avanzar(PISTA_CADA_MS);
      expect(pista()).toBe(huecoDe(IDEAS_EDICION[1]));
    });
  });

  it('el_modo_shorts_no_corre_ningun_reloj_y_al_volver_a_editar_la_pista_arranca_en_la_primera_idea', () => {
    montar();
    pintar();
    aEdicion();
    const { rodando, parada } = cuentas();
    avanzar(PISTA_CADA_MS * 2);
    expect(pista()).toBe(huecoDe(IDEAS_EDICION[2]));
    fireEvent.click(chipModo());
    fireEvent.click(screen.getByRole('option', { name: /De videos a Shorts/ }));
    // (el milisegundo deja pasar los temporizadores de 0 ms del propio React al pintar el cambio: no son de la pista)
    avanzar(1);
    expect(screen.queryByRole('textbox', { name: 'Cuéntale a la IA qué quieres' })).toBeNull();
    expect(vi.getTimerCount()).toBe(parada);
    avanzar(PISTA_CADA_MS * 10, 50);
    expect(vi.getTimerCount()).toBe(parada);
    // de vuelta a Editar el campo se monta de nuevo: la pista empieza en la primera, no donde iba cuando se fue
    fireEvent.click(screen.getByRole('button', { name: 'De videos a Shorts' }));
    fireEvent.click(screen.getByRole('option', { name: /Editar/ }));
    avanzar(1);
    expect(pista()).toBe(huecoDe(IDEAS_EDICION[0]));
    expect(saliendo()).toBe(false);
    expect(vi.getTimerCount()).toBe(rodando);
    avanzar(PISTA_CADA_MS - 1);
    expect(pista()).toBe(huecoDe(IDEAS_EDICION[1]));
  });
});

// Lo que la revisión visual y de accesibilidad (lienzo Recorrido-2, DISENO.md §4 y §5) encontró en un navegador de verdad
// y que jsdom no ve: aquí se prueba la CAUSA (la clase, el token, el atributo); las medidas reales, en
// web/e2e/inicio-edicion.spec.ts.
describe('la caja de Edición, revisión visual y de accesibilidad', () => {
  /** El color de un token de tokens.css, tal como lo lee quien escribe `text-secundario`. */
  const token = (nombre: string) => new RegExp(`--color-${nombre}:\\s*(#[0-9a-f]{6})`, 'i').exec(tokens)![1]!;
  const hex = (n: number) => Math.round(n).toString(16).padStart(2, '0');
  /** `frente` al `alfa` sobre `fondo`, como lo compone el navegador. */
  const mezclar = (frente: string, fondo: string, alfa: number) =>
    '#' +
    [1, 3, 5]
      .map(i => hex(parseInt(frente.slice(i, i + 2), 16) * alfa + parseInt(fondo.slice(i, i + 2), 16) * (1 - alfa)))
      .join('');

  it('inicio.edicion.el_campo_conserva_el_aro_de_foco_y_su_ejemplo_se_lee_con_el_gris_secundario', async () => {
    montar();
    pintar();
    await irAEdicion();
    const cuadro = campo().parentElement!.className.split(/\s+/);
    const clases = campo().className.split(/\s+/);
    // el aro de foco de la carta (§4: «en todo lo que se enfoca, sin excepción») ahora lo dibuja el CUADRO que envuelve al campo,
    // cuando algo de adentro tiene foco visible, con las medidas de tokens.css: es adonde se lleva el foco desde «Iniciar» sin
    // texto, y que se vea dónde cayó es lo que no se negocia...
    expect(cuadro).toEqual(
      expect.arrayContaining(['has-focus-visible:outline-2', 'has-focus-visible:outline-offset-3', 'has-focus-visible:outline-ambar-claro']),
    );
    expect(tokens).toMatch(/:focus-visible\s*\{\s*outline:\s*2px solid var\(--color-ambar-claro\);\s*outline-offset:\s*3px/);
    // ...y el campo NO dibuja el suyo: dos aros, uno dentro del otro, se verían como un error
    expect(clases).toContain('outline-none');
    // el ejemplo (placeholder) con el gris secundario, como el lienzo (.area::placeholder) y no con el 50 % del texto que
    // trae Tailwind por omisión: sobre la superficie da 4.39:1 y AA pide 4.5:1; sobre el fondo del cuadro (elevada) sigue pasando
    expect(clases).toContain('placeholder:text-secundario');
    expect(contraste(token('secundario'), token('superficie'))).toBeGreaterThanOrEqual(4.5);
    expect(contraste(token('secundario'), token('elevada'))).toBeGreaterThanOrEqual(4.5);
    expect(contraste(mezclar(token('texto'), token('superficie'), 0.5), token('superficie'))).toBeLessThan(4.5);
  });

  it('inicio.edicion.el_campo_vive_en_un_cuadro_con_borde_de_campo_y_fondo_elevada_y_un_clic_en_el_cuadro_enfoca_el_texto', async () => {
    montar();
    pintar();
    await irAEdicion();
    const cuadro = campo().parentElement!;
    const delCuadro = cuadro.className.split(/\s+/);
    // un cuadro bien definido (dueño, 14-oct-2026): borde de campo (#55708f, no el de línea, que no llega a 3:1), fondo de
    // campo (elevada), radio de campos (10) y relleno de 12 (múltiplo de 4)
    expect(delCuadro).toEqual(expect.arrayContaining(['border', 'border-campo', 'bg-elevada', 'rounded-medio', 'p-3']));
    expect(delCuadro).not.toContain('border-linea');
    expect(contraste(token('campo'), token('superficie'))).toBeGreaterThanOrEqual(3); // el borde se distingue de la caja
    expect(token('elevada')).not.toBe(token('superficie')); // y el fondo también
    // adentro, el campo no pone borde, fondo ni relleno propios: el cuadro es lo que se ve
    expect(campo().className.split(/\s+/)).toEqual(expect.arrayContaining(['w-full', 'border-0', 'bg-transparent', 'p-0']));
    // el texto sigue en 15 px (text-sm): nunca menos de 13
    expect(campo().className.split(/\s+/)).toContain('text-sm');
    // un clic en el relleno del cuadro (no en el texto) lleva el foco al texto sin soltarlo; en el texto, el clic sigue su camino
    expect(fireEvent.mouseDown(campo())).toBe(true);
    expect(fireEvent.mouseDown(cuadro)).toBe(false); // el navegador no debe quitarle el foco que acaba de recibir el texto
    expect(campo()).toHaveFocus();
  });

  it('inicio.edicion.el_campo_crece_para_que_su_ejemplo_no_se_corte_en_un_telefono', async () => {
    montar();
    pintar();
    await irAEdicion();
    const clases = campo().className.split(/\s+/);
    // medido con las cuatro ideas rotando: la que más ocupa son 3 renglones a 320 px (67.5 px), 2 de 360 a 861 px (45 px) y 1 a
    // 1100 (22.5 px). El piso de 96 px en teléfono (68 px desde 640 px) las cubre todas, así que el cuadro NO cambia de alto
    // al rotar (web/e2e/inicio-edicion.spec.ts lo mide); donde el navegador sabe medir el contenido (field-sizing) el campo
    // crece hasta lo que haga falta y a partir de ahí se desplaza por dentro
    expect(clases).toContain('min-h-24');
    expect(clases).toContain('min-[640px]:min-h-17');
    expect(clases).toContain('field-sizing-content');
    expect(clases).toContain('max-h-56');
  });

  it('inicio.edicion.subiendo_y_calculando_se_ven_trabajando_en_ambar_con_cursor_de_espera_y_el_clic_avisa', async () => {
    const avisos = ponerAvisos();
    const precio = diferida<CostoEdicion>();
    montar({ costo: () => precio.promesa });
    pintar();
    await irAEdicion();
    await empezarSubida();
    const comprobar = (texto: string, nota: string) => {
      const b = botonIniciar();
      expect(b).toHaveTextContent(texto);
      // «Trabajando» (docs/DISENO.md §5) conserva el ámbar y no es el gris discontinuo del apagado; el lector lo oye ocupado
      expect(b).toHaveAttribute('aria-busy', 'true');
      expect(b).toHaveAttribute('aria-disabled', 'true');
      expect(b).not.toBeDisabled();
      // (las clases con `disabled:` vienen en todo principal: se mira la clase sin variante)
      const clases = b.className.split(/\s+/);
      expect(clases).toContain('bg-ambar');
      expect(clases).toContain('cursor-progress');
      expect(clases).not.toContain('border-dashed');
      expect(b).toHaveAccessibleDescription(nota);
    };
    comprobar('Subiendo…', NOTA_SUBIENDO);
    await userEvent.click(botonIniciar());
    expect(dicho(avisos).at(-1)).toEqual({ texto: AVISO_OCUPADO, tipo: 'mal', clave: 'caja' });
    await terminarSubida();
    await waitFor(() => expect(botonIniciar()).toHaveTextContent('Calculando…'));
    comprobar('Calculando…', NOTA_CALCULANDO);
    // y al llegar el precio deja de estar ocupado y sigue dorado aunque falte el texto: aria-disabled, sin cursor de espera
    // y sin el gris discontinuo de antes
    precio.resolver(COSTO_8);
    await screen.findByRole('button', { name: 'Iniciar ✦ 8' });
    expect(botonIniciar()).not.toHaveAttribute('aria-busy');
    expect(botonIniciar()).toHaveAttribute('aria-disabled', 'true');
    expect(esDorado(botonIniciar())).toBe(true);
    expect(botonIniciar().className.split(/\s+/)).not.toContain('border-dashed');
    expect(botonIniciar().className.split(/\s+/)).not.toContain('cursor-progress');
  });

  it('inicio.edicion.cada_apagado_se_explica_con_su_propia_linea', async () => {
    ponerMonedero(5);
    let falla = true;
    montar({ costo: () => (falla ? json({ detail: 'Sin conexión con el medidor' }, 503) : COSTO_8) });
    pintar();
    await irAEdicion();
    // sin video y con texto: dónde agregarlo (antes el botón apagado no decía por qué)
    await userEvent.type(campo(), TEXTO);
    expect(botonIniciar()).toHaveAccessibleDescription(AYUDA_VIDEO);
    // con el precio sin llegar: qué hacer
    await empezarSubida();
    await terminarSubida();
    await waitFor(() => expect(botonIniciar()).toHaveTextContent(/^Iniciar$/));
    expect(botonIniciar()).toHaveAccessibleDescription(NOTA_SIN_PRECIO);
    // y sin saldo: cuánto tienes
    falla = false;
    await userEvent.click(botonIniciar());
    await screen.findByRole('button', { name: 'Iniciar ✦ 8' });
    expect(botonIniciar()).toHaveAccessibleDescription('Tienes ✦ 5: no alcanza para editar este video.');
  });

  it('inicio.edicion.el_recargar_mide_44_px_aunque_su_letra_sea_chica', async () => {
    ponerMonedero(5); // con la recarga abierta hay un botón de verdad
    montar();
    pintar();
    await irAEdicion();
    await conVideoListo();
    await userEvent.type(campo(), TEXTO);
    const recargar = screen.getByRole('button', { name: 'Recargar' });
    // el área táctil la da el relleno; los márgenes negativos la devuelven al renglón (no hace crecer la nota) y el aro de
    // foco va por dentro (por fuera taparía la línea de arriba)
    expect(recargar.className.split(/\s+/)).toEqual(expect.arrayContaining(['min-h-11', 'min-w-11', '-my-3', 'focus-visible:-outline-offset-3']));
  });
});

describe('las reglas de Edición sin pantalla', () => {
  it('inicio.edicion.el_boton_sigue_el_orden_sin_video_subiendo_sin_precio_aviso_sin_texto_sin_saldo_listo', () => {
    const listo = { fase: 'listo' as const, costo: COSTO_8 };
    expect(estadoDelBoton({ video: null, hayTexto: true, saldo: 100 })).toEqual({ tipo: 'sin_video' });
    expect(estadoDelBoton({ video: { fase: 'subiendo', costo: null }, hayTexto: true, saldo: 100 })).toEqual({ tipo: 'subiendo' });
    expect(estadoDelBoton({ video: { fase: 'calculando', costo: null }, hayTexto: true, saldo: 100 })).toEqual({ tipo: 'calculando' });
    expect(estadoDelBoton({ video: { fase: 'sin_precio', costo: null }, hayTexto: true, saldo: 100 })).toEqual({ tipo: 'sin_precio' });
    expect(estadoDelBoton({ video: { fase: 'listo', costo: FUERA }, hayTexto: true, saldo: 100 })).toEqual({ tipo: 'fuera', aviso: FUERA.aviso });
    // un aviso manda sobre el texto y sobre el saldo
    expect(estadoDelBoton({ video: { fase: 'listo', costo: FUERA }, hayTexto: false, saldo: 0 }).tipo).toBe('fuera');
    expect(estadoDelBoton({ video: listo, hayTexto: false, saldo: 0 })).toEqual({ tipo: 'sin_texto', creditos: 8 });
    expect(estadoDelBoton({ video: listo, hayTexto: true, saldo: 5 })).toEqual({ tipo: 'sin_saldo', creditos: 8, faltan: 3 });
    expect(estadoDelBoton({ video: listo, hayTexto: true, saldo: 8 })).toEqual({ tipo: 'listo', creditos: 8 });
    // un saldo que no se sabe no bloquea a nadie
    expect(estadoDelBoton({ video: listo, hayTexto: true, saldo: null })).toEqual({ tipo: 'listo', creditos: 8 });
    // si el servidor no manda aviso pero tampoco deja editar, no se enciende
    expect(estadoDelBoton({ video: { fase: 'listo', costo: { ...COSTO_8, backend_listo: false } }, hayTexto: true, saldo: 100 }).tipo).toBe('fuera');
  });

  it('inicio.edicion.el_reloj_el_tamano_y_lo_que_falta_tras_un_402', () => {
    expect(reloj(724)).toBe('12:04');
    expect(reloj(72)).toBe('1:12');
    expect(reloj(7)).toBe('0:07');
    expect(reloj(4680)).toBe('1:18:00');
    expect(tamano(824_000_000)).toBe('824 MB');
    expect(tamano(1_400_000_000)).toBe('1.4 GB');
    expect(tamano(10)).toBe('1 MB');
    expect(faltanTras402('Créditos insuficientes: esta acción cuesta 8 créditos y tu saldo es 5.', 8, 100)).toBe(3);
    expect(faltanTras402('otro texto', 8, 5)).toBe(3);
    expect(faltanTras402('otro texto', 8, null)).toBe(8);
    expect(faltanTras402(undefined, 8, 20)).toBe(1);
  });
});

