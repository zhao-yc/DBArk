import { workspaceCommandSource } from '../helpers/workspaceCommandSource';
import React from 'react';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { QueryCloseQueue } from '../../src/renderer/queryCloseQueue';
import { QueryCloseRequests, type QueryCloseRequest } from '../../src/renderer/queryCloseIntent';
import { queryCloseZh } from '../../src/renderer/locales/queryClose.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';
import type { WorkspaceTab } from '../../src/renderer/store';

/** 编译真实App入口和关闭方法；只替换React setter、确认和RAM工作区回执，不复制关闭实现。 */
function fixture(sql = 'SELECT 原SQL;') {
  const source = readFileSync(new URL('../../src/renderer/App.tsx', import.meta.url), 'utf8'), tree = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), methods: string[] = []; const registration = workspaceCommandSource(source, 'close-other-queries');
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && ['closeTab', 'finishQueryClose', 'closeOtherQueries', 'commitQueryClose'].includes(node.name?.text ?? '')) methods.push(node.getText(tree));
    ts.forEachChild(node, visit);
  }; visit(tree); if (methods.length !== 4) throw Error('实际App关闭入口或方法缺失');
  const make = (id: string): WorkspaceTab => ({ id, kind: 'query', connectionId: 'c', title: id, sql });
  const keep = make('keep'), a = make('a'), b = make('b'), table = { ...make('table'), kind: 'table' as const }, listeners = new Set<() => void>(), requests: QueryCloseRequest[] = [];
  const notify = () => { for (const fn of [...listeners]) fn(); };
  const state = { settings: { tabs: [keep, a, table, b], activeTabId: 'keep' }, connections: [{ id: 'c' }], connectionVersions: {} as Record<string, number>, activeJobs: {} as Record<string, boolean>, dirtyTabs: {} as Record<string, boolean>, notify: vi.fn(), closeTab: vi.fn((id: string) => { state.settings.tabs = state.settings.tabs.filter(tab => tab.id !== id); notify(); }) };
  const otherQueryClose = { current: null as QueryCloseQueue | null }, confirm = vi.fn(() => false), setClosing = vi.fn(), setRequest = vi.fn((request?: QueryCloseRequest) => { if (request) requests.push(request); });
  let commit: {queue:QueryCloseQueue;request:QueryCloseRequest}|undefined;
  const context = createContext({ React, QueryCloseQueue, otherQueryClose, closeRequests: new QueryCloseRequests(), useWorkspace: { getState: () => state, subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; } }, window: { confirm }, document: { querySelector: () => null }, zh, queryCloseZh, setQueryCloseRequest: setRequest, setClosingOtherQueries: setClosing,setQueryCloseCommit:(next:typeof commit)=>{commit=next} });
  const code = methods.join('\n') + '\nglobalThis.finish=finishQueryClose;globalThis.commit=commitQueryClose;globalThis.close=closeTab;globalThis.command=(settings,activeTab,closingOtherQueries)=>{const state=useWorkspace.getState(),ready=true,queryCloseRequest=undefined;const ' + registration.available + ';const ' + registration.handler + ';return (' + registration.command + ');};';
  runInContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText, context);
  const command = () => (context.command as Function)(state.settings, state.settings.tabs.find(tab => tab.id === state.settings.activeTabId), otherQueryClose.current?.running ?? false) as { enabled: boolean; run(): unknown };
  // 本文件是RAM受控回包：原断言在明确模拟提交后保留；真实React提交另由组件窄验覆盖。
  const finish=(request:QueryCloseRequest,close:boolean)=>{(context.finish as Function)(request,close);if(commit)(context.commit as Function)(commit,undefined)};
  return { state, keep, a, b, table, requests, otherQueryClose, confirm, listeners, notify, setClosing, command, start: () => command().run(), finish, rawFinish:context.finish as (request:QueryCloseRequest,close:boolean)=>void,ticket:()=>commit,commitNow:(value:typeof commit,pending?:QueryCloseRequest)=>(context.commit as Function)(value,pending) };
}

describe('实际App关闭其他查询入口及受控关闭回包', () => {
  it('原请求清空后的准确提交才推进，迟到A提交不得清掉B的新票据',()=>{
    const f=fixture();f.state.settings.tabs.push({...f.b,id:'c'});f.start();const a=f.requests[0];f.rawFinish(a,true);const first=f.ticket()!;
    expect(f.requests.map(request=>request.tabId)).toEqual(['a']);f.commitNow(first,a);expect(f.requests).toHaveLength(1);
    f.commitNow(first);expect(f.requests.map(request=>request.tabId)).toEqual(['a','b']);f.rawFinish(f.requests[1],true);const second=f.ticket()!;
    f.commitNow(first);expect(f.ticket()).toBe(second);expect(f.requests).toHaveLength(2);f.commitNow(second);expect(f.requests.map(request=>request.tabId)).toEqual(['a','b','c']);f.finish(f.requests[2],false);
  });
  it('实际注册命令可用，空闲空草稿逐个走原closeTab；保留当前查询和全部表', () => {
    const f = fixture('  '), command = f.command(); expect(command.enabled).toBe(true); expect(command.run).toBeTypeOf('function');
    f.start(); expect(f.state.closeTab.mock.calls).toEqual([['a'], ['b']]); expect(f.state.settings.tabs).toEqual([f.keep, f.table]); expect(f.requests).toEqual([]);
  });
  it('三选只发一份请求，二次触发不并行；放弃第一项后取消第二项保留原SQL', () => {
    const f = fixture(); f.start(); f.start(); expect(f.requests.map(request => request.tabId)).toEqual(['a']); expect(f.command().enabled).toBe(false);
    f.finish(f.requests[0], true); expect(f.requests.map(request => request.tabId)).toEqual(['a', 'b']); f.finish(f.requests[1], false);
    expect(f.state.settings.tabs).toEqual([f.keep, f.table, f.b]); expect(f.b.sql).toBe('SELECT 原SQL;'); expect(f.otherQueryClose.current?.running).toBe(false);
  });
  it('保存明确更新标题/来源/上下文后仍认可当前对象，随后逐个请求；旧回包不能关闭下一项', () => {
    const f = fixture(); f.start(); const first = f.requests[0], patch: Partial<WorkspaceTab> = { title: '保存后标题', sourceBinding: { id: 'saved', digest: 'a'.repeat(64), connectionId: 'c', context: { state: 'known', database: null } }, databaseContext: { state: 'known', database: null } };
    first.mutate!(f.a, patch, () => { f.state.settings.tabs = f.state.settings.tabs.map(tab => tab === f.a ? { ...tab, ...patch } : tab); f.notify(); });
    f.finish(first, true); expect(f.requests).toHaveLength(2); f.finish(first, true); expect(f.state.settings.tabs).toContain(f.b);
    f.finish(f.requests[1], false); expect(f.state.closeTab).toHaveBeenCalledExactlyOnceWith('a');
  });
  it('保存失败停止批次；当前弹窗手动重试成功也不触发下一项', () => {
    const f = fixture(); f.start(); const first = f.requests[0]; first.failed!(); expect(f.otherQueryClose.current?.running).toBe(false); f.start(); expect(f.requests).toHaveLength(1);
    f.finish(first, true); expect(f.state.closeTab).toHaveBeenCalledExactlyOnceWith('a'); expect(f.requests).toHaveLength(1); expect(f.state.settings.tabs).toContain(f.b);
  });
  it('活动作业拒绝且不取消SQL；事务取消保留，明确确认仍走原关闭路径', () => {
    const busy = fixture(); busy.state.activeJobs.a = true; busy.start(); expect(busy.state.notify).toHaveBeenCalledWith(zh.app.text001, true); expect(busy.requests).toEqual([]); expect(busy.state.closeTab).not.toHaveBeenCalled();
    const cancelled = fixture(); cancelled.state.dirtyTabs.a = true; cancelled.start(); expect(cancelled.confirm).toHaveBeenCalledWith(zh.app.text002); expect(cancelled.state.closeTab).not.toHaveBeenCalled();
    const accepted = fixture(''); accepted.state.dirtyTabs.a = true; accepted.confirm.mockReturnValue(true); accepted.start(); expect(accepted.state.closeTab.mock.calls).toEqual([['a'], ['b']]);
  });
  it.each(['activeJobs', 'dirtyTabs'] as const)('关闭回包时出现%s再次拒绝，后面的查询保持', field => {
    const f = fixture(); f.start(); f.state[field].a = true; f.finish(f.requests[0], true); expect(f.state.closeTab).not.toHaveBeenCalled(); expect(f.requests).toHaveLength(1); expect(f.state.settings.tabs).toContain(f.b);
  });
  it('新标签不纳入；途中移除或同ID重建不认领，迟到成功不能删除新世代', () => {
    const f = fixture(); f.start(); const added = { ...f.a, id: 'new' }; f.state.settings.tabs.push(added); f.notify(); f.finish(f.requests[0], true); expect(f.requests.map(request => request.tabId)).toEqual(['a', 'b']);
    const replacement = { ...f.b }; f.state.settings.tabs = f.state.settings.tabs.map(tab => tab === f.b ? replacement : tab); f.notify(); f.finish(f.requests[1], true);
    expect(f.state.settings.tabs).toContain(replacement); expect(f.state.settings.tabs).toContain(added); expect(f.state.closeTab).toHaveBeenCalledExactlyOnceWith('a');
  });
  it('卸载撤销队列；迟到回包不能删除任何目标', () => {
    const f = fixture(); f.start(); f.otherQueryClose.current!.dispose(); f.finish(f.requests[0], true); expect(f.state.closeTab).not.toHaveBeenCalled(); expect(f.requests).toHaveLength(1); expect(f.listeners.size).toBe(0);
  });
});
