import { describe, expect, it, vi } from 'vitest';
import { assertColumnAttributeReadable, parseTableColumnDefinition } from '../../src/engine/tableColumnDefinition';
import { inspectColumnPatchInput, tableColumnPatchLimits as limits, validateColumnPatches, type TableColumnDefinitionDocument, type TableDefinitionContext } from '../../src/shared/tableColumnPatches';

const mysql: TableDefinitionContext = { dialect: 'mysql', mode: { noBackslashEscapes: false, ansiQuotes: false } };
const maria: TableDefinitionContext = { dialect: 'mariadb', mode: { noBackslashEscapes: false, ansiQuotes: false } };
/** 按公开范围回放定义，验证所有空白、普通注释及分隔符均没有被解析过程吞掉。 */
function replay(document: TableColumnDefinitionDocument): string {
  return document.head.raw + document.items.map((item, index) => item.raw + (document.separators[index] ? document.source.slice(document.separators[index].start, document.separators[index].end) : '')).join('') + document.tail.raw;
}

// 这些是版本形态夹具，不是本批服务器执行证据；只验证定义读取和精确范围。
const fixtures = [
  ['MySQL 5.7', mysql, "CREATE TABLE `t57` (\n  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,\n  `title` varchar(60) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL COMMENT '旧注释',\n  `time` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),\n  `generated` int(11) GENERATED ALWAYS AS ((`id` + 1)) VIRTUAL,\n  PRIMARY KEY (`id`), KEY `prefix` (`title`(10))\n) ENGINE=InnoDB AUTO_INCREMENT=19 DEFAULT CHARSET=utf8mb4 ROW_FORMAT=DYNAMIC"],
  ['MySQL 8.0', mysql, "CREATE TABLE `t80` (`id` bigint unsigned NOT NULL, `name` varchar(90) DEFAULT '', `payload` json DEFAULT (json_object('comma', ',', 'nested', json_array(1, 2))), KEY `functional` ((lower(`name`))), KEY `desc` (`id` DESC) INVISIBLE, CONSTRAINT `check_c` CHECK ((`id` > 0))) ENGINE=InnoDB"],
  ['MySQL 8.4', mysql, "CREATE TABLE `t84` (`id` bigint unsigned NOT NULL AUTO_INCREMENT INVISIBLE, `amount` decimal(65,30) NOT NULL DEFAULT 12345678901234567890.123456, `sp` point NOT NULL SRID 4326, PRIMARY KEY (`id`), SPATIAL KEY `sp_idx` (`sp`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"],
  ['MariaDB 10.11', maria, "CREATE TABLE `tm10` (`id` bigint(20) NOT NULL, `amount` decimal(65,38) DEFAULT 0.00000000000000000000000000000000000001, `v` varchar(40) DEFAULT concat('a,', 'COMMENT DEFAULT'), `g` bigint(20) GENERATED ALWAYS AS (`id` * 2) STORED, KEY `v_key` (`v`), CONSTRAINT `fk` FOREIGN KEY (`id`) REFERENCES `other`.`parent` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT) ENGINE=InnoDB"],
  ['MariaDB 11.4', maria, "CREATE TABLE `tm11` (`id` int(11) NOT NULL, `state` enum('ready','a,b','COMMENT DEFAULT') DEFAULT 'ready', `hidden` int(11) INVISIBLE DEFAULT NULL, CONSTRAINT `positive` CHECK (`id` >= 0)) ENGINE=InnoDB\n PARTITION BY RANGE (`id`)\n(PARTITION `p0` VALUES LESS THAN (10) ENGINE = InnoDB, PARTITION `pmax` VALUES LESS THAN MAXVALUE ENGINE = InnoDB)"],
] as const;

describe('SHOW CREATE 字段定义的保偏移读取', () => {
  for (const [label, context, source] of fixtures) it(`${label} 规范形态保留列、复杂约束与表尾，可精确回放`, () => {
    const definition = parseTableColumnDefinition(source, context);
    expect(replay(definition)).toBe(source); expect(definition.columnsByName.get('id')?.ordinal).toBe(0);
    for (const item of definition.items) expect(source.slice(item.range.start, item.range.end)).toBe(item.raw);
    expect(definition.columns.length).toBeGreaterThan(1); expect(definition.items.some(item => item.kind === 'constraint')).toBe(true);
    expect(definition.tail.raw).toContain('ENGINE=InnoDB');
  });

  it('同名原型字段、Unicode 和反引号双写保持真实身份，名称内点号不拆分', () => {
    const source = 'CREATE TABLE `库.一`.`表``名` (`__proto__` int, `constructor` varchar(4), `toString` int, `中🚢` int, `a``b` int)';
    const document = parseTableColumnDefinition(source, mysql);
    expect(document.database).toBe('库.一'); expect(document.table).toBe('表`名');
    expect([...document.columnsByName.keys()]).toEqual(['__proto__', 'constructor', 'toString', '中🚢', 'a`b']);
    expect(document.columnsByName.get('__proto__')?.type.raw).toBe('int'); expect(replay(document)).toBe(source);
  });

  it('字符串里的逗号、括号和 COMMENT/DEFAULT 不构成列或属性边界', () => {
    const source = "CREATE TABLE `t` (\n `e` enum('a,b','DEFAULT COMMENT )','it''s') DEFAULT 'a,b' COMMENT 'COMMENT DEFAULT (,)', -- 假字段 x int,\n /* 假列 y int, */ `x` int DEFAULT (coalesce(nullif(1, 2), 3))\n) COMMENT='表尾,)'";
    const document = parseTableColumnDefinition(source, mysql), e = document.columns[0];
    expect(document.columns.map(column => column.name)).toEqual(['e', 'x']);
    expect(e.type.raw).toBe("enum('a,b','DEFAULT COMMENT )','it''s')"); expect(e.comment).toBe('COMMENT DEFAULT (,)');
    expect(document.columns[1].default).toEqual({ kind: 'expression', sql: '(coalesce(nullif(1, 2), 3))' }); expect(replay(document)).toBe(source);
  });

  it('默认值不混淆缺省、NULL、空文本、文本 NULL、精确数字和表达式', () => {
    const source = "CREATE TABLE t (a int, b int DEFAULT NULL, c varchar(4) DEFAULT '', d varchar(4) DEFAULT 'NULL', e decimal(30,6) DEFAULT -12345678901234567890.123456, f timestamp(6) DEFAULT CURRENT_TIMESTAMP(6), g varchar(9) DEFAULT (concat('a', 'b')), h int DEFAULT FALSE)";
    expect(parseTableColumnDefinition(source, mysql).columns.map(column => column.default)).toEqual([
      { kind: 'none' }, { kind: 'null' }, { kind: 'literal', valueType: 'text', value: '' }, { kind: 'literal', valueType: 'text', value: 'NULL' },
      { kind: 'literal', valueType: 'number', value: '-12345678901234567890.123456' }, { kind: 'expression', sql: 'CURRENT_TIMESTAMP(6)' }, { kind: 'expression', sql: "(concat('a', 'b'))" }, { kind: 'literal', valueType: 'boolean', value: 'false' },
    ]);
  });

  it('字符集引导字和位/十六进制默认值保留编码来源，不把位串当十进制数', () => {
    const document = parseTableColumnDefinition("CREATE TABLE t (a varchar(5) DEFAULT _utf8mb4'中文', b bit(7) DEFAULT b'0010011', c binary(2) DEFAULT X'00FF', d binary(1) DEFAULT 0x0F)", mysql);
    expect(document.columns.map(column => column.default)).toEqual([
      { kind: 'literal', valueType: 'text', value: '中文', introducer: '_utf8mb4' },
      { kind: 'literal', valueType: 'binary', value: '0010011', introducer: 'b', encoding: 'bits' },
      { kind: 'literal', valueType: 'binary', value: '00FF', introducer: 'X', encoding: 'hex' },
      { kind: 'literal', valueType: 'binary', value: '0F', introducer: '0x', encoding: 'hex' },
    ]);
  });

  it('DEFAULT 后 COLLATE 保守视为整体不确定片段，绝不伪拆成列排序规则', () => {
    for (const context of [mysql, maria]) {
      const source = "CREATE TABLE t (a varchar(20) DEFAULT _utf8mb4'abc' COLLATE utf8mb4_bin COMMENT '保留', b varchar(20) COLLATE utf8mb4_bin DEFAULT 'abc')";
      const document = parseTableColumnDefinition(source, context), [a, b] = document.columns;
      expect(a.default).toMatchObject({ kind: 'opaque', sql: "_utf8mb4'abc' COLLATE utf8mb4_bin" });
      expect(a.attributes.some(attribute => attribute.kind === 'collation')).toBe(false); expect(() => assertColumnAttributeReadable(a, 'default')).toThrow();
      expect(b.attributes.some(attribute => attribute.kind === 'collation')).toBe(true); expect(b.default).toMatchObject({ kind: 'literal', value: 'abc' }); expect(replay(document)).toBe(source);
    }
  });

  it('明确 ANSI_QUOTES/NBE，反斜线只影响字符串，不转义标识符', () => {
    const ansi = { ...mysql, mode: { ansiQuotes: true, noBackslashEscapes: true } };
    const source = 'CREATE TABLE "库"."t" ("a""b" varchar(50) DEFAULT \'a\\n\' COMMENT \'x\\y\', "slash\\" int)';
    const document = parseTableColumnDefinition(source, ansi); expect(document.columns.map(column => column.name)).toEqual(['a"b', 'slash\\']);
    expect(document.columns[0].default).toEqual({ kind: 'literal', valueType: 'text', value: 'a\\n' }); expect(document.columns[0].comment).toBe('x\\y');
    expect(() => parseTableColumnDefinition(source, mysql)).toThrow('未闭合');
    expect(() => parseTableColumnDefinition('CREATE TABLE "t" ("a" int)', mysql)).toThrow('表名称');
    const escaped = parseTableColumnDefinition(String.raw`CREATE TABLE t (a varchar(50) DEFAULT 'a\n\0\Z\%\_it\'s' COMMENT "double")`, mysql);
    expect(escaped.columns[0].default).toEqual({ kind: 'literal', valueType: 'text', value: "a\n\0\x1a\\%\\_it's" });
    expect(() => parseTableColumnDefinition('CREATE TABLE t (a int)', { ...mysql, mode: { ...mysql.mode, ansiQuotesKnown: false } })).toThrow('明确');
  });

  it('目标注释范围可独立替换；列排序规则、ON UPDATE、未改列与复杂索引不被吞掉', () => {
    const source = fixtures[0][2], before = parseTableColumnDefinition(source, mysql), column = before.columnsByName.get('title')!;
    const attribute = column.attributes.find(item => item.kind === 'comment')!;
    const patched = source.slice(0, attribute.range.start) + "COMMENT '新注释'" + source.slice(attribute.range.end), after = parseTableColumnDefinition(patched, mysql);
    expect(after.columnsByName.get('title')?.comment).toBe('新注释');
    expect(after.columnsByName.get('title')?.attributes.filter(item => item.kind !== 'comment').map(item => item.raw)).toEqual(column.attributes.filter(item => item.kind !== 'comment').map(item => item.raw));
    for (const name of ['id', 'time', 'generated']) expect(after.columnsByName.get(name)?.raw).toBe(before.columnsByName.get(name)?.raw);
    expect(after.items.filter(item => item.kind === 'constraint').map(item => item.raw)).toEqual(before.items.filter(item => item.kind === 'constraint').map(item => item.raw)); expect(after.tail.raw).toBe(before.tail.raw);
  });

  it('生成列只读不连带禁止普通列，复杂列属性与约束分别保留', () => {
    const source = "CREATE TABLE t (normal int DEFAULT 0, generated int GENERATED ALWAYS AS ((normal + 1)) STORED, special varchar(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin STORAGE DISK COLUMN_FORMAT DYNAMIC INVISIBLE CHECK (length(special) > 0), FULLTEXT KEY ft(special), CONSTRAINT fk FOREIGN KEY(normal) REFERENCES parent(id))";
    const document = parseTableColumnDefinition(source, mysql);
    expect(() => assertColumnAttributeReadable(document.columnsByName.get('normal')!, 'comment')).not.toThrow();
    expect(() => assertColumnAttributeReadable(document.columnsByName.get('generated')!, 'type')).toThrow('生成列');
    expect(document.columnsByName.get('special')?.attributes.map(item => item.kind)).toEqual(['charset', 'collation', 'storage', 'column-format', 'visibility', 'check']);
    expect(document.items.filter(item => item.kind === 'constraint').map(item => item.constraintKind)).toEqual(['FULLTEXT', 'CONSTRAINT']);
  });

  it('未知后缀和陌生默认值保留 opaque，属性不能被默认成可安全修改', () => {
    const source = "CREATE TABLE t (a int FUTURE_ATTRIBUTE (DEFAULT 7) COMMENT '不能假读', b strange_type(9) DEFAULT 1, c int DEFAULT strange_token + 7 COMMENT '已知注释', d int DEFAULT 1)";
    const document = parseTableColumnDefinition(source, mysql);
    expect(document.columns[0].comment).toBeUndefined(); expect(document.columns[0].attributes[0].kind).toBe('opaque');
    expect(document.columns[0].default.kind).toBe('opaque');
    expect(document.columns[1].type.known).toBe(false); expect(document.columns[2].default).toMatchObject({ kind: 'opaque', sql: 'strange_token + 7' });
    for (const column of document.columns.slice(0, 3)) expect(() => assertColumnAttributeReadable(column, 'default')).toThrow('边界');
    expect(() => assertColumnAttributeReadable(document.columns[3], 'default')).not.toThrow(); expect(replay(document)).toBe(source);
  });

  it('可执行版本属性不静默忽略，表尾分区注释原样保留', () => {
    for (const prefix of ['/*!80023', '/*M!100301']) {
      const source = `CREATE TABLE t (a int ${prefix} INVISIBLE */, b int COMMENT '普通') ENGINE=InnoDB /*!50100 PARTITION BY HASH (a) PARTITIONS 2 */`;
      const document = parseTableColumnDefinition(source, maria); expect(replay(document)).toBe(source);
      expect(document.columns[0].attributes[0].kind).toBe('opaque'); expect(() => assertColumnAttributeReadable(document.columns[0], 'nullable')).toThrow('可执行');
      expect(() => assertColumnAttributeReadable(document.columns[1], 'comment')).not.toThrow(); expect(document.tail.raw).toContain('PARTITION BY HASH');
    }
    for (const body of ['INVISIBLE, hidden int', ')', '(', 'INVISIBLE; DROP TABLE t', "COMMENT '未闭合"]) expect(() => parseTableColumnDefinition(`CREATE TABLE t (a int /*!80023 ${body} */)`, mysql)).toThrow();
  });

  it('拒绝多语句、缺少定义、不完整引号/括号、空列、重复属性和名称歧义', () => {
    for (const source of [
      '', 'CREATE TABLE t', 'CREATE TABLE t ()', 'CREATE VIEW t AS SELECT 1', 'CREATE TEMPORARY TABLE t (a int)',
      'CREATE TABLE t (a int); DROP TABLE t', "CREATE TABLE t (a varchar(5) DEFAULT 'x)", 'CREATE TABLE t (a int /*x)',
      'CREATE TABLE t (a decimal(10,2)', 'CREATE TABLE t (a int,, b int)', 'CREATE TABLE t (a int,)',
      'CREATE TABLE t (a int NULL NOT NULL)', 'CREATE TABLE t (a int DEFAULT 1 DEFAULT 2)', 'CREATE TABLE t (A int, a int)',
      'CREATE TABLE t (a int DEFAULT)', 'CREATE TABLE t (a int COMMENT)', 'CREATE TABLE t (a int GENERATED AS)',
    ]) expect(() => parseTableColumnDefinition(source, mysql), source).toThrow();
  });

  it('定义字节、嵌套和列数预算真实生效，达到列数上限仍可精确回放', () => {
    expect(() => parseTableColumnDefinition(`CREATE TABLE t (a int) COMMENT='${'中'.repeat(Math.ceil(limits.definitionBytes / 3))}'`, mysql)).toThrow('2 MiB');
    expect(() => parseTableColumnDefinition(`CREATE TABLE t (a int DEFAULT ${'('.repeat(129)}1${')'.repeat(129)})`, mysql)).toThrow('嵌套');
    const columns = Array.from({ length: limits.columns }, (_, index) => `c${index} int`);
    const source = `CREATE TABLE t (${columns.join(',')})`, document = parseTableColumnDefinition(source, mysql); expect(document.columns).toHaveLength(limits.columns); expect(replay(document)).toBe(source);
    expect(() => parseTableColumnDefinition(`CREATE TABLE t (${columns.join(',')}, extra int)`, mysql)).toThrow('4096');
  });
});

describe('未来字段差异入口的纯补丁校验', () => {
  it('预算先于克隆和转义分配，巨大旁字段/ENUM 元素拒绝且不调用 getter/toJSON', () => {
    const getter = vi.fn(() => '不应调用'), toJSON = vi.fn(() => []);
    const huge = '中'.repeat(limits.patchBytes * 2);
    for (const input of [
      [{ kind: 'alter', columnRef: 'a', changes: { comment: huge }, get extra() { return getter(); } }],
      [{ kind: 'alter', columnRef: 'a', changes: { type: { kind: 'enumeration', type: 'ENUM', values: [huge] } } }],
    ]) expect(() => validateColumnPatches(input)).toThrow('512 KiB');
    const accessors = [{ kind: 'alter', columnRef: 'a', changes: { get comment() { return getter(); } } }];
    expect(() => validateColumnPatches(accessors)).toThrow('数据字段');
    expect(() => validateColumnPatches([{ toJSON }])).toThrow('非法值'); expect(getter).not.toHaveBeenCalled(); expect(toJSON).not.toHaveBeenCalled();
  });

  it('循环、非普通容器、非法值、层级、稀疏和额外数组键均在 Zod 之前拒绝', () => {
    const cycle: any = {}; cycle.self = cycle;
    const deep: any = {}; let current = deep; for (let index = 0; index < 9; index++) { current.child = {}; current = current.child; }
    const accessorArray: unknown[] = []; Object.defineProperty(accessorArray, '0', { enumerable: true, get: () => { throw new Error('不能调用数组 getter'); } });
    for (const input of [[cycle], [new Date()], [new Map()], [undefined], [NaN], [1n], [deep], new Array(2), Object.assign([], { extra: 1 }), accessorArray]) expect(() => inspectColumnPatchInput(input)).toThrow();
    expect(() => inspectColumnPatchInput([Object.fromEntries(Array.from({ length: 17 }, (_, index) => [String(index), 0]))])).toThrow('字段过多');
    expect(() => inspectColumnPatchInput(['\ud800'])).toThrow('Unicode');
  });

  it('JSON UTF-8 预算包含 Unicode、控制字符和引号转义，恰好512KiB通过，多一字节拒绝', () => {
    const prefix = '中🚢\0\n"\\'.repeat(1000);
    const patch = [{ kind: 'alter', columnRef: 'a', changes: { comment: prefix } }];
    patch[0].changes.comment += 'a'.repeat(limits.patchBytes - Buffer.byteLength(JSON.stringify(patch), 'utf8'));
    expect(inspectColumnPatchInput(patch).bytes).toBe(limits.patchBytes); expect(validateColumnPatches(patch)).toEqual(patch);
    patch[0].changes.comment += 'a'; expect(() => validateColumnPatches(patch)).toThrow('512 KiB');
  });
  it('默认值三种空态明确，精确数字、原型列名和 Maria 38 位 scale 不损失', () => {
    for (const value of [{ kind: 'none' }, { kind: 'null' }, { kind: 'literal', valueType: 'text', value: '' }, { kind: 'literal', valueType: 'text', value: 'NULL' }, { kind: 'literal', valueType: 'number', value: '9007199254740993.000001' }, { kind: 'expression', expression: 'current-timestamp', precision: 6 }]) {
      const patches = [{ kind: 'alter', columnRef: '__proto__', changes: { default: value } }]; expect(validateColumnPatches(patches)).toEqual(patches);
    }
    const patch = [{ kind: 'alter', columnRef: 'ref', changes: { type: { kind: 'decimal', precision: 65, scale: 38, unsigned: false } } }];
    expect(() => validateColumnPatches(patch)).toThrow('小数位'); expect(validateColumnPatches(patch, 38)).toEqual(patch);
  });

  it('不接任意 SQL、未知字段、重复目标、空修改和无效值，不能借校验拼出类型注入', () => {
    for (const patches of [
      [{ kind: 'alter', columnRef: 'a', changes: {} }], [{ kind: 'drop', columnRef: 'a' }, { kind: 'alter', columnRef: 'a', changes: { comment: 'x' } }],
      [{ kind: 'drop', columnRef: 'a', sql: 'DROP TABLE t' }], [{ kind: 'alter', columnRef: 'a', changes: { type: 'int;DROP TABLE t' } }],
      [{ kind: 'alter', columnRef: 'a', changes: { default: { kind: 'expression', expression: 'sleep(1)' } } }],
      ...['NaN', '1;SELECT 2'].map(value => [{ kind: 'alter', columnRef: 'a', changes: { default: { kind: 'literal', valueType: 'number', value } } }]),
      [{ kind: 'alter', columnRef: 'a', changes: { default: { kind: 'literal', valueType: 'binary', value: 'abc' } } }],
      [{ kind: 'alter', columnRef: 'a', changes: { type: { kind: 'temporal', type: 'DATE', precision: 3 } } }],
    ]) expect(() => validateColumnPatches(patches)).toThrow();
    expect(() => validateColumnPatches([{ kind: 'alter', columnRef: 'a', changes: { comment: '中'.repeat(limits.patchBytes / 2) } }])).toThrow('512 KiB');
    expect(() => validateColumnPatches(Array.from({ length: 101 }, (_, index) => ({ kind: 'drop', columnRef: String(index) })))).toThrow();
  });
});
