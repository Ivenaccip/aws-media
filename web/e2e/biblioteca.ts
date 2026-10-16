// Lo que comparten las pruebas de navegador de la Biblioteca de prompts (Ajustes 3): el API de mentira (GET /api/biblioteca, PUT de los
// fijados, DELETE de un «mío») con los 14 prompts de muestra del contrato, y las maneras de señalar cada cosa por su rol y su nombre.
// Los textos están escritos a mano a propósito: si alguien cambia un rótulo, las pruebas lo notan en vez de seguirlo en silencio.
// No gasta nada: ninguna ruta sale de la máquina.
import { expect, type Locator, type Page, type Route } from '@playwright/test';

export interface PromptDePrueba {
  id: string;
  titulo: string;
  para_que: string;
  prompt: string;
  categoria: string;
  etiquetas: string[];
  lleva_a: 'imagen' | 'video' | null;
  origen?: string;
  creado?: string;
}

const casa = (
  n: string,
  categoria: string,
  lleva_a: PromptDePrueba['lleva_a'],
  titulo: string,
  para_que: string,
  etiquetas: string[],
  prompt: string,
): PromptDePrueba => ({ id: `casa-${n}`, titulo, para_que, prompt, categoria, etiquetas, lleva_a });

export const CATEGORIAS = [
  { clave: 'imagen', nombre: 'Imagen' },
  { clave: 'video', nombre: 'Video' },
  { clave: 'guion', nombre: 'Guion y texto' },
  { clave: 'investigacion', nombre: 'Investigación' },
];

export const CASA: PromptDePrueba[] = [
  casa('retrato', 'imagen', 'imagen', 'Retrato de estudio con luz suave', 'Fotos de perfil o de equipo con aspecto profesional', ['retrato', 'perfil', 'equipo'],
    'Retrato de estudio de una persona sonriendo con naturalidad y mirando a la cámara. Luz suave de ventana desde la izquierda, fondo gris cálido liso, lente de 85 mm, poca profundidad de campo, piel con textura natural, colores sobrios. Encuadre del pecho hacia arriba, formato vertical 4:5.'),
  casa('producto', 'imagen', 'imagen', 'Producto flotando sobre un color', 'Anuncios y portadas de tienda con espacio para texto', ['producto', 'anuncio', 'tienda'],
    'Fotografía de producto de [PRODUCTO] flotando sobre un fondo azul medianoche liso. Sombra suave debajo, reflejos limpios, iluminación de estudio con luz lateral, estilo minimalista y mucho espacio vacío arriba para poner texto. Formato cuadrado 1:1.'),
  casa('acuarela', 'imagen', 'imagen', 'Paisaje al amanecer en acuarela', 'Fondos y portadas con una sensación de calma', ['paisaje', 'acuarela', 'fondo'],
    'Paisaje de montañas con niebla al amanecer, en acuarela. Pinceladas visibles, paleta de azules fríos con un toque de naranja en el horizonte, papel con textura, sensación de calma. Formato horizontal 16:9.'),
  casa('plana', 'imagen', 'imagen', 'Ilustración plana para explicar una idea', 'Ilustrar un artículo o una presentación sin fotos', ['ilustración', 'educación', 'blog'],
    'Ilustración plana y colorida que explica la idea de [IDEA], con personas pequeñas frente a un objeto grande que la represente. Formas simples, sin texto, paleta de cuatro colores, fondo claro. Formato horizontal 16:9.'),
  casa('cafe', 'video', 'video', 'Café con vapor en cámara lenta', 'Tomas de ambiente para abrir un video de comida', ['comida', 'ambiente', 'cámara lenta'],
    'Plano cerrado de una taza de café sobre una mesa de madera, con vapor subiendo despacio. Luz cálida de mañana entrando por la derecha, la cámara avanza lento hacia la taza, estilo cine realista, sin personas. Duración: 5 segundos.'),
  casa('lluvia', 'video', 'video', 'Calle de noche bajo la lluvia', 'Un plano de ciudad con aire de cine para un video corto', ['ciudad', 'noche', 'ambiente'],
    'Una persona con paraguas camina por una calle de ciudad de noche, vista desde atrás a la altura del hombro. Lluvia fina, luces de neón reflejadas en el piso mojado, movimiento de cámara suave y estable, tono cinematográfico. Duración: 8 segundos.'),
  casa('giro', 'video', 'video', 'Giro lento alrededor de un producto', 'Mostrar un objeto desde todos los ángulos', ['producto', 'anuncio', 'giro'],
    'Giro lento de 360 grados alrededor de [PRODUCTO] sobre un pedestal negro. Luz de estudio con reflejos suaves, fondo oscuro desenfocado, movimiento continuo y estable. Duración: 6 segundos.'),
  casa('guion30', 'guion', null, 'Guion de 30 segundos para un producto', 'Videos cortos de venta: lo que se dice y lo que se ve', ['ventas', 'guion', 'redes'],
    'Escribe un guion de 30 segundos para presentar [PRODUCTO] a [PÚBLICO]. Estructura: un gancho de 3 segundos con un problema real, la solución en una frase, tres beneficios concretos y un cierre con una invitación clara. Frases cortas, tono cercano, sin tecnicismos. Entrégalo en dos columnas: «Lo que se dice» y «Lo que se ve».'),
  casa('ganchos', 'guion', null, 'Diez ganchos para los primeros 3 segundos', 'Abrir un video con algo que haga quedarse a mirar', ['redes', 'gancho', 'video'],
    'Dame 10 ganchos para abrir un video sobre [TEMA]. Cada uno debe despertar curiosidad o nombrar un problema concreto, en menos de 12 palabras y sin exagerar. Ordénalos del más directo al más creativo y explica en una línea por qué funciona cada uno.'),
  casa('correo', 'guion', null, 'Correo de seguimiento amable', 'Retomar una conversación sin sonar insistente', ['correo', 'trabajo', 'ventas'],
    'Redacta un correo breve para dar seguimiento a [PERSONA] después de [REUNIÓN]. Máximo 90 palabras, tono cordial y directo, un solo pedido claro y una última frase que facilite responder con un sí o un no.'),
  casa('resumen', 'guion', null, 'Resumen de un texto largo para tu equipo', 'Convertir un documento extenso en cinco puntos útiles', ['resumen', 'trabajo', 'equipo'],
    'Resume el siguiente texto en cinco puntos para un equipo que no tiene tiempo. Cada punto, en una frase y, si aplica, con una acción sugerida. Cierra con una línea que diga qué decisión hay que tomar. Texto: [PEGA AQUÍ EL TEXTO]'),
  casa('competencia', 'investigacion', null, 'Mapa rápido de la competencia', 'Comparar a cinco competidores sin inventar cifras', ['mercado', 'competencia', 'ventas'],
    'Actúa como analista de mercado. Haz un cuadro comparativo de cinco competidores de [RUBRO] en [PAÍS]: qué ofrecen, a quién le hablan, su rango de precios y qué los diferencia. Marca como «No verificado» cualquier dato del que no estés seguro y no inventes cifras.'),
  casa('entrevista', 'investigacion', null, 'Guía para entrevistar clientes', 'Descubrir qué necesitan tus clientes en 20 minutos', ['clientes', 'entrevistas', 'mercado'],
    'Diseña una guía de entrevista de 20 minutos para clientes de [PRODUCTO]. Incluye 8 preguntas abiertas que no sugieran la respuesta, de lo general a lo específico, y 2 preguntas de cierre. Explica en una línea qué aprenderás con cada una.'),
  casa('desde-cero', 'investigacion', null, 'Explícamelo desde cero', 'Entender un tema nuevo con analogías y una prueba', ['aprender', 'explicar', 'estudio'],
    'Explícame [TEMA] como si fuera la primera vez que lo escucho. Usa una analogía de la vida diaria, define cada término nuevo la primera vez que aparezca y cierra con tres preguntas para comprobar si entendí.'),
];

export const MIOS: PromptDePrueba[] = [
  {
    id: 'mio-0123456789ab',
    titulo: 'Guion para el reel de la semana',
    para_que: '',
    prompt: 'Escribe un guion de 20 segundos para [TEMA]. Frases cortas y un cierre con una pregunta.',
    categoria: 'guion',
    etiquetas: [],
    lleva_a: null,
    origen: 'coi',
    creado: '2026-10-16T18:20:00Z',
  },
  {
    id: 'mio-ba9876543210',
    titulo: 'Ideas de portada para el canal',
    para_que: '',
    prompt: 'Dame cinco ideas de portada para un video sobre [TEMA], cada una con una frase de máximo cuatro palabras.',
    categoria: 'guion',
    etiquetas: [],
    lleva_a: null,
    origen: 'coi',
    creado: '2026-10-16T19:05:00Z',
  },
];

export interface Simulacion {
  casa?: PromptDePrueba[];
  mios?: PromptDePrueba[];
  fijados?: string[];
  /** Qué contesta GET /api/biblioteca: una demora (ms), un fallo (503 con detalle objeto) o `sin-red`. */
  carga?: { demora?: number; falla?: 'servidor' | 'sin-red' | 'una-vez' };
  /** Qué contesta PUT /api/biblioteca/fijados: lo normal, un fallo o una demora (para ver lo optimista). */
  guardado?: { falla?: boolean; demora?: number };
}

export interface Llamadas {
  /** Cada PUT de los fijados, con la lista que mandó. */
  puts: string[][];
  /** Cada DELETE de un «mío», con su id. */
  borrados: string[];
  /** Cuántas veces se pidió la lista. */
  cargas: number;
}

const json = (route: Route, status: number, cuerpo: unknown) => route.fulfill({ status, json: cuerpo });

/** El estudio de mentira de la Biblioteca. Devuelve lo que se le pidió, en orden. Las rutas de /api/biblioteca ganan a las de abajo. */
export async function simular(page: Page, s: Simulacion = {}): Promise<Llamadas> {
  const llamadas: Llamadas = { puts: [], borrados: [], cargas: 0 };
  let mios = [...(s.mios ?? MIOS)];
  let fijados = [...(s.fijados ?? [])];
  const casa = s.casa ?? CASA;

  await page.route(/\/api\/biblioteca(\?.*)?$/, async route => {
    llamadas.cargas += 1;
    if (s.carga?.demora) await new Promise(r => setTimeout(r, s.carga!.demora));
    if (s.carga?.falla === 'sin-red') return route.abort('failed');
    if (s.carga?.falla === 'servidor' || (s.carga?.falla === 'una-vez' && llamadas.cargas === 1)) {
      return json(route, 503, { detail: { codigo: 'no_disponible', texto: 'No se pudo leer la Biblioteca.' } });
    }
    return json(route, 200, {
      categorias: CATEGORIAS,
      casa,
      mios,
      fijados: fijados.filter(id => [...casa, ...mios].some(p => p.id === id)),
      limites: { fijados: 3, mios: 100, titulo: 80, prompt: 12000 },
    });
  });

  await page.route('**/api/biblioteca/fijados', async route => {
    const { ids } = route.request().postDataJSON() as { ids: string[] };
    llamadas.puts.push(ids);
    if (s.guardado?.demora) await new Promise(r => setTimeout(r, s.guardado!.demora));
    if (s.guardado?.falla) return json(route, 503, { detail: { codigo: 'no_disponible', texto: 'No se pudo guardar tus fijados ahora.' } });
    if (ids.length > 3) return json(route, 422, { detail: { codigo: 'demasiados', texto: 'Ya tienes 3 fijados. Quita uno para fijar otro.' } });
    fijados = ids;
    return json(route, 200, { fijados });
  });

  await page.route('**/api/biblioteca/mios/*', async route => {
    const id = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop()!);
    llamadas.borrados.push(id);
    mios = mios.filter(p => p.id !== id);
    fijados = fijados.filter(i => i !== id);
    return json(route, 200, { ok: true });
  });

  return llamadas;
}

export async function abrir(page: Page, s: Simulacion = {}): Promise<Llamadas> {
  const llamadas = await simular(page, s);
  await page.goto('/estudio/biblioteca/');
  await page.getByRole('heading', { level: 2, name: 'Biblioteca de prompts' }).waitFor();
  return llamadas;
}

// ---- cómo se señala cada cosa

export const lista = (page: Page) => page.getByRole('list', { name: 'Prompts de la Biblioteca' });
export const filas = (page: Page) => lista(page).getByRole('button');
export const fila = (page: Page, titulo: string) => lista(page).getByRole('button', { name: new RegExp(`^${titulo}`) });
/** El panel de la derecha entero. */
export const panelDetalle = (page: Page) => page.locator('section[aria-labelledby="bib-detalle"]');
export const tituloDelDetalle = (page: Page) => page.locator('#bib-detalle');
export const franja = (page: Page) => page.getByRole('region', { name: /^Tus \d fijados$/ });
export const casillas = (page: Page) => franja(page).getByRole('listitem');
export const interruptor = (page: Page) => page.getByRole('button', { name: /^(Fijar|Quitar de fijados) «/ });
export const buscador = (page: Page) => page.getByRole('searchbox', { name: 'Buscar un prompt' });
export const categoria = (page: Page, nombre: string) => page.getByRole('group', { name: 'Categoría' }).getByRole('button', { name: new RegExp(`^${nombre}`) });
export const ambito = (page: Page, nombre: 'De la casa' | 'Míos') => page.getByRole('group', { name: 'De quién son los prompts' }).getByRole('button', { name: new RegExp(`^${nombre}`) });
/** La región viva donde se anuncia lo que pasa sin mover el foco (copiado, fijado, borrado…). */
export const anuncios = (page: Page) => page.locator('[role="status"][aria-live="polite"][aria-atomic="true"]');

/** Lo que de verdad se ve ámbar: botones o enlaces con el fondo del principal (el color es el del token --color-ambar). */
export async function principales(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const ambar = 'rgb(218, 140, 40)';
    return Array.from(document.querySelectorAll('button, a'))
      .filter(e => {
        const r = e.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && getComputedStyle(e).backgroundColor === ambar;
      })
      .map(e => (e.textContent ?? '').trim());
  });
}

/** Cuánto sobra la página a lo ancho (0 = nada): lo que se arrastra de lado en un celular. */
export const sobraAlLado = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** Lo que se pide a cualquier pantalla a cualquier ancho: nada se sale, todo lo tocable mide 44 px y la letra no baja de 13. */
export async function auditar(page: Page, donde: string, raiz?: Locator) {
  expect(await sobraAlLado(page), `${donde}: la página se arrastra de lado`).toBeLessThanOrEqual(0);
  const alcance = raiz ?? page.locator('#raiz');
  const problemas = await alcance.evaluate(r => {
    const hay: string[] = [];
    for (const e of Array.from(r.querySelectorAll('*'))) {
      const caja = e.getBoundingClientRect();
      if (caja.width === 0 || caja.height === 0) continue;
      const nombre = `${e.tagName.toLowerCase()} «${(e.textContent ?? '').trim().slice(0, 30)}»`;
      if (caja.right > innerWidth + 0.5 || caja.left < -0.5) hay.push(`${nombre} se sale de la pantalla`);
      const interactivo = e.matches('button, a[href], input, [role="button"]');
      if (interactivo && !e.closest('.sr-only') && (caja.height < 43.5 || caja.width < 43.5)) {
        // el enlace de una frase corrida no cuenta: este no tiene ninguno, así que cada uno mide
        hay.push(`${nombre} mide ${Math.round(caja.width)}×${Math.round(caja.height)}`);
      }
      const conTexto = Array.from(e.childNodes).some(n => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim());
      if (conTexto && !e.closest('.sr-only') && parseFloat(getComputedStyle(e).fontSize) < 13) hay.push(`${nombre} tiene letra de ${getComputedStyle(e).fontSize}`);
    }
    return hay;
  });
  expect(problemas, donde).toEqual([]);
}
