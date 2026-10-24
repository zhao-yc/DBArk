import { mkdir, mkdtemp, readdir, rm, rmdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionProfile, TableInfo } from '../../src/shared/contracts';
const io = vi.hoisted(() => ({ connect: vi.fn(), execute: vi.fn(), tableInfo: vi.fn(), close: vi.fn() }));
vi.mock('../../src/engine/connection', () => ({ connect: io.connect, execute: io.execute }));
vi.mock('../../src/engine/metadata', () => ({ tableInfo: io.tableInfo }));
import { Engine } from '../../src/engine';

const profile: ConnectionProfile = { id: 'csv-header', name: '本例离线连接', group: '', color: '#123456', dialect: 'mysql', host: 'test.invalid', port: 3306, user: 'test' };
const target = { connectionId: profile.id, database: '隔离库', table: '目标', fileToken: '本窗口令牌' };
let engine: Engine, folder: string;
const columns = [{ name: 'id', type: 'bigint unsigned' }, { name: '金额', type: 'decimal(30,12)' }, { name: '正文', type: 'text' }, { name: '字节', type: 'blob' }, { name: '空值', type: 'text' }, { name: '原文', type: 'text' }];

/** 只有驱动及元数据边界使用替身；引擎分派、流式解析、参数转换和事务路径执行生产代码。 */
beforeEach(async () => {
  const base = join(process.cwd(), '.cache/csv-header-engine'); await mkdir(base, { recursive: true }); folder = await mkdtemp(join(base, 'case-'));
  const info: TableInfo = { database: target.database, name: target.table, engine: 'InnoDB', columns: columns.map(column => ({ ...column, nullable: true, generated: false, defaultValue: null, extra: '', comment: '' })), indexes: [], foreignKeys: [], primaryKey: ['id'], editableKey: ['id'], ddl: '' };
  io.tableInfo.mockReset().mockResolvedValue(info);
  io.close.mockReset().mockResolvedValue(undefined);
  io.connect.mockReset().mockImplementation(async () => ({ profile, sqlMode: '', serverStatus: 2, status: { dialect: 'mysql', version: '合成驱动' }, broken: false, close: io.close }));
  io.execute.mockReset().mockResolvedValue({ rows: { affectedRows: 1, warningStatus: 0, serverStatus: 2 }, fields: [] });
  engine = new Engine(() => {}); await engine.handle('connections.open', { id: profile.id, profile });
});

/** 只清理本例新目录中的普通文件，不接触共享输入、旧失败或真实数据库。 */
afterEach(async () => { await engine.closeAll(); for (const name of await readdir(folder)) await rm(join(folder, name)); await rmdir(folder); });

/** 合成原始CSV直接写盘，预期参数不由产品导出器或解析器生成。 */
async function input(content: string) { const filePath = join(folder, 'source.csv'); await writeFile(filePath, content); return { ...target, filePath, format: 'csv', encoding: 'utf8' }; }

describe('无标题CSV正式Engine预览与导入接线', () => {
  it('false从正式入口传到完整流，首行及大数/NULL/字节参数精确保持', async () => {
    const request = { ...await input('18446744073709551615;123456789012345678.123456789012;"中文;双""引号""\r\n第二行";base64:AAH/;\\N;\\\\N\r\n18446744073709551614;0.000000000001;尾行;base64:;尾值;\r\n'), csvDelimiter: ';', csvHasHeader: false };
    const preview = await engine.handle('files.preview', request);
    expect(preview.columns).toEqual(['第1列', '第2列', '第3列', '第4列', '第5列', '第6列']);
    expect(preview.rows[0]).toEqual({ 第1列: '18446744073709551615', 第2列: '123456789012345678.123456789012', 第3列: '中文;双"引号"\r\n第二行', 第4列: 'base64:AAH/', 第5列: null, 第6列: '\\N' });
    expect(io.execute).not.toHaveBeenCalled();
    const mapping = { 第1列: 'id', 第2列: '金额', 第3列: '正文', 第4列: '字节', 第5列: '空值', 第6列: '原文' };
    await expect(engine.handle('files.import', { ...request, mapping, taskId: '实际导入' })).resolves.toEqual({ rows: 2, errors: [] });
    const inserts = io.execute.mock.calls.filter(([, sql]) => sql.startsWith('INSERT'));
    expect(inserts.map(([, , params]) => params)).toEqual([
      ['18446744073709551615', '123456789012345678.123456789012', '中文;双"引号"\r\n第二行', Buffer.from([0, 1, 255]), null, '\\N'],
      ['18446744073709551614', '0.000000000001', '尾行', Buffer.alloc(0), '尾值', ''],
    ]);
    expect(inserts.every(([, sql]) => sql === 'INSERT INTO `隔离库`.`目标` (`id`, `金额`, `正文`, `字节`, `空值`, `原文`) VALUES (?, ?, ?, ?, ?, ?)')).toBe(true);
    expect(io.execute.mock.calls.map(([, sql]) => sql)).toEqual(['START TRANSACTION', inserts[0][1], inserts[1][1], 'COMMIT']);
    expect(io.close).toHaveBeenCalledTimes(2);
  });

  it('二十条预览不裁剪实际导入，未自动补映射且只写显式目标列', async () => {
    const request = { ...await input(Array.from({ length: 22 }, (_, index) => `${index},保留${index}`).join('\n')), csvHasHeader: false };
    expect((await engine.handle('files.preview', request)).rows).toHaveLength(20);
    await expect(engine.handle('files.import', { ...request, mapping: { 第2列: '正文' }, taskId: '超过预览' })).resolves.toEqual({ rows: 22, errors: [] });
    const inserts = io.execute.mock.calls.filter(([, sql]) => sql.startsWith('INSERT'));
    expect(inserts).toHaveLength(22); expect(inserts[0][2]).toEqual(['保留0']); expect(inserts[21][2]).toEqual(['保留21']);
    expect(inserts.every(([, sql]) => sql === 'INSERT INTO `隔离库`.`目标` (`正文`) VALUES (?)')).toBe(true);
  });

  it.each([undefined, true])('旧有标题模式%j继续按字段名映射且只导入数据行', async csvHasHeader => {
    const request = { ...await input('id,正文\n1,原文\n'), ...(csvHasHeader === undefined ? {} : { csvHasHeader }) };
    expect((await engine.handle('files.preview', request)).columns).toEqual(['id', '正文']);
    await expect(engine.handle('files.import', { ...request, mapping: { id: 'id', 正文: '正文' }, taskId: '有标题' })).resolves.toEqual({ rows: 1, errors: [] });
    expect(io.execute.mock.calls.filter(([, sql]) => sql.startsWith('INSERT')).map(([, , params]) => params)).toEqual([['1', '原文']]);
  });

  it('错误标题选项和非CSV夹带在元数据及事务之前拒绝，不执行SQL文件', async () => {
    const request = await input('SELECT 绝不能执行;');
    for (const format of ['json', 'sql', 'xlsx']) for (const csvHasHeader of [false, true]) await expect(engine.handle('files.import', { ...request, format, csvHasHeader, mapping: { 第1列: '正文' }, taskId: format + String(csvHasHeader) })).rejects.toThrow('只适用于 CSV');
    for (const csvHasHeader of [undefined, null, 'false', 0]) await expect(engine.handle('files.import', { ...request, csvHasHeader, mapping: { 第1列: '正文' }, taskId: '非法' + String(csvHasHeader) })).rejects.toThrow('布尔值');
    expect(io.tableInfo).not.toHaveBeenCalled(); expect(io.execute).not.toHaveBeenCalled();
  });
});
