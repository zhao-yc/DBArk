import type { SqlKeywordCase } from '../../src/shared/sqlKeywordCase';

/** 固定合成SQL不含执行目标；四个角色预先指定，不借产品planner生成原生预期。 */
export function sqlKeywordCaseNativeSource(mode: SqlKeywordCase = 'preserve'): string {
  const keywords = mode === 'upper' ? ['SELECT', 'AS', 'FROM', 'WHERE'] : mode === 'lower' ? ['select', 'as', 'from', 'where'] : ['sElEcT', 'aS', 'fRoM', 'wHeRe'];
  return `${keywords[0]} MiXeDName,\`SeLeCt\`,'SeLeCt🚢' ${keywords[1]} AliasName ${keywords[2]} MixedTable ${keywords[3]} MiXeDName='WhErE' /* FrOm stays */; -- SeLeCt remains`;
}

/** 仅移除固定样例在保护片段以外的排版空白；注释、字符串和引用标识符逐字比较。 */
export function compactSqlKeywordCaseNative(value: string): string {
  const protectedParts = ["'SeLeCt🚢'", "'WhErE'", '`SeLeCt`', '/* FrOm stays */', '-- SeLeCt remains'];
  let compact = value;
  for (const [index, part] of protectedParts.entries()) {
    if (compact.split(part).length !== 2) throw Error('关键字原生样例的字符串、注释或引用名称已变化');
    compact = compact.replace(part, `__protected_${index}__`);
  }
  // 保留词法边界，名称内部被拆入空白不能因排版归一化而误通过。
  return (compact.match(/[A-Za-z_][A-Za-z0-9_]*|[^\s]/gu) ?? []).join('\0');
}
