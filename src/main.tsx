import { createRoot } from 'react-dom/client';
import App from './ui/App';
import '../app/globals.css';
import './ui/editor.css';
import './ui/occamus.css';
createRoot(document.getElementById('root')!).render(<App />);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker
      .register('/service-worker.js')
      .catch(console.error);
  });
}
