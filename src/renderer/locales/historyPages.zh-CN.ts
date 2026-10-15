export const historyPagesZh={
 search:'搜索完整历史SQL或错误',searchButton:'搜索执行历史',fields:'搜索字段',sql:'SQL正文',error:'错误信息',
 scope:'历史来源',all:'全部来源',unbound:'无来源历史',status:'执行结果',allStatus:'全部结果',success:'执行成功',failed:'执行失败',
 onError:'损坏记录处理',continue:'记录失败并继续',stop:'遇到失败停止',hint:'每批检查最多25条，只展示有界概要；保留最近1000条。搜索完整原文，翻页替换当前批次。',
 pending:'筛选已改变，请重新搜索。',summary:'第{0}批 · 已检查{1}条 · 匹配{2}条 · 读取失败{3}条',failedStop:'遇到记录错误，已停止。',more:'还有下一批记录。',done:'已读取完毕。',
 choose:'选择打开历史的连接',connection:'打开历史的连接：{0}',sourceMissing:'来源连接不存在',preview:'SQL共{0}个UTF16单元，打开新标签可读取完整正文。',
 empty:'本批没有匹配的执行历史',emptyHint:'如有下一批可继续检查，或修改筛选重新搜索。',failures:'记录读取失败明细',
 openHint:'打开只创建新查询草稿，不执行SQL。原来源失效时须明确选择替代连接，默认库将变为待确认。',
 refresh:'刷新到第一页',next:'读取下一批',cancel:'取消历史读取',cleanupFailed:'历史窗口收尾失败：',
 errorPreview:'错误概要',errorFull:'查看完整错误',errorTitle:'完整历史错误',errorClose:'收起完整错误',errorSize:'错误共{0}个UTF16单元。',
 fieldsRequired:'请至少选择一个搜索字段。'
}as const;
