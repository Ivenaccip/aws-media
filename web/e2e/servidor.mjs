// Servidor de las pruebas de navegador (UI·18). Sirve lo mismo que producción
// sin levantar Python: web/dist en /estudio/* (como server/web.py) y static/
// en lo demás (auth.js, monedero.js, fuentes…), que es lo que las pantallas
// nuevas cargan del server de siempre.
//
// La API responde lo mínimo para que las 12 pantallas arranquen: sin login
// (auth.js no hace nada con activo=false), un saldo de 120 y 404 en lo demás.
// Cada prueba pisa lo que necesite con page.route(), que va antes que esto.
import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(WEB, 'dist');
const ESTATICOS = resolve(WEB, '..', 'static');
const PUERTO = Number(process.argv[2] || 4173);

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
// los estudiantes, no la del canario.
const VIEJAS = {
  '/estudio/': '/estudio/inicio/',
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

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  const ruta = decodeURIComponent(url.pathname);
  if (ruta in VIEJAS) {
    res.writeHead(302, { Location: VIEJAS[ruta] + url.search, 'Cache-Control': 'no-store' });
    return res.end();
  }
  if (ruta.startsWith('/api/')) {
    if (ruta in API) return json(res, 200, API[ruta]);
    return json(res, 404, { detail: 'Not Found' });
  }
  const enDist = ruta.startsWith('/estudio/');
  // /estudio/clip → /estudio/clip/, como hace StaticFiles con html=True
  if (enDist && !ruta.endsWith('/') && !extname(ruta)) {
    res.writeHead(307, { Location: ruta + '/' });
    return res.end();
  }
  const encontrado = archivo(enDist ? DIST : ESTATICOS, ruta);
  if (!encontrado) return json(res, 404, { detail: 'Not Found' });
  res.writeHead(200, { 'Content-Type': TIPOS[extname(encontrado)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
  createReadStream(encontrado).pipe(res);
}).listen(PUERTO, '127.0.0.1', () => console.log(`e2e: http://127.0.0.1:${PUERTO}`));
