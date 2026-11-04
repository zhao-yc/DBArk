/** 关联表页的会话标记只含随机ID；重启缺少内存来源时必须拒绝退化为普通全表。 */
export const sqliteRelatedTabPrefix = 'sqlite-related:';
/** 只认保留前缀，不用可编辑标题或表名推断关联来源。 */
export function isSqliteRelatedTabId(id: string | undefined): boolean { return typeof id === 'string' && id.startsWith(sqliteRelatedTabPrefix); }
