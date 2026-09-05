import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  probeExport,
  findVideoConfig,
  videoConfig,
} from '../src/app/capabilities';
afterEach(() => vi.unstubAllGlobals());
describe('export gates', () => {
  it('disallows audible MP4 when AAC is unavailable', async () => {
    vi.stubGlobal('VideoEncoder', {
      isConfigSupported: async () => ({ supported: true }),
    });
    vi.stubGlobal('AudioEncoder', {
      isConfigSupported: async (c: { codec: string }) => ({
        supported: c.codec === 'opus',
      }),
    });
    expect(await probeExport('mp4', 1920, 1080, 30, 12e6, true)).toBe(false);
    expect(await probeExport('mp4', 1920, 1080, 30, 12e6, false)).toBe(true);
    expect(await probeExport('webm', 1920, 1080, 30, 12e6, true)).toBe(true);
  });
  it('probes the actual dimensions and falls back to an available H.264 profile', async () => {
    const probe = vi.fn(async (c: { codec: string; width: number }) => ({
      supported: c.codec.startsWith('avc1.4d') && c.width === 1280,
    }));
    vi.stubGlobal('VideoEncoder', { isConfigSupported: probe });
    expect((await findVideoConfig('mp4', 1280, 720, 30, 6e6))?.codec).toMatch(
      /^avc1.4d/,
    );
    expect(await findVideoConfig('mp4', 3840, 2160, 30, 30e6)).toBeNull();
  });
  it('chooses a suitable AVC level for 1080p60 and 4K60', () => {
    expect(videoConfig('mp4', 1920, 1080, 60, 16e6).codec).toBe('avc1.64002a');
    expect(videoConfig('mp4', 3840, 2160, 60, 40e6).codec).toBe('avc1.640034');
  });
  it('fails closed if encoder APIs throw or are absent', async () => {
    vi.stubGlobal('VideoEncoder', undefined);
    expect(await probeExport('mp4', 1920, 1080, 30, 12e6, false)).toBe(false);
    vi.stubGlobal('VideoEncoder', {
      isConfigSupported: async () => {
        throw Error('unsupported');
      },
    });
    expect(await probeExport('webm', 1920, 1080, 30, 12e6, false)).toBe(false);
  });
});
