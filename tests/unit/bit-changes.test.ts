import { describe, expect, it } from 'vitest';
import type { ColumnInfo, TableInfo } from '../../src/shared/contracts';
import { buildChanges, typedCellPlaceholder } from '../../src/engine/sql';
import { validateCommand } from '../../src/shared/validation';
const bit: ColumnInfo = { name: 'bits', type: 'bit(64)', nullable: false, defaultValue: null, extra: '', comment: '', generated: false };
const info: TableInfo = { database: 'db', name: 't', columns: [bit], primaryKey: ['bits'], editableKey: ['bits'], indexes: [{ name: 'PRIMARY', columns: ['bits'], unique: true }], foreignKeys: [], engine: 'InnoDB', ddl: '' };
const binary = (hex: string) => ({ type: 'binary' as const, base64: Buffer.from(hex, 'hex').toString('base64') });
describe('BIT完整写入和乐观锁', () => {
  it('insert/update/delete键与旧值统一按位字节转无符号整数', () => {
    const old = binary('ffffffffffffffff'), next = binary('0020000000000001');
    const preview = buildChanges(info, [{ kind: 'insert', values: { bits: next } }, { kind: 'update', before: { bits: old }, values: { bits: next } }, { kind: 'delete', before: { bits: old } }]);
    expect(preview.statements.map(statement => statement.sql.match(/CAST\(CONV\(HEX\(\?\),16,10\) AS UNSIGNED\)/g)?.length)).toEqual([1, 2, 1]);
    expect(preview.statements[1].params).toEqual([next, old]);
  });
  it('非键BIT旧值仍参与完整乐观锁，只消除BIT键的重复条件', () => {
    const table = { ...info, columns: [{ ...bit, name: 'id', type: 'int' }, bit], primaryKey: ['id'], editableKey: ['id'] };
    const old = binary('ffffffffffffffff'); const preview = buildChanges(table, [{ kind: 'update', before: { id: 1, bits: old }, values: { bits: null } }]);
    expect(preview.statements[0].sql).toContain('`bits` <=> CAST(CONV(HEX(?),16,10) AS UNSIGNED)'); expect(preview.statements[0].params).toEqual([null, 1, 1, old]);
  });
  it('定位键只来自同一before快照，IPC不接受与原值矛盾的独立key', () => {
    const change = { kind: 'update', before: { bits: binary('ffffffffffffffff') }, values: { bits: binary('0020000000000001') } };
    const input = { connectionId: 'c', database: 'db', table: 't', changes: [change], taskId: 'task' };
    expect(validateCommand('table.apply', input)).toEqual(input);
    expect(() => validateCommand('table.apply', { ...input, changes: [{ ...change, key: { bits: binary('0000000000000000') } }] })).toThrow();
  });
  it.each([[1, '01', '02'], [7, '7f', '80'], [8, 'ff', '0100'], [9, '01ff', '0200'], [63, '7fffffffffffffff', '8000000000000000'], [64, 'ffffffffffffffff', '01ffffffffffffffff']])('BIT(%i)按实际位数拒绝高位溢出', (width, valid, overflow) => {
    const column = { ...bit, type: `bit(${width})` };
    expect(typedCellPlaceholder(column, binary(String(valid)))).toContain('CONV'); expect(() => typedCellPlaceholder(column, binary(String(overflow)))).toThrow('位范围');
  });
  it('BIT(9)允许零填充且NULL保持NULL，无符号最大值无需Number', () => {
    expect(typedCellPlaceholder({ ...bit, type: 'bit(9)' }, binary('0001'))).toContain('CONV'); expect(typedCellPlaceholder(bit, null)).toBe('?'); expect(typedCellPlaceholder(bit, '18446744073709551615')).toBe('CAST(CAST(? AS DECIMAL(20,0)) AS UNSIGNED)');
    expect(() => typedCellPlaceholder(bit, 9007199254740992)).toThrow('精确字符串'); expect(() => typedCellPlaceholder(bit, '18446744073709551616')).toThrow('范围'); expect(() => typedCellPlaceholder(bit, binary(''))).toThrow('缺少');
  });
});
