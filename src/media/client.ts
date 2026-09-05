import type { Asset, Project } from '../core/model';
interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}
export class WorkerRpc {
  private serial = 0;
  private pending = new Map<number, Pending>();
  constructor(readonly worker: Worker) {
    worker.onmessage = ({ data }) => {
      const p = this.pending.get(data.id);
      if (p) {
        this.pending.delete(data.id);
        clearTimeout(p.timer);
        if (data.error) p.reject(Error(data.error));
        else p.resolve(data.value);
      } else if (Array.isArray(data.value)) {
        for (const item of data.value)
          if (item?.bitmap instanceof ImageBitmap) item.bitmap.close();
      }
    };
    worker.onerror = (e) => {
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.reject(Error(e.message || 'Workerが停止しました'));
      }
      this.pending.clear();
    };
  }
  call<T>(
    type: string,
    args: unknown,
    transfer: Transferable[] = [],
  ): Promise<T> {
    const id = ++this.serial;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(Error('処理がタイムアウトしました'));
      }, 180000);
      this.pending.set(id, { resolve: (v) => resolve(v as T), reject, timer });
      try {
        this.worker.postMessage({ id, type, args }, transfer);
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(e);
      }
    });
  }
  dispose() {
    this.worker.terminate();
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(Error('処理を終了しました'));
    }
    this.pending.clear();
  }
}
export class MediaClient {
  private rpc?: WorkerRpc;
  private fallback?: Promise<import('./engine').MediaEngine>;
  constructor() {
    try {
      if (typeof OffscreenCanvas !== 'undefined')
        this.rpc = new WorkerRpc(
          new Worker(new URL('../workers/media.worker.ts', import.meta.url), {
            type: 'module',
          }),
        );
    } catch {}
    if (!this.rpc)
      this.fallback = import('./engine').then(
        ({ MediaEngine }) => new MediaEngine(),
      );
  }
  async register(assetId: string, file: File) {
    if (this.rpc) return this.rpc.call<Asset>('register', { assetId, file });
    const engine = await this.fallback!;
    await engine.register(assetId, file);
    return engine.metadata(assetId);
  }
  async waveform(assetId: string) {
    if (this.rpc) return this.rpc.call<number[]>('waveform', { assetId });
    return (await this.fallback!).waveform(assetId);
  }
  async frames(project: Project, frame: number, width: number) {
    if (this.rpc)
      return this.rpc.call<{ clipId: string; bitmap: ImageBitmap }[]>(
        'frames',
        {
          project,
          frame,
          width,
        },
      );
    return (await this.fallback!).sceneFrames(project, frame, width);
  }
  async mix(project: Project, start: number, duration: number) {
    if (this.rpc)
      return this.rpc.call<Float32Array[]>('mix', { project, start, duration });
    return (await this.fallback!).mix(project, start, duration);
  }
  dispose() {
    this.rpc?.dispose();
    void this.fallback?.then((e) => e.dispose());
  }
}
