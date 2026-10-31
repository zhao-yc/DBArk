import { describe, expect, it } from 'vitest';
import { sqliteNamedParameterNames } from '../../src/engine/sqlite/parameters';

describe('SQLite参数名纯词法与整篇预算', () => {
  it('重复与跨语句按首现序返回，不把普通标识符内部美元或引用内假参数算进去', () => {
    expect(sqliteNamedParameterNames('SELECT :z,:a,:z,normal$column,"@quoted",[?方名],`$反名`,\':字;?\';INSERT INTO t VALUES(:a,:tail);')).toEqual(['z', 'a', 'tail']);
  });
  it('SQLite双减号无空格、普通不嵌套块注释和BOM/CRLF按自身规则，不解释MySQL执行注释', () => {
    expect(sqliteNamedParameterNames('\uFEFF SELECT :ok--:hidden ? @x\r\n;/*! :hidden2 */SELECT :next;')).toEqual(['ok', 'next']);
    expect(sqliteNamedParameterNames('SELECT :a /* outer /* inner */ ,:b')).toEqual(['a', 'b']);
  });
  it('触发器完整体和引用倍写均不把内部引用拆成参数或独立SQL', () => {
    expect(sqliteNamedParameterNames('CREATE TRIGGER t AFTER INSERT ON a BEGIN INSERT INTO b VALUES(\':fake\'\';\',"双""?:引",`反``:引`); END;SELECT :real;')).toEqual(['real']);
  });
  it.each(['?', '?12', '@value', '$value', '$value::namespace', ':1bad', ':中文', ':ascii中文', ':' + 'a'.repeat(65), ':a$b', ':a::b'])('不接受的%s格式在前序写入之前整篇拒绝', parameter => {
    expect(() => sqliteNamedParameterNames('INSERT INTO t VALUES(1); SELECT ' + parameter)).toThrow(/参数/);
  });
  it.each(['', ' ; --只有注释', '/*没有SQL*/;', 'SELECT :a; SELECT \'未闭合', 'SELECT :a; /*未闭合', 'SELECT :a; CREATE TRIGGER t AFTER INSERT ON a BEGIN SELECT 1;', 'DELIMITER $$\nSELECT :a$$', 'SELECT :a;\0'])('空或未完成模板%j不回退执行前句', source => {
    expect(() => sqliteNamedParameterNames(source)).toThrow();
  });
  it('200个不同参数和10万次重复引用的边界保留，超出整篇拒绝', () => {
    const names = Array.from({ length: 200 }, (_, index) => ':n' + index);
    expect(sqliteNamedParameterNames('SELECT ' + names.join(','))).toHaveLength(200); expect(() => sqliteNamedParameterNames('SELECT ' + [...names, ':overflow'].join(','))).toThrow('200');
    expect(sqliteNamedParameterNames('SELECT ' + Array(100000).fill(':one').join(','))).toEqual(['one']); expect(() => sqliteNamedParameterNames('SELECT ' + Array(100001).fill(':one').join(','))).toThrow('100000');
  });
});
