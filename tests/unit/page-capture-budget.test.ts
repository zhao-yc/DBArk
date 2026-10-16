import { describe, expect, it, vi } from 'vitest';
import type { TableInfo } from '../../src/shared/contracts';
import type { DraftRow } from '../../src/renderer/dataChanges';
import { assertPageFindTransfer, pageFindLimits, previewPageReplacementInWorker, type PageFindOptions, type PageOccurrence } from '../../src/renderer/pageFindReplace';
import { PageTextSize, type PageTextSpan } from '../../src/renderer/pageFindText';
import { tableGridZh as text } from '../../src/renderer/locales/tableGrid.zh-CN';

const info: TableInfo = { database: '纯预算', name: '捕获前检', engine: 'InnoDB', objectKind: 'table', editableKey: ['id'], primaryKey: ['id'], indexes: [], foreignKeys: [], ddl: '', columns: [{ name: 'note', type: 'TEXT', nullable: true, generated: false, defaultValue: null, extra: '', comment: '' }] };
const options: PageFindOptions = { kind: 'text', query: '(?=X)', regex: true, captureReplacement: true, caseSensitive: true, wholeCell: false };
/** 行快照与data保持分离，旁列也参与完整预览预算，不能只测最终note长度。 */
function rows(source: string, side?: string, count = 1): DraftRow[] { return Array.from({ length: count }, (_, index) => ({ id: '行' + index, inserted: false, deleted: false, data: { note: source, ...(side === undefined ? {} : { side }) }, original: { note: source, ...(side === undefined ? {} : { side }) } })); }

/** 在大join及编码的分配入口安全拦截，不依赖实际内存耗尽证明前置预算。 */
function rejectsBeforeAllocation(data: DraftRow[], replacement: string, config = info, only?: PageOccurrence) {
  assertPageFindTransfer({ operation: 'preview', rows: data, keys: ['note'], options, replacement, info: config, generation: 1, only });
  const oldJoin = Array.prototype.join, oldEncode = TextEncoder.prototype.encode;
  let attemptedJoin = 0, attemptedEncoding = 0, failure: unknown;
  const join = vi.spyOn(Array.prototype, 'join').mockImplementation(function(this: unknown[], separator?: string) {
    const units = this.reduce<number>((sum, value) => sum + (typeof value === 'string' ? value.length : 0), 0);
    if (separator === '' && units >= 1024 * 1024) { attemptedJoin = units; throw Error('测试拦截预算预检前大join'); }
    return oldJoin.call(this, separator);
  });
  const encode = vi.spyOn(TextEncoder.prototype, 'encode').mockImplementation(function(this: TextEncoder, value?: string) { if ((value?.length ?? 0) >= 1024 * 1024) { attemptedEncoding = value!.length; throw Error('测试拦截预算预检前大编码'); } return oldEncode.call(this, value); });
  const clone = vi.spyOn(globalThis, 'structuredClone'); let clones = 0;
  try { previewPageReplacementInWorker(data, ['note'], options, replacement, config, 1, only); } catch (error) { failure = error; }
  finally { clones = clone.mock.calls.length; clone.mockRestore(); encode.mockRestore(); join.mockRestore(); }
  expect((failure as Error)?.message).toBe(text.budget); expect(attemptedJoin).toBe(0); expect(attemptedEncoding).toBe(0); expect(clones).toBe(0);
  data.forEach(row => { expect(row.data.note).toBe(row.original!.note); expect(row.data.side).toBe(row.original!.side); });
}

describe('捕获输出在全范围预算通过前不得分配', () => {
  it.each([false, true])('员工3原单格反例保留，单处=%s：16MiB展开加原文即超限', only => {
    const data = rows('a'.repeat(32768) + 'X'); rejectsBeforeAllocation(data, '$`'.repeat(512), info, only ? { rowId: data[0].id, key: 'note', range: { start: 32768, end: 32768 }, occurrence: 1 } : undefined);
  });
  it('员工3原跨格反例保留：两格各8MiB，累计超限前不能构造任一格', () => { rejectsBeforeAllocation(rows('a'.repeat(16384) + 'X', undefined, 2), '$`'.repeat(512)); });
  it('员工3原整行反例保留：合法请求含data/original旁列各4MiB，总量超限前不能join8MiB捕获', () => { rejectsBeforeAllocation(rows('a'.repeat(16384) + 'X', 's'.repeat(4 * 1024 * 1024)), '$`'.repeat(512)); });
  it.each(['中', '😀'])('UTF-8原文%s的前缀膨胀不能按UTF-16长度漏检', value => { rejectsBeforeAllocation(rows(value.repeat(16384) + 'X'), '$`'.repeat(value === '中' ? 342 : 256)); });
  it('JSON转义膨胀计入实际after：UTF-8输出不足16MiB仍须在join前拒绝', () => { rejectsBeforeAllocation(rows('\0'.repeat(32768) + 'X'), '$`'.repeat(100)); });
  it('完整行的JSON转义旁列参与总量，不允许先构造捕获输出再计量原行', () => { rejectsBeforeAllocation(rows('a'.repeat(8192) + 'X', '\0'.repeat(1024 * 1024)), '$`'.repeat(512)); });
  it('嵌入响应的signature再次转义也在前检内，旧补丁+行+info预算不足以证明最终可传输', () => {
    const config = { ...info, columns: [{ ...info.columns[0], comment: '"'.repeat(2 * 1024 * 1024) }] }; rejectsBeforeAllocation(rows('a'.repeat(16384) + 'X'), '$`'.repeat(512), config);
  });
  it('合法7MiB捕获和大量转义元数据仍可成功，原文及原有预算保持不变', () => {
    const source = 'a'.repeat(16384) + 'X', data = rows(source), config = { ...info, columns: [{ ...info.columns[0], comment: '"'.repeat(2 * 1024 * 1024) }] };
    const plan = previewPageReplacementInWorker(data, ['note'], options, '$`'.repeat(448), config, 1);
    expect(plan.patches[0].after.length).toBe(16384 * 449 + 1); expect(plan.patches[0].after.at(-1)).toBe('X'); expect(plan.patches[0].after.slice(0, 32)).toBe('a'.repeat(32)); expect(data[0].data.note).toBe(source);
    const bytes = new TextEncoder().encode(JSON.stringify({ status: 'ready', operation: 'preview', preview: plan })).byteLength; expect(bytes).toBeLessThanOrEqual(pageFindLimits.bytes); expect(pageFindLimits.bytes).toBe(16 * 1024 * 1024);
  });
});

describe('不分配编码数组的分片计量与原生UTF-8/JSON一致', () => {
  it.each(['', 'a', '中', '😀', '\ud800', '\udc00', '"\\\b\f\n\r\t\0', '中😀\ud800X\udc00', '\ud800\udc00\ud800', '前"😀\\\n后'])('任意片段边界：%j', value => {
    for (let first = 0; first <= value.length; first++) for (let second = first; second <= value.length; second++) {
      const size = new PageTextSize(), spans: PageTextSpan[] = [{ value, start: 0, end: first }, { value, start: first, end: second }, { value, start: second, end: value.length }]; spans.forEach(span => size.append(span));
      expect(size.units).toBe(value.length); expect(size.utf8).toBe(new TextEncoder().encode(value).byteLength); expect(size.json + 2).toBe(new TextEncoder().encode(JSON.stringify(value)).byteLength);
    }
  });
  it('不同捕获字符串及原文片段之间拼成代理对，不能保守多算而拒绝合法输出', () => {
    const spans = ['\ud83d', '', '\ude00', '\ud800', '中', '\udc00'], size = new PageTextSize(); spans.forEach(value => size.append({ value, start: 0, end: value.length })); const joined = spans.join('');
    expect(size.utf8).toBe(new TextEncoder().encode(joined).byteLength); expect(size.json + 2).toBe(new TextEncoder().encode(JSON.stringify(joined)).byteLength);
    const data = rows('\ud83dX\ude00'); expect(previewPageReplacementInWorker(data, ['note'], { ...options, query: 'X' }, '', info, 1).patches[0].after).toBe('😀');
  });
});
