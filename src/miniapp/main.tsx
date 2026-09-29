import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../shared/tokens.css';
import MiniApp from './MiniApp';

// Полноэкранный Mini App (как он откроется внутри MAX)
document.documentElement.style.height = '100%';
document.body.style.height = '100%';
const root = document.getElementById('root')!;
root.style.height = '100%';

createRoot(root).render(
  <StrictMode>
    <MiniApp />
  </StrictMode>,
);
