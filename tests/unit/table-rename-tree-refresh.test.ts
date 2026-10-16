import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { sidebarHarness, type SidebarComponentRenderer } from '../helpers/sidebarComponentHarness';
import { tableRenameZh } from '../../src/renderer/locales/tableRename.zh-CN';
import { tableCommentZh } from '../../src/renderer/locales/tableComment.zh-CN';
import { tableDefaultEncodingZh } from '../../src/renderer/locales/tableDefaultEncoding.zh-CN';
import { tableAutoIncrementZh } from '../../src/renderer/locales/tableAutoIncrement.zh-CN';

const objects = (name: string) => [{ name, kind: 'table' }];
/** 真正执行App的精确数据库刷新方法，不在测试里另写刷新键规则。 */
function appRefresh() {
  const source = readFileSync(new URL('../../src/renderer/App.tsx', import.meta.url), 'utf8'), tree = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let method: ts.FunctionDeclaration | undefined;
  const visit = (node: ts.Node) => { if (ts.isFunctionDeclaration(node) && node.name?.text === 'refreshRenameDatabase') method = node; ts.forEachChild(node, visit); }; visit(tree);
  if (!method) throw Error('缺少实际App重命名刷新方法');
  let versions: Record<string, number> = {};
  const context = createContext({ setObjectRefreshVersions: (change: (current: typeof versions) => typeof versions) => { versions = change(versions); } });
  runInContext(ts.transpileModule(method.getText(tree) + '\nglobalThis.refresh=refreshRenameDatabase;', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { next(target = { connectionId: 'c', database: '测试库', table: 'original' }) { context.refresh(target); return versions; } };
}
/** 父子属性从完整生产JSX取出，再交给同一真实组件实例，避免手工补上漏传的接线。 */
function childProps(node: SidebarComponentRenderer, name: string) { const children = node.all(value => typeof value.type === 'function' && value.type.name === name); if (children.length !== 1) throw Error('实际父组件没有唯一子节点：' + name); return children[0].props; }
async function treeHarness() {
  const f = await sidebarHarness(), rename = vi.fn(), counter = vi.fn(), comment = vi.fn(), encoding = vi.fn(), refresh = appRefresh();
  const sidebar = f.create('sidebar', 'c', { onTableRename: rename, onTableAutoIncrement: counter, onTableComment: comment, onTableDefaultEncoding: encoding });
  const connection = f.create('connection', 'c', childProps(sidebar, 'ConnectionNode')); connection.click();
  await f.settle(0, { dialect: 'mysql', version: '8.4.11' }); await f.settle(1, ['测试库']);
  const database = f.create('database', 'c', childProps(connection, 'DatabaseNode'));
  return { ...f, database, rename, counter, comment, encoding, renamed() { sidebar.update({ objectRefreshVersions: refresh.next() }); connection.update(childProps(sidebar, 'ConnectionNode')); database.update(childProps(connection, 'DatabaseNode')); } };
}

describe('重命名与当前侧栏请求门的混合源码', () => {
  it.each([true, false])('实际App刷新接管在途目录，旧请求先完成=%s也不能覆盖新列表或清除新busy', async oldFirst => {
    const f = await treeHarness(), node = f.database; node.click(); await f.settle(2, objects('original'));
    node.click(node.button('刷新对象')); f.renamed(); expect(f.calls).toHaveLength(5); expect(node.busy()).toBe(true); expect(node.expanded()).toBe(true);
    const writes = node.writes;
    if (oldFirst) { await f.settle(3, objects('original')); expect(node.writes).toBe(writes); expect(node.busy()).toBe(true); }
    await f.settle(4, objects('renamed')); expect(node.objects()).toEqual(['renamed']); expect(node.busy()).toBe(false);
    if (!oldFirst) { const completedWrites = node.writes; await f.settle(3, objects('original')); expect(node.writes).toBe(completedWrites); expect(node.objects()).toEqual(['renamed']); }
    expect(f.calls.slice(2).map(call => [call.command, call.input])).toEqual(Array.from({ length: 3 }, () => ['metadata.objects', { connectionId: 'c', database: '测试库' }])); f.dispose();
  });
  it('折叠后重命名仍重读实际目录，但不会自动展开；后来主动展开重新读取', async () => {
    const f = await treeHarness(), node = f.database; node.click(); await f.settle(2, objects('original')); node.click();
    f.renamed(); expect(f.calls).toHaveLength(4); expect(node.expanded()).toBe(false); await f.settle(3, objects('renamed'));
    expect(node.expanded()).toBe(false); expect(node.objects()).toEqual([]); node.click(); expect(f.calls).toHaveLength(5); await f.settle(4, objects('current')); expect(node.objects()).toEqual(['current']); f.dispose();
  });
  it('重命名刷新期间明确折叠后，旧回包不能复活目录或清掉后来展开请求busy', async () => {
    const f = await treeHarness(), node = f.database; node.click(); await f.settle(2, objects('original')); f.renamed(); node.click(); node.click();
    const writes = node.writes; await f.settle(3, objects('renamed_old')); expect(node.writes).toBe(writes); expect(node.busy()).toBe(true); expect(node.expanded()).toBe(false);
    await f.settle(4, objects('current')); expect(node.objects()).toEqual(['current']); expect(node.expanded()).toBe(true); f.dispose();
  });
  it('连续重命名通知只保留最新目录请求所有权，旧错误仍如实报告但不能清busy', async () => {
    const f = await treeHarness(), node = f.database; node.click(); await f.settle(2, objects('original')); f.renamed(); f.renamed(); expect(f.calls).toHaveLength(5);
    const writes = node.writes; await f.settle(3, Error('旧目录真实读取错误'), true); expect(f.notices).toEqual(['Error: 旧目录真实读取错误']); expect(node.writes).toBe(writes); expect(node.busy()).toBe(true);
    await f.settle(4, objects('latest')); expect(node.objects()).toEqual(['latest']); f.dispose();
  });
  it('等待接续结束屏障的重命名刷新不会提前读目录，版本重挂载后只放行新节点', async () => {
    const f = await sidebarHarness(), first = f.beginEnd('c')!; let second: ReturnType<typeof f.beginEnd>;
    try {
      const old = f.create('database'); old.update({ refreshVersion: 1 }); old.update({ refreshVersion: 2 }); await f.flush(); expect(f.calls).toHaveLength(0);
      first.release(); second = f.beginEnd('c')!; await f.flush(); expect(f.calls).toHaveLength(0);
      f.state.connectionVersions.c++; old.unmount(); const writes = old.writes, current = f.create('database', 'c', { refreshVersion: 2 }); current.click(); await f.flush(); expect(f.calls).toHaveLength(0);
      second.release(); await f.flush(); expect(f.calls).toHaveLength(1); expect(f.calls[0].command).toBe('metadata.objects'); expect(old.writes).toBe(writes);
      await f.settle(0, objects('新配置目录')); expect(current.objects()).toEqual(['新配置目录']); expect(current.expanded()).toBe(true); expect(f.calls.some(call => call.command === 'connections.close')).toBe(false);
    } finally { first.release(); second?.release(); f.dispose(); }
  });
  it('旧连接版本的刷新回包和旧渲染刷新事件均无权触碰新节点', async () => {
    const f = await sidebarHarness(), old = f.create('database'); old.update({ refreshVersion: 1 }); f.state.connectionVersions.c++; old.update({ refreshVersion: 2 }); expect(f.calls).toHaveLength(1); old.unmount();
    const writes = old.writes, current = f.create('database', 'c', { refreshVersion: 2 }); current.click(); await f.settle(0, objects('旧服务器目录')); expect(old.writes).toBe(writes); expect(current.busy()).toBe(true);
    await f.settle(1, objects('新服务器目录')); expect(current.objects()).toEqual(['新服务器目录']); f.dispose();
  });
  it('卸载后重命名目录回包不写状态，新节点不会借旧刷新版本自动复活目录', async () => {
    const f = await sidebarHarness(), old = f.create('database'); old.update({ refreshVersion: 1 }); old.unmount(); const writes = old.writes, current = f.create('database', 'c', { refreshVersion: 1 });
    await f.settle(0, objects('卸载后目录')); expect(old.writes).toBe(writes); expect(current.expanded()).toBe(false); expect(current.objects()).toEqual([]); expect(f.calls).toHaveLength(1); f.dispose();
  });
  it('真实对象行同时提供重命名、自增、备注与默认编码，接线目标精确到当前表', async () => {
    const f = await treeHarness(), node = f.database; node.click(); await f.settle(2, [...objects('CaseTable'), { name: 'view_only', kind: 'view' }]);
    for (const [label, callback] of [[tableRenameZh.title, f.rename], [tableAutoIncrementZh.title, f.counter], [tableCommentZh.title, f.comment], [tableDefaultEncodingZh.title, f.encoding]] as const) { node.click(node.button(`${label} CaseTable`)); expect(callback).toHaveBeenCalledExactlyOnceWith('c', '测试库', 'CaseTable'); expect(node.all(value => value.props['aria-label'] === `${label} view_only`)).toHaveLength(0); }
    f.dispose();
  });
});
