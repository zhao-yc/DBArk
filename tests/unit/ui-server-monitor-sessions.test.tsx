import { act } from 'react';
import { afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi } from 'vitest';
import { memoryDocument,MemoryEvent } from '../fixtures/memory-dom';
import { monitorSnapshot } from '../fixtures/server-monitor';
import type { ServerMonitorSnapshot } from '../../src/shared/serverMonitor';
import type { ServerMonitorDialogProps } from '../../src/renderer/components/ServerMonitorDialog';
import { serverMonitorSessionsZh as t } from '../../src/renderer/serverMonitorSessionsZh';
import { serverMonitorZhCN as monitor } from '../../src/renderer/serverMonitorZh';

const globals=['window','document','navigator','IS_REACT_ACT_ENVIRONMENT'].map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]as const);
let document:ReturnType<typeof memoryDocument>,createRoot:typeof import('react-dom/client')['createRoot'],root:ReturnType<typeof createRoot>,Dialog:typeof import('../../src/renderer/components/ServerMonitorDialog')['ServerMonitorDialog'];
let props:ServerMonitorDialogProps,read:ReturnType<typeof vi.fn>,cancel:ReturnType<typeof vi.fn>;
/** 监控快照全部为RAM，真实Dialog/会话组件/控制器/ReactDOM不替换。 */
function snapshot():ServerMonitorSnapshot{const result=monitorSnapshot();if(result.sessions.status==='available'){const base=result.sessions.value.rows[0];result.sessions.value.rows=[{...base,id:'9007199254740993',user:'甲用户',seconds:'10'},{...base,id:'9007199254740992',user:'乙用户',seconds:'2'},{...base,id:'4',user:null,state:'',seconds:null},{...base,id:'5',user:'甲用户',seconds:'2'}];}return result;}
beforeAll(async()=>{document=memoryDocument();({createRoot}=await import('react-dom/client'));({ServerMonitorDialog:Dialog}=await import('../../src/renderer/components/ServerMonitorDialog'));});
beforeEach(()=>{Object.defineProperty(document,'visibilityState',{value:'visible',writable:true,configurable:true});read=vi.fn().mockResolvedValue(snapshot());cancel=vi.fn().mockResolvedValue(undefined);props={open:true,connectionId:'a',connectionRevision:1,services:{read,cancel},onClose:vi.fn()};const container=document.createElement('div');document.body.appendChild(container);root=createRoot(container as unknown as Element);});
afterEach(async()=>{await act(async()=>root.unmount());document.body.textContent='';});
afterAll(()=>{for(const[name,descriptor]of globals)if(descriptor)Object.defineProperty(globalThis,name,descriptor);else Reflect.deleteProperty(globalThis,name);});
async function render(patch:Partial<ServerMonitorDialogProps>={}){props={...props,...patch};await act(async()=>root.render(<Dialog {...props}/>));}
/** 通过真实DOM委派输入/点击，不反射React内部回调，也不触发任何服务命令。 */
async function search(value:string){const input=document.querySelectorAll('input').find(node=>node.getAttribute('aria-label')===t.search)!;await act(async()=>{input.value=value;input.dispatchEvent(new MemoryEvent('input'));});return input;}
async function click(name:string){const button=document.querySelectorAll('button').find(node=>node.getAttribute('aria-label')===name||node.textContent===name);expect(button,name).toBeDefined();await act(async()=>{button!.dispatchEvent(new MemoryEvent('click'));});return button!;}
const ids=()=>document.querySelector('tbody')!.querySelectorAll('tr').map(row=>row.querySelectorAll('td')[0].textContent);
const query=()=>document.querySelectorAll('input').find(node=>node.getAttribute('aria-label')===t.search)!.value;
describe('S02会话本地视图真实React/RAM',()=>{
  it('筛选、方向和持续秒数排序只处理当前快照，精确计数/NULL/空串/范围提示保留',async()=>{
    await render();expect(ids()).toEqual(['4','5','9007199254740992','9007199254740993']);await search('甲');await click(t.bySeconds);await click(t.toDescending);expect(ids()).toEqual(['9007199254740993','5']);expect(document.body.textContent).toContain(t.counts(2,4));expect(document.body.textContent).toContain(t.scope);expect(document.body.textContent).toContain(t.sqlScope);expect(read).toHaveBeenCalledOnce();expect(cancel).not.toHaveBeenCalled();await search('没有此摘要尾部');expect(ids()).toEqual([]);expect(document.body.textContent).toContain(t.noMatches);expect(document.body.textContent).toContain(t.sqlScope);await click(t.clear);expect(document.body.textContent).toContain(monitor.null);expect(document.body.textContent).toContain(monitor.emptyString);
  });
  it('同目标手动刷新保留筛选及方向，新快照按当前条件重新投影',async()=>{
    await render();await search('甲');await click(t.bySeconds);await click(t.toDescending);const next=snapshot();if(next.sessions.status==='available')next.sessions.value.rows[3].seconds='100';read.mockResolvedValueOnce(next);await click(monitor.refresh);expect(query()).toBe('甲');expect(ids()).toEqual(['5','9007199254740993']);expect(read).toHaveBeenCalledTimes(2);expect(document.body.textContent).toContain(t.counts(2,4));
  });
  it('切连接/修订/ABA重置条件，旧目标控件的迟到DOM事件不能修改新视图',async()=>{
    await render();const stale=await search('甲');await click(t.bySeconds);const oldDirection=await click(t.toDescending);await render({connectionId:'b',connectionRevision:2});expect(query()).toBe('');expect(ids()).toEqual(['4','5','9007199254740992','9007199254740993']);await act(async()=>{stale.value='乙';stale.dispatchEvent(new MemoryEvent('input'));oldDirection.dispatchEvent(new MemoryEvent('click'));});expect(query()).toBe('');await search('乙');await render({connectionId:'a',connectionRevision:3});expect(query()).toBe('');await search('甲');await render({connectionRevision:4});expect(query()).toBe('');expect(read).toHaveBeenCalledTimes(4);
  });
  it('关闭重开不沿用旧查询或旧控件，仍由原控制器负责重新读取',async()=>{
    await render();const stale=await search('甲');await click(t.toDescending);await render({open:false});await render({open:true});expect(query()).toBe('');expect(ids()).toEqual(['4','5','9007199254740992','9007199254740993']);await act(async()=>{stale.value='乙';stale.dispatchEvent(new MemoryEvent('input'));});expect(query()).toBe('');expect(read).toHaveBeenCalledTimes(2);
  });
  it('同目标某次会话不可用后恢复仍保留本地条件，不误说搜索完整SQL',async()=>{
    await render();await search('甲');const unavailable=snapshot();unavailable.sessions={status:'unavailable',reason:'RAM权限不足'};read.mockResolvedValueOnce(unavailable);await click(monitor.refresh);expect(document.body.textContent).toContain('RAM权限不足');expect(document.body.textContent).toContain(t.scope);read.mockResolvedValueOnce(snapshot());await click(monitor.refresh);expect(query()).toBe('甲');expect(ids()).toEqual(['5','9007199254740993']);expect(document.body.textContent).toContain(t.sqlScope);expect(read).toHaveBeenCalledTimes(3);
  });
});
