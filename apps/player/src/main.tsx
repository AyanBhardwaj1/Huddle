// Floodlight fonts + shared motion styles (the preset's font-display / font-sans now name these).
import '@huddle/ui/fonts';
import '@huddle/ui/styles.css';
import './index.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
