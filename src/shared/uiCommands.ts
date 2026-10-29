import { z } from 'zod';
import { uiCommandIds } from './uiCommandIds';
export { uiCommandIds, isUiCommandInvocation } from './uiCommandIds';
export { objectCategories, assertObjectBrowserTabs, readObjectBrowserTabs, type ObjectCategory } from './objectBrowser';

/** 原生菜单和渲染层共同使用封闭命令集，不接受脚本、路径、SQL 或任意命令名。 */
export type UiCommandId = typeof uiCommandIds[number];
export const uiCommandIdSchema = z.enum(uiCommandIds);
const revision = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const uiMenuStateSchema = z.object({
  revision,
  commands: z.array(z.object({ id: uiCommandIdSchema, enabled: z.boolean(), checked: z.boolean().optional() }).strict()).max(uiCommandIds.length)
}).strict().superRefine((value, context) => {
  const seen = new Set<UiCommandId>();
  for (const command of value.commands) {
    if (seen.has(command.id)) context.addIssue({ code: 'custom', message: '菜单状态不能包含重复命令' });
    seen.add(command.id);
  }
});
export type UiMenuState = z.infer<typeof uiMenuStateSchema>;
export const uiCommandInvocationSchema = z.object({ id: uiCommandIdSchema, revision }).strict();
export type UiCommandInvocation = z.infer<typeof uiCommandInvocationSchema>;
