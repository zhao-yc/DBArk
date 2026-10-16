import type { Page } from '@playwright/test';

type Availability = 'known' | 'unknown';
interface DraftSummary { availability: Availability; matchesExpected: boolean | null; utf16Units: number | null; }
export interface MonacoCaretDiagnostics {
  expectedUtf16Units: number;
  documentFocused: boolean | null;
  visibleQueryCount: number | null;
  visibleEditorCount: number | null;
  focusedEditorCount: number | null;
  completionStatusCount: number | null;
  model: DraftSummary & { version: number | null; selectionCount: number | null; singleSelectionEmpty: boolean | null; };
  rendererDraft: DraftSummary & { reason: 'no-public-store-interface'; };
  mainDraft: DraftSummary & { activeTabPresent: boolean | null; activeTabIsQuery: boolean | null; };
  sample: 'completed' | 'page-unavailable';
}

/** 只返回固定字段；接口不可用时保留unknown/null，不能把缺失正文当成空串。 */
function unknownDiagnostics(expectedUtf16Units: number): MonacoCaretDiagnostics {
  const draft = { availability: 'unknown' as const, matchesExpected: null, utf16Units: null };
  return {
    expectedUtf16Units, documentFocused: null, visibleQueryCount: null, visibleEditorCount: null, focusedEditorCount: null, completionStatusCount: null,
    model: { ...draft, version: null, selectionCount: null, singleSelectionEmpty: null },
    rendererDraft: { ...draft, reason: 'no-public-store-interface' },
    mainDraft: { ...draft, activeTabPresent: null, activeTabIsQuery: null }, sample: 'page-unavailable'
  };
}

/** 该函数整体交给page.evaluate；只读现有DOM、Monaco公开API和settings.get，不读取剪贴板或新增产品钩子。 */
export async function readMonacoCaretDiagnostics(expected: string): Promise<MonacoCaretDiagnostics> {
  const unknown = { availability: 'unknown' as const, matchesExpected: null, utf16Units: null };
  const result: MonacoCaretDiagnostics = {
    expectedUtf16Units: expected.length, documentFocused: null, visibleQueryCount: null, visibleEditorCount: null, focusedEditorCount: null, completionStatusCount: null,
    model: { ...unknown, version: null, selectionCount: null, singleSelectionEmpty: null },
    // renderer store没有现成公开读取接口；Monaco模型与主进程保存快照不能冒充它。
    rendererDraft: { ...unknown, reason: 'no-public-store-interface' },
    mainDraft: { ...unknown, activeTabPresent: null, activeTabIsQuery: null }, sample: 'completed'
  };
  const normalize = (value: string) => value.replaceAll('\r\n', '\n');
  /** 原文只在页面调用内比较，绝不出现在返回值、错误或附件中。 */
  function summarize(value: unknown): DraftSummary {
    if (typeof value !== 'string') return { ...unknown };
    const normalized = normalize(value);
    return { availability: 'known', matchesExpected: normalized === expected, utf16Units: normalized.length };
  }
  try {
    result.documentFocused = document.hasFocus();
    const visible = (element: Element) => {
      const style = getComputedStyle(element);
      return element.isConnected && element.getClientRects().length > 0 && style.visibility !== 'hidden' && style.visibility !== 'collapse';
    };
    const queries = [...document.querySelectorAll('.query-tab')].filter(visible);
    result.visibleQueryCount = queries.length;
    result.completionStatusCount = queries.reduce((sum, query) => sum + query.querySelectorAll('[aria-label="SQL 补全状态"]').length, 0);
    const api = (window as Window & { monaco?: typeof import('monaco-editor') }).monaco;
    if (typeof api?.editor?.getEditors === 'function') {
      const editors = api.editor.getEditors().filter(editor => {
        const node = editor.getContainerDomNode(), query = node.closest('.query-tab');
        return !!query && queries.includes(query) && !!query.querySelector('.sql-editor-wrap')?.contains(node) && visible(node);
      });
      result.visibleEditorCount = editors.length;
      const focused = editors.filter(editor => editor.hasTextFocus());
      result.focusedEditorCount = focused.length;
      const editor = focused.length === 1 ? focused[0] : editors.length === 1 ? editors[0] : undefined;
      if (editor) {
        const model = editor.getModel();
        if (model && !model.isDisposed()) {
          Object.assign(result.model, summarize(model.getValue()));
          result.model.version = model.getVersionId();
          const selections = editor.getSelections();
          if (selections) {
            result.model.selectionCount = selections.length;
            result.model.singleSelectionEmpty = selections.length === 1 ? selections[0].isEmpty() : null;
          }
        }
      }
    }
  } catch {
    // 某个公开getter失败只保留已知字段，不序列化异常message、cause、DOM或模型对象。
  }
  try {
    const settings = await window.dbark.invoke('settings.get', {});
    if (Array.isArray(settings.tabs) && typeof settings.activeTabId === 'string') {
      const active = settings.tabs.find(tab => tab.id === settings.activeTabId);
      result.mainDraft.activeTabPresent = !!active;
      result.mainDraft.activeTabIsQuery = active ? active.kind === 'query' : null;
      if (active?.kind === 'query') Object.assign(result.mainDraft, summarize(active.sql));
    }
  } catch {
    // IPC失败仍为unknown；不附错误正文或读取其它文件/身份来补全。
  }
  return result;
}

/** 仅在原失败路径单次采样，不轮询、不等待准备、不重放输入或放宽成功断言。 */
export async function collectMonacoCaretDiagnostics(page: Pick<Page, 'evaluate'>, marked: string): Promise<MonacoCaretDiagnostics> {
  const expected = marked.replace('|', '').replaceAll('\r\n', '\n');
  try { return await page.evaluate(readMonacoCaretDiagnostics, expected); }
  catch { return unknownDiagnostics(expected.length); }
}
