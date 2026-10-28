import { z } from 'zod';
import { tableCheckChangeSchema, tableCheckLimits } from './tableChecks';

/** 新表仅接受明确命名的表级检查；不把ALTER引用、SQL或列定位混入CREATE草稿。 */
export const tableCreateCheckSchema = tableCheckChangeSchema.options[0].omit({ op: true });
export const tableCreateChecksSchema = z.array(tableCreateCheckSchema).min(1).max(tableCheckLimits.checks);
export type TableCreateCheck = z.infer<typeof tableCreateCheckSchema>;
export interface TableCreateChecksAccess { editable: boolean; allowsNotEnforced: boolean; reason?: string; }
export const tableCreateChecksAcknowledgement = 'create-check-enforcement' as const;

/** 按键存在识别请求，显式undefined或空数组不能借“没有约束”绕回旧生成器。 */
export function tableCreateHasChecks(design: object): boolean { return Object.hasOwn(design, 'checks'); }

/** 保留名称/表达式原文，先检查有界合同；SQL词法及服务器语义由实际会话裁决。 */
export function assertTableCreateChecks(design: { checks?: unknown }): void {
  if (!tableCreateHasChecks(design)) return;
  const checks = tableCreateChecksSchema.parse(design.checks), names = new Set<string>();
  for (const check of checks) {
    const key = check.name.toLowerCase();
    if (names.has(key)) throw Error(tableCreateChecksMessages.duplicate);
    names.add(key);
  }
}

export const tableCreateChecksMessages = {
  legacy: '含CHECK的新表必须使用检查约束专属计划，不能静默丢弃检查条件',
  invalid: '新表CHECK约束设计无效，未发送CREATE',
  duplicate: '新表CHECK约束名称不能重复；名称最终仍按服务器规则检验',
  unavailable: '当前服务器不能完整证明新表CHECK能力，不能提交本次设计',
  unsupported: '当前版本可能忽略CHECK或不支持本次生效状态，不能提交本次设计',
  stale: '新表CHECK能力或会话模式已变化，请重新准备，不会重放CREATE',
  verify: '新表CHECK的完整定义或目录尚未核验，不把CREATE成功当作约束核验成功',
  warning: 'CHECK不等价于NOT NULL；NULL可能符合检查，NOT ENFORCED不阻止不符合条件的数据。表达式是否可用由服务器检验。',
} as const;
