import { describe, expect, it } from 'vitest';
import { currentSqliteStatement, sqliteStatementRanges } from '../../src/engine/sqlite/currentStatement';
import { sqliteDriverLimits } from '../../src/engine/sqlite/protocol';

/** 光标标记只生成原文UTF16偏移，不进入待解析SQL，也不改换行或非BMP字符。 */
function at(marked: string) { const offset = marked.indexOf('┃'); if (offset < 0 || marked.lastIndexOf('┃') !== offset) throw Error('本例光标标记必须唯一'); return currentSqliteStatement(marked.replace('┃', ''), offset); }
/** 对所有返回范围严格回读原文，重复SQL不能通过indexOf猜位置。 */
function slices(source: string) {
  const ranges = sqliteStatementRanges(source); let previous = 0;
  for (const range of ranges) { expect(range.start).toBeGreaterThanOrEqual(previous); expect(source.slice(range.start, range.end)).toBe(range.sql); expect(range.end).toBeLessThanOrEqual(range.delimiterStart); expect(source.slice(range.delimiterStart, range.delimiterEnd)).toBe(range.delimiter ?? ''); previous = range.delimiterEnd; }
  return ranges;
}

describe('SQLite当前语句纯词法与原文范围', () => {
  it('BOM/CRLF/首尾trim和重复SQL均保留准确UTF16切片与分隔符位置', () => {
    const source = '\uFEFF \r\n SELECT 1  ;\r\n\tSELECT 1 \r\n', ranges = slices(source);
    expect(ranges).toEqual([{ sql: 'SELECT 1', start: 5, end: 13, delimiterStart: 15, delimiterEnd: 16, delimiter: ';' }, { sql: 'SELECT 1', start: 19, end: 27, delimiterStart: source.length, delimiterEnd: source.length, delimiter: null }]);
    expect(currentSqliteStatement(source, 24)).toEqual(ranges[1]);
  });

  it.each(['\u00A0', '\u2003', '\v'])('SQLite不接受的空白前缀%s保持准确字节，不能trim成合法写入', prefix => {
    const selected = prefix + "INSERT INTO subject VALUES(1,'不得改写')", source = selected + ';SELECT 2;', range = currentSqliteStatement(source, 3);
    expect(range).toMatchObject({ sql: selected, start: 0, end: selected.length }); expect(source.slice(range!.start, range!.end)).toBe(selected);
  });

  it('只修剪SQLite标准ASCII空白与首部BOM，标识符内部和末尾BOM始终保留', () => {
    const leading = '\uFEFF\t\n\f\r ', chosen = 'SELECT 1 AS alias\uFEFF', source = leading + chosen + ' \t\r\n;', range = currentSqliteStatement(source, leading.length + 2);
    expect(range).toMatchObject({ sql: chosen, start: leading.length, end: leading.length + chosen.length }); expect(source.slice(range!.start, range!.end)).toBe(chosen);
    expect(sqliteStatementRanges('SELECT\uFEFF1;')[0].sql).toBe('SELECT\uFEFF1'); expect(sqliteStatementRanges('SELECT \uFEFF1;')[0].sql).toBe('SELECT \uFEFF1');
  });

  it.each([
    ['┃SELECT 1; SELECT 2;', 'SELECT 1'], ['SELECT 1┃; SELECT 2;', 'SELECT 1'], ['SELECT 1;┃SELECT 2;', 'SELECT 2'],
    ['SELECT 1;┃\r\nSELECT 2;', 'SELECT 1'], ['SELECT 1;┃', 'SELECT 1'], ['SELECT 1┃', 'SELECT 1'],
    ['SELECT 1  ┃', 'SELECT 1'], ['SELECT 1 ┃ ; SELECT 2;', 'SELECT 1'], ['SELECT 1; SELECT ┃2;', 'SELECT 2'],
  ])('光标边界%s只归属明确当前语句', (source, expected) => { expect(at(source)?.sql).toBe(expected); });

  it.each(['┃', ' ┃ \r\n', '┃  SELECT 1;', 'SELECT 1; ┃ SELECT 2;', 'SELECT 1;\n┃\nSELECT 2;', '--只有┃注释\n', '/*只有┃注释*/;', 'SELECT 1;\n--末尾┃注释', 'SELECT 1; ;┃ ;', 'SELECT 1; ┃'])('无SQL位置%s不跨空白找相邻或回退全文', source => { expect(at(source)).toBeUndefined(); });

  it('单/双/反引号倍写和中括号引用内的分号不是分隔符，反斜杠不转义', () => {
    const source = "SELECT 'a'';b',\"中\"\";文\",`反``;名`,[方;名],'C:\\';SELECT 2;";
    const ranges = slices(source); expect(ranges).toHaveLength(2); expect(ranges[0].sql).toBe(source.slice(0, source.indexOf(';SELECT'))); expect(ranges[1].sql).toBe('SELECT 2');
    expect(() => sqliteStatementRanges("SELECT 'a\\'; SELECT '未闭合")).toThrow('未闭合');
  });

  it('双减号不要求空格、块注释不嵌套，SQLite不使用井号注释或可执行注释', () => {
    const source = 'SELECT 1--不是下一句;\r\n; /*外 /*内*/ SELECT 2; /*! SELECT 99; */;#不是注释;SELECT 3;';
    const ranges = slices(source); expect(ranges.map(range => range.sql)).toEqual(['SELECT 1--不是下一句;', '/*外 /*内*/ SELECT 2', '#不是注释', 'SELECT 3']);
  });

  it('中文非BMP按UTF16计数，CRLF内部与代理对内部光标均拒绝', () => {
    const source = "SELECT '🧭';\r\nSELECT '第二句'", ranges = slices(source); expect(ranges[1].start).toBe(14); expect(currentSqliteStatement(source, 22)).toEqual(ranges[1]);
    expect(() => currentSqliteStatement(source, 9)).toThrow('代理对'); expect(() => currentSqliteStatement(source, 13)).toThrow('CRLF');
  });

  it.each([-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER])('无效光标%s零执行拒绝', offset => { expect(() => currentSqliteStatement('SELECT 1', offset)).toThrow('光标位置无效'); });

  it.each(['CREATE TRIGGER', 'CREATE TEMP TRIGGER IF NOT EXISTS', 'CREATE TEMPORARY TRIGGER', 'EXPLAIN CREATE TRIGGER', 'EXPLAIN QUERY PLAN CREATE TEMP TRIGGER IF NOT EXISTS'])('%s内部多语句、CASE END、AS end和begin字段都不能切开', prefix => {
    const trigger = prefix + ' "触""发" AFTER INSERT ON subject WHEN NEW.begin>0 BEGIN\r\n INSERT INTO audit(begin) SELECT CASE WHEN NEW.n>0 THEN \'END;\' ELSE \'BEGIN;\' END AS end;\r\n UPDATE subject SET note=\'尾;\'; --END不是闭合\r\n END';
    const source = 'SELECT 0;\r\n' + trigger + ';\r\nSELECT 9;', ranges = slices(source); expect(ranges).toHaveLength(3); expect(ranges[1].sql).toBe(trigger);
    for (const marker of ['INSERT INTO audit', 'AS end', 'UPDATE subject', '--END不是闭合']) expect(currentSqliteStatement(source, source.indexOf(marker))).toEqual(ranges[1]);
  });

  it('BEGIN/END普通引用及词语不伪装trigger，注释/引用中的DELIMITER不伪装客户端指令', () => {
    expect(slices('SELECT \'CREATE TRIGGER\'; SELECT "BEGIN";SELECT end;').map(range => range.sql)).toEqual(["SELECT 'CREATE TRIGGER'", 'SELECT "BEGIN"', 'SELECT end']);
    const source = "--DELIMITER $$\r\nSELECT 'DELIMITER',\"DELIMITER\",`DELIMITER`,[DELIMITER];SELECT 2;"; expect(slices(source).map(range => range.sql)).toEqual([source.slice(0, source.indexOf(';SELECT')), 'SELECT 2']);
  });

  it('合法SQLite TABLE/VIEW/UNIQUE INDEX/VIRTUAL TABLE头不被当成其它方言过程', () => {
    const statements = ['CREATE TEMP TABLE t(n)', 'CREATE TEMPORARY VIEW v AS SELECT 1', 'CREATE UNIQUE INDEX i ON t(n)', 'CREATE VIRTUAL TABLE docs USING fts5(body)'];
    expect(slices(statements.join(';') + ';').map(range => range.sql)).toEqual(statements);
  });

  it.each(['DELIMITER $$\nCREATE TRIGGER t AFTER INSERT ON a BEGIN INSERT INTO a VALUES(1);INSERT INTO a VALUES(2); END$$', 'CREATE PROCEDURE p() BEGIN SELECT 1; INSERT INTO a VALUES(2); END;', 'CREATE FUNCTION f() RETURNS INT BEGIN SELECT 1; INSERT INTO a VALUES(2); END;', 'CREATE EVENT e DO BEGIN SELECT 1; INSERT INTO a VALUES(2); END;', 'EXPLAIN CREATE PROCEDURE p() BEGIN SELECT 1; INSERT INTO a VALUES(2); END;'])('不支持的客户端/过程源码不得裸取body执行：%s', source => { expect(() => currentSqliteStatement(source, source.indexOf('VALUES(2)'))).toThrow(/DELIMITER|CREATE/); });

  it.each(["SELECT 1; SELECT '未闭合", 'SELECT 1;SELECT "未闭合', 'SELECT 1; SELECT `未闭合', 'SELECT 1; SELECT [未闭合', 'SELECT 1; /*未闭合', 'SELECT 1;CREATE TRIGGER t AFTER INSERT ON a BEGIN SELECT 2;', 'CREATE TRIGGER t AFTER INSERT ON a BEGIN SELECT 2; END SELECT 3;', 'SELECT 1;SELECT (2', 'SELECT 1; SELECT 2)', 'SELECT (1; INSERT INTO a VALUES(2));', 'SELECT 1;\0', 'SELECT 1;\uD800'])('即使光标位于前句，后方不完整全文%s仍拒绝', source => { expect(() => currentSqliteStatement(source, 1)).toThrow(); });

  it('限制按完整source的原driver20MiB，不能用短选中句绕过总输入门', () => { expect(() => currentSqliteStatement('SELECT 1;' + ' '.repeat(sqliteDriverLimits.sqlBytes), 1)).toThrow('20MiB'); });

  it('current超过目录1000条仍准确定位且扫描末尾，只有显式范围数组受目录预算约束', () => {
    const prefix = 'SELECT 1;'.repeat(sqliteDriverLimits.statements + 7), selected = 'SELECT 42', source = prefix + selected + ';SELECT 9;';
    expect(currentSqliteStatement(source, prefix.length + 3)).toEqual({ sql: selected, start: prefix.length, end: prefix.length + selected.length, delimiterStart: prefix.length + selected.length, delimiterEnd: prefix.length + selected.length + 1, delimiter: ';' });
    expect(sqliteStatementRanges('SELECT 1;'.repeat(sqliteDriverLimits.statements))).toHaveLength(sqliteDriverLimits.statements); expect(() => sqliteStatementRanges(source)).toThrow('目录超过1000');
    expect(() => currentSqliteStatement(source + "SELECT '未闭合", prefix.length + 3)).toThrow('未闭合');
  });
});
