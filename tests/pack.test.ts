import { describe, it, expect } from 'vitest';
import { makeProject } from '../src/core/model';
import { Editor } from '../src/core/history';
import { serializePack, parsePack } from '../src/core/pack';
describe('history packs', () => {
  it('round-trips commits and branches in one NDJSON pack', () => {
    const e = new Editor(makeProject());
    e.execute({ type: 'project.update', patch: { name: 'Pack test' } });
    e.branch('別案');
    e.snapshot();
    const packed = serializePack(e.repository);
    expect(packed.trim().split('\n')).toHaveLength(
      Object.keys(e.repository.commits).length + 1,
    );
    expect(parsePack(packed)).toEqual(e.repository);
  });
  it('continues to read JSON repositories and rejects invalid records', () => {
    const e = new Editor(makeProject());
    expect(parsePack(JSON.stringify(e.repository))).toEqual(e.repository);
    expect(() => parsePack('{"kind":"bad"}\n{"kind":"commit"}')).toThrow();
  });
});
