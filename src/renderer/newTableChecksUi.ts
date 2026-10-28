import type { TableCreateCheck } from '../shared/tableCreateChecks';
import { tableCheckLimits } from '../shared/tableChecks';

/** 只有用户明确清空新表列表才删可选键，不能把undefined/空数组传入严格CREATE合同。 */
export function withNewTableChecks<T extends { checks?: TableCreateCheck[] }>(design: T, checks: TableCreateCheck[] | undefined): T {
  const next = { ...design }; if (checks?.length) next.checks = checks; else delete next.checks; return next;
}
/** 行身份只在renderer内保留，不以可编辑名称或数组位置作为React key。 */
export class NewTableChecksRows {
  private readonly identities = new WeakMap<TableCreateCheck, string>(); private sequence = 0;
  /** 改名和表达式输入仍沿同一行key，防止每个按键重挂并丢焦点。 */
  key(row: TableCreateCheck): string { let key = this.identities.get(row); if (!key) { key = `new-check-${++this.sequence}`; this.identities.set(row, key); } return key; }
  /** 只修改准确原行，并转交稳定key；迟到对象不能靠同名或位置认领后继。 */
  patch(rows: readonly TableCreateCheck[], row: TableCreateCheck, patch: Partial<TableCreateCheck>): TableCreateCheck[] | undefined {
    if (!rows.includes(row)) return; const next = { ...row, ...patch }; this.identities.set(next, this.key(row)); return rows.map(value => value === row ? next : value);
  }
  /** 相邻移动原对象，约束表达式和字段名引用原文完全不动。 */
  move(rows: readonly TableCreateCheck[], row: TableCreateCheck, direction: -1 | 1): TableCreateCheck[] | undefined {
    const from = rows.indexOf(row), to = from + direction; if (from < 0 || direction !== -1 && direction !== 1 || to < 0 || to >= rows.length) return; const next = [...rows]; [next[from], next[to]] = [next[to], next[from]]; return next;
  }
  /** 删除按真实对象，不让原第N行按钮误删后来同位置的另一约束。 */
  remove(rows: readonly TableCreateCheck[], row: TableCreateCheck): TableCreateCheck[] | undefined { return rows.includes(row) ? rows.filter(value => value !== row) : undefined; }
  /** 空名称/表达式是输入中的草稿，最终严格合同在预览前裁决，不在此伪造已验证SQL。 */
  append(rows: readonly TableCreateCheck[]): { rows: TableCreateCheck[]; added: TableCreateCheck } | undefined { if (rows.length >= tableCheckLimits.checks) return; const added = { name: '', expression: '', enforced: true }; this.key(added); return { rows: [...rows, added], added }; }
}
