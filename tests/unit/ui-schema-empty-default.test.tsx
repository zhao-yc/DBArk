import { act, StrictMode } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { memoryDocument, MemoryEvent } from '../fixtures/memory-dom';
import type { TableDesign, TableInfo } from '../../src/shared/contracts';
import type { TableCreateServices } from '../../src/renderer/tableCreateServices';
import { tableCreateAcknowledgements, tableCreateDesignSchema } from '../../src/shared/tableCreate';
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
const emptyLabel = '第1个字段：空字符串默认值';
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
    preview: vi.fn(async input => ({ target: { connectionId: 'c', database: 'db', table: input.design.name }, previewToken: 'p' + sequence, expiresAt: new Date(Date.now() + 110000).toISOString(), designDigest: 'a'.repeat(64), sql: buildDesign(tableCreateDesignSchema.parse(input.design)).sql, warnings: [], requiredAcknowledgements: [...tableCreateAcknowledgements] })),
    apply: vi.fn(async () => { throw Error('纯测试禁止执行DDL'); }), release: vi.fn(async () => {}), cancel: vi.fn(async () => {}), subscribe: () => () => {},
  };
  (window as any).dbark = { invoke: vi.fn(async (command: string, input: any) => { requests.push({ command, input }); if (command === 'connections.open') return {}; if (command === 'metadata.table' && original) return original; if (command === 'schema.preview') return buildDesign(input.design, original); throw Error('未授权纯测试命令：' + command); }) };
  const container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container as unknown as Element);
  const component = <SchemaDialog connectionId="c" database="db" table={original?.name} onClose={closed} onApplied={applied} onDirtyChange={dirty}/>;
  await act(async () => root!.render(strict ? <StrictMode>{component}</StrictMode> : component));
  if (!original) { const name = document.querySelector('input')!; await act(async () => { name.value = 'new_table'; name.dispatchEvent(new MemoryEvent('input')); }); await input(formatText(zh.schema.text019, 1), 'varchar(64)'); await check(formatText(zh.schema.text021, 1), false); }
}
/** 输入与复选框都走实际React委派，不能直接改组件草稿。 */
async function input(label: string, value: string): Promise<void> { const node = document.querySelector(`input[aria-label="${label}"]`); expect(node, '缺少输入框：' + label).not.toBeNull(); await act(async () => { node!.value = value; node!.dispatchEvent(new MemoryEvent('input')); }); }
async function check(label: string, value: boolean): Promise<void> { const node = document.querySelector(`input[aria-label="${label}"]`); expect(node, '缺少复选框：' + label).not.toBeNull(); await act(async () => { node!.checked = value; node!.dispatchEvent(new MemoryEvent('click')); }); }
async function click(label: string): Promise<void> { const node = document.querySelectorAll('button').find(item => item.textContent === label); expect(node, '缺少按钮：' + label).toBeDefined(); expect(node!.disabled).toBe(false); await act(async () => { node!.dispatchEvent(new MemoryEvent('click')); }); }
/** 新建和编辑各走原预览接口，不以一条手写SQL代替实际生成。 */
async function preview(original = false): Promise<TableDesign> { await click(zh.schema.text049); return original ? requests.filter(item => item.command === 'schema.preview').at(-1)!.input.design : vi.mocked(services.preview).mock.calls.at(-1)![0].design; }

describe('设计器显式空字符串默认值的真实React链（仅RAM）', () => {
  it('新建明确选择空串后，草稿及原生成器产生DEFAULT空字符串而非省略或NULL', async () => { await mount(); await check(emptyLabel, true); const draft = await preview(); expect(draft.columns[0].defaultValue).toBe(''); expect(buildDesign(draft).sql).toContain("DEFAULT ''"); expect(services.apply).not.toHaveBeenCalled(); expect(requests.some(item => item.command === 'schema.apply')).toBe(false); });
  it('选择后取消回到未设置，输入框保持空白且不变成SQL NULL', async () => { await mount(); await check(emptyLabel, true); await check(emptyLabel, false); const draft = await preview(); expect(draft.columns[0].defaultValue).toBeUndefined(); expect(buildDesign(draft).sql.split('\n')[1]).not.toContain('DEFAULT'); });
  it('返回新建草稿释放原预览，取消空串后必须生成新的无默认预览', async () => {
    await mount(); await check(emptyLabel, true); await preview(); expect(document.querySelector('pre[aria-label="只读预览SQL"]')!.textContent).toContain("DEFAULT ''"); await click(text.back);
    expect(services.release).toHaveBeenCalledWith({ previewToken: 'p1' }); expect(document.querySelector(`input[aria-label="${emptyLabel}"]`)!.checked).toBe(true);
    await check(emptyLabel, false); await preview(); expect(services.preview).toHaveBeenCalledTimes(2); expect(vi.mocked(services.preview).mock.calls[0][0].design.columns[0].defaultValue).toBe(''); expect(vi.mocked(services.preview).mock.calls[1][0].design.columns[0].defaultValue).toBeUndefined(); expect(document.querySelector('pre[aria-label="只读预览SQL"]')!.textContent.split('\n')[1]).not.toContain('DEFAULT'); expect(services.apply).not.toHaveBeenCalled();
  });
  it.each([['普通文字', '普通文字'], ['NULL', null], ['null', 'null'], ['', undefined]] as const)('空串选择后输入%s仍沿原语义并解除空串选择', async (value, expected) => {
    await mount(); await check(emptyLabel, true); await input(formatText(zh.schema.text022, 1), value || '先输入文字'); if (!value) await input(formatText(zh.schema.text022, 1), '');
    expect(document.querySelector(`input[aria-label="${emptyLabel}"]`)!.checked).toBe(false); expect((await preview()).columns[0].defaultValue).toBe(expected);
  });
  it('SQL NULL、文字NULL及空串可以明确切换，互不折叠', async () => {
    await mount(); await input(formatText(zh.schema.text022, 1), 'NULL'); await check(formatText(zh.schema.literalNullLabel, 1), true); await check(emptyLabel, true);
    expect(document.querySelector(`input[aria-label="${formatText(zh.schema.literalNullLabel, 1)}"]`)).toBeNull(); expect((await preview()).columns[0].defaultValue).toBe(''); await click(text.back);
    await input(formatText(zh.schema.text022, 1), 'NULL'); await check(formatText(zh.schema.literalNullLabel, 1), true); expect(document.querySelector(`input[aria-label="${emptyLabel}"]`)!.checked).toBe(false); expect((await preview()).columns[0].defaultValue).toBe('NULL');
  });
  it('已有空串默认初始勾选；只改注释保留原值、原列名和ALTER空串', async () => { const original = existing(''); await mount(original); expect(document.querySelector(`input[aria-label="${emptyLabel}"]`)!.checked).toBe(true); await input(formatText(zh.schema.text024, 1), '新说明'); const draft = await preview(true); expect(draft.columns[0]).toMatchObject({ defaultValue: '', originalName: 'value', comment: '新说明' }); expect(buildDesign(draft, original).sql).toContain("DEFAULT ''"); expect(requests.some(item => item.command === 'schema.apply')).toBe(false); });
  it('已有表选择/取消空串使旧SQL预览退出，原空串可以重新明确选择', async () => { const original = existing('普通文字'); await mount(original); await check(emptyLabel, true); expect((await preview(true)).columns[0].defaultValue).toBe(''); await click(zh.schema.text046); await check(emptyLabel, false); expect(document.querySelector('pre[aria-label="只读预览SQL"]')).toBeNull(); const draft = await preview(true); expect(draft.columns[0].defaultValue).toBeUndefined(); expect(requests.filter(item => item.command === 'schema.preview')).toHaveLength(2); expect(requests.some(item => item.command === 'schema.apply')).toBe(false); });
  it.each([[false, false], [true, false], [false, true], [true, true]])('已有表等待预览期间切换草稿（恢复%s，文字输入%s），迟到旧SQL不能复活', async (restore, useTextInput) => {
    const original = existing('普通文字'); await mount(original); let resolve!: (value: ReturnType<typeof buildDesign>) => void;
    const pending = new Promise<ReturnType<typeof buildDesign>>(yes => { resolve = yes; }); let oldDraft!: TableDesign;
    const port = vi.mocked((window as any).dbark.invoke); port.mockImplementation(async (command: string, value: any) => { requests.push({ command, input: value }); if (command === 'connections.open') return {}; if (command === 'schema.preview') { oldDraft = value.design; return pending; } throw Error('禁止执行其它命令'); });
    await click(zh.schema.text049); expect(oldDraft.columns[0].defaultValue).toBe('普通文字'); if (useTextInput) await input(formatText(zh.schema.text022, 1), '普通新默认'); else await check(emptyLabel, true); if (restore) await input(formatText(zh.schema.text022, 1), '普通文字');
    await act(async () => resolve(buildDesign(oldDraft, original))); expect(document.querySelector('pre[aria-label="只读预览SQL"]')).toBeNull(); expect(document.querySelector(`input[aria-label="${emptyLabel}"]`)!.checked).toBe(!useTextInput && !restore);
    port.mockImplementation(async (command: string, value: any) => { requests.push({ command, input: value }); if (command === 'connections.open') return {}; if (command === 'schema.preview') return buildDesign(value.design, original); throw Error('禁止执行其它命令'); });
    const draft = await preview(true); expect(draft.columns[0].defaultValue).toBe(restore ? '普通文字' : useTextInput ? '普通新默认' : ''); expect(requests.some(item => item.command === 'schema.apply')).toBe(false);
  });
  it.each([null, 'NULL', '', '普通文字', 'CURRENT_TIMESTAMP'] as const)('已有VARCHAR默认%s改注释仍保留原值及原文字NULL选择', async value => { await mount(existing(value)); expect(document.querySelector(`input[aria-label="${emptyLabel}"]`)!.checked).toBe(value === ''); await input(formatText(zh.schema.text024, 1), '改说明'); expect((await preview(true)).columns[0].defaultValue).toBe(value); });
  it.each([['timestamp', 'CURRENT_TIMESTAMP'], ['datetime(6)', 'CURRENT_TIMESTAMP(6)']] as const)('已有%s默认时间函数%s保持原语义，空串入口不扩展表达式', async (type, value) => { const original = existing(value, type); await mount(original); expect(document.querySelector(`input[aria-label="${emptyLabel}"]`)!.checked).toBe(false); await input(formatText(zh.schema.text024, 1), '改时间说明'); const draft = await preview(true); expect(draft.columns[0].defaultValue).toBe(value); expect(buildDesign(draft, original).sql).toContain('DEFAULT ' + value); expect(buildDesign(draft, original).sql).not.toContain("DEFAULT '" + value + "'"); });
  it('已有生成列仍只读，空串控件不能绕过生成列边界', async () => { await mount(existing('', 'int', true)); expect(document.querySelector(`input[aria-label="${emptyLabel}"]`)).toBeNull(); expect(document.body.textContent).toContain(zh.schema.text004); });
});

/** 员工4原目标反例保持断言，另外验证正常提交及各等待边界；所有写入只到RAM端口。 */
describe('已有表预览绑定准确目标和连接修订（仅RAM）', () => {
  it.each(['target','connection-revision'] as const)('等待期间%s切换时旧SQL不能发布或发往新目标',async change=>{
    const original=existing('原值');await mount(original);let finish!:(value:any)=>void;let oldDraft!:TableDesign;const wait=new Promise(resolve=>{finish=resolve;});
    const next={...existing('新目标值'),name:'next_table',database:'next_db'};
    const port=vi.mocked((window as any).dbark.invoke);port.mockImplementation(async(command:string,input:any)=>{requests.push({command,input});if(command==='connections.open')return {};if(command==='metadata.table')return next;if(command==='schema.preview'){oldDraft=input.design;return wait;}if(command==='schema.apply')return {};throw Error('不支持的RAM请求');});
    await click(zh.schema.text049);
    if(change==='target')await act(async()=>root!.render(<SchemaDialog connectionId="next_connection" database="next_db" table="next_table" onClose={vi.fn()} onApplied={vi.fn()}/>));
    else await act(async()=>workspace.setState({connectionVersions:{c:2}}));
    await act(async()=>finish(buildDesign(oldDraft,original)));
    const execute=document.querySelectorAll('button').find(node=>node.textContent===zh.schema.text048);
    if(execute&&!execute.disabled)await click(zh.schema.text048);
    const sent=requests.filter(item=>item.command==='schema.apply');
    expect(sent,'目标/连接修订变化后不得把旧预览SQL提交到当前目标；RAM请求='+JSON.stringify(sent)).toHaveLength(0);
    expect(document.querySelector('pre[aria-label="只读预览SQL"]')).toBeNull();
  });
  it.each([false, true])('稳定目标正常预览、编辑SQL和单次提交（StrictMode%s）', async strict => {
    const original=existing('原值'); await mount(original, strict); const port=vi.mocked((window as any).dbark.invoke);
    port.mockImplementation(async(command:string,value:any)=>{requests.push({command,input:value});if(command==='connections.open'||command==='schema.apply')return {};if(command==='schema.preview')return buildDesign(value.design,original);throw Error('禁止其它请求');});
    await preview(true); const edited="ALTER TABLE `db`.`t` COMMENT = '合成修改'"; await input('编辑预览SQL',edited); await click(zh.schema.text048);
    expect(requests.filter(item=>item.command==='schema.apply').map(item=>item.input)).toEqual([{connectionId:'c',database:'db',sql:edited,taskId:expect.any(String)}]); expect(applied).toHaveBeenCalledTimes(1);expect(closed).toHaveBeenCalledTimes(1);
  });
  it.each(['connection','database','table'] as const)('提交建连等待期间%s切换，只允许新目标重新预览后提交', async change => {
    const original=existing('旧目标值');await mount(original);await preview(true);let finish!:(value:unknown)=>void;const pending=new Promise(resolve=>{finish=resolve;});
    const next={connectionId:change==='connection'?'next_connection':'c',database:change==='database'?'next_db':'db',table:change==='table'?'next_table':'t'};const port=vi.mocked((window as any).dbark.invoke);let waiting=true;
    const info=(database:string,name:string)=>({...existing('新目标值'),database,name});
    port.mockImplementation(async(command:string,value:any)=>{requests.push({command,input:value});if(command==='connections.open')return waiting?pending:{};if(command==='metadata.table')return info(value.database,value.table);if(command==='schema.preview')return buildDesign(value.design,info(value.design.database,value.design.originalName));if(command==='schema.apply')return {};throw Error('禁止其它请求');});
    await click(zh.schema.text048);await act(async()=>root!.render(<SchemaDialog {...next} onClose={closed} onApplied={applied}/>));waiting=false;await act(async()=>finish({}));
    expect(requests.filter(item=>item.command==='schema.apply')).toHaveLength(0);expect(document.querySelector('pre[aria-label="只读预览SQL"]')).toBeNull();expect(document.querySelector('input[aria-label="'+formatText(zh.schema.text022,1)+'"]')!.value).toBe('新目标值');
    await preview(true);await click(zh.schema.text048);const sent=requests.filter(item=>item.command==='schema.apply');expect(sent).toHaveLength(1);expect(sent[0].input).toMatchObject({connectionId:next.connectionId,database:next.database});expect(sent[0].input.sql).toContain('ALTER TABLE `'+next.database+'`.`'+next.table+'`');
  });
  it.each(['ready','apply-open','ABA'] as const)('连接修订%s变化永久作废旧预览，重新打开可以正常准备', async phase => {
    const original=existing('原值');await mount(original);await preview(true);let finish!:(value:unknown)=>void;const pending=new Promise(resolve=>{finish=resolve;});const port=vi.mocked((window as any).dbark.invoke);
    port.mockImplementation(async(command:string,value:any)=>{requests.push({command,input:value});if(command==='connections.open')return phase==='apply-open'?pending:{};if(command==='metadata.table')return original;if(command==='schema.preview')return buildDesign(value.design,original);if(command==='schema.apply')return {};throw Error('禁止其它请求');});
    if(phase==='apply-open')await click(zh.schema.text048);await act(async()=>{workspace.setState({connectionVersions:{c:2}});if(phase==='ABA')workspace.setState({connectionVersions:{c:1}});});if(phase==='apply-open')await act(async()=>finish({}));
    expect(requests.filter(item=>item.command==='schema.apply')).toHaveLength(0);expect(document.querySelector('pre[aria-label="只读预览SQL"]')).toBeNull();expect(document.body.textContent).toContain(text.mismatch);
    const prepare=document.querySelectorAll('button').find(item=>item.textContent===zh.schema.text049);expect(prepare?.disabled).toBe(true);expect(applied).not.toHaveBeenCalled();expect(closed).not.toHaveBeenCalled();
    await act(async()=>root!.render(<SchemaDialog key="明确重新打开" connectionId="c" database="db" table="t" onClose={closed} onApplied={applied}/>));await preview(true);await click(zh.schema.text048);expect(requests.filter(item=>item.command==='schema.apply')).toHaveLength(1);
  });
  it('旧目标metadata迟到不能覆盖新目标草稿或恢复旧预览', async()=>{
    await mount(existing('初始'));let finish!:(value:TableInfo)=>void;const pending=new Promise<TableInfo>(resolve=>{finish=resolve;});const port=vi.mocked((window as any).dbark.invoke);
    port.mockImplementation(async(command:string,value:any)=>{requests.push({command,input:value});if(command==='connections.open')return {};if(command==='metadata.table')return value.table==='slow'?pending:{...existing('当前元数据'),name:value.table,database:value.database};throw Error('只读加载期间禁止其它请求');});
    await act(async()=>root!.render(<SchemaDialog connectionId="c" database="db" table="slow" onClose={closed} onApplied={applied}/>));await act(async()=>root!.render(<SchemaDialog connectionId="c" database="db" table="fresh" onClose={closed} onApplied={applied}/>));await act(async()=>finish({...existing('旧元数据'),name:'slow'}));
    expect(document.querySelector('input[aria-label="'+formatText(zh.schema.text022,1)+'"]')!.value).toBe('当前元数据');expect(document.querySelector('pre[aria-label="只读预览SQL"]')).toBeNull();expect(requests.some(item=>item.command==='schema.preview'||item.command==='schema.apply')).toBe(false);
  });
  it.each(['identity','column'] as const)('metadata返回错误%s不能进入已有表预览', async kind=>{
    await mount(existing('初始'));const port=vi.mocked((window as any).dbark.invoke);port.mockImplementation(async(command:string,value:any)=>{requests.push({command,input:value});if(command==='connections.open')return {};if(command==='metadata.table'){const info={...existing('错表'),name:kind==='identity'?'unexpected':'requested'};if(kind==='column')delete(info.columns[0] as Partial<TableInfo['columns'][number]>).extra;return info;}throw Error('错误来源禁止预览或提交');});
    await act(async()=>root!.render(<SchemaDialog connectionId="c" database="db" table="requested" onClose={closed} onApplied={applied}/>));expect(document.querySelectorAll('button').find(item=>item.textContent===zh.schema.text049)?.disabled).toBe(true);expect(requests.some(item=>item.command==='schema.preview'||item.command==='schema.apply')).toBe(false);
  });
  it('等待预览时连接修订合批ABA也不能复活旧SQL', async()=>{
    const original=existing('原值');await mount(original);let finish!:(value:any)=>void;let oldDraft!:TableDesign;const pending=new Promise(resolve=>{finish=resolve;});const port=vi.mocked((window as any).dbark.invoke);
    port.mockImplementation(async(command:string,value:any)=>{requests.push({command,input:value});if(command==='connections.open')return {};if(command==='schema.preview'){oldDraft=value.design;return pending;}if(command==='schema.apply')return {};throw Error('禁止其它请求');});
    await click(zh.schema.text049);await act(async()=>{workspace.setState({connectionVersions:{c:2}});workspace.setState({connectionVersions:{c:1}});});await act(async()=>finish(buildDesign(oldDraft,original)));
    expect(document.querySelector('pre[aria-label="只读预览SQL"]')).toBeNull();expect(document.querySelectorAll('button').find(item=>item.textContent===zh.schema.text049)?.disabled).toBe(true);expect(requests.some(item=>item.command==='schema.apply')).toBe(false);
  });
  it.each(['target','revision'] as const)('DDL已送入RAM端口后%s变化，迟到完成不回调或关闭另一个上下文',async change=>{
    const original=existing('原值');await mount(original);await preview(true);let finish!:(value:unknown)=>void;const pending=new Promise(resolve=>{finish=resolve;});const port=vi.mocked((window as any).dbark.invoke);
    port.mockImplementation(async(command:string,value:any)=>{requests.push({command,input:value});if(command==='connections.open')return {};if(command==='metadata.table')return {...existing('新目标'),database:value.database,name:value.table};if(command==='schema.apply')return pending;throw Error('禁止其它请求');});
    await click(zh.schema.text048);expect(requests.filter(item=>item.command==='schema.apply')).toHaveLength(1);
    if(change==='target')await act(async()=>root!.render(<SchemaDialog connectionId="next_connection" database="next_db" table="next_table" onClose={closed} onApplied={applied}/>));else await act(async()=>workspace.setState({connectionVersions:{c:2}}));
    await act(async()=>finish({}));expect(applied).not.toHaveBeenCalled();expect(closed).not.toHaveBeenCalled();expect(requests.filter(item=>item.command==='schema.apply')).toHaveLength(1);expect(document.querySelector('pre[aria-label="只读预览SQL"]')).toBeNull();
  });
});
