import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../e2e/table-copy-data-live.ts', import.meta.url), 'utf8');
type Row = { id: string; amount: string | null; payload: string | null; payloadNull: number; note: string | null };
const rows: Row[] = [
  { id: '18446744073709551614', amount: null, payload: '', payloadNull: 0, note: '' },
  { id: '0', amount: '9007199254740993.123456789012345678901234567890', payload: '00FF275C80', payloadNull: 0, note: null },
  { id: '9007199254740993', amount: '-123.000000000000000000000000000001', payload: null, payloadNull: 1, note: '合成行' },
];

/** 只提取正式用例的真实观察SQL函数，不加载桌面、驱动、认证helper或环境。 */
function observerSql(table: string): string {
  const tree = ts.createSourceFile('table-copy-data-live.ts', source, ts.ScriptTarget.Latest, true);
  let arrow: ts.ArrowFunction | undefined;
  const visit = (node: ts.Node): void => { if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'values' && node.initializer && ts.isArrowFunction(node.initializer)) { if (arrow) throw Error('观察函数不唯一'); arrow = node.initializer; } ts.forEachChild(node, visit); };
  visit(tree); if (!arrow) throw Error('缺少正式观察函数');
  const context = createContext({ table });
  return runInContext(ts.transpileModule(`(${arrow.getText(tree)})(table)`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
}

/**
 * 仅模型化本观察查询的名称解析，不执行MySQL，也不声称替代实库排序验收。
 * 官方规则：未限定ORDER BY先查SELECT输出，故id命中CAST后的文字别名；
 * 限定基表别名才使用BIGINT。RAM数值比较使用BigInt，不将行值转换为Number。
 * https://dev.mysql.com/doc/refman/8.4/en/select.html
 */
function modelObservedRows(sql: string, input: readonly Row[]): Row[] {
  const match = /^SELECT CAST\(id AS CHAR\) AS id,CAST\(amount AS CHAR\) AS amount,HEX\(payload\) AS payload,payload IS NULL AS payloadNull,note FROM (`[^`]+`\.`[^`]+`)(?: AS ([a-z_]+))? ORDER BY ([a-z_]+\.)?id$/u.exec(sql);
  if (!match) throw Error('观察SQL超出本反例模型，不猜测排序语义');
  const alias = match[2], qualifier = match[3];
  if (qualifier && qualifier !== alias + '.') throw Error('ORDER BY没有引用本查询的基表');
  return [...input].sort((left, right) => qualifier
    ? BigInt(left.id) < BigInt(right.id) ? -1 : BigInt(left.id) > BigInt(right.id) ? 1 : 0
    : left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
}

describe('数据复制正式观察SQL的BIGINT排序回归（仅RAM）', () => {
  it('原未限定别名确实产生1339收到的文字顺序，不能据此声称产品丢精度', () => {
    const old = 'SELECT CAST(id AS CHAR) AS id,CAST(amount AS CHAR) AS amount,HEX(payload) AS payload,payload IS NULL AS payloadNull,note FROM `unit_db`.`copy_source` ORDER BY id';
    expect(modelObservedRows(old, rows).map(row => row.id)).toEqual(['0', '18446744073709551614', '9007199254740993']);
  });
  it.each(['copy_source', 'copy_destination'])('%s真实观察函数必须按基表BIGINT列排序，准确文字投影不变', table => {
    const sql = observerSql('`unit_db`.`' + table + '`'), ordered = modelObservedRows(sql, rows);
    expect(ordered).toEqual([rows[1], rows[2], rows[0]]);
    expect(ordered.map(row => row.id)).toEqual(['0', '9007199254740993', '18446744073709551614']);
    expect(sql).toContain('FROM `unit_db`.`' + table + '` AS source_row ORDER BY source_row.id');
  });
  it('空表仍返回空观察结果', () => { expect(modelObservedRows(observerSql('`unit_db`.`copy_source`'), [])).toEqual([]); });
  it('排序仅改变行序，不改DECIMAL文字、NULL、空字节或00FF275C80', () => {
    const result = modelObservedRows(observerSql('`unit_db`.`copy_source`'), rows);
    for (const row of rows) expect(result.find(item => item.id === row.id)).toBe(row);
    expect(rows.map(row => row.id)).toEqual(['18446744073709551614', '0', '9007199254740993']);
  });
});
