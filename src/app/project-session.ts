import { Editor } from '../core/history';
import { makeProject } from '../core/model';
import {
  deleteLocalProject,
  loadLocal,
  readMeta,
  requestPersistence,
  type SavedProject,
} from '../storage/local';
import { detectCapabilities } from './capabilities';
import { stopActivePlayback } from './editor-actions';
import { useEditor } from './editor-state';
import { hydrateMedia } from './media-import-service';
import { notify } from './notifications';
import { cancelPendingPersist, persistNow } from './persistence-controller';

let booted = false;

export async function openProject(state: SavedProject) {
  stopActivePlayback();
  cancelPendingPersist();
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
    offline: [],
    assetIssues: {},
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
  const project = makeProject(name, width, height, rate);
  const editor = new Editor(project);
  await openProject({ project, repository: editor.repository });
  void requestPersistence();
}

export async function deleteProject(projectId: string) {
  const current = useEditor.getState();
  const remaining = current.projects.filter(
    (project) => project.id !== projectId,
  );
  await deleteLocalProject(projectId);
  if (projectId !== current.project.id) {
    useEditor.setState({ projects: remaining });
    return;
  }
  const next = remaining[0] && (await loadLocal(remaining[0].id));
  if (next) await openProject(next);
  else {
    const project = makeProject();
    const editor = new Editor(project);
    await openProject({ project, repository: editor.repository });
  }
}

export async function bootstrap() {
  if (booted) return;
  booted = true;
  try {
    useEditor.setState({ capabilities: await detectCapabilities() });
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
  } catch (error) {
    useEditor.setState({ ready: true });
    notify(
      `保存データの読み込みを確認してください: ${(error as Error).message}`,
    );
  }
}
