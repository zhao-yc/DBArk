import { describe, expect, it } from 'vitest';
import type { SqliteTableRebuildInspectOutput } from '../../src/shared/sqliteTableRebuild';
import { compileSqliteTableRebuildDefinition } from '../../src/shared/sqliteTableRebuildPlan';
import { openSqliteCheckForm as open, updateSqliteCheckForm as update, stageSqliteCheckForm as stage, removeSqliteCheck as remove } from '../../src/renderer/sqliteCheckEditor';
import { openSqliteForeignKeyForm, stageSqliteForeignKeyForm } from '../../src/renderer/sqliteForeignKeyEditor';
import { sqliteCheckZh as text } from '../../src/renderer/locales/sqliteCheck.zh-CN';

/** 只使用合成RAM目录，不连接文件、数据库或IPC。 */
function catalogue(tableSql = 'CREATE TABLE subject("a,b" INTEGER CONSTRAINT c CHECK(subject."a,b">0),b INTEGER,g INTEGER AS(b) STORED)'): SqliteTableRebuildInspectOutput {
  return { catalogueId: 'c', target: { connectionId: 'conn', database: 'main', table: 'subject' }, tableSql, columns: ['a,b', 'b', 'g'].map((name, cid) => ({ cid, name, declaredType: 'INTEGER', notNull: false, defaultSql: null, primaryKey: 0, hidden: cid === 2 ? 3 : 0 })), relatedObjects: [], strict: false, withoutRowid: false, readOnly: false, rowIdentity: { kind: 'rowid', source: '_rowid_' }, expiresAt: '2099-01-01T00:00:00Z' };
}
let counter = 0; const id = () => 'check-' + ++counter;

describe('SQLite CHECK本地草稿的表达式与准确目标', () => {
  it('按原文完整回填限定表达式和附着字段，未核对不得替换', () => {
    const c = catalogue(), form = open(c, [], { kind: 'open', ordinal: 0 }, id); expect(form).toMatchObject({ name: 'c', location: 'column', column: 'a,b', expression: 'subject."a,b">0' }); expect(() => stage(c, [], form)).toThrow(text.legacyRequired); expect(stage(c, [], { ...form, legacyAccepted: true })[0]).toMatchObject({ kind: 'replace', ordinal: 0, expectedSql: 'CONSTRAINT c CHECK(subject."a,b">0)', definition: { column: 'a,b' } });
  });
  it('新建默认空表达式，无效暂存不丢输入；生成字段和跨字段表达式可准确选择', () => {
    const c = catalogue(), form = open(c, [], { kind: 'open' }, id); expect(form.expression).toBe(''); expect(() => stage(c, [], form)).toThrow(text.invalidDefinition); expect(stage(c, [], { ...form, location: 'column', column: 'g', expression: 'subject.g>=b' })[0]).toMatchObject({ kind: 'add', definition: { location: 'column', column: 'g', expression: 'subject.g>=b' } });
  });
  it('匿名替换继续编辑仍匿名，不复活原约束名', () => {
    const c = catalogue(), form = open(c, [], { kind: 'open', ordinal: 0 }, id), edits = stage(c, [], { ...form, name: '', legacyAccepted: true }); expect(open(c, edits, { kind: 'open', edit: edits[0] }, id).name).toBe('');
  });
  it('重名与重复声明独立定位，移除第二条不改第一条', () => {
    const c = catalogue('CREATE TABLE subject("a,b" INTEGER CONSTRAINT c CHECK(b>0) CONSTRAINT c CHECK(b>0),b INTEGER,g INTEGER AS(b) STORED)'), edits = remove(c, [], 1); expect(edits).toEqual([{ kind: 'remove', ordinal: 1, expectedSql: 'CONSTRAINT c CHECK(b>0)' }]); expect(stage(c, edits, { ...open(c, edits, { kind: 'open', ordinal: 0 }, id), legacyAccepted: true })).toMatchObject([{ kind: 'remove', ordinal: 1 }, { kind: 'replace', ordinal: 0 }]);
  });
  it('旧队列引用和复制对象不能覆盖后继草稿，准确SQL变化使表单失效', () => {
    const c = catalogue(), edits = stage(c, [], { ...open(c, [], { kind: 'open', ordinal: 0 }, id), legacyAccepted: true }), form = open(c, edits, { kind: 'open', edit: edits[0] }, id);
    expect(() => stage(c, [], { ...form, legacyAccepted: true })).toThrow(text.staleForm); expect(() => stage(c, [{ ...edits[0] }], { ...form, legacyAccepted: true })).toThrow(text.staleForm); const changed = catalogue(c.tableSql.replace('CHECK(subject."a,b">0)', 'CHECK(subject."a,b">1)')); expect(() => stage(changed, edits, { ...form, legacyAccepted: true })).toThrow(text.invalid); expect(() => open(changed, edits, { kind: 'open', edit: edits[0] }, id)).toThrow(text.invalid);
  });
  it('位置切换保留附着字段和未完成表达式，旧token不能写新表单', () => {
    const c = catalogue(), initial = open(c, [], { kind: 'open' }, id), first = update(initial, { kind: 'field', token: initial.token, field: 'expression', value: 'b>0 AND (' }), second = update(first, { kind: 'field', token: first.token, field: 'location', value: 'column' }); expect(second).toMatchObject({ column: 'a,b', expression: 'b>0 AND (' }); expect(() => stage(c, [], second)).toThrow(text.invalidDefinition); expect(() => update(open(c, [], { kind: 'open' }, id), { kind: 'field', token: initial.token, field: 'name', value: '旧输入' })).toThrow(text.staleForm);
  });
  it('已有表达式的每次结构或文本修改都撤销原文确认', () => {
    const c = catalogue(), form = { ...open(c, [], { kind: 'open', ordinal: 0 }, id), legacyAccepted: true }; for (const [field, value] of [['name', 'new'], ['location', 'table'], ['column', 'b'], ['expression', 'b>0']] as const) expect(update(form, { kind: 'field', token: form.token, field, value }).legacyAccepted).toBe(false);
  });
  it.each(['b>?', 'b>0; DELETE FROM subject', "b='未闭合", 'b>0 /*未结束', '('.repeat(65) + 'b' + ')'.repeat(65), "b='" + '界'.repeat(23000) + "'"])('危险或越预算表达式不能暂存：%s', expression => {
    const c = catalogue(), form = { ...open(c, [], { kind: 'open' }, id), expression }; expect(() => stage(c, [], form)).toThrow(text.invalidDefinition); expect(form.expression).toBe(expression);
  });
  it('准确附着字段拒绝大小写猜测和未知名称，表级不携带隐藏列参数', () => {
    const c = catalogue(), form = open(c, [], { kind: 'open' }, id); expect(() => stage(c, [], { ...form, location: 'column', column: 'B', expression: 'b>0' })).toThrow(); const value = stage(c, [], { ...form, column: '不存在', expression: 'b>0' })[0]; expect(value.kind !== 'remove' && value.definition).not.toHaveProperty('column');
  });
  it('暂存允许与原主键交换约束名，完整编译统一释放旧名字', () => {
    const c = catalogue('CREATE TABLE subject("a,b" INTEGER CONSTRAINT p PRIMARY KEY CONSTRAINT c CHECK(b>0),b INTEGER,g INTEGER AS(b) STORED)'), edits = stage(c, [], { ...open(c, [], { kind: 'open', ordinal: 0 }, id), name: 'p', expression: 'b>=0', legacyAccepted: true });
    const plan = compileSqliteTableRebuildDefinition({ table: 'subject', tableSql: c.tableSql, columns: c.columns, changes: [], candidateName: '__dbark_rebuild_' + '0'.repeat(32), checkEdits: edits, primaryKeyEdit: { kind: 'replace', expectedSql: 'CONSTRAINT p PRIMARY KEY', definition: { name: 'c', location: 'column', columns: [{ column: 'a,b', collation: null, order: null }], conflict: null, autoIncrement: false } } }); expect(plan.candidateSql).toContain('CONSTRAINT "p" CHECK'); expect(plan.candidateSql).toContain('CONSTRAINT "c" PRIMARY KEY');
  });
  it('外键暂存可使用本批释放的CHECK名字，不能忽略共同修改的命名空间', () => {
    const c = catalogue(), edits = remove(c, [], 0), form = openSqliteForeignKeyForm(c, [], { kind: 'open' }, id), changed = { ...form, name: 'c', parent: 'parent', implicit: true, mappings: [{ ...form.mappings[0], local: 'b' }] };
    expect(() => stageSqliteForeignKeyForm(c, [], changed)).toThrow(); expect(stageSqliteForeignKeyForm(c, [], changed, { changes: [], checkEdits: edits })[0]).toMatchObject({ kind: 'add', definition: { name: 'c' } });
  });
});
