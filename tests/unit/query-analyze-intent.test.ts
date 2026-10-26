import type * as monaco from 'monaco-editor';
import { describe, expect, it, vi } from 'vitest';
import { QueryAnalyzeIntent, type QueryAnalyzeScope } from '../../src/renderer/queryAnalyzeIntent';

const changedMessage = '原实际执行分析来源已变化';
const knownDatabase = (database: string | null) => JSON.stringify([database ?? undefined, { state: 'known', database }]);
const unknownDatabase = JSON.stringify([undefined, { state: 'unknown' }]);

/** 事件端口仅模拟Monaco与工作台生命周期，不执行SQL，也不冒充真实模型或实库证据。 */
function fixture(sourceValue = 'SELECT 1; SELECT 2;') {
  const listeners = new Map<string, Set<() => void>>();
  let source = sourceValue, version = 1, disposed = false, failSubscription = false;
  let selection = { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1, selectionStartLineNumber: 1, selectionStartColumn: 1, positionLineNumber: 1, positionColumn: 1 };
  const scope: QueryAnalyzeScope = {
    tabId: 'query-tab', connectionId: 'connection', connectionVersion: 1, connection: { id: 'connection', host: '离线合成来源' },
    sessionId: 'original-session', draft: source, databaseKey: knownDatabase('原库'), sourceKey: JSON.stringify([undefined, undefined]), present: true, active: true,
  };
  const changed = vi.fn();
  const listen = (kind: string, action: () => void) => {
    const group = listeners.get(kind) ?? new Set<() => void>(); group.add(action); listeners.set(kind, group);
    return { dispose: () => { group.delete(action); } };
  };
  const emit = (kind: string) => { for (const action of [...listeners.get(kind) ?? []]) action(); };
  const model = {
    getValue: () => source, getValueInRange: (range: typeof selection) => source.slice(range.startColumn - 1, range.endColumn - 1),
    getVersionId: () => version, isDisposed: () => disposed,
    onDidChangeContent: (action: () => void) => listen('content', action), onWillDispose: (action: () => void) => listen('model-dispose', action),
  };
  let activeModel: unknown = model;
  const editor = {
    getModel: () => activeModel, getSelection: () => selection,
    onDidChangeModel: (action: () => void) => listen('model', action), onDidDispose: (action: () => void) => listen('editor-dispose', action),
    onDidChangeCursorSelection: (action: () => void) => listen('selection', action),
  };
  return {
    scope, editor, model, changed, listeners, emit,
    create: () => new QueryAnalyzeIntent(editor as unknown as monaco.editor.IStandaloneCodeEditor, () => scope, action => {
      if (failSubscription) throw Error('合成订阅失败');
      return listen('scope', action).dispose;
    }, changed, changedMessage),
    select: (startColumn: number, endColumn: number) => {
      selection = { ...selection, startColumn, endColumn, selectionStartColumn: startColumn, positionColumn: endColumn }; emit('selection');
    },
    edit: (value: string) => { source = value; version++; scope.draft = value; emit('content'); emit('scope'); },
    swap: (value: unknown) => { activeModel = value; emit('model'); },
    disposeModel: () => { disposed = true; emit('model-dispose'); },
    failSubscription: () => { failSubscription = true; },
    bumpVersion: () => { version++; },
  };
}

describe('实际执行分析捕获原文和固定会话', () => {
  it('有非空选区时冻结原选区，保留原空白，不替换为标签草稿或完整模型', () => {
    const current = fixture(); current.select(10, 20); current.scope.draft = '标签保存的旧草稿';
    const intent = current.create();
    expect(intent.source).toBe(' SELECT 2;'); expect(current.model.getValue()).toBe('SELECT 1; SELECT 2;');
    intent.ready('原库'); intent.beginSend(); intent.assertCurrent(); intent.dispose();
  });

  it.each(['collapsed', 'whitespace'] as const)('%s选区退回原模型全文，不读取标签保存的旧草稿', kind => {
    const current = fixture(); if (kind === 'whitespace') current.select(10, 11);
    current.scope.draft = '标签保存的旧草稿'; const intent = current.create();
    expect(intent.source).toBe('SELECT 1; SELECT 2;'); intent.dispose();
  });

  it('准备阶段允许建立并绑定一个固定新会话，此后不能改绑后继会话', () => {
    const current = fixture(); current.scope.sessionId = '';
    const intent = current.create(); current.scope.sessionId = 'opened-session'; current.emit('scope');
    intent.bindSession('opened-session'); intent.assertCurrent();
    current.scope.sessionId = 'replacement-session';
    expect(() => intent.bindSession('replacement-session')).toThrow(changedMessage);
    current.scope.sessionId = 'opened-session'; current.emit('scope');
    expect(() => intent.assertCurrent()).toThrow(changedMessage); expect(current.changed).toHaveBeenCalledTimes(1);
    intent.dispose();
  });

  it('已有事务会话不允许在准备中换成另一个会话，即使随后恢复也永久失效', () => {
    const current = fixture(), intent = current.create();
    expect(() => intent.bindSession('another-session')).toThrow(changedMessage);
    current.scope.sessionId = 'original-session'; current.emit('scope');
    expect(() => intent.assertCurrent()).toThrow(changedMessage); intent.dispose();
  });

  it.each(['真实默认库', null])('ready保留原会话确认值：%s，不从旧标签库推测', database => {
    const current = fixture(), intent = current.create();
    expect(() => intent.database).toThrow(changedMessage);
    current.scope.databaseKey = knownDatabase(database); current.emit('scope');
    intent.ready(database); expect(intent.database).toBe(database); intent.assertCurrent(); intent.dispose();
  });

  it('无固定会话不能ready或发送，确认准备完成后一次交付', () => {
    const current = fixture(); current.scope.sessionId = ''; const intent = current.create();
    expect(() => intent.ready('原库')).toThrow(changedMessage); expect(() => intent.beginSend()).toThrow(changedMessage);
    current.scope.sessionId = 'opened-session'; intent.bindSession('opened-session'); intent.ready('原库');
    intent.beginSend(); expect(() => intent.beginSend()).toThrow(changedMessage); intent.dispose();
  });

  it('确认完成后即使是原会话编号，也不能重新绑定准备流程', () => {
    const current = fixture(), intent = current.create(); intent.ready('原库');
    expect(() => intent.bindSession('original-session')).toThrow(changedMessage);
    expect(() => intent.assertCurrent()).toThrow(changedMessage); intent.dispose();
  });
});

describe('确认来源变化与ABA永久撤销', () => {
  it.each(['tabId', 'connectionId', 'connectionVersion', 'connection', 'draft', 'sessionId', 'present', 'active'] as const)('%s变化再恢复不能复活原确认', key => {
    const current = fixture(), intent = current.create(); intent.ready('原库');
    const before = current.scope[key];
    const after = key === 'connection' ? { id: 'connection', host: '变更配置' } : typeof before === 'boolean' ? false : typeof before === 'number' ? before + 1 : 'changed';
    Object.assign(current.scope, { [key]: after }); current.emit('scope');
    Object.assign(current.scope, { [key]: before }); current.emit('scope');
    expect(() => intent.assertCurrent()).toThrow(changedMessage); expect(current.changed).toHaveBeenCalledTimes(1); intent.dispose();
  });

  it.each([
    [{ id: 'saved', digest: 'original' }, undefined],
    [undefined, { token: 'file-original', digest: 'original' }],
  ])('保存查询或SQL文件绑定变更再恢复均不能复活原确认：%j', (query, file) => {
    const current = fixture(); current.scope.sourceKey = JSON.stringify([query, file]);
    const intent = current.create(); intent.ready('原库'); const before = current.scope.sourceKey;
    current.scope.sourceKey = JSON.stringify([query ? { ...query, digest: 'changed' } : query, file ? { ...file, digest: 'changed' } : file]); current.emit('scope');
    current.scope.sourceKey = before; current.emit('scope');
    expect(() => intent.assertCurrent()).toThrow(changedMessage); intent.dispose();
  });

  it.each(['其他库', null, 'unknown'] as const)('默认库确认后变化并恢复不能复活：%s', database => {
    const current = fixture(), intent = current.create(); intent.ready('原库');
    current.scope.databaseKey = database === 'unknown' ? unknownDatabase : knownDatabase(database); current.emit('scope');
    current.scope.databaseKey = knownDatabase('原库'); current.emit('scope');
    expect(() => intent.assertCurrent()).toThrow(changedMessage); expect(intent.database).toBe('原库'); intent.dispose();
  });

  it('编辑并撤销至相同正文仍不能使用旧确认', () => {
    const current = fixture(), intent = current.create(); intent.ready('原库');
    current.edit('SELECT 变更'); current.edit('SELECT 1; SELECT 2;');
    expect(() => intent.assertCurrent()).toThrow(changedMessage); expect(intent.source).toBe('SELECT 1; SELECT 2;'); intent.dispose();
  });

  it('换模型后换回原对象仍不能发送，原模型版本也须保持', () => {
    const current = fixture(), intent = current.create(); intent.ready('原库');
    current.swap({}); current.swap(current.model);
    expect(() => intent.assertCurrent()).toThrow(changedMessage); intent.dispose();
    const silent = fixture(), silentIntent = silent.create(); silentIntent.ready('原库'); silent.bumpVersion();
    expect(() => silentIntent.assertCurrent()).toThrow(changedMessage); silentIntent.dispose();
  });

  it('原选区离开再恢复不能授权旧SQL，相同选区的重复通知不会误撤销', () => {
    const current = fixture(); current.select(1, 10); const intent = current.create(); intent.ready('原库');
    current.select(1, 10); intent.assertCurrent(); expect(current.changed).not.toHaveBeenCalled();
    current.select(10, 20); current.select(1, 10);
    expect(() => intent.assertCurrent()).toThrow(changedMessage); expect(intent.source).toBe('SELECT 1;'); intent.dispose();
  });

  it.each(['model-dispose', 'editor-dispose'] as const)('%s事件撤销待确认或待发送意图', event => {
    const current = fixture(), intent = current.create(); intent.ready('原库');
    if (event === 'model-dispose') current.disposeModel(); else current.emit(event);
    expect(() => intent.beginSend()).toThrow(changedMessage); intent.dispose();
  });
});

describe('发送前持久化未知上下文只允许本次单向准备', () => {
  it('只在确认已交付后允许标未知，原真实默认库供Engine再次核验', () => {
    const current = fixture(), intent = current.create(); intent.ready('原库');
    expect(() => intent.allowContextPreparation()).toThrow(changedMessage);
    intent.beginSend(); intent.allowContextPreparation(); current.scope.databaseKey = unknownDatabase; current.emit('scope');
    intent.assertCurrent(); expect(intent.database).toBe('原库'); expect(current.changed).not.toHaveBeenCalled(); intent.dispose();
  });

  it('未授权准备而将持久化上下文改为unknown，不能继续发送', () => {
    const current = fixture(), intent = current.create(); intent.ready('原库'); intent.beginSend();
    current.scope.databaseKey = unknownDatabase; current.emit('scope');
    expect(() => intent.assertCurrent()).toThrow(changedMessage); intent.dispose();
  });

  it('接受本次unknown后再恢复原known并回到unknown，仍永久撤销旧确认', () => {
    const current = fixture(), intent = current.create(); intent.ready('原库'); intent.beginSend(); intent.allowContextPreparation();
    current.scope.databaseKey = unknownDatabase; current.emit('scope'); intent.assertCurrent();
    current.scope.databaseKey = knownDatabase('原库'); current.emit('scope');
    current.scope.databaseKey = unknownDatabase; current.emit('scope');
    expect(() => intent.assertCurrent()).toThrow(changedMessage); expect(current.changed).toHaveBeenCalledTimes(1); intent.dispose();
  });

  it('准备窗口不能放行另一个真实目标，也不能通过重复打开准备恢复授权', () => {
    const current = fixture(), intent = current.create(); intent.ready('原库'); intent.beginSend(); intent.allowContextPreparation();
    current.scope.databaseKey = knownDatabase('其他库'); current.emit('scope');
    expect(() => intent.allowContextPreparation()).toThrow(changedMessage);
    current.scope.databaseKey = knownDatabase('原库'); current.emit('scope');
    expect(() => intent.assertCurrent()).toThrow(changedMessage); intent.dispose();
  });

  it('同一个发送阶段不能重复授权持久化准备', () => {
    const current = fixture(), intent = current.create(); intent.ready('原库'); intent.beginSend(); intent.allowContextPreparation();
    expect(() => intent.allowContextPreparation()).toThrow(changedMessage); intent.dispose();
  });
});

describe('确认意图的资源释放', () => {
  it('取消和完成释放全部模型、编辑器及工作台监听，重复释放不触碰用户模型', () => {
    const current = fixture(), intent = current.create(); intent.ready('原库');
    expect([...current.listeners.values()].some(group => group.size > 0)).toBe(true);
    intent.dispose(); intent.dispose();
    expect([...current.listeners.values()].every(group => group.size === 0)).toBe(true);
    for (const kind of current.listeners.keys()) current.emit(kind);
    expect(current.changed).not.toHaveBeenCalled(); expect(current.model.getValue()).toBe('SELECT 1; SELECT 2;'); expect(current.model.isDisposed()).toBe(false);
    expect(() => intent.assertCurrent()).toThrow(changedMessage);
  });

  it('注册工作台监听失败时释放此前已建立的模型与编辑器监听', () => {
    const current = fixture(); current.failSubscription();
    expect(() => current.create()).toThrow('合成订阅失败');
    expect([...current.listeners.values()].every(group => group.size === 0)).toBe(true); expect(current.model.isDisposed()).toBe(false);
  });

  it.each(['present', 'active', 'connection'] as const)('初始%s不满足时不分配监听器', key => {
    const current = fixture(); Object.assign(current.scope, { [key]: key === 'connection' ? undefined : false });
    expect(() => current.create()).toThrow(changedMessage); expect(current.listeners.size).toBe(0);
  });

  it('空模型正文不能创建可执行确认，也不会泄露监听器', () => {
    const current = fixture('   '); expect(() => current.create()).toThrow('非空'); expect(current.listeners.size).toBe(0);
  });
});
