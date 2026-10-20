import { afterEach, expect, it, vi } from 'vitest';
import { LocalStore } from '../../src/main/storage';
import type { SqlSnippet } from '../../src/shared/contracts';

const fs = vi.hoisted(() => ({ files: new Map<string, Uint8Array>(), writes: 0, fail: false }));
// 真实LocalStore事务与flush运行，文件及SQL行端口为RAM；不初始化SQLite、迁移或用户配置。
vi.mock('node:fs', () => ({ existsSync: () => false, mkdirSync() {}, readFileSync() { throw Error('禁止读取磁盘'); }, writeFileSync(path: string, data: Uint8Array) { fs.writes++; fs.files.set(path, Uint8Array.from(data)); }, renameSync(from: string, to: string) { if (fs.fail) throw Error('RAM发布失败'); fs.files.set(to, fs.files.get(from)!); fs.files.delete(from); } }));
const sample: SqlSnippet = { id: '旧', name: '旧片段', group: '', description: '', sql: 'SELECT 1;\r\n', updatedAt: '' };
class SnippetRows {
  constructor(public rows: SqlSnippet[] = []) {}
  export() { return Buffer.from(JSON.stringify(this.rows)); }
  close() {}
  run(sql: string, values?: string[]) {
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return;
    if (sql.startsWith('INSERT INTO sql_snippets VALUES')) { const row = JSON.parse(values![1]) as SqlSnippet; this.rows = [...this.rows.filter(s => s.id !== row.id), row]; return; }
    if (sql === 'DELETE FROM sql_snippets WHERE id=?') { this.rows = this.rows.filter(s => s.id !== values![0]); return; }
    throw Error('越界RAM SQL');
  }
  prepare(sql: string) {
    if (sql !== 'SELECT data FROM sql_snippets ORDER BY updated_at DESC,id') throw Error('越界RAM读取');
    const rows = this.rows.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id)); let i = -1;
    return { bind() {}, step: () => ++i < rows.length, getAsObject: () => ({ data: JSON.stringify(rows[i]) }), free() {} };
  }
}
function store(rows: SqlSnippet[] = [sample]): LocalStore {
  const restore = (bytes: Uint8Array) => new SnippetRows(JSON.parse(Buffer.from(bytes).toString()));
  return Reflect.construct(LocalStore, [new SnippetRows(structuredClone(rows)), 'RAM片段库', { available: () => false, encrypt() { throw Error('禁止凭据'); }, decrypt() { throw Error('禁止凭据'); } }, restore]) as LocalStore;
}
afterEach(() => { fs.files.clear(); fs.writes = 0; fs.fail = false; });
it('真实批次一次事务和flush，仅成功发布推进修订，整批保留SQL与同名不同ID', () => {
  const s = store(); s.applySnippetBatch([{ ...sample, sql: 'SELECT 2\r\n' }, { ...sample, id: '副本' }], 0, () => {});
  expect(fs.writes).toBe(1); expect(s.snippetRevision()).toBe(1); expect(s.snippets().map(s => s.sql).sort()).toEqual(['SELECT 1;\r\n', 'SELECT 2\r\n'].sort());
  expect(JSON.parse(Buffer.from(fs.files.get('RAM片段库')!).toString())).toHaveLength(2);
});
it('发布失败恢复整批前内存、原字节及修订；之后保存不夹带失败行', () => {
  const s = store(); s.saveSnippet(sample); const before = s.snippets(), original = fs.files.get('RAM片段库'); fs.fail = true;
  expect(() => s.applySnippetBatch([{ ...sample, sql: '失败覆盖' }, { ...sample, id: '失败新增' }], 1, () => {})).toThrow('修改未保存'); expect(s.snippets()).toEqual(before); expect(fs.files.get('RAM片段库')).toEqual(original); expect(s.snippetRevision()).toBe(1);
  fs.fail = false; s.saveSnippet({ ...sample, id: '之后新增' }); expect(s.snippets().map(s => s.id).sort()).toEqual(['旧', '之后新增'].sort()); expect(JSON.parse(Buffer.from(fs.files.get('RAM片段库')!).toString()).map((s: SqlSnippet) => s.id).sort()).toEqual(['旧', '之后新增'].sort());
});
it('最终current失败也回退事务且零flush，不能留下前几条行', () => {
  const s = store(); let checks = 0;
  expect(() => s.applySnippetBatch([{ ...sample, sql: 'SELECT 2' }, { ...sample, id: '新' }], 0, () => { if (++checks === 3) throw Error('RAM归属失效'); })).toThrow('修改未保存');
  expect(s.snippets()).toEqual([sample]); expect(s.snippetRevision()).toBe(0); expect(fs.writes).toBe(0);
});
it('组合预算在事务前校验：批次单独合法但合并超过500条、名称/描述、保留ID均零flush', () => {
  const rows = Array.from({ length: 500 }, (_, i) => ({ ...sample, id: String(i) })), s = store(rows);
  for (const input of [[{ ...sample, id: '新' }], [{ ...sample, id: '0', name: 'x'.repeat(101) }], [{ ...sample, id: '0', description: 'x'.repeat(2001) }], [{ ...sample, id: 'builtin-count' }]]) expect(() => s.applySnippetBatch(input, 0, () => {})).toThrow();
  expect(fs.writes).toBe(0); expect(s.snippets()).toHaveLength(500); expect(s.snippetRevision()).toBe(0);
});
it('普通保存删除和ABA推进修订使旧预览失效，空批次不发布', () => {
  const s = store(); s.applySnippetBatch([], 0, () => {}); expect(fs.writes).toBe(0);
  s.saveSnippet({ ...sample, sql: 'SELECT 2' }); s.saveSnippet(sample); expect(() => s.applySnippetBatch([{ ...sample, id: '新' }], 0, () => {})).toThrow(); expect(s.snippetRevision()).toBe(2); s.deleteSnippet(sample.id); expect(s.snippetRevision()).toBe(3);
});
