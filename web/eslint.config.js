// Lint de web/. Además de lo recomendado, fija tres reglas del repo:
//   · pricing.json nunca entra al cliente (costos de proveedor y márgenes);
//   · nada de axios ni otro cliente HTTP: se saltaría el fetch de auth.js;
//   · nada de dangerouslySetInnerHTML: JSX escapa por defecto y así se queda
//     (los XSS de UI·2 venían de innerHTML).
import js from '@eslint/js';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', 'node_modules/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  jsxA11y.flatConfigs.strict,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['**/pricing.json'], message: 'pricing.json no viaja al navegador: usa nucleo/tarifas.ts.' },
          { group: ['axios', 'ky', 'got', 'superagent'], message: 'Usa nucleo/api.ts: va sobre el fetch de auth.js.' },
        ],
      }],
      'no-restricted-syntax': ['error', {
        selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
        message: 'Sin HTML crudo: JSX escapa por defecto (UI·2).',
      }],
    },
  },
  {
    files: ['vite.config.ts', 'eslint.config.js', 'playwright.config.ts', 'e2e/**'],
    languageOptions: { globals: { ...globals.node } },
  },
  // Las pruebas de navegador no son React: el `use` de los fixtures de
  // Playwright no es el hook de React, aunque se llame igual.
  {
    files: ['e2e/**'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: { 'react-hooks/rules-of-hooks': 'off' },
  },
);
