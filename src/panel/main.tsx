import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../shared/tokens.css';
import Panel from './Panel';

document.documentElement.style.height = '100%';
document.body.style.height = '100%';
const root = document.getElementById('root')!;
root.style.height = '100%';

createRoot(root).render(
  <StrictMode>
    <Panel />
  </StrictMode>,
);
