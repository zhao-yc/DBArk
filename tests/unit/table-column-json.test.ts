import { describe, expect, it } from 'vitest';
import { parseTableColumnDefinition, editableColumnType } from '../../src/engine/tableColumnDefinition';
import { buildTableColumnPatchSql } from '../../src/engine/tableColumnPatchSql';
import { columnTypePatchSchema, type ColumnPatch, type TableDefinitionContext } from '../../src/shared/tableColumnPatches';
import { defaultColumnType, columnTypeLabel } from '../../src/renderer/columnPatches';

const context = (dialect: 'mysql' | 'mariadb'): TableDefinitionContext => ({ dialect, mode: { ansiQuotes: false, noBackslashEscapes: false } });
const field = (sql: string, dialect: 'mysql' | 'mariadb' = 'mariadb') => parseTableColumnDefinition('CREATE TABLE t (' + sql + ') ENGINE=InnoDB', context(dialect)).columns[0];
const patch = (): Extract<ColumnPatch, { kind: 'add' }> => ({ kind: 'add', clientKey: 'json-field', name: '文`档', type: { kind: 'json' }, nullable: true, default: { kind: 'none' }, comment: 'JSON字段', position: { kind: 'last' } });
/** 只生成受控计划；不读取目录或执行SQL。 */
function plan(value: ColumnPatch, dialect: 'mysql' | 'mariadb', version: string) {
  const document = parseTableColumnDefinition('CREATE TABLE t(id INT NOT NULL) ENGINE=InnoDB', context(dialect));
  return buildTableColumnPatchSql(document, [value], { database: 'db', serverVersion: version, columnRefs: new Map([['id', 'id']]) });
}
describe('结构化JSON字段及MariaDB别名的完整证明', () => {
  it('共享合同只接受JSON判别项，前端默认和摘要沿同一模型', () => {
    expect(columnTypePatchSchema.parse({ kind: 'json' })).toEqual({ kind: 'json' }); expect(() => columnTypePatchSchema.parse({ kind: 'json', sql: 'JSON; DROP TABLE t' })).toThrow();
    expect(defaultColumnType('json')).toEqual({ kind: 'json' }); expect(columnTypeLabel({ kind: 'json' })).toBe('JSON');
  });
  it.each([['mysql', '5.7.44'], ['mysql', '8.0.42'], ['mysql', '8.4.11'], ['mariadb', '10.11.19'], ['mariadb', '11.4.8']] as const)('%s %s生成准确JSON新增，名称仍按标识符转义', (dialect, version) => {
    const actual = plan(patch(), dialect, version); expect(actual.sql).toContain('`文``档` JSON NULL'); expect(actual.sql).not.toContain('LONGTEXT');
  });
  it('JSON字面默认值和时间表达式不借MariaDB LONGTEXT语法绕过；NOT NULL不能DEFAULT NULL', () => {
    for (const dialect of ['mysql', 'mariadb'] as const) for (const value of [{ kind: 'literal', valueType: 'text', value: '{}' }, { kind: 'expression', expression: 'current-timestamp' }]) expect(() => plan({ ...patch(), default: value as any }, dialect, dialect === 'mysql' ? '8.4.11' : '10.11.19')).toThrow();
    expect(() => plan({ ...patch(), nullable: false, default: { kind: 'null' } }, 'mysql', '8.4.11')).toThrow(); expect(() => plan(patch(), 'mysql', '5.7.7')).toThrow('原生JSON');
  });
  it('MySQL原生JSON不从字符串外观猜；MariaDB必须证明固定编码和完整本列校验', () => {
    expect(editableColumnType(field('j JSON', 'mysql'), context('mysql'))).toEqual({ kind: 'json' });
    const valid = field('j LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin CHECK (json_valid(`j`))'); expect(editableColumnType(valid, context('mariadb'))).toEqual({ kind: 'json' });
    expect(editableColumnType(valid, context('mariadb'), { charset: 'utf8mb4', collation: 'utf8mb4_general_ci' })).toEqual({ kind: 'large', type: 'LONGTEXT' });
    for (const check of ['', 'CHECK (json_valid(other))', 'CHECK (json_valid(j) OR 1)', 'CHECK (not_json_valid(j))']) expect(editableColumnType(field('j LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin ' + check), context('mariadb'))).toEqual({ kind: 'large', type: 'LONGTEXT' });
  });
  it('SHOW CREATE省略继承编码时只接受可信完整目录配对，不借用表默认值', () => {
    const value = field('j LONGTEXT CHECK (json_valid(j))'); expect(editableColumnType(value, context('mariadb'))).toEqual({ kind: 'large', type: 'LONGTEXT' });
    expect(editableColumnType(value, context('mariadb'), { charset: 'utf8mb4', collation: 'utf8mb4_bin' })).toEqual({ kind: 'json' });
    expect(editableColumnType(value, context('mariadb'), { charset: null, collation: null })).toEqual({ kind: 'large', type: 'LONGTEXT' });
  });
});
