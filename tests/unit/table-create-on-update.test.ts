import { describe, expect, it } from 'vitest';
import { tableCreateDraftSchema, tableCreateLegacyDesign } from '../../src/shared/tableCreate';
import { assertTableCreateOnUpdateVersion, tableCreateOnUpdateExtraMatches, tableCreateOnUpdateSql, type TableCreateTimeColumn } from '../../src/shared/tableCreateOnUpdate';
import { validateCommand } from '../../src/shared/validation';
import { buildDesign, buildPrefixTableDesign } from '../../src/engine/sql';

/** 只构造新表草稿，不访问文件、网络、驱动或系统剪贴板。 */
function draft(type = 'DATETIME(3)', defaultValue: string | null | undefined = 'CURRENT_TIMESTAMP(3)') {
  return { database: 'db', name: 't', engine: 'InnoDB', charset: 'utf8mb4', comment: '', columns: [{ name: 'updated_at', type, nullable: true, autoIncrement: false, defaultValue, comment: '', onUpdate: { kind: 'expression' as const, expression: 'current-timestamp' as const, precision: Number(/\((\d)\)/.exec(type)?.[1] ?? 0) } }], indexes: [], foreignKeys: [] };
}
describe('新表显式自动更新时间合同与SQL（离线）', () => {
  it.each(['DATETIME', 'TIMESTAMP'])('%s的0/3/6精度、NULL及明确不附加均保持', type => {
    for (const precision of [0, 3, 6]) {
      const value = draft(`${type}(${precision})`, precision ? `CURRENT_TIMESTAMP(${precision})` : 'CURRENT_TIMESTAMP');
      const parsed = tableCreateDraftSchema.parse(value), sql = buildDesign(tableCreateLegacyDesign(parsed)).sql;
      expect(sql).toContain('ON UPDATE CURRENT_TIMESTAMP' + (precision ? `(${precision})` : ''));
      expect(value.columns[0].onUpdate.precision).toBe(precision);
      const input = { ...value, columns: [{ ...value.columns[0], defaultValue: null, onUpdate: null }] };
      expect(buildDesign(tableCreateLegacyDesign(tableCreateDraftSchema.parse(input))).sql).not.toContain('ON UPDATE');
    }
  });
  it.each([
    { onUpdate: 'CURRENT_TIMESTAMP' }, { onUpdate: undefined }, { onUpdate: { kind: 'expression', expression: 'NOW()' } },
    { onUpdate: { kind: 'expression', expression: 'current-timestamp', precision: '3' } }, { onUpdate: { kind: 'expression', expression: 'current-timestamp', precision: 7 } },
    { onUpdate: { kind: 'expression', expression: 'current-timestamp', precision: 6 } }, { onUpdate: { kind: 'expression', expression: 'current-timestamp', sql: 'DROP TABLE t' } },
    { type: 'DATE' }, { type: 'VARCHAR(40)' }, { type: 'DATETIME(3) ON UPDATE NOW()' }, { autoIncrement: true },
    { defaultValue: undefined }, { defaultValue: 'CURRENT_TIMESTAMP' }, { defaultValue: 'CURRENT_TIMESTAMP(6)' }, { defaultValue: 'CURRENT_TIME(3)' },
    { defaultValue: 'NOW(3)' }, { defaultValue: '(CURRENT_TIMESTAMP(3))' }, { defaultValue: '2026-10-18 00:00:00.000' }, { defaultValue: null, nullable: false },
  ])('拒绝非法新字段组合：%j', patch => { const value = draft(); expect(() => tableCreateDraftSchema.parse({ ...value, columns: [{ ...value.columns[0], ...patch }] })).toThrow(); });
  it('IPC保留结构化新键，拒绝任意表达式和旧整表ALTER入口', () => {
    const input = { snapshotId: crypto.randomUUID(), taskId: crypto.randomUUID(), design: draft() };
    expect(validateCommand('schema.tableCreate.preview', input)).toEqual(input);
    expect(() => validateCommand('schema.preview', { connectionId: 'c', design: { ...draft(), originalName: 't' } })).toThrow();
    expect(() => buildDesign({ ...draft(), originalName: 't' })).toThrow('旧整表ALTER');
  });
  it.each([['mysql', '5.7.44'], ['mysql', '8.0.46'], ['mysql', '8.4.11'], ['mariadb', '10.11.19-MariaDB'], ['mariadb', '11.4.13-MariaDB']] as const)('复用已有准确版本门%s/%s', (dialect, version) => {
    expect(() => assertTableCreateOnUpdateVersion(draft().columns, dialect, version)).not.toThrow();
  });
  it.each([['mysql', '5.7.43'], ['mysql', '8.0.45'], ['mysql', '8.4.12'], ['mysql', ''], ['mariadb', '11.4.14']] as const)('未知或非受控版本%s/%s拒绝，但旧省略调用不受新增限制', (dialect, version) => {
    expect(() => assertTableCreateOnUpdateVersion(draft().columns, dialect, version)).toThrow('服务器版本');
    const value = { ...draft().columns[0] } as TableCreateTimeColumn; delete value.onUpdate;
    expect(() => assertTableCreateOnUpdateVersion([value], dialect, version)).not.toThrow();
  });
  it('省略键保持旧SQL，省略对象精度继承字段，不把未指定变成显式null', () => {
    const value = draft(); const column = { ...value.columns[0] } as TableCreateTimeColumn & { name: string; comment: string }; delete column.onUpdate;
    const legacy = { ...value, columns: [column] }, parsed = tableCreateDraftSchema.parse(legacy);
    expect(Object.hasOwn(parsed.columns[0], 'onUpdate')).toBe(false); expect(buildDesign(tableCreateLegacyDesign(parsed)).sql).not.toContain('ON UPDATE');
    const inherited = { ...column, onUpdate: { kind: 'expression' as const, expression: 'current-timestamp' as const } }; expect(tableCreateOnUpdateSql(inherited)).toBe(' ON UPDATE CURRENT_TIMESTAMP(3)');
  });
  it('前缀新表也通过同一列生成器，属性不被索引分支丢弃', () => {
    const value = draft(); const design = { ...value, columns: [...value.columns, { name: 'note', type: 'VARCHAR(40)', nullable: true, autoIncrement: false, comment: '' }], indexes: [{ name: 'ix_note', unique: false, keyParts: [{ columnName: 'note', prefixLength: 5 }] }] };
    expect(buildPrefixTableDesign(design, { dialect: 'mysql', serverVersion: '8.4.11', pageSize: 16384, defaultRowFormat: 'DYNAMIC', charsets: [{ name: 'utf8mb4', maxBytes: 4 }], digest: 'a'.repeat(64) }).sql).toContain('ON UPDATE CURRENT_TIMESTAMP(3)');
  });
  it('EXTRA同时识别真实自动属性及默认生成标记，遗漏/精度/未知后缀不核验成功', () => {
    const column = draft().columns[0]; expect(tableCreateOnUpdateExtraMatches(column, 'DEFAULT_GENERATED on update CURRENT_TIMESTAMP(3)')).toBe(true);
    for (const value of ['', 'on update CURRENT_TIMESTAMP(6)', 'on update CURRENT_TIMESTAMP(3) VIRTUAL GENERATED', null, 'DEFAULT_GENERATED DEFAULT_GENERATED on update CURRENT_TIMESTAMP(3)']) expect(tableCreateOnUpdateExtraMatches(column, value)).toBe(false);
    expect(tableCreateOnUpdateExtraMatches({ ...column, onUpdate: null }, 'DEFAULT_GENERATED')).toBe(true);
    expect(tableCreateOnUpdateExtraMatches({ ...column, onUpdate: null }, 'on update CURRENT_TIMESTAMP(3)')).toBe(false);
  });
});
