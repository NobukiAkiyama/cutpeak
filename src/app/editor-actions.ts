import { type Command } from '../core/commands';
import { type Repository } from '../core/history';
import {
  endFrame,
  findClip,
  id,
  makeClip,
  makeTrack,
  type Asset,
} from '../core/model';
import { useEditor } from './editor-state';
import { notify } from './notifications';
import {
  cancelPendingPersist,
  schedulePersist,
  setTransactionActive,
} from './persistence-controller';

let stopPlayback = () => {};
let onHistoryRestored = () => {};
let selectionBeforeTransaction: string | null | undefined;

export function setStopPlayback(fn: () => void) {
  stopPlayback = fn;
}

export function stopActivePlayback() {
  stopPlayback();
}

export function setHistoryRestoredHandler(handler: () => void) {
  onHistoryRestored = handler;
}

function publish(save = true) {
  const state = useEditor.getState();
  const project = state.editor.project;
  useEditor.setState({
    project,
    repository: { ...state.editor.repository },
    revision: state.revision + 1,
    selected:
      state.selected && findClip(project, state.selected)
        ? state.selected
        : null,
    frame: Math.min(state.frame, Math.max(0, endFrame(project) - 1)),
  });
  if (save) schedulePersist();
}

export const api = {
  execute(command: Command) {
    stopPlayback();
    try {
      useEditor.getState().editor.execute(command);
      publish();
      return true;
    } catch (error) {
      notify((error as Error).message);
      return false;
    }
  },
  begin(message: string) {
    stopPlayback();
    cancelPendingPersist();
    selectionBeforeTransaction = useEditor.getState().selected;
    setTransactionActive(true);
    useEditor.getState().editor.begin(message);
  },
  preview(commands: Command[]) {
    try {
      useEditor.getState().editor.preview(commands);
      publish(false);
    } catch (error) {
      notify((error as Error).message);
    }
  },
  end() {
    useEditor.getState().editor.end();
    setTransactionActive(false);
    selectionBeforeTransaction = undefined;
    publish();
  },
  cancel() {
    useEditor.getState().editor.cancel();
    setTransactionActive(false);
    publish();
    const selected = selectionBeforeTransaction;
    selectionBeforeTransaction = undefined;
    if (selected && findClip(useEditor.getState().project, selected))
      useEditor.setState({ selected });
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
    onHistoryRestored();
  },
  restore(commitId: string) {
    stopPlayback();
    useEditor.getState().editor.restore(commitId);
    publish();
    onHistoryRestored();
  },
  importBranch(repository: Repository, name: string) {
    useEditor.getState().editor.importBranch(repository, name);
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
    const project = useEditor.getState().project;
    const requestedTrack = trackId
      ? project.tracks.find((track) => track.id === trackId)
      : undefined;
    if (trackId && !requestedTrack) {
      notify('トラックが見つかりません');
      return '';
    }
    if (requestedTrack?.locked) {
      notify('トラックがロックされています');
      return '';
    }
    const track =
      requestedTrack ||
      project.tracks.find(
        (candidate) => candidate.type === type && !candidate.locked,
      );
    const clip = makeClip(
      project,
      type,
      startFrame ?? useEditor.getState().frame,
      asset,
    );
    if (type === 'caption') {
      clip.transform.y.defaultValue = project.height * 0.84;
      clip.style.size = 54;
      clip.style.strokeWidth = 3;
    }
    api.begin('クリップを追加');
    const target =
      track || makeTrack(type, `トラック ${project.tracks.length + 1}`);
    if (!track) api.execute({ type: 'track.add', track: target });
    if (!trackId && asset && track)
      clip.startFrame = Math.max(
        clip.startFrame,
        ...track.clips.map(
          (candidate) => candidate.startFrame + candidate.durationFrames,
        ),
      );
    api.execute({ type: 'clip.add', trackId: target.id, clip });
    api.end();
    api.select(clip.id);
    useEditor.setState({ frame: clip.startFrame });
    return clip.id;
  },
};

export const createAssetId = id;
