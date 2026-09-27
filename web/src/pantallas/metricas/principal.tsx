import '../../estilos/tokens.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { Metricas } from './Metricas';

createRoot(document.getElementById('raiz')!).render(
  <StrictMode>
    <Metricas />
  </StrictMode>,
);
