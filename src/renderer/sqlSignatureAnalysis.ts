import { signatureLexicalContext, type CompletionLexicalMode, type CompletionToken } from '../shared/completionLexical';
import { sqlFunctionSignatures, type SqlFunctionSignature } from './locales/sqlSignatures.zh-CN';

export interface SqlSignatureAnalysis { readonly name: string; readonly open: number; readonly argument: number; readonly signatures: readonly SqlFunctionSignature[]; readonly activeSignature: number; readonly activeParameter: number; }
interface Frame { name?: string; open: number; argument: number; call: boolean; distinct: boolean; special: boolean; }
const groups = new Set(['IN', 'EXISTS', 'OVER', 'USING', 'AS', 'VALUES', 'SELECT', 'FILTER']);
const objects = new Set(['TABLE', 'VIEW', 'INDEX', 'FUNCTION', 'PROCEDURE', 'INTO', 'REFERENCES', 'CONSTRAINT']);
/** 只识别裸函数的逗号调用；复杂专用语法不冒充普通参数列表。 */
const special = new Set(['FROM', 'FOR', 'AS', 'ORDER', 'SEPARATOR']);
const word = (token: CompletionToken | undefined) => token?.kind === 'word' ? token.value.toUpperCase() : '';

/** 一次有界扫描维护括号栈，嵌套调用／子查询／字面量内的逗号不改变外层参数编号。 */
export function analyzeSqlSignature(source: string, offset: number, dialect: 'mysql' | 'mariadb' | 'sqlite', mode: CompletionLexicalMode = {}): SqlSignatureAnalysis | undefined {
  const context = signatureLexicalContext(source, offset, dialect, mode); if (context.status !== 'ready') return;
  const frames: Frame[] = [], levels = new Map<number, { cte: boolean; query: boolean }>(), tokens = context.tokens;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]; if (token.start >= offset) break;
    const key = word(token); let level = levels.get(token.depth); if (!level) { level = { cte: false, query: false }; levels.set(token.depth, level); }
    if (key === 'WITH') { level.cte = true; level.query = false; }
    if (['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'REPLACE'].includes(key)) level.query = true;
    if (token.end > offset) break;
    if (token.kind === 'symbol' && token.value === '(') {
      const prior = tokens[i - 1], previous = tokens[i - 2], name = word(prior), before = word(previous);
      const call = !!prior && ['word', 'identifier'].includes(prior.kind) && !groups.has(name);
      const ddl = objects.has(before) || before === 'EXISTS' && word(tokens[i - 3]) === 'NOT' && word(tokens[i - 4]) === 'IF' || level.cte && !level.query;
      const qualified = previous?.value === '.' || previous?.value === ':' || previous?.value === '@';
      levels.delete(token.depth + 1);
      frames.push({ ...(call && name && !ddl && !qualified && sqlFunctionSignatures(name, dialect) ? { name } : {}), open: token.start, argument: 0, call, distinct: word(tokens[i + 1]) === 'DISTINCT', special: false });
    } else if (token.kind === 'symbol' && token.value === ')') frames.pop();
    else if (token.kind === 'symbol' && token.value === ',') { const frame = frames.at(-1); if (frame) frame.argument++; }
    else if (key && special.has(key) && frames.at(-1)?.call) frames.at(-1)!.special = true;
  }
  for (let i = frames.length - 1; i >= 0; i--) {
    const frame = frames[i]; if (!frame.call) continue;
    // 未知或被限定的内层调用阻断外层猜测；不能把自定义函数当作同名内置函数。
    if (!frame.name || frame.special) return;
    const signatures = sqlFunctionSignatures(frame.name, dialect)!.filter(value => frame.name !== 'COUNT' || !!value.distinct === frame.distinct);
    const activeSignature = signatures.findIndex(value => value.variadic || frame.argument < value.parameters.length); if (activeSignature < 0) return;
    return { name: frame.name, open: frame.open, argument: frame.argument, signatures, activeSignature, activeParameter: Math.min(frame.argument, signatures[activeSignature].parameters.length - 1) };
  }
}
