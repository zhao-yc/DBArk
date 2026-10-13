import { mkdtemp, readFile, readdir, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeQueryFile, encodeQueryFile, queryFileLimit, readQueryFile, writeQueryFile } from '../../src/main/queryFiles';

describe('SQL 文件编码与安全写入', () => {
  const source = "-- 中文精度\r\nSELECT '9223372036854775807', '12.00000000000000000001', '🚢';\r\n";
  it.each(['utf8', 'utf16le', 'gb18030'] as const)('保留 %s 的中文、换行、大数文本和 Unicode', encoding => {
    expect(decodeQueryFile(encodeQueryFile(source, encoding), encoding).sql).toBe(source);
  });
  it('UTF-8/UTF-16LE 的 BOM 优先于界面指定编码，正文不带 BOM', () => {
    expect(decodeQueryFile(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), encodeQueryFile(source, 'utf8')]), 'gb18030')).toEqual({ sql: source, encoding: 'utf8' });
    expect(decodeQueryFile(encodeQueryFile(source, 'utf16le'), 'utf8')).toEqual({ sql: source, encoding: 'utf16le' });
  });
  it('拒绝非法 UTF、UTF-16BE 和选错编码导致的 NUL', () => {
    expect(() => decodeQueryFile(Buffer.from([0xff]), 'utf8')).toThrow('无效编码');
    expect(() => decodeQueryFile(Buffer.from([0x61]), 'utf16le')).toThrow('无效编码');
    expect(() => decodeQueryFile(Buffer.from([0xfe, 0xff, 0, 0x61]), 'utf8')).toThrow('UTF-16BE');
    expect(() => decodeQueryFile(Buffer.from('S\0E\0'), 'utf8')).toThrow('NUL');
  });
  it('保存前拒绝孤立代理项，避免静默替换原文', () => {
    expect(() => encodeQueryFile("SELECT '\ud800'", 'utf8')).toThrow('无法无损');
    expect(() => encodeQueryFile("SELECT '\ud800'", 'gb18030')).toThrow('无法无损');
    expect(() => encodeQueryFile("SELECT '\ud800'", 'utf16le')).toThrow('无法无损');
  });
  it('编码后字节大小超过上限时拒绝，不以字符个数冒充字节', () => {
    expect(() => encodeQueryFile('中'.repeat(Math.floor(queryFileLimit / 3) + 1), 'utf8')).toThrow('超过 20 MiB');
    expect(() => decodeQueryFile(Buffer.alloc(queryFileLimit + 1), 'utf8')).toThrow('超过 20 MiB');
  });
  it('实际原子替换已有文件并按所选编码重新读取，临时文件无残留', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dbark-query-files-'));
    try {
      const target = join(directory, '查询.sql'); await writeFile(target, '旧查询');
      await writeQueryFile(target, source, 'utf16le');
      expect(await readQueryFile(target, 'utf8')).toEqual({ sql: source, encoding: 'utf16le' });
      expect((await readFile(target)).subarray(0, 2)).toEqual(Buffer.from([0xff, 0xfe]));
      expect(await readdir(directory)).toEqual(['查询.sql']);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it('替换失败保留原目标，读目录拒绝，写入临时文件仍释放', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dbark-query-files-'));
    try {
      const target = join(directory, '目标.sql'); await mkdir(target); await writeFile(join(target, '保留.txt'), '旧内容');
      await expect(writeQueryFile(target, source, 'utf8')).rejects.toThrow();
      expect(await readFile(join(target, '保留.txt'), 'utf8')).toBe('旧内容');
      expect(await readdir(directory)).toEqual(['目标.sql']);
      await expect(readQueryFile(target, 'utf8')).rejects.toThrow('普通 SQL');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
