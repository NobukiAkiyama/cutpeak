import { createRoot } from 'react-dom/client';
import App from './ui/App';
import { registerPwa } from './app/pwa';
import { notify } from './app/notifications';
import { useEditor } from './app/editor-state';
import '../app/globals.css';
import './ui/editor.css';
import './ui/occamus.css';
createRoot(document.getElementById('root')!).render(<App />);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  void registerPwa(() => {
    useEditor.setState({ updateAvailable: true });
    notify('新しいバージョンを利用できます。更新して再読み込みしてください。');
  });
}
