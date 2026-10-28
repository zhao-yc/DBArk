import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { QueryParameterReuseOwner } from '../../src/renderer/queryParameterReuseOwner';
import type { QueryParameterReusePort } from '../../src/renderer/queryParameterReusePort';
import type { QueryParameterNames } from '../../src/shared/queryParameters';
import type { QueryOutcome } from '../../src/shared/contracts';
import { queryDatabaseFromSession, queryDatabasePatch, resolveQueryDatabase } from '../../src/shared/queryContext';
import { confirmedQueryContinueRange } from '../../src/renderer/components/QueryContinueOnErrorNotice';

const source = readFileSync(new URL('../../src/renderer/components/QueryTab.tsx', import.meta.url), 'utf8');
const tree = ts.createSourceFile('QueryTab.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declarations = new Map<string, string>(); let completionEffect = '', executeBinding = '', reuseBinding = '';
/** 提取正式父层方法及JSX绑定；真实Owner/Cache/Candidate保留，仅替换IPC和Monaco公开端口。 */
function inspect(node: ts.Node): void {
  if (ts.isFunctionDeclaration(node) && node.name) declarations.set(node.name.text, node.getText(tree));
  if (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) && node.expression.expression.getText(tree) === 'useEffect' && node.getText(tree).includes("invoke('query.completionState'") && node.getText(tree).includes('confirmed(')) completionEffect = node.getText(tree);
  if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(tree) === 'QueryParametersDialog') for (const prop of node.attributes.properties) {
    if (!ts.isJsxAttribute(prop) || !prop.initializer || !ts.isJsxExpression(prop.initializer) || !prop.initializer.expression) continue;
    if (prop.name.getText(tree) === 'onExecute') executeBinding = prop.initializer.expression.getText(tree);
    if (prop.name.getText(tree) === 'reuse') reuseBinding = prop.initializer.expression.getText(tree);
  }
  ts.forEachChild(node, inspect);
}
inspect(tree);
const names = ['parameterReuseOwner', 'parameterReuseInput', 'openParameters', 'loadParameterNames', 'prepareExecutionContext', 'runQuery', 'submitParameterQuery', 'confirmParameterReuse', 'closeParameters'];
if (!completionEffect || !executeBinding || !reuseBinding || names.some(name => !declarations.has(name))) throw Error('参数复用正式父层接线不完整');
const metadata = (): QueryParameterNames => ({ names: ['value'], warnings: [], noBackslashEscapes: false, ansiQuotes: false, ansiQuotesKnown: true, noBackslashEscapesKnown: true, maxDecimalScale: 30, allowTimeEndpointFraction: false });
const params = [{ name: 'value', type: 'text' as const, value: '仅RAM的秘密😀' }];

/** RAM端口不执行真实SQL；父层方法、成功判断、库恢复与任务交接均使用当前源码。 */
function fixture() {
  let sql = 'SELECT :value', version = 1, sequence = 0, result: QueryOutcome | Error = { results: [], elapsedMs: 1 }, serverDatabase: string | null = 'db';
  let waitForExecution: Promise<void> | undefined, waitForCompletion: Promise<void> | undefined, earlyConfirmation = false;
  const listeners = new Set<() => void>();
  const tab = { id: 'tab', kind: 'query', connectionId: 'c', sql, database: 'db', databaseContext: { state: 'known', database: 'db' } };
  const workspace = { settings: { tabs: [tab], resultLimit: 50 }, connections: [{ id: 'c', database: 'db' }], connectionVersions: { c: 1 } as Record<string, number>, setBusy: vi.fn(), setDirty: vi.fn(), updateTab: vi.fn((_id: string, patch: object) => { Object.assign(tab, patch); for (const changed of listeners) changed(); }) };
  const model = { getValue: () => sql, getVersionId: () => version, isDisposed: () => false, getValueInRange: () => '', getOffsetAt: () => 0 };
  const editor = { getModel: () => model, getSelection: () => null };
  const invoke = vi.fn((command: string): Promise<unknown> => {
    if (command === 'query.parameterNames') return Promise.resolve(metadata());
    // 无延迟时直接返回已完成缓存Promise，使global effect的then确定排在SQL成功then之前。
    if (command === 'query.completionState') { const state = { databaseKnown: true, database: serverDatabase, broken: false, busy: false }; return waitForCompletion ? waitForCompletion.then(() => state) : Promise.resolve(state); }
    if (command !== 'query.executeParameterized') throw Error('意外IPC：' + command);
    return (waitForExecution ?? Promise.resolve()).then(() => { if (result instanceof Error) throw result; return result; });
  });
  const context: any = createContext({ QueryParameterReuseOwner, resolveQueryDatabase, queryDatabaseFromSession, confirmedQueryContinueRange, scriptFailureRanges: { current: new Set() }, failureSource: { current: undefined }, Error, Set, JSON, invoke, tab,
    useWorkspace: { getState: () => workspace }, parameterReuse: { current: null }, parameterReusePort: { current: null },
    alive: { current: true }, closeRequestRef: { current: null }, sessionRef: { current: 's' }, parameterSession: { current: '' }, editor: { current: editor },
    busyRef: { current: false }, task: { current: '' }, cancelledQuery: { current: '' }, explainSource: { current: '' }, settings: workspace.settings,
    parameterFailureSource: { current: undefined }, parameterContinueOnError: { current: false }, parameterCollectWarnings: { current: false },
    collectWarnings: false, continueOnError: false, document: { querySelector: () => null }, querySource: () => sql, captureFailureSource: () => undefined,
    clearFailureSource: vi.fn(), invalidateResultSelection: vi.fn(), ensureSession: async () => context.sessionRef.current,
    rememberDatabase: (value: Parameters<typeof queryDatabasePatch>[0]) => workspace.updateTab('tab', queryDatabasePatch(value)), flushSettings: vi.fn(async () => {}),
    handleQueryError: vi.fn(async () => {}), queryContextZh: { snapshotFailed: '落盘失败', cancelledBeforeSend: '已取消' }, errorMessage: (error: Error) => error.message,
    uid: () => 'task-' + ++sequence, zh: { query: { text001: '空SQL' } },
    setParameterSource: (value: string | null) => { context.parameterSource = value; }, setBusy: (value: boolean) => { context.busy = value; if (!value && earlyConfirmation) context.confirm(); },
    setQueryRunning: vi.fn(), setError: vi.fn(), setSelectedPin: vi.fn(), setShowPinSql: vi.fn(), setOutcome: vi.fn(), setStream: vi.fn(), setResultIndex: vi.fn(), setTransaction: vi.fn(), setTransactionKnown: vi.fn(), setCompletionSession: vi.fn(),
    useEffect: (effect: () => void) => effect(), sessionId: 's', busy: false, connectionVersion: 1,
  });
  const code = names.map(name => declarations.get(name)).join('\n') + `\nglobalThis.open=openParameters;globalThis.load=loadParameterNames;globalThis.submit=${executeBinding};globalThis.close=closeParameters;globalThis.getPort=()=>(${reuseBinding});globalThis.confirm=()=>{${completionEffect}};`;
  runInContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  listeners.add(() => context.parameterReuse.current?.observe());
  return { context, invoke, workspace,
    async open() { context.open(); const info = await context.load(); return { info, port: context.getPort() as QueryParameterReusePort }; },
    edit(value: string) { sql = value; version++; context.parameterReuse.current?.observe(); },
    outcome(value: QueryOutcome | Error) { result = value; }, serverDatabase(value: string | null) { serverDatabase = value; },
    wait(value: Promise<void>) { waitForExecution = value; },
    waitForConfirmation(value: Promise<void>) { waitForCompletion = value; },
    confirmBeforeSettled() { earlyConfirmation = true; },
    async settled() { await vi.waitFor(() => expect(context.busyRef.current).toBe(false)); await Promise.resolve(); },
    async confirm() { const count = context.setCompletionSession.mock.calls.length; context.confirm(); await vi.waitFor(() => expect(context.setCompletionSession.mock.calls.length).toBeGreaterThan(count)); await Promise.resolve(); },
    dispose() { context.parameterReuse.current?.dispose(); listeners.clear(); },
  };
}

describe('参数复用真实QueryTab接线', () => {
  it('明确勾选成功执行后才可填入；unknown记账期间没有可读组，值不写工作区', async () => {
    const f = fixture(); try {
      const first = await f.open(); expect(first.port.has(first.info)).toBe(false); expect(first.port.setOptIn(true)).toBe(true); expect(first.port.stage(first.info, params)).toBe(true);
      f.context.submit(params); await f.settled(); expect(first.port.read(first.info)).toBeNull();
      expect(f.invoke.mock.calls.filter(([command]) => command === 'query.executeParameterized')).toHaveLength(1);
      expect(f.workspace.updateTab).toHaveBeenCalledWith('tab', { database: undefined, databaseContext: { state: 'unknown' } });
      await f.confirm(); const next = await f.open(); expect(next.port.has(next.info)).toBe(true); expect(next.port.read(next.info)).toEqual(params);
      expect(JSON.stringify(f.workspace)).not.toContain(params[0].value); expect(JSON.stringify(f.workspace.updateTab.mock.calls)).not.toContain(params[0].value);
      expect(f.invoke.mock.calls.map(([command]) => command)).not.toContain('queries.save');
    } finally { f.dispose(); }
  });
  it('React先确认默认库、后收到成功Promise时仍发布；后继只读确认不重复执行SQL', async () => {
    const f = fixture(); try {
      const first = await f.open(); first.port.setOptIn(true); expect(first.port.stage(first.info, params)).toBe(true);
      const confirmed = vi.spyOn(f.context.parameterReuse.current, 'confirmed');
      f.confirmBeforeSettled(); f.context.submit(params); await f.settled();
      expect(f.context.setCompletionSession).toHaveBeenCalled();
      expect(confirmed.mock.results[0]?.value).toBe(false);
      // 不手动调用confirm：正式提交包装必须自行补读缓存，覆盖两个完成信号的相反时序。
      const next = await f.open(); expect(next.port.has(next.info)).toBe(true); expect(next.port.read(next.info)).toEqual(params);
      expect(f.invoke.mock.calls.filter(([command]) => command === 'query.executeParameterized')).toHaveLength(1);
    } finally { f.dispose(); }
  });
  it.each(['session', 'task', 'connection', 'closed'] as const)('补读协议缓存迟到时%s改变，不能覆盖默认库或后继候选', async changed => {
    const f = fixture(); try {
      const first = await f.open(); first.port.setOptIn(true); expect(first.port.stage(first.info, params)).toBe(true);
      let release!: () => void; f.waitForConfirmation(new Promise<void>(resolve => { release = resolve; }));
      f.context.submit(params); await f.settled();
      await vi.waitFor(() => expect(f.invoke.mock.calls.filter(([command]) => command === 'query.completionState')).toHaveLength(2));
      const updates = f.workspace.updateTab.mock.calls.length, errors = f.context.setError.mock.calls.length;
      if (changed === 'session') f.context.sessionRef.current = 'next-session';
      if (changed === 'task') f.context.task.current = 'next-task';
      if (changed === 'connection') f.workspace.connectionVersions.c++;
      if (changed === 'closed') f.context.alive.current = false;
      f.context.parameterReuse.current.observe(); release();
      await Promise.all(f.invoke.mock.results.map(result => result.value)); await Promise.resolve();
      expect(f.workspace.updateTab.mock.calls).toHaveLength(updates); expect(first.port.current()).toBe(false);
      // 正常执行开始已setError('')；迟到回包不得新增错误回写，不能把原正常清空当作迟到行为。
      expect(f.context.setError.mock.calls).toHaveLength(errors);
    } finally { f.dispose(); }
  });
  it.each(['failure', 'script-errors', 'incomplete-script', 'throw', 'cancel'] as const)('%s不得发布失败输入', async kind => {
    const f = fixture(); try {
      const first = await f.open(); first.port.setOptIn(true); expect(first.port.stage(first.info, params)).toBe(true);
      if (kind === 'failure') f.outcome({ results: [], elapsedMs: 1, failure: { message: '失败', statementOrdinal: 1, statementsCompleted: 0 } });
      if (kind === 'script-errors' || kind === 'incomplete-script') f.outcome({ results: [], elapsedMs: 1, scriptReport: { reachedEnd: kind !== 'incomplete-script', statementsAttempted: 1, statementsCompleted: 0, errors: kind === 'script-errors' ? [{ message: '失败', statementOrdinal: 1, statementsCompleted: 0 }] : [] } as QueryOutcome['scriptReport'] });
      if (kind === 'throw') f.outcome(Error('网络失败'));
      f.context.submit(params); if (kind === 'cancel') f.context.cancelledQuery.current = f.context.task.current;
      await f.settled(); await f.confirm(); const next = await f.open(); expect(next.port.has(next.info)).toBe(false);
    } finally { f.dispose(); }
  });
  it('来源漂移只撤暂存；未勾选仍执行原捕获模板，不重放', async () => {
    const f = fixture(); try {
      const original = await f.open(); f.edit('SELECT 2'); expect(original.port.current()).toBe(false);
      f.context.submit(params); await f.settled(); await f.confirm();
      const sent = f.invoke.mock.calls.filter(([command]) => command === 'query.executeParameterized') as unknown as [string, { sql: string; parameters: unknown }][];
      expect(sent).toHaveLength(1); expect(sent[0][1]).toMatchObject({ sql: 'SELECT :value', parameters: params });
      const next = await f.open(); expect(next.port.has(next.info)).toBe(false);
    } finally { f.dispose(); }
  });
  it('已提交后原正文改变或真实默认库改变均不能发布暂存', async () => {
    for (const changed of ['source', 'database']) {
      const f = fixture(); try {
        let finish!: () => void; f.wait(new Promise<void>(resolve => { finish = resolve; }));
        const first = await f.open(); first.port.setOptIn(true); first.port.stage(first.info, params); f.context.submit(params);
        await vi.waitFor(() => expect(f.invoke.mock.calls.some(([command]) => command === 'query.executeParameterized')).toBe(true));
        if (changed === 'source') f.edit('SELECT 2'); else f.serverDatabase('another');
        finish(); await f.settled(); await f.confirm(); const next = await f.open(); expect(next.port.has(next.info)).toBe(false);
      } finally { f.dispose(); }
    }
  });
  it('取消表单不投递SQL，旧取消不能删除后继表单', async () => {
    const f = fixture(); try {
      const old = await f.open(); f.context.close(); expect(old.port.current()).toBe(false); const next = await f.open();
      f.context.parameterReuse.current.close(old.port); expect(next.port.current()).toBe(true);
      expect(f.invoke.mock.calls.some(([command]) => command === 'query.executeParameterized')).toBe(false);
    } finally { f.dispose(); }
  });
});
