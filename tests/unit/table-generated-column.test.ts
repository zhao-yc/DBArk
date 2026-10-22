import { describe, expect, it } from 'vitest';
import { assertAddedGeneratedColumn, generatedColumnAcknowledgement, generatedColumnSchema, parseGeneratedColumnExpression } from '../../src/shared/tableGeneratedColumn';
import { validateColumnPatches, type ColumnPatch, type TableDefinitionContext } from '../../src/shared/tableColumnPatches';
import { compileGeneratedColumnExpression, isGeneratedColumnReference, readGeneratedColumnDefinition, sameGeneratedColumnExpression } from '../../src/engine/tableGeneratedColumn';
import { parseTableColumnDefinition } from '../../src/engine/tableColumnDefinition';
import { buildTableColumnPatchSql } from '../../src/engine/tableColumnPatchSql';
import { splitSql } from '../../src/engine/sql';

const mysql: TableDefinitionContext = { dialect: 'mysql', mode: { noBackslashEscapes: false, ansiQuotes: false } };
const source = 'CREATE TABLE `subject` (`qty` int NOT NULL,`price` decimal(30,12) NULL,`note` varchar(20) DEFAULT NULL,PRIMARY KEY (`qty`)) ENGINE=InnoDB';
const document = (sql = source, context = mysql) => parseTableColumnDefinition(sql, context);
/** 保留原ADD合同与不透明身份，生成属性不能夹带任何SQL计划或列位置。 */
function add(expression = 'qty * price + 9007199254740993.123456789012', storage: 'VIRTUAL' | 'STORED' = 'VIRTUAL'): Extract<ColumnPatch, { kind: 'add' }> {
  return { kind: 'add', clientKey: 'new-total', name: 'total', type: { kind: 'decimal', precision: 65, scale: 12, unsigned: false }, nullable: true, default: { kind: 'none' }, comment: '计算金额', position: { kind: 'last' }, generated: { storage, expression } };
}
function plan(patches: unknown, context = mysql, version = '8.4.11', sql = source) {
  const parsed = document(sql, context);
  return buildTableColumnPatchSql(parsed, patches, { database: 'test', serverVersion: version, columnRefs: new Map(parsed.columns.map((column, index) => ['ref-' + index, column.name])) });
}
/** 平衡生成引用树，让引用次数门独立于运算树深度门。 */
function balanced(values: string[]): string { if (values.length === 1) return values[0]; const middle = Math.floor(values.length / 2); return '(' + balanced(values.slice(0, middle)) + '+' + balanced(values.slice(middle)) + ')'; }

describe('数值生成列共享表达式语法', () => {
  it('加减乘优先级、结合及一元正负构成明确AST，不调用数值求值', () => {
    const result = parseGeneratedColumnExpression('qty + -price * (.50 - +2)');
    expect(result.referencedColumns).toEqual(['qty', 'price']);
    expect(result.ast).toEqual({ kind: 'binary', operator: '+', left: { kind: 'column', name: 'qty' }, right: { kind: 'binary', operator: '*', left: { kind: 'unary', operator: '-', operand: { kind: 'column', name: 'price' } }, right: { kind: 'binary', operator: '-', left: { kind: 'number', value: '0.50' }, right: { kind: 'unary', operator: '+', operand: { kind: 'number', value: '2' } } } } });
  });
  it('超安全整数与小数末位按字符串保留，正规化不抹去十进制尺度', () => {
    const value = '9007199254740993.123456789012';
    expect(parseGeneratedColumnExpression(value).ast).toEqual({ kind: 'number', value });
    expect(parseGeneratedColumnExpression('0001.2300').ast).toEqual({ kind: 'number', value: '1.2300' });
    expect(parseGeneratedColumnExpression('.0000').ast).toEqual({ kind: 'number', value: '0.0000' });
    expect(parseGeneratedColumnExpression('1.').ast).toEqual({ kind: 'number', value: '1' });
    expect(() => parseGeneratedColumnExpression('9'.repeat(66))).toThrow();
  });
  it('裸名字、Unicode、反引号双写及标识符内部文字保持准确身份', () => {
    expect(parseGeneratedColumnExpression('数量 * `单价``含号` + `a--b#c`').referencedColumns).toEqual(['数量', '单价`含号', 'a--b#c']);
    expect(parseGeneratedColumnExpression('`😀`').referencedColumns).toEqual(['😀']);
    for (const expression of ['`\0`', '`\ud800`', '`\udc00`', '``', '`' + 'x'.repeat(65) + '`']) expect(() => parseGeneratedColumnExpression(expression)).toThrow();
  });
  it.each(['', ' ', "'qty'", '"qty"', 'qty; DROP TABLE subject', 'qty /*注释*/ + 1', 'qty -- 注释\n+1', 'qty#注释', 'qty/price', 'qty%price', '@x', '@@sql_mode', 'RAND()', 'ABS(qty)', 'DEFAULT(qty)', '(SELECT 1)', 'db.qty', 'qty COLLATE utf8mb4_bin', '1e2', '0x10', '0b10', 'qty price', 'qty,price', 'qty)', '(qty', 'qty+', '*qty', 'qty/**/price'])('拒绝未开放语法 %j', expression => { expect(() => parseGeneratedColumnExpression(expression)).toThrow(); });
  it('长度、token、括号/运算树深度及引用次数分别有界', () => {
    expect(parseGeneratedColumnExpression('1' + ' '.repeat(2047)).ast).toEqual({ kind: 'number', value: '1' });
    expect(() => parseGeneratedColumnExpression('1' + ' '.repeat(2048))).toThrow('限制');
    expect(() => parseGeneratedColumnExpression('('.repeat(128) + '1' + ')'.repeat(128))).toThrow('限制');
    expect(() => parseGeneratedColumnExpression('('.repeat(17) + '1' + ')'.repeat(17))).toThrow('限制');
    expect(() => parseGeneratedColumnExpression(Array(18).fill('1').join('+'))).toThrow('限制');
    expect(parseGeneratedColumnExpression(balanced(Array(32).fill('qty'))).referencedColumns).toHaveLength(32);
    expect(() => parseGeneratedColumnExpression(balanced(Array(33).fill('qty')))).toThrow('限制');
  });
  it('生成属性严格，不允许未知键、空值或伪造计划', () => {
    for (const value of [null, {}, { storage: 'PERSISTENT', expression: 'qty' }, { storage: 'STORED', expression: '' }, { storage: 'VIRTUAL', expression: 'qty', sql: 'DROP TABLE subject' }]) expect(() => generatedColumnSchema.parse(value)).toThrow();
    expect(generatedColumnSchema.parse({ storage: 'STORED', expression: 'qty' })).toEqual({ storage: 'STORED', expression: 'qty' });
  });
  it('生成ADD独立提交，精确输出类型、NULL、默认、位置及ON UPDATE必须符合合同', () => {
    expect(validateColumnPatches([add()])).toEqual([add()]);
    for (const patch of [
      { ...add(), nullable: false }, { ...add(), default: { kind: 'null' } }, { ...add(), default: { kind: 'literal', valueType: 'number', value: '1' } },
      { ...add(), type: { kind: 'float', type: 'DOUBLE', unsigned: false } }, { ...add(), position: { kind: 'first' } }, { ...add(), position: { kind: 'after', columnRef: 'ref-0' } },
      { ...add(), onUpdate: null }, { ...add(), onUpdate: undefined }, { ...add(), generated: null }, { ...add(), generated: undefined },
    ]) expect(() => validateColumnPatches([patch])).toThrow();
    for (const other of [add('qty + 1', 'STORED'), { kind: 'drop', columnRef: 'ref-2' }, { kind: 'alter', columnRef: 'ref-2', changes: { comment: '旁列' } }]) expect(() => validateColumnPatches([add(), other])).toThrow('单独');
    expect(() => validateColumnPatches([{ kind: 'alter', columnRef: 'ref-0', changes: { generated: { storage: 'VIRTUAL', expression: 'qty' } } }])).toThrow();
    const ordinary = { ...add() }; delete ordinary.generated; expect(validateColumnPatches([ordinary])).toEqual([ordinary]);
  });
  it('既有预算守卫先于生成表达式读取，getter/toJSON和未知字段不被执行', () => {
    let called = false;
    const patch = add(); Object.defineProperty(patch.generated!, 'expression', { get() { called = true; return 'qty'; }, enumerable: true });
    expect(() => validateColumnPatches([patch])).toThrow(); expect(called).toBe(false);
    expect(() => validateColumnPatches([{ ...add(), sql: 'ALTER TABLE other' }])).toThrow();
    const noPosition: Record<string, unknown> = { ...add() }; delete noPosition.position; expect(() => validateColumnPatches([noPosition])).toThrow();
    expect(() => assertAddedGeneratedColumn({ ...add(), position: { kind: 'first' } })).toThrow();
  });
});

describe('生成表达式真实列引用与服务器投影', () => {
  it('实际普通数值列才可引用，精确名字经转义后写入SQL，重复引用不排序去重', () => {
    const parsed = document(), result = compileGeneratedColumnExpression(parsed, 'price + qty * price');
    expect(result.sql).toBe('(`price` + (`qty` * `price`))'); expect(result.referencedColumns).toEqual(['price', 'qty', 'price']);
    expect(isGeneratedColumnReference(parsed, 'qty')).toBe(true); expect(isGeneratedColumnReference(parsed, 'note')).toBe(false);
    for (const name of ['missing', 'QTY', 'total']) expect(() => compileGeneratedColumnExpression(parsed, name)).toThrow('精确匹配');
    const quoted = document('CREATE TABLE t (`a``b` int NULL, `中文` decimal(20,2) NULL)');
    expect(compileGeneratedColumnExpression(quoted, '`a``b` * 中文').sql).toBe('(`a``b` * `中文`)');
  });
  it('拒绝自增、生成、未知、隐藏、非数值、前向及未证实可空性引用', () => {
    const parsed = document('CREATE TABLE t (id int NOT NULL AUTO_INCREMENT, qty int NULL, computed int GENERATED ALWAYS AS (`qty`+1) VIRTUAL, obscure int NULL INVISIBLE, value_float double NULL, unknown int NULL future_option, implicit int, last_value int NULL)');
    for (const name of ['id', 'computed', 'obscure', 'value_float', 'unknown', 'implicit']) { expect(isGeneratedColumnReference(parsed, name)).toBe(false); expect(() => compileGeneratedColumnExpression(parsed, '`' + name + '`')).toThrow(); }
    expect(isGeneratedColumnReference(parsed, 'last_value', 2)).toBe(false);
    expect(() => compileGeneratedColumnExpression(parsed, 'last_value', 2)).toThrow();
    expect(isGeneratedColumnReference(parsed, 'qty', -1)).toBe(false); expect(isGeneratedColumnReference(parsed, 'qty', 99)).toBe(false);
  });
  it('归一化空白、外括号和十进制前导零，不冒充交换/结合/末位/尺度等价', () => {
    const parsed = document();
    expect(sameGeneratedColumnExpression(parsed, 'qty*price+0001.2300', '((`qty` * `price`) + 1.2300)')).toBe(true);
    for (const [left, right] of [['qty+price', 'price+qty'], ['qty+(price+1)', '(qty+price)+1'], ['qty+9007199254740993', 'qty+9007199254740992'], ['qty+1.00', 'qty+1.0'], ['qty+1', 'qty+2'], ['qty', 'abs(qty)'], ['qty', 'unknown']]) expect(sameGeneratedColumnExpression(parsed, left, right)).toBe(false);
  });
  it('客户端虽在原字符预算内，正规化补引号和括号超预算仍在DDL前拒绝', () => {
    const name = 'x'.repeat(60), expression = balanced(Array(32).fill(name)); expect(expression.length).toBeLessThanOrEqual(2048);
    const parsed = document('CREATE TABLE t (`' + name + '` int NULL)');
    expect(() => compileGeneratedColumnExpression(parsed, expression)).toThrow('限制');
    expect(() => plan([add(expression)], mysql, '8.4.11', 'CREATE TABLE subject (`' + name + '` int NULL)')).toThrow('限制');
  });
  it('服务器词法器略过的注释不能被重拼洗掉，名字内同样文字不误拒', () => {
    const parsed = document();
    for (const expression of ['qty/*注释*/+1', 'qty -- 注释\n+1', 'qty#尾注释', '/*头*/qty+1', 'qty+1/*尾*/', 'qty+/*!80000 1 */1']) expect(sameGeneratedColumnExpression(parsed, 'qty+1', expression)).toBe(false);
    const quoted = document('CREATE TABLE t (`a--b#c/*d` int NULL)');
    expect(sameGeneratedColumnExpression(quoted, '`a--b#c/*d`+1', '(`a--b#c/*d` + 1)')).toBe(true);
  });
  it('ANSI双引号目录引用沿实际词法模式读取，客户端输入仍只接受安全子集', () => {
    const context = { ...mysql, mode: { noBackslashEscapes: true, ansiQuotes: true } }, parsed = document('CREATE TABLE "t" ("qty" int NULL,"price" decimal(20,2) NULL)', context);
    expect(sameGeneratedColumnExpression(parsed, 'qty * price', '("qty" * "price")')).toBe(true);
    expect(() => compileGeneratedColumnExpression(parsed, '"qty" * "price"')).toThrow();
    const ordinary = document(); expect(sameGeneratedColumnExpression(ordinary, 'qty', '"qty"')).toBe(false);
  });
  it.each(['VIRTUAL', 'STORED'] as const)('SHOW中%s与完整目录表达式可交叉比较，不解除旧列只读', storage => {
    const parsed = document('CREATE TABLE t(qty int NOT NULL,price decimal(30,12) NULL,total decimal(65,12) GENERATED ALWAYS AS ((`qty` * `price`) + 9007199254740993.123456789012) ' + storage + ')');
    const result = readGeneratedColumnDefinition(parsed, 'total');
    expect(result).toMatchObject({ storage, referencedColumns: ['qty', 'price'] });
    expect(sameGeneratedColumnExpression(parsed, result!.expression, '`qty`*`price`+9007199254740993.123456789012', 2)).toBe(true);
    expect(parsed.columnsByName.get('total')?.access.type.editable).toBe(false);
    expect(readGeneratedColumnDefinition(parsed, 'qty')).toBeUndefined(); expect(readGeneratedColumnDefinition(parsed, 'gone')).toBeUndefined();
  });
  it('Maria PERSISTENT仅在目录后核映射STORED，MySQL不能借该别名通过', () => {
    const ddl = 'CREATE TABLE t(qty int NULL,total int GENERATED ALWAYS AS (`qty` + 1) PERSISTENT)';
    expect(readGeneratedColumnDefinition(document(ddl, { ...mysql, dialect: 'mariadb' }), 'total')?.storage).toBe('STORED');
    expect(readGeneratedColumnDefinition(document(ddl), 'total')).toBeUndefined();
  });
  it('生成链、自身和后置引用的SHOW不能伪装成已证明数值表达式', () => {
    for (const ddl of [
      'CREATE TABLE t(qty int NULL,total int GENERATED ALWAYS AS (`total`+1) VIRTUAL)',
      'CREATE TABLE t(qty int NULL,total int GENERATED ALWAYS AS (`later`+1) VIRTUAL,later int NULL)',
      'CREATE TABLE t(qty int NULL,previous int GENERATED ALWAYS AS (`qty`+1) VIRTUAL,total int GENERATED ALWAYS AS (`previous`+1) STORED)',
    ]) expect(readGeneratedColumnDefinition(document(ddl), 'total')).toBeUndefined();
  });
});

describe('新增生成列单条ALTER规划', () => {
  it.each([['mysql', '5.7.44'], ['mysql', '8.0.46'], ['mysql', '8.4.11'], ['mariadb', '10.11.19'], ['mariadb', '11.4.13']] as const)('%s %s 使用准确版本门，VIRTUAL/STORED各只生成单条受控ADD', (dialect, version) => {
    for (const storage of ['VIRTUAL', 'STORED'] as const) {
      const result = plan([add(undefined, storage)], { ...mysql, dialect }, version);
      expect(splitSql(result.sql)).toHaveLength(1); expect(result.clauses).toHaveLength(1);
      expect(result.sql).toContain('ADD COLUMN `total` DECIMAL(65,12) GENERATED ALWAYS AS (((`qty` * `price`) + 9007199254740993.123456789012)) ' + storage);
      expect(result.requiredAcknowledgements).toContain(generatedColumnAcknowledgement);
      expect(result.warnings.join('')).toContain('服务器计算'); expect(result.sql).not.toMatch(/\bDEFAULT\b/);
      expect(result.finalColumns.map(column => column.name)).toEqual(['qty', 'price', 'note', 'total']);
      expect(result.preserved.columns).toEqual(document().columns.map(column => column.raw));
      expect(result.preserved.constraints).toEqual(document().items.filter(item => item.kind === 'constraint').map(item => item.raw));
    }
  });
  it.each([['mysql', '5.7.43'], ['mysql', '8.0.45'], ['mysql', '8.4.12'], ['mariadb', '10.11.18'], ['mariadb', '11.4.12']] as const)('未知%s %s不能借大版本生成DDL，普通ADD仍沿原能力', (dialect, version) => {
    const context = { ...mysql, dialect }; expect(() => plan([add()], context, version)).toThrow('尚未开放');
    const ordinary = { ...add() }; delete ordinary.generated; expect(plan([ordinary], context, version).sql).toContain('ADD COLUMN');
  });
  it('整数输出可用，DECIMAL尺度仍沿原方言限制且不自动修正', () => {
    expect(plan([{ ...add('qty + 1'), type: { kind: 'integer', type: 'BIGINT', unsigned: true } }]).sql).toContain('BIGINT UNSIGNED GENERATED ALWAYS');
    const patch = { ...add(), type: { kind: 'decimal', precision: 65, scale: 38, unsigned: false } };
    expect(() => plan([patch])).toThrow('精度'); expect(plan([patch], { ...mysql, dialect: 'mariadb' }, '11.4.13').sql).toContain('DECIMAL(65,38)');
  });
  it('保留名称冲突、快照身份与Maria整表风险默认保护，不以生成add绕过', () => {
    expect(() => plan([{ ...add(), name: 'QTY' }])).toThrow();
    expect(() => plan([{ ...add(), clientKey: 'ref-0' }])).toThrow('引用');
    const unsafe = "CREATE TABLE subject(qty int NULL,price decimal(30,12) NULL,note varchar(80) DEFAULT concat('甲','乙'))";
    expect(() => plan([add()], { ...mysql, dialect: 'mariadb' }, '11.4.13', unsafe)).toThrow('全部风险默认值');
    const parsed = document(); expect(() => buildTableColumnPatchSql(parsed, [add()], { database: 'test', serverVersion: '8.4.11', columnRefs: new Map([['only', 'qty']]) })).toThrow('不完整');
  });
  it('未开启generated的普通ADD没有新增确认或AS，不改旧输出形状', () => {
    const ordinary = { ...add('qty') }; delete ordinary.generated;
    const result = plan([ordinary]); expect(result.sql).not.toContain('GENERATED ALWAYS'); expect(result.requiredAcknowledgements).not.toContain(generatedColumnAcknowledgement);
  });
});
