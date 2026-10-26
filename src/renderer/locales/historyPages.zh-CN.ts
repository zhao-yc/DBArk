export const historyPagesZh={
 durationRange:'执行耗时范围',minDuration:'最短耗时（毫秒）',maxDuration:'最长耗时（毫秒）',clearDuration:'清除耗时范围',
 durationHint:'按本地记录的执行耗时筛选，不重发SQL。请输入0到9007199254740991的整数毫秒，最短和最长均包含，允许相等；空白不限。修改或清除后须明确搜索。',
 durationInvalid:'耗时请输入0到9007199254740991的整数毫秒，不接受负号、小数或指数。',durationOrder:'最短耗时不能大于最长耗时；两端均包含，允许相等。',
 timeRange:'执行开始时间范围',from:'开始时间（包含）',until:'结束时间（不包含）',clearTime:'清除时间范围',timeZone:'本机时区（打开面板时）',unknownZone:'未能读取，请填写明确绝对时间',
 timeHint:'按执行开始时刻筛选：开始包含、结束不包含，留空不限。填写YYYY-MM-DD HH:mm[:ss[.SSS]]，或带Z/数值偏移的ISO时间；重复夏令时时刻须明确偏移，非法日期不会自动调整。',
 search:'搜索完整历史SQL或错误',searchButton:'搜索执行历史',fields:'搜索字段',sql:'SQL正文',error:'错误信息',
 scope:'历史来源',all:'全部来源',unbound:'无来源历史',status:'执行结果',allStatus:'全部结果',success:'执行成功',failed:'执行失败',
 onError:'损坏记录处理',continue:'记录失败并继续',stop:'遇到失败停止',hint:'每批检查最多25条，只展示有界概要；保留最近1000条。搜索完整原文，翻页替换当前批次。',
 filterStatus:'历史筛选状态',pageStatus:'历史读取进度',
 pending:'筛选已改变，请重新搜索。',summary:'第{0}批 · 已检查{1}条 · 匹配{2}条 · 读取失败{3}条',failedStop:'遇到记录错误，已停止。',more:'还有下一批记录。',done:'已读取完毕。',
 choose:'选择打开历史的连接',connection:'打开历史的连接：{0}',sourceMissing:'来源连接不存在',preview:'SQL共{0}个UTF16单元，打开新标签可读取完整正文。',
 empty:'本批没有匹配的执行历史',emptyHint:'如有下一批可继续检查，或修改筛选重新搜索。',failures:'记录读取失败明细',
 openHint:'打开只创建新查询草稿，不执行SQL。原来源失效时须明确选择替代连接，默认库将变为待确认。',
 refresh:'刷新到第一页',next:'读取下一批',cancel:'取消历史读取',cleanupFailed:'历史窗口收尾失败：',
 errorPreview:'错误概要',errorFull:'查看完整错误',errorTitle:'完整历史错误',errorClose:'收起完整错误',errorSize:'错误共{0}个UTF16单元。',
 fieldsRequired:'请至少选择一个搜索字段。'
}as const;
