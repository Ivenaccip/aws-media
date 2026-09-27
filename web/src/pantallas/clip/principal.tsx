import '../../estilos/tokens.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { Clip } from './Clip';

createRoot(document.getElementById('raiz')!).render(
  <StrictMode>
    <Clip />
  </StrictMode>,
);
