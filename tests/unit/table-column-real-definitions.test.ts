import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseTableColumnDefinition } from '../../src/engine/tableColumnDefinition';
import { buildTableColumnPatchSql } from '../../src/engine/tableColumnPatchSql';
import { splitSql } from '../../src/engine/sql';
import { columnPatchAccess, type ColumnPatch, type TableDefinitionContext } from '../../src/shared/tableColumnPatches';

interface RealDefinition {
  id: string; file: string; purpose: string; dialect: 'mysql' | 'mariadb'; version: string;
  sqlMode: string; sha256: string; bytes: number; completeDefinition: boolean;
}
const fixtureDirectory = join(import.meta.dirname, '../fixtures/table-column-definitions');
const fixtures = (JSON.parse(readFileSync(join(fixtureDirectory, 'manifest.json'), 'utf8')) as { entries: RealDefinition[] }).entries;

/** 严格沿用每份真实输出的模式；不假定 ANSI 引号与普通字符串可以互换。 */
function read(fixture: RealDefinition) {
  const modes = new Set(fixture.sqlMode.split(','));
  const context: TableDefinitionContext = { dialect: fixture.dialect, mode: { ansiQuotes: modes.has('ANSI_QUOTES'), noBackslashEscapes: modes.has('NO_BACKSLASH_ESCAPES') } };
  const source = readFileSync(join(fixtureDirectory, fixture.file), 'utf8');
  return { source, document: parseTableColumnDefinition(source, context), context };
}

/** 此处引用由单测生成并与真实列名分离，避免把服务端名称误当生产能力令牌。 */
function plan(fixture: RealDefinition, name: string, changes: Extract<ColumnPatch, { kind: 'alter' }>['changes']) {
  const value = read(fixture);
  const refs = new Map(value.document.columns.map((column, index) => [`fixture-ref-${index}`, column.name]));
  const columnRef = [...refs].find(([, columnName]) => columnName === name)?.[0];
  if (!columnRef) throw new Error('测试目标列不存在于真实夹具');
  return { ...value, result: buildTableColumnPatchSql(value.document, [{ kind: 'alter', columnRef, changes }], { database: 'fixture_schema', serverVersion: fixture.version, columnRefs: refs }) };
}

/** 按已知用途选择唯一夹具，缺失或重复时不悄悄测试另一个版本。 */
function one(purpose: string) {
  const matches = fixtures.filter(fixture => fixture.purpose === purpose);
  if (matches.length !== 1) throw new Error('预期唯一用途夹具：' + purpose);
  return matches[0];
}

describe('有限真实 SHOW CREATE 夹具的读取和纯规划回归', () => {
  it('十五份结构保持采集时原字节 SHA，不含运行环境、随机库或插入数据', () => {
    expect(fixtures).toHaveLength(15);
    for (const fixture of fixtures) {
      const bytes = readFileSync(join(fixtureDirectory, fixture.file));
      expect(bytes.length, fixture.id).toBe(fixture.bytes);
      expect(createHash('sha256').update(bytes).digest('hex'), fixture.id).toBe(fixture.sha256);
      expect(bytes.toString('utf8'), fixture.id).not.toMatch(/dbark_colresearch_|192\.168\.|DBARK_TEST_|\bINSERT\s+INTO\b/i);
    }
  });

  it.each(fixtures.filter(fixture => fixture.purpose === 'combined'))('$version 普通列单改不重述时间、生成列、前缀索引及 CHECK', fixture => {
    const { source, document, context, result } = plan(fixture, 'ordinary', { comment: '新版字段说明' });
    const ordinary = document.columnsByName.get('ordinary')!;
    expect(ordinary.default).toMatchObject({ kind: 'literal', valueType: 'text', value: 'NULL' });
    expect(document.columnsByName.get('computed')?.attributes.some(attribute => attribute.kind === 'generated')).toBe(true);
    expect(columnPatchAccess(document.columnsByName.get('computed')!, fixture.dialect).comment.editable).toBe(false);
    expect(document.columnsByName.get('ts')?.attributes.some(attribute => attribute.kind === 'on-update')).toBe(true);
    expect(result.clauses).toHaveLength(1);
    expect(splitSql(result.sql, context.mode.noBackslashEscapes, context.mode.ansiQuotes)).toHaveLength(1);
    expect(result.sql).toContain("CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT 'NULL' COMMENT '新版字段说明'");
    expect(result.sql).not.toMatch(/`(?:ts|computed|amount|idx_ordinary)`|\b(?:CHECK|ENGINE|DROP|CHANGE)\b/);
    expect(result.preserved.constraints.join('\n')).toContain('`ordinary`(8)');
    expect(result.preserved.constraints.join('\n').includes('CHECK')).toBe(!fixture.version.startsWith('5.7.'));
    expect(result.preserved.columns.join('\n')).toMatch(/ON UPDATE CURRENT_TIMESTAMP\(6\)/i);
    expect(result.preserved.columns.join('\n')).toContain('GENERATED ALWAYS');
    expect(result.preserved.tail).toBe(source.slice(document.tail.range.start));
    expect(document.source).toBe(source);
  });

  it.each(fixtures.filter(fixture => ['functional-index', 'invisible-column', 'partition'].includes(fixture.purpose)))('$purpose 复杂旁列或表尾不进入普通列注释 DDL', fixture => {
    const target = fixture.purpose === 'invisible-column' ? 'ordinary' : 'id';
    const { document, result } = plan(fixture, target, { comment: '仅改普通列' });
    expect(result.clauses).toHaveLength(1);
    expect(result.sql).toContain("COMMENT '仅改普通列'");
    expect(result.clauses[0]).not.toMatch(/\bPARTITION\b|\bINVISIBLE\b|idx_function|lower\s*\(/i);
    if (fixture.purpose === 'functional-index') expect(result.preserved.constraints.join('\n')).toMatch(/idx_function.*lower/i);
    if (fixture.purpose === 'partition') expect(result.preserved.tail).toMatch(/PARTITION BY RANGE/);
    if (fixture.purpose === 'invisible-column') {
      expect(result.preserved.columns.join('\n')).toContain('/*!80023 INVISIBLE */');
      expect(columnPatchAccess(document.columnsByName.get('hidden_value')!, fixture.dialect).comment.editable).toBe(false);
    }
  });

  it.each(fixtures.filter(fixture => fixture.purpose === 'maria-unsafe-expression'))('$version 风险默认值触发整表保护，只允许完整覆盖风险的专用默认值修改', fixture => {
    const { document } = read(fixture);
    const value = document.columnsByName.get('v')!;
    expect(value.default.kind).toBe('expression');
    const access = columnPatchAccess(value, fixture.dialect);
    expect(access.comment.editable).toBe(false);
    expect(() => plan(fixture, 'v', { comment: '不能重述该表达式' })).toThrow('任意字段 ALTER');
    expect(() => plan(fixture, 'v', { type: { kind: 'string', type: 'VARCHAR', length: 90 } })).toThrow('任意字段 ALTER');
    expect(() => plan(fixture, 'v', { name: 'renamed', default: { kind: 'none' } })).toThrow('任意字段 ALTER');
    expect(plan(fixture, 'v', { default: { kind: 'literal', valueType: 'text', value: '新默认值' } }).result.sql).toBe("ALTER TABLE `fixture_schema`.`collate_function_expression`\nALTER COLUMN `v` SET DEFAULT '新默认值'\n;");
    expect(plan(fixture, 'v', { default: { kind: 'none' } }).result.sql).toBe('ALTER TABLE `fixture_schema`.`collate_function_expression`\nALTER COLUMN `v` DROP DEFAULT\n;');
    expect(() => plan(fixture, 'v', { name: 'renamed' })).toThrow('任意字段 ALTER');
    expect(() => plan(fixture, 'id', { comment: '旁列也会触发内部重述' })).toThrow('任意字段 ALTER');
    expect(() => plan(fixture, 'id', { name: 'renamed_id' })).toThrow('任意字段 ALTER');
    // run04/05 已证原生改名和旁列 ALTER 也会改变未指定默认值；旧纯规划通过并非语义保真证据。
    expect(document.source).toContain("_utf8mb4'xC3x80'");
  });

  it('ANSI 输出缺失是来源限制：解析不能恢复索引注释和表选项，AUTO_INCREMENT 实际仍保留', () => {
    const complete = read(one('ansi-full')), incomplete = read(one('ansi-incomplete'));
    expect(one('ansi-incomplete').completeDefinition).toBe(false);
    expect(incomplete.context.mode.ansiQuotes).toBe(true);
    expect(complete.source).toContain("COMMENT '索引注释'");
    expect(complete.source).toContain("COMMENT='表注释'");
    expect(incomplete.source).not.toContain('索引注释');
    expect(incomplete.document.tail.raw.trim()).toBe(')');
    expect(incomplete.document.columnsByName.get('id')?.attributes.some(attribute => attribute.kind === 'auto-increment')).toBe(true);
    expect(incomplete.document.items.filter(item => item.kind === 'constraint').map(item => item.raw).join('\n')).not.toContain('索引注释');
    // 不调用计划器模拟“完整读取成功”；生产任务须移除兼容聚合模式并再次取完整定义。
  });

  it('实际普通默认值保留空串/文字 NULL/SQL NULL、精确数字及合法原型同名字段', () => {
    const { document } = read(one('literal-defaults'));
    expect(document.columnsByName.get('empty_text')?.default).toMatchObject({ kind: 'literal', valueType: 'text', value: '' });
    expect(document.columnsByName.get('text_null')?.default).toMatchObject({ kind: 'literal', valueType: 'text', value: 'NULL' });
    expect(document.columnsByName.get('explicit_null')?.default).toEqual({ kind: 'null' });
    expect(document.columnsByName.get('wide_integer')?.default).toMatchObject({ kind: 'literal', value: '18446744073709551615' });
    expect(document.columnsByName.get('exact_decimal')?.default).toMatchObject({ kind: 'literal', value: '-123456789012345678.123456789012' });
    expect(document.columnsByName.get('bits')?.default).toMatchObject({ kind: 'literal', valueType: 'binary', encoding: 'bits', value: '1011010' });
    expect(document.columnsByName.get('__proto__')?.name).toBe('__proto__');
    expect(plan(one('literal-defaults'), '__proto__', { comment: '合法字段' }).result.sql).toContain('`__proto__`');
    expect(document.columnsByName.get('constructor')?.name).toBe('constructor');
  });

  it('文字后的 COLLATE 实际属于列：规范输出按列属性读取', () => {
    const { document } = read(one('column-collation'));
    const value = document.columnsByName.get('v')!;
    expect(value.default).toMatchObject({ kind: 'literal', valueType: 'text', value: 'AbC' });
    expect(value.attributes.find(attribute => attribute.kind === 'collation')?.raw).toBe('COLLATE utf8mb4_bin');
    expect(plan(one('column-collation'), 'v', { default: { kind: 'none' } }).result.sql).toBe('ALTER TABLE `fixture_schema`.`collate_after_literal`\nALTER COLUMN `v` DROP DEFAULT\n;');
  });

  it('括号内 COLLATE 保持在表达式范围，独立改名不重述默认表达式', () => {
    const fixture = one('expression-collation'), { document } = read(fixture);
    const value = document.columnsByName.get('v')!;
    expect(value.default).toMatchObject({ kind: 'expression', sql: "((_utf8mb4'AbC' collate utf8mb4_bin))" });
    expect(value.attributes.find(attribute => attribute.kind === 'collation')?.raw).toBe('COLLATE utf8mb4_unicode_ci');
    expect(plan(fixture, 'v', { name: 'renamed' }).result.sql).toBe('ALTER TABLE `fixture_schema`.`collate_inside_expression`\nRENAME COLUMN `v` TO `renamed`\n;');
  });
});
