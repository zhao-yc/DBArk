import assert from 'node:assert/strict';

// 两套完整golden逐字手写，不调用formatter、不按观察结果制造答案或归一化实际文本。
const lf = { source: 'select 1,2\nfrom sample where id=1;', formatted: 'select\n  1,\n  2\nfrom\n  sample\nwhere\n  id = 1;', eol: '\n' } as const;
const crlf = { source: 'select 1,2\r\nfrom sample where id=1;', formatted: 'select\r\n  1,\r\n  2\r\nfrom\r\n  sample\r\nwhere\r\n  id = 1;', eol: '\r\n' } as const;
export const fileFirstModelCases = [
  { key: 'lf-button', title: 'LF首次文件模型：普通编辑Undo、格式化按钮UndoRedo及独立重启', entry: 'button', ...lf },
  { key: 'lf-shortcut', title: 'LF首次文件模型：普通编辑Undo、格式化快捷键UndoRedo及独立重启', entry: 'shortcut', ...lf },
  { key: 'crlf-button', title: 'CRLF首次文件模型：普通编辑Undo、格式化按钮UndoRedo及独立重启', entry: 'button', ...crlf },
  { key: 'crlf-shortcut', title: 'CRLF首次文件模型：普通编辑Undo、格式化快捷键UndoRedo及独立重启', entry: 'shortcut', ...crlf },
] as const;
export type FileFirstModelCase = typeof fileFirstModelCases[number];
export interface FirstModelSelection { start: number; end: number; anchor: number; position: number; }
export interface FirstModelObservation {
  editorId: number; modelId: number; value: string; eol: string; version: number; alternative: number; focused: boolean;
  selections: FirstModelSelection[] | null; options: { tabSize: number; indentSize: number; insertSpaces: boolean; readOnly: boolean };
  events: { version: number; eol: string; undo: boolean; redo: boolean; eolChange: boolean; flush: boolean }[]; overflow: number;
}
/** 触发任何编辑之前逐字核对完整文件/Main/模型；不能把CRLF模型解释成LF文件等价。 */
export function assertFirstFileInitial(value: FileFirstModelCase, bytes: Buffer, main: string, model: FirstModelObservation) {
  assert.deepEqual(bytes, Buffer.from(value.source, 'utf8')); assert.equal(main, value.source); assert.equal(model.value, value.source); assert.equal(model.eol, value.eol);
  for (const number of [model.editorId, model.modelId, model.version, model.alternative]) assert.ok(Number.isSafeInteger(number) && number > 0);
  assert.equal(model.options.readOnly, false); assert.equal(model.overflow, 0); assert.equal(model.events.length, 0);
  return Object.freeze({ caseKey: value.key, bytes: bytes.length, eol: model.eol, version: model.version, alternative: model.alternative, userEditsBeforeInitial: 0 });
}
/** 一次真实编辑或历史动作只推进一个正文事件；版本必须前进，不要求初始版本字面值1。 */
export function assertFirstFileTransition(before: FirstModelObservation, after: FirstModelObservation, expected: string, kind: 'edit' | 'format' | 'undo' | 'redo', selections?: FirstModelSelection[] | null) {
  assert.equal(after.editorId, before.editorId); assert.equal(after.modelId, before.modelId); assert.equal(after.eol, before.eol); assert.equal(after.value, expected);
  assert.ok(after.version > before.version); assert.equal(after.overflow, 0); assert.deepEqual(after.options, before.options); assert.equal(after.focused, true);
  assert.equal(after.events.length, before.events.length + 1); const event = after.events.at(-1)!;
  assert.equal(event.version, after.version); assert.equal(event.eol, after.eol); assert.equal(event.undo, kind === 'undo'); assert.equal(event.redo, kind === 'redo'); assert.equal(event.eolChange, false); assert.equal(event.flush, false);
  if (selections !== undefined) assert.deepEqual(after.selections, selections);
}
