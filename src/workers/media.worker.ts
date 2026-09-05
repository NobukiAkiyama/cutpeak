import { MediaEngine } from '../media/engine';
const engine = new MediaEngine();
self.onmessage = async ({ data }) => {
  const { id, type, args } = data;
  try {
    let value: unknown;
    let transfer: Transferable[] = [];
    switch (type) {
      case 'register':
        await engine.register(args.assetId, args.file);
        value = await engine.metadata(args.assetId);
        break;
      case 'waveform':
        value = await engine.waveform(args.assetId);
        break;
      case 'frames':
        value = await engine.sceneFrames(args.project, args.frame, args.width);
        transfer = (value as { bitmap: ImageBitmap }[]).map((v) => v.bitmap);
        break;
      case 'mix':
        {
          const channels = await engine.mix(
            args.project,
            args.start,
            args.duration,
          );
          if (globalThis.crossOriginIsolated && typeof SharedArrayBuffer !== 'undefined') {
            value = channels.map((channel) => {
              const shared = new Float32Array(
                new SharedArrayBuffer(channel.byteLength),
              );
              shared.set(channel);
              return shared;
            });
          } else {
            value = channels;
            transfer = channels.map((channel) => channel.buffer as ArrayBuffer);
          }
        }
        break;
      case 'remove':
        engine.remove(args.assetId);
        break;
      case 'dispose':
        engine.dispose();
        break;
      default:
        throw Error('不明なメディア操作');
    }
    self.postMessage({ id, value }, { transfer });
  } catch (e) {
    self.postMessage({ id, error: (e as Error).message });
  }
};
