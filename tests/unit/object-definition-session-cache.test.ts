import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';

/** 直接提取正式父页的缓存同步回调，不复写产品分支；端口没有SQL执行、重连或历史能力。 */
function fixture() {
  const text = readFileSync('src/renderer/components/QueryTab.tsx','utf8'), tree = ts.createSourceFile('QueryTab.tsx',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX), matches: ts.ArrowFunction[] = [];
  function walk(node: ts.Node) { if (ts.isPropertyAssignment(node) && node.name.getText(tree) === 'settled' && ts.isArrowFunction(node.initializer)) matches.push(node.initializer); ts.forEachChild(node,walk); } walk(tree); expect(matches).toHaveLength(1);
  const status = { transactionOpen: true, transactionKnown: false, broken: false }, cached = { databaseKnown: false, broken: false, busy: false, dialect: 'mysql' as const };
  let resolve!: () => void; const barrier = new Promise<void>(yes => { resolve = yes; });
  const intent = { current: vi.fn(() => true) }, workspace = { settings: { tabs: [{ id: 'queryA',connectionId: 'connectionA' }] }, connections: [{ id: 'connectionA' }], connectionVersions: { connectionA: 7 }, setDirty: vi.fn() };
  const ports = { originalSession: 'sessionA', alive: { current: true }, objectDefinitionRef: { current: intent }, intent, sessionRef: { current: 'sessionA' }, tab: { id: 'queryA' }, profile: { id: 'connectionA' }, connectionVersion: 7, busyRef: { current: false }, useWorkspace: { getState: () => workspace },
    invoke: vi.fn(async (command: string, input: { sessionId: string }) => { expect(input).toEqual({ sessionId: 'sessionA' }); await barrier; if (command === 'query.sessionState') return status; if (command === 'query.completionState') return cached; throw Error('禁止其它操作'); }), setCompletionSession: vi.fn(), setTransaction: vi.fn(), setTransactionKnown: vi.fn() };
  const script = ts.transpileModule('return ('+matches[0].getText(tree)+');',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  const synchronize = new Function(...Object.keys(ports),script)(...Object.values(ports)) as () => Promise<void>;
  return { synchronize, ports, workspace, status, cached, resolve };
}
it('只读取原会话两份协议缓存，将未知状态反映到原标签，不假称提交或回滚', async () => {
  const f = fixture(), work = f.synchronize(); expect(f.ports.invoke).toHaveBeenCalledTimes(2); f.resolve(); await work;
  expect(f.ports.setCompletionSession).toHaveBeenCalledExactlyOnceWith(f.cached); expect(f.ports.setTransaction).toHaveBeenCalledExactlyOnceWith(true); expect(f.ports.setTransactionKnown).toHaveBeenCalledExactlyOnceWith(false); expect(f.workspace.setDirty).toHaveBeenCalledExactlyOnceWith('queryA',true);
});
it.each(['session','revision','target','source','busy','unmount'] as const)('等待期间%s变化后不更新继任标签或会话', async mode => {
  const f = fixture(), work = f.synchronize();
  if (mode === 'session') f.ports.sessionRef.current = 'sessionB'; if (mode === 'revision') f.workspace.connectionVersions.connectionA = 8; if (mode === 'target') f.workspace.settings.tabs[0].connectionId = 'connectionB'; if (mode === 'source') f.ports.intent.current.mockReturnValue(false); if (mode === 'busy') f.ports.busyRef.current = true; if (mode === 'unmount') f.ports.alive.current = false;
  f.resolve(); await work; expect(f.ports.setCompletionSession).not.toHaveBeenCalled(); expect(f.ports.setTransaction).not.toHaveBeenCalled(); expect(f.ports.setTransactionKnown).not.toHaveBeenCalled(); expect(f.workspace.setDirty).not.toHaveBeenCalled();
});
