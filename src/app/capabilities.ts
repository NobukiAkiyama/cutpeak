export interface CapabilityProfile {
  secureContext: boolean;
  crossOriginIsolated: boolean;
  sharedArrayBuffer: boolean;
  webCodecs: {
    videoDecoder: boolean;
    videoEncoder: boolean;
    audioDecoder: boolean;
    audioEncoder: boolean;
  };
  codecs: {
    h264Decode: boolean;
    h264Encode: boolean;
    vp9Decode: boolean;
    vp9Encode: boolean;
    aacDecode: boolean;
    aacEncode: boolean;
    opusDecode: boolean;
    opusEncode: boolean;
  };
  graphics: {
    webgl2: boolean;
    offscreenCanvas: boolean;
    workerRendering: boolean;
  };
  storage: {
    opfs: boolean;
    persistentStorage: boolean;
    fileSystemAccess: boolean;
  };
  audio: { webAudio: boolean; audioWorklet: boolean };
  pwa: { serviceWorker: boolean };
  hardwareEncoder: boolean;
  usage: number;
  quota: number;
}
export function videoConfig(
  format: 'mp4' | 'webm',
  width: number,
  height: number,
  rate: number,
  bitrate: number,
): VideoEncoderConfig {
  const large = width * height > 1920 * 1088;
  const level = large ? (rate > 30 ? '34' : '33') : rate > 30 ? '2a' : '28';
  return {
    codec: format === 'mp4' ? `avc1.6400${level}` : 'vp09.00.10.08',
    width,
    height,
    framerate: rate,
    bitrate,
    latencyMode: 'quality',
    ...(format === 'mp4' ? { avc: { format: 'avc' as const } } : {}),
  };
}
export async function findVideoConfig(
  format: 'mp4' | 'webm',
  width: number,
  height: number,
  rate: number,
  bitrate: number,
): Promise<VideoEncoderConfig | null> {
  if (typeof VideoEncoder === 'undefined') return null;
  const base = videoConfig(format, width, height, rate, bitrate);
  const codecs =
    format === 'mp4'
      ? [
          base.codec,
          base.codec.replace('6400', '4d00'),
          base.codec.replace('6400', '4200'),
        ]
      : [base.codec];
  for (const codec of codecs) {
    try {
      const candidate = { ...base, codec };
      if ((await VideoEncoder.isConfigSupported(candidate)).supported)
        return candidate;
    } catch {}
  }
  return null;
}
export async function probeExport(
  format: 'mp4' | 'webm',
  width: number,
  height: number,
  rate: number,
  bitrate: number,
  hasAudio: boolean,
) {
  try {
    if (typeof VideoEncoder === 'undefined') return false;
    if (!(await findVideoConfig(format, width, height, rate, bitrate)))
      return false;
    if (hasAudio) {
      if (typeof AudioEncoder === 'undefined') return false;
      const a = await AudioEncoder.isConfigSupported({
        codec: format === 'mp4' ? 'mp4a.40.2' : 'opus',
        sampleRate: 48000,
        numberOfChannels: 2,
        bitrate: 192000,
      });
      if (!a.supported) return false;
    }
    return true;
  } catch {
    return false;
  }
}
const safe = async (fn: () => Promise<{ supported?: boolean }>) => {
  try {
    return !!(await fn()).supported;
  } catch {
    return false;
  }
};
export async function detectCapabilities(): Promise<CapabilityProfile> {
  const vd = typeof VideoDecoder !== 'undefined',
    ve = typeof VideoEncoder !== 'undefined',
    ad = typeof AudioDecoder !== 'undefined',
    ae = typeof AudioEncoder !== 'undefined';
  const canvas = document.createElement('canvas'),
    gl = canvas.getContext('webgl2');
  const webgl2 = !!gl;
  gl?.getExtension('WEBGL_lose_context')?.loseContext();
  let opfs = false;
  try {
    opfs = !!(await navigator.storage?.getDirectory());
  } catch {}
  const estimate: StorageEstimate =
    (await navigator.storage?.estimate().catch(() => ({}))) || {};
  const [
    h264Decode,
    vp9Decode,
    aacDecode,
    opusDecode,
    h264Encode,
    vp9Encode,
    aacEncode,
    opusEncode,
    hardwareEncoder,
  ] = await Promise.all([
    safe(() =>
      VideoDecoder.isConfigSupported({
        codec: 'avc1.640028',
        codedWidth: 1920,
        codedHeight: 1080,
      }),
    ),
    safe(() =>
      VideoDecoder.isConfigSupported({
        codec: 'vp09.00.10.08',
        codedWidth: 1920,
        codedHeight: 1080,
      }),
    ),
    safe(() =>
      AudioDecoder.isConfigSupported({
        codec: 'mp4a.40.2',
        sampleRate: 48000,
        numberOfChannels: 2,
      }),
    ),
    safe(() =>
      AudioDecoder.isConfigSupported({
        codec: 'opus',
        sampleRate: 48000,
        numberOfChannels: 2,
      }),
    ),
    probeExport('mp4', 1920, 1080, 30, 12e6, false),
    probeExport('webm', 1920, 1080, 30, 12e6, false),
    safe(() =>
      AudioEncoder.isConfigSupported({
        codec: 'mp4a.40.2',
        sampleRate: 48000,
        numberOfChannels: 2,
        bitrate: 192000,
      }),
    ),
    safe(() =>
      AudioEncoder.isConfigSupported({
        codec: 'opus',
        sampleRate: 48000,
        numberOfChannels: 2,
        bitrate: 192000,
      }),
    ),
    safe(() =>
      VideoEncoder.isConfigSupported({
        ...videoConfig('mp4', 1920, 1080, 30, 12e6),
        hardwareAcceleration: 'prefer-hardware',
      }),
    ),
  ]);
  return {
    secureContext: isSecureContext,
    crossOriginIsolated: globalThis.crossOriginIsolated === true,
    sharedArrayBuffer:
      globalThis.crossOriginIsolated === true &&
      typeof SharedArrayBuffer !== 'undefined',
    webCodecs: {
      videoDecoder: vd,
      videoEncoder: ve,
      audioDecoder: ad,
      audioEncoder: ae,
    },
    codecs: {
      h264Decode,
      vp9Decode,
      aacDecode,
      opusDecode,
      h264Encode,
      vp9Encode,
      aacEncode,
      opusEncode,
    },
    graphics: {
      webgl2,
      offscreenCanvas: typeof OffscreenCanvas !== 'undefined',
      workerRendering:
        typeof OffscreenCanvas !== 'undefined' &&
        'transferControlToOffscreen' in canvas,
    },
    storage: {
      opfs,
      persistentStorage:
        (await navigator.storage?.persisted().catch(() => false)) || false,
      fileSystemAccess: 'showSaveFilePicker' in window,
    },
    audio: {
      webAudio: typeof AudioContext !== 'undefined',
      audioWorklet: typeof AudioWorkletNode !== 'undefined',
    },
    pwa: { serviceWorker: 'serviceWorker' in navigator },
    hardwareEncoder,
    usage: estimate.usage || 0,
    quota: estimate.quota || 0,
  };
}
