import { type Project, validateProject } from '../core/model';
import { type Repository, validateRepository } from '../core/history';
export interface SavedProject {
  project: Project;
  repository: Repository;
}
export interface ProjectIndex {
  id: string;
  name: string;
  updatedAt: number;
  width: number;
  height: number;
}
let dbPromise: Promise<IDBDatabase> | undefined;
function db() {
  return (dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open('framecut', 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('metadata');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}
export async function readMeta<T>(key: string): Promise<T | undefined> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction('metadata'),
      req = tx.objectStore('metadata').get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
export async function writeMeta(key: string, value: unknown) {
  const d = await db();
  return new Promise<void>((resolve, reject) => {
    const tx = d.transaction('metadata', 'readwrite');
    tx.objectStore('metadata').put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
export async function deleteMeta(key: string) {
  const d = await db();
  return new Promise<void>((resolve, reject) => {
    const tx = d.transaction('metadata', 'readwrite');
    tx.objectStore('metadata').delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
const sessionFiles = new Map<string, File>();
export let storageMode: 'opfs' | 'compatibility' = 'opfs';
async function directory(projectId: string, folder: string) {
  const root = await navigator.storage.getDirectory();
  const p = await root.getDirectoryHandle(projectId, { create: true });
  return p.getDirectoryHandle(folder, { create: true });
}
export async function writeFile(
  dir: FileSystemDirectoryHandle,
  name: string,
  data: Blob | string,
) {
  const handle = await dir.getFileHandle(name, { create: true });
  const stream = await handle.createWritable();
  try {
    await stream.write(data);
    await stream.close();
  } catch (e) {
    await stream.abort().catch(() => {});
    throw e;
  }
}
export async function putAsset(projectId: string, assetId: string, file: File) {
  sessionFiles.set(`${projectId}/${assetId}`, file);
  try {
    const d = await directory(projectId, 'assets');
    await writeFile(d, assetId, file);
  } catch (e) {
    storageMode = 'compatibility';
    if ((e as DOMException).name === 'QuotaExceededError')
      throw Error(
        '保存容量が不足しています。素材はこのセッションだけで利用できます。',
      );
  }
}
export async function getAsset(
  projectId: string,
  assetId: string,
): Promise<File | null> {
  const key = `${projectId}/${assetId}`;
  if (sessionFiles.has(key)) return sessionFiles.get(key)!;
  try {
    const d = await directory(projectId, 'assets');
    return await (await d.getFileHandle(assetId)).getFile();
  } catch {
    return null;
  }
}
let queue = Promise.resolve();
export function saveLocal(state: SavedProject): Promise<void> {
  const snapshot = structuredClone(state);
  const work = queue
    .catch(() => {})
    .then(async () => {
      const p = snapshot.project;
      let stored = false;
      try {
        const dir = await directory(p.id, 'project');
        const stamp = `state-${crypto.randomUUID()}.json`;
        await writeFile(dir, stamp, JSON.stringify(snapshot));
        let previous = '';
        try {
          previous = await (
            await (await dir.getFileHandle('HEAD')).getFile()
          ).text();
        } catch {}
        if (previous) await writeFile(dir, 'PREVIOUS', previous);
        await writeFile(dir, 'HEAD', stamp);
        stored = true;
        // Retain two complete generations so an interrupted write never replaces the last readable state.
        for await (const [name] of dir.entries())
          if (name.startsWith('state-') && name !== stamp && name !== previous)
            await dir.removeEntry(name).catch(() => {});
        const repoDir = await directory(p.id, 'repository');
        await writeFile(
          repoDir,
          'repository.json',
          JSON.stringify({
            version: 1,
            head: snapshot.repository.head,
            branches: snapshot.repository.branches,
            activeBranch: snapshot.repository.activeBranch,
          }),
        );
      } catch {
        storageMode = 'compatibility';
      }
      if (!stored) await writeMeta(`project:${p.id}`, snapshot);
      await writeMeta(`state-location:${p.id}`, stored ? 'opfs' : 'indexeddb');
      const index = (await readMeta<ProjectIndex[]>('projects')) || [];
      const entry = {
        id: p.id,
        name: p.name,
        updatedAt: p.updatedAt,
        width: p.width,
        height: p.height,
      };
      await writeMeta('projects', [
        entry,
        ...index.filter((i) => i.id !== p.id),
      ]);
      await writeMeta('last-project', p.id);
    });
  queue = work;
  return work;
}
export async function loadLocal(
  projectId: string,
): Promise<SavedProject | null> {
  const location = await readMeta<string>(`state-location:${projectId}`);
  if (location === 'indexeddb') {
    const latest = await readMeta<SavedProject>(`project:${projectId}`);
    if (latest) {
      validateProject(latest.project);
      validateRepository(latest.repository);
      return latest;
    }
  }
  try {
    const dir = await directory(projectId, 'project');
    for (const pointer of ['HEAD', 'PREVIOUS']) {
      try {
        const name = await (
          await (await dir.getFileHandle(pointer)).getFile()
        ).text();
        const data = JSON.parse(
          await (await (await dir.getFileHandle(name)).getFile()).text(),
        ) as SavedProject;
        validateProject(data.project);
        validateRepository(data.repository);
        return data;
      } catch {}
    }
  } catch {
    storageMode = 'compatibility';
  }
  const data = await readMeta<SavedProject>(`project:${projectId}`);
  if (data) {
    validateProject(data.project);
    validateRepository(data.repository);
    return data;
  }
  return null;
}
export async function deleteLocalProject(projectId: string) {
  try {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(projectId, { recursive: true });
  } catch (error) {
    if (!(error instanceof DOMException && error.name === 'NotFoundError'))
      throw error;
  }
  for (const key of sessionFiles.keys())
    if (key.startsWith(`${projectId}/`)) sessionFiles.delete(key);
  await deleteMeta(`project:${projectId}`);
  await deleteMeta(`state-location:${projectId}`);
  await deleteMeta(`drive-sync:${projectId}`);
  const index = (await readMeta<ProjectIndex[]>('projects')) || [];
  const remaining = index.filter((p) => p.id !== projectId);
  await writeMeta('projects', remaining);
  if ((await readMeta<string>('last-project')) === projectId) {
    if (remaining[0]) await writeMeta('last-project', remaining[0].id);
    else await deleteMeta('last-project');
  }
}
export async function requestPersistence() {
  return navigator.storage?.persist().catch(() => false) || false;
}
export async function availableBytes() {
  const e = await navigator.storage?.estimate();
  return e?.quota === undefined
    ? Infinity
    : Math.max(0, e.quota - (e.usage || 0));
}
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: Array<{
    description: string;
    accept: Record<string, string[]>;
  }>;
}

type SaveFilePicker = (
  options?: SaveFilePickerOptions,
) => Promise<FileSystemFileHandle>;

export function supportsSaveLocation() {
  return (
    typeof window !== 'undefined' &&
    typeof (window as Window & { showSaveFilePicker?: SaveFilePicker })
      .showSaveFilePicker === 'function'
  );
}

function safeDownloadName(name: string) {
  return (
    Array.from(name)
      .map((character) => {
        const code = character.charCodeAt(0);
        return code < 32 || code === 127 ? '_' : character;
      })
      .join('')
      .replace(/[<>:"/\\|?*]/g, '_')
      .trim()
      .replace(/\.+$/, '') || 'cutpeak-export'
  );
}

export async function saveDownload(
  blob: Blob,
  name: string,
): Promise<'saved' | 'downloaded' | 'cancelled'> {
  const picker = supportsSaveLocation()
    ? (window as unknown as { showSaveFilePicker: SaveFilePicker })
        .showSaveFilePicker
    : undefined;
  const safeName = safeDownloadName(name);
  if (!picker) {
    download(blob, safeName);
    return 'downloaded';
  }
  let handle: FileSystemFileHandle;
  try {
    const extension = safeName.match(/\.[^.]+$/)?.[0] || '';
    handle = await picker({
      suggestedName: safeName,
      types: [
        {
          description: '動画ファイル',
          accept: { [blob.type || 'application/octet-stream']: [extension] },
        },
      ],
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError')
      return 'cancelled';
    throw error;
  }
  const writable = await handle.createWritable();
  try {
    await writable.write(blob);
    await writable.close();
  } catch (error) {
    await writable.abort().catch(() => {});
    throw error;
  }
  return 'saved';
}
