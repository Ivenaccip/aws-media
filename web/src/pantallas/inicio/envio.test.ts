// Lo que trae un pegado (Ctrl+V), sin pantalla: qué imágenes salen y con qué nombre.
// El comportamiento en la caja (agregar, pasar a editar, no tocar otros campos) se prueba en Inicio.test.tsx.
import { describe, expect, it } from 'vitest';

import { imagenesPegadas } from './envio';

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
