import { describe, expect, it } from 'vitest';
import { tableCreateDraftSchema, tableCreateLegacyDesign, type TableCreateDraft, type TableCreatePrefixFacts } from '../../src/shared/tableCreate';
import { planTableCreateIndexes } from '../../src/engine/tableCreateIndexPlan';
const facts = (): TableCreatePrefixFacts => ({ dialect: 'mysql', serverVersion: '8.4.11', pageSize: 16384, defaultRowFormat: 'DYNAMIC', charsets: [{ name: 'utf8mb4', maxBytes: 4 }], digest: 'a'.repeat(64) });
const draft = (): TableCreateDraft => ({ database: 'db', name: 't', engine: 'InnoDB', charset: 'utf8mb4', comment: '', columns: [{ name: 'id', type: 'bigint unsigned', nullable: false, autoIncrement: true, comment: '' }, { name: 'v', type: 'varchar(1000)', nullable: true, autoIncrement: false, comment: '' }], indexes: [{ name: 'PRIMARY', unique: true, columns: ['id'] }, { name: 'ix', unique: false, keyParts: [{ columnName: 'v', prefixLength: 766 }, { columnName: 'id' }] }], foreignKeys: [] });
describe('新表专属前缀合同与计划，不制造实际目录列', () => {
  it('正常组合将全部键部分计入3072字节边界，独立保存计划类型', () => { const plan = planTableCreateIndexes(draft(), facts()); expect(plan.indexes[1].keyBytes).toBe(3072); expect(plan.columns.find(value => value.name === 'v')).toMatchObject({ family: 'character', declaredUnits: 1000, unitBytes: 4 }); });
  it('旧整字段输入保持可用，结构化全字段可无损进入旧链，真正前缀禁止降级', () => { const value = draft(); value.indexes[1] = { name: 'ix', unique: false, keyParts: [{ columnName: 'v' }] }; expect(tableCreateLegacyDesign(value).indexes[1]).toEqual({ name: 'ix', unique: false, columns: ['v'] }); expect(() => tableCreateLegacyDesign(draft())).toThrow('不能降级'); });
  it.each([0, -1, 1.5, NaN, Infinity, '10'])('非法前缀%j在严格合同拒绝', prefixLength => { const value: any = draft(); value.indexes[1].keyParts[0].prefixLength = prefixLength; expect(tableCreateDraftSchema.safeParse(value).success).toBe(false); });
  it('两套表示并存和未知SQL字段一律拒绝', () => { const value: any = draft(); value.indexes[1].columns = ['v']; expect(tableCreateDraftSchema.safeParse(value).success).toBe(false); delete value.indexes[1].columns; value.indexes[1].sql = '`v`(1)'; expect(tableCreateDraftSchema.safeParse(value).success).toBe(false); });
  it('整条预算超界拒绝，不能只检查前缀部分', () => { const value = draft(); value.indexes[1] = { name: 'ix', unique: false, keyParts: [{ columnName: 'v', prefixLength: 767 }, { columnName: 'id' }] }; expect(() => planTableCreateIndexes(value, facts())).toThrow('3072'); });
  it.each(['CHAR', 'BINARY', 'VARCHAR', 'VARBINARY'])('%s前缀按真实MAXLEN或二进制字节计费', type => { const value = draft(); value.columns[1].type = type + '(100)'; value.indexes[1] = { name: 'ix', unique: false, keyParts: [{ columnName: 'v', prefixLength: 10 }] }; expect(planTableCreateIndexes(value, facts()).indexes[1].keyBytes).toBe(type.includes('BINARY') ? 10 : 40); });
  it.each(['TEXT', 'BLOB', 'JSON', 'DECIMAL(10,2)', 'VARCHAR(100) CHARACTER SET latin1'])('无法证明类型%s在预览规划前拒绝', type => { const value = draft(); value.columns[1].type = type; expect(() => planTableCreateIndexes(value, facts())).toThrow(); });
  it.each([{ serverVersion: '8.4.11\n' }, { serverVersion: '8.4.12' }, { serverVersion: '8.0.46' }, { dialect: 'mariadb' }, { pageSize: 8192 }, { defaultRowFormat: 'COMPACT' }, { charsets: [] }, { charsets: [{ name: 'utf8mb4', maxBytes: 0 }] }])('实际能力%j未知时不借草稿补造', patch => { expect(() => planTableCreateIndexes(draft(), { ...facts(), ...patch } as TableCreatePrefixFacts)).toThrow(); });
  it('主键前缀、外键设计、超列长及未知列均拒绝', () => {
    for (const mode of ['primary', 'foreign', 'length', 'column']) { const value: any = draft(); if (mode === 'primary') value.indexes[0] = { name: 'PRIMARY', unique: true, keyParts: [{ columnName: 'id', prefixLength: 1 }] }; if (mode === 'foreign') value.foreignKeys = [{ name: 'fk', columns: ['id'], referencedDatabase: 'db', referencedTable: 'p', referencedColumns: ['id'], onDelete: 'RESTRICT', onUpdate: 'RESTRICT' }]; if (mode === 'length') value.indexes[1].keyParts[0].prefixLength = 1001; if (mode === 'column') value.indexes[1].keyParts[0].columnName = 'missing'; expect(() => planTableCreateIndexes(value, facts())).toThrow(); }
  });
});

it.each(['CHAR', 'VARCHAR', 'BINARY', 'VARBINARY'])('%s等于声明全长度时规范为完整字段，短一位仍是前缀且不修改输入', type => {
  const value = draft(); value.columns[1].type = type + '(100)'; value.indexes[1] = { name: 'ix', unique: false, keyParts: [{ columnName: 'v', prefixLength: 100 }] };
  const plan = planTableCreateIndexes(value, facts()); expect(plan.indexes[1].keyParts[0]).toEqual({ columnName: 'v' }); expect('keyParts' in value.indexes[1] && value.indexes[1].keyParts[0].prefixLength).toBe(100);
  value.indexes[1] = { name: 'ix', unique: false, keyParts: [{ columnName: 'v', prefixLength: 99 }] }; expect(planTableCreateIndexes(value, facts()).indexes[1].keyParts[0].prefixLength).toBe(99);
});

it('前缀等于声明长度也不能绕过主键拒绝；保留未规范化的原请求', () => {
  const value = draft(); value.columns[0].type = 'binary(8)'; value.indexes[0] = {name:'PRIMARY',unique:true,keyParts:[{columnName:'id',prefixLength:8}]}; expect(()=>planTableCreateIndexes(value,facts())).toThrow('主键');
});
