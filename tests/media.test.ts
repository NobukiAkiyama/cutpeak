import { describe, it, expect, vi, afterEach } from 'vitest';
import { MediaEngine, Lru, retimeAudio } from '../src/media/engine';
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
  afterEach(() => vi.unstubAllGlobals());

  it('retimes audio samples to match clip speed', () => {
    const source = [
      new Float32Array([0, 1, 2, 3, 4]),
      new Float32Array([0, 1, 2, 3, 4]),
    ];
    expect([...retimeAudio(source, 3, 2)[0]]).toEqual([0, 2, 4]);
    expect([...retimeAudio(source, 5, 0.5)[0]]).toEqual([0, 0.5, 1, 1.5, 2]);
  });

  it('decodes animated GIF frames and follows their timing', async () => {
    const decodedFrames = [
      {
        timestamp: 0,
        duration: 500_000,
        displayWidth: 2,
        displayHeight: 1,
        close: vi.fn(),
      },
      {
        timestamp: 500_000,
        duration: 500_000,
        displayWidth: 2,
        displayHeight: 1,
        close: vi.fn(),
      },
    ];
    const decode = vi.fn(async ({ frameIndex }: { frameIndex: number }) => ({
      image: decodedFrames[frameIndex],
    }));
    class FakeImageDecoder {
      tracks = {
        ready: Promise.resolve(),
        selectedTrack: { frameCount: 2 },
      };
      decode = decode;
      close = vi.fn();
      constructor(_init: ImageDecoderInit) {}
    }
    vi.stubGlobal('ImageDecoder', FakeImageDecoder);
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ width: 2, height: 1, close: vi.fn() })),
    );

    const e = new MediaEngine();
    await e.register(
      'gif',
      new File(['gif'], 'anim.gif', { type: 'image/gif' }),
    );
    await e.frame('gif', 600_000, 2);
    expect(decode.mock.calls.at(-1)?.[0]).toMatchObject({ frameIndex: 1 });
    await e.frame('gif', 1_100_000, 2);
    expect(decode.mock.calls.at(-1)?.[0]).toMatchObject({ frameIndex: 0 });
    e.dispose();
  });

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
  it('decodes padding around requested audio to preserve codec history', async () => {
    const samples = vi.fn(async function* (start: number, end: number) {
      expect(start).toBeCloseTo(9.9);
      expect(end).toBeCloseTo(10.6);
      if (start > end) yield undefined;
    });
    const e = new MediaEngine();
    (
      e as unknown as {
        entries: Map<string, unknown>;
      }
    ).entries.set('compressed', {
      file: new File([], 'compressed.m4a', { type: 'audio/mp4' }),
      audio: { getFirstTimestamp: async () => 0 },
      audioSink: { samples },
      canvases: new Map(),
      firstTimestamp: 0,
      duration: 20,
    });
    await e.audioRange('compressed', 10, 0.5);
    expect(samples).toHaveBeenCalledOnce();
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
  it('uses a detailed waveform by default', async () => {
    const e = new MediaEngine();
    await e.register('tone', wav());
    expect(await e.waveform('tone')).toHaveLength(320);
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
  it('limits summed audio without hard clipping', async () => {
    const e = new MediaEngine();
    await e.register('tone', wav());
    const p = makeProject();
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
    for (let i = 0; i < 2; i++) {
      const c = makeClip(p, 'audio', 0, a);
      c.volumeDb = 6;
      p.tracks[2].clips.push(c);
    }
    const mixed = await e.mix(p, 0, 0.1);
    expect(Math.max(...mixed[0])).toBeLessThanOrEqual(0.9801);
    expect(Math.min(...mixed[0])).toBeGreaterThanOrEqual(-0.9801);
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
