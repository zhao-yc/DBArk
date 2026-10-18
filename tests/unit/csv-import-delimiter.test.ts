import { mkdir, mkdtemp, readdir, rm, rmdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import iconv from 'iconv-lite';
import type { CellValue, ConnectionProfile, TableInfo } from '../../src/shared/contracts';
import type { CsvImportDelimiter } from '../../src/shared/csvImport';
import { previewFile, readRecords } from '../../src/engine/files';
import { validateCommand } from '../../src/shared/validation';
const mocks = vi.hoisted(() => ({ connect: vi.fn(), execute: vi.fn(), tableInfo: vi.fn() }));
vi.mock('../../src/engine/connection', () => ({ connect: mocks.connect, execute: mocks.execute }));
vi.mock('../../src/engine/metadata', () => ({ tableInfo: mocks.tableInfo }));
import { Engine } from '../../src/engine';

const folders: string[] = [];
let engine: Engine | undefined;
/** 手工文件作为输入，不借用产品导出器生成被测解析器的预期结果。 */
async function fixture(text: string, encoding = 'utf8') {
  const base = join(process.cwd(), '.cache/f01-csv-import/tmp'); await mkdir(base, { recursive: true });
  const folder = await mkdtemp(join(base, 'case-')); folders.push(folder);
  const filePath = join(folder, 'source.csv'); await writeFile(filePath, iconv.encode(text, encoding)); return filePath;
}
/** 清理仅限本文件登记的新目录和其中的普通测试文件。 */
afterEach(async () => { await engine?.closeAll(); engine = undefined; for (const folder of folders.splice(0)) { for (const name of await readdir(folder)) await rm(join(folder, name)); await rmdir(folder); } });
/** 消费真实流式读取器，覆盖预览上限外的记录。 */
async function records(path: string, delimiter?: CsvImportDelimiter) { const rows = []; for await (const row of readRecords(path, 'csv', 'utf8', delimiter)) rows.push(row); return rows; }

describe('CSV 分隔符文件解析与严格合同', () => {
  it.each([',', ';', '\t'] as const)('分隔符 %j 保留引号、跨行、尾空列及值协议，预览和完整流均符合手工期望', async csvDelimiter => {
    const d = csvDelimiter;
    const path = await fixture(`id${d}内容${d}空值${d}原文${d}字节${d}尾列\r\n18446744073709551615${d}"含${d}分隔符和""引号""\r\n第二行"${d}\\N${d}\\\\N${d}base64:AAH/${d}\r\n`);
    const expected = [{ id: '18446744073709551615', 内容: `含${d}分隔符和"引号"\r\n第二行`, 空值: null, 原文: '\\N', 字节: 'base64:AAH/', 尾列: '' }];
    expect(await previewFile({ filePath: path, format: 'csv', encoding: 'utf8', csvDelimiter })).toEqual({ columns: ['id', '内容', '空值', '原文', '字节', '尾列'], rows: expected });
    expect(await records(path, csvDelimiter)).toEqual(expected);
  });
  it('缺省调用仍为逗号，不自动猜测分号，三个编码保留原文', async () => {
    const path = await fixture('id,内容\n1,中文;原文\n');
    expect(await records(path)).toEqual([{ id: '1', 内容: '中文;原文' }]);
    expect(await previewFile({ filePath: await fixture('id;内容\n1;中文'), format: 'csv', encoding: 'utf8' })).toEqual({ columns: ['id;内容'], rows: [{ 'id;内容': '1;中文' }] });
    for (const encoding of ['utf8', 'utf16le', 'gb18030']) {
      expect((await previewFile({ filePath: await fixture('id\t内容\r\n1\t中文', encoding), format: 'csv', encoding, csvDelimiter: '\t' })).rows).toEqual([{ id: '1', 内容: '中文' }]);
    }
  });
  it('预览只取二十行，后续记录仍使用已选分号；重复或空标题和列数不一致拒绝', async () => {
    const path = await fixture('id;内容\n' + Array.from({ length: 22 }, (_, i) => `${i};"第${i};行"`).join('\n'));
    const preview = await previewFile({ filePath: path, format: 'csv', encoding: 'utf8', csvDelimiter: ';' });
    expect(preview.rows).toHaveLength(20); expect(preview.rows[19]).toEqual({ id: '19', 内容: '第19;行' });
    const full = await records(path, ';'); expect(full).toHaveLength(22); expect(full[21]).toEqual({ id: '21', 内容: '第21;行' });
    for (const text of ['id;id\n1;2', 'id;\n1;2', 'id;内容\n1']) await expect(records(await fixture(text), ';')).rejects.toThrow();
  });
  it('预览导入及CSV导出接纳三种单字符与历史缺省，其他格式及扩展参数继续拒绝', async () => {
    const preview = { fileToken: 'f', format: 'csv', encoding: 'utf8' };
    const input = { ...preview, connectionId: 'c', database: 'db', table: 't', mapping: { id: 'id' }, taskId: 'task' };
    for (const [command, value] of [['files.preview', preview], ['files.import', input]] as const) {
      expect(validateCommand(command, value)).toEqual(value);
      for (const csvDelimiter of [',', ';', '\t']) expect(validateCommand(command, { ...value, csvDelimiter })).toMatchObject({ csvDelimiter });
      for (const csvDelimiter of ['', '|', ';;', 'tab', '\n', null, 1, [';']]) expect(() => validateCommand(command, { ...value, csvDelimiter })).toThrow('参数无效');
      expect(() => validateCommand(command, { ...value, format: 'json', csvDelimiter: ',' })).toThrow();
      for (const extra of [{ header: false }, { autoDelimiter: true }, { filePath: '/secret' }]) expect(() => validateCommand(command, { ...value, ...extra })).toThrow();
    }
    expect(() => validateCommand('files.import', { ...input, format: 'sql', csvDelimiter: ';' })).toThrow();
    const { mapping: _mapping, ...exportBase } = input;
    const exportInput = { ...exportBase, includeData: true, includeStructure: false };
    expect(validateCommand('files.export', exportInput)).toEqual(exportInput);
    // CSV导出已开放相同枚举；保留对非法值、非CSV夹带及额外参数的拒绝保护。
    for (const csvDelimiter of [',', ';', '\t']) expect(validateCommand('files.export', { ...exportInput, csvDelimiter })).toEqual({ ...exportInput, csvDelimiter });
    for (const csvDelimiter of ['', '|', ';;', 'tab', '\n', null, undefined, 1, [';']]) expect(() => validateCommand('files.export', { ...exportInput, csvDelimiter })).toThrow();
    for (const format of ['json', 'sql']) expect(() => validateCommand('files.export', { ...exportInput, format, csvDelimiter: ';' })).toThrow();
    for (const extra of [{ header: false }, { autoDelimiter: true }, { filePath: '/secret' }]) expect(() => validateCommand('files.export', { ...exportInput, csvDelimiter: ';', ...extra })).toThrow();
    await expect(records(await fixture('id\n1'), '|' as CsvImportDelimiter)).rejects.toThrow('分隔符');
    const json = await fixture('[{"id":"1"}]');
    await expect(previewFile({ filePath: json, format: 'json', encoding: 'utf8', csvDelimiter: ';' })).rejects.toThrow('分隔符');
  });
});

const profile: ConnectionProfile = { id: 'csv', name: '离线驱动', group: '', color: '#123456', dialect: 'mysql', host: 'test.invalid', port: 3306, user: 'test' };
const target = { connectionId: profile.id, database: '隔离库', table: '表', fileToken: '授权文件' };
const columns = [{ name: 'id', type: 'bigint unsigned' }, { name: '金额', type: 'decimal(30,12)' }, { name: '内容', type: 'text' }, { name: '字节', type: 'blob' }, { name: '空值', type: 'text' }, { name: '尾列', type: 'text' }];
let inserts: CellValue[][];
/** 只模拟数据库驱动和元数据；任务、真实文件解析、映射及 INSERT/事务调度均走正式引擎。 */
beforeEach(() => {
  inserts = [];
  const info: TableInfo = { database: target.database, name: target.table, engine: 'InnoDB', columns: columns.map(column => ({ ...column, nullable: true, generated: false, defaultValue: null, extra: '', comment: '' })), indexes: [], foreignKeys: [], primaryKey: ['id'], editableKey: ['id'], ddl: '' };
  mocks.tableInfo.mockReset().mockResolvedValue(info);
  mocks.execute.mockReset().mockImplementation(async (_managed, sql: string, params: CellValue[]) => { if (sql.startsWith('INSERT')) inserts.push(params); return { rows: { affectedRows: 1, warningStatus: 0, serverStatus: 2 }, fields: [] }; });
  mocks.connect.mockReset().mockResolvedValue({ profile, sqlMode: '', serverStatus: 2, status: { dialect: 'mysql', version: '模拟' }, broken: false, close: vi.fn() });
});
describe('CSV 分隔符正式引擎接线', () => {
  it.each([undefined, ',', ';', '\t'] as const)('预览到导入 %j 的真实 INSERT 参数独立核对精确数值、NULL、BLOB 与尾空列', async csvDelimiter => {
    const d = csvDelimiter ?? ',';
    const filePath = await fixture(`id${d}金额${d}内容${d}字节${d}空值${d}尾列\n18446744073709551615${d}123456789012345678.123456789012${d}"含${d}双""引号""\n跨行"${d}base64:AAH/${d}\\N${d}\n`);
    engine = new Engine(() => {}); await engine.handle('connections.open', { id: profile.id, profile });
    const input = { ...target, filePath, format: 'csv', encoding: 'utf8', ...(csvDelimiter === undefined ? {} : { csvDelimiter }) };
    const sample = await engine.handle('files.preview', input);
    expect(sample.columns).toEqual(['id', '金额', '内容', '字节', '空值', '尾列']);
    expect(sample.rows).toEqual([{ id: '18446744073709551615', 金额: '123456789012345678.123456789012', 内容: `含${d}双"引号"\n跨行`, 字节: 'base64:AAH/', 空值: null, 尾列: '' }]);
    await expect(engine.handle('files.import', { ...input, mapping: Object.fromEntries(sample.columns.map((name: string) => [name, name])), taskId: '导入' })).resolves.toEqual({ rows: 1, errors: [] });
    expect(inserts).toEqual([['18446744073709551615', '123456789012345678.123456789012', `含${d}双"引号"\n跨行`, Buffer.from([0, 1, 255]), null, '']]);
    expect(mocks.execute.mock.calls.filter(call => call[1].startsWith('INSERT')).map(call => call[1])).toEqual(['INSERT INTO `隔离库`.`表` (`id`, `金额`, `内容`, `字节`, `空值`, `尾列`) VALUES (?, ?, ?, ?, ?, ?)']);
    expect(mocks.execute.mock.calls.map(call => call[1])).toEqual(['START TRANSACTION', 'INSERT INTO `隔离库`.`表` (`id`, `金额`, `内容`, `字节`, `空值`, `尾列`) VALUES (?, ?, ?, ?, ?, ?)', 'COMMIT']);
  });
  it('分号文件超过预览及批次边界，第二批警告保持先前五百行并立即回滚', async () => {
    const filePath = await fixture('id;内容\n' + Array.from({ length: 502 }, (_, index) => `${index};"值;${index}"`).join('\n'));
    engine = new Engine(() => {}); await engine.handle('connections.open', { id: profile.id, profile });
    mocks.execute.mockImplementation(async (_managed, sql: string, params: CellValue[]) => {
      if (sql.startsWith('INSERT')) inserts.push(params);
      return { rows: sql.startsWith('SHOW WARNINGS') ? [{ Code: 1265 }] : { affectedRows: 1, serverStatus: 2, warningStatus: sql.startsWith('INSERT') && inserts.length === 501 ? 1 : 0 }, fields: [] };
    });
    const result = await engine.handle('files.import', { ...target, filePath, format: 'csv', encoding: 'utf8', csvDelimiter: ';', mapping: { id: 'id', 内容: '内容' }, taskId: '分批导入' });
    expect(result.rows).toBe(500); expect(result.errors[0]).toContain('当前批 1 行已回滚'); expect(result.errors[0]).toContain('1265');
    expect(inserts).toHaveLength(501); expect(inserts[500]).toEqual(['500', '值;500']);
    expect(mocks.execute.mock.calls.filter(call => call[1] === 'COMMIT')).toHaveLength(1);
    expect(mocks.execute.mock.calls.slice(-2).map(call => call[1])).toEqual(['SHOW WARNINGS LIMIT 32', 'ROLLBACK']);
  });
});
