/** 关联标签只持久化随机标识，缺失会话能力时禁止退化为普通全表。 */
export const postgresRelatedTabPrefix = 'postgres-related:';

export function isPostgresRelatedTabId(id: string | undefined): boolean {
  return !!id?.startsWith(postgresRelatedTabPrefix);
}
