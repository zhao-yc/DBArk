import type { BrowserWindow, IpcMainInvokeEvent, WebContents, WebFrameMain } from 'electron';

/** 兼容既有结构缓存；只有columns记录另附私有归属，不扩共享IPC。 */
interface StructureToken { purpose: string; connectionId: string; expires: number; kind: 'snapshot' | 'preview'; snapshotId?: string; }
interface Owner { window: BrowserWindow; contents: WebContents; frame: WebFrameMain; document: object; processId: number; frameToken: string; }
interface Binding { owner: Owner; revision: number; parent?: StructureToken; }
interface Issued { token: string; record: StructureToken; }
interface Request { command: string; connectionId: string; revision: number; snapshotId?: string; parent?: StructureToken; claimed?: StructureToken; }
/** 仅真实IPC捕获后传给dispatch；字段不序列化，不接受客户端构造或默认有效回调。 */
export interface ColumnsInvocation { readonly owner: Owner; request?: Request; issued?: Issued; returned?: { snapshotId: string } | { previewToken: string }; cleanup?: Promise<unknown>; }
interface Runtime {
  currentWindow(): BrowserWindow | undefined;
  rendererURL: string;
  connectionRevision(): number;
  assertAvailable(connectionId: string): void;
  shuttingDown(): boolean;
  release(input: { snapshotId?: string; previewToken?: string }): Promise<unknown>;
}
const stale = '字段快照、请求来源或连接配置已变化，请重新读取；未交付新能力';

/** 主进程原始对象和文档代次约束columns能力；不替代引擎的物理身份、一次性执行或资源收尾。 */
export class ColumnsMainCapabilities {
  private readonly documents = new WeakMap<WebContents, object>();
  private readonly invocations = new WeakSet<ColumnsInvocation>();
  private readonly bindings = new WeakMap<StructureToken, Binding>();
  constructor(private readonly tokens: Map<string, StructureToken>, private readonly runtime: Runtime) {}

  /** Electron44真实主文档开始/提交均换代，防同URL重载及导航期间旧IPC回包复活。 */
  trackWindow(window: BrowserWindow): void {
    const contents = window.webContents, rotate = () => this.documents.set(contents, {});
    rotate();
    contents.on('did-start-navigation', details => { if (details.isMainFrame && !details.isSameDocument) rotate(); });
    contents.on('did-navigate', rotate);
    contents.on('render-process-gone', () => this.documents.delete(contents));
    contents.on('destroyed', () => this.documents.delete(contents));
  }

  /** 捕获真实事件；后续不得只比较URL、窗口数字ID或客户端busy标志。 */
  capture(event: IpcMainInvokeEvent): ColumnsInvocation {
    const window = this.runtime.currentWindow(), contents = event.sender, frame = event.senderFrame;
    const document = this.documents.get(contents);
    if (!window || !document || !frame) throw Error('不允许的字段请求来源');
    const invocation: ColumnsInvocation = { owner: { window, contents, frame, document, processId: frame.processId, frameToken: frame.frameToken } };
    this.invocations.add(invocation); this.assertOwner(invocation); return invocation;
  }

  /** 所有四RPC都要求同一真实窗口、frame及主文档，已关闭/替换/崩溃的旧来源不能续用能力。 */
  private assertOwner(invocation?: ColumnsInvocation): asserts invocation is ColumnsInvocation {
    if (!invocation || !this.invocations.has(invocation)) throw Error('缺少真实字段请求来源');
    const owner = invocation.owner, window = this.runtime.currentWindow();
    if (!window || window !== owner.window || window.isDestroyed() || owner.contents.isDestroyed() || window.webContents !== owner.contents ||
      owner.contents.mainFrame !== owner.frame || owner.frame.detached || owner.frame.url !== this.runtime.rendererURL ||
      owner.frame.processId !== owner.processId || owner.frame.frameToken !== owner.frameToken || this.documents.get(owner.contents) !== owner.document) throw Error(stale);
  }

  /** 不以每次capture对象的引用比较归属；同一真实文档的多个IPC可使用其既有token。 */
  private sameOwner(left: Owner, right: Owner): boolean {
    return left.window === right.window && left.contents === right.contents && left.frame === right.frame && left.document === right.document && left.processId === right.processId && left.frameToken === right.frameToken;
  }

  /** 本地方案复用真实IPC捕获门，不授予结构令牌、DDL或引擎能力。 */
  assertCapturedOwner(invocation?:ColumnsInvocation):void {this.assertOwner(invocation);}
  /** 同文档多次IPC核实际对象与代次；不能靠数字窗口ID或URL伪造。 */
  sharesDocumentOwner(left:ColumnsInvocation,right:ColumnsInvocation):boolean {
    this.assertOwner(left);this.assertOwner(right);return this.sameOwner(left.owner,right.owner);
  }

  /** 已知token必须有本helper建立的归属，不能把手工Map记录当已授权的columns能力。 */
  private binding(record: StructureToken, invocation: ColumnsInvocation): Binding {
    const binding = this.bindings.get(record);
    if (!binding || !this.sameOwner(binding.owner, invocation.owner)) throw Error('字段令牌来源不符，请重新读取');
    return binding;
  }

  /** dispatch首个await之前核归属；apply在此同步领取，release另行原子校验与撤销。 */
  begin(command: string, input: any, invocation?: ColumnsInvocation): ColumnsInvocation {
    this.assertOwner(invocation);
    if (command === 'schema.columns.release') return invocation;
    if (this.runtime.shuttingDown()) throw Error('客户端正在退出，不能开始结构操作');
    const record = command === 'schema.columns.preview' ? this.tokens.get(input.snapshotId) : command === 'schema.columns.apply' ? this.tokens.get(input.previewToken) : undefined;
    const revision = this.runtime.connectionRevision(), connectionId = record?.connectionId ?? input.connectionId;
    if (typeof connectionId !== 'string' || !connectionId) throw Error(stale);
    this.runtime.assertAvailable(connectionId);
    if (command !== 'schema.columns.get') {
      const kind = command === 'schema.columns.preview' ? 'snapshot' : 'preview';
      if (!record || record.purpose !== 'columns' || record.kind !== kind || record.expires <= Date.now()) throw Error(stale);
      if (this.binding(record, invocation).revision !== revision) throw Error(stale);
    }
    invocation.request = { command, connectionId, revision, ...(command === 'schema.columns.preview' ? { snapshotId: input.snapshotId, parent: record } : {}), ...(command === 'schema.columns.apply' ? { claimed: record } : {}) };
    if (command === 'schema.columns.apply') this.tokens.delete(input.previewToken);
    return invocation;
  }

  /** 真实投递修订必须与准备时一致；已消费apply只核原领取对象，不重新把它放回Map。 */
  beforeSend(invocation: ColumnsInvocation, revision: number): void {
    this.assertCurrent(invocation);
    if (revision !== invocation.request!.revision) throw Error(stale);
  }

  /** 发布检查共用真实事实；preview父对象被删除或同ID替换都不再有效。 */
  private assertCurrent(invocation: ColumnsInvocation): void {
    this.assertOwner(invocation);
    const request = invocation.request;
    if (!request || this.runtime.shuttingDown() || request.revision !== this.runtime.connectionRevision()) throw Error(stale);
    this.runtime.assertAvailable(request.connectionId);
    if (request.parent && (this.tokens.get(request.snapshotId!) !== request.parent || request.parent.expires <= Date.now())) throw Error(stale);
    if (request.claimed && request.claimed.expires <= Date.now()) throw Error(stale);
  }

  /** broker返回后先记录可精确释放的能力，全部核验通过才同步登记，成功路径无await。 */
  publish(invocation: ColumnsInvocation, result: any): void {
    const request = invocation.request, kind = request?.command === 'schema.columns.get' ? 'snapshot' : 'preview';
    const token = kind === 'snapshot' ? result?.snapshotId : result?.previewToken;
    if (typeof token !== 'string' || !token) throw Error('引擎未返回完整字段令牌，无法精确确认清理');
    // 标识冲突时无法证明是新能力，不能借回收路径释放另一编辑器的既有记录。
    if (this.tokens.has(token)) throw Error('字段引擎返回了重复能力标识，无法确认新能力；未覆盖或释放已有令牌');
    invocation.returned = kind === 'snapshot' ? { snapshotId: token } : { previewToken: token };
    this.assertCurrent(invocation);
    const expires = Date.parse(result.expiresAt);
    if (!Number.isFinite(expires) || expires <= Date.now() || result.target?.connectionId !== request!.connectionId) throw Error(stale);
    if (this.tokens.size >= 128) throw Error('结构令牌缓存已达上限，请关闭旧预览后重试');
    const record: StructureToken = { purpose: 'columns', connectionId: request!.connectionId, expires, kind, ...(request!.parent ? { snapshotId: request!.snapshotId } : {}) };
    this.bindings.set(record, { owner: invocation.owner, revision: request!.revision, ...(request!.parent ? { parent: request!.parent } : {}) });
    this.tokens.set(token, record); invocation.issued = { token, record };
  }

  /** 真实IPC await operation之后再核本次登记对象，返回ok:true前不再await。 */
  assertReply(invocation: ColumnsInvocation): void {
    this.assertCurrent(invocation);
    const issued = invocation.issued;
    if (!issued || this.tokens.get(issued.token) !== issued.record || issued.record.expires <= Date.now()) throw Error(stale);
  }

  /** 原能力释放与晚回包回收分离；失败可见，不把不确定清理报告成成功。 */
  async rejectReply(invocation: ColumnsInvocation, error: unknown): Promise<never> {
    const issued = invocation.issued;
    if (issued && this.tokens.get(issued.token) === issued.record) this.tokens.delete(issued.token);
    const message = error instanceof Error ? error.message : stale;
    if (invocation.returned) {
      try { invocation.cleanup ??= this.runtime.release(invocation.returned); await invocation.cleanup; }
      catch (failure) { throw Error(message + '；字段令牌精确释放尚未确认：' + (failure instanceof Error ? failure.message : '未知清理错误')); }
    }
    throw Error(message);
  }

  /** dispatch后附加失败也不能遗留未交付能力；已精确撤销的记录不重复猜测归属。 */
  hasUnpublished(invocation?: ColumnsInvocation): invocation is ColumnsInvocation {
    return Boolean(invocation?.issued && this.tokens.get(invocation.issued.token) === invocation.issued.record);
  }

  /** 先校验全体已知输入再同步撤销，退出/配置保存时仍只做精确能力释放。 */
  async release(invocation: ColumnsInvocation, input: { snapshotId?: string; previewToken?: string }): Promise<unknown> {
    this.assertOwner(invocation);
    for (const [id, kind] of [[input.snapshotId, 'snapshot'], [input.previewToken, 'preview']] as const) {
      const record = id ? this.tokens.get(id) : undefined;
      if (record) {
        if (record.purpose !== 'columns' || record.kind !== kind) throw Error('结构令牌用途或类型不符，未释放其他编辑器的预览');
        this.binding(record, invocation);
      }
    }
    const parent = input.snapshotId ? this.tokens.get(input.snapshotId) : undefined;
    for (const [token, record] of this.tokens) if (record.purpose === 'columns' &&
      (record === parent || parent && this.bindings.get(record)?.parent === parent || token === input.previewToken)) this.tokens.delete(token);
    // 仅原release协议；当前broker可能自动启动worker，不宣称已具备“仅投现存worker”保证。
    return this.runtime.release(input);
  }
}
