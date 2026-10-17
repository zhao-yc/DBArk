import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { splitSql } from '../../src/engine/sql';
import { prepareQueryRowDetailsKeyboardSql as prepare } from '../helpers/queryRowDetailsKeyboardSql';
import { queryRowDetailsUiSql, queryRowDetailsUiValues as values } from '../helpers/queryRowDetailsUi';

describe('整行详情fixture的单行真实键盘输入准备（纯RAM）', () => {
  it('只连接引号外句法空白，JSON空白、重复key、引号和标识符原文保持', () => {
    const source = ' \r\n SELECT\n  \' {"same": 1, "same": 2} \' AS `同 名`,\r\n\t\'a\'\'  b\' AS s, "双  空格" AS `a``  b` \t';
    expect(prepare(source)).toBe('SELECT \' {"same": 1, "same": 2} \' AS `同 名`, \'a\'\'  b\' AS s, "双  空格" AS `a``  b`');
  });
  it('实际两条fixture各保持单条只读SELECT、全部精确字面量及返回CRLF构造', () => {
    const marker = 'a'.repeat(32), target = { marker, database: 'dbark_row_details_' + marker, host: '192.168.31.200', port: 13384, user: 'RAM', password: '非真实密码', uuid: '01234567-89ab-cdef-0123-456789abcdef', executable: 'D:\\RAM\\DBArk.exe' } as const;
    const sql = queryRowDetailsUiSql(target);
    for (const original of [sql.first, sql.second]) {
      const input = prepare(original); expect(input).not.toMatch(/[\r\n]/u); expect(splitSql(input)).toHaveLength(1); expect(input).toMatch(/^SELECT\b/u); expect(prepare(input)).toBe(input);
      expect(input).toContain('SELECT COUNT(*) FROM `' + target.database + '`.`subject`');
    }
    const input = prepare(sql.first);
    expect(input).toContain("'" + values.json + "'"); expect(input).toContain("'" + values.html + "'");
    expect(input).toContain("'" + values.bigint + "'"); expect(input).toContain("'" + values.decimal + "'"); expect(input).toContain("_binary X'00FF'"); expect(input).toContain("_binary X''");
    expect(input).toContain("CONCAT(REPEAT('长',300),CHAR(13"); expect(input).toContain(",'原换行') AS long_text"); expect(values.long).toBe('长'.repeat(300) + '\r\n原换行');
  });
  it('显式CHAR USING表达式逐字保持，不复写Root的TEXT类型修正', () => {
    const input = "SELECT\n  CONCAT(REPEAT('长',300),CHAR(13 USING utf8mb4),CHAR(10 USING utf8mb4),'原换行') AS long_text";
    expect(prepare(input)).toBe("SELECT CONCAT(REPEAT('长',300),CHAR(13 USING utf8mb4),CHAR(10 USING utf8mb4),'原换行') AS long_text");
  });
  it('引号内的语句分隔符/注释样式只作为数据，不改变恶意HTML普通文本', () => {
    expect(prepare("SELECT\n  '# -- /* ;  <img src=x>' AS raw")).toBe("SELECT '# -- /* ;  <img src=x>' AS raw");
  });
  it.each([
    "SELECT '引号内\r\n原值'", "SELECT '未闭合", 'SELECT `未闭合', 'SELECT "未闭合', "SELECT 'a\\nb'", 'SELECT 1 -- 注释\n,2', 'SELECT 1 # 注释\n,2', 'SELECT /*注释*/ 1', 'SELECT 1; SELECT 2', '', 'UPDATE subject SET x=1', ' '.repeat(8193),
  ])('不支持的输入拒绝，不用宽松比对接受改写（样例%#）', source => {
    const original = source; expect(() => prepare(source)).toThrow('整行详情键盘fixture'); expect(source).toBe(original);
  });
  it('真实write在键盘前准备输入，完整正文及实际raw history/两次执行断言仍保持', () => {
    const source = readFileSync(new URL('../e2e/query-row-details-ui.ts', import.meta.url), 'utf8'), file = ts.createSourceFile('query-row-details-ui.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    let write = ''; const executions: string[] = [];
    function visit(node: ts.Node) {
      if (ts.isFunctionDeclaration(node) && node.name?.text === 'write') write = node.getText(file);
      if (ts.isCallExpression(node) && node.expression.getText(file) === 'execute') executions.push(node.arguments.map(value => value.getText(file)).join(','));
      ts.forEachChild(node, visit);
    }
    visit(file); expect(write.indexOf('sql = prepareQueryRowDetailsKeyboardSql(sql)')).toBeGreaterThan(0); expect(write.indexOf('sql = prepareQueryRowDetailsKeyboardSql(sql)')).toBeLessThan(write.indexOf('page.keyboard.insertText(sql)'));
    expect(write).toContain('inputEol(value.tabs.find(tab => tab.id === value.activeTabId)?.sql ?? \'\')'); expect(write).toContain('.toBe(sql)'); expect(write).not.toMatch(/\.trim\(|replace\(|replaceAll\(/u);
    expect(source).toContain('record.sql === raw'); expect(source).toContain('expect(final.map(record => record.sql).sort()).toEqual([first.raw, second.raw].sort())'); expect(source).toContain('expect(final).toHaveLength(2)'); expect(executions).toEqual(['sql.first,1', 'sql.second,2']);
    expect(source).not.toMatch(/(?:\.setValue|\.setState|dispatchEvent|autoIndent)\s*\(/u);
  });
});
