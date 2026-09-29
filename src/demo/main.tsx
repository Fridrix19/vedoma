import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../shared/tokens.css';
import Demo from './Demo';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Demo />
  </StrictMode>,
);
