// «De videos a Shorts», el segundo modo del chip «Editar ▾» de la caja del inicio, como COMPORTAMIENTO. La caja no cobra
// nada en este modo: «Iniciar» navega a /estudio/shorts/ (la pantalla que muestra cada precio y cobra con su propio botón),
// así que lo que más se vigila aquí es que NADA salga a la red ni al monedero desde la caja, y que Editar siga como estaba
// (Edicion.test.tsx lo cubre entero: 86 pruebas que no se tocaron salvo las dos que contaban opciones del chip).
//
// Los nombres de estas pruebas no llevan el prefijo `inicio.`: ese es el de los invariantes del registro anti-pérdida
// (tests/test_migracion_ui.py) y esto es una función nueva, no algo que la pantalla vieja garantizara.
//
// Nada de esto gasta dinero: el servidor, la subida a S3 (XHR) y el cobro son dobles; `ir` es un espía.
import { createRef } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { json, llamadas, oirCobros, ponerAvisos, ponerMonedero, servidor, type Ruta } from '../../prueba/servidor';
import { LIGA_INVALIDA, ligaDeLaUrl } from '../shorts/logica';
import { Caja, type MandoCaja } from './Caja';
import {
  APOYO_SHORTS,
  AVISO_OCUPADO,
  AVISO_SIN_FUENTE,
  destinoShorts,
  estadoDeShorts,
  huecoDe,
  IDEAS_EDICION,
  modoDe,
  MODOS_EDICION,
  NOTA_SHORTS_SIGUE,
  NOTA_SHORTS_VACIA,
} from './edicion';
import type { CostoEdicion } from './envio';

const COSTO_8: CostoEdicion = {
  fuente: 'videos/entrevista/subidas/entrevista.mp4',
  duracion_s: 724,
  con_transcript: false,
  creditos: 8,
  backend_listo: true,
  aviso: null,
};
const LIGA = 'https://www.youtube.com/watch?v=abc123DEF45';
const TEXTO = 'Quítale las muletillas y los silencios';

// el PUT a S3 va por XHR (para tener progreso): uno de mentira que la prueba mueve
class XhrFalso {
  static todos: XhrFalso[] = [];
  status = 0;
  upload: { onprogress: ((ev: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  abortado = false;
  constructor() {
    XhrFalso.todos.push(this);
  }
  open() {}
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
  sugerir?: Ruta;
  /** GET /api/editar/<p>: la corrida. */
  estado?: Ruta;
}

function montar(m: Mundo = {}) {
  return servidor({
    '/api/media/config': () => json({ activo: true, cdn: '' }),
    '/api/media/presign': (_u, init) => {
      const b = JSON.parse(String(init?.body)) as { proyecto: string; archivo: string; content_type: string };
      return json({ url: 'https://s3.ejemplo/subida?firma=1', key: `videos/${b.proyecto}/subidas/${b.archivo}`, content_type: b.content_type });
    },
    '/api/media/confirmar': () => json({ archivo: 'entrevista.mp4', cdn: '' }),
    '/api/media': () => json({ subidas: [] }),
    '/api/moderar': () => json({ permitido: true }),
    '/api/editar': (url, init) => {
      if (url.endsWith('/costo')) return json(COSTO_8);
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

function video(nombre = 'entrevista.mp4', bytes = 824_000_000) {
  const f = new File(['x'], nombre, { type: 'video/mp4' });
  Object.defineProperty(f, 'size', { value: bytes });
  return f;
}

const pintar = () => render(<Caja ir={ir} />);
const entrada = () => document.querySelector<HTMLInputElement>('input[type="file"]')!;
const riel = () => within(screen.getByRole('group', { name: 'Qué quieres crear' }));
const campoTexto = () => screen.getByRole('textbox', { name: 'Cuéntale a la IA qué quieres' });
const campoLiga = () => screen.getByRole('textbox', { name: 'Liga de YouTube' });
const botonIniciar = () => screen.getByRole('button', { name: /^(Iniciar|Subiendo|Calculando|Iniciando)/ });
const botonMas = () => screen.getByRole('button', { name: /^(Agregar el video que quieres editar|Agregar el video largo|Cambiar el video)$/ });
// el chip: su nombre es el del modo de ahora (la ▾ es decoración)
const chip = (nombre: 'Editar' | 'De videos a Shorts') => screen.getByRole('button', { name: nombre });
const dicho = (a: ReturnType<typeof ponerAvisos>) => a.mostrar.mock.calls.map(c => ({ texto: c[0], ...c[1] }));
/** Lo que salió a la red hacia una ruta (de cualquier método). */
const alaRed = (f: ReturnType<typeof montar>, ruta: string) => f.mock.calls.filter(c => String(c[0]).startsWith(ruta));
const esDorado = (b: HTMLElement) => {
  const clases = b.className.split(/\s+/);
  return clases.includes('bg-ambar') && !clases.some(c => ['border-dashed', 'bg-superficie', 'text-secundario'].includes(c));
};

async function irAEdicion() {
  await userEvent.click(riel().getByRole('button', { name: 'Edición' }));
}
async function elegirModo(nombre: 'Editar' | 'De videos a Shorts') {
  await userEvent.click(chip(nombre === 'Editar' ? 'De videos a Shorts' : 'Editar'));
  await userEvent.click(screen.getByRole('option', { name: new RegExp(nombre) }));
}
/** La caja de Edición ya en el modo Shorts. */
async function enShorts() {
  await irAEdicion();
  await elegirModo('De videos a Shorts');
}
async function pegarLiga(liga = LIGA) {
  await userEvent.click(campoLiga());
  await userEvent.paste(liga);
}

/** Elige el video y deja la subida a medias: el PUT a S3 ya salió. */
async function empezarSubida(f = video()) {
  const antes = XhrFalso.todos.length;
  await userEvent.upload(entrada(), f);
  await waitFor(() => expect(XhrFalso.todos).toHaveLength(antes + 1));
  return ultimoXhr();
}
/** Termina el PUT: confirma y, en Editar, pide el precio. */
async function terminarSubida() {
  await act(async () => {
    ultimoXhr().terminar();
  });
}

describe('el chip «Editar ▾» y su segunda opción', () => {
  it('lista Editar y De videos a Shorts, cada una con su nota y «según el video»', async () => {
    montar();
    pintar();
    await irAEdicion();
    expect(MODOS_EDICION.map(m => m.rotulo)).toEqual(['Editar', 'De videos a Shorts']);
    const el = chip('Editar');
    expect(el).toHaveAttribute('data-pista', MODOS_EDICION[0].nota);
    await userEvent.click(el);
    const [editar, shorts] = within(screen.getByRole('listbox', { name: 'Opciones' })).getAllByRole('option');
    expect(editar).toHaveAttribute('aria-selected', 'true');
    expect(shorts).toHaveAttribute('aria-selected', 'false');
    expect(shorts).toHaveTextContent('De videos a Shorts');
    expect(shorts).toHaveTextContent('según el video');
    expect(shorts).toHaveTextContent('Sube un video largo y te daremos los mejores momentos.');
  });

  it('elegir De videos a Shorts cambia el cuerpo de la caja y el chip dice el modo de ahora', async () => {
    montar();
    pintar();
    await irAEdicion();
    expect(campoTexto()).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Liga de YouTube' })).toBeNull();
    await elegirModo('De videos a Shorts');
    // el chip dice el modo de ahora, conserva el foco (SelectorOpcion lo devuelve) y su pista es la nota de Shorts
    const el = chip('De videos a Shorts');
    expect(el).toHaveTextContent(/^De videos a Shorts ▾$/);
    expect(el).toHaveFocus();
    expect(el).toHaveAttribute('aria-expanded', 'false');
    expect(el).toHaveAttribute('data-pista', 'Sube un video largo y te daremos los mejores momentos.');
    // el cuerpo: el apoyo, el campo de la liga (type=url, su pista) y NO el cuadro donde se le escribe a la IA
    expect(screen.getByText(APOYO_SHORTS)).toBeInTheDocument();
    expect(APOYO_SHORTS).toBe('Sube un video largo o pega la liga de YouTube y te proponemos los mejores momentos como shorts.');
    expect(campoLiga()).toHaveAttribute('type', 'url');
    expect(campoLiga()).toHaveAttribute('placeholder', 'Pega la liga de YouTube');
    expect(screen.queryByRole('textbox', { name: 'Cuéntale a la IA qué quieres' })).toBeNull();
    expect(screen.queryByText('Escribe qué quieres hacer con tu video.')).toBeNull();
    // la fila es la de siempre: el «+» (que aquí dice «el video largo»), el chip y UN «Iniciar» sin precio
    expect(botonMas()).toHaveAccessibleName('Agregar el video largo');
    const botones = screen.getAllByRole('button');
    expect(botones.indexOf(el)).toBe(botones.indexOf(botonMas()) + 1);
    expect(botonIniciar()).toHaveTextContent(/^Iniciar$/);
    expect(botonIniciar()).not.toHaveTextContent('✦');
    // la promesa: subir no cuesta, y el precio llega cuando termina
    expect(NOTA_SHORTS_VACIA).toBe('Subirlo no cuesta nada: el precio aparece cuando termina de subir.');
    expect(screen.getByText(NOTA_SHORTS_VACIA)).toBeInTheDocument();
  });

  it('el chip se maneja con teclado: ↓ abre, ↓ baja a Shorts, Enter la elige y el foco queda en el chip; y de vuelta', async () => {
    montar();
    pintar();
    await irAEdicion();
    chip('Editar').focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('option', { name: /Editar/ })).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('option', { name: /De videos a Shorts/ })).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(chip('De videos a Shorts')).toHaveFocus();
    expect(campoLiga()).toBeInTheDocument();
    // al reabrir, la lista parte de la opción de ahora (Shorts), y ↑ + Espacio vuelven a Editar
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('option', { name: /De videos a Shorts/ })).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}');
    await userEvent.keyboard(' ');
    expect(chip('Editar')).toHaveFocus();
    expect(campoTexto()).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Liga de YouTube' })).toBeNull();
  });

  it('elegir el modo de ahora solo cierra la lista: no borra lo escrito ni cambia nada', async () => {
    const f = montar();
    pintar();
    await enShorts();
    await pegarLiga();
    await userEvent.click(chip('De videos a Shorts'));
    await userEvent.click(screen.getByRole('option', { name: /De videos a Shorts/ }));
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(campoLiga()).toHaveValue(LIGA);
    expect(f).not.toHaveBeenCalled();
    expect(ir).not.toHaveBeenCalled();
    // ni siquiera lo que la caja ya dijo: un error de la liga sigue ahí si se vuelve a elegir el mismo modo
    await userEvent.clear(campoLiga());
    await userEvent.paste('https://vimeo.com/123456789');
    await userEvent.click(botonIniciar());
    expect(screen.getByText(LIGA_INVALIDA)).toBeInTheDocument();
    await userEvent.click(chip('De videos a Shorts'));
    await userEvent.click(screen.getByRole('option', { name: /De videos a Shorts/ }));
    expect(screen.getByText(LIGA_INVALIDA)).toBeInTheDocument();
    // y cambiar de verdad de modo sí lo deja atrás: el error era de ese cuerpo
    await elegirModo('Editar');
    await elegirModo('De videos a Shorts');
    expect(screen.queryByText(LIGA_INVALIDA)).toBeNull();
    expect(campoLiga()).toHaveValue('https://vimeo.com/123456789');
  });
});

describe('el modo se conserva', () => {
  it('cambiar de familia y volver deja el modo Shorts y la liga como estaban; Editar conserva su texto', async () => {
    montar();
    pintar();
    await irAEdicion();
    await userEvent.type(campoTexto(), TEXTO);
    await elegirModo('De videos a Shorts');
    await pegarLiga();
    // ir a Video y volver: el modo no se reinicia a Editar (la caja de Edición se desmonta, el estado no)
    await userEvent.click(riel().getByRole('button', { name: 'Video' }));
    expect(screen.queryByRole('textbox', { name: 'Liga de YouTube' })).toBeNull();
    await irAEdicion();
    expect(chip('De videos a Shorts')).toBeInTheDocument();
    expect(campoLiga()).toHaveValue(LIGA);
    // y al volver a Editar, el texto que se había escrito sigue ahí (y la liga, para cuando se regrese)
    await elegirModo('Editar');
    expect(campoTexto()).toHaveValue(TEXTO);
    await elegirModo('De videos a Shorts');
    expect(campoLiga()).toHaveValue(LIGA);
  });

  it('el modo no se pierde por rotar la pista de Editar ni por abrir y cerrar la lista', async () => {
    montar();
    pintar();
    await enShorts();
    await userEvent.click(chip('De videos a Shorts'));
    await userEvent.keyboard('{Escape}');
    await userEvent.click(chip('De videos a Shorts'));
    await userEvent.click(document.body);
    expect(chip('De videos a Shorts')).toBeInTheDocument();
    expect(campoLiga()).toBeInTheDocument();
  });

  it('el mando de la caja que elige Edición, estando en Shorts, le da el foco al campo de la liga (también desde otra familia)', async () => {
    montar();
    const mando = createRef<MandoCaja>();
    render(<Caja ref={mando} ir={ir} />);
    await irAEdicion();
    await elegirModo('De videos a Shorts');
    // ya en Edición: el campo que tiene el foco es el de la liga, no un cuadro de texto que no existe
    botonMas().focus();
    act(() => mando.current!.elegir('edicion'));
    expect(campoLiga()).toHaveFocus();
    // desde otra familia: el campo aún no existe cuando se pide, y el foco llega cuando se monta
    await userEvent.click(riel().getByRole('button', { name: 'Video' }));
    act(() => mando.current!.elegir('edicion'));
    expect(chip('De videos a Shorts')).toBeInTheDocument();
    expect(campoLiga()).toHaveFocus();
  });

  it('en Shorts no corre ninguna pista rotatoria; al volver a Editar, sí', () => {
    vi.useFakeTimers();
    montar();
    pintar();
    // jsdom deja un setTimeout(0) por cada focus(): se vacían con 1 ms para contar solo lo que de verdad queda vivo
    const vivos = () => {
      act(() => {
        vi.advanceTimersByTime(1);
      });
      return vi.getTimerCount();
    };
    fireEvent.click(riel().getByRole('button', { name: 'Edición' }));
    // con la pista rodando y con ella parada (el foco la para): su diferencia es la rotación
    const rodando = vivos();
    fireEvent.focus(campoTexto());
    const parada = vivos();
    fireEvent.blur(campoTexto());
    expect(vivos() - parada, 'Editar rota su pista con UN temporizador').toBe(1);
    expect(campoTexto()).toHaveAttribute('placeholder', huecoDe(IDEAS_EDICION[0]));
    fireEvent.click(chip('Editar'));
    fireEvent.click(screen.getByRole('option', { name: /De videos a Shorts/ }));
    expect(vivos(), 'Shorts no tiene pista que rotar').toBe(parada);
    fireEvent.click(chip('De videos a Shorts'));
    fireEvent.click(screen.getByRole('option', { name: /Editar/ }));
    expect(vivos()).toBe(rodando);
  });
});

describe('«Iniciar» en Shorts con una liga', () => {
  it('una liga de YouTube navega a /estudio/shorts/?url=<liga codificada> y no toca la red, el monedero ni los avisos', async () => {
    ponerMonedero(100);
    const avisos = ponerAvisos();
    const cobros = oirCobros();
    const f = montar();
    pintar();
    await enShorts();
    const liga = 'https://www.youtube.com/watch?v=abc123DEF45&t=30s';
    // sin liga, «Iniciar» sigue apagado y dice qué falta; con ella se enciende y dice a dónde lleva
    expect(botonIniciar()).toHaveAttribute('aria-disabled', 'true');
    await pegarLiga(liga);
    expect(botonIniciar()).not.toHaveAttribute('aria-disabled');
    expect(botonIniciar()).toHaveTextContent(/^Iniciar$/);
    expect(esDorado(botonIniciar())).toBe(true);
    expect(botonIniciar()).toHaveAttribute('aria-describedby', screen.getByText(NOTA_SHORTS_SIGUE).id);
    expect(NOTA_SHORTS_SIGUE).toBe('Te llevamos a Shorts: ahí ves el precio antes de que se cobre algo.');
    expect(screen.queryByText(NOTA_SHORTS_VACIA)).toBeNull();
    await userEvent.click(botonIniciar());
    expect(ir).toHaveBeenCalledTimes(1);
    expect(ir).toHaveBeenCalledWith('/estudio/shorts/?url=' + encodeURIComponent(liga));
    // la caja solo navega: nada de cotizar, importar, moderar ni cobrar desde aquí (eso es de la pantalla de Shorts)
    expect(f).not.toHaveBeenCalled();
    expect(cobros).toEqual([]);
    expect(dicho(avisos)).toEqual([]);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('Enter en el campo es «Iniciar»; la liga viaja sin los espacios de los extremos y las ligas youtu.be y /shorts/ valen', async () => {
    montar();
    pintar();
    await enShorts();
    await userEvent.click(campoLiga());
    await userEvent.paste('  https://youtu.be/abc123DEF45  ');
    await userEvent.keyboard('{Enter}');
    expect(ir).toHaveBeenLastCalledWith('/estudio/shorts/?url=' + encodeURIComponent('https://youtu.be/abc123DEF45'));
    await userEvent.clear(campoLiga());
    await userEvent.paste('https://www.youtube.com/shorts/abc123DEF45');
    await userEvent.click(botonIniciar());
    expect(ir).toHaveBeenLastCalledWith('/estudio/shorts/?url=' + encodeURIComponent('https://www.youtube.com/shorts/abc123DEF45'));
    expect(ir).toHaveBeenCalledTimes(2);
  });

  it('una liga que no es de YouTube se corrige junto al campo: no navega, no gasta nada y el error se va al escribir', async () => {
    ponerMonedero(100);
    const avisos = ponerAvisos();
    const cobros = oirCobros();
    const f = montar();
    pintar();
    await enShorts();
    await pegarLiga('https://vimeo.com/123456789');
    await userEvent.click(botonIniciar());
    expect(ir).not.toHaveBeenCalled();
    expect(f).not.toHaveBeenCalled();
    expect(cobros).toEqual([]);
    // el error va junto al campo (no en el cuadro de abajo a la derecha), con el texto de Shorts, y el foco vuelve al campo
    expect(screen.getByText(LIGA_INVALIDA)).toBeInTheDocument();
    expect(campoLiga()).toHaveAttribute('aria-invalid', 'true');
    expect(campoLiga()).toHaveAccessibleDescription(LIGA_INVALIDA);
    expect(campoLiga()).toHaveFocus();
    expect(dicho(avisos)).toEqual([]);
    // corregirla (o seguir escribiendo) quita el error y deja navegar
    await userEvent.type(campoLiga(), '{Backspace}');
    expect(screen.queryByText(LIGA_INVALIDA)).toBeNull();
    expect(campoLiga()).not.toHaveAttribute('aria-invalid');
    await userEvent.clear(campoLiga());
    await userEvent.paste(LIGA);
    await userEvent.click(botonIniciar());
    expect(ir).toHaveBeenCalledTimes(1);
  });

  it('sin liga ni video avisa qué falta en el cuadro de avisos, no navega y el botón sigue enfocable', async () => {
    const avisos = ponerAvisos();
    const f = montar();
    pintar();
    await enShorts();
    const boton = botonIniciar();
    expect(boton).toHaveAttribute('aria-disabled', 'true');
    expect(boton).not.toBeDisabled();
    expect(boton).toHaveAttribute('aria-describedby', screen.getByText(NOTA_SHORTS_VACIA).id);
    await userEvent.click(boton);
    expect(AVISO_SIN_FUENTE).toBe('Primero pega la liga de YouTube o agrega el video con el «+».');
    expect(dicho(avisos)).toEqual([{ texto: AVISO_SIN_FUENTE, tipo: 'mal', clave: 'caja' }]);
    expect(boton).toHaveFocus();
    expect(ir).not.toHaveBeenCalled();
    expect(f).not.toHaveBeenCalled();
    // una liga de solo espacios es no tener liga
    await userEvent.click(campoLiga());
    await userEvent.keyboard('   ');
    expect(botonIniciar()).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(botonIniciar());
    expect(dicho(avisos)).toHaveLength(2);
    expect(ir).not.toHaveBeenCalled();
    // escribir la liga quita el aviso que decía que faltaba
    await userEvent.type(campoLiga(), 'h');
    expect(avisos.quitar).toHaveBeenCalledWith('caja');
  });

  it('el aviso de que falta algo también sale sin el cuadro de avisos: junto a la caja', async () => {
    montar();
    pintar();
    await enShorts();
    await userEvent.click(botonIniciar());
    expect(screen.getByRole('alert')).toHaveTextContent(AVISO_SIN_FUENTE);
    expect(ir).not.toHaveBeenCalled();
  });

  it('el campo de la liga y el chip miden al menos 44 px y el campo no se desborda con una liga larguísima', async () => {
    montar();
    pintar();
    await enShorts();
    expect(campoLiga().className.split(/\s+/)).toContain('min-h-11');
    expect(chip('De videos a Shorts').className.split(/\s+/)).toEqual(expect.arrayContaining(['min-h-12', 'min-[640px]:min-h-11']));
    expect(campoLiga()).toHaveAttribute('maxlength', '2000');
  });
});

describe('«Iniciar» en Shorts con un video subido desde el «+»', () => {
  it('sube con la tarjeta y el progreso de Editar, no pide el precio de Edición y «Iniciar» lleva a /estudio/shorts/?p=<proyecto>', async () => {
    ponerMonedero(100);
    const avisos = ponerAvisos();
    const cobros = oirCobros();
    const f = montar();
    pintar();
    await enShorts();
    await pegarLiga('https://youtu.be/abc123DEF45'); // una liga ya escrita: manda el video, no ella
    const xhr = await empezarSubida();
    // subiendo: la tarjeta con su barra (y la liga se hace a un lado), «Iniciar» dice «Subiendo…», ocupado, y no navega
    act(() => xhr.avanzar(412_000_000, 824_000_000));
    expect(await screen.findByRole('progressbar', { name: 'Subiendo el video' })).toHaveAttribute('aria-valuenow', '50');
    expect(screen.getByText('entrevista.mp4')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Liga de YouTube' })).toBeNull();
    expect(botonIniciar()).toHaveTextContent(/^Subiendo…$/);
    expect(botonIniciar()).toHaveAttribute('aria-busy', 'true');
    expect(botonIniciar()).toHaveAttribute('aria-disabled', 'true');
    expect(botonMas()).toHaveAccessibleName('Cambiar el video');
    await userEvent.click(botonIniciar());
    expect(dicho(avisos).at(-1)).toEqual({ texto: AVISO_OCUPADO, tipo: 'mal', clave: 'caja' });
    expect(ir).not.toHaveBeenCalled();
    // terminó: «Iniciar» sin precio, encendido, y la nota dice que lleva a Shorts
    await terminarSubida();
    await waitFor(() => expect(botonIniciar()).toHaveTextContent(/^Iniciar$/));
    expect(botonIniciar()).not.toHaveAttribute('aria-disabled');
    expect(botonIniciar()).not.toHaveAttribute('aria-busy');
    expect(screen.getByText(NOTA_SHORTS_SIGUE)).toBeInTheDocument();
    // la nota de Editar no aparece: no se edita una copia ni se calculó ningún precio de Edición
    expect(screen.queryByText(/Se edita una copia/)).toBeNull();
    expect(alaRed(f, '/api/editar')).toEqual([]);
    await userEvent.click(botonIniciar());
    expect(ir).toHaveBeenCalledTimes(1);
    expect(ir).toHaveBeenCalledWith('/estudio/shorts/?p=entrevista');
    // desde la caja no se cobró nada ni se pidió nada de Edición
    expect(cobros).toEqual([]);
    expect(alaRed(f, '/api/editar')).toEqual([]);
  });

  it('quitar el video devuelve el campo de la liga con lo que estaba escrito, y cancelar una subida no deja nada', async () => {
    montar();
    pintar();
    await enShorts();
    await pegarLiga();
    const xhr = await empezarSubida();
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar la subida' }));
    expect(xhr.abortado).toBe(true);
    await waitFor(() => expect(screen.queryByText('entrevista.mp4')).toBeNull());
    expect(campoLiga()).toHaveValue(LIGA);
    expect(botonMas()).toHaveFocus();
    // subir otro, esta vez completo, y quitarlo
    await empezarSubida();
    await terminarSubida();
    await userEvent.click(await screen.findByRole('button', { name: 'Quitar este video' }));
    expect(campoLiga()).toHaveValue(LIGA);
    expect(ir).not.toHaveBeenCalled();
  });

  it('varios videos a la vez: se toma el primero y se dice en el idioma de Shorts', async () => {
    const avisos = ponerAvisos();
    montar();
    pintar();
    await enShorts();
    // el selector de archivos no es `multiple`: lo que llega de varios es lo que se suelta en la caja
    const seccion = screen.getByRole('heading', { name: '¿Qué vamos a crear hoy?' }).closest('section')!;
    fireEvent.drop(seccion, { dataTransfer: { files: [video('uno.mp4'), video('dos.mp4')], types: ['Files'] } });
    await waitFor(() => expect(XhrFalso.todos).toHaveLength(1));
    expect(dicho(avisos)).toContainEqual({ texto: 'Por ahora se saca de un video a la vez: usamos «uno.mp4».', tipo: 'ok', clave: 'caja' });
  });

  it('un video que subió en Shorts pide el precio de Edición al pasar a Editar, como si hubiera subido allí', async () => {
    ponerMonedero(100);
    const f = montar();
    pintar();
    await enShorts();
    await empezarSubida();
    await terminarSubida();
    await waitFor(() => expect(botonIniciar()).toHaveTextContent(/^Iniciar$/));
    expect(alaRed(f, '/api/editar')).toEqual([]);
    await elegirModo('Editar');
    // ya con precio (✦ 8) y con la nota de la copia; solo falta decirle a la IA qué quiere
    await waitFor(() => expect(alaRed(f, '/api/editar/entrevista/costo')).toHaveLength(1));
    await userEvent.type(campoTexto(), TEXTO);
    expect(await screen.findByRole('button', { name: 'Iniciar ✦ 8' })).toBeInTheDocument();
    expect(screen.getByText(/Se edita una copia/)).toBeInTheDocument();
    // y al volver a Shorts el mismo video sigue siendo el que se manda, sin pedir nada más
    await elegirModo('De videos a Shorts');
    await userEvent.click(botonIniciar());
    expect(ir).toHaveBeenCalledWith('/estudio/shorts/?p=entrevista');
    expect(alaRed(f, '/api/editar/entrevista/costo')).toHaveLength(1);
    expect(llamadas(f, '/api/editar/entrevista/sugerir')).toHaveLength(0);
  });

  it('cambiar de modo a media subida: el precio de Edición se pide solo si al terminar el modo es Editar', async () => {
    const f = montar();
    pintar();
    await irAEdicion();
    // empieza en Editar y a media subida pasa a Shorts: al terminar NO se pide el precio, y «Iniciar» navega con el proyecto
    await empezarSubida();
    await elegirModo('De videos a Shorts');
    expect(botonIniciar()).toHaveTextContent(/^Subiendo…$/);
    await terminarSubida();
    await waitFor(() => expect(botonIniciar()).toHaveTextContent(/^Iniciar$/));
    expect(alaRed(f, '/api/editar')).toEqual([]);
    await userEvent.click(botonIniciar());
    expect(ir).toHaveBeenCalledWith('/estudio/shorts/?p=entrevista');
    // quitarlo, y ahora al revés: empieza en Shorts y a media subida pasa a Editar: al terminar SÍ se pide
    await userEvent.click(screen.getByRole('button', { name: 'Quitar este video' }));
    await empezarSubida();
    await elegirModo('Editar');
    await terminarSubida();
    await waitFor(() => expect(alaRed(f, '/api/editar/entrevista/costo')).toHaveLength(1));
    await userEvent.type(campoTexto(), TEXTO);
    expect(await screen.findByRole('button', { name: 'Iniciar ✦ 8' })).toBeInTheDocument();
  });
});

describe('Editar no cambia por tener un hermano', () => {
  it('después de pasar por Shorts, Editar sigue cobrando por el servidor y NO navega', async () => {
    ponerMonedero(100);
    const cobros = oirCobros();
    const f = montar();
    pintar();
    await enShorts();
    await pegarLiga();
    await elegirModo('Editar');
    await empezarSubida();
    await terminarSubida();
    await userEvent.type(campoTexto(), TEXTO);
    await userEvent.click(await screen.findByRole('button', { name: 'Iniciar ✦ 8' }));
    await waitFor(() => expect(llamadas(f, '/api/editar/entrevista/sugerir')).toHaveLength(1));
    expect(JSON.parse(String(llamadas(f, '/api/editar/entrevista/sugerir')[0]![1]!.body))).toEqual({ instruccion: TEXTO });
    await waitFor(() => expect(cobros).toHaveLength(1));
    expect(ir).not.toHaveBeenCalled();
  });

  it('con una corrida de Edición en curso, «Iniciar» en Shorts respeta la regla de una tarea a la vez: avisa y no navega', async () => {
    ponerMonedero(100);
    const avisos = ponerAvisos();
    montar();
    pintar();
    await irAEdicion();
    await empezarSubida();
    await terminarSubida();
    await userEvent.type(campoTexto(), TEXTO);
    await userEvent.click(await screen.findByRole('button', { name: 'Iniciar ✦ 8' }));
    await waitFor(() => expect(dicho(avisos).at(-1)!.texto).toMatch(/Ya estamos editando tu video/));
    await elegirModo('De videos a Shorts');
    await pegarLiga();
    await userEvent.click(botonIniciar());
    expect(dicho(avisos).at(-1)).toEqual({ texto: AVISO_OCUPADO, tipo: 'mal', clave: 'caja' });
    expect(ir).not.toHaveBeenCalled();
  });
});

describe('las reglas de Shorts sin pantalla', () => {
  it('el botón sigue el orden sin fuente, subiendo, listo; con un video manda él aunque haya liga', () => {
    expect(estadoDeShorts({ video: null, liga: '' })).toEqual({ tipo: 'sin_fuente' });
    expect(estadoDeShorts({ video: null, liga: '   ' })).toEqual({ tipo: 'sin_fuente' });
    expect(estadoDeShorts({ video: null, liga: LIGA })).toEqual({ tipo: 'listo' });
    expect(estadoDeShorts({ video: { fase: 'subiendo' }, liga: '' })).toEqual({ tipo: 'subiendo' });
    expect(estadoDeShorts({ video: { fase: 'subiendo' }, liga: LIGA })).toEqual({ tipo: 'subiendo' });
    // un video ya subido está listo en cualquier fase: el precio que falte (o el que falló) es de Editar, no de Shorts
    for (const fase of ['calculando', 'listo', 'sin_precio'] as const) {
      expect(estadoDeShorts({ video: { fase }, liga: '' })).toEqual({ tipo: 'listo' });
    }
  });

  it('destinoShorts codifica la liga y el proyecto para que lleguen enteros a la pantalla de Shorts', () => {
    expect(destinoShorts({ proyecto: 'entrevista' })).toBe('/estudio/shorts/?p=entrevista');
    expect(destinoShorts({ proyecto: 'mi charla' })).toBe('/estudio/shorts/?p=mi%20charla');
    expect(destinoShorts({ liga: LIGA })).toBe('/estudio/shorts/?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3Dabc123DEF45');
    // lo que la caja manda es lo que la pantalla lee, con cualquier cosa rara que traiga la liga (&, =, #, +, %, acentos, espacios)
    for (const liga of [LIGA, 'https://youtu.be/abc123DEF45?si=a+b&t=1m2s#x', 'https://www.youtube.com/watch?v=abc123DEF45&list=ñ%20é', 'https://youtu.be/abc123DEF45 ?a=b']) {
      const url = new URL(destinoShorts({ liga }), 'http://localhost');
      expect(url.pathname).toBe('/estudio/shorts/');
      expect([...url.searchParams.keys()]).toEqual(['url']);
      expect(ligaDeLaUrl(url.search)).toBe(liga.trim());
    }
  });

  it('modoDe devuelve el modo con ese id', () => {
    expect(modoDe('editar').rotulo).toBe('Editar');
    expect(modoDe('shorts').rotulo).toBe('De videos a Shorts');
    expect(modoDe('shorts').detalle).toBe('según el video');
  });
});
