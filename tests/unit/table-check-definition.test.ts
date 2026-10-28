import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseTableColumnDefinition } from '../../src/engine/tableColumnDefinition';
import { assertTableCheckExpression, readTableCheckDefinition, tableCheckVersionCapabilities } from '../../src/engine/tableCheckDefinition';
import { tableCheckLimits } from '../../src/shared/tableChecks';
import type { TableDefinitionContext } from '../../src/shared/tableColumnPatches';

const mysql: TableDefinitionContext = { dialect: 'mysql', mode: { ansiQuotes: false, noBackslashEscapes: false } };
const maria: TableDefinitionContext = { ...mysql, dialect: 'mariadb' };
const read = (source: string, context = mysql, version = context.dialect === 'mysql' ? '8.4.11' : '11.4.13') => readTableCheckDefinition(parseTableColumnDefinition(source, context), version);
const fixtureDirectory = join(import.meta.dirname, '../fixtures/table-column-definitions');
const manifest = JSON.parse(readFileSync(join(fixtureDirectory, 'manifest.json'), 'utf8')) as { entries: { file: string; purpose: string; dialect: 'mysql' | 'mariadb'; version: string; sqlMode: string; sha256: string }[] };

describe('CHECK完整原定义与原范围解析', () => {
  for (const fixture of manifest.entries.filter(value => value.purpose === 'combined')) it('真实原件只回放/读取，不冒称ALTER或实库通过：' + fixture.version, () => {
    const source = readFileSync(join(fixtureDirectory, fixture.file), 'utf8'); expect(createHash('sha256').update(source).digest('hex')).toBe(fixture.sha256);
    const modes = new Set(fixture.sqlMode.split(',')), context: TableDefinitionContext = { dialect: fixture.dialect, mode: { ansiQuotes: modes.has('ANSI_QUOTES'), noBackslashEscapes: modes.has('NO_BACKSLASH_ESCAPES') } };
    const result = read(source, context, fixture.version); expect(result.coverage).toBe('complete'); expect(result.source).toBe(source);
    if (fixture.version.startsWith('5.7.')) { expect(result.checks).toEqual([]); expect(tableCheckVersionCapabilities(fixture.dialect, fixture.version).writable).toBe(false); }
    else { expect(result.checks).toHaveLength(1); expect(result.checks[0]).toMatchObject({ name: 'ck_amount', location: 'table', enforced: true, opaqueReasons: [] }); expect(result.checks[0].expression).toContain('`amount` >= 0'); }
    for (const check of result.checks) { expect(source.slice(check.range.start, check.range.end)).toBe(check.rawSql); expect(source.slice(check.expressionRange.start, check.expressionRange.end)).toBe(check.expression); }
    expect(result.preserved).toContain('idx_ordinary'); expect(result.preserved).toContain('computed'); expect(result.preserved).not.toContain('ck_amount');
  });

  it('真实通用入口保留同列多个inline CHECK，表级和列级约束按各自范围区分', () => {
    const source = 'CREATE TABLE t (`a` int CONSTRAINT `one` CHECK (`a`>0) CHECK (`a`<100), `b` int CHECK (`b` IN (1,2)), CONSTRAINT `two` CHECK (CASE WHEN `a` IS NULL THEN TRUE ELSE `a`>=`b` END), KEY k(b)) ENGINE=InnoDB';
    const result = read(source); expect(result.coverage).toBe('complete'); expect(result.checks).toHaveLength(4);
    expect(result.checks.map(check => [check.name, check.location, check.columnName])).toEqual([['one', 'column', 'a'], [undefined, 'column', 'a'], [undefined, 'column', 'b'], ['two', 'table', undefined]]);
    expect(JSON.parse(result.preserved)).toEqual(['CREATE TABLE t (', ['`a` int', '`b` int', 'KEY k(b)'], ') ENGINE=InnoDB']);
  });

  it('引用CHECK列、字符串/ENUM/COMMENT中的关键字、括号及逗号不生成伪约束', () => {
    const source = "CREATE TABLE t (`CHECK` int COMMENT 'CHECK(fake), CONSTRAINT no', `v` enum('CHECK(a)','a,b',')') DEFAULT 'a,b', `g` int GENERATED ALWAYS AS (length('CHECK(a)')) VIRTUAL, CONSTRAINT `检``查.__proto__` CHECK (`CHECK` >= 0 AND `v` <> 'x) ; DROP TABLE t'), CONSTRAINT fk FOREIGN KEY(`CHECK`) REFERENCES p(id), KEY `CHECK` (`v`)) COMMENT='CHECK(oops)'";
    const result = read(source); expect(result.coverage).toBe('complete'); expect(result.checks).toHaveLength(1); expect(result.checks[0].name).toBe('检`查.__proto__'); expect(result.preserved).toContain('FOREIGN KEY'); expect(result.preserved).toContain("CHECK(oops)");
  });

  it.each(['CHECK (a>0)', 'CONSTRAINT named CHECK (a>0)'])('匿名与命名表级读取不猜目录名称：%s', check => {
    const result = read('CREATE TABLE t(a int,' + check + ')'); expect(result.coverage).toBe('complete'); expect(result.checks[0].name).toBe(check.startsWith('CONSTRAINT') ? 'named' : undefined);
  });

  it.each(['', ' ENFORCED', ' NOT ENFORCED', ' /*!80016 NOT ENFORCED */'])('MySQL准确生效后缀完整保留：%s', suffix => {
    for (const inline of [false, true]) {
      const source = inline ? 'CREATE TABLE t(a int CONSTRAINT ck CHECK (a>0)' + suffix + ',b int)' : 'CREATE TABLE t(a int,CONSTRAINT ck CHECK (a>0)' + suffix + ')';
      const result = read(source, mysql, '8.0.16'); expect(result.coverage).toBe('complete'); expect(result.checks[0].enforced).toBe(!suffix.includes('NOT')); expect(result.checks[0].rawSql).toContain(suffix || 'CHECK');
    }
  });

  it.each([' /*!80017 NOT ENFORCED */', ' /*!80016 UNKNOWN */', ' UNKNOWN', ' NOT ENFORCED ENFORCED', ' /*M!100301 NOT ENFORCED */', ' /*m!100301 NOT ENFORCED */'])('未知尾部保unknown而不是空约束：%s', suffix => {
    const result = read('CREATE TABLE t(a int,CONSTRAINT ck CHECK(a>0)' + suffix + ')'); expect(result.coverage).toBe('unknown'); expect(result.checks).toHaveLength(1); expect(result.reasons.length).toBeGreaterThan(0);
  });

  it('Maria JSON_VALID是实际inline约束，不作为辅助属性丢弃；MySQL后缀不借方言套用', () => {
    const result = read('CREATE TABLE t(j LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin CHECK (json_valid(`j`)), CONSTRAINT ck CHECK (length(j)>0))', maria);
    expect(result.coverage).toBe('complete'); expect(result.checks).toHaveLength(2); expect(result.checks[0]).toMatchObject({ location: 'column', columnName: 'j', enforced: true });
    expect(read('CREATE TABLE t(a int,CONSTRAINT ck CHECK(a>0) /*!80016 NOT ENFORCED */)', maria).coverage).toBe('unknown');
  });

  it('重复约束名、陌生CONSTRAINT或未知列后缀使覆盖不完整', () => {
    for (const source of ['CREATE TABLE t(a int,CONSTRAINT ck CHECK(a>0),CONSTRAINT CK CHECK(a<5))', 'CREATE TABLE t(a int,CONSTRAINT mysterious FUTURE(a))', 'CREATE TABLE t(a int FUTURE CHECK(a>0))']) expect(read(source).coverage).toBe('unknown');
  });

  it('超过512约束不截断成部分列表；quoted body中的可执行前缀仍是普通数据', () => {
    const source = 'CREATE TABLE t(a int,' + Array.from({ length: tableCheckLimits.checks + 1 }, (_, index) => `CONSTRAINT c${index} CHECK(a>=${index})`).join(',') + ')';
    expect(() => read(source)).toThrow(); expect(read("CREATE TABLE t(a varchar(50),CONSTRAINT c CHECK(a<>'/*m! ; ) */'))").coverage).toBe('complete');
  });

  it('只排除真正CHECK，修改其它列/外键/索引/表尾不能被preserved掩盖', () => {
    const source = 'CREATE TABLE t(a int COMMENT \'原\',b int CHECK(b>0),CONSTRAINT ck CHECK(a>b),CONSTRAINT fk FOREIGN KEY(b) REFERENCES p(id),KEY k(a)) ENGINE=InnoDB COMMENT=\'表尾\'';
    const before = read(source);
    expect(read(source.replace('CHECK(a>b)', 'CHECK(a>b+1)')).preserved).toBe(before.preserved);
    for (const changed of [source.replace("COMMENT '原'", "COMMENT '新'"), source.replace('REFERENCES p(id)', 'REFERENCES other(id)'), source.replace('KEY k(a)', 'KEY k(b)'), source.replace("COMMENT='表尾'", "COMMENT='新尾'")]) expect(read(changed).preserved).not.toBe(before.preserved);
  });
});

describe('CHECK单表达式封装门而非语义函数白名单', () => {
  it.each([
    'CASE WHEN `a` IS NULL THEN TRUE ELSE `a` BETWEEN 1 AND 9 END',
    "json_valid(`doc`) AND JSON_EXTRACT(`doc`, '$.n') IN (1,2,3)",
    "CAST(`v` AS CHAR(30)) COLLATE utf8mb4_bin REGEXP '^a[0-9]+$'",
    "length(concat('a,b', coalesce(`v`, ''))) > 0 AND `a` <> 18446744073709551615",
    "`a` > CAST('12345678901234567890.1234567890' AS DECIMAL(65,10))",
    "CASE WHEN `v` LIKE _utf8mb4'a%' THEN (`a` <=> NULL) ELSE TRUE END",
    '`a`>0 /* 普通注释 */ AND `b`<10 -- 行注释\n',
    "`v` <> '/*!80016 ; ) DROP */'",
  ])('普通复杂表达式原样保留，服务器仍决定语义是否合法：%s', expression => { expect(assertTableCheckExpression(expression, mysql).sql).toBe(expression); });

  it('只归一整个表达式外括号和词法模式，不改内部结合、数字尺度及字符串内容', () => {
    const key = (value: string, context = mysql) => assertTableCheckExpression(value, context).key;
    expect(key('(((a > 0)))')).toBe(key('a>0')); expect(key("v='it\\'s'")).toBe(key("v='it''s'"));
    expect(key('a+(b*c)')).not.toBe(key('(a+b)*c')); expect(key('a>1.00')).not.toBe(key('a>1'));
    expect(key('"a">0')).not.toBe(key('`a`>0')); expect(key('"a">0', { ...mysql, mode: { ansiQuotes: true, noBackslashEscapes: false } })).toBe(key('`a`>0'));
    expect(key("v='a\\b'", { ...mysql, mode: { ansiQuotes: false, noBackslashEscapes: true } })).not.toBe(key("v='a\\b'"));
  });

  it.each(['', '/* only comment */', 'a>0); DROP TABLE t; --', 'a>0) ENFORCED, DROP COLUMN b, CHECK(1', 'a>0; SELECT 1', 'a,b', '(a>0', 'a>0)', "v='unclosed", 'a>0 /*unclosed', '/*!80016 a>0 */', '/*m!100301 a>0 */', '\0', '\ud800'])('结构逃逸或不完整表达式拒绝：%s', expression => { expect(() => assertTableCheckExpression(expression, mysql)).toThrow(); });

  it('字符/字节/深度和未知模式分别拒绝，版本门不将5.7/8.0.15当成CHECK实施', () => {
    for (const expression of ['a'.repeat(tableCheckLimits.expressionUnits + 1), '中'.repeat(22000), '('.repeat(129) + 'a' + ')'.repeat(129)]) expect(() => assertTableCheckExpression(expression, mysql)).toThrow();
    expect(() => assertTableCheckExpression('a>0', { ...mysql, mode: { ansiQuotes: false, noBackslashEscapes: false, noBackslashEscapesKnown: false } })).toThrow();
    for (const version of ['5.7.44', '8.0.15', '9.0.0', 'unknown']) expect(tableCheckVersionCapabilities('mysql', version).writable).toBe(false);
    expect(tableCheckVersionCapabilities('mysql', '8.0.16')).toEqual({ writable: true, allowsNotEnforced: true }); expect(tableCheckVersionCapabilities('mariadb', '5.5.5-10.11.19-MariaDB')).toEqual({ writable: true, allowsNotEnforced: false });
  });
});
