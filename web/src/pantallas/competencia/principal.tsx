import '../../estilos/tokens.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { Competencia } from './Competencia';

createRoot(document.getElementById('raiz')!).render(
  <StrictMode>
    <Competencia />
  </StrictMode>,
);
