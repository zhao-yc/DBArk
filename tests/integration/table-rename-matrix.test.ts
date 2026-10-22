import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ManagedConnection } from '../../src/engine/connection';
import type { EngineCommand, TaskEvent } from '../../src/shared/contracts';
import type { TableRenameApplyOutput, TableRenameGetOutput, TableRenamePreviewOutput } from '../../src/shared/tableRename';
import {
  bindTableRenameMatrixTarget, tableRenameMatrixGate, tableRenameMatrixLifetime, loadTableRenameMatrixModules,
  assertTableRenameMatrixIdentity, watchTableRenameMatrixConnection, assertTableRenameMatrixReleased,
  closeTableRenameMatrixObserver, proveTableRenameMdlTerminal, type TableRenameMdlReceipt, type TableRenameMatrixFact, type TableRenameMatrixLifetime,
} from '../helpers/tableRenameMatrixIntegration';

const audit = vi.hoisted(() => ({ watch: undefined as undefined | ((managed: ManagedConnection, scope: string) => void), check: undefined as undefined | (() => void), scope: '' }));
/** 原connect真透传，不替换Engine、查询结果、权限、原生流或取消协议。 */
vi.mock('../../src/engine/connection', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/engine/connection')>();
  return { ...actual, connect: async (...args: Parameters<typeof actual.connect>) => {
    if (!audit.watch || !audit.check || !audit.scope) throw Error('重命名兼容连接没有本轮owner');
    audit.check(); const scope = audit.scope, managed = await actual.connect(...args); audit.watch(managed, scope); return managed;
  } };
});

let lifetime: TableRenameMatrixLifetime | undefined, retained = false, complete = false;
afterEach(() => { if (lifetime && !complete) { retained = true; lifetime.stop(); } lifetime?.end(); });

describe.sequential('普通同库表重命名六实例专项（逐端口独立进程）', () => {
  it('往返保真、全局视图依赖、令牌边界和真实MDL取消', { timeout: 120000, retry: 0, repeats: 0 }, async context => {
    if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || process.env[tableRenameMatrixGate] !== '1') { context.skip(); return; }
    if (retained) throw Error('重命名兼容原验收仍保留现场，禁止自动重跑');
    const binding = bindTableRenameMatrixTarget(() => process.env, 'rnmx-' + context.task.id);
    const owner = lifetime = tableRenameMatrixLifetime(context, binding, () => { retained = true; });
    const facts: TableRenameMatrixFact[] = [], events: TaskEvent[] = [];
    let allowedSql: string | undefined, allowedKillThread: number | undefined, observer: ManagedConnection | undefined, engine: import('../../src/engine/index').Engine | undefined;
    let mdlReceipt: TableRenameMdlReceipt | undefined;
    let database = '', viewDatabase = '', marker = '', holdingMdl = false, renameSettled = true, checkpoint = '绑定原任务', mdlFactStart = -1;
    /** 诊断只用固定步骤和受控夹具名称，绝不从SQL、参数或异常message拼接。 */
    const fixtureName = (name: string) => /^[a-z][a-z0-9_]{0,63}$/.test(name) ? name : '未识别夹具';
    /** 成功与失败复用同一原MDL事实，按已观察投递筛选，输出不含SQL或原行。 */
    const mdlDiagnostics = () => mdlFactStart < 0 ? [] : facts.slice(mdlFactStart).filter(fact => fact.writes.some(text => /^RENAME\b/i.test(text)) || fact.killConnections.length > 0).map(fact => ({ id: fact.id, trace: fact.trace, renameCallbackCount: fact.renameCallbackCount, killCallbackCount: fact.killCallbackCount, overflow: fact.traceOverflow, unavailable: fact.traceUnavailable }));
    const created = new Map<string, 'unknown' | 'confirmed' | 'absent'>();
    audit.check = owner.check; audit.watch = (managed, scope) => { facts.push(watchTableRenameMatrixConnection(managed, scope, owner, () => allowedSql, () => allowedKillThread)); };
    try {
      checkpoint = '加载原生模块'; const { engine: engineModule, connection } = await owner.step(loadTableRenameMatrixModules);
      const [quote, crypto] = await owner.step(() => Promise.all([import('../../src/engine/sql'), import('node:crypto')]));
      database = 'dbark_e2e_rnmx_' + crypto.randomUUID().replaceAll('-', '');
      viewDatabase = 'dbark_e2e_rnmxv_' + crypto.randomUUID().replaceAll('-', ''); marker = 'dbark-rnmx-owner:' + crypto.randomUUID();
      if (!/^dbark_e2e_rnmx_[a-f0-9]{32}$/.test(database) || !/^dbark_e2e_rnmxv_[a-f0-9]{32}$/.test(viewDatabase)) throw Error('重命名兼容原资源计划无效');
      process.stdout.write(JSON.stringify({ 专项: '表重命名兼容', 阶段: '原资源计划', 端口: binding.profile.port, 数据库: database, 视图数据库: viewDatabase, 所有者标记: marker }) + '\n');
      const target = (name: string, schema = database) => quote.identifier(schema) + '.' + quote.identifier(name);
      const tables = new Map<string, { schema: string; name: string; comment: string }>(), views = new Map<string, { schema: string; name: string; source: string }>();
      /** 全部普通动作由同一owner串行包裹；MDL段另在一个owner.step内做必要的真实并行取消。 */
      const sql = async <T = Record<string, unknown>[]>(text: string, values: (string | number | null | Buffer)[] = []): Promise<T> => {
        audit.scope = 'observer'; return (await owner.step(() => connection.execute<T>(observer!, text, values))).rows;
      };
      /** 比较只输出布尔差异，失败日志不展开原行、BLOB、视图DEFINER或认证。 */
      const same = (actual: unknown, expected: unknown) => { expect(JSON.stringify(actual) === JSON.stringify(expected)).toBe(true); };
      checkpoint = '连接观察器'; audit.scope = 'observer'; observer = await owner.step(() => connection.connect(binding.profile));
      checkpoint = '核验实际实例身份和TLS';
      const identity = await sql('SELECT @@hostname AS hostname,@@port AS port,@@server_id AS serverId,@@version_compile_os AS os,@@lower_case_table_names AS lowerNames');
      const uuid = binding.dialect === 'mysql' ? await sql('SELECT @@server_uuid AS uuid') : undefined;
      assertTableRenameMatrixIdentity(identity, binding, observer.status, uuid);
      const cipher = await sql("SHOW SESSION STATUS LIKE 'Ssl_cipher'");
      expect(cipher.length === 1 && typeof cipher[0].Value === 'string' && (cipher[0].Value.length > 0) === !!binding.profile.tls?.enabled).toBe(true);
      engine = new engineModule.Engine(event => events.push({ ...event, ...(event.tableRename ? { tableRename: { ...event.tableRename } } : {}) }));
      /** 操作必须等原Promise和原流close，服务端写入只允许当前单条预览原文。 */
      const invoke = async <T>(command: EngineCommand, input: Record<string, unknown>, expectedSql?: string) => {
        checkpoint = '引擎命令：' + command;
        audit.scope = crypto.randomUUID(); allowedSql = expectedSql; const first = facts.length, eventStart = events.length;
        const result = await owner.step(async () => { try { return { value: await engine!.handle(command, input) as T }; } catch (error) { return { error }; } });
        const actual = facts.slice(first); for (const fact of actual) await owner.step(() => fact.closed);
        assertTableRenameMatrixReleased(actual, command.startsWith('schema.')); allowedSql = undefined;
        return { ...result, facts: actual, events: events.slice(eventStart) };
      };
      const opened = await invoke('connections.open', { id: binding.profile.id, profile: binding.profile }); expect(opened.error).toBeUndefined(); expect(opened.facts).toHaveLength(1);
      for (const schema of [database, viewDatabase]) {
        checkpoint = '创建隔离库：' + (schema === database ? '主库' : '视图库');
        expect(await sql('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE BINARY SCHEMA_NAME=BINARY ?', [schema])).toHaveLength(0);
        created.set(schema, 'unknown'); expect((await sql<{ warningStatus: number }>(`CREATE DATABASE ${quote.identifier(schema)} CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`)).warningStatus).toBe(0); created.set(schema, 'confirmed');
      }
      // 5.7原生探针证明：无默认库时派生表CREATE VIEW报1142；只设置观察器的本例原视图库，不改变Engine配置或授权。
      checkpoint = '保存并设置观察器原视图库'; const originalDatabase = await sql('SELECT DATABASE() AS databaseName');
      same(originalDatabase, [{ databaseName: null }]); await sql('USE ' + quote.identifier(viewDatabase));
      same(await sql('SELECT DATABASE() AS databaseName'), [{ databaseName: viewDatabase }]);
      checkpoint = '保存并设置观察器模式和时区'; const originalSession = await sql('SELECT @@SESSION.sql_mode AS mode,@@SESSION.time_zone AS zone');
      const originalMode = originalSession[0]?.mode, originalZone = originalSession[0]?.zone;
      if (typeof originalMode !== 'string' || !/^[A-Z0-9_,]*$/i.test(originalMode) || typeof originalZone !== 'string') throw Error('重命名观察器原模式或时区未知');
      const modes = new Set(originalMode.split(',').filter(Boolean)); modes.add('NO_AUTO_VALUE_ON_ZERO');
      await sql('SET SESSION sql_mode = ?', [[...modes].join(',')]); await sql("SET SESSION time_zone = '+00:00'");
      const fixtureSession = await sql('SELECT @@SESSION.sql_mode AS mode,@@SESSION.time_zone AS zone');
      /** 所有表记录本例唯一标记，不把同名外部对象当作可清理资源。 */
      const createTable = async (name: string, columns = 'k INT NOT NULL PRIMARY KEY,note VARCHAR(80) NULL', schema = database) => {
        const key = schema + '/' + name, comment = marker + ':' + (schema === database ? 'primary:' : 'views:') + name;
        if (tables.has(key) || !/^[a-z][a-z0-9_]*$/.test(name)) throw Error('重命名夹具名称重复或未知');
        checkpoint = '创建夹具表：' + (schema === database ? '主库/' : '视图库/') + fixtureName(name);
        const header = await sql<{ warningStatus: number }>(`CREATE TABLE ${target(name, schema)}(${columns}) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='${comment}'`);
        tables.set(key, { schema, name, comment }); expect(header.warningStatus).toBe(0);
      };
      const definition = async (name: string, schema = database) => { checkpoint = '读回表定义：' + fixtureName(name); return String((await sql(`SHOW CREATE TABLE ${target(name, schema)}`))[0]['Create Table']); };
      const exists = async (name: string, schema = database) => { checkpoint = '核验名称存在性：' + fixtureName(name); return (await sql('SELECT TABLE_NAME FROM information_schema.TABLES WHERE BINARY TABLE_SCHEMA=BINARY ? AND BINARY TABLE_NAME=BINARY ?', [schema, name])).length !== 0; };
      /** 实际系统目录按已核验方言选择，旧版不得查询不存在的INNODB_TABLES。 */
      const physical = async (name: string) => {
        checkpoint = '读回物理编号：' + fixtureName(name);
        const catalog = binding.dialect === 'mysql' && binding.version.startsWith('8.') ? 'INNODB_TABLES' : 'INNODB_SYS_TABLES';
        const result = await sql(`SELECT CAST(TABLE_ID AS CHAR) AS id,NAME AS name FROM information_schema.${catalog} WHERE BINARY NAME=BINARY ?`, [database + '/' + name]);
        expect(result.length === 1 && typeof result[0].id === 'string' && /^[1-9]\d*$/.test(result[0].id) && result[0].name === database + '/' + name).toBe(true); return result[0].id as string;
      };
      const columns = (name: string) => { checkpoint = '读回字段目录：' + fixtureName(name); return sql('SELECT COLUMN_NAME,ORDINAL_POSITION,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT,COLUMN_COMMENT,EXTRA,GENERATION_EXPRESSION,CHARACTER_SET_NAME,COLLATION_NAME FROM information_schema.COLUMNS WHERE BINARY TABLE_SCHEMA=BINARY ? AND BINARY TABLE_NAME=BINARY ? ORDER BY ORDINAL_POSITION', [database, name]); };
      const indexes = (name: string) => { checkpoint = '读回索引目录：' + fixtureName(name); return sql('SELECT INDEX_NAME,NON_UNIQUE,SEQ_IN_INDEX,COLUMN_NAME,COLLATION,SUB_PART,INDEX_TYPE,INDEX_COMMENT FROM information_schema.STATISTICS WHERE BINARY TABLE_SCHEMA=BINARY ? AND BINARY TABLE_NAME=BINARY ? ORDER BY BINARY INDEX_NAME,SEQ_IN_INDEX', [database, name]); };
      const data = (name: string) => { checkpoint = '读回保真原行：' + fixtureName(name); return sql(`SELECT CAST(k AS CHAR) AS k,CAST(id AS CHAR) AS id,CAST(amount AS CHAR) AS amount,HEX(payload) AS payload,HEX(note) AS note,CAST(g AS CHAR) AS generatedValue,DATE_FORMAT(happened,'%Y-%m-%d %H:%i:%s.%f') AS happened,DATE_FORMAT(created_at,'%Y-%m-%d %H:%i:%s.%f') AS createdAt FROM ${target(name)} ORDER BY k`); };
      /** CREATE VIEW后保存原SHOW，成功清理前必须逐项读回同一归属。 */
      const createView = async (name: string, select: string, schema = viewDatabase) => {
        const key = schema + '/' + name; if (views.has(key)) throw Error('视图夹具名称重复');
        checkpoint = '创建夹具视图：' + (schema === database ? '主库/' : '视图库/') + fixtureName(name);
        expect((await sql<{ warningStatus: number }>(`CREATE VIEW ${target(name, schema)} AS ${select}`)).warningStatus).toBe(0);
        checkpoint = '读回视图定义：' + fixtureName(name);
        const source = String((await sql(`SHOW CREATE VIEW ${target(name, schema)}`))[0]['Create View']); views.set(key, { schema, name, source });
      };
      const get = async (name: string) => {
        const result = await invoke<TableRenameGetOutput>('schema.tableRename.get', { connectionId: binding.profile.id, database, table: name, taskId: crypto.randomUUID(), connectionRevision: 1 });
        expect(result.error).toBeUndefined(); expect(result.facts).toHaveLength(1); expect(result.facts.flatMap(fact => fact.writes)).toEqual([]); return result;
      };
      const preview = (snapshot: TableRenameGetOutput, newName: string) => invoke<TableRenamePreviewOutput>('schema.tableRename.preview', { snapshotId: snapshot.snapshotId, newName, taskId: crypto.randomUUID(), connectionRevision: 1 });
      const apply = (plan: TableRenamePreviewOutput, write: boolean, acknowledgements = plan.requiredAcknowledgements, revision = 1) => invoke<TableRenameApplyOutput>('schema.tableRename.apply', { previewToken: plan.previewToken, acknowledgements, taskId: crypto.randomUUID(), connectionRevision: revision }, write ? plan.sql : undefined);
      const release = async (snapshot: TableRenameGetOutput) => {
        const result = await invoke('schema.tableRename.release', { snapshotId: snapshot.snapshotId }); expect(result.error).toBeUndefined(); expect(result.facts).toHaveLength(0);
      };
      /** 明确拒绝同时核零DDL；错误文字不代替实际发送证据。 */
      const refused = (result: { error?: unknown; facts: TableRenameMatrixFact[] }) => { expect(result.error).toBeInstanceOf(Error); expect(result.facts.flatMap(fact => fact.writes)).toEqual([]); };
      await createTable('subject', "k INT NOT NULL PRIMARY KEY,id BIGINT NOT NULL AUTO_INCREMENT,note VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL DEFAULT NULL COMMENT '保真字符',amount DECIMAL(30,10) NOT NULL,payload BLOB,happened DATETIME(6) NOT NULL,created_at TIMESTAMP(6) NULL DEFAULT CURRENT_TIMESTAMP(6),g INT GENERATED ALWAYS AS(char_length(note)) STORED,KEY idx_auto(id),UNIQUE KEY uq_note_k(note,k),KEY pref(note(8),k)");
      const samples = [[1, '-9', "中文😀'\\\0", '12345678901234567890.1234567890', Buffer.from('0001ff', 'hex'), '2001-02-03 04:05:06.123456', '2002-03-04 05:06:07.654321'], [2, '0', null, '0.0000000001', null, '2003-04-05 06:07:08.000001', null], [3, '0', '', '-1.0000000001', Buffer.alloc(0), '2004-05-06 07:08:09.999999', '2005-06-07 08:09:10.000001'], [4, '9007199254740993', 'é尾空格 ', '98765432109876543210.9999999999', Buffer.from('ff00', 'hex'), '2006-07-08 09:10:11.123456', '2007-08-09 10:11:12.999999']] satisfies (string | number | Buffer | null)[][];
      checkpoint = '写入保真原行：subject'; for (const row of samples) expect((await sql<{ warningStatus: number }>(`INSERT INTO ${target('subject')}(k,id,note,amount,payload,happened,created_at) VALUES(?,?,?,?,?,?,?)`, row)).warningStatus).toBe(0);
      const baseline = await data('subject'), baselineDefinition = await definition('subject'), baselineColumns = await columns('subject'), baselineIndexes = await indexes('subject'), baselineId = await physical('subject');
      expect(baseline.length === samples.length && baseline.every((row, index) => {
        const sample = samples[index], note = sample[2], payload = sample[4];
        return row.id === sample[1] && row.amount === sample[3] && row.happened === sample[5] && row.createdAt === sample[6] && row.note === (note === null ? null : Buffer.from(String(note)).toString('hex').toUpperCase()) && row.payload === (Buffer.isBuffer(payload) ? payload.toString('hex').toUpperCase() : null) && row.generatedValue === (note === null ? null : String([...String(note)].length));
      })).toBe(true);
      await createTable('unrelated'); await createTable('subject', undefined, viewDatabase);
      await createView('unrelated_alias', `SELECT other.k AS subject,'subject' AS label FROM ${target('unrelated')} AS other`);
      await createView('unrelated_same_name', `SELECT k FROM ${target('subject', viewDatabase)}`);
      await createView('unrelated_derived', `SELECT subject.k FROM (SELECT k FROM ${target('unrelated')}) AS subject`);
      const hasCte = !(binding.dialect === 'mysql' && binding.version.startsWith('5.7.'));
      if (hasCte) await createView('unrelated_cte', `WITH subject AS (SELECT k FROM ${target('unrelated')}) SELECT k FROM subject`);
      const initial = (await get('subject')).value!; expect(initial.writable).toBe(true); expect(initial.tableId).toBe(baselineId);
      const ackPlan = await preview(initial, 'subject_new'); expect(ackPlan.error).toBeUndefined(); expect(ackPlan.facts.flatMap(fact => fact.writes)).toEqual([]);
      expect(ackPlan.value!.requiredAcknowledgements).toEqual(['ddl-implicit-commit', 'external-ddl-window', 'references-and-grants']);
      refused(await apply(ackPlan.value!, false, ['ddl-implicit-commit', 'external-ddl-window']));
      const used = await apply(ackPlan.value!, false); refused(used); expect(used.facts).toHaveLength(0);
      const releasedPlan = await preview(initial, 'subject_new'); expect(releasedPlan.error).toBeUndefined(); await release(initial);
      const released = await apply(releasedPlan.value!, false); refused(released); expect(released.facts).toHaveLength(0);
      const revised = await preview((await get('subject')).value!, 'subject_new'); expect(revised.error).toBeUndefined();
      const revision = await apply(revised.value!, false, revised.value!.requiredAcknowledgements, 2); refused(revision); expect(revision.facts).toHaveLength(0);
      let successfulRenames = 0;
      /** 只改SHOW头部表名；所有其余原文、实际目录、原行和TABLE_ID必须保持。 */
      const rename = async (from: string, to: string) => {
        const before = await definition(from), snapshot = (await get(from)).value!; expect(snapshot.writable).toBe(true); expect(snapshot.tableId).toBe(baselineId);
        const plan = await preview(snapshot, to); expect(plan.error).toBeUndefined(); expect(plan.facts.flatMap(fact => fact.writes)).toEqual([]);
        expect(plan.value!.sql).toBe(`RENAME TABLE ${target(from)} TO ${target(to)};`); same(await definition(from), before); same(await data(from), baseline);
        const result = await apply(plan.value!, true); expect(result.error).toBeUndefined();
        expect(result.value).toMatchObject({ ddlSubmitted: true, ddlCompleted: true, definitionVerified: true, warnings: [], after: { tableId: baselineId } });
        expect(result.facts.flatMap(fact => fact.writes)).toEqual([plan.value!.sql]); expect(result.facts.flatMap(fact => fact.renameWarnings)).toEqual([0]); expect(result.facts.flatMap(fact => fact.renameErrors)).toEqual([undefined]);
        const original = tables.get(database + '/' + from)!; tables.delete(database + '/' + from); tables.set(database + '/' + to, { ...original, name: to });
        expect(await exists(from)).toBe(false); expect(await physical(to)).toBe(baselineId);
        const prefix = 'CREATE TABLE ' + quote.identifier(from), afterPrefix = 'CREATE TABLE ' + quote.identifier(to), after = await definition(to);
        expect(before.startsWith(prefix) && after.startsWith(afterPrefix)).toBe(true); same(after.slice(afterPrefix.length), before.slice(prefix.length));
        same(await data(to), baseline); same(await columns(to), baselineColumns); same(await indexes(to), baselineIndexes);
        const repeated = await apply(plan.value!, false); refused(repeated); expect(repeated.facts).toHaveLength(0); successfulRenames++;
      };
      await rename('subject', 'subject_new'); await rename('subject_new', 'subject'); same(await definition('subject'), baselineDefinition);
      await createTable('occupied');
      const conflictSnapshot = (await get('subject')).value!; refused(await preview(conflictSnapshot, 'occupied'));
      const latePlan = await preview(conflictSnapshot, 'late_occupied'); expect(latePlan.error).toBeUndefined(); await createTable('late_occupied'); refused(await apply(latePlan.value!, false));
      same(await definition('subject'), baselineDefinition); same(await data('subject'), baseline);
      const externalPlan = await preview((await get('subject')).value!, 'subject_external'); expect(externalPlan.error).toBeUndefined();
      checkpoint = '构造外部定义变化：subject'; const changedComment = marker + ':primary:subject_changed'; await sql(`ALTER TABLE ${target('subject')} COMMENT='${changedComment}'`); tables.get(database + '/subject')!.comment = changedComment;
      const changedDefinition = await definition('subject'); refused(await apply(externalPlan.value!, false)); same(await definition('subject'), changedDefinition); same(await data('subject'), baseline);
      await createTable('identity', 'k INT NOT NULL PRIMARY KEY,note VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL'); const oldIdentity = (await get('identity')).value!, oldDefinition = await definition('identity');
      const identityPlan = await preview(oldIdentity, 'identity_new'); expect(identityPlan.error).toBeUndefined();
      checkpoint = '构造同定义换物理对象：identity'; await sql(`DROP TABLE ${target('identity')}`);
      const head = 'CREATE TABLE `identity`'; if (!oldDefinition.startsWith(head)) throw Error('换实体夹具SHOW头部未知');
      await sql('CREATE TABLE ' + target('identity') + oldDefinition.slice(head.length)); same(await definition('identity'), oldDefinition);
      expect(await physical('identity')).not.toBe(oldIdentity.tableId); refused(await apply(identityPlan.value!, false)); expect(await exists('identity_new')).toBe(false);

      // 实际跨schema直接视图与间接链同时存在；旧版还旁观逐SHOW，不能仅扫描当前库。
      await createView('cross_direct', `SELECT k,note FROM ${target('subject')}`);
      await createView('cross_chain_one', `SELECT k FROM ${target('cross_direct', viewDatabase)}`);
      await createView('cross_chain_two', `SELECT k FROM ${target('cross_chain_one', viewDatabase)}`);
      const viewGuard = await get('subject'); expect(viewGuard.value!.writable).toBe(false); refused(await preview(viewGuard.value!, 'view_blocked'));
      const oldCatalog = binding.dialect === 'mariadb' || binding.version.startsWith('5.7.');
      if (oldCatalog) {
        const observed = new Set(viewGuard.facts.flatMap(fact => fact.viewReads));
        expect([...views.values()].every(view => observed.has('SHOW CREATE VIEW ' + target(view.name, view.schema)))).toBe(true);
      }
      same(await data('subject'), baseline); same(await definition('subject'), changedDefinition);
      await createTable('parent'); await createTable('child', `k INT PRIMARY KEY,parent_id INT,CONSTRAINT fk_parent FOREIGN KEY(parent_id) REFERENCES ${target('parent')}(k)`);
      await createTable('triggered');
      checkpoint = '创建并读回真实触发器'; const trigger = 'tr_before_insert'; expect((await sql<{ warningStatus: number }>(`CREATE TRIGGER ${target(trigger)} BEFORE INSERT ON ${target('triggered')} FOR EACH ROW SET NEW.note='${marker}'`)).warningStatus).toBe(0);
      const triggerFacts = await sql('SELECT TRIGGER_NAME,EVENT_OBJECT_TABLE,ACTION_TIMING,EVENT_MANIPULATION,ACTION_STATEMENT FROM information_schema.TRIGGERS WHERE BINARY TRIGGER_SCHEMA=BINARY ? ORDER BY BINARY TRIGGER_NAME', [database]);
      expect(triggerFacts.length === 1 && triggerFacts[0].TRIGGER_NAME === trigger && triggerFacts[0].EVENT_OBJECT_TABLE === 'triggered').toBe(true);
      const guarded = ['parent', 'child', 'triggered'];
      if (hasCte) { await createTable('checked', 'k INT PRIMARY KEY,note VARCHAR(80),CONSTRAINT chk_k CHECK(k>0)'); expect(/\bCHECK\b/i.test(await definition('checked'))).toBe(true); guarded.push('checked'); }
      for (const name of guarded) {
        const before = await definition(name), snapshot = (await get(name)).value!; expect(snapshot.writable).toBe(false); expect(snapshot.reasons.length > 0).toBe(true);
        refused(await preview(snapshot, name + '_blocked')); same(await definition(name), before); expect(await exists(name + '_blocked')).toBe(false);
      }

      await createTable('cancelled'); await sql(`INSERT INTO ${target('cancelled')} VALUES(1,'保留')`);
      const cancelSnapshot = (await get('cancelled')).value!, cancelPlan = await preview(cancelSnapshot, 'cancelled_new'), siblingPlan = await preview(cancelSnapshot, 'cancelled_sibling');
      expect(cancelSnapshot.writable).toBe(true); expect(cancelPlan.error).toBeUndefined(); expect(siblingPlan.error).toBeUndefined();
      const cancelDefinition = await definition('cancelled'), cancelRows = await sql(`SELECT k,HEX(note) AS note FROM ${target('cancelled')} ORDER BY k`), cancelId = await physical('cancelled');
      checkpoint = '观察器取得原表MDL'; await sql('START TRANSACTION'); await sql(`SELECT k FROM ${target('cancelled')}`); holdingMdl = true;
      const firstCancelFact = facts.length, cancelTaskId = crypto.randomUUID(), applyScope = crypto.randomUUID(), cancelScope = crypto.randomUUID(); mdlFactStart = firstCancelFact;
      /** 单owner包住原并行操作：真实MDL状态→KILL→原Promise/流结束→ROLLBACK，不以sleep或提前解锁假造取消。 */
      await owner.step(async () => {
        checkpoint = '投递原重命名并观察真实MDL等待';
        audit.scope = applyScope; allowedSql = cancelPlan.value!.sql; renameSettled = false;
        const pending = engine!.handle('schema.tableRename.apply', { previewToken: cancelPlan.value!.previewToken, acknowledgements: cancelPlan.value!.requiredAcknowledgements, taskId: cancelTaskId, connectionRevision: 1 }).then(value => { renameSettled = true; return { value, error: undefined }; }, error => { renameSettled = true; return { value: undefined, error }; });
        const started = Date.now(); let blocked: TableRenameMatrixFact | undefined;
        while (!blocked) {
          owner.check(); if (renameSettled) throw Error('RENAME在确认真实MDL等待前已结束');
          const candidate = facts.find(fact => fact.scope === applyScope);
          if (candidate) {
            audit.scope = 'observer'; const live = (await connection.execute<Record<string, unknown>[]>(observer!, 'SELECT ID,STATE,INFO FROM information_schema.PROCESSLIST WHERE ID=?', [candidate.id])).rows; owner.check();
            if (live.length === 1 && Number(live[0].ID) === candidate.id && typeof live[0].STATE === 'string' && /waiting for table metadata lock/i.test(live[0].STATE) && typeof live[0].INFO === 'string' && live[0].INFO.replace(/;\s*$/, '').trim() === cancelPlan.value!.sql.replace(/;\s*$/, '').trim()) blocked = candidate;
          }
          if (!blocked) { if (Date.now() - started >= 15000) throw Error('未在原期限内确认服务器真实MDL等待，保留现场'); await new Promise(resolve => setTimeout(resolve, 25)); }
        }
        checkpoint = '取消原MDL线程并等原任务终态'; allowedKillThread = blocked.id; audit.scope = cancelScope; await engine!.handle('query.cancel', { taskId: cancelTaskId }); owner.check(); allowedKillThread = undefined;
        const outcome = await pending; owner.check(); expect(outcome.error).toBeInstanceOf(Error);
        const actual = facts.slice(firstCancelFact); for (const fact of actual) { await fact.closed; owner.check(); }
        expect(actual.flatMap(fact => fact.writes)).toEqual([cancelPlan.value!.sql]);
        expect(actual.flatMap(fact => fact.killConnections)).toEqual([blocked.id]); expect(actual).toHaveLength(2);
        const controls = actual.filter(fact => fact.killConnections.length === 1); expect(controls).toHaveLength(1);
        // 原回调与远端FIN分别证明；两种情况都在观察器仍持锁时查原两线程为0，再签私有一次凭证。
        expect(holdingMdl).toBe(true); checkpoint = '持MDL核验原终态与原线程零残留';
        mdlReceipt = await proveTableRenameMdlTerminal(blocked, controls[0], owner, async ids => {
          owner.check(); const rows = (await connection.execute<Record<string, unknown>[]>(observer!, 'SELECT ID FROM information_schema.PROCESSLIST WHERE ID IN (?,?)', [...ids])).rows; owner.check(); return rows;
        });
        expect(holdingMdl).toBe(true); assertTableRenameMatrixReleased(actual, true);
        if (mdlReceipt.branch === 'failed-callback') {
          expect(actual.flatMap(fact => fact.renameFailed)).toEqual([true]); expect(actual.flatMap(fact => fact.renameErrors)).toHaveLength(1);
          expect(actual.flatMap(fact => fact.renameWarnings)).toEqual([undefined]); expect(blocked.pending).toBe(0);
        } else {
          expect(actual.flatMap(fact => fact.renameFailed)).toEqual([]); expect(actual.flatMap(fact => fact.renameErrors)).toEqual([]);
          expect(actual.flatMap(fact => fact.renameErrorCodes)).toEqual([]); expect(actual.flatMap(fact => fact.renameWarnings)).toEqual([]); expect(blocked.pending).toBe(1);
        }
        expect(events.some(event => event.taskId === cancelTaskId && event.tableRename?.ddlSubmitted === true && event.tableRename.ddlCompleted === false && event.tableRename.outcome === 'unknown')).toBe(true);
        checkpoint = '原任务及流终态后回滚观察器'; audit.scope = 'observer'; await connection.execute(observer!, 'ROLLBACK'); owner.check(); holdingMdl = false; allowedSql = undefined;
      });
      same(await definition('cancelled'), cancelDefinition); same(await sql(`SELECT k,HEX(note) AS note FROM ${target('cancelled')} ORDER BY k`), cancelRows);
      expect(await physical('cancelled')).toBe(cancelId); expect(await exists('cancelled_new')).toBe(false); expect(await exists('cancelled_sibling')).toBe(false);
      const cancelReplay = await apply(cancelPlan.value!, false), siblingReplay = await apply(siblingPlan.value!, false); refused(cancelReplay); refused(siblingReplay); expect(cancelReplay.facts).toHaveLength(0); expect(siblingReplay.facts).toHaveLength(0);
      checkpoint = '核验并恢复观察器模式和时区'; same(await sql('SELECT @@SESSION.sql_mode AS mode,@@SESSION.time_zone AS zone'), fixtureSession);
      await sql('SET SESSION sql_mode = ?', [originalMode]); await sql('SET SESSION time_zone = ?', [originalZone]); same(await sql('SELECT @@SESSION.sql_mode AS mode,@@SESSION.time_zone AS zone'), originalSession);
      const taskFacts = facts.filter(fact => fact.scope !== 'observer'), ddlCount = taskFacts.flatMap(fact => fact.writes).length;
      expect(successfulRenames).toBe(2); expect(ddlCount).toBe(3);
      process.stdout.write(JSON.stringify({
        专项: '表重命名兼容', 阶段: '行为审计', 端口: binding.profile.port, 数据库: database, 视图数据库: viewDatabase,
        版本: observer.status.version, 方言: binding.dialect, 严格TLS: !!binding.profile.tls?.enabled,
        成功RENAME: successfulRenames, MDL取消投递: 1, 总DDL: ddlCount,
        原RENAME警告: taskFacts.flatMap(fact => fact.renameWarnings).map(value => value ?? null),
        原RENAME错误编号: taskFacts.flatMap(fact => fact.renameErrors).map(value => value ?? null),
        原RENAME错误代码: taskFacts.flatMap(fact => fact.renameErrorCodes).map(value => value ?? null),
        原MDL事件诊断: mdlDiagnostics(),
        MDL终态证明: mdlReceipt,
        往返完整定义原行与物理ID保持: true,
        BIGINT负值零值DECIMAL二进制NULLUnicode微秒生成与索引保持: true, 预览零DDL: true,
        缺确认消费与重复释放修订拒绝: true, 目标预占及迟到占用拒绝: true, 外部DDL及同定义换实体拒绝: true,
        无关视图别名文字量与异库同名表未误挡: true, 真实跨库直接及间接视图链存在时拒绝: true,
        旧目录全局逐视图读取: oldCatalog ? true : '现代实例使用VIEW_TABLE_USAGE', CTE同名遮蔽: hasCte ? true : '5.7不支持CTE，未构造',
        外键双端与触发器拒绝: true, 真实CHECK拒绝: hasCte ? true : '5.7不保留CHECK，未伪造此边界',
        原生MDL等待已观察: true, 原取消任务及流结束后回滚: true, 未知提交撤销同快照预览: true,
        观察器模式与时区恢复: true, TTL与断线限权: '本专项未验，不替换原120秒时钟',
      }) + '\n');
      checkpoint = '原Engine关闭与原线程零残留'; await owner.step(() => engine!.closeAll()); assertTableRenameMatrixReleased(taskFacts, false);
      const ids = [...new Set(taskFacts.map(fact => fact.id))]; if (ids.length) expect(await sql(`SELECT ID FROM information_schema.PROCESSLIST WHERE ID IN (${ids.join(',')})`)).toHaveLength(0);
      // 成功收尾先逐个验证两个库内的全部表/视图/触发器归属，再删除精确登记对象与两个随机库。
      checkpoint = '精确清理前核验全部对象归属';
      for (const schema of [database, viewDatabase]) {
        const expected = [...tables.values()].filter(value => value.schema === schema).map(value => ({ name: value.name, kind: 'BASE TABLE', comment: value.comment })).concat([...views.values()].filter(value => value.schema === schema).map(value => ({ name: value.name, kind: 'VIEW', comment: 'VIEW' }))).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
        same(await sql('SELECT TABLE_NAME AS name,TABLE_TYPE AS kind,TABLE_COMMENT AS comment FROM information_schema.TABLES WHERE BINARY TABLE_SCHEMA=BINARY ? ORDER BY BINARY TABLE_NAME', [schema]), expected);
        for (const [view, column] of [['ROUTINES', 'ROUTINE_SCHEMA'], ['EVENTS', 'EVENT_SCHEMA']]) expect(await sql(`SELECT 1 FROM information_schema.${view} WHERE BINARY ${column}=BINARY ? LIMIT 1`, [schema])).toHaveLength(0);
      }
      for (const view of views.values()) same(String((await sql(`SHOW CREATE VIEW ${target(view.name, view.schema)}`))[0]['Create View']), view.source);
      same(await sql('SELECT TRIGGER_NAME,EVENT_OBJECT_TABLE,ACTION_TIMING,EVENT_MANIPULATION,ACTION_STATEMENT FROM information_schema.TRIGGERS WHERE BINARY TRIGGER_SCHEMA=BINARY ? ORDER BY BINARY TRIGGER_NAME', [database]), triggerFacts);
      expect(await sql('SELECT TRIGGER_NAME FROM information_schema.TRIGGERS WHERE BINARY TRIGGER_SCHEMA=BINARY ?', [viewDatabase])).toHaveLength(0);
      if ([database, viewDatabase].some(schema => created.get(schema) !== 'confirmed') || !/^dbark_e2e_rnmx_[a-f0-9]{32}$/.test(database) || !/^dbark_e2e_rnmxv_[a-f0-9]{32}$/.test(viewDatabase)) throw Error('重命名兼容两个原库归属未证明，禁止清理');
      checkpoint = '精确清理已登记对象与两个随机库'; for (const view of [...views.values()].reverse()) await sql(`DROP VIEW ${target(view.name, view.schema)}`);
      await sql(`DROP TRIGGER ${target(trigger)}`);
      for (const schema of [viewDatabase, database]) {
        await sql('DROP DATABASE ' + quote.identifier(schema)); created.set(schema, 'absent'); expect(await sql('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE BINARY SCHEMA_NAME=BINARY ?', [schema])).toHaveLength(0);
        // 删除当前精确视图库后由服务器恢复原NULL默认库，不能用本地状态或新的会话替代读回。
        if (schema === viewDatabase) same(await sql('SELECT DATABASE() AS databaseName'), originalDatabase);
      }
      checkpoint = '观察器原生流严格关闭'; await owner.step(() => closeTableRenameMatrixObserver(observer!)); assertTableRenameMatrixReleased(facts, false); owner.finish(); complete = true;
      audit.watch = undefined; audit.check = undefined; audit.scope = '';
      process.stdout.write(JSON.stringify({ 专项: '表重命名兼容', 阶段: '精确清理', 端口: binding.profile.port, 已清理数据库: [database, viewDatabase], 原生流全部关闭: true, 原任务线程残留: 0, 总DDL: ddlCount }) + '\n');
    } catch (reason) {
      owner.stop(); retained = true;
      // 只摘取原异常自有标量诊断，不读取message/sql/values，也不调用自定义getter或序列化原异常。
      const fields = reason && typeof reason === 'object' ? Object.getOwnPropertyDescriptors(reason) : {};
      const code = fields.code?.value, errno = fields.errno?.value, state = fields.sqlState?.value;
      const errorCode = typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,95}$/.test(code) ? code : null;
      const errorNumber = typeof errno === 'number' && Number.isSafeInteger(errno) && errno >= 0 ? errno : null;
      const sqlState = typeof state === 'string' && /^[A-Z0-9]{5}$/.test(state) ? state : null;
      process.stdout.write(JSON.stringify({ 专项: '表重命名兼容', 阶段: '失败保留', 端口: binding.profile.port, 当前步骤: checkpoint, 错误代码: errorCode, 错误编号: errorNumber, SQL状态: sqlState, 保留现场: true, 数据库: database, 视图数据库: viewDatabase, 数据库状态: [...created], 观察器仍持MDL: holdingMdl, 原重命名已结束: renameSettled, MDL终态证明: mdlReceipt ?? null, 原MDL事件诊断: mdlDiagnostics(), 原生线程: facts.map(fact => ({ id: fact.id, scope: fact.scope === 'observer' ? 'observer' : 'task', pending: fact.pending, closed: fact.sawClose, closeFailed: fact.closeFailed })) }) + '\n');
      throw reason;
    } finally {
      // 未确认RENAME原终态时，不能关闭持锁观察器提前解锁；留给Root独立核验源/目标与原线程。
      if (!complete && observer && (!holdingMdl || renameSettled)) try { await observer.close({ strict: true }); } catch { /* 保留首因，不新连、不自动drop或重放。 */ }
    }
  });
});
