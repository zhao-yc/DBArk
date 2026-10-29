import { uiCommandIds, type UiCommandId, type UiCommandInvocation, type UiMenuState } from '../shared/uiCommands';

export interface UiCommandHandler { enabled: boolean; checked?: boolean; run(): void | Promise<void>; }
export interface UiCommandScope { active: boolean; contextKey: string; isCurrent?(): boolean; handlers: Partial<Record<UiCommandId, UiCommandHandler>>; }
interface ScopeRecord { owner: object; value: UiCommandScope; signature: string; }
export interface UiCommandPageContext { tab: unknown; profile: unknown; version: number; generation: number; }

/** 连接外观更新也替换profile；同标签的新原连接对象必须重新发布命令可用性。 */
export function updateCommandPageContext(previous: UiCommandPageContext | undefined, tab: unknown, profile: unknown, version: number): UiCommandPageContext {
  if (previous && previous.tab === tab && previous.profile === profile && previous.version === version) return previous;
  return { tab, profile, version, generation: (previous?.generation ?? 0) + 1 };
}

/** 统一命令归属；原菜单代次不能在标签或连接来回切换后重新取得执行资格。 */
export class UiCommandRegistry {
  private scopes = new Map<string, ScopeRecord>();
  private listeners = new Set<() => void>();
  private blocked = true;
  private snapshot: UiMenuState = { revision: 0, commands: uiCommandIds.map(id => ({ id, enabled: false })) };

  /** 快照引用只在可用状态或上下文改变时替换，避免React订阅形成重复渲染。 */
  getSnapshot = (): UiMenuState => this.snapshot;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };

  /** 更新处理器引用但不因为每次render产生的新函数无意义地提升菜单代次。 */
  update(id: string, owner: object, value: UiCommandScope): void {
    const signature = JSON.stringify([value.active, value.contextKey, uiCommandIds.flatMap(key => {
      const handler = value.handlers[key]; return handler ? [[key, handler.enabled, handler.checked ?? null]] : [];
    })]);
    const previous = this.scopes.get(id);
    this.scopes.set(id, { owner, value, signature });
    if (!previous || previous.owner !== owner || previous.signature !== signature) this.invalidate();
  }

  /** 旧组件的清理不能删除相同scope名下后来注册的处理器。 */
  remove(id: string, owner: object): void {
    if (this.scopes.get(id)?.owner !== owner) return;
    this.scopes.delete(id); this.invalidate();
  }

  /** 模态出现又撤销也必须消费旧代次；调用方可显式强制失效。 */
  setBlocked(value: boolean, changed = false): void {
    if (this.blocked === value && !changed) return;
    this.blocked = value; this.invalidate();
  }

  /** 同一命令优先交给当前页面；不同页面scope的不同命令可以同时可用。 */
  private handler(id: UiCommandId): UiCommandHandler | undefined {
    let global: UiCommandHandler | undefined, page: UiCommandHandler | undefined;
    for (const [scopeId, { value }] of this.scopes) {
      if (!value.active || value.isCurrent?.() === false || !value.handlers[id]) continue;
      if (scopeId === 'app') global = value.handlers[id];
      else { if (page) return undefined; page = value.handlers[id]; }
    }
    return page ?? global;
  }

  /** 从原代次直接调用原处理器；不模拟点击，不从新树选择补造旧页面目标。 */
  async execute(event: UiCommandInvocation): Promise<boolean> {
    if (this.blocked || event.revision !== this.snapshot.revision || !uiCommandIds.includes(event.id)) return false;
    const handler = this.handler(event.id);
    if (!handler?.enabled) return false;
    this.invalidate();
    await handler.run(); return true;
  }

  /** 连接、目录或原生窗口上下文变化时，统一撤销已打开菜单的许可。 */
  invalidate(): void {
    this.snapshot = { revision: this.snapshot.revision + 1, commands: uiCommandIds.map(id => {
      const handler = this.handler(id);
      return { id, enabled: !this.blocked && !!handler?.enabled, ...(handler?.checked !== undefined ? { checked: handler.checked } : {}) };
    }) };
    for (const listener of this.listeners) listener();
  }
}
