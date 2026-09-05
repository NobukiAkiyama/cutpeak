import {
  clone,
  findClip,
  frameToUs,
  id,
  validateProject,
  type Asset,
  type Clip,
  type Project,
  type Track,
  type TransformKey,
  type Easing,
} from './model';
import { evaluate } from './timeline';
export type Command =
  | {
      type: 'project.update';
      patch: Partial<Pick<Project, 'name' | 'width' | 'height' | 'background'>>;
    }
  | { type: 'asset.add'; asset: Asset }
  | { type: 'asset.relink'; assetId: string; asset: Asset }
  | { type: 'track.add'; track: Track }
  | {
      type: 'track.update';
      trackId: string;
      patch: Partial<Pick<Track, 'name' | 'locked' | 'hidden' | 'muted'>>;
    }
  | { type: 'track.move'; trackId: string; index: number }
  | { type: 'clip.add'; trackId: string; clip: Clip }
  | {
      type: 'clip.update';
      clipId: string;
      patch: Partial<
        Pick<
          Clip,
          | 'name'
          | 'text'
          | 'style'
          | 'crop'
          | 'shape'
          | 'color'
          | 'volumeDb'
          | 'muted'
          | 'fadeInFrames'
          | 'fadeOutFrames'
          | 'transition'
          | 'transitionFrames'
        >
      >;
    }
  | { type: 'clip.move'; clipId: string; startFrame: number; trackId?: string }
  | {
      type: 'clip.trim';
      clipId: string;
      startFrame: number;
      durationFrames: number;
      sourceInUs: number;
    }
  | { type: 'clip.split'; clipId: string; frame: number }
  | { type: 'clip.delete'; clipId: string }
  | { type: 'clip.duplicate'; clipId: string }
  | {
      type: 'clip.transform';
      clipId: string;
      key: TransformKey;
      value: number;
      frame?: number;
      easing?: Easing;
    }
  | {
      type: 'keyframe.delete';
      clipId: string;
      key: TransformKey;
      frame: number;
    }
  | { type: 'caption.style'; trackId: string; style: Clip['style'] };
export interface Operation {
  type: Command['type'];
  target: string;
  description: string;
  frame?: number;
}
const label: Record<string, string> = {
  x: '位置 X',
  y: '位置 Y',
  scaleX: '横倍率',
  scaleY: '縦倍率',
  rotation: '回転',
  opacity: '不透明度',
  volumeDb: '音量 dB',
  text: 'テキスト',
  name: '名前',
  durationFrames: '長さ',
  startFrame: '開始位置',
  muted: 'ミュート',
  transition: 'トランジション',
  fadeInFrames: 'フェードイン',
  fadeOutFrames: 'フェードアウト',
};
function describe(v: unknown): string {
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')
    return String(v);
  return '設定';
}
// Keep out-of-range anchors: deleting them would change eased curves after a split.
function trimKeys(c: Clip, offset: number, _duration: number) {
  if (!offset) return;
  for (const a of Object.values(c.transform))
    a.keyframes = a.keyframes.map((k) => ({ ...k, frame: k.frame - offset }));
}
export function applyCommand(
  current: Project,
  cmd: Command,
): { project: Project; operation: Operation } | null {
  const p = clone(current);
  let target = p.name,
    description = '',
    frame: number | undefined;
  if (cmd.type === 'project.update') {
    Object.assign(p, cmd.patch);
    description = Object.entries(cmd.patch)
      .map(
        ([k, v]) =>
          `${label[k] || k}: ${describe(current[k as keyof Project])} → ${describe(v)}`,
      )
      .join('、');
  } else if (cmd.type === 'asset.add') {
    if (p.assets.some((a) => a.id === cmd.asset.id))
      throw Error('素材IDが重複しています');
    p.assets.push(clone(cmd.asset));
    target = cmd.asset.name;
    description = '素材を読み込み';
  } else if (cmd.type === 'asset.relink') {
    const i = p.assets.findIndex((a) => a.id === cmd.assetId);
    if (i < 0) throw Error('素材が見つかりません');
    p.assets[i] = { ...clone(cmd.asset), id: cmd.assetId };
    description = '素材を再接続';
    target = cmd.asset.name;
  } else if (cmd.type === 'track.add') {
    p.tracks.unshift(clone(cmd.track));
    target = cmd.track.name;
    description = 'トラックを追加';
  } else if (cmd.type === 'track.update') {
    const t = p.tracks.find((t) => t.id === cmd.trackId);
    if (!t) throw Error('トラックが見つかりません');
    target = t.name;
    Object.assign(t, cmd.patch);
    description = Object.entries(cmd.patch)
      .map(
        ([k, v]) =>
          `${({ locked: 'ロック', hidden: '非表示', muted: 'ミュート' } as Record<string, string>)[k] || k}: ${v}`,
      )
      .join('、');
  } else if (cmd.type === 'track.move') {
    const i = p.tracks.findIndex((t) => t.id === cmd.trackId);
    if (i < 0) throw Error('トラックが見つかりません');
    if (p.tracks[i].locked) throw Error('トラックがロックされています');
    const [t] = p.tracks.splice(i, 1);
    p.tracks.splice(Math.max(0, Math.min(cmd.index, p.tracks.length)), 0, t);
    target = t.name;
    description = 'トラックの順序を変更';
  } else if (cmd.type === 'caption.style') {
    const t = p.tracks.find((t) => t.id === cmd.trackId);
    if (!t || t.locked) throw Error('字幕トラックを編集できません');
    for (const c of t.clips) c.style = clone(cmd.style);
    target = t.name;
    description = 'すべての字幕にスタイルを適用';
  } else if (cmd.type === 'clip.add') {
    const t = p.tracks.find((t) => t.id === cmd.trackId);
    if (!t || t.locked) throw Error('トラックを編集できません');
    t.clips.push(clone(cmd.clip));
    target = cmd.clip.name;
    frame = cmd.clip.startFrame;
    description = 'クリップを追加';
  } else {
    const found = findClip(p, cmd.clipId);
    if (!found) throw Error('クリップが見つかりません');
    const { clip: c, track: t } = found;
    if (t.locked) throw Error('トラックがロックされています');
    target = c.name;
    frame = c.startFrame;
    switch (cmd.type) {
      case 'clip.update':
        description = Object.entries(cmd.patch)
          .map(
            ([k, v]) =>
              `${label[k] || k}: ${describe(c[k as keyof Clip])} → ${describe(v)}`,
          )
          .join('、');
        Object.assign(c, clone(cmd.patch));
        break;
      case 'clip.move': {
        if (cmd.trackId && cmd.trackId !== t.id) {
          const dest = p.tracks.find((t) => t.id === cmd.trackId);
          if (!dest || dest.locked) throw Error('このトラックへ移動できません');
          t.clips = t.clips.filter((x) => x.id !== c.id);
          dest.clips.push(c);
        }
        description = `開始位置 ${c.startFrame} → ${Math.max(0, Math.round(cmd.startFrame))} フレーム`;
        c.startFrame = Math.max(0, Math.round(cmd.startFrame));
        break;
      }
      case 'clip.trim': {
        const offset = Math.round(
          ((cmd.sourceInUs - c.sourceInUs) * p.fps.numerator) /
            (1e6 * p.fps.denominator),
        );
        trimKeys(c, offset, cmd.durationFrames);
        description = `長さ ${c.durationFrames} → ${cmd.durationFrames} フレーム`;
        c.startFrame = cmd.startFrame;
        c.durationFrames = cmd.durationFrames;
        c.sourceInUs = cmd.sourceInUs;
        break;
      }
      case 'clip.split': {
        const n = Math.round(cmd.frame) - c.startFrame;
        if (n <= 0 || n >= c.durationFrames) return null;
        const right = clone(c);
        right.id = id();
        right.startFrame = cmd.frame;
        right.durationFrames = c.durationFrames - n;
        right.sourceInUs += frameToUs(n, p);
        trimKeys(right, n, right.durationFrames);
        trimKeys(c, 0, n);
        c.durationFrames = n;
        c.fadeOutFrames = 0;
        right.fadeInFrames = 0;
        t.clips.push(right);
        description = 'クリップを分割';
        frame = cmd.frame;
        break;
      }
      case 'clip.delete':
        t.clips = t.clips.filter((x) => x.id !== c.id);
        description = 'クリップを削除';
        break;
      case 'clip.duplicate': {
        const copy = clone(c);
        copy.id = id();
        copy.startFrame += c.durationFrames;
        t.clips.push(copy);
        description = 'クリップを複製';
        break;
      }
      case 'clip.transform': {
        const a = c.transform[cmd.key];
        const prev =
          cmd.frame === undefined ? a.defaultValue : evaluate(a, cmd.frame);
        if (cmd.frame !== undefined) {
          const k = {
            frame: Math.max(0, Math.round(cmd.frame)),
            value: cmd.value,
            easing: cmd.easing || ('linear' as Easing),
          };
          a.keyframes = a.keyframes
            .filter((x) => x.frame !== k.frame)
            .concat(k)
            .sort((a, b) => a.frame - b.frame);
        } else a.defaultValue = cmd.value;
        description = `${label[cmd.key]} ${Number(prev.toFixed(3))} → ${Number(cmd.value.toFixed(3))}${cmd.frame !== undefined ? '（キーフレーム）' : ''}`;
        break;
      }
      case 'keyframe.delete':
        c.transform[cmd.key].keyframes = c.transform[cmd.key].keyframes.filter(
          (k) => k.frame !== cmd.frame,
        );
        description = `${label[cmd.key]} のキーフレームを削除`;
        break;
    }
    if (c.assetId && c.type !== 'image') {
      const asset = p.assets.find((a) => a.id === c.assetId);
      if (
        asset &&
        c.sourceInUs + frameToUs(c.durationFrames, p) >
          asset.durationUs + frameToUs(1, p)
      )
        throw Error('素材の長さを超えています');
    }
  }
  if (JSON.stringify(current) === JSON.stringify(p)) return null;
  p.updatedAt = Date.now();
  validateProject(p);
  return {
    project: p,
    operation: { type: cmd.type, target, description, frame },
  };
}
