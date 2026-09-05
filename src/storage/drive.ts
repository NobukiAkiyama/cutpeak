import { serializePack, parsePack } from '../core/pack';
import type { TokenClient } from './google-types';
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
export interface SyncRecord {
  fileId?: string;
  folderId?: string;
  lastSyncedHead: string | null;
  pending: boolean;
  mode: 'local' | 'portable' | 'cached';
  assetIds: Record<string, string>;
  conflictHead?: string;
  lastSyncedSignature?: string;
}
interface DriveManifest {
  format: 'framecut-drive';
  version: 1;
  project: Project;
  head: string;
  repositoryFileId: string;
  assetIds: Record<string, string>;
  folderId: string;
}
export class DrivePreconditionError extends Error {}
interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  parents?: string[];
}
let accessToken = '',
  expires = 0;
let client: TokenClient;
let scriptPromise: Promise<void> | undefined;
const scope = 'https://www.googleapis.com/auth/drive.file';
export function connected() {
  return !!accessToken && Date.now() < expires;
}
export function disconnect() {
  if (accessToken) window.google?.accounts.oauth2.revoke(accessToken, () => {});
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
  if (!config.clientId || !config.apiKey || !config.appId)
    throw Error(
      'Google Cloud の Client ID、API Key、App ID を設定してください',
    );
  await prepareGoogle();
  await new Promise<void>((resolve, reject) => {
    client = window.google!.accounts.oauth2.initTokenClient({
      client_id: config.clientId,
      scope,
      callback: (r) => {
        if (r.error) {
          reject(Error(r.error_description || r.error));
          return;
        }
        accessToken = r.access_token;
        expires = Date.now() + (Number(r.expires_in) - 60) * 1000;
        resolve();
      },
      error_callback: (e) =>
        reject(
          Error(
            e.type === 'popup_closed'
              ? '接続をキャンセルしました'
              : e.message || '認証画面を開けませんでした',
          ),
        ),
    });
    client.requestAccessToken({ prompt: '' });
  });
}
async function request(url: string, init: RequestInit = {}) {
  if (!connected())
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
    throw Error('Google Drive の再接続が必要です');
  }
  if (response.status === 412)
    throw new DrivePreconditionError('Drive の保存先が更新されました');
  if (!response.ok && response.status !== 308) {
    let detail = '';
    try {
      detail = (await response.json()).error?.message || '';
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
async function folder(name: string, parent?: string) {
  return json<DriveFile>('files?fields=id,name', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      mimeType: 'application/vnd.google-apps.folder',
      ...(parent ? { parents: [parent] } : {}),
    }),
  });
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
  if (!connected()) await connect(config);
  await new Promise<void>((resolve) => window.gapi!.load('picker', resolve));
  return new Promise((resolve, reject) => {
    try {
      const g = window.google!.picker;
      const view = new g.DocsView(g.ViewId.DOCS)
        .setMimeTypes('application/json')
        .setIncludeFolders(true);
      const picker = new g.PickerBuilder()
        .setDeveloperKey(config.apiKey)
        .setAppId(config.appId)
        .setOAuthToken(accessToken)
        .setOrigin(location.origin)
        .addView(view)
        .setTitle('Framecut の project.json を選択')
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
}
export async function fetchRemote(fileId: string) {
  const response = await request(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
  );
  const etag = response.headers.get('ETag');
  const manifest = (await response.json()) as DriveManifest;
  if (
    manifest.format !== 'framecut-drive' ||
    manifest.version !== 1 ||
    !manifest.repositoryFileId
  )
    throw Error('Framecut の project.json を選択してください');
  const repository = parsePack(
    await (
      await request(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(manifest.repositoryFileId)}?alt=media`,
      )
    ).text(),
  );
  if (repository.head !== manifest.head)
    throw Error('Drive のプロジェクトと履歴が一致しません');
  return { manifest, repository, etag };
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
  const { manifest, repository } = await fetchRemote(fileId);
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
    lastSyncedHead: manifest.head,
    lastSyncedSignature: repositorySignature(repository),
    pending: false,
    mode: Object.keys(manifest.assetIds).length ? 'cached' : 'local',
    assetIds: manifest.assetIds,
  } satisfies SyncRecord);
  return { project: p, repository };
}
export async function pushDrive(
  state: SavedProject,
  mode: SyncRecord['mode'],
  progress: (m: string) => void,
): Promise<{ conflict?: Repository; record: SyncRecord }> {
  const { project: p, repository: r } = state;
  let record = (await readMeta<SyncRecord>(`drive-sync:${p.id}`)) || {
    lastSyncedHead: null,
    pending: true,
    mode,
    assetIds: {},
  };
  record = { ...record, pending: true, mode };
  await writeMeta(`drive-sync:${p.id}`, record);
  let expectedHead: string | null = null;
  if (record.fileId) {
    const remote = await fetchRemote(record.fileId);
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
  }
  progress('Drive の保存先を準備中…');
  if (!record.folderId) {
    record.folderId = (await folder(p.name)).id;
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
  // Check again immediately before publishing. A remote change is kept as a separate branch.
  if (record.fileId) {
    const latest = await fetchRemote(record.fileId);
    if (latest.manifest.head !== expectedHead)
      return { conflict: latest.repository, record };
  }
  const manifest: DriveManifest = {
    format: 'framecut-drive',
    version: 1,
    project: p,
    head: r.head,
    repositoryFileId: pack.id,
    assetIds: record.assetIds,
    folderId: root,
  };
  let result: DriveFile;
  if (record.fileId) {
    const latest = await fetchRemote(record.fileId);
    if (latest.manifest.head !== expectedHead)
      return { conflict: latest.repository, record };
    if (!latest.etag)
      throw Error(
        'Drive が競合確認用の ETag を返しませんでした。上書きは行っていません。「別の保存先へ保存」を使ってください。',
      );
    try {
      result = (await (
        await request(
          `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(record.fileId)}?uploadType=media&fields=id,name`,
          {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              'If-Match': latest.etag,
            },
            body: blobJson(manifest),
          },
        )
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
  record.fileId = result.id;
  record.lastSyncedHead = r.head;
  record.lastSyncedSignature = repositorySignature(r);
  record.pending = false;
  delete record.conflictHead;
  await writeMeta(`drive-sync:${p.id}`, record);
  return { record };
}
