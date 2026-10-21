import { act, type ComponentProps } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { memoryDocument, MemoryEvent, type MemoryNode } from '../fixtures/memory-dom';
import { QueryResultPresetsDialog } from '../../src/renderer/components/QueryResultPresetsDialog';
import { queryResultPresetsZh as text } from '../../src/renderer/locales/queryResultPresets.zh-CN';
import { queryResultFilterZh as filterText } from '../../src/renderer/locales/queryResultFilter.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';
import {
  queryResultPresetListSchema, queryResultPresetRenameSchema, queryResultPresetSaveSchema,
  queryResultPresetSelectSchema, queryResultPresetSnapshotSchema, queryResultPresetValueSchema,
  type QueryResultPresetSnapshot, type QueryResultPresetValue,
} from '../../src/shared/queryResultPresets';

const id = '11111111-1111-4111-8111-111111111111', secondId = '22222222-2222-4222-8222-222222222222';
const bindingToken = '33333333-3333-4333-8333-333333333333', digest = 'a'.repeat(64);
const columns = [{ key: 'id', name: '编号', type: 'LONGLONG' }, { key: 'word', name: '原文', type: 'VAR_STRING' }, { key: 'hidden', name: '隐藏列', type: 'BLOB' }];
/** 条件保持数值、集合和停用原文；内存端口不求值或转换精度。 */
function configuration(): QueryResultPresetValue {
  return queryResultPresetValueSchema.parse({ columns, visible: columns.slice(0, 2), configuration: {
    expression: { mode: 'AND', children: [
      { column: 'id', operator: 'between', value: '9007199254740993', upper: '18446744073709551615' },
      { mode: 'OR', children: [
        { column: 'word', operator: 'in', value: '', values: ['', ' NULL ', '保留\n换行'], ignoreCase: true },
        { mode: 'AND', children: [{ column: 'id', operator: 'eq', value: '保留的停用原文', enabled: false }, { column: 'word', operator: 'null', value: '' }] },
      ] },
    ] },
    sort: [{ column: 'word', direction: 'DESC', nulls: 'LAST', ignoreCase: true }, { column: 'id', direction: 'ASC', nulls: 'FIRST' }],
  } });
}
/** 所有成功快照都经共享合同校验，测试只替换预加载IPC，不替换任何组件。 */
function checkedSnapshot(next?: Partial<QueryResultPresetSnapshot>): QueryResultPresetSnapshot {
  return queryResultPresetSnapshotSchema.parse({ version: 1, revision: 3, bindingToken, source: { connectionRevision: 2, connectionDigest: digest }, entries: [{ id, name: '已有方案', connectionDigest: digest, value: configuration() }], ...next });
}
let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
let props: ComponentProps<typeof QueryResultPresetsDialog>, snapshot: QueryResultPresetSnapshot, live: boolean;
let invoke: ReturnType<typeof vi.fn>, nextResponse: (() => Promise<unknown>) | undefined;
const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);

/** 补齐真实React依赖的单选互斥与受控input类型语义，不模拟浏览器布局或系统输入。 */
function installOption(node: MemoryNode): void {
  let selected = false;
  Object.defineProperty(node, 'selected', { configurable: true, get: () => selected, set: value => {
    selected = !!value;
    if (selected && node.parentNode?.tagName === 'SELECT' && !(node.parentNode as any).multiple)
      for (const sibling of node.parentNode.childNodes) if (sibling !== node && sibling.tagName === 'OPTION') (sibling as any).selected = false;
  } });
  Object.defineProperty(node, 'value', { configurable: true, get: () => node.attributes.get('value') ?? node.textContent, set: value => node.attributes.set('value', String(value)) });
}
beforeAll(async () => {
  document = memoryDocument(); (document as any).oninput = null;
  const create = document.createElement.bind(document);
  document.createElement = name => {
    const node = create(name);
    if (name === 'input') { let type = 'text'; Object.defineProperty(node, 'type', { configurable: true, get: () => type, set: value => { type = value; node.attributes.set('type', value); } }); }
    if (name === 'option') installOption(node);
    if (name === 'select') {
      Object.defineProperty(node, 'options', { get: () => node.querySelectorAll('option') });
      Object.defineProperty(node, 'value', { configurable: true, get: () => node.querySelectorAll('option').find(option => (option as any).selected)?.value ?? '', set: value => {
        for (const option of node.querySelectorAll('option')) (option as any).selected = option.value === value;
      } });
    }
    const set = node.setAttribute.bind(node), remove = node.removeAttribute.bind(node);
    node.setAttribute = (key, value) => { set(key.toLowerCase(), value); if (key === 'disabled') node.disabled = true; };
    node.removeAttribute = key => { remove(key.toLowerCase()); if (key === 'disabled') node.disabled = false; };
    return node;
  };
  ({ createRoot } = await import('react-dom/client'));
});
beforeEach(() => {
  live = true; snapshot = checkedSnapshot(); nextResponse = undefined;
  props = { connectionId: 'ram-connection', value: configuration(), owner: 'ram-result', isCurrent: () => live,
    matches: value => JSON.stringify(value.columns) === JSON.stringify(props.value.columns) && JSON.stringify(value.visible) === JSON.stringify(props.value.visible), onApply: vi.fn(), onClose: vi.fn() };
  invoke = vi.fn(async (command: string, input: unknown) => {
    // IPC输入同样使用实际共享校验；禁止SQL、数据库、文件和其它外界操作。
    if (command === 'result.presets.list') queryResultPresetListSchema.parse(input);
    else if (command === 'result.presets.save') queryResultPresetSaveSchema.parse(input);
    else if (command === 'result.presets.rename') queryResultPresetRenameSchema.parse(input);
    else if (command === 'result.presets.delete' || command === 'result.presets.read') queryResultPresetSelectSchema.parse(input);
    else throw Error('禁止外界命令：' + command);
    if (nextResponse) { const response = nextResponse; nextResponse = undefined; return response(); }
    if (command === 'result.presets.list') return structuredClone(snapshot);
    const data = input as any;
    expect(data).toMatchObject({ connectionId: props.connectionId, source: snapshot.source, expectedRevision: snapshot.revision, bindingToken: snapshot.bindingToken });
    if (command === 'result.presets.read') return queryResultPresetValueSchema.parse(snapshot.entries.find(entry => entry.id === data.id)!.value);
    const entries = structuredClone(snapshot.entries);
    if (command === 'result.presets.save') {
      const entry = { id: data.replaceId ?? secondId, name: data.name, connectionDigest: digest, value: data.value };
      if (data.replaceId) entries.splice(entries.findIndex(item => item.id === data.replaceId), 1, entry); else entries.push(entry);
    } else if (command === 'result.presets.rename') entries.find(entry => entry.id === data.id)!.name = data.name;
    else entries.splice(entries.findIndex(entry => entry.id === data.id), 1);
    snapshot = checkedSnapshot({ ...snapshot, revision: snapshot.revision + 1, entries });
    return structuredClone(snapshot);
  });
  (window as any).dbark = { invoke };
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount()); root = undefined;
  delete (window as any).dbark; document.body.textContent = '';
});
afterAll(() => { for (const [name, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });

/** 挂载真实对话框，effects与异步IPC结算由React act处理。 */
async function mount() {
  const host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host as any);
  await render();
}
async function render() { await act(async () => root!.render(<QueryResultPresetsDialog {...props}/>)); }
function button(label: string) { const node = document.querySelectorAll('button').find(item => item.textContent === label); expect(node, '缺少按钮：' + label).toBeDefined(); return node!; }
async function click(label: string) { const node = button(label); expect(node.disabled).toBe(false); await act(async () => node.dispatchEvent(new MemoryEvent('click'))); }
async function name(value: string) { const node = document.querySelector('input')!; await act(async () => { node.value = value; node.dispatchEvent(new MemoryEvent('input')); }); }
async function choose(value = id) { const node = document.querySelector('select')!; await act(async () => { node.value = value; node.dispatchEvent(new MemoryEvent('change')); }); }
/** 仅捕获旧渲染的真实按钮闭包，用于验证迟到事件不能跨快照或草稿重放。 */
function oldClick(label: string): () => void { const node = button(label) as any; return node[Object.keys(node).find(key => key.startsWith('__reactProps$'))!].onClick; }
function commands() { return invoke.mock.calls.map(call => call[0]); }
function defer() { let resolve!: (value: unknown) => void, reject!: (reason: Error) => void; const promise = new Promise<unknown>((ok, fail) => { resolve = ok; reject = fail; }); nextResponse = () => promise; return { resolve, reject }; }
async function settle(action: () => void) { await act(async () => { action(); await Promise.resolve(); }); }

it('真实对话框只读挂载；保存、整份覆盖、仅重命名、删除均传递所见CAS且不隐式应用', async () => {
  await mount(); expect(commands()).toEqual(['result.presets.list']); expect(document.body.textContent).toContain(text.scope);
  await name('  新方案  '); await click(text.create);
  expect(invoke.mock.calls[1]).toEqual(['result.presets.save', { connectionId: 'ram-connection', source: snapshot.source, expectedRevision: 3, bindingToken, name: '新方案', value: props.value }]);
  expect(document.querySelector('select')!.value).toBe(secondId); expect(document.querySelector('input')!.value).toBe('新方案');
  props = { ...props, value: { ...configuration(), configuration: { expression: { mode: 'AND', children: [] }, sort: [] } } }; await render();
  await click(text.overwrite); expect(invoke.mock.calls[2][1]).toMatchObject({ replaceId: secondId, expectedRevision: 4, value: props.value });
  await name('改名后'); await click(text.rename); expect(invoke.mock.calls[3]).toEqual(['result.presets.rename', { connectionId: 'ram-connection', source: snapshot.source, expectedRevision: 5, bindingToken, id: secondId, name: '改名后' }]);
  await click(text.remove); expect(invoke.mock.calls[4][1]).toMatchObject({ id: secondId, expectedRevision: 6 });
  expect(document.querySelector('select')!.value).toBe(''); expect(document.querySelector('input')!.value).toBe('');
  expect(snapshot.entries.map(entry => entry.name)).toEqual(['已有方案']); expect(props.onApply).not.toHaveBeenCalled(); expect(props.onClose).not.toHaveBeenCalled();
});

it('完整预览保留嵌套AND/OR、范围/集合/停用原文及多列NULL和大小写优先级；应用先重新读取', async () => {
  await mount(); await choose();
  const preview = document.querySelector('[aria-label="' + text.preview + '"]')!;
  expect(preview.textContent).toContain('9007199254740993'); expect(preview.textContent).toContain('18446744073709551615');
  expect(preview.textContent).toContain('["", " NULL ", "保留\\n换行"]'); expect(preview.textContent).toContain(text.disabled + ' · 编号');
  expect(preview.querySelectorAll('strong').map(node => node.textContent)).toEqual(expect.arrayContaining([filterText.and, filterText.or, text.disabled + ' · ']));
  expect(preview.querySelector('ol')!.querySelectorAll('li').map(node => node.textContent)).toEqual(['原文 · ' + text.desc + ' · ' + text.nullLast + ' · ' + text.ignoreCase, '编号 · ' + text.asc + ' · ' + text.nullFirst]);
  await click(text.apply); expect(commands()).toEqual(['result.presets.list', 'result.presets.read']);
  expect(invoke.mock.calls[1][1]).toMatchObject({ id, expectedRevision: 3, source: snapshot.source, bindingToken });
  expect(props.onApply).toHaveBeenCalledExactlyOnceWith(configuration());
});

it.each(['source', 'columns', 'visible'] as const)('%s不匹配时禁止应用；来源变化仍允许用户明确整份覆盖', async mode => {
  if (mode === 'source') snapshot = checkedSnapshot({ entries: [{ ...snapshot.entries[0], connectionDigest: 'b'.repeat(64) }] });
  else props = { ...props, value: { ...props.value, [mode]: mode === 'columns' ? columns.map(column => ({ ...column, type: '不同类型' })) : columns.slice(0, 1) } };
  await mount(); await choose(); expect(button(text.apply).disabled).toBe(true);
  expect(document.body.textContent).toContain(mode === 'source' ? text.connectionChanged : text.mismatch);
  await act(async () => oldClick(text.apply)()); expect(commands()).toEqual(['result.presets.list']);
  if (mode === 'source') { await click(text.overwrite); expect(snapshot.entries[0].connectionDigest).toBe(digest); expect(button(text.apply).disabled).toBe(false); }
});

it('名称检查与真实单选一致，草稿或快照变化后旧新增/改名/删除/应用按钮不能重放', async () => {
  await mount(); await name('已有方案'); expect(button(text.create).disabled).toBe(true);
  await name('  '); expect(button(text.create).disabled).toBe(true); await name('无效\u0001名'); expect(button(text.create).disabled).toBe(true);
  await name('第一稿'); const create = oldClick(text.create); await name('第二稿'); await act(async () => create()); expect(commands()).toEqual(['result.presets.list']);
  await choose(); await name('改名'); const rename = oldClick(text.rename), remove = oldClick(text.remove), apply = oldClick(text.apply);
  await click(text.refresh); await act(async () => { rename(); remove(); apply(); }); expect(commands()).toEqual(['result.presets.list', 'result.presets.list']);
  await name('改名'); await click(text.rename); expect(snapshot.entries[0].name).toBe('改名');
});

it.each(['result.presets.list', 'result.presets.save', 'result.presets.read'] as const)('%s迟到成功遇到首次来源失效后永久拒绝，即使来源恢复也不能复活', async command => {
  if (command === 'result.presets.list') { const pending = defer(); await mount(); live = false; await render(); live = true; await settle(() => pending.resolve(checkedSnapshot())); }
  else {
    await mount(); await choose(); const pending = defer();
    if (command === 'result.presets.save') { await name('迟到保存'); await click(text.create); } else await click(text.apply);
    live = false; await render(); live = true;
    await settle(() => pending.resolve(command === 'result.presets.read' ? configuration() : checkedSnapshot({ revision: 4 })));
  }
  const count = invoke.mock.calls.length; expect(document.body.textContent).toContain(text.stale); expect(button(text.refresh).disabled).toBe(true);
  await act(async () => { oldClick(text.refresh)(); oldClick(text.create)(); oldClick(text.apply)(); });
  expect(invoke).toHaveBeenCalledTimes(count); expect(props.onApply).not.toHaveBeenCalled();
});

it.each(['result.presets.list', 'result.presets.save', 'result.presets.read'] as const)('%s卸载后迟到回包及旧按钮不能投递或关闭父结果', async command => {
  let pending: ReturnType<typeof defer>;
  if (command === 'result.presets.list') { pending = defer(); await mount(); }
  else { await mount(); await choose(); pending = defer(); if (command === 'result.presets.save') { await name('保存中'); await click(text.create); } else await click(text.apply); }
  const apply = oldClick(text.apply), remove = oldClick(text.remove), count = invoke.mock.calls.length;
  await act(async () => root!.unmount()); root = undefined;
  await settle(() => pending.resolve(command === 'result.presets.read' ? configuration() : checkedSnapshot({ revision: 4 })));
  await act(async () => { apply(); remove(); }); expect(invoke).toHaveBeenCalledTimes(count); expect(props.onApply).not.toHaveBeenCalled(); expect(props.onClose).not.toHaveBeenCalled();
});

it('写请求未结算时关闭与重复点击不重发；成功换快照后旧保存闭包不能再次写', async () => {
  await mount(); await name('保存中'); const save = oldClick(text.create), close = oldClick(zh.common.close), pending = defer();
  await click(text.create); expect(button(text.create).disabled).toBe(true); expect(button(zh.common.close).disabled).toBe(true);
  await act(async () => { save(); close(); }); expect(commands()).toEqual(['result.presets.list', 'result.presets.save']); expect(props.onClose).not.toHaveBeenCalled();
  const next = checkedSnapshot({ revision: 4, entries: [...snapshot.entries, { id: secondId, name: '保存中', connectionDigest: digest, value: configuration() }] });
  await settle(() => pending.resolve(next)); await act(async () => save()); expect(invoke).toHaveBeenCalledTimes(2);
  await click(zh.common.close); expect(props.onClose).toHaveBeenCalledOnce();
});

it.each(['save', 'read', 'list'] as const)('%s错误必须显式刷新；旧按钮也不能自动重试可能已经成功的请求', async mode => {
  await mount(); await choose(); if (mode === 'save') await name('待保存');
  const label = mode === 'save' ? text.create : mode === 'read' ? text.apply : text.refresh;
  const old = oldClick(label), pending = defer(); await click(label);
  await settle(() => pending.reject(Error('结果未知，禁止隐式重试')));
  expect(document.body.textContent).toContain('结果未知，禁止隐式重试'); expect(document.body.textContent).toContain(text.refreshNeeded);
  expect(button(text.create).disabled).toBe(true); expect(button(text.apply).disabled).toBe(true);
  const before = commands();
  // 刷新本身是允许重复的只读操作；旧写入及读取闭包必须被同步门阻断。
  if (mode !== 'list') { await act(async () => old()); expect(commands()).toEqual(before); }
  await click(text.refresh); expect(commands().at(-1)).toBe('result.presets.list'); expect(document.body.textContent).not.toContain(text.refreshNeeded);
  expect(commands().filter(command => command === 'result.presets.save')).toHaveLength(mode === 'save' ? 1 : 0);
  expect(props.onApply).not.toHaveBeenCalled();
});

it('读取结构非法即拒绝应用并要求刷新，完整合法快照刷新前不补救或自动写入', async () => {
  await mount(); await choose(); nextResponse = async () => ({ ...configuration(), rows: [{ id: '不属于方案的行' }] });
  await click(text.apply); expect(props.onApply).not.toHaveBeenCalled(); expect(document.body.textContent).toContain(text.refreshNeeded);
  expect(commands()).toEqual(['result.presets.list', 'result.presets.read']); await click(text.refresh);
  expect(commands()).toEqual(['result.presets.list', 'result.presets.read', 'result.presets.list']);
});

it.each(['\u0001', '\u007f', '\u0085', '\u009f'])('方案名称包含控制字符%s时界面即拒绝，不发送必然失败的写入', async character => {
  await mount(); await choose(); await name('方案' + character + '名称');
  for (const label of [text.create, text.rename, text.overwrite]) {
    expect(button(label).disabled).toBe(true); await act(async () => oldClick(label)());
  }
  expect(commands()).toEqual(['result.presets.list']); expect(document.body.textContent).not.toContain(text.refreshNeeded);
});
