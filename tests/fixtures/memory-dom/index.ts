/** ReactDOM测试专用内存端口；不模拟浏览器布局、原生输入、焦点验收或系统API。 */
export class MemoryEvent {
  target?: MemoryNode; currentTarget?: MemoryNode; defaultPrevented = false; cancelBubble = false;
  bubbles = true; button = 0; key = ''; type: string;
  constructor(type: string) { this.type = type; }
  preventDefault() { this.defaultPrevented = true; }
  stopPropagation() { this.cancelBubble = true; }
}
type Listener = (event: MemoryEvent) => void;
export class MemoryNode {
  nodeType: number; nodeName: string; tagName: string; namespaceURI = 'http://www.w3.org/1999/xhtml';
  parentNode: MemoryNode | null = null; childNodes: MemoryNode[] = []; ownerDocument!: MemoryDocument;
  attributes = new Map<string, string>(); listeners = new Map<string, Array<{ fn: Listener; capture: boolean }>>();
  style = { setProperty(name: string, value: string) { (this as Record<string, unknown>)[name] = value; } };
  value = ''; defaultValue = ''; checked = false; disabled = false; hidden = false; type = ''; name = '';
  selectionStart = 0; selectionEnd = 0; private text = '';
  constructor(name: string, nodeType = 1) { this.nodeType = nodeType; this.nodeName = this.tagName = nodeType === 1 ? name.toUpperCase() : name; }
  get firstChild() { return this.childNodes[0] ?? null; }
  /** 仅DOM结构端口；内存环境没有布局，几何默认为0，专项布局用例另提供测量值。 */
  get children() { return this.childNodes.filter(node => node.nodeType === 1); }
  get classList() { return { contains: (name: string) => (this.getAttribute('class') ?? '').split(/\s+/).includes(name) }; }
  getBoundingClientRect() { return { x: 0, y: 0, top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 }; }
  get lastChild(): MemoryNode | null { return this.childNodes.at(-1) ?? null; }
  get nextSibling() { const list = this.parentNode?.childNodes ?? []; return list[list.indexOf(this) + 1] ?? null; }
  get textContent(): string { return this.text + this.childNodes.map(node => node.textContent).join(''); }
  set textContent(value: string) { for (const node of this.childNodes) node.parentNode = null; this.childNodes = []; this.text = String(value ?? ''); }
  get nodeValue() { return this.text; }
  set nodeValue(value: string) { this.text = value; }
  appendChild(child: MemoryNode) { return this.insertBefore(child, null); }
  insertBefore(child: MemoryNode, before: MemoryNode | null) { child.parentNode?.removeChild(child); child.parentNode = this; const index = before ? this.childNodes.indexOf(before) : -1; if (index < 0) this.childNodes.push(child); else this.childNodes.splice(index, 0, child); return child; }
  removeChild(child: MemoryNode) { const i = this.childNodes.indexOf(child); if (i < 0) throw Error('内存节点不属于当前父节点'); this.childNodes.splice(i, 1); child.parentNode = null; return child; }
  setAttribute(name: string, value: string) { this.attributes.set(name, String(value)); }
  setAttributeNS(_ns: string, name: string, value: string) { this.setAttribute(name, value); }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  removeAttribute(name: string) { this.attributes.delete(name); }
  addEventListener(type: string, fn: Listener, capture = false) { const list = this.listeners.get(type) ?? []; list.push({ fn, capture: capture === true }); this.listeners.set(type, list); }
  removeEventListener(type: string, fn: Listener) { this.listeners.set(type, (this.listeners.get(type) ?? []).filter(item => item.fn !== fn)); }
  /** 按捕获/冒泡次序投递给真实ReactDOM事件委派，不反射读取React内部字段。 */
  dispatchEvent(event: MemoryEvent) { event.target ??= this; const chain: MemoryNode[] = []; for (let node: MemoryNode | null = this; node; node = node.parentNode) chain.push(node); for (const capture of [true, false]) for (const node of capture ? [...chain].reverse() : chain) { event.currentTarget = node; for (const listener of node.listeners.get(event.type) ?? []) if (listener.capture === capture) listener.fn(event); if (event.cancelBubble) return !event.defaultPrevented; } return !event.defaultPrevented; }
  contains(node: MemoryNode): boolean { return this === node || this.childNodes.some(child => child.contains(node)); }
  focus() { this.ownerDocument.activeElement = this; }
  blur() { this.ownerDocument.activeElement = this.ownerDocument.body; }
  getRootNode(): MemoryNode { return this.parentNode?.getRootNode() ?? this; }
  setSelectionRange(start: number, end: number) { this.selectionStart = start; this.selectionEnd = end; }
  querySelectorAll(selector: string): MemoryNode[] { const result: MemoryNode[] = []; const matches = (node: MemoryNode) => selector.split(',').some(part => { const s = part.trim(); if (s.includes(':not(:disabled)') && node.disabled) return false; const tag = s.match(/^[a-z]+/)?.[0]; if (tag && node.tagName !== tag.toUpperCase()) return false; const attr = s.match(/\[([^=\]]+)(?:="([^"]*)")?\]/); if (attr && (attr[2] === undefined ? !node.attributes.has(attr[1]) : node.getAttribute(attr[1]) !== attr[2])) return false; return !!tag || !!attr; }); const walk = (node: MemoryNode) => { for (const child of node.childNodes) { if (child.nodeType === 1 && matches(child)) result.push(child); walk(child); } }; walk(this); return result; }
  querySelector(selector: string) { return this.querySelectorAll(selector)[0] ?? null; }
}
export class MemoryDocument extends MemoryNode {
  documentElement: MemoryNode; body: MemoryNode; activeElement: MemoryNode; defaultView: unknown;
  constructor() { super('#document', 9); this.ownerDocument = this; this.documentElement = this.createElement('html'); this.body = this.createElement('body'); this.appendChild(this.documentElement); this.documentElement.appendChild(this.body); this.activeElement = this.body; }
  createElement(name: string) { const node = new MemoryNode(name); node.ownerDocument = this; return node; }
  createElementNS(ns: string, name: string) { const node = this.createElement(name); node.namespaceURI = ns; return node; }
  createTextNode(text: string) { const node = new MemoryNode('#text', 3); node.ownerDocument = this; node.nodeValue = text; return node; }
  getSelection() { return { rangeCount: 0 }; }
}
/** 每个测试文件使用独立worker与内存document；没有网络、布局、剪贴板或本机GUI。 */
export function memoryDocument() {
  const document = new MemoryDocument(), window = { document, HTMLElement: MemoryNode, HTMLIFrameElement: class {}, Node: MemoryNode, addEventListener() {}, removeEventListener() {}, getSelection: () => document.getSelection() };
  document.defaultView = window;
  Object.defineProperty(globalThis, 'window', { value: window, configurable: true }); Object.defineProperty(globalThis, 'document', { value: document, configurable: true });
  Object.defineProperty(globalThis, 'navigator', { value: { userAgent: '内存React测试' }, configurable: true });
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true, writable: true });
  return document;
}
