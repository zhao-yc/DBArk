import { describe, expect, it } from 'vitest';
import { generatedColumnAcknowledgement, generatedColumnExpressionFingerprint, generatedExpressionAcknowledgement, generationExpressionSchema, parseGeneratedColumnExpression, sameGeneratedColumnInputExpression } from '../../src/shared/tableGeneratedColumn';
import { validateColumnPatches, type ColumnPatch, type TableDefinitionContext } from '../../src/shared/tableColumnPatches';
import { compileGeneratedColumnExpression, readGeneratedColumnDefinition } from '../../src/engine/tableGeneratedColumn';
import { parseTableColumnDefinition, tableDefinitionTokens } from '../../src/engine/tableColumnDefinition';
import { generatedExpressionAccess, planGeneratedExpressionChange, prepareGeneratedExpressionAccess } from '../../src/engine/tableGeneratedExpressionPlan';
import { buildTableColumnPatchSql } from '../../src/engine/tableColumnPatchSql';
import { splitSql } from '../../src/engine/sql';

const mysql: TableDefinitionContext = { dialect: 'mysql', mode: { noBackslashEscapes: false, ansiQuotes: false } };
/** SHOW常省略可空NULL；本纯样本单独以目录事实补齐，不能将省略误作NOT NULL。 */
function document(storage = 'VIRTUAL', context = mysql, extra = '', tail = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT=\'原表备注\'') {
  const source = "CREATE TABLE `subject` (`qty` int NOT NULL,`price` decimal(30,12) DEFAULT NULL,`total` decimal(65,12) GENERATED ALWAYS AS ((`qty` * `price`) + 1.00) " + storage + " COMMENT '原列备注',`note` varchar(20) DEFAULT NULL" + extra + ') ' + tail;
  return read(source, context);
}
function read(source: string, context = mysql) { const parsed = parseTableColumnDefinition(source, context); for (const column of parsed.columns) if (column.nullable === undefined) column.nullable = true; return parsed; }
const alter = (expression = 'qty * price + 2.00'): ColumnPatch => ({ kind: 'alter', columnRef: 'ref-total', changes: { generation: { expression } } });
function plan(patches: unknown = [alter()], parsed = document(), version = '8.4.11') {
  return buildTableColumnPatchSql(parsed, patches, { database: 'isolated', serverVersion: version, columnRefs: new Map(parsed.columns.map(column => ['ref-' + column.name, column.name])) });
}

describe('已有生成表达式严格补丁合同', () => {
  it('只接纳expression，generation不增加旧七项access或开放其它生成列属性', () => {
    expect(validateColumnPatches([alter()])).toEqual([alter()]);
    const column = document().columnsByName.get('total')!;
    expect(Object.keys(column.access)).toHaveLength(7); expect(Object.values(column.access).every(access => !access.editable)).toBe(true);
    for (const value of [null, {}, { expression: '' }, { expression: 'qty', storage: 'STORED' }, { expression: 'qty', sql: 'DROP TABLE subject' }, { expression: 'x'.repeat(2049) }]) expect(() => generationExpressionSchema.parse(value)).toThrow();
    for (const changes of [{ generation: { expression: 'qty' }, comment: '不能混改' }, { generation: { expression: 'qty' }, name: 'new' }, { generation: { expression: 'qty' }, type: { kind: 'integer', type: 'INT', unsigned: false } }, { generation: { expression: 'qty' }, position: { kind: 'last' } }, { generation: { expression: 'qty' }, onUpdate: null }, { generation: { expression: 'qty' }, default: { kind: 'none' } }]) expect(() => validateColumnPatches([{ kind: 'alter', columnRef: 'ref-total', changes }])).toThrow('独立');
  });
  it('禁止混批、重复目标、空/显式undefined、字符串及任意SQL语法', () => {
    for (const other of [alter('qty + 3'), { kind: 'drop', columnRef: 'ref-note' }, { kind: 'alter', columnRef: 'ref-note', changes: { comment: '旁列' } }, { kind: 'add', clientKey: 'new', name: 'n', type: { kind: 'integer', type: 'INT', unsigned: false }, nullable: true, default: { kind: 'none' }, comment: '', position: { kind: 'last' } }]) expect(() => validateColumnPatches([alter(), other])).toThrow('独立');
    for (const generation of [undefined, null, {}, { expression: 'qty; DROP TABLE subject' }, { expression: "'qty'" }, { expression: 'RAND()' }, { expression: 'qty / price' }]) expect(() => validateColumnPatches([{ kind: 'alter', columnRef: 'ref-total', changes: { generation } }])).toThrow();
    expect(() => validateColumnPatches([{ ...alter(), generated: { storage: 'VIRTUAL', expression: 'qty' } }])).toThrow();
  });
  it('现有结构预算先执行，拒绝访问器和稀疏输入，不调用toJSON', () => {
    let called = false;
    const generation = Object.defineProperty({}, 'expression', { enumerable: true, get() { called = true; return 'qty'; } });
    expect(() => validateColumnPatches([{ kind: 'alter', columnRef: 'ref-total', changes: { generation } }])).toThrow(); expect(called).toBe(false);
    expect(() => validateColumnPatches(new Array(1))).toThrow();
    expect(() => validateColumnPatches([{ kind: 'alter', columnRef: 'ref-total', changes: { generation: { expression: 'qty', toJSON() { called = true; return {}; } } } }])).toThrow(); expect(called).toBe(false);
  });
  it('共享无差异比较复用官方unary+键，保留尺度、末位、结合及负号', () => {
    expect(sameGeneratedColumnInputExpression('+((qty * price) + +1.00)', '`qty` * `price` + 1.00')).toBe(true);
    expect(generatedColumnExpressionFingerprint(parseGeneratedColumnExpression('+qty').ast)).toBe(generatedColumnExpressionFingerprint(parseGeneratedColumnExpression('qty').ast));
    for (const expression of ['qty * price + 1.0', 'price * qty + 1.00', 'qty * (price + 1.00)', '-(qty * price + 1.00)', 'qty * price + 1.01', 'qty * price + 9007199254740992']) expect(sameGeneratedColumnInputExpression('qty * price + 1.00', expression)).toBe(false);
    expect(sameGeneratedColumnInputExpression('qty', '+'.repeat(17) + 'qty')).toBe(false);
  });
});

describe('真实单条生成表达式修改计划', () => {
  it.each([['mysql', '5.7.44'], ['mysql', '8.0.46'], ['mysql', '8.4.11'], ['mariadb', '10.11.19'], ['mariadb', '11.4.13']] as const)('%s %s VIRTUAL/STORED仅改AS内部范围，COPY/VALIDATION正确逗号分隔', (dialect, version) => {
    for (const storage of ['VIRTUAL', 'STORED']) {
      const parsed = document(storage, { ...mysql, dialect }), before = parsed.columnsByName.get('total')!, result = plan([alter()], parsed, version), change = planGeneratedExpressionChange(parsed, 'total', 'qty * price + 2.00', version);
      expect(splitSql(result.sql)).toHaveLength(1); expect(result.clauses[0]).toBe('MODIFY COLUMN ' + change.definition); expect(result.clauses[1]).toBe('ALGORITHM=COPY');
      expect(result.clauses.slice(2)).toEqual(dialect === 'mysql' && storage === 'VIRTUAL' ? ['WITH VALIDATION'] : []);
      expect(result.sql).toContain('\n,\nALGORITHM=COPY'); if (dialect === 'mysql' && storage === 'VIRTUAL') expect(result.sql).toContain('\n,\nWITH VALIDATION');
      const changedExpression = readGeneratedColumnDefinition(parsed, 'total')!.expression;
      const begin = before.raw.indexOf(changedExpression); expect(begin).toBeGreaterThanOrEqual(0);
      expect(change.definition).toBe(before.raw.slice(0, begin) + change.after.sql + before.raw.slice(begin + changedExpression.length));
      expect(change.definition).toContain("COMMENT '原列备注'"); expect(change.definition).toContain(storage); expect(change.definition).toContain('decimal(65,12)');
      expect(result.requiredAcknowledgements).toEqual([generatedColumnAcknowledgement, generatedExpressionAcknowledgement]);
      expect(result.warnings.join('')).toContain('ALGORITHM=COPY'); expect(result.warnings.join('')).toContain('sql_mode');
      expect(result.finalColumns.map(column => column.name)).toEqual(parsed.columns.map(column => column.name));
      expect(result.preserved.columns).toEqual(parsed.columns.filter(column => column.name !== 'total').map(column => column.raw));
      expect(result.preserved.tail).toBe(parsed.tail.raw); expect(result.preserved.constraints).toEqual([]);
    }
  });
  it('一元+、空白、括号、裸名与反引号等价不能投递无实际变化DDL', () => {
    for (const expression of ['qty*price+1.00', '+((qty*price)+ +1.00)', '((`qty` * `price`) + 01.00)']) expect(() => plan([alter(expression)])).toThrow('没有实际变更');
    expect(plan([alter('qty * price + 1.01')]).sql).toContain('1.01');
  });
  it('原STORED/PERSISTENT拼写、名称、数值类型、NULL与注释完整保留', () => {
    const parsed = read("CREATE TABLE `subject` (`a``b` bigint unsigned NOT NULL,`金额` decimal(50,30) GENERATED ALWAYS AS (`a``b` + 1.00) PERSISTENT NULL COMMENT 'literal `金额`, DEFAULT (x), AS ((1))') ENGINE=InnoDB", { ...mysql, dialect: 'mariadb' });
    const result = planGeneratedExpressionChange(parsed, '金额', '`a``b` + 9007199254740993.123456789012345678901234567890', '11.4.13');
    expect(result.definition).toContain('`金额` decimal(50,30) GENERATED ALWAYS AS ('); expect(result.definition).toContain("PERSISTENT NULL COMMENT 'literal `金额`, DEFAULT (x), AS ((1))'");
    expect(result.after.sql).toContain('9007199254740993.123456789012345678901234567890'); expect(result.before.storage).toBe('STORED'); expect(result.clauses).toHaveLength(2);
  });
  it('ANSI/NBE沿真实SHOW引用读取，只重写新表达式的真实反引号列名', () => {
    const context = { ...mysql, mode: { ansiQuotes: true, noBackslashEscapes: true } }, parsed = read('CREATE TABLE "subject" ("qty" int NULL,"total" decimal(20,2) GENERATED ALWAYS AS ("qty"+1.00) VIRTUAL COMMENT \'反斜线\\保留\') ENGINE=InnoDB', context);
    const result = planGeneratedExpressionChange(parsed, 'total', '+qty + 2.00', '8.4.11');
    expect(result.before.sql).toBe('(`qty` + 1.00)'); expect(sameGeneratedColumnInputExpression(result.before.sql, 'qty+1.00')).toBe(true);
    expect(result.definition).toContain('"total" decimal(20,2)'); expect(result.definition).toContain('(+`qty`)'); expect(result.definition).toContain("COMMENT '反斜线\\保留'");
  });
  it('实际正规化输出须满足完整后核预算，不能在DDL后才发现一元运算括号增加解析深度', () => {
    const parsed = document(), expression = '- '.repeat(9) + 'qty';
    // 输入本身仍合法；拒绝点必须是实际SQL输出，而不是修改原输入语法或降低原深度预算。
    expect(parseGeneratedColumnExpression(expression).referencedColumns).toEqual(['qty']);
    expect(() => compileGeneratedColumnExpression(parsed, expression)).toThrow('16层');
    expect(() => plan([alter(expression)], parsed)).toThrow('16层');
    const added: ColumnPatch = { kind: 'add', clientKey: 'new', name: 'new_generated', type: { kind: 'integer', type: 'INT', unsigned: false }, nullable: true, default: { kind: 'none' }, comment: '', position: { kind: 'last' }, generated: { storage: 'VIRTUAL', expression } };
    expect(() => plan([added], parsed)).toThrow('16层');
    const accepted = compileGeneratedColumnExpression(parsed, '- '.repeat(8) + 'qty');
    expect(generatedColumnExpressionFingerprint(parseGeneratedColumnExpression(accepted.sql).ast)).toBe(accepted.fingerprint);
  });
  it.each(['5.7.43', '8.0.45', '8.4.12', '9.0.1'])('未知MySQL %s不能借大版本推断写能力', version => { expect(() => plan([alter()], document(), version)).toThrow(); expect(generatedExpressionAccess(document(), 'total', version).editable).toBe(false); });
  it('原始属性范围或私有源遭到矛盾更改时拒绝，不能在错误位置替换相同表达式', () => {
    const parsed = document(); parsed.columnsByName.get('total')!.attributes.find(attribute => attribute.kind === 'generated')!.range.start++;
    expect(() => planGeneratedExpressionChange(parsed, 'total', 'qty + 3', '8.4.11')).toThrow();
  });
});

describe('生成表达式准入及依赖保护', () => {
  it.each([
    ',KEY `k` (`total`)', ',PRIMARY KEY (`total`)', ',CONSTRAINT `fk` FOREIGN KEY (`total`) REFERENCES parent(id)', ',CONSTRAINT `check_total` CHECK (`total` > 0)',
    ',`another` int GENERATED ALWAYS AS (`total` + 1) VIRTUAL', ',`ordinary` int DEFAULT (`total` + 1)', ',`checked` int CHECK (`total` > 0)',
  ])('目标存在本表依赖 %s 时不能单独修改', extra => {
    const parsed = document('VIRTUAL', mysql, extra); expect(generatedExpressionAccess(parsed, 'total', '8.4.11').editable).toBe(false); expect(() => plan([alter()], parsed)).toThrow('依赖');
  });
  it('名字只出现在普通字符串和注释中不伪造列依赖，不误修改其它定义', () => {
    const parsed = document('VIRTUAL', mysql, ",KEY k (`qty`) COMMENT 'total' /* total */", "ENGINE=InnoDB COMMENT='total PARTITION BY total'");
    expect(generatedExpressionAccess(parsed, 'total', '8.4.11')).toEqual({ editable: true }); expect(plan([alter()], parsed).preserved.constraints).toEqual(parsed.items.filter(item => item.kind === 'constraint').map(item => item.raw));
  });
  it.each(['ENGINE=InnoDB PARTITION BY HASH(qty) PARTITIONS 2', 'ENGINE=InnoDB unknown_option=1', 'ENGINE=InnoDB /*!80000 PARTITION BY HASH(total) */'])('未知/分区表尾 %s 保守只读', tail => { const parsed = document('VIRTUAL', mysql, '', tail); expect(() => plan([alter()], parsed)).toThrow('依赖'); });
  it('旁列opaque与可执行属性不被当作无依赖，Maria风险默认仍阻止COPY', () => {
    for (const extra of [',m int future_option', ',m int DEFAULT (qty + 1) /*!80000 INVISIBLE */']) expect(generatedExpressionAccess(document('VIRTUAL', mysql, extra), 'total', '8.4.11').editable).toBe(false);
    const parsed = document('STORED', { ...mysql, dialect: 'mariadb' }, ",risk varchar(50) DEFAULT concat('甲','乙')"); expect(() => plan([alter()], parsed, '11.4.13')).toThrow('全部风险默认值');
  });
  it.each(['NULL DEFAULT NULL', 'NOT NULL', 'NULL INVISIBLE', 'NULL STORAGE DISK', 'NULL COLUMN_FORMAT FIXED', 'NULL CHECK (qty > 0)'])('目标含不受控属性 %s 时不开放其它生成属性', attributes => {
    const parsed = read('CREATE TABLE t(qty int NULL,total int GENERATED ALWAYS AS (qty+1) VIRTUAL ' + attributes + ') ENGINE=InnoDB');
    expect(generatedExpressionAccess(parsed, 'total', '8.4.11').editable).toBe(false); expect(() => planGeneratedExpressionChange(parsed, 'total', 'qty+2', '8.4.11')).toThrow();
  });
  it('目标须已存在可证数值生成列，不借普通列、FLOAT或未知生成方式完成转换', () => {
    for (const parsed of [read('CREATE TABLE t(qty int NULL,total int NULL)'), read('CREATE TABLE t(qty int NULL,total double GENERATED ALWAYS AS (qty+1) VIRTUAL)'), read('CREATE TABLE t(qty int NULL,total int zerofill GENERATED ALWAYS AS (qty+1) VIRTUAL)')]) expect(generatedExpressionAccess(parsed, 'total', '8.4.11').editable).toBe(false);
    expect(generatedExpressionAccess(document(), 'missing', '8.4.11').editable).toBe(false);
    expect(() => plan([{ kind: 'alter', columnRef: 'gone', changes: { generation: { expression: 'qty+2' } } }])).toThrow('快照');
  });
  it('新表达式拒绝自身、生成链、自增、后置及未知引用，未合法计算不会生成DDL', () => {
    const parsed = document('VIRTUAL', mysql, ',auto_value int NOT NULL AUTO_INCREMENT,later int NULL');
    for (const expression of ['total+1', 'auto_value+1', 'later+1', 'unknown+1', 'note+1', 'QTY+1', "qty + '1'", 'qty;DROP TABLE t']) expect(() => planGeneratedExpressionChange(parsed, 'total', expression, '8.4.11')).toThrow();
    const chained = document('VIRTUAL', mysql, ',other int GENERATED ALWAYS AS (qty+1) VIRTUAL'); expect(() => planGeneratedExpressionChange(chained, 'total', 'other+1', '8.4.11')).toThrow();
  });
  it('同次准备为各目标返回独立准入，不改变原生成列七项只读属性', () => {
    const parsed = document('VIRTUAL', mysql, ',other int GENERATED ALWAYS AS (qty+1) VIRTUAL,KEY k(total)');
    const access = prepareGeneratedExpressionAccess(parsed, '8.4.11'); expect(access('total').editable).toBe(false); expect(access('other').editable).toBe(true); expect(access('qty').editable).toBe(false);
    expect(Object.values(parsed.columnsByName.get('other')!.access).every(value => !value.editable)).toBe(true);
    // 精确比较公共词法事实，括号/表达式文字不靠字符串contains判断依赖。
    expect(tableDefinitionTokens("'total' /* total */ `qty`", mysql).map(token => token.kind)).toEqual(['string', 'identifier']);
  });
  it('普通属性与生成ADD继续沿原路径，不附加COPY或表达式重算确认', () => {
    const parsed = document(), ordinary = plan([{ kind: 'alter', columnRef: 'ref-note', changes: { comment: '普通列' } }], parsed);
    expect(ordinary.sql).not.toContain('ALGORITHM=COPY'); expect(ordinary.requiredAcknowledgements).not.toContain(generatedExpressionAcknowledgement);
    const added = plan([{ kind: 'add', clientKey: 'new', name: 'new_generated', type: { kind: 'integer', type: 'INT', unsigned: false }, nullable: true, default: { kind: 'none' }, comment: '', position: { kind: 'last' }, generated: { storage: 'STORED', expression: 'qty+1' } }], parsed);
    expect(added.sql).toContain('ADD COLUMN'); expect(added.requiredAcknowledgements).toEqual([generatedColumnAcknowledgement]); expect(added.sql).not.toContain('ALGORITHM=COPY');
    expect(compileGeneratedColumnExpression(parsed, '+qty+1').sql).toContain('(+`qty`)');
  });
});
