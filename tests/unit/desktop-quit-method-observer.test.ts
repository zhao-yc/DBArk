import { describe, expect, it, vi } from 'vitest';
import type { ElectronApplication } from '@playwright/test';
import { observeDesktopQuitMethods, type DesktopQuitTrace } from '../e2e/desktop-quit-diagnostics';

/** 只有原SDK方法为内存端口；不启动Electron，也不读写任何真实文件。 */
function fixture() {
  let resolve!: (value?: unknown) => void, reject!: (error: unknown) => void;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  const calls: Array<{ method: string; owner: unknown; args: unknown[] }> = [];
  const prototype = Object.fromEntries(['evaluate', 'waitForEvent', 'close'].map(method => [method, function (this: unknown, ...args: unknown[]) { calls.push({ method, owner: this, args }); return promise; }]));
  const app = Object.create(prototype) as ElectronApplication, record = vi.fn();
  let closed = false;
  const trace: DesktopQuitTrace = { record, arm: async () => {}, current: () => true };
  const restore = observeDesktopQuitMethods(app, trace, () => closed);
  return { app, record, promise, resolve, reject, calls, restore, prototype, setClosed(value: boolean) { closed = value; } };
}

describe('原Electron退出方法的只读旁观', () => {
  it('保持原Promise、原this、参数及12秒门，完成状态在真实兑现时读取', async () => {
    const f = fixture(), options = { timeout: 12000 };
    const result = f.app.waitForEvent('close', options); expect(result).toBe(f.promise);
    expect(f.calls).toEqual([{method:'waitForEvent',owner:f.app,args:['close',options]}]);
    f.setClosed(true); f.resolve(); await result;
    expect(f.record.mock.calls).toEqual([['close-wait-started',{closed:false}],['close-wait-resolved',{closed:true}]]);
    f.restore(); expect(Object.hasOwn(f.app,'waitForEvent')).toBe(false);
  });
  it('请求与公开close均调用原方法，不新增退出或等待', async () => {
    const f=fixture(), callback=()=>{};
    expect(f.app.evaluate(callback,'window')).toBe(f.promise); expect(f.app.close()).toBe(f.promise);
    expect(f.calls.map(call=>[call.method,call.args])).toEqual([['evaluate',[callback,'window']],['close',[]]]);
    f.resolve(); await f.promise;
    expect(f.record.mock.calls.map(call=>call[0])).toEqual(['quit-requested','desktop-close-started','quit-request-returned','desktop-close-resolved']);
    f.restore();
  });
  it('原拒绝对象原样返回，不把错误正文送进诊断', async () => {
    const f=fixture(), error=Error('不得进入诊断的SQL和路径正文'), result=f.app.close();
    const failure=expect(result).rejects.toBe(error); f.reject(error); await failure;
    expect(f.record.mock.calls.map(call=>call[0])).toEqual(['desktop-close-started','desktop-close-rejected']);
    expect(JSON.stringify(f.record.mock.calls)).not.toContain(error.message); f.restore();
  });
  it('其他evaluate与其他事件保持原行为，不读取其参数内容', async () => {
    const f=fixture(), body={get password(){throw Error('不能读参数');}};
    expect(f.app.evaluate(()=>{},body)).toBe(f.promise); expect(f.app.waitForEvent('window')).toBe(f.promise);
    expect(f.record).not.toHaveBeenCalled(); f.resolve(); await f.promise; f.restore();
  });
  it('同步异常仍是原对象，采样失败不变成业务失败', () => {
    const error=Error('原同步错误'), record=vi.fn(()=>{throw Error('诊断不可用');});
    const original=()=>{throw error;}; const app={evaluate:original,waitForEvent:original,close:original} as unknown as ElectronApplication;
    const restore=observeDesktopQuitMethods(app,{record,arm:async()=>{},current:()=>true},()=>false);
    expect(()=>app.close()).toThrow(error); restore(); expect(app.close).toBe(original);
  });
  it('保留调用者的this，不把其他实例事件记作当前owner', async () => {
    const f=fixture(), other={};
    expect(Reflect.apply(f.app.close,other,[])).toBe(f.promise); expect(f.calls[0].owner).toBe(other);
    expect(f.record).not.toHaveBeenCalled(); f.resolve(); await f.promise; f.restore();
  });
  it('恢复原有属性描述符且可幂等，不覆盖后来安装的其他旁观器', async () => {
    const f=fixture(), foreign=async()=>{}; f.app.close=foreign;
    f.restore(); expect(f.app.close).toBe(foreign); expect(f.record).toHaveBeenCalledWith('observer-unavailable',{ok:false});
    expect(Object.hasOwn(f.app,'evaluate')).toBe(false); f.restore(); expect(f.app.close).toBe(foreign);
    f.resolve(); await f.promise;
  });
});
