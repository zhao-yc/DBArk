import { describe, expect, it, vi } from 'vitest';
import { mainColumnsHarness, deferred } from './main-columns-owner-harness';
import { TableFilteredExportOwners } from '../../src/main/tableFilteredExportOwners';
import { tableFilteredExportText } from '../../src/shared/tableFilteredExport';
import { resolveFileToken } from '../../src/main/fileTokens';
import { persistedTaskMessage } from '../../src/main/taskPrivacy';
import { validateCommand } from '../../src/shared/validation';
import { publicCommands } from '../../src/shared/commands';
import { sqliteTableExportMessages } from '../../src/shared/sqliteTableExport';

const profile = { id: 'sqlite-file', name: '测试文件', dialect: 'sqlite', sqlite: { filePath: 'fixture.sqlite', readOnly: true, busyTimeoutMs: 0 } };
const input = { connectionId: profile.id, database: 'main', table: 'subject', taskId: 'export-all', fileToken: 'chosen', schemaKey: 'a'.repeat(64), mode: 'and', filters: [], sort: [], columns: ['b', 'a'], format: 'csv', encoding: 'utf8' };
/** 串行等待测试自己控制的原请求，不以取消ACK或固定超时冒充任务终态。 */
async function flush() { for (let index = 0; index < 20; index++) await Promise.resolve(); }
/** 原Main IPC、owner及文件token实走，仅替换数据库进程、路径IO与目标占用的操作系统边界。 */
function fixture() {
  const f = mainColumnsHarness(), release = vi.fn(), reserve = vi.fn(async (_path: string): Promise<() => void> => release), destination = vi.fn(async () => {}), saveTask = vi.fn();
  Object.assign(f.context.store, { connections: () => [profile], saveTask, addHistory: () => { throw Error('表导出不能进入SQL历史'); }, resolveConnection: () => { throw Error('不能读取网络凭据'); } });
  Object.assign(f.context, { tableFilteredExportText, sqliteTableExportMessages, resolveFileToken, assertSqliteExportDestination: destination, exportReservations: { acquire: reserve }, tableValueOptionsConnectionOwners: new Map(), tableValueOptionsClosing: new Map() });
  const owners = new TableFilteredExportOwners({ assert: owner => f.capabilities.assertCapturedOwner(owner), same: (left, right) => f.capabilities.sharesDocumentOwner(left, right), stop: async taskId => { const preparing = f.context.preparingTasks.get(taskId); if (preparing) { preparing.cancelled = true; return; } await f.request('query.cancel', { taskId }); } });
  f.context.tableFilteredExports = owners;
  f.context.files.set('chosen', { purpose: 'export', format: 'csv', path: 'selected.csv' });
  f.request.mockResolvedValue({ rows: 1200034, fileCommitted: true });
  return { ...f, release, reserve, destination, owners, saveTask };
}
describe('SQLite全部筛选行导出严格合同', () => {
  it.each(['csv', 'json', 'sql', 'xlsx'])('%s公开typed条件和有序列名，拒绝SQL、路径、凭据和私有回调', format => {
    const value = { ...input, format };
    expect(publicCommands['sqlite.tableExport']).toBe(true); expect(validateCommand('sqlite.tableExport', value)).toEqual(value);
    for (const patch of [{ sql: 'SELECT * FROM subject' }, { filePath: '任意路径' }, { profile }, { assertCurrent: () => {} }, { validateDestination: () => {} }, { database: 'other' }, { schemaKey: 'not-a-digest' }, { columns: [] }, { columns: ['a', 'a'] }, { columns: ['\ud800'] }, { sort: [{ column: 'a', direction: 'asc' }, { column: 'a', direction: 'desc' }] }, { filters: Array(33).fill({ column: 'a', operator: 'isNull' }) }]) expect(() => validateCommand('sqlite.tableExport', { ...value, ...patch })).toThrow();
    if (format !== 'csv') expect(() => validateCommand('sqlite.tableExport', { ...value, csvDelimiter: ',' })).toThrow();
    if (format === 'xlsx') expect(() => validateCommand('sqlite.tableExport', { ...value, encoding: 'gb18030' })).toThrow();
  });
  it('持久任务摘要不记录筛选值、路径或驱动原始错误', () => {
    for (const status of ['running', 'completed', 'cancelled', 'failed'] as const) {
      const message = persistedTaskMessage('sqlite.tableExport', { taskId: 't', status, progress: 0, message: '私有值9007199254740993 C:\\private\\source.sqlite' });
      expect(message).toContain('SQLite'); expect(message).not.toContain('9007199254740993'); expect(message).not.toContain('private');
    }
  });
});
describe('SQLite完整导出Main来源与文件能力', () => {
  it('只投递已存SQLite身份及Main解析的目标，复用真实owner和reservation，不读取网络凭据或SQL历史', async () => {
    const f = fixture();
    f.request.mockImplementation(async (command, value) => {
      expect(command).toBe('sqlite.tableExport'); expect(value.filePath).toBe('selected.csv'); expect(value).not.toHaveProperty('profile');
      expect(value.columns).toEqual(['b', 'a']); value.assertCurrent(); await value.validateDestination();
      return { rows: 1200034, fileCommitted: true };
    });
    await expect(f.run('sqlite.tableExport', input)).resolves.toEqual({ rows: 1200034, fileCommitted: true });
    expect(f.destination).toHaveBeenCalledWith('selected.csv', [profile]); expect(f.reserve).toHaveBeenCalledWith('selected.csv'); expect(f.release).toHaveBeenCalledOnce();
    expect(f.tasks.get(input.taskId)).toMatchObject({ kind: 'sqlite.tableExport', status: 'completed' }); expect(f.owners.has(input.taskId)).toBe(false); expect(f.context.preparingTasks.size).toBe(0);
  });
  it('无连接、错误方言、关闭中或错用途文件token都在投递前拒绝', async () => {
    for (const mode of ['missing', 'network', 'shutdown', 'wrong-purpose', 'wrong-format']) {
      const f = fixture(); f.context.store.connections = () => mode === 'missing' ? [] : [{ ...profile, dialect: mode === 'network' ? 'mysql' : 'sqlite' }]; f.context.shuttingDown = mode === 'shutdown';
      if (mode.startsWith('wrong')) f.context.files.set('chosen', { purpose: mode === 'wrong-purpose' ? 'import' : 'export', format: mode === 'wrong-format' ? 'json' : 'csv', path: 'wrong' });
      await expect(f.run('sqlite.tableExport', input)).rejects.toThrow(); expect(f.request).not.toHaveBeenCalled(); expect(f.reserve).not.toHaveBeenCalled();
    }
  });
  it('目标预留等待期间原文档换代或用户取消均零投递，仍等原预留终结才释放', async () => {
    for (const mode of ['navigate', 'cancel']) {
      const f = fixture(), reservation = deferred<() => void>(); f.reserve.mockImplementation(() => reservation.promise);
      const work = f.run('sqlite.tableExport', input), rejected = expect(work).rejects.toThrow(); await flush();
      if (mode === 'navigate') f.context.window.webContents.emit('did-navigate'); else await f.run('query.cancel', { taskId: input.taskId });
      expect(f.request).not.toHaveBeenCalled(); expect(f.release).not.toHaveBeenCalled(); reservation.resolve(f.release); await rejected;
      expect(f.request).not.toHaveBeenCalled(); expect(f.release).toHaveBeenCalledOnce(); expect(f.owners.has(input.taskId)).toBe(false);
    }
  });
  it('投递后修订变化由私有同步guard拒绝，已提交文件事实仍不被晚失效改写', async () => {
    const f = fixture(), response = deferred(); let sent: any;
    f.request.mockImplementation(async (command, value) => { if (command === 'query.cancel') return; sent = value; return response.promise; });
    const work = f.run('sqlite.tableExport', input); await flush(); expect(sent).toBeTruthy();
    f.setRevision(8); expect(() => sent.assertCurrent()).toThrow(); f.owners.observe(); await flush();
    expect(f.request.mock.calls.filter(([command]) => command === 'query.cancel')).toEqual([['query.cancel', { taskId: input.taskId }]]);
    response.resolve({ rows: 1200034, fileCommitted: true }); await expect(work).resolves.toEqual({ rows: 1200034, fileCommitted: true });
    expect(f.release).toHaveBeenCalledOnce();
  });
  it('取消ACK先于原导出失败不释放目标，不误称文件已提交或重放', async () => {
    const f = fixture(), response = deferred();
    f.request.mockImplementation(async command => command === 'query.cancel' ? undefined : response.promise);
    const work = f.run('sqlite.tableExport', input), rejected = expect(work).rejects.toThrow('原driver退出未确认'); await flush(); await f.run('query.cancel', { taskId: input.taskId });
    expect(f.release).not.toHaveBeenCalled(); response.reject(Error('原driver退出未确认')); await rejected;
    expect(f.release).toHaveBeenCalledOnce(); expect(f.request).toHaveBeenCalledTimes(2); expect(f.tasks.get(input.taskId)?.status).not.toBe('completed');
  });
  it('文件清理未知保留跨入口目标占用，直到原资源恢复成功；恢复拒绝不释放', async () => {
    for (const mode of ['recover', 'reject']) {
      const f = fixture(), recovered = deferred<void>();
      f.request.mockImplementation(async (_command, value) => { value.retainDestinationUntil(recovered.promise); throw Error('原文件资源清理未确认'); });
      await expect(f.run('sqlite.tableExport', input)).rejects.toThrow('清理未确认'); expect(f.release).not.toHaveBeenCalled();
      if (mode === 'recover') recovered.resolve(); else recovered.reject(Error('原资源仍未确认')); await flush();
      expect(f.release).toHaveBeenCalledTimes(mode === 'recover' ? 1 : 0);
    }
  });
});
