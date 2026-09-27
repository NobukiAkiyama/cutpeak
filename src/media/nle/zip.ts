// ZIP store entries without copying media into one large byte array. Media is
// already compressed, so recompressing it would add time without much benefit.
const encoder = new TextEncoder();
const u16 = (view: DataView, offset: number, value: number) =>
  view.setUint16(offset, value, true);
const u32 = (view: DataView, offset: number, value: number) =>
  view.setUint32(offset, value >>> 0, true);
const u64 = (view: DataView, offset: number, value: number) =>
  view.setBigUint64(offset, BigInt(value), true);
const MAX32 = 0xffffffff;

function dosTimestamp(date: Date) {
  const year = Math.max(1980, Math.min(2107, date.getFullYear()));
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) |
      Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) |
      date.getDate(),
  };
}

let crcTable: Uint32Array | undefined;
function crc32(previous: number, chunk: Uint8Array) {
  crcTable ??= Uint32Array.from({ length: 256 }, (_, index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit++)
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    return value >>> 0;
  });
  let value = previous;
  for (const byte of chunk) value = crcTable[(value ^ byte) & 255] ^ (value >>> 8);
  return value >>> 0;
}

async function checksum(blob: Blob, cancelled: () => boolean) {
  const reader = blob.stream().getReader();
  let value = 0xffffffff;
  try {
    while (true) {
      if (cancelled()) throw Error('書き出しを中止しました');
      const { done, value: chunk } = await reader.read();
      if (done) break;
      value = crc32(value, chunk);
    }
  } finally {
    reader.releaseLock();
  }
  return (value ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  name: string;
  data: Blob;
}

export async function makeZip(
  entries: ZipEntry[],
  progress: (value: number) => void = () => {},
  cancelled: () => boolean = () => false,
): Promise<Blob> {
  if (entries.length > 65535) throw Error('ZIP のファイル数が上限を超えています');
  const parts: BlobPart[] = [];
  const directory: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;
  const seen = new Set<string>();
  const modified = dosTimestamp(new Date());
  for (let index = 0; index < entries.length; index++) {
    const { name, data } = entries[index];
    if (
      !name ||
      name.startsWith('/') ||
      name.includes('\\') ||
      name.split('/').some((part) => part === '..' || part === '') ||
      seen.has(name)
    )
      throw Error('ZIP 内のファイル名が不正または重複しています');
    seen.add(name);
    const path = encoder.encode(name);
    if (path.length > 65535) throw Error('ZIP 内のファイル名が長すぎます');
    const size = data.size;
    if (!Number.isSafeInteger(size)) throw Error('素材のサイズが大きすぎます');
    const crc = await checksum(data, cancelled);
    const large = size >= MAX32;
    const extraLength = large ? 20 : 0;
    const local = new Uint8Array(30 + path.length + extraLength);
    const lv = new DataView(local.buffer);
    u32(lv, 0, 0x04034b50);
    u16(lv, 4, large ? 45 : 20);
    u16(lv, 6, 0x0800); // UTF-8 names
    u16(lv, 8, 0); // Stored, without compression
    u16(lv, 10, modified.time);
    u16(lv, 12, modified.date);
    u32(lv, 14, crc);
    u32(lv, 18, large ? MAX32 : size);
    u32(lv, 22, large ? MAX32 : size);
    u16(lv, 26, path.length);
    u16(lv, 28, extraLength);
    local.set(path, 30);
    if (large) {
      u16(lv, 30 + path.length, 0x0001);
      u16(lv, 32 + path.length, 16);
      u64(lv, 34 + path.length, size);
      u64(lv, 42 + path.length, size);
    }
    parts.push(local, data);

    const largeOffset = offset >= MAX32;
    const centralExtra = (large ? 16 : 0) + (largeOffset ? 8 : 0);
    const central = new Uint8Array(
      46 + path.length + (centralExtra ? centralExtra + 4 : 0),
    );
    const cv = new DataView(central.buffer);
    u32(cv, 0, 0x02014b50);
    u16(cv, 4, 45);
    u16(cv, 6, large || largeOffset ? 45 : 20);
    u16(cv, 8, 0x0800);
    u16(cv, 10, 0);
    u16(cv, 12, modified.time);
    u16(cv, 14, modified.date);
    u32(cv, 16, crc);
    u32(cv, 20, large ? MAX32 : size);
    u32(cv, 24, large ? MAX32 : size);
    u16(cv, 28, path.length);
    u16(cv, 30, centralExtra ? centralExtra + 4 : 0);
    u32(cv, 42, largeOffset ? MAX32 : offset);
    central.set(path, 46);
    if (centralExtra) {
      const at = 46 + path.length;
      u16(cv, at, 0x0001);
      u16(cv, at + 2, centralExtra);
      let cursor = at + 4;
      if (large) {
        u64(cv, cursor, size);
        u64(cv, cursor + 8, size);
        cursor += 16;
      }
      if (largeOffset) u64(cv, cursor, offset);
    }
    directory.push(central);
    offset += local.length + size;
    progress((index + 1) / entries.length);
  }
  const directoryOffset = offset;
  for (const item of directory) {
    parts.push(item);
    offset += item.length;
  }
  const directorySize = offset - directoryOffset;
  const needsZip64 = directoryOffset >= MAX32 || directorySize >= MAX32;
  if (needsZip64) {
    const record = new Uint8Array(56);
    const view = new DataView(record.buffer);
    u32(view, 0, 0x06064b50);
    u64(view, 4, 44);
    u16(view, 12, 45);
    u16(view, 14, 45);
    u64(view, 24, entries.length);
    u64(view, 32, entries.length);
    u64(view, 40, directorySize);
    u64(view, 48, directoryOffset);
    parts.push(record);
    const locator = new Uint8Array(20);
    const locatorView = new DataView(locator.buffer);
    u32(locatorView, 0, 0x07064b50);
    u64(locatorView, 8, offset);
    u32(locatorView, 16, 1);
    parts.push(locator);
  }
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  u32(ev, 0, 0x06054b50);
  u16(ev, 8, entries.length);
  u16(ev, 10, entries.length);
  u32(ev, 12, needsZip64 ? MAX32 : directorySize);
  u32(ev, 16, needsZip64 ? MAX32 : directoryOffset);
  parts.push(end);
  return new Blob(parts, { type: 'application/zip' });
}
