import { describe, expect, it, vi } from 'vitest';
import type { TableInfo } from '../../src/shared/contracts';
import { foreignKeyJoinPreview, revalidateForeignKeyJoin, TableForeignKeyJoinIntent, type ForeignKeyJoinTarget } from '../../src/renderer/tableForeignKeyJoinIntent';
import { tableForeignKeyJoinZh as text } from '../../src/renderer/locales/tableForeignKeyJoin.zh-CN';

/** 完全合成的目录，不创建数据库会话或伪造查询执行成功。 */
function tables() {
  const table = (database: string, name: string, names: string[]): TableInfo => ({ database, name, objectKind: 'table', engine: 'InnoDB', ddl: '', indexes: [], primaryKey: [], editableKey: [], foreignKeys: [], columns: names.map(name => ({ name, type: 'bigint unsigned', nullable: true, generated: false, extra: '', comment: '', defaultValue: null })) });
  const child = table('child_db', 'child', ['id', 'parent_id']), parent = table('parent_db', 'parent', ['id', 'value']);
  child.foreignKeys.push({ name: 'fk', columns: ['parent_id'], referencedDatabase: parent.database, referencedTable: parent.name, referencedColumns: ['id'], onDelete: 'RESTRICT', onUpdate: 'RESTRICT' });
  return { child, parent };
}
function fixture() { const source = tables(), identity = {}, intent = new TableForeignKeyJoinIntent(source.child, 'connection', 77, [identity], () => true); return { ...source, identity, intent, preview: () => foreignKeyJoinPreview(intent, source.parent, 'fk', 'LEFT', { childColumns: ['id'], parentColumns: ['value'] }) }; }

describe('外键JOIN原结构与前置核验租约', () => {
  it('固定只读结构不持有行或DDL条件，前置串行读同连接双方结构后仅消费一次', async () => {
    const f = fixture(), preview = f.preview(), read = vi.fn(async (target: ForeignKeyJoinTarget) => target.table === f.child.name ? f.child : f.parent);
    await revalidateForeignKeyJoin(f.intent, preview, read, () => true);
    expect(read.mock.calls.map(([target]) => target)).toEqual([{ connectionId: 'connection', database: 'child_db', table: 'child' }, { connectionId: 'connection', database: 'parent_db', table: 'parent' }]);
    expect(f.intent.consume(preview)).toBe(preview.sql); expect(preview.sql).toContain('LIMIT 77;'); expect(preview.sql).not.toMatch(/WHERE|ORDER BY|INSERT|UPDATE|DELETE/); expect(() => f.intent.consume(preview)).toThrow(text.stale);
  });
  it('观察导航ABA或guard失败后不能恢复同一个来源', () => {
    const f = fixture(); f.intent.observe([{}]); f.intent.observe([f.identity]); expect(f.intent.current()).toBe(false); expect(() => f.preview()).toThrow(text.stale);
    let current = true; const intent = new TableForeignKeyJoinIntent(f.child, 'connection', 1, [], () => current); current = false; expect(intent.current()).toBe(false); current = true; expect(intent.current()).toBe(false);
  });
  it.each(['child', 'parent'] as const)('打开前%s目录改变即拒绝旧SQL，不自动换用新结构', async side => {
    const f = fixture(), preview = f.preview(), changed = structuredClone(f[side]); changed.columns[0].type = 'varchar(64)';
    const read = vi.fn(async (target: ForeignKeyJoinTarget) => target.table === f.child.name ? side === 'child' ? changed : f.child : side === 'parent' ? changed : f.parent);
    await expect(revalidateForeignKeyJoin(f.intent, preview, read, () => true)).rejects.toThrow(text.stale); expect(f.intent.current()).toBe(false); expect(read).toHaveBeenCalledTimes(side === 'child' ? 1 : 2);
  });
  it('子表核验在途后失效不再开始父表读取，也不吞原权限错误', async () => {
    const f = fixture(), preview = f.preview(); let active = true;
    const read = vi.fn(async () => { active = false; return f.child; }); await expect(revalidateForeignKeyJoin(f.intent, preview, read, () => active)).rejects.toThrow(text.stale); expect(read).toHaveBeenCalledOnce();
    const g = fixture(), denied = vi.fn(async () => { throw Error('真实父目录权限拒绝'); }); await expect(revalidateForeignKeyJoin(g.intent, g.preview(), denied, () => true)).rejects.toThrow('真实父目录权限拒绝');
  });
  it('父表错目标拒绝，DDL文字改变不代替相关结构身份', async () => {
    const f = fixture(); expect(() => foreignKeyJoinPreview(f.intent, { ...f.parent, database: 'wrong' }, 'fk', 'LEFT', { childColumns: ['id'], parentColumns: [] })).toThrow(text.target);
    const preview = f.preview(), read = vi.fn(async (target: ForeignKeyJoinTarget) => ({ ...structuredClone(target.table === f.child.name ? f.child : f.parent), ddl: '无关AUTO_INCREMENT目录文字改变' }));
    await expect(revalidateForeignKeyJoin(f.intent, preview, read, () => true)).resolves.toBeUndefined();
  });
  it('自关联前置核验只读一次原表，选列和输入对象都不被回执改写', async () => {
    const { child } = tables(); child.foreignKeys[0].referencedDatabase = child.database; child.foreignKeys[0].referencedTable = child.name;
    const source = structuredClone(child), intent = new TableForeignKeyJoinIntent(child, 'self', 5, [], () => true), options = { childColumns: ['id'], parentColumns: ['parent_id'] };
    const preview = foreignKeyJoinPreview(intent, child, 'fk', 'INNER', options), read = vi.fn(async () => child); options.parentColumns[0] = 'id';
    await revalidateForeignKeyJoin(intent, preview, read, () => true); expect(read).toHaveBeenCalledOnce(); expect(preview.options.parentColumns).toEqual(['parent_id']); expect(child).toEqual(source);
  });
});
