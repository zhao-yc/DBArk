import { sqliteIndexesZh } from './sqliteIndexes.zh-CN';

/** 索引任务只显示最小事务事实，不展示用户表达式、SQL或路径。 */
export const sqliteIndexesTaskTitles = { inspect: 'SQLite索引目录检查', preview: 'SQLite索引修改预览', apply: 'SQLite索引事务' } as const;
export const sqliteIndexesFactZh = { title: sqliteIndexesZh.factTitle, operation: sqliteIndexesZh.factOperation, target: sqliteIndexesZh.factTarget, statements: sqliteIndexesZh.factCompleted } as const;
