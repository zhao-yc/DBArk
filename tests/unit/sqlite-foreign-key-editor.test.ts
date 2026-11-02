import { describe, expect, it } from 'vitest';
import type { SqliteTableRebuildInspectOutput } from '../../src/shared/sqliteTableRebuild';
import type { SqliteTableForeignKeyEdit } from '../../src/shared/sqliteTableForeignKeys';
import { sqliteForeignKeysZh as text } from '../../src/renderer/locales/sqliteForeignKeys.zh-CN';
import { openSqliteForeignKeyForm as open, updateSqliteForeignKeyForm as update, stageSqliteForeignKeyForm as stage, removeSqliteForeignKey as remove, sqliteForeignKeyNeedsAcknowledgement as needsAck, type SqliteForeignKeyForm } from '../../src/renderer/sqliteForeignKeyEditor';

/** 纯内存目录保留匿名、重名和含逗号字段；不向任何数据库发请求。 */
function catalogue(sql = 'CREATE TABLE subject("a,b" INTEGER REFERENCES parent(id),b INTEGER,CONSTRAINT repeated FOREIGN KEY(b) REFERENCES other(id),CONSTRAINT repeated FOREIGN KEY(b) REFERENCES third(id))'): SqliteTableRebuildInspectOutput {
  return { catalogueId: 'catalogue', target: { connectionId: 'c', database: 'main', table: 'subject' }, readOnly: false, expiresAt: '2099-01-01T00:00:00Z', tableSql: sql, columns: ['a,b', 'b'].map((name, cid) => ({ cid, name, declaredType: 'INTEGER', notNull: false, defaultSql: null, primaryKey: 0, hidden: 0 })), relatedObjects: [], strict: false, withoutRowid: false, rowIdentity: { kind: 'rowid', source: '_rowid_' } };
}
let sequence = 0;
const id = () => 'form-' + ++sequence;
/** 模拟用户逐项输入，缺省本表字段取准确原目录，不解析逗号。 */
function added(c = catalogue()): SqliteForeignKeyForm { const form = open(c, [], { kind: 'open' }, id); return { ...form, name: 'new', parent: 'parent', mappings: [{ ...form.mappings[0], parent: 'id' }] }; }

describe('SQLite外键本地表单与原声明身份', () => {
  it('默认匿名、映射按准确字段名保存；暂存产生结构化补丁而不修改原目录', () => {
    const c = catalogue(), original = JSON.stringify(c), form = added(c); const result = stage(c, [], { ...form, name: '' });
    expect(result).toEqual([{ kind: 'add', definition: { name: null, columns: ['a,b'], referencedTable: 'parent', referencedColumns: ['id'], onDelete: 'NO ACTION', onUpdate: 'NO ACTION', deferral: 'not-deferrable' } }]); expect(JSON.stringify(c)).toBe(original);
  });
  it('原匿名及重名约束按声明序号与准确SQL定位，不按同名或pragma编号合并', () => {
    const c = catalogue(), first = open(c, [], { kind: 'open', ordinal: 0 }, id), third = open(c, [], { kind: 'open', ordinal: 2 }, id);
    expect(first.name).toBe(''); expect(first.original?.location).toBe('column'); expect(third.parent).toBe('third');
    const removed = remove(c, [], 1); expect(removed[0]).toMatchObject({ kind: 'remove', ordinal: 1, expectedSql: 'CONSTRAINT repeated FOREIGN KEY(b) REFERENCES other(id)' });
    expect(stage(c, removed, { ...third, name: 'third_fk' })).toHaveLength(2);
  });
  it('编辑已暂存项替换准确队列引用，已撤销项和序号混合不能重新入队', () => {
    const c = catalogue(), queue = stage(c, [], added(c)), form = open(c, queue, { kind: 'open', edit: queue[0] }, id);
    const changed = stage(c, queue, { ...form, onDelete: 'CASCADE' }); expect(changed).toHaveLength(1); expect(changed[0]).toMatchObject({ definition: { onDelete: 'CASCADE' } });
    expect(() => stage(c, [], form)).toThrow(text.staleForm); expect(() => open(c, queue, { kind: 'open', edit: { ...queue[0] } }, id)).toThrow(text.invalid);
    expect(() => open(c, queue, { kind: 'open', edit: queue[0], ordinal: 1 }, id)).toThrow(text.invalid);
  });
  it('原修改后标记移除只替换该原声明，已移除原项不能继续编辑', () => {
    const c = catalogue(), form = open(c, [], { kind: 'open', ordinal: 0 }, id), queue = stage(c, [], { ...form, onDelete: 'CASCADE' }), removed = remove(c, queue, 0);
    expect(removed).toHaveLength(1); expect(removed[0]).toMatchObject({ kind: 'remove', ordinal: 0 }); expect(() => open(c, removed, { kind: 'open', ordinal: 0 }, id)).toThrow(text.invalid);
    expect(queue[0].kind).toBe('replace'); expect(() => remove(c, queue, 3)).toThrow(text.invalid);
  });
  it('映射重排以稳定行ID定位，迟到输入不能落到另一行，移除后拒绝旧事件', () => {
    let form = added(), token = form.token; const first = form.mappings[0]; form = update(form, { kind: 'add-mapping', token }, id); const second = form.mappings[1];
    form = update(form, { kind: 'move', token, id: second.id, direction: -1 }, id); form = update(form, { kind: 'mapping', token, id: first.id, field: 'parent', value: 'late,id' }, id);
    expect(form.mappings.map(row => row.id)).toEqual([second.id, first.id]); expect(form.mappings[1].parent).toBe('late,id'); expect(form.mappings[0].parent).toBe('');
    form = update(form, { kind: 'remove-mapping', token, id: first.id }, id); expect(() => update(form, { kind: 'mapping', token, id: first.id, field: 'parent', value: 'stale' }, id)).toThrow(text.staleForm); expect(form.mappings[0].id).toBe(second.id);
  });
  it('复合主键省略父字段列表，切回显式映射仍保留用户逐项输入', () => {
    let form = added(), token = form.token; form = update(form, { kind: 'add-mapping', token }, id); const row = form.mappings[1];
    form = update(form, { kind: 'mapping', token, id: row.id, field: 'local', value: 'b' }, id); form = update(form, { kind: 'mapping', token, id: row.id, field: 'parent', value: 'part,2' }, id);
    form = update(form, { kind: 'flag', token, field: 'implicit', value: true }, id); expect(stage(catalogue(), [], form)[0]).toMatchObject({ definition: { columns: ['a,b', 'b'], referencedColumns: [] } });
    form = update(form, { kind: 'flag', token, field: 'implicit', value: false }, id); expect(stage(catalogue(), [], form)[0]).toMatchObject({ definition: { referencedColumns: ['id', 'part,2'] } });
  });
  it.each(['MATCH simple', 'ON INSERT CASCADE', 'CONSTRAINT "" REFERENCES parent(id)'])('替换特殊原文%s要求明确确认，保留原约束无此转换', legacy => {
    const sql = legacy.startsWith('CONSTRAINT') ? `CREATE TABLE subject("a,b" INTEGER ${legacy},b INTEGER)` : `CREATE TABLE subject("a,b" INTEGER REFERENCES parent(id) ${legacy},b INTEGER)`;
    const c = catalogue(sql), form = open(c, [], { kind: 'open', ordinal: 0 }, id); expect(needsAck(form)).toBe(true); expect(() => stage(c, [], form)).toThrow(text.legacyRequired); expect(stage(c, [], { ...form, legacyAccepted: true })).toHaveLength(1);
  });
  it.each(['parent', 'local', 'remote', 'duplicate'] as const)('无效%s输入保留表单且返回中文提示，不能部分暂存', kind => {
    const form = added(); if (kind === 'parent') form.parent = ''; else if (kind === 'local') form.mappings[0].local = ''; else if (kind === 'remote') form.mappings[0].parent = ''; else form.mappings.push({ ...form.mappings[0], id: id() });
    const original = JSON.stringify(form); expect(() => stage(catalogue(), [], form)).toThrow(); expect(JSON.stringify(form)).toBe(original);
    if (kind !== 'duplicate') expect(() => stage(catalogue(), [], form)).toThrow(text.invalidDefinition);
  });
  it('整组试编译拒绝未知字段、命名冲突和原SQL不匹配，原队列不变', () => {
    const c = catalogue(), form = added(c), queue: SqliteTableForeignKeyEdit[] = [];
    expect(() => stage(c, queue, { ...form, name: 'repeated' })).toThrow(); expect(() => stage(c, queue, { ...form, mappings: [{ ...form.mappings[0], local: 'missing' }] })).toThrow();
    const bad: SqliteTableForeignKeyEdit[] = [{ kind: 'remove', ordinal: 0, expectedSql: 'REFERENCES changed(id)' }]; expect(() => stage(c, bad, form)).toThrow(); expect(bad[0]).toMatchObject({ expectedSql: 'REFERENCES changed(id)' }); expect(queue).toEqual([]);
  });
  it('新表单token切断ABA和旧事件，重复动作及最后一行删除均拒绝', () => {
    const c = catalogue(), a = added(c), b = added(c); expect(a.token).not.toBe(b.token);
    expect(() => update(b, { kind: 'field', token: a.token, field: 'parent', value: 'stale' }, id)).toThrow(text.staleForm);
    expect(() => update(a, { kind: 'remove-mapping', token: a.token, id: a.mappings[0].id }, id)).toThrow(); expect(() => update(a, { kind: 'move', token: a.token, id: a.mappings[0].id, direction: -1 }, id)).toThrow();
    expect(() => update(a, { kind: 'field', token: a.token, field: 'onDelete', value: 'DROP' }, id)).toThrow();
  });
});
