/** 最小对象事务概要不保留CREATE正文、字面量或路径。 */
export const sqliteObjectsTaskTitles = {inspect:'SQLite对象目录检查',preview:'SQLite对象定义预览',apply:'SQLite对象定义事务'} as const;
export const sqliteObjectsFactZh = {title:'SQLite 对象事务回执',operation:'操作编号',target:'准确原目标',kind:'对象类型',kinds:{view:'视图',trigger:'触发器'},action:'操作',actions:{create:'创建',replace:'替换定义',drop:'删除'},requested:'请求的语句数',completed:'已处理的语句数（不是已提交数）',phases:{'not-sent':'语句尚未发送',writing:'事务内处理，尚未提交','commit-pending':'等待 COMMIT 确认',committed:'COMMIT 已确认','rolled-back':'ROLLBACK 已确认，整组回滚',unknown:'结果未知，禁止重复提交'}} as const;
