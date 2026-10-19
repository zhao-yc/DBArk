import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import type * as monaco from 'monaco-editor';
import { formatSqlEditor } from '../../src/renderer/sqlFormatting';
// @ts-expect-error Monaco 内部纯内存模块没有单独的类型声明。
import { Selection } from 'monaco-editor/esm/vs/editor/common/core/selection.js';
// @ts-expect-error 同上；使用实际序列化、合并及 Undo/Redo 元素。
import { EditStack } from 'monaco-editor/esm/vs/editor/common/model/editStack.js';
// @ts-expect-error 同上；只调用实际 executeEdits，不创建编辑器或视图。
import { CursorsController } from 'monaco-editor/esm/vs/editor/common/cursor/cursor.js';
// @ts-expect-error 同上。
import { TextChange } from 'monaco-editor/esm/vs/editor/common/core/textChange.js';
// @ts-expect-error 同上。
import { EditSources, TextModelEditSource } from 'monaco-editor/esm/vs/editor/common/textModelEditSource.js';

const require = createRequire(import.meta.url);
const widgetPath = require.resolve('monaco-editor/esm/vs/editor/browser/widget/codeEditor/codeEditorWidget.js');
const widgetTree = ts.createSourceFile(widgetPath, readFileSync(widgetPath, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
let widget!: ts.ClassExpression;
/** Monaco 用带装饰器的类表达式导出入口，递归定位该类而不依赖行号。 */
function findWidget(node: ts.Node) { if (ts.isClassExpression(node) && node.name?.text === 'CodeEditorWidget') widget = node; else ts.forEachChild(node, findWidget); }
findWidget(widgetTree);
const executeMethod = widget.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(widgetTree) === 'executeEdits')!;
// 只提取已安装 Monaco 的入口方法，避免加载 CSS/DOM；方法体及其两个依赖均使用原实现。
const executeEdits = new Function('TextModelEditSource', 'EditSources', `return ({${executeMethod.getText(widgetTree)}}).executeEdits;`)(TextModelEditSource, EditSources);

/** 文本存储及撤销服务是 RAM 端口；选区类、入口、Cursor、历史元素和序列化均为实际 Monaco。
 * 不模拟浏览器标记跟踪，也不把本测试当作原生编辑器验收。 */
function historyPort(initial: string, eol = '\n', anchor = 0, caret = anchor) {
  let source = initial, version = 1, alternativeVersion = 1, nextAlternative = 1;
  let selections: any[], historyIndex = 0, computed: any;
  const history: any[] = [], calls: string[] = [];
  const position = (offset: number) => { const lines = source.slice(0, offset).split(eol); return { lineNumber: lines.length, column: lines.at(-1)!.length + 1 }; };
  const offset = (p: { lineNumber: number; column: number }) => source.split(eol).slice(0, p.lineNumber - 1).reduce((sum, line) => sum + line.length + eol.length, 0) + p.column - 1;
  const selection = (start: number, end = start) => Selection.fromPositions(position(start), position(end));
  selections = [selection(anchor, caret)];
  /** 回放真实历史元素反序列化后的 TextChange；null 选区保留当前值，不能凭文本推算历史光标。 */
  function replay(changes: any[], undo: boolean, alt: number, restored: any) {
    for (const change of [...changes].reverse()) {
      const start = undo ? change.newPosition : change.oldPosition, before = undo ? change.newText : change.oldText, after = undo ? change.oldText : change.newText;
      expect(source.slice(start, start + before.length)).toBe(before);
      source = source.slice(0, start) + after + source.slice(start + before.length);
    }
    alternativeVersion = alt; version++; if (restored) selections = restored;
  }
  const model: any = {
    uri: { toString: () => 'inmemory://format-history' }, isDisposed: () => false,
    getValue: () => source, getValueLength: () => source.length, getVersionId: () => version,
    getAlternativeVersionId: () => alternativeVersion, getEOL: () => eol, getOffsetAt: offset,
    getFullModelRange: () => selection(0, source.length),
    applyEdits(edits: any[]) {
      expect(edits).toHaveLength(1); const edit = edits[0], start = offset(edit.range.getStartPosition()), end = offset(edit.range.getEndPosition()), old = source.slice(start, end);
      source = source.slice(0, start) + edit.text + source.slice(end); version++; alternativeVersion = ++nextAlternative;
      return [{ range: selection(start, start + edit.text.length), text: old, textChange: new TextChange(start, old, start, edit.text) }];
    },
    pushEditOperations(before: any, edits: any[], computer: any, group: any, reason: any) {
      computed = stack.pushEditOperation(before, edits, computer, group, reason); return computed;
    },
    _applyUndo: (changes: any[], _eol: number, alt: number, restored: any) => replay(changes, true, alt, restored),
    _applyRedo: (changes: any[], _eol: number, alt: number, restored: any) => replay(changes, false, alt, restored),
  };
  const stack = new EditStack(model, {
    getLastElement: () => history[historyIndex - 1],
    pushElement(element: any) { history.splice(historyIndex); history.push(element); historyIndex++; },
  });
  const cursor = { _model: model, getSelections: () => selections, setSelections(_events: unknown, _source: unknown, next: any) { selections = next; } };
  const editor: any = {
    _configuration: { options: { get: () => false } }, _onBeforeExecuteEdit: { fire() {} },
    _modelData: { viewModel: { executeEdits: (...args: any[]) => CursorsController.prototype.executeEdits.call(cursor, {}, ...args) } },
    executeEdits, getModel: () => model, getSelections: () => selections, getRawOptions: () => ({ readOnly: false }),
    pushUndoStop() { calls.push('stop'); stack.pushStackElement(); return true; }, focus() { calls.push('focus'); },
  };
  return {
    editor: editor as monaco.editor.IStandaloneCodeEditor, calls,
    text: () => source, alt: () => alternativeVersion, computed: () => computed,
    selected: () => selections.map(s => [offset(s.getSelectionStart()), offset(s.getPosition())]),
    undo() { expect(historyIndex).toBeGreaterThan(0); history[--historyIndex].undo(); },
    redo() { expect(historyIndex).toBeLessThan(history.length); history[historyIndex++].redo(); },
    /** 普通编辑也经过同一真实入口和历史栈，验证格式化两侧的分组。 */
    type(value: string) { editor.executeEdits('type', [{ range: selections[0], text: value }], (inverse: any[]) => inverse.map(({ range }) => Selection.fromPositions(range.getEndPosition()))); },
  };
}

const rawLf = 'select 1,2\nfrom sample where id=1;';
const formattedLf = 'select\n  1,\n  2\nfrom\n  sample\nwhere\n  id = 1;';

describe('格式化事务在真实 Monaco 历史中保存结束选区', () => {
  it('缺省 endCursorState 的入口确实向历史写入 null，而不会记录显示光标', () => {
    const port = historyPort('a');
    port.editor.executeEdits('negative-control', [{ range: port.editor.getModel()!.getFullModelRange(), text: 'abc' }]);
    expect(port.computed()).toBeNull(); port.editor.pushUndoStop(); port.undo(); port.redo();
    // Monaco 将 null 序列化为零条选区；RAM 端口不替浏览器补回默认光标。
    expect(port.text()).toBe('abc'); expect(port.selected()).toEqual([]);
  });
  it.each(['\n', '\r\n'])('run1918 正文、普通编辑及格式化 Undo→Redo→Undo，EOL=%j', eol => {
    const raw = rawLf.replaceAll('\n', eol), formatted = formattedLf.replaceAll('\n', eol), port = historyPort(raw, eol);
    port.type('x'); expect(port.text()).toBe('x' + raw); port.undo(); expect(port.text()).toBe(raw); expect(port.alt()).toBe(1);
    expect(formatSqlEditor(port.editor)).toBe(true);
    expect(port.text()).toBe(formatted); expect(port.computed()).not.toBeNull(); expect(port.selected()).toEqual([[formatted.length, formatted.length]]);
    expect(port.calls).toEqual(['stop', 'stop', 'focus']);
    port.undo(); expect(port.text()).toBe(raw); expect(port.selected()).toEqual([[0, 0]]); expect(port.alt()).toBe(1);
    port.redo(); expect(port.text()).toBe(formatted); expect(port.selected()).toEqual([[formatted.length, formatted.length]]);
    port.undo(); expect(port.text()).toBe(raw); expect(port.selected()).toEqual([[0, 0]]); expect(port.alt()).toBe(1);
  });
  it.each([0, 10, 80])('全文缩短时原光标%s仍折叠到新末尾，并隔离前后普通编辑', originalCaret => {
    const raw = 'select\n' + ' '.repeat(80) + '1;', formatted = 'select\n  1;', port = historyPort(raw, '\n', originalCaret);
    expect(formatSqlEditor(port.editor)).toBe(true); expect(port.text()).toBe(formatted); expect(port.selected()).toEqual([[formatted.length, formatted.length]]);
    port.type('x'); expect(port.text()).toBe(formatted + 'x'); port.undo(); expect(port.text()).toBe(formatted); expect(port.selected()).toEqual([[formatted.length, formatted.length]]);
    port.undo(); expect(port.text()).toBe(raw); expect(port.selected()).toEqual([[originalCaret, originalCaret]]);
    port.redo(); expect(port.text()).toBe(formatted); expect(port.selected()).toEqual([[formatted.length, formatted.length]]);
    port.redo(); expect(port.text()).toBe(formatted + 'x');
  });
  it.each([false, true])('非空选区方向%s、区外正文及 Undo/Redo 选区保持原合同', reverse => {
    const prefix = 'select 0;\n', suffix = '\nselect 9;', raw = prefix + rawLf + suffix, start = prefix.length, end = start + rawLf.length;
    const port = historyPort(raw, '\n', reverse ? end : start, reverse ? start : end), after = reverse ? [start + formattedLf.length, start] : [start, start + formattedLf.length];
    expect(formatSqlEditor(port.editor)).toBe(true); expect(port.text()).toBe(prefix + formattedLf + suffix); expect(port.selected()).toEqual([after]);
    port.undo(); expect(port.text()).toBe(raw); expect(port.selected()).toEqual([[reverse ? end : start, reverse ? start : end]]);
    port.redo(); expect(port.text()).toBe(prefix + formattedLf + suffix); expect(port.selected()).toEqual([after]);
  });
});
