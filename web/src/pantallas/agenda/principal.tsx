import '../../estilos/tokens.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { Agenda } from './Agenda';

createRoot(document.getElementById('raiz')!).render(
  <StrictMode>
    <Agenda />
  </StrictMode>,
);
