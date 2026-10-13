import { tablePreferencesLimits, type TablePreferences } from '../shared/tablePreferences';
import { tableGridZh as text } from './locales/tableGrid.zh-CN';

/** 将已保存列与真实当前列调和：旧列删除，新列追加，实际列名作为身份。 */
export function reconcileTablePreferences(names: readonly string[], preferences: TablePreferences | null): TablePreferences {
  const current = new Set(names), used = new Set<string>(); const saved = preferences?.columns ?? [];
  const currentGroups = new Map<string, string[]>(), savedGroups = new Map<string, number>();
  for (const name of names) { const group = currentGroups.get(name.toLowerCase()) ?? []; group.push(name); currentGroups.set(name.toLowerCase(), group); }
  for (const column of saved) savedGroups.set(column.name.toLowerCase(), (savedGroups.get(column.name.toLowerCase()) ?? 0) + 1);
  const matched = new Map<number, string>();
  // 精确名称先占位，只有两边折叠分组都唯一才迁移大小写，不合并不同真实列。
  saved.forEach((column, index) => { if (current.has(column.name) && !used.has(column.name)) { matched.set(index, column.name); used.add(column.name); } });
  saved.forEach((column, index) => {
    if (matched.has(index)) return;
    const group = currentGroups.get(column.name.toLowerCase());
    if (group?.length === 1 && savedGroups.get(column.name.toLowerCase()) === 1 && !used.has(group[0])) { matched.set(index, group[0]); used.add(group[0]); }
  });
  const columns: TablePreferences['columns'] = [];
  for (let index = 0; index < saved.length; index++) {
    const name = matched.get(index); if (!name) continue; const column = saved[index];
    columns.push({ name, hidden: column.hidden, ...(column.width !== undefined && Number.isFinite(column.width) ? { width: Math.max(tablePreferencesLimits.minWidth, Math.min(tablePreferencesLimits.maxWidth, Math.round(column.width))) } : {}) });
  }
  for (const name of names) if (!used.has(name)) columns.push({ name, hidden: false });
  if (columns.length && columns.every(column => column.hidden)) columns[0] = { ...columns[0], hidden: false };
  return { version: 1, columns };
}

/** 可见列顺序是网格、查找及复制粘贴的唯一共同输入。 */
export function visibleTableKeys(preferences: TablePreferences): string[] { return preferences.columns.filter(column => !column.hidden).map(column => column.name); }

/** 每次偏好变更整体校验，隐藏最后一列或非法宽度不会产生半个布局。 */
export function changeTablePreference(preferences: TablePreferences, name: string, patch: { hidden?: boolean; width?: number }): TablePreferences {
  if (patch.width !== undefined && (!Number.isInteger(patch.width) || patch.width < tablePreferencesLimits.minWidth || patch.width > tablePreferencesLimits.maxWidth)) throw new Error(text.widthInvalid);
  const columns = preferences.columns.map(column => column.name === name ? { ...column, ...patch } : column);
  if (columns.length && !columns.some(column => !column.hidden)) throw new Error(text.oneVisible);
  return { version: 1, columns };
}

/** 重排按列名移动，选择列不进入偏好数组或拖动目标。 */
export function moveTableColumn(preferences: TablePreferences, source: string, target: string): TablePreferences {
  const columns = preferences.columns.slice(), from = columns.findIndex(column => column.name === source), to = columns.findIndex(column => column.name === target);
  if (from < 0 || to < 0 || from === to) return preferences;
  const [item] = columns.splice(from, 1); columns.splice(to, 0, item); return { version: 1, columns };
}
