import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

// findBy/waitFor esperan 1 s de fábrica: con la suite entera en paralelo, una
// cadena de respuestas simuladas y renders a veces tarda más. Sigue fallando
// igual si lo esperado nunca llega; solo espera un poco más
configure({ asyncUtilTimeout: 3000 });

afterEach(() => {
  cleanup();
  sessionStorage.clear();
});
