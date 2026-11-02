import { describe, expect, it } from 'vitest';
import type { SqliteTableRebuildInspectOutput } from '../../src/shared/sqliteTableRebuild';
import { openSqliteUniqueForm as open, updateSqliteUniqueForm as update, stageSqliteUniqueForm as stage, removeSqliteUnique as remove } from '../../src/renderer/sqliteUniqueEditor';
import { sqliteUniqueZh as text } from '../../src/renderer/locales/sqliteUnique.zh-CN';
import { compileSqliteTableRebuildDefinition } from '../../src/shared/sqliteTableRebuildPlan';
import { openSqliteForeignKeyForm, stageSqliteForeignKeyForm, removeSqliteForeignKey } from '../../src/renderer/sqliteForeignKeyEditor';

/** 只使用合成内存目录，不连接文件、数据库或IPC。 */
function catalogue(tableSql = 'CREATE TABLE subject("a,b" INTEGER CONSTRAINT u UNIQUE,b INTEGER,g TEXT AS(b) VIRTUAL)'): SqliteTableRebuildInspectOutput {
  return { catalogueId: 'c', target: { connectionId: 'conn', database: 'main', table: 'subject' }, tableSql, columns: ['a,b', 'b', 'g'].map((name, cid) => ({ cid, name, declaredType: cid === 2 ? 'TEXT' : 'INTEGER', notNull: false, defaultSql: null, primaryKey: 0, hidden: cid === 2 ? 2 : 0 })), relatedObjects: [], strict: false, withoutRowid: false, readOnly: false, rowIdentity: { kind: 'rowid', source: '_rowid_' }, expiresAt: '2099-01-01T00:00:00Z' };
}
let counter = 0; const id = () => 'unique-' + ++counter;

describe('SQLite UNIQUE编辑草稿原目标与稳定字段保护', () => {
  it('完整读取行内原文和逗号字段，替换前必须明确核对原声明', () => {
    const c = catalogue(), form = open(c, [], { kind: 'open', ordinal: 0 }, id); expect(form).toMatchObject({ name: 'u', location: 'column', columns: [{ column: 'a,b', collation: '', order: '' }] }); expect(() => stage(c, [], form)).toThrow(text.legacyRequired);
    expect(stage(c, [], { ...form, legacyAccepted: true })[0]).toMatchObject({ kind: 'replace', ordinal: 0, expectedSql: 'CONSTRAINT u UNIQUE', definition: { columns: [{ column: 'a,b', collation: null, order: null }] } });
  });
  it('无原约束也能新增，已有生成字段允许准确选择，不套用主键禁止规则', () => {
    const c = catalogue('CREATE TABLE subject("a,b" INTEGER,b INTEGER,g TEXT AS(b) VIRTUAL)'), form = open(c, [], { kind: 'open' }, id); expect(stage(c, [], form)[0]).toMatchObject({ kind: 'add' });
    expect(stage(c, [], { ...form, columns: [{ ...form.columns[0], column: 'g' }] })[0]).toMatchObject({ definition: { columns: [{ column: 'g' }] } });
  });
  it('重复约束名及相同声明按序号独立编辑，移除一个不会批量误删', () => {
    const c = catalogue('CREATE TABLE subject("a,b" INTEGER CONSTRAINT u UNIQUE CONSTRAINT u UNIQUE,b INTEGER,g TEXT AS(b) VIRTUAL)'), first = remove(c, [], 1); expect(first).toEqual([{ kind: 'remove', ordinal: 1, expectedSql: 'CONSTRAINT u UNIQUE' }]);
    expect(stage(c, first, { ...open(c, first, { kind: 'open', ordinal: 0 }, id), legacyAccepted: true })).toMatchObject([{ kind: 'remove', ordinal: 1 }, { kind: 'replace', ordinal: 0 }]);
  });
  it('旧表单不能覆盖更换或撤销后的队列对象，复制出来的相同内容也不获授权', () => {
    const c = catalogue(), edit = stage(c, [], { ...open(c, [], { kind: 'open', ordinal: 0 }, id), legacyAccepted: true })[0], form = open(c, [edit], { kind: 'open', edit }, id);
    expect(() => stage(c, [], { ...form, legacyAccepted: true })).toThrow(text.staleForm); expect(() => stage(c, [{ ...edit }], { ...form, legacyAccepted: true })).toThrow(text.staleForm); expect(stage(c, [edit], { ...form, name: 'new', legacyAccepted: true })[0]).toMatchObject({ definition: { name: 'new' } });
  });
  it('同名原对象的SQL或原序号变化后，旧表单及旧草稿不可复活', () => {
    const c = catalogue(), form = open(c, [], { kind: 'open', ordinal: 0 }, id), edit = stage(c, [], { ...form, legacyAccepted: true })[0], changed = catalogue(c.tableSql.replace('CONSTRAINT u UNIQUE', 'CONSTRAINT v UNIQUE'));
    expect(() => stage(changed, [], { ...form, legacyAccepted: true })).toThrow(text.invalid); expect(() => open(changed, [edit], { kind: 'open', edit }, id)).toThrow(text.invalid); expect(() => open(c, [], { kind: 'open', ordinal: 4 }, id)).toThrow(text.invalid);
  });
  it('旧字段大小写引用回填真实原字段，排序规则和方向均保留', () => {
    const c = catalogue('CREATE TABLE subject("a,b" INTEGER,b INTEGER,g TEXT AS(b) VIRTUAL,UNIQUE(B COLLATE NOCASE DESC))'), form = open(c, [], { kind: 'open', ordinal: 0 }, id);
    expect(form.columns[0]).toMatchObject({ column: 'b', collation: 'NOCASE', order: 'DESC' }); expect(stage(c, [], { ...form, legacyAccepted: true })[0]).toMatchObject({ definition: { columns: [{ column: 'b', collation: 'NOCASE', order: 'DESC' }] } });
  });
  it('字段重排保留稳定ID，旧行移除后的事件被拒绝，不能转写另一行', () => {
    const c = catalogue(); let form = open(c, [], { kind: 'open' }, id); const first = form.columns[0], token = form.token; form = update(form, { kind: 'add-field', token }, id); const second = form.columns[1]; form = update(form, { kind: 'move', token, id: second.id, direction: -1 }, id); form = update(form, { kind: 'column', token, id: first.id, field: 'collation', value: 'NOCASE' }, id); expect(form.columns[1].id).toBe(first.id); expect(form.columns[1].collation).toBe('NOCASE'); form = update(form, { kind: 'remove-field', token, id: first.id }, id); expect(() => update(form, { kind: 'column', token, id: first.id, field: 'column', value: 'b' }, id)).toThrow(text.staleForm); expect(form.columns[0].id).toBe(second.id);
  });
  it('切换行内不删除复合字段和排序输入，非法组合保留到用户明确修正', () => {
    const c = catalogue(); let form = open(c, [], { kind: 'open' }, id), token = form.token; form = update(form, { kind: 'column', token, id: form.columns[0].id, field: 'collation', value: 'NOCASE' }, id); form = update(form, { kind: 'column', token, id: form.columns[0].id, field: 'order', value: 'DESC' }, id); form = update(form, { kind: 'field', token, field: 'location', value: 'column' }, id); expect(form.columns[0]).toMatchObject({ collation: 'NOCASE', order: 'DESC' }); expect(() => stage(c, [], form)).toThrow(text.invalidDefinition); form = update(form, { kind: 'field', token, field: 'location', value: 'table' }, id); expect(stage(c, [], form)[0]).toMatchObject({ definition: { columns: [{ collation: 'NOCASE', order: 'DESC' }] } });
  });
  it('已有重复字段不自动去重，修改须明确调整；空选择和未知字段拒绝', () => {
    const c = catalogue('CREATE TABLE subject("a,b" INTEGER,b INTEGER,g TEXT AS(b) VIRTUAL,UNIQUE(b,b))'), form = open(c, [], { kind: 'open', ordinal: 0 }, id); expect(form.columns).toHaveLength(2); expect(() => stage(c, [], { ...form, legacyAccepted: true })).toThrow(text.invalidDefinition);
    const empty = open(c, [], { kind: 'open' }, id); expect(() => stage(c, [], { ...empty, columns: [{ ...empty.columns[0], column: '' }] })).toThrow(); expect(() => stage(c, [], { ...empty, columns: [{ ...empty.columns[0], column: 'MISSING' }] })).toThrow(/准确选择/);
  });
  it('移除只生成原准确补丁，已移除草稿需撤销后才能打开，其他新增草稿保留', () => {
    const c = catalogue(), addition = stage(c, [], open(c, [], { kind: 'open' }, id)), edits = remove(c, addition, 0); expect(edits[0]).toEqual(addition[0]); expect(edits[1]).toEqual({ kind: 'remove', ordinal: 0, expectedSql: 'CONSTRAINT u UNIQUE' }); expect(() => open(c, edits, { kind: 'open', ordinal: 0 }, id)).toThrow(text.invalid);
  });
  it('旧表单令牌、过长输入及越界移动均不修改输入', () => {
    const form = open(catalogue(), [], { kind: 'open' }, id); expect(() => update(form, { kind: 'field', token: 'old', field: 'name', value: 'stale' }, id)).toThrow(text.staleForm); expect(() => update(form, { kind: 'field', token: form.token, field: 'name', value: 'x'.repeat(513) }, id)).toThrow(); expect(() => update(form, { kind: 'move', token: form.token, id: form.columns[0].id, direction: -1 }, id)).toThrow(); expect(form.name).toBe('');
  });
  it('暂存允许待补丁解决的名称交换，但完整计划仍拒绝最终冲突', () => {
    const c = catalogue('CREATE TABLE subject("a,b" INTEGER CONSTRAINT p PRIMARY KEY,b INTEGER,g TEXT AS(b) VIRTUAL)'), form = { ...open(c, [], { kind: 'open' }, id), name: 'p' }, uniqueEdits = stage(c, [], form);
    expect(uniqueEdits).toHaveLength(1); expect(() => compileSqliteTableRebuildDefinition({ table: 'subject', tableSql: c.tableSql, columns: c.columns, candidateName: '__dbark_rebuild_' + '0'.repeat(32), changes: [], uniqueEdits })).toThrow(/原约束名冲突/);
  });
  it('已暂存UNIQUE与外键名称可在完整上下文交换，后续外键移除不误判保留名称', () => {
    const c = catalogue('CREATE TABLE subject("a,b" INTEGER CONSTRAINT old_u UNIQUE,b INTEGER CONSTRAINT old_fk REFERENCES parent(id),g TEXT AS(b) VIRTUAL)'), uniqueEdits = stage(c, [], { ...open(c, [], { kind: 'open', ordinal: 0 }, id), name: 'old_fk', legacyAccepted: true }), form = { ...openSqliteForeignKeyForm(c, [], { kind: 'open', ordinal: 0 }, id), name: 'old_u' }, context = { uniqueEdits, changes: [] };
    const foreign = stageSqliteForeignKeyForm(c, [], form, context); expect(foreign[0]).toMatchObject({ kind: 'replace', definition: { name: 'old_u' } }); expect(removeSqliteForeignKey(c, foreign, 0, context)[0]).toMatchObject({ kind: 'remove' });
  });
});
