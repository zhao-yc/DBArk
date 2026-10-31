import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { SqliteConnectionFiles } from '../../src/main/sqliteConnectionFiles';
import type { SqliteConnectionProfile } from '../../src/shared/contracts';
import { commandSchemas } from '../../src/shared/validation';

const directories: string[] = [];
afterEach(context => { vi.useRealTimers(); if (context.task.result?.state !== 'fail') for (const directory of directories.splice(0)) { expect(dirname(resolve(directory))).toBe(resolve(tmpdir())); expect(basename(directory).startsWith('dbark-sqlite-file-grant-')).toBe(true); rmSync(directory, { recursive: true, force: true }); } });
/** 这里只核Main文件能力，不拿普通文件的选择证明其SQLite内容有效；原生driver另验格式。 */
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'dbark-sqlite-file-grant-')); directories.push(directory);
  const path = join(directory, '主库.sqlite'); writeFileSync(path, '仅测试文件身份');
  let document = {}; const owner = { document };
  const grants = new SqliteConnectionFiles<{ document: object }>({ assert(value) { if (value.document !== document) throw Error('原文档已失效'); }, same: (a, b) => a.document === b.document });
  const profile: SqliteConnectionProfile = { id: 'sqlite-connection', name: '文件连接', group: '', color: '#123456', dialect: 'sqlite', sqlite: { readOnly: true, busyTimeoutMs: 1000 } };
  return { directory, path, owner, grants, profile, rotate() { document = {}; return { document }; } };
}
it('选择绑定准确文档及连接，测试与保存可复用，落盘候选无token且已存准确路径可沿用', () => {
  const f = fixture(), choice = f.grants.register(f.owner, f.path, f.profile.id);
  const selected = { ...f.profile, pendingFiles: ['sqliteDatabase'] as const, sqlite: { ...f.profile.sqlite, fileName: choice.name, fileToken: choice.token } };
  const input: SqliteConnectionProfile = { ...selected, pendingFiles: [...selected.pendingFiles] };
  const tested = f.grants.confirm(input, undefined, f.owner), saved = f.grants.confirm(input, undefined, { document: f.owner.document });
  expect(saved).toEqual(tested); expect(saved.sqlite.filePath).toBe(f.path); expect(saved.sqlite.fileToken).toBeUndefined(); expect(saved.pendingFiles).toBeUndefined();
  expect(f.grants.confirm({ ...saved, name: '仅改名字' }, saved, f.owner).sqlite.filePath).toBe(f.path);
});
it('新建和导入无法凭绝对路径或删pending伪造权限，另一个连接不能使用旧token', () => {
  const f = fixture(); expect(() => f.grants.confirm({ ...f.profile, sqlite: { ...f.profile.sqlite, filePath: f.path } }, undefined, f.owner)).toThrow('尚未授权');
  const pending = f.grants.confirm(f.profile, undefined, f.owner); expect(pending.pendingFiles).toEqual(['sqliteDatabase']); expect(pending.sqlite.filePath).toBeUndefined();
  expect(f.grants.confirm({ ...f.profile, pendingFiles: undefined }, pending, f.owner).pendingFiles).toEqual(['sqliteDatabase']);
  const choice = f.grants.register(f.owner, f.path, f.profile.id);
  expect(() => f.grants.confirm({ ...f.profile, id: 'copy', sqlite: { ...f.profile.sqlite, fileToken: choice.token } }, undefined, f.owner)).toThrow('尚未授权');
  expect(() => f.grants.confirm(f.profile, { ...f.profile, id: 'other' }, f.owner)).toThrow('尚未授权');
});
it('文档换代、配置替换撤销及到期不能领取原选择', () => {
  vi.useFakeTimers(); const f = fixture(), choice = f.grants.register(f.owner, f.path, f.profile.id), selected = { ...f.profile, sqlite: { ...f.profile.sqlite, fileToken: choice.token } };
  f.grants.revokeConnections([f.profile.id]); expect(() => f.grants.confirm(selected, undefined, f.owner)).toThrow('尚未授权');
  const fresh = f.grants.register(f.owner, f.path, f.profile.id); vi.setSystemTime(Date.now() + 600001);
  expect(() => f.grants.confirm({ ...selected, sqlite: { ...selected.sqlite, fileToken: fresh.token } }, undefined, f.owner)).toThrow('尚未授权');
  const next = f.rotate(); expect(() => f.grants.confirm(selected, undefined, f.owner)).toThrow('原文档');
  expect(() => f.grants.confirm(selected, undefined, next)).toThrow('尚未授权');
});
it('选中后文件被同路径不同对象替换，旧令牌在保存屏障复核时失效', () => {
  const f = fixture(), choice = f.grants.register(f.owner, f.path, f.profile.id);
  const replacement = join(f.directory, 'replacement.sqlite'); writeFileSync(replacement, '另一个文件');
  renameSync(f.path, join(f.directory, 'original.sqlite')); renameSync(replacement, f.path);
  expect(() => f.grants.confirm({ ...f.profile, sqlite: { ...f.profile.sqlite, fileToken: choice.token } }, undefined, f.owner)).toThrow('尚未授权');
  expect(() => f.grants.register(f.owner, f.directory, f.profile.id)).toThrow('尚未授权');
});
it('SQLite选择用途必须带准确连接且不能夹其它用途字段；网络旧用途仍兼容', () => {
  expect(commandSchemas['files.choose'].safeParse({ purpose: 'sqlite-database', sqliteConnectionId: 'id' }).success).toBe(true);
  for (const input of [{ purpose: 'sqlite-database' }, { purpose: 'sqlite-database', sqliteConnectionId: 'id', format: 'sql' }, { purpose: 'sqlite-database', sqliteConnectionId: 'id', format: '' }, { purpose: 'sqlite-database', sqliteConnectionId: 'id', suggestedName: '' }, { purpose: 'query', sqliteConnectionId: 'id' }]) expect(commandSchemas['files.choose'].safeParse(input).success).toBe(false);
  expect(commandSchemas['files.choose'].safeParse({ purpose: 'query' }).success).toBe(true);
});
