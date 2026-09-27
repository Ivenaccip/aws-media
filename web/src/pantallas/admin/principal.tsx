import '../../estilos/tokens.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { Admin } from './Admin';

createRoot(document.getElementById('raiz')!).render(
  <StrictMode>
    <Admin />
  </StrictMode>,
);
