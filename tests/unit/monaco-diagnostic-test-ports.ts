import { promises as files } from 'node:fs';
import { vi } from 'vitest';
import type { MonacoCaretDiagnostics } from '../e2e/monaco-caret-diagnostics';

export const diagnosticSample: MonacoCaretDiagnostics = {
  expectedUtf16Units: 4, documentFocused: null, visibleQueryCount: null, visibleEditorCount: null, focusedEditorCount: null, completionStatusCount: null, inputRoute: 'unknown', inputBoundToEditor: null,
  model: { availability: 'unknown', matchesExpected: null, utf16Units: null, version: null, selectionCount: null, singleSelectionEmpty: null },
  rendererDraft: { availability: 'unknown', matchesExpected: null, utf16Units: null, reason: 'no-public-store-interface' },
  mainDraft: { availability: 'unknown', matchesExpected: null, utf16Units: null, activeTabPresent: null, activeTabIsQuery: null }, sample: 'completed'
};

/** 预算及控制流测试使用RAM磁盘端口，单独的落盘测试仍使用实际文件与锁定Playwright函数。 */
export function diagnosticFilePorts() {
  const data = new Map<string, string>();
  const write = vi.spyOn(files, 'writeFile').mockImplementation(async (path, body) => { data.set(String(path), String(body)); });
  const rename = vi.spyOn(files, 'rename').mockImplementation(async (from, to) => { data.set(String(to), data.get(String(from))!); data.delete(String(from)); });
  const remove = vi.spyOn(files, 'rm').mockImplementation(async path => { data.delete(String(path)); });
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  return { data, write, rename, remove, warning };
}
