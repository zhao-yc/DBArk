import { act, StrictMode, useEffect } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { memoryDocument, MemoryEvent } from '../fixtures/memory-dom';
import { useApplicationInfo } from '../../src/renderer/useApplicationInfo';
import { EncryptionStatus } from '../../src/renderer/components/EncryptionStatus';
import { zh } from '../../src/renderer/locales/zh-CN';

const port = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('../../src/renderer/lib', () => ({ invoke: port.invoke, errorMessage: (reason: unknown) => reason instanceof Error ? reason.message : String(reason) }));
const globals = ['window','document','navigator','IS_REACT_ACT_ENVIRONMENT'].map(name => [name,Object.getOwnPropertyDescriptor(globalThis,name)] as const);
let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client').createRoot, root: ReturnType<typeof createRoot> | undefined;
let information: ReturnType<typeof useApplicationInfo>, renders = 0;
interface Deferred { promise: Promise<any>; resolve(value: any): void; reject(reason: unknown): void; }
let metadata: Deferred[], checks: Deferred[];

/** 仅提供RAM IPC应答；产品hook、组件和ReactDOM状态机都实际运行。 */
function deferred(): Deferred { let resolve!: Deferred['resolve'], reject!: Deferred['reject']; const promise = new Promise((yes,no) => { resolve=yes; reject=no; }); return { promise,resolve,reject }; }
function Probe({ explicitEachMount = false }: { explicitEachMount?: boolean }) {
  const value = useApplicationInfo('0.28.0'); information = value; renders++;
  // 测试驱动器模拟每个挂载代次已发生的明确检测；普通启动用例始终关闭它。
  useEffect(() => { if (explicitEachMount) void value.checkEncryption(); }, []);
  return <><div id="metadata">{value.version}:{value.platform}</div><div id="runtime-error">{value.runtimeError}</div><EncryptionStatus available={value.encryptionAvailable} busy={value.checkingEncryption} error={value.encryptionError} onCheck={value.checkEncryption}/></>;
}
beforeAll(async () => {
  document=memoryDocument(); const create=document.createElement.bind(document);
  document.createElement=name=>{const node=create(name),set=node.setAttribute.bind(node),remove=node.removeAttribute.bind(node);node.setAttribute=(key,value)=>{set(key,value);if(key==='disabled')node.disabled=true;};node.removeAttribute=key=>{remove(key);if(key==='disabled')node.disabled=false;};return node;};
  ({createRoot}=await import('react-dom/client'));
});
beforeEach(() => {
  metadata=[]; checks=[]; renders=0; port.invoke.mockReset().mockImplementation((command: string, input: object) => {
    expect(input).toEqual({}); const next=deferred();
    if(command==='app.runtimeInfo')metadata.push(next);else if(command==='app.info')checks.push(next);else throw Error('禁止其它IPC：'+command);
    return next.promise;
  });
});
afterEach(async () => { if(root)await act(async()=>root!.unmount());root=undefined;document.body.textContent=''; });
afterAll(() => { for(const[name,value]of globals)if(value)Object.defineProperty(globalThis,name,value);else Reflect.deleteProperty(globalThis,name); });
/** 标准StrictMode含真实effect清理/重建，不手工复制hook或生命周期条件。 */
async function mount(explicitEachMount=false) { const host=document.createElement('div');document.body.appendChild(host);root=createRoot(host as any);await act(async()=>root!.render(<StrictMode><Probe explicitEachMount={explicitEachMount}/></StrictMode>)); }
function button() { return document.querySelector('button')!; }
function clickCallback() { const node:any=button(),key=Object.keys(node).find(key=>key.startsWith('__reactProps$'))!; return node[key].onClick as()=>void; }
async function click() { expect(button().disabled).toBe(false);await act(async()=>{button().dispatchEvent(new MemoryEvent('click'));}); }
const nativeInfo = (encryptionAvailable: boolean) => ({version:'0.28.0',platform:'darwin',dataPath:'RAM',encryptionAvailable});

it('启动及StrictMode重复只投递元信息，未知不冒充可用/不可用，不自动检测', async () => {
  await mount();expect(metadata).toHaveLength(2);expect(checks).toHaveLength(0);expect(port.invoke.mock.calls.map(call=>call[0])).toEqual(['app.runtimeInfo','app.runtimeInfo']);
  expect(information.encryptionAvailable).toBeNull();expect(document.body.textContent).toContain(zh.app.encryptionUnchecked);expect(document.body.textContent).not.toContain(zh.app.text024);expect(document.body.textContent).not.toContain(zh.app.text025);
  await act(async()=>metadata[1].resolve({version:'当前',platform:'darwin',dataPath:'RAM'}));expect(document.querySelector('div[id="metadata"]')!.textContent).toBe('当前:darwin');
  await act(async()=>metadata[0].resolve({version:'过期',platform:'win32',dataPath:'旧'}));expect(document.querySelector('div[id="metadata"]')!.textContent).toBe('当前:darwin');expect(checks).toHaveLength(0);
});

it('元信息失败明确展示，保护状态继续未知且不探测', async () => {
  await mount();await act(async()=>metadata[1].reject(Error('原Main元信息错误')));expect(information.runtimeError).toBe(zh.app.runtimeInfoFailed+'原Main元信息错误');expect(document.body.textContent).toContain(information.runtimeError);expect(information.encryptionAvailable).toBeNull();expect(checks).toHaveLength(0);
  await act(async()=>metadata[0].reject(Error('旧挂载错误')));expect(information.runtimeError).toContain('原Main元信息错误');
});

it.each([true,false])('明确点击才检测，重复回调同步锁定，真实%s正确显示；再次失败回到未知并保留原消息', async available => {
  await mount();const original=clickCallback();await act(async()=>{original();original();});expect(checks).toHaveLength(1);expect(button().disabled).toBe(true);expect(information.checkingEncryption).toBe(true);expect(information.encryptionAvailable).toBeNull();
  await act(async()=>checks[0].resolve(nativeInfo(available)));expect(information.encryptionAvailable).toBe(available);expect(button().disabled).toBe(false);expect(document.body.textContent).toContain(available?zh.app.text024:zh.app.text025);expect(information.encryptionError).toBe('');
  await click();expect(checks).toHaveLength(2);expect(information.encryptionAvailable).toBeNull();await act(async()=>checks[1].reject(Error('原Main加密错误')));
  expect(information.encryptionAvailable).toBeNull();expect(information.encryptionError).toBe(zh.app.encryptionCheckFailed+'原Main加密错误');expect(document.body.textContent).toContain('原Main加密错误');expect(document.body.textContent).toContain(zh.app.encryptionUnchecked);expect(button().disabled).toBe(false);
  await click();expect(information.encryptionError).toBe('');await act(async()=>checks[2].resolve(nativeInfo(true)));expect(information.encryptionAvailable).toBe(true);
});

it.each([undefined,null,{}, {encryptionAvailable:'true'}])('无效应答%s不能被当成可用或内存降级', async value => {
  await mount();await click();await act(async()=>checks[0].resolve(value));expect(information.encryptionAvailable).toBeNull();expect(information.encryptionError).toContain('返回无效结果');expect(button().disabled).toBe(false);
});

it.each(['result','error'] as const)('卸载后迟到%s不能渲染或通过旧按钮再次投递；新挂载锁不受影响', async mode => {
  await mount();const oldClick=clickCallback();await click();const pending=checks[0],oldMetadata=metadata[1];await act(async()=>root!.unmount());root=undefined;const ended=renders;
  await act(async()=>{if(mode==='result')pending.resolve(nativeInfo(true));else pending.reject(Error('旧请求错误'));oldMetadata.resolve({version:'旧',platform:'darwin',dataPath:'旧'});oldClick();});expect(renders).toBe(ended);expect(checks).toHaveLength(1);
  document.body.textContent='';await mount();await click();expect(checks).toHaveLength(2);expect(information.checkingEncryption).toBe(true);expect(information.encryptionAvailable).toBeNull();await act(async()=>checks[1].resolve(nativeInfo(false)));expect(information.encryptionAvailable).toBe(false);
});

it.each(['result','error'] as const)('StrictMode旧代次检测迟到%s不能释放新代次锁或污染状态', async mode => {
  await mount(true);expect(checks).toHaveLength(2);expect(information.checkingEncryption).toBe(true);
  await act(async()=>{if(mode==='result')checks[0].resolve(nativeInfo(true));else checks[0].reject(Error('StrictMode旧代次错误'));});expect(information.checkingEncryption).toBe(true);expect(information.encryptionAvailable).toBeNull();expect(information.encryptionError).toBe('');
  const click=clickCallback();await act(async()=>click());expect(checks).toHaveLength(2);await act(async()=>checks[1].resolve(nativeInfo(false)));expect(information.checkingEncryption).toBe(false);expect(information.encryptionAvailable).toBe(false);
});
