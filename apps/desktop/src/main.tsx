import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { HeraldProvider } from './state';
import './app.css';

const container = document.getElementById('root');
if (!container) throw new Error('No #root element to mount into.');

createRoot(container).render(
  <StrictMode>
    <HeraldProvider>
      <App />
    </HeraldProvider>
  </StrictMode>,
);
