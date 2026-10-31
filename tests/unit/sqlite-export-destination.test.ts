import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, writeFile, readFile, link, rm, mkdir, symlink } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import type { SqliteConnectionProfile } from '../../src/shared/contracts';
import { assertSqliteExportDestination } from '../../src/main/sqliteExportDestination';

const owned: string[] = [];
/** 每例使用独立临时目录，不接触开发者连接或真实数据库文件。 */
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dbark-sqlite-export-destination-')); owned.push(root);
  const source = join(root, 'source.sqlite'); await writeFile(source, '原数据库');
  const profile = { id: 'sqlite-test', name: '测试', dialect: 'sqlite', sqlite: { filePath: source, readOnly: true, busyTimeoutMs: 0 } } as SqliteConnectionProfile;
  return { root, source, profile };
}
afterEach(async () => { for (const root of owned.splice(0)) { expect(dirname(resolve(root))).toBe(resolve(tmpdir())); expect(basename(root).startsWith('dbark-sqlite-export-destination-')).toBe(true); await rm(root, { recursive: true, force: true }); } });
describe('SQLite完整导出目的保护', () => {
  it('拒绝源文件及存在或不存在的三个日志目标，保留原字节', async () => {
    const { source, profile } = await fixture();
    for (const suffix of ['', '-wal', '-shm', '-journal']) {
      if (suffix === '-wal') await writeFile(source + suffix, '原日志');
      await expect(assertSqliteExportDestination(source + suffix, [profile])).rejects.toThrow('数据库或日志');
    }
    expect(await readFile(source, 'utf8')).toBe('原数据库'); expect(await readFile(source + '-wal', 'utf8')).toBe('原日志');
  });
  it('拒绝不同名称的源文件和日志硬链接', async () => {
    const { source, root, profile } = await fixture(); const alias = join(root, 'export.json');
    await link(source, alias); await expect(assertSqliteExportDestination(alias, [profile])).rejects.toThrow('数据库或日志');
    const journal = source + '-journal', aliasJournal = join(root, 'export.csv'); await writeFile(journal, '事务日志'); await link(journal, aliasJournal);
    await expect(assertSqliteExportDestination(aliasJournal, [profile])).rejects.toThrow('数据库或日志');
  });
  it('保护其它保存的库，普通已有导出及失效其它路径不阻止新导出', async () => {
    const { source, root, profile } = await fixture(); const other = { ...profile, id: 'other', sqlite: { ...profile.sqlite, filePath: join(root, 'other.sqlite') } };
    await writeFile(other.sqlite.filePath, '其它数据库');
    await expect(assertSqliteExportDestination(other.sqlite.filePath, [profile, other])).rejects.toThrow('数据库或日志');
    const target = join(root, 'rows.json'); await writeFile(target, '旧导出');
    await expect(assertSqliteExportDestination(target, [profile, { ...other, sqlite: { ...other.sqlite, filePath: join(root, 'missing', 'gone.sqlite') } }])).resolves.toBeUndefined();
    expect(await readFile(target, 'utf8')).toBe('旧导出'); expect(await readFile(source, 'utf8')).toBe('原数据库');
  });
  it('canonical父目录消除相对路径段；新文件目标仍可创建', async () => {
    const { source, root, profile } = await fixture(); await mkdir(join(root, 'child'));
    await expect(assertSqliteExportDestination(join(root, 'child', '..', 'source.sqlite'), [profile])).rejects.toThrow('数据库或日志');
    await expect(assertSqliteExportDestination(join(root, 'new.csv'), [profile])).resolves.toBeUndefined();
  });
  it('真实目录链接不绕过数据库及尚未存在日志路径保护', async () => {
    const { root, profile } = await fixture(), alias = root + '-alias'; owned.push(alias);
    await symlink(root, alias, process.platform === 'win32' ? 'junction' : 'dir');
    await expect(assertSqliteExportDestination(join(alias, 'source.sqlite'), [profile])).rejects.toThrow('数据库或日志');
    await expect(assertSqliteExportDestination(join(alias, 'source.sqlite-shm'), [profile])).rejects.toThrow('数据库或日志');
    await expect(assertSqliteExportDestination(join(alias, 'rows.json'), [profile])).resolves.toBeUndefined();
  });
});
