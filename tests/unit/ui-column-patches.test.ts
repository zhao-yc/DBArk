import { describe, expect, it } from 'vitest';
import type { ColumnPatch, TableColumnView } from '../../src/shared/tableColumnPatches';
import { columnAcknowledgementLabel, columnFailureState, editableColumnDefault, formatReadColumnDefault, makeColumnAlter, sameColumnTarget, setColumnPatch, setColumnPrecision, validateColumnDrafts, type ColumnPatchProgress } from '../../src/renderer/columnPatches';

/** 测试列按不透明ref定位，同名原型字段不是对象成员查找。 */
function column(columnRef: string, name: string): TableColumnView { return { columnRef, name, ordinal: 1, typeSql: 'VARCHAR(255)', nullable: true, default: { kind: 'none' }, comment: '', rawDefinition: '`' + name + '` varchar(255)', access: Object.fromEntries(['name', 'type', 'nullable', 'default', 'comment', 'position'].map(key => [key, { editable: true }])) as TableColumnView['access'] }; }
const columns = [column('ref-a', '__proto__'), column('ref-b', 'constructor'), column('ref-c', '普通字段')];

describe('字段差异前端草稿与结果证据', () => {
  it('风险ID映射成明确中文，未知或原型同名ID不能猜测并授权', () => {
    expect(columnAcknowledgementLabel('ddl-implicit-commit')).toContain('回滚'); expect(columnAcknowledgementLabel('drop-column-data')).toContain('永久');
    for (const id of ['external-ddl-window', 'external-name-dependencies', 'conversion-or-nullability']) expect(columnAcknowledgementLabel(id)).toMatch(/[\u4e00-\u9fff]/);
    for (const id of ['future-risk', '__proto__', 'constructor']) expect(columnAcknowledgementLabel(id)).toBeUndefined();
  });
  it('不修改与无DEFAULT不同，空文本、文本NULL、真NULL与受控表达式可辨', () => {
    const base = columns[0]; expect(makeColumnAlter(base, {})).toBeNull(); expect(makeColumnAlter(base, { default: { kind: 'none' } })).toBeNull();
    const variants = [{ kind: 'null' as const }, { kind: 'literal' as const, valueType: 'text' as const, value: '' }, { kind: 'literal' as const, valueType: 'text' as const, value: 'NULL' }, { kind: 'expression' as const, expression: 'current-timestamp' as const, precision: 6 }];
    expect(variants.map(value => makeColumnAlter(base, { default: value }))).toEqual(variants.map(value => ({ kind: 'alter', columnRef: 'ref-a', changes: { default: value } })));
    expect(editableColumnDefault({ kind: 'expression', sql: 'CURRENT_TIMESTAMP(6)' })).toEqual(variants[3]);
    expect(editableColumnDefault({ kind: 'expression', sql: 'NOW() + INTERVAL 1 DAY' })).toBeUndefined();
    expect(editableColumnDefault({ kind: 'opaque', sql: 'unknown()', reason: '只读' })).toBeUndefined();
  });
  it('默认值展示区分缺省、真NULL、空文本与文字NULL，转义文本不显示模型对象', () => {
    expect(formatReadColumnDefault({ kind: 'none' })).toBe('无 DEFAULT');
    expect(formatReadColumnDefault({ kind: 'null' })).toBe('SQL NULL');
    expect(formatReadColumnDefault({ kind: 'literal', valueType: 'text', value: '' })).toBe('空字符串：""');
    expect(formatReadColumnDefault({ kind: 'literal', valueType: 'text', value: 'NULL' })).toBe('文本 NULL："NULL"');
    expect(formatReadColumnDefault({ kind: 'literal', valueType: 'text', value: '换行\n"引号"', introducer: '_utf8mb4' })).toBe('文本："换行\\n\\"引号\\""（字符集引导：_utf8mb4）');
  });
  it('默认值展示保留精确数字与二进制编码及表达式精度，无法解析明确提示核对', () => {
    expect(formatReadColumnDefault({ kind: 'literal', valueType: 'number', value: '9007199254740993.12345678' })).toBe('精确数值：9007199254740993.12345678');
    expect(formatReadColumnDefault({ kind: 'literal', valueType: 'binary', encoding: 'hex', value: '00ff' })).toBe('二进制 HEX：00ff');
    expect(formatReadColumnDefault({ kind: 'literal', valueType: 'binary', encoding: 'bits', value: '0001' })).toBe('二进制位串：0001');
    expect(formatReadColumnDefault({ kind: 'expression', sql: 'CURRENT_TIMESTAMP(6)' })).toBe('SQL 表达式（只读）：CURRENT_TIMESTAMP(6)');
    expect(formatReadColumnDefault({ kind: 'expression', sql: 'CURRENT_TIMESTAMP' })).toBe('SQL 表达式（只读）：CURRENT_TIMESTAMP');
    expect(formatReadColumnDefault({ kind: 'opaque', sql: 'future_default()', reason: '不支持' })).toContain('无法解析默认值，请核对原 SQL 片段：future_default()');
  });
  it('服务器规范NOW与受控括号初始化相同精度，保持文字和opaque默认的类型边界', () => {
    for (const sql of ['CURRENT_TIMESTAMP', 'CURRENT_TIMESTAMP()', 'now()', '(NOW())', ' (( current_timestamp(0) )) ']) {
      expect(editableColumnDefault({ kind: 'expression', sql })).toEqual({ kind: 'expression', expression: 'current-timestamp', precision: 0 });
    }
    for (const sql of ['CURRENT_TIMESTAMP(6)', 'now(6)', '(now(6))']) {
      expect(editableColumnDefault({ kind: 'expression', sql })).toEqual({ kind: 'expression', expression: 'current-timestamp', precision: 6 });
    }
    for (const sql of ["'NOW()'", 'NOW', 'NOW(7)', 'NOW() + INTERVAL 1 DAY', 'CURRENT_TIMESTAMP /* 注释 */']) expect(editableColumnDefault({ kind: 'expression', sql })).toBeUndefined();
    expect(editableColumnDefault({ kind: 'literal', valueType: 'text', value: 'NOW()' })).toEqual({ kind: 'literal', valueType: 'text', value: 'NOW()' });
    expect(editableColumnDefault({ kind: 'opaque', sql: '(now(6))', reason: '未知定义' })).toBeUndefined();
    const column = { ...columns[0], default: { kind: 'expression' as const, sql: '(now(6))' } };
    expect(makeColumnAlter(column, { default: { kind: 'expression', expression: 'current-timestamp', precision: 6 } })).toBeNull();
    expect(makeColumnAlter(column, { default: { kind: 'expression', expression: 'current-timestamp', precision: 3 } })).toMatchObject({ changes: { default: { precision: 3 } } });
  });
  it('恢复原值删除差异，只发送改变属性，readonly原因阻止覆写', () => {
    expect(makeColumnAlter(columns[0], { name: '__proto__', comment: '', nullable: true, type: { kind: 'string', type: 'VARCHAR', length: 255 } })).toBeNull();
    expect(makeColumnAlter(columns[0], { name: '__proto__', comment: '新注释' })).toEqual({ kind: 'alter', columnRef: 'ref-a', changes: { comment: '新注释' } });
    const locked = { ...columns[0], access: { ...columns[0].access, type: { editable: false, reason: '原片段不能安全保留' } } };
    expect(() => makeColumnAlter(locked, { type: { kind: 'integer', type: 'INT', unsigned: false } })).toThrow('原片段不能安全保留');
    expect(makeColumnAlter({ ...columns[0], nullable: undefined }, { comment: '说明' })).toEqual({ kind: 'alter', columnRef: 'ref-a', changes: { comment: '说明' } });
  });
  it('稳定引用更新与撤销不触及其他字段，合法原型名仍是普通名称', () => {
    const old: ColumnPatch[] = [{ kind: 'alter', columnRef: 'ref-a', changes: { comment: 'a' } }, { kind: 'alter', columnRef: 'ref-b', changes: { comment: 'b' } }];
    const changed = setColumnPatch(old, 'ref-a', { kind: 'alter', columnRef: 'ref-a', changes: { name: '改名' } }); expect(changed).toHaveLength(2); expect(changed[0]).toBe(old[1]); expect(old[0].kind).toBe('alter');
    expect(setColumnPatch(changed, 'ref-a', null)).toEqual([old[1]]); expect(validateColumnDrafts(columns, old, 30)).toEqual(old);
  });
  it('新增clientKey可作为位置引用，删除目标、环、最后一列和重命名交换均拒绝', () => {
    const add: ColumnPatch = { kind: 'add', clientKey: 'client-new', name: '新增', type: { kind: 'integer', type: 'INT', unsigned: false }, nullable: true, default: { kind: 'none' }, comment: '', position: { kind: 'after', columnRef: 'ref-a' } };
    expect(validateColumnDrafts(columns, [add, { kind: 'alter', columnRef: 'ref-b', changes: { position: { kind: 'after', columnRef: 'client-new' } } }], 30)).toHaveLength(2);
    expect(() => validateColumnDrafts(columns, [add, { kind: 'drop', columnRef: 'ref-a' }], 30)).toThrow();
    expect(() => validateColumnDrafts(columns, [{ kind: 'alter', columnRef: 'ref-a', changes: { position: { kind: 'after', columnRef: 'ref-b' } } }, { kind: 'alter', columnRef: 'ref-b', changes: { position: { kind: 'after', columnRef: 'ref-a' } } }], 30)).toThrow();
    expect(() => validateColumnDrafts(columns, columns.map(column => ({ kind: 'drop', columnRef: column.columnRef })), 30)).toThrow();
    expect(() => validateColumnDrafts(columns, [{ kind: 'alter', columnRef: 'ref-a', changes: { name: 'constructor' } }, { kind: 'alter', columnRef: 'ref-b', changes: { name: '__proto__' } }], 30)).toThrow();
  });
  it('严格预算和精确默认值文本校验，不截断或将金额转Number', () => {
    const patch: ColumnPatch = { kind: 'alter', columnRef: 'ref-a', changes: { default: { kind: 'literal', valueType: 'number', value: '900719925474099312345.1234567890' } } };
    expect(validateColumnDrafts(columns, [patch], 30)).toEqual([patch]);
    expect(() => validateColumnDrafts(columns, [{ kind: 'alter', columnRef: 'ref-a', changes: { comment: '中'.repeat(180000) } }], 30)).toThrow();
    expect(() => validateColumnDrafts(columns, Array.from({ length: 101 }, (_, index) => ({ kind: 'drop', columnRef: String(index) })), 30)).toThrow();
    expect(() => validateColumnDrafts(columns, [{ kind: 'alter', columnRef: 'ref-a', changes: { default: { kind: 'literal', valueType: 'binary', value: '0f1' } } }], 30)).toThrow();
  });
  it('展示目标比较保持库表大小写，不能证明同ID连接配置没变化', () => {
    const target = { connectionId: 'id', database: 'CaseDB', table: 'CaseTable' };
    expect(sameColumnTarget(target, { ...target })).toBe(true); expect(sameColumnTarget(target, { ...target, table: 'casetable' })).toBe(false); expect(sameColumnTarget(target, { ...target, connectionId: 'other' })).toBe(false);
  });
  it('清空时间类型和受控表达式精度删除自有键，严格补丁可预览而不弱化undefined拒绝', () => {
    const type = setColumnPrecision({ kind: 'temporal', type: 'TIMESTAMP', precision: 6 }, '');
    const value = setColumnPrecision({ kind: 'expression', expression: 'current-timestamp', precision: 6 }, '');
    expect(Object.hasOwn(type, 'precision')).toBe(false); expect(Object.hasOwn(value, 'precision')).toBe(false);
    expect(validateColumnDrafts(columns, [{ kind: 'alter', columnRef: 'ref-a', changes: { type, default: value } }], 30)).toHaveLength(1);
    expect(setColumnPrecision(value, '0')).toEqual({ kind: 'expression', expression: 'current-timestamp', precision: 0 });
    expect(() => validateColumnDrafts(columns, [{ kind: 'alter', columnRef: 'ref-a', changes: { type: { kind: 'temporal', type: 'TIMESTAMP', precision: undefined } } }], 30)).toThrow();
    expect(() => validateColumnDrafts(columns, [{ kind: 'alter', columnRef: 'ref-a', changes: { default: { kind: 'expression', expression: 'current-timestamp', precision: undefined } } }], 30)).toThrow();
  });
  it('缺失败proof保守unknown，DDL完成后核验/清理错误不会假报未执行', () => {
    const proof: ColumnPatchProgress = { phase: 'rechecking', ddlSubmitted: false, ddlCompleted: false, definitionVerified: false, outcome: 'not-sent' };
    expect(columnFailureState(null)).toBe('unknown'); expect(columnFailureState(proof)).toBe('notSent');
    expect(columnFailureState({ ...proof, ddlSubmitted: true })).toBe('unknown'); expect(columnFailureState({ ...proof, outcome: 'failed', ddlSubmitted: true })).toBe('failed');
    expect(columnFailureState({ ...proof, phase: 'verifying', ddlSubmitted: true, ddlCompleted: true, outcome: 'succeeded' })).toBe('verificationFailed');
    expect(columnFailureState({ ...proof, phase: 'releasing', ddlSubmitted: true, ddlCompleted: true, definitionVerified: true, outcome: 'succeeded' })).toBe('succeeded');
  });
});
