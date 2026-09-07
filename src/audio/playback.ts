import { audible, endFrame, fps, type Project } from '../core/model';
import type { MediaClient } from '../media/client';
export class Playback {
  private context?: AudioContext;
  private output?: AudioNode;
  private sources = new Set<AudioBufferSourceNode>();
  private timer?: ReturnType<typeof setInterval>;
  private tick = 0;
  private generation = 0;
  private startTime = 0;
  private startFrame = 0;
  private scheduled = 0;
  private filling = false;
  private useAudio = false;
  private audioFailed = false;
  playing = false;
  starting = false;
  get active() {
    return this.playing || this.starting;
  }
  constructor(
    private media: MediaClient,
    private onFrame: (f: number) => void,
    private onStop: () => void,
    private onError: (e: Error) => void,
  ) {}
  async play(p: Project, frame: number) {
    this.pause(false);
    this.starting = true;
    const generation = ++this.generation;
    this.startFrame = frame;
    this.audioFailed = false;
    this.useAudio = audible(p) && typeof AudioContext !== 'undefined';
    if (this.useAudio) {
      try {
        this.context ??= new AudioContext({ sampleRate: 48000 });
        await this.context.resume();
        this.output ??= this.context.destination;
      } catch {
        this.useAudio = false;
        this.audioFailed = true;
        this.onError(
          new Error('音声を開始できないため、映像のみ再生しています。'),
        );
      }
    }
    if (generation !== this.generation) return;
    this.startTime = this.useAudio
      ? this.context!.currentTime + 0.08
      : performance.now() / 1000;
    this.scheduled = 0;
    this.playing = true;
    this.starting = false;
    void this.fill(p, generation);
    this.timer = setInterval(() => void this.fill(p, generation), 80);
    const step = () => {
      if (!this.playing || generation !== this.generation) return;
      const elapsed = Math.max(
        0,
        (this.useAudio ? this.context!.currentTime : performance.now() / 1000) -
          this.startTime,
      );
      const f = this.startFrame + Math.floor(elapsed * fps(p));
      if (f >= endFrame(p)) {
        this.onFrame(Math.max(0, endFrame(p) - 1));
        this.pause();
        return;
      }
      this.onFrame(f);
      this.tick = requestAnimationFrame(step);
    };
    step();
  }
  private schedule(ch: Float32Array[], offset: number) {
    const ctx = this.context!,
      buffer = ctx.createBuffer(2, ch[0].length, 48000);
    const left = new Float32Array(ch[0].length),
      right = new Float32Array(ch[1].length);
    left.set(ch[0]);
    right.set(ch[1]);
    buffer.copyToChannel(left, 0);
    buffer.copyToChannel(right, 1);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.output!);
    const planned = this.startTime + offset,
      late = Math.max(0, ctx.currentTime - planned);
    if (late < buffer.duration) {
      source.start(Math.max(ctx.currentTime, planned), late);
      this.sources.add(source);
      source.onended = () => {
        source.disconnect();
        this.sources.delete(source);
      };
    }
    this.scheduled = offset + buffer.duration;
  }
  private async fill(p: Project, generation: number) {
    if (!this.useAudio || this.audioFailed || this.filling || !this.playing)
      return;
    const elapsed = this.context!.currentTime - this.startTime;
    if (this.scheduled - elapsed > 0.8) return;
    const offset = Math.max(this.scheduled, Math.max(0, elapsed));
    const remaining = (endFrame(p) - this.startFrame) / fps(p) - offset;
    if (remaining <= 0) return;
    this.filling = true;
    try {
      const channels = await this.media.mix(
        p,
        this.startFrame / fps(p) + offset,
        Math.min(0.5, remaining),
      );
      if (generation === this.generation && this.playing)
        this.schedule(channels, offset);
    } catch (e) {
      this.audioFailed = true;
      this.onError(e as Error);
    } finally {
      this.filling = false;
    }
  }
  pause(notify = true) {
    this.generation++;
    this.playing = false;
    this.starting = false;
    cancelAnimationFrame(this.tick);
    clearInterval(this.timer);
    for (const s of this.sources) {
      try {
        s.stop();
        s.disconnect();
      } catch {}
    }
    this.sources.clear();
    if (notify) this.onStop();
  }
  dispose() {
    this.pause(false);
    void this.context?.close();
  }
}
