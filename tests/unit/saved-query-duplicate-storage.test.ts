import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import initSqlJs, { type SqlJsStatic } from 'sql.js';
import { LocalStore } from '../../src/main/storage';
import type { SavedQuery } from '../../src/shared/contracts';
import { savedQueryDuplicateZh as text } from '../../src/shared/savedQueryDuplicate';

const fault = vi.hoisted(() => ({ path: '' }));
/** 仅注入真实SQLite原子发布故障，其余读写仍经过原文件系统。 */
vi.mock('node:fs', async original => {
  const fs = await original<typeof import('node:fs')>();
  return { ...fs, renameSync: (from: string, to: string) => {
    if (fault.path && from === fault.path + '.tmp' && to === fault.path) throw Error('本例发布故障');
    return fs.renameSync(from, to);
  } };
});
const wasm = createRequire(import.meta.url).resolve('sql.js/dist/sql-wasm.wasm');
const dirs: string[] = [], stores = new Set<LocalStore>(); let SQL: SqlJsStatic;
const protector = { available: vi.fn(() => false), encrypt: vi.fn(() => { throw Error('禁止凭据加密'); }), decrypt: vi.fn(() => { throw Error('禁止凭据解密'); }) };
const sql = "SELECT '900719925474099312345','0.12345678901234567890',NULL,X'00FF','🚢';\r\n-- 不截断正文";
beforeAll(async () => { SQL = await initSqlJs({ locateFile: () => wasm }); });
afterEach(() => { fault.path = ''; for (const store of stores) store.close(); stores.clear(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); vi.clearAllMocks(); });
/** 每例独立真实本地SQLite，不读取用户配置，不访问数据库服务器。 */
async function fixture(patch: Partial<SavedQuery> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dbark-query-copy-')); dirs.push(dir); const path = join(dir, 'config.sqlite');
  const store = await LocalStore.open(path, wasm, protector); stores.add(store);
  const source: SavedQuery = { id: 'source', name: '原查询', connectionId: 'deleted-connection', sql, updatedAt: '2026-10-01T00:00:00.000Z', ...patch };
  store.saveQuery(source); vi.clearAllMocks(); return { store, path, source };
}
/** 摘要使用当前完整记录，组织代次与来源引用共同冻结。 */
function input(store: LocalStore, name = '副本') { return { id: 'source', digest: createHash('sha256').update(store.querySearchRaw('source')!).digest('hex'), expectedRevision: store.queryOrganization().revision, name }; }
/** 独立SQLite读回实际已发布文件，不以生产对象缓存作为持久化证明。 */
function disk(path: string, statement: string) { const db = new SQL.Database(readFileSync(path)); try { return db.exec(statement); } finally { db.close(); } }

it.each([
  { database: 'db', databaseContext: { state: 'known', database: 'db' } },
  { databaseContext: { state: 'known', database: null } }, { databaseContext: { state: 'unknown' } }, {}, { database: 'legacy_db' },
] as const)('来源已删除仍可复制，五类库语义和完整精度保持：%j', async patch => {
  const { store, path, source } = await fixture(patch), raw = store.querySearchRaw('source');
  const settings = store.settings(); store.duplicateQueryChecked(input(store, '  副本🚢  '));
  const copy = store.queries().find(query => query.id !== source.id)!;
  expect(copy.id).toMatch(/^[0-9a-f-]{36}$/); expect(copy).toEqual({ ...source, id: copy.id, name: '  副本🚢  ', updatedAt: copy.updatedAt });
  expect(store.querySearchRaw('source')).toBe(raw); expect(store.settings()).toEqual(settings);
  expect(disk(path, 'SELECT COUNT(*) FROM queries')[0].values).toEqual([[2]]);
  expect(protector.available).not.toHaveBeenCalled(); expect(protector.encrypt).not.toHaveBeenCalled(); expect(protector.decrypt).not.toHaveBeenCalled();
});
it('原组与副本组原子保持，旧组织版本不能重复提交，同名原记录不会合并', async () => {
  const { store, path } = await fixture();
  const organization = store.applyQueryOrganization({ expectedRevision: store.queryOrganization().revision, operation: { kind: 'create', name: '原组', parentId: null } });
  const groupId = organization.groups[0].id;
  store.applyQueryOrganization({ expectedRevision: organization.revision, operation: { kind: 'moveQueries', groupId, queries: [{ id: 'source', digest: input(store).digest }] } });
  const original = input(store, '原查询'), raw = store.querySearchRaw('source'); store.duplicateQueryChecked(original);
  expect(store.queryOrganization().groups[0].count).toBe(2); expect(store.queryOrganization().unfiledCount).toBe(0);
  expect(disk(path, 'SELECT group_id,COUNT(*) FROM saved_query_memberships GROUP BY group_id')[0].values).toEqual([[groupId, 2]]);
  expect(store.querySearchRaw('source')).toBe(raw); expect(store.queries().map(query => query.name)).toEqual(['原查询', '原查询']);
  const bytes = readFileSync(path); expect(() => store.duplicateQueryChecked(original)).toThrow(text.stale); expect(readFileSync(path)).toEqual(bytes);
});
it('来源正文变化、删除、分组移动及非法输入整项拒绝，不产生部分副本', async () => {
  const { store, path, source } = await fixture(), old = input(store);
  store.saveQuery({ ...source, sql: 'SELECT 2' }); const current = input(store);
  expect(() => store.duplicateQueryChecked({ ...current, digest: old.digest })).toThrow(text.stale);
  store.applyQueryOrganization({ expectedRevision: current.expectedRevision, operation: { kind: 'create', name: '新组', parentId: null } });
  expect(() => store.duplicateQueryChecked(current)).toThrow(text.stale);
  for (const name of ['', '  ', 'x\n', '\ud800', 'x'.repeat(257)]) expect(() => store.duplicateQueryChecked(input(store, name))).toThrow();
  store.deleteQuery('source'); const bytes = readFileSync(path);
  expect(() => store.duplicateQueryChecked({ ...old, expectedRevision: store.queryOrganization().revision })).toThrow(text.missing);
  expect(store.queries()).toEqual([]); expect(readFileSync(path)).toEqual(bytes);
});
it('发布失败恢复正文、成员和版本；后续保存及重启不夹带失败副本', async () => {
  const { store, path } = await fixture(), original = input(store), raw = store.querySearchRaw('source'), bytes = readFileSync(path), revision = store.querySearchRevision();
  fault.path = path; expect(() => store.duplicateQueryChecked(original)).toThrow('修改未保存'); fault.path = '';
  expect(readFileSync(path)).toEqual(bytes); expect(store.querySearchRaw('source')).toBe(raw); expect(store.querySearchRevision()).toBe(revision); expect(store.queryOrganization().revision).toBe(original.expectedRevision);
  store.saveSettings({ ...store.settings(), editorWordWrap: false }); expect(store.queries()).toHaveLength(1);
  store.duplicateQueryChecked(original); const copied = store.queries(); store.close(); stores.delete(store);
  const reopened = await LocalStore.open(path, wasm, protector); stores.add(reopened); expect(reopened.queries()).toEqual(copied); expect(reopened.settings().editorWordWrap).toBe(false);
  expect(() => reopened.duplicateQueryChecked(original)).toThrow(text.stale);
});
