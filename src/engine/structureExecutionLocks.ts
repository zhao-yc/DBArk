export interface StructureExecutionTarget { database: string; table: string; }

/** 同一连接配置内原子占用子表和全部相关父表；只拒绝冲突，不排队或按超时偷放资源。 */
export class StructureExecutionLocks {
  private readonly owners = new Map<string, symbol>();

  /** 先校验完整集合再一次占有，输入顺序不影响结果，失败不能留下部分占用。 */
  acquire(connectionId: string, targets: readonly StructureExecutionTarget[]): () => void {
    if (!connectionId || targets.length > 257) throw new Error('结构执行目标身份或数量无效');
    const keys = [...new Set(targets.map(target => {
      if (!target.database || !target.table || target.database.includes('\0') || target.table.includes('\0')) throw new Error('结构执行目标名称无效');
      return JSON.stringify([connectionId, target.database, target.table]);
    }))].sort();
    if (keys.some(key => this.owners.has(key))) throw new Error('该表或关联父表已有结构变更正在执行，请等待完成后重新读取并预览；未发送 DDL');
    const owner = Symbol('结构执行资源');
    for (const key of keys) this.owners.set(key, owner);
    let released = false;
    // 由任务在真实连接关闭后调用；旧释放器不能移除后来操作取得的占用。
    return () => {
      if (released) return;
      released = true;
      for (const key of keys) if (this.owners.get(key) === owner) this.owners.delete(key);
    };
  }
}
