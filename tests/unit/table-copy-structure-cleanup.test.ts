import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

/** 执行真实未来定义的终态及停链函数；只给RAM归属/观察端口，绝不导入live模块。 */
function harness() {
  const source = readFileSync(new URL('../e2e/table-copy-structure-live.ts', import.meta.url), 'utf8');
  const body = source.slice(source.indexOf('export async function assertTableCopyStructureTasksTerminal'), source.indexOf('/** 只注册未执行定义'));
  const state = { retained: false, closed: false, owner: true, tasks: [{ kind: 'schema.tableCopyStructure.apply', status: 'completed' }] as { kind: string; status: string }[], calls: [] as string[], fail: '', changeOwner: '' };
  const info = {}, evaluate = vi.fn(async () => { state.calls.push('tasks'); if (state.changeOwner === 'tasks') state.owner = false; if (state.fail === 'tasks') throw Error('读取未知'); return state.tasks; });
  const observer = { query: vi.fn(async (sql: string) => { const name = sql.startsWith('DROP') ? 'drop' : 'check'; state.calls.push(name); if (state.changeOwner === name) state.owner = false; if (state.fail === name) throw Error(name + '未知'); return [[]]; }), end: vi.fn(async () => { state.calls.push('end'); if (state.fail === 'end') throw Error('end未知'); }) };
  const context = createContext({ exports: {}, expect, AggregateError,
    ownedDesktopResources: (given: unknown) => { if (given !== info || state.retained || !state.owner) throw Error('归属未知，停链'); return { closed: state.closed, page: { evaluate } }; },
    retainOwnedDesktopResources: () => { state.retained = true; },
    confirmOwnedDesktopExit: async () => { state.calls.push('exit'); if (state.fail === 'exit') throw Error('退出未确认'); state.closed = true; },
  });
  runInContext(ts.transpileModule(body + '\nglobalThis.ports={assertTableCopyStructureTasksTerminal,cleanupTableCopyStructureCase};', { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, context);
  return { state, info, observer, cleanup: (primary?: { reason: unknown }) => context.ports.cleanupTableCopyStructureCase(info, observer, 'dbark_copy_' + 'a'.repeat(32), true, primary) as Promise<void> };
}
describe('复制结构未来定义的归属、终态和清理停链（纯RAM）', () => {
  it('任务确认成功后先所属退出，才删唯一库、验证为空并结束observer', async () => { const h = harness(); await h.cleanup(); expect(h.state.calls).toEqual(['tasks', 'exit', 'drop', 'check', 'end']); expect(h.state.retained).toBe(false); });
  it.each(['running', 'failed', 'cancelled', 'unknown'])('apply状态%s保留现场，不借退出请求取消后清库', async status => { const h = harness(); h.state.tasks[0].status = status; await expect(h.cleanup()).rejects.toThrow('未确认成功'); expect(h.state.calls).toEqual(['tasks']); expect(h.state.retained).toBe(true); });
  it('准备建库apply未确认成功也停链，不因还未复制就清理', async () => { const h = harness(); h.state.tasks = [{ kind: 'schema.databaseCreate.apply', status: 'failed' }]; await expect(h.cleanup()).rejects.toThrow(); expect(h.state.calls).toEqual(['tasks']); });
  it.each(['tasks', 'exit', 'drop', 'check', 'end'])('%s失败不继续下一步，原失败保持为聚合首项和cause', async fail => {
    const h = harness(), original = Error('原UI失败'); h.state.fail = fail; let failure: any; try { await h.cleanup({ reason: original }); } catch (reason) { failure = reason; }
    expect(failure).toBeInstanceOf(AggregateError); expect(failure.errors[0]).toBe(original); expect(failure.cause).toBe(original); expect(h.state.retained).toBe(true); const steps = ['tasks', 'exit', 'drop', 'check', 'end']; expect(h.state.calls).toEqual(steps.slice(0, steps.indexOf(fail) + 1));
  });
  it.each(['tasks', 'drop'])('%s等待期间归属改变后不触碰下一例或继续SQL', async changeOwner => { const h = harness(); h.state.changeOwner = changeOwner; await expect(h.cleanup()).rejects.toThrow('归属'); expect(h.state.retained).toBe(true); expect(h.state.calls).toEqual(changeOwner === 'tasks' ? ['tasks'] : ['tasks', 'exit', 'drop']); });
  it('closed不能替代所属任务终态，不读任务也不清库', async () => { const h = harness(); h.state.closed = true; await expect(h.cleanup()).rejects.toThrow('终态'); expect(h.state.calls).toEqual([]); expect(h.state.retained).toBe(true); });
});
