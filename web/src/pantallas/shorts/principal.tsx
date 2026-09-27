import '../../estilos/tokens.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { Shorts } from './Shorts';

createRoot(document.getElementById('raiz')!).render(
  <StrictMode>
    <Shorts />
  </StrictMode>,
);
