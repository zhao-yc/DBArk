import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { QueryCloseRequests } from '../../src/renderer/queryCloseIntent';
/** 抽取真实App两个关闭函数，确认原作业/事务/空草稿/表守卫与最终复核。 */
function fixture(kind = 'query', sql = 'SELECT 合成;') {
  const text = readFileSync(new URL('../../src/renderer/App.tsx', import.meta.url), 'utf8'), file = ts.createSourceFile('App.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), source: string[] = [];
  function find(node: ts.Node) { if (ts.isFunctionDeclaration(node) && ['closeTab', 'finishQueryClose'].includes(node.name?.text ?? '')) source.push(node.getText(file)); ts.forEachChild(node, find); } find(file);
  const requests = new QueryCloseRequests(), state = { settings: { tabs: [{ id: 't', kind, sql }] }, activeJobs: {} as Record<string, boolean>, dirtyTabs: {} as Record<string, boolean>, closeTab: vi.fn(), notify: vi.fn() };
  const confirm = vi.fn(() => false), setRequest = vi.fn(), context = createContext({ otherQueryClose: { current: null }, useWorkspace: { getState: () => state }, window: { confirm }, document: { querySelector: () => null }, zh: { app: { text001: '活动作业', text002: '事务确认' } }, queryCloseZh: { changed: '状态变化' }, closeRequests: requests, setQueryCloseRequest: setRequest });
  runInContext(ts.transpileModule(source.join('\n') + '\nglobalThis.close=closeTab;globalThis.finish=finishQueryClose;', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { state, confirm, requests, setRequest, close: context.close as (id: string) => void, finish: context.finish as (request: object, close: boolean) => void };
}
describe('App原关闭守卫及新请求完成复核', () => {
  it('活动作业先拒绝，不显示三选或删除标签', () => { const f = fixture(); f.state.activeJobs.t = true; f.close('t'); expect(f.state.notify).toHaveBeenCalled(); expect(f.setRequest).not.toHaveBeenCalled(); expect(f.state.closeTab).not.toHaveBeenCalled(); });
  it('活动事务取消仍保留，确认仍沿原关闭路径', () => { const f = fixture(); f.state.dirtyTabs.t = true; f.close('t'); expect(f.confirm).toHaveBeenCalledWith('事务确认'); expect(f.state.closeTab).not.toHaveBeenCalled(); f.confirm.mockReturnValue(true); f.close('t'); expect(f.state.closeTab).toHaveBeenCalledExactlyOnceWith('t'); expect(f.setRequest).not.toHaveBeenCalled(); });
  it.each([['table', '文本'], ['query', ''], ['query', '  ']])('%s空查询/表继续原关闭', (kind, sql) => { const f = fixture(kind, sql); f.close('t'); expect(f.state.closeTab).toHaveBeenCalledExactlyOnceWith('t'); expect(f.setRequest).not.toHaveBeenCalled(); });
  it('非空查询仅发出一次请求，完成前不删除标签', () => { const f = fixture(); f.close('t'); f.close('t'); expect(f.setRequest).toHaveBeenCalledTimes(1); expect(f.state.closeTab).not.toHaveBeenCalled(); const request = f.setRequest.mock.calls[0][0]; f.finish(request, true); expect(f.state.closeTab).toHaveBeenCalledExactlyOnceWith('t'); });
  it.each(['', 'SELECT 已保存;'])('关联文件正文%j都经关闭三选，尚未交付的编辑不能借clean缓存直接关闭', sql => {
    const f = fixture('query', sql);
    Object.assign(f.state.settings.tabs[0], { fileSourceBinding: { id: '11111111-1111-4111-8111-111111111111', revision: 1 } });
    f.close('t'); expect(f.setRequest).toHaveBeenCalledTimes(1); expect(f.state.closeTab).not.toHaveBeenCalled();
  });
  it.each(['activeJobs', 'dirtyTabs'] as const)('完成前新出现%s不关闭', field => { const f = fixture(); f.close('t'); const request = f.setRequest.mock.calls[0][0]; f.state[field].t = true; f.finish(request, true); expect(f.state.closeTab).not.toHaveBeenCalled(); expect(f.state.notify).toHaveBeenCalled(); });
  it('取消/删除/旧请求迟到不关闭新目标', () => { const f = fixture(); f.close('t'); const old = f.setRequest.mock.calls[0][0]; f.finish(old, false); f.close('t'); f.finish(old, true); expect(f.state.closeTab).not.toHaveBeenCalled(); f.state.settings.tabs = []; f.finish(f.setRequest.mock.calls.at(-1)![0], true); expect(f.state.closeTab).not.toHaveBeenCalled(); });
});
