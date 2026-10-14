import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { FieldPacket } from 'mysql2';
import type { ManagedConnection } from '../../src/engine/connection';
import type { StructureTaskContext } from '../../src/engine/structureDefinition';
import { readForeignKeyNamespace, compareForeignKeyNames } from '../../src/engine/tableForeignKeyNamespaceRead';
import {
  buildForeignKeyNamespaceEvidence, foreignKeyNamespaceLimits, planForeignKeyNameComparisons,
  type ForeignKeyNamespaceFacts, type ForeignKeyNamespaceInput
} from '../../src/engine/tableForeignKeyNamespaceEvidence';

type Row = Record<string, unknown>;
interface Reply { rows: unknown; fields?: FieldPacket[]; }
const mysql: ForeignKeyNamespaceFacts = { dialect: 'mysql', serverVersion: '8.4.11', compileOs: 'Linux', lowerCaseTableNames: 0 };
const baselines: ForeignKeyNamespaceFacts[] = [
  { ...mysql, serverVersion: '5.7.44' }, { ...mysql, serverVersion: '8.0.46' }, mysql,
  { ...mysql, dialect: 'mariadb', serverVersion: '10.11.19-MariaDB-ubu2204', compileOs: 'debian-linux-gnu' },
  { ...mysql, dialect: 'mariadb', serverVersion: '11.4.13-MariaDB-ubu2404', compileOs: 'debian-linux-gnu' }
];

/** 四套合成目录在结构上真实闭合；测试数据不是从服务器采集的实证。 */
function catalog(count = 1, facts = mysql): ForeignKeyNamespaceInput {
  const modern = facts.dialect === 'mysql' && !facts.serverVersion.startsWith('5.7.');
  const result: ForeignKeyNamespaceInput = { facts: { ...facts }, readComplete: { headers: true, nativeColumns: true, rc: true, kcu: true }, headers: [], nativeColumns: [], rc: [], kcu: [] };
  for (let i = 0; i < count; i++) {
    const constraint = `fk_${String(i).padStart(4, '0')}`, id = `db/${constraint}`;
    (result.headers as Row[]).push({ ID: id, FOR_NAME: 'db/child', REF_NAME: 'other/parent', N_COLS: 1, TYPE: modern ? 48 : 0 });
    (result.nativeColumns as Row[]).push({ ID: id, FOR_COL_NAME: 'child_id', REF_COL_NAME: 'id', POS: modern ? 1 : 0 });
    (result.rc as Row[]).push({ CONSTRAINT_SCHEMA: 'db', CONSTRAINT_NAME: constraint, TABLE_NAME: 'child', UNIQUE_CONSTRAINT_SCHEMA: 'other', REFERENCED_TABLE_NAME: 'parent', MATCH_OPTION: 'NONE', UPDATE_RULE: modern ? 'NO ACTION' : 'RESTRICT', DELETE_RULE: modern ? 'NO ACTION' : 'RESTRICT', UNIQUE_CONSTRAINT_NAME: 'PRIMARY' });
    (result.kcu as Row[]).push({ CONSTRAINT_SCHEMA: 'db', CONSTRAINT_NAME: constraint, TABLE_SCHEMA: 'db', TABLE_NAME: 'child', COLUMN_NAME: 'child_id', ORDINAL_POSITION: 1, REFERENCED_TABLE_SCHEMA: 'other', REFERENCED_TABLE_NAME: 'parent', REFERENCED_COLUMN_NAME: 'id', POSITION_IN_UNIQUE_CONSTRAINT: 1 });
  }
  return result;
}
/** 模拟协议字段名，空目录也须提供服务端实际返回的列描述。 */
function fields(sql: string): FieldPacket[] {
  return [...sql.split(' FROM ')[0].matchAll(/\bAS ([A-Za-z_]+)/g)].map(match => ({ name: match[1] }) as FieldPacket);
}

/** 不替换 structureTaskQuery，使用实际回调、取消监听与命令终态清理路径。 */
function host(input = catalog(), hook?: (sql: string, factsRead: number) => Reply | void) {
  const commands: string[] = [], controller = new AbortController(), cancelled = new Error('单元任务已取消');
  const connection = new EventEmitter(); let factsRead = 0, requested = false;
  const managed = { connection, signal: controller.signal, broken: false, status: { version: input.facts.serverVersion, dialect: input.facts.dialect } } as unknown as ManagedConnection;
  const finished = vi.fn();
  const context: StructureTaskContext = { managed, checkCancelled: () => { if (requested || controller.signal.aborted) throw cancelled; }, report: vi.fn(), commandStarted: () => finished };
  Object.assign(connection, { query(sql: string, callback: (error: Error | null, rows?: unknown, fields?: FieldPacket[]) => void) {
    commands.push(sql);
    queueMicrotask(() => {
      try {
        if (sql.includes('@@version_compile_os')) factsRead++;
        const altered = hook?.(sql, factsRead);
        if (altered) { callback(null, altered.rows, altered.fields ?? fields(sql)); return; }
        if (sql.includes('@@version_compile_os')) { callback(null, [{ compileOs: input.facts.compileOs, lowerCaseTableNames: input.facts.lowerCaseTableNames }], fields(sql)); return; }
        const table = /FROM information_schema\.([A-Z_]+)/.exec(sql)?.[1];
        const key = table === 'INNODB_FOREIGN' || table === 'INNODB_SYS_FOREIGN' ? 'headers' : table === 'INNODB_FOREIGN_COLS' || table === 'INNODB_SYS_FOREIGN_COLS' ? 'nativeColumns' : table === 'REFERENTIAL_CONSTRAINTS' ? 'rc' : table === 'KEY_COLUMN_USAGE' ? 'kcu' : undefined;
        if (!key) throw new Error('测试未安排 SQL 回复');
        const offset = Number(/OFFSET (\d+)$/.exec(sql)?.[1]);
        if (!Number.isInteger(offset) || !sql.includes('LIMIT 128 OFFSET')) throw new Error('分页 SQL 未限定固定批次');
        callback(null, input[key].slice(offset, offset + 128), fields(sql));
      } catch (error) { callback(error as Error); }
    });
  } });
  return { context, commands, finished, connection, controller, cancelled, cancel: () => { requested = true; } };
}
/** 单独算 JSON 计量预期，用于验证预算边界，不使用读取器内部计量实现。 */
function expectedBytes(input: ForeignKeyNamespaceInput): number {
  return ['headers', 'nativeColumns', 'rc', 'kcu'].reduce((sum, key) => sum + 2 + (input[key as 'headers'] as Row[]).reduce((size, row) => size + 3 + Object.entries(row).reduce((n, [field, value]) => n + Buffer.byteLength(JSON.stringify(field)) + Buffer.byteLength(JSON.stringify(value)) + 2, 0), 0), 0);
}

describe('全局外键目录的有界分页读取', () => {
  it.each(baselines)('$dialect $serverVersion 使用精确分支和固定全局字段', async facts => {
    const value = catalog(1, facts), test = host(value); const result = await readForeignKeyNamespace(test.context);
    expect(result.evidence).toEqual(buildForeignKeyNamespaceEvidence(value)); expect(result.bytes).toBe(expectedBytes(value));
    const modern = facts.dialect === 'mysql' && !facts.serverVersion.startsWith('5.7.');
    const sql = test.commands.filter(text => text.includes('information_schema.'));
    expect(sql).toHaveLength(4); expect(sql[0]).toContain(modern ? 'information_schema.INNODB_FOREIGN ORDER BY BINARY ID' : 'information_schema.INNODB_SYS_FOREIGN ORDER BY BINARY ID');
    expect(sql[1]).toContain('ORDER BY BINARY ID, POS');
    expect(sql[2]).toContain('ORDER BY BINARY CONSTRAINT_SCHEMA, BINARY TABLE_NAME, BINARY CONSTRAINT_NAME');
    expect(sql[3]).toContain('WHERE REFERENCED_TABLE_NAME IS NOT NULL ORDER BY BINARY CONSTRAINT_SCHEMA, BINARY TABLE_SCHEMA, BINARY TABLE_NAME, BINARY CONSTRAINT_NAME, ORDINAL_POSITION');
    expect(sql.slice(0, 3).every(text => !text.includes(' WHERE '))).toBe(true);
    expect(test.commands.every(text => text.startsWith('SELECT '))).toBe(true);
    expect(result.warnings.join('')).toContain('外部 DDL'); expect(result.warnings.join('')).toContain('重新读取');
    expect(test.finished).toHaveBeenCalledTimes(6); expect(test.connection.listenerCount('error')).toBe(0); expect(test.connection.listenerCount('end')).toBe(0);
  });
  it.each([0, 127, 128, 129, 256, 1000])('%i 行完整分页以短页确认 EOF，满页继续读取', async count => {
    const test = host(catalog(count)); const result = await readForeignKeyNamespace(test.context);
    expect(result.evidence.kind).toBe('complete');
    if (result.evidence.kind === 'complete') expect(result.evidence.entries).toHaveLength(count);
    const headers = test.commands.filter(sql => /information_schema\.INNODB_FOREIGN ORDER/.test(sql));
    expect(headers.map(sql => Number(/OFFSET (\d+)/.exec(sql)![1]))).toEqual(Array.from({ length: Math.floor(count / 128) + 1 }, (_, i) => i * 128));
  });
  it('外键头预算第 1001 行立即停止，不能丢弃最后行后宣布完整', async () => {
    const test = host(catalog(1001)); const result = await readForeignKeyNamespace(test.context);
    expect(result.evidence).toMatchObject({ kind: 'partial', reason: 'budget' });
    expect(test.commands.some(sql => sql.includes('INNODB_FOREIGN_COLS'))).toBe(false);
    expect(test.commands.at(-1)).toContain('@@version_compile_os');
  });
  it.each([32000, 32001])('原生字段预算 %i 必须查到 EOF 或明确拒绝第 32001 项', async count => {
    const value = catalog(0); value.nativeColumns = Array.from({ length: count }, () => ({ ID: 'd/f', FOR_COL_NAME: 'a', REF_COL_NAME: 'b', POS: 1 }));
    const test = host(value); const result = await readForeignKeyNamespace(test.context);
    // 无头的字段应由闭合模块判为 inconsistent，不能与数量预算误报混淆。
    expect(result.evidence).toMatchObject({ kind: 'partial', reason: count === 32000 ? 'inconsistent' : 'budget' });
    expect(test.commands.some(sql => sql.includes('INNODB_FOREIGN_COLS') && sql.endsWith('OFFSET 32000'))).toBe(true);
  });
  it.each([0, 1])('四目录共享字节预算在 4 MiB + %i 的精确边界检查', async extra => {
    const value = catalog(0); value.headers = [{ ID: '', FOR_NAME: '', REF_NAME: '', N_COLS: 1, TYPE: 0 }];
    value.headers[0].ID = 'x'.repeat(foreignKeyNamespaceLimits.bytes - expectedBytes(value) + extra);
    const test = host(value); const result = await readForeignKeyNamespace(test.context);
    expect(expectedBytes(value)).toBe(foreignKeyNamespaceLimits.bytes + extra);
    // 极长身份本身不是有效目录；精确边界应进入语义拒绝，超一字节则必须提前按预算停止。
    expect(result.evidence).toMatchObject({ kind: 'partial', reason: extra ? 'budget' : 'inconsistent' });
    expect(test.commands.some(sql => sql.includes('INNODB_FOREIGN_COLS'))).toBe(extra === 0);
    expect(result.bytes).toBeLessThanOrEqual(foreignKeyNamespaceLimits.bytes);
  });
  it('JSON 转义及代理字符的字节与冻结模块一致，不能只计原始 UTF-8 长度', async () => {
    const value = catalog(0); value.headers = [{ ID: '\n\u0001"\\😊\uD800界', FOR_NAME: 'd/t', REF_NAME: 'd/p', N_COLS: 1, TYPE: 0 }];
    const result = await readForeignKeyNamespace(host(value).context);
    expect(result.bytes).toBe(expectedBytes(value));
    value.headers[0].ID = '\u0001'.repeat(700000);
    expect((await readForeignKeyNamespace(host(value).context)).evidence).toMatchObject({ kind: 'partial', reason: 'budget' });
  });
  it('预算跨四目录共享而非每目录 4 MiB，RC 过量时不继续缓存 KCU', async () => {
    const value = catalog(1); value.headers[0].ID = 'x'.repeat(2 * 1024 * 1024); value.rc[0].MATCH_OPTION = 'y'.repeat(2 * 1024 * 1024);
    const test = host(value); expect((await readForeignKeyNamespace(test.context)).evidence).toMatchObject({ kind: 'partial', reason: 'budget' });
    expect(test.commands.some(sql => sql.includes('FROM information_schema.KEY_COLUMN_USAGE'))).toBe(false);
  });
  it.each(['headers', 'nativeColumns', 'rc', 'kcu'] as const)('%s 缺少显式字段即 partial，不能由其它目录补造', async key => {
    const value = catalog(); delete value[key][0][Object.keys(value[key][0])[0]];
    expect((await readForeignKeyNamespace(host(value).context)).evidence).toMatchObject({ kind: 'partial', reason: 'inconsistent' });
  });
  it('空回包缺协议列描述，非法超页行数和非数组都不能当 EOF', async () => {
    for (const reply of [{ rows: [], fields: [] }, { rows: {} }, { rows: Array(129).fill({}) }]) {
      const test = host(catalog(0), sql => sql.includes('information_schema.') ? reply : undefined);
      expect((await readForeignKeyNamespace(test.context)).evidence).toMatchObject({ kind: 'partial', reason: 'inconsistent' });
    }
  });
  it.each([1142, 1227, 9999])('读取错误 %i 保持 partial，完整空 RC 不可代替失败原生目录', async errno => {
    const test = host(catalog(0), sql => { if (sql.includes('INNODB_FOREIGN ORDER')) throw Object.assign(new Error('私有账号及路径'), { errno }); });
    const result = await readForeignKeyNamespace(test.context);
    expect(result.evidence).toMatchObject({ kind: 'partial', reason: 'incomplete' }); expect(result.warnings.join('')).not.toContain('私有');
    if (errno !== 9999) expect(result.warnings.join('')).toContain('权限不足');
  });
  it('尚未收到满页后的 EOF 即读错，不能把已有 128 行标记为完成', async () => {
    const test = host(catalog(128), sql => { if (/INNODB_FOREIGN ORDER/.test(sql) && sql.endsWith('OFFSET 128')) throw new Error('后页失败'); });
    expect((await readForeignKeyNamespace(test.context)).evidence).toMatchObject({ kind: 'partial', reason: 'incomplete' });
  });
  it.each(['compileOs', 'lowerCaseTableNames', 'version', 'dialect'] as const)('读取后 %s 漂移必须 partial', async key => {
    const test = host(catalog(0), (sql, number) => {
      if (sql.includes('@@version_compile_os') && number === 2) {
        if (key === 'version') test.context.managed.status.version = '8.4.12';
        if (key === 'dialect') test.context.managed.status.dialect = 'mariadb';
        return { rows: [{ compileOs: key === 'compileOs' ? 'fake-Linux' : 'Linux', lowerCaseTableNames: key === 'lowerCaseTableNames' ? 1 : 0 }] };
      }
    });
    expect((await readForeignKeyNamespace(test.context)).evidence).toMatchObject({ kind: 'partial', reason: 'inconsistent' });
  });
  it.each([{ ...mysql, serverVersion: '8.4.12' }, { ...mysql, compileOs: 'fake-Linux' }, { ...mysql, compileOs: 'debian-linux-gnu' }, { ...mysql, lowerCaseTableNames: 1 }])('未证明规则不开始目录扫描', async facts => {
    const test = host(catalog(0, facts));
    expect((await readForeignKeyNamespace(test.context)).evidence).toMatchObject({ kind: 'partial', reason: 'capability' });
    expect(test.commands).toHaveLength(1);
  });
  it('事实前读缺字段、后读失败都不能形成完整空证明', async () => {
    const before = host(catalog(0), sql => sql.includes('@@version_compile_os') ? { rows: [{ compileOs: 'Linux' }] } : undefined);
    expect((await readForeignKeyNamespace(before.context)).evidence.kind).toBe('partial');
    const after = host(catalog(0), (sql, number) => { if (sql.includes('@@version_compile_os') && number === 2) throw new Error('末尾读错'); });
    expect((await readForeignKeyNamespace(after.context)).evidence).toMatchObject({ kind: 'partial', reason: 'incomplete' });
  });
  it('目录访问器从不调用，引用缺失通过自有描述符检查拒绝', async () => {
    const value = catalog(); let calls = 0;
    Object.defineProperty(value.headers[0], 'ID', { enumerable: true, get() { calls++; return 'db/fk_0000'; } });
    expect((await readForeignKeyNamespace(host(value).context)).evidence.kind).toBe('partial'); expect(calls).toBe(0);
  });
  it('分页中取消直接抛出原任务取消，不能吞成 partial', async () => {
    const test = host(catalog(128)); test.context.report = () => { test.cancel(); };
    await expect(readForeignKeyNamespace(test.context)).rejects.toBe(test.cancelled);
    expect(test.commands.filter(sql => sql.includes('@@version_compile_os'))).toHaveLength(1);
  });
  it('原查询中断的驱动错误同时伴随主任务取消时仍抛取消', async () => {
    const test = host(catalog(), sql => { if (sql.includes('INNODB_FOREIGN ORDER')) { test.controller.abort(); throw new Error('驱动连接中断'); } });
    await expect(readForeignKeyNamespace(test.context)).rejects.toBe(test.cancelled);
    expect(test.connection.listenerCount('error')).toBe(0); expect(test.connection.listenerCount('end')).toBe(0);
  });
});

describe('名称比较沿原结构会话逐批执行', () => {
  it('实际执行冻结计划每批 SQL，按服务器结果合并冲突，不用客户端小写推断', async () => {
    const value = catalog(65), evidence = buildForeignKeyNamespaceEvidence(value), plan = planForeignKeyNameComparisons(evidence, 'db', ['new_fk', 'Other']);
    if (plan.kind !== 'ready') throw new Error('合成目录未形成计划');
    const test = host(value, sql => {
      const query = plan.queries.find(item => item.sql === sql);
      if (query) return { rows: query.candidateOrdinals.map(candidateOrdinal => ({ candidateOrdinal: String(candidateOrdinal), matched: candidateOrdinal === 1 ? '1' : '0' })) };
    });
    const result = await compareForeignKeyNames(test.context, evidence, 'db', ['new_fk', 'Other']);
    expect([...result]).toEqual([['new_fk', 'available'], ['Other', 'conflict']]);
    expect(test.commands.slice(1, -1)).toEqual(plan.queries.map(query => query.sql));
  });
  it('任意批缺行、缺协议字段、重复序号或读错均不能用前批无冲突宣布 available', async () => {
    for (const bad of ['empty', 'fields', 'duplicate', 'error']) {
      const value = catalog(65), evidence = buildForeignKeyNamespaceEvidence(value), plan = planForeignKeyNameComparisons(evidence, 'db', ['new_fk', 'next_fk']);
      if (plan.kind !== 'ready') throw new Error('合成目录未形成计划');
      let count = 0;
      const test = host(value, sql => {
        const query = plan.queries.find(item => item.sql === sql); if (!query) return;
        count++;
        if (count === 2) {
          if (bad === 'error') throw new Error('比较回包丢失');
          if (bad === 'fields') return { rows: query.candidateOrdinals.map(candidateOrdinal => ({ candidateOrdinal, matched: 0 })), fields: [] };
          if (bad === 'duplicate') return { rows: [{ candidateOrdinal: 0, matched: 0 }, { candidateOrdinal: 0, matched: 0 }] };
          return { rows: [] };
        }
        return { rows: query.candidateOrdinals.map(candidateOrdinal => ({ candidateOrdinal, matched: 0 })) };
      });
      expect([...(await compareForeignKeyNames(test.context, evidence, 'db', ['new_fk', 'next_fk'])).values()]).toEqual(['unknown', 'unknown']);
    }
  });
  it('partial 不执行 SQL；完整空目录的单名结论仍须核对前后事实', async () => {
    const value = catalog(0), partial = buildForeignKeyNamespaceEvidence({ ...value, readComplete: { ...value.readComplete, rc: false } }), first = host(value);
    expect((await compareForeignKeyNames(first.context, partial, 'db', ['new_fk'])).get('new_fk')).toBe('unknown'); expect(first.commands).toEqual([]);
    const second = host(value); expect((await compareForeignKeyNames(second.context, buildForeignKeyNamespaceEvidence(value), 'db', ['new_fk'])).get('new_fk')).toBe('available');
    expect(second.commands).toHaveLength(2); expect(second.commands.every(sql => sql.includes('@@version_compile_os'))).toBe(true);
  });
  it.each([1, 2])('第 %i 次事实与证据不符时包括已知冲突也降为 unknown', async position => {
    const value = catalog(0), evidence = buildForeignKeyNamespaceEvidence(value);
    const test = host(value, (sql, count) => sql.includes('@@version_compile_os') && count === position ? { rows: [{ compileOs: 'Linux', lowerCaseTableNames: 1 }] } : undefined);
    expect((await compareForeignKeyNames(test.context, evidence, 'db', ['new_fk'])).get('new_fk')).toBe('unknown');
  });
  it('名称比较时取消仍抛出，不把 unknown 当成任务成功完成', async () => {
    const value = catalog(), evidence = buildForeignKeyNamespaceEvidence(value);
    const test = host(value, sql => { if (sql.includes('CROSS JOIN')) { test.cancel(); throw new Error('驱动中断'); } });
    await expect(compareForeignKeyNames(test.context, evidence, 'db', ['new_fk'])).rejects.toBe(test.cancelled);
  });
});
