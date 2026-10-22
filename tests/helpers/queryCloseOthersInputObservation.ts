import type { ConsoleMessage, Page } from '@playwright/test';

export type CloseOthersInputPhase = '全选前' | '全选后' | '插入前' | '插入后';
export interface CloseOthersInputSample {
  phase: CloseOthersInputPhase; tabId: string; paneIndex: number; intendedSql: string;
  /** 这是正式Main返回的持久快照，不是React/Zustand即时草稿，也不宣称与模型原子读取。 */
  persisted: { observedAt: number; activeTabId?: string; sql?: string };
}
export interface CloseOthersInputObservation {
  sample(value: CloseOthersInputSample): Promise<void>;
  stop(): Promise<void>;
  /** 失败只封存父进程已经收到的记录；禁止补读页面或改变原错误。 */
  seal(): string;
}

/** 独占原页面的有界只读诊断；不代理Main、不读取私有store，也不调用输入或模型写API。 */
export async function installQueryCloseOthersInputObservation(page: Page, choice: { nonce: string; deadline: number }, assertCurrent: () => void): Promise<CloseOthersInputObservation> {
  const prefix = 'DBARK_CLOSE_OTHERS_INPUT:' + choice.nonce + ':', records: unknown[] = [];
  let stopped = false, browserStopped = false, invalid = false, bytes = 0;
  const receive = (message: ConsoleMessage) => {
    const text = message.text(); if (!text.startsWith(prefix) || stopped) return;
    try {
      assertCurrent(); const value: unknown = JSON.parse(text.slice(prefix.length));
      const cost = Buffer.byteLength(text, 'utf8');
      if (records.length >= 256 || bytes + cost > 256 * 1024) throw Error('原输入诊断记录超过独立预算');
      records.push(value); bytes += cost;
      if (value && typeof value === 'object' && 'kind' in value && value.kind === '诊断失效') invalid = true;
    } catch { invalid = true; stopped = true; page.off('console', receive); }
  };
  page.on('console', receive);
  /** 每个诊断await仍核原用例；失效不把旧回包附到下一窗口。 */
  const checked = async <T,>(action: () => Promise<T>): Promise<T> => { assertCurrent(); const value = await action(); assertCurrent(); return value; };
  try {
    await checked(() => page.evaluate(choice => {
      type Api = typeof import('monaco-editor');
      type Editor = import('monaco-editor').editor.ICodeEditor;
      type Model = import('monaco-editor').editor.ITextModel;
      type NativeContext = EventTarget & { text: string; selectionStart: number; selectionEnd: number };
      type Target = { tabId: string; paneIndex: number; pane: Element; editor: Editor; model: Model; input: HTMLElement; native?: NativeContext | null };
      type State = { nonce: string; sample(value: CloseOthersInputSample): void; stop(): void };
      const root = window as Window & { monaco?: Api; __dbarkCloseOthersInputObservation?: State };
      const api = root.monaco, prefix = 'DBARK_CLOSE_OTHERS_INPUT:' + choice.nonce + ':';
      if (!api?.editor.getEditors || root.__dbarkCloseOthersInputObservation || !Number.isFinite(choice.deadline) || Date.now() >= choice.deadline || document.querySelectorAll('.tab-content > .tab-pane').length || api.editor.getEditors().length) throw Error('原输入诊断必须在本例唯一空App与原期限内安装');
      const originalDocument = document, originalUrl = location.href, ids = new WeakMap<object, number>(), targets = new Map<string, Target>(), disposals: Array<() => void> = [];
      let nextId = 0, count = 0, size = 0, ended = false;
      const id = (value: object) => { let result = ids.get(value); if (!result) { result = ++nextId; ids.set(value, result); } return result; };
      /** 仅读已有公开文本属性；异常或超预算立即结束观察，不截断后冒称完整证据。 */
      const bounded = (value: unknown, limit = 4096): string => { if (typeof value !== 'string' || value.length > limit) throw Error('原输入诊断文本未知或超预算'); return value; };
      function stop() { if (ended) return; ended = true; for (const dispose of disposals.splice(0)) try { dispose(); } catch { /* 诊断解绑失败不能干扰产品事件。 */ } }
      function emit(value: Record<string, unknown>) {
        if (ended) return;
        if (originalDocument !== document || originalUrl !== location.href || root.__dbarkCloseOthersInputObservation !== state || Date.now() >= choice.deadline) { stop(); return; }
        const record = { sequence: ++count, at: performance.now(), ...value }, text = JSON.stringify(record), cost = new TextEncoder().encode(text).length;
        if (count > 255 || size + cost > 240 * 1024) { console.debug(prefix + JSON.stringify({ kind: '诊断失效', reason: '原输入观察超过预算' })); stop(); return; }
        size += cost; console.debug(prefix + text);
      }
      function passive(action: () => void) {
        if (ended) return;
        try { action(); } catch { emit({ kind: '诊断失效', reason: '原输入对象或公开读取不能确认' }); stop(); }
      }
      /** 模型、选区、真实EditContext及DOM投影分别记录，不把DOM就绪当作模型事件证明。 */
      function view(target: Target) {
        const { editor, model, pane, input } = target;
        if (!pane.isConnected || !input.isConnected || editor.getContainerDomNode().closest('.tab-pane') !== pane || editor.getModel() !== model || model.isDisposed() || model.getValueLength() > 4096 || !pane.contains(input)) throw Error('原输入editor/model或DOM已换代');
        const native = (input as HTMLElement & { editContext?: NativeContext | null }).editContext;
        if (native !== target.native) throw Error('原输入EditContext已换代');
        const source = bounded(model.getValue()), selections = editor.getSelections()?.map(selection => {
          const start = model.getOffsetAt(selection.getStartPosition()), end = model.getOffsetAt(selection.getEndPosition());
          return { start, end, text: bounded(source.slice(start, end)), anchor: model.getOffsetAt(selection.getSelectionStart()), position: model.getOffsetAt(selection.getPosition()) };
        }) ?? null;
        return { tabId: target.tabId, paneIndex: target.paneIndex, editor: id(editor), model: id(model), uri: bounded(model.uri.toString()), version: model.getVersionId(), alternative: model.getAlternativeVersionId(), source, eol: model.getEOL(), selections,
          editorFocused: editor.hasTextFocus(), documentFocused: document.hasFocus(), inputFocused: document.activeElement === input, input: id(input), inputTag: input.tagName, inputRole: input.getAttribute('role'), inputClass: input.className,
          readOnly: editor.getOption(api!.editor.EditorOption.readOnly), ariaBusy: pane.querySelector('.sql-editor-wrap > [aria-busy]')?.getAttribute('aria-busy') ?? null,
          configuredEditContext: editor.getOption(api!.editor.EditorOption.editContext), effectiveEditContext: editor.getOption(api!.editor.EditorOption.effectiveEditContext), nativeEditContext: !!native,
          native: native ? { identity: id(native), text: bounded(native.text, 8192), start: native.selectionStart, end: native.selectionEnd } : null };
      }
      /** 只绑定原目标的公开事件，捕获器绝不阻止默认行为或改变焦点。 */
      function bind(value: CloseOthersInputSample): Target {
        const previous = targets.get(value.tabId); if (previous) { if (previous.paneIndex !== value.paneIndex) throw Error('原输入pane位置已变化'); return previous; }
        const pane = document.querySelectorAll('.tab-content > .tab-pane')[value.paneIndex];
        if (!pane || pane.getClientRects().length === 0) throw Error('原输入目标pane不可见');
        const editors = api!.editor.getEditors().filter(editor => editor.getContainerDomNode().closest('.tab-pane') === pane);
        if (editors.length !== 1) throw Error('原输入目标编辑器不唯一');
        const editor = editors[0], model = editor.getModel(), inputs = Array.from(editor.getContainerDomNode().querySelectorAll<HTMLElement>('[role="textbox"]')).filter(input => input.isConnected && input.getClientRects().length > 0 && getComputedStyle(input).visibility !== 'hidden' && input.getAttribute('aria-hidden') !== 'true');
        if (!model || model.isDisposed() || inputs.length !== 1) throw Error('原输入模型或输入框不唯一');
        const input = inputs[0], native = (input as HTMLElement & { editContext?: NativeContext | null }).editContext, target = { tabId: value.tabId, paneIndex: value.paneIndex, pane, editor, model, input, native };
        targets.set(value.tabId, target);
        const content = model.onDidChangeContent(event => passive(() => emit({ kind: '模型正文事件', eventVersion: event.versionId, undo: event.isUndoing, redo: event.isRedoing, flush: event.isFlush, changes: event.changes.map(change => ({ start: change.rangeOffset, length: change.rangeLength, text: bounded(change.text) })), view: view(target) })));
        const modelChange = editor.onDidChangeModel(() => passive(() => { emit({ kind: '诊断失效', reason: '原编辑器模型改变', tabId: target.tabId }); stop(); }));
        const disposed = model.onWillDispose(() => passive(() => { emit({ kind: '诊断失效', reason: '原模型被释放', tabId: target.tabId }); stop(); }));
        disposals.push(() => content.dispose(), () => modelChange.dispose(), () => disposed.dispose());
        for (const name of ['keydown', 'beforeinput', 'input', 'focus', 'blur']) {
          const listener = (event: Event) => passive(() => { const keyboard = event as KeyboardEvent, insertion = event as InputEvent; emit({ kind: '原生DOM事件', name, trusted: event.isTrusted, key: keyboard.key, control: keyboard.ctrlKey, meta: keyboard.metaKey, composing: insertion.isComposing, inputType: insertion.inputType, data: insertion.data == null ? null : bounded(insertion.data), view: view(target) }); });
          input.addEventListener(name, listener, { capture: true, passive: true }); disposals.push(() => input.removeEventListener(name, listener, true));
        }
        if (native) {
          const listener = (event: Event) => passive(() => { const update = event as Event & { text: string; updateRangeStart: number; updateRangeEnd: number; selectionStart: number; selectionEnd: number }; emit({ kind: '原生EditContext事件', name: 'textupdate', trusted: event.isTrusted, text: bounded(update.text), start: update.updateRangeStart, end: update.updateRangeEnd, selectionStart: update.selectionStart, selectionEnd: update.selectionEnd, view: view(target) }); });
          native.addEventListener('textupdate', listener, { passive: true }); disposals.push(() => native.removeEventListener('textupdate', listener));
        }
        return target;
      }
      const state: State = { nonce: choice.nonce, sample(value) { passive(() => { const target = bind(value), current = view(target); emit({ kind: '原写入阶段', phase: value.phase, intendedSql: bounded(value.intendedSql), persisted: value.persisted, persistedIsRendererDraft: false, modelEqualsPersisted: current.source.replaceAll('\r\n', '\n') === value.persisted.sql?.replaceAll('\r\n', '\n'), view: current }); }); }, stop };
      root.__dbarkCloseOthersInputObservation = state;
      emit({ kind: '诊断环境差异', globalApiEnabled: true, emptyAppReloads: 1, editorOptionsChanged: false, inputMethodChanged: false, originalFailureFixed: false, deadline: choice.deadline });
    }, choice));
  } catch (error) { stopped = true; page.off('console', receive); throw error; }
  return {
    async sample(value) { await checked(() => page.evaluate(({ nonce, value }) => { const state = (window as Window & { __dbarkCloseOthersInputObservation?: { nonce: string; sample(value: CloseOthersInputSample): void } }).__dbarkCloseOthersInputObservation; if (!state || state.nonce !== nonce) throw Error('原输入诊断实例已变化'); state.sample(value); }, { nonce: choice.nonce, value })); },
    async stop() { if (browserStopped || stopped) return; await checked(() => page.evaluate(nonce => { const state = (window as Window & { __dbarkCloseOthersInputObservation?: { nonce: string; stop(): void } }).__dbarkCloseOthersInputObservation; if (!state || state.nonce !== nonce) throw Error('原输入诊断实例已变化'); state.stop(); }, choice.nonce)); browserStopped = true; },
    seal() { stopped = true; page.off('console', receive); return JSON.stringify({ kind: 'dbark.query-close-others-input-diagnostics', version: 1, nonce: choice.nonce, environmentDifference: { publicGlobalApi: true, emptyAppReloads: 1, originalFailureFixed: false }, collectionStoppedNormally: browserStopped, receivedRecordsOnly: true, completeDomHistoryProven: false, invalid, records }, null, 2); },
  };
}
