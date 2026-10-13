import type { DataRow, RowChange } from '../shared/contracts';
import { ownCell, rowEqual } from './lib';

export interface DraftRow { id: string; data: DataRow; original?: DataRow; inserted: boolean; deleted: boolean; }

/** 保留载入时的完整快照用于乐观锁，只把实际修改字段发送给数据库。 */
export function collectChanges(rows: DraftRow[]): RowChange[] {
  return rows.flatMap<RowChange>(row => {
    if (row.inserted) return row.deleted ? [] : [{ kind: 'insert', values: row.data }];
    if (row.deleted) return [{ kind: 'delete', before: row.original! }];
    if (rowEqual(row.original!, row.data)) return [];
    const changed: DataRow = Object.fromEntries(Object.entries(row.data).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(ownCell(row.original!, key))));
    return [{ kind: 'update', before: row.original!, values: changed }];
  });
}
