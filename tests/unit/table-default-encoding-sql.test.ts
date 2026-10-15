import { describe, expect, it } from 'vitest';
import { validateCommand } from '../../src/shared/validation';
import { planTableDefaultEncoding, readTableDefaultEncodingDefinition, onlyAddedColumnEncodingAttributes, tableDefaultEncodingColumnReasons } from '../../src/engine/tableDefaultEncodingSql';
import type { StructureDefinitionRead } from '../../src/engine/structureDefinition';

const context = { dialect: 'mysql' as const, mode: { noBackslashEscapes: false, ansiQuotes: false } };
const old = { charset: 'utf8mb4', collation: 'utf8mb4_bin' }, next = { charset: 'latin1', collation: 'latin1_swedish_ci' }, candidates = [old, next, { charset: 'utf8mb4', collation: 'utf8mb4_general_ci' }];
const source = "CREATE TABLE `t` (`id` bigint NOT NULL AUTO_INCREMENT,`s` varchar(80) DEFAULT NULL COMMENT 'COLLATE=伪属性',`g` int GENERATED ALWAYS AS (length(`s`)) STORED,PRIMARY KEY (`id`),KEY `pref` (`s`(8)),CONSTRAINT `ck` CHECK (`s` COLLATE utf8mb4_bin <> 'x')) ENGINE=InnoDB AUTO_INCREMENT=9007199254740993 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC COMMENT='原说明'";
function read(value: string): StructureDefinitionRead { return { source: value, context, identity: 'server', serverVersion: '8.4.11', originalMode: '', normalizedMode: '', tableEncoding: old, nullability: [], encodings: [{ name: 'id', charset: null, collation: null }, { name: 's', ...old }, { name: 'g', charset: null, collation: null }] }; }
describe('表默认编码最小SQL与窄范围语义核验', () => {
  it('只生成一条显式配对DEFAULT语句，无CONVERT或任何列/索引重述', () => {
    expect(planTableDefaultEncoding('db', 't', old, next, candidates).sql).toBe('ALTER TABLE `db`.`t` DEFAULT CHARACTER SET = latin1 COLLATE = latin1_swedish_ci;');
    expect(() => planTableDefaultEncoding('db', 't', old, old, candidates)).toThrow('没有实际');
  });
  it('候选精确归属且不猜别名/大小写，注入和不匹配在生成SQL前拒绝', () => {
    for (const pair of [{ charset: 'latin1', collation: 'utf8mb4_bin' }, { charset: 'LATIN1', collation: 'latin1_swedish_ci' }, { charset: 'latin1;DROP TABLE t', collation: 'latin1_swedish_ci' }, { charset: 'utf8', collation: 'utf8mb4_bin' }]) expect(() => planTableDefaultEncoding('db', 't', old, pair, candidates)).toThrow();
  });
  it('允许服务器显式补出原列编码，保留普通复杂定义与其余表属性', () => {
    const after = source.replace('varchar(80) DEFAULT', 'varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT').replace('DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin', 'DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci');
    const before = readTableDefaultEncodingDefinition(source, context), actual = readTableDefaultEncodingDefinition(after, context);
    expect(actual.reasons).toEqual([]); expect(actual).toMatchObject(next); expect(actual.preserved).toBe(before.preserved);
  });
  it('现有列有效编码另行核验，不能用摘要相同代替目录对比', () => {
    const changedColumn = source.replace('varchar(80) DEFAULT', 'varchar(80) CHARACTER SET latin1 COLLATE latin1_bin DEFAULT');
    expect(readTableDefaultEncodingDefinition(changedColumn, context).preserved).toBe(readTableDefaultEncodingDefinition(source, context).preserved);
    // 同摘要只表示剩余定义相同；真实Engine用例另证目录编码变化必须返回未完整核验。
  });
  it('只允许增加符合原有效值的显式属性，删除/改写旧属性或新增错误属性均拒绝', () => {
    const explicit = source.replace('varchar(80) DEFAULT', 'varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT');
    expect(onlyAddedColumnEncodingAttributes(read(source), read(explicit))).toBe(true);
    expect(onlyAddedColumnEncodingAttributes(read(explicit), read(source))).toBe(false);
    expect(onlyAddedColumnEncodingAttributes(read(explicit), read(explicit.replace('COLLATE utf8mb4_bin DEFAULT', 'COLLATE utf8mb4_general_ci DEFAULT')))).toBe(false);
    const wrong = source.replace('varchar(80) DEFAULT', 'varchar(80) CHARACTER SET latin1 COLLATE latin1_bin DEFAULT');
    expect(onlyAddedColumnEncodingAttributes(read(source), read(wrong))).toBe(false); expect(tableDefaultEncodingColumnReasons(read(wrong)).join('')).toContain('目录不一致');
  });
  it('未知后缀/类型与可执行编码片段保持只读，已识别生成表达式仍可保持', () => {
    expect(tableDefaultEncodingColumnReasons(read(source))).toEqual([]);
    for (const value of [source.replace('varchar(80) DEFAULT', 'strange(80) DEFAULT'), source.replace('varchar(80) DEFAULT', 'varchar(80) MYSTERY a DEFAULT'), source.replace('varchar(80) DEFAULT', 'varchar(80) /*!80000 CHARACTER SET latin1 */ DEFAULT')]) expect(tableDefaultEncodingColumnReasons(read(value)).length).toBeGreaterThan(0);
  });
  it('非受控默认表达式在编码变更前只读，不能只凭原文相同承诺求值保真', () => {
    const expression = source.replace('DEFAULT NULL', 'DEFAULT (1+1)'); expect(tableDefaultEncodingColumnReasons(read(expression)).join('')).toContain('默认表达式');
    const timestamp = source.replace('varchar(80) DEFAULT NULL', 'timestamp DEFAULT CURRENT_TIMESTAMP'); const state = read(timestamp); state.encodings[1] = { name: 's', charset: null, collation: null }; expect(tableDefaultEncodingColumnReasons(state)).toEqual([]);
  });
  it('不掩盖生成表达式、默认表达式、约束COLLATE、索引、表注释或精确计数变化', () => {
    const before = readTableDefaultEncodingDefinition(source, context).preserved;
    for (const changed of [source.replace('length(`s`)', 'length(`s`)+1'), source.replace("<> 'x'", "<> 'X'"), source.replace('`s` COLLATE utf8mb4_bin', '`s` COLLATE utf8mb4_general_ci'), source.replace('(`s`(8))', '(`s`(9))'), source.replace('原说明', '另一说明'), source.replace('9007199254740993', '9007199254740994'), source.replace('DYNAMIC', 'COMPACT')]) expect(readTableDefaultEncodingDefinition(changed, context).preserved).not.toBe(before);
    const special = source.replace('DEFAULT NULL COMMENT', "DEFAULT _utf8mb4'x' COLLATE utf8mb4_bin COMMENT");
    expect(readTableDefaultEncodingDefinition(special.replace("_utf8mb4'x' COLLATE utf8mb4_bin", "_utf8mb4'x' COLLATE utf8mb4_general_ci"), context).preserved).not.toBe(readTableDefaultEncodingDefinition(special, context).preserved);
  });
  it('重复、分区和可执行表选项不通过默认编码属性掩码', () => {
    for (const tail of [' DEFAULT CHARSET=latin1', ' PARTITION BY HASH(id) PARTITIONS 2', ' /*!50100 DEFAULT CHARSET=latin1 */']) expect(readTableDefaultEncodingDefinition(source + tail, context).reasons.length).toBeGreaterThan(0);
  });
  it('公开契约拒绝任意SQL、目标覆盖、客户端修订、单边选择和未知确认项', () => {
    expect(validateCommand('schema.tableDefaultEncoding.preview', { snapshotId: 's', ...next, taskId: 't' })).toMatchObject(next);
    for (const extra of [{ sql: 'CONVERT TO utf8mb4' }, { table: 'other' }, { connectionRevision: 99 }, { convertExistingColumns: true }]) expect(() => validateCommand('schema.tableDefaultEncoding.preview', { snapshotId: 's', ...next, taskId: 't', ...extra })).toThrow();
    expect(() => validateCommand('schema.tableDefaultEncoding.preview', { snapshotId: 's', charset: 'latin1', taskId: 't' })).toThrow();
    expect(() => validateCommand('schema.tableDefaultEncoding.apply', { previewToken: 'p', taskId: 't', acknowledgements: ['constructor'] })).toThrow();
  });
});
