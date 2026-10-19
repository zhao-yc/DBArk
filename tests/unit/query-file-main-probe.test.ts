import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { detachMainProbe, installMainProbe, MainProbeLog, type MainProbeChoice } from '../helpers/queryFileMainProbe';
import { EditorIndentNativeRun } from '../e2e/editor-indentation-native-owner';

const choice: MainProbeChoice = { nonce: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', deadline: 2000, window: 7, contents: 11 };
const prefix = 'DBARK_FILE_MAIN:' + choice.nonce + ':';
const frame = (stage: number, seq: number, fields = {}) => ({ stage, seq, window: 7, contents: 11, ...fields });
const summary = frame(1, 1, { menuExists: true, saveCount: 1 });
const emptySummary = frame(1, 1, { menuExists: true, saveCount: 0 });
const wire = (value: unknown) => Buffer.from(prefix + JSON.stringify(value) + '\n');
const input = () => ({ type: 'keyDown', key: 's', code: 'KeyS', control: true, meta: false, shift: false, alt: false, isAutoRepeat: false, isComposing: false, location: 0, modifiers: ['control'] });

/** 真正序列化Main回调只在独立VM执行；模拟EventEmitter绝不启动Electron或Playwright。 */
function fixture() {
  let now = 1000, expiry: (() => void) | undefined, readsAllowed = true;
  const records: string[] = [], dispatch = vi.fn(() => { throw Error('观察器不得派发'); });
  const contents = Object.assign(new EventEmitter(), { id: 11, isDestroyed: () => false, send: dispatch, sendInputEvent: dispatch });
  const window = Object.assign(new EventEmitter(), { id: 7, webContents: contents, isDestroyed: () => false, focus: dispatch });
  for (const [object, key] of [[contents, 'id'], [window, 'id'], [window, 'webContents']] as const) {
    const value = object[key as keyof typeof object]; Object.defineProperty(object, key, { get() { if (!readsAllowed) throw Error('事件内禁止SDK getter'); return value; } });
  }
  contents.isDestroyed = window.isDestroyed = () => { if (!readsAllowed) throw Error('事件内禁止destroyed查询'); return false; };
  const save = { label: '保存查询', enabled: false, visible: true, accelerator: 'CmdOrCtrl+S', click: dispatch };
  const ancestor = { label: '文件', enabled: true, visible: false, accelerator: undefined, submenu: { items: [save] } };
  const menu: { items: any[] } = { items: [ancestor] }, Menu = { getApplicationMenu: vi.fn(() => menu as any) };
  const BrowserWindow = { fromId: vi.fn((id: number) => id === 7 ? window : null) };
  const context = { Date: { now: () => now }, process: { stdout: { write: vi.fn((value: string) => { records.push(value); return true; }) } }, setTimeout: vi.fn((callback: () => void) => { expiry = callback; return 1; }), clearTimeout: vi.fn() };
  const application = { evaluate: async (callback: Function, value: object) => runInNewContext('(' + callback.toString() + ')', context)({ BrowserWindow, Menu }, value) } as any;
  const event = { preventDefault: dispatch };
  return { application, window, contents, menu, ancestor, save, records, dispatch, context, BrowserWindow, Menu,
    emit(value: unknown = input()) { contents.emit('before-input-event', event, value); },
    prohibitReads() { readsAllowed = false; }, now(value: number) { now = value; }, expire() { now = 2000; expiry!(); },
    frames() { return records.map(text => JSON.parse(text.slice(prefix.length))); } };
}

describe('Main原菜单与输入回调的被动准备', () => {
  it('真实序列化回调只读原菜单及祖先，各自enabled/visible/accelerator编码准确', async () => {
    const f = fixture(); expect(await installMainProbe(f.application, choice)).toEqual({ nonce: choice.nonce, installed: true, window: 7, contents: 11 });
    expect(f.frames()).toEqual([summary, frame(2, 2, { depth: 0, target: false, enabled: true, visible: false, accelerator: 0 }), frame(2, 3, { depth: 1, target: true, enabled: false, visible: true, accelerator: 1 }), frame(0, 4)]);
    const log = new MainProbeLog(choice, () => {}); f.records.forEach(text => log.ingest(Buffer.from(text))); expect(log.frames).toEqual(f.frames());
    expect(f.BrowserWindow.fromId).toHaveBeenCalledExactlyOnceWith(7); expect(f.Menu.getApplicationMenu).toHaveBeenCalledOnce(); expect(f.dispatch).not.toHaveBeenCalled();
    expect(f.save.enabled).toBe(false); expect(f.ancestor.visible).toBe(false); expect(f.save.click).toBe(f.dispatch);
  });
  it('输入事件和成功解绑均不补读window/SDK；零拦截零保存，字段全部为数字和布尔', async () => {
    const f = fixture(); await installMainProbe(f.application, choice); f.prohibitReads(); f.emit(); f.emit({ ...input(), type: 'keyUp', key: 'S' });
    expect(await detachMainProbe(f.application, choice)).toEqual({ nonce: choice.nonce, detached: true });
    expect(f.frames().slice(4)).toEqual([frame(3, 5, { type: 1, keyS: true, codeS: true, control: true, meta: false, shift: false, alt: false, repeat: false, composing: false, location: 0 }), frame(3, 6, { type: 0, keyS: true, codeS: true, control: true, meta: false, shift: false, alt: false, repeat: false, composing: false, location: 0 }), frame(4, 7)]);
    for (const value of f.frames()) expect(Object.values(value).every(item => typeof item === 'number' || typeof item === 'boolean')).toBe(true);
    expect(f.contents.listenerCount('before-input-event')).toBe(0); expect(f.contents.listenerCount('destroyed')).toBe(0); expect(f.window.listenerCount('closed')).toBe(0); expect(f.dispatch).not.toHaveBeenCalled();
  });
  it('普通按键、任意正文、修饰列表和未知错误正文不进入帧；输入访问器不执行', async () => {
    const f = fixture(); await installMainProbe(f.application, choice); f.emit({ ...input(), key: 'SQL口令', code: 'KeyX', sql: '认证秘密' }); f.emit({ ...input(), control: false });
    const getter = vi.fn(() => { throw Error('不可输出异常正文'); }); f.emit(Object.defineProperty(input(), 'key', { get: getter }));
    expect(getter).not.toHaveBeenCalled(); expect(f.frames()).toHaveLength(5); expect(f.frames().at(-1).stage).toBe(5); expect(f.records.join('')).not.toMatch(/SQL|口令|认证|秘密|异常正文|modifiers|KeyS/); expect(f.dispatch).not.toHaveBeenCalled();
  });
  it.each(['截止', 'clock-backwards', 'closed', 'destroyed'])('%s只用本地墓碑解绑，迟到事件无输出无SDK查询', async mode => {
    const f = fixture(); await installMainProbe(f.application, choice); f.prohibitReads();
    if (mode === '截止') f.expire(); if (mode === 'clock-backwards') { f.now(999); f.emit(); } if (mode === 'closed') f.window.emit('closed'); if (mode === 'destroyed') f.contents.emit('destroyed');
    const count = f.records.length; f.emit(); expect(f.records).toHaveLength(count); expect(f.contents.listenerCount('before-input-event')).toBe(0); expect(f.dispatch).not.toHaveBeenCalled();
    await expect(detachMainProbe(f.application, choice)).rejects.toThrow();
  });
  it('未投递timer而事件到达deadline也只解绑，不记录迟到输入', async () => { const f = fixture(); await installMainProbe(f.application, choice); f.prohibitReads(); f.now(2000); f.emit(); expect(f.frames()).toHaveLength(4); expect(f.contents.listenerCount('before-input-event')).toBe(0); });
  it('Main第33条只输出一份数字fault，异常不打断后续产品listener', async () => {
    const f = fixture(); await installMainProbe(f.application, choice); const product = vi.fn(); f.contents.on('before-input-event', product); f.prohibitReads();
    for (let i = 0; i < 40; i++) expect(() => f.emit()).not.toThrow();
    expect(f.frames()).toHaveLength(33); expect(f.frames().at(-1)).toEqual(frame(5, 33)); expect(product).toHaveBeenCalledTimes(40); expect(f.dispatch).not.toHaveBeenCalled();
  });
  it('stdout异常不泄漏正文也不阻断产品，观察器自行解绑', async () => {
    const f = fixture(); await installMainProbe(f.application, choice); const product = vi.fn(); f.contents.on('before-input-event', product); f.context.process.stdout.write.mockImplementation(() => { throw Error('SQL不可输出'); });
    expect(() => f.emit()).not.toThrow(); expect(product).toHaveBeenCalledOnce(); expect(f.contents.listenerCount('before-input-event')).toBe(1); expect(f.records.join('')).not.toContain('SQL');
  });
  it('安装SDK与解绑传输异常只返回固定诊断，不暴露任意错误正文', async () => {
    const f = fixture(); f.Menu.getApplicationMenu.mockImplementation(() => { throw Error('SQL与认证正文不可输出'); }); await expect(installMainProbe(f.application, choice)).rejects.toThrow(/^Main观察安装失败，保留现场$/); expect(f.records).toEqual([]); expect(f.dispatch).not.toHaveBeenCalled();
    const broken = { evaluate: () => Promise.reject(Error('不可输出的传输正文')) } as any; await expect(detachMainProbe(broken, choice)).rejects.toThrow(/^Main观察解绑失败，保留现场$/);
  });
  it.each(['窗口不同', 'contents不同', '过期', '重复安装', '错误nonce解绑'])('%s拒绝，不能绑定或解绑其它owner', async mode => {
    const f = fixture();
    if (mode === '重复安装' || mode === '错误nonce解绑') { await installMainProbe(f.application, choice); if (mode === '重复安装') await expect(installMainProbe(f.application, choice)).rejects.toThrow(); else await expect(detachMainProbe(f.application, { ...choice, nonce: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' })).rejects.toThrow(); expect(f.contents.listenerCount('before-input-event')).toBe(1); await detachMainProbe(f.application, choice); }
    else { await expect(installMainProbe(f.application, { ...choice, ...(mode === '窗口不同' ? { window: 8 } : mode === 'contents不同' ? { contents: 12 } : { deadline: 1000 }) })).rejects.toThrow(); expect(f.contents.listenerCount('before-input-event')).toBe(0); }
    expect(f.dispatch).not.toHaveBeenCalled();
  });
  it.each(['无菜单', '无保存项', '重复保存项', '未知accelerator', '菜单溢出', '菜单读取跨deadline'])('%s如实记录或拒绝，不修菜单不补派发', async mode => {
    const f = fixture(); if (mode === '无菜单') f.Menu.getApplicationMenu.mockReturnValue(null); if (mode === '无保存项') f.menu.items = []; if (mode === '重复保存项') f.menu.items.push(f.save); if (mode === '未知accelerator') f.save.accelerator = '不可记录文字'; if (mode === '菜单溢出') f.menu.items = Array(129).fill(f.save); if (mode === '菜单读取跨deadline') Object.defineProperty(f.save, 'label', { get() { f.now(2000); return '保存查询'; } });
    if (['菜单溢出', '菜单读取跨deadline'].includes(mode)) { await expect(installMainProbe(f.application, choice)).rejects.toThrow(); expect(f.contents.listenerCount('before-input-event')).toBe(0); expect(f.context.setTimeout).not.toHaveBeenCalled(); }
    else { await installMainProbe(f.application, choice); expect(f.frames()[0]).toMatchObject({ menuExists: mode !== '无菜单', saveCount: mode === '重复保存项' ? 2 : ['无菜单', '无保存项'].includes(mode) ? 0 : 1 }); if (mode === '未知accelerator') expect(f.frames()[2].accelerator).toBe(8); expect(f.records.join('')).not.toContain('不可记录文字'); }
    expect(f.dispatch).not.toHaveBeenCalled();
  });
});

describe('原stdout的有界安全帧解析', () => {
  it.each(['缺保存项', '祖先跳层', '目标后仍有祖先', '无菜单却有保存项'])('%s快照不完整，不能以ready补成完整观察', mode => {
    const log = new MainProbeLog(choice, () => {});
    if (mode === '无菜单却有保存项') { expect(() => log.ingest(wire({ ...summary, menuExists: false }))).toThrow(); return; }
    log.ingest(wire(summary));
    if (mode === '目标后仍有祖先') log.ingest(wire(frame(2, 2, { depth: 0, target: true, enabled: true, visible: true, accelerator: 1 })));
    const bad = mode === '缺保存项' ? frame(0, 2) : frame(2, mode === '目标后仍有祖先' ? 3 : 2, { depth: mode === '目标后仍有祖先' ? 1 : 2, target: false, enabled: true, visible: true, accelerator: 0 });
    expect(() => log.ingest(wire(bad))).toThrow();
  });
  it('任意分块/CRLF与大量无关stdout不入库，仅接受原独立nonce', () => {
    const current = vi.fn(), log = new MainProbeLog(choice, current); log.ingest(Buffer.from('SQL表单口令\n' + 'x'.repeat(100000) + '\nDBARK_FILE_MAIN:other:{"sql":"不保存"}\n'));
    const bytes = Buffer.concat([wire(emptySummary), Buffer.from(prefix + JSON.stringify(frame(0, 2)) + '\r\n')]); for (const byte of bytes) log.ingest(Buffer.from([byte]));
    expect(log.frames).toEqual([emptySummary, frame(0, 2)]); expect(JSON.stringify(log.frames)).not.toMatch(/SQL|表单|口令|不保存/); expect(current).toHaveBeenCalledTimes(4);
  });
  it.each(['SQL字段', '字符串值', '其它window', '其它contents', '顺序跳跃', '非法布尔', 'Main故障', '乱码', '超大帧', '重复ready', '非法location', '提前input'])('%s永久停链且只保留此前已验证帧', mode => {
    const log = new MainProbeLog(choice, () => {}); log.ingest(wire(emptySummary)); let value: any = frame(0, 2);
    if (mode === 'SQL字段') value.sql = '不可保留'; if (mode === '字符串值') value.stage = '0'; if (mode === '其它window') value.window = 8; if (mode === '其它contents') value.contents = 12; if (mode === '顺序跳跃') value.seq = 9; if (mode === '非法布尔') value = frame(2, 2, { depth: 0, target: 1, enabled: true, visible: true, accelerator: 0 }); if (mode === 'Main故障') value.stage = 5;
    if (mode === '重复ready' || mode === '非法location') { log.ingest(wire(value)); value = mode === '重复ready' ? frame(0, 3) : frame(3, 3, { type: 1, keyS: true, codeS: true, control: true, meta: false, shift: false, alt: false, repeat: false, composing: false, location: 4 }); }
    if (mode === '提前input') value = frame(3, 2, { type: 1, keyS: true, codeS: true, control: true, meta: false, shift: false, alt: false, repeat: false, composing: false, location: 0 });
    const count = log.frames.length; expect(() => log.ingest(mode === '乱码' ? Buffer.from(prefix + '秘密\n') : mode === '超大帧' ? Buffer.from(prefix + 'x'.repeat(2049)) : wire(value))).toThrow('保留原现场'); log.ingest(wire(frame(0, 2))); expect(log.frames).toHaveLength(count); expect(JSON.stringify(log.frames)).not.toMatch(/不可保留|秘密/);
  });
  it('父门失效和显式stop后的迟到帧不会恢复，且无SDK补读', () => {
    let valid = true; const current = vi.fn(() => { if (!valid) throw Error('任意异常正文'); }), log = new MainProbeLog(choice, current); log.ingest(wire(emptySummary)); valid = false;
    expect(() => log.ingest(wire(frame(0, 2)))).toThrow('保留原现场'); valid = true; log.ingest(wire(frame(0, 2))); log.stop(); log.ingest(wire(frame(0, 2))); expect(log.frames).toEqual([emptySummary]);
  });
  it('原choice快照不随外部对象变成另一个owner；解绑须保持原deadline', async () => {
    const original = { ...choice }, log = new MainProbeLog(original, () => {}); original.window = 8; log.ingest(wire(emptySummary)); expect(log.choice.window).toBe(7);
    const f = fixture(); await installMainProbe(f.application, choice); await expect(detachMainProbe(f.application, { ...choice, deadline: 2100 })).rejects.toThrow(); expect(f.contents.listenerCount('before-input-event')).toBe(1); await detachMainProbe(f.application, choice);
  });
  it('父进程第33帧溢出停链；成功detached后迟到数据不污染记录', () => {
    const log = new MainProbeLog(choice, () => {}); log.ingest(wire(emptySummary)); log.ingest(wire(frame(0, 2)));
    const value = { type: 1, keyS: true, codeS: true, control: true, meta: false, shift: false, alt: false, repeat: false, composing: false, location: 0 };
    for (let seq = 3; seq <= 32; seq++) log.ingest(wire(frame(3, seq, value))); expect(() => log.ingest(wire(frame(3, 33, value)))).toThrow(); expect(log.frames).toHaveLength(32);
    const good = new MainProbeLog(choice, () => {}); good.ingest(Buffer.concat([wire(emptySummary), wire(frame(0, 2)), wire(frame(4, 3)), wire(frame(3, 4, value))])); expect(good.frames.map(item => item.stage)).toEqual([1, 0, 4]);
  });
});

describe('接入仍消费原owner护栏', () => {
  it('安装RPC迟到后原run.step停链，不进入按键或成功解绑', async () => {
    const f = fixture(); let valid = true, release!: () => void; const held = new Promise<void>(done => { release = done; });
    const forbidden = async () => { throw Error('禁止资源'); }, owner = { application: f.application, page: {}, ids: new Set([1]), closed: false, confirmed: false, ready: false, errors: [], quitReady: Promise.resolve() } as any;
    const run = new EditorIndentNativeRun({ assertCurrent() { if (!valid) throw Error('原门失效'); }, preflight: forbidden, directory: forbidden, assertDirectory: forbidden, launch: forbidden, prepare: forbidden, record: forbidden, quit: forbidden, absent: forbidden, remove: forbidden }); run.acquiredOwner(owner);
    const pending = run.step(owner, async () => { const value = await installMainProbe(f.application, choice); await held; return value; }), rejected = expect(pending).rejects.toThrow('原门失效'); valid = false; release(); await rejected;
    expect(run.retained).toBe(true); expect(f.dispatch).not.toHaveBeenCalled(); f.prohibitReads(); f.expire(); expect(f.contents.listenerCount('before-input-event')).toBe(0);
  });
  it('真实用例只接同一已确认window的stdout，新增SDK await均为原run.step；失败无Main补读', () => {
    const live = readFileSync(new URL('../e2e/query-file-shortcut-native-live.ts', import.meta.url), 'utf8');
    for (const value of ['first.sourceDiagnostics?', 'id: mainWindow.window, contents: mainWindow.contents', 'nonce: randomUUID(), deadline: choice.deadline', 'first.application.process().stdout', 'await run.step(first, () => installMainProbe(', 'await run.step(first, () => detachMainProbe(', 'mainFrames: mainLog?.frames ?? []', 'timeout: 120000, retries: 0']) expect(live).toContain(value);
    expect(live.match(/keyboard\.press\(process\.platform === 'darwin' \? 'Meta\+s' : 'Control\+s'\)/g)).toHaveLength(1);
    const failure = live.slice(live.indexOf('} catch (reason) {\n      failure = reason;')); expect(failure).not.toMatch(/\.evaluate\(|installMainProbe\(|detachMainProbe\(|\.focus\(|\.screenshot\(/);
  });
});
