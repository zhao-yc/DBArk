import type { Page } from '@playwright/test';

export interface ShortcutView {
  documentFocused: boolean; editorFocused: boolean; modalCount: number; visiblePanes: number; pane: number;
  saveDisabled: boolean; openDisabled: boolean; editorBusy: boolean;
}
export type ShortcutEvent = { stage: 'before' | 'keydown' | 'menu' | 'task' | 'detached'; view: ShortcutView; command?: 'save-query' | 'other'; repeat?: boolean; composing?: boolean; ctrl?: boolean; meta?: boolean; shift?: boolean; alt?: boolean; task?: { id: string; status: string; phase: string; wrote: string } };
export interface ShortcutChoice { nonce: string; tabId: string; deadline: number; }

/** 只接收本nonce的有界内存事件；失效/溢出立即停链，绝不向页面补读。 */
export class ShortcutEventLog {
  readonly events: ShortcutEvent[] = [];
  private stopped = false;
  constructor(readonly nonce: string, private readonly current: () => void) {}
  ingest(text: string): void {
    if (!text.startsWith('DBARK_FILE_SHORTCUT:' + this.nonce + ':')) return;
    if (this.stopped) return;
    try {
    this.current();
    if (this.events.length >= 32) throw Error('快捷键观察事件溢出，保留原失败');
    const value = JSON.parse(text.slice(('DBARK_FILE_SHORTCUT:' + this.nonce + ':').length));
    const keys = ['stage', 'view', 'command', 'repeat', 'composing', 'ctrl', 'meta', 'shift', 'alt', 'task'];
    if (!value || Object.keys(value).some(key => !keys.includes(key)) || !['before', 'keydown', 'menu', 'task', 'detached'].includes(value.stage)) throw Error('快捷键观察结构未知');
    const viewKeys = ['documentFocused', 'editorFocused', 'modalCount', 'visiblePanes', 'pane', 'saveDisabled', 'openDisabled', 'editorBusy'];
    if (!value.view || Object.keys(value.view).length !== viewKeys.length || Object.keys(value.view).some(key => !viewKeys.includes(key))) throw Error('快捷键观察视图字段未知');
    for (const key of viewKeys) if (['modalCount', 'visiblePanes', 'pane'].includes(key) ? !Number.isSafeInteger(value.view[key]) || value.view[key] < (key === 'pane' ? -1 : 0) : typeof value.view[key] !== 'boolean') throw Error('快捷键观察视图值未知');
    if (value.command !== undefined && !['save-query', 'other'].includes(value.command)) throw Error('快捷键观察命令未知');
    for (const key of ['repeat', 'composing', 'ctrl', 'meta', 'shift', 'alt']) if (value[key] !== undefined && typeof value[key] !== 'boolean') throw Error('快捷键观察按键字段未知');
    if (value.task && (Object.keys(value.task).sort().join(',') !== 'id,phase,status,wrote' || typeof value.task.id !== 'string' || !/^[a-f0-9-]{36}$/.test(value.task.id) || !['running', 'completed', 'failed', 'cancelled'].includes(value.task.status) || !['choosing', 'reading', 'checking', 'staging', 'replacing', 'verifying', 'recording', 'terminal'].includes(value.task.phase) || !['no', 'yes', 'unknown'].includes(value.task.wrote))) throw Error('快捷键观察任务字段未知');
    this.events.push(value);
    } catch (reason) { this.stopped = true; throw reason; }
  }
  /** 原父门失效后只封存已收到的记录，禁止迟到事件污染附录。 */
  stop(): void { this.stopped = true; }
}

/** 只加订阅和capture监听；不包菜单、不拦键、不调用保存。所有数据只含计数、布尔与任务ID。 */
export async function installShortcutObservation(page: Page, choice: ShortcutChoice) {
  return page.evaluate(choice => {
    const root = window as Window & { monaco?: typeof import('monaco-editor'); __queryShortcutObservation?: { nonce: string; dispose(emit: boolean): void } };
    if (root.__queryShortcutObservation || !Number.isFinite(choice.deadline) || Date.now() >= choice.deadline || choice.deadline - Date.now() > 120000) throw Error('快捷键观察原窗口或期限未知');
    let disposed = false, count = 0, timer: ReturnType<typeof setTimeout> | undefined, lastView: ShortcutView | undefined;
    let offMenu = () => {}, offTask = () => {};
    const state = { nonce: choice.nonce, dispose };
    /** 只读取所属可见pane和官方getter；disabled仅是UI投影，不冒充私有busyRef。 */
    function view(): ShortcutView {
      const panes = Array.from(document.querySelectorAll('.query-tab')).filter(node => node.getClientRects().length > 0), pane = panes[0];
      const editor = root.monaco?.editor.getEditors().find(editor => editor.getContainerDomNode().closest('.query-tab') === pane);
      const button = (name: string) => pane?.querySelector<HTMLButtonElement>('button[aria-label="' + name + '"]');
      return lastView = { documentFocused: document.hasFocus(), editorFocused: editor?.hasTextFocus() ?? false, modalCount: document.querySelectorAll('[role="dialog"]').length, visiblePanes: panes.length, pane: pane ? Array.from(document.querySelectorAll('.query-tab')).indexOf(pane) : -1, saveDisabled: button('保存到关联 SQL 文件')?.disabled ?? true, openDisabled: button('打开 SQL 文件')?.disabled ?? true, editorBusy: pane?.querySelector('[aria-busy="true"]') !== null };
    }
    /** 截止后只做本document的本地解绑；不查询SDK、文件、窗口或另一个owner。 */
    function dispose(emit: boolean) {
      if (disposed) return;
      try { if (emit) send({ stage: 'detached', view: view() }); }
      finally { if (!disposed) {
        disposed = true; offMenu(); offTask(); document.removeEventListener('keydown', keydown, true); if (timer) clearTimeout(timer);
        if (root.__queryShortcutObservation === state) delete root.__queryShortcutObservation;
      } }
    }
    /** 观察失败只通知父进程停链，不能从事件监听器抛出并打断原产品的后续订阅。 */
    function fault() {
      try { console.debug('DBARK_FILE_SHORTCUT:' + choice.nonce + ':' + JSON.stringify({ stage: 'fault', view: lastView })); }
      catch { /* 日志通道失效也不能影响产品事件；父进程仍须收到完整观察才能通过。 */ }
      finally { try { dispose(false); } catch { /* 仅观察器自己的解绑异常，不改变原菜单事件分派。 */ } }
    }
    function passive(action: () => void) { try { action(); } catch { fault(); } }
    /** 有界输出安全字段；溢出不能丢记录后继续冒称完整观察。 */
    function send(event: ShortcutEvent) {
      if (disposed || root.__queryShortcutObservation !== state || Date.now() >= choice.deadline) { dispose(false); return; }
      if (++count > 32) { fault(); return; }
      console.debug('DBARK_FILE_SHORTCUT:' + choice.nonce + ':' + JSON.stringify(event));
    }
    function keydown(event: KeyboardEvent) {
      passive(() => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') send({ stage: 'keydown', view: view(), ctrl: event.ctrlKey, meta: event.metaKey, shift: event.shiftKey, alt: event.altKey, repeat: event.repeat, composing: event.isComposing }); });
    }
    root.__queryShortcutObservation = state;
    try {
      offMenu = window.dbark.onCommand(event => passive(() => send({ stage: 'menu', command: event.id === 'save-query' ? 'save-query' : 'other', view: view() })));
      offTask = window.dbark.onTask(event => passive(() => { const task = event.queryFileSource; if (task?.tabId === choice.tabId && task.operation === 'save') send({ stage: 'task', view: view(), task: { id: event.taskId, status: event.status, phase: task.phase, wrote: task.wrote } }); }));
      document.addEventListener('keydown', keydown, true); timer = setTimeout(() => dispose(false), choice.deadline - Date.now());
      send({ stage: 'before', view: view() }); return { nonce: choice.nonce, installed: true };
    } catch (reason) { dispose(false); throw reason; }
  }, choice);
}

/** 仅成功且仍在原父门内时解绑；失败后不通过SDK补取记录或调用此函数。 */
export async function detachShortcutObservation(page: Page, choice: ShortcutChoice) {
  return page.evaluate(choice => {
    const root = window as Window & { __queryShortcutObservation?: { nonce: string; dispose(emit: boolean): void } };
    if (Date.now() >= choice.deadline || root.__queryShortcutObservation?.nonce !== choice.nonce) throw Error('快捷键观察解绑所属或期限未知');
    root.__queryShortcutObservation.dispose(true); return { nonce: choice.nonce, detached: root.__queryShortcutObservation === undefined };
  }, choice);
}
