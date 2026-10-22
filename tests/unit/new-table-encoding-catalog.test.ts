import { describe, expect, it, vi } from 'vitest';
import { NewTableEncodingDirectoryReader, readNewTableEncodingCatalog } from '../../src/renderer/newTableEncodingCatalog';
import type { TableCreateServices } from '../../src/renderer/tableCreateServices';
import type { TableCreateGetOutput } from '../../src/shared/tableCreate';

const catalog = () => ({ digest: 'a'.repeat(64), candidates: [{ charset: 'utf8mb4', collation: 'utf8mb4_bin' }, { charset: 'latin1', collation: 'latin1_bin' }], warnings: [], reasons: [] });
const snapshot = (): TableCreateGetOutput => ({ target: { connectionId: 'c', database: 'db' }, snapshotId: 's', expiresAt: new Date(Date.now() + 120000).toISOString(), serverVersion: '8.4.11', warnings: [], encodings: catalog() });
/** 仅控制RAM承诺，不启动数据库或桌面。 */
function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function port() { return { get: vi.fn(async () => snapshot()), release: vi.fn(async () => {}), cancel: vi.fn(async () => {}), preview: vi.fn(), apply: vi.fn(), subscribe: () => () => {} } satisfies TableCreateServices; }

describe('新表字段编码真实目录的原始数据门（仅RAM）', () => {
  it('保留长Maria真实别名并复制冻结，不收窄为64字符或猜前缀', () => { const value = catalog(); value.candidates.push({ charset: 'utf8mb4', collation: 'uca_' + 'a'.repeat(120) }); const parsed = readNewTableEncodingCatalog(value); value.candidates[0].collation = 'changed'; expect(parsed.candidates[0].collation).toBe('utf8mb4_bin'); expect(parsed.candidates[2].collation).toHaveLength(124); expect(Object.isFrozen(parsed.candidates)).toBe(true); });
  it.each(['getter', 'candidate-getter', 'sparse', 'extra', 'duplicate', 'count', 'pair', 'warning', 'digest', 'reasons'] as const)('%s不得作为可用候选，getter不执行', kind => {
    const value: any = catalog(), getter = vi.fn(() => 'utf8mb4');
    if (kind === 'getter') Object.defineProperty(value, 'digest', { enumerable: true, get: getter });
    if (kind === 'candidate-getter') Object.defineProperty(value.candidates[0], 'charset', { enumerable: true, get: getter });
    if (kind === 'sparse') delete value.candidates[0]; if (kind === 'extra') value.candidates[0].sql = 'not allowed';
    if (kind === 'duplicate') value.candidates.push(value.candidates[0]); if (kind === 'count') value.candidates = Array.from({ length: 8193 }, () => ({ charset: 'utf8mb4', collation: 'x' }));
    if (kind === 'pair') value.candidates[0].charset = 'utf8mb4;'; if (kind === 'warning') value.warnings = ['x'.repeat(4097)]; if (kind === 'digest') value.digest = 'a'.repeat(63); if (kind === 'reasons') value.reasons = ['目录读取未证明'];
    expect(() => readNewTableEncodingCatalog(value)).toThrow(); expect(getter).not.toHaveBeenCalled();
  });
});

describe('候选get必须准确释放原可写快照（仅RAM）', () => {
  it('释放承诺未完成不发布；取消ACK仍保留busy且最终不发布', async () => {
    const service = port(), release = deferred<void>(); service.release.mockReturnValueOnce(release.promise); const reader = new NewTableEncodingDirectoryReader(service), publish = vi.fn();
    const request = reader.read({ connectionId: 'c', database: 'db', taskId: 'get' }, () => true, publish); await vi.waitFor(() => expect(service.release).toHaveBeenCalledWith({ snapshotId: 's' })); expect(reader.busy).toBe(true); expect(publish).not.toHaveBeenCalled();
    await reader.cancel(); expect(service.cancel).toHaveBeenCalledWith('get'); expect(reader.busy).toBe(true); release.resolve(); await request; expect(publish).not.toHaveBeenCalled(); expect(reader.busy).toBe(false);
  });
  it('释放失败不自动重试、不发布，显式收尾才可重试同一快照', async () => {
    const service = port(); service.release.mockRejectedValueOnce(Error('原释放失败')); const reader = new NewTableEncodingDirectoryReader(service), publish = vi.fn();
    await expect(reader.read({ connectionId: 'c', database: 'db', taskId: 'get' }, () => true, publish)).rejects.toThrow('原释放失败'); expect(service.release).toHaveBeenCalledTimes(1); expect(publish).not.toHaveBeenCalled(); await reader.releaseAll(); expect(service.release).toHaveBeenCalledTimes(2);
  });
  it('失效get迟到只精准释放原id；快照对象在释放期间改写不更换id或延长期限', async () => {
    const service = port(), pending = deferred<TableCreateGetOutput>(), release = deferred<void>(); service.get.mockReturnValueOnce(pending.promise); service.release.mockReturnValueOnce(release.promise);
    const reader = new NewTableEncodingDirectoryReader(service), publish = vi.fn(), value = snapshot(); let current = true;
    const request = reader.read({ connectionId: 'c', database: 'db', taskId: 'get' }, () => current, publish); await vi.waitFor(() => expect(service.get).toHaveBeenCalledOnce()); current = false; pending.resolve(value); await vi.waitFor(() => expect(service.release).toHaveBeenCalledWith({ snapshotId: 's' })); value.snapshotId = 'another'; value.expiresAt = '2099-01-01T00:00:00.000Z'; release.resolve(); await request; expect(service.release).toHaveBeenCalledTimes(1); expect(publish).not.toHaveBeenCalled();
  });
  it('原租约仍true也不得用释放期间改写的expiry复活原已过期目录', async () => {
    let instant = 1000; const now = vi.spyOn(Date, 'now').mockImplementation(() => instant);
    try {
      const service = port(), release = deferred<void>(), value = { ...snapshot(), expiresAt: new Date(1100).toISOString() };
      service.get.mockResolvedValueOnce(value); service.release.mockReturnValueOnce(release.promise);
      const reader = new NewTableEncodingDirectoryReader(service), publish = vi.fn(), request = reader.read({ connectionId: 'c', database: 'db', taskId: 'get' }, () => true, publish);
      await vi.waitFor(() => expect(service.release).toHaveBeenCalledWith({ snapshotId: 's' })); value.snapshotId = 'replacement'; value.expiresAt = '2099-01-01T00:00:00.000Z'; instant = 1101; release.resolve(); await request;
      expect(service.release).toHaveBeenCalledTimes(1); expect(publish).not.toHaveBeenCalled(); expect(reader.busy).toBe(false);
    } finally { now.mockRestore(); }
  });
  it('双击只发一次get，卸载之后迟到回包不复活目录', async () => {
    const service = port(), pending = deferred<TableCreateGetOutput>(); service.get.mockReturnValueOnce(pending.promise); const reader = new NewTableEncodingDirectoryReader(service), publish = vi.fn();
    const first = reader.read({ connectionId: 'c', database: 'db', taskId: 'first' }, () => true, publish), second = reader.read({ connectionId: 'c', database: 'db', taskId: 'second' }, () => true, publish); expect(second).toBe(first); await vi.waitFor(() => expect(service.get).toHaveBeenCalledOnce()); await reader.dispose(); pending.resolve(snapshot()); await first; expect(service.release).toHaveBeenCalledWith({ snapshotId: 's' }); expect(publish).not.toHaveBeenCalled();
  });
});
