import { act, StrictMode } from 'react';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { memoryDocument, MemoryEvent } from '../fixtures/memory-dom';
import { installNavigationMenuRamPort, navigationMenuObservedMutationPort } from '../helpers/navigationMenuRamPort';
import { RecordTemplateLease, type RecordTemplateCandidate } from '../../src/renderer/recordTemplates';
import { recordTemplateContentSchema, type RecordTemplateContent, type RecordTemplateSnapshot } from '../../src/shared/recordTemplates';
import { recordTemplatesZh as text } from '../../src/renderer/locales/recordTemplates.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';

let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
let Dialog: typeof import('../../src/renderer/components/RecordTemplatesDialog')['RecordTemplatesDialog'];
let observers: Set<Function>;
let restoreNavigationMenuPort = () => {};
const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT', 'MutationObserver'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
beforeAll(async () => {
  document = memoryDocument(); restoreNavigationMenuPort = installNavigationMenuRamPort(document); (document as any).oninput = null; const create = document.createElement.bind(document);
  document.createElement = name => {
    const node = create(name);
    if (name === 'input') { let kind = 'text'; Object.defineProperty(node, 'type', { configurable: true, get: () => kind, set: value => { kind = value; node.attributes.set('type', value); } }); }
    if (name === 'option') {
      let selected = false;
      Object.defineProperty(node, 'selected', { configurable: true, get: () => selected, set: value => { selected = !!value; if (selected) for (const sibling of node.parentNode?.childNodes ?? []) if (sibling !== node && sibling.tagName === 'OPTION') (sibling as any).selected = false; } });
      Object.defineProperty(node, 'value', { configurable: true, get: () => node.attributes.get('value') ?? node.textContent, set: value => node.attributes.set('value', value) });
    }
    if (name === 'select') {
      Object.defineProperty(node, 'options', { get: () => node.querySelectorAll('option') });
      Object.defineProperty(node, 'value', { configurable: true, get: () => node.querySelectorAll('option').find(option => (option as any).selected)?.value ?? '', set: value => { for (const option of node.querySelectorAll('option')) (option as any).selected = option.value === value; } });
    }
    const set = node.setAttribute.bind(node), remove = node.removeAttribute.bind(node);
    node.setAttribute = (key, value) => { set(key.toLowerCase(), value); if (key === 'disabled') node.disabled = true; };
    node.removeAttribute = key => { remove(key.toLowerCase()); if (key === 'disabled') node.disabled = false; };
    return node;
  };
  observers = new Set(); (globalThis as any).MutationObserver = navigationMenuObservedMutationPort(observers);
  ({ createRoot } = await import('react-dom/client')); ({ RecordTemplatesDialog: Dialog } = await import('../../src/renderer/components/RecordTemplatesDialog'));
});
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.textContent = ''; observers.clear(); });
afterAll(() => { restoreNavigationMenuPort(); for (const [name, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });

const target = { connectionId: 'c', database: 'main', table: '模板表🚢' }, columns = [{ name: '__proto__', signature: 'text-type' }, { name: 'empty', signature: 'empty-type' }];
const candidate: RecordTemplateCandidate = { dialect: 'sqlite', fields: [{ ...columns[0], value: { kind: 'text', value: '9223372036854775807\0🚢' } }, { ...columns[1], value: { kind: 'null' } }, { name: 'missing', signature: 's', unavailable: 'DEFAULT未填写' }] };

/** 仅本机配置端口返回RAM快照，真实Modal、表单、字段筛选、预览和一次性租约共同运行。 */
async function mount(options: { strict?: boolean; source?: boolean; initial?: RecordTemplateContent } = {}) {
  let valid = true, content = options.initial;
  const id = randomUUID(); let snapshot: RecordTemplateSnapshot = { target, revision: 0, source: { connectionRevision: 1, connectionDigest: 'a'.repeat(64), dialect: 'sqlite' }, bindingToken: randomUUID(), entries: content ? [{ id, name: '已存', dialect: 'sqlite', columns: content.fields.map(field => field.name), sourceCurrent: true }] : [] };
  const lease = new RecordTemplateLease(randomUUID(), () => valid), stage = vi.fn(), closed = vi.fn(), confirm = vi.fn(() => true); (window as any).confirm = confirm;
  const api = {
    list: vi.fn(async () => structuredClone(snapshot)),
    save: vi.fn(async (input: any) => {
      expect(input.expectedRevision).toBe(snapshot.revision); expect(input.bindingToken).toBe(snapshot.bindingToken);
      content = recordTemplateContentSchema.parse(input.content); snapshot = { ...snapshot, revision: snapshot.revision + 1, bindingToken: randomUUID(), entries: [{ id, name: input.name, dialect: content.dialect, columns: content.fields.map(field => field.name), sourceCurrent: true }] }; return structuredClone(snapshot);
    }),
    rename: vi.fn(async (input: any) => { snapshot = { ...snapshot, revision: snapshot.revision + 1, bindingToken: randomUUID(), entries: snapshot.entries.map(entry => ({ ...entry, name: input.name })) }; return structuredClone(snapshot); }),
    remove: vi.fn(async () => { snapshot = { ...snapshot, revision: snapshot.revision + 1, bindingToken: randomUUID(), entries: [] }; return structuredClone(snapshot); }),
    read: vi.fn(async () => structuredClone(content!)),
  };
  const element = <Dialog lease={lease} target={target} dialect="sqlite" columns={columns} candidate={options.source === false ? undefined : candidate} services={api} onStage={stage} onClose={closed}/>;
  const host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host as any); await act(async () => root!.render(options.strict ? <StrictMode>{element}</StrictMode> : element));
  return { lease, api, stage, closed, confirm, id, get snapshot() { return snapshot; }, get content() { return content; }, stale: () => { valid = false; lease.current(); valid = true; }, render: async () => { await act(async () => root!.render(<Dialog {...element.props}/>)); } };
}
function button(name: string) { const node = document.querySelectorAll('button').find(node => node.textContent === name || node.getAttribute('aria-label') === name); expect(node, name).toBeDefined(); return node!; }
async function click(name: string) { const node = button(name); expect(node.disabled).toBe(false); await act(async () => node.dispatchEvent(new MemoryEvent('click'))); }
async function input(name: string, value: string, kind = 'input') { const node = document.querySelector(`${kind}[aria-label="${name}"]`)!; expect(node, name).not.toBeNull(); await act(async () => { node.value = value; node.dispatchEvent(new MemoryEvent(kind === 'select' ? 'change' : 'input')); }); }
async function check(name: string) { const node = document.querySelector(`input[aria-label="${text.field(name)}"]`)!; expect(node.disabled).toBe(false); await act(async () => { node.checked = true; node.dispatchEvent(new MemoryEvent('click')); }); }
function callback(node: any) { return node[Object.keys(node).find(key => key.startsWith('__reactProps$'))!].onClick as () => void; }

it('明确选字段后保存，搜索保留所选隐藏字段，预览并指定数量才暂存且不提交', async () => {
  const f = await mount(); expect(f.api.save).not.toHaveBeenCalled(); expect(button(text.stage).disabled).toBe(true);
  await input(text.name, '精确模板'); await check('__proto__'); await input(text.search, ' EMPTY ');
  expect(document.querySelector(`input[aria-label="${text.field('__proto__')}"]`)).toBeNull(); await check('empty'); await click(text.save);
  expect(f.content?.fields.map(field => field.name)).toEqual(['__proto__', 'empty']); expect(f.content?.fields[0].value).toEqual(candidate.fields[0].value); expect(f.stage).not.toHaveBeenCalled();
  await click(text.preview); expect(f.api.read).toHaveBeenCalledExactlyOnceWith({ ...target, source: f.snapshot.source, expectedRevision: f.snapshot.revision, bindingToken: f.snapshot.bindingToken, id: f.id });
  await input(text.copies, '2'); const stage = callback(button(text.stage)); await act(async () => { stage(); stage(); });
  expect(f.stage).toHaveBeenCalledExactlyOnceWith(f.content, 2); expect(f.api.save).toHaveBeenCalledTimes(1);
});
it('StrictMode重建读取仍能保存；同一tick重复保存只写一次，管理动作不会生成数据草稿', async () => {
  const f = await mount({ strict: true }); await input(text.name, '同一请求'); await check('__proto__');
  const save = callback(button(text.save)); await act(async () => { save(); save(); }); expect(f.api.save).toHaveBeenCalledTimes(1);
  await input(text.name, '新名'); await click(text.rename); expect(f.api.rename).toHaveBeenCalledTimes(1); expect(document.body.textContent).toContain(text.renamed);
  f.confirm.mockReturnValue(false); await click(text.remove); expect(f.api.remove).not.toHaveBeenCalled(); f.confirm.mockReturnValue(true); await click(text.remove); expect(f.api.remove).toHaveBeenCalledTimes(1); expect(f.stage).not.toHaveBeenCalled();
});
it('无当前记录也可预览已有模板，取消只关闭，不触发新增或覆盖', async () => {
  const content: RecordTemplateContent = { version: 1, dialect: 'sqlite', fields: [{ ...columns[0], value: { kind: 'text', value: '' } }] }, f = await mount({ source: false, initial: content });
  expect(document.body.textContent).toContain(text.noSource); await input(text.list, f.id, 'select'); await click(text.preview); expect(document.body.textContent).toContain('空字符串');
  await click(zh.common.close); expect(f.closed).toHaveBeenCalledTimes(1); expect(f.stage).not.toHaveBeenCalled(); expect(f.api.save).not.toHaveBeenCalled();
});
it('模板缺列整份拒绝，不生成部分草稿', async () => {
  const content: RecordTemplateContent = { version: 1, dialect: 'sqlite', fields: [{ name: '不存在', signature: 's', value: { kind: 'null' } }] }, f = await mount({ initial: content });
  await input(text.list, f.id, 'select'); await click(text.preview); expect(document.body.textContent).toContain('整份模板未应用'); expect(button(text.stage).disabled).toBe(true); expect(f.stage).not.toHaveBeenCalled();
});
it('连接或草稿ABA撤销真实旧按钮，源条件恢复也不能复活', async () => {
  const content: RecordTemplateContent = { version: 1, dialect: 'sqlite', fields: [{ ...columns[0], value: { kind: 'text', value: '原' } }] }, f = await mount({ initial: content });
  await input(text.list, f.id, 'select'); const oldRead = callback(button(text.preview)); f.stale(); await act(async () => oldRead()); expect(f.api.read).not.toHaveBeenCalled(); await f.render(); expect(document.body.textContent).toContain(text.stale);
});
it('卸载后迟到读取不恢复预览，旧读取与新增回调不能影响后继管理器', async () => {
  const content: RecordTemplateContent = { version: 1, dialect: 'sqlite', fields: [{ ...columns[0], value: { kind: 'text', value: '原' } }] }, f = await mount({ initial: content });
  await input(text.list, f.id, 'select'); let finish!: (content: RecordTemplateContent) => void;
  f.api.read.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const old = callback(button(text.preview)); await act(async () => old()); expect(f.api.read).toHaveBeenCalledTimes(1);
  await act(async () => root!.unmount()); root = undefined; await act(async () => { finish(content); old(); });
  expect(f.api.read).toHaveBeenCalledTimes(1); expect(f.stage).not.toHaveBeenCalled(); expect(document.querySelector('section[aria-label="' + text.preview + '"]')).toBeNull();
});
it('外来模态在观察前已经移除仍留下撤权墓碑，旧模板不能继续生成新增', async () => {
  const f = await mount(), foreign = document.createElement('div'); foreign.setAttribute('role', 'dialog'); document.body.appendChild(foreign); document.body.removeChild(foreign);
  await act(async () => { for (const observer of [...observers]) observer([{ addedNodes: [foreign] }]); });
  expect(document.body.textContent).toContain(text.stale); expect(f.lease.current()).toBe(false); expect(button(text.save).disabled).toBe(true); expect(f.api.save).not.toHaveBeenCalled();
});

it('已预览模板仍拒绝零、越界和小数数量，合法数量只交付一次', async () => {
  const content: RecordTemplateContent = { version: 1, dialect: 'sqlite', fields: [{ ...columns[0], value: { kind: 'null' } }] }, f = await mount({ initial: content });
  await input(text.list, f.id, 'select'); await click(text.preview);
  for (const value of ['0', '101', '1.5', '-1']) { await input(text.copies, value); expect(button(text.stage).disabled).toBe(true); await act(async () => callback(button(text.stage))()); }
  expect(f.stage).not.toHaveBeenCalled(); await input(text.copies, '100'); await click(text.stage); expect(f.stage).toHaveBeenCalledExactlyOnceWith(content, 100);
});
