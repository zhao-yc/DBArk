import { describe, expect, it } from 'vitest';
import { sidebarHarness } from '../helpers/sidebarComponentHarness';
import { beginSidebarConnectionEnd, sidebarConnectionEnd, SidebarNodeRequests } from '../../src/renderer/sidebarNodeRequests';

const status = { connectionId: 101, dialect: 'mysql' as const, version: '8.4.11' };
const objects = (name: string) => [{ name, kind: 'table' }];

describe('结构刷新对同步请求门的接管边界', () => {
  it('普通加载仍去重，明确接管使旧结果与旧finally失去归属', () => {
    const requests = new SidebarNodeRequests(() => 0), old = requests.begin('load')!;
    expect(requests.begin('load')).toBeUndefined(); const next = requests.begin('load', true)!; expect(next).toBeDefined();
    expect(requests.current(old)).toBe(false); expect(requests.finish(old)).toBe(false); expect(requests.current(next)).toBe(true); expect(requests.finish(next)).toBe(true);
  });
  it.each(['disconnect', 'remove'] as const)('接管不能跳过当前%s或把它伪装成完成', kind => {
    const requests = new SidebarNodeRequests(() => 0), ending = requests.begin(kind)!;
    expect(requests.begin('load', true)).toBeUndefined(); expect(requests.kind).toBe(kind); expect(requests.current(ending)).toBe(true); expect(requests.finish(ending)).toBe(true);
  });
  it('接管不能借新连接修订或activate恢复旧请求，卸载也不放行', () => {
    let revision = 0; const requests = new SidebarNodeRequests(() => revision), old = requests.begin('load')!;
    requests.dispose(); expect(requests.begin('load', true)).toBeUndefined(); requests.activate(); expect(requests.current(old)).toBe(false);
    const next = requests.begin('load', true)!; expect(next).toBeDefined(); revision++; expect(requests.begin('load', true)).toBeUndefined(); expect(requests.finish(next)).toBe(false);
  });
});
/** 经实际生产按钮启动并完成连接与目录两次IPC，不直接设置展开状态。 */
async function connected(f: Awaited<ReturnType<typeof sidebarHarness>>) { const node = f.create('connection'); node.click(); await f.settle(0, status); await f.settle(1, ['测试库']); return node; }

describe('Sidebar原四场景的严格负例', () => {
  it('连接刷新后明确折叠，旧建连结果不能继续列库或重开节点', async () => {
    const f = await sidebarHarness(), node = await connected(f); node.click(node.button('刷新连接')); node.click(); const writes = node.writes;
    await f.settle(2, status); expect(f.calls.map(call => call.command)).toEqual(['connections.open', 'metadata.databases', 'connections.open']); expect(node.expanded()).toBe(false); expect(node.busy()).toBe(false); expect(node.writes).toBe(writes); f.dispose();
  });
  it('数据库刷新后明确折叠，旧目录和finally不能重新展开或释放新请求busy', async () => {
    const f = await sidebarHarness(), node = f.create('database'); node.click(); await f.settle(0, objects('原表')); node.click(node.button('刷新对象')); node.click(); node.click();
    expect(node.busy()).toBe(true); const writes = node.writes; await f.settle(1, objects('旧表')); expect(node.writes).toBe(writes); expect(node.busy()).toBe(true); expect(node.expanded()).toBe(false);
    await f.settle(2, objects('新表')); expect(node.objects()).toEqual(['新表']); expect(node.expanded()).toBe(true); expect(node.busy()).toBe(false); f.dispose();
  });
  it('数据库同轮重复刷新只发一次，旧代次后到不能覆盖新目录', async () => {
    const f = await sidebarHarness(), node = f.create('database'); const refresh = node.button('刷新对象'); refresh.props.onClick(); refresh.props.onClick(); node.render(); expect(f.calls).toHaveLength(1); expect(node.button('刷新对象').props.disabled).toBe(true);
    node.click(); node.click(); await f.settle(1, objects('新表')); await f.settle(0, objects('旧表')); expect(node.objects()).toEqual(['新表']); expect(node.busy()).toBe(false); f.dispose();
  });
  it('连接同轮重复加载只发一次；旧finally不能提前清除新建连busy', async () => {
    const f = await sidebarHarness(), node = f.create('connection'), refresh = node.button('刷新连接'); refresh.props.onClick(); refresh.props.onClick(); node.render(); expect(f.calls).toHaveLength(1);
    node.click(); node.click(); expect(f.calls).toHaveLength(2); const writes = node.writes; await f.settle(0, status); expect(node.writes).toBe(writes); expect(node.busy()).toBe(true); expect(f.calls).toHaveLength(2);
    await f.settle(1, status); await f.settle(2, ['测试库']); expect(node.expanded()).toBe(true); expect(node.busy()).toBe(false); f.dispose();
  });
});

describe('节点代次、错误事实与共享连接', () => {
  it.each(['connection', 'database'] as const)('%s卸载后旧成功不能写状态或发下一步；重新挂载独立加载', async kind => {
    const f = await sidebarHarness(), old = f.create(kind); old.click(); old.unmount(); const writes = old.writes, current = f.create(kind); current.click();
    await f.settle(0, kind === 'connection' ? status : objects('旧表')); expect(old.writes).toBe(writes); expect(current.busy()).toBe(true); expect(f.calls).toHaveLength(2);
    await f.settle(1, kind === 'connection' ? status : objects('新表')); if (kind === 'connection') await f.settle(2, ['测试库']); expect(current.expanded()).toBe(true); if (kind === 'database') expect(current.objects()).toEqual(['新表']); expect(f.calls.some(call => call.command === 'connections.close')).toBe(false); f.dispose();
  });
  it.each(['connection', 'database'] as const)('%s连接版本变化后旧结果和finally均失效', async kind => {
    const f = await sidebarHarness(), node = f.create(kind); node.click(); f.state.connectionVersions.c++; const writes = node.writes;
    await f.settle(0, kind === 'connection' ? status : objects('旧表')); expect(node.writes).toBe(writes); expect(node.expanded()).toBe(false); expect(f.calls).toHaveLength(1); if (kind === 'connection') expect(f.facts.get('c', 0)).toBeUndefined(); f.dispose();
  });
  it('连接目录等待中版本变化也不能写目录或清busy', async () => {
    const f = await sidebarHarness(), node = f.create('connection'); node.click(); await f.settle(0, status); f.state.connectionVersions.c++; const writes = node.writes; await f.settle(1, ['旧库']); expect(node.writes).toBe(writes); expect(node.expanded()).toBe(false); f.dispose();
  });
  it('连接旧目录后到不能替换新目录，旧finally也不能触碰已完成新节点', async () => {
    const f = await sidebarHarness(), node = await connected(f); node.click(node.button('刷新连接')); await f.settle(2, status); node.click(); node.click(); await f.settle(4, status); await f.settle(5, ['新库']); const writes = node.writes;
    await f.settle(3, ['旧库']); expect(node.writes).toBe(writes); expect(node.expanded()).toBe(true); expect(node.busy()).toBe(false); const names = node.all(value => typeof value.type === 'function').map(value => value.props.database).filter(Boolean); expect(names).toEqual(['新库']); f.dispose();
  });
  it.each(['connection', 'database'] as const)('%s迟到失败仍报告真实后端错误，不变成成功或取消', async kind => {
    const f = await sidebarHarness(), node = f.create(kind); node.click(); node.click(); const writes = node.writes; await f.settle(0, Error('原后端取消收尾失败'), true); expect(f.notices).toEqual(['Error: 原后端取消收尾失败']); expect(node.writes).toBe(writes); expect(node.expanded()).toBe(false); f.dispose();
  });
  it('目录权限失败不否认已完成建连事实，当前busy正常结束', async () => {
    const f = await sidebarHarness(), node = f.create('connection'); node.click(); await f.settle(0, status); await f.settle(1, Error('目录权限不足'), true); expect(f.notices).toEqual(['Error: 目录权限不足']); expect(f.facts.get('c', 0)?.version).toBe(status.version); expect(node.busy()).toBe(false); f.dispose();
  });
  it.each([false, true])('显式断开撤销刷新，收尾失败=%s时仍保留错误且只关闭一次', async failed => {
    const f = await sidebarHarness(), node = await connected(f); node.click(node.button('刷新连接')); node.click(node.button('断开连接')); const writes = node.writes;
    await f.settle(2, status); expect(node.writes).toBe(writes); expect(f.calls.map(call => call.command)).toEqual(['connections.open', 'metadata.databases', 'connections.open', 'connections.close']); expect(node.busy()).toBe(true);
    await f.settle(3, failed ? Error('真实取消失败') : undefined, failed); expect(node.busy()).toBe(false); expect(node.expanded()).toBe(failed); expect(f.notices).toEqual(failed ? ['Error: 真实取消失败'] : []); expect(f.facts.get('c', 0)).toBeUndefined(); f.dispose();
  });
  it.each([false, true])('旧节点断开在途后重挂载，新加载等待实际结束且不补发close，失败=%s', async failed => {
    const f = await sidebarHarness(), old = await connected(f); old.click(old.button('断开连接')); old.unmount(); f.state.connectionVersions.c++; const current = f.create('connection'); current.click(); await f.flush(); expect(f.calls).toHaveLength(3); expect(current.busy()).toBe(true); const writes = old.writes;
    await f.settle(2, failed ? Error('旧断开收尾失败') : undefined, failed); expect(old.writes).toBe(writes); expect(f.calls[3].command).toBe('connections.open'); await f.settle(3, status); await f.settle(4, ['测试库']); expect(current.expanded()).toBe(true); expect(f.calls.filter(call => call.command === 'connections.close')).toHaveLength(1); expect(f.facts.get('c', 1)?.version).toBe(status.version); expect(f.notices).toEqual(failed ? ['Error: 旧断开收尾失败'] : []); f.dispose();
  });
  it('旧加载的失败不能清除新节点已完成的事实', async () => {
    const f = await sidebarHarness(), old = f.create('connection'); old.click(); old.unmount(); const current = f.create('connection'); current.click(); await f.settle(1, status); await f.settle(2, ['测试库']); await f.settle(0, Error('旧建连失败'), true); expect(f.facts.get('c', 0)?.version).toBe(status.version); expect(current.expanded()).toBe(true); f.dispose();
  });
  it.each([false, true])('旧节点断开finally不清除新连接事实，失败=%s', async failed => {
    const f = await sidebarHarness(), old = await connected(f); old.click(old.button('断开连接')); old.unmount(); f.state.connectionVersions.c++; const ticket = f.facts.begin('c', 1); f.facts.complete(ticket, { ...status, version: '新连接事实' });
    await f.settle(2, failed ? Error('原取消错误') : undefined, failed); expect(f.facts.get('c', 1)?.version).toBe('新连接事实'); expect(f.calls.filter(call => call.command === 'connections.close')).toHaveLength(1); f.dispose();
  });
  it('重挂载加载等待旧断开期间明确折叠，不在屏障结束后重放建连', async () => {
    const f = await sidebarHarness(), old = await connected(f); old.click(old.button('断开连接')); old.unmount(); const next = f.create('connection'); next.click(); next.click(); expect(next.busy()).toBe(false); await f.settle(2, undefined); expect(f.calls).toHaveLength(3); expect(next.expanded()).toBe(false); f.dispose();
  });
  it('前一结束屏障被新明确动作接续时，加载继续等待当前屏障', async () => {
    const f = await sidebarHarness(), first = f.beginEnd('c')!; let second: ReturnType<typeof f.beginEnd>;
    void first.done.then(() => { second = f.beginEnd('c'); }); const node = f.create('connection'); node.click(); first.release(); await f.flush(); expect(second).toBeDefined(); expect(f.calls).toHaveLength(0); expect(node.busy()).toBe(true);
    second!.release(); await f.flush(); expect(f.calls.map(call => call.command)).toEqual(['connections.open']); await f.settle(0, status); await f.settle(1, ['测试库']); expect(node.expanded()).toBe(true); f.dispose();
  });
});

describe('同步门独立约束', () => {
  it('重复请求、折叠后的旧finish、版本变更和严格模式重新挂载均不能复活旧代次', () => {
    let revision = 0; const gate = new SidebarNodeRequests(() => revision), old = gate.begin('load')!; expect(gate.begin('load')).toBeUndefined(); expect(gate.collapse()).toBe(true); const next = gate.begin('load')!; expect(gate.finish(old)).toBe(false); expect(gate.current(next)).toBe(true); gate.dispose(); gate.activate(); expect(gate.current(next)).toBe(false); const current = gate.begin('load')!; revision++; expect(gate.current(current)).toBe(false); expect(gate.finish(current)).toBe(false); expect(gate.begin('load')).toBeUndefined();
  });
  it('结束操作不可被折叠或重复加载取代，结束屏障按连接ID独立且只释放自身', async () => {
    const gate = new SidebarNodeRequests(() => 0), request = gate.begin('disconnect')!; expect(gate.collapse()).toBe(false); expect(gate.begin('load')).toBeUndefined(); expect(gate.begin('remove')).toBeUndefined(); expect(gate.finish(request)).toBe(true);
    const lease = beginSidebarConnectionEnd('unit-sidebar-c')!; expect(beginSidebarConnectionEnd('unit-sidebar-c')).toBeUndefined(); expect(sidebarConnectionEnd('other')).toBeUndefined(); const done = sidebarConnectionEnd('unit-sidebar-c')!; lease.release(); await done; const next = beginSidebarConnectionEnd('unit-sidebar-c')!; lease.release(); expect(sidebarConnectionEnd('unit-sidebar-c')).toBe(next.done); next.release(); expect(sidebarConnectionEnd('unit-sidebar-c')).toBeUndefined();
  });
});
