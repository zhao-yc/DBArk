import { flushSync } from 'react-dom';
import { MemoryEvent, MemoryNode, type MemoryDocument } from '../fixtures/memory-dom';

/** 仅补DOM展示合同，不证明真实布局、原生焦点、输入或数据库行为。 */
export function installNavigationMenuRamPort(document: MemoryDocument): () => void {
  const names = ['Node', 'Element', 'HTMLElement', 'HTMLButtonElement', 'HTMLInputElement', 'MutationObserver', 'ResizeObserver', 'getComputedStyle'];
  const saved = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const prototype = MemoryNode.prototype as any;
  const properties = ['isConnected', 'parentElement', 'dataset', 'clientWidth', 'scrollIntoView', 'matches', 'insertBefore', 'removeChild', 'setAttribute', 'removeAttribute', 'textContent'];
  const original = new Map(properties.map(name => [name, Object.getOwnPropertyDescriptor(prototype, name)]));
  const createElement = document.createElement.bind(document);
  document.createElement = name => {
    const node = createElement(name);
    if (['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'].includes(node.tagName)) Object.defineProperty(node, 'disabled', { configurable: true, get: () => node.attributes.has('disabled'), set(value) { if (value) node.attributes.set('disabled', ''); else node.attributes.delete('disabled'); } });
    if (node.tagName === 'INPUT') Object.defineProperty(node, 'type', { configurable: true, get: () => node.attributes.get('type') ?? 'text', set(value: string) { node.attributes.set('type', value); } });
    return node;
  };
  Object.defineProperties(prototype, {
    isConnected: { configurable: true, get(this: MemoryNode) { return this.ownerDocument?.contains(this) ?? false; } },
    parentElement: { configurable: true, get(this: MemoryNode) { return this.parentNode?.nodeType === 1 ? this.parentNode : null; } },
    dataset: { configurable: true, get(this: MemoryNode) { return Object.fromEntries([...this.attributes].filter(([key]) => key.startsWith('data-')).map(([key, value]) => [key.slice(5).replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase()), value])); } },
    clientWidth: { configurable: true, get() { return 1440; } },
    scrollIntoView: { configurable: true, writable: true, value() {} },
    matches: { configurable: true, value(this: MemoryNode, selector: string) { return selector.split(',').some(part => { const match = part.trim().match(/^\[([^=\]]+)="([^"]*)"\]$/); return !!match && this.getAttribute(match[1]) === match[2]; }); } },
  });
  const observers = new Set<DisplayMutationObserver>();
  class DisplayMutationObserver {
    private records: MutationRecord[] = [];
    private target?: MemoryNode;
    private options: MutationObserverInit = {};
    private queued = false;
    constructor(private callback: MutationCallback) {}
    observe(target: MemoryNode, options: MutationObserverInit) { this.target = target; this.options = options; observers.add(this); }
    disconnect() { this.target = undefined; this.records = []; observers.delete(this); }
    takeRecords(): MutationRecord[] { const records = this.records; this.records = []; return records; }
    /** 仅同步DOM树/属性变化，不制造布局、用户输入或业务事件。 */
    accept(record: MutationRecord): void {
      if (!this.target) return;
      if (record.type === 'attributes' && (!this.options.attributes || this.options.attributeFilter && !this.options.attributeFilter.includes(record.attributeName!))) return;
      if (record.type === 'childList' && !this.options.childList) return;
      const target = record.target as unknown as MemoryNode;
      // DOM树祖先关系只走原父链；不能为每个属性变更递归扫描不断增大的整个筛选面板。
      let ancestor: MemoryNode | null = target;
      if (target !== this.target && !this.options.subtree) return;
      while (ancestor && ancestor !== this.target) ancestor = ancestor.parentNode;
      if (!ancestor) return;
      this.records.push(record);
      if (this.queued) return; this.queued = true;
      queueMicrotask(() => { this.queued = false; const records = this.takeRecords(); if (this.target && records.length) this.callback(records, this as unknown as MutationObserver); });
    }
  }
  const record = (target: MemoryNode, changes: Partial<MutationRecord>) => {
    const value = { target, addedNodes: [], removedNodes: [], oldValue: null, ...changes } as unknown as MutationRecord;
    for (const observer of observers) observer.accept(value);
  };
  const insert = original.get('insertBefore')!.value, remove = original.get('removeChild')!.value;
  const setAttribute = original.get('setAttribute')!.value, removeAttribute = original.get('removeAttribute')!.value, textContent = original.get('textContent')!;
  prototype.insertBefore = function(this: MemoryNode, child: MemoryNode, before: MemoryNode | null) { const result = insert.call(this, child, before); record(this, { type: 'childList', addedNodes: [child] as unknown as NodeList }); return result; };
  prototype.removeChild = function(this: MemoryNode, child: MemoryNode) { const result = remove.call(this, child); record(this, { type: 'childList', removedNodes: [child] as unknown as NodeList }); return result; };
  prototype.setAttribute = function(this: MemoryNode, name: string, value: string) { const oldValue = this.getAttribute(name); setAttribute.call(this, name, value); record(this, { type: 'attributes', attributeName: name, oldValue }); };
  prototype.removeAttribute = function(this: MemoryNode, name: string) { const oldValue = this.getAttribute(name); removeAttribute.call(this, name); record(this, { type: 'attributes', attributeName: name, oldValue }); };
  Object.defineProperty(prototype, 'textContent', { ...textContent, set(this: MemoryNode, value: string) { const children = [...this.childNodes]; textContent.set!.call(this, value); if (children.length) record(this, { type: 'childList', removedNodes: children as unknown as NodeList }); } });
  class DisplayResizeObserver { observe() {} disconnect() {} unobserve() {} }
  const values: Record<string, unknown> = { Node: MemoryNode, Element: MemoryNode, HTMLElement: MemoryNode, HTMLButtonElement: MemoryNode, HTMLInputElement: MemoryNode, MutationObserver: DisplayMutationObserver, ResizeObserver: DisplayResizeObserver, getComputedStyle: () => ({ columnGap: '0', paddingLeft: '0', paddingRight: '0' }) };
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  Object.assign(document.defaultView as object, { innerWidth: 1440, innerHeight: 920 });
  return () => {
    for (const observer of observers) observer.disconnect();
    document.createElement = createElement;
    for (const [key, descriptor] of original) if (descriptor) Object.defineProperty(prototype, key, descriptor); else delete prototype[key];
    for (const [key, descriptor] of saved) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
  };
}

/** 专项夹具保留手动模态回放，同时继承真实菜单所需的记录/取出/释放合同。 */
export function navigationMenuObservedMutationPort(observers: { add(value: any): unknown; delete(value: any): unknown }) {
  const Observer = globalThis.MutationObserver;
  return class extends Observer {
    private manual: (records?: Array<Partial<MutationRecord>>) => void;
    constructor(callback: MutationCallback) {
      super(callback);
      this.manual = (records = []) => callback(records.map(record => ({ type: 'childList', addedNodes: [], removedNodes: [], ...record })) as MutationRecord[], this);
      observers.add(this.manual);
    }
    disconnect(): void { super.disconnect(); observers.delete(this.manual); }
  };
}

/** 门户菜单在body中；只忽略明确隐藏的标签，不添加任何旧按钮。 */
function visible(node: MemoryNode): boolean { for (let current: MemoryNode | null = node; current; current = current.parentNode) if (current.hidden || current.getAttribute('hidden') !== null) return false; return true; }
function matches(node: MemoryNode, label: string): boolean { return node.textContent === label || node.getAttribute('aria-label') === label || node.getAttribute('title') === label || node.textContent.startsWith(label) && node.childNodes.some(child => child.tagName === 'KBD'); }
function click(node: MemoryNode): void { flushSync(() => { node.dispatchEvent(new MemoryEvent('click')); }); }

/** 点击真实更多及子菜单找到原动作；只展开菜单，不调用业务处理器。 */
export function navigationMenuRamButton(scope: MemoryNode, label: string, options: { open?: boolean } = {}): MemoryNode | undefined {
  return navigationMenuRamControl(scope, label, 'button', options);
}

/** 菜单中的数值设置仍走原input，只调整测试的展示入口。 */
export function navigationMenuRamInput(scope: MemoryNode, label: string, options: { open?: boolean } = {}): MemoryNode | undefined {
  return navigationMenuRamControl(scope, label, 'input', options);
}

/** 执行选项复选框也从真实会话菜单取得，不给隐藏标签造旧控件。 */
export function navigationMenuRamCheckbox(scope: MemoryNode, label: string, options: { open?: boolean } = {}): MemoryNode | undefined {
  return navigationMenuRamControl(scope, label, 'input', options);
}

function navigationMenuRamControl(scope: MemoryNode, label: string, tag: 'button' | 'input', options: { open?: boolean }): MemoryNode | undefined {
  const document = scope.ownerDocument;
  const inMenu = (node: MemoryNode) => { for (let parent = node.parentNode; parent; parent = parent.parentNode) if (parent.classList.contains('action-menu-panel')) return true; return false; };
  const find = () => {
    const direct = scope.querySelectorAll(tag).find(node => visible(node) && matches(node, label));
    if (direct) return direct;
    // scope已包含body时首轮已检查门户；其它宿主才需要再检索body中的真实菜单。
    if (scope === document || scope === document.body || scope === document.documentElement) return undefined;
    return document.body.querySelectorAll(tag).find(node => (tag === 'button' ? node.getAttribute('role') === 'menuitem' : inMenu(node)) && visible(node) && matches(node, label));
  };
  const present = find(); if (present || options.open === false) return present;
  const triggers = scope.querySelectorAll('button').filter(node => visible(node) && node.classList.contains('action-menu-trigger') && !node.disabled);
  for (const trigger of triggers) {
    if (trigger.getAttribute('aria-expanded') !== 'true') click(trigger);
    let found = find(); if (found) return found;
    const sections = document.body.querySelectorAll('button').filter(node => node.getAttribute('role') === 'menuitem' && node.getAttribute('aria-haspopup') === 'menu' && !node.disabled);
    for (const section of sections) { click(section); found = find(); if (found) return found; }
    if (trigger.getAttribute('aria-expanded') === 'true') click(trigger);
  }
  return undefined;
}
