import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { writeSavedQueryArchive } from '../../src/main/savedQueryArchive';
import { validateCommand } from '../../src/shared/validation';
import { savedQueryArchiveLimits } from '../../src/shared/savedQuerySearch';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const refs = ['甲', '乙'].map(id => ({ id, digest: 'a'.repeat(64) }));
const sql = ["-- 😀\r\nDELIMITER $$\nSELECT 9007199254740993$$", 'SELECT 2;\r\n'];
const record = (id: string, index: number, name = '../COM1\uD800.SQL') => ({ id, sql: sql[index], name, updatedAt: '2026-11-03' });

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dbark-query-archive-'));
  roots.push(root);
  const target = join(root, '查询.zip');
  return { root, target };
}

describe('保存查询批量 ZIP', () => {
  it('严格 IPC 拒绝重复、路径、SQL、额外参数和超量', () => {
    const parse = (value: unknown) => validateCommand('queries.exportSqlArchive', value);
    expect(parse({ items: refs })).toEqual({ items: refs });
    for (const value of [{ items: [] }, { items: [refs[0], refs[0]] }, { items: [{ ...refs[0], sql: 'SELECT 1' }] }, { items: refs, path: '输入路径' }, { items: Array.from({ length: savedQueryArchiveLimits.files + 1 }, (_, index) => ({ ...refs[0], id: `${index}` })) }]) {
      expect(() => parse(value)).toThrow();
    }
  });

  it('同名和路径段字符生成可移植的独立文件，逐字节保留 SQL', async () => {
    const { target } = await fixture();
    await writeSavedQueryArchive(target, refs, item => record(item.id, refs.indexOf(item)), () => {});
    const zip = await JSZip.loadAsync(await readFile(target), { checkCRC32: true });
    expect(Object.keys(zip.files)).toEqual(['001-_COM1_.sql', '002-_COM1_.sql']);
    for (const [index, entry] of Object.values(zip.files).entries()) expect(await entry.async('nodebuffer')).toEqual(Buffer.from(sql[index]));
  });

  it('后一个记录过期、正文不可编码或超预算时保留原文件且无临时文件', async () => {
    const { root, target } = await fixture();
    await writeFile(target, '原文件');
    const exportWith = (read: Parameters<typeof writeSavedQueryArchive>[2]) => writeSavedQueryArchive(target, refs, read, () => {});
    await expect(exportWith(item => { if (item === refs[1]) throw Error('已修改'); return record(item.id, 0); })).rejects.toThrow('已修改');
    await expect(exportWith(item => ({ ...record(item.id, 0), sql: item === refs[0] ? sql[0] : '\0' }))).rejects.toThrow('NUL');
    const bigSql = 'x'.repeat(17 * 1024 * 1024);
    await expect(exportWith(item => ({ ...record(item.id, 0), sql: bigSql }))).rejects.toThrow('32 MiB');
    expect(await readFile(target, 'utf8')).toBe('原文件');
    expect(await readdir(root)).toEqual(['查询.zip']);
  });

  it('暂存写入时归属失效，拒绝替换目标并清理暂存', async () => {
    const { root, target } = await fixture();
    await writeFile(target, '原文件');
    const check = vi.fn(() => { if (check.mock.calls.length === 5) throw Error('原文档失效'); });
    await expect(writeSavedQueryArchive(target, refs, item => record(item.id, 0), check)).rejects.toThrow('原文档失效');
    expect(await readFile(target, 'utf8')).toBe('原文件');
    expect(await readdir(root)).toEqual(['查询.zip']);
  });
});
