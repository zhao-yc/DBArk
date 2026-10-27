import { randomUUID } from 'node:crypto';
import type { ReadStream } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { DataRow } from '../../src/shared/contracts';
import type { FileImportConflictCounts, FileImportConflictSelection } from '../../src/shared/fileImportConflict';
import { fileImportKeyCatalogSchema } from '../../src/shared/fileImportConflict';
import { execute } from '../../src/engine/connection';
import { ConflictFixture, conflictReport } from '../helpers/fileImportConflictIntegration';

const audit = vi.hoisted(() => ({ watch: undefined as ((path: unknown, stream: ReadStream) => void) | undefined }));
vi.mock('node:fs', async original => { const actual = await original<typeof import('node:fs')>(); return { ...actual, createReadStream: (...args: Parameters<typeof actual.createReadStream>) => { const stream = actual.createReadStream(...args); audit.watch?.(args[0], stream); return stream; } }; });
const listing = process.argv.some(value => value === 'list' || value === '--list' || value.startsWith('--list='));
const enabled = !listing && process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_FILE_IMPORT_CONFLICT_INTEGRATION === '1';
const columns = ['tenant', 'k', 'alt', 'amount', 'n', 'note', 'payload'];
const zero = (): FileImportConflictCounts => ({ inserted: 0, matchedUpdates: 0, skippedExisting: 0, skippedMissing: 0 });
/** 合成精确数值直接写成文本，期望不通过产品序列化器生成。 */
function row(k: string, alt: string, amount = '9007199254740993.123456789012'): DataRow { return { tenant: 1, k, alt, amount, n: '18446744073709551615', note: '中文😀,"引号"\r\n跨行', payload: { type: 'binary', base64: 'AP8=' } }; }
/** 每例独立目标；未映射列及生成列用于识别隐式覆盖和错误赋值。 */
async function subject(owner: ConflictFixture, name: string, seed = true) {
  await owner.sql('CREATE TABLE ' + owner.table(name) + " (tenant INT NOT NULL,k VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,alt VARCHAR(32) NOT NULL,amount DECIMAL(30,12) NOT NULL DEFAULT 0,n BIGINT UNSIGNED NOT NULL DEFAULT 0,note TEXT NULL,payload BLOB NULL,untouched VARCHAR(32) NOT NULL DEFAULT '保持原值',generated_n INT GENERATED ALWAYS AS (tenant+1) STORED,PRIMARY KEY(tenant,k),UNIQUE KEY uq_alt(alt)) ENGINE=InnoDB");
  if (seed) await owner.sql('INSERT INTO ' + owner.table(name) + " (tenant,k,alt) VALUES (1,'Alpha','u1'),(1,'Beta','u2')");
}
/** 原错误和收尾错误均保留；失败不重跑或另开连接补偿删除。 */
async function scenario(body: (owner: ConflictFixture) => Promise<void>) {
  const owner = new ConflictFixture(); let failure: unknown;
  try { await owner.start(); audit.watch = owner.watch.bind(owner); await body(owner); } catch (error) { failure = error; }
  try { await owner.finish(); } catch (cleanup) { if (failure) throw new AggregateError([failure, cleanup], '冲突导入原案例及资源收尾失败', { cause: failure }); throw cleanup; }
  finally { audit.watch = undefined; }
  if (failure) throw failure;
}

describe.skipIf(!enabled)('CSV/JSON冲突处理六实例真实Engine专项（默认关闭）', () => {
  it('四模式、源重复与noop、服务器collation、双unique错误及精度和保留列', async () => scenario(async owner => {
    for (const format of ['csv', 'json'] as const) for (const mode of ['insert', 'skip-existing', 'upsert', 'update-existing'] as const) {
      const name = format + '_' + mode.replaceAll('-', '_'); await subject(owner, name);
      const selection = mode === 'insert' ? undefined : await owner.key(name, mode);
      const last = row('ALPHA', 'u1', '9007199254740994.123456789013');
      const source = [row('alpha', 'u1'), row('Gamma', 'u3', '-9007199254740993.123456789011'), last, { ...last }];
      const result = await owner.run(name, name, source, columns, format, selection);
      if (mode === 'insert') { expect(result.conflicts).toBeUndefined(); expect(result.errors).toHaveLength(1); expect((await owner.sql('SELECT k FROM ' + owner.table(name) + ' ORDER BY k')).map(value => value.k)).toEqual(['Alpha', 'Beta']); continue; }
      const expected = mode === 'skip-existing' ? { ...zero(), inserted: 1, skippedExisting: 3 } : mode === 'upsert' ? { ...zero(), inserted: 1, matchedUpdates: 3 } : { ...zero(), matchedUpdates: 3, skippedMissing: 1 };
      expect(conflictReport(result)).toMatchObject({ mode, termination: 'completed', readRecords: 4, acknowledged: expected, committed: expected, currentBatch: 'none' });
      const actual = await owner.sql('SELECT k,CAST(amount AS CHAR) AS amount,CAST(n AS CHAR) AS n,HEX(payload) AS payload,untouched,generated_n FROM ' + owner.table(name) + " WHERE tenant=1 AND k='alpha'");
      expect(actual).toEqual([{ k: 'Alpha', amount: mode === 'skip-existing' ? '0.000000000000' : '9007199254740994.123456789013', n: mode === 'skip-existing' ? '0' : '18446744073709551615', payload: mode === 'skip-existing' ? null : '00FF', untouched: '保持原值', generated_n: 2 }]);
      const updates = owner.facts.filter(fact => fact.scope === name).flatMap(fact => fact.commands).filter(command => /^UPDATE /i.test(command.sql));
      for (const command of updates) { const assignment = /\bSET\b([\s\S]*?)\bWHERE\b/i.exec(command.sql)?.[1]; expect(assignment).toBeDefined(); expect(assignment).not.toMatch(/`(?:tenant|k|untouched|generated_n)`\s*=/i); }
      expect(await owner.sql('SELECT k FROM ' + owner.table(name) + " WHERE k='Gamma'")).toHaveLength(mode === 'update-existing' ? 0 : 1);
    }
    for (const format of ['csv', 'json'] as const) {
      const name = format + '_other_unique'; await subject(owner, name); const key = await owner.key(name, 'upsert');
      for (const [label, source, stage] of [['matched', row('alpha', 'u2'), 'update'], ['missing', row('Gamma', 'u1'), 'insert']] as const) {
        const task = name + '_' + label, report = conflictReport(await owner.run(task, name, [source], columns, format, key));
        expect(report).toMatchObject({ termination: 'failed', readRecords: 1, acknowledged: zero(), committed: zero(), currentBatch: 'rolled-back', failure: { stage, record: 1 } });
        expect(owner.facts.filter(fact => fact.scope === task).flatMap(fact => fact.commands).some(command => command.errno === 1062 && command.ended)).toBe(true);
        expect(await owner.sql('SELECT k,alt,untouched FROM ' + owner.table(name) + ' ORDER BY k')).toEqual([{ k: 'Alpha', alt: 'u1', untouched: '保持原值' }, { k: 'Beta', alt: 'u2', untouched: '保持原值' }]);
      }
    }
    await subject(owner, 'composite_identity');
    await owner.sql('INSERT INTO ' + owner.table('composite_identity') + " (tenant,k,alt) VALUES(2,'Alpha','tenant-two')");
    expect(conflictReport(await owner.run('composite_identity', 'composite_identity', [{ ...row('alpha', 'tenant-two', '77'), tenant: 2 }], columns, 'json', await owner.key('composite_identity', 'upsert')))).toMatchObject({ committed: { ...zero(), matchedUpdates: 1 } });
    expect(await owner.sql('SELECT tenant,k,CAST(amount AS CHAR) AS amount FROM ' + owner.table('composite_identity') + " WHERE k='alpha' ORDER BY tenant")).toEqual([{ tenant: 1, k: 'Alpha', amount: '0.000000000000' }, { tenant: 2, k: 'Alpha', amount: '77.000000000000' }]);
    await subject(owner, 'binary_collation'); await owner.sql('ALTER TABLE ' + owner.table('binary_collation') + ' MODIFY k VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL');
    expect(conflictReport(await owner.run('binary_collation', 'binary_collation', [row('alpha', 'u3', '8')], columns, 'csv', await owner.key('binary_collation', 'upsert')))).toMatchObject({ committed: { ...zero(), inserted: 1 } });
    expect(await owner.sql('SELECT k,CAST(amount AS CHAR) AS amount FROM ' + owner.table('binary_collation') + " WHERE k IN('Alpha','alpha') ORDER BY BINARY k")).toEqual([{ k: 'Alpha', amount: '0.000000000000' }, { k: 'alpha', amount: '8.000000000000' }]);
  }), 180000);

  it('目录拒绝无键/可空/前缀/表达式/生成键，完整unique可显式选，旧hash和NULL不写入', async () => scenario(async owner => {
    const definitions = [
      ['no_key', 'k VARCHAR(32) NOT NULL,v INT'], ['nullable_key', 'k VARCHAR(32) NULL,v INT,UNIQUE KEY uq_k(k)'],
      ['prefix_key', 'k VARCHAR(32) NOT NULL,v INT,UNIQUE KEY uq_k(k(3))'],
      ['generated_key', 'k VARCHAR(32) NOT NULL,g VARCHAR(32) GENERATED ALWAYS AS (LOWER(k)) STORED,v INT,UNIQUE KEY uq_k(g)'],
    ];
    if (owner.observer!.status.dialect === 'mysql' && /^8\./.test(owner.observer!.status.version)) definitions.push(['functional_key', 'k VARCHAR(32) NOT NULL,v INT,UNIQUE KEY uq_k((LOWER(k)))']);
    for (const [name, definition] of definitions) {
      await owner.sql('CREATE TABLE ' + owner.table(name) + ' (' + definition + ') ENGINE=InnoDB');
      const catalog = fileImportKeyCatalogSchema.parse(await owner.invoke('files.importKeys', { connectionId: owner.profile.id, database: owner.database, table: name, taskId: randomUUID() }));
      expect(catalog.keys.filter(key => key.reliable)).toEqual([]);
      for (const key of catalog.keys) expect(key.reason).toBeTruthy();
      const forged: FileImportConflictSelection = { mode: 'upsert', schemaHash: catalog.schemaHash, key: { name: catalog.keys[0]?.name ?? 'PRIMARY', columns: catalog.keys[0]?.columns.length ? catalog.keys[0].columns : ['k'] } };
      expect(conflictReport(await owner.run(name, name, [{ k: 'abc-one', v: 1 }], ['k', 'v'], 'csv', forged))).toMatchObject({ termination: 'failed', acknowledged: zero(), committed: zero(), failure: { stage: 'prepare-batch' } });
      expect(await owner.sql('SELECT * FROM ' + owner.table(name))).toEqual([]);
    }
    await owner.sql('CREATE TABLE ' + owner.table('unique_only') + ' (tenant INT NOT NULL,k VARCHAR(32) NOT NULL,v INT,UNIQUE KEY uq_k(tenant,k)) ENGINE=InnoDB');
    const unique = await owner.key('unique_only', 'upsert', 'uq_k');
    expect(conflictReport(await owner.run('unique_only', 'unique_only', [{ tenant: 1, k: 'x', v: 7 }], ['tenant', 'k', 'v'], 'json', unique))).toMatchObject({ termination: 'completed', committed: { ...zero(), inserted: 1 } });
    await subject(owner, 'stale'); const stale = await owner.key('stale', 'upsert'); await owner.sql('ALTER TABLE ' + owner.table('stale') + ' ADD COLUMN later INT NULL');
    expect(conflictReport(await owner.run('stale', 'stale', [row('Gamma', 'u3')], columns, 'csv', stale))).toMatchObject({ termination: 'failed', acknowledged: zero(), failure: { stage: 'prepare-batch' } });
    await subject(owner, 'null_key'); const valid = await owner.key('null_key', 'upsert');
    expect(conflictReport(await owner.run('null_key', 'null_key', [{ ...row('x', 'u3'), k: null }], columns, 'json', valid))).toMatchObject({ termination: 'failed', readRecords: 1, acknowledged: zero(), failure: { stage: 'record', record: 1 } });
  }), 120000);

  it('551真实错误保留550ACK与500批次提交，atomic零提交；500处理边界包含跳过', async () => scenario(async owner => {
    for (const format of ['csv', 'json'] as const) for (const transactionMode of ['batch', 'atomic'] as const) {
      const name = format + '_' + transactionMode + '_551'; await subject(owner, name, false);
      const rows = Array.from({ length: 550 }, (_, index) => row('row-' + (index + 1), 'u-' + (index + 1))); rows.push(row('row-551', 'u-1'));
      const report = conflictReport(await owner.run(name, name, rows, columns, format, await owner.key(name, 'upsert'), transactionMode));
      expect(report).toMatchObject({ termination: 'failed', readRecords: 551, acknowledged: { ...zero(), inserted: 550 }, committed: { ...zero(), inserted: transactionMode === 'batch' ? 500 : 0 }, currentBatch: 'rolled-back', failure: { stage: 'insert', record: 551 } });
      expect(await owner.sql('SELECT CAST(COUNT(*) AS CHAR) AS n FROM ' + owner.table(name))).toEqual([{ n: transactionMode === 'batch' ? '500' : '0' }]);
      const commands = owner.facts.filter(fact => fact.scope === name).flatMap(fact => fact.commands);
      expect(commands.filter(command => command.sql === 'COMMIT' && command.ended)).toHaveLength(transactionMode === 'batch' ? 1 : 0); expect(commands.filter(command => command.sql === 'ROLLBACK' && command.ended)).toHaveLength(1);
    }
    await subject(owner, 'skip_boundary'); const report = conflictReport(await owner.run('skip_boundary', 'skip_boundary', Array.from({ length: 501 }, () => row('alpha', 'u1')), columns, 'csv', await owner.key('skip_boundary', 'skip-existing'), 'batch'));
    expect(report).toMatchObject({ termination: 'completed', readRecords: 501, acknowledged: { ...zero(), skippedExisting: 501 }, committed: { ...zero(), skippedExisting: 501 } });
    expect(owner.facts.filter(fact => fact.scope === 'skip_boundary').flatMap(fact => fact.commands).filter(command => command.sql === 'COMMIT' && command.ended)).toHaveLength(2);
  }), 240000);

  it('真实行锁等待保留并发未映射列，原任务取消回滚，批边界DDL后拒绝旧键', async () => scenario(async owner => {
    await subject(owner, 'concurrent'); const selection = await owner.key('concurrent', 'upsert'), writer = await owner.actor('writer');
    await owner.sql('START TRANSACTION', [], writer); await owner.sql('UPDATE ' + owner.table('concurrent') + " SET untouched='并发保留' WHERE tenant=1 AND k='Alpha'", [], writer);
    let pending: Promise<unknown> | undefined;
    try {
      pending = owner.run('concurrent-update', 'concurrent', [row('alpha', 'u1')], columns, 'csv', selection); void pending.catch(() => undefined);
      await vi.waitFor(async () => { const fact = owner.facts.find(fact => fact.scope === 'concurrent-update' && fact.commands.some(command => /FOR UPDATE/i.test(command.sql) && !command.ended)); expect(fact).toBeDefined(); expect(await owner.sql('SELECT ID FROM information_schema.PROCESSLIST WHERE ID=? AND INFO IS NOT NULL', [fact!.id])).toHaveLength(1); }, { timeout: 5000, interval: 50 });
      await owner.sql('COMMIT', [], writer); expect(conflictReport(await pending as Awaited<ReturnType<ConflictFixture['run']>>)).toMatchObject({ termination: 'completed', committed: { ...zero(), matchedUpdates: 1 } });
      expect(await owner.sql('SELECT untouched FROM ' + owner.table('concurrent') + " WHERE k='Alpha'")).toEqual([{ untouched: '并发保留' }]);
    } finally { await owner.sql('ROLLBACK', [], writer); if (pending) await Promise.allSettled([pending]); }
    await owner.sql('START TRANSACTION', [], writer); await owner.sql('SELECT tenant FROM ' + owner.table('concurrent') + " WHERE tenant=1 AND k='Alpha' FOR UPDATE", [], writer);
    const taskId = randomUUID(); let cancelled: ReturnType<ConflictFixture['run']> | undefined;
    try {
      cancelled = owner.run('real-lock-cancel', 'concurrent', [row('alpha', 'u1')], columns, 'json', selection, 'atomic', taskId); void cancelled.catch(() => undefined);
      await vi.waitFor(async () => { const fact = owner.facts.find(fact => fact.scope === 'real-lock-cancel' && fact.commands.some(command => /FOR UPDATE/i.test(command.sql) && !command.ended)); expect(fact).toBeDefined(); expect(await owner.sql('SELECT ID FROM information_schema.PROCESSLIST WHERE ID=? AND INFO LIKE ?', [fact!.id, '%FOR UPDATE%'])).toHaveLength(1); }, { timeout: 5000, interval: 50 });
      await owner.invoke('query.cancel', { taskId }); const report = conflictReport(await cancelled);
      expect(report).toMatchObject({ taskId, termination: 'cancelled', readRecords: 1, acknowledged: zero(), committed: zero(), currentBatch: 'rolled-back', failure: { stage: 'match', record: 1 } });
      expect(owner.events.filter(event => event.taskId === taskId && event.status === 'cancelled')).toHaveLength(1);
      expect(owner.facts.filter(fact => fact.scope === 'real-lock-cancel').flatMap(fact => fact.commands).some(command => command.errno === 1317 && command.ended)).toBe(true);
    } finally { await owner.sql('ROLLBACK', [], writer); if (cancelled) await Promise.allSettled([cancelled]); }

    await subject(owner, 'ddl_boundary', false); const key = await owner.key('ddl_boundary', 'upsert'), blocker = await owner.actor('mdl-blocker'), ddl = await owner.actor('ddl-writer');
    await owner.sql('START TRANSACTION', [], blocker); await owner.sql('SELECT 1 FROM ' + owner.table('ddl_boundary') + ' LIMIT 0', [], blocker);
    let alter: Promise<unknown> | undefined, importing: ReturnType<ConflictFixture['run']> | undefined;
    owner.onCommandEnd = (fact, command) => { if (!alter && fact.scope === 'ddl-boundary' && /^INSERT INTO /i.test(command.sql)) { alter = owner.sql('ALTER TABLE ' + owner.table('ddl_boundary') + ' DROP PRIMARY KEY', [], ddl); void alter.catch(() => undefined); } };
    try {
      importing = owner.run('ddl-boundary', 'ddl_boundary', Array.from({ length: 550 }, (_, index) => row('d-' + index, 'd-' + index)), columns, 'csv', key, 'batch'); void importing.catch(() => undefined);
      await vi.waitFor(async () => { expect(alter).toBeDefined(); const fact = owner.facts.find(fact => fact.scope === 'ddl-writer')!; expect(await owner.sql('SELECT ID FROM information_schema.PROCESSLIST WHERE ID=? AND STATE LIKE ?', [fact.id, '%metadata lock%'])).toHaveLength(1); }, { timeout: 5000, interval: 50 });
      await vi.waitFor(() => expect(owner.events.some(event => /已处理\s*500\s*条源记录/.test(event.message))).toBe(true), { timeout: 20000, interval: 50 });
      await owner.sql('COMMIT', [], blocker); await alter;
      const stopped = conflictReport(await importing);
      const actualRows = await owner.sql('SELECT CAST(COUNT(*) AS CHAR) AS n FROM ' + owner.table('ddl_boundary'));
      const actualIndexes = await owner.sql('SHOW INDEX FROM ' + owner.table('ddl_boundary'));
      // 原任务和DDL都已终态，先留真实回执/原ERR/独立行数，避免阶段断言遮蔽并发失败原因。
      console.log(JSON.stringify({ 专项: '冲突导入DDL终态诊断', 端口: owner.profile.port, 回执: stopped, 独立行数: actualRows, 当前索引: actualIndexes.map(row => ({ name: row.Key_name, column: row.Column_name, sequence: row.Seq_in_index, nonUnique: row.Non_unique })), 原连接: owner.facts.filter(fact => ['ddl-boundary', 'ddl-writer', 'mdl-blocker'].includes(fact.scope)).map(fact => ({ id: fact.id, scope: fact.scope, insertCommands: fact.commands.filter(command => /^INSERT INTO /i.test(command.sql)).length, updateCommands: fact.commands.filter(command => /^UPDATE /i.test(command.sql)).length, tail: fact.commands.slice(-12) })) }));
      expect(stopped).toMatchObject({ termination: 'failed', readRecords: 501, acknowledged: { ...zero(), inserted: 500 }, committed: { ...zero(), inserted: 500 }, currentBatch: 'rolled-back' });
      expect(actualRows).toEqual([{ n: '500' }]);
      const task = owner.facts.filter(fact => fact.scope === 'ddl-boundary'); expect(task).toHaveLength(1);
      const commands = task[0].commands, matches = commands.filter(command => /FOR UPDATE$/i.test(command.sql));
      expect(commands.filter(command => /^INSERT INTO /i.test(command.sql))).toHaveLength(500);
      expect(commands.filter(command => /^UPDATE /i.test(command.sql))).toHaveLength(0);
      expect(commands.filter(command => command.sql === 'COMMIT' && command.ended && command.warningStatus === 0)).toHaveLength(1);
      expect(commands.filter(command => command.sql === 'ROLLBACK' && command.ended && command.warningStatus === 0)).toHaveLength(1);
      expect(actualIndexes).toHaveLength(1); expect(actualIndexes[0]).toMatchObject({ Key_name: 'uq_alt', Column_name: 'alt' });
      expect([0, '0']).toContain(actualIndexes[0].Non_unique);
      const ddlCommands = owner.facts.filter(fact => fact.scope === 'ddl-writer').flatMap(fact => fact.commands);
      expect(ddlCommands.filter(command => command.sql === 'ALTER TABLE ' + owner.table('ddl_boundary') + ' DROP PRIMARY KEY' && command.ended && command.warningStatus === 0 && command.errno === undefined)).toHaveLength(1);
      if (stopped.failure?.stage === 'prepare-batch') {
        expect(stopped.failure.record).toBeUndefined(); expect(matches).toHaveLength(500);
      } else {
        // 8.0真实MDL调度可在SR目录读取后，升级SW与待排DDL形成1213；不接受其它match错误。
        expect(stopped.failure).toMatchObject({ stage: 'match', record: 501 }); expect(matches).toHaveLength(501);
        expect(matches.at(-1)).toMatchObject({ protocol: 'execute', ended: true, errno: 1213 });
      }
    } finally { owner.onCommandEnd = undefined; await owner.sql('ROLLBACK', [], blocker); if (alter) await Promise.allSettled([alter]); if (importing) await Promise.allSettled([importing]); }
  }), 180000);

  it('真实生成列警告/原ERR拒绝提交，普通触发器副作用与不主动SET键分别记录', async () => scenario(async owner => {
    await owner.sql('CREATE TABLE ' + owner.table('warning_target') + ' (id INT PRIMARY KEY,amount DECIMAL(10,0) NOT NULL,guard TINYINT GENERATED ALWAYS AS(amount) STORED) ENGINE=InnoDB');
    await owner.sql('INSERT INTO ' + owner.table('warning_target') + ' (id,amount) VALUES(1,1)');
    const probe = await owner.actor('warning-probe'); await owner.setNonStrictProbeMode(probe); await owner.sql('START TRANSACTION', [], probe);
    let warningStatus = 0, expectedErrno: number | undefined;
    try { const header = (await execute<{ warningStatus: number }>(probe, 'UPDATE ' + owner.table('warning_target') + ' SET amount=128 WHERE id=1')).rows; warningStatus = header.warningStatus; expect(warningStatus).toBeGreaterThan(0); }
    catch (error) { expectedErrno = (error as { errno?: number }).errno; expect(expectedErrno).toBe(1264); }
    const diagnostics = await owner.sql('SHOW WARNINGS', [], probe); expect(diagnostics.some(row => Number(row.Code) === 1264)).toBe(true); await owner.sql('ROLLBACK', [], probe);
    owner.configure = async (managed, scope) => { if (scope === 'warning-update') await owner.setNonStrictProbeMode(managed); };
    const result = conflictReport(await owner.run('warning-update', 'warning_target', [{ id: 1, amount: '128' }], ['id', 'amount'], 'csv', await owner.key('warning_target', 'upsert')));
    expect(result).toMatchObject({ termination: 'failed', committed: zero(), currentBatch: 'rolled-back', failure: { stage: 'update', record: 1 } });
    const commands = owner.facts.filter(fact => fact.scope === 'warning-update').flatMap(fact => fact.commands), update = commands.find(command => /^UPDATE /i.test(command.sql))!;
    if (expectedErrno !== undefined) expect(update.errno).toBe(expectedErrno); else expect(update.warningStatus).toBeGreaterThan(0);
    expect(commands.filter(command => command.sql === 'ROLLBACK' && command.ended && command.warningStatus === 0)).toHaveLength(1);
    expect(await owner.sql('SELECT amount FROM ' + owner.table('warning_target') + ' WHERE id=1')).toEqual([{ amount: '1' }]);
    console.log(JSON.stringify({ 专项: '冲突警告', 端口: owner.profile.port, 原独立证据: expectedErrno ? 'server-ERR1264' : 'OK-warning1264', warningStatus, 未验: expectedErrno ? ['本实例未产生OK警告路径'] : [] }));

    await subject(owner, 'trigger_target'); await owner.sql('CREATE TABLE ' + owner.table('trigger_audit') + ' (action_name VARCHAR(12),source_key VARCHAR(32)) ENGINE=InnoDB');
    await owner.sql('CREATE TRIGGER ' + owner.table('audit_update') + ' AFTER UPDATE ON ' + owner.table('trigger_target') + ' FOR EACH ROW INSERT INTO ' + owner.table('trigger_audit') + " VALUES('update',NEW.k)");
    expect(conflictReport(await owner.run('trigger-skip', 'trigger_target', [row('alpha', 'u1')], columns, 'csv', await owner.key('trigger_target', 'skip-existing')))).toMatchObject({ committed: { ...zero(), skippedExisting: 1 } });
    expect(await owner.sql('SELECT * FROM ' + owner.table('trigger_audit'))).toEqual([]);
    expect(conflictReport(await owner.run('trigger-update', 'trigger_target', [row('alpha', 'u1')], columns, 'json', await owner.key('trigger_target', 'upsert')))).toMatchObject({ committed: { ...zero(), matchedUpdates: 1 } });
    expect(await owner.sql('SELECT * FROM ' + owner.table('trigger_audit'))).toEqual([{ action_name: 'update', source_key: 'Alpha' }]);
  }), 120000);
});
