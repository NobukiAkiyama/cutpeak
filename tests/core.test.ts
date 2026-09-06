import { describe, it, expect } from 'vitest';
import {
  makeProject,
  makeClip,
  makeTrack,
  findClip,
  frameToUs,
  fps,
  validateProject,
  clone,
  type Asset,
} from '../src/core/model';
import { Editor, validateRepository, syncState } from '../src/core/history';
import { applyCommand } from '../src/core/commands';
import {
  evaluate,
  parseSrt,
  sceneAt,
  snapFrame,
  audioGain,
} from '../src/core/timeline';
function fixture() {
  const p = makeProject();
  const asset: Asset = {
    id: crypto.randomUUID(),
    name: 'sample.mp4',
    kind: 'video',
    mime: 'video/mp4',
    size: 1000,
    durationUs: 10e6,
    firstTimestampUs: 0,
    width: 1920,
    height: 1080,
    hasAudio: true,
  };
  p.assets.push(asset);
  const c = makeClip(p, 'video', 0, asset);
  p.tracks[1].clips.push(c);
  return { p, c, asset, e: new Editor(p) };
}
describe('non-destructive commands', () => {
  it('splits source time without modifying the input or bytes', () => {
    const { p, c } = fixture();
    const before = clone(p);
    const result = applyCommand(p, {
      type: 'clip.split',
      clipId: c.id,
      frame: 90,
    })!;
    expect(p).toEqual(before);
    const clips = result.project.tracks[1].clips;
    expect(
      clips.map((c) => [c.startFrame, c.durationFrames, c.sourceInUs]),
    ).toEqual([
      [0, 90, 0],
      [90, 210, 3e6],
    ]);
    expect(clips[0].assetId).toBe(clips[1].assetId);
  });
  it('does not create zero-length boundary splits', () => {
    const { p, c } = fixture();
    expect(
      applyCommand(p, { type: 'clip.split', clipId: c.id, frame: 0 }),
    ).toBeNull();
    expect(
      applyCommand(p, { type: 'clip.split', clipId: c.id, frame: 300 }),
    ).toBeNull();
  });
  it('trims the source in point and duration', () => {
    const { p, c } = fixture();
    const result = applyCommand(p, {
      type: 'clip.trim',
      clipId: c.id,
      startFrame: 60,
      durationFrames: 180,
      sourceInUs: 2e6,
    })!;
    expect(findClip(result.project, c.id)!.clip.sourceInUs).toBe(2e6);
  });
  it('rejects trim beyond source end atomically', () => {
    const { e, c } = fixture();
    const before = clone(e.project);
    expect(() =>
      e.execute({
        type: 'clip.trim',
        clipId: c.id,
        startFrame: 0,
        durationFrames: 400,
        sourceInUs: 0,
      }),
    ).toThrow('素材');
    expect(e.project).toEqual(before);
  });
  it('allows a GIF clip to extend beyond its intrinsic animation length', () => {
    const { p, c, asset } = fixture();
    asset.videoCodec = 'gif';
    c.type = 'video';
    expect(() =>
      applyCommand(p, {
        type: 'clip.trim',
        clipId: c.id,
        startFrame: 0,
        durationFrames: 600,
        sourceInUs: 0,
      }),
    ).not.toThrow();
  });
  it('respects track locks for destructive changes', () => {
    const { p, c } = fixture();
    p.tracks[1].locked = true;
    for (const type of ['clip.delete', 'clip.duplicate'] as const)
      expect(() => applyCommand(p, { type, clipId: c.id })).toThrow('ロック');
  });
  it('moves clips between tracks regardless of media type', () => {
    const { p, c } = fixture();
    const t = makeTrack('audio');
    p.tracks.push(t);
    const r = applyCommand(p, {
      type: 'clip.move',
      clipId: c.id,
      startFrame: 41,
      trackId: t.id,
    })!;
    expect(r.project.tracks[1].clips).toHaveLength(0);
    expect(r.project.tracks.at(-1)!.clips[0].startFrame).toBe(41);
  });
  it('adds clips to tracks regardless of media type', () => {
    const { p } = fixture();
    const text = makeClip(p, 'text');
    const result = applyCommand(p, {
      type: 'clip.add',
      trackId: p.tracks[2].id,
      clip: text,
    })!;
    expect(result.project.tracks[2].clips.at(-1)?.id).toBe(text.id);
  });
  it('duplicates with new identity and shared asset', () => {
    const { p, c } = fixture();
    const r = applyCommand(p, { type: 'clip.duplicate', clipId: c.id })!;
    const copy = r.project.tracks[1].clips[1];
    expect(copy.id).not.toBe(c.id);
    expect(copy.assetId).toBe(c.assetId);
    expect(copy.startFrame).toBe(300);
  });
  it('produces semantic changes', () => {
    const { p, c } = fixture();
    const r = applyCommand(p, {
      type: 'clip.update',
      clipId: c.id,
      patch: { volumeDb: -12 },
    })!;
    expect(r.operation.description).toContain('音量 dB: 0 → -12');
  });
});
describe('history DAG', () => {
  it('groups a continuous drag into one undo entry', () => {
    const { e, c } = fixture();
    e.begin('移動');
    for (let i = 1; i <= 20; i++)
      e.execute({ type: 'clip.move', clipId: c.id, startFrame: i });
    e.end();
    expect(Object.keys(e.repository.commits)).toHaveLength(2);
    expect(e.project.tracks[1].clips[0].startFrame).toBe(20);
    e.undo();
    expect(e.project.tracks[1].clips[0].startFrame).toBe(0);
    e.redo();
    expect(e.project.tracks[1].clips[0].startFrame).toBe(20);
  });
  it('cancels a gesture without writing a commit', () => {
    const { e, c, p } = fixture();
    e.begin('移動');
    e.execute({ type: 'clip.delete', clipId: c.id });
    e.cancel();
    expect(e.project).toEqual(p);
    expect(Object.keys(e.repository.commits)).toHaveLength(1);
  });
  it('preserves old future when editing after undo', () => {
    const { e, c } = fixture();
    e.execute({ type: 'clip.move', clipId: c.id, startFrame: 30 });
    const oldHead = e.repository.head;
    e.undo();
    e.execute({ type: 'clip.move', clipId: c.id, startFrame: 60 });
    expect(e.repository.branches).toHaveLength(2);
    expect(e.repository.branches[0].head).toBe(oldHead);
    expect(
      e.repository.commits[oldHead].project.tracks[1].clips[0].startFrame,
    ).toBe(30);
  });
  it('restores a snapshot as a new reversible commit', () => {
    const { e, c } = fixture();
    e.snapshot('保存点');
    const saved = e.repository.head;
    e.execute({ type: 'clip.delete', clipId: c.id });
    e.restore(saved);
    expect(findClip(e.project, c.id)).toBeTruthy();
    e.undo();
    expect(findClip(e.project, c.id)).toBeUndefined();
  });
  it('branch checkout restores the correct scene', () => {
    const { e, c } = fixture();
    const main = e.repository.activeBranch;
    const alt = e.branch('別案');
    e.execute({ type: 'clip.move', clipId: c.id, startFrame: 100 });
    e.checkout(main);
    expect(e.project.tracks[1].clips[0].startFrame).toBe(0);
    e.checkout(alt.id);
    expect(e.project.tracks[1].clips[0].startFrame).toBe(100);
  });
  it('rehydrates the exact repository HEAD', () => {
    const { e, c } = fixture();
    e.execute({ type: 'clip.move', clipId: c.id, startFrame: 22 });
    const repo = JSON.parse(JSON.stringify(e.repository));
    validateRepository(repo);
    const restored = new Editor(e.project, repo);
    restored.undo();
    expect(restored.project.tracks[1].clips[0].startFrame).toBe(0);
  });
  it('gesture previews can trim forward then back without losing keys', () => {
    const { e, c } = fixture();
    e.execute({
      type: 'clip.transform',
      clipId: c.id,
      key: 'x',
      frame: 0,
      value: 0,
    });
    e.execute({
      type: 'clip.transform',
      clipId: c.id,
      key: 'x',
      frame: 150,
      value: 500,
    });
    e.begin('trim');
    e.preview([
      {
        type: 'clip.trim',
        clipId: c.id,
        startFrame: 60,
        durationFrames: 240,
        sourceInUs: 2e6,
      },
    ]);
    e.preview([
      {
        type: 'clip.trim',
        clipId: c.id,
        startFrame: 0,
        durationFrames: 300,
        sourceInUs: 0,
      },
    ]);
    e.end();
    expect(
      findClip(e.project, c.id)!.clip.transform.x.keyframes.map((k) => [
        k.frame,
        k.value,
      ]),
    ).toEqual([
      [0, 0],
      [150, 500],
    ]);
  });
});
describe('time, animation and captions', () => {
  it('uses rational frame to microsecond conversion for NTSC', () => {
    const p = makeProject('ntsc', 1920, 1080, {
      numerator: 30000,
      denominator: 1001,
    });
    expect(frameToUs(30000, p)).toBe(1001000000);
    expect(fps(p)).toBeCloseTo(29.97002997);
  });
  it('evaluates all easing styles and clamps endpoints', () => {
    const a = {
      defaultValue: 10,
      keyframes: [
        { frame: 10, value: 0, easing: 'ease-in' as const },
        { frame: 20, value: 100, easing: 'linear' as const },
      ],
    };
    expect(evaluate(a, 0)).toBe(0);
    expect(evaluate(a, 15)).toBe(25);
    expect(evaluate(a, 30)).toBe(100);
  });
  it('preserves linear animation at a split seam', () => {
    const { p, c } = fixture();
    c.transform.x.keyframes = [
      { frame: 0, value: 0, easing: 'linear' },
      { frame: 299, value: 299, easing: 'linear' },
    ];
    const r = applyCommand(p, {
      type: 'clip.split',
      clipId: c.id,
      frame: 120,
    })!;
    const clips = r.project.tracks[1].clips;
    expect(evaluate(clips[0].transform.x, 119)).toBeCloseTo(119);
    expect(evaluate(clips[1].transform.x, 0)).toBeCloseTo(120);
    expect(evaluate(clips[1].transform.x, 50)).toBeCloseTo(170);
  });
  it('parses SRT BOM, CRLF, multiline and comma times', () => {
    const p = makeProject();
    const result = parseSrt(
      '\uFEFF1\r\n00:00:01,000 --> 00:00:02,500\r\nこんにちは\r\n世界\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\n次',
      p,
    );
    expect(result[0]).toEqual({
      startFrame: 30,
      durationFrames: 45,
      text: 'こんにちは\n世界',
    });
    expect(result).toHaveLength(2);
  });
  it('rejects malformed or reversed SRT times', () => {
    const p = makeProject();
    expect(() => parseSrt('1\n00:00:02,000 --> 00:00:01,000\nx', p)).toThrow();
    expect(() => parseSrt('bad input', p)).toThrow();
  });
  it('snaps to boundaries within a pixel-derived tolerance', () => {
    expect(snapFrame(97, [0, 50, 100], 4)).toBe(100);
    expect(snapFrame(94, [0, 50, 100], 4)).toBe(94);
  });
  it('keeps overlay tracks above media and hides tracks', () => {
    const { p } = fixture();
    const c = makeClip(p, 'text');
    p.tracks[0].clips.push(c);
    expect(sceneAt(p, 0).map((i) => i.clip.type)).toEqual(['video', 'text']);
    const [textTrack] = p.tracks.splice(0, 1);
    p.tracks.push(textTrack);
    expect(sceneAt(p, 0).map((i) => i.clip.type)).toEqual(['video', 'text']);
    textTrack.hidden = true;
    expect(sceneAt(p, 0).map((i) => i.clip.type)).toEqual(['video']);
  });
  it('uses half-open clip intervals', () => {
    const { p } = fixture();
    expect(sceneAt(p, 299)).toHaveLength(1);
    expect(sceneAt(p, 300)).toHaveLength(0);
  });
  it('computes audio gain in decibels and bounded fades', () => {
    const { c } = fixture();
    c.volumeDb = -6;
    c.fadeInFrames = 30;
    expect(audioGain(c, 0)).toBe(0);
    expect(audioGain(c, 15)).toBeCloseTo(0.2505936);
    c.fadeOutFrames = 30;
    expect(audioGain(c, 285)).toBeCloseTo(0.2505936);
    c.muted = true;
    expect(audioGain(c, 150)).toBe(0);
  });
});
describe('project validation and sync', () => {
  it('rejects invalid frame values and duplicate ids', () => {
    const { p, c } = fixture();
    c.startFrame = NaN;
    expect(() => validateProject(p)).toThrow();
    c.startFrame = 0;
    p.tracks[1].clips.push(clone(c));
    expect(() => validateProject(p)).toThrow();
  });
  it('rejects zero denominators and unreasonable resolutions', () => {
    const p = makeProject();
    p.fps.denominator = 0;
    expect(() => validateProject(p)).toThrow();
    p.fps.denominator = 1;
    p.width = 99999;
    expect(() => validateProject(p)).toThrow();
  });
  it('rejects broken repository parent references', () => {
    const { e } = fixture();
    e.repository.commits[e.repository.head].parentIds = ['missing'];
    expect(() => validateRepository(e.repository)).toThrow();
  });
  it.each([
    ['a', 'a', 'x', 'equal'],
    ['b', 'a', 'a', 'push'],
    ['a', 'b', 'a', 'pull'],
    ['b', 'c', 'a', 'conflict'],
    ['a', null, null, 'push'],
  ] as const)('classifies sync %s %s %s as %s', (l, r, last, status) =>
    expect(syncState(l, r, last)).toBe(status),
  );
});

describe('eased animation and overlap', () => {
  it('keeps an eased curve identical on both sides of a split', () => {
    const { p, c } = fixture();
    c.transform.x.keyframes = [
      { frame: 0, value: 0, easing: 'ease-in-out' },
      { frame: 299, value: 900, easing: 'linear' },
    ];
    const result = applyCommand(p, {
      type: 'clip.split',
      clipId: c.id,
      frame: 127,
    })!.project;
    const [left, right] = result.tracks[1].clips;
    for (let f = 0; f < 300; f++) {
      expect(
        evaluate(
          f < 127 ? left.transform.x : right.transform.x,
          f < 127 ? f : f - 127,
        ),
      ).toBeCloseTo(evaluate(c.transform.x, f), 8);
    }
  });
  it('cross dissolves an incoming clip over a fully visible outgoing clip', () => {
    const { p, c } = fixture();
    c.durationFrames = 150;
    c.transition = 'dissolve';
    const next = clone(c);
    next.id = crypto.randomUUID();
    next.startFrame = 120;
    next.durationFrames = 150;
    p.tracks[1].clips.push(next);
    const scene = sceneAt(p, 135);
    expect(scene[0].alpha).toBe(1);
    expect(scene[1].alpha).toBeCloseTo(15 / 29);
  });
});
