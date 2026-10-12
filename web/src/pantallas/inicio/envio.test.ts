// Lo que trae un pegado (Ctrl+V), sin pantalla: qué imágenes salen y con qué nombre.
// El comportamiento en la caja (agregar, pasar a editar, no tocar otros campos) se prueba en Inicio.test.tsx.
import { afterEach, describe, expect, it, vi } from 'vitest';

import { descripcionDeArchivos, EXTS_EDITAR, imagenesPegadas, soloImagenes, traerImagen } from './envio';

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

  it('traerImagen envuelve lo que baja del servidor con su nombre y su tipo', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('contenido', { status: 200, headers: { 'Content-Type': 'image/png' } })));
    const f = await traerImagen({ nombre: 'abc.png', url: '/api/imagenes/abc.png' });
    expect([f.name, f.type]).toEqual(['abc.png', 'image/png']);
    // sin tipo en la respuesta, jpeg (lo que genera el estudio)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([120]), { status: 200 })));
    expect((await traerImagen({ nombre: 'z.jpg', url: '/u' })).type).toBe('image/jpeg');
  });

  it('traerImagen falla si el servidor no la tiene', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('no', { status: 404 })));
    await expect(traerImagen({ nombre: 'x.jpg', url: '/u' })).rejects.toThrow('no se pudo traer');
  });
});
