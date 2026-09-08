let waitingWorker: ServiceWorker | undefined;
let reloadOnControllerChange = false;

export function watchForUpdate(
  registration: ServiceWorkerRegistration,
  hasController: () => boolean,
  onUpdateAvailable: () => void,
) {
  const announce = (worker: ServiceWorker | null) => {
    if (!worker || !hasController()) return;
    waitingWorker = worker;
    onUpdateAvailable();
  };
  if (registration.waiting) announce(registration.waiting);
  registration.addEventListener('updatefound', () => {
    const worker = registration.installing;
    if (!worker) return;
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed')
        announce(registration.waiting || worker);
    });
  });
}

export function applyPwaUpdate() {
  if (!waitingWorker) return false;
  reloadOnControllerChange = true;
  waitingWorker.postMessage({ type: 'SKIP_WAITING' });
  return true;
}

export async function registerPwa(onUpdateAvailable: () => void) {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
  const register = async () => {
    try {
      const registration =
        await navigator.serviceWorker.register('/service-worker.js');
      watchForUpdate(
        registration,
        () => !!navigator.serviceWorker.controller,
        onUpdateAvailable,
      );
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloadOnControllerChange) window.location.reload();
      });
    } catch (error) {
      console.error(error);
    }
  };
  if (document.readyState === 'complete') await register();
  else window.addEventListener('load', () => void register(), { once: true });
}
