import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { ExplainSnapshotFiles, type ExplainSnapshotFilePorts } from '../../src/main/explainSnapshotFiles';
import { capturePlanSnapshot, encodePlanSnapshot, explainSnapshotLimits, type PlanSnapshotDocument } from '../../src/shared/explainSnapshot';
import { parseQueryAnalyzePlan } from '../../src/shared/queryAnalyze';
import { explainSnapshotZh as text } from '../../src/shared/explainSnapshot.zh-CN';

const directories: string[] = [], owner = { assertCurrent() {} };
const mysqlRaw = '-> Table scan on subject  (cost=12.34567890123456789 rows=9007199254740993) (actual time=0.000000000000000123..1.234567890123456789 rows=9007199254740993 loops=2)\n';
const mariaRaw = '{"query_block":{"select_id":1,"r_total_time_ms":1.234567890123456789,"nested_loop":[{"table":{"table_name":"subject","rows":9007199254740993,"r_rows":9007199254740993,"r_loops":2,"r_table_time_ms":0.000000000000000123}}]}}';

/** 通过正式捕获器剥离原SQL、事务、耗时与派生节点，再把实际计划交给真实文件服务。 */
function snapshot(dialect: 'mysql' | 'mariadb' = 'mysql'): PlanSnapshotDocument {
  const raw = dialect === 'mysql' ? mysqlRaw : mariaRaw;
  const analysis = parseQueryAnalyzePlan(raw, dialect, dialect === 'mysql' ? '8.4.11' : '11.4.13', dialect === 'mysql' ? 'tree' : 'json');
  if (analysis.nodes[0]) analysis.nodes[0].label = '派生节点_不得落盘';
  return capturePlanSnapshot({
    analysis, transactionOpen: true, elapsedMs: 456789,
    results: [{ columns: [{ key: 'PLAN', name: 'ANALYZE', type: 'LONGTEXT' }], rows: [{ PLAN: raw }], truncated: false, statement: 'SELECT 用户SQL_不得落盘 FROM subject', elapsedMs: 987654 }],
  });
}

/** 每例独占真实临时目录；递归清理前核绝对位置及本测试专属前缀。 */
async function directory(): Promise<string> {
  const path = await fs.mkdtemp(join(tmpdir(), 'dbark-analyze-plan-files-')); directories.push(path); return path;
}
afterEach(async () => {
  for (const path of directories.splice(0)) {
    if (!isAbsolute(path) || dirname(resolve(path)) !== resolve(tmpdir()) || !basename(path).startsWith('dbark-analyze-plan-files-')) throw Error('拒绝清理本测试随机目录以外的路径');
    await fs.rm(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

/** 门只暂停指定原操作；不替换原文件字节、读写和正常清理。 */
function deferred<T>() {
  let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve };
}
/** 故障只注入所列原句柄方法，其余方法继续绑定真实句柄。 */
function wrap(handle: FileHandle, overrides: Record<string, unknown>): FileHandle {
  return new Proxy(handle, { get(target, key) {
    if (typeof key === 'string' && Object.hasOwn(overrides, key)) return overrides[key];
    const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
  } });
}
/** 原生选择和占用通过端口提供；默认IO始终是本例真实文件系统。 */
function ports(path?: string, io: Partial<NonNullable<ExplainSnapshotFilePorts['io']>> = {}) {
  const released = vi.fn(); return { choose: vi.fn(async () => path), reserve: vi.fn(async () => released), io: { ...fs, ...io }, released };
}

describe('实际计划经原主进程文件链路保存与离线重开', () => {
  it.each(['mysql', 'mariadb'] as const)('%s真实文件往返保留原文精度，独立JSON读回不含SQL、耗时或派生树', async dialect => {
    const dir = await directory(), path = join(dir, '实际计划.dbark-plan.json'), choice = deferred<string | undefined>();
    await fs.writeFile(path, '旧文件');
    const original = snapshot(dialect), frozen = JSON.parse(encodePlanSnapshot(original));
    const dependency = ports(path); dependency.choose.mockImplementationOnce(() => choice.promise);
    const files = new ExplainSnapshotFiles(dependency), saving = files.save(original, owner);
    expect(dependency.choose).toHaveBeenCalledWith('save');
    original.raw = '选择器等待时的后继内容'; original.result.rows[0].PLAN = original.raw; original.warnings.push('后继警告');
    choice.resolve(path); await expect(saving).resolves.toEqual({ name: basename(path) });
    const bytes = await fs.readFile(path), independentlyRead = JSON.parse(bytes.toString('utf8'));
    expect(independentlyRead).toEqual(frozen); expect(independentlyRead.kind).toBe('dbark.analyze-snapshot');
    expect(Object.keys(independentlyRead).sort()).toEqual(['kind', 'version', 'dialect', 'serverVersion', 'format', 'raw', 'rawTruncated', 'warnings', 'result'].sort());
    expect(Object.keys(independentlyRead.result).sort()).toEqual(['columns', 'rows', 'truncated']);
    expect(independentlyRead.raw).toBe(dialect === 'mysql' ? mysqlRaw : mariaRaw);
    expect(independentlyRead.result.rows[0].PLAN).toBe(independentlyRead.raw);
    for (const forbidden of ['用户SQL_不得落盘', '派生节点_不得落盘', 'elapsedMs', 'statement', 'transactionOpen', 'nodes', '后继警告']) expect(bytes.includes(Buffer.from(forbidden))).toBe(false);
    await expect(files.open(owner)).resolves.toEqual({ name: basename(path), snapshot: frozen });
    expect(dependency.reserve).toHaveBeenCalledExactlyOnceWith(path); expect(dependency.released).toHaveBeenCalledTimes(1);
    expect(await fs.readdir(dir)).toEqual([basename(path)]);
  });

  it.each(['open', 'save'] as const)('%s取消不触碰文件或占用', async mode => {
    const open = vi.fn(fs.open), dependency = ports(undefined, { open }), files = new ExplainSnapshotFiles(dependency);
    await expect(mode === 'open' ? files.open(owner) : files.save(snapshot(), owner)).resolves.toBeNull();
    expect(dependency.choose).toHaveBeenCalledExactlyOnceWith(mode); expect(open).not.toHaveBeenCalled(); expect(dependency.reserve).not.toHaveBeenCalled();
  });

  it.each(['kind', 'version', 'format', 'extra-sql'] as const)('不支持的实际计划%s在保存选择器前及真实文件读取时均拒绝', async change => {
    const dir = await directory(), path = join(dir, '坏计划.dbark-plan.json'), value = snapshot();
    const invalid = change === 'kind' ? { ...value, kind: 'dbark.unknown-snapshot' } : change === 'version' ? { ...value, version: 2 } : change === 'format' ? { ...value, format: 'text' } : { ...value, statement: 'DELETE FROM 不应执行' };
    const dependency = ports(path), files = new ExplainSnapshotFiles(dependency);
    await expect(files.save(invalid as PlanSnapshotDocument, owner)).rejects.toThrow(text.invalid); expect(dependency.choose).not.toHaveBeenCalled();
    await fs.writeFile(path, JSON.stringify(invalid));
    await expect(files.open(owner)).rejects.toThrow(text.invalid); expect(dependency.reserve).not.toHaveBeenCalled();
    expect(await fs.readdir(dir)).toEqual([basename(path)]);
  });

  it.each(['utf8', 'file-budget'] as const)('真实文件%s失败关闭原句柄，不放宽UTF8或读取预算', async kind => {
    const path = join(await directory(), '输入.dbark-plan.json');
    await fs.writeFile(path, kind === 'utf8' ? Buffer.from([0xc3, 0x28]) : Buffer.alloc(explainSnapshotLimits.bytes + 1));
    let closes = 0;
    const dependency = ports(path, { open: (async (...args: Parameters<typeof fs.open>) => {
      const handle = await fs.open(...args); return wrap(handle, { close: async () => { closes++; await handle.close(); } });
    }) as typeof fs.open });
    await expect(new ExplainSnapshotFiles(dependency).open(owner)).rejects.toThrow(kind === 'utf8' ? 'UTF-8' : text.tooLarge);
    expect(closes).toBe(1); expect(dependency.reserve).not.toHaveBeenCalled();
  });

  it('实际原文超过单格预算时在选择器之前拒绝，不碰原文件', async () => {
    const path = join(await directory(), '保留.dbark-plan.json'); await fs.writeFile(path, '原文件');
    const value = snapshot(), raw = 'x'.repeat(explainSnapshotLimits.raw + 1); value.raw = raw; value.result.rows[0].PLAN = raw;
    const dependency = ports(path), files = new ExplainSnapshotFiles(dependency);
    await expect(files.save(value, owner)).rejects.toThrow(text.tooLarge);
    expect(dependency.choose).not.toHaveBeenCalled(); expect(dependency.reserve).not.toHaveBeenCalled(); expect(await fs.readFile(path, 'utf8')).toBe('原文件');
  });

  it('选择后真实路径被替换，拒绝发布新文件并关闭唯一原句柄', async () => {
    const dir = await directory(), path = join(dir, '输入.dbark-plan.json'), old = join(dir, '原输入.dbark-plan.json'), replacement = join(dir, '后继.dbark-plan.json');
    const before = encodePlanSnapshot(snapshot()), after = encodePlanSnapshot(snapshot('mariadb'));
    await fs.writeFile(path, before); await fs.writeFile(replacement, after); let closes = 0;
    const dependency = ports(path, { open: (async (...args: Parameters<typeof fs.open>) => {
      await fs.rename(path, old); await fs.rename(replacement, path);
      const handle = await fs.open(...args); return wrap(handle, { close: async () => { closes++; await handle.close(); } });
    }) as typeof fs.open });
    await expect(new ExplainSnapshotFiles(dependency).open(owner)).rejects.toThrow('变化');
    expect(closes).toBe(1); expect(await fs.readFile(old, 'utf8')).toBe(before); expect(await fs.readFile(path, 'utf8')).toBe(after);
    expect(dependency.reserve).not.toHaveBeenCalled();
  });

  it('同步等待期间原owner失效仍保持单操作锁，收尾后保留旧文件并精确释放', async () => {
    const dir = await directory(), path = join(dir, '输出.dbark-plan.json'), entered = deferred<void>(), finish = deferred<void>();
    await fs.writeFile(path, '原文件'); let current = true, closes = 0;
    const dependency = ports(path, { open: (async (...args: Parameters<typeof fs.open>) => {
      const handle = await fs.open(...args); return wrap(handle, {
        sync: async () => { entered.resolve(); await finish.promise; await handle.sync(); },
        close: async () => { closes++; await handle.close(); },
      });
    }) as typeof fs.open });
    const files = new ExplainSnapshotFiles(dependency), pending = files.save(snapshot(), { assertCurrent() { if (!current) throw Error(text.stale); } });
    const rejection = expect(pending).rejects.toThrow(text.stale); await entered.promise; current = false;
    await expect(files.save(snapshot(), owner)).rejects.toThrow(text.busy); expect(dependency.released).not.toHaveBeenCalled();
    finish.resolve(); await rejection;
    expect(closes).toBe(1); expect(dependency.released).toHaveBeenCalledTimes(1);
    expect(await fs.readFile(path, 'utf8')).toBe('原文件'); expect(await fs.readdir(dir)).toEqual([basename(path)]);
  });

  it.each(['sync', 'rename'] as const)('%s故障保留旧文件、关闭真实句柄、清除临时文件并释放占用', async phase => {
    const dir = await directory(), path = join(dir, '输出.dbark-plan.json'); await fs.writeFile(path, '原文件'); let closes = 0;
    const dependency = ports(path, {
      open: (async (...args: Parameters<typeof fs.open>) => {
        const handle = await fs.open(...args); return wrap(handle, {
          sync: phase === 'sync' ? async () => { throw Error('合成同步失败'); } : handle.sync.bind(handle),
          close: async () => { closes++; await handle.close(); },
        });
      }) as typeof fs.open,
      rename: phase === 'rename' ? async () => { throw Error('合成重命名失败'); } : fs.rename,
    });
    await expect(new ExplainSnapshotFiles(dependency).save(snapshot(), owner)).rejects.toThrow(phase === 'rename' ? text.unknownWrite : '合成同步失败');
    expect(await fs.readFile(path, 'utf8')).toBe('原文件'); expect(await fs.readdir(dir)).toEqual([basename(path)]);
    expect(closes).toBe(1); expect(dependency.released).toHaveBeenCalledTimes(1);
  });

  it('真实rename已完成后owner失效仍报告未知写入，不撤销或重写实际文件', async () => {
    const dir = await directory(), path = join(dir, '输出.dbark-plan.json'), value = snapshot('mariadb');
    await fs.writeFile(path, '原文件'); let current = true;
    const dependency = ports(path, { rename: async (...args) => { await fs.rename(...args); current = false; } });
    await expect(new ExplainSnapshotFiles(dependency).save(value, { assertCurrent() { if (!current) throw Error(text.stale); } })).rejects.toThrow(text.unknownWrite);
    expect(JSON.parse(await fs.readFile(path, 'utf8'))).toEqual(JSON.parse(encodePlanSnapshot(value)));
    expect(await fs.readdir(dir)).toEqual([basename(path)]); expect(dependency.released).toHaveBeenCalledTimes(1);
  });

  it('临时文件清理失败保持原操作直到收尾，聚合原错误并明确保留残留', async () => {
    const dir = await directory(), path = join(dir, '输出.dbark-plan.json'), entered = deferred<void>(), finish = deferred<void>();
    await fs.writeFile(path, '原文件'); const syncFailure = Error('合成同步失败'), unlinkFailure = Error('合成清理失败');
    const dependency = ports(path, {
      open: (async (...args: Parameters<typeof fs.open>) => { const handle = await fs.open(...args); return wrap(handle, { sync: async () => { throw syncFailure; } }); }) as typeof fs.open,
      unlink: async () => { entered.resolve(); await finish.promise; throw unlinkFailure; },
    });
    const files = new ExplainSnapshotFiles(dependency), pending = files.save(snapshot(), owner), observed = pending.catch(error => error);
    await entered.promise; await expect(files.open(owner)).rejects.toThrow(text.busy); expect(dependency.released).not.toHaveBeenCalled();
    finish.resolve(); const failure = await observed;
    expect(failure).toBeInstanceOf(AggregateError); expect(failure.errors).toEqual([syncFailure, unlinkFailure]);
    expect(await fs.readFile(path, 'utf8')).toBe('原文件'); expect((await fs.readdir(dir)).filter(name => name.endsWith('.tmp'))).toHaveLength(1);
    expect(dependency.released).toHaveBeenCalledTimes(1);
  });

  it('真实硬链接目标经原子替换后不修改另一个名称下的原文件', async () => {
    const dir = await directory(), original = join(dir, '原文件.dbark-plan.json'), path = join(dir, '所选别名.dbark-plan.json');
    await fs.writeFile(original, '另一名称必须保留的原字节'); await fs.link(original, path);
    const value = snapshot(), dependency = ports(path); await new ExplainSnapshotFiles(dependency).save(value, owner);
    expect(await fs.readFile(original, 'utf8')).toBe('另一名称必须保留的原字节');
    expect(await fs.readFile(path, 'utf8')).toBe(encodePlanSnapshot(value)); expect(dependency.released).toHaveBeenCalledTimes(1);
    expect((await fs.readdir(dir)).sort()).toEqual([basename(original), basename(path)].sort());
  });
});
