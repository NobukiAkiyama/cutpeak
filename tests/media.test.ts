import { describe, it, expect } from 'vitest';
import { MediaEngine, Lru } from '../src/media/engine';
import { makeProject, makeClip, type Asset } from '../src/core/model';
function wav(rate = 48000, seconds = 1) {
  const frames = rate * seconds,
    buffer = new ArrayBuffer(44 + frames * 2),
    v = new DataView(buffer);
  const str = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  v.setUint32(4, buffer.byteLength - 8, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, frames * 2, true);
  for (let i = 0; i < frames; i++)
    v.setInt16(
      44 + i * 2,
      Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 16000),
      true,
    );
  return new File([buffer], 'tone.wav', { type: 'audio/wav' });
}
describe('media decoding and audio mixing', () => {
  it('demuxes and decodes PCM WAV without WASM or AudioDecoder', async () => {
    const e = new MediaEngine();
    await e.register('tone', wav());
    const channels = await e.audioRange('tone', 0, 0.1);
    expect(channels).toHaveLength(2);
    expect(channels[0]).toHaveLength(4800);
    expect(Math.max(...channels[0])).toBeCloseTo(16000 / 32768, 3);
    expect(channels[1]).toEqual(channels[0]);
    e.dispose();
  });
  it('seeks to a source offset and resamples from 44.1 kHz', async () => {
    const e = new MediaEngine();
    await e.register('tone', wav(44100));
    const ch = await e.audioRange('tone', 0.25, 0.25);
    expect(ch[0].length).toBe(12000);
    expect(ch[0][1200]).toBeCloseTo(
      (Math.sin(2 * Math.PI * 440 * 0.275) * 16000) / 32768,
      2,
    );
    e.dispose();
  });
  it('generates an actual waveform from sample peaks', async () => {
    const e = new MediaEngine();
    await e.register('tone', wav());
    const peaks = await e.waveform('tone', 40);
    expect(peaks).toHaveLength(40);
    expect(peaks.every((v) => v > 0.4 && v < 0.5)).toBe(true);
    e.dispose();
  });
  it('mixes overlapping tracks, applies gain and preserves silence', async () => {
    const e = new MediaEngine(),
      p = makeProject();
    await e.register('tone', wav());
    const a: Asset = {
      id: 'tone',
      name: 'tone.wav',
      kind: 'audio',
      mime: 'audio/wav',
      size: 96044,
      durationUs: 1e6,
      firstTimestampUs: 0,
      width: 0,
      height: 0,
      hasAudio: true,
    };
    p.assets.push(a);
    const c = makeClip(p, 'audio', 15, a);
    c.volumeDb = -6;
    p.tracks[2].clips.push(c);
    const ch = await e.mix(p, 0, 1);
    expect(ch[0].slice(0, 24000).every((v) => v === 0)).toBe(true);
    expect(Math.max(...ch[0])).toBeCloseTo(
      (16000 / 32768) * 10 ** (-6 / 20),
      3,
    );
    p.tracks[2].muted = true;
    expect((await e.mix(p, 0, 1))[0].every((v) => v === 0)).toBe(true);
    e.dispose();
  });
  it('closes least recently used frames and keeps recently accessed entries', () => {
    const closed: number[] = [];
    const cache = new Lru<number>(2, (n) => closed.push(n));
    cache.set('a', 1);
    cache.set('b', 2);
    cache.get('a');
    cache.set('c', 3);
    expect(closed).toEqual([2]);
    expect(cache.get('a')).toBe(1);
    cache.clear();
    expect(closed.sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });
});
