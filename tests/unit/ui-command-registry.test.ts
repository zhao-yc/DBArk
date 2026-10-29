import { expect, it, vi } from 'vitest';
import { UiCommandRegistry, type UiCommandHandler } from '../../src/renderer/uiCommandRegistry';
import type { UiCommandId, UiCommandInvocation } from '../../src/shared/uiCommands';

/** 原注册器直接运行，不挂载界面、原生菜单或业务服务。 */
function fixture() {
  const registry = new UiCommandRegistry(); registry.setBlocked(false);
  const event = (id: UiCommandId): UiCommandInvocation => ({ id, revision: registry.getSnapshot().revision });
  const state = (id: UiCommandId) => registry.getSnapshot().commands.find(item => item.id === id)!;
  return { registry, event, state };
}

it('旧原生修订及同一次菜单重复消费拒绝，异步处理器只启动一次', async () => {
  const { registry, event } = fixture(); let finish!: () => void;
  const run = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  registry.update('tab:q', {}, { active: true, contextKey: 'query', handlers: { execute: { enabled: true, run } } });
  const command = event('execute'), pending = registry.execute(command);
  expect(run).toHaveBeenCalledOnce(); expect(await registry.execute(command)).toBe(false);
  finish(); expect(await pending).toBe(true); expect(await registry.execute(command)).toBe(false);
  expect(run).toHaveBeenCalledOnce();
});

it('contextKey从A到B再回A永久撤销原命令修订', async () => {
  const { registry, event } = fixture(), owner = {}, run = vi.fn();
  const value = (contextKey: string) => ({ active: true, contextKey, handlers: { execute: { enabled: true, run } } });
  registry.update('tab:q', owner, value('A')); const original = event('execute');
  registry.update('tab:q', owner, value('B')); registry.update('tab:q', owner, value('A'));
  expect(await registry.execute(original)).toBe(false); expect(run).not.toHaveBeenCalled();
  expect(await registry.execute(event('execute'))).toBe(true); expect(run).toHaveBeenCalledOnce();
});

it('旧scope清理不能卸载同名新owner，新owner替换也撤销原菜单', async () => {
  const { registry, event, state } = fixture(), firstOwner = {}, nextOwner = {}, first = vi.fn(), next = vi.fn();
  registry.update('tab:q', firstOwner, { active: true, contextKey: 'same', handlers: { execute: { enabled: true, run: first } } });
  const old = event('execute');
  registry.update('tab:q', nextOwner, { active: true, contextKey: 'same', handlers: { execute: { enabled: true, run: next } } });
  const replacement = registry.getSnapshot(); registry.remove('tab:q', firstOwner);
  expect(registry.getSnapshot()).toBe(replacement); expect(state('execute').enabled).toBe(true);
  expect(await registry.execute(old)).toBe(false); expect(await registry.execute(event('execute'))).toBe(true);
  expect(first).not.toHaveBeenCalled(); expect(next).toHaveBeenCalledOnce();
  registry.remove('tab:q', nextOwner); expect(state('execute').enabled).toBe(false);
});

it('同一命令两个活动页面scope冲突时fail closed，不借global兜底', async () => {
  const { registry, event, state } = fixture(), firstOwner = {}, nextOwner = {}, app = vi.fn(), first = vi.fn(), next = vi.fn();
  registry.update('app', {}, { active: true, contextKey: 'app', handlers: { execute: { enabled: true, run: app } } });
  registry.update('tab:q1', firstOwner, { active: true, contextKey: 'q1', handlers: { execute: { enabled: true, run: first } } });
  registry.update('tab:q2', nextOwner, { active: true, contextKey: 'q2', handlers: { execute: { enabled: true, run: next } } });
  expect(state('execute').enabled).toBe(false); expect(await registry.execute(event('execute'))).toBe(false);
  expect(app).not.toHaveBeenCalled(); expect(first).not.toHaveBeenCalled(); expect(next).not.toHaveBeenCalled();
  registry.update('tab:q2', nextOwner, { active: false, contextKey: 'q2', handlers: { execute: { enabled: true, run: next } } });
  expect(await registry.execute(event('execute'))).toBe(true); expect(first).toHaveBeenCalledOnce();
});

it('页面优先global，文件scope与查询scope的不同命令可同时保持可用', async () => {
  const { registry, event, state } = fixture(), global = vi.fn(), page = vi.fn(), file = vi.fn();
  registry.update('app', {}, { active: true, contextKey: 'app', handlers: { execute: { enabled: true, run: global }, 'task-center': { enabled: true, run: global } } });
  registry.update('tab:q', {}, { active: true, contextKey: 'q', handlers: { execute: { enabled: true, run: page } } });
  registry.update('tab-files:q', {}, { active: true, contextKey: 'file', handlers: { 'open-sql-file': { enabled: true, run: file } } });
  expect(state('execute').enabled).toBe(true); expect(state('open-sql-file').enabled).toBe(true);
  expect(await registry.execute(event('execute'))).toBe(true); expect(page).toHaveBeenCalledOnce(); expect(global).not.toHaveBeenCalled();
  expect(await registry.execute(event('open-sql-file'))).toBe(true); expect(file).toHaveBeenCalledOnce();
  expect(await registry.execute(event('task-center'))).toBe(true); expect(global).toHaveBeenCalledOnce();
});

it('页面明确禁用命令时不回退到global的可用实现', async () => {
  const { registry, event, state } = fixture(), global = vi.fn(), page = vi.fn();
  registry.update('app', {}, { active: true, contextKey: 'app', handlers: { execute: { enabled: true, run: global } } });
  registry.update('tab:q', {}, { active: true, contextKey: 'q', handlers: { execute: { enabled: false, run: page } } });
  expect(state('execute').enabled).toBe(false); expect(await registry.execute(event('execute'))).toBe(false);
  expect(global).not.toHaveBeenCalled(); expect(page).not.toHaveBeenCalled();
});

it('模态出现再关闭以及同批出现后撤销都使旧代次失效', async () => {
  const { registry, event, state } = fixture(), run = vi.fn();
  registry.update('tab:q', {}, { active: true, contextKey: 'q', handlers: { execute: { enabled: true, run } } });
  const before = event('execute'); registry.setBlocked(true);
  expect(state('execute').enabled).toBe(false); expect(await registry.execute(event('execute'))).toBe(false);
  registry.setBlocked(false); expect(await registry.execute(before)).toBe(false);
  const beforeBatch = event('execute'); registry.setBlocked(false, true);
  expect(await registry.execute(beforeBatch)).toBe(false); expect(await registry.execute(event('execute'))).toBe(true);
  expect(run).toHaveBeenCalledOnce();
});

it('相同状态更新处理器引用不提升代次，实际执行使用当前处理器', async () => {
  const { registry, event } = fixture(), owner = {}, first = vi.fn(), latest = vi.fn(), changed = vi.fn();
  const value = (run: UiCommandHandler['run']) => ({ active: true, contextKey: 'same', handlers: { 'focus-mode': { enabled: true, checked: false, run } } });
  registry.update('app', owner, value(first)); const snapshot = registry.getSnapshot(), off = registry.subscribe(changed), original = event('focus-mode');
  registry.update('app', owner, value(latest));
  expect(registry.getSnapshot()).toBe(snapshot); expect(changed).not.toHaveBeenCalled();
  expect(await registry.execute(original)).toBe(true); expect(first).not.toHaveBeenCalled(); expect(latest).toHaveBeenCalledOnce();
  expect(changed).toHaveBeenCalledOnce(); off(); registry.invalidate(); expect(changed).toHaveBeenCalledOnce();
});

it('enabled与checked变化发布新快照，不变的重复值保持原快照', () => {
  const { registry, state } = fixture(), owner = {}, run = vi.fn();
  registry.update('app', owner, { active: true, contextKey: 'same', handlers: { 'focus-mode': { enabled: true, checked: false, run } } });
  const first = registry.getSnapshot();
  registry.update('app', owner, { active: true, contextKey: 'same', handlers: { 'focus-mode': { enabled: true, checked: true, run } } });
  expect(registry.getSnapshot().revision).toBe(first.revision + 1); expect(state('focus-mode')).toMatchObject({ enabled: true, checked: true });
  const second = registry.getSnapshot();
  registry.update('app', owner, { active: true, contextKey: 'same', handlers: { 'focus-mode': { enabled: true, checked: true, run } } });
  expect(registry.getSnapshot()).toBe(second);
  registry.update('app', owner, { active: true, contextKey: 'same', handlers: { 'focus-mode': { enabled: false, checked: true, run } } });
  expect(state('focus-mode')).toMatchObject({ enabled: false, checked: true }); expect(registry.getSnapshot().revision).toBe(second.revision + 1);
});

it('处理器异常保持原错误且已消费的菜单不能重放，未知命令不执行', async () => {
  const { registry, event } = fixture(), failure = Error('原业务失败'), run = vi.fn(() => { throw failure; });
  registry.update('tab:q', {}, { active: true, contextKey: 'q', handlers: { execute: { enabled: true, run } } });
  const original = event('execute');
  await expect(registry.execute(original)).rejects.toBe(failure);
  expect(await registry.execute(original)).toBe(false); expect(run).toHaveBeenCalledOnce();
  expect(await registry.execute({ id: 'toString' as UiCommandId, revision: registry.getSnapshot().revision })).toBe(false);
});
