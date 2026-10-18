import { act } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { memoryDocument, MemoryEvent } from '../fixtures/memory-dom';
import { tableCreateAcknowledgements, tableCreateLegacyDesign } from '../../src/shared/tableCreate';
import { assertTableCreateOnUpdateVersion } from '../../src/shared/tableCreateOnUpdate';
import { validateCommand } from '../../src/shared/validation';
import { buildDesign } from '../../src/engine/sql';
import { tableCreateOnUpdateZh as timeText } from '../../src/renderer/locales/tableCreateOnUpdate.zh-CN';
import { tableCreateColumnOrderZh as orderText } from '../../src/renderer/locales/tableCreateColumnOrder.zh-CN';
import { tableCreateZh as text } from '../../src/renderer/locales/tableCreate.zh-CN';
import { zh, formatText } from '../../src/renderer/locales/zh-CN';

// 仅替换Monaco显示及IPC接收端；实际React表单、确认页、服务适配器、IPC校验和SQL生成器均运行。
vi.mock('../../src/renderer/components/SqlEditor', () => ({ SqlEditor: ({ value }: { value: string }) => <pre aria-label="只读预览SQL">{value}</pre> }));
const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
let SchemaDialog: typeof import('../../src/renderer/components/SchemaDialog')['SchemaDialog'], workspace: typeof import('../../src/renderer/store')['useWorkspace'];
let requests: { command: string; input: any }[], created: ReturnType<typeof vi.fn>;
beforeAll(async () => {
  document = memoryDocument(); (document as any).oninput = null; Object.assign(window, { setTimeout, clearTimeout, confirm: vi.fn(() => true) });
  const create = document.createElement.bind(document);
  // RAM DOM补齐React受控select、checkbox和disabled反射，不安装浏览器或触碰系统资源。
  document.createElement = name => {
    const node = create(name);
    if (name === 'input') { let kind = 'text'; Object.defineProperty(node, 'type', { configurable: true, get: () => kind, set: value => { kind = value; node.attributes.set('type', value); } }); node.type = 'text'; }
    if (name === 'option') Object.defineProperty(node, 'value', { configurable: true, get: () => node.attributes.get('value') ?? node.textContent, set: value => node.attributes.set('value', value) });
    if (name === 'select') { Object.defineProperty(node, 'options', { get: () => node.querySelectorAll('option') }); Object.defineProperty(node, 'value', { configurable: true, get: () => node.querySelectorAll('option').find(option => (option as any).selected)?.value ?? '', set: value => { for (const option of node.querySelectorAll('option')) (option as any).selected = option.value === value; } }); }
    const set = node.setAttribute.bind(node), remove = node.removeAttribute.bind(node);
    node.setAttribute = (key, value) => { set(key.toLowerCase(), value); if (key === 'disabled') node.disabled = true; if (key === 'type') node.type = value; };
    node.removeAttribute = key => { remove(key.toLowerCase()); if (key === 'disabled') node.disabled = false; }; return node;
  };
  ({ createRoot } = await import('react-dom/client')); ({ SchemaDialog } = await import('../../src/renderer/components/SchemaDialog')); ({ useWorkspace: workspace } = await import('../../src/renderer/store'));
});
afterEach(async () => { if (root) { await act(async () => root!.unmount()); root = undefined; } delete (window as any).dbark; vi.restoreAllMocks(); });
afterAll(() => { for (const [name, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });

/** 接收端只用RAM数据；它验证真实IPC草稿并调用真实生成器，实际Engine后核在独立测试覆盖。 */
async function mount(version = '8.4.11') {
  workspace.setState({ connectionVersions: { c: 1 } }); requests = []; created = vi.fn();
  const snapshotId = crypto.randomUUID(), previewToken = crypto.randomUUID(); let target = { connectionId: 'c', database: 'db', table: '' };
  (window as any).dbark = { onTask: () => () => {}, invoke: vi.fn(async (command: string, raw: any) => {
    requests.push({ command, input: structuredClone(raw) });
    if (command === 'connections.open') return {};
    const input = validateCommand(command as any, raw) as any;
    if (command === 'schema.tableCreate.get') return { target: { connectionId: 'c', database: 'db' }, snapshotId, serverVersion: version, expiresAt: new Date(Date.now() + 120000).toISOString(), warnings: [] };
    if (command === 'schema.tableCreate.preview') {
      assertTableCreateOnUpdateVersion(input.design.columns, 'mysql', version); target = { ...target, table: input.design.name };
      return { target, previewToken, expiresAt: new Date(Date.now() + 110000).toISOString(), designDigest: 'a'.repeat(64), sql: buildDesign(tableCreateLegacyDesign(input.design)).sql, warnings: [], requiredAcknowledgements: [...tableCreateAcknowledgements] };
    }
    if (command === 'schema.tableCreate.apply') return { target, ddlSubmitted: true, ddlCompleted: true, definitionVerified: true, resourcesReleased: true, warnings: [] };
    if (command === 'schema.tableCreate.release' || command === 'query.cancel') return;
    throw Error('RAM测试未声明命令：' + command);
  }) };
  const container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container as unknown as Element);
  await act(async () => root!.render(<SchemaDialog connectionId="c" database="db" onClose={() => {}} onApplied={() => {}} onCreated={created}/>));
  const name = document.querySelector('input')!; await act(async () => { name.value = 'new_table'; name.dispatchEvent(new MemoryEvent('input')); });
}
/** 所有表单变更走真实React事件，不直接写组件状态或调用内部方法。 */
async function input(label: string, value: string) { const node = document.querySelector(`input[aria-label="${label}"]`); expect(node, label).not.toBeNull(); await act(async () => { node!.value = value; node!.dispatchEvent(new MemoryEvent('input')); }); }
async function select(label: string, value: string) { const node = document.querySelector(`select[aria-label="${label}"]`); expect(node, label).not.toBeNull(); await act(async () => { node!.value = value; node!.dispatchEvent(new MemoryEvent('change')); }); }
async function click(label: string) { const node = document.querySelectorAll('button').find(item => item.textContent === label); expect(node, label).toBeDefined(); expect(node!.disabled).toBe(false); await act(async () => node!.dispatchEvent(new MemoryEvent('click'))); }
/** 新字段先明确类型和默认值，再选择自动更新时间，保留字段约束。 */
async function addTime(type = 'DATETIME', precision = 3) {
  await click(zh.schema.text027); await input(formatText(zh.schema.text018, 2), 'updated_at');
  await input(formatText(zh.schema.text019, 2), `${type}(${precision})`); await input(formatText(zh.schema.text022, 2), `CURRENT_TIMESTAMP(${precision})`);
  await select(timeText.label(2), 'current'); await select(timeText.precisionLabel(2), String(precision));
}
/** 取真实React已安装闭包，覆盖旧行/旧确认代次的迟到回调。 */
function callback(node: any, event = 'onChange'): (value?: any) => void { const key = Object.keys(node).find(value => value.startsWith('__reactProps$')); if (!key) throw Error('缺少真实React回调'); return node[key][event]; }
const previews = () => requests.filter(value => value.command === 'schema.tableCreate.preview');

describe('新表自动更新时间真实React到IPC（仅RAM）', () => {
  it.each([['DATETIME', 0], ['DATETIME', 3], ['TIMESTAMP', 6]] as const)('%s(%s)属性进入实际SQL，准确确认双击只发一次apply', async (type, precision) => {
    await mount(); await addTime(type, precision); await click(zh.schema.text049);
    const column = previews()[0].input.design.columns[1]; expect(column.onUpdate).toEqual({ kind: 'expression', expression: 'current-timestamp', precision });
    expect(document.querySelector('pre[aria-label="只读预览SQL"]')!.textContent).toContain(`ON UPDATE CURRENT_TIMESTAMP${precision ? `(${precision})` : ''}`);
    expect(requests.some(value => value.command === 'schema.tableCreate.apply')).toBe(false);
    await input(text.confirmation, 'db.new_table');
    for (const label of [text.ackDdl, text.ackCreate]) { const node = document.querySelectorAll('label').find(value => value.textContent === label)!.querySelector('input')!; await act(async () => { node.checked = true; node.dispatchEvent(new MemoryEvent('click')); }); }
    const apply = callback(document.querySelectorAll('button').find(value => value.textContent === text.apply), 'onClick');
    await act(async () => { apply(); apply(); }); expect(requests.filter(value => value.command === 'schema.tableCreate.apply')).toHaveLength(1); expect(created).toHaveBeenCalledOnce();
    expect(requests.filter(value => value.command === 'schema.tableCreate.apply')[0].input).not.toHaveProperty('sql');
  });
  it('精度不匹配阻止准备且保留草稿，修正后可预览；返回后属性保留，未指定真正删键', async () => {
    await mount(); await addTime(); await select(timeText.precisionLabel(2), '6'); await click(zh.schema.text049);
    expect(previews()).toHaveLength(0); expect(requests.some(value => value.command === 'schema.tableCreate.get')).toBe(false);
    expect(document.querySelector(`select[aria-label="${timeText.precisionLabel(2)}"]`)!.value).toBe('6');
    await select(timeText.precisionLabel(2), '3'); await click(zh.schema.text049); await click(text.back);
    expect(document.querySelector(`select[aria-label="${timeText.label(2)}"]`)!.value).toBe('current');
    await select(timeText.label(2), 'legacy'); await click(zh.schema.text049);
    expect(Object.hasOwn(previews().at(-1)!.input.design.columns[1], 'onUpdate')).toBe(false);
    expect(document.querySelector('pre[aria-label="只读预览SQL"]')!.textContent).not.toContain('ON UPDATE');
  });
  it('明确不自动更新沿NULL默认合同，不生成ON UPDATE', async () => {
    await mount(); await addTime(); await input(formatText(zh.schema.text022, 2), 'NULL'); await select(timeText.label(2), 'none'); await click(zh.schema.text049);
    expect(previews()[0].input.design.columns[1]).toMatchObject({ defaultValue: null, nullable: true, onUpdate: null });
    expect(document.querySelector('pre[aria-label="只读预览SQL"]')!.textContent).not.toContain('ON UPDATE');
  });
  it('重排及确认返回后的旧时间回调失效，不改动新行与新代次', async () => {
    await mount(); await addTime(); const oldMode = callback(document.querySelector(`select[aria-label="${timeText.label(2)}"]`));
    const move = document.querySelector(`button[aria-label="${orderText.upLabel(2)}"]`)!;
    await act(async () => move.dispatchEvent(new MemoryEvent('click'))); await act(async () => oldMode({ target: { value: 'none' } }));
    await click(zh.schema.text049); expect(previews()[0].input.design.columns[0].onUpdate).not.toBeNull(); await click(text.back);
    await act(async () => oldMode({ target: { value: 'legacy' } })); await click(zh.schema.text049);
    expect(previews().at(-1)!.input.design.columns[0]).toMatchObject({ name: 'updated_at', onUpdate: { precision: 3 } });
  });
  it('未知版本在原预览链拒绝，SQL与apply不出现', async () => {
    await mount('8.4.12'); await addTime(); await click(zh.schema.text049);
    expect(previews()).toHaveLength(1); expect(document.body.textContent).toContain('服务器版本');
    expect(document.querySelector('pre[aria-label="只读预览SQL"]')).toBeNull(); expect(requests.some(value => value.command === 'schema.tableCreate.apply')).toBe(false);
  });
});
