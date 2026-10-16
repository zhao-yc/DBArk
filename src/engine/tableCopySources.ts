import { createHash, randomUUID } from 'node:crypto';
import type { CommandMap, DataRow, TableInfo, TablePage } from '../shared/contracts';
import { tableCopyMetadataKey, tableCopySourceLimits as limits, tableCopySourceReadSchema, tableCopySourceReleaseSchema, type TableCopySourceReadResult, type TableCopyUnavailable } from '../shared/tableCopySource';
import type { ManagedConnection } from './connection';
import type { StructureTaskContext } from './structureDefinition';
import { completionQuery } from './completionQuery';
import { tableInfo } from './metadata';
import { prepareDataSearchRecord, type RecordPreparation } from './dataSearchRecords';
import { buildPageSql, deserializeCell, identifier, inlineParameters, qualified, serializeCell, typedCellPlaceholder } from './sql';

type Context = Pick<StructureTaskContext, 'managed' | 'checkCancelled' | 'commandStarted'>;
type PageInput = CommandMap['table.page']['input'];
type ReadPage = (managed: ManagedConnection, sql: string, page: number, pageSize: number, binary: boolean) => Promise<TablePage>;
type Identity = Extract<RecordPreparation, { identity: unknown }>['identity'];
type Parameter = ReturnType<typeof deserializeCell>;
interface RowLease { ref: string; key: DataRow; epochs: Record<string, string>; loaded: string[]; fingerprint: string }
interface PageLease { ref: string; connectionId: string; epoch: number; expires: number; info: TableInfo; metadataKey: string; identity: Identity; timeZone: string; rows: Map<string, RowLease>; bytes: number }
interface Ports {
  now(): number; id(): string;
  info(context: Context, database: string, table: string): Promise<TableInfo>;
  identity(context: Context, info: TableInfo): Promise<RecordPreparation>;
  query<T>(context: Context, sql: string, values?: Parameter[]): Promise<{ rows: T }>;
}
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const own = (row: DataRow, key: string) => Object.hasOwn(row, key) ? row[key] : undefined;
const ordinary = (column: TableInfo['columns'][number]) => !column.generated && !/\bauto_increment\b/i.test(column.extra);
const permission = (error: unknown) => [1044, 1142, 1143, 1227].includes((error as { errno?: number })?.errno ?? 0);

/** 固定原因不含行值、SQL和原始驱动错误；无法证明时绝不返回部分数据冒充complete。 */
export class TableCopySourceError extends Error {
  constructor(readonly reason: TableCopyUnavailable) { super('完整复制源不可用：' + reason + '，请重新读取并核对来源；未生成草稿或执行写入。'); }
}
/** 数字按IEEE字节摘要，不能把-0、精确浮点或二进制包装经JSON简化后误判为相同。 */
function fingerprint(row: DataRow, columns: readonly string[]): string {
  return digest(columns.map(key => {
    const value = own(row, key); if (value === undefined) throw new TableCopySourceError('changed');
    if (typeof value === 'number') { if (!Number.isFinite(value)) throw new TableCopySourceError('unsupported'); const bytes = Buffer.alloc(8); bytes.writeDoubleBE(value); return [key, 'number', bytes.toString('hex')]; }
    return [key, value === null ? 'null' : typeof value, value];
  }));
}

/** 引擎签发的来源仅保留键/指纹与元数据；不保留连接，也不信任渲染器传来的键或SQL。 */
export class TableCopySources {
  private pages = new Map<string, PageLease>(); private epochs = new Map<string, number>(); private active = new Set<string>();
  private bytes = 0; private refs = 0; private timer?: ReturnType<typeof setTimeout>; private closed = false;
  private readonly ports: Ports;
  constructor(ports: Partial<Ports> = {}) {
    this.ports = {
      now: Date.now, id: randomUUID,
      query: (context, sql, values = []) => completionQuery(context.managed, context, sql, values),
      info: (context, database, table) => tableInfo(context.managed, database, table, (sql, values = []) => completionQuery(context.managed, context, sql, values)),
      identity: (context, info) => prepareDataSearchRecord(context, { database: info.database, table: info.name, kind: 'table', columns: [] }), ...ports,
    };
  }
  /** 到期和释放只撤销能力，不能让在途回包重新创建已撤销租约。 */
  private prune(): void {
    const now = this.ports.now(); for (const page of this.pages.values()) if (page.expires <= now) this.remove(page);
    if (this.timer) clearTimeout(this.timer); this.timer = undefined;
    if (this.pages.size) { const expiry = Math.min(...[...this.pages.values()].map(page => page.expires)); this.timer = setTimeout(() => this.prune(), Math.max(1, expiry - now)); this.timer.unref(); }
  }
  /** 所有资源计数集中扣减；并发read仍持有旧对象但后续有效性复核必然失败。 */
  private remove(page: PageLease): void { if (this.pages.delete(page.ref)) { this.bytes -= page.bytes; this.refs -= page.rows.size; } }
  /** 页释放严格核归属；未知旧引用幂等，不能释放别的连接。 */
  release(raw: unknown): void {
    const input = tableCopySourceReleaseSchema.parse(raw); this.prune(); const page = this.pages.get(input.pageRef);
    if (page && page.connectionId !== input.connectionId) throw new TableCopySourceError('changed'); if (page) this.remove(page); this.prune();
  }
  /** 连接变更、关闭或引擎退出使未完成签发的旧代次也失效。 */
  releaseConnection(connectionId: string): void { this.epochs.set(connectionId, (this.epochs.get(connectionId) ?? 0) + 1); for (const page of this.pages.values()) if (page.connectionId === connectionId) this.remove(page); this.prune(); }
  /** 引擎退出一次性撤销所有租约并停止TTL定时器；在途读取随后复核必然失败。 */
  close(): void { this.closed = true; this.pages.clear(); this.bytes = 0; this.refs = 0; if (this.timer) clearTimeout(this.timer); this.timer = undefined; }
  /** 对当前租约做引用同一性及代次复核，取消、释放、到期和连接修改都不能复活。 */
  private current(page: PageLease, context: Context): void { context.checkCancelled(); this.prune(); if (this.closed || this.pages.get(page.ref) !== page || page.epoch !== (this.epochs.get(page.connectionId) ?? 0)) throw new TableCopySourceError('expired'); }
  /** 暴露无行值的资源计数，用于生命周期核验。 */
  stats() { this.prune(); return { pages: this.pages.size, references: this.refs, bytes: this.bytes, active: this.active.size }; }

  /** 明确opt-in的表页才进入本路径；没有缺列时仍调用原分页读取，不签发来源。 */
  async page(context: Context, input: PageInput, readPage: ReadPage): Promise<TablePage> {
    const epoch = this.epochs.get(input.connectionId) ?? 0, info = await this.ports.info(context, input.database, input.table);
    const statement = (metadata: TableInfo) => { const built = buildPageSql(metadata, input.page, input.pageSize, input.filters, input.sort, input.filterMode); return inlineParameters(built.sql, built.params); };
    const read = async (metadata: TableInfo, sql = statement(metadata)) => { context.checkCancelled(); const terminal = context.commandStarted(); try { const page = await readPage(context.managed, sql, input.page, input.pageSize, metadata.columns.some(column => /^(?:FLOAT|DOUBLE|REAL)\b/i.test(column.type))); context.checkCancelled(); return page; } finally { terminal(); } };
    if (!info.columns.some(column => ordinary(column) && /\bINVISIBLE\b/i.test(column.extra))) return read(info);
    let issued: PageLease | undefined; let transaction = false, fallback: TableCopyUnavailable | undefined;
    try {
      await this.ports.query(context, 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      await this.ports.query(context, 'START TRANSACTION READ ONLY'); transaction = true;
      // 先建立真实表MDL，之后目录、物理身份、页面SELECT和签发全在同一只读事务持锁期间。
      await this.ports.query(context, 'SELECT 1 FROM ' + qualified(info.database, info.name) + ' LIMIT 0');
      const fresh = await this.ports.info(context, info.database, info.name), prepared = await this.ports.identity(context, fresh);
      const timeZone = (await this.ports.query<{ timeZone: string }[]>(context, 'SELECT @@SESSION.time_zone AS timeZone')).rows[0]?.timeZone;
      const pageSql = statement(fresh), aliases = new Map<string, string>(), names = new Set(fresh.columns.map(column => column.name));
      for (const key of fresh.editableKey) { const column = fresh.columns.find(column => column.name === key); if (!column || !/^TIMESTAMP\b/i.test(column.type) || /\bINVISIBLE\b/i.test(column.extra)) continue; let alias = '__dbark_copy_epoch_' + aliases.size; while (names.has(alias)) alias += '_'; names.add(alias); aliases.set(key, alias); }
      const projection = aliases.size ? pageSql.replace(/^SELECT \* FROM /, 'SELECT *,' + [...aliases].map(([key, alias]) => 'UNIX_TIMESTAMP(' + identifier(key) + ') AS ' + identifier(alias)).join(',') + ' FROM ') : pageSql;
      let raw: TablePage; try { raw = await read(fresh, projection); } catch (error) {
        // 内部精度投影不能使原本预算内的页面失败；退回普通页后该行因缺少epoch不能获租约。
        if (!aliases.size || (!permission(error) && !(error instanceof Error && error.message.startsWith('当前页包含超过 256 KiB')))) throw error;
        raw = await read(fresh);
      }
      const epochs = raw.rows.map(row => Object.fromEntries([...aliases].flatMap(([key, alias]) => { const value = own(row, alias); return value !== undefined && value !== null ? [[key, String(value)]] : []; })));
      const hidden = new Set(aliases.values());
      const page: TablePage = aliases.size ? { ...raw, columns: raw.columns.filter(column => !hidden.has(column.key)), rows: raw.rows.map(row => Object.fromEntries(Object.entries(row).filter(([key]) => !hidden.has(key)))) } : raw;
      const loaded = page.columns.map(column => column.key), missing = fresh.columns.filter(column => ordinary(column) && (!loaded.includes(column.name) || page.rows.some(row => !Object.hasOwn(row, column.name)))).map(column => column.name);
      if (!missing.length) return page;
      const unavailable = (reason: TableCopyUnavailable): TablePage => ({ ...page, copySource: { status: 'unavailable', reason, missingColumns: missing } });
      if ('reason' in prepared) return unavailable(prepared.reason);
      if (fresh.objectKind !== 'table' || fresh.engine.toUpperCase() !== 'INNODB') return unavailable('unsupported');
      if (!fresh.editableKey.length || loaded.some(key => !fresh.columns.some(column => column.name === key))) return unavailable('no-key');
      this.prune(); const metadataKey = tableCopyMetadataKey(fresh), rowRefs: (string | null)[] = [], rows = new Map<string, RowLease>();
      if (this.closed || epoch !== (this.epochs.get(input.connectionId) ?? 0)) return unavailable('expired');
      if (typeof timeZone !== 'string' || timeZone.length > 128 || fresh.columns.length > limits.columns || Buffer.byteLength(fresh.ddl) > limits.definitionBytes || [...this.pages.values()].filter(value => value.connectionId === input.connectionId).length >= limits.pagesPerConnection) return unavailable('budget');
      page.rows.forEach((row, index) => {
        const key = Object.fromEntries(fresh.editableKey.map(name => [name, own(row, name)])) as DataRow;
        if (fresh.editableKey.some(name => own(row, name) === undefined || own(row, name) === null) || Buffer.byteLength(JSON.stringify(key)) > limits.keyBytes || fresh.editableKey.some(name => /^TIMESTAMP\b/i.test(fresh.columns.find(column => column.name === name)!.type) && !/^\d{1,12}(?:\.\d{1,6})?$/.test(epochs[index][name] ?? ''))) { rowRefs.push(null); return; }
        const ref = this.ports.id(); rowRefs.push(ref); rows.set(ref, { ref, key: structuredClone(key), epochs: epochs[index], loaded: [...loaded], fingerprint: fingerprint(row, loaded) });
      });
      if (!rows.size) return unavailable('no-key');
      const pageRef = this.ports.id(), expires = this.ports.now() + limits.retentionMs;
      const bytes = Buffer.byteLength(JSON.stringify({ ref: pageRef, connectionId: input.connectionId, epoch, expires, info: fresh, metadataKey, identity: prepared.identity, timeZone, rows: [...rows.values()], bytes: 0 })) + 32;
      if (this.refs + rows.size > limits.references || this.bytes + bytes > limits.cacheBytes) return unavailable('budget');
      issued = { ref: pageRef, connectionId: input.connectionId, epoch, expires, info: structuredClone(fresh), metadataKey, identity: prepared.identity, timeZone, rows, bytes };
      this.pages.set(pageRef, issued); this.bytes += bytes; this.refs += rows.size; this.prune();
      return { ...page, copySource: { status: 'ready', pageRef, rowRefs, expiresAt: expires, metadataKey, missingColumns: missing } };
    } catch (error) {
      if (issued) this.remove(issued); context.checkCancelled();
      if (permission(error)) fallback = 'identity-permission';
      else if ([1064, 1235].includes((error as { errno?: number })?.errno ?? 0)) fallback = 'unsupported';
      else if (error instanceof TableCopySourceError) fallback = error.reason;
      else throw error;
    }
    finally { if (transaction) { try { await this.ports.query(context, 'ROLLBACK'); context.checkCancelled(); if (issued) this.current(issued, context); } catch (error) { if (issued) this.remove(issued); throw error; } } }
    // 证明失败只能降级查看；事务结束后不再为同名对象追签任何来源。
    const page = await read(info);
    return { ...page, copySource: { status: 'unavailable', reason: fallback!, missingColumns: info.columns.filter(column => ordinary(column) && !page.columns.some(item => item.key === column.name)).map(column => column.name) } };
  }

  /** 按租约原始可靠键读取完整行；预检长度后再取值，不能把截断内容当作可写草稿。 */
  async read(context: Context, raw: unknown): Promise<TableCopySourceReadResult> {
    const input = tableCopySourceReadSchema.parse(raw); this.prune(); const page = this.pages.get(input.pageRef), row = page?.rows.get(input.rowRef);
    if (!page || !row || page.connectionId !== input.connectionId) throw new TableCopySourceError('expired');
    this.current(page, context); if (this.active.has(row.ref)) throw new TableCopySourceError('changed'); this.active.add(row.ref);
    let transaction = false;
    try {
      await this.ports.query(context, 'SET SESSION time_zone = ?', [page.timeZone]);
      await this.ports.query(context, 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      await this.ports.query(context, 'START TRANSACTION READ ONLY'); transaction = true;
      await this.ports.query(context, 'SELECT 1 FROM ' + qualified(page.info.database, page.info.name) + ' LIMIT 0');
      const info = await this.ports.info(context, page.info.database, page.info.name), prepared = await this.ports.identity(context, info); this.current(page, context);
      if ('reason' in prepared) throw new TableCopySourceError(prepared.reason);
      if (JSON.stringify(prepared.identity) !== JSON.stringify(page.identity) || tableCopyMetadataKey(info) !== page.metadataKey) throw new TableCopySourceError('changed');
      const params: Parameter[] = [], conditions = info.editableKey.map(name => {
        const column = info.columns.find(column => column.name === name)!, value = own(row.key, name)!;
        if (/^TIMESTAMP\b/i.test(column.type)) {
          const epoch = row.epochs[name]; if (/^0(?:\.0+)?$/.test(epoch)) { params.push(String(value)); return 'CAST(' + identifier(name) + ' AS CHAR)=?'; }
          const instant = 'FROM_UNIXTIME(CAST(? AS DECIMAL(20,6)))'; params.push(epoch, epoch, epoch); return '(' + identifier(name) + '=' + instant + ' OR ' + instant + ' IS NULL) AND UNIX_TIMESTAMP(' + identifier(name) + ')=CAST(? AS DECIMAL(20,6))';
        }
        params.push(deserializeCell(value)); return identifier(name) + ' <=> ' + typedCellPlaceholder(column, value);
      });
      const suffix = ' FROM ' + qualified(info.database, info.name) + ' WHERE ' + conditions.join(' AND ') + ' LIMIT 2';
      const sizes = (await this.ports.query<Record<string, unknown>[]>(context, 'SELECT ' + info.columns.map((column, index) => 'OCTET_LENGTH(' + identifier(column.name) + ') AS n' + index).join(',') + suffix, params)).rows; this.current(page, context);
      if (sizes.length !== 1) throw new TableCopySourceError('changed'); let bytes = 0n;
      info.columns.forEach((_, index) => { const value = sizes[0]['n' + index]; if (value !== null && !/^\d{1,20}$/.test(String(value))) throw new TableCopySourceError('changed'); bytes += value === null ? 0n : BigInt(String(value)); });
      if (bytes > BigInt(limits.rowBytes)) throw new TableCopySourceError('budget');
      const result = (await this.ports.query<Record<string, unknown>[]>(context, 'SELECT ' + info.columns.map((column, index) => identifier(column.name) + ' AS c' + index).join(',') + suffix, params)).rows; this.current(page, context);
      if (result.length !== 1) throw new TableCopySourceError('changed');
      const values: DataRow = Object.fromEntries(info.columns.map((column, index) => {
        const key = 'c' + index, value = result[0][key];
        if (!Object.hasOwn(result[0], key) || value === undefined) throw new TableCopySourceError('changed');
        if (value !== null && !Buffer.isBuffer(value) && !['string', 'number', 'boolean', 'bigint'].includes(typeof value) || typeof value === 'number' && !Number.isFinite(value)) throw new TableCopySourceError('unsupported');
        return [column.name, serializeCell(value)];
      }));
      if (Object.values(values).reduce<number>((sum, value) => sum + (value && typeof value === 'object' ? Buffer.byteLength(value.base64, 'base64') : value === null ? 0 : Buffer.byteLength(String(value))), 0) > limits.rowBytes) throw new TableCopySourceError('budget');
      if (fingerprint(values, row.loaded) !== row.fingerprint) throw new TableCopySourceError('changed');
      const output: TableCopySourceReadResult = { target: { connectionId: input.connectionId, database: info.database, table: info.name }, pageRef: page.ref, rowRef: row.ref, metadataKey: page.metadataKey, readAt: new Date(this.ports.now()).toISOString(), complete: true, values };
      if (Buffer.byteLength(JSON.stringify(output)) > limits.resultBytes) throw new TableCopySourceError('budget');
      return output;
    } catch (error) { context.checkCancelled(); if (error instanceof TableCopySourceError) throw error; throw new TableCopySourceError(permission(error) ? 'identity-permission' : 'identity-unproven'); }
    finally {
      try { if (transaction) { await this.ports.query(context, 'ROLLBACK'); this.current(page, context); } }
      catch (error) { context.checkCancelled(); if (error instanceof TableCopySourceError) throw error; throw new TableCopySourceError(permission(error) ? 'identity-permission' : 'identity-unproven'); }
      finally { this.active.delete(row.ref); }
    }
  }
}
