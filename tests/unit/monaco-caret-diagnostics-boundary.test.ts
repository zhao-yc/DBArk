import { afterEach, describe, expect, it, vi } from 'vitest';
import { readMonacoCaretDiagnostics } from '../e2e/monaco-caret-diagnostics';

const privateText = '合成不可序列化的敏感字段';
const invalidNumbers = [
  { name: '敏感字符串', value: privateText }, { name: '敏感对象', value: { privateText } },
  { name: 'NaN', value: NaN }, { name: 'Infinity', value: Infinity }, { name: '负Infinity', value: -Infinity },
  { name: '负数', value: -1 }, { name: '小数', value: 1.5 }, { name: '不安全整数', value: Number.MAX_SAFE_INTEGER + 1 },
  { name: 'undefined', value: undefined }, { name: 'null', value: null }
];

/** 独立异常API端口：不修改原回放夹具，原文和异常返回值均只使用合成数据。 */
function port(options: { version?: unknown; empty?: unknown; count?: unknown; statusCount?: unknown; documentFocus?: unknown; editorFocus?: unknown; duplicateQuery?: boolean } = {}) {
  const chosen = (key: keyof typeof options, fallback: unknown) => Object.hasOwn(options, key) ? options[key] : fallback;
  const wrap = { contains: (candidate: unknown) => candidate === container };
  const query = { isConnected: true, getClientRects: () => [{}], querySelector: () => wrap, querySelectorAll: () => ({ length: chosen('statusCount', 1) }) };
  const container = { isConnected: true, getClientRects: () => [{}], closest: () => query };
  const model = { isDisposed: () => false, getValue: () => '合成正文', getVersionId: () => chosen('version', 7) };
  const editor = { getContainerDomNode: () => container, hasTextFocus: () => chosen('editorFocus', true), getModel: () => model, getSelections: () => ({ length: chosen('count', 1), 0: { isEmpty: () => chosen('empty', true) } }) };
  vi.stubGlobal('document', { hasFocus: () => chosen('documentFocus', true), querySelectorAll: () => options.duplicateQuery ? [query, query] : [query] });
  vi.stubGlobal('getComputedStyle', () => ({ visibility: 'visible' }));
  vi.stubGlobal('window', { monaco: { editor: { getEditors: () => [editor] } }, dbark: { invoke: async () => ({ activeTabId: '合成标签', tabs: [{ id: '合成标签', kind: 'query', sql: '合成正文' }] }) } });
}
afterEach(() => vi.unstubAllGlobals());

describe('异常诊断API的运行时白名单', () => {
  it.each([...invalidNumbers, { name: '零版本', value: 0 }])('模型版本拒绝$name，不回传异常原值', async ({ value }) => {
    port({ version: value }); const result = await readMonacoCaretDiagnostics('合成正文');
    expect(result.model.version).toBeNull(); expect(JSON.stringify(result)).not.toContain(privateText);
  });
  it.each(invalidNumbers)('选择数量拒绝$name，不回传异常原值', async ({ value }) => {
    port({ count: value }); const result = await readMonacoCaretDiagnostics('合成正文');
    expect(result.model.selectionCount).toBeNull(); expect(result.model.singleSelectionEmpty).toBeNull(); expect(JSON.stringify(result)).not.toContain(privateText);
  });
  it.each(invalidNumbers)('状态节点计数拒绝$name，不把异常值参与求和', async ({ value }) => {
    port({ statusCount: value }); const result = await readMonacoCaretDiagnostics('合成正文');
    expect(result.completionStatusCount).toBeNull(); expect(JSON.stringify(result)).not.toContain(privateText);
  });
  it.each([privateText, { privateText }, NaN, Infinity, -1, 0, 1, undefined, null])('选择空状态只接受真正的boolean：%j', async value => {
    port({ empty: value }); const result = await readMonacoCaretDiagnostics('合成正文');
    expect(result.model.singleSelectionEmpty).toBeNull(); expect(JSON.stringify(result)).not.toContain(privateText);
  });
  it.each([privateText, { privateText }])('文档及编辑器焦点异常不猜true或false：%j', async value => {
    port({ documentFocus: value, editorFocus: value }); const result = await readMonacoCaretDiagnostics('合成正文');
    expect(result.documentFocused).toBeNull(); expect(result.focusedEditorCount).toBeNull(); expect(JSON.stringify(result)).not.toContain(privateText);
  });
  it('含toJSON/valueOf/toString的敏感对象不会进入附件或被计数强制转换', async () => {
    const touched = vi.fn(() => privateText), value = { toJSON: touched, valueOf: touched, toString: touched };
    port({ version: value, count: value, empty: value, statusCount: value, documentFocus: value, editorFocus: value });
    const result = await readMonacoCaretDiagnostics('合成正文');
    expect(JSON.stringify(result)).not.toContain(privateText); expect(touched).not.toHaveBeenCalled();
  });
  it('多个合法计数相加溢出安全整数后仍为unknown', async () => {
    port({ statusCount: Number.MAX_SAFE_INTEGER, duplicateQuery: true }); const result = await readMonacoCaretDiagnostics('合成正文');
    expect(result.completionStatusCount).toBeNull();
  });
  it.each([1, Number.MAX_SAFE_INTEGER])('正安全整数版本%s保持', async version => {
    port({ version }); const result = await readMonacoCaretDiagnostics('合成正文'); expect(result.model.version).toBe(version);
  });
  it.each([true, false])('合法选择空状态%s保持', async empty => {
    port({ empty }); const result = await readMonacoCaretDiagnostics('合成正文'); expect(result.model.singleSelectionEmpty).toBe(empty);
  });
  it('真实零计数与缺失状态仍区分，合法零不被猜为unknown', async () => {
    port({ count: 0, statusCount: 0 }); const result = await readMonacoCaretDiagnostics('合成正文');
    expect(result.model.selectionCount).toBe(0); expect(result.model.singleSelectionEmpty).toBeNull(); expect(result.completionStatusCount).toBe(0);
  });
});
