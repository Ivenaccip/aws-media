import '../../estilos/tokens.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { Mix } from './Mix';

createRoot(document.getElementById('raiz')!).render(
  <StrictMode>
    <Mix />
  </StrictMode>,
);
