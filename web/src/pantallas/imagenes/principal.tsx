import '../../estilos/tokens.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { Imagenes } from './Imagenes';

createRoot(document.getElementById('raiz')!).render(
  <StrictMode>
    <Imagenes />
  </StrictMode>,
);
