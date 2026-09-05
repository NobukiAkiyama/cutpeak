import {
  Output,
  Mp4OutputFormat,
  WebMOutputFormat,
  CanvasSource,
  AudioSampleSource,
  AudioSample,
  BufferTarget,
  StreamTarget,
  Quality,
} from 'mediabunny';
import { MediaEngine } from './engine';
import { SceneRenderer, canvasOf } from '../render/renderer';
import { endFrame, fps, audible, type Project } from '../core/model';
import { probeExport, findVideoConfig } from '../app/capabilities';
export interface ExportJob {
  project: Project;
  files: { id: string; file: File }[];
  format: 'mp4' | 'webm';
  bitrate: number;
  jobId: string;
  outputWidth?: number;
  outputHeight?: number;
}
export async function runExport(
  data: ExportJob,
  onProgress: (value: number) => void,
  isCancelled: () => boolean,
): Promise<{ blob: Blob; path?: string }> {
  const { project: p, files, format, bitrate, jobId } = data;
  const engine = new MediaEngine();
  let renderer: SceneRenderer | undefined,
    output: Output | undefined,
    handle: FileSystemFileHandle | undefined,
    dir: FileSystemDirectoryHandle | undefined,
    writable: FileSystemWritableFileStream | undefined;
  try {
    if (
      !(await probeExport(
        format,
        data.outputWidth || p.width,
        data.outputHeight || p.height,
        fps(p),
        bitrate,
        audible(p),
      ))
    )
      throw Error(
        '選択した解像度・形式のエンコーダーを利用できません。WebM または解像度を変更してください。',
      );
    for (const f of files) await engine.register(f.id, f.file);
    const missing = p.tracks
      .flatMap((t) => t.clips)
      .filter((c) => c.assetId && !files.some((f) => f.id === c.assetId));
    if (missing.length)
      throw Error('未接続の素材があります。再接続してから書き出してください。');
    const canvas = canvasOf(
      data.outputWidth || p.width,
      data.outputHeight || p.height,
    );
    renderer = new SceneRenderer(canvas);
    let target: StreamTarget | BufferTarget;
    try {
      dir = await (
        await navigator.storage.getDirectory()
      ).getDirectoryHandle('framecut-exports', { create: true });
      handle = await dir.getFileHandle(`${jobId}.${format}`, { create: true });
      writable = await handle.createWritable();
      const stream = writable;
      target = new StreamTarget(
        new WritableStream({ write: (chunk) => stream.write(chunk) }),
        { chunked: true, chunkSize: 4 * 1024 * 1024 },
      );
    } catch {
      target = new BufferTarget();
    }
    output = new Output({
      format:
        format === 'mp4'
          ? new Mp4OutputFormat({ fastStart: 'fragmented' })
          : new WebMOutputFormat(),
      target,
    });
    const video = new CanvasSource(canvas, {
      codec: format === 'mp4' ? 'avc' : 'vp9',
      quality: new Quality({ bitrate }),
      fullCodecString: (await findVideoConfig(
        format,
        canvas.width,
        canvas.height,
        fps(p),
        bitrate,
      ))!.codec,
      keyFrameInterval: 2,
    });
    output.addVideoTrack(video, { frameRate: fps(p) });
    const audio = audible(p)
      ? new AudioSampleSource({
          codec: format === 'mp4' ? 'aac' : 'opus',
          quality: new Quality({ bitrate: 192000 }),
        })
      : undefined;
    if (audio) output.addAudioTrack(audio);
    await output.start();
    const total = endFrame(p),
      duration = total / fps(p);
    let audioTime = 0;
    for (let frame = 0; frame < total; frame++) {
      if (isCancelled()) throw Error('書き出しを中止しました');
      const images = await engine.sceneFrames(p, frame, p.width);
      try {
        renderer.draw(p, frame, images);
        await video.add(frame / fps(p), 1 / fps(p));
      } finally {
        images.forEach((i) => i.bitmap.close());
      }
      if (audio && audioTime < duration && audioTime < (frame + 1) / fps(p)) {
        const count = Math.min(
          24000,
          Math.round((duration - audioTime) * 48000),
        );
        if (count > 0) {
          const channels = await engine.mix(p, audioTime, count / 48000);
          const packed = new Float32Array(count * 2);
          packed.set(channels[0]);
          packed.set(channels[1], count);
          const sample = new AudioSample({
            data: packed,
            format: 'f32-planar',
            numberOfChannels: 2,
            sampleRate: 48000,
            timestamp: audioTime,
          });
          try {
            await audio.add(sample);
          } finally {
            sample.close();
          }
          audioTime += count / 48000;
        }
      }
      if (frame % 5 === 0) onProgress((frame + 1) / total);
    }
    video.close();
    audio?.close();
    await output.finalize();
    let blob: Blob;
    if (handle && writable) {
      await writable.close();
      writable = undefined;
      blob = await handle.getFile();
    } else
      blob = new Blob([(target as BufferTarget).buffer!], {
        type: format === 'mp4' ? 'video/mp4' : 'video/webm',
      });
    return { blob, path: handle ? `${jobId}.${format}` : undefined };
  } catch (e) {
    await output?.cancel().catch(() => {});
    await writable?.abort().catch(() => {});
    if (dir) await dir.removeEntry(`${jobId}.${format}`).catch(() => {});
    throw e;
  } finally {
    engine.dispose();
    renderer?.dispose();
  }
}
