import '../../estilos/tokens.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { Estilos } from './Estilos';

createRoot(document.getElementById('raiz')!).render(
  <StrictMode>
    <Estilos />
  </StrictMode>,
);
