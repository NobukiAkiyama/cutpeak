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
    this.useAudio = audible(p) && typeof AudioContext !== 'undefined';
    if (this.useAudio) {
      this.context ??= new AudioContext({ sampleRate: 48000 });
      await this.context.resume();
      if (!this.output) {
        try {
          await this.context.audioWorklet.addModule('/audio-worklet.js');
          this.output = new AudioWorkletNode(this.context, 'framecut-output');
          this.output.connect(this.context.destination);
        } catch {
          this.output = this.context.destination;
        }
      }
    }
    if (generation !== this.generation) return;
    const first = this.useAudio
      ? await this.media.mix(
          p,
          frame / fps(p),
          Math.min(0.5, (endFrame(p) - frame) / fps(p)),
        )
      : null;
    if (generation !== this.generation) return;
    this.startTime = this.useAudio
      ? this.context!.currentTime + 0.08
      : performance.now() / 1000;
    this.scheduled = 0;
    this.playing = true;
    this.starting = false;
    if (first) this.schedule(first, 0);
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
    buffer.copyToChannel(ch[0] as Float32Array<ArrayBuffer>, 0);
    buffer.copyToChannel(ch[1] as Float32Array<ArrayBuffer>, 1);
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
    if (!this.useAudio || this.filling || !this.playing) return;
    const elapsed = this.context!.currentTime - this.startTime;
    if (this.scheduled - elapsed > 0.8) return;
    const remaining = (endFrame(p) - this.startFrame) / fps(p) - this.scheduled;
    if (remaining <= 0) return;
    this.filling = true;
    try {
      const offset = this.scheduled,
        channels = await this.media.mix(
          p,
          this.startFrame / fps(p) + offset,
          Math.min(0.5, remaining),
        );
      if (generation === this.generation && this.playing)
        this.schedule(channels, offset);
    } catch (e) {
      this.pause();
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
