// Pruebas de navegador de web/ (UI·18). No van en `npm run verificar`: esa
// corre dentro de la etapa web del Dockerfile, que no trae navegador. Se
// corren con `npm run e2e`, que compila primero y sirve dist/ con
// e2e/servidor.mjs.
//
// El navegador: con PLAYWRIGHT_BROWSERS_PATH (o `npx playwright install
// chromium`) usa el Chromium de Playwright; con PW_CANAL=chrome usa el Chrome
// instalado en la máquina, sin descargar nada.
import { defineConfig, devices } from '@playwright/test';

// PW_PUERTO: para correr dos copias del repo a la vez sin que una use el
// servidor (y el dist) de la otra. No es el 4173 de `vite preview`: con uno
// abierto, Playwright lo reutilizaría (sin los /api simulados ni static/)
const PUERTO = Number(process.env.PW_PUERTO ?? 4317);
const canal = process.env.PW_CANAL;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    ...(canal ? { channel: canal } : {}),
    baseURL: `http://127.0.0.1:${PUERTO}`,
  },
  webServer: {
    command: `node e2e/servidor.mjs ${PUERTO}`,
    // solo e2e/servidor.mjs contesta aquí: otro servidor en el puerto no se reutiliza
    url: `http://127.0.0.1:${PUERTO}/__e2e`,
    reuseExistingServer: !process.env.CI,
  },
});
