/** 字段身份只保留在renderer；重排保留原列对象，不改字段属性或按列名引用的键。 */
export class NewTableColumnOrder<T extends object> {
  private readonly identities = new WeakMap<T, string>();
  private sequence = 0;
  /** React行键不依赖数组位置或可编辑的列名。 */
  key(column: T): string {
    let key = this.identities.get(column);
    if (!key) { key = `new-column-${++this.sequence}`; this.identities.set(column, key); }
    return key;
  }
  /** 修改列时转移稳定身份；旧列对象不能认领新数组里的其它列。 */
  patch(columns: readonly T[], column: T, patch: Partial<T>): T[] | undefined {
    if (!columns.includes(column)) return;
    const next = { ...column, ...patch }; this.identities.set(next, this.key(column));
    return columns.map(value => value === column ? next : value);
  }
  /** 只交换相邻的真实列对象；边界、未知方向和迟到对象均不产生新草稿。 */
  move(columns: readonly T[], column: T, direction: -1 | 1): T[] | undefined {
    const from = columns.indexOf(column), to = from + direction;
    if (from < 0 || direction !== -1 && direction !== 1 || to < 0 || to >= columns.length) return;
    const next = [...columns]; [next[from], next[to]] = [next[to], next[from]]; return next;
  }
}
