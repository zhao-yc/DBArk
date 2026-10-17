import type { ElectronApplication, Page } from '@playwright/test';

export interface IndentNativeOwner { application: ElectronApplication; page: Page; ids: Set<number>; closed: boolean; confirmed: boolean; ready: boolean; errors: string[]; quitReady: Promise<void>; }
export interface IndentNativePort {
  assertCurrent(): void; preflight(): Promise<void>; directory(): Promise<string>; assertDirectory(path: string): Promise<void>;
  launch(path: string): Promise<IndentNativeOwner>; prepare(owner: IndentNativeOwner): Promise<void>; record(owner: IndentNativeOwner): Promise<number[]>;
  quit(owner: IndentNativeOwner): Promise<void>; absent(ids: readonly number[]): Promise<void>; remove(path: string): Promise<void>;
}
/** 每次应用独立持有退出/PID事实，未知时只保留现场；不借通用夹具的强停兜底。 */
export class EditorIndentNativeRun {
  readonly owners: IndentNativeOwner[] = [];
  path?: string; retained = false; removed = false; private pending = false;
  constructor(private readonly port: IndentNativePort) {}
  /** 失败状态单向消费；旧owner不能操作重启后的新实例。 */
  assert(owner?: IndentNativeOwner, closed = false): void {
    try {
      this.port.assertCurrent();
      if (this.retained || this.removed || owner && (this.owners.at(-1) !== owner || !closed && (owner.closed || owner.confirmed))) throw Error('缩进原生专项owner已失效，停链保留资源');
    } catch (reason) { this.retained = true; throw reason; }
  }
  /** 每个await两侧核同一owner，迟到结果不能继续向下一个实例读写。 */
  async step<T>(owner: IndentNativeOwner, action: () => Promise<T>): Promise<T> {
    this.assert(owner); if (this.pending) { this.retained = true; throw Error('所属动作尚未完成，不得并发操作或退出'); } this.pending = true;
    try { const result = await action(); this.assert(owner); return result; } catch (reason) { this.retained = true; throw reason; }
    finally { this.pending = false; }
  }
  /** 原固定脚本完成拒连和原socket close后才允许分配/启动；前次退出未证实不得重启。 */
  async launch(): Promise<IndentNativeOwner> {
    this.assert(); if (this.pending || this.owners.some(owner => !owner.confirmed)) { this.retained = true; throw Error('前次owner未正常退出，不得启动下一实例'); }
    this.pending = true;
    try {
      await this.port.preflight(); this.assert();
      if (!this.path) { this.path = await this.port.directory(); this.assert(); }
      await this.port.assertDirectory(this.path); this.assert();
      const owner = await this.port.launch(this.path); this.owners.push(owner); this.assert(owner);
      const ids = await this.port.record(owner); this.assert(owner); this.addIds(owner, ids);
      await this.port.prepare(owner); this.assert(owner); return owner;
    } catch (reason) { this.retained = true; throw reason; }
    finally { this.pending = false; }
  }
  /** 空记录和任何非法PID都不能被解释为退出证明。 */
  private addIds(owner: IndentNativeOwner, ids: number[]) {
    if (!ids.length || ids.some(id => !Number.isSafeInteger(id) || id <= 0)) throw Error('缩进原生专项所属PID未知');
    for (const id of ids) owner.ids.add(id);
  }
  /** 只接收本owner的will-quit、close及全部记录PID不存在，禁止强停后补写成功。 */
  async close(owner: IndentNativeOwner): Promise<void> {
    this.assert(owner); if (this.pending) { this.retained = true; throw Error('缩进原生专项正在处理所属资源'); } this.pending = true;
    try {
      const ids = await this.port.record(owner); this.assert(owner); this.addIds(owner, ids);
      await this.port.quit(owner); this.assert(owner, true);
      if (!owner.ready || !owner.closed || owner.errors.length) throw Error('本owner正常退出或页面无错证明缺失');
      await this.port.absent([...owner.ids]); this.assert(owner, true); owner.confirmed = true;
    } catch (reason) { this.retained = true; throw reason; }
    finally { this.pending = false; }
  }
  /** SQLite只在最后一个owner已确认退出后读取；未知退出不允许借磁盘字节收尾。 */
  async stopped<T>(action: (path: string) => Promise<T>): Promise<T> {
    this.assert(); if (this.pending || !this.path || !this.owners.length || this.owners.some(owner => !owner.confirmed)) { this.retained = true; throw Error('本例尚未全部正常退出，禁止读盘或清理'); }
    this.pending = true;
    try { await this.port.assertDirectory(this.path); this.assert(); const value = await action(this.path); this.assert(); return value; } catch (reason) { this.retained = true; throw reason; }
    finally { this.pending = false; }
  }
  /** 只清理本例真实目录，删除必须真实完成；失败保留原事实且不重复尝试。 */
  async finish(): Promise<void> { if (this.owners.length !== 2) { this.retained = true; throw Error('独立两次启动尚未闭合，不得清理'); } await this.stopped(path => this.port.remove(path)); this.removed = true; }
}
