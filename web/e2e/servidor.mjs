// Servidor de las pruebas de navegador (UI·18). Sirve lo mismo que producción
// sin levantar Python: web/dist en /estudio/* (como server/web.py) y static/
// en lo demás (auth.js, monedero.js, fuentes…), que es lo que las pantallas
// nuevas cargan del server de siempre.
//
// Reimplementa en Node lo que deciden server/web.py (las páginas por nivel, la raíz
// /estudio/, la barra, las mayúsculas, «//» y «%XX», las entradas de antes, el alias
// de lo que cambió de sitio y el 404 con página) y server/migracion.py (las URLs
// viejas, /index.html, la cookie de la clásica y /ui/clasica). Si aquel cambia, éste
// también: tests/test_web_rutas.py fija el comportamiento real y compara con este
// archivo la tabla de pantallas y el texto del 404.
//
// La API responde lo mínimo para que las 12 pantallas arranquen: sin login
// (auth.js no hace nada con activo=false), un saldo de 120 y 404 en lo demás.
// Cada prueba pisa lo que necesite con page.route(), que va antes que esto.
import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, posix, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// PW_DIST: otra carpeta compilada (`vite build --outDir <carpeta>`), para probar sin pisar web/dist (E2: tres implementadores sobre el mismo árbol)
const DIST = process.env.PW_DIST ? resolve(process.env.PW_DIST) : join(WEB, 'dist');
const ESTATICOS = resolve(WEB, '..', 'static');
const PUERTO = Number(process.argv[2] || 4317);

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.txt': 'text/plain; charset=utf-8',
  '.wgsl': 'text/plain; charset=utf-8',
};

// server/migracion.PANTALLAS, fila por fila: [nombre, URL vieja, URL nueva, ¿retirada?] (tests/test_web_rutas.py exige que sea la
// misma tabla). Las URLs viejas mandan a las nuevas, como en la etapa `todos` (con el query), también las que allá siguen en `nueva`:
// así se prueba la navegación que verán los estudiantes, no la del canario. Las `retirada` no tienen versión anterior a la que volver
// (/ui/clasica se queda en la nueva). /index.html, el inicio clásico, va aparte: con la cookie `ui=clasica` se sirve, como en
// migracion.decidir.
const PANTALLAS = [
  ['admin', '/admin.html', '/estudio/admin/', false],
  ['clip', '/clip.html', '/estudio/clip/', false],
  ['estilos', '/estilos.html', '/estudio/estilos/', false],
  ['competencia', '/competencia.html', '/estudio/competencia/', false],
  ['subir', '/e1.html', '/estudio/subir/', false],
  ['inicio', '/index.html', '/estudio/', false],
  ['shorts', '/shorts.html', '/estudio/shorts/', false],
  ['agenda', '/agenda.html', '/estudio/agenda/', false],
  ['metricas', '/metricas.html', '/estudio/metricas/', false],
  ['imagenes', '/imagenes.html', '/estudio/imagenes/', false],
  ['mix', '/mix.html', '/estudio/mix/', false],
  ['crear', '/crear.html', '/estudio/crear/', false],
  ['biblioteca', '/biblioteca.html', '/estudio/biblioteca/', true],
  ['coi', '/coi.html', '/estudio/coi/', true],
  ['constructor', '/constructor.html', '/estudio/constructor/', true],
  ['asistente', '/asistente.html', '/estudio/asistente/', true],
];
// Map y no un objeto: una de las pantallas se llama `constructor` (un objeto la confundiría con la de su prototipo)
const VIEJAS = new Map(PANTALLAS.filter(([nombre]) => nombre !== 'inicio').map(([, vieja, nueva]) => [vieja, nueva]));
const POR_NOMBRE = new Map(PANTALLAS.map(([nombre, vieja, nueva, retirada]) => [nombre, { vieja, nueva, retirada }]));
const INICIO_CLASICO = '/index.html';
const CLASICA = /(^|;\s*)ui=clasica(;|$)/;

// La página principal es /estudio/ (el mapa). Las entradas de antes (web.ENTRADAS_VIEJAS) la reenvían, con el query, a la herramienta que
// hoy hace eso; el destino sale de esta tabla y solo se usa si está compilado.
const RAIZ = '/estudio/';
const ENTRADAS_VIEJAS = [
  ['prompt', null, '/estudio/marketing/distrito/imagen/'],
  ['brief', null, '/estudio/marketing/distrito/video/'],
  ['blotato', 'conectar', '/estudio/marketing/blotato/'],
];
// migracion.alias_del_estudio(): lo que cambió de sitio. Inerte mientras la carpeta vieja siga en dist (una pantalla que existe manda).
const ALIAS = new Map([['/estudio/inicio/', '/estudio/']]);

// El 404 de un nivel que pide HTML (web._PAGINA_404, D14): el MISMO texto, trozo por trozo (tests/test_web_rutas.py junta los trozos de
// entre las dos marcas y exige que sean la cadena de web.py). El único hueco es {arriba}: el nivel de arriba que sí existe.
// <pagina-404>
const PAGINA_404 =
  '<!doctype html><html lang="es"><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width, initial-scale=1">' +
  '<meta name="robots" content="noindex, nofollow"><title>No encontramos esa página</title>' +
  '<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/carta.css">' +
  '<style>body{margin:0;padding:32px 16px;background:var(--c-fondo);color:var(--c-texto);' +
  'font:var(--t-sm)/1.55 var(--f-texto)}main{max-width:440px;margin:0 auto}' +
  'h1{margin:0 0 16px;font:800 var(--t-titulo-md)/1.15 var(--f-titulo)}p{margin:0 0 16px}' +
  'a{color:var(--c-enlace)}</style></head>' +
  '<body><main><h1>No encontramos esa página</h1>' +
  '<p>La dirección no existe o cambió de lugar.</p>' +
  '<p><a href="{arriba}">Subir un nivel</a> · <a href="/estudio/">Ir al inicio</a></p>' +
  '</main></body></html>';
// </pagina-404>

const API = {
  '/api/auth/config': { activo: false },
  '/api/creditos': { activo: true, saldo: 120, tarifas: {}, packs: [] },
};

function json(res, codigo, cuerpo) {
  res.writeHead(codigo, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(cuerpo));
}

// null si la ruta se sale de su raíz o no existe
function archivo(raiz, ruta) {
  const destino = normalize(join(raiz, ruta));
  if (destino !== raiz && !destino.startsWith(raiz + sep)) return null;
  try {
    const st = statSync(destino);
    if (st.isFile()) return destino;
    if (st.isDirectory()) return statSync(join(destino, 'index.html')).isFile() ? join(destino, 'index.html') : null;
  } catch {
    return null;
  }
  return null;
}

// ¿Hay una página compilada en esa dirección (con barra final y ya en su forma normal: «/estudio//» no lo es)? Una carpeta de dist/estudio
// con index.html, a cualquier profundidad; la raíz cuenta, `assets` no.
function esPagina(url) {
  if (!url.startsWith(RAIZ) || !url.endsWith('/') || url.startsWith(RAIZ + 'assets/') || limpia(url) !== url) return false;
  const html = join(DIST, 'estudio', url.slice(RAIZ.length), 'index.html');
  try {
    return statSync(html).isFile();
  } catch {
    return false;
  }
}

// «/estudio//a/../b» → «/estudio/b»; conserva la barra final (web._limpia)
function limpia(ruta) {
  const n = posix.normalize(ruta.replace(/\/{2,}/g, '/'));
  return ruta.endsWith('/') && !n.endsWith('/') ? n + '/' : n;
}

// A dónde llevar una dirección que no es una página tal cual (web.destino_de): le falta la barra, viene en mayúsculas o con «//», o es una dirección
// vieja con alias. null = no se sabe. Lo que devuelve sale SIEMPRE de dist o de ALIAS, nunca de la petición.
function destinoDe(ruta) {
  const r = limpia(ruta);
  const cand = r.endsWith('/') ? r : r + '/';
  for (const c of new Set([cand, cand.toLowerCase()])) {
    if (esPagina(c)) return c !== ruta ? c : null;
    const nuevo = ALIAS.get(c);
    if (nuevo !== undefined && esPagina(nuevo)) return nuevo;
  }
  return null;
}

// ?prompt=… → la Caja en Imagen; ?brief=… → en Video; ?blotato=conectar → el grupo Blotato (web.entrada_vieja). Con un parámetro repetido
// cuenta el primero (`get`), como en web.py y en la página
function entradaVieja(params) {
  for (const [param, valor, destino] of ENTRADAS_VIEJAS) {
    if (params.has(param) && (valor === null || params.get(param) === valor) && esPagina(destino)) return destino;
  }
  return null;
}

function redirigir(res, destino, search, cabeceras = {}) {
  res.writeHead(302, { Location: destino + search, 'Cache-Control': 'no-store', ...cabeceras });
  res.end();
}

// El nivel más cercano que sí existe, hacia arriba; «/estudio/» si no hay otro (web._arriba). Sale de dist, nunca de lo pedido
function arriba(ruta) {
  const partes = ruta.split('/').filter(Boolean);
  for (let n = Math.min(partes.length - 1, 8); n > 1; n--) {
    const c = '/' + partes.slice(0, n).join('/') + '/';
    for (const k of new Set([c, c.toLowerCase()])) if (esPagina(k)) return k;
  }
  return RAIZ;
}

// ¿El Accept pide `text/html` de verdad? El tipo entero y con q > 0; un q mal escrito no es un no (web._pide_html)
function pideHtml(accept) {
  for (const parte of accept.split(',')) {
    const [tipo, ...params] = parte.split(';').map(p => p.trim());
    if (tipo.toLowerCase() !== 'text/html') continue;
    const q = params.find(p => p.slice(0, 2).toLowerCase() === 'q=')?.slice(2).trim() ?? '1';
    const n = Number(q);
    if (q === '' || Number.isNaN(n) || n > 0) return true;
  }
  return false;
}

// Un nivel que no existe: la página «No encontramos esa página» a quien pide HTML (un navegador) y el 404 JSON a los demás; las dos caras
// llevan `Vary: Accept`
function noEncontrada(req, res, ruta) {
  if (!pideHtml(req.headers.accept ?? '')) {
    res.writeHead(404, { 'Content-Type': 'application/json', Vary: 'Accept' });
    return res.end(JSON.stringify({ detail: 'Not Found' }));
  }
  const destino = arriba(limpia(ruta)).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
  res.writeHead(404, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-cache',
    'X-Robots-Tag': 'noindex, nofollow',
    Vary: 'Accept',
  });
  res.end(PAGINA_404.replace('{arriba}', destino));
}

// Escrita con «%XX» (`/estudio/%6Darketing/`): se sirve, pero antes se manda a la forma normal para que la barra quede limpia. Solo si la
// forma normal es una ruta simple, sin nada que escapar (web._escrita_con_porcentajes)
const escritaConPorcentajes = (pathname, ruta) => pathname !== ruta && /^[A-Za-z0-9_.~/-]*$/.test(ruta);

function servir(res, encontrado) {
  res.writeHead(200, { 'Content-Type': TIPOS[extname(encontrado)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
  createReadStream(encontrado).pipe(res);
}

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  const ruta = decodeURIComponent(url.pathname);
  // la seña de este servidor: playwright.config.ts la pide antes de reutilizarlo
  if (ruta === '/__e2e') return json(res, 200, { e2e: true });
  if (ruta.startsWith('/api/')) {
    if (ruta in API) return json(res, 200, API[ruta]);
    return json(res, 404, { detail: 'Not Found' });
  }
  // fuera de la API solo se lee: lo demás es el 405 del montaje de static/ (y de las rutas GET/HEAD de la app)
  if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { detail: 'Method Not Allowed' });
  if (VIEJAS.has(ruta)) return redirigir(res, VIEJAS.get(ruta), url.search);
  // «Usar la versión anterior» (se abre a mano): deja la cookie y lleva a la URL vieja; «volver a la nueva» la borra (migracion.montar)
  if (ruta === '/ui/clasica' || ruta === '/ui/nueva') {
    const p = POR_NOMBRE.get(url.searchParams.get('pantalla') ?? '');
    if (ruta === '/ui/nueva') return redirigir(res, p?.nueva ?? RAIZ, '', { 'Set-Cookie': 'ui=""; Max-Age=0; Path=/' });
    if (!p) return redirigir(res, RAIZ, '');
    if (p.retirada) return redirigir(res, p.nueva, '');
    return redirigir(res, p.vieja, '', { 'Set-Cookie': `ui=clasica; Max-Age=${7 * 24 * 3600}; Path=/; HttpOnly; SameSite=Lax` });
  }
  // «/» es la portada y «/?algo» un enlace viejo al estudio (server/app.py); «/estudio» sin barra va a la principal
  if (ruta === '/') {
    if (url.search) return redirigir(res, RAIZ, url.search);
    return servir(res, join(ESTATICOS, 'portada.html'));
  }
  if (ruta === '/estudio') return redirigir(res, RAIZ, url.search);
  // el inicio clásico: con la cookie `ui=clasica` se sirve; sin ella migracion.decidir manda a la principal. Sin la principal compilada,
  // /index.html se sirve y /estudio/ lleva aquí (migracion.principal_a_la_clasica)
  const conClasica = CLASICA.test(req.headers.cookie ?? '');
  if (ruta === INICIO_CLASICO && esPagina(RAIZ) && !conClasica) return redirigir(res, RAIZ, url.search);
  if (ruta === RAIZ && (conClasica || !esPagina(RAIZ))) return redirigir(res, INICIO_CLASICO, url.search);
  if (ruta === RAIZ) {
    const antes = entradaVieja(url.searchParams);
    if (antes) return redirigir(res, antes, url.search);
    if (escritaConPorcentajes(url.pathname, ruta)) return redirigir(res, ruta, url.search);
    return servir(res, join(DIST, 'estudio', 'index.html'));
  }
  // el prefijo en mayúsculas («/Estudio/», «/ESTUDIO») también es «bajo /estudio/»; los assets que faltan son un 404 JSON, nunca HTML, aun
  // escritos «Assets» o con «//» (se mira la forma normal)
  const baja = ruta.toLowerCase();
  const normal = limpia(ruta).toLowerCase();
  if (normal === '/estudio' || (baja.startsWith(RAIZ) && normal !== RAIZ + 'assets' && !normal.startsWith(RAIZ + 'assets/'))) {
    if (esPagina(ruta)) {
      if (escritaConPorcentajes(url.pathname, ruta)) return redirigir(res, ruta, url.search);
      return servir(res, join(DIST, 'estudio', ruta.slice(RAIZ.length), 'index.html'));
    }
    // `…/marketing/index.html` es un archivo de la carpeta de la página y el montaje lo sirve; `/estudio/index.html` no (la raíz es una ruta)
    const carpeta = ruta.endsWith('/index.html') ? ruta.slice(0, -'index.html'.length) : null;
    if (carpeta && carpeta !== RAIZ && esPagina(carpeta)) return servir(res, join(DIST, 'estudio', carpeta.slice(RAIZ.length), 'index.html'));
    const destino = destinoDe(ruta);
    // 302 relativo (no el 307 con URL absoluta de StaticFiles)
    return destino ? redirigir(res, destino, url.search) : noEncontrada(req, res, ruta);
  }
  const encontrado = archivo(ruta.startsWith(RAIZ) ? DIST : ESTATICOS, ruta);
  if (!encontrado) return json(res, 404, { detail: 'Not Found' });
  servir(res, encontrado);
}).listen(PUERTO, '127.0.0.1', () => console.log(`e2e: http://127.0.0.1:${PUERTO}`));
