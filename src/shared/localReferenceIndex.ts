import type { LocalReferenceRange, LocalReferences } from './localReferences';

export interface LocalReferenceToken extends LocalReferenceRange { value: string; }
type Definition = { status: 'blocked'; reason: string } | { status: 'ready'; definition?: LocalReferenceRange };

/** 只索引方言声明解析器确认的语义边；候选必须是同一语句的同名完整token，不做文本匹配回退。 */
export function indexLocalReferences(target: LocalReferenceToken, candidates: LocalReferenceToken[], limit: number, resolve: (token: LocalReferenceToken) => Definition): LocalReferences {
  if (candidates.length > limit) return { status: 'blocked', reason: 'budget' };
  const edges = new Map<number, LocalReferenceRange>();
  for (const token of candidates) {
    const result = resolve(token);
    if (result.status === 'blocked') {
      if (result.reason === 'budget') return result;
      continue;
    }
    if (result.definition) edges.set(token.start, result.definition);
  }
  /** CTE引用链归到声明头；显式别名停在自己的声明，循环或缺失映射不猜目标。 */
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
  // 没有语义边不能证明声明或零引用；不把单纯同名词列入结果。
  if (!references.length || target.start !== declaration.start && !references.some(item => item.start === target.start)) return { status: 'blocked', reason: 'syntax' };
  return { status: 'ready', target: { start: target.start, end: target.end }, declaration, references };
}
