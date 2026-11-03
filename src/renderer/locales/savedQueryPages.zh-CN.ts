/** 保存查询分页列表的文案集中管理，历史列表仍走原有兼容路径。 */
export const savedQueryPagesZh={
 search:'搜索名称或完整SQL',searchButton:'搜索保存查询',refresh:'刷新到第一页',next:'读取下一批',cancel:'取消列表读取',
 scope:'保存查询来源',allSources:'全部来源',unbound:'未绑定连接',
 hint:'按更新时间倒序，每批检查 25 条；搜索完整名称和 SQL，打开时读取完整正文。',
 pending:'筛选尚未应用，请点击搜索。',summary:'当前第{0}批；已检查{1}条，命中{2}条，累计失败{3}条。',more:'仍有未检查记录，请读取下一批。',done:'已检查当前范围的全部记录，请同时核对累计失败数。',
 empty:'本批没有符合条件的保存查询',emptyHint:'如仍有未检查记录，可以继续读取下一批，或缩小搜索范围。',choose:'请明确选择连接',sourceMissing:'未指定或来源连接已失效',connection:'打开查询的连接：{0}',
 openHint:'更换来源连接后，请在执行前确认默认库。',preview:'正文共{0}个UTF16单元；此处仅为预览。',failures:'本批失败记录',failedStop:'已按错误策略停止，仍有未确认范围。',
 sqlFull:'查看完整 SQL',sqlTitle:'完整保存查询 SQL',sqlStale:'原列表范围已变化，请重新选择要查看的查询。',
 sqlExport:'另存为 SQL 文件',sqlExportHint:'以 UTF-8 保存原查询正文，保留现有换行。',sqlExported:'已另存 SQL 文件：{0}',
 sqlImport:'导入 SQL 文件',sqlImportChoose:'选择并导入 SQL 文件',sqlImportHint:'可多选，最多 25 个文件、合计 32 MiB。每个文件以文件名创建未绑定、未分组查询。',sqlImported:'已导入未分组查询：{0}。当前筛选可能隐藏此记录。',sqlBatchImported:'已导入 {0} 条未分组查询。当前筛选可能隐藏这些记录。',
 onError:'列表读取遇到错误',stop:'停止读取',continue:'略过失败记录并继续',cancelled:'列表读取已取消，可以刷新重新开始。',cleanupFailed:'保存查询列表收尾失败，请核对：'
}as const;
