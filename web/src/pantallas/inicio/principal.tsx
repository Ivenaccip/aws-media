import '../../estilos/tokens.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { Inicio } from './Inicio';

createRoot(document.getElementById('raiz')!).render(
  <StrictMode>
    <Inicio />
  </StrictMode>,
);
