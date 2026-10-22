export interface StructureExecutionTarget { database: string; table: string; }

/** 同一连接配置内原子占用子表和全部相关父表；只拒绝冲突，不排队或按超时偷放资源。 */
export class StructureExecutionLocks {
  private readonly owners = new Map<string, symbol>();
  private readonly databaseOwners = new Map<string, symbol>();

  /** 库级变更与其所有表级执行互斥；跨库外键父表同样参与，失败不占有资源。 */
  acquireDatabase(connectionId: string, database: string): () => void {
    if (!connectionId || connectionId.includes('\0') || !database || database.includes('\0')) throw new Error('结构执行数据库身份或名称无效');
    const key = JSON.stringify([connectionId, database]);
    if (this.databaseOwners.has(key) || [...this.owners.keys()].some(value => {
      const [ownerConnection, ownerDatabase] = JSON.parse(value) as string[];
      return ownerConnection === connectionId && ownerDatabase === database;
    })) throw new Error('该数据库或其中的表已有结构变更正在执行，请等待完成后重新读取并预览；未发送 DDL');
    const owner = Symbol('数据库结构执行资源');
    this.databaseOwners.set(key, owner);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (this.databaseOwners.get(key) === owner) this.databaseOwners.delete(key);
    };
  }

  /** 先校验完整集合再一次占有，输入顺序不影响结果，失败不能留下部分占用。 */
  acquire(connectionId: string, targets: readonly StructureExecutionTarget[]): () => void {
    if (!connectionId || targets.length > 257) throw new Error('结构执行目标身份或数量无效');
    const keys = [...new Set(targets.map(target => {
      if (!target.database || !target.table || target.database.includes('\0') || target.table.includes('\0')) throw new Error('结构执行目标名称无效');
      return JSON.stringify([connectionId, target.database, target.table]);
    }))].sort();
    if (keys.some(key => { const [connection, database] = JSON.parse(key) as string[]; return this.owners.has(key) || this.databaseOwners.has(JSON.stringify([connection, database])); })) throw new Error('该表、关联父表或所属数据库已有结构变更正在执行，请等待完成后重新读取并预览；未发送 DDL');
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
