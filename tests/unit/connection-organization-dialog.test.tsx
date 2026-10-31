import { assertNetworkProfile } from '../helpers/assertNetworkProfile';
import { act, StrictMode } from 'react';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import type { NetworkConnectionProfile as ConnectionProfile } from '../../src/shared/contracts';
import { connectionOrganizationApplySchema, connectionOrganizationDefaultColor, connectionOrganizationGetSchema, type ConnectionOrganizationSnapshot } from '../../src/shared/connectionOrganization';
import { connectionOrganizationZh as text } from '../../src/shared/connectionOrganization.zh-CN';
import { ConnectionOrganizationDialog } from '../../src/renderer/components/ConnectionOrganizationDialog';
import { memoryDocument, MemoryEvent } from '../fixtures/memory-dom';

let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
let useWorkspace: typeof import('../../src/renderer/store')['useWorkspace'];
const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
beforeAll(async () => {
  document = memoryDocument(); (document as any).oninput = null; const create = document.createElement.bind(document);
  document.createElement = name => {
    const node = create(name);
    if (name === 'input') { let kind = 'text'; Object.defineProperty(node, 'type', { configurable: true, get: () => kind, set: value => { kind = value; node.attributes.set('type', value); } }); }
    const set = node.setAttribute.bind(node), remove = node.removeAttribute.bind(node);
    node.setAttribute = (key, value) => { set(key.toLowerCase(), value); if (key === 'disabled') node.disabled = true; };
    node.removeAttribute = key => { remove(key.toLowerCase()); if (key === 'disabled') node.disabled = false; }; return node;
  };
  ({ createRoot } = await import('react-dom/client')); ({ useWorkspace } = await import('../../src/renderer/store'));
});
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.textContent = ''; delete (window as any).dbark; vi.restoreAllMocks(); });
afterAll(() => { for (const [name, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });

/** 公开概要含真实认证存在标记和transport结构，界面从不获得秘密明文。 */
function fixture(count = 3): ConnectionOrganizationSnapshot {
  const connections: ConnectionProfile[] = Array.from({ length: count }, (_, index) => ({ id: `c${index}`, name: index === 0 ? '第一连接' : index === 1 ? '第二连接' : `连接${index}`, group: index === 0 ? '' : index === 1 ? '未分组' : '原分组', color: index % 2 ? '#123456' : '#abcdef', dialect: 'mysql', host: `offline-${index}.invalid`, port: 3306, user: '公开用户名', hasPassword: true, rememberPassword: true, ssh: { enabled: true, host: '公开跳板', port: 22, user: 'ssh-user', privateKeyPath: 'C:/公开路径/key', hasPassword: true, hasPassphrase: true }, tls: { enabled: true, rejectUnauthorized: true, caPath: 'C:/公开路径/ca', hasPassphrase: true } }));
  return { revision: 7, connections };
}
/** 仅替代本地IPC边界；实际组件、完整共享apply校验和父层连接更新均运行。 */
async function mount(options: { source?: ConnectionOrganizationSnapshot; strict?: boolean; get?: (count: number) => Promise<unknown>; apply?: (input: unknown) => Promise<unknown> } = {}) {
  let server = structuredClone(options.source ?? fixture()), gets = 0;
  const tabs = [{ id: 'q', kind: 'query' as const, connectionId: 'c0', title: '已有查询', sql: '不应执行', sessionId: '保持会话' }], versions = { c0: 4 }, activeJobs = { q: true }, selection = { connectionId: 'c0', database: 'db' };
  useWorkspace.setState({ connections: structuredClone(server.connections), connectionVersions: versions, settings: { ...useWorkspace.getState().settings, tabs, activeTabId: 'q' }, activeJobs, selection });
  const invoke = vi.fn(async (command: string, input: any): Promise<any> => {
    if (command === 'connections.organizationGet') { connectionOrganizationGetSchema.parse(input); gets++; return options.get ? options.get(gets) : structuredClone(server); }
    if (command === 'connections.organizationApply') {
      const checked = connectionOrganizationApplySchema.parse(input); if (options.apply) return options.apply(checked);
      if (checked.expectedRevision !== server.revision) throw Error(text.stale);
      const ids = new Set(checked.ids); server = { revision: server.revision + 1, connections: server.connections.map(assertNetworkProfile).map(connection => ids.has(connection.id) ? { ...connection, ...(checked.changes.group === undefined ? {} : { group: checked.changes.group }), ...(checked.changes.color === undefined ? {} : { color: checked.changes.color ?? connectionOrganizationDefaultColor }) } : connection) };
      return structuredClone(server);
    }
    throw Error('禁止外界或会话命令：' + command);
  });
  (window as any).dbark = { invoke }; const onClose = vi.fn(), onApplied = vi.fn((next: ConnectionOrganizationSnapshot) => useWorkspace.getState().setConnections(next.connections));
  const host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host as any);
  const element = <ConnectionOrganizationDialog onClose={onClose} onApplied={onApplied}/>;
  await act(async () => root!.render(options.strict ? <StrictMode>{element}</StrictMode> : element));
  return { invoke, onClose, onApplied, tabs, versions, activeJobs, selection, source: options.source, requests: (command: string) => invoke.mock.calls.filter(call => call[0] === command),
    server: () => server, replace: (next: ConnectionOrganizationSnapshot) => { server = structuredClone(next); } };
}
function node(label: string) { const value = document.querySelector(`[aria-label="${label}"]`); expect(value, label).not.toBeNull(); return value!; }
function button(label: string, parent = document as ReturnType<typeof document.createElement>) { const value = parent.querySelectorAll('button').find(item => item.textContent === label); expect(value, label).toBeDefined(); return value!; }
/** 只重放真实React事件闭包，不替代预览代次、勾选或提交逻辑。 */
function props(value: ReturnType<typeof node>) { const key = Object.keys(value).find(key => key.startsWith('__reactProps$')); if (!key) throw Error('缺少真实React事件'); return (value as any)[key]; }
async function click(label: string, parent?: ReturnType<typeof document.createElement>) { const value = button(label, parent); expect(value.disabled, label).toBe(false); await act(async () => value.dispatchEvent(new MemoryEvent('click'))); }
async function input(label: string, value: string) { const element = node(label); expect(element.disabled, label).toBe(false); await act(async () => { element.value = value; element.dispatchEvent(new MemoryEvent('input')); }); }
async function check(label: string, checked = true) { const element = node(label); expect(element.disabled, label).toBe(false); await act(async () => props(element).onChange({ target: { checked } })); }
async function group(value: string) { await check(text.editGroup); await input(text.group, value); }
async function ready() { await check(text.select('c0')); await group('目标分组'); await click(text.preview); }
function preview() { return document.querySelector(`[aria-label="${text.previewTitle}"]`); }
function deferred() { let resolve!: (value: unknown) => void, reject!: (reason: Error) => void; const promise = new Promise<unknown>((ok, fail) => { resolve = ok; reject = fail; }); return { promise, resolve, reject }; }

it('挂载只读概要，默认不启用任何修改项目，必须明确勾选与预览才可提交', async () => {
  const f = await mount(); expect(f.invoke.mock.calls.map(call => call[0])).toEqual(['connections.organizationGet']); expect(node(text.title).getAttribute('role')).toBe('dialog');
  expect(node(text.editGroup).checked).toBe(false); expect(node(text.editColor).checked).toBe(false); expect(node(text.group).disabled).toBe(true); expect(node(text.color).disabled).toBe(true); expect(button(text.preview).disabled).toBe(true); expect(button(text.startApply).disabled).toBe(true);
  await check(text.select('c0')); expect(button(text.preview).disabled).toBe(true); expect(f.onApplied).not.toHaveBeenCalled();
});

it('空分组与字面名为未分组的真实分组明确区分，空字符串按原值提交', async () => {
  const f = await mount(); const rows = node(text.list).querySelectorAll('tbody')[0].querySelectorAll('tr');
  expect(rows[0].textContent).toContain(text.groupDisplay('')); expect(rows[1].textContent).toContain(text.groupDisplay('未分组')); expect(text.groupDisplay('')).not.toBe(text.groupDisplay('未分组'));
  await check(text.select('c1')); await group(''); await click(text.preview); expect(node(text.previewRow('c1')).querySelectorAll('td').map(value => value.textContent).slice(1, 3)).toEqual([text.groupDisplay('未分组'), text.groupDisplay('')]);
  await click(text.startApply); expect(f.requests('connections.organizationApply')[0][1]).toEqual({ expectedRevision: 7, ids: ['c1'], changes: { group: '' } });
});

it('搜索隐藏的选择仍进入完整预览与提交，搜索未分组只匹配实际原文分组', async () => {
  const f = await mount(); await check(text.select('c0')); await input(text.search, '第二'); await click(text.visibleSelect); expect(document.body.textContent).toContain(text.selectedSummary(2, 3));
  await group(' 新组 '); await click(text.preview); expect(preview()!.querySelectorAll('tbody')[0].querySelectorAll('tr')).toHaveLength(2); expect(node(text.previewRow('c0')).textContent).toContain('第一连接');
  await click(text.startApply); expect(f.requests('connections.organizationApply')[0][1]).toEqual({ expectedRevision: 7, ids: ['c0', 'c1'], changes: { group: ' 新组 ' } });
});

it('搜索未分组不混淆空分组，清空勾选包含全部隐藏选择', async () => {
  await mount(); await check(text.select('c0')); await input(text.search, '未分组'); expect(node(text.list).querySelectorAll('tbody')[0].querySelectorAll('tr')).toHaveLength(1); expect(node(text.select('c1'))).toBeDefined();
  await click(text.visibleSelect); await click(text.clearAll); expect(document.body.textContent).toContain(text.selectedSummary(0, 3)); await input(text.search, ''); expect(node(text.select('c0')).checked).toBe(false); expect(node(text.select('c1')).checked).toBe(false);
});

it('分组与颜色分别显式修改，重置颜色提交null而非覆盖transport或全部profile', async () => {
  const f = await mount(); await check(text.select('c0')); await check(text.editColor); await check(text.resetColor); await click(text.preview);
  expect(node(text.previewRow('c0')).querySelectorAll('td').map(value => value.textContent)).toEqual(['第一连接', text.groupDisplay(''), text.groupDisplay(''), '#abcdef', connectionOrganizationDefaultColor]);
  await click(text.startApply); expect(f.requests('connections.organizationApply')[0][1]).toEqual({ expectedRevision: 7, ids: ['c0'], changes: { color: null } });
  expect(f.server().connections.map(assertNetworkProfile)[0].ssh).toEqual(f.server().connections.map(assertNetworkProfile)[1].ssh); expect(f.server().connections.map(assertNetworkProfile)[0].group).toBe('');
});

it('成功只发布完整公开快照，父层更新连接后原版本标签busy选择和会话相关对象保持', async () => {
  const f = await mount(); await ready(); await click(text.startApply); expect(f.onApplied).toHaveBeenCalledOnce();
  const next = f.onApplied.mock.calls[0][0]; expect(next.revision).toBe(8); expect(next.connections.map(assertNetworkProfile)[0].group).toBe('目标分组'); expect(next.connections.map(assertNetworkProfile)[0].ssh?.hasPassphrase).toBe(true); expect(next.connections.map(assertNetworkProfile)[0].tls?.hasPassphrase).toBe(true);
  expect(useWorkspace.getState().connections).toBe(next.connections); expect(useWorkspace.getState().connectionVersions).toBe(f.versions); expect(useWorkspace.getState().settings.tabs).toBe(f.tabs); expect(useWorkspace.getState().activeJobs).toBe(f.activeJobs); expect(useWorkspace.getState().selection).toBe(f.selection);
  expect(f.invoke.mock.calls.map(call => call[0])).toEqual(['connections.organizationGet', 'connections.organizationApply']); expect(f.onClose).not.toHaveBeenCalled(); expect(button(text.startApply).disabled).toBe(true);
});

it('所有被选择名称与目标可分页查看，列表及预览各最多50行，不一次堆1000个DOM', async () => {
  await mount({ source: fixture(121) }); expect(node(text.list).querySelectorAll('tbody')[0].querySelectorAll('tr')).toHaveLength(50); await click(text.visibleSelect); await click(text.next); await click(text.visibleSelect); await click(text.next); await click(text.visibleSelect);
  expect(document.body.textContent).toContain(text.selectedSummary(121, 121)); await group('统一'); await click(text.preview); expect(preview()!.querySelectorAll('tbody')[0].querySelectorAll('tr')).toHaveLength(50);
  await click(text.next, preview()!); expect(node(text.previewRow('c50'))).toBeDefined(); await click(text.next, preview()!); expect(preview()!.querySelectorAll('tbody')[0].querySelectorAll('tr')).toHaveLength(21); expect(node(text.previewRow('c120')).textContent).toContain('统一');
  expect(document.querySelectorAll('tbody').reduce((sum, body) => sum + body.querySelectorAll('tr').length, 0)).toBeLessThanOrEqual(100);
});

it('单次1000上限完整拒绝第1001项，不部分勾选或截断已有选择', async () => {
  await mount({ source: fixture(1001) }); for (let page = 0; page < 20; page++) { await click(text.visibleSelect); await click(text.next); }
  expect(document.body.textContent).toContain(text.selectedSummary(1000, 1001)); await click(text.visibleSelect); expect(document.body.textContent).toContain(text.limit); expect(node(text.select('c1000')).checked).toBe(false);
  await group('千项'); await click(text.preview); expect(preview()!.textContent).toContain(text.selectedSummary(1000, 1001));
});

it.each(['draft', 'selection', 'search', 'refresh'] as const)('%s变化立即撤销预览，旧确认闭包不能借恢复原值ABA继续提交', async kind => {
  const f = await mount(); await ready(); const old = props(button(text.startApply)).onClick;
  if (kind === 'draft') { await input(text.group, '另一组'); await input(text.group, '目标分组'); }
  if (kind === 'selection') { await check(text.select('c0'), false); await check(text.select('c0')); }
  if (kind === 'search') { await input(text.search, '第二'); await input(text.search, ''); }
  if (kind === 'refresh') await click(text.refresh);
  expect(preview()).toBeNull(); await click(text.preview); await act(async () => old()); expect(f.requests('connections.organizationApply')).toHaveLength(0); await click(text.startApply); expect(f.requests('connections.organizationApply')).toHaveLength(1);
});

it('关闭读取等待立即撤销owner，迟到Get不能发布也不更新父层', async () => {
  const held = deferred(), f = await mount({ get: () => held.promise }); await click(text.close); await act(async () => held.resolve(fixture()));
  expect(f.onClose).toHaveBeenCalledOnce(); expect(f.onApplied).not.toHaveBeenCalled(); expect(node(text.list).querySelectorAll('tbody')[0].querySelectorAll('tr')).toHaveLength(0);
});

it('StrictMode旧Get迟到不能覆盖新owner已读取列表', async () => {
  const first = deferred(), second = deferred(), f = await mount({ strict: true, get: count => count === 1 ? first.promise : second.promise }); expect(f.requests('connections.organizationGet')).toHaveLength(2);
  const newer = fixture(); newer.revision = 9; newer.connections.map(assertNetworkProfile)[0].name = '新owner名称'; await act(async () => second.resolve(newer)); expect(document.body.textContent).toContain('新owner名称');
  const older = fixture(); older.connections.map(assertNetworkProfile)[0].name = '旧owner名称'; await act(async () => first.resolve(older)); expect(document.body.textContent).not.toContain('旧owner名称'); await ready(); await click(text.startApply); expect(f.requests('connections.organizationApply')[0][1].expectedRevision).toBe(9);
});

it('CAS失败不自动重放，必须刷新并按新revision重新预览', async () => {
  const f = await mount(); await ready(); const next = fixture(); next.revision = 10; f.replace(next); await click(text.startApply);
  expect(f.requests('connections.organizationApply')).toHaveLength(1); expect(f.onApplied).not.toHaveBeenCalled(); expect(document.body.textContent).toContain(text.refreshNeeded); expect(button(text.preview).disabled).toBe(true);
  await click(text.refresh); expect(preview()).toBeNull(); await click(text.preview); await click(text.startApply); expect(f.requests('connections.organizationApply')).toHaveLength(2); expect(f.requests('connections.organizationApply')[1][1].expectedRevision).toBe(10);
});

it('未知写结果失败同样撤销预览并锁刷新，旧回调不能重放写入', async () => {
  const f = await mount({ apply: async () => { throw Error('写入结果未知'); } }); await ready(); const old = props(button(text.startApply)).onClick; await click(text.startApply); await act(async () => old());
  expect(f.requests('connections.organizationApply')).toHaveLength(1); expect(document.body.textContent).toContain('写入结果未知'); expect(button(text.preview).disabled).toBe(true); expect(f.onApplied).not.toHaveBeenCalled();
});

it('写pending禁用关闭及所有草稿，旧输入与双击确认不能追加写或清锁', async () => {
  const held = deferred(), f = await mount({ apply: () => held.promise }); await ready(); const oldApply = props(button(text.startApply)).onClick, oldGroup = props(node(text.group)).onChange, oldClose = props(button(text.close)).onClick;
  await click(text.startApply); expect(button(text.close).disabled).toBe(true); expect(node(text.group).disabled).toBe(true); await act(async () => { oldApply(); oldGroup({ target: { value: '误改' } }); oldClose(); }); expect(f.onClose).not.toHaveBeenCalled(); expect(f.requests('connections.organizationApply')).toHaveLength(1);
  const next = fixture(); next.revision = 8; next.connections.map(assertNetworkProfile)[0].group = '目标分组'; await act(async () => held.resolve(next)); expect(f.onApplied).toHaveBeenCalledOnce(); expect(node(text.group).value).toBe('目标分组'); expect(button(text.close).disabled).toBe(false);
});

it('卸载后写结果迟到不发布父快照、不调关闭，也不再重放请求', async () => {
  const held = deferred(), f = await mount({ apply: () => held.promise }); await ready(); await click(text.startApply); await act(async () => root!.unmount()); root = undefined;
  const next = fixture(); next.revision = 8; await act(async () => held.resolve(next)); expect(f.onApplied).not.toHaveBeenCalled(); expect(f.onClose).not.toHaveBeenCalled(); expect(f.requests('connections.organizationApply')).toHaveLength(1);
});

it('刷新保留仍存在的隐藏选择，明确提示移除已删除目标，不使用旧预览', async () => {
  const f = await mount(); await check(text.select('c0')); await check(text.select('c1')); await input(text.search, '连接2'); const next = fixture(); next.revision = 8; next.connections = next.connections.map(assertNetworkProfile).filter(connection => connection.id !== 'c1'); f.replace(next); await click(text.refresh);
  expect(document.body.textContent).toContain(text.selectionRemoved(1)); expect(document.body.textContent).toContain(text.selectedSummary(1, 2)); await group('刷新后'); await click(text.preview); expect(node(text.previewRow('c0'))).toBeDefined();
});

it('非法分组和颜色不能产生预览，保留输入且不发送任何整理请求', async () => {
  const f = await mount(); await check(text.select('c0')); await group('坏\u0001分组'); await click(text.preview); expect(preview()).toBeNull(); expect(f.requests('connections.organizationApply')).toHaveLength(0);
  await input(text.group, '合法'); await check(text.editColor); await act(async () => props(node(text.color)).onChange({ target: { value: 'red' } })); await click(text.preview); expect(preview()).toBeNull(); expect(document.body.textContent).toContain(text.colorInvalid);
});

it('已消费事件不勾选或改草稿，取消修改项后旧字段事件不能重新启用', async () => {
  await mount(); await act(async () => props(node(text.select('c0'))).onChange({ defaultPrevented: true, target: { checked: true } })); expect(node(text.select('c0')).checked).toBe(false);
  await ready(); const old = props(node(text.group)).onChange; await check(text.editGroup, false); await act(async () => old({ target: { value: '旧回调' } })); expect(node(text.group).value).toBe('目标分组'); expect(button(text.preview).disabled).toBe(true); expect(preview()).toBeNull();
});

it('公开概要的认证存在标记保留，回包和apply均无秘密明文或认证写入字段', async () => {
  const f = await mount(); await ready(); await click(text.startApply); const applied = f.onApplied.mock.calls[0][0]; expect(JSON.stringify(applied)).not.toMatch(/"password"|"passphrase"/); expect(JSON.stringify(f.requests('connections.organizationApply')[0][1])).not.toMatch(/ssh|tls|password|host|port|user/);
  expect(document.body.textContent).not.toContain('C:/公开路径'); expect(document.body.textContent).not.toContain('公开用户名'); expect(applied.connections.map(assertNetworkProfile)[0].hasPassword).toBe(true);
});

it('坏Get明文秘密及访问器回包完整拒绝，getter不执行也不泄漏到DOM或父层', async () => {
  const bad = fixture(), getter = vi.fn(() => '秘密'); Object.defineProperty(bad.connections.map(assertNetworkProfile)[0], 'password', { enumerable: true, get: getter }); const f = await mount({ get: async () => bad });
  expect(getter).not.toHaveBeenCalled(); expect(document.querySelector('[role="alert"]')).not.toBeNull(); expect(document.body.textContent).not.toContain('秘密'); expect(f.onApplied).not.toHaveBeenCalled(); expect(button(text.preview).disabled).toBe(true);
});
