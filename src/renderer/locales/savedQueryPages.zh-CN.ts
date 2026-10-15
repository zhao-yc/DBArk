/** 保存查询分页列表的文案集中管理，历史列表仍走原有兼容路径。 */
export const savedQueryPagesZh={
 search:'搜索名称或完整SQL',searchButton:'搜索保存查询',refresh:'刷新到第一页',next:'读取下一批',cancel:'取消列表读取',
 hint:'按更新时间和标识降序，每批最多检查25条，仅显示512单元SQL预览。搜索完整名称/正文，点击搜索后生效；打开前重新核验原文，不执行SQL。',
 pending:'筛选尚未应用，请点击搜索。',summary:'当前第{0}批；已检查{1}条，命中{2}条，累计失败{3}条。',more:'仍有未检查记录，请读取下一批。',done:'已检查当前范围的全部记录，请同时核对累计失败数。',
 empty:'本批没有符合条件的保存查询',emptyHint:'如仍有未检查记录，可以继续读取下一批，或缩小搜索范围。',choose:'请明确选择连接',sourceMissing:'未指定或来源连接已失效',connection:'打开查询的连接：{0}',
 openHint:'来源存在时保留其默认库上下文；明确更换连接后默认库为未知，执行前需确认。',preview:'正文共{0}个UTF16单元；此处仅为预览。',failures:'本批失败记录',failedStop:'已按错误策略停止，仍有未确认范围。',
 onError:'列表读取遇到错误',stop:'停止读取',continue:'略过失败记录并继续',cancelled:'列表读取已取消，可以刷新重新开始。',cleanupFailed:'保存查询列表收尾失败，请核对：'
}as const;
