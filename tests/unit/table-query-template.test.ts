import { describe, expect, it } from 'vitest';
import type { ColumnInfo, TableInfo } from '../../src/shared/contracts';
import { splitSql } from '../../src/engine/sql';
import { bindQueryParameters, namedParameterTokens, queryParameterLiteral } from '../../src/shared/queryParameters';
import { buildTableQueryTemplate, tableQueryTemplateColumns, tableQueryTemplateMetadataKey, type TableQueryTemplateOptions } from '../../src/renderer/tableQueryTemplate';
import { tableQueryTemplateZh as text } from '../../src/renderer/locales/tableQueryTemplate.zh-CN';

/** 合成目录不含行数据；默认具备非空主键、自增和生成列。 */
function fixture(): TableInfo { const field = (name: string): ColumnInfo => ({ name, type: 'varchar(100)', nullable: false, defaultValue: null, extra: '', generated: false, comment: '' }); return { database: '库`名', name: '表;名', objectKind: 'table', engine: 'InnoDB', columns: [{ ...field('id'), type: 'bigint', extra: 'auto_increment' }, field('内容`列'), { ...field('金额'), type: 'decimal(30,20)' }, { ...field('计算值'), generated: true, extra: 'VIRTUAL GENERATED' }], primaryKey: ['id'], editableKey: ['id'], indexes: [], foreignKeys: [], ddl: '不应读取DDL' }; }

describe('从表结构生成独立查询模板', () => {
  it('SELECT完整引用数据库／表／列及当前上限，反引号和分号不改变单语句边界', () => {
    const info = fixture(), output = buildTableQueryTemplate(info, 'SELECT', 37); expect(output.parameters).toBe(0); expect(output.sql).toContain('FROM `库``名`.`表;名`\nLIMIT 37;'); expect(output.sql).toContain('`内容``列`'); expect(output.sql).toContain('`计算值`'); expect(splitSql(output.sql)).toHaveLength(1);
  });
  it('INSERT只生成普通非自增字段的独立值参数，不拼接业务值或生成表达式', () => {
    const output = buildTableQueryTemplate(fixture(), 'INSERT', 1000); expect(output.parameters).toBe(2); expect(output.sql).toContain('`内容``列` = :value_1'); expect(output.sql).toContain('`金额` = :value_2'); expect(output.sql).not.toContain('`id`'); expect(output.sql).not.toContain('`计算值`'); expect(splitSql(output.sql)).toHaveLength(1);
    const only = fixture(); only.columns = [only.columns[0], only.columns[3]]; expect(buildTableQueryTemplate(only, 'INSERT', 50)).toMatchObject({ parameters: 0 }); expect(buildTableQueryTemplate(only, 'INSERT', 50).sql).toContain('() VALUES ();');
  });
  it('UPDATE／DELETE按完整复合键参数化，默认不改键，并保留LIMIT 1', () => {
    const info = fixture(); info.primaryKey = info.editableKey = ['id', '金额']; const update = buildTableQueryTemplate(info, 'UPDATE', 1000), remove = buildTableQueryTemplate(info, 'DELETE', 1000);
    expect(update.parameters).toBe(3); expect(update.sql).toContain('SET\n  `内容``列` = :value_1\nWHERE'); expect(update.sql).toContain('`id` = :key_1'); expect(update.sql).toContain('`金额` = :key_2'); expect(update.sql).toMatch(/LIMIT 1;$/); expect(remove.parameters).toBe(2); expect(remove.sql).not.toContain('SET'); expect(remove.sql).toMatch(/LIMIT 1;$/); expect(splitSql(update.sql)).toHaveLength(1); expect(splitSql(remove.sql)).toHaveLength(1);
  });
  it('接受已确认非空唯一键，未知表达式索引不阻断SELECT或已确认主键', () => {
    const info = fixture(); info.indexes = [{ name: '表达式', unique: true, columns: ['无法证明的表达式'] }]; expect(buildTableQueryTemplate(info, 'SELECT', 50).parameters).toBe(0); expect(buildTableQueryTemplate(info, 'DELETE', 50).parameters).toBe(1);
    info.primaryKey = []; info.editableKey = ['金额']; info.indexes.push({ name: 'u', unique: true, columns: ['金额'] }); expect(buildTableQueryTemplate(info, 'DELETE', 50).parameters).toBe(1); info.columns[2].nullable = true; expect(() => buildTableQueryTemplate(info, 'DELETE', 50)).toThrow('可靠唯一键');
  });
  it('无可靠键、视图、未知对象及无非键字段不生成可误执行的写模板', () => {
    const info = fixture(); info.editableKey = []; for (const kind of ['UPDATE', 'DELETE'] as const) expect(() => buildTableQueryTemplate(info, kind, 100)).toThrow('可靠唯一键');
    for (const objectKind of ['view', undefined] as const) { const view = { ...fixture(), objectKind }; expect(buildTableQueryTemplate(view, 'SELECT', 100).sql).toContain('SELECT'); for (const kind of ['INSERT', 'UPDATE', 'DELETE'] as const) expect(() => buildTableQueryTemplate(view, kind, 100)).toThrow('普通表'); }
    const only = fixture(); only.columns = [only.columns[0]]; expect(() => buildTableQueryTemplate(only, 'UPDATE', 100)).toThrow('非键字段');
  });
  it('拒绝重复／缺失字段、非法名称／上限和超过200个参数，不截断SQL', () => {
    const info = fixture(); info.columns = Array.from({ length: 202 }, (_, index) => ({ ...info.columns[1], name: '字段' + index })); info.primaryKey = info.editableKey = [];
    expect(() => buildTableQueryTemplate(info, 'INSERT', 100)).toThrow('预算'); expect(buildTableQueryTemplate(info, 'SELECT', 100).sql).toContain('字段201');
    for (const limit of [0, -1, 100001, NaN, Infinity, 1.5]) expect(() => buildTableQueryTemplate(fixture(), 'SELECT', limit)).toThrow();
    for (const name of ['', 'x\0y', '\ud800', 'x'.repeat(65)]) expect(() => buildTableQueryTemplate({ ...fixture(), name }, 'SELECT', 50)).toThrow();
    const duplicate = fixture(); duplicate.columns.push(duplicate.columns[0]); expect(() => buildTableQueryTemplate(duplicate, 'SELECT', 50)).toThrow();
  });
  it('结构身份观察模板相关变化，不读取DDL、注释或默认值', () => {
    const info = fixture(); let reads = 0; for (const [object, key] of [[info, 'ddl'], [info.columns[0], 'comment'], [info.columns[0], 'defaultValue']] as const) Object.defineProperty(object, key, { get() { reads++; throw Error('不应读取'); } });
    const original = tableQueryTemplateMetadataKey(info); buildTableQueryTemplate(info, 'SELECT', 100); expect(reads).toBe(0); info.columns[1].type = 'text'; expect(tableQueryTemplateMetadataKey(info)).not.toBe(original);
  });
  it('四种SQL引号模式下沿正式参数扫描和绑定保持单语句，不把列名当参数', () => {
    const info = fixture(); info.columns[1].name = ':value_99`--列';
    for (const ansiQuotes of [false, true]) for (const noBackslashEscapes of [false, true]) for (const kind of ['INSERT', 'UPDATE', 'DELETE'] as const) {
      const mode = { ansiQuotes, noBackslashEscapes }, output = buildTableQueryTemplate(info, kind, 100), names = namedParameterTokens(output.sql, mode).map(token => token.name);
      expect(names).toHaveLength(output.parameters); expect(names).not.toContain('value_99');
      const bound = bindQueryParameters(output.sql, new Map(names.map(name => [name, queryParameterLiteral({ name, type: 'text', value: "';DROP TABLE -- 🚢" })])), mode);
      expect(namedParameterTokens(bound, mode)).toEqual([]); expect(splitSql(bound, noBackslashEscapes, ansiQuotes)).toHaveLength(1);
    }
  });
});

describe('SQL模板按显式列顺序生成', () => {
  it('默认候选保原准入及元数据顺序，返回副本不暴露原列数组', () => {
    const info = fixture();
    expect(tableQueryTemplateColumns(info, 'SELECT')).toEqual(['id', '内容`列', '金额', '计算值']);
    expect(tableQueryTemplateColumns(info, 'INSERT')).toEqual(['内容`列', '金额']);
    expect(tableQueryTemplateColumns(info, 'UPDATE')).toEqual(['内容`列', '金额']); expect(tableQueryTemplateColumns(info, 'DELETE')).toEqual([]);
    const copy = tableQueryTemplateColumns(info, 'SELECT'); copy.reverse(); expect(info.columns.map(column => column.name)).toEqual(['id', '内容`列', '金额', '计算值']);
    info.primaryKey = info.editableKey = ['id', '金额']; expect(tableQueryTemplateColumns(info, 'UPDATE')).toEqual(['内容`列']);
  });
  it('undefined沿原默认四种SQL逐字节输出，显式默认候选也不改SQL或参数', () => {
    const info = fixture(), target = '`库``名`.`表;名`';
    const bodies = {
      SELECT: `SELECT\n  \`id\`,\n  \`内容\`\`列\`,\n  \`金额\`,\n  \`计算值\`\nFROM ${target}\nLIMIT 37;`,
      INSERT: `INSERT INTO ${target}\nSET\n  \`内容\`\`列\` = :value_1,\n  \`金额\` = :value_2;`,
      UPDATE: `UPDATE ${target}\nSET\n  \`内容\`\`列\` = :value_1,\n  \`金额\` = :value_2\nWHERE\n  \`id\` = :key_1\nLIMIT 1;`,
      DELETE: `DELETE FROM ${target}\nWHERE\n  \`id\` = :key_1\nLIMIT 1;`,
    };
    for (const kind of ['SELECT', 'INSERT', 'UPDATE', 'DELETE'] as const) {
      const original = buildTableQueryTemplate(info, kind, 37);
      expect(original).toEqual({ sql: text.generatedComment + '\n' + bodies[kind], parameters: kind === 'SELECT' ? 0 : kind === 'INSERT' ? 2 : kind === 'UPDATE' ? 3 : 1 });
      expect(buildTableQueryTemplate(info, kind, 37, undefined)).toEqual(original);
      if (kind !== 'DELETE') expect(buildTableQueryTemplate(info, kind, 37, { columns: tableQueryTemplateColumns(info, kind) })).toEqual(original);
    }
  });
  it('SELECT允许生成/自增列子集，INSERT和UPDATE按请求顺序编号，不改完整WHERE', () => {
    const info = fixture();
    expect(buildTableQueryTemplate(info, 'SELECT', 23, { columns: ['计算值', 'id'] }).sql).toBe(text.generatedComment + '\nSELECT\n  `计算值`,\n  `id`\nFROM `库``名`.`表;名`\nLIMIT 23;');
    for (const kind of ['INSERT', 'UPDATE'] as const) {
      const output = buildTableQueryTemplate(info, kind, 23, { columns: ['金额', '内容`列'] });
      expect(output.sql).toContain('SET\n  `金额` = :value_1,\n  `内容``列` = :value_2'); expect(output.parameters).toBe(kind === 'INSERT' ? 2 : 3);
      if (kind === 'UPDATE') expect(output.sql).toContain('WHERE\n  `id` = :key_1\nLIMIT 1;');
      const subset = buildTableQueryTemplate(info, kind, 23, { columns: ['金额'] }); expect(subset.sql).not.toContain('`内容``列`'); expect(subset.parameters).toBe(kind === 'INSERT' ? 1 : 2);
    }
  });
  it('空INSERT明确生成默认值语法，SELECT和UPDATE空列分别报真实用途错误', () => {
    expect(buildTableQueryTemplate(fixture(), 'INSERT', 100, { columns: [] })).toEqual({ sql: text.generatedComment + '\nINSERT INTO `库``名`.`表;名` () VALUES ();', parameters: 0 });
    expect(() => buildTableQueryTemplate(fixture(), 'SELECT', 100, { columns: [] })).toThrow(text.fieldRequired);
    expect(() => buildTableQueryTemplate(fixture(), 'UPDATE', 100, { columns: [] })).toThrow(text.noUpdates);
  });
  it('宽表默认超过200参数后仍可精简，UPDATE参数预算包含原完整定位键', () => {
    const info = fixture(), value = info.columns[1];
    info.columns = [info.columns[0], ...Array.from({ length: 202 }, (_, index) => ({ ...value, name: '字段' + index }))];
    const insertCandidates = tableQueryTemplateColumns(info, 'INSERT'), updateCandidates = tableQueryTemplateColumns(info, 'UPDATE');
    expect(insertCandidates).toHaveLength(202); expect(updateCandidates).toHaveLength(202);
    for (const kind of ['INSERT', 'UPDATE'] as const) expect(() => buildTableQueryTemplate(info, kind, 100)).toThrow(text.budget);
    expect(buildTableQueryTemplate(info, 'INSERT', 100, { columns: insertCandidates.slice(0, 200).reverse() }).parameters).toBe(200);
    const update = buildTableQueryTemplate(info, 'UPDATE', 100, { columns: updateCandidates.slice(0, 199).reverse() }); expect(update.parameters).toBe(200); expect(update.sql).toContain('`字段198` = :value_1'); expect(update.sql).toContain('`id` = :key_1\nLIMIT 1;');
    expect(() => buildTableQueryTemplate(info, 'INSERT', 100, { columns: insertCandidates.slice(0, 201) })).toThrow(text.budget);
    expect(() => buildTableQueryTemplate(info, 'UPDATE', 100, { columns: updateCandidates.slice(0, 200) })).toThrow(text.budget);
  });
  it('显式选择仍执行完整SQL预算，精简只减少实际草稿而不截断字段', () => {
    const info = fixture(); info.columns = Array.from({ length: 4096 }, (_, index) => ({ ...info.columns[1], name: String(index).padStart(64, '列') })); info.primaryKey = info.editableKey = [];
    expect(() => buildTableQueryTemplate(info, 'SELECT', 100, { columns: tableQueryTemplateColumns(info, 'SELECT') })).toThrow(text.budget);
    expect(buildTableQueryTemplate(info, 'SELECT', 100, { columns: [info.columns[4095].name] }).sql).toContain('`' + info.columns[4095].name + '`');
  });
  it('生成、自增及完整复合键不可被加入写列，普通INSERT仍可显式选择非自增键', () => {
    const info = fixture(); info.primaryKey = info.editableKey = ['id', '金额'];
    for (const kind of ['INSERT', 'UPDATE'] as const) for (const name of ['id', '计算值']) expect(() => buildTableQueryTemplate(info, kind, 100, { columns: [name] })).toThrow(text.invalid);
    expect(() => buildTableQueryTemplate(info, 'UPDATE', 100, { columns: ['金额'] })).toThrow(text.invalid);
    expect(buildTableQueryTemplate(info, 'INSERT', 100, { columns: ['金额'] }).parameters).toBe(1);
    info.columns[3].generated = false; info.columns[3].extra = 'STORED GENERATED'; expect(() => buildTableQueryTemplate(info, 'INSERT', 100, { columns: ['计算值'] })).toThrow(text.invalid);
  });
  it('筛选候选和显式少列不能绕过普通表或完整非空可靠键门', () => {
    const missing = fixture(); missing.editableKey = [];
    for (const kind of ['UPDATE', 'DELETE'] as const) expect(() => tableQueryTemplateColumns(missing, kind)).toThrow(text.key);
    expect(() => buildTableQueryTemplate(missing, 'UPDATE', 100, { columns: ['金额'] })).toThrow(text.key);
    const nullable = fixture(); nullable.columns[0].nullable = true; expect(() => buildTableQueryTemplate(nullable, 'UPDATE', 100, { columns: ['金额'] })).toThrow(text.key);
    for (const objectKind of ['view', undefined] as const) {
      const view = { ...fixture(), objectKind }; expect(tableQueryTemplateColumns(view, 'SELECT')).toHaveLength(4);
      for (const kind of ['INSERT', 'UPDATE', 'DELETE'] as const) expect(() => tableQueryTemplateColumns(view, kind)).toThrow(text.readonly);
      expect(() => buildTableQueryTemplate(view, 'INSERT', 100, { columns: [] })).toThrow(text.readonly);
    }
  });
  it('DELETE禁止任何options，即使列为空也不允许更换删除范围', () => {
    for (const options of [{ columns: [] }, { columns: ['金额'] }, {}, null, false]) expect(() => buildTableQueryTemplate(fixture(), 'DELETE', 100, options as never)).toThrow(text.invalid);
    const info = fixture(); info.primaryKey = info.editableKey = ['id', '金额']; const output = buildTableQueryTemplate(info, 'DELETE', 100);
    expect(output.parameters).toBe(2); expect(output.sql).toContain('`id` = :key_1\n  AND   `金额` = :key_2\nLIMIT 1;');
  });
  it('options仅接受own columns数组，缺失、额外键、重复或非法成员不能静默删除', () => {
    const invalid: unknown[] = [null, false, 0, 'x', [], {}, { columns: undefined }, { columns: null }, { columns: '金额' }, { columns: ['金额', '金额'] }, { columns: ['不存在'] }, { columns: ['金额', 1] }, { columns: Array(1) }, { columns: ['金额'], other: true }, Object.create({ columns: ['金额'] }), { columns: ['金额'], [Symbol('额外')]: true }, Object.defineProperty({ columns: ['金额'] }, '隐藏', { value: true })];
    for (const options of invalid) expect(() => buildTableQueryTemplate(fixture(), 'SELECT', 100, options as TableQueryTemplateOptions)).toThrow(text.invalid);
    expect(() => buildTableQueryTemplate(fixture(), 'SELECT', 100, { columns: Array.from({ length: 4097 }, () => '金额') })).toThrow(text.budget);
    let reads = 0; const accessor = Object.defineProperty({}, 'columns', { get() { reads++; return ['金额']; } });
    expect(() => buildTableQueryTemplate(fixture(), 'SELECT', 100, accessor as TableQueryTemplateOptions)).toThrow(text.invalid); expect(reads).toBe(0);
  });
  it('自定义数组迭代器、索引getter或额外own键不能在校验中执行或偷偷换列', () => {
    let iteratorCalls = 0, indexReads = 0;
    const iterator = ['金额']; Object.defineProperty(iterator, Symbol.iterator, { value() { iteratorCalls++; throw Error('不得执行自定义迭代器'); } });
    const accessor: string[] = []; Object.defineProperty(accessor, '0', { get() { indexReads++; return '金额'; }, configurable: true });
    const named = ['金额']; Object.defineProperty(named, '隐藏', { value: '内容`列' });
    const symbolic = ['金额']; Object.defineProperty(symbolic, Symbol('额外'), { value: '内容`列' });
    const sparse = Array<string>(1);
    for (const columns of [iterator, accessor, named, symbolic, sparse]) expect(() => buildTableQueryTemplate(fixture(), 'SELECT', 100, { columns })).toThrow(text.invalid);
    expect(iteratorCalls).toBe(0); expect(indexReads).toBe(0);
    const inherited = ['金额']; Object.setPrototypeOf(inherited, { [Symbol.iterator]() { iteratorCalls++; throw Error('不得执行继承迭代器'); } });
    expect(buildTableQueryTemplate(fixture(), 'SELECT', 100, { columns: inherited }).sql).toContain('SELECT\n  `金额`\nFROM'); expect(iteratorCalls).toBe(0);
    expect(buildTableQueryTemplate(fixture(), 'SELECT', 100, { columns: Object.freeze(['金额', '内容`列']) }).sql).toContain('SELECT\n  `金额`,\n  `内容``列`\nFROM');
  });
  it('Unicode、原型同名和反引号名称只作为真实列引用，不读取DDL/default/comment', () => {
    const info = fixture(); info.columns[1].name = '__proto__'; info.columns[2].name = '中文🚢`列'; let reads = 0;
    for (const [object, key] of [[info, 'ddl'], [info.columns[1], 'comment'], [info.columns[1], 'defaultValue']] as const) Object.defineProperty(object, key, { get() { reads++; throw Error('不应读取'); } });
    const selected = Object.freeze(['中文🚢`列', '__proto__']); const options = Object.freeze({ columns: selected });
    const output = buildTableQueryTemplate(info, 'INSERT', 100, options); expect(output.sql).toContain('`中文🚢``列` = :value_1,\n  `__proto__` = :value_2');
    expect(tableQueryTemplateColumns(info, 'INSERT')).toEqual(['__proto__', '中文🚢`列']); expect(reads).toBe(0); expect(options.columns).toEqual(selected);
  });
  it('四种SQL模式下选列顺序与ASCII参数绑定仍单句，完整键不被值参数覆盖', () => {
    const info = fixture(); info.columns[1].name = ':value_99`--列'; info.primaryKey = info.editableKey = ['id', '金额'];
    for (const ansiQuotes of [false, true]) for (const noBackslashEscapes of [false, true]) for (const kind of ['SELECT', 'INSERT', 'UPDATE'] as const) {
      const mode = { ansiQuotes, noBackslashEscapes }, selected = kind === 'UPDATE' ? [info.columns[1].name] : ['金额', info.columns[1].name];
      const output = buildTableQueryTemplate(info, kind, 100, { columns: selected }), tokens = namedParameterTokens(output.sql, mode).map(token => token.name);
      expect(tokens).toEqual(kind === 'SELECT' ? [] : kind === 'INSERT' ? ['value_1', 'value_2'] : ['value_1', 'key_1', 'key_2']); expect(tokens).toHaveLength(output.parameters);
      const bound = bindQueryParameters(output.sql, new Map(tokens.map(name => [name, queryParameterLiteral({ name, type: 'text', value: "';DROP TABLE -- 🚢" })])), mode);
      expect(namedParameterTokens(bound, mode)).toEqual([]); expect(splitSql(bound, noBackslashEscapes, ansiQuotes)).toHaveLength(1);
    }
  });
});
