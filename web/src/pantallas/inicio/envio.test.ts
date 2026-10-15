// Lo que trae un pegado (Ctrl+V), sin pantalla: qué imágenes salen y con qué nombre.
// El comportamiento en la caja (agregar, pasar a editar, no tocar otros campos) se prueba en Inicio.test.tsx.
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ErrorApi } from '../../nucleo/api';
import {
  cotizarEdicion,
  descripcionDeArchivos,
  EXTS_EDITAR,
  imagenesPegadas,
  iniciarEdicion,
  pedirElegibles,
  pedirEstadoEdicion,
  reintentarEdicion,
  soloImagenes,
  traerImagen,
} from './envio';

const archivo = (nombre: string, tipo: string) => new File(['x'], nombre, { type: tipo });

// jsdom no trae DataTransfer: lo que usa la función es files, items y getData
const portapapeles = ({
  files = [],
  items = [],
  texto = '',
}: {
  files?: File[];
  items?: Array<{ kind: string; getAsFile: () => File | null }>;
  texto?: string;
} = {}) => ({ files, items, getData: () => texto }) as unknown as DataTransfer;

describe('imagenesPegadas', () => {
  it('sin portapapeles o vacío no hay nada que agregar', () => {
    expect(imagenesPegadas(null)).toEqual([]);
    expect(imagenesPegadas(undefined)).toEqual([]);
    expect(imagenesPegadas(portapapeles())).toEqual([]);
  });

  it('un archivo copiado conserva su nombre y es el mismo objeto', () => {
    const f = archivo('vacaciones.jpg', 'image/jpeg');
    const [r] = imagenesPegadas(portapapeles({ files: [f] }));
    expect(r).toBe(f);
  });

  it('una captura («image.png» o sin nombre) recibe un nombre que dice qué es y conserva su contenido y tipo', async () => {
    const [a, b, c] = imagenesPegadas(
      portapapeles({ files: [archivo('image.png', 'image/png'), archivo('', 'image/webp'), archivo('IMAGE.JPG', 'image/jpeg')] }),
    );
    expect([a!.name, b!.name, c!.name]).toEqual(['imagen-pegada-1.png', 'imagen-pegada-2.webp', 'imagen-pegada-3.jpg']);
    expect(a!.type).toBe('image/png');
    // jsdom no trae File.text(): se lee con FileReader
    const contenido = await new Promise<string>(listo => {
      const lector = new FileReader();
      lector.onload = () => listo(String(lector.result));
      lector.readAsText(a!);
    });
    expect(contenido).toBe('x');
  });

  it('una sola captura no lleva número', () => {
    expect(imagenesPegadas(portapapeles({ files: [archivo('image.png', 'image/png')] })).map(f => f.name)).toEqual(['imagen-pegada.png']);
    // sin nombre y de un tipo que no conocemos: png, que es lo que pega casi todo
    expect(imagenesPegadas(portapapeles({ files: [archivo('', 'image/x-raro')] })).map(f => f.name)).toEqual(['imagen-pegada.png']);
  });

  it('con texto manda el texto: Word y Excel traen las letras y una foto de ellas', () => {
    expect(imagenesPegadas(portapapeles({ texto: 'una tabla', files: [archivo('image.png', 'image/png')] }))).toEqual([]);
    // solo espacios no es texto
    expect(imagenesPegadas(portapapeles({ texto: '  \n', files: [archivo('image.png', 'image/png')] }))).toHaveLength(1);
  });

  it('el Finder de macOS manda el NOMBRE del archivo como texto: es la imagen, no letras', () => {
    const una = archivo('Foto del gato.png', 'image/png');
    // el nombre solo, sin mayúsculas, sin extensión, con la ruta o como file:///
    for (const texto of ['Foto del gato.png', 'foto del gato.PNG', 'Foto del gato', '/Users/ana/Fotos/Foto del gato.png', 'file:///Users/ana/Fotos/Foto%20del%20gato.png', 'Foto del gato.png\n']) {
      expect(imagenesPegadas(portapapeles({ files: [una], texto })), texto).toHaveLength(1);
    }
    // macOS guarda el nombre del archivo descompuesto (NFD) y el texto compuesto (NFC)
    const nfd = archivo('Fotografi\u0301a.png'.normalize('NFD'), 'image/png');
    expect(imagenesPegadas(portapapeles({ files: [nfd], texto: 'Fotografía.png'.normalize('NFC') }))).toHaveLength(1);
    // varios archivos: una línea por nombre
    const dos = imagenesPegadas(portapapeles({ files: [archivo('a.png', 'image/png'), archivo('b.jpg', 'image/jpeg')], texto: 'a.png\nb.jpg' }));
    expect(dos.map(f => f.name)).toEqual(['a.png', 'b.jpg']);
  });

  it('un texto que NO son solo los nombres de los archivos sigue ganando', () => {
    const f = archivo('a.png', 'image/png');
    expect(imagenesPegadas(portapapeles({ files: [f], texto: 'a.png y algo más' }))).toEqual([]);
    expect(imagenesPegadas(portapapeles({ files: [f], texto: 'a.png\notra cosa' }))).toEqual([]);
    expect(imagenesPegadas(portapapeles({ files: [f], texto: 'file:///x/%E0%A4%A.png' }))).toEqual([]); // un % suelto no rompe nada
  });

  it('lo que no es imagen se deja pasar; un .heic sin tipo sí cuenta', () => {
    expect(imagenesPegadas(portapapeles({ files: [archivo('cuenta.pdf', 'application/pdf')] }))).toEqual([]);
    expect(imagenesPegadas(portapapeles({ files: [archivo('foto.HEIC', '')] })).map(f => f.name)).toEqual(['foto.HEIC']);
  });

  it('si files viene vacío, la imagen se saca de los elementos del portapapeles', () => {
    const f = archivo('image.png', 'image/png');
    const r = imagenesPegadas(
      portapapeles({
        items: [
          { kind: 'string', getAsFile: () => null },
          { kind: 'file', getAsFile: () => null },
          { kind: 'file', getAsFile: () => f },
        ],
      }),
    );
    expect(r.map(x => x.name)).toEqual(['imagen-pegada.png']);
  });
});

describe('lo que sirve para el «+» y la hoja de Mis creaciones', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('la frase de archivos nombra las extensiones que de verdad se aceptan y su tope', () => {
    const editar = descripcionDeArchivos('editar');
    // jpg y jpeg son el mismo formato para quien lee
    for (const ext of EXTS_EDITAR.filter(e => e !== '.jpeg')) expect(editar.toLowerCase()).toContain(ext.slice(1));
    expect(editar).toBe('JPG, PNG o WebP · hasta 15 MB');
    expect(descripcionDeArchivos('clip')).toBe('JPG, PNG, WebP, GIF, AVIF o HEIC · hasta 20 MB');
  });

  it('solo se quedan las imágenes (un .heic sin tipo cuenta)', () => {
    const r = soloImagenes([archivo('a.png', 'image/png'), archivo('b.pdf', 'application/pdf'), archivo('c.HEIC', ''), archivo('d.txt', 'text/plain')]);
    expect(r.map(f => f.name)).toEqual(['a.png', 'c.HEIC']);
  });

  it('traerImagen envuelve lo que baja de nuestro endpoint con su nombre y su tipo', async () => {
    const f = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
      async () => new Response('contenido', { status: 200, headers: { 'Content-Type': 'image/png' } }),
    );
    vi.stubGlobal('fetch', f);
    const r = await traerImagen({ nombre: 'abc.png' });
    expect([r.name, r.type]).toEqual(['abc.png', 'image/png']);
    // los bytes se piden a /archivo (mismo origen), jamás a la URL de la imagen: en la nube esa redirige a un CDN sin CORS
    expect(f.mock.calls[0]![0]).toBe('/api/imagenes/abc.png/archivo');
    // y un nombre con espacios o símbolos viaja codificado
    await traerImagen({ nombre: 'mi foto&1.jpg' });
    expect(f.mock.calls[1]![0]).toBe('/api/imagenes/mi%20foto%261.jpg/archivo');
    // sin tipo en la respuesta, jpeg (lo que genera el estudio)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([120]), { status: 200 })));
    expect((await traerImagen({ nombre: 'z.jpg' })).type).toBe('image/jpeg');
  });

  it('traerImagen pasa la señal para poder cancelarse', async () => {
    const f = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => new Response('x', { status: 200 }));
    vi.stubGlobal('fetch', f);
    const cancelar = new AbortController();
    await traerImagen({ nombre: 'a.jpg' }, cancelar.signal);
    expect(f.mock.calls[0]![1]).toEqual({ signal: cancelar.signal });
  });

  it('traerImagen falla si el servidor no la tiene', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('no', { status: 404 })));
    await expect(traerImagen({ nombre: 'x.jpg' })).rejects.toThrow('no se pudo traer');
  });
});

// Las peticiones de /api/edicion (E2): la ruta, el método y el cuerpo EXACTOS. Lo que importa de verdad es lo que NO viaja: ni créditos,
// ni keys de S3, ni duraciones, ni formatos (el servidor lo averigua todo y decide el precio).
describe('las peticiones de /api/edicion', () => {
  afterEach(() => vi.unstubAllGlobals());

  const json = (cuerpo: unknown, status = 200) =>
    new Response(JSON.stringify(cuerpo), { status, headers: { 'Content-Type': 'application/json' } });
  const falso = (respuesta: () => Response) => {
    const f = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => respuesta());
    vi.stubGlobal('fetch', f);
    return f;
  };
  const llamada = (f: ReturnType<typeof falso>, i = 0) => {
    const [url, init] = f.mock.calls[i]!;
    return { url, metodo: init?.method, cuerpo: init?.body === undefined ? undefined : JSON.parse(String(init.body)), init };
  };
  const PEDIDO = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

  it('pedirElegibles es un GET sin cuerpo y pasa la señal para poder cancelarse al cerrar la hoja', async () => {
    const f = falso(() => json({ videos: [], limites: { max_s: 5400, min_solo_s: 60, max_videos: 12, max_bytes: 16106127360 } }));
    const cancelar = new AbortController();
    const r = await pedirElegibles(cancelar.signal);
    expect(r.limites.max_videos).toBe(12);
    const l = llamada(f);
    expect([l.url, l.metodo, l.cuerpo]).toEqual(['/api/edicion/elegibles', 'GET', undefined]);
    expect(l.init?.signal).toBe(cancelar.signal);
    // sin señal, la petición no lleva ninguna
    await pedirElegibles();
    expect(llamada(f, 1).init?.signal).toBeUndefined();
  });

  it('cotizarEdicion manda SOLO las referencias, en el orden de la caja', async () => {
    const f = falso(() => json({ titulo: 'a + 1 más', n_videos: 2, duracion_total_s: 1, creditos: 8, desglose: null, ocupado: false, bloqueo: null, videos: [] }));
    await cotizarEdicion(['clip:clip-20261008-101500-ab12cd', 'proyecto:entrevista']);
    const l = llamada(f);
    expect([l.url, l.metodo]).toEqual(['/api/edicion/cotizar', 'POST']);
    expect(l.cuerpo).toEqual({ videos: ['clip:clip-20261008-101500-ab12cd', 'proyecto:entrevista'] });
    // las claves del cuerpo son exactamente esa: nada de créditos, keys, duraciones ni formatos
    expect(Object.keys(l.cuerpo as object)).toEqual(['videos']);
  });

  it('iniciarEdicion manda la clave del pedido, las referencias en su orden y la instrucción; nunca un número de créditos', async () => {
    const f = falso(() => json({ lanzado: true, nombre: 'ed-9f1c0a7b', creditos: 8, n_videos: 2, repetido: false }));
    const r = await iniciarEdicion({ pedido: PEDIDO, videos: ['proyecto:b', 'proyecto:a'], instruccion: 'Quítale las muletillas' });
    expect(r.nombre).toBe('ed-9f1c0a7b');
    const l = llamada(f);
    expect([l.url, l.metodo]).toEqual(['/api/edicion/iniciar', 'POST']);
    expect(l.cuerpo).toEqual({ pedido: PEDIDO, videos: ['proyecto:b', 'proyecto:a'], instruccion: 'Quítale las muletillas' });
    expect(Object.keys(l.cuerpo as object).sort()).toEqual(['instruccion', 'pedido', 'videos']);
    expect(String(f.mock.calls[0]![1]?.body)).not.toMatch(/credit|key|duracion|formato/i);
  });

  it('reintentarEdicion es un POST a la copia, sin cuerpo, y el nombre viaja codificado', async () => {
    const f = falso(() => json({ lanzado: true, nombre: 'ed-9f1c0a7b', creditos: 8 }));
    await reintentarEdicion('ed-9f1c0a7b');
    const l = llamada(f);
    expect([l.url, l.metodo, l.cuerpo]).toEqual(['/api/edicion/ed-9f1c0a7b/reintentar', 'POST', undefined]);
    await reintentarEdicion('raro/nombre ñ');
    expect(llamada(f, 1).url).toBe('/api/edicion/raro%2Fnombre%20%C3%B1/reintentar');
  });

  it('pedirEstadoEdicion pregunta por la copia con un GET (nunca al montar: lo llama quien ya lanzó)', async () => {
    const f = falso(() => json({ editar: { estado: 'corriendo' } }));
    expect((await pedirEstadoEdicion('ed-9f1c0a7b')).editar?.estado).toBe('corriendo');
    const l = llamada(f);
    expect([l.url, l.metodo, l.cuerpo]).toEqual(['/api/editar/ed-9f1c0a7b', 'GET', undefined]);
  });

  it('el texto del servidor sube tal cual en el error (402, 409 y el bloqueo de iniciar)', async () => {
    falso(() => json({ detail: 'Créditos insuficientes: esta acción cuesta 8 créditos y tu saldo es 5.' }, 402));
    const e402 = await iniciarEdicion({ pedido: PEDIDO, videos: ['proyecto:a'], instruccion: 'x' }).catch((e: unknown) => e);
    expect(e402).toBeInstanceOf(ErrorApi);
    expect((e402 as ErrorApi).estado).toBe(402);
    expect((e402 as ErrorApi).message).toBe('Créditos insuficientes: esta acción cuesta 8 créditos y tu saldo es 5.');
    expect((e402 as ErrorApi).sinSaldo).toBe(true);
    falso(() => json({ detail: 'Los videos horizontales y los verticales no se mezclan. Quita los verticales o edítalos aparte.' }, 422));
    const e422 = await iniciarEdicion({ pedido: PEDIDO, videos: ['proyecto:a', 'proyecto:b'], instruccion: 'x' }).catch((e: unknown) => e);
    expect((e422 as ErrorApi).message).toBe('Los videos horizontales y los verticales no se mezclan. Quita los verticales o edítalos aparte.');
  });

  it('una caída de red sube como estado 0 (la caja lo trata como respuesta dudosa y conserva el pedido)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    const e = await iniciarEdicion({ pedido: PEDIDO, videos: ['proyecto:a'], instruccion: 'x' }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ErrorApi);
    expect((e as ErrorApi).estado).toBe(0);
  });
});
