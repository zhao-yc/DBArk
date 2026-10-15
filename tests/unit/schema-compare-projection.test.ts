import { describe, expect, it } from 'vitest';
import { compareSchemaSnapshots } from '../../src/engine/schemaCompareProjection';
import { parseTableColumnDefinition } from '../../src/engine/tableColumnDefinition';
import type { SchemaComparisonSnapshot } from '../../src/engine/schemaCompare';
import type { TableDefinitionContext } from '../../src/shared/tableColumnPatches';
import { schemaCompareInputSchema } from '../../src/shared/schemaCompare';

/** 测试快照采用解析器读取原定义，目录补齐值只模拟读取器已交叉核验的结果。 */
function snapshot(body: string, options: { table?: string; database?: string; dialect?: 'mysql' | 'mariadb'; version?: string; mode?: TableDefinitionContext['mode']; tail?: string } = {}): SchemaComparisonSnapshot {
  const table = options.table ?? 'table', database = options.database ?? 'db';
  const context = { dialect: options.dialect ?? 'mysql', mode: options.mode ?? { ansiQuotes: false, noBackslashEscapes: false } };
  const source = `CREATE TABLE \`${table.replaceAll('`', '``')}\` (${body}) ${options.tail ?? 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin'}`;
  const definition = parseTableColumnDefinition(source, context);
  return { source, context, originalMode: '', normalizedMode: '', identity: '私有身份', serverVersion: options.version ?? '8.4.11', target: { connectionId: 'c', database, table }, nullability: definition.columns.map(column => [column.name, column.nullable !== false]), encodings: definition.columns.map(column => ({ name: column.name, charset: /char|text|enum|set/i.test(column.type.raw) ? 'utf8mb4' : null, collation: /char|text|enum|set/i.test(column.type.raw) ? 'utf8mb4_bin' : null })), tableEncoding: { charset: 'utf8mb4', collation: 'utf8mb4_bin' } };
}
const row = (report: ReturnType<typeof compareSchemaSnapshots>, category: string, name: string) => report.rows.find(value => value.category === category && value.name === name)!;

describe('只读源到目标原定义比较', () => {
  it('明确方向、精确名称配对、同名变化与各侧缺失，不猜改名', () => {
    const result = compareSchemaSnapshots(snapshot('`id` int NOT NULL,`old_name` int,KEY `idx` (`id`)'), snapshot('`id` bigint NOT NULL,`new_name` int'));
    expect(row(result, 'columns', 'old_name').status).toBe('added');
    expect(row(result, 'columns', 'new_name').status).toBe('removed');
    expect(row(result, 'indexes', 'idx').status).toBe('added');
    expect(row(result, 'columns', 'id').changedProperties).toContain('type');
    expect(result.direction).toBe('source-to-target'); expect(result.mode).toBe('read-only-definition');
    expect(JSON.stringify(result)).not.toContain('私有身份'); expect(result).not.toHaveProperty('sql');
  });
  it('布局和普通注释无差异，字段真实 NULL、位置、字符集仍参与', () => {
    const a = snapshot('`id` int NULL, `title` varchar(20) DEFAULT \'x\'');
    const b = snapshot('`id` /* 普通注释 */ int NULL,\n `title` varchar(20) DEFAULT \'x\'');
    expect(compareSchemaSnapshots(a, b).counts.same).toBe(2);
    b.nullability[0][1] = false; b.encodings[1].collation = 'utf8mb4_general_ci';
    const changed = compareSchemaSnapshots(a, b);
    expect(row(changed, 'columns', 'id').changedProperties).toContain('nullable');
    expect(row(changed, 'columns', 'title').changedProperties).toContain('collation');
    expect(row(compareSchemaSnapshots(a, snapshot('`title` varchar(20) DEFAULT \'x\',`id` int NULL')), 'columns', 'id').changedProperties).toContain('position');
  });
  it.each([
    ["`x` decimal(65,30) DEFAULT 123456789012345678901234567890.123456789012345678901234567890", "`x` decimal(65,30) DEFAULT 123456789012345678901234567890.123456789012345678901234567891", 'default'],
    ["`x` enum('A','a') DEFAULT 'A'", "`x` enum('a','A') DEFAULT 'A'", 'type'],
    ["`x` varchar(30) DEFAULT 'a b' COMMENT 'A'", "`x` varchar(30) DEFAULT 'ab' COMMENT 'a'", 'default'],
    ['`x` timestamp(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)', '`x` timestamp(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(3)', 'attributes'],
    ['`id` int,`x` int GENERATED ALWAYS AS (`id` + 1) STORED', '`id` int,`x` int GENERATED ALWAYS AS (`id` + 2) STORED', 'attributes'],
  ])('不会丢失高精度、枚举、字符串、更新/生成表达式 %#', (a, b, property) => {
    const difference = row(compareSchemaSnapshots(snapshot(a), snapshot(b)), 'columns', 'x');
    expect(difference.status).toBe('changed'); expect(difference.changedProperties).toContain(property);
  });
  it('主键、索引键顺序、前缀、方向及注释均比较', () => {
    const a = snapshot("`a` varchar(30),`b` int,PRIMARY KEY (`b`),KEY `ix` (`a`(5) DESC,`b`) COMMENT 'A'");
    const b = snapshot("`a` varchar(30),`b` int,PRIMARY KEY (`a`),KEY `ix` (`b`,`a`(6) ASC) COMMENT 'a'");
    const report = compareSchemaSnapshots(a, b);
    expect(row(report, 'indexes', 'PRIMARY').status).toBe('changed');
    expect(row(report, 'indexes', 'ix').changedProperties).toEqual(expect.arrayContaining(['parts', 'comment']));
  });
  it('外键保留跨库父目标、有序字段映射、动作及原定义，父库不会自动映射', () => {
    const body = (parent: string, action: string) => `a int,b int,CONSTRAINT \`fk\` FOREIGN KEY (a,b) REFERENCES ${parent} (x,y) ON UPDATE CASCADE ON DELETE ${action}`;
    const report = compareSchemaSnapshots(snapshot(body('`db`.`parent`', 'RESTRICT')), snapshot(body('`other`.`parent`', 'SET NULL'), { database: 'other' }));
    expect(row(report, 'foreignKeys', 'fk').changedProperties).toEqual(expect.arrayContaining(['parent', 'onDelete', 'definition']));
    expect(row(report, 'foreignKeys', 'fk').source?.rawSql).toContain('`db`.`parent`');
  });
  it.each([
    ['`id` magic_type', 'columns', 'id'], ['`id` int FROBNICATE 1', 'columns', 'id'],
    ["`id` binary(4) DEFAULT 'abc'", 'columns', 'id'],
    ['`id` int,KEY `ix` ((abs(`id`)))', 'indexes', 'ix'],
    ['`id` text,FULLTEXT KEY `ix` (`id`) WITH PARSER ngram', 'indexes', 'ix'],
    ['`id` int,KEY `ix` (`id`) INVISIBLE', 'indexes', 'ix'],
    ['`id` int,CONSTRAINT `fk` FOREIGN KEY (`id`) REFERENCES `p` (`id`) MATCH FULL ON DELETE RESTRICT', 'foreignKeys', 'fk'],
    ['`id` int /*!80023 INVISIBLE */', 'columns', 'id'],
  ])('未知或特殊定义即使文本相同也不能报相同 %#', (body, category, name) => {
    const report = compareSchemaSnapshots(snapshot(body), snapshot(body));
    expect(row(report, category, name).status).toBe('unknown'); expect(row(report, category, name).reasons.length).toBeGreaterThan(0); expect(report.comparable).toBe(false);
  });
  it('已识别的默认FULLTEXT原定义可比较，种类和方法差异仍保留', () => {
    const fulltext = snapshot('`body` varchar(40),FULLTEXT KEY `ix` (`body`)');
    const same = compareSchemaSnapshots(fulltext, fulltext);
    expect(row(same, 'indexes', 'ix')).toMatchObject({ status: 'same', reasons: [] }); expect(same.comparable).toBe(true);
    const ordinary = snapshot('`body` varchar(40),KEY `ix` (`body`)');
    expect(row(compareSchemaSnapshots(fulltext, ordinary), 'indexes', 'ix')).toMatchObject({ status: 'changed', changedProperties: expect.arrayContaining(['kind', 'method']) });
  });
  it('陌生版本缺省外键动作不猜测，已显式动作仍可比较', () => {
    const a = snapshot('id int,CONSTRAINT fk FOREIGN KEY (id) REFERENCES p (id)', { version: '9.99.1' });
    expect(row(compareSchemaSnapshots(a, a), 'foreignKeys', 'fk').status).toBe('unknown');
    const b = snapshot('id int,CONSTRAINT fk FOREIGN KEY (id) REFERENCES p (id) ON UPDATE RESTRICT ON DELETE RESTRICT', { version: '9.99.1' });
    expect(row(compareSchemaSnapshots(b, b), 'foreignKeys', 'fk').status).toBe('same');
  });
  it('CHECK 和未知约束原文显式保留，并阻止无法证明的缺失判断', () => {
    const a = snapshot('id int, CHECK (id > 0), KEY ix(id)'), b = snapshot('id int');
    const report = compareSchemaSnapshots(a, b);
    expect(report.rows.find(value => value.category === 'unclassified')?.source?.rawSql).toContain('CHECK');
    expect(row(report, 'indexes', 'ix').status).toBe('unknown');
    expect(row(compareSchemaSnapshots(snapshot('id int CHECK (id > 0)'), b), 'columns', 'id').status).toBe('unknown');
  });
  it('引用名中的点/反引号与特殊对象名精确保留，大小写差异不合并', () => {
    const a = snapshot('`A.b``x` int', { table: 'table.with`quote' }), b = snapshot('`a.b``x` int');
    const report = compareSchemaSnapshots(a, b);
    expect(row(report, 'columns', 'A.b`x').status).toBe('added'); expect(row(report, 'columns', 'a.b`x').status).toBe('removed');
    expect(report.source.table).toBe('table.with`quote');
  });
  it('遵守各自词法模式；跨方言不武断认定同语义', () => {
    const a = snapshot("x varchar(8) DEFAULT 'a\\\\b'", { mode: { ansiQuotes: false, noBackslashEscapes: false } });
    const b = snapshot("x varchar(8) DEFAULT 'a\\b'", { mode: { ansiQuotes: false, noBackslashEscapes: true } });
    expect(row(compareSchemaSnapshots(a, b), 'columns', 'x').status).toBe('same');
    expect(row(compareSchemaSnapshots(snapshot('id int'), snapshot('id int', { dialect: 'mariadb', version: '11.4.13' })), 'columns', 'id').status).toBe('unknown');
  });
  it('表选项差异显式列为忽略范围并保留原文，不制造整表一致承诺', () => {
    const report = compareSchemaSnapshots(snapshot('id int', { tail: 'ENGINE=InnoDB AUTO_INCREMENT=42' }), snapshot('id int', { tail: 'ENGINE=MyISAM' }));
    expect(report.ignoredFragments[0].rawSql).toContain('AUTO_INCREMENT=42'); expect(report.ignoredFragments[1].rawSql).toContain('MyISAM');
    expect(report.ignored.join('\n')).toContain('不代表完整 M02'); expect(report.ignored.join('\n')).toContain('入向外键');
  });
  it('不修改快照；不接受凭据或 SQL 等额外输入属性', () => {
    const a = snapshot('id int'), b = snapshot('id int'), before = JSON.stringify([a, b]); compareSchemaSnapshots(a, b); expect(JSON.stringify([a, b])).toBe(before);
    expect(schemaCompareInputSchema.safeParse({ taskId: 't', source: { ...a.target, password: '不可进入比较' }, target: b.target }).success).toBe(false);
    expect(schemaCompareInputSchema.safeParse({ taskId: 't', source: { ...a.target, table: 'a\0b' }, target: b.target }).success).toBe(false);
  });
});
