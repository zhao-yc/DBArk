import type { AppSettings } from '../../src/shared/contracts';

export interface QueryFileNativeDocumentInput {
  action: 'begin' | 'check' | 'end'; token: string;
  expected?: { tabId: string; sourceId: string; revision: number };
  settings?: AppSettings; allowRevisionGrowth?: boolean;
}

/** 由Playwright序列化到所属renderer；只读UI/模型并被动订阅，每个请求独立持有观察器。 */
export function observeQueryFileNativeDocument(input: QueryFileNativeDocumentInput) {
  type Editor = import('monaco-editor').editor.ICodeEditor;
  type Model = import('monaco-editor').editor.ITextModel;
  type Watch = { token: string; live: boolean; invalid?: string; expected: NonNullable<QueryFileNativeDocumentInput['expected']>; pane: Element; select: Element; editor: Editor; model: Model; observer: MutationObserver; change: { dispose(): void }; disposal: { dispose(): void }; click: (event: MouseEvent) => void; consume(records: MutationRecord[]): void };
  const root = window as Window & { monaco?: typeof import('monaco-editor'); __queryFileNativeDocument?: Watch };
  /** 身份取实际可见pane及官方Monaco getter，不依赖标题文本，也不读写React store。 */
  const layout = () => {
    const panes = Array.from(document.querySelectorAll('.tab-content .tab-pane'));
    const visible = panes.filter(pane => !(pane as HTMLElement).hidden && pane.getClientRects().length > 0 && getComputedStyle(pane).visibility !== 'hidden');
    const tabs = Array.from(document.querySelectorAll('.tab-strip .workspace-tab-button'));
    const selected = tabs.filter(tab => tab.classList.contains('active'));
    if (visible.length !== 1 || selected.length !== 1 || !root.monaco?.editor.getEditors) throw Error('按键等待缺少唯一活动查询界面');
    const pane = visible[0], index = panes.indexOf(pane), select = selected[0].querySelector('.tab-select');
    const editors = root.monaco.editor.getEditors().filter(editor => { const node = editor.getContainerDomNode(); return node.isConnected && node.closest('.tab-pane') === pane && !!node.closest('.query-tab') && node.getClientRects().length > 0; });
    if (!select || tabs.indexOf(selected[0]) !== index || editors.length !== 1) throw Error('按键等待实际标签与查询编辑器不一致');
    const editor = editors[0], model = editor.getModel(); if (!model || model.isDisposed()) throw Error('按键等待实际查询模型不可用');
    return { pane, select, editor, model, index };
  };
  if (input.action === 'begin') {
    if (root.__queryFileNativeDocument || !input.token || !input.expected) throw Error('已有请求观察器或文档绑定缺失');
    const initial = layout();
    const state = { token: input.token, live: true, expected: { ...input.expected }, pane: initial.pane, select: initial.select, editor: initial.editor, model: initial.model } as Watch;
    /** 旧回调只能看自己的token和对象；已结束后即使排队回调到达，也不能影响下一请求。 */
    const current = () => state.live && root.__queryFileNativeDocument === state && root.__queryFileNativeDocument.token === state.token;
    /** 首次变化留下本请求的永久标记，不随选回原标签或恢复原值而清除。 */
    const invalidate = (reason: string) => { if (current()) state.invalid ??= reason; };
    /** 仅比较pane/editor/model对象身份，不冻结焦点、正文版本或保存提示。 */
    const inspect = () => {
      if (!current()) return;
      try { const value = layout(); if (value.pane !== state.pane || value.select !== state.select || value.editor !== state.editor || value.model !== state.model) invalidate('等待期间活动文档已切换'); }
      catch { invalidate('等待期间活动文档已移除或不可用'); }
    };
    // 回调与主动takeRecords共用同一检查，积压记录不能被最终相同的可见状态抹去。
    state.consume = records => {
      if (!current()) return;
      for (const record of records) {
        // 即使同一批记录最终又回到原pane，原pane的hidden变化仍永久终止本请求。
        if (record.type === 'attributes' && record.target === state.pane && record.attributeName === 'hidden') invalidate('等待期间原查询标签已离开');
        if (record.type === 'childList' && Array.from(record.removedNodes).some(node => node === state.pane || node.contains(state.pane))) invalidate('等待期间原查询标签已移除');
      }
      inspect();
    };
    // 捕获正常标签选择但不preventDefault；实际界面仍自行处理用户操作。
    state.click = event => {
      if (!current()) return;
      const target = event.target instanceof Element ? event.target.closest('.tab-select') : null;
      if (target && target !== state.select) invalidate('等待期间已选择其他标签');
    };
    const content = document.querySelector('.tab-content'); if (!content) throw Error('按键等待查询容器缺失');
    state.observer = new MutationObserver(records => state.consume(records));
    // 每个新实例起点没有旧记录；结束时takeRecords/disconnect，禁止跨阶段共享DOM队列。
    state.observer.takeRecords();
    state.change = state.editor.onDidChangeModel(() => invalidate('等待期间编辑器模型已更换'));
    state.disposal = state.model.onWillDispose(() => invalidate('等待期间查询模型已释放'));
    root.__queryFileNativeDocument = state;
    state.observer.observe(content, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden', 'class'], attributeOldValue: true });
    document.addEventListener('click', state.click, true);
  }
  const state = root.__queryFileNativeDocument;
  if (!state || !state.live || state.token !== input.token) throw Error('按键等待请求token已变化');
  state.consume(state.observer.takeRecords());
  if (state.invalid) throw Error(state.invalid);
  const actual = layout();
  let revision: number | undefined;
  if (input.settings) {
    const tab = input.settings.tabs[actual.index], source = tab?.fileSourceBinding;
    if (!tab || input.settings.activeTabId !== state.expected.tabId || tab.id !== state.expected.tabId || tab.kind !== 'query' || !source || source.id !== state.expected.sourceId || !Number.isSafeInteger(source.revision) || (input.allowRevisionGrowth ? source.revision < state.expected.revision : source.revision !== state.expected.revision)) {
      state.invalid = '按键等待实际活动文档或文件来源不一致'; throw Error(state.invalid);
    }
    revision = source.revision;
  }
  const result = { token: state.token, tabId: state.expected.tabId, sourceId: state.expected.sourceId, revision, paneIndex: actual.index };
  if (input.action === 'end') {
    // 先检查本请求最后的记录，再关闭自己的订阅；下一请求不会接收其迟到通知。
    state.live = false; state.observer.takeRecords(); state.observer.disconnect(); state.change.dispose(); state.disposal.dispose();
    document.removeEventListener('click', state.click, true); delete root.__queryFileNativeDocument;
  }
  return result;
}
