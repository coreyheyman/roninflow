import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { installDemoFetch } from './lib/demoMode';

installDemoFetch();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Installable app (Add to Home Screen / Install): only on HTTPS or localhost, and not in the Vite dev server.
if ('serviceWorker' in navigator && window.isSecureContext && !import.meta.env.DEV && import.meta.env.VITE_DEMO !== '1') {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
