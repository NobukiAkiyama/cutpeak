import { describe, expect, it, vi } from 'vitest';
import { applyPwaUpdate, watchForUpdate } from '../src/app/pwa';

describe('PWA updates', () => {
  it('announces an installed update and activates it on request', () => {
    const postMessage = vi.fn();
    const worker = Object.assign(new EventTarget(), {
      state: 'installed',
      postMessage,
    }) as unknown as ServiceWorker;
    const registration = Object.assign(new EventTarget(), {
      installing: worker,
      waiting: worker,
    }) as unknown as ServiceWorkerRegistration;
    const announce = vi.fn();

    watchForUpdate(registration, () => true, announce);

    expect(announce).toHaveBeenCalledOnce();
    expect(applyPwaUpdate()).toBe(true);
    expect(postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
  });
});
