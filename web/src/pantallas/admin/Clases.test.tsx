// «4 · Clases» del panel como COMPORTAMIENTO (docs/PLAN-UI.md §5). Cada test empieza por el ID de su invariante: tests/test_migracion_ui.py
// exige que cada ID del registro exista aquí. El servidor es de mentira (un mundo en memoria con las rutas del contrato, sección 5.1 del
// diseño de la Guía de clases), el PUT a S3 es un XHR que la prueba mueve a mano, y NADA sale a la red ni llama a un proveedor de pago.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { diferida, ponerXhrFalso, ultimoXhr, video as archivoDeVideo, XhrFalso } from '../../prueba/edicion';
import { json } from '../../prueba/servidor';
import { Admin } from './Admin';
import { Clases } from './Clases';
import type { Resumen } from './logica';
import type { Clase, LimitesClases } from './logicaClases';
import { TEXTO_FALLO_SUBIDA, TEXTO_SUBIDA_CANCELADA } from './useSubidaClase';

const LIMITES: LimitesClases = {
  max_bytes: 5368709120,
  extensiones: ['.mp4', '.mov', '.m4v'],
  content_types: ['video/mp4', 'video/quicktime', 'video/x-m4v'],
  presign_s: 900,
  duracion_min_s: 60,
  duracion_max_s: 7200,
  titulo_max: 120,
  resumen_max: 140,
  numero_min: 1,
  numero_max: 999,
  liga_max: 500,
};

const RESUMEN: Resumen = {
  usuarios: [],
  aurora: null,
  piso_venta_usd: 0.05,
  totales: { costo_usd: 0, margen_usd: 0, gastados: 0, peliculas: 0 },
  langfuse_base: 'https://lf.ejemplo',
};

const ID = 'cl-3f9a21bc';
const RUTA = '/api/admin/clases';

function clase(sobre: Partial<Clase> = {}): Clase {
  return {
    id: ID,
    numero: 5,
    titulo: 'Respuestas automáticas con tus datos',
    resumen: null,
    grabada_en: null,
    origen: 'archivo',
    nombre_original: null,
    liga: null,
    bytes: null,
    duracion_s: null,
    estado: 'borrador',
    paso: null,
    error: null,
    publicada: false,
    indice: null,
    creado: '2026-10-19T20:00:00Z',
    actualizado: '2026-10-19T20:00:00Z',
    ...sobre,
  };
}

type Cuerpo = Record<string, unknown> | undefined;
interface Pedido {
  metodo: string;
  ruta: string;
  cuerpo: Cuerpo;
}
type Pisa = (cuerpo: Cuerpo) => Response | Promise<Response> | undefined;

interface Opciones {
  vivas?: Clase[];
  archivadas?: Clase[];
  limites?: LimitesClases;
  /** «MÉTODO /ruta» (sin query) → una respuesta que pisa a la de siempre; si devuelve undefined, sigue la de siempre. */
  pisa?: Record<string, Pisa>;
  /** `?archivadas=1` trae todo (vivas y archivadas) en vez de solo las archivadas: el contrato no lo aclara y la web sirve con las dos. */
  archivadasTraeTodo?: boolean;
}

/** El servidor de mentira: las rutas de /api/admin/clases con un estado en memoria. Anota cada pedido en el orden en que llegó. */
function mundo(o: Opciones = {}) {
  const vivas = new Map((o.vivas ?? []).map(c => [c.id, c]));
  const archivadas = new Map((o.archivadas ?? []).map(c => [c.id, c]));
  const porClave = new Map<string, Clase>();
  const pedidos: Pedido[] = [];
  const limites = o.limites ?? LIMITES;
  let n = 0;
  const poner = (id: string, cambios: Partial<Clase>) => {
    const c = { ...vivas.get(id)!, ...cambios };
    vivas.set(id, c);
    return c;
  };

  const f = vi.fn(async (url: string, init?: RequestInit): Promise<Response> => {
    const metodo = init?.method ?? 'GET';
    const cuerpo = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    pedidos.push({ metodo, ruta: url, cuerpo });
    const sinQuery = url.split('?')[0]!;
    const pisada = o.pisa?.[`${metodo} ${sinQuery}`]?.(cuerpo);
    if (pisada) return pisada;
    if (sinQuery === '/api/admin/resumen') return json(RESUMEN);
    const m = /^\/api\/admin\/clases(?:\/([^/]+))?(?:\/([a-z]+))?$/.exec(sinQuery);
    if (!m) throw new Error('ruta no esperada: ' + url);
    const [, id, accion] = m;
    if (!id) {
      if (metodo === 'GET') {
        const pidenArchivadas = url.includes('archivadas=1');
        const lista = pidenArchivadas ? [...(o.archivadasTraeTodo ? vivas.values() : []), ...archivadas.values()] : [...vivas.values()];
        return json({ clases: lista, limites });
      }
      const dato = porClave.get(String(cuerpo?.clave));
      if (dato) return json({ clase: dato }, 201);
      const nueva = clase({
        id: `cl-0000000${++n}`,
        numero: Number(cuerpo?.numero),
        titulo: String(cuerpo?.titulo),
        resumen: (cuerpo?.resumen as string | undefined) ?? null,
        grabada_en: (cuerpo?.grabada_en as string | undefined) ?? null,
        origen: cuerpo?.origen as Clase['origen'],
        liga: (cuerpo?.liga as string | undefined) ?? null,
      });
      vivas.set(nueva.id, nueva);
      porClave.set(String(cuerpo?.clave), nueva);
      return json({ clase: nueva }, 201);
    }
    if (!vivas.has(id) && !archivadas.has(id)) return json({ detail: { codigo: 'no_existe', texto: 'Esa clase no existe.' } }, 404);
    if (metodo === 'PATCH') return json({ clase: poner(id, cuerpo as Partial<Clase>) });
    if (metodo === 'DELETE') {
      archivadas.set(id, { ...vivas.get(id)!, archivada_en: '2026-10-20T10:00:00Z' });
      vivas.delete(id);
      return json({ ok: true });
    }
    if (accion === 'subida') {
      poner(id, { estado: 'subiendo' });
      return json({ url: 'https://s3.ejemplo/subida?firma=1', content_type: cuerpo?.content_type, expira_s: 900 });
    }
    if (accion === 'confirmar') {
      const bytes = pedidos.findLast(p => p.ruta.endsWith(`/${id}/subida`))?.cuerpo?.bytes as number;
      return json({ clase: poner(id, { estado: 'subido', bytes, nombre_original: String(cuerpo?.nombre) }) });
    }
    if (accion === 'medir') return json({ clase: poner(id, { duracion_s: 3720.4 }) });
    if (accion === 'cancelar') return json({ clase: poner(id, { estado: 'borrador' }) });
    if (accion === 'video') return json({ url: `https://s3.ejemplo/clases/${id}/video.mp4?firma=2`, expira_s: 7200 });
    if (accion === 'restaurar') {
      const vuelta = { ...archivadas.get(id)! };
      delete vuelta.archivada_en;
      archivadas.delete(id);
      vivas.set(id, vuelta);
      return json({ clase: vuelta });
    }
    throw new Error('ruta no esperada: ' + metodo + ' ' + url);
  });
  vi.stubGlobal('fetch', f);
  const rutas = () => pedidos.map(p => `${p.metodo} ${p.ruta}`);
  const llamadas = (metodo: string, ruta: string) => pedidos.filter(p => p.metodo === metodo && p.ruta === ruta);
  return { f, pedidos, rutas, llamadas, vivas, archivadas };
}

const detalle = (status: number, codigo: string, texto: string) => json({ detail: { codigo, texto } }, status);

const ambares = () => [...document.querySelectorAll('button')].filter(b => b.classList.contains('bg-ambar')).map(b => b.textContent);

async function abrir() {
  render(<Clases />);
  await screen.findByRole('button', { name: 'Nueva clase' });
}

async function abrirFormulario() {
  await userEvent.click(screen.getByRole('button', { name: 'Nueva clase' }));
  return screen.findByRole('region', { name: 'Nueva clase' });
}

const tarjeta = (n: number) => screen.getByRole('article', { name: new RegExp(`^Clase ${n} ·`) });
const subirA = (n = 5) => screen.findByLabelText(`Subir video de la clase ${n}`);

/** Elige un video (con el archivo en la mano, sin pasar por el filtro `accept` del selector). */
async function elegir(archivo: File, n = 5) {
  fireEvent.change(await subirA(n), { target: { files: [archivo] } });
}

beforeEach(() => {
  vi.unstubAllGlobals();
  ponerXhrFalso();
});

describe('admin · Clases', () => {
  // ---- la pestaña ----

  it('admin.clases.solo_se_pide_al_abrir_la_pestana', async () => {
    const m = mundo({ vivas: [clase()] });
    render(<Admin />);
    const lista = await screen.findByRole('tablist', { name: 'Vistas' });
    // con la pestaña cerrada no se pidió nada de clases
    expect(m.rutas()).toEqual(['GET /api/admin/resumen']);
    await userEvent.click(within(lista).getByRole('tab', { name: '4 · Clases' }));
    expect(await screen.findByRole('heading', { level: 3, name: 'Clase 5 · Respuestas automáticas con tus datos' })).toBeInTheDocument();
    expect(m.rutas()).toEqual(['GET /api/admin/resumen', 'GET /api/admin/clases?archivadas=0']);
    // y las archivadas, solo cuando se prende el interruptor
    expect(m.rutas().some(r => r.includes('archivadas=1'))).toBe(false);
  });

  it('admin.clases.sin_clases_ensena_el_primer_paso_y_el_unico_boton_ambar', async () => {
    mundo();
    await abrir();
    expect(screen.getByText('Todavía no hay clases')).toBeInTheDocument();
    expect(screen.getByText('Aquí subes los videos de las clases que usará la Guía. Subir no cuesta nada.')).toBeInTheDocument();
    // «Nueva clase» es UNO solo (el vacío no trae otro) y es el único ámbar
    expect(screen.getAllByRole('button', { name: 'Nueva clase' })).toHaveLength(1);
    expect(ambares()).toEqual(['Nueva clase']);
  });

  it('admin.clases.error_de_carga_dice_el_texto_del_servidor_y_reintenta', async () => {
    let intentos = 0;
    mundo({
      vivas: [clase()],
      pisa: { [`GET ${RUTA}`]: () => (++intentos === 1 ? detalle(503, 'no_disponible', 'La base está dormida.') : undefined) },
    });
    render(<Clases />);
    const aviso = await screen.findByRole('alert');
    expect(aviso).toHaveTextContent('No pudimos cargar las clases.');
    expect(aviso).toHaveTextContent('La base está dormida.');
    // sin lista no hay «Nueva clase»
    expect(screen.queryByRole('button', { name: 'Nueva clase' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByRole('heading', { level: 3, name: /Clase 5/ })).toBeInTheDocument();
    expect(intentos).toBe(2);
  });

  it('admin.clases.textos_del_servidor_se_pintan_como_texto', async () => {
    mundo({
      vivas: [
        clase({
          titulo: '<img src=x onerror=alert(1)>',
          resumen: '<b>negrita</b> <script>alert(2)</script>',
          nombre_original: '<svg onload=alert(3)>.mp4',
          error: '<img src=y onerror=alert(5)>',
          estado: 'subido',
          bytes: 824_000_000,
          duracion_s: 600,
        }),
        clase({ id: 'cl-2', numero: 6, origen: 'liga', liga: 'javascript:alert(4)' }),
      ],
    });
    const { container } = render(<Clases />);
    expect(await screen.findByText(/<img src=x onerror=alert\(1\)>/)).toBeInTheDocument();
    expect(screen.getByText(/<b>negrita<\/b>/)).toBeInTheDocument();
    expect(screen.getByText(/<svg onload=alert\(3\)>\.mp4/)).toBeInTheDocument();
    expect(screen.getByText(/<img src=y onerror=alert\(5\)>/)).toBeInTheDocument();
    expect(container.querySelector('img, b, script, svg:not([aria-hidden])')).toBeNull();
    // una liga que no es https no es enlace: se lee como texto
    expect(screen.getByText('Liga de referencia: javascript:alert(4)')).toBeInTheDocument();
    expect(container.querySelector('a[href^="javascript"]')).toBeNull();
    // un nombre así tampoco rompe un botón: el de la clase lleva el número, no el título
    expect(screen.getByRole('button', { name: 'Archivar la clase 5' })).toBeInTheDocument();
  });

  it('admin.clases.la_liga_https_abre_aparte_y_las_otras_no_son_enlace', async () => {
    mundo({
      vivas: [
        clase({ origen: 'liga', liga: 'https://ejemplo.com/clase-5' }),
        clase({ id: 'cl-2', numero: 6, origen: 'liga', liga: 'http://ejemplo.com/clase-6' }),
        clase({ id: 'cl-3', numero: 7, origen: 'liga', liga: 'file:///etc/passwd' }),
      ],
    });
    await abrir();
    const enlaces = screen.getAllByRole('link', { name: /Abrir la liga de referencia/ });
    expect(enlaces).toHaveLength(1);
    expect(enlaces[0]).toHaveAttribute('href', 'https://ejemplo.com/clase-5');
    expect(enlaces[0]).toHaveAttribute('target', '_blank');
    expect(enlaces[0]!.getAttribute('rel')).toBe('noopener noreferrer');
    expect(within(tarjeta(6)).getByText('Liga de referencia: http://ejemplo.com/clase-6')).toBeInTheDocument();
    expect(within(tarjeta(7)).getByText('Liga de referencia: file:///etc/passwd')).toBeInTheDocument();
  });

  it('admin.clases.chips_de_estado_y_lo_que_se_sabe_del_video', async () => {
    mundo({
      vivas: [
        clase({ numero: 1, id: 'cl-1', titulo: 'Uno' }),
        clase({ numero: 2, id: 'cl-2', titulo: 'Dos', estado: 'subiendo' }),
        clase({ numero: 3, id: 'cl-3', titulo: 'Tres', estado: 'subido', bytes: 1_400_000_000, duracion_s: 3720.4, nombre_original: 'clase3.mp4', grabada_en: '2026-03-12' }),
        clase({ numero: 4, id: 'cl-4', titulo: 'Cuatro', estado: 'subido', bytes: 824_000_000, duracion_s: null }),
      ],
    });
    await abrir();
    expect(within(tarjeta(1)).getByText('Borrador')).toBeInTheDocument();
    expect(within(tarjeta(2)).getByText('Subiendo')).toBeInTheDocument();
    expect(within(tarjeta(3)).getByText('Subido')).toBeInTheDocument();
    expect(within(tarjeta(3)).getByText('Listo: 1 h 02 min · 1.4 GB')).toBeInTheDocument();
    expect(within(tarjeta(3)).getByText('Archivo: clase3.mp4')).toBeInTheDocument();
    expect(within(tarjeta(3)).getByText('Grabada el 12 de marzo de 2026')).toBeInTheDocument();
    expect(within(tarjeta(4)).getByText('Subido: 824.0 MB. Falta medir cuánto dura.')).toBeInTheDocument();
    // una subida que quedó a medias en el servidor se puede cancelar para empezar de nuevo
    expect(within(tarjeta(2)).getByText('Hay una subida en curso o que quedó a medias. Si no avanza, cancélala para empezar de nuevo.')).toBeInTheDocument();
    expect(within(tarjeta(2)).getByRole('button', { name: 'Cancelar subida' })).toBeInTheDocument();
    // en orden por número
    expect(screen.getAllByRole('heading', { level: 3 }).map(h => h.textContent)).toEqual(['Clase 1 · Uno', 'Clase 2 · Dos', 'Clase 3 · Tres', 'Clase 4 · Cuatro']);
  });

  // ---- crear y editar ----

  it('admin.clases.limites_vienen_del_servidor', async () => {
    mundo({
      vivas: [clase()],
      limites: { ...LIMITES, titulo_max: 40, resumen_max: 60, extensiones: ['.mp4'], content_types: ['video/mp4'] },
    });
    await abrir();
    // el selector de archivos acepta lo que el servidor admite y nada más
    expect(screen.getByLabelText('Subir video de la clase 5')).toHaveAttribute('accept', '.mp4,video/mp4');
    await abrirFormulario();
    expect(screen.getByLabelText('Título')).toHaveAttribute('maxlength', '40');
    expect(screen.getByText('0 de 40')).toBeInTheDocument();
    expect(screen.getByLabelText('Para qué sirve (máx. 60)')).toHaveAttribute('maxlength', '60');
    expect(screen.getByText('0 de 60')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Título'), 'Hola');
    expect(screen.getByText('4 de 40')).toBeInTheDocument();
  });

  it('admin.clases.nueva_clase_abre_el_formulario_con_el_foco_y_guardar_es_el_unico_ambar', async () => {
    mundo({ vivas: [clase()] });
    await abrir();
    expect(ambares()).toEqual(['Nueva clase']);
    const form = await abrirFormulario();
    for (const campo of ['Número de clase', 'Título', 'Fecha de grabación', 'Para qué sirve (máx. 140)', 'Liga de referencia (opcional)']) {
      expect(within(form).getByLabelText(campo)).toBeInTheDocument();
    }
    expect(within(form).getByText('Es el «Clase N» que verá la persona.')).toBeInTheDocument();
    expect(screen.getByLabelText('Número de clase')).toHaveFocus();
    // mientras el formulario está abierto, el ámbar es «Guardar clase» y «Nueva clase» se esconde
    expect(ambares()).toEqual(['Guardar clase']);
    expect(screen.queryByRole('button', { name: 'Nueva clase' })).toBeNull();
    // cancelar cierra, devuelve «Nueva clase» y el foco se queda ahí (no cae al <body>)
    await userEvent.click(within(form).getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('region', { name: 'Nueva clase' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Nueva clase' })).toHaveFocus();
    expect(ambares()).toEqual(['Nueva clase']);
  });

  it('admin.clases.guardar_sin_numero_o_titulo_no_llama_al_servidor', async () => {
    const m = mundo();
    await abrir();
    await abrirFormulario();
    await userEvent.click(screen.getByRole('button', { name: 'Guardar clase' }));
    expect(screen.getByText('Escribe el número de la clase: un número entero, como 5.')).toBeInTheDocument();
    expect(screen.getByText('Escribe el título de la clase.')).toBeInTheDocument();
    expect(screen.getByLabelText('Número de clase')).toHaveFocus();
    expect(screen.getByLabelText('Número de clase')).toHaveAttribute('aria-invalid', 'true');
    // un número que no es entero tampoco
    await userEvent.type(screen.getByLabelText('Número de clase'), '5.5');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar clase' }));
    expect(screen.getByText('Escribe el número de la clase: un número entero, como 5.')).toBeInTheDocument();
    expect(m.llamadas('POST', RUTA)).toHaveLength(0);
    // al escribir, el error se va
    await userEvent.clear(screen.getByLabelText('Número de clase'));
    await userEvent.type(screen.getByLabelText('Número de clase'), '5');
    expect(screen.queryByText('Escribe el número de la clase: un número entero, como 5.')).toBeNull();
  });

  it('admin.clases.doble_clic_en_guardar_clase_manda_un_solo_post_con_su_clave', async () => {
    const respuesta = diferida<Response>();
    const m = mundo({ pisa: { [`POST ${RUTA}`]: () => respuesta.promesa } });
    await abrir();
    await abrirFormulario();
    await userEvent.type(screen.getByLabelText('Número de clase'), ' 5 ');
    await userEvent.type(screen.getByLabelText('Título'), '  Respuestas automáticas  ');
    fireEvent.change(screen.getByLabelText('Fecha de grabación'), { target: { value: '2026-03-12' } });
    await userEvent.type(screen.getByLabelText('Para qué sirve (máx. 140)'), 'Conectas la IA con tus datos');
    const guardar = screen.getByRole('button', { name: 'Guardar clase' });
    await userEvent.dblClick(guardar);
    await userEvent.click(guardar);
    // la petición sigue en el aire: un solo POST, y el botón lo dice
    expect(m.llamadas('POST', RUTA)).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Guardando…' })).toHaveAttribute('aria-busy', 'true');
    const cuerpo = m.llamadas('POST', RUTA)[0]!.cuerpo!;
    expect(cuerpo).toMatchObject({
      numero: 5,
      titulo: 'Respuestas automáticas',
      resumen: 'Conectas la IA con tus datos',
      grabada_en: '2026-03-12',
      origen: 'archivo',
    });
    expect(cuerpo).not.toHaveProperty('liga');
    // la clave es un UUID del navegador
    expect(cuerpo.clave).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    await act(async () => respuesta.resolver(json({ clase: clase({ id: 'cl-nueva', titulo: 'Respuestas automáticas' }) }, 201)));
    // la clase queda en la lista, el formulario se cierra y el foco va al título de la clase nueva
    const h3 = await screen.findByRole('heading', { level: 3, name: 'Clase 5 · Respuestas automáticas' });
    await waitFor(() => expect(h3).toHaveFocus());
    expect(screen.queryByRole('region', { name: 'Nueva clase' })).toBeNull();
    expect(m.llamadas('POST', RUTA)).toHaveLength(1);
  });

  it('admin.clases.lo_opcional_vacio_no_viaja_y_un_reintento_manda_la_misma_clave', async () => {
    let intentos = 0;
    const m = mundo({
      pisa: { [`POST ${RUTA}`]: () => (++intentos === 1 ? detalle(503, 'no_disponible', 'No pudimos guardar la clase ahora.') : undefined) },
    });
    await abrir();
    await abrirFormulario();
    await userEvent.type(screen.getByLabelText('Número de clase'), '7');
    await userEvent.type(screen.getByLabelText('Título'), 'Prompts');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar clase' }));
    // el error del servidor, con su texto, y lo escrito se queda
    expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos guardar la clase ahora.');
    expect(screen.getByLabelText('Título')).toHaveValue('Prompts');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar clase' }));
    await screen.findByRole('heading', { level: 3, name: 'Clase 7 · Prompts' });
    const posts = m.llamadas('POST', RUTA);
    expect(posts).toHaveLength(2);
    expect(posts[1]!.cuerpo!.clave).toBe(posts[0]!.cuerpo!.clave);
    expect(Object.keys(posts[0]!.cuerpo!).sort()).toEqual(['clave', 'numero', 'origen', 'titulo']);
    // una clase nueva después trae otra clave
    await userEvent.click(screen.getByRole('button', { name: 'Nueva clase' }));
    await userEvent.type(screen.getByLabelText('Número de clase'), '8');
    await userEvent.type(screen.getByLabelText('Título'), 'Otra');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar clase' }));
    await screen.findByRole('heading', { level: 3, name: 'Clase 8 · Otra' });
    const tercero = m.llamadas('POST', RUTA)[2]!;
    expect(tercero.cuerpo!.clave).not.toBe(posts[0]!.cuerpo!.clave);
  });

  it('admin.clases.con_liga_la_clase_es_solo_una_referencia_sin_video', async () => {
    const m = mundo();
    await abrir();
    await abrirFormulario();
    // opcional: sin ella la clase es de archivo; con ella, el servidor la pide como liga y no lleva video
    expect(screen.getByText('Si la pones, la clase es solo una referencia y no lleva video que subir.')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Número de clase'), '3');
    await userEvent.type(screen.getByLabelText('Título'), 'Clase en otra plataforma');
    await userEvent.type(screen.getByLabelText('Liga de referencia (opcional)'), 'https://ejemplo.com/clase-3');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar clase' }));
    await screen.findByRole('heading', { level: 3, name: 'Clase 3 · Clase en otra plataforma' });
    expect(m.llamadas('POST', RUTA)[0]!.cuerpo).toMatchObject({ origen: 'liga', liga: 'https://ejemplo.com/clase-3' });
    // la tarjeta lo dice, enlaza la liga y no ofrece subir ningún video
    const t = tarjeta(3);
    expect(within(t).getByText('Es solo una referencia: no lleva video que subir.')).toBeInTheDocument();
    expect(within(t).getByRole('link', { name: /Abrir la liga de referencia/ })).toHaveAttribute('href', 'https://ejemplo.com/clase-3');
    expect(screen.queryByLabelText('Subir video de la clase 3')).toBeNull();
    // al editarla, la liga es obligatoria (es lo único que la hace clase) y solo se manda si cambió
    await userEvent.click(within(t).getByRole('button', { name: 'Editar la clase 3' }));
    const liga = await screen.findByLabelText('Liga de referencia');
    expect(screen.getByText('Esta clase es solo una referencia: no lleva video que subir.')).toBeInTheDocument();
    await userEvent.clear(liga);
    await userEvent.click(screen.getByRole('button', { name: 'Guardar clase' }));
    expect(screen.getByText('Pega la liga de la clase.')).toBeInTheDocument();
    expect(liga).toHaveFocus();
    expect(m.llamadas('PATCH', `${RUTA}/cl-00000001`)).toHaveLength(0);
    await userEvent.type(liga, 'https://ejemplo.com/otra');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar clase' }));
    await waitFor(() => expect(m.llamadas('PATCH', `${RUTA}/cl-00000001`)).toHaveLength(1));
    expect(m.llamadas('PATCH', `${RUTA}/cl-00000001`)[0]!.cuerpo).toEqual({ liga: 'https://ejemplo.com/otra' });
  });

  it('admin.clases.el_numero_y_la_fecha_se_revisan_con_los_limites_y_el_texto_del_servidor', async () => {
    const m = mundo({ pisa: { [`POST ${RUTA}`]: () => detalle(422, 'fecha_invalida', 'La fecha tiene que ser real y venir como año-mes-día, por ejemplo 2026-03-12.') } });
    await abrir();
    await abrirFormulario();
    await userEvent.type(screen.getByLabelText('Título'), 'Algo');
    // fuera del rango que dijo el servidor (1 a 999): no se manda
    await userEvent.type(screen.getByLabelText('Número de clase'), '1000');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar clase' }));
    expect(screen.getByText('El número de la clase va de 1 a 999.')).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('Número de clase'));
    await userEvent.type(screen.getByLabelText('Número de clase'), '0');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar clase' }));
    expect(screen.getByText('El número de la clase va de 1 a 999.')).toBeInTheDocument();
    expect(m.llamadas('POST', RUTA)).toHaveLength(0);
    await userEvent.clear(screen.getByLabelText('Número de clase'));
    await userEvent.type(screen.getByLabelText('Número de clase'), '999');
    // la fecha mala la rechaza el servidor y su texto sale junto al campo de la fecha
    fireEvent.change(screen.getByLabelText('Fecha de grabación'), { target: { value: '1999-01-01' } });
    await userEvent.click(screen.getByRole('button', { name: 'Guardar clase' }));
    expect(await screen.findByText(/La fecha tiene que ser real/)).toBeInTheDocument();
    expect(screen.getByLabelText('Fecha de grabación')).toHaveFocus();
    expect(screen.getByLabelText('Fecha de grabación')).toHaveAttribute('aria-invalid', 'true');
  });

  it('admin.clases.errores_del_servidor_se_leen_junto_al_campo_con_su_texto', async () => {
    mundo({
      vivas: [clase({ numero: 5 })],
      pisa: { [`POST ${RUTA}`]: () => detalle(409, 'numero_repetido', 'Ya hay una clase 5. Usa otro número.') },
    });
    await abrir();
    await abrirFormulario();
    await userEvent.type(screen.getByLabelText('Número de clase'), '5');
    await userEvent.type(screen.getByLabelText('Título'), 'Otra clase');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar clase' }));
    const campo = screen.getByLabelText('Número de clase');
    await waitFor(() => expect(campo).toHaveAttribute('aria-invalid', 'true'));
    expect(screen.getByText('Ya hay una clase 5. Usa otro número.')).toBeInTheDocument();
    expect(campo).toHaveFocus();
    // sin cerrar el formulario ni perder lo escrito
    expect(screen.getByLabelText('Título')).toHaveValue('Otra clase');
  });

  it('admin.clases.editar_manda_solo_lo_que_cambio_y_vaciar_manda_null', async () => {
    const m = mundo({ vivas: [clase({ resumen: 'Algo', grabada_en: '2026-03-12' })] });
    await abrir();
    await userEvent.click(screen.getByRole('button', { name: 'Editar la clase 5' }));
    const form = await screen.findByRole('region', { name: 'Editar la clase 5' });
    // una clase con archivo no lleva liga (el servidor no la deja): el campo ni aparece
    expect(within(form).queryByLabelText(/Liga de referencia/)).toBeNull();
    expect(within(form).getByLabelText('Título')).toHaveValue('Respuestas automáticas con tus datos');
    expect(within(form).getByLabelText('Fecha de grabación')).toHaveValue('2026-03-12');
    // sin cambios: no se manda nada, se cierra y el foco vuelve a «Editar»
    await userEvent.click(within(form).getByRole('button', { name: 'Guardar clase' }));
    expect(m.llamadas('PATCH', `${RUTA}/${ID}`)).toHaveLength(0);
    expect(screen.queryByRole('region', { name: 'Editar la clase 5' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Editar la clase 5' })).toHaveFocus();
    // cambiar solo el título
    await userEvent.click(screen.getByRole('button', { name: 'Editar la clase 5' }));
    const titulo = await screen.findByLabelText('Título');
    await userEvent.clear(titulo);
    await userEvent.type(titulo, 'Título nuevo');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar clase' }));
    expect(await screen.findByRole('heading', { level: 3, name: 'Clase 5 · Título nuevo' })).toBeInTheDocument();
    expect(m.llamadas('PATCH', `${RUTA}/${ID}`)[0]!.cuerpo).toEqual({ titulo: 'Título nuevo' });
    // vaciar el resumen y la fecha los borra con null; el número cambia como número
    await userEvent.click(screen.getByRole('button', { name: 'Editar la clase 5' }));
    await userEvent.clear(await screen.findByLabelText('Para qué sirve (máx. 140)'));
    fireEvent.change(screen.getByLabelText('Fecha de grabación'), { target: { value: '' } });
    await userEvent.clear(screen.getByLabelText('Número de clase'));
    await userEvent.type(screen.getByLabelText('Número de clase'), '6');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar clase' }));
    await screen.findByRole('heading', { level: 3, name: 'Clase 6 · Título nuevo' });
    expect(m.llamadas('PATCH', `${RUTA}/${ID}`)[1]!.cuerpo).toEqual({ numero: 6, resumen: null, grabada_en: null });
  });

  // ---- subir el video ----

  it('admin.clases.subir_sigue_el_orden_permiso_put_confirmar_medir', async () => {
    const m = mundo({ vivas: [clase()] });
    await abrir();
    await elegir(archivoDeVideo('clase5.mp4', 'video/mp4', 1_400_000_000));
    await waitFor(() => expect(XhrFalso.todos).toHaveLength(1));
    // 1 · el permiso: el servidor elige la clave; aquí solo viaja lo que se necesita para firmar
    expect(m.rutas().filter(r => r.startsWith('POST'))).toEqual([`POST ${RUTA}/${ID}/subida`]);
    expect(m.llamadas('POST', `${RUTA}/${ID}/subida`)[0]!.cuerpo).toEqual({ archivo: 'clase5.mp4', content_type: 'video/mp4', bytes: 1_400_000_000 });
    // y jamás se usa el presign del editor
    expect(m.rutas().some(r => r.includes('/api/media/'))).toBe(false);
    // 2 · el PUT directo a S3, con progreso real
    const xhr = ultimoXhr();
    expect(xhr.metodo).toBe('PUT');
    expect(xhr.url).toBe('https://s3.ejemplo/subida?firma=1');
    expect(screen.getByText('Subiendo… 0 %')).toBeInTheDocument();
    act(() => xhr.avanzar(588_000_000, 1_400_000_000));
    expect(await screen.findByText('Subiendo… 42 %')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Subiendo… 42 %' })).toHaveAttribute('aria-valuenow', '42');
    // todavía no se confirmó ni se midió: el video aún no terminó de subir
    expect(m.rutas().filter(r => r.startsWith('POST'))).toEqual([`POST ${RUTA}/${ID}/subida`]);
    expect(within(tarjeta(5)).getByText('Subiendo')).toBeInTheDocument();
    act(() => xhr.terminar(200));
    // 3 · confirmar y 4 · medir, en ese orden
    expect(await screen.findByText('Listo: 1 h 02 min · 1.4 GB')).toBeInTheDocument();
    expect(m.rutas().filter(r => r.startsWith('POST'))).toEqual([
      `POST ${RUTA}/${ID}/subida`,
      `POST ${RUTA}/${ID}/confirmar`,
      `POST ${RUTA}/${ID}/medir`,
    ]);
    // el nombre que se manda es el que vio la persona
    expect(m.llamadas('POST', `${RUTA}/${ID}/confirmar`)[0]!.cuerpo).toEqual({ nombre: 'clase5.mp4' });
    expect(within(tarjeta(5)).getByText('Subido')).toBeInTheDocument();
    expect(within(tarjeta(5)).getByText('Archivo: clase5.mp4')).toBeInTheDocument();
    // ya no se ofrece subir otro video a la misma clase, pero sí verlo
    expect(screen.queryByLabelText('Subir video de la clase 5')).toBeNull();
    expect(screen.getByRole('button', { name: 'Ver video de la clase 5' })).toBeInTheDocument();
    expect(ambares()).toEqual(['Nueva clase']);
  });

  it('admin.clases.subir_avisa_al_cerrar_la_pestana_solo_mientras_sube', async () => {
    mundo({ vivas: [clase()] });
    await abrir();
    const intento = () => {
      const ev = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(ev);
      return ev.defaultPrevented;
    };
    expect(intento()).toBe(false);
    await elegir(archivoDeVideo());
    await waitFor(() => expect(XhrFalso.todos).toHaveLength(1));
    expect(intento()).toBe(true);
    act(() => ultimoXhr().terminar(200));
    await screen.findByText(/^Listo: /);
    expect(intento()).toBe(false);
  });

  it('admin.clases.cambiar_de_pestana_a_media_subida_no_la_detiene', async () => {
    // Radix desmonta lo que no se ve: la subida de una clase no puede morir porque la persona mire otra vista del panel
    const m = mundo({ vivas: [clase()] });
    render(<Admin />);
    await userEvent.click(await screen.findByRole('tab', { name: '4 · Clases' }));
    await elegir(archivoDeVideo('clase5.mp4', 'video/mp4', 1_400_000_000));
    await waitFor(() => expect(XhrFalso.todos).toHaveLength(1));
    await userEvent.click(screen.getByRole('tab', { name: '2 · Costos' }));
    expect(screen.queryByRole('article')).toBeNull();
    const intento = () => {
      const ev = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(ev);
      return ev.defaultPrevented;
    };
    // el aviso de cerrar la pestaña sigue mientras el PUT sigue
    expect(intento()).toBe(true);
    expect(ultimoXhr().abortado).toBe(false);
    act(() => ultimoXhr().terminar(200));
    await waitFor(() => expect(m.llamadas('POST', `${RUTA}/${ID}/medir`)).toHaveLength(1));
    expect(m.rutas().filter(r => r.startsWith('POST'))).toEqual([`POST ${RUTA}/${ID}/subida`, `POST ${RUTA}/${ID}/confirmar`, `POST ${RUTA}/${ID}/medir`]);
    expect(intento()).toBe(false);
    // al volver, la lista ya trae la clase subida y medida
    await userEvent.click(screen.getByRole('tab', { name: '4 · Clases' }));
    expect(await screen.findByText('Listo: 1 h 02 min · 1.4 GB')).toBeInTheDocument();
  });

  it('admin.clases.cancelar_la_subida_no_confirma', async () => {
    const m = mundo({ vivas: [clase()] });
    await abrir();
    await elegir(archivoDeVideo());
    await waitFor(() => expect(XhrFalso.todos).toHaveLength(1));
    act(() => ultimoXhr().avanzar(100, 1000));
    await userEvent.click(within(tarjeta(5)).getByRole('button', { name: 'Cancelar' }));
    expect(ultimoXhr().abortado).toBe(true);
    expect(await screen.findByText(TEXTO_SUBIDA_CANCELADA)).toBeInTheDocument();
    // el servidor devuelve la clase a «borrador»; no se confirmó ni se midió
    await waitFor(() => expect(m.llamadas('POST', `${RUTA}/${ID}/cancelar`)).toHaveLength(1));
    expect(m.rutas().filter(r => r.startsWith('POST'))).toEqual([`POST ${RUTA}/${ID}/subida`, `POST ${RUTA}/${ID}/cancelar`]);
    expect(within(tarjeta(5)).getByText('Borrador')).toBeInTheDocument();
    // y se puede elegir otro video
    expect(screen.getByLabelText('Subir video de la clase 5')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).toBeNull();
    // no es un error: el aviso no es una alerta
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('admin.clases.cancelar_antes_de_que_llegue_el_permiso_no_sube_nada', async () => {
    const permiso = diferida<Response>();
    const m = mundo({ vivas: [clase()], pisa: { [`POST ${RUTA}/${ID}/subida`]: () => permiso.promesa } });
    await abrir();
    await elegir(archivoDeVideo());
    expect(await screen.findByText('Pidiendo permiso de subida…')).toBeInTheDocument();
    await userEvent.click(within(tarjeta(5)).getByRole('button', { name: 'Cancelar' }));
    await act(async () => permiso.resolver(json({ url: 'https://s3.ejemplo/subida?firma=1', content_type: 'video/mp4', expira_s: 900 })));
    expect(await screen.findByText(TEXTO_SUBIDA_CANCELADA)).toBeInTheDocument();
    // llegó el permiso y ya no hay PUT: ni XHR ni confirmar
    expect(XhrFalso.todos).toHaveLength(0);
    expect(m.rutas().filter(r => r.startsWith('POST'))).toEqual([`POST ${RUTA}/${ID}/subida`, `POST ${RUTA}/${ID}/cancelar`]);
  });

  it('admin.clases.si_falla_el_put_dice_que_revises_la_conexion_y_no_confirma', async () => {
    const m = mundo({ vivas: [clase()] });
    await abrir();
    await elegir(archivoDeVideo());
    await waitFor(() => expect(XhrFalso.todos).toHaveLength(1));
    act(() => ultimoXhr().fallar());
    expect(await screen.findByRole('alert')).toHaveTextContent(TEXTO_FALLO_SUBIDA);
    expect(TEXTO_FALLO_SUBIDA).toBe('No se pudo subir el video. Revisa tu conexión e inténtalo otra vez.');
    expect(m.rutas().filter(r => r.startsWith('POST'))).toEqual([`POST ${RUTA}/${ID}/subida`, `POST ${RUTA}/${ID}/cancelar`]);
    expect(within(tarjeta(5)).getByText('Borrador')).toBeInTheDocument();
    // un PUT que S3 rechaza (403) dice lo mismo
    await elegir(archivoDeVideo());
    await waitFor(() => expect(XhrFalso.todos).toHaveLength(2));
    act(() => ultimoXhr().terminar(403));
    await waitFor(() => expect(m.llamadas('POST', `${RUTA}/${ID}/cancelar`)).toHaveLength(2));
    expect(screen.getByRole('alert')).toHaveTextContent(TEXTO_FALLO_SUBIDA);
  });

  it('admin.clases.errores_del_servidor_al_subir_se_leen_con_su_texto', async () => {
    const m = mundo({
      vivas: [clase()],
      pisa: { [`POST ${RUTA}/${ID}/subida`]: () => detalle(409, 'estado_no_permite', 'Esta clase ya tiene su video.') },
    });
    await abrir();
    await elegir(archivoDeVideo());
    expect(await screen.findByRole('alert')).toHaveTextContent('Esta clase ya tiene su video.');
    // no hubo permiso: no hay PUT ni nada que cancelar
    expect(XhrFalso.todos).toHaveLength(0);
    expect(m.rutas().filter(r => r.startsWith('POST'))).toEqual([`POST ${RUTA}/${ID}/subida`]);
  });

  it('admin.clases.si_el_archivo_no_llego_a_s3_confirmar_dice_el_texto_del_servidor', async () => {
    const m = mundo({
      vivas: [clase()],
      pisa: { [`POST ${RUTA}/${ID}/confirmar`]: () => detalle(404, 'archivo_no_esta', 'El video no llegó a la nube. Vuelve a subirlo.') },
    });
    await abrir();
    await elegir(archivoDeVideo());
    await waitFor(() => expect(XhrFalso.todos).toHaveLength(1));
    act(() => ultimoXhr().terminar(200));
    expect(await screen.findByRole('alert')).toHaveTextContent('El video no llegó a la nube. Vuelve a subirlo.');
    // sin medir (no hay nada que medir) y con la subida devuelta a «borrador»
    expect(m.llamadas('POST', `${RUTA}/${ID}/medir`)).toHaveLength(0);
    await waitFor(() => expect(m.llamadas('POST', `${RUTA}/${ID}/cancelar`)).toHaveLength(1));
  });

  it('admin.clases.si_no_se_puede_medir_el_video_queda_subido_y_se_mide_otra_vez', async () => {
    let intentos = 0;
    const m = mundo({
      vivas: [clase()],
      pisa: { [`POST ${RUTA}/${ID}/medir`]: () => (++intentos === 1 ? detalle(502, 'medir_fallo', 'No pudimos leer la duración del video.') : undefined) },
    });
    await abrir();
    await elegir(archivoDeVideo('clase5.mp4', 'video/mp4', 1_400_000_000));
    await waitFor(() => expect(XhrFalso.todos).toHaveLength(1));
    act(() => ultimoXhr().terminar(200));
    expect(await screen.findByRole('alert')).toHaveTextContent('El video quedó subido, pero no se pudo medir cuánto dura. No pudimos leer la duración del video.');
    // el video NO se vuelve a subir ni se cancela: sigue «Subido», con su botón para medir
    expect(within(tarjeta(5)).getByText('Subido')).toBeInTheDocument();
    expect(m.llamadas('POST', `${RUTA}/${ID}/cancelar`)).toHaveLength(0);
    await userEvent.click(screen.getByRole('button', { name: 'Medir la duración de la clase 5' }));
    expect(await screen.findByText('Listo: 1 h 02 min · 1.4 GB')).toBeInTheDocument();
    expect(m.llamadas('POST', `${RUTA}/${ID}/medir`)).toHaveLength(2);
    expect(m.llamadas('POST', `${RUTA}/${ID}/subida`)).toHaveLength(1);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('admin.clases.un_archivo_fuera_de_los_limites_del_servidor_no_pide_permiso', async () => {
    const m = mundo({ vivas: [clase()] });
    await abrir();
    await elegir(archivoDeVideo('virus.exe', 'application/x-msdownload', 1000));
    expect(await screen.findByRole('alert')).toHaveTextContent('Ese archivo no es de un tipo que se pueda subir. Elige un video .mp4, .mov, .m4v.');
    await elegir(archivoDeVideo('grande.mp4', 'video/mp4', 6_000_000_000));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Ese video pesa 6.0 GB y lo máximo es 5.4 GB.'));
    await elegir(archivoDeVideo('vacio.mp4', 'video/mp4', 0));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Ese archivo está vacío. Elige otro video.'));
    expect(m.llamadas('POST', `${RUTA}/${ID}/subida`)).toHaveLength(0);
    expect(XhrFalso.todos).toHaveLength(0);
  });

  it('admin.clases.subida_vieja_en_el_servidor_se_cancela_con_su_boton', async () => {
    const m = mundo({ vivas: [clase({ estado: 'subiendo' })] });
    await abrir();
    expect(screen.queryByLabelText('Subir video de la clase 5')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar subida' }));
    expect(await screen.findByLabelText('Subir video de la clase 5')).toBeInTheDocument();
    expect(within(tarjeta(5)).getByText('Borrador')).toBeInTheDocument();
    expect(m.llamadas('POST', `${RUTA}/${ID}/cancelar`)).toHaveLength(1);
  });

  // ---- ver el video ----

  it('admin.clases.ver_video_pide_la_url_firmada_al_servidor_y_no_la_ensena', async () => {
    const m = mundo({ vivas: [clase({ estado: 'subido', bytes: 1_400_000_000, duracion_s: 3720.4 })] });
    await abrir();
    // una clase sin video no tiene el botón
    await userEvent.click(screen.getByRole('button', { name: 'Ver video de la clase 5' }));
    const reproductor = await screen.findByLabelText('Vista previa de la clase 5');
    expect(m.llamadas('GET', `${RUTA}/${ID}/video`)).toHaveLength(1);
    expect(reproductor.tagName).toBe('VIDEO');
    expect(reproductor).toHaveAttribute('src', `https://s3.ejemplo/clases/${ID}/video.mp4?firma=2`);
    expect(reproductor).toHaveAttribute('controls');
    expect(reproductor).not.toHaveAttribute('autoplay');
    expect(reproductor.querySelector('track[kind="captions"]')).not.toBeNull();
    // la liga firmada se usa y no se muestra: ni como texto ni en un enlace
    expect(document.body.textContent).not.toContain('firma=2');
    expect(document.querySelector('a[href*="firma"]')).toBeNull();
    // ocultar
    await userEvent.click(screen.getByRole('button', { name: 'Ocultar video de la clase 5' }));
    expect(screen.queryByLabelText('Vista previa de la clase 5')).toBeNull();
  });

  it('admin.clases.video_que_no_carga_o_sin_permiso_dice_por_que', async () => {
    let intentos = 0;
    mundo({
      vivas: [clase({ estado: 'subido', bytes: 824_000_000, duracion_s: 600 })],
      pisa: { [`GET ${RUTA}/${ID}/video`]: () => (++intentos === 1 ? detalle(404, 'no_existe', 'No encontramos el video de esta clase.') : undefined) },
    });
    await abrir();
    await userEvent.click(screen.getByRole('button', { name: 'Ver video de la clase 5' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No encontramos el video de esta clase.');
    // el reintento sí lo abre; si el navegador no lo puede reproducir, lo dice
    await userEvent.click(screen.getByRole('button', { name: 'Ver video de la clase 5' }));
    const reproductor = await screen.findByLabelText('Vista previa de la clase 5');
    fireEvent.error(reproductor);
    expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos cargar el video. Pulsa «Ver video» otra vez para pedir una liga nueva.');
    expect(screen.queryByLabelText('Vista previa de la clase 5')).toBeNull();
  });

  // ---- archivar y restaurar ----

  it('admin.clases.archivar_pide_confirmacion_y_ni_esc_ni_cancelar_archivan', async () => {
    const m = mundo({ vivas: [clase()] });
    await abrir();
    const abrirDialogo = () => userEvent.click(screen.getByRole('button', { name: 'Archivar la clase 5' }));
    await abrirDialogo();
    const dialogo = await screen.findByRole('alertdialog', { name: '¿Archivar la clase 5?' });
    expect(dialogo).toHaveTextContent('Deja de aparecer en la lista y en la Guía. No se borra nada y se puede restaurar.');
    // el foco arranca en «Cancelar» y la acción es de nivel peligro (no ámbar)
    expect(within(dialogo).getByRole('button', { name: 'Cancelar' })).toHaveFocus();
    expect(within(dialogo).getByRole('button', { name: 'Archivar' }).className).toContain('bg-peligro-fondo');
    expect(ambares()).not.toContain('Archivar');
    // Esc no archiva
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(m.llamadas('DELETE', `${RUTA}/${ID}`)).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Archivar la clase 5' })).toHaveFocus();
    // «Cancelar» tampoco
    await abrirDialogo();
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(m.llamadas('DELETE', `${RUTA}/${ID}`)).toHaveLength(0);
    expect(tarjeta(5)).toBeInTheDocument();
    // confirmar sí: un DELETE (borrado suave) y la clase sale de la lista
    await abrirDialogo();
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Archivar' }));
    await waitFor(() => expect(screen.queryByRole('article')).toBeNull());
    expect(m.llamadas('DELETE', `${RUTA}/${ID}`)).toHaveLength(1);
    expect(screen.getByText('Todavía no hay clases')).toBeInTheDocument();
    // el foco no cae al <body>: se queda en el título de la lista
    await waitFor(() => expect(screen.getByRole('heading', { level: 2, name: 'Clases' })).toHaveFocus());
  });

  it('admin.clases.si_no_se_pudo_archivar_lo_dice_y_la_clase_se_queda', async () => {
    mundo({ vivas: [clase()], pisa: { [`DELETE ${RUTA}/${ID}`]: () => detalle(404, 'no_existe', 'Esa clase ya no existe.') } });
    await abrir();
    await userEvent.click(screen.getByRole('button', { name: 'Archivar la clase 5' }));
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Archivar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Esa clase ya no existe.');
    expect(tarjeta(5)).toBeInTheDocument();
  });

  it('admin.clases.archivadas_se_piden_al_prender_el_interruptor_y_se_restauran', async () => {
    const m = mundo({ vivas: [clase()], archivadas: [clase({ id: 'cl-viejo', numero: 2, titulo: 'Clase vieja', archivada_en: '2026-10-01T10:00:00Z' })] });
    await abrir();
    const interruptor = screen.getByRole('switch', { name: 'Ver clases archivadas' });
    expect(interruptor).toHaveAttribute('aria-checked', 'false');
    expect(m.rutas().some(r => r.includes('archivadas=1'))).toBe(false);
    expect(screen.queryByText('Clase 2 · Clase vieja')).toBeNull();
    await userEvent.click(interruptor);
    expect(interruptor).toHaveAttribute('aria-checked', 'true');
    const vieja = await screen.findByRole('article', { name: 'Clase 2 · Clase vieja' });
    expect(m.rutas()).toContain('GET /api/admin/clases?archivadas=1');
    expect(within(vieja).getByText('Archivada')).toBeInTheDocument();
    // las archivadas no traen editar, archivar ni subir: solo «Restaurar»
    expect(within(vieja).getAllByRole('button').map(b => b.textContent)).toEqual(['Restaurar']);
    await userEvent.click(within(vieja).getByRole('button', { name: 'Restaurar la clase 2' }));
    expect(m.llamadas('POST', `${RUTA}/cl-viejo/restaurar`)).toHaveLength(1);
    // vuelve a la lista de las vivas, en su lugar por número, y sale de las archivadas
    const lista = await screen.findByRole('list', { name: 'Clases' });
    await waitFor(() => expect(within(lista).getAllByRole('heading', { level: 3 }).map(h => h.textContent)).toEqual(['Clase 2 · Clase vieja', 'Clase 5 · Respuestas automáticas con tus datos']));
    expect(screen.getByText('No hay clases archivadas.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('heading', { level: 3, name: 'Clase 2 · Clase vieja' })).toHaveFocus());
    // apagar el interruptor las esconde
    await userEvent.click(interruptor);
    expect(screen.queryByText('No hay clases archivadas.')).toBeNull();
  });

  it('admin.clases.archivar_con_las_archivadas_a_la_vista_la_suma_a_esa_lista', async () => {
    const m = mundo({ vivas: [clase()], archivadasTraeTodo: true });
    await abrir();
    await userEvent.click(screen.getByRole('switch', { name: 'Ver clases archivadas' }));
    await screen.findByText('No hay clases archivadas.');
    await userEvent.click(screen.getByRole('button', { name: 'Archivar la clase 5' }));
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Archivar' }));
    // la lista de archivadas se trae otra vez, y aunque el servidor devuelva TODO, las vivas no se cuelan: solo sale la archivada
    const archivada = await screen.findByRole('article', { name: /^Clase 5 ·/ });
    expect(within(archivada).getByText('Archivada')).toBeInTheDocument();
    expect(m.rutas().filter(r => r.includes('archivadas=1'))).toHaveLength(2);
    expect(screen.queryByRole('list', { name: 'Clases' })).toBeNull();
  });

  it('admin.clases.si_no_se_pudo_restaurar_lo_dice_con_el_texto_del_servidor', async () => {
    mundo({
      archivadas: [clase({ id: 'cl-viejo', numero: 2, titulo: 'Vieja' })],
      pisa: { [`POST ${RUTA}/cl-viejo/restaurar`]: () => detalle(409, 'numero_repetido', 'Ya hay una clase 2. Cámbiale el número a una de las dos.') },
    });
    await abrir();
    await userEvent.click(screen.getByRole('switch', { name: 'Ver clases archivadas' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Restaurar la clase 2' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Ya hay una clase 2. Cámbiale el número a una de las dos.');
    expect(screen.getByRole('article', { name: 'Clase 2 · Vieja' })).toBeInTheDocument();
  });

  // ---- reglas de la carta ----

  it('admin.clases.un_solo_boton_ambar_en_cada_estado', async () => {
    mundo({ vivas: [clase(), clase({ id: 'cl-2', numero: 6, estado: 'subido', bytes: 1000, duracion_s: 60 })], archivadas: [clase({ id: 'cl-3', numero: 1 })] });
    await abrir();
    expect(ambares()).toEqual(['Nueva clase']);
    // subiendo
    await elegir(archivoDeVideo());
    await waitFor(() => expect(XhrFalso.todos).toHaveLength(1));
    act(() => ultimoXhr().avanzar(500, 1000));
    expect(await screen.findByRole('progressbar')).toBeInTheDocument();
    expect(ambares()).toEqual(['Nueva clase']);
    await userEvent.click(within(tarjeta(5)).getByRole('button', { name: 'Cancelar' }));
    await screen.findByText(TEXTO_SUBIDA_CANCELADA);
    // archivadas a la vista
    await userEvent.click(screen.getByRole('switch', { name: 'Ver clases archivadas' }));
    await screen.findByRole('button', { name: 'Restaurar la clase 1' });
    expect(ambares()).toEqual(['Nueva clase']);
    // el diálogo de archivar (en un portal)
    await userEvent.click(screen.getByRole('button', { name: 'Archivar la clase 6' }));
    await screen.findByRole('alertdialog');
    expect(ambares()).toEqual(['Nueva clase']);
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    // el formulario
    await userEvent.click(screen.getByRole('button', { name: 'Nueva clase' }));
    expect(ambares()).toEqual(['Guardar clase']);
    await userEvent.click(screen.getByRole('button', { name: 'Editar la clase 6' }));
    expect(ambares()).toEqual(['Guardar clase']);
  });

  it('admin.clases.ningun_precio_sin_la_palabra_dolares_y_sin_prometer_procesar', async () => {
    mundo({
      vivas: [
        clase({ numero: 1, id: 'cl-1' }),
        clase({ numero: 2, id: 'cl-2', estado: 'subido', bytes: 1_400_000_000, duracion_s: 3720.4, nombre_original: 'c2.mp4' }),
      ],
      archivadas: [clase({ numero: 3, id: 'cl-3' })],
    });
    await abrir();
    await userEvent.click(screen.getByRole('switch', { name: 'Ver clases archivadas' }));
    await screen.findByRole('button', { name: 'Restaurar la clase 3' });
    await userEvent.click(screen.getByRole('button', { name: 'Nueva clase' }));
    const texto = document.body.textContent ?? '';
    // cada «$N» va seguido de «dólares» (en esta rebanada no debería haber ninguno) y nunca se habla de centavos
    const precios = [...texto.matchAll(/\$\s*\d[\d.,]*(\s*\S+)?/g)];
    for (const p of precios) expect(p[0]).toMatch(/^\$\s*\d[\d.,]*\s*dólares/);
    expect(texto).not.toMatch(/centavo/i);
    // procesar es de otra rebanada: aquí no se promete ni se ofrece
    expect(texto).not.toMatch(/proces/i);
    expect(screen.queryByRole('button', { name: /proces/i })).toBeNull();
    expect(texto).toContain('Subir no cuesta nada.');
  });

  it('admin.clases.no_guarda_nada_en_el_almacenamiento_del_navegador', async () => {
    const poner = vi.spyOn(Storage.prototype, 'setItem');
    mundo({ vivas: [clase()] });
    await abrir();
    // crear, subir y ver video: ningún dato de la clase ni de la subida toca localStorage ni sessionStorage
    await abrirFormulario();
    await userEvent.type(screen.getByLabelText('Número de clase'), '9');
    await userEvent.type(screen.getByLabelText('Título'), 'Otra');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar clase' }));
    await screen.findByRole('heading', { level: 3, name: 'Clase 9 · Otra' });
    await elegir(archivoDeVideo(), 9);
    await waitFor(() => expect(XhrFalso.todos).toHaveLength(1));
    act(() => ultimoXhr().terminar(200));
    await screen.findByText(/^Listo: /);
    await userEvent.click(screen.getByRole('button', { name: 'Ver video de la clase 9' }));
    await screen.findByLabelText('Vista previa de la clase 9');
    expect(poner).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});
