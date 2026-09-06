import { describe, expect, it } from 'vitest';
import { decryptRefreshToken, encryptRefreshToken } from '../worker/index';

function key() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

describe('Drive authentication token encryption', () => {
  it('encrypts refresh tokens with authenticated encryption', async () => {
    const secret = key();
    const encrypted = await encryptRefreshToken('refresh-token', secret);
    expect(encrypted).not.toContain('refresh-token');
    await expect(decryptRefreshToken(encrypted, secret)).resolves.toBe(
      'refresh-token',
    );
  });

  it('rejects a different encryption key', async () => {
    const encrypted = await encryptRefreshToken('refresh-token', key());
    await expect(decryptRefreshToken(encrypted, key())).rejects.toThrow();
  });
});
