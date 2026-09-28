import {
  clipSpeed,
  endFrame,
  frameToUs,
  type Clip,
  type Project,
} from '../../core/model';
import { evaluate, sceneAt } from '../../core/timeline';

export interface NleAsset {
  id: string;
  name: string;
  path: string;
  kind: 'video' | 'audio' | 'image';
  width: number;
  height: number;
  durationUs: number;
  hasAudio: boolean;
  generated?: boolean;
  timecodeStartUs?: number;
}

export interface NleItem {
  clip: Clip;
  trackIndex: number;
  assetId: string;
  startFrame: number;
  durationFrames: number;
  sourceInUs: number;
  baked?: boolean;
  audioOnly?: boolean;
}

const xml = (value: string | number) =>
  String(value).replace(/[&<>"']/g, (character) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[
      character
    ]!,
  );
const fmt = (value: number) =>
  Number.isInteger(value) ? String(value) : value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}
const fraction = (numerator: number, denominator: number) => {
  if (numerator === 0) return '0s';
  const divisor = gcd(Math.abs(numerator), denominator);
  const top = numerator / divisor;
  const bottom = denominator / divisor;
  return bottom === 1 ? `${top}s` : `${top}/${bottom}s`;
};
const atFrame = (frame: number, p: Project) =>
  fraction(frame * p.fps.denominator, p.fps.numerator);
const atUs = (microseconds: number) => fraction(Math.round(microseconds), 1_000_000);
const sourceTime = (item: NleItem, localFrame: number, p: Project) =>
  atUs(item.sourceInUs + frameToUs(localFrame, p) * clipSpeed(item.clip));
const uri = (path: string) =>
  `./${path.split('/').map(encodeURIComponent).join('/')}`;

function videoFormatName(width: number, height: number, p: Project) {
  const rate = `${p.fps.numerator}/${p.fps.denominator}`;
  const suffix: Record<string, string> = {
    '24/1': '24',
    '25/1': '25',
    '30000/1001': '2997',
    '30/1': '30',
    '60000/1001': '5994',
    '60/1': '60',
  };
  const prefix: Record<string, string> = {
    '1920x1080': '1080',
    '1280x720': '720',
    '3840x2160': '3840x2160',
  };
  const size = prefix[`${width}x${height}`];
  return size && suffix[rate]
    ? `FFVideoFormat${size}p${suffix[rate]}`
    : 'FFVideoFormat1080p30';
}

function framesFor(
  item: NleItem,
  p: Project,
  keys: Array<keyof Clip['transform']>,
  forceEveryFrame = false,
) {
  const duration = item.durationFrames;
  const frames = new Set<number>([0, duration]);
  let dense = forceEveryFrame;
  for (const key of keys) {
    const animation = item.clip.transform[key];
    for (const keyframe of animation.keyframes)
      if (keyframe.frame >= 0 && keyframe.frame <= duration)
        frames.add(keyframe.frame);
    if (animation.keyframes.some((keyframe) => keyframe.easing !== 'linear'))
      dense = true;
  }
  if (dense) {
    const step = Math.max(1, Math.ceil(duration / 12000));
    for (let frame = 0; frame <= duration; frame += step) frames.add(frame);
  }
  return [...frames].sort((a, b) => a - b);
}

function parameter(
  name: string,
  frames: number[],
  item: NleItem,
  p: Project,
  value: (frame: number) => string,
) {
  return `<param name="${name}"><keyframeAnimation>${frames
    .map(
      (frame) =>
        `<keyframe time="${sourceTime(item, frame, p)}" value="${xml(value(frame))}"/>`,
    )
    .join('')}</keyframeAnimation></param>`;
}

function visualAdjustments(item: NleItem, asset: NleAsset, p: Project) {
  if (item.baked) return '';
  const c = item.clip;
  const t = c.transform;
  const crop = c.crop;
  const hasCrop = Object.values(crop).some((amount) => amount > 0);
  const sizeRatio = asset.generated
    ? Math.min(p.width / asset.width, p.height / asset.height)
    : 1;
  const nativeSize = {
    width: asset.width * Math.min(p.width / asset.width, p.height / asset.height),
    height: asset.height * Math.min(p.width / asset.width, p.height / asset.height),
  };
  const adjusted = (frame: number) => {
    const x = evaluate(t.x, frame);
    const y = evaluate(t.y, frame);
    const scaleX = evaluate(t.scaleX, frame);
    const scaleY = evaluate(t.scaleY, frame);
    const degrees = evaluate(t.rotation, frame);
    const dx = ((crop.left - crop.right) * nativeSize.width * scaleX) / 2;
    const dy = ((crop.top - crop.bottom) * nativeSize.height * scaleY) / 2;
    const angle = (degrees * Math.PI) / 180;
    const correctedX = x - (dx * Math.cos(angle) - dy * Math.sin(angle));
    const correctedY = y - (dx * Math.sin(angle) + dy * Math.cos(angle));
    return {
      position: `${fmt(((correctedX - p.width / 2) / p.height) * 100)} ${fmt((-(correctedY - p.height / 2) / p.height) * 100)}`,
      scale: `${fmt(scaleX / sizeRatio)} ${fmt(scaleY / sizeRatio)}`,
      rotation: fmt(-degrees),
    };
  };
  const hasTransformAnimation = (
    ['x', 'y', 'scaleX', 'scaleY', 'rotation'] as const
  ).some((key) => t[key].keyframes.length);
  const transformFrames = hasTransformAnimation
    ? framesFor(item, p, ['x', 'y', 'scaleX', 'scaleY', 'rotation'], hasCrop)
    : [];
  const initial = adjusted(0);
  const transformParams = transformFrames.length
    ? parameter('position', transformFrames, item, p, (f) => adjusted(f).position) +
      parameter('scale', transformFrames, item, p, (f) => adjusted(f).scale) +
      parameter('rotation', transformFrames, item, p, (f) => adjusted(f).rotation)
    : '';
  const cropXml = hasCrop
    ? `<adjust-crop mode="trim"><trim-rect left="${fmt((crop.left * asset.width * 100) / asset.height)}" top="${fmt(crop.top * 100)}" right="${fmt((crop.right * asset.width * 100) / asset.height)}" bottom="${fmt(crop.bottom * 100)}"/></adjust-crop>`
    : '';
  const transformXml = `<adjust-transform position="${initial.position}" scale="${initial.scale}" rotation="${initial.rotation}">${transformParams}</adjust-transform>`;
  const hasIncomingDissolve = p.tracks[item.trackIndex].clips.some(
    (other) => other.id !== c.id && other.transition === 'dissolve' &&
      other.startFrame > c.startFrame &&
      other.startFrame < c.startFrame + c.durationFrames,
  );
  const fade = c.transition !== 'none' && c.transitionFrames > 0;
  const opacityAnimated = t.opacity.keyframes.length > 0;
  let opacityFrames: number[] = [];
  if (opacityAnimated) opacityFrames = framesFor(item, p, ['opacity']);
  if (fade || hasIncomingDissolve) {
    const n = Math.min(c.transitionFrames, c.durationFrames / 2);
    const fadeFrames = [0, Math.ceil(n), Math.max(0, c.durationFrames - n), c.durationFrames];
    opacityFrames = [...new Set([...opacityFrames, ...fadeFrames])].sort((a, b) => a - b);
    if (c.transition === 'dissolve' || hasIncomingDissolve)
      opacityFrames = framesFor(item, p, ['opacity'], true);
  }
  const opacityAt = (frame: number) =>
    fmt(
      Math.max(0, Math.min(1, evaluate(t.opacity, frame) *
        (sceneAt(p, c.startFrame + Math.min(frame, c.durationFrames - 1))
          .find((entry) => entry.clip.id === c.id)?.alpha ?? 1))),
    );
  const blend = `<adjust-blend amount="${opacityAt(0)}">${
    opacityFrames.length
      ? parameter('amount', opacityFrames, item, p, opacityAt)
      : ''
  }</adjust-blend>`;
  return cropXml + transformXml + blend;
}

function audioAdjustment(item: NleItem, p: Project) {
  const c = item.clip;
  const amount = c.volumeDb <= -60 ? '-96dB' : `${fmt(c.volumeDb)}dB`;
  if (!c.fadeInFrames && !c.fadeOutFrames) return `<adjust-volume amount="${amount}"/>`;
  const frames = [
    0,
    Math.min(c.fadeInFrames, c.durationFrames),
    Math.max(0, c.durationFrames - c.fadeOutFrames),
    c.durationFrames,
  ];
  const value = (frame: number) => {
    const inGain = c.fadeInFrames
      ? Math.min(1, frame / c.fadeInFrames)
      : 1;
    const outGain = c.fadeOutFrames
      ? Math.min(1, (c.durationFrames - frame) / c.fadeOutFrames)
      : 1;
    const gain = Math.max(0, inGain * outGain);
    return gain === 0 ? '-96dB' : `${fmt(c.volumeDb + 20 * Math.log10(gain))}dB`;
  };
  return `<adjust-volume amount="${amount}">${parameter(
    'amount',
    [...new Set(frames)].sort((a, b) => a - b),
    item,
    p,
    value,
  )}</adjust-volume>`;
}

function timeMap(item: NleItem, p: Project) {
  const speed = clipSpeed(item.clip);
  if (speed === 1 || item.baked) return '';
  return `<timeMap frameSampling="floor" preservesPitch="0"><timept time="0s" value="0s" interp="linear"/><timept time="${atFrame(item.durationFrames, p)}" value="${atUs(frameToUs(item.durationFrames, p) * speed)}" interp="linear"/></timeMap>`;
}

function assignLanes(items: NleItem[], p: Project, visual: boolean) {
  const groups = new Map<number, NleItem[]>();
  for (const item of items) {
    const priority = item.clip.type === 'text' || item.clip.type === 'caption'
      ? 2
      : item.clip.type === 'shape'
        ? 1
        : 0;
    const group = visual
      ? priority * (p.tracks.length + 1) + (p.tracks.length - item.trackIndex)
      : item.trackIndex;
    const list = groups.get(group) || [];
    list.push(item);
    groups.set(group, list);
  }
  let nextLane = 1;
  const lanes = new Map<NleItem, number>();
  for (const group of [...groups.keys()].sort((a, b) => a - b)) {
    let overlapEnd = -1;
    let position = 0;
    let width = 1;
    const ordered = groups.get(group)!.sort(
      (a, b) => a.startFrame - b.startFrame || a.clip.id.localeCompare(b.clip.id),
    );
    for (const item of ordered) {
      if (item.startFrame >= overlapEnd) position = 0;
      else position++;
      overlapEnd = Math.max(overlapEnd, item.startFrame + item.durationFrames);
      width = Math.max(width, position + 1);
      lanes.set(item, visual ? nextLane + position : -(nextLane + position));
    }
    nextLane += width;
  }
  return lanes;
}

export function buildFcpxml(
  p: Project,
  assets: NleAsset[],
  items: NleItem[],
  backgroundId?: string,
) {
  const total = endFrame(p);
  if (!total) throw Error('書き出すクリップがありません');
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  const formatFor = new Map<string, string>();
  const formats = [`<format id="r1" name="${videoFormatName(p.width, p.height, p)}" frameDuration="${atFrame(1, p)}" width="${p.width}" height="${p.height}"/>`];
  let resource = 2;
  for (const asset of assets) {
    // Final Cut Pro checks the source frame rate when connecting media. The
    // project rate is not necessarily the rate of an imported video, so let
    // Final Cut Pro read the video format from the media file itself.
    if (asset.kind !== 'image') continue;
    const key = `${asset.width}x${asset.height}:${asset.kind === 'image' ? 'still' : 'video'}`;
    if (!formatFor.has(key)) {
      const id = `r${resource++}`;
      formatFor.set(key, id);
      formats.push(`<format id="${id}" name="FFVideoFormatRateUndefined" width="${asset.width}" height="${asset.height}"/>`);
    }
  }
  const ids = new Map(assets.map((asset) => [asset.id, `a${resource++}`]));
  const resources = assets.map((asset) => {
    const format = asset.kind === 'image'
      ? ` format="${formatFor.get(`${asset.width}x${asset.height}:still`)}"`
      : '';
    const video = asset.kind === 'audio' ? '' : ' hasVideo="1" videoSources="1"';
    const audio = asset.hasAudio || asset.kind === 'audio'
      ? ' hasAudio="1" audioSources="1" audioChannels="2" audioRate="48000"'
      : '';
    return `<asset id="${ids.get(asset.id)}" name="${xml(asset.name)}" start="${atUs(asset.timecodeStartUs || 0)}" duration="${atUs(asset.durationUs)}"${video}${format}${audio}><media-rep kind="original-media" src="${xml(uri(asset.path))}"/></asset>`;
  });
  const visualItems = items.filter((item) =>
    item.clip.type !== 'audio' && !item.audioOnly && !p.tracks[item.trackIndex].hidden,
  );
  const audioItems = items.filter((item) => {
    const asset = assetById.get(item.assetId);
    const track = p.tracks[item.trackIndex];
    return !item.baked && !!asset?.hasAudio && !track.muted &&
      !item.clip.muted && !item.clip.audioDetached && item.clip.volumeDb > -60;
  });
  const videoLanes = assignLanes(visualItems, p, true);
  const audioLanes = assignLanes(audioItems, p, false);
  const videos = visualItems.map((item) => {
    const asset = assetById.get(item.assetId)!;
    return `<video ref="${ids.get(item.assetId)}" lane="${videoLanes.get(item)! + (backgroundId ? 1 : 0)}" offset="${atFrame(item.startFrame, p)}" name="${xml(item.clip.name)}" start="${atUs(item.sourceInUs)}" duration="${atFrame(item.durationFrames, p)}">${timeMap(item, p)}${visualAdjustments(item, asset, p)}</video>`;
  });
  const audios = audioItems.map((item) =>
    `<audio ref="${ids.get(item.assetId)}" lane="${audioLanes.get(item)}" offset="${atFrame(item.startFrame, p)}" name="${xml(item.clip.name)}" start="${atUs(item.sourceInUs)}" duration="${atFrame(item.durationFrames, p)}">${timeMap(item, p)}${audioAdjustment(item, p)}</audio>`,
  );
  const background = backgroundId
    ? `<video ref="${ids.get(backgroundId)}" lane="1" offset="0s" name="背景" start="0s" duration="${atFrame(total, p)}"/>`
    : '';
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE fcpxml>\n<fcpxml version="1.10"><resources>${formats.join('')}${resources.join('')}</resources><library><event name="${xml(p.name)}"><project name="${xml(p.name)}"><sequence format="r1" duration="${atFrame(total, p)}" tcStart="0s" tcFormat="NDF" audioLayout="stereo" audioRate="48k"><spine><gap name="Cutpeak timeline" duration="${atFrame(total, p)}">${background}${videos.join('')}${audios.join('')}</gap></spine></sequence></project></event></library></fcpxml>\n`;
}
