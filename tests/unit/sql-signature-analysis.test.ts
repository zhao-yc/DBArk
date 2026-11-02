import { describe, expect, it } from 'vitest';
import { analyzeSqlSignature } from '../../src/renderer/sqlSignatureAnalysis';
import { signatureLexicalContext } from '../../src/shared/completionLexical';

/** 光标标记只定位UTF16，不调用产品扫描器构造预期。 */
function read(marked: string, dialect: 'mysql' | 'mariadb' | 'sqlite' = 'mysql', mode = {}) { const offset = marked.indexOf('┃'); expect(offset).toBeGreaterThanOrEqual(0); return analyzeSqlSignature(marked.replace('┃', ''), offset, dialect, mode); }
describe('函数调用的有界参数定位', () => {
  it.each([
    ['SELECT SUBSTR(┃', 'SUBSTR', 0, 0], ['SELECT SUBSTR(\'abc\',┃2)', 'SUBSTR', 1, 1], ['SELECT SUBSTR(\'abc\',2,┃3)', 'SUBSTR', 2, 2],
    ['SELECT CONCAT(\'a,b\', /* , */┃IFNULL(1,2))', 'CONCAT', 1, 0],
    ['SELECT IFNULL((SELECT ABS(1)),┃0)', 'IFNULL', 1, 1], ['SELECT CONCAT(\'a\', IFNULL(1,┃2))', 'IFNULL', 1, 1],
    ['SELECT COALESCE(\'未闭合,┃', 'COALESCE', 0, 0], ['SELECT SUBSTR(\'前🚢,文\',1,┃2)', 'SUBSTR', 2, 2],
    ['SELECT CONCAT(`x,y`,┃1)', 'CONCAT', 1, 0], ['SELECT SUM(1), SUM(┃2)', 'SUM', 0, 0],
    ['DELIMITER $$\nCREATE PROCEDURE p() BEGIN SELECT CONCAT(1,┃2); END$$', 'CONCAT', 1, 0],
  ] as const)('%s', (source, name, argument, activeParameter) => { expect(read(source)).toMatchObject({ name, argument, activeParameter }); });
  it.each([
    'SELECT IFNULL(UDF(┃1),0)', 'SELECT db.CONCAT(┃1)', 'SELECT `CONCAT`(┃1)', 'SELECT :MAX(┃1)',
    'SELECT ABS(1); ┃', 'SELECT ABS(1) /*┃*/', "SELECT ABS(1) -- ┃", 'SELECT /*! CONCAT(┃1) */',
    'CREATE TABLE max(┃x)', 'CREATE TABLE IF NOT EXISTS max(┃x)', 'INSERT INTO max(┃x)', 'WITH abs(┃x) AS (SELECT 1) SELECT * FROM abs',
    'WITH c AS (SELECT 1), max(┃x) AS (SELECT 1) SELECT * FROM max', 'SELECT SUBSTR(1,2,3,┃4)', 'SELECT SUBSTRING(\'a\' FROM ┃1)',
  ])('拒绝不明确调用或专用语法 %s', source => { expect(read(source)).toBeUndefined(); });
  it('SQLite类型及函数形态独立，不借用MySQL字符转义、注释或可变参数', () => {
    expect(read('SELECT TRIM(\'x\',┃\'y\')', 'sqlite')).toMatchObject({ name: 'TRIM', argument: 1 }); expect(read('SELECT TRIM(\'x\',┃\'y\')')).toBeUndefined();
    expect(read('SELECT MAX(1,┃2)', 'sqlite')).toMatchObject({ name: 'MAX', argument: 1 }); expect(read('SELECT MAX(1,┃2)')).toBeUndefined();
    expect(read('SELECT IFNULL([x,y],┃1)', 'sqlite')).toMatchObject({ name: 'IFNULL', argument: 1 });
    expect(read("SELECT IFNULL('\\',┃1)", 'sqlite')).toMatchObject({ argument: 1 });
    expect(read('SELECT IFNULL(1--x┃,2)', 'sqlite')).toBeUndefined(); expect(read('SELECT IFNULL(1--x┃,2)')).toMatchObject({ argument: 0 });
    expect(read('SELECT CONCAT(┃1)', 'sqlite')).toBeUndefined(); expect(read('SELECT TOTAL(┃1)', 'sqlite')).toMatchObject({ name: 'TOTAL' });
  });
  it('未知MySQL模式仅在四种词法结果一致时提示，确认模式后采用准确引号规则', () => {
    expect(read('SELECT CONCAT("a,b",┃1)')).toBeUndefined(); expect(read('SELECT CONCAT("a,b",┃1)', 'mysql', { ansiQuotes: true })).toMatchObject({ argument: 1 });
    expect(read('SELECT CONCAT("a,b",┃1)', 'mysql', { ansiQuotes: false })).toMatchObject({ argument: 1 }); expect(read('SELECT CONCAT(1,┃2)', 'mariadb')).toMatchObject({ name: 'CONCAT' });
  });
  it('COUNT DISTINCT形式按方言保留精确参数形式，普通COUNT不当作多参数调用', () => {
    expect(read('SELECT COUNT(DISTINCT a,┃b)')).toMatchObject({ name: 'COUNT', argument: 1, activeParameter: 0 });
    expect(read('SELECT COUNT(DISTINCT a,┃b)', 'sqlite')).toBeUndefined(); expect(read('SELECT COUNT(a,┃b)')).toBeUndefined();
    expect(read('SELECT COUNT(DISTINCT ┃a)', 'sqlite')?.signatures[0].distinct).toBe(true);
  });
  it('空白、注释与字符串中的逗号只定位原调用，不修改原SQL或编号', () => {
    const source = 'SELECT SUBSTR(\'a, /*b*/\', /* \"),\" */ 2, 3)'; const result = analyzeSqlSignature(source, source.lastIndexOf('3'), 'mysql'); expect(result).toMatchObject({ name: 'SUBSTR', open: source.indexOf('('), argument: 2 });
  });
  it('来源、位置、括号深度及token预算整份拒绝，不跨UTF16代理边界', () => {
    expect(analyzeSqlSignature('x'.repeat(262145), 0, 'mysql')).toBeUndefined(); expect(analyzeSqlSignature('SELECT ABS(1)', -1, 'sqlite')).toBeUndefined();
    expect(analyzeSqlSignature('SELECT ABS(🚢)', 12, 'sqlite')).toBeUndefined(); expect(read('SELECT ABS(' + '('.repeat(65) + '┃')).toBeUndefined();
    expect(signatureLexicalContext('SELECT ABS(1)\0', 11, 'sqlite').status).toBe('blocked');
    const source = 'SELECT ABS(' + 'a+'.repeat(17000); expect(analyzeSqlSignature(source, source.length, 'mysql')).toBeUndefined();
  });
});
