import { tableCreateColumnOrderZh as orderText } from '../../src/renderer/locales/tableCreateColumnOrder.zh-CN';
import { tableCreatePrefixZh as prefixText } from '../../src/renderer/locales/tableCreatePrefix.zh-CN';
import { act, StrictMode } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { memoryDocument, MemoryEvent } from '../fixtures/memory-dom';
import type { TableDesign, TableInfo } from '../../src/shared/contracts';
import type { TableCreateServices } from '../../src/renderer/tableCreateServices';
import { tableCreateAcknowledgements, tableCreateLegacyDesign } from '../../src/shared/tableCreate';
import { tableCreateZh as text } from '../../src/renderer/locales/tableCreate.zh-CN';
import { zh, formatText } from '../../src/renderer/locales/zh-CN';
import { buildDesign } from '../../src/engine/sql';

// 只替换Monaco显示和传输端口；实际SchemaDialog、确认页、React事件及SQL生成器均保持。
vi.mock('../../src/renderer/components/SqlEditor', () => ({ SqlEditor: ({ value, onChange, readOnly }: { value: string; onChange?(value: string): void; readOnly?: boolean }) => <><pre aria-label="只读预览SQL">{value}</pre>{onChange && <input aria-label="编辑预览SQL" value={value} disabled={readOnly} onChange={event => { if (!readOnly) onChange(event.target.value); }}/>}</> }));
let services: TableCreateServices;
vi.mock('../../src/renderer/tableCreateServices', () => ({ get tableCreateServices() { return services; } }));
const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
let SchemaDialog: typeof import('../../src/renderer/components/SchemaDialog')['SchemaDialog'], workspace: typeof import('../../src/renderer/store')['useWorkspace'];
let requests: { command: string; input: any }[], dirty: ReturnType<typeof vi.fn>, applied: ReturnType<typeof vi.fn>, closed: ReturnType<typeof vi.fn>;
beforeAll(async () => {
  document = memoryDocument(); (document as any).oninput = null; Object.assign(window, { setTimeout, clearTimeout, confirm: vi.fn(() => true) });
  const create = document.createElement.bind(document);
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
/** 原目录值只给已有表读取，不通过产品生成器伪造原定义。 */
function existing(defaultValue: string | null, type = 'varchar(64)', generated = false): TableInfo { return { database: 'db', name: 't', engine: 'InnoDB', charset: 'utf8mb4', objectKind: 'table', ddl: "CREATE TABLE `t` (`value` varchar(64) DEFAULT '') ENGINE=InnoDB", columns: [{ name: 'value', type, nullable: true, defaultValue, extra: generated ? 'VIRTUAL GENERATED' : '', comment: '原列说明', generated }], indexes: [], foreignKeys: [], primaryKey: [], editableKey: [] }; }
/** 真实界面到预览草稿再到现有生成器；任何执行入口都在本纯测试中报错。 */
async function mount(original?: TableInfo, strict = false): Promise<void> {
  workspace.setState({ connectionVersions: { c: 1 } }); requests = []; dirty = vi.fn(); applied = vi.fn(); closed = vi.fn(); let sequence = 0;
  services = {
    get: vi.fn(async () => ({ target: { connectionId: 'c', database: 'db' }, snapshotId: 's' + ++sequence, expiresAt: new Date(Date.now() + 120000).toISOString(), serverVersion: '8.4.11', warnings: [] })),
    preview: vi.fn(async input => ({ target: { connectionId: 'c', database: 'db', table: input.design.name }, previewToken: 'p' + sequence, expiresAt: new Date(Date.now() + 110000).toISOString(), designDigest: 'a'.repeat(64), sql: buildDesign(tableCreateLegacyDesign(input.design)).sql, warnings: [], requiredAcknowledgements: [...tableCreateAcknowledgements] })),
    apply: vi.fn(async () => { throw Error('纯测试禁止执行DDL'); }), release: vi.fn(async () => {}), cancel: vi.fn(async () => {}), subscribe: () => () => {},
  };
  (window as any).dbark = { invoke: vi.fn(async (command: string, input: any) => { requests.push({ command, input }); if (command === 'connections.open') return {}; if (command === 'metadata.table' && original) return original; if (command === 'schema.preview') return buildDesign(input.design, original); throw Error('未授权纯测试命令：' + command); }) };
  const container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container as unknown as Element);
  const component = <SchemaDialog connectionId="c" database="db" table={original?.name} onClose={closed} onApplied={applied} onDirtyChange={dirty}/>;
  await act(async () => root!.render(strict ? <StrictMode>{component}</StrictMode> : component));
  if (!original) { const name = document.querySelector('input')!; await act(async () => { name.value = 'new_table'; name.dispatchEvent(new MemoryEvent('input')); });  }
}
/** 输入与复选框都走实际React委派，不能直接改组件草稿。 */
async function input(label: string, value: string): Promise<void> { const node = document.querySelector(`input[aria-label="${label}"]`); expect(node, '缺少输入框：' + label).not.toBeNull(); await act(async () => { node!.value = value; node!.dispatchEvent(new MemoryEvent('input')); }); }
async function check(label: string, value: boolean): Promise<void> { const node = document.querySelector(`input[aria-label="${label}"]`); expect(node, '缺少复选框：' + label).not.toBeNull(); await act(async () => { node!.checked = value; node!.dispatchEvent(new MemoryEvent('click')); }); }
async function click(label: string): Promise<void> { const node = document.querySelectorAll('button').find(item => item.textContent === label); expect(node, '缺少按钮：' + label).toBeDefined(); expect(node!.disabled).toBe(false); await act(async () => { node!.dispatchEvent(new MemoryEvent('click')); }); }
/** 新建和编辑各走原预览接口，不以一条手写SQL代替实际生成。 */
async function preview(original = false): Promise<TableDesign> { await click(zh.schema.text049); return original ? requests.filter(item => item.command === 'schema.preview').at(-1)!.input.design : tableCreateLegacyDesign(vi.mocked(services.preview).mock.calls.at(-1)![0].design); }

/** 只操作当前真实表单；测试不直接写草稿。 */
async function add(name: string, position: number) { await click(zh.schema.text027); await input(formatText(zh.schema.text018,position),name); await input(formatText(zh.schema.text019,position),'varchar(64)'); }
/** 读取React当时实际安装的闭包，以覆盖已脱离或已更新DOM的迟到事件。 */
function callback(node: any, event='onClick'): (value?: any) => void {
  const property=Object.keys(node).find(key=>key.startsWith('__reactProps$')); if(!property)throw Error('缺少真实React事件属性'); return node[property][event];
}
/** 排序控件通过唯一可访问名称定位，不依赖图标或数组DOM下标。 */
function orderButton(position:number,direction:'up'|'down') { const label=direction==='up'?orderText.upLabel(position):orderText.downLabel(position);const node=document.querySelector(`button[aria-label="${label}"]`);expect(node).not.toBeNull();return node!; }
/** 真实点击当前行的可用排序按钮。 */
async function move(position:number,direction:'up'|'down') { const node=orderButton(position,direction);expect(node.disabled).toBe(false);await act(async()=>node.dispatchEvent(new MemoryEvent('click'))); }
/** 切换实际设计器标签，不直接修改组件状态。 */
async function tab(name:string) { const node=document.querySelectorAll('button').find(value=>value.textContent.startsWith(name));expect(node).toBeDefined();await act(async()=>node!.dispatchEvent(new MemoryEvent('click'))); }
/** 外键字段沿产品Field标签写入，保留按列名引用。 */
async function field(label:string,value:string) { const node=document.querySelectorAll('label').find(value=>value.textContent===label)?.querySelector('input');expect(node).not.toBeNull();await act(async()=>{node!.value=value;node!.dispatchEvent(new MemoryEvent('input'));}); }

it('新建字段首末边界禁用，中间行可上移下移，属性、普通键及FK按名引用原样进入真实SQL预览',async()=>{
  await mount(); expect(orderButton(1,'up').disabled).toBe(true);expect(orderButton(1,'down').disabled).toBe(true);
  await add('a',2);await check(formatText(zh.schema.emptyStringDefaultLabel,2),true);await check(formatText(zh.schema.text020,2),false);await input(formatText(zh.schema.text024,2),'空串说明');
  await add('b',3);await input(formatText(zh.schema.text022,3),'NULL');await add('c',4);await input(formatText(zh.schema.text022,4),'NULL');await check(formatText(zh.schema.literalNullLabel,4),true);
  await tab(zh.common.indexes);await click(zh.schema.text036);await input(formatText(zh.schema.text031,2),'ix_a');const select=document.querySelector(`select[aria-label="${prefixText.field(2,1)}"]`)!;await act(async()=>{select.value='a';select.dispatchEvent(new MemoryEvent('change'));});
  await tab(zh.common.foreignKeys);await click(zh.schema.text045);await field(zh.schema.text037,'fk_a');await field(zh.schema.text038,'a');await field(zh.schema.text040,'parent');await field(zh.schema.text041,'id');
  const original=await preview();await click(text.back);await tab(zh.common.fields);await move(2,'up');await move(2,'down');expect(orderButton(1,'up').disabled).toBe(true);expect(orderButton(4,'down').disabled).toBe(true);
  const final=await preview();expect(final.columns.map(value=>value.name)).toEqual(['a','b','id','c']);expect(final.columns.map(value=>({...value}))).toEqual(['a','b','id','c'].map(name=>original.columns.find(value=>value.name===name)));expect(final.indexes).toEqual(original.indexes);expect(final.foreignKeys).toEqual(original.foreignKeys);
  expect(final.indexes).toContainEqual({name:'PRIMARY',unique:true,columns:['id']});expect(final.foreignKeys[0].columns).toEqual(['a']);
  const sql=document.querySelector('pre[aria-label="只读预览SQL"]')!.textContent;expect(sql.indexOf('  `a` ')).toBeLessThan(sql.indexOf('  `b` '));expect(sql.indexOf('  `b` ')).toBeLessThan(sql.indexOf('  `id` '));expect(sql).toContain('KEY `ix_a` (`a`)');expect(sql).toContain('FOREIGN KEY (`a`)');expect(services.apply).not.toHaveBeenCalled();
});

it('重排后的旧输入、删除及移动闭包全部拒绝，不按旧位置误改另一字段',async()=>{
  await mount();await add('a',2);await add('b',3);const oldInput=document.querySelector(`input[aria-label="${formatText(zh.schema.text018,2)}"]`)!;
  const edit=callback(oldInput,'onChange'),remove=callback(document.querySelector(`button[aria-label="${formatText(zh.schema.text026,2)}"]`)),oldMove=callback(orderButton(2,'down'));
  await move(2,'up');expect(document.querySelector(`input[aria-label="${formatText(zh.schema.text018,1)}"]`)).toBe(oldInput);
  await act(async()=>{edit({target:{value:'错误字段'}});remove();oldMove();});expect((await preview()).columns.map(value=>value.name)).toEqual(['a','id','b']);
});

it('删除后在同位置新增一列，旧行闭包不能认领新字段',async()=>{
  await mount();await add('a',2);const edit=callback(document.querySelector(`input[aria-label="${formatText(zh.schema.text018,2)}"]`),'onChange');const oldDelete=callback(document.querySelector(`button[aria-label="${formatText(zh.schema.text026,2)}"]`));
  await act(async()=>oldDelete());await add('b',2);await act(async()=>{edit({target:{value:'迟到'}});oldDelete();});expect((await preview()).columns.map(value=>value.name)).toEqual(['id','b']);
});

it('进入确认同步锁定旧行，返回后原确认租约和旧行回调仍不复活，新操作能重新预览',async()=>{
  await mount();await add('a',2);const oldMove=callback(orderButton(2,'up')),oldEdit=callback(document.querySelector(`input[aria-label="${formatText(zh.schema.text018,2)}"]`),'onChange');const prepare=callback(document.querySelectorAll('button').find(value=>value.textContent===zh.schema.text049));
  await act(async()=>{prepare();oldMove();oldEdit({target:{value:'迟到'}});});expect(vi.mocked(services.preview).mock.calls[0][0].design.columns.map(value=>value.name)).toEqual(['id','a']);expect(document.querySelector(`button[aria-label="${orderText.upLabel(2)}"]`)).toBeNull();
  const oldGuard=vi.mocked(services.preview).mock.calls[0][1];await input(text.confirmation,'db.new_table');for(const label of [text.ackDdl,text.ackCreate]){const node=document.querySelectorAll('label').find(value=>value.textContent===label)!.querySelector('input')!;await act(async()=>{node.checked=true;node.dispatchEvent(new MemoryEvent('click'));});}const staleApply=callback(document.querySelectorAll('button').find(value=>value.textContent===text.apply));await click(text.back);await act(async()=>staleApply());expect(oldGuard()).toBe(false);await act(async()=>{oldMove();oldEdit({target:{value:'迟到'}});});await move(2,'up');expect((await preview()).columns.map(value=>value.name)).toEqual(['a','id']);expect(services.preview).toHaveBeenCalledTimes(2);expect(services.apply).not.toHaveBeenCalled();
});

it.each(['revision','database'] as const)('父目标%s发生ABA后旧排序闭包无效，不生成预览',async mode=>{
  await mount();await add('a',2);const oldMove=callback(orderButton(2,'up'));
  if(mode==='revision')await act(async()=>{workspace.setState({connectionVersions:{c:2}});workspace.setState({connectionVersions:{c:1}});oldMove();});else {await act(async()=>root!.render(<SchemaDialog connectionId="c" database="other" onClose={closed} onApplied={applied}/>));await act(async()=>root!.render(<SchemaDialog connectionId="c" database="db" onClose={closed} onApplied={applied}/>));await act(async()=>oldMove());}
  expect(document.querySelector(`input[aria-label="${formatText(zh.schema.text018,1)}"]`)!.value).toBe('id');expect(orderButton(2,'up').disabled).toBe(true);expect(services.get).not.toHaveBeenCalled();expect(services.preview).not.toHaveBeenCalled();
});

it('已有表仍无字段排序入口，原ALTER预览按原路径生成',async()=>{
  await mount(existing(''));expect(document.querySelector(`button[aria-label="${orderText.upLabel(1)}"]`)).toBeNull();await input(formatText(zh.schema.text024,1),'只改说明');const draft=await preview(true);expect(draft.columns[0].name).toBe('value');expect(requests.filter(value=>value.command==='schema.preview')).toHaveLength(1);expect(services.get).not.toHaveBeenCalled();
});

it('StrictMode仍可正常排序，卸载后的旧闭包不能影响新实例',async()=>{
  await mount(undefined,true);await add('a',2);const oldMove=callback(orderButton(2,'up'));await move(2,'up');expect((await preview()).columns.map(value=>value.name)).toEqual(['a','id']);await act(async()=>root!.unmount());root=undefined;
  await mount();await add('b',2);await act(async()=>oldMove());expect((await preview()).columns.map(value=>value.name)).toEqual(['id','b']);
});

it('旧预览按钮闭包也只读取重排后的最终草稿，双击确认入口只签发一套准备',async()=>{
  await mount();await add('a',2);const prepare=callback(document.querySelectorAll('button').find(value=>value.textContent===zh.schema.text049));await move(2,'up');await act(async()=>{prepare();prepare();});expect(vi.mocked(services.preview).mock.calls[0][0].design.columns.map(value=>value.name)).toEqual(['a','id']);expect(services.get).toHaveBeenCalledOnce();expect(services.preview).toHaveBeenCalledOnce();
});
