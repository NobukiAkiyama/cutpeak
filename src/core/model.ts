export interface Rational {
  numerator: number;
  denominator: number;
}
export type Easing = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out';
export interface Keyframe {
  frame: number;
  value: number;
  easing: Easing;
}
export interface Animatable {
  defaultValue: number;
  keyframes: Keyframe[];
}
export type TransformKey =
  | 'x'
  | 'y'
  | 'scaleX'
  | 'scaleY'
  | 'rotation'
  | 'opacity';
export type Transform = Record<TransformKey, Animatable>;
export type ClipKind =
  | 'video'
  | 'audio'
  | 'image'
  | 'text'
  | 'caption'
  | 'shape';
export interface TextStyle {
  font: string;
  size: number;
  weight: number;
  color: string;
  align: 'left' | 'center' | 'right';
  stroke: string;
  strokeWidth: number;
  background: string;
  lineHeight: number;
  letterSpacing: number;
}
export interface Asset {
  id: string;
  name: string;
  kind: 'video' | 'audio' | 'image';
  mime: string;
  size: number;
  durationUs: number;
  firstTimestampUs: number;
  width: number;
  height: number;
  hasAudio: boolean;
  videoCodec?: string;
  audioCodec?: string;
  thumbnail?: string;
  waveform?: number[];
  offline?: boolean;
}
export interface Clip {
  id: string;
  name: string;
  type: ClipKind;
  assetId?: string;
  startFrame: number;
  durationFrames: number;
  sourceInUs: number;
  transform: Transform;
  crop: { left: number; top: number; right: number; bottom: number };
  text?: string;
  style: TextStyle;
  shape: 'rectangle' | 'ellipse';
  color: string;
  volumeDb: number;
  muted: boolean;
  fadeInFrames: number;
  fadeOutFrames: number;
  transition: 'none' | 'fade' | 'dissolve';
  transitionFrames: number;
}
export interface Track {
  id: string;
  name: string;
  type: ClipKind;
  locked: boolean;
  hidden: boolean;
  muted: boolean;
  clips: Clip[];
}
export interface Project {
  schemaVersion: 1;
  id: string;
  name: string;
  width: number;
  height: number;
  fps: Rational;
  background: string;
  tracks: Track[];
  assets: Asset[];
  createdAt: number;
  updatedAt: number;
}
export const id = () => crypto.randomUUID();
export const clone = <T>(v: T): T => structuredClone(v);
export const fps = (p: Project) => p.fps.numerator / p.fps.denominator;
export const frameToUs = (f: number, p: Project) =>
  Math.round((f * 1_000_000 * p.fps.denominator) / p.fps.numerator);
export const secondsToFrame = (s: number, p: Project) => Math.round(s * fps(p));
export const endFrame = (p: Project) =>
  Math.max(
    0,
    ...p.tracks.flatMap((t) =>
      t.clips.map((c) => c.startFrame + c.durationFrames),
    ),
  );
export const audible = (p: Project) =>
  p.tracks.some(
    (t) =>
      !t.muted &&
      t.clips.some(
        (c) =>
          !c.muted &&
          c.volumeDb > -60 &&
          p.assets.some((a) => a.id === c.assetId && a.hasAudio),
      ),
  );
export const defaultStyle = (): TextStyle => ({
  font: 'sans-serif',
  size: 72,
  weight: 700,
  color: '#ffffff',
  align: 'center',
  stroke: '#101010',
  strokeWidth: 0,
  background: '#00000000',
  lineHeight: 1.3,
  letterSpacing: 0,
});
export const defaultTransform = (p: Project): Transform =>
  Object.fromEntries(
    Object.entries({
      x: p.width / 2,
      y: p.height / 2,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      opacity: 1,
    }).map(([k, v]) => [k, { defaultValue: v, keyframes: [] }]),
  ) as unknown as Transform;
export const makeTrack = (type: ClipKind, name?: string): Track => ({
  id: id(),
  name: name || 'トラック',
  type,
  locked: false,
  hidden: false,
  muted: false,
  clips: [],
});
export function makeProject(
  name = '無題のプロジェクト',
  width = 1920,
  height = 1080,
  rate: Rational = { numerator: 30, denominator: 1 },
): Project {
  const now = Date.now();
  return {
    schemaVersion: 1,
    id: id(),
    name,
    width,
    height,
    fps: rate,
    background: '#000000',
    tracks: [
      makeTrack('text', 'トラック 1'),
      makeTrack('video', 'トラック 2'),
      makeTrack('audio', 'トラック 3'),
    ],
    assets: [],
    createdAt: now,
    updatedAt: now,
  };
}
export function makeClip(
  p: Project,
  type: ClipKind,
  startFrame = 0,
  asset?: Asset,
): Clip {
  return {
    id: id(),
    name:
      asset?.name ||
      {
        video: '動画',
        audio: '音声',
        image: '画像',
        text: 'テキスト',
        caption: '字幕',
        shape: '図形',
      }[type],
    type,
    assetId: asset?.id,
    startFrame,
    durationFrames:
      asset && type !== 'image'
        ? Math.max(1, Math.floor((asset.durationUs / 1e6) * fps(p)))
        : Math.round(fps(p) * 5),
    sourceInUs: 0,
    transform: defaultTransform(p),
    crop: { left: 0, top: 0, right: 0, bottom: 0 },
    text:
      type === 'caption'
        ? '字幕を入力'
        : type === 'text'
          ? 'テキストを入力'
          : undefined,
    style: defaultStyle(),
    shape: 'rectangle',
    color: '#bbef69',
    volumeDb: 0,
    muted: false,
    fadeInFrames: 0,
    fadeOutFrames: 0,
    transition: 'none',
    transitionFrames: 15,
  };
}
export function findClip(p: Project, clipId: string) {
  for (const track of p.tracks) {
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip) return { track, clip };
  }
  return undefined;
}
export function timecode(frame: number, p: Project) {
  const nominal = Math.round(fps(p)),
    sec = Math.floor(frame / nominal);
  return [
    Math.floor(sec / 3600),
    Math.floor(sec / 60) % 60,
    sec % 60,
    frame % nominal,
  ]
    .map((v) => String(v).padStart(2, '0'))
    .join(':');
}
export function validateProject(value: unknown): asserts value is Project {
  const p = value as Project;
  const finite = (n: unknown) => typeof n === 'number' && Number.isFinite(n);
  const integer = (n: unknown) => finite(n) && Number.isSafeInteger(n);
  if (
    !p ||
    p.schemaVersion !== 1 ||
    typeof p.id !== 'string' ||
    typeof p.name !== 'string' ||
    !integer(p.width) ||
    !integer(p.height) ||
    p.width < 2 ||
    p.height < 2 ||
    p.width > 7680 ||
    p.height > 7680 ||
    !p.fps ||
    !integer(p.fps.numerator) ||
    !integer(p.fps.denominator) ||
    p.fps.denominator <= 0 ||
    fps(p) < 1 ||
    fps(p) > 120 ||
    !Array.isArray(p.tracks) ||
    !Array.isArray(p.assets)
  )
    throw Error('対応していないプロジェクト形式です');
  const ids = new Set<string>();
  for (const t of p.tracks) {
    if (typeof t.id !== 'string' || ids.has(t.id) || !Array.isArray(t.clips))
      throw Error('トラックが不正です');
    ids.add(t.id);
    for (const c of t.clips) {
      if (
        typeof c.id !== 'string' ||
        ids.has(c.id) ||
        !integer(c.startFrame) ||
        c.startFrame < 0 ||
        !integer(c.durationFrames) ||
        c.durationFrames < 1 ||
        !integer(c.sourceInUs) ||
        c.sourceInUs < 0 ||
        !['video', 'audio', 'image', 'text', 'caption', 'shape'].includes(
          c.type,
        )
      )
        throw Error('クリップの時間が不正です');
      ids.add(c.id);
      for (const key of [
        'x',
        'y',
        'scaleX',
        'scaleY',
        'rotation',
        'opacity',
      ] as TransformKey[]) {
        const a = c.transform?.[key];
        if (
          !a ||
          !finite(a.defaultValue) ||
          !Array.isArray(a.keyframes) ||
          a.keyframes.some(
            (k) =>
              !integer(k.frame) ||
              !finite(k.value) ||
              !['linear', 'ease-in', 'ease-out', 'ease-in-out'].includes(
                k.easing,
              ),
          )
        )
          throw Error('キーフレームが不正です');
      }
      if (
        !c.crop ||
        Object.values(c.crop).some((v) => !finite(v) || v < 0 || v >= 1) ||
        c.crop.left + c.crop.right >= 1 ||
        c.crop.top + c.crop.bottom >= 1 ||
        !c.style ||
        !finite(c.style.size) ||
        c.style.size < 1 ||
        c.style.size > 1000 ||
        !finite(c.volumeDb) ||
        !integer(c.fadeInFrames) ||
        c.fadeInFrames < 0 ||
        !integer(c.fadeOutFrames) ||
        c.fadeOutFrames < 0 ||
        !integer(c.transitionFrames) ||
        c.transitionFrames < 0
      )
        throw Error('クリップの設定が不正です');
    }
  }
  for (const a of p.assets) {
    if (
      typeof a.id !== 'string' ||
      ids.has(a.id) ||
      !['video', 'audio', 'image'].includes(a.kind) ||
      !finite(a.durationUs) ||
      a.durationUs < 0 ||
      !finite(a.size) ||
      a.size < 0
    )
      throw Error('素材情報が不正です');
    ids.add(a.id);
  }
  if (endFrame(p) > fps(p) * 60 * 60 * 24)
    throw Error('24時間を超えるプロジェクトは扱えません');
}
