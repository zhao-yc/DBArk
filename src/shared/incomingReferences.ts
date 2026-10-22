import type { CellValue, FilterGroup, FilterMode, FilterRule, ForeignKeyInfo, SortRule, TableInfo, TablePage } from './contracts';

export const incomingReferenceLimits = { relations: 50, parts: 64, rows: 4096, bytes: 8 * 1024 * 1024, cursor: 2048 } as const;
export interface IncomingReferencesInput { connectionId: string; database: string; table: string; taskId: string; cursor?: string; }
export interface IncomingReferenceSelection { database: string; table: string; foreignKeyName: string; digest: string; }
export interface IncomingReferenceRelation { database: string; table: string; foreignKey: ForeignKeyInfo; digest: string; }
export interface IncomingReferencesOutput { source: TableInfo; sourceDigest: string; relations: IncomingReferenceRelation[]; nextCursor?: string; scope: 'visible-only'; }
export interface ChildReferencePageInput {
  connectionId: string; database: string; table: string; taskId: string; relation: IncomingReferenceSelection; matchValues: CellValue[];
  page: number; pageSize: number; filters: FilterRule[]; filterMode?: FilterMode; filterGroup?: FilterGroup; sort: SortRule[];
}
export interface ChildReferencePageOutput { source: TableInfo; sourceDigest: string; relation: IncomingReferenceRelation; target: TableInfo; page: TablePage; stablePagination: boolean; }
export const incomingReferenceMessages = {
  invalid: '入向关联目标、目录或字段映射无效，请刷新表结构。', stale: '父表或实际外键已变化，请重新读取关联目录。',
  budget: '入向关联目录超过本次有界读取预算，请缩小对象范围。', cursor: '关联目录游标无效或父表已变化，请从第一页重新读取。',
  visible: '仅显示当前账号可见的引用关系；目录跨页不构成全局权限清单或一致快照。',
  unstable: '子表没有可靠非空唯一键，本页只读，翻页期间记录可能重复或遗漏。',
  snapshot: '使用打开时父记录的可见字段值快照，不自动追踪后续并发修改。',
} as const;
