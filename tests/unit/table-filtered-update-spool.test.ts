import { lstat, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import { TableFilteredUpdateSpool, type TableFilteredUpdateSnapshotRow } from '../../src/engine/tableFilteredUpdateSpool';
import { tableFilteredUpdateLimits } from '../../src/shared/tableFilteredUpdate';

const spools: TableFilteredUpdateSpool[] = [], check = () => undefined;
const row = (): TableFilteredUpdateSnapshotRow => ({ values: ['18446744073709551615', '9007199254740993.123456789012', ' O\'Reilly\\\0🚢 ', { type: 'binary', base64: 'AP8=' }, null, -0, Math.fround(0.1)], timestampEpochs: ['1790000000.123456', null] });
async function spool() { const value = await TableFilteredUpdateSpool.create(check); spools.push(value); return value; }
async function all(value: TableFilteredUpdateSpool) { const rows: TableFilteredUpdateSnapshotRow[] = []; for await (const item of value.read(check)) rows.push(item); return rows; }
afterEach(async () => { for (const value of spools.splice(0)) await value.dispose(); });

describe('全部筛选行私有磁盘快照', () => {
  it('独占普通文件、完整typed值和负零往返，读两遍不截断，清理后原目录消失', async () => {
    const value = await spool(); let reserved = 0;
    for (let index = 0; index < 1501; index++) await value.append(row(), check, bytes => { reserved += bytes; });
    await value.seal(check); expect(value.rows).toBe(1501); expect(value.bytes).toBe(reserved); expect((await lstat(value.path)).size).toBe(reserved);
    for (let pass = 0; pass < 2; pass++) { const rows = await all(value); expect(rows).toHaveLength(1501); expect(rows[0]).toEqual(row()); expect(Object.is(rows[0].values[5], -0)).toBe(true); }
    await value.dispose(); await expect(lstat(value.directory)).rejects.toMatchObject({ code: 'ENOENT' });
  }, 30000);
  it('单字段和行预算整份拒绝，不切值伪NULL；全局预留拒绝在任何写盘前发生', async () => {
    const value = await spool(), original = row(); original.values = ['x'.repeat(tableFilteredUpdateLimits.fieldBytes + 1)];
    await expect(value.append(original, check, () => undefined)).rejects.toThrow('8MiB'); expect(value.bytes).toBe(0); expect((await lstat(value.path)).size).toBe(0);
    original.values = Array.from({ length: 3 }, () => 'x'.repeat(6 * 1024 * 1024));
    await expect(value.append(original, check, () => undefined)).rejects.toThrow('16MiB'); expect(value.bytes).toBe(0);
    await expect(value.append(row(), check, () => { throw Error('本例总预算拒绝'); })).rejects.toThrow('总预算'); expect((await lstat(value.path)).size).toBe(0);
  });
  it('同inode改写即使长度一样也拒绝；原文件可以精确清理', async () => {
    const value = await spool(); await value.append(row(), check, () => undefined); await value.seal(check);
    const bytes = await readFile(value.path); bytes[bytes.length - 2] ^= 1; await writeFile(value.path, bytes);
    await expect(all(value)).rejects.toThrow('快照');
  });
  it('路径被换为外来文件时拒读且不误删外来对象，恢复原inode后可精确清理', async () => {
    const value = await spool(); await value.append(row(), check, () => undefined); await value.seal(check);
    const displaced = value.path + '.original'; await rename(value.path, displaced); await writeFile(value.path, '外来内容', { flag: 'wx' });
    try { await expect(all(value)).rejects.toThrow('快照'); await expect(value.dispose()).rejects.toThrow('快照'); expect(await readFile(value.path, 'utf8')).toBe('外来内容'); }
    finally { await rm(value.path); await rename(displaced, value.path); }
  });
  it('部分迭代退出也关闭原handle；实际取消不允许seal和继续读取', async () => {
    const value = await spool(); await value.append(row(), check, () => undefined); await value.seal(check);
    for await (const item of value.read(check)) { expect(item).toEqual(row()); break; }
    // 迭代return应已结算真实close；最终dispose仍核查所有保留文件柄。
    expect((Object.getOwnPropertyDescriptor(value, 'readers')?.value as Set<unknown>).size).toBe(0);
    await value.dispose();
    const pending = await spool(); await pending.append(row(), check, () => undefined);
    await expect(pending.seal(() => { throw Error('本例取消'); })).rejects.toThrow('本例取消');
    const handle = await open(pending.path, 'r'); await handle.close();
  });
});
