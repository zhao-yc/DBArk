import { MySQL } from 'dt-sql-parser/dist/parser/mysql';
import type { ErrorListener } from 'dt-sql-parser/dist/parser/common/parseErrorListener';
import { MySqlParserListener } from 'dt-sql-parser/dist/lib/mysql/MySqlParserListener';
import type { CompletionLexicalMode } from './completionLexical';
import { sqlSyntaxCheckLimits as limits, sqlSyntaxBoundary, validSqlSyntaxCheckResult, type SqlSyntaxCheckResult, type SqlSyntaxIssue, type SqlSyntaxBlockedReason } from './sqlSyntaxCheck';

interface Statement { text: string; origins: number[]; start: number; end: number; words: string[]; incomplete?: SqlSyntaxIssue; }
interface Scan { statements: Statement[]; issues: SqlSyntaxIssue[]; }
class StopCheck extends Error { constructor(readonly reason: SqlSyntaxBlockedReason) { super(reason); } }
/** 默认监听器会写出原SQL，所有真实词法、语法回调必须由本地静默监听接管。 */
class QuietMySQL extends MySQL {
  override createLexer(...args: Parameters<MySQL['createLexer']>) { return super.createLexer(args[0], args[1] ?? (() => {})); }
  override createParser(...args: Parameters<MySQL['createParser']>) { return super.createParser(args[0], args[1] ?? (() => {})); }
}
const whitespace = (character: string | undefined) => character !== undefined && /[\x09-\x0d\x20]/.test(character);
const name = (character: string | undefined) => character !== undefined && /[A-Za-z0-9_$\u0080-\uffff]/.test(character);
/** 声明明确的never出口，令调用方在拒绝后继续保持类型收窄。 */
function stop(reason: SqlSyntaxBlockedReason): never { throw new StopCheck(reason); }

/** 普通片段保留每个UTF16边界，字符串/引用名规范化只替代原完整token，错误仍映射原词。 */
function scan(source: string, ansiQuotes: boolean, noBackslashEscapes: boolean): Scan {
  const statements: Statement[] = [], issues: SqlSyntaxIssue[] = [];
  let index = 0, delimiter = ';', lineStart = true, hasCode = false, depth = 0, total = 0;
  let current: Statement = { text: '', origins: [0], start: 0, end: 0, words: [] };
  let previous: { kind: 'name' | 'number' | 'identifier' | 'string' | 'symbol'; value: string } | undefined, beforePrevious: typeof previous;
  /** 点号前后必须是真实名词token；数字小数点及字符串内容不能伪造限定名称。 */
  function remember(kind: NonNullable<typeof previous>['kind'], value: string): void { beforePrevious = previous; previous = { kind, value }; }
  /** 逐字符复制的映射不依赖行列估算，CRLF及补充平面字符均保留原边界。 */
  function append(start: number, end: number, replacement?: string): void {
    const text = replacement ?? source.slice(start, end);
    if (!current.text.length) { current.start = start; current.origins[0] = start; }
    current.text += text;
    for (let offset = 1; offset <= text.length; offset++) current.origins.push(replacement === undefined ? start + offset : offset === text.length ? end : start);
    current.end = end;
  }
  /** 一个DELIMITER定义的完整语句只进入一次真正MySQL解析器，例程体内分号不二次拆分。 */
  function finish(end: number, next: number): void {
    current.end = end;
    if (hasCode) {
      if (statements.length >= limits.statements) stop('budget');
      // 原词法确认括号仍未闭合时，缺失关闭符的位置就是本条原文EOF，不靠解析器恢复时选中的旧token猜测。
      if (depth > 0 && !current.incomplete) { issues.push({ start: end, end, code: 'incomplete' }); if (issues.length > limits.issues) stop('budget'); }
      if (current.words[0] === 'SET' && current.words.includes('SQL_MODE') || current.words[0] === 'RESET' && current.words.includes('CONNECTION')) stop('dynamic-mode');
      if (['SOURCE', 'SYSTEM', 'QUIT', 'EXIT', 'CONNECT', 'CHARSET', 'TEE', 'PAGER', 'NOPAGER', 'NOTEE', 'REHASH', 'PROMPT', 'EDIT', 'EGO'].includes(current.words[0])) stop('client-command');
      statements.push(current);
    }
    current = { text: '', origins: [next], start: next, end: next, words: [] }; hasCode = false; depth = 0; previous = undefined; beforePrevious = undefined;
  }
  /** 每个普通或引用token均计入同一预算，不因注释、数字或复合例程绕开有界入口。 */
  function token(): void { if (++total > limits.tokens) stop('budget'); hasCode = true; }
  while (index < source.length) {
    if (lineStart && !hasCode) {
      const lineEnd = source.indexOf('\n', index), end = lineEnd < 0 ? source.length : lineEnd + 1, line = source.slice(index, end);
      if (/^[\t\r ]*DELIMITER\b/i.test(line)) {
        const directive = /^[\t\r ]*DELIMITER[\t ]+(\S+)[\t\r ]*(?:\n)?$/i.exec(line);
        if (!directive || directive[1].length > 16 || /["'`\\]/.test(directive[1])) stop('delimiter');
        delimiter = directive[1]; index = end; lineStart = lineEnd >= 0;
        current = { text: '', origins: [index], start: index, end: index, words: [] }; continue;
      }
    }
    if (source.startsWith(delimiter, index)) { finish(index, index + delimiter.length); index += delimiter.length; lineStart = false; continue; }
    const start = index, character = source[index], next = source[index + 1];
    if (whitespace(character)) { index++; append(start, index); lineStart = character === '\n' || lineStart; continue; }
    if (character === '#' || character === '-' && next === '-' && /[\x00-\x20\x7f]/.test(source[index + 2] ?? ' ')) {
      const end = source.indexOf('\n', index); index = end < 0 ? source.length : end;
      append(start, index, source.slice(start, index).replace(/[^\r\n]/g, ' ')); lineStart = false; continue;
    }
    lineStart = false;
    if (character === '/' && next === '*') {
      if (source[index + 2] === '!' || /^M!/i.test(source.slice(index + 2, index + 4)) || source[index + 2] === '+') stop('executable-comment');
      const end = source.indexOf('*/', index + 2);
      if (end < 0) { const issue: SqlSyntaxIssue = { start, end: source.length, code: 'unclosed-comment' }; issues.push(issue); current.incomplete = issue; index = source.length; break; }
      index = end + 2; append(start, index, source.slice(start, index).replace(/[^\r\n]/g, ' ')); continue;
    }
    if (character === '\\') stop('client-command');
    if (character === "'" || character === '"' || character === '`') {
      token(); const identifier = character === '`' || character === '"' && ansiQuotes; index++; let closed = false;
      while (index < source.length) {
        const item = source[index++];
        if (item === character) { if (source[index] === character) index++; else { closed = true; break; } }
        else if (item === '\\' && !identifier && !noBackslashEscapes && index < source.length) index++;
      }
      if (!closed) { const issue: SqlSyntaxIssue = { start, end: source.length, code: identifier ? 'unclosed-identifier' : 'unclosed-string' }; issues.push(issue); current.incomplete = issue; break; }
      if (identifier && source.slice(start + 1, index - 1).replaceAll(character + character, character).toUpperCase() === 'SQL_MODE') current.words.push('SQL_MODE');
      // X/B引导文字的内容属于词法本身，不能用普通'0'替代而把非法十六/二进制文字报为无问题。
      const prefix = source[start - 1], special = character === "'" && /[xXbB]/.test(prefix ?? '') && !name(source[start - 2]) && previous?.kind === 'name' && previous.value.toUpperCase() === prefix.toUpperCase() && !(beforePrevious?.kind === 'symbol' && ['.', '@', ':'].includes(beforePrevious.value));
      if (special) {
        const content = source.slice(start + 1, index - 1), valid = /[xX]/.test(prefix) ? /^[0-9a-f]*$/i.test(content) && content.length % 2 === 0 : /^[01]*$/.test(content);
        if (!valid) { issues.push({ start: start - 1, end: index, code: 'syntax' }); if (issues.length > limits.issues) stop('budget'); }
        append(start, index); remember('string', ''); continue;
      }
      append(start, index, identifier ? '`x`' : "'0'"); remember(identifier ? 'identifier' : 'string', ''); continue;
    }
    if (name(character)) {
      token(); index++; while (name(source[index]) && !source.startsWith(delimiter, index)) index++;
      const text = source.slice(start, index), numeric = /^(?:\d+(?:e\d+)?|0x[\da-f]+|0b[01]+)$/i.test(text);
      if (/^[A-Za-z_][A-Za-z0-9_$]*$/.test(text)) current.words.push(text.toUpperCase());
      // MySQL允许限定名点号后的保留词；依赖语法有误拒绝，按真实token关系引用而不改裸名称。
      const qualified = !numeric && previous?.kind === 'symbol' && previous.value === '.' && beforePrevious && ['name', 'identifier'].includes(beforePrevious.kind);
      append(start, index, qualified ? '`x`' : undefined); remember(numeric ? 'number' : 'name', text); continue;
    }
    token(); index += (source.codePointAt(index) ?? 0) > 0xffff ? 2 : 1;
    if (character === '(' && ++depth > limits.depth) stop('budget');
    if (character === ')') depth = Math.max(0, depth - 1);
    append(start, index); remember('symbol', character);
  }
  finish(source.length, source.length);
  return { statements, issues };
}

/** antlr4ng CharStream以Unicode代码点计数，显式建立代码点到规范文本UTF16边界表。 */
function codePointOffsets(source: string): number[] { const offsets = [0]; let units = 0; for (const character of source) { units += character.length; offsets.push(units); } return offsets; }

/** 只用原ANTLR token起止索引；lexer错误用其原tokenStart/inputStream，不信任混合单位行列。 */
function parseStatement(statement: Statement, output: SqlSyntaxIssue[]): void {
  if (statement.incomplete) return;
  const offsets = codePointOffsets(statement.text), parser = new QuietMySQL();
  /** 原始token索引统一映射为原完整词；同一类别同一位置只登记一次。 */
  function add(startPoint: number, endPoint: number, code: SqlSyntaxIssue['code']): void {
    if (!Number.isSafeInteger(startPoint) || !Number.isSafeInteger(endPoint) || startPoint < 0 || endPoint < startPoint || endPoint >= offsets.length) stop('position');
    const start = statement.origins[offsets[startPoint]], end = statement.origins[offsets[endPoint]];
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start) stop('position');
    if (!output.some(value => value.start === start && value.end === end && value.code === code)) output.push({ start, end, code });
    if (output.length > limits.issues) stop('budget');
  }
  const listener: ErrorListener = (_converted, original) => {
    const symbol = original.offendingSymbol;
    let startPoint: number, endPoint: number, code: SqlSyntaxIssue['code'] = 'syntax';
    if (symbol) {
      if (symbol.type === -1) { startPoint = endPoint = offsets.length - 1; code = 'incomplete'; }
      else { startPoint = symbol.start; endPoint = symbol.stop + 1; }
    } else {
      const lexer = original.recognizer as unknown as { _tokenStartCharIndex?: unknown; inputStream?: { index?: unknown } };
      if (typeof lexer._tokenStartCharIndex !== 'number' || typeof lexer.inputStream?.index !== 'number') stop('position');
      startPoint = lexer._tokenStartCharIndex; endPoint = Math.min(offsets.length - 1, lexer.inputStream.index + 1);
    }
    add(startPoint, endPoint, code);
  };
  // parse而不是validate：后者会对错误脚本二次按分号拆分，不能保留DELIMITER例程和原偏移。
  const tree = parser.parse(statement.text, listener), roles = new MySqlParserListener();
  // 依赖专为补全容许emptyColumn；实际检查不能将缺失表达式误认成无问题脚本。
  roles.enterEmptyColumn = context => { const token = context.start; if (!token) stop('position'); if (token.type === -1) add(offsets.length - 1, offsets.length - 1, 'incomplete'); else add(token.start, token.stop + 1, 'syntax'); };
  parser.listen(roles, tree);
}

/** 检查整份脚本但不执行；未知模式只有所有解释及定位完全一致时才允许报告本地解析结果。 */
export function checkMysqlSyntax(source: string, mode: CompletionLexicalMode = {}): SqlSyntaxCheckResult {
  try {
    if (typeof source !== 'string' || source.includes('\0') || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(source)) stop('input');
    if (source.length > limits.sourceUnits) stop('budget');
    if (!mode || typeof mode !== 'object' || Array.isArray(mode) || ![null, Object.prototype].includes(Object.getPrototypeOf(mode)) || Reflect.ownKeys(mode).some(key => typeof key !== 'string' || !['ansiQuotes', 'noBackslashEscapes'].includes(key))) stop('mode');
    for (const name of ['ansiQuotes', 'noBackslashEscapes'] as const) { const descriptor = Object.getOwnPropertyDescriptor(mode, name); if (descriptor && (!descriptor.enumerable || !('value' in descriptor) || descriptor.value !== undefined && typeof descriptor.value !== 'boolean')) stop('mode'); }
    const scans: Scan[] = [];
    for (const quotes of mode.ansiQuotes === undefined ? [false, true] : [mode.ansiQuotes]) for (const escapes of mode.noBackslashEscapes === undefined ? [false, true] : [mode.noBackslashEscapes]) scans.push(scan(source, quotes, escapes));
    const first = scans[0]; if (scans.some(value => JSON.stringify(value) !== JSON.stringify(first))) stop('mode');
    const issues = first.issues.slice();
    for (const statement of first.statements) parseStatement(statement, issues);
    issues.sort((left, right) => left.start - right.start || left.end - right.end || left.code.localeCompare(right.code, 'en'));
    if (issues.length > limits.issues) stop('budget');
    if (issues.some(issue => !sqlSyntaxBoundary(source, issue.start) || !sqlSyntaxBoundary(source, issue.end))) stop('position');
    const result: SqlSyntaxCheckResult = { status: 'ready', issues, statementCount: first.statements.length };
    return validSqlSyntaxCheckResult(result, source) ? result : { status: 'blocked', reason: 'position' };
  } catch (error) { return { status: 'blocked', reason: error instanceof StopCheck ? error.reason : 'parser' }; }
}
