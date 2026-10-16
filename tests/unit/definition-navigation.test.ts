import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type * as monaco from 'monaco-editor';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { DefinitionReadLease, DefinitionSearchConnectionLease, DefinitionSearchLifetime, DefinitionNavigationLifetime, DefinitionEditorLease, DefinitionNavigation, definitionUri, definitionDigest, readDefinitionNavigation, type DefinitionNavigationIdentity, type DefinitionNavigationState } from '../../src/renderer/definitionNavigation';
import { definitionNavigationResult } from '../../src/engine/definitionNavigation';
import type { DefinitionNavigationTarget, DefinitionNavigationSource, DefinitionSearchOpen } from '../../src/shared/definitionNavigation';

let Builder: new () => { acceptChunk(value: string): void; finish(): { create(eol: number): { textBuffer: { dispose(): void } } } }, modelPrototype: monaco.editor.ITextModel, Uri: { parse(value: string): monaco.Uri };
/** 复用保存查询策略的真实Monaco文本缓冲/模型原型；不启动浏览器、编辑器窗口或数据库。 */
beforeAll(async () => {
  const require = createRequire(import.meta.url), root = dirname(require.resolve('monaco-editor/package.json'));
  Builder = (await import(/* @vite-ignore */ pathToFileURL(join(root, 'esm/vs/editor/common/model/pieceTreeTextBuffer/pieceTreeTextBufferBuilder.js')).href)).PieceTreeTextBufferBuilder;
  modelPrototype = (await import(/* @vite-ignore */ pathToFileURL(join(root, 'esm/vs/editor/common/model/textModel.js')).href)).TextModel.prototype;
  Uri = (await import(/* @vite-ignore */ pathToFileURL(join(root, 'esm/vs/base/common/uri.js')).href)).URI;
});
const target = (): DefinitionNavigationTarget => ({ connectionId: '连接', connectionVersion: 4, database: '库/名', name: '对象.名', kind: 'procedure' });
/** 位置来自生产普通文字匹配，摘要与目标URI均按完整原文生成。 */
function source(sql: string, needle = '标记'): DefinitionNavigationSource {
  const result = definitionNavigationResult(sql, { mode: 'contains', text: needle, caseSensitive: true }); if (result.status !== 'ready') throw Error('夹具必须有可定位文字');
  const value = target(); return { ...value, uri: definitionUri(value)!, sql, digest: result.digest, ranges: result.ranges, limitReached: result.limitReached };
}
/** 编辑器端口只记录操作，行列/范围校验及逆向偏移使用已安装Monaco的真实实现。 */
function fixture(value = source('😀标记\r\n-- 标记 标记'), modelText = value.sql) {
  const builder = new Builder(); builder.acceptChunk(modelText); const { textBuffer } = builder.finish().create(1);
  const events = { content: new Set<() => void>(), dispose: new Set<() => void>(), model: new Set<() => void>(), editor: new Set<() => void>() };
  const listen = (kind: keyof typeof events, fn: () => void) => { events[kind].add(fn); return { dispose: () => events[kind].delete(fn) }; };
  let version = 1, text = modelText, edited = false, disposed = false, identity: DefinitionNavigationIdentity | undefined = { ...value }, active: monaco.editor.ITextModel;
  const model = Object.assign(Object.create(modelPrototype), { _buffer: textBuffer, _isDisposed: false, _associatedResource: Uri.parse('inmemory://definition/真实模型'), getValue: () => edited ? text : modelPrototype.getValue.call(model), getVersionId: () => version, isDisposed: () => disposed, onDidChangeContent: (fn: () => void) => listen('content', fn), onWillDispose: (fn: () => void) => listen('dispose', fn) }) as monaco.editor.ITextModel;
  active = model; const offsets: number[] = [];
  const decorations = { set: vi.fn(), clear: vi.fn() }, editor = { getModel: () => active, createDecorationsCollection: vi.fn(() => decorations), onDidChangeModel: (fn: () => void) => listen('model', fn), onDidDispose: (fn: () => void) => listen('editor', fn), setPosition: vi.fn((position: monaco.IPosition) => { offsets.push(model.getOffsetAt(model.validatePosition(position))); }), revealPositionInCenter: vi.fn(), focus: vi.fn() };
  const states: DefinitionNavigationState[] = [], navigation = new DefinitionNavigation(editor as unknown as monaco.editor.IStandaloneCodeEditor, value, () => identity, state => states.push(state));
  const emit = (kind: keyof typeof events) => [...events[kind]].forEach(fn => fn());
  return { model, editor, states, offsets, decorations, events, navigation, setIdentity: (value: DefinitionNavigationIdentity | undefined) => { identity = value; }, edit: () => { text += '改'; edited = true; version++; emit('content'); }, restore: () => { text = modelText; edited = false; version++; }, changeVersion: () => version++, swap: () => { active = Object.assign(Object.create(modelPrototype), model); emit('model'); }, disposeModel: () => { disposed = true; emit('dispose'); }, disposeEditor: () => emit('editor'), close: () => { navigation.dispose(); textBuffer.dispose(); } };
}

describe('定义导航真实Monaco UTF16/CRLF及模型租约', () => {
  it('模型onReady到导航effect建立之间编辑并撤销也永久失效，不只比较最终字串', () => {
    const f = fixture(); f.navigation.dispose(); const prepared = new DefinitionEditorLease(f.editor as unknown as monaco.editor.IStandaloneCodeEditor);
    try { expect(prepared.current()).toBe(true); expect(prepared.version).toBe(1); expect(prepared.uri).toBe(f.model.uri.toString()); f.edit(); f.restore(); expect(f.model.getValue()).toBe('😀标记\r\n-- 标记 标记'); expect(prepared.current()).toBe(false); expect(Object.values(f.events).reduce((sum, events) => sum + events.size, 0)).toBe(0); } finally { prepared.dispose(); f.close(); }
  });
  it('真实模型规范化混合行尾时整组降级，不能将服务端原文位置套在不同正文上', () => {
    const sql = 'a\r\n标记\n标记', f = fixture(source(sql)); try { expect(f.model.getValue()).not.toBe(sql); expect(f.states.at(-1)?.status).toBe('unlocatable'); expect(f.editor.createDecorationsCollection).not.toHaveBeenCalled(); } finally { f.close(); }
  });
  it.each([['😀标记 标记', '标记'], ['a\r\nb b', 'b'], ['a\r\nb', '\r\n'], ['a\nb', '\n'], ['😀\r\nb', '😀\r\nb']])('正文%j的%j保持精确光标、完整跨度和前后循环', (sql, needle) => {
    const value = source(sql, needle), f = fixture(value);
    try { expect(f.states.at(-1)?.status).toBe('ready'); expect(f.decorations.set.mock.calls[0][0]).toHaveLength(value.ranges.length); expect(f.offsets[0]).toBe(value.ranges[0].offset);
      f.navigation.move(-1); expect(f.states.at(-1)?.index).toBe(value.ranges.length - 1); expect(f.offsets.at(-1)).toBe(value.ranges.at(-1)!.offset); f.navigation.move(1); expect(f.states.at(-1)?.index).toBe(0);
      const expected = f.model.getPositionAt(value.ranges[0].offset); expect(f.states.at(-1)).toMatchObject({ line: expected.lineNumber, column: expected.column }); expect(f.model.getValue()).toBe(sql);
      for (const [items] of f.decorations.set.mock.calls) for (const [index, item] of items.entries()) { expect(f.model.getOffsetAt({ lineNumber: item.range.startLineNumber, column: item.range.startColumn })).toBe(value.ranges[index].offset); expect(f.model.getOffsetAt({ lineNumber: item.range.endLineNumber, column: item.range.endColumn })).toBe(value.ranges[index].offset + value.ranges[index].length); }
    } finally { f.close(); }
  });
  it.each(['\r', '\n', 'a\r'])('CRLF内部端点%j整组降级，不能显示钳制后的伪计数', needle => {
    const f = fixture(source('a\r\nb', needle)); try { expect(f.states.at(-1)).toMatchObject({ status: 'unlocatable', count: 0 }); expect(f.editor.createDecorationsCollection).not.toHaveBeenCalled(); expect(f.editor.setPosition).not.toHaveBeenCalled(); } finally { f.close(); }
  });
  it.each(['连接', '修订', '数据库', '对象', '类型', 'URI', '摘要', '正文', '关闭'])('%s变化后恢复原身份也不复活旧令牌', kind => {
    const value = source('标记 标记'), f = fixture(value), identity: DefinitionNavigationIdentity = { ...value };
    if (kind === '连接') identity.connectionId += '2'; if (kind === '修订') identity.connectionVersion++; if (kind === '数据库') identity.database += '2'; if (kind === '对象') identity.name += '2'; if (kind === '类型') identity.kind = 'function'; if (kind === 'URI') identity.uri += '2'; if (kind === '摘要') identity.digest = 'b'.repeat(64); if (kind === '正文') identity.sql += '2';
    try { f.setIdentity(kind === '关闭' ? undefined : identity); expect(f.navigation.refresh()).toBe(false); f.setIdentity({ ...value }); f.navigation.move(1); expect(f.decorations.set).toHaveBeenCalledOnce(); expect(f.states.at(-1)?.status).toBe('invalid'); } finally { f.close(); }
  });
  it.each(['编辑撤销', '换模型', '静默版本', '模型URI', '销毁模型', '销毁编辑器', '关闭导航'])('%s不借同字串/同URI恢复监听或高亮', kind => {
    const f = fixture(); const late = [...f.events.content][0];
    try { if (kind === '编辑撤销') { f.edit(); f.restore(); } if (kind === '换模型') f.swap(); if (kind === '静默版本') f.changeVersion(); if (kind === '模型URI') Object.assign(f.model, { _associatedResource: Uri.parse('inmemory://definition/其它') }); if (kind === '销毁模型') f.disposeModel(); if (kind === '销毁编辑器') f.disposeEditor(); if (kind === '关闭导航') f.navigation.dispose();
      f.navigation.move(1); late(); expect(f.decorations.set).toHaveBeenCalledOnce(); expect(f.decorations.clear).toHaveBeenCalledOnce(); expect(Object.values(f.events).reduce((sum, values) => sum + values.size, 0)).toBe(0);
    } finally { f.close(); }
  });
  it('显式保留200处及额外命中事实，复制回包位置防止后续篡改', () => {
    const value = source('标记 '.repeat(201)), f = fixture(value); try { expect(f.states.at(-1)).toMatchObject({ count: 200, limitReached: true }); value.ranges[199].offset = 0; f.navigation.move(-1); expect(f.offsets.at(-1)).toBe(199 * 3); } finally { f.close(); }
  });
  it('光标操作重入编辑后不继续聚焦或发布ready；清理幂等', () => {
    const f = fixture(); try { f.editor.setPosition.mockImplementationOnce(() => f.edit()); f.navigation.move(1); expect(f.states.at(-1)?.status).toBe('invalid'); expect(f.editor.focus).toHaveBeenCalledOnce(); f.navigation.dispose(); f.navigation.dispose(); expect(f.decorations.clear).toHaveBeenCalledOnce(); } finally { f.close(); }
  });
  it('整组拒绝拆代理对、越界、重叠、未知摘要和不规范URI，不丢弃坏位置后伪称完整', () => {
    for (const patch of [{ ranges: [{ offset: 1, length: 1 }] }, { ranges: [{ offset: 999, length: 1 }] }, { ranges: [{ offset: 2, length: 2 }, { offset: 3, length: 1 }] }, { digest: 'bad' }, { uri: 'dbark://object/v1/bad' }]) { const f = fixture({ ...source('😀标记 标记'), ...patch }); try { expect(f.states.at(-1)?.status).toBe('invalid'); expect(f.editor.createDecorationsCollection).not.toHaveBeenCalled(); } finally { f.close(); } }
  });
  it('效果重订阅可复用同模型同版本；内容/模型改变和明确终态不恢复', () => {
    const value = source('标记'), f = fixture(value), lifetime = new DefinitionNavigationLifetime(); try { expect(lifetime.claim(value, f.model)).toBe(true); expect(lifetime.claim(value, f.model)).toBe(true); f.changeVersion(); expect(lifetime.claim(value, f.model)).toBe(false); expect(lifetime.claim(value, f.model)).toBe(false); const next = { ...value }; expect(lifetime.claim(next, f.model)).toBe(true); lifetime.end(); expect(lifetime.claim(next, f.model)).toBe(false); } finally { f.close(); }
  });
});

describe('定义读取、摘要、搜索修订及迟到结果的纯契约', () => {
  const search = (sql = '标记'): DefinitionSearchOpen => ({ ...target(), invalidated: false, result: definitionNavigationResult(sql, { mode: 'contains', text: '标记', caseSensitive: true }) });
  it('客户端摘要保留CRLF、Unicode和尾空格，与搜索原文摘要一致', async () => { const sql = '😀\r\n标记 '; expect(await definitionDigest(sql)).toBe(createHash('sha256').update(sql).digest('hex')); expect(await definitionDigest(sql)).not.toBe(await definitionDigest(sql.trimEnd())); });
  it('完整原文、摘要、URI和修订吻合才交付位置；名称查看不制造搜索计数', async () => {
    const input = target(), lease = new DefinitionReadLease(input, () => target()); const result = await readDefinitionNavigation(lease, search(), async () => '标记'); expect(result?.source).toMatchObject({ uri: definitionUri(input), sql: '标记', connectionVersion: 4, ranges: [{ offset: 0, length: 2 }] });
    expect(await readDefinitionNavigation(new DefinitionReadLease(input, () => target()), undefined, async () => '标记')).toEqual({ sql: '标记' });
  });
  it.each(['连接', '修订', '数据库', '对象', '类型', '已失效'])('搜索%s不匹配时只保留读取原文，绝不借相同摘要挪给另一对象', async kind => {
    const input = search(); if (kind === '连接') input.connectionId += '2'; if (kind === '修订') input.connectionVersion++; if (kind === '数据库') input.database += '2'; if (kind === '对象') input.name += '2'; if (kind === '类型') input.kind = 'function'; if (kind === '已失效') input.invalidated = true;
    expect(await readDefinitionNavigation(new DefinitionReadLease(target(), () => target()), input, async () => '标记')).toEqual({ sql: '标记', status: 'invalid' });
  });
  it('当前定义变化、摘要缺失、服务器正则及无法计算摘要均明确降级，无伪造计数', async () => {
    const result = () => new DefinitionReadLease(target(), () => target());
    expect(await readDefinitionNavigation(result(), search(), async () => '定义已变')).toEqual({ sql: '定义已变', status: 'invalid' });
    expect(await readDefinitionNavigation(result(), { ...search(), result: undefined }, async () => '标记')).toEqual({ sql: '标记', status: 'unavailable' });
    expect(await readDefinitionNavigation(result(), { ...search(), result: { digest: createHash('sha256').update('标记').digest('hex'), status: 'unavailable', reason: 'server-regexp' } }, async () => '标记')).toEqual({ sql: '标记', status: 'unavailable' });
    expect(await readDefinitionNavigation(result(), search(), async () => '标记', async () => { throw Error('摘要能力不可用'); })).toEqual({ sql: '标记', status: 'unavailable' });
  });
  it.each(['读取期间', '摘要期间'])('%s目标变化并恢复仍不交付旧结果', async phase => {
    let current: DefinitionNavigationTarget | undefined = target(), release!: (value: string) => void; const delayed = new Promise<string>(resolve => { release = resolve; }); const lease = new DefinitionReadLease(target(), () => current);
    const pending = readDefinitionNavigation(lease, search(), () => phase === '读取期间' ? delayed : Promise.resolve('标记'), phase === '摘要期间' ? () => delayed : definitionDigest); await Promise.resolve();
    current = { ...target(), database: '其它' }; expect(lease.current()).toBe(false); current = target(); release(phase === '读取期间' ? '标记' : search().result!.digest); expect(await pending).toBeUndefined();
  });
  it('读取失败原样拒绝，不用空串、旧定义或零处冒充成功', async () => { await expect(readDefinitionNavigation(new DefinitionReadLease(target(), () => target()), search(), async () => { throw Error('固定读取失败'); })).rejects.toThrow('固定读取失败'); });
  it('首个await前复制摘要和位置，外部修改原回包对象不能重定向当前读取', async () => {
    const input = search(); let release!: (sql: string) => void; const response = new Promise<string>(resolve => { release = resolve; });
    const pending = readDefinitionNavigation(new DefinitionReadLease(target(), () => target()), input, () => response);
    if (input.result?.status !== 'ready') throw Error('夹具必须可定位'); input.result.digest = 'b'.repeat(64); input.result.ranges[0].offset = 999;
    release('标记'); expect((await pending)?.source).toMatchObject({ digest: createHash('sha256').update('标记').digest('hex'), ranges: [{ offset: 0, length: 2 }] });
  });
  it('搜索连接修订ABA和同一来源对象ABA都永久失效，新显式来源才能重新建立', () => {
    let version: number | undefined = 4; const lease = new DefinitionSearchConnectionLease('连接', 4, () => version); expect(lease.current()).toBe(true); version = 5; expect(lease.current()).toBe(false); version = 4; expect(lease.current()).toBe(false);
    const lifetime = new DefinitionSearchLifetime(), input = search(); expect(lifetime.claim(input, target())).toBe(true); expect(lifetime.claim(input, { ...target(), name: '其它' })).toBe(false); expect(lifetime.claim(input, target())).toBe(false); expect(lifetime.claim({ ...input }, target())).toBe(true);
  });
  it('读取目标复制为快照，外部修改对象不能顺带重定向租约', () => { const value = target(), lease = new DefinitionReadLease(value, () => value); value.database += '变化'; expect(lease.current()).toBe(false); });
});
