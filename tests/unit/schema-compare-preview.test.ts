import { describe, expect, it } from 'vitest';
import { buildSchemaComparePreview } from '../../src/engine/schemaComparePreview';
import { compareSchemaSnapshots } from '../../src/engine/schemaCompareProjection';
import { validateCommand } from '../../src/shared/validation';
import { comparisonSnapshot as snapshot } from './schema-compare-fixtures';

/** 生成计划必须来自真实原定义，选择只传类别和名称。 */
function preview(source: ReturnType<typeof snapshot>, target: ReturnType<typeof snapshot>, names?: string[]) {
  const report = { ...compareSchemaSnapshots(source, target), snapshotId: 'snapshot', expiresAt: new Date(Date.now() + 120000).toISOString() };
  const selections = report.rows.filter(row => names ? names.includes(row.name) : !['same', 'unknown'].includes(row.status)).map(({ category, name }) => ({ category, name }));
  return buildSchemaComparePreview(source, target, report, selections);
}
describe('结构比较的保守 SQL 审查稿', () => {
  it('目标引用安全、字段先于索引，保留精确默认值和字段顺序', () => {
    const source = snapshot('`id` int, `a` decimal(30,8) DEFAULT 1234567890123456789012.12345678, KEY `a``idx` (`a`)');
    const result = preview(source, snapshot('`id` int', 't`target', 'db`target'));
    expect(result.statements.map(item => item.category)).toEqual(['columns', 'indexes']);
    expect(result.sql).toContain('ALTER TABLE `db``target`.`t``target` ADD COLUMN `a` decimal(30,8) DEFAULT 1234567890123456789012.12345678 AFTER `id`;');
    expect(result.sql).toContain('ADD KEY `a``idx` (`a`)'); expect(result.executable).toBe(false); expect(result.blocked).toEqual([]);
    expect(result.warnings.join('')).toContain('隐式提交');
  });
  it('默认值与注释变化保留原定义，不将 NULL、微秒和字符串重新数值化', () => {
    const result = preview(snapshot("`a` datetime(6) DEFAULT '2026-10-15 12:34:56.123456' COMMENT '原值'"), snapshot('`a` datetime(6) DEFAULT NULL'));
    expect(result.sql).toContain("MODIFY COLUMN `a` datetime(6) DEFAULT '2026-10-15 12:34:56.123456' COMMENT '原值'");
  });
  it('删除字段、类型变化和索引重建明确阻止，不从投影猜测破坏性 SQL', () => {
    const result = preview(snapshot('`id` bigint, KEY `i` (`id`)'), snapshot('`id` int, `extra` int, UNIQUE KEY `i` (`id`)'));
    expect(result.statements).toEqual([]); expect(result.blocked.map(item => item.name)).toEqual(expect.arrayContaining(['id', 'extra', 'i']));
    expect(result.blocked.flatMap(item => item.reasons).join('')).toContain('入向外键');
  });
  it('方向反转不沿用原计划或原目标', () => {
    const a = snapshot('`id` int, `a` int', 'source'), b = snapshot('`id` int', 'target');
    expect(preview(a, b).sql).toContain('`db`.`target` ADD COLUMN');
    const reverse = preview(b, a); expect(reverse.target.table).toBe('source'); expect(reverse.statements).toEqual([]); expect(reverse.blocked[0].name).toBe('a');
  });
  it.each(['方言', '版本', '模式', '字符集', '未知约束'])('%s 不明确时不搬运原始 DDL', kind => {
    const a = snapshot('`id` int, `a` int'), b = snapshot('`id` int');
    if (kind === '方言') b.context.dialect = 'mariadb' as 'mysql';
    if (kind === '版本') b.serverVersion = '8.0.40';
    if (kind === '模式') b.normalizedMode = 'NO_BACKSLASH_ESCAPES';
    if (kind === '字符集') b.tableEncoding.collation = 'utf8mb4_general_ci';
    if (kind === '未知约束') a.source = a.source.replace('`a` int', '`a` int, CHECK (`id` > 0)');
    const result = preview(a, b, ['a']); expect(result.statements).toEqual([]); expect(result.blocked[0].reasons.length).toBeGreaterThan(0);
  });
  it('被阻止的生成字段不能成为后续索引的依赖', () => {
    const result = preview(snapshot('`id` int, `g` int GENERATED ALWAYS AS (`id` + 1) STORED, KEY `ig` (`g`)'), snapshot('`id` int'));
    expect(result.statements).toEqual([]); expect(result.blocked.map(item => item.name)).toContain('ig');
  });
  it('原表尾选项不同或分区定义阻止原片段搬运，自增运行计数差异不影响判断', () => {
    const a = snapshot('`id` int, `a` int'), b = snapshot('`id` int');
    b.source = b.source.replace('ENGINE=InnoDB', 'ENGINE=MyISAM');
    expect(preview(a, b, ['a']).blocked[0].reasons.join('')).toContain('表尾');
    b.source = b.source.replace('ENGINE=MyISAM', 'ENGINE=InnoDB') + ' PARTITION BY HASH (`id`) PARTITIONS 2';
    expect(preview(a, b, ['a']).statements).toEqual([]);
    const c = snapshot('`id` int, `a` int'), d = snapshot('`id` int');
    c.source += ' AUTO_INCREMENT=123'; d.source += ' AUTO_INCREMENT=456';
    expect(preview(c, d).statements).toHaveLength(1);
  });
  it('未知或未支持版本不能凭两侧相同文本生成 SQL', () => {
    for (const version of ['未知', '9.0.1']) {
      const a = snapshot('`id` int, `a` int'), b = snapshot('`id` int'); a.serverVersion = version; b.serverVersion = version;
      expect(preview(a, b).statements).toEqual([]);
    }
  });
  it('外键删除标记破坏性，先删除旧外键再新增字段与键，跨库父表不自动映射', () => {
    const body = '`id` int, KEY `i` (`id`), CONSTRAINT `fk` FOREIGN KEY (`id`) REFERENCES `parent` (`id`)';
    const drop = preview(snapshot('`id` int, KEY `i` (`id`), `a` int'), snapshot(body));
    expect(drop.statements[0]).toMatchObject({ category: 'foreignKeys', destructive: true }); expect(drop.statements[0].sql).toContain('DROP FOREIGN KEY `fk`');
    const blocked = preview(snapshot(body), snapshot('`id` int, KEY `i` (`id`)', 'target', 'another_db'));
    expect(blocked.blocked.find(row => row.name === 'fk')?.reasons.join('')).toContain('不能自动映射');
  });
  it('外键只依赖确认存在的支撑索引，且父表引用显式限定库', () => {
    const a = snapshot('`id` int, KEY `i` (`id`), CONSTRAINT `fk` FOREIGN KEY (`id`) REFERENCES `parent` (`id`)');
    const b = snapshot('`id` int', 'target');
    expect(preview(a, b, ['fk']).statements).toEqual([]);
    const result = preview(a, b); expect(result.statements.map(item => item.category)).toEqual(['indexes', 'foreignKeys']); expect(result.sql).toContain('REFERENCES `db`.`parent` (`id`)');
  });
  it('拒绝渲染侧注入配置、SQL、重复项、任意对象和过大选择', () => {
    const target = { connectionId: 'c', database: 'db', table: 't' };
    expect(() => validateCommand('schema.compare', { taskId: 't', source: { ...target, password: '秘密' }, target })).toThrow();
    expect(() => validateCommand('schema.compare', { taskId: 't', source: target, target, connectionRevision: 3 })).toThrow();
    const item = { category: 'columns', name: 'a' };
    for (const selections of [[item, item], Array.from({ length: 101 }, (_, i) => ({ ...item, name: String(i) })), [{ ...item, sql: 'DROP TABLE t' }]]) expect(() => validateCommand('schema.comparePreview', { snapshotId: 's', selections })).toThrow();
    expect(() => preview(snapshot('`id` int'), snapshot('`id` int'), ['id'])).toThrow('已相同');
  });
});
