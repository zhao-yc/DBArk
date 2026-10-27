import { queryResultSnapshotUiZh as text } from './locales/queryResultSnapshot.zh-CN';

/** 只持有本轮原身份引用，来源离开过一次即永久废弃；不执行文件IO或数据库操作。 */
export class QueryResultSnapshotIntent {
  private dead = false; private consumed = false;
  private readonly values: readonly unknown[];
  constructor(values: readonly unknown[], private readonly guard: () => boolean) { this.values = [...values]; }
  observe(values: readonly unknown[]): void { if (values.length !== this.values.length || values.some((value, index) => !Object.is(value, this.values[index]))) this.invalidate(); }
  /** 真实busy owner、标签和当前结果由调用者同步核对，未知归属同样永久拒绝。 */
  current(): boolean { if (!this.dead && !this.consumed) { try { if (!this.guard()) this.invalidate(); } catch { this.invalidate(); } } return !this.dead && !this.consumed; }
  invalidate(): void { this.dead = true; }
  /** 发布只能消费一次；调用者须先完成文件校验和全部pin容量检查。 */
  consume(): void { if (!this.current()) throw Error(text.stale); this.consumed = true; }
}
