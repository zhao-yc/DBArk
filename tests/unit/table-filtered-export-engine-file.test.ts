import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, readdir, rm, rmdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import iconv from 'iconv-lite';
import { parse } from 'csv-parse/sync';
import ExcelJS from 'exceljs';
import type { CellValue, TableInfo } from '../../src/shared/contracts';
import { selectTableFilteredExportColumns, tableFilteredExportLimits, type TableFilteredExportInput } from '../../src/shared/tableFilteredExport';
import type { QueryExportFrame } from '../../src/shared/queryStreamExport';
import type { StructureTaskContext } from '../../src/engine/structureDefinition';
import { tableCopyMetadataKey } from '../../src/shared/tableCopySource';

const ports = vi.hoisted(() => ({ source: vi.fn(), query: vi.fn(), frames: vi.fn() }));
/** 合成目录及原帧，不接数据库；文件、原子身份、编码及Excel ZIP走真实实现。 */
vi.mock('../../src/engine/incomingReferences', async () => ({ ...await vi.importActual('../../src/engine/incomingReferences'), readIncomingReferenceTable: ports.source }));
vi.mock('../../src/engine/structureDefinition', async () => ({ ...await vi.importActual('../../src/engine/structureDefinition'), structureTaskQuery: ports.query }));
vi.mock('../../src/engine/queryStreamProtocol', async () => ({ ...await vi.importActual('../../src/engine/queryStreamProtocol'), consumeQueryFrames: ports.frames }));
import { planTableFilteredExport, prepareTableFilteredExport } from '../../src/engine/tableFilteredExport';
import { nativeAtomicFileIO } from '../../src/engine/atomicFile';

const directories: string[] = [];
/** 只清理本例mkdtemp直接子文件；不递归处理其它目录。 */
afterEach(async () => { for (const directory of directories.splice(0)) { for (const file of await readdir(directory)) await rm(join(directory, file)); await rmdir(directory); } });
const names = ['id', 'amount', 'at_value', 'label', 'payload', 'calculated', 'floating'];
const types = ['LONGLONG', 'NEWDECIMAL', 'DATETIME', 'VAR_STRING', 'BLOB', 'LONG', 'FLOAT'];
let source: TableInfo, afterSource: TableInfo | undefined, rawRows: CellValue[][], warnings: unknown[], eofWarning: number | undefined, columns: string[], rawTypes: string[], afterRow: (() => void) | undefined, cancelled: boolean, context: StructureTaskContext, seen: string[];
const start = (): QueryExportFrame => ({ kind: 'rows-start', resultOrdinal: 1, statementOrdinal: 1, rowResultOrdinal: 1, columns: columns.map((name, index) => ({ position: index + 1, key: 'c' + index, name, exportName: name, type: rawTypes[index] })) });
beforeEach(() => {
  source = { database: '库`名', name: 'subject', engine: 'InnoDB', objectKind: 'table', charset: 'utf8mb4', collation: 'utf8mb4_general_ci', columns: names.map((name, index) => ({ name, type: ['BIGINT UNSIGNED', 'DECIMAL(30,12)', 'DATETIME(6)', 'VARCHAR(50)', 'BLOB', 'INT', 'FLOAT'][index], nullable: index !== 0, defaultValue: null, extra: index === 5 ? 'VIRTUAL GENERATED' : '', comment: '', generated: index === 5 })), indexes: [{ name: 'PRIMARY', unique: true, columns: ['id'] }], foreignKeys: [], primaryKey: ['id'], editableKey: ['id'], ddl: 'CREATE TABLE `subject` (`id` bigint unsigned NOT NULL,`amount` decimal(30,12),`at_value` datetime(6),`label` varchar(50),`payload` blob,`calculated` int GENERATED ALWAYS AS (1+2) VIRTUAL,`floating` float,PRIMARY KEY (`id`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4' };
  rawRows = [['18446744073709551615', '9007199254740993.123456789012', '2026-10-23 12:34:56.123456', '', { type: 'binary', base64: 'AP8=' }, 3, Math.fround(0.1)], ['18446744073709551614', null, null, 'NULL\n中文', { type: 'binary', base64: '' }, 3, -0]];
  afterSource = undefined; warnings = []; eofWarning = 0; columns = [...names]; rawTypes = [...types]; afterRow = undefined; cancelled = false; seen = [];
  context = { managed: { sqlMode: '', status: { version: '8.4.11', dialect: 'mysql' }, broken: false }, checkCancelled() { if (cancelled) throw Error('原任务已取消'); }, report: vi.fn(), commandStarted: vi.fn(() => vi.fn()) } as unknown as StructureTaskContext;
  let reads = 0; ports.source.mockReset().mockImplementation(async () => { seen.push('SOURCE'); return ++reads === 1 || !afterSource ? source : afterSource; });
  ports.query.mockReset().mockImplementation(async (_context, sql: string) => { seen.push(sql); return { rows: sql === 'SHOW WARNINGS LIMIT 21' ? warnings : [], fields: [] }; });
  ports.frames.mockReset().mockImplementation(async (_managed, sql: string, wire: string, consumer) => { seen.push(sql); expect(wire).toBe('binary'); await consumer.consume(start()); for (const row of rawRows) { await consumer.consume({ kind: 'row', resultOrdinal: 1, values: row }); afterRow?.(); } await consumer.consume({ kind: 'rows-end', resultOrdinal: 1, warningCount: eofWarning }); });
});
/** 元数据键取自固定目录，原目标预先存在以发现失败时的误替换。 */
async function input(patch: Partial<TableFilteredExportInput> = {}): Promise<TableFilteredExportInput & { filePath: string }> {
  const directory = await mkdtemp(join(tmpdir(), 'dbark-filtered-export-')); directories.push(directory); const filePath = join(directory, 'result'); await writeFile(filePath, '原目标');
  return { connectionId: 'c', database: source.database, table: source.name, taskId: 'task', fileToken: 'token', metadataKey: tableCopyMetadataKey(source), filters: [], sort: [], format: 'json', encoding: 'utf8', filePath, ...patch };
}

describe('当前服务器筛选全部行SQL计划', () => {
  it.each(['csv', 'json', 'sql', 'xlsx'] as const)('%s显式列顺序只控制SELECT，未选列仍可筛选、排序及补可靠键', async format => {
    const request = await input({ format, columns: ['payload', 'amount'], filters: [{ column: 'label', operator: '=', value: '中文' }], sort: [{ column: 'calculated', direction: 'DESC' }] });
    const plan = planTableFilteredExport(source, request);
    expect(plan.columns.map(column => column.name)).toEqual(['payload', 'amount']); expect(plan.columns[0]).toBe(source.columns[4]);
    expect(plan.sql).toMatch(/^SELECT `payload`, `amount` FROM /); expect(plan.sql).toContain('`label`'); expect(plan.sql).toMatch(/ORDER BY `calculated` DESC, `id` ASC$/);
    expect(plan.sql).not.toMatch(/\bLIMIT\b|\bOFFSET\b|SELECT \*/); expect(source.columns.map(column => column.name)).toEqual(names);
  });
  it('共享字段选择保持旧默认语义，显式SQL生成列拒绝而不悄悄剔除', () => {
    expect(selectTableFilteredExportColumns(source, { format: 'json' })).toBe(source.columns);
    expect(selectTableFilteredExportColumns(source, { format: 'sql' }).map(column => column.name)).toEqual(names.filter(name => name !== 'calculated'));
    expect(selectTableFilteredExportColumns(source, { format: 'xlsx', columns: ['calculated', 'id'] })).toEqual([source.columns[5], source.columns[0]]);
    expect(() => selectTableFilteredExportColumns(source, { format: 'sql', columns: ['id', 'calculated'] })).toThrow('生成列');
    const duplicated = { ...source, columns: [...source.columns, { ...source.columns[0] }] };
    expect(() => selectTableFilteredExportColumns(duplicated, { format: 'json', columns: ['amount'] })).toThrow();
    const maximum = Array.from({ length: tableFilteredExportLimits.columns }, (_, index) => ({ ...source.columns[0], name: 'c' + index })), wide = { ...source, columns: maximum };
    expect(selectTableFilteredExportColumns(wide, { format: 'json', columns: maximum.map(column => column.name) })).toHaveLength(tableFilteredExportLimits.columns);
  });
  it('显式列选择仍要求完整源metadataKey，不能拿投影后的目录键绕过未选字段变化', async () => {
    const request = await input({ columns: ['id'], metadataKey: tableCopyMetadataKey({ ...source, columns: [source.columns[0]] }) });
    expect(() => planTableFilteredExport(source, request)).toThrow('变化');
  });
  it('OR/嵌套/停用与精确参数复用；多列原顺序加可靠键，不附LIMIT或OFFSET', async () => {
    const request = await input({ filters: [{ column: 'amount', operator: '>', value: '9007199254740993.123456789011' }, { column: 'label', operator: '=', value: '中文' }, { column: 'id', operator: '=', value: '0', enabled: false }], filterGroup: { mode: 'all', children: [{ mode: 'any', children: [0, 1] }, 2] }, sort: [{ column: 'amount', direction: 'DESC' }, { column: 'at_value', direction: 'ASC' }] });
    const plan = planTableFilteredExport(source, request); expect(plan.sql).toContain(' OR '); expect(plan.sql).toContain('DECIMAL(65,12)'); expect(plan.sql).toContain(Buffer.from('9007199254740993.123456789011').toString('hex')); expect(plan.sql).toMatch(/ORDER BY `amount` DESC, `at_value` ASC, `id` ASC$/); expect(plan.sql).not.toMatch(/SELECT \*|\bLIMIT\b|\bOFFSET\b/); expect(plan.columns.map(column => column.name)).toEqual(names);
  });
  it('SQL数据投影排除生成列，但原筛选及排序仍可引用其原元数据', async () => {
    const plan = planTableFilteredExport(source, await input({ format: 'sql', sort: [{ column: 'calculated', direction: 'DESC' }] })); expect(plan.columns.map(column => column.name)).toEqual(names.filter(name => name !== 'calculated')); expect(plan.sql).toContain('ORDER BY `calculated` DESC, `id` ASC'); expect(plan.sql.slice(0, plan.sql.indexOf(' FROM '))).not.toContain('`calculated`');
  });
  it('视图SQL不假设INSERT可写性，原文件保持且零全量SELECT；其它三格式仍可生成读取计划', async () => {
    source.objectKind = 'view'; source.engine = ''; source.ddl = 'CREATE VIEW `subject` AS SELECT `id`,`amount`,`at_value`,`label`,`payload`,1+2 AS `calculated`,`floating` FROM `库``名`.`base`';
    const request = await input({ format: 'sql' }); await expect(prepareTableFilteredExport(context, request, { stop: vi.fn(), onCommitStart() {} })).rejects.toThrow('无法确认视图INSERT可写性');
    expect(await readFile(request.filePath, 'utf8')).toBe('原目标'); expect(await readdir(directories.at(-1)!)).toEqual(['result']); expect(ports.frames).not.toHaveBeenCalled();
    for (const format of ['csv', 'json', 'xlsx'] as const) expect(planTableFilteredExport(source, { ...request, format }).columns.map(column => column.name)).toEqual(names);
  });
  it('旧metadataKey、未知/重复排序、非法方向及其它格式携带CSV参数零执行拒绝', async () => {
    for (const patch of [{ metadataKey: 'stale' }, { sort: [{ column: 'missing', direction: 'ASC' }] }, { sort: [{ column: 'label', direction: 'ASC' }, { column: 'label', direction: 'DESC' }] }, { sort: [{ column: 'label', direction: 'INVALID' }] }, { format: 'json', csvDelimiter: ';' }]) expect(() => planTableFilteredExport(source, { ...{ connectionId: 'c', database: source.database, table: source.name, taskId: 't', fileToken: 'f', metadataKey: tableCopyMetadataKey(source), filters: [], sort: [], format: 'json', encoding: 'utf8' }, ...patch } as TableFilteredExportInput)).toThrow();
    expect(ports.frames).not.toHaveBeenCalled();
  });
});

describe('真实文件完整暂存与精度', () => {
  it.each(['csv', 'json', 'sql', 'xlsx'] as const)('%s真实文件仅含有序选列并保留精确值及NULL/空字节', async format => {
    const selected = ['payload', 'amount', 'id'], positions = selected.map(name => names.indexOf(name));
    columns = selected; rawTypes = positions.map(index => types[index]); rawRows = rawRows.map(row => positions.map(index => row[index]));
    const request = await input({ format, columns: selected }), staged = await prepareTableFilteredExport(context, request, { stop: vi.fn(), onCommitStart() {} });
    expect(await readFile(request.filePath, 'utf8')).toBe('原目标'); expect(staged.rows).toBe(2); await staged.commit(); await staged.dispose();
    expect(ports.frames.mock.calls[0][1]).toMatch(/^SELECT `payload`, `amount`, `id` FROM /);
    if (format === 'xlsx') {
      const workbook = new ExcelJS.Workbook(); await workbook.xlsx.readFile(request.filePath); const sheet = workbook.worksheets[0];
      expect(sheet.columnCount).toBe(3); expect(sheet.rowCount).toBe(3); expect(selected.map((_name, index) => sheet.getCell(1, index + 1).text)).toEqual(selected);
      expect(sheet.getCell('A2').text).toBe('\\B:AP8='); expect(sheet.getCell('B2').text).toBe('9007199254740993.123456789012'); expect(sheet.getCell('C2').text).toBe('18446744073709551615'); expect(sheet.getCell('B3').text).toBe('\\N');
    } else {
      const content = await readFile(request.filePath, 'utf8');
      if (format === 'json') {
        const values = JSON.parse(content); expect(Object.keys(values[0])).toEqual(selected); expect(Object.keys(values[1])).toEqual(selected);
        expect(values).toEqual([{ payload: { type: 'binary', base64: 'AP8=' }, amount: '9007199254740993.123456789012', id: '18446744073709551615' }, { payload: { type: 'binary', base64: '' }, amount: null, id: '18446744073709551614' }]);
      } else if (format === 'csv') {
        expect(parse(content)).toEqual([selected, ['base64:AP8=', '9007199254740993.123456789012', '18446744073709551615'], ['base64:', '\\N', '18446744073709551614']]);
      } else {
        expect(content).toContain('INSERT INTO `库``名`.`subject` (`payload`, `amount`, `id`) VALUES ('); expect(content).toContain("X'00ff'"); expect(content).toContain(Buffer.from('9007199254740993.123456789012').toString('hex')); expect(content).toContain(Buffer.from('18446744073709551615').toString('hex')); expect(content).toContain('NULL');
        for (const omitted of ['at_value', 'label', 'calculated', 'floating']) expect(content).not.toContain('`' + omitted + '`');
      }
    }
  });
  it.each(['csv', 'json', 'sql', 'xlsx'] as const)('%s非法字段选择在打开暂存或执行数据SELECT之前拒绝，原文件不变', async format => {
    const invalid: string[][] = [[], ['id', 'id'], ['missing'], Array.from({ length: tableFilteredExportLimits.columns + 1 }, (_, index) => 'c' + index)];
    if (format === 'sql') invalid.push(['id', 'calculated']);
    for (const columns of invalid) {
      const request = await input({ format, columns }), open = vi.fn(nativeAtomicFileIO.open);
      await expect(prepareTableFilteredExport(context, request, { stop: vi.fn(), onCommitStart() {}, io: { ...nativeAtomicFileIO, open } })).rejects.toThrow();
      expect(open).not.toHaveBeenCalled(); expect(ports.frames).not.toHaveBeenCalled(); expect(await readFile(request.filePath, 'utf8')).toBe('原目标'); expect(await readdir(directories.at(-1)!)).toEqual(['result']);
    }
  });
  it('JSON单数组保留精确文本/NULL/字节/负零，原文件仅显式commit后替换', async () => {
    const request = await input(), startCommit = vi.fn(), staged = await prepareTableFilteredExport(context, request, { stop: vi.fn(), onCommitStart: startCommit });
    expect(await readFile(request.filePath, 'utf8')).toBe('原目标'); expect(staged.rows).toBe(2); expect(staged.fileCommitted).toBe(false); expect(startCommit).not.toHaveBeenCalled(); expect(seen.at(-1)).toBe('ROLLBACK AND NO CHAIN NO RELEASE');
    expect(await staged.commit()).toEqual({ rows: 2, fileCommitted: true }); await staged.dispose(); const content = await readFile(request.filePath, 'utf8'), values = JSON.parse(content);
    expect(values[0]).toMatchObject({ id: '18446744073709551615', amount: '9007199254740993.123456789012', at_value: '2026-10-23 12:34:56.123456', label: '', payload: { type: 'binary', base64: 'AP8=' }, calculated: 3 }); expect(values[0].floating).toBe(Math.fround(0.1)); expect(Object.is(values[1].floating, -0)).toBe(true); expect(startCommit).toHaveBeenCalledOnce();
    const sql = seen.find(item => item.startsWith('SELECT `id`'))!; expect(seen[seen.indexOf(sql) + 1]).toBe('SHOW WARNINGS LIMIT 21'); expect(ports.frames).toHaveBeenCalledOnce();
  });
  it.each(['utf8', 'utf16le', 'gb18030'] as const)('CSV %s原分隔与NULL协议往返，负零不被String吞掉', async encoding => {
    const request = await input({ format: 'csv', encoding, csvDelimiter: ';' }), staged = await prepareTableFilteredExport(context, request, { stop: vi.fn(), onCommitStart() {} }); await staged.commit(); await staged.dispose();
    const records = parse(iconv.decode(await readFile(request.filePath), encoding), { delimiter: ';', bom: true }); expect(records[0]).toEqual(names); expect(records[1]).toEqual(['18446744073709551615', '9007199254740993.123456789012', '2026-10-23 12:34:56.123456', '', 'base64:AP8=', '3', String(Math.fround(0.1))]); expect(records[2][1]).toBe('\\N'); expect(records[2][6]).toBe('-0');
  });
  it('SQL仅数据INSERT和实际列位置，生成列不写入，UINT64/DECIMAL/二进制保持', async () => {
    const request = await input({ format: 'sql' }); columns.splice(5, 1); rawTypes.splice(5, 1); rawRows = rawRows.map(row => { const copy = row.filter((_cell, index) => index !== 5); copy[5] = Math.fround(0.1); return copy; });
    const staged = await prepareTableFilteredExport(context, request, { stop: vi.fn(), onCommitStart() {} }); await staged.commit(); await staged.dispose(); const content = await readFile(request.filePath, 'utf8');
    expect(content).toContain('INSERT INTO `库``名`.`subject` (`id`, `amount`, `at_value`, `label`, `payload`, `floating`) VALUES ('); expect(content).not.toContain('`calculated`'); expect(content).not.toMatch(/CREATE TABLE|ALTER TABLE|DROP TABLE/); expect(content).toContain(Buffer.from('9007199254740993.123456789012').toString('hex')); expect(content).toContain("X'00ff'");
    expect(content).toContain('NO_AUTO_VALUE_ON_ZERO'); expect(content).toContain('目标会话时区必须与源导出会话一致'); expect(content).toContain('不自动切换或恢复sql_mode、时区等会话设置'); expect(content).not.toMatch(/^SET\b/m);
  });
  it('XLSX真实ZIP完整暂存后可独立读回大整数文本、NULL协议及全部生成列', async () => {
    const request = await input({ format: 'xlsx' }), staged = await prepareTableFilteredExport(context, request, { stop: vi.fn(), onCommitStart() {} }); expect(await readFile(request.filePath, 'utf8')).toBe('原目标'); await staged.commit(); await staged.dispose();
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.readFile(request.filePath); const sheet = workbook.worksheets[0]; expect(sheet.rowCount).toBe(3); expect(sheet.getRow(1).values).toHaveLength(8); expect(sheet.getCell('A2').text).toBe('18446744073709551615'); expect(sheet.getCell('B2').text).toBe('9007199254740993.123456789012'); expect(sheet.getCell('E2').text).toBe('\\B:AP8='); expect(sheet.getCell('G3').text).toBe('-0');
  });
  it('超200行不沿客户端页截断，不积累整表后才写；空集仍有完整文件', async () => {
    rawRows = Array.from({ length: 1201 }, (_, index) => [String(index), '1.000000000000', null, '', null, 3, 0]); const request = await input(), staged = await prepareTableFilteredExport(context, request, { stop: vi.fn(), onCommitStart() {} }); expect(staged.rows).toBe(1201); await staged.commit(); await staged.dispose(); expect(JSON.parse(await readFile(request.filePath, 'utf8'))).toHaveLength(1201);
    rawRows = []; const empty = await input(), emptyStage = await prepareTableFilteredExport(context, empty, { stop: vi.fn(), onCommitStart() {} }); await emptyStage.commit(); await emptyStage.dispose(); expect(JSON.parse(await readFile(empty.filePath, 'utf8'))).toEqual([]);
  });
  it.each(['csv', 'json', 'sql', 'xlsx'] as const)('%s警告、旧源或取消拒绝发布，原目标保持且独占暂存清理', async format => {
    const request = await input({ format }); warnings = [{ Level: 'Warning', Code: 1265, Message: '合成转换' }];
    // SQL先消除另有专门拒绝用例的负零，不让无关类型门遮住本次原warning测试。
    if (format === 'sql') { columns.splice(5, 1); rawTypes.splice(5, 1); rawRows = rawRows.map(row => row.filter((_cell, index) => index !== 5).map(value => typeof value === 'number' && Object.is(value, -0) ? 0 : value)); }
    await expect(prepareTableFilteredExport(context, request, { stop: vi.fn(), onCommitStart() {} })).rejects.toThrow('警告'); expect(await readFile(request.filePath, 'utf8')).toBe('原目标'); expect(await readdir(directories.at(-1)!)).toEqual(['result']);
  });
  it('原定义变化、未知协议类型和实际取消不允许降级或重放', async () => {
    const request = await input(); afterSource = { ...source, ddl: source.ddl + " COMMENT='changed'" }; await expect(prepareTableFilteredExport(context, request, { stop: vi.fn(), onCommitStart() {} })).rejects.toThrow('变化'); expect(await readFile(request.filePath, 'utf8')).toBe('原目标');
    afterSource = undefined; rawTypes[0] = 'GEOMETRY'; const other = await input(); await expect(prepareTableFilteredExport(context, other, { stop: vi.fn(), onCommitStart() {} })).rejects.toThrow(); expect(await readFile(other.filePath, 'utf8')).toBe('原目标');
    rawTypes = [...types]; afterRow = () => { cancelled = true; }; const last = await input(); await expect(prepareTableFilteredExport(context, last, { stop: vi.fn(), onCommitStart() {} })).rejects.toThrow('取消'); expect(await readFile(last.filePath, 'utf8')).toBe('原目标');
  });
  it('XLSX不可编码原字符导致生产者退出，不挂起单行握手或误替换原目标', async () => {
    rawRows[0][3] = '\0'; const request = await input({ format: 'xlsx' }); await expect(prepareTableFilteredExport(context, request, { stop: vi.fn(), onCommitStart() {} })).rejects.toThrow(); expect(await readFile(request.filePath, 'utf8')).toBe('原目标');
  });
  it('原目标互斥维持到dispose，准备后取消不得替换，未知rename失败保原目标', async () => {
    const request = await input(), staged = await prepareTableFilteredExport(context, request, { stop: vi.fn(), onCommitStart() {} });
    await expect(prepareTableFilteredExport(context, request, { stop: vi.fn(), onCommitStart() {} })).rejects.toThrow('另一个任务'); cancelled = true; await expect(staged.commit()).rejects.toThrow('取消'); await staged.dispose(); expect(await readFile(request.filePath, 'utf8')).toBe('原目标');
    cancelled = false; const failing = await prepareTableFilteredExport(context, request, { stop: vi.fn(), onCommitStart() {}, io: { ...nativeAtomicFileIO, async rename() { throw Error('合成rename失败'); } } }); await expect(failing.commit()).rejects.toThrow('rename失败'); await failing.dispose(); expect(await readFile(request.filePath, 'utf8')).toBe('原目标');
  });
});
