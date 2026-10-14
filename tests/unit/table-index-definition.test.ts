import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import manifest from '../fixtures/table-index-definitions/manifest.json';
import { parseTableColumnDefinition } from '../../src/engine/tableColumnDefinition';
import { editableIndexDefinition, readTableIndexDefinition } from '../../src/engine/tableIndexDefinition';
import type { TableDefinitionContext } from '../../src/shared/tableColumnPatches';
import type { TrustedIndexColumn } from '../../src/shared/tableIndexPatches';

const mysql: TableDefinitionContext = { dialect: 'mysql', mode: { ansiQuotes: false, noBackslashEscapes: false } };
/** 本文件只提供纯读取输入，不将静态 SHOW CREATE 夹具视为实际执行验证。 */
function read(source: string, context = mysql) { return readTableIndexDefinition(parseTableColumnDefinition(source, context)); }

describe('索引原片段读取', () => {
  it.each(manifest.entries)('真实五基线夹具 $id 与其原 STATISTICS 逐键对应', fixture => {
    // 原生研究夹具用于验证解析，不冒充产品 API 或新一轮数据库执行。
    const bytes = readFileSync(resolve('tests/fixtures/table-index-definitions', fixture.file));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(fixture.ddl.publishedSha256);
    const context: TableDefinitionContext = { dialect: fixture.dialect as 'mysql' | 'mariadb', mode: { noBackslashEscapes: fixture.session.sqlMode.split(',').includes('NO_BACKSLASH_ESCAPES'), ansiQuotes: fixture.session.sqlMode.split(',').includes('ANSI_QUOTES') } };
    const result = read(bytes.toString('utf8'), context);
    const statistics = JSON.parse(readFileSync(resolve('tests/fixtures/table-index-definitions', fixture.statisticsFile), 'utf8')) as { INDEX_NAME: string; COLUMN_NAME: string; SEQ_IN_INDEX: number | string; NON_UNIQUE: number | string; INDEX_TYPE: string; COLLATION: string | null; SUB_PART: number | string | null; INDEX_COMMENT: string }[];
    expect(result.indexes.map(index => index.name).sort()).toEqual([...new Set(statistics.map(row => row.INDEX_NAME))].sort());
    for (const index of result.indexes) {
      const rows = statistics.filter(row => row.INDEX_NAME === index.name).sort((left, right) => Number(left.SEQ_IN_INDEX) - Number(right.SEQ_IN_INDEX));
      expect(index.opaqueReasons).toEqual([]);
      expect(index.method).toBe(rows[0].INDEX_TYPE); expect(index.comment).toBe(rows[0].INDEX_COMMENT);
      expect(index.kind).toBe(index.name === 'PRIMARY' ? 'primary' : Number(rows[0].NON_UNIQUE) ? 'ordinary' : 'unique');
      expect(index.parts.map(part => [part.columnName, part.prefixLength ?? null, part.direction])).toEqual(rows.map(row => [row.COLUMN_NAME, row.SUB_PART === null ? null : Number(row.SUB_PART), row.COLLATION === 'D' ? 'desc' : 'asc']));
    }
  });
  it('保存列、外键、CHECK、分区和复杂字符串的原范围', () => {
    const source = "CREATE TABLE `t` (\n `a` int NOT NULL, `v` enum('a,b','KEY fake(x)') DEFAULT 'a,b',\n PRIMARY KEY (`a`), UNIQUE KEY `u` (`v`(2) DESC,`a` ASC) USING BTREE COMMENT '中,文 ''引号''\\\\路径', CONSTRAINT `fk` FOREIGN KEY (`a`) REFERENCES `p` (`id`), CONSTRAINT `ck` CHECK (`a` > 0)\n) ENGINE=InnoDB PARTITION BY HASH(`a`) PARTITIONS 2";
    const document = read(source);
    expect(document.indexes.map(index => index.name)).toEqual(['PRIMARY', 'u']);
    expect(document.indexes[1].parts.map(part => [part.columnName, part.prefixLength, part.direction])).toEqual([['v', 2, 'desc'], ['a', undefined, 'asc']]);
    expect(document.indexes[1].comment).toBe("中,文 '引号'\\路径");
    expect(document.indexes[1].opaqueReasons).toEqual([]);
    for (const index of document.indexes) expect(source.slice(index.range.start, index.range.end)).toBe(index.rawSql);
    expect(document.otherConstraintRanges.map(range => source.slice(range.start, range.end))).toEqual([expect.stringContaining('FOREIGN KEY'), expect.stringContaining('CHECK')]);
    expect(source.slice(document.tableTailRange.start, document.tableTailRange.end)).toContain('PARTITION BY');
  });
  it('名称引用、原型敏感名称和 Unicode 不进入普通对象查找', () => {
    const document = read('CREATE TABLE `t` (`__proto__` int, `构``造` int, KEY `constructor` (`__proto__`), KEY `键``名` (`构``造`))');
    expect(document.indexes.map(index => index.name)).toEqual(['constructor', '键`名']);
    expect(document.indexes[1].parts[0].columnName).toBe('构`造');
    const columns = new Map([['r1', { name: '__proto__' }], ['r2', { name: '构`造' }]]) as Map<string, TrustedIndexColumn>;
    expect(editableIndexDefinition(document.indexes[0], columns)?.keyParts[0].columnRef).toBe('r1');
  });
  it('ANSI_QUOTES 与 NBE 使用原词法模式读取注释和名称', () => {
    const context = { ...mysql, mode: { ansiQuotes: true, noBackslashEscapes: true } };
    const result = read('CREATE TABLE "t" ("a\\" int, KEY "i" ("a\\") COMMENT \'路径\\n\')', context);
    expect(result.indexes[0].parts[0].columnName).toBe('a\\');
    expect(result.indexes[0].comment).toBe('路径\\n');
  });
  it.each([
    'KEY i ((concat(a,\',\',a)))', 'KEY i (a) INVISIBLE', 'KEY i (a) IGNORED',
    'KEY i (a) /*!80000 INVISIBLE */', 'FULLTEXT KEY i (a)', 'SPATIAL KEY i (a)',
    'KEY i USING HASH (a)', 'KEY i (a) KEY_BLOCK_SIZE=8', 'CONSTRAINT c UNIQUE KEY i (a)',
  ])('复杂索引原片段保持只读：%s', index => {
    const result = read(`CREATE TABLE t(a varchar(20), ${index})`).indexes[0];
    expect(result.rawSql.trim()).toBe(index); expect(result.opaqueReasons.length).toBeGreaterThan(0);
    expect(editableIndexDefinition(result, new Map())).toBeUndefined();
  });
  it('同一函数的内部逗号不能切出伪 key part', () => {
    const result = read("CREATE TABLE t(a varchar(20),b int,KEY i ((concat(a,',x')),b))").indexes[0];
    expect(result.parts).toHaveLength(2); expect(result.parts[1].columnName).toBe('b');
  });
  it('支持 USING 位于键部分前或后，显式 ASC 与默认方向等价', () => {
    for (const index of ['KEY i USING BTREE (a)', 'UNIQUE INDEX i (a ASC) USING BTREE']) {
      const result = read(`CREATE TABLE t(a int,${index})`).indexes[0];
      expect(result.method).toBe('BTREE'); expect(result.parts[0].direction).toBe('asc'); expect(result.opaqueReasons).toEqual([]);
    }
  });
  it('预算和不完整定义拒绝，不返回部分索引清单', () => {
    expect(() => read('CREATE TABLE t(a int, KEY i(a,,a))')).toThrow('空键');
    expect(() => read('CREATE TABLE t(a int, KEY i(a)')).toThrow();
    expect(() => read(`CREATE TABLE t(a int,KEY i(${Array(33).fill('a').join(',')}))`)).toThrow('32');
    expect(() => read(`CREATE TABLE t(a int,${Array.from({ length: 257 }, (_, index) => `KEY k${index}(a)`).join(',')})`)).toThrow('256');
    expect(() => read('CREATE TABLE t(a int, KEY i(a),KEY I(a))')).toThrow('重复');
  });
  it('跨快照或歧义列映射不能获得可编辑投影', () => {
    const index = read('CREATE TABLE t(a int,KEY i(a))').indexes[0];
    expect(editableIndexDefinition(index, new Map())).toBeUndefined();
    expect(editableIndexDefinition(index, new Map([['x', { name: 'A' }], ['y', { name: 'A' }]]) as Map<string, TrustedIndexColumn>)).toBeUndefined();
  });
});
