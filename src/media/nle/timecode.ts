// QuickTime timecode tracks store the source timecode as a frame number in
// their first sample. FCPXML source times must include that origin.
interface Box {
  type: string;
  start: number;
  end: number;
  header: number;
}

const kind = (bytes: Uint8Array, at: number) =>
  String.fromCharCode(...bytes.subarray(at, at + 4));

function* boxes(bytes: Uint8Array, from: number, to: number): Generator<Box> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let at = from; at + 8 <= to;) {
    let size = view.getUint32(at);
    let header = 8;
    if (size === 1) {
      if (at + 16 > to) return;
      size = Number(view.getBigUint64(at + 8));
      header = 16;
    } else if (size === 0) size = to - at;
    if (!Number.isSafeInteger(size) || size < header || at + size > to) return;
    yield { type: kind(bytes, at + 4), start: at, end: at + size, header };
    at += size;
  }
}

function child(bytes: Uint8Array, parent: Box, type: string) {
  return [...boxes(bytes, parent.start + parent.header, parent.end)]
    .find((box) => box.type === type);
}

function timecodeSample(moov: Uint8Array) {
  const root: Box = { type: 'moov', start: 0, end: moov.length, header: 8 };
  const view = new DataView(moov.buffer, moov.byteOffset, moov.byteLength);
  for (const track of boxes(moov, root.header, root.end)) {
    if (track.type !== 'trak') continue;
    const media = child(moov, track, 'mdia');
    if (!media) continue;
    const handler = child(moov, media, 'hdlr');
    if (!handler || kind(moov, handler.start + handler.header + 8) !== 'tmcd') continue;
    const minf = child(moov, media, 'minf');
    const table = minf && child(moov, minf, 'stbl');
    if (!table) continue;
    const description = child(moov, table, 'stsd');
    const offsets = child(moov, table, 'stco') || child(moov, table, 'co64');
    if (!description || !offsets) continue;
    const entry = description.start + description.header + 8;
    if (entry + 33 > description.end || kind(moov, entry + 4) !== 'tmcd') continue;
    const timeScale = view.getUint32(entry + 24);
    const frameDuration = view.getUint32(entry + 28);
    const offsetAt = offsets.start + offsets.header + 8;
    if (!timeScale || !frameDuration || offsetAt + (offsets.type === 'co64' ? 8 : 4) > offsets.end) continue;
    const offset = offsets.type === 'co64'
      ? Number(view.getBigUint64(offsetAt))
      : view.getUint32(offsetAt);
    if (Number.isSafeInteger(offset)) return { offset, timeScale, frameDuration };
  }
  return null;
}

export async function quickTimeStartUs(file: Blob): Promise<number> {
  let at = 0;
  while (at + 8 <= file.size) {
    const header = new Uint8Array(await file.slice(at, at + 16).arrayBuffer());
    if (header.length < 8) break;
    const view = new DataView(header.buffer);
    let size = view.getUint32(0);
    const type = kind(header, 4);
    if (size === 1) {
      if (header.length < 16) break;
      size = Number(view.getBigUint64(8));
    } else if (size === 0) size = file.size - at;
    if (!Number.isSafeInteger(size) || size < 8 || at + size > file.size) break;
    if (type === 'moov') {
      if (size > 64 * 1024 * 1024) return 0;
      const moov = new Uint8Array(await file.slice(at, at + size).arrayBuffer());
      const sample = timecodeSample(moov);
      if (!sample || sample.offset + 4 > file.size) return 0;
      const value = new DataView(await file.slice(sample.offset, sample.offset + 4).arrayBuffer());
      return Math.round(value.getInt32(0) * sample.frameDuration * 1_000_000 / sample.timeScale);
    }
    at += size;
  }
  return 0;
}
