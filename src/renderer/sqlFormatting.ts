import type * as monaco from 'monaco-editor';
import { format, formatDialect, mysql } from 'sql-formatter';
import { completionLimits } from '../shared/sqlCompletion';
import { sqlFormattingZh as text } from './locales/sqlFormatting.zh-CN';
import { editorIndentationOptions } from '../shared/editorIndentation';
import { readSqlKeywordCase, sqlKeywordRoleLimits } from '../shared/sqlKeywordCase';

type RoleModule = typeof import('./sqlFormattingRoles');
let preparedRoles: RoleModule | undefined;
/** 仅显式大写/小写入口调用；模块加载成功前上层必须保留原模型/选区/owner，默认入口不调用。 */
export async function prepareSqlFormattingRoles(): Promise<void> { preparedRoles = await import('./sqlFormattingRoles'); }

export interface FormattingPreferences { tabSize?: unknown; insertSpaces?: unknown; keywordCase?: unknown; }
type FormatterToken = Parameters<NonNullable<typeof mysql.tokenizerOptions.postProcess>>[0][number];
// 只列正式词法类型，不维护关键字单词表；函数/数据类型/变量/参数/标识符均不在其中。
const keywordTypes = new Set<string>(['RESERVED_KEYWORD', 'RESERVED_KEYWORD_PHRASE', 'RESERVED_SET_OPERATION', 'RESERVED_CLAUSE', 'RESERVED_SELECT', 'RESERVED_JOIN', 'CASE', 'END', 'WHEN', 'ELSE', 'THEN', 'LIMIT', 'BETWEEN', 'AND', 'OR', 'XOR']);
const functionNames = new Set(mysql.tokenizerOptions.reservedFunctionNames);

interface Atom { start: number; end: number; kind: string; raw: string; gapSensitive?: boolean; }
const whitespace = (char: string) => /[\t\n\r\f ]/.test(char);
const word = (char: string) => /[A-Za-z0-9_$\u0080-\uffff]/.test(char);
const fail = (): never => { throw new Error(text.unsafe); };

/** 有界词法校验只用于确认排版未改变原始token，不把它当作SQL语法解析或执行器。 */
function atoms(source: string, ansiQuotes: boolean, noBackslashEscapes: boolean): Atom[] {
  const out: Atom[] = []; let i = 0, depth = 0;
  while (i < source.length) {
    if (whitespace(source[i])) { i++; continue; }
    const start = i, char = source[i], next = source[i + 1]; let kind = 'symbol';
    if (char === '#' || char === '-' && next === '-' && /[\x00-\x20\x7f]/.test(source[i + 2] ?? ' ')) {
      kind = 'comment'; while (i < source.length && !/[\r\n]/.test(source[i])) i++;
    } else if (char === '/' && next === '*') {
      // 可执行注释及提示器具有独立语法；不能由普通formatter猜测其含义。
      if (/^(?:!|M!|\+)/i.test(source.slice(i + 2))) fail();
      const close = source.indexOf('*/', i + 2); if (close < 0) fail(); i = close + 2; kind = 'comment';
    } else if (char === "'" || char === '"' || char === '`') {
      const identifier = char === '`' || char === '"' && ansiQuotes; kind = identifier ? 'identifier' : 'string'; i++; let closed = false;
      while (i < source.length) {
        const current = source[i++];
        if (current === char) { if (source[i] === char) i++; else { closed = true; break; } }
        else if (current === '\\' && !identifier && !noBackslashEscapes && i < source.length) i++;
      }
      if (!closed) fail();
    } else {
      const numeric = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(source.slice(i));
      if (numeric && !word(source[i + numeric[0].length] ?? '')) { kind = 'number'; i += numeric[0].length; }
      else if (word(char)) { kind = 'word'; while (i < source.length && word(source[i])) i++; }
      else {
        const operator = /^(?:<=>|->>|->|:=|<=|>=|!=|<>|<<|>>|&&|\|\|)/.exec(source.slice(i)); i += operator?.[0].length ?? 1;
        if (char === '(' && ++depth > completionLimits.depth || char === ')' && --depth < 0) fail();
      }
    }
    const raw = source.slice(start, i), previous = out.at(-1);
    // 不支持的客户端/存储程序及模式变更脚本保守拒绝，包括未选中的上下文。
    if (kind === 'word' && /^(?:DELIMITER|PROCEDURE|FUNCTION|TRIGGER|EVENT|SQL_MODE)$/i.test(raw)) fail();
    // 命名参数/用户变量前缀同样不允许由排版拼接或拆开。
    const sensitive = previous && (['word', 'identifier'].includes(previous.kind) && raw === '(' || previous.kind === 'word' && kind === 'string' || [':', '@'].includes(previous.raw));
    out.push({ start, end: i, kind, raw, ...(sensitive ? { gapSensitive: start > previous.end } : {}) });
    if (out.length > completionLimits.tokens) throw new Error(text.limited);
  }
  if (depth !== 0) fail(); return out;
}

/** 通过公开方言postProcess取得原位置/正式类型，先执行依赖原后处理，不导入私有lexer。 */
function keywordCaseFormatting(source: string, start: number, end: number, original: string, options: { tabSize: number; insertSpaces: boolean }, keywordCase: 'upper' | 'lower', names: { start: number; end: number }[]) {
  let captured: FormatterToken[] | undefined;
  const dialect = { ...mysql, tokenizerOptions: { ...mysql.tokenizerOptions, postProcess(tokens: FormatterToken[]) {
    captured = mysql.tokenizerOptions.postProcess?.(tokens) ?? tokens; return captured;
  } } };
  const config = { tabWidth: options.tabSize, useTabs: !options.insertSpaces, keywordCase, identifierCase: 'preserve' as const, functionCase: 'preserve' as const, dataTypeCase: 'preserve' as const };
  // 全上下文取词法类型，避免把选中的t.order后半段或函数名当作孤立关键字。
  const trimmed = source.trim(), offset = source.length - source.trimStart().length;
  const whole = formatDialect(trimmed, { ...config, dialect });
  if (!captured || captured.length > completionLimits.tokens) return fail();
  const tokens = captured.filter(token => !['LINE_COMMENT', 'BLOCK_COMMENT'].includes(token.type));
  const eligible: { start: number; end: number }[] = []; let previousEnd = offset, nameIndex = 0;
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index], from = offset + token.start, to = from + token.raw.length;
    if (!Number.isSafeInteger(from) || from < previousEnd || to > source.length || source.slice(from, to) !== token.raw) fail();
    previousEnd = to;
    if (!keywordTypes.has(token.type) || from < start || to > end) continue;
    while (nameIndex < names.length && names[nameIndex].end <= from) nameIndex++;
    if (names[nameIndex] && names[nameIndex].start < to && names[nameIndex].end > from) continue;
    const before = tokens[index - 1], after = tokens[index + 1];
    // 限定名称即使被词法器标为关键字也不能改；INSERT()等复用关键字的函数上下文不放宽。
    if (before?.type === 'PROPERTY_ACCESS_OPERATOR' || after?.type === 'PROPERTY_ACCESS_OPERATOR' || after?.type === 'OPEN_PAREN' && functionNames.has(token.text)) continue;
    eligible.push({ start: from, end: to });
  }
  const formatted = start === 0 && end === source.length ? whole : format(original.trim(), { ...config, language: 'mysql' });
  return { formatted, eligible };
}

/** 四种引号模式均保持token原文及敏感空白；任何疑点都在修改模型前拒绝。 */
export function planSqlFormatting(source: string, start: number, end: number, eol: string = '\n', indentation: FormattingPreferences = {}): { start: number; end: number; text: string } | null {
  if (source.length > completionLimits.sourceUnits) throw new Error(text.limited);
  if (source.includes('\0') || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > source.length || !['\n', '\r\n'].includes(eol)) fail();
  const scans = [false, true].flatMap(ansi => [false, true].map(escapes => ({ ansi, escapes, tokens: atoms(source, ansi, escapes) })));
  for (const { tokens } of scans) if (tokens.some(token => start > token.start && start < token.end || end > token.start && end < token.end)) throw new Error(text.selection);
  if (source[start - 1] === '\r' && source[start] === '\n' || source[end - 1] === '\r' && source[end] === '\n') throw new Error(text.selection);
  const original = source.slice(start, end), leading = /^[\t\n\r\f ]*/.exec(original)![0], trailing = /[\t\n\r\f ]*$/.exec(original)![0];
  if (!original.trim()) return null;
  let formatted: string, eligible: { start: number; end: number }[] = [];
  // 仅显式格式化时使用当前缩进；更改偏好本身从不改写SQL。
  const options = editorIndentationOptions(indentation.tabSize, indentation.insertSpaces);
  const keywordCase = readSqlKeywordCase(indentation.keywordCase);
  if (keywordCase !== 'preserve' && (source.length > sqlKeywordRoleLimits.sourceUnits || scans[0].tokens.length > sqlKeywordRoleLimits.tokens)) throw Error(text.limited);
  try {
    if (keywordCase !== 'preserve') {
      const roles = preparedRoles; if (!roles) throw Error(text.unavailable);
      ({ formatted, eligible } = keywordCaseFormatting(source, start, end, original, options, keywordCase, roles.sqlFormattingNameRanges(source)));
    }
    else formatted = format(original.trim(), { language: 'mysql', tabWidth: options.tabSize, useTabs: !options.insertSpaces, keywordCase: 'preserve', identifierCase: 'preserve', functionCase: 'preserve', dataTypeCase: 'preserve' });
    formatted = formatted.trim().replace(/\r?\n/g, eol);
  }
  catch { throw new Error(text.failed); }
  const replacement = leading + formatted + trailing, next = source.slice(0, start) + replacement + source.slice(end);
  if (next.length > completionLimits.sourceUnits) throw new Error(text.limited);
  for (const scan of scans) {
    const after = atoms(next, scan.ansi, scan.escapes); if (after.length !== scan.tokens.length) fail(); let range = 0;
    for (let index = 0; index < scan.tokens.length; index++) {
      const before = scan.tokens[index], value = after[index];
      if (before.kind !== value.kind || before.gapSensitive !== value.gapSensitive) fail();
      if (before.raw === value.raw) continue;
      while (range < eligible.length && eligible[range].end <= before.start) range++;
      const owner = eligible[range];
      // 只允许ASCII原关键字原位精确转为所选大小写，防止依赖Unicode忽略大小写把长s等名称认成关键字；其余逐字比较。
      if (keywordCase === 'preserve' || before.kind !== 'word' || !/^[A-Za-z_]+$/.test(before.raw) || !owner || before.start < owner.start || before.end > owner.end || value.raw !== (keywordCase === 'upper' ? before.raw.toUpperCase() : before.raw.toLowerCase())) fail();
    }
  }
  return replacement === original ? null : { start, end, text: replacement };
}

/** 只用Monaco编辑事务改当前模型；两侧undo stop使一次撤销/重做与前后键入分离。 */
export function formatSqlEditor(editor: monaco.editor.IStandaloneCodeEditor, indentation: FormattingPreferences = {}): boolean {
  const model = editor.getModel(), selections = editor.getSelections();
  if (!model || model.isDisposed() || editor.getRawOptions().readOnly) throw new Error(text.unavailable);
  if (model.getValueLength() > completionLimits.sourceUnits) throw new Error(text.limited);
  if (!selections || selections.length !== 1) throw new Error(text.selection);
  const selection = selections[0], range = selection.isEmpty() ? model.getFullModelRange() : selection, version = model.getVersionId();
  const plan = planSqlFormatting(model.getValue(), model.getOffsetAt(range.getStartPosition()), model.getOffsetAt(range.getEndPosition()), model.getEOL(), indentation);
  if (!plan) return false;
  if (editor.getModel() !== model || model.isDisposed() || model.getVersionId() !== version) throw new Error(text.unavailable);
  editor.pushUndoStop();
  const changed = editor.executeEdits('dbark-sql-format', [{ range, text: plan.text, forceMoveMarkers: true }], selection.isEmpty() ? undefined : inverse => inverse.map(({ range }) => selection.setStartPosition(range.startLineNumber, range.startColumn).setEndPosition(range.endLineNumber, range.endColumn)));
  editor.pushUndoStop(); if (!changed) throw new Error(text.unavailable); editor.focus(); return true;
}
