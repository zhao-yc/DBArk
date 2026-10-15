import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import type { TaskEvent, TaskRecord } from '../../src/shared/contracts';

/** 调用生产函数原文，只替换 Electron/IO 边界，防止另写一套状态逻辑的测试误通过。 */
function productionFunctions(): string {
  const source = readFileSync(new URL('../../src/main/index.ts', import.meta.url), 'utf8');
  const dispatchStart = source.indexOf('async function dispatch('), dispatchEnd = source.indexOf('/** 按平台生成中文原生菜单');
  const exitStart = source.indexOf('function engineExited('), exitEnd = source.indexOf('if (!app.requestSingleInstanceLock())');
  if (dispatchStart < 0 || dispatchEnd <= dispatchStart || exitStart < 0 || exitEnd <= exitStart) throw new Error('生产函数位置改变，请更新真实入口测试');
  return ts.transpileModule(source.slice(dispatchStart, dispatchEnd) + source.slice(exitStart, exitEnd) + '\nglobalThis.handlers = { dispatch, engineExited };', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
}

describe('主进程准备任务的进程退出竞态', () => {
  it.each(['files.exportResult', 'query.exportStream'] as const)('%s 准备未完成时进程退出，迟到路径检查不能投递新任务', async command => {
    let permit!: (release: () => void) => void; const released = vi.fn();
    const tasks = new Map<string, TaskRecord>(); const events: TaskEvent[] = []; const request = vi.fn(async () => { throw new Error('不应重新启动引擎'); });
    const context = createContext({ savedQueryPages:undefined,Date, Map, Error, randomUUID: () => 'history', tasks, events,pendingQueryHistory:new Map(), completionTasks:new Set(), preparingTasks: new Map(), exportProgress: new Map(), structureProgress: new Map(), structureTokens: new Map(), files: new Map(), sessions: new Map([['old-session', { connectionId: 'connection' }]]),
      connectionConfig: { assertAvailable() {} }, resolveFileToken: () => '/selected/result.json',
      store: { saveTask() {}, addHistory() {} }, persistAuxiliary: (action: () => void) => action(), persistedQueryError: () => '脱敏错误',
      exportReservations: { acquire: () => new Promise<() => void>(resolve => { permit = resolve; }) }, broker: { request },
      taskEvent(event: TaskEvent) { events.push(event); tasks.set(event.taskId, { ...tasks.get(event.taskId)!, status: event.status }); },
    });
    runInContext(productionFunctions(), context);
    const handlers = context.handlers as { dispatch(command: string, input: unknown): Promise<unknown>; engineExited(): void };
    const pending = handlers.dispatch(command, { taskId: 'prepared', sessionId: 'old-session', fileToken: 'token', format: 'json', sql: 'SELECT 1' });
    const failure = expect(pending).rejects.toThrow('准备任务已停止');
    expect(tasks.get('prepared')?.status).toBe('running'); handlers.engineExited();
    expect(tasks.get('prepared')?.status).toBe('failed');
    if (command === 'query.exportStream') expect(events.at(-1)?.queryExport).toMatchObject({ phase: 'preparing', sqlMayHaveExecuted: false, transactionKnown: false });
    permit(released); await failure;
    expect(request).not.toHaveBeenCalled(); expect(released).toHaveBeenCalledTimes(1); expect(tasks.get('prepared')?.status).toBe('failed');
    expect(context.preparingTasks.size).toBe(0); expect(context.exportProgress.size).toBe(0);
  });
});
