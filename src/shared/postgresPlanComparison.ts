import type { PlanSnapshotDocument } from './explainSnapshot';
import { explainSnapshotZh as text } from './explainSnapshot.zh-CN';
import { visitPostgresPlans } from './postgresExplain';

interface ComparedField { name: string; left?: string; right?: string; }
interface ComparedNode {
  path: string;
  depth: number;
  left?: string;
  right?: string;
  status: 'added' | 'removed' | 'changed' | 'same';
  fields: ComparedField[];
  changedFields: number;
}
export interface PostgresPlanComparison { nodes: ComparedNode[]; different: number; }

type SourceNode = { depth: number; label: string; fields: Map<string, string> };

/** 对象字段顺序不参与比较，数组顺序和原数值文本保留。 */
function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, child]) => [key, ordered(child)]));
}

/** 按原树路径收集节点自己的字段，子节点另成记录。 */
function sourceNodes(snapshot: PlanSnapshotDocument): Map<string, SourceNode> {
  const nodes = new Map<string, SourceNode>();
  const warnings = visitPostgresPlans(snapshot.raw, (node, position, entry) => {
    const fields = new Map<string, string>();
    for (const [key, value] of Object.entries(node)) {
      if (key !== 'Plans') fields.set(key, JSON.stringify(ordered(value)));
    }
    if (position.depth === 0) for (const key of ['Planning Time', 'Execution Time']) {
      if (Object.hasOwn(entry, key)) fields.set(key, JSON.stringify(entry[key]));
    }
    const label = [node['Node Type'], node['Relation Name'] ?? node['CTE Name'], node['Index Name']]
      .filter(value => typeof value === 'string').join(' · ').slice(0, 240).replace(/[\uD800-\uDBFF]$/, '');
    nodes.set(position.path, { depth: position.depth, label, fields });
  });
  if (warnings.length || !nodes.size) throw Error(text.compareIncomplete);
  return nodes;
}

/** 差异比较使用完整字节派生值，只对呈现给用户的文本截断。 */
function display(value?: string): string | undefined {
  if (value === undefined) return;
  const decoded: unknown = JSON.parse(value);
  const raw = typeof decoded === 'string' ? decoded : value;
  return raw.length <= 1800 ? raw : raw.slice(0, 1800).replace(/[\uD800-\uDBFF]$/, '') + '…';
}

/** 只有同类、完整的 PostgreSQL JSON 快照才能按结构位置比较。 */
export function comparePostgresPlanSnapshots(left: PlanSnapshotDocument, right: PlanSnapshotDocument): PostgresPlanComparison {
  if (left.kind !== right.kind || left.dialect !== 'postgresql' || right.dialect !== 'postgresql' ||
      left.format !== 'json' || right.format !== 'json') throw Error(text.compareUnsupported);
  if (left.rawTruncated || right.rawTruncated || left.result.truncated || right.result.truncated) throw Error(text.compareIncomplete);
  const before = sourceNodes(left), after = sourceNodes(right);
  const nodes: ComparedNode[] = [];
  let different = 0;
  for (const path of new Set([...before.keys(), ...after.keys()])) {
    const a = before.get(path), b = after.get(path);
    const fields: ComparedField[] = [];
    let changedFields = 0;
    for (const name of new Set([...(a?.fields.keys() ?? []), ...(b?.fields.keys() ?? [])])) {
      const original = a?.fields.get(name), target = b?.fields.get(name);
      if (original === target) continue;
      changedFields++;
      if (fields.length < 80) fields.push({ name, left: display(original), right: display(target) });
    }
    const status = !a ? 'added' : !b ? 'removed' : changedFields ? 'changed' : 'same';
    if (status !== 'same') different++;
    nodes.push({ path, depth: (a ?? b)!.depth, left: a?.label, right: b?.label, status, fields, changedFields });
  }
  return { nodes, different };
}
