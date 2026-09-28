import { describe, expect, it } from 'vitest';
import { makeClip, makeProject } from '../src/core/model';
import { buildFcpxml } from '../src/media/nle/fcpxml';
import { makeZip } from '../src/media/nle/zip';
import { quickTimeStartUs } from '../src/media/nle/timecode';

describe('編集ソフト用書き出し', () => {
  it('MOV のタイムコードトラックから素材の開始時刻を読む', async () => {
    const u32 = (value: number) => {
      const bytes = new Uint8Array(4);
      new DataView(bytes.buffer).setUint32(0, value);
      return bytes;
    };
    const join = (...parts: Uint8Array[]) => {
      const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
      let at = 0;
      for (const part of parts) { bytes.set(part, at); at += part.length; }
      return bytes;
    };
    const box = (type: string, ...parts: Uint8Array[]) => {
      const data = join(...parts);
      return join(u32(data.length + 8), new TextEncoder().encode(type), data);
    };
    const entry = new Uint8Array(36);
    const description = new DataView(entry.buffer);
    description.setUint32(0, 36);
    entry.set(new TextEncoder().encode('tmcd'), 4);
    description.setUint32(24, 12288);
    description.setUint32(28, 512);
    entry[32] = 24;
    const movie = new Blob([
      box('mdat', u32(86400)),
      box('moov', box('trak', box('mdia',
        box('hdlr', join(u32(0), new TextEncoder().encode('mhlrtmcd'))),
        box('minf', box('stbl',
          box('stsd', u32(0), u32(1), entry),
          box('stco', u32(0), u32(1), u32(8)),
        )),
      ))),
    ]);
    expect(await quickTimeStartUs(movie)).toBe(3_600_000_000);
  });

  it('29.97fps、異寸法クロップ、音声、名前を FCPXML に保つ', () => {
    const project = makeProject('旅 & 編集', 1920, 1080, {
      numerator: 30000,
      denominator: 1001,
    });
    const asset = {
      id: 'a', name: '素材 & A.mp4', kind: 'video' as const,
      mime: 'video/mp4', size: 100, durationUs: 10_000_000,
      firstTimestampUs: 0, width: 1280, height: 720, hasAudio: true,
    };
    project.assets = [asset];
    const clip = makeClip(project, 'video', 0, asset);
    clip.durationFrames = 90;
    clip.crop.left = 0.1;
    clip.volumeDb = -6;
    project.tracks[1].clips = [clip];
    const content = buildFcpxml(
      project,
      [{ id: 'a', name: asset.name, path: 'media/001_素材 & A.mp4',
        kind: 'video', width: 1280, height: 720,
        durationUs: asset.durationUs, hasAudio: true }],
      [{ clip, trackIndex: 1, assetId: 'a', startFrame: 0,
        durationFrames: 90, sourceInUs: 0 }],
    );
    expect(content).toContain('frameDuration="1001/30000s"');
    expect(content).toContain('<format id="r1" name="FFVideoFormat1080p2997" frameDuration="1001/30000s" width="1920" height="1080"/>');
    expect(content).not.toContain('FFVideoFormat720p2997');
    expect(content).toContain('name="素材 &amp; A.mp4" start="0s" duration="10s" hasVideo="1" videoSources="1" hasAudio="1"');
    expect(content).not.toContain('FFVideoFormat1920x1080');
    expect(content).toContain('duration="3003/1000s"');
    expect(content).toContain('left="17.777778"');
    expect(content).toContain('name="旅 &amp; 編集"');
    expect(content).toContain('src="./media/001_%E7%B4%A0%E6%9D%90%20%26%20A.mp4"');
    expect(content).toContain('<audio ref=');
    expect(content).toContain('amount="-6dB"');
  });

  it('動画素材のタイムコード起点を映像と音声の編集位置に反映する', () => {
    const project = makeProject();
    const asset = {
      id: 'movie', name: 'timecode.mov', kind: 'video' as const,
      mime: 'video/quicktime', size: 100, durationUs: 10_000_000,
      firstTimestampUs: 0, width: 1920, height: 1080, hasAudio: true,
    };
    project.assets = [asset];
    const clip = makeClip(project, 'video', 0, asset);
    clip.sourceInUs = 2_000_000;
    clip.durationFrames = 60;
    project.tracks[1].clips = [clip];
    const content = buildFcpxml(project,
      [{ id: asset.id, name: asset.name, path: 'media/timecode.mov',
        kind: 'video', width: 1920, height: 1080,
        durationUs: asset.durationUs, hasAudio: true,
        timecodeStartUs: 3_600_000_000 }],
      [{ clip, trackIndex: 1, assetId: asset.id, startFrame: 0,
        durationFrames: 60, sourceInUs: 3_602_000_000 }],
    );
    expect(content).toContain('name="timecode.mov" start="3600s" duration="10s"');
    expect(content).toContain('<video ref=');
    expect(content).toContain('<audio ref=');
    expect(content.match(/start="3602s" duration="2s"/g)).toHaveLength(2);
  });

  it('ZIP に日本語ファイルと素材を無圧縮で格納する', async () => {
    const blob = await makeZip([
      { name: 'README.txt', data: new Blob(['説明']) },
      { name: 'media/素材.mp4', data: new Blob([new Uint8Array([0, 1, 2, 3])]) },
    ]);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const view = new DataView(bytes.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint16(8, true)).toBe(0);
    expect(view.getUint16(12, true)).toBeGreaterThan(0);
    expect(view.getUint32(bytes.length - 22, true)).toBe(0x06054b50);
    expect(view.getUint16(bytes.length - 12, true)).toBe(2);
  });

  it('画像化した文字を原寸で配置し、2倍速の素材時刻を保つ', () => {
    const project = makeProject();
    const text = makeClip(project, 'text', 15);
    text.durationFrames = 60;
    project.tracks[0].clips = [text];
    const video = makeClip(project, 'video', 0);
    video.assetId = 'source';
    video.durationFrames = 60;
    video.sourceInUs = 1_000_000;
    video.speed = 2;
    project.tracks[1].clips = [video];
    const content = buildFcpxml(
      project,
      [
        { id: 'source', name: 'source.mp4', path: 'media/source.mp4',
          kind: 'video', width: 1920, height: 1080,
          durationUs: 10_000_000, hasAudio: false },
        { id: 'text', name: 'title.png', path: 'media/title.png',
          kind: 'image', width: 600, height: 200,
          durationUs: 0, hasAudio: false, generated: true },
      ],
      [
        { clip: text, trackIndex: 0, assetId: 'text', startFrame: 15,
          durationFrames: 60, sourceInUs: 0 },
        { clip: video, trackIndex: 1, assetId: 'source', startFrame: 0,
          durationFrames: 60, sourceInUs: 1_000_000 },
      ],
    );
    expect(content).toContain('scale="0.3125 0.3125"');
    expect(content).toContain('name="FFVideoFormatRateUndefined" width="600" height="200"');
    expect(content).toContain('value="4s" interp="linear"');
    expect(content).toContain('start="1s" duration="2s"');
  });

  it('縦長のカスタム画面サイズでも有効な既定形式と実寸を出す', () => {
    const project = makeProject('縦長', 1080, 1920);
    const clip = makeClip(project, 'text', 0);
    project.tracks[0].clips = [clip];
    const content = buildFcpxml(project, [], []);
    expect(content).toContain('<format id="r1" name="FFVideoFormat1080p30" frameDuration="1/30s" width="1080" height="1920"/>');
  });
});
