import { tableCreateDraftSchema, tableCreateHasPrefix, tableCreateIndexParts, type TableCreateDraft, type TableCreatePrefixFacts } from '../shared/tableCreate';

/** 计划列仅说明请求类型的可证明上界；实际列事实必须在CREATE后独立读取。 */
export interface PlannedIndexColumn { name: string; family: 'character' | 'binary' | 'integer'; declaredUnits?: number; unitBytes: number; fullKeyBytes: number; }
export interface TableCreateIndexPlan {
  kind: 'new-table-prefix-plan'; factsDigest: string; rowFormat: 'DYNAMIC';
  columns: PlannedIndexColumn[];
  indexes: { name: string; unique: boolean; keyBytes: number; keyParts: { columnName: string; prefixLength?: number }[] }[];
}
/** 只接受准确首片服务器事实；端口、宽泛版本或草稿声明不能代替实际事实。 */
export function assertTableCreatePrefixFacts(facts: TableCreatePrefixFacts): void {
  if (facts.dialect !== 'mysql' || typeof facts.serverVersion !== 'string' || /\s/.test(facts.serverVersion) || !/^8\.4\.11(?:[-+][^\s]+)?$/.test(facts.serverVersion) || facts.pageSize !== 16384 || facts.defaultRowFormat !== 'DYNAMIC' || !/^[a-f0-9]{64}$/.test(facts.digest) || !Array.isArray(facts.charsets) || !facts.charsets.length || facts.charsets.length > 256) throw Error('前缀新表仅支持已证明的MySQL8.4.11/InnoDB/DYNAMIC/16KiB能力');
  const names = new Set<string>();
  for (const charset of facts.charsets) { if (typeof charset.name !== 'string' || /\s/.test(charset.name) || !/^[A-Za-z0-9_]+$/.test(charset.name) || names.has(charset.name) || !Number.isSafeInteger(charset.maxBytes) || charset.maxBytes < 1 || charset.maxBytes > 4) throw Error('实际字符集MAXLEN目录不完整或无效'); names.add(charset.name); }
}
/** 解析待建类型的严格白名单；不调用真实目录适配器，也不制造COLUMNS行。 */
function plannedColumn(column: TableCreateDraft['columns'][number], maxBytes: number): PlannedIndexColumn {
  const type = column.type.trim().toUpperCase(), integer = /^(TINYINT|SMALLINT|MEDIUMINT|INT|INTEGER|BIGINT)(?:\([1-9]\d*\))?(?: UNSIGNED)?$/.exec(type);
  if (integer) return { name: column.name, family: 'integer', unitBytes: 1, fullKeyBytes: ({ TINYINT: 1, SMALLINT: 2, MEDIUMINT: 3, INT: 4, INTEGER: 4, BIGINT: 8 } as Record<string, number>)[integer[1]] };
  const text = /^(CHAR|VARCHAR|BINARY|VARBINARY)\(([1-9]\d*)\)$/.exec(type);
  if (!text) throw Error('前缀新表索引字段首片只证明整数及CHAR/VARCHAR/BINARY/VARBINARY');
  const units = Number(text[2]), binary = text[1] === 'BINARY' || text[1] === 'VARBINARY', unitBytes = binary ? 1 : maxBytes;
  if (!Number.isSafeInteger(units) || units > (['CHAR', 'BINARY'].includes(text[1]) ? 255 : 65535) || !Number.isSafeInteger(units * unitBytes) || units * unitBytes > 65535) throw Error('待建字符串类型长度无法在首片范围证明');
  return { name: column.name, family: binary ? 'binary' : 'character', declaredUnits: units, unitBytes, fullKeyBytes: units * unitBytes };
}
/** 有前缀才走新能力门；整条索引预算包含完整整数/字符串部分，绝不自动截短。 */
export function planTableCreateIndexes(input: TableCreateDraft, facts: TableCreatePrefixFacts): TableCreateIndexPlan {
  const design = tableCreateDraftSchema.parse(input); if (!tableCreateHasPrefix(design)) throw Error('无前缀设计应沿用原新建表路径');
  assertTableCreatePrefixFacts(facts);
  if (design.engine.toUpperCase() !== 'INNODB' || design.foreignKeys.length) throw Error('首片前缀新表仅允许InnoDB且不含外键');
  const charset = facts.charsets.find(value => value.name === design.charset); if (!charset) throw Error('待建字符集不属于本次实际MAXLEN目录');
  if (design.indexes.filter(index => index.name !== 'PRIMARY').length > 64 || design.indexes.some(index => index.name.toUpperCase() === 'PRIMARY' && index.name !== 'PRIMARY')) throw Error('前缀新表索引数量或主键名称超出首片范围');
  const columns = new Map(design.columns.map(column => [column.name, column]));
  if (columns.size !== design.columns.length || new Set(design.columns.map(column => column.name.toLowerCase())).size !== design.columns.length || new Set(design.indexes.map(index => index.name.toLowerCase())).size !== design.indexes.length) throw Error('新表字段或索引名称重复');
  const planned = new Map<string, PlannedIndexColumn>();
  const indexes = design.indexes.map(index => {
    const keyParts = tableCreateIndexParts(index); if (!keyParts.length || keyParts.length > 16 || new Set(keyParts.map(part => part.columnName)).size !== keyParts.length) throw Error('新表索引键部分为空、重复或超过首片预算');
    let keyBytes = 0;
    for (const part of keyParts) {
      const source = columns.get(part.columnName); if (source?.name.toUpperCase() === 'FTS_DOC_ID') throw Error('全文文档定位列不属于新表前缀首片'); if (!source) throw Error('索引字段不属于本次待建草稿');
      const column = planned.get(source.name) ?? plannedColumn(source, charset.maxBytes); planned.set(source.name, column);
      if (index.name === 'PRIMARY' && (part.prefixLength !== undefined || source.nullable)) throw Error('主键只允许非空完整字段，不接受前缀');
      if (part.prefixLength !== undefined && (column.family === 'integer' || part.prefixLength > column.declaredUnits!)) throw Error('前缀类型或长度超出待建字段的已证明范围');
      // 准确8.4.11将等于整字段长度的字符串前缀省略于SHOW/SUB_PART；仅在类型与MAXLEN证明后规范化，主键已先拒绝。
      if (column.family !== 'integer' && part.prefixLength === column.declaredUnits) delete part.prefixLength;
      const bytes = part.prefixLength === undefined ? column.fullKeyBytes : part.prefixLength * column.unitBytes;
      keyBytes += bytes; if (!Number.isSafeInteger(keyBytes) || keyBytes > 3072) throw Error('整条索引超过已证明的3072字节预算，不能自动截短');
    }
    return { name: index.name, unique: index.name === 'PRIMARY' || index.unique, keyBytes, keyParts };
  });
  return { kind: 'new-table-prefix-plan', factsDigest: facts.digest, rowFormat: 'DYNAMIC', columns: [...planned.values()], indexes };
}
