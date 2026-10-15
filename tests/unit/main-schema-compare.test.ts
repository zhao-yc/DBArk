import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { persistedTaskMessage } from '../../src/main/taskPrivacy';
import type { TaskEvent } from '../../src/shared/contracts';

/** 运行生产 dispatch 原文，只替换存储、配置锁及数据库进程边界。 */
function harness() {
  const source = readFileSync(new URL('../../src/main/index.ts', import.meta.url), 'utf8');
  const dispatch = source.slice(source.indexOf('async function dispatch('), source.indexOf('/** 按平台生成中文原生菜单'));
  const blocked = new Set<string>(), tasks = new Map(), request = vi.fn(async (_command: string, _input: unknown) => ({ snapshotId: 'snapshot' }));
  const context = createContext({ Date, Map, Error, Boolean, shuttingDown: false, structureTokens: new Map(), sessions: new Map(), tasks, completionTasks: new Set(), preparingTasks: new Map(), pendingQueryHistory: new Map(), exportProgress: new Map(), structureProgress: new Map(), savedQueryPages: undefined,
    store: { resolveConnection: (id: string) => ({ id, host: '可信地址', password: '仅主进程秘密' }), saveTask() {}, connectionRevision: () => 17 },
    connectionConfig: { assertAvailable: (id: string) => { if (blocked.has(id)) throw new Error('连接配置正在保存'); } }, broker: { request },
    taskEvent(event: TaskEvent) { tasks.set(event.taskId, { ...tasks.get(event.taskId), status: event.status }); },
  });
  runInContext(ts.transpileModule(dispatch + '\nglobalThis.dispatch = dispatch;', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { blocked, tasks, request, context, dispatch: context.dispatch as (command: string, input: unknown) => Promise<any> };
}
const input = { taskId: 'compare', source: { connectionId: 'source', database: 'db', table: 'a' }, target: { connectionId: 'target', database: 'db', table: 'b' } };
describe('结构比较主进程可信双连接接线', () => {
  it('双侧配置和修订只来自存储，原定义不写任务记录', async () => {
    const h = harness(); await h.dispatch('schema.compare', input);
    expect(h.request.mock.calls[0]).toEqual(['schema.compare', { ...input, sourceProfile: { id: 'source', host: '可信地址', password: '仅主进程秘密' }, targetProfile: { id: 'target', host: '可信地址', password: '仅主进程秘密' }, connectionRevision: 17 }]);
    expect(JSON.stringify([...h.tasks.values()])).not.toContain('秘密');
  });
  it.each(['source', 'target'])('任意一侧 %s 配置保存时拒绝投递和建任务', async side => {
    const h = harness(); h.blocked.add(side); await expect(h.dispatch('schema.compare', input)).rejects.toThrow('正在保存'); expect(h.request).not.toHaveBeenCalled(); expect(h.tasks.size).toBe(0);
  });
  it('退出拒绝比较和预览；预览注入当前修订且不接受客户端 SQL', async () => {
    const h = harness(); await h.dispatch('schema.comparePreview', { snapshotId: 'snapshot', selections: [{ category: 'columns', name: 'id' }] });
    expect(h.request.mock.calls[0][1]).toMatchObject({ connectionRevision: 17 });
    h.context.shuttingDown = true;
    await expect(h.dispatch('schema.compare', input)).rejects.toThrow('正在退出');
    await expect(h.dispatch('schema.comparePreview', { snapshotId: 'snapshot', selections: [] })).rejects.toThrow('正在退出');
  });
  it('任何阶段都只持久化固定只读概要，错误和默认值不落盘', () => {
    for (const status of ['running', 'completed', 'failed', 'cancelled'] as const) expect(persistedTaskMessage('schema.compare', { taskId: 't', status, progress: 0, message: "DEFAULT '秘密' COMMENT '敏感'" })).toBe('结构比较仅供只读审查，尚未同步；原定义、默认值、注释和错误原文未保存。');
  });
});
