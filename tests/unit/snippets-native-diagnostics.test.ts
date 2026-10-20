import { afterEach, describe, expect, it, vi } from 'vitest';
import { SnippetsNativeDiagnostics, retainSnippetsDiagnostics, snippetsDiagnosticLimits, snippetsDiagnosticPolicy, snippetsDiagnosticTitle, explainDiagnosticPolicy, explainDiagnosticTitle, type NativeWindowSample, type RendererSample, type SnippetsDiagnosticPort } from '../helpers/snippetsNativeDiagnostics';
import { disposeSnippetsRenderer, sampleSnippetsRenderer, snippetsDiagnosticPort, explainDiagnosticPort } from '../e2e/snippets-native-diagnostics';
import type { ElectronApplication, Page, PlaywrightWorkerOptions } from '@playwright/test';

const input = (trace: PlaywrightWorkerOptions['trace'] = 'retain-on-failure', retry = 0) => ({ env: { DBARK_SNIPPETS_NATIVE_DIAGNOSTICS: '1' }, trace, retry, file: 'D:\\clone\\tests\\e2e\\snippets.spec.ts', title: snippetsDiagnosticTitle });
const native: NativeWindowSample[] = [{ id: 1, visible: true, focused: false, minimized: false, maximized: false, fullScreen: false, bounds: { x: 0, y: 10, width: 900, height: 700 }, contentBounds: { x: 0, y: 30, width: 900, height: 680 } }];
const renderer: RendererSample = { visibility: 'visible', focused: false, width: 900, height: 680, raf: { requested: 3, delivered: 2, pending: true, lastTimestamp: 120 }, dialog: null, edit: { count: 0, disabled: null, rect: null } };
/** 所有端口都在进程内受控，不加载 Electron，不创建页面或原生窗口。 */
function fixture(trace: PlaywrightWorkerOptions['trace'] = 'retain-on-failure', retry = 0) {
  const port = { startTrace: vi.fn(async () => {}), stopTrace: vi.fn(async (_path: string) => {}), native: vi.fn(async () => native), renderer: vi.fn(async () => renderer), dispose: vi.fn(async () => {}) } satisfies SnippetsDiagnosticPort;
  const output = { path: vi.fn((id: number) => `段${id}.zip`), trace: vi.fn(async (_path: string) => {}), remove: vi.fn(async (_path: string) => {}), summary: vi.fn(async (_value: unknown) => {}) };
  return { port, output, diagnostic: new SnippetsNativeDiagnostics(snippetsDiagnosticPolicy(input(trace, retry)), output) };
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('执行计划次级窗口诊断边界',()=>{
  const explainInput=(trace:PlaywrightWorkerOptions['trace']='retain-on-failure')=>({env:{DBARK_EXPLAIN_NATIVE_DIAGNOSTICS:'1'},trace,retry:0,file:'D:/clone/tests/e2e/explain-view.spec.ts',title:explainDiagnosticTitle});
  it('自身开关、文件及完整标题同时匹配；不能冒充片段入口，trace off不采集',()=>{
    expect(explainDiagnosticPolicy(explainInput()).enabled).toBe(true);
    expect(explainDiagnosticPolicy({...explainInput(),env:{}}).enabled).toBe(false);
    expect(explainDiagnosticPolicy({...explainInput(),env:{DBARK_SNIPPETS_NATIVE_DIAGNOSTICS:'1'}}).enabled).toBe(false);
    expect(explainDiagnosticPolicy({...explainInput(),file:'D:/clone/tests/e2e/snippets.spec.ts'}).enabled).toBe(false);
    expect(explainDiagnosticPolicy({...explainInput(),title:snippetsDiagnosticTitle}).enabled).toBe(false);
    expect(snippetsDiagnosticPolicy({...explainInput(),env:{DBARK_SNIPPETS_NATIVE_DIAGNOSTICS:'1'}}).enabled).toBe(false);
    expect(explainDiagnosticPolicy(explainInput('off')).enabled).toBe(false);
  });
  it('真实记录器标记表格切换前后并保存对应采样，不使用片段操作名冒充',async()=>{
    const {port,output,diagnostic}=fixture();await diagnostic.start(port,'initial');diagnostic.mark('before-plan-table');diagnostic.mark('after-plan-table');await diagnostic.finish(true);
    const summary=output.summary.mock.calls[0][0] as {markers:{phase:string}[];samples:{phase:string}[]};
    expect(summary.markers.map(value=>value.phase)).toContain('before-plan-table');expect(summary.markers.map(value=>value.phase)).toContain('after-plan-table');expect(summary.samples.map(value=>value.phase)).toContain('before-plan-table');expect(summary.samples.map(value=>value.phase)).toContain('after-plan-table');
  });
  it.each(['DBARK_INTEGRATION_ENABLED','DBARK_TEST_PASSWORD','DBARK_TEST_HOST','DBARK_C02_PRIVATE_KEY','DBARK_SSH_PASSWORD','DBARK_MTLS_CERT'])('执行计划也拒绝实库配置%s，不输出凭据值',key=>{
    const env={DBARK_EXPLAIN_NATIVE_DIAGNOSTICS:'1',[key]:key==='DBARK_INTEGRATION_ENABLED'?'1':'不能输出的私密值'};
    expect(()=>explainDiagnosticPolicy({...explainInput(),env})).toThrow('执行计划原生诊断拒绝实库或私网测试环境');
    try{explainDiagnosticPolicy({...explainInput(),env});}catch(error){expect(String(error)).not.toContain('不能输出的私密值');}
  });
  it('私网凭据getter不读取，继承实际截图／DOM及失败保留策略',()=>{
    const env={DBARK_EXPLAIN_NATIVE_DIAGNOSTICS:'1'};Object.defineProperty(env,'DBARK_TEST_PASSWORD',{enumerable:true,get(){throw Error('不得读取');}});
    expect(()=>explainDiagnosticPolicy({...explainInput(),env})).toThrow('拒绝实库或私网测试环境');
    const policy=explainDiagnosticPolicy(explainInput({mode:'retain-on-failure',screenshots:false,snapshots:false}));expect(policy).toMatchObject({enabled:true,screenshots:false,snapshots:false});expect(retainSnippetsDiagnostics(policy,false)).toBe(false);expect(retainSnippetsDiagnostics(policy,true)).toBe(true);
  });
  it('仅观察自身BrowserWindow及真实节流开关，不枚举或调整其他窗口',async()=>{
    const all=vi.fn(()=>{throw Error('不能枚举其它窗口');}),from=vi.fn((id:number)=>{expect(id).toBe(44);return {id:44,isDestroyed:()=>false,isVisible:()=>true,isFocused:()=>false,isMinimized:()=>false,isMaximized:()=>false,isFullScreen:()=>false,getBounds:()=>native[0].bounds,getContentBounds:()=>native[0].contentBounds,webContents:{id:55,getBackgroundThrottling:()=>true}};});
    const tracing={_isTracing:false},desktop={context:()=>({tracing}),evaluate:async(fn:Function,id:unknown)=>fn({BrowserWindow:{fromId:from,getAllWindows:all}},id)} as unknown as ElectronApplication;
    const evaluate=vi.fn(async()=>renderer),port=explainDiagnosticPort(desktop,{evaluate} as unknown as Page,44);
    expect(await port.native()).toEqual([{...native[0],id:44,webContentsId:55,backgroundThrottling:true}]);expect(from).toHaveBeenCalledExactlyOnceWith(44);expect(all).not.toHaveBeenCalled();
    await port.renderer();expect(evaluate).toHaveBeenCalledExactlyOnceWith(sampleSnippetsRenderer,'explain');await port.dispose();expect(evaluate).toHaveBeenLastCalledWith(disposeSnippetsRenderer);
  });
  it('原窗口消失时拒绝采样，不回退其他窗口；坏ID先于context访问拒绝',async()=>{
    const context=vi.fn(()=>({tracing:{_isTracing:false}})),desktop={context,evaluate:async(fn:Function,id:unknown)=>fn({BrowserWindow:{fromId:()=>null}},id)} as unknown as ElectronApplication;
    expect(()=>explainDiagnosticPort(desktop,{} as Page,NaN)).toThrow('窗口ID无效');expect(context).not.toHaveBeenCalled();
    await expect(explainDiagnosticPort(desktop,{} as Page,44).native()).rejects.toThrow('原窗口已不存在');
  });
  it('目标只投影按钮几何和固定样式；rAF单个待交付，不读取SQL或输入原值',()=>{
    const frames=new Map<number,FrameRequestCallback>(),request=vi.fn((callback:FrameRequestCallback)=>{frames.set(frames.size+1,callback);return frames.size;}),cancel=vi.fn();
    const button={textContent:'计划结果表格',disabled:false,getBoundingClientRect:()=>({x:100,y:40,width:100,height:26})};Object.defineProperty(button,'value',{get(){throw Error('不许读取原值');}});
    const hit=vi.fn(()=>({tagName:'SPAN'}));vi.stubGlobal('window',{});vi.stubGlobal('innerWidth',1024);vi.stubGlobal('innerHeight',648);vi.stubGlobal('requestAnimationFrame',request);vi.stubGlobal('cancelAnimationFrame',cancel);
    vi.stubGlobal('getComputedStyle',()=>({display:'inline-flex',visibility:'visible',pointerEvents:'auto',opacity:'1'}));vi.stubGlobal('document',{visibilityState:'visible',hasFocus:()=>false,querySelector:()=>null,querySelectorAll:(selector:string)=>{expect(selector).toBe('.explain-toolbar button');return [button];},elementFromPoint:hit});
    const first=sampleSnippetsRenderer('explain');expect(first.target).toEqual({count:1,disabled:false,rect:{x:100,y:40,width:100,height:26},display:'inline-flex',visibility:'visible',pointerEvents:'auto',opacity:'1',hitTag:'SPAN'});expect(hit).toHaveBeenCalledWith(150,53);expect(first.edit.count).toBe(0);
    sampleSnippetsRenderer('explain');expect(request).toHaveBeenCalledTimes(1);frames.get(1)!(42);const next=sampleSnippetsRenderer('explain');expect(next.raf).toMatchObject({requested:1,delivered:1,pending:false,lastTimestamp:42});expect(request).toHaveBeenCalledTimes(2);disposeSnippetsRenderer();expect(cancel).toHaveBeenCalledExactlyOnceWith(2);expect((window as any).__dbarkSnippetDiagnosticRaf).toBeUndefined();
  });
});

describe('片段专项诊断隐私门', () => {
  it('默认关闭，文件和完整用例标题同时精确匹配，未知门值不启用', () => {
    expect(snippetsDiagnosticPolicy({ ...input(), env: {} }).enabled).toBe(false);
    expect(snippetsDiagnosticPolicy({ ...input(), env: { DBARK_SNIPPETS_NATIVE_DIAGNOSTICS: 'true' } }).enabled).toBe(false);
    expect(snippetsDiagnosticPolicy({ ...input(), file: 'D:/clone/tests/e2e/live-database.spec.ts' }).enabled).toBe(false);
    expect(snippetsDiagnosticPolicy({ ...input(), title: '另一个片段测试' }).enabled).toBe(false);
    expect(snippetsDiagnosticPolicy(input()).enabled).toBe(true);
  });
  it.each(['off' as const, { mode: 'off' as const, screenshots: true, snapshots: true }])('实际 trace=%j 时不采集，不能用项目默认配置覆盖它', trace => {
    expect(snippetsDiagnosticPolicy(input(trace)).enabled).toBe(false);
  });
  it.each([
    ['on', 0, true], ['retain-on-failure', 0, true], ['on-first-retry', 0, false], ['on-first-retry', 1, true], ['on-first-retry', 2, false], ['retry-with-trace', 1, true], ['on-all-retries', 0, false], ['on-all-retries', 2, true], ['retain-on-first-failure', 0, true], ['retain-on-first-failure', 1, false], ['retain-on-failure-and-retries', 0, true], ['retain-on-failure-and-retries', 2, true]
  ] as const)('实际 trace=%s，retry=%i 的开门结果为%s', (trace, retry, enabled) => {
    expect(snippetsDiagnosticPolicy(input(trace, retry)).enabled).toBe(enabled);
  });
  it.each(['DBARK_INTEGRATION_ENABLED', 'DBARK_TEST_HOST', 'DBARK_TEST_PORT', 'DBARK_TEST_PASSWORD', 'DBARK_C02_PRIVATE_KEY', 'DBARK_SSH_PASSWORD', 'DBARK_MTLS_CERT'])('拒绝实库配置%s，异常不包含配置原值', key => {
    const env = { DBARK_SNIPPETS_NATIVE_DIAGNOSTICS: '1', [key]: key === 'DBARK_INTEGRATION_ENABLED' ? '1' : '不应出现在摘要的私密原文' };
    expect(() => snippetsDiagnosticPolicy({ ...input(), env })).toThrow('拒绝实库或私网测试环境');
    try { snippetsDiagnosticPolicy({ ...input(), env }); } catch (error) { expect(String(error)).not.toContain('不应出现在摘要的私密原文'); }
  });
  it('尊重截图和 DOM 选项关闭，并与 runner 的失败保留语义一致', () => {
    const policy = snippetsDiagnosticPolicy(input({ mode: 'on', screenshots: false, snapshots: { dom: false, aria: false, screen: false } }));
    expect(policy).toMatchObject({ screenshots: false, snapshots: { dom: false, aria: false, screen: false } });
    expect(retainSnippetsDiagnostics(snippetsDiagnosticPolicy(input()), false)).toBe(false);
    expect(retainSnippetsDiagnostics(snippetsDiagnosticPolicy(input()), true)).toBe(true);
    expect(retainSnippetsDiagnostics(snippetsDiagnosticPolicy(input('retain-on-failure-and-retries', 0)), false)).toBe(false);
    expect(retainSnippetsDiagnostics(snippetsDiagnosticPolicy(input('retain-on-failure-and-retries', 1)), false)).toBe(true);
  });
  it('私网拒绝只查看配置键，连凭据值的 getter 都不访问', () => {
    const env = { DBARK_SNIPPETS_NATIVE_DIAGNOSTICS: '1' };
    Object.defineProperty(env, 'DBARK_TEST_PASSWORD', { enumerable: true, get() { throw Error('不允许读取凭据值'); } });
    expect(() => snippetsDiagnosticPolicy({ ...input(), env })).toThrow('拒绝实库或私网测试环境');
  });
});

describe('片段原生诊断分段和收尾', () => {
  it('关闭时所有采集和输出端口调用次数为零', async () => {
    const { port, output, diagnostic } = fixture('off');
    await diagnostic.start(port, 'initial'); diagnostic.mark('before-copy-edit'); await diagnostic.stop(); await diagnostic.finish(true);
    for (const operation of [...Object.values(port), ...Object.values(output)]) expect(operation).not.toHaveBeenCalled();
  });
  it('重启前后各只停止自己的 trace 一次，后段失败保留两段，重复终结不重复输出', async () => {
    const { port, output, diagnostic } = fixture(), restarted = fixture().port;
    await diagnostic.start(port, 'initial'); diagnostic.mark('before-copy'); diagnostic.mark('before-copy-save'); diagnostic.mark('before-copy-edit'); diagnostic.mark('after-copy-edit'); diagnostic.mark('before-quit'); await diagnostic.stop();
    expect(port.stopTrace).toHaveBeenCalledExactlyOnceWith('段1.zip');
    await diagnostic.start(restarted, 'restart'); await diagnostic.finish(true); await diagnostic.finish(true); await diagnostic.stop();
    expect(restarted.stopTrace).toHaveBeenCalledExactlyOnceWith('段2.zip');
    expect(output.trace.mock.calls).toEqual([['段1.zip'], ['段2.zip']]); expect(output.summary).toHaveBeenCalledTimes(1);
    const summary = output.summary.mock.calls[0][0] as { segments: unknown[]; markers: { phase: string }[]; samples: unknown[] };
    expect(summary.segments).toEqual([{ id: 1, name: 'initial', trace: 'saved' }, { id: 2, name: 'restart', trace: 'saved' }]);
    expect(summary.markers.map(value => value.phase)).toContain('test-failed'); expect(summary.samples.length).toBeGreaterThan(0);
    expect(port.startTrace).toHaveBeenCalledExactlyOnceWith({ screenshots: true, snapshots: true, sources: false });
  });
  it('成功按 retain-on-failure 删除两段临时 trace，不生成附件', async () => {
    const { port, output, diagnostic } = fixture();
    await diagnostic.start(port, 'initial'); await diagnostic.stop(); await diagnostic.start(fixture().port, 'restart'); await diagnostic.finish(false);
    expect(output.remove.mock.calls).toEqual([['段1.zip'], ['段2.zip']]); expect(output.trace).not.toHaveBeenCalled(); expect(output.summary).not.toHaveBeenCalled();
  });
  it('实际 DOM 和截图关闭会传给真实 trace 端口，源码始终关闭', async () => {
    const { port, diagnostic } = fixture({ mode: 'on', snapshots: false, screenshots: false, sources: true });
    await diagnostic.start(port, 'initial'); await diagnostic.finish(false);
    expect(port.startTrace).toHaveBeenCalledExactlyOnceWith({ screenshots: false, snapshots: false, sources: false });
  });
  it('trace 启动被其它记录器拒绝时，不停止别人的 trace，继续保留状态和固定错误码', async () => {
    const { port, output, diagnostic } = fixture(); port.startTrace.mockRejectedValue(new Error('敏感异常原文'));
    await diagnostic.start(port, 'initial'); await diagnostic.finish(true);
    expect(port.stopTrace).not.toHaveBeenCalled();
    const summary = JSON.stringify(output.summary.mock.calls[0][0]); expect(summary).toContain('trace-start-unavailable'); expect(summary).not.toContain('敏感异常原文');
  });
  it('trace 启动超预算后才成功，仍收尾自己启动的段，成功测试不遗留迟到包', async () => {
    vi.useFakeTimers(); const { port, output, diagnostic } = fixture(); let release!: () => void;
    port.startTrace.mockImplementation(() => new Promise<void>(resolve => { release = resolve; }));
    const starting = diagnostic.start(port, 'initial'); await vi.advanceTimersByTimeAsync(snippetsDiagnosticLimits.traceMs); await starting;
    await diagnostic.finish(false); expect(port.stopTrace).not.toHaveBeenCalled();
    release(); await vi.advanceTimersByTimeAsync(0);
    expect(port.stopTrace).toHaveBeenCalledExactlyOnceWith('段1.zip'); expect(output.remove).toHaveBeenLastCalledWith('段1.zip'); expect(output.trace).not.toHaveBeenCalled();
    const nativeCalls = port.native.mock.calls.length; await vi.advanceTimersByTimeAsync(5000); expect(port.native).toHaveBeenCalledTimes(nativeCalls);
  });
  it('trace 停止超预算后才落盘，也按成功删除策略收尾，不重复停止', async () => {
    vi.useFakeTimers(); const { port, output, diagnostic } = fixture(); let release!: () => void;
    port.stopTrace.mockImplementation(() => new Promise<void>(resolve => { release = resolve; }));
    await diagnostic.start(port, 'initial'); const finishing = diagnostic.finish(false);
    await vi.advanceTimersByTimeAsync(snippetsDiagnosticLimits.traceMs); await finishing;
    release(); await vi.advanceTimersByTimeAsync(0);
    expect(port.stopTrace).toHaveBeenCalledTimes(1); expect(output.remove).toHaveBeenLastCalledWith('段1.zip'); expect(output.trace).not.toHaveBeenCalled();
  });
  it('页面采样挂起时不堆积请求，原生通道继续，失败收尾受预算限制', async () => {
    vi.useFakeTimers(); const { port, output, diagnostic } = fixture(); port.renderer.mockImplementation(() => new Promise(() => {}));
    await diagnostic.start(port, 'initial'); await vi.advanceTimersByTimeAsync(4000);
    expect(port.renderer).toHaveBeenCalledTimes(1); expect(port.native.mock.calls.length).toBeGreaterThan(5);
    const finishing = diagnostic.finish(true); await vi.advanceTimersByTimeAsync(snippetsDiagnosticLimits.drainMs); await finishing;
    const summary = JSON.stringify(output.summary.mock.calls[0][0]); expect(summary).toContain('sample-drain-budget'); expect(summary).toContain('pending');
    expect(port.stopTrace).toHaveBeenCalledTimes(1);
    const count = port.native.mock.calls.length; await vi.advanceTimersByTimeAsync(5000); expect(port.native).toHaveBeenCalledTimes(count);
  });
  it('采样、标记、错误均有硬预算，不因长时间运行持续扩张', async () => {
    vi.useFakeTimers(); const { port, output, diagnostic } = fixture(); await diagnostic.start(port, 'initial');
    for (let index = 0; index < 200; index++) diagnostic.mark('before-copy-edit');
    await vi.advanceTimersByTimeAsync(120000); await diagnostic.finish(true);
    const summary = output.summary.mock.calls[0][0] as { samples: unknown[]; markers: unknown[]; errors: unknown[] };
    expect(summary.samples).toHaveLength(snippetsDiagnosticLimits.samples); expect(summary.markers).toHaveLength(snippetsDiagnosticLimits.markers); expect(summary.errors.length).toBeLessThanOrEqual(snippetsDiagnosticLimits.errors);
  });
  it('停止 trace 的异常不会改写原动作的失败，异常内容不落盘', async () => {
    const { port, output, diagnostic } = fixture(); port.stopTrace.mockRejectedValue(new Error('密钥路径与文件原文'));
    const actionFailure = new Error('原30秒点击失败'); let observed: unknown;
    await diagnostic.start(port, 'initial');
    try { throw actionFailure; } catch (error) { observed = error; } finally { await diagnostic.finish(true); }
    expect(observed).toBe(actionFailure); expect(output.trace).not.toHaveBeenCalled();
    const summary = JSON.stringify(output.summary.mock.calls[0][0]); expect(summary).toContain('trace-stop-unavailable'); expect(summary).not.toContain('密钥路径与文件原文');
  });
});

describe('只读字段和真实 context 接线', () => {
  it('页面只保留按钮几何与状态，rAF 不等待、不循环、不读取输入或正文', () => {
    const rectangle = { x: 3, y: 8, width: 80, height: 24, 不应保存: '文件正文' };
    const button = { textContent: '编辑片段', disabled: false, getBoundingClientRect: () => rectangle, get value() { throw Error('禁止读输入值'); } };
    const modal = { querySelectorAll: vi.fn(() => [button]), getBoundingClientRect: () => rectangle, get innerHTML() { throw Error('禁止读DOM原文'); } };
    const querySelector = vi.fn(() => modal); let callback!: FrameRequestCallback;
    const request = vi.fn((value: FrameRequestCallback) => { callback = value; return 7; }), cancel = vi.fn();
    vi.stubGlobal('window', {}); vi.stubGlobal('document', { querySelector, visibilityState: 'hidden', hasFocus: () => false }); vi.stubGlobal('innerWidth', 900); vi.stubGlobal('innerHeight', 700); vi.stubGlobal('requestAnimationFrame', request); vi.stubGlobal('cancelAnimationFrame', cancel);
    const first = sampleSnippetsRenderer(); expect(first).toMatchObject({ visibility: 'hidden', focused: false, edit: { count: 1, disabled: false, rect: { x: 3, y: 8, width: 80, height: 24 } } });
    expect(first.raf).toEqual({ requested: 0, delivered: 0, pending: false, lastTimestamp: null });
    expect(sampleSnippetsRenderer().raf).toEqual({ requested: 1, delivered: 0, pending: true, lastTimestamp: null }); expect(request).toHaveBeenCalledTimes(1);
    callback(123); expect(request).toHaveBeenCalledTimes(1);
    expect(sampleSnippetsRenderer().raf).toEqual({ requested: 1, delivered: 1, pending: false, lastTimestamp: 123 });
    expect(JSON.stringify(first)).not.toContain('文件正文');
    disposeSnippetsRenderer(); expect(cancel).toHaveBeenCalledWith(7); expect(window).not.toHaveProperty('__dbarkSnippetDiagnosticRaf');
    expect(querySelector).toHaveBeenCalledWith('[role="dialog"][aria-label="SQL 片段库"]');
  });
  it('直接向 desktop.context().tracing 接线，native 仅调用只读窗口 getter', async () => {
    const start = vi.fn(async () => {}), stop = vi.fn(async () => {}), context = vi.fn(() => ({ tracing: { start, stop, _isTracing: false } }));
    const window = { id: 1, isDestroyed: () => false, isVisible: () => true, isFocused: () => false, isMinimized: () => false, isMaximized: () => false, isFullScreen: () => false, getBounds: () => native[0].bounds, getContentBounds: () => native[0].contentBounds, show: () => { throw Error('禁止显示窗口'); }, focus: () => { throw Error('禁止聚焦窗口'); } };
    const desktop = { context, evaluate: async (callback: (value: unknown) => unknown) => callback({ BrowserWindow: { getAllWindows: () => [window] } }) } as unknown as ElectronApplication;
    const page = { evaluate: vi.fn(async () => renderer) } as unknown as Page;
    const port = snippetsDiagnosticPort(desktop, page); await port.startTrace({ screenshots: true, snapshots: true, sources: false }); await port.stopTrace('固定段.zip');
    expect(context).toHaveBeenCalledOnce(); expect(start).toHaveBeenCalledExactlyOnceWith({ screenshots: true, snapshots: true, sources: false }); expect(stop).toHaveBeenCalledExactlyOnceWith({ path: '固定段.zip' }); expect(await port.native()).toEqual(native);
  });
  it.each([true, undefined])('已有记录或状态未知（%s）时，不调用 start/stop 改变其它记录器', async active => {
    const start = vi.fn(), stop = vi.fn();
    const desktop = { context: () => ({ tracing: { start, stop, _isTracing: active } }) } as unknown as ElectronApplication;
    const port = snippetsDiagnosticPort(desktop, {} as Page);
    await expect(port.startTrace({ screenshots: true, snapshots: true, sources: false })).rejects.toThrow('无法独占');
    expect(start).not.toHaveBeenCalled(); expect(stop).not.toHaveBeenCalled();
  });
});
