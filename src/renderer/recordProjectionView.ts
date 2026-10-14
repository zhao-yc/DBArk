import type { LexicalPathSegment, ReadyLexicalDocument } from './jsonLexicalTree';

/** 字段与结构共用 512 个可见条目预算，不把解析节点上限误当作可建 DOM 数。 */
export const projectionViewLimits = Object.freeze({ fields: 32, nodes: 480, previewUnits: 240 });
export interface LexicalViewRow { readonly id: number; readonly depth: number; readonly path: readonly LexicalPathSegment[]; readonly segment?: LexicalPathSegment }
export interface LexicalViewWindow { readonly rows: readonly LexicalViewRow[]; readonly total: number; readonly offset: number; readonly previous: boolean; readonly next: boolean }

/** 仅从已完整验证文档枚举展开路径，窗口外不创建 React 行，精确成员序号保留重复键。 */
export function lexicalViewWindow(document: ReadyLexicalDocument, expanded: ReadonlySet<number>, offset = 0, limit: number = projectionViewLimits.nodes): LexicalViewWindow {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > projectionViewLimits.nodes) throw new Error('结构显示窗口参数不合法');
  const items: LexicalViewRow[] = [];
  /** 词法模型已经将深度限制为 64；这里只保存节点引用和结构路径，不展开完整 token 文本。 */
  function visit(id: number, path: readonly LexicalPathSegment[]): void {
    const node = document.nodes[id]; items.push({ id, path, depth: path.length, segment: path.at(-1) });
    if (!expanded.has(id)) return;
    if (node.kind === 'object') for (const member of node.members) visit(member.valueNode, [...path, { kind: 'member', memberIndex: member.memberIndex, key: member.key }]);
    else if (node.kind === 'array') node.elements.forEach((child, index) => visit(child, [...path, { kind: 'element', index }]));
  }
  visit(document.root, []);
  const start = Math.min(offset, Math.floor((items.length - 1) / limit) * limit);
  return { rows: items.slice(start, start + limit), total: items.length, offset: start, previous: start > 0, next: start + limit < items.length };
}

/** 文本摘要始终说明截断；原始 token 的完整查看由显式选中操作提供。 */
export function projectionPreview(text: string): { text: string; truncated: boolean } {
  return { text: text.slice(0, projectionViewLimits.previewUnits), truncated: text.length > projectionViewLimits.previewUnits };
}
