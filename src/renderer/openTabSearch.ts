import type { AppSettings, ConnectionProfile } from '../shared/contracts';
import type { SavedQueryOriginContext } from '../shared/queryBinding';
import { queryContextZh } from './locales/queryContext.zh-CN';
import { zh } from './locales/zh-CN';
import { objectCategories, type ObjectCategory } from '../shared/objectBrowser';

export const openTabSearchLimits = { tabs: 100, connections: 10000, textUnits: 256, idUnits: 200, queryUnits: 1024, queryTokens: 64, searchUnits: 4096 } as const;
export const openTabSearchMessages = {
  invalid: '已打开标签的本地元数据无效，请关闭查找窗口后重试。',
  budget: '已打开标签数量或搜索内容超过预算，未返回部分列表。',
  query: 'SQL 查询', table: '数据表', objects: '对象浏览', legacyMissing: '旧记录的初始库（未记录）',
  categories: { table: '表', view: '视图', routine: '存储过程／函数', trigger: '触发器', event: '事件' },
} as const;
export type OpenTabSearchTab = AppSettings['tabs'][number];
export interface OpenTabSearchEntry {
  readonly id: string; readonly token: object; readonly title: string; readonly kind: 'query' | 'table' | 'objects';
  readonly kindCaption: string; readonly connectionId: string; readonly connectionCaption: string;
  readonly databaseContext: Readonly<SavedQueryOriginContext>; readonly databaseCaption: string;
  readonly table?: string; readonly objectCategory?: ObjectCategory; readonly searchText: string;
}
interface Projection { id: string; kind: 'query' | 'table' | 'objects'; title: string; connectionId: string; context: SavedQueryOriginContext; table?: string; objectCategory?: ObjectCategory; sourceId?: string; fileId?: string; }
interface Registration { token: object; scope: string; metadata: Projection; }
const invalid = (): never => { throw Error(openTabSearchMessages.invalid); };
const budget = (): never => { throw Error(openTabSearchMessages.budget); };

/** 只取指定自有数据字段；不枚举/复制tab或profile，因此SQL、结果及秘密getter均不会执行。 */
function own(value: object, key: string, optional = false): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor) return optional ? undefined : invalid();
  if (!descriptor.enumerable || !('value' in descriptor)) return invalid();
  return descriptor.value;
}
function object(value: unknown): object { if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return invalid(); return value; }
function text(value: unknown, maximum: number = openTabSearchLimits.textUnits, optional = false): string | undefined {
  if (value === undefined && optional) return undefined;
  if (typeof value !== 'string' || !value.length || value.includes('\0')) return invalid();
  if (value.length > maximum) return budget();
  for (let index = 0; index < value.length; index++) { const code = value.charCodeAt(index); if (code >= 0xd800 && code <= 0xdbff) { const next = value.charCodeAt(++index); if (!(next >= 0xdc00 && next <= 0xdfff)) return invalid(); } else if (code >= 0xdc00 && code <= 0xdfff) return invalid(); }
  return value;
}
/** 先核数量，再按自有索引逐个读取，不调用数组自定义迭代器。 */
function list(value: unknown, maximum: number): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return invalid();
  const count = Object.getOwnPropertyDescriptor(value, 'length')?.value;
  if (!Number.isSafeInteger(count) || count < 0) return invalid(); if (count > maximum) return budget();
  const result: unknown[] = []; for (let index = 0; index < count; index++) result.push(own(value, String(index))); return result;
}
/** 显式known-null/unknown优先；遗留库单独标注，绝不借profile默认库充当已知目标。 */
function context(tab: object, kind: Projection['kind']): SavedQueryOriginContext {
  const explicit = kind === 'query' ? own(tab, 'databaseContext', true) : undefined;
  if (explicit !== undefined) {
    const value = object(explicit), state = own(value, 'state');
    if (state === 'unknown') return { state: 'unknown' };
    if (state !== 'known') return invalid(); const database = own(value, 'database');
    return { state: 'known', database: database === null ? null : text(database)! };
  }
  const raw = own(tab, 'database', true), database = raw === '' ? '' : text(raw, openTabSearchLimits.textUnits, true);
  if (kind === 'objects') return database === undefined || database === '' ? invalid() : { state: 'known', database };
  return kind === 'table' && database !== undefined && database !== '' ? { state: 'known', database } : { state: 'legacy', ...(database === undefined ? {} : { database }) };
}
function bindingId(tab: object, key: string): string | undefined { const value = own(tab, key, true); return value === undefined ? undefined : text(own(object(value), 'id'), openTabSearchLimits.idUnits); }
/** 对象分类是对象页定位的一部分；分类变化让旧搜索条目失效，不读取任何查询来源。 */
function category(tab: object): ObjectCategory {
  const value = own(tab, 'objectCategory');
  return typeof value === 'string' && objectCategories.includes(value as ObjectCategory) ? value as ObjectCategory : invalid();
}
function project(value: unknown): Projection {
  const tab = object(value), kind = own(tab, 'kind'); if (kind !== 'query' && kind !== 'table' && kind !== 'objects') return invalid();
  return {
    id: text(own(tab, 'id'), openTabSearchLimits.idUnits)!, kind, title: text(own(tab, 'title'))!,
    connectionId: text(own(tab, 'connectionId'), openTabSearchLimits.idUnits)!, context: context(tab, kind),
    ...(kind === 'table' ? { table: text(own(tab, 'table', true), openTabSearchLimits.textUnits, true) } : kind === 'objects' ? { objectCategory: category(tab) } : { sourceId: bindingId(tab, 'sourceBinding'), fileId: bindingId(tab, 'fileSourceBinding') }),
  };
}
/** 签名仅由新建的有界元数据元组组成；标题/正文编辑及保存digest/revision不改变文档token。 */
function scope(value: Projection): string { return JSON.stringify([value.id, value.kind, value.connectionId, value.context.state, 'database' in value.context ? value.context.database : undefined, value.table, value.sourceId, value.fileId, value.objectCategory]); }
function captions(connections: readonly Pick<ConnectionProfile, 'id' | 'name'>[]): Map<string, string> {
  const result = new Map<string, string>();
  for (const item of list(connections, openTabSearchLimits.connections)) { const connection = object(item), id = text(own(connection, 'id'), openTabSearchLimits.idUnits)!; if (result.has(id)) return invalid(); result.set(id, text(own(connection, 'name'))!); }
  return result;
}
function databaseCaption(value: SavedQueryOriginContext): string { return value.state === 'unknown' ? queryContextZh.unknown : value.state === 'known' ? value.database ?? queryContextZh.none : !value.database ? openTabSearchMessages.legacyMissing : queryContextZh.legacy + '：' + value.database; }
function entry(value: Registration, connections: ReadonlyMap<string, string>): OpenTabSearchEntry {
  const metadata = value.metadata, connectionCaption = connections.get(metadata.connectionId) ?? zh.common.connectionDeleted, kindCaption = metadata.kind === 'query' ? openTabSearchMessages.query : metadata.kind === 'objects' ? `${openTabSearchMessages.objects} · ${openTabSearchMessages.categories[metadata.objectCategory!]}` : openTabSearchMessages.table, database = databaseCaption(metadata.context);
  const searchText = [metadata.title, connectionCaption, database, 'database' in metadata.context ? metadata.context.database ?? '' : '', metadata.table ?? '', kindCaption, metadata.kind, metadata.kind === 'query' ? 'sql 查询' : metadata.kind === 'objects' ? `objects 对象 ${metadata.objectCategory}` : 'table 表'].join('\n').toLowerCase();
  return Object.freeze({ id: metadata.id, token: value.token, title: metadata.title, kind: metadata.kind, kindCaption, connectionId: metadata.connectionId, connectionCaption, databaseContext: Object.freeze({ ...metadata.context }), databaseCaption: database, ...(metadata.table === undefined ? {} : { table: metadata.table }), ...(metadata.objectCategory === undefined ? {} : { objectCategory: metadata.objectCategory }), searchText });
}
/** 只比较显示/定位字段，不按同名标题或其它连接回退；entry不持有原tab或profile对象。 */
function sameEntry(left: OpenTabSearchEntry, right: OpenTabSearchEntry): boolean {
  return own(left, 'id') === right.id && own(left, 'token') === right.token && own(left, 'title') === right.title && own(left, 'kind') === right.kind && own(left, 'connectionId') === right.connectionId && own(left, 'connectionCaption') === right.connectionCaption && own(left, 'databaseCaption') === right.databaseCaption && own(left, 'table', true) === right.table && own(left, 'objectCategory', true) === right.objectCategory && own(left, 'searchText') === right.searchText;
}

/** 最多100个现有标签的本地身份注册；删除、换绑或异常状态后旧token永久失效。 */
export class OpenTabSearchRegistry {
  private records = new Map<string, Registration>();
  private connectionCaptions = new Map<string, string>();

  /** 订阅每次真实tabs更新可记录A→B→A；坏状态先撤销整组，再抛原错误，恢复也不复活旧条目。 */
  observe(tabs: readonly OpenTabSearchTab[]): void {
    try {
      const projected = list(tabs, openTabSearchLimits.tabs).map(project), next = new Map<string, Registration>();
      for (const metadata of projected) {
        if (next.has(metadata.id)) return invalid(); const key = scope(metadata), previous = this.records.get(metadata.id);
        next.set(metadata.id, { token: previous?.scope === key ? previous.token : Object.freeze(Object.create(null) as object), scope: key, metadata });
      }
      this.records = next;
    } catch (reason) { this.dispose(); throw reason; }
  }

  /** 按原strip顺序发布纯元数据；任一预算/格式错误拒绝整组，不能偷偷省略标签。 */
  snapshot(tabs: readonly OpenTabSearchTab[], connections: readonly Pick<ConnectionProfile, 'id' | 'name'>[]): OpenTabSearchEntry[] {
    try { this.observe(tabs); this.connectionCaptions = captions(connections); return [...this.records.values()].map(value => entry(value, this.connectionCaptions)); }
    catch (reason) { this.dispose(); throw reason; }
  }

  /** 点击时复核准确live目标和显示元数据；只返回原ID，不创建标签、建连或执行任何SQL。 */
  resolveActivation(selected: OpenTabSearchEntry, tabs: readonly OpenTabSearchTab[], connections?: readonly Pick<ConnectionProfile, 'id' | 'name'>[]): string | undefined {
    try {
      this.observe(tabs); if (connections !== undefined) this.connectionCaptions = captions(connections);
      const id = own(object(selected), 'id'); if (typeof id !== 'string') return undefined;
      const current = this.records.get(id); return current && sameEntry(selected, entry(current, this.connectionCaptions)) ? id : undefined;
    } catch { this.dispose(); return undefined; }
  }

  /** 结束当前租约；后续明确snapshot可建立全新token，适配StrictMode而不复活旧点击。 */
  dispose(): void { this.records.clear(); this.connectionCaptions.clear(); }
}

/** 标题/连接/库表/类型进行本地AND包含搜索；不修改strip顺序、不扫描SQL正文。 */
export function filterOpenTabs(entries: readonly OpenTabSearchEntry[], query: string): OpenTabSearchEntry[] {
  const checked = list(entries, openTabSearchLimits.tabs);
  if (typeof query !== 'string') return invalid(); if (query.length > openTabSearchLimits.queryUnits) return budget();
  const tokens = query.trim().toLowerCase().split(/\s+/u).filter(Boolean); if (tokens.length > openTabSearchLimits.queryTokens) return budget();
  return checked.filter(value => { const candidate = object(value), search = own(candidate, 'searchText'); if (typeof search !== 'string' || search.length > openTabSearchLimits.searchUnits) return invalid(); return tokens.every(token => search.includes(token)); }) as OpenTabSearchEntry[];
}
