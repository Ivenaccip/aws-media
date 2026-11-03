// «4 · Clases» del panel como COMPORTAMIENTO (docs/PLAN-UI.md §5). Cada test empieza por el ID de su invariante: tests/test_migracion_ui.py
// exige que cada ID del registro exista aquí. El servidor es de mentira (un mundo en memoria con las rutas del contrato, sección 5.1 del
// diseño de la Guía de clases), el PUT a S3 es un XHR que la prueba mueve a mano, y NADA sale a la red ni llama a un proveedor de pago.
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { diferida, ponerXhrFalso, ultimoXhr, video as archivoDeVideo, XhrFalso } from '../../prueba/edicion';
import { json } from '../../prueba/servidor';
import { Admin } from './Admin';
import { Clases } from './Clases';
import type { Resumen } from './logica';
import type { Clase, LimitesClases } from './logicaClases';
import { reiniciarAvisoDeSalida, TEXTO_FALLO_SUBIDA, TEXTO_SUBIDA_AJENA, TEXTO_SUBIDA_CANCELADA, useSubidaClase } from './useSubidaClase';

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
  // el token de la subida vigente de cada clase (lo da /subida; confirmar y cancelar lo traen de vuelta)
  const tokens = new Map<string, string>();
  let nToken = 0;
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
      const token = (++nToken).toString(16).padStart(32, 'a');
      tokens.set(id, token);
      return json({ url: 'https://s3.ejemplo/subida?firma=1', content_type: cuerpo?.content_type, expira_s: 900, token });
    }
    // como el servidor de verdad: solo se confirma o se cancela desde «subiendo», y un token que no es el vigente no toca nada
    if (accion === 'confirmar' || accion === 'cancelar') {
      if (vivas.get(id)?.estado !== 'subiendo') return detalle(409, 'estado_no_permite', 'Eso no se puede hacer con la clase tal como está ahora.');
      if (cuerpo?.token !== undefined && cuerpo.token !== tokens.get(id)) return detalle(409, 'subida_cambio', TEXTO_SUBIDA_AJENA);
      tokens.delete(id);
      if (accion === 'cancelar') return json({ clase: poner(id, { estado: 'borrador' }) });
      const bytes = (pedidos.findLast(p => p.ruta.endsWith(`/${id}/subida`))?.cuerpo?.bytes as number | undefined) ?? 1_400_000_000;
      return json({ clase: poner(id, { estado: 'subido', bytes, nombre_original: cuerpo?.nombre ? String(cuerpo.nombre) : null }) });
    }
    if (accion === 'medir') return json({ clase: poner(id, { duracion_s: 3720.4 }) });
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
  return { f, pedidos, rutas, llamadas, vivas, archivadas, tokens };
}

function detalle(status: number, codigo: string, texto: string) {
  return json({ detail: { codigo, texto } }, status);
}

// lo que se ve ámbar de botón: los botones con el fondo del principal Y los interruptores, cuya pista o bolita también pueden pintarse
// con él (encendido NO debe: DISENO.md §5). `bg-ambar` exacto: `bg-ambar-claro` (la bolita) y `border-ambar-hondo` son otros tonos
const esAmbar = (e: Element) => e.classList.contains('bg-ambar');
const ambares = () =>
  [...document.querySelectorAll('button')]
    .filter(b => esAmbar(b) || (b.getAttribute('role') === 'switch' && [...b.querySelectorAll('*')].some(esAmbar)))
    .map(b => b.textContent || b.getAttribute('aria-labelledby'));

/** El navegador pregunta si de verdad se quiere salir: true = avisaría (hay una subida que se perdería). */
function avisaAlSalir() {
  const ev = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(ev);
  return ev.defaultPrevented;
}

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
  reiniciarAvisoDeSalida();
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
    expect(
      within(tarjeta(2)).getByText('Hay una subida en curso o que quedó a medias. Si el video ya terminó de subir, confirma que llegó; si no avanza, cancélala para empezar de nuevo.'),
    ).toBeInTheDocument();
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
    // el nombre que se manda es el que vio la persona, y el token es el que dio el permiso
    expect(m.llamadas('POST', `${RUTA}/${ID}/confirmar`)[0]!.cuerpo).toEqual({ nombre: 'clase5.mp4', token: 'a'.repeat(31) + '1' });
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
    // la subida de una clase no puede morir porque la persona mire otra vista del panel. «4 · Clases» ya no se desmonta al irse
    // (`conservar`): la subida, su barra y su aviso siguen siendo de la misma tarjeta
    const m = mundo({ vivas: [clase()] });
    render(<Admin />);
    await userEvent.click(await screen.findByRole('tab', { name: '4 · Clases' }));
    await elegir(archivoDeVideo('clase5.mp4', 'video/mp4', 1_400_000_000));
    await waitFor(() => expect(XhrFalso.todos).toHaveLength(1));
    await userEvent.click(screen.getByRole('tab', { name: '2 · Costos' }));
    expect(screen.queryByRole('article')).toBeNull();
    // el aviso de cerrar la pestaña sigue mientras el PUT sigue
    expect(avisaAlSalir()).toBe(true);
    expect(ultimoXhr().abortado).toBe(false);
    act(() => ultimoXhr().terminar(200));
    await waitFor(() => expect(m.llamadas('POST', `${RUTA}/${ID}/medir`)).toHaveLength(1));
    expect(m.rutas().filter(r => r.startsWith('POST'))).toEqual([`POST ${RUTA}/${ID}/subida`, `POST ${RUTA}/${ID}/confirmar`, `POST ${RUTA}/${ID}/medir`]);
    await waitFor(() => expect(avisaAlSalir()).toBe(false));
    // al volver, la tarjeta ya cuenta la clase subida y medida: lo supo por su propia subida, sin pedir la lista otra vez
    await userEvent.click(screen.getByRole('tab', { name: '4 · Clases' }));
    expect(await screen.findByText('Listo: 1 h 02 min · 1.4 GB')).toBeInTheDocument();
    expect(m.rutas().filter(r => r.startsWith('GET /api/admin/clases'))).toHaveLength(1);
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
    // el servidor ya tiene la clase «subiendo» cuando contesta el permiso
    const TOKEN = 'b'.repeat(32);
    m.vivas.set(ID, { ...m.vivas.get(ID)!, estado: 'subiendo' });
    m.tokens.set(ID, TOKEN);
    await act(async () => permiso.resolver(json({ url: 'https://s3.ejemplo/subida?firma=1', content_type: 'video/mp4', expira_s: 900, token: TOKEN })));
    expect(await screen.findByText(TEXTO_SUBIDA_CANCELADA)).toBeInTheDocument();
    // llegó el permiso y ya no hay PUT: ni XHR ni confirmar. Y se cancela con el token de ESA subida
    expect(XhrFalso.todos).toHaveLength(0);
    expect(m.rutas().filter(r => r.startsWith('POST'))).toEqual([`POST ${RUTA}/${ID}/subida`, `POST ${RUTA}/${ID}/cancelar`]);
    expect(m.llamadas('POST', `${RUTA}/${ID}/cancelar`)[0]!.cuerpo).toEqual({ token: TOKEN });
    expect(within(tarjeta(5)).getByText('Borrador')).toBeInTheDocument();
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
    await userEvent.click(screen.getByRole('button', { name: 'Medir duración de la clase 5' }));
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

  // ---- arreglos de la revisión adversarial (S1) ----

  // 5 · las dos guardas de la subida: el candado (doble clic) y «cancelar no confirma» cuando el PUT acaba a la vez que el clic
  it('admin.clases.doble_clic_en_subir_pide_un_solo_permiso', async () => {
    const m = mundo({ vivas: [clase()] });
    // el hook solo: en la tarjeta el selector se desmonta con la primera elección, así que el segundo «elegir video» tiene que llegar
    // ANTES de que React repinte (el candado va antes del primer await)
    const { result } = renderHook(() => useSubidaClase(clase(), LIMITES, vi.fn(), vi.fn()));
    await act(async () => {
      void result.current.subir(archivoDeVideo('a.mp4'));
      void result.current.subir(archivoDeVideo('b.mp4'));
    });
    await waitFor(() => expect(XhrFalso.todos).toHaveLength(1));
    expect(m.llamadas('POST', `${RUTA}/${ID}/subida`)).toHaveLength(1);
    expect(m.llamadas('POST', `${RUTA}/${ID}/subida`)[0]!.cuerpo).toMatchObject({ archivo: 'a.mp4' });
    // y mientras esa subida corre, otro intento tampoco pide nada
    await act(async () => {
      void result.current.subir(archivoDeVideo('c.mp4'));
    });
    expect(m.llamadas('POST', `${RUTA}/${ID}/subida`)).toHaveLength(1);
    act(() => ultimoXhr().terminar(200));
    await waitFor(() => expect(m.llamadas('POST', `${RUTA}/${ID}/medir`)).toHaveLength(1));
    await waitFor(() => expect(result.current.progreso).toBeNull());
    // una sola subida de punta a punta: un PUT, una confirmación y una medida
    expect(XhrFalso.todos).toHaveLength(1);
    expect(m.rutas().filter(r => r.startsWith('POST'))).toEqual([`POST ${RUTA}/${ID}/subida`, `POST ${RUTA}/${ID}/confirmar`, `POST ${RUTA}/${ID}/medir`]);
  });

  it('admin.clases.cancelar_justo_cuando_termina_el_put_no_confirma', async () => {
    const m = mundo({ vivas: [clase()] });
    await abrir();
    await elegir(archivoDeVideo());
    await waitFor(() => expect(XhrFalso.todos).toHaveLength(1));
    act(() => ultimoXhr().avanzar(999, 1000));
    // el PUT termina y, en el mismo instante, la persona pulsa «Cancelar»: antes de que el hook siga, el clic ya pasó
    act(() => {
      ultimoXhr().terminar(200);
      fireEvent.click(within(tarjeta(5)).getByRole('button', { name: 'Cancelar' }));
    });
    expect(await screen.findByText(TEXTO_SUBIDA_CANCELADA)).toBeInTheDocument();
    expect(m.llamadas('POST', `${RUTA}/${ID}/confirmar`)).toHaveLength(0);
    expect(m.llamadas('POST', `${RUTA}/${ID}/medir`)).toHaveLength(0);
    expect(m.llamadas('POST', `${RUTA}/${ID}/cancelar`)).toHaveLength(1);
    expect(within(tarjeta(5)).getByText('Borrador')).toBeInTheDocument();
    expect(m.vivas.get(ID)!.estado).toBe('borrador');
  });

  // 2 y 11 · un fallo pasajero de «confirmar» no tira a la basura un video que ya llegó a la nube
  it('admin.clases.un_fallo_pasajero_de_confirmar_no_cancela_la_subida_y_se_reintenta', async () => {
    const fallos: Array<[string, () => Response | Promise<Response>]> = [
      ['la base despertando (503)', () => detalle(503, 'despertando', 'El servicio está despertando. Inténtalo en unos segundos.')],
      ['un fallo puntual de S3 (502)', () => detalle(502, 's3_fallo', 'No pudimos hablar con S3 ahora. Inténtalo de nuevo en unos minutos.')],
      ['el tiempo de la pasarela (504, sin JSON)', () => new Response('Gateway Time-out', { status: 504 })],
      ['la red cortada un momento', () => Promise.reject(new TypeError('Failed to fetch'))],
    ];
    for (const [cual, falla] of fallos) {
      cleanup();
      ponerXhrFalso();
      reiniciarAvisoDeSalida();
      let intentos = 0;
      const m = mundo({
        vivas: [clase()],
        pisa: { [`POST ${RUTA}/${ID}/confirmar`]: () => (++intentos === 1 ? falla() : undefined) },
      });
      await abrir();
      await elegir(archivoDeVideo('clase5.mp4', 'video/mp4', 1_400_000_000));
      await waitFor(() => expect(XhrFalso.todos).toHaveLength(1));
      act(() => ultimoXhr().terminar(200));
      const alerta = await screen.findByRole('alert');
      expect(alerta, cual).toHaveTextContent('Tu video ya llegó a la nube, pero no pudimos confirmarlo.');
      expect(alerta, cual).toHaveTextContent('No hace falta subirlo otra vez: pulsa «Reintentar la confirmación».');
      // NO se canceló: la clase sigue «subiendo» en el servidor, el video no se tira y no se midió
      await act(async () => {});
      expect(m.llamadas('POST', `${RUTA}/${ID}/cancelar`), cual).toHaveLength(0);
      expect(m.llamadas('POST', `${RUTA}/${ID}/medir`), cual).toHaveLength(0);
      expect(m.vivas.get(ID)!.estado, cual).toBe('subiendo');
      const t = tarjeta(5);
      expect(within(t).getByText('Subiendo'), cual).toBeInTheDocument();
      expect(screen.queryByLabelText('Subir video de la clase 5'), cual).toBeNull();
      expect(within(t).getByRole('button', { name: 'Reintentar la confirmación' }), cual).toBeInTheDocument();
      expect(within(t).getByRole('button', { name: 'Cancelar subida' }), cual).toBeInTheDocument();
      // cerrar la pestaña todavía perdería el video: el aviso se queda
      expect(avisaAlSalir(), cual).toBe(true);
      // reintentar confirma con el MISMO token: sin permiso nuevo ni PUT nuevo
      await userEvent.click(within(t).getByRole('button', { name: 'Reintentar la confirmación' }));
      expect(await screen.findByText('Listo: 1 h 02 min · 1.4 GB'), cual).toBeInTheDocument();
      const confirmaciones = m.llamadas('POST', `${RUTA}/${ID}/confirmar`);
      expect(confirmaciones, cual).toHaveLength(2);
      expect(confirmaciones[1]!.cuerpo, cual).toEqual(confirmaciones[0]!.cuerpo);
      expect(confirmaciones[0]!.cuerpo!.token, cual).toMatch(/^[0-9a-f]{32}$/);
      expect(m.llamadas('POST', `${RUTA}/${ID}/subida`), cual).toHaveLength(1);
      expect(XhrFalso.todos, cual).toHaveLength(1);
      expect(m.llamadas('POST', `${RUTA}/${ID}/cancelar`), cual).toHaveLength(0);
      expect(screen.queryByRole('alert'), cual).toBeNull();
      expect(avisaAlSalir(), cual).toBe(false);
    }
  });

  it('admin.clases.tras_un_fallo_pasajero_de_confirmar_cancelar_subida_la_suelta_con_su_token', async () => {
    const m = mundo({
      vivas: [clase()],
      pisa: { [`POST ${RUTA}/${ID}/confirmar`]: () => detalle(502, 's3_fallo', 'No pudimos hablar con S3 ahora. Inténtalo de nuevo en unos minutos.') },
    });
    await abrir();
    await elegir(archivoDeVideo());
    await waitFor(() => expect(XhrFalso.todos).toHaveLength(1));
    act(() => ultimoXhr().terminar(200));
    await userEvent.click(await within(await screen.findByRole('article')).findByRole('button', { name: 'Cancelar subida' }));
    expect(await screen.findByText(TEXTO_SUBIDA_CANCELADA)).toBeInTheDocument();
    // se cancela con el token de ESA subida, la clase vuelve a «borrador» y se puede elegir otro video
    const cancelaciones = m.llamadas('POST', `${RUTA}/${ID}/cancelar`);
    expect(cancelaciones).toHaveLength(1);
    expect(cancelaciones[0]!.cuerpo!.token).toMatch(/^[0-9a-f]{32}$/);
    expect(m.vivas.get(ID)!.estado).toBe('borrador');
    expect(within(tarjeta(5)).getByText('Borrador')).toBeInTheDocument();
    expect(screen.getByLabelText('Subir video de la clase 5')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reintentar la confirmación' })).toBeNull();
    expect(avisaAlSalir()).toBe(false);
  });

  it('admin.clases.cada_rechazo_definitivo_de_confirmar_suelta_la_subida', async () => {
    const rechazos: Array<[number, string, string]> = [
      [404, 'archivo_no_esta', 'El video no llegó a la nube. Vuelve a subirlo.'],
      [422, 'video_vacio', 'El video llegó vacío. Elige otro.'],
      [422, 'tamano_invalido', 'El video pesa distinto de lo que dijiste. Cancela y vuelve a subirlo.'],
      [422, 'tipo_no_soportado', 'Ese archivo no es un video que se pueda usar.'],
    ];
    for (const [estado, codigo, texto] of rechazos) {
      cleanup();
      ponerXhrFalso();
      reiniciarAvisoDeSalida();
      const m = mundo({ vivas: [clase()], pisa: { [`POST ${RUTA}/${ID}/confirmar`]: () => detalle(estado, codigo, texto) } });
      await abrir();
      await elegir(archivoDeVideo());
      await waitFor(() => expect(XhrFalso.todos).toHaveLength(1));
      act(() => ultimoXhr().terminar(200));
      // el texto del servidor, tal cual, y la subida soltada con su token
      expect(await screen.findByRole('alert'), codigo).toHaveTextContent(texto);
      await waitFor(() => expect(m.llamadas('POST', `${RUTA}/${ID}/cancelar`), codigo).toHaveLength(1));
      expect(m.llamadas('POST', `${RUTA}/${ID}/cancelar`)[0]!.cuerpo!.token, codigo).toMatch(/^[0-9a-f]{32}$/);
      expect(m.llamadas('POST', `${RUTA}/${ID}/medir`), codigo).toHaveLength(0);
      expect(m.vivas.get(ID)!.estado, codigo).toBe('borrador');
      expect(await screen.findByLabelText('Subir video de la clase 5'), codigo).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Reintentar la confirmación' }), codigo).toBeNull();
      expect(avisaAlSalir(), codigo).toBe(false);
    }
  });

  it('admin.clases.una_subida_que_quedo_a_medias_se_confirma_sin_volver_a_subir', async () => {
    // se cerró la pestaña con el video ya en la nube: la tarjeta no sabe ni el token ni el nombre, pero el servidor confirma desde «subiendo»
    const m = mundo({ vivas: [clase({ estado: 'subiendo' })] });
    await abrir();
    expect(screen.queryByLabelText('Subir video de la clase 5')).toBeNull();
    await userEvent.click(within(tarjeta(5)).getByRole('button', { name: 'Reintentar la confirmación' }));
    expect(await screen.findByText(/^Listo: /)).toBeInTheDocument();
    expect(m.llamadas('POST', `${RUTA}/${ID}/confirmar`)[0]!.cuerpo).toEqual({});
    expect(m.llamadas('POST', `${RUTA}/${ID}/subida`)).toHaveLength(0);
    expect(XhrFalso.todos).toHaveLength(0);
    expect(within(tarjeta(5)).getByText('Subido')).toBeInTheDocument();
  });

  it('admin.clases.una_subida_a_medias_a_la_que_el_servidor_no_le_halla_el_video_no_se_cancela_sola', async () => {
    // si otra pestaña la sigue subiendo, confirmar sin token da `archivo_no_esta`: se dice, y NO se cancela lo que no es de esta tarjeta
    const m = mundo({
      vivas: [clase({ estado: 'subiendo' })],
      pisa: { [`POST ${RUTA}/${ID}/confirmar`]: () => detalle(404, 'archivo_no_esta', 'El video no llegó a la nube. Vuelve a subirlo.') },
    });
    await abrir();
    await userEvent.click(within(tarjeta(5)).getByRole('button', { name: 'Reintentar la confirmación' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('El video no llegó a la nube. Vuelve a subirlo.');
    expect(m.llamadas('POST', `${RUTA}/${ID}/cancelar`)).toHaveLength(0);
    expect(m.vivas.get(ID)!.estado).toBe('subiendo');
    expect(within(tarjeta(5)).getByRole('button', { name: 'Cancelar subida' })).toBeInTheDocument();
  });

  // 6 · el token: cada subida lleva el suyo y una vieja no puede tocar la nueva
  it('admin.clases.la_subida_lleva_su_token_en_confirmar_y_cancelar', async () => {
    const m = mundo({ vivas: [clase()] });
    await abrir();
    // la primera subida se cancela con SU token
    await elegir(archivoDeVideo('uno.mp4'));
    await waitFor(() => expect(XhrFalso.todos).toHaveLength(1));
    const primero = m.tokens.get(ID)!;
    expect(primero).toMatch(/^[0-9a-f]{32}$/);
    await userEvent.click(within(tarjeta(5)).getByRole('button', { name: 'Cancelar' }));
    await screen.findByText(TEXTO_SUBIDA_CANCELADA);
    expect(m.llamadas('POST', `${RUTA}/${ID}/cancelar`)[0]!.cuerpo).toEqual({ token: primero });
    // la segunda, con otro token, se confirma con ese otro
    await elegir(archivoDeVideo('dos.mp4'));
    await waitFor(() => expect(XhrFalso.todos).toHaveLength(2));
    const segundo = m.tokens.get(ID)!;
    expect(segundo).not.toBe(primero);
    act(() => ultimoXhr().terminar(200));
    await screen.findByText(/^Listo: /);
    expect(m.llamadas('POST', `${RUTA}/${ID}/confirmar`)[0]!.cuerpo).toEqual({ nombre: 'dos.mp4', token: segundo });
  });

  it('admin.clases.subida_cambio_no_cancela_nada_ni_se_trata_como_fallo_de_red', async () => {
    // el PUT de esta tarjeta termina, pero mientras tanto otra pestaña canceló esa subida y empezó otra: confirmar dice 409 subida_cambio
    const TEXTO = 'Esa subida ya no es la vigente: se empezó otra o se canceló. No se cambió nada.';
    const m: ReturnType<typeof mundo> = mundo({
      vivas: [clase()],
      pisa: {
        [`POST ${RUTA}/${ID}/confirmar`]: () => {
          m.vivas.set(ID, { ...m.vivas.get(ID)!, estado: 'borrador' }); // lo que dejó la otra pestaña
          return detalle(409, 'subida_cambio', TEXTO);
        },
      },
    });
    await abrir();
    await elegir(archivoDeVideo());
    await waitFor(() => expect(XhrFalso.todos).toHaveLength(1));
    act(() => ultimoXhr().terminar(200));
    // se dice con el texto del servidor, como aviso (no como falla de red ni de subida)
    expect(await screen.findByText(TEXTO)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(TEXTO_FALLO_SUBIDA)).toBeNull();
    // NO se cancela (sería tirar la subida de la otra pestaña), no se mide y no se ofrece reintentar lo que ya no es de esta tarjeta
    expect(m.llamadas('POST', `${RUTA}/${ID}/cancelar`)).toHaveLength(0);
    expect(m.llamadas('POST', `${RUTA}/${ID}/medir`)).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Reintentar la confirmación' })).toBeNull();
    // y se vuelve a pedir la clase: la tarjeta cuenta lo que el servidor tiene ahora
    await waitFor(() => expect(m.rutas().filter(r => r === 'GET /api/admin/clases?archivadas=0')).toHaveLength(2));
    expect(await screen.findByLabelText('Subir video de la clase 5')).toBeInTheDocument();
    expect(within(tarjeta(5)).getByText('Borrador')).toBeInTheDocument();
    expect(avisaAlSalir()).toBe(false);
  });

  it('admin.clases.cancelar_con_una_subida_que_ya_no_es_la_vigente_dice_el_texto_y_no_cambia_nada', async () => {
    const TEXTO = 'Esa subida ya no es la vigente: se empezó otra o se canceló. No se cambió nada.';
    const m = mundo({ vivas: [clase()], pisa: { [`POST ${RUTA}/${ID}/cancelar`]: () => detalle(409, 'subida_cambio', TEXTO) } });
    await abrir();
    await elegir(archivoDeVideo());
    await waitFor(() => expect(XhrFalso.todos).toHaveLength(1));
    await userEvent.click(within(tarjeta(5)).getByRole('button', { name: 'Cancelar' }));
    expect(await screen.findByText(TEXTO)).toBeInTheDocument();
    // no es «Subida cancelada» (no se canceló nada) ni un error de conexión
    expect(screen.queryByText(TEXTO_SUBIDA_CANCELADA)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(m.llamadas('POST', `${RUTA}/${ID}/cancelar`)).toHaveLength(1);
    expect(m.llamadas('POST', `${RUTA}/${ID}/confirmar`)).toHaveLength(0);
  });

  // 9 · sin internet a media subida
  it('admin.clases.sin_internet_a_media_subida_la_tarjeta_sigue_subiendo_y_ofrece_cancelar_subida', async () => {
    let intentos = 0;
    const m = mundo({
      vivas: [clase()],
      // el PUT se cae y el aviso al servidor también: la primera vez no hay red, la segunda sí
      pisa: { [`POST ${RUTA}/${ID}/cancelar`]: () => (++intentos === 1 ? Promise.reject(new TypeError('Failed to fetch')) : undefined) },
    });
    await abrir();
    await elegir(archivoDeVideo());
    await waitFor(() => expect(XhrFalso.todos).toHaveLength(1));
    act(() => ultimoXhr().fallar());
    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent(TEXTO_FALLO_SUBIDA);
    expect(alerta).toHaveTextContent('La subida quedó abierta en el servidor: pulsa «Cancelar subida» para volver a elegir el video.');
    // el servidor la tiene «subiendo» y la tarjeta lo dice: ya no dice «Borrador» ni ofrece subir otra vez (daría 409)
    expect(m.vivas.get(ID)!.estado).toBe('subiendo');
    const t = tarjeta(5);
    expect(within(t).getByText('Subiendo')).toBeInTheDocument();
    expect(within(t).queryByText('Borrador')).toBeNull();
    expect(screen.queryByLabelText('Subir video de la clase 5')).toBeNull();
    // vuelve la red: «Cancelar subida» la suelta con el token de esa subida
    await userEvent.click(within(t).getByRole('button', { name: 'Cancelar subida' }));
    expect(await screen.findByLabelText('Subir video de la clase 5')).toBeInTheDocument();
    expect(within(tarjeta(5)).getByText('Borrador')).toBeInTheDocument();
    expect(m.llamadas('POST', `${RUTA}/${ID}/cancelar`)).toHaveLength(2);
    expect(m.llamadas('POST', `${RUTA}/${ID}/cancelar`)[1]!.cuerpo).toEqual({ token: 'a'.repeat(31) + '1' });
    expect(avisaAlSalir()).toBe(false);
  });

  it('admin.clases.cancelar_sin_internet_dice_que_la_subida_quedo_abierta', async () => {
    const m = mundo({ vivas: [clase()], pisa: { [`POST ${RUTA}/${ID}/cancelar`]: () => Promise.reject(new TypeError('Failed to fetch')) } });
    await abrir();
    await elegir(archivoDeVideo());
    await waitFor(() => expect(XhrFalso.todos).toHaveLength(1));
    await userEvent.click(within(tarjeta(5)).getByRole('button', { name: 'Cancelar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Cortamos la subida, pero no pudimos avisarle al servidor.');
    // no dice «Subida cancelada» (el servidor sigue con ella) y ofrece volver a intentarlo
    expect(screen.queryByText(TEXTO_SUBIDA_CANCELADA)).toBeNull();
    expect(within(tarjeta(5)).getByRole('button', { name: 'Cancelar subida' })).toBeInTheDocument();
    expect(m.vivas.get(ID)!.estado).toBe('subiendo');
  });

  it('admin.clases.si_el_permiso_no_contesta_se_vuelve_a_pedir_la_clase', async () => {
    // sin red al pedir el permiso: el servidor pudo dejar la clase «subiendo» sin que aquí se sepa
    let intentos = 0;
    const m = mundo({
      vivas: [clase()],
      pisa: {
        [`POST ${RUTA}/${ID}/subida`]: () => {
          if (++intentos > 1) return undefined;
          m.vivas.set(ID, { ...m.vivas.get(ID)!, estado: 'subiendo' }); // el servidor sí lo recibió; la respuesta se perdió
          return Promise.reject(new TypeError('Failed to fetch'));
        },
      },
    });
    await abrir();
    await elegir(archivoDeVideo());
    expect(await screen.findByRole('alert')).toHaveTextContent('No hay conexión');
    await waitFor(() => expect(m.rutas().filter(r => r === 'GET /api/admin/clases?archivadas=0')).toHaveLength(2));
    // la tarjeta ya cuenta la verdad: «subiendo», con «Cancelar subida» para empezar de nuevo
    expect(await within(tarjeta(5)).findByRole('button', { name: 'Cancelar subida' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Subir video de la clase 5')).toBeNull();
  });

  // 10 · cambiar de pestaña a media subida
  it('admin.clases.al_volver_a_la_pestana_a_media_subida_sigue_la_barra_y_no_ofrece_cancelar_subida', async () => {
    const m = mundo({ vivas: [clase()] });
    render(<Admin />);
    await userEvent.click(await screen.findByRole('tab', { name: '4 · Clases' }));
    await elegir(archivoDeVideo('clase5.mp4', 'video/mp4', 1_400_000_000));
    await waitFor(() => expect(XhrFalso.todos).toHaveLength(1));
    act(() => ultimoXhr().avanzar(588_000_000, 1_400_000_000));
    await screen.findByText('Subiendo… 42 %');
    // mirar otra vista y volver ANTES de que termine el PUT
    await userEvent.click(screen.getByRole('tab', { name: '2 · Costos' }));
    expect(screen.queryByRole('progressbar')).toBeNull();
    await userEvent.click(screen.getByRole('tab', { name: '4 · Clases' }));
    // la tarjeta sigue contando la subida de verdad: su barra y su «Cancelar» (que corta el PUT), no «Hay una subida en curso…»
    expect(screen.getByRole('progressbar', { name: 'Subiendo… 42 %' })).toHaveAttribute('aria-valuenow', '42');
    expect(within(tarjeta(5)).getByRole('button', { name: 'Cancelar' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancelar subida' })).toBeNull();
    expect(screen.queryByText(/Hay una subida en curso/)).toBeNull();
    // la lista no se pidió otra vez (no hay nada que "restablecer"): la pestaña nunca se desmontó
    expect(m.rutas().filter(r => r.startsWith('GET /api/admin/clases'))).toHaveLength(1);
    // y «Cancelar» sigue sirviendo: corta el PUT
    await userEvent.click(within(tarjeta(5)).getByRole('button', { name: 'Cancelar' }));
    expect(ultimoXhr().abortado).toBe(true);
    expect(await screen.findByText(TEXTO_SUBIDA_CANCELADA)).toBeInTheDocument();
  });

  // 12 · el foco nunca cae al <body>
  it('admin.clases.el_foco_nunca_cae_al_body_al_empezar_cancelar_terminar_ni_medir', async () => {
    const titulo = () => within(tarjeta(5)).getByRole('heading', { level: 3 });
    const enBody = () => document.activeElement === document.body || document.activeElement === null;
    mundo({ vivas: [clase()] });
    await abrir();
    // empezar con el teclado: el selector tenía el foco y desaparece; el foco va al título de la tarjeta
    const selector = await subirA();
    selector.focus();
    expect(selector).toHaveFocus();
    fireEvent.change(selector, { target: { files: [archivoDeVideo()] } });
    await waitFor(() => expect(XhrFalso.todos).toHaveLength(1));
    expect(enBody()).toBe(false);
    expect(titulo()).toHaveFocus();
    // «Cancelar» con Enter: el botón desaparece y el foco no se pierde
    within(tarjeta(5)).getByRole('button', { name: 'Cancelar' }).focus();
    await userEvent.keyboard('{Enter}');
    await screen.findByText(TEXTO_SUBIDA_CANCELADA);
    expect(enBody()).toBe(false);
    expect(titulo()).toHaveFocus();
    // terminar: la persona se fue a «Cancelar» con Tab y el PUT acaba; el botón se va y el foco se queda en la tarjeta
    const otro = await subirA();
    otro.focus();
    fireEvent.change(otro, { target: { files: [archivoDeVideo()] } });
    await waitFor(() => expect(XhrFalso.todos).toHaveLength(2));
    within(tarjeta(5)).getByRole('button', { name: 'Cancelar' }).focus();
    act(() => ultimoXhr().terminar(200));
    await screen.findByText(/^Listo: /);
    expect(enBody()).toBe(false);
    expect(titulo()).toHaveFocus();
  });

  it('admin.clases.el_foco_no_cae_al_body_tras_medir_duracion', async () => {
    mundo({ vivas: [clase({ estado: 'subido', bytes: 1_400_000_000, duracion_s: null, nombre_original: 'c.mp4' })] });
    await abrir();
    const medirBoton = screen.getByRole('button', { name: 'Medir duración de la clase 5' });
    medirBoton.focus();
    await userEvent.keyboard('{Enter}');
    expect(await screen.findByText('Listo: 1 h 02 min · 1.4 GB')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Medir duración/ })).toBeNull();
    expect(document.activeElement).not.toBe(document.body);
    expect(within(tarjeta(5)).getByRole('heading', { level: 3 })).toHaveFocus();
  });

  it('admin.clases.no_se_le_roba_el_foco_a_quien_ya_se_fue_a_otra_parte', async () => {
    mundo({ vivas: [clase(), clase({ id: 'cl-2', numero: 6 })] });
    await abrir();
    const selector = await subirA();
    selector.focus();
    fireEvent.change(selector, { target: { files: [archivoDeVideo()] } });
    await waitFor(() => expect(XhrFalso.todos).toHaveLength(1));
    // mientras sube, la persona se va a «Editar» de la otra clase: cuando la subida termine, el foco sigue ahí
    const editar = screen.getByRole('button', { name: 'Editar la clase 6' });
    editar.focus();
    act(() => ultimoXhr().terminar(200));
    await screen.findByText(/^Listo: /);
    expect(editar).toHaveFocus();
  });

  // 13 · el aviso de archivar o restaurar sale dentro de la tarjeta que se tocó
  it('admin.clases.si_falla_archivar_o_restaurar_el_aviso_sale_dentro_de_la_tarjeta', async () => {
    const vivas = Array.from({ length: 9 }, (_, i) => clase({ id: `cl-${i + 1}`, numero: i + 1, titulo: `Clase número ${i + 1}` }));
    let archivados = 0;
    mundo({
      vivas,
      archivadas: [clase({ id: 'cl-viejo', numero: 20, titulo: 'Vieja' })],
      pisa: {
        'DELETE /api/admin/clases/cl-7': () => (++archivados === 1 ? detalle(503, 'no_disponible', 'No pudimos archivar la clase ahora.') : undefined),
        'POST /api/admin/clases/cl-viejo/restaurar': () => detalle(409, 'numero_repetido', 'Ya hay una clase 20. Cámbiale el número a una de las dos.'),
      },
    });
    await abrir();
    // archivar la 7 de 9 falla: el aviso está DENTRO de la tarjeta 7 y no arriba de toda la lista
    await userEvent.click(screen.getByRole('button', { name: 'Archivar la clase 7' }));
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Archivar' }));
    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent('No pudimos archivar la clase ahora.');
    expect(tarjeta(7)).toContainElement(alerta);
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByRole('list', { name: 'Clases' })).toContainElement(alerta);
    expect(tarjeta(7)).toBeInTheDocument();
    // el segundo intento sale bien: el aviso se va con él
    await userEvent.click(screen.getByRole('button', { name: 'Archivar la clase 7' }));
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Archivar' }));
    await waitFor(() => expect(screen.queryByRole('article', { name: /^Clase 7 ·/ })).toBeNull());
    expect(screen.queryByRole('alert')).toBeNull();
    // restaurar con un número repetido: el aviso está DENTRO de la tarjeta archivada
    await userEvent.click(screen.getByRole('switch', { name: 'Ver clases archivadas' }));
    const vieja = (await screen.findAllByRole('article', { name: /^Clase 20 ·/ }))[0]!;
    await userEvent.click(within(vieja).getByRole('button', { name: 'Restaurar la clase 20' }));
    const otra = await within(vieja).findByRole('alert');
    expect(otra).toHaveTextContent('Ya hay una clase 20. Cámbiale el número a una de las dos.');
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByRole('list', { name: 'Clases archivadas' })).toContainElement(otra);
  });

  // 14 · dos subidas a la vez
  it('admin.clases.dos_subidas_a_la_vez_mantienen_el_aviso_de_cerrar_hasta_que_terminen_las_dos', async () => {
    mundo({ vivas: [clase(), clase({ id: 'cl-2', numero: 6 })] });
    await abrir();
    expect(avisaAlSalir()).toBe(false);
    await elegir(archivoDeVideo('c5.mp4'), 5);
    await elegir(archivoDeVideo('c6.mp4'), 6);
    await waitFor(() => expect(XhrFalso.todos).toHaveLength(2));
    expect(avisaAlSalir()).toBe(true);
    // termina la primera: la segunda sigue subiendo y cerrar la pestaña todavía la perdería
    act(() => XhrFalso.todos[0]!.terminar(200));
    await within(tarjeta(5)).findByText(/^Listo: /);
    expect(within(tarjeta(6)).getByRole('progressbar')).toBeInTheDocument();
    expect(avisaAlSalir()).toBe(true);
    // termina la segunda: ahora sí ya no hay nada que perder
    act(() => XhrFalso.todos[1]!.terminar(200));
    await within(tarjeta(6)).findByText(/^Listo: /);
    expect(avisaAlSalir()).toBe(false);
  });

  // 15 · el nombre accesible repite el texto visible (WCAG 2.5.3)
  it('admin.clases.medir_duracion_repite_su_texto_visible_en_su_nombre_accesible', async () => {
    mundo({
      vivas: [
        clase({ estado: 'subido', bytes: 1_400_000_000, duracion_s: null, nombre_original: 'c.mp4' }),
        clase({ id: 'cl-2', numero: 6, estado: 'subido', bytes: 900_000_000, duracion_s: 600 }),
        clase({ id: 'cl-3', numero: 7, estado: 'subiendo' }),
        clase({ id: 'cl-4', numero: 8 }),
      ],
    });
    await abrir();
    const medirBoton = screen.getByRole('button', { name: 'Medir duración de la clase 5' });
    expect(medirBoton).toHaveTextContent('Medir duración');
    // cada botón de cada tarjeta: lo que se lee en pantalla está contenido en lo que dice el nombre accesible
    const sinRepetir: string[] = [];
    for (const boton of within(screen.getByRole('list', { name: 'Clases' })).getAllByRole('button')) {
      const visible = (boton.textContent ?? '').trim();
      const nombre = boton.getAttribute('aria-label') ?? visible;
      if (visible && !nombre.includes(visible)) sinRepetir.push(`${visible} → ${nombre}`);
    }
    expect(sinRepetir).toEqual([]);
  });

  // 16 · el interruptor encendido no es el ámbar del botón
  it('admin.clases.el_interruptor_encendido_no_es_ambar_de_boton', async () => {
    mundo({ vivas: [clase()], archivadas: [clase({ id: 'cl-viejo', numero: 2, titulo: 'Vieja' })] });
    await abrir();
    const interruptor = screen.getByRole('switch', { name: 'Ver clases archivadas' });
    await userEvent.click(interruptor);
    await screen.findByRole('button', { name: 'Restaurar la clase 2' });
    expect(interruptor).toHaveAttribute('aria-checked', 'true');
    // el único ámbar de la pantalla sigue siendo «Nueva clase» (la cuenta ve también la pista y la bolita del interruptor)
    expect(ambares()).toEqual(['Nueva clase']);
    // encendido lleva el tono de «elegido» (borde #a96716 sobre fondo #2e2110), con la bolita en ámbar claro
    const pista = interruptor.firstElementChild!;
    expect(pista).toHaveClass('border-ambar-hondo', 'bg-aviso-fondo');
    expect(pista).not.toHaveClass('bg-ambar');
    expect(pista.firstElementChild).toHaveClass('bg-ambar-claro');
    // con el formulario abierto el ámbar es «Guardar clase» y el interruptor sigue sin sumar otro
    await userEvent.click(screen.getByRole('button', { name: 'Nueva clase' }));
    expect(ambares()).toEqual(['Guardar clase']);
  });

  // 17 · lo escrito en un formulario no se descarta en silencio
  it('admin.clases.editar_otra_clase_con_cambios_sin_guardar_pide_confirmar', async () => {
    const m = mundo({ vivas: [clase(), clase({ id: 'cl-2', numero: 6, titulo: 'Seis' })] });
    await abrir();
    // sin nada escrito, cambiar de formulario es libre
    await abrirFormulario();
    await userEvent.click(screen.getByRole('button', { name: 'Editar la clase 6' }));
    expect(await screen.findByRole('region', { name: 'Editar la clase 6' })).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    // con una «Nueva clase» a medias, «Editar» de otra tarjeta pregunta antes
    await userEvent.click(within(screen.getByRole('region', { name: 'Editar la clase 6' })).getByRole('button', { name: 'Cancelar' }));
    await abrirFormulario();
    await userEvent.type(screen.getByLabelText('Título'), 'Lo que estaba escribiendo');
    await userEvent.click(screen.getByRole('button', { name: 'Editar la clase 6' }));
    const dialogo = await screen.findByRole('alertdialog', { name: '¿Dejar lo que estás escribiendo?' });
    expect(dialogo).toHaveTextContent('Tienes cambios sin guardar en «Nueva clase». Si sigues, se pierden.');
    // el foco arranca en lo que NO pierde nada
    expect(within(dialogo).getByRole('button', { name: 'Seguir escribiendo' })).toHaveFocus();
    // Esc y «Seguir escribiendo» no tocan nada: lo escrito sigue ahí y el foco vuelve al formulario
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(screen.getByLabelText('Título')).toHaveValue('Lo que estaba escribiendo');
    await waitFor(() => expect(screen.getByLabelText('Número de clase')).toHaveFocus());
    expect(screen.queryByRole('region', { name: 'Editar la clase 6' })).toBeNull();
    // confirmar sí cambia: el formulario es el de la clase 6 y el foco va a su primer campo
    await userEvent.click(screen.getByRole('button', { name: 'Editar la clase 6' }));
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Editar la clase 6' }));
    const form = await screen.findByRole('region', { name: 'Editar la clase 6' });
    expect(within(form).getByLabelText('Título')).toHaveValue('Seis');
    expect(screen.queryByRole('region', { name: 'Nueva clase' })).toBeNull();
    await waitFor(() => expect(within(form).getByLabelText('Número de clase')).toHaveFocus());
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    // el diálogo no manda nada al servidor
    expect(m.llamadas('POST', RUTA)).toHaveLength(0);
    expect(m.llamadas('PATCH', `${RUTA}/cl-2`)).toHaveLength(0);
    // y pulsar «Editar» de la clase que YA se está editando no pregunta nada
    await userEvent.type(within(form).getByLabelText('Título'), ' y más');
    await userEvent.click(screen.getByRole('button', { name: 'Editar la clase 6' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(within(form).getByLabelText('Título')).toHaveValue('Seis y más');
  });

  it('admin.clases.cambiar_de_pestana_conserva_el_formulario_abierto', async () => {
    const m = mundo({ vivas: [clase()] });
    render(<Admin />);
    // Clases no se monta (ni pide nada) hasta que se abre por primera vez
    await screen.findByRole('tablist', { name: 'Vistas' });
    expect(m.rutas().filter(r => r.startsWith('GET /api/admin/clases'))).toHaveLength(0);
    await userEvent.click(screen.getByRole('tab', { name: '4 · Clases' }));
    await abrirFormulario();
    await userEvent.type(screen.getByLabelText('Título'), 'Borrador a medias');
    // mirar otra vista y volver: lo escrito sigue ahí
    await userEvent.click(screen.getByRole('tab', { name: '1 · Ingresos' }));
    expect(screen.queryByRole('textbox', { name: 'Título' })).toBeNull(); // oculta: ni se ve ni se lee (sigue en el DOM, con `hidden`)
    expect(screen.getByLabelText('Título').closest('[role="tabpanel"]')).toHaveAttribute('hidden');
    await userEvent.click(screen.getByRole('tab', { name: '4 · Clases' }));
    expect(screen.getByLabelText('Título')).toHaveValue('Borrador a medias');
    expect(m.rutas().filter(r => r.startsWith('GET /api/admin/clases'))).toHaveLength(1);
  });
});
