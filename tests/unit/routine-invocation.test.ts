import { describe, expect, it } from 'vitest';
import { assertRoutineInvocationMetadata, buildRoutineInvocation, normalizeRoutineParameterType, parseRoutineCreateSignature, parseRoutineInvocationMetadata, parseRoutineInvocationTarget, routineInvocationLimits as limits, type RoutineInvocationMetadata, type RoutineInvocationParameter, type RoutineInvocationTarget } from '../../src/shared/routineInvocation';
import { routineInvocationZh as text } from '../../src/shared/routineInvocation.zh-CN';

const target: RoutineInvocationTarget = { connectionId: 'saved-connection', database: '研发`库', name: '中文`过程', kind: 'procedure' };
const nonce = '0123456789abcdef0123456789abcdef', fingerprint = 'a'.repeat(64);
const quote = (value: string) => '`' + value.replaceAll('`', '``') + '`';
function metadata(parameters: RoutineInvocationParameter[] = [], kind: 'procedure' | 'function' = 'procedure'): RoutineInvocationMetadata { return { ...target, kind, parameters, ...(kind === 'function' ? { returnType: 'DECIMAL(65,30)' } : {}), fingerprint }; }
function ddl(parameters = '', body = 'BEGIN SELECT 1; END'): string { return 'CREATE DEFINER=`root`@`localhost` PROCEDURE ' + quote(target.database) + '.' + quote(target.name) + '(' + parameters + ') ' + body; }
const inputs: RoutineInvocationParameter[] = [
  { ordinal: 1, name: '输入``名', mode: 'IN', type: 'BIGINT UNSIGNED' },
  { ordinal: 2, name: '输出,名', mode: 'OUT', type: 'DECIMAL(65,30)' },
  { ordinal: 3, name: '输入输出_中文', mode: 'INOUT', type: "ENUM('a,b',')','(','O''Reilly')" },
];

describe('例程调用草稿完整IN/OUT/INOUT合同', () => {
  it('过程按原ordinal保序，初始化/调用/输出/清值完整生成且参数值从不拼接', () => {
    const source = metadata(inputs), before = structuredClone(source), draft = buildRoutineInvocation(source, { nonce });
    expect(source).toEqual(before);
    expect(draft.arguments).toEqual([
      { ...inputs[0], placeholder: ':arg_1' }, { ...inputs[2], placeholder: ':arg_3' },
    ]);
    expect(draft.outputs).toEqual([
      { ordinal: 2, name: inputs[1].name, variable: '@dbark_call_' + nonce + '_2', column: 'out_2' },
      { ordinal: 3, name: inputs[2].name, variable: '@dbark_call_' + nonce + '_3', column: 'out_3' },
    ]);
    const variable2 = draft.outputs[0].variable, variable3 = draft.outputs[1].variable;
    expect(draft.sql.split('\n')).toEqual([
      `SET ${variable2} = NULL, ${variable3} = :arg_3;`,
      `CALL ${quote(target.database)}.${quote(target.name)}(:arg_1, ${variable2}, ${variable3});`,
      `SELECT ${variable2} AS \`out_2\`, ${variable3} AS \`out_3\`;`,
      `SET ${variable2} = NULL, ${variable3} = NULL;`,
    ]);
    for (const parameter of inputs) { expect(draft.sql).not.toContain(parameter.name); expect(draft.sql).not.toContain(parameter.type); }
    expect(draft.sql).not.toMatch(/DROP|DEALLOCATE|CREATE|EXECUTE/i);
    expect(draft.arguments.map(argument => argument.type)).toEqual(['BIGINT UNSIGNED', inputs[2].type]);
  });

  it('IN-only与零参数过程保留可完整执行的单句CALL，不伪造OUT或初始化', () => {
    const one = buildRoutineInvocation(metadata([inputs[0]]), { nonce }); expect(one.sql).toBe(`CALL ${quote(target.database)}.${quote(target.name)}(:arg_1);`); expect(one.outputs).toEqual([]);
    const zero = buildRoutineInvocation(metadata(), { nonce }); expect(zero.sql).toBe(`CALL ${quote(target.database)}.${quote(target.name)}();`); expect(zero.arguments).toEqual([]);
  });

  it('函数与零参数函数SELECT独立return_value列，return ordinal0不混入参数', () => {
    const one = buildRoutineInvocation(metadata([inputs[0]], 'function'), { nonce }); expect(one.sql).toBe(`SELECT ${quote(target.database)}.${quote(target.name)}(:arg_1) AS \`return_value\`;`); expect(one.outputs).toEqual([]);
    const zero = buildRoutineInvocation(metadata([], 'function'), { nonce }); expect(zero.sql).toContain('() AS `return_value`;'); expect(zero.arguments).toEqual([]);
    expect(() => parseRoutineInvocationMetadata(metadata([{ ...inputs[0], ordinal: 0 }], 'function'))).toThrow(text.invalid);
    expect(() => parseRoutineInvocationMetadata(metadata([{ ...inputs[0], mode: 'INOUT' }], 'function'))).toThrow(text.invalid);
    const missing = metadata([], 'function'); delete missing.returnType; expect(() => parseRoutineInvocationMetadata(missing)).toThrow(text.invalid);
    expect(() => parseRoutineInvocationMetadata({ ...metadata(), returnType: 'INT' })).toThrow(text.invalid);
  });

  it('每份草稿默认使用独立32hex变量，显式nonce可重复重建同一预览，未知选项拒绝', () => {
    const first = buildRoutineInvocation(metadata(inputs)), second = buildRoutineInvocation(metadata(inputs));
    expect(first.nonce).toMatch(/^[a-f0-9]{32}$/); expect(first.nonce).not.toBe(second.nonce); expect(first.outputs[0].variable).not.toBe(second.outputs[0].variable);
    expect(buildRoutineInvocation(metadata(inputs), { nonce }).sql).toBe(buildRoutineInvocation(metadata(inputs), { nonce }).sql);
    for (const candidate of ['', 'F'.repeat(32), 'a'.repeat(31), 'a'.repeat(33), 'x; SELECT 1']) expect(() => buildRoutineInvocation(metadata(inputs), { nonce: candidate })).toThrow(text.invalid);
    expect(() => buildRoutineInvocation(metadata(), { nonce, values: ['9007199254740993'] } as any)).toThrow(text.invalid);
  });

  it('列型原串只用于参数窗口展示，不做Number转换或通过类型/参数名注入SQL', () => {
    const untrusted = metadata([{ ordinal: 1, name: 'x; DROP TABLE t', mode: 'IN', type: "DECIMAL(65,30); SELECT '18446744073709551615.0000000000000000001'" }]);
    const draft = buildRoutineInvocation(untrusted, { nonce }); expect(draft.arguments[0].type).toBe(untrusted.parameters[0].type); expect(draft.sql).toContain(':arg_1'); expect(draft.sql).not.toContain('18446744073709551615'); expect(draft.sql).not.toContain('DROP TABLE'); expect(draft.sql).not.toContain('DECIMAL');
  });
});

describe('SHOW CREATE真实头签名与保存SQL模式', () => {
  it('可引用中文/反引号/跨库名，复合类型逗号与字面量括号不切断参数', () => {
    const definition = ddl('IN ' + quote(inputs[0].name) + ' BIGINT UNSIGNED, OUT ' + quote(inputs[1].name) + ' DECIMAL(65,30), INOUT ' + quote(inputs[2].name) + ' ' + inputs[2].type);
    const signature = parseRoutineCreateSignature(definition, '', target); expect(signature.parameters).toEqual(inputs); expect(signature).not.toHaveProperty('returnType');
    expect(() => assertRoutineInvocationMetadata(metadata(inputs), signature)).not.toThrow();
  });

  it('纯注释、字符串及正文中的伪参数不成为签名，零参数仍需要完整定义', () => {
    const signature = parseRoutineCreateSignature(ddl('/* 注释中的 IN fake INT, OUT nope INT */', "COMMENT 'IN bad INT, OUT x DECIMAL(9,2)' BEGIN SELECT '(OUT fake INT)'; END"), '', target);
    expect(signature.parameters).toEqual([]); expect(() => assertRoutineInvocationMetadata(metadata(), signature)).not.toThrow();
    const unqualified = 'CREATE OR REPLACE DEFINER=CURRENT_USER() PROCEDURE ' + quote(target.name) + '() BEGIN END'; expect(parseRoutineCreateSignature(unqualified, '', target).parameters).toEqual([]);
    expect(parseRoutineCreateSignature(unqualified.replace('CURRENT_USER()', 'CURRENT_USER'), '', target).parameters).toEqual([]);
  });

  it('确定真实正文起点后不解析正文，不把正文版本注释误当头签名或宣称验收正文语法', () => {
    const signature = parseRoutineCreateSignature(ddl('IN x INT', "BEGIN /*!50003 SELECT 1 */ SELECT '正文不由此解析器验收"), '', target);
    expect(signature.parameters).toEqual([{ ordinal: 1, name: 'x', mode: 'IN', type: 'INT' }]);
  });

  it.each([
    'COMMIT', 'ROLLBACK', 'CREATE TABLE example(id INT)', "PREPARE stmt FROM 'SELECT 1'", 'EXECUTE stmt',
    'DEALLOCATE PREPARE stmt', 'TRUNCATE TABLE example', 'ALTER TABLE example ADD COLUMN v INT',
  ])('合法单语句过程正文%s不受SQL根词白名单限制，正文后续不读取', body => {
    expect(parseRoutineCreateSignature(ddl('IN x INT', body), '', target).parameters).toEqual([{ ordinal: 1, name: 'x', mode: 'IN', type: 'INT' }]);
    // 正文由SHOW CREATE来源保证；这类尾部故意不能词法解析，用于证明头解析器不会冒充正文验证器。
    expect(parseRoutineCreateSignature(ddl('', body + " /*!50003 特殊SQL */ '正文后续不解析"), '', target).parameters).toEqual([]);
  });

  it('引用标签及冒号是正文的一部分，不因标签被反引号或ANSI双引号引用而拒绝', () => {
    expect(parseRoutineCreateSignature(ddl('', '`中文``标签`: BEGIN COMMIT; END `中文``标签`'), '', target).parameters).toEqual([]);
    expect(parseRoutineCreateSignature(ddl('', '"中文""标签": BEGIN COMMIT; END "中文""标签"'), 'ANSI_QUOTES', target).parameters).toEqual([]);
  });

  it.each(['ENUM', 'SET'])('函数RETURNS %s与charset/characteristics必须完整消费，不误停在类型或其字面量', type => {
    const returnType = type + "('a,b',')','(','COMMENT','SET') CHARACTER SET utf8mb4 COLLATE utf8mb4_bin";
    const signature = parseRoutineCreateSignature('CREATE FUNCTION ' + quote(target.name) + '() RETURNS ' + returnType + " COMMENT '返回类型说明' DETERMINISTIC RETURN 'a,b'", '', { ...target, kind: 'function' });
    expect(signature.returnType).toBe(returnType); expect(signature.parameters).toEqual([]);
  });

  it('头部缺失或截断、只有characteristics或分号均不能被当成非空正文', () => {
    for (const body of ['', "COMMENT '仅特性'", 'LANGUAGE SQL SQL SECURITY DEFINER', ';']) expect(() => parseRoutineCreateSignature(ddl('', body), '', target)).toThrow(text.definitionUnavailable);
    for (const rest of ['', 'RETURNS', "RETURNS ENUM('未闭合)", "RETURNS SET('a',)", "RETURNS INT COMMENT '仅特性'", 'RETURNS INT DETERMINISTIC', 'RETURNS INT;']) expect(() => parseRoutineCreateSignature('CREATE FUNCTION ' + quote(target.name) + '() ' + rest, '', { ...target, kind: 'function' })).toThrow(text.definitionUnavailable);
  });

  it('ANSI_QUOTES只在保存模式中把双引号当名称，NO_BACKSLASH_ESCAPES保留原字符串语义', () => {
    const ansi = { ...target, database: '研发库', name: '中文"函数', kind: 'function' as const };
    const definition = 'CREATE FUNCTION "研发库"."中文""函数"("参" DECIMAL(65,30), "枚" ENUM(\'a,b\',\')\',\'\\\')) RETURNS VARCHAR(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin RETURN \'原文\'';
    const parsed = parseRoutineCreateSignature(definition, 'ANSI_QUOTES,NO_BACKSLASH_ESCAPES', ansi); expect(parsed.parameters.map(parameter => parameter.name)).toEqual(['参', '枚']); expect(parsed.returnType).toContain('VARCHAR(30)');
    expect(() => parseRoutineCreateSignature(definition, '', ansi)).toThrow(text.definitionUnavailable);
    expect(normalizeRoutineParameterType("ENUM('a\\nb','O''Reilly')", '')).toBe(normalizeRoutineParameterType("ENUM('a\nb','O''Reilly')", 'NO_BACKSLASH_ESCAPES'));
    expect(normalizeRoutineParameterType("ENUM('a\\nb')", 'NO_BACKSLASH_ESCAPES')).not.toBe(normalizeRoutineParameterType("ENUM('a\\nb')", ''));
  });

  it('函数RETURNS与ordinal0独立核验，CHARACTER SET/COLLATE不混入调用语句', () => {
    const fn = { ...target, kind: 'function' as const }, definition = 'CREATE FUNCTION ' + quote(target.name) + '(arg INTEGER) RETURNS NUMERIC(65,30) DETERMINISTIC SQL SECURITY INVOKER RETURN arg';
    const signature = parseRoutineCreateSignature(definition, '', fn); expect(signature.parameters).toEqual([{ ordinal: 1, name: 'arg', mode: 'IN', type: 'INTEGER' }]); expect(signature.returnType).toBe('NUMERIC(65,30)');
    const catalog = metadata([{ ordinal: 1, name: 'arg', mode: 'IN', type: 'int(11)' }], 'function'); expect(() => assertRoutineInvocationMetadata(catalog, signature)).not.toThrow();
    expect(() => assertRoutineInvocationMetadata({ ...catalog, returnType: 'BIGINT' }, signature)).toThrow(text.metadataChanged);
  });

  it.each([
    ['integer(11)', 'INT'], ['BOOL', 'tinyint(1)'], ['BOOLEAN', 'TINYINT'], ['NUMERIC(20,8)', 'decimal(20,8)'],
    ['DECIMAL', 'DECIMAL(10,0)'], ['CHAR', 'CHARACTER(1)'], ['DOUBLE PRECISION', 'DOUBLE'],
    ['REAL', 'DOUBLE'], ['FLOAT(24)', 'FLOAT'], ['FLOAT(53)', 'DOUBLE'], ['DATETIME(0)', 'DATETIME'], ['BIT', 'BIT(1)'],
    ['VARCHAR(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin', 'varchar(30)'], ['INT ZEROFILL', 'INT UNSIGNED ZEROFILL'],
  ])('常见目录/SHOW别名%s与%s规范等价，但不把展示类型拼入SQL', (left, right) => { expect(normalizeRoutineParameterType(left)).toBe(normalizeRoutineParameterType(right)); });

  it('REAL_AS_FLOAT按创建时模式解释别名，而非按当前连接模式猜测', () => { expect(normalizeRoutineParameterType('REAL', 'REAL_AS_FLOAT')).toBe('FLOAT'); expect(normalizeRoutineParameterType('REAL', '')).toBe('DOUBLE'); });

  it('权限过滤的空目录不能冒充零参，数量、名称、mode、type任一漂移均拒绝', () => {
    const signature = parseRoutineCreateSignature(ddl('IN x BIGINT, OUT y DECIMAL(65,30)'), '', target), catalog = metadata([{ ordinal: 1, name: 'x', mode: 'IN', type: 'BIGINT' }, { ordinal: 2, name: 'y', mode: 'OUT', type: 'DECIMAL(65,30)' }]);
    expect(() => assertRoutineInvocationMetadata(metadata(), signature)).toThrow(text.metadataChanged);
    for (const change of [(value: RoutineInvocationMetadata) => { value.parameters[0].name = 'other'; }, (value: RoutineInvocationMetadata) => { value.parameters[0].mode = 'INOUT'; }, (value: RoutineInvocationMetadata) => { value.parameters[0].type = 'TEXT'; }]) { const altered = structuredClone(catalog); change(altered); expect(() => assertRoutineInvocationMetadata(altered, signature)).toThrow(text.metadataChanged); }
  });

  it.each([
    '', 'CREATE PROCEDURE', 'CREATE PROCEDURE p(', 'CREATE PROCEDURE p(a DECIMAL(10,2)',
    'CREATE PROCEDURE p(IN x INT,) BEGIN END', 'CREATE PROCEDURE p(,IN x INT) BEGIN END',
    'CREATE PROCEDURE p(IN x INT, OUT x INT) BEGIN END', 'CREATE PROCEDURE p(IN x INT)',
    'CREATE PROCEDURE p() COMMENT',
    "CREATE PROCEDURE p(x ENUM('unclosed)) BEGIN END", 'CREATE PROCEDURE p() /* 截断',
    '/*!50003 CREATE*/ PROCEDURE p() BEGIN END', 'CREATE FUNCTION p() RETURNS INT RETURN 1',
  ])('损坏/缺失/截断定义%j不能得到可用参数签名', definition => { expect(() => parseRoutineCreateSignature(definition, '', { ...target, name: 'p' })).toThrow(); });

  it('目标库/名/kind必须准确，不从字符串或额外CREATE猜入口', () => {
    for (const wrong of [{ ...target, database: '别的库' }, { ...target, name: '别的名' }, { ...target, kind: 'function' as const }]) expect(() => parseRoutineCreateSignature(ddl(), '', wrong)).toThrow(text.definitionUnavailable);
    expect(() => parseRoutineCreateSignature('SELECT \'CREATE PROCEDURE p()\'; ' + ddl(), '', target)).toThrow(text.definitionUnavailable);
    expect(() => parseRoutineCreateSignature(ddl(), 'ORACLE', target)).toThrow(text.definitionUnavailable);
  });
});

describe('不可信目录与有界生成', () => {
  it('连续ordinal、唯一参数名、模式、SHA指纹和完整type都必须有效', () => {
    for (const parameters of [[{ ...inputs[0], ordinal: 2 }], [{ ...inputs[0], ordinal: 0 }], [inputs[0], { ...inputs[0], ordinal: 2, name: inputs[0].name.toUpperCase() }], [{ ...inputs[0], mode: 'UNKNOWN' }], [{ ...inputs[0], type: '' }]]) expect(() => parseRoutineInvocationMetadata(metadata(parameters as RoutineInvocationParameter[]))).toThrow(text.invalid);
    for (const value of ['', 'A'.repeat(64), 'a'.repeat(63)]) expect(() => parseRoutineInvocationMetadata({ ...metadata(), fingerprint: value })).toThrow(text.invalid);
    expect(() => parseRoutineInvocationTarget({ ...target, host: 'untrusted.invalid' })).toThrow(text.invalid);
    expect(() => parseRoutineInvocationMetadata({ ...metadata(), definition: '原DDL不能混入回包' })).toThrow(text.invalid);
  });

  it('访问器/自定义迭代器/稀疏列表零执行拒绝，返回独立参数副本', () => {
    let reads = 0; const getter = metadata(inputs); Object.defineProperty(getter, 'parameters', { enumerable: true, get() { reads++; return inputs; } }); expect(() => parseRoutineInvocationMetadata(getter)).toThrow(text.invalid);
    const iterable = metadata([...inputs]); Object.defineProperty(iterable.parameters, Symbol.iterator, { value() { reads++; throw Error('不可执行'); } }); expect(() => parseRoutineInvocationMetadata(iterable)).toThrow(text.invalid);
    const sparse = metadata([...inputs]); delete sparse.parameters[0]; expect(() => parseRoutineInvocationMetadata(sparse)).toThrow(text.invalid); expect(reads).toBe(0);
    const original = metadata(inputs), checked = parseRoutineInvocationMetadata(original); checked.parameters[0].name = '副本'; expect(original.parameters[0].name).toBe(inputs[0].name);
  });

  it('参数/DDL/type/name等超过预算明确拒绝，不截断为较短草稿', () => {
    expect(() => parseRoutineInvocationMetadata(metadata(Array(limits.parameters + 1)))).toThrow(text.budget);
    expect(() => parseRoutineCreateSignature('x'.repeat(limits.definitionBytes + 1), '', target)).toThrow(text.budget);
    expect(() => parseRoutineInvocationMetadata(metadata([{ ...inputs[0], type: 'x'.repeat(limits.typeBytes + 1) }]))).toThrow(text.budget);
    expect(() => parseRoutineInvocationTarget({ ...target, name: '中'.repeat(65) })).toThrow(text.budget);
    const many = metadata(Array.from({ length: limits.parameters }, (_, index) => ({ ordinal: index + 1, name: 'p' + index, mode: 'IN' as const, type: 'TEXT ' + 'x'.repeat(limits.typeBytes - 5) })));
    expect(() => parseRoutineInvocationMetadata(many)).toThrow(text.budget);
  });

  it('200个函数入参仍合法，returnType另存，不错误缩减为199入参', () => {
    const value = metadata(Array.from({ length: 200 }, (_, index) => ({ ordinal: index + 1, name: 'p' + index, mode: 'IN' as const, type: 'INT' })), 'function'); const draft = buildRoutineInvocation(value, { nonce }); expect(draft.arguments).toHaveLength(200); expect(draft.sql).toContain(':arg_200'); expect(draft.sql).not.toContain(':arg_0');
  });
});
