import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { errorMessage } from '../lib';
import { filterOpenTabs, type OpenTabSearchEntry, type OpenTabSearchRegistry } from '../openTabSearch';
import { useWorkspace } from '../store';
import { openTabSearchZh as text } from '../locales/openTabSearch.zh-CN';
import { ErrorBox, Modal } from './ui';
import '../openTabSearch.css';

/** 列表只持标签元数据及原Registry令牌，不读取正文、创建标签或访问数据库。 */
export function OpenTabSearchDialog({ registry, onActivate, onClose }: {
  registry: OpenTabSearchRegistry; onActivate(entry: OpenTabSearchEntry): boolean | void; onClose(): void;
}) {
  const tabs = useWorkspace(state => state.settings.tabs), connections = useWorkspace(state => state.connections), activeId = useWorkspace(state => state.settings.activeTabId);
  const dirty = useWorkspace(state => state.dirtyTabs), fileDirty = useWorkspace(state => state.queryFileDirty);
  const [query, setQuery] = useState(''), [selection, setSelection] = useState<object | null>(() => initialSelection('')), [interaction, setInteraction] = useState(0), [activationError, setActivationError] = useState('');
  const [, setTabRevision] = useState(0);
  const host = useRef<HTMLDivElement | null>(null), input = useRef<HTMLInputElement | null>(null), list = useRef<HTMLDivElement | null>(null);
  const alive = useRef(false), ended = useRef(false), composing = useRef(false), epoch = useRef(0), committed = useRef<object | null>(null), ticket = {}, listId = useId();
  let entries: OpenTabSearchEntry[] = [], filtered: OpenTabSearchEntry[] = [], error = ''; const fileChanges = new Set<string>();
  try {
    entries = registry.snapshot(tabs, connections); filtered = filterOpenTabs(entries, query);
    // 与标签栏一致：文件绑定还没有clean回执时保守显示dirty，不读取文件或SQL正文。
    for (let index = 0; index < tabs.length; index++) if (Object.getOwnPropertyDescriptor(tabs[index], 'fileSourceBinding')?.value && flag(fileDirty, entries[index].id) !== false) fileChanges.add(entries[index].id);
  } catch (reason) { error = errorMessage(reason); }
  const selected = filtered.find(entry => entry.token === selection), selectionMissing = selection !== null && !selected;
  const selectedOrdinal = selected ? entries.indexOf(selected) : -1;
  const optionId = (entry: OpenTabSearchEntry) => `${listId}-${entries.indexOf(entry)}`;
  useLayoutEffect(() => { alive.current = true; ended.current = false; return () => { alive.current = false; ended.current = true; }; }, []);
  useLayoutEffect(() => { committed.current = ticket; return () => { if (committed.current === ticket) committed.current = null; }; });
  // 子Modal的passive焦点初始化结束后，才明确聚焦本窗口当前搜索框。
  useEffect(() => { if (current()) input.current?.focus(); }, []);
  /** 每次tabs引用变化都记一代，A→B→A不能因selector最终返回原引用而跳过失效显示。 */
  useLayoutEffect(() => {
    let previous = useWorkspace.getState().settings.tabs;
    return useWorkspace.subscribe(state => { const next = state.settings.tabs; if (next !== previous) { previous = next; if (alive.current) setTabRevision(value => value + 1); } });
  }, []);
  useLayoutEffect(() => { list.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' }); }, [selected?.token, selectedOrdinal, query]);
  /** 逐级核可见性，只有当前最上层dialog可接收按键或鼠标；不依赖布局几何。 */
  function surface(): boolean {
    const node = host.current; if (!node || !document.body.contains(node)) return false;
    let own: HTMLElement | null = null;
    for (let current: HTMLElement | null = node; current && current.nodeType === 1; current = current.parentNode as HTMLElement | null) {
      if (current.hidden || current.getAttribute('hidden') !== null || current.getAttribute('aria-hidden') === 'true' || current.style.display === 'none' || current.style.visibility === 'hidden') return false;
      if (!own && current.getAttribute('role') === 'dialog') own = current;
    }
    const dialogs = document.querySelectorAll('[role="dialog"], [role="alertdialog"]'); return !!own && dialogs[dialogs.length - 1] === own;
  }
  function current(): boolean { return alive.current && !ended.current && committed.current === ticket && interaction === epoch.current && surface(); }
  /** 初次打开或明确重新搜索时领一个具体token，后续列表变化绝不自动换领同名或邻项。 */
  function initialSelection(value: string): object | null {
    try { const state = useWorkspace.getState(), matches = filterOpenTabs(registry.snapshot(state.settings.tabs, state.connections), value); return (matches.find(entry => entry.id === state.settings.activeTabId) ?? matches[0])?.token ?? null; }
    catch { return null; }
  }
  /** 标签ID可能与原型属性同名，只有自有布尔数据旗标才能参与dirty判断。 */
  function flag(flags: Record<string, boolean>, id: string): boolean | undefined { const descriptor = Object.getOwnPropertyDescriptor(flags, id); return descriptor && 'value' in descriptor && typeof descriptor.value === 'boolean' ? descriptor.value : undefined; }
  /** 输入或移动先同步废弃旧回调，React提交之前的旧DOM也不能切换目标。 */
  function advance(): void { epoch.current++; setInteraction(epoch.current); }
  function close(): void { if (!current() || composing.current) return; ended.current = true; onClose(); }
  /** 点击和Enter共用准确令牌复核，Root还会在正式激活入口再次核验。 */
  function activate(entry: OpenTabSearchEntry): void {
    if (!current() || !filtered.includes(entry)) return;
    const state = useWorkspace.getState();
    if (!registry.resolveActivation(entry, state.settings.tabs, state.connections)) { advance(); setActivationError(text.stale); return; }
    setSelection(entry.token); ended.current = true;
    try { if (onActivate(entry) === false) { ended.current = false; advance(); setActivationError(text.stale); } }
    catch (reason) { ended.current = false; advance(); setActivationError(errorMessage(reason)); }
  }
  /** 仅搜索框的无修饰导航有效；输入法、disabled和重复Enter均不激活。 */
  function keydown(event: KeyboardEvent<HTMLDivElement>): void {
    if (!current() || event.target !== input.current || input.current.disabled || event.defaultPrevented) return;
    if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    if (event.key === 'Enter') { if (!event.repeat && selected) activate(selected); return; }
    if (!filtered.length) return;
    const at = selected ? filtered.indexOf(selected) : -1;
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? filtered.length - 1 : at < 0 ? (event.key === 'ArrowDown' ? 0 : filtered.length - 1) : event.key === 'ArrowDown' ? (at + 1) % filtered.length : (at - 1 + filtered.length) % filtered.length;
    advance(); setSelection(filtered[next].token); setActivationError('');
  }
  return <Modal title={text.title} onClose={close}><div ref={host} className="open-tab-search" onKeyDown={keydown}>
    <input ref={input} className="open-tab-search-input" type="text" role="combobox" aria-label={text.searchLabel} placeholder={text.placeholder} value={query} aria-expanded="true" aria-controls={listId} aria-activedescendant={selected ? optionId(selected) : undefined} aria-autocomplete="list"
      onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
      onChange={event => { if (!current()) return; const value = event.target.value; advance(); setQuery(value); setSelection(initialSelection(value)); setActivationError(''); }}/>
    <p role="status">{text.count(filtered.length, entries.length)}</p><ErrorBox message={error || activationError || (selectionMissing ? text.stale : '')}/>
    <div ref={list} id={listId} role="listbox" aria-label={text.title} className="open-tab-search-list">{filtered.map(entry => <button key={entry.id} id={optionId(entry)} type="button" role="option" tabIndex={-1} aria-selected={entry === selected} className="open-tab-search-option" onMouseDown={event => event.preventDefault()} onClick={() => activate(entry)}>
      <span className="open-tab-search-heading"><strong>{entry.title}</strong>{entry.id === activeId && <span>{text.current}</span>}{(flag(dirty, entry.id) || fileChanges.has(entry.id)) && <span>{text.unsaved}</span>}</span>
      <span className="open-tab-search-meta"><span>{entry.kindCaption}</span><span>{entry.connectionCaption}</span><span>{entry.databaseCaption}</span>{entry.table && <span>{entry.table}</span>}</span>
    </button>)}</div>{!error && !filtered.length && <p>{entries.length ? text.noMatches : text.empty}</p>}
    <footer className="open-tab-search-footer"><span className="muted small">{text.help}</span><button onClick={close}>{text.close}</button></footer>
  </div></Modal>;
}
