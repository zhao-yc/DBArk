import { randomUUID } from 'node:crypto';
import type { ColumnsInvocation } from './columnsMainCapabilities';
import type { QueryResultPresetSelect, QueryResultPresetSnapshot, QueryResultPresetStoredSnapshot, QueryResultPresetTarget } from '../shared/queryResultPresets';

/** 命名整理只授权本地配置读写；不签发SQL、数据库元数据或文件能力。 */
export class QueryResultPresetSources {
  private readonly tokens = new Map<string, { owner: ColumnsInvocation; connectionId: string; source: string; expires: number }>();
  private last = -Infinity;
  /** 单调期限只在当前Main生命周期有效，系统墙钟调整不能复活旧文档令牌。 */
  constructor(private readonly owner: { assert(value?: ColumnsInvocation): void; same(left: ColumnsInvocation, right: ColumnsInvocation): boolean }, private readonly clock = () => performance.now()) {}
  /** 时钟回退或非有限读数立即撤销旧令牌，不补签或延长原期限。 */
  private now(): number {
    const now = this.clock();
    if (!Number.isFinite(now) || now < this.last) { this.invalidate(); throw Error('方案来源期限已失效，请刷新方案'); }
    this.last = now; return now;
  }
  /** 每次真实list或成功变更签发新令牌；同一窗口的旧导航不能按相同URL重领。 */
  issue(invocation: ColumnsInvocation | undefined, target: QueryResultPresetTarget, snapshot: QueryResultPresetStoredSnapshot): QueryResultPresetSnapshot {
    this.owner.assert(invocation); if (!invocation) throw Error('缺少方案请求来源');
    const now = this.now();
    for (const [key, value] of this.tokens) if (value.expires <= now) this.tokens.delete(key);
    if (this.tokens.size >= 256) this.tokens.delete(this.tokens.keys().next().value!);
    const token = randomUUID();
    this.tokens.set(token, { owner: invocation, connectionId: target.connectionId, source: JSON.stringify(snapshot.source), expires: now + 600000 });
    return { ...snapshot, bindingToken: token };
  }
  /** 连接内容与真实主文档双绑定；方案修订的CAS另由LocalStore完整检查。 */
  assert(invocation: ColumnsInvocation | undefined, input: Pick<QueryResultPresetSelect, 'bindingToken' | 'connectionId' | 'source'>): void {
    this.owner.assert(invocation); if (!invocation) throw Error('缺少方案请求来源');
    const now = this.now(), bound = this.tokens.get(input.bindingToken);
    if (!bound || bound.expires <= now || bound.connectionId !== input.connectionId || bound.source !== JSON.stringify(input.source) || !this.owner.same(bound.owner, invocation)) throw Error('方案请求来源、文档或连接已变化，请刷新方案');
  }
  /** 导航、崩溃、关闭撤销本代全部令牌；旧回包不能恢复它们。 */
  invalidate(): void { this.tokens.clear(); }
}
