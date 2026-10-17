import type { TableCreateDraft, TableCreatePrefixFacts } from '../shared/tableCreate';
import type { TableColumnDefinitionDocument } from '../shared/tableColumnPatches';
import type { TableCreateIndexPlan } from './tableCreateIndexPlan';
import { structureTaskQuery, type StructureTaskContext } from './structureDefinition';
import { tableDefinitionTokens } from './tableColumnDefinition';
import { readTableIndexDefinition } from './tableIndexDefinition';
import { deriveTrustedIndexColumn, crossCheckIndexStatistics, type IndexColumnMetadata } from './tableIndexMetadata';
import { tableCreateMetadataInteger } from './tableCreateIndexFacts';
import { qualified } from './sql';
const blobCapacities = new Map<string, number>([['TINYBLOB', 255], ['BLOB', 65535], ['MEDIUMBLOB', 16777215], ['LONGBLOB', 4294967295]]);
const literal = (value: string) => `CONVERT(X'${Buffer.from(value, 'utf8').toString('hex')}' USING utf8mb4)`;
/** MySQL前缀新表独立核完整表选项；不扩Maria NULL字符集补证的白名单。 */
function readOptions(document: TableColumnDefinitionDocument, design: TableCreateDraft): Map<string, string> | undefined {
  const tokens = tableDefinitionTokens(document.tail.raw, document.context), values = new Map<string, string>(); let cursor = 1;
  if (tokens[0]?.value !== ')') return undefined;
  while (cursor < tokens.length) {
    if (tokens[cursor].value === ';' && cursor === tokens.length - 1) break;
    let token = tokens[cursor++], defaulted = false;
    if (token?.kind === 'word' && token.value.toUpperCase() === 'DEFAULT') { defaulted = true; token = tokens[cursor++]; }
    if (token?.kind !== 'word') return undefined;
    let key = token.value.toUpperCase();
    if (key === 'CHARACTER') { if (tokens[cursor++]?.value.toUpperCase() !== 'SET') return undefined; key = 'CHARSET'; }
    if (!['ENGINE', 'CHARSET', 'COLLATE', 'ROW_FORMAT', 'COMMENT'].includes(key) || values.has(key) || defaulted && !['CHARSET', 'COLLATE'].includes(key)) return undefined;
    if (tokens[cursor]?.value === '=') cursor++;
    const value = tokens[cursor++]; if (!value || (key === 'COMMENT' ? value.kind !== 'string' : !['word', 'identifier'].includes(value.kind))) return undefined;
    values.set(key, value.value);
  }
  if (values.get('ENGINE')?.toUpperCase() !== 'INNODB' || values.get('CHARSET') !== design.charset || values.get('ROW_FORMAT')?.toUpperCase() !== 'DYNAMIC' || (values.get('COMMENT') ?? '') !== design.comment || design.collation !== undefined && values.has('COLLATE') && values.get('COLLATE') !== design.collation) return undefined;
  return values;
}
/** CREATE后的实际目录才可进入真实列适配器；完整SHOW和STATISTICS逐键独立复核。 */
export async function verifyCreatedPrefixIndexes(context: StructureTaskContext, target: { database: string; table: string }, design: TableCreateDraft, plan: TableCreateIndexPlan, facts: TableCreatePrefixFacts, document: TableColumnDefinitionDocument): Promise<boolean> {
  const options = readOptions(document, design);
  if (context.managed.status.dialect !== 'mysql' || plan.factsDigest !== facts.digest || !options) return false;
  const parsed = readTableIndexDefinition(document);
  if (parsed.otherConstraintRanges.length || parsed.indexes.length !== plan.indexes.length) return false;
  for (const expected of plan.indexes) {
    const actual = parsed.indexes.find(index => index.name === expected.name);
    if (!actual || actual.kind !== (expected.name === 'PRIMARY' ? 'primary' : expected.unique ? 'unique' : 'ordinary') || actual.method !== 'BTREE' || actual.comment !== '' || actual.opaqueReasons.length || actual.attributes.some(attribute => attribute.kind !== 'method') || actual.parts.length !== expected.keyParts.length || actual.parts.some((part, index) => part.columnName !== expected.keyParts[index].columnName || part.prefixLength !== expected.keyParts[index].prefixLength || part.direction !== 'asc' || part.expressionSql !== undefined || part.opaqueReasons.length)) return false;
  }
  const condition = `TABLE_SCHEMA=${literal(target.database)} AND TABLE_NAME=${literal(target.table)}`;
  const tables = (await structureTaskQuery<{ name: string; engine: string; rowFormat: string; collation: string }[]>(context, `SELECT TABLE_NAME AS name,ENGINE AS engine,ROW_FORMAT AS rowFormat,TABLE_COLLATION AS collation FROM information_schema.TABLES WHERE ${condition} LIMIT 2`)).rows;
  if (tables.length !== 1 || tables[0].name !== target.table || tables[0].engine?.toUpperCase() !== 'INNODB' || tables[0].rowFormat?.toUpperCase() !== 'DYNAMIC' || typeof tables[0].collation !== 'string' || !tables[0].collation || design.collation !== undefined && tables[0].collation !== design.collation) return false;
  if (options.has('COLLATE')) {
    if (options.get('COLLATE') !== tables[0].collation) return false;
  } else {
    // SHOW可省略字符集默认COLLATE；只由同一实际目录的准确默认值补证，不推断名称或普遍忽略。
    // https://dev.mysql.com/doc/refman/8.4/en/information-schema-character-sets-table.html
    const defaults = (await structureTaskQuery<{ name: string; collation: string; maxBytes: unknown }[]>(context, `SELECT CHARACTER_SET_NAME AS name,DEFAULT_COLLATE_NAME AS collation,MAXLEN AS maxBytes FROM information_schema.CHARACTER_SETS WHERE CHARACTER_SET_NAME=${literal(design.charset)} LIMIT 2`)).rows;
    const charset = facts.charsets.find(value => value.name === design.charset);
    if (!Array.isArray(defaults) || defaults.length !== 1 || defaults[0].name !== design.charset || defaults[0].collation !== tables[0].collation || !charset || tableCreateMetadataInteger(defaults[0].maxBytes) !== charset.maxBytes) return false;
  }
  const columns = (await structureTaskQuery<IndexColumnMetadata[]>(context, `SELECT COLUMN_NAME,DATA_TYPE,COLUMN_TYPE,IS_NULLABLE,CHARACTER_SET_NAME,COLLATION_NAME,CHARACTER_MAXIMUM_LENGTH,CHARACTER_OCTET_LENGTH,EXTRA FROM information_schema.COLUMNS WHERE ${condition} ORDER BY ORDINAL_POSITION LIMIT 1001`)).rows;
  if (columns.length !== design.columns.length || columns.some((column, index) => column.COLUMN_NAME !== design.columns[index].name)) return false;
  // 所有实际列都核目录语义；只有键列另外授予索引成本能力，非键列不能被遗漏或伪造成计划键列。
  for (const metadata of columns) {
    const expected = plan.columns.find(column => column.name === metadata.COLUMN_NAME), definition = document.columns.find(column => column.name === metadata.COLUMN_NAME);
    if (!definition || typeof metadata.DATA_TYPE !== 'string' || typeof metadata.EXTRA !== 'string' || !/^(?:(?:auto_increment|DEFAULT_GENERATED)\s*)*$/i.test(metadata.EXTRA)) return false;
    const charset = facts.charsets.find(value => value.name === metadata.CHARACTER_SET_NAME), character = /^(CHAR|VARCHAR|ENUM|SET|(?:TINY|MEDIUM|LONG)?TEXT)$/.test(metadata.DATA_TYPE.toUpperCase());
    if (character && (metadata.CHARACTER_SET_NAME !== design.charset || metadata.COLLATION_NAME !== tables[0].collation || !charset)) return false;
    // 非键LOB同样证明子类型容量；不能让两个互相一致但同时缩小的目录长度冒充BLOB。
    // https://dev.mysql.com/doc/refman/8.4/en/string-type-syntax.html
    const capacity = blobCapacities.get(metadata.DATA_TYPE.toUpperCase());
    if (capacity !== undefined && (metadata.CHARACTER_SET_NAME !== null || metadata.COLLATION_NAME !== null || tableCreateMetadataInteger(metadata.CHARACTER_MAXIMUM_LENGTH) !== capacity || tableCreateMetadataInteger(metadata.CHARACTER_OCTET_LENGTH) !== capacity)) return false;
    const actual = deriveTrustedIndexColumn(definition, metadata, { definitionContext: document.context, charsetMaxBytes: charset?.maxBytes });
    if (actual.column.generated || actual.column.hidden) return false;
    if (!expected) continue;
    if (expected.family === 'character' && charset?.maxBytes !== expected.unitBytes) return false;
    if (expected.family !== 'character' && (metadata.CHARACTER_SET_NAME !== null || metadata.COLLATION_NAME !== null)) return false;
    if (!actual.writable || actual.reasons.length || actual.column.fullKeyBytes !== expected.fullKeyBytes) return false;
    if (expected.declaredUnits !== undefined && (actual.column.prefix.kind !== 'allowed' || actual.column.prefix.maxLength !== expected.declaredUnits || actual.column.prefix.unit !== (expected.family === 'binary' ? 'bytes' : 'characters'))) return false;
  }
  const rows = (await structureTaskQuery<Record<string, unknown>[]>(context, `SELECT INDEX_NAME,NON_UNIQUE,COLUMN_NAME,SEQ_IN_INDEX,SUB_PART,INDEX_TYPE,COLLATION,INDEX_COMMENT,EXPRESSION,IS_VISIBLE FROM information_schema.STATISTICS WHERE ${condition} ORDER BY INDEX_NAME,SEQ_IN_INDEX LIMIT 4097`)).rows;
  if (rows.some(row => row.EXPRESSION !== null || row.IS_VISIBLE !== 'YES')) return false;
  if (rows.length !== plan.indexes.reduce((count, index) => count + index.keyParts.length, 0) || rows.some(row => !plan.indexes.some(index => index.name === row.INDEX_NAME))) return false;
  // 目录只证明键属性；显式来源由准确CREATE设计、完整SHOW一一对应及无外键共同约束，不把STATISTICS当作生成来源证明。
  for (const index of parsed.indexes) { const actual = crossCheckIndexStatistics(index, rows.filter(row => row.INDEX_NAME === index.name), { expression: true, visibility: true, ignored: false }); if (actual.visible !== true) return false; }
  // 两次已观测SHOW一致，不将后核描述为跨连接物理CAS。
  const after = (await structureTaskQuery<Record<string, unknown>[]>(context, `SHOW CREATE TABLE ${qualified(target.database, target.table)}`)).rows;
  return after.length === 1 && after[0]['Create Table'] === document.source;
}
