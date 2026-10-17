import type * as monaco from 'monaco-editor';
import { format } from 'sql-formatter';
import { completionLimits } from '../shared/sqlCompletion';
import { sqlFormattingZh as text } from './locales/sqlFormatting.zh-CN';

interface Atom { start: number; end: number; kind: string; raw: string; gapSensitive?: boolean; }
const whitespace = (char: string) => /[\t\n\r\f ]/.test(char);
const word = (char: string) => /[A-Za-z0-9_$\u0080-\uffff]/.test(char);
const fail = () => { throw new Error(text.unsafe); };

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

/** 四种引号模式均保持token原文及敏感空白；任何疑点都在修改模型前拒绝。 */
export function planSqlFormatting(source: string, start: number, end: number, eol: string = '\n'): { start: number; end: number; text: string } | null {
  if (source.length > completionLimits.sourceUnits) throw new Error(text.limited);
  if (source.includes('\0') || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > source.length || !['\n', '\r\n'].includes(eol)) fail();
  const scans = [false, true].flatMap(ansi => [false, true].map(escapes => ({ ansi, escapes, tokens: atoms(source, ansi, escapes) })));
  for (const { tokens } of scans) if (tokens.some(token => start > token.start && start < token.end || end > token.start && end < token.end)) throw new Error(text.selection);
  if (source[start - 1] === '\r' && source[start] === '\n' || source[end - 1] === '\r' && source[end] === '\n') throw new Error(text.selection);
  const original = source.slice(start, end), leading = /^[\t\n\r\f ]*/.exec(original)![0], trailing = /[\t\n\r\f ]*$/.exec(original)![0];
  if (!original.trim()) return null;
  let formatted: string;
  try { formatted = format(original.trim(), { language: 'mysql', keywordCase: 'preserve', identifierCase: 'preserve', functionCase: 'preserve', dataTypeCase: 'preserve' }).trim().replace(/\r?\n/g, eol); }
  catch { throw new Error(text.failed); }
  const replacement = leading + formatted + trailing, next = source.slice(0, start) + replacement + source.slice(end);
  if (next.length > completionLimits.sourceUnits) throw new Error(text.limited);
  const signature = (tokens: Atom[]) => JSON.stringify(tokens.map(({ kind, raw, gapSensitive }) => [kind, raw, gapSensitive]));
  for (const scan of scans) if (signature(scan.tokens) !== signature(atoms(next, scan.ansi, scan.escapes))) fail();
  return replacement === original ? null : { start, end, text: replacement };
}

/** 只用Monaco编辑事务改当前模型；两侧undo stop使一次撤销/重做与前后键入分离。 */
export function formatSqlEditor(editor: monaco.editor.IStandaloneCodeEditor): boolean {
  const model = editor.getModel(), selections = editor.getSelections();
  if (!model || model.isDisposed() || editor.getRawOptions().readOnly) throw new Error(text.unavailable);
  if (model.getValueLength() > completionLimits.sourceUnits) throw new Error(text.limited);
  if (!selections || selections.length !== 1) throw new Error(text.selection);
  const selection = selections[0], range = selection.isEmpty() ? model.getFullModelRange() : selection, version = model.getVersionId();
  const plan = planSqlFormatting(model.getValue(), model.getOffsetAt(range.getStartPosition()), model.getOffsetAt(range.getEndPosition()), model.getEOL());
  if (!plan) return false;
  if (editor.getModel() !== model || model.isDisposed() || model.getVersionId() !== version) throw new Error(text.unavailable);
  editor.pushUndoStop();
  const changed = editor.executeEdits('dbark-sql-format', [{ range, text: plan.text, forceMoveMarkers: true }], selection.isEmpty() ? undefined : inverse => inverse.map(({ range }) => selection.setStartPosition(range.startLineNumber, range.startColumn).setEndPosition(range.endLineNumber, range.endColumn)));
  editor.pushUndoStop(); if (!changed) throw new Error(text.unavailable); editor.focus(); return true;
}
