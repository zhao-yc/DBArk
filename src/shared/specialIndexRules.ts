import type { IndexDefinition, IndexPlanOptions, TrustedIndexColumn } from './tableIndexPatches';

export type SpecialIndexKind = 'fulltext' | 'spatial';
/** 特殊索引不能沿用普通BTREE的字节、方向或外键支持能力。 */
export function isSpecialIndexKind(kind: string): kind is SpecialIndexKind { return kind === 'fulltext' || kind === 'spatial'; }
/** 方法由种类唯一确定，界面切换也不把旧BTREE设置带进特殊索引。 */
export function indexMethodForKind(kind: IndexDefinition['kind']): IndexDefinition['method'] { return kind === 'fulltext' ? 'FULLTEXT' : kind === 'spatial' ? 'RTREE' : 'BTREE'; }

/** 前后端共用规则只读取可信字段投影；权限、完整分区和执行前摘要仍由引擎核对。 */
export function assertSpecialIndexDefinition(definition: Readonly<IndexDefinition>, columns: ReadonlyMap<string, Pick<TrustedIndexColumn, 'generated' | 'hidden' | 'nullable' | 'charset' | 'collation' | 'specialIndexes'>>, capabilities: IndexPlanOptions['capabilities']): void {
  if (!isSpecialIndexKind(definition.kind)) return;
  if (capabilities.specialIndexes?.[definition.kind] !== true) throw new Error('当前服务器的特殊索引能力未知');
  if (definition.method !== indexMethodForKind(definition.kind)) throw new Error('特殊索引种类与方法不一致');
  if (definition.kind === 'spatial' && definition.keyParts.length !== 1) throw new Error('空间索引只允许单个完整空间字段');
  let charset: string | undefined, collation: string | undefined;
  for (const part of definition.keyParts) {
    const column = columns.get(part.columnRef);
    if (!column || column.generated || column.hidden) throw new Error('特殊索引字段不存在或具有生成、隐藏属性');
    if (part.prefixLength !== undefined || part.direction !== 'asc') throw new Error('特殊索引不允许前缀或排序方向，不能自动截短');
    const access = column.specialIndexes?.[definition.kind];
    if (access?.allowed !== true) throw new Error(access?.reasons.join('；') || '字段特殊索引能力未知');
    if (definition.kind === 'fulltext') {
      if (!column.charset || !column.collation) throw new Error('全文索引字段的字符集或排序规则未知');
      if (charset !== undefined && (charset !== column.charset || collation !== column.collation)) throw new Error('同一全文索引的字段必须具有相同字符集和排序规则');
      charset = column.charset; collation = column.collation;
    } else {
      if (column.nullable) throw new Error('空间索引字段必须已是NOT NULL，不能自动修改列');
      if (capabilities.specialIndexes.spatialRequiresSrid && column.specialIndexes?.srid === undefined) throw new Error('MySQL8空间字段必须独立证明显式SRID');
    }
  }
}
