import { describe, it, expect } from 'vitest';
import { makeProject, makeClip, type Asset } from '../src/core/model';
import { Editor } from '../src/core/history';
import { historyLog, isCheckpoint } from '../src/core/history-log';

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
  const e = new Editor(p);
  const move = (startFrame: number) => {
    e.execute({ type: 'clip.move', clipId: c.id, startFrame });
    return e.repository.head;
  };
  return { e, c, move };
}
const ids = (commits: { id: string }[]) => commits.map((c) => c.id);

describe('historyLog', () => {
  it('puts every edit in changes when nothing has been recorded', () => {
    const { e, move } = fixture();
    const root = e.repository.head;
    const a = move(10);
    const b = move(20);
    const log = historyLog(e.repository);
    expect(ids(log.changes)).toEqual([b, a]);
    expect(ids(log.entries.map((x) => x.commit))).toEqual([root]);
    expect(log.entries[0].edits).toEqual([]);
  });

  it('groups edits under the record that follows them', () => {
    const { e, move } = fixture();
    const root = e.repository.head;
    const a = move(10);
    e.snapshot('ラフ完成');
    const record = e.repository.head;
    const b = move(20);
    const log = historyLog(e.repository);
    expect(ids(log.changes)).toEqual([b]);
    expect(ids(log.entries.map((x) => x.commit))).toEqual([record, root]);
    expect(ids(log.entries[0].edits)).toEqual([a]);
    expect(log.entries[0].commit.message).toBe('ラフ完成');
  });

  it('does not treat automatic snapshots or restores as records', () => {
    const { e, c, move } = fixture();
    for (let i = 1; i <= 25; i++) move(i);
    const auto = Object.values(e.repository.commits).find(
      (x) => x.snapshot && x.operations.length,
    );
    expect(auto).toBeTruthy();
    expect(isCheckpoint(auto!)).toBe(false);
    e.snapshot('保存点');
    const saved = e.repository.head;
    e.execute({ type: 'clip.delete', clipId: c.id });
    e.restore(saved);
    const log = historyLog(e.repository);
    expect(log.changes).toHaveLength(2);
    expect(log.entries[0].commit.id).toBe(saved);
    expect(log.entries[0].edits).toHaveLength(25);
  });

  it('shows only the active branch and badges branch heads', () => {
    const { e, move } = fixture();
    const main = e.repository.activeBranch;
    move(10);
    e.snapshot('main の記録');
    const mainRecord = e.repository.head;
    const alt = e.branch('別案');
    move(20);
    e.snapshot('別案の記録');
    const altRecord = e.repository.head;

    let log = historyLog(e.repository);
    expect(ids(log.entries.map((x) => x.commit)).slice(0, 2)).toEqual([
      altRecord,
      mainRecord,
    ]);
    expect(log.entries[0].branches.map((b) => b.id)).toEqual([alt.id]);
    expect(log.entries[1].branches.map((b) => b.id)).toEqual([main]);

    e.checkout(main);
    log = historyLog(e.repository);
    expect(log.entries[0].commit.id).toBe(mainRecord);
    expect(log.entries.some((x) => x.commit.id === altRecord)).toBe(false);
  });

  it('hides undone edits ahead of the current position', () => {
    const { e, move } = fixture();
    const a = move(10);
    move(20);
    e.undo();
    expect(ids(historyLog(e.repository).changes)).toEqual([a]);
  });
});
