import '../../estilos/tokens.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { Subir } from './Subir';

createRoot(document.getElementById('raiz')!).render(
  <StrictMode>
    <Subir />
  </StrictMode>,
);
