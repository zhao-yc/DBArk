import { sqliteDriverLimits } from './protocol';
import type { SqlStatementRange } from '../sql';

type Head = 'start' | 'explain' | 'explain-query' | 'explained' | 'create' | 'create-temp' | 'create-unique' | 'create-virtual' | 'ordinary';
const identifierStart = (character: string) => /[A-Za-z_\u0080-\uFFFF]/.test(character);
const identifierPart = (character: string) => /[A-Za-z0-9_$\u0080-\uFFFF]/.test(character);
const asciiWhitespace = (character: string) => /[ \t\n\f\r]/.test(character);
type AcceptRange = (start: number, end: number, delimiterStart: number, delimiterEnd: number, delimiter: ';' | null) => void;

/** 完整扫描只回调数字位置，不积攒范围对象；不prepare其它语句，也不解释DELIMITER。 */
function scanSqliteStatements(source: string, accept: AcceptRange): void {
  if (typeof source !== 'string' || Buffer.byteLength(source) > sqliteDriverLimits.sqlBytes) throw Error('SQLite SQL全文不能超过20MiB');
  if (source.includes('\0') || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(source)) throw Error('SQLite SQL全文包含NUL或无效Unicode');
  let segment = 0, code = false, head: Head = 'start', trigger = false, body = false, closed = false, previous = '', depth = 0;
  const reset = (next: number) => { segment = next; code = false; head = 'start'; trigger = body = closed = false; previous = ''; };
  const emit = (delimiterStart: number, delimiterEnd: number, delimiter: ';' | null) => {
    if (!code) return;
    // JS trim会吞掉SQLite不认作空白的NBSP/EMSPACE/VT，甚至误删标识符尾部BOM；这里只修剪原生ASCII空白。
    let start = segment, end = delimiterStart;
    while (start < end && (asciiWhitespace(source[start]) || source[start] === '\uFEFF')) start++;
    while (end > start && asciiWhitespace(source[end - 1])) end--;
    accept(start, end, delimiterStart, delimiterEnd, delimiter);
  };
  /** 只在语句头识别有限CREATE前缀，注释与引用名不会伪装关键字。 */
  const token = (value: string, word: boolean) => {
    if (closed) throw Error('SQLite触发器END后缺少语句分隔符');
    code = true; const keyword = word ? value.toUpperCase() : '';
    if (!trigger) {
      if (head === 'start') { if (keyword === 'DELIMITER') throw Error('SQLite当前语句不接受DELIMITER客户端指令，未发送SQL'); head = keyword === 'EXPLAIN' ? 'explain' : keyword === 'CREATE' ? 'create' : 'ordinary'; }
      else if (head === 'explain') head = keyword === 'QUERY' ? 'explain-query' : keyword === 'CREATE' ? 'create' : 'ordinary';
      else if (head === 'explain-query') head = keyword === 'PLAN' ? 'explained' : 'ordinary';
      else if (head === 'explained') head = keyword === 'CREATE' ? 'create' : 'ordinary';
      else if (head === 'create' || head === 'create-temp') {
        if (keyword === 'TRIGGER') { trigger = true; head = 'ordinary'; }
        else if (head === 'create' && (keyword === 'TEMP' || keyword === 'TEMPORARY')) head = 'create-temp';
        else if (['TABLE', 'VIEW', 'INDEX'].includes(keyword)) head = 'ordinary';
        else if (head === 'create' && (keyword === 'UNIQUE' || keyword === 'VIRTUAL')) head = keyword === 'UNIQUE' ? 'create-unique' : 'create-virtual';
        else throw Error('SQLite当前语句不支持该CREATE类型，不能从其它方言的过程正文截取执行');
      }
      else if (head === 'create-unique' || head === 'create-virtual') { if (keyword !== (head === 'create-unique' ? 'INDEX' : 'TABLE')) throw Error('SQLite当前语句CREATE前缀无效，未发送SQL'); head = 'ordinary'; }
    } else if (!body && keyword === 'BEGIN') body = true;
    else if (body && keyword === 'END' && previous === ';') closed = true;
    previous = keyword || 'token';
  };
  for (let index = 0; index < source.length;) {
    const character = source[index];
    // 此处分支只在token边界可见BOM；标识符循环中的BOM按原ID字节保留，不能把SELECT+BOM+1拆成关键词。
    if (asciiWhitespace(character) || character === '\uFEFF') { index++; continue; }
    // SQLite的--不要求后接空格，块注释不嵌套，EOF行注释无需人为补换行。
    if (source.startsWith('--', index)) { const end = source.indexOf('\n', index + 2); index = end < 0 ? source.length : end + 1; continue; }
    if (source.startsWith('/*', index)) { const end = source.indexOf('*/', index + 2); if (end < 0) throw Error('SQLite SQL全文存在未闭合块注释'); index = end + 2; continue; }
    if (["'", '"', '`', '['].includes(character)) {
      const quote = character === '[' ? ']' : character; let ended = false; index++;
      while (index < source.length) {
        if (source[index] === quote) { if (quote !== ']' && source[index + 1] === quote) index += 2; else { index++; ended = true; break; } } else index++;
      }
      if (!ended) throw Error('SQLite SQL全文存在未闭合引号或引用名'); token('', false); continue;
    }
    if (character === ';') {
      if (depth) throw Error('SQLite SQL全文括号内出现非法语句分隔符');
      if (trigger && !closed) previous = ';';
      else { emit(index, index + 1, ';'); reset(index + 1); }
      index++; continue;
    }
    if (identifierStart(character)) { const start = index++; while (index < source.length && identifierPart(source[index])) index++; token(source.slice(start, index), true); }
    else { if (character === '(') depth++; else if (character === ')' && --depth < 0) throw Error('SQLite SQL全文括号未配对'); token(character, false); index++; }
  }
  if (depth) throw Error('SQLite SQL全文存在未闭合括号');
  if (trigger && !closed) throw Error('SQLite SQL全文存在未闭合CREATE TRIGGER');
  emit(source.length, source.length, null);
}

/** 显式目录入口最多保留原driver的1000份范围，避免20MiB短语句分配百万长期对象。 */
export function sqliteStatementRanges(source: string): SqlStatementRange[] {
  const result: SqlStatementRange[] = [];
  scanSqliteStatements(source, (start, end, delimiterStart, delimiterEnd, delimiter) => {
    if (result.length >= sqliteDriverLimits.statements) throw Error('SQLite语句范围目录超过1000项预算，请使用当前语句定位入口');
    result.push({ sql: source.slice(start, end), start, end, delimiterStart, delimiterEnd, delimiter });
  });
  return result;
}

/** 当前入口仍支持20MiB完整原文及任意语句数量，只保留命中与必要边界候选，并扫完全文核未闭合。
 * Monaco光标沿UTF16半开区间；空白/空语句绝不回退全文或跨空白寻找相邻SQL。
 */
export function currentSqliteStatement(source: string, offset: number): SqlStatementRange | undefined {
  if (typeof source !== 'string' || !Number.isSafeInteger(offset) || offset < 0 || offset > source.length) throw Error('SQLite当前语句光标位置无效，请重新选择');
  if (source[offset - 1] === '\r' && source[offset] === '\n') throw Error('SQLite当前语句光标不能位于CRLF换行内部');
  if (offset > 0 && offset < source.length && /[\uD800-\uDBFF]/.test(source[offset - 1]) && /[\uDC00-\uDFFF]/.test(source[offset])) throw Error('SQLite当前语句光标不能位于Unicode代理对内部');
  let containing: SqlStatementRange | undefined, boundary: SqlStatementRange | undefined;
  scanSqliteStatements(source, (start, end, delimiterStart, delimiterEnd, delimiter) => {
    if (offset >= start && offset < delimiterEnd) containing = { sql: source.slice(start, end), start, end, delimiterStart, delimiterEnd, delimiter };
    else if (offset >= start && offset === delimiterEnd && (offset === source.length || source[offset] === '\r' || source[offset] === '\n')) boundary = { sql: source.slice(start, end), start, end, delimiterStart, delimiterEnd, delimiter };
  });
  return containing ?? boundary;
}
