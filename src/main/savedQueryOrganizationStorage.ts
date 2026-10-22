import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Database, SqlValue } from 'sql.js';
import { planSavedQueryGroups, summarizeSavedQueryOrganization, validateSavedQueryGroups, type SavedQueryGroup, type SavedQueryOrganizationOperation } from '../shared/savedQueryOrganization';

interface OrganizationDocument { version: 1; revision: number; groups: SavedQueryGroup[]; }
const documentBytes = 1024 * 1024;
const documentSchema = z.object({ version: z.literal(1), revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER - 1), groups: z.unknown() }).strict();
const emptyDocument = (): OrganizationDocument => ({ version: 1, revision: 0, groups: [] });

/** 组织表属于可选schema9元数据；读取不解密凭据，也不读取查询正文。 */
function tableExists(db: Database, table: string): boolean {
  const statement = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?");
  try { statement.bind([table]); return statement.step(); } finally { statement.free(); }
}

/** 未知版本、坏树或额外单例行必须在迁移的任何写盘之前拒绝。 */
export function readSavedQueryOrganization(db: Database): OrganizationDocument {
  if (!tableExists(db, 'saved_query_organization')) return emptyDocument();
  const statement = db.prepare('SELECT id,CASE WHEN length(CAST(data AS BLOB))<=? THEN data ELSE NULL END AS data FROM saved_query_organization LIMIT 2');
  try {
    statement.bind([documentBytes]);
    if (!statement.step()) return emptyDocument();
    const row = statement.getAsObject();
    if (row.id !== 1 || typeof row.data !== 'string' || statement.step()) throw Error('保存查询分组元数据损坏或超过1MiB');
    const document = documentSchema.parse(JSON.parse(row.data));
    return { ...document, groups: validateSavedQueryGroups(document.groups) };
  } finally { statement.free(); }
}

/** 逐个核对成员字段及已有组；旧客户端删除查询留下的孤儿只在后续迁移事务精确清除。 */
export function validateSavedQueryOrganizationStorage(db: Database): void {
  const hasDocument = tableExists(db, 'saved_query_organization'), hasMembers = tableExists(db, 'saved_query_memberships');
  if (hasDocument !== hasMembers) throw Error('保存查询分组元数据表不完整');
  const document = readSavedQueryOrganization(db);
  if (!hasMembers) return;
  const invalid = db.prepare("SELECT 1 FROM saved_query_memberships WHERE typeof(query_id)<>'text' OR length(query_id)<1 OR length(query_id)>200 OR typeof(group_id)<>'text' LIMIT 1");
  try { if (invalid.step()) throw Error('保存查询分组成员字段损坏'); } finally { invalid.free(); }
  const groups = new Set(document.groups.map(group => group.id)), statement = db.prepare('SELECT DISTINCT group_id FROM saved_query_memberships');
  try { while (statement.step()) if (!groups.has(String(statement.get()[0]))) throw Error('保存查询分组成员引用不存在的分组'); } finally { statement.free(); }
}

/** 每次启动使用独立世代，查询保存和组织ABA都不能复活先前的CAS。 */
export function savedQueryOrganizationRevision(document: OrganizationDocument, queryRevision: number, generation: string): string {
  return createHash('sha256').update(JSON.stringify([generation, queryRevision, document.revision])).digest('hex');
}

/** 只在SQLite累计真实查询成员数量；响应不包含查询正文或完整成员映射。 */
export function savedQueryOrganizationSnapshot(db: Database, revision: string) {
  const document = readSavedQueryOrganization(db), counts = new Map<string, number>();
  const statement = db.prepare('SELECT m.group_id,COUNT(*) AS count FROM saved_query_memberships m JOIN queries q ON q.id=m.query_id GROUP BY m.group_id');
  try { while (statement.step()) { const row = statement.getAsObject(); counts.set(String(row.group_id), Number(row.count)); } } finally { statement.free(); }
  const unfiled = db.exec('SELECT COUNT(*) FROM queries q WHERE NOT EXISTS (SELECT 1 FROM saved_query_memberships m WHERE m.query_id=q.id)')[0]?.values[0]?.[0];
  return summarizeSavedQueryOrganization(document.groups, counts, Number(unfiled ?? 0), revision);
}

/** 必须在调用者的单次事务内执行；先核整批摘要，再变更独立元数据，不更新queries行。 */
export function applySavedQueryOrganization(db: Database, operation: SavedQueryOrganizationOperation, createId: string | undefined, raw: (id: string) => string | undefined): void {
  const document = readSavedQueryOrganization(db);
  if (document.revision >= Number.MAX_SAFE_INTEGER - 1) throw Error('保存查询分组修订已达上限');
  const plan = planSavedQueryGroups(document.groups, operation, createId);
  if (operation.kind === 'moveQueries') {
    for (const query of operation.queries) {
      const source = raw(query.id);
      if (source === undefined) throw Error('保存查询已删除，请刷新列表');
      if (createHash('sha256').update(source).digest('hex') !== query.digest) throw Error('保存查询已修改，未移动新内容，请刷新列表');
    }
    for (const query of operation.queries) {
      if (operation.groupId === null) db.run('DELETE FROM saved_query_memberships WHERE query_id=?', [query.id]);
      else db.run('INSERT INTO saved_query_memberships VALUES (?,?) ON CONFLICT(query_id) DO UPDATE SET group_id=excluded.group_id', [query.id, operation.groupId]);
    }
  }
  for (const id of plan.dissolvedGroupIds) db.run('DELETE FROM saved_query_memberships WHERE group_id=?', [id]);
  db.run('INSERT INTO saved_query_organization VALUES (1,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data', [JSON.stringify({ version: 1, revision: document.revision + 1, groups: plan.groups })]);
}

/** 生成SQLite位置分页的范围条件；参数始终绑定，组名和正文不参与SQL拼接。 */
export function savedQueryMembershipCondition(ids: string[] | null): { condition?: string; params: SqlValue[] } {
  if (ids === null) return { params: [] };
  if (!ids.length) return { condition: 'm.query_id IS NULL', params: [] };
  return { condition: 'm.group_id IN (' + ids.map(() => '?').join(',') + ')', params: ids };
}
