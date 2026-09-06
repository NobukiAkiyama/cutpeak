import 'fake-indexeddb/auto';
import { afterEach, describe, it, expect, beforeEach, vi } from 'vitest';
import {
  saveLocal,
  loadLocal,
  deleteLocalProject,
  putAsset,
  getAsset,
  readMeta,
  saveDownload,
} from '../src/storage/local';
import { Editor } from '../src/core/history';
import { makeProject } from '../src/core/model';
class Directory {
  dirs = new Map<string, Directory>();
  files = new Map<string, Blob>();
  async getDirectoryHandle(name: string, options?: { create: boolean }) {
    if (!this.dirs.has(name)) {
      if (!options?.create) throw new DOMException('missing', 'NotFoundError');
      this.dirs.set(name, new Directory());
    }
    return this.dirs.get(name)!;
  }
  async getFileHandle(name: string, options?: { create: boolean }) {
    if (!this.files.has(name)) {
      if (!options?.create) throw new DOMException('missing', 'NotFoundError');
      this.files.set(name, new Blob());
    }
    const files = this.files;
    return {
      async getFile() {
        return new File([files.get(name)!], name);
      },
      async createWritable() {
        let pending = files.get(name)!;
        return {
          async write(value: Blob | string) {
            pending = typeof value === 'string' ? new Blob([value]) : value;
          },
          async close() {
            files.set(name, pending);
          },
          async abort() {},
        };
      },
    };
  }
  async *entries() {
    for (const [k] of this.files) yield [k, {}];
  }
  async removeEntry(name: string) {
    if (this.dirs.delete(name)) return;
    this.files.delete(name);
  }
}
let root: Directory,
  fail = false;
beforeEach(() => {
  root = new Directory();
  fail = false;
  Object.defineProperty(globalThis, 'navigator', {
    value: {
      storage: {
        getDirectory: async () => {
          if (fail)
            throw new DOMException('storage unavailable', 'NotAllowedError');
          return root;
        },
      },
    },
    configurable: true,
  });
});
afterEach(() => vi.unstubAllGlobals());
const fixture = () => {
  const project = makeProject();
  return { project, repository: new Editor(project).repository };
};
describe('local durability', () => {
  it('round-trips an OPFS project including history', async () => {
    const state = fixture();
    await saveLocal(state);
    expect(await loadLocal(state.project.id)).toEqual(state);
    expect(await readMeta('last-project')).toBe(state.project.id);
  });
  it('serializes saves so the newest edit wins', async () => {
    const a = fixture(),
      e = new Editor(a.project, a.repository);
    const first = saveLocal(a);
    e.execute({ type: 'project.update', patch: { name: '最新の名前' } });
    const next = { project: e.project, repository: e.repository };
    await Promise.all([first, saveLocal(next)]);
    expect((await loadLocal(a.project.id))!.project.name).toBe('最新の名前');
  });
  it('reads the latest IndexedDB fallback before an older OPFS generation', async () => {
    const a = fixture();
    await saveLocal(a);
    const e = new Editor(a.project, a.repository);
    e.execute({ type: 'project.update', patch: { name: '障害後の編集' } });
    fail = true;
    await saveLocal({ project: e.project, repository: e.repository });
    fail = false;
    expect((await loadLocal(a.project.id))!.project.name).toBe('障害後の編集');
  });
  it('recovers the previous generation when HEAD is unreadable', async () => {
    const a = fixture();
    await saveLocal(a);
    const e = new Editor(a.project, a.repository);
    e.execute({ type: 'project.update', patch: { name: '次の編集' } });
    await saveLocal({ project: e.project, repository: e.repository });
    const d = await (
      await root.getDirectoryHandle(a.project.id)
    ).getDirectoryHandle('project');
    d.files.set('HEAD', new Blob(['missing-generation.json']));
    expect((await loadLocal(a.project.id))!.project.name).toBe(a.project.name);
  });
  it('retains imported asset bytes', async () => {
    const p = makeProject(),
      file = new File(['original-media-bytes'], 'test.bin');
    await putAsset(p.id, 'asset', file);
    expect(await (await getAsset(p.id, 'asset'))!.text()).toBe(
      'original-media-bytes',
    );
  });
  it('deletes a local project, assets, and its index entry', async () => {
    const deleted = fixture();
    const remaining = fixture();
    await saveLocal(deleted);
    await putAsset(deleted.project.id, 'asset', new File(['bytes'], 'a.bin'));
    await saveLocal(remaining);

    await deleteLocalProject(deleted.project.id);

    expect(await loadLocal(deleted.project.id)).toBeNull();
    expect(await getAsset(deleted.project.id, 'asset')).toBeNull();
    expect(await readMeta('last-project')).toBe(remaining.project.id);
    const projects = (await readMeta<{ id: string }[]>('projects')) || [];
    expect(projects).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: remaining.project.id })]),
    );
    expect(projects.some((p) => p.id === deleted.project.id)).toBe(false);
  });
  it('lets the browser choose a destination for rendered files', async () => {
    const write = vi.fn(),
      close = vi.fn(async () => {}),
      createWritable = vi.fn(async () => ({
        write,
        close,
        abort: vi.fn(async () => {}),
      })),
      showSaveFilePicker = vi.fn(async (options: { suggestedName?: string }) => {
        expect(options.suggestedName).toBe('旅行動画.mp4');
        return { createWritable } as unknown as FileSystemFileHandle;
      });
    vi.stubGlobal('window', { showSaveFilePicker });
    const file = new Blob(['rendered'], { type: 'video/mp4' });
    expect(await saveDownload(file, '旅行動画.mp4')).toBe('saved');
    expect(showSaveFilePicker).toHaveBeenCalledOnce();
    expect(write).toHaveBeenCalledWith(file);
    expect(close).toHaveBeenCalledOnce();
  });
});
