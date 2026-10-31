/** 提交事实只显示确认状态和最小目标，不展示行值、SQL或数据库文件路径。 */
export const sqliteWriteFactZh = { title: 'SQLite 提交事实', operation: '原操作编号', target: '准确目标', requested: '本批请求条数', processed: '事务内已处理条数（不是已提交数）', phases: { 'not-sent': '尚未发送', writing: '事务中，尚未提交', 'commit-pending': '正在确认提交，请等待原结果', committed: '已确认提交', 'rolled-back': '已确认整批回滚', unknown: '结果未知，请核对原库，禁止重复原批次' } } as const;
