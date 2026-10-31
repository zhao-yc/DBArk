import type { ConnectionStatus } from '../shared/contracts';

export type CompletionServerFactsValue = Readonly<Pick<ConnectionStatus, 'dialect' | 'version'>>;
export interface CompletionServerFactsTicket { readonly connectionId: string; readonly revision: number }
interface Entry { readonly ticket: CompletionServerFactsTicket; facts?: CompletionServerFactsValue }

const maximumEntries = 256, maximumVersionUnits = 256, maximumConnectionIdUnits = 200;
/** 修订沿用连接配置代次，不能用NaN、小数或不安全整数充当同一目标的身份。 */
function validRevision(revision: number): boolean { return Number.isSafeInteger(revision) && revision >= 0; }
/** 逻辑连接ID沿用公开命令的200代码单元边界，不按物理线程号或显示名称寻址。 */
function validConnectionId(connectionId: string): boolean { return typeof connectionId === 'string' && connectionId.length > 0 && connectionId.length <= maximumConnectionIdUnits; }

/** 仅保存已完成建连的方言和版本事实；本类不拥有IPC、SQL、认证、计时器或持久化入口。 */
export class CompletionServerFacts {
  readonly #capacity: number;
  readonly #entries = new Map<string, Entry>();

  /** pending与已完成事实共同占用LRU预算；容量0可明确禁用，不能放宽256项硬上限。 */
  constructor(capacity = maximumEntries) {
    if (!Number.isSafeInteger(capacity) || capacity < 0 || capacity > maximumEntries) throw new RangeError('服务器能力事实缓存容量必须是0至256的整数。');
    this.#capacity = capacity;
  }

  /** 每次begin都替换同ID旧状态；即使修订非法也不让旧ticket在新尝试后重新生效。 */
  begin(connectionId: string, revision: number): CompletionServerFactsTicket {
    const ticket = Object.freeze({ connectionId, revision });
    if (!validConnectionId(connectionId)) return ticket;
    this.#entries.delete(connectionId);
    if (!validRevision(revision) || !this.#capacity) return ticket;
    this.#entries.set(connectionId, { ticket });
    if (this.#entries.size > this.#capacity) this.#entries.delete(this.#entries.keys().next().value!);
    return ticket;
  }

  /** 成功只接受仍pending的同一ticket；状态对象仅摘取两个原始字段并冻结副本。 */
  complete(ticket: CompletionServerFactsTicket, status: ConnectionStatus): boolean {
    const entry = this.#current(ticket);
    if (!entry || entry.facts) return false;
    let facts: CompletionServerFactsValue | undefined;
    try {
      const dialect = status?.dialect, version = status?.version;
      if ((dialect === 'mysql' || dialect === 'mariadb' || dialect === 'sqlite') && typeof version === 'string' && version.length > 0 && version.length <= maximumVersionUnits && version.trim().length > 0) facts = Object.freeze({ dialect, version });
    } catch { /* 非法字段读取与非法返回值同样不产生事实；不读取其它配置或认证字段。 */ }
    // 字段读取也可能触发调用方代码；提交前重核身份，不能让清除或替换后的旧结果复活。
    if (this.#current(ticket) !== entry || entry.facts) return false;
    if (!facts) { this.#entries.delete(ticket.connectionId); return false; }
    entry.facts = facts;
    this.#touch(ticket.connectionId, entry);
    return true;
  }

  /** 只结束当前pending；后续目录权限错误或迟到失败不能否认已经取得的服务器事实。 */
  fail(ticket: CompletionServerFactsTicket): void {
    const entry = this.#current(ticket);
    if (entry && !entry.facts) this.#entries.delete(ticket.connectionId);
  }

  /** 由连接修改、断开或删除调用；移除条目即撤销ticket，迟到回调无法自行重建。 */
  clear(connectionId: string): void { this.#entries.delete(connectionId); }

  /** 只读精确修订命中的已完成事实；未命中和pending读取均不延长LRU寿命。 */
  get(connectionId: string, revision: number): CompletionServerFactsValue | undefined {
    if (!validConnectionId(connectionId) || !validRevision(revision)) return undefined;
    const entry = this.#entries.get(connectionId);
    if (!entry?.facts || entry.ticket.revision !== revision) return undefined;
    this.#touch(connectionId, entry);
    return entry.facts;
  }

  /** 对象身份同时区分相同修订的重试、跨实例ticket、clear后重建及LRU淘汰。 */
  #current(ticket: CompletionServerFactsTicket): Entry | undefined {
    if (!ticket || typeof ticket !== 'object') return undefined;
    const entry = this.#entries.get(ticket.connectionId);
    return entry?.ticket === ticket ? entry : undefined;
  }

  /** 只有有效写入和已完成事实命中才刷新访问顺序，旧回调不改变其它连接的淘汰顺序。 */
  #touch(connectionId: string, entry: Entry): void {
    this.#entries.delete(connectionId);
    this.#entries.set(connectionId, entry);
  }
}

/** 渲染进程共享的内存实例，接线仍由已有建连和连接生命周期负责。 */
export const completionServerFacts = new CompletionServerFacts();
