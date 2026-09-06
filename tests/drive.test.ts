import 'fake-indexeddb/auto';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import {
  connected,
  disconnect,
  fetchRemote,
  normalizeDriveSaveName,
  pushDrive,
  restoreConnection,
  upload,
  type SyncRecord,
} from '../src/storage/drive';
import { writeMeta, readMeta } from '../src/storage/local';
import { makeProject } from '../src/core/model';
import { Editor, type Repository } from '../src/core/history';
beforeEach(async () => {
  vi.stubGlobal('navigator', { onLine: true });
  vi.stubGlobal('document', {
    createElement: () => ({}),
    head: {
      appendChild: (tag: { onload: () => void }) =>
        queueMicrotask(() => tag.onload()),
    },
  });
  vi.stubGlobal('window', {
    google: {
      accounts: {
        oauth2: {
          initCodeClient: () => ({
            requestCode: () => {},
          }),
        },
      },
    },
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: RequestInfo | URL) => {
      const requestUrl =
        typeof url === 'string'
          ? url
          : url instanceof Request
            ? url.url
            : url.href;
      if (requestUrl === '/api/drive-auth/token')
        return response({ access_token: 'test-token-only', expires_in: 3600 });
      throw Error(`Unexpected authentication request: ${requestUrl}`);
    }),
  );
  await restoreConnection();
});
afterEach(() => vi.unstubAllGlobals());
const response = (
  v: unknown,
  status = 200,
  headers: Record<string, string> = {},
) =>
  new Response(JSON.stringify(v), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
function fixture() {
  const p = makeProject();
  const e = new Editor(p),
    remote = structuredClone(e.repository);
  e.execute({ type: 'project.update', patch: { name: 'Local edit' } });
  return { p, e, remote };
}
function route(
  remote: Repository,
  options: {
    etag?: string;
    rejectPublish?: boolean;
    canEdit?: boolean;
  } = { etag: '"version-1"' },
) {
  let session = 0;
  return vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const s = url instanceof Request ? url.url : url.toString(),
      method = init?.method || 'GET';
    if (s.includes('/api/drive-sync/projects/project')) {
      if (method === 'PATCH') {
        if (options.rejectPublish) return response({}, 412);
        return response(
          { id: 'project', name: 'project.json', etag: options.etag },
          200,
        );
      }
      return response({
        manifest: {
          format: 'framecut-drive',
          version: 1,
          head: remote.head,
          project: remote.commits[remote.head].project,
          repositoryFileId: 'pack',
          assetIds: {},
          folderId: 'folder',
        },
        etag: options.etag || null,
        version: '1',
        canEdit: options.canEdit ?? true,
      });
    }
    if (s.includes('/files/pack?alt=media')) return response(remote);
    if (s.includes('/files?q='))
      return response({
        files: [
          {
            id: 'history',
            name: 'history',
            mimeType: 'application/vnd.google-apps.folder',
          },
          {
            id: 'repository',
            name: 'repository.json',
            mimeType: 'application/json',
          },
        ],
      });
    if (s.includes('uploadType=resumable'))
      return response({}, 200, {
        Location: `https://www.googleapis.com/session/${++session}`,
      });
    if (s.includes('/session/'))
      return response({ id: `uploaded-${session}`, name: 'pack' });
    throw Error(`Unexpected test request: ${method} ${s}`);
  });
}
async function syncRecord(p: string, remote: Repository) {
  await writeMeta(`drive-sync:${p}`, {
    fileId: 'project',
    folderId: 'folder',
    lastSyncedHead: remote.head,
    pending: true,
    mode: 'local',
    assetIds: {},
  } satisfies SyncRecord);
}
describe('Drive data preservation', () => {
  it('restores a Drive access token from the server session', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: RequestInfo | URL) => {
        const requestUrl =
          typeof url === 'string'
            ? url
            : url instanceof Request
              ? url.url
              : url.href;
        if (requestUrl === '/api/drive-auth/logout') return response({});
        if (requestUrl === '/api/drive-auth/token')
          return response({
            access_token: 'restored-token',
            expires_in: 3600,
          });
        throw Error(`Unexpected authentication request: ${requestUrl}`);
      }),
    );
    await disconnect();
    expect(connected()).toBe(false);
    await expect(restoreConnection()).resolves.toBe(true);
    expect(connected()).toBe(true);
  });

  it('requires and normalizes a name before creating a Drive directory', async () => {
    const { e } = fixture();
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(
      pushDrive(
        { project: e.project, repository: e.repository },
        'local',
        () => {},
      ),
    ).rejects.toThrow('保存名');
    expect(fetch).not.toHaveBeenCalled();
    expect(normalizeDriveSaveName('  旅行/動画.cutpeak  ')).toBe('旅行 動画');
  });
  it('stores a new project as one named directory under Cutpeak', async () => {
    const { e } = fixture();
    let session = 0;
    const created: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        const s = url instanceof Request ? url.url : url.toString();
        if (s.includes('/files?q=')) return response({ files: [] });
        if (s.includes('uploadType=resumable'))
          return response({}, 200, {
            Location: `https://www.googleapis.com/new-session/${++session}`,
          });
        if (s.includes('/new-session/'))
          return response({ id: `uploaded-${session}`, name: 'uploaded' });
        if (s.endsWith('/drive/v3/files?fields=id,name')) {
          if (typeof init?.body !== 'string')
            throw Error('Folder metadata must be JSON');
          const body = JSON.parse(init.body) as Record<string, unknown>;
          created.push(body);
          return response({
            id:
              created.length === 1
                ? 'cutpeak-root'
                : `folder-${created.length}`,
            name: body.name,
            mimeType: body.mimeType,
          });
        }
        throw Error(`Unexpected test request: ${init?.method || 'GET'} ${s}`);
      }),
    );
    const result = await pushDrive(
      { project: e.project, repository: e.repository },
      'local',
      () => {},
      '旅行動画',
    );
    expect(created[0]).toMatchObject({
      name: 'Cutpeak',
      parents: ['root'],
      appProperties: { framecutType: 'root' },
    });
    expect(created[1]).toMatchObject({
      name: '旅行動画.cutpeak',
      parents: ['cutpeak-root'],
      appProperties: {
        framecutType: 'project',
        framecutProjectId: e.project.id,
      },
    });
    expect(result.record).toMatchObject({
      folderId: 'folder-2',
      saveName: '旅行動画',
      pending: false,
    });
  });
  it('publishes an existing manifest only with an ETag precondition', async () => {
    const { p, e, remote } = fixture();
    await syncRecord(p.id, remote);
    const fetch = route(remote);
    vi.stubGlobal('fetch', fetch);
    const result = await pushDrive(
      { project: e.project, repository: e.repository },
      'local',
      () => {},
    );
    expect(result.conflict).toBeUndefined();
    const publish = fetch.mock.calls.find(
      ([url, init]) =>
        (url instanceof Request ? url.url : url.toString()).includes(
          '/api/drive-sync/projects/project',
        ) && (init?.method || 'GET') === 'PATCH',
    )!;
    expect(new Headers(publish[1]?.headers).get('If-Match')).toBe(
      '"version-1"',
    );
    expect(result.record.pending).toBe(false);
  });
  it('never blindly overwrites if Drive omits the ETag', async () => {
    const { p, e, remote } = fixture();
    await syncRecord(p.id, remote);
    const fetch = route(remote, { etag: undefined });
    vi.stubGlobal('fetch', fetch);
    await expect(
      pushDrive(
        { project: e.project, repository: e.repository },
        'local',
        () => {},
      ),
    ).rejects.toThrow('Driveの最新状態を安全に確認できませんでした');
    expect(
      fetch.mock.calls.some(([url, init]) =>
        (url instanceof Request ? url.url : url.toString()).includes(
          '/api/drive-sync/projects/project',
        ) && (init?.method || 'GET') === 'PATCH',
      ),
    ).toBe(false);
  });
  it('exports a legacy Google Doc repository after Drive rejects binary download', async () => {
    const { remote } = fixture();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: RequestInfo | URL) => {
        const s = url instanceof Request ? url.url : url.toString();
        if (s.includes('/api/drive-sync/projects/project'))
          return response({
            manifest: {
              format: 'framecut-drive',
              version: 1,
              head: remote.head,
              project: remote.commits[remote.head].project,
              repositoryFileId: 'pack',
              assetIds: {},
              folderId: 'folder',
            },
            etag: null,
            version: '1',
            canEdit: false,
          });
        if (s.includes('/files/pack?alt=media'))
          return response(
            {
              error: {
                message:
                  'Only files with binary content can be downloaded. Use Export with Docs Editors files.',
              },
            },
            403,
          );
        if (s.includes('/files/pack?fields=id,name,mimeType'))
          return response({
            id: 'pack',
            name: 'pack.ndjson',
            mimeType: 'application/vnd.google-apps.document',
          });
        if (s.includes('/files/pack/export?mimeType='))
          return new Response(JSON.stringify(remote), {
            status: 200,
            headers: { 'Content-Type': 'text/plain' },
          });
        throw Error(`Unexpected request: ${s}`);
      }),
    );
    await expect(fetchRemote('project')).resolves.toMatchObject({
      repository: remote,
      canEdit: false,
    });
  });
  it('forks a viewer edit into the current user Drive without publishing to the source', async () => {
    const { p, e, remote } = fixture();
    await writeMeta(`drive-sync:${p.id}`, {
      fileId: 'project',
      folderId: 'shared-folder',
      saveName: '共有プロジェクト',
      lastSyncedHead: remote.head,
      pending: true,
      mode: 'local',
      assetIds: {},
      canEdit: false,
    } satisfies SyncRecord);
    let session = 0;
    const createdFolders: string[] = [];
    const fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const s = url instanceof Request ? url.url : url.toString();
      const method = init?.method || 'GET';
      if (s.includes('/api/drive-sync/projects/project')) {
        if (method === 'PATCH') return response({}, 500);
        return response({
          manifest: {
            format: 'framecut-drive',
            version: 1,
            head: remote.head,
            project: remote.commits[remote.head].project,
            repositoryFileId: 'pack',
            assetIds: {},
            folderId: 'shared-folder',
            saveName: '共有プロジェクト',
          },
          etag: '"source-version"',
          version: '1',
          canEdit: false,
        });
      }
      if (s.includes('/files/pack?alt=media')) return response(remote);
      if (s.includes('/files?q=')) return response({ files: [] });
      if (s.endsWith('/drive/v3/files?fields=id,name')) {
        if (typeof init?.body !== 'string') throw Error('Folder metadata must be JSON');
        const body = JSON.parse(init.body) as { name: string };
        createdFolders.push(body.name);
        return response({
          id: `folder-${createdFolders.length}`,
          name: body.name,
          mimeType: 'application/vnd.google-apps.folder',
        });
      }
      if (s.includes('uploadType=resumable'))
        return response({}, 200, {
          Location: `https://www.googleapis.com/fork-session/${++session}`,
        });
      if (s.includes('/fork-session/'))
        return response({ id: `uploaded-${session}`, name: 'uploaded' });
      throw Error(`Unexpected test request: ${method} ${s}`);
    });
    vi.stubGlobal('fetch', fetch);

    const result = await pushDrive(
      { project: e.project, repository: e.repository },
      'local',
      () => {},
    );

    expect(createdFolders).toEqual([
      'Cutpeak',
      '共有プロジェクト - 派生版.cutpeak',
      'history',
    ]);
    expect(result.conflict).toBeUndefined();
    expect(result.record).toMatchObject({
      fileId: 'uploaded-2',
      folderId: 'folder-2',
      saveName: '共有プロジェクト - 派生版',
      canEdit: true,
      origin: {
        fileId: 'project',
        folderId: 'shared-folder',
        head: remote.head,
        saveName: '共有プロジェクト',
      },
      pending: false,
    });
    expect(
      fetch.mock.calls.some(([url, init]) =>
        (url instanceof Request ? url.url : url.toString()).includes(
          '/api/drive-sync/projects/project',
        ) && (init?.method || 'GET') === 'PATCH',
      ),
    ).toBe(false);
  });
  it('returns a conflict after a concurrent writer changes the manifest', async () => {
    const { p, e, remote } = fixture();
    await syncRecord(p.id, remote);
    const fetch = route(remote, { etag: '"version-1"', rejectPublish: true });
    vi.stubGlobal('fetch', fetch);
    const result = await pushDrive(
      { project: e.project, repository: e.repository },
      'local',
      () => {},
    );
    expect(result.conflict?.head).toBe(remote.head);
    expect(
      fetch.mock.calls.filter(([url, init]) =>
        (url instanceof Request ? url.url : url.toString()).includes(
          '/api/drive-sync/projects/project',
        ) && (init?.method || 'GET') === 'PATCH',
      ),
    ).toHaveLength(1);
  });
  it('keeps both histories when local and remote diverge', async () => {
    const { p, e, remote } = fixture();
    const last = remote.head;
    const other = new Editor(p, remote);
    other.execute({ type: 'project.update', patch: { name: 'Remote edit' } });
    await syncRecord(p.id, { ...remote, head: last });
    const fetch = route(other.repository);
    vi.stubGlobal('fetch', fetch);
    const result = await pushDrive(
      { project: e.project, repository: e.repository },
      'local',
      () => {},
    );
    expect(result.conflict?.head).toBe(other.repository.head);
    expect(fetch.mock.calls).toHaveLength(2);
  });
  it('resumes an interrupted large upload at the server-confirmed offset', async () => {
    const size = 9 * 1024 * 1024,
      blob = new Blob([new Uint8Array(size)]),
      key = crypto.randomUUID();
    let fail = true;
    const ranges: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        if (
          (url instanceof Request ? url.url : url.toString()).includes(
            'uploadType=resumable',
          )
        )
          return response({}, 200, {
            Location: 'https://www.googleapis.com/resume-session',
          });
        const range = new Headers(init?.headers).get('Content-Range')!;
        ranges.push(range);
        if (range.startsWith('bytes */'))
          return new Response(null, {
            status: 308,
            headers: { Range: 'bytes=0-8388607' },
          });
        if (range.startsWith('bytes 0-'))
          return new Response(null, {
            status: 308,
            headers: { Range: 'bytes=0-8388607' },
          });
        if (fail) {
          fail = false;
          throw Error('network interrupted');
        }
        return response({ id: 'asset-remote', name: 'large.bin' });
      }),
    );
    await expect(
      upload(blob, 'large.bin', 'folder', undefined, key),
    ).rejects.toThrow('network');
    const result = await upload(blob, 'large.bin', 'folder', undefined, key);
    expect(result.id).toBe('asset-remote');
    expect(ranges.at(-1)).toBe(`bytes 8388608-${size - 1}/${size}`);
    expect(await readMeta(`drive-upload:${key}`)).toBeNull();
  });
});
