// Imágenes sin React: la API, las reglas de modo y la paleta de «/» que
// static/imagenes.html calculaba en línea.
//
// Una sola herramienta, y el estado manda:
//   sin imagen            → crear (el texto describe la imagen)
//   con imagen + pincel   → cambiar la zona pintada
//   con imagen + todo     → transformar la imagen entera
// Lo que NO se deduce solo es el modo: adivinarlo por si hay trazo o no
// cobraría una transformación que nadie pidió.
//
// Cobra una cosa por envío: `video.imagen` de tools/tarifas.json (la misma
// tarifa que el server lee en creditos.costo_imagen()).
import { ErrorApi, pedir } from '../../nucleo/api';

export type Modo = 'crear' | 'pincel' | 'todo';
export type Formato = 'horizontal' | 'vertical' | 'cuadrado';
export type Estado = 'vacio' | 'lienzo' | 'resultado';

export interface Estilo {
  id: string;
  nombre: string;
  descripcion?: string;
}

export interface Hecha {
  nombre: string;
  url: string;
}

/** Lo que devuelve el server se usa en un src, un href y un fetch: se revisa. */
export function hechaValida(d: unknown): Hecha {
  const h = d as Partial<Hecha> | null;
  const nombre = typeof h?.nombre === 'string' ? h.nombre : '';
  const url = typeof h?.url === 'string' ? h.url : '';
  if (!nombrePropio(nombre) || !(url.startsWith('/api/imagenes/') || /^https:\/\//.test(url)))
    throw new Error('La respuesta del servidor no trae una imagen válida. Si te descontaron créditos, escríbenos.');
  return { nombre, url };
}

export const cargarEstilos = () => pedir<Estilo[]>('/api/estilos');

export const crear = (cuerpo: { prompt: string; estilo: string; estilo_custom: string; formato: Formato }) =>
  pedir<unknown>('/api/imagenes', { cuerpo }).then(hechaValida);

/** El editor recibe multipart (la imagen y la zona marcada): pedir() solo habla JSON. */
export async function editar(fd: FormData): Promise<Hecha> {
  let r: Response;
  try {
    r = await fetch('/api/imagenes/editar', { method: 'POST', body: fd, headers: { Accept: 'application/json' } });
  } catch (e) {
    throw new ErrorApi(0, 'No hay conexión. Revisa tu internet y vuelve a intentar.', e);
  }
  const tipo = r.headers.get('Content-Type') ?? '';
  const datos: unknown = tipo.includes('application/json') ? await r.json() : await r.text();
  if (!r.ok) {
    const det = datos && typeof datos === 'object' && 'detail' in datos ? (datos as { detail: unknown }).detail : datos;
    const msg = typeof det === 'string' && det.trim() ? det : 'Algo salió mal (HTTP ' + r.status + ').';
    throw new ErrorApi(r.status, msg, det);
  }
  return hechaValida(datos);
}

// Los bytes se piden a NUESTRO endpoint: la URL del CDN no manda cabeceras
// CORS, y una imagen traída de ahí ensucia el canvas — `toBlob` reventaría
// justo al mandar la máscara.
export async function bajarPropia(nombre: string): Promise<File> {
  let r: Response;
  try {
    r = await fetch('/api/imagenes/' + encodeURIComponent(nombre) + '/archivo');
  } catch (e) {
    throw new ErrorApi(0, 'No hay conexión.', e);
  }
  if (!r.ok) throw new ErrorApi(r.status, r.status === 404 ? 'Imagen no encontrada' : 'HTTP ' + r.status, null);
  return new File([await r.blob()], 'imagen.jpg', { type: 'image/jpeg' });
}

export const urlArchivo = (nombre: string) => '/api/imagenes/' + encodeURIComponent(nombre) + '/archivo';

/** Solo las que crean crear y editar (12 hex + .jpg) se abren desde un enlace. */
export const nombrePropio = (n: string | null | undefined): n is string => !!n && /^[0-9a-f]{12}\.jpg$/.test(n);

export const MAX_MB = 15;
export const MAX_LADO = 1600; // se reduce en el navegador: sube rápido y al modelo le basta
export const MAX_TEXTO = 2000;

/** Lo que impide abrir el archivo, o null. */
export function problemaArchivo(f: File | null | undefined): string | null {
  if (!f || !/^image\/(png|jpeg|webp)$/.test(f.type)) return 'Elige una imagen JPG, PNG o WebP.';
  if (f.size > MAX_MB * 1024 * 1024) return `La imagen pasa de ${MAX_MB} MB.`;
  return null;
}

/** El formato de una imagen que ya existe no se elige: se lee. */
export function formatoDe(ancho: number, alto: number): Formato {
  if (ancho > alto * 1.15) return 'horizontal';
  if (alto > ancho * 1.15) return 'vertical';
  return 'cuadrado';
}

/** Cuánto se reduce para no pasar de MAX_LADO. */
export function escala(ancho: number, alto: number): { ancho: number; alto: number } {
  const k = Math.min(1, MAX_LADO / Math.max(ancho, alto));
  return { ancho: Math.round(ancho * k), alto: Math.round(alto * k) };
}

export const sinAcentos = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Si el texto pide editar, la pantalla pasa al editor.
const QUIERE_EDITAR = new RegExp(
  '\\b(edit(a|ar|e|es|en|emos|ando)(la|lo|las|los|me|nos)?' +
    '|retoc(a|ar|ame|ala|alo)|mis? (foto|fotos|imagen|imagenes|boceto|bocetos|dibujo|dibujos))\\b',
);
export const quiereEditar = (t: string) => QUIERE_EDITAR.test(sinAcentos(t));

export interface Intencion {
  hayImagen: boolean;
  hayResultado: boolean;
  cargando: boolean;
  intencion: boolean;
  pidioEditar: boolean;
  prefiereCrear: boolean;
}

export function vistaDe(i: Intencion): 'crear' | 'editar' {
  if (i.hayImagen || i.hayResultado || i.cargando) return 'editar';
  return (i.intencion || i.pidioEditar) && !i.prefiereCrear ? 'editar' : 'crear';
}

/** Qué hace «enviar»: con imagen o en el editor, el modo elegido; si no, crear. */
export const modoDe = (hayImagen: boolean, vista: 'crear' | 'editar', modo: 'pincel' | 'todo'): Modo =>
  hayImagen || vista === 'editar' ? modo : 'crear';

export const TEXTOS: Record<Modo, { hint: string; verbo: 'Generar' | 'Cambiar' | 'Transformar'; trabajando: string; vacio: string }> = {
  crear: {
    hint: 'Describe tu imagen… (escribe / para ver los atajos)',
    verbo: 'Generar',
    trabajando: 'Creando tu imagen · ~20 s',
    vacio: 'Escribe qué imagen quieres.',
  },
  pincel: {
    hint: '¿Qué ponemos en la zona pintada? — p. ej. «una ventana con plantas»',
    verbo: 'Cambiar',
    trabajando: 'Cambiando la zona que pintaste · ~20 s',
    vacio: 'Describe qué quieres en la zona pintada.',
  },
  todo: {
    hint: '¿En qué la convertimos? — p. ej. «acuarela sobre papel con grano»',
    verbo: 'Transformar',
    trabajando: 'Transformando tu imagen · ~20 s',
    vacio: 'Describe en qué quieres convertir la imagen.',
  },
};

/** Lo que impide enviar, o null. Todo esto se dice ANTES de cobrar. */
export function problemaEnvio(p: {
  modo: Modo;
  prompt: string;
  hayImagen: boolean;
  hayResultado: boolean;
  hayTrazo: boolean;
}): string | null {
  if (/^\/\S*$/.test(p.prompt)) return 'Eso es un atajo: elígelo en la lista con Enter, o escribe lo que quieres.';
  // pedir «edítala» sin imagen NO puede acabar creando una imagen nueva
  if (p.modo !== 'crear' && !p.hayImagen)
    return p.hayResultado
      ? 'Pulsa «Seguir editando» para cambiar esta imagen.'
      : 'Primero sube la imagen que quieres editar: arrástrala al recuadro o haz clic en él.';
  if (p.modo === 'pincel' && !p.hayTrazo)
    return 'Pinta sobre tu imagen la zona que quieres cambiar, o elige «Transformar toda la imagen».';
  if (!p.prompt) return TEXTOS[p.modo].vacio;
  return null;
}

// ── la paleta de «/»: atajos del navegador, sin LLM detrás
export type Accion =
  | { tipo: 'modo'; modo: 'pincel' | 'todo' }
  | { tipo: 'subir' }
  | { tipo: 'editar' }
  | { tipo: 'formato'; formato: Formato }
  | { tipo: 'estilo'; id: string }
  | { tipo: 'nuevo' };

export interface Atajo {
  cmd: string;
  que: string;
  conImagen?: boolean;
  sinImagen?: boolean;
  /** Borra algo: nunca sale preseleccionado. */
  borra?: boolean;
  accion: Accion;
}

export const ATAJOS: Atajo[] = [
  { cmd: '/zona', que: 'Cambiar solo la zona que pintes', conImagen: true, accion: { tipo: 'modo', modo: 'pincel' } },
  { cmd: '/transformar', que: 'Transformar la imagen entera', conImagen: true, accion: { tipo: 'modo', modo: 'todo' } },
  { cmd: '/subir', que: 'Subir una imagen tuya para editarla', sinImagen: true, accion: { tipo: 'subir' } },
  { cmd: '/editar', que: 'Editar una imagen que ya tienes', sinImagen: true, accion: { tipo: 'editar' } },
  { cmd: '/horizontal', que: 'Formato 16:9', sinImagen: true, accion: { tipo: 'formato', formato: 'horizontal' } },
  { cmd: '/vertical', que: 'Formato 9:16', sinImagen: true, accion: { tipo: 'formato', formato: 'vertical' } },
  { cmd: '/cuadrado', que: 'Formato 1:1', sinImagen: true, accion: { tipo: 'formato', formato: 'cuadrado' } },
];

// El único que borra algo va siempre al final: con solo «/» escrito, un Enter
// no puede tirar la imagen ni el resultado pagado.
export const NUEVO: Atajo = {
  cmd: '/nuevo',
  que: 'Crear una imagen nueva (quita tu imagen y el resultado)',
  borra: true,
  accion: { tipo: 'nuevo' },
};

export const atajoDeEstilo = (e: Estilo): Atajo => ({
  cmd: '/' + sinAcentos(e.nombre).replace(/\s+/g, ''),
  que: 'Estilo ' + e.nombre,
  accion: { tipo: 'estilo', id: e.id },
});

/** Los atajos que se ofrecen, y cuál sale marcado (-1 = ninguno). */
export function paleta(texto: string, estilos: Estilo[], hayImagen: boolean, hayAlgo: boolean): { lista: Atajo[]; sel: number } {
  // solo si «/» abre el texto: así no salta con «24/7» ni con una URL
  if (!texto.startsWith('/') || /\s/.test(texto)) return { lista: [], sel: -1 };
  const t = sinAcentos(texto);
  const lista = [...ATAJOS, ...estilos.map(atajoDeEstilo), ...(hayAlgo ? [NUEVO] : [])].filter(
    a => a.cmd.startsWith(t) && !(a.conImagen && !hayImagen) && !(a.sinImagen && hayImagen),
  );
  return { lista, sel: texto.length > 1 ? lista.findIndex(a => !a.borra) : -1 };
}

export const mensaje = (e: unknown) => (e instanceof Error ? e.message : String(e));

// UI·27 — la espera de una imagen, con sus pasos de verdad: primero se revisa
// el texto (el guardarraíl, M13) y luego la IA la hace. Se espera EN el
// navegador: aquí no hay «puedes cerrar esta pestaña».
export const REVISANDO = 'Revisando tu texto…';
const HACER: Record<Modo, { falta: string; activo: string; hecho: string }> = {
  crear: { falta: 'Crear la imagen', activo: 'Creando tu imagen', hecho: 'Imagen creada' },
  pincel: { falta: 'Cambiar la zona que pintaste', activo: 'Cambiando la zona que pintaste', hecho: 'Zona cambiada' },
  todo: { falta: 'Transformar tu imagen', activo: 'Transformando tu imagen', hecho: 'Imagen transformada' },
};
export const pasosImagen = (m: Modo) => [
  { falta: 'Revisar tu texto', activo: 'Revisando tu texto', hecho: 'Texto revisado' },
  HACER[m],
  { falta: 'Tu imagen, lista' },
];
/** Lo que suele tardar todo (revisar + hacer): «~20 s» más la revisión. */
export const ESTIMADO_IMAGEN_MS = 25_000;
