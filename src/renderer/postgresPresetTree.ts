import { postgresRelationName } from '../shared/postgresSql';
import type { TablePresetTarget } from '../shared/tablePresets';

const listeners = new Map<string, Set<() => void>>();
function key(target: TablePresetTarget): string {
  const { schema, name } = postgresRelationName(target.table);
  return JSON.stringify([target.connectionId, target.database, schema, name]);
}

/** 只通知展开的同一关系节点。别名与 public 限定名共用更新范围。 */
export function onPostgresPresetsChanged(target: TablePresetTarget, listener: () => void): () => void {
  const id = key(target), group = listeners.get(id) ?? new Set();
  group.add(listener);
  listeners.set(id, group);
  return () => { group.delete(listener); if (!group.size) listeners.delete(id); };
}

export function postgresPresetsChanged(target: TablePresetTarget): void {
  for (const listener of listeners.get(key(target)) ?? []) listener();
}
