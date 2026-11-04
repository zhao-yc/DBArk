import { act, type ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { SqliteTablePage } from '../../src/shared/sqliteTableBrowse';
import type { SqliteDraftRow, SqliteEditView } from '../../src/renderer/sqliteTableEditor';
import { sqliteTableEditZh as text } from '../../src/renderer/locales/sqliteTableEdit.zh-CN';
import { memoryDocument, type MemoryNode } from '../fixtures/memory-dom';
let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
let ValueDialog: typeof import('../../src/renderer/components/SqliteTableEditDialog')['SqliteTableValueDialog'], PreviewDialog: typeof import('../../src/renderer/components/SqliteTableEditDialog')['SqliteTablePreviewDialog'];
const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
beforeAll(async () => {
  document = memoryDocument(); Object.defineProperty(document, 'oninput', { value: null, configurable: true }); const create = document.createElement.bind(document);
  /** 仅补标准 HTML 属性端口；组件、hook、原事件回调均运行真实 React 产品代码。 */
  document.createElement = name => {
    const node = create(name), set = node.setAttribute.bind(node), remove = node.removeAttribute.bind(node); if (name === 'input') node.type = 'text';
    node.setAttribute = (key, value) => { set(key, value); if (key === 'disabled') node.disabled = true; if (key === 'type') node.type = value; };
    node.removeAttribute = key => { remove(key); if (key === 'disabled') node.disabled = false; };
    if (name === 'select') Object.defineProperties(node, { options: { configurable: true, get: () => node.querySelectorAll('option') }, value: { configurable: true, get: () => node.querySelectorAll('option').find(option => Reflect.get(option, 'selected') === true)?.value ?? '', set: (value: string) => { let matched = false; for (const option of node.querySelectorAll('option')) { const selected = !matched && option.value === String(value); Reflect.set(option, 'selected', selected); if (selected) matched = true; } } } });
    if (name === 'option') { let selected = false, dirty = false; Object.defineProperties(node, { value: { configurable: true, get: () => node.getAttribute('value') ?? node.textContent, set: (value: string) => node.setAttribute('value', String(value)) }, selected: { configurable: true, get: () => dirty ? selected : node.getAttribute('selected') !== null, set: (value: boolean) => { selected = Boolean(value); dirty = true; } }, defaultSelected: { configurable: true, get: () => node.getAttribute('selected') !== null, set: (value: boolean) => { if (value) node.setAttribute('selected', ''); else node.removeAttribute('selected'); } } }); }
    return node;
  };
  ({ createRoot } = await import('react-dom/client')); ({ SqliteTableValueDialog: ValueDialog, SqliteTablePreviewDialog: PreviewDialog } = await import('../../src/renderer/components/SqliteTableEditDialog'));
});
afterEach(async () => { if (root) { await act(async () => root!.unmount()); root = undefined; } delete (window as any).dbark; document.body.textContent = ''; vi.restoreAllMocks(); });
afterAll(() => { for (const [key, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });
function page(name: string): SqliteTablePage { return { schemaKey: 'a'.repeat(64), target: { connectionId: 'sqlite', database: 'main', table: name, kind: 'table' }, columns: [{ name: 'mixed', declaredType: '' }], offset: 0, limit: 10, hasMore: false, result: { columns: [{ key: 'c0', name: 'mixed', type: 'SQLITE' }], rows: [{ c0: name }], statement: '', elapsedMs: 0, truncated: false }, edit: { kind: 'editable', snapshotId: name, expiresAt: new Date(1800000).toISOString(), columns: [{ name: 'mixed', declaredType: '', generated: false, nullable: true, hasDefault: true }], rows: [[{ kind: 'text', value: name }]], locator: { kind: 'rowid', columns: [] } } }; }
function row(value: string): SqliteDraftRow { return { id: 'original-0', index: 0, deleted: false, values: [{ kind: 'text', value }] }; }
function node(label: string, tag = 'button'): MemoryNode { const found = document.querySelectorAll(tag).find(node => node.getAttribute('aria-label') === label); expect(found, label).toBeDefined(); return found!; }
/** 持有真实 React 旧回调再换来源，不通过重新查找新按钮冒充旧事件。 */
function callback(element: MemoryNode, name = 'onClick'): (...args: any[]) => unknown { const key = Object.keys(element).find(key => key.startsWith('__reactProps$')); if (!key) throw Error('缺少真实React事件'); const fn = Reflect.get(element, key)[name]; if (typeof fn !== 'function') throw Error('缺少真实回调'); return fn; }
async function mount(render: () => ReactNode) { const host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host as unknown as Element); await act(async () => root!.render(render())); return async () => { await act(async () => root!.render(render())); }; }
function editView(id: string): SqliteEditView { const source = page('相同目标'); return { page: source, rows: [row(id)], dirty: true, busy: false, valid: true, unknown: false, undo: true, redo: false, message: '', preview: { previewId: id, snapshotId: 'snapshot', target: source.target, schemaKey: source.schemaKey, expiresAt: new Date(300000).toISOString(), confirmation: 'main.相同目标', counts: { insert: 0, update: 1, delete: 0 }, sql: ['UPDATE "相同目标" SET "mixed" = ?;'] } }; }

describe('SQLite typed Modal 与集中预览真实 React 旧回调隔离', () => {
  it('上一条及下一条只交接当前票据，干净切换不传暂存值', async () => {
    const move = vi.fn(() => true), nextMove = vi.fn(() => true), save = vi.fn(() => true), close = vi.fn();
    let key = 'first', props = { ticket: {}, page: page('页'), row: row('第一条'), current: () => true, onSave: save, onClose: close, navigation: { ownerId: key, previous: false, next: true, move } };
    const rerender = await mount(() => <ValueDialog key={key} {...props}/>);
    expect(node(text.previousRecord).disabled).toBe(true);
    const oldNext = callback(node(text.nextRecord));
    await act(async () => oldNext()); expect(move).toHaveBeenCalledExactlyOnceWith(1, undefined);
    key = 'second'; props = { ...props, ticket: {}, row: row('第二条'), navigation: { ownerId: key, previous: true, next: false, move: nextMove } }; await rerender();
    await act(async () => oldNext()); expect(move).toHaveBeenCalledOnce(); expect(nextMove).not.toHaveBeenCalled();
    await act(async () => callback(node(text.value('mixed'), 'textarea'), 'onChange')({ target: { value: '准确暂存文本' } }));
    await act(async () => callback(node(text.savePreviousRecord))()); expect(nextMove).toHaveBeenCalledExactlyOnceWith(-1, [{ kind: 'text', value: '准确暂存文本' }]);
    expect(save).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled();
  });
  it('换页后同original-0的旧save/close/change不修改新窗口；新key使用新字段正文', async () => {
    const oldSave = vi.fn(() => true), oldClose = vi.fn(), nextSave = vi.fn(() => true), nextClose = vi.fn();
    let props = { ticket: {}, page: page('旧页'), row: row('旧内容'), current: () => true, onSave: oldSave, onClose: oldClose }, key = 'old';
    const rerender = await mount(() => <ValueDialog key={key} {...props}/>), save = callback(node(text.saveInput)), close = callback(node(text.cancelInput)), change = callback(node(text.value('mixed'), 'textarea'), 'onChange');
    props = { ticket: {}, page: page('新页'), row: row('新内容'), current: () => true, onSave: nextSave, onClose: nextClose }; key = 'new'; await rerender();
    await act(async () => { save(); close(); change({ target: { value: '旧事件污染' } }); }); expect(node(text.value('mixed'), 'textarea').value).toBe('新内容'); expect(oldSave).not.toHaveBeenCalled(); expect(oldClose).not.toHaveBeenCalled(); expect(nextSave).not.toHaveBeenCalled(); expect(nextClose).not.toHaveBeenCalled();
    await act(async () => callback(node(text.saveInput))()); expect(nextSave).toHaveBeenCalledExactlyOnceWith([{ kind: 'text', value: '新内容' }]); expect(nextClose).toHaveBeenCalledOnce();
  });
  it('相同组件key误复用来源时也拒旧owner和新闭包，字段不会静默移交给新页', async () => {
    const save = vi.fn(() => true), close = vi.fn(), nextSave = vi.fn(() => true), nextClose = vi.fn(); let props = { ticket: {}, page: page('旧'), row: row('旧'), current: () => true, onSave: save, onClose: close };
    const rerender = await mount(() => <ValueDialog {...props}/>); props = { ticket: {}, page: page('新'), row: row('新'), current: () => true, onSave: nextSave, onClose: nextClose }; await rerender(); await act(async () => { callback(node(text.saveInput))(); callback(node(text.cancelInput))(); }); expect(save).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled(); expect(nextSave).not.toHaveBeenCalled(); expect(nextClose).not.toHaveBeenCalled();
  });
  it('旧字段输入/保存回调不能覆盖后来的同窗口正文，当前保存仍提交准确typed值', async () => {
    const save = vi.fn(() => true), close = vi.fn(), props = { ticket: {}, page: page('页'), row: row('原值'), current: () => true, onSave: save, onClose: close }; await mount(() => <ValueDialog {...props}/>);
    const oldChange = callback(node(text.value('mixed'), 'textarea'), 'onChange'), oldSave = callback(node(text.saveInput)); await act(async () => oldChange({ target: { value: '当前正文' } })); await act(async () => { oldChange({ target: { value: '迟到旧值' } }); oldSave(); }); expect(save).not.toHaveBeenCalled(); expect(node(text.value('mixed'), 'textarea').value).toBe('当前正文'); await act(async () => callback(node(text.saveInput))()); expect(save).toHaveBeenCalledExactlyOnceWith([{ kind: 'text', value: '当前正文' }]);
  });
  it('换preview后旧确认submit/close/checkbox不能写新批次，新预览必须再次确认', async () => {
    const oldApply = vi.fn(), oldClose = vi.fn(), nextApply = vi.fn(), nextClose = vi.fn(); let props = { ticket: {}, view: editView('old'), current: () => true, onApply: oldApply, onClose: oldClose, onStop: vi.fn() }, key = 'old';
    const rerender = await mount(() => <PreviewDialog key={key} {...props}/>); await act(async () => callback(node(text.confirmation, 'input'), 'onChange')({ target: { checked: true } })); expect(node(text.submit).disabled).toBe(false); const oldSubmit = callback(node(text.submit)), oldCloseHandler = callback(node(text.closePreview)), oldCheck = callback(node(text.confirmation, 'input'), 'onChange');
    props = { ...props, ticket: {}, view: editView('next'), onApply: nextApply, onClose: nextClose }; key = 'next'; await rerender(); expect(node(text.confirmation, 'input').checked).toBe(false); await act(async () => { oldSubmit(); oldCloseHandler(); oldCheck({ target: { checked: true } }); }); expect(oldApply).not.toHaveBeenCalled(); expect(nextApply).not.toHaveBeenCalled(); expect(oldClose).not.toHaveBeenCalled(); expect(nextClose).not.toHaveBeenCalled(); expect(node(text.submit).disabled).toBe(true);
    await act(async () => callback(node(text.confirmation, 'input'), 'onChange')({ target: { checked: true } })); await act(async () => callback(node(text.submit))()); expect(nextApply).toHaveBeenCalledOnce();
  });
  it('误复用相同preview key仍拒旧确认；仅回调引用更新不会重新授权旧preview', async () => {
    const apply = vi.fn(), nextApply = vi.fn(); let props = { ticket: {}, view: editView('old'), current: () => true, onApply: apply, onClose: vi.fn(), onStop: vi.fn() }; const rerender = await mount(() => <PreviewDialog {...props}/>); await act(async () => callback(node(text.confirmation, 'input'), 'onChange')({ target: { checked: true } })); props = { ...props, view: editView('next'), onApply: nextApply }; await rerender(); await act(async () => callback(node(text.submit))()); expect(apply).not.toHaveBeenCalled(); expect(nextApply).not.toHaveBeenCalled();
  });
  it('旧pending预览stop回调不取消后继任务，当前同窗口的新任务stop正常', async () => {
    const stopA = vi.fn(), stopB = vi.fn(), value = editView('pending'); value.preview = undefined; value.busy = true; value.taskId = 'preview-task'; let props = { ticket: {}, view: value, current: () => true, onApply: vi.fn(), onClose: vi.fn(), onStop: stopA }; const rerender = await mount(() => <PreviewDialog {...props}/>), oldStop = callback(node(text.stop)); props = { ...props, view: { ...value, taskId: 'apply-task' }, onStop: stopB }; await rerender(); await act(async () => oldStop()); expect(stopA).not.toHaveBeenCalled(); expect(stopB).not.toHaveBeenCalled(); await act(async () => callback(node(text.stop))()); expect(stopB).toHaveBeenCalledOnce();
  });
});

/** 复制输入只接独立的新虚拟行；数据库定位与append原子性由父页和editor专项验证。 */
function duplicateFixture(freeze=true){
  const source=page('复制源'),names=['id','note','nullable','payload','real','generated','omitted'];
  if(source.edit?.kind!=='editable')throw Error('需要合成可编辑快照');
  source.columns=names.map((name,index)=>({name,declaredType:'',generated:index===5}));
  source.result.columns=names.map((name,index)=>({key:'c'+index,name,type:'SQLITE'}));
  source.edit.columns=names.map((name,index)=>({name,declaredType:'',generated:index===5,nullable:true,hasDefault:index===0||index===6}));
  const original:SqliteDraftRow={id:'source',index:0,deleted:false,values:[{kind:'integer',value:'9223372036854775807'},{kind:'text',value:"原草稿'\0🚢\r\n末行"},{kind:'null'},{kind:'blob',value:'00fFa0'},{kind:'real',value:'Infinity'},{kind:'text',value:'原生成值'},undefined]};
  const virtual:SqliteDraftRow={id:'copy-virtual',deleted:false,values:original.values.map((value,index)=>index===5?undefined:value===undefined?undefined:{...value})};
  if(freeze){virtual.values.forEach(value=>{if(value)Object.freeze(value);});Object.freeze(virtual.values);Object.freeze(virtual);}
  return{source,original,virtual};
}
async function duplicateMount(freeze=true,patch:Partial<import('react').ComponentProps<typeof ValueDialog>>={}){
  const fixture=duplicateFixture(freeze),state={current:true},save=vi.fn<(values:(import('../../src/shared/sqliteTableEdit').SqliteOriginalValue|undefined)[])=>boolean>(()=>true),close=vi.fn();
  const base:import('react').ComponentProps<typeof ValueDialog>={ticket:{},page:fixture.source,row:fixture.virtual,duplicate:true,duplicateOwner:'duplicate-1',current:()=>state.current,onSave:save,onClose:close,...patch};
  let props=base,key='duplicate-1';const rerender=await mount(()=><ValueDialog key={key}{...props}/>);
  return{...fixture,state,save,close,base,async render(patch:Partial<typeof base>={},nextKey=key){props={...base,...patch};key=nextKey;await rerender();}};
}
describe('复制SQLite当前行为独立新增草稿',()=>{
 it('专用标题/提示/按钮和准确marker，未确认前取消零save且原行不变',async()=>{const f=await duplicateMount(),before=structuredClone(f.original);expect(document.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe(text.duplicateTitle);expect(document.body.textContent).toContain(text.duplicateHint);expect(document.querySelector('[data-sqlite-duplicate-input="duplicate-1"]')).not.toBeNull();expect(node(text.duplicateSave)).toBeDefined();expect(f.save).not.toHaveBeenCalled();await act(async()=>callback(node(text.duplicateCancel))());expect(f.save).not.toHaveBeenCalled();expect(f.close).toHaveBeenCalledOnce();expect(f.original).toEqual(before);});
 it('未碰typed字段完整保64位/NULL/blob大小写/原TEXT与非有限原REAL，生成列永不带入新增',async()=>{const f=await duplicateMount(),before=structuredClone(f.original);expect(node(text.include('generated'),'input').checked).toBe(false);expect(node(text.include('generated'),'input').disabled).toBe(true);await act(async()=>callback(node(text.duplicateSave))());expect(f.save).toHaveBeenCalledExactlyOnceWith([{kind:'integer',value:'9223372036854775807'},{kind:'text',value:"原草稿'\0🚢\r\n末行"},{kind:'null'},{kind:'blob',value:'00fFa0'},{kind:'real',value:'Infinity'},undefined,undefined]);expect(f.original).toEqual(before);expect(f.virtual.values[5]).toBeUndefined();expect(f.close).toHaveBeenCalledOnce();});
 it('可取消主键勾选明确用DEFAULT，NULL与省略保区分且原ID不改',async()=>{const f=await duplicateMount();await act(async()=>callback(node(text.include('id'),'input'),'onChange')({target:{checked:false}}));await act(async()=>callback(node(text.duplicateSave))());expect(f.save.mock.calls[0][0][0]).toBeUndefined();expect(f.save.mock.calls[0][0][2]).toEqual({kind:'null'});expect(f.original.values[0]).toEqual({kind:'integer',value:'9223372036854775807'});});
 it('可修正新记录ID和非有限REAL、明确BLOB与TEXT，最终仅输出typed数组不修改虚拟源',async()=>{const f=await duplicateMount(),before=structuredClone(f.virtual);await act(async()=>callback(node(text.value('id'),'textarea'),'onChange')({target:{value:'-9223372036854775808'}}));await act(async()=>callback(node(text.value('real'),'textarea'),'onChange')({target:{value:'1.25'}}));await act(async()=>callback(node(text.value('payload'),'textarea'),'onChange')({target:{value:'00FFa1'}}));await act(async()=>callback(node(text.value('note'),'textarea'),'onChange')({target:{value:'新文本'}}));await act(async()=>callback(node(text.duplicateSave))());expect(f.save.mock.calls[0][0]).toEqual([{kind:'integer',value:'-9223372036854775808'},{kind:'text',value:'新文本'},{kind:'null'},{kind:'blob',value:'00FFa1'},{kind:'real',value:'1.25'},undefined,undefined]);expect(f.virtual).toEqual(before);});
 it('真实双击与onSave重入都只交付一次，成功后旧save/change/close失效',async()=>{const f=await duplicateMount(),save=callback(node(text.duplicateSave)),close=callback(node(text.duplicateCancel)),change=callback(node(text.value('note'),'textarea'),'onChange');f.save.mockImplementationOnce(()=>{save();close();return true;});await act(async()=>{save();save();change({target:{value:'旧污染'}});close();});expect(f.save).toHaveBeenCalledOnce();expect(f.close).toHaveBeenCalledOnce();expect(f.virtual.values[1]).toEqual({kind:'text',value:"原草稿'\0🚢\r\n末行"});});
 it.each(['duplicate','duplicateOwner']as const)('%s模式ABA永久撤原owner，旧save/close/change以及新闭包都不授权',async mode=>{const f=await duplicateMount(),save=callback(node(text.duplicateSave)),close=callback(node(text.duplicateCancel)),change=callback(node(text.value('note'),'textarea'),'onChange');await f.render(mode==='duplicate'?{duplicate:false}:{duplicateOwner:'duplicate-2'});await f.render();await act(async()=>{save();close();change({target:{value:'旧污染'}});callback(node(text.duplicateSave))();callback(node(text.duplicateCancel))();});expect(f.save).not.toHaveBeenCalled();expect(f.close).not.toHaveBeenCalled();expect(node(text.value('note'),'textarea').value).toBe("原草稿'\0🚢\n末行");});
 it('默认编辑模式不显示复制文案或marker，切true再false也不能复活默认保存权',async()=>{const source=page('普通'),original=row('普通正文'),save=vi.fn(()=>true),close=vi.fn();let props:import('react').ComponentProps<typeof ValueDialog>={ticket:{},page:source,row:original,current:()=>true,onSave:save,onClose:close};const rerender=await mount(()=><ValueDialog{...props}/>);expect(document.body.textContent).not.toContain(text.duplicateHint);expect(document.querySelector('[data-sqlite-duplicate-input]')).toBeNull();expect(node(text.saveInput)).toBeDefined();const old=callback(node(text.saveInput));props={...props,duplicate:true,duplicateOwner:'duplicate-wrong'};await rerender();props={...props,duplicate:false,duplicateOwner:undefined};await rerender();await act(async()=>{old();callback(node(text.saveInput))();});expect(save).not.toHaveBeenCalled();expect(close).not.toHaveBeenCalled();});
 it('误传已存在index原行的复制模式禁止字段与save，但可取消自己的错误窗口',async()=>{const owned=duplicateFixture(false),f=await duplicateMount(false,{page:owned.source,row:owned.original});expect(node(text.duplicateSave).disabled).toBe(true);await act(async()=>{callback(node(text.value('note'),'textarea'),'onChange')({target:{value:'不应写'}});callback(node(text.duplicateSave))();});expect(f.save).not.toHaveBeenCalled();await act(async()=>callback(node(text.duplicateCancel))());expect(f.close).toHaveBeenCalledOnce();});
 it('新虚拟row后来出现existing index即永久失效，恢复undefined也不复活',async()=>{const f=await duplicateMount(false),old=callback(node(text.duplicateSave));f.virtual.index=0;await f.render();delete f.virtual.index;await f.render();await act(async()=>{old();callback(node(text.duplicateSave))();});expect(f.save).not.toHaveBeenCalled();expect(node(text.duplicateSave).disabled).toBe(true);});
 it('即使传入虚拟row含生成原值，也只展示省略且输出undefined，不改传入row',async()=>{const owned=duplicateFixture(false);owned.virtual.values[5]={kind:'text',value:'不应复制的生成值'};const f=await duplicateMount(false,{page:owned.source,row:owned.virtual});expect(node(text.include('generated'),'input').checked).toBe(false);await act(async()=>callback(node(text.duplicateSave))());expect(f.save.mock.calls[0][0][5]).toBeUndefined();expect(owned.virtual.values[5]).toEqual({kind:'text',value:'不应复制的生成值'});});
 it('父拒绝暂存保留全部输入；明确修正后再次保存，不自动追加新行',async()=>{const f=await duplicateMount();f.save.mockReturnValueOnce(false);await act(async()=>callback(node(text.duplicateSave))());expect(f.close).not.toHaveBeenCalled();expect(node(text.value('id'),'textarea').value).toBe('9223372036854775807');await act(async()=>callback(node(text.include('id'),'input'),'onChange')({target:{checked:false}}));await act(async()=>callback(node(text.duplicateSave))());expect(f.save).toHaveBeenCalledTimes(2);expect(f.save.mock.calls[1][0][0]).toBeUndefined();expect(f.close).toHaveBeenCalledOnce();});
 it('换key后旧复制窗口回调不保存或关闭新窗口；新owner单独确认',async()=>{const f=await duplicateMount(),old=callback(node(text.duplicateSave)),close=callback(node(text.duplicateCancel)),next=duplicateFixture(),save=vi.fn(()=>true),cancel=vi.fn();await f.render({ticket:{},page:next.source,row:next.virtual,duplicateOwner:'duplicate-2',onSave:save,onClose:cancel},'duplicate-2');await act(async()=>{old();close();});expect(f.save).not.toHaveBeenCalled();expect(f.close).not.toHaveBeenCalled();expect(save).not.toHaveBeenCalled();await act(async()=>callback(node(text.duplicateSave))());expect(save).toHaveBeenCalledOnce();expect(cancel).toHaveBeenCalledOnce();});
});

it('跨页按钮明确区别页内暂存，父页拒绝跨页时保留真实输入和旧票据',async()=>{
 const save=vi.fn(()=>true),close=vi.fn(),move=vi.fn((_direction:number,_values:unknown)=>{throw Error(text.recordPageDirty);});
 await mount(()=><ValueDialog ticket={{}} page={page('原页')} row={row('原值')} current={()=>true} onSave={save} onClose={close} navigation={{ownerId:'page-input',previous:false,next:true,pageNext:true,move}}/>);
 await act(async()=>callback(node(text.value('mixed'),'textarea'),'onChange')({target:{value:'未暂存原文'}}));
 expect(document.body.textContent).not.toContain(text.saveNextRecord);await act(async()=>callback(node(text.nextPageRecord))());
 expect(move).toHaveBeenCalledExactlyOnceWith(1,[{kind:'text',value:'未暂存原文'}]);expect(node(text.value('mixed'),'textarea').value).toBe('未暂存原文');expect(document.body.textContent).toContain(text.recordPageDirty);expect(save).not.toHaveBeenCalled();expect(close).not.toHaveBeenCalled();
});

/** 本例文件端口仅返回RAM字节；表单、查看器、旧回调守卫和最终SQLite合同真实运行。 */
async function binaryFieldMount(hex = '00ff', generated = false) {
  const original = { id: 'original-0', index: 0, deleted: false, values: [{ kind: 'blob' as const, value: hex }] }, source = page('字节原表');
  if (source.edit?.kind !== 'editable') throw Error('缺少合成编辑快照');
  source.edit.columns = [{ name: 'payload', declaredType: 'BLOB', generated, nullable: true, hasDefault: false }]; source.edit.rows = [original.values];
  let current = true; const save = vi.fn((_values: unknown[]) => true), close = vi.fn(), invoke = vi.fn(async (_command: string, _input?: unknown): Promise<any> => null);
  (window as any).dbark = { invoke };
  await mount(() => <ValueDialog ticket={{}} page={source} row={original} current={() => current} onSave={save} onClose={close}/>);
  const fileButton = (label: string) => { const found = document.querySelectorAll('button').find(button => button.textContent === label); expect(found, label).toBeDefined(); expect(found!.disabled, label + '应在首次提交后可用').toBe(false); return found!; };
  return { original, save, close, invoke, fileButton, invalidate: () => { current = false; } };
}

describe('SQLite原表单完整BLOB查看和文件缓冲', () => {
  it('载入只更新准确字段缓冲，保留未触碰原行；取消不暂存、不预览或提交', async () => {
    const f = await binaryFieldMount(); f.invoke.mockResolvedValue({ base64: 'AP8A', bytes: 3, name: '本例.bin' });
    await act(async () => callback(f.fileButton('从文件载入字节'))());
    expect(node(text.value('payload'), 'textarea').value).toBe('0x00ff00'); expect(f.original.values[0].value).toBe('00ff'); expect(f.save).not.toHaveBeenCalled();
    await act(async () => callback(node(text.cancelInput))()); expect(f.close).toHaveBeenCalledOnce(); expect(f.save).not.toHaveBeenCalled();
    expect(f.invoke.mock.calls.map(call => call[0])).toEqual(['binaryCellFiles.open']);
  });
  it.each(['', 'AP8A'])('文件%s保存到原集中草稿合同，零字节不变NULL，前缀不写入SQLite', async base64 => {
    const f = await binaryFieldMount(); f.invoke.mockResolvedValue({ base64, bytes: Buffer.from(base64, 'base64').length, name: '本例.bin' });
    await act(async () => callback(f.fileButton('从文件载入字节'))()); await act(async () => callback(node(text.saveInput))());
    expect(f.save).toHaveBeenCalledExactlyOnceWith([{ kind: 'blob', value: Buffer.from(base64, 'base64').toString('hex') }]); expect(f.original.values[0].value).toBe('00ff');
  });
  it('32769字节载入整次拒绝，原缓冲不变；32768完整字节可暂存而不截断', async () => {
    const f = await binaryFieldMount(), oversized = Buffer.alloc(32769, 255);
    f.invoke.mockResolvedValue({ base64: oversized.toString('base64'), bytes: oversized.length, name: '超限.bin' }); await act(async () => callback(f.fileButton('从文件载入字节'))());
    expect(document.body.textContent).toContain(text.blobEditLimit); expect(node(text.value('payload'), 'textarea').value).toBe('00ff'); expect(f.save).not.toHaveBeenCalled();
    const maximum = oversized.subarray(0, 32768); f.invoke.mockResolvedValue({ base64: maximum.toString('base64'), bytes: maximum.length, name: '边界.bin' }); await act(async () => callback(f.fileButton('从文件载入字节'))());
    await act(async () => callback(node(text.saveInput))()); expect(f.save.mock.calls[0][0][0]).toEqual({ kind: 'blob', value: maximum.toString('hex') });
  });
  it('原有大BLOB和生成列只读分页仍另存全部字节，无载入或误暂存片段', async () => {
    const hex = '00ff'.repeat(17000), f = await binaryFieldMount(hex, true);
    expect(document.querySelectorAll('button').some(button => button.textContent === '从文件载入字节')).toBe(false);
    f.invoke.mockResolvedValue({ bytes: hex.length / 2, name: '完整.bin' }); await act(async () => callback(f.fileButton('原字节另存为'))());
    expect(f.invoke).toHaveBeenCalledExactlyOnceWith('binaryCellFiles.save', { base64: Buffer.from(hex, 'hex').toString('base64'), suggestedName: 'binary-cell.bin' });
    expect(document.querySelectorAll('textarea').find(node => node.getAttribute('aria-label') === '完整二进制 Hex')!.value.length).toBeLessThan(hex.length);
    await act(async () => callback(node(text.saveInput))()); expect(f.save).toHaveBeenCalledExactlyOnceWith([{ kind: 'blob', value: hex }]);
  });
  it.each(['close', 'source', 'field'] as const)('文件等待期间%s后，迟到回包不能暂存或污染原行', async mode => {
    const f = await binaryFieldMount(); let resolve!: (value: unknown) => void; f.invoke.mockReturnValue(new Promise(yes => { resolve = yes; }));
    await act(async () => callback(f.fileButton('从文件载入字节'))());
    if (mode === 'close') await act(async () => callback(node(text.cancelInput))());
    if (mode === 'source') f.invalidate();
    if (mode === 'field') await act(async () => callback(node(text.type('payload'), 'select'), 'onChange')({ target: { value: 'text' } }));
    await act(async () => resolve({ base64: '/w==', bytes: 1, name: '迟到.bin' })); expect(f.save).not.toHaveBeenCalled(); expect(f.original.values[0].value).toBe('00ff'); expect(f.invoke).toHaveBeenCalledTimes(1);
  });
  it('非法Hex仍保留缓冲供修正，NULL必须显式选择', async () => {
    const f = await binaryFieldMount(); await act(async () => callback(node(text.value('payload'), 'textarea'), 'onChange')({ target: { value: '0xGG' }, currentTarget: node(text.value('payload'), 'textarea') }));
    expect(node(text.value('payload'), 'textarea').value).toBe('0xGG'); await act(async () => callback(node(text.saveInput))()); expect(f.save).not.toHaveBeenCalled();
    await act(async () => callback(node(text.type('payload'), 'select'), 'onChange')({ target: { value: 'null' } })); await act(async () => callback(node(text.saveInput))()); expect(f.save).toHaveBeenCalledExactlyOnceWith([{ kind: 'null' }]);
  });
});

it('超过完整查看预算的已有BLOB只显示明确错误，不误报DEFAULT或提供截断保存', async () => {
  const f = await binaryFieldMount('00'.repeat(2 * 1024 * 1024 + 1));
  expect(document.body.textContent).toContain('2 MiB'); expect(document.body.textContent).not.toContain('DEFAULT（尚未填写）');
  expect(document.querySelectorAll('button').some(button => ['从文件载入字节', '原字节另存为'].includes(button.textContent))).toBe(false); expect(f.invoke).not.toHaveBeenCalled(); expect(f.save).not.toHaveBeenCalled();
});

it('整行JSON与表单互换保typed输入；非法文档不切换、不部分暂存，正确文档才保存', async () => {
  const jsonText = (await import('../../src/renderer/locales/sqliteRecordJson.zh-CN')).sqliteRecordJsonZh;
  const save = vi.fn(() => true), close = vi.fn(); const props = { ticket: {}, page: page('输入'), row: row('原值'), current: () => true, onSave: save, onClose: close };
  await mount(() => <ValueDialog {...props}/>);
  await act(async () => callback(node(text.value('mixed'), 'textarea'), 'onChange')({ target: { value: '表单草稿🚢' } }));
  await act(async () => callback(node(jsonText.json))());
  const area = node(jsonText.input, 'textarea'), document = JSON.parse(area.value); expect(document.fields[0].value).toEqual({ kind: 'text', value: '表单草稿🚢' });
  document.fields[0].value = { kind: 'integer', value: 9007199254740992 };
  await act(async () => { area.value = JSON.stringify(document); callback(area, 'onChange')({ currentTarget: area }); });
  await act(async () => callback(node(jsonText.form))()); expect(node(jsonText.input,'textarea').value).toBe(JSON.stringify(document)); expect(save).not.toHaveBeenCalled();
  await act(async () => callback(node(text.saveInput))()); expect(save).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled();
  document.fields[0].value.value = '9223372036854775807';
  await act(async () => { const current = node(jsonText.input,'textarea'); current.value = JSON.stringify(document); callback(current,'onChange')({ currentTarget: current }); });
  await act(async () => callback(node(jsonText.form))()); expect(node(text.value('mixed'),'textarea').value).toBe('9223372036854775807'); expect(node(text.type('mixed'),'select').value).toBe('integer');
  await act(async () => callback(node(text.saveInput))()); expect(save).toHaveBeenCalledExactlyOnceWith([{ kind:'integer',value:'9223372036854775807' }]); expect(close).toHaveBeenCalledOnce();
});
it('整行JSON旧渲染和卸载回调不能改变新文档或新页；原来源失效保留正文并拒绝保存', async () => {
  const jsonText = (await import('../../src/renderer/locales/sqliteRecordJson.zh-CN')).sqliteRecordJsonZh;
  const save = vi.fn(() => true), close = vi.fn(); let live = true, key = 'first', props = { ticket: {}, page: page('原'), row: row('原'), current: () => live, onSave: save, onClose: close };
  const rerender = await mount(() => <ValueDialog key={key} {...props}/>); await act(async () => callback(node(jsonText.json))());
  const oldChange = callback(node(jsonText.input,'textarea'),'onChange'), oldSave = callback(node(text.saveInput)), oldForm = callback(node(jsonText.form));
  live = false; await act(async () => oldSave()); expect(save).not.toHaveBeenCalled(); const original = node(jsonText.input,'textarea').value;
  await act(async () => oldForm()); expect(node(jsonText.input,'textarea').value).toBe(original);
  key = 'second'; live = true; props = { ...props, ticket:{}, page:page('新'), row:row('新') }; await rerender(); await act(async () => callback(node(jsonText.json))()); const next = node(jsonText.input,'textarea').value;
  await act(async () => { oldChange({ currentTarget: { value:'旧正文污染' } }); oldSave(); oldForm(); }); expect(node(jsonText.input,'textarea').value).toBe(next); expect(save).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled();
});
it('整行JSON保存后导航传完整typed行，非法JSON则不导航；单格编辑不出现整行入口', async () => {
  const jsonText = (await import('../../src/renderer/locales/sqliteRecordJson.zh-CN')).sqliteRecordJsonZh, move = vi.fn(() => true);
  await mount(() => <ValueDialog ticket={{}} page={page('页')} row={row('原')} current={() => true} onSave={() => true} onClose={() => {}} navigation={{ ownerId:'json',previous:false,next:true,move }}/>);
  await act(async () => callback(node(jsonText.json))()); const area=node(jsonText.input,'textarea'), value=JSON.parse(area.value); value.fields[0].value={kind:'null'};
  await act(async () => { area.value='{';callback(area,'onChange')({currentTarget:area}); }); await act(async () => callback(node(text.saveNextRecord))()); expect(move).not.toHaveBeenCalled();
  await act(async () => { const current=node(jsonText.input,'textarea');current.value=JSON.stringify(value);callback(current,'onChange')({currentTarget:current}); }); await act(async () => callback(node(text.saveNextRecord))()); expect(move).toHaveBeenCalledExactlyOnceWith(1,[{kind:'null'}]);
  await act(async () => root!.unmount()); root=undefined;
  await mount(() => <ValueDialog ticket={{}} page={page('单格')} row={row('单格')} column={0} current={() => true} onSave={() => true} onClose={() => {}}/>); expect(document.querySelectorAll('button').some(value=>value.getAttribute('aria-label')===jsonText.json)).toBe(false);
});
