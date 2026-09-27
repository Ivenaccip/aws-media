import '../../estilos/tokens.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { Vitrina } from './Vitrina';

createRoot(document.getElementById('raiz')!).render(
  <StrictMode>
    <Vitrina />
  </StrictMode>,
);
