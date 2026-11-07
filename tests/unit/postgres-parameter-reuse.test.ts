import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import type { QueryOutcome } from '../../src/shared/contracts';
import type { QueryParameterNames } from '../../src/shared/queryParameters';
import { QueryParameterReuseOwner } from '../../src/renderer/queryParameterReuseOwner';
import type { QueryParameterReusePort } from '../../src/renderer/queryParameterReusePort';

const source = readFileSync(new URL('../../src/renderer/components/PostgresQueryTab.tsx', import.meta.url), 'utf8');
const tree = ts.createSourceFile('PostgresQueryTab.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declarations = new Map<string, string>();
function inspect(node: ts.Node): void {
  if (ts.isFunctionDeclaration(node) && node.name) declarations.set(node.name.text, node.getText(tree));
  ts.forEachChild(node, inspect);
}
inspect(tree);
const methods = ['parameterReuseInput', 'same', 'parameterCurrent', 'ensure', 'readState', 'run', 'names', 'openParameters'];
if (methods.some(name => !declarations.has(name))) throw Error('PostgreSQL 参数父层接线缺失');
const params = [{name: 'p1', type: 'decimal' as const, value: '0.12345678901234567890123456789012345678'}];

/** 执行正式父层方法与真实 RAM Owner，只替换数据库 IPC 和 Monaco 公开读取端口。 */
function fixture() {
  let sql = 'SELECT $1::numeric', version = 1, sequence = 0, mode = true, selection: [number, number] = [0, 0];
  let result: QueryOutcome | Error = {results: [], elapsedMs: 1}, wait: Promise<void> | undefined, known = true;
  const profile = {id: 'c', dialect: 'postgresql', database: 'db'};
  const tab = {id: 'tab', kind: 'query', connectionId: 'c', database: 'db', sql};
  const workspace = {connections: [profile], connectionVersions: {c: 1}, settings: {tabs: [tab], activeTabId: tab.id, resultLimit: 200},
    activeJobs: {} as Record<string, boolean>, setDirty: vi.fn()};
  const model = {getValue: () => sql, getVersionId: () => version, isDisposed: () => false,
    getValueInRange: () => sql.slice(...selection), getOffsetAt: (position: {column: number}) => position.column - 1};
  const editor = {getModel: () => model, getSelection: () => ({
    startLineNumber: 1, endLineNumber: 1, startColumn: selection[0] + 1, endColumn: selection[1] + 1,
    isEmpty: () => selection[0] === selection[1], getStartPosition: () => ({lineNumber: 1, column: selection[0] + 1}),
    getEndPosition: () => ({lineNumber: 1, column: selection[1] + 1}),
  }), getSelections: () => [editor.getSelection()]};
  const metadata = (): QueryParameterNames => ({names: ['p1'], warnings: [], maxDecimalScale: 38, allowTimeEndpointFraction: false,
    ansiQuotes: true, ansiQuotesKnown: true, noBackslashEscapes: mode, noBackslashEscapesKnown: true});
  const invoke = vi.fn(async (command: string): Promise<unknown> => {
    if (command === 'connections.open') return {};
    if (command === 'sessions.open') return {sessionId: 'pg:s'};
    if (command === 'sessions.close') return {};
    if (command === 'query.parameterNames') return metadata();
    if (command === 'query.sessionState') return {transactionKnown: known, transactionOpen: false, transactionFailed: false, broken: !known, standardConformingStrings: mode};
    if (command === 'query.executeParameterized' || command === 'query.execute') {
      await wait;
      if (result instanceof Error) throw result;
      return result;
    }
    throw Error('意外 IPC：' + command);
  });
  const context: any = createContext({QueryParameterReuseOwner, JSON, Error, tab, profile, scope: {profile, version: 1, database: 'db'},
    version: 1, currentTab: () => tab, useWorkspace: {getState: () => workspace}, editor: {current: editor},
    alive: {current: true}, life: {current: {}}, phase: {current: undefined}, session: {current: undefined}, closeRef: {current: undefined},
    parameters: {current: undefined}, parameterReuse: {current: null}, parameterTask: {current: ''}, parameterState: {current: {sessionId: '', known: false}},
    state: {transactionKnown: true}, acquireWorkspaceBusy: () => ({release: vi.fn()}), available: () => true, commandEditor: () => true,
    source: () => sql, uid: () => 'task-' + ++sequence, invoke, errorMessage: (error: Error) => error.message,
    text: {changed: '来源已变', unknown: '未知状态', noSql: '空 SQL'}, pinStateRef: {current: {items: []}},
    setBusy: vi.fn(), setError: vi.fn(), resetResultView: vi.fn(), setOutcome: vi.fn(), setSelected: vi.fn(),
    clearFailureSource: vi.fn(), captureFailureSource: vi.fn(), failureSource: {current: undefined},
    continueOnError: false, scriptFailureRanges: {current: new Set()},
    setState: (value: object) => { context.state = value; },
    setParameterOwner: (value: unknown) => { context.parameters.current = value; },
  });
  runInContext(ts.transpileModule(methods.map(name => declarations.get(name)).join('\n'), {
    compilerOptions: {target: ts.ScriptTarget.ES2022},
  }).outputText, context);
  return {context, invoke, workspace, model, tab, metadata,
    async open() {
      context.openParameters(); const owner = context.parameters.current;
      const info = await context.names(owner); return {owner, info, port: owner.reuse as QueryParameterReusePort};
    },
    async execute(owner: unknown) { context.run('normal', params, owner); await context.phase.current?.work; },
    edit(value: string) { sql = value; version++; tab.sql = value; context.parameterReuse.current?.observe(); },
    select(start: number, end = start) { selection = [start, end]; context.parameterReuse.current?.observe(); },
    outcome(value: QueryOutcome | Error) { result = value; }, waitFor(value: Promise<void>) { wait = value; },
    mode(value: boolean) { mode = value; }, known(value: boolean) { known = value; }, dispose() { context.parameterReuse.current?.dispose(); },
  };
}

describe('PostgreSQL 原参数执行与显式 RAM 暂存', () => {
  it('首次未连接识别建立准确会话；成功后下一次只显式读副本，仍需明确执行', async () => {
    const f = fixture(); try {
      const first = await f.open(); expect(first.port.current()).toBe(true); expect(first.port.has(first.info)).toBe(false);
      expect(first.port.setOptIn(true)).toBe(true); expect(first.port.stage(first.info, params)).toBe(true);
      await f.execute(first.owner);
      const next = await f.open(); expect(next.port.read(next.info)).toEqual(params);
      const copied = next.port.read(next.info)!; copied[0].value = '改副本'; expect(next.port.read(next.info)).toEqual(params);
      expect(f.invoke.mock.calls.filter(([name]) => name === 'query.executeParameterized')).toHaveLength(1);
    } finally { f.dispose(); }
  });
  it('默认不暂存；取消只撤旧表单，忘记不修改外部输入', async () => {
    const f = fixture(); try {
      const first = await f.open(); await f.execute(first.owner);
      const second = await f.open(); expect(second.port.has(second.info)).toBe(false);
      second.port.setOptIn(true); second.port.stage(second.info, params); await f.execute(second.owner);
      const third = await f.open(); f.context.parameterReuse.current.close(third.port);
      const fourth = await f.open(); expect(fourth.port.read(fourth.info)).toEqual(params);
      fourth.port.forget(); expect(fourth.port.read(fourth.info)).toBeNull(); expect(params[0].value).toContain('123456789');
    } finally { f.dispose(); }
  });
  it.each(['failure', 'throw', 'cancel', 'unknown', 'script'] as const)('%s不发布候选参数', async kind => {
    const f = fixture(); try {
      let finish!: () => void; f.waitFor(new Promise<void>(resolve => { finish = resolve; }));
      const first = await f.open(); first.port.setOptIn(true); first.port.stage(first.info, params);
      if (kind === 'failure') f.outcome({results: [], elapsedMs: 1, failure: {message: '失败', statementOrdinal: 1, statementsCompleted: 0}});
      if (kind === 'throw') f.outcome(Error('网络失败'));
      if (kind === 'script') f.outcome({results: [], elapsedMs: 1, scriptReport: {reachedEnd: false, errors: []} as unknown as QueryOutcome['scriptReport']});
      if (kind === 'unknown') f.known(false);
      const execution = f.execute(first.owner); await Promise.resolve();
      await vi.waitFor(() => expect(f.invoke.mock.calls.some(([name]) => name === 'query.executeParameterized')).toBe(true));
      if (kind === 'cancel') f.context.phase.current.cancelled = true;
      finish(); await execution;
      f.known(true);
      f.context.parameterState.current.known = true; f.context.state.transactionKnown = true;
      const next = await f.open(); expect(next.port.has(next.info)).toBe(false);
    } finally { f.dispose(); }
  });
  it.each(['model', 'selection', 'connection', 'session', 'database', 'saved', 'file', 'closing'] as const)('%s变化及恢复原值均不复活旧参数', async kind => {
    const f = fixture(); try {
      const first = await f.open(); first.port.setOptIn(true); first.port.stage(first.info, params); await f.execute(first.owner);
      const second = await f.open(); expect(second.port.has(second.info)).toBe(true);
      if (kind === 'model') { f.edit('SELECT 2'); f.edit('SELECT $1::numeric'); }
      if (kind === 'selection') { f.select(0, 6); f.select(0); }
      const mutate = (target: any, key: string, temporary: unknown) => { const old = target[key]; target[key] = temporary;
        f.context.parameterReuse.current.observe(); target[key] = old; f.context.parameterReuse.current.observe(); };
      if (kind === 'connection') mutate(f.workspace.connectionVersions, 'c', 2);
      if (kind === 'session') mutate(f.context.session.current, 'id', 'pg:other');
      if (kind === 'database') mutate(f.tab, 'database', 'other');
      if (kind === 'saved') mutate(f.tab, 'sourceBinding', {id: 'q', digest: 'new', context: {state: 'known', database: 'db'}});
      if (kind === 'file') mutate(f.tab, 'fileSourceBinding', {id: 'f', revision: 1});
      if (kind === 'closing') mutate(f.context.closeRef, 'current', {});
      expect(second.port.has(second.info)).toBe(false);
    } finally { f.dispose(); }
  });
  it('实际字符串模式参与指纹；变化后拒绝填入并清除原组', async () => {
    const f = fixture(); try {
      const first = await f.open(); first.port.setOptIn(true); first.port.stage(first.info, params); await f.execute(first.owner);
      f.mode(false); const next = await f.open(); expect(next.port.has(next.info)).toBe(false);
      f.mode(true); expect(next.port.has(f.metadata())).toBe(false);
    } finally { f.dispose(); }
  });
  it('选区来源失效仅撤暂存，未勾选的原表单执行仍使用原捕获 SQL', async () => {
    const f = fixture(); try {
      const first = await f.open(); f.select(0, 6); expect(first.port.current()).toBe(false);
      await f.execute(first.owner);
      expect(f.invoke.mock.calls.filter(([name]) => name === 'query.executeParameterized')).toHaveLength(1);
      expect(f.context.setError).toHaveBeenLastCalledWith('');
    } finally { f.dispose(); }
  });
});
