import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import type { TaskEvent, TaskRecord } from '../../src/shared/contracts';
import { persistedTaskMessage } from '../../src/main/taskPrivacy';

/** 执行生产 dispatch/退出函数原文；只替换 Electron、存储与 broker 边界。 */
function harness() {
  const source = readFileSync(new URL('../../src/main/index.ts', import.meta.url), 'utf8');
  const dispatch = source.slice(source.indexOf('async function dispatch('), source.indexOf('/** 按平台生成中文原生菜单'));
  const exit = source.slice(source.indexOf('function engineExited('), source.indexOf('if (!app.requestSingleInstanceLock())'));
  const tasks = new Map<string, TaskRecord>(), events: TaskEvent[] = [], columnTokens = new Map(), columnProgress = new Map();
  let blocked = false, revision = 7;
  const request = vi.fn(async (_command: string, _input: unknown): Promise<any> => undefined);
  const context = createContext({ Date, Map, Error, Boolean, tasks, events, structureTokens: columnTokens, structureProgress: columnProgress, shuttingDown: false, preparingTasks: new Map(), exportProgress: new Map(), sessions: new Map(),
    connectionConfig: { assertAvailable(id?: string) { if (blocked && id === 'trusted') throw new Error('连接配置正在保存'); } },
    store: { saveTask() {}, connectionRevision: () => revision }, broker: { request },
    taskEvent(event: TaskEvent) { events.push(event); const progress = event.indexPatch ?? event.columnPatch; if (progress) columnProgress.set(event.taskId, progress); tasks.set(event.taskId, { ...tasks.get(event.taskId)!, status: event.status }); },
  });
  runInContext(ts.transpileModule(dispatch + exit + '\nglobalThis.handlers = { dispatch, engineExited };', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { request, context, events, columnTokens, columnProgress, tasks, setBlocked: (value: boolean) => { blocked = value; }, setRevision: (value: number) => { revision = value; }, handlers: context.handlers as { dispatch(command: string, input: unknown): Promise<any>; engineExited(): void } };
}
const expiresAt = () => new Date(Date.now() + 120000).toISOString();

describe('结构任务主进程可信令牌与退出证据', () => {
  it('令牌只从可信输出建立，预览不接受客户端目标且同步注入当前修订', async () => {
    const test = harness(); test.request.mockResolvedValueOnce({ snapshotId: 'snapshot', target: { connectionId: 'trusted' }, expiresAt: expiresAt() });
    await test.handlers.dispatch('schema.columns.get', { connectionId: 'trusted', database: 'db', table: 't', taskId: 'get' });
    expect(test.request.mock.calls[0][1]).toMatchObject({ connectionRevision: 7 });
    test.setBlocked(true);
    await expect(test.handlers.dispatch('schema.columns.preview', { snapshotId: 'snapshot', patches: [], taskId: 'blocked' })).rejects.toThrow('正在保存');
    expect(test.request).toHaveBeenCalledTimes(1);
    test.setBlocked(false); test.setRevision(8);
    test.request.mockResolvedValueOnce({ previewToken: 'preview', target: { connectionId: 'trusted' }, expiresAt: expiresAt() });
    await test.handlers.dispatch('schema.columns.preview', { snapshotId: 'snapshot', patches: [], taskId: 'preview' });
    expect(test.request.mock.calls[1][1]).toMatchObject({ connectionRevision: 8 });
    expect(test.columnTokens.get('preview')).toMatchObject({ connectionId: 'trusted', snapshotId: 'snapshot' });
  });

  it('未知、过期令牌拒投递；apply 拒绝后也不能再次使用能力', async () => {
    const test = harness();
    await expect(test.handlers.dispatch('schema.columns.preview', { snapshotId: 'fake', taskId: 'p' })).rejects.toThrow('失效');
    test.columnTokens.set('expired', { purpose: 'columns', kind: 'snapshot', connectionId: 'trusted', expires: Date.now() - 1 });
    await expect(test.handlers.dispatch('schema.columns.preview', { snapshotId: 'expired', taskId: 'p' })).rejects.toThrow('失效');
    expect(test.request).not.toHaveBeenCalled();
    test.columnTokens.set('apply', { purpose: 'columns', kind: 'preview', connectionId: 'trusted', expires: Date.now() + 10000 });
    test.request.mockRejectedValueOnce(new Error('引擎中途退出'));
    await expect(test.handlers.dispatch('schema.columns.apply', { previewToken: 'apply', acknowledgements: [], taskId: 'a' })).rejects.toThrow('退出');
    expect(test.events.at(-1)?.columnPatch).toMatchObject({ ddlSubmitted: true, ddlCompleted: false, outcome: 'unknown' });
    await expect(test.handlers.dispatch('schema.columns.apply', { previewToken: 'apply', taskId: 'again' })).rejects.toThrow('失效');
  });

  it('worker exit 保留 DDL OK 证据，尚无发送证据的投递中 apply 保守未知', () => {
    const test = harness();
    for (const id of ['sent', 'completed', 'get']) test.tasks.set(id, { id, kind: id === 'get' ? 'schema.columns.get' : 'schema.columns.apply', status: 'running', progress: 0, message: '', startedAt: '' });
    test.columnProgress.set('sent', { phase: 'rechecking', ddlSubmitted: false, ddlCompleted: false, definitionVerified: false, outcome: 'not-sent' });
    test.columnProgress.set('completed', { phase: 'releasing', ddlSubmitted: true, ddlCompleted: true, definitionVerified: true, outcome: 'succeeded' });
    test.handlers.engineExited();
    expect(test.events.find(event => event.taskId === 'sent')?.columnPatch).toMatchObject({ ddlSubmitted: true, outcome: 'unknown' });
    expect(test.events.find(event => event.taskId === 'completed')?.columnPatch).toMatchObject({ ddlCompleted: true, definitionVerified: true, outcome: 'succeeded' });
    expect(test.events.find(event => event.taskId === 'get')?.columnPatch).toMatchObject({ ddlSubmitted: false, outcome: 'not-sent' });
  });

  it('释放快照同时撤销关联预览，准备退出不开始结构请求', async () => {
    const test = harness();
    test.columnTokens.set('s', { purpose: 'columns', kind: 'snapshot', connectionId: 'trusted', expires: Date.now() + 10000 });
    test.columnTokens.set('p', { purpose: 'columns', kind: 'preview', connectionId: 'trusted', snapshotId: 's', expires: Date.now() + 10000 });
    await test.handlers.dispatch('schema.columns.release', { snapshotId: 's' }); expect(test.columnTokens.size).toBe(0);
    test.context.shuttingDown = true;
    await expect(test.handlers.dispatch('schema.columns.get', { connectionId: 'trusted', taskId: 'late' })).rejects.toThrow('退出');
    expect(test.request).toHaveBeenCalledTimes(1);
  });

  it('结构任务任何阶段持久化仅固定概要，不保存默认值、注释或错误 SQL', () => {
    for (const status of ['running', 'completed', 'cancelled', 'failed'] as const) {
      const event: TaskEvent = { taskId: 't', status, progress: 20, message: "ALTER TABLE t DEFAULT '秘密' COMMENT '敏感注释'", columnPatch: { phase: 'executing', ddlSubmitted: true, ddlCompleted: false, definitionVerified: false, outcome: 'unknown' } };
      expect(persistedTaskMessage('schema.columns.apply', event)).not.toMatch(/秘密|敏感注释|ALTER/);
      expect(persistedTaskMessage('schema.columns.apply', event)).toContain('可能已执行');
    }
  });

  it('索引令牌只绑定可信目标和当前修订，字段预览及释放不能跨用途引用', async () => {
    const test = harness();
    test.request.mockResolvedValueOnce({ snapshotId: 'index-s', target: { connectionId: 'trusted' }, expiresAt: expiresAt() });
    await test.handlers.dispatch('schema.indexes.get', { connectionId: 'trusted', database: 'db', table: 't', taskId: 'i-get' });
    expect(test.columnTokens.get('index-s')).toMatchObject({ purpose: 'indexes', kind: 'snapshot', connectionId: 'trusted' });
    await expect(test.handlers.dispatch('schema.columns.preview', { snapshotId: 'index-s', taskId: 'wrong' })).rejects.toThrow('用途');
    await expect(test.handlers.dispatch('schema.columns.release', { snapshotId: 'index-s' })).rejects.toThrow('用途');
    expect(test.request).toHaveBeenCalledTimes(1); expect(test.columnTokens.has('index-s')).toBe(true);
    test.setRevision(8); test.request.mockResolvedValueOnce({ previewToken: 'index-p', target: { connectionId: 'trusted' }, expiresAt: expiresAt() });
    await test.handlers.dispatch('schema.indexes.preview', { snapshotId: 'index-s', patches: [], taskId: 'i-preview' });
    expect(test.request.mock.calls[1][1]).toMatchObject({ connectionRevision: 8 });
    test.setBlocked(true);
    await expect(test.handlers.dispatch('schema.indexes.apply', { previewToken: 'index-p', taskId: 'blocked' })).rejects.toThrow('正在保存');
    expect(test.request).toHaveBeenCalledTimes(2);
    test.setBlocked(false); await test.handlers.dispatch('schema.indexes.release', { snapshotId: 'index-s' });
    expect(test.columnTokens.size).toBe(0);
  });

  it('索引apply中途退出消费令牌，并且只发送indexPatch而不是字段进度', async () => {
    const test = harness();
    test.columnTokens.set('index-p', { purpose: 'indexes', kind: 'preview', connectionId: 'trusted', expires: Date.now() + 10000 });
    test.request.mockRejectedValueOnce(new Error('驱动退出：秘密重复值'));
    await expect(test.handlers.dispatch('schema.indexes.apply', { previewToken: 'index-p', acknowledgements: [], taskId: 'index-a' })).rejects.toThrow('驱动退出');
    expect(test.columnTokens.has('index-p')).toBe(false);
    expect(test.events.at(-1)?.indexPatch).toMatchObject({ ddlSubmitted: true, ddlCompleted: false, outcome: 'unknown' });
    expect(test.events.at(-1)?.columnPatch).toBeUndefined();
    await expect(test.handlers.dispatch('schema.indexes.apply', { previewToken: 'index-p', taskId: 'again' })).rejects.toThrow('失效');
  });

  it('worker退出时索引保留已完成事实，固定持久化概要不保存重复键数据', () => {
    const test = harness();
    test.tasks.set('done-index', { id:'done-index', kind:'schema.indexes.apply',status:'running',progress:0,message:'',startedAt:'' });
    test.columnProgress.set('done-index', { phase:'releasing',ddlSubmitted:true,ddlCompleted:true,definitionVerified:true,outcome:'succeeded' });
    test.handlers.engineExited();
    expect(test.events.at(-1)?.indexPatch).toMatchObject({ ddlCompleted:true,definitionVerified:true,outcome:'succeeded' });
    expect(test.events.at(-1)?.columnPatch).toBeUndefined();
    for (const status of ['running','completed','failed','cancelled'] as const) {
      const event:TaskEvent={taskId:'index',status,progress:0,message:"Duplicate entry '真实秘密数据' for key '索引注释'",indexPatch:{phase:'executing',ddlSubmitted:true,ddlCompleted:false,definitionVerified:false,outcome:'unknown'}};
      expect(persistedTaskMessage('schema.indexes.apply',event)).not.toMatch(/真实秘密数据|索引注释|Duplicate/);
      expect(persistedTaskMessage('schema.indexes.apply',event)).toContain('可能已执行');
    }
  });
});
