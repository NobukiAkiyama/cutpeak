const SESSION_COOKIE = '__Host-cutpeak_drive_session';
const SESSION_TTL_SECONDS = 90 * 24 * 60 * 60;
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GOOGLE_REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

type WorkerEnv = Env & {
  GOOGLE_CLIENT_ID: string;
  GOOGLE_API_KEY?: string;
  GOOGLE_APP_ID?: string;
  VITE_GOOGLE_CLIENT_ID?: string;
  VITE_GOOGLE_API_KEY?: string;
  VITE_GOOGLE_APP_ID?: string;
  GOOGLE_CLIENT_SECRET: string;
  SESSION_ENCRYPTION_KEY: string;
};

interface SessionRow {
  encrypted_refresh_token: string;
  expires_at: number;
}

interface GoogleTokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  headers.set('Content-Security-Policy', "default-src 'none'");
  return Response.json(data, { ...init, headers });
}

function base64Url(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function fromBase64Url(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(
    normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='),
  );
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

async function sessionHash(sessionId: string) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(sessionId),
  );
  return base64Url(new Uint8Array(digest));
}

async function encryptionKey(secret: string) {
  const bytes = fromBase64Url(secret);
  if (bytes.byteLength !== 32)
    throw new Error('SESSION_ENCRYPTION_KEY must contain 32 bytes');
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ]);
}

export async function encryptRefreshToken(value: string, secret: string) {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await encryptionKey(secret),
    new TextEncoder().encode(value),
  );
  return `${base64Url(iv)}.${base64Url(new Uint8Array(ciphertext))}`;
}

export async function decryptRefreshToken(value: string, secret: string) {
  const [encodedIv, encodedCiphertext] = value.split('.');
  if (!encodedIv || !encodedCiphertext) throw new Error('Invalid token data');
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64Url(encodedIv) },
    await encryptionKey(secret),
    fromBase64Url(encodedCiphertext),
  );
  return new TextDecoder().decode(plaintext);
}

function cookieValue(request: Request) {
  const cookie = request.headers.get('Cookie') || '';
  for (const entry of cookie.split(';')) {
    const [name, ...parts] = entry.trim().split('=');
    if (name === SESSION_COOKIE) return parts.join('=');
  }
  return '';
}

function sessionCookie(sessionId: string) {
  return `${SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}`;
}

function expiredCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

function assertSameOrigin(request: Request) {
  if (request.headers.get('Origin') !== new URL(request.url).origin)
    throw new HttpError(403, 'Invalid request origin');
}

async function tokenRequest(parameters: URLSearchParams) {
  const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: parameters,
  });
  const result = await response.json<GoogleTokenResponse>();
  if (!response.ok || result.error)
    throw new HttpError(
      401,
      result.error === 'invalid_grant'
        ? 'Google Drive の再接続が必要です'
        : 'Google Drive の認証に失敗しました',
    );
  if (!result.access_token || !result.expires_in)
    throw new Error('Google returned an incomplete token response');
  return result;
}

async function findSession(request: Request, env: WorkerEnv) {
  const sessionId = cookieValue(request);
  if (!sessionId) return undefined;
  const hash = await sessionHash(sessionId);
  const row = await env.AUTH_DB.prepare(
    'SELECT encrypted_refresh_token, expires_at FROM drive_sessions WHERE session_hash = ?',
  )
    .bind(hash)
    .first<SessionRow>();
  if (!row) return undefined;
  if (row.expires_at <= Date.now()) {
    await env.AUTH_DB.prepare(
      'DELETE FROM drive_sessions WHERE session_hash = ?',
    )
      .bind(hash)
      .run();
    return undefined;
  }
  return { hash, row };
}

async function exchangeCode(request: Request, env: WorkerEnv) {
  assertSameOrigin(request);
  if (request.headers.get('X-Requested-With') !== 'XmlHttpRequest')
    throw new HttpError(403, 'Missing request verification header');
  const length = Number(request.headers.get('Content-Length') || 0);
  if (length > 8192) throw new HttpError(413, 'Request is too large');
  const body: unknown = await request.json();
  const code =
    typeof body === 'object' && body !== null && 'code' in body
      ? (body as { code?: unknown }).code
      : undefined;
  if (typeof code !== 'string' || !code || code.length > 4096)
    throw new HttpError(400, 'Invalid authorization code');
  const result = await tokenRequest(
    new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: new URL(request.url).origin,
    }),
  );
  if (result.scope && !result.scope.split(' ').includes(DRIVE_SCOPE))
    throw new HttpError(403, 'Google Drive permission was not granted');
  if (!result.refresh_token)
    throw new HttpError(401, 'Google Drive の再接続が必要です');

  const previous = await findSession(request, env);
  const sessionId = randomToken();
  const hash = await sessionHash(sessionId);
  const now = Date.now();
  const encryptedRefreshToken = await encryptRefreshToken(
    result.refresh_token,
    env.SESSION_ENCRYPTION_KEY,
  );
  await env.AUTH_DB.prepare(
    `INSERT INTO drive_sessions
       (session_hash, encrypted_refresh_token, created_at, updated_at, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(
      hash,
      encryptedRefreshToken,
      now,
      now,
      now + SESSION_TTL_SECONDS * 1000,
    )
    .run();
  if (previous)
    await env.AUTH_DB.prepare(
      'DELETE FROM drive_sessions WHERE session_hash = ?',
    )
      .bind(previous.hash)
      .run();
  return json(
    { access_token: result.access_token, expires_in: result.expires_in },
    { headers: { 'Set-Cookie': sessionCookie(sessionId) } },
  );
}

async function refreshAccessToken(request: Request, env: WorkerEnv) {
  const session = await findSession(request, env);
  if (!session)
    return json(
      { connected: false },
      { status: 401, headers: { 'Set-Cookie': expiredCookie() } },
    );
  let refreshToken: string;
  try {
    refreshToken = await decryptRefreshToken(
      session.row.encrypted_refresh_token,
      env.SESSION_ENCRYPTION_KEY,
    );
  } catch {
    await env.AUTH_DB.prepare(
      'DELETE FROM drive_sessions WHERE session_hash = ?',
    )
      .bind(session.hash)
      .run();
    return json(
      { connected: false },
      { status: 401, headers: { 'Set-Cookie': expiredCookie() } },
    );
  }
  let result: GoogleTokenResponse;
  try {
    result = await tokenRequest(
      new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    );
  } catch (error) {
    if (error instanceof HttpError && error.status === 401) {
      await env.AUTH_DB.prepare(
        'DELETE FROM drive_sessions WHERE session_hash = ?',
      )
        .bind(session.hash)
        .run();
      return json(
        { connected: false },
        { status: 401, headers: { 'Set-Cookie': expiredCookie() } },
      );
    }
    throw error;
  }
  await env.AUTH_DB.prepare(
    'UPDATE drive_sessions SET updated_at = ?, expires_at = ? WHERE session_hash = ?',
  )
    .bind(Date.now(), Date.now() + SESSION_TTL_SECONDS * 1000, session.hash)
    .run();
  return json(
    { access_token: result.access_token, expires_in: result.expires_in },
    { headers: { 'Set-Cookie': sessionCookie(cookieValue(request)) } },
  );
}

async function logout(request: Request, env: WorkerEnv) {
  assertSameOrigin(request);
  const session = await findSession(request, env);
  if (session) {
    try {
      const refreshToken = await decryptRefreshToken(
        session.row.encrypted_refresh_token,
        env.SESSION_ENCRYPTION_KEY,
      );
      const response = await fetch(GOOGLE_REVOKE_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: refreshToken }),
      });
      if (!response.ok)
        console.error(
          JSON.stringify({
            message: 'Google token revocation failed',
            status: response.status,
          }),
        );
    } finally {
      await env.AUTH_DB.prepare(
        'DELETE FROM drive_sessions WHERE session_hash = ?',
      )
        .bind(session.hash)
        .run();
    }
  }
  return json(
    { connected: false },
    { headers: { 'Set-Cookie': expiredCookie() } },
  );
}

function driveConfig(env: WorkerEnv) {
  return json({
    clientId: env.GOOGLE_CLIENT_ID || env.VITE_GOOGLE_CLIENT_ID || '',
    apiKey: env.GOOGLE_API_KEY || env.VITE_GOOGLE_API_KEY || '',
    appId: env.GOOGLE_APP_ID || env.VITE_GOOGLE_APP_ID || '',
  });
}

async function handle(request: Request, env: WorkerEnv) {
  const url = new URL(request.url);
  if (url.pathname === '/api/drive-auth/config' && request.method === 'GET')
    return driveConfig(env);
  if (url.pathname === '/api/drive-auth/exchange' && request.method === 'POST')
    return exchangeCode(request, env);
  if (url.pathname === '/api/drive-auth/token' && request.method === 'GET')
    return refreshAccessToken(request, env);
  if (url.pathname === '/api/drive-auth/logout' && request.method === 'POST')
    return logout(request, env);
  return json({ error: 'Not found' }, { status: 404 });
}

export default {
  async fetch(request, env, ctx) {
    ctx.waitUntil(
      env.AUTH_DB.prepare('DELETE FROM drive_sessions WHERE expires_at <= ?')
        .bind(Date.now())
        .run()
        .then(() => {}),
    );
    try {
      return await handle(request, env as WorkerEnv);
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      console.error(
        JSON.stringify({
          message: 'Drive authentication request failed',
          path: new URL(request.url).pathname,
          error: error instanceof Error ? error.message : String(error),
          status,
        }),
      );
      return json(
        {
          error:
            status >= 500
              ? '認証サービスでエラーが発生しました'
              : (error as HttpError).message,
        },
        { status },
      );
    }
  },
} satisfies ExportedHandler<Env>;
