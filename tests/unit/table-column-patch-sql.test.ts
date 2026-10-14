import { describe, expect, it } from 'vitest';
import { parseTableColumnDefinition } from '../../src/engine/tableColumnDefinition';
import { buildTableColumnPatchSql } from '../../src/engine/tableColumnPatchSql';
import { splitSql } from '../../src/engine/sql';
import { columnPatchAccess, readControlledTimestampDefault, type ColumnPatch, type TableDefinitionContext } from '../../src/shared/tableColumnPatches';

const mysql: TableDefinitionContext = { dialect: 'mysql', mode: { noBackslashEscapes: false, ansiQuotes: false } };
/** 使用原始名称作为本单测的稳定引用，生产引用仍由未来快照入口提供。 */
function plan(source: string, patches: unknown, context = mysql, version = '8.4.11') {
  const document = parseTableColumnDefinition(source, context);
  return buildTableColumnPatchSql(document, patches, { database: '库', serverVersion: version, columnRefs: new Map(document.columns.map(column => [column.name, column.name])) });
}
const alter = (columnRef: string, changes: Extract<ColumnPatch, { kind: 'alter' }>['changes']): ColumnPatch => ({ kind: 'alter', columnRef, changes });
const add = (clientKey: string, name: string, position: Extract<ColumnPatch, { kind: 'add' }>['position']): ColumnPatch => ({ kind: 'add', clientKey, name, type: { kind: 'integer', type: 'INT', unsigned: false }, nullable: true, default: { kind: 'none' }, comment: '', position });

describe('字段差异的纯单条 ALTER 计划', () => {
  it('受控时间读取只接受 CURRENT_TIMESTAMP/NOW 及规范外括号，拒绝文字量和运算', () => {
    for (const sql of ['CURRENT_TIMESTAMP', 'current_timestamp()', '(now())', '(( CURRENT_TIMESTAMP (0) ))']) expect(readControlledTimestampDefault(sql)).toEqual({ precision: 0 });
    for (const sql of ['CURRENT_TIMESTAMP(6)', '(NOW(6))', '(((now ( 6 ))))']) expect(readControlledTimestampDefault(sql)).toEqual({ precision: 6 });
    for (const sql of ["'CURRENT_TIMESTAMP'", 'NOW', 'NOW(7)', 'NOW(06)', '(now())+1', 'now() + INTERVAL 1 DAY', 'concat(now())', '(now()) COLLATE x', 'NOW(/*x*/)', '(NOW()', 'NOW())', ' '.repeat(513)]) expect(readControlledTimestampDefault(sql)).toBeUndefined();
  });

  it.each([['mysql', '5.7.44'], ['mysql', '8.0.46'], ['mysql', '8.4.11'], ['mariadb', '10.11.19'], ['mariadb', '11.4.13']] as const)('%s %s 预先选择 CT 默认语法并保留 ON UPDATE 与注释', (dialect, version) => {
    for (const precision of [0, 6]) {
      const source = `CREATE TABLE t(v datetime(${precision}) NOT NULL DEFAULT '2000-01-01 00:00:00' ON UPDATE CURRENT_TIMESTAMP(${precision}) COMMENT '未改')`, context: TableDefinitionContext = { ...mysql, dialect };
      const result = plan(source, [alter('v', { default: { kind: 'expression', expression: 'current-timestamp', precision } })], context, version);
      const expression = precision ? 'CURRENT_TIMESTAMP(6)' : 'CURRENT_TIMESTAMP';
      if (version.startsWith('5.7')) { expect(result.sql).toContain(`MODIFY COLUMN v datetime(${precision}) NOT NULL DEFAULT ${expression} ON UPDATE CURRENT_TIMESTAMP(${precision}) COMMENT '未改'`); expect(result.sql).not.toContain('ALTER COLUMN'); }
      else expect(result.clauses).toEqual([`ALTER COLUMN \`v\` SET DEFAULT ${dialect === 'mysql' ? '(' + expression + ')' : expression}`]);
      expect(splitSql(result.sql)).toHaveLength(1);
      for (const canonical of [`CURRENT_TIMESTAMP(${precision})`, `(now(${precision}))`]) expect(() => plan(`CREATE TABLE t(v datetime(${precision}) DEFAULT ${canonical})`, [alter('v', { default: { kind: 'expression', expression: 'current-timestamp', precision } })], context, version)).toThrow('没有实际');
      // 时间表达式规则不能错误扩展到 5.7 不支持的括号 HEX/BIT 默认值。
      expect(plan('CREATE TABLE t(v bit(8))', [alter('v', { default: { kind: 'literal', valueType: 'binary', value: 'ff' } })], context, version).clauses).toEqual(["ALTER COLUMN `v` SET DEFAULT b'11111111'"]);
    }
  });
  it.each(['10.11.19-MariaDB-ubu2204', '11.4.13-MariaDB-ubu2404'])('真实 Maria %s 默认表达式反例对整表阻止内部重述，仅保留全部默认值专用修复', version => {
    // 来源 run03-maria-roundtrip 脱敏 SHOW CREATE；真实原值 HEX=C380E6B189，原样重建变为 784333...。
    // 本单测只验证已证风险的能力边界，不冒充产品 apply 实库验收。
    const source = "CREATE TABLE `collate_function_expression` (\n  `id` int(11) NOT NULL,\n  `v` varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT (concat(_utf8mb4'xC3x80',_utf8mb4'xE6xB1x89') collate utf8mb4_bin),\n  PRIMARY KEY (`id`)\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci";
    const context: TableDefinitionContext = { ...mysql, dialect: 'mariadb' };
    const access = columnPatchAccess(parseTableColumnDefinition(source, context).columns[1], 'mariadb');
    for (const key of ['name', 'comment', 'type', 'nullable', 'position'] as const) expect(access[key].editable).toBe(false);
    expect(access.default.editable).toBe(true);
    for (const changes of [{ comment: '新' }, { nullable: false }, { position: { kind: 'first' as const } }, { name: 'renamed', default: { kind: 'none' as const } }]) expect(() => plan(source, [alter('v', changes)], context, version)).toThrow('重述');
    expect(plan(source, [alter('v', { default: { kind: 'none' } })], context, version).sql).toContain('ALTER COLUMN `v` DROP DEFAULT');
    expect(plan("CREATE TABLE t(v varbinary(20) DEFAULT '?')", [alter('v', { default: { kind: 'literal', valueType: 'text', value: '?' } })], context, version).sql).toContain("SET DEFAULT '?'");
    for (const patch of [alter('v', { name: 'renamed' }), alter('id', { comment: '旁列' }), alter('id', { default: { kind: 'literal', valueType: 'number', value: '2' } }), add('new', 'new', { kind: 'last' }), { kind: 'drop' as const, columnRef: 'id' }]) expect(() => plan(source, [patch], context, version)).toThrow('全部风险默认值');
    // 不按异常文本特征猜修复；任意非受控表达式或字符集引导值均使用相同判断。
    for (const value of ["concat('普通','值')", "_utf8mb4'普通'", "(1+2)"]) expect(() => plan('CREATE TABLE t(v varchar(80) DEFAULT ' + value + ')', [alter('v', { comment: '新' })], context, version)).toThrow('重述');
    expect(plan('CREATE TABLE t(v timestamp(6) DEFAULT CURRENT_TIMESTAMP(6))', [alter('v', { comment: '新' })], context, version).sql).toContain('CURRENT_TIMESTAMP(6)');
  });

  it('两个风险默认值只修一个仍拒绝，必须全部专用覆盖且不能夹带旁列或改名', () => {
    const source = "CREATE TABLE t(id int,v varchar(80) DEFAULT concat('甲','乙'),w varchar(80) DEFAULT concat('丙','丁'))", context: TableDefinitionContext = { ...mysql, dialect: 'mariadb' };
    const clear = alter('v', { default: { kind: 'none' } }), replace = alter('w', { default: { kind: 'literal', valueType: 'text', value: '明确新默认值' } });
    expect(() => plan(source, [clear], context, '10.11.19')).toThrow('"w"');
    const result = plan(source, [clear, replace], context, '10.11.19');
    expect(result.clauses).toEqual(['ALTER COLUMN `v` DROP DEFAULT', "ALTER COLUMN `w` SET DEFAULT '明确新默认值'"]);
    expect(() => plan(source, [clear, replace, alter('id', { comment: '额外修改' })], context, '10.11.19')).toThrow('全部风险');
    expect(() => plan(source, [{ kind: 'drop', columnRef: 'v' }, { kind: 'drop', columnRef: 'w' }], context, '10.11.19')).toThrow('全部风险');
    // MySQL 不扩大到未证实的整表限制。
    expect(plan(source, [alter('id', { comment: '旁列' })]).sql).toContain('COMMENT');
  });

  it.each(['mysql', 'mariadb'] as const)('%s 二进制文本默认只阻止目标重述，不混入 Maria 整表表达式门', dialect => {
    const source = "CREATE TABLE t(v varbinary(20) DEFAULT '\\0?',note int)", context = { ...mysql, dialect };
    const version = dialect === 'mysql' ? '5.7.44' : '10.11.19';
    for (const changes of [{ comment: '修改' }, { nullable: false }, { position: { kind: 'first' as const } }, { type: { kind: 'string' as const, type: 'VARBINARY' as const, length: 30 } }]) {
      // FIRST 对已在首位的字段本来是无变化，单独使用 note 前的第二列形式。
      const ddl = changes.position ? "CREATE TABLE t(note int,v varbinary(20) DEFAULT '\\0?')" : source;
      expect(() => plan(ddl, [alter('v', changes)], context, version)).toThrow('原始字节');
    }
    expect(plan(source, [alter('note', { comment: '旁列' })], context, version).sql).toContain("COMMENT '旁列'");
    expect(plan(source, [alter('v', { default: { kind: 'none' } })], context, version).sql).toContain('ALTER COLUMN `v` DROP DEFAULT');
    expect(plan(source, [alter('v', { default: { kind: 'literal', valueType: 'binary', value: '00ff' } })], context, version).sql).toContain("ALTER COLUMN `v` SET DEFAULT X'00ff'");
    expect(plan(source, [{ kind: 'drop', columnRef: 'v' }], context, version).sql).toContain('DROP COLUMN `v`');
    for (const value of ["X'00ff'", '0x00ff', "B'0000000011111111'", 'NULL']) expect(plan(`CREATE TABLE t(v varbinary(20) DEFAULT ${value})`, [alter('v', { comment: '可证明' })], context, version).sql).toContain("COMMENT '可证明'");
    if (dialect === 'mysql') expect(() => plan(source, [alter('v', { name: 'renamed' })], context, version)).toThrow('原始字节');
  });
  it('修改单注释保留同列属性及所有旁列、索引、外键和表尾原片段', () => {
    const source = "CREATE TABLE t (`id` int NOT NULL, `v` varchar(90) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT 'a,b' COMMENT '旧', `ts` timestamp(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), KEY ix (`v`(10)), CONSTRAINT fk FOREIGN KEY (`id`) REFERENCES p(id)) ENGINE=InnoDB COMMENT='表尾'";
    const result = plan(source, [alter('v', { comment: '新注释' })]);
    expect(result.clauses).toHaveLength(1);
    expect(result.sql).toContain("`v` varchar(90) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT 'a,b' COMMENT '新注释'");
    expect(result.sql).not.toContain('FOREIGN KEY'); expect(result.sql).not.toContain('ENGINE=');
    const document = parseTableColumnDefinition(source, mysql);
    expect(result.preserved.columns).toEqual([document.columns[0].raw, document.columns[2].raw]);
    expect(result.preserved.constraints).toEqual(document.items.filter(item => item.kind === 'constraint').map(item => item.raw));
    expect(result.preserved.tail).toBe(document.tail.raw);
  });

  it('DEFAULT 单改不重述整列，严格区分无、NULL、空文本、文本 NULL 和精确数值', () => {
    const cases = [
      [{ kind: 'none' }, 'DROP DEFAULT'], [{ kind: 'null' }, 'SET DEFAULT NULL'],
      [{ kind: 'literal', valueType: 'text', value: '' }, "SET DEFAULT ''"],
      [{ kind: 'literal', valueType: 'text', value: 'NULL' }, "SET DEFAULT 'NULL'"],
      [{ kind: 'literal', valueType: 'number', value: '12345678901234567890.123456' }, 'SET DEFAULT 12345678901234567890.123456'],
    ];
    for (const [value, sql] of cases) {
      const result = plan("CREATE TABLE t (v varchar(90) DEFAULT '原值')", [{ kind: 'alter', columnRef: 'v', changes: { default: value } }]);
      expect(result.clauses).toEqual(['ALTER COLUMN `v` ' + sql]);
    }
    expect(() => plan('CREATE TABLE t (v int NOT NULL)', [alter('v', { default: { kind: 'null' } })])).toThrow('NOT NULL');
  });

  it.each([false, true])('文字量在 NBE=%s 下保持注入文本原值且只有一条语句', noBackslashEscapes => {
    const context = { ...mysql, mode: { noBackslashEscapes, ansiQuotes: true } };
    const value = "中文\\'; DROP TABLE x; --\n/* COMMENT */";
    const result = plan('CREATE TABLE "t" ("v" varchar(200))', [alter('v', { default: { kind: 'literal', valueType: 'text', value }, comment: value })], context);
    expect(splitSql(result.sql, noBackslashEscapes, true)).toHaveLength(1);
    const definition = result.clauses[0].replace(/^MODIFY COLUMN /, 'CREATE TABLE t (') + ')';
    const read = parseTableColumnDefinition(definition, context).columns[0];
    expect(read.default).toMatchObject({ kind: 'literal', value }); expect(read.comment).toBe(value);
    expect(() => plan('CREATE TABLE t (v int)', [alter('v', { comment: '\0' })], context)).toThrow('NUL');
  });

  it.each([
    ['mysql', '5.7.44', 'CHANGE COLUMN `v`'], ['mysql', '8.0.46', 'RENAME COLUMN `v` TO `新`'],
    ['mysql', '8.4.11', 'RENAME COLUMN `v` TO `新`'], ['mariadb', '10.11.19', 'RENAME COLUMN `v` TO `新`'], ['mariadb', '11.4.13', 'RENAME COLUMN `v` TO `新`'],
  ] as const)('%s %s 使用受控版本改名语法（纯夹具）', (dialect, version, expected) => {
    const result = plan("CREATE TABLE t (v varchar(20) DEFAULT '' COMMENT '保留')", [alter('v', { name: '新' })], { ...mysql, dialect }, version);
    expect(result.sql).toContain(expected); expect(result.finalColumns).toEqual([{ columnRef: 'v', name: '新' }]);
    if (version.startsWith('5')) expect(result.sql).toContain("`新` varchar(20) DEFAULT '' COMMENT '保留'");
  });

  it('同列新增多个属性与改类型共享边界也不重叠或丢失原注释', () => {
    const result = plan('CREATE TABLE t (v int /* 原注释 */)', [alter('v', { type: { kind: 'string', type: 'VARCHAR', length: 20 }, nullable: false, default: { kind: 'literal', valueType: 'text', value: '空' }, comment: '说明' })]);
    expect(result.sql).toContain("v VARCHAR(20) NOT NULL DEFAULT '空' COMMENT '说明' /* 原注释 */");
    expect(result.requiredAcknowledgements).toContain('conversion-or-nullability');
  });

  it('受控 ENUM 值精确保留大小写逗号和引号，不按关键字比较抹平值变化', () => {
    const result = plan("CREATE TABLE t (v enum('a','b'))", [alter('v', { type: { kind: 'enumeration', type: 'ENUM', values: ['A', 'x,y', "q'\\"] } })]);
    const read = parseTableColumnDefinition(result.clauses[0].replace(/^MODIFY COLUMN /, 'CREATE TABLE t (') + ')', mysql);
    expect(read.columns[0].type.raw).toBe("ENUM('A','x,y','q''\\\\')");
  });

  it('大对象默认值按方言控制，精度及 BIT 宽度不静默截断', () => {
    const change = alter('v', { default: { kind: 'literal', valueType: 'text', value: 'a' } });
    expect(() => plan('CREATE TABLE t (v text)', [change], mysql, '5.7.44')).toThrow('5.7');
    expect(() => plan('CREATE TABLE t (v text)', [change], mysql, '8.0.12')).toThrow('8.0.13');
    expect(plan('CREATE TABLE t (v text)', [change]).sql).toContain("MODIFY COLUMN v text DEFAULT ('a')");
    expect(plan('CREATE TABLE t (v text)', [change], { ...mysql, dialect: 'mariadb' }, '10.11.19').sql).toContain("SET DEFAULT 'a'");
    expect(plan('CREATE TABLE t (v timestamp(6))', [alter('v', { default: { kind: 'expression', expression: 'current-timestamp' } })]).sql).toContain('CURRENT_TIMESTAMP(6)');
    expect(() => plan('CREATE TABLE t (v timestamp(6))', [alter('v', { default: { kind: 'expression', expression: 'current-timestamp', precision: 0 } })])).toThrow('精度');
    expect(plan('CREATE TABLE t (v bit(64))', [alter('v', { default: { kind: 'literal', valueType: 'binary', value: 'ffffffffffffffff' } })]).sql).toContain("b'" + '1'.repeat(64) + "'");
    expect(() => plan('CREATE TABLE t (v bit(63))', [alter('v', { default: { kind: 'literal', valueType: 'binary', value: 'ffffffffffffffff' } })])).toThrow('位数');
  });

  it.each(['8.0.46', '8.4.11'])('MySQL %s 大对象预选 MODIFY 表达式默认且精确保留其余原属性', version => {
    const source = "CREATE TABLE t (v text CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL COMMENT '未改',b blob COMMENT '字节')";
    const result = plan(source, [alter('v', { default: { kind: 'literal', valueType: 'text', value: '汉字' } }), alter('b', { default: { kind: 'literal', valueType: 'binary', value: '00ff0127' } })], mysql, version);
    expect(result.clauses).toEqual(["MODIFY COLUMN v text CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL COMMENT '未改' DEFAULT ('汉字')", "MODIFY COLUMN b blob COMMENT '字节' DEFAULT (X'00ff0127')"]);
    expect(splitSql(result.sql)).toHaveLength(1); expect(result.sql).not.toContain('ALTER COLUMN');
  });

  it('改名加新增 AFTER 链按引用排序，原型名称和反引号安全引用', () => {
    const result = plan('CREATE TABLE t (a int, b int)', [add('new2', '尾', { kind: 'after', columnRef: 'new1' }), add('new1', '__proto__', { kind: 'after', columnRef: 'a' }), alter('a', { name: 'a`新' })]);
    expect(result.clauses[0]).toBe('RENAME COLUMN `a` TO `a``新`');
    expect(result.sql).toContain('AFTER `a``新`'); expect(result.sql).toContain('AFTER `__proto__`');
    expect(result.finalColumns.map(column => column.name)).toEqual(['a`新', '__proto__', '尾', 'b']);
  });

  it('FIRST/LAST 与删除生成最终顺序，未动字段保留且无自动事务', () => {
    const result = plan('CREATE TABLE t (a int,b int,c int,d int)', [alter('c', { position: { kind: 'first' } }), { kind: 'drop', columnRef: 'b' }, alter('a', { position: { kind: 'last' } })]);
    expect(result.finalColumns.map(column => column.name)).toEqual(['c', 'd', 'a']);
    expect(result.sql).toContain('DROP COLUMN `b`'); expect(result.sql).not.toMatch(/BEGIN|COMMIT/);
    expect(result.requiredAcknowledgements).toContain('drop-column-data');
  });

  it('拒绝碰撞、复用旧名字/引用、未知引用、位置环和矛盾', () => {
    const source = 'CREATE TABLE t (a int,b int,c int)';
    const invalid = [
      [alter('a', { name: 'B' })], [alter('a', { name: 'x' }), alter('b', { name: 'a' })],
      [{ kind: 'drop', columnRef: 'a' }, add('a', 'new', { kind: 'last' })],
      [alter('missing', { comment: 'x' })], [alter('a', { position: { kind: 'after', columnRef: 'missing' } })],
      [alter('a', { position: { kind: 'after', columnRef: 'b' } }), alter('b', { position: { kind: 'after', columnRef: 'a' } })],
      [alter('a', { position: { kind: 'first' } }), alter('b', { position: { kind: 'first' } })],
      [add('x', 'x', { kind: 'last' }), add('y', 'y', { kind: 'last' })],
    ];
    for (const changes of invalid) expect(() => plan(source, changes)).toThrow();
  });

  it('索引、外键、生成列、CHECK 与不透明依赖阻止结构修改，字符串假名称不算依赖', () => {
    for (const tail of ['KEY ix(a)', 'CONSTRAINT fk FOREIGN KEY(a) REFERENCES p(id)', 'CHECK(a>0)', 'g int GENERATED ALWAYS AS(a+1) VIRTUAL', 'x int SOMETHING a']) {
      expect(() => plan('CREATE TABLE t (a int,' + tail + ')', [alter('a', { name: 'z' })])).toThrow();
    }
    expect(plan("CREATE TABLE t (a int,b varchar(10) DEFAULT ('a'))", [alter('a', { name: 'z' })]).sql).toContain('RENAME COLUMN');
    expect(() => plan('CREATE TABLE t (a int,g int GENERATED ALWAYS AS(a+1) VIRTUAL)', [alter('g', { comment: 'x' })])).toThrow('生成列');
    expect(plan('CREATE TABLE t (a int,KEY ix(a))', [alter('a', { comment: '说明' })]).sql).toContain('COMMENT');
  });

  it('分区、版本注释和未知尾部保守保留，仅无结构依赖的修改或末尾新增', () => {
    for (const tail of ['PARTITION BY HASH(a) PARTITIONS 2', '/*!50100 PARTITION BY HASH(a) */', 'NEW_OPTION=something']) {
      const source = 'CREATE TABLE t (a int,b int) ENGINE=InnoDB ' + tail;
      expect(() => plan(source, [alter('b', { type: { kind: 'integer', type: 'BIGINT', unsigned: false } })])).toThrow('表尾');
      expect(plan(source, [alter('a', { comment: '新' })]).preserved.tail).toContain(tail);
      expect(plan(source, [add('x', 'x', { kind: 'last' })]).sql).toContain('ADD COLUMN');
    }
  });

  it('尾随行注释不能吞下下一子句，插入范围不覆盖旁边原注释', () => {
    const result = plan('CREATE TABLE t (a int # 原字段注释\n,b int)', [alter('a', { comment: '甲' }), alter('b', { comment: '乙' })]);
    expect(splitSql(result.sql)).toHaveLength(1); expect(result.sql).toContain("a int COMMENT '甲' # 原字段注释");
    expect(result.clauses).toHaveLength(2); expect(result.sql).toContain("b int COMMENT '乙'");
  });

  it('无实际变化、快照不全、版本未知、数据库不符均明确失败且不修改源对象', () => {
    const source = 'CREATE TABLE db.t (a int NULL,b int)', document = parseTableColumnDefinition(source, mysql);
    const options = { database: 'db', serverVersion: '8.4.11', columnRefs: new Map([['a', 'a'], ['b', 'b']]) };
    expect(() => buildTableColumnPatchSql(document, [alter('a', { nullable: true })], options)).toThrow('没有实际');
    expect(() => buildTableColumnPatchSql(document, [alter('a', { comment: 'x' })], { ...options, columnRefs: new Map([['a', 'a']]) })).toThrow('不完整');
    expect(() => buildTableColumnPatchSql(document, [alter('a', { comment: 'x' })], { ...options, database: 'wrong' })).toThrow('数据库');
    expect(() => buildTableColumnPatchSql(document, [alter('a', { comment: 'x' })], { ...options, serverVersion: '9.0.0' })).toThrow('版本');
    buildTableColumnPatchSql(document, [alter('a', { name: '新' })], options);
    expect(document.source).toBe(source); expect(document.columns[0].name).toBe('a'); expect([...document.columnsByName.keys()]).toEqual(['a', 'b']);
  });

  it('新增不能绕过最终字段数预算，巨大补丁在 SQL 拼接前拒绝', () => {
    const source = 'CREATE TABLE t (' + Array.from({ length: 4096 }, (_, index) => 'c' + index + ' int').join(',') + ')';
    expect(() => plan(source, [add('new', 'new', { kind: 'last' })])).toThrow('4096');
    expect(() => plan('CREATE TABLE t(a int)', [alter('a', { comment: 'x'.repeat(512 * 1024) })])).toThrow('512 KiB');
  });
});
