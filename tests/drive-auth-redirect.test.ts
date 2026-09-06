import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('Drive redirect authentication', () => {
  it('uses redirect code flow and exchanges the returned code', async () => {
    const values = new Map<string, string>();
    const requestCode = vi.fn();
    let codeConfig: Record<string, unknown> | undefined;
    const replaceState = vi.fn();
    const location = {
      origin: 'https://cutpeak.example',
      href: 'https://cutpeak.example/',
      search: '',
    };
    vi.stubGlobal('navigator', { onLine: true });
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
    vi.stubGlobal('document', {
      createElement: () => ({}),
      head: {
        appendChild: (tag: { onload: () => void }) =>
          queueMicrotask(() => tag.onload()),
      },
    });
    vi.stubGlobal('window', {
      location,
      history: { replaceState },
      google: {
        accounts: {
          oauth2: {
            initCodeClient: (config: Record<string, unknown>) => {
              codeConfig = config;
              return { requestCode };
            },
          },
        },
      },
    });
    const fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({ access_token: 'access-token', expires_in: 3600 }),
        { headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetch);

    const { completeDriveRedirect, connect, connected } = await import(
      '../src/storage/drive'
    );
    await connect({
      clientId: 'test-client',
      apiKey: 'test-key',
      appId: 'test-app',
    });

    expect(codeConfig).toMatchObject({
      client_id: 'test-client',
      ux_mode: 'redirect',
      redirect_uri: 'https://cutpeak.example',
    });
    expect(requestCode).toHaveBeenCalledOnce();
    const state = codeConfig?.state as string;
    expect(state).toHaveLength(64);

    location.search = `?code=test-code&state=${state}&scope=drive`;
    location.href = `https://cutpeak.example/${location.search}`;
    await expect(completeDriveRedirect()).resolves.toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      '/api/drive-auth/exchange',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(connected()).toBe(true);
    expect(replaceState).toHaveBeenCalledWith({}, '', '/');
  });
});
