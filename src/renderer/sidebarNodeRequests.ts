export type SidebarNodeRequestKind = 'load' | 'disconnect' | 'remove';
export interface SidebarNodeRequest { readonly kind: SidebarNodeRequestKind; readonly generation: number }

/** 节点同步命令门：一次只接受一个加载，折叠或销毁后旧响应不能恢复展开意图。 */
export class SidebarNodeRequests {
  private active = true;
  private generation = 0;
  private pending: SidebarNodeRequest | undefined;
  private readonly revision: number;

  /** 绑定创建节点时的连接修订；旧渲染处理器也不能借新修订开始请求。 */
  constructor(private readonly currentRevision: () => number) { this.revision = currentRevision(); }
  get kind(): SidebarNodeRequestKind | undefined { return this.pending?.kind; }

  /** 结构刷新可明确接管目录加载；普通加载仍去重，任何加载均不能越过结束操作。 */
  begin(kind: SidebarNodeRequestKind, replaceLoad = false): SidebarNodeRequest | undefined {
    if (!this.active || this.currentRevision() !== this.revision || (this.pending && (this.pending.kind !== 'load' || kind === 'load' && !replaceLoad))) return;
    return this.pending = { kind, generation: ++this.generation };
  }
  /** 每个异步落点都同时核对节点生存期、连接修订和精确请求身份。 */
  current(request: SidebarNodeRequest): boolean { return this.active && this.currentRevision() === this.revision && this.pending === request; }
  /** 只有当前请求有权释放忙碌；迟到的finally不能释放后来请求。 */
  finish(request: SidebarNodeRequest): boolean { if (!this.current(request)) return false; this.pending = undefined; return true; }
  /** 明确折叠仅撤销加载；不能把仍在执行的断开/删除伪装成已完成。 */
  collapse(): boolean {
    if (!this.active || this.currentRevision() !== this.revision || (this.pending && this.pending.kind !== 'load')) return false;
    this.pending = undefined; this.generation++; return true;
  }
  /** React严格模式的重新挂载仍保留已撤销代次，不恢复旧请求。 */
  activate(): void { this.active = true; }
  /** 卸载只撤销前端结果所有权，不关闭可能已被新节点复用的共享连接。 */
  dispose(): void { this.active = false; this.pending = undefined; this.generation++; }
}

interface ConnectionEnd { readonly done: Promise<void>; release(): void }
const connectionEnds = new Map<string, ConnectionEnd>();

/** 跨节点保留显式断开/删除的结束屏障；旧节点卸载不能放行尚未结束的后端动作。 */
export function beginSidebarConnectionEnd(connectionId: string): ConnectionEnd | undefined {
  if (connectionEnds.has(connectionId)) return;
  let finish!: () => void;
  const entry: ConnectionEnd = { done: new Promise(resolve => { finish = resolve; }), release() { if (connectionEnds.get(connectionId) !== entry) return; connectionEnds.delete(connectionId); finish(); } };
  connectionEnds.set(connectionId, entry); return entry;
}
/** 新加载只等待实际在途的显式结束操作，不触发重放、自动断开或后台重连。 */
export function sidebarConnectionEnd(connectionId: string): Promise<void> | undefined { return connectionEnds.get(connectionId)?.done; }
