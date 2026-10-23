// Servidor de las pruebas de navegador (UI·18). Sirve lo mismo que producción
// sin levantar Python: web/dist en /estudio/* (como server/web.py) y static/
// en lo demás (auth.js, monedero.js, fuentes…), que es lo que las pantallas
// nuevas cargan del server de siempre.
//
// Reimplementa en Node lo que deciden server/web.py (las páginas por nivel, la raíz
// /estudio/, la barra, las mayúsculas, el «//» y el «%XX», las entradas de antes y el
// alias de lo que cambió de sitio) y server/migracion.py (las URLs viejas, /index.html).
// Si aquel cambia, éste también: tests/test_web_rutas.py fija el comportamiento real.
//
// Una página se sirve SOLO si su dirección, tal cual llegó, es una del registro de
// dist (`paginas()`, como web.rutas()); lo demás se corrige con un 302 relativo a una
// dirección del registro o es un 404. Nunca se arma una ruta de disco con lo que pide
// el cliente: por eso un «..%2f» no se sale de dist, como en la app real.
//
// Lo que NO repite (diferencias a propósito; las pruebas de pytest sí las cubren):
//  · /ui/clasica y /ui/nueva (el interruptor de migracion.py) ni las hojas planas
//    de antes (/coi.html…): dan 404;
//  · el 404 con página para quien pide HTML (aquí siempre es el JSON);
//  · Cache-Control: todo sale `no-store` (la app real: `no-cache` + ETag en las
//    páginas) para que ninguna prueba vea una copia vieja de dist.
//
// La API responde lo mínimo para que las 12 pantallas arranquen: sin login
// (auth.js no hace nada con activo=false), un saldo de 120 y 404 en lo demás.
// Cada prueba pisa lo que necesite con page.route(), que va antes que esto.
import { createReadStream, readdirSync, statSync } from 'node:fs';
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

// Las URLs viejas mandan a las nuevas, como en la etapa `todos` de
// server/migracion.py (con el query). Así se prueba la navegación que verán
// los estudiantes, no la del canario. (/index.html, el inicio clásico, va aparte:
// con la cookie `ui=clasica` se sirve, como en migracion.decidir.)
const VIEJAS = {
  '/admin.html': '/estudio/admin/',
  '/clip.html': '/estudio/clip/',
  '/estilos.html': '/estudio/estilos/',
  '/competencia.html': '/estudio/competencia/',
  '/e1.html': '/estudio/subir/',
  '/shorts.html': '/estudio/shorts/',
  '/agenda.html': '/estudio/agenda/',
  '/metricas.html': '/estudio/metricas/',
  '/imagenes.html': '/estudio/imagenes/',
  '/mix.html': '/estudio/mix/',
  '/crear.html': '/estudio/crear/',
};

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

// El registro de páginas, como web.rutas(): cada carpeta de dist/estudio con index.html, a cualquier profundidad, con su barra final
// («/estudio/», «/estudio/marketing/»…); `assets` no cuenta. Se lee en cada petición bajo /estudio/ (son ~30 carpetas) y no al arrancar:
// así un `vite build` hecho con el servidor ya puesto se ve.
function paginas() {
  const out = new Set();
  const recorre = (dir, partes) => {
    let entradas;
    try {
      entradas = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entradas) {
      if (e.isDirectory()) {
        if (partes.length > 0 || e.name !== 'assets') recorre(join(dir, e.name), [...partes, e.name]);
      } else if (e.isFile() && e.name === 'index.html') {
        out.add(RAIZ + partes.map(p => `${p}/`).join(''));
      }
    }
  };
  recorre(join(DIST, 'estudio'), []);
  return out;
}

// «/estudio//a/../b» → «/estudio/b»; conserva la barra final (web._limpia)
function limpia(ruta) {
  const n = posix.normalize(ruta.replace(/\/{2,}/g, '/'));
  return ruta.endsWith('/') && !n.endsWith('/') ? n + '/' : n;
}

// A dónde llevar una dirección que no es una página tal cual (web.destino_de): le falta la barra, viene en mayúsculas o con «//», o es una dirección
// vieja con alias. null = no se sabe. Lo que devuelve sale SIEMPRE de dist o de ALIAS, nunca de la petición.
function destinoDe(ruta, registro) {
  const r = limpia(ruta);
  const cand = r.endsWith('/') ? r : r + '/';
  for (const c of new Set([cand, cand.toLowerCase()])) {
    if (registro.has(c)) return c !== ruta ? c : null;
    const nuevo = ALIAS.get(c);
    if (nuevo !== undefined && registro.has(nuevo)) return nuevo;
  }
  return null;
}

// ¿La página llegó escrita con «%XX» (`/estudio/%6Darketing/`, `/estudio/marketing%2Fdistrito/`)? La página lee location.pathname tal cual
// y no reconocería su nivel: se manda a la forma normal. Solo cuando la normal es una ruta simple, sin nada que escapar (web._escrita_con_porcentajes).
function escritaConPorcentajes(crudo, ruta) {
  return crudo !== ruta && /^[A-Za-z0-9_.~/-]*$/.test(ruta);
}

// ?prompt=… → la Caja en Imagen; ?brief=… → en Video; ?blotato=conectar → el grupo Blotato (web.entrada_vieja). Con un parámetro repetido manda
// el primer valor (`params.get`), como la página y como el servidor.
function entradaVieja(params, registro) {
  for (const [param, valor, destino] of ENTRADAS_VIEJAS) {
    if (params.has(param) && (valor === null || params.get(param) === valor) && registro.has(destino)) return destino;
  }
  return null;
}

function redirigir(res, destino, search) {
  res.writeHead(302, { Location: destino + search, 'Cache-Control': 'no-store' });
  res.end();
}

function servir(res, encontrado) {
  res.writeHead(200, { 'Content-Type': TIPOS[extname(encontrado)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
  // un archivo que desaparece a media lectura corta esa respuesta; no tumba el proceso
  createReadStream(encontrado).on('error', () => res.destroy()).pipe(res);
}

createServer((req, res) => {
  const objetivo = req.url ?? '/';
  // la dirección tal como llegó (sin tocar «.», «..», «//» ni «%XX»: uvicorn tampoco los resuelve) y su query
  const crudo = objetivo.split('?', 1)[0] ?? '';
  let url;
  try {
    url = new URL(objetivo, 'http://x');
  } catch {
    return json(res, 400, { detail: 'Bad Request' });
  }
  let ruta;
  try {
    ruta = decodeURIComponent(crudo);
  } catch {
    return json(res, 404, { detail: 'Not Found' }); // un «%» mal formado es un 404, no un proceso caído
  }
  // la seña de este servidor: playwright.config.ts la pide antes de reutilizarlo
  if (ruta === '/__e2e') return json(res, 200, { e2e: true });
  if (Object.hasOwn(VIEJAS, ruta)) return redirigir(res, VIEJAS[ruta], url.search);
  if (ruta.startsWith('/api/')) {
    if (ruta in API) return json(res, 200, API[ruta]);
    return json(res, 404, { detail: 'Not Found' });
  }
  // «/» es la portada y «/?algo» un enlace viejo al estudio (server/app.py); «/estudio» sin barra va a la principal
  if (ruta === '/') {
    if (url.search) return redirigir(res, RAIZ, url.search);
    return servir(res, join(ESTATICOS, 'portada.html'));
  }
  if (ruta === '/estudio') return redirigir(res, RAIZ, url.search);
  // el inicio clásico: con la cookie `ui=clasica` se sirve; sin ella (o sin la principal compilada) migracion.decidir manda a la principal
  if (ruta === '/index.html' && paginas().has(RAIZ) && !/(^|;\s*)ui=clasica(;|$)/.test(req.headers.cookie ?? '')) {
    return redirigir(res, RAIZ, url.search);
  }
  // los assets con hash: del montaje /estudio/assets (distingue mayúsculas y no sale de su carpeta, como StaticFiles)
  if (ruta.startsWith(`${RAIZ}assets/`)) {
    const asset = archivo(join(DIST, 'estudio', 'assets'), ruta.slice(`${RAIZ}assets/`.length));
    return asset ? servir(res, asset) : json(res, 404, { detail: 'Not Found' });
  }
  // Bajo /estudio/ (el prefijo en mayúsculas también) todo es una página, un 302 a una página o un 404. Un asset que falta es un 404 JSON y nunca
  // HTML, también escrito «//assets/» o «x/../assets/» (web._bajo_estudio, sobre la dirección normalizada).
  if (ruta.toLowerCase().startsWith(RAIZ)) {
    const normal = limpia(ruta).toLowerCase();
    if (normal === '/estudio/assets' || normal.startsWith('/estudio/assets/')) return json(res, 404, { detail: 'Not Found' });
    const registro = paginas();
    if (registro.has(ruta)) {
      if (ruta === RAIZ) {
        const antes = entradaVieja(url.searchParams, registro);
        if (antes) return redirigir(res, antes, url.search);
      }
      // la ruta de disco sale del registro (una carpeta que existe), nunca de la petición
      if (escritaConPorcentajes(crudo, ruta)) return redirigir(res, ruta, url.search);
      return servir(res, join(DIST, 'estudio', ruta.slice(RAIZ.length), 'index.html'));
    }
    const destino = destinoDe(ruta, registro);
    // 302 relativo (no el 307 con URL absoluta de StaticFiles) y sin que `index.html` sea una dirección
    return destino ? redirigir(res, destino, url.search) : json(res, 404, { detail: 'Not Found' });
  }
  const encontrado = archivo(ESTATICOS, ruta);
  if (!encontrado) return json(res, 404, { detail: 'Not Found' });
  servir(res, encontrado);
}).listen(PUERTO, '127.0.0.1', () => console.log(`e2e: http://127.0.0.1:${PUERTO}`));
