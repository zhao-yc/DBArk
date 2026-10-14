import { tableDefinitionTokens, type TableDefinitionToken } from './tableColumnDefinition';
import { defaultForeignKeyAction, type ForeignKeyAction } from '../shared/tableForeignKeyPatches';
import type { DefinitionRange, TableColumnDefinitionDocument } from '../shared/tableColumnPatches';

export interface ParsedForeignKey {
  range: DefinitionRange; rawSql: string; name?: string;
  childColumnNames: string[]; parentTarget?: { database: string; table: string }; parentColumnNames: string[];
  onUpdate?: ForeignKeyAction; onDelete?: ForeignKeyAction; opaqueReasons: string[];
}
export interface TableForeignKeyDefinitionRead {
  foreignKeys: ParsedForeignKey[]; complete: boolean; unclassifiedConstraintRanges: DefinitionRange[];
}
/** 关键字只来自未引用词；名称、字符串及普通注释均不能伪造语法。 */
function word(token: TableDefinitionToken | undefined): string { return token?.kind === 'word' ? token.value.toUpperCase() : ''; }
function symbol(token: TableDefinitionToken | undefined, value: string): boolean { return token?.kind === 'symbol' && token.value === value; }
function isName(token: TableDefinitionToken | undefined): token is TableDefinitionToken { return !!token && ['word', 'identifier'].includes(token.kind); }
/** 已知非外键约束可以排除，陌生约束不能仅凭没出现 FOREIGN 就当成零外键。 */
function knownOtherConstraint(tokens: TableDefinitionToken[]): boolean {
  let cursor = 0;
  if (word(tokens[cursor]) === 'CONSTRAINT') {
    cursor++;
    if (isName(tokens[cursor]) && !['PRIMARY', 'UNIQUE', 'CHECK'].includes(word(tokens[cursor]))) cursor++;
  }
  return ['PRIMARY', 'UNIQUE', 'KEY', 'INDEX', 'FULLTEXT', 'SPATIAL', 'CHECK'].includes(word(tokens[cursor]));
}

/** 外键只接受完整有序列名元组，表达式、前缀、方向和重复列均保留只读。 */
function names(tokens: TableDefinitionToken[], start: number): { names: string[]; end: number } | undefined {
  if (!symbol(tokens[start], '(')) return;
  const values: string[] = []; let cursor = start + 1;
  while (cursor < tokens.length) {
    if (!isName(tokens[cursor]) || values.length >= 32 || values.includes(tokens[cursor].value)) return;
    values.push(tokens[cursor++].value);
    if (symbol(tokens[cursor], ')')) return { names: values, end: cursor + 1 };
    if (!symbol(tokens[cursor++], ',')) return;
  }
}

/** MATCH 与 SET DEFAULT 未有写入实证；不得因 InnoDB 某版本忽略它们而丢弃原属性。 */
function action(tokens: TableDefinitionToken[], start: number): { value: ForeignKeyAction; end: number } | undefined {
  const first = word(tokens[start]), second = word(tokens[start + 1]);
  if (first === 'RESTRICT' || first === 'CASCADE') return { value: first, end: start + 1 };
  if (first === 'NO' && second === 'ACTION') return { value: 'NO ACTION', end: start + 2 };
  if (first === 'SET' && second === 'NULL') return { value: 'SET NULL', end: start + 2 };
}

/** SHOW CREATE 原范围与有序语义并存，不能把解析后的 SQL 当作可无损重建原定义。 */
function parseForeignKey(document: TableColumnDefinitionDocument, range: DefinitionRange, tokens: TableDefinitionToken[], database: string, serverVersion: string): ParsedForeignKey | undefined {
  let cursor = 0, name: string | undefined;
  if (word(tokens[cursor]) === 'CONSTRAINT') {
    cursor++;
    if (isName(tokens[cursor]) && !['FOREIGN', 'CHECK', 'PRIMARY', 'UNIQUE'].includes(word(tokens[cursor]))) name = tokens[cursor++].value;
  }
  if (word(tokens[cursor]) !== 'FOREIGN') return;
  const result: ParsedForeignKey = { range, rawSql: document.source.slice(range.start, range.end), ...(name ? { name } : {}), childColumnNames: [], parentColumnNames: [], opaqueReasons: [] };
  const fail = (message: string): ParsedForeignKey => { result.opaqueReasons.push(message); return result; };
  if (!name) result.opaqueReasons.push('外键没有明确约束名称');
  if (tokens.some(token => token.kind === 'executable')) return fail('外键包含可执行注释，不能证明全部语义');
  if (word(tokens[++cursor]) !== 'KEY') return fail('无法确认 FOREIGN KEY 边界');
  cursor++;
  // SHOW CREATE 通常省略外键索引名；保留显式形式的语义，绝不把它当作约束名。
  if (isName(tokens[cursor])) cursor++;
  const child = names(tokens, cursor);
  if (!child || word(tokens[child.end]) !== 'REFERENCES') return fail('子字段元组或 REFERENCES 边界不完整');
  result.childColumnNames = child.names; cursor = child.end + 1;
  if (!isName(tokens[cursor])) return fail('父表名称不完整');
  let parentDatabase = database, parentTable = tokens[cursor++].value;
  if (symbol(tokens[cursor], '.')) {
    cursor++;
    if (!isName(tokens[cursor])) return fail('跨库父表名称不完整');
    parentDatabase = parentTable; parentTable = tokens[cursor++].value;
  }
  result.parentTarget = { database: parentDatabase, table: parentTable };
  const parent = names(tokens, cursor);
  if (!parent || parent.names.length !== child.names.length) return fail('父子字段元组数量或形式不匹配');
  result.parentColumnNames = parent.names; cursor = parent.end;
  const seen = new Set<string>();
  while (cursor < tokens.length) {
    if (word(tokens[cursor]) !== 'ON') return fail('外键包含 MATCH 或其它未证明属性');
    const operation = word(tokens[cursor + 1]);
    if (!['UPDATE', 'DELETE'].includes(operation) || seen.has(operation)) return fail('外键动作种类未知或重复');
    seen.add(operation);
    const read = action(tokens, cursor + 2);
    if (!read) return fail('外键动作尚未支持');
    if (operation === 'UPDATE') result.onUpdate = read.value; else result.onDelete = read.value;
    cursor = read.end;
  }
  if (!result.onUpdate || !result.onDelete) {
    try {
      const fallback = defaultForeignKeyAction({ dialect: document.context.dialect, serverVersion });
      result.onUpdate ??= fallback; result.onDelete ??= fallback;
    } catch { result.opaqueReasons.push('未验证服务器的缺省外键动作，不能按大版本猜测'); }
  }
  return result;
}

/** 完整性覆盖所有原片段；无法识别的可执行内容不能被当作“没有出向外键”。 */
export function readTableForeignKeyDefinition(document: TableColumnDefinitionDocument, database: string, serverVersion: string): TableForeignKeyDefinitionRead {
  if (!database || document.database !== undefined && document.database !== database) throw new Error('外键定义数据库与可信目标不一致');
  const result: TableForeignKeyDefinitionRead = { foreignKeys: [], complete: true, unclassifiedConstraintRanges: [] };
  for (const item of document.items) {
    const tokens = tableDefinitionTokens(item.raw, document.context);
    if (item.kind !== 'constraint') {
      if (tokens.some(token => token.kind === 'executable' || ['REFERENCES', 'FOREIGN', 'CONSTRAINT'].includes(word(token)))) { result.complete = false; result.unclassifiedConstraintRanges.push(item.range); }
      continue;
    }
    const parsed = parseForeignKey(document, item.range, tokens, database, serverVersion);
    if (parsed) {
      if (result.foreignKeys.length >= 256) throw new Error('外键原定义数量超过 256 项预算');
      result.foreignKeys.push(parsed);
      if (parsed.opaqueReasons.length) result.complete = false;
    } else if (!knownOtherConstraint(tokens) || tokens.some(token => token.kind === 'executable' || word(token) === 'FOREIGN')) {
      result.complete = false; result.unclassifiedConstraintRanges.push(item.range);
    }
  }
  const names = result.foreignKeys.map(key => key.name).filter((name): name is string => name !== undefined);
  if (new Set(names).size !== names.length) { result.complete = false; for (const key of result.foreignKeys) if (names.filter(name => name === key.name).length > 1) key.opaqueReasons.push('外键约束名称重复'); }
  return result;
}
