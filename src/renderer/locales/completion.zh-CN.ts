/** 补全文案集中管理；目录名称与错误细节不作为富文本解释。 */
export const completionZh={
  temporary:'会话临时表',sessionUnconfirmed:'会话对象 · 待核对',
  database:'数据库',table:'表',view:'视图',function:'函数',procedure:'存储过程',column:'字段',alias:'表别名',cte:'公共表表达式',derived:'派生表',keyword:'关键字',
  partial:'补全结果不完整',partialHint:'请继续输入更长的名称前缀，或使用表别名限定字段。',
  sessionUnknown:'会话对象待核对',sessionUnknownHint:'点击“会话临时对象”，输入库名和表名并读取结构；可能执行例程的来源不会自动回退同名永久字段。',
  unavailable:'补全目录暂不可用',unavailableHint:'可以继续编辑；检查连接和元数据读取权限后，按 Ctrl + 空格重试。',
  limited:'当前文本暂不提供补全',limitedHint:'文本大小、嵌套或解析时间超过补全上限，可以继续编辑和执行 SQL。',
  startupTimeout:'补全启动超时',startupTimeoutHint:'可以继续编辑和执行 SQL；稍后按 Ctrl + 空格重新启动补全。',
  analysisTimeout:'补全分析超时',analysisTimeoutHint:'本次补全已停止，可以继续编辑和执行 SQL；缩短当前语句或稍后按 Ctrl + 空格重试。',
  databaseUnknown:'默认库待确认',databaseUnknownHint:'可以继续使用显式库名编写 SQL；执行 USE 后会根据服务器通知确认默认库。',
};
