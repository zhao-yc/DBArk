import type { QueryResultColumnsUiOwner, QueryResultColumnsUiInfo } from './queryResultColumnsUi';

// 两条SQL只包含本例自带值；不读表、库、文件或存储函数，列元数据保持一致。
export const comparisonLeftSql = "SELECT CAST('1' AS CHAR) AS id,CAST('18446744073709551615' AS UNSIGNED) AS huge,CAST('0.12345678901234567890' AS DECIMAL(30,20)) AS amount,CAST('相同' AS CHAR) AS nullable_value,X'00ff' AS bytes UNION ALL SELECT CAST('2' AS CHAR),CAST('9007199254740993' AS UNSIGNED),CAST('1.00000000000000000001' AS DECIMAL(30,20)),CAST(NULL AS CHAR),X'00' UNION ALL SELECT CAST('3' AS CHAR),CAST('2' AS UNSIGNED),CAST('2.00000000000000000000' AS DECIMAL(30,20)),CAST('移除' AS CHAR),NULL ORDER BY id";
export const comparisonRightSql = "SELECT CAST('1' AS CHAR) AS id,CAST('18446744073709551615' AS UNSIGNED) AS huge,CAST('0.12345678901234567890' AS DECIMAL(30,20)) AS amount,CAST('相同' AS CHAR) AS nullable_value,X'00ff' AS bytes UNION ALL SELECT CAST('2' AS CHAR),CAST('9007199254740994' AS UNSIGNED),CAST('1.00000000000000000002' AS DECIMAL(30,20)),CAST('' AS CHAR),X'' UNION ALL SELECT CAST('4' AS CHAR),CAST('4' AS UNSIGNED),CAST('4.00000000000000000000' AS DECIMAL(30,20)),CAST('新增' AS CHAR),NULL ORDER BY id";

export interface ComparisonAuditTarget { senderId: number; profileId: string; tabId: string; sqls: [string, string]; maxRows: number; deadline: number; }

/** 只序列化到本例Main；唯一原handler真实委托，两条SQL和任务能力分别消费，失败永久停链。 */
export function installComparisonAudit({ ipcMain }: { ipcMain: any }, target: ComparisonAuditTarget): void {
  const root = globalThis as any, handlers = ipcMain?._invokeHandlers, original = handlers?.get('dbark:request');
  if (root.__dbarkComparisonAudit || typeof original !== 'function' || !Number.isSafeInteger(target.senderId) || target.senderId <= 0 || !target.profileId || !target.tabId || !Array.isArray(target.sqls) || target.sqls.length !== 2 || target.sqls.some(sql => typeof sql !== 'string' || !sql) || target.sqls[0] === target.sqls[1] || !Number.isInteger(target.maxRows) || target.maxRows < 3 || target.maxRows > 100000 || !Number.isFinite(target.deadline) || target.deadline <= Date.now()) throw Error('固定结果对比审计目标无效');
  const state: any = { invalid: false, queries: 0, pending: 0, revision: 0, session: '', sessionClaim: undefined, last: Date.now(), tasks: new Map(), check: undefined };
  const taskIds = new Set<string>();
  /** 只报告固定分类，禁止请求正文、凭据和原始数据库错误进入审计输出。 */
  const reject = (reason: string): never => { state.invalid = true; state.failure ??= reason; throw Error('固定结果对比原授权已停链：' + state.failure); };
  const own = (value: any, key: string): any => { const descriptor = value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, key) : undefined; if (!descriptor || !('value' in descriptor)) return reject('请求属性'); return descriptor.value; };
  const fields = (value: any, allowed: string[]): void => { if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) reject('请求字段'); for (const key of Object.keys(value)) own(value, key); };
  state.check = () => { const now = Date.now(); if (state.invalid || root.__dbarkComparisonAudit !== state || handlers.get('dbark:request') !== wrapped || !Number.isFinite(now) || now < state.last || now >= target.deadline) reject('归属或原期限'); state.last = now; };
  const wrapped = async (event: any, payload: any) => {
    if (event.sender?.id !== target.senderId) return original(event, payload);
    state.check(); const command = own(payload, 'command'), input = own(payload, 'input'); let claim: any, task: any;
    if (command === 'settings.save') {
      const tabs = own(input, 'tabs'), active = own(input, 'activeTabId');
      if (!Array.isArray(tabs) || tabs.length !== 1 || active !== target.tabId) reject('工作区目标');
      const tab = tabs[0], sql = own(tab, 'sql');
      if (own(tab, 'id') !== target.tabId || own(tab, 'kind') !== 'query' || own(tab, 'connectionId') !== target.profileId || !(state.queries === 0 ? sql === target.sqls[0] : state.queries === 1 ? [target.sqls[0], '', target.sqls[1]].includes(sql) : sql === target.sqls[1])) { state.revision++; reject('工作区来源'); }
    } else if (command === 'sessions.open') {
      fields(input, ['connectionId', 'database']);
      if (own(input, 'connectionId') !== target.profileId || input.database || state.session || state.sessionClaim) reject('会话领取');
      claim = { sender: event.sender, connectionId: target.profileId, response: undefined }; state.sessionClaim = claim;
    } else if (command === 'connections.open') {
      fields(input, ['id']); if (own(input, 'id') !== target.profileId) reject('连接目标');
    } else if (command === 'query.execute') {
      fields(input, ['sessionId', 'sql', 'taskId', 'maxRows']);
      const id = own(input, 'taskId');
      if (!state.session || own(input, 'sessionId') !== state.session || state.queries >= 2 || [...state.tasks.values()].some((value: any) => !value.ended) || own(input, 'sql') !== target.sqls[state.queries] || own(input, 'maxRows') !== target.maxRows || typeof id !== 'string' || !id || taskIds.has(id)) reject('查询目标或次数');
      taskIds.add(id); task = { id, sql: input.sql, sessionId: state.session, cancelled: false, ended: false }; state.tasks.set(id, task); state.queries++;
    } else if (command === 'query.cancel') {
      fields(input, ['taskId']); const selected = state.tasks.get(own(input, 'taskId'));
      if (!selected || selected.ended || selected.cancelled) reject('取消任务范围'); selected.cancelled = true;
    } else if (['query.completionState', 'sessions.close'].includes(command)) {
      fields(input, ['sessionId']); if (!state.session || own(input, 'sessionId') !== state.session || command === 'sessions.close' && [...state.tasks.values()].some((value: any) => !value.ended)) reject('会话目标或未完成任务');
    } else if (command === 'metadata.completion') {
      if (own(input, 'connectionId') !== target.profileId || input.database || input.sessionId !== undefined && input.sessionId !== state.session) reject('补全目标');
    } else if (!['settings.get', 'connections.list', 'history.list', 'tasks.list'].includes(command)) {
      if (typeof command === 'string' && command.startsWith('connections.')) state.revision++; reject('未授权命令');
    }
    state.pending++;
    try {
      const response = await original(event, payload);
      if (claim) claim.response = response;
      state.check(); if (event.sender?.id !== target.senderId) reject('迟到窗口身份'); if (response?.ok !== true) reject('原handler失败');
      if (claim) {
        if (state.sessionClaim !== claim || event.sender !== claim.sender || input.connectionId !== claim.connectionId || input.database || state.revision !== 0 || typeof response.result?.sessionId !== 'string' || !response.result.sessionId) reject('会话回包归属');
        state.session = response.result.sessionId;
      }
      if (command === 'query.execute') {
        if (input.taskId !== task.id || input.sql !== task.sql || input.sessionId !== task.sessionId || input.maxRows !== target.maxRows) reject('查询回包来源');
        const results = response.result?.results;
        if (!Array.isArray(results) || results.length !== 1 || results[0]?.truncated !== false || !Array.isArray(results[0]?.columns) || results[0].columns.length !== 5 || !Array.isArray(results[0]?.rows) || results[0].rows.length !== 3 || results[0].columns.some((column: any, index: number) => column.key !== 'c' + index)) reject('真实查询回包');
        const metadata = results[0].columns.map((column: any) => ({ key: column.key, name: column.name, type: column.type }));
        if (state.metadata && JSON.stringify(state.metadata) !== JSON.stringify(metadata)) reject('两份元数据不同'); state.metadata = metadata;
      }
      return response;
    } catch (reason) { state.invalid = true; throw reason; }
    finally { if (task) task.ended = true; state.pending--; }
  };
  root.__dbarkComparisonAudit = state; handlers.set('dbark:request', wrapped); state.check();
}

/** 只返回固定计数；原SQL、认证、会话句柄与实际行均不进入报告。 */
export function readComparisonAudit(): { queries: number; pending: number; revision: number } {
  const state = (globalThis as any).__dbarkComparisonAudit; if (!state?.check) throw Error('固定结果对比审计归属未知');
  state.check(); return { queries: state.queries, pending: state.pending, revision: state.revision };
}

/** 仅核本例两条正式常量查询任务，不接纳空列表、导出或失败补证。 */
export function queryResultComparisonTasks(tasks: unknown): void {
  if (!Array.isArray(tasks) || tasks.length !== 2 || new Set(tasks.map(task => task?.id)).size !== 2 || tasks.some(task => !task || typeof task.id !== 'string' || !task.id || task.kind !== 'query.execute' || task.status !== 'completed')) throw Error('固定结果对比本例两条查询未准确完成');
}

/** 只管理原TestInfo/原窗口；保留本地锁先落定，通知throw/noop也不能恢复退出权限。 */
export class QueryResultComparisonLifetime {
  readonly state = { active: true, pending: 0, retained: false, tasksChecked: false, windowClosed: false, observerClosed: false };
  private readonly start: number;
  private readonly deadline: number;
  private last: number;
  private ended?: number;
  constructor(private readonly owner: QueryResultColumnsUiOwner, private readonly info: QueryResultColumnsUiInfo, private readonly now: () => number = () => Date.now()) { this.start = info._startWallTime ?? NaN; this.deadline = this.start + 120000; this.last = this.start; }
  preserve(): void { if (this.state.retained) return; this.state.retained = true; try { this.owner.retain(); } catch { /* 本地永久锁优先于共享通知，不覆盖原失败。 */ } }
  /** 不从helper启动重计时；预算变化、原框架终态和时钟倒退均停止。 */
  check(allowClosed = false): void {
    try { const now = this.now(); if (this.state.retained || !this.state.active || !Number.isFinite(this.start) || this.start < 0 || !Number.isFinite(now) || now < this.last || now >= this.deadline || this.info.timeout !== 120000 || this.info.status !== 'passed') throw Error('固定结果对比本例已停链或原120秒期限失效'); this.last = now; this.owner.check(allowClosed); if (!allowClosed && this.owner.closed()) throw Error('固定结果对比本例窗口已关闭'); }
    catch (reason) { this.preserve(); throw reason; }
  }
  /** 动作前后核同一owner；未知保留原错误与句柄，不自动重试或退出。 */
  async observe<T>(action: () => Promise<T>, allowClosed = false): Promise<T> { this.check(allowClosed); this.state.pending++; try { const result = await action(); this.check(allowClosed); return result; } catch (reason) { this.preserve(); throw reason; } finally { this.state.pending--; } }
  /** 原生严格关闭也不得借独立超时越过原期限。 */
  remaining(maximum: number): number { this.check(true); return Math.max(1,Math.min(maximum,this.deadline-this.last)); }
  /** 仅在任务、窗口和原观察流都确定时完成；失败不进入finally补清理。 */
  async finish(readTasks: () => Promise<unknown>, closeObserver: () => Promise<void>): Promise<void> {
    try {
      this.check(); if (this.state.pending) throw Error('固定结果对比仍有未结束动作'); queryResultComparisonTasks(await this.observe(readTasks)); this.state.tasksChecked = true;
      await this.observe(() => this.owner.exit(),true); if (!this.owner.closed()) throw Error('固定结果对比原窗口退出未确认'); this.state.windowClosed = true;
      await this.observe(closeObserver,true); this.state.observerClosed = true;
    } catch (reason) { this.preserve(); throw reason; }
  }
  /** finally只关闭活动门，不执行退出、原生关闭或目录清理。 */
  endBody(): void { if (!this.state.retained && this.state.pending === 0 && this.state.tasksChecked && this.state.windowClosed && this.state.observerClosed) { try { this.check(true); this.ended = this.last; } catch { /* 原失败由动作门保留。 */ } } this.state.active = false; }
  /** 超时/仍活动先保留；正常afterEach只核原期限内已完成事实，不重新开放动作。 */
  afterEach(): void {
    try { if (this.state.retained || this.state.active || this.state.pending || this.ended === undefined || this.ended >= this.deadline || this.info.timeout !== 120000 || this.info.status !== 'passed' || !this.state.tasksChecked || !this.state.windowClosed || !this.state.observerClosed) throw Error('固定结果对比本例收尾未确认，保留所属资源'); this.owner.check(true); if (!this.owner.closed()) throw Error('固定结果对比原窗口close事实失效'); }
    catch (reason) { this.preserve(); throw reason; }
  }
}
