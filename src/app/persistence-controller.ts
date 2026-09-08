import { repositorySignature } from '../core/history';
import {
  readMeta,
  saveLocal,
  writeMeta,
  type ProjectIndex,
} from '../storage/local';
import { useEditor } from './editor-state';
import { notify } from './notifications';

let saveTimer: ReturnType<typeof setTimeout> | undefined;
let transactionActive = false;

export function setTransactionActive(active: boolean) {
  transactionActive = active;
}

export function cancelPendingPersist() {
  clearTimeout(saveTimer);
}

export function schedulePersist() {
  if (transactionActive) return;
  useEditor.setState({ saveStatus: 'saving' });
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void persistNow(), 500);
}

export async function persistNow() {
  if (transactionActive) return;
  clearTimeout(saveTimer);
  const state = useEditor.getState();
  const revision = state.revision;
  useEditor.setState({ saveStatus: 'saving' });
  try {
    await saveLocal({ project: state.project, repository: state.repository });
    const sync = await readMeta<{
      lastSyncedHead: string;
      pending: boolean;
      conflictHead?: string;
      lastSyncedSignature?: string;
    }>(`drive-sync:${state.project.id}`);
    if (
      sync &&
      !sync.conflictHead &&
      (sync.lastSyncedHead !== state.repository.head ||
        sync.lastSyncedSignature !== repositorySignature(state.repository))
    )
      await writeMeta(`drive-sync:${state.project.id}`, {
        ...sync,
        pending: true,
      });
    if (useEditor.getState().revision === revision)
      useEditor.setState({ saveStatus: 'saved' });
    useEditor.setState({
      projects: (await readMeta<ProjectIndex[]>('projects')) || [],
    });
  } catch (error) {
    useEditor.setState({ saveStatus: 'error' });
    notify(
      `自動保存に失敗しました: ${(error as Error).message}。プロジェクトをダウンロードして保管してください。`,
    );
  }
}

export function installPagePersistence() {
  if (typeof window === 'undefined') return;
  window.addEventListener('pagehide', () => {
    if (!transactionActive) void persistNow();
  });
  window.addEventListener('beforeunload', (event) => {
    const state = useEditor.getState();
    if (state.saveStatus !== 'saved' || state.busy || transactionActive)
      event.preventDefault();
  });
}
