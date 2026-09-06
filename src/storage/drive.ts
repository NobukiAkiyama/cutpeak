import { serializePack, parsePack } from '../core/pack';
import type { CodeClient } from './google-types';
import { type Project, type Asset } from '../core/model';
import {
  type Repository,
  syncState,
  repositorySignature,
} from '../core/history';
import {
  readMeta,
  writeMeta,
  getAsset,
  putAsset,
  type SavedProject,
} from './local';
export interface DriveConfig {
  clientId: string;
  apiKey: string;
  appId: string;
}
export async function loadDriveConfig(): Promise<DriveConfig> {
  const fallback = {
    clientId: import.meta.env.VITE_GOOGLE_CLIENT_ID || '',
    apiKey: import.meta.env.VITE_GOOGLE_API_KEY || '',
    appId: import.meta.env.VITE_GOOGLE_APP_ID || '',
  };
  try {
    const response = await fetch('/api/drive-auth/config', {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return fallback;
    const value: unknown = await response.json();
    if (typeof value !== 'object' || value === null) return fallback;
    const config = value as Partial<DriveConfig>;
    return {
      clientId: typeof config.clientId === 'string' ? config.clientId : fallback.clientId,
      apiKey: typeof config.apiKey === 'string' ? config.apiKey : fallback.apiKey,
      appId: typeof config.appId === 'string' ? config.appId : fallback.appId,
    };
  } catch {
    return fallback;
  }
}
export interface SyncRecord {
  fileId?: string;
  folderId?: string;
  saveName?: string;
  lastSyncedHead: string | null;
  pending: boolean;
  mode: 'local' | 'portable' | 'cached';
  assetIds: Record<string, string>;
  conflictHead?: string;
  lastSyncedSignature?: string;
  canEdit?: boolean | null;
  remoteVersion?: string;
  origin?: DriveOrigin;
}
export interface DriveOrigin {
  fileId: string;
  folderId: string;
  head: string;
  saveName?: string;
}
interface DriveManifest {
  format: 'framecut-drive';
  version: 1;
  project: Project;
  head: string;
  repositoryFileId: string;
  assetIds: Record<string, string>;
  folderId: string;
  saveName?: string;
  origin?: DriveOrigin;
}
interface DriveRemoteInfo {
  manifest: DriveManifest;
  repository: Repository;
  etag: string | null;
  version: string | null;
  canEdit: boolean | null;
}
export class DrivePreconditionError extends Error {}
interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  parents?: string[];
  appProperties?: Record<string, string>;
}
let accessToken = '',
  expires = 0;
let client: CodeClient;
let scriptPromise: Promise<void> | undefined;
let redirectCompletion: Promise<boolean> | undefined;
const scope = 'https://www.googleapis.com/auth/drive.file';
const oauthStateKey = 'cutpeak:drive-oauth-state';
const pickerStateKey = 'cutpeak:drive-picker-state';
const pickerResultKey = 'cutpeak:drive-picker-result';
const oauthResponseKeys = [
  'authuser',
  'code',
  'error',
  'error_description',
  'error_uri',
  'hd',
  'prompt',
  'scope',
  'state',
];
const pickerResponseKeys = ['picked_file_ids', 'allow_folder_selection'];
export function connected() {
  return !!accessToken && Date.now() < expires;
}
function applyAccessToken(value: unknown) {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('access_token' in value) ||
    typeof value.access_token !== 'string' ||
    !('expires_in' in value) ||
    !['number', 'string'].includes(typeof value.expires_in)
  )
    throw Error('Google Drive の認証応答が正しくありません');
  accessToken = value.access_token;
  expires = Date.now() + (Number(value.expires_in) - 60) * 1000;
}
export async function restoreConnection() {
  if (connected()) return true;
  try {
    const response = await fetch('/api/drive-auth/token', {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return false;
    applyAccessToken(await response.json());
    return connected();
  } catch {
    return false;
  }
}
async function exchangeAuthorizationCode(code: string) {
  const response = await fetch('/api/drive-auth/exchange', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'XmlHttpRequest',
    },
    body: JSON.stringify({ code }),
  });
  const result: unknown = await response.json();
  if (!response.ok) {
    const detail =
      typeof result === 'object' &&
      result !== null &&
      'error' in result &&
      typeof result.error === 'string'
        ? result.error
        : 'Google Drive の認証に失敗しました';
    throw Error(detail);
  }
  applyAccessToken(result);
}
function clearOAuthResponse() {
  const url = new URL(window.location.href);
  for (const key of [...oauthResponseKeys, ...pickerResponseKeys])
    url.searchParams.delete(key);
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
}
export function consumePickerResult() {
  const value = sessionStorage.getItem(pickerResultKey);
  if (!value) return null;
  sessionStorage.removeItem(pickerResultKey);
  return value;
}
function isSafari() {
  return (
    /Safari\//.test(navigator.userAgent) &&
    !/Chrome\//.test(navigator.userAgent) &&
    !/Chromium\//.test(navigator.userAgent) &&
    !/CriOS\//.test(navigator.userAgent) &&
    !/FxiOS\//.test(navigator.userAgent)
  );
}
function pickerRedirect(config: DriveConfig) {
  const stateBytes = new Uint8Array(32);
  crypto.getRandomValues(stateBytes);
  const state = Array.from(stateBytes, (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  sessionStorage.setItem(pickerStateKey, state);
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', window.location.origin);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', scope);
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('trigger_onepick', 'true');
  url.searchParams.set('allow_folder_selection', 'true');
  url.searchParams.set('mimetypes', folderMime);
  url.searchParams.set('state', state);
  window.location.assign(url);
}
export function completeDriveRedirect() {
  redirectCompletion ??= (async () => {
    const parameters = new URLSearchParams(window.location.search);
    const code = parameters.get('code');
    const error = parameters.get('error');
    const pickedFileId = parameters.get('picked_file_ids')?.split(',')[0];
    if (!code && !error && !pickedFileId) return false;
    try {
      const pickerState = sessionStorage.getItem(pickerStateKey);
      const expectedState = pickerState || sessionStorage.getItem(oauthStateKey);
      sessionStorage.removeItem(pickerStateKey);
      sessionStorage.removeItem(oauthStateKey);
      if (!expectedState || parameters.get('state') !== expectedState)
        throw Error('Google Drive の認証状態を確認できませんでした');
      if (error)
        throw Error(
          parameters.get('error_description') ||
            'Google Drive の接続をキャンセルしました',
        );
      await exchangeAuthorizationCode(code!);
      if (pickedFileId)
        sessionStorage.setItem(
          pickerResultKey,
          await projectFileInFolder(pickedFileId),
        );
      return true;
    } finally {
      clearOAuthResponse();
    }
  })();
  return redirectCompletion;
}
export async function disconnect() {
  const response = await fetch('/api/drive-auth/logout', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'X-Requested-With': 'XmlHttpRequest' },
  });
  if (!response.ok) throw Error('Google Drive の接続を解除できませんでした');
  accessToken = '';
  expires = 0;
}
function script(src: string) {
  return new Promise<void>((resolve, reject) => {
    const tag = document.createElement('script');
    tag.src = src;
    tag.async = true;
    tag.onload = () => resolve();
    tag.onerror = () =>
      reject(
        Error('Google に接続できません。ネットワークを確認してください。'),
      );
    document.head.appendChild(tag);
  });
}
export async function prepareGoogle() {
  scriptPromise ??= Promise.all([
    script('https://accounts.google.com/gsi/client'),
    script('https://apis.google.com/js/api.js'),
  ])
    .then(() => {})
    .catch((e) => {
      scriptPromise = undefined;
      throw e;
    });
  await scriptPromise;
}
export async function connect(config: DriveConfig) {
  if (!config.clientId)
    throw Error('Google Cloud の Client ID を設定してください');
  await prepareGoogle();
  sessionStorage.removeItem(pickerStateKey);
  const stateBytes = new Uint8Array(32);
  crypto.getRandomValues(stateBytes);
  const state = Array.from(stateBytes, (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  sessionStorage.setItem(oauthStateKey, state);
  client = window.google!.accounts.oauth2.initCodeClient({
    client_id: config.clientId,
    scope,
    ux_mode: 'redirect',
    redirect_uri: window.location.origin,
    state,
    select_account: false,
  });
  client.requestCode();
}
async function request(url: string, init: RequestInit = {}, retried = false) {
  if (!connected() && !(await restoreConnection()))
    throw Error(
      'Google Drive との接続が切れました。再接続すると同期を再開できます。',
    );
  if (!navigator.onLine)
    throw Error('オフラインです。Drive 同期は接続後に再開します。');
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${accessToken}`);
  const response = await fetch(url, { ...init, headers });
  if (response.status === 401) {
    accessToken = '';
    expires = 0;
    if (!retried && (await restoreConnection()))
      return request(url, init, true);
    throw Error('Google Drive の再接続が必要です');
  }
  if (response.status === 412)
    throw new DrivePreconditionError('Drive の保存先が更新されました');
  if (!response.ok && response.status !== 308) {
    let detail = '';
    try {
      const body: unknown = await response.json();
      if (
        typeof body === 'object' &&
        body !== null &&
        'error' in body &&
        typeof body.error === 'object' &&
        body.error !== null &&
        'message' in body.error &&
        typeof body.error.message === 'string'
      )
        detail = body.error.message;
    } catch {}
    throw Error(`Drive ${response.status}: ${detail || response.statusText}`);
  }
  return response;
}
async function projectRequest(fileId: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('X-Requested-With', 'XmlHttpRequest');
  headers.set('Accept', 'application/json');
  const response = await fetch(
    `/api/drive-sync/projects/${encodeURIComponent(fileId)}`,
    { ...init, credentials: 'same-origin', headers },
  );
  if (!response.ok) {
    if (response.status === 412)
      throw new DrivePreconditionError('Drive の保存先が更新されました');
    let detail = '';
    try {
      const body = (await response.json()) as { error?: string };
      detail = body.error || '';
    } catch {}
    throw Error(`Drive ${response.status}: ${detail || response.statusText}`);
  }
  return response;
}
async function json<T>(path: string, init?: RequestInit) {
  return (
    await request(`https://www.googleapis.com/drive/v3/${path}`, init)
  ).json() as Promise<T>;
}
const googleDocumentMime = 'application/vnd.google-apps.document';

async function repositoryContent(fileId: string) {
  const mediaUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;
  try {
    return await request(mediaUrl);
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !error.message.includes('Only files with binary content')
    )
      throw error;
    const metadata = await json<DriveFile>(
      `files/${encodeURIComponent(fileId)}?fields=id,name,mimeType`,
    );
    if (metadata.mimeType !== googleDocumentMime) throw error;
    return request(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent('text/plain')}`,
    );
  }
}

async function projectFileInFolder(folderId: string) {
  const q = `'${escapeQuery(folderId)}' in parents and name = 'project.json' and trashed = false`;
  const files = await json<{ files: DriveFile[] }>(
    `files?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType)&pageSize=10`,
  );
  if (!files.files[0])
    throw Error('Cutpeak のプロジェクトフォルダを選択してください');
  return files.files[0].id;
}

async function folder(
  name: string,
  parent?: string,
  appProperties?: Record<string, string>,
) {
  return json<DriveFile>('files?fields=id,name', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      mimeType: 'application/vnd.google-apps.folder',
      ...(parent ? { parents: [parent] } : {}),
      ...(appProperties ? { appProperties } : {}),
    }),
  });
}
const folderMime = 'application/vnd.google-apps.folder';
const escapeQuery = (value: string) =>
  value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
export function normalizeDriveSaveName(value: string) {
  return Array.from(value)
    .map((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127 ? ' ' : character;
    })
    .join('')
    .trim()
    .replace(/[\\/]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\.cutpeak$/i, '')
    .trim()
    .slice(0, 100);
}
async function foldersNamed(name: string, parent: string) {
  const q = [
    `'${escapeQuery(parent)}' in parents`,
    `name = '${escapeQuery(name)}'`,
    `mimeType = '${folderMime}'`,
    'trashed = false',
  ].join(' and ');
  return (
    await json<{ files: DriveFile[] }>(
      `files?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType,appProperties)&pageSize=10`,
    )
  ).files;
}
async function createProjectFolder(saveName: string, projectId: string) {
  const normalized = normalizeDriveSaveName(saveName);
  if (!normalized || normalized === '無題のプロジェクト')
    throw Error('保存名を入力してから保存してください');
  let appRoot = (await foldersNamed('Cutpeak', 'root'))[0];
  appRoot ||= await folder('Cutpeak', 'root', { framecutType: 'root' });
  const directoryName = `${normalized}.cutpeak`;
  if ((await foldersNamed(directoryName, appRoot.id)).length)
    throw Error(
      `「${directoryName}」はすでにあります。別の保存名を入力してください。`,
    );
  const projectFolder = await folder(directoryName, appRoot.id, {
    framecutType: 'project',
    framecutProjectId: projectId,
    framecutFormat: '1',
  });
  return { folderId: projectFolder.id, saveName: normalized };
}
// Upload sessions are retained by file key. Tokens stay in memory; sessions may be resumed after reconnect.
export async function upload(
  blob: Blob,
  name: string,
  parent: string,
  existingId?: string,
  key?: string,
) {
  const sessionKey = `drive-upload:${key || parent + '/' + name}`;
  let session = await readMeta<{ url: string; size: number; offset: number }>(
    sessionKey,
  );
  if (session && session.size !== blob.size) {
    session = undefined;
    await writeMeta(sessionKey, null);
  }
  let offset = 0;
  if (session?.size === blob.size) {
    try {
      const probe = await request(session.url, {
        method: 'PUT',
        headers: { 'Content-Range': `bytes */${blob.size}` },
      });
      if (probe.status === 200 || probe.status === 201) {
        await writeMeta(sessionKey, null);
        return (await probe.json()) as DriveFile;
      }
      const range = probe.headers.get('Range');
      offset = range ? Number(range.split('-')[1]) + 1 : 0;
    } catch (e) {
      if (
        (e as Error).message.startsWith('Drive 404') ||
        (e as Error).message.startsWith('Drive 410')
      )
        session = undefined;
      else throw e;
    }
  }
  if (!session) {
    const url = `https://www.googleapis.com/upload/drive/v3/files${existingId ? '/' + encodeURIComponent(existingId) : ''}?uploadType=resumable&fields=id,name`;
    const response = await request(url, {
      method: existingId ? 'PATCH' : 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Upload-Content-Type': blob.type || 'application/octet-stream',
        'X-Upload-Content-Length': String(blob.size),
      },
      body: JSON.stringify({
        name,
        ...(!existingId ? { parents: [parent] } : {}),
      }),
    });
    const location = response.headers.get('Location');
    if (!location) throw Error('アップロードセッションを開始できません');
    session = { url: location, size: blob.size, offset: 0 };
    await writeMeta(sessionKey, session);
  }
  const chunkSize = 8 * 1024 * 1024;
  while (offset < blob.size) {
    const end = Math.min(blob.size, offset + chunkSize);
    let response: Response;
    try {
      response = await request(session.url, {
        method: 'PUT',
        headers: {
          'Content-Type': blob.type || 'application/octet-stream',
          'Content-Range': `bytes ${offset}-${end - 1}/${blob.size}`,
        },
        body: blob.slice(offset, end),
      });
    } catch (e) {
      await writeMeta(sessionKey, { ...session, offset });
      throw e;
    }
    if (response.status === 200 || response.status === 201) {
      await writeMeta(sessionKey, null);
      return (await response.json()) as DriveFile;
    }
    const range = response.headers.get('Range');
    const next = range ? Number(range.split('-')[1]) + 1 : 0;
    if (next <= offset)
      throw Error('アップロードが進みません。接続後に再試行してください。');
    offset = next;
    await writeMeta(sessionKey, { ...session, offset });
  }
  throw Error('アップロードを完了できませんでした');
}
const blobJson = (v: unknown) =>
  new Blob([JSON.stringify(v)], { type: 'application/json' });
export async function pickProject(config: DriveConfig): Promise<string | null> {
  if (!config.apiKey || !config.appId)
    throw Error(
      'Google Picker を使うには Google API Key とプロジェクト番号（App ID）が必要です',
    );
  if (isSafari()) {
    pickerRedirect(config);
    return new Promise(() => {});
  }
  if (!connected() && !(await restoreConnection()))
    throw Error('Google Drive の接続が切れました。再接続してください');
  await new Promise<void>((resolve) => window.gapi!.load('picker', resolve));
  const folderId = await new Promise<string | null>((resolve, reject) => {
    try {
      const g = window.google!.picker,
        view = new g.DocsView(g.ViewId.FOLDERS)
          .setMimeTypes(folderMime)
          .setIncludeFolders(true)
          .setSelectFolderEnabled(true);
      const picker = new g.PickerBuilder()
        .setDeveloperKey(config.apiKey)
        .setAppId(config.appId)
        .setOAuthToken(accessToken)
        .setOrigin(location.origin)
        .addView(view)
        .setTitle('Cutpeak のプロジェクトフォルダを選択')
        .setCallback((data) => {
          if (data.action === g.Action.PICKED) resolve(data.docs[0].id);
          else if (data.action === g.Action.CANCEL) resolve(null);
        })
        .build();
      picker.setVisible(true);
    } catch (e) {
      reject(e);
    }
  });
  if (!folderId) return null;
  return projectFileInFolder(folderId);
}
export async function fetchRemote(fileId: string): Promise<DriveRemoteInfo> {
  const response = await projectRequest(fileId);
  const remote = (await response.json()) as {
    manifest: DriveManifest;
    etag: string | null;
    version: string | null;
    canEdit: boolean | null;
  };
  const { manifest } = remote;
  if (
    manifest.format !== 'framecut-drive' ||
    manifest.version !== 1 ||
    !manifest.repositoryFileId
  )
    throw Error('Cutpeak の project.json を選択してください');
  const repository = parsePack(
    await (await repositoryContent(manifest.repositoryFileId)).text(),
  );
  if (repository.head !== manifest.head)
    throw Error('Drive のプロジェクトと履歴が一致しません');
  return {
    manifest,
    repository,
    etag: remote.etag,
    version: remote.version,
    canEdit: remote.canEdit,
  };
}
export async function cacheRemoteAsset(
  projectId: string,
  asset: Asset,
  remoteId: string,
) {
  const blob = await (
    await request(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(remoteId)}?alt=media`,
    )
  ).blob();
  await putAsset(
    projectId,
    asset.id,
    new File([blob], asset.name, { type: asset.mime }),
  );
}
export async function pullDrive(
  fileId: string,
  progress: (m: string) => void,
): Promise<SavedProject> {
  const { manifest, repository, canEdit, version } = await fetchRemote(fileId);
  const p = repository.commits[repository.head].project;
  for (const a of p.assets) {
    const remote = manifest.assetIds[a.id];
    if (!remote || (await getAsset(p.id, a.id))) continue;
    progress(`${a.name} をダウンロード中…`);
    const blob = await (
      await request(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(remote)}?alt=media`,
      )
    ).blob();
    await putAsset(p.id, a.id, new File([blob], a.name, { type: a.mime }));
  }
  await writeMeta(`drive-sync:${p.id}`, {
    fileId,
    folderId: manifest.folderId,
    saveName: manifest.saveName || normalizeDriveSaveName(p.name),
    lastSyncedHead: manifest.head,
    lastSyncedSignature: repositorySignature(repository),
    pending: false,
    mode: Object.keys(manifest.assetIds).length ? 'cached' : 'local',
    assetIds: manifest.assetIds,
    canEdit,
    remoteVersion: version || undefined,
    origin: manifest.origin,
  } satisfies SyncRecord);
  return { project: p, repository };
}
export async function pushDrive(
  state: SavedProject,
  mode: SyncRecord['mode'],
  progress: (m: string) => void,
  saveName?: string,
): Promise<{ conflict?: Repository; record: SyncRecord }> {
  const { project: p, repository: r } = state;
  let record = (await readMeta<SyncRecord>(`drive-sync:${p.id}`)) || {
    lastSyncedHead: null,
    pending: true,
    mode,
    assetIds: {},
  };
  let expectedHead: string | null = null;
  let remote: DriveRemoteInfo | undefined;
  const requestedSaveName = normalizeDriveSaveName(
    saveName ||
      (record.canEdit === false
        ? `${record.saveName || p.name} - 派生版`
        : record.saveName || ''),
  );
  if (!record.folderId || record.canEdit === false) {
    if (!requestedSaveName || requestedSaveName === '無題のプロジェクト')
      throw Error('保存名を入力してから保存してください');
  } else if (!record.saveName) {
    record.saveName = normalizeDriveSaveName(p.name) || '既存プロジェクト';
  }
  record = { ...record, pending: true, mode };
  await writeMeta(`drive-sync:${p.id}`, record);
  if (record.fileId) {
    remote = await fetchRemote(record.fileId);
    if (remote.canEdit === false) {
      const origin =
        record.origin || {
          fileId: record.fileId,
          folderId: remote.manifest.folderId,
          head: remote.manifest.head,
          saveName: remote.manifest.saveName,
        };
      record = {
        ...record,
        fileId: undefined,
        folderId: undefined,
        saveName:
          requestedSaveName ||
          `${remote.manifest.saveName || p.name} - 派生版`,
        lastSyncedHead: null,
        lastSyncedSignature: undefined,
        assetIds: {},
        canEdit: true,
        remoteVersion: undefined,
        origin,
        pending: true,
      };
      await writeMeta(`drive-sync:${p.id}`, record);
      remote = undefined;
    }
  }
  if (record.fileId && remote) {
    expectedHead = remote.manifest.head;
    const state = syncState(r.head, expectedHead, record.lastSyncedHead);
    const localSignature = repositorySignature(r),
      remoteSignature = repositorySignature(remote.repository);
    const branchConflict =
      !!record.lastSyncedSignature &&
      localSignature !== record.lastSyncedSignature &&
      remoteSignature !== record.lastSyncedSignature &&
      localSignature !== remoteSignature;
    if (state === 'conflict' || state === 'pull' || branchConflict)
      return { conflict: remote.repository, record };
    if (
      state === 'equal' &&
      record.lastSyncedSignature === repositorySignature(r) &&
      (mode === 'local' || p.assets.every((a) => record.assetIds[a.id]))
    ) {
      record.pending = false;
      delete record.conflictHead;
      await writeMeta(`drive-sync:${p.id}`, record);
      return { record };
    }
    record.canEdit = remote.canEdit;
    record.remoteVersion = remote.version || undefined;
  }
  progress('Drive の保存先を準備中…');
  if (!record.folderId) {
    const created = await createProjectFolder(requestedSaveName, p.id);
    record.folderId = created.folderId;
    record.saveName = created.saveName;
    await writeMeta(`drive-sync:${p.id}`, record);
  }
  const root = record.folderId;
  const children = await json<{ files: DriveFile[] }>(
    `files?q=${encodeURIComponent(`'${root}' in parents and trashed = false`)}&fields=files(id,name,mimeType)&pageSize=100`,
  );
  const getFolder = async (name: string) =>
    children.files.find(
      (f) =>
        f.name === name && f.mimeType === 'application/vnd.google-apps.folder',
    )?.id || (await folder(name, root)).id;
  if (mode !== 'local') {
    const allAssets = Array.from(
      new Map(
        Object.values(r.commits)
          .flatMap((c) => c.project.assets)
          .map((a) => [a.id, a]),
      ).values(),
    );
    const assetFolder = await getFolder('assets');
    for (const a of allAssets) {
      if (record.assetIds[a.id]) continue;
      const f = await getAsset(p.id, a.id);
      if (!f) throw Error(`${a.name} が未接続です。素材を再接続してください。`);
      progress(`${a.name} をアップロード中…`);
      record.assetIds[a.id] = (
        await upload(
          f,
          `${a.id}-${a.name}`,
          assetFolder,
          undefined,
          `${p.id}/${a.id}`,
        )
      ).id;
      await writeMeta(`drive-sync:${p.id}`, record);
    }
  }
  progress('プロジェクトと履歴を保存中…');
  const history = await getFolder('history');
  const pack = await upload(
    new Blob([serializePack(r)], { type: 'application/x-ndjson' }),
    `pack-${r.head}.ndjson`,
    history,
  );
  const manifest: DriveManifest = {
    format: 'framecut-drive',
    version: 1,
    project: p,
    head: r.head,
    repositoryFileId: pack.id,
    assetIds: record.assetIds,
    folderId: root,
    saveName: record.saveName,
    origin: record.origin,
  };
  let result: DriveFile;
  if (record.fileId) {
    const latest = await fetchRemote(record.fileId);
    if (latest.manifest.head !== expectedHead)
      return { conflict: latest.repository, record };
    if (!latest.etag)
      throw Error(
        'Driveの最新状態を安全に確認できませんでした。保存を保留しました。再読み込みしてから再試行してください。',
      );
    try {
      result = (await (
        await projectRequest(record.fileId, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'If-Match': latest.etag,
          },
          body: JSON.stringify(manifest),
        })
      ).json()) as DriveFile;
    } catch (e) {
      if (e instanceof DrivePreconditionError)
        return {
          conflict: (await fetchRemote(record.fileId)).repository,
          record,
        };
      throw e;
    }
  } else
    result = await upload(
      blobJson(manifest),
      'project.json',
      root,
      undefined,
      `${p.id}/manifest/${r.head}`,
    );
  const pointer = {
    head: r.head,
    branches: r.branches,
    repositoryFileId: pack.id,
  };
  await upload(
    blobJson(pointer),
    'repository.json',
    root,
    children.files.find((f) => f.name === 'repository.json')?.id,
  );
  record.fileId = result.id;
  record.folderId = root;
  record.lastSyncedHead = r.head;
  record.lastSyncedSignature = repositorySignature(r);
  record.pending = false;
  record.canEdit = true;
  delete record.conflictHead;
  await writeMeta(`drive-sync:${p.id}`, record);
  return { record };
}
