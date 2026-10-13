import { randomUUID } from 'node:crypto';
import { open, rename, rm } from 'node:fs/promises';
import iconv from 'iconv-lite';
import { Types, type FieldPacket, type ResultSetHeader } from 'mysql2';
import type { CellValue, EngineCommand, ConnectionProfile, DataRow, QueryOutcome, QueryResult, ResultColumn, RowChange, TableDesign, TaskEvent } from '../shared/contracts';
import { connectionTransportChanged } from '../shared/connectionProfile';
import { connect, execute, type ManagedConnection } from './connection';
import * as metadata from './metadata';
import { csvCell, csvHeader, encodingName, previewFile, readRecords, readText } from './files';
import { buildChanges, buildDesign, buildPageSql, deserializeCell, exportLiteral, identifier, inlineParameters, qualified, serializeCell, splitSql, SqlScriptScanner } from './sql';

interface Session { id: string; connectionId: string; managed: ManagedConnection; busy: boolean; }
interface RunningTask {
  id: string; managed: ManagedConnection; cancelled: boolean; inFlight: boolean; generation: number;
  cancelPending?: Promise<void>; serverStatus?: number; done: Promise<void>; finish(): void;
}
interface ResultBudget { remainingRows: number; remainingBytes: number; remainingResults: number; }
type Input = Record<string, any>;

/** 独立数据库进程的入口；网络连接与文件流不会进入 Electron 渲染进程。 */
export class Engine {
  private readonly profiles = new Map<string, ConnectionProfile>();
  private readonly sessions = new Map<string, Session>();
  private readonly tasks = new Map<string, RunningTask>();
  private readonly connectionUses = new Map<string, number>();
  /** 注入任务事件出口，使引擎既能在 utility process 中运行，也能独立测试。 */
  constructor(private readonly emit: (event: TaskEvent) => void = () => undefined) {}

  /** 主进程只注入可信 profile/filePath；其他字段按共享接口处理。 */
  async handle(command: EngineCommand, input: Input): Promise<any> {
    switch (command) {
      case '__connections.prepareSave': {
        const next = input.profile as ConnectionProfile;
        if (!next || next.id !== input.id) throw new Error('主进程未提供有效连接配置');
        const previous = this.profiles.get(input.id);
        const changed = input.transportChanged || (previous && connectionTransportChanged(previous, next, { preserveMissingSecrets: false }));
        if (changed && (this.connectionUses.has(input.id) || [...this.sessions.values()].some(session => session.connectionId === input.id) || [...this.tasks.values()].some(task => task.managed.profile.id === input.id))) throw new Error('该连接仍有打开的会话或正在执行的操作，请先关闭相关标签页并等待任务完成，再修改地址或认证配置；现有任务未被取消');
        if (changed || !previous) this.profiles.delete(input.id);
        return;
      }
      case 'connections.test': return this.withConnectionUse(input.id, async () => {
        const managed = await connect(input as ConnectionProfile);
        try { return managed.status; } finally { await managed.close(); }
      });
      case 'connections.open': return this.withConnectionUse(input.id, async () => {
        const profile = input.profile as ConnectionProfile | undefined;
        if (!profile || profile.id !== input.id) throw new Error('主进程未提供有效连接配置');
        const managed = await connect(profile);
        try { this.profiles.set(profile.id, profile); return managed.status; } finally { await managed.close(); }
      });
      case 'connections.close': {
        const active = [...this.tasks.values()].filter(task => task.managed.profile.id === input.id);
        await Promise.all(active.map(task => this.cancelTask(task.id)));
        await Promise.all(active.map(task => task.done));
        for (const [id, session] of this.sessions) if (session.connectionId === input.id) { await session.managed.close(); this.sessions.delete(id); }
        this.profiles.delete(input.id); return;
      }
      case 'sessions.open': return this.withConnectionUse(input.connectionId, async () => {
        const managed = await connect(this.profile(input.connectionId), input.database);
        const sessionId = randomUUID();
        this.sessions.set(sessionId, { id: sessionId, connectionId: input.connectionId, managed, busy: false });
        return { sessionId };
      });
      case 'sessions.close': {
        const session = this.sessions.get(input.sessionId);
        if (!session) return;
        const active = [...this.tasks.values()].filter(task => task.managed === session.managed);
        await Promise.all(active.map(task => this.cancelTask(task.id)));
        await Promise.all(active.map(task => task.done));
        if (session.busy) throw new Error('会话操作尚未结束，请稍后关闭');
        await session.managed.close(); this.sessions.delete(input.sessionId); return;
      }
      case 'metadata.databases': return this.withConnection(input.connectionId, connection => metadata.databases(connection));
      case 'metadata.objects': return this.withConnection(input.connectionId, connection => metadata.objects(connection, input.database));
      case 'metadata.table': return this.withConnection(input.connectionId, connection => metadata.tableInfo(connection, input.database, input.table));
      case 'metadata.ddl': return this.withConnection(input.connectionId, connection => metadata.objectDdl(connection, input.database, input.name, input.kind));
      case 'query.execute': return this.withSession(input.sessionId, managed => this.runTask(input.taskId, managed, '执行 SQL', task => this.queryScript(task, input.sql, input.maxRows)));
      case 'query.explain': return this.withSession(input.sessionId, managed => this.runTask(input.taskId, managed, '查看执行计划', async task => {
        const statements = splitSql(input.sql, await this.noBackslashEscapes(managed));
        if (statements.length !== 1) throw new Error('执行计划一次只接受一条 SQL，请选中需要分析的语句');
        if (/\/\*(?:!|M!)/i.test(statements[0])) throw new Error('执行计划不接受可执行版本注释，请先展开注释为明确的 SQL');
        const start = statements[0].replace(/^(?:\s+|\/\*[\s\S]*?\*\/|--[^\n]*(?:\n|$)|#[^\n]*(?:\n|$))*/, '');
        if (/^EXPLAIN\s+ANALYZE\b/i.test(start)) throw new Error('执行计划不支持 EXPLAIN ANALYZE，因为它会实际执行 SQL');
        if (!/^(?:SELECT|WITH|INSERT|UPDATE|DELETE|REPLACE)\b/i.test(start)) throw new Error('请选择 SELECT、WITH 或数据修改语句查看执行计划');
        return this.queryScript(task, 'EXPLAIN ' + statements[0], input.maxRows);
      }));
      case 'query.cancel': return this.cancelTask(input.taskId);
      case 'query.transaction': return this.withSession(input.sessionId, async managed => {
        const actions: Record<string, string> = { begin: 'START TRANSACTION', commit: 'COMMIT', rollback: 'ROLLBACK' };
        if (!Object.hasOwn(actions, input.action)) throw new Error('事务操作无效');
        await execute(managed, actions[input.action]);
      });
      case 'table.page': return this.withConnection(input.connectionId, async managed => {
        const info = await metadata.tableInfo(managed, input.database, input.table);
        const statement = buildPageSql(info, input.page, input.pageSize, input.filters, input.sort);
        // 筛选值用十六进制字面量嵌入已验证模板，避免文本协议受 SQL 转义模式影响。
        const sql = inlineParameters(statement.sql, statement.params);
        const query = managed.connection.query({ sql, rowsAsArray: true });
        let fields: FieldPacket[] = [];
        query.on('fields', (value: FieldPacket[]) => { fields = value; });
        const stream = query.stream({ highWaterMark: 8 });
        const rows: DataRow[] = []; let bytes = 0;
        try {
          for await (const raw of stream) {
            const values = raw as unknown[];
            if (this.rawRowBytes(values) > 256 * 1024) throw new Error('当前页包含超过 256 KiB 的大字段行，未返回可编辑数据；请筛选该行之外的数据，或使用文件导出读取完整内容');
            const row = Object.fromEntries(fields.map((field, index) => [field.name, serializeCell(values[index])])); bytes += Buffer.byteLength(JSON.stringify(row));
            if (bytes > 16 * 1024 * 1024) throw new Error('当前页数据超过 16 MiB，未返回可编辑数据；请减小页大小或使用文件导出');
            rows.push(row);
          }
        } finally { stream.destroy(); }
        return { rows: rows.slice(0, input.pageSize), columns: this.columns(fields, true), page: input.page, pageSize: input.pageSize, hasMore: rows.length > input.pageSize };
      });
      case 'table.preview': return this.withConnection(input.connectionId, async managed => buildChanges(await metadata.tableInfo(managed, input.database, input.table), input.changes));
      case 'table.apply': return this.withConnection(input.connectionId, managed => this.runTask(input.taskId, managed, '提交数据修改', task => this.applyChanges(task, input)));
      case 'schema.preview': return this.withConnection(input.connectionId, async managed => {
        const design = input.design as TableDesign;
        const original = design.originalName ? await metadata.tableInfo(managed, design.database, design.originalName) : undefined;
        if ((original as { unsupportedDesign?: boolean } | undefined)?.unsupportedDesign) throw new Error('表包含复杂索引、不可见属性或表达式默认值，请使用 SQL 定义编辑以保留这些属性');
        if (original && /^\s*`.*\b(?:COLLATE|CHARACTER SET|ON UPDATE|INVISIBLE|COLUMN_FORMAT|STORAGE|CHECK)\b/im.test(original.ddl)) throw new Error('表字段包含设计器尚未支持的属性，请使用 SQL 定义编辑以保留属性');
        return buildDesign(design, original, await this.noBackslashEscapes(managed));
      });
      case 'schema.apply': return this.withConnection(input.connectionId, managed => this.runTask(input.taskId, managed, '执行结构变更', task => this.queryScript(task, input.sql, 1000)), input.database);
      case 'files.preview': this.assertFile(input); return previewFile(input as { filePath: string; format: 'csv' | 'json'; encoding: string });
      case 'files.import': this.assertFile(input); return this.withConnection(input.connectionId, managed => this.runTask(input.taskId, managed, '导入文件', task => this.importFile(task, input)), input.database);
      case 'files.export': this.assertFile(input); return this.withConnection(input.connectionId, managed => this.runTask(input.taskId, managed, '导出文件', task => this.exportFile(task, input)), input.database);
      default: throw new Error(`数据库进程不支持命令：${command}`);
    }
  }

  /** 关闭前取消任务并释放固定会话，未提交事务由服务器在断开时回滚。 */
  async closeAll(): Promise<void> {
    const active = [...this.tasks.values()];
    await Promise.all(active.map(task => this.cancelTask(task.id)));
    await Promise.all(active.map(task => task.done));
    await Promise.all([...this.sessions.values()].map(session => session.managed.close()));
    this.sessions.clear(); this.profiles.clear();
  }

  /** 只读取已经由主进程解密并成功打开的连接配置，不接受界面任意凭据。 */
  private profile(id: string): ConnectionProfile {
    const profile = this.profiles.get(id);
    if (!profile) throw new Error('请先打开数据库连接');
    return profile;
  }

  /** 元数据和文件任务使用独立连接，避免干扰 SQL 标签页里的事务与临时表。 */
  private async withConnection<T>(id: string, action: (managed: ManagedConnection) => Promise<T>, database?: string): Promise<T> {
    return this.withConnectionUse(id, async () => {
      const managed = await connect(this.profile(id), database);
      try { return await action(managed); } finally { await managed.close(); }
    });
  }

  /** 在首个 await 建连之前登记活动，覆盖会话尚未入表和独立元数据任务的竞态。 */
  private async withConnectionUse<T>(id: string, action: () => Promise<T>): Promise<T> {
    this.connectionUses.set(id, (this.connectionUses.get(id) ?? 0) + 1);
    try { return await action(); }
    finally { const remaining = (this.connectionUses.get(id) ?? 1) - 1; if (remaining) this.connectionUses.set(id, remaining); else this.connectionUses.delete(id); }
  }

  /** 同一会话不允许并行操作，确保事务、临时表和取消操作作用于确定的连接。 */
  private async withSession<T>(id: string, action: (managed: ManagedConnection) => Promise<T>): Promise<T> {
    const session = this.sessions.get(id);
    if (!session) throw new Error('会话不存在，请重新打开标签页');
    if (session.busy) throw new Error('当前标签页正在执行操作，请等待或取消');
    if (session.managed.broken) throw new Error('会话连接已断开，请重新打开标签页；写操作未自动重放');
    session.busy = true;
    try { return await action(session.managed); } finally { session.busy = false; }
  }

  /** 统一登记任务、发送终态并等待取消控制连接结束后释放任务标识。 */
  private async runTask<T>(id: string, managed: ManagedConnection, label: string, action: (task: RunningTask) => Promise<T>): Promise<T> {
    if (!id || this.tasks.has(id)) throw new Error('任务编号为空或任务已在执行');
    let finish!: () => void;
    const done = new Promise<void>(resolve => { finish = resolve; });
    const task: RunningTask = { id, managed, cancelled: false, inFlight: false, generation: 0, done, finish };
    this.tasks.set(id, task);
    this.emit({ taskId: id, status: 'running', progress: 0, message: label });
    try {
      const result = await action(task);
      this.checkCancelled(task);
      const errors = (result as { errors?: string[] } | undefined)?.errors;
      this.emit({ taskId: id, status: errors?.length ? 'failed' : 'completed', progress: 100, message: errors?.length ? errors[0] : `${label}完成` });
      return result;
    } catch (error) {
      this.emit({ taskId: id, status: task.cancelled ? 'cancelled' : 'failed', progress: 0, message: this.errorMessage(error) });
      throw error;
    } finally {
      // 取消连接仍在建立时，不能放开会话给下一条查询，以免 KILL 误伤复用线程。
      await task.cancelPending;
      this.tasks.delete(id); task.finish();
    }
  }

  /** 在下一条 SQL 或下一批文件写入前响应取消，不声称撤销已提交的数据。 */
  private checkCancelled(task: RunningTask): void { if (task.cancelled) throw new Error('任务已取消；此前已经提交的操作不会撤销'); }
  /** 将未知异常转换为可传输文字，避免跨进程依赖 Error 原型。 */
  private errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
  /** 文件路径必须由主进程的已授权 token 解析结果注入。 */
  private assertFile(input: Input): void { if (typeof input.filePath !== 'string' || !input.filePath) throw new Error('主进程未提供已授权文件路径'); }
  /** 逐个转换单元格，同时保留 __proto__ 等合法的数据库字段名。 */
  private row(value: Record<string, unknown>): DataRow { return Object.fromEntries(Object.entries(value).map(([name, cell]) => [name, serializeCell(cell)])); }
  /** 在 base64 与 JSON 分配之前估算一行大小，提前拦截巨型字段。 */
  private rawRowBytes(values: unknown[]): number { return values.reduce<number>((size, cell) => size + (Buffer.isBuffer(cell) ? Math.ceil(cell.length * 4 / 3) : typeof cell === 'string' ? Buffer.byteLength(cell, 'utf8') : 16), 0); }
  /** 查询结果使用位置键防止同名列覆盖，表格页则保留真实字段名用于编辑。 */
  private columns(fields: FieldPacket[], names = false): ResultColumn[] { return fields.map((field, index) => ({ key: names ? field.name : `c${index}`, name: field.name, type: String(field.columnType === undefined ? '未知' : (Types as unknown as Record<number, string>)[field.columnType] ?? field.columnType) })); }
  /** 从实际服务器会话读取字符串转义模式，供扫描器与 DDL 生成共用。 */
  private async noBackslashEscapes(managed: ManagedConnection): Promise<boolean> {
    const result = await execute<{ mode: string }[]>(managed, 'SELECT @@SESSION.sql_mode AS mode');
    return result.rows[0].mode.split(',').includes('NO_BACKSLASH_ESCAPES');
  }

  /** 取消只针对仍然运行的那一代语句；控制连接失败时销毁原会话，不重连重放。 */
  private async cancelTask(id: string): Promise<void> {
    const task = this.tasks.get(id);
    if (!task) return;
    task.cancelled = true;
    if (task.cancelPending) return task.cancelPending;
    const generation = task.generation;
    task.cancelPending = (async () => {
      if (!task.inFlight) return;
      let control: ManagedConnection | undefined;
      try {
        control = await connect(task.managed.profile);
        if (!task.inFlight || task.generation !== generation || this.tasks.get(id) !== task || task.managed.broken) return;
        const threadId = task.managed.connection.threadId;
        if (!Number.isSafeInteger(threadId) || (threadId ?? 0) < 1) throw new Error('无法确认待取消的连接编号');
        await execute(control, `KILL QUERY ${threadId}`);
      } catch {
        if (task.inFlight && task.generation === generation) { task.managed.broken = true; task.managed.connection.destroy(); }
      } finally { await control?.close(); }
    })();
    return task.cancelPending;
  }

  /** 参数化短操作也登记查询代次，以便导入和批量修改在同样的取消边界内运行。 */
  private async statement<T = ResultSetHeader>(task: RunningTask, sql: string, params: CellValue[] = []): Promise<T> {
    this.checkCancelled(task);
    task.inFlight = true; task.generation++;
    try {
      const rows = (await execute<T>(task.managed, sql, params.map(deserializeCell))).rows;
      if (rows && typeof rows === 'object' && 'serverStatus' in rows) task.serverStatus = Number(rows.serverStatus);
      return rows;
    }
    finally { task.inFlight = false; await task.cancelPending; }
  }

  /** 顺序执行脚本并共享结果预算，末尾读取真实事务状态供界面提示。 */
  private async queryScript(task: RunningTask, sql: string, maxRows: number): Promise<QueryOutcome> {
    if (!Number.isInteger(maxRows) || maxRows < 1 || maxRows > 100000) throw new Error('查询结果上限必须在 1～100000 之间');
    const started = performance.now();
    const statements = splitSql(sql, await this.noBackslashEscapes(task.managed));
    const results: QueryResult[] = [];
    // 限额由整项任务共享，防止很多结果集或大 BLOB 绕过单结果集行数限制。
    const budget: ResultBudget = { remainingRows: maxRows, remainingBytes: 16 * 1024 * 1024, remainingResults: 200 };
    for (let index = 0; index < statements.length; index++) {
      this.checkCancelled(task);
      results.push(...await this.streamQuery(task, statements[index], maxRows, results.length, budget));
      this.emit({ taskId: task.id, status: 'running', progress: Math.round((index + 1) / statements.length * 99), message: `已执行 ${index + 1}/${statements.length} 条语句` });
    }
    let transactionOpen: boolean | undefined;
    try { transactionOpen = ((await this.statement(task, 'DO 0')).serverStatus & 1) !== 0; }
    catch {
      // SQL 已经执行成功，附加状态读取失败不能让用户误以为可以安全重试写操作。
      task.managed.broken = true; task.managed.connection.destroy();
      this.emit({ taskId: task.id, status: 'running', progress: 99, message: 'SQL 已执行，但无法确认当前事务状态；会话已断开，请重新连接并核对结果，不要直接重复写操作。' });
    }
    return { results, elapsedMs: performance.now() - started, transactionOpen };
  }

  /** 多结果集按服务器序号隔离；IPC 每批至多 200 行，返回结果受用户上限约束。 */
  private async streamQuery(task: RunningTask, sql: string, maxRows: number, offset: number, budget: ResultBudget = { remainingRows: maxRows, remainingBytes: 16 * 1024 * 1024, remainingResults: 200 }): Promise<QueryResult[]> {
    this.checkCancelled(task);
    task.inFlight = true; task.generation++;
    const started = performance.now(), results: QueryResult[] = [], batches = new Map<number, DataRow[]>(), batchBytes = new Map<number, number>();
    const discarded = new Set<number>();
    let nextImplicitResult = 0;
    /** 按服务器结果序号分配结果容器，超过任务预算后不再保留后续结果。 */
    const ensure = (index: number): QueryResult | undefined => {
      if (discarded.has(index)) return;
      if (!results[index]) {
        const text = sql.length > 32768 ? sql.slice(0, 32768) + '\n-- 结果附带 SQL 文本已截断；完整语句可在执行历史查看。' : sql;
        const bytes = Buffer.byteLength(text);
        if (budget.remainingResults <= 0 || bytes + 256 > budget.remainingBytes) { discarded.add(index); return; }
        budget.remainingResults--;
        budget.remainingBytes -= bytes + 256;
        results[index] = { columns: [], rows: [], truncated: false, elapsedMs: 0, statement: text };
      }
      return results[index];
    };
    /** 将当前结果集的缓冲批次送出；不同结果集不会混用列定义与数据。 */
    const flush = (index: number) => {
      const batch = batches.get(index);
      if (batch?.length) this.emit({ taskId: task.id, status: 'running', progress: 0, message: `已接收 ${results[index].rows.length} 行`, resultIndex: offset + index, batch, rows: results[index].rows.length });
      batches.set(index, []); batchBytes.set(index, 0);
    };
    try {
      await new Promise<void>((resolve, reject) => {
        const query = task.managed.connection.query({ sql, rowsAsArray: true });
        /** 驱动解析器或底层连接的致命错误也必须结束任务，不能让界面永久等待。 */
        const fail = (error: Error) => { cleanup(); reject(error); };
        const cleanup = () => { task.managed.connection.removeListener('error', fail); };
        task.managed.connection.once('error', fail);
        query.on('fields', (fields: FieldPacket[] | undefined, index: number | undefined) => {
          // mysql2 对 DDL/DML 状态包会发送 fields(undefined)，该包没有列定义。
          if (!fields) return;
          const resultIndex = index ?? nextImplicitResult;
          nextImplicitResult = resultIndex + 1;
          const result = ensure(resultIndex); if (!result) return;
          result.columns = this.columns(fields);
          const bytes = Buffer.byteLength(JSON.stringify(result.columns));
          if (bytes > budget.remainingBytes) { result.columns = []; result.truncated = true; }
          else budget.remainingBytes -= bytes;
          this.emit({ taskId: task.id, status: 'running', progress: 0, message: '读取结果集', resultIndex: offset + resultIndex, columns: result.columns });
        });
        query.on('result', (value: unknown[] | ResultSetHeader, resultIndex: number | undefined) => {
          // CALL 的最终状态包没有索引，必须接在已有行结果集之后，不能覆盖首个结果。
          const index = resultIndex ?? nextImplicitResult;
          if (!Array.isArray(value)) nextImplicitResult = index + 1;
          const result = ensure(index); if (!result) return;
          if (!Array.isArray(value)) {
            task.serverStatus = value.serverStatus;
            result.affectedRows = value.affectedRows; result.insertId = String(value.insertId); result.warningCount = value.warningStatus; return;
          }
          if (result.truncated || result.rows.length >= maxRows || budget.remainingRows <= 0) { result.truncated = true; return; }
          // 先检查原始值大小，避免将巨大 Buffer 编成 base64 后才发现超限。
          const rawSize = this.rawRowBytes(value);
          if (rawSize > 256 * 1024 || rawSize > budget.remainingBytes) { result.truncated = true; return; }
          const row = Object.fromEntries(value.map((cell, index) => [`c${index}`, serializeCell(cell)]));
          const size = Buffer.byteLength(JSON.stringify(row));
          if (size > 256 * 1024 || size > budget.remainingBytes) { result.truncated = true; return; }
          budget.remainingRows--; budget.remainingBytes -= size;
          result.rows.push(row);
          const batch = batches.get(index) ?? []; batch.push(row); batches.set(index, batch);
          batchBytes.set(index, (batchBytes.get(index) ?? 0) + size);
          if (batch.length >= 200 || (batchBytes.get(index) ?? 0) >= 256 * 1024) flush(index);
        });
        query.once('error', fail).once('end', () => { cleanup(); resolve(); });
      });
      for (let index = 0; index < results.length; index++) { flush(index); if (results[index]) results[index].elapsedMs = performance.now() - started; }
      if (discarded.size) {
        const last = results.filter(Boolean).at(-1); if (last) last.truncated = true;
        this.emit({ taskId: task.id, status: 'running', progress: 0, message: '结果达到 200 个结果集或 16 MiB 总上限，后续结果未传输；语句仍已执行。请拆分脚本查看。' });
      }
      this.checkCancelled(task);
      return results.filter(Boolean);
    } finally { task.inFlight = false; await task.cancelPending; }
  }

  /** 任一更新/删除未精确命中一行即视为冲突，整批回滚；FOUND_ROWS 允许原值回写。 */
  private async applyChanges(task: RunningTask, input: Input): Promise<{ affectedRows: number }> {
    const info = await metadata.tableInfo(task.managed, input.database, input.table);
    const preview = buildChanges(info, input.changes as RowChange[]);
    await this.statement(task, 'START TRANSACTION');
    let affectedRows = 0;
    try {
      for (const statement of preview.statements) {
        const result = await this.statement(task, statement.sql, statement.params);
        if (result.affectedRows !== 1) throw new Error('数据已被其他连接修改、删除或行定位不唯一；整批修改已回滚，请刷新数据');
        affectedRows += result.affectedRows;
      }
      this.checkCancelled(task);
      await this.statement(task, 'COMMIT');
      return { affectedRows };
    } catch (error) {
      if (!task.managed.broken) await execute(task.managed, 'ROLLBACK').catch(() => undefined);
      throw error;
    }
  }

  /** CSV/JSON 每 500 行提交一批；当前批失败回滚，先前批已提交，并明确记录部分成功。 */
  private async importFile(task: RunningTask, input: Input): Promise<{ rows: number; errors: string[] }> {
    if (input.format === 'sql') return this.importSql(task, input);
    if (!['csv', 'json'].includes(input.format)) throw new Error('不支持的导入格式');
    const info = await metadata.tableInfo(task.managed, input.database, input.table);
    if (info.engine.toUpperCase() !== 'INNODB') throw new Error('CSV/JSON 导入仅支持 InnoDB 表，以保证每批失败可回滚');
    const columns = new Map(info.columns.map(column => [column.name, column]));
    const mapping = Object.entries(input.mapping as Record<string, string>);
    if (!mapping.length) throw new Error('请至少映射一个源字段');
    if (new Set(mapping.map(([, target]) => target)).size !== mapping.length) throw new Error('多个源字段不能映射到同一个目标字段');
    for (const [, target] of mapping) if (!columns.has(target) || columns.get(target)?.generated) throw new Error(`目标字段不存在或为生成列：${target}`);
    const sql = `INSERT INTO ${qualified(input.database, input.table)} (${mapping.map(([, target]) => identifier(target)).join(', ')}) VALUES (${mapping.map(() => '?').join(', ')})`;
    let committed = 0, pending = 0, sourceLine = 0, committing = false;
    await this.statement(task, 'START TRANSACTION');
    try {
      for await (const row of readRecords(input.filePath, input.format, input.encoding)) {
        this.checkCancelled(task); sourceLine++;
        const values = mapping.map(([source, target]) => {
          if (!Object.hasOwn(row, source)) throw new Error(`源记录缺少字段：${source}`);
          let value = row[source];
          if (input.format === 'csv' && typeof value === 'string' && value.startsWith('base64:') && /^(?:tinyblob|blob|mediumblob|longblob|binary|varbinary|bit)/i.test(columns.get(target)!.type)) value = { type: 'binary', base64: value.slice(7) };
          return value;
        });
        await this.statement(task, sql, values); pending++;
        if (pending === 500) {
          committing = true; await this.statement(task, 'COMMIT'); committing = false; committed += pending; pending = 0;
          this.emit({ taskId: task.id, status: 'running', progress: 0, rows: committed, message: `已提交 ${committed} 行（每批 500 行）` });
          await this.statement(task, 'START TRANSACTION');
        }
      }
      committing = true; await this.statement(task, 'COMMIT'); committing = false; committed += pending;
      return { rows: committed, errors: [] };
    } catch (error) {
      if (!task.managed.broken) await execute(task.managed, 'ROLLBACK').catch(() => undefined);
      const message = `第 ${sourceLine || 1} 条记录导入失败；已确认提交 ${committed} 行，${committing ? '当前批提交结果未确认，请核对数据库' : `当前批 ${pending} 行已回滚`}。${this.errorMessage(error)}`;
      if (task.cancelled) throw new Error(message);
      // 保留已提交行数与定位信息，调用方可以展示明确的部分成功结果。
      this.emit({ taskId: task.id, status: 'running', progress: 0, rows: committed, message });
      return { rows: committed, errors: [message] };
    }
  }

  /** SQL 脚本遵循其自身事务语义；DDL 隐式提交与此前已提交语句不能回滚。 */
  private async importSql(task: RunningTask, input: Input): Promise<{ rows: number; errors: string[] }> {
    const scanner = new SqlScriptScanner(await this.noBackslashEscapes(task.managed));
    let rows = 0, statements = 0, pendingRows = 0, committedRows = 0;
    /** 执行单条导入语句，并根据服务器事务状态区分待提交与已提交影响行数。 */
    const run = async (sql: string) => {
      const result = await this.streamQuery(task, sql, 1, 0);
      const affected = result.reduce((total, item) => total + (item.affectedRows ?? 0), 0);
      rows += affected; statements++;
      const start = sql.replace(/^(?:\s+|\/\*[\s\S]*?\*\/|--[^\n]*(?:\n|$)|#[^\n]*(?:\n|$))*/, '');
      if (/^ROLLBACK\b(?!\s+TO\b)/i.test(start)) pendingRows = 0;
      else {
        if (/^(?:BEGIN\b|START\s+TRANSACTION\b)/i.test(start)) { committedRows += pendingRows; pendingRows = 0; }
        pendingRows += affected;
        if (task.serverStatus !== undefined && (task.serverStatus & 1) === 0) { committedRows += pendingRows; pendingRows = 0; }
      }
      if (statements % 100 === 0) this.emit({ taskId: task.id, status: 'running', progress: 0, rows, message: `已执行 ${statements} 条 SQL；脚本按自身事务边界提交` });
    };
    try {
      for await (const chunk of readText(input.filePath, input.encoding)) for (const sql of scanner.push(chunk)) await run(sql);
      for (const sql of scanner.push('', true)) await run(sql);
      // DO 返回的状态位来自服务器，能识别 START TRANSACTION、autocommit=0 和存储过程遗留事务。
      const status = await this.statement(task, 'DO 0');
      if ((status.serverStatus & 1) !== 0) {
        await execute(task.managed, 'ROLLBACK');
        return { rows: committedRows, errors: [`脚本执行了 ${statements} 条 SQL，但结束时仍有未提交事务，已回滚该事务。累计影响 ${rows} 行不是成功提交行数；此前提交的 ${committedRows} 行保留。请为脚本补充明确的 COMMIT/ROLLBACK。`] };
      }
      return { rows: committedRows, errors: [] };
    } catch (error) {
      if (!task.managed.broken) await execute(task.managed, 'ROLLBACK').catch(() => undefined);
      const message = `第 ${statements + 1} 条 SQL 失败；此前已提交语句保留，未提交事务已回滚。${this.errorMessage(error)}`;
      if (task.cancelled) throw new Error(message);
      return { rows: committedRows, errors: [message] };
    }
  }

  /** 导出使用流背压和临时文件；完成后原子替换，取消或失败不留下伪完整目标文件。 */
  private async exportFile(task: RunningTask, input: Input): Promise<{ rows: number }> {
    if (!['csv', 'json', 'sql'].includes(input.format)) throw new Error('不支持的导出格式');
    if (!input.includeData && !(input.format === 'sql' && input.includeStructure)) throw new Error('请选择导出数据，或以 SQL 格式导出结构');
    const encoding = encodingName(input.encoding);
    const info = await metadata.tableInfo(task.managed, input.database, input.table);
    const dataColumns = info.columns.filter(column => input.format !== 'sql' || !column.generated);
    const temporaryPath = `${input.filePath}.dbark-${randomUUID()}.partial`;
    const file = await open(temporaryPath, 'wx');
    let count = 0, completed = false;
    /** 按目标编码完整写出文本，在短写和循环间隙处理剩余字节与取消请求。 */
    const write = async (text: string) => {
      this.checkCancelled(task);
      const buffer = iconv.encode(text, encoding); let offset = 0;
      // FileHandle.write 允许短写，必须消费 bytesWritten 后继续，不能丢失文件尾部数据。
      while (offset < buffer.length) {
        this.checkCancelled(task);
        const result = await file.write(buffer, offset, buffer.length - offset);
        if (result.bytesWritten === 0) throw new Error('目标文件无法继续写入');
        offset += result.bytesWritten;
      }
    };
    try {
      if (encoding === 'utf16le') await write('\uFEFF');
      if (input.format === 'sql') {
        await write('-- DBArk SQL 导出；请在目标数据库执行\nSET NAMES utf8mb4;\n');
        if (input.includeStructure) await write(info.ddl + ';\n\n');
      }
      if (input.includeData) {
        if (input.format === 'csv') await write(dataColumns.map(column => csvHeader(column.name)).join(',') + '\r\n');
        if (input.format === 'json') await write('[\n');
        await this.statement(task, 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
        await this.statement(task, 'START TRANSACTION WITH CONSISTENT SNAPSHOT');
        task.inFlight = true; task.generation++;
        const query = task.managed.connection.query({ sql: `SELECT ${dataColumns.map(column => identifier(column.name)).join(', ')} FROM ${qualified(input.database, input.table)}`, rowsAsArray: true });
        const stream = query.stream({ highWaterMark: 32 });
        try {
          for await (const raw of stream) {
            this.checkCancelled(task);
            const row = Object.fromEntries(dataColumns.map((column, index) => [column.name, serializeCell((raw as unknown[])[index])]));
            if (input.format === 'csv') await write(dataColumns.map(column => csvCell(row[column.name])).join(',') + '\r\n');
            else if (input.format === 'json') await write((count ? ',\n' : '') + JSON.stringify(row));
            else await write(`INSERT INTO ${identifier(input.table)} (${dataColumns.map(column => identifier(column.name)).join(', ')}) VALUES (${dataColumns.map(column => exportLiteral(row[column.name])).join(', ')});\n`);
            count++;
            if (count % 500 === 0) this.emit({ taskId: task.id, status: 'running', progress: 0, rows: count, message: `已导出 ${count} 行` });
          }
        } finally {
          stream.destroy(); task.inFlight = false; await task.cancelPending;
        }
        if (input.format === 'json') await write('\n]\n');
        await this.statement(task, 'ROLLBACK');
      }
      this.checkCancelled(task);
      await file.sync(); await file.close();
      await rename(temporaryPath, input.filePath); completed = true;
      return { rows: count };
    } finally {
      await file.close().catch(() => undefined);
      if (!completed) await rm(temporaryPath, { force: true });
    }
  }
}
