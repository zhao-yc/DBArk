import { describe, expect, it } from 'vitest';
import { parseTableColumnDefinition } from '../../src/engine/tableColumnDefinition';
import { tableCopyGeneratedDefinition } from '../../src/engine/tableCopyStructureGenerated';
import { tableCopyStructureRequiredAcknowledgements, tableCopyStructureAcknowledgements } from '../../src/shared/tableCopyStructure';
import { tableCopyStructureAcksComplete } from '../../src/renderer/tableCopyStructureUi';
import { validateCommand } from '../../src/shared/validation';

const context = { dialect: 'mysql' as const, mode: { ansiQuotes: false, noBackslashEscapes: false } };
/** 输入完整SHOW原件，测试期望独立声明，绝不通过表达式求值或产品重写器产生。 */
function ddl(expression: string, storage = 'VIRTUAL', prefix = '`a` int NOT NULL,`b` decimal(30,12) NOT NULL,', suffix = '') {
  return parseTableColumnDefinition(`CREATE TABLE \`t\` (${prefix}\`g\` decimal(50,12) GENERATED ALWAYS AS (${expression}) ${storage}${suffix}) ENGINE=InnoDB`, context);
}
describe('复制结构生成列表达式的保真最小范围', () => {
  it.each(['VIRTUAL', 'STORED'])('%s明确区分方式，保留数字精度、词法和重复引用顺序', storage => {
    const expression = ' ( `b` * -2.000000000001 ) + `a` + `b` + 9007199254740993.123456789012 ';
    expect(tableCopyGeneratedDefinition(ddl(expression, storage), '8.4.11')).toEqual([{ name: 'g', storage, expression, referencedColumns: ['b', 'a', 'b'] }]);
  });
  it('不解除通用字段编辑器的生成列只读状态', () => {
    const document = ddl('`a` + `b`'); expect(tableCopyGeneratedDefinition(document, '8.4.11')).toHaveLength(1);
    expect(document.columns[2].access.type.editable).toBe(false); expect(document.columns[2].default.kind).toBe('none');
  });
  it.each(['8.0.46', '5.7.44', '8.4.10', '8.4.12', '8.4.110', '8.4.11\n', '8.4.11-MariaDB'])('准确版本外%s不能借已有普通复制路径放行生成列', version => {
    expect(() => tableCopyGeneratedDefinition(ddl('`a` + 1'), version)).toThrow();
  });
  it('发行后缀仍只属于准确8.4.11', () => { expect(tableCopyGeneratedDefinition(ddl('`a`+1'), '8.4.11-0ubuntu')).toHaveLength(1); });
  it('Maria不能借版本文本放行', () => {
    const document = ddl('`a`+1'); document.context = { ...context, dialect: 'mariadb' };
    expect(() => tableCopyGeneratedDefinition(document, '8.4.11')).toThrow();
  });
  it.each(['RAND()', 'ABS(`a`)', 'DEFAULT(`a`)', '(SELECT 1)', 'a + 1', '`db`.`a` + 1', '`unknown` + 1', '`g` + 1', '`a` / 2', '`a` % 2', '`a` + 1e20', '`a` + 0x20', "`a` + '1'", '`a` + @x', '`a` /*未证明注释*/ + 1', '`a` +', '`a`(`b`)', '`a` = `b`'])('复杂或未知表达式%s拒绝，不eval也不猜测', expression => {
    expect(() => tableCopyGeneratedDefinition(ddl(expression), '8.4.11')).toThrow();
  });
  it.each(['PERSISTENT', '', 'VIRTUAL INVISIBLE', 'VIRTUAL DEFAULT NULL', 'STORED AUTO_INCREMENT'])('存储方式/属性%s未知时保持只读', storage => {
    expect(() => tableCopyGeneratedDefinition(ddl('`a`+1', storage), '8.4.11')).toThrow();
  });
  it.each(['`a` bigint NOT NULL AUTO_INCREMENT,', '`a` double,', '`a` varchar(20),'])('引用%s不是前置普通精确数值列', prefix => {
    expect(() => tableCopyGeneratedDefinition(ddl('`a`+1', 'VIRTUAL', prefix), '8.4.11')).toThrow();
  });
  it('拒绝前向引用和生成列链，不按名称猜拓扑', () => {
    expect(() => tableCopyGeneratedDefinition(ddl('`later`+1', 'VIRTUAL', '', ',`later` int'), '8.4.11')).toThrow();
    expect(() => tableCopyGeneratedDefinition(ddl('`a`+1', 'VIRTUAL', '`x` int,`a` int GENERATED ALWAYS AS (`x`+1) STORED,'), '8.4.11')).toThrow();
  });
  it('普通默认表达式依赖生成列也保持只读', () => {
    expect(() => tableCopyGeneratedDefinition(ddl('`a`+1', 'VIRTUAL', undefined, ',`later` int DEFAULT (`g`+1)'), '8.4.11')).toThrow();
  });
  it('有界深度、长度与引用次数不能透传给服务端当已证明', () => {
    for (const expression of ['('.repeat(18) + '`a`' + ')'.repeat(18), '`a`+'.repeat(33) + '1', '1'.repeat(66), '1+'.repeat(1025) + '1']) expect(() => tableCopyGeneratedDefinition(ddl(expression), '8.4.11')).toThrow();
  });
});

describe('生成列确认项和自增确认相互独立', () => {
  const generated = [{ name: 'g', storage: 'VIRTUAL' as const, expression: '`a`+1', referencedColumns: ['a'] }];
  it('普通三项不变；生成列增加一项，自增与生成列可同时要求五项', () => {
    expect(tableCopyStructureRequiredAcknowledgements()).toEqual(tableCopyStructureAcknowledgements);
    const required = tableCopyStructureRequiredAcknowledgements(undefined, generated); expect(required).toHaveLength(4); expect(required).toContain('generated-columns-copy');
    const both = tableCopyStructureRequiredAcknowledgements({} as any, generated); expect(both).toHaveLength(5); expect(tableCopyStructureAcksComplete(both, new Set(both))).toBe(true);
  });
  it('不能以自增勾选替代生成列，或反向替代', () => {
    const required = tableCopyStructureRequiredAcknowledgements(undefined, generated);
    expect(tableCopyStructureAcksComplete(required, new Set([...tableCopyStructureAcknowledgements, 'auto-increment-copy']))).toBe(false);
    expect(tableCopyStructureAcksComplete(tableCopyStructureRequiredAcknowledgements({} as any), new Set(required))).toBe(false);
  });
  it('五项确认只扩本用途确认枚举，不接受客户端生成表达式、计划或SQL', () => {
    const input = { previewToken: 'p', confirmation: 'db.copy', taskId: 't', acknowledgements: tableCopyStructureRequiredAcknowledgements({} as any, generated) };
    expect(() => validateCommand('schema.tableCopyStructure.apply', input)).not.toThrow();
    for (const extra of [{ sql: 'CREATE TABLE other' }, { generatedColumns: generated }, { expression: '`a`+2' }]) expect(() => validateCommand('schema.tableCopyStructure.apply', { ...input, ...extra })).toThrow();
  });
});
