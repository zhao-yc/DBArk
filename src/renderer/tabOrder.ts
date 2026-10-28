import type { AppSettings } from '../shared/contracts';

type Tab = AppSettings['tabs'][number];
export interface TabOrderRef { readonly id: string; readonly token: object; }
export type TabOrderMove = { kind: 'relative'; target: TabOrderRef; placement: 'before' | 'after' } | { kind: 'direction'; direction: 'left' | 'right' | 'first' | 'last' };
interface Record { readonly tab: Tab; readonly token: object; readonly scope: string; }
interface Continuation { readonly previous: Tab; readonly token: object; readonly scope: string; }
export const tabOrderLimits = { tabs: 100, idUnits: 200, nameUnits: 256 } as const;
const invalid = (): never => { throw Error('工作台标签身份或数量无效，未重排；请刷新工作区后重试。'); };

/** 只读取有界身份数据属性；SQL、标题、来源摘要/修订及自定义迭代器均不读取或复制。 */
function own(value: object, key: string, optional = false): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor) return optional ? undefined : invalid();
  if (!descriptor.enumerable || !('value' in descriptor)) return invalid();
  return descriptor.value;
}
function object(value: unknown): object { if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return invalid(); return value; }
function text(value: unknown, maximum: number, optional = false, empty = false): string | undefined {
  if (value === undefined && optional) return;
  if (typeof value !== 'string' || value.length > maximum || (!empty && !value.length) || /\0|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) return invalid();
  return value;
}
function sourceId(tab: object, key: string): string | undefined { const source = own(tab, key, true); return source === undefined ? undefined : text(own(object(source), 'id'), tabOrderLimits.idUnits); }

/** 显式无库/未知与遗留库保持不同身份；不取连接配置的默认库推断目标。 */
function identity(value: unknown): { id: string; scope: string; tab: Tab } {
  const tab = object(value), id = text(own(tab, 'id'), tabOrderLimits.idUnits)!, kind = own(tab, 'kind');
  if (kind !== 'query' && kind !== 'table') return invalid();
  const connectionId = text(own(tab, 'connectionId'), tabOrderLimits.idUnits)!, database = text(own(tab, 'database', true), tabOrderLimits.nameUnits, kind === 'query', kind === 'query');
  let context: unknown = null;
  if (kind === 'query') {
    const raw = own(tab, 'databaseContext', true);
    if (raw !== undefined) {
      const value = object(raw), state = own(value, 'state');
      if (state === 'unknown' && Reflect.ownKeys(value).length === 1) context = ['unknown'];
      else if (state === 'known' && Reflect.ownKeys(value).length === 2) { const name = own(value, 'database'); context = ['known', name === null ? null : text(name, tabOrderLimits.nameUnits)]; }
      else return invalid();
    }
  }
  const table = kind === 'table' ? text(own(tab, 'table'), tabOrderLimits.nameUnits) : undefined;
  return { id, tab: tab as Tab, scope: JSON.stringify([id, kind, connectionId, database, context, table, sourceId(tab, 'sourceBinding'), sourceId(tab, 'fileSourceBinding')]) };
}
function tabsOf(tabs: readonly Tab[]): Tab[] {
  if (!Array.isArray(tabs) || Object.getPrototypeOf(tabs) !== Array.prototype) return invalid();
  const count = Object.getOwnPropertyDescriptor(tabs, 'length')?.value;
  if (!Number.isSafeInteger(count) || count < 0 || count > tabOrderLimits.tabs) return invalid();
  const result: Tab[] = [];
  for (let index = 0; index < count; index++) result.push(own(tabs, String(index)) as Tab);
  return result;
}
function reference(ref: TabOrderRef): { id: string; token: object } {
  const value = object(ref), id = text(own(value, 'id'), tabOrderLimits.idUnits)!, token = own(value, 'token');
  if (!token || typeof token !== 'object' || Reflect.ownKeys(value).length !== 2) return invalid();
  return { id, token };
}

/** 一个活标签对应不可复活的内存令牌；只有正式updateTab可显式继承同文档身份。 */
export class TabOrderRegistry {
  private records = new Map<string, Record>();
  private continuations = new WeakMap<Tab, Continuation>();

  /** 每次真实store通知都观察，删除/换绑/坏状态即永久撤销旧ref，包括同对象重加。 */
  observe(tabs: readonly Tab[]): void {
    try {
      const next = new Map<string, Record>();
      for (const item of tabsOf(tabs)) {
        const value = identity(item); if (next.has(value.id)) return invalid();
        const previous = this.records.get(value.id), continued = this.continuations.get(value.tab); this.continuations.delete(value.tab);
        const same = previous?.scope === value.scope && (previous.tab === value.tab || continued?.previous === previous.tab && continued.token === previous.token && continued.scope === value.scope);
        next.set(value.id, { tab: value.tab, scope: value.scope, token: same ? previous!.token : Object.freeze(Object.create(null) as object) });
      }
      this.records = next;
    } catch (reason) { this.reset(); throw reason; }
  }

  /** 只登记一次准确previous→next；提交失败也撤销许可，普通泛设置替换没有此权限。 */
  continueUpdate(previous: Tab, next: Tab): () => void {
    const before = identity(previous), after = identity(next), current = this.records.get(before.id);
    if (!current || current.tab !== previous || before.id !== after.id || current.scope !== before.scope || before.scope !== after.scope) return () => {};
    const permission = { previous, token: current.token, scope: current.scope }; this.continuations.set(next, permission);
    return () => { if (this.continuations.get(next) === permission) this.continuations.delete(next); };
  }

  /** 只发布id/令牌，不持有旧正文；顺序沿当前strip，不引入MRU或持久化字段。 */
  snapshot(tabs: readonly Tab[]): readonly TabOrderRef[] { this.observe(tabs); return Object.freeze([...this.records].map(([id, value]) => Object.freeze({ id, token: value.token }))); }

  /** 每次提交重核当前原对象；相同id/SQL/标题不能替代旧token。 */
  resolve(ref: TabOrderRef, tabs: readonly Tab[]): Tab | undefined {
    try { this.observe(tabs); const value = reference(ref), current = this.records.get(value.id); return current?.token === value.token ? current.tab : undefined; }
    catch { return; }
  }

  /** 仅移动最新数组中的原对象；相对目标和来源均须准确，边界/同位/失效不产生新数组。 */
  move(ref: TabOrderRef, move: TabOrderMove, tabs: readonly Tab[]): Tab[] | undefined {
    try {
      this.observe(tabs); const original = reference(ref), record = this.records.get(original.id);
      if (!record || record.token !== original.token) return;
      const value = object(move), kind = own(value, 'kind'), current = tabsOf(tabs), from = current.indexOf(record.tab); if (from < 0) return;
      let to: number;
      if (kind === 'direction' && Reflect.ownKeys(value).length === 2) {
        const direction = own(value, 'direction');
        if (direction === 'left') to = Math.max(0, from - 1); else if (direction === 'right') to = Math.min(current.length - 1, from + 1); else if (direction === 'first') to = 0; else if (direction === 'last') to = current.length - 1; else return;
      } else if (kind === 'relative' && Reflect.ownKeys(value).length === 3) {
        const target = reference(own(value, 'target') as TabOrderRef), destination = this.records.get(target.id), placement = own(value, 'placement');
        if (!destination || destination.token !== target.token || destination.tab === record.tab || placement !== 'before' && placement !== 'after') return;
        const rest = current.filter(tab => tab !== record.tab); to = rest.indexOf(destination.tab); if (to < 0) return; if (placement === 'after') to++;
      } else return;
      if (to === from) return;
      current.splice(from, 1); current.splice(to, 0, record.tab); return current;
    } catch { return; }
  }

  /** 工作区恢复或坏组状态更换整个内存代次，不能复用旧ref或未消费的继承许可。 */
  reset(): void { this.records.clear(); this.continuations = new WeakMap(); }
}
