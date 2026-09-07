import {
  type Animatable,
  type Clip,
  type Project,
  type TransformKey,
  clipSpeed,
  fps,
} from './model';
export function evaluate(a: Animatable, frame: number): number {
  const keys = a.keyframes;
  if (!keys.length) return a.defaultValue;
  if (frame <= keys[0].frame) return keys[0].value;
  for (let i = 1; i < keys.length; i++) {
    const b = keys[i],
      a = keys[i - 1];
    if (frame <= b.frame) {
      let t = (frame - a.frame) / (b.frame - a.frame);
      if (a.easing === 'ease-in') t *= t;
      else if (a.easing === 'ease-out') t = 1 - (1 - t) ** 2;
      else if (a.easing === 'ease-in-out') t = t * t * (3 - 2 * t);
      return a.value + (b.value - a.value) * t;
    }
  }
  return keys[keys.length - 1].value;
}
export function values(c: Clip, frame: number) {
  return Object.fromEntries(
    Object.entries(c.transform).map(([k, a]) => [
      k,
      evaluate(a, frame - c.startFrame),
    ]),
  ) as Record<TransformKey, number>;
}
export function visualAlpha(c: Clip, frame: number) {
  const f = frame - c.startFrame;
  if (c.transition === 'none' || c.transitionFrames <= 0) return 1;
  const n = Math.min(c.transitionFrames, c.durationFrames / 2);
  return Math.max(0, Math.min(1, f / n, (c.durationFrames - 1 - f) / n));
}
export function sceneAt(p: Project, frame: number) {
  const items = p.tracks
    .slice()
    .reverse()
    .filter((t) => !t.hidden)
    .flatMap((t) => {
      const active = t.clips
        .filter(
          (c) =>
            c.type !== 'audio' &&
            frame >= c.startFrame &&
            frame < c.startFrame + c.durationFrames,
        )
        .sort((a, b) => a.startFrame - b.startFrame);
      return active.map((c) => {
        let alpha = visualAlpha(c, frame);
        if (c.transition === 'dissolve') {
          const previous = t.clips
            .filter(
              (x) =>
                x.id !== c.id &&
                x.startFrame < c.startFrame &&
                x.startFrame + x.durationFrames > c.startFrame,
            )
            .sort((a, b) => b.startFrame - a.startFrame)[0];
          const incoming = active.some(
            (x) => x.startFrame > c.startFrame && x.transition === 'dissolve',
          );
          if (incoming) alpha = 1;
          else if (
            previous &&
            frame < previous.startFrame + previous.durationFrames
          ) {
            const overlap =
              previous.startFrame + previous.durationFrames - c.startFrame;
            alpha = Math.max(
              0,
              Math.min(1, (frame - c.startFrame) / Math.max(1, overlap - 1)),
            );
          }
        }
        return {
          clip: c,
          transform: values(c, frame),
          alpha,
          sourceUs:
            c.sourceInUs +
            (((frame - c.startFrame) * 1e6) / fps(p)) * clipSpeed(c),
        };
      });
    });
  const layerPriority = (clip: Clip) =>
    clip.type === 'text' || clip.type === 'caption'
      ? 2
      : clip.type === 'shape'
        ? 1
        : 0;
  return items.sort((a, b) => layerPriority(a.clip) - layerPriority(b.clip));
}
export function audioGain(c: Clip, localFrame: number) {
  if (c.muted) return 0;
  let gain = 10 ** (c.volumeDb / 20);
  if (c.fadeInFrames > 0) gain *= Math.min(1, localFrame / c.fadeInFrames);
  if (c.fadeOutFrames > 0)
    gain *= Math.min(1, (c.durationFrames - localFrame) / c.fadeOutFrames);
  return Math.max(0, gain);
}
export function snapFrame(target: number, points: number[], threshold: number) {
  let best = Math.max(0, Math.round(target)),
    dist = threshold + 1;
  for (const p of points) {
    const d = Math.abs(p - target);
    if (d <= threshold && d < dist) {
      best = p;
      dist = d;
    }
  }
  return Math.max(0, Math.round(best));
}
export function parseSrt(
  text: string,
  p: Project,
): Array<{ text: string; startFrame: number; durationFrames: number }> {
  const source = text
    .replace(/^\uFEFF/, '')
    .replace(/\r/g, '')
    .trim();
  if (!source) return [];
  return source.split(/\n\s*\n/).map((block) => {
    const lines = block.split('\n');
    const index = lines.findIndex((l) => l.includes('-->'));
    if (index < 0) throw Error('SRT の時刻が見つかりません');
    const m = lines[index].match(
      /(\d{2,}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2,}):(\d{2}):(\d{2})[,.](\d{3})/,
    );
    if (!m) throw Error('SRT の時刻形式が正しくありません');
    const toSec = (o: number) =>
      Number(m[o]) * 3600 +
      Number(m[o + 1]) * 60 +
      Number(m[o + 2]) +
      Number(m[o + 3]) / 1000;
    const start = Math.round(toSec(1) * fps(p)),
      end = Math.round(toSec(5) * fps(p));
    if (
      end <= start ||
      Number(m[2]) > 59 ||
      Number(m[3]) > 59 ||
      Number(m[6]) > 59 ||
      Number(m[7]) > 59
    )
      throw Error('SRT の終了時刻は開始時刻より後にしてください');
    return {
      startFrame: start,
      durationFrames: end - start,
      text: lines
        .slice(index + 1)
        .join('\n')
        .replace(/<[^>]*>/g, ''),
    };
  });
}
