import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { readSchemaComparisonTarget } from '../../src/engine/schemaCompare';
import type { StructureTaskContext } from '../../src/engine/structureDefinition';

const target = { connectionId: 'c', database: 'db.with`quote', table: 'table.with`quote' };
const createSql = 'CREATE TABLE `table.with``quote` (`id` int NOT NULL, PRIMARY KEY (`id`)) ENGINE=InnoDB';

/** mysql2 回调协议的只读测试连接；真实 SQL 构造、回调终态和监听器清理由生产读取器承担。 */
function harness(dialect: 'mysql' | 'mariadb' = 'mysql', version = dialect === 'mysql' ? '8.4.11' : '11.4.13-MariaDB') {
  const sent: string[] = [], controller = new AbortController();
  const state = { mode: 'NO_FIELD_OPTIONS,NO_KEY_OPTIONS,ANSI_QUOTES', quoted: 0, charset: 'latin1', collation: 'latin1_swedish_ci', showGipk: 1 as unknown, reads: 0, cancelled: false, commands: 0, mutation: false, deny: false, hold: false, pending: undefined as (() => void) | undefined };
  const connection = new EventEmitter();
  Object.assign(connection, { threadId: 42, query(sql: string, callback: (error: Error | null, rows?: unknown, fields?: unknown[]) => void) {
    sent.push(sql);
    const respond = () => {
      if (state.deny && sql.startsWith('SHOW CREATE')) return callback(Object.assign(new Error('无权读取完整定义'), { code: 'ER_TABLEACCESS_DENIED_ERROR' }));
      let rows: unknown = [];
      if (sql.includes('@@hostname')) rows = [{ sqlMode: state.mode, hostname: '测试主机', port: 3306, serverId: 1, currentUser: '测试用户', connectionId: 42 }];
      else if (sql.startsWith('SET SESSION sql_mode')) state.mode = /'([^']*)'/.exec(sql)![1];
      else if (sql === 'SET SESSION sql_quote_show_create = 1') state.quoted = 1;
      else if (sql.startsWith('SET NAMES')) { state.charset = 'utf8mb4'; state.collation = 'utf8mb4_bin'; }
      else if (sql.includes('AS quoteShowCreate')) rows = [{ sqlMode: state.mode, quoteShowCreate: state.quoted, charset: state.charset, collation: state.collation }];
      else if (sql.includes('@@server_uuid')) rows = [{ uuid: '只用于内部身份' }];
      else if (sql.includes(' AS visible')) rows = [{ visible: state.showGipk }];
      else if (sql.startsWith('SHOW CREATE')) { state.reads++; rows = [{ 'Create Table': state.mutation && state.reads === 2 ? createSql.replace('int NOT', 'bigint NOT') : createSql }]; }
      else if (sql.includes('FROM information_schema.TABLES')) rows = [{ charset: 'utf8mb4', collation: 'utf8mb4_bin' }];
      else if (sql.includes('FROM information_schema.COLUMNS')) rows = [{ name: 'id', nullable: 'NO', extra: '', charset: null, collation: null }];
      else if (!sql.startsWith('SET SESSION show_gipk')) return callback(new Error(`测试遇到未预期 SQL：${sql}`));
      callback(null, rows, []);
    };
    if (state.hold && sql.startsWith('SHOW CREATE')) state.pending = respond;
    else queueMicrotask(respond);
  } });
  const context = { managed: { connection, broken: false, signal: controller.signal, status: { dialect, version } },
    checkCancelled() { if (state.cancelled) throw new Error('比较已取消'); }, report: vi.fn(), commandStarted() { state.commands++; return () => { state.commands--; }; } } as unknown as StructureTaskContext;
  return { context, state, sent, connection, controller };
}

describe('比较专用结构读取', () => {
  it.each(['mysql', 'mariadb'] as const)('在 %s 独立短会话规范原定义并双读核验，SQL 不包含 DDL 或数据读取', async dialect => {
    const h = harness(dialect), result = await readSchemaComparisonTarget(h.context, target);
    expect(result.target).toEqual(target); expect(result.source).toBe(createSql); expect(h.state.reads).toBe(2); expect(h.state.commands).toBe(0);
    expect(result.originalMode).toBe('NO_FIELD_OPTIONS,NO_KEY_OPTIONS,ANSI_QUOTES'); expect(result.normalizedMode).toBe('ANSI_QUOTES');
    expect(result.context.mode.ansiQuotes).toBe(true);
    expect(h.sent.filter(sql => sql.startsWith('SHOW CREATE'))).toEqual(Array(2).fill('SHOW CREATE TABLE `db.with``quote`.`table.with``quote`'));
    expect(h.sent.every(sql => /^(SELECT |SET SESSION |SET NAMES |SHOW CREATE TABLE )/.test(sql))).toBe(true);
    expect(h.sent.join('\n')).not.toMatch(/\b(?:ALTER|DROP|INSERT|DELETE|UPDATE|GRANT)\b/);
    expect(h.sent.some(sql => sql.includes('show_gipk'))).toBe(dialect === 'mysql'); expect(h.connection.listenerCount('error')).toBe(0);
  });
  it('目录名称使用 UTF-8 十六进制而不拼接字符串字面量', async () => {
    const h = harness(); await readSchemaComparisonTarget(h.context, target);
    const directorySql = h.sent.find(sql => sql.includes('FROM information_schema.COLUMNS'))!;
    expect(directorySql).toContain(Buffer.from(target.database).toString('hex')); expect(directorySql).toContain(Buffer.from(target.table).toString('hex'));
    expect(directorySql).not.toContain(`'${target.database}'`);
  });
  it('MySQL GIPK 开关不能证明开启则拒绝比较，不把隐藏主键报为相同', async () => {
    const h = harness(); h.state.showGipk = 0;
    await expect(readSchemaComparisonTarget(h.context, target)).rejects.toThrow('生成不可见主键'); expect(h.state.reads).toBe(0);
  });
  it('MySQL 未知版本拒绝推断，旧版不查询不存在的 GIPK 变量', async () => {
    const unknown = harness('mysql', '不可信版本'); await expect(readSchemaComparisonTarget(unknown.context, target)).rejects.toThrow('版本'); expect(unknown.sent).toHaveLength(0);
    const old = harness('mysql', '5.7.44-log'); await readSchemaComparisonTarget(old.context, target); expect(old.sent.some(sql => sql.includes('show_gipk'))).toBe(false);
  });
  it('并发结构变化拒绝快照，目录权限失败不降级到启发式比较', async () => {
    const changed = harness(); changed.state.mutation = true; await expect(readSchemaComparisonTarget(changed.context, target)).rejects.toThrow('表定义已变化');
    const denied = harness(); denied.state.deny = true; await expect(readSchemaComparisonTarget(denied.context, target)).rejects.toThrow('无权读取完整定义'); expect(denied.state.reads).toBe(0);
  });
  it('预先取消不发送查询，读取间取消不启动下一条命令', async () => {
    const h = harness(); h.state.cancelled = true; await expect(readSchemaComparisonTarget(h.context, target)).rejects.toThrow('已取消'); expect(h.sent).toHaveLength(0);
    const during = harness(); during.state.hold = true;
    const result = readSchemaComparisonTarget(during.context, target); const settled = vi.fn(); void result.then(settled, settled);
    await vi.waitFor(() => expect(during.state.pending).toBeTypeOf('function'));
    during.state.cancelled = true; await Promise.resolve(); expect(settled).not.toHaveBeenCalled(); expect(during.state.commands).toBe(1);
    during.state.pending!(); await expect(result).rejects.toThrow('已取消'); expect(during.state.commands).toBe(0); expect(during.sent.at(-1)).toMatch(/^SHOW CREATE/);
  });
  it('连接中止清理未完成命令，迟到回调不会回报成功或重复结束', async () => {
    const h = harness(); h.state.hold = true; const result = readSchemaComparisonTarget(h.context, target);
    await vi.waitFor(() => expect(h.state.pending).toBeTypeOf('function'));
    h.controller.abort(); await expect(result).rejects.toThrow('本地结构连接已中止'); expect(h.state.commands).toBe(0); expect(h.connection.listenerCount('error')).toBe(0);
    h.state.pending!(); await Promise.resolve(); expect(h.state.commands).toBe(0);
  });
  it('验证不可信表身份；额外属性不能进入读结构 SQL', async () => {
    const h = harness(); await expect(readSchemaComparisonTarget(h.context, { ...target, password: '禁止凭据' } as typeof target)).rejects.toThrow(); expect(h.sent).toHaveLength(0);
    await expect(readSchemaComparisonTarget(h.context, { ...target, table: '其它表' })).rejects.toThrow('身份与请求不一致');
  });
});
