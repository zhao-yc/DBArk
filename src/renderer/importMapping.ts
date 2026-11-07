export type ImportMappingAction = 'name' | 'position' | 'clear';

/** 保留来源顺序。精确同名只领取一次目标，位置匹配沿调用方已筛选的可写目录顺序。 */
export function matchImportColumns<T extends { name: string }>(action: ImportMappingAction,
  sources: readonly string[], targets: readonly T[]): (T | undefined)[] {
  if (action === 'clear') return sources.map(() => undefined);
  if (action === 'position') return sources.map((_source, index) => targets[index]);
  const available = new Map(targets.map(column => [column.name, column]));
  return sources.map(source => {
    const target = available.get(source);
    available.delete(source);
    return target;
  });
}
