import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import type { TestInfo } from '@playwright/test';

/** 通道1/2只重放SDK早期out/err，3/4持续旁观原child out/err，5为既有console。 */
export interface NativeStartupWireData { version: 1; sdk: 164; events: [number, number][]; dropped: number; failed: boolean; stopped: boolean; earlyCoverage: 0 | 1; }
export interface NativeStartupWire { readonly data: NativeStartupWireData; console(text: string): void; stop(): void; }
interface Stream { on(name: string, callback: (...values: any[]) => void): unknown; off(name: string, callback: (...values: any[]) => void): unknown; }
interface Child { pid?: number; stdout?: Stream | null; stderr?: Stream | null; }
interface Sdk { version: string; implementation: any; }
const stages = new Set([1, 2, 3, 4, 5, 6, 7, 8, 20, 21, 22, 23, 24, 30, 31, 32, 33, 99]);
export const nativeStartupWireLimits = { events: 64, lineBytes: 256, attachmentBytes: 2048, dropped: 1024 } as const;

/** 仅显式调用时读取版本元数据；只取同一个进程内SDK映射，不导入/启动Electron或创建RPC。 */
function fixedSdk(application: any): Sdk {
  const require = createRequire(import.meta.url), metadata = require.resolve('playwright-core/package.json', { paths: [dirname(require.resolve('@playwright/test'))] }), version = require(metadata).version as string;
  return { version, implementation: application._connection.toImpl(application) };
}

/** 只认固定完整数值行，不保存路径、错误正文、SQL、参数或环境，也不从日志推导任何权限。 */
export function observeNativeStartupWire(application: object, child: Child, active: () => boolean, load: (application: object) => Sdk = fixedSdk): NativeStartupWire {
  const data: NativeStartupWireData = { version: 1, sdk: 164, events: [], dropped: 0, failed: false, stopped: false, earlyCoverage: 0 };
  const removals: (() => void)[] = [];
  /** stop只移除本观察自己挂接的stream监听，不关闭流、owner、应用或SDK收集器。 */
  function stop() { if (data.stopped) return; data.stopped = true; for (const remove of removals.splice(0)) try { remove(); } catch { data.failed = true; } }
  const alive = () => { if (data.stopped) return false; try { if (active()) return true; } catch { data.failed = true; } stop(); return false; };
  const fail = () => { if (alive()) data.failed = true; };
  function record(channel: number, code: number) {
    if (!alive()) return;
    if (code === 99) data.failed = true;
    if (data.events.length < nativeStartupWireLimits.events) data.events.push([channel, code]); else data.dropped = Math.min(nativeStartupWireLimits.dropped, data.dropped + 1);
  }
  function line(channel: number, value: unknown) {
    if (!alive()) return;
    if (typeof value !== 'string' || value.length > 64) return;
    const match = /^DBARK_STARTUP_V1:([1-9][0-9]?)$/.exec(value);
    if (match && stages.has(Number(match[1]))) record(channel, Number(match[1]));
  }
  /** 缓冲区每字节有界处理；超长行仅丢弃到换行，不拼接原始大chunk或解码任意正文。 */
  function stream(port: Stream | null | undefined, channel: number) {
    if (!alive()) return;
    if (!port) { fail(); return; }
    let pending = '', discard = false;
    const read = (chunk: unknown) => {
      if (!alive()) return;
      if (!Buffer.isBuffer(chunk) && typeof chunk !== 'string') { fail(); return; }
      if (chunk.length > 4096) { pending = ''; discard = true; data.dropped = Math.min(nativeStartupWireLimits.dropped, data.dropped + 1); return; }
      for (let index = 0; index < chunk.length; index++) {
        if (data.stopped) break;
        const value = typeof chunk === 'string' ? chunk.charCodeAt(index) : chunk[index];
        if (value === 10) { if (!discard) line(channel, pending.endsWith('\r') ? pending.slice(0, -1) : pending); pending = ''; discard = false; }
        else if (!discard) { if (pending.length >= nativeStartupWireLimits.lineBytes || value < 32 && value !== 13 || value > 126) { pending = ''; discard = true; } else pending += String.fromCharCode(value); }
      }
    };
    removals.push(() => { try { port.off('data', read); } finally { try { port.off('error', fail); } finally { pending = ''; } } }); port.on('data', read); port.on('error', fail);
  }
  const observer: NativeStartupWire = { data, stop, console(text) { line(5, text); } };
  if (!alive()) return observer;
  try {
    const sdk = load(application); if (!alive()) return observer;
    const { version, implementation } = sdk;
    if (version !== '1.64.0' || implementation?._process !== child || implementation?._browserContext?._browser?.options?.name !== 'electron') throw Error('固定SDK日志归属不匹配');
    const collector = implementation._browserContext._browser.options.browserLogsCollector;
    if (typeof collector?.onMessage !== 'function' || typeof collector?.recentLogs !== 'function') throw Error('固定SDK日志端口缺失');
    for (const [name, hash] of [['onMessage', 'a19415f7f5664547bbd4a6609b447872cd5cdbb3866bd19fdeb88fc5fe4e342d'], ['recentLogs', '140a51c630d1280e8b7e2511244d080d8780bb01a068fde052bd699d08377f65']] as const) if (createHash('sha256').update(Function.prototype.toString.call(collector[name]).replaceAll('\r\n', '\n')).digest('hex') !== hash) throw Error('固定SDK日志实现漂移');
    // 1.64.0同步重放后，新增的child监听接管持续流；不重复保留SDK后续副本挤占hook标记。
    let replaying = true;
    collector.onMessage((value: unknown) => {
      if (!alive() || !replaying || typeof value !== 'string' || value.length > 128) return;
      const match = /^\[pid=([1-9][0-9]{0,15})\]\[(out|err)\] (DBARK_STARTUP_V1:[1-9][0-9]?)$/.exec(value);
      if (match && Number(match[1]) === child.pid) line(match[2] === 'out' ? 1 : 2, match[3]);
    });
    replaying = false;
    if (alive()) data.earlyCoverage = 1;
  } catch { fail(); }
  if (alive()) try { stream(child.stdout, 3); stream(child.stderr, 4); } catch { fail(); }
  return observer;
}

/** 原afterEach先封存纯内存数据；新附件独占2KiB，不挤占旧8KiB的任何字段。 */
export function stopNativeStartupWires(run: { owners: { startupWire?: NativeStartupWire }[] }): void { for (const owner of run.owners.slice(0, 2)) owner.startupWire?.stop(); }
export async function attachNativeStartupWires(info: Pick<TestInfo, 'attach'>, run: { owners: { startupWire?: NativeStartupWire }[] }): Promise<void> {
  stopNativeStartupWires(run);
  const owners = run.owners.slice(0, 2).flatMap((owner, index) => owner.startupWire ? [{ owner: index + 1, data: owner.startupWire.data }] : []);
  if (!owners.length) return;
  const body = Buffer.from(JSON.stringify({ version: 1, missingMarkerMeansNotCalled: false, owners }));
  if (body.byteLength > nativeStartupWireLimits.attachmentBytes) throw Error('启动固定标记附件超过2KiB预算');
  await info.attach('原生启动固定标记', { body, contentType: 'application/json' });
  if (owners.some(owner => owner.data.failed)) throw Error('启动固定标记收集失败，原用例结果与资源权限保持');
}
