// La UI nueva (docs/PLAN-UI.md §3). Multipágina: cada carpeta con un
// index.html bajo estudio/ es una pantalla, sin router. dist/ repite las URLs
// tal cual (dist/estudio/_vitrina/index.html → /estudio/_vitrina/), así que
// server/web.py solo tiene que montar carpetas.
import { readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

const RAIZ = dirname(fileURLToPath(import.meta.url));

// estudio/_vitrina → «vitrina»: el nombre del chunk en /estudio/assets/.
const nombreDe = (dir: string) =>
  relative(resolve(RAIZ, 'estudio'), dir).split(sep).join('-').replace(/^_/, '') || 'estudio';

function paginas(dir: string, acc: Record<string, string> = {}): Record<string, string> {
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) paginas(ruta, acc);
    else if (nombre === 'index.html') acc[nombreDe(dirname(ruta))] = ruta;
  }
  return acc;
}

// tools/tarifas.json es la tarifa de NEGOCIO, pero sus notas explican el
// precio con los costos del proveedor («Apify ~$0.005 dólares…») y `economia`
// trae el costo interno y el piso de venta. Nada de eso es para el navegador:
// este plugin deja solo los números antes de que Vite convierta el JSON en
// módulo. tests/test_web_tuberia.py lo comprueba sobre dist/.
const TARIFAS = resolve(RAIZ, '..', 'tools', 'tarifas.json');
const FUERA_DEL_CLIENTE = new Set(['comment', 'verified_on', 'economia']);

function soloNumeros(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(soloNumeros);
  if (valor && typeof valor === 'object') {
    return Object.fromEntries(
      Object.entries(valor)
        .filter(([k]) => !FUERA_DEL_CLIENTE.has(k) && !k.startsWith('nota'))
        .map(([k, v]) => [k, soloNumeros(v)]),
    );
  }
  return valor;
}

const tarifasSinNotas: Plugin = {
  name: 'tarifas-sin-notas',
  enforce: 'pre',
  transform(codigo, id) {
    if (id.split('?')[0] !== TARIFAS) return null;
    return { code: JSON.stringify(soloNumeros(JSON.parse(codigo))), map: null };
  },
};

// Todo lo que no es de Vite va a uvicorn: la API, auth.js, monedero.js, las
// fuentes, /ui/clasica y las pantallas viejas. 8011 es el origen registrado
// en Cognito, por eso Vite se queda con él y el server baja a 8012.
// Las pantallas de Vite son las carpetas de estudio/ con index.html: una
// nueva entra sola (cambiarla pide reiniciar `npm run dev`).
// (una clave que empieza por ^ es una regex para Vite)
const PANTALLAS = paginas(resolve(RAIZ, 'estudio'));
const CARPETAS = Object.values(PANTALLAS)
  .map(html => relative(resolve(RAIZ, 'estudio'), dirname(html)).split(sep).join('/'))
  .concat('assets')
  .map(c => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
const TODO_MENOS_LO_DE_VITE =
  `^/(?!estudio/(?:${CARPETAS.join('|')})(?:/|$)|@|src/|node_modules/|__vite)`;

export default defineConfig({
  root: RAIZ,
  plugins: [tarifasSinNotas, react(), tailwindcss()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // los assets con hash viven junto a las pantallas: /estudio/assets/*
    assetsDir: 'estudio/assets',
    rollupOptions: { input: PANTALLAS },
  },
  server: {
    port: 8011,
    strictPort: true,
    // tools/tarifas.json vive fuera de web/
    fs: { allow: [resolve(RAIZ, '..', 'tools'), RAIZ] },
    proxy: { [TODO_MENOS_LO_DE_VITE]: { target: 'http://127.0.0.1:8012' } },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/prueba/preparar.ts'],
    restoreMocks: true,
  },
});
