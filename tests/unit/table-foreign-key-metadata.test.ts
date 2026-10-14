import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import manifest from '../fixtures/table-foreign-key-patches/manifest.json';
import { parseTableColumnDefinition } from '../../src/engine/tableColumnDefinition';
import { readTableForeignKeyDefinition } from '../../src/engine/tableForeignKeyDefinition';
import { crossCheckForeignKeyCatalog } from '../../src/engine/tableForeignKeyMetadata';

type Row = Record<string, unknown>;
/** 夹具不保留真实库名；在白名单元数据上下文内装配与生产 SELECT 一致的限定身份字段。 */
function sample(fixture = manifest.entries.find(entry => entry.id === 'mysql-8.4.11-actions-default-after-child')!) {
  const directory = 'tests/fixtures/table-foreign-key-patches';
  const catalog = JSON.parse(readFileSync(resolve(directory, fixture.metadataFile), 'utf8')) as { table: { schema: string; name: string }; kcu: Row[]; rc: Row[] };
  const target = { database: catalog.table.schema, table: catalog.table.name };
  const definition = parseTableColumnDefinition(readFileSync(resolve(directory, fixture.file), 'utf8'), { dialect: fixture.dialect as 'mysql' | 'mariadb', mode: { ansiQuotes: fixture.session.sqlMode.split(',').includes('ANSI_QUOTES'), noBackslashEscapes: fixture.session.sqlMode.split(',').includes('NO_BACKSLASH_ESCAPES') } });
  const source = readTableForeignKeyDefinition(definition, target.database, fixture.version);
  const kcuRows = catalog.kcu.filter(row => row.REFERENCED_TABLE_NAME !== null).map(row => ({ ...row, CONSTRAINT_SCHEMA: target.database, TABLE_SCHEMA: target.database, TABLE_NAME: target.table } as Row));
  const rcRows = catalog.rc.map(row => ({ ...row, CONSTRAINT_SCHEMA: target.database, UNIQUE_CONSTRAINT_SCHEMA: kcuRows.find(part => part.CONSTRAINT_NAME === row.CONSTRAINT_NAME)?.REFERENCED_TABLE_SCHEMA } as Row));
  return { source, target, kcuRows, rcRows };
}
type Sample = ReturnType<typeof sample>;

describe('外键源定义与真实逻辑目录交叉证明', () => {
  it.each(manifest.entries)('五版本实际结构保持动作和有序映射：$id', fixture => {
    const input = sample(fixture), actual = crossCheckForeignKeyCatalog(input.source, input.target, input.rcRows, input.kcuRows);
    expect(actual).toHaveLength(input.source.foreignKeys.length);
    for (const key of actual) {
      expect(key.parsed.name).toBe(key.name); expect(key.childColumnNames).toEqual(key.parsed.childColumnNames);
      expect(key.parentColumnNames).toEqual(key.parsed.parentColumnNames); expect(key.parentTarget).toEqual(key.parsed.parentTarget);
      expect([key.onUpdate, key.onDelete]).toEqual([key.parsed.onUpdate, key.parsed.onDelete]);
    }
  });
  const invalid: [string, (input: Sample) => void][] = [
    ['空规则不是无外键', input => { input.rcRows = []; }],
    ['空字段不是无外键', input => { input.kcuRows = []; }],
    ['规则重复', input => { input.rcRows.push({ ...input.rcRows[0] }); }],
    ['字段额外约束', input => { input.kcuRows.push({ ...input.kcuRows[0], CONSTRAINT_NAME: 'other' }); }],
    ['跨子库规则', input => { input.rcRows[0].CONSTRAINT_SCHEMA = 'other'; }],
    ['跨子表规则', input => { input.rcRows[0].TABLE_NAME = 'other'; }],
    ['跨子库字段', input => { input.kcuRows[0].TABLE_SCHEMA = 'other'; }],
    ['跨子表字段', input => { input.kcuRows[0].TABLE_NAME = 'other'; }],
    ['跨父库规则', input => { input.rcRows[0].UNIQUE_CONSTRAINT_SCHEMA = 'other'; }],
    ['跨父表规则', input => { input.rcRows[0].REFERENCED_TABLE_NAME = 'other'; }],
    ['跨父库字段', input => { input.kcuRows[0].REFERENCED_TABLE_SCHEMA = 'other'; }],
    ['父字段倒序', input => { input.kcuRows[0].REFERENCED_COLUMN_NAME = input.kcuRows[1].REFERENCED_COLUMN_NAME; }],
    ['子字段倒序', input => { input.kcuRows[0].COLUMN_NAME = input.kcuRows[1].COLUMN_NAME; }],
    ['重复序号', input => { input.kcuRows[1].ORDINAL_POSITION = 1; }],
    ['非法序号字符串', input => { input.kcuRows[0].ORDINAL_POSITION = '01'; }],
    ['序号溢出', input => { input.kcuRows[0].ORDINAL_POSITION = '9007199254740993'; }],
    ['未知支持键位置', input => { input.kcuRows[0].POSITION_IN_UNIQUE_CONSTRAINT = null; }],
    ['父键位置矛盾', input => { input.kcuRows[0].POSITION_IN_UNIQUE_CONSTRAINT = 2; }],
    ['默认动作不能等价合并', input => { input.rcRows[0].UPDATE_RULE = 'RESTRICT'; }],
    ['未知MATCH', input => { input.rcRows[0].MATCH_OPTION = 'PARTIAL'; }],
    ['缺失动作', input => { delete input.rcRows[0].DELETE_RULE; }],
    ['缺失父键名', input => { input.rcRows[0].UNIQUE_CONSTRAINT_NAME = null; }],
    ['源证明不完整', input => { input.source.complete = false; }],
    ['超过约束预算', input => { input.rcRows = Array.from({ length: 257 }, () => input.rcRows[0]); }],
    ['超过字段预算', input => { input.kcuRows = Array.from({ length: 8193 }, () => input.kcuRows[0]); }],
  ];
  it.each(invalid)('矛盾或未知目录不能形成可执行证明：%s', (_label, modify) => {
    const input = sample(); modify(input);
    expect(() => crossCheckForeignKeyCatalog(input.source, input.target, input.rcRows, input.kcuRows)).toThrow();
  });
  it('实际目录行展示顺序无关，十进制字符串序号保持精度语义', () => {
    const input = sample();
    for (const row of input.kcuRows) { row.ORDINAL_POSITION = String(row.ORDINAL_POSITION); row.POSITION_IN_UNIQUE_CONSTRAINT = String(row.POSITION_IN_UNIQUE_CONSTRAINT); }
    input.kcuRows.reverse(); const value = crossCheckForeignKeyCatalog(input.source, input.target, input.rcRows, input.kcuRows);
    expect(value[0].childColumnNames).toEqual(['ca', 'cb']); expect(value[0].parentColumnNames).toEqual(['pa', 'pb']);
  });
});
