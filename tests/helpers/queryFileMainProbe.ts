import type { ElectronApplication } from '@playwright/test';

export interface MainProbeChoice { nonce: string; deadline: number; window: number; contents: number; }
type Identity = { stage: number; seq: number; window: number; contents: number };
/** 全部值仅为数字或布尔；accelerator枚举见准备说明，绝不输出菜单文字和原输入。 */
export type MainProbeFrame = Identity & (
  { stage: 0 | 4 } |
  { stage: 1; menuExists: boolean; saveCount: number } |
  { stage: 2; depth: number; target: boolean; enabled: boolean; visible: boolean; accelerator: number } |
  { stage: 3; type: number; keyS: boolean; codeS: boolean; control: boolean; meta: boolean; shift: boolean; alt: boolean; repeat: boolean; composing: boolean; location: number }
);

/** 只匹配行首独立nonce；其它stdout逐字节丢弃，不保留SQL/表单/异常正文。 */
export class MainProbeLog {
  readonly frames: MainProbeFrame[] = [];
  readonly choice: Readonly<MainProbeChoice>;
  private readonly prefix: Buffer;
  private matched = 0; private discarded = false; private body = ''; private stopped = false; private ready = false;
  constructor(choice: MainProbeChoice, private readonly current: () => void) {
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(choice.nonce) || !Number.isSafeInteger(choice.window) || choice.window <= 0 || !Number.isSafeInteger(choice.contents) || choice.contents <= 0 || !Number.isFinite(choice.deadline)) throw Error('Main观察nonce或所属未知');
    this.choice = Object.freeze({ ...choice });
    this.prefix = Buffer.from('DBARK_FILE_MAIN:' + choice.nonce + ':');
  }
  /** 分块、跨行和无关大输出均只有固定前缀及至多2048字节正文的缓冲。 */
  ingest(chunk: Buffer): void {
    if (this.stopped) return;
    try {
      for (const byte of chunk) {
        if (this.stopped) return;
        if (byte === 10) {
          if (!this.discarded && this.matched === this.prefix.length) { this.current(); this.accept(this.body.endsWith('\r') ? this.body.slice(0, -1) : this.body); }
          this.matched = 0; this.discarded = false; this.body = ''; continue;
        }
        if (this.discarded) continue;
        if (this.matched < this.prefix.length) {
          if (byte !== this.prefix[this.matched]) { this.discarded = true; this.matched = 0; }
          else if (++this.matched === this.prefix.length) this.current();
        } else {
          if (this.body.length >= 2048 || byte !== 13 && (byte < 32 || byte > 126)) throw Error('Main观察帧溢出或编码未知');
          this.body += String.fromCharCode(byte);
        }
      }
    } catch { this.stop(); throw Error('Main观察通道失效，保留原现场'); }
  }
  /** 字段白名单和精确数字归属在入库之前检查，未知字段不进入失败附录。 */
  private accept(text: string): void {
    const value = JSON.parse(text), base = ['stage', 'seq', 'window', 'contents'];
    const fields: Record<number, string[]> = { 0: [], 1: ['menuExists', 'saveCount'], 2: ['depth', 'target', 'enabled', 'visible', 'accelerator'], 3: ['type', 'keyS', 'codeS', 'control', 'meta', 'shift', 'alt', 'repeat', 'composing', 'location'], 4: [] };
    if (!value || Array.isArray(value) || !Object.hasOwn(fields, value.stage)) throw Error('Main观察阶段未知');
    const keys = [...base, ...fields[value.stage]];
    if (Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key)) || Object.values(value).some(item => typeof item !== 'number' && typeof item !== 'boolean')) throw Error('Main观察字段未知');
    const integer = (key: string, min: number, max: number) => Number.isSafeInteger(value[key]) && value[key] >= min && value[key] <= max;
    if (!integer('stage', 0, 4) || value.window !== this.choice.window || value.contents !== this.choice.contents || value.seq !== this.frames.length + 1 || this.frames.length >= 32) throw Error('Main观察归属或顺序未知');
    const bools = value.stage === 1 ? ['menuExists'] : value.stage === 2 ? ['target', 'enabled', 'visible'] : value.stage === 3 ? ['keyS', 'codeS', 'control', 'meta', 'shift', 'alt', 'repeat', 'composing'] : [];
    if (bools.some(key => typeof value[key] !== 'boolean')) throw Error('Main观察布尔未知');
    if (value.stage === 1 && (this.frames.length !== 0 || !integer('saveCount', 0, 128)) || value.stage === 2 && (this.ready || !this.frames.length || !integer('depth', 0, 8) || !integer('accelerator', 0, 8)) || value.stage === 0 && (this.ready || !this.frames.length) || value.stage === 3 && (!this.ready || !integer('type', 0, 1) || !integer('location', 0, 3) || !(value.keyS || value.codeS) || !(value.control || value.meta)) || value.stage === 4 && !this.ready) throw Error('Main观察值或阶段顺序未知');
    const summary = this.frames[0], items = this.frames.filter(frame => frame.stage === 2);
    if (value.stage === 1 && !value.menuExists && value.saveCount !== 0 || value.stage === 2 && (summary.stage !== 1 || summary.saveCount !== 1 || value.depth !== items.length || items.some(item => item.target)) || value.stage === 0 && (summary.stage !== 1 || summary.saveCount === 1 && !items.at(-1)?.target || summary.saveCount !== 1 && items.length !== 0)) throw Error('Main原菜单快照尚未完整');
    if (value.stage === 0) this.ready = true;
    this.frames.push(Object.freeze(value)); if (value.stage === 4) this.stop();
  }
  /** 失败/迟到后只保留已验证的父内存，不再读取Main或未知owner。 */
  stop(): void { this.stopped = true; this.body = ''; this.matched = 0; this.discarded = false; }
}

/** 只在原run.step内安装到已确认window/contents；Main事件回调不查询SDK或窗口属性。 */
export async function installMainProbe(application: ElectronApplication, choice: MainProbeChoice) {
  return application.evaluate(({ BrowserWindow, Menu }, choice) => {
    type State = { nonce: string; deadline: number; window: number; contents: number; dispose(emit: boolean): void };
    const root = globalThis as typeof globalThis & { __queryFileMainProbe?: State };
    const now = Date.now();
    if (root.__queryFileMainProbe || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(choice.nonce) || !Number.isSafeInteger(choice.window) || choice.window <= 0 || !Number.isSafeInteger(choice.contents) || choice.contents <= 0 || !Number.isFinite(choice.deadline) || choice.deadline <= now || choice.deadline - now > 120000) throw Error('Main观察所属或期限未知');
    const candidate = BrowserWindow.fromId(choice.window);
    if (!candidate || candidate.isDestroyed()) throw Error('Main观察原窗口未知');
    const window = candidate;
    const contents = window.webContents;
    if (window.id !== choice.window || contents.id !== choice.contents || contents.isDestroyed()) throw Error('Main观察原contents未知');
    let disposed = false, closed = false, seq = 0, previous = now, timer: ReturnType<typeof setTimeout> | undefined;
    const state: State = { nonce: choice.nonce, deadline: choice.deadline, window: choice.window, contents: choice.contents, dispose };
    /** 安装步骤跨截止或发生本地停链后不能再登记新listener。 */
    function active() { if (disposed || closed || root.__queryFileMainProbe !== state || Date.now() >= choice.deadline) throw Error('Main观察安装期限已失效'); }
    /** 解绑仅使用安装时捕获的EventEmitter；无窗口getter、退出、清理或保存派发。 */
    function dispose(emit: boolean) {
      if (disposed) return;
      try { if (emit) send({ stage: 4 }); }
      finally {
        disposed = true; if (timer) clearTimeout(timer);
        contents.removeListener('before-input-event', input); contents.removeListener('destroyed', close); window.removeListener('closed', close);
        if (root.__queryFileMainProbe === state) delete root.__queryFileMainProbe;
      }
    }
    /** 原捕获对象的关闭事件只写本地墓碑并解除自己的订阅。 */
    function close() { closed = true; dispose(false); }
    /** 观察异常不向产品事件抛出，只输出无正文的失败帧并永久本地解绑。 */
    function fault() {
      if (disposed) return;
      try { process.stdout.write('DBARK_FILE_MAIN:' + choice.nonce + ':' + JSON.stringify({ stage: 5, seq: ++seq, window: choice.window, contents: choice.contents }) + '\n'); }
      catch { /* stdout失败不能改变产品输入分派。 */ }
      finally { try { dispose(false); } catch { /* 只保留观察器故障，不向原输入链抛出。 */ } }
    }
    /** 输出只用数字和布尔；deadline/closed墓碑之后不输出任何记录。 */
    function send(fields: Record<string, number | boolean>) {
      const instant = Date.now();
      if (disposed || closed || instant >= choice.deadline) { dispose(false); return; }
      if (!Number.isFinite(instant) || instant < previous || seq >= 32) { fault(); return; } previous = instant;
      process.stdout.write('DBARK_FILE_MAIN:' + choice.nonce + ':' + JSON.stringify({ ...fields, seq: ++seq, window: choice.window, contents: choice.contents }) + '\n');
    }
    /** 只读Electron已提供的input数据属性；普通按键、原key/code和额外字段永不输出。 */
    function input(_event: unknown, value: Electron.Input) {
      if (disposed || closed) return;
      try {
        const instant = Date.now(); if (instant >= choice.deadline) { dispose(false); return; }
        if (!Number.isFinite(instant) || instant < previous) { fault(); return; } previous = instant;
        const descriptors = Object.getOwnPropertyDescriptors(value);
        const read = (key: string) => { const field = descriptors[key]; if (!field || !Object.hasOwn(field, 'value')) throw Error('输入字段未知'); return field.value; };
        const key = read('key'), code = read('code');
        if (typeof key !== 'string' || typeof code !== 'string') throw Error('输入键未知');
        const keyS = key === 's' || key === 'S', codeS = code === 'KeyS'; if (!keyS && !codeS) return;
        const control = read('control'), meta = read('meta'); if (typeof control !== 'boolean' || typeof meta !== 'boolean') throw Error('输入修饰未知'); if (!control && !meta) return;
        const type = read('type'), location = read('location'); if (!['keyUp', 'keyDown'].includes(type) || !Number.isSafeInteger(location) || location < 0 || location > 3) throw Error('输入阶段未知');
        const fields: Record<string, number | boolean> = { stage: 3, type: type === 'keyDown' ? 1 : 0, keyS, codeS, control, meta, location };
        for (const [from, to] of [['shift', 'shift'], ['alt', 'alt'], ['isAutoRepeat', 'repeat'], ['isComposing', 'composing']]) { const item = read(from); if (typeof item !== 'boolean') throw Error('输入布尔未知'); fields[to] = item; }
        send(fields);
      } catch { fault(); }
    }
    /** 快照仅在安装RPC里读真实应用菜单；有界遍历，不调用click，不改enabled/accelerator。 */
    const menu = Menu.getApplicationMenu(), found: Electron.MenuItem[][] = []; let visited = 0;
    function visit(items: Electron.MenuItem[], ancestors: Electron.MenuItem[]) {
      if (ancestors.length > 8) throw Error('菜单层级未知');
      for (const item of items) { if (++visited > 128) throw Error('菜单数量未知'); const path = [...ancestors, item]; if (item.label === '保存查询') found.push(path); if (item.submenu) visit(item.submenu.items, path); }
    }
    root.__queryFileMainProbe = state;
    try {
      if (menu) visit(menu.items, []);
      active();
      send({ stage: 1, menuExists: menu !== null, saveCount: found.length });
      if (found.length === 1) found[0].forEach((item, depth, path) => {
        active();
        if (typeof item.enabled !== 'boolean' || typeof item.visible !== 'boolean') throw Error('菜单状态未知');
        const accelerator = item.accelerator, names = ['CmdOrCtrl+S', 'CommandOrControl+S', 'Ctrl+S', 'Control+S', 'Cmd+S', 'Command+S', 'Super+S'];
        send({ stage: 2, depth, target: depth === path.length - 1, enabled: item.enabled, visible: item.visible, accelerator: accelerator == null || accelerator === '' ? 0 : names.includes(accelerator) ? names.indexOf(accelerator) + 1 : 8 });
      });
      active();
      contents.on('before-input-event', input); contents.once('destroyed', close); window.once('closed', close);
      timer = setTimeout(() => dispose(false), choice.deadline - Date.now()); send({ stage: 0 });
      active();
      return { nonce: choice.nonce, installed: true, window: choice.window, contents: choice.contents };
    } catch { dispose(false); throw Error('Main观察安装失败，保留现场'); }
  }, choice).catch(() => { throw Error('Main观察安装失败，保留现场'); });
}

/** 仅成功且原父门仍有效时解绑；失败后只靠Main本地deadline/closed解绑。 */
export async function detachMainProbe(application: ElectronApplication, choice: MainProbeChoice) {
  return application.evaluate((_, choice) => {
    const root = globalThis as typeof globalThis & { __queryFileMainProbe?: { nonce: string; deadline: number; window: number; contents: number; dispose(emit: boolean): void } };
    const state = root.__queryFileMainProbe;
    if (!Number.isFinite(choice.deadline) || Date.now() >= choice.deadline || !state || state.nonce !== choice.nonce || state.deadline !== choice.deadline || state.window !== choice.window || state.contents !== choice.contents) throw Error('Main观察解绑所属或期限未知');
    state.dispose(true); return { nonce: choice.nonce, detached: root.__queryFileMainProbe === undefined };
  }, choice).catch(() => { throw Error('Main观察解绑失败，保留现场'); });
}
