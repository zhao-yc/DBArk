import { describe, expect, it } from 'vitest';
import type { TableInfo } from '../../src/shared/contracts';
import { assertTextInputBudget, replaceBoundedTextInput } from '../../src/renderer/boundedTextInput';
import { beginRecordDraft, type RecordContext } from '../../src/renderer/recordViews';
import { beginRecordDocument, changeRecordDocument, recordDocumentInputBudget, stageRecordDocument } from '../../src/renderer/recordInputDocument';
import { jsonNodeInputBudget } from '../../src/renderer/jsonNodeInput';
import { parseJsonLexicalTree } from '../../src/renderer/jsonLexicalTree';
import { beginRecordJsonNodeInput, changeRecordJsonNodeInput, stageRecordJsonNodeInput } from '../../src/renderer/recordJsonNodeInput';
import type { DraftRow } from '../../src/renderer/dataChanges';

/** 使用真实记录模型，原行与原草稿不由替换函数就地修改。 */
function fixture() {
  const data = { id: '18446744073709551615', note: 'OLD', doc: '"old"' };
  const row: DraftRow = { id: '本地行', data, original: { ...data }, inserted: false, deleted: false }, rows = [row];
  const info: TableInfo = { database: '隔离', name: '记录', objectKind: 'table', engine: 'InnoDB', primaryKey: ['id'], editableKey: ['id'], indexes: [], foreignKeys: [], ddl: '', columns: Object.keys(data).map(name => ({ name, type: name === 'doc' ? 'JSON' : 'TEXT', nullable: true, generated: false, defaultValue: null, extra: '', comment: '' })) };
  const context: RecordContext = { target: { connectionId: '隔离', database: info.database, table: info.name }, connectionVersion: 1, generation: 1, info, loaded: true, stale: false, busy: false };
  const draft = beginRecordDraft(row, context), document = parseJsonLexicalTree(data.doc);
  if (document.status !== 'ready') throw Error(document.reason);
  const selection = { row, columnName: 'doc', document, segments: [], identity: { target: draft.target, metadata: draft.metadata, rowId: row.id, data: row.data, original: row.original, connectionVersion: 1, generation: 1, inserted: false, deleted: false } };
  return { row, rows, context, documentInput: beginRecordDocument(rows, draft, context), nodeInput: beginRecordJsonNodeInput({ rows, draft, context, columnName: 'doc', document, selection }) };
}

describe('完整候选输入预算与选区替换', () => {
  for (const [name, budget] of [['整行', recordDocumentInputBudget], ['节点', jsonNodeInputBudget]] as const) {
    it(`${name}全量超限拒绝，合法前缀不能成为替换结果`, () => {
      const previous = '"OLD"', attempted = '"NEW"' + ' '.repeat(budget.units);
      expect(() => replaceBoundedTextInput(previous, 0, previous.length, attempted, budget)).toThrow(budget.message);
      expect(previous).toBe('"OLD"');
    });
    it(`${name}合法JSON加空白达到上限后，非空选区替换不会只接收可容纳前缀`, () => {
      const previous = '"OLD"'.padEnd(budget.units, ' ');
      expect(() => replaceBoundedTextInput(previous, 1, 4, 'NEW尾部🙂', budget)).toThrow(budget.message);
      expect(replaceBoundedTextInput(previous, 1, 4, 'NEW', budget)).toBe('"NEW"' + previous.slice(5));
    });
    it(`${name}UTF-16未超限时仍拒绝完整UTF-8超限候选`, () => {
      const attempted = '汉'.repeat(Math.floor(budget.bytes / 3) + 1);
      expect(attempted.length).toBeLessThan(budget.units);
      expect(() => replaceBoundedTextInput('OLD', 0, 3, attempted, budget)).toThrow(budget.message);
    });
    it(`${name}保持既有硬预算，末尾一个代码单元或字节也不能扩容`, () => {
      expect(() => assertTextInputBudget(' '.repeat(budget.units), budget)).not.toThrow();
      expect(() => assertTextInputBudget(' '.repeat(budget.units + 1), budget)).toThrow(budget.message);
    });
  }

  it('UTF-8按完整候选计费，跨选区组成surrogate对也不误加替代字符字节', () => {
    const budget = { units: 2, bytes: 4, message: '超限' };
    expect(replaceBoundedTextInput('\ud83dX', 1, 2, '\ude42', budget)).toBe('🙂');
    expect(replaceBoundedTextInput('🙂', 1, 1, 'A', { units: 3, bytes: 7, message: '超限' })).toBe('\ud83dA\ude42');
  });
  it('CRLF及ZWJ原文不被归一化或修复，所有代码单元完整保留', () => {
    const value = '👩‍💻\r\n', budget = { units: value.length, bytes: Buffer.byteLength(value), message: '超限' };
    expect(replaceBoundedTextInput('', 0, 0, value, budget)).toBe(value);
    expect(() => replaceBoundedTextInput(value, value.length, value.length, ' ', budget)).toThrow('超限');
  });
  it.each([[-1, 0], [0, 4], [2, 1], [0.5, 1]])('无效选区 %s %s 不猜测修复', (start, end) => {
    expect(() => replaceBoundedTextInput('OLD', start, end, 'NEW', { units: 10, bytes: 10, message: '超限' })).toThrow('选区已变化');
  });
});

describe('拒绝候选后最终暂存仍使用旧完整记录缓冲', () => {
  it('整行小记录的合法dirty文档到达上限后，拒绝更长替换仍只暂存旧值', () => {
    const x = fixture(), previous = x.documentInput.text.replace('OLD', 'KEP').padEnd(recordDocumentInputBudget.units, ' '), input = changeRecordDocument(x.documentInput, previous), start = previous.indexOf('KEP');
    expect(() => changeRecordDocument(input, replaceBoundedTextInput(previous, start, start + 3, 'NEW尾部🙂', recordDocumentInputBudget))).toThrow('2 MiB');
    expect(input.text).toBe(previous); expect(stageRecordDocument(x.rows, input, x.context)[0].data.note).toBe('KEP'); expect(x.row.data.note).toBe('OLD');
  });
  it('节点的合法dirty引号与空白保持完整，拒绝替换后不暂存合法截短前缀', () => {
    const x = fixture(), previous = '"keep"'.padEnd(jsonNodeInputBudget.units, ' '), input = changeRecordJsonNodeInput(x.nodeInput, previous);
    expect(() => changeRecordJsonNodeInput(input, replaceBoundedTextInput(previous, 1, 5, 'newTAIL汉🙂', jsonNodeInputBudget))).toThrow(jsonNodeInputBudget.message);
    expect(input.value.text).toBe(previous); expect(stageRecordJsonNodeInput(x.rows, input, x.context)[0].data.doc).toBe(previous); expect(x.row.data.doc).toBe('"old"');
  });
  it('绕过组件直接构造超限整行或节点缓冲，最终暂存也复用同一预算拒绝', () => {
    const x = fixture();
    expect(() => stageRecordDocument(x.rows, { ...x.documentInput, text: ' '.repeat(recordDocumentInputBudget.units + 1) }, x.context)).toThrow(recordDocumentInputBudget.message);
    expect(() => stageRecordJsonNodeInput(x.rows, { ...x.nodeInput, value: { ...x.nodeInput.value, text: ' '.repeat(jsonNodeInputBudget.units + 1) } }, x.context)).toThrow(jsonNodeInputBudget.message);
    expect(x.rows[0]).toBe(x.row); expect(x.row.data).toEqual({ id: '18446744073709551615', note: 'OLD', doc: '"old"' });
  });
});
