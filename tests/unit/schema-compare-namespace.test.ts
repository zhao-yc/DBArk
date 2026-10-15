import { describe, expect, it } from 'vitest';
import { buildSchemaComparePreview } from '../../src/engine/schemaComparePreview';
import { compareSchemaSnapshots } from '../../src/engine/schemaCompareProjection';
import { comparisonSnapshot as snapshot } from './schema-compare-fixtures';
import type { SchemaComparePreviewInput } from '../../src/shared/schemaCompare';

const supported = [
  ['mysql', '5.7.44'], ['mysql', '8.0.45'], ['mysql', '8.4.11'], ['mariadb', '10.11.13-MariaDB'], ['mariadb', '11.4.12-MariaDB'],
] as const;
const columns = '`id` int, KEY `i` (`id`)';
const key = (name: string) => `, CONSTRAINT \`${name}\` FOREIGN KEY (\`id\`) REFERENCES \`parent\` (\`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT`;

/** 两侧真实解析后才生成预览，测试不注入虚构差异或跳过名称投影。 */
function compare(source: ReturnType<typeof snapshot>, target: ReturnType<typeof snapshot>, selections: SchemaComparePreviewInput['selections']) {
  const report = { ...compareSchemaSnapshots(source, target), snapshotId: 's', expiresAt: new Date(Date.now() + 120000).toISOString() };
  return { report, preview: buildSchemaComparePreview(source, target, report, selections) };
}
/** 连接、服务器和表身份分别设置，避免把不同保存连接直接当作不同实例。 */
function targets(dialect: 'mysql' | 'mariadb', version: string, sameServer = true) {
  const source = snapshot(columns + key('source_fk'), 'source'), target = snapshot(columns + key('target_fk'), 'target');
  for (const value of [source, target]) { value.context.dialect = dialect; value.serverVersion = version; value.target.connectionId = 'same-connection'; }
  source.namespace!.serverIdentity = 'source-server'; target.namespace!.serverIdentity = sameServer ? 'source-server' : 'target-server';
  return { source, target };
}
describe('结构比较命名空间与整批预览保护', () => {
  it.each(supported)('%s %s 同连接同库跨表，单选新增及混合删除均阻止原外键名复制', (dialect, version) => {
    const { source, target } = targets(dialect, version);
    for (const selections of [[{ category: 'foreignKeys' as const, name: 'source_fk' }], [{ category: 'foreignKeys' as const, name: 'target_fk' }, { category: 'foreignKeys' as const, name: 'source_fk' }]]) {
      const { report, preview } = compare(source, target, selections);
      expect(report.rows.find(row => row.name === 'source_fk')?.status).toBe('added'); expect(report.rows.find(row => row.name === 'target_fk')?.status).toBe('removed');
      expect(preview.statements).toEqual([]); expect(preview.sql).not.toMatch(/\nALTER TABLE/); expect(preview.blocked).toHaveLength(selections.length);
      expect(preview.blocked.find(row => row.name === 'source_fk')?.reasons.join('')).toContain('库级名称');
    }
  });
  it.each(supported)('%s %s 跨连接同服务器也阻止冲突，不受账号或保存编号影响', (dialect, version) => {
    const { source, target } = targets(dialect, version); target.target.connectionId = 'another-connection'; source.identity = '账号甲'; target.identity = '账号乙';
    const { preview } = compare(source, target, [{ category: 'foreignKeys', name: 'source_fk' }, { category: 'foreignKeys', name: 'target_fk' }]);
    expect(preview.statements).toEqual([]); expect(preview.blocked.find(row => row.name === 'source_fk')?.reasons.join('')).toContain('同一服务器同库');
  });
  it.each(supported)('%s %s 不同服务器不误报源占名，也不假定目标全库名称可用', (dialect, version) => {
    const { source, target } = targets(dialect, version, false); target.target.connectionId = 'other-server-connection';
    const { preview } = compare(source, target, [{ category: 'foreignKeys', name: 'source_fk' }, { category: 'foreignKeys', name: 'target_fk' }]);
    expect(preview.statements).toEqual([]); expect(preview.blocked).toHaveLength(2);
    const reasons = preview.blocked.find(row => row.name === 'source_fk')?.reasons.join('') ?? '';
    expect(reasons).not.toContain('已被同一服务器同库'); expect(reasons).toContain('尚未核验目标库完整外键命名空间');
  });
  it.each([0, 1, 2] as const)('字段和索引的大小写冲突不依赖 lower_case_table_names=%s', identifierCase => {
    for (const [sourceBody, targetBody, category, name] of [
      ['`ID` int, KEY `i` (`ID`)', columns + key('target_fk'), 'columns', 'ID'],
      ['`id` int, KEY `I` (`id`)', columns + key('target_fk'), 'indexes', 'I'],
      ['`Ä` int', '`ä` int', 'columns', 'Ä'],
    ] as const) {
      const source = snapshot(sourceBody, 'source'), target = snapshot(targetBody, 'target'); target.namespace!.identifierCase = identifierCase;
      for (const selections of [[{ category, name }], [{ category, name }, ...(targetBody.includes('target_fk') ? [{ category: 'foreignKeys' as const, name: 'target_fk' }] : [])]]) {
        const { report, preview } = compare(source, target, selections);
        expect(report.rows.find(row => row.category === category && row.name === name)?.status).toBe('added'); expect(report.counts.removed).toBeGreaterThan(0);
        expect(preview.statements).toEqual([]); expect(preview.sql).not.toMatch(/\nALTER TABLE/); expect(preview.blocked).toHaveLength(selections.length); expect(preview.blocked.find(row => row.name === name)?.reasons.join('')).toContain('显式映射或重命名');
      }
    }
  });
  it.each(supported)('%s %s 跨库原引用保持不自动映射，混合删除也不提供部分稿', (dialect, version) => {
    const { source, target } = targets(dialect, version); target.target.database = 'other_db';
    const { preview } = compare(source, target, [{ category: 'foreignKeys', name: 'source_fk' }, { category: 'foreignKeys', name: 'target_fk' }]);
    expect(preview.statements).toEqual([]); expect(preview.blocked.find(row => row.name === 'source_fk')?.reasons.join('')).toContain('跨库外键不能自动映射');
  });
  it('库名大小写使用实际表名规则，字段/索引规则不被误套到库上', () => {
    const { source, target } = targets('mysql', '8.4.11'); source.target.database = 'Db'; target.target.database = 'db';
    const selection = [{ category: 'foreignKeys' as const, name: 'source_fk' }];
    const caseSensitive = compare(source, target, selection).preview;
    expect(caseSensitive.blocked[0].reasons.join('')).not.toContain('已被同一服务器同库');
    target.namespace!.identifierCase = 1;
    expect(compare(source, target, selection).preview.blocked[0].reasons.join('')).toContain('已被同一服务器同库');
  });
  it('外键仅大小写不同仍展示新增/删除，不能把选中删除当作隐式重命名', () => {
    const source = snapshot(columns + key('FK'), 'source'), target = snapshot(columns + key('fk'), 'target');
    const { report, preview } = compare(source, target, [{ category: 'foreignKeys', name: 'FK' }, { category: 'foreignKeys', name: 'fk' }]);
    expect(report.rows.find(row => row.name === 'FK')?.status).toBe('added'); expect(report.rows.find(row => row.name === 'fk')?.status).toBe('removed'); expect(preview.statements).toEqual([]);
  });
  it('无服务器证据的旧快照不假定跨连接安全', () => {
    const { source, target } = targets('mysql', '8.4.11'); delete source.namespace; delete target.namespace; source.identity = '不同账号甲'; target.identity = '不同账号乙'; target.target.connectionId = 'another-connection';
    expect(compare(source, target, [{ category: 'foreignKeys', name: 'source_fk' }]).preview.blocked[0].reasons.join('')).toContain('无法证明');
  });
  it('未选中的冲突不隐藏差异，也不阻止明确选择的独立操作', () => {
    const { source, target } = targets('mysql', '8.4.11');
    const { preview } = compare(source, target, [{ category: 'foreignKeys', name: 'target_fk' }]);
    expect(preview.blocked).toEqual([]); expect(preview.statements[0].sql).toContain('DROP FOREIGN KEY `target_fk`');
    const a = snapshot('`id` int,`safe` int', 'source'), b = snapshot('`id` int,`old` int', 'target');
    expect(compare(a, b, [{ category: 'columns', name: 'safe' }]).preview.statements).toHaveLength(1);
    expect(compare(a, b, [{ category: 'columns', name: 'safe' }, { category: 'columns', name: 'old' }]).preview.statements).toEqual([]);
  });
});
