// La lógica de la Biblioteca sin React (logica.ts). Son pruebas SUELTAS (sin ID): lo que la pantalla garantiza de cara a la persona está en
// Biblioteca.test.tsx; aquí, los bordes de cada función.
import { describe, expect, it } from 'vitest';

import { urlDeCaja } from '../../marca/rutas';
import { ErrorApi } from '../../nucleo/api';
import {
  ambitoDeLaDireccion,
  filtrar,
  fijar,
  leerListado,
  MAX_LLEVAR,
  mover,
  normalizar,
  partesDe,
  porTexto,
  quitar,
  resumenDeLista,
  SIN_FILTRO,
  textoTope,
  TODAS,
  urlDeLlevar,
  vigentesDe,
  type Categoria,
  type Prompt,
} from './logica';

const CATS: Categoria[] = [
  { clave: 'imagen', nombre: 'Imagen' },
  { clave: 'guion', nombre: 'Guion y texto' },
];
const p = (id: string, titulo: string, extra: Partial<Prompt> = {}): Prompt => ({
  id,
  titulo,
  para_que: '',
  prompt: 'un prompt',
  categoria: 'imagen',
  etiquetas: [],
  lleva_a: null,
  ...extra,
});

describe('leerListado · un campo que falta no tira la pantalla', () => {
  it('con una respuesta vacía o rara devuelve listas vacías y los límites del contrato', () => {
    for (const crudo of [null, undefined, 'x', 3, {}, { casa: 'no es lista', mios: {}, fijados: 5 }]) {
      const l = leerListado(crudo);
      expect(l).toMatchObject({ categorias: [], casa: [], mios: [], fijados: [], limites: { fijados: 3, mios: 100, titulo: 80, prompt: 16000 } });
    }
  });

  it('descarta lo que no tiene id o prompt, completa el título y los «Míos» nunca se llevan a la caja', () => {
    const l = leerListado({
      categorias: [{ clave: 'imagen', nombre: 'Imagen' }, { nombre: 'sin clave' }, 7],
      casa: [
        { id: 'casa-a', titulo: 'A', prompt: 'texto', categoria: 'imagen', etiquetas: ['uno', '', 3, ' dos '], lleva_a: 'imagen' },
        { id: 'casa-b', prompt: '' },
        { prompt: 'sin id' },
        { id: 'casa-c', prompt: 'ok', lleva_a: 'otra-cosa' },
      ],
      mios: [{ id: 'mio-1', titulo: 'M', prompt: 'mío', lleva_a: 'imagen', origen: 'coi', creado: '2026-10-16T18:20:00Z' }],
      fijados: ['casa-a', 'casa-a', 'mio-1', 'casa-ya-no-existe', 7],
      limites: { fijados: 2, mios: 'cien' },
    });
    expect(l.categorias).toEqual([{ clave: 'imagen', nombre: 'Imagen' }]);
    expect(l.casa.map(x => x.id)).toEqual(['casa-a', 'casa-c']);
    expect(l.casa[0]!.etiquetas).toEqual(['uno', 'dos']);
    expect(l.casa[1]).toMatchObject({ titulo: 'Sin título', lleva_a: null });
    // un «mío» jamás se lleva a la caja, aunque el servidor lo dijera
    expect(l.mios[0]).toMatchObject({ lleva_a: null, origen: 'coi', creado: '2026-10-16T18:20:00Z' });
    // sin repetidos y sin ids que no existen
    expect(l.fijados).toEqual(['casa-a', 'mio-1']);
    expect(l.limites).toEqual({ fijados: 2, mios: 100, titulo: 80, prompt: 16000 });
  });
});

describe('buscar', () => {
  it('normalizar quita tildes y mayúsculas', () => {
    expect(normalizar('ILUSTRACIÓN Ñandú')).toBe('ilustracion nandu');
  });

  it('busca en título, para qué sirve, etiquetas y categoría, todas las palabras, y la etiqueta es exacta', () => {
    const lista = [
      p('1', 'Retrato', { para_que: 'Fotos de perfil', etiquetas: ['equipo'] }),
      p('2', 'Guion corto', { categoria: 'guion', etiquetas: ['ventas'] }),
    ];
    expect(porTexto(lista, { ...SIN_FILTRO, q: 'PERFIL' }, CATS).map(x => x.id)).toEqual(['1']);
    expect(porTexto(lista, { ...SIN_FILTRO, q: 'guion y texto' }, CATS).map(x => x.id)).toEqual(['2']);
    expect(porTexto(lista, { ...SIN_FILTRO, q: 'retrato equipo' }, CATS).map(x => x.id)).toEqual(['1']);
    expect(porTexto(lista, { ...SIN_FILTRO, q: 'retrato ventas' }, CATS)).toEqual([]);
    // una etiqueta no es una subcadena: «equi» no es «equipo»
    expect(porTexto(lista, { ...SIN_FILTRO, etiqueta: 'equi' }, CATS)).toEqual([]);
    expect(porTexto(lista, { ...SIN_FILTRO, etiqueta: 'EQUIPO' }, CATS).map(x => x.id)).toEqual(['1']);
    // la categoría solo recorta en `filtrar`, no en `porTexto` (de ahí salen los números de los chips)
    expect(filtrar(lista, { ...SIN_FILTRO, categoria: 'guion' }, CATS).map(x => x.id)).toEqual(['2']);
    expect(porTexto(lista, { ...SIN_FILTRO, categoria: 'guion' }, CATS)).toHaveLength(2);
  });

  it('el resumen dice cuántos y de qué', () => {
    expect(resumenDeLista(1, SIN_FILTRO, CATS)).toBe('1 prompt');
    expect(resumenDeLista(14, SIN_FILTRO, CATS)).toBe('14 prompts');
    expect(resumenDeLista(0, { q: ' x ', categoria: TODAS, etiqueta: '' }, CATS)).toBe('Sin resultados para «x»');
    expect(resumenDeLista(3, { q: 'a', categoria: 'guion', etiqueta: 'ventas' }, CATS)).toBe('3 resultados para «a» en Guion y texto con #ventas');
  });
});

describe('fijar · el top, sin sustituir en silencio', () => {
  it('agrega al final, no repite y con el tope lleno avisa sin cambiar nada', () => {
    expect(fijar([], 'a', 3)).toEqual({ ok: true, ids: ['a'] });
    expect(fijar(['a', 'b'], 'c', 3)).toEqual({ ok: true, ids: ['a', 'b', 'c'] });
    expect(fijar(['a', 'b'], 'a', 3)).toEqual({ ok: true, ids: ['a', 'b'] });
    expect(fijar(['a', 'b', 'c'], 'd', 3)).toEqual({ ok: false, texto: 'Ya tienes 3 fijados. Quita uno para fijar este.' });
    // aunque ya estaba: con el tope lleno, fijar uno que YA está no es un error
    expect(fijar(['a', 'b', 'c'], 'b', 3)).toEqual({ ok: true, ids: ['a', 'b', 'c'] });
    expect(textoTope(1)).toBe('Ya tienes 1 fijado. Quita uno para fijar este.');
  });

  it('mover cambia dos lugares y en los extremos no hace nada; quitar no toca el resto', () => {
    expect(mover(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c']);
    expect(mover(['a', 'b', 'c'], 'b', 1)).toEqual(['a', 'c', 'b']);
    expect(mover(['a', 'b', 'c'], 'a', -1)).toEqual(['a', 'b', 'c']);
    expect(mover(['a', 'b', 'c'], 'c', 1)).toEqual(['a', 'b', 'c']);
    expect(mover(['a', 'b', 'c'], 'z', 1)).toEqual(['a', 'b', 'c']);
    expect(quitar(['a', 'b', 'c'], 'b')).toEqual(['a', 'c']);
    // no muta lo que recibe
    const ids = ['a', 'b'];
    mover(ids, 'a', 1);
    quitar(ids, 'a');
    expect(ids).toEqual(['a', 'b']);
  });
});

describe('llevar a la caja', () => {
  it('Imagen va a ?prompt= y Video a ?brief=, con encodeURIComponent; lo demás, no', () => {
    expect(urlDeLlevar({ lleva_a: 'imagen', prompt: 'a b & c' })).toBe('/estudio/marketing/distrito/imagen/?prompt=a%20b%20%26%20c');
    expect(urlDeLlevar({ lleva_a: 'video', prompt: 'ñandú [X]' })).toBe('/estudio/marketing/distrito/video/?brief=%C3%B1and%C3%BA%20%5BX%5D');
    expect(urlDeLlevar({ lleva_a: null, prompt: 'solo se copia' })).toBeNull();
    expect(urlDeLlevar({ lleva_a: 'imagen', prompt: '   ' })).toBeNull();
  });

  it('la dirección de «Llevar a la caja» es la que marca/rutas.ts da a su pestaña: Imagen a la página de Imagen y Video a la de Video', () => {
    // la dirección escrita en logica.ts no se desfasa de la que marca/rutas.ts da a cada pestaña de la Caja
    expect(urlDeLlevar({ lleva_a: 'imagen', prompt: 'x' })).toBe(`${urlDeCaja('imagenes')}?prompt=x`);
    expect(urlDeLlevar({ lleva_a: 'video', prompt: 'x' })).toBe(`${urlDeCaja('videos')}?brief=x`);
  });

  it('el borde es 1800 caracteres; y una dirección que se hincharía de más (tildes) tampoco se lleva', () => {
    expect(MAX_LLEVAR).toBe(1800);
    expect(urlDeLlevar({ lleva_a: 'imagen', prompt: 'a'.repeat(1800) })).not.toBeNull();
    expect(urlDeLlevar({ lleva_a: 'imagen', prompt: 'a'.repeat(1801) })).toBeNull();
    // 1800 «ñ» son 1800 caracteres pero 10800 en la dirección: solo se copian
    expect(urlDeLlevar({ lleva_a: 'imagen', prompt: 'ñ'.repeat(1800) })).toBeNull();
  });

  it('los huecos [así] se separan del resto', () => {
    expect(partesDe('Hola [NOMBRE], bienvenido a [LUGAR].')).toEqual([
      { texto: 'Hola ', hueco: false },
      { texto: '[NOMBRE]', hueco: true },
      { texto: ', bienvenido a ', hueco: false },
      { texto: '[LUGAR]', hueco: true },
      { texto: '.', hueco: false },
    ]);
    expect(partesDe('sin huecos')).toEqual([{ texto: 'sin huecos', hueco: false }]);
    // unos corchetes vacíos o partidos en dos líneas no son un hueco
    expect(partesDe('a [] b [x\ny] c').every(x => !x.hueco)).toBe(true);
  });
});

describe('ambitoDeLaDireccion · con qué lista abre', () => {
  it('«?ver=mios» abre en «Míos» (así enlaza COI tras Guardar) y todo lo demás en «De la casa»', () => {
    expect(ambitoDeLaDireccion('?ver=mios')).toBe('mios');
    expect(ambitoDeLaDireccion('?otra=1&ver=mios')).toBe('mios');
    expect(ambitoDeLaDireccion('')).toBe('casa');
    expect(ambitoDeLaDireccion('?ver=casa')).toBe('casa');
    expect(ambitoDeLaDireccion('?ver=MIOS')).toBe('casa');
    expect(ambitoDeLaDireccion('?ver=')).toBe('casa');
  });
});

describe('vigentesDe · la lista que trae un 409 «cambiaron»', () => {
  const api = (estado: number, detalle: unknown) => new ErrorApi(estado, 'texto', detalle);

  it('devuelve la lista vigente del servidor, en su orden, y null si el error es de otra cosa o la lista no se puede leer', () => {
    expect(vigentesDe(api(409, { codigo: 'cambiaron', texto: 'x', fijados: ['casa-cafe', 'mio-0123456789ab'] }))).toEqual(['casa-cafe', 'mio-0123456789ab']);
    expect(vigentesDe(api(409, { codigo: 'cambiaron', texto: 'x', fijados: [] }))).toEqual([]);
    // sin lista, o con algo que no es una lista de textos: no se inventa una (se trata como cualquier otro fallo)
    expect(vigentesDe(api(409, { codigo: 'cambiaron', texto: 'x' }))).toBeNull();
    expect(vigentesDe(api(409, { codigo: 'cambiaron', texto: 'x', fijados: 'casa-cafe' }))).toBeNull();
    expect(vigentesDe(api(409, { codigo: 'cambiaron', texto: 'x', fijados: ['a', 3] }))).toBeNull();
    // otros errores del mismo PUT no traen nada que adoptar
    expect(vigentesDe(api(422, { codigo: 'demasiados', texto: 'x', fijados: ['a'] }))).toBeNull();
    expect(vigentesDe(new Error('boom'))).toBeNull();
    expect(vigentesDe(null)).toBeNull();
  });
});
