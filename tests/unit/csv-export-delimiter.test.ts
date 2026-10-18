import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { mkdir, mkdtemp, open, readFile, readdir, rename, rm, rmdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import iconv from 'iconv-lite';
import { parse } from 'csv-parse/sync';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionProfile, ResultExportData, TableInfo, TaskEvent } from '../../src/shared/contracts';
import { csvExportDelimiter, csvExportOptions, type CsvExportDelimiter } from '../../src/shared/csvExport';
import { validateCommand } from '../../src/shared/validation';
import { csvCell, csvHeader } from '../../src/engine/files';
import { ResultFileTasks, type ResultFileIO } from '../../src/engine/resultFileTasks';
const mocks = vi.hoisted(() => ({ connect: vi.fn(), execute: vi.fn(), tableInfo: vi.fn() }));
vi.mock('../../src/engine/connection', () => ({ connect: mocks.connect, execute: mocks.execute }));
vi.mock('../../src/engine/metadata', () => ({ tableInfo: mocks.tableInfo }));
import { Engine } from '../../src/engine';

const folders: string[] = [];
let engine: Engine | undefined;
/** 仅本克隆缓存中的新目录包含真实文件；不使用本机数据库或系统临时目录。 */
async function destination() { const base = join(process.cwd(), '.cache/csv-export-delimiter/tmp'); await mkdir(base, { recursive: true }); const directory = await mkdtemp(join(base, 'case-')); folders.push(directory); const path = join(directory, 'result.csv'); await writeFile(path, '原目标'); return path; }
afterEach(async () => { await engine?.closeAll(); engine = undefined; for (const folder of folders.splice(0)) { for (const name of await readdir(folder)) await rm(join(folder, name)); await rmdir(folder); } });

const selected = ['raw', 'nullable', '分号;字段', 'id', '金额', 'slash', 'tail'];
const cellValues = { id: '9007199254740993', 金额: '1.2000000000000000001', '分号;字段': '分号;Tab\t,双"引号\r\n下一行', nullable: null, raw: { type: 'binary' as const, base64: 'AAH/' }, slash: '\\N', tail: '' };
const data: ResultExportData = { columns: selected.map(name => ({ key: name, name })), rows: [Object.fromEntries(Object.entries(cellValues).reverse())], truncated: true };
// 字节期望手写，不调用被测导出函数或导入器生成答案。
const expected = {
  ',': 'raw,nullable,分号;字段,id,金额,slash,tail\r\nbase64:AAH/,\\N,"分号;Tab\t,双""引号\r\n下一行",9007199254740993,1.2000000000000000001,\\\\N,""\r\n',
  ';': 'raw;nullable;"分号;字段";id;金额;slash;tail\r\nbase64:AAH/;\\N;"分号;Tab\t,双""引号\r\n下一行";9007199254740993;1.2000000000000000001;\\\\N;""\r\n',
  '\t': 'raw\tnullable\t分号;字段\tid\t金额\tslash\ttail\r\nbase64:AAH/\t\\N\t"分号;Tab\t,双""引号\r\n下一行"\t9007199254740993\t1.2000000000000000001\t\\\\N\t""\r\n',
};
const combinations = [',', ';', '\t'].flatMap(delimiter => ['utf8', 'utf16le', 'gb18030'].map(encoding => ({ delimiter: delimiter as CsvExportDelimiter, encoding: encoding as 'utf8' | 'utf16le' | 'gb18030' })));

describe('CSV导出分隔符合同与真实结果文件', () => {
  it('两个公开入口仅CSV接纳三值和历史缺项；拒绝非法枚举、显式undefined、其他格式夹带与未知路径', () => {
    const table = { connectionId: 'c', database: 'db', table: 't', fileToken: 'f', format: 'csv', encoding: 'utf8', taskId: 'task', includeData: true, includeStructure: false };
    const result = { fileToken: 'f', format: 'csv', encoding: 'utf8', taskId: 'task', result: data };
    for (const [command, value] of [['files.export', table], ['files.exportResult', result]] as const) {
      expect(validateCommand(command, value)).toEqual(value);
      for (const csvDelimiter of [',', ';', '\t']) expect(validateCommand(command, { ...value, csvDelimiter })).toMatchObject({ csvDelimiter });
      for (const csvDelimiter of [undefined, '', '|', ';;', 'tab', null, [';'], 1]) expect(() => validateCommand(command, { ...value, csvDelimiter })).toThrow();
      for (const format of ['json', 'sql']) {
        // SQL反例使用本来有效的预览合同，避免因缺SQL目标而出现假阳性。
        const nonCsv = { ...value, format, ...(command === 'files.exportResult' && format === 'sql' ? { sql: { target: { database: 'db', table: 't', columns: data.columns.map(column => ({ key: column.key, name: column.name })) }, previewId: '00000000-0000-4000-8000-000000000001', confirmation: 'db.t', acknowledged: true } } : {}) };
        expect(validateCommand(command, nonCsv)).toEqual(nonCsv);
        for (const csvDelimiter of [undefined, ',', ';', '\t']) expect(() => validateCommand(command, { ...nonCsv, csvDelimiter })).toThrow();
      }
      expect(() => validateCommand(command, { ...value, filePath: 'private' })).toThrow();
    }
    expect(csvExportOptions('csv', ',')).toEqual({}); expect(csvExportOptions('json', ';')).toEqual({}); expect(csvExportOptions('csv', ';')).toEqual({ csvDelimiter: ';' });
    expect(() => csvExportDelimiter('csv', '|' as CsvExportDelimiter)).toThrow(); expect(() => csvExportDelimiter('sql', ';')).toThrow();
  });

  it.each(combinations)('结果CSV $delimiter/$encoding 字节与手工预期一致，NULL/空串/BLOB/精度不改变', async ({ delimiter, encoding }) => {
    const path = await destination(), before = structuredClone(data); const events: TaskEvent[] = [];
    await new ResultFileTasks(event => events.push(event)).run({ filePath: path, fileToken: 'f', taskId: 'result', format: 'csv', encoding, csvDelimiter: delimiter, result: data });
    expect(await readFile(path)).toEqual(iconv.encode((encoding === 'utf16le' ? '\uFEFF' : '') + expected[delimiter], encoding)); expect(data).toEqual(before);
    expect(events.at(-1)).toMatchObject({ status: 'completed', rows: 1 }); expect(await readdir(folders.at(-1)!)).toEqual(['result.csv']);
  });

  it('省略与显式逗号保持原字节；其他格式直接文件任务在创建前拒绝分隔符', async () => {
    for (const csvDelimiter of [undefined, ','] as const) { const path = await destination(); await new ResultFileTasks(() => {}).run({ filePath: path, fileToken: 'f', taskId: 'old', format: 'csv', encoding: 'utf8', result: data, ...(csvDelimiter ? { csvDelimiter } : {}) }); expect(await readFile(path, 'utf8')).toBe(expected[',']); }
    const path = await destination();
    await expect(new ResultFileTasks(() => {}).run({ filePath: path, fileToken: 'f', taskId: 'bad', format: 'json', encoding: 'utf8', csvDelimiter: ';', result: data })).rejects.toThrow('CSV'); expect(await readFile(path, 'utf8')).toBe('原目标');
    expect(csvHeader('a\tb', '\t')).toBe('"a\tb"'); expect(csvHeader('a,b', ';')).toBe('a,b'); expect(csvCell('', ';')).toBe('""');
  });

  it('跨64KiB缓冲和短写仍保留双引号/换行/尾空列；同步期间取消保留原目标', async () => {
    const path = await destination(), long = '中'.repeat(23000) + ';"\r\n结束', payload: ResultExportData = { columns: [{ key: 'value', name: 'value' }, { key: 'tail', name: 'tail' }], rows: [{ value: long, tail: '' }], truncated: false };
    let writes = 0; const io: ResultFileIO = { open: async name => { const file = await open(name, 'wx'); return { write: (buffer, offset, length) => { writes++; return file.write(buffer, offset, Math.min(length, 113)); }, sync: () => file.sync(), close: () => file.close() }; }, rename, remove: name => rm(name, { force: true }) };
    await new ResultFileTasks(() => {}, io).run({ filePath: path, fileToken: 'f', taskId: 'large', format: 'csv', encoding: 'utf8', csvDelimiter: ';', result: payload });
    const actual = await readFile(path, 'utf8'); expect(actual).toBe('value;tail\r\n"' + '中'.repeat(23000) + ';""\r\n结束";""\r\n'); expect(parse(actual, { delimiter: ';' })).toEqual([['value', 'tail'], [long, '']]); expect(writes).toBeGreaterThan(500);
    await writeFile(path, '原目标'); let resume!: () => void, entered!: () => void; const gate = new Promise<void>(resolve => { resume = resolve; }), reached = new Promise<void>(resolve => { entered = resolve; });
    const held: ResultFileIO = { ...io, open: async name => { const file = await open(name, 'wx'); return { write: (buffer, offset, length) => file.write(buffer, offset, length), sync: async () => { entered(); await gate; await file.sync(); }, close: () => file.close() }; } };
    const tasks = new ResultFileTasks(() => {}, held), pending = tasks.run({ filePath: path, fileToken: 'f', taskId: 'cancel', format: 'csv', encoding: 'utf8', csvDelimiter: '\t', result: data });
    const failure = expect(pending).rejects.toThrow('取消'); await reached; tasks.cancel('cancel'); resume(); await failure; await tasks.closeAll(); expect(await readFile(path, 'utf8')).toBe('原目标'); expect(await readdir(folders.at(-1)!)).toEqual(['result.csv']);
  });
});

const profile: ConnectionProfile = { id: 'csv', name: '离线驱动', group: '', color: '#123456', dialect: 'mysql', host: 'invalid', port: 3306, user: 'unit' };
let queries: string[], controls: string[];
/** 正式Engine/投影目录/文件均运行，仅数据库驱动和元数据使用RAM边界。 */
beforeEach(() => {
  queries = []; controls = [];
  const info: TableInfo = { database: 'db', name: 't', objectKind: 'table', engine: 'InnoDB', columns: Object.keys(cellValues).map((name, index) => ({ name, type: ['bigint unsigned', 'decimal(30,19)', 'text', 'text', 'blob', 'text', 'text'][index], nullable: true, defaultValue: null, extra: '', comment: '', generated: false })), indexes: [], foreignKeys: [], primaryKey: [], editableKey: [], ddl: 'CREATE TABLE `t` (`id` bigint unsigned,`金额` decimal(30,19),`分号;字段` text,`nullable` text,`raw` blob,`slash` text,`tail` text) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4' };
  mocks.tableInfo.mockReset().mockImplementation(async () => structuredClone(info));
  mocks.execute.mockReset().mockImplementation(async (_managed, sql: string) => { controls.push(sql); return { rows: [] }; });
  mocks.connect.mockReset().mockImplementation(async () => { const connection = new EventEmitter(); Object.assign(connection, { query: (options: { sql: string }) => { queries.push(options.sql); return { stream: () => Readable.from([selected.map(name => name === 'raw' ? Buffer.from([0, 1, 255]) : cellValues[name as keyof typeof cellValues])]) }; } }); return { profile, connection, sqlMode: '', status: { dialect: 'mysql', version: '8.4.11' }, broken: false, close: vi.fn(async () => {}) }; });
});

describe('CSV表导出分隔符与原字段投影', () => {
  it.each(combinations)('表CSV $delimiter/$encoding 沿原SELECT和列序，文件与手工字节一致', async ({ delimiter, encoding }) => {
    const path = await destination(); engine = new Engine(() => {}); await engine.handle('connections.open', { id: profile.id, profile });
    const catalog = await engine.handle('files.exportColumns', { connectionId: profile.id, database: 'db', table: 't', taskId: 'catalog', connectionRevision: 1 });
    await expect(engine.handle('files.export', { connectionId: profile.id, database: 'db', table: 't', filePath: path, format: 'csv', encoding, csvDelimiter: delimiter, includeData: true, includeStructure: false, taskId: 'export', csvSelection: { catalogId: catalog.catalogId, columns: selected }, connectionRevision: 1 })).resolves.toEqual({ rows: 1 });
    expect(queries).toEqual(['SELECT `raw`, `nullable`, `分号;字段`, `id`, `金额`, `slash`, `tail` FROM `db`.`t`']);
    expect(controls).toEqual(['SET TRANSACTION ISOLATION LEVEL REPEATABLE READ', 'START TRANSACTION WITH CONSISTENT SNAPSHOT', 'SELECT 1 FROM `db`.`t` LIMIT 0', 'ROLLBACK']);
    expect(await readFile(path)).toEqual(iconv.encode((encoding === 'utf16le' ? '\uFEFF' : '') + expected[delimiter], encoding)); expect(await readdir(folders.at(-1)!)).toEqual(['result.csv']);
  });
});
