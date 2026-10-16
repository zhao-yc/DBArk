import type { Page, TestInfo } from '@playwright/test';

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
  /** TS类型不能约束运行时API；只接受非负安全整数，不转换字符串或对象。 */
  const count = (value: unknown): number | null => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
  /** 布尔状态也必须验证原始类型，不能按truthy猜测或把对象带入附件。 */
  const boolean = (value: unknown): boolean | null => typeof value === 'boolean' ? value : null;
  /** 原文只在页面调用内比较，绝不出现在返回值、错误或附件中。 */
  function summarize(value: unknown): DraftSummary {
    if (typeof value !== 'string') return { ...unknown };
    const normalized = normalize(value);
    return { availability: 'known', matchesExpected: normalized === expected, utf16Units: count(normalized.length) };
  }
  try {
    result.documentFocused = boolean(document.hasFocus());
    const visible = (element: Element) => {
      const style = getComputedStyle(element);
      return element.isConnected && element.getClientRects().length > 0 && style.visibility !== 'hidden' && style.visibility !== 'collapse';
    };
    const queries = [...document.querySelectorAll('.query-tab')].filter(visible);
    result.visibleQueryCount = count(queries.length);
    result.completionStatusCount = queries.reduce<number | null>((sum, query) => {
      const current = count(query.querySelectorAll('[aria-label="SQL 补全状态"]').length);
      return sum === null || current === null ? null : count(sum + current);
    }, 0);
    const api = (window as Window & { monaco?: typeof import('monaco-editor') }).monaco;
    if (typeof api?.editor?.getEditors === 'function') {
      const editors = api.editor.getEditors().filter(editor => {
        const node = editor.getContainerDomNode(), query = node.closest('.query-tab');
        return !!query && queries.includes(query) && !!query.querySelector('.sql-editor-wrap')?.contains(node) && visible(node);
      });
      result.visibleEditorCount = count(editors.length);
      const focusStates = editors.map(editor => boolean(editor.hasTextFocus()));
      const focused = editors.filter((_, index) => focusStates[index] === true);
      result.focusedEditorCount = focusStates.some(value => value === null) ? null : count(focused.length);
      const editor = result.focusedEditorCount === 1 ? focused[0] : editors.length === 1 ? editors[0] : undefined;
      if (editor) {
        const model = editor.getModel();
        if (model && !model.isDisposed()) {
          Object.assign(result.model, summarize(model.getValue()));
          const version = count(model.getVersionId());
          result.model.version = version !== null && version > 0 ? version : null;
          const selections = editor.getSelections();
          if (selections) {
            result.model.selectionCount = count(selections.length);
            result.model.singleSelectionEmpty = result.model.selectionCount === 1 ? boolean(selections[0].isEmpty()) : null;
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

export interface OfflineCompletionDiagnostic { cold: number; phase: 'prepare' | 'completion'; marked: string; pageErrorCount: number; }

/** 仅供afterEach：此时公开duration才是已结束测试体的实际用时，运行中恒0不能用于预算。 */
export async function attachMonacoCaretDiagnostic(
  page: Pick<Page, 'evaluate'>, info: Pick<TestInfo, 'timeout' | 'duration' | 'attach'>, context: OfflineCompletionDiagnostic
): Promise<'attached' | 'skipped' | 'timed-out' | 'failed'> {
  const started = performance.now(), timeout = info.timeout, duration = info.duration;
  if (!Number.isFinite(timeout) || timeout < 0 || !Number.isFinite(duration) || duration < 0) return 'skipped';
  // 不改变case期限；连完整诊断预算都不足时直接跳过，不把duration缺失猜成0。
  if (timeout !== 0 && timeout - duration - (performance.now() - started) < 500) return 'skipped';
  const deadline = started + 500;
  let expired = false, timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutResult = new Promise<'timed-out'>(resolve => {
    timer = setTimeout(() => { expired = true; resolve('timed-out'); }, Math.max(0, deadline - performance.now()));
  });
  const operation = (async (): Promise<'attached' | 'timed-out'> => {
    const diagnostics = await collectMonacoCaretDiagnostics(page, context.marked);
    if (expired || performance.now() >= deadline) return 'timed-out';
    await info.attach('离线补全阶段-' + context.cold, {
      body: JSON.stringify({ cold: context.cold, phase: context.phase, pageErrorCount: context.pageErrorCount, diagnostics }), contentType: 'application/json'
    });
    return expired || performance.now() >= deadline ? 'timed-out' : 'attached';
  })();
  // 即使race已超时，也承接采样或已发出附件的迟到拒绝，不能出现未处理拒绝。
  const settled = operation.then(value => value, () => 'failed' as const);
  try { return await Promise.race([settled, timeoutResult]); }
  finally { expired = true; if (timer !== undefined) clearTimeout(timer); }
}
