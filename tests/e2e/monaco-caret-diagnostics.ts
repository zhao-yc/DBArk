import type { Page, TestInfo } from '@playwright/test';
import { promises as files } from 'node:fs';
import { z } from 'zod';

type Availability = 'known' | 'unknown';
interface DraftSummary { availability: Availability; matchesExpected: boolean | null; utf16Units: number | null; }
export interface MonacoCaretDiagnostics {
  expectedUtf16Units: number;
  documentFocused: boolean | null;
  visibleQueryCount: number | null;
  visibleEditorCount: number | null;
  focusedEditorCount: number | null;
  completionStatusCount: number | null;
  inputRoute: 'textarea' | 'nativeEditContext' | 'unknown';
  inputBoundToEditor: boolean | null;
  model: DraftSummary & { version: number | null; selectionCount: number | null; singleSelectionEmpty: boolean | null; };
  rendererDraft: DraftSummary & { reason: 'no-public-store-interface'; };
  mainDraft: DraftSummary & { activeTabPresent: boolean | null; activeTabIsQuery: boolean | null; };
  sample: 'completed' | 'page-unavailable';
}

/** 只返回固定字段；接口不可用时保留unknown/null，不能把缺失正文当成空串。 */
function unknownDiagnostics(expectedUtf16Units: number): MonacoCaretDiagnostics {
  const draft = { availability: 'unknown' as const, matchesExpected: null, utf16Units: null };
  return {
    expectedUtf16Units, documentFocused: null, visibleQueryCount: null, visibleEditorCount: null, focusedEditorCount: null, completionStatusCount: null, inputRoute: 'unknown', inputBoundToEditor: null,
    model: { ...draft, version: null, selectionCount: null, singleSelectionEmpty: null },
    rendererDraft: { ...draft, reason: 'no-public-store-interface' },
    mainDraft: { ...draft, activeTabPresent: null, activeTabIsQuery: null }, sample: 'page-unavailable'
  };
}

/** 该函数整体交给page.evaluate；只读现有DOM、Monaco公开API和settings.get，不读取剪贴板或新增产品钩子。 */
export async function readMonacoCaretDiagnostics(expected: string): Promise<MonacoCaretDiagnostics> {
  const unknown = { availability: 'unknown' as const, matchesExpected: null, utf16Units: null };
  const result: MonacoCaretDiagnostics = {
    expectedUtf16Units: expected.length, documentFocused: null, visibleQueryCount: null, visibleEditorCount: null, focusedEditorCount: null, completionStatusCount: null, inputRoute: 'unknown', inputBoundToEditor: null,
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
          // 只判断实际活动元素的固定输入路线及归属，不采集DOM/输入文本，也不改变焦点。
          const active = document.activeElement, container = editor.getContainerDomNode();
          if (active && typeof container.contains === 'function') {
            result.inputBoundToEditor = boolean(container.contains(active));
            if (result.inputBoundToEditor) {
              if (active.tagName === 'TEXTAREA') result.inputRoute = 'textarea';
              else if (active.matches('.native-edit-context') === true && typeof (active as Element & { editContext?: unknown }).editContext === 'object' && (active as Element & { editContext?: unknown }).editContext !== null) result.inputRoute = 'nativeEditContext';
            }
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

const countSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const draftSchema = z.object({ availability: z.enum(['known', 'unknown']), matchesExpected: z.boolean().nullable(), utf16Units: countSchema.nullable() });
/** 落盘前再次按固定结构投影；即使页面端口异常返回额外字段，也不能带出SQL、DOM或任意字符串。 */
const diagnosticSchema = z.object({
  cold: countSchema.max(2), phase: z.enum(['prepare', 'completion']), pageErrorCount: countSchema,
  diagnostics: z.object({
    expectedUtf16Units: countSchema, documentFocused: z.boolean().nullable(), visibleQueryCount: countSchema.nullable(), visibleEditorCount: countSchema.nullable(), focusedEditorCount: countSchema.nullable(), completionStatusCount: countSchema.nullable(),
    inputRoute: z.enum(['textarea', 'nativeEditContext', 'unknown']), inputBoundToEditor: z.boolean().nullable(),
    model: draftSchema.extend({ version: countSchema.positive().nullable(), selectionCount: countSchema.nullable(), singleSelectionEmpty: z.boolean().nullable() }),
    rendererDraft: draftSchema.extend({ availability: z.literal('unknown'), matchesExpected: z.null(), utf16Units: z.null(), reason: z.literal('no-public-store-interface') }),
    mainDraft: draftSchema.extend({ activeTabPresent: z.boolean().nullable(), activeTabIsQuery: z.boolean().nullable() }), sample: z.enum(['completed', 'page-unavailable'])
  })
});

/** 仅供afterEach：此时公开duration才是已结束测试体的实际用时，运行中恒0不能用于预算。 */
export async function attachMonacoCaretDiagnostic(
  page: Pick<Page, 'evaluate'>, info: Pick<TestInfo, 'timeout' | 'duration' | 'attach' | 'outputPath'>, context: OfflineCompletionDiagnostic
): Promise<'attached' | 'skipped' | 'timed-out' | 'failed'> {
  const started = performance.now(), timeout = info.timeout, duration = info.duration;
  if (!Number.isFinite(timeout) || timeout < 0 || !Number.isFinite(duration) || duration < 0) return 'skipped';
  // 不改变case期限；连完整诊断预算都不足时直接跳过，不把duration缺失猜成0。
  if (timeout !== 0 && timeout - duration - (performance.now() - started) < 500) return 'skipped';
  const deadline = started + 500;
  const controller = new AbortController();
  let expired = false, timer: ReturnType<typeof setTimeout> | undefined;
  const current = () => !expired && performance.now() < deadline;
  const timeoutResult = new Promise<'timed-out'>(resolve => {
    timer = setTimeout(() => { expired = true; controller.abort(); resolve('timed-out'); }, Math.max(0, deadline - performance.now()));
  });
  const operation = (async (): Promise<'attached' | 'timed-out'> => {
    const diagnostics = await collectMonacoCaretDiagnostics(page, context.marked);
    if (!current()) return 'timed-out';
    const safe = diagnosticSchema.parse({ cold: context.cold, phase: context.phase, pageErrorCount: context.pageErrorCount, diagnostics });
    const body = Buffer.from(JSON.stringify(safe), 'utf8'); if (body.length > 8192) throw Error('诊断超过固定预算');
    if (!current()) return 'timed-out';
    const target = info.outputPath('offline-completion-cold-' + safe.cold + '-diagnostic.json'), partial = target + '.partial';
    let temporary = false;
    try {
      // 写入可中止且只创建本次临时文件；完整写入并核对期限后才发布.json。
      if (!current()) return 'timed-out';
      temporary = true;
      await files.writeFile(partial, body, { flag: 'wx', mode: 0o600, signal: controller.signal });
      if (!current()) return 'timed-out';
      await files.rename(partial, target); temporary = false;
      if (!current()) return 'timed-out';
      // path附件可被仅上传test-results的list报告流程保留；body附件不能代替原文件。
      await info.attach('离线补全阶段-' + safe.cold, { path: target, contentType: 'application/json' });
      return current() ? 'attached' : 'timed-out';
    } catch (error) {
      // wx拒绝已有临时文件时没有取得所有权，不能清掉其它调用留下的现场。
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST') temporary = false;
      throw error;
    } finally {
      // 超时后不新启动清理；已发出IO可能迟到，但.partial绝不冒充完整JSON。
      if (temporary && current()) await files.rm(partial, { force: true });
    }
  })();
  // 即使race已超时，也承接采样或已发出附件的迟到拒绝，不能出现未处理拒绝。
  const settled = operation.then(value => value, () => {
    if (!current()) return 'timed-out' as const;
    console.warn('离线补全诊断不可用：采样或持久化附件失败'); return 'failed' as const;
  });
  try { return await Promise.race([settled, timeoutResult]); }
  finally { expired = true; controller.abort(); if (timer !== undefined) clearTimeout(timer); }
}
