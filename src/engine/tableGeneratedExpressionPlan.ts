import { generatedColumnAcknowledgement, generatedColumnMessages as text, generatedExpressionAcknowledgement } from '../shared/tableGeneratedColumn';
import { columnOnUpdateVersionSupported, tableColumnDefaultRiskMessage, tableColumnDefaultRisks, type ColumnAttributeAccess, type TableColumnDefinition, type TableColumnDefinitionDocument } from '../shared/tableColumnPatches';
import { editableColumnType, tableDefinitionTokens, type TableDefinitionToken } from './tableColumnDefinition';
import { compileGeneratedColumnExpression, readGeneratedColumnDefinition, type CompiledGeneratedColumnExpression, type GeneratedColumnDefinition } from './tableGeneratedColumn';

/** 同一词法层识别真实名字，字符串和普通注释中的文字不作为列依赖；可执行片段保守拒绝。 */
export function structureTokensMentionColumn(tokens: TableDefinitionToken[], name: string): boolean {
  return tokens.some(token => token.kind === 'executable' || ((token.kind === 'word' || token.kind === 'identifier') && token.value.toLowerCase() === name.toLowerCase()));
}

/** 原通用计划器的表尾门原样共用，不把分区或陌生选项静默当作无依赖。 */
export function structureTailHasUnknownDependencies(document: TableColumnDefinitionDocument): boolean {
  const tokens = tableDefinitionTokens(document.tail.raw, document.context); let cursor = 1;
  const keys = new Set(['ENGINE', 'AUTO_INCREMENT', 'CHARSET', 'COLLATE', 'COMMENT', 'ROW_FORMAT', 'KEY_BLOCK_SIZE', 'STATS_PERSISTENT', 'STATS_AUTO_RECALC', 'STATS_SAMPLE_PAGES', 'PACK_KEYS', 'CHECKSUM', 'DELAY_KEY_WRITE', 'COMPRESSION', 'ENCRYPTION', 'AUTOEXTEND_SIZE']);
  while (cursor < tokens.length) {
    if (tokens[cursor].value === ';' && cursor === tokens.length - 1) return false;
    let key = tokens[cursor].kind === 'word' ? tokens[cursor].value.toUpperCase() : ''; cursor++;
    if (key === 'DEFAULT') { key = tokens[cursor]?.value.toUpperCase() ?? ''; cursor++; }
    if (key === 'CHARACTER' && tokens[cursor]?.value.toUpperCase() === 'SET') { key = 'CHARSET'; cursor++; }
    if (!keys.has(key)) return true;
    if (tokens[cursor]?.value === '=') cursor++;
    if (!tokens[cursor] || !['word', 'number', 'string', 'identifier'].includes(tokens[cursor].kind)) return true; cursor++;
  }
  return false;
}

interface DependencyEvidence { owner?: TableColumnDefinition; kind: string; }
interface DependencyIndex { unknown: boolean; references: Map<string, DependencyEvidence[]>; risks: string[]; }
/** 同一原定义只扫描一次依赖；get逐列能力投影不重复解析整表，索引只在本次纯准备闭包内使用。 */
function dependencyIndex(document: TableColumnDefinitionDocument): DependencyIndex {
  const index: DependencyIndex = { unknown: structureTailHasUnknownDependencies(document), references: new Map(), risks: tableColumnDefaultRisks(document) };
  const names = new Set(document.columns.map(column => column.name.toLowerCase()));
  const record = (tokens: TableDefinitionToken[], evidence: DependencyEvidence): void => {
    const found = new Set<string>();
    for (const token of tokens) {
      if (token.kind === 'executable') index.unknown = true;
      if (token.kind !== 'word' && token.kind !== 'identifier') continue;
      const name = token.value.toLowerCase(); if (!names.has(name) || found.has(name)) continue;
      found.add(name); const references = index.references.get(name) ?? []; references.push(evidence); index.references.set(name, references);
    }
  };
  for (const item of document.items) {
    if (item.kind === 'constraint') record(tableDefinitionTokens(item.raw, document.context), { kind: 'constraint' });
    if (item.kind !== 'column') continue;
    for (const attribute of item.attributes) {
      const relevant = ['generated', 'check', 'opaque'].includes(attribute.kind) || attribute.kind === 'default' && ['expression', 'opaque'].includes(item.default.kind);
      if (attribute.kind === 'opaque') index.unknown = true;
      if (relevant) record(tableDefinitionTokens(attribute.raw, document.context), { owner: item, kind: attribute.kind });
    }
  }
  return index;
}
/** 生成表达式修改不自动重建索引/约束，也不让旁列未知表达式被COPY暗中重算后冒充保真。 */
function assertDependencies(index: DependencyIndex, target: TableColumnDefinition): void {
  if (index.unknown || (index.references.get(target.name.toLowerCase()) ?? []).some(value => value.owner !== target || value.kind !== 'generated')) throw Error(text.dependencies);
}

/** 专用准入只开放真实数值生成列，旧七项access仍保持只读；目录/物理身份另外由任务层证明。 */
function targetDefinition(document: TableColumnDefinitionDocument, columnName: string, serverVersion: string, dependencies = dependencyIndex(document)): { column: TableColumnDefinition; generated: GeneratedColumnDefinition } {
  if (!columnOnUpdateVersionSupported(document.context.dialect, serverVersion)) throw Error(text.editVersion);
  const column = document.columnsByName.get(columnName), generated = readGeneratedColumnDefinition(document, columnName);
  if (!column || !generated || column.nullable !== true || column.default.kind !== 'none' || !column.type.known || column.attributes.some(attribute => !['generated', 'nullable', 'comment'].includes(attribute.kind))) throw Error(text.editTarget);
  const type = editableColumnType(column, document.context);
  if (type?.kind !== 'integer' && type?.kind !== 'decimal') throw Error(text.editTarget);
  if (dependencies.risks.length) throw Error(tableColumnDefaultRiskMessage(dependencies.risks));
  assertDependencies(dependencies, column);
  return { column, generated };
}

/** 可编辑能力只供专属投影；失败不改变其它普通列的既有编辑能力。 */
export function generatedExpressionAccess(document: TableColumnDefinitionDocument, columnName: string, serverVersion: string): ColumnAttributeAccess {
  try { targetDefinition(document, columnName, serverVersion); return { editable: true }; }
  catch (error) { return { editable: false, reason: error instanceof Error ? error.message : text.editTarget }; }
}

/** 获取器按完整原定义准备一次，再为真实目录已证明的各生成列投影能力；不缓存到下一次读取。 */
export function prepareGeneratedExpressionAccess(document: TableColumnDefinitionDocument, serverVersion: string): (columnName: string) => ColumnAttributeAccess {
  const dependencies = dependencyIndex(document);
  return columnName => {
    try { targetDefinition(document, columnName, serverVersion, dependencies); return { editable: true }; }
    catch (error) { return { editable: false, reason: error instanceof Error ? error.message : text.editTarget }; }
  };
}

export interface GeneratedExpressionPlan {
  definition: string; clauses: string[]; before: GeneratedColumnDefinition; after: CompiledGeneratedColumnExpression;
  requiredAcknowledgements: string[]; warnings: string[];
}

/** 只替换SHOW已经证明的AS括号内部源范围；名称、类型、存储方式、注释、NULL及位次均不重建。 */
export function planGeneratedExpressionChange(document: TableColumnDefinitionDocument, columnName: string, expression: string, serverVersion: string): GeneratedExpressionPlan {
  const { column, generated } = targetDefinition(document, columnName, serverVersion);
  const compiled = compileGeneratedColumnExpression(document, expression, column.ordinal);
  if (compiled.fingerprint === generated.fingerprint) throw Error(text.unchanged);
  const attribute = column.attributes.find(item => item.kind === 'generated')!, tokens = tableDefinitionTokens(attribute.raw, document.context);
  const open = tokens.find(token => token.kind === 'symbol' && token.value === '('), close = tokens.at(-2);
  if (!open || close?.kind !== 'symbol' || close.value !== ')') throw Error(text.editTarget);
  const start = attribute.range.start + open.end, end = attribute.range.start + close.start;
  if (start < column.range.start || end > column.range.end || end < start || document.source.slice(start, end) !== generated.expression || column.raw !== document.source.slice(column.range.start, column.range.end)) throw Error(text.editTarget);
  const definition = column.raw.slice(0, start - column.range.start) + compiled.sql + column.raw.slice(end - column.range.start);
  // MySQL三版语法中ALGORITHM及WITH VALIDATION都是逗号分隔的ALTER modifier，不是列定义后缀。
  const clauses = ['MODIFY COLUMN ' + definition, 'ALGORITHM=COPY'];
  if (document.context.dialect === 'mysql' && generated.storage === 'VIRTUAL') clauses.push('WITH VALIDATION');
  return { definition, clauses, before: generated, after: compiled, requiredAcknowledgements: [generatedColumnAcknowledgement, generatedExpressionAcknowledgement], warnings: [text.recalculation] };
}
