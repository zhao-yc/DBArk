import type { Command, TaskEvent } from '../shared/contracts';

/** 服务端错误可能展开参数值；概要记录仅保存进度，不将错误原文写入本地库。 */
export function persistedTaskMessage(command: string, event: TaskEvent): string {
  if (command.startsWith('excel.')) return event.status === 'completed' ? 'Excel 文件任务已完成；文件内容与字段值未保存到任务摘要。' : event.status === 'running' ? '正在处理 Excel 文件；进度与详细信息请在当前窗口核对。' : 'Excel 文件任务未完成；已提交批次与错误详情请在当前窗口核对，字段值和错误原文未保存。';
  if(command.startsWith('search.savedQueries'))return event.status==='completed'?'本地保存查询搜索批次已结束；搜索文字、正文、命中和错误原文未保存。':event.status==='running'?'正在搜索本地保存查询；正文及命中只在当前窗口保留。':'本地保存查询搜索未完成；搜索文字、正文、命中和错误原文未保存，请在当前窗口核对。';
  if(command==='search.recordRead')return event.status==='completed'?'记录定位已结束；键、字段值与错误原文未保存。':event.status==='running'?'正在只读定位记录；键与字段值只在当前窗口保留。':'记录定位未完成；键、字段值与错误原文未保存，请在当前窗口核对。';
  if(command.startsWith('search.data'))return event.status==='completed'?'数据搜索已结束；范围完成情况请在搜索窗口核对，搜索值、命中和错误原文未保存。':event.status==='running'?'正在搜索数据；搜索值及命中只在当前窗口保留。':'数据搜索未完成；搜索值、命中和错误原文未保存，请在搜索窗口核对。';
  if(command.startsWith('search.'))return event.status==='completed'?'结构搜索批次已完成；搜索文字、命中和错误原文未保存。':event.status==='running'?'正在搜索结构；搜索文字及命中只在当前窗口保留。':'结构搜索未完成；搜索文字、命中和错误原文未保存，请在搜索窗口核对。';
  if (command.startsWith('schema.columns.') || command.startsWith('schema.indexes.') || command.startsWith('schema.foreignKeys.')) {
    const progress = command.startsWith('schema.foreignKeys.') ? event.foreignKeyPatch : command.startsWith('schema.indexes.') ? event.indexPatch : event.columnPatch;
    return progress?.ddlCompleted ? '结构变更已收到成功响应，请核对最新定义；默认值、注释与错误原文未保存。' : progress?.ddlSubmitted ? '结构变更可能已执行，请核对服务器定义；未自动重放，错误原文未保存。' : '结构任务尚未确认发送 DDL；字段内容与错误原文未保存。';
  }
  if (event.status !== 'failed' && event.status !== 'cancelled') return event.message;
  if (command === 'query.executeParameterized') return '参数查询未完成，请在当前标签核对已执行语句和事务状态；参数值未写入任务记录。';
  if (command === 'query.exportStream') {
    const progress = event.queryExport;
    return `完整导出未完成，已完成 ${progress?.statementsCompleted ?? 0} 条 SQL、写入 ${progress?.rowsWritten ?? 0} 行；${progress?.fileCommitted ? '文件已经保存。' : '文件未确认保存。'}请核对数据库状态，错误原文及参数值未写入任务记录。`;
  }
  return event.message;
}

/** 执行历史保存模板；新执行导出同样隐藏可能含真实参数的错误原文。 */
export function persistedQueryError(command: Command, message: string): string {
  if (command === 'query.executeParameterized') return '参数查询失败，细节仅在当前标签显示；参数值未保存。';
  return command === 'query.exportStream' ? '执行未完成，细节仅在当前标签显示；错误原文及参数值未保存。' : message;
}
