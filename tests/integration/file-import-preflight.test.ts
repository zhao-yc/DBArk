import { randomUUID, createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ReadStream } from 'node:fs';
import iconv from 'iconv-lite';
import { describe, expect, it, vi } from 'vitest';
import type { CommandMap, DataRow, TaskEvent } from '../../src/shared/contracts';
import type { FileImportPreflightReport } from '../../src/shared/fileImportPreflight';
import { ConflictFixture, conflictFile, type ConflictCommand } from '../helpers/fileImportConflictIntegration';

const audit = vi.hoisted(() => ({ watch: undefined as ((path: unknown, stream: ReadStream) => void) | undefined }));
vi.mock('node:fs', async original => { const actual = await original<typeof import('node:fs')>(); return { ...actual, createReadStream: (...args: Parameters<typeof actual.createReadStream>) => { const stream = actual.createReadStream(...args); audit.watch?.(args[0], stream); return stream; } }; });
const listing = process.argv.some(value => value === 'list' || value === '--list' || value.startsWith('--list='));
const enabled = !listing && process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_FILE_IMPORT_PREFLIGHT_INTEGRATION === '1';
const columns = ['n', 'amount', 'note', 'payload'];
/** 只登记有界统计与固定原因，不输出文件正文或字段值。 */
function summary(report: FileImportPreflightReport) {
  console.log(JSON.stringify({ 专项: '整文件预检', taskId: report.taskId, checkedRecords: report.checkedRecords, validRecords: report.validRecords, invalidRecords: report.invalidRecords, issueCount: report.issueCount, details: report.issues.length, truncated: report.truncated, termination: report.termination, complete: report.complete }));
}
/** 沿既有owner库及收尾门；失败保留，不能绕过原命令end和物理close。 */
async function scenario(body: (owner: ConflictFixture, ended: Set<ConflictCommand>) => Promise<void>) {
  const owner = new ConflictFixture(), ended = new Set<ConflictCommand>(); let failure: unknown;
  try { await owner.start(); audit.watch = owner.watch.bind(owner); owner.onCommandEnd = (_fact, command) => { ended.add(command); }; await body(owner, ended); }
  catch (error) { failure = error; }
  try { await owner.finish(); } catch (cleanup) { if (failure) throw new AggregateError([failure, cleanup], '预检原案例及资源收尾失败', { cause: failure }); throw cleanup; }
  finally { audit.watch = undefined; }
  if (failure) throw failure;
}
/** 输入文件独占登记后才允许真实读取，Engine路径由本层模拟已授权Main注入。 */
async function request(owner: ConflictFixture, scope: string, table: string, source: string, format: 'csv' | 'json' = 'csv', encoding: 'utf8' | 'utf16le' | 'gb18030' = 'utf8', selected = columns) {
  const filePath = join(owner.directory, scope + '.' + format), bytes = iconv.encode(source, encoding); owner.files.set(filePath, bytes); await writeFile(filePath, bytes, { flag: 'wx' });
  const input = { connectionId: owner.profile.id, database: owner.database, table, taskId: randomUUID(), fileToken: randomUUID(), filePath, format, encoding, mapping: Object.fromEntries(selected.map(name => [name, name])) };
  return { input: input as CommandMap['files.preflight']['input'], taskId: input.taskId, bytes };
}
/** 每个预检scope只准真实目录SHOW/SELECT；控制取消的KILL在独立scope审计。 */
async function readOnly(owner: ConflictFixture, scope: string, table: string, ended: Set<ConflictCommand>) {
  const facts = owner.facts.filter(fact => fact.scope === scope); expect(facts).toHaveLength(1);
  await vi.waitFor(() => expect(facts.every(fact => fact.closed && fact.commands.every(command => command.ended && ended.has(command)))).toBe(true), { timeout: 5000, interval: 50 });
  expect(facts[0].commands.length).toBeGreaterThan(0);
  for (const command of facts[0].commands) {
    expect(command.errno).toBeUndefined(); expect(command.sql).not.toMatch(/^(?:INSERT|UPDATE|DELETE|REPLACE|START|BEGIN|COMMIT|ROLLBACK|SET)\b/i);
    expect(command.sql === 'SHOW CREATE TABLE ' + owner.table(table) || command.sql === 'SELECT @@SESSION.sql_mode AS mode' || /^SELECT\b/i.test(command.sql) && /\bFROM information_schema\./i.test(command.sql)).toBe(true);
  }
}
/** 观察者精确比较原行及完整定义，证明产品预检未写入目标。 */
async function snapshot(owner: ConflictFixture, table: string) {
  return { ddl: await owner.sql('SHOW CREATE TABLE ' + owner.table(table)), rows: await owner.sql('SELECT CAST(n AS CHAR) AS n,CAST(amount AS CHAR) AS amount,note,HEX(payload) AS payload FROM ' + owner.table(table) + ' ORDER BY n') };
}
/** 独立准备SQL不从被测导出器生成，数据不包含真实业务信息。 */
async function subject(owner: ConflictFixture, table: string) {
  await owner.sql('CREATE TABLE ' + owner.table(table) + ' (n BIGINT UNSIGNED NOT NULL PRIMARY KEY,amount DECIMAL(30,12) NULL,note TEXT NULL,payload BLOB NULL) ENGINE=InnoDB');
  await owner.sql('INSERT INTO ' + owner.table(table) + " VALUES (7,1.25,'原行',X'00FF')");
}

describe.skipIf(!enabled)('CSV/JSON整文件预检六实例真实Engine专项（默认关闭）', () => {
  it('真实编码、精度、NULL/BLOB与多行记录，第21条之后多字段错误602计数200明细且零写入', async () => scenario(async (owner, ended) => {
    await subject(owner, 'values_target'); const before = await snapshot(owner, 'values_target');
    const valid: DataRow = { n: '18446744073709551615', amount: '9007199254740993.123456789012', note: '中文,"引号"\r\n跨行', payload: { type: 'binary', base64: 'AP8=' } };
    for (const [format, encoding] of [['csv', 'utf16le'], ['json', 'gb18030']] as const) {
      const scope = format + '_values', source = conflictFile([valid, { ...valid, amount: null, note: null, payload: null }], columns, format), item = await request(owner, scope, 'values_target', source, format, encoding);
      const report = await owner.invoke('files.preflight', item.input, scope);
      expect(report).toMatchObject({ checkedRecords: 2, validRecords: 2, invalidRecords: 0, issueCount: 0, complete: true, sourceBytes: item.bytes.length, sourceFingerprint: createHash('sha256').update(item.bytes).digest('hex') }); summary(report);
      await readOnly(owner, scope, 'values_target', ended); expect(await snapshot(owner, 'values_target')).toEqual(before);
    }
    const rows = [...Array.from({ length: 21 }, () => ({ ...valid })), ...Array.from({ length: 301 }, () => ({ ...valid, n: '私密坏整数', amount: '私密坏小数' }))];
    const item = await request(owner, 'many_errors', 'values_target', conflictFile(rows, columns, 'csv'));
    const report = await owner.invoke('files.preflight', item.input, 'many_errors');
    expect(report).toMatchObject({ checkedRecords: 322, validRecords: 21, invalidRecords: 301, issueCount: 602, complete: true, truncated: true });
    expect(report.issues).toHaveLength(200); expect(report.issues.slice(0, 2).map(issue => [issue.record, issue.target])).toEqual([[22, 'n'], [22, 'amount']]);
    expect(JSON.stringify(report)).not.toMatch(/私密坏整数|私密坏小数/); summary(report);
    await readOnly(owner, 'many_errors', 'values_target', ended); expect(await snapshot(owner, 'values_target')).toEqual(before);
  }), 120000);

  it('真实唯一键及外键不冒充预检保证，解析失败无虚构记录号且保持目标', async () => scenario(async (owner, ended) => {
    await owner.sql('CREATE TABLE ' + owner.table('parent_target') + ' (id INT PRIMARY KEY) ENGINE=InnoDB');
    await subject(owner, 'constraints_target');
    await owner.sql('ALTER TABLE ' + owner.table('constraints_target') + ' ADD parent_id INT NULL, ADD UNIQUE KEY uq_amount(amount), ADD CONSTRAINT fk_parent FOREIGN KEY(parent_id) REFERENCES ' + owner.table('parent_target') + '(id)');
    const before = await snapshot(owner, 'constraints_target');
    const source = '[{"n":7,"amount":1.25,"note":"类型合法但主键重复","payload":null,"parent_id":999}]';
    const item = await request(owner, 'constraints_only', 'constraints_target', source, 'json', 'utf8', [...columns, 'parent_id']);
    const report = await owner.invoke('files.preflight', item.input, 'constraints_only');
    expect(report).toMatchObject({ checkedRecords: 1, validRecords: 1, issueCount: 0, complete: true }); expect(report.warnings.join(' ')).toMatch(/唯一键.*外键.*CHECK.*触发器/); summary(report);
    await readOnly(owner, 'constraints_only', 'constraints_target', ended); expect(await snapshot(owner, 'constraints_target')).toEqual(before);
    const broken = await request(owner, 'parse_failure', 'constraints_target', 'n,amount,note,payload\r\n8,2,"未闭合', 'csv');
    const failed = await owner.invoke('files.preflight', broken.input, 'parse_failure');
    expect(failed).toMatchObject({ complete: false, termination: 'parse-error', sourceFingerprint: null });
    const issue = failed.issues.find(issue => issue.code === 'parse-error'); expect(issue).toBeDefined(); expect(issue).not.toHaveProperty('record'); summary(failed);
    await readOnly(owner, 'parse_failure', 'constraints_target', ended); expect(await snapshot(owner, 'constraints_target')).toEqual(before);
  }), 120000);

  it('原查询事务保持，真实128条进度触发一次取消并等RPC/物理资源及原文件关闭', async () => scenario(async (owner, ended) => {
    await subject(owner, 'cancel_target'); const original = await snapshot(owner, 'cancel_target');
    const session = await owner.invoke('sessions.open', { connectionId: owner.profile.id }, 'original-session');
    await owner.invoke('query.transaction', { sessionId: session.sessionId, action: 'begin' }, 'original-transaction');
    const state = await owner.invoke('query.sessionState', { sessionId: session.sessionId }); expect(state).toMatchObject({ transactionOpen: true, transactionKnown: true, broken: false });
    const sessionFact = owner.facts.find(fact => fact.scope === 'original-session')!; expect(sessionFact).toBeDefined(); const originalCommands = sessionFact.commands.length;
    const item = await request(owner, 'cancel_scan', 'cancel_target', 'n,amount,note,payload\r\n' + '8,2,本地扫描,\\N\r\n'.repeat(20000));
    let cancellation: Promise<void> | undefined, cancelCount = 0;
    const push = owner.events.push.bind(owner.events);
    // 只旁听真实进度事件并发一次原RPC，不暂停或替换产品扫描、网络命令与Promise。
    const spy = vi.spyOn(owner.events, 'push').mockImplementation((...events: TaskEvent[]) => {
      const length = push(...events);
      if (!cancellation && events.some(event => event.taskId === item.taskId && (event.rows ?? 0) >= 128 && event.status === 'running')) { cancelCount++; cancellation = owner.invoke('query.cancel', { taskId: item.taskId }, 'cancel-control'); void cancellation.catch(() => undefined); }
      return length;
    });
    try {
      const pending = owner.invoke('files.preflight', item.input, 'cancel_scan');
      await expect(pending).rejects.toThrow(/取消|中止/); expect(cancelCount).toBe(1); expect(cancellation).toBeDefined(); await cancellation;
      await readOnly(owner, 'cancel_scan', 'cancel_target', ended);
      const controls = owner.facts.filter(fact => fact.scope === 'cancel-control'); expect(controls).toHaveLength(1);
      expect(controls[0].commands.map(command => command.sql)).toEqual(['KILL CONNECTION ' + owner.facts.find(fact => fact.scope === 'cancel_scan')!.id]);
      await vi.waitFor(() => expect(controls.every(fact => fact.closed && fact.commands.every(command => command.ended && ended.has(command)))).toBe(true), { timeout: 5000, interval: 50 });
      expect(owner.fileStreams.length).toBeGreaterThan(0); await vi.waitFor(() => expect(owner.fileStreams.every(fact => fact.closed && fact.stream.closed)).toBe(true), { timeout: 5000, interval: 50 });
      expect((owner.engine as any).independentTasks.size).toBe(0); expect((owner.engine as any).independentResources.owns(item.taskId)).toBe(false);
      expect(await owner.invoke('query.sessionState', { sessionId: session.sessionId })).toEqual(state); expect(sessionFact.commands).toHaveLength(originalCommands); expect(sessionFact.closed).toBe(false);
      expect(await snapshot(owner, 'cancel_target')).toEqual(original);
    } finally { spy.mockRestore(); if (cancellation) await cancellation; await owner.invoke('query.transaction', { sessionId: session.sessionId, action: 'rollback' }, 'original-rollback'); }
  }), 120000);
});
