import type { CellValue } from '../shared/contracts';
import { binaryCellZh as text } from './locales/binaryCell.zh-CN';

export const binaryCellLimits = { bytes: 2 * 1024 * 1024, editBytes: 131071, hexUnits: 262144, textBytes: 256 * 1024, pageBytes: 4096, dimension: 4096, pixels: 4194304 } as const;
export const binaryEncodings = ['utf-8', 'utf-16le', 'utf-16be', 'gb18030', 'windows-1252'] as const;
export type BinaryEncoding = typeof binaryEncodings[number];
export interface BinaryImage { format: 'PNG' | 'JPEG' | 'WebP'; mime: 'image/png' | 'image/jpeg' | 'image/webp'; width: number; height: number; }
/** 实际二进制包装值优先；NULL/DEFAULT 仅在明确二进制列类型时进入专用编辑器。 */
export function isBinaryCell(value: CellValue | undefined, type = ''): boolean { return value !== null && typeof value === 'object' && value.type === 'binary' || /^(?:TINYBLOB|BLOB|MEDIUMBLOB|LONGBLOB|BINARY|VARBINARY|BIT)\b/i.test(type); }

/** 仅按类型和长度计量，避免在预算判断前解码大型 Base64。 */
export function binaryByteLength(value: CellValue | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object' || value.type !== 'binary' || typeof value.base64 !== 'string') throw new Error(text.unsupported);
  return value.base64.length / 4 * 3 - (value.base64.endsWith('==') ? 2 : value.base64.endsWith('=') ? 1 : 0);
}
/** 只接受完整、规范的 Base64 原值；超限在分配二进制串和数组之前拒绝。 */
export function decodeBinaryCell(value: CellValue | undefined): Uint8Array | null {
  const size = binaryByteLength(value); if (size === null) return null;
  if (size > binaryCellLimits.bytes || (value as { base64: string }).base64.length > Math.ceil(binaryCellLimits.bytes / 3) * 4) throw new Error(text.byteLimit);
  const source = (value as { base64: string }).base64;
  if (source.length % 4 || /[^A-Za-z0-9+/=]/.test(source)) throw new Error(text.invalidBase64);
  let raw: string; try { raw = atob(source); if (btoa(raw) !== source) throw new Error(); } catch { throw new Error(text.invalidBase64); }
  return Uint8Array.from(raw, char => char.charCodeAt(0));
}
/** 编辑输入完整校验后才解码；空串对应零字节二进制，绝不隐式变成 NULL。 */
export function parseBinaryHex(input: string): Uint8Array {
  if (input.length > binaryCellLimits.hexUnits) throw new Error(text.editLimit);
  const hex = input.replace(/^0x/i, '').replace(/\s/g, '');
  if (!/^(?:[0-9a-fA-F]{2})*$/.test(hex)) throw new Error(text.hexInvalid);
  if (hex.length / 2 > binaryCellLimits.editBytes) throw new Error(text.editLimit);
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index++) bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}
/** 最终暂存复用查看器的原始字符和字节门；有界分段编码避免展开大型参数数组。 */
export function binaryCellFromHex(input: string): { type: 'binary'; base64: string } {
  const bytes = parseBinaryHex(input); let raw = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) raw += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return { type: 'binary', base64: btoa(raw) };
}
/** 只展开当前有界片段；分页查看的字符串不能作为完整值交给编辑路径。 */
export function binaryHexPage(bytes: Uint8Array, page = 0): string {
  const start = Math.max(0, Math.floor(page)) * binaryCellLimits.pageBytes;
  return Array.from(bytes.subarray(start, start + binaryCellLimits.pageBytes), byte => byte.toString(16).padStart(2, '0')).join(' ');
}
/** 严格解码只用于查看，保留 BOM；从不使用 replacement 模式或把文本反写为二进制。 */
export function decodeBinaryText(bytes: Uint8Array, encoding: BinaryEncoding): string {
  if (bytes.byteLength > binaryCellLimits.textBytes) throw new Error(text.textLimit);
  if (!binaryEncodings.includes(encoding)) throw new Error(text.decodeFailed);
  try { return new TextDecoder(encoding, { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw new Error(text.decodeFailed); }
}
/** 统一尺寸门在任何 Blob URL 或浏览器图像解码之前执行。 */
function imageSize(format: BinaryImage['format'], mime: BinaryImage['mime'], width: number, height: number): BinaryImage {
  if (!width || !height) throw new Error(text.imageInvalid);
  if (width > binaryCellLimits.dimension || height > binaryCellLimits.dimension || width * height > binaryCellLimits.pixels) throw new Error(text.pixels);
  return { format, mime, width, height };
}
/** 格式解析只读有限偏移，越界统一视为损坏，不把推测的 MIME 交给浏览器。 */
export function inspectBinaryImage(bytes: Uint8Array): BinaryImage {
  if (bytes.length > binaryCellLimits.bytes) throw new Error(text.byteLimit);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (offset: number, count: number) => String.fromCharCode(...bytes.subarray(offset, offset + count));
  const check = (condition: boolean) => { if (!condition) throw new Error(text.imageInvalid); };
  if (bytes.length >= 8 && bytes.subarray(0, 8).every((value, index) => value === [137, 80, 78, 71, 13, 10, 26, 10][index])) {
    let position = 8, image: BinaryImage | undefined, data = false, end = false, chunks = 0;
    while (position + 12 <= bytes.length) {
      const length = view.getUint32(position), kind = ascii(position + 4, 4); check(length <= bytes.length - position - 12);
      check(++chunks <= 4096);
      if (['acTL', 'fcTL', 'fdAT'].includes(kind)) throw new Error(text.animation);
      if (kind === 'IHDR') { check(position === 8 && !image && length === 13); image = imageSize('PNG', 'image/png', view.getUint32(position + 8), view.getUint32(position + 12)); }
      else check(!!image);
      if (kind === 'IDAT') data = true;
      position += length + 12;
      if (kind === 'IEND') { check(length === 0 && position === bytes.length); end = true; break; }
    }
    check(!!image && data && end); return image!;
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let position = 2, image: BinaryImage | undefined, scan = false, end = false, segments = 0, scans = 0;
    while (position < bytes.length) {
      if (bytes[position++] !== 0xff) { check(scan); continue; }
      while (bytes[position] === 0xff) position++;
      const marker = bytes[position++];
      if (marker === 0 || marker >= 0xd0 && marker <= 0xd7) { check(scan); continue; }
      if (marker === 0xd9) { check(position === bytes.length); end = true; break; }
      check(++segments <= 4096);
      check(position + 2 <= bytes.length); const length = view.getUint16(position); check(length >= 2 && position + length <= bytes.length);
      if ([0xc0, 0xc1, 0xc2].includes(marker)) { check(!image && length >= 8); image = imageSize('JPEG', 'image/jpeg', view.getUint16(position + 5), view.getUint16(position + 3)); }
      // 禁止重新定义高度或其它帧编码，不能让解码器使用未通过预算的第二份尺寸。
      else if (marker === 0xdc || marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) throw new Error(text.imageInvalid);
      if (marker === 0xda) { check(!!image && ++scans <= 64); scan = true; }
      position += length;
    }
    check(!!image && scan && end); return image!;
  }
  if (bytes.length >= 20 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    check(view.getUint32(4, true) + 8 === bytes.length);
    let position = 12, image: BinaryImage | undefined, payload: BinaryImage | undefined, chunks = 0;
    while (position + 8 <= bytes.length) {
      const kind = ascii(position, 4), size = view.getUint32(position + 4, true), data = position + 8; check(size <= bytes.length - data);
      check(++chunks <= 4096);
      if (kind === 'ANIM' || kind === 'ANMF') throw new Error(text.animation);
      if (kind === 'VP8X') { check(!image && position === 12 && size === 10); if (bytes[data] & 2) throw new Error(text.animation); image = imageSize('WebP', 'image/webp', 1 + bytes[data + 4] + (bytes[data + 5] << 8) + (bytes[data + 6] << 16), 1 + bytes[data + 7] + (bytes[data + 8] << 8) + (bytes[data + 9] << 16)); }
      if (kind === 'VP8 ') { check(!payload && size >= 10 && bytes[data + 3] === 0x9d && bytes[data + 4] === 1 && bytes[data + 5] === 0x2a); payload = imageSize('WebP', 'image/webp', view.getUint16(data + 6, true) & 0x3fff, view.getUint16(data + 8, true) & 0x3fff); }
      if (kind === 'VP8L') { check(!payload && size >= 5 && bytes[data] === 0x2f); const bits = view.getUint32(data + 1, true); check((bits >>> 29) === 0); payload = imageSize('WebP', 'image/webp', (bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1); }
      position = data + size + (size & 1);
    }
    check(position === bytes.length && !!payload && (!image || image.width === payload!.width && image.height === payload!.height)); return image ?? payload!;
  }
  throw new Error(text.imageUnsupported);
}
