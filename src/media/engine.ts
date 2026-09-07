import {
  Input,
  ALL_FORMATS,
  BlobSource,
  CanvasSink,
  AudioSampleSink,
  type InputVideoTrack,
  type InputAudioTrack,
  type WrappedCanvas,
} from 'mediabunny';
import { clipSpeed, type Asset, type Project, fps } from '../core/model';
import { audioGain, sceneAt } from '../core/timeline';
import { canvasOf } from '../render/renderer';

export const DEFAULT_WAVEFORM_BINS = 320;
export const VIDEO_THUMBNAIL_COUNT = 16;
const AUDIO_DECODE_PADDING = 0.1;

export function retimeAudio(
  channels: Float32Array[],
  outputFrames: number,
  speed: number,
) {
  return channels.map((input) => {
    const output = new Float32Array(outputFrames);
    if (!input.length) return output;
    for (let i = 0; i < output.length; i++) {
      const position = Math.min(input.length - 1, i * speed);
      const index = Math.floor(position);
      const mix = position - index;
      output[i] =
        input[index] * (1 - mix) +
        input[Math.min(index + 1, input.length - 1)] * mix;
    }
    return output;
  });
}

async function encodeBitmap(
  bitmap: ImageBitmap,
  width: number,
  height: number,
) {
  const canvas = canvasOf(width, height);
  const ctx = canvas.getContext('2d') as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D;
  ctx.fillStyle = '#111318';
  ctx.fillRect(0, 0, width, height);
  const ratio = Math.min(width / bitmap.width, height / bitmap.height);
  const drawWidth = bitmap.width * ratio;
  const drawHeight = bitmap.height * ratio;
  ctx.drawImage(
    bitmap,
    (width - drawWidth) / 2,
    (height - drawHeight) / 2,
    drawWidth,
    drawHeight,
  );
  const blob =
    'convertToBlob' in canvas
      ? await canvas.convertToBlob({ type: 'image/webp', quality: 0.7 })
      : await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob(
            (value) =>
              value ? resolve(value) : reject(Error('画像を生成できません')),
            'image/webp',
            0.7,
          ),
        );
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let raw = '';
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return `data:image/webp;base64,${btoa(raw)}`;
}

export class Lru<T> {
  private map = new Map<string, T>();
  constructor(
    private max: number,
    private dispose: (v: T) => void,
    private weight: (v: T) => number = () => 1,
  ) {}
  get(k: string) {
    const v = this.map.get(k);
    if (v !== undefined) {
      this.map.delete(k);
      this.map.set(k, v);
    }
    return v;
  }
  set(k: string, v: T) {
    const old = this.map.get(k);
    if (old !== undefined) this.dispose(old);
    this.map.delete(k);
    this.map.set(k, v);
    while (
      this.map.size > 1 &&
      Array.from(this.map.values()).reduce(
        (sum, v) => sum + this.weight(v),
        0,
      ) > this.max
    ) {
      const first = this.map.keys().next().value!;
      this.dispose(this.map.get(first)!);
      this.map.delete(first);
    }
  }
  clear() {
    for (const v of this.map.values()) this.dispose(v);
    this.map.clear();
  }
}
interface MediaEntry {
  file: File;
  input?: Input;
  video?: InputVideoTrack | null;
  audio?: InputAudioTrack | null;
  gif?: GifEntry;
  canvases: Map<number, CanvasSink>;
  audioSink?: AudioSampleSink;
  bitmap?: ImageBitmap;
  firstTimestamp: number;
  duration: number;
}
interface GifFrame {
  startUs: number;
  durationUs: number;
}
interface GifEntry {
  decoder: ImageDecoder;
  frames: GifFrame[];
  durationUs: number;
  width: number;
  height: number;
}

async function decodeGif(file: File): Promise<GifEntry> {
  const decoder = new ImageDecoder({
    data: await file.arrayBuffer(),
    type: 'image/gif',
    preferAnimation: true,
  });
  try {
    await decoder.tracks.ready;
    const track = decoder.tracks.selectedTrack;
    if (!track || track.frameCount < 1)
      throw Error('GIFのフレームを読み込めません');
    const frames: GifFrame[] = [];
    let cursor = 0,
      width = 0,
      height = 0;
    for (let frameIndex = 0; frameIndex < track.frameCount; frameIndex++) {
      const decoded = await decoder.decode({
        frameIndex,
        completeFramesOnly: true,
      });
      const image = decoded.image;
      try {
        const startUs = Number.isFinite(image.timestamp)
          ? Math.max(cursor, image.timestamp)
          : cursor;
        const imageDuration = image.duration ?? 0;
        const durationUs =
          Number.isFinite(imageDuration) && imageDuration > 0
            ? imageDuration
            : 100_000;
        frames.push({ startUs, durationUs });
        cursor = startUs + durationUs;
        width = image.displayWidth || width;
        height = image.displayHeight || height;
      } finally {
        image.close();
      }
    }
    return {
      decoder,
      frames,
      durationUs: frames.length > 1 ? cursor : 5_000_000,
      width,
      height,
    };
  } catch (error) {
    decoder.close();
    throw error;
  }
}

interface FrameReader {
  iterator: AsyncGenerator<WrappedCanvas, void, unknown>;
  current?: WrappedCanvas;
  next?: WrappedCanvas;
  time: number;
  ended: boolean;
}
export class MediaEngine {
  private entries = new Map<string, MediaEntry>();
  private readers = new Map<string, FrameReader>();
  private frames = new Lru<ImageBitmap>(
    64 * 1024 * 1024,
    (b) => b.close(),
    (b) => b.width * b.height * 4,
  );
  private chunks = new Lru<Float32Array[]>(48, () => {});
  async register(assetId: string, file: File) {
    this.remove(assetId);
    const isGif = file.type === 'image/gif' || /\.gif$/i.test(file.name);
    if (isGif && typeof ImageDecoder !== 'undefined') {
      try {
        const gif = await decodeGif(file);
        this.entries.set(assetId, {
          file,
          gif,
          canvases: new Map(),
          firstTimestamp: 0,
          duration: gif.durationUs / 1e6,
        });
        return;
      } catch {}
    }
    const isImage =
      file.type.startsWith('image/') ||
      /\.(png|jpe?g|webp|gif)$/i.test(file.name);
    if (isImage) {
      const bitmap = await createImageBitmap(file);
      this.entries.set(assetId, {
        file,
        bitmap,
        canvases: new Map(),
        firstTimestamp: 0,
        duration: 0,
      });
      return;
    }
    const input = new Input({
      formats: ALL_FORMATS,
      source: new BlobSource(file),
    });
    try {
      const [video, audio] = await Promise.all([
        input.getPrimaryVideoTrack(),
        input.getPrimaryAudioTrack(),
      ]);
      if (!video && !audio) throw Error('動画・音声トラックがありません');
      if (video) {
        const config = await video.getDecoderConfig();
        if (
          !config ||
          typeof VideoDecoder === 'undefined' ||
          !(await VideoDecoder.isConfigSupported(config)).supported ||
          !(await video.canDecode())
        )
          throw Error('この動画コーデックをデコードできません');
      }
      if (audio) {
        const config = await audio.getDecoderConfig();
        if (!config || !(await audio.canDecode()))
          throw Error('この音声コーデックをデコードできません');
        if (
          !config.codec.startsWith('pcm-') &&
          (typeof AudioDecoder === 'undefined' ||
            !(await AudioDecoder.isConfigSupported(config).then(
              (r) => r.supported,
            )))
        )
          throw Error('この音声コーデックをデコードできません');
      }
      const firstTimestamp = Math.min(
        ...(await Promise.all(
          [video, audio].filter(Boolean).map((t) => t!.getFirstTimestamp()),
        )),
      );
      const duration = Math.max(
        0,
        (await input.computeDuration()) - firstTimestamp,
      );
      this.entries.set(assetId, {
        file,
        input,
        video,
        audio,
        canvases: new Map(),
        audioSink: audio ? new AudioSampleSink(audio) : undefined,
        firstTimestamp,
        duration,
      });
    } catch (e) {
      input.dispose();
      throw e;
    }
  }
  async metadata(assetId: string): Promise<Asset> {
    const e = this.entries.get(assetId)!;
    const width =
        e.bitmap?.width ||
        e.gif?.width ||
        (await e.video?.getDisplayWidth()) ||
        0,
      height =
        e.bitmap?.height ||
        e.gif?.height ||
        (await e.video?.getDisplayHeight()) ||
        0;
    let thumbnail: string | undefined;
    const preview = await this.frame(
      assetId,
      Math.round(Math.min(0.2, e.duration / 4) * 1e6),
      240,
    );
    if (preview) {
      thumbnail = await encodeBitmap(preview, 240, 135);
      preview.close();
    }
    let thumbnails: string[] | undefined;
    if (e.video && e.duration > 0) {
      thumbnails = [];
      for (let i = 0; i < VIDEO_THUMBNAIL_COUNT; i++) {
        const frame = await this.frame(
          assetId,
          ((i + 0.5) / VIDEO_THUMBNAIL_COUNT) * e.duration * 1e6,
          160,
        );
        if (!frame) continue;
        thumbnails.push(await encodeBitmap(frame, 160, 90));
        frame.close();
      }
      if (!thumbnails.length) thumbnails = undefined;
    }
    return {
      id: assetId,
      name: e.file.name,
      // GIFs behave like still images at the clip level: users can extend
      // them freely, while frame() loops the animation over the clip.
      kind: e.bitmap || e.gif ? 'image' : e.video ? 'video' : 'audio',
      mime: e.file.type,
      size: e.file.size,
      durationUs: e.gif?.durationUs || Math.round(e.duration * 1e6),
      firstTimestampUs: Math.round(e.firstTimestamp * 1e6),
      width,
      height,
      hasAudio: !!e.audio,
      videoCodec: e.gif
        ? 'gif'
        : e.video
          ? String(await e.video.getCodec())
          : undefined,
      audioCodec: e.audio ? String(await e.audio.getCodec()) : undefined,
      thumbnail,
      thumbnails,
    };
  }
  async waveform(assetId: string, bins = DEFAULT_WAVEFORM_BINS) {
    const e = this.entries.get(assetId);
    if (!e?.audioSink || !e.duration) return [];
    const out = Array.from({ length: bins }, () => 0);
    for await (const sample of e.audioSink.samples()) {
      try {
        const data = new Float32Array(sample.numberOfFrames);
        sample.copyTo(data, { format: 'f32-planar', planeIndex: 0 });
        for (
          let i = 0;
          i < data.length;
          i += Math.max(1, Math.floor(sample.sampleRate / 8000))
        ) {
          const bin = Math.floor(
            ((sample.timestamp - e.firstTimestamp + i / sample.sampleRate) /
              e.duration) *
              bins,
          );
          if (bin >= 0 && bin < bins)
            out[bin] = Math.max(out[bin], Math.abs(data[i]));
        }
      } finally {
        sample.close();
      }
    }
    return out;
  }
  async frame(
    assetId: string,
    sourceUs: number,
    width: number,
    streamKey?: string,
  ): Promise<ImageBitmap | null> {
    const e = this.entries.get(assetId);
    if (!e) throw Error('素材がオフラインです');
    if (e.bitmap) {
      const w = Math.min(e.bitmap.width, Math.max(2, Math.round(width)));
      return createImageBitmap(e.bitmap, {
        resizeWidth: w,
        resizeHeight: Math.max(
          1,
          Math.round((e.bitmap.height * w) / e.bitmap.width),
        ),
        resizeQuality: 'high',
      });
    }
    if (e.gif) {
      const w = Math.max(2, Math.min(Math.round(width), e.gif.width));
      const key = `${assetId}:${Math.round(sourceUs)}:${w}`;
      const cached = this.frames.get(key);
      if (cached) return createImageBitmap(cached);
      const localUs =
        e.gif.durationUs > 0 ? Math.max(0, sourceUs) % e.gif.durationUs : 0;
      let frameIndex = e.gif.frames.length - 1;
      for (let i = 0; i < e.gif.frames.length; i++) {
        const frame = e.gif.frames[i];
        if (localUs < frame.startUs + frame.durationUs) {
          frameIndex = i;
          break;
        }
      }
      const decoded = await e.gif.decoder.decode({ frameIndex });
      try {
        const bitmap = await createImageBitmap(decoded.image, {
          resizeWidth: w,
          resizeHeight: Math.max(
            1,
            Math.round((e.gif.height * w) / e.gif.width),
          ),
          resizeQuality: 'high',
        });
        this.frames.set(key, bitmap);
        return createImageBitmap(bitmap);
      } finally {
        decoded.image.close();
      }
    }
    if (!e.video) return null;
    const w = Math.max(
      2,
      Math.min(Math.round(width), await e.video.getDisplayWidth()),
    );
    if (streamKey) {
      const prefix = `${assetId}/${streamKey}/`;
      for (const [readerKey, reader] of this.readers) {
        if (readerKey.startsWith(prefix) && readerKey !== `${prefix}${w}`) {
          await reader.iterator.return();
          this.readers.delete(readerKey);
        }
      }
    }
    const key = `${assetId}:${Math.round(sourceUs)}:${w}`;
    const cached = this.frames.get(key);
    if (cached) return createImageBitmap(cached);
    let sink = e.canvases.get(w);
    if (!sink) {
      e.canvases.clear();
      sink = new CanvasSink(e.video, { width: w, poolSize: 3, alpha: true });
      e.canvases.set(w, sink);
    }
    const time =
      e.firstTimestamp +
      Math.max(0, Math.min(e.duration - 0.000001, sourceUs / 1e6));
    const requested = Math.max(time, await e.video.getFirstTimestamp());
    let wrapped: WrappedCanvas | null;
    if (streamKey) {
      const readerKey = `${assetId}/${streamKey}/${w}`;
      let reader = this.readers.get(readerKey);
      if (
        reader &&
        (requested < reader.time || requested - reader.time > 0.75)
      ) {
        await reader.iterator.return();
        this.readers.delete(readerKey);
        reader = undefined;
      }
      if (!reader) {
        // Sequential playback keeps one decoder per active clip; seeks restart at a keyframe.
        const iterator = new CanvasSink(e.video, {
          width: w,
          poolSize: 3,
          alpha: true,
        }).canvases(requested);
        const first = await iterator.next();
        reader = {
          iterator,
          current: first.value || undefined,
          time: requested,
          ended: !!first.done,
        };
        this.readers.set(readerKey, reader);
      }
      while (!reader.ended) {
        if (!reader.next) {
          const next = await reader.iterator.next();
          reader.next = next.value || undefined;
          reader.ended = !!next.done;
        }
        if (!reader.next || reader.next.timestamp > requested + 1e-7) break;
        reader.current = reader.next;
        reader.next = undefined;
      }
      reader.time = requested;
      wrapped = reader.current || null;
    } else wrapped = await sink.getCanvas(requested);
    if (!wrapped) return null;
    const bitmap = await createImageBitmap(wrapped.canvas);
    this.frames.set(key, bitmap);
    return createImageBitmap(bitmap);
  }
  async audioRange(
    assetId: string,
    start: number,
    duration: number,
    rate = 48000,
  ): Promise<Float32Array[]> {
    const n = Math.max(1, Math.round(duration * rate)),
      out = [new Float32Array(n), new Float32Array(n)];
    const e = this.entries.get(assetId);
    if (!e?.audioSink) return out;
    const absStart = start + e.firstTimestamp;
    const firstTimestamp = await e.audio!.getFirstTimestamp();
    for await (const sample of e.audioSink.samples(
      Math.max(firstTimestamp, absStart - AUDIO_DECODE_PADDING),
      absStart + duration + AUDIO_DECODE_PADDING,
    )) {
      try {
        const begin = Math.max(
            0,
            Math.ceil((sample.timestamp - absStart) * rate),
          ),
          end = Math.min(
            n,
            Math.ceil((sample.timestamp + sample.duration - absStart) * rate),
          );
        for (let ch = 0; ch < 2; ch++) {
          const src = new Float32Array(sample.numberOfFrames);
          sample.copyTo(src, {
            format: 'f32-planar',
            planeIndex: Math.min(ch, sample.numberOfChannels - 1),
          });
          for (let i = begin; i < end; i++) {
            const pos =
              (absStart + i / rate - sample.timestamp) * sample.sampleRate;
            if (pos < 0 || pos >= src.length) continue;
            const k = Math.floor(pos),
              f = pos - k;
            out[ch][i] =
              src[k] * (1 - f) + src[Math.min(k + 1, src.length - 1)] * f;
          }
        }
      } finally {
        sample.close();
      }
    }
    return out;
  }
  async mix(p: Project, start: number, duration: number, rate = 48000) {
    const n = Math.max(1, Math.round(duration * rate)),
      out = [new Float32Array(n), new Float32Array(n)];
    for (const t of p.tracks) {
      if (t.muted) continue;
      for (const c of t.clips) {
        const a = p.assets.find((a) => a.id === c.assetId);
        if (
          !a?.hasAudio ||
          (c.type !== 'audio' && c.audioDetached) ||
          c.muted ||
          !this.entries.has(a.id)
        )
          continue;
        const cs = c.startFrame / fps(p),
          ce = (c.startFrame + c.durationFrames) / fps(p),
          from = Math.max(start, cs),
          to = Math.min(start + duration, ce);
        if (to <= from) continue;
        const count = Math.round((to - from) * rate),
          speed = clipSpeed(c),
          key = `${a.id}:${c.sourceInUs}:${from - cs}:${count}:${speed}`;
        let channels = this.chunks.get(key);
        if (!channels) {
          const source = await this.audioRange(
            a.id,
            c.sourceInUs / 1e6 + (from - cs) * speed,
            (to - from) * speed,
            rate,
          );
          channels = speed === 1 ? source : retimeAudio(source, count, speed);
          this.chunks.set(key, channels);
        }
        const offset = Math.round((from - start) * rate);
        for (let i = 0; i < count && i + offset < n; i++) {
          const gain = audioGain(c, (from - cs + i / rate) * fps(p));
          out[0][i + offset] += channels[0][i] * gain;
          out[1][i + offset] += channels[1][i] * gain;
        }
      }
    }
    let peak = 0;
    for (const ch of out)
      for (let i = 0; i < ch.length; i++)
        peak = Math.max(peak, Math.abs(ch[i]));
    if (peak > 0.98) {
      const gain = 0.98 / peak;
      for (const ch of out) for (let i = 0; i < ch.length; i++) ch[i] *= gain;
    }
    return out;
  }
  async sceneFrames(p: Project, frame: number, width: number) {
    const result: { clipId: string; bitmap: ImageBitmap }[] = [];
    try {
      const scene = sceneAt(p, frame);
      for (const [key, reader] of this.readers) {
        if (
          !scene.some((i) => key.startsWith(`${i.clip.assetId}/${i.clip.id}/`))
        ) {
          await reader.iterator.return();
          this.readers.delete(key);
        }
      }
      for (const item of scene) {
        if (!item.clip.assetId || !this.entries.has(item.clip.assetId))
          continue;
        const b = await this.frame(
          item.clip.assetId,
          item.sourceUs,
          width,
          item.clip.id,
        );
        if (b) result.push({ clipId: item.clip.id, bitmap: b });
      }
      return result;
    } catch (e) {
      result.forEach((i) => i.bitmap.close());
      throw e;
    }
  }
  remove(assetId: string) {
    for (const [key, reader] of this.readers) {
      if (key.startsWith(`${assetId}/`)) {
        void reader.iterator.return().catch(() => {});
        this.readers.delete(key);
      }
    }
    const e = this.entries.get(assetId);
    e?.input?.dispose();
    e?.gif?.decoder.close();
    e?.bitmap?.close();
    this.entries.delete(assetId);
    this.frames.clear();
    this.chunks.clear();
  }
  dispose() {
    for (const id of this.entries.keys()) this.remove(id);
  }
}
