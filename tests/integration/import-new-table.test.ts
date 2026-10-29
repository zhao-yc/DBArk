import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReadStream } from 'node:fs';
import type { ManagedConnection } from '../../src/engine/connection';
import type { DataRow, EngineCommand, TaskEvent } from '../../src/shared/contracts';
import type { ImportFileInspectOutput } from '../../src/shared/importNewTable';
import type { FileImportPreflightReport } from '../../src/shared/fileImportPreflight';
import type { TableCreateApplyOutput, TableCreateGetOutput, TableCreatePreviewOutput } from '../../src/shared/tableCreate';
import type { TableValueOptionsConnectionFact, TableValueOptionsLifetime } from '../helpers/tableValueOptionsIntegration';

const audit = vi.hoisted(() => ({ scope: '', check: undefined as (() => void) | undefined, watch: undefined as ((managed: ManagedConnection, scope: string) => void) | undefined, file: undefined as ((path: unknown, stream?: ReadStream) => void) | undefined }));
/** 仅观察原connect、SQL参数、命令end/callback和物理流，不替换驱动结果或事务状态。 */
vi.mock('../../src/engine/connection', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/engine/connection')>();
  return { ...actual, connect: async (...args: Parameters<typeof actual.connect>) => {
    if (!audit.check || !audit.watch || !audit.scope) throw Error('新表导入缺少原连接owner');
    audit.check(); const scope = audit.scope, managed = await actual.connect(...args); audit.watch(managed, scope); return managed;
  } };
});
/** 观察原createReadStream及原data字节，不能替换文件内容、原chunk或产品回调。 */
vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, createReadStream: (...args: Parameters<typeof actual.createReadStream>) => {
    if (!audit.check || !audit.file) throw Error('新表导入缺少原文件owner');
    audit.check(); audit.file(args[0]); const stream = actual.createReadStream(...args); audit.file(args[0], stream); return stream;
  } };
});

/** list先于全部环境；默认仅检查精确双门，nonce/认证和Engine均留在门后。 */
export function importNewTableIntegrationEnabled(environment: Record<string, string | undefined>, args: readonly string[]): boolean {
  return !args.some(value => value === 'list' || value === '--list' || value.startsWith('--list=')) && environment.DBARK_INTEGRATION_ENABLED === '1' && environment.DBARK_IMPORT_NEW_TABLE_TEST === '1';
}
let lifetime: TableValueOptionsLifetime | undefined, retained = false, complete = false;
// 失败原句柄及诊断强保至本进程结束，不能交给GC、重连或下一轮兜底清理。
const retainedResources: unknown[] = [], retainedDiagnostics: unknown[] = [];
afterEach(() => { if (lifetime && !complete) { retained = true; lifetime.stop(); } lifetime?.end(); });

describe.sequential('完整CSV/JSON到新表六实例真实Engine（默认关闭，逐实例独立进程）', () => {
  it('原文件扫描、正式建表能力、完整预检和整文件提交及三类拒绝均保原资源', { timeout: 120000, retry: 0, repeats: 0 }, async context => {
    if (!importNewTableIntegrationEnabled(process.env, process.argv)) { context.skip(); return; }
    if (retained) throw Error('新表导入原验收已停链保留，禁止自动重跑或续期');
    const helper = await import('../helpers/importNewTableIntegration'), life = await import('../helpers/tableValueOptionsIntegration');
    const binding = helper.bindImportNewTableTarget(() => process.env, 'import-new-table-' + context.task.id), owner = lifetime = life.tableValueOptionsLifetime(context, binding, () => { retained = true; });
    const facts: TableValueOptionsConnectionFact[] = [], events: TaskEvent[] = [], fixtureWrites = new Set<string>();
    type FileFact = { name: string; scope: string; stream: ReadStream; closed: Promise<void>; sawClose: boolean; bytes: number; digest?: string; };
    const streams: FileFact[] = [], files = new Map<string, { name: string; bytes: Buffer; current: Buffer; changed?: Buffer }>();
    let observer: ManagedConnection | undefined, engine: import('../../src/engine/index').Engine | undefined;
    let directory = '', phase = '核对资源计划', currentCase = '', databaseState: 'absent' | 'unknown' | 'confirmed' = 'absent', injectedChanges = 0;
    let fileObservationFailure: unknown;
    let nodeFs: typeof import('node:fs') | undefined, pathModule: typeof import('node:path') | undefined, diagnosticUtilities: typeof import('node:util') | undefined;
    let sqlEvidence = () => ({ sent: [] as { sql: string; scope: string }[], rejected: [] as { sql: string; scope: string }[] });
    audit.check = owner.check;
    try {
      diagnosticUtilities = await owner.step(() => import('node:util'));
      const crypto = await owner.step(() => import('node:crypto')), fs = await owner.step(() => import('node:fs/promises')), fsSync = nodeFs = await owner.step(() => import('node:fs'));
      const path = pathModule = await owner.step(() => import('node:path')), os = await owner.step(() => import('node:os'));
      const plan = helper.planImportNewTableFixture(binding.database, binding.marker), policy = helper.createImportNewTableSqlAudit(plan, fixtureWrites, id => facts.some(fact => fact.id === id && fact.managed !== observer));
      const watcher = await owner.step(() => import('../helpers/tableFilteredExportSqlAudit'));
      sqlEvidence = () => ({ sent: policy.sent.map(({ sql, scope }) => ({ sql, scope })), rejected: policy.rejected });
      audit.watch = (managed, scope) => facts.push(watcher.watchTableFilteredExportConnection(managed, scope, owner, policy));
      audit.file = (filePath, stream) => {
        owner.check(); if (typeof filePath !== 'string' || !files.has(filePath)) { owner.stop(); throw Error('新表导入打开未登记的原文件'); }
        if (!stream) return;
        const entry = files.get(filePath)!; let resolve!: () => void; const hash = crypto.createHash('sha256');
        const fact: FileFact = { name: entry.name, scope: audit.scope, stream, closed: new Promise<void>(yes => { resolve = yes; }), sawClose: false, bytes: 0 };
        // 原data事件只旁观，变化案例仅在formal首个data外部同步写本例文件一次，不替换原chunk。
        // 事件观察失败先sticky停链并保首因，由原await边界报告；不能制造未捕获异常越过原诊断收尾。
        const observe = (action: () => void) => { try { owner.check(); action(); } catch (reason) { fileObservationFailure ??= reason; owner.stop(); } };
        stream.once('data', () => observe(() => {
          if (fact.scope !== 'files.import:changing_source') return;
          if (injectedChanges !== 0 || !entry.changed || entry.changed.length !== entry.bytes.length) throw Error('本例原文件变化注入身份不符');
          injectedChanges++; fsSync.writeFileSync(filePath, entry.changed); entry.current = entry.changed;
        }));
        stream.on('data', (chunk: unknown) => observe(() => { if (!Buffer.isBuffer(chunk)) throw Error('原文件流未返回原始Buffer'); hash.update(chunk); fact.bytes += chunk.length; }));
        stream.once('close', () => { fact.sawClose = true; fact.digest = hash.digest('hex'); resolve(); }); streams.push(fact);
      };
      // 一切真实模块和认证均在双门+nonce+原120秒owner之后载入。
      const modules = await owner.step(life.loadTableValueOptionsModules);
      const database = plan.database, marker = plan.marker;
      process.stdout.write(JSON.stringify({ 专项: '完整文件到新表', 阶段: '原资源计划', 数据库: database, 标记: marker, 端口: binding.profile.port, 对象: plan.objects, 案例: plan.cases.map(item => item.name) }) + '\n');
      /** observer也走同一精确策略；只写预先登记的壳库、owner和最终准确DROP。 */
      const sql = async <T = Record<string, unknown>[]>(statement: string, parameters: (string | number | boolean | null | Buffer)[] = []) => {
        owner.check(); policy.assert(statement, parameters, 'observer', observer?.sqlMode);
        audit.scope = 'observer'; return (await owner.step(() => modules.connection.execute<T>(observer!, statement, parameters))).rows;
      };
      audit.scope = 'observer'; observer = await owner.step(() => modules.connection.connect(binding.profile));
      life.assertTableValueOptionsIdentity(await sql('SELECT @@hostname AS hostname,@@port AS port,@@server_id AS serverId,@@version_compile_os AS os,@@lower_case_table_names AS lowerNames'), binding, observer.status, binding.dialect === 'mysql' ? await sql('SELECT @@server_uuid AS uuid') : undefined);
      const exists = 'SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE BINARY SCHEMA_NAME=BINARY ?'; expect(await sql(exists, [database])).toEqual([]);
      for (const [index, statement] of plan.creates.entries()) { fixtureWrites.add(statement); if (index === 0) databaseState = 'unknown'; expect((await sql<{ warningStatus: number }>(statement)).warningStatus).toBe(0); if (index === 0) databaseState = 'confirmed'; }
      fixtureWrites.add(plan.ownerSeed); expect((await sql<{ warningStatus: number }>(plan.ownerSeed)).warningStatus).toBe(0);
      const ownerDefinition = await sql('SHOW CREATE TABLE ' + plan.table('__owner'));
      await owner.step(async () => { directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dbark-importnew-' + binding.nonce + '-')); });
      for (const item of plan.cases) {
        const filePath = path.join(directory, item.name + '.' + item.format), original = Buffer.from(item.text, 'utf8'), changed = item.changedText === undefined ? undefined : Buffer.from(item.changedText, 'utf8');
        expect(original).toEqual(item.bytes); expect(crypto.createHash('sha256').update(original).digest('hex')).toBe(item.sourceSha256);
        if (changed) { expect(changed.length).toBe(original.length); expect(changed).not.toEqual(original); }
        files.set(filePath, { name: item.name, bytes: original, current: original, ...(changed ? { changed } : {}) }); await owner.step(() => fs.writeFile(filePath, original, { flag: 'wx' }));
      }
      engine = new modules.engine.Engine(event => events.push(event));
      /** 原handle、原callback/end、严格close与物理stream，以及原文件close全部结束后才进入下一步。 */
      const invoke = async <T>(command: EngineCommand, input: Record<string, unknown>, label: string, connections: number, fileCount: number, strict: boolean) => {
        owner.check(); audit.scope = command + ':' + label; const connectionOffset = facts.length, fileOffset = streams.length, scope = audit.scope;
        const result = await owner.step(async () => { try { return { value: await engine!.handle(command, input) as T }; } catch (error) { return { error }; } });
        const current = facts.slice(connectionOffset); expect(current).toHaveLength(connections);
        for (const fact of current) await owner.step(() => fact.closed); life.assertTableValueOptionsReleased(current, strict); expect(current.every(fact => fact.strict === strict)).toBe(true);
        const opened = streams.slice(fileOffset); expect(opened).toHaveLength(fileCount); for (const fact of opened) { await owner.step(() => fact.closed); expect(fact.sawClose && fact.stream.closed).toBe(true); }
        if (typeof input.taskId === 'string') {
          expect(events.some(event => event.taskId === input.taskId && event.status === 'running')).toBe(true);
          const errors = 'value' in result ? (result.value as { errors?: unknown } | undefined)?.errors : undefined;
          const terminal = 'error' in result || Array.isArray(errors) && errors.length ? 'failed' : 'completed';
          expect(events.filter(event => event.taskId === input.taskId && event.status !== 'running').map(event => event.status)).toEqual([terminal]);
        }
        return { ...result, facts: current, files: opened, sent: policy.sent.filter(item => item.scope === scope) };
      };
      expect((await invoke('connections.open', { id: binding.profile.id, profile: binding.profile }, 'profile', 1, 0, false)).error).toBeUndefined();
      const definitions = new Map<string, unknown>();
      // 原生Buffer只转换独立base64包装；数值、日期与嵌套JSON原文不经产品转换器或JSON.parse。
      const readRows = async (name: string) => (await sql(plan.cases.find(item => item.name === name)!.readSql)).map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Buffer.isBuffer(value) ? { type: 'binary', base64: value.toString('base64') } : value]))) as DataRow[];
      /** 独立BIGINT排序只排列合成预期，不经Number或产品解析器计算期望。 */
      const sortedRows = (rows: readonly DataRow[]) => [...rows].sort((left, right) => BigInt(left.id as string) < BigInt(right.id as string) ? -1 : BigInt(left.id as string) > BigInt(right.id as string) ? 1 : 0);
      for (const item of plan.cases) {
        currentCase = item.name; phase = '原文件完整扫描';
        const [filePath, registered] = [...files].find(([, entry]) => entry.name === item.name)!, target = { connectionId: binding.profile.id, database, table: item.name };
        const fileInput = { fileToken: 'importnew-' + binding.nonce + '-' + item.name, filePath, format: item.format, encoding: 'utf8', ...(item.format === 'csv' ? { csvDelimiter: ',', csvHasHeader: true } : {}) };
        const inspected = await invoke<ImportFileInspectOutput>('files.inspectImport', { ...fileInput, taskId: crypto.randomUUID() }, item.name, 0, 1, false);
        expect(inspected.error).toBeUndefined(); expect(inspected.value).toMatchObject({ columns: plan.sourceColumns, records: 502, source: item.source, sampleOmitted: true });
        expect(inspected.value!.rows.length).toBeLessThanOrEqual(20); expect(inspected.files[0].bytes).toBe(item.bytes.length); expect(inspected.files[0].digest).toBe(item.sourceSha256);
        const expectedSource = inspected.value!.source;
        phase = '原建表能力读取';
        const got = await invoke<TableCreateGetOutput>('schema.tableCreate.get', { connectionId: target.connectionId, database, taskId: crypto.randomUUID(), connectionRevision: 1 }, item.name, 1, 0, true);
        expect(got.error).toBeUndefined(); expect(got.value!.target).toEqual({ connectionId: target.connectionId, database });
        const preview = await invoke<TableCreatePreviewOutput>('schema.tableCreate.preview', { snapshotId: got.value!.snapshotId, design: item.design, taskId: crypto.randomUUID(), connectionRevision: 1 }, item.name, 1, 0, true);
        expect(preview.error).toBeUndefined(); expect(preview.value!.target).toEqual(target); expect(preview.value!.sql.replace(/;$/, '')).toBe(item.expectedCreateSql); expect(preview.sent.some(row => /^CREATE\s/i.test(row.sql))).toBe(false);
        phase = '原CREATE回应及原资源释放';
        const created = await invoke<TableCreateApplyOutput>('schema.tableCreate.apply', { previewToken: preview.value!.previewToken, confirmation: database + '.' + item.name, acknowledgements: preview.value!.requiredAcknowledgements, taskId: crypto.randomUUID(), connectionRevision: 1 }, item.name, 1, 0, true);
        expect(created.error).toBeUndefined(); expect(created.value).toMatchObject({ target, ddlSubmitted: true, ddlCompleted: true, definitionVerified: true, resourcesReleased: true });
        expect(created.sent.filter(row => /^CREATE\s+TABLE\b/i.test(row.sql)).map(row => row.sql.replace(/;$/, ''))).toEqual([item.expectedCreateSql]);
        const released = await invoke('schema.tableCreate.release', { snapshotId: got.value!.snapshotId, previewToken: preview.value!.previewToken }, item.name, 0, 0, false); expect(released.error).toBeUndefined();
        phase = '独立观察CREATE定义与目录';
        const shown = await sql('SHOW CREATE TABLE ' + plan.table(item.name)); definitions.set(item.name, shown); expect(shown).toHaveLength(1); expect(String(shown[0]['Create Table'])).toContain(marker + ':' + item.name);
        const columns = await sql(plan.observerColumnsSql, [database, item.name]);
        expect(columns.map(row => row.COLUMN_NAME)).toEqual(item.design.columns.map(column => column.name));
        for (const [index, column] of item.design.columns.entries()) {
          expect([index + 1, String(index + 1)]).toContain(columns[index].ORDINAL_POSITION);
          const normalize = (value: string) => value.toUpperCase().replace(/^(TINYINT|SMALLINT|MEDIUMINT|INT|BIGINT)\(\d+\)/, '$1');
          expect(normalize(String(columns[index].COLUMN_TYPE))).toBe(normalize(column.type)); expect(columns[index].IS_NULLABLE).toBe(column.nullable ? 'YES' : 'NO');
          expect(columns[index].COLUMN_DEFAULT === null || binding.dialect === 'mariadb' && columns[index].COLUMN_DEFAULT === 'NULL').toBe(true); expect(columns[index].EXTRA).toBe(''); expect(columns[index].COLUMN_COMMENT).toBe(column.comment); expect([null, '']).toContain(columns[index].GENERATION_EXPRESSION);
        }
        const indexes = await sql(plan.observerIndexesSql, [database, item.name]);
        expect(indexes).toHaveLength(1); expect([1, '1']).toContain(indexes[0].SEQ_IN_INDEX);
        expect({ ...indexes[0], SEQ_IN_INDEX: 1 }).toEqual({ INDEX_NAME: 'PRIMARY', COLUMN_NAME: 'id', SEQ_IN_INDEX: 1, SUB_PART: null });
        expect(await readRows(item.name)).toEqual([]);
        if (item.name === 'changed_source') { phase = '原扫描后同长变更本例文件'; expect(registered.changed).toBeDefined(); await owner.step(async () => { await fs.writeFile(filePath, registered.changed!); registered.current = registered.changed!; }); }
        const mapping = plan.mapping;
        phase = '正式整文件只读预检';
        const preflight = await invoke<FileImportPreflightReport>('files.preflight', { ...target, ...fileInput, mapping, expectedSource, taskId: crypto.randomUUID() }, item.name, 1, 1, true);
        expect(preflight.error).toBeUndefined(); expect(preflight.value!.target).toEqual(target); expect(preflight.value!.checkedRecords).toBe(502);
        if (item.name === 'late_invalid') { expect(preflight.value).toMatchObject({ complete: true, termination: 'complete', validRecords: 501, invalidRecords: 1, issueCount: 1 }); expect(preflight.value!.issues).toMatchObject([{ code: 'invalid-value', record: 502, target: 'amount' }]); }
        else if (item.name === 'changed_source') {
          expect(preflight.value).toMatchObject({ complete: false, termination: 'source-changed', validRecords: 502, invalidRecords: 0, sourceBytes: item.bytes.length, sourceFingerprint: crypto.createHash('sha256').update(registered.current).digest('hex') });
          expect(preflight.value!.sourceFingerprint).not.toBe(expectedSource.sha256); expect(preflight.value!.issues.some(issue => issue.code === 'source-changed')).toBe(true);
        }
        else expect(preflight.value).toMatchObject({ complete: true, termination: 'complete', validRecords: 502, invalidRecords: 0, issueCount: 0, sourceFingerprint: expectedSource.sha256, sourceBytes: expectedSource.bytes });
        expect(preflight.sent.some(row => /^(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|COMMIT)\b/i.test(row.sql))).toBe(false);
        phase = '正式整文件原子导入';
        // 三类拒绝直接走正式Engine验证核心回滚，UI在预检有问题时本应阻止该额外调用。
        const imported = await invoke<{ rows: number; errors: string[] }>('files.import', { ...target, ...fileInput, mapping, expectedSource, transactionMode: 'atomic', taskId: crypto.randomUUID() }, item.name, 1, 1, true);
        expect(imported.error).toBeUndefined(); const success = item.name === 'csv_success' || item.name === 'json_success';
        expect(imported.value!.rows).toBe(success ? 502 : 0); expect(imported.value!.errors).toHaveLength(success ? 0 : 1);
        if (success) { expect(imported.files[0].bytes).toBe(expectedSource.bytes); expect(imported.files[0].digest).toBe(expectedSource.sha256); }
        expect(imported.sent.filter(row => row.sql === 'START TRANSACTION')).toHaveLength(1); expect(imported.sent.filter(row => row.sql === 'COMMIT')).toHaveLength(success ? 1 : 0); expect(imported.sent.filter(row => row.sql === 'ROLLBACK')).toHaveLength(success ? 0 : 1);
        expect(imported.sent.filter(row => row.sql === item.insertSql)).toHaveLength(item.parameters.length);
        if (item.name === 'late_invalid') { expect(imported.value!.errors[0]).toContain('第 502 条记录导入失败'); expect(imported.value!.errors[0]).toContain('不能无损导入'); expect(item.parameters).toHaveLength(501); }
        if (item.kind === 'changed' || item.kind === 'changing') expect(imported.value!.errors[0]).toContain('源文件身份、大小、时间或完整内容已变化');
        if (!success) { expect(imported.value!.errors[0]).toContain('已确认提交 0 行'); expect(imported.value!.errors[0]).toContain('整文件目标表事务已确认回滚'); }
        phase = '独立逐行字段和字节核验'; expect(await readRows(item.name)).toEqual(success ? sortedRows(item.rows) : []);
        expect(await sql('SHOW CREATE TABLE ' + plan.table(item.name))).toEqual(definitions.get(item.name));
        if (success) expect(await sql(item.hexSql)).toEqual(item.expectedRows);
        if (item.name === 'changing_source') expect(injectedChanges).toBe(1);
      }
      phase = '重名原对象拒绝保护'; currentCase = 'csv_success_duplicate'; const successful = plan.cases.find(item => item.name === 'csv_success')!;
      const duplicateGet = await invoke<TableCreateGetOutput>('schema.tableCreate.get', { connectionId: binding.profile.id, database, taskId: crypto.randomUUID(), connectionRevision: 1 }, currentCase, 1, 0, true); expect(duplicateGet.error).toBeUndefined();
      const duplicatePreview = await invoke('schema.tableCreate.preview', { snapshotId: duplicateGet.value!.snapshotId, design: successful.design, taskId: crypto.randomUUID(), connectionRevision: 1 }, currentCase, 1, 0, true); expect(duplicatePreview.error).toBeInstanceOf(Error); expect(duplicatePreview.sent.some(row => /^(?:CREATE|DROP|ALTER|INSERT|UPDATE|DELETE)\b/i.test(row.sql))).toBe(false);
      expect((await invoke('schema.tableCreate.release', { snapshotId: duplicateGet.value!.snapshotId }, currentCase, 0, 0, false)).error).toBeUndefined(); expect(await readRows('csv_success')).toEqual(sortedRows(successful.rows)); expect(await sql('SHOW CREATE TABLE ' + plan.table('csv_success'))).toEqual(definitions.get('csv_success'));
      phase = '原资源全量核对及准确清理'; currentCase = '';
      const connectionCount = facts.length; await owner.step(() => engine!.closeAll()); expect(facts).toHaveLength(connectionCount);
      const owned = facts.filter(fact => fact.managed !== observer); for (const fact of owned) { await owner.step(() => fact.closed); life.assertTableValueOptionsReleased([fact], fact.scope !== 'connections.open:profile'); }
      for (const item of plan.cases) { expect(await readRows(item.name)).toEqual(item.kind === 'success' ? sortedRows(item.rows) : []); expect(await sql(item.hexSql)).toEqual(item.expectedRows); expect(await sql('SHOW CREATE TABLE ' + plan.table(item.name))).toEqual(definitions.get(item.name)); }
      expect(await sql('SELECT marker FROM ' + plan.table('__owner'))).toEqual([{ marker }]); expect(await sql('SHOW CREATE TABLE ' + plan.table('__owner'))).toEqual(ownerDefinition);
      expect(await sql('SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE BINARY TABLE_SCHEMA=BINARY ? ORDER BY BINARY TABLE_NAME', [database])).toEqual(plan.objects.map(name => ({ name })));
      for (const [view, column] of [['TRIGGERS', 'TRIGGER_SCHEMA'], ['ROUTINES', 'ROUTINE_SCHEMA'], ['EVENTS', 'EVENT_SCHEMA']]) expect(await sql('SELECT 1 FROM information_schema.' + view + ' WHERE BINARY ' + column + '=BINARY ? LIMIT 1', [database])).toEqual([]);
      expect(await sql('SELECT ID FROM information_schema.PROCESSLIST WHERE BINARY DB=BINARY ?', [database])).toEqual([]);
      for (const id of new Set(owned.map(fact => fact.id))) { expect(await sql('SELECT ID FROM information_schema.PROCESSLIST WHERE ID=?', [id])).toEqual([]); expect(await sql('SELECT trx_mysql_thread_id AS id FROM information_schema.INNODB_TRX WHERE trx_mysql_thread_id=?', [id])).toEqual([]); }
      expect(policy.rejected).toEqual([]); expect(injectedChanges).toBe(1); expect(streams.every(fact => fact.sawClose && fact.stream.closed)).toBe(true);
      expect((await owner.step(() => fs.readdir(directory))).sort()).toEqual([...files.keys()].map(filePath => path.basename(filePath)).sort());
      for (const [filePath, entry] of files) expect(await owner.step(() => fs.readFile(filePath))).toEqual(entry.current);
      fixtureWrites.add(plan.drop); databaseState = 'unknown'; expect((await sql<{ warningStatus: number }>(plan.drop)).warningStatus).toBe(0); databaseState = 'absent'; expect(await sql(exists, [database])).toEqual([]);
      for (const filePath of files.keys()) await owner.step(() => fs.unlink(filePath)); expect(await owner.step(() => fs.readdir(directory))).toEqual([]); await owner.step(() => fs.rmdir(directory));
      await owner.step(() => life.closeTableValueOptionsObserver(observer!)); const observerFact = facts.find(fact => fact.managed === observer)!; await owner.step(() => observerFact.closed); life.assertTableValueOptionsReleased([observerFact], true);
      owner.finish(); complete = true;
      process.stdout.write(JSON.stringify({ 专项: '完整文件到新表', 阶段: '完成', 数据库: database, 标记: marker, 端口: binding.profile.port, 案例数: plan.cases.length, 成功行数: 1004, 正式CREATE: 5, 成功COMMIT: 2, 拒绝案例: 3, 原数据流: streams.length, 原产品连接: owned.length, 原callback及end及物理close: true, 数据库及文件残留: 0, 未验: ['Main文件选择授权', 'GUI及系统输入', '安装包', 'Mac', '真实提交断线与未知ACK', '大规模性能'] }) + '\n');
    } catch (reason) {
      retained = true; owner.stop(); retainedResources.push({ observer, engine, facts, streams, files, fileObservationFailure, reason });
      const redact = (input: string) => {
        let result = input;
        for (const secret of [binding.profile.password, binding.profile.user, binding.profile.tls?.caPath, directory, ...files.keys()].filter((value): value is string => typeof value === 'string' && value.length > 0).sort((left, right) => right.length - left.length)) result = result.replaceAll(secret, '[本例私有信息]');
        return result.slice(0, 4000);
      };
      const error = reason instanceof Error ? reason : Error(String(reason)), code = typeof (error as Error & { code?: unknown }).code === 'string' ? String((error as Error & { code?: unknown }).code).slice(0, 80) : '';
      // 包装安全错误前保留原失败位置和首个差异；不把整份502行数组或私有连接值展开到日志。
      const actual = Object.getOwnPropertyDescriptor(error, 'actual'), expected = Object.getOwnPropertyDescriptor(error, 'expected');
      let assertion: Record<string, unknown> | undefined;
      if (actual && expected && 'value' in actual && 'value' in expected && diagnosticUtilities) {
        const { inspect, isDeepStrictEqual } = diagnosticUtilities;
        const left = actual.value, right = expected.value;
        const index = Array.isArray(left) && Array.isArray(right) ? Array.from({ length: Math.max(left.length, right.length) }, (_, index) => index).find(index => !isDeepStrictEqual(left[index], right[index])) : undefined;
        const bounded = (value: unknown) => redact(inspect(value, { depth: 4, maxArrayLength: 8, maxStringLength: 1000, getters: false, customInspect: false }));
        assertion = { ...(Array.isArray(left) && Array.isArray(right) ? { actualLength: left.length, expectedLength: right.length, firstDifferentIndex: index } : {}), actual: bounded(index === undefined ? left : left[index]), expected: bounded(index === undefined ? right : right[index]) };
      }
      const evidence = sqlEvidence(), diagnostic = { 专项: '完整文件到新表', 阶段: '停链保留', 当前阶段: phase, 案例: currentCase, 数据库: binding.database, 标记: binding.marker, 端口: binding.profile.port, 数据库状态: databaseState, 错误: { name: error.name.slice(0, 80), code, message: redact(error.message), stack: redact(error.stack ?? '') }, 断言: assertion, 原文件观察首因: fileObservationFailure instanceof Error ? { name: fileObservationFailure.name.slice(0, 80), message: redact(fileObservationFailure.message) } : undefined, 已拒绝SQL: evidence.rejected.map(row => ({ sql: redact(row.sql), scope: row.scope })), 末尾原SQL: evidence.sent.slice(-12).map(row => ({ sql: redact(row.sql), scope: row.scope })), 原连接: facts.map(fact => ({ id: fact.id, scope: fact.scope, pending: fact.pending, closeCalls: fact.closeCalls, strict: fact.strict, closeReturned: fact.closeReturned, closeFailed: fact.closeFailed, sawClose: fact.sawClose, commands: fact.commands.map(command => ({ sql: redact(command.sql), method: command.method, callbackReturned: command.callbackReturned, end: command.terminal })) })), 原文件流: streams.map(fact => ({ 案例: fact.name, scope: fact.scope, sawClose: fact.sawClose, closed: fact.stream.closed, bytes: fact.bytes, sha256: fact.digest })), 自动重试: false, 自动清理: false };
      retainedDiagnostics.push(diagnostic);
      if (directory && nodeFs && pathModule) try { nodeFs.writeFileSync(pathModule.join(directory, '本轮停链诊断.json'), JSON.stringify(diagnostic, null, 2), { flag: 'wx' }); } catch { /* 原诊断和句柄仍强保于本进程，不能覆盖已有记录或转清理。 */ }
      process.stdout.write(JSON.stringify(diagnostic) + '\n');
      throw Error(`新表导入实库停在“${phase}”${currentCase ? `/${currentCase}` : ''}：${error.name}${code ? `/${code}` : ''}。${redact(error.message).slice(0, 1200)}；已保留原资源与私有诊断，不自动重试或清理。`);
    }
  });
});
