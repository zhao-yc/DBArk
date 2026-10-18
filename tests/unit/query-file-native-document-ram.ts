import { runInNewContext } from 'node:vm';

/** 普通标签/Monaco/DOM通知的RAM端口，只供测试观察函数，不打开浏览器或操作系统窗口。 */
export function createQueryFileNativeDocumentRam() {
  class Element {
    parent?: Element; hidden = false; active = false; isConnected = true; select?: Element;
    constructor(readonly kind: string) {}
    getClientRects() { let value: Element | undefined = this; while (value) { if (value.hidden || !value.isConnected) return []; value = value.parent; } return [{}]; }
    closest(selector: string): Element | null { let value: Element | undefined = this; while (value) { if (selector === '.' + value.kind) return value; value = value.parent; } return null; }
    contains(other: Element) { let value: Element | undefined = other; while (value) { if (value === this) return true; value = value.parent; } return false; }
    querySelector(selector: string) { return selector === '.tab-select' ? this.select ?? null : null; }
    get classList() { return { contains: (name: string) => name === 'active' && this.active }; }
  }
  const content = new Element('tab-content'), panes = [new Element('tab-pane'), new Element('tab-pane')], tabs = [new Element('workspace-tab-button'), new Element('workspace-tab-button')];
  const clicks = new Set<Function>(), observers: MutationObserver[] = [], models: any[] = [], editors: any[] = [];
  const settings: any = { activeTabId: 'tab', tabs: [{ id: 'tab', kind: 'query', title: '原合成文档', fileSourceBinding: { id: 'source', revision: 1 } }, { id: 'other', kind: 'query', title: '重读合成草稿' }] };
  class MutationObserver {
    records: any[] = []; connected = false;
    constructor(readonly callback: Function) { observers.push(this); }
    observe() { this.connected = true; }
    takeRecords() { return this.records.splice(0); }
    disconnect() { this.connected = false; this.records.splice(0); }
    deliver() { if (this.connected) this.callback(this.takeRecords()); }
  }
  const queue = (record: unknown) => observers.filter(observer => observer.connected).forEach(observer => observer.records.push(record));
  for (let index = 0; index < 2; index++) {
    panes[index].parent = content; panes[index].hidden = index !== 0; tabs[index].active = index === 0; tabs[index].select = new Element('tab-select'); tabs[index].select!.parent = tabs[index];
    const query = new Element('query-tab'), node = new Element('monaco-editor'); query.parent = panes[index]; node.parent = query;
    const changes = new Set<Function>(), disposals = new Set<Function>();
    const model = { isDisposed: () => false, onWillDispose: (fn: Function) => { disposals.add(fn); return { dispose: () => disposals.delete(fn) }; }, disposals };
    models.push(model); editors.push({ getContainerDomNode: () => node, getModel: () => models[index], hasTextFocus: () => !panes[index].hidden, hasWidgetFocus: () => !panes[index].hidden, onDidChangeModel: (fn: Function) => { changes.add(fn); return { dispose: () => changes.delete(fn) }; }, changes });
  }
  const menu = new Set<Function>(); let dialogs = 0;
  const window: any = { monaco: { editor: { getEditors: () => editors } }, dbark: { invoke: async (command: string) => { if (command !== 'settings.get') throw Error('RAM文档只允许只读settings.get'); return JSON.parse(JSON.stringify(settings)); }, onMenu: (fn: Function) => { menu.add(fn); return () => menu.delete(fn); } } };
  const document = {
    hasFocus: () => true, activeElement: { tagName: 'TEXTAREA', className: 'inputarea' },
    querySelector: (selector: string) => selector === '.tab-content' ? content : null,
    querySelectorAll: (selector: string) => selector === '.tab-content .tab-pane' ? panes : selector === '.tab-strip .workspace-tab-button' ? tabs : selector === '[role="dialog"]' ? Array.from({ length: dialogs }, () => ({})) : [],
    addEventListener: (_event: string, fn: Function) => clicks.add(fn), removeEventListener: (_event: string, fn: Function) => clicks.delete(fn),
  };
  return {
    settings, window, observers, panes, tabs,
    /** 模拟Playwright跨renderer序列化，不能借Node词法闭包代替真实DOM函数的依赖。 */
    evaluate: (fn: Function, input?: unknown) => runInNewContext('(' + fn.toString() + ')(input)', { window, document, MutationObserver, Element, getComputedStyle: () => ({ visibility: 'visible' }), input, Error }),
    /** 模拟普通选择事件和React对hidden的提交；可延迟投递以检查请求间通知隔离。 */
    select(index: number, deliver = true, click = true) {
      if (click) clicks.forEach(fn => fn({ target: tabs[index].select }));
      panes.forEach((pane, at) => { const hidden = at !== index; if (pane.hidden !== hidden) { queue({ type: 'attributes', target: pane, attributeName: 'hidden', removedNodes: [] }); pane.hidden = hidden; } tabs[at].active = at === index; });
      settings.activeTabId = settings.tabs[index].id; if (deliver) observers.forEach(observer => observer.deliver());
    },
    changeModel() { models[0] = { ...models[0] }; editors[0].changes.forEach((fn: Function) => fn()); },
    setRevision(revision: number) { settings.tabs[0].fileSourceBinding.revision = revision; },
    setSource(id: string) { settings.tabs[0].fileSourceBinding.id = id; },
    openConflict() { dialogs = 1; },
    emitMenu() { menu.forEach(fn => fn('save-query')); },
  };
}
