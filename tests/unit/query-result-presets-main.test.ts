import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { LocalStore } from '../../src/main/storage';
import { QueryResultPresetSources } from '../../src/main/queryResultPresetSources';
import type { QueryResultPresetSnapshot, QueryResultPresetValue } from '../../src/shared/queryResultPresets';
import { mainColumnsHarness } from './main-columns-owner-harness';

const require = createRequire(import.meta.url), wasm = require.resolve('sql.js/dist/sql-wasm.wasm');
const target = { connectionId: 'trusted' };
const profile = { id: target.connectionId, name: '离线Main连接', host: 'offline.invalid', port: 3306, user: '合成用户', dialect: 'mysql' as const, color: '#ffffff', group: '离线', rememberPassword: false };
const protector = { available: () => false, encrypt: (_value: string): string => { throw Error('不访问真实凭据'); }, decrypt: (_value: string): string => { throw Error('不访问真实凭据'); } };
const columns = [{ key: 'id', name: '重复别名', type: 'BIGINT' }, { key: '__proto__', name: '重复别名', type: 'TEXT' }];
const value: QueryResultPresetValue = { columns, visible: [columns[1], columns[0]], configuration: {
  expression: { mode: 'AND', children: [{ mode: 'OR', children: [{ column: 'id', operator: 'in', value: '', values: ['9007199254740993', '18446744073709551615'], enabled: false }, { column: '__proto__', operator: 'null', value: '' }] }] },
  sort: [{ column: '__proto__', direction: 'DESC', nulls: 'FIRST', ignoreCase: true }, { column: 'id', direction: 'ASC', nulls: 'LAST', ignoreCase: false }]
} };
const fixtures: { f: ReturnType<typeof mainColumnsHarness>; store: LocalStore; directory: string }[] = [];

/** 令牌只能取真实IPC签发结果，不手造成功授权或替换存储的CRUD行为。 */
function packet(snapshot: QueryResultPresetSnapshot) {
  return { ...target, source: snapshot.source, expectedRevision: snapshot.revision, bindingToken: snapshot.bindingToken };
}

/** 原Main AST分发及IPC、真实所有权和真实SQLite组合；broker仅作禁止调用的哨兵。 */
async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'dbark-result-presets-main-')), file = join(directory, 'local.sqlite');
  const store = await LocalStore.open(file, wasm, protector); store.saveConnection(profile);
  const f = mainColumnsHarness();
  // AST夹具把Main放入独立vm，而生产Main与LocalStore同属一个realm。
  // 仅将调用参数结构化复制回存储realm；实际方法、schema、CAS及SQLite写盘仍全部执行。
  f.context.store = new Proxy(store, { get(instance, key) {
    const member = Reflect.get(instance, key, instance);
    return typeof member === 'function' ? (...args: unknown[]) => Reflect.apply(member, instance, args.map(argument => structuredClone(argument))) : member;
  } });
  f.setRevision(store.connectionRevision());
  let now = 0;
  f.context.resultPresetSources = new QueryResultPresetSources({ assert: owner => f.capabilities.assertCapturedOwner(owner), same: (left, right) => f.capabilities.sharesDocumentOwner(left, right) }, () => now);
  f.request.mockImplementation(async () => { throw Error('结果整理不得调用数据库broker'); });
  fixtures.push({ f, store, directory });
  return { f, store, file, advance: (milliseconds: number) => { now += milliseconds; } };
}

/** 只经原IPC建立初始命名项，后续用例使用其实际签发的来源和修订。 */
async function savedFixture() {
  const fixtureValue = await fixture(), listed: QueryResultPresetSnapshot = await fixtureValue.f.run('result.presets.list', target);
  const saved: QueryResultPresetSnapshot = await fixtureValue.f.run('result.presets.save', { ...packet(listed), name: '完整方案', value });
  return { ...fixtureValue, listed, saved, id: saved.entries[0].id };
}

afterEach(() => {
  for (const { f, store, directory } of fixtures.splice(0)) {
    try { expect(f.request).not.toHaveBeenCalled(); expect(f.tasks.size).toBe(0); }
    finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
  }
});

describe('结果命名整理的真实Main IPC与SQLite闭环', () => {
  it('五个命令经过真实IPC注册、校验、分发和文件持久化完成CRUD/read', async () => {
    const { f, store, file } = await fixture(), listed: QueryResultPresetSnapshot = await f.run('result.presets.list', target);
    expect(listed.entries).toEqual([]); expect(listed.source).toEqual(store.queryResultPresets(target).source);
    expect(listed.bindingToken).toMatch(/^[0-9a-f-]{36}$/u);
    let current: QueryResultPresetSnapshot = await f.run('result.presets.save', { ...packet(listed), name: '  完整方案  ', value });
    const id = current.entries[0].id;
    expect(current.revision).toBe(1); expect(current.entries[0].name).toBe('完整方案'); expect(current.bindingToken).not.toBe(listed.bindingToken);
    expect(await f.run('result.presets.read', { ...packet(current), id })).toEqual(value);
    current = await f.run('result.presets.rename', { ...packet(current), id, name: '重命名方案' });
    expect(current.revision).toBe(2); expect(current.entries[0].value).toEqual(value);
    const replacement = { ...value, visible: [columns[0], columns[1]] };
    current = await f.run('result.presets.save', { ...packet(current), replaceId: id, name: '覆盖并改名', value: replacement });
    expect(await f.run('result.presets.read', { ...packet(current), id })).toEqual(replacement);
    expect(store.queryResultPresets(target).entries).toEqual(current.entries);
    const persisted = await LocalStore.open(file, wasm, protector);
    try { expect(persisted.queryResultPresets(target).entries).toEqual(current.entries); } finally { persisted.close(); }
    current = await f.run('result.presets.delete', { ...packet(current), id });
    expect(current.entries).toEqual([]); expect(current.revision).toBe(4); expect(store.queryResultPresets(target).revision).toBe(4);
    expect((await f.invoke('result.presets.read', { ...packet(current), id })).ok).toBe(false);
    expect(store.queries()).toEqual([]);
  });

  it('缺真实owner直接dispatch及错误sender/frame/URL经原wrapper拒绝，不产生写盘', async () => {
    const { f, store, file, saved, id } = await savedFixture(), bytes = readFileSync(file), before = store.queryResultPresets(target);
    const commands = [
      ['result.presets.list', target], ['result.presets.save', { ...packet(saved), name: '新方案', value }],
      ['result.presets.rename', { ...packet(saved), id, name: '改名' }], ['result.presets.delete', { ...packet(saved), id }], ['result.presets.read', { ...packet(saved), id }]
    ] as const;
    for (const [command, input] of commands) await expect(f.context.actual.dispatch(command, input)).rejects.toThrow('真实字段请求来源');
    for (const change of ['sender', 'frame', 'url', 'detached'] as const) {
      const event = f.event();
      if (change === 'sender') event.sender = {};
      if (change === 'frame') event.senderFrame = { ...event.senderFrame };
      if (change === 'url') event.senderFrame = { ...event.senderFrame, url: 'app://other' };
      if (change === 'detached') event.senderFrame = { ...event.senderFrame, detached: true };
      expect((await f.invoke('result.presets.save', { ...packet(saved), name: '伪造来源', value }, event)).ok, change).toBe(false);
    }
    expect(store.queryResultPresets(target)).toEqual(before); expect(readFileSync(file).equals(bytes)).toBe(true);
  });

  it.each(['start', 'commit', 'gone', 'destroyed', 'window', 'frame'] as const)('%s导航或换文档后旧token拒绝，相同URL不能恢复', async change => {
    const { f, store, file, saved, id } = await savedFixture(), bytes = readFileSync(file);
    if (change === 'start') f.context.window.webContents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
    if (change === 'commit') f.context.window.webContents.emit('did-navigate');
    if (change === 'gone') f.context.window.webContents.emit('render-process-gone');
    if (change === 'destroyed') f.context.window.destroyContents();
    if (change === 'window') await f.context.actual.createWindow();
    if (change === 'frame') f.context.window.webContents.mainFrame = { ...f.context.window.webContents.mainFrame };
    expect((await f.invoke('result.presets.read', { ...packet(saved), id })).ok).toBe(false);
    expect((await f.invoke('result.presets.rename', { ...packet(saved), id, name: '旧文档改名' })).ok).toBe(false);
    expect(store.queryResultPresets(target).entries[0].name).toBe('完整方案'); expect(readFileSync(file).equals(bytes)).toBe(true);
    if (change === 'start' || change === 'commit' || change === 'window') {
      const fresh: QueryResultPresetSnapshot = await f.run('result.presets.list', target);
      expect(fresh.bindingToken).not.toBe(saved.bindingToken); expect(await f.run('result.presets.read', { ...packet(fresh), id })).toEqual(value);
    }
  });

  it('真实十分钟期限、随机token、跨连接和篡改source在存储写入之前拒绝', async () => {
    const { f, store, file, saved, id, advance } = await savedFixture(); store.saveConnection({ ...profile, id: 'another' });
    const fresh: QueryResultPresetSnapshot = await f.run('result.presets.list', target), bytes = readFileSync(file);
    const variants = [
      { ...packet(fresh), bindingToken: randomUUID() }, { ...packet(fresh), connectionId: 'another' },
      { ...packet(fresh), source: { ...fresh.source, connectionDigest: 'f'.repeat(64) } }, { ...packet(fresh), source: { ...fresh.source, connectionRevision: fresh.source.connectionRevision + 1 } }
    ];
    for (const input of variants) expect((await f.invoke('result.presets.delete', { ...input, id })).ok).toBe(false);
    advance(600000);
    expect((await f.invoke('result.presets.read', { ...packet(fresh), id })).ok).toBe(false);
    expect((await f.invoke('result.presets.save', { ...packet(fresh), name: '过期创建', value })).ok).toBe(false);
    expect(store.queryResultPresets(target).entries).toEqual(saved.entries); expect(readFileSync(file).equals(bytes)).toBe(true);
    const relisted: QueryResultPresetSnapshot = await f.run('result.presets.list', target);
    expect(await f.run('result.presets.read', { ...packet(relisted), id })).toEqual(value);
  });

  it('真实连接变化后旧项仍列出，rename不重签来源，明确覆盖后才能read', async () => {
    const { f, store, saved, id } = await savedFixture(); store.saveConnection({ ...profile, host: 'changed.invalid' });
    expect((await f.invoke('result.presets.read', { ...packet(saved), id })).ok).toBe(false);
    let current: QueryResultPresetSnapshot = await f.run('result.presets.list', target);
    expect(current.entries).toEqual(saved.entries); expect(current.source.connectionDigest).not.toBe(saved.source.connectionDigest);
    expect((await f.invoke('result.presets.read', { ...packet(current), id })).ok).toBe(false);
    current = await f.run('result.presets.rename', { ...packet(current), id, name: '旧来源改名' });
    expect(current.entries[0].connectionDigest).toBe(saved.entries[0].connectionDigest);
    expect((await f.invoke('result.presets.read', { ...packet(current), id })).ok).toBe(false);
    current = await f.run('result.presets.save', { ...packet(current), replaceId: id, name: '明确恢复', value });
    expect(await f.run('result.presets.read', { ...packet(current), id })).toEqual(value);
  });

  it('有效token也不能绕过旧document revision，删除墓碑阻断创建ABA', async () => {
    const { f, store, file, listed, saved, id } = await savedFixture();
    const renamed: QueryResultPresetSnapshot = await f.run('result.presets.rename', { ...packet(saved), id, name: '较新修订' }), bytes = readFileSync(file);
    for (const [command, extra] of [['result.presets.read', { id }], ['result.presets.save', { replaceId: id, name: '旧覆盖', value }], ['result.presets.rename', { id, name: '旧改名' }], ['result.presets.delete', { id }]] as const) {
      expect((await f.invoke(command, { ...packet(saved), ...extra })).ok, command).toBe(false);
    }
    expect(readFileSync(file).equals(bytes)).toBe(true);
    const removed: QueryResultPresetSnapshot = await f.run('result.presets.delete', { ...packet(renamed), id }); expect(removed.revision).toBe(3);
    expect((await f.invoke('result.presets.save', { ...packet(listed), name: '旧空文档创建', value })).ok).toBe(false);
    expect(store.queryResultPresets(target).entries).toEqual([]); expect(store.queryResultPresets(target).revision).toBe(3);
  });

  it.each(['result.presets.list', 'result.presets.save', 'result.presets.rename', 'result.presets.delete', 'result.presets.read'] as const)('%s的dispatch成功后至wrapper发布前导航仍拒绝晚回包', async command => {
    const { f, store, saved, id } = await savedFixture();
    const input = command === 'result.presets.list' ? target : command === 'result.presets.save' ? { ...packet(saved), name: '待发布创建', value } : command === 'result.presets.rename' ? { ...packet(saved), id, name: '待发布改名' } : { ...packet(saved), id };
    const operation = f.invoke(command, input);
    // dispatch在首await前真实执行完成；同一调用栈撤销原文档，原wrapper恢复时必须再核验。
    f.context.window.webContents.emit('did-navigate');
    expect((await operation).ok).toBe(false);
    // 本地已落盘的命令不会因为晚回包被拒绝而伪装成从未保存或自动重放。
    expect(store.queryResultPresets(target).revision).toBe(command === 'result.presets.save' || command === 'result.presets.rename' || command === 'result.presets.delete' ? 2 : 1);
  });

  it.each(['revision', 'connection', 'saving', 'expiry'] as const)('真实最终发布复检%s变化，不发布过时list或read', async change => {
    const { f, store, saved, id, advance } = await savedFixture();
    const operation = f.invoke('result.presets.read', { ...packet(saved), id });
    if (change === 'revision') store.renameQueryResultPreset({ ...packet(saved), id, name: '另一提交' });
    if (change === 'connection') store.saveConnection({ ...profile, host: 'late-change.invalid' });
    if (change === 'saving') f.setBlocked(true);
    if (change === 'expiry') advance(600000);
    expect((await operation).ok).toBe(false);
    f.setBlocked(false);
    const listOperation = f.invoke('result.presets.list', target);
    store.saveConnection({ ...profile, id: 'different-connection' });
    expect((await listOperation).ok).toBe(false);
  });

  it('真实Main校验拒绝SQL/rows/选择/历史，所有失败保持SQLite内容', async () => {
    const { f, store, file, saved } = await savedFixture(), bytes = readFileSync(file), before = store.queryResultPresets(target);
    for (const extra of [{ sql: 'SELECT secret' }, { rows: [{ secret: '合成行' }] }, { selection: [0] }, { history: [] }]) {
      expect((await f.invoke('result.presets.save', { ...packet(saved), name: '未知字段', value, ...extra })).ok).toBe(false);
      expect((await f.invoke('result.presets.save', { ...packet(saved), name: '值含未知字段', value: { ...value, ...extra } })).ok).toBe(false);
    }
    expect(store.queryResultPresets(target)).toEqual(before); expect(readFileSync(file).equals(bytes)).toBe(true);
  });
});
