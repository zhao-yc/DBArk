import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { SavedQuerySearchCancelled } from '../../src/main/savedQuerySearch';
import { persistedTaskMessage } from '../../src/main/taskPrivacy';
import type { ConnectionProfile, TaskEvent, TaskRecord } from '../../src/shared/contracts';

/** 执行生产dispatch和进程退出代码，替换Electron/broker边界而非复制令牌规则。 */
function harness() {
  const source = readFileSync(new URL('../../src/main/index.ts', import.meta.url), 'utf8');
  const dispatch = source.slice(source.indexOf('async function dispatch('), source.indexOf('/** 按平台生成中文原生菜单'));
  const exit = source.slice(source.indexOf('function engineExited('), source.indexOf('if (!app.requestSingleInstanceLock())'));
  const tokens = new Map(), progress = new Map(), tasks = new Map<string, TaskRecord>(), events: TaskEvent[] = [], request = vi.fn(async (_command: string, _input: unknown): Promise<any> => undefined);
  const context = createContext({ SavedQuerySearchCancelled, savedQuerySearches: { has: () => false }, savedQueryPages: undefined, historyPages: undefined, tasks, pendingQueryHistory: new Map(), completionTasks: new Set(), structureTokens: tokens, structureProgress: progress, shuttingDown: false, preparingTasks: new Map(), exportProgress: new Map(), sessions: new Map(), connectionConfig: { assertAvailable() {} }, store: { saveTask() {}, connectionRevision: () => 7 }, broker: { request },
    taskEvent(event: TaskEvent) { events.push(event); if (event.tableComment) progress.set(event.taskId, event.tableComment); tasks.set(event.taskId, { ...tasks.get(event.taskId)!, status: event.status }); },
  });
  runInContext(ts.transpileModule(dispatch + exit + '\nglobalThis.handlers={dispatch,engineExited};', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { tokens, progress, tasks, events, request, handlers: context.handlers as { dispatch(command: string, input: unknown): Promise<any>; engineExited(): void } };
}
describe('主进程表注释令牌、修订与退出事实', () => {
  it('从可信get/preview结果建立专属令牌并注入修订，其他用途不能套用或释放', async () => {
    const value = harness(), expiresAt = new Date(Date.now() + 120000).toISOString();
    value.request.mockResolvedValueOnce({ snapshotId: 's', target: { connectionId: 'trusted' }, expiresAt });
    await value.handlers.dispatch('schema.tableComment.get', { connectionId: 'trusted', database: 'db', table: 't', taskId: 'get' });
    expect(value.tokens.get('s')).toMatchObject({ purpose: 'tableComment', connectionId: 'trusted', kind: 'snapshot' });
    await expect(value.handlers.dispatch('schema.indexes.preview', { snapshotId: 's', taskId: 'wrong' })).rejects.toThrow('用途');
    await expect(value.handlers.dispatch('schema.columns.release', { snapshotId: 's' })).rejects.toThrow('用途');
    value.request.mockResolvedValueOnce({ previewToken: 'p', target: { connectionId: 'trusted' }, expiresAt });
    await value.handlers.dispatch('schema.tableComment.preview', { snapshotId: 's', comment: '说明', taskId: 'preview' });
    expect(value.request.mock.calls.at(-1)?.[1]).toMatchObject({ connectionRevision: 7 });
    value.request.mockRejectedValueOnce(new Error('进程中途退出'));
    await expect(value.handlers.dispatch('schema.tableComment.apply', { previewToken: 'p', acknowledgements: [], taskId: 'apply' })).rejects.toThrow('退出');
    expect(value.events.at(-1)?.tableComment).toMatchObject({ ddlSubmitted: true, outcome: 'unknown' });
    expect(value.events.at(-1)?.columnPatch).toBeUndefined();
    await expect(value.handlers.dispatch('schema.tableComment.apply', { previewToken: 'p', taskId: 'again' })).rejects.toThrow('失效');
  });
  it('工具进程退出保留已完成事实，读取失败不标记已发送DDL', () => {
    const value = harness();
    for (const id of ['apply', 'get']) value.tasks.set(id, { id, kind: `schema.tableComment.${id}`, status: 'running', progress: 0, startedAt: '', message: '' });
    value.progress.set('apply', { phase: 'verifying', ddlSubmitted: true, ddlCompleted: true, definitionVerified: false, outcome: 'succeeded' }); value.handlers.engineExited();
    expect(value.events.find(event => event.taskId === 'apply')?.tableComment).toMatchObject({ ddlCompleted: true, outcome: 'succeeded' });
    expect(value.events.find(event => event.taskId === 'get')?.tableComment).toMatchObject({ ddlSubmitted: false, outcome: 'not-sent' });
  });
  it('任务持久化不保存注释和驱动展开的敏感错误原文', () => {
    for (const status of ['running', 'completed', 'cancelled', 'failed'] as const) expect(persistedTaskMessage('schema.tableComment.apply', { taskId: 't', status, progress: 0, message: 'COMMENT=私有业务说明', tableComment: { phase: 'executing', ddlSubmitted: true, ddlCompleted: false, definitionVerified: false, outcome: 'unknown' } })).not.toContain('私有业务说明');
  });
});

/** 只提取真实集成准备函数，不导入集成模块、启动引擎或读取任何认证材料。 */
function checkIntegrationTarget(profile: ConnectionProfile, tlsRequested?: string): void {
  const source = readFileSync(new URL('../integration/engine-table-comment.integration.test.ts', import.meta.url), 'utf8');
  const tree = ts.createSourceFile('table-comment-integration.ts', source, ts.ScriptTarget.Latest, true);
  let guard = '';
  function visit(node: ts.Node) { if (ts.isFunctionDeclaration(node) && node.name?.text === 'assertTableCommentTestTarget') guard = node.getText(tree); node.forEachChild(visit); }
  visit(tree); if (!guard) throw new Error('缺少真实表注释集成准备门');
  runInContext(ts.transpileModule(guard + '\nassertTableCommentTestTarget(profile,tlsRequested);', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, createContext({ profile, tlsRequested }));
}

describe('表注释六实例的显式配置准备门（不连接服务器）', () => {
  const profile: ConnectionProfile = { id: 'configuration-only', name: '仅配置验证', group: '', color: '#123456', dialect: 'mysql', host: '192.168.31.200', port: 13384, user: 'fixture' };
  const tls = { enabled: true, rejectUnauthorized: true, caPath: '/仅作配置校验的已有CA占位.pem' };
  it('原五端口保持显式主机、账号与无TLS配置的原有准入', () => {
    for (const port of [13357, 13380, 13384, 13310, 13311]) expect(() => checkIntegrationTarget({ ...profile, port })).not.toThrow();
  });
  it('13484只有开关、CA和严格校验齐全才通过准备门', () => {
    expect(() => checkIntegrationTarget({ ...profile, port: 13484, tls }, '1')).not.toThrow();
    expect(() => checkIntegrationTarget({ ...profile, host: 'deve-server.yinzon.com', port: 13484, tls }, '1')).not.toThrow();
  });
  it('13484拒绝遗漏开关、禁用TLS、无CA和关闭证书校验，不降级', () => {
    const strict = { ...profile, port: 13484, tls };
    for (const flag of [undefined, '0', 'true']) expect(() => checkIntegrationTarget(strict, flag)).toThrow('13484');
    for (const value of [undefined, { ...tls, enabled: false }, { ...tls, rejectUnauthorized: false }, { ...tls, caPath: undefined }, { ...tls, caPath: '' }, { ...tls, caPath: '  ' }]) expect(() => checkIntegrationTarget({ ...strict, tls: value }, '1')).toThrow('13484');
  });
  it('原有主机、账号、端口及其它端口TLS缺CA的拒绝保持', () => {
    for (const next of [{ ...profile, host: 'unreviewed.invalid' }, { ...profile, user: '' }, { ...profile, port: 3306 }, { ...profile, tls: { enabled: true, rejectUnauthorized: true } }]) expect(() => checkIntegrationTarget(next, '1')).toThrow();
  });
});
