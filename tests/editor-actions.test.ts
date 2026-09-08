import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '../src/core/history';
import { makeProject } from '../src/core/model';
import { api } from '../src/app/editor-actions';
import { useEditor } from '../src/app/editor-state';
import { cancelPendingPersist } from '../src/app/persistence-controller';

function resetEditor() {
  const project = makeProject();
  const editor = new Editor(project);
  useEditor.setState({
    editor,
    project: editor.project,
    repository: editor.repository,
    revision: 0,
    selected: null,
    frame: 0,
    saveStatus: 'saved',
    notice: '',
  });
  return editor;
}

afterEach(() => cancelPendingPersist());

describe('editor actions', () => {
  it('publishes a grouped edit as one history entry', () => {
    const editor = resetEditor();

    api.begin('プロジェクト設定を変更');
    api.execute({ type: 'project.update', patch: { name: '編集後' } });
    api.execute({ type: 'project.update', patch: { background: '#ffffff' } });
    api.end();

    const state = useEditor.getState();
    expect(state.project.name).toBe('編集後');
    expect(state.project.background).toBe('#ffffff');
    expect(state.repository).toEqual(editor.repository);
    expect(Object.keys(state.repository.commits)).toHaveLength(2);
    expect(
      state.repository.commits[state.repository.head].operations,
    ).toHaveLength(2);
  });

  it('restores the selection when a transaction is cancelled', () => {
    const editor = resetEditor();
    const clipId = api.addClip('text');
    api.select(clipId);

    api.begin('削除を取り消す');
    api.execute({ type: 'clip.delete', clipId });
    api.cancel();

    expect(useEditor.getState().project).toEqual(editor.project);
    expect(useEditor.getState().selected).toBe(clipId);
  });

  it('clamps seeks to the editable timeline range', () => {
    resetEditor();
    api.addClip('text', undefined, 12);

    api.seek(-100);
    expect(useEditor.getState().frame).toBe(0);
    api.seek(1_000_000);
    expect(useEditor.getState().frame).toBe(161);
  });
});
