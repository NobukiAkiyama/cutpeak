import { afterEach, describe, it, expect, vi } from 'vitest';
import { Playback } from '../src/audio/playback';
import { makeProject, makeClip, type Asset } from '../src/core/model';
import type { MediaClient } from '../src/media/client';
afterEach(() => vi.unstubAllGlobals());
describe('playback cancellation', () => {
  it('cancels while the first audio buffer is still being decoded', async () => {
    const resume = vi.fn(async () => {}),
      createBuffer = vi.fn();
    vi.stubGlobal(
      'AudioContext',
      class {
        currentTime = 0;
        destination = {};
        audioWorklet = {
          addModule: async () => {
            throw Error('fallback');
          },
        };
        resume = resume;
        createBuffer = createBuffer;
        close = async () => {};
      },
    );
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.stubGlobal('requestAnimationFrame', vi.fn());
    const p = makeProject();
    const a: Asset = {
      id: 'sound',
      name: 'sound.wav',
      kind: 'audio',
      mime: 'audio/wav',
      size: 1,
      durationUs: 1e6,
      firstTimestampUs: 0,
      width: 0,
      height: 0,
      hasAudio: true,
    };
    p.assets.push(a);
    p.tracks[2].clips.push(makeClip(p, 'audio', 0, a));
    let resolve!: (channels: Float32Array[]) => void;
    const mix = vi.fn(
      () =>
        new Promise<Float32Array[]>((r) => {
          resolve = r;
        }),
    );
    const onFrame = vi.fn(),
      onStop = vi.fn();
    const player = new Playback(
      { mix } as unknown as MediaClient,
      onFrame,
      onStop,
      vi.fn(),
    );
    const pending = player.play(p, 0);
    await vi.waitFor(() => expect(mix).toHaveBeenCalled());
    expect(player.active).toBe(true);
    player.pause();
    resolve([new Float32Array(24000), new Float32Array(24000)]);
    await pending;
    expect(player.active).toBe(false);
    expect(createBuffer).not.toHaveBeenCalled();
    expect(onFrame).not.toHaveBeenCalled();
    expect(onStop).toHaveBeenCalledOnce();
    player.dispose();
  });
});
