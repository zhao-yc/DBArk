import { describe, expect, it } from 'vitest';
import type { SqliteTableRebuildInspectOutput } from '../../src/shared/sqliteTableRebuild';
import { openSqlitePrimaryKeyForm as open, updateSqlitePrimaryKeyForm as update, stageSqlitePrimaryKeyForm as stage, removeSqlitePrimaryKey as remove } from '../../src/renderer/sqlitePrimaryKeyEditor';
import { sqlitePrimaryKeyZh as text } from '../../src/renderer/locales/sqlitePrimaryKey.zh-CN';
import { openSqliteForeignKeyForm, stageSqliteForeignKeyForm, removeSqliteForeignKey } from '../../src/renderer/sqliteForeignKeyEditor';

/** 全部目录和输入仅在内存中，不连接数据库、文件或IPC。 */
function catalogue(tableSql = 'CREATE TABLE subject("a,b" INTEGER CONSTRAINT p PRIMARY KEY,b INTEGER,g TEXT AS(b) VIRTUAL)'): SqliteTableRebuildInspectOutput {
  return { catalogueId: 'c', target: { connectionId: 'conn', database: 'main', table: 'subject' }, tableSql, columns: ['a,b', 'b', 'g'].map((name, cid) => ({ cid, name, declaredType: cid === 2 ? 'TEXT' : 'INTEGER', notNull: false, defaultSql: null, primaryKey: cid === 0 ? 1 : 0, hidden: cid === 2 ? 2 : 0 })), relatedObjects: [], strict: false, withoutRowid: false, readOnly: false, rowIdentity: { kind: 'rowid', source: 'a,b' }, expiresAt: '2099-01-01T00:00:00Z' };
}
let sequence = 0; const id = () => 'primary-' + ++sequence;
describe('SQLite主键表单原目标及输入保护', () => {
  it('完整原文和位置读取，含逗号字段名逐项保留，未确认原文不能替换', () => {
    const c = catalogue(), form = open(c, undefined, id); expect(form).toMatchObject({ name: 'p', location: 'column', columns: [{ column: 'a,b', collation: '', order: '' }] }); expect(() => stage(c, undefined, form)).toThrow(text.legacyRequired);
    expect(stage(c, undefined, { ...form, legacyAccepted: true })).toMatchObject({ kind: 'replace', expectedSql: 'CONSTRAINT p PRIMARY KEY', definition: { columns: [{ column: 'a,b', collation: null, order: null }] } });
  });
  it('新增无主键表默认准确普通字段，生成列不作为新主键候选', () => {
    const c = catalogue('CREATE TABLE subject("a,b" INTEGER,b INTEGER,g TEXT AS(b) VIRTUAL)'), form = open(c, undefined, id); expect(form.location).toBe('table'); expect(stage(c, undefined, form)).toMatchObject({ kind: 'add', definition: { name: null, columns: [{ column: 'a,b' }] } }); expect(() => stage(c, undefined, { ...form, columns: [{ ...form.columns[0], column: 'g' }] })).toThrow(/普通字段/);
  });
  it('编辑已暂存主键绑定准确引用，撤销／更换后旧表单不能复活原补丁', () => {
    const c = catalogue(), first = stage(c, undefined, { ...open(c, undefined, id), legacyAccepted: true }), form = open(c, first, id); expect(() => stage(c, undefined, { ...form, legacyAccepted: true })).toThrow(text.staleForm); expect(() => stage(c, { ...first }, { ...form, legacyAccepted: true })).toThrow(text.staleForm); expect(stage(c, first, { ...form, name: 'new', legacyAccepted: true })).toMatchObject({ definition: { name: 'new' } });
  });
  it('主键映射重排不改变字段ID，迟到事件更新原字段，移除后拒绝旧输入', () => {
    let form = open(catalogue(), undefined, id), token = form.token; const first = form.columns[0]; form = update(form, { kind: 'add-field', token }, id); const second = form.columns[1]; form = update(form, { kind: 'move', token, id: second.id, direction: -1 }, id); form = update(form, { kind: 'column', token, id: first.id, field: 'collation', value: 'NOCASE' }, id); expect(form.columns[1].collation).toBe('NOCASE'); expect(form.columns[0].collation).toBe(''); form = update(form, { kind: 'remove-field', token, id: first.id }, id); expect(() => update(form, { kind: 'column', token, id: first.id, field: 'column', value: 'b' }, id)).toThrow(text.staleForm); expect(form.columns[0].id).toBe(second.id);
  });
  it('切换位置不静默删除复合字段／排序规则，非法组合须明确修正后才可暂存', () => {
    const c = catalogue(); let form = open(c, undefined, id), token = form.token; form = update(form, { kind: 'field', token, field: 'location', value: 'table' }, id); form = update(form, { kind: 'add-field', token }, id); form = update(form, { kind: 'column', token, id: form.columns[1].id, field: 'column', value: 'b' }, id); form = update(form, { kind: 'column', token, id: form.columns[1].id, field: 'collation', value: 'NOCASE' }, id); form = update(form, { kind: 'field', token, field: 'location', value: 'column' }, id); expect(form.columns).toHaveLength(2); expect(() => stage(c, undefined, { ...form, legacyAccepted: true })).toThrow(text.invalidDefinition); form = update(form, { kind: 'field', token, field: 'location', value: 'table' }, id); expect(stage(c, undefined, { ...form, legacyAccepted: true })).toMatchObject({ definition: { columns: [{ column: 'a,b' }, { column: 'b', collation: 'NOCASE' }] } });
  });
  it('新原文／存在性改变使旧表单和补丁失效，不能按旧名猜测原约束', () => {
    const c = catalogue(), form = open(c, undefined, id), changed = catalogue(c.tableSql.replace('CONSTRAINT p PRIMARY KEY', 'CONSTRAINT other PRIMARY KEY')); expect(() => stage(changed, undefined, { ...form, legacyAccepted: true })).toThrow(text.invalid); const edit = stage(c, undefined, { ...form, legacyAccepted: true }); expect(() => open(changed, edit, id)).toThrow(text.invalid);
  });
  it('移除只绑定原主键SQL，WR禁止移除，已标记移除的草稿须撤销后才能编辑', () => {
    const c = catalogue(), edit = remove(c); expect(edit).toEqual({ kind: 'remove', expectedSql: 'CONSTRAINT p PRIMARY KEY' }); expect(() => open(c, edit, id)).toThrow(text.invalid); expect(() => remove(catalogue('CREATE TABLE subject("a,b" INTEGER,b INTEGER,g TEXT AS(b) VIRTUAL,PRIMARY KEY(b)) WITHOUT ROWID'))).toThrow(text.wrRemove);
  });
  it('未决定的类型与主外键名字互换可先形成主键草稿，再整组试编译外键', () => {
    const c = catalogue('CREATE TABLE subject("a,b" INT CONSTRAINT old_pk PRIMARY KEY,b INTEGER CONSTRAINT old_fk REFERENCES parent(id),g TEXT AS(b) VIRTUAL,CONSTRAINT spare FOREIGN KEY(b) REFERENCES parent(id))'), primary = stage(c, undefined, { ...open(c, undefined, id), name: 'old_fk', location: 'column', autoIncrement: true, legacyAccepted: true });
    const foreign = openSqliteForeignKeyForm(c, [], { kind: 'open', ordinal: 0 }, id), edited = { ...foreign, name: 'old_pk' };
    const context = { primaryKeyEdit: primary, changes: [{ column: 'a,b', declaredType: 'INTEGER' }] }, queue = stageSqliteForeignKeyForm(c, [], edited, context);
    expect(queue).toHaveLength(1); expect(removeSqliteForeignKey(c, queue, 1, context)).toMatchObject([{ kind: 'replace', definition: { name: 'old_pk' } }, { kind: 'remove', ordinal: 1 }]); expect(() => removeSqliteForeignKey(c, queue, 1)).toThrow(/约束名冲突/);
    expect(() => stageSqliteForeignKeyForm(c, [], edited)).toThrow(/约束名冲突/);
  });
  it.each(['unknown', 'a,b', 'g'])('无效或重复字段%s暂存失败保持完整输入，不部分修改旧草稿', column => {
    const c = catalogue(); const form = { ...open(c, undefined, id), location: 'table' as const, legacyAccepted: true }; form.columns.push({ id: id(), column, collation: '', order: '' }); const before = JSON.stringify(form); expect(() => stage(c, undefined, form)).toThrow(); expect(JSON.stringify(form)).toBe(before);
  });
  it('取消后新表单token与旧输入隔离；越界移动、末行移除及未知枚举不能进入草稿', () => {
    const a = open(catalogue(), undefined, id), b = open(catalogue(), undefined, id); expect(() => update(b, { kind: 'flag', token: a.token, field: 'autoIncrement', value: true }, id)).toThrow(text.staleForm); expect(() => update(a, { kind: 'remove-field', token: a.token, id: a.columns[0].id }, id)).toThrow(); expect(() => update(a, { kind: 'move', token: a.token, id: a.columns[0].id, direction: -1 }, id)).toThrow(); expect(() => update(a, { kind: 'field', token: a.token, field: 'conflict', value: 'DROP' }, id)).toThrow();
  });
});
