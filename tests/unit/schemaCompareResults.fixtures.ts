import type { SchemaCompareResult } from '../../src/shared/schemaCompare';

/** 合成报告保留真实契约，包含 NULL 字面值、特殊标识符和无法可靠比较的原定义。 */
export function schemaCompareResultsFixture(snapshotId = '快照甲'): SchemaCompareResult {
  return {
    snapshotId, expiresAt: '2026-10-17T10:02:00Z', direction: 'source-to-target', mode: 'read-only-definition',
    source: { connectionId: 'a', database: 'db', table: 'source' }, target: { connectionId: 'b', database: 'db', table: 'target' },
    sourceVersion: '8.4.11', targetVersion: '8.4.11', comparable: false, ignored: ['表选项尚未比较'], ignoredFragments: [],
    counts: { added: 1, removed: 1, changed: 2, same: 1, unknown: 1 },
    rows: [
      { category: 'columns', name: 'NULL', status: 'changed', changedProperties: ['default'], reasons: [], source: { rawSql: '`NULL` int DEFAULT NULL' }, target: { rawSql: "`NULL` varchar(4) DEFAULT 'NULL'" } },
      { category: 'indexes', name: 'ix.Mixed', status: 'added', changedProperties: ['definition'], reasons: [], source: { rawSql: 'KEY `ix.Mixed` (`NULL`)' } },
      { category: 'foreignKeys', name: 'fk', status: 'removed', changedProperties: [], reasons: [], target: { rawSql: 'CONSTRAINT `fk` FOREIGN KEY (`id`) REFERENCES `p` (`id`)' } },
      { category: 'columns', name: 'same', status: 'same', changedProperties: [], reasons: [], source: { rawSql: '`same` int' }, target: { rawSql: '`same` int' } },
      { category: 'columns', name: ' x.*"`<img> ', status: 'changed', changedProperties: ['comment', 'unknownProperty'], reasons: [], source: { rawSql: '<script>alert("仅文本")</script>' }, target: { rawSql: '`x` int' } },
      { category: 'unclassified', name: '未知约束', status: 'unknown', changedProperties: [], reasons: ['无法识别的约束：<img src=x>'], source: { rawSql: 'CONSTRAINT CHECK (x IS NULL)' } },
    ],
  };
}
