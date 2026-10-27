import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RowChange, TableInfo } from '../../src/shared/contracts';
import type { StructureTaskContext } from '../../src/engine/structureDefinition';
import { tableCopyMetadataKey } from '../../src/shared/tableCopySource';

const ports = vi.hoisted(() => ({ query: vi.fn(), metadata: vi.fn() }));
vi.mock('../../src/engine/structureDefinition', () => ({ structureTaskQuery: ports.query }));
vi.mock('../../src/engine/metadata', () => ({ tableInfo: ports.metadata }));
import { tableDraftMatchSql, verifyTableDraft, type TableDraftVerifyInput } from '../../src/engine/tableDraftVerify';
import { buildChanges } from '../../src/engine/sql';

const info: TableInfo = {
  database: '草`稿', name: 'subject?', objectKind: 'table', engine: 'InnoDB', charset: 'utf8mb4', collation: 'utf8mb4_general_ci', comment: '',
  primaryKey: ['id'], editableKey: ['id'], indexes: [{ name: 'PRIMARY', unique: true, columns: ['id'] }], foreignKeys: [],
  columns: [
    { name: 'id', type: 'bigint unsigned', nullable: false, defaultValue: null, extra: '', comment: '', generated: false },
    { name: 'label', type: 'varchar(60)', nullable: true, defaultValue: null, extra: '', comment: '', generated: false },
    { name: 'payload', type: 'blob', nullable: true, defaultValue: null, extra: '', comment: '', generated: false },
  ], ddl: 'CREATE TABLE `subject?` (`id` BIGINT UNSIGNED NOT NULL, `label` VARCHAR(60), `payload` BLOB, PRIMARY KEY (`id`)) ENGINE=InnoDB',
};
const original = () => ({ id: '18446744073709551615', label: "原值'\\\0😀", payload: { type: 'binary' as const, base64: 'AP8=' } });
const rollback = 'ROLLBACK AND NO CHAIN NO RELEASE';
const modeRead = 'SELECT @@SESSION.sql_mode AS sqlMode LIMIT 1025';
const input = (changes: RowChange[] = [{ kind: 'update', before: original(), values: { id: '9007199254740993', label: '新值' } }]): TableDraftVerifyInput => ({ connectionId: 'profile', database: info.database, table: info.name, taskId: 'task', metadataKey: tableCopyMetadataKey(info), changes });
let sent: string[], lookups: unknown[], warningFor: RegExp | undefined, rejectedFor: RegExp | undefined, failure: Error;
let cancelled: boolean, cancelAfter: RegExp | undefined, matched: number, started: number, ended: number;
let context: StructureTaskContext;
let diagnosticSource: string, countResponse: (() => unknown) | undefined;

beforeEach(() => {
  sent = []; lookups = [[{ k0: '3138343436373434303733373039353531363135' }]]; warningFor = rejectedFor = cancelAfter = undefined;
  cancelled = false; matched = started = ended = 0; failure = Error('合成原始查询错误');
  diagnosticSource = ''; countResponse = undefined;
  context = {
    managed: { broken: false, status: { dialect: 'mysql', version: '8.4.11' } } as StructureTaskContext['managed'],
    checkCancelled() { if (cancelled) throw Error('合成原任务取消'); }, report: vi.fn(),
    commandStarted() { started++; return () => { ended++; }; },
  };
  ports.metadata.mockReset().mockImplementation(async (_managed, database, table, query) => {
    expect(database).toBe(info.database); expect(table).toBe(info.name);
    // 核实目录适配器本身施加硬LIMIT与模式无关参数绑定，并即时检查它的原诊断。
    await query('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ?', ['草`稿']);
    return structuredClone(info);
  });
  ports.query.mockReset().mockImplementation(async (scope: StructureTaskContext, sql: string, submitted?: () => void) => {
    scope.checkCancelled(); const done = scope.commandStarted(); sent.push(sql);
    try {
      submitted?.();
      if (rejectedFor?.test(sql)) throw failure;
      // 两条诊断都不能成为“被诊断的原语句”，否则会把原warning关联到COUNT而漏报。
      if (sql !== 'SHOW COUNT(*) WARNINGS' && sql !== 'SHOW WARNINGS LIMIT 1') diagnosticSource = sql;
      let rows: unknown;
      if (sql === 'SHOW COUNT(*) WARNINGS') rows = countResponse ? countResponse() : [{ '@@session.warning_count': warningFor?.test(diagnosticSource) ? 1 : 0 }];
      else if (sql === 'SHOW WARNINGS LIMIT 1') rows = warningFor?.test(diagnosticSource) ? [{ Level: 'Warning', Code: 1292, Message: '合成告警' }] : [];
      else if (sql === modeRead) rows = [{ sqlMode: '' }];
      else if (/^SELECT HEX\(CAST\(/.test(sql)) { rows = lookups[matched++] ?? []; }
      else if (sql.includes('LIMIT 0')) rows = [];
      else if (sql.startsWith('SELECT COLUMN_NAME')) rows = [{ COLUMN_NAME: 'id' }];
      else rows = { warningStatus: 0, affectedRows: 0 };
      if (cancelAfter?.test(sql)) cancelled = true;
      return { rows, fields: [] };
    } finally { done(); }
  });
});

describe('显式草稿恢复的只读原行核验', () => {
  it('按保存旧键及完整旧值核验，原键修改不被当成定位键；始终零DML并原会话回滚', async () => {
    const request = input(); const before = structuredClone(request.changes);
    await expect(verifyTableDraft(context, request)).resolves.toEqual({ verifiedChanges: 1 });
    expect(request.changes).toEqual(before); expect(started).toBe(ended);
    expect(sent[0]).toBe('SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    expect(sent).toContain('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
    expect(sent).toContain('SELECT 1 FROM `草``稿`.`subject?` LIMIT 0');
    expect(sent.filter(sql => sql === rollback)).toHaveLength(1);
    const match = sent.find(sql => /^SELECT HEX\(CAST\(/.test(sql))!;
    expect(match).toContain("`id` <=> _utf8mb4 X'3138343436373434303733373039353531363135'");
    expect(match).not.toContain('39303037313939323534373430393933');
    expect(match).toContain('CAST(CONVERT(`label` USING utf8mb4) AS BINARY) <=> CAST(CONVERT(');
    expect(match).toContain("`payload` <=> X'00ff'"); expect(match).toMatch(/ LIMIT 2$/);
    expect(sent.some(sql => /^(?:INSERT|UPDATE|DELETE|REPLACE|COMMIT)\b/.test(sql))).toBe(false);
    expect(ports.metadata).toHaveBeenCalledTimes(2);
    expect(sent.filter(sql => sql.startsWith('SELECT @@SESSION.sql_mode AS sqlMode'))).toEqual([modeRead, modeRead]);
    expect(sent.filter(sql => sql.startsWith('SELECT COLUMN_NAME'))).toEqual(Array(2).fill("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = _utf8mb4 X'e88d8960e7a8bf' LIMIT 1025"));
  });

  it('新增和删除混合保留DEFAULT省略，新行仅验证可写字段而不发送唯一键探写', async () => {
    const changes: RowChange[] = [{ kind: 'insert', values: { label: null } }, { kind: 'delete', before: original() }];
    await expect(verifyTableDraft(context, input(changes))).resolves.toEqual({ verifiedChanges: 2 });
    expect(matched).toBe(1); expect(changes[0]).toEqual({ kind: 'insert', values: { label: null } });
    expect(sent.filter(sql => /^SELECT HEX\(CAST\(/.test(sql))).toHaveLength(1);
  });

  it('纯新增也先持原表MDL并复核结构，不能只靠离线目录恢复', async () => {
    await expect(verifyTableDraft(context, input([{ kind: 'insert', values: {} }]))).resolves.toEqual({ verifiedChanges: 1 });
    expect(matched).toBe(0); expect(ports.metadata).toHaveBeenCalledTimes(2);
    expect(sent.indexOf('SELECT 1 FROM `草``稿`.`subject?` LIMIT 0')).toBeLessThan(sent.indexOf(modeRead));
  });

  it.each([{ rows: [] }, { rows: [{ k0: '31' }, { k0: '32' }] }])('缺失、变化或多行匹配整次拒绝并结束原事务：%j', async ({ rows }) => {
    lookups = [rows]; await expect(verifyTableDraft(context, input())).rejects.toThrow('原始行已变化或不存在');
    expect(sent.filter(sql => sql === rollback)).toHaveLength(1);
  });

  it('不同输入键词法命中同一真实服务器键，拒绝重复旧行操作', async () => {
    lookups = [[{ k0: '31' }], [{ k0: '31' }]];
    const one = { ...original(), id: 1 }, two = { ...original(), id: '01' };
    await expect(verifyTableDraft(context, input([{ kind: 'delete', before: one }, { kind: 'update', before: two, values: { label: '第二次改' } }]))).rejects.toThrow('同一原始行');
    expect(matched).toBe(2); expect(sent).toContain(rollback);
  });

  it.each([
    { label: 'NULL', rows: [{ k0: null }] }, { label: '非十六进制', rows: [{ k0: 'not-hex' }] },
    { label: '奇数字节', rows: [{ k0: '0' }] }, { label: '非规范小写', rows: [{ k0: 'aa' }] }, { label: '额外字段', rows: [{ k0: '31', extra: 1 }] },
    { label: '继承字段', rows: [Object.create({ k0: '31' })] }, { label: '访问器', rows: [Object.defineProperty({}, 'k0', { enumerable: true, get() { throw Error('getter不得执行'); } })] },
  ])('拒绝不可信匹配投影：$label', async ({ rows }) => {
    lookups = [rows]; await expect(verifyTableDraft(context, input())).rejects.toThrow('服务器回包无效');
    expect(sent).toContain(rollback);
  });

  it('最终元数据变更时不发布此前已经核过的行', async () => {
    ports.metadata.mockResolvedValueOnce(structuredClone(info)).mockResolvedValueOnce({ ...structuredClone(info), comment: '新备注' });
    await expect(verifyTableDraft(context, input())).rejects.toThrow('表结构或可靠定位键已变化');
    expect(sent).toContain(rollback);
  });

  it.each([
    { engine: 'MyISAM' }, { objectKind: 'view' }, { editableKey: [] },
    { columns: info.columns.map(column => column.name === 'id' ? { ...column, nullable: true } : column) },
  ])('不提升不可写目标的恢复权限：%j', async patch => {
    ports.metadata.mockResolvedValue({ ...structuredClone(info), ...patch });
    await expect(verifyTableDraft(context, input())).rejects.toThrow('表结构或可靠定位键已变化');
    expect(matched).toBe(0);
  });

  it.each([
    { kind: 'delete', before: { id: 1, label: '缺BLOB' } },
    { kind: 'delete', before: { ...original(), extra: 1 } },
    { kind: 'update', before: original(), values: { unknown: 1 } },
  ])('缺旧值或未知列在原行SELECT之前拒绝：%j', async change => {
    await expect(verifyTableDraft(context, input([change as RowChange]))).rejects.toThrow(); expect(matched).toBe(0);
  });

  it('生成列赋值在只读恢复时拒绝，删除旧值仍完整保留生成列', async () => {
    const generated = { ...structuredClone(info), columns: info.columns.map(column => column.name === 'label' ? { ...column, generated: true } : column) };
    ports.metadata.mockResolvedValue(generated);
    const request = input(); request.metadataKey = tableCopyMetadataKey(generated);
    await expect(verifyTableDraft(context, request)).rejects.toThrow('生成列不能手动赋值'); expect(matched).toBe(0);
  });

  it.each([/^SET SESSION TRANSACTION/, /^SELECT COLUMN_NAME/, /^SELECT HEX\(CAST\(/, /^ROLLBACK/])('控制、目录、原行及收尾任一原告警都不报成功：%s', async pattern => {
    warningFor = pattern; await expect(verifyTableDraft(context, input())).rejects.toThrow('服务器告警');
    if (!pattern.test('SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ')) expect(sent).toContain(rollback);
  });

  it.each([0, '0'])('计数只接受准确零并在原命令后按COUNT/列表顺序核查：%s', async count => {
    countResponse = () => [{ '@@session.warning_count': count }];
    await expect(verifyTableDraft(context, input())).resolves.toEqual({ verifiedChanges: 1 });
    for (let index = 0; index < sent.length; index++) {
      if (sent[index] === 'SHOW COUNT(*) WARNINGS' || sent[index] === 'SHOW WARNINGS LIMIT 1') continue;
      expect(sent.slice(index + 1, index + 3)).toEqual(['SHOW COUNT(*) WARNINGS', 'SHOW WARNINGS LIMIT 1']);
    }
  });

  it('警告计数非零时即使列表夹具为空也拒绝，不用空列表冒充无警告', async () => {
    countResponse = () => [{ '@@session.warning_count': '1' }];
    await expect(verifyTableDraft(context, input())).rejects.toThrow('服务器告警');
    expect(warningFor).toBeUndefined(); expect(sent).toEqual(['SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ', 'SHOW COUNT(*) WARNINGS']);
  });

  it.each([
    { label: '非数组', rows: { '@@session.warning_count': 0 } }, { label: '空数组', rows: [] },
    { label: '多行', rows: [{ '@@session.warning_count': 0 }, { '@@session.warning_count': 0 }] },
    { label: '错误列名', rows: [{ warning_count: 0 }] }, { label: '额外列', rows: [{ '@@session.warning_count': 0, extra: 1 }] },
    { label: '继承字段', rows: [Object.create({ '@@session.warning_count': 0 })] },
    ...[null, false, undefined, -0, '00', '0.0', NaN, Infinity].map(value => ({ label: '非规范计数' + String(value), rows: [{ '@@session.warning_count': value }] })),
  ])('坏COUNT回包整次拒绝：$label', async ({ rows }) => {
    countResponse = () => rows; await expect(verifyTableDraft(context, input())).rejects.toThrow('服务器回包无效');
    expect(matched).toBe(0); expect(sent).toEqual(['SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ', 'SHOW COUNT(*) WARNINGS']);
  });

  it('COUNT行和数组下标访问器都不会执行，也不能假报零警告', async () => {
    let reads = 0;
    const row = Object.defineProperty({}, '@@session.warning_count', { enumerable: true, get() { reads++; return 0; } });
    countResponse = () => [row]; await expect(verifyTableDraft(context, input())).rejects.toThrow('服务器回包无效'); expect(reads).toBe(0);
    const list = new Array(1); Object.defineProperty(list, '0', { enumerable: true, get() { reads++; return { '@@session.warning_count': 0 }; } });
    countResponse = () => list; await expect(verifyTableDraft(context, input())).rejects.toThrow('服务器回包无效'); expect(reads).toBe(0);
  });

  it('原行失败加ROLLBACK失败保留两个原错误，不能只覆盖成收尾错误', async () => {
    lookups = [[]]; rejectedFor = /^ROLLBACK/;
    const error = await verifyTableDraft(context, input()).catch(error => error);
    expect(error).toBeInstanceOf(AggregateError); expect(error.errors[0].message).toContain('原始行已变化'); expect(error.errors[1]).toBe(failure);
  });

  it('发送START后即使ACK失败，也尝试原连接结束事务', async () => {
    rejectedFor = /^START TRANSACTION/;
    await expect(verifyTableDraft(context, input())).rejects.toBe(failure); expect(sent).toContain(rollback);
  });

  it('取消后不补发新读取或新连接回滚，交由原任务框架严格释放', async () => {
    cancelAfter = /^SELECT HEX\(CAST\(/;
    await expect(verifyTableDraft(context, input())).rejects.toThrow();
    const index = sent.findIndex(sql => /^SELECT HEX\(CAST\(/.test(sql)); expect(sent.slice(index + 1)).toEqual([]); expect(ports.metadata).toHaveBeenCalledTimes(1);
  });

  it('未知或超预算输入先拒绝，不建立只读事务', async () => {
    const request = input(); request.changes = new Array(1001).fill({ kind: 'insert', values: {} });
    await expect(verifyTableDraft(context, request)).rejects.toThrow(); expect(sent).toEqual([]);
  });

  it('带问号与反引号的标识符不会吃掉参数；文本键仍保留二进制原值门', () => {
    const keyed = { ...info, editableKey: ['label'], columns: info.columns.map(column => column.name === 'label' ? { ...column, nullable: false } : column) };
    const sql = tableDraftMatchSql(keyed, original());
    expect(sql).toContain('FROM `草``稿`.`subject?`'); expect(sql).toContain('HEX(CAST(`label` AS BINARY)) AS `k0`');
    expect(sql).toContain('CAST(CONVERT(`label` USING utf8mb4) AS BINARY) <=> CAST(CONVERT('); expect(sql).not.toContain('DELETE');
  });

  it('缺省生成器保留原SQL/参数字节，cast模式只改变受控文本比较语法', () => {
    const before = { id: '18446744073709551615', label: '原值', payload: { type: 'binary' as const, base64: 'AP8=' } };
    const changes: RowChange[] = [{ kind: 'insert', values: { label: null } }, { kind: 'update', before, values: { label: '新值' } }, { kind: 'delete', before }];
    const originalWhere = '`id` <=> ? AND BINARY CONVERT(`label` USING utf8mb4) <=> BINARY CONVERT(? USING utf8mb4) AND `payload` <=> ?';
    const modernWhere = '`id` <=> ? AND CAST(CONVERT(`label` USING utf8mb4) AS BINARY) <=> CAST(CONVERT(? USING utf8mb4) AS BINARY) AND `payload` <=> ?';
    const expected = [
      { sql: 'INSERT INTO `草``稿`.`subject?` (`label`) VALUES (?)', params: [null] },
      { sql: 'UPDATE `草``稿`.`subject?` SET `label` = ? WHERE ' + originalWhere, params: ['新值', before.id, before.label, before.payload] },
      { sql: 'DELETE FROM `草``稿`.`subject?` WHERE ' + originalWhere, params: [before.id, before.label, before.payload] },
    ];
    const legacy = buildChanges(info, changes), explicitLegacy = buildChanges(info, changes, {}), modern = buildChanges(info, changes, { binaryText: 'cast' });
    expect(legacy.statements).toEqual(expected); expect(explicitLegacy).toEqual(legacy);
    expect(legacy.sql).toBe(expected.map(item => item.sql + ';\n-- 参数：' + JSON.stringify(item.params)).join('\n\n'));
    expect(modern.statements).toEqual([
      expected[0], { ...expected[1], sql: 'UPDATE `草``稿`.`subject?` SET `label` = ? WHERE ' + modernWhere },
      { ...expected[2], sql: 'DELETE FROM `草``稿`.`subject?` WHERE ' + modernWhere },
    ]);
    expect(modern.statements.map(item => item.params)).toEqual(legacy.statements.map(item => item.params)); expect(modern.warnings).toEqual(legacy.warnings);
  });

  it('合法列名内的BINARY CONVERT文本不被全文替换，精确标识符原样保留', () => {
    const name = 'BINARY CONVERT(`label` USING utf8mb4)', unusual = { ...info, columns: info.columns.map(column => column.name === 'label' ? { ...column, name } : column) };
    const before = { id: '18446744073709551615', [name]: '原值', payload: { type: 'binary' as const, base64: 'AP8=' } };
    const sql = tableDraftMatchSql(unusual, before);
    expect(sql).toContain('CAST(CONVERT(`BINARY CONVERT(``label`` USING utf8mb4)` USING utf8mb4) AS BINARY)');
    expect(sql).toContain('FROM `草``稿`.`subject?`'); expect(sql).toMatch(/ LIMIT 2$/);
  });
});
