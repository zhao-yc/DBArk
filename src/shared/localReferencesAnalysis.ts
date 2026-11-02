import { analyzeCompletionDefinition } from './completionDefinitionAnalysis';
import { completionLexicalContext, type CompletionLexicalMode } from './completionLexical';
import type { CompletionScopeCapabilities } from './completionCapabilities';
import { completionLimits } from './sqlCompletion';
import type { LocalReferenceRange, LocalReferences } from './localReferences';

/** 反向索引复用同一个声明解析器；作用域、遮蔽、分支和CTE链均以已确认的声明范围为身份。 */
export function analyzeLocalReferences(source: string, offset: number, mode: CompletionLexicalMode = {}, capabilities: CompletionScopeCapabilities = {}): LocalReferences {
  const context = completionLexicalContext(source, offset, mode, completionLimits.aliasUnits);
  if (context.status !== 'ready') return context;
  const target = context.tokens.find(token => token.start === context.target.start && token.end === context.target.end);
  if (!target || !target.closed || !['word', 'identifier'].includes(target.kind)) return { status: 'blocked', reason: 'syntax' };
  const candidates = context.tokens.filter(token => token.closed && ['word', 'identifier'].includes(token.kind) && token.value === target.value);
  // 整份拒绝超预算；不截断结果冒充完整引用。总耗时另由所属Worker的原2秒期限限制。
  if (candidates.length > completionLimits.entries) return { status: 'blocked', reason: 'budget' };
  const edges = new Map<number, LocalReferenceRange>();
  for (const token of candidates) {
    const result = analyzeCompletionDefinition(source, token.end, mode, capabilities);
    if (result.status === 'blocked') {
      if (result.reason === 'budget') return result;
      continue;
    }
    if (result.definition) edges.set(token.start, result.definition);
  }
  /** q.col → FROM q → WITH q 合为同一个CTE；显式别名仍以自己的声明为终点。 */
  function root(start: number): LocalReferenceRange | undefined {
    const visited = new Set<number>(); let current = candidates.find(token => token.start === start);
    while (current) {
      if (visited.has(current.start)) return;
      visited.add(current.start);
      const next = edges.get(current.start);
      if (!next) return { start: current.start, end: current.end };
      current = candidates.find(token => token.start === next.start && token.end === next.end);
    }
  }
  const declaration = root(target.start);
  if (!declaration) return { status: 'blocked', reason: 'syntax' };
  const references = candidates.filter(token => edges.has(token.start) && root(token.start)?.start === declaration.start).map(token => ({ start: token.start, end: token.end }));
  // 没有语义边的普通同名词不是声明；不把全文匹配包装为数据库语义，也不推断零引用。
  if (!references.length || target.start !== declaration.start && !references.some(item => item.start === target.start)) return { status: 'blocked', reason: 'syntax' };
  return { status: 'ready', target: { start: target.start, end: target.end }, declaration, references };
}
