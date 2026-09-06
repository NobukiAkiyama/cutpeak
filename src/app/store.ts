import { create } from 'zustand';
import { Editor, repositorySignature, type Repository } from '../core/history';
import { type Command } from '../core/commands';
import {
  type Asset,
  type Project,
  makeProject,
  makeClip,
  makeTrack,
  id,
  endFrame,
  findClip,
} from '../core/model';
import { type CapabilityProfile, detectCapabilities } from './capabilities';
import { MediaClient } from '../media/client';
import {
  saveLocal,
  loadLocal,
  readMeta,
  writeMeta,
  putAsset,
  getAsset,
  requestPersistence,
  availableBytes,
  type ProjectIndex,
  type SavedProject,
} from '../storage/local';
export type Panel = 'media' | 'audio' | 'text' | 'captions' | 'elements';
export interface State {
  editor: Editor;
  project: Project;
  repository: Repository;
  revision: number;
  selected: string | null;
  frame: number;
  playing: boolean;
  ready: boolean;
  panel: Panel;
  zoom: number;
  snapping: boolean;
  quality: 'auto' | 'full' | 'half' | 'quarter';
  saveStatus: 'saved' | 'saving' | 'error';
  notice: string;
  busy: string;
  capabilities: CapabilityProfile | null;
  offline: string[];
  projects: ProjectIndex[];
  mobilePanel: boolean;
  inspectorOpen: boolean;
}
const initial = new Editor(makeProject());
export const useEditor = create<State>(() => ({
  editor: initial,
  project: initial.project,
  repository: initial.repository,
  revision: 0,
  selected: null,
  frame: 0,
  playing: false,
  ready: false,
  panel: 'media',
  zoom: 1.8,
  snapping: true,
  quality: 'auto',
  saveStatus: 'saved',
  notice: '',
  busy: '',
  capabilities: null,
  offline: [],
  projects: [],
  mobilePanel: false,
  inspectorOpen: false,
}));
export let media = new MediaClient();
let mediaGeneration = 0;
let saveTimer: ReturnType<typeof setTimeout> | undefined,
  noticeTimer: ReturnType<typeof setTimeout> | undefined;
let transaction = false;
let stopPlayback = () => {};
let booted = false;
export function setStopPlayback(fn: () => void) {
  stopPlayback = fn;
}
export function notify(notice: string) {
  clearTimeout(noticeTimer);
  useEditor.setState({ notice });
  noticeTimer = setTimeout(() => useEditor.setState({ notice: '' }), 6500);
}
export async function persistNow() {
  if (transaction) return;
  clearTimeout(saveTimer);
  const s = useEditor.getState();
  const revision = s.revision;
  useEditor.setState({ saveStatus: 'saving' });
  try {
    await saveLocal({ project: s.project, repository: s.repository });
    const sync = await readMeta<{
      lastSyncedHead: string;
      pending: boolean;
      conflictHead?: string;
      lastSyncedSignature?: string;
    }>(`drive-sync:${s.project.id}`);
    if (
      sync &&
      !sync.conflictHead &&
      (sync.lastSyncedHead !== s.repository.head ||
        sync.lastSyncedSignature !== repositorySignature(s.repository))
    )
      await writeMeta(`drive-sync:${s.project.id}`, { ...sync, pending: true });
    if (useEditor.getState().revision === revision)
      useEditor.setState({ saveStatus: 'saved' });
    useEditor.setState({
      projects: (await readMeta<ProjectIndex[]>('projects')) || [],
    });
  } catch (e) {
    useEditor.setState({ saveStatus: 'error' });
    notify(
      `自動保存に失敗しました: ${(e as Error).message}。プロジェクトをダウンロードして保管してください。`,
    );
  }
}
function publish(save = true) {
  const s = useEditor.getState(),
    p = s.editor.project;
  useEditor.setState({
    project: p,
    repository: { ...s.editor.repository },
    revision: s.revision + 1,
    selected: s.selected && findClip(p, s.selected) ? s.selected : null,
    frame: Math.min(s.frame, Math.max(0, endFrame(p) - 1)),
  });
  if (save && !transaction) {
    useEditor.setState({ saveStatus: 'saving' });
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void persistNow(), 500);
  }
}
export const api = {
  execute(cmd: Command) {
    stopPlayback();
    try {
      useEditor.getState().editor.execute(cmd);
      publish();
      return true;
    } catch (e) {
      notify((e as Error).message);
      return false;
    }
  },
  begin(message: string) {
    stopPlayback();
    clearTimeout(saveTimer);
    transaction = true;
    useEditor.getState().editor.begin(message);
  },
  preview(commands: Command[]) {
    try {
      useEditor.getState().editor.preview(commands);
      publish(false);
    } catch (e) {
      notify((e as Error).message);
    }
  },
  end() {
    useEditor.getState().editor.end();
    transaction = false;
    publish();
  },
  cancel() {
    useEditor.getState().editor.cancel();
    transaction = false;
    publish();
  },
  undo() {
    stopPlayback();
    useEditor.getState().editor.undo();
    publish();
  },
  redo() {
    stopPlayback();
    useEditor.getState().editor.redo();
    publish();
  },
  snapshot(message?: string) {
    useEditor.getState().editor.snapshot(message);
    publish();
  },
  branch(name: string) {
    useEditor.getState().editor.branch(name);
    publish();
  },
  checkout(branchId: string) {
    stopPlayback();
    useEditor.getState().editor.checkout(branchId);
    publish();
    void hydrateMedia();
  },
  restore(commitId: string) {
    stopPlayback();
    useEditor.getState().editor.restore(commitId);
    publish();
    void hydrateMedia();
  },
  importBranch(repo: Repository, name: string) {
    useEditor.getState().editor.importBranch(repo, name);
    publish();
  },
  select(selected: string | null) {
    useEditor.setState({ selected });
  },
  seek(frame: number) {
    stopPlayback();
    useEditor.setState({
      frame: Math.max(
        0,
        Math.min(
          Math.round(frame),
          Math.max(0, endFrame(useEditor.getState().project) - 1),
        ),
      ),
    });
  },
  addClip(
    type: Asset['kind'] | 'text' | 'caption' | 'shape',
    asset?: Asset,
    startFrame?: number,
    trackId?: string,
  ) {
    const p = useEditor.getState().project;
    const requestedTrack = trackId
      ? p.tracks.find((t) => t.id === trackId)
      : undefined;
    if (trackId && !requestedTrack) {
      notify('トラックが見つかりません');
      return '';
    }
    if (requestedTrack?.locked) {
      notify('トラックがロックされています');
      return '';
    }
    const track = requestedTrack || p.tracks.find((t) => t.type === type && !t.locked);
    const c = makeClip(
      p,
      type,
      startFrame ?? useEditor.getState().frame,
      asset,
    );
    if (type === 'caption') {
      c.transform.y.defaultValue = p.height * 0.84;
      c.style.size = 54;
      c.style.strokeWidth = 3;
    }
    api.begin('クリップを追加');
    const t = track || makeTrack(type, `トラック ${p.tracks.length + 1}`);
    if (!track) api.execute({ type: 'track.add', track: t });
    if (!trackId && asset && track)
      c.startFrame = Math.max(
        c.startFrame,
        ...track.clips.map((c) => c.startFrame + c.durationFrames),
      );
    api.execute({ type: 'clip.add', trackId: t.id, clip: c });
    api.end();
    api.select(c.id);
    useEditor.setState({ frame: c.startFrame });
    return c.id;
  },
};
export async function hydrateMedia() {
  const s = useEditor.getState();
  const projectId = s.project.id;
  const generation = ++mediaGeneration;
  const previous = media;
  const client = new MediaClient();
  media = client;
  previous.dispose();
  const offline: string[] = [];
  for (const a of s.project.assets) {
    let file = await getAsset(projectId, a.id);
    if (!file) {
      try {
        const drive = await import('../storage/drive');
        const sync = await readMeta<import('../storage/drive').SyncRecord>(
          `drive-sync:${projectId}`,
        );
        if (drive.connected() && sync?.assetIds[a.id]) {
          await drive.cacheRemoteAsset(projectId, a, sync.assetIds[a.id]);
          file = await getAsset(projectId, a.id);
        }
      } catch {}
    }
    if (!file) {
      offline.push(a.id);
      continue;
    }
    try {
      await client.register(
        a.id,
        new File([file], a.name, { type: a.mime || file.type }),
      );
    } catch {
      offline.push(a.id);
    }
  }
  if (
    generation === mediaGeneration &&
    useEditor.getState().project.id === projectId
  )
    useEditor.setState({
      offline,
      revision: useEditor.getState().revision + 1,
    });
}
export async function openProject(state: SavedProject) {
  stopPlayback();
  clearTimeout(saveTimer);
  useEditor.setState({ busy: 'プロジェクトを開いています…', ready: false });
  const current = useEditor.getState();
  const local =
    current.project.id === state.project.id
      ? { project: current.project, repository: current.repository }
      : await loadLocal(state.project.id);
  const editor = new Editor(state.project, state.repository);
  if (
    local &&
    local.repository.head !== state.repository.head &&
    !state.repository.commits[local.repository.head]
  ) {
    editor.importBranch(
      local.repository,
      `この端末の別案 ${new Date().toLocaleString('ja-JP')}`,
    );
    notify('端末側の編集を「この端末の別案」として履歴に残しました。');
  }
  useEditor.setState({
    editor,
    project: editor.project,
    repository: editor.repository,
    selected: null,
    frame: 0,
    revision: useEditor.getState().revision + 1,
  });
  await hydrateMedia();
  useEditor.setState({ ready: true, busy: '' });
  await persistNow();
}
export async function newProject(
  name: string,
  width: number,
  height: number,
  rate: { numerator: number; denominator: number },
) {
  await persistNow();
  const p = makeProject(name, width, height, rate);
  const e = new Editor(p);
  await openProject({ project: p, repository: e.repository });
  void requestPersistence();
}
export async function bootstrap() {
  if (booted) return;
  booted = true;
  try {
    const capabilities = await detectCapabilities();
    useEditor.setState({ capabilities });
    const last = await readMeta<string>('last-project');
    if (last) {
      const saved = await loadLocal(last);
      if (saved) {
        await openProject(saved);
        return;
      }
    }
    useEditor.setState({ ready: true });
    await persistNow();
  } catch (e) {
    useEditor.setState({ ready: true });
    notify(`保存データの読み込みを確認してください: ${(e as Error).message}`);
  }
}
export async function importFiles(
  files: File[],
  options?: { addToTimeline?: boolean; frame?: number; relinkId?: string },
) {
  if (useEditor.getState().busy) return;
  if (options?.relinkId) files = files.slice(0, 1);
  await requestPersistence();
  const total = files.reduce((sum, f) => sum + f.size, 0);
  if (total > (await availableBytes())) {
    notify('端末の保存容量が不足しています。空き容量を確保してください。');
    return;
  }
  const projectId = useEditor.getState().project.id;
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    useEditor.setState({
      busy: `${file.name} を解析中 (${i + 1}/${files.length})`,
    });
    const assetId = options?.relinkId || id();
    try {
      if (options?.relinkId) {
        const original = useEditor
          .getState()
          .project.assets.find((a) => a.id === assetId);
        if (
          original &&
          (original.name !== file.name || original.size !== file.size)
        )
          throw Error(
            '元の素材と同じファイルを選択してください（名前・サイズが一致しません）',
          );
      }
      const asset = await media.register(assetId, file);
      if (asset.hasAudio) {
        useEditor.setState({ busy: `${file.name} の波形を生成中…` });
        asset.waveform = await media.waveform(assetId);
      }
      await putAsset(projectId, assetId, file);
      if (options?.relinkId) {
        api.execute({ type: 'asset.relink', assetId, asset });
        useEditor.setState({
          offline: useEditor.getState().offline.filter((x) => x !== assetId),
        });
      } else {
        api.execute({ type: 'asset.add', asset });
        if (options?.addToTimeline)
          api.addClip(asset.kind, asset, options.frame);
      }
      notify(`${file.name} を読み込みました`);
    } catch (e) {
      notify(`${file.name}: ${(e as Error).message}`);
    }
  }
  useEditor.setState({ busy: '' });
  await persistNow();
}
export async function projectFiles(p: Project) {
  const result: { id: string; file: File }[] = [];
  for (const a of p.assets) {
    const f = await getAsset(p.id, a.id);
    if (f)
      result.push({
        id: a.id,
        file: new File([f], a.name, { type: a.mime || f.type }),
      });
  }
  return result;
}
window.addEventListener('pagehide', () => {
  if (!transaction) void persistNow();
});
window.addEventListener('beforeunload', (e) => {
  const s = useEditor.getState();
  if (s.saveStatus !== 'saved' || s.busy || transaction) {
    e.preventDefault();
  }
});
void writeMeta;
