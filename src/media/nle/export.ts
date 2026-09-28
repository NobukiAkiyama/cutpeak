import { endFrame, type Asset, type Project } from '../../core/model';
import { MediaEngine } from '../engine';
import { canvasOf, isolatedClipSurface, staticClipSurface } from '../../render/renderer';
import { buildFcpxml, type NleAsset, type NleItem } from './fcpxml';
import { makeZip, type ZipEntry } from './zip';
import { quickTimeStartUs } from './timecode';

export interface NleExportJob {
  project: Project;
  files: { id: string; file: File }[];
}

export function usedAssetIds(project: Project) {
  return new Set(
    project.tracks.flatMap((track) =>
      track.clips.flatMap((clip) => clip.assetId ? [clip.assetId] : []),
    ),
  );
}

export function bakedClips(project: Project) {
  return project.tracks.flatMap((track) =>
    track.clips.filter((clip) => {
      if (track.hidden || clip.type === 'audio') return false;
      const asset = project.assets.find((item) => item.id === clip.assetId);
      return !!clip.puppet?.pins.length ||
        (asset?.mime === 'image/gif' || /\.gif$/i.test(asset?.name || ''));
    }),
  );
}

const basename = (name: string) =>
  Array.from(name.normalize('NFC'))
    .map((character) =>
      character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 ||
      '\\/<>:"|?*'.includes(character) ? '_' : character,
    )
    .join('').trim() || 'media';
export const packageName = (name: string) =>
  `${basename(name).replace(/\.+$/, '') || 'Cutpeak'}_編集ソフト用.zip`;

async function png(surface: OffscreenCanvas | HTMLCanvasElement) {
  if ('convertToBlob' in surface)
    return surface.convertToBlob({ type: 'image/png' });
  return new Promise<Blob>((resolve, reject) =>
    surface.toBlob(
      (result: Blob | null) => result ? resolve(result) : reject(Error('PNG を生成できません')),
      'image/png',
    ),
  );
}

function fromAsset(asset: Asset, path: string, timecodeStartUs = 0): NleAsset {
  return {
    id: asset.id,
    name: asset.name,
    path,
    kind: asset.kind,
    width: Math.max(1, asset.width || 1),
    height: Math.max(1, asset.height || 1),
    durationUs: asset.durationUs,
    hasAudio: asset.hasAudio,
    timecodeStartUs,
  };
}

export async function runNleExport(
  job: NleExportJob,
  onProgress: (value: number) => void,
  isCancelled: () => boolean,
): Promise<Blob> {
  const p = job.project;
  if (!endFrame(p)) throw Error('書き出すクリップがありません');
  const used = usedAssetIds(p);
  const files = new Map(job.files.map((entry) => [entry.id, entry.file]));
  const missing = [...used].filter((id) => !files.has(id));
  if (missing.length)
    throw Error('未接続の素材があります。メディアから再接続してください。');
  const zip: ZipEntry[] = [];
  const assets: NleAsset[] = [];
  const items: NleItem[] = [];
  const generated = new Set<string>();
  const sourceOrigins = new Map<string, number>();
  const projectName = basename(p.name).replace(/\.+$/, '') || 'Cutpeak';
  for (const [index, asset] of p.assets.filter((asset) => used.has(asset.id)).entries()) {
    const file = files.get(asset.id)!;
    const path = `media/${String(index + 1).padStart(3, '0')}_${basename(file.name)}`;
    zip.push({ name: path, data: file });
    const timecodeStartUs = asset.kind === 'video' && /\.(mov|mp4|m4v)$/i.test(file.name)
      ? await quickTimeStartUs(file)
      : 0;
    sourceOrigins.set(asset.id, timecodeStartUs);
    assets.push(fromAsset(asset, path, timecodeStartUs));
  }
  onProgress(0.04);
  const addGenerated = (id: string, name: string, blob: Blob, width: number, height: number) => {
    const path = `media/${basename(name)}`;
    if (generated.has(path)) throw Error('生成した素材名が重複しています');
    generated.add(path);
    zip.push({ name: path, data: blob });
    assets.push({ id, name, path, kind: 'image', width, height, durationUs: 0, hasAudio: false, generated: true });
  };
  let backgroundId: string | undefined;
  if (p.background.toLowerCase() !== '#000000') {
    const surface = canvasOf(p.width, p.height);
    const ctx = surface.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
    ctx.fillStyle = p.background;
    ctx.fillRect(0, 0, p.width, p.height);
    backgroundId = 'cutpeak-background';
    addGenerated(backgroundId, 'cutpeak-background.png', await png(surface), p.width, p.height);
  }
  const baked = bakedClips(p);
  const bakeSet = new Set(baked.map((clip) => clip.id));
  const bakedAssetIds = new Set(baked.flatMap((clip) => clip.assetId ? [clip.assetId] : []));
  const totalBakeFrames = baked.reduce((sum, clip) => sum + clip.durationFrames, 0);
  if (totalBakeFrames > 60000)
    throw Error('動く効果の画像化が 60,000 フレームを超えます。対象の尺を短くしてください。');
  const engine = totalBakeFrames ? new MediaEngine() : undefined;
  try {
    if (engine)
      for (const entry of job.files)
        if (bakedAssetIds.has(entry.id)) await engine.register(entry.id, entry.file);
    let bakedFrames = 0;
    for (const [trackIndex, track] of p.tracks.entries()) {
      for (const clip of track.clips) {
        if (isCancelled()) throw Error('書き出しを中止しました');
        if (!bakeSet.has(clip.id)) {
          let assetId = clip.assetId;
          if (!assetId && clip.type !== 'audio') {
            const surface = staticClipSurface(clip, p);
            assetId = `generated-${clip.id}`;
            addGenerated(assetId, `cutpeak-${clip.id}.png`, await png(surface), surface.width, surface.height);
          }
          if (assetId)
            items.push({ clip, trackIndex, assetId, startFrame: clip.startFrame,
              durationFrames: clip.durationFrames,
              sourceInUs: clip.sourceInUs + (sourceOrigins.get(assetId) || 0) });
          continue;
        }
        if (!engine) throw Error('画像化エンジンを利用できません');
        const onlyClip: Project = { ...p, tracks: [{ ...track, hidden: false, clips: [clip] }] };
        let previous: Uint8Array | undefined;
        let segment: NleItem | undefined;
        for (let localFrame = 0; localFrame < clip.durationFrames; localFrame++) {
          if (isCancelled()) throw Error('書き出しを中止しました');
          const frame = clip.startFrame + localFrame;
          const images = await engine.sceneFrames(onlyClip, frame, p.width);
          try {
            const bitmap = images.find((image) => image.clipId === clip.id)?.bitmap;
            if (clip.assetId && !bitmap)
              throw Error(`${clip.name}: フレームを読み込めません`);
            const surface = isolatedClipSurface(
              clip, p, frame, bitmap,
            );
            const blob = await png(surface);
            const bytes = new Uint8Array(await blob.arrayBuffer());
            const same = previous?.length === bytes.length &&
              previous.every((byte, index) => byte === bytes[index]);
            if (same && segment) segment.durationFrames++;
            else {
              const id = `baked-${clip.id}-${localFrame}`;
              addGenerated(id, `${id}.png`, blob, p.width, p.height);
              segment = { clip, trackIndex, assetId: id,
                startFrame: frame, durationFrames: 1, sourceInUs: 0, baked: true };
              items.push(segment);
              previous = bytes;
            }
          } finally {
            images.forEach((image) => image.bitmap.close());
          }
          bakedFrames++;
          if (bakedFrames % 5 === 0)
            onProgress(0.05 + (bakedFrames / totalBakeFrames) * 0.65);
        }
        if (clip.assetId && p.assets.find((asset) => asset.id === clip.assetId)?.hasAudio)
          items.push({ clip, trackIndex, assetId: clip.assetId,
            startFrame: clip.startFrame, durationFrames: clip.durationFrames,
            sourceInUs: clip.sourceInUs + (sourceOrigins.get(clip.assetId) || 0), audioOnly: true });
      }
    }
  } finally {
    engine?.dispose();
  }
  if (isCancelled()) throw Error('書き出しを中止しました');
  onProgress(0.72);
  const fcpxml = buildFcpxml(p, assets, items, backgroundId);
  zip.unshift({ name: `${projectName}.fcpxml`, data: new Blob([fcpxml], { type: 'application/xml' }) });
  const instructions = [
    `${p.name} — 編集ソフト用書き出し`,
    '',
    'Final Cut Pro: ZIP を展開し、ファイル > 読み込む > XML で .fcpxml を開きます。',
    '素材が見つからない警告が出たら、読み込んだイベントを選択し、ファイル > ファイルを再接続 > オリジナルのメディアから、展開した media フォルダ内の素材を指定します。',
    'DaVinci Resolve: ZIP を「ムービー」など Resolve が参照できる場所に展開します。',
    'ファイル > 読み込み > タイムラインで .fcpxml を開き、素材が見つからない場合は展開した media フォルダを指定して再リンクします。',
    '',
    '文字・図形は透明 PNG に、アニメーション GIF・パペット変形は連続した PNG クリップに変換しています。',
    'この部分の文字内容や変形の形は編集ソフト側で直接編集できません。',
    '元の Cutpeak プロジェクトや編集履歴はこの ZIP に含まれません。',
  ].join('\n');
  zip.push({ name: 'README.txt', data: new Blob([instructions], { type: 'text/plain;charset=utf-8' }) });
  return makeZip(zip, (value) => onProgress(0.72 + value * 0.28), isCancelled);
}
