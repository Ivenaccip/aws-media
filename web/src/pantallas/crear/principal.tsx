import '../../estilos/tokens.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { Crear } from './Crear';

createRoot(document.getElementById('raiz')!).render(
  <StrictMode>
    <Crear />
  </StrictMode>,
);
