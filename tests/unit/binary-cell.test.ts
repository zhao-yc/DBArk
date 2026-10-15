import { describe, expect, it } from 'vitest';
import { binaryByteLength, binaryCellLimits, binaryHexPage, decodeBinaryCell, decodeBinaryText, inspectBinaryImage, parseBinaryHex } from '../../src/renderer/binaryCell';
import { beginRecordDraft, editRecordInput, stageRecordDraft, type RecordContext } from '../../src/renderer/recordViews';
import type { DraftRow } from '../../src/renderer/dataChanges';

const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j04QAAAAASUVORK5CYII=', 'base64'));
describe('完整二进制查看与编辑边界', () => {
  it('Hex草稿复用原值与可靠键流程，保留原始字节；连接或本地值变化后拒绝旧编辑', () => {
    const original = { id: '18446744073709551615', payload: { type: 'binary' as const, base64: 'AP+A' } };
    const row: DraftRow = { id: 'row', data: structuredClone(original), original, inserted: false, deleted: false };
    const column = { name: 'payload', type: 'BLOB', generated: false, nullable: true, defaultValue: null, extra: '', comment: '' };
    const context: RecordContext = { target: { connectionId: 'c', database: 'd', table: 't' }, connectionVersion: 1, generation: 1, loaded: true, stale: false, busy: false, info: { database: 'd', name: 't', objectKind: 'table', engine: 'InnoDB', primaryKey: ['id'], editableKey: ['id'], columns: [column], indexes: [], foreignKeys: [], ddl: '' } };
    const draft = editRecordInput(beginRecordDraft(row, context), column, { mode: 'binary', text: '0xff0080' });
    const next = stageRecordDraft([row], draft, context); expect(next[0].data.payload).toEqual({ type: 'binary', base64: '/wCA' }); expect(next[0].original).toBe(original); expect(row.data.payload).toEqual({ type: 'binary', base64: 'AP+A' });
    for (const changed of [{ ...context, connectionVersion: 2 }, { ...context, generation: 2 }, { ...context, stale: true }]) expect(() => stageRecordDraft([row], draft, changed)).toThrow();
    expect(() => stageRecordDraft([{ ...row, data: { ...row.data } }], draft, context)).toThrow();
    const invalid = editRecordInput(beginRecordDraft(row, context), column, { mode: 'binary', text: '0x0' }); expect(() => stageRecordDraft([row], invalid, context)).toThrow();
    expect(stageRecordDraft([row], editRecordInput(beginRecordDraft(row, context), column, { mode: 'binary', text: '' }), context)[0].data.payload).toEqual({ type: 'binary', base64: '' });
  });
  it('SQL NULL、DEFAULT 和零字节二进制保持不同，拒绝字符串冒充原值', () => {
    expect(decodeBinaryCell(null)).toBeNull(); expect(decodeBinaryCell(undefined)).toBeNull(); expect(decodeBinaryCell({ type: 'binary', base64: '' })).toEqual(new Uint8Array());
    expect(binaryByteLength({ type: 'binary', base64: 'AP+A' })).toBe(3); expect(() => decodeBinaryCell('00ff')).toThrow();
  });
  it('规范Base64完整校验，超限先拒绝且不分配完整Hex', () => {
    for (const base64 of ['a', 'a===', 'AA=', 'AB==', 'AA==xx', '😃', '__8=']) expect(() => decodeBinaryCell({ type: 'binary', base64 })).toThrow();
    expect(() => decodeBinaryCell({ type: 'binary', base64: 'A'.repeat(Math.ceil(binaryCellLimits.bytes / 3) * 4 + 4) })).toThrow('2 MiB');
    expect(decodeBinaryCell({ type: 'binary', base64: 'AP+A' })).toEqual(new Uint8Array([0, 255, 128]));
  });
  it('Hex编辑只接受完整成对数字，支持空串、前缀和空白，明确限制编辑长度', () => {
    expect(parseBinaryHex('0x00 FF\n80 00')).toEqual(new Uint8Array([0, 255, 128, 0])); expect(parseBinaryHex('')).toEqual(new Uint8Array());
    for (const value of ['0', '0x1', 'zz', '0x00xx', '0x 0']) expect(() => parseBinaryHex(value)).toThrow();
    expect(() => parseBinaryHex('ff'.repeat(binaryCellLimits.editBytes + 1))).toThrow();
  });
  it('分页Hex只展开指定4096字节，不能把大型完整值分配成全部文本', () => {
    const bytes = new Uint8Array(binaryCellLimits.pageBytes + 2).fill(1); bytes[4096] = 255;
    expect(binaryHexPage(bytes).split(' ')).toHaveLength(4096); expect(binaryHexPage(bytes, 1)).toBe('ff 01');
  });
  it('严格UTF8/UTF16/中文编码查看，不以替代字符吞无效字节且保留BOM', () => {
    expect(decodeBinaryText(new TextEncoder().encode('中文😀'), 'utf-8')).toBe('中文😀');
    expect(decodeBinaryText(new Uint8Array([255, 254, 45, 78]), 'utf-16le')).toBe('\ufeff中');
    expect(decodeBinaryText(new Uint8Array([0xd6, 0xd0]), 'gb18030')).toBe('中');
    for (const [value, encoding] of [[new Uint8Array([0xff]), 'utf-8'], [new Uint8Array([0x2d]), 'utf-16le']] as const) expect(() => decodeBinaryText(value, encoding)).toThrow('解码');
    expect(() => decodeBinaryText(new Uint8Array(binaryCellLimits.textBytes + 1), 'utf-8')).toThrow('256 KiB');
  });
  it('PNG尺寸预检允许安全小图，像素/边长预算与截断错误在创建Blob前拒绝', () => {
    expect(inspectBinaryImage(png)).toEqual({ format: 'PNG', mime: 'image/png', width: 1, height: 1 });
    const huge = png.slice(); new DataView(huge.buffer).setUint32(16, 5000); expect(() => inspectBinaryImage(huge)).toThrow('预算');
    const manyPixels = png.slice(); const view = new DataView(manyPixels.buffer); view.setUint32(16, 3000); view.setUint32(20, 3000); expect(() => inspectBinaryImage(manyPixels)).toThrow('预算');
    for (const count of [0, 10, 25, png.length - 1]) expect(() => inspectBinaryImage(png.slice(0, count))).toThrow();
  });
  it('SVG、HTML、GIF与APNG被拒绝，不推测外部路径、URL或可执行格式', () => {
    for (const value of ['<svg onload="alert(1)"></svg>', '<html><script>alert(1)</script>', 'GIF89a', 'https://example.com/x.png']) expect(() => inspectBinaryImage(new TextEncoder().encode(value))).toThrow('支持');
    const animated = new Uint8Array(png.length + 12); animated.set(png.subarray(0, 33)); animated.set(new TextEncoder().encode('acTL'), 37); animated.set(png.subarray(33), 45); expect(() => inspectBinaryImage(animated)).toThrow('动画');
  });
  it('JPEG与WebP的结构门检查实际帧尺寸，拒绝高度重定义、动画和不完整容器', () => {
    const jpeg = new Uint8Array([255,216,255,192,0,8,8,0,1,0,2,0,255,218,0,2,1,255,217]);
    expect(inspectBinaryImage(jpeg)).toMatchObject({ format: 'JPEG', width: 2, height: 1 });
    expect(() => inspectBinaryImage(jpeg.slice(0, -2))).toThrow();
    const webp = new Uint8Array(26); webp.set(new TextEncoder().encode('RIFF')); new DataView(webp.buffer).setUint32(4, 18, true); webp.set(new TextEncoder().encode('WEBPVP8L'), 8); new DataView(webp.buffer).setUint32(16, 5, true); webp[20] = 0x2f;
    expect(inspectBinaryImage(webp)).toMatchObject({ format: 'WebP', width: 1, height: 1 });
    webp.set(new TextEncoder().encode('ANIM'), 12); expect(() => inspectBinaryImage(webp)).toThrow('动画');
  });
});
