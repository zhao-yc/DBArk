import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import manifest from '../fixtures/table-foreign-key-patches/manifest.json';
import { parseTableColumnDefinition } from '../../src/engine/tableColumnDefinition';
import { readTableForeignKeyDefinition } from '../../src/engine/tableForeignKeyDefinition';
import type { TableDefinitionContext } from '../../src/shared/tableColumnPatches';

const mysql: TableDefinitionContext = { dialect: 'mysql', mode: { ansiQuotes: false, noBackslashEscapes: false } };
/** 纯解析只验证输入语义与原范围，不替代数据库 DDL 或数据行为验收。 */
function read(sql: string, version = '8.4.11', context = mysql) {
  return readTableForeignKeyDefinition(parseTableColumnDefinition(sql, context), 'db', version);
}
const table = (constraint: string): string => `CREATE TABLE t (a int, b int, KEY k(a,b), ${constraint}) ENGINE=InnoDB`;

describe('外键原定义的有序语义与保守完整性', () => {
  it.each(manifest.entries)('真实自主结构与独立 RC/KCU 对应：$id', fixture => {
    const directory = 'tests/fixtures/table-foreign-key-patches';
    const ddl = readFileSync(resolve(directory, fixture.file)), metadata = readFileSync(resolve(directory, fixture.metadataFile));
    expect(createHash('sha256').update(ddl).digest('hex')).toBe(fixture.ddl.publishedSha256);
    expect(createHash('sha256').update(metadata).digest('hex')).toBe(fixture.metadata.publishedSha256);
    expect(ddl.length).toBe(fixture.ddl.bytes);
    const catalog = JSON.parse(metadata.toString('utf8')) as {
      table: { schema: string; name: string };
      rc: { CONSTRAINT_NAME: string; UPDATE_RULE: string; DELETE_RULE: string }[];
      kcu: { CONSTRAINT_NAME: string; ORDINAL_POSITION: number | string; COLUMN_NAME: string; REFERENCED_TABLE_SCHEMA: string | null; REFERENCED_TABLE_NAME: string | null; REFERENCED_COLUMN_NAME: string | null }[];
    };
    const context: TableDefinitionContext = { dialect: fixture.dialect as 'mysql' | 'mariadb', mode: { ansiQuotes: fixture.session.sqlMode.split(',').includes('ANSI_QUOTES'), noBackslashEscapes: fixture.session.sqlMode.split(',').includes('NO_BACKSLASH_ESCAPES') } };
    const document = parseTableColumnDefinition(ddl.toString('utf8'), context);
    const result = readTableForeignKeyDefinition(document, catalog.table.schema, fixture.version);
    expect(result.complete).toBe(true); expect(result.foreignKeys).toHaveLength(catalog.rc.length);
    for (const key of result.foreignKeys) {
      const rules = catalog.rc.filter(row => row.CONSTRAINT_NAME === key.name);
      expect(rules).toHaveLength(1); expect([key.onUpdate, key.onDelete]).toEqual([rules[0].UPDATE_RULE, rules[0].DELETE_RULE]);
      const parts = catalog.kcu.filter(row => row.CONSTRAINT_NAME === key.name && row.REFERENCED_TABLE_NAME !== null).sort((a, b) => Number(a.ORDINAL_POSITION) - Number(b.ORDINAL_POSITION));
      expect(key.childColumnNames).toEqual(parts.map(row => row.COLUMN_NAME));
      expect(key.parentColumnNames).toEqual(parts.map(row => row.REFERENCED_COLUMN_NAME));
      expect(key.parentTarget).toEqual({ database: parts[0].REFERENCED_TABLE_SCHEMA, table: parts[0].REFERENCED_TABLE_NAME });
      expect(document.source.slice(key.range.start, key.range.end)).toBe(key.rawSql);
    }
  });
  it('跨库、复合顺序、两种动作和 UTF-16 原范围逐项保持', () => {
    const source = table('CONSTRAINT `关系``一` FOREIGN KEY (`b`,`a`) REFERENCES `父库`.`父表` (`pb`,`pa`) ON UPDATE CASCADE ON DELETE SET NULL');
    const result = read(source), key = result.foreignKeys[0];
    expect(result.complete).toBe(true); expect(result.unclassifiedConstraintRanges).toEqual([]);
    expect(key.name).toBe('关系`一'); expect(key.childColumnNames).toEqual(['b', 'a']);
    expect(key.parentTarget).toEqual({ database: '父库', table: '父表' }); expect(key.parentColumnNames).toEqual(['pb', 'pa']);
    expect([key.onUpdate, key.onDelete]).toEqual(['CASCADE', 'SET NULL']);
    expect(source.slice(key.range.start, key.range.end)).toBe(key.rawSql);
  });
  it.each([
    ['5.7.44', mysql, 'RESTRICT'], ['8.0.46', mysql, 'NO ACTION'], ['8.4.11', mysql, 'NO ACTION'],
    ['10.11.19-MariaDB-ubu2204', { ...mysql, dialect: 'mariadb' as const }, 'RESTRICT'],
    ['11.4.13-MariaDB-ubu2404', { ...mysql, dialect: 'mariadb' as const }, 'RESTRICT'],
  ])('缺省动作仅按实证版本读取：%s', (version, context, expected) => {
    const result = read(table('CONSTRAINT fk FOREIGN KEY(a,b) REFERENCES p(pa,pb)'), version, context);
    expect(result.complete).toBe(true); expect(result.foreignKeys[0].parentTarget?.database).toBe('db');
    expect([result.foreignKeys[0].onUpdate, result.foreignKeys[0].onDelete]).toEqual([expected, expected]);
  });
  it('未知版本的隐式动作保持未知，显式动作不被默认值覆盖', () => {
    const implicit = read(table('CONSTRAINT fk FOREIGN KEY(a) REFERENCES p(pa) ON UPDATE CASCADE'), '8.4.99');
    expect(implicit.complete).toBe(false); expect(implicit.foreignKeys[0].onUpdate).toBe('CASCADE');
    expect(implicit.foreignKeys[0].onDelete).toBeUndefined();
    const explicit = read(table('CONSTRAINT fk FOREIGN KEY(a) REFERENCES p(pa) ON DELETE RESTRICT ON UPDATE NO ACTION'), '8.4.99');
    expect(explicit.complete).toBe(true); expect([explicit.foreignKeys[0].onUpdate, explicit.foreignKeys[0].onDelete]).toEqual(['NO ACTION', 'RESTRICT']);
  });
  it('显式外键索引名不能冒充约束名', () => {
    const result = read(table('CONSTRAINT actual FOREIGN KEY ignored_index(a) REFERENCES p(pa)'));
    expect(result.complete).toBe(true); expect(result.foreignKeys[0].name).toBe('actual');
    expect(result.foreignKeys[0].childColumnNames).toEqual(['a']);
  });
  it('自引用和原型敏感名称使用数组及可信名称，保持原样', () => {
    const result = read('CREATE TABLE `t` (`__proto__` int, `constructor` int, CONSTRAINT `toString` FOREIGN KEY (`constructor`) REFERENCES `t` (`__proto__`))');
    expect(result.complete).toBe(true); expect(result.foreignKeys[0].name).toBe('toString');
    expect(result.foreignKeys[0].parentTarget).toEqual({ database: 'db', table: 't' });
  });
  it('ANSI_QUOTES 和 NBE 引用名不按普通引号或反斜杠处理', () => {
    const result = read('CREATE TABLE "t" ("a\\" int, CONSTRAINT "f\\" FOREIGN KEY ("a\\") REFERENCES "p\\" ("id\\"))', '8.4.11', { ...mysql, mode: { ansiQuotes: true, noBackslashEscapes: true } });
    expect(result.complete).toBe(true); expect(result.foreignKeys[0].name).toBe('f\\');
    expect(result.foreignKeys[0].childColumnNames).toEqual(['a\\']); expect(result.foreignKeys[0].parentTarget?.table).toBe('p\\');
  });
  it('普通注释、字符串及引用关键字不会伪造外键', () => {
    const result = read("CREATE TABLE t (a int COMMENT 'FOREIGN KEY(a) REFERENCES x(a)', e enum('CONSTRAINT x FOREIGN KEY(a)'), KEY `FOREIGN` (a), CONSTRAINT `CHECK` CHECK(a>0)) /* FOREIGN KEY(a) REFERENCES q(a) */");
    expect(result.complete).toBe(true); expect(result.foreignKeys).toEqual([]);
  });
  it.each([
    'FOREIGN KEY(a) REFERENCES p(pa)',
    'CONSTRAINT fk FOREIGN KEY(a,a) REFERENCES p(pa,pb)',
    'CONSTRAINT fk FOREIGN KEY(a(1)) REFERENCES p(pa)',
    'CONSTRAINT fk FOREIGN KEY(a DESC) REFERENCES p(pa)',
    'CONSTRAINT fk FOREIGN KEY(a,b) REFERENCES p(pa)',
    'CONSTRAINT fk FOREIGN KEY(a) REFERENCES p(pa,pb)',
    'CONSTRAINT fk FOREIGN KEY(a) REFERENCES p(pa) MATCH SIMPLE',
    'CONSTRAINT fk FOREIGN KEY(a) REFERENCES p(pa) ON DELETE SET DEFAULT',
    'CONSTRAINT fk FOREIGN KEY(a) REFERENCES p(pa) ON UPDATE CASCADE ON UPDATE RESTRICT',
    'CONSTRAINT fk FOREIGN KEY(a) REFERENCES p(pa) /*!80000 ON DELETE CASCADE */',
    'CONSTRAINT fk FOREIGN KEY(a) REFERENCES p(pa) UNKNOWN_ATTRIBUTE',
  ])('未知或不完整属性保留原片段，不能给出完整出向证明：%s', constraint => {
    const source = table(constraint), result = read(source);
    expect(result.complete).toBe(false); expect(result.foreignKeys).toHaveLength(1);
    expect(result.foreignKeys[0].opaqueReasons.length).toBeGreaterThan(0);
    expect(result.foreignKeys[0].rawSql).toBe(' ' + constraint);
  });
  it('约束前缀中的可执行注释不能被漏计为零外键', () => {
    const result = read(table('CONSTRAINT fk /*!80000 FOREIGN KEY(a) REFERENCES p(pa) */'));
    expect(result.complete).toBe(false); expect(result.unclassifiedConstraintRanges).toHaveLength(1);
  });
  it.each([
    'CREATE TABLE t (a int REFERENCES p(id))',
    'CREATE TABLE t (a int CONSTRAINT fk REFERENCES p(id))',
    'CREATE TABLE t (a int, CONSTRAINT fk UNKNOWN_KIND(a))',
  ])('未分类内联引用或陌生约束不能伪造没有外键：%s', source => {
    const result = read(source);
    expect(result.complete).toBe(false); expect(result.foreignKeys).toEqual([]);
    expect(result.unclassifiedConstraintRanges).toHaveLength(1);
  });
  it('重复约束名、32项以上元组保持不完整；超过256条拒绝而非截断', () => {
    const duplicated = read(table('CONSTRAINT fk FOREIGN KEY(a) REFERENCES p(pa), CONSTRAINT fk FOREIGN KEY(b) REFERENCES p(pb)'));
    expect(duplicated.complete).toBe(false); expect(duplicated.foreignKeys.every(key => key.opaqueReasons.length > 0)).toBe(true);
    const columns = Array.from({ length: 33 }, (_, position) => `a${position}`);
    expect(read(table(`CONSTRAINT fk FOREIGN KEY(${columns.join(',')}) REFERENCES p(${columns.join(',')})`)).complete).toBe(false);
    const many = Array.from({ length: 257 }, (_, position) => `CONSTRAINT f${position} FOREIGN KEY(a) REFERENCES p(pa)`);
    expect(() => read(table(many.join(',')))).toThrow('256');
  });
  it('数据库身份矛盾拒绝读取，不能把有资格名重新绑定到当前库', () => {
    const document = parseTableColumnDefinition('CREATE TABLE other.t (a int)', mysql);
    expect(() => readTableForeignKeyDefinition(document, 'db', '8.4.11')).toThrow('数据库');
  });
});
