import type { SchemaCompareDifference, SchemaComparePreview, SchemaComparePreviewInput, SchemaCompareResult } from '../shared/schemaCompare';
import { assertTableStructureExportable, columnRestateAccess } from '../shared/tableColumnPatches';
import { tableDefinitionTokens } from './tableColumnDefinition';
import { structureDocumentOf } from './structureDefinition';
import { readTableIndexDefinition } from './tableIndexDefinition';
import { readTableForeignKeyDefinition } from './tableForeignKeyDefinition';
import { identifier, qualified } from './sql';
import type { SchemaComparisonSnapshot } from './schemaCompare';

/** 根据可信原始快照生成审查稿；不提供执行令牌，不绕过依赖与不支持项。 */
export function buildSchemaComparePreview(source: SchemaComparisonSnapshot, target: SchemaComparisonSnapshot, report: SchemaCompareResult, selections: SchemaComparePreviewInput['selections']): SchemaComparePreview {
  const sourceDoc = structureDocumentOf(source), targetDoc = structureDocumentOf(target);
  const sourceIndexes = readTableIndexDefinition(sourceDoc), targetIndexes = readTableIndexDefinition(targetDoc);
  const sourceKeys = readTableForeignKeyDefinition(sourceDoc, source.target.database, source.serverVersion);
  const addedIndexes = new Set<string>();
  const statements: SchemaComparePreview['statements'] = [], blocked: SchemaComparePreview['blocked'] = [];
  const table = qualified(target.target.database, target.target.table);
  const global: string[] = [];
  /** 表尾未做语义同步；除运行中的自增计数外必须完全一致，否则不搬运字段或约束。 */
  const tail = (snapshot: SchemaComparisonSnapshot, raw: string) => {
    const tokens = tableDefinitionTokens(raw, snapshot.context), values: string[][] = [];
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].kind === 'word' && tokens[i].value.toUpperCase() === 'AUTO_INCREMENT' && tokens[i + 1]?.value === '=' && /^\d+$/.test(tokens[i + 2]?.value ?? '')) { i += 2; continue; }
      if (tokens[i].kind === 'executable' || tokens[i].kind === 'word' && ['PARTITION', 'VERSIONING'].includes(tokens[i].value.toUpperCase())) global.push('分区、版本表或可执行表选项需要专门核验，本轮不生成 SQL');
      values.push([tokens[i].kind, tokens[i].value]);
    }
    return JSON.stringify(values);
  };
  if (tail(source, sourceDoc.tail.raw) !== tail(target, targetDoc.tail.raw)) global.push('表尾原始选项不同，不能从未覆盖属性推断可安全同步');
  try { assertTableStructureExportable(targetDoc, target.normalizedMode); } catch { global.push('目标含不能保真重述的默认值或 SQL 模式，本轮不生成 ALTER'); }
  const sourceVersion = source.serverVersion.match(/^\d+\.\d+(?=\.)/)?.[0], targetVersion = target.serverVersion.match(/^\d+\.\d+(?=\.)/)?.[0];
  const supportedVersions = source.context.dialect === 'mysql' ? ['5.7', '8.0', '8.4'] : ['10.11', '11.4'];
  if (!sourceVersion || !targetVersion || !supportedVersions.includes(sourceVersion) || source.context.dialect !== target.context.dialect || sourceVersion !== targetVersion) global.push('跨方言或跨主次版本仅展示差异，不搬运原始 DDL');
  if (source.normalizedMode !== target.normalizedMode || JSON.stringify(source.context.mode) !== JSON.stringify(target.context.mode)) global.push('两侧 SQL 模式不同，原片段的字面量语义不能直接搬运');
  if (JSON.stringify(source.tableEncoding) !== JSON.stringify(target.tableEncoding)) global.push('表默认字符集或排序规则不同，不能依赖隐含字符集重述字段');
  if (report.counts.unknown > 0) global.push('快照存在不可可靠比较项，不能证明依赖完整');
  const selected = selections.map(selection => {
    const row = report.rows.find(item => item.category === selection.category && item.name === selection.name);
    if (!row || row.status === 'same') throw new Error('所选差异不存在或已相同，请重新比较');
    return row;
  });
  const selectedColumns = new Set(selected.filter(row => row.category === 'columns' && row.status === 'added').map(row => row.name));
  const availableColumns = new Set([...targetDoc.columns.map(column => column.name), ...selectedColumns]);
  /** 顺序固定为删除旧外键、字段、索引、增加外键，避免依赖未就绪。 */
  const rank = (row: SchemaCompareDifference) => row.category === 'foreignKeys' && row.status === 'removed' ? 0 : row.category === 'columns' ? 1 : row.category === 'indexes' ? 2 : 3;
  selected.sort((a, b) => rank(a) - rank(b) || (a.source?.ordinal ?? 0) - (b.source?.ordinal ?? 0));
  for (const row of selected) {
    const reasons = [...global, ...row.reasons];
    let clause: string | undefined, destructive = false;
    if (row.category === 'columns') {
      const column = sourceDoc.columnsByName.get(row.name);
      if (row.status === 'removed') reasons.push('删除字段需要完整入向外键、生成表达式及数据损失核验，本轮不生成');
      else if (column) {
        const access = columnRestateAccess(column, target.context.dialect);
        if (!access.editable) reasons.push(access.reason ?? '字段不能可靠重述');
        if (column.attributes.some(attribute => !['nullable', 'default', 'comment', 'charset', 'collation'].includes(attribute.kind))) reasons.push('自增、生成、更新表达式或其它属性需要额外依赖核验');
        if (row.status === 'changed' && row.changedProperties.some(property => !['default', 'comment'].includes(property))) reasons.push('类型、可空性、顺序及其它字段变化需要完整依赖和数据核验，本轮不生成');
        if (row.status === 'added') {
          const previous = sourceDoc.columns[column.ordinal - 1];
          if (previous && !availableColumns.has(previous.name)) reasons.push('源字段的前置字段未存在于目标或本次选择中');
          clause = `ADD COLUMN ${column.raw.trim()}${previous ? ` AFTER ${identifier(previous.name)}` : ' FIRST'}`;
        } else clause = `MODIFY COLUMN ${column.raw.trim()}`;
      }
    } else if (row.category === 'indexes') {
      if (row.status !== 'added') reasons.push('删除或重建索引需要完整入向外键与自增依赖核验，本轮不生成');
      else {
        const index = sourceIndexes.indexes.find(item => item.name === row.name);
        if (!index || index.opaqueReasons.length || !['ordinary', 'unique', 'primary'].includes(index.kind) || index.parts.some(part => !part.columnName || !availableColumns.has(part.columnName))) reasons.push('索引属性或字段依赖不完整');
        else {
          if (index.kind === 'primary' && targetIndexes.indexes.some(item => item.kind === 'primary')) reasons.push('目标已存在主键，不能隐式重建');
          clause = `ADD ${index.rawSql.trim()}`;
        }
      }
    } else if (row.category === 'foreignKeys') {
      if (row.status === 'removed') { clause = `DROP FOREIGN KEY ${identifier(row.name)}`; destructive = true; }
      else if (row.status === 'changed') reasons.push('外键变化需要删除并重建及父表核验，本轮仅展示原定义');
      else {
        const key = sourceKeys.foreignKeys.find(item => item.name === row.name);
        if (!key?.parentTarget || !key.onDelete || !key.onUpdate || key.opaqueReasons.length || key.childColumnNames.some(name => !availableColumns.has(name))) reasons.push('外键定义或字段依赖不完整');
        else if (source.target.database !== target.target.database) reasons.push('跨库外键不能自动映射父库或父表，请单独核对引用');
        else {
          const supported = [...targetIndexes.indexes, ...sourceIndexes.indexes.filter(index => addedIndexes.has(index.name))].some(index => key.childColumnNames.every((name, i) => index.parts[i]?.columnName === name && !index.parts[i]?.prefixLength));
          if (!supported) reasons.push('外键缺少明确的完整前导支撑索引，不依赖服务器隐式建索引');
          clause = `ADD CONSTRAINT ${identifier(key.name!)} FOREIGN KEY (${key.childColumnNames.map(identifier).join(', ')}) REFERENCES ${qualified(key.parentTarget.database, key.parentTarget.table)} (${key.parentColumnNames.map(identifier).join(', ')}) ON DELETE ${key.onDelete} ON UPDATE ${key.onUpdate}`;
        }
      }
    } else reasons.push('未分类约束不生成 SQL');
    if (!clause && reasons.length === 0) reasons.push('该差异暂不支持 SQL 生成');
    if (reasons.length) {
      blocked.push({ category: row.category, name: row.name, reasons: [...new Set(reasons)] });
      // 不能依赖刚才被阻止的新增字段继续生成后续索引或外键。
      if (row.category === 'columns' && row.status === 'added') availableColumns.delete(row.name);
    } else {
      statements.push({ category: row.category, name: row.name, sql: `ALTER TABLE ${table} ${clause};`, destructive });
      if (row.category === 'indexes') addedIndexes.add(row.name);
    }
  }
  const warnings = ['这是基于短期快照的审查稿，未执行同步；执行前必须重新读取目标及关联父表并核对权限、数据和完整依赖。', 'ALTER TABLE 会隐式提交，可能锁表或重建表；多条语句不构成可回滚事务。', '未验证入向外键、父表键、已有数据的唯一性或兼容性；表选项、分区、触发器与 CHECK 未同步。', `原片段要求目标会话 SQL 模式为 ${JSON.stringify(target.normalizedMode)}；不能在其它模式直接执行。`];
  if (blocked.length) warnings.push('部分选择未生成 SQL；以下语句仅是可确认子集，不代表完成同步计划。');
  if (statements.some(item => item.destructive)) warnings.push('本审查稿包含删除外键，会移除目标的引用完整性约束；必须人工复核。');
  return { target: { ...target.target }, direction: 'source-to-target', expiresAt: report.expiresAt, executable: false, statements, blocked, warnings, sql: ['-- DBArk 结构比较 SQL 审查稿；尚未同步', `-- 源：${JSON.stringify(source.target)} → 目标：${JSON.stringify(target.target)}`, `-- 快照有效期至 ${report.expiresAt}，过期后必须重新比较。`, ...warnings.map(value => `-- ${value}`), ...statements.map(item => item.sql)].join('\n') };
}
