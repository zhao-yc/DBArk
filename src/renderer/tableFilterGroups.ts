import type { FilterGroup, FilterMode, FilterRule } from '../shared/contracts';
import { filterGroupSchema, validateFilterGroup, validateFilterRules } from '../shared/filtering';
import { tableFilterGroupsZh as text } from './locales/tableFilterGroups.zh-CN';

/** 只改变已有根的组合方式，保留完整子组；旧平铺规则不隐式增加分组协议。 */
export function tableFilterGroupWithMode(group: FilterGroup | undefined, mode: FilterMode): FilterGroup | undefined {
  if (mode !== 'all' && mode !== 'any') throw Error(text.mapping);
  if (group === undefined) return undefined;
  const checked = filterGroupSchema.parse(group);
  return filterGroupSchema.parse({ mode, children: checked.children });
}

/** 先校验有界树，再仅展示编号及括号，不把条件原值、列名或SQL写进组合摘要。 */
export function tableFilterGroupSummary(group: FilterGroup): string {
  const checked = filterGroupSchema.parse(group);
  /** 每个组保留显式括号，避免嵌套OR被平铺芯片误读为统一AND。 */
  function summary(node: FilterGroup): string {
    return `(${node.children.map(child => typeof child === 'number' ? text.ruleNumber(child + 1) : summary(child)).join(node.mode === 'all' ? text.joinAll : text.joinAny) || text.emptyStructure})`;
  }
  return summary(checked);
}

/** 按真实对象身份建立旧下标到新下标映射；删除或混合操作有歧义时拒绝猜测文本。 */
function changedPositions(previous: readonly FilterRule[], next: readonly FilterRule[]): Map<number, number> {
  if (previous.length === next.length && next.every((rule, index) => rule === previous[index])) return new Map(previous.map((_, index) => [index, index]));
  const identities = new Map<FilterRule, number[]>();
  previous.forEach((rule, index) => identities.set(rule, [...(identities.get(rule) ?? []), index]));
  const complete = next.every(rule => identities.get(rule)?.length === 1) && new Set(next).size === next.length;
  if (previous.length === next.length && !complete) {
    // 普通编辑及批量启停按原位置替换对象；已有对象移位与新对象混合则需要显式映射。
    if (next.some((rule, index) => identities.has(rule) && rule !== previous[index])) throw Error(text.mapping);
    return new Map(previous.map((_, index) => [index, index]));
  }
  if (next.length < previous.length && !complete) throw Error(text.mapping);
  const positions = new Map<number, number>();
  next.forEach((rule, index) => {
    const old = identities.get(rule);
    if (old) {
      if (old.length !== 1 || positions.has(old[0])) throw Error(text.mapping);
      positions.set(old[0], index);
    }
  });
  if (next.length > previous.length && positions.size !== previous.length) throw Error(text.mapping);
  return positions;
}

/** 原位置编辑/启停保持括号；删除重编号并剔除空组，新增条件置根末尾，清空回到旧平铺合同。 */
export function tableFilterGroupAfterChange(previousFilters: readonly FilterRule[], nextFilters: readonly FilterRule[], group: FilterGroup | undefined, mode: FilterMode): FilterGroup | undefined {
  validateFilterRules(previousFilters, mode); validateFilterRules(nextFilters, mode);
  if (!nextFilters.length || group === undefined) return undefined;
  const original = validateFilterGroup(previousFilters, mode, group)!;
  const positions = changedPositions(previousFilters, nextFilters), assigned = new Set(positions.values());
  /** 仅空子组被剔除，单叶子组仍保留其原括号与组合方式。 */
  function remap(node: FilterGroup): FilterGroup {
    const children: (number | FilterGroup)[] = [];
    for (const child of node.children) {
      if (typeof child === 'number') { const index = positions.get(child); if (index !== undefined) children.push(index); }
      else { const nested = remap(child); if (nested.children.length) children.push(nested); }
    }
    return { mode: node.mode, children };
  }
  const remapped = remap(original);
  const additions = nextFilters.map((_, index) => index).filter(index => !assigned.has(index));
  return validateFilterGroup(nextFilters, mode, { mode, children: [...remapped.children, ...additions] });
}
