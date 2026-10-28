import { queryParameterLimits, validateQueryParameters, type QueryParameter, type QueryParameterNames } from '../shared/queryParameters';

/** 父级同步读取真实来源；rangeIdentity须包含全篇标识或选区起止基址，不含active/busy/modal。 */
export interface QueryParameterReuseScope {
  tabId: string; connectionId: string; connectionVersion: number; sessionId: string | null;
  editorIdentity: object; modelIdentity: object; modelVersion: number;
  source: string; rangeIdentity: string;
  savedSourceIdentity: object | null; fileSourceIdentity: object | null; defaultDatabaseIdentity: object | null;
}
/** token本身不携带正文或值；只能交还创建它的缓存使用。 */
export interface QueryParameterReuseLease { readonly identity: object; }
type Metadata = Omit<QueryParameterNames, 'warnings'>;
const scopeKeys = ['tabId', 'connectionId', 'connectionVersion', 'sessionId', 'editorIdentity', 'modelIdentity', 'modelVersion', 'source', 'rangeIdentity', 'savedSourceIdentity', 'fileSourceIdentity', 'defaultDatabaseIdentity'] as const;

/** 只读自有可枚举数据描述符，不执行访问器，不接受symbol或隐蔽扩展字段。 */
function data(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw Error('参数暂存输入无效');
  const own = Reflect.ownKeys(value);
  if (own.some(key => typeof key !== 'string' || !keys.includes(key))) throw Error('参数暂存输入无效');
  const result: Record<string, unknown> = Object.create(null);
  for (const key of own as string[]) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) throw Error('参数暂存输入无效');
    result[key] = descriptor.value;
  }
  return result;
}
/** 数组仅允许length及完整连续索引；先核预算再读取，拒绝稀疏和额外键。 */
function array(value: unknown, limit: number): unknown[] {
  if (!Array.isArray(value)) throw Error('参数暂存输入无效');
  const length = Object.getOwnPropertyDescriptor(value, 'length');
  if (!length || !('value' in length) || !Number.isInteger(length.value) || length.value < 0 || length.value > limit || Reflect.ownKeys(value).length !== length.value + 1) throw Error('参数暂存输入无效');
  const result: unknown[] = [];
  for (let index = 0; index < length.value; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) throw Error('参数暂存输入无效');
    result.push(descriptor.value);
  }
  return result;
}
/** 来源只保留准确字段与不透明身份；模型、范围或会话缺项都不能建立租约。 */
function snapshotScope(raw: unknown): QueryParameterReuseScope {
  const value = data(raw, scopeKeys);
  if (scopeKeys.some(key => !Object.hasOwn(value, key))) throw Error('参数暂存来源无效');
  for (const key of ['tabId', 'connectionId', 'source', 'rangeIdentity']) if (typeof value[key] !== 'string') throw Error('参数暂存来源无效');
  if (!value.tabId || !value.connectionId || !value.rangeIdentity || typeof value.sessionId !== 'string' && value.sessionId !== null) throw Error('参数暂存来源无效');
  for (const key of ['connectionVersion', 'modelVersion']) if (!Number.isSafeInteger(value[key]) || Number(value[key]) < 0) throw Error('参数暂存来源无效');
  for (const key of ['editorIdentity', 'modelIdentity']) if (!value[key] || typeof value[key] !== 'object') throw Error('参数暂存来源无效');
  for (const key of ['savedSourceIdentity', 'fileSourceIdentity', 'defaultDatabaseIdentity']) if (value[key] !== null && (!value[key] || typeof value[key] !== 'object')) throw Error('参数暂存来源无效');
  return value as unknown as QueryParameterReuseScope;
}
/** 当前词法和服务端类型能力必须重新确认；诊断文案不进入暂存副本。 */
function metadata(raw: unknown): Metadata {
  const value = data(raw, ['names', 'warnings', 'noBackslashEscapes', 'ansiQuotes', 'ansiQuotesKnown', 'noBackslashEscapesKnown', 'maxDecimalScale', 'allowTimeEndpointFraction']);
  const names = array(value.names, queryParameterLimits.names);
  if (names.some(name => typeof name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(name)) || new Set(names).size !== names.length) throw Error('参数暂存元数据无效');
  for (const key of ['noBackslashEscapes', 'ansiQuotes', 'allowTimeEndpointFraction']) if (typeof value[key] !== 'boolean') throw Error('参数暂存元数据无效');
  for (const key of ['ansiQuotesKnown', 'noBackslashEscapesKnown']) if (value[key] !== undefined && typeof value[key] !== 'boolean') throw Error('参数暂存元数据无效');
  if (value.maxDecimalScale !== 30 && value.maxDecimalScale !== 38) throw Error('参数暂存元数据无效');
  // warnings只显示在原参数表单，不缓存；即使不匹配文案也不接受访问器或稀疏结构。
  if (array(value.warnings, queryParameterLimits.names).some(warning => typeof warning !== 'string')) throw Error('参数暂存元数据无效');
  return { names: names as string[], noBackslashEscapes: value.noBackslashEscapes as boolean, ansiQuotes: value.ansiQuotes as boolean, ...(value.ansiQuotesKnown === undefined ? {} : { ansiQuotesKnown: value.ansiQuotesKnown as boolean }), ...(value.noBackslashEscapesKnown === undefined ? {} : { noBackslashEscapesKnown: value.noBackslashEscapesKnown as boolean }), maxDecimalScale: value.maxDecimalScale, allowTimeEndpointFraction: value.allowTimeEndpointFraction as boolean };
}
/** 完整保留识别项及动态手动项，再沿真实九类型和总预算准入，不强转原值。 */
function parameters(raw: unknown, info: Metadata): QueryParameter[] {
  const result = array(raw, queryParameterLimits.names).map(item => {
    const value = data(item, ['name', 'type', 'value']);
    if (typeof value.name !== 'string' || typeof value.type !== 'string' || Object.hasOwn(value, 'value') && value.value !== undefined && typeof value.value !== 'string') throw Error('参数暂存输入无效');
    return { name: value.name, type: value.type, ...(Object.hasOwn(value, 'value') ? { value: value.value } : {}) } as QueryParameter;
  });
  // 动态脚本允许手工补充未识别名称；保留整组原顺序，仍须覆盖全部已识别名称。
  validateQueryParameters(result, info.maxDecimalScale, info.allowTimeEndpointFraction);
  const supplied = new Set(result.map(parameter => parameter.name));
  if (info.names.some(name => !supplied.has(name))) throw Error('参数暂存元数据不匹配');
  return result;
}

/** 单标签一组RAM值；显式read只回副本，不是执行授权，也不自动识别名称或发IPC。 */
export class QueryParameterReuseCache {
  private scope: QueryParameterReuseScope | null = null;
  private lease: QueryParameterReuseLease | null = null;
  private optIn = false;
  private entry: { info: Metadata; parameters: QueryParameter[] } | null = null;
  private disposed = false;
  private readonly listeners = new Set<() => void>();
  constructor(private reader: (() => QueryParameterReuseScope | null) | null) {}
  /** 通知仅表示可用性可能变化；观察者不能借异常破坏清理或将值写日志。 */
  private notify(): void { for (const listener of [...this.listeners]) { try { listener(); } catch { /* UI订阅错误不能阻断敏感引用清理。 */ } } }
  subscribe(listener: () => void): () => void { if (this.disposed) return () => undefined; this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  /** 父级来源变动时同步调用；失效后恢复旧值会产生新代次，旧token永不复活。 */
  observe(): boolean {
    if (this.disposed) return false;
    let next: QueryParameterReuseScope | null;
    try { const raw = this.reader?.(); next = raw == null ? null : snapshotScope(raw); } catch { next = null; }
    if (next && this.scope && scopeKeys.every(key => next![key] === this.scope![key])) return true;
    const hadState = !!this.scope || !!this.lease || !!this.entry;
    this.scope = next; this.lease = null; this.optIn = false; this.entry = null;
    if (hadState) this.notify();
    return next !== null;
  }
  /** 每次重新打开表单都发新token；默认不勾选，但可显式取上一组已暂存值。 */
  begin(): QueryParameterReuseLease | null {
    if (!this.observe() || this.disposed || !this.scope) return null;
    this.lease = Object.freeze({ identity: Object.freeze({}) }); this.optIn = false; return this.lease;
  }
  private current(lease: QueryParameterReuseLease): boolean { return this.observe() && this.lease === lease; }
  /** checkbox每次真实切换替换token；取消勾选立即丢弃值，封住true/false/true的旧事件。 */
  setOptIn(lease: QueryParameterReuseLease, optIn: boolean): QueryParameterReuseLease | null {
    if (!this.current(lease) || typeof optIn !== 'boolean') return null;
    if (this.optIn === optIn) return lease;
    this.optIn = optIn; const next = Object.freeze({ identity: Object.freeze({}) }); this.lease = next;
    if (!optIn) this.entry = null;
    this.notify(); return this.lease === next ? next : null;
  }
  /** 只有当前用户显式同意的表单可覆盖；校验失败不保留旧值，不回显来源或参数原文。 */
  remember(lease: QueryParameterReuseLease, info: QueryParameterNames, params: readonly QueryParameter[]): boolean {
    if (!this.current(lease) || !this.optIn) return false;
    try {
      const checked = metadata(info), copied = parameters(params, checked);
      if (!this.current(lease) || !this.optIn) return false;
      const entry = { info: checked, parameters: copied }; this.entry = entry; this.notify();
      // 订阅可同步忘记、卸载或切换来源；只有原entry及原用户同意仍有效才报告成功。
      return this.current(lease) && this.optIn && this.entry === entry;
    } catch { this.entry = null; this.notify(); return false; }
  }
  /** 调用前父级必须重新loadNames；仅准确词法、名称顺序和服务器能力相同才可读取。 */
  read(lease: QueryParameterReuseLease, info: QueryParameterNames): QueryParameter[] | null {
    if (!this.current(lease) || !this.entry) return null;
    try {
      const checked = metadata(info);
      if (JSON.stringify(checked) !== JSON.stringify(this.entry.info)) { this.forget(); return null; }
      const result = parameters(this.entry.parameters, checked);
      return this.current(lease) ? result : null;
    } catch { this.forget(); return null; }
  }
  has(lease: QueryParameterReuseLease, info: QueryParameterNames): boolean { return this.read(lease, info) !== null; }
  /** 显式忘记也撤销当前token；后续使用须重新begin，旧回调不能偷偷重新写入。 */
  forget(): void { this.scope = null; this.lease = null; this.optIn = false; this.entry = null; this.notify(); }
  /** 卸载后释放reader、来源identity、正文、值和订阅，任何旧token均无效。 */
  dispose(): void { if (this.disposed) return; this.disposed = true; this.reader = null; this.scope = null; this.lease = null; this.optIn = false; this.entry = null; this.notify(); this.listeners.clear(); }
}
