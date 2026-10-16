import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildChanges, deserializeCell } from '../../src/engine/sql';
import type { CellValue, ColumnInfo, DataRow, TableInfo } from '../../src/shared/contracts';

const maximum = '18446744073709551615', adjacent = '18446744073709551614';
const binary = { type: 'binary' as const, base64: 'AP8=' };
/** 列序与修改字段序故意不同，验证SET、复合键和完整原值参数不会错位。 */
function table(): TableInfo {
  const columns = [['id', 'bigint unsigned'], ['code', 'varchar(20)'], ['note', 'text'], ['amount', 'decimal(30,6)'], ['payload', 'blob'], ['optional', 'int']].map(([name, type]): ColumnInfo => ({ name, type, nullable: name === 'optional', defaultValue: null, extra: '', comment: '', generated: false }));
  return { database: 'db', name: 'subject', columns, primaryKey: ['id', 'code'], editableKey: ['id', 'code'], indexes: [{ name: 'PRIMARY', columns: ['id', 'code'], unique: true }], foreignKeys: [], engine: 'InnoDB', ddl: '' };
}
const original = (): DataRow => ({ id: maximum, code: 'A ', note: '😀old前old后old', amount: '12345678901234567890.123456', payload: binary, optional: null });

/** 用真实mysql2编码再解码COM_STMT_EXECUTE；不联网，直接检查实际协议值和NULL位图。 */
function wireRoundTrip(values: CellValue[]): unknown[] {
  const require = createRequire(import.meta.url), driver = dirname(require.resolve('mysql2'));
  const ExecutePacket = require(join(driver, 'lib/packets/execute.js')), Packet = require(join(driver, 'lib/packets/packet.js')), types = require(join(driver, 'lib/constants/types.js'));
  const params = values.map(deserializeCell), packet = new ExecutePacket(1, params, 45, 'Z').toPacket();
  const reader = new Packet(0, packet.buffer, 0, packet.buffer.length); reader.offset = 14;
  const bitmap = Array.from({ length: Math.ceil(params.length / 8) }, () => reader.readInt8()); expect(reader.readInt8()).toBe(1);
  const bindings = params.map(() => ({ type: reader.readInt8(), unsigned: reader.readInt8() }));
  return bindings.map((binding: { type: number }, index: number) => {
    if (binding.type === types.NULL) { expect(bitmap[index >> 3] & (1 << (index % 8))).not.toBe(0); return null; }
    expect(bitmap[index >> 3] & (1 << (index % 8))).toBe(0);
    expect([types.VAR_STRING, types.BLOB]).toContain(binding.type);
    const bytes = reader.readLengthCodedBuffer(); return binding.type === types.BLOB ? { hex: bytes.toString('hex') } : bytes.toString('utf8');
  });
}

describe('可靠键去重复后的完整原行与真实驱动参数', () => {
  it('更新复合主键仍用before定位，SET和各原值按实际协议精确对应', () => {
    const before = original(), result = buildChanges(table(), [{ kind: 'update', before, values: { id: adjacent, code: 'a', note: '😀$1新值' } }]).statements[0];
    expect(wireRoundTrip(result.params)).toEqual([adjacent, 'a', '😀$1新值', maximum, 'A ', 'A ', before.note, before.amount, { hex: '00ff' }, null]);
    expect(result.sql.match(/`id` <=> \?/g)).toHaveLength(1);
    expect(result.sql).toContain('`code` <=> ?'); expect(result.sql).toContain('BINARY CONVERT(`code` USING utf8mb4) <=> BINARY CONVERT(? USING utf8mb4)');
  });
  it('DELETE仍绑定复合旧键、非键DECIMAL/Unicode/BLOB/NULL全部原值', () => {
    const before = original(), result = buildChanges(table(), [{ kind: 'delete', before }]).statements[0];
    expect(wireRoundTrip(result.params)).toEqual([maximum, 'A ', 'A ', before.note, before.amount, { hex: '00ff' }, null]);
    expect(result.sql).toContain('`amount` <=> ? AND `payload` <=> ? AND `optional` <=> ?');
  });
  it.each(['char(20)', 'varchar(20)', "enum('a','A')", "set('a','A')"])('文本键%s保留大小写、尾空格和独立字节旧值，不能仅依赖CI/PAD索引匹配', type => {
    const info = table(); info.columns[1].type = type;
    const before = original(), result = buildChanges(info, [{ kind: 'update', before, values: { note: '新值' } }]).statements[0];
    expect(wireRoundTrip(result.params).filter(value => value === 'A ')).toHaveLength(2);
    expect(result.sql).toContain('BINARY CONVERT(`code` USING utf8mb4) <=> BINARY CONVERT(? USING utf8mb4)');
    expect(result.params).not.toContain('a'); expect(result.params).not.toContain('A');
  });
  it.each(['bigint unsigned', 'int', 'decimal(30,6)', 'varbinary(8)', 'datetime(6)', 'bit(64)'])('单个非文本可靠键%s只绑定一份旧值，INSERT和非键保护不受影响', type => {
    const value: CellValue = type.startsWith('bit') || type.startsWith('varbinary') ? binary : type.startsWith('datetime') ? '2026-10-16 08:00:00.123456' : '1';
    const info = table(); info.columns = [{ ...info.columns[0], type }]; info.primaryKey = info.editableKey = ['id'];
    const result = buildChanges(info, [{ kind: 'update', before: { id: value }, values: { id: value } }, { kind: 'delete', before: { id: value } }, { kind: 'insert', values: { id: value } }]);
    expect(result.statements.map(statement => statement.params)).toEqual([[value, value], [value], [value]]);
  });
  it('DECIMAL末位差异不经过Number，实际编码保留每一位', () => {
    const before = original(); before.amount = '12345678901234567890.123457';
    const result = buildChanges(table(), [{ kind: 'update', before, values: { note: '新值' } }]).statements[0];
    expect(wireRoundTrip(result.params)).toContain(before.amount); expect(result.params).not.toContain('12345678901234567890.123456');
  });
  it('任意非键原值缺失、可靠键为NULL或缺失、无可靠键仍拒绝', () => {
    for (const name of ['note', 'amount', 'payload', 'optional', 'id', 'code']) { const before = original(); delete before[name]; expect(() => buildChanges(table(), [{ kind: 'delete', before }])).toThrow('缺少完整原始行'); }
    for (const name of ['id', 'code']) { const before = original(); before[name] = null; expect(() => buildChanges(table(), [{ kind: 'delete', before }])).toThrow('唯一键不得为空'); }
    expect(() => buildChanges({ ...table(), editableKey: [] }, [{ kind: 'delete', before: original() }])).toThrow('唯一键');
  });
});
