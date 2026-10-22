import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ManagedConnection } from '../../src/engine/connection';
import type { EngineCommand, TaskEvent } from '../../src/shared/contracts';
import type { ColumnPatch, TableColumnApplyOutput, TableColumnGetOutput, TableColumnPreviewOutput } from '../../src/shared/tableColumnPatches';
import type { TableEncodingPair } from '../../src/shared/tableDefaultEncoding';
import {
  bindColumnEncodingTarget, columnEncodingIntegrationGate, columnEncodingLifetime,
  loadColumnEncodingModules, assertColumnEncodingIdentity, watchColumnEncodingConnection,
  assertColumnEncodingReleased, closeColumnEncodingObserver,
  type ColumnEncodingConnectionFact, type ColumnEncodingLifetime,
} from '../helpers/columnEncodingIntegration';

const audit = vi.hoisted(() => ({
  watch: undefined as undefined | ((managed: ManagedConnection, scope: string) => void),
  check: undefined as undefined | (() => void), scope: '',
}));
/** 原connect参数、认证、连接和响应全部透传，只旁观本轮原生物理流。 */
vi.mock('../../src/engine/connection', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/engine/connection')>();
  return { ...actual, connect: async (...args: Parameters<typeof actual.connect>) => {
    if (!audit.watch || !audit.check || !audit.scope) throw Error('列字符集原连接没有本轮owner');
    audit.check(); const scope = audit.scope, managed = await actual.connect(...args);
    audit.watch(managed, scope); return managed;
  } };
});

let lifetime: ColumnEncodingLifetime | undefined, retained = false, complete = false;
afterEach(() => { if (lifetime && !complete) { retained = true; lifetime.stop(); } lifetime?.end(); });

describe.sequential('现有列字符集转换六实例实库（逐端口独立进程）', () => {
  it('完整往返保真、真实目录、预检边界、一次COPY及原线程收尾', { timeout: 120000, retry: 0, repeats: 0 }, async context => {
    if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || process.env[columnEncodingIntegrationGate] !== '1') { context.skip(); return; }
    if (retained) throw Error('列字符集原验收仍保留现场，禁止自动重跑');
    const binding = bindColumnEncodingTarget(() => process.env, 'colenc-' + context.task.id);
    const owner = lifetime = columnEncodingLifetime(context, binding, () => { retained = true; });
    const facts: ColumnEncodingConnectionFact[] = [], events: TaskEvent[] = [];
    let allowedSql: string | undefined, observer: ManagedConnection | undefined, engine: import('../../src/engine/index').Engine | undefined;
    let database = '', marker = '', created: 'absent' | 'unknown' | 'confirmed' = 'absent';
    audit.check = owner.check;
    audit.watch = (managed, scope) => { facts.push(watchColumnEncodingConnection(managed, scope, owner, () => allowedSql)); };
    try {
      const { engine: engineModule, connection } = await owner.step(loadColumnEncodingModules);
      const [quote, crypto] = await owner.step(() => Promise.all([import('../../src/engine/sql'), import('node:crypto')]));
      database = 'dbark_e2e_colenc_' + crypto.randomUUID().replaceAll('-', ''); marker = 'dbark-colenc-owner:' + crypto.randomUUID();
      if (!/^dbark_e2e_colenc_[a-f0-9]{32}$/.test(database)) throw Error('列字符集原资源计划无效');
      process.stdout.write(JSON.stringify({ 专项: '列字符集转换', 阶段: '原资源计划', 端口: binding.profile.port, 数据库: database, 所有者标记: marker }) + '\n');
      const db = quote.identifier(database), table = (name: string) => db + '.' + quote.identifier(name);
      const owned = new Map<string, string>();
      /** 同一observer完成身份、夹具、独立核对及精确清理；未知状态后不能另连补救。 */
      const sql = async <T = Record<string, unknown>[]>(text: string, values: (string | number | boolean | null | Buffer)[] = []): Promise<T> => {
        audit.scope = 'observer'; return (await owner.step(() => connection.execute<T>(observer!, text, values))).rows;
      };
      audit.scope = 'observer'; observer = await owner.step(() => connection.connect(binding.profile));
      const identity = await sql('SELECT @@hostname AS hostname,@@port AS port,@@server_id AS serverId,@@version_compile_os AS os,@@lower_case_table_names AS lowerNames');
      const uuidRows = binding.dialect === 'mysql' ? await sql('SELECT @@server_uuid AS uuid') : undefined;
      assertColumnEncodingIdentity(identity, binding, observer.status, uuidRows);
      const cipher = await sql("SHOW SESSION STATUS LIKE 'Ssl_cipher'");
      expect(cipher.length === 1 && typeof cipher[0].Value === 'string' && (cipher[0].Value.length > 0) === !!binding.profile.tls?.enabled).toBe(true);
      engine = new engineModule.Engine(event => events.push({ ...event, ...(event.columnPatch ? { columnPatch: { ...event.columnPatch } } : {}) }));
      /** 每次操作等待原方法及原流close；写入许可严格等于本次服务端预览SQL。 */
      const invoke = async <T>(command: EngineCommand, input: Record<string, unknown>, expectedSql?: string) => {
        audit.scope = crypto.randomUUID(); allowedSql = expectedSql;
        const first = facts.length, eventStart = events.length;
        const result = await owner.step(async () => { try { return { value: await engine!.handle(command, input) as T }; } catch (error) { return { error }; } });
        const actual = facts.slice(first); for (const fact of actual) await owner.step(() => fact.closed);
        assertColumnEncodingReleased(actual, command.startsWith('schema.')); allowedSql = undefined;
        return { ...result, facts: actual, events: events.slice(eventStart) };
      };
      const opened = await invoke('connections.open', { id: binding.profile.id, profile: binding.profile });
      expect(opened.error).toBeUndefined(); expect(opened.facts).toHaveLength(1);
      expect(await sql('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE BINARY SCHEMA_NAME=BINARY ?', [database])).toHaveLength(0);
      created = 'unknown'; expect((await sql<{ warningStatus: number }>(`CREATE DATABASE ${db} CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`)).warningStatus).toBe(0); created = 'confirmed';
      const originalModeRows = await sql('SELECT @@SESSION.sql_mode AS mode'), originalMode = originalModeRows[0]?.mode;
      if (typeof originalMode !== 'string' || !/^[A-Z0-9_,]*$/i.test(originalMode)) throw Error('列字符集observer原模式未知');
      const originalTimezoneRows = await sql('SELECT @@SESSION.time_zone AS zone'), originalTimezone = originalTimezoneRows[0]?.zone;
      if (typeof originalTimezone !== 'string' || !originalTimezone) throw Error('列字符集observer原时区未知');
      // 时间戳只在原observer固定UTC读写，并以服务器文本返回，避免JS Date或全局时区造成漂移。
      await sql("SET SESSION time_zone = '+00:00'");
      expect((await sql('SELECT @@SESSION.time_zone AS zone'))[0]?.zone === '+00:00').toBe(true);
      const fixtureModes = new Set(originalMode.split(',').filter(Boolean)); fixtureModes.add('STRICT_ALL_TABLES'); fixtureModes.add('NO_AUTO_VALUE_ON_ZERO');
      await sql('SET SESSION sql_mode = ?', [[...fixtureModes].join(',')]);
      const fixtureMode = await sql('SELECT @@SESSION.sql_mode AS mode');
      /** 所有已创建表登记精确COMMENT；utf8mb3夹具的弃用警告与目标ALTER零警告分开。 */
      const create = async (name: string, columns: string, encoding = 'utf8mb4 COLLATE utf8mb4_bin', allowAliasWarnings = false) => {
        if (!/^[a-z][a-z0-9_]*$/.test(name) || owned.has(name)) throw Error('列字符集夹具资源名重复或未知');
        const comment = marker + ':' + name;
        const header = await sql<{ warningStatus: number }>(`CREATE TABLE ${table(name)}(${columns}) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARSET=${encoding} COMMENT='${comment}'`);
        owned.set(name, comment);
        if (allowAliasWarnings) {
          const warnings = await sql('SHOW WARNINGS');
          expect(warnings.length === header.warningStatus && warnings.every(row => [1287, 3778].includes(Number(row.Code)))).toBe(true);
        } else expect(header.warningStatus).toBe(0);
      };
      /** 比较完整投影的布尔结果，避免Vitest失败输出原行、二进制内容或大文本。 */
      const same = (actual: unknown, expected: unknown) => { expect(JSON.stringify(actual) === JSON.stringify(expected)).toBe(true); };
      /** 编码归一后的值与原目录分别比对；仅目标编码/字节长度允许变化。 */
      const definition = async (name: string) => String((await sql(`SHOW CREATE TABLE ${table(name)}`))[0]['Create Table']);
      const values = async (name: string) => sql(`SELECT CAST(k AS CHAR) AS k,HEX(CONVERT(v USING utf8mb4)) AS valueBytes,v IS NULL AS isNull FROM ${table(name)} ORDER BY k`);
      const indexes = (name: string) => sql('SELECT INDEX_NAME,NON_UNIQUE,SEQ_IN_INDEX,COLUMN_NAME,COLLATION,SUB_PART,INDEX_TYPE,INDEX_COMMENT FROM information_schema.STATISTICS WHERE BINARY TABLE_SCHEMA=BINARY ? AND BINARY TABLE_NAME=BINARY ? ORDER BY BINARY INDEX_NAME,SEQ_IN_INDEX', [database, name]);
      const shape = (name: string) => sql('SELECT COLUMN_NAME,ORDINAL_POSITION,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT,COLUMN_COMMENT,EXTRA FROM information_schema.COLUMNS WHERE BINARY TABLE_SCHEMA=BINARY ? AND BINARY TABLE_NAME=BINARY ? ORDER BY ORDINAL_POSITION', [database, name]);
      const currentPair = async (name: string) => (await sql('SELECT CHARACTER_SET_NAME AS charset,COLLATION_NAME AS collation FROM information_schema.COLUMNS WHERE BINARY TABLE_SCHEMA=BINARY ? AND BINARY TABLE_NAME=BINARY ? AND BINARY COLUMN_NAME=BINARY ?', [database, name, 'v']))[0];
      /** 必须显式申请完整编码事实，拿真实columnRef驱动后续补丁。 */
      const get = async (name: string) => {
        const result = await invoke<TableColumnGetOutput>('schema.columns.get', { connectionId: binding.profile.id, database, table: name, taskId: crypto.randomUUID(), connectionRevision: 1, includeEncodingFacts: true });
        expect(result.error).toBeUndefined(); expect(result.facts).toHaveLength(1); expect(result.facts.flatMap(fact => fact.writes)).toEqual([]); return result.value!;
      };
      /** 补丁只传单列单属性和实际目录配对，不接收客户端SQL。 */
      const patch = (snapshot: TableColumnGetOutput, encoding: TableEncodingPair): ColumnPatch => {
        const column = snapshot.columns.find(value => value.name === 'v'); expect(!!column).toBe(true);
        return { kind: 'alter', columnRef: column!.columnRef, changes: { encoding } };
      };
      const preview = (snapshot: TableColumnGetOutput, pair: TableEncodingPair) => invoke<TableColumnPreviewOutput>('schema.columns.preview', { snapshotId: snapshot.snapshotId, patches: [patch(snapshot, pair)], taskId: crypto.randomUUID(), connectionRevision: 1 });
      const apply = (plan: TableColumnPreviewOutput, write: boolean, acknowledgements = plan.requiredAcknowledgements) => invoke<TableColumnApplyOutput>('schema.columns.apply', { previewToken: plan.previewToken, acknowledgements, taskId: crypto.randomUUID(), connectionRevision: 1 }, write ? plan.sql : undefined);
      /** 主动释放走公开协议；禁止为清理令牌打开新的数据库连接。 */
      const release = async (snapshot: TableColumnGetOutput) => {
        const result = await invoke('schema.columns.release', { snapshotId: snapshot.snapshotId }); expect(result.error).toBeUndefined(); expect(result.facts).toHaveLength(0);
      };
      const latin: TableEncodingPair = { charset: 'latin1', collation: 'latin1_bin' }, utf: TableEncodingPair = { charset: 'utf8mb4', collation: 'utf8mb4_bin' };
      let completedDdl = 0;
      /** COPY发送时的真实读回模式须保留原位并追加严格/保零；服务器原DDL头必须零警告。 */
      const assertDdl = (actual: ColumnEncodingConnectionFact[], plan: TableColumnPreviewOutput, success: boolean) => {
        expect(actual).toHaveLength(1); expect(actual.flatMap(fact => fact.writes)).toEqual([plan.sql]);
        const fact = actual[0], modes = new Set((fact.ddlModes[0] ?? '').split(',').filter(Boolean));
        expect(fact.ddlModes).toHaveLength(1); expect(modes.has('STRICT_ALL_TABLES') && modes.has('NO_AUTO_VALUE_ON_ZERO')).toBe(true);
        expect(fact.modeReads.length > 0 && fact.modeReads[0].split(',').filter(Boolean).every(mode => modes.has(mode))).toBe(true);
        if (success) { expect(fact.ddlWarnings).toEqual([0]); expect(fact.ddlErrors).toEqual([undefined]); completedDdl++; }
      };
      /** 单次成功都核独立数据、原字段属性与索引；不把相同SHOW当作数据保真。 */
      const convert = async (name: string, target: TableEncodingPair, snapshot?: TableColumnGetOutput) => {
        const before = await values(name), beforeShape = await shape(name), beforeIndexes = await indexes(name);
        const source = snapshot ?? await get(name); expect(source.columns.find(column => column.name === 'v')?.encoding?.access.editable).toBe(true);
        const prepared = await preview(source, target); expect(prepared.error).toBeUndefined(); expect(prepared.facts.flatMap(fact => fact.writes)).toEqual([]);
        const plan = prepared.value!;
        expect(plan.requiredAcknowledgements).toEqual(['ddl-implicit-commit', 'external-ddl-window', 'column-encoding-copy']);
        expect(plan.sql).toContain(`ALTER TABLE ${table(name)} MODIFY COLUMN `); expect(plan.sql).toMatch(/ALGORITHM\s*=\s*COPY/); expect(plan.sql).toMatch(/LOCK\s*=\s*EXCLUSIVE/);
        expect(plan.sql).not.toMatch(/CONVERT TO CHARACTER SET|DROP (?:COLUMN|INDEX)|ADD (?:COLUMN|INDEX)/i);
        same(await values(name), before); const applied = await apply(plan, true);
        expect(applied.error).toBeUndefined(); expect(applied.value).toMatchObject({ ddlSubmitted: true, ddlCompleted: true, definitionVerified: true, warnings: [] });
        assertDdl(applied.facts, plan, true); same(await values(name), before); same(await shape(name), beforeShape); same(await indexes(name), beforeIndexes); same(await currentPair(name), target);
        const repeated = await apply(plan, false); expect(repeated.error).toBeInstanceOf(Error); expect(repeated.facts).toHaveLength(0);
      };

      await create('subject', "k INT NOT NULL PRIMARY KEY,id BIGINT NOT NULL AUTO_INCREMENT,v VARCHAR(24) CHARACTER SET latin1 COLLATE latin1_bin NULL DEFAULT 'é' COMMENT '原字符列',tag INT NOT NULL,amount DECIMAL(30,10) NOT NULL,payload BLOB,nullable_text VARCHAR(9) NULL,created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,KEY idx_auto(id),UNIQUE KEY uq_v_tag(v,tag),KEY idx_prefix(v(3),k)");
      const inserts = [[1, '-9', 'é', 1, '12345678901234567890.1234567890', Buffer.from('0000ff', 'hex'), null], [2, '0', null, 2, '0.0000000001', Buffer.alloc(0), ''], [3, '0', '', 3, '-1.0000000001', null, null], [4, '7', 'a ', 4, '98765432109876543210.9999999999', Buffer.from('ff00', 'hex'), 'x'], [5, '9007199254740993', "q'\\", 5, '1.0000000000', Buffer.from('010203', 'hex'), null], [6, '9', '\0', 6, '0.0000000000', null, '']] satisfies (string | number | null | Buffer)[][];
      for (const row of inserts) {
        // 两行写入明显早于本轮的时间及NULL，防止错误重算CURRENT_TIMESTAMP恰巧同秒而漏检；其余行走真实默认值。
        const timestamps = row[0] === 1 ? ['2001-02-03 04:05:06', '2002-03-04 05:06:07'] : row[0] === 2 ? ['2003-04-05 06:07:08', null] : undefined;
        expect((await sql<{ warningStatus: number }>(`INSERT INTO ${table('subject')}(k,id,v,tag,amount,payload,nullable_text${timestamps ? ',created_at,updated_at' : ''}) VALUES(?,?,?,?,?,?,?${timestamps ? ',?,?' : ''})`, timestamps ? [...row, ...timestamps] : row)).warningStatus).toBe(0);
      }
      // 旁列单独精确读回：重复0、负值、超JS安全整数、DECIMAL、BLOB及默认/自动更新时间不得在COPY中变化。
      const sideValues = () => sql(`SELECT CAST(k AS CHAR) AS k,CAST(id AS CHAR) AS id,CAST(tag AS CHAR) AS tag,CAST(amount AS CHAR) AS amount,HEX(payload) AS payload,nullable_text,DATE_FORMAT(created_at,'%Y-%m-%d %H:%i:%s') AS createdAt,DATE_FORMAT(updated_at,'%Y-%m-%d %H:%i:%s') AS updatedAt FROM ${table('subject')} ORDER BY k`);
      const sideBefore = await sideValues(), originalDefinition = await definition('subject');
      expect(sideBefore.map(row => row.id).join(',') === '-9,0,0,7,9007199254740993,9').toBe(true);
      expect(sideBefore[0]?.createdAt === '2001-02-03 04:05:06' && sideBefore[0]?.updatedAt === '2002-03-04 05:06:07' && sideBefore[1]?.createdAt === '2003-04-05 06:07:08' && sideBefore[1]?.updatedAt === null).toBe(true);
      expect(sideBefore.slice(2).every(row => typeof row.createdAt === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(row.createdAt) && row.createdAt === row.updatedAt)).toBe(true);
      expect(sideBefore.length === inserts.length && sideBefore.every((row, index) => {
        const payload = inserts[index][5];
        return row.amount === inserts[index][4] && row.nullable_text === inserts[index][6] && row.payload === (Buffer.isBuffer(payload) ? payload.toString('hex').toUpperCase() : null);
      })).toBe(true);
      const originalValues = await values('subject');
      expect(originalValues.length === inserts.length && originalValues.every((row, index) => row.valueBytes === (inserts[index][2] === null ? null : Buffer.from(String(inserts[index][2]), 'utf8').toString('hex').toUpperCase()))).toBe(true);
      const first = await get('subject');
      expect(first.columns.find(column => column.name === 'v')?.encoding).toMatchObject({ current: latin, access: { editable: true } });
      expect(!!first.encodingCatalog?.length).toBe(true);
      // 独立读实际目录，包含MariaDB实际完整别名；不按服务器版本猜配对。
      const actualPairs = await sql("SELECT CHARACTER_SET_NAME AS charset,COLLATION_NAME AS collation FROM information_schema.COLLATIONS WHERE IS_COMPILED='Yes' AND CHARACTER_SET_NAME IS NOT NULL");
      if (binding.dialect === 'mariadb') {
        const columns = await sql("SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='information_schema' AND TABLE_NAME='COLLATION_CHARACTER_SET_APPLICABILITY'");
        if (columns.some(row => row.name === 'FULL_COLLATION_NAME')) actualPairs.push(...await sql("SELECT a.CHARACTER_SET_NAME AS charset,a.FULL_COLLATION_NAME AS collation FROM information_schema.COLLATION_CHARACTER_SET_APPLICABILITY a JOIN information_schema.COLLATIONS c ON BINARY c.COLLATION_NAME=BINARY a.COLLATION_NAME WHERE c.IS_COMPILED='Yes'"));
      }
      const actualPairSet = new Set(actualPairs.map(pair => JSON.stringify([pair.charset, pair.collation])));
      expect(first.encodingCatalog!.every(pair => actualPairSet.has(JSON.stringify([pair.charset, pair.collation])))).toBe(true);
      for (const pair of [latin, utf]) expect(first.encodingCatalog!.some(value => value.charset === pair.charset && value.collation === pair.collation)).toBe(true);
      const mb3 = first.encodingCatalog!.find(pair => pair.charset === 'utf8mb3' && pair.collation === 'utf8mb3_bin') ?? first.encodingCatalog!.find(pair => pair.charset === 'utf8' && pair.collation === 'utf8_bin');
      expect(!!mb3 && /^[a-z0-9_]+$/.test(mb3.charset) && /^[a-z0-9_]+$/.test(mb3.collation)).toBe(true);
      const binary = await preview(first, { charset: 'binary', collation: 'binary' }); expect(binary.error).toBeInstanceOf(Error); expect(binary.facts.flatMap(fact => fact.writes)).toEqual([]);
      const ackPlan = await preview(first, utf); expect(ackPlan.error).toBeUndefined(); expect(ackPlan.facts.flatMap(fact => fact.writes)).toEqual([]);
      const missingAck = await apply(ackPlan.value!, false, ['ddl-implicit-commit', 'external-ddl-window']); expect(missingAck.error).toBeInstanceOf(Error); expect(missingAck.facts.flatMap(fact => fact.writes)).toEqual([]);
      const consumed = await apply(ackPlan.value!, false); expect(consumed.error).toBeInstanceOf(Error); expect(consumed.facts).toHaveLength(0);
      await convert('subject', utf, first); same(await sideValues(), sideBefore);
      expect((await sql(`SELECT HEX(v) AS bytes FROM ${table('subject')} WHERE k=1`))[0].bytes === 'C3A9').toBe(true);
      await convert('subject', latin); same(await sideValues(), sideBefore);
      expect((await sql(`SELECT HEX(v) AS bytes FROM ${table('subject')} WHERE k=1`))[0].bytes === 'E9').toBe(true);
      same((await definition('subject')).replace(/ AUTO_INCREMENT=\d+/, ''), originalDefinition.replace(/ AUTO_INCREMENT=\d+/, ''));

      await create('char_values', "k INT PRIMARY KEY,v CHAR(8) CHARACTER SET latin1 COLLATE latin1_bin NULL DEFAULT 'é' COMMENT '定长原语义',KEY idx_v(v)");
      const charInputs = [null, '', '  ', 'é', '\0', 'é\0 '];
      for (const [index, value] of charInputs.entries()) expect((await sql<{ warningStatus: number }>(`INSERT INTO ${table('char_values')} VALUES(?,?)`, [index, value])).warningStatus).toBe(0);
      // 基线取真实CHAR读取结果；不声称能恢复服务器在插入/读取时裁掉的尾空格。
      const charBefore = await values('char_values'), charDefinition = await definition('char_values'); expect(charBefore.length).toBe(charInputs.length);
      await convert('char_values', utf); same(await values('char_values'), charBefore);
      await convert('char_values', latin); same(await values('char_values'), charBefore); same(await definition('char_values'), charDefinition);
      await create('text_values', 'k INT PRIMARY KEY,v TEXT CHARACTER SET latin1 COLLATE latin1_bin NULL COMMENT \'普通文本\'');
      for (const [k, value] of [null, '', 'é'.repeat(256), "a ' \\ \0 "].entries()) expect((await sql<{ warningStatus: number }>(`INSERT INTO ${table('text_values')} VALUES(?,?)`, [k, value])).warningStatus).toBe(0);
      await convert('text_values', utf);
      await create('mb3_values', `k INT PRIMARY KEY,v VARCHAR(24) CHARACTER SET ${mb3!.charset} COLLATE ${mb3!.collation} NULL COMMENT '目录别名',KEY idx_v(v)`, `${mb3!.charset} COLLATE ${mb3!.collation}`, true);
      for (const [k, value] of ['汉', 'é', null, ''].entries()) expect((await sql<{ warningStatus: number }>(`INSERT INTO ${table('mb3_values')} VALUES(?,?)`, [k, value])).warningStatus).toBe(0);
      await convert('mb3_values', utf);

      /** 有损拒绝须来自真实预检聚合且没有写入；定义与数据也由observer独立复核。 */
      const refusePreview = async (name: string, pair: TableEncodingPair, expectedCounts?: Partial<{ rowCount: string; lossy: string; defaultLossy: string; maxConvertedBytes: string }>) => {
        const original = await definition(name), originalRows = await values(name), snapshot = await get(name);
        expect(snapshot.columns.find(column => column.name === 'v')?.encoding?.access.editable).toBe(true);
        const refused = await preview(snapshot, pair); expect(refused.error).toBeInstanceOf(Error); expect(refused.facts.flatMap(fact => fact.writes)).toEqual([]);
        if (expectedCounts) expect(refused.facts.flatMap(fact => fact.preflights)).toEqual(expect.arrayContaining([expect.objectContaining(expectedCounts)]));
        same(await definition(name), original); same(await values(name), originalRows); await release(snapshot); return refused;
      };
      await create('lossy_rows', 'k INT PRIMARY KEY,v VARCHAR(24) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL');
      await sql(`INSERT INTO ${table('lossy_rows')} VALUES(1,?),(2,?),(3,NULL)`, ['😀', '汉']);
      await refusePreview('lossy_rows', latin, { rowCount: '3', lossy: '2', defaultLossy: '0' });
      await create('lossy_default', "k INT PRIMARY KEY,v VARCHAR(24) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL DEFAULT '汉'");
      await sql(`INSERT INTO ${table('lossy_default')} VALUES(1,?),(2,NULL)`, ['é']);
      await refusePreview('lossy_default', latin, { rowCount: '2', lossy: '0', defaultLossy: '1' });
      await create('text_overflow', 'k INT PRIMARY KEY,v TEXT CHARACTER SET latin1 COLLATE latin1_bin NULL');
      await sql(`INSERT INTO ${table('text_overflow')} VALUES(1,?)`, ['é'.repeat(40000)]);
      await refusePreview('text_overflow', utf, { rowCount: '1', maxConvertedBytes: '80000' });
      await create('key_overflow', 'k INT PRIMARY KEY,v VARCHAR(769) CHARACTER SET latin1 COLLATE latin1_bin NULL,KEY idx_v(v)');
      await sql(`INSERT INTO ${table('key_overflow')} VALUES(1,?)`, ['é']);
      const keyBefore = await indexes('key_overflow'), cost = await refusePreview('key_overflow', utf);
      expect(cost.error instanceof Error && /MAXLEN|字节预算/.test(cost.error.message)).toBe(true);
      expect(cost.facts.flatMap(fact => fact.preflights)).toEqual([]); same(await indexes('key_overflow'), keyBefore);
      expect(keyBefore.some(row => row.INDEX_NAME === 'idx_v' && row.SUB_PART === null)).toBe(true);

      await create('unique_conflict', 'k INT PRIMARY KEY,v VARCHAR(24) CHARACTER SET latin1 COLLATE latin1_bin NULL,UNIQUE KEY uq_v(v)');
      await sql(`INSERT INTO ${table('unique_conflict')} VALUES(1,?),(2,?)`, ['A', 'a']);
      const uniqueRows = await values('unique_conflict'), uniqueDefinition = await definition('unique_conflict'), uniqueSnapshot = await get('unique_conflict');
      const uniquePlan = await preview(uniqueSnapshot, { charset: 'utf8mb4', collation: 'utf8mb4_general_ci' }); expect(uniquePlan.error).toBeUndefined(); expect(uniquePlan.facts.flatMap(fact => fact.writes)).toEqual([]);
      const conflict = await apply(uniquePlan.value!, true); expect(conflict.error).toMatchObject({ errno: 1062 }); assertDdl(conflict.facts, uniquePlan.value!, false);
      expect(conflict.facts.flatMap(fact => fact.ddlErrors)).toEqual([1062]);
      expect(conflict.events.some(event => event.columnPatch?.ddlSubmitted === true && event.columnPatch.ddlCompleted === false && event.columnPatch.outcome === 'unknown')).toBe(true);
      same(await values('unique_conflict'), uniqueRows); same(await definition('unique_conflict'), uniqueDefinition);
      const noRetry = await apply(uniquePlan.value!, false); expect(noRetry.error).toBeInstanceOf(Error); expect(noRetry.facts).toHaveLength(0);

      await create('changed_rows', 'k INT PRIMARY KEY,v VARCHAR(24) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL');
      await sql(`INSERT INTO ${table('changed_rows')} VALUES(1,?)`, ['é']);
      const changeSnapshot = await get('changed_rows'), changePlan = await preview(changeSnapshot, latin); expect(changePlan.error).toBeUndefined();
      await sql(`INSERT INTO ${table('changed_rows')} VALUES(2,?)`, ['😀']);
      const changedRows = await values('changed_rows'), changedDefinition = await definition('changed_rows'), changed = await apply(changePlan.value!, false);
      expect(changed.error).toBeInstanceOf(Error); expect(changed.facts.flatMap(fact => fact.writes)).toEqual([]);
      expect(changed.facts.flatMap(fact => fact.preflights)).toEqual(expect.arrayContaining([expect.objectContaining({ lossy: '1' })]));
      same(await values('changed_rows'), changedRows); same(await definition('changed_rows'), changedDefinition);

      await create('foreign_parent', 'k INT PRIMARY KEY,v VARCHAR(24) CHARACTER SET latin1 COLLATE latin1_bin NOT NULL,UNIQUE KEY uq_v(v)');
      await create('foreign_child', `k INT PRIMARY KEY,v VARCHAR(24) CHARACTER SET latin1 COLLATE latin1_bin NULL,KEY idx_v(v),CONSTRAINT fk_parent FOREIGN KEY(v) REFERENCES ${table('foreign_parent')}(v)`);
      await sql(`INSERT INTO ${table('foreign_parent')} VALUES(1,?)`, ['é']); await sql(`INSERT INTO ${table('foreign_child')} VALUES(1,?)`, ['é']);
      await create('generated_guard', 'k INT PRIMARY KEY,v VARCHAR(24) CHARACTER SET latin1 COLLATE latin1_bin NULL,g INT GENERATED ALWAYS AS(k+1) STORED');
      await sql(`INSERT INTO ${table('generated_guard')}(k,v) VALUES(1,?)`, ['é']);
      for (const name of ['foreign_parent', 'foreign_child', 'generated_guard']) {
        const original = await definition(name), originalRows = await values(name), snapshot = await get(name), column = snapshot.columns.find(value => value.name === 'v');
        expect(column?.encoding?.access.editable).toBe(false); expect(!!column?.encoding?.access.reason).toBe(true);
        const refused = await preview(snapshot, utf); expect(refused.error).toBeInstanceOf(Error); expect(refused.facts.flatMap(fact => fact.writes)).toEqual([]);
        same(await definition(name), original); same(await values(name), originalRows); await release(snapshot);
      }
      const externalSnapshot = await get('subject'), externalPlan = await preview(externalSnapshot, utf); expect(externalPlan.error).toBeUndefined();
      await sql(`ALTER TABLE ${table('subject')} COMMENT='${marker}:subject_changed'`); owned.set('subject', marker + ':subject_changed');
      const externalDefinition = await definition('subject'), externalRows = await values('subject'), external = await apply(externalPlan.value!, false);
      expect(external.error).toBeInstanceOf(Error); expect(external.facts.flatMap(fact => fact.writes)).toEqual([]); same(await definition('subject'), externalDefinition); same(await values('subject'), externalRows);
      const releasedSnapshot = await get('subject'), releasedPlan = await preview(releasedSnapshot, utf); expect(releasedPlan.error).toBeUndefined();
      await release(releasedSnapshot); const released = await apply(releasedPlan.value!, false); expect(released.error).toBeInstanceOf(Error); expect(released.facts).toHaveLength(0);
      same(await sideValues(), sideBefore); same(await sql('SELECT @@SESSION.sql_mode AS mode'), fixtureMode);
      await sql('SET SESSION sql_mode = ?', [originalMode]); same(await sql('SELECT @@SESSION.sql_mode AS mode'), originalModeRows);
      await sql('SET SESSION time_zone = ?', [originalTimezone]); same(await sql('SELECT @@SESSION.time_zone AS zone'), originalTimezoneRows);
      expect(completedDdl).toBe(6);
      const ddlCount = facts.filter(fact => fact.scope !== 'observer').flatMap(fact => fact.writes).length; expect(ddlCount).toBe(7);
      process.stdout.write(JSON.stringify({
        专项: '列字符集转换', 阶段: '行为审计', 端口: binding.profile.port, 数据库: database, 版本: observer.status.version,
        方言: binding.dialect, 严格TLS: !!binding.profile.tls?.enabled, 实际DDL数: ddlCount, 成功DDL数: completedDdl,
        目录配对真实: true, 非binary字符集: true, VARCHAR往返恢复: true, CHAR按真实读取语义往返: true,
        普通TEXT升级: true, utf8目录别名升级: true, utf8夹具警告与ALTER分离: true, 默认值可空注释与索引保持: true,
        重复零负值BIGINT与DECIMAL保持: true, BLOB与NULL保持: true, 整列有损预检拒绝: true, 仅默认值有损拒绝: true,
        TEXT字节上限预检拒绝: true, 完整索引超预算未发DDL: true, CI唯一冲突一次失败且原值保持: true,
        应用重新预检数据: true, 外键双端与旁生成列只读: true, 缺确认消费令牌: true, 外部DDL拒绝: true, 主动释放令牌: true,
        COPY严格模式保留原位并追加: true, 成功ALTER原响应零警告: true, 旁时间戳默认与自动更新原值保持: true, observer模式恢复: true, observer时区恢复: true,
        TTL与实体替换与MDL取消限权: '本专项未验，不替换原120秒时钟',
      }) + '\n');
      await owner.step(() => engine!.closeAll());
      const taskFacts = facts.filter(fact => fact.scope !== 'observer'); assertColumnEncodingReleased(taskFacts, false);
      const ids = [...new Set(taskFacts.map(fact => fact.id))];
      if (ids.length) expect(await sql(`SELECT ID FROM information_schema.PROCESSLIST WHERE ID IN (${ids.join(',')})`)).toHaveLength(0);
      const names = [...owned].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
      same(await sql('SELECT TABLE_NAME AS name,TABLE_COMMENT AS marker,TABLE_TYPE AS kind FROM information_schema.TABLES WHERE BINARY TABLE_SCHEMA=BINARY ? ORDER BY BINARY TABLE_NAME', [database]), names.map(([name, comment]) => ({ name, marker: comment, kind: 'BASE TABLE' })));
      for (const [view, column] of [['TRIGGERS', 'TRIGGER_SCHEMA'], ['ROUTINES', 'ROUTINE_SCHEMA'], ['EVENTS', 'EVENT_SCHEMA']]) expect(await sql(`SELECT 1 FROM information_schema.${view} WHERE BINARY ${column}=BINARY ? LIMIT 1`, [database])).toHaveLength(0);
      if (created !== 'confirmed' || !/^dbark_e2e_colenc_[a-f0-9]{32}$/.test(database)) throw Error('列字符集原资源归属未证明，拒绝清理');
      await sql('DROP DATABASE ' + db); created = 'absent'; expect(await sql('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE BINARY SCHEMA_NAME=BINARY ?', [database])).toHaveLength(0);
      await owner.step(() => closeColumnEncodingObserver(observer!)); assertColumnEncodingReleased(facts, false);
      owner.finish(); complete = true; audit.watch = undefined; audit.check = undefined; audit.scope = '';
      process.stdout.write(JSON.stringify({ 专项: '列字符集转换', 阶段: '精确清理', 端口: binding.profile.port, 数据库: database, 已清理数据库: database, 原生流全部关闭: true, 原任务线程残留: 0, 实际DDL数: ddlCount }) + '\n');
    } catch (reason) {
      owner.stop(); retained = true;
      process.stdout.write(JSON.stringify({ 专项: '列字符集转换', 阶段: '失败保留', 端口: binding.profile.port, 保留现场: true, 数据库: database, 数据库状态: created, 原生线程: facts.map(fact => ({ id: fact.id, pending: fact.pending, closed: fact.sawClose, closeFailed: fact.closeFailed })) }) + '\n');
      throw reason;
    } finally {
      if (!complete && observer) try { await observer.close({ strict: true }); } catch { /* 保留原异常与未知资源，不新连补救或重放DDL。 */ }
    }
  });
});
