import { expect, it } from 'vitest';
import { makeProject, makeClip, frameToUs } from '../src/core/model';
import { Editor } from '../src/core/history';

function setup() {
  const project = makeProject();
  const a = makeClip(project, 'text', 0);
  const b = makeClip(project, 'text', 100);
  a.durationFrames = b.durationFrames = 100;
  project.tracks[0].clips = [a, b];
  return { editor: new Editor(project), a, b };
}

it('pushes the right neighbour, preserves its end and restores on drag back / undo', () => {
  const { editor, a, b } = setup();
  editor.begin('move');
  editor.preview([{ type: 'clip.move', clipId: a.id, startFrame: 30 }]);
  expect(editor.project.tracks[0].clips[1]).toMatchObject({
    startFrame: 130,
    durationFrames: 70,
    sourceInUs: frameToUs(30, editor.project),
  });
  editor.preview([{ type: 'clip.move', clipId: a.id, startFrame: 0 }]);
  expect(editor.project.tracks[0].clips[1]).toEqual(b);
  editor.preview([{ type: 'clip.move', clipId: a.id, startFrame: 30 }]);
  editor.end();
  editor.undo();
  expect(editor.project.tracks[0].clips).toEqual([a, b]);
});

it('shrinks a left neighbour without changing its source start', () => {
  const { editor, b } = setup();
  editor.execute({ type: 'clip.move', clipId: b.id, startFrame: 70 });
  expect(editor.project.tracks[0].clips[0]).toMatchObject({
    startFrame: 0,
    durationFrames: 70,
    sourceInUs: 0,
  });
});

it('stops at one frame instead of overlapping or deleting the right neighbour', () => {
  const { editor, a } = setup();
  editor.execute({ type: 'clip.move', clipId: a.id, startFrame: 250 });
  expect(
    editor.project.tracks[0].clips.map((c) => [c.startFrame, c.durationFrames]),
  ).toEqual([
    [99, 100],
    [199, 1],
  ]);
});

it('stops at one frame when pushing left', () => {
  const { editor, b } = setup();
  editor.execute({ type: 'clip.move', clipId: b.id, startFrame: 0 });
  expect(
    editor.project.tracks[0].clips.map((c) => [c.startFrame, c.durationFrames]),
  ).toEqual([
    [0, 1],
    [1, 100],
  ]);
});
