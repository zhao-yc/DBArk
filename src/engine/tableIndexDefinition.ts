import { tableDefinitionTokens, type TableDefinitionToken } from './tableColumnDefinition';
import type { DefinitionRange, TableColumnDefinitionDocument } from '../shared/tableColumnPatches';
import { tableIndexPatchLimits, type IndexDefinition, type ParsedIndex, type ParsedIndexPart, type TableIndexDefinitionDocument, type TrustedIndexColumn } from '../shared/tableIndexPatches';

/** 关键字必须是未引用词，名称中的 KEY/COMMENT 不参与语法判断。 */
function word(token: TableDefinitionToken | undefined): string { return token?.kind === 'word' ? token.value.toUpperCase() : ''; }
function symbol(token: TableDefinitionToken | undefined, value: string): boolean { return token?.kind === 'symbol' && token.value === value; }
function isName(token: TableDefinitionToken | undefined): token is TableDefinitionToken { return Boolean(token && (token.kind === 'word' || token.kind === 'identifier')); }

/** 只切顶层 key part，函数内部逗号、字符串和引用名都留在各自原片段中。 */
function readParts(tokens: TableDefinitionToken[], start: number, source: string): { parts: ParsedIndexPart[]; end: number } {
  let depth = 1, from = start + 1;
  const parts: ParsedIndexPart[] = [];
  const add = (until: number): void => {
    if (until === from) throw new Error('索引定义存在空键部分');
    if (parts.length >= tableIndexPatchLimits.keyParts) throw new Error('索引键部分超过 32 项');
    const items = tokens.slice(from, until), first = items[0], last = items[items.length - 1];
    const part: ParsedIndexPart = { range: { start: first.start, end: last.end }, rawSql: source.slice(first.start, last.end), opaqueReasons: [] };
    let cursor = 0;
    if (isName(first)) { part.columnName = first.value; cursor++; }
    else { part.expressionSql = part.rawSql; part.opaqueReasons.push('表达式键部分仅保留原定义'); }
    if (cursor && symbol(items[cursor], '(')) {
      const length = items[cursor + 1];
      if (length?.kind === 'number' && /^[1-9]\d*$/.test(length.value) && symbol(items[cursor + 2], ')') && Number.isSafeInteger(Number(length.value))) { part.prefixLength = Number(length.value); cursor += 3; }
      else part.opaqueReasons.push('无法证明键前缀长度');
    }
    if (['ASC', 'DESC'].includes(word(items[cursor]))) { part.direction = word(items[cursor]) === 'DESC' ? 'desc' : 'asc'; cursor++; }
    else part.direction = 'asc';
    if (cursor !== items.length) part.opaqueReasons.push('键部分包含未支持属性');
    if (items.some(token => token.kind === 'executable')) part.opaqueReasons.push('键部分包含可执行注释');
    parts.push(part);
  };
  for (let cursor = start + 1; cursor < tokens.length; cursor++) {
    if (symbol(tokens[cursor], '(')) depth++;
    if (symbol(tokens[cursor], ')')) {
      depth--;
      if (!depth) { add(cursor); return { parts, end: cursor + 1 }; }
    }
    if (depth === 1 && symbol(tokens[cursor], ',')) { add(cursor); from = cursor + 1; }
  }
  throw new Error('索引键部分括号未闭合');
}

/** 提取已知索引语法；不完整理解的选项按整条只读，原范围保持精确。 */
function readIndex(document: TableColumnDefinitionDocument, range: DefinitionRange): ParsedIndex | undefined {
  const source = document.source;
  const tokens = tableDefinitionTokens(source.slice(range.start, range.end), document.context).map(token => ({ ...token, start: token.start + range.start, end: token.end + range.start }));
  let cursor = 0, constraintPrefix = false;
  if (word(tokens[cursor]) === 'CONSTRAINT') {
    constraintPrefix = true; cursor++;
    if (isName(tokens[cursor]) && !['PRIMARY', 'UNIQUE', 'FOREIGN', 'CHECK'].includes(word(tokens[cursor]))) cursor++;
  }
  const first = word(tokens[cursor]);
  if (!['PRIMARY', 'UNIQUE', 'KEY', 'INDEX', 'FULLTEXT', 'SPATIAL'].includes(first)) return undefined;
  const kind: ParsedIndex['kind'] = first === 'PRIMARY' ? 'primary' : first === 'UNIQUE' ? 'unique' : first === 'FULLTEXT' ? 'fulltext' : first === 'SPATIAL' ? 'spatial' : 'ordinary';
  cursor++;
  if (!['KEY', 'INDEX'].includes(first) && ['KEY', 'INDEX'].includes(word(tokens[cursor]))) cursor++;
  const result: ParsedIndex = { range, rawSql: source.slice(range.start, range.end), name: kind === 'primary' ? 'PRIMARY' : '', kind, parts: [], attributes: [], opaqueReasons: [] };
  const reasons: string[] = [], attributes: { kind: string; range: DefinitionRange; rawSql: string }[] = [];
  if (constraintPrefix) reasons.push('具名约束前缀尚未开放重建');
  if (kind === 'fulltext' || kind === 'spatial') reasons.push('全文或空间索引首批只读');
  if (tokens.some(token => token.kind === 'executable')) reasons.push('索引包含可执行注释');
  if (kind !== 'primary') {
    if (isName(tokens[cursor]) && word(tokens[cursor]) !== 'USING') result.name = tokens[cursor++].value;
    else reasons.push('索引缺少明确名称');
  }
  let method: string | undefined;
  const readMethod = (): void => {
    const start = tokens[cursor++].start, value = tokens[cursor++];
    if (!isName(value)) throw new Error('索引 USING 缺少方法');
    if (method !== undefined) reasons.push('索引方法重复');
    method = value.value.toUpperCase();
    attributes.push({ kind: 'method', range: { start, end: value.end }, rawSql: source.slice(start, value.end) });
  };
  if (word(tokens[cursor]) === 'USING') readMethod();
  if (!symbol(tokens[cursor], '(')) reasons.push('无法识别索引键部分边界');
  else { const read = readParts(tokens, cursor, source); result.parts = read.parts; cursor = read.end; }
  let comment: string | undefined;
  while (cursor < tokens.length) {
    if (word(tokens[cursor]) === 'USING') { readMethod(); continue; }
    if (word(tokens[cursor]) === 'COMMENT' && tokens[cursor + 1]?.kind === 'string') {
      if (comment !== undefined) reasons.push('索引注释重复');
      const start = tokens[cursor++].start, value = tokens[cursor++]; comment = value.value;
      attributes.push({ kind: 'comment', range: { start, end: value.end }, rawSql: source.slice(start, value.end) }); continue;
    }
    const start = tokens[cursor].start, end = tokens[tokens.length - 1].end;
    attributes.push({ kind: 'opaque', range: { start, end }, rawSql: source.slice(start, end) });
    reasons.push('索引包含可见性或其他未支持选项'); break;
  }
  result.method = method ?? 'BTREE'; result.comment = comment ?? '';
  if (result.method !== 'BTREE') reasons.push('首批仅修改 BTREE 索引');
  reasons.push(...result.parts.flatMap(part => part.opaqueReasons));
  result.attributes = attributes; result.opaqueReasons = [...new Set(reasons)]; return result;
}

/** 复用已有表定义边界和词法上下文；列、外键、CHECK 和表尾完全不重建。 */
export function readTableIndexDefinition(document: TableColumnDefinitionDocument): TableIndexDefinitionDocument {
  const indexes: ParsedIndex[] = [], otherConstraintRanges: DefinitionRange[] = [];
  const names = new Set<string>();
  for (const item of document.items) {
    if (item.kind !== 'constraint') continue;
    const index = readIndex(document, item.range);
    if (!index) { otherConstraintRanges.push(item.range); continue; }
    if (indexes.length >= tableIndexPatchLimits.indexes) throw new Error('表索引超过 256 项预算');
    const folded = index.name.toLowerCase();
    if (index.name && names.has(folded)) throw new Error('表定义索引名称重复');
    names.add(folded); indexes.push(index);
  }
  return { source: document.source, indexes, columnRanges: document.columns.map(column => column.range), otherConstraintRanges, tableTailRange: document.tail.range };
}

/** 同快照列名映射为不透明引用；只在唯一匹配时允许服务器列名大小写规范化。 */
export function editableIndexDefinition(index: ParsedIndex, columns: ReadonlyMap<string, TrustedIndexColumn>): IndexDefinition | undefined {
  if (index.opaqueReasons.length || !['ordinary', 'unique', 'primary'].includes(index.kind) || index.method !== 'BTREE' || !index.name || !index.parts.length) return undefined;
  const keyParts: IndexDefinition['keyParts'] = [];
  for (const part of index.parts) {
    const exact = [...columns].filter(([, column]) => column.name === part.columnName);
    const matches = exact.length ? exact : [...columns].filter(([, column]) => column.name.toLowerCase() === part.columnName?.toLowerCase());
    if (matches.length !== 1 || part.opaqueReasons.length) return undefined;
    keyParts.push({ columnRef: matches[0][0], direction: part.direction ?? 'asc', ...(part.prefixLength === undefined ? {} : { prefixLength: part.prefixLength }) });
  }
  return { kind: index.kind as IndexDefinition['kind'], name: index.name, method: 'BTREE', keyParts, comment: index.comment ?? '' };
}
