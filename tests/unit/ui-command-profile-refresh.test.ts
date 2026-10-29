import { expect, it, vi } from 'vitest';
import { UiCommandRegistry, updateCommandPageContext } from '../../src/renderer/uiCommandRegistry';

it('连接仅变更外观时页面命令重新启用，原菜单调用仍失效', async () => {
  const registry = new UiCommandRegistry(); registry.setBlocked(false);
  const tab = {}, firstProfile = { name: '原名称' }, nextProfile = { name: '新名称' }, owner = {};
  let actualProfile = firstProfile;
  let context = updateCommandPageContext(undefined, tab, firstProfile, 0);
  const run = vi.fn();
  registry.update('tab:q', owner, { active: true, contextKey: String(context.generation), isCurrent: () => actualProfile === firstProfile, handlers: { execute: { enabled: true, run } } });
  const original = { id: 'execute' as const, revision: registry.getSnapshot().revision };
  expect(registry.getSnapshot().commands.find(item => item.id === 'execute')!.enabled).toBe(true);
  // 同步store通知先撤销旧profile，随后React接纳新概要；连接修订仍为0。
  actualProfile = nextProfile; registry.invalidate();
  expect(registry.getSnapshot().commands.find(item => item.id === 'execute')!.enabled).toBe(false);
  const previous = context;
  context = updateCommandPageContext(context, tab, nextProfile, 0);
  expect(context.generation).toBeGreaterThan(previous.generation);
  expect(updateCommandPageContext(context, tab, nextProfile, 0)).toBe(context);
  registry.update('tab:q', owner, { active: true, contextKey: String(context.generation), isCurrent: () => actualProfile === nextProfile, handlers: { execute: { enabled: true, run } } });
  expect(registry.getSnapshot().commands.find(item => item.id === 'execute')!.enabled).toBe(true);
  expect(await registry.execute(original)).toBe(false);
  expect(await registry.execute({ id: 'execute', revision: registry.getSnapshot().revision })).toBe(true);
  expect(run).toHaveBeenCalledOnce();
});
