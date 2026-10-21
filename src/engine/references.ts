import type { CellValue, ColumnInfo, FilterGroup, FilterMode, FilterRule, ForeignKeyInfo, SortRule, TableInfo } from '../shared/contracts';
import { referenceColumn, validateReferenceValues } from '../shared/references';
import { buildPageSql, exportLiteral, identifier, inlineParameters, qualified, typedCellPlaceholder } from './sql';

/** SHOW CREATE 词法只解析真实表级约束，跳过注释和字符串中的伪 SQL。 */
export function foreignKeyActions(ddl: string, noBackslashEscapes = false, ansiQuotes = false): Map<string, Pick<ForeignKeyInfo, 'onDelete' | 'onUpdate'>> {
  const tokens: Array<{ text: string; kind: 'word' | 'identifier' | 'string' | 'symbol' }> = [];
  for (let index = 0; index < ddl.length;) {
    const char = ddl[index], next = ddl[index + 1];
    if (/\s/.test(char)) { index++; continue; }
    if (char === '#' || (char === '-' && next === '-' && /[\x00-\x20]/.test(ddl[index + 2] ?? ' '))) { const end = ddl.indexOf('\n', index); index = end < 0 ? ddl.length : end + 1; continue; }
    if (char === '/' && next === '*') { const end = ddl.indexOf('*/', index + 2); if (end < 0) throw new Error('外键定义包含未闭合注释'); index = end + 2; continue; }
    if (char === '`' || char === "'" || char === '"') {
      const kind = char === '`' || (char === '"' && ansiQuotes) ? 'identifier' : 'string';
      let text = '', closed = false; index++;
      while (index < ddl.length) {
        const value = ddl[index++];
        if (value === char) { if (ddl[index] === char) { text += char; index++; } else { closed = true; break; } }
        else if (value === '\\' && kind === 'string' && !noBackslashEscapes && index < ddl.length) { text += ddl[index++]; }
        else text += value;
      }
      if (!closed) throw new Error('外键定义包含未闭合引号'); tokens.push({ text, kind }); continue;
    }
    const word = /^[\w$\u0080-\uffff]+/.exec(ddl.slice(index));
    if (word) { tokens.push({ text: word[0], kind: 'word' }); index += word[0].length; }
    else { tokens.push({ text: char, kind: 'symbol' }); index++; }
  }
  const result = new Map<string, Pick<ForeignKeyInfo, 'onDelete' | 'onUpdate'>>();
  const isWord = (token: typeof tokens[number] | undefined, word: string) => token?.kind === 'word' && token.text.toUpperCase() === word;
  if (!isWord(tokens[0], 'CREATE') || !isWord(tokens[1], 'TABLE')) return result;
  const begin = tokens.findIndex(token => token.kind === 'symbol' && token.text === '(');
  if (begin < 0) throw new Error('服务器没有返回可识别的表定义');
  let depth = 1, segment = begin + 1;
  for (let index = segment; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.kind === 'symbol' && token.text === '(') depth++;
    if (token.kind === 'symbol' && token.text === ')') depth--;
    if (!(token.kind === 'symbol' && ((depth === 1 && token.text === ',') || depth === 0))) continue;
    const part = tokens.slice(segment, index); segment = index + 1;
    if (isWord(part[0], 'CONSTRAINT') && isWord(part[2], 'FOREIGN') && isWord(part[3], 'KEY')) {
      const fail = () => new Error('无法确定外键动作规则，请使用 SQL 定义核对当前约束');
      const name = part[1]; if (!name || !['word', 'identifier'].includes(name.kind) || result.has(name.text)) throw fail();
      let position = 4;
      /** 有序消费引用列列表，不把列名或注释里的 ON 当动作。 */
      const columns = () => {
        if (part[position++]?.text !== '(') throw fail();
        for (;;) {
          if (!['word', 'identifier'].includes(part[position++]?.kind ?? '')) throw fail();
          const separator = part[position++]; if (separator?.text === ')') break; if (separator?.text !== ',') throw fail();
        }
      };
      columns(); if (!isWord(part[position++], 'REFERENCES')) throw fail();
      if (!['word', 'identifier'].includes(part[position++]?.kind ?? '')) throw fail();
      if (part[position]?.text === '.') { position++; if (!['word', 'identifier'].includes(part[position++]?.kind ?? '')) throw fail(); }
      columns();
      // 五个 InnoDB 基线的 SHOW CREATE 省略 RESTRICT；NO ACTION 若显式保留则原样读取。
      const actions = { onDelete: 'RESTRICT', onUpdate: 'RESTRICT' }; const seen = new Set<string>();
      while (position < part.length) {
        if (!isWord(part[position++], 'ON')) throw fail();
        const direction = part[position++]; if (!isWord(direction, 'UPDATE') && !isWord(direction, 'DELETE')) throw fail();
        const property = direction.text.toUpperCase() === 'UPDATE' ? 'onUpdate' : 'onDelete'; if (seen.has(property)) throw fail(); seen.add(property);
        const action = part[position++];
        if (isWord(action, 'CASCADE') || isWord(action, 'RESTRICT')) actions[property] = action.text.toUpperCase();
        else if (isWord(action, 'SET') && isWord(part[position++], 'NULL')) actions[property] = 'SET NULL';
        else if (isWord(action, 'NO') && isWord(part[position++], 'ACTION')) actions[property] = 'NO ACTION';
        else throw fail();
      }
      result.set(name.text, actions);
    }
    if (depth === 0) break;
  }
  if (depth !== 0) throw new Error('外键定义包含未闭合表结构');
  return result;
}

/** 保持精确数值类型，文本则让父列自身的字符集与排序规则决定外键相等语义。 */
function referenceLiteral(column: ColumnInfo, value: Exclude<CellValue, null>): string {
  if (/^BIT\b/i.test(column.type)) return inlineParameters(typedCellPlaceholder(column, value), [value]);
  if (/^(?:FLOAT|DOUBLE|REAL)\b/i.test(column.type)) {
    const text = typeof value === 'boolean' ? (value ? '1' : '0') : String(value);
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)) throw new Error(`关联字段 ${column.name} 需要有限浮点数`);
    // FLOAT 驱动文本可能只给短小数；恢复 binary32 后用 DOUBLE 字面量与服务器原值比较。
    const number = /^FLOAT\b/i.test(column.type) ? Math.fround(Number(text)) : Number(text);
    if (!Number.isFinite(number)) throw new Error(`关联字段 ${column.name} 超过浮点数范围`);
    const literal = String(number);
    return /e/i.test(literal) ? literal : `${literal}e0`;
  }
  if (/^(?:TINYINT|SMALLINT|MEDIUMINT|INT|INTEGER|BIGINT|DECIMAL|NUMERIC|FIXED|BIT|YEAR)\b/i.test(column.type)) {
    if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new Error(`关联字段 ${column.name} 必须使用精确字符串或安全整数`);
    const text = typeof value === 'boolean' ? (value ? '1' : '0') : String(value);
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) throw new Error(`关联字段 ${column.name} 需要精确十进制数`);
    const [whole, fraction = ''] = text.replace(/^[+-]/, '').split('.');
    if (whole.replace(/^0+/, '').length + fraction.length > 65 || fraction.length > 38) throw new Error(`关联字段 ${column.name} 超过数据库精确数值范围`);
    return `CAST(${exportLiteral(text)} AS DECIMAL(65,${fraction.length}))`;
  }
  return exportLiteral(value);
}

/** 在普通分页 SQL 的筛选组外追加关联条件，ANY 筛选不能放宽关联范围。 */
export function buildReferencePageSql(target: TableInfo, foreignKey: ForeignKeyInfo, matchValues: CellValue[] | undefined, page: number, pageSize: number, filters: FilterRule[], sort: SortRule[], filterMode?: FilterMode, filterGroup?:FilterGroup): string {
  if (!target.editableKey.length || !target.indexes.some(index => index.unique && index.columns.length === target.editableKey.length && index.columns.every((name, index) => referenceColumn(target, name).name === target.editableKey[index])) || target.editableKey.some(name => referenceColumn(target, name).nullable)) throw new Error('关联目标表没有可靠的非空唯一键，暂不支持稳定分页，请使用 SQL 查询查看');
  const statement = buildPageSql(target, page, pageSize, filters, sort, filterMode, filterGroup);
  const sql = inlineParameters(statement.sql, statement.params);
  if (matchValues === undefined) return sql;
  validateReferenceValues(matchValues);
  if (matchValues.length !== foreignKey.referencedColumns.length) throw new Error('关联值数量与当前外键字段数量不同，请刷新表结构');
  const match = matchValues.includes(null) ? '0 = 1' : foreignKey.referencedColumns.map((name, index) => `${identifier(name)} = ${referenceLiteral(referenceColumn(target, name), matchValues[index]!)}`).join(' AND ');
  const prefix = `SELECT * FROM ${qualified(target.database, target.name)}`;
  if (!sql.startsWith(prefix)) throw new Error('关联分页模板无效');
  const tail = sql.slice(prefix.length);
  return `${prefix} WHERE (${match})${tail.startsWith(' WHERE ') ? ' AND ' + tail.slice(7) : tail}`;
}
